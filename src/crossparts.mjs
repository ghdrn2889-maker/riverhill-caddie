// 크로스파트 대바('X(Y)' 괄호 교환)를 부 간에 일관되게 다루는 공용 로직.
//  표시(모니터 검수·판독검증)와 회원 상태 정합(server 파이프라인)이 '같은 스왑 판정'을 쓰도록 단일화한다.
//  예) 2부 "박선하(연승준)" → 연승준이 대바로 2부 근무(괄호 안=실제 점유자), 박선하는 연승준의 3부 자리로.
import { loadBoardPartsStore } from './boardparts.mjs';
import { loadJSON } from './store.mjs';
import { effectivePart3Verdict } from './analytics.mjs';

// 셀에서 괄호·공백 제거한 '맨이름'("박선하(연승준)"→"박선하")
export const swapBare = (cell) => String(cell || '').replace(/\s*\([^)]*\)\s*/g, '').replace(/\s/g, '').trim();
// 괄호 안이 근무태그(대바 아님)인 경우 제외
export const SWAP_TAGWORDS = new Set(['조출', '찾근', '조퇴', '반차', '오전', '오후', '대기', '스페어']);

// 현재 각 부의 명단(canonical store) — 1·2부=board-parts-store, 3부=lastboard(effectivePart3Verdict 최신본).
export function collectPartRosters() {
  const out = {};
  try { const bp = loadBoardPartsStore(); if (bp && bp.parts) for (const p of ['1', '2']) { const d = bp.parts[p]; if (d && Array.isArray(d.roster)) out[p] = d.roster.slice(); } } catch { /* noop */ }
  try { const lb = loadJSON('lastboard.json', null); const v = lb && lb.rawVerdict ? effectivePart3Verdict(lb) : null; if (v && Array.isArray(v.part3Roster)) out['3'] = v.part3Roster.slice(); } catch { /* noop */ }
  return out;
}

// 로스터들에서 크로스파트 스왑 목록 — 'X(Y)'이고 Y가 실존 캐디(다른 셀에 맨이름 존재)면 {owner:X, sub:Y, part}.
export function buildCrossPartSwaps(rosters) {
  const known = new Set();
  for (const p of Object.keys(rosters)) for (const c of rosters[p]) { const n = swapBare(c); if (/^[가-힣]{2,4}$/.test(n)) known.add(n); }
  const swaps = [];
  for (const p of Object.keys(rosters)) rosters[p].forEach((c) => {
    const m = String(c || '').match(/^([가-힣]{2,4})\s*\(([가-힣]{2,4})\)/);
    if (m && m[1] !== m[2] && known.has(m[2]) && !SWAP_TAGWORDS.has(m[2])) swaps.push({ owner: m[1], sub: m[2], part: p });
  });
  return swaps;
}

// 한 이름이 '다른 부'의 대바 대상(sub)이면 '(sub)owner'로 치환할 새 이름(아니면 null). 부내 상호맞바꿈(A(B)&B(A))은 제외.
export function crossSwapFor(name, part, swaps) {
  if (!name || /\(/.test(String(name))) return null;            // 빈칸·이미 태그면 skip
  const bn = swapBare(name);
  const sw = swaps.find((s) => s.sub === bn && s.part !== String(part)
    && !swaps.some((o) => o.part === s.part && o.owner === s.sub && o.sub === s.owner));
  return sw ? `(${bn})${sw.owner}` : null;
}
