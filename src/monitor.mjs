// 운영 모니터링 사이트 — 본 앱과 별개의 작은 서버(다른 포트).
//  같은 data/(app.db·로그)를 '읽기 전용'으로 보고, 가입·방문·재접속·배치표 이해도를 한 눈에 표시.
//  실행:  node src/monitor.mjs   (pm2로 riverhill-monitor 로 따로 띄우면 됨)
//  보안:  MONITOR_TOKEN 설정 시 ?k=토큰 필요. 미설정이면 로컬/사설망 전용으로만 쓸 것.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { loadEnv, ROOT_DIR } from './env.mjs';
import { computeStats, computeBoardParts } from './analytics.mjs';
import { listMembersForAdmin, setUserStatus, getUser, getProfile, activeMembers } from './users.mjs';
import { initPush, broadcast, getSubscriptions } from './push.mjs';
import { loadToday } from './today.mjs';
import { commuteInfo, dayWordFor } from './judge.mjs';
import * as worklog from './worklog.mjs';
import { DATA_DIR } from './store.mjs';

loadEnv();
const PORT = Number(process.env.MONITOR_PORT || 3100);
const HOST = process.env.MONITOR_HOST || '0.0.0.0';
const TOKEN = process.env.MONITOR_TOKEN || '';

// 승인 시 그 회원 폰으로 알림을 보내려면 VAPID 필요. 없으면 승인은 되되 알림만 비활성(모니터는 계속 동작).
let pushReady = false;
try { initPush(); pushReady = true; }
catch (e) { console.warn('⚠️ 푸시 초기화 실패 — 승인 알림 비활성:', e.message); }

const app = express();
app.use(express.json());   // 승인 POST 바디 파싱

