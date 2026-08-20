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

// ── 이름 모양인가 ─────────────────────────────────────────
//  ★사전이 이름 아닌 것을 71개나 배워놨다(실측 2026-08-21): '찾근'(22회) '조출'(13회) 같은 근무태그,
//   '서동환(정진영)' 같은 대바 셀 통째, '박선하정용호'처럼 두 이름이 붙은 것, 공백 낀 '신 철'.
//   셀을 파서에 넣기 전에 수확이 통째로 삼킨 흔적이다. 배우는 자리에서 막는다.
const DUTY_WORD = /^(찾근|조출|후출|정출|선발|당번|프리|벌당|배치|콜|정근|마감|대리|주임|마샬|휴무|휴가|병가|연차|반차|월차|격리|스페어|대기)$/;
export function isNameShape(name) {
  const s = String(name || '').trim();
  return /^[가-힣]{2,4}$/.test(s) && !DUTY_WORD.test(s) && !/테스트/.test(s);
}

// ── 확정인가 ──────────────────────────────────────────────
//  정본이면 무조건 확정. 그 밖은 자주 등장해야 확정 — 단, ★정본 코앞(1글자 차)의 이름은 확정하지 않는다.
//  오독이 확정으로 굳으면 두 번 해롭다: 그 이름은 다시 안 고쳐지고(이미 확정), 남의 후보를 하나 더
//  늘려 '유일하지 않다'며 스냅을 포기하게 만든다. 실측: '김수륭'이 '김수원'의 후보를 5개로 불렸다.
//  ★진짜 새 캐디가 여기 걸릴 수 있다 — 그래서 조용히 넘기지 않고 한 번 알린다(정본에 넣으면 풀린다).
const _nearWarned = new Set();
function nearOfficial(db, name) {
  return Object.keys(db).some((k) => db[k]?.official && hamming1(name, k));
}
function isConfirmed(db, name) {
  if (db[name]?.official) return true;
  if (name.length < 3 || (db[name]?.n || 0) < CONFIRM_MIN) return false;
  if (nearOfficial(db, name)) {
    if (!_nearWarned.has(name)) {
      _nearWarned.add(name);
      console.log(`[명단] '${name}' — 정본과 1글자 차이라 확정하지 않습니다(오독으로 봅니다). 실존 캐디면 정본 명단에 넣어주세요.`);
    }
    return false;
  }
  return true;
}

// 확정 이름(스냅 후보군).
function confirmedFrom(db) {
  return Object.keys(db).filter((n) => isConfirmed(db, n));
}

// 한 이름 등장 1회 기록(+근무태그 빈도).
function bump(db, name, duty) {
  const n = String(name || '').trim();
  if (!n) return;
  if (!isNameShape(n)) return;              // ★이름 모양이 아니면 아예 안 배운다(태그·대바셀·붙은 이름)
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

// ★애매 오독의 '정본 근접후보' — 같은길이 1글자차 정본들(없으면 편집거리≤2 정본). 이미 정본이면 [].
//  스냅이 '유일하지 않다'며 포기한 케이스를, 상위 맥락(오늘 근무자)으로 티브레이크할 때 후보군 제공.
//  ★정본(관리자 확정 83명)만 후보로 — 신규/오독을 실존 정본으로만 좁혀 안전.
export function officialNearCandidates(name) {
  const s = String(name || '').trim();
  if (s.length < 3) return [];
  const db = load();
  // ★정본이거나 '이미 확정된 실존 캐디'면 손대지 않음 — 곽호완처럼 정확히 읽힌 실명이 딴사람으로 치환되던 오탐 차단.
  if (isConfirmed(db, s)) return [];
  // ★같은길이 1글자차(시각유사 오독: 련↔현·원↔임) 정본만. 편집거리2(곽호완↔전호성)는 딴사람이라 제외.
  return Object.keys(db).filter((k) => db[k]?.official && hamming1(s, k));
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

// ★정본 명단 시드 — 관리자가 직접 타이핑한 확정 명단(오독 0)을 사전에 '강확정' 수준으로 심는다.
//  n을 STRONG_SEED(≥강확정 20)로 올려 snapWith(1글자)뿐 아니라 snapStrong(편집거리≤2)도 이 이름들을 후보로 쓰게 한다.
//  official 플래그 + 전화번호 보관(동명이인 구분·명부 대조 근거). 멱등(부팅마다 안전 재적용).
const STRONG_SEED = 30;
export function seedOfficial(entries) {
  const db = load();
  const phones = loadJSON('roster-phones.json', {});   // ★서버 전용(gitignore) {이름:번호} — 없으면 {}. 깃엔 이름만.
  let cnt = 0;
  for (const raw of entries || []) {
    const name = String(raw?.name || raw || '').trim();
    if (!name) continue;
    const phone = String(raw?.phone || phones[name] || '').replace(/\D/g, '');
    const e = db[name] || (db[name] = { n: 0, duties: {} });
    e.n = Math.max(e.n || 0, STRONG_SEED);   // 강확정 이상 → 스냅 후보 확정
    if (phone) e.phone = phone;
    e.official = true;                        // 정본(폐쇄어휘) 표식
    cnt++;
  }
  save(db);
  return cnt;
}

// 정본 명단(관리자 확정) 이름 목록 — 폐쇄어휘 판독·명부 대조용.
export function officialCaddies() {
  const db = load();
  return Object.keys(db).filter((k) => db[k]?.official);
}

// 현재 사전 규모(전체·확정·정본) — 디버그/브리핑용.
export function caddieStats() {
  const db = load();
  return { total: Object.keys(db).length, confirmed: confirmedFrom(db).length, official: officialCaddies().length };
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
