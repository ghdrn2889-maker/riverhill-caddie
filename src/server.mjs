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
import { judge, interpretForMember, commuteInfo, scheduleHint, cheapRelevance } from './judge.mjs';
import { loadToday, saveToday, applyVerdict, statusKo } from './today.mjs';
import * as worklog from './worklog.mjs';
import * as cartcheck from './cartcheck.mjs';
import * as weather from './weather.mjs';
import * as journal from './journal.mjs';
import * as cheer from './cheer.mjs';
import { loadJSON, saveJSON, loadUserJSON, saveUserJSON, migratePrimaryToUserStore, appendJSONL } from './store.mjs';
import { seedPrimaryUser, getProfile, setProfile, activeMembers, boardNameTaken, adminUserIds, allUserIds, setUserStatus, listMembersForAdmin } from './users.mjs';
import { attachUser, requireAuth, requireAdmin, beginNaverLogin, naverCallback, beginGoogleLogin, googleCallback, logout, soloMode, authConfigured, naverConfigured, googleConfigured } from './auth.mjs';

// 피드는 흘려보낸다: 오래된 소식은 자동 정리(기본 36시간 = 어젯밤~오늘).
const FEED_KEEP_MS = Number(process.env.FEED_KEEP_HOURS ?? 36) * 3600 * 1000;
const freshFeed = (arr) => (arr || []).filter((x) => (Date.now() - (x.detectedAt || 0)) < FEED_KEEP_MS);

seedPrimaryUser();               // 1번 회원(김홍구) 보장 — 회원제 도입 전 '나'를 그대로 이관
migratePrimaryToUserStore();     // 전역 데이터(today/worklog/cart/journal/photos) → data/users/1/ (crawler 시작 전)
initPush();                      // VAPID + subscriptions.json → SQLite 이관
console.log(`🔐 인증 모드: ${soloMode() ? '솔로(로그인 없이 1번 회원)' : '회원제(네이버 로그인)'}${authConfigured() ? '' : ' · 네이버 미설정'}`);

const app = express();
app.use(express.json({ limit: '12mb' }));         // 계기판 사진(base64) 업로드 허용
app.use(express.urlencoded({ extended: true })); // 폼 전송(MacroDroid 등) 지원
app.use(attachUser);                              // req.user 채움(세션 쿠키 or 솔로 폴백)
app.use(express.static(path.join(ROOT_DIR, 'public')));

// ── 인증(네이버 로그인) ──
app.get('/api/auth/naver', beginNaverLogin);
app.get('/api/auth/naver/callback', naverCallback);
app.get('/api/auth/google', beginGoogleLogin);
app.get('/api/auth/google/callback', googleCallback);
app.post('/api/logout', logout);
// 현재 로그인한 회원 + 프로필 (앱 부팅 시 조회).
app.get('/api/me', (req, res) => {
  const base = { ok: true, solo: soloMode(), naverEnabled: naverConfigured(), googleEnabled: googleConfigured() };
  if (!req.user) return res.json({ ...base, authed: false });
  const prof = getProfile(req.user.id) || {};
  const needsOnboarding = !prof.board_name;
  const pending = req.user.status !== 'active'; // 승인 대기/차단 → 프론트가 '승인 대기' 화면 표시
  res.json({ ...base, authed: true, pending, status: req.user.status,
    user: { id: req.user.id, role: req.user.role },
    profile: { boardName: prof.board_name, part: prof.part, homeKm: prof.home_km, commuteMin: prof.commute_min, carNo: prof.car_no,
      workplace: prof.workplace, kmPerL: prof.km_per_l, stationId: prof.station_id, fuelEnabled: !!prof.fuel_enabled },
    needsOnboarding });
});
// 프로필 저장(온보딩·수정). 로그인 필수(솔로 모드에선 1번 회원).
app.post('/api/profile', requireAuth, (req, res) => {
  const b = req.body || {};
  const boardName = String(b.boardName || '').trim();
  const part = ['1', '2', '3'].includes(String(b.part)) ? String(b.part) : '3';
  if (!boardName) return res.status(400).json({ ok: false, error: '배치표에 뜨는 실명을 입력해주세요.' });
  // (이름+부) 유일 강제 — 같은 캐디가 계정 2개로 알림 2번 받는 중복 차단.
  if (boardNameTaken(boardName, part, req.user.id)) {
    return res.status(409).json({ ok: false,
      error: `이미 등록된 이름이에요 (${boardName}·${part}부). 본인 계정이라면 그 계정으로 로그인하세요. 동명이인이면 관리자에게 문의해주세요.` });
  }
  const prof = setProfile(req.user.id, {
    board_name: boardName, part, home_km: b.homeKm, commute_min: b.commuteMin, car_no: b.carNo,
  });
  // 가입/이름 변경 직후 현재 배치표를 즉시 소급 반영(백대기 중간 가입 등으로 상황판이 비는 빈틈 방지).
  backfillFromLastBoard(req.user.id, { name: prof.board_name, part: String(prof.part || '3'), commuteMin: Number(prof.commute_min) });
  res.json({ ok: true, profile: { boardName: prof.board_name, part: prof.part, homeKm: prof.home_km, commuteMin: prof.commute_min, carNo: prof.car_no } });
});

// 기기·알림 상태 텔레메트리 — iOS/안드 비율·설치·권한·구독을 회원별로 기록(최신 상태 유지).
app.post('/api/telemetry', requireAuth, (req, res) => {
  const b = req.body || {};
  const rec = loadJSON('telemetry.json', {}) || {};
  const prof = getProfile(req.user.id) || {};
  rec[req.user.id] = {
    name: prof.board_name || '', part: prof.part || '',
    platform: String(b.platform || '').slice(0, 16),
    standalone: !!b.standalone,
    perm: String(b.perm || '').slice(0, 16),
    subscribed: !!b.subscribed,
    browser: String(b.browser || '').slice(0, 16),
    ua: String(b.ua || '').slice(0, 200),
    updatedAt: Date.now(),
  };
  saveJSON('telemetry.json', rec);
  res.json({ ok: true });
});

