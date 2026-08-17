// 3부 배치표 교정 — 판독 결과(lastboard)를 관리자가 준 rows로 바꾸고 전 회원을 다시 계산한다.
//
//  ★이 파일이 있는 이유: 이 로직이 모니터 핸들러 안에만 있으면, 화면 밖에서 같은 일을 해야 할 때
//   (복구·스크립트) 반드시 두 번째 사본이 생긴다. 그러면 둘이 조용히 갈라진다 —
//   실제로 대조판 저장이 예상 격자를 본배치표로 밀어넣은 사고도 '축이 갈라진' 같은 종류였다.
//   교정은 한 곳에서만 일어난다.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.mjs';
import { loadToday, saveToday, dayKey, applyVerdict } from './today.mjs';
import { interpretForMember } from './judge.mjs';
import { activeMembers } from './users.mjs';

export const nkey = (s) => String(s || '').replace(/\s/g, '');

export function loadLastBoard() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'lastboard.json'), 'utf8')); } catch { return null; }
}

// 정정 알림 문구 — '실제로 바뀐 회원'에게만 만든다(즉시 발송하지 않는다).
export function correctionMsg(partLabel, name, s) {
  if (s.nowOff && !s.wasOff) return { title: `${partLabel} 휴무`, body: `${name}님, ${partLabel} 오늘은 휴무로 확인됐어요. 편히 쉬세요.` };
  if ((s.wasWait || s.wasOff) && s.nowWork && s.pos > 0) return { title: `${partLabel} 근무 전환`, body: `${name}님, ${partLabel} 근무로 확정됐어요${s.newTee ? ` — 티오프 ${s.newTee}` : ''}. 배치표를 확인해주세요.` };
  if (s.wasWork && s.nowSpare) return { title: `${partLabel} 스페어 전환`, body: `${name}님, ${partLabel} 스페어(대기)로 전환됐어요.` };
  if (s.wasWork && s.nowWork && s.oldTee && s.newTee && s.oldTee !== s.newTee) return { title: `${partLabel} 티오프 변경!`, body: `${name}님, ${partLabel} 티오프가 ${s.oldTee} → ${s.newTee}(으)로 변경됐어요. 출발·백대기 시각도 확인해주세요.` };
  return null;
}

