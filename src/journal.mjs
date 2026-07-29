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
  j[dateISO] = {
    date: dateISO,
    kind: overall,
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
  return {
    work: days.filter((d) => d.kind === 'work').length,
    spare: days.filter((d) => d.kind === 'spare').length,
    off: days.filter((d) => d.kind === 'off').length,
    total: days.length,
  };
}
