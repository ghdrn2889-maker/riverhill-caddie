// 당번/벌당 — 배치표 하단 '당번·벌당' 섹션에서 읽는 '그날의 특별 역할'. 순번 근무와 별개다.
//  당번 = 7시간(늦게 시작), 벌당 = 13시간(일찍 출근). 시작·근무시간은 부·종류별로 고정
//  (관리자 확인 2026-08-14). 배치표엔 '이름 + N부 당번/벌당'만 있으면 되고, 시각은 이 표가 채운다.
//
//  근태(휴무/병가)와 같은 경로로 회원에게 붙는다: 판독이 board 단위 dutyList를 만들고
//  interpretForMember가 회원 이름으로 찾아 v.myDuty로 얹는다. 저장은 today.myDuty.

import { loadUserJSON, saveUserJSON } from './store.mjs';
import { setDayDuty } from './journal.mjs';

export const DUTY_KINDS = ['당번', '벌당'];

const FILE = 'duty.json';
const KEEP_DAYS = 30;              // 지난 당번은 한 달만 들고 있는다(일지가 영구 기록을 갖는다)

// ── 저장 형태 ───────────────────────────────────────────────
//  { "2026-08-24": { kind:'당번', part:'2', by:'admin', at:… }, … } — 날짜별.
//  ★예전엔 회원당 한 건이었고 그 한 건이 '오늘'이 아니면 없는 것으로 쳤다.
//   어제 당번이 오늘 화면에 남지 않게 하려던 장치인데, 내일 당번을 미리 넣을 자리까지 같이 없앴다.
//   당번은 원래 하루 전에 알려주는 일이라 그릇이 하루치뿐인 게 문제였다
//   (2026-08-23 실사고: 관리자가 내일 당번을 넣었는데 오늘로 저장되고, 화면엔 끝내 안 떴다).
//  옛 한 건짜리 파일은 읽을 때 자동으로 날짜별로 옮긴다(멱등).
function loadAll(userId) {
  const raw = loadUserJSON(userId, FILE, null);
  if (!raw || typeof raw !== 'object') return {};
  if (raw.kind && raw.date) return { [String(raw.date)]: { kind: raw.kind, part: raw.part || '', by: raw.by || '', at: raw.at || 0 } };
  return raw;
}
function saveAll(userId, all) {
  const keys = Object.keys(all).sort();
  while (keys.length > KEEP_DAYS) delete all[keys.shift()];
  saveUserJSON(userId, FILE, Object.keys(all).length ? all : null);
}

// 그 날짜의 역할. 날짜를 안 주면 아무것도 돌려주지 않는다 — '어느 날' 없이는 답이 없다.
export function loadDuty(userId, dateISO) {
  const d = String(dateISO || '');
  if (!d) return null;
  const rec = loadAll(userId)[d];
  return (rec && rec.kind) ? { date: d, ...rec } : null;
}
// by: 'admin'(모니터 수동) | 'board'(하단 배정표 자동판독).
//  ★admin이 넣은 값은 그날 자동판독이 덮지 못한다 — 안 그러면 수동 교정이 90초 뒤 배치표 재판독에 지워진다.
export function saveDuty(userId, date, kind, part, by = 'admin') {
  const k = String(kind || '').trim(), p = String(part || '').replace(/[^123]/g, '');
  const d = String(date || '');
  if (!d) return null;                                      // 날짜 없는 저장은 받지 않는다
  const all = loadAll(userId);
  if (!k) {
    delete all[d];                                          // 빈 값 = 그 날짜만 해제(다른 날은 그대로)
    saveAll(userId, all);
    try { setDayDuty(d, null, userId); } catch { /* 일지 기록 실패는 무해 */ }
    return null;
  }
  const rec = { kind: k, part: p, by, at: Date.now() };
  all[d] = rec;
  saveAll(userId, all);
  // ★근무 기록에도 남긴다 — 히어로에만 뜨고 일지에 안 남으면 그날 일한 사실이 사라진다.
  try { setDayDuty(d, { kind: k, part: p }, userId); } catch { /* 무해 */ }
  return { date: d, ...rec };
}
// 그 회원이 '역할'을 가진 날짜들 — 미리 넣어둔 앞날을 화면이 찾아갈 때 쓴다.
export function dutyDates(userId) {
  const all = loadAll(userId);
  return Object.keys(all).filter((d) => all[d] && all[d].kind).sort();
}
// 그날 이 회원의 당번이 '관리자 확정'인가 — 자동판독이 건너뛸지 판단.
export function isAdminSet(userId, dateISO) {
  const d = loadDuty(userId, dateISO);
  return !!(d && d.by === 'admin');
}
// 회원 화면에 내려줄 형태 — 시각·근무시간을 고정 시간표에서 채워 반환. 없으면 null.
//  ★이름은 'ForToday'지만 날짜를 받는다 — 화면이 내일 배치표를 보고 있으면 내일 당번을 물어야 한다.
export function dutyForToday(userId, dateISO) {
  const d = loadDuty(userId, dateISO);
  if (!d) return null;
  const s = dutySummary(d.kind, d.part);
  return { kind: s.kind, part: s.part, start: s.start, end: s.end, hours: s.hours, label: s.label };
}

