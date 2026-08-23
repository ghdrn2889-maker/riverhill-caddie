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
import { keyFromLabel } from './boardpending.mjs';
import { internTeesFor, setManual, teeKey } from './interns.mjs';

// ★키는 '맨 이름'이다 — 태그를 뗀다. 판독(judge.mjs:424,517)이 crewDuty를 그렇게 읽기 때문이다.
//  전에는 여기서만 태그를 남겨서, 태그 달린 사람(표승완(54)·문태익(1,3) 등 7명)은
//  관리자가 근태를 줘도 판독이 다른 키를 보느라 못 읽었다. 회원 대조(rosterNk)도 같은 이유로 빗나갔다.
//  두 곳이 같은 키를 써야 한다 — 안 그러면 한쪽이 쓴 것을 다른 쪽이 영영 못 본다.
export const nkey = (s) => String(s || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '');

export function loadLastBoard() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'lastboard.json'), 'utf8')); } catch { return null; }
}

// 정정 알림 문구 — '실제로 바뀐 회원'에게만 만든다(즉시 발송하지 않는다).
export function correctionMsg(partLabel, name, s) {
  if (s.nowOff && !s.wasOff) return { title: `${partLabel} 휴무`, body: `${name}님, ${partLabel} 오늘은 휴무로 확인됐습니다.` };
  if ((s.wasWait || s.wasOff) && s.nowWork && s.pos > 0) return { title: `${partLabel} 근무 배정`, body: `${name}님, ${partLabel} 근무로 확정됐습니다${s.newTee ? ` — 티오프 ${s.newTee}` : ''}.` };
  if (s.wasWork && s.nowSpare) return { title: `${partLabel} 스페어 전환`, body: `${name}님, ${partLabel} 스페어(대기)로 전환됐습니다.` };
  if (s.wasWork && s.nowWork && s.oldTee && s.newTee && s.oldTee !== s.newTee) return { title: `${partLabel} 티오프 변경`, body: `${name}님, ${partLabel} 티오프가 ${s.oldTee} → ${s.newTee}(으)로 바뀌었습니다. 출발·백대기 시각도 함께 바뀝니다.` };
  return null;
}

