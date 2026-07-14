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
import { judge, commuteInfo } from './judge.mjs';
import { loadToday, saveToday, applyVerdict, statusKo } from './today.mjs';
import { loadJSON, saveJSON } from './store.mjs';

initPush();

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT_DIR, 'public')));

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

// 앱 화면에 보여줄 최근 감지 목록
app.get('/api/recent', (req, res) => {
  res.json(loadJSON('recent.json', []));
});

// 테스트용: 지금 바로 내 폰으로 알림 한 번 쏴보기
app.post('/api/test', async (req, res) => {
  await broadcast({ title: '🏌️ 테스트 알림', body: '알림이 정상 작동합니다!', url: '/' });
  res.json({ ok: true });
});

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

// 오늘의 상황판 조회 (온디맨드 요약 / 디버깅).
app.get('/api/today', (req, res) => {
  const t = loadToday();
  if (!t) return res.json({ ok: true, empty: true, message: '아직 오늘 파악된 상황이 없어요.' });
  const p = [];
  if (t.myPosition) p.push(`순번 ${t.myPosition}번`);
  p.push(statusKo(t.status));
  if (t.teeTime) p.push(`티오프 ${t.teeTime}${t.course ? `(${t.course})` : ''}`);
  if (t.cutoffName) p.push(`${t.cutoffName}님까지 확정`);
  const commute = t.teeTime ? commuteInfo(t.teeTime) : null;
  res.json({ ok: true, date: t.date, summary: `${t.name} — ${p.join(' · ')}`, state: t, commute });
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
  const recent = loadJSON('recent.json', []).filter((x) => x.id !== full.id);
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
  const out = await judge(full, today);        // 오늘 상황을 맥락으로 판단
  const v = out.rawVerdict;
  let title = out.title, body = out.body;

  // 피드-우선: 관련 여부와 무관하게 항상 피드에 기록(놓침 구조적 불가).
  saveRecentV2(full, out);

  // 관련 글이면 상황판에 병합 + 번복(변경) 감지.
  let change = { reversal: false, material: false, message: '' };
  if (out.relevant && v) {
    const merged = applyVerdict(today, v, full);
    saveToday(merged.next);
    change = merged.change;
    if (change.reversal) {
      // 이전 예측이 뒤집힘 → 강조 알림으로 승격.
      title = '⚠️ 변경됐어요!';
      body = `${change.message}\n${out.body}`;
      out.push = 'high';
    }
  }

  const ret = { push: out.push, title, body, status: out.status, relevant: out.relevant,
    category: v?.category || null, change: change.message || null, reversal: change.reversal };

  // 라우팅: 무관/가배치 → 피드에만, 푸시 안 함.
  if (out.push === 'low') {
    console.log(`·  (피드만) ${full.subject} — ${v?.category || ''} (relevant=${out.relevant})`);
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
