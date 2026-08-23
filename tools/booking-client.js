/* 예약 구성판 — 예약팀장이 쓰는 화면.
 *
 *  이 화면의 규칙은 단 하나다. 앱이 쓰는 것과 같은 규칙이어야 한다.
 *   · 예약이 찬 칸을 시각순으로 세우고(동시각이면 OUT→IN) 순번 1..N에 짝짓는다.
 *   · 그래서 중간에 한 팀을 끼우면 뒤 순번이 통째로 한 칸씩 당겨진다(리버힐 운영 규칙).
 *   · 인턴 칸은 팀이지만 정규 순번을 먹지 않는다 — 세되 짝짓지 않는다.
 *  여기서 다른 규칙을 쓰면 팀장이 보는 미리보기와 캐디가 보는 앱이 갈라진다.
 *  갈라지는 순간 이 화면은 '재미있는 거짓말'이 된다.
 */
(function () {
  const D = window.__BOOK || {};
  const PARTS = ['1', '2', '3'];
  const $ = (id) => document.getElementById(id);
  const toMin = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const toHM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const K = (t, c) => `${toHM(toMin(t))}|${/IN/i.test(c) ? 'IN' : 'OUT'}`;
  const bare = (s) => String(s || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
  const tagOf = (s) => { const m = String(s || '').match(/\(([^)]*)\)/); return m ? m[1] : ''; };

  // ── 상태 ─────────────────────────────────────────────
  //  booked = 예약이 찬 칸(Set), intern = 그중 인턴 칸, roster = 순번 순서의 이름들.
  const S = {};
  for (const p of PARTS) {
    const src = D.parts[p] || { slots: [], booked: [], intern: [], roster: [] };
    S[p] = {
      slots: (src.slots || []).map((x) => ({ time: x.time, course: x.course })),
      booked: new Set(src.booked || []),
      intern: new Set(src.intern || []),
      roster: (src.roster || []).slice(),
      syncSig: String(src.syncSig || ''),   // 불러온 판 — 반영할 때 그대로 되돌려준다
    };
  }
  const snap = () => JSON.stringify(PARTS.map((p) => ({ p, slots: S[p].slots, booked: [...S[p].booked], intern: [...S[p].intern], roster: S[p].roster })));
  const restore = (js) => {
    for (const x of JSON.parse(js)) {
      S[x.p].slots = x.slots; S[x.p].booked = new Set(x.booked);
      S[x.p].intern = new Set(x.intern); S[x.p].roster = x.roster;
    }
  };
  let BASE = snap();   // 반영에 성공하면 여기가 새 출발선이 된다
  const undo = [];
  let mode = 'book';
  let pick = null;          // 맞바꾸기·옮기기에서 먼저 고른 칸
  let logSeq = 0;

  // ── 규칙: 찬 칸 → 순번 ────────────────────────────────
  //  인턴 칸은 빼고 시각순으로 세운다. i번째 칸이 곧 순번 i+1이다.
  function seatsOf(part) {
    const s = S[part];
    return [...s.booked]
      .filter((k) => !s.intern.has(k))
      .map((k) => { const [t, c] = k.split('|'); return { key: k, time: t, course: c, mins: toMin(t) }; })
      .sort((a, b) => a.mins - b.mins || (a.course === 'OUT' ? -1 : 1));
  }
  // 이 사람은 오늘 어떻게 되나 — 앱이 답하는 것과 같은 답.
  function stateOf(part, pos) {
    const seats = seatsOf(part);
    const cut = seats.length;
    if (!pos || pos > cut) return { work: false, cut, pos, tee: '', course: '', spareRank: pos ? pos - cut : 0 };
    const s = seats[pos - 1];
    return { work: true, cut, pos, tee: s.time, course: s.course, spareRank: 0 };
  }
  // 전 캐디의 오늘 — 미리보기·변경 로그가 같은 표를 본다.
  function tableOf(part) {
    const seats = seatsOf(part);
    return S[part].roster.map((nm, i) => {
      const pos = i + 1, s = seats[pos - 1];
      return { pos, name: nm, work: !!s, tee: s ? s.time : '', course: s ? s.course : '' };
    });
  }

  // ── 변경 로그 — 이 화면의 심장 ────────────────────────
  //  숫자가 아니라 사람으로 말한다. "17:42 한 팀 늘림" 아래에 "12번 박준서가 근무가 됐습니다".
  function withDiff(title, fn) {
    const before = {}; for (const p of PARTS) before[p] = tableOf(p);
    undo.push(snap()); if (undo.length > 60) undo.shift();
    fn();
    // ★사람으로 비교한다 — 자리로 비교하면 순번이 한 칸 밀린 날 전원이 '남의 자리에 앉은' 것처럼 읽힌다.
    //  예약팀장이 알고 싶은 건 "누가 어떻게 됐나"이지 "몇 번 칸에 누가 있나"가 아니다.
    const lines = [];
    for (const p of PARTS) {
      const idx = (rows) => { const m = new Map(); for (const r of rows) { const k = bare(r.name); if (k) m.set(k, r); } return m; };
      const A = idx(before[p]), B = idx(tableOf(p));
      for (const [nm, y] of B) {
        const x = A.get(nm);
        if (!x) { lines.push(`${p}부 ${nm} — 명단에 들어왔습니다 (${y.pos}번)`); continue; }
        if (!x.work && y.work) lines.push(`${p}부 ${nm} — 스페어에서 근무로 (${y.pos}번 · ${y.tee} ${y.course})`);
        else if (x.work && !y.work) lines.push(`${p}부 ${nm} — 근무에서 스페어로 (${y.pos}번)`);
        else if (x.work && y.work && (x.tee !== y.tee || x.course !== y.course)) lines.push(`${p}부 ${nm} — 티오프 ${x.tee} ${x.course} → ${y.tee} ${y.course}`);
        else if (x.pos !== y.pos) lines.push(`${p}부 ${nm} — 순번 ${x.pos}번 → ${y.pos}번`);
      }
      for (const [nm, x] of A) if (!B.has(nm)) lines.push(`${p}부 ${nm} — 명단에서 빠졌습니다 (${x.pos}번이었습니다)`);
    }
    // 근무가 갈린 사람을 맨 위로 — 티오프가 몇 분 당겨진 것보다 그게 훨씬 큰 일이다.
    const weight = (l) => (/스페어에서 근무로|근무에서 스페어로/.test(l) ? 0 : /명단에/.test(l) ? 1 : 2);
    lines.sort((a, b) => weight(a) - weight(b));
    addLog(title, lines);
    paintAll();
  }
  function addLog(title, lines) {
    const box = $('logList'); if (!box) return;
    const el = document.createElement('div');
    el.className = 'lg' + (lines.length ? ' hit' : '');
    const who = lines.length
      ? `<ul>${lines.slice(0, 8).map((l) => `<li>${esc(l)}</li>`).join('')}${lines.length > 8 ? `<li class="more">그 밖 ${lines.length - 8}명</li>` : ''}</ul>`
      : '<p class="none">캐디 배정에는 변화가 없습니다.</p>';
    el.innerHTML = `<b>${++logSeq}. ${esc(title)}</b>${who}`;
    box.prepend(el);
    $('logEmpty').hidden = true;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── 격자 그리기 ───────────────────────────────────────
  function paintGrid(part) {
    const body = $('g' + part); if (!body) return;
    const s = S[part];
    const seats = seatsOf(part);
    const posOf = new Map(seats.map((x, i) => [x.key, i + 1]));
    const rows = new Map();
    for (const sl of s.slots) {
      const m = toMin(sl.time);
      if (!rows.has(m)) rows.set(m, { time: toHM(m), OUT: null, IN: null });
      rows.get(m)[sl.course] = sl;
    }
    for (const k of s.booked) { const [t, c] = k.split('|'); const m = toMin(t);
      if (!rows.has(m)) rows.set(m, { time: toHM(m), OUT: null, IN: null });
      if (!rows.get(m)[c]) rows.get(m)[c] = { time: toHM(m), course: c, extra: true }; }
    const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    body.innerHTML = ordered.map((r) => {
      const cell = (c) => {
        const sl = r[c];
        if (!sl) return `<td class="c off"></td>`;
        const key = K(r.time, c);
        const isB = s.booked.has(key), isI = s.intern.has(key);
        const pos = posOf.get(key) || 0;
        const nm = pos ? (s.roster[pos - 1] || '') : '';
        const tg = tagOf(nm);
        const cls = ['c', isI ? 'intern' : (isB ? 'booked' : 'open'), pick && pick.part === part && pick.key === key ? 'picked' : ''].join(' ');
        const inner = isI ? '<span class="ilab">인턴</span>'
          : isB ? `<span class="pos">${pos || '-'}</span><span class="nm">${esc(bare(nm)) || '<i>빈 순번</i>'}</span>${tg ? `<span class="dt">${esc(tg)}</span>` : ''}`
            : '';
        return `<td class="${cls}" data-p="${part}" data-k="${key}">${inner}</td>`;
      };
      return `<tr>${cell('OUT')}<th class="t">${r.time}</th>${cell('IN')}</tr>`;
    }).join('');
    body.querySelectorAll('td.c').forEach((td) => { td.onclick = () => onCell(part, td.dataset.k); });
    const seatCount = seats.length;
    $('sum' + part).textContent = `${seatCount}팀 · 인턴 ${s.intern.size}`;
    const sp = $('sp' + part);
    if (sp) {
      const rest = S[part].roster.slice(seatCount);
      sp.innerHTML = rest.length
        ? rest.map((nm, i) => `<span class="chip">${seatCount + i + 1}번 ${esc(bare(nm))}</span>`).join('')
        : '<span class="chip none">스페어 없음</span>';
    }
  }

  // ── 칸을 눌렀을 때 ───────────────────────────────────
  function onCell(part, key) {
    const s = S[part];
    const [t, c] = key.split('|');
    if (mode === 'book') {
      if (s.booked.has(key)) withDiff(`${part}부 ${t} ${c} 예약을 뺐습니다`, () => { s.booked.delete(key); s.intern.delete(key); });
      else withDiff(`${part}부 ${t} ${c} 예약을 받았습니다`, () => s.booked.add(key));
      return;
    }
    if (mode === 'intern') {
      if (!s.booked.has(key)) { note('예약이 있는 칸에만 인턴을 지정할 수 있습니다.'); return; }
      if (s.intern.has(key)) withDiff(`${part}부 ${t} ${c} 인턴 해제`, () => s.intern.delete(key));
      else withDiff(`${part}부 ${t} ${c} 인턴 지정 — 이 칸은 정규 순번을 먹지 않습니다`, () => s.intern.add(key));
      return;
    }
    const seats = seatsOf(part);
    const idx = seats.findIndex((x) => x.key === key);
    if (mode === 'swap') {
      if (idx < 0) { note('사람이 있는 칸을 눌러주세요.'); return; }
      if (!pick) { pick = { part, key, pos: idx + 1 }; paintAll(); note(`${part}부 ${idx + 1}번 ${bare(s.roster[idx] || '')} 선택 — 바꿀 상대를 누르세요.`); return; }
      const j = seatsOf(pick.part).findIndex((x) => x.key === pick.key);
      if (j < 0) { pick = null; paintAll(); return; }
      const a = pick.part, ai = j, b = part, bi = idx, from = pick;
      pick = null;
      withDiff(`${a}부 ${ai + 1}번과 ${b}부 ${bi + 1}번을 맞바꿨습니다`, () => {
        const x = S[a].roster[ai], y = S[b].roster[bi];
        S[a].roster[ai] = y; S[b].roster[bi] = x;
      });
      void from;
      return;
    }
    if (mode === 'move') {
      if (!pick) {
        if (idx < 0) { note('옮길 사람이 있는 칸을 눌러주세요.'); return; }
        pick = { part, key, pos: idx + 1 }; paintAll();
        note(`${part}부 ${idx + 1}번 ${bare(s.roster[idx] || '')} 선택 — 갈 자리(빈 칸도 됩니다)를 누르세요.`);
        return;
      }
      const fromPart = pick.part, fromPos = pick.pos, target = key, tPart = part;
      pick = null;
      if (fromPart !== tPart) { note('순번 옮기기는 같은 부 안에서만 됩니다. 다른 부로 보내려면 맞바꾸기를 쓰세요.'); paintAll(); return; }
      withDiff(`${fromPart}부 ${fromPos}번을 ${target.replace('|', ' ')}로 옮겼습니다`, () => {
        const st = S[tPart];
        if (!st.booked.has(target)) st.booked.add(target);     // 빈 칸으로 옮기면 그 칸을 새로 받는 것이다
        const nm = st.roster.splice(fromPos - 1, 1)[0];
        const newIdx = seatsOf(tPart).findIndex((x) => x.key === target);
        st.roster.splice(newIdx < 0 ? st.roster.length : newIdx, 0, nm);
      });
      return;
    }
  }

  // ── 격자 밖 칸(당추) ─────────────────────────────────
  function addExtra(part) {
    const raw = prompt(`${part}부 — 끼워넣을 티오프 시각 (예: 1742 또는 17:42)`);
    if (!raw) return;
    const d = String(raw).replace(/\D/g, '');
    if (d.length < 3) { note('시각을 4자리로 적어주세요. 예: 1742'); return; }
    const hh = Number(d.slice(0, d.length - 2)), mm = Number(d.slice(-2));
    if (!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60)) { note('그런 시각은 없습니다.'); return; }
    const course = confirm('아웃코스면 확인, 인코스면 취소를 누르세요.') ? 'OUT' : 'IN';
    const key = K(toHM(hh * 60 + mm), course);
    withDiff(`${part}부 ${toHM(hh * 60 + mm)} ${course} 칸을 끼워 넣고 예약을 받았습니다`, () => {
      S[part].slots.push({ time: toHM(hh * 60 + mm), course });
      S[part].booked.add(key);
    });
  }

  // ── 폰 미리보기 — 캐디가 지금 보게 될 화면 ─────────────
  function paintPhone() {
    const part = $('pvPart').value;
    const sel = $('pvWho');
    const table = tableOf(part);
    const cur = sel.value;
    sel.innerHTML = table.map((r) => `<option value="${r.pos}">${r.pos}번 ${esc(bare(r.name))}</option>`).join('');
    const seats = seatsOf(part).length;
    sel.value = table.some((r) => String(r.pos) === cur) ? cur : String(Math.min(seats + 1, table.length) || 1);
    const pos = Number(sel.value) || 1;
    const me = table[pos - 1] || { pos, name: '', work: false, tee: '' };
    const st = stateOf(part, pos);
    $('pvName').textContent = bare(me.name) || '이름 없음';
    $('pvLabel').textContent = `오늘 내 상황`;
    $('pvTitle').textContent = st.work ? `오늘 ${part}부 근무 확정` : `오늘 ${part}부 스페어`;
    $('pvTitle').className = st.work ? 'pv-title work' : 'pv-title spare';
    $('pvSub').textContent = st.work
      ? `${st.tee} ${st.course} · 순번 ${pos}번`
      : `순번 ${pos}번 · 확정선 ${st.cut}번 · 내 앞 대기 ${Math.max(0, pos - st.cut - 1)}명`;
    $('pvBig').textContent = st.work ? st.tee : `${Math.max(1, pos - st.cut)}번째`;
    $('pvBigU').textContent = st.work ? (st.course === 'IN' ? '인코스' : '아웃코스') : '스페어';
    const from = Math.max(1, pos - 3), to = Math.min(table.length, pos + 2);
    $('pvList').innerHTML = table.slice(from - 1, to).map((r) => `
      <div class="pv-row${r.pos === pos ? ' me' : ''}">
        <span class="p">${r.pos}</span><span class="n">${esc(bare(r.name))}</span>
        <span class="t">${r.work ? `${r.tee}` : '<i>스페어</i>'}</span>
      </div>`).join('');
    $('pvCut').textContent = `${part}부 ${seats}팀 · ${seats}번까지 근무`;
  }

  // ── 저장·반영 ────────────────────────────────────────
  const changed = () => snap() !== BASE;
  //  ★손댄 부만 반영한다. 이 화면은 세 부를 한꺼번에 들고 있어서, 1부만 고치고 반영을 눌러도
  //   payload에는 2·3부가 그대로 실린다. 그걸 그대로 반영하면 건드리지도 않은 3부가
  //   이 화면이 다시 그린 값으로 덮인다 — 관리자 교정도, 수동 인턴 지정도 같이 지워진다.
  //   테스트판(sandbox)에는 세 부를 다 넣는다(그건 그림이니까), 회원 앱에는 손댄 부만 간다.
  const partSnap = (x) => JSON.stringify([[...x.booked].sort(), [...x.intern].sort(), x.roster]);
  function payload() {
    const base = {}; for (const x of JSON.parse(BASE)) base[x.p] = { booked: new Set(x.booked), intern: new Set(x.intern), roster: x.roster };
    const parts = {}, touched = [];
    for (const p of PARTS) {
      const seats = seatsOf(p);
      parts[p] = {
        roster: S[p].roster.slice(),
        teeGrid: seats.map((x, i) => ({ pos: i + 1, time: x.time, course: x.course })),
        internTees: [...S[p].intern].map((k) => ({ time: k.split('|')[0], course: k.split('|')[1] })),
        cut: seats.length,
        syncSig: S[p].syncSig,
      };
      if (partSnap(S[p]) !== partSnap(base[p])) touched.push(p);
    }
    return { date: D.dateKey, parts, touched };
  }
  const touchedNow = () => payload().touched;
  async function save(apply) {
    const body = { ...payload(), apply: !!apply };
    if (apply && !body.touched.length) { note('바꾼 것이 없어 반영하지 않았습니다.'); return; }
    $('saveBtn').disabled = true;
    const ap0 = $('applyBtn'); if (ap0) ap0.disabled = true;
    try {
      const r = await fetch('/api/booking-save' + (location.search || ''), {   // 모니터 토큰을 그대로 물려준다(없으면 401)
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '저장 실패');
      if (apply) {
        // 반영이 끝나면 여기가 새 출발선이다 — 안 그러면 같은 변경을 또 반영하게 된다.
        BASE = snap(); undo.length = 0;
        note('회원 앱에 반영했습니다 — ' + (r.done || []).join(', ') + '. (알림은 보내지 않았습니다)');
        addLog('회원 앱에 반영했습니다', (r.done || []).map((x) => x + ' 카드를 다시 계산했습니다'));
      } else note('테스트판에 저장했습니다 — 회원 앱은 아직 그대로입니다.');
    } catch (e) { note('저장하지 못했습니다: ' + e.message); }
    $('saveBtn').disabled = false;
    const ap1 = $('applyBtn'); if (ap1) ap1.disabled = false;
    paintAll();
  }
  function note(t) { $('state').textContent = t; }

  // ── 칠하기 ───────────────────────────────────────────
  function paintAll() {
    for (const p of PARTS) paintGrid(p);
    paintPhone();
    $('undoBtn').hidden = !undo.length;
    $('saveBtn').hidden = !changed();
    const ap = $('applyBtn'); if (ap) ap.hidden = !changed();
    $('resetBtn').hidden = !changed();
  }

  // ── 붙이기 ───────────────────────────────────────────
  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => {
      mode = b.dataset.mode; pick = null;
      document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
      note({
        book: '칸을 누르면 예약이 차고, 다시 누르면 빠집니다.',
        intern: '예약이 있는 칸을 누르면 인턴 칸이 됩니다 — 팀은 있지만 캐디 순번은 안 먹습니다.',
        swap: '두 사람을 눌러 자리를 맞바꿉니다.',
        move: '사람을 고르고 갈 자리를 누릅니다. 빈 칸을 누르면 그 칸을 새로 받습니다.',
      }[mode] || '');
      paintAll();
    };
  });
  PARTS.forEach((p) => { const b = $('extra' + p); if (b) b.onclick = () => addExtra(p); });
  $('undoBtn').onclick = () => { if (!undo.length) return; restore(undo.pop()); addLog('되돌렸습니다', []); paintAll(); };
  $('resetBtn').onclick = () => { restore(BASE); undo.length = 0; addLog('처음 상태로 되돌렸습니다', []); paintAll(); };
  $('saveBtn').onclick = () => save(false);
  const apBtn = $('applyBtn');
  if (apBtn) apBtn.onclick = () => {
    // ★어느 부가 가는지 이름을 대고 묻는다. '정말 하시겠습니까'는 아무것도 알려주지 않는다.
    const t = touchedNow();
    if (!t.length) { note('바꾼 것이 없습니다.'); return; }
    const msg = t.map((p) => p + '부').join(' · ') + '를 회원 앱에 반영합니다.\n캐디들이 보는 화면이 실제로 바뀝니다(알림은 보내지 않습니다). 계속할까요?';
    if (confirm(msg)) save(true);
  };
  $('pvPart').onchange = paintPhone;
  $('pvWho').onchange = paintPhone;
  paintAll();
  note('칸을 눌러 예약을 채워보세요. 오른쪽 폰 화면이 그 자리에서 바뀝니다.');
})();
