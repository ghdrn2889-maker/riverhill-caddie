// ══ 캐디가 내는 신청(휴무·휴가·병가·54·1,3·2,3) ══════════════════════
//  ★장부는 여기 없다. 경기과 배치표 프로그램이 쥐고 있다.
//   앱이 장부를 따로 두면 둘이 각자 적게 되고, 언젠가 서로 다른 말을 한다 —
//   캐디 폰엔 '됐습니다'가 뜨는데 경기과 화면엔 아직 기다리는 중으로 남는 식이다.
//   그래서 앱이 하는 일은 하나뿐이다: 캐디 대신 옆문을 두드린다.
//
//  ★이름은 로그인에서 꺼내 붙인다. 폰이 보낸 이름은 쓰지 않는다 —
//   폰이 제 이름을 말하게 두면 아무 이름이나 적어 남의 휴무를 낼 수 있다.
//
//  열쇠(BOARD_REQ_KEY)가 비어 있으면 이 기능은 통째로 잠긴 것처럼 군다.
//  경기과 프로그램이 아직 안 떠 있는 자리(연습·개발)에서 앱이 혼자 멀쩡히 돌게 하려는 것이다.

const reqUrl = () => process.env.BOARD_REQ_URL || 'http://127.0.0.1:3300/api/app/req';
const reqKey = () => process.env.BOARD_REQ_KEY || '';

// 이 앱에서 신청을 받을 수 있는 상태인가 — 화면이 단추를 띄울지 말지 이걸로 정한다
export function reqReady() { return !!reqKey(); }

async function knock(method, name, { body, query } = {}) {
  const key = reqKey();
  if (!key) return { ok: false, error: '아직 경기과 프로그램과 이어지지 않았습니다' };
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, error: '배치표 이름이 없습니다 — 프로필을 먼저 채워 주세요' };

  const qs = new URLSearchParams({ name: nm, ...(query || {}) });
  let r;
  try {
    r = await fetch(`${reqUrl()}?${qs}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-board-req-key': key },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    // ★까닭을 그대로 폰에 흘리지 않는다. 캐디가 고칠 수 있는 일이 아니다.
    console.error('[신청] 경기과 프로그램에 못 닿음:', e.message);
    return { ok: false, error: '경기과 프로그램에 닿지 않습니다 — 잠시 뒤 다시 해 주세요' };
  }
  let o = {};
  try { o = await r.json(); } catch (e) { o = {}; }
  if (!r.ok || o.ok === false) return { ok: false, error: o.error || '신청이 받아들여지지 않았습니다' };
  return o;
}

// 내 신청 목록 + 이 달 재료(경기과가 정할 때 보는 것과 같은 숫자)
export const listMine = (name, month) => knock('GET', name, { query: month ? { month } : {} });

// 새 신청 — 날짜는 숫자 여덟 자리, 종류는 경기과 장부가 아는 말 그대로.
// ★여러 날을 한 번에 낸다. 담아 두고 한꺼번에 내는 화면이라 그렇다.
//  날마다 종류가 달라도 된다 — 24일 휴무, 26일 조출, 27일 54 처럼.
//  장부에는 날마다 한 건씩 따로 들어간다(경기과가 날마다 따로 정해야 하니까).
//  까닭은 한 번만 적고 모든 건에 같이 붙는다.
export const addMine = (name, { items, date, kind, why }) => knock('POST', name, {
  body: Array.isArray(items) ? { items, why } : { date, kind, why },
});

// 무르기 — 제 것만, 아직 안 정해진 것만(막는 일은 장부 쪽에서 한다)
export const cancelMine = (name, id) => knock('POST', name, { body: { act: 'cancel', id } });
