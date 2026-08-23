// 운영 모니터링 사이트 — 본 앱과 별개의 작은 서버(다른 포트).
//  같은 data/(app.db·로그)를 '읽기 전용'으로 보고, 가입·방문·재접속·배치표 이해도를 한 눈에 표시.
//  실행:  node src/monitor.mjs   (pm2로 riverhill-monitor 로 따로 띄우면 됨)
//  보안:  MONITOR_TOKEN 설정 시 ?k=토큰 필요. 미설정이면 로컬/사설망 전용으로만 쓸 것.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { loadEnv, ROOT_DIR } from './env.mjs';
import { computeStats, computeBoardParts, effectivePart3Verdict } from './analytics.mjs';
import { listMembersForAdmin, setUserStatus, setUserRole, getUser, getProfile, activeMembers, deleteUser } from './users.mjs';
import { seedTesterData } from './testerseed.mjs';
import { startWatchdog } from './watchdog.mjs';
import { broadcast, broadcastOps, getSubscriptions, initPush } from './push.mjs';
import { loadToday, saveToday, dayKey, applyVerdict, clearTodayPart } from './today.mjs';
import { commuteInfo, dayWordFor, interpretForMember, partWindow } from './judge.mjs';
import * as worklog from './worklog.mjs';
import { DATA_DIR, loadJSON } from './store.mjs';
import { loadBoardPartsStore, saveBoardPartsStore } from './boardparts.mjs';
import { resolvePrimary, buildMemberRounds, minorPartActive } from './rounds.mjs';
import { resolveWorkParts } from './boardreader.mjs';
import { collectPartRosters, buildCrossPartSwaps, actualCaddieName } from './crossparts.mjs';
import { addNotice, listNotices } from './notices.mjs';
import * as outbox from './outbox.mjs';
import { KINDS as NOTIFY_KINDS, compose as composeNotify, contextOf as notifyContext, partLabel as NOTIFY_PART } from './notifytext.mjs';
import * as dutyMod from './duty.mjs';
import { summarize as dayboardSummary, listDayboardDates, loadDayboard } from './dayboard.mjs';
import { buildDaejoData } from './daejodata.mjs';
import { saveSandbox, clearSandbox } from './daejosandbox.mjs';
import { setPartRange, setPartOneway, setPartSlot, clearPart, dayFrameParts } from './dayframe.mjs';
import { autoNotifyPart, boardIntegrity, currentStateMsg, markNotified } from './boardpush.mjs';
import { correctPart3, loadLastBoard, nkey, correctionMsg } from './boardcorrect.mjs';
import { keyFromLabel } from './boardpending.mjs';   // 수동 인턴은 날짜에 붙는다 — 라벨을 키로 바꾼다
import { renderDaejo } from '../tools/gen-daejo.mjs';
import { renderBooking } from '../tools/gen-booking.mjs';
import { internTeesFor, manualFor as internManualFor, setManual as setInternTees, clearManual as clearInternTees, toggle as toggleInternTee } from './interns.mjs';

loadEnv();
const PORT = Number(process.env.MONITOR_PORT || 3100);
const HOST = process.env.MONITOR_HOST || '0.0.0.0';
const TOKEN = process.env.MONITOR_TOKEN || '';

// 승인 시 그 회원 폰으로 알림을 보내려면 VAPID 필요. 없으면 승인은 되되 알림만 비활성(모니터는 계속 동작).
let pushReady = false;
try { initPush(); pushReady = true; }
catch (e) { console.warn('⚠️ 푸시 초기화 실패 — 승인 알림 비활성:', e.message); }

const app = express();
app.use(express.json({ limit: '12mb' }));   // 승인 POST 바디 파싱 + 배치표 이미지 업로드(base64)

