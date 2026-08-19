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
    crew: '아래 서랍에서 사람을 눌러 고르고, 상태(스페어·휴무·휴가·병가)를 정해 한 번에 넣습니다. 표의 칸으로 끌어다 놓으면 그 순번에 바로 들어갑니다. 명단에 있는 사람을 누르면 빼거나 근태를 정합니다.',
    swap: '두 칸을 차례로 눌러 두 사람을 맞바꿉니다(대바). 다른 부의 칸을 골라도 됩니다 — 그러면 두 사람이 부를 맞바꿉니다. 순번↔이름만 바뀌고 티오프는 자리에 그대로 남습니다.',
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
  // ── 근태(휴무·휴가·병가) ── 배치표의 세 번째 축이다.
  //  ★순번↔이름, 순번↔티오프에 이어 '이름↔근태'가 있다. 명단에 이름은 있는데 그날 안 나오는 사람.
  //   대조판은 이 축을 아예 안 들고 있었다. 그래서 휴무자가 스페어로 보였고, 반영하면 근태가 지워졌다
  //   (board-correct는 rows[].duty가 비면 '근태 해제'로 읽는다 — 안 보내는 것과 지우는 것이 같았다).
  //  ★키는 이름이다(공백 뺀). crewDuty가 그렇게 생겼고, 두 곳이 같은 키를 써야 갈라지지 않는다.
  const duty = {}, dutyOrig = {};
  for (const p of PARTS) {
    duty[p] = { ...((BOARD[p] || {}).crewDuty || {}) };
    dutyOrig[p] = { ...duty[p] };
  }
  const DUTIES = ['휴무', '휴가', '병가'];
  // ★crewDuty는 근태만 담는 칸이 아니다 — 실데이터 분포: 휴무 12 · 휴가 3 · 병가 1 ·
  //  '3부' 20 · '1,3' 13 · 54h 2 · 배치 2 · 선발 1 · 당번 1.
  //  타부 근무 코드까지 근태로 읽으면 스무 명이 통째로 '휴무'가 된다(실제로 그렇게 보였다).
  //  판정 규칙은 서버(boardcorrect.mjs)와 같은 것을 쓴다 — 다르면 화면과 저장이 갈라진다.
  const nkd = (x) => String(x || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim();
  const DUTY_RE = /휴무|휴가|병가|격리|연차|반차|월차/;
  const dutyOf = (part, name) => { const v = String(duty[part][nkd(name)] || ''); return DUTY_RE.test(v) ? v : ''; };
  const touchedDuty = {};                            // 부 → 관리자가 근태를 실제로 만진 이름들
  for (const p of PARTS) touchedDuty[p] = new Set();
  const setDuty = (part, name, d) => {
    const k = nkd(name); if (!k) return;
    touchedDuty[part].add(k);
    if (d) { duty[part][k] = d; return; }
    // ★비울 때는 근태만 지운다. '1,3'·'54h' 같은 타부 근무 코드는 근태가 아니라 그 사람의 근무 사실이다.
    if (DUTY_RE.test(String(duty[part][k] || ''))) duty[part][k] = '';
  };
  const dutySame = (a2, b2) => {
    const only = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => DUTY_RE.test(String(v || ''))));
    const A = only(a2), B = only(b2), ka = Object.keys(A), kb = Object.keys(B);
    return ka.length === kb.length && ka.every((k) => A[k] === B[k]);
  };

  // 인턴이 차지한 티오프(부별). 이 칸은 순번을 안 먹는다.
  const interns = {}, internsOrig = {};
  for (const p of PARTS) {
    const s = new Set(((BOARD[p] || {}).internTees || []).map((t) => K(t.time, t.course)));
    interns[p] = s; internsOrig[p] = new Set(s);
  }
  // ── 부 간 맞바꾸기 자국 ── 어느 자리에 '다른 부에서 온 사람'이 앉아 있는지.
  //  ★이 표시가 없으면 3부 표에 낯선 이름이 하나 나타난 것으로만 보인다. 어디서 왔는지를
  //   화면이 말하지 않으면 관리자는 그게 대바인지 판독 오류인지 구분할 방법이 없다.
  //  ★키는 순번이 아니라 '이름'이다. 자국은 자리가 아니라 사람에게 붙는다 — 그래야 캐디를
  //   넣고 빼서 뒤 순번이 통째로 밀려도, 다시 맞바꿔도 자국이 엉뚱한 사람에게 옮겨가지 않는다.
  const crossMark = {};                       // 부 → Map(이름 → 어느 부에서 왔나)
  for (const p of PARTS) crossMark[p] = new Map();
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
    dutyOrig[p] = { ...duty[p] }; touchedDuty[p].clear();   // 기준선을 새로 잡으면 만진 표시도 지운다
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
    || !dutySame(duty[p], dutyOrig[p])
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
      // 부 간 대바 자국 — 이 자리에 앉은 사람이 어느 부에서 왔는지.
      const from = crossMark[part].get(nkd(cell));
      let xp = td.querySelector('.xp');
      if (from) {
        if (!xp) { xp = document.createElement('span'); xp.className = 'xp'; td.appendChild(xp); }
        xp.textContent = from + '부↔'; xp.title = from + '부에서 대바로 온 사람입니다';
      } else if (xp) xp.remove();
      td.classList.toggle('xswap', !!from);
      td.classList.toggle('duty', !!dutyOf(part, cell));   // 근무 자리에 휴무가 앉아 있으면 눈에 띄어야 한다
      const nameChanged = cell !== (rosterOrig[part][pos - 1] || '');
      const teeChanged = !sameTee(tee[part][pos - 1], teeOrig[part][pos - 1]);
      td.classList.toggle('edited', nameChanged);
      td.classList.toggle('moved', teeChanged && !nameChanged);
    });
    paintSpares(part);
    paintOffs(part);
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
      if (dutyOf(part, cell)) continue;      // 근태자는 아래 근태 칸에 따로 선다 — 스페어가 아니다
      const tg = tagOf(cell);
      const ch = document.createElement('span');
      ch.className = 'sp' + (cell !== (rosterOrig[part][p - 1] || '') ? ' edited' : '');
      ch.dataset.p = part; ch.dataset.pos = String(p);
      const b = document.createElement('b'); b.textContent = p + '번'; ch.appendChild(b);
      const n = document.createElement('span'); n.className = 'nm'; n.textContent = bare(cell); ch.appendChild(n);
      if (tg) { const d = document.createElement('span'); d.className = 'dt'; d.textContent = tg; ch.appendChild(d); }
      const xf = crossMark[part].get(nkd(cell));
      if (xf) { ch.classList.add('xswap'); const x2 = document.createElement('span'); x2.className = 'xp'; x2.textContent = xf + '부↔'; ch.appendChild(x2); }
      const dy = dutyOf(part, cell);
      if (dy) { ch.classList.add('duty'); const e2 = document.createElement('span'); e2.className = 'dy'; e2.textContent = dy; ch.appendChild(e2); }
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
  // ── 근태 칸 ── 휴무·휴가·병가. 스페어와 섞지 않는다.
  //  ★그날 안 나오는 사람과 대기하는 사람은 하는 일이 정반대다. 같은 줄에 순번을 달고 섞여 있으면
  //   순서를 만질 때 반드시 헷갈린다(사용자 지적). 칸을 나누는 것만으로 그 실수가 사라진다.
  //  ★순번은 그대로 들고 있는다 — 배치표 명단에서 자리를 차지하는 건 사실이기 때문이다.
  //   다만 그 자리를 '대기 줄'로 보여주지 않을 뿐이다.
  //  ★근태는 순번 명단과 별개 축이다. 실측(8/19 서버): 3부 근태 17명 중 명단에 있는 사람 0명 —
  //   휴무자는 배치표 순번 명단에 아예 없고 근태칸에만 적힌다. 그래서 명단을 훑어서는 한 명도 못 찾는다.
  //   근태 칸은 crewDuty 지도를 그대로 그린다. 명단에 있으면 순번을 같이 보여줄 뿐이다.
  function paintOffs(part) {
    const box = document.querySelector('.offs[data-p="' + part + '"]');
    if (!box) return;
    const posOf = {};
    for (let p = 1; p <= roster[part].length; p++) { const k = nkd(roster[part][p - 1]); if (k) posOf[k] = p; }
    const byDuty = {}; DUTIES.forEach((d2) => (byDuty[d2] = []));
    for (const [k, v] of Object.entries(duty[part] || {})) {
      const v2 = String(v || '');
      if (!DUTY_RE.test(v2)) continue;
      const lane = DUTIES.find((x) => v2.includes(x)) || DUTIES[0];
      byDuty[lane].push({ name: k, pos: posOf[k] || 0 });
    }
    for (const d2 of DUTIES) byDuty[d2].sort((a2, b2) => (a2.pos || 999) - (b2.pos || 999) || (a2.name < b2.name ? -1 : 1));
    const total = DUTIES.reduce((a2, d2) => a2 + byDuty[d2].length, 0);
    if (!total && mode !== 'crew') { box.hidden = true; return; }
    box.innerHTML = '';
    const lb = document.createElement('span');
    lb.className = 'lb';
    lb.textContent = '근태 ' + total + '명 — 끌어다 놓으면 그 상태가 되고, 스페어 줄로 끌면 풀립니다'
      + (mode === 'crew' ? '' : ' (고치려면 ‘캐디 추가·삭제’)');
    box.appendChild(lb);
    for (const d2 of DUTIES) {
      const lane = document.createElement('div');
      lane.className = 'offlane'; lane.dataset.p = part; lane.dataset.off = d2;
      const t = document.createElement('b'); t.textContent = d2; lane.appendChild(t);
      if (!byDuty[d2].length) {
        const n = document.createElement('span'); n.className = 'none';
        n.textContent = mode === 'crew' ? '여기로 끌어다 놓으세요' : '없음';
        lane.appendChild(n);
      }
      for (const x of byDuty[d2]) {
        const c2 = document.createElement('span');
        c2.className = 'offc'; c2.dataset.p = part; c2.dataset.name = x.name;
        if (x.pos) c2.dataset.pos = String(x.pos);
        if (x.pos) { const b2 = document.createElement('b'); b2.textContent = x.pos + '번'; c2.appendChild(b2); }
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = x.name; c2.appendChild(nm);
        lane.appendChild(c2);
      }
      box.appendChild(lane);
    }
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
  // ★고른 사람 · 넣을 상태. 상태는 부와 무관하게 하나만 둔다(한 번에 한 가지를 넣는다).
  //  ★기본을 '스페어'로 두되 통째로 밀어 넣는 버튼은 두지 않는다 —
  //   서랍에 남은 사람은 '오늘 이 부에 안 잡힌 전부'라서 휴무·휴가·병가·다른 부 근무가 섞여 있다.
  //   그걸 한 번에 스페어로 만들면 없는 사실을 지어내는 것이고, 그 거짓이 회원 폰까지 간다.
  const picked = new Set();
  let poolState = '스페어';
  function paintPool(part) {
    const box = document.querySelector('.pool[data-p="' + part + '"]');
    if (!box) return;
    if (mode !== 'crew') { box.hidden = true; picked.clear(); return; }
    const here = placedIn(part);
    // 근태가 붙은 사람은 이미 근태 칸에 서 있다 — 서랍에 또 두면 두 곳에 같은 사람이 보인다.
    const left = OFFICIAL.filter((n) => n && !here.has(nk(n)) && !dutyOf(part, n));
    for (const n of [...picked]) if (here.has(nk(n)) || dutyOf(part, n)) picked.delete(n);
    box.innerHTML = '';
    const lb = document.createElement('span');
    lb.className = 'lb';
    lb.innerHTML = '오늘 ' + part + '부 명단에 없는 캐디 <b>' + left.length + '</b>명 — 눌러 고르고, 상태를 정해 넣습니다';
    box.appendChild(lb);
    // 상태 고르기 — 넣는 사람이 그날 어떤 상태인지는 사람만 안다.
    const seg = document.createElement('span');
    seg.className = 'pseg';
    for (const st of ['스페어', ...DUTIES]) {
      const b2 = document.createElement('button');
      b2.type = 'button'; b2.dataset.pstate = st; b2.textContent = st;
      if (st === poolState) b2.className = 'on';
      seg.appendChild(b2);
    }
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'go'; go.dataset.poolgo = part;
    go.textContent = picked.size ? ('고른 ' + picked.size + '명 ' + poolState + '(으)로 넣기') : '고른 사람 없음';
    go.disabled = !picked.size;
    seg.appendChild(go);
    const clr = document.createElement('button');
    clr.type = 'button'; clr.dataset.poolclr = part; clr.textContent = '고르기 해제';
    if (picked.size) seg.appendChild(clr);
    box.appendChild(seg);
    const wrap = document.createElement('div');
    wrap.className = 'wrap2';
    for (const n of left) {
      const c2 = document.createElement('span');
      c2.className = 'pk' + (picked.has(n) ? ' on' : ''); c2.dataset.p = part; c2.dataset.pool = n;
      c2.textContent = n;
      const el = elsewhere(n);
      if (el.length) { const t = document.createElement('span'); t.className = 'el'; t.textContent = el.join('·') + '부'; c2.appendChild(t); }
      wrap.appendChild(c2);
    }
    box.appendChild(wrap);
    box.hidden = false;
  }

  // 명단에 사람을 넣는다 — 서랍·손입력·끌어놓기가 모두 이 한 곳을 지난다.
  //  ★티오프 배열은 건드리지 않는다. 티오프는 '순번 자리'에 붙어 있어서, 사람이 하나 끼면
  //   뒤가 한 칸씩 밀리며 맨 뒤 근무자가 스페어로 내려간다 — 배치표에서 실제로 일어나는 일이다.
  function addCrew(part, name, at, state) {
    const nm = String(name || '').trim();
    if (!nm) return '';
    const n = roster[part].filter((x) => String(x || '').trim()).length;
    const pos = Math.min(Math.max(1, Number(at) || (n + 1)), n + 1);
    roster[part].splice(pos - 1, 0, nm);
    const st = String(state || '스페어');
    if (DUTIES.includes(st)) setDuty(part, nm, st);
    const work = teeV.real[part].length;
    return part + '부 ' + pos + '번에 ' + nm + ' 넣음'
      + (DUTIES.includes(st) ? ' — ' + st + '(으)로 표시했습니다'
        : (pos <= work ? ' — 뒤 순번이 한 칸씩 밀렸고 맨 뒤 근무자가 스페어로 내려갔습니다' : ' — 스페어로 들어갔습니다'))
      + ' · 명단 ' + n + ' → ' + (n + 1) + '명';
  }

  // ★두 보기의 배치를 모두 담는다. 인턴 하나를 켜면 양쪽 배치가 같이 움직이는데
  //  보고 있던 쪽만 되돌리면 반대편에 인턴이 남아 근무선이 조용히 줄어든다(실측: 1부 42→39).
  //  배치가 진실이 된 이상, 되돌리기도 진실 전부를 되돌려야 한다.
  const snapOf = (part) => ({ part: part, roster: roster[part].slice(),
    tee: { real: (teeV.real[part] || []).map(cp), proj: (teeV.proj[part] || []).map(cp) },
    // 팀 목록도 담는다 — 티오프 추가·삭제가 이걸 바꾸므로 안 담으면 되돌려도 팀이 그대로 남는다.
    occ: { real: (origOcc.real[part] || []).map(cp), proj: (origOcc.proj[part] || []).map(cp) },
    interns: new Set(interns[part]), duty: { ...duty[part] }, touched: new Set(touchedDuty[part]),
    cross: new Map(crossMark[part] || []),
    memo: { real: new Map(idxMemo.real[part] || []), proj: new Map(idxMemo.proj[part] || []) } });
  // ★한 번의 조작이 두 부를 건드릴 수 있다(부 간 맞바꾸기). 되돌리기는 '그 조작 전체'를 되돌려야 한다 —
  //  한 부만 되돌리면 사람이 양쪽에 둘이 되거나 어느 쪽에도 없게 된다.
  const push = (...parts) => { stack.push(parts.map(snapOf)); };

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
  const unit = (el) => (el && el.closest ? (el.closest('td.c') || el.closest('.sp') || el.closest('.pk') || el.closest('.offc')) : null);
  const isPool = (el) => !!(el && el.classList && el.classList.contains('pk'));
  const isOff = (el) => !!(el && el.classList && el.classList.contains('offc'));
  // 놓는 '자리' — 근태 줄과 스페어 줄은 칸이 아니라 구역이다.
  const zoneUnder = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest ? (el.closest('.offlane') || el.closest('.spares')) : null; };
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

  // ── 부 간 맞바꾸기(크로스파트 대바) ──────────────────────────────────
  //  ★대바는 한 부 안에서만 일어나지 않는다(사용자). 3부 사람이 2부 자리를 받고 2부 사람이
  //   3부로 내려오는 일이 실제로 있다. 그때 배치표 두 장이 동시에 바뀐다.
  //  규칙은 부 안 맞바꾸기와 똑같다 — 사람만 자리를 바꾸고, 티오프는 자리에 그대로 남는다.
  //   (그래서 각 부의 순번↔티오프는 한 칸도 안 움직인다. 움직이는 건 순번↔이름뿐이다.)
  //  ★막는 것 셋: 빈 자리 · 근태자 · 그 부에 이미 있는 사람.
  //   특히 마지막이 중요하다 — 이미 2부에 있는 사람을 2부로 또 보내면 한 사람이 두 순번을
  //   차지하고, 그 부 명단이 조용히 한 명 늘어난다.
  function applyCrossSwap(pa, ia, pb, ib) {
    if (pa === pb) return applySwap(pa, ia, ib);
    if (!ia || !ib) return '두 자리 모두 사람이 있어야 부 간 맞바꿈이 됩니다.';
    const A = roster[pa], B = roster[pb];
    const na = String(A[ia - 1] || ''), nb = String(B[ib - 1] || '');
    if (!bare(na) || !bare(nb)) return '두 자리 모두 사람이 있어야 부 간 맞바꿈이 됩니다.';
    // ★같은 사람이다. 두 부에 다 이름이 있는 사람(2·3부 두 탕, (54)·(1,3) 태그)이 실제로 있어서
    //  3부 1번과 2부 1번이 둘 다 표승완인 날이 있다(실측 8/19). 그대로 두면 아무 일도 안 일어나는데
    //  화면은 '맞바꿨습니다'라고 말하고, 반영 목록에는 두 부가 올라간다 — 관리자를 속이는 것이다.
    if (nkd(na) === nkd(nb)) return bare(na) + '은(는) ' + pa + '부와 ' + pb + '부에 다 있는 사람입니다 — 자기 자신과는 맞바꿀 수 없습니다.';
    const da = dutyOf(pa, na), db = dutyOf(pb, nb);
    if (da || db) return (da ? bare(na) : bare(nb)) + '은(는) ' + (da || db) + '입니다 — 근태를 먼저 푸세요.';
    if (B.some((x, i) => i !== ib - 1 && nkd(x) && nkd(x) === nkd(na))) return bare(na) + '은(는) 이미 ' + pb + '부 명단에 있습니다.';
    if (A.some((x, i) => i !== ia - 1 && nkd(x) && nkd(x) === nkd(nb))) return bare(nb) + '은(는) 이미 ' + pa + '부 명단에 있습니다.';
    push(pa, pb);
    A[ia - 1] = nb; B[ib - 1] = na;
    // 자국은 사람에게 붙는다. 되돌아온 사람(원래 자기 부로 복귀)에게는 자국을 지운다.
    const markOrClear = (p, cell, src) => {
      const k = nkd(cell);
      if (((BOARD[p] || {}).roster || []).some((x) => nkd(x) === k)) crossMark[p].delete(k);
      else crossMark[p].set(k, src);
    };
    markOrClear(pa, nb, pb); markOrClear(pb, na, pa);
    paint(pa); paint(pb);
    const seat = (p, i) => { const t = (teeV.real[p] || [])[i - 1]; return t ? t.time + ' ' + t.course : '스페어'; };
    return pa + '부 ' + ia + '번 ' + bare(na) + '(' + seat(pa, ia) + ') ↔ '
      + pb + '부 ' + ib + '번 ' + bare(nb) + '(' + seat(pb, ib) + ') 부 간 맞바꿈'
      + ' · 티오프는 자리에 그대로 · 두 부 모두 반영해야 합니다';
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
    if (mode === 'crew') {
      // 근태 칩·스페어 칩·표의 칸 모두 끌 수 있다 — 끌어서 근태를 주고, 스페어 줄로 끌어서 푼다.
      if (!isOff(td) && !isSpare(td) && !td.dataset.t) return;
      const part1 = td.dataset.p;
      // ★근태 칩은 명단에 없을 수 있다(대부분 없다) — 순번이 아니라 이름으로 잡는다.
      const name1 = isOff(td) ? String(td.dataset.name || '') : '';
      const from1 = posAt(part1, td);
      if (!name1 && !from1) return;
      drag = { td: td, part: part1, from: from1, name: name1, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, crew: true };
      return;
    }
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
      ghost.textContent = drag.pool ? ('＋ ' + drag.pool)
        : drag.name ? drag.name
          : (drag.from + '번 ' + bare(roster[drag.part][drag.from - 1]));
      document.body.appendChild(ghost);
      try { drag.td.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
    e.preventDefault();
    ghost.style.transform = 'translate(' + (e.clientX + 12) + 'px,' + (e.clientY - 14) + 'px)';
    document.querySelectorAll('.drop-to').forEach((x) => x.classList.remove('drop-to'));
    const zone = zoneUnder(e.clientX, e.clientY);
    if (zone && zone.dataset.p === drag.part) { zone.classList.add('drop-to'); return; }
    const over = cellUnder(e.clientX, e.clientY);
    // ★다른 부의 칸도 놓을 자리다 — 맞바꾸기이거나(부 간 대바), 스페어가 낀 경우.
    //  받아주지 않을 자리에 불을 켜면 안 된다: 손가락은 불이 켜진 곳을 믿는다.
    const crossable = mode === 'swap' || drag.spare;
    const okPart = over && (over.dataset.p === drag.part || (crossable && !drag.crew && !drag.pool && over.dataset.p));
    if (over && over !== drag.td && okPart && !over.classList.contains('intern') && !isPool(over)) over.classList.add('drop-to');
  }, { passive: false });
  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (!drag.moved) { dragEnd(true); return; }          // 그냥 탭이었다 — 누르기 처리에 맡긴다
    suppressClick = true;
    const over = cellUnder(e.clientX, e.clientY);
    const d = drag;
    dragEnd(false);
    const zone = zoneUnder(e.clientX, e.clientY);
    // ── 근태 줄에 놓기 = 그 상태로 만들기 · 스페어 줄에 놓기 = 근태 풀기 ──
    //  ★근태는 순번을 주지 않는다. 명단에 없는 사람을 휴무로 놓을 때 명단에 끼워 넣으면
    //   있지도 않은 순번이 생기고 뒤가 통째로 밀린다 — 사용자가 걱정한 그 꼬임이 바로 이것이다.
    //   근태는 '이름 → 상태' 한 장이라 순번과 무관하게 적으면 된다(배치표도 그렇게 생겼다).
    if (zone && zone.dataset.p === d.part) {
      const lane = zone.classList.contains('offlane') ? String(zone.dataset.off || '') : '';
      const name = d.pool || (d.name || bare(roster[d.part][d.from - 1] || ''));
      if (!name) { state.textContent = '이름이 없는 자리입니다.'; return; }
      const was = dutyOf(d.part, name);
      if (lane === was) { state.textContent = `${name}은(는) 이미 ${lane || '스페어'}입니다.`; return; }
      push(d.part);
      setDuty(d.part, name, lane);
      paint(d.part);
      const inRoster = roster[d.part].some((x) => nkd(x) === nkd(name));
      state.textContent = lane
        ? `${name} — ${lane}` + (was ? ` (${was}에서 옮김)` : (inRoster ? ' · 스페어 줄에서 뺐습니다' : ' · 명단 순번은 주지 않았습니다'))
        : `${name} — 근태 해제` + (inRoster ? ', 스페어로 돌아왔습니다' : ', 서랍으로 돌아갔습니다');
      return;
    }
    // ★서랍에서 끌어온 사람 — 놓은 자리가 곧 순번이다. 표 밖(스페어 줄·서랍)에 놓으면 맨 뒤로 간다.
    if (d.pool) {
      const onBoard = over && over.dataset.p === d.part && !isPool(over) && !over.classList.contains('intern');
      const at = onBoard ? posAt(d.part, over) : 0;
      push(d.part);
      const msg = addCrew(d.part, d.pool, at || 0, poolState);
      paint(d.part);
      state.textContent = msg || '넣지 못했습니다.';
      return;
    }
    if (d.crew) { state.textContent = '근태 줄이나 스페어 줄에 놓아주세요.'; return; }
    if (!over || !over.dataset.p || over.classList.contains('intern')) { state.textContent = '취소했습니다.'; return; }
    const toPart = over.dataset.p;
    const to = posAt(toPart, over);
    // ★스페어가 끼면 티오프 이동은 뜻이 없다(가진 티오프가 없다) → 자동으로 맞바꾸기로 처리한다.
    const spareInvolved = d.spare || isSpare(over);
    if (mode === 'swap' || spareInvolved) {
      const msg = to ? applyCrossSwap(d.part, d.from, toPart, to) : '맞바꾸려면 사람이 있는 칸에 놓아주세요.';
      state.textContent = msg + (spareInvolved && mode !== 'swap' ? ' (스페어라 맞바꾸기로 처리했습니다)' : '');
      return;
    }
    if (toPart !== d.part) { state.textContent = '순번 옮기기는 같은 부 안에서만 됩니다 — 부 간 이동은 ‘맞바꾸기’로 하세요.'; return; }
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
    const e0 = stack.pop(); if (!e0) return;
    for (const s of (Array.isArray(e0) ? e0 : [e0])) {
      roster[s.part] = s.roster;
      teeV.real[s.part] = s.tee.real; teeV.proj[s.part] = s.tee.proj;
      origOcc.real[s.part] = s.occ.real; origOcc.proj[s.part] = s.occ.proj;
      interns[s.part] = s.interns; duty[s.part] = s.duty || {}; touchedDuty[s.part] = s.touched || new Set();
      crossMark[s.part] = s.cross || new Map();
      idxMemo.real[s.part] = s.memo.real; idxMemo.proj[s.part] = s.memo.proj;
      paint(s.part);
    }
    state.textContent = '되돌렸습니다.';
  });

  document.addEventListener('click', async (e) => {
    if (suppressClick) { suppressClick = false; return; }   // 방금 끌어놓았다 — 누르기로 두 번 처리하지 않는다
    if (!mode) return;
    // 서랍 조작 — 상태 고르기 · 고른 사람 넣기 · 고르기 해제.
    const btn = e.target && e.target.closest ? e.target.closest('.pool button') : null;
    if (btn && mode === 'crew') {
      if (btn.dataset.pstate) { poolState = btn.dataset.pstate; PARTS.forEach(paintPool); return; }
      if (btn.dataset.poolclr) { picked.clear(); PARTS.forEach(paintPool); return; }
      if (btn.dataset.poolgo) {
        const part0 = btn.dataset.poolgo;
        const list = [...picked];
        if (!list.length) return;
        const asDuty = DUTIES.includes(poolState);
        if (!confirm([part0 + '부 명단에 ' + list.length + '명을 ' + poolState + '(으)로 넣습니다.', '',
          list.slice(0, 15).join(' · ') + (list.length > 15 ? ' 외 ' + (list.length - 15) + '명' : ''), '',
          asDuty ? '근태(' + poolState + ')로 표시되어 티오프를 받지 않습니다.'
                 : '명단 맨 뒤(스페어)로 들어갑니다 — 순번은 넣은 뒤 옮길 수 있습니다.',
          '계속할까요?'].join(String.fromCharCode(10)))) return;
        push(part0);
        const n0 = roster[part0].filter((x) => String(x || '').trim()).length;
        for (const n of list) addCrew(part0, n, 0, poolState);
        picked.clear();
        paint(part0);
        state.textContent = part0 + '부에 ' + list.length + '명을 ' + poolState + '(으)로 넣었습니다 — 명단 ' + n0 + ' → ' + (n0 + list.length) + '명';
        return;
      }
    }
    const td = unit(e.target); if (!td) return;
    // ★서랍 칩을 누르면 '고른다'. 바로 넣지 않는다 —
    //  넣을 상태(스페어·휴무·휴가·병가)를 정하고 한 번에 넣는 게 이 서랍의 요점이다.
    //  끌어다 놓는 건 그 자리에 바로 넣는 것이고(순번을 지정하는 조작), 그건 그대로 둔다.
    if (isPool(td)) {
      if (mode !== 'crew') { state.textContent = '‘캐디 추가·삭제’ 모드에서 넣을 수 있습니다.'; return; }
      const n = td.dataset.pool;
      if (picked.has(n)) picked.delete(n); else picked.add(n);
      paintPool(td.dataset.p);
      state.textContent = picked.size ? (picked.size + '명 고름 — 상태를 정하고 ‘넣기’를 누르세요') : '고르기를 해제했습니다.';
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
      if (!pos0) { state.textContent = '사람이 있는 칸을 눌러주세요.'; return; }
      const cell0 = roster[part0][pos0 - 1] || '';
      const who = bare(cell0);
      if (!who) { state.textContent = '이 칸엔 이름이 없습니다.'; return; }
      // ★빼기와 근태는 다른 일이다. 휴무자를 명단에서 빼면 그 사람은 배치표에서 사라지는데,
      //  실제 배치표는 휴무자도 명단에 두고 근태칸에 적는다. 둘을 한 버튼에 묶으면 반드시 틀린다.
      const now = dutyOf(part0, cell0);
      const pickN = prompt([`${part0}부 ${pos0}번 ${who}` + (now ? ` (지금 ${now})` : ''), '',
        '1 · 명단에서 빼기', '2 · 휴무', '3 · 휴가', '4 · 병가', '5 · 근태 해제(정상 근무/스페어)'].join(String.fromCharCode(10)), '1');
      if (pickN == null) return;
      const choice = String(pickN).trim();
      if (['2', '3', '4', '5'].includes(choice)) {
        const d2 = choice === '5' ? '' : DUTIES[Number(choice) - 2];
        push(part0);
        setDuty(part0, cell0, d2);
        paint(part0);
        state.textContent = `${part0}부 ${pos0}번 ${who} — ${d2 || '근태 해제'}`;
        return;
      }
      if (choice !== '1') { state.textContent = '1~5 중에 골라주세요.'; return; }
      if (!confirm(`${part0}부 ${pos0}번 ${who}을(를) 명단에서 뺍니다. 뒤 순번이 한 칸씩 당겨집니다. 계속할까요?`)) return;
      push(part0);
      setDuty(part0, cell0, '');
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
      if (!pick) { pick = td; td.classList.add('picked'); state.textContent = part + '부 ' + pos + '번 ' + bare(roster[part][pos - 1]) + ' 선택 — 바꿀 상대를 누르세요 (다른 부도 됩니다)'; return; }
      const fromPart = pick.dataset.p;
      const from = posAt(fromPart, pick);
      clearPick();
      // ★부가 달라도 막지 않는다 — 대바는 부를 넘나든다(사용자). 규칙은 같다: 사람만 자리를 바꾼다.
      const msg = applyCrossSwap(fromPart, from, part, pos);
      if (msg) state.textContent = msg + (fromPart === part ? projNote() : '');
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
        const fromP = pick.dataset.p;
        const from0 = posAt(fromP, pick); clearPick();
        if (!pos) { state.textContent = '사람이 있는 자리에 놓아주세요 — 빈 티오프로는 맞바꿀 수 없습니다.'; return; }
        const msg = applyCrossSwap(fromP, from0, part, pos);
        state.textContent = msg ? msg + ' (스페어라 맞바꾸기로 처리했습니다)' : '';
        return;
      }
      if (!pick) {
        if (!pos) { state.textContent = '옮길 사람이 있는 칸을 눌러주세요.'; return; }
        pick = td; td.classList.add('picked');
        state.textContent = part + '부 ' + pos + '번 ' + bare(roster[part][pos - 1]) + ' 선택 — 갈 티오프를 누르세요';
        return;
      }
      // ★순번 옮기기는 티오프표(순번↔티오프)를 만지는 조작이라 부를 넘을 수 없다 — 부마다 티오프표가 다르다.
      //  부를 넘기고 싶으면 그건 '맞바꾸기'다. 막기만 하지 말고 어디로 가야 하는지 말해준다.
      if (pick.dataset.p !== part) { state.textContent = '순번 옮기기는 같은 부 안에서만 됩니다 — 부 간 이동은 ‘맞바꾸기’로 하세요.'; clearPick(); return; }
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
  // ── 부 간 이동을 서버에 '사실'로 알린다 ────────────────────────────────
  //  ★명단에서 빠진 것만으로는 부족하다. 서버는 명단에 없는 회원을 다시 계산하면 '휴무(off)'로 적는데,
  //   3부가 휴무면 대시보드가 그 사람의 1·2부 카드까지 통째로 지운다(primaryOff). 대바로 2부에
  //   간 사람이 앱에서 '오늘 휴무'가 되어버린다 — 정확히 반대의 사실이다.
  //   그래서 '나갔다(movedOut)'를 따로 실어, 서버가 휴무가 아니라 '이 부엔 없음'으로 적게 한다.
  //  ★기준은 BOARD(서버가 지금 들고 있는 명단)다. rosterOrig는 테스트판에 저장하면 갱신되므로
  //   그걸로 재면 이미 저장한 대바가 안 보인다.
  const baseNames = (p) => new Set((((BOARD[p] || {}).roster) || []).map(nkd).filter(Boolean));
  const nowNames = (p) => new Set((roster[p] || []).map(nkd).filter(Boolean));
  function crossMoves(part) {
    const was = baseNames(part), now = nowNames(part);
    const out = [], into = [];
    for (const other of PARTS) {
      if (other === part) continue;
      const wasT = baseNames(other), nowT = nowNames(other);
      for (const n of was) if (!now.has(n) && nowT.has(n) && !wasT.has(n)) out.push({ name: n, to: other });
      for (const n of now) if (!was.has(n) && wasT.has(n) && !nowT.has(n)) into.push({ name: n, from: other });
    }
    return { out: out, into: into };
  }

  function realPayload(part) {
    const real = teeV.real[part] || [];
    const mv = crossMoves(part);
    const teamSet = new Set((origOcc.real[part] || []).map((s) => K(s.time, s.course)));
    return {
      part: part,
      // 이 부에서 다른 부로 대바로 나간 사람 / 다른 부에서 이 부로 들어온 사람.
      movedOut: mv.out, movedIn: mv.into,
      // ★명단 밖 사람의 근태 — rows로는 말할 수 없다(rows는 순번 명단이다). 따로 싣는다.
      dutySet: Object.fromEntries([...touchedDuty[part]].map((k) => [k, String(duty[part][k] || '')])),
      // ★근태는 '내가 만진 사람'만 싣는다.
      //  판독은 배치표 근태칸을 스스로 읽는다(휴무·휴가·병가). 그건 사람보다 정확할 때가 많고,
      //  이 화면이 안 보낸다고 없어져서는 안 된다. 그래서 안 만진 행은 duty 항목 자체를 빼서
      //  서버가 손대지 않게 한다 — '빈 값'과 '항목 없음'은 다르다.
      //  이 화면의 근태 지식이 낡거나 이름 키가 어긋나도, 판독이 잡은 것을 지울 수는 없게 된다.
      rows: roster[part].map((cell, i) => {
        const t = real[i];
        const row = { pos: i + 1, name: String(cell || ''), tee: t ? t.time : '', course: t ? t.course : '' };
        if (touchedDuty[part].has(nkd(cell))) row.duty = dutyOf(part, cell);
        return row;
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
    // ★부 간 대바는 따로 이름을 대고 확인받는다 — 사람이 부를 옮기는 일이고, 두 부의 회원 상태가
    //  동시에 바뀐다. '3부 이름 2칸' 같은 숫자로는 누가 어디로 가는지 알 수 없다.
    const moves = [];
    for (const part of PARTS) {
      if (!touched(part)) continue;
      for (const x of crossMoves(part).out) moves.push(`${x.name} — ${part}부 → ${x.to}부`);
    }
    if (moves.length) lines.push('부 간 대바 ' + moves.length + '명 · ' + moves.join(' · '));
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
        // ★근태도 같이 새로 읽는다. 안 읽으면 판독이 새로 잡은 휴무를 화면이 모르고,
        //  그 상태로 반영하면 낡은 지식이 새 사실을 덮는다(손댄 행만 보내므로 피해는 좁지만,
        //  화면이 틀린 걸 보여주는 것 자체가 다음 실수의 씨앗이다).
        duty[p] = { ...(nb.crewDuty || {}) }; dutyOrig[p] = { ...duty[p] }; touchedDuty[p].clear();
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
