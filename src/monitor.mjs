// 운영 모니터링 사이트 — 본 앱과 별개의 작은 서버(다른 포트).
//  같은 data/(app.db·로그)를 '읽기 전용'으로 보고, 가입·방문·재접속·배치표 이해도를 한 눈에 표시.
//  실행:  node src/monitor.mjs   (pm2로 riverhill-monitor 로 따로 띄우면 됨)
//  보안:  MONITOR_TOKEN 설정 시 ?k=토큰 필요. 미설정이면 로컬/사설망 전용으로만 쓸 것.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { loadEnv, ROOT_DIR } from './env.mjs';
import { computeStats, computeBoardParts, effectivePart3Verdict } from './analytics.mjs';
import { listMembersForAdmin, setUserStatus, getUser, getProfile, activeMembers, deleteUser } from './users.mjs';
import { initPush, broadcast, getSubscriptions } from './push.mjs';
import { loadToday, saveToday, dayKey, applyVerdict } from './today.mjs';
import { commuteInfo, dayWordFor, interpretForMember, partWindow } from './judge.mjs';
import * as worklog from './worklog.mjs';
import { DATA_DIR } from './store.mjs';
import { loadBoardPartsStore, saveBoardPartsStore } from './boardparts.mjs';
import { addNotice, listNotices } from './notices.mjs';

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
      // ── 다중 라운드(같은 날 1·2·3부 조합) — 앱 /api/today 와 동일 규칙으로 모아 통합 카드로 재현. ──
      //  3부 today.json 을 베이스로, 같은 날짜의 1·2부 근무(티오프 확정분)를 얹는다. 유령 방지: 낡음·티오프미정 제외.
      const baseISO = (() => { try { return worklog.labelToISO(st.date); } catch { return null; } })();
      const rounds = [];
      for (const pp of ['1', '2', '3']) {
        const tp = pp === '3' ? st : (loadToday(m.id, pp) || null);
        if (!tp || !tp.status) continue;
        const isW = ['assigned', 'work', 'your_turn'].includes(tp.status);
        const isSp = ['spare', 'waiting', 'near'].includes(tp.status) && Number(tp.myPosition) > 0;
        if (!isW && !isSp) continue;
        let ppISO = null; try { ppISO = worklog.labelToISO(tp.date); } catch { /* 무해 */ }
        if (ppISO && ppISO < todayISO) continue;                 // 낡음 제외
        if (pp !== '3' && isW && !tp.teeTime) continue;          // 비3부 근무는 티오프 확정분만(유령 카드 방지)
        if (baseISO && ppISO && ppISO !== baseISO) continue;     // 베이스(3부)와 다른 날짜 제외
        rounds.push({
          part: pp, work: isW, teeTime: tp.teeTime || '', course: tp.course || '',
          myPos: Number(tp.myPosition) || 0,
          commute: (isW && tp.teeTime) ? commuteInfo(tp.teeTime, commuteMin) : null,
        });
      }
      const workRounds = rounds.filter((r) => r.work).sort((a, b) => String(a.teeTime).localeCompare(String(b.teeTime)) || Number(a.part) - Number(b.part));
      const workParts = workRounds.map((r) => r.part);
      const combo = workParts.length >= 2;         // 하루 두 부 이상 근무 = 통합 카드
      const comboLabel = workParts.join('·') + '부';   // 예: 1·3부
      let kind, badge, heroTitle;
      if (combo) { kind = 'work'; badge = { t: comboLabel, c: 'work' }; heroTitle = `${dayW} ${comboLabel} 근무`; }
      else if (status === 'your_turn') { kind = 'work'; badge = { t: '출근 차례', c: 'work' }; heroTitle = '지금 출근 차례'; }
      else if (isWork) { kind = 'work'; badge = { t: '근무', c: 'work' }; heroTitle = teeTime ? `${dayW} 근무 확정` : `${dayW} 근무 예정`; }
      else if (offRemoved) { kind = 'removed'; badge = { t: '순번 제외', c: 'removed' }; heroTitle = '근무 없음 (순번 제외)'; }
      else if (offSick) { kind = 'off'; badge = { t: '병가', c: 'sick' }; heroTitle = `${dayW} 병가`; }
      else if (offVac) { kind = 'off'; badge = { t: '휴가', c: 'vac' }; heroTitle = `${dayW} 휴가`; }
      else if (isOff) { kind = 'off'; badge = { t: '휴무', c: 'off' }; heroTitle = `${dayW} 휴무`; }
      else if (isSpare) { kind = 'spare'; badge = { t: '스페어', c: 'spare' }; heroTitle = `${dayW} 스페어${myPos ? ` · ${myPos}번` : ''}`; }
      else { kind = 'unknown'; badge = { t: '미상', c: 'unk' }; heroTitle = '상태 미상'; }
      const commute = (!combo && isWork && teeTime) ? commuteInfo(teeTime, commuteMin) : null;
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
        id: m.id, name: bname || `#${m.id}`, part: combo ? comboLabel : (st.part || `${m.part || 3}부`),
        combo, comboRounds: combo ? workRounds : null,
        status, kind, badge, heroTitle,
        date: st.date || '', dayW, stale, empty: !st.date && !st.status,
        myPos, cut, ahead, teamCount: Number(st.teamCount) || 0,
        locked: (st._adminLock && dayKey(st.date) === dayKey(st._adminLock.dk)) ? Object.keys(st._adminLock.fields || {}).filter((k) => st._adminLock.fields[k]) : [],
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

