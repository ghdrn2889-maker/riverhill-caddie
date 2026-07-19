// 일일 근무 일지 — 하루하루 김홍구의 '최종 상태'(근무/스페어/휴무)를 기록.
//  피드(소식)는 흘려보내되, 남길 가치가 있는 '그날 결과'만 여기에 구조화해 보관.
//  같은 날 여러 번 갱신되면 마지막 상태가 그날의 최종(스페어→근무 확정되면 근무로 확정).
import { loadJSON, saveJSON } from './store.mjs';

const FILE = 'journal.json';

// status → 사람이 읽는 분류
export function dayKind(status) {
  if (status === 'assigned' || status === 'work' || status === 'your_turn') return 'work';
  if (status === 'spare' || status === 'waiting' || status === 'near') return 'spare';
  if (status === 'off') return 'off';
  return 'unknown';
}

export function recordDayStatus(dateISO, info = {}) {
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return;
  const kind = dayKind(info.status);
  if (kind === 'unknown') return; // 미상 상태는 일지에 남기지 않음(확정 상태만)
  const j = loadJSON(FILE, {});
  const prev = j[dateISO] || {};
  j[dateISO] = {
    date: dateISO,
    kind,
    status: info.status || prev.status || '',
    teeTime: (kind === 'work' ? (info.teeTime || prev.teeTime) : (info.teeTime || prev.teeTime)) || '',
    course: info.course || prev.course || '',
    myPosition: info.myPosition ?? prev.myPosition ?? null,
    cutoffName: info.cutoffName || prev.cutoffName || '',
    updatedAt: Date.now(),
  };
  saveJSON(FILE, j);
}

export function listJournal({ year, month } = {}) {
  const j = loadJSON(FILE, {});
  return Object.values(j)
    .filter((d) => {
      if (!year) return true;
      const [y, m] = String(d.date).split('-').map(Number);
      return y === year && (!month || m === month);
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function summary({ year, month } = {}) {
  const days = listJournal({ year, month });
  return {
    work: days.filter((d) => d.kind === 'work').length,
    spare: days.filter((d) => d.kind === 'spare').length,
    off: days.filter((d) => d.kind === 'off').length,
    total: days.length,
  };
}