// 토큰 게이트 — 설정돼 있으면 ?k= / x-monitor-token 헤더 / Bearer 중 하나로 통과.
function gate(req, res, next) {
  if (!TOKEN) return next(); // 미설정 = 개방(로컬/사설망 전용 가정)
  const k = req.query.k || req.get('x-monitor-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (k === TOKEN) return next();
  res.status(401).send('unauthorized — ?k=토큰 이 필요합니다.');
}

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/api/stats', gate, (req, res) => {
  try { const st = computeStats(); if (st && st.latestBoard) reflectPartsRows(st.latestBoard.parts); res.json({ ok: true, ...st }); }
  catch (e) { console.error('stats 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
// ── 칠판(dayboard) 대조 — 시각순 이벤트로 스스로 굴린 그날의 배치표 + 검증이슈(낡음 탐지). 읽기 전용. ──
app.get('/api/dayboard', gate, (req, res) => {
  try {
    const dates = listDayboardDates();
    const date = String(req.query.date || dates[dates.length - 1] || new Date().toISOString().slice(0, 10));
    const db = loadDayboard(date);
    res.json({ ok: true, dates, summary: dayboardSummary(date), log: db.log });
  } catch (e) { console.error('dayboard 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
// 감시 클로드 진단서 — 최근 것부터. 관리자가 자율 진단을 검토(코드 수정은 여기서 안 함, 자문만).
app.get('/api/watchdog', gate, (req, res) => {
  try {
    const p = path.join(DATA_DIR, 'watchdog-reports.jsonl');
    let reports = [];
    if (fs.existsSync(p)) {
      reports = fs.readFileSync(p, 'utf8').trim().split(/\n/).filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean).slice(-30).reverse();
    }
    const state = loadJSON('watchdog-state.json', {});
    res.json({ ok: true, reports, lastScanAt: state.lastAt || 0, diagPastHour: (state.diagAts || []).length });
  } catch (e) { console.error('watchdog 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
// 판독검증 1·2·3부 탭 데이터 — 모니터가 직접 부별 판독(board별 1회 캐시). 앱 무관·읽기 전용.
app.get('/api/board-parts', gate, async (req, res) => {
  try { const board = await computeBoardParts(); if (board) reflectPartsRows(board.parts); res.json({ ok: true, board }); }
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
    const minorPartOn = minorPartActive();   // 앱과 동일 게이트(1·2부 노출)
    const users = [];
    for (const m of activeMembers()) {
      const prof = getProfile(m.id) || {};
      const commuteMin = Number(prof.commute_min ?? m.commute_min) || 0;
      const bname = String(prof.board_name || m.board_name || '');
      // ★대표부·라운드를 앱 /api/today와 '같은 공용 로직'으로 해석 — 모니터가 회원 실제 화면을 그대로 재현.
      const { base, primaryPart, tISO } = resolvePrimary({ uid: m.id, minorPartOn, todayISO });
      const st = base || loadToday(m.id) || {};
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
      // ── 다중 라운드(같은 날 1·2·3부 조합) — 앱 /api/today와 '같은 공용 함수'로 조립(화면 갈라짐 0). ──
      //  근무+스페어 모두 rounds에 담겨 내려간다 → 프론트가 전부 카드로 그려 '2부 근무 + 3부 스페어' 불일치가 보임.
      const rounds = buildMemberRounds({ uid: m.id, primaryPart, base: st, minorPartOn, tISO, todayISO, commuteMin })
        .map((r) => ({ ...r, work: r.kind === 'work', myPos: r.myPosition || 0 }));   // 하위 요약 로직 호환 별칭
      const workRounds = rounds.filter((r) => r.work).sort((a, b) => String(a.teeTime).localeCompare(String(b.teeTime)) || Number(a.part) - Number(b.part));
      const workParts = workRounds.map((r) => r.part);
      const combo = workParts.length >= 2;         // 하루 두 부 이상 근무 = 통합 카드
      const comboLabel = workParts.join('·') + '부';   // 예: 1·3부
      // ★조출 단독(1부 근무 + 3부 스페어/휴무): 근무 부가 1개뿐이라 combo가 아니어도 히어로는 그 근무여야 한다.
      //  앱 pickFocus와 동일 — base(3부) status가 근무가 아니면 실제 근무 라운드가 스페어/휴무를 이긴다.
      //  (이게 없으면 조출이 3부 base=spare로 폴백해 모니터만 '스페어'로 새던 버그.)
      const soloWork = (!combo && !isWork && workRounds.length === 1) ? workRounds[0] : null;
      const soloChul = soloWork && soloWork.part === '1' && soloWork.assign === 'chulgn';
      let kind, badge, heroTitle;
      if (combo) { kind = 'work'; badge = { t: comboLabel, c: 'work' }; heroTitle = `${dayW} ${comboLabel} 근무`; }
      else if (status === 'your_turn') { kind = 'work'; badge = { t: '출근 차례', c: 'work' }; heroTitle = '지금 출근 차례'; }
      else if (isWork) { kind = 'work'; badge = { t: '근무', c: 'work' }; heroTitle = teeTime ? `${dayW} 근무 확정` : `${dayW} 근무 예정`; }
      else if (soloWork) { kind = 'work'; badge = { t: soloChul ? '조출' : `${soloWork.part}부`, c: 'work' }; heroTitle = `${dayW} ${soloChul ? '조출' : `${soloWork.part}부`} 근무${soloWork.teeTime ? ' 확정' : ' 예정'}`; }
      else if (offRemoved) { kind = 'removed'; badge = { t: '순번 제외', c: 'removed' }; heroTitle = '근무 없음 (순번 제외)'; }
      else if (offSick) { kind = 'off'; badge = { t: '병가', c: 'sick' }; heroTitle = `${dayW} 병가`; }
      else if (offVac) { kind = 'off'; badge = { t: '휴가', c: 'vac' }; heroTitle = `${dayW} 휴가`; }
      else if (isOff) { kind = 'off'; badge = { t: '휴무', c: 'off' }; heroTitle = `${dayW} 휴무`; }
      else if (isSpare) { kind = 'spare'; badge = { t: '스페어', c: 'spare' }; heroTitle = `${dayW} 스페어${myPos ? ` · ${myPos}번` : ''}`; }
      else { kind = 'unknown'; badge = { t: '미상', c: 'unk' }; heroTitle = '상태 미상'; }
      // 히어로가 조출 등 단독 근무면 티오프·코스·순번·통근도 그 근무 기준으로 표시(3부 base의 빈 값 대신).
      const heroTee = soloWork ? soloWork.teeTime : teeTime;
      const heroCourse = soloWork ? soloWork.course : (st.course || '');
      const heroPos = soloWork ? soloWork.myPos : myPos;
      const commute = soloWork ? soloWork.commute : ((!combo && isWork && teeTime) ? commuteInfo(teeTime, commuteMin) : null);
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
        id: m.id, name: bname || `#${m.id}`, part: combo ? comboLabel : (soloWork ? `${soloChul ? '1부(조출)' : `${soloWork.part}부`}` : (st.part || `${m.part || 3}부`)),
        combo, comboRounds: combo ? workRounds : null,
        rounds, primaryPart,   // ★전 라운드(근무+스페어) — 프론트가 모두 카드로 그려 부별 불일치 가시화
        status, kind, badge, heroTitle,
        date: st.date || '', dayW, stale, empty: !st.date && !st.status,
        myPos: heroPos, cut, ahead, teamCount: Number(st.teamCount) || 0,
        locked: (st._adminLock && dayKey(st.date) === dayKey(st._adminLock.dk)) ? Object.keys(st._adminLock.fields || {}).filter((k) => st._adminLock.fields[k]) : [],
        teeTime: heroTee, course: heroCourse, commute, commuteMin,
        rosterFound: !!rosterPos, updatedAt: st.updatedAt || 0, subCount,
        duty: dutyMod.dutyForToday(m.id, todayISO),   // ★당번·벌당(그날의 역할) — 판독 오류 시 여기서 교정

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
        title: '가입 승인 완료',
        body: `${nm}님, 리버힐 캐디 앱 이용이 승인됐습니다.`,
        url: '/', level: 'high', bypassQuiet: true,
      }, id);
      notified = true;
    } catch (e) { console.error('승인 알림 발송 실패:', e.message); }
  }
  console.log(`👤 [monitor] 회원 #${id} 상태 → ${status}${status === 'disabled' ? `(${u.block_reason})` : ''}${notified ? ' · 승인알림 발송' : ''}`);
  res.json({ ok: true, id, status, notified, blockReason: u.block_reason || null });
});
// ★회원 완전 삭제 — 신청한 구글 계정·이름·개인 데이터까지 전부 제거(관리자 제외). '보류'는 무동작(현행 유지).
app.post('/api/user-delete', gate, (req, res) => {
  const id = Number(req.body?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'id 필요' });
  const target = getUser(id);
  if (!target) return res.status(404).json({ ok: false, error: '회원을 찾을 수 없어요.' });
  if (target.role === 'admin') return res.status(400).json({ ok: false, error: '관리자 계정은 삭제할 수 없어요.' });
  const r = deleteUser(id);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error || '삭제 실패' });
  // 개인 데이터 폴더까지 제거(today.json 등).
  try { fs.rmSync(path.join(DATA_DIR, 'users', String(id)), { recursive: true, force: true }); } catch (e) { /* 폴더 없거나 무해 */ }
  console.log(`🗑️ [monitor] 회원 #${id}(${r.boardName || '이름없음'}) 완전 삭제 — 계정·프로필·세션·구독·데이터`);
  res.json({ ok: true, id, boardName: r.boardName });
});
// ★테스터 킷 지정/해제 — 계정을 role='tester'로(또는 member 복귀). 테스터는 실제 캐디/알림에 안 섞이고, 앱에서 테스터 킷 기능만 켜진다.
app.post('/api/user-role', gate, (req, res) => {
  const id = Number(req.body?.id);
  const tester = !!req.body?.tester;
  if (!id) return res.status(400).json({ ok: false, error: 'id 필요' });
  const target = getUser(id);
  if (!target) return res.status(404).json({ ok: false, error: '회원을 찾을 수 없어요.' });
  if (target.role === 'admin') return res.status(400).json({ ok: false, error: '관리자 계정 역할은 바꿀 수 없어요.' });
  const u = setUserRole(id, tester ? 'tester' : 'member');
  if (!u) return res.status(400).json({ ok: false, error: '역할 변경 실패' });
  let seeded = null;
  if (tester) { try { seeded = seedTesterData(id); } catch (e) { console.error('[테스터 시드 오류]', e.message); } } // 정산·일지 샘플(비어있을 때만)
  console.log(`🧪 [monitor] 회원 #${id} 역할 → ${u.role}${seeded && seeded.seeded ? ` · 샘플시드(${seeded.workdays}일)` : ''}`);
  res.json({ ok: true, id, role: u.role, seeded });
});

// ── 관리자 수동 교정: 판독이 틀렸을 때 관리자가 실제 배치표를 보고 대시보드를 바로잡음 ──
//  교정값은 그날 자동 판독이 덮지 않도록 today.json 에 _adminLock 으로 잠근다(applyAdminLock).
//  모든 교정은 '모델값 vs 관리자값' diff 로 admin-corrections.jsonl 에 남겨 정확도 진단에 쓴다.
//  ★제목은 카탈로그가 짓는다 — 여기서 짓던 '티오프 시간 변경!'은 부도 안 붙고 느낌표가 있어
//   다른 경로의 '{부} 티오프 변경'과 갈라져 있었다. 받는 사람은 그걸 다른 알림으로 읽는다.
function correctionMessage(name, t, changes, part = '3') {
  const st = t.status;
  const pl = NOTIFY_PART(part);
  const statusChg = changes.find((c) => c.field === 'status');
  const teeChg = changes.find((c) => c.field === 'teeTime');
  if (teeChg)
    return composeNotify('tee', notifyContext(part, name, t, { teeFrom: teeChg.from || '' }));
  if (statusChg && ['assigned', 'work', 'your_turn'].includes(st))
    return { title: `${pl} 근무 배정`, body: `${pl} 근무로 확정됐습니다${t.teeTime ? ` — 티오프 ${t.teeTime}` : ''}.` };
  if (statusChg && ['spare', 'waiting', 'near'].includes(st))
    return { title: `${pl} 스페어 전환`, body: `${pl} 스페어(대기)로 전환됐습니다.` };
  if (statusChg && st === 'off')
    return { title: `${pl} 휴무`, body: `${pl} 오늘은 휴무로 처리됐습니다.` };
  return { title: `${pl} 배치표 수정`, body: `${pl} 배치표 정보가 갱신됐습니다.` };
}
app.post('/api/member-correct', gate, async (req, res) => {
  const id = Number(req.body?.id);
  const fields = req.body?.fields || {};
  const notify = !!req.body?.notify;
  if (!id) return res.status(400).json({ ok: false, error: 'id 필요' });
  const target = getUser(id);
  if (!target) return res.status(404).json({ ok: false, error: '회원을 찾을 수 없어요.' });
  const t = loadToday(id) || {};
  const name = (getProfile(id) || {}).board_name || `#${id}`;
  const next = { ...t };
  const prevLock = (t._adminLock && dayKey(t.date) === dayKey(t._adminLock.dk)) ? t._adminLock.fields : {};
  const lockFields = { ...prevLock };
  const changes = [];
  for (const f of ['status', 'teeTime', 'course', 'cutLine', 'myPosition']) {
    if (!(f in fields)) continue;
    let val = fields[f];
    if (f === 'cutLine' || f === 'myPosition') val = Number(val) || 0;
    else val = String(val == null ? '' : val).trim();
    const from = t[f] ?? '';
    if (String(from) === String(val)) { lockFields[f] = 1; continue; } // 값 같아도 관리자 확정으로 잠금
    next[f] = val;
    lockFields[f] = 1;
    changes.push({ field: f, from, to: val });
  }
  // 스페어/휴무로 바꾸면 티오프 정리(일관성) + 티오프도 잠금
  const ns = String(fields.status || t.status || '');
  if ('status' in fields && (['spare', 'waiting', 'near'].includes(ns) || ns === 'off')) {
    if (next.teeTime) changes.push({ field: 'teeTime', from: next.teeTime, to: '' });
    next.teeTime = ''; next.course = ''; lockFields.teeTime = 1; lockFields.course = 1;
  }
  next._adminLock = { dk: dayKey(t.date), fields: lockFields, by: 'admin', at: Date.now() };
  next.updatedAt = Date.now();
  saveToday(next, id);
  // ★교정 로그(모델 원본값 → 관리자 정답) — 정확도 저하 원인 진단용 데이터셋
  if (changes.length) {
    const line = { at: Date.now(), userId: id, name, date: t.date || '', boardArticleId: t.articleId || '', changes };
    try { fs.appendFileSync(path.join(DATA_DIR, 'admin-corrections.jsonl'), JSON.stringify(line) + '\n'); }
    catch (e) { console.error('교정로그 기록 실패:', e.message); }
  }
  // ★교정하자마자 쏘지 않는다. 교정은 되돌릴 수 있어도 알림은 못 되돌린다.
  //  초안만 세우고, 관리자가 문구를 보고 고친 뒤 보낸다.
  let notifyToken = null;
  if (notify && pushReady) {
    const { title, body } = correctionMessage(name, next, changes);
    notifyToken = outbox.stage({ kind: '회원 교정', by: '관리자', items: [{ id, name, title, body, meta: { part: '3' } }] });
  }
  console.log(`✏️ [monitor] 회원 #${id}(${name}) 관리자 교정: ${changes.map((c) => `${c.field} ${c.from || '-'}→${c.to || '-'}`).join(', ') || '(값 동일·잠금만)'}${notifyToken ? ' · 알림 초안 대기' : ''}`);
  res.json({ ok: true, changed: changes.length, notifyToken, locked: Object.keys(lockFields) });
});
// 교정 이력 조회(정확도 진단용) — 최근 200건.
app.get('/api/corrections', gate, (req, res) => {
  try {
    const p = path.join(DATA_DIR, 'admin-corrections.jsonl');
    const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const rows = raw.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json({ ok: true, corrections: rows.slice(-200).reverse() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 배치표 검수: 시스템 판독을 표로 재구성 → 관리자가 원본과 대조해 틀린 칸만 교정 ──
//  교정은 '근원(배치표 판독)' 한 곳에서 → 저장 시 전 회원을 다시 계산해 일관 반영(회원별 꼬임 원천 차단).
//  loadLastBoard·nkey·correctionMsg·correctPart3은 boardcorrect.mjs 한 곳에만 둔다(위 import).
const dutyKind = (code) => { const c = String(code || ''); if (/병가/.test(c)) return '병가'; if (/휴가|연차|반차|월차/.test(c)) return '휴가'; if (/휴무|격리/.test(c)) return '휴무'; return ''; };
// ★쌍둥이 이름 오독 플래그 — 명단 칸 이름이 '회원 본명과 한 글자 차이'인데 그 회원 본명은 명단에 아예 없으면,
//  그 칸이 회원의 오독일 가능성이 큼(서동명↔서동환). 자동 개명은 안 하고(둘 다 실존 캐디) 관리자에게 콕 집어 표시만.
function flagMisreads(rows) {
  const members = activeMembers().map((m) => ({ key: nkey(m.board_name), name: m.board_name })).filter((m) => m.key.length >= 2);
  const rosterKeys = new Set(rows.map((r) => nkey(r.name)).filter(Boolean));
  const ham1 = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length && d <= 1; i++) if (a[i] !== b[i]) d++; return d === 1; };
  for (const r of rows) {
    const k = nkey(r.name);
    if (!k || members.some((m) => m.key === k)) continue;                 // 빈칸/회원 본인이면 스킵
    const suspect = members.find((m) => ham1(m.key, k) && !rosterKeys.has(m.key));  // 회원 본명이 명단에 없어야 오독 후보
    if (suspect) r.misread = suspect.name;
  }
  return rows;
}
// ── 크로스파트 대바 표시 — '실제 배치된 캐디 이름'만으로 단순화(검수 편집 편의). 스왑 판정은 공용 crossparts.mjs. ──
//  예) 2부 '박선하(연승준)' → '연승준'(괄호 안 실제 점유자), 3부 '연승준' 자리 → '박선하'(그 자리를 넘겨받은 owner).
//  ★store 원본은 안 바꾼다(대바 표기 보존 → reconcile 스왑 판정 유지). 바뀐 행엔 rawName(원본)을 남겨,
//   검수 저장 때 이름을 안 고쳤으면 프런트가 rawName을 되돌려 보내 store가 단순화 이름으로 오염되지 않게 한다.
function reflectCrossPartSwaps(part, rows, memberSet) {
  try {
    const swaps = buildCrossPartSwaps(collectPartRosters());
    if (!swaps.length) return;
    for (const r of rows) {
      const disp = actualCaddieName(r.name, part, swaps);
      if (disp !== r.name) {
        r.rawName = r.name; r.name = disp; r.swapSimplified = true;
        if (memberSet) r.isMember = memberSet.has(nkey(disp));   // 단순화된 실제 이름 기준으로 회원 여부 재판정
      }
    }
  } catch { /* noop — 실패해도 원본 rows 그대로 */ }
}
// 판독검증(대시보드 latestBoard·/api/board-parts)의 parts 구조에도 동일 단순화(읽기 전용 표시).
function reflectPartsRows(parts) {
  try {
    if (!parts || typeof parts !== 'object') return;
    const swaps = buildCrossPartSwaps(collectPartRosters());
    if (!swaps.length) return;
    for (const part of Object.keys(parts)) {
      const pd = parts[part]; if (!pd) continue;
      if (Array.isArray(pd.rows)) for (const r of pd.rows) { const disp = actualCaddieName(r && r.name, part, swaps); if (r && disp !== r.name) { r.rawName = r.name; r.name = disp; r.swapSimplified = true; } }
      if (Array.isArray(pd.roster)) pd.roster = pd.roster.map((c) => actualCaddieName(c, part, swaps));
    }
  } catch { /* noop — 실패해도 원본 parts 그대로 */ }
}
app.get('/api/board-review', gate, (req, res) => {
  try {
    const part = String(req.query.part || '3');
    // ★티오프 '칸 전체' 시각 목록 — teeTimes(칸 전체 스캔) ∪ teeGrid 시각. 검수 드롭다운이 모든 시간대를 제공하게.
    const _mn = (t) => { const m = String(t).match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
    const buildDayTimes = (teeTimes, grid) => [...new Set([
      ...(Array.isArray(teeTimes) ? teeTimes : []).map((t) => (String(t).match(/\d{1,2}:\d{2}/) || [''])[0]),
      ...(Array.isArray(grid) ? grid : []).map((g) => (String(g && g.time).match(/\d{1,2}:\d{2}/) || [''])[0]),
    ].filter(Boolean))].sort((a, b) => _mn(a) - _mn(b));
    // ★1·2부 — 메인 파이프라인이 저장한 board 순번표(board-parts-store)에서 3부와 동일한 검수 뷰 구성.
    if (part !== '3') {
      const bp = loadBoardPartsStore();
      const pd = bp && bp.parts && bp.parts[part];
      if (!pd || !Array.isArray(pd.roster) || !pd.roster.length) return res.json({ ok: true, part, board: null });
      const roster = pd.roster, grid = Array.isArray(pd.teeGrid) ? pd.teeGrid : [], crew = pd.crewDuty || {};
      const memberSet = new Set(activeMembers().map((m) => nkey(m.board_name)));
      const teeAt = (p) => { const g = grid.find((x) => Number(x.pos) === p); return g ? { time: (String(g.time).match(/\d{1,2}:\d{2}/) || [''])[0], course: (/IN/i.test(String(g.course)) ? 'IN' : 'OUT') } : { time: '', course: '' }; };
      const gridMax = grid.reduce((mx, g) => (/\d{1,2}:\d{2}/.test(String(g?.time || '')) ? Math.max(mx, Number(g?.pos) || 0) : mx), 0);
      const cutLine = Number(pd.cutoffPosition) || gridMax || 0;
      const maxPos = Math.max(roster.length, grid.reduce((mx, g) => Math.max(mx, Number(g.pos) || 0), 0));
      const rows = [];
      for (let p = 1; p <= maxPos; p++) {
        const t = teeAt(p); const name = roster[p - 1] || '';
        rows.push({ pos: p, name, tee: t.time, course: t.course, isMember: memberSet.has(nkey(name)), duty: dutyKind(crew[nkey(name)]) });
      }
      // ★3부와 같은 규칙 — 수동 지정이 판독을 이긴다. 이제 1·2부에도 부별 수동 지정이 생길 수 있다.
      const boardInterns = (Array.isArray(pd.internTees) ? pd.internTees : []).map((x) => ({ time: (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0], course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') })).filter((x) => x.time);
      const _ikeyP = String(pd._targetISO || bp.targetISO || '').replace(/\D/g, '').slice(0, 8);
      const interns = _ikeyP ? internTeesFor(_ikeyP, boardInterns, part).map((t) => ({ time: t.time, course: /IN/i.test(t.course) ? 'IN' : 'OUT' })) : boardInterns;
      const internSource = _ikeyP && internManualFor(_ikeyP, part) ? '수동' : '자동';
      flagMisreads(rows);   // 쌍둥이 이름 오독 표시(1·2부)
      reflectCrossPartSwaps(part, rows, memberSet);   // 대바 셀을 실제 배치 캐디 이름으로 단순화(rawName 보존)
      return res.json({ ok: true, part, board: {
        articleId: bp.articleId, dateLabel: pd.dateLabel || bp.dateLabel || '', subject: bp.subject || '',
        image: bp.image || '', url: bp.url || '', at: bp.at, corrected: pd._adminCorrected || null,
        syncSig: `${bp.at || ''}|${(pd._adminCorrected && pd._adminCorrected.at) || ''}`,   // 신선도(store 기준)
        uncertain: pd.uncertain || '', teamCount: Number(pd.teamCount) || 0, cutLine, cutoffName: pd.cutoffName || '', rows, interns, boardInterns, internSource,
        dayTimes: buildDayTimes(pd.teeTimes, grid),
      } });
    }
    const lb = loadLastBoard();
    if (!lb || !lb.rawVerdict) return res.json({ ok: true, part, board: null });
    // ★검수 3부도 대시보드와 같은 최신 상태를 본다 — lastboard 스냅샷(얼어있음)에 1번 회원 today.json(적용된 최신본)을 병합.
    //  당추·커트 변동이 대시보드엔 반영되는데 검수만 옛 배치표에 멈추던 근본원인 제거.
    const v = effectivePart3Verdict(lb);
    const roster = Array.isArray(v.part3Roster) ? v.part3Roster : [];
    const grid = Array.isArray(v.teeGrid) ? v.teeGrid : [];
    const crew = v.crewDuty || {};
    const memberSet = new Set(activeMembers().map((m) => nkey(m.board_name)));
    const teeAt = (p) => { const g = grid.find((x) => Number(x.pos) === p); return g ? { time: (String(g.time).match(/\d{1,2}:\d{2}/) || [''])[0], course: (/IN/i.test(String(g.course)) ? 'IN' : 'OUT') } : { time: '', course: '' }; };
    const gridMax = grid.reduce((mx, g) => (/\d{1,2}:\d{2}/.test(String(g?.time || '')) ? Math.max(mx, Number(g?.pos) || 0) : mx), 0);
    const cutLine = Number(v.cutoffPosition) || Number(v.cutLine) || gridMax || 0;
    const maxPos = Math.max(roster.length, grid.reduce((mx, g) => Math.max(mx, Number(g.pos) || 0), 0));
    const rows = [];
    for (let p = 1; p <= maxPos; p++) {
      const t = teeAt(p); const name = roster[p - 1] || '';
      rows.push({ pos: p, name, tee: t.time, course: t.course, isMember: memberSet.has(nkey(name)), duty: dutyKind(crew[nkey(name)]) });
    }
    // ★인턴은 수동 지정이 판독을 이긴다(interns.mjs). 화면에도 '실제로 쓰이는 값'이 그려져야 한다.
    //  판독값만 보여주면, 관리자가 인턴을 건드리지도 않았는데 저장하는 순간 그날 수동 지정이
    //  판독값으로 덮여 사라진다 — 대조판이 같은 사고를 겪고 이미 고친 자리다(boardcorrect.mjs 주석).
    //  boardInterns(사진이 읽은 칸)는 따로 준다. 그게 '실제 배치표의 팀'이고, 저장할 때
    //  팀 없는 칸이 인턴으로 섞여 들어가는 걸 막는 기준이 된다.
    const boardInterns = (Array.isArray(v.internTees) ? v.internTees : []).map((x) => ({ time: (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0], course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') })).filter((x) => x.time);
    const _ikey = keyFromLabel(v.dateLabel || lb.dateLabel || '') || '';
    const interns = _ikey
      ? internTeesFor(_ikey, boardInterns, '3').map((t) => ({ time: t.time, course: /IN/i.test(t.course) ? 'IN' : 'OUT' }))
      : boardInterns;
    const internSource = _ikey && internManualFor(_ikey, '3') ? '수동' : '자동';
    flagMisreads(rows);   // 쌍둥이 이름 오독 표시(3부)
    reflectCrossPartSwaps(part, rows, memberSet);   // 대바 셀을 실제 배치 캐디 이름으로 단순화(rawName 보존)
    // ★원본 이미지: '전체 배치표'(article 본문) 우선. latestImage는 3부만 잘린 당추 변동 크롭이라
    //  관리자가 "옛날/이상한 사진"으로 인지 → 전체판을 원본으로 주고, 변동 크롭은 variantImage로 별도 제공.
    const baseImg = (lb.article && lb.article.images && lb.article.images[0]) || '';
    res.json({ ok: true, part, board: {
      articleId: v._effArticleId || lb.id, dateLabel: v.dateLabel || lb.dateLabel || '', subject: (lb.article && lb.article.subject) || '',
      image: baseImg || lb.latestImage, variantImage: lb.latestImage || '', imageId: lb.id, imageAt: lb.at,
      url: (lb.article && lb.article.url) || '',
      // ★신선도 서명 — 얼어붙은 at 대신 today.json(_t1Sig) 기준 → 당추·커트로 대시보드가 바뀌면 검수도 재렌더.
      syncSig: `${v._t1Sig || ''}|${(v._adminCorrected && v._adminCorrected.at) || ''}`,
      at: lb.at, corrected: v._adminCorrected || null, uncertain: v._uncertain || '', teamCount: Number(v.teamCount) || 0,
      gridFlaw: (v._gridFlaw && v._gridFlaw.text) || '',   // 티오프표 자가 검산 — 표가 앞뒤가 안 맞는다고 스스로 말한 내용
      cutLine, cutoffName: v.cutoffName || '', rows, interns, boardInterns, internSource,
      dayTimes: buildDayTimes(v.teeTimes, grid),
    } });
  } catch (e) { console.error('board-review 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
// ★교정 정정알림 — 저장 시 '실제 바뀐 회원'만 골라 문구를 만들되, 즉시 발송하지 않고
//  토큰에 담아 관리자에게 미리보기로 돌려준다. /api/board-notify 로 확인해야 실제 발송.
// currentStateMsg는 boardpush.mjs에 있다 — 자동 발송과 손으로 보내는 알림이 같은 문구를 써야 한다.
function boardCtxForPart(part) {
  if (part === '3') { const lb = loadLastBoard(); if (!lb || !lb.rawVerdict) return null; const v = lb.rawVerdict; return { articleId: String(lb.id), dk: dayKey(v.dateLabel || lb.dateLabel || ''), roster: v.part3Roster || [], dateLabel: v.dateLabel || lb.dateLabel || '' }; }
  const bp = loadBoardPartsStore(); const pd = bp && bp.parts && bp.parts[part]; if (!pd || !Array.isArray(pd.roster)) return null;
  return { articleId: String(bp.articleId), dk: dayKey(pd.dateLabel || bp.dateLabel || ''), roster: pd.roster || [], dateLabel: pd.dateLabel || bp.dateLabel || '' };
}
// 대바(크로스파트)용 — 부의 명단을 읽고 쓸 수 있는 핸들. 3부=lastboard, 1·2부=board-parts-store.
function loadPartBoardRW(part) {
  const p = String(part);
  if (p === '3') {
    const lb = loadLastBoard(); if (!lb || !lb.rawVerdict) return null;
    const v = lb.rawVerdict; if (!Array.isArray(v.part3Roster)) v.part3Roster = [];
    return { part: '3', roster: v.part3Roster, article: lb.article || { id: lb.id, images: [], comments: [] },
      verdict: () => v, dateLabel: v.dateLabel || lb.dateLabel || '', articleId: String(lb.id),
      cutLine: Number(v.cutoffPosition) || Number(v.cutLine) || 0,
      save: () => { v._adminCorrected = { at: Date.now(), by: 'admin' }; lb.rawVerdict = v; fs.writeFileSync(path.join(DATA_DIR, 'lastboard.json'), JSON.stringify(lb)); } };
  }
  const bp = loadBoardPartsStore(); const pd = bp && bp.parts && bp.parts[p]; if (!pd || !Array.isArray(pd.roster)) return null;
  const article = bp.article || { id: bp.articleId, subject: bp.subject || '', images: bp.image ? [bp.image] : [], comments: [] };
  return { part: p, roster: pd.roster, article,
    verdict: () => ({ part3Roster: pd.roster, teeGrid: pd.teeGrid || [], crewDuty: pd.crewDuty || {}, teamCount: Number(pd.teamCount) || 0,
      cutoffPosition: Number(pd.cutoffPosition) || Number(pd.cutLine) || null, cutoffName: pd.cutoffName || '', rosterReliable: true,
      dateLabel: pd.dateLabel || bp.dateLabel || '', internTees: pd.internTees || [], internCount: pd.internCount || 0 }),
    dateLabel: pd.dateLabel || bp.dateLabel || '', articleId: String(bp.articleId),
    cutLine: Number(pd.cutoffPosition) || Number(pd.cutLine) || 0,
    save: () => { pd._adminCorrected = { at: Date.now(), by: 'admin' }; saveBoardPartsStore(bp); } };
}
// 대바로 어떤 부를 '떠난' 회원의 그 부 상태 정리. 1·2부=파일 삭제, 3부(베이스)=blank로(근무 부가 포커스 이김).
function leaveMemberPart(userId, part, dateLabel, articleId) {
  const p = String(part);
  if (p === '1' || p === '2') { clearTodayPart(userId, p); return; }
  const t = { date: dateLabel || '', myPosition: null, status: 'unknown', teeTime: '', course: '', cutoffName: '', cutoffPosition: null,
    timeline: [], updatedAt: Date.now(), articleId: String(articleId || ''), _leftBoard: true,
    _adminLock: { dk: dayKey(dateLabel || ''), articleId: String(articleId || ''), fields: { status: 1, teeTime: 1, course: 1, cutLine: 1, myPosition: 1, offType: 1 }, by: 'admin', at: Date.now() } };
  saveToday(t, userId, '3');
}
const bareName = (s) => String(s || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim();
// ★발송은 전부 이 관문을 지난다(outbox) — 초안 → 미리보기 → 수정 → 발송.
//  meta에 부를 실어 두면 발송 뒤 같은 장부(markNotified)에 적을 수 있다.
function stashNotify(pending, part = '3', kind = '배치표 정정') {
  return outbox.stage({
    kind, part, by: '관리자',
    items: (pending || []).map((x) => ({ ...x, meta: { part: String(part) } })),
  });
}
// ★당번·벌당 수동 교정 — 하단 배정표 판독이 틀렸거나(부분 크롭 등) 구두 지시로 바뀌었을 때.
//  body: { userId, kind:'당번'|'벌당'|'', part:'1'|'2'|'3' } · kind 빈값 = 해제.
app.post('/api/duty-set', gate, (req, res) => {
  const id = Number(req.body?.userId) || 0;
  if (!id) return res.status(400).json({ error: 'userId 필요' });
  const kind = String(req.body?.kind ?? '');
  const part = String(req.body?.part ?? '');
  if (kind && !dutyMod.DUTY_KINDS.includes(kind)) return res.status(400).json({ error: '종류는 당번 또는 벌당' });
  const today = todayISOkst();
  dutyMod.saveDuty(id, today, kind, part, 'admin');   // ★관리자 확정 — 자동판독이 덮지 못함
  const duty = dutyMod.dutyForToday(id, today);
  // 받은 원본을 함께 남긴다 — '저장을 눌렀는데 해제됨' 류 신고를 즉시 판별하기 위해.
  console.log(`✏️ [monitor] 회원 #${id} 당번 교정: ${duty ? `${duty.part}부 ${duty.kind}(${duty.start}~${duty.end})` : '해제'} · 수신값 kind=[${kind}] part=[${part}]`);
  res.json({ ok: true, duty });
});

// ★자동이 이미 보낸 사람은 '손으로 보낼 목록'에서 뺀다 — 안 빼면 같은 사람 폰이 두 번 울린다.
//  자동이 멈췄거나(배치 깨짐) 건너뛴 사람은 그대로 남는다 — 그게 버튼이 있는 이유다.
const pendingFor = (pending, auto) => {
  const done = new Set(auto ? auto.sent.concat(auto.queued) : []);
  return (pending || []).filter((p) => !done.has(p.id)).map((p) => ({ name: p.name, title: p.title, body: p.body }));
};
const tokenFor = (pending, auto, notify, part = '3') => {
  if (!pushReady) return null;
  const done = new Set(auto ? auto.sent.concat(auto.queued) : []);
  const rest = (pending || []).filter((p) => !done.has(p.id));
  if (!rest.length) return null;
  if (!notify && !auto) return null;          // 알림을 안 만들라고 한 경우
  return stashNotify(rest, part);
};
const autoBrief = (a) => (a ? { on: a.ok, held: a.held, reason: a.reason,
  sent: a.sent.length, queued: a.queued.length, skipped: a.skipped.length } : null);

// ── 당겨오기 뒷정리 ────────────────────────────────────────────
//  리버힐 규칙: 어느 부의 가용 캐디가 팀 수보다 모자라면 옆 부에서 원번 근무자를 당겨온다.
//  ★당겨오기는 '추가'가 아니라 '이동'이다 — 원래 부에서 빠져야 한다. 안 빼면 그 부의 순번이
//   그 자리부터 통째로 한 칸씩 밀리고, 뒤 사람들이 남의 티오프를 받는다.
//   실측 2026-08-21: 강경순을 1부로 당겨왔는데 2부에 남아 있어 2부 4번 뒤 16명의 티오프가 어긋났고,
//   스페어 맨 앞(박신훈)이 근무로 올라오지 못했다.
//  ★관리자가 검수에서 고친 직후에만 돈다(자동 판독 뒤에는 안 돈다) — 판독이 흔들리는 날
//   시스템이 스스로 명단에서 사람을 빼면 그게 더 위험하다.
function partRowsFromStore(part) {
  let roster = [], cut = 0, grid = [];
  if (String(part) === '3') {
    const lb = loadJSON('lastboard.json', null);
    const v = lb && lb.rawVerdict ? effectivePart3Verdict(lb) : null;
    if (!v) return null;
    roster = (v.part3Roster || []).slice(); cut = Number(v.cutoffPosition) || 0; grid = v.teeGrid || [];
  } else {
    const pd = loadBoardPartsStore()?.parts?.[String(part)];
    if (!pd) return null;
    roster = (pd.roster || []).slice(); cut = Number(pd.cutLine || pd.cutoffPosition) || 0; grid = pd.teeGrid || [];
  }
  const slot = {};
  for (const g of grid) {
    const t = (String(g.time).match(/\d{1,2}:\d{2}/) || [''])[0];
    if (t) slot[Number(g.pos)] = { tee: t, course: /IN/i.test(g.course) ? 'IN' : 'OUT' };
  }
  return { roster, cut, slot };
}

async function reconcilePulls(justCorrected, token) {
  const parts = {};
  for (const p of ['1', '2', '3']) {
    const r = partRowsFromStore(p);
    if (r && r.roster.length) parts[p] = { roster: r.roster, cut: r.cut, _slot: r.slot };
  }
  if (Object.keys(parts).length < 2) return [];
  const who = resolveWorkParts(parts);
  const done = [];
  for (const w of Object.values(who)) {
    if (w.kind !== 'pulled' || !w.from || !parts[w.from]) continue;
    if (String(w.from) === String(justCorrected)) continue;   // 방금 고친 부는 그대로 둔다(관리자 의도)
    const src = parts[w.from];
    const at = src.roster.findIndex((c) => String(c || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim() === w.name);
    if (at < 0) continue;
    const after = src.roster.slice(0, at).concat(src.roster.slice(at + 1));
    // ★팀 수(커트)는 예약이 정한다 — 캐디가 빠져도 팀은 안 준다. 스페어 맨 앞이 근무로 올라온다.
    const rows = after.map((cell, i) => {
      const pos = i + 1, sl = pos <= src.cut ? src._slot[pos] : null;
      return { pos, name: String(cell || ''), tee: sl ? sl.tee : '', course: sl ? sl.course : '' };
    });
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/board-correct`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-monitor-token': token || '' },
        body: JSON.stringify({ part: w.from, rows, interns: [], cutLine: src.cut,
          notify: false, autoNotify: false, movedOut: [{ name: w.name, to: w.parts[0] }], _noReconcile: true }),
      });
      const j = await r.json();
      if (!j.ok) { console.error(`🔁 [당겨오기] ${w.name} ${w.from}부 정리 실패: ${j.error || '?'}`); continue; }
      console.log(`🔁 [당겨오기] ${w.name}: ${w.from}부 → ${w.parts[0]}부 — ${w.from}부 명단에서 빼고 순번 당김(회원 ${j.updated}명 재계산, 알림 없음)`);
      done.push({ name: w.name, from: w.from, to: w.parts[0], updated: j.updated });
    } catch (e) { console.error(`🔁 [당겨오기] ${w.name} 정리 오류: ${e.message}`); }
  }
  return done;
}

// ── 판본 서명 ── 이 배치표가 '내가 불러온 그것' 그대로인가.
//  ★세 화면(배치표 검수·대조판·예약 구성판)이 모두 브라우저가 들고 있는 배치표를 통째로 되쓴다.
//   그 사이 다른 화면이 고쳤거나 새 배치표가 판독됐어도 서버는 묻지 않았고, 나중에 저장한 쪽이
//   앞선 수정을 경고 없이 지웠다. 검수 탭에만 이 검사가 있었는데(클라이언트), 그건 그 화면 하나만
//   지킨다. 문이 하나(board-correct)니 검사도 문에 달아 세 화면이 함께 물려받게 한다.
//  board-review가 내려주는 syncSig와 같은 식이라야 한다 — 다르면 검사가 늘 걸려 아무도 저장 못 한다.
function boardSigOf(part) {
  const p = String(part);
  try {
    if (p !== '3') {
      const bp = loadBoardPartsStore();
      const pd = bp && bp.parts && bp.parts[p];
      if (!pd) return '';
      return `${bp.at || ''}|${(pd._adminCorrected && pd._adminCorrected.at) || ''}`;
    }
    const lb = loadLastBoard();
    if (!lb || !lb.rawVerdict) return '';
    const v = effectivePart3Verdict(lb);
    return `${v._t1Sig || ''}|${(v._adminCorrected && v._adminCorrected.at) || ''}`;
  } catch { return ''; }
}

app.post('/api/board-correct', gate, async (req, res) => {
  const part = String(req.body?.part || '3');
  const _tok = req.query.k || req.get('x-monitor-token') || '';
  const _skipRec = !!req.body?._noReconcile;   // 뒷정리가 부른 요청 — 다시 뒷정리하지 않는다(무한 반복 방지)
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  const interns = Array.isArray(req.body?.interns) ? req.body.interns : [];
  // 화면이 들고 있는 인턴 전부(배치표에 팀이 없는 칸 포함) — 수동 지정을 통째로 지우지 않기 위해.
  const allInterns = Array.isArray(req.body?.allInterns) ? req.body.allInterns : null;
  const cutLine = Number(req.body?.cutLine) || 0;
  const notify = !!req.body?.notify;
  const autoNotify = !!req.body?.autoNotify;
  const dutySet = (req.body?.dutySet && typeof req.body.dutySet === 'object') ? req.body.dutySet : null;
  // 부 간 대바로 이 부를 떠난 사람 — '명단에서 빠짐'과 다른 사실이다(아래 movedTo 주석).
  const movedOut = Array.isArray(req.body?.movedOut) ? req.body.movedOut : null;
  const movedIn = Array.isArray(req.body?.movedIn) ? req.body.movedIn : null;
  if (!rows) return res.status(400).json({ ok: false, error: 'rows 필요' });
  // ★불러온 뒤 배치표가 바뀌었으면 저장하지 않는다 — 덮어쓰기는 되돌릴 수 없다.
  //  baseSig를 안 싣는 호출(옛 화면·스크립트)은 그대로 통과시킨다. 검사를 강제하면
  //  아직 안 고친 화면이 통째로 멎는다 — 문을 좁히되 잠가버리진 않는다.
  {
    const baseSig = String(req.body?.baseSig || '');
    const nowSig = boardSigOf(part);
    if (baseSig && nowSig && baseSig !== nowSig) {
      console.warn(`🚫 [monitor] ${part}부 교정 거절 — 그 사이 배치표가 바뀌었다(불러온 판 ${baseSig} · 지금 ${nowSig})`);
      return res.status(409).json({ ok: false, stale: true, nowSig,
        error: '그 사이 배치표가 바뀌었습니다. 새로고침해서 최신본을 보고 다시 고쳐주세요.' });
    }
  }
  // ★깨진 배치표는 저장 자체를 안 한다. 8/18에 같은 시각에 두세 명이 겹친 채로 반영돼
  //  다섯 명이 화면에서 사라졌다. 그때 막은 건 브라우저뿐이었다 — 브라우저는 우회할 수 있고,
  //  이 API를 부르는 길은 대조판 말고도 있다. 세는 일은 서버가 한 번 더 한다.
  {
    const bad = boardIntegrity(rows, cutLine);
    if (bad.length) {
      console.error(`🚫 [monitor] ${part}부 교정 거절 — ${bad.join(' / ')}`);
      return res.status(400).json({ ok: false, error: `배치가 어긋나 저장하지 않았습니다 — ${bad[0]}${bad.length > 1 ? ` 외 ${bad.length - 1}건` : ''}`, problems: bad });
    }
  }
  // ★1·2부 — board-parts-store에 교정 반영 + 그 부 회원 today{part}.json 재계산(3부는 아래 lastboard 경로).
  if (part !== '3') {
    const bp = loadBoardPartsStore();
    const pd = bp && bp.parts && bp.parts[part];
    if (!pd) return res.status(400).json({ ok: false, error: `${part}부 배치표가 아직 없어요.` });
    const origRoster = Array.isArray(pd.roster) ? pd.roster.slice() : [];
    const origGrid = {}; (pd.teeGrid || []).forEach((g) => { origGrid[Number(g.pos)] = (String(g.time).match(/\d{1,2}:\d{2}/) || [''])[0]; });
    const crew = { ...(pd.crewDuty || {}) };
    const roster = [], grid = [], cellDiffs = [];
    for (const r of rows) {
      const p = Number(r.pos); if (!p) continue;
      const nm = String(r.name || '').trim();
      const teeM = String(r.tee || '').match(/\d{1,2}:\d{2}/); const tee = teeM ? teeM[0] : '';
      const course = /IN/i.test(String(r.course || '')) ? 'IN' : (tee ? 'OUT' : '');
      roster[p - 1] = nm;
      if (tee) grid.push({ pos: p, time: tee, course: course || 'OUT' });
      // ★근태는 '보낸 행'만 만진다(boardcorrect와 같은 규칙). 안 보내는 것과 '해제하라'는 다르다 —
      //  근태를 안 싣는 화면이 반영하면 판독이 제대로 읽어둔 휴무가 통째로 지워졌다.
      const key = nkey(nm);
      if (key && r.duty !== undefined) {
        const d = String(r.duty || '');
        if (/병가|휴무|휴가/.test(d)) { if (crew[key] !== d) cellDiffs.push({ pos: p, field: 'duty', model: crew[key] || '', admin: d }); crew[key] = d; }
        else if (/휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[key] || ''))) { cellDiffs.push({ pos: p, field: 'duty', model: crew[key], admin: '' }); crew[key] = ''; }
        const legacy = String(nm).replace(/\s/g, '');
        if (legacy !== key && crew[legacy] !== undefined && /휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[legacy]))) delete crew[legacy];
      }
      if (nm !== (origRoster[p - 1] || '')) cellDiffs.push({ pos: p, field: 'name', model: origRoster[p - 1] || '', admin: nm });
      if (tee !== (origGrid[p] || '')) cellDiffs.push({ pos: p, field: 'tee', model: origGrid[p] || '', admin: tee });
    }
    const iTees = interns.map((x) => { const t = (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0]; return t ? { time: t, course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') } : null; }).filter(Boolean);
    // ★명단 밖 사람의 근태(3부와 같은 규칙) — 휴무자는 순번 명단에 없다.
    for (const [nm2, d3] of Object.entries(dutySet || {})) {
      const k = nkey(nm2); if (!k) continue;
      const v2 = String(d3 || '');
      if (/병가|휴무|휴가/.test(v2)) { if (crew[k] !== v2) cellDiffs.push({ pos: 0, field: 'duty', name: nm2, model: crew[k] || '', admin: v2 }); crew[k] = v2; }
      else if (/휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[k] || ''))) { cellDiffs.push({ pos: 0, field: 'duty', name: nm2, model: crew[k], admin: '' }); crew[k] = ''; }
    }
    pd.roster = roster; pd.teeGrid = grid; pd.crewDuty = crew; pd.internTees = iTees; pd.internCount = iTees.length;
    // ★팀 수도 같이 옮긴다 — 근무선이 곧 팀 수다. 여기를 안 고치면 헤더 판독값(예: 30)이
    //  그대로 남아 앱이 '확정선 38번'과 '30팀 편성'을 한 화면에 같이 띄운다(실제로 그랬다).
    if (cutLine) { pd.cutLine = cutLine; pd.cutoffPosition = cutLine; pd.teamCount = cutLine; pd.cutoffName = roster[cutLine - 1] || pd.cutoffName || ''; }
    {   // ★3부와 같은 규칙 — 사람이 고친 칸만 적어 둔다(보존은 그 칸에만 걸린다).
      const keptNames = { ...((pd._adminCorrected && pd._adminCorrected.names) || {}) };
      for (const c of cellDiffs) if (c.field === 'name' && Number(c.pos) > 0) keptNames[c.pos] = c.admin;
      pd._adminCorrected = { at: Date.now(), by: 'admin', names: keptNames };
    }
    pd.rosterReliable = true; delete pd.uncertain;
    saveBoardPartsStore(bp);
    if (cellDiffs.length) {
      const line = { at: Date.now(), type: 'board', part, boardArticleId: bp.articleId, date: pd.dateLabel || bp.dateLabel || '', cutLine, changes: cellDiffs };
      try { fs.appendFileSync(path.join(DATA_DIR, 'admin-corrections.jsonl'), JSON.stringify(line) + '\n'); } catch (e) { console.error('교정로그 실패:', e.message); }
    }
    // 그 부 회원 today{part}.json 재계산(3부 경로와 동일 구조, 부 창·부 슬롯).
    const win = partWindow(part);
    const article = bp.article || { id: bp.articleId, subject: bp.subject || '', images: bp.image ? [bp.image] : [], comments: [] };
    const vpart = { part3Roster: roster, teeGrid: grid, crewDuty: crew, teamCount: Number(pd.teamCount) || 0,
      cutoffPosition: cutLine || null, cutoffName: pd.cutoffName || '', rosterReliable: true,
      dateLabel: pd.dateLabel || bp.dateLabel || '', internTees: iTees, internCount: iTees.length };
    const rosterNk = new Set(roster.map(nkey).filter(Boolean));
    const diffPositions = new Set(cellDiffs.map((d) => Number(d.pos)));   // 관리자가 실제 손댄 순번(이름·티오프·근태)
    const dk = dayKey(vpart.dateLabel);
    let updated = 0; const pending = [];
    // ★부 간 대바로 이 부를 떠난 사람은 '휴무'가 아니라 '이 부엔 없음'이다.
    //  명단에서 빠졌다는 이유로 다시 계산하면 off가 나오는데, 3부가 off면 대시보드가 그 회원의
    //  다른 부 카드까지 지운다(rounds.mjs primaryOff). 대바로 옮겨간 사람이 앱에서 휴무가 되면
    //  정확히 반대의 사실이 표시된다 — 그 사람은 오늘 출근한다.
    const movedTo = new Map((movedOut || []).map((x) => [nkey(x && x.name), String((x && x.to) || '')]).filter(([k]) => k));
    for (const m of activeMembers()) {
      const today = loadToday(m.id, part) || {};
      const hadState = !!(today.myPosition || today.teeTime || (today.status && today.status !== 'unknown'));
      if (movedTo.has(nkey(m.board_name))) {
        const to = movedTo.get(nkey(m.board_name));
        const next = { ...today, date: vpart.dateLabel || today.date || '', status: 'unknown',
          myPosition: 0, teeTime: '', course: '', cutLine: null,
          _swappedOut: { to: to, at: Date.now(), by: 'admin' }, updatedAt: Date.now() };
        delete next.offType; delete next._offReason;
        next._adminLock = { dk, articleId: String(bp.articleId), fields: { status: 1, teeTime: 1, course: 1, cutLine: 1, myPosition: 1, offType: 1 }, by: 'admin', at: Date.now(), part };
        saveToday(next, m.id, part); updated++;
        console.log(`🔁 [monitor] ${m.board_name}: ${part}부 → ${to}부 대바(${part}부 상태 비움)`);
        continue;
      }
      if (!rosterNk.has(nkey(m.board_name)) && !hadState) continue;   // 이 부와 무관 + 기존 상태도 없음 → 건드리지 않음
      const member = { name: m.board_name, part, commuteMin: Number(m.commute_min), teeMin: win.min, teeMax: win.max };
      let next;
      // ★잠금은 '자동 재판독이 관리자 교정을 덮지 못하게' 하는 장치다. 관리자 본인의 다음 교정까지
      //  막으면 안 된다. 실측 2026-08-21: 22:54 교정으로 걸린 잠금 때문에 그 다음 교정(강경순을
      //  2부에서 빼고 순번을 당김)이 회원 카드에 반영되지 않았다 — 명단은 바뀌었는데 사람은 옛 티오프를
      //  들고 있었다. 그래서 여기서는 잠금을 벗기고 다시 계산하고, 바뀐 사람에게 새로 건다(아래).
      const base = { ...today }; delete base._adminLock;
      try {
        const mout = interpretForMember(article, JSON.parse(JSON.stringify(vpart)), member, base);
        next = applyVerdict(base, mout.rawVerdict, article, { teeMin: win.min, teeMax: win.max, name: m.board_name, part }).next;
      } catch (e) { console.error(`${part}부교정 재계산 오류(회원 ${m.id}):`, e.message); continue; }
      const isOff = next.status === 'off';
      const pos = Number(next.myPosition) || 0;
      if (!isOff && pos > 0 && cutLine > 0) {
        next.cutLine = cutLine;
        const hasTee = next.teeTime && /\d{1,2}:\d{2}/.test(String(next.teeTime));
        const inWork = pos <= cutLine;
        next.status = inWork ? (hasTee ? 'assigned' : 'work') : 'spare';
        if (!inWork) { next.teeTime = ''; next.course = ''; }
      }
      // ★'실제 바뀐 회원만' 잠근다 — 전 회원 잠금은 이후 같은 배치표 변동(당추 등)까지 얼려버림(이수련 동결 사고).
      //  판정: 이 교정으로 내 status/티오프/순번이 달라졌거나, 내 순번 칸이 직접 교정된(cellDiff) 경우만.
      delete next._adminLock;
      const _chg = today.status !== next.status || String(today.teeTime || '') !== String(next.teeTime || '') || Number(today.myPosition || 0) !== pos;
      if (_chg || diffPositions.has(pos)) {
        next._adminLock = { dk, articleId: String(bp.articleId), fields: { status: 1, teeTime: 1, course: 1, cutLine: 1, myPosition: 1, offType: 1 }, by: 'admin', at: Date.now(), part };
      }
      next.updatedAt = Date.now();
      const wasWait = ['spare', 'waiting', 'near'].includes(today.status), wasWork = ['work', 'assigned', 'your_turn'].includes(today.status), wasOff = today.status === 'off';
      const nowWork = ['work', 'assigned', 'your_turn'].includes(next.status), nowSpare = ['spare', 'waiting', 'near'].includes(next.status), nowOff = next.status === 'off';
      saveToday(next, m.id, part); updated++;
      if (notify) {
        const pl = part === '1' ? '1부(조출)' : `${part}부`;
        const cm = correctionMsg(pl, m.board_name, { wasWait, wasOff, wasWork, nowWork, nowSpare, nowOff, pos, oldTee: today.teeTime || '', newTee: next.teeTime || '' });
        if (cm) pending.push({ id: m.id, name: m.board_name, title: cm.title, body: cm.body });
      }
    }
    const notifyToken = (notify && pushReady) ? stashNotify(pending) : null;
    console.log(`📋 [monitor] ${part}부 배치표 #${bp.articleId} 교정: 칸 ${cellDiffs.length}·인턴 ${iTees.length}·커트 ${cutLine} → 재계산 ${updated}명${pending.length ? ` · 정정대상 ${pending.length}명(발송대기)` : ''}`
      + ((movedOut || []).length || (movedIn || []).length
        ? ` · 부 간 대바 나감 ${(movedOut || []).map((x) => `${x.name}→${x.to}부`).join(',') || '-'} / 들어옴 ${(movedIn || []).map((x) => `${x.from}부→${x.name}`).join(',') || '-'}` : ''));
    const auto = autoNotify ? await autoNotifyPart(part, { rows, cutLine, by: '대조판 반영' }) : null;
    // ★당겨온 사람이 원래 부에 남아 있으면 여기서 빠진다 — 관리자가 두 번 일하지 않게.
    const pulls = _skipRec ? [] : await reconcilePulls(part, _tok);
    return res.json({ ok: true, cellChanges: cellDiffs.length, interns: iTees.length, updated, pulls,
      pending: pendingFor(pending, auto), notifyToken: tokenFor(pending, auto, notify, part), auto: autoBrief(auto) });
  }
  // ★3부 교정 본체는 src/boardcorrect.mjs 한 곳에만 있다 — 복구 스크립트도 같은 함수를 쓴다.
  let out;
  try { out = correctPart3({ rows, interns, allInterns, cutLine, notify, dutySet, movedOut }); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const auto = autoNotify ? await autoNotifyPart('3', { rows, cutLine, by: '대조판 반영' }) : null;
  const pulls3 = _skipRec ? [] : await reconcilePulls('3', _tok);
  res.json({ ok: true, cellChanges: out.cellChanges, interns: out.interns, updated: out.updated, pulls: pulls3,
    pending: pendingFor(out.pending, auto), notifyToken: tokenFor(out.pending, auto, notify, '3'), auto: autoBrief(auto) });
});

// ★교정 정정알림 확정 발송 — board-correct가 돌려준 notifyToken을 관리자가 미리보기 후 확인하면 실제 발송.
app.post('/api/board-notify', gate, async (req, res) => {
  const token = String(req.body?.token || req.query.token || '');
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
  const r = await outbox.send(token, ids);
  if (r.error) return res.status(r.code || 400).json({ ok: false, error: r.error });
  // ★보냈다는 사실을 자동 경로와 같은 장부에 적는다 — 안 적으면 자동이 곧바로 같은 말을 또 한다.
  //  기기가 없어 못 닿은 사람도 적는다: 알림을 만들었다는 사실은 같고, 안 적으면 자동이 다시 시도한다.
  for (const it of r.ok.concat(r.none)) {
    const part = String((it.meta && it.meta.part) || '3');
    const t = (part === '3' ? loadToday(it.id) : loadToday(it.id, part)) || {};
    markNotified(it.id, part, t);
  }
  res.json({ ok: true, sent: r.sent, total: r.total, none: r.none.length, failed: r.failed.length });
});

// ── 발송 관문 — 미리보기 · 문구 수정 · 취소 ──
//  ★보내기 전에 '무엇이 누구 폰에 뜨는지'를 볼 수 있어야 한다. 발송은 되돌릴 수 없다.
app.get('/api/outbox', gate, (req, res) => {
  const v = outbox.peek(String(req.query.token || ''));
  if (!v) return res.status(404).json({ ok: false, error: '대기 중인 알림이 없어요(이미 보냈거나 만료됐습니다).' });
  res.json({ ok: true, ...v, kinds: NOTIFY_KINDS });   // 종류 목록도 같이 — 화면이 또 물으러 오지 않게
});
app.post('/api/outbox-edit', gate, (req, res) => {
  const { token, id, title, body, pick } = req.body || {};
  const v = outbox.editItem(String(token || ''), id, { title, body, pick });
  if (!v) return res.status(404).json({ ok: false, error: '그 대기건을 찾을 수 없어요.' });
  res.json({ ok: true, item: v });
});
// 회원 한 명의 문구 재료 — 그 부의 오늘 상태에서 뽑는다.
//  ★종류를 바꿀 때 문구를 화면이 짓지 않는다. 화면이 지으면 서버가 보내는 말과 갈라진다.
function notifyCtx(id, part) {
  const p = String(part || '3');
  const m = activeMembers().find((x) => x.id === Number(id)) || {};
  const t = (p === '3' ? loadToday(Number(id)) : loadToday(Number(id), p)) || {};
  return notifyContext(p, m.board_name || '회원', t);
}
app.get('/api/notify-kinds', gate, (req, res) => res.json({ ok: true, kinds: NOTIFY_KINDS }));

// ── 종류 바꾸기 ── 그 회원의 지금 상태로 문구를 다시 쓴다.
//  ★'자유 문구'는 글자를 지우지 않는다 — 직접 쓰겠다는 뜻이지 비우겠다는 뜻이 아니다.
app.post('/api/outbox-retext', gate, (req, res) => {
  const { token, id, kind } = req.body || {};
  const cur = outbox.peek(String(token || ''));
  if (!cur) return res.status(404).json({ ok: false, error: '대기 중인 알림이 없어요(이미 보냈거나 만료됐습니다).' });
  const it = cur.items.find((x) => x.id === Number(id));
  if (!it) return res.status(404).json({ ok: false, error: '그 회원을 찾을 수 없어요.' });
  const patch = String(kind) === 'free' ? { kind: 'free' } : { kind, ...composeNotify(kind, notifyCtx(id, it.part)) };
  const v = outbox.editItem(token, id, patch);
  if (!v) return res.status(404).json({ ok: false, error: '그 대기건을 찾을 수 없어요.' });
  res.json({ ok: true, item: v });
});

// ── 새 알림 쓰기 ── 종류와 받는 사람을 골라 처음부터 만든다(관제 화면).
app.post('/api/outbox-compose', gate, (req, res) => {
  try {
    const part = String(req.body?.part || '3');
    const kind = String(req.body?.kind || 'state');
    const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean));
    const freeTitle = String(req.body?.title || '').trim();
    const freeBody = String(req.body?.body || '').trim();
    if (!ids.size) return res.status(400).json({ ok: false, error: '받는 회원을 한 명 이상 고르세요.' });
    if (!pushReady) return res.status(400).json({ ok: false, error: '푸시 발송 준비가 안 됐어요(VAPID 키 확인).' });
    if (kind === 'free' && !(freeTitle && freeBody)) return res.status(400).json({ ok: false, error: '자유 문구는 제목과 내용을 모두 적어주세요.' });
    const items = [];
    for (const m of activeMembers()) {
      if (!ids.has(m.id)) continue;
      const t = kind === 'free' ? { title: freeTitle, body: freeBody } : composeNotify(kind, notifyCtx(m.id, part));
      if (!t.title && !t.body) continue;
      items.push({ id: m.id, name: m.board_name, title: t.title, body: t.body, kind, meta: { part } });
    }
    const token = outbox.stage({ kind: '직접 작성', part, by: '관리자', items });
    if (!token) return res.status(400).json({ ok: false, error: '보낼 내용이 없어요.' });
    res.json({ ok: true, notifyToken: token, count: items.length });
  } catch (e) { console.error('outbox-compose 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});

// ── 여러 명에게 같은 문구로 ── 고른 회원 전부의 제목·본문을 한 번에 덮는다.
app.post('/api/outbox-bulk', gate, (req, res) => {
  const { token, ids, title, body } = req.body || {};
  if (!String(title || '').trim() || !String(body || '').trim()) return res.status(400).json({ ok: false, error: '제목과 내용을 모두 적어주세요.' });
  const r = outbox.bulkEdit(String(token || ''), { ids: Array.isArray(ids) ? ids : null, title, body });
  if (!r) return res.status(404).json({ ok: false, error: '대기 중인 알림이 없어요(이미 보냈거나 만료됐습니다).' });
  res.json({ ok: true, ...r });
});
app.post('/api/outbox-merge', gate, (req, res) => {
  const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens.map(String) : [];
  const token = outbox.merge(tokens);
  if (!token) return res.status(404).json({ ok: false, error: '합칠 대기건이 없어요(이미 보냈거나 만료됐습니다).' });
  res.json({ ok: true, token });
});
app.post('/api/outbox-drop', gate, (req, res) => {
  res.json({ ok: true, dropped: outbox.drop(String(req.body?.token || '')) });
});

// ★사후 정정 알림 — 이미 저장된 교정에 대해, 현재 배치표 기준 대상 회원 목록을 돌려준다.
//  교정으로 실제 바뀐 회원(_adminLock 일치)은 sel:true로 미리 체크 제안. 관리자가 확인·선택해 발송.
app.get('/api/board-notify-candidates', gate, (req, res) => {
  try {
    const part = String(req.query.part || '3');
    const ctx = boardCtxForPart(part);
    if (!ctx) return res.json({ ok: true, part, candidates: [] });
    const rosterNk = new Set(ctx.roster.map(nkey).filter(Boolean));
    const pl = part === '1' ? '1부(조출)' : `${part}부`;
    const out = [];
    for (const m of activeMembers()) {
      const today = (part === '3' ? loadToday(m.id) : loadToday(m.id, part)) || {};
      const inRoster = rosterNk.has(nkey(m.board_name));
      const hasState = !!(today.myPosition || today.teeTime || (today.status && today.status !== 'unknown'));
      if (!inRoster && !hasState) continue;
      const cm = currentStateMsg(pl, m.board_name, today);
      const locked = !!(today._adminLock && String(today._adminLock.articleId) === ctx.articleId);
      out.push({ id: m.id, name: m.board_name, title: cm.title, body: cm.body, sel: locked });
    }
    res.json({ ok: true, part, dateLabel: ctx.dateLabel, candidates: out });
  } catch (e) { console.error('notify-candidates 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/board-notify-adhoc', gate, async (req, res) => {
  try {
    const part = String(req.body?.part || '3');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ ok: false, error: '받는 회원을 한 명 이상 선택해주세요.' });
    if (!pushReady) return res.status(400).json({ ok: false, error: '푸시 발송 준비가 안 됐어요(VAPID 키 확인).' });
    const pl = part === '1' ? '1부(조출)' : `${part}부`;
    const idset = new Set(ids);
    // ★고른 즉시 보내지 않는다 — 초안만 세운다. 무엇이 갈지 보고 고친 뒤에 보낸다.
    const items = [];
    for (const m of activeMembers()) {
      if (!idset.has(m.id)) continue;
      const today = (part === '3' ? loadToday(m.id) : loadToday(m.id, part)) || {};
      const cm = currentStateMsg(pl, m.board_name, today);
      items.push({ id: m.id, name: m.board_name, title: cm.title, body: cm.body, meta: { part } });
    }
    const token = outbox.stage({ kind: '배치표 정정(수동 선택)', part, by: '관리자', items });
    if (!token) return res.status(400).json({ ok: false, error: '보낼 내용이 없어요.' });
    res.json({ ok: true, notifyToken: token, count: items.length });
  } catch (e) { console.error('notify-adhoc 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});

// ★크로스파트 대바 — 1부↔3부 등 다른 두 부의 두 좌석 이름을 맞바꿈(좌석=순번·티오프 고정, 사람만 교환).
//  두 이동자 회원만 상태 갱신(도착 부 세팅 + 출발 부 정리). dryRun=true면 저장 없이 결과만 계산해 반환(검증용).
app.post('/api/board-swap', gate, async (req, res) => {
  try {
    const aPart = String(req.body?.aPart || ''), bPart = String(req.body?.bPart || '');
    const aPos = Number(req.body?.aPos || 0), bPos = Number(req.body?.bPos || 0);
    const notify = !!req.body?.notify, dryRun = !!req.body?.dryRun;
    if (!aPart || !bPart || !aPos || !bPos) return res.status(400).json({ ok: false, error: 'aPart·aPos·bPart·bPos 필요' });
    if (aPart === bPart) return res.status(400).json({ ok: false, error: '같은 부 안에서는 순서편집(끼워넣기)을 쓰세요.' });
    const A = loadPartBoardRW(aPart), B = loadPartBoardRW(bPart);
    if (!A || !B) return res.status(400).json({ ok: false, error: '두 부의 배치표가 모두 있어야 대바가 됩니다.' });
    const aName = bareName(A.roster[aPos - 1]), bName = bareName(B.roster[bPos - 1]);
    if (!aName || !bName) return res.status(400).json({ ok: false, error: '선택한 자리에 사람이 없어요.' });
    if (nkey(aName) === nkey(bName)) return res.status(400).json({ ok: false, error: '같은 사람은 대바할 수 없어요.' });
    // 스왑 반영 명단 사본(dryRun이어도 계산은 스왑 후 기준)
    const rosterA2 = A.roster.slice(); const rosterB2 = B.roster.slice();
    rosterA2[aPos - 1] = bName; rosterB2[bPos - 1] = aName;
    if (!dryRun) {
      A.roster[aPos - 1] = bName; B.roster[bPos - 1] = aName; A.save(); B.save();
      try { fs.appendFileSync(path.join(DATA_DIR, 'admin-corrections.jsonl'), JSON.stringify({ at: Date.now(), type: 'swap', a: { part: aPart, pos: aPos, name: aName }, b: { part: bPart, pos: bPos, name: bName } }) + '\n'); } catch { /* noop */ }
    }
    const movers = [
      { name: aName, from: aPart, fromBoard: A, to: bPart, toBoard: B, roster: rosterB2 },
      { name: bName, from: bPart, fromBoard: B, to: aPart, toBoard: A, roster: rosterA2 },
    ];
    const pending = [], results = [];
    for (const mv of movers) {
      const m = activeMembers().find((x) => nkey(x.board_name) === nkey(mv.name));
      if (!m) { results.push({ name: mv.name, member: false }); continue; }
      const win = partWindow(mv.to);
      const member = { name: m.board_name, part: mv.to, commuteMin: Number(m.commute_min), teeMin: win.min, teeMax: win.max };
      const todayTo = (mv.to === '3' ? loadToday(m.id) : loadToday(m.id, mv.to)) || {};
      const vTo = JSON.parse(JSON.stringify(mv.toBoard.verdict())); vTo.part3Roster = mv.roster;   // 스왑 반영 명단
      let nextTo;
      try {
        const mo = interpretForMember(mv.toBoard.article, vTo, member, todayTo);
        nextTo = applyVerdict(todayTo, mo.rawVerdict, mv.toBoard.article, { teeMin: win.min, teeMax: win.max, name: m.board_name, part: mv.to }).next;
      } catch (e) { results.push({ name: mv.name, member: true, error: e.message }); continue; }
      const cutLine = mv.toBoard.cutLine;
      const pos = Number(nextTo.myPosition) || 0;
      if (nextTo.status !== 'off' && pos > 0 && cutLine > 0) {
        nextTo.cutLine = cutLine; const hasTee = nextTo.teeTime && /\d{1,2}:\d{2}/.test(String(nextTo.teeTime)); const inWork = pos <= cutLine;
        nextTo.status = inWork ? (hasTee ? 'assigned' : 'work') : 'spare'; if (!inWork) { nextTo.teeTime = ''; nextTo.course = ''; }
      }
      nextTo._adminLock = { dk: dayKey(mv.toBoard.dateLabel), articleId: mv.toBoard.articleId, fields: { status: 1, teeTime: 1, course: 1, cutLine: 1, myPosition: 1, offType: 1 }, by: 'admin', at: Date.now() };
      nextTo.updatedAt = Date.now();
      results.push({ name: mv.name, member: true, to: mv.to, from: mv.from, status: nextTo.status, teeTime: nextTo.teeTime || '', pos: nextTo.myPosition || 0 });
      if (!dryRun) {
        if (mv.to === '3') saveToday(nextTo, m.id); else saveToday(nextTo, m.id, mv.to);
        leaveMemberPart(m.id, mv.from, mv.fromBoard.dateLabel, mv.fromBoard.articleId);
      }
      const pl = mv.to === '1' ? '1부(조출)' : `${mv.to}부`;
      const work = ['work', 'assigned', 'your_turn'].includes(nextTo.status);
      pending.push({ id: m.id, name: m.board_name, title: `${pl} 대바 반영`, body: `${m.board_name}님, 대바로 ${pl} ${work ? '근무' : '배정'}가 됐습니다${nextTo.teeTime ? ` — 티오프 ${nextTo.teeTime}` : ''}.` });
    }
    const notifyToken = (!dryRun && notify && pushReady) ? stashNotify(pending) : null;
    if (!dryRun) console.log(`🔄 [monitor] 대바: ${aName}(${aPart}부#${aPos}) ↔ ${bName}(${bPart}부#${bPos})`);
    res.json({ ok: true, dryRun, aName, bName, results, pending: pending.map((p) => ({ name: p.name, title: p.title, body: p.body })), notifyToken });
  } catch (e) { console.error('board-swap 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});

// ── 공지(팩스 출력지) 작성·발송 — 회원 앱이 열릴 때 출력 연출로 표시. ──
//  audience: 'admin'(테스트=관리자만) | 'all'(전체) | 'users'(지정 회원). 미지정이면 안전하게 관리자만.
app.post('/api/notice', gate, (req, res) => {
  try {
    const { title, body, audience, admin, userIds, tags, noticeDate } = req.body || {};
    if (!String(title || '').trim() || !String(body || '').trim()) return res.status(400).json({ ok: false, error: '제목·내용을 모두 입력해주세요.' });
    if (audience === 'users' && !(Array.isArray(userIds) && userIds.length)) return res.status(400).json({ ok: false, error: '받는 회원을 한 명 이상 선택해주세요.' });
    const n = addNotice({ title, body, admin: admin || '관리자 김홍구', audience, userIds, tags, noticeDate });
    const audKo = n.audience === 'all' ? '전체' : (n.audience === 'users' ? `지정 ${n.userIds.length}명` : '관리자만');
    // ★공지는 원래 '앱을 열면 보이는' 것이라 폰은 조용했다 — 긴급으로 체크해도 그랬다.
    //  긴급일 때만 푸시까지 보낸다. 평소 회람까지 울리면 알림이 흔해지고, 흔해진 알림은 안 읽힌다.
    //  그리고 그 푸시도 관문을 지난다 — 무엇이 뜰지 보고 고친 뒤에 보낸다.
    let notifyToken = null;
    if (n.tags.includes('긴급') && pushReady) {
      const only = n.audience === 'users' ? new Set(n.userIds) : null;
      const items = activeMembers()
        .filter((m) => (n.audience === 'all' ? true : (only ? only.has(m.id) : m.role === 'admin')))
        .map((m) => ({ id: m.id, name: m.board_name || '회원', title: `긴급 공지 — ${n.title}`, body: n.body, meta: { notice: n.id } }));
      notifyToken = outbox.stage({ kind: '긴급 공지', by: n.admin, items, url: '/' });
    }
    console.log(`[notice] 공지 등록 — "${n.title}" (대상 ${audKo})${notifyToken ? ' · 긴급 푸시 초안 대기' : ''}`);
    res.json({ ok: true, notice: n, audience: n.audience, count: n.userIds.length, notifyToken });
  } catch (e) { console.error('notice 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/notice/list', gate, (req, res) => {
  try { res.json({ ok: true, notices: listNotices().slice(-20).reverse() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ★배치표 이미지 업로드 → 앱의 /api/ingest-image 로 서버-서버 포워딩(홀리스틱 판독·자동반영).
//  카톡 배치표(사진)는 알림 브리지가 자동 못 잡으므로, 관리자가 여기 올리면 시스템이 판독해 반영한다.
app.post('/api/upload-board', gate, async (req, res) => {
  try {
    const image = req.body?.image;
    if (!image || typeof image !== 'string') return res.status(400).json({ ok: false, error: '이미지 파일이 필요합니다.' });
    const token = process.env.INGEST_TOKEN || '';
    const appUrl = process.env.APP_INTERNAL_URL || 'http://localhost:3000';
    const source = req.body?.source || '카톡업로드';
    const comments = Array.isArray(req.body?.comments) ? req.body.comments.filter(Boolean).slice(0, 8) : [];
    const nopush = req.body?.nopush ? '1' : '';
    // ★관리자가 고른 배치표 종류(전체/1·2·3부)를 그대로 넘긴다 — 제목은 앱이 이 값으로 짓는다.
    //  지금까지는 '[관리자업로드] 배치표 이미지'로 고정해 보내, 올리는 사람이 아는 사실을 버리고
    //  이미지에서 다시 추측하게 만들었다(로그: '이 배치표엔 1부 표 없음' 오판의 온상).
    const part = ['all', '1', '2', '3'].includes(String(req.body?.part || '')) ? String(req.body.part) : '';
    // ★force=1 — 사람이 손으로 올린 건 '다시 읽어라'는 명시적 지시다. 중복차단을 태우면 안 된다.
    //  중복차단은 카톡이 같은 사진을 자동 재전송하는 걸 막으려고 만든 것이고, 그 규칙을 관리자 업로드에
    //  그대로 적용하면 판독이 실패한 사진을 다시 올려도 '성공(재판독 안 함)'이라고 답한다 —
    //  고치려고 올리는 사람에게 아무 일도 안 하면서 됐다고 말하는 셈이라 제일 나쁜 실패다.
    const body = { image, source, comments, part, force: 1 };
    if (!part) body.subject = '[관리자업로드] 배치표 이미지';   // 미지정이면 종전과 100% 동일
    const r = await fetch(`${appUrl}/api/ingest-image${nopush ? '?nopush=1' : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': token },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ ok: false, error: `앱 응답 파싱 실패(HTTP ${r.status})` }));
    res.status(r.ok ? 200 : r.status).json(j);
  } catch (e) { console.error('upload-board 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});

// ── 대조판 ── 사진 판독과 카카오 예약을 겹쳐 보고, 그 자리에서 인턴·이름·순번을 고친다.
//  ★샘플이 아니라 여기서 그린다. 저장(/api/board-correct·/api/admin/intern-tees)이 같은 출처라야 동작한다.
app.get('/daejo', gate, (req, res) => {
  try {
    const J = buildDaejoData(String(req.query.date || ''));
    // ★배치표가 없는 날에도 그린다 — 카카오 관측만으로도 대조판은 성립하고(원래 그런 화면이다),
    //  무엇보다 '내일 원웨이'는 배치표가 뜨기 전에 알게 된다. 그때 말할 수 없으면 버튼이 헛돈다.
    const empty = !Object.keys(J.parts || {}).length && !(J.snap && J.snap.at);
    if (empty) return res.status(503).send('아직 판독된 배치표도, 카카오 관측도 없습니다.');
    // ★no-store — 이 페이지는 배치표 데이터를 HTML 안에 박아서 보낸다(window.__DAEJO_BOARD).
    //  no-cache는 '쓰기 전에 물어보라'일 뿐이라 304가 오면 브라우저가 캐시본을 그대로 다시 그린다.
    //  그래서 서버를 고쳐도 화면이 안 바뀌었고, 고친 사람도 보는 사람도 한나절을 헛돌았다(8/18).
    res.set('Cache-Control', 'no-store, must-revalidate').set('Pragma', 'no-cache').type('html').send(renderDaejo(J));
  } catch (e) { console.error('대조판 오류:', e.message); res.status(500).send('대조판 생성 실패: ' + e.message); }
});
app.get('/api/daejo-data', gate, (req, res) => {
  try { res.set('Cache-Control', 'no-store').json({ ok: true, ...buildDaejoData(String(req.query.date || '')) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 배치표를 만지는 화면은 셋이다. 문은 하나다. ────────────────────────────────
//  · 배치표 검수(모니터 탭)  — "판독이 틀렸다". 행 단위로 사실을 바로잡는다. 근태·대바까지 다룬다.
//  · 대조판(/daejo)          — "카카오 예상과 배치표가 다르다". 나란히 놓고 고른다. 테스트판 + 반영.
//  · 예약 구성판(/booking)   — "아직 없는 예약을 짠다". 예약팀장이 쓰고, 관리자가 승인해야 반영된다.
//  살아 있는 배치표를 쓰는 통로는 셋 다 /api/board-correct 하나뿐이다(부 간 대바만 /api/board-swap).
//  무결성 검사·교정 로그·회원 재계산이 거기 한 군데서 일어난다. 새 화면을 만들더라도 이 문으로만 들어온다.
//  ★그 문에 판본 검사(baseSig)가 달려 있다 — 세 화면 모두 배치표를 통째로 되쓰기 때문에,
//   불러온 뒤 바뀌었는지 묻지 않으면 나중에 저장한 쪽이 앞선 수정을 경고 없이 지운다.
// ── 예약 구성판 ── 예약팀장이 직접 짜는 화면.
//  대조판은 '읽는' 화면이고 이건 '짜는' 화면이다. 같은 데이터(buildDaejoData)를 보지만,
//  칸을 누를 때마다 그 결정이 캐디 한 사람의 하루를 어떻게 바꾸는지 옆 폰에 그려준다.
//  ★?admin=1 로 열어야 반영 버튼이 보인다 — 링크를 넘길 때 그 글자를 빼면 손님은 연습만 한다.
app.get('/booking', gate, (req, res) => {
  try {
    const J = buildDaejoData(String(req.query.date || ''));
    if (!Object.keys(J.parts || {}).length) return res.status(503).send('아직 읽은 배치표가 없습니다 — 배치표가 올라온 날짜로 열어주세요.');
    res.set('Cache-Control', 'no-store, must-revalidate').type('html')
      .send(renderBooking(J, { admin: String(req.query.admin || '') === '1' }));
  } catch (e) { console.error('예약 구성판 오류:', e.message); res.status(500).send('예약 구성판 생성 실패: ' + e.message); }
});
// 저장은 언제나 테스트판으로 간다. apply=true 는 관리자 링크에서만 받고, 그때만 검수 경로(board-correct)를 탄다.
//  ★예약팀장이 누른 것이 곧바로 회원 13명의 카드로 나가지 않게 하는 것 — 이 갈림길이 이 기능의 전부다.
app.post('/api/booking-save', gate, async (req, res) => {
  const date = String(req.body?.date || '').replace(/\D/g, '').slice(0, 8);
  const parts = req.body?.parts;
  if (!date) return res.status(400).json({ ok: false, error: 'date(YYYYMMDD) 필요' });
  if (!parts || typeof parts !== 'object') return res.status(400).json({ ok: false, error: 'parts 필요' });
  const apply = req.body?.apply === true && String(req.query.admin || '') === '1';
  try {
    const sb = {};
    for (const [p, v] of Object.entries(parts)) {
      sb[p] = { roster: v.roster || [], teeGrid: v.teeGrid || [],
        internTees: v.internTees || [], boardInternTees: v.internTees || [], cut: Number(v.cut) || 0 };
    }
    saveSandbox(date, sb, { by: apply ? '예약구성판(관리자)' : '예약구성판' });
    if (!apply) return res.json({ ok: true, applied: false, date });
    const _tok = req.query.k || req.get('x-monitor-token') || '';
    // ★손댄 부만 회원 앱으로 간다. 이 화면은 세 부를 한꺼번에 들고 있어서 1부만 고쳐도
    //  2·3부가 그대로 실려 온다. 그걸 반영하면 건드리지도 않은 3부가 이 화면이 다시 그린 값으로
    //  덮이고, 관리자 교정과 수동 인턴 지정이 함께 지워진다. 테스트판에는 세 부를 다 남긴다.
    const touched = Array.isArray(req.body?.touched) ? req.body.touched.map(String) : Object.keys(parts);
    if (!touched.length) return res.status(400).json({ ok: false, error: '바꾼 것이 없습니다.' });
    const done = [];
    for (const [p, v] of Object.entries(parts)) {
      if (!touched.includes(String(p))) continue;
      const grid = {}; (v.teeGrid || []).forEach((g) => { grid[Number(g.pos)] = g; });
      const rows = (v.roster || []).map((nm, i) => {
        const g = grid[i + 1];
        return { pos: i + 1, name: String(nm || ''), tee: g ? g.time : '', course: g ? g.course : '' };
      });
      const body = { part: String(p), rows, interns: v.internTees || [], allInterns: v.internTees || [],
        cutLine: Number(v.cut) || 0, notify: false,
        baseSig: String(v.syncSig || '') };   // 화면을 연 뒤 배치표가 바뀌었으면 서버가 막는다
      const r = await fetch(`http://127.0.0.1:${PORT}/api/board-correct${_tok ? `?k=${encodeURIComponent(_tok)}` : ''}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.stale) throw new Error(`${p}부 — 그 사이 배치표가 바뀌었습니다. 새로고침해서 최신본을 보고 다시 짜주세요.`);
      if (!j.ok) throw new Error(`${p}부 반영 실패 - ${j.error || ''}`);
      done.push(`${p}부 ${j.updated || 0}명`);
    }
    console.log(`[예약구성판] ${date} 회원 반영 - ${done.join(', ') || '없음'} (손댄 부: ${touched.join('/')})`);
    res.json({ ok: true, applied: true, date, done });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/daejo-save', gate, (req, res) => {
  const date = String(req.body?.date || '').replace(/\D/g, '').slice(0, 8);
  if (!date) return res.status(400).json({ ok: false, error: 'date(YYYYMMDD) 필요' });
  if (!req.body?.parts || typeof req.body.parts !== 'object') return res.status(400).json({ ok: false, error: 'parts 필요' });
  try {
    const rec = saveSandbox(date, req.body.parts, { by: '모니터' });
    res.json({ ok: true, date, edited: Object.keys(rec.parts || {}), at: rec.at });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
// ── 하루치 운영 선언 ── 그날 그 부가 몇 시부터 몇 시까지, 몇 코스로 도는가.
//  ★이건 테스트판이 아니다 — 카카오 엔진이 곧바로 읽는다(그게 이 버튼의 목적이다).
//   기본틀(config/riverhill-tee-schedule.json)은 건드리지 않는다. 하루의 사정으로 기본틀을 고치면
//   그 다음 날부터 조용히 틀린다. 선언은 날짜에 붙고 45일 뒤 저절로 사라진다.
app.post('/api/daejo-frame', gate, (req, res) => {
  const date = String(req.body?.date || '').replace(/\D/g, '').slice(0, 8);
  const part = String(req.body?.part || '');
  if (!date) return res.status(400).json({ ok: false, error: 'date(YYYYMMDD) 필요' });
  try {
    const J = buildDaejoData(date);
    const base = (J.sched?.base || {})[part];      // 기본틀 — 여기로 돌아오면 선언을 지운다
    const cur = (J.sched?.parts || {})[part];      // 지금 이 부의 실제 범위 — 검사 기준
    const cadence = Number(J.sched?.cadence) || 7;
    if (req.body?.slot) {                       // 격자 밖 칸 넣고 빼기 — "17:30|OUT"
      const [t, c] = String(req.body.slot).split('|');
      setPartSlot(date, part, t, c || 'OUT', req.body.on !== false, { by: '모니터', range: base });
    } else if (req.body?.reset) clearPart(date, part, { by: '모니터' });
    else if (req.body?.oneway !== undefined) setPartOneway(date, part, req.body.oneway, { by: '모니터' });
    else setPartRange(date, part, { first: req.body?.first, last: req.body?.last, cur, base, cadence, by: '모니터' });
    const now = dayFrameParts(date)[part] || null;
    console.log(`🕒 [운영선언] ${date} ${part}부 — ${now ? JSON.stringify(now) : '기본틀로 되돌림'}`);
    res.json({ ok: true, date, part, declared: now });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/daejo-reset', gate, (req, res) => {
  const date = String(req.body?.date || '').replace(/\D/g, '').slice(0, 8);
  if (!date) return res.status(400).json({ ok: false, error: 'date(YYYYMMDD) 필요' });
  const cleared = clearSandbox(date, String(req.body?.part || ''), String(req.body?.axis || ''));
  res.json({ ok: true, date, cleared });
});

// 인턴 티오프 수동 지정 — 앱 서버(3000)에도 같은 API가 있지만, 대조판은 모니터에서 뜨므로 여기에도 둔다.
//  같은 interns.mjs·같은 data/를 쓰니 어느 쪽으로 저장해도 결과는 하나다.
function _autoInternTees(dateKey, part = '3') {
  // 그 날짜 그 부가 판독한 노란 칸 — 부마다 티오프표가 따로다.
  //  3부는 lastboard, 1·2부는 board-parts-store에 있다.
  try {
    if (String(part) !== '3') {
      const bp = loadBoardPartsStore();
      const d = bp && bp.parts && bp.parts[String(part)];
      if (!d) return [];
      const iso = String(d._targetISO || bp.targetISO || '').replace(/\D/g, '').slice(0, 8);
      if (iso && iso !== dateKey) return [];
      return d.internTees || [];
    }
    const lb = loadJSON('lastboard.json', {}) || {};
    const v = lb.rawVerdict ? effectivePart3Verdict(lb) : null;
    if (v && String(v.dateLabel || lb.dateLabel || '').replace(/\D/g, '').slice(0, 8) === dateKey) return v.internTees || [];
    return (lb.rawVerdict?.internTees) || [];
  } catch { return []; }
}
app.get('/api/admin/intern-tees', gate, (req, res) => {
  const date = String(req.query.date || '').replace(/\D/g, '').slice(0, 8);
  const part = String(req.query.part || '3');
  if (!date) return res.status(400).json({ ok: false, error: 'date(YYYYMMDD) 필요' });
  if (!['1', '2', '3'].includes(part)) return res.status(400).json({ ok: false, error: 'part는 1·2·3 중 하나' });
  const auto = _autoInternTees(date, part);
  const man = internManualFor(date, part);
  res.json({ ok: true, date, part, auto, manual: man ? man.tees : null, effective: internTeesFor(date, auto, part), source: man ? '수동' : '자동' });
});
// ★여기는 저장만 한다. 회원 카드 재계산은 앱(server.mjs)의 같은 경로가 한다 — 카드는 앱이 주인이다.
//  모니터에서 인턴을 고칠 일이면 '배치표 검수'로 하는 게 맞다(그 길은 board-correct라 재계산까지 간다).
app.post('/api/admin/intern-tees', gate, (req, res) => {
  const date = String(req.body?.date || '').replace(/\D/g, '').slice(0, 8);
  const part = String(req.body?.part || '3');
  if (!date) return res.status(400).json({ ok: false, error: 'date(YYYYMMDD) 필요' });
  if (!['1', '2', '3'].includes(part)) return res.status(400).json({ ok: false, error: 'part는 1·2·3 중 하나' });
  try {
    if (req.body?.clear) clearInternTees(date, '모니터', part);
    else if (req.body?.toggle) { const { time, course } = req.body.toggle; toggleInternTee(date, time, course, _autoInternTees(date, part), { by: '모니터', part }); }
    else if (Array.isArray(req.body?.tees)) setInternTees(date, req.body.tees, { by: '모니터', part, note: String(req.body?.note || '') });
    else return res.status(400).json({ ok: false, error: 'tees[] 또는 toggle{time,course} 또는 clear:true 필요' });
  } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const auto = _autoInternTees(date, part);
  const man = internManualFor(date, part);
  res.json({ ok: true, date, part, auto, manual: man ? man.tees : null, effective: internTeesFor(date, auto, part), source: man ? '수동' : '자동' });
});

app.get('/', gate, (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(ROOT_DIR, 'monitor', 'index.html')); });

app.listen(PORT, HOST, () => {
  console.log(`📊 모니터링 사이트 실행: http://localhost:${PORT}`
    + (TOKEN ? '  (접속 시 ?k=토큰 필요)' : '  (⚠️ MONITOR_TOKEN 미설정 — 접근 제한 없음)'));
});

// ── 감시 클로드(골격) ── 메인 서버가 뱉는 이상/오류를 이 별도 프로세스가 감지→클로드 자가진단.
//  진단이 '실제 버그·심각'이면 관리자에게 알림(읽기전용·자문, 코드 자동배포 안 함).
startWatchdog({
  notify: async (report, signals) => {
    const body = `${report.rootCause || ''}\n제안: ${report.proposedFix || ''}`.slice(0, 300);
    // ★시스템 진단은 기본적으로 push하지 않는다 — 관리자 개인폰(캐디앱)에 운영 알림이 섞여 사용자 경험을 해침.
    //  진단서는 watchdog-reports.jsonl + 모니터 사이트(/api/watchdog)에서 검토. push 원하면 WATCHDOG_PUSH=1.
    if (process.env.WATCHDOG_PUSH !== '1') {
      console.log(`[감시] 시스템 진단(${report.severity}) 기록됨 — push 억제(모니터 사이트에서 확인): ${(report.rootCause || '').slice(0, 120)}`);
      return;
    }
    // 운영 통로 — 회원 알림 장부에 섞이지 않는다.
    try { await broadcastOps({ title: `시스템 진단(${report.severity}) — 확인 필요`, body, url: '/', level: 'high', bypassQuiet: true }); }
    catch (e) { console.error('[감시] 관리자 알림 실패:', e.message); }
  },
});