// ── 관리자 수동 교정: 판독이 틀렸을 때 관리자가 실제 배치표를 보고 대시보드를 바로잡음 ──
//  교정값은 그날 자동 판독이 덮지 않도록 today.json 에 _adminLock 으로 잠근다(applyAdminLock).
//  모든 교정은 '모델값 vs 관리자값' diff 로 admin-corrections.jsonl 에 남겨 정확도 진단에 쓴다.
function correctionMessage(name, t, changes) {
  const st = t.status;
  const statusChg = changes.find((c) => c.field === 'status');
  const teeChg = changes.find((c) => c.field === 'teeTime');
  if (statusChg && ['assigned', 'work', 'your_turn'].includes(st))
    return { title: '근무 확정', body: `${name}님, 근무로 확정됐어요${t.teeTime ? ` — 티오프 ${t.teeTime}` : ''}. 배치표를 확인해주세요.` };
  if (statusChg && ['spare', 'waiting', 'near'].includes(st))
    return { title: '스페어 전환', body: `${name}님, 스페어(대기)로 전환됐어요.` };
  if (statusChg && st === 'off')
    return { title: '휴무', body: `${name}님, 오늘은 휴무로 처리됐어요.` };
  if (teeChg)
    return { title: '티오프 시간 변경!', body: `${name}님, 티오프가 ${teeChg.from || '-'} → ${teeChg.to}(으)로 변경됐어요. 출발·백대기 시각도 확인해주세요.` };
  return { title: '배치표 수정', body: `${name}님, 배치표 정보가 갱신됐어요. 확인해주세요.` };
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
  let notified = false;
  if (notify && pushReady) {
    const { title, body } = correctionMessage(name, next, changes);
    try { await broadcast({ title, body, url: '/', level: 'high', bypassQuiet: true }, id); notified = true; }
    catch (e) { console.error('교정 알림 발송 실패:', e.message); }
  }
  console.log(`✏️ [monitor] 회원 #${id}(${name}) 관리자 교정: ${changes.map((c) => `${c.field} ${c.from || '-'}→${c.to || '-'}`).join(', ') || '(값 동일·잠금만)'}${notified ? ' · 알림발송' : ''}`);
  res.json({ ok: true, changed: changes.length, notified, locked: Object.keys(lockFields) });
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
function loadLastBoard() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'lastboard.json'), 'utf8')); } catch { return null; }
}
const nkey = (s) => String(s || '').replace(/\s/g, '');
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
app.get('/api/board-review', gate, (req, res) => {
  try {
    const part = String(req.query.part || '3');
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
      const interns = (Array.isArray(pd.internTees) ? pd.internTees : []).map((x) => ({ time: (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0], course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') })).filter((x) => x.time);
      flagMisreads(rows);   // 쌍둥이 이름 오독 표시(1·2부)
      return res.json({ ok: true, part, board: {
        articleId: bp.articleId, dateLabel: pd.dateLabel || bp.dateLabel || '', subject: bp.subject || '',
        image: bp.image || '', url: bp.url || '', at: bp.at, corrected: pd._adminCorrected || null,
        syncSig: `${bp.at || ''}|${(pd._adminCorrected && pd._adminCorrected.at) || ''}`,   // 신선도(store 기준)
        uncertain: pd.uncertain || '', teamCount: Number(pd.teamCount) || 0, cutLine, cutoffName: pd.cutoffName || '', rows, interns,
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
    const interns = (Array.isArray(v.internTees) ? v.internTees : []).map((x) => ({ time: (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0], course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') })).filter((x) => x.time);
    flagMisreads(rows);   // 쌍둥이 이름 오독 표시(3부)
    // ★원본 이미지: 구조 데이터(정본)와 별개로 '최신 3부 이미지'(당추 반영 변동본)를 우선 표시.
    const baseImg = (lb.article && lb.article.images && lb.article.images[0]) || '';
    res.json({ ok: true, part, board: {
      articleId: v._effArticleId || lb.id, dateLabel: v.dateLabel || lb.dateLabel || '', subject: (lb.article && lb.article.subject) || '',
      image: lb.latestImage || baseImg, imageId: lb.latestImageId || lb.id, imageAt: lb.latestImageAt || lb.at,
      url: (lb.article && lb.article.url) || '',
      // ★신선도 서명 — 얼어붙은 at 대신 today.json(_t1Sig) 기준 → 당추·커트로 대시보드가 바뀌면 검수도 재렌더.
      syncSig: `${v._t1Sig || ''}|${(v._adminCorrected && v._adminCorrected.at) || ''}`,
      at: lb.at, corrected: v._adminCorrected || null, uncertain: v._uncertain || '', teamCount: Number(v.teamCount) || 0,
      cutLine, cutoffName: v.cutoffName || '', rows, interns,
    } });
  } catch (e) { console.error('board-review 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/board-correct', gate, async (req, res) => {
  const part = String(req.body?.part || '3');
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  const interns = Array.isArray(req.body?.interns) ? req.body.interns : [];
  const cutLine = Number(req.body?.cutLine) || 0;
  const notify = !!req.body?.notify;
  if (!rows) return res.status(400).json({ ok: false, error: 'rows 필요' });
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
      const d = String(r.duty || ''); const key = nkey(nm);
      if (key) {
        if (/병가|휴무|휴가/.test(d)) { if (crew[key] !== d) cellDiffs.push({ pos: p, field: 'duty', model: crew[key] || '', admin: d }); crew[key] = d; }
        else if (/휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[key] || ''))) { cellDiffs.push({ pos: p, field: 'duty', model: crew[key], admin: '' }); crew[key] = ''; }
      }
      if (nm !== (origRoster[p - 1] || '')) cellDiffs.push({ pos: p, field: 'name', model: origRoster[p - 1] || '', admin: nm });
      if (tee !== (origGrid[p] || '')) cellDiffs.push({ pos: p, field: 'tee', model: origGrid[p] || '', admin: tee });
    }
    const iTees = interns.map((x) => { const t = (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0]; return t ? { time: t, course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') } : null; }).filter(Boolean);
    pd.roster = roster; pd.teeGrid = grid; pd.crewDuty = crew; pd.internTees = iTees; pd.internCount = iTees.length;
    if (cutLine) { pd.cutLine = cutLine; pd.cutoffPosition = cutLine; pd.cutoffName = roster[cutLine - 1] || pd.cutoffName || ''; }
    pd._adminCorrected = { at: Date.now(), by: 'admin' }; pd.rosterReliable = true; delete pd.uncertain;
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
    let updated = 0, notified = 0;
    for (const m of activeMembers()) {
      const today = loadToday(m.id, part) || {};
      const hadState = !!(today.myPosition || today.teeTime || (today.status && today.status !== 'unknown'));
      if (!rosterNk.has(nkey(m.board_name)) && !hadState) continue;   // 이 부와 무관 + 기존 상태도 없음 → 건드리지 않음
      const member = { name: m.board_name, part, commuteMin: Number(m.commute_min), teeMin: win.min, teeMax: win.max };
      let next;
      try {
        const mout = interpretForMember(article, JSON.parse(JSON.stringify(vpart)), member, today);
        next = applyVerdict(today, mout.rawVerdict, article, { teeMin: win.min, teeMax: win.max }).next;
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
      if (notify && pushReady) {
        const pl = part === '1' ? '1부(조출)' : `${part}부`;
        let title = '', body = '';
        if (nowOff && !wasOff) { title = `${pl} 휴무`; body = `${m.board_name}님, ${pl} 오늘은 휴무로 확인됐어요. 편히 쉬세요.`; }
        else if ((wasWait || wasOff) && nowWork && pos > 0) { title = `${pl} 근무 전환`; body = `${m.board_name}님, ${pl} 근무로 확정됐어요${next.teeTime ? ` — 티오프 ${next.teeTime}` : ''}. 배치표를 확인해주세요.`; }
        else if (wasWork && nowSpare) { title = `${pl} 스페어 전환`; body = `${m.board_name}님, ${pl} 스페어(대기)로 전환됐어요.`; }
        else if (wasWork && nowWork && today.teeTime && next.teeTime && today.teeTime !== next.teeTime) { title = `${pl} 티오프 변경!`; body = `${m.board_name}님, ${pl} 티오프가 ${today.teeTime} → ${next.teeTime}(으)로 변경됐어요.`; }
        if (title) { try { await broadcast({ title, body, url: '/', level: 'high', bypassQuiet: true }, m.id); notified++; } catch (e) { console.error('교정 알림 실패:', e.message); } }
      }
    }
    console.log(`📋 [monitor] ${part}부 배치표 #${bp.articleId} 교정: 칸 ${cellDiffs.length}·인턴 ${iTees.length}·커트 ${cutLine} → 재계산 ${updated}명${notified ? ` · 알림 ${notified}명` : ''}`);
    return res.json({ ok: true, cellChanges: cellDiffs.length, interns: iTees.length, updated, notified });
  }
  const lb = loadLastBoard();
  if (!lb || !lb.rawVerdict) return res.status(400).json({ ok: false, error: '현재 배치표가 없어요.' });
  const v = JSON.parse(JSON.stringify(lb.rawVerdict));
  const origRoster = Array.isArray(v.part3Roster) ? v.part3Roster.slice() : [];
  const origGrid = {}; (v.teeGrid || []).forEach((g) => { origGrid[Number(g.pos)] = (String(g.time).match(/\d{1,2}:\d{2}/) || [''])[0]; });
  const crew = { ...(v.crewDuty || {}) };
  const roster = []; const grid = []; const cellDiffs = [];
  for (const r of rows) {
    const p = Number(r.pos); if (!p) continue;
    const nm = String(r.name || '').trim();
    const teeM = String(r.tee || '').match(/\d{1,2}:\d{2}/); const tee = teeM ? teeM[0] : '';
    const course = /IN/i.test(String(r.course || '')) ? 'IN' : (tee ? 'OUT' : '');
    roster[p - 1] = nm;
    if (tee) grid.push({ pos: p, time: tee, course: course || 'OUT' });
    // ── 근태(휴무/병가/휴가) 오버라이드: crewDuty 반영. 54·1,3(타부 근무) 코드는 보존. ──
    const d = String(r.duty || ''); const key = nkey(nm);
    if (key) {
      if (/병가|휴무|휴가/.test(d)) { if (crew[key] !== d) cellDiffs.push({ pos: p, field: 'duty', model: crew[key] || '', admin: d }); crew[key] = d; }
      else if (/휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[key] || ''))) { cellDiffs.push({ pos: p, field: 'duty', model: crew[key], admin: '' }); crew[key] = ''; } // 배치표대로 → 잘못 읽은 off 해제
    }
    if (nm !== (origRoster[p - 1] || '')) cellDiffs.push({ pos: p, field: 'name', model: origRoster[p - 1] || '', admin: nm });
    if (tee !== (origGrid[p] || '')) cellDiffs.push({ pos: p, field: 'tee', model: origGrid[p] || '', admin: tee });
  }
  const iTees = interns.map((x) => { const t = (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0]; return t ? { time: t, course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') } : null; }).filter(Boolean);
  v.part3Roster = roster; v.teeGrid = grid; v.crewDuty = crew; v.internTees = iTees; v.internCount = iTees.length;
  if (cutLine) { v.cutLine = cutLine; v.cutoffPosition = cutLine; v.cutoffName = roster[cutLine - 1] || v.cutoffName || ''; }
  v._adminCorrected = { at: Date.now(), by: 'admin' }; delete v._uncertain;
  lb.rawVerdict = v;
  try { fs.writeFileSync(path.join(DATA_DIR, 'lastboard.json'), JSON.stringify(lb)); } catch (e) { console.error('lastboard 저장 실패:', e.message); }
  if (cellDiffs.length) {
    const line = { at: Date.now(), type: 'board', boardArticleId: lb.id, date: v.dateLabel || '', cutLine, changes: cellDiffs };
    try { fs.appendFileSync(path.join(DATA_DIR, 'admin-corrections.jsonl'), JSON.stringify(line) + '\n'); } catch (e) { console.error('교정로그 실패:', e.message); }
  }
  const rosterNk = new Set(roster.map(nkey).filter(Boolean));
  const diffPositions = new Set(cellDiffs.map((d) => Number(d.pos)));   // 관리자가 실제 손댄 순번(이름·티오프·근태)
  const dk = dayKey(v.dateLabel || lb.dateLabel || '');
  let updated = 0, notified = 0;
  for (const m of activeMembers()) {
    const today = loadToday(m.id) || {};
    // 이 배치표에 없는 휴무자(다른 근태로 쉬는 사람)는 건드리지 않음 — 배치표에 이름이 있으면 재계산.
    if (today.status === 'off' && !rosterNk.has(nkey(m.board_name))) continue;
    const member = { name: m.board_name, part: String(m.part || 3), commuteMin: Number(m.commute_min) };
    let next;
    try {
      const mout = interpretForMember(lb.article, JSON.parse(JSON.stringify(v)), member, today);
      next = applyVerdict(today, mout.rawVerdict, lb.article).next;
    } catch (e) { console.error(`배치표교정 재계산 오류(회원 ${m.id}):`, e.message); continue; }
    const isOff = next.status === 'off'; // 근태칸(crewDuty) 휴무/병가 → interpretForMember가 이미 off로 확정
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
      next._adminLock = { dk, articleId: String(lb.id), fields: { status: 1, teeTime: 1, course: 1, cutLine: 1, myPosition: 1, offType: 1 }, by: 'admin', at: Date.now() };
    }
    next.updatedAt = Date.now();
    const wasWait = ['spare', 'waiting', 'near'].includes(today.status), wasWork = ['work', 'assigned', 'your_turn'].includes(today.status), wasOff = today.status === 'off';
    const nowWork = ['work', 'assigned', 'your_turn'].includes(next.status), nowSpare = ['spare', 'waiting', 'near'].includes(next.status), nowOff = next.status === 'off';
    saveToday(next, m.id); updated++;
    if (notify && pushReady) {
      let title = '', body = '';
      if (nowOff && !wasOff) { title = `${member.part}부 휴무`; body = `${m.board_name}님, 오늘은 휴무로 확인됐어요. 편히 쉬세요.`; }
      else if ((wasWait || wasOff) && nowWork && pos > 0) { title = `${member.part}부 근무 전환`; body = `${m.board_name}님, 근무로 확정됐어요${next.teeTime ? ` — 티오프 ${next.teeTime}` : ''}. 배치표를 확인해주세요.`; }
      else if (wasWork && nowSpare) { title = `${member.part}부 스페어 전환`; body = `${m.board_name}님, 스페어(대기)로 전환됐어요.`; }
      else if (wasWork && nowWork && today.teeTime && next.teeTime && today.teeTime !== next.teeTime) { title = '티오프 시간 변경!'; body = `${m.board_name}님, 티오프가 ${today.teeTime} → ${next.teeTime}(으)로 변경됐어요. 출발·백대기 시각도 확인해주세요.`; }
      if (title) { try { await broadcast({ title, body, url: '/', level: 'high', bypassQuiet: true }, m.id); notified++; } catch (e) { console.error('교정 알림 실패:', e.message); } }
    }
  }
  console.log(`📋 [monitor] 배치표 #${lb.id} 교정: 칸 ${cellDiffs.length}·인턴 ${iTees.length}·커트 ${cutLine} → 재계산 ${updated}명${notified ? ` · 알림 ${notified}명` : ''}`);
  res.json({ ok: true, cellChanges: cellDiffs.length, interns: iTees.length, updated, notified });
});

// ── 공지(팩스 출력지) 작성·발송 — 회원 앱이 열릴 때 출력 연출로 표시. ──
//  audience: 'admin'(테스트=관리자만) | 'all'(전체). 미지정이면 안전하게 관리자만.
app.post('/api/notice', gate, (req, res) => {
  try {
    const { title, body, audience, admin } = req.body || {};
    if (!String(title || '').trim() || !String(body || '').trim()) return res.status(400).json({ ok: false, error: '제목·내용을 모두 입력해주세요.' });
    const n = addNotice({ title, body, admin: admin || '김홍구', audience });
    console.log(`[notice] 공지 발송 — "${n.title}" (대상 ${n.audience === 'all' ? '전체' : '관리자만'})`);
    res.json({ ok: true, notice: n, audience: n.audience });
  } catch (e) { console.error('notice 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/notice/list', gate, (req, res) => {
  try { res.json({ ok: true, notices: listNotices().slice(-20).reverse() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/', gate, (req, res) => res.sendFile(path.join(ROOT_DIR, 'monitor', 'index.html')));

app.listen(PORT, HOST, () => {
  console.log(`📊 모니터링 사이트 실행: http://localhost:${PORT}`
    + (TOKEN ? '  (접속 시 ?k=토큰 필요)' : '  (⚠️ MONITOR_TOKEN 미설정 — 접근 제한 없음)'));
});
