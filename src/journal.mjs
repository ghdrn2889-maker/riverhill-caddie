// 일일 근무 일지 — 하루하루 김홍구의 '최종 상태'(근무/스페어/휴무)를 기록.
//  피드(소식)는 흘려보내되, 남길 가치가 있는 '그날 결과'만 여기에 구조화해 보관.
//  같은 날 여러 번 갱신되면 마지막 상태가 그날의 최종(스페어→근무 확정되면 근무로 확정).
import { loadUserJSON, saveUserJSON } from './store.mjs';

const FILE = 'journal.json';

// status → 사람이 읽는 분류
export function dayKind(status) {
  if (status === 'assigned' || status === 'work' || status === 'your_turn') return 'work';
  if (status === 'spare' || status === 'waiting' || status === 'near') return 'spare';
  if (status === 'off') return 'off';
  return 'unknown';
}

export function recordDayStatus(dateISO, info = {}, userId = 1) {
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return;
  const kind = dayKind(info.status);
  if (kind === 'unknown') return; // 미상 상태는 일지에 남기지 않음(확정 상태만)
  const part = String(info.part || '3');
  const j = loadUserJSON(userId, FILE, {});
  const prev = j[dateISO] || {};
  if (prev.userKind) return; // ★사용자가 일지에서 직접 보정한 날은 자동 판독이 덮지 않음(수동 우선)
  // ★순번 제외(off:removed): 배치표 순번에 있다 최신 배치표에서 빠짐 → 그날 전체를 '순번 제외'로.
  //  유령/이전 근무 라운드(두탕 등)를 정리해 '근무·두탕'으로 잘못 뜨는 걸 막는다.
  if (info.status === 'off' && info.offReason === 'removed') {
    j[dateISO] = {
      date: dateISO, kind: 'off', status: 'off', offReason: 'removed', excluded: true,
      teeTime: '', course: '', myPosition: null,
      prevPosition: info.prevPosition ?? prev.prevPosition ?? prev.myPosition ?? null,
      cutoffName: info.cutoffName || prev.cutoffName || '',
      rounds: {}, twoRounds: false, updatedAt: Date.now(),
    };
    saveUserJSON(userId, FILE, j);
    return;
  }
  // 순번 제외로 표기된 날: 실제 티오프가 있는 '진짜 근무'(배치표 재등재)이거나 주(主) 3부 신호일 때만
  //  되살린다 — 티오프 없는 부차(1·2부) 유령 근무표시로는 제외를 뒤집지 않는다.
  if (prev.excluded && !(part === '3' || info.teeTime)) return;
  // ★"2,3 출근" 두 탕: rounds[부]에 부별 결과 보관. 대표 kind = 어느 라운드든 work면 work(둘 다 스페어면 spare).
  const rounds = { ...(prev.rounds || {}) };
  rounds[part] = { part, kind, status: info.status || '', teeTime: info.teeTime || '', course: info.course || '', myPosition: info.myPosition ?? null };
  const kinds = Object.values(rounds).map((r) => r.kind);
  const overall = kinds.includes('work') ? 'work' : kinds.includes('spare') ? 'spare' : kinds.includes('off') ? 'off' : kind;
  // 대표 티오프: 근무 라운드 우선(3부>2부).
  const primary = (rounds['3']?.kind === 'work' && rounds['3'].teeTime) ? rounds['3']
    : Object.values(rounds).find((r) => r.kind === 'work' && r.teeTime) || null;
  const workCount = Object.values(rounds).filter((r) => r.kind === 'work').length;
  // 휴무 vs 휴가 vs 병가: off일 때만 offType 보관(sick/vacation 신호 우선, 없으면 이전 값·기본 off).
  const offType = overall === 'off'
    ? (info.offType === 'sick' ? 'sick' : info.offType === 'vacation' ? 'vacation' : (prev.offType || 'off'))
    : null;
  j[dateISO] = {
    date: dateISO,
    kind: overall,
    offType,
    status: (part === '3' ? info.status : prev.status) || info.status || prev.status || '',
    teeTime: primary?.teeTime || (kind === 'work' ? info.teeTime : '') || prev.teeTime || '',
    course: primary?.course || (kind === 'work' ? info.course : '') || prev.course || '',
    myPosition: part === '3' ? (info.myPosition ?? prev.myPosition ?? null) : (prev.myPosition ?? info.myPosition ?? null),
    cutoffName: info.cutoffName || prev.cutoffName || '',
    rounds,
    twoRounds: workCount >= 2,
    updatedAt: Date.now(),
  };
  saveUserJSON(userId, FILE, j);
}

