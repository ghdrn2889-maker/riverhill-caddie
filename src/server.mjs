// 서버: PWA 파일 서빙 + 구독 API + 크롤러 구동 + 새 일정글 발생 시 푸시.
import { loadEnv, ROOT_DIR } from './env.mjs';
loadEnv();

import express from 'express';
import path from 'node:path';
import { initPush, addSubscription, broadcast } from './push.mjs';
import { startCrawler } from './crawler.mjs';
import { isScheduleWriter, PERSONAL_REQUEST_RE } from './analyzer.mjs';
import { fetchArticle } from './naverArticle.mjs';
import { analyzeTurn, analyzeSchedule } from './gemini.mjs';
import { judge, commuteInfo, scheduleHint, cheapRelevance } from './judge.mjs';
import { loadToday, saveToday, applyVerdict, statusKo } from './today.mjs';
import * as worklog from './worklog.mjs';
import * as cartcheck from './cartcheck.mjs';
import * as journal from './journal.mjs';
import { loadJSON, saveJSON } from './store.mjs';

// 피드는 흘려보낸다: 오래된 소식은 자동 정리(기본 36시간 = 어젯밤~오늘).
const FEED_KEEP_MS = Number(process.env.FEED_KEEP_HOURS ?? 36) * 3600 * 1000;
const freshFeed = (arr) => (arr || []).filter((x) => (Date.now() - (x.detectedAt || 0)) < FEED_KEEP_MS);

initPush();

const app = express();
app.use(express.json({ limit: '12mb' }));         // 계기판 사진(base64) 업로드 허용
app.use(express.urlencoded({ extended: true })); // 폼 전송(MacroDroid 등) 지원
app.use(express.static(path.join(ROOT_DIR, 'public')));

// 프로젝트 허브(다른 AI·사람 공유용 단일 진실 소스) — 마크다운 원문 서빙.
//  https://…/project/PROJECT.md 등으로 브라우징 되는 AI가 링크만으로 열람.
app.use('/project', express.static(path.join(ROOT_DIR, 'hub'), {
  setHeaders: (res, p) => { if (p.endsWith('.md')) res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); },
}));
app.get('/project', (req, res) => res.redirect('/project/PROJECT.md'));

// PWA 가 구독할 때 필요한 공개키
app.get('/api/config', (req, res) => {
  res.json({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY });
});

// 폰에서 '알림 켜기' 누르면 이 구독 정보가 저장됨
app.post('/api/subscribe', (req, res) => {
  if (!req.body?.endpoint) return res.status(400).json({ error: '잘못된 구독 정보' });
  addSubscription(req.body);
  res.json({ ok: true });
});

// 앱 화면에 보여줄 최근 감지 목록 (오래된 소식은 자동 제외 — 항상 최근만 깔끔하게).
app.get('/api/recent', (req, res) => {
  res.json(freshFeed(loadJSON('recent.json', [])));
});

// 일일 근무 일지 (근무/스페어/휴무 하루하루 기록): ?year=2026&month=7
app.get('/api/journal', (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  res.json({ ok: true, days: journal.listJournal({ year, month }), summary: journal.summary({ year, month }) });
});

// 테스트용: 지금 바로 내 폰으로 알림 한 번 쏴보기
app.post('/api/test', async (req, res) => {
  await broadcast({ title: '🏌️ 테스트 알림', body: '알림이 정상 작동합니다!', url: '/' });
  res.json({ ok: true });
});