// 부·종류별 표준 시간표(고정). start=출근시각, hours=근무시간.
//  ★없는 조합(예: 2부 벌당)은 undefined — 역할은 인정하되 시각은 비운다(관리자 확인 전까지).
const DUTY_SCHEDULE = {
  당번: { 1: { start: '11:00', hours: 7 }, 2: { start: '11:00', hours: 7 }, 3: { start: '15:00', hours: 7 } },
  벌당: { 1: { start: '06:20', hours: 13 }, 3: { start: '10:00', hours: 13 } },
};

// 문자열에서 부 숫자만("1부"→"1", "3"→"3", "1,3"→"1"): 당번 슬롯은 단일 부라 첫 숫자만.
function partNum(part) { const m = String(part || '').match(/[123]/); return m ? m[0] : ''; }
// 종류 정규화 — '벌당'만 벌당, 그 외 당번류(당번/당) 취급. 알 수 없으면 빈값.
function normKind(kind) {
  const s = String(kind || '').replace(/\s/g, '');
  if (/벌당/.test(s)) return '벌당';
  if (/당번|^당$/.test(s)) return '당번';
  return '';
}

// 부·종류 → 고정 시간표 조회. 없으면 null.
export function dutyInfo(kind, part) {
  const k = normKind(kind); const p = partNum(part);
  const row = DUTY_SCHEDULE[k];
  return (row && k && p && row[p]) ? { kind: k, part: p, start: row[p].start, hours: row[p].hours } : null;
}

// ── 시각 계산 ──
const toMin = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? (Number(m[1]) * 60 + Number(m[2])) : null; };
const pad2 = (n) => String(n).padStart(2, '0');
const fromMin = (min) => { const m = ((min % 1440) + 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };

// 종료 시각 = 시작 + 근무시간. (실제 조합은 모두 자정 전 종료: 당번 18:00/22:00, 벌당 19:20/23:00)
export function dutyEnd(kind, part) {
  const i = dutyInfo(kind, part); if (!i) return '';
  const s = toMin(i.start); if (s == null) return '';
  return fromMin(s + i.hours * 60);
}

// ★히어로 전환 규칙 — 지금이 근무 전/중/후 중 어디인가.
//   before(출근 전) = 부감 대기장 보드(곧 맡을 자리를 내려다봄)
//   during(근무 중) = 카트 차고 보드(그 안에서 일하는 중)
//   done(종료)      = 평소 상태로 복귀(당번 보드 내림)
//  nowMin(자정부터 분)을 주입할 수 있어 테스트·시뮬레이션이 쉽다.
export function dutyPhase(kind, part, nowMin) {
  const i = dutyInfo(kind, part); if (!i) return 'before';
  const s = toMin(i.start); if (s == null) return 'before';
  const e = s + i.hours * 60;
  const n = Number.isFinite(nowMin) ? nowMin : (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
  if (n < s) return 'before';
  return n < e ? 'during' : 'done';
}

// 회원 표시용 요약 — {kind, part, start, hours, label, sub}. 시간표에 없는 조합도 역할은 표시(시각만 비움).
export function dutySummary(kind, part) {
  const k = normKind(kind) || String(kind || '').trim();
  const p = partNum(part);
  const info = dutyInfo(k, p);
  if (info) {
    const end = dutyEnd(k, p);
    return { ...info, end, label: `${info.part}부 ${info.kind}`, sub: `${info.start} 출근 · ${info.hours}시간` };
  }
  return { kind: k, part: p, start: '', end: '', hours: null, label: p ? `${p}부 ${k}` : k, sub: '' };
}

// 배치표 하단 섹션 한 줄에서 {name, part, kind} 추출 — "홍길동 1부 당번 11:00 ~ (7시간)" 형태.
//  ★실제 배치표 하단 레이아웃 확인 후 최종 튜닝 예정(이름이 슬롯마다 붙는지, 헤더 아래 나열인지).
export function parseDutyLine(line) {
  const s = String(line || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/([가-힣]{2,4})\s*[·:]?\s*([123])\s*부\s*(당번|벌당)/);
  if (!m) return null;
  const kind = normKind(m[3]); const part = m[2];
  if (!kind) return null;
  return { name: m[1], part, kind };
}

// dutyList(=[{name,part,kind}])에서 회원 본인 항목 찾기. 이름 정규화는 호출부(정본 스냅)에서 맞춘 뒤 넘긴다.
//  같은 사람이 두 슬롯(예: 1부 당번 + 3부 당번)에 걸릴 수 있어 배열 반환. 없으면 [].
export function findMemberDuties(dutyList, memberName) {
  const key = String(memberName || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim();
  if (!key || !Array.isArray(dutyList)) return [];
  return dutyList
    .filter((d) => String(d.name || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim() === key)
    .map((d) => dutySummary(d.kind, d.part));
}