// 토큰 게이트 — 설정돼 있으면 ?k= / x-monitor-token 헤더 / Bearer 중 하나로 통과.
function gate(req, res, next) {
  if (!TOKEN) return next(); // 미설정 = 개방(로컬/사설망 전용 가정)
  const k = req.query.k || req.get('x-monitor-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (k === TOKEN) return next();
  res.status(401).send('unauthorized — ?k=토큰 이 필요합니다.');
}

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/api/stats', gate, (req, res) => {
  try { res.json({ ok: true, ...computeStats() }); }
  catch (e) { console.error('stats 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
// 판독검증 1·2·3부 탭 데이터 — 모니터가 직접 부별 판독(board별 1회 캐시). 앱 무관·읽기 전용.
app.get('/api/board-parts', gate, async (req, res) => {
  try { res.json({ ok: true, board: await computeBoardParts() }); }
  catch (e) { console.error('board-parts 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
// ── 회원 대시보드 대조 — 각 회원 앱에 지금 뜨는 화면을 재현 + 최근 알림 대조(읽기 전용). ──
//  앱의 GET /api/today 조립 로직을 그대로 재현(loadToday→상태·티오프·통근·순번). Gemini 재호출 없음.
function todayISOkst() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function lastPushByUid() {
  const map = {};
  try {
    const txt = fs.readFileSync(path.join(DATA_DIR, 'sent-push.jsonl'), 'utf8');
    const lines = txt.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {           // 끝(최신)부터 — 회원별 첫(=가장 최근) 1건만
      let r; try { r = JSON.parse(lines[i]); } catch { continue; }
      const u = r.uid ?? r.userId;
      if (u == null || map[u]) continue;
      map[u] = r;
    }
  } catch { /* 로그 없음 */ }
  return map;
}
// 알림 문구 → 상태 분류(대시보드 상태와 대조용). 판별 불가(소식/변경 등)면 null → '대조 보류'.
function pushKind(p) {
  if (!p) return null;
  const s = `${p.title || ''} ${p.body || ''}`;
  if (/휴무|병가|휴가|편히 쉬/.test(s)) return 'off';
  if (/근무 배정|근무 확정|근무예요|근무 예정|근무권|출근 차례|티오프 시간 변경|티오프.*배정/.test(s)) return 'work';
  if (/스페어|대기 현황|앞에 \d+명/.test(s)) return 'spare';
  return null;
}
app.get('/api/user-dash', gate, (req, res) => {
  try {
    const lastMap = lastPushByUid();
    const todayISO = todayISOkst();
    const users = [];
    for (const m of activeMembers()) {
      const prof = getProfile(m.id) || {};
      const commuteMin = Number(prof.commute_min ?? m.commute_min) || 0;
      const bname = String(prof.board_name || m.board_name || '');
      const st = loadToday(m.id) || {};
      const status = st.status || 'unknown';
      const isWork = ['assigned', 'work', 'your_turn'].includes(status);
      const isSpare = ['spare', 'waiting', 'near'].includes(status);
      const isOff = status === 'off';
      const offRemoved = isOff && st.offReason === 'removed';
      const offSick = isOff && st.offType === 'sick';
      const offVac = isOff && st.offType === 'vacation';
      const teeTime = st.teeTime || '';
      const dayW = dayWordFor(st.date) || '';
      // 순번: 명단에서 이름으로(괄호 점유자 반영), 없으면 저장된 myPosition
      const roster = Array.isArray(st.roster3) ? st.roster3 : [];
      const nk = bname.replace(/\s/g, '');
      let rosterPos = 0;
      for (let i = 0; i < roster.length; i++) {
        const cell = String(roster[i] || '');
        const mm = cell.match(/\(([^)]+)\)/);
        const occ = (mm ? mm[1] : cell).replace(/\s/g, '');
        if (nk && occ === nk) { rosterPos = i + 1; break; }
      }
      const myPos = rosterPos || Number(st.myPosition) || 0;
      const cut = Number(st.cutLine) || 0;
      const ahead = (cut && myPos > cut) ? Math.max(0, myPos - cut - 1) : Math.max(0, myPos - 1);
      let kind, badge, heroTitle;
      if (status === 'your_turn') { kind = 'work'; badge = { t: '출근 차례', c: 'work' }; heroTitle = '지금 출근 차례'; }
      else if (isWork) { kind = 'work'; badge = { t: '근무', c: 'work' }; heroTitle = teeTime ? `${dayW} 근무 확정` : `${dayW} 근무 예정`; }
      else if (offRemoved) { kind = 'removed'; badge = { t: '순번 제외', c: 'removed' }; heroTitle = '근무 없음 (순번 제외)'; }
      else if (offSick) { kind = 'off'; badge = { t: '병가', c: 'sick' }; heroTitle = `${dayW} 병가`; }
      else if (offVac) { kind = 'off'; badge = { t: '휴가', c: 'vac' }; heroTitle = `${dayW} 휴가`; }
      else if (isOff) { kind = 'off'; badge = { t: '휴무', c: 'off' }; heroTitle = `${dayW} 휴무`; }
      else if (isSpare) { kind = 'spare'; badge = { t: '스페어', c: 'spare' }; heroTitle = `${dayW} 스페어${myPos ? ` · ${myPos}번` : ''}`; }
      else { kind = 'unknown'; badge = { t: '미상', c: 'unk' }; heroTitle = '상태 미상'; }
      const commute = (isWork && teeTime) ? commuteInfo(teeTime, commuteMin) : null;
      const subCount = (getSubscriptions(m.id) || []).length;
      let stale = false;
      try { const iso = worklog.labelToISO(st.date); if (iso && iso < todayISO) stale = true; } catch { /* 무해 */ }
      const lp = lastMap[m.id] || null;
      const pk = pushKind(lp);
      const dk = kind === 'removed' ? 'off' : kind;
      let match;
      if (!lp) match = { s: 'none', t: '알림 없음' };
      else if (!pk || dk === 'unknown') match = { s: 'na', t: '대조 보류' };
      else match = (dk !== pk) ? { s: 'bad', t: '불일치' } : { s: 'ok', t: '일치' };
      users.push({
        id: m.id, name: bname || `#${m.id}`, part: st.part || `${m.part || 3}부`,
        status, kind, badge, heroTitle,
        date: st.date || '', dayW, stale, empty: !st.date && !st.status,
        myPos, cut, ahead, teamCount: Number(st.teamCount) || 0,
        teeTime, course: st.course || '', commute, commuteMin,
        rosterFound: !!rosterPos, updatedAt: st.updatedAt || 0, subCount,
        lastPush: lp ? { at: lp.at, title: lp.title || '', body: lp.body || '', level: lp.level || lp.push || '', sent: lp.sent ?? null, devices: lp.devices ?? null } : null,
        match,
      });
    }
    users.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    res.json({ ok: true, at: Date.now(), users });
  } catch (e) { console.error('user-dash 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
// ── 회원 승인(관리자) — 실시간 승인신청 처리. 앱의 회원관리 대체. ──
app.get('/api/members', gate, (req, res) => {
  // ★차단(disabled)은 '삭제된 것'으로 간주 — 명단에서 제외해 이름 칸을 차지하지 않게.
  try { res.json({ ok: true, members: listMembersForAdmin().filter((m) => m.status !== 'disabled'), pushReady }); }
  catch (e) { console.error('members 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/user-status', gate, async (req, res) => {
  const id = Number(req.body?.id);
  const status = String(req.body?.status || '');
  const reason = String(req.body?.reason || '') || null;   // 차단 사유(roster|other)
  if (!id || !['active', 'pending', 'disabled'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'id·status(active|pending|disabled) 필요' });
  }
  const target = getUser(id);
  if (!target) return res.status(404).json({ ok: false, error: '회원을 찾을 수 없어요.' });
  if (target.role === 'admin') return res.status(400).json({ ok: false, error: '관리자 계정 상태는 바꿀 수 없어요.' });
  const u = setUserStatus(id, status, reason);
  // ★승인(active) 즉시 그 회원 폰으로 알림 — 대기화면이 곧바로 앱으로 넘어가도록.
  let notified = false;
  if (status === 'active' && pushReady) {
    try {
      const nm = (getProfile(id) || {}).board_name || '회원';
      await broadcast({
        title: '가입 승인 완료 🎉',
        body: `${nm}님, 리버힐 캐디 앱 이용이 승인됐어요. 지금 바로 열어보세요!`,
        url: '/', level: 'high', bypassQuiet: true,
      }, id);
      notified = true;
    } catch (e) { console.error('승인 알림 발송 실패:', e.message); }
  }
  console.log(`👤 [monitor] 회원 #${id} 상태 → ${status}${status === 'disabled' ? `(${u.block_reason})` : ''}${notified ? ' · 승인알림 발송' : ''}`);
  res.json({ ok: true, id, status, notified, blockReason: u.block_reason || null });
});

app.get('/', gate, (req, res) => res.sendFile(path.join(ROOT_DIR, 'monitor', 'index.html')));

app.listen(PORT, HOST, () => {
  console.log(`📊 모니터링 사이트 실행: http://localhost:${PORT}`
    + (TOKEN ? '  (접속 시 ?k=토큰 필요)' : '  (⚠️ MONITOR_TOKEN 미설정 — 접근 제한 없음)'));
});