// rows: [{pos, name, tee, course, duty?}] — 명단 전체. 일부만 주면 나머지가 사라진다.
// interns: [{time, course}] · cutLine: 근무선 · notify: 정정 문구를 만들지 여부(발송은 호출자 몫)
// allInterns: 화면이 들고 있는 인턴 '전부'. interns는 그중 실제 배치표에 팀이 있는 칸만이다.
//  배치표(lastboard)에는 팀이 있는 칸만 넣고, 관리자 수동 지정에는 전부를 남긴다 —
//  둘을 같은 목록으로 취급하면 넘길 수 없는 인턴이 지정 자체에서 지워진다(실사고).
// movedOut: [{name, to}] — 이 부에서 '다른 부로 대바로 나간' 사람. 명단에서 빠진 것과는 다른 사실이다.
//  ★빠진 사람을 그냥 다시 계산하면 판독이 '휴무(off)'로 적는다. 그런데 3부 휴무는 대시보드에서
//   그 회원의 1·2부 카드까지 통째로 지운다(rounds.mjs primaryOff). 대바로 2부에 간 사람이
//   앱에서 '오늘 휴무'가 되어버린다 — 정확히 반대의 사실이고, 그 사람은 출근한다.
//   그래서 '이 부엔 없음(unknown)'으로 적는다. 휴무가 아니라 없음이다.
export function correctPart3({ rows, interns = [], allInterns = null, cutLine = 0, notify = false, by = 'admin', dutySet = null, movedOut = null }) {
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
    // ★근태는 '보낸 행'만 만진다. duty 항목 자체가 없으면 손대지 않는다.
    //  전에는 안 보내는 것과 '해제하라'가 같았다 — 근태를 안 싣는 화면이 반영하면
    //  판독이 제대로 읽어둔 휴무가 통째로 지워졌다(대조판이 정확히 그 상태였다).
    //  판독이 잡아낸 것을 수동 화면이 조용히 지우는 일은 없어야 한다.
    const key = nkey(nm);
    if (key && r.duty !== undefined) {
      const d = String(r.duty || '');
      if (/병가|휴무|휴가/.test(d)) { if (crew[key] !== d) cellDiffs.push({ pos: p, field: 'duty', model: crew[key] || '', admin: d }); crew[key] = d; }
      else if (/휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[key] || ''))) { cellDiffs.push({ pos: p, field: 'duty', model: crew[key], admin: '' }); crew[key] = ''; }
      const legacy = String(nm).replace(/\s/g, '');           // 옛 교정이 남긴 태그 포함 키 정리
      if (legacy !== key && crew[legacy] !== undefined && /휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[legacy]))) delete crew[legacy];
    }
    if (nm !== (origRoster[p - 1] || '')) cellDiffs.push({ pos: p, field: 'name', model: origRoster[p - 1] || '', admin: nm });
    if (tee !== (origGrid[p] || '')) cellDiffs.push({ pos: p, field: 'tee', model: origGrid[p] || '', admin: tee });
  }
  // ★근태는 순번 명단과 별개 축이다 — 휴무자는 배치표 순번 명단에 없고 근태칸에만 적힌다
  //  (실측: 3부 근태 17명 중 명단에 있는 사람 0명). 그래서 rows(=명단)만으로는 그들을 말할 수 없다.
  //  dutySet은 '이름 → 근태' 한 장이다. 값이 비면 해제. 보내지 않은 이름은 건드리지 않는다.
  for (const [nm2, d2] of Object.entries(dutySet || {})) {
    const k = nkey(nm2); if (!k) continue;
    const v2 = String(d2 || '');
    if (/병가|휴무|휴가/.test(v2)) { if (crew[k] !== v2) cellDiffs.push({ pos: 0, field: 'duty', name: nm2, model: crew[k] || '', admin: v2 }); crew[k] = v2; }
    else if (/휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[k] || ''))) { cellDiffs.push({ pos: 0, field: 'duty', name: nm2, model: crew[k], admin: '' }); crew[k] = ''; }
  }
  const iTees = interns.map((x) => { const t = (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0]; return t ? { time: t, course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') } : null; }).filter(Boolean);
  // ★인턴은 두 군데에 따로 살면 안 된다.
  //  실사고: 관리자가 대조판에서 인턴을 지정하고 앱에 반영했는데, 새로고침하면 사라졌다.
  //   반영은 lastboard.internTees에 썼고, 대조판은 intern-tees(수동 지정)에서 읽었다.
  //   그 날짜에 수동 지정이 하나라도 있으면 수동이 전부를 대신하므로(설계상 옳다),
  //   방금 반영한 인턴은 화면에서 통째로 안 보였다 — 저장이 안 된 것처럼.
  //  그래서 '관리자가 인턴을 실제로 바꾼 교정'이면 수동 지정도 같이 옮긴다.
  //  ★안 바뀌었으면 건드리지 않는다 — 이름만 고친 교정까지 수동으로 굳히면
  //   그 뒤 새 배치표의 노란 칸 판독이 조용히 무시된다.
  const ikey = keyFromLabel(v.dateLabel || lb.dateLabel || '') || '';
  const sig = (a) => (a || []).map((t) => teeKey({ time: t.time, course: /IN/i.test(t.course) ? 'IN' : 'OUT' })).sort().join(' ');
  // 수동 지정에는 '전부'를 남긴다.
  //  ★안 주면 추측하지 않는다. 예전엔 '넘어온 것이 곧 전부'로 알아들었는데, 그 추측이
  //   인턴을 건드리지도 않은 교정에서 그날 수동 지정을 판독값으로 덮어 지웠다.
  //   말하지 않은 것과 '비웠다'는 다르다 — 안 실은 호출은 인턴을 손대지 않은 것으로 본다.
  const manTees = Array.isArray(allInterns)
    ? allInterns.map((x) => { const t = (String(x.time).match(/\d{1,2}:\d{2}/) || [''])[0]; return t ? { time: t, course: (/IN/i.test(String(x.course)) ? 'IN' : 'OUT') } : null; }).filter(Boolean)
    : null;
  if (ikey && manTees) {
    const before = sig(internTeesFor(ikey, Array.isArray(v.internTees) ? v.internTees : [], '3'));
    if (before !== sig(manTees)) {
      try { setManual(ikey, manTees, { by, part: '3', note: '배치표 교정' }); }
      catch (e) { console.error('인턴 수동 지정 저장 실패:', e.message); }
    }
  }
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
  const movedTo = new Map((Array.isArray(movedOut) ? movedOut : [])
    .map((x) => [nkey(x && x.name), String((x && x.to) || '')]).filter(([k]) => k));
  let updated = 0; const pending = [];
  for (const m of activeMembers()) {
    const today = loadToday(m.id) || {};
    // ── 부 간 대바로 이 부를 떠난 사람 ── 휴무가 아니라 '이 부엔 없음'이다.
    if (movedTo.has(nkey(m.board_name))) {
      const to = movedTo.get(nkey(m.board_name));
      const next = { ...today, date: v.dateLabel || today.date || '', status: 'unknown',
        myPosition: 0, teeTime: '', course: '', cutLine: null,
        _swappedOut: { to: to, at: Date.now(), by: by }, updatedAt: Date.now() };
      delete next.offType; delete next._offReason;
      // 같은 배치표를 다시 읽어도 되살아나지 않게 잠근다 — 사진엔 아직 그 사람이 3부에 있다.
      //  새 배치표(다른 글)가 오면 잠금은 저절로 풀린다(today.mjs applyAdminLock).
      next._adminLock = { dk, articleId: String(lb.id), fields: { status: 1, teeTime: 1, course: 1, cutLine: 1, myPosition: 1, offType: 1 }, by, at: Date.now() };
      saveToday(next, m.id); updated++;
      console.log(`🔁 [교정] ${m.board_name}: 3부 → ${to}부 대바(3부 상태 비움)`);
      continue;
    }
    // 이 배치표에 없는 휴무자(다른 근태로 쉬는 사람)는 건드리지 않음 — 배치표에 이름이 있으면 재계산.
    if (today.status === 'off' && !rosterNk.has(nkey(m.board_name))) continue;
    const member = { name: m.board_name, part: String(m.part || 3), commuteMin: Number(m.commute_min) };
    let next;
    // ★잠금은 '자동 재판독이 관리자 교정을 덮지 못하게' 하는 장치다. 관리자 본인의 다음 교정까지
    //  막으면 안 된다. 실측 2026-08-21: 22:54 교정으로 걸린 잠금 때문에 그 다음 교정(강경순을
    //  2부에서 빼고 순번을 당김)이 회원 카드에 반영되지 않았다 — 명단은 바뀌었는데 사람은 옛 티오프를
    //  들고 있었다. 그래서 여기서는 잠금을 벗기고 다시 계산하고, 바뀐 사람에게 새로 건다(아래).
    const base = { ...today }; delete base._adminLock;
    try {
      const mout = interpretForMember(lb.article, JSON.parse(JSON.stringify(v)), member, base);
      // ★교정본 표식을 다시 붙인다 — interpretForMember가 _adminCorrected·rosterReliable을 떨어뜨린다.
      //  이게 없으면 프레임보호가 '짧아진 명단'으로 보고 막아, 순번만 바뀌고 명단은 옛것으로 남는다
      //  (실측 2026-08-21: myPosition 27인데 roster3의 27번은 여전히 조하빈이었다).
      if (mout.rawVerdict) {
        mout.rawVerdict._adminCorrected = v._adminCorrected;
        mout.rawVerdict.rosterReliable = true;
      }
      next = applyVerdict(base, mout.rawVerdict, lb.article, { name: m.board_name, part: String(m.part || 3) }).next;
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