// rows: [{pos, name, tee, course, duty?}] — 명단 전체. 일부만 주면 나머지가 사라진다.
// interns: [{time, course}] · cutLine: 근무선 · notify: 정정 문구를 만들지 여부(발송은 호출자 몫)
export function correctPart3({ rows, interns = [], cutLine = 0, notify = false, by = 'admin' }) {
  if (!Array.isArray(rows)) throw new Error('rows 필요');
  const lb = loadLastBoard();
  if (!lb || !lb.rawVerdict) throw new Error('현재 배치표가 없어요.');
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
      else if (/휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[key] || ''))) { cellDiffs.push({ pos: p, field: 'duty', model: crew[key], admin: '' }); crew[key] = ''; }
    }
    if (nm !== (origRoster[p - 1] || '')) cellDiffs.push({ pos: p, field: 'name', model: origRoster[p - 1] || '', admin: nm });
    if (tee !== (origGrid[p] || '')) cellDiffs.push({ pos: p, field: 'tee', model: origGrid[p] || '', admin: tee });
  }
  const iTees = interns.map((x) => { const t = (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0]; return t ? { time: t, course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') } : null; }).filter(Boolean);
  v.part3Roster = roster; v.teeGrid = grid; v.crewDuty = crew; v.internTees = iTees; v.internCount = iTees.length;
  // ★팀 수도 같이 옮긴다 — 근무선이 곧 팀 수다(1·2부 경로와 같은 이유).
  if (cutLine) { v.cutLine = cutLine; v.cutoffPosition = cutLine; v.teamCount = cutLine; v.cutoffName = roster[cutLine - 1] || v.cutoffName || ''; }
  v._adminCorrected = { at: Date.now(), by }; delete v._uncertain;
  lb.rawVerdict = v;
  try { fs.writeFileSync(path.join(DATA_DIR, 'lastboard.json'), JSON.stringify(lb)); } catch (e) { console.error('lastboard 저장 실패:', e.message); }
  if (cellDiffs.length) {
    const line = { at: Date.now(), type: 'board', boardArticleId: lb.id, date: v.dateLabel || '', cutLine, changes: cellDiffs };
    try { fs.appendFileSync(path.join(DATA_DIR, 'admin-corrections.jsonl'), JSON.stringify(line) + '\n'); } catch (e) { console.error('교정로그 실패:', e.message); }
  }
  const rosterNk = new Set(roster.map(nkey).filter(Boolean));
  const diffPositions = new Set(cellDiffs.map((d) => Number(d.pos)));   // 관리자가 실제 손댄 순번
  const dk = dayKey(v.dateLabel || lb.dateLabel || '');
  let updated = 0; const pending = [];
  for (const m of activeMembers()) {
    const today = loadToday(m.id) || {};
    // 이 배치표에 없는 휴무자(다른 근태로 쉬는 사람)는 건드리지 않음 — 배치표에 이름이 있으면 재계산.
    if (today.status === 'off' && !rosterNk.has(nkey(m.board_name))) continue;
    const member = { name: m.board_name, part: String(m.part || 3), commuteMin: Number(m.commute_min) };
    let next;
    try {
      const mout = interpretForMember(lb.article, JSON.parse(JSON.stringify(v)), member, today);
      next = applyVerdict(today, mout.rawVerdict, lb.article, { name: m.board_name, part: String(m.part || 3) }).next;
    } catch (e) { console.error(`배치표교정 재계산 오류(회원 ${m.id}):`, e.message); continue; }
    const isOff = next.status === 'off';   // 근태칸(crewDuty) 휴무/병가 → interpretForMember가 이미 off로 확정
    const pos = Number(next.myPosition) || 0;
    if (!isOff && pos > 0 && cutLine > 0) {
      next.cutLine = cutLine;
      const hasTee = next.teeTime && /\d{1,2}:\d{2}/.test(String(next.teeTime));
      const inWork = pos <= cutLine;
      next.status = inWork ? (hasTee ? 'assigned' : 'work') : 'spare';
      if (!inWork) { next.teeTime = ''; next.course = ''; }
    }
    // ★'실제 바뀐 회원만' 잠근다 — 전 회원 잠금은 이후 같은 배치표 변동(당추 등)까지 얼려버린다(이수련 동결 사고).
    delete next._adminLock;
    const _chg = today.status !== next.status || String(today.teeTime || '') !== String(next.teeTime || '') || Number(today.myPosition || 0) !== pos;
    if (_chg || diffPositions.has(pos)) {
      next._adminLock = { dk, articleId: String(lb.id), fields: { status: 1, teeTime: 1, course: 1, cutLine: 1, myPosition: 1, offType: 1 }, by, at: Date.now() };
    }
    next.updatedAt = Date.now();
    const wasWait = ['spare', 'waiting', 'near'].includes(today.status), wasWork = ['work', 'assigned', 'your_turn'].includes(today.status), wasOff = today.status === 'off';
    const nowWork = ['work', 'assigned', 'your_turn'].includes(next.status), nowSpare = ['spare', 'waiting', 'near'].includes(next.status), nowOff = next.status === 'off';
    saveToday(next, m.id); updated++;
    if (notify) {
      const cm = correctionMsg(`${member.part}부`, m.board_name, { wasWait, wasOff, wasWork, nowWork, nowSpare, nowOff, pos, oldTee: today.teeTime || '', newTee: next.teeTime || '' });
      if (cm) pending.push({ id: m.id, name: m.board_name, title: cm.title, body: cm.body });
    }
  }
  console.log(`📋 [교정] 배치표 #${lb.id} 3부: 칸 ${cellDiffs.length}·인턴 ${iTees.length}·커트 ${cutLine} → 재계산 ${updated}명${pending.length ? ` · 정정대상 ${pending.length}명` : ''}`);
  return { cellChanges: cellDiffs.length, cellDiffs, interns: iTees.length, updated, pending, articleId: lb.id, dateLabel: v.dateLabel || '' };
}