// ── API 인증 게이트 ──
//  회원제(SOLO_MODE=0)에서 비로그인 요청이 데이터에 접근하지 못하게 차단(남의 데이터 노출 방지).
//  ★솔로 모드에선 req.user 가 항상 1번 회원이라 게이트는 열려 있음 → 지금 동작 무변화.
//  공개 엔드포인트(설정키·헬스·카톡 인그레스·인증 자체)는 통과.
const OPEN_API = ['/config', '/health', '/ingest', '/simulate', '/auth', '/me', '/logout'];
app.use('/api', (req, res, next) => {
  const p = req.path;
  if (OPEN_API.some((o) => p === o || p.startsWith(o + '/'))) return next();
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다', loginUrl: '/api/auth/google' });
  // ★가입 승인 대기(pending)·차단(disabled) 회원은 데이터·기능 엔드포인트 전면 차단(외부인 배제).
  //  온보딩용 /me·/profile 은 이 게이트 앞(위)에 등록돼 있어 통과 — 이름 입력·상태 조회는 가능.
  if (req.user.status !== 'active') return res.status(403).json({ error: '가입 승인 대기 중입니다. 관리자 확인 후 이용할 수 있어요.', pending: true });
  next();
});

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
  addSubscription(req.body, req.user?.id || 1);
  res.json({ ok: true });
});

// 앱 화면에 보여줄 최근 감지 목록 (오래된 소식은 자동 제외 — 항상 최근만 깔끔하게).
app.get('/api/recent', (req, res) => {
  res.json(freshFeed(loadUserJSON(req.user?.id || 1, 'recent.json', [])));
});

// 일일 근무 일지 (근무/스페어/휴무 하루하루 기록): ?year=2026&month=7
app.get('/api/journal', (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  const uid = req.user?.id || 1;
  res.json({ ok: true, days: journal.listJournal({ year, month }, uid), summary: journal.summary({ year, month }, uid) });
});

// 관리자 전용 알림 발송 — role='admin' 계정들의 기기에만. (네이버 쿠키 만료·테스트 등 운영성 알림)
//  일반 회원(테스터 등)에게는 절대 가지 않는다. 관리자 계정이 없으면 조용히 아무것도 안 보냄.
async function broadcastAdmins(msg) {
  for (const id of adminUserIds()) await broadcast(msg, id);
}

// 테스트용(관리자 전용): 관리자 폰으로 알림 한 번 쏴보기
app.post('/api/test', requireAdmin, async (req, res) => {
  await broadcastAdmins({ title: '🏌️ 테스트 알림', body: '알림이 정상 작동합니다!', url: '/' });
  res.json({ ok: true });
});

