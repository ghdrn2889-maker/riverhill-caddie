// 배치표가 바뀌면 회원에게 자동으로 알린다 — 관리자 교정 경로.
//
//  ★왜 있나: 사진이 바뀌는 건 이미 자동으로 잡힌다(server.mjs recheckBoard — 90초마다 지문 대조,
//   댓글이 달려도 다시 읽는다). 그런데 관리자가 대조판·검수에서 손으로 고친 것은 그 경로를 안 탔다.
//   상태는 바뀌는데 회원 폰은 조용했다. 사람이 버튼을 눌러야만 나갔고, 안 누르면 아무 일도 안 일어났다.
//
//  ★두 경로가 같은 알림을 두 번 보내면 안 된다. 그래서 중복 차단을 새로 만들지 않고
//   사진 경로가 쓰는 것과 '똑같은 서명·똑같은 파일'(pushlog)을 쓴다. 먼저 보낸 쪽이 서명을 적고,
//   나중 쪽은 그걸 보고 조용히 넘어간다. 서명 규칙이 갈라지면 두 번 울린다 — 그래서 베껴 쓰지 않고 맞춘다.
//
//  ★깨진 배치표로는 절대 안 보낸다. 8/18에 같은 시각에 두세 명이 겹친 채로 반영돼 다섯 명이
//   화면에서 사라졌다. 그때 알림까지 자동이었으면 열아홉 명 폰에 틀린 티오프가 갔고, 그건 못 거둔다.
//   겹친 칸·이름 없는 티오프·명단을 넘는 커트는 판단이 아니라 계수(計數)다. 세어보고 걸리면 멈춘다.
//
//  ★조용시간(22~08시): 1부 근무가 있는 회원에게만 곧바로 보낸다(사용자 결정).
//   1부는 새벽에 나간다 — 아침 8시 대기열에 넣으면 이미 출근길이다. 나머지는 아침에 모아 보낸다.
import { appendJSONL } from './store.mjs';
import { loadUserJSON, saveUserJSON } from './store.mjs';
import { broadcast, inQuietHours } from './push.mjs';
import { activeMembers } from './users.mjs';
import { loadToday } from './today.mjs';

const WINDOW = () => Number(process.env.PUSH_DEDUP_HOURS ?? 8) * 3600 * 1000;
export const autoPushOn = () => !['0', 'false', 'no'].includes(String(process.env.AUTO_BOARD_PUSH ?? '1').toLowerCase());

const WORKISH = ['work', 'assigned', 'your_turn'];
const partLabel = (p) => (String(p) === '1' ? '1부(조출)' : `${p}부`);

// 지금 이 회원의 상태를 그대로 알리는 문구.
//  ★'무엇이 어떻게 바뀌었나'(17:42 → 17:49)는 여기서 못 만든다 — 이전 상태를 안 들고 있기 때문이다.
//   그건 교정이 직접 계산해 주는 정정 알림(correctionMsg)의 몫이다. 여기서 흉내 내면 틀린 값이 나간다.
export function currentStateMsg(pl, name, today) {
  if (today.status === 'off') {
    const ot = today.offType;
    const w = ot === 'sick' ? '병가' : ot === 'vacation' ? '휴가' : '휴무';
    return { title: `${pl} 배치표 수정`, body: `${name}님, 배치표가 수정됐습니다 — ${pl} 오늘은 ${w}입니다.` };
  }
  const pos = Number(today.myPosition) || 0;
  if (WORKISH.includes(today.status)) {
    return { title: `${pl} 배치표 수정`, body: `${name}님, 배치표가 수정됐습니다 — ${pl} 근무${today.teeTime ? ` · 티오프 ${today.teeTime}${today.course ? `(${today.course})` : ''}` : ''}${pos ? ` · 순번 ${pos}번` : ''}입니다.` };
  }
  return { title: `${pl} 배치표 수정`, body: `${name}님, 배치표가 수정됐습니다 — ${pl} 스페어(대기)${pos ? ` · 순번 ${pos}번` : ''}입니다.` };
}

// ★사진 경로(server.mjs)와 글자 하나까지 같은 서명. 다르면 두 경로가 같은 알림을 두 번 보낸다.
//  근무·휴무 확정은 커트라인 무관(제외), 스페어·대기는 커트라인 전진이 '내 앞 N명'을 바꾸므로 포함.
export function stateSig(n) {
  if (!n) return '';
  const confirmed = ['assigned', 'work', 'your_turn', 'off'].includes(n.status);
  return confirmed
    ? `${n.status}|${n.teeTime || ''}|${n.course || ''}|${n.myPosition || ''}`
    : `${n.status}|${n.teeTime || ''}|${n.course || ''}|${n.cutLine || ''}|${n.myPosition || ''}`;
}
const logFile = (part) => (String(part) === '3' ? 'pushlog.json' : `pushlog${part}.json`);

