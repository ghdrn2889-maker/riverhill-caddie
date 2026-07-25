// 캐디 명단(부별) 자동 축적 + 판독 이름 후처리 보정.
//  목적: 배치표 OCR이 이름을 한 글자 흘려도(예: 김홍구→김흥구) '자주 확인된 이름'으로 되돌려 정확도↑.
//  원칙(안전 우선): 오탈자만 살짝 고치고, 애매하면 그대로 둔다.
//   · 3글자 이상 · 같은 길이에서 딱 1글자 차 · 확정 후보가 '유일'할 때만 보정.
//   · 이미 확정된(자주 나온) 이름은 절대 건드리지 않는다.
//   · 축적은 '보정된' 이름 기준(정상 철자에 표가 몰리게).
//  저장: data/caddies.json = { "3": { "김홍구": 12, ... } }  (부 → 이름 → 등장횟수)
import { loadJSON, saveJSON } from './store.mjs';

const FILE = 'caddies.json';
const CONFIRM_MIN = Number(process.env.CADDIE_CONFIRM_MIN ?? 3); // 이 횟수 이상이면 '확정'(스냅 대상)

function load() { return loadJSON(FILE, {}); }
function save(db) { saveJSON(FILE, db); }
function partKey(part) { return String(part || '3').replace(/[^0-9]/g, '') || '3'; }

// 같은 길이에서 정확히 1글자만 다르면 true.
function hamming1(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (++d > 1) return false; }
  return d === 1;
}

// 확정 이름(자주 등장 + 3글자 이상) — 스냅 후보군.
function confirmedNames(db, pk) {
  const m = db[pk] || {};
  return Object.keys(m).filter((n) => n.length >= 3 && m[n] >= CONFIRM_MIN);
}

// 순수 로직(테스트용): 확정명단 conf 로 이름 하나 보정.
export function snapWith(name, conf) {
  const s = String(name || '').trim();
  if (s.length < 3 || conf.includes(s)) return s;      // 짧거나 이미 확정 → 그대로
  const cands = conf.filter((c) => hamming1(s, c));
  return cands.length === 1 ? cands[0] : s;            // 유일 후보만 보정, 0개·2개↑는 그대로
}

// 이름 하나 보정(부 기준). cross 이름 등 소량 보정용.
export function snapName(name, part) {
  return snapWith(name, confirmedNames(load(), partKey(part)));
}

// 위치배열(빈칸 '' 유지) 보정 + 학습(축적). 보정된 배열 반환.
export function correctAndLearn(names, part) {
  const db = load(); const pk = partKey(part);
  if (!db[pk]) db[pk] = {};
  const conf = confirmedNames(db, pk);
  const out = (names || []).map((raw) => {
    const s = String(raw || '').trim();
    return s ? snapWith(s, conf) : '';
  });
  for (const n of out) if (n) db[pk][n] = (db[pk][n] || 0) + 1; // 보정된 철자로 카운트
  save(db);
  return out;
}

// 초기 시드: 확보된 정상 명단을 곧바로 '확정' 수준으로(멱등). 이후 실판독이 카운트를 계속 올림.
export function seedCaddies(names, part) {
  const db = load(); const pk = partKey(part);
  if (!db[pk]) db[pk] = {};
  for (const raw of names || []) {
    const n = String(raw || '').trim();
    if (n) db[pk][n] = Math.max(db[pk][n] || 0, CONFIRM_MIN);
  }
  save(db);
  return db[pk];
}
