// 대조판 편집기 — 인턴 지정 / 이름 고치기 / 맞바꾸기(대바) / 순번 옮기기(티오프 재배정).
//
//  ★두 축을 반드시 분리한다. 배치표에는 서로 다른 두 개의 대응이 있다.
//     ① 순번 ↔ 이름   — 명단. 대바가 아니면 안 바뀐다(사용자 확정).
//     ② 순번 ↔ 티오프 — 티오프표. 당추·인턴·지각 등으로 자주 바뀐다.
//
//   맞바꾸기(대바)  = ①을 건드린다. 두 사람이 자리를 교환한다. 티오프는 그대로.
//   순번 옮기기     = ②를 건드린다. 그 사람의 순번은 그대로고 티오프만 옮겨간다.
//                    사이 순번들의 티오프가 한 칸씩 따라 이동한다.
//
//   처음엔 순번 옮기기를 '명단 배열 splice'로 만들었는데 그건 순번을 다시 매기는 것이라 틀렸다.
//   우겸조를 뒤로 보내면 우겸조가 7번이 되는 게 아니라, 우겸조는 2번인 채로 17:00 IN에 선다.
(() => {
  const DATE = window.__DAEJO_DATE || '';
  const BOARD = window.__DAEJO_BOARD || {};
  // 테스트판이 덮고 있는 부. ★살아 있는 값이어야 한다 —
  //  처음 켤 때 서버가 알려준 값에서 얼어붙으면, 저장한 직후 changed()는 false가 되고
  //  이 목록은 여전히 비어 있어서 '앱에 반영' 버튼이 스스로 사라진다(저장은 됐는데 반영을 못 함).
  //  그래서 저장하면 넣고, 반영·초기화하면 뺀다.
  const SB_EDITED = (window.__DAEJO_SANDBOX || []).slice();
  const markEdited = (p) => { if (!SB_EDITED.includes(p)) SB_EDITED.push(p); };
  const unmarkEdited = (p) => { const i = SB_EDITED.indexOf(p); if (i >= 0) SB_EDITED.splice(i, 1); };
  const live = location.protocol.startsWith('http');
  // 모니터는 ?k=토큰 게이트다 — 저장 요청에도 그대로 붙여야 401이 안 난다(모니터 index.html과 같은 방식).
  const apiUrl = (p) => { const k = new URLSearchParams(location.search).get('k') || ''; return p + (k ? '?k=' + encodeURIComponent(k) : ''); };
  const hint = document.getElementById('hint');
  const state = document.getElementById('state');
  const saveBtn = document.getElementById('saveBtn');
  const undoBtn = document.getElementById('undoBtn');
  const resetBtn = document.getElementById('resetBtn');
  const applyBtn = document.getElementById('applyBtn');
  const notifyBtn = document.getElementById('notifyBtn');
  const HINTS = {
    team: '빈 칸을 눌러 팀을 추가하고, 팀이 있는 칸을 눌러 없앱니다. 추가하면 그 뒤가 한 칸씩 뒤로 밀리고 스페어 맨 앞이 근무로 올라옵니다.',
    intern: '칸을 눌러 인턴을 켜고 끕니다. 인턴이 한 팀을 맡으면 그 뒤가 각자 다음 팀으로 밀리고, 맨 뒤 한 명은 스페어로 내려갑니다.',
    name: '칸을 눌러 그 순번의 이름을 고칩니다.',
    crew: '스페어 줄의 ‘＋ 캐디 추가’로 명단에 사람을 넣고, 사람을 눌러 뺍니다. 순번은 다시 매겨지고 티오프 짝은 그대로 유지됩니다.',
    swap: '두 칸을 차례로 눌러 두 사람을 맞바꿉니다(대바). 순번↔이름만 바뀌고 티오프는 그대로입니다.',
    move: '옮길 사람을 누르고, 갈 티오프를 누르세요. 순번은 그대로고 티오프만 옮겨가며, 사이 순번들이 한 칸씩 따라 이동합니다.',
  };
  const PARTS = ['1', '2', '3'];
  const pad = (n) => String(n).padStart(2, '0');
  const toMin = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : NaN; };
  const toHM = (n) => pad(Math.floor(n / 60)) + ':' + pad(n % 60);
  // ★키는 분으로 환산해 재조립 — 1부 판독은 "6:23", 카카오는 "06:23"을 쓴다.
  const K = (t, c) => toHM(toMin(t)) + '|' + (/IN/i.test(c) ? 'IN' : 'OUT');
  const bare = (x) => String(x || '').replace(/\([^)]*\)/g, '').trim();
  const tagOf = (x) => { const m = String(x || '').match(/\(([^)]*)\)/); return m ? m[1].trim() : ''; };

  // 두 축을 따로 들고 다닌다.
  const roster = {}, rosterOrig = {};      // 순번 → 이름(태그 포함)
  const teeOrig = {};                      // 순번 → {time, course}  (없으면 null = 스페어)
  for (const p of PARTS) {
    const B = BOARD[p] || {};
    roster[p] = (B.roster || []).slice();
    rosterOrig[p] = roster[p].slice();
    const t = [];
    (B.teeGrid || []).forEach((g) => { t[Number(g.pos) - 1] = { time: g.time, course: /IN/i.test(g.course) ? 'IN' : 'OUT' }; });
    teeOrig[p] = t.map((x) => (x ? { time: x.time, course: x.course } : x));
  }
  // 인턴이 차지한 티오프(부별). 이 칸은 순번을 안 먹는다.
  const interns = {}, internsOrig = {};
  for (const p of PARTS) {
    const s = new Set(((BOARD[p] || {}).internTees || []).map((t) => K(t.time, t.course)));
    interns[p] = s; internsOrig[p] = new Set(s);
  }
  const stack = [];
  const cp = (x) => (x ? { time: x.time, course: x.course } : x);
  const sameTee = (a, b) => (!a && !b) || (!!a && !!b && K(a.time, a.course) === K(b.time, b.course));

  // ── ★인턴 = 팀 하나를 인턴이 맡는 것 ─────────────────────────────────────
  //  팀 수는 고정이다. 예약이 있는 티오프에만 팀이 있고, 빈 티오프에는 팀이 없다.
  //  그래서 인턴이 한 팀을 맡으면 정규 캐디가 설 자리가 정확히 하나 준다 —
  //  그 뒤 사람들은 각자 '다음 팀'으로 밀리고, 맨 뒤 한 명이 스페어로 내려간다.
  //  (한때 빈 티오프를 새로 열어 밀어넣게 했는데, 그건 없는 팀을 지어내는 짓이었다.)
  //
  //  ★그리고 켜기/끄기를 각각 구현하지 않는다. 따로 짜면 둘이 서로의 정확한 역연산이
  //   아니게 되어 상태가 어긋난다(실측: 끄면 원래대로 안 돌아옴).
  //   인턴 집합만 토글하고 배치는 매번 처음부터 다시 계산한다 — 구조적으로 대칭이다.
  //
  // ★두 보기 모두에서 편집한다(사용자 확정).
  //   실제 배치표 = 사진이 읽은 칸. 카카오 예상 = 거기에 카카오가 '찼다'고 본 칸까지 더한 것.
  //  명단(순번↔이름)과 인턴 집합은 두 보기가 '같은 것'을 가리키므로 공유하고,
  //  티오프 배치만 보기별로 다르다(예상은 팀이 더 많다).
  const VIEWS = ['real', 'proj'];
  const allSlots = {}, origOcc = { real: {}, proj: {} };
  const teeOrigV = { real: {}, proj: {} };   // 보기별 기준 배치 — 변경 판정의 기준
  const sortOcc = (a) => a.sort((x, y) => toMin(x.time) - toMin(y.time) || (x.course === 'OUT' ? -1 : 1));

  // ★기준선을 세우는 곳은 여기 하나뿐이다.
  //  처음 그릴 때와 저장한 뒤가 각각 따로 기준선을 만들면 둘이 어긋나고, 그러면
  //  저장이 됐는데도 '아직 안 됐다'고 남는다(실측: 예상 보기에서 저장하면 저장 버튼이 안 사라짐).
  //  teams = 실제 배치표에 팀이 있는 칸 전부(정규가 서는 칸 + 사진이 읽은 인턴 칸).
  //
  //  ★인턴 집합으로 팀 목록을 만들지 않는다. 수동 인턴은 카카오 예상 칸에 찍힐 수 있는데
  //   (17:07처럼 본배치표엔 팀이 없는 시각), 그걸 팀으로 세면 없는 팀이 유령으로 생겨
  //   실제 보기의 밀림이 통째로 어긋난다 — 화면에선 '밀림'이 아니라 '교체'로 보인다.
  //   팀 목록은 배치표가 정하고, 인턴은 그중 어느 팀을 인턴이 맡는지를 고를 뿐이다.
  //
  //  ★배치(누가 어느 티오프에 서는가)는 팀 목록에서 매번 다시 만들지 않는다.
  //   전에는 여기서 팀을 시각 순으로 정렬해 배치를 처음부터 새로 짰는데, 그러면
  //   '순번 옮기기'로 손수 옮긴 결과가 저장하는 순간 통째로 지워졌다(실측: 2번을 16:53 IN으로
  //   옮겨도 저장 후 16:39 OUT로 복귀). 순번 옮기기는 순번↔시각이 시각 순서와 어긋나게
  //   만드는 조작이므로, 시각 순 재생성과는 애초에 같이 설 수 없다. 배치가 진실이다.
  //   assign을 주면 그 배치를 그대로 쓰고, 안 주면 시각 순 기본 배치를 깐다.
  function setBaseline(p, teams, assign) {
    origOcc.real[p] = sortOcc((teams || []).filter(Boolean).map((t) => ({ time: t.time, course: t.course })));
    // 예상 — 카카오가 찼다고 본 칸까지 합집합.
    const seen = new Set(origOcc.real[p].map((s) => K(s.time, s.course)));
    const occP = origOcc.real[p].map((s) => ({ time: s.time, course: s.course }));
    ((BOARD[p] || {}).kakaoSlots || []).forEach((s) => {
      const k = K(s.time, s.course);
      if (!seen.has(k)) { seen.add(k); occP.push({ time: toHM(toMin(s.time)), course: /IN/i.test(s.course) ? 'IN' : 'OUT' }); }
    });
    origOcc.proj[p] = sortOcc(occP);
    rosterOrig[p] = roster[p].slice();
    internsOrig[p] = new Set(interns[p]);
    // ★실제 축의 기본 배치는 다시 계산하지 않는다 — 배치표가 이미 'pos → 티오프' 짝을 들고 있다.
    //  전에는 팀이 있는 칸을 시각순으로 줄 세워 순번과 짝지었다(defaultAssign). 그러면 배치표가
    //  말하는 짝이 통째로 버려지고, 칸 하나만 어긋나도 그 뒤가 전부 밀린다 — 8·9가 뒤바뀌고
    //  11·12가 화면에서 사라졌다(8/18 실사고). 서버 파일은 멀쩡한데 화면만 뒤죽박죽이던 이유다.
    //  배치표에 순번표가 있으면 그걸 그대로 그린다. 없을 때만 예전처럼 시각순으로 깐다.
    const seatFromBoard = (() => {
      const t = [];
      ((BOARD[p] || {}).teeGrid || []).forEach((g) => {
        const i = Number(g.pos) - 1;
        if (i >= 0) t[i] = { time: g.time, course: /IN/i.test(g.course) ? 'IN' : 'OUT' };
      });
      return t.filter(Boolean);
    })();
    VIEWS.forEach((v) => {
      // ★실제 축은 지킨다 — 지각·인턴처럼 사진에 없는 사실을 사람이 손으로 넣은 결과다.
      //  ★예상 축은 지키지 않는다 — 매번 지금의 실제 배치표 ∪ 지금의 카카오로 새로 깐다.
      //   예상은 저작물이 아니라 계산 결과다. 한 번 옮겨둔 걸 붙잡으면 그 뒤의 변동을 못 따라간다
      //   (실사고: 2부 예상이 10시 2분에 얼어붙어, 카카오가 잡은 12:46·13:42·13:49를 손으로 넣어야 했다).
      teeV[v][p] = (v === 'real')
        ? ((assign && assign.real) ? reseat('real', p, assign.real)
          : (seatFromBoard.length ? seatFromBoard.map(cp) : defaultAssign(v, p)))
        : defaultAssign(v, p);
    });
    idxMemo.real[p] = new Map(); idxMemo.proj[p] = new Map();
    // 기준선은 두 보기 모두 잡는다 — 어느 쪽에서 고쳐도 '바뀌었다'를 알아채야 한다.
    VIEWS.forEach((v) => { teeOrigV[v][p] = (teeV[v][p] || []).map(cp); });
    teeOrig[p] = teeOrigV.real[p];
  }

  for (const p of PARTS) {
    allSlots[p] = [...document.querySelectorAll('td.c[data-p="' + p + '"]')]
      .map((td) => ({ time: toHM(toMin(td.dataset.t)), course: /IN/i.test(td.dataset.c) ? 'IN' : 'OUT' }))
      .sort((a, b) => toMin(a.time) - toMin(b.time) || (a.course === 'OUT' ? -1 : 1));
  }
  const teeV = { real: {}, proj: {} };
  // ★tee는 '지금 보고 있는 보기의 배치' 그 자체다 — 따로 들고 있으면 안 된다.
  //  전에는 tee[p]가 teeV[view][p]를 가리키는 별칭이었는데, 되돌리기가 tee[p]에 새 배열을
  //  통째로 대입하는 순간 별칭이 끊겼다. 그 뒤로 화면은 tee를, 저장은 teeV.real을 봐서
  //  '화면엔 15팀인데 저장은 14팀'이 됐다 — 드래그는 되는데 저장이 안 되는 것처럼 보인 이유다.
  //  대입이 곧 teeV에 쓰이도록 만들어 갈라질 여지 자체를 없앤다.
  const tee = new Proxy({}, {
    get: (_, p) => teeV[view][p],
    set: (_, p, v) => { teeV[view][p] = v; return true; },
    has: (_, p) => p in teeV[view],
    ownKeys: () => Reflect.ownKeys(teeV[view]),
    getOwnPropertyDescriptor: (_, p) => ({ configurable: true, enumerable: true, value: teeV[view][p] }),
  });
  // 시각 순 기본 배치 — 팀이 있는 칸에서 인턴 칸을 뺀 것. 판독 직후의 배치표가 늘 이 모양이다.
  const defaultAssign = (v, p) => origOcc[v][p].filter((s) => !interns[p].has(K(s.time, s.course))).map(cp);
  // ★실제 축 전용 — 저장해둔 배치를 다시 깔되, 그 사이에 배치표가 얻거나 잃은 칸을 반영한다.
  //  (예상 축은 저장하지 않는다. 아래 setBaseline 주석 참고.)
  const reseat = (v, p, saved) => {
    const occ = origOcc[v][p].filter((s) => !interns[p].has(K(s.time, s.course)));
    const want = new Set(occ.map((s) => K(s.time, s.course)));
    const T = saved.map(cp).filter((s) => s && want.has(K(s.time, s.course)));   // 없어진 칸(캔슬)은 뺀다
    const have = new Set(T.map((s) => K(s.time, s.course)));
    for (const s of occ) {                                                       // 새로 찬 칸은 시각 자리에 끼운다
      const k = K(s.time, s.course);
      if (have.has(k)) continue;
      T.splice(sortedIdx(T, k), 0, cp(s));
      have.add(k);
    }
    return T;
  };
  // 인턴을 켤 때 '몇 번째 자리가 빠졌는지'를 기억해둔다 — 끄면 정확히 그 자리에 되돌린다.
  //  기억이 없으면(불러온 데이터의 인턴) 시각 순서에 맞는 자리에 끼운다.
  const idxMemo = { real: {}, proj: {} };
  const slotAt = (T, key) => T.findIndex((t) => t && K(t.time, t.course) === key);
  const sortedIdx = (T, key) => {
    const m = toMin(key.split('|')[0]), c = key.split('|')[1];
    const i = T.findIndex((t) => toMin(t.time) > m || (toMin(t.time) === m && c === 'OUT' && t.course === 'IN'));
    return i < 0 ? T.length : i;
  };
  // ★인턴 = 팀 하나를 인턴이 맡는 것. 팀 수는 고정이므로 정규 자리가 정확히 하나 줄고,
  //  뒤 사람들은 각자 '다음 팀'으로 밀리다가 맨 뒤 한 명이 스페어로 내려간다.
  //  ★배치를 통째로 다시 만들지 않고 그 한 자리만 빼고 넣는다 — 그래야 손수 옮긴 배치가 안 지워진다.
  function setIntern(part, key, on) {
    if (on) interns[part].add(key); else interns[part].delete(key);
    for (const v of VIEWS) {
      if (!origOcc[v][part].some((s) => K(s.time, s.course) === key)) continue;   // 이 보기엔 그 팀이 없다
      const T = teeV[v][part];
      const at = slotAt(T, key);
      if (on) {
        if (at >= 0) { (idxMemo[v][part] ||= new Map()).set(key, at); T.splice(at, 1); }
      } else if (at < 0) {
        const memo = idxMemo[v][part]?.get(key);
        const i = memo != null ? Math.min(memo, T.length) : sortedIdx(T, key);
        T.splice(i, 0, { time: key.split('|')[0], course: key.split('|')[1] });
        idxMemo[v][part]?.delete(key);
      }
    }
  }
  // ★티오프(팀) 추가·삭제 — 실시간 추적이 놓친 예약을 관리자가 손으로 살릴 수 있어야 한다.
  //  카카오가 못 잡은 당추, 전화·회원 예약처럼 애초에 카카오에 안 뜨는 팀이 실제로 있다.
  //  추가하면 그 시각 자리에 팀이 하나 생기고, 그 뒤 순번이 각자 한 칸씩 뒤로 밀리며
  //  스페어 맨 앞이 근무로 올라온다(당추가 실제로 일으키는 일과 같다).
  //  삭제는 그 역 — 뒤가 한 칸씩 당겨지고 맨 뒤 한 명이 스페어로 내려간다.
  function setTeam(part, key, on) {
    const v = view;
    const has = origOcc[v][part].some((s) => K(s.time, s.course) === key);
    if (on === has) return null;
    const slot = { time: key.split('|')[0], course: key.split('|')[1] };
    if (on) {
      origOcc[v][part] = sortOcc(origOcc[v][part].concat([slot]).map(cp));
      if (!interns[part].has(key)) {
        const T = teeV[v][part];
        // ★이미 그 칸이 배치에 있으면 넣지 않는다.
        //  검사는 origOcc(199행), 삽입은 teeV라 두 배열이 갈라질 수 있다 — setIntern이 teeV에서만
        //  칸을 빼내기 때문이다(184행). 갈라진 뒤 같은 시각을 추가하면 검사를 통과해 사본이 하나 더
        //  들어갔고, 그러면 두 순번이 같은 티오프를 갖는다. 표는 한 시각에 한 명만 그리므로
        //  뒤 사람이 화면에서 사라진다(8/18 실사고: 17:35에 둘, 17:56에 셋, 18:03에 셋).
        if (slotAt(T, key) < 0) T.splice(sortedIdx(T, key), 0, slot);
      }
    } else {
      origOcc[v][part] = origOcc[v][part].filter((s) => K(s.time, s.course) !== key);
      const T = teeV[v][part];
      const at = slotAt(T, key);
      if (at >= 0) T.splice(at, 1);
      interns[part].delete(key);
      idxMemo[v][part]?.delete(key);
    }
    return { on, work: teeV[v][part].length };
  }

  function internOn(part, time, course) {
    const key = K(time, course);
    const before = tee[part].length;
    const wasPos = slotAt(tee[part], key) + 1;
    setIntern(part, key, true);
    const dropped = before - tee[part].length;
    const who = dropped > 0 ? bare(roster[part][before - 1] || '') : '';
    return { fromPos: wasPos, dropped: dropped, who: who };
  }
  function internOff(part, time, course) {
    const key = K(time, course);
    setIntern(part, key, false);
    return { toPos: slotAt(tee[part], key) + 1 };
  }
  const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  // ★두 보기 모두를 본다. 전에는 실제 배치표 축만 봐서, 기본 화면(카카오 예상)에서 옮긴 것은
  //  저장 버튼조차 안 나왔다 — 화면에선 옮겨졌는데 저장할 방법이 없었다(실브라우저 확인).
  //  두 보기 모두 편집할 수 있게 한 이상, 변경 판정도 두 보기를 다 봐야 한다.
  const teeMoved = (v, p) => (teeV[v][p] || []).some((x, i) => !sameTee(x, (teeOrigV[v][p] || [])[i]))
    || (teeV[v][p] || []).length !== (teeOrigV[v][p] || []).length;
  // 예상 보기에서 옮긴 건 저장되지 않는다 — 조용히 사라지면 속은 기분이 든다. 그 자리에서 말한다.
  const projNote = () => (view === 'proj' ? ' · 예상 보기라 저장되지 않습니다(카카오를 따라 다시 계산됩니다)' : '');
  //  ★단, 예상 축의 배치는 저장 대상이 아니다(계산 결과다). 예상에서 옮긴 것만으로는
  //   '저장할 게 있다'가 되지 않는다 — 저장해봐야 다음에 켤 때 다시 계산되어 사라진다.
  const changed = (p) => roster[p].some((x, i) => (x || '') !== (rosterOrig[p][i] || ''))
    || !setEq(interns[p], internsOrig[p])
    || teeMoved('real', p);

  const shot = new Map();
  document.querySelectorAll('td.c').forEach((td) => { shot.set(td, { html: td.innerHTML, cls: td.className }); });
  function restoreView() {
    shot.forEach((v, td) => { td.innerHTML = v.html; td.className = v.cls; });
  }
  const anyChanged = () => PARTS.some(changed);

  // ── 칸의 출처 ── 이 화면은 두 경로를 대조하는 곳이다. 어느 쪽이 말한 칸인지 늘 보여야 한다.
  //  실제 = 사진이 읽은 팀(인턴 칸 포함) · 카카오 = 예약 API가 '찼다'고 본 칸.
  //  origOcc.real은 저장할 때마다 갱신되므로(setBaseline) 매번 여기서 다시 만든다.
  const realSet = (p) => new Set((origOcc.real[p] || []).map((s) => K(s.time, s.course)));
  const kakaoSet = (p) => new Set(((BOARD[p] || {}).kakaoSlots || []).map((s) => K(s.time, s.course)));
  // 근무태그 — (54)·(찾근)은 커트 밖에서도 근무, (1,3)·(2,3)은 부 중복(앞 순번 차지). kakaobridge와 같은 규칙.
  const GUARANTEED_RE = /(^|[^0-9])(54|찾근)([^0-9]|$)/;
  const CROSS_RE = /(^|[^0-9])(54|1[,、]\s*3|2[,、]\s*3)([^0-9]|$)/;

  function paint(part) {
    // 티오프 칸 → 순번 지도를 매번 새로 만든다(옮기기로 대응이 바뀌므로).
    const at = new Map();
    tee[part].forEach((t, i) => { if (t) at.set(K(t.time, t.course), i + 1); });
    document.querySelectorAll('td.c[data-p="' + part + '"]').forEach((td) => {
      const key = K(td.dataset.t, td.dataset.c);
      if (interns[part].has(key)) {                             // 인턴 칸 — 순번을 안 먹는다
        td.innerHTML = '';
        td.className = 'c intern' + (internsOrig[part].has(key) ? '' : ' edited');
        return;
      }
      const pos = at.get(key) || 0;
      let pe = td.querySelector('.pos'), nm = td.querySelector('.nm'), dt = td.querySelector('.dt');
      if (!pos) {                                               // 이 칸엔 아무도 없다(빈 티오프)
        if (pe) pe.textContent = ''; if (nm) nm.textContent = ''; if (dt) dt.style.display = 'none';
        td.className = 'c empty';
        return;
      }
      // ★칸의 출처를 색으로 남긴다 — 이게 이 화면의 존재 이유다.
      //  한때 여기서 className을 'c ok'로 밀어버려 생성기가 칠해둔 구분이 통째로 지워졌다.
      //  그러면 사진이 읽은 칸과 카카오가 찼다고 본 칸이 똑같은 초록으로 보인다.
      const inReal = realSet(part).has(key);
      const inKakao = kakaoSet(part).has(key);
      const cell = roster[part][pos - 1] || '';
      const tg0 = tagOf(cell);
      td.className = 'c ' + (inReal ? (inKakao ? 'ok' : 'board-only') : 'ok fresh')
        + (GUARANTEED_RE.test(tg0) ? ' gtd' : (CROSS_RE.test(tg0) ? ' crs' : ''));
      // ＋ = 이 칸이 새로 찬 것이지 사람이 새로 온 게 아니다.
      let mk = td.querySelector('.tag');
      if (!inReal && inKakao) {
        if (!mk) { mk = document.createElement('span'); mk.className = 'tag'; mk.title = '이 칸이 새로 찼습니다(사람이 새로 온 게 아닙니다)'; td.insertBefore(mk, td.firstChild); }
        mk.textContent = '＋';
      } else if (mk) mk.remove();
      if (!pe) { pe = document.createElement('span'); pe.className = 'pos'; td.appendChild(pe); }
      if (!nm) { nm = document.createElement('span'); nm.className = 'nm'; td.appendChild(nm); }
      pe.textContent = String(pos);
      nm.textContent = bare(cell);
      if (tg0 && !dt) { dt = document.createElement('span'); dt.className = 'dt'; td.appendChild(dt); }
      if (dt) { dt.textContent = tg0; dt.style.display = tg0 ? '' : 'none'; }
      const nameChanged = cell !== (rosterOrig[part][pos - 1] || '');
      const teeChanged = !sameTee(tee[part][pos - 1], teeOrig[part][pos - 1]);
      td.classList.toggle('edited', nameChanged);
      td.classList.toggle('moved', teeChanged && !nameChanged);
    });
    paintSpares(part);
    paintPool(part);
    saveBtn.hidden = !PARTS.some(changed);
    undoBtn.hidden = !stack.length;
    // 반영할 게 있으면(테스트판이 덮여 있거나 방금 고쳤으면) 반영 버튼을 낸다.
    if (applyBtn) applyBtn.hidden = !(SB_EDITED.length || PARTS.some(changed));
  }

  // ★스페어 줄 — 티오프가 없는 순번들. 이걸 안 그리면 편집 모드에서 그 사람들이 통째로 사라진다.
  //  (티오프표는 '티오프가 있는 사람'만 그리는 표라서 스페어를 담을 칸이 아예 없다.)
  //  사라져 보이는 것도 문제지만, 더 큰 문제는 대바 상대로 고를 수가 없다는 것이다 —
  //  스페어와 근무자를 맞바꾸는 건 실제로 자주 일어나는 조작이다.
  function paintSpares(part) {
    const box = document.querySelector('.spares[data-p="' + part + '"]');
    if (!box) return;
    const has = new Set();
    tee[part].forEach((t, i) => { if (t) has.add(i + 1); });
    const out = [];
    for (let p = 1; p <= roster[part].length; p++) {
      const cell = roster[part][p - 1];
      if (has.has(p) || !String(cell || '').trim()) continue;
      const tg = tagOf(cell);
      const ch = document.createElement('span');
      ch.className = 'sp' + (cell !== (rosterOrig[part][p - 1] || '') ? ' edited' : '');
      ch.dataset.p = part; ch.dataset.pos = String(p);
      const b = document.createElement('b'); b.textContent = p + '번'; ch.appendChild(b);
      const n = document.createElement('span'); n.className = 'nm'; n.textContent = bare(cell); ch.appendChild(n);
      if (tg) { const d = document.createElement('span'); d.className = 'dt'; d.textContent = tg; ch.appendChild(d); }
      out.push(ch);
    }
    box.innerHTML = '';
    // ★'캐디 추가'는 스페어 줄에 둔다 — 시스템이 명단을 놓칠 때 사라지는 건 대개 스페어이고,
    //  새로 넣는 사람도 맨 뒤(스페어)로 들어오기 때문이다. 스페어가 0명이어도 줄은 떠 있어야 한다.
    if (mode === 'crew') {
      const add = document.createElement('span');
      add.className = 'sp add'; add.dataset.p = part; add.dataset.add = '1';
      add.textContent = '＋ 캐디 추가';
      const lb0 = document.createElement('span');
      lb0.className = 'lb';
      lb0.textContent = '스페어 ' + out.length + '명 · 명단 ' + roster[part].filter((x) => String(x || '').trim()).length + '명 — 눌러서 넣고 뺍니다';
      box.appendChild(lb0);
      out.forEach((x) => box.appendChild(x));
      box.appendChild(add);
      box.hidden = false;
      return;
    }
    if (!out.length) { box.hidden = true; return; }
    const lb = document.createElement('span');
    lb.className = 'lb'; lb.textContent = '스페어 ' + out.length + '명 — 티오프 없음(끌어다 근무자와 맞바꿀 수 있습니다)';
    box.appendChild(lb);
    out.forEach((x) => box.appendChild(x));
    box.hidden = false;
  }
  // ── 미배치 캐디 서랍 ────────────────────────────────────────────────
  //  ★이름을 하나씩 쳐 넣는 건 스무 명이 넘어가면 사람이 할 일이 아니다.
  //   8/19 2부는 명단 31명이 8명으로 덮여 스물세 명이 통째로 사라졌다. 그걸 손으로 치게 두면
  //   오타가 섞이고, 오타 섞인 이름은 회원 매칭이 안 돼 알림이 안 간다 — 조용히 틀리는 쪽이다.
  //  ★그래서 정본 명단에서 고르게 한다. 고른 이름은 반드시 정본 철자다.
  //   서랍에는 '오늘 이 부에 아직 없는 사람'만 둔다. 이미 있는 사람을 또 넣는 게 가장 흔한 실수다.
  //  ★다른 부에 잡힌 사람도 서랍에 남긴다 — (54)·(1,3)처럼 두 부를 뛰는 캐디가 실제로 있다.
  //   다만 어느 부에 있는지 표시해서, 넣기 전에 사람이 알고 넣게 한다.
  const OFFICIAL = (window.__DAEJO_ROSTER || []).slice();
  const nk = (x) => bare(x).replace(/\s/g, '');
  const placedIn = (part) => new Set(roster[part].map(nk).filter(Boolean));
  const elsewhere = (name) => PARTS.filter((p) => placedIn(p).has(nk(name)));
  function paintPool(part) {
    const box = document.querySelector('.pool[data-p="' + part + '"]');
    if (!box) return;
    if (mode !== 'crew') { box.hidden = true; return; }
    const here = placedIn(part);
    const left = OFFICIAL.filter((n) => n && !here.has(nk(n)));
    box.innerHTML = '';
    const lb = document.createElement('span');
    lb.className = 'lb';
    lb.innerHTML = '오늘 ' + part + '부에 없는 캐디 <b>' + left.length + '</b>명 — 끌어다 놓거나 눌러서 넣습니다';
    if (left.length) {
      const all = document.createElement('button');
      all.type = 'button'; all.className = 'all'; all.dataset.poolall = part;
      all.textContent = left.length + '명 전부 스페어로';
      lb.appendChild(all);
    }
    box.appendChild(lb);
    const wrap = document.createElement('div');
    wrap.className = 'wrap2';
    for (const n of left) {
      const c = document.createElement('span');
      c.className = 'pk'; c.dataset.p = part; c.dataset.pool = n;
      c.textContent = n;
      const el = elsewhere(n);
      if (el.length) { const t = document.createElement('span'); t.className = 'el'; t.textContent = el.join('·') + '부'; c.appendChild(t); }
      wrap.appendChild(c);
    }
    box.appendChild(wrap);
    box.hidden = false;
  }

  // 명단에 사람을 넣는다 — 서랍·손입력·끌어놓기가 모두 이 한 곳을 지난다.
  //  ★티오프 배열은 건드리지 않는다. 티오프는 '순번 자리'에 붙어 있어서, 사람이 하나 끼면
  //   뒤가 한 칸씩 밀리며 맨 뒤 근무자가 스페어로 내려간다 — 배치표에서 실제로 일어나는 일이다.
  function addCrew(part, name, at) {
    const nm = String(name || '').trim();
    if (!nm) return '';
    const n = roster[part].filter((x) => String(x || '').trim()).length;
    const pos = Math.min(Math.max(1, Number(at) || (n + 1)), n + 1);
    roster[part].splice(pos - 1, 0, nm);
    const work = teeV.real[part].length;
    return part + '부 ' + pos + '번에 ' + nm + ' 넣음'
      + (pos <= work ? ' — 뒤 순번이 한 칸씩 밀렸고 맨 뒤 근무자가 스페어로 내려갔습니다' : ' — 스페어로 들어갔습니다')
      + ' · 명단 ' + n + ' → ' + (n + 1) + '명';
  }

  // ★두 보기의 배치를 모두 담는다. 인턴 하나를 켜면 양쪽 배치가 같이 움직이는데
  //  보고 있던 쪽만 되돌리면 반대편에 인턴이 남아 근무선이 조용히 줄어든다(실측: 1부 42→39).
  //  배치가 진실이 된 이상, 되돌리기도 진실 전부를 되돌려야 한다.
  const push = (part) => {
    stack.push({ part: part, roster: roster[part].slice(),
      tee: { real: (teeV.real[part] || []).map(cp), proj: (teeV.proj[part] || []).map(cp) },
      // 팀 목록도 담는다 — 티오프 추가·삭제가 이걸 바꾸므로 안 담으면 되돌려도 팀이 그대로 남는다.
      occ: { real: (origOcc.real[part] || []).map(cp), proj: (origOcc.proj[part] || []).map(cp) },
      interns: new Set(interns[part]),
      memo: { real: new Map(idxMemo.real[part] || []), proj: new Map(idxMemo.proj[part] || []) } });
  };

  // ★기본 화면은 '실제 배치표'다 — 고치는 곳이 기본이어야 한다.
  //  예전엔 예상이 기본이었는데, 예상 배치를 저장하지 않기로 한 뒤로는
  //  기본 화면에서 옮겨도 저장할 수가 없다(사용자가 겪은 그 상태 그대로다).
  //  앱에 가는 것도, 사람이 고치는 것도 실제 배치표다. 예상은 눌러서 본다.
  let mode = '', pick = null, view = 'real';
  const clearPick = () => { if (pick) pick.classList.remove('picked'); pick = null; };
  // 칸(td.c)이든 스페어 칩(span.sp)이든 '어느 부 몇 번인가'를 같은 식으로 답한다.
  const posAt = (part, el) => {
    if (!el) return 0;
    if (el.dataset && el.dataset.pos) return Number(el.dataset.pos) || 0;   // 스페어 칩
    const at = new Map();
    tee[part].forEach((t, i) => { if (t) at.set(K(t.time, t.course), i + 1); });
    return at.get(K(el.dataset.t, el.dataset.c)) || 0;
  };
  const unit = (el) => (el && el.closest ? (el.closest('td.c') || el.closest('.sp') || el.closest('.pk')) : null);
  const isPool = (el) => !!(el && el.classList && el.classList.contains('pk'));
  const isSpare = (el) => !!(el && el.classList && el.classList.contains('sp'));

  // ── 두 조작을 함수로 빼둔다 — 누르기와 끌기가 같은 길을 쓰게. ──────────────
  function applySwap(part, from, to) {
    if (!from || !to || from === to) return '';
    push(part);
    const a = roster[part];
    const t = a[from - 1]; a[from - 1] = a[pos0(to)]; a[pos0(to)] = t;
    paint(part);
    return part + '부 ' + from + '번 ↔ ' + to + '번 맞바꿈 (티오프는 그대로)';
  }
  const pos0 = (p) => p - 1;
  function applyMove(part, from, to, target) {
    if (!from || from === to) return '';
    push(part);
    const T = tee[part];
    const who = bare(roster[part][from - 1]);
    const wasAt = T[from - 1] ? T[from - 1].time + ' ' + T[from - 1].course : '(없음)';
    if (!to) {
      T[from - 1] = target;                       // 빈 티오프 — 그 사람만 이동
      paint(part);
      return part + '부 ' + who + '(' + from + '번) ' + wasAt + ' → ' + target.time + ' ' + target.course + ' (빈 티오프, 나머지 그대로)';
    }
    // ★가져오는 방향 — 목표 티오프를 뽑아 그 사람의 순번 자리에 끼운다.
    const x = T.splice(to - 1, 1)[0];
    T.splice(from - 1, 0, x || target);
    paint(part);
    const n = Math.abs(to - from);
    return part + '부 ' + who + '(' + from + '번) ' + wasAt + ' → ' + target.time + ' ' + target.course
      + ' · 사이 ' + n + '개 순번의 티오프가 한 칸씩 ' + (to > from ? '앞당겨졌습니다' : '뒤로 밀렸습니다')
      + ' · 순번은 아무도 안 바뀜';
  }

  // ── 끌어놓기 — 마우스·손가락 공통(포인터 이벤트). 편집 모드일 때만 동작한다. ────────
  //  ★모드가 꺼져 있을 땐 끌기를 안 잡는다. 안 그러면 폰에서 표를 스크롤할 수가 없다
  //   (칸에 touch-action:none을 걸어야 끌기가 되는데, 그러면 그 위에선 스크롤이 죽는다).
  const DRAG_MIN = 6;
  let drag = null, ghost = null, suppressClick = false;
  const cellUnder = (x, y) => unit(document.elementFromPoint(x, y));
  function dragEnd(cancel) {
    if (ghost) { ghost.remove(); ghost = null; }
    document.querySelectorAll('.drop-to').forEach((x) => x.classList.remove('drop-to'));
    if (drag && drag.td) drag.td.classList.remove('dragging');
    document.body.classList.remove('dragging-now');
    drag = null;
    if (cancel) suppressClick = false;
  }
  document.addEventListener('pointerdown', (e) => {
    // ★새 동작이 시작됐다 — 지난 끌어놓기의 '누르기 무시' 표시가 남아 있으면 안 된다.
    //  폰에서는 끌어놓기 뒤 click이 안 따라오는 경우가 있어, 그 표시가 남으면 다음 탭 한 번이
    //  통째로 먹힌다(아무 반응 없음). 여기서 반드시 지운다.
    suppressClick = false;
    if (mode !== 'swap' && mode !== 'move' && mode !== 'crew') return;
    if (e.button != null && e.button > 0) return;
    const td = unit(e.target);
    if (!td || td.classList.contains('intern')) return;
    // ★서랍 칩 — 아직 명단에 없는 사람이라 순번이 없다. 끌어다 놓는 자리가 곧 순번이 된다.
    if (isPool(td)) {
      if (mode !== 'crew') return;
      drag = { td: td, part: td.dataset.p, pool: td.dataset.pool, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      return;
    }
    if (mode === 'crew') return;                       // crew에서 기존 사람은 끌지 않는다(누르면 뺀다)
    if (!isSpare(td) && !td.dataset.t) return;
    const part = td.dataset.p, from = posAt(part, td);
    if (!from) return;
    drag = { td: td, part: part, from: from, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, spare: isSpare(td) };
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < DRAG_MIN) return;
      drag.moved = true;
      drag.td.classList.add('dragging');
      document.body.classList.add('dragging-now');
      ghost = document.createElement('div');
      ghost.className = 'ghost';
      ghost.textContent = drag.pool ? ('＋ ' + drag.pool) : (drag.from + '번 ' + bare(roster[drag.part][drag.from - 1]));
      document.body.appendChild(ghost);
      try { drag.td.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
    e.preventDefault();
    ghost.style.transform = 'translate(' + (e.clientX + 12) + 'px,' + (e.clientY - 14) + 'px)';
    document.querySelectorAll('.drop-to').forEach((x) => x.classList.remove('drop-to'));
    const over = cellUnder(e.clientX, e.clientY);
    if (over && over !== drag.td && over.dataset.p === drag.part && !over.classList.contains('intern') && !isPool(over)) over.classList.add('drop-to');
  }, { passive: false });
  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (!drag.moved) { dragEnd(true); return; }          // 그냥 탭이었다 — 누르기 처리에 맡긴다
    suppressClick = true;
    const over = cellUnder(e.clientX, e.clientY);
    const d = drag;
    dragEnd(false);
    // ★서랍에서 끌어온 사람 — 놓은 자리가 곧 순번이다. 표 밖(스페어 줄·서랍)에 놓으면 맨 뒤로 간다.
    if (d.pool) {
      const onBoard = over && over.dataset.p === d.part && !isPool(over) && !over.classList.contains('intern');
      const at = onBoard ? posAt(d.part, over) : 0;
      push(d.part);
      const msg = addCrew(d.part, d.pool, at || 0);
      paint(d.part);
      state.textContent = msg || '넣지 못했습니다.';
      return;
    }
    if (!over || over.dataset.p !== d.part || over.classList.contains('intern')) { state.textContent = '취소했습니다.'; return; }
    const to = posAt(d.part, over);
    // ★스페어가 끼면 티오프 이동은 뜻이 없다(가진 티오프가 없다) → 자동으로 맞바꾸기로 처리한다.
    const spareInvolved = d.spare || isSpare(over);
    if (mode === 'swap' || spareInvolved) {
      const msg = to ? applySwap(d.part, d.from, to) : '맞바꾸려면 사람이 있는 칸에 놓아주세요.';
      state.textContent = msg + (spareInvolved && mode !== 'swap' ? ' (스페어라 맞바꾸기로 처리했습니다)' : '');
      return;
    }
    const msg = applyMove(d.part, d.from, to, { time: toHM(toMin(over.dataset.t)), course: over.dataset.c });
    if (msg) state.textContent = msg + projNote();
  });
  document.addEventListener('pointercancel', () => dragEnd(true));

  // ── 보기 전환 — 이 화면에는 배치표가 둘 있다. 어느 쪽인지 항상 눈에 보이게 한다. ──────
  //   대조(카카오 예상) : 사진 판독 + 카카오 예약을 겹친 예상본. 순번이 다시 매겨져 있고 칸이 더 많다.
  //   실제 배치표       : 사진이 실제로 읽은 것. 저장은 여기서만 한다.
  //  처음엔 편집 버튼을 누를 때 말없이 바꿔치기했는데, 순번도 칸 수도 다른 두 표가 소리 없이
  //  뒤바뀌니 헷갈릴 수밖에 없었다. 바뀌는 걸 숨기지 말고 고르게 한다.
  const vProj = document.getElementById('vProj');
  const vReal = document.getElementById('vReal');
  const viewNote = document.getElementById('viewNote');
  const tools = document.getElementById('tools');
  const NOTE_PROJ = '사진 판독 위에 카카오 예약을 겹친 <b>예상</b>입니다. 카카오를 따라 <b>매번 새로 계산</b>되므로 여기서 옮긴 건 저장되지 않습니다.';
  const NOTE_REAL = '사진이 <b>실제로 읽은</b> 배치표입니다. 고치는 곳이자 앱으로 넘어가는 곳입니다.';
  function setView(v) {
    if (v === view) return;
    view = v;
    vProj.classList.toggle('on', v === 'proj');
    vReal.classList.toggle('on', v === 'real');
    document.body.classList.toggle('realview', v === 'real');
    viewNote.innerHTML = v === 'real' ? NOTE_REAL : NOTE_PROJ;
    // ★두 보기 모두 편집한다 — 도구는 항상 나온다. 고친 명단·인턴은 두 보기가 공유하므로
    //  어느 쪽에서 고쳐도 반대편에 그대로 반영된다.
    tools.hidden = false;
    // ★보기를 바꿀 때 배치를 다시 만들지 않는다 — 각 보기의 배치는 이미 들고 있고,
    //  다시 만들면 그 보기에서 손수 옮긴 결과가 지워진다.
    PARTS.forEach(paint);
    clearPick();
  }
  vProj.addEventListener('click', () => setView('proj'));
  vReal.addEventListener('click', () => setView('real'));

  function setMode(m) {
    mode = m;
    document.querySelectorAll('.tools button[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === mode));
    document.body.classList.toggle('editing', !!mode);
    hint.textContent = mode ? HINTS[mode] : '모드를 고르고 칸을 누르거나 끌어놓으세요.';
    clearPick();
    PARTS.forEach(paint);   // 모드에 따라 스페어 줄이 달라진다(캐디 추가 칩) — 바꾸면 다시 그린다
  }
  document.querySelectorAll('.tools button[data-mode]').forEach((b) => {
    b.addEventListener('click', () => setMode(mode === b.dataset.mode ? '' : b.dataset.mode));
  });
  undoBtn.addEventListener('click', () => {
    const s = stack.pop(); if (!s) return;
    roster[s.part] = s.roster;
    teeV.real[s.part] = s.tee.real; teeV.proj[s.part] = s.tee.proj;
    origOcc.real[s.part] = s.occ.real; origOcc.proj[s.part] = s.occ.proj;
    interns[s.part] = s.interns;
    idxMemo.real[s.part] = s.memo.real; idxMemo.proj[s.part] = s.memo.proj;
    paint(s.part);
    state.textContent = '되돌렸습니다.';
  });

  document.addEventListener('click', async (e) => {
    if (suppressClick) { suppressClick = false; return; }   // 방금 끌어놓았다 — 누르기로 두 번 처리하지 않는다
    if (!mode) return;
    // ★'남은 전부 스페어로' — 이게 진짜 '한 번에'다. 8/19 2부처럼 스물세 명이 통째로 사라진 날,
    //  하나씩 끌어 넣는 것도 스물세 번이다. 순서는 정본 명단 그대로 맨 뒤에 붙는다.
    const allBtn = e.target && e.target.closest ? e.target.closest('button[data-poolall]') : null;
    if (allBtn && mode === 'crew') {
      const part0 = allBtn.dataset.poolall;
      const here = placedIn(part0);
      const left = OFFICIAL.filter((n) => n && !here.has(nk(n)));
      if (!left.length) return;
      if (!confirm([part0 + '부 명단 맨 뒤에 ' + left.length + '명을 한 번에 넣습니다(전부 스페어).', '',
        left.slice(0, 12).join(' · ') + (left.length > 12 ? ' 외 ' + (left.length - 12) + '명' : ''), '',
        '순서는 정본 명단 차례입니다 — 넣은 뒤 순번 옮기기·맞바꾸기로 고칠 수 있습니다.',
        '계속할까요?'].join(String.fromCharCode(10)))) return;
      push(part0);
      const n0 = roster[part0].filter((x) => String(x || '').trim()).length;
      for (const n of left) roster[part0].push(n);
      paint(part0);
      state.textContent = part0 + '부에 ' + left.length + '명을 스페어로 넣었습니다 — 명단 ' + n0 + ' → ' + (n0 + left.length) + '명';
      return;
    }
    const td = unit(e.target); if (!td) return;
    // 서랍 칩을 그냥 누르면 맨 뒤(스페어)로 — 폰에서 끌기가 어려울 때의 빠른 길.
    if (isPool(td)) {
      if (mode !== 'crew') { state.textContent = '‘캐디 추가·삭제’ 모드에서 넣을 수 있습니다.'; return; }
      push(td.dataset.p);
      const msg = addCrew(td.dataset.p, td.dataset.pool, 0);
      paint(td.dataset.p);
      state.textContent = msg;
      return;
    }
    if (!isSpare(td) && !td.dataset.t) return;
    if (td.dataset.add && mode !== 'crew') return;         // '＋ 캐디 추가'는 그 모드에서만 뜻이 있다

    // 티오프(팀) 추가·삭제 — 실시간 추적이 놓친 예약을 손으로 살린다.
    if (mode === 'team') {
      if (isSpare(td)) { state.textContent = '스페어 칩이 아니라 표의 칸을 눌러주세요.'; return; }
      const part0 = td.dataset.p;
      const key0 = K(td.dataset.t, td.dataset.c);
      const where = td.dataset.t + ' ' + td.dataset.c;
      const has = origOcc[view][part0].some((s) => K(s.time, s.course) === key0);
      const before = teeV[view][part0].length;
      push(part0);
      const r = setTeam(part0, key0, !has);
      if (!r) { stack.pop(); return; }
      paint(part0);
      const gained = r.work - before;
      state.textContent = r.on
        ? `${where}에 팀을 추가했습니다 — 뒤 순번이 한 칸씩 밀렸고 ${gained > 0 ? '스페어 맨 앞이 근무로 올라왔습니다' : '올라올 스페어가 없습니다'} (근무선 ${before}→${r.work})`
        : `${where} 팀을 없앴습니다 — 뒤 순번이 당겨지고 맨 뒤 한 명이 스페어로 내려갔습니다 (근무선 ${before}→${r.work})`;
      state.textContent += projNote();
      return;
    }

    if (mode === 'intern') {
      const part0 = td.dataset.p;
      const key0 = K(td.dataset.t, td.dataset.c);
      const turningOn = !interns[part0].has(key0);
      push(part0);
      const where = td.dataset.t + ' ' + td.dataset.c;
      if (turningOn) {
        const r = internOn(part0, td.dataset.t, td.dataset.c);
        paint(part0);
        state.textContent = r.fromPos
          ? (where + ' 인턴 — ' + r.fromPos + '번부터 각자 다음 티오프로 밀렸습니다'
             + (r.dropped > 0 ? ' · ' + (r.who || '맨 뒤 한 명') + '은(는) 스페어로 내려갔습니다(팀이 하나 줄었으니까)' : ''))
          : (where + ' 인턴 (팀이 없던 칸이라 밀린 사람 없음)');
      } else {
        const r = internOff(part0, td.dataset.t, td.dataset.c);
        paint(part0);
        state.textContent = where + ' 인턴 해제 — 뒤 순번들이 앞으로 당겨졌습니다';
      }
      return;
    }

    const part = td.dataset.p;
    const pos = posAt(part, td);

    // ── 캐디 추가·삭제 ── 시스템이 명단을 크게 놓치는 날이 있다(8/19 2부: 31명 명단이 8명으로 덮였다).
    //  그때 '이름 고치기'로는 손쓸 수가 없다 — 고칠 칸 자체가 없기 때문이다.
    //
    //  ★두 축은 여기서도 갈라둔다. 명단(순번↔이름)만 늘고 줄고, 티오프 배열은 그대로 둔다.
    //   티오프는 '순번 자리'에 붙어 있으므로, 사람을 하나 끼우면 그 뒤가 한 칸씩 밀리며
    //   맨 뒤 근무자가 스페어로 내려가고, 빼면 스페어 맨 앞이 근무로 올라온다.
    //   실제 배치표에서 사람이 하나 들고 나면 정확히 그 일이 일어난다.
    if (mode === 'crew') {
      const part0 = td.dataset.p;
      if (td.dataset.add) {                                  // 넣기
        const n = roster[part0].filter((x) => String(x || '').trim()).length;
        const nm = prompt(part0 + '부에 넣을 캐디 이름', '');
        if (nm == null || !nm.trim()) return;
        const atStr = prompt([nm.trim() + '님을 몇 번에 넣을까요?',
          '비워두면 맨 뒤(' + (n + 1) + '번)로 들어갑니다.'].join(String.fromCharCode(10)), String(n + 1));
        if (atStr == null) return;
        const at = Math.min(Math.max(1, Number(atStr) || (n + 1)), n + 1);
        push(part0);
        const msg = addCrew(part0, nm, at);          // 서랍·끌기와 같은 길
        paint(part0);
        state.textContent = msg;
        return;
      }
      const pos0 = posAt(part0, td);
      if (!pos0) { state.textContent = '뺄 사람이 있는 칸을 눌러주세요.'; return; }
      const who = bare(roster[part0][pos0 - 1] || '');
      if (!who) { state.textContent = '이 칸엔 이름이 없습니다.'; return; }
      if (!confirm(`${part0}부 ${pos0}번 ${who}을(를) 명단에서 뺍니다. 뒤 순번이 한 칸씩 당겨집니다. 계속할까요?`)) return;
      push(part0);
      roster[part0].splice(pos0 - 1, 1);
      // ★명단이 티오프보다 짧아지면 안 된다 — 그러면 주인 없는 티오프가 남아 반영이 막힌다.
      //  올라올 스페어가 없다는 뜻이므로 맨 뒤 팀 하나를 내린다(다시 필요하면 '티오프 추가'로 넣는다).
      const names = roster[part0].filter((x) => String(x || '').trim()).length;
      let dropped = '';
      while (teeV.real[part0].length > names) {
        const g = teeV.real[part0].pop();
        dropped = g ? `${g.time} ${g.course}` : '';
        const k = K(g.time, g.course);
        origOcc.real[part0] = origOcc.real[part0].filter((x) => K(x.time, x.course) !== k);
      }
      paint(part0);
      state.textContent = `${part0}부 ${pos0}번 ${who} 뺐습니다 — 뒤 순번이 당겨졌습니다`
        + (dropped ? ` · 올라올 스페어가 없어 맨 뒤 팀(${dropped})을 내렸습니다` : ' · 스페어 맨 앞이 근무로 올라왔습니다')
        + ` · 명단 ${names + 1} → ${names}명`;
      return;
    }

    if (mode === 'name') {
      if (!pos) { state.textContent = '이 칸엔 배정된 순번이 없습니다.'; return; }
      const cell = roster[part][pos - 1] || '';
      const next = prompt(part + '부 ' + pos + '번 — 이름', bare(cell));
      if (next == null || next.trim() === bare(cell)) return;
      push(part);
      const tg = tagOf(cell);
      roster[part][pos - 1] = next.trim() + (tg ? '(' + tg + ')' : '');
      paint(part);
      state.textContent = part + '부 ' + pos + '번 → ' + next.trim();
      return;
    }

    // ── 맞바꾸기(대바) — 순번↔이름만 교환. 티오프는 자리에 그대로 남는다.
    if (mode === 'swap') {
      if (!pos) { state.textContent = '이 칸엔 배정된 순번이 없습니다.'; return; }
      if (!pick) { pick = td; td.classList.add('picked'); state.textContent = part + '부 ' + pos + '번 ' + bare(roster[part][pos - 1]) + ' 선택 — 바꿀 상대를 누르세요'; return; }
      if (pick.dataset.p !== part) { state.textContent = '같은 부 안에서만 됩니다.'; clearPick(); return; }
      const from = posAt(part, pick);
      clearPick();
      const msg = applySwap(part, from, pos);
      if (msg) state.textContent = msg + projNote();
      return;
    }

    // ── 순번 옮기기 — 그 사람의 순번은 그대로, 티오프만 옮긴다.
    //    ★이미 다른 순번이 서 있는 칸으로도 옮길 수 있다. 그 칸 주인과 사이 순번들의 티오프가
    //     한 칸씩 따라 이동한다(티오프 배열을 splice). 명단(순번↔이름)은 손대지 않는다.
    if (mode === 'move') {
      // ★스페어가 끼면 맞바꾸기로 처리한다 — 어느 쪽을 먼저 누르든 똑같이 동작해야 한다.
      //  스페어에겐 옮길 티오프가 없으니 '티오프 옮기기'는 성립하지 않는다. 대신 그 사람이
      //  근무 순번을 넘겨받는 것(대바)이 실제로 일어나는 일이다.
      //  전에는 스페어를 먼저 누르면 안내문만 뜨고 아무것도 안 집혀서, 스페어를 근무로
      //  끌어올리는 조작이 한 방향으로만 됐다(근무자를 먼저 눌렀을 때만).
      if (isSpare(td) || (pick && isSpare(pick))) {
        if (!pick) {
          if (!pos) { state.textContent = '사람이 있는 자리를 눌러주세요.'; return; }
          pick = td; td.classList.add('picked');
          state.textContent = part + '부 ' + pos + '번 ' + bare(roster[part][pos - 1])
            + ' 선택 — 들어갈 자리를 누르세요 (스페어라 맞바꾸기로 처리됩니다)';
          return;
        }
        if (pick.dataset.p !== part) { state.textContent = '같은 부 안에서만 됩니다.'; clearPick(); return; }
        const from0 = posAt(part, pick); clearPick();
        if (!pos) { state.textContent = '사람이 있는 자리에 놓아주세요 — 빈 티오프로는 맞바꿀 수 없습니다.'; return; }
        const msg = applySwap(part, from0, pos);
        state.textContent = msg ? msg + ' (스페어라 맞바꾸기로 처리했습니다)' : '';
        return;
      }
      if (!pick) {
        if (!pos) { state.textContent = '옮길 사람이 있는 칸을 눌러주세요.'; return; }
        pick = td; td.classList.add('picked');
        state.textContent = part + '부 ' + pos + '번 ' + bare(roster[part][pos - 1]) + ' 선택 — 갈 티오프를 누르세요';
        return;
      }
      if (pick.dataset.p !== part) { state.textContent = '같은 부 안에서만 됩니다.'; clearPick(); return; }
      const from = posAt(part, pick);
      clearPick();
      const target = { time: toHM(toMin(td.dataset.t)), course: td.dataset.c };
      const msg = applyMove(part, from, pos, target);   // pos가 0이면 빈 티오프
      if (msg) state.textContent = msg + projNote();
      return;
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!live) { state.textContent = '이 화면은 파일로 뽑은 샘플이라 저장이 안 됩니다 — 모니터의 /daejo 에서 열어주세요.'; return; }
    saveBtn.disabled = true;
    state.textContent = '저장 중…';
    const saved = [];
    // ★저장은 관리자 테스트판(daejo-sandbox)으로만 간다. 회원 앱·알림·엔진은 이걸 보지 않는다.
    //  이 화면의 '실제 배치표'는 아직 기능이 덜 여물었다 — 덜 여문 화면이 살아 있는 데이터를
    //  직접 만지던 구조가 8/17 사고(3부 10팀 → 예상 13팀, 커트 10→13)의 뿌리였다.
    //  실제 배치표 교정은 모니터의 '배치표 검수' 탭에서만 한다.
    const payload = {};
    try {
      for (const part of PARTS) {
        if (!changed(part)) continue;
        // 실제 배치표 축만 담는다 — 카카오 예상 칸은 예상일 뿐 팀이 아니다.
        const real = teeV.real[part] || [];
        const teamSet = new Set((origOcc.real[part] || []).map((s) => K(s.time, s.course)));
        const split = (ks) => ks.map((k) => ({ time: k.split('|')[0], course: k.split('|')[1] }));
        payload[part] = {
          roster: roster[part].slice(),
          teeGrid: real.map((t, i) => ({ pos: i + 1, time: t.time, course: t.course })),
          // ★예상 보기의 배치는 저장하지 않는다 — 저장하면 그 순간에 얼어붙어 그 뒤의 카카오 변동을
          //  못 따라간다. 예상은 켤 때마다 지금의 실제 배치표 ∪ 지금의 카카오로 다시 계산한다.
          projGrid: [],
          boardInternTees: split([...interns[part]].filter((k) => teamSet.has(k))),
          internTees: split([...interns[part]]),
          cut: real.length,
        };
        saved.push(part);
      }
      if (saved.length) {
        const r = await fetch(apiUrl('/api/daejo-save'), {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ date: DATE, parts: payload }),
        });
        const j = await r.json(); if (!j.ok) throw new Error(j.error || '저장 실패');
        for (const part of saved) {
          // ★배치를 그대로 넘긴다 — 안 넘기면 시각 순으로 다시 짜여 손수 옮긴 결과가 사라진다.
          setBaseline(part, (teeV.real[part] || []).concat(payload[part].boardInternTees),
            { real: teeV.real[part] });
          markEdited(part);   // 이제 테스트판이 이 부를 덮고 있다 — 반영 버튼이 살아 있어야 한다.
        }
        resetBtn.hidden = false;
      }
      stack.length = 0;
      PARTS.forEach(paint);
      // ★저장 버튼이 사라지는 것이 곧 '저장됐다'는 신호다. 남아 있으면 아직 안 된 것이다.
      state.textContent = saved.length
        ? `테스트판에 저장됐습니다 — ${saved.map((p) => p + '부').join('·')}. 앱에는 아직 안 갔습니다 — 회원에게 보이려면 ‘실제 배치표를 앱에 반영’을 누르세요.`
          + (view === 'proj' ? ' (카카오 예상 칸은 팀으로 세지 않았습니다)' : '')
        : '바뀐 게 없습니다.';
    } catch (err) { state.textContent = '저장 실패: ' + err.message; }
    finally { saveBtn.disabled = false; PARTS.forEach(paint); }
  });


  // ── 정정 알림 ── 이 화면에서 유일하게 '밖으로' 나가는 버튼이다.
  //
  //  ★반영과 한 버튼에 묶지 않는다. 반영은 틀리면 다시 고치면 되지만, 보낸 알림은 못 거둔다.
  //   그래서 반영은 문구를 '만들어 두기만' 하고(서버가 15분짜리 토큰에 담는다), 발송은 따로 누른다.
  //  ★그리고 누구에게 무엇이 가는지 전부 보여주고 확인을 받는다. 몇 명인지만 말하는 확인은
  //   확인이 아니다 — 엉뚱한 사람에게 '티오프 변경!'이 가는 걸 막을 방법이 없다.
  //  ★대상은 서버가 고른다. '실제로 상태가 바뀐 회원'만이다(correctionMsg). 화면이 다시 세면
  //   두 곳이 갈라지고, 갈라지면 반드시 한쪽이 틀린다.
  const NOTIFY = { items: [], tokens: [], at: 0, noPush: false };
  const AUTO = [];                                   // 이번 반영에서 서버가 자동으로 보낸 결과(부별)
  const NOTIFY_TTL = 15 * 60 * 1000;                 // 서버 토큰 수명과 같다
  const notifyLeft = () => (NOTIFY.at ? NOTIFY_TTL - (Date.now() - NOTIFY.at) : 0);
  function resetNotify() { NOTIFY.items = []; NOTIFY.tokens = []; NOTIFY.at = 0; NOTIFY.noPush = false; paintNotify(); }
  function paintNotify() {
    if (!notifyBtn) return;
    const n = NOTIFY.items.length;
    const alive = n > 0 && NOTIFY.tokens.length > 0 && notifyLeft() > 0;
    notifyBtn.hidden = !alive;
    if (alive) notifyBtn.textContent = `정정 알림 보내기 (${n}명)`;
  }
  setInterval(paintNotify, 30000);                   // 15분이 지나면 스스로 사라진다(서버도 그때 버린다)

  if (notifyBtn) notifyBtn.addEventListener('click', async () => {
    if (!live) { state.textContent = '샘플에서는 보낼 수 없습니다.'; return; }
    if (!NOTIFY.items.length || !NOTIFY.tokens.length) { state.textContent = '보낼 알림이 없습니다.'; return; }
    if (notifyLeft() <= 0) { resetNotify(); state.textContent = '알림이 만료됐습니다(15분) — 다시 반영해주세요.'; return; }
    const NL = String.fromCharCode(10);
    const lines = NOTIFY.items.map((x) => `· ${x.name} — ${x.body}`);
    const min = Math.max(1, Math.round(notifyLeft() / 60000));
    const msg = [`회원 ${NOTIFY.items.length}명에게 정정 알림을 보냅니다. 보낸 알림은 거둘 수 없습니다.`, '']
      .concat(lines).concat(['', `(남은 시간 약 ${min}분) 보낼까요?`]).join(NL);
    if (!confirm(msg)) return;
    notifyBtn.disabled = true;
    state.textContent = '알림 보내는 중…';
    let sent = 0, total = 0, err = '';
    for (const token of NOTIFY.tokens) {
      try {
        const r = await fetch(apiUrl('/api/board-notify'), {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: token }),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || '발송 실패');
        sent += Number(j.sent) || 0; total += Number(j.total) || 0;
      } catch (e) { err = e.message; }
    }
    // ★토큰은 한 번 쓰면 서버가 지운다 — 두 번 눌러 두 번 가는 일이 없게 여기서도 비운다.
    resetNotify();
    notifyBtn.disabled = false;
    state.textContent = err
      ? `알림 일부 실패 — 보냄 ${sent}/${total}명 · ${err}`
      : `정정 알림을 보냈습니다 — ${sent}/${total}명`;
  });

  // ── 앱에 반영 ── 실제 배치표 축만, 그것도 이 버튼을 눌렀을 때만 넘어간다.
  //
  //  ★카카오 예상은 절대 안 넘긴다. 예상 격자가 본배치표로 새어 들어가 8/17 3부가
  //   10팀 → 13팀으로 덮이고 커트가 10→13이 된 적이 있다(알림은 안 나갔지만 앱은 틀린 걸 보여줬다).
  //   그래서 rows는 언제나 teeV.real이고, 인턴도 '본배치표에 팀이 있는 칸'만 보낸다.
  //  ★그리고 조용히 일어나지 않는다 — 무엇이 어떻게 바뀌는지 먼저 보여주고 확인을 받는다.
  function realPayload(part) {
    const real = teeV.real[part] || [];
    const teamSet = new Set((origOcc.real[part] || []).map((s) => K(s.time, s.course)));
    return {
      part: part,
      rows: roster[part].map((cell, i) => {
        const t = real[i];
        return { pos: i + 1, name: String(cell || ''), tee: t ? t.time : '', course: t ? t.course : '' };
      }),
      interns: [...interns[part]].filter((k) => teamSet.has(k)).map((k) => ({ time: k.split('|')[0], course: k.split('|')[1] })),
      // ★배치표에 못 넘기는 인턴도 '없던 일'이 되면 안 된다.
      //  실사고: 카카오 예상에만 있는 칸(17:07 OUT)의 인턴은 위 목록에서 걸러지는데,
      //  서버가 그 걸러진 목록을 '오늘 인턴의 전부'로 알아듣고 수동 지정을 통째로 지웠다.
      //  반영했더니 인턴이 날아간 이유다. 전체 목록을 따로 보내 그 판단을 서버가 안 하게 한다.
      allInterns: [...interns[part]].map((k) => ({ time: k.split('|')[0], course: k.split('|')[1] })),
      // ★커트는 '티오프가 있는 사람 수'이고, 명단을 넘을 수 없다.
      //  예전엔 real.length였다 — 팀을 추가할 때마다 splice로 배열이 길어져서, 명단 21명인데
      //  커트가 24가 됐다(8/18). 화면은 커트만큼 줄을 그리니 뒤 세 줄이 빈칸으로 남았다.
      cutLine: Math.min(real.filter(Boolean).length, roster[part].filter((x) => String(x || '').trim()).length),
      // ★문구는 만들되 보내지는 않는다. 서버는 '실제 바뀐 회원'만 골라 문구를 짜서
      //  토큰에 담아두고(15분), 관리자가 /api/board-notify로 확인해야 그때 나간다.
      //  반영과 발송을 한 버튼에 묶지 않는 이유: 반영은 되돌릴 수 있고 알림은 못 거둔다.
      notify: true,
      // ★자동 발송 — 반영은 이미 명시적 행위다. 바뀐 회원에게 그 자리에서 나간다(사용자 결정).
      //  서버가 보내기 전에 배치표가 성립하는지 먼저 센다. 겹친 칸·이름 없는 티오프·명단을 넘는 커트가
      //  하나라도 있으면 통째로 멈추고, 그때는 아래 '정정 알림 보내기'로 사람이 확인하고 보낸다.
      //  자동이 보낸 사람은 서버가 그 목록에서 빼주므로 같은 폰이 두 번 울리지 않는다.
      autoNotify: true,
    };
  }
  // ★깨진 배치는 아예 보내지 않는다 — 반영이 끝난 뒤에 알아채면 되돌릴 방법이 마땅치 않다.
  //  8/18 실사고: 같은 시각에 두세 명이 겹친 채로 반영돼 배치표에 그대로 저장됐고, 표는 한 시각에
  //  한 명만 그리므로 다섯 명이 화면에서 사라졌다. 사람이 흔적을 뒤져 찾아낼 일이 아니다.
  function payloadProblems(part, p) {
    const bad = [];
    const seen = new Map();
    for (const r of p.rows) {
      if (!r.tee) continue;
      const k = K(r.tee, r.course);
      if (seen.has(k)) bad.push(`${part}부 ${k} — ${seen.get(k)}번과 ${r.pos}번이 같은 칸`);
      else seen.set(k, r.pos);
      if (!String(r.name || '').trim()) bad.push(`${part}부 ${r.pos}번 — 티오프는 있는데 이름이 없음`);
    }
    const names = p.rows.filter((r) => String(r.name || '').trim()).length;
    if (p.cutLine > names) bad.push(`${part}부 커트 ${p.cutLine} — 명단 ${names}명보다 큼`);
    return bad;
  }

  // ★관리자가 손댄 부만 보낸다. 안 건드린 부까지 보내면 그 부 회원까지 다시 계산되고
  //  잠금(_adminLock)이 걸린다 — 손대지도 않은 사람의 상태를 얼려버리는 짓이다.
  //  '손댔다' = 지금 화면에 저장 안 된 변경이 있거나, 테스트판이 그 부를 덮고 있거나.
  const touched = (part) => !!(BOARD[part] || {}).roster && roster[part].length
    && (changed(part) || SB_EDITED.includes(part));
  function applySummary() {
    const lines = [];
    for (const part of PARTS) {
      if (!touched(part)) continue;
      const p = realPayload(part);
      const base = (BOARD[part].teeGrid || []).length;
      const nameFix = roster[part].filter((x, i) => (x || '') !== ((BOARD[part].roster || [])[i] || '')).length;
      // ★못 넘기는 인턴을 말없이 버리지 않는다 — 실제 배치표에 팀이 없는 칸(카카오 예상 전용)에
      //  찍은 인턴은 넘길 자리가 없다. 조용히 사라지면 '저장이 안 된다'로 보인다.
      const drop = interns[part].size - p.interns.length;
      lines.push(`${part}부 — 근무 ${base} → ${p.cutLine}` + (nameFix ? ` · 이름 ${nameFix}칸` : '')
        + (p.interns.length ? ` · 인턴 ${p.interns.length}칸` : '')
        + (drop > 0 ? ` · 인턴 ${drop}칸은 배치표에 못 넘어갑니다(그 시각 팀이 없어요 — 지정은 여기 그대로 남습니다)` : ''));
    }
    return lines;
  }
  applyBtn.addEventListener('click', async () => {
    if (!live) { state.textContent = '샘플에서는 반영할 수 없습니다.'; return; }
    const lines = applySummary();
    if (!lines.length) { state.textContent = '반영할 게 없습니다 — 고친 부가 없어요.'; return; }
    const problems = [];
    for (const part of PARTS) if (touched(part)) problems.push(...payloadProblems(part, realPayload(part)));
    if (problems.length) {
      state.textContent = '반영하지 않았습니다 — ' + problems[0] + (problems.length > 1 ? ` 외 ${problems.length - 1}건` : '');
      alert(['배치가 어긋나 반영하지 않았습니다. 아래를 고치고 다시 눌러주세요.', ''].concat(problems).join(String.fromCharCode(10)));
      return;
    }
    const msg = '실제 배치표를 앱에 반영합니다. 회원 대시보드가 바뀝니다.\n\n'
      + lines.join('\n')
      + '\n\n고친 부만 보냅니다. 카카오 예상 칸은 넘기지 않습니다. 알림은 나가지 않습니다.\n계속할까요?';
    if (!confirm(msg)) return;
    applyBtn.disabled = true;
    state.textContent = '반영 중…';
    resetNotify();
    AUTO.length = 0;
    const done = [];
    try {
      for (const part of PARTS) {
        if (!touched(part)) continue;
        const p = realPayload(part);
        const r = await fetch(apiUrl('/api/board-correct'), {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(p),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || (part + '부 반영 실패'));   // 서버도 배치가 성립하는지 센다
        done.push(`${part}부 ${j.updated || 0}명`);
        if (j.auto) AUTO.push({ part: part, ...j.auto });
        if (j.notifyToken) NOTIFY.tokens.push(j.notifyToken);
        (j.pending || []).forEach((x) => NOTIFY.items.push({ part: part, name: x.name, title: x.title, body: x.body }));
        if (!j.notifyToken && (j.pending || []).length) NOTIFY.noPush = true;   // 푸시가 꺼져 있으면 토큰이 안 온다
        // 반영된 뒤에는 배치표가 그 내용을 들고 있다 — 테스트판의 실제 축은 비운다(예상 배치는 남긴다).
        await fetch(apiUrl('/api/daejo-reset'), {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ date: DATE, part: part, axis: 'real' }),
        }).catch(() => {});
        // 이제 이 부는 배치표가 곧 화면이다 — 기준선을 여기로 옮겨 두 번 보내지 않게 한다.
        unmarkEdited(part);
        setBaseline(part, (teeV.real[part] || []).concat(p.interns.map((t) => ({ time: t.time, course: t.course }))),
          { real: teeV.real[part] });
      }
      NOTIFY.at = Date.now();
      if (npick && !npick.hidden) npLoad(npPart);      // 열려 있던 대상판은 방금 반영으로 낡았다
      const n = NOTIFY.items.length;
      // ★무엇이 실제로 나갔는지 그대로 말한다. '반영했습니다'만 남기면 알림이 갔는지 안 갔는지
      //  관리자가 알 방법이 없고, 그러면 확인차 한 번 더 눌러 같은 알림을 또 보내게 된다.
      const auto = AUTO.map((a) => {
        const p = a.part + '부';
        if (a.held) return `${p} 자동발송 멈춤(${a.reason})`;
        if (!a.on) return `${p} 자동발송 꺼짐`;
        const bits = [];
        if (a.sent) bits.push(`${a.sent}명 보냄`);
        if (a.queued) bits.push(`${a.queued}명 아침대기(조용시간)`);
        if (a.skipped) bits.push(`${a.skipped}명 이미 알림`);
        return `${p} ${bits.join(' · ') || '보낼 사람 없음'}`;
      }).join(' · ');
      state.textContent = `앱에 반영했습니다 — ${done.join(' · ') || '변경 없음'}`
        + (auto ? ` · 자동알림 ${auto}` : '')
        + (n ? ` · 남은 ${n}명은 ‘정정 알림 보내기’로 보낼 수 있습니다` : '');
    } catch (err) { state.textContent = '반영 실패: ' + err.message; }
    finally { applyBtn.disabled = false; stack.length = 0; paintNotify(); PARTS.forEach(paint); }
  });

  // 실제 판독으로 되돌리기 — 테스트판을 버린다.
  resetBtn.addEventListener('click', async () => {
    if (!live) { state.textContent = '샘플에서는 초기화할 수 없습니다.'; return; }
    if (!confirm('테스트판을 버리고 실제 판독 그대로 되돌립니다. 계속할까요?')) return;
    resetBtn.disabled = true;
    try {
      const r = await fetch(apiUrl('/api/daejo-reset'), {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: DATE }),
      });
      const j = await r.json(); if (!j.ok) throw new Error(j.error || '초기화 실패');
      state.textContent = '초기화했습니다 — 새로고침합니다.';
      location.reload();
    } catch (err) { state.textContent = '초기화 실패: ' + err.message; resetBtn.disabled = false; }
  });

  // 한 부를 지금의 서버 값으로 다시 세운다 — 처음 켤 때와 갱신할 때가 같은 길을 쓴다.
  function seat(p) {
    const teams = (teeOrig[p] || []).filter(Boolean).map((t) => ({ time: t.time, course: t.course }));
    ((BOARD[p] || {}).boardInternTees || []).forEach((t) => teams.push({ time: toHM(toMin(t.time)), course: /IN/i.test(t.course) ? 'IN' : 'OUT' }));
    // 실제 축만 깔아준다 — 테스트판에 저장해둔 배치가 있으면 그게 기준선이다.
    //  예상 축은 넘기지 않는다: 켤 때마다 지금의 실제 배치표 ∪ 지금의 카카오로 새로 계산한다.
    setBaseline(p, teams, { real: (teeOrig[p] || []).filter(Boolean).map(cp) });
  }

  // ── 살아 있는 화면 ──────────────────────────────────────────────────
  //  카카오는 계속 돈다. 화면을 열어둔 채로도 따라가야 '실시간'이다.
  //  ★단 하나의 규칙: 고치는 중에는 절대 건드리지 않는다. 손대고 있는 화면이 발밑에서
  //   바뀌면 하던 일이 통째로 날아간다 — 그건 안 따라가는 것보다 나쁘다.
  const POLL_MS = 60000;
  const slotKeys = (a) => (a || []).map((s) => K(s.time, s.course)).sort().join(',');
  const sigOf = (b) => JSON.stringify([(b.roster || []), slotKeys(b.teeGrid), slotKeys(b.internTees), slotKeys(b.kakaoSlots), b.cut || 0]);
  const busy = () => !!mode || !!pick || stack.length > 0 || PARTS.some(changed);
  const newSlots = (was, now) => {
    const a = new Set((was || []).map((s) => K(s.time, s.course)));
    return (now || []).map((s) => K(s.time, s.course)).filter((k) => !a.has(k));
  };
  let polling = false, lastNote = '';
  async function refresh(force) {
    if (!live || polling || (!force && busy())) return;
    polling = true;
    try {
      const q = apiUrl('/api/daejo-data') + (apiUrl('').includes('?') ? '&' : '?') + 'date=' + encodeURIComponent(DATE);
      const j = await (await fetch(q, { credentials: 'include' })).json();
      if (!j.ok || j.dateKey !== DATE || !j.parts) return;      // 다른 날짜를 보고 있으면 손대지 않는다
      if (busy()) return;                                        // 기다리는 사이에 손을 댔을 수도 있다
      const notes = [];
      for (const p of PARTS) {
        const nb = { ...(j.parts[p] || {}), kakaoSlots: ((j.snap || {}).byPart || {})[p] || [] };
        const ob = BOARD[p] || {};
        if (!(nb.roster || []).length || sigOf(nb) === sigOf(ob)) continue;
        const gotKakao = newSlots(ob.kakaoSlots, nb.kakaoSlots);
        const gotBoard = newSlots(ob.teeGrid, nb.teeGrid);
        BOARD[p] = nb;
        roster[p] = (nb.roster || []).slice();
        interns[p] = new Set((nb.internTees || []).map((t) => K(t.time, t.course)));
        const t = []; (nb.teeGrid || []).forEach((g) => { t[Number(g.pos) - 1] = { time: g.time, course: /IN/i.test(g.course) ? 'IN' : 'OUT' }; });
        teeOrig[p] = t;
        seat(p);
        if (gotBoard.length) notes.push(`${p}부 배치표 +${gotBoard.length}팀(${gotBoard.map((k) => k.replace('|', ' ')).join(' ')})`);
        else if (gotKakao.length) notes.push(`${p}부 카카오 +${gotKakao.length}칸(${gotKakao.slice(0, 3).map((k) => k.replace('|', ' ')).join(' ')})`);
        else notes.push(`${p}부 바뀜`);
      }
      SB_EDITED.length = 0; ((j.sandbox || {}).edited || []).forEach(markEdited);
      if (notes.length) {
        PARTS.forEach(paint);
        const now = new Date();
        lastNote = `${pad(now.getHours())}:${pad(now.getMinutes())} 갱신 — ${notes.join(' · ')}`;
        state.textContent = lastNote;
      }
    } catch { /* 조용히 넘어간다 — 갱신 실패가 편집을 방해하면 안 된다 */ }
    finally { polling = false; }
  }


  // ── 하루치 운영 선언 ── 그날 이 부가 몇 시부터 몇 시까지, 몇 코스로 도는가.
  //
  //  ★이건 테스트판이 아니다 — 카카오 엔진이 곧바로 이 값을 읽는다. 그게 이 버튼의 목적이다.
  //   8/18 원웨이(OUT 한 코스만 운영)에 엔진은 IN 24칸을 통째로 '찼다'고 읽었고, 배치표 13팀이
  //   39팀으로 부풀었다. 증거가 쌓여 스스로 풀리기까지 반나절이 걸렸는데, 관리자는 아침에 이미 알았다.
  //   시각 늘리기도 같다 — 예약팀이 앞으로 한 칸 더 열면(3부 16:25) 격자에 그 칸이 아예 없어서
  //   팀을 손으로 넣을 자리조차 없었다.
  //
  //  ★그래서 두 가지를 지킨다.
  //   ① 저장 안 한 편집이 있으면 받지 않는다 — 선언은 격자를 다시 그리므로(새로고침) 편집이 날아간다.
  //   ② 원웨이는 한 번 묻는다 — 그 부의 반쪽을 판정에서 통째로 빼는 일이다.
  const FRAME = window.__DAEJO_FRAME || {};
  const CAD = Number(window.__DAEJO_CAD) || 7;
  const pctlBtns = () => [...document.querySelectorAll('.pctl button')];
  async function declare(part, body, what) {
    if (!live) { state.textContent = '샘플에서는 선언할 수 없습니다 — 모니터의 /daejo 에서 열어주세요.'; return; }
    if (anyChanged()) {
      state.textContent = '저장 안 한 편집이 있습니다 — 먼저 저장하거나 되돌린 뒤에 ' + what + '를 바꿔주세요(선언은 화면을 다시 그립니다).';
      return;
    }
    pctlBtns().forEach((b) => { b.disabled = true; });
    state.textContent = part + '부 ' + what + ' 반영 중…';
    try {
      const r = await fetch(apiUrl('/api/daejo-frame'), {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ date: DATE, part: part }, body)),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || '실패');
      state.textContent = part + '부 ' + what + ' 반영됨 — 다시 그립니다.';
      location.reload();
    } catch (err) {
      pctlBtns().forEach((b) => { b.disabled = false; });
      state.textContent = part + '부 ' + what + ' 실패: ' + err.message;
    }
  }
  // 시각 늘리기·줄이기 — 격자 간격(7분)의 배수로만 움직인다. 격자를 벗어난 시각은
  //  '오늘의 사정'이 아니라 기준표가 틀렸다는 뜻이라, 그건 config/를 고쳐야 한다.
  document.querySelectorAll('.pctl button[data-fr]').forEach((b) => {
    b.addEventListener('click', () => {
      const box = b.closest('.pctl'); if (!box) return;
      const part = box.dataset.p, which = b.dataset.fr;
      const cell0 = box.querySelector('b[data-fv="' + which + '"]');
      const m = toMin(cell0 ? cell0.textContent : '');
      if (!Number.isFinite(m)) { state.textContent = '기준 시각을 읽을 수 없습니다.'; return; }
      const next = m + (Number(b.dataset.d) || CAD);
      const body = {}; body[which] = toHM(next);
      declare(part, body, (which === 'first' ? '첫' : '마지막') + ' 티오프 ' + toHM(next));
    });
  });
  // 격자 밖 칸 끼워넣기·빼기 — 7분 배수가 깨지는 날(예약팀이 팀을 하나 더 받으려고 칸을 끼운 날).
  document.querySelectorAll('.pctl button[data-ins]').forEach((b) => {
    b.addEventListener('click', () => {
      const part = b.dataset.ins;
      const box = b.closest('.pctl');
      const lo = box.querySelector('b[data-fv="first"]').textContent.trim();
      const hi = box.querySelector('b[data-fv="last"]').textContent.trim();
      const v = prompt([part + '부에 끼워넣을 칸 (' + lo + '~' + hi + ' 사이)',
        '예: 17:30 OUT   ·   17:30 IN'].join(String.fromCharCode(10)), '');
      if (v == null) return;
      const m = String(v).match(/(\d{1,2}:\d{2})\s*(IN|OUT|인|아웃)?/i);
      if (!m) { state.textContent = '시각을 못 알아들었습니다 — 17:30 OUT 처럼 적어주세요.'; return; }
      const course = /IN|인/i.test(m[2] || '') ? 'IN' : 'OUT';
      declare(part, { slot: m[1] + '|' + course, on: true }, '칸 ' + m[1] + ' ' + course + ' 끼워넣기');
    });
  });
  document.querySelectorAll('.pctl button[data-del]').forEach((b) => {
    b.addEventListener('click', () => {
      const part = b.dataset.del, k = b.dataset.k;
      if (!confirm(part + '부에서 ' + k.replace('|', ' ') + ' 칸을 뺍니다. 계속할까요?')) return;
      declare(part, { slot: k, on: false }, '칸 ' + k.replace('|', ' ') + ' 빼기');
    });
  });

  // 투웨이 ↔ 원웨이 — 세 상태를 한 버튼이 돈다. 기본은 투웨이다.
  document.querySelectorAll('.pctl button[data-ow]').forEach((b) => {
    b.addEventListener('click', () => {
      const part = b.dataset.ow;
      const cur = String((FRAME[part] || {}).oneway || '');
      const next = cur === '' ? 'OUT' : (cur === 'OUT' ? 'IN' : '');
      const label = next ? '원웨이 ' + next + '만' : '투웨이';
      const NL = String.fromCharCode(10);
      const msg = next
        ? [part + '부를 오늘 ' + label + '으로 선언합니다.', '',
           (next === 'OUT' ? 'IN' : 'OUT') + ' 코스는 오늘 안 도는 것으로 봅니다 — 그 코스의 칸은 팀 0이 되고,',
           '카카오가 안 뜬다고 본 것도 예약이 아니라 미운영으로 읽습니다.', '', '계속할까요?'].join(NL)
        : part + '부를 오늘 투웨이(기본)로 되돌립니다. 계속할까요?';
      if (!confirm(msg)) return;
      declare(part, { oneway: next }, label);
    });
  });
  // 선언 거두기 — 기본틀 그대로.
  document.querySelectorAll('.pctl button[data-rev]').forEach((b) => {
    b.addEventListener('click', () => {
      const part = b.dataset.rev;
      if (!confirm(part + '부의 오늘 선언(시각·원웨이)을 모두 거두고 기본틀로 되돌립니다. 계속할까요?')) return;
      declare(part, { reset: 1 }, '기본틀 복귀');
    });
  });


  // ── 알림 대상 고르기 ── 전체에게든 한 사람에게든, 누가 받는지 눈으로 보고 손으로 고른다.
  //
  //  ★정정 알림과 무엇이 다른가 — 보내는 '글'이 다르다.
  //   정정 알림 = 무엇이 어떻게 바뀌었나(17:42 → 17:49). 반영 직후에만 만들 수 있다.
  //   여기      = 지금 그 회원의 상태가 무엇인가(근무·티오프·순번 / 스페어 / 휴무).
  //   그래서 둘을 한 버튼으로 합치지 않는다. 합치면 둘 중 하나는 반드시 틀린 글이 된다.
  //
  //  ★목록을 그리는 것도 글을 짓는 것도 서버다(board-notify-candidates). 화면이 다시 지으면
  //   보여준 글과 나가는 글이 갈라진다 — 그러면 확인이 확인이 아니다.
  //  ★'바뀐 사람'도 서버가 표시한다(그 배치표 잠금이 걸린 회원). 화면이 다시 세지 않는다.
  const npick = document.getElementById('npick');
  const pickBtn = document.getElementById('pickBtn');
  const npList = document.getElementById('npList');
  const npCount = document.getElementById('npCount');
  const npParts = document.getElementById('npParts');
  const npSend = document.getElementById('npSend');
  let npPart = '3', npCands = [];

  function npPaintCount() {
    const sel = npList.querySelectorAll('input:checked').length;
    npCount.textContent = npCands.length ? `${npCands.length}명 중 ${sel}명 선택` : '';
    npSend.disabled = !sel;
    npSend.textContent = sel ? `${sel}명에게 보내기` : '보내기';
  }
  function npPaint() {
    npList.innerHTML = '';
    if (!npCands.length) {
      const d = document.createElement('div');
      d.className = 'nempty';
      d.textContent = npPart + '부에 알릴 회원이 없습니다 — 이 부의 명단에 우리 회원이 없거나 배치표가 아직 없습니다.';
      npList.appendChild(d);
      npPaintCount();
      return;
    }
    for (const c of npCands) {
      const row = document.createElement('label');
      row.className = 'nrow' + (c.sel ? ' chg' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = String(c.id); cb.checked = !!c.sel;
      cb.addEventListener('change', npPaintCount);
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
      const bd = document.createElement('span'); bd.className = 'bd'; bd.textContent = c.body;
      row.appendChild(cb); row.appendChild(nm); row.appendChild(bd);
      npList.appendChild(row);
    }
    npPaintCount();
  }
  async function npLoad(part) {
    npPart = String(part);
    [...npParts.querySelectorAll('button')].forEach((b) => b.classList.toggle('on', b.dataset.np === npPart));
    npList.innerHTML = '<div class="nempty">불러오는 중…</div>';
    npCands = [];
    try {
      const q = apiUrl('/api/board-notify-candidates') + (apiUrl('').includes('?') ? '&' : '?') + 'part=' + encodeURIComponent(npPart);
      const j = await (await fetch(q, { credentials: 'include' })).json();
      if (!j.ok) throw new Error(j.error || '목록 실패');
      npCands = j.candidates || [];
    } catch (err) { npList.innerHTML = ''; state.textContent = '알림 대상 목록 실패: ' + err.message; }
    npPaint();
  }
  PARTS.slice().reverse().forEach((p) => {          // 3·2·1 — 이 화면의 주인공은 3부다
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.np = p; b.textContent = p + '부';
    b.addEventListener('click', () => npLoad(p));
    npParts.appendChild(b);
  });
  if (pickBtn) pickBtn.addEventListener('click', () => {
    if (!live) { state.textContent = '샘플에서는 대상을 불러올 수 없습니다 — 모니터의 /daejo 에서 열어주세요.'; return; }
    if (npick.hidden) { npick.hidden = false; npLoad(npPart); npick.scrollIntoView({ block: 'nearest' }); }
    else npick.hidden = true;
  });
  document.getElementById('npClose').addEventListener('click', () => { npick.hidden = true; });
  npick.querySelectorAll('button[data-npsel]').forEach((b) => b.addEventListener('click', () => {
    const how = b.dataset.npsel;
    npList.querySelectorAll('input').forEach((cb, i) => {
      cb.checked = how === 'all' ? true : how === 'none' ? false : !!(npCands[i] || {}).sel;
    });
    npPaintCount();
  }));
  npSend.addEventListener('click', async () => {
    const boxes = [...npList.querySelectorAll('input:checked')];
    if (!boxes.length) { state.textContent = '받을 회원을 골라주세요.'; return; }
    const ids = boxes.map((b) => Number(b.value));
    const picked = npCands.filter((c) => ids.includes(c.id));
    const NL = String.fromCharCode(10);
    const msg = [`${npPart}부 회원 ${picked.length}명에게 지금 상태를 알립니다. 보낸 알림은 거둘 수 없습니다.`, '']
      .concat(picked.map((c) => `· ${c.name} — ${c.body}`)).concat(['', '보낼까요?']).join(NL);
    if (!confirm(msg)) return;
    npSend.disabled = true;
    state.textContent = '알림 보내는 중…';
    try {
      const r = await fetch(apiUrl('/api/board-notify-adhoc'), {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ part: npPart, ids: ids }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || '발송 실패');
      state.textContent = `${npPart}부 알림을 보냈습니다 — ${j.sent}/${ids.length}명`;
      npick.hidden = true;
    } catch (err) { state.textContent = '알림 실패: ' + err.message; }
    finally { npSend.disabled = false; npPaintCount(); }
  });

  // 시작 — 실제 팀 = 배치표 격자 + 사진이 읽은 인턴 칸. 기준선을 세우면 두 보기가 함께 계산된다.
  PARTS.forEach(seat);
  tools.hidden = false;
  PARTS.forEach(paint);
  if (!live) state.textContent = '샘플(파일) — 눌러서 동작만 보실 수 있고 저장은 안 됩니다. 실제 저장은 모니터 /daejo.';
  if (live) {
    setInterval(refresh, POLL_MS);
    // 폰은 화면을 끄면 타이머가 멈춘다 — 돌아왔을 때 낡은 화면을 보여주지 않으려면 그때 한 번 더 본다.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    if (window.addEventListener) window.addEventListener('focus', () => refresh());
    window.__daejoRefresh = refresh;   // 실브라우저 검증에서 기다리지 않고 바로 돌려보기 위한 손잡이
  }
})();
