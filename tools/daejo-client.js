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
  const live = location.protocol.startsWith('http');
  const hint = document.getElementById('hint');
  const state = document.getElementById('state');
  const saveBtn = document.getElementById('saveBtn');
  const undoBtn = document.getElementById('undoBtn');
  const HINTS = {
    intern: '칸을 눌러 인턴을 켜고 끕니다. 인턴이 한 팀을 맡으면 그 뒤가 각자 다음 팀으로 밀리고, 맨 뒤 한 명은 스페어로 내려갑니다.',
    name: '칸을 눌러 그 순번의 이름을 고칩니다.',
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
  const tee = {}, teeOrig = {};            // 순번 → {time, course}  (없으면 null = 스페어)
  for (const p of PARTS) {
    const B = BOARD[p] || {};
    roster[p] = (B.roster || []).slice();
    rosterOrig[p] = roster[p].slice();
    const t = [];
    (B.teeGrid || []).forEach((g) => { t[Number(g.pos) - 1] = { time: g.time, course: /IN/i.test(g.course) ? 'IN' : 'OUT' }; });
    tee[p] = t;
    teeOrig[p] = t.map((x) => (x ? { time: x.time, course: x.course } : x));
  }
  // 인턴이 차지한 티오프(부별). 이 칸은 순번을 안 먹는다.
  const interns = {}, internsOrig = {};
  for (const p of PARTS) {
    const s = new Set(((BOARD[p] || {}).internTees || []).map((t) => K(t.time, t.course)));
    interns[p] = s; internsOrig[p] = new Set(s);
  }
  const stack = [];
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
  for (const p of PARTS) {
    allSlots[p] = [...document.querySelectorAll('td.c[data-p="' + p + '"]')]
      .map((td) => ({ time: toHM(toMin(td.dataset.t)), course: /IN/i.test(td.dataset.c) ? 'IN' : 'OUT' }))
      .sort((a, b) => toMin(a.time) - toMin(b.time) || (a.course === 'OUT' ? -1 : 1));
    const sortOcc = (a) => a.sort((x, y) => toMin(x.time) - toMin(y.time) || (x.course === 'OUT' ? -1 : 1));
    // 실제 — 배치표가 준 '팀이 있는 칸'(정규 + 판독된 인턴).
    const occR = (teeOrig[p] || []).filter(Boolean).map((t) => ({ time: t.time, course: t.course }));
    internsOrig[p].forEach((k) => occR.push({ time: k.split('|')[0], course: k.split('|')[1] }));
    origOcc.real[p] = sortOcc(occR);
    // 예상 — 카카오가 찼다고 본 칸까지 합집합.
    const seen = new Set(origOcc.real[p].map((s) => K(s.time, s.course)));
    const occP = origOcc.real[p].map((s) => ({ time: s.time, course: s.course }));
    ((BOARD[p] || {}).kakaoSlots || []).forEach((s) => {
      const k = K(s.time, s.course);
      if (!seen.has(k)) { seen.add(k); occP.push({ time: toHM(toMin(s.time)), course: /IN/i.test(s.course) ? 'IN' : 'OUT' }); }
    });
    origOcc.proj[p] = sortOcc(occP);
  }
  const teeV = { real: {}, proj: {} };
  // 인턴 집합 → 정규 캐디의 티오프 배치. 항상 여기서 다시 만든다.
  //  ★팀 수는 고정이다. 예약이 있는 티오프에만 팀이 있고, 빈 티오프에는 팀이 없다 —
  //   그래서 인턴이 한 팀을 맡으면 정규 캐디가 설 자리가 정확히 하나 줄고,
  //   뒤 사람들은 각자 '다음 팀'으로 밀리다가 맨 뒤 한 명이 스페어로 내려간다.
  //  (한때 빈 티오프를 새로 열어 밀어넣게 만들었는데, 그건 없는 팀을 지어내는 짓이었다.)
  function recompute(part, v) {
    const view0 = v || view;
    const occ = origOcc[view0][part];                       // 팀이 있는 칸 — 늘지도 줄지도 않는다
    teeV[view0][part] = occ.filter((s) => !interns[part].has(K(s.time, s.course)));
    if (view0 === view) tee[part] = teeV[view0][part];
    return { teams: occ.length, work: teeV[view0][part].length };
  }
  function internOn(part, time, course) {
    const key = K(time, course);
    const before = tee[part].filter(Boolean).length;
    const wasPos = tee[part].findIndex((t) => t && K(t.time, t.course) === key) + 1;
    interns[part].add(key);
    const r = recompute(part);
    // 팀 하나를 인턴이 맡았으니 정규 자리가 하나 준다 — 맨 뒤 한 명이 스페어로 내려간다.
    const dropped = before - tee[part].filter(Boolean).length;
    const who = dropped > 0 ? bare(roster[part][before - 1] || '') : '';
    return { fromPos: wasPos, dropped: dropped, who: who };
  }
  function internOff(part, time, course) {
    interns[part].delete(K(time, course));
    recompute(part);
    return { toPos: tee[part].findIndex((t) => t && K(t.time, t.course) === K(time, course)) + 1 };
  }
  const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const changed = (p) => roster[p].some((x, i) => (x || '') !== (rosterOrig[p][i] || ''))
    || !setEq(interns[p], internsOrig[p])
    || (teeV.real[p] || []).some((x, i) => !sameTee(x, teeOrig[p][i]))
    || (teeV.real[p] || []).length !== (teeOrig[p] || []).filter(Boolean).length;

  const shot = new Map();
  document.querySelectorAll('td.c').forEach((td) => { shot.set(td, { html: td.innerHTML, cls: td.className }); });
  function restoreView() {
    shot.forEach((v, td) => { td.innerHTML = v.html; td.className = v.cls; });
  }
  const anyChanged = () => PARTS.some(changed);

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
      // 투영에서 온 색(fresh 등)을 걷어내고 실제 배치표 기준으로 다시 칠한다.
      td.className = 'c ok';
      const cell = roster[part][pos - 1] || '';
      if (!pe) { pe = document.createElement('span'); pe.className = 'pos'; td.appendChild(pe); }
      if (!nm) { nm = document.createElement('span'); nm.className = 'nm'; td.appendChild(nm); }
      pe.textContent = String(pos);
      nm.textContent = bare(cell);
      const tg = tagOf(cell);
      if (tg && !dt) { dt = document.createElement('span'); dt.className = 'dt'; td.appendChild(dt); }
      if (dt) { dt.textContent = tg; dt.style.display = tg ? '' : 'none'; }
      const nameChanged = cell !== (rosterOrig[part][pos - 1] || '');
      const teeChanged = !sameTee(tee[part][pos - 1], teeOrig[part][pos - 1]);
      td.classList.toggle('edited', nameChanged);
      td.classList.toggle('moved', teeChanged && !nameChanged);
    });
    paintSpares(part);
    saveBtn.hidden = !PARTS.some(changed);
    undoBtn.hidden = !stack.length;
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
    if (!out.length) { box.hidden = true; return; }
    const lb = document.createElement('span');
    lb.className = 'lb'; lb.textContent = '스페어 ' + out.length + '명 — 티오프 없음(끌어다 근무자와 맞바꿀 수 있습니다)';
    box.appendChild(lb);
    out.forEach((x) => box.appendChild(x));
    box.hidden = false;
  }
  const push = (part) => {
    stack.push({ part: part, roster: roster[part].slice(),
      tee: tee[part].map((x) => (x ? { time: x.time, course: x.course } : x)),
      interns: new Set(interns[part]) });
  };

  let mode = '', pick = null, view = 'proj';
  const clearPick = () => { if (pick) pick.classList.remove('picked'); pick = null; };
  // 칸(td.c)이든 스페어 칩(span.sp)이든 '어느 부 몇 번인가'를 같은 식으로 답한다.
  const posAt = (part, el) => {
    if (!el) return 0;
    if (el.dataset && el.dataset.pos) return Number(el.dataset.pos) || 0;   // 스페어 칩
    const at = new Map();
    tee[part].forEach((t, i) => { if (t) at.set(K(t.time, t.course), i + 1); });
    return at.get(K(el.dataset.t, el.dataset.c)) || 0;
  };
  const unit = (el) => (el && el.closest ? (el.closest('td.c') || el.closest('.sp')) : null);
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
    if (mode !== 'swap' && mode !== 'move') return;
    if (e.button != null && e.button > 0) return;
    const td = unit(e.target);
    if (!td || td.classList.contains('intern')) return;
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
      ghost.textContent = drag.from + '번 ' + bare(roster[drag.part][drag.from - 1]);
      document.body.appendChild(ghost);
      try { drag.td.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
    e.preventDefault();
    ghost.style.transform = 'translate(' + (e.clientX + 12) + 'px,' + (e.clientY - 14) + 'px)';
    document.querySelectorAll('.drop-to').forEach((x) => x.classList.remove('drop-to'));
    const over = cellUnder(e.clientX, e.clientY);
    if (over && over !== drag.td && over.dataset.p === drag.part && !over.classList.contains('intern')) over.classList.add('drop-to');
  }, { passive: false });
  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (!drag.moved) { dragEnd(true); return; }          // 그냥 탭이었다 — 누르기 처리에 맡긴다
    suppressClick = true;
    const over = cellUnder(e.clientX, e.clientY);
    const d = drag;
    dragEnd(false);
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
    if (msg) state.textContent = msg;
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
  const NOTE_PROJ = '사진 판독 위에 카카오 예약을 겹친 <b>예상</b> 배치표입니다. 여기서도 고칠 수 있습니다.';
  const NOTE_REAL = '사진이 <b>실제로 읽은</b> 배치표입니다. 카카오 예상 칸은 빠지고 순번도 원래대로예요.';
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
    PARTS.forEach((p) => { recompute(p, v); paint(p); });
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
  }
  document.querySelectorAll('.tools button[data-mode]').forEach((b) => {
    b.addEventListener('click', () => setMode(mode === b.dataset.mode ? '' : b.dataset.mode));
  });
  undoBtn.addEventListener('click', () => {
    const s = stack.pop(); if (!s) return;
    roster[s.part] = s.roster; tee[s.part] = s.tee; interns[s.part] = s.interns; paint(s.part);
    state.textContent = '되돌렸습니다.';
  });

  document.addEventListener('click', async (e) => {
    if (suppressClick) { suppressClick = false; return; }   // 방금 끌어놓았다 — 누르기로 두 번 처리하지 않는다
    if (!mode) return;
    const td = unit(e.target); if (!td) return;
    if (!isSpare(td) && !td.dataset.t) return;

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
      if (msg) state.textContent = msg;
      return;
    }

    // ── 순번 옮기기 — 그 사람의 순번은 그대로, 티오프만 옮긴다.
    //    ★이미 다른 순번이 서 있는 칸으로도 옮길 수 있다. 그 칸 주인과 사이 순번들의 티오프가
    //     한 칸씩 따라 이동한다(티오프 배열을 splice). 명단(순번↔이름)은 손대지 않는다.
    if (mode === 'move') {
      // 스페어는 옮길 티오프가 없다 — 맞바꾸기로 안내한다.
      if (isSpare(td) || (pick && isSpare(pick))) {
        if (!pick) { state.textContent = '스페어는 티오프가 없어 옮길 수 없습니다 — 맞바꾸기를 쓰세요.'; return; }
        const from0 = posAt(part, pick); clearPick();
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
      if (msg) state.textContent = msg;
      return;
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!live) { state.textContent = '샘플 — 저장은 모니터에서 됩니다'; return; }
    saveBtn.disabled = true;
    try {
      for (const part of PARTS) {
        if (!changed(part)) continue;
        const P = BOARD[part] || {};
        // ★전체 rows를 보낸다 — board-correct는 받은 rows로 명단·격자를 재구성하므로
        //  일부만 보내면 나머지가 사라진다.
        const rows = roster[part].map((cell, i) => {
          const t = teeV[view][part][i];
          return { pos: i + 1, name: String(cell || ''), tee: t ? t.time : '', course: t ? t.course : '' };
        });
        // 인턴 칸도 함께 — board-correct가 interns[]를 받아 internTees/internCount에 반영한다.
        const iTees = [...interns[part]].map((k) => ({ time: k.split('|')[0], course: k.split('|')[1] }));
        const r = await fetch('/api/board-correct', {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ part: part, rows: rows, interns: iTees, cutLine: tee[part].filter(Boolean).length }),
        });
        const j = await r.json(); if (!j.ok) throw new Error(j.error || (part + '부 저장 실패'));
        // 3부 인턴은 별도 저장소에도 남긴다 — 카카오 재매칭이 이걸 본다(사진 판독과 무관하게 유지).
        if (part === '3' && DATE) {
          await fetch('/api/admin/intern-tees', {
            method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ date: DATE, tees: iTees }),
          }).catch(() => {});
        }
        rosterOrig[part] = roster[part].slice();
        teeOrig[part] = tee[part].map((x) => (x ? { time: x.time, course: x.course } : x));
        internsOrig[part] = new Set(interns[part]);
      }
      stack.length = 0;
      PARTS.forEach(paint);
      state.textContent = '저장됐습니다 — 새로고침하면 반영됩니다';
    } catch (err) { state.textContent = '저장 실패: ' + err.message; }
    finally { saveBtn.disabled = false; }
  });

  // 시작 — 두 보기 모두 계산해두고 현재 보기(대조)를 그린다. 도구는 처음부터 쓸 수 있다.
  PARTS.forEach((p) => { VIEWS.forEach((v) => recompute(p, v)); });
  tools.hidden = false;
  PARTS.forEach(paint);
  if (!live) state.textContent = '샘플 — 눌러서 동작만 보실 수 있습니다';
})();