// 이 회원에게 이 상태를 이미 알렸는가. 안 알렸으면 적어두고 false를 돌려준다.
//  ★적는 쪽과 보는 쪽이 같은 함수여야 한다 — 사람이 손으로 보낸 것도 여기에 적어야
//   자동이 곧바로 같은 말을 또 하지 않는다.
export function markNotified(userId, part, today, { onlyCheck = false } = {}) {
  const sig = stateSig(today);
  if (!sig) return true;
  const f = logFile(part), now = Date.now(), win = WINDOW();
  const log = loadUserJSON(userId, f, {}) || {};
  for (const k of Object.keys(log)) if (now - log[k] > win) delete log[k];
  const seen = log[sig] != null;
  if (!seen && !onlyCheck) log[sig] = now;
  saveUserJSON(userId, f, log);
  return seen;
}

// ── 배치표가 성립하는가 ────────────────────────────────────────────
//  판단이 아니라 계수다. 이 셋 중 하나라도 걸리면 그 배치표는 화면에서 사람이 사라지는 배치표다.
//  rows: [{pos, name, tee, course}] · cutLine: 근무선
export function boardIntegrity(rows, cutLine) {
  const bad = [];
  const seen = new Map();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const tee = String(r.tee || '').trim();
    const name = String(r.name || '').trim();
    if (!tee) continue;
    const k = `${tee}|${/IN/i.test(String(r.course)) ? 'IN' : 'OUT'}`;
    if (seen.has(k)) bad.push(`${k.replace('|', ' ')} — ${seen.get(k)}번과 ${r.pos}번이 같은 칸`);
    else seen.set(k, r.pos);
    if (!name) bad.push(`${r.pos}번 — 티오프는 있는데 이름이 없음`);
  }
  const names = (rows || []).filter((r) => String(r.name || '').trim()).length;
  if (Number(cutLine) > names) bad.push(`커트 ${cutLine} — 명단 ${names}명보다 큼`);
  return bad;
}

// 조용시간에도 곧바로 보낼 사람인가 — 오늘 1부 근무가 있는 회원(사용자 결정).
//  새벽에 나가는 사람에게 아침 8시 알림은 이미 늦다.
function worksPart1(userId) {
  try {
    const t = loadToday(userId, '1') || {};
    return WORKISH.includes(t.status) || !!String(t.teeTime || '').trim();
  } catch { return false; }
}

// ── 한 부의 바뀐 회원에게 자동으로 알린다 ──────────────────────────
//  rows·cutLine을 주면 보내기 전에 배치표가 성립하는지 먼저 센다.
//  돌려주는 것: { ok, sent[], queued[], skipped[], held, reason }
//   sent   — 방금 보낸 회원 id       · queued  — 조용시간이라 아침으로 미룬 회원 id
//   skipped— 이미 같은 상태를 알린 회원 · held    — 배치표가 깨져 통째로 멈춤(그러면 사람이 확인 후 손으로 보낸다)
export async function autoNotifyPart(part, { rows = null, cutLine = 0, by = '교정' } = {}) {
  const p = String(part);
  const out = { ok: true, sent: [], queued: [], skipped: [], held: false, reason: '' };
  if (!autoPushOn()) { out.ok = false; out.reason = '자동 발송이 꺼져 있습니다(AUTO_BOARD_PUSH=0)'; return out; }
  if (rows) {
    const bad = boardIntegrity(rows, cutLine);
    if (bad.length) {
      out.ok = false; out.held = true;
      out.reason = `배치가 어긋나 자동 발송을 멈췄습니다 — ${bad[0]}${bad.length > 1 ? ` 외 ${bad.length - 1}건` : ''}`;
      console.error(`🚫 [자동알림] ${p}부 멈춤 — ${out.reason}`);
      appendJSONL('board-autopush.jsonl', { at: Date.now(), part: p, by, held: true, problems: bad });
      return out;
    }
  }
  const pl = partLabel(p);
  const quiet = inQuietHours();
  for (const m of activeMembers()) {
    let today;
    try { today = (p === '3' ? loadToday(m.id) : loadToday(m.id, p)) || {}; } catch { continue; }
    // 이 부에 아무 상태도 없는 사람은 이 배치표와 무관하다.
    const has = !!(today.myPosition || today.teeTime || (today.status && today.status !== 'unknown'));
    if (!has) continue;
    if (markNotified(m.id, p, today)) { out.skipped.push(m.id); continue; }
    const cm = currentStateMsg(pl, m.board_name, today);
    // 조용시간엔 1부 근무자만 곧바로. 나머지는 broadcast가 대기열에 넣었다가 아침에 내보낸다.
    const now = !quiet || worksPart1(m.id);
    try {
      await broadcast({ title: cm.title, body: cm.body, url: '/', level: 'high', bypassQuiet: now }, m.id);
      (now ? out.sent : out.queued).push(m.id);
    } catch (e) { console.error(`[자동알림] 회원 ${m.id} 실패:`, e.message); }
  }
  const n = out.sent.length + out.queued.length;
  console.log(`📢 [자동알림] ${p}부 — 보냄 ${out.sent.length}명`
    + (out.queued.length ? ` · 아침대기 ${out.queued.length}명(조용시간)` : '')
    + (out.skipped.length ? ` · 이미 알림 ${out.skipped.length}명` : '')
    + ` (${by})`);
  if (n || out.skipped.length) {
    appendJSONL('board-autopush.jsonl', { at: Date.now(), part: p, by,
      sent: out.sent, queued: out.queued, skipped: out.skipped, quiet });
  }
  return out;
}
