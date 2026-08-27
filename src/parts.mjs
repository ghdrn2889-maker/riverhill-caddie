// 부(部)에 대한 가장 기본적인 사실 — 아무것도 import하지 않는다.
//
//  ★왜 따로 떼었나: partWindow는 judge.mjs에 있었는데, judge.mjs는 boardreader.mjs를 import한다.
//   그래서 판독기가 이 창을 쓰려면 순환 import가 된다. 사본을 만드는 선택지도 있었지만
//   이 저장소가 반복해서 겪은 사고가 정확히 그것이다 — 같은 지식의 두 사본이 조용히 갈라진다.
//   그래서 의존성이 없는 바닥 모듈로 내리고, judge.mjs는 여기서 받아 다시 내보낸다(기존 import 유지).
export function partWindow(part) {
  const p = String(part || '3').trim();
  if (p === '1') return { min: 5, max: 10 };   // 1부: 오전 이른 시간
  if (p === '2') return { min: 10, max: 16 };  // 2부: 낮(대략 10~15시대)
  return { min: Number(process.env.TEE_MIN_HOUR ?? 16), max: 24 }; // 3부(기본): 16시 이후
}

// 이 시각이 그 부의 시간창 안인가. 시각을 못 읽었으면(null) 판단하지 않는다 — 모르는 것과 틀린 것은 다르다.
export function inPartWindow(time, part) {
  const m = String(time || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const w = partWindow(part);
  const h = Number(m[1]);
  return !(h < w.min || h >= w.max);
}