// ── 회원 관리(관리자 전용) — 외부인 배제: 신규 가입은 pending, 관리자가 승인해야 active ──
app.get('/api/admin/members', requireAdmin, (req, res) => {
  res.json({ ok: true, members: listMembersForAdmin() });
});
app.post('/api/admin/user-status', requireAdmin, (req, res) => {
  const id = Number(req.body?.id);
  const status = String(req.body?.status || '');
  if (!id || !['active', 'pending', 'disabled'].includes(status)) return res.status(400).json({ ok: false, error: 'id·status(active|pending|disabled) 필요' });
  if (id === req.user.id) return res.status(400).json({ ok: false, error: '본인 계정 상태는 바꿀 수 없어요.' });
  const u = setUserStatus(id, status);
  if (!u) return res.status(404).json({ ok: false, error: '회원을 찾을 수 없어요.' });
  console.log(`👤 [admin] 회원 #${id} 상태 → ${status} (by #${req.user.id})`);
  res.json({ ok: true, id, status });
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
  // ★잡담/사진/광고 사전 필터: 일정 단서가 전혀 없으면 Gemini 호출 없이 '완전 무시'.
  //  (개인정보 보호: 카톡 잡담·개인 메시지·광고는 소식 피드에 남기지 않는다. Gemini도 생략)
  if (!scheduleHint(text)) {
    console.log(`💬 [ingest] 일정 단서 없음 → 무시(피드에도 안 남김): "${text.slice(0, 25)}"`);
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
  // 인증: 로그인 세션(관리자) 또는 INGEST_TOKEN(자동화·관리자 재처리 트리거). /api/ingest와 동일 보안.
  const token = req.get('x-token') || req.query.token || req.body?.token;
  if (!req.user && process.env.INGEST_TOKEN && token !== process.env.INGEST_TOKEN) {
    return res.status(401).json({ error: '인증 실패(로그인 또는 토큰 필요)' });
  }
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
  const t = loadToday(req.user?.id || 1);
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
  const prof = getProfile(req.user?.id || 1) || {};
  const commute = t.teeTime ? commuteInfo(t.teeTime, prof.commute_min) : null;
  // 근무 대상일이 며칠 뒤인지(0=오늘, 1=내일…). 저녁에 뜬 '내일 배치표'를 오늘로 오인하지 않게.
  let dayOffset = 0;
  if (tISO) dayOffset = Math.round((Date.parse(tISO) - Date.parse(todayISOKST())) / 86400000);
  res.json({ ok: true, date: t.date, dayOffset, summary: `${t.name} — ${p.join(' · ')}`, state: t, commute });
});

// 골프장 날씨 — 근무 확정이면 티오프~+6시간, 아니면 낮(9~18시) 예보. 회원의 상황판(티오프)에 맞춰 창을 잡는다.
app.get('/api/weather', async (req, res) => {
  try {
    const uid = req.user?.id || 1;
    const wx = await weather.getHourly();
    const t = loadToday(uid);
    const todayI = todayISOKST();
    const tISO = t && worklog.labelToISO(t.date);
    const target = (tISO && tISO >= todayI) ? tISO : todayI;               // 오늘~미래 배치일이면 그 날
    const teeH = (String(t?.teeTime || '').match(/(\d{1,2}):/) || [])[1];
    const confirmed = !!(t && ['assigned', 'work', 'your_turn'].includes(t.status) && teeH != null && tISO === target);
    let startH, endH, label;
    if (confirmed) {
      startH = Number(teeH); endH = Math.min(23, startH + 6);
      label = `라운드 날씨 (${t.teeTime} ~ +6시간)`;
    } else {
      startH = 9; endH = 18;
      label = (target === todayI ? '오늘' : (tISO === worklog.labelToISO(t?.date) ? t.date : '해당일')) + ' 낮 날씨';
    }
    const full = wx.hours.filter((h) => h.date === target && h.hour >= startH && h.hour <= endH);
    const hours = weather.windowFor(wx, target, startH, endH, 8);
    // 대시보드 배경용 '현재 날씨'(지금 이 시각 기준). 서버는 KST.
    const nowH = new Date().getHours();
    const cur = wx.hours.find((h) => h.date === todayI && h.hour === nowH)
      || wx.hours.find((h) => h.date === todayI && h.hour >= nowH)
      || wx.hours.find((h) => h.date === todayI);
    const current = cur ? { code: cur.code, temp: cur.temp, pop: cur.pop, day: cur.day } : null;
    res.json({ ok: true, updatedAt: wx.updatedAt, course: '리버힐 · 안동', date: target, label,
      confirmed, current, hours, summary: weather.summarize(full) });
  } catch (e) {
    console.error('날씨 조회 오류:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// 응원 한 줄 — 지금 회원 상황에 맞춘 존댓말 한마디 풀(장면 바뀔 때만 생성·캐시). 앱 열 때 클라가 그중 하나를 표시.
app.get('/api/cheer', async (req, res) => {
  try {
    const uid = req.user?.id || 1;
    const out = await cheer.getCheer(uid);
    res.json({ ok: true, scene: out.scene, key: out.key, lines: out.lines });
  } catch (e) {
    console.error('응원 생성 오류:', e.message);
    res.json({ ok: false, lines: [] });
  }
});

// ── 근무일지/세무 증빙 ──────────────────────────────────
// 조회: ?year=2026&month=7 (없으면 전체). { days, summary, settings }
app.get('/api/worklog', (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  const uid = req.user?.id || 1;
  res.json({ ok: true, days: worklog.listDays({ year, month }, uid),
    summary: worklog.summary({ year, month }, uid), settings: worklog.getSettings(uid) });
});
// 실제 근무 여부 확인: { date:'YYYY-MM-DD', worked:true|false|null }
app.post('/api/worklog/confirm', (req, res) => {
  const { date, worked } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date 필요' });
  res.json({ ok: true, day: worklog.confirmWorkDay(date, worked, req.user?.id || 1) });
});
// 수동 추가: { date, teeTime?, course?, note? }
app.post('/api/worklog/add', (req, res) => {
  const { date, teeTime, course, note } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date 필요 (YYYY-MM-DD)' });
  res.json({ ok: true, day: worklog.addWorkDay(date, { teeTime, course, note }, req.user?.id || 1) });
});
// 설정: { homeGolfKmOneway?, workplace?, fuelEnabled?, kmPerL?, fuelPrice? }
app.post('/api/worklog/settings', (req, res) => {
  res.json({ ok: true, settings: worklog.setSettings(req.body || {}, req.user?.id || 1) });
});
// 계기판 사진 업로드: { date, leg:'start|work|home', image:'data:image/jpeg;base64,...' }
app.post('/api/worklog/photo', (req, res) => {
  const { date, leg, image } = req.body || {};
  if (!date || !leg || !image) return res.status(400).json({ error: 'date, leg, image 필요' });
  const day = worklog.savePhoto(date, leg, image, req.user?.id || 1);
  if (!day) return res.status(400).json({ error: '잘못된 이미지 형식' });
  res.json({ ok: true, day });
});
// 계기판 숫자(선택): { date, odo:{start,work,home} }
app.post('/api/worklog/odo', (req, res) => {
  const { date, odo } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date 필요' });
  res.json({ ok: true, day: worklog.saveOdo(date, odo || {}, req.user?.id || 1) });
});
// 계기판 사진 보기: /api/worklog/photo/2026-07-14_start.jpg
app.get('/api/worklog/photo/:fname', (req, res) => {
  const fname = req.params.fname;
  if (!/^[\w.-]+\.(jpg|png)$/.test(fname)) return res.status(400).end();
  res.sendFile(worklog.photoPath(fname, req.user?.id || 1), (err) => { if (err) res.status(404).end(); });
});
// CSV 내보내기(차량운행일지): ?year=2026 (엑셀/세무사 제출용)
app.get('/api/worklog/export.csv', (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  const csv = worklog.toCSV({ year, month }, req.user?.id || 1);
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
  res.send(worklog.reportHTML({ year, month }, req.user?.id || 1));
});

// ── 카트 점검 ─────────────────────────────────────────
//  근무일마다 카트 정리 증거(시작사진·종료체크·빈카트사진·발견물)를 남긴다.
//  date 미지정이면 KST 오늘.
app.get('/api/cartcheck', (req, res) => {
  const uid = req.user?.id || 1;
  const date = req.query.date && cartcheck.getDay(req.query.date, uid) ? req.query.date : todayISOKST();
  const t = loadToday(uid);
  const tISO = t && worklog.labelToISO(t.date);
  const isWorkToday = !!(t && tISO === date && ['assigned', 'work', 'your_turn'].includes(t.status));
  res.json({ ok: true, date, items: cartcheck.getItems(uid), day: cartcheck.getDay(date, uid),
    work: { isWorkToday, teeTime: (isWorkToday && t.teeTime) || '', course: (isWorkToday && t.course) || '', cartNo: (t && tISO === date && t.cartNo) || '' } });
});
// 지난 카트 점검 기록 목록(최근 2주치) — 날짜를 넘겨보며 열람.
app.get('/api/cartcheck/history', (req, res) => {
  const uid = req.user?.id || 1;
  res.json({ ok: true, today: todayISOKST(), days: cartcheck.recentDays(uid, 14, todayISOKST()) });
});
// 유예기간(보관일수) 내 기록 요약 — 상단 날짜 선택바용. 다른 달은 어차피 삭제되므로 최근 N일만.
app.get('/api/cartcheck/recent', (req, res) => {
  const uid = req.user?.id || 1;
  const retain = ROUNDCHECK_RETAIN_DAYS;
  res.json({ ok: true, today: todayISOKST(), retainDays: retain, days: cartcheck.recordsSince(uid, isoDaysAgo(retain - 1)) });
});
// 체크리스트 항목 편집(추가/이름변경/삭제/복원) — 개인 목록으로 저장.
app.post('/api/cartcheck/items/add', (req, res) => {
  const label = (req.body || {}).label;
  if (!label) return res.status(400).json({ error: 'label 필요' });
  res.json({ ok: true, items: cartcheck.addItem(label, req.user?.id || 1) });
});
app.post('/api/cartcheck/items/rename', (req, res) => {
  const { key, label } = req.body || {};
  if (!key || !label) return res.status(400).json({ error: 'key, label 필요' });
  res.json({ ok: true, items: cartcheck.renameItem(key, label, req.user?.id || 1) });
});
app.post('/api/cartcheck/items/remove', (req, res) => {
  const key = (req.body || {}).key;
  if (!key) return res.status(400).json({ error: 'key 필요' });
  res.json({ ok: true, items: cartcheck.removeItem(key, req.user?.id || 1) });
});
app.post('/api/cartcheck/items/reset', (req, res) => {
  res.json({ ok: true, items: cartcheck.resetItems(req.user?.id || 1) });
});
app.post('/api/cartcheck/items/recommend', (req, res) => {
  res.json({ ok: true, items: cartcheck.recommendItems(req.user?.id || 1) });
});
app.post('/api/cartcheck/cart', (req, res) => {
  const { date, cartNo } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date 필요' });
  res.json({ ok: true, day: cartcheck.setCartNo(date, cartNo, req.user?.id || 1) });
});
app.post('/api/cartcheck/check', (req, res) => {
  const { date, key, done } = req.body || {};
  if (!date || !key) return res.status(400).json({ error: 'date, key 필요' });
  res.json({ ok: true, day: cartcheck.toggleCheck(date, key, !!done, req.user?.id || 1) });
});
app.post('/api/cartcheck/photo', (req, res) => {
  const { date, leg, image } = req.body || {};
  if (!date || !leg || !image) return res.status(400).json({ error: 'date, leg, image 필요' });
  const day = cartcheck.savePhoto(date, leg, image, req.user?.id || 1);
  if (!day) return res.status(400).json({ error: '잘못된 이미지/구분' });
  res.json({ ok: true, day });
});
app.post('/api/cartcheck/photo/remove', (req, res) => {
  const { date, leg, fname } = req.body || {};
  if (!date || !leg) return res.status(400).json({ error: 'date, leg 필요' });
  res.json({ ok: true, day: cartcheck.removePhoto(date, leg, fname, req.user?.id || 1) });
});
app.get('/api/cartcheck/photo/:fname', (req, res) => {
  const fname = req.params.fname;
  if (!/^[\w.-]+\.(jpg|png)$/.test(fname)) return res.status(400).end();
  res.sendFile(cartcheck.photoPath(fname, req.user?.id || 1), (err) => { if (err) res.status(404).end(); });
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
    : role === 'spare' ? `${name}님, ${d} ${part}부 스페어(대기)입니다.`
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

// 피드에 저장할 항목 (관련·무관 모두 — 데이터는 절대 안 버린다). 회원별 피드.
function saveRecentV2(full, out, userId = 1) {
  const v = out.rawVerdict || {};
  // 같은 글(id)이 재처리되면 중복 행을 만들지 않고 최신 것으로 교체(맨 위로).
  const recent = freshFeed(loadUserJSON(userId, 'recent.json', [])).filter((x) => x.id !== full.id);
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
  saveUserJSON(userId, 'recent.json', recent.slice(0, 100));
}

// 카톡(단톡방 포워더)發 글인가? — 소식 피드에서 원문·방이름을 숨기고 '배치표 변동'으로만 표기하기 위한 판별.
const isKakaoSource = (full) => String(full?.id || '').startsWith('ingest-') || full?.menuName === '카톡';

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
const envMember = () => {
  const p = getProfile(1) || {};
  return {
    name: (process.env.MY_NAME || '김홍구').trim(),
    part: (process.env.MY_PART || '3').trim(),
    commuteMin: Number.isFinite(Number(p.commute_min)) ? Number(p.commute_min) : Number(process.env.COMMUTE_MIN ?? 60),
  };
};

// ── 배치표 '조용한 수정'(같은 글의 이미지만 교체) 감지 ─────────────────
//  네이버는 글을 수정해도 목록 맨 위로 올리지 않아, 새 글만 보는 크롤러는 못 본다.
//  → 현재 배치표 글을 주기적으로 다시 읽어, 첨부 이미지가 바뀌면 재판독.
//    회원 본인의 티오프가 바뀌었으면 ⚠️ 강한 알림(변경됐어요!)이 그대로 나간다.
//    (이미지가 그대로면 Gemini를 호출하지 않으므로 비용 낭비 없음)
const BOARD_WATCH_FILE = 'boardwatch.json';
let boardWatch = loadJSON(BOARD_WATCH_FILE, null); // { id, fp, dateLabel, at }
const imgFingerprint = (full) => (full.images || []).map((u) => String(u).split('?')[0]).join('|');
function rememberBoard(full, out) {
  const v = out && out.rawVerdict;
  const isBoardGrid = (full.images || []).length && v && Array.isArray(v.teeGrid) && v.teeGrid.length;
  if (!isBoardGrid) return; // 티오프표(teeGrid)를 실제로 읽은 '본배치표'만 감시 대상
  boardWatch = { id: String(full.id), fp: imgFingerprint(full), dateLabel: v.dateLabel || '', at: Date.now() };
  saveJSON(BOARD_WATCH_FILE, boardWatch);
  // ★가입 소급용: 이 배치표의 판독결과(rawVerdict)+원문을 저장 → 중간 가입 회원이 Gemini 재호출 없이 반영받게.
  saveJSON('lastboard.json', { id: String(full.id), dateLabel: v.dateLabel || '', article: full, rawVerdict: v, at: Date.now() });
}

// 가입/프로필 저장 직후: 현재 감시 중인 최신 배치표를 이 회원 기준으로 즉시 소급 반영.
//  (백대기 도중 가입 등, 배치표 처리가 끝난 뒤 들어온 회원의 상황판이 비어보이는 빈틈 방지 — Gemini 재호출 없음)
function backfillFromLastBoard(userId, member) {
  try {
    const lb = loadJSON('lastboard.json', null);
    if (!lb || !lb.rawVerdict || !lb.article) return false;
    if (Date.now() - (lb.at || 0) > 18 * 3600 * 1000) return false; // 하루 지난 배치표는 소급 안 함
    const mout = interpretForMember(lb.article, lb.rawVerdict, member, loadToday(userId));
    const v = mout.rawVerdict;
    if (!mout.relevant || !v) return false;
    const merged = applyVerdict(loadToday(userId), v, lb.article);
    saveToday(merged.next, userId);
    console.log(`↩️  회원 ${userId}(${member.name}) 가입 소급: 최신 배치표 #${lb.id} 반영`);
    return true;
  } catch (e) { console.error('가입 소급 오류:', e.message); return false; }
}

// 크롤러 진입점: board를 ★한 번만★ 읽고(Gemini 1회), 회원마다 코드로 재해석해 각자 처리.
async function notifyForArticle(full, result = {}, opts = {}) {
  const primary = envMember(); // 1번 회원(김홍구)

  // ★값싼 사전 필터(1번 회원 기준): 명백히 남의 부/개인근태면 Gemini 호출 없이 종료(할당량 절약).
  //  (현재 테스터는 3부라 1번 회원의 3부 board가 곧 그들 board — 부가 늘면 '어느 회원에게든 관련' 기준으로 확장)
  if (!opts.force && cheapRelevance(`${full.subject || ''} ${full.text || ''}`, primary) === 'other') {
    console.log(`·  (사전필터: 남의 부/개인근태 → 무시·Gemini 생략) ${full.subject}`);
    return { pushed: false, push: 'low', relevant: false, title: '', body: full.subject || '' };
  }

  // ★board 1회 읽기(비싼 부분) — 1번 회원 기준. 이 rawVerdict를 다른 회원이 재사용.
  const out = await judge(full, loadToday(1), primary);

  // 1번 회원(김홍구) 처리 — 기존과 동일한 결과.
  const primaryRet = await processForMember(1, primary, out, full, opts);

  // 다른 활성 회원들 — Gemini 재호출 없이 공유 rawVerdict를 코드로 재해석.
  for (const m of activeMembers()) {
    if (m.id === 1) continue;
    try {
      const member = { name: m.board_name, part: String(m.part || '3'), commuteMin: Number(m.commute_min) };
      const mout = interpretForMember(full, out.rawVerdict, member, loadToday(m.id));
      await processForMember(m.id, member, mout, full, opts);
    } catch (e) { console.error(`[회원 ${m.id} 판독 처리 오류]`, e.message); }
  }
  rememberBoard(full, out); // 이 글이 본배치표면, 이후 '조용한 수정'을 감시하도록 기록

  // ── 2부 감지("2, 3 출근") — 2부 배치표 창(10~16시)으로 board를 한 번 더 판독해 today2.json에 전 회원 반영. ──
  //  ★위 3부 경로와 '완전 분리'된 평행 슬롯(today2.json). 배치표 이미지일 때만(비용: board당 판독 +1회).
  //   2부 배치표에 이름이 뜬 회원만 상태가 잡히고, 근무 배정/티오프 변동 때만 2부 알림. 3부 코드는 일절 안 건드림.
  try {
    const isBoardImg = !!(full.images && full.images.length) && /배치표|시간표|번호표/.test(full.subject || '');
    if (isBoardImg) {
      const m2p = { name: primary.name, part: '2', commuteMin: primary.commuteMin, teeMin: 10, teeMax: 16 };
      const out2 = await judge(full, loadToday(1, '2'), m2p);   // 공유 2부 판독(비싼 부분, board당 1회)
      // ★member 1도 다른 회원과 '동일하게' 2부 명단 기반으로 재해석 — 모델이 전체 배치표의 3부 섹션에 있는
      //  본인(예: 김홍구 3부 22번)을 2부로 오검출하는 것을 차단(2부 명단에 없으면 순번 없음 = 2부 무관).
      const m1out2 = interpretForMember(full, out2.rawVerdict, m2p, loadToday(1, '2'));
      await processForMember2(1, m2p, m1out2, full, opts);
      for (const m of activeMembers()) {
        if (m.id === 1) continue;
        try {
          const member2 = { name: m.board_name, part: '2', commuteMin: Number(m.commute_min), teeMin: 10, teeMax: 16 };
          const mout2 = interpretForMember(full, out2.rawVerdict, member2, loadToday(m.id, '2'));
          await processForMember2(m.id, member2, mout2, full, opts);
        } catch (e) { console.error(`[회원 ${m.id} 2부 처리 오류]`, e.message); }
      }
    }
  } catch (e) { console.error('[2부 감지 오류]', e.message); }

  return primaryRet; // 호출부 호환(1번 회원 결과 반환)
}

// 한 회원(userId)에 대해: 피드 저장 → 상황판 병합 → 저널·근무일지 → 중복차단 → 그 회원 기기로 발송.
//  ★모든 저장·발송이 회원별(userId). 1번 회원은 기존 동작과 동일.
async function processForMember(userId, member, out, full, opts = {}) {
  const today = loadToday(userId);
  const v = out.rawVerdict;
  let title = out.title, body = out.body;

  if (out.relevant) {
    if (isKakaoSource(full)) {
      // 카톡發은 소식 피드에 아무것도 남기지 않는다 — 시스템 내부 감지·상황판 반영만(카톡 관련 항목은 소식에 노출 금지).
      if (userId === 1) console.log(`·  (카톡 감지 → 소식 미표시, 상황판만 반영) ${full.subject}`);
    } else {
      saveRecentV2(full, out, userId);
    }
  } else if (userId === 1) console.log(`·  (무관 → 앱에 안 남김) ${full.subject} — ${v?.category || ''}`);

  let change = { reversal: false, material: false, message: '' };
  let merged = null;
  if (out.relevant && v) {
    merged = applyVerdict(today, v, full);
    saveToday(merged.next, userId);
    change = merged.change;
    const jIso = worklog.labelToISO(merged.next.date);
    if (jIso && !v._uncertain && out.push !== 'check') {
      journal.recordDayStatus(jIso, { status: merged.next.status, teeTime: merged.next.teeTime,
        course: merged.next.course, myPosition: merged.next.myPosition, cutoffName: merged.next.cutoffName }, userId);
    }
    if (change.reversal) {
      const teeChg = (change.changes || []).find((c) => c.field === 'tee');
      if (teeChg) {
        // 티오프 시각 변경 → 출발·도착·백대기 전부 바뀜. 변경 사실 + 확인 요청 + 갱신된 전체 시각.
        title = '⚠️ 티오프 시간 변경!';
        body = `${member.name}님, 티오프가 ${teeChg.from} → ${teeChg.to}(으)로 변경됐어요. 출발·백대기 시각도 바뀌었으니 확인해주세요.\n${out.body}`;
        rearmTimelineReminders(userId); // 새 시각으로 타임라인 리마인더 다시 울리게
      } else {
        title = '⚠️ 변경됐어요!';
        body = `${change.message}\n${out.body}`;
      }
      out.push = 'high';
    } else if (!v._uncertain && Number(v.teamCount) > 0) {
      // ★판독 불확실(_uncertain)일 때만 이 분기를 건너뛴다(그땐 순번이 흔들려 '내 앞 N명'이 부정확 →
      //  '확인 필요' 알림을 그대로 보냄). 그 외엔 '확정선 전진'을 스페어 회원에게 반드시 알린다.
      const myp = Number(merged.next.myPosition) || 0;
      const tc = Number(v.teamCount);
      if (myp && myp > tc) {
        const ahead = Math.max(0, myp - tc - 1);
        const part = merged.next.part || `${member.part}부`;
        title = `🏌️ ${member.part}부 대기 현황`;
        // 스페어 1번(내 앞 0명)은 '출근 확정' 아니라 '언제든 나갈 1순위'로 구분해 안내.
        body = ahead === 0
          ? `현재 ${part} ${tc}팀 — ${member.name}님은 스페어 1번이에요. 팀이 하나만 더 차면 바로 출근이니 준비해두세요.`
          : `현재 ${part} ${tc}팀 — ${member.name}님은 스페어 ${ahead + 1}번, 앞에 ${ahead}명 남았어요.`;
        // 확정선이 전진하면(팀 추가) 스페어 회원에게 알림. 너무 멀 때(WATCH 초과)만 피드로.
        //  같은 팀수 반복은 중복차단(sig에 cutLine 포함)이 걸러줌 → 전진 1회당 알림 1회.
        const WATCH = Number(process.env.SPARE_WATCH_AHEAD ?? 6);
        out.push = ahead === 0 ? 'high' : (ahead <= WATCH ? 'check' : 'low');
      }
    }
  }

  // ★★카톡發은 '배치표 감시' 전용 — 소식 피드에 절대 안 뜨고(위에서 미저장), 알림도 '실제 업무 변동'이 있을 때만.
  //  개인 카톡·잡담·개인 톡방 내용은 상황판만 조용히 스치고 알림을 내지 않는다(변동 없으면 완전 무음).
  //  변동(reversal: 티오프 변경/근무↔스페어/취소 등)이 있을 때만 '업무 시간 변동'을 최소한으로, 원문 노출 없이 알린다.
  if (isKakaoSource(full)) {
    if (out.relevant && change.reversal) {
      const teeChg = (change.changes || []).find((c) => c.field === 'tee');
      title = '⚠️ 업무 시간 변동';
      body = teeChg
        ? `${member.name}님, 티오프가 ${teeChg.from} → ${teeChg.to}(으)로 변동됐어요. 출발·백대기 시각도 확인해주세요.`
        : `${member.name}님, 업무에 변동이 있어요 — ${change.message}.`;
      out.push = 'high';
    } else {
      out.push = 'low'; // 변동 없음(또는 무관) → 무음. 소식·알림 어디에도 안 남김.
    }
  }

  if (merged && v && !v._uncertain && ['assigned', 'work', 'your_turn'].includes(merged.next.status)) {
    const iso = worklog.labelToISO(merged.next.date) || new Date().toISOString().slice(0, 10);
    worklog.recordWorkDay(iso, { teeTime: merged.next.teeTime || '', course: merged.next.course || '', articleId: full.id }, userId);
  }

  const ret = { push: out.push, title, body, status: out.status, relevant: out.relevant,
    category: v?.category || null, change: change.message || null, reversal: change.reversal };

  // ★판독 불확실(check) 발생 사유를 진단 로그에 기록 — 얼리액세스 동안 이걸 분석해 불확실 케이스를 줄여간다.
  //  (불확실 알림 자체가 '앱이 덜 완성됐다'는 신호 → 사유별 빈도를 보고 근본 원인에 대응)
  if (out.push === 'check') {
    appendJSONL('uncertain-log.jsonl', {
      at: Date.now(), userId, part: member.part, articleId: full.id, subject: full.subject,
      status: out.status, category: v?.category || null,
      confidence: v?.confidence ?? null,
      reason: v?._uncertain || (v ? `저확신(confidence=${v?.confidence ?? '-'})` : '자동 판독 실패(Gemini 응답 없음)'),
      partSource: v?._partSource || null, reads: v?._reads || null,
    });
  }

  if (out.push === 'low') {
    if (userId === 1) {
      const why = v?._rosterDrop ? ` [명단필터: ${v._rosterDrop}]` : '';
      console.log(`·  (피드만) ${full.subject} — ${v?.category || ''} (relevant=${out.relevant})${why}`);
    }
    return { pushed: false, ...ret };
  }

  // 중복 푸시 방지 — '결과 상태' 기준, 회원별 pushlog.
  if (!opts.force && !change.reversal) {
    const ns = merged ? merged.next : null;
    // ★근무 확정·휴무는 커트라인 무관 → 서명에서 cutLine 제외.
    //  (이미 근무 확정인데 다른 곳에서 팀이 추가돼 커트라인만 바뀌면 '근무 배정' 알림이 또 나가던 문제 차단)
    //  스페어/대기는 커트라인 전진이 '내 앞 N명'에 직접 영향 → cutLine 포함(그건 알려야 함).
    const confirmed = ns && ['assigned', 'work', 'your_turn', 'off'].includes(ns.status);
    const sig = ns
      ? (confirmed
          ? `${ns.status}|${ns.teeTime || ''}|${ns.course || ''}|${ns.myPosition || ''}`
          : `${ns.status}|${ns.teeTime || ''}|${ns.course || ''}|${ns.cutLine || ''}|${ns.myPosition || ''}`)
      : `${out.status}|${v?.teeTime || ''}`;
    const WINDOW = Number(process.env.PUSH_DEDUP_HOURS ?? 8) * 3600 * 1000;
    const now = Date.now();
    const log = loadUserJSON(userId, 'pushlog.json', {});
    for (const k of Object.keys(log)) if (now - log[k] > WINDOW) delete log[k];
    if (log[sig] != null) {
      if (userId === 1) console.log(`·  (같은 상태 재알림 억제 → 무푸시) ${full.subject} [${sig}]`);
      saveUserJSON(userId, 'pushlog.json', log);
      return { pushed: false, ...ret };
    }
    log[sig] = now;
    saveUserJSON(userId, 'pushlog.json', log);
  }

  await broadcast({ title, body, url: full.url, level: out.push }, userId);
  console.log(`🔔 [회원${userId}·${out.push}${change.reversal ? '/번복' : ''}] ${title} | ${String(body).replace(/\n/g, ' ')}`);
  return { pushed: true, ...ret };
}

// ── 2부 슬롯(today2.json) 전용 처리 — "2, 3 출근"의 2부 라운드. 3부(processForMember)와 완전 분리. ──
//  ★2부 배치표에 이름이 뜬 회원만 상태가 잡힘. 근무 배정/티오프 변동 등 '의미있는 변동'일 때만 2부 알림.
//   현재 단계: 상황판(today2) 갱신 + 알림. (저널·세무 2탕은 다음 단계에서 데이터모델 확장과 함께.)
async function processForMember2(userId, member, out, full, opts = {}) {
  const v = out.rawVerdict;
  if (!out.relevant || !v) return { pushed: false };
  const today2 = loadToday(userId, '2');
  // 2부와 무관한 회원(2부 명단에 이름 없음 + 기존 2부 상태도 없음)이면 슬롯 자체를 만들지 않음(잡음 방지).
  const hadState = !!(today2 && (today2.myPosition || today2.teeTime || (today2.status && today2.status !== 'unknown')));
  const hasNow = Number(v.myPosition) > 0;
  if (!hadState && !hasNow) return { pushed: false };

  const merged = applyVerdict(today2, v, full, { teeMin: 10, teeMax: 16 });
  saveToday(merged.next, userId, '2');
  const n = merged.next, change = merged.change;
  const isWork2 = ['assigned', 'work', 'your_turn'].includes(n.status);

  // 알림: 2부 근무 배정(티오프 신규) · 티오프 변경 · 스페어→근무 승격 등 의미있는 변동만.
  const chgs = change.changes || [];
  const teeChg = chgs.find((c) => c.field === 'tee');
  const gotTee = chgs.some((c) => c.field === 'tee_new');
  const becameWork = chgs.some((c) => ['status', 'cutline', 'teamcount'].includes(c.field) && ['assigned', 'work', 'your_turn'].includes(c.to));
  let title = '', body = '', push = 'low';
  if (isWork2 && (teeChg || gotTee || becameWork)) {
    if (teeChg) { title = '⚠️ 2부 티오프 변경!'; body = `${member.name}님, 2부 티오프가 ${teeChg.from} → ${teeChg.to}(으)로 변경됐어요. 출발·백대기 시각도 확인해주세요.`; }
    else if (n.teeTime) { title = '⛳ 2부 근무 배정!'; body = `${member.name}님, 오늘 2부 근무예요. 티오프 ${n.teeTime}${n.course ? `(${n.course})` : ''} — 2부 뛰고 이어서 3부까지 두 탕이에요.`; }
    else { title = '⛳ 2부 근무권!'; body = `${member.name}님, 오늘 2부 근무권에 들었어요. 티오프가 잡히면 바로 알려드릴게요.`; }
    push = 'high';
  }
  if (push === 'low') {
    if (userId === 1) console.log(`·  [2부] ${full.subject} → ${n.status}/${n.teeTime || '-'} 순번${n.myPosition ?? '-'} (알림없음)`);
    return { pushed: false };
  }
  // 2부 전용 중복 억제(pushlog2.json) — 3부 pushlog과 분리.
  if (!opts.force && !change.reversal) {
    const sig = `${n.status}|${n.teeTime || ''}|${n.course || ''}|${n.myPosition || ''}`;
    const WINDOW = Number(process.env.PUSH_DEDUP_HOURS ?? 8) * 3600 * 1000;
    const now = Date.now();
    const log = loadUserJSON(userId, 'pushlog2.json', {});
    for (const k of Object.keys(log)) if (now - log[k] > WINDOW) delete log[k];
    if (log[sig] != null) { saveUserJSON(userId, 'pushlog2.json', log); return { pushed: false }; }
    log[sig] = now; saveUserJSON(userId, 'pushlog2.json', log);
  }
  await broadcast({ title, body, url: full.url, level: push }, userId);
  console.log(`🔔 [회원${userId}·2부${change.reversal ? '/번복' : ''}] ${title} | ${String(body).replace(/\n/g, ' ')}`);
  return { pushed: true };
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

// ── 라운드 점검(카트·클럽) 사진 자동 정리 — 블랙박스식 롤링 삭제 ──────────
//  기본 30일 보관 후 그 이전 날의 사진+기록을 통째 삭제(용량·프라이버시). ★근무기록(세무)은 별개라 영향 없음.
const ROUNDCHECK_RETAIN_DAYS = Number(process.env.ROUNDCHECK_RETAIN_DAYS ?? 30);
function isoDaysAgo(n) {
  const [y, m, d] = todayISOKST().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
function pruneRoundChecks() {
  try {
    const cutoff = isoDaysAgo(ROUNDCHECK_RETAIN_DAYS);
    let days = 0, files = 0;
    for (const id of allUserIds()) { const r = cartcheck.pruneOld(id, cutoff); days += r.days; files += r.files; }
    if (days || files) console.log(`🧹 라운드 점검 정리: ${cutoff} 이전 ${days}일·사진 ${files}장 삭제(보관 ${ROUNDCHECK_RETAIN_DAYS}일)`);
  } catch (e) { console.error('라운드 점검 정리 오류:', e.message); }
}
pruneRoundChecks();                                   // 부팅 시 1회
setInterval(pruneRoundChecks, 24 * 3600 * 1000);      // 이후 하루 1회

// ── 출근 타임라인 리마인더 (회원별) ─────────────────────────────
//  근무 확정(오늘·티오프 있음)인 회원에게 각자의 출발/도착/티오프 시각에 맞춰 푸시.
//  1분 간격 체크 · 회원별 중복방지 · 서버 다운 후 늦게 뜬 임계값은 스테일(GRACE 초과)로 미발송.
const TEE_REMIND_BEFORE = Number(process.env.TEE_REMIND_BEFORE_MIN ?? 15);
const LEAVE_REMIND_BEFORE = Number(process.env.LEAVE_REMIND_BEFORE_MIN ?? 10);
const REMIND_GRACE = Number(process.env.REMIND_GRACE_MIN ?? 12);
const toMinOfDay = (hhmm) => { const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function timelineReminders(c, name) {
  const L = toMinOfDay(c.leave), A = toMinOfDay(c.arrive), T = toMinOfDay(c.tee);
  if (L == null || A == null || T == null) return [];
  return [
    { key: 'leave10', at: L - LEAVE_REMIND_BEFORE, level: 'check', title: '🚗 곧 출발', body: `${name}님, ${LEAVE_REMIND_BEFORE}분 뒤 ${c.leave} 출발이에요. 준비하세요.` },
    { key: 'leave',   at: L,                       level: 'high',  title: '🚗 출발 시간', body: `${name}님, 지금 출발하세요! 도착 ${c.arrive} · 티오프 ${c.tee}.` },
    { key: 'arrive',  at: A,                       level: 'check', title: '⛳ 도착·백대기', body: `${name}님, 골프장 도착 시간이에요. 백대기 ${c.standby}까지 준비하세요.` },
    { key: 'tee',     at: T - TEE_REMIND_BEFORE,   level: 'high',  title: '🏌️ 곧 티오프', body: `${name}님, ${TEE_REMIND_BEFORE}분 뒤 ${c.tee} 티오프예요. 코스로 이동하세요.` },
  ];
}

// 티오프 시각이 바뀌면 그날 보낸 타임라인 리마인더 기록을 비워, 새 시각으로 다시 울리게 한다.
function rearmTimelineReminders(userId) {
  try { saveUserJSON(userId, 'timeline-remind.json', { date: todayISOKST(), sent: {} }); }
  catch (e) { console.error('타임라인 재무장 오류:', e.message); }
}

async function checkTimelineReminders() {
  try {
    const todayISO = todayISOKST();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const mem of activeMembers()) {
      const t = loadToday(mem.id);
      if (!t || !t.teeTime) continue;
      if (!['assigned', 'work', 'your_turn'].includes(t.status)) continue;
      const tISO = worklog.labelToISO(t.date);
      if (tISO && tISO !== todayISO) continue;           // 오늘 근무만(내일 배치표는 제외)
      const c = commuteInfo(t.teeTime, mem.commute_min);
      if (!c) continue;
      const rems = timelineReminders(c, mem.board_name || '회원');
      const store = loadUserJSON(mem.id, 'timeline-remind.json', {});
      if (store.date !== todayISO) { store.date = todayISO; store.sent = {}; }
      store.sent = store.sent || {};
      let changed = false;
      for (const r of rems) {
        if (r.at == null || store.sent[r.key]) continue;
        if (nowMin >= r.at) {
          if (nowMin - r.at <= REMIND_GRACE) {           // 임계값 직후에만 발송(늦으면 조용히 통과)
            await broadcast({ title: r.title, body: r.body, url: '/', level: r.level }, mem.id);
            console.log(`[타임라인] 회원${mem.id} ${r.key} 발송 (예정 ${r.at}분, 현재 ${nowMin}분)`);
          }
          store.sent[r.key] = Date.now();
          changed = true;
        }
      }
      if (changed) saveUserJSON(mem.id, 'timeline-remind.json', store);
    }
  } catch (e) { console.error('타임라인 리마인더 오류:', e.message); }
}
setInterval(checkTimelineReminders, 60 * 1000); // 1분마다 체크
console.log(`⏰ 출근 타임라인 리마인더: 출발 ${LEAVE_REMIND_BEFORE}분전·출발정각·도착·티오프 ${TEE_REMIND_BEFORE}분전 (1분 체크)`);

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
    // 운영성 알림 → 관리자(김홍구)에게만. 일반 회원(테스터)에게는 보내지 않는다.
    await broadcastAdmins({
      title: '⚠️ 네이버 쿠키 만료',
      body: '카페 감시가 멈췄어요. .env 의 쿠키를 새로 갱신해주세요.',
      url: '/',
    });
  },
});

// ── 배치표 재확인 루프: 같은 글의 이미지 교체(=조용한 티오프 변경)를 잡는다 ──
//  활성 시간대에 현재 배치표 글을 다시 읽어, 이미지가 바뀐 경우에만 재판독→강한 알림.
const BOARD_RECHECK_MS = Number(process.env.BOARD_RECHECK_MS ?? 90000);
let recheckBusy = false;
async function recheckBoard() {
  if (recheckBusy) return;                                 // 재판독이 아직 진행 중이면 이번 틱은 건너뜀
  if (!boardWatch || !boardWatch.id) return;
  const h = new Date().getHours();
  const aStart = Number(process.env.ACTIVE_START_HOUR ?? 12);
  const aEnd = Number(process.env.ACTIVE_END_HOUR ?? 24);
  if (h < aStart || h >= aEnd) return;                     // 활성 시간대만
  if (Date.now() - (boardWatch.at || 0) > 18 * 3600 * 1000) { // 하루 지난 배치표는 감시 해제
    boardWatch = null; saveJSON(BOARD_WATCH_FILE, null); return;
  }
  let full;
  try { full = await fetchArticle(boardWatch.id); }
  catch (e) { console.error('배치표 재확인 조회 실패:', e.message); return; }
  const fp = imgFingerprint(full);
  if (fp === boardWatch.fp) return;                        // 이미지 그대로 → Gemini 미호출(무비용)
  console.log(`🔁 배치표 이미지 교체 감지(같은 글 #${boardWatch.id}) → 재판독`);
  boardWatch.fp = fp; boardWatch.at = Date.now();
  saveJSON(BOARD_WATCH_FILE, boardWatch);
  recheckBusy = true;
  try {
    full.writer = full.writer || '';
    // 변동 시에만 회원별 재판독 → 본인 티오프가 바뀌었으면 ⚠️ 강한 알림. (안 바뀐 회원은 dedup이 차단)
    await notifyForArticle(full, { relevant: true, priority: 'high' }, {});
  } catch (e) { console.error('배치표 재판독 오류:', e.message); }
  finally { recheckBusy = false; }
}
setInterval(() => { recheckBoard().catch(() => {}); }, BOARD_RECHECK_MS);
console.log(`🔁 배치표 재확인 루프: ${BOARD_RECHECK_MS / 1000}s 간격(활성 시간대, 이미지 변경 시에만 재판독)`);