// ★수동 보정 — 사용자가 일지에서 그날 분류를 직접 지정(근무/스페어/휴무/휴가/순번 제외).
//  userKind:true 로 표식해 이후 자동 판독이 덮지 않게 한다(수동 우선). null 지정 시 자동으로 되돌림.
const MANUAL_KINDS = { work: 'work', spare: 'spare', off: 'off', vacation: 'off', sick: 'off', removed: 'off' };
export function setDayKind(dateISO, choice, userId = 1) {
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const j = loadUserJSON(userId, FILE, {});
  const prev = j[dateISO] || { date: dateISO };
  // 자동으로 되돌리기(수동 표식 해제) — 다음 판독 때 다시 자동 분류됨.
  if (choice == null || choice === 'auto') {
    if (prev.userKind) { delete prev.userKind; prev.updatedAt = Date.now(); j[dateISO] = prev; saveUserJSON(userId, FILE, j); }
    return j[dateISO] || null;
  }
  if (!(choice in MANUAL_KINDS)) return prev;
  const kind = MANUAL_KINDS[choice];
  const next = {
    ...prev, date: dateISO, kind, userKind: true,
    offType: kind === 'off' ? (choice === 'vacation' ? 'vacation' : choice === 'sick' ? 'sick' : 'off') : null,
    excluded: choice === 'removed',
    offReason: choice === 'removed' ? 'removed' : undefined,
    updatedAt: Date.now(),
  };
  if (kind !== 'work') { next.teeTime = ''; next.course = ''; next.twoRounds = false; next.rounds = {}; }
  if (choice === 'removed') { next.myPosition = null; }
  j[dateISO] = next;
  saveUserJSON(userId, FILE, j);
  return next;
}

// ★기록 삭제 — 캘린더에서 잘못 넣은 날을 통째로 지움(일지에서 제거). 정산 dayParts는 서버에서 함께 클리어.
export function removeDay(dateISO, userId = 1) {
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return false;
  const j = loadUserJSON(userId, FILE, {});
  if (!(dateISO in j)) return false;
  delete j[dateISO];
  saveUserJSON(userId, FILE, j);
  return true;
}

// 특정 날짜의 최종 기록(그날 결과) 조회 — 응원 문구가 '오늘 무근무' 등을 인식하는 근거.
export function getDay(dateISO, userId = 1) {
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const j = loadUserJSON(userId, FILE, {});
  return j[dateISO] || null;
}

export function listJournal({ year, month } = {}, userId = 1) {
  const j = loadUserJSON(userId, FILE, {});
  return Object.values(j)
    .filter((d) => {
      if (!year) return true;
      const [y, m] = String(d.date).split('-').map(Number);
      return y === year && (!month || m === month);
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function summary({ year, month } = {}, userId = 1) {
  const days = listJournal({ year, month }, userId);
  const off = days.filter((d) => d.kind === 'off');
  return {
    work: days.filter((d) => d.kind === 'work').length,
    spare: days.filter((d) => d.kind === 'spare').length,
    off: off.filter((d) => !d.excluded && d.offType !== 'vacation' && d.offType !== 'sick').length, // 순수 휴무
    vacation: off.filter((d) => !d.excluded && d.offType === 'vacation').length,
    sick: off.filter((d) => !d.excluded && d.offType === 'sick').length,
    removed: off.filter((d) => d.excluded).length,
    total: days.length,
  };
}
