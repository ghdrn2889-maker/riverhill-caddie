// 리버힐 캐디 '전역 이름 사전' 자동 축적 + 판독 이름 후처리 보정.
//  목적: 배치표 OCR이 이름을 한 글자 흘려도(예: 김홍구→김흥구) '자주 확인된 이름'으로 되돌려 정확도↑.
//  이름은 부(部)와 무관하게 같은 사람이므로 사전은 '전역 하나'로 둔다(부 태그는 참고용 메타).
//
//  두 가지 서로 다른 동작(중요):
//   · 수확(learnCrews): 조 배치표에서 전원 이름을 '원본 그대로' 축적한다 — 새 캐디를 발견해야 하므로 보정하지 않음.
//   · 표시보정(correctAndLearn/snapName): 순번 이름을 '확정 사전'으로 스냅해 오탈자만 살짝 고친다.
//  안전원칙: 3글자↑ · 같은 길이 1글자차 · 확정 후보가 '유일'할 때만 보정. 이미 확정된 이름은 안 건드림.
//  저장: data/caddies.json = { "김홍구": { "n": 12, "duties": { "3부": 10, "휴무": 2 } }, ... }
import { loadJSON, saveJSON } from './store.mjs';

const FILE = 'caddies.json';
const CONFIRM_MIN = Number(process.env.CADDIE_CONFIRM_MIN ?? 3); // 이 횟수 이상이면 '확정'(스냅 대상)

function load() { return loadJSON(FILE, {}); }
function save(db) { saveJSON(FILE, db); }

// 같은 길이에서 정확히 1글자만 다르면 true.
function hamming1(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (++d > 1) return false; }
  return d === 1;
}

// 확정 이름(자주 등장 + 3글자 이상) — 스냅 후보군.
function confirmedFrom(db) {
  return Object.keys(db).filter((n) => n.length >= 3 && (db[n]?.n || 0) >= CONFIRM_MIN);
}

// 한 이름 등장 1회 기록(+근무태그 빈도).
function bump(db, name, duty) {
  const n = String(name || '').trim();
  if (!n) return;
  const e = db[n] || (db[n] = { n: 0, duties: {} });
  e.n = (e.n || 0) + 1;
  const d = String(duty || '').trim();
  if (d) e.duties[d] = (e.duties[d] || 0) + 1;
}

// 순수 로직(테스트용): 확정명단 conf 로 이름 하나 보정.
export function snapWith(name, conf) {
  const s = String(name || '').trim();
  if (s.length < 3 || conf.includes(s)) return s;      // 짧거나 이미 확정 → 그대로
  const cands = conf.filter((c) => hamming1(s, c));
  return cands.length === 1 ? cands[0] : s;            // 유일 후보만 보정, 0개·2개↑는 그대로
}

// 이름 하나 보정(전역). cross 이름 등 소량 보정용.
export function snapName(name) {
  return snapWith(name, confirmedFrom(load()));
}

// 명부(확정 캐디 사전) 대조 — 오탈자 1글자 보정 후 확정 명단에 있으면 true.
//  가입 자동승인 게이트에서 사용(저장된 caddies.json 조회일 뿐, 배치표 재판독 아님).
export function isKnownCaddie(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  const conf = confirmedFrom(load());
  return conf.includes(snapWith(s, conf));
}

// 확정 캐디 명단(전역) — 로컬 VLM '폐쇄어휘' 판독에 후보군으로 주입(오독→존재하는 이름으로).
export function confirmedCaddies() {
  return confirmedFrom(load());
}

// 편집거리(같은 길이 치환수 근사) — 길이 다르면 큰 값.
function editDist(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 9;
  // Levenshtein(작은 문자열이라 단순 DP)
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[m][n];
}

// ★강확정(자주 등장, 기본 n≥20) 이름 목록 — 2글자 오독까지 교정할 때의 '안전한' 후보군.
export function strongCaddies(minN = 20) {
  const db = load();
  return Object.keys(db).filter((k) => k.length >= 3 && (db[k]?.n || 0) >= minN);
}

// 폐쇄어휘 2차 교정: 확정 명단에 없는 이름을, '강확정' 후보 중 편집거리≤2로 '유일'하게 가까운 것에 스냅.
//  성신영→정진영(2글자차, n=128)처럼 hamming1이 못 잡는 오독을 교정. 유일하지 않으면 그대로(안전).
export function snapStrong(name) {
  const s = String(name || '').trim();
  if (s.length < 3) return s;
  const conf = confirmedFrom(load());
  if (conf.includes(s)) return s;                       // 이미 확정 → 손대지 않음
  const strong = strongCaddies();
  const near = strong.filter((c) => editDist(s, c) <= 2);
  return near.length === 1 ? near[0] : s;               // 유일 후보만 교정
}

// 순번 위치배열(빈칸 '' 유지) 보정 + 학습. 보정된 배열 반환.
export function correctAndLearn(names) {
  const db = load();
  const conf = confirmedFrom(db);
  const out = (names || []).map((raw) => {
    const s = String(raw || '').trim();
    return s ? snapWith(s, conf) : '';
  });
  for (const n of out) if (n) bump(db, n, '');           // 보정된 철자로 카운트
  save(db);
  return out;
}

// 조 배치표 전원 학습 — ★보정 없이 원본 그대로 축적(새 캐디 발견용). 처리한 인원 수 반환.
export function learnCrews(crews) {
  const db = load();
  let count = 0;
  for (const c of (crews || [])) {
    const name = String(c?.name || '').trim();
    if (!name) continue;
    bump(db, name, c?.duty);
    count++;
  }
  save(db);
  return count;
}

// 초기 시드: 확보된 정상 명단을 곧바로 '확정' 수준으로(멱등). 이후 실판독이 카운트를 계속 올림.
export function seedCaddies(names) {
  const db = load();
  for (const raw of names || []) {
    const n = String(raw || '').trim();
    if (!n) continue;
    const e = db[n] || (db[n] = { n: 0, duties: {} });
    e.n = Math.max(e.n || 0, CONFIRM_MIN);
  }
  save(db);
  return Object.keys(db).length;
}

// 현재 사전 규모(전체·확정) — 디버그/브리핑용.
export function caddieStats() {
  const db = load();
  return { total: Object.keys(db).length, confirmed: confirmedFrom(db).length };
}

// ── 조 배치표 중복 수확 방지 ──────────────────────────────
//  조 명부는 날마다 거의 같으므로(순번·티오프만 변동, 조 상태는 유지), 같은 배치표 이미지를 재판독(조용한 수정
//  감시 등)할 때 조 판독을 또 돌릴 필요가 없다. 이미 수확한 이미지 키는 건너뛴다(Gemini 사용량 절약).
const HARVEST_FILE = 'roster-harvest.json'; // 최근 수확한 배치표 이미지 키 목록
export function alreadyHarvested(key) {
  if (!key) return false;
  return loadJSON(HARVEST_FILE, []).includes(key);
}
export function markHarvested(key) {
  if (!key) return;
  const a = loadJSON(HARVEST_FILE, []);
  if (!a.includes(key)) { a.push(key); while (a.length > 300) a.shift(); saveJSON(HARVEST_FILE, a); }
}