// 외부 메시지 수신(카톡 단톡방 등) → 카페 글과 동일한 judge 파이프라인으로 처리.
//  폰의 알림 포워더(MacroDroid/Tasker/커스텀앱)가 단톡방 메시지를 여기로 POST 한다.
//  보안: 공개 URL이므로 INGEST_TOKEN(.env) 이 있으면 x-token 헤더/쿼리로 검사(위조 방지).
async function handleIngest(req, res) {
  const b = req.body || {};
  const q = req.query || {};
  const text = String(b.text || q.text || '').trim();
  const token = req.get('x-token') || q.token || b.token;
  console.log(`💬 [ingest] 수신됨: text="${text.slice(0, 30)}"(${text.length}자) token=${token ? '있음' : '없음'} room=${b.room || q.room || '-'}`);
  if (!text) return res.status(400).json({ error: 'text 필요 (알림 내용이 비어있음)' });
  if (process.env.INGEST_TOKEN && token !== process.env.INGEST_TOKEN) {
    return res.status(401).json({ error: '인증 실패' });
  }
  const source = b.source || q.source || '카톡';
  const roomName = b.room || q.room || '';
  const sender = b.sender || q.sender || '';
  // 카톡 그룹 알림은 제목({not_title})에 '방 이름'이 아니라 '보낸 사람'이 담겨 오므로
  // 방 이름으로 거를 수 없다 → 내용 기반 판독기(judge)가 3부 관련성으로 거른다(무관 메시지는 피드에만·숨김).
  // (선택) ALLOWED_SENDERS 를 설정하면 그 발신자만 통과시키는 화이트리스트로 동작(사생활 강화).
  const allowSenders = (process.env.ALLOWED_SENDERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowSenders.length && !allowSenders.some((a) => `${roomName} ${sender}`.includes(a))) {
    console.log(`💬 [ingest] 발신자 '${roomName || sender}' 화이트리스트 밖 → 무시`);
    return res.json({ ok: true, skipped: true, reason: 'sender_not_allowed' });
  }
  const room = roomName ? ` · ${roomName}` : '';
  const pseudo = {
    id: `ingest-${req.query.id || Date.now()}`,
    subject: `[${source}${room}] ${text.slice(0, 40)}`,
    text, writer: sender, menuId: '', menuName: source,
    images: [], writeDate: '', url: '/',
  };
  // ★잡담/사진/광고 사전 필터: 일정 단서가 전혀 없으면 Gemini 호출 없이 피드에만.
  //  (카톡방 잡담마다 Gemini를 부르면 429 폭주 + 판독 실패 시 광고까지 알림 스팸 → 사전 차단)
  if (!scheduleHint(text)) {
    saveRecentV2(pseudo, { relevant: false, push: 'low', status: 'unknown', body: text,
      rawVerdict: { category: '기타', summary: text } });
    console.log(`💬 [ingest] 일정 단서 없음 → Gemini 생략, 피드만: "${text.slice(0, 25)}"`);
    return res.json({ ok: true, skipped: true, reason: 'no_schedule_hint' });
  }
  try {
    const out = await notifyForArticle(pseudo, {}, {});
    res.json({ ok: true, pushed: !!out.pushed, push: out.push, body: out.body });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
app.post('/api/ingest', handleIngest);
app.get('/api/ingest', handleIngest); // 폰 브라우저·간단 포워더용(쿼리 파라미터로도 수신)

// 라이브 테스트용: 특정 글을 실제로 분석해서 폰으로 푸시 (?id=26231)
app.post('/api/simulate', async (req, res) => {
  const id = req.body?.id || req.query.id;
  if (!id) return res.status(400).json({ error: 'id 필요 (예: /api/simulate?id=26231)' });
  try {
    const full = await fetchArticle(id);
    const out = await notifyForArticle(full, { hits: [], priority: 'high' }, { force: true });
    res.json({ ok: true, writer: full.writer, menuId: full.menuId, menuName: full.menuName, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 새 두뇌(judge) 검증용: 글을 통합 판단기로만 돌려 결과 확인 (푸시 안 함, 라이브 흐름 무관).
app.post('/api/judge', async (req, res) => {
  const id = req.body?.id || req.query.id;
  if (!id) return res.status(400).json({ error: 'id 필요 (예: /api/judge?id=26299)' });
  try {
    const full = await fetchArticle(id);
    const out = await judge(full, loadToday());
    res.json({ ok: true, subject: full.subject, writer: full.writer, menuId: full.menuId,
      push: out.push, title: out.title, body: out.body, verdict: out.rawVerdict });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// heartbeat: 감시가 살아있는지 (앱 상단에 "마지막 감시 N초 전" 표시용).
app.get('/api/health', (req, res) => {
  const h = loadJSON('health.json', {});
  const now = Date.now();
  const ageMs = h.lastPollAt ? now - h.lastPollAt : null;
  // 최근 5분 안에 폴링했고 쿠키에러 아니면 정상.
  const alive = ageMs != null && ageMs < 5 * 60 * 1000 && (h.failStreak || 0) < 2;
  res.json({ ok: true, alive, lastPollAt: h.lastPollAt || null, ageSec: ageMs != null ? Math.round(ageMs / 1000) : null,
    failStreak: h.failStreak || 0, lastError: h.lastError || null });
});

// 한국시각(Asia/Seoul) 기준 오늘 'YYYY-MM-DD'. 서버 TZ와 무관하게 안전.
function todayISOKST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // en-CA → 'YYYY-MM-DD'
}

// 오늘의 상황판 조회 (온디맨드 요약 / 디버깅).
app.get('/api/today', (req, res) => {
  const t = loadToday();
  if (!t) return res.json({ ok: true, empty: true, message: '아직 오늘 파악된 상황이 없어요.' });

  // ── 낡은 상태 가드 ──
  //  today.json의 날짜(=근무 대상일)가 '오늘'보다 과거면, 새 배치표를 아직 못 읽어
  //  어제(그제)의 확정값이 남아 있는 것. 이 낡은 티오프를 오늘 것처럼 보이면 안 됨.
  //  (다음날 배치표는 전날 올라오므로 date가 미래인 건 정상 → 그건 그대로 표시.)
  const tISO = worklog.labelToISO(t.date);
  if (tISO && tISO < todayISOKST()) {
    return res.json({
      ok: true, empty: true, stale: true, staleDate: t.date,
      message: '오늘 배치표를 아직 확보하지 못했어요. (마지막 확인: ' + t.date + ')',
    });
  }

  const p = [];
  if (t.myPosition) p.push(`순번 ${t.myPosition}번`);
  p.push(statusKo(t.status));
  if (t.teeTime) p.push(`티오프 ${t.teeTime}${t.course ? `(${t.course})` : ''}`);
  if (t.cutoffName) p.push(`${t.cutoffName}님까지 확정`);
  const commute = t.teeTime ? commuteInfo(t.teeTime) : null;
  res.json({ ok: true, date: t.date, summary: `${t.name} — ${p.join(' · ')}`, state: t, commute });
});

// ── 근무일지/세무 증빙 ──────────────────────────────────
// 조회: ?year=2026&month=7 (없으면 전체). { days, summary, settings }
app.get('/api/worklog', (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  res.json({ ok: true, days: worklog.listDays({ year, month }),
    summary: worklog.summary({ year, month }), settings: worklog.getSettings() });
});
// 실제 근무 여부 확인: { date:'YYYY-MM-DD', worked:true|false|null }
app.post('/api/worklog/confirm', (req, res) => {
  const { date, worked } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date 필요' });
  res.json({ ok: true, day: worklog.confirmWorkDay(date, worked) });
});
// 수동 추가: { date, teeTime?, course?, note? }
app.post('/api/worklog/add', (req, res) => {
  const { date, teeTime, course, note } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date 필요 (YYYY-MM-DD)' });
  res.json({ ok: true, day: worklog.addWorkDay(date, { teeTime, course, note }) });
});
// 설정: { homeGolfKmOneway?, workplace?, fuelEnabled?, kmPerL?, fuelPrice? }
app.post('/api/worklog/settings', (req, res) => {
  res.json({ ok: true, settings: worklog.setSettings(req.body || {}) });
});
// 계기판 사진 업로드: { date, leg:'start|work|home', image:'data:image/jpeg;base64,...' }
app.post('/api/worklog/photo', (req, res) => {
  const { date, leg, image } = req.body || {};
  if (!date || !leg || !image) return res.status(400).json({ error: 'date, leg, image 필요' });
  const day = worklog.savePhoto(date, leg, image);
  if (!day) return res.status(400).json({ error: '잘못된 이미지 형식' });
  res.json({ ok: true, day });
});
// 계기판 숫자(선택): { date, odo:{start,work,home} }
app.post('/api/worklog/odo', (req, res) => {
  const { date, odo } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date 필요' });
  res.json({ ok: true, day: worklog.saveOdo(date, odo || {}) });
});
// 계기판 사진 보기: /api/worklog/photo/2026-07-14_start.jpg
app.get('/api/worklog/photo/:fname', (req, res) => {
  const fname = req.params.fname;
  if (!/^[\w.-]+\.(jpg|png)$/.test(fname)) return res.status(400).end();
  res.sendFile(worklog.photoPath(fname), (err) => { if (err) res.status(404).end(); });
});
// CSV 내보내기(차량운행일지): ?year=2026 (엑셀/세무사 제출용)
app.get('/api/worklog/export.csv', (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  const csv = worklog.toCSV({ year, month });
  const name = `운행일지_${year || '전체'}${month ? '-' + month : ''}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(csv);
});
// 제출용 증빙 문서(사진 포함 HTML) — 인쇄→PDF 저장하면 단일 제출파일: ?year=2026&month=7
app.get('/api/worklog/report.html', (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(worklog.reportHTML({ year, month }));
});

// ── 카트 점검 ─────────────────────────────────────────
//  근무일마다 카트 정리 증거(시작사진·종료체크·빈카트사진·발견물)를 남긴다.
//  date 미지정이면 KST 오늘.
app.get('/api/cartcheck', (req, res) => {
  const date = req.query.date && cartcheck.getDay(req.query.date) ? req.query.date : todayISOKST();
  const t = loadToday();
  const tISO = t && worklog.labelToISO(t.date);
  const isWorkToday = !!(t && tISO === date && ['assigned', 'work', 'your_turn'].includes(t.status));
  res.json({ ok: true, date, items: cartcheck.getItems(), day: cartcheck.getDay(date),
    work: { isWorkToday, teeTime: (isWorkToday && t.teeTime) || '', course: (isWorkToday && t.course) || '', cartNo: (t && tISO === date && t.cartNo) || '' } });
});
// 체크리스트 항목 편집(추가/이름변경/삭제/복원) — 개인 목록으로 저장.
app.post('/api/cartcheck/items/add', (req, res) => {
  const label = (req.body || {}).label;
  if (!label) return res.status(400).json({ error: 'label 필요' });
  res.json({ ok: true, items: cartcheck.addItem(label) });
});
app.post('/api/cartcheck/items/rename', (req, res) => {
  const { key, label } = req.body || {};
  if (!key || !label) return res.status(400).json({ error: 'key, label 필요' });
  res.json({ ok: true, items: cartcheck.renameItem(key, label) });
});
app.post('/api/cartcheck/items/remove', (req, res) => {
  const key = (req.body || {}).key;
  if (!key) return res.status(400).json({ error: 'key 필요' });
  res.json({ ok: true, items: cartcheck.removeItem(key) });
});
app.post('/api/cartcheck/items/reset', (req, res) => {
  res.json({ ok: true, items: cartcheck.resetItems() });
});
app.post('/api/cartcheck/items/recommend', (req, res) => {
  res.json({ ok: true, items: cartcheck.recommendItems() });
});
app.post('/api/cartcheck/cart', (req, res) => {
  const { date, cartNo } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date 필요' });
  res.json({ ok: true, day: cartcheck.setCartNo(date, cartNo) });
});
app.post('/api/cartcheck/check', (req, res) => {
  const { date, key, done } = req.body || {};
  if (!date || !key) return res.status(400).json({ error: 'date, key 필요' });
  res.json({ ok: true, day: cartcheck.toggleCheck(date, key, !!done) });
});
app.post('/api/cartcheck/photo', (req, res) => {
  const { date, leg, image } = req.body || {};
  if (!date || !leg || !image) return res.status(400).json({ error: 'date, leg, image 필요' });
  const day = cartcheck.savePhoto(date, leg, image);
  if (!day) return res.status(400).json({ error: '잘못된 이미지/구분' });
  res.json({ ok: true, day });
});
app.get('/api/cartcheck/photo/:fname', (req, res) => {
  const fname = req.params.fname;
  if (!/^[\w.-]+\.(jpg|png)$/.test(fname)) return res.status(400).end();
  res.sendFile(cartcheck.photoPath(fname), (err) => { if (err) res.status(404).end(); });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`🌐 서버 실행: http://localhost:${PORT}`));

function saveRecent(article, result, ai) {
  const recent = loadJSON('recent.json', []);
  recent.unshift({
    ...article,
    hits: result.hits,
    priority: result.priority,
    aiMessage: ai?.message || null,
    status: ai?.status || null,
    detectedAt: Date.now(),
  });
  saveJSON('recent.json', recent.slice(0, 100));
}

// 본문을 보고 '나(김홍구)'가 글/본문에 직접 언급됐는지.
function mentionsMe(full) {
  const name = (process.env.MY_NAME || '').trim();
  const blob = `${full.subject}\n${full.head || ''}\n${full.text || ''}`;
  return !!(name && blob.includes(name));
}

// 내 부(3부) 티오프 시간대 (이 시간대의 추가/변동만 나와 관련). 기본: 3부=15시 이후.
function myPartHours() {
  const part = (process.env.MY_PART || '3').trim();
  const def = part === '1' ? [5, 10] : part === '2' ? [10, 15] : [15, 24];
  const s = Number(process.env.PART_START_HOUR ?? def[0]);
  const e = Number(process.env.PART_END_HOUR ?? def[1]);
  return [s, e];
}

// 내 부(3부)와 관련된 글인지 판단.
//  - 내 이름/내 부(3부) 언급 → 관련(true)
//  - 다른 부(1·2·4·5부)만 언급 → 무관(false)
//  - 티오프 시간이 있는데 전부 내 부 시간대 밖 → 무관(false)  (예: 아침 6:30 추가 = 1부)
//  - 그 외(부/시간 정보 없음 = 전체 공지 등) → 관련(true)
function partRelevant(full) {
  const part = (process.env.MY_PART || '').trim();
  if (!part) return true;
  const name = (process.env.MY_NAME || '').trim();
  const blob = `${full.subject}\n${full.head || ''}\n${full.text || ''}`;
  if (name && blob.includes(name)) return true;
  if (blob.includes(`${part}부`)) return true;

  const others = ['1부', '2부', '3부', '4부', '5부'].filter((p) => p !== `${part}부`);
  if (others.some((p) => blob.includes(p))) return false; // 다른 부만 언급

  // 티오프 시간대 판별 (HH:MM 들이 있는데 내 부 시간대가 하나도 없으면 무관)
  const [startH, endH] = myPartHours();
  const hours = [...blob.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => Number(m[1]));
  if (hours.length && !hours.some((h) => h >= startH && h < endH)) return false;

  return true; // 부/시간 단서 없음 → 전체 공지로 보고 통과
}

// 번호표 이미지에서 읽은 순번 명단을 baseline 에 저장 (이후 텍스트-only 변동 계산에 재사용).
function saveRoster(nameList) {
  const b = loadJSON('baseline.json', {}) || {};
  b.spareList = nameList;
  b.rosterAt = Date.now();
  saveJSON('baseline.json', b);
  console.log(`[명단 저장] 번호표에서 ${nameList.length}명 순번 확보`);
}

// 배치표 조 표시(dayStatus)로 role 을 코드가 확정 (Gemini role 오판 방지) + 메시지 정리.
function deriveScheduleRole(ai) {
  const name = (process.env.MY_NAME || '').trim();
  const part = (process.env.MY_PART || '').trim();
  const ds = ai.dayStatus || '';
  const d = ai.dateLabel || '';
  let role = ai.role || 'unknown';
  if (/휴무|휴가|병가/.test(ds)) role = 'off';
  else if (/\b54\b|54/.test(ds)) role = 'work';
  else if (new RegExp(`${part}부`).test(ds) || /2\s*[,、]\s*3/.test(ds)) role = 'spare';
  const message = role === 'off' ? `${name}님, ${d} 휴무입니다. 편히 쉬세요`
    : role === 'work' ? `${name}님, ${d} 근무입니다 (출근 확정)`
    : role === 'spare' ? `${name}님, ${d} ${part}부 스페어(대기)입니다. 근무 순번이 오면 바로 알려드릴게요`
    : (ai.message || `${name}님, ${d} 배치표 확인하세요`);
  return { ...ai, role, status: role, message };
}

// 배치표에서 뽑은 '오늘의 김홍구 기준점 + 3부 스페어 명단'을 저장.
function saveBaseline(full, ai) {
  const baseline = {
    date: ai.dateLabel || full.writeDate || '',
    name: (process.env.MY_NAME || '').trim(),
    part: ai.part || `${(process.env.MY_PART || '').trim()}부`,
    role: ai.role || ai.status || '',
    dayStatus: ai.dayStatus || '',
    spareList: Array.isArray(ai.spareList) ? ai.spareList : [],
    myIndex: ai.myIndex ?? null,
    articleId: full.id,
    savedAt: Date.now(),
  };
  saveJSON('baseline.json', baseline);
  console.log(`[기준점 저장] ${baseline.date} ${baseline.role} (스페어 ${baseline.myIndex ?? '-'}/${baseline.spareList.length}명)`);
}

// (구) 순번/티오프 계산 헬퍼(turnResult/computeTurnFromRoster/refineTurn)는 judge.mjs 로 대체되어 제거함.
//     이전 버전은 git tag backup-pre-redesign-2026-07-14 에 보존.

// (미사용) AI 결과 시그니처 — 현재 dedup 은 notifyForArticle 이 글번호 기반으로 직접 처리.
function stateSig(full, ai) {
  if (!ai || ai.found === false) return null;
  const d = ai.dateLabel || full.writeDate || '';
  if (ai.role) return `${full.id}|sch|${d}|${ai.role}|${ai.teeTime || ''}`;
  if (ai.status) return `${full.id}|turn|${d}|${ai.status}|${ai.remaining ?? ''}|${ai.cutoffName || ''}|${ai.teeTime || ''}`;
  return null;
}

const CHANGE_MENU_ID = process.env.CHANGE_MENU_ID || '13';     // 당일 변동사항
const SCHEDULE_MENU_ID = process.env.SCHEDULE_MENU_ID || '2';  // 배치 시간표(배치표)

// AI가 판단한 상태(status)에 맞춰 알림 제목을 정한다.
function titleForStatus(status) {
  switch (status) {
    case 'your_turn': return '🚨 지금 출근 순번!';
    case 'near':      return '🔔 곧 출근 순번!';
    case 'assigned':  return '✅ 오늘 근무 배정됨';
    case 'waiting':   return '🏌️ 3부 대기 현황';
    case 'work':      return '✅ 출근 확정!';
    case 'spare':     return '🏌️ 스페어(대기)';
    case 'off':       return '😴 근무 없음';
    default:          return '🏌️ 새 소식';
  }
}

// 피드에 저장할 항목 (관련·무관 모두 — 데이터는 절대 안 버린다).
function saveRecentV2(full, out) {
  const v = out.rawVerdict || {};
  // 같은 글(id)이 재처리되면 중복 행을 만들지 않고 최신 것으로 교체(맨 위로).
  const recent = freshFeed(loadJSON('recent.json', [])).filter((x) => x.id !== full.id);
  recent.unshift({
    id: full.id, subject: full.subject, writer: full.writer, url: full.url,
    menuId: full.menuId, menuName: full.menuName, writeDate: full.writeDate,
    aiMessage: out.relevant ? out.body : (v.summary || null),
    status: out.status || null,
    category: v.category || null,
    relevant: !!out.relevant,
    push: out.push,
    priority: out.push === 'high' ? 'high' : 'info',
    detectedAt: Date.now(),
  });
  saveJSON('recent.json', recent.slice(0, 100));
}

// 배치표 판정에서 '오늘 내 기준(부/역할/순번/티오프)'을 뽑아 저장 → 다음 글 판단 앵커.
function saveBaselineFromVerdict(full, v) {
  const s = v.myStatus;
  const role = (s === 'work' || s === 'assigned' || s === 'your_turn') ? 'work'
    : s === 'off' ? 'off' : (s === 'spare' || s === 'waiting') ? 'spare' : '';
  const baseline = {
    date: v.dateLabel || full.writeDate || '',
    name: (process.env.MY_NAME || '').trim(),
    part: `${(process.env.MY_PART || '').trim()}부`,
    role, myPosition: v.myPosition ?? null, teeTime: v.teeTime || '',
    articleId: full.id, savedAt: Date.now(),
  };
  saveJSON('baseline.json', baseline);
  console.log(`[기준표] ${baseline.date} ${role || '?'} pos=${baseline.myPosition ?? '-'} tee=${baseline.teeTime || '-'}`);
}

// 새 두뇌(judge)로 '오늘 상황판'에 비추어 판단 → 피드-우선 저장 → 상황판 갱신
// → 번복 감지 + 확신도 라우팅으로 푸시.  push: 'high' | 'check' | 'low'
async function notifyForArticle(full, result = {}, opts = {}) {
  const today = loadToday();

  // ★값싼 사전 필터: 명백히 남의 부/개인근태/비3부 시간이면 Gemini 호출 없이 피드에만.
  //  (429 할당량 절약 + 판독 실패 시 남의 부·휴무신청까지 알림 나가던 스팸 차단.)
  //  내 이름/3부 언급이 있으면 'other'가 아니므로 절대 여기서 안 버려짐(놓침 방지).
  if (!opts.force && cheapRelevance(`${full.subject || ''} ${full.text || ''}`) === 'other') {
    // 명백히 남의 일 → 앱에 아예 안 남김(피드 저장·푸시 없음). 서버 로그에만 흔적(오분류 시 복구용).
    console.log(`·  (사전필터: 남의 부/개인근태 → 무시·Gemini 생략) ${full.subject}`);
    return { pushed: false, push: 'low', relevant: false, title: '', body: full.subject || '' };
  }

  const out = await judge(full, today);        // 오늘 상황을 맥락으로 판단
  const v = out.rawVerdict;
  let title = out.title, body = out.body;

  // 관련 있는 소식만 피드에 기록(무관한 건 앱에 안 남김 — 사용자 요청). 무관은 로그로만 흔적.
  if (out.relevant) saveRecentV2(full, out);
  else console.log(`·  (무관 → 앱에 안 남김) ${full.subject} — ${v?.category || ''}`);

  // 관련 글이면 상황판에 병합 + 번복(변경) 감지.
  let change = { reversal: false, material: false, message: '' };
  if (out.relevant && v) {
    const merged = applyVerdict(today, v, full);
    saveToday(merged.next);
    change = merged.change;
    // 일일 근무 일지에 그날 '최종 상태'(근무/스페어/휴무) 기록 — 마지막 갱신이 그날 확정.
    const jIso = worklog.labelToISO(v.dateLabel);
    if (jIso) journal.recordDayStatus(jIso, { status: merged.next.status, teeTime: merged.next.teeTime,
      course: merged.next.course, myPosition: merged.next.myPosition, cutoffName: merged.next.cutoffName });
    if (change.reversal) {
      // 이전 예측이 뒤집힘 → 강조 알림으로 승격.
      title = '⚠️ 변경됐어요!';
      body = `${change.message}\n${out.body}`;
      out.push = 'high';
    } else if (Number(v.teamCount) > 0) {
      // 팀 수 소식인데 상태 전환은 없음(여전히 스페어) → 접근 현황만 가볍게(먼 건 피드만).
      const myp = Number(merged.next.myPosition) || 0;
      const tc = Number(v.teamCount);
      if (myp && myp > tc) {
        const ahead = Math.max(0, myp - tc - 1);
        title = '🏌️ 3부 대기 현황';
        body = `현재 ${merged.next.part || '3부'} ${tc}팀 · 내 순번 ${myp}번 — 내 앞 ${ahead}명 남았어요.`;
        out.push = ahead <= 2 ? 'check' : 'low';
      }
    }
  }

  // 근무 확정(배정/내 차례/근무)이면 세무용 근무일지에 그날을 자동 기록(임시 → 앱에서 확인).
  if (out.relevant && v && ['assigned', 'work', 'your_turn'].includes(out.status)) {
    const iso = worklog.labelToISO(v.dateLabel) || new Date().toISOString().slice(0, 10);
    worklog.recordWorkDay(iso, { teeTime: v.teeTime || '', course: v.course || '', articleId: full.id });
  }

  const ret = { push: out.push, title, body, status: out.status, relevant: out.relevant,
    category: v?.category || null, change: change.message || null, reversal: change.reversal };

  // 라우팅: 무관/가배치 → 피드에만, 푸시 안 함.
  if (out.push === 'low') {
    const why = v?._rosterDrop ? ` [명단필터: ${v._rosterDrop}]` : '';
    console.log(`·  (피드만) ${full.subject} — ${v?.category || ''} (relevant=${out.relevant})${why}`);
    return { pushed: false, ...ret };
  }

  // 중복 푸시 방지(글번호+상태 기반, 번복이면 항상 통과). opts.force 면 건너뜀.
  if (!opts.force && !change.reversal) {
    const sig = `${full.id}|${out.status}|${v?.teeTime || ''}`;
    const last = loadJSON('laststate.json', {});
    if (last.sig === sig) { console.log(`·  (직전과 동일 → 무푸시) ${full.subject}`); return { pushed: false, ...ret }; }
    saveJSON('laststate.json', { sig, at: Date.now(), subject: full.subject });
  }

  await broadcast({ title, body, url: full.url });
  console.log(`🔔 [${out.push}${change.reversal ? '/번복' : ''}] ${title} | ${String(body).replace(/\n/g, ' ')}`);
  return { pushed: true, ...ret };
}

// 근무일 차량기록 리마인더: 저녁(기본 22시) 이후, 기록 비어있는 근무일이 있으면 상기 푸시.
async function checkWorklogReminders() {
  try {
    const hour = new Date().getHours();
    if (hour < Number(process.env.REMIND_HOUR ?? 22)) return;
    for (const day of worklog.dueReminders()) {
      const md = `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))}`;
      await broadcast({ title: '🚗 근무 기록 잊지 마세요', body: `${md} 근무하셨나요? 계기판 사진(집출발·직장도착·집복귀)을 앱에 등록해주세요.`, url: '/' });
      worklog.markReminded(day.date);
      console.log(`[리마인더] ${day.date} 차량기록 상기 발송`);
    }
  } catch (e) { console.error('리마인더 오류:', e.message); }
}
setInterval(checkWorklogReminders, 60 * 60 * 1000); // 매시간 체크(리마인드 시각 이후에만 발송)

// 카트 점검 리마인더: 오늘 근무일이고, 라운드가 끝날 무렵(티오프+라운드시간)인데
//  종료 점검(체크리스트)이 아직 미완이면 1회 상기. 고객 소지품 두고 오는 사고 방지.
async function checkCartReminders() {
  try {
    const t = loadToday();
    if (!t || !['assigned', 'work', 'your_turn'].includes(t.status)) return;
    const tISO = worklog.labelToISO(t.date);
    if (!tISO || tISO !== todayISOKST()) return; // 오늘 근무만
    const m = String(t.teeTime || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return;
    const teeMin = Number(m[1]) * 60 + Number(m[2]);
    const roundMin = Number(process.env.CART_ROUND_HOURS ?? 2.5) * 60;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin < teeMin + roundMin) return;          // 아직 라운드 중 → 나중에
    if (!cartcheck.needsExitCheck(tISO)) return;      // 이미 점검 완료 → 조용
    const rec = cartcheck.getDay(tISO);
    if (rec.remindedAt && Date.now() - rec.remindedAt < 6 * 3600 * 1000) return; // 6h내 재알림 억제
    await broadcast({ title: '🛒 카트 정리 점검하세요', body: '반납 전 보관대·컵홀더 등 소지품을 훑고, 빈 카트 사진을 남겨두세요. (고객 분실물 방지)', url: '/#cart' });
    cartcheck.markReminded(tISO);
    console.log(`[카트리마인더] ${tISO} 종료 점검 상기 발송`);
  } catch (e) { console.error('카트 리마인더 오류:', e.message); }
}
setInterval(checkCartReminders, 20 * 60 * 1000); // 20분마다 체크

startCrawler({
  onMatch: async (article, result) => {
    try {
      const full = await fetchArticle(article.id);
      full.writer = full.writer || article.writer || '';
      full.writeDate = full.writeDate || article.writeDate || '';
      await notifyForArticle(full, result);
    } catch (e) {
      console.error('본문 분석 실패, 제목으로 알림:', e.message);
      saveRecent(article, result, null);
      const title = result.priority === 'high' ? '🔔 일정 소식' : '🏌️ 새 소식';
      await broadcast({ title, body: article.subject, url: article.url });
    }
  },
  onComment: async (article, prevCount, newCount) => {
    // 일정글에 달린 새 댓글을 '텍스트 글'처럼 판단(변동이 댓글로도 오므로).
    try {
      const full = await fetchArticle(article.id);
      const added = Math.max(1, newCount - prevCount);
      const newComments = (full.comments || []).slice(-added);
      for (let i = 0; i < newComments.length; i++) {
        const c = newComments[i];
        if (!c.content || !c.content.trim()) continue;
        const pseudo = {
          id: `${full.id}#c${newCount - added + i + 1}`,
          subject: `[댓글] ${full.subject}`,
          text: c.content, writer: c.nick || full.writer,
          menuId: full.menuId, menuName: full.menuName,
          images: [], writeDate: full.writeDate, url: full.url,
        };
        await notifyForArticle(pseudo, {}, {});
      }
    } catch (e) {
      console.error('댓글 분석 실패:', e.message);
    }
  },
  onCafeError: async () => {
    await broadcast({
      title: '⚠️ 네이버 쿠키 만료',
      body: '카페 감시가 멈췄어요. .env 의 쿠키를 새로 갱신해주세요.',
      url: '/',
    });
  },
});
