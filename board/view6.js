// ══════════════════════════════════════════════════════════════
//  view — 데스크톱 화면 (16:9 무대)
//  paint·toast·resyncSheet·drawCfg·saveFlash 를 기계에 준다.
// ══════════════════════════════════════════════════════════════
// ── 그리기 ──────────────────────────────────
// 종이 배치표처럼 꼬리표마다 칸 색이 다르다
// ★집은 자리는 하나가 아니라 여럿이다 — 셋 넷이 한 바퀴 도는 대바가 흔하다.
// pick 은 옛 길들이 그대로 쓰게 첫 자리를 가리켜 둔다
var pickList = [];
// ★'팀 지우기' 상태 — 켠 부에서만 산다. 켜 두는 동안에는 아무것도 안 지운다.
//   고른 것이 눈에 보이고 몇 팀인지 세어진 뒤에야 지운다
var delPk = '', delSel = [];
function delOn(pk){ return delPk === pk; }
function delAt(i){ return delSel.indexOf(i); }
function delOff(){ delPk = ''; delSel = []; }
function delToggle(i){
  var k = delAt(i);
  if (k >= 0) delSel.splice(k, 1); else delSel.push(i);
}
function pickAt(pk, ri){
  for (var i = 0; i < pickList.length; i++)
    if (pickList[i].pk === pk && pickList[i].ri === ri) return i;
  return -1;
}
function pickSync(){ pick = pickList.length ? pickList[0] : null; }
function pickSet(pk, ri, nm){ pickList = [{ pk: pk, ri: ri, nm: nm || '' }]; pickSync(); }
function pickClear(){ pickList = []; pickSync(); }
// 자리를 하나 더 얹는다. 이미 집힌 자리를 또 누르면 놓는다
function pickToggle(pk, ri){
  var at = pickAt(pk, ri);
  if (at >= 0){
    if (at === 0 && pickList.length === 1) { pickClear(); paint(); toast('그만뒀습니다'); return; }
    pickList.splice(at, 1);
  } else pickList.push({ pk: pk, ri: ri });
  pickSync(); paint();
}
// 마지막 상대를 얹어 한 바퀴 돌린다 — 하나만 집혀 있으면 그냥 맞바꾸기다
function pickWith(T){
  if (!pickList.length) return;
  var list = pickList.concat([T]);
  pickClear();
  rotateSeats(list);
  paint();
}
function pickGo2(){
  if (pickList.length < 2) return;
  var list = pickList.slice();
  pickClear();
  rotateSeats(list);
  paint();
}
function pickNames2(){
  return pickList.map(function(s){ var r = part(s.pk).roster[s.ri]; return r ? r.n : '?'; });
}
function tagClass(r){
  if (!r || !cellTag(r.tag)) return '';
  var c = tagCls(cellTag(r.tag));
  return (c && c !== 'cet') ? ' ' + c : '';   // 칸 바탕은 뚜렷한 것만 물들인다
}
// 근무 칸에 적을 글씨. 꼬리표가 이미 근무를 말하면 부 번호를 겹쳐 적지 않는다
function wkText(st, tag){
  if (!tag) return st;
  if (tag === '54') return '54';   // 54홀은 그 자체가 근무다 — '1,2,3 54'라 적지 않는다
  if (tag === st) return tag;      // '2,3 2,3'처럼 되풀이하지 않는다
  return st + ' ' + tag;
}
function cellHTML(p, i, course, time){
  if (i == null){
    if (!time) return '<span class="cell blank" data-c="' + course + '"></span>';
    return '<button class="cell slot" data-c="' + course + '" data-slot="' + time + '|' + course + '">'
      + '<span class="plus">+ 팀 넣기</span></button>';
  }
  var a = active(p), r = a[i], t = p.tees[i];
  var ri = r ? p.roster.indexOf(r) : -1;
  var g = r ? cellTag(r.tag) : '';
  var dsel = (delOn(p.key) && t) ? (delAt(i) >= 0 ? ' dsel' : ' dpick') : '';
  var cls = 'cell' + (isItn(r) ? ' itnc' : '')
    + tagClass(r) + (t && t.cx ? ' cx' : '') + (dirty[p.key + ':' + i] ? ' dirty' : '')
    + (pickAt(p.key, ri) >= 0 ? ' pick' : '') + dsel;
  return '<button class="' + cls + '" data-c="' + course + '" data-pk="' + p.key + '" data-i="' + i + '"'
    + ' data-nm="' + esc(r ? r.n : '') + '">'
    + '<span class="p' + (isItn(r) ? ' itn' : ' num') + '">' + seatNoTx(p, i) + '</span>'
    + '<span class="nm">' + ((r && r.n) ? esc(r.n) : '비어 있음') + '</span>'
    + (g ? '<span class="tag t' + tagCls(g) + '">' + esc(g) + '</span>' : '')
    + (r && r.role ? '<span class="tag rl">' + esc(r.role) + '</span>' : '')
    + (t && t.cx ? '<span class="tag x">취소</span>' : '')
    + (t && t.pax !== 4 ? '<span class="tag px">' + t.pax + '인</span>' : '')
    + (pickAt(p.key, ri) >= 0 && pickList.length > 1
        ? '<span class="tag pkn num">' + (pickAt(p.key, ri) + 1) + '</span>' : '')
    + '</button>';
}
// 코스가 둘이면 [코스│시각│코스] — 종이 배치표 그대로.
// 셋 이상이면 [시각│코스│코스│코스…] — 가운데에 둘 자리가 없다.
function browHTML(cls, tmHTML, cells){
  if (cells.length === 2) return '<div class="' + cls + '">' + cells[0] + tmHTML + cells[1] + '</div>';
  return '<div class="' + cls + ' wide">' + tmHTML + cells.join('') + '</div>';
}
function gridVars(){
  var n = COURSES.length, w = 'calc(48px*var(--k))';
  return '--gcols:' + (n === 2 ? '1fr ' + w + ' 1fr' : w + ' repeat(' + n + ',minmax(0,1fr))')
    + ';--gspan:' + n;
}
function partHTML(p){
  var a = active(p), n = p.tees.length;

  // ① 티오프 격자 — 기본 시간표를 통째로 깔고, 팀이 있는 칸만 채운다
  var at = {};
  p.tees.forEach(function(t, i){ at[t.time + '|' + t.course] = i; });
  var N = COURSES.length;
  var grid = gridTimes(p).map(function(tm){
    var og = offGrid(p, tm);
    var cells = COURSES.map(function(ck){
      var ti = at[tm + '|' + ck];
      return cellHTML(p, ti == null ? null : ti, ck, tm);
    });
    // ★시각을 누르면 그 시각을 고칠 수 있다 — 뒤가 통째로 밀리는 날이 있다
    var ti0 = at[tm + '|' + COURSES[0]];
    if (ti0 == null) for (var ci = 1; ci < COURSES.length; ci++){
      if (at[tm + '|' + COURSES[ci]] != null) { ti0 = at[tm + '|' + COURSES[ci]]; break; }
    }
    return browHTML('brow', '<span class="tm num' + (ti0 == null ? '' : ' hit')
      + '"' + (ti0 == null ? '' : ' data-tee="' + p.key + '|' + ti0 + '"') + '>'
      + tm + (og ? '<em>격자 밖</em>' : '') + '</span>', cells);
  }).join('');

  // ② 스페어 — 같은 격자에 순번 그대로 이어 붙인다.
  // ★대기도 티오프처럼 '자리가 먼저'다. 관리자가 '29번까지'라고 깔아 두면
  //   사람이 하나도 없어도 25~29번 빈 칸이 먼저 서 있고, 거기에 앉힌다.
  //   빈 칸은 줄(roster)을 안 만든다 — 티오프의 빈 칸과 똑같다.
  //   깔아 둔 자리가 없으면(제한 없음) 여태처럼 서 있는 사람만큼만 그린다
  var rest = Math.max(0, a.length - n);
  var capN = spareCap(p.key), capNo = spareLastNo(p);
  var rows = Math.max(rest, capN);
  var spAdd = '<button class="cell slot spadd" data-spadd="' + p.key + '">'
    + '<span class="p num">' + nextSeatNo(p) + '</span>'
    + '<span class="plus">+ 대기</span></button>';
  if (rows > 0){
    grid += '<div class="cut"><span class="ln"></span><span class="tx">확정선 · 여기까지 근무</span><span class="ln"></span></div>';
    // ★한 줄에 한 명. 격자의 두 칸은 OUT·IN 인데 대기는 코스가 없다 —
    //   그 칸에 넣으면 왼쪽은 OUT, 오른쪽은 IN 으로 읽힌다
    for (var sr = 0; sr < rows; sr++)
      grid += '<div class="brow spare sp1"><span class="tm">대기</span>'
        + cellHTML(p, n + sr, '대기') + '</div>';
    // ★깔아 둔 끝에 선을 긋는다 — 여기까지가 오늘 대기다
    if (capNo)
      grid += '<div class="cut capcut"><span class="ln"></span>'
        + '<button class="tx" data-spcap="' + p.key + '">대기 여기까지 · ' + capNo + '번</button>'
        + '<span class="ln"></span></div>';
    else
      grid += '<div class="brow spare sp1"><span class="tm">대기</span>' + spAdd + '</div>';
  }
  var tail = rows > 0 ? '' : '<div class="wsec"><div class="h"><b>대기 없음</b>'
    + '<span>출근 ' + a.length + '명 전원 근무</span>'
    + '<button class="add" data-spcap="' + p.key + '">대기 자리 깔기</button>'
    + '<button class="add" data-spadd="' + p.key + '">대기 넣기</button></div></div>';

  return '<section class="pcol' + (p.key === cur ? ' cur' : '') + '" id="col' + p.key + '">'
    + '<div class="phead"><div class="ph"><b>' + esc(p.name) + '</b><span class="t num">' + n + '팀</span>'
    + '<button class="t num spcap' + (spareCap(p.key) ? ' on' : '') + '" data-spcap="' + p.key + '">'
    + '대기 ' + spareNow(p) + (spareCap(p.key) ? ' · ' + spareLastNo(p) + '번까지' : '') + '</button>'
    + '<button class="add" data-addteam="' + p.key + '">팀 추가</button>'
    + '<button class="add' + (delOn(p.key) ? ' on' : '') + '" data-delmode="' + p.key + '">'
    + (delOn(p.key) ? '그만' : '팀 지우기') + '</button></div>'
    + (delOn(p.key)
       ? '<div class="delbar"><b>지울 팀을 고르십시오</b>'
         + '<span class="n num">' + delSel.length + '팀</span>'
         + '<button data-delall="' + p.key + '">'
         + (delSel.length === n && n ? '고른 것 풀기' : '이 부 전부 (' + n + '팀)') + '</button>'
         + '<button class="go" data-delgo="' + p.key + '"' + (delSel.length ? '' : ' disabled')
         + '>' + (delSel.length ? delSel.length + '팀 지우기' : '지우기') + '</button></div>'
       : '') + '</div>'
    + '<div class="pscroll" style="' + gridVars() + '">'
    + browHTML('ghd', '<div class="tmh">시각</div>',
        COURSES.map(function(ck, ci){
          return '<div class="co c' + ci + (ci === N - 1 ? ' last' : '') + '">' + esc(cname(ck)) + '</div>'; }))
    + grid + tail + '</div></section>';
}
// 두 화면 — 근무표는 사람(어디나 같다), 배치표는 자리(코스와 부마다 다르다).
// 보는 방식은 그날의 사실이 아니라서 저장본에는 안 넣는다
var VIEW = 'board';
function setView(v){
  VIEW = v;
  $('viewWork').classList.toggle('on', v === 'work');
  $('viewBoard').classList.toggle('on', v === 'board');
  // ★부 띠는 배치표 얘기다 — 근무표에서는 자리만 차지하므로 그 화면에서만 끈다
  $('stage').classList.toggle('vwork', v === 'work');
  var bs = $('vtabs').querySelectorAll('button');
  for (var i = 0; i < bs.length; i++)
    bs[i].classList.toggle('on', bs[i].getAttribute('data-view') === v);
  try { localStorage.setItem('board.view', v); } catch (e) { /* 안 되면 기본값으로 연다 */ }
  fit();
}
$('vtabs').addEventListener('click', function(e){
  var b = e.target.closest('button');
  if (b) setView(b.getAttribute('data-view'));
});

// ★목록만 따로 그린다 — 찾기 칸을 통째로 다시 만들면 한글 조합이 깨진다
function wkListHTML(){
  var rows = workRows(), T = workTally();
  var q0 = String(wkQ || '').trim();
  var bsel = {};
  bulkDone().forEach(function(n){ bsel[n] = 'bund'; });
  bulkSet().forEach(function(n){ bsel[n] = 'bsel'; });
  bulkPicked().forEach(function(n){ bsel[n] = 'bpick'; });   // 고른 사람 — 아직 안 바꿨다
  var byName = {}, byJo = [], unset = [], j;
  rows.forEach(function(r){ byName[r.n] = r; });
  var keep = function(r){ return wkKeep(r, wkFilter, q0); };
  for (j = 0; j < JOCNT; j++)
    byJo.push(joMembers(j).map(function(n){ return byName[n]; }).filter(keep));
  rows.forEach(function(r){ if (joOf(r.n) < 0 && keep(r)) unset.push(r); });
  var cols = byJo.map(function(list, ji){
    return { t: JOLABEL[ji] || (ji + 1) + '조', list: list, un: false }; });
  if (unset.length) cols.push({ t: '조 미배정', list: unset, un: true });
  return '<div class="bd flat"><div class="jogrid" style="grid-template-columns:repeat('
    + cols.length + ',minmax(0,1fr))">'
    + cols.map(function(c, ci){
        var list = c.list, w = list.filter(function(r){ return r.cls === 'w'; }).length;
        return '<div class="jocol' + (c.un ? ' un' : '') + '"><div class="johd"><b>' + esc(c.t) + '</b>'
          + '<span>' + list.length + '명 · 근무 ' + w + '</span>'
          + '<button class="joadd" data-joadd="' + (c.un ? -1 : ci) + '" title="'
          + esc(c.t) + '에 캐디 넣기">+</button></div>'
          + '<div class="jobd">'
          + (list.length ? list.map(function(r){
              return '<button class="wrow' + (r.cls === 'r' || r.cls === 'v' || r.cls === 's' ? ' rest' : '')
                + (isBu3(r.n) ? ' b3' : '') + (bsel[r.n] ? ' ' + bsel[r.n] : '')
                + '" data-who="' + esc(r.n) + '">'
                + '<span class="nw"><span class="n">' + esc(r.n) + '</span>'
                + bu3BadgeHTML(r.n) + '</span>'                 // ★소속은 이름 바로 오른쪽
                + dayBadges(r.bts).map(function(x){
                    return '<span class="bt ' + tagCls(x) + '">' + esc(x) + '</span>'; }).join('')
                + (!r.chip || r.bts.indexOf(r.chip) >= 0 ? ''
                   : '<span class="bg ' + r.cls + '">' + esc(r.chip) + '</span>')
                + '<span class="ct' + (r.cart ? '' : ' no') + (cartBad(r.cart) ? ' bad' : '')
                + (isLent(r.n) ? ' lent' : '') + '" data-cart="' + esc(r.n)
                + '" title="' + (isLent(r.n) ? '빌린 카트 — 눌러서 고치기' : '카트 번호 고치기')
                + '">' + (r.cart || '') + '</span>'
                + '</button>'; }).join('')
             : '<div class="em" style="padding:8px">없음</div>')
          + '</div></div>'; }).join('')
    + '</div></div>';
}
// ★다시 그리면 굴린 자리를 잃는다.
//   조 칸을 아래까지 내려 놓고 거기 있는 사람의 상태를 고치면, 화면이 새로 그려지면서
//   맨 위로 튀어 올라 방금 보던 자리를 다시 찾아 내려가야 했다.
//   조 이름으로 짝을 찾는다 — 조가 늘거나 줄어도 보던 칸을 놓치지 않는다.
// 무엇을 보고 있었나 — 찾는 말과 거르개가 바뀌면 목록 자체가 달라진 것이라 위에서 본다
var wkSig = '';
function wkNowSig(){ return String(wkQ) + '|' + String(wkFilter); }
function wkScrollSave(){
  var out = { cols: [], view: 0, rail: 0, sig: wkSig };
  var vw = $('viewWork'), rs = document.querySelector('.wkrail');
  if (vw) out.view = vw.scrollTop;
  if (rs) out.rail = rs.scrollTop;
  [].slice.call(document.querySelectorAll('#viewWork .jobd')).forEach(function(el, i){
    var hd = el.parentNode && el.parentNode.querySelector('.johd b');
    out.cols.push({ key: hd ? hd.textContent : '', i: i, top: el.scrollTop });
  });
  return out;
}
function wkScrollLoad(s){
  var now = wkNowSig(), same = (s && s.sig === now);
  wkSig = now;
  if (!s || !same) return;           // 찾기·거르개를 바꿨으면 새 목록이다 — 맨 위에서 본다
  [].slice.call(document.querySelectorAll('#viewWork .jobd')).forEach(function(el, i){
    var hd = el.parentNode && el.parentNode.querySelector('.johd b');
    var key = hd ? hd.textContent : '', hit = null;
    if (key) for (var k = 0; k < s.cols.length; k++)
      if (s.cols[k].key === key) { hit = s.cols[k]; break; }
    if (!hit) hit = s.cols[i];                       // 이름을 못 찾으면 자리로 찾는다
    if (!hit || !hit.top) return;
    var max = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(hit.top, max);           // 짧아졌으면 갈 수 있는 데까지
  });
  var vw = $('viewWork'), rs = document.querySelector('.wkrail');
  if (vw && s.view) vw.scrollTop = Math.min(s.view, Math.max(0, vw.scrollHeight - vw.clientHeight));
  if (rs && s.rail) rs.scrollTop = Math.min(s.rail, Math.max(0, rs.scrollHeight - rs.clientHeight));
}
function drawWkList(){
  var el = $('wkList');
  if (!el) return;
  var s = wkScrollSave();
  el.innerHTML = wkListHTML();
  wkScrollLoad(s);
}
var wkQ = '';
function paint(){
  var hadQ = (document.activeElement && document.activeElement.id === 'wkQ');
  var hadNt = (document.activeElement && document.activeElement.id === 'ntBody');
  var wkScroll = wkScrollSave();     // ★보던 자리를 잃지 않는다
  $('hDate').textContent = DATE;
  $('hDate').title = '다른 날로 건너가기';
  $('hDate').style.cursor = 'pointer';
  $('hDate').style.textDecoration = 'underline dotted';
  $('hDate').style.textUnderlineOffset = '3px';
  $('hMeta').textContent = '리버힐 · 본배치표 #' + BOARD.id + ' 고치는 중';
  $('tabs').innerHTML = DAY.map(function(p){
    return '<button data-tab="' + p.key + '" class="' + (p.key === cur ? 'on' : '') + '">'
      + p.name + '<span class="c num">' + p.tees.length + '팀</span></button>';
  }).join('');
  $('cols').innerHTML = DAY.map(partHTML).join('');
  $('cols').parentNode.style.gridTemplateColumns = 'repeat(' + DAY.length + ',minmax(0,1fr))';

  // ── 오른쪽 조편성표 — [이름 | 근무 | 카트], 조편성표가 그날 상태의 원본이다
  var idx = peopleIndex(), cw = 0, cd = 0, ca = 0, cr = 0, cu = 0, wrows = [];
  idx.order.forEach(function(nm){
    var seats = idx.map[nm], st, cls, tag = '';
    if (!seats.length){
      var t0 = tagOf(nm);
      cls = absCls(absOf(nm));
      if (cls === 'u') { st = '미배치'; tag = seatTag(t0) ? t0 : ''; cu++; }
      else { st = (cls === 'o') ? '자리 없음' : absOf(nm); cr++; }
    } else {
      var ps = [], working = false, allOff = true, ex = '';
      seats.forEach(function(x){
        if (ps.indexOf(x.part) < 0) ps.push(x.part);
        if (x.label.indexOf('결근') < 0){ allOff = false; if (x.label.indexOf('대기') < 0) working = true; }
      });
      DAY.forEach(function(p){ p.roster.forEach(function(r){
        if (r.n === nm && r.tag && !ex) ex = r.tag; }); });
      if (allOff){ st = '결근'; cls = 'a'; ca++; tag = ''; }
      else if (working){ st = ps.length > 1 ? ps.join(',') : ps[0] + '부'; cls = 'w'; cw++; tag = ex; }
      else { st = '대기'; cls = 'd'; cd++; tag = ex; }
    }
    wrows.push({ n: nm, st: st, cls: cls, tag: tag, bts: wkBadges(nm), cart: CART[nm] || 0 });
  });
  var onCnt = cw + cd + ca;
  // ★가용 = 근무 + 대기 + 미배치. 미배치는 오늘 일할 수 있는 사람이라 제외인원이 아니다
  var total = wrows.length, avail = cw + cd + cu, exc = total - avail;
  // ★근무표 머리는 넓이가 남고 높이가 모자란다.
  //   여태는 요약·순번 세우기·한꺼번에 지정을 화면 폭 그대로 세로로 쌓았다.
  //   1904px 에서 두 자리 숫자 하나가 300px 을 쓰는 동안, 정작 세로로는
  //   레일이 창의 42%(확대하면 139px)를 넘겨 맨 아래 '한꺼번에 지정'이 잠겼다.
  //   옆으로 눕히면 같은 것이 절반 높이에 들어간다 —
  //   왼쪽은 읽는 것(요약·순번 세우기), 오른쪽은 누르는 것(한꺼번에 지정).
  $('railSum').innerHTML = '<div class="sumgrid">'
    + '<div class="sumc"><div class="v num">' + total + '</div><div class="k">총원</div></div>'
    + '<div class="sumc work"><div class="v num">' + avail + '</div><div class="k">가용</div></div>'
    + '<div class="sumc rest"><div class="v num">' + exc + '</div><div class="k">제외인원</div></div>'
    + '<div class="sumc work"><div class="v num">' + cw + '</div><div class="k">근무</div></div>'
    + '<div class="sumc wait"><div class="v num">' + cd + '</div><div class="k">대기</div></div>'
    + '<div class="sumc work"><div class="v num">' + cu + '</div><div class="k">미배치</div></div>'
    + '</div>' + noticeBoxHTML();
  // ★순번 세우기는 자리를 잡는 일이다 — 자리가 보이는 배치표 쪽에 산다.
  //   근무표는 사람을 보는 화면이다
  $('brail').innerHTML = lineupBarHTML() + roundClashBar() + cartClashBar();

  $('bstrip').innerHTML = '<span class="s"><i>' + total + '</i>총원</span>'
    + '<span class="s go"><i>' + avail + '</i>가용</span>'
    + '<span class="s"><i>' + cw + '</i>근무</span>'
    + '<span class="s cut"><i>' + cd + '</i>대기</span>'
    + '<span class="s"><i>' + exc + '</i>제외</span>'
    + '<span class="sep"></span>'
    + DAY.map(function(p){
        var g = gridTimes(p);
        return '<span class="s"><i>' + p.tees.length + '</i>' + esc(p.name)
          + ' <em>' + g[0] + '~' + g[g.length - 1] + '</em></span>'; }).join('')
    + '<span class="sep"></span>'
    + '<span class="s" style="color:var(--dim)">' + GAP + '분 격자 · 사람은 근무표 화면</span>';

  var bsel = {};
  bulkDone().forEach(function(n){ bsel[n] = 'bund'; });   // 손댔지만 지금은 안 달고 있다
  bulkSet().forEach(function(n){ bsel[n] = 'bsel'; });
  bulkPicked().forEach(function(n){ bsel[n] = 'bpick'; });   // 고른 사람 — 아직 안 바꿨다
  var cntBy = function(f){ return wrows.filter(f).length; };
  var fdef = [['', '전체', wrows.length],
    ['w', '근무', cw], ['d', '대기', cd], ['u', '미배치', cu],
    ['r', '휴무', cntBy(function(r){ return r.cls === 'r'; })],
    ['v', '휴가', cntBy(function(r){ return r.cls === 'v'; })],
    ['s', '병가', cntBy(function(r){ return r.cls === 's'; })],
    ['a', '결근', ca]];
  // ★한꺼번에 지정을 켜면 칩이 하나 더 붙는다 — 창을 따로 열지 않는다
  var bfd = bulkFilDef();
  if (bfd) fdef.unshift(bfd);
  // ★근무표는 조 편성표 차례 그대로 세운다. 종이 근무표가 그렇게 생겼고,
  // 배치표 순번대로 세우면 같은 사람이 날마다 다른 줄로 옮겨 다녀 눈이 못 따라간다
  var byName = {}, byJo = [], unset = [], j;
  wrows.forEach(function(r){ byName[r.n] = r; });
  // ★찾기와 거르개는 같이 걸린다
  var wq0 = String(wkQ || '').trim();
  var keep = function(r){ return wkKeep(r, wkFilter, wq0); };
  for (j = 0; j < JOCNT; j++)
    byJo.push(joMembers(j).map(function(n){ return byName[n]; }).filter(keep));
  wrows.forEach(function(r){ if (joOf(r.n) < 0 && keep(r)) unset.push(r); });
  var cols = byJo.map(function(list, ji){ return { t: JOLABEL[ji] || (ji + 1) + '조', list: list, un: false }; });
  if (unset.length) cols.push({ t: '조 미배정', list: unset, un: true });
  $('workTable').innerHTML = '<div class="wsr"><input id="wkQ" autocomplete="off" value="'
    + esc(wkQ) + '" placeholder="이름으로 찾기 — 두 글자만 쳐도 됩니다">'
    + (wq0 ? '<button class="x" data-act="wkqx">지움</button>' : '')
    + bulkBarHTML() + '</div>'
    + '<div class="wfil">'
    + fdef.map(function(f){
        return '<button data-wfil="' + f[0] + '" class="' + (wkFilter === f[0] ? 'on' : '') + '">'
          + f[1] + ' ' + f[2] + '</button>'; }).join('')
    + '</div><div id="wkList">' + wkListHTML() + '</div>';

  paintBulkFoot();
  var wq = $('wkQ');
  if (wq && hadQ){ wq.focus(); try { wq.setSelectionRange(wkQ.length, wkQ.length); } catch (e) {} }
  var nb = $('ntBody');
  if (nb && hadNt){ nb.focus(); try { nb.setSelectionRange(nb.value.length, nb.value.length); } catch (e) {} }

  // ── 아래: 오늘 경기과
  $('staffBox').innerHTML = '<h5>오늘 경기과'
    + '<button class="msb" data-msadd="1">마샬 늘리기</button></h5><div class="slots">'
    + STAFF.map(function(x, i){
        var rl = staffRole(i);
        return '<button class="slot" data-slot-staff="' + i + '">'
          + '<span class="k' + (x.fix ? ' fix' : '') + '">' + esc(x.k) + '</span>'
          + '<span class="v' + (x.n ? '' : ' none') + '">' + esc(x.n || '비어 있음') + '</span>'
          // ★시각은 마샬에만 적는다 — 대리·주임은 시각이 아무 것도 정하지 않는다.
          //   빈 칸을 남긴다 — 겪자 줄이 어긋나면 눈이 더 피곤하다
          + (x.k === '마샬' ? '<span class="tm2 num">' + esc(x.t || '—') + '</span>'
                              : '<span class="tm2"></span>')
          + (rl ? '<span class="rl2 ' + rl.c + '">' + rl.t + '</span>' : '<span class="e">고치기</span>')
          + '</button>'; }).join('')
    + '</div>';

  // ── 아래: 당번 — 종류는 설정에서, 사람은 여기서 누르면 바뀐다
  // ★당번 종류·성격은 여기서 바로 연다 — 쓰는 자리 옆에 있어야 찾는다.
  //   문은 그대로 하나다(설정의 그 칸). 두 벌로 만들면 둘이 조용히 갈라진다.
  $('dutyBox').innerHTML = '<h5>당번 <span class="hint">누르면 사람 · 끌면 차례</span>'
    + '<button class="msb" data-dtcfg="1">당번 종류</button></h5><div class="slots">'
    + DUTYKEYS.map(function(k){
        var who = dutyList(k);
        return '<button class="slot dslot" data-slot-duty="' + esc(k) + '" data-key="' + esc(k) + '">'
          + '<span class="grip" data-grip="1"></span>'
          + '<span class="k d' + dutyColor(k) + '">' + esc(dutyChip(k)) + '</span>'
          + '<span class="v' + (who.length ? '' : ' none') + '">'
          + (who.length
              ? who.map(function(x){
                  var sp = dutySpan(x);
                  return '<span class="who"><b>' + esc(x.n || '—') + '</b>'
                    + (sp ? '<i>' + esc(sp) + '</i>' : '') + '</span>'; }).join('')
              : '지정 없음')
          + '</span>'
          + (who.length > 1 ? '<span class="cnt num">' + who.length + '명</span>' : '')
          + '<span class="e">고치기</span></button>'; }).join('')
    + '</div>';

  // ── 아래: 부별 시간표
  $('railTime').innerHTML = '<h5>부별 시간표 · ' + GAP + '분 격자</h5><div class="tt">'
    + DAY.map(function(p){
        var g = gridTimes(p);
        return '<b>' + p.name + '</b><span>' + g[0] + ' ~ ' + g[g.length - 1] + '</span>'
          + '<span class="rg">' + p.tees.length + '팀</span>'; }).join('')
    + '</div>';

  // ── 아래: 고친 내역
  $('logsec').innerHTML = '<h5>오늘 고친 것 · ' + LOG.length + '건</h5>'
    + (LOG.length
        ? LOG.map(function(l, i){
            return '<div class="li"><i>' + (LOG.length - i) + '</i><span>' + esc(l.msg)
              + (l.moved ? ' · ' + l.moved + '명 영향' : '') + '</span></div>'; }).join('')
        : '<div class="em">아직 없습니다. 고칠 때마다 한 줄씩 쌓입니다.</div>');

  var n = LOG.length, un = unsaved();
  $('savebar').className = 'savebar' + (n || REDO.length ? ' on' : '');
  $('sbN').textContent = n ? n + '건 고쳤습니다' : '고친 것 없음';
  $('sbN').className = un ? 'un' : '';
  $('sbW').textContent = un ? '아직 저장 안 했습니다'
    : (savedAt ? '저장됨 · ' + savedAt : 'Ctrl+S 저장 · Ctrl+Z 되돌리기');
  var sv = $('btnSave');
  if (!sv.classList.contains('ok')) {
    sv.textContent = un ? '저장' : (savedAt ? '저장됨' : '저장');
    sv.disabled = !un;
    sv.classList.toggle('idle', !un);
  }
  $('btnRedo').disabled = !REDO.length;
  $('btnRedo').style.opacity = REDO.length ? '1' : '.45';
  $('btnUndo').disabled = !STACK.length;
  $('btnUndo').style.opacity = STACK.length ? '1' : '.45';
  if (typeof fit === 'function') fit();      // 팀이 늘고 줄면 필요한 높이도 달라진다
  if (!pick) pickList = [];        // 되돌리기 등으로 기계가 놓았으면 따라 놓는다
  var pn = pickList.map(function(x){ var r = part(x.pk).roster[x.ri]; return r ? r.n : '?'; });
  $('banner').className = 'banner' + (pn.length ? ' on' : '');
  $('bnGo').hidden = pn.length < 2;
  $('bnGo').textContent = pn.length > 2 ? '돌리기' : '맞바꾸기';
  if (pn.length === 1)
    $('bnTx').textContent = pn[0] + '와(과) 바꿀 사람을 고르세요 — 어느 부의 칸이든, 아래 휴무자든 됩니다'
      + ' · Ctrl 을 누른 채 누르면 셋 넷도 한 바퀴 돕니다';
  else if (pn.length === 2)
    $('bnTx').textContent = pn.join(' ↔ ') + ' — 두 자리를 맞바꿉니다';
  else if (pn.length > 2)
    $('bnTx').textContent = pn.join(' → ') + ' — ' + pn.length + '명이 한 바퀴 돕니다';
  if (drwOpen) drawDrawer();
  if (cfgOpen) drawCfg();
  wkScrollLoad(wkScroll);            // ★fit 이 크기를 다 잡은 뒤라야 자리가 맞는다
}

// 저장했다고 화면이 잠깐 말한다 — 기계는 이 함수만 부른다
// 열려 있는 당번 창을 지금 값으로 다시 그린다
function resyncSheet(){
  if (!sheetFor || !$('sheet').classList.contains('on')) return;
  // 찾기 창은 값이 바뀔 때마다 목록만 다시 그린다 — 통째로 열면 깜빡이가 달아난다
  if (sheetFor.kind === 'seatgo'){ drawSeatGo(false); return; }
  if (sheetFor.kind === 'ins'){ drawInsList(); return; }   // 통째로 열면 치던 칸이 죽는다
  if (sheetFor.kind === 'tee'){ openTeeTime(sheetFor.pk, sheetFor.i); return; }
  if (sheetFor.kind === 'bulkact'){ openBulkAct(); return; }
  if (sheetFor.kind !== 'duty') return;
  if (DUTYKEYS.indexOf(sheetFor.key) < 0) { closeSheet(); return; }
  openDuty(sheetFor.key);
}

function saveFlash(){
  var b = $('btnSave');
  b.classList.add('ok'); b.textContent = '저장했습니다';
  setTimeout(function(){ b.classList.remove('ok'); paint(); }, 1600);
}

// ── 칸 시트 ─────────────────────────────────
var sheetFor = null;
// 시각 고치기 — 이 칸만인지, 뒤 시간대도 같이 미는지 고른다.
// ★앞 팀이 안 빠져 뒤가 통째로 밀리는 날이 있다. 그때 한 칸씩 고치는 것은 벌이다
var teeRest = true;
// ★묶음을 고른 다음 '누구부터'를 정한다 — 시작점은 사람이 정하는 값이다.
//   바로 앉혀 버리면 기계가 선발을 멋대로 정한 꼴이 된다
var sgStart = '';
function openSeatGo(pk, i, key){
  sheetFor = { kind: 'seatgo', pk: pk, i: i, key: key };
  drawSeatGo(true);
}
function seatGoHTML(){
  var f = sheetFor, p = part(f.pk), no = seatGroupSeat(f.pk, f.i);
  var names = seatGroupNames(f.pk, f.key);
  if (sgStart && names.indexOf(sgStart) < 0) sgStart = '';
  var ord = seatManyOrder(names, sgStart);
  var rows = ord.map(function(n, k){
    var at = partsOf(n).map(function(q){
      var a = active(part(q)), ix = a.map(function(r){ return r.n; }).indexOf(n);
      return part(q).name + (ix >= 0 ? ' ' + seatNoTx(part(q), ix) + '번' : '');
    }).join(' · ');
    return '<button class="row" data-sgs="' + esc(n) + '">'
      + '<span class="p num">' + (no + k) + '</span>'
      + '<span class="nm">' + esc(n) + (k === 0 ? ' <b>첫 사람</b>' : '') + '</span>'
      + '<span class="wh">' + esc(at || '자리 없음') + '</span></button>';
  }).join('');
  return '<div class="grab"></div>'
    + '<div class="k">' + esc(p.name) + ' · ' + no + '번부터</div>'
    + '<div class="st">' + esc(f.key) + ' ' + names.length + '명 앉히기</div>'
    + '<div class="sub"><b>누구부터 앉힐지</b> 고르십시오. 고른 사람이 <b>' + no + '번</b>이 되고, '
    + '나머지는 <b>조 차례</b>로 뒤를 잇습니다 — 순번 세우기의 선발과 같은 규칙입니다.</div>'
    + '<div class="grp" style="padding-bottom:4px"><h4>누구부터 · 눌러서 바꿉니다</h4></div>'
    + '<div class="lst inswap">' + rows + '</div>'
    + '<div class="acts" style="margin:12px 14px"><button class="go" style="flex:1" '
    + 'data-act="sggo">이대로 ' + no + '~' + (no + ord.length - 1) + '번에 앉히기</button></div>'
    + '<div class="dnote" style="margin:0 14px 12px">뒤가 ' + ord.length + '칸 밀립니다 — '
    + '아무도 자리를 잃지 않습니다.</div>'
    + '<button class="close" data-act="close">닫기</button>';
}
function drawSeatGo(open){
  $('sheet').innerHTML = seatGoHTML();
  if (open) { $('scrim').classList.add('on'); $('sheet').classList.add('on'); }
}
// 끼워 넣기 — 그 자리에 들어가고 뒤가 밀린다. 맞바꾸기와 문을 나눠 둔다.
// ★조출·중복 근무처럼 순번을 사람이 못 박아야 하는 자리에 쓴다
var insQ = '';
function openInsert(pk, i){
  var p = part(pk), t = p.tees[i];
  sheetFor = { kind: 'ins', pk: pk, i: i };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">' + p.name + ' · 순번 ' + seatNoTx(p, i) + '번'
    + (t ? ' · ' + t.time + ' ' + t.course : ' · 대기') + '</div>'
    + '<div class="st">여기에 끼워 넣기</div>'
    + '<div class="sub">고른 사람이 <b>' + seatNoTx(p, i) + '번</b>이 되고 '
    + '<b>여기부터 뒤가 한 칸씩 밀립니다.</b> 맞바꾸기가 아닙니다 — 아무도 자리를 잃지 않습니다.</div>'
    + '<div class="grp" style="padding-bottom:4px"><h4>누구를 넣을까요</h4>'
    + '<div class="fld"><input id="insQ" autocomplete="off" placeholder="이름으로 찾기"></div>'
    + '<div class="dnote">조출·중복 근무처럼 <b>배지가 붙은 사람</b>은 순번 세우기가 '
    + '안 건드립니다 — 여기 넣어 두면 그 자리에 그대로 있습니다.</div></div>'
    + '<div class="lst inswap" id="insOut"></div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on'); $('sheet').classList.add('on');
  drawInsList();
  var qe = $('insQ');
  if (qe) qe.addEventListener('input', function(){ insQ = qe.value; drawInsList(); });
}
// ★목록만 다시 그린다 — 창을 통째로 다시 열면 한글 치던 칸이 죽는다
function drawInsList(){
  if (!sheetFor || sheetFor.kind !== 'ins') return;
  var pk = sheetFor.pk, me = sheetFor.i, q = (insQ || '').trim();
  var mine = part(pk), out = '';
  function row(nm, pos, where, tg){
    return '<button class="row" data-insn="' + esc(nm) + '">'
      + '<span class="p' + (pos ? ' num' : '') + '">' + (pos || '—') + '</span>'
      + '<span class="nm">' + esc(nm) + '</span>'
      + (tg ? '<span class="b">' + esc(tg) + '</span>' : '')
      + '<span class="wh">' + esc(where) + '</span></button>';
  }
  var seat = {};
  DAY.forEach(function(q2){ q2.roster.forEach(function(r){ if (r.n && !r.itn) seat[r.n] = 1; }); });
  var free = workRows().filter(function(r){ return !seat[r.n] && (!q || r.n.indexOf(q) >= 0); });
  if (free.length)
    out += '<div class="hd2">자리 없는 사람 · ' + free.length + '명</div>'
      + free.map(function(r){ return row(r.n, 0, r.st, tagOf(r.n)); }).join('');
  DAY.forEach(function(p){
    if (p.key === pk) return;
    var a = active(p), h = '', c = 0;
    a.forEach(function(r, j){
      if (!r.n || r.itn || (q && r.n.indexOf(q) < 0)) return;
      var t = p.tees[j];
      h += row(r.n, seatNo(p, j), (t ? t.time + ' ' + t.course : '대기'), r.tag); c++;
    });
    if (c) out += '<div class="hd2">' + esc(p.name) + ' · ' + c + '명</div>' + h;
  });
  var a2 = active(mine), h2 = '', c2 = 0;
  a2.forEach(function(r, j){
    if (!r.n || r.itn || j === me || (q && r.n.indexOf(q) < 0)) return;
    var t = mine.tees[j];
    h2 += row(r.n, seatNo(mine, j), (t ? t.time + ' ' + t.course : '대기'), r.tag); c2++;
  });
  if (c2) out += '<div class="hd2">' + esc(mine.name) + ' 안에서 자리만 옮기기 · ' + c2 + '명</div>' + h2;
  $('insOut').innerHTML = out || '<div class="empty">'
    + (q ? esc(q) + ' — 오늘 명단에 없습니다' : '넣을 사람이 없습니다') + '</div>';
}
function openTeeTime(pk, i){
  var p = part(pk), t = p.tees[i];
  if (!t) return;
  var after = p.tees.filter(function(x, k){ return k !== i && mm(x.time) >= mm(t.time); }).length;
  sheetFor = { kind: 'tee', pk: pk, i: i };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">' + p.name + ' · ' + t.time + ' ' + t.course + '</div>'
    + '<div class="st">티오프 시각 고치기</div>'
    + '<div class="sub">앞 팀이 안 빠져 <b>뒤가 통째로 밀리는 날</b>이 있습니다. '
    + '그럴 때는 아래를 켜 두십시오.</div>'
    + '<div class="grp"><h4>새 시각</h4>'
    + '<div class="fld">' + timeInput('id="ttTime" class="tf"', t.time) + '</div></div>'
    + '<div class="grp"><h4>어디까지 고칠까요</h4>'
    + '<button class="copt' + (teeRest ? ' on' : '') + '" data-ttr="1">'
    + '<span class="cx">' + (teeRest ? '\u2713' : '') + '</span>'
    + '<span class="cn">뒤 시간대도 같이 밀기<i>' + t.time + ' 뒤 ' + after + '팀이 같은 만큼 밀립니다</i></span>'
    + '<span class="cs">' + (teeRest ? '밉니다' : '안 밉니다') + '</span></button>'
    + '<div class="dnote">끄면 <b>이 칸 하나만</b> 고칩니다. '
    + GAP + '분 격자에 안 맞아도 됩니다 — 끼워 넣는 날이 있습니다.</div></div>'
    + '<div class="acts" style="margin:0 14px"><button class="go" style="flex:1" '
    + 'data-act="ttsave">고치기</button></div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on'); $('sheet').classList.add('on');
}
function openCell(pk, i){
  var p = part(pk), a = active(p), r = a[i], t = p.tees[i];
  sheetFor = { pk: pk, i: i };
  var here = {}, sug = '';
  DAY.forEach(function(q){
    var aq = active(q);
    for (var j = q.tees.length; j < aq.length; j++){
      if (q.key === pk && j === i) continue;
      if (here[aq[j].n]) continue;
      here[aq[j].n] = 1;
      sug += '<button data-n="' + esc(aq[j].n) + '">'
        + (q.key !== pk ? '<i>' + q.name + '</i>' : '') + esc(aq[j].n) + '</button>';
    }
  });
  var h = '<div class="grab"></div>'
    + '<div class="k">' + p.name + ' · '
    + (isItn(r) ? '인턴 칸' : '순번 ' + seatNoTx(p, i) + '번')
    + (t ? ' · ' + t.time + ' ' + t.course + (offGrid(p, t.time) ? ' (격자 밖)' : '') : ' · 대기') + '</div>'
    + '<div class="st">' + ((r && r.n) ? esc(r.n) : '비어 있음') + '</div>'
    + '<div class="sub">' + (t ? '이 자리는 ' + t.time + '에 ' + t.course + '으로 나갑니다' : '티오프가 없는 대기 자리입니다') + '</div>'

    // ★빈 칸에는 '바꾸기'가 아니라 '앉히기'다.
    //   바꾸기는 글자를 칸에 그대로 써 넣을 뿐이라 명부에 없는 이름도 들어가고,
    //   그 사람이 있던 자리에서 안 빠지고 근태도 안 풀린다.
    //   빈 자리는 앉히는 자리다 — 이름을 치면 명부에서 찾아 그 순번에 앉힌다.
    //   사람이 앉아 있는 칸은 그대로 둔다. 거기서는 '바꾸기'가 제 뜻이 있다
    + ((r && r.n)
      ? '<div class="grp"><h4>이 사람</h4>'
        + '<div class="fld"><input id="shName" value="' + esc(r.n) + '" autocomplete="off" placeholder="이름">'
        + '<button data-act="name">바꾸기</button></div>'
        + '<div class="sug">' + (sug || '<span style="font-size:12.5px;color:#8b96a2;font-weight:760">대기 중인 캐디가 없습니다</span>') + '</div>'
        + '<div class="acts" style="margin-top:11px">'
        + '<button data-act="swap">다른 자리와 바꾸기</button>'
        + '<button data-act="role" data-v="당번" class="' + (r && r.role === '당번' ? 'on' : '') + '">당번</button>'
        + '<button data-act="role" data-v="벌당" class="' + (r && r.role === '벌당' ? 'on' : '') + '">벌당</button>'
        + '<button data-act="off" class="warn">결근 처리</button>'
        + '<button data-act="prmhere" class="warn">이 부에서 빼기</button>'
        + '</div>'
        + '<div class="dnote"><b>결근</b>은 명단에 이름을 남기고 자리만 뺍니다. '
        + '<b>이 부에서 빼기</b>는 명단에서 아예 뺍니다 — 뒤 순번이 당겨집니다.</div></div>'
      : '<div class="grp"><h4>여기(' + seatNoTx(p, i) + '번)에 앉히기</h4>'
        + '<div class="fld"><input id="seatQ" autocomplete="off" '
        + 'placeholder="이름을 치십시오 — 두 글자만 쳐도 됩니다"><button data-act="seatgo">앉히기</button></div>'
        + '<div class="lst inswap" id="seatOut"></div>'
        + '<div class="acts" style="margin-top:11px">'
        + '<button data-act="swap">다른 자리와 바꾸기</button></div>'
        + '<div class="dnote">이름을 치면 <b>명부에서 찾아</b> 이 순번에 앉힙니다 — '
        + '뒤 순번은 <b>안 밀립니다.</b> 쉬는 배지가 붙어 있으면 앉는 순간 근무로 돌아옵니다. '
        + '되돌리기(Ctrl+Z) 한 번으로 그대로 돌아옵니다.</div></div>')
    + (t ? '' : '<div class="grp"><h4>대기는 여기까지</h4>'
        + '<div class="acts"><button data-capto="' + p.key + '|' + seatNoTx(p, i) + '" style="flex:1">'
        + seatNoTx(p, i) + '번까지만 대기로</button>'
        + (spareCap(p.key) ? '<button data-capto="' + p.key + '|0">제한 없앰</button>' : '')
        + '</div>'
        + '<div class="dnote">순번 세우기가 남는 사람을 대기로 세울 때 <b>여기서 끊습니다.</b> '
        + '넘는 사람은 <b>미배치</b>로 남습니다 — 오늘 못 나온다는 뜻이 아니라 '
        + '<b>아직 자리를 안 줬다</b>는 뜻이고 가용에 그대로 듭니다.<br>'
        + '<b>손으로 넣는 것은 안 막습니다</b> — 넘으면 기록에 적어 둡니다.'
        + (spareCap(p.key) ? '<br>지금은 <b>' + spareLastNo(p) + '번까지</b>입니다.' : '')
        + '</div></div>')
    + '<div class="grp"><h4>순번 중간에 끼워 넣기</h4>'
    + '<div class="acts"><button data-act="ins" class="go" style="flex:1">'
    + '여기(' + seatNoTx(p, i) + '번)에 끼워 넣기</button></div>'
    + '<div class="dnote">고른 사람이 <b>' + seatNoTx(p, i) + '번</b>이 되고 '
    + '<b>뒤가 한 칸씩 밀립니다.</b> 위의 맞바꾸기는 둘이 자리를 주고받아 아무도 안 밀립니다 — '
    + '<b>조출·중복 근무</b>를 제자리에 못 박을 때는 이쪽입니다.</div></div>'
    + (function(){
        // ★조출·후출·중복 근무를 배지별로 묶어 여기부터 앉힌다 — 이름을 하나씩 안 골라도 된다.
        // ★부를 사람이 없어도 칸은 남긴다 — 사라지면 없는 기능이 된다
        var gs = isItn(r) ? [] : seatGroups(pk);
        var tt = 0;
        gs.forEach(function(x){ tt += x.names.length; });
        return '<div class="grp"><h4>여기(' + seatNoTx(p, i) + '번)부터 한꺼번에 앉히기</h4>'
          + (gs.length
             ? '<div class="acts">' + gs.map(function(x){
                 return '<button class="go" data-sg="' + esc(pk + '|' + i + '|' + x.key) + '">'
                   + esc(x.label) + ' ' + x.names.length + '명</button>'; }).join('') + '</div>'
               + '<div class="dnote" style="margin-top:9px">누르면 그 사람들이 <b>'
               + seatNoTx(p, i) + '번부터 차례로 앉고 뒤가 그만큼 밀립니다</b> — '
               + '아무도 자리를 잃지 않습니다. 차례는 조 편성이 정합니다.<br>'
               + '그 다음 <b>순번 세우기</b>를 누르면 나머지가 사이를 채우고, '
               + '여기 앉힌 자리는 안 건드립니다.</div>'
             : '<div class="dnote">지금 부를 사람이 없습니다. 여기 모이는 사람은 둘입니다 — '
               + '<b>조출·후출</b> 배지를 달았는데 <b>아직 어느 부에도 자리가 없는 사람</b>, '
               + '그리고 <b>54h·2,3·1,3</b> 같은 중복 근무 표시를 달았는데 '
               + '<b>' + esc(p.name) + '에 아직 자리가 없는 사람</b>.<br>'
               + '배지는 <b>근무표 → 캐디 선택 → 한꺼번에 바꾸기</b>에서 답니다.</div>')
               + (function(){
                   // ★안 부른 사람이 있으면 까닭을 적는다
                   var w = seatGroupsWhy(pk), ln = [];
                   function nm(L){ return L.slice(0, 3).join('·') + (L.length > 3 ? ' 외 ' + (L.length - 3) + '명' : ''); }
                   if (w.otherOnly.length) ln.push('<b>' + nm(w.otherOnly) + '</b>은(는) 다른 부에만 자리가 있습니다 — '
                     + '여기 넣으면 중복 근무가 되므로, 위의 <b>끼워 넣기</b>로 하나씩 넣으십시오');
                   if (w.otherPart.length) ln.push('<b>' + nm(w.otherPart) + '</b>의 중복 표시('
                     + esc(w.otherPart.map(function(x){ return dayMark(x); }).filter(function(v, k, A){ return A.indexOf(v) === k; }).join('·'))
                     + ')는 ' + esc(p.name) + '가 아닙니다');
                   if (w.rest.length) ln.push('<b>' + nm(w.rest) + '</b>은(는) 쉬는 날입니다');
                   return ln.length ? '<div class="dnote" style="margin-top:9px">' + ln.join('<br>') + '</div>' : '';
                 })()
          + '</div>';
      })()
    + '<div class="grp"><h4>인턴</h4>'
    + (isItn(r)
       ? '<div class="fld"><input id="itnName" value="' + esc(r.n) + '" autocomplete="off" placeholder="인턴 이름">'
         + '<button data-act="itnname">이름 고치기</button></div>'
         + '<div class="acts" style="margin-top:11px">'
         + '<button data-act="itnoff" class="warn">인턴 풀기</button></div>'
         + '<div class="dnote">이 칸은 <b>인턴</b>입니다 — 티오프는 차지하지만 '
         + '<b>순번을 안 씁니다.</b> 풀면 이 칸이 없어지고 뒤 캐디가 '
         + '<b>한 칸씩 앞 티오프로</b> 옵니다 — 캐디 번호는 그대로입니다.</div>'
       : '<div class="fld"><input id="itnName" value="" autocomplete="off" placeholder="인턴 이름 (비우면 그냥 인턴)">'
         + '<button data-act="itnon">여기에 인턴 끼워 넣기</button></div>'
         + '<div class="dnote">인턴은 <b>티오프는 차지하되 순번은 안 씁니다.</b> '
         + '조 편성 명단 밖 사람이라 <b>총원·가용에도 안 듭니다.</b><br>'
         + '여기에 <b>끼워 넣습니다</b> — 뒤 캐디들은 한 칸씩 <b>뒤 티오프로</b> 가고 '
         + '<b>번호는 그대로입니다.</b> 아무도 자리를 잃지 않습니다.'
         + (r && r.n && !isItn(r) ? '<br>지금 이 칸의 <b>' + esc(r.n) + '</b>은(는) '
             + '<b>' + seatNoTx(p, i) + '번 그대로</b> 한 칸 뒤 티오프로 갑니다.' : '')
         + '</div>')
    + '</div>'
    + (isItn(r) ? '' : (r ? dayTagGrp(r.n) : ''));

  if (t){
    h += '<div class="grp"><h4>이 팀</h4>'
      + '<div class="fld">' + timeInput('id="shTime" class="tf"', t.time)
      + '<button data-act="time">시각 고치기…</button></div>'
      + '<div class="acts" style="margin-top:11px">'
      + COURSES.filter(function(ck){ return ck !== t.course; }).map(function(ck){
          return '<button data-act="course" data-v="' + esc(ck) + '">'
            + esc(cname(t.course)) + ' → ' + esc(cname(ck)) + '</button>'; }).join('')
      + '<button data-act="pax" data-v="4" class="' + (t.pax === 4 ? 'on' : '') + '">4인</button>'
      + '<button data-act="pax" data-v="3" class="' + (t.pax === 3 ? 'on' : '') + '">3인</button>'
      + '<button data-act="pax" data-v="2" class="' + (t.pax === 2 ? 'on' : '') + '">2인</button>'
      + '<button data-act="cx" class="warn">' + (t.cx ? '취소 풀기' : '취소 · 노쇼') + '</button>'
      + '<button data-act="delteam" class="warn">팀 지움</button>'
      + '</div>'
      + '<div class="dnote">취소는 <b>칸을 남기고</b> 표시만 합니다. 팀 지움은 칸까지 없애 뒤 시각이 당겨집니다.</div></div>';
  }
  h += '<button class="close" data-act="close">닫기</button>';
  $('sheet').innerHTML = h;
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
  // ★빈 칸이면 이름 칸에 손을 얹어 준다 — 누르자마자 치면 된다
  var sqe = $('seatQ');
  if (sqe){
    seatQ = ''; drawSeatPick();
    sqe.addEventListener('input', function(){ seatQ = sqe.value; drawSeatPick(); });
    setTimeout(function(){ try { sqe.focus(); } catch (e) {} }, 60);
  }
}
// ★빈 자리에 앉힐 사람 고르기 — 목록만 다시 그린다.
//   창을 통째로 다시 열면 한글 치던 칸이 죽는다(끼워 넣기와 같은 규칙)
var seatQ = '';
function drawSeatPick(){
  var el = $('seatOut');
  if (!el || !sheetFor || sheetFor.pk === undefined) return;
  var pk = sheetFor.pk, i = sheetFor.i, q = (seatQ || '').trim();
  var p = part(pk), a = active(p), me = a[i], seen = {}, out = '';
  // ★대기 순번 만들기일 때는 '이 부 대기'를 안 보여 준다 — 이미 대기인 사람을
  //   대기 맨 뒤로 옮기는 것은 하는 일이 없고, addRow 도 되돌려보낸다
  var sp = !!(sheetFor && sheetFor.spare);
  function row(nm, pos, where, tg){
    return '<button class="row" data-seatn="' + esc(nm) + '">'
      + '<span class="p' + (pos ? ' num' : '') + '">' + (pos || '\u2014') + '</span>'
      + '<span class="nm">' + esc(nm) + '</span>'
      + (tg ? '<span class="b">' + esc(tg) + '</span>' : '')
      + '<span class="wh">' + esc(where) + '</span></button>';
  }
  function hit(n){ return n && (!q || n.indexOf(q) >= 0); }
  var seat = {};
  DAY.forEach(function(q2){ q2.roster.forEach(function(r){ if (r.n && !r.itn) seat[r.n] = 1; }); });
  // ⓪ ★찾근 — 자기가 순번을 골라 오는 사람이다. 맨 위에 둔다.
  //    "저는 7번 주세요" 하고 온 사람을, 그 7번 칸을 열자마자 찾을 수 있어야 한다
  var cg = allPeople().filter(function(n){
    return tagOf(n) === '찾근' && !seat[n] && hit(n); });
  if (cg.length)
    out += '<div class="hd2">찾근 · ' + cg.length + '명 \u2014 본인이 순번을 고릅니다</div>'
      + cg.map(function(n){ seen[n] = 1; return row(n, 0, '자리 고르는 중', '찾근'); }).join('');
  // ① 이 부에서 대기 중인 사람 — 올려 앉히는 것이라 아무도 자리를 안 잃는다
  var wait = [], j;
  if (!sp) for (j = p.tees.length; j < a.length; j++)
    if (a[j] !== me && !a[j].itn && hit(a[j].n)) wait.push({ n: a[j].n, j: j });
  if (wait.length)
    out += '<div class="hd2">' + esc(p.name) + ' 대기 · ' + wait.length + '명</div>'
      + wait.map(function(x){ seen[x.n] = 1;
          return row(x.n, seatNo(p, x.j), '대기 \u2192 ' + seatNoTx(p, i) + '번', tagOf(x.n)); }).join('');
  // ② ★이 부에서 근무하기로 지정해 둔 사람 — 근무표에서 정해 놓은 것이니 먼저 보여 준다.
  //    지정해 놓고 앉힐 때 또 찾아 헤매면 지정한 값어치가 없다
  var plan = workRows().filter(function(r){
    return !seat[r.n] && !seen[r.n] && hit(r.n) && inPlan(r.n, pk); });
  if (plan.length)
    out += '<div class="hd2">' + esc(p.name) + ' 근무로 지정한 사람 · ' + plan.length + '명</div>'
      + plan.map(function(r){ seen[r.n] = 1; return row(r.n, 0, r.st, tagOf(r.n)); }).join('');
  // ③ 어느 부에도 자리가 없는 사람
  var free = workRows().filter(function(r){ return !seat[r.n] && !seen[r.n] && hit(r.n); });
  if (free.length)
    out += '<div class="hd2">자리 없는 사람 · ' + free.length + '명</div>'
      + free.map(function(r){ seen[r.n] = 1; return row(r.n, 0, r.st, tagOf(r.n)); }).join('');
  // ④ 다른 부에 서 있는 사람 — 여기 앉히면 중복 근무가 된다. 까닭을 적어 준다
  DAY.forEach(function(q2){
    if (q2.key === pk) return;
    var aq = active(q2), h2 = '', c = 0;
    aq.forEach(function(r, k){
      if (!r.n || r.itn || seen[r.n] || !hit(r.n)) return;
      var t2 = q2.tees[k];
      h2 += row(r.n, seatNo(q2, k), (t2 ? t2.time + ' ' + t2.course : '대기'), r.tag); c++;
    });
    if (c) out += '<div class="hd2">' + esc(q2.name) + ' · ' + c
      + '명 \u2014 여기 앉히면 중복 근무입니다</div>' + h2;
  });
  el.innerHTML = out || '<div class="em" style="padding:11px">'
    + (q ? '<b>' + esc(q) + '</b>에 맞는 이름이 없습니다' : '앉힐 사람이 없습니다') + '</div>';
}
// ★대기 순번 만들기 — 빈 자리에 앉히는 창을 그대로 쓴다.
//   창이 하나여야 손에 익는다. 다른 점은 하나뿐이다 — 아직 줄이 없으므로
//   앉히는 것이 아니라 맨 뒤에 붙인다(addRow)
// ★대기를 몇 번까지 둘지 — 번호를 직접 친다
function openSpareCap(pk){
  var p = part(pk), now = spareLastNo(p), w = workLastNo(p);
  sheetFor = { pk: pk, i: null, cap: true };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">' + esc(p.name) + ' · 대기</div>'
    + '<div class="st">대기는 몇 번까지</div>'
    + '<div class="sub">' + (p.tees.length ? '근무는 ' + w + '번까지입니다 — 대기는 '
        + (w + 1) + '번부터입니다' : '아직 팀이 없습니다') + '</div>'
    + '<div class="grp"><h4>마지막 대기 순번</h4>'
    + '<div class="fld"><input id="capNo" type="number" min="0" max="200" value="'
    + (now || '') + '" placeholder="예: ' + (w + 5) + '"><button data-act="capgo">정함</button></div>'
    + '<div class="acts" style="margin-top:11px">'
    + [3, 5, 10].map(function(k){
        return '<button data-capto="' + pk + '|' + (w + k) + '">' + (w + k) + '번까지</button>'; }).join('')
    + '<button data-capto="' + pk + '|0" class="warn">제한 없앰</button></div>'
    + '<div class="dnote">순번 세우기가 자리를 다 채우고 남은 사람을 대기로 세울 때 '
    + '<b>여기서 끊습니다.</b> 넘는 사람은 <b>미배치</b>로 남습니다 — '
    + '오늘 못 나온다는 뜻이 아니라 <b>아직 자리를 안 줬다</b>는 뜻이고 <b>가용</b>에 그대로 듭니다.<br>'
    + '<b>손으로 넣는 것은 안 막습니다</b> — 넘으면 기록에 적어 둡니다.</div></div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
  var ce = $('capNo');
  if (ce) setTimeout(function(){ try { ce.focus(); } catch (e) {} }, 60);
}
function openSpareAdd(pk){
  var p = part(pk), no = nextSeatNo(p);
  sheetFor = { pk: pk, i: active(p).length, spare: true };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">' + esc(p.name) + ' · 대기</div>'
    + '<div class="st">대기 ' + no + '번</div>'
    + '<div class="sub">티오프가 없는 자리입니다 — 맨 뒤에 붙고 앞 순번은 안 밀립니다</div>'
    + '<div class="grp"><h4>여기(' + no + '번)에 앉히기</h4>'
    + '<div class="fld"><input id="seatQ" autocomplete="off" '
    + 'placeholder="이름을 치십시오 — 두 글자만 쳐도 됩니다"><button data-act="seatgo">앉히기</button></div>'
    + '<div class="lst inswap" id="seatOut"></div>'
    + '<div class="dnote">이름을 치면 <b>명부에서 찾아</b> 대기 맨 뒤에 세웁니다. '
    + '쉬는 배지가 붙어 있으면 넣는 순간 <b>근무</b>로 돌아옵니다. '
    + '티오프를 받으려면 그다음 <b>순번 세우기</b>를 누르거나 빈 칸에 직접 앉히십시오. '
    + '되돌리기(Ctrl+Z) 한 번으로 그대로 돌아옵니다.</div></div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
  var sqe = $('seatQ');
  seatQ = ''; drawSeatPick();
  sqe.addEventListener('input', function(){ seatQ = sqe.value; drawSeatPick(); });
  setTimeout(function(){ try { sqe.focus(); } catch (e) {} }, 60);
}
function openAddTeam(pk){
  var p = part(pk);
  sheetFor = { pk: pk, i: null, add: true };
  var last = p.tees.length ? p.tees[p.tees.length - 1] : { time: '7:00' };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">' + p.name + '</div><div class="st">팀 추가</div>'
    + '<div class="sub">넣으면 시각순으로 자리를 다시 맞추고, 대기 첫 사람이 근무가 됩니다</div>'
    + '<div class="grp"><h4>시각</h4>'
    + '<div class="fld">' + timeInput('id="adTime" class="tf"', hm(mm(last.time) + GAP))
    + '</div>'
    + '<div class="acts" style="margin-top:11px">'
    + '<button class="on" data-act="addteam">넣기</button></div>'
    + '<div class="dnote">' + GAP + '분 격자에 <b>맞추지 않아도 됩니다</b> — 끼워 넣는 날이 있습니다.</div></div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}
// 지우기는 한 번 더 묻는다 — 되돌릴 수 있어도, 놀라는 것 자체가 사고를 부른다
function confirmDelPart(pk){
  if (DAY.length <= 1) { toast('부는 하나는 있어야 합니다'); return; }
  var p = part(pk);
  sheetFor = { pk: pk, i: null, partKey: pk };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">확인</div><div class="st">' + esc(p.name) + '를 지웁니다</div>'
    + '<div class="warnbox"><b>' + p.tees.length + '팀과 명단 ' + p.roster.length
    + '명이 함께 사라집니다.</b><br>이 부에 잡혀 있던 티오프도 같이 없어집니다.</div>'
    + '<div class="calmbox">잘못 눌러도 <b>바로 되살릴 수 있습니다.</b> '
    + '화면 오른쪽 위 <b>되돌리기</b> 단추를 누르거나 <b>Ctrl+Z</b>를 치면 지우기 직전으로 돌아갑니다. '
    + '저장을 누르기 전이라면 새로고침만 해도 됩니다.</div>'
    + '<div class="acts two"><button data-act="pdelyes" class="warn on">지웁니다</button>'
    + '<button data-act="close">그만두기</button></div>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}
// 코스를 지울 때도 한 번 묻는다 — 열 하나가 통째로 없어지는 일이다
function confirmDelCourse(k){
  if (COURSES.length <= 1) { toast('코스는 하나는 있어야 합니다'); return; }
  if (courseUsed(k)) { toast(cname(k) + '에 선 팀이 있습니다 — 팀을 옮기고 지우십시오'); return; }
  sheetFor = { pk: null, i: null, courseKey: k };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">확인</div><div class="st">' + esc(cname(k)) + ' 코스를 지웁니다</div>'
    + '<div class="warnbox"><b>배치표에서 ' + esc(cname(k)) + ' 열이 없어집니다.</b><br>'
    + '이 코스에 선 팀은 없습니다 — 있었다면 지워지지 않습니다.'
    + (COURSES.length === 3 ? '<br>코스가 둘이 되면 시각이 다시 가운데로 갑니다.' : '') + '</div>'
    + '<div class="calmbox">잘못 눌러도 <b>바로 되살릴 수 있습니다.</b> '
    + '화면 오른쪽 위 <b>되돌리기</b> 단추를 누르거나 <b>Ctrl+Z</b>를 치면 지우기 직전으로 돌아갑니다.</div>'
    + '<div class="acts two"><button data-act="cdelyes" class="warn on">지웁니다</button>'
    + '<button data-act="close">그만두기</button></div>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}
function closeSheet(){
  $('sheet').classList.remove('on');
  sheetFor = null;
  // 서랍(순번·명단·설정) 위에서 닫힌 것이라면 어두운 막은 서랍 몫으로 남긴다
  if (!drwOpen && !cfgOpen && !logOpen) $('scrim').classList.remove('on');
}

function seatBtn(s){
  if (pick && pick.pk === s.pk && pick.ri === s.ri)
    return '<button disabled><i>지금 고른 자리</i></button>';
  var why = dupReason(pick, { pk: s.pk, ri: s.ri });
  return '<button data-swapto="' + s.pk + ':' + s.ri + '"' + (why ? ' disabled' : '') + '>'
    + esc(s.label) + (why ? ' <i style="color:#a33b3b">' + esc(why) + '</i>' : '') + '</button>';
}
// setStaff 는 기계로 옮겼다 — 자리를 넣으면 배지도 같이 바뀌는 일이라 core 몫이다
// 당번 자리는 이름이 여럿일 수 있다 — 저장은 한 줄, 다루기는 목록으로
function setDutyName(k, i, v){
  var a = dutyList(k);
  if (!a[i] || a[i].n === v) return;
  var b = whereMap(); snap();
  var was = a[i].n;
  a[i].n = v;
  syncDutyTag(k, was ? [was] : [], v ? [v] : []);
  commit(k + ' ' + (was || '공백') + ' → ' + (v || '공백'), b);
}
function dutyDel(k, i){
  var a = dutyList(k).slice();
  if (!a[i]) return;
  a.splice(i, 1);
  setDutyList(k, a);
}
// 한 사람의 근무 시간만 고친다
function setDutyHour(k, i, v){
  var a = dutyList(k);
  if (!a[i]) return;
  var h = hrNum(v), was = a[i].h || 0;
  if (was === h) return;
  var b = whereMap(); snap();
  a[i].h = h;
  commit(k + ' ' + (a[i].n || (i + 1) + '번') + ' 근무 ' + (was ? hrText(was) : '없음')
    + ' → ' + (h ? hrText(h) : '없음')
    + (a[i].t && h ? ' (' + a[i].t + '~' + endT(a[i].t, h) + ')' : ''), b);
}
// 새로 넣을 때 딸려 올 기본값 — 시각과 근무 시간
function dutyApplyDef(k){
  var d = defOf(k), a = dutyList(k);
  if (!a.length) { toast('아직 아무도 없습니다'); return; }
  var t = d.t || '', h = d.h || 0, same = true;
  a.forEach(function(x){ if ((x.t || '') !== t || (x.h || 0) !== h) same = false; });
  if (same) { toast('이미 모두 같습니다'); return; }
  var b = whereMap(); snap();
  a.forEach(function(x){ x.t = t; x.h = h; });
  commit(k + ' ' + a.length + '자리 모두 ' + (dutySpan({ n: '', t: t, h: h }) || '시각 없음') + '으로', b);
}
// ── 끌어서 순서 바꾸기 ────────────────────────────
// 손잡이를 쥐고 끌면 줄이 그 자리에서 바로 밀린다. 마우스·손가락 둘 다 된다.
// 위로/아래로 단추를 줄마다 두면 여백을 많이 먹어서 손잡이 하나로 갈음한다.
var sortBlock = 0;                    // 끌고 난 직후의 누름은 삼킨다
function sortable(box, sel, done){
  var cur = null;
  function rowAt(y){
    var rs = box.querySelectorAll(sel);
    for (var i = 0; i < rs.length; i++){
      var b = rs[i].getBoundingClientRect();
      if (y >= b.top && y <= b.bottom) return rs[i];
    }
    return null;
  }
  box.addEventListener('pointerdown', function(e){
    if (e.button) return;
    var h = e.target.closest('[data-grip]');
    if (!h) return;
    var r = h.closest(sel);
    if (!r || box.querySelectorAll(sel).length < 2) return;
    e.preventDefault();
    cur = r; sortBlock = 1;
    r.classList.add('dragging');
    box.classList.add('sorting');
    try { h.setPointerCapture(e.pointerId); } catch (x) { /* 옛 브라우저 */ }
  });
  box.addEventListener('pointermove', function(e){
    if (!cur) return;
    e.preventDefault();
    var over = rowAt(e.clientY);
    if (!over || over === cur || over.parentNode !== cur.parentNode) return;
    var b = over.getBoundingClientRect();
    cur.parentNode.insertBefore(cur, (e.clientY - b.top) > b.height / 2 ? over.nextSibling : over);
  });
  function end(){
    if (!cur) return;
    cur.classList.remove('dragging');
    box.classList.remove('sorting');
    var moved = cur.getAttribute('data-key');
    cur = null;
    var rs = box.querySelectorAll(sel), order = [];
    for (var i = 0; i < rs.length; i++) order.push(rs[i].getAttribute('data-key'));
    setTimeout(function(){ sortBlock = 0; }, 0);
    done(order, moved);
  }
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}
// 한 당번 안에서 사람 차례 — 먼저 적힌 사람이 1번이다
function dutyOrder(k, order){
  var a = dutyList(k), next = [], same = true;
  if (order.length !== a.length) return;         // 못 맞추면 손대지 않는다
  for (var i = 0; i < order.length; i++){
    var j = Number(order[i]);
    if (!a[j]) return;
    if (j !== i) same = false;
    next.push(a[j]);
  }
  if (same) return;
  var b = whereMap(); snap();
  DUTY[k] = next;
  commit(k + ' 차례 · ' + next.map(function(x){ return x.n || '공백'; }).join('·'), b);
}
// 당번 칸 자체의 차례 — 배치표에 뜨는 순서가 바뀐다
function dtOrder(order){
  if (order.join('|') === DUTYKEYS.join('|')) return;
  cfgChange('당번 칸 차례 · ' + order.join(' · '), function(){ DUTYKEYS = order.slice(); });
}
// 당번 고치기 — 누구든(오늘 안 나온 사람도) 세울 수 있고 여러 명도 된다
function openDuty(k){
  sheetFor = { slot: true, kind: 'duty', key: k };
  var cur = dutyList(k), curN = dutyNames(k);
  var seen = {}, onBoard = [], rest = [];
  DAY.forEach(function(p){ active(p).forEach(function(r){
    if (!seen[r.n]) { seen[r.n] = 1; onBoard.push(r.n); } }); });
  JONAMES.forEach(function(n){ if (!seen[n]) { seen[n] = 1; rest.push(n); } });
  var cands = onBoard.concat(rest), onSet = {};
  onBoard.forEach(function(n){ onSet[n] = 1; });
  $('sheet').innerHTML = '<div class="grab"></div><div class="k">오늘 당번</div>'
    + '<div class="st">' + esc(k) + '</div>'
    + '<div class="sub"><b>날마다 사람이 바뀌는 자리입니다.</b> 아래에서 이름을 누르면 넣습니다. '
    + '여러 명도 되고, <b>이름 없이 자리만</b> 잡아 둬도 됩니다.</div>'
    + '<div class="grp"><h4>지금 ' + esc(k) + ' — ' + (function(){
        var named = 0;
        cur.forEach(function(x){ if (x.n) named++; });
        var blank = cur.length - named;
        return blank ? cur.length + '자리 · 이름 ' + named + ' · 공백 ' + blank : cur.length + '명';
      })() + '</h4>'
    + (cur.length
        ? '<div class="dlist">' + cur.map(function(x, i){
            return '<div class="drow" data-key="' + i + '">'
              + '<span class="grip" data-grip="1"></span>'
              + '<i class="num">' + (i + 1) + '</i>'
              + '<input type="text" class="dnm" data-dutyname="' + i + '" value="' + esc(x.n)
              + '" placeholder="이름 없음" autocomplete="off">'
              + '<button class="x" data-dutydel="' + i + '">빼기</button>'
              + '<div class="dsp">'
              + '<span class="fl"><em>시작</em>'
              + timeInput('class="dtm" data-dutytime="' + i + '"', x.t) + '</span>'
              + '<span class="fl"><em>근무</em>'
              + '<input type="number" class="dhr" data-dutyhour="' + i + '" value="'
              + (x.h || '') + '" min="0" max="24" step="0.5"><em>시간</em></span>'
              + '<span class="til">' + (x.t && x.h ? '끝 ' + endT(x.t, x.h) : '') + '</span>'
              + '</div></div>'; }).join('')
          + '</div>'
          + '<div class="dnote">이름은 <b>비워 둬도 됩니다</b> — 자리와 시각만 먼저 잡고 사람은 나중에 넣습니다. '
          + '시각도 근무 시간도 사람마다 따로 둡니다.'
          + (cur.length > 1 ? '<br>위에 적힌 사람이 <b>1번</b>입니다 — <b>왼쪽 손잡이를 끌어</b> 차례를 바꿉니다.' : '')
          + '</div>'
        : '<div class="dnone">아직 아무도 없습니다</div>')
    + '</div>'
    + '<div class="grp"><h4>사람 넣기</h4><div class="fld">'
    + '<input id="dutyQ" autocomplete="off" placeholder="이름 일부만 쳐도 됩니다 · 비워 둬도 됩니다">'
    + '<button data-act="dutyadd">넣기</button></div>'
    + '<div class="dsp mt">'
    + '<span class="fl"><em>기본</em>' + timeInput('id="dutyT" class="dtm"', defOf(k).t) + '</span>'
    + '<span class="fl"><em>근무</em><input type="number" id="dutyH" value="'
    + (defOf(k).h || '') + '" min="0" max="24" step="0.5"><em>시간</em></span>'
    + '<span class="til">' + (defOf(k).t && defOf(k).h ? '끝 ' + endT(defOf(k).t, defOf(k).h) : '') + '</span>'
    + '</div>'
    + (cur.length ? '<div class="acts mt2"><button data-act="dutyapply">서 있는 ' + cur.length
        + '자리 모두 이 값으로</button></div>' : '')
    + '<div class="dnote">시각은 <b>24시간</b>으로 적습니다 — 오후 1시는 <b>13:00</b>. '
    + '<b>13</b>이나 <b>1300</b>으로 쳐도 됩니다.<br>'
    + '<b>설정 → 당번 종류의 그 값입니다</b> — 여기서 고치면 설정에도 그대로 남습니다.<br>'
    + '새로 넣을 때 붙고, 넣은 뒤에는 사람마다 따로 고칩니다.</div>'
    + '<div class="sug" id="dutySug"></div>'
    + '<div class="dnote">명부에 없는 이름도 그대로 쳐서 넣습니다. '
    + '<b>이름 없이 넣기</b>를 누르면 이름은 공백인 채로 자리만 생깁니다.</div></div>'
    + '<div class="acts" style="margin-top:12px"><button data-act="dutyclear" class="warn">전부 비우기</button></div>'
    + '<div class="dnote">이 칸은 배치표에서 ' + (DUTYKEYS.indexOf(k) + 1) + '번째입니다(모두 ' + DUTYKEYS.length + '칸) — '
    + '<b>배치표에서 칸을 끌면</b> 차례가 바뀝니다.</div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
  var q = $('dutyQ'), sg = $('dutySug');
  function draw(){
    var v = q.value.trim();
    var hit = cands.filter(function(n){
      return curN.indexOf(n) < 0 && (!v || n.indexOf(v) >= 0); });
    var list = hit.slice(0, 40);
    sg.innerHTML = (list.length
      ? list.map(function(n){
          return '<button data-dutytog="' + esc(n) + '">' + esc(n)
            + (onSet[n] ? '' : '<i>오늘 없음</i>') + '</button>'; }).join('')
      : '<span class="dnone">찾는 이름이 없습니다 — 직접 쳐서 넣으세요</span>')
      + (hit.length > list.length
          ? '<span class="dnone">…' + (hit.length - list.length) + '명 더 있습니다 — 이름을 쳐서 좁히세요</span>'
          : '');
  }
  var addBtn = null, bs = $('sheet').querySelectorAll('button');
  for (var bi = 0; bi < bs.length; bi++) if (bs[bi].getAttribute('data-act') === 'dutyadd') addBtn = bs[bi];
  function label(){ if (addBtn) addBtn.textContent = q.value.trim() ? '넣기' : '이름 없이 넣기'; }
  q.addEventListener('input', function(){ draw(); label(); });
  draw();
  label();
  q.focus();
}
function openSlot(kind, key){
  sheetFor = { slot: true, kind: kind, key: key };
  var isStaff = (kind === 'staff');
  var cu = isStaff ? STAFF[key].n : (DUTY[key] || '');
  var ttl = isStaff ? (STAFF[key].k + (STAFF[key].sub ? '(' + STAFF[key].sub + ')' : '')) : key;
  var cands;
  if (isStaff){
    cands = MARSHALS.filter(function(n){ return n !== cu; });
  } else {
    var seen = {}; cands = [];
    DAY.forEach(function(p){ active(p).forEach(function(r){
      if (!seen[r.n] && r.n !== cu) { seen[r.n] = 1; cands.push(r.n); } }); });
  }
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">' + (isStaff ? '오늘 경기과' : '오늘 당번') + '</div>'
    + '<div class="st">' + esc(ttl) + '</div>'
    + '<div class="sub">' + (isStaff
        ? (STAFF[key].fix ? '거의 안 바뀌는 자리지만 <b>언제든 고칠 수 있습니다.</b>'
                          : '<b>날마다 바뀌는 자리입니다.</b> 다른 사람이 와도 됩니다.')
        : '오늘 출근한 캐디 중에서 고르거나 이름을 직접 치세요.')
    + (isStaff && STAFF[key].k === '마샬'
        ? '<br><b>출근 시각이 이른 쪽이 조출, 늦은 쪽이 마감</b>입니다 — 따로 고르지 않습니다.'
          + '<br>여기 넣은 캐디는 근무표에서 <b>배치</b>가 되고 <b>배치표 자리에서는 내려옵니다</b>'
          + ' — 따로 지정하지 않습니다. 자리에서 빼면 배치도 떨어집니다.' : '')
    + '</div>'
    + '<div class="grp"><div class="fld">'
    + '<input id="slotName" value="' + esc(cu) + '" autocomplete="off" placeholder="이름">'
    // ★시각 칸은 마샬에만 둔다 — 조출을 그 시각으로 정하기 때문이다.
    //   대리·주임은 시각이 아무 것도 정하지 않아 고르게 할 까닭이 없다
    + (isStaff && STAFF[key].k === '마샬'
       ? timeInput('id="slotTime" class="tf"', STAFF[key].t || '7:00', ' style="flex:0 0 118px"') : '')
    + '<button data-act="slotsave">넣기</button></div>'
    + '<div class="sug">' + (cands.length
        ? cands.map(function(n){ return '<button data-n="' + esc(n) + '">' + esc(n) + '</button>'; }).join('')
        : '<span style="font-size:12.5px;color:#8b96a2;font-weight:760">후보가 없습니다</span>') + '</div>'
    + '<div class="acts" style="margin-top:12px"><button data-act="slotclear" class="warn">비우기</button>'
    + (isStaff && STAFF[key].k === '마샬'
       ? '<button data-act="msdel" class="warn">이 칸 없애기</button>' : '')
    + '</div>'
    + '</div><button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}

// ★자리가 없다고 칸을 없애지 않는다. 칸이 사라지면 아래가 통째로 뛰어올라
// 방금 누른 자리에 딴 단추가 와 있다 — 흐리게 두고 왜 없는지만 적는다
function seatsGrp(nm, seats){
  var body;
  if (seats.length){
    body = seats.map(function(s2){
      return '<button data-swapto="' + s2.pk + ':' + s2.ri + '">' + esc(s2.label) + '</button>'; }).join('');
  } else {
    var rec = ABSFROM[nm], was = (rec && rec.pks) || [];
    var why = isAbs(tagOf(nm)) ? tagOf(nm) : '자리 없음';
    body = (was.length ? was : ['']).map(function(k){
      return '<button class="dim" disabled>' + (k ? esc(part(k).name) + ' · ' : '') + why + '</button>';
    }).join('');
  }
  return '<div class="grp"><h4>오늘 어디 있나</h4><div class="sgw">' + body + '</div>'
    + '<div class="dnote">' + (seats.length
        ? '자리를 누르면 <b>거기로 갑니다.</b> 대바 중이면 그 자리와 바꿉니다.'
        : '오늘 자리가 없습니다. 아래 <b>부 넣고 빼기</b>로 넣으십시오.')
    + '</div></div>';
}
// 소속 — 그날의 구분이 아니라 오래 가는 값이다. 풀지 않는 한 날이 바뀌어도 그대로다
function bu3Grp(nm){
  var on = isBu3(nm);
  return '<div class="grp"><h4>소속</h4>'
    + '<div class="acts fix" style="grid-template-columns:repeat(2,minmax(0,1fr))">'
    + '<button data-bu3="0"' + (on ? '' : ' class="on"') + '>하우스 캐디</button>'
    + '<button data-bu3="1"' + (on ? ' class="on"' : '') + '>3부반</button>'
    + '</div><div class="dnote">'
    + (on ? '<b>3부반</b>입니다 — 순번 세우기에서 <b>3부에만</b> 섭니다. '
            + '1·2부에는 배지가 없어도 안 들어갑니다. 중복 근무나 대바로 1·2부를 뛰는 것은 그대로 됩니다.'
          : '<b>하우스 캐디</b>입니다 — 순번 세우기에서 1·2부에 섭니다.')
    + ' 이 값은 <b>날이 바뀌어도 안 풀립니다.</b></div></div>';
}
// 그날의 구분 — 조출·후출 같은 것. 늘 같은 자리에 같은 수의 칸이 있다
function dayTagGrp(nm){
  // ★'3부'와 '선발'은 여기 것이 아니다 — 소속 칸과 선발 고르개가 따로 말한다
  var t0 = dayMark(nm), isA = isAbs(tagOf(nm));
  var mine = DAYTAGS.indexOf(t0) >= 0;
  return '<div class="grp"><h4>그날의 구분</h4>'
    + '<div class="acts fix" style="grid-template-columns:repeat(4,minmax(0,1fr))">'
    + '<button data-dtag=""' + (!t0 ? ' class="on"' : '') + '>없음</button>'
    + DAYTAGS.map(function(t){
        return '<button data-dtag="' + esc(t) + '"' + (t0 === t ? ' class="on"' : '') + '>'
          + t + '</button>'; }).join('')
    + '</div><div class="dnote">'
    + (t0 === '찾근'
       ? '<b>찾근</b>은 본인이 <b>원하는 순번을 골라 옵니다</b> — 자유 이용권입니다. '
         + '그래서 순번 세우기가 안 세우고 배치표 자리에서도 내려와 있습니다. '
         + '고른 칸을 열어 이름을 치거나, 그 칸 후보 목록 맨 위에서 고르십시오.<br>'
       : '')
    + (isA ? '지금은 <b>' + esc(tagOf(nm)) + '</b>입니다 — 구분을 붙이려면 아래에서 <b>근무</b>로 되돌리십시오.'
           : (mine || !t0
              ? '붙이면 <b>순번 세우기에서 빠지고 배치표 자리에서도 내려옵니다</b> '
                + '— 어디에 놓을지는 사람이 정합니다. 같은 것을 다시 누르면 떼고, '
                + '떼면 있던 부의 <b>대기 뒤로</b> 돌아옵니다.'
              : '지금은 <b>' + esc(t0) + '</b>입니다. 다른 것을 누르면 <b>덮어씁니다</b> '
                + '— 되돌리기 한 번으로 돌아옵니다.'))
    + '</div></div>';
}
// ★근태도 네 칸을 못 박는다. '근무'가 생겼다 없어졌다 하면 단추가 한 칸씩 밀린다
function absGrp(nm, hasSeat){
  var abt = tagOf(nm), isA = isAbs(abt);
  return '<div class="grp"><h4>오늘 근태</h4>'
    + '<div class="acts fix" style="grid-template-columns:repeat(4,minmax(0,1fr))">'
    + [''].concat(ABSTYPES).map(function(t){
        var on = t ? (abt === t) : !isA;
        return '<button data-abs="' + t + '"' + (on ? ' class="on"' : '') + '>'
          + (t || '근무') + '</button>'; }).join('')
    + '</div><div class="dnote">'
    + (hasSeat
        ? '휴무·휴가·병가를 누르면 <b>선 자리를 비우고</b> 뒤 순번이 당겨집니다. '
          + '되돌리기(Ctrl+Z) 한 번으로 그대로 돌아옵니다.'
        : (isA ? '<b>근무</b>를 누르면 있던 부의 <b>대기 뒤로</b> 돌아옵니다. '
                 + '되돌리기 한 번으로 다시 쉬는 상태가 됩니다.'
               : '오늘 배치표에 자리가 없지만 <b>쉬는 것은 아닙니다</b> — '
                 + '아직 안 넣은 것이라 가용에 듭니다.'))
    + '</div></div>';
}
// 한 부만 넣고 뺀다 — 대바는 두 사람을 맞바꾸는 일이고, 이건 한 사람을 넣거나 빼는 일이다
function partMoveHTML(nm){
  if (!DAY.length) return '';
  // ★부 차례 그대로 한 부에 한 단추. 있으면 빼기, 없으면 넣기 —
  // 누른 뒤에도 그 부의 단추는 그 자리에 그대로 있다.
  // (빼기끼리 앞에 모으면, 1부를 뺀 순간 2부가 그 자리로 당겨져 손가락이 헛다리를 짚는다)
  var inS = {};
  partsOf(nm).forEach(function(k){ inS[k] = 1; });
  return '<div class="grp"><h4>오늘 어느 부에서 근무하나</h4>'
    + '<div class="acts pm" style="grid-template-columns:repeat(' + DAY.length + ',minmax(0,1fr))">'
    + DAY.map(function(p){
        // ★누르면 '오늘 이 부에서 일한다'가 켜지고 꺼진다(PLAN).
        //   배치표 명단은 안 건드린다 — 대기에도 순번이 이어져 붙어서,
        //   여기서 줄을 만들면 관리자가 짜 놓은 순번이 흔들린다.
        //   자리는 배치표에서 빈 칸을 눌러 앉힌다
        var on = inPlan(nm, p.key), sat = inS[p.key];
        return '<button class="' + (on ? 'on' : '') + '" data-pln="' + p.key + '">'
          + '<b>' + esc(p.name) + '</b><span>'
          + (sat ? '배치표에 있음' : (on ? '근무' : '안 함')) + '</span></button>'; }).join('')
    + '</div>'
    // ★배치표에 실제로 앉아 있는 자리는 따로 보여 준다 — 여기서만 자리를 뺀다
    + (partsOf(nm).length
       ? '<div class="dnote" style="margin-bottom:8px">배치표 자리 — '
         + partsOf(nm).map(function(k){ return '<b>' + esc(part(k).name) + '</b>'; }).join(' · ')
         + '</div><div class="acts">'
         + partsOf(nm).map(function(k){
             return '<button class="warn" data-prm="' + k + '">' + esc(part(k).name)
               + ' 자리 빼기</button>'; }).join('')
         + '</div>' : '')
    + '<div class="dnote">여기서 정하는 것은 <b>오늘 어느 부에서 근무하나</b>입니다 — '
    + '<b>배치표에는 아무 일도 안 일어납니다.</b> 자리는 배치표에서 빈 칸을 누르고 '
    + '이름을 치면 그 순번에 앉습니다.<br>'
    + '<b>자리 빼기</b>를 누르면 <b>뒤 순번이 당겨집니다.</b> '
    + '어느 부에도 자리가 없으면 <b>미배치</b>가 됩니다 '
    + '— 쉬는 것이 아니라 <b>아직 안 앉힌 것</b>이라 가용에 그대로 듭니다. '
    + '되돌리기(Ctrl+Z) 한 번으로 그대로 돌아옵니다.</div></div>';
}
// 조편성표에서 사람 하나 — 그 사람에 대해 할 수 있는 일
function openPerson(nm){
  var seats = peopleIndex().map[nm] || [];
  var cart = CART[nm] || 0;
  sheetFor = { person: nm };
  var h = '<div class="grab"></div><div class="k">조편성표</div>'
    + '<div class="st">' + esc(nm) + '</div>'
    + '<div class="sub">' + esc(JOLABEL[joOf(nm)] || '') + ' · '
    + (cart ? '지정 카트 ' + cart + '번' + (cartBad(cart) ? ' · <b style="color:var(--no)">고장</b>' : '')
            : '지정 카트 없음') + '</div>';

  h += seatsGrp(nm, seats);
  h += partMoveHTML(nm);
  h += bu3Grp(nm);
  h += dayTagGrp(nm);
  h += absGrp(nm, seats.length);
  h += '<div class="grp"><h4>근무표 명부</h4>'
    + '<div class="acts"><button class="warn" data-act="delcad">명부에서 지우기</button></div>'
    + '<div class="dnote">근무표 명단에서 <b>아주 뺍니다</b> — 오늘 하루 쉬는 것이라면 '
    + '위의 <b>오늘 근태</b>를 쓰십시오. 되돌리기 한 번으로 돌아옵니다.</div></div>';
  h += '<button class="close" data-act="close">닫기</button>';
  $('sheet').innerHTML = h;
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}

// ── 근무표 명부 — 캐디를 넣고 뺀다 ────────────────
// ★명부에 넣는 것과 배치표에 앉히는 것은 다른 일이다. 여기서는 명부만 건드린다 —
//   자리는 순번 세우기나 '부 넣기'가 잡는다. 두 일을 한 단추에 묶으면 되돌리기가 엉킨다
var addJo = -1;
function drawAddCaddie(){
  var chips = [], i;
  for (i = 0; i < JOCNT; i++)
    chips.push('<button data-acjo="' + i + '"' + (addJo === i ? ' class="on"' : '') + '>'
      + esc(JOLABEL[i] || (i + 1) + '조') + '</button>');
  chips.push('<button data-acjo="-1"' + (addJo < 0 ? ' class="on"' : '') + '>조 미배정</button>');
  var q = $('acName'), val = q ? q.value : '';
  $('sheet').innerHTML = '<div class="grab"></div><div class="k">근무표 명부</div>'
    + '<div class="st">캐디 넣기</div>'
    + '<div class="sub">명부에만 넣습니다. <b>배치표 자리는 따로</b>입니다 — '
    + '넣은 뒤 <b>순번 세우기</b>나 사람 창의 <b>부 넣기</b>로 앉히십시오.</div>'
    + '<div class="grp"><h4>이름</h4><div class="fld">'
    + '<input id="acName" autocomplete="off" placeholder="캐디 이름" value="' + esc(val) + '">'
    + '</div></div>'
    + '<div class="grp"><h4>어느 조에</h4><div class="acts">' + chips.join('') + '</div></div>'
    + '<div class="acts two" style="margin-top:14px">'
    + '<button class="on" data-act="acgo">넣기</button>'
    + '<button data-act="close">그만두기</button></div>';
}
function openAddCaddie(jo){
  jo = Number(jo);
  addJo = (jo >= 0 && jo < JOCNT) ? jo : -1;
  sheetFor = { kind: 'addcaddie' };
  drawAddCaddie();
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
  setTimeout(function(){ var el = $('acName'); if (el) el.focus(); }, 60);
}
// 지우기는 놀라면 안 된다 — 무엇이 사라지는지 먼저 적고, 되살리는 법을 그 밑에 적는다
function openDelCaddie(nm){
  var seats = partsOf(nm).map(function(k){ return part(k).name; });
  var dt = DUTYKEYS.filter(function(k){ return dutyAt(k, nm) >= 0; });
  var mine = [];
  if (seats.length) mine.push('배치표 자리 — ' + seats.join('·'));
  if (tagOf(nm)) mine.push('오늘 배지 — ' + tagOf(nm));
  if (CART[nm]) mine.push('지정 카트 — ' + CART[nm] + '번');
  if (dt.length) mine.push('당번 — ' + dt.join('·'));
  if (isBu3(nm)) mine.push('3부반 소속');
  sheetFor = { kind: 'delcaddie', person: nm };
  $('sheet').innerHTML = '<div class="grab"></div><div class="k">근무표 명부</div>'
    + '<div class="st">' + esc(nm) + ' 을(를) 지웁니다</div>'
    + '<div class="warnbox"><b>근무표 명단에서 아주 빠집니다.</b>'
    + (mine.length ? '<br>같이 지워지는 것 — ' + esc(mine.join(' · ')) : '')
    + '</div>'
    + '<div class="calmbox"><b>되돌리기(Ctrl+Z) 한 번</b>이면 자리·배지·카트·당번까지 '
    + '그대로 돌아옵니다. 저장을 누르기 전이라면 새로고침만 해도 됩니다.</div>'
    + '<div class="acts two">'
    + '<button class="warn on" data-act="delcadyes">지웁니다</button>'
    + '<button data-act="close">그만두기</button></div>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}

// ── 카트 ────────────────────────────────────
function cartWhere(nm){                  // 그 카트 주인이 오늘 어디 있나
  var r = workRows().filter(function(x){ return x.n === nm; })[0];
  return r ? r.st : '명단 밖';
}
function cartStateAll(c, pks){           // 여러 부를 통틀어 제일 나쁜 자리
  if (cartBad(c)) return 'bad';
  var worst = 'free';
  pks.forEach(function(pk){
    var st = cartState(c, pk);
    if (st === 'busy') worst = 'busy';
    else if (st === 'wait' && worst !== 'busy') worst = 'wait';
  });
  return worst;
}
var CARTLBL = { free: '빔', wait: '대기 중', busy: '사용중', bad: '고장' };
function openCart(nm){
  sheetFor = { cart: nm, kind: 'cart' };
  var own = ownCart(nm), now = cartOf(nm), lent = isLent(nm);
  var pks = workParts(nm), free = cartFreeFor(nm);
  var wh = pks.length ? pks.map(function(k){ return part(k).name; }).join('·') : '근무 없음';
  var ow = lent ? cartOwnerOf(now) : '';
  var h = '<div class="grab"></div><div class="k">카트 · ' + esc(wh) + '</div>'
    + '<div class="st">' + esc(nm) + '</div>'
    + '<div class="sub">' + (lent
        ? '<b>' + now + '번을 빌려 탑니다</b>' + (ow ? ' — 주인 ' + esc(ow) + ' · 지금 '
            + esc(cartWhere(ow)) : '') + '. 제 카트는 ' + (own ? own + '번' : '없습니다')
          + '. 빌림은 <b>오늘까지</b>입니다.'
        : now ? '<b>제 카트 ' + now + '번</b>'
            + (cartBad(now) ? ' · <b style="color:var(--no)">고장</b>' : '')
            + (function(){ var m = [];
                JONAMES.forEach(function(x){ if (x !== nm && cartOf(x) === now) m.push(x); });
                return m.length ? ' · <b>' + esc(m.join(', ')) + '</b>도 오늘 같은 번호' : ''; })()
            + '입니다. 오늘만 다른 카트를 타면 아래 번호를 바꾸십시오 — 주인표는 안 건드립니다.'
          : '탈 카트가 <b>없습니다.</b> 지금 안 쓰는 카트가 <b>' + free.length + '대</b> 있습니다.')
    + '</div>'
    + '<div class="grp"><h4>오늘 타는 카트</h4><div class="fld">'
    + '<input id="cartN" type="number" min="0" max="999" step="1" inputmode="numeric" '
    + 'placeholder="번호" value="' + (now || '') + '">'
    + '<button data-act="cartsave">넣기</button></div>'
    + '<div class="acts" style="margin-top:9px">'
    + '<button data-act="cartpick">안 쓰는 카트 고르기 (' + free.length + '대)</button>'
    + '<button data-act="cartmine"' + (lent ? '' : ' disabled') + '>제 카트로</button></div></div>';
  if (now){
    h += '<div class="grp"><h4>이 카트 상태</h4><div class="acts">'
      + '<button data-act="cartok" class="' + (cartBad(now) ? '' : 'on') + '">쓸 수 있음</button>'
      + '<button data-act="cartbad" class="bad' + (cartBad(now) ? ' on' : '')
      + '">고장 — 못 씀</button></div>'
      + '<div class="dnote">고장은 <b>' + now + '번 카트에</b> 붙습니다 — 사람이 아니라 카트라서, '
      + '그 번호를 쓰는 사람 모두에게 빨갛게 뜹니다.</div></div>';
  }
  h += '<div class="grp"><h4>주인 카트</h4><div class="fld">'
    + '<input id="cartOwnN" type="number" min="0" max="999" step="1" inputmode="numeric" '
    + 'placeholder="번호" value="' + (own || '') + '">'
    + '<button data-act="cartown">고치기</button></div>'
    + '<div class="dnote">좀처럼 안 바뀌는 값입니다 — <b>날이 바뀌어도 안 풀립니다.</b> '
    + '오늘만 남의 카트를 타는 것이면 <b>위 칸</b>에 넣으십시오.</div></div>';
  h += '<button class="close" data-act="close">닫기</button>';
  $('sheet').innerHTML = h;
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
  var q2 = $('cartN');
  if (q2) { q2.focus(); q2.select(); }
}
// 안 쓰는 카트 고르기 — 빔·대기·사용중·고장을 갈라 놓는다
function openCartPick(nm){
  var pks = workParts(nm);
  if (!pks.length) pks = DAY.map(function(p){ return p.key; });
  var wh = pks.map(function(k){ return part(k).name; }).join('·');
  var now = cartOf(nm);
  var grp = { free: [], wait: [], busy: [], bad: [] };
  allCarts().forEach(function(c){ if (c !== now) grp[cartStateAll(c, pks)].push(c); });
  var sec = function(k, note){
    if (!grp[k].length) return '';
    return '<div class="bhd">' + CARTLBL[k] + ' ' + grp[k].length + '대'
      + (note ? ' · ' + note : '') + '</div>'
      + grp[k].map(function(c){
          var ow = cartOwnerOf(c), can = (k === 'free' || k === 'wait');
          return '<button class="brow ct' + k + '"' + (can ? '' : ' disabled')
            + ' data-cartno="' + c + '">'
            + '<span class="n">' + c + '번</span>'
            + '<span class="bg">' + (ow ? esc(ow) + ' · ' + esc(cartWhere(ow)) : '주인 없음')
            + '</span>'
            + '<span class="k">' + (can ? '빌리기' : CARTLBL[k]) + '</span></button>'; }).join('');
  };
  sheetFor = { cart: nm, kind: 'cartpick' };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">' + esc(nm) + ' · ' + esc(wh) + '</div>'
    + '<div class="st">안 쓰는 카트</div>'
    + '<div class="sub">' + esc(wh) + '에 <b>아무도 안 타는</b> 카트만 빌릴 수 있습니다. '
    + '주인이 그 시간에 타고 있으면 <b>사용중</b>으로 잠깁니다.</div>'
    + '<div class="blst">' + sec('free') + sec('wait', '주인이 대기입니다 — 불리면 탑니다')
    + sec('busy', '못 빌립니다') + sec('bad', '못 씁니다') + '</div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}

// 당번 창의 '넣을 때 붙는 값' — 창이 안 열려 있으면 빈 값
function newT(){ return $('dutyT') ? hhmm($('dutyT').value) : ''; }
function newH(){ return $('dutyH') ? hrNum($('dutyH').value) : 0; }

// ── 순번 세우기 ─────────────────────────────
// 선발 한 사람을 정하면 그 사람의 조 자리부터 조를 돌며 1부·2부가 차례로 선다.
// 배지 붙은 사람은 경기과가 놓은 자리 그대로 둔다 — 이건 정답이 아니라 출발점이다
function seonbalSpot(n){
  var s = '';
  DAY.forEach(function(p){
    if (s) return;
    var ix = active(p).map(function(r){ return r.n; }).indexOf(n);
    if (ix >= 0) s = p.name + ' ' + (ix + 1) + '번';
  });
  return s;
}
function lineupBar1(label, who, tail, pickAct, runAct, pickText, runText){
  return '<div class="lnbar"><span class="lk">' + esc(label) + '</span>'
    + '<span class="lv' + (who ? '' : ' none') + '">' + esc(who || '아직 없습니다') + '</span>'
    + '<span class="lw">' + (who
        ? esc((JOLABEL[joOf(who)] || '조 미배정') + ' · ' + (seonbalSpot(who) || '오늘 자리 없음')
              + ' · ' + tail)
        : '고르면 그 사람부터 조를 돌며 순번이 섭니다') + '</span>'
    + '<button data-act="' + pickAct + '">' + esc(pickText) + '</button>'
    + '<button data-act="' + runAct + '" class="go"' + (who ? '' : ' disabled') + '>'
    + esc(runText) + '</button></div>';
}
// ── 한꺼번에 지정 ───────────────────────────
// 무엇을 붙일지 먼저 못 박고, 이름만 차례로 누른다.
// ★칸은 늘 여기 있다 — 켜고 끄기만 한다
function bulkChips(){
  var on = bulkOn(), t = bulkTag();
  // ★'캐디 선택'은 배지가 아니다 — 칩 줄에 끼우면 배지처럼 보인다. 제 줄로 뺐다
  return BULKTAGS.filter(function(x){ return x !== PICKTAG; }).map(function(x){
    var sel = on && t === x, cc = !x ? 'cet' : (x === '휴무' ? 'cru' : isAbs(x) ? 'crs' : tagCls(x));
    return '<button class="bch' + (sel ? ' on ' + cc : '')
      + '" data-bulk="' + esc(x) + '">' + esc(bulkLabel(x)) + '</button>'; }).join('');
}
// ★한꺼번에 지정은 '이름을 찾아 누르는 일'이다 — 그러니 찾는 칸 옆에 있어야 한다.
//   여태는 배지가 오른쪽 줄에, 이름은 왼쪽 명단에 있어서 고르러 갔다가 누르러 와야 했다.
//   머리말과 긴 풀이는 걷는다 — 무엇을 하는 중인지는 아래 띠가 이미 말한다
function bulkBarHTML(){
  var on = bulkOn();
  return '<div class="bulk wb' + (on ? ' on' : '') + '">'
    + '<span class="bk">한꺼번에 지정</span>'
    + '<span class="bchs">' + bulkChips() + '</span>'
    + '<button class="bch pk' + (bulkPicking() ? ' on' : '') + '" data-bulk="' + esc(PICKTAG)
    + '" title="여러 명을 먼저 선택하고, 무엇을 할지는 나중에 정합니다 \u2014 배지와 근태를 한 번에 바꿉니다">'
    + '캐디 선택</button>'
    // ★여기에 '지금 무엇을 하는 중'이라고 적으면 띠가 접혀 단추들이 옆으로 밀린다.
    //   고르자마자 단추가 움직이면 다음 누름이 엉뚱한 데 간다.
    //   그 말은 아래 띠가 이미 하고 있다 — 두 번 말하느라 자리를 흔들지 않는다
    + '</div>';
}
// 근무표 아래 띠 — 한 명이라도 지정하면 저장하기가 여기 뜬다
function paintBulkFoot(){
  var on = bulkOn(), bb = $('bulkbar');
  if (!on && wkFilter === BULKFIL) wkFilter = '';
  bb.classList.toggle('on', on);
  if (!on) { bb.innerHTML = ''; return; }
  if (bulkPicking()){ paintPickBulk(bb); return; }
  var done = bulkDone(), set = bulkSet(), n = done.length, m = set.length;
  var kept = bulkKept(), K = kept.length, lab = esc(bulkLabel(bulkTag()));
  var head = K && !n ? lab + ' ' + K + '명 저장했습니다'
           : K       ? lab + ' ' + (m + K) + '명 · 저장한 ' + K + ' + 지금 ' + m
           :           lab + ' ' + m + '명';
  bb.innerHTML = '<span class="tx"><b>' + head
    + (n > m ? ' · 뗀 ' + (n - m) + '명' : '') + '</b>'
    + (n ? esc((m ? set : done).slice(-6).join(' · '))
           + (m > 6 ? ' 외 ' + (m - 6) + '명' : '')
         : (K ? '이어서 더 누르셔도 됩니다 · 끄기를 눌러도 안 풀립니다'
              : '이름을 누르면 여기에 쌓입니다')) + '</span>'
    + '<button data-act="bkundo"' + (bulkSteps() ? '' : ' disabled') + '>되돌리기</button>'
    + (n ? '<button class="go" data-act="bksave">저장하기</button>' : '')
    + '<button class="x" data-act="bkoff">끄기</button>';
}
var bkFrom = 1;                       // ★창을 다시 그려도 친 숫자는 남아 있어야 한다
function bulkActHTML(){
  var L = bulkPicked(), n = L.length;
  function btns(list){
    return '<div class="acts">' + list.map(function(x){
      return '<button data-bkdo="' + esc(x[0]) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';
  }
  var parts = DAY.map(function(p){
    var innn = L.filter(function(nm){ return partsOf(nm).indexOf(p.key) >= 0; }).length;
    var pln = L.filter(function(nm){ return inPlan(nm, p.key); }).length;
    return { k: p.key, name: p.name, inn: innn, pln: pln };
  });
  return '<div class="grab"></div><div class="k">선택한 ' + n + '명</div>'
    + '<div class="st">한꺼번에 바꾸기</div>'
    + '<div class="sub">' + (n ? esc(L.slice(0, 8).join(' \u00b7 ')) + (n > 8 ? ' 외 ' + (n - 8) + '명' : '')
                              : '아직 아무도 선택 안 했습니다 \u2014 근무표에서 이름을 누르십시오') + '</div>'
    + '<div class="grp"><h4>근태</h4>'
    + btns([['t|휴무', '휴무'], ['t|휴가', '휴가'], ['t|병가', '병가'], ['t|', '근무로']]) + '</div>'
    + '<div class="grp"><h4>그날의 구분</h4>'
    + btns(DAYTAGS.map(function(x){ return ['t|' + x, x]; }))
    + '<div class="dnote" style="margin-top:9px">조출\u00b7후출\u00b7정출\u00b7찾근을 붙이면 '
    + '<b>어제 자리에서 내려옵니다</b> \u2014 순번은 경기과가 정한다는 뜻입니다.</div></div>'
    + '<div class="grp"><h4>오늘 어느 부에서 근무하나</h4>'
    // ★한 부에 한 칸 — 누르면 켜지고 다시 누르면 꺼진다.
    //   단추 아홉 개를 줄 세우던 것을 세 칸으로 줄였다 — 사람 하나를 볼 때와 같은 모양이다
    + '<div class="acts pm" style="grid-template-columns:repeat(' + DAY.length + ',minmax(0,1fr))">'
    + parts.map(function(p){
        var all = n > 0 && p.pln === n, some = p.pln > 0 && !all;
        return '<button class="' + (all ? 'on' : (some ? 'half' : ''))
          + '" data-bkdo="' + (all ? 'p-' : 'p+') + esc(p.k) + '">'
          + '<b>' + esc(p.name) + '</b><span>'
          + (all ? '모두 근무' : some ? p.pln + '명 근무' : '안 함') + '</span>'
          + (p.inn ? '<span>배치표 ' + p.inn + '명</span>' : '') + '</button>'; }).join('')
    + '</div>'
    // 배치표 자리를 빼는 것은 지정과 다른 일이라 따로 놓는다
    + (parts.some(function(p){ return p.inn; })
       ? '<div class="dnote" style="margin:9px 0 8px">배치표 자리 — '
         + parts.filter(function(p){ return p.inn; }).map(function(p){
             return '<b>' + esc(p.name) + '</b> ' + p.inn + '명'; }).join(' · ')
         + '</div><div class="acts">'
         + parts.filter(function(p){ return p.inn; }).map(function(p){
             return '<button class="warn" data-bkdo="-' + esc(p.k) + '">' + esc(p.name)
               + ' 자리 빼기</button>'; }).join('')
         + '</div>' : '')
    + '<div class="dnote" style="margin-top:9px"><b>지정은 배치표를 안 건드립니다</b> \u2014 '
    + '오늘 어느 부에서 일하는지만 적어 둡니다. 자리는 아래의 '
    + '<b>배치표에 한꺼번에 앉히기</b>나 배치표 빈 칸에서 잡습니다.<br>'
    + '<b>중복 근무는 배지가 아닙니다</b> \u2014 두 부에 <b>자리</b>가 있으면 그것이 중복 근무입니다.</div></div>'
    + '<div class="grp"><h4>배치표에 한꺼번에 앉히기</h4>'
    + '<div class="fld" style="align-items:center">'
    + '<input id="bkFrom" class="tf" inputmode="numeric" style="flex:0 0 110px;max-width:110px" '
    + 'value="' + esc(String(bkFrom)) + '" placeholder="1">'
    + '<span style="font-weight:800;color:var(--dim)">번부터 앉힙니다</span></div>'
    + '<div style="height:8px"></div>'
    + btns(parts.map(function(p){ return ['s|' + p.k, p.name + '에 앉히기']; }))
    + '<div class="dnote" style="margin-top:9px">고른 사람이 <b>적은 번호부터 차례로</b> 앉고 '
    + '<b>뒤가 한 칸씩 밀립니다</b> — 아무도 자리를 잃지 않습니다. 차례는 조 편성이 정합니다.<br>'
    + '<b>조출·중복 근무를 먼저 여기 앉히고</b>, 그 다음 순번 세우기를 누르십시오 — '
    + '배지가 붙어 있으면 순번 세우기가 이 자리를 안 건드립니다.</div></div>'
    + '<div class="grp"><h4>선택</h4>'
    + '<div class="acts"><button data-bkdo="clear">선택 모두 풀기</button></div></div>';
}
function openBulkAct(){
  sheetFor = { kind: 'bulkact' };
  $('sheet').innerHTML = bulkActHTML() + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on'); $('sheet').classList.add('on');
}
// 고르기 중 띠 — 이름부터 고르고, 무엇을 할지는 나중에 정한다
function paintPickBulk(bb){
  var L = bulkPicked(), n = L.length, ch = bulkDirty();
  bb.innerHTML = '<span class="tx"><b>' + (n ? n + '명 선택했습니다' : '캐디 선택')
    + '</b>' + (n ? esc(L.slice(-6).join(' \u00b7 ')) + (n > 6 ? ' 외 ' + (n - 6) + '명' : '')
                  : '근무표에서 이름을 누르면 선택됩니다') + '</span>'
    + (n ? '<button class="go" data-act="bkact">한꺼번에 바꾸기</button>' : '')
    + (ch ? '<button class="go" data-act="bksave">저장하기</button>' : '')
    + '<button class="x" data-act="bkoff">끄기</button>';
}
// 끄면 지정한 것이 없던 일이 된다 — 그러니 묻는다
function openBulkOff(){
  var done = bulkDone(), n = done.length, K = bulkKept().length;
  if (!n) { bulkOff(); toast(K ? '한꺼번에 지정을 껐습니다 · 저장한 ' + K + '명은 그대로입니다'
                              : '한꺼번에 지정을 껐습니다'); return; }
  sheetFor = { kind: 'bulkoff' };
  $('sheet').innerHTML = '<div class="grab"></div><div class="k">확인</div>'
    + '<div class="st">한꺼번에 지정을 끕니다</div>'
    + '<div class="warnbox"><b>지정한 ' + n + '명이 지정 전으로 돌아갑니다.</b><br>'
    + esc(done.join(', ')) + '</div>'
    + '<div class="calmbox">' + (K ? '<b>저장한 ' + K + '명은 그대로입니다.</b> ' : '')
    + '저장한 뒤에 지정한 <b>' + n + '명</b>만 없던 일이 됩니다. '
    + '이 뒤에도 <b>되돌리기</b>로 되살릴 수 있습니다.</div>'
    + '<div class="acts two" style="margin:14px 14px 0">'
    + '<button data-act="bkyes" class="warn on">확인</button>'
    + '<button data-act="close">취소</button></div>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}
// ★한 카트를 같은 부에서 둘이 타는 것 — 사람은 못 세지만 기계는 센다
// ★두 부 시각이 겹치는 사람
function roundClashBar(){
  var cl = roundClashes();
  if (!cl.length) return '';
  return '<div class="lnbar dft"><span class="lk">겹침</span>'
    + '<span class="lv">두 부 시각 ' + cl.length + '건</span>'
    + '<span class="lw">' + cl.map(function(x){
        return esc(x.n) + ' ' + part(x.a.pk).name + ' ' + x.a.time + ' → '
          + part(x.b.pk).name + ' ' + x.b.time + ' ' + gapText(x.gap); }).join(' / ')
    + ' — 한 라운드를 ' + gapText(ROUNDMIN) + '으로 봅니다</span></div>';
}
function cartClashBar(){
  var cl = cartClashes();
  if (!cl.length) return '';
  return '<div class="lnbar dft"><span class="lk">카트</span>'
    + '<span class="lv">겹침 ' + cl.length + '건</span>'
    + '<span class="lw">' + cl.map(function(x){
        return part(x.pk).name + ' ' + x.cart + '번 ' + esc(x.who.join('·')); }).join(' / ')
    + ' — 같은 부에서 한 카트를 둘이 탑니다</span></div>';
}
// ★순번 세우기가 배치표로 가면서 비운 자리 — 여기에 공지를 쌓는다.
//   근무표는 사람을 보는 화면이니, 사람에게 보낼 말도 여기서 쓴다
function noticeChips(list, now, act){
  return list.map(function(x){
    return '<button class="ntc' + (x === now ? ' on' : '') + '" data-' + act + '="' + esc(x) + '">'
      + esc(x) + '</button>';
  }).join('');
}
function noticeBoxHTML(){
  return '<div class="ntbox">'
    + '<div class="nth"><b>공지사항</b>'
    + '<span>캐디 총무 앱으로 보냅니다</span></div>'
    + '<div class="ntrow">' + noticeChips(NOTEKIND, NOTICE.kind, 'ntkind') + '</div>'
    + '<div class="ntrow">' + noticeChips(NOTETO, NOTICE.to, 'ntto')
    + '<span class="ntn num">' + noticeWho() + '명</span></div>'
    + '<textarea id="ntBody" rows="3" placeholder="보낼 내용을 적으십시오">'
    + esc(NOTICE.body) + '</textarea>'
    + '<div class="ntw">글머리 · ' + esc(noticeHead()) + '</div>'
    + '<button class="ntgo" data-act="ntsend">보내기</button>'
    + '<div class="ntoff">아직 앱과 안 이어졌습니다 — 눌러도 아직 나가지 않습니다</div>'
    + '</div>';
}
function lineupBarHTML(){
  return lineupBar1('선발', seonbal(), '여기부터 조를 돌며 1부·2부가 섭니다',
      'lnpick', 'lnrun', '선발 고르기', '1·2부 순번 세우기')
    + lineupBar1('3부 시작', bu3Start(), '여기부터 3부끼리 돕니다',
      'ln3pick', 'ln3run', '3부 시작 고르기', '3부 순번 세우기')
    + '<div class="lnbar"><span class="lk">내일</span>'
    + '<span class="lv">' + esc(nextDateLabel(DATE)) + '</span>'
    + '<span class="lw">오늘을 바탕으로 내일을 세웁니다 · 3부 시작은 저절로 정해집니다</span>'
    + '<button class="nd" data-act="nday">내일로 넘기기</button></div>'
    + caughtBar()
    + driftBar();
}
// 달력을 따라가며 스스로 만든 날 — 무엇이 넘어왔고 무엇이 안 넘어왔는지 적는다
function caughtBar(){
  var c = caughtRead();
  if (!c || c.to !== DATE) return '';
  return '<div class="lnbar newd"><span class="lk">새 날</span>'
    + '<span class="lv">' + esc(c.to) + '</span>'
    + '<span class="lw">' + esc(c.from) + ' 것을 이어받아 만들었습니다 · 순번은 아직 안 세웠습니다'
    + (c.abs ? '' : ' · 근태는 안 가져왔습니다') + '</span>'
    + '<button data-act="daypick">지난 날 보기</button>'
    + '<button data-act="cgtseen">알겠습니다</button></div>';
}
// 세운 뒤에 근태가 바뀌면 조용히 알려 준다. 저절로 다시 세우지는 않는다 —
// 세운 뒤에 사람이 손으로 옮겨 놓은 자리를 기계가 되돌리면 그게 더 큰 사고다
function driftBar(){
  var n = driftN();
  if (!n) return '';
  return '<div class="lnbar dft"><span class="lk">어긋남</span>'
    + '<span class="lv">근태 ' + n + '건</span>'
    + '<span class="lw">순번을 세운 뒤에 바뀌었습니다 — 지금 자리가 순번과 다릅니다</span>'
    + '<button data-act="dfkeep">그대로 둡니다</button>'
    + '<button class="on" data-act="dfgo">' + esc(driftName()) + ' 다시 세우기</button></div>';
}
var sbQ = '', sbKind = 'house';
function openSeonbalPick(kind){
  sbKind = kind || 'house';
  var b3 = (sbKind === 'bu3');
  sheetFor = { kind: 'seonbal' };
  $('sheet').innerHTML = '<div class="grab"></div><div class="k">순번 세우기</div>'
    + '<div class="st">' + (b3 ? '3부 시작 고르기' : '선발 고르기') + '</div>'
    + '<div class="sub">고른 사람의 <b>조 자리부터</b> 조를 돌며(4조 다음은 1조) '
    + (b3 ? '<b>3부</b>가 차례로 섭니다. 3부 배지를 단 사람끼리만 돕니다.'
          : '1부와 2부가 차례로 섭니다. 배지가 붙은 사람은 후보에서 빠집니다.') + '</div>'
    + '<div class="grp"><h4>이름으로 좁히기</h4>'
    + '<div class="fld"><input id="sbQ" autocomplete="off" value="' + esc(sbQ)
    + '" placeholder="이름 두 글자만 쳐도 됩니다"></div>'
    + '<div id="sbOut"></div></div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
  drawSeonbalPick();
  var qe = $('sbQ');
  if (qe) qe.addEventListener('input', function(){ sbQ = qe.value; drawSeonbalPick(); });
}
function drawSeonbalPick(){
  var q = (sbQ || '').trim(), b3 = (sbKind === 'bu3');
  var now = b3 ? bu3Start() : seonbal(), pool = lineupPool(sbKind), out = '';
  for (var g = 0; g < JOCNT; g++){
    var chips = '', c = 0;
    pool.forEach(function(n){
      if (joOf(n) !== g) return;
      if (q && n.indexOf(q) < 0) return;
      c++;
      chips += '<button data-sb="' + esc(n) + '"' + (n === now ? ' class="on"' : '') + '>'
        + esc(n) + (n === now ? ' ✓' : '') + '</button>';
    });
    if (c) out += '<div class="sbg"><h5>' + esc(JOLABEL[g] || (g + 1) + '조') + ' · ' + c + '명</h5>'
      + '<div class="sug">' + chips + '</div></div>';
  }
  $('sbOut').innerHTML = out || '<div class="dnote" style="margin-top:10px">'
    + (q ? esc(q) + ' — 후보에 없습니다' : '고를 수 있는 사람이 없습니다') + '</div>';
}
function openLineupPreview(pks){
  pks = pks || ['1', '2'];
  var b3 = (pks.length === 1 && pks[0] === '3');
  var sb = b3 ? bu3Start() : seonbal();
  if (!sb) { toast(b3 ? '3부 시작을 먼저 고르십시오' : '선발을 먼저 고르십시오'); return; }
  var plan = lineupPlan(sb, pks);
  if (!plan) { toast('조 편성이 없어 순번을 못 세웁니다'); return; }
  var chg = plan.slots.filter(function(x){ return x.from !== x.to; });
  sheetFor = { kind: 'lineup', pks: pks };
  $('sheet').innerHTML = '<div class="grab"></div><div class="k">'
    + (b3 ? '3부 시작 ' : '선발 ') + esc(sb) + '</div>'
    + '<div class="st">' + (b3 ? '3부 순번 세우기' : '순번 세우기') + '</div>'
    + '<div class="sub">세우는 자리 ' + plan.slots.length + '개 중 <b>' + chg.length + '개</b>가 바뀝니다 · '
    + '배지가 붙은 ' + plan.fixed.map(function(f){ return part(f.pk).name + ' ' + f.n; }).join('·')
    + '자리는 그대로 둡니다</div>'
    + (chg.length
        ? '<div class="grp"><h4>바뀌는 자리</h4><div class="plan">'
          + chg.map(function(x){
              return '<div class="pr"><span class="pw">' + esc(part(x.pk).name) + ' ' + (x.i + 1) + '번</span>'
                + '<span class="pa">' + esc(x.from) + '</span><span class="par">→</span>'
                + '<span class="pb">' + esc(x.to) + '</span></div>'; }).join('')
          + '</div></div>'
        : '<div class="dnote" style="margin:14px">이미 그 차례대로 서 있습니다</div>')
    + '<div class="calmbox">세운 뒤에 손볼 수 있습니다. 이건 <b>정답이 아니라 출발점</b>입니다 — '
    + '<b>되돌리기</b>나 Ctrl+Z 를 누르면 그대로 돌아옵니다.</div>'
    + '<div class="acts two" style="margin:14px 14px 0">'
    + '<button data-act="lnyes" class="on"' + (chg.length ? '' : ' disabled') + '>이대로 세웁니다</button>'
    + '<button data-act="close">그만두기</button></div>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}

// 날짜 — 하루에 한 칸이니, 다른 날로 건너갈 수 있어야 한다
function openDayPick(){
  var list = dayList(), cur0 = DATE;
  sheetFor = { kind: 'daypick' };
  var rows = list.map(function(d){
    return '<button data-daygo="' + esc(d.date) + '">' + esc(d.date)
      + (d.date === cur0 ? ' ✓' : '') + (d.at ? ' · ' + d.at : '') + '</button>'; }).join('');
  $('sheet').innerHTML = '<div class="grab"></div><div class="k">배치표</div>'
    + '<div class="st">날짜 고르기</div>'
    + '<div class="sub">날마다 <b>따로 저장</b>됩니다. 건너가면 지금 것은 <b>그 날 칸에 두고</b> 갑니다 '
    + '— 내일을 짜도 오늘이 안 지워집니다.</div>'
    + '<div class="grp"><h4>저장된 날</h4><div class="acts">'
    + (rows || '<span style="font-size:12.5px;color:#8b96a2;font-weight:760">저장된 날이 없습니다</span>')
    + '</div></div>'
    + '<div class="grp"><h4>새로 만들기</h4><div class="acts">'
    + '<button data-act="nday">' + esc(nextDateLabel(DATE)) + ' 만들기</button>'
    + '<button data-act="wipemk" class="warn">이 날의 구분 비우기</button></div>'
    + '<div class="dnote">비우기는 <b>그날의 배치</b>를 지웁니다 — 구분(중복 근무·조출·후출)과 '
    + '<b>두 부에 겹쳐 선 자리</b>. 근태·선발·당번·3부반 소속은 그대로 둡니다.</div></div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}
// 안 누르고 닫은 고침 — 켤 때 한 번 묻는다. 아직 아무것도 안 덮었다
function openPending(){
  if (!PENDING) return;
  sheetFor = { kind: 'pending' };
  $('sheet').innerHTML = '<div class="grab"></div><div class="k">' + esc(DATE) + '</div>'
    + '<div class="st">저장하지 않고 닫으셨습니다</div>'
    + '<div class="sub"><b>' + esc(PENDING.at) + '</b>까지 고친 것이 남아 있습니다. '
    + '저장본은 아직 그대로입니다 — 이어서 하시겠습니까?</div>'
    + '<div class="acts two" style="margin:14px 14px 0">'
    + '<button data-act="drfyes" class="on">이어서 하기</button>'
    + '<button data-act="drfno">저장본으로</button></div>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}

// 내일로 넘기기 — 되돌릴 수 있다는 말을 먼저 하고, 캐디 상태를 보여 준 뒤 묻는다
// 무엇을 들고 갈지 — 두 화면이 같은 칸을 쓴다
function carryOptsHTML(c){
  var row = function(k, name, sub){
    var on = carryOpt(k);
    return '<button class="copt' + (on ? ' on' : '') + '" data-copt="' + k + '">'
      + '<span class="cx">' + (on ? '\u2713' : '') + '</span>'
      + '<span class="cn">' + esc(name) + '<i>' + esc(sub) + '</i></span>'
      + '<span class="cs">' + (on ? '가져감' : '안 가져감') + '</span></button>';
  };
  return '<div class="grp"><h4>무엇을 들고 갈까요</h4>'
    + row('tees', '팀 (티오프 시각표)',
        c.teams.map(function(x){ return x.name + ' ' + x.n + '팀'; }).join(' · ')
        + ' — 어제 것입니다. 예약처에서 온 것이 아닙니다')
    + row('grid', '티오프 시간대 (팀 없이 칸만)',
        '팀을 안 가져갈 때만 들어립니다 — 어제와 같은 시각 칸이 빈 채로 서 있습니다')
    + row('seats', '자리 (누가 어느 자리에)',
        '켜면 순번 세우기를 안 눌러도 어제 사람이 그대로 앉아 있습니다')
    + row('abs', '휴무', c.abs['휴무'] + '명 — 그날 하루짜리라 안 가져오는 것이 기본입니다')
    + row('leave', '휴가 · 병가', '휴가 ' + c.abs['휴가'] + ' · 병가 ' + c.abs['병가']
        + '명 — 여러 날 이어지므로 가져옵니다')
    + row('role', '선발', '선발 ' + (c.sb || '없음')
        + ' — 당번·벌당은 그날치라 언제나 비웁니다')
    + row('staff', '경기과 마샬', (c.ms.length ? '오늘 ' + c.ms.join('·') : '오늘 없음')
        + ' — 날마다 바뀌니 비우는 것이 기본입니다. 대리·주임은 그대로 둡니다')
    + row('ln3', '3부 순번을 저절로 세우기', carryOpt('seats')
        ? (c.sb3 ? '★넘기는 순간 ' + c.sb3 + '부터 3부에 이름이 찹니다' : '시작할 사람이 없습니다')
        : '자리를 비우면 안 세웁니다 — 넘긴 뒤 직접 누르십시오')
    + '<div class="dnote"><b>팀과 자리를 다 끄면</b> 내일은 <b>정말 빈 판</b>입니다 — 팀도 사람도 없습니다.<br>'
    + '<b>자리만 끄면</b> 팀(티오프)은 그대로 오고 사람만 비웁니다. 그래야 팀을 넣어도 '
    + '뒤에서 스페어가 안 올라오고, 원하는 사람만 놓은 뒤 <b>순번 세우기</b>로 채웁니다.<br>'
    + '<b>3부 순번을 저절로 세우기</b>는 자리를 가져올 때만 돕니다 — 켜져 있으면 '
    + '순번 세우기를 안 눌러도 3부에 이름이 차 있습니다.<br>'
    + '<b>휴무</b>를 안 가져오면 내일은 그 사람들이 <b>근무</b>로 시작합니다 — '
    + '오늘 쉰 사람을 지우고 다시 넣을 일이 없습니다. '
    + '내일 쉴 사람은 근무표의 <b>한꺼번에 지정</b>으로 넣으십시오.<br>'
    + '<b>경기과 마샬</b>을 안 가져오면 내일 마샬 칸이 비어 있습니다 — '
    + '거기 넣는 캐디가 곧 그날의 <b>배치</b>입니다. 따로 지정하지 않습니다.</div></div>';
}
function openCarry(){
  var c = carryPlan();
  sheetFor = { kind: 'nday' };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">' + esc(DATE) + ' → ' + esc(c.date) + '</div>'
    + '<div class="st">내일 준비</div>'
    + '<div class="sub">아래 <b>캐디 상태를 먼저 확인</b>하십시오. '
    + '내일 달라질 사람은 넘긴 뒤에 고치고 <b>순번 세우기</b>를 다시 누르셔도 됩니다.</div>'
    + carryOptsHTML(c)
    + '<div class="grp"><h4>오늘 상태</h4><div class="crl">'
    + carryLines(c).map(function(x){
        return '<div class="cr"><span class="ck">' + esc(x[0]) + '</span>'
          + '<span class="cv">' + esc(x[1]) + '</span></div>'; }).join('')
    + '</div></div>'
    + '<div class="calmbox"><b>언제든 이전으로 되돌릴 수 있습니다.</b> '
    + '<b>되돌리기</b>나 Ctrl+Z 를 누르면 넘기기 직전으로 돌아갑니다. '
    + '저장을 누르기 전이라면 새로고침만 해도 됩니다.</div>'
    + '<div class="acts two" style="margin:14px 14px 0">'
    + '<button data-act="ndayyes" class="on">내일로 넘깁니다</button>'
    + '<button data-act="close">먼저 고치겠습니다</button></div>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}

// 대바 상대 고르기 · 이름 찾기 — 사람 단위로만 나온다(두 부 근무도 한 덩어리)
var pkFilter = '';
function pickerList(q){
  q = (q || '').trim();
  var idx = peopleIndex();
  var names = idx.order.filter(function(n){
    if (q && n.indexOf(q) < 0) return false;
    var s = idx.map[n];
    if (pkFilter === 'off') return s.length === 0;
    if (pkFilter) return s.some(function(x){ return x.part === pkFilter; });
    return true;
  });
  names.sort(function(a, b){ return a.localeCompare(b, 'ko'); });

  var tabs = [['', '전체'], ['1', '1부'], ['2', '2부'], ['3', '3부'], ['off', '휴무']].map(function(f){
    return '<button data-filter="' + f[0] + '" class="fchip' + (pkFilter === f[0] ? ' on' : '') + '">'
      + f[1] + '</button>';
  }).join('');
  var h = '<div class="frow">' + tabs + '<span class="fcnt">' + names.length + '명</span></div>';
  if (!names.length) return h + '<div class="k" style="margin:16px 0">해당하는 사람이 없습니다</div>';

  names.forEach(function(n){
    var seats = idx.map[n], btns, note;
    if (seats.length){
      btns = seats.map(seatBtn).join('');
      note = seats.length > 1
        ? '<span class="multi">오늘 ' + seats.length + '곳</span>'
        : '';
    } else {
      var why = dupReason(pick, { offName: n });
      btns = '<button data-swapoff="' + esc(n) + '"' + (why ? ' disabled' : '') + '>오늘 휴무 · 대신 넣기'
        + (why ? ' <i style="color:#a33b3b">' + esc(why) + '</i>' : '') + '</button>';
      note = '<span class="rest">휴무</span>';
    }
    h += '<div class="pcard"><div class="ph2"><b>' + esc(n) + '</b>' + note + '</div>'
      + '<div class="sgw">' + btns + '</div></div>';
  });
  return h;
}
function openPicker(){
  sheetFor = { picker: true };
  $('sheet').innerHTML = '<div class="grab"></div>'
    + '<div class="k">' + (pick ? '대바 상대 고르기' : '이름 찾기') + '</div>'
    + '<div class="st">' + (pick ? esc(pick.nm) + '와(과) 바꿀 사람' : '누구를 찾으십니까') + '</div>'
    + '<div class="sub">'
    + (pick ? '부를 가리지 않습니다. <b>오늘 쉬는 사람</b>도 됩니다.<br>'
            : '이름을 누르면 <b>그 자리로 갑니다.</b> 거기서 바꾸거나 고치면 됩니다.<br>')
    + '이름을 치면 <b>그 사람이 오늘 앉은 자리가 전부</b> 나옵니다 — 두 부 근무면 두 곳 다.</div>'
    + '<div class="fld"><input id="pkQ" placeholder="이름으로 찾기 (예: 김동우)" autocomplete="off"></div>'
    + '<div id="pkList" style="max-height:46vh;overflow-y:auto;margin-top:6px">' + pickerList('') + '</div>'
    + '<button class="close" data-act="close">닫기</button>';
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
  var q = $('pkQ');
  if (q){
    q.addEventListener('input', function(){ $('pkList').innerHTML = pickerList(q.value); });
    setTimeout(function(){ q.focus(); }, 240);
  }
}

// ── 순번 · 명단 서랍 ────────────────────────
var drwOpen = false;
function drawDrawer(){
  var p = part(drwPart), n = p.tees.length, ai = 0;
  $('drwTabs').innerHTML = DAY.map(function(q){
    return '<button data-dtab="' + q.key + '" class="' + (q.key === drwPart ? 'on' : '') + '">' + q.name + '</button>';
  }).join('');
  var rows = p.roster.map(function(r, ri){
    var st, cls = '';
    if (r.off){ st = '결근'; cls = ' off'; }
    else {
      var t = p.tees[ai];
      st = t ? (t.time + ' ' + t.course) : '대기';
      if (!t) cls = ' wait';
      ai++;
    }
    var line = (!r.off && ai === n + 1 && !cls) ? '' : '';
    return line + '<div class="rrow' + cls + '" data-key="' + ri + '">'
      + '<span class="grip" data-grip="1"></span>'
      + '<span class="rp num">' + (r.off ? '—' : ai) + '</span>'
      + '<span class="rn">' + esc(r.n) + '</span>'
      + (r.tag ? '<span class="rt' + tagClass(r) + '">' + esc(r.tag) + '</span>' : '')
      + (r.role ? '<span class="rt" style="background:#e6f4ee;color:#0f6b47">' + esc(r.role) + '</span>' : '')
      + '<span class="rs">' + st + '</span>'
      + '<button class="rb" data-up="' + ri + '">↑</button>'
      + '<button class="rb" data-down="' + ri + '">↓</button>'
      + '<button class="rb" data-off="' + ri + '">' + (r.off ? '복' : '결') + '</button>'
      + '<button class="rb warn" data-del="' + ri + '">×</button>'
      + '</div>';
  });
  // 확정선을 근무 마지막 사람 뒤에 그린다
  var seen = 0, at = rows.length;
  for (var i = 0; i < p.roster.length; i++){
    if (p.roster[i].off) continue;
    seen++;
    if (seen === n) { at = i + 1; break; }
  }
  rows.splice(at, 0, '<div class="cutrow"><span class="ln"></span><span class="tx">확정선 · 여기까지 근무</span><span class="ln"></span></div>');
  $('drwBody').innerHTML = rows.join('')
    + '<div class="addrow"><input id="drwNew" placeholder="캐디 이름" autocomplete="off">'
    + '<button data-add="' + p.key + '">맨 뒤에 넣기</button></div>'
    + '<div class="drwsug">' + addablePool(p.key).map(function(n){
        var t = tagOf(n);
        return '<button data-padd="' + p.key + '" data-pn="' + esc(n) + '">' + esc(n)
          + (t ? '<i>' + esc(t) + '</i>' : '') + '</button>'; }).join('') + '</div>'
    + '<div class="dnote"><b>왼쪽 손잡이를 끌면</b> 순번이 그 자리로 갑니다 — 사이에 낀 사람들은 한 칸씩 밀립니다. '
    + '↑↓는 한 칸씩만 옮깁니다.<br>'
    + '<b>결근</b>은 명단에 남기고 자리만 뺍니다 — 뒤 순번이 당겨집니다. '
    + '<b>×</b>는 이 부에서 아예 뺍니다(어느 부에도 없어지면 <b>미배치</b>). '
    + '오늘 안 나온 사람은 결근이 맞습니다.<br>'
    + '넣을 때는 <b>아래 이름을 누르십시오</b> — 손으로 치면 오타가 납니다.</div>';
}
function openDrawer(){ drwOpen = true; drwPart = cur; drawDrawer(); $('scrim').classList.add('on'); $('drw').classList.add('on'); }
function closeDrawer(){ drwOpen = false; $('scrim').classList.remove('on'); $('drw').classList.remove('on'); }

// 검색 결과 한 줄을 눌렀을 때 — 대바 중이면 바꾸고, 아니면 그 자리로 간다
function rerenderLists(){
  var d = $('findDrop'), fq2 = $('findQ');
  if (d && !d.hidden && fq2) d.innerHTML = pickerList(fq2.value);
  var pl = $('pkList'), pq = $('pkQ');
  if (pl) pl.innerHTML = pickerList(pq ? pq.value : '');
}
function actOnResult(b){
  if (b.hasAttribute('data-filter')){
    pkFilter = b.getAttribute('data-filter');
    rerenderLists();
    return true;
  }
  if (b.hasAttribute('data-swapto')){
    var s = b.getAttribute('data-swapto').split(':'), tpk = s[0], tri = Number(s[1]);
    closeSheet(); hideDrop();
    if (!pick){
      var tp = part(tpk), tr = tp.roster[tri];
      if (tr && tr.off) { toast(tr.n + '은(는) ' + tp.name + ' 결근입니다 — 순번 · 명단에서 보십시오'); return true; }
      cur = tpk; paint(); jump(tpk);
      var ai = active(tp).indexOf(tr);
      if (ai >= 0) setTimeout(function(){ openCell(tpk, ai); }, 60);
      return true;
    }
    pickWith({ pk: tpk, ri: tri });
    return true;
  }
  if (b.hasAttribute('data-swapoff')){
    var on = b.getAttribute('data-swapoff');
    closeSheet(); hideDrop();
    if (!pick){ toast(on + '은(는) 오늘 휴무입니다 — 배치표에서 바꿀 칸을 먼저 누르십시오'); return true; }
    if (pickList.length > 1){ toast('휴무자는 두 자리만 바꿀 때 넣을 수 있습니다'); return true; }
    swapRef(pick, { offName: on });
    pickClear(); paint(); return true;
  }
  return false;
}
function hideDrop(){ var d = $('findDrop'); if (d) d.hidden = true; }
function jump(pk){
  var el = $('col' + pk);
  if (el && window.matchMedia('(min-width:721px)').matches) el.scrollIntoView({ block: 'start' });
}
var toastT = null;
function toast(m){
  var el = $('toast'); el.textContent = m; el.classList.add('on');
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(function(){ el.classList.remove('on'); }, 2400);
}

// ── 누르기 ──────────────────────────────────
// ── 이름을 집어 다른 이름 위에 놓으면 그 둘이 자리를 바꾼다 ──────
// 누르면 창이 열리고, 끌면 대바다. 6px 넘게 움직여야 끄는 것으로 친다.
var cdrag = null, cdragBlock = 0;
function cellRef(el){
  if (!el) return null;
  var pk = el.getAttribute('data-pk');
  if (pk == null) return null;
  var i = Number(el.getAttribute('data-i')), ri = riOf(pk, i);
  if (ri < 0) return null;
  return { pk: pk, ri: ri, i: i, nm: el.getAttribute('data-nm') || '' };
}
function ghostOn(nm){
  var g = $('ghost');
  g.textContent = nm;
  g.hidden = false;
}
function ghostMove(x, y){
  var g = $('ghost');
  g.style.left = (x + 14) + 'px';
  g.style.top = (y + 12) + 'px';
}
function dragClear(){
  if (!cdrag) return;
  if (cdrag.el) cdrag.el.classList.remove('pick');
  if (cdrag.tgt) cdrag.tgt.classList.remove('hl', 'no');
  $('ghost').hidden = true;
  document.body.classList.remove('celldrag');
}
function dragOver(el){
  if (cdrag.tgt && cdrag.tgt !== el) cdrag.tgt.classList.remove('hl', 'no');
  cdrag.tgt = null; cdrag.tref = null; cdrag.why = '';
  var ref = cellRef(el);
  if (!ref || !ref.nm) return;
  if (ref.pk === cdrag.ref.pk && ref.ri === cdrag.ref.ri) return;   // 제 자리
  var why = dupReason(cdrag.ref, ref);
  el.classList.add(why ? 'no' : 'hl');
  cdrag.tgt = el; cdrag.tref = ref; cdrag.why = why;
  $('ghost').className = 'ghost' + (why ? ' no' : ' ok');
  $('ghost').textContent = why
    ? cdrag.ref.nm + ' → ' + why
    : cdrag.ref.nm + ' ↔ ' + ref.nm;
}
$('cols').addEventListener('pointerdown', function(e){
  if (e.button || pickList.length) return;      // 집는 중엔 누르는 길로 간다
  if (delPk) return;                            // ★지울 팀을 고르는 중엔 끌지 않는다
  var ref = cellRef(e.target.closest('[data-pk][data-i]'));
  if (!ref || !ref.nm) return;                  // 빈 자리는 못 집는다
  cdrag = { ref: ref, el: e.target.closest('[data-pk][data-i]'),
            x: e.clientX, y: e.clientY, id: e.pointerId, on: false, tgt: null, tref: null, why: '' };
});
$('cols').addEventListener('pointermove', function(e){
  if (!cdrag) return;
  if (!cdrag.on){
    if (Math.abs(e.clientX - cdrag.x) + Math.abs(e.clientY - cdrag.y) < 6) return;
    cdrag.on = true;
    cdrag.el.classList.add('pick');
    document.body.classList.add('celldrag');
    try { cdrag.el.setPointerCapture(cdrag.id); } catch (x) { /* 옛 브라우저 */ }
    ghostOn(cdrag.ref.nm);
    $('ghost').className = 'ghost';
  }
  e.preventDefault();
  ghostMove(e.clientX, e.clientY);
  var under = document.elementFromPoint(e.clientX, e.clientY);
  dragOver(under ? under.closest('[data-pk][data-i]') : null);
});
function dragEnd(){
  if (!cdrag) return;
  var d = cdrag;
  dragClear();
  cdrag = null;
  if (!d.on) return;
  cdragBlock = 1;                               // 놓은 자리에서 창이 딸려 열리지 않게
  setTimeout(function(){ cdragBlock = 0; }, 0);
  if (d.why) { toast(d.why + ' — 대바를 못 합니다'); return; }
  if (!d.tref) { toast('놓을 자리를 못 찾았습니다'); return; }
  rotateSeats([{ pk: d.ref.pk, ri: d.ref.ri }, { pk: d.tref.pk, ri: d.tref.ri }]);
  paint();
}
$('cols').addEventListener('pointerup', dragEnd);
$('cols').addEventListener('pointercancel', dragEnd);
document.addEventListener('pointerup', function(){ if (cdrag && !cdrag.on) cdrag = null; });

function railClick(e){
  var b = e.target.closest('button');
  if (!b) return;
  var a = b.getAttribute('data-act');
  if (a === 'wipemk') { closeSheet(); wipeDayMarks(); paint(); }
  else if (a === 'cgtseen') { caughtSeen(); paint(); }
  else if (a === 'daypick') openDayPick();
  else if (a === 'dfkeep') { driftKeep(); paint(); }
  else if (a === 'dfgo'){
    var ds = driftStart();
    if (!ds) toast('시작할 사람이 없습니다');
    else { applyLineup(ds, driftPks()); paint(); }
  }
  else if (a === 'nday') openCarry();
  else if (a === 'lnpick') openSeonbalPick('house');
  else if (a === 'ln3pick') openSeonbalPick('bu3');
  else if (a === 'lnrun') openLineupPreview(['1', '2']);
  else if (a === 'ln3run') openLineupPreview(['3']);
  else if (a === 'ntsend') noticeSend();
  else if (b.hasAttribute('data-ntkind')){
    if (noticeSet('kind', b.getAttribute('data-ntkind'))) { noticeStash(); paint(); }
  }
  else if (b.hasAttribute('data-ntto')){
    if (noticeSet('to', b.getAttribute('data-ntto'))) { noticeStash(); paint(); }
  }
}
// 적던 글은 새로고침을 해도 남는다 — 배치표 장부가 아니라 이 브라우저의 쓰다 만 글이다
function noticeStash(){
  try { localStorage.setItem('board.notice', JSON.stringify(NOTICE)); } catch (e) { /* 못 적어도 이번은 쓴다 */ }
}
try { var nt0 = JSON.parse(localStorage.getItem('board.notice') || 'null');
      if (nt0 && typeof nt0 === 'object'){
        if (NOTEKIND.indexOf(nt0.kind) >= 0) NOTICE.kind = nt0.kind;
        if (NOTETO.indexOf(nt0.to) >= 0) NOTICE.to = nt0.to;
        NOTICE.body = String(nt0.body || ''); } }
catch (e) { /* 못 읽으면 빈 글로 열다 */ }
// 글자를 칠 때마다 다시 그리지 않는다 — 그러면 글자가 달아난다
$('railSum').addEventListener('input', function(e){
  if (e.target && e.target.id === 'ntBody'){ NOTICE.body = e.target.value; noticeStash(); }
});
// ★한 손잡이를 두 레일이 나눠 쓴다 — 같은 단추가 두 화면에 산다
$('railSum').addEventListener('click', railClick);
$('brail').addEventListener('click', railClick);

// ★Ctrl 을 누르고 있는 동안은 칸이 '집을 수 있다'고 보여야 한다 — 숨은 기능은 없는 기능이다
function ctrlPickMark(on){
  var st = $('stage');
  if (st) st.classList.toggle('ctrlpick', !!on);
}
document.addEventListener('keydown', function(e){ if (e.key === 'Control' || e.key === 'Meta') ctrlPickMark(true); });
document.addEventListener('keyup', function(e){ if (e.key === 'Control' || e.key === 'Meta') ctrlPickMark(false); });
window.addEventListener('blur', function(){ ctrlPickMark(false); });
$('cols').addEventListener('click', function(e){
  if (cdragBlock) return;
  var el = e.target.closest('[data-addteam]');
  if (el) { openAddTeam(el.getAttribute('data-addteam')); return; }
  // ★대기 맨 끝의 '+ 대기' 칸 — 대기 순번을 하나 만들며 사람을 앉힌다
  var spa = e.target.closest('[data-spadd]');
  if (spa) { openSpareAdd(spa.getAttribute('data-spadd')); return; }
  var spc = e.target.closest('[data-spcap]');
  if (spc) { openSpareCap(spc.getAttribute('data-spcap')); return; }
  // ★팀 지우기 — 켜고, 전부 고르고, 지운다
  var dm = e.target.closest('[data-delmode]');
  if (dm){
    var dk = dm.getAttribute('data-delmode');
    if (delOn(dk)) delOff();
    else { pickClear(); delPk = dk; delSel = []; toast(part(dk).name + ' 지울 팀을 고르십시오 — 아직 안 지웁니다'); }
    paint(); return;
  }
  var da = e.target.closest('[data-delall]');
  if (da){
    var ak = da.getAttribute('data-delall'), at = part(ak).tees.length;
    if (delSel.length === at) delSel = [];
    else { delSel = []; for (var q = 0; q < at; q++) delSel.push(q); }
    paint(); return;
  }
  var dg = e.target.closest('[data-delgo]');
  if (dg){
    var gk = dg.getAttribute('data-delgo'), sel = delSel.slice();
    if (!sel.length) { toast('지울 팀을 고르십시오'); return; }
    delOff();
    delTeams(gk, sel);
    paint(); return;
  }
  var s = e.target.closest('[data-slot]');
  if (s){
    if (pickList.length) { pickClear(); paint(); return; }
    var sec = s.closest('.pcol'), pk2 = sec.id.replace('col', '');
    var a2 = s.getAttribute('data-slot').split('|');
    addTeam(pk2, a2[0], a2[1]);
    return;
  }
  var tt = e.target.closest('[data-tee]');
  if (tt){
    var tv2 = tt.getAttribute('data-tee').split('|');
    openTeeTime(tv2[0], Number(tv2[1])); return;
  }
  var c = e.target.closest('[data-pk][data-i]');
  if (!c) return;
  var pk = c.getAttribute('data-pk'), i = Number(c.getAttribute('data-i'));
  // ★지우기 상태에서는 칸을 눌러도 창이 안 열린다 — 고르는 중이다
  if (delOn(pk)){
    if (!part(pk).tees[i]) { toast('대기 자리는 팀이 아닙니다'); return; }
    delToggle(i); paint(); return;
  }
  if (delPk) { delOff(); paint(); return; }   // 딴 부를 누르면 그만둔다
  // ★Ctrl(또는 ⌘)을 누른 채 누르면 창을 안 열고 자리를 집는다 — 여럿 골라 한 바퀴 돌린다
  if (e.ctrlKey || e.metaKey){
    e.preventDefault();
    var ri3 = riOf(pk, i);
    if (ri3 < 0) { toast('빈 줄은 못 집습니다'); return; }
    var first = !pickList.length;
    pickToggle(pk, ri3);
    if (first) toast('Ctrl 을 누른 채 바꿀 자리를 더 누르십시오 — 둘이면 맞바꾸고 셋 넷이면 한 바퀴 돕니다');
    return;
  }
  if (pickList.length){
    var ri2 = riOf(pk, i);
    if (ri2 >= 0) pickToggle(pk, ri2);
    return;
  }
  openCell(pk, i);
});
$('sheet').addEventListener('click', function(e){
  var b = e.target.closest('button');
  if (!b) return;
  var bkd = b.getAttribute('data-bkdo');
  if (bkd){
    if (bkd === 'clear'){ bulkPickClear(); paint(); openBulkAct(); return; }
    if (bkd.charAt(0) === 's'){                    // 배치표에 N번부터 앉히기
      var fe = $('bkFrom');
      if (fe) bkFrom = Math.max(1, Math.floor(Number(fe.value) || 1));
      seatMany(bkd.slice(2), bkFrom, bulkPicked());
      paint(); openBulkAct(); return;
    }
    if (bkd.charAt(0) === 'p'){                    // ★부 지정 — 배치표는 안 건드린다
      bulkApplyPlan(bkd.slice(2), bkd.charAt(1) === '+');
      paint(); openBulkAct(); return;
    }
    if (bkd.charAt(0) === 't') bulkApplyTag(bkd.slice(2));
    else bulkApplyPart(bkd.slice(1), bkd.charAt(0) === '+');
    openBulkAct(); return;
  }
  if (b.getAttribute('data-act') === 'bkyes'){ closeSheet(); bulkReset(); return; }
  var acj = b.getAttribute('data-acjo');
  if (acj !== null && b.hasAttribute('data-acjo')){ addJo = Number(acj); drawAddCaddie(); return; }
  if (b.getAttribute('data-act') === 'acgo'){
    var an = $('acName');
    if (addCaddie(an ? an.value : '', addJo)) { closeSheet(); paint(); }
    else if (an) an.focus();
    return;
  }
  if (b.getAttribute('data-act') === 'delcad' && sheetFor && sheetFor.person){
    openDelCaddie(sheetFor.person); return;
  }
  if (b.getAttribute('data-act') === 'delcadyes' && sheetFor && sheetFor.person){
    var dn = sheetFor.person; closeSheet(); delCaddie(dn); paint(); return;
  }
  var cop = b.getAttribute('data-copt');
  if (cop){ setCarryOpt(cop, !carryOpt(cop)); openCarry(); return; }
  // ★시트 안 단추는 시트 듣개가 받는다 — railSum 듣개는 시트에 안 닿는다
  if (b.getAttribute('data-act') === 'wipemk'){ closeSheet(); wipeDayMarks(); paint(); return; }
  if (b.getAttribute('data-act') === 'nday'){ openCarry(); return; }
  if (b.getAttribute('data-act') === 'drfyes'){ closeSheet(); draftResume(); return; }
  if (b.getAttribute('data-act') === 'drfno'){ closeSheet(); draftDiscard(); return; }
  if (b.hasAttribute('data-daygo')){ var dgo = b.getAttribute('data-daygo'); closeSheet(); daySwitch(dgo); return; }
  if (b.getAttribute('data-act') === 'ndayyes'){
    closeSheet(); carryToNextDay(); paint();
    toast('내일로 넘겼습니다 · 되돌리려면 되돌리기');
    return;
  }
  var sbn = b.getAttribute('data-sb');
  if (sbn){
    if (sbKind === 'bu3') setBu3Start(sbn); else setSeonbal(sbn);
    closeSheet(); paint(); return;
  }
  if (b.getAttribute('data-act') === 'lnyes'){
    var pks2 = (sheetFor && sheetFor.pks) || ['1', '2'];
    var b32 = (pks2.length === 1 && pks2[0] === '3');
    var sb2 = b32 ? bu3Start() : seonbal();
    closeSheet(); applyLineup(sb2, pks2); paint(); return;
  }
  if (!sheetFor) return;
  var pk = sheetFor.pk, i = sheetFor.i, act = b.getAttribute('data-act');
  var sg = b.getAttribute('data-sg');
  if (sg){
    var sv = sg.split('|');
    sgStart = '';
    openSeatGo(sv[0], Number(sv[1]), sv.slice(2).join('|'));
    return;
  }
  var sgs = b.getAttribute('data-sgs');
  if (sgs){ sgStart = (sgStart === sgs) ? '' : sgs; drawSeatGo(false); return; }
  if (b.getAttribute('data-act') === 'sggo' && sheetFor && sheetFor.kind === 'seatgo'){
    seatGroup(sheetFor.pk, sheetFor.i, sheetFor.key, sgStart);
    closeSheet(); paint(); return;
  }
  var cpt = b.getAttribute('data-capto');
  if (cpt){
    var cv = cpt.split('|');
    setCapNo(cv[0], Number(cv[1]) || 0);
    closeSheet(); paint(); return;
  }
  if (b.getAttribute('data-act') === 'capgo' && sheetFor && sheetFor.pk !== undefined){
    setCapNo(sheetFor.pk, Number($('capNo') ? $('capNo').value : 0) || 0);
    closeSheet(); paint(); return;
  }
  var insn = b.getAttribute('data-insn');
  if (insn && sheetFor){ insertAt(sheetFor.pk, sheetFor.i, insn); closeSheet(); paint(); return; }
  // ★빈 자리에 앉히기 — 고른 사람이 그 순번에 앉는다. 뒤는 안 밀린다
  var stn = b.getAttribute('data-seatn');
  if (stn && sheetFor && sheetFor.pk !== undefined){
    if (sheetFor.spare) addRow(sheetFor.pk, stn);
    else seatPerson(sheetFor.pk, sheetFor.i, stn);
    closeSheet(); paint(); return;
  }
  if (b.getAttribute('data-act') === 'seatgo' && sheetFor && sheetFor.pk !== undefined){
    var sq = ($('seatQ') ? $('seatQ').value : '').trim();
    if (!sq) { toast('이름을 치십시오'); return; }
    // ★친 그대로 있으면 그 사람, 없으면 이름에 든 사람을 찾는다.
    //   여럿이면 고르게 한다 — 기계가 마음대로 하나를 고르면 딴 사람이 앉는다
    var cand = JONAMES.filter(function(n){ return n === sq; });
    if (!cand.length) cand = JONAMES.filter(function(n){ return n.indexOf(sq) >= 0; });
    if (!cand.length) { toast('명부에 ' + sq + '이(가) 없습니다 — 근무표에서 먼저 넣으십시오'); return; }
    if (cand.length > 1) { toast(sq + '에 맞는 사람이 ' + cand.length + '명입니다 — 아래에서 고르십시오'); return; }
    if (sheetFor.spare) addRow(sheetFor.pk, cand[0]);
    else seatPerson(sheetFor.pk, sheetFor.i, cand[0]);
    closeSheet(); paint(); return;
  }
  if (act === 'ins' && sheetFor){ insQ = ''; openInsert(pk, i); return; }
  if (act === 'itnon' || act === 'itnoff' || act === 'itnname'){
    setIntern(pk, i, $('itnName') ? $('itnName').value : '', act !== 'itnoff');
    closeSheet(); paint(); return;
  }
  if (actOnResult(b)) return;
  if (b.hasAttribute('data-dutydel')) {
    dutyDel(sheetFor.key, Number(b.getAttribute('data-dutydel')));
    openDuty(sheetFor.key); return;
  }
  if (b.hasAttribute('data-dutytog')) {
    var tn = b.getAttribute('data-dutytog');
    if (dutyAt(sheetFor.key, tn) < 0 && (newT() || newH())){
      var da2 = dutyList(sheetFor.key).slice();
      da2.push({ n: tn, t: newT(), h: newH() });
      setDutyList(sheetFor.key, da2);
    } else dutyToggle(sheetFor.key, tn);
    openDuty(sheetFor.key); return;
  }
  if (b.hasAttribute('data-n')) { var el = $('shName'); if (el) el.value = b.getAttribute('data-n'); return; }
  if (b.hasAttribute('data-bu3') && sheetFor.person){
    setBu3(sheetFor.person, b.getAttribute('data-bu3') === '1');
    openPerson(sheetFor.person); return;
  }
  if (b.hasAttribute('data-dtag')){
    var dwho = sheetFor.person
      || (sheetFor.pk !== undefined && active(part(sheetFor.pk))[sheetFor.i]
          ? active(part(sheetFor.pk))[sheetFor.i].n : '');
    if (!dwho) return;
    setDayTag(dwho, b.getAttribute('data-dtag'));
    if (sheetFor.person) openPerson(dwho); else openCell(sheetFor.pk, sheetFor.i);
    return;
  }
  // ★부 지정 — 배치표는 안 건드린다
  if (b.hasAttribute('data-pln') && sheetFor.person){
    var plk = b.getAttribute('data-pln');
    setPlan(sheetFor.person, plk, !inPlan(sheetFor.person, plk));
    paint(); openPerson(sheetFor.person); return;
  }
  if (b.hasAttribute('data-prm')){
    delFromPart(b.getAttribute('data-prm'), sheetFor.person); openPerson(sheetFor.person); return;
  }
  if (b.hasAttribute('data-padd')){
    var pw = b.getAttribute('data-pn') || sheetFor.person;
    addRow(b.getAttribute('data-padd'), pw);
    openPerson(pw);                      // ★창은 닫지 않는다 — 잇달아 넣는 일이다
    return;
  }
  // ★근태 단추에는 data-act 이 없다 — 아래 '없으면 나간다'보다 위에 있어야 눌린다
  if (b.hasAttribute('data-abs')) {
    setAbsent(sheetFor.person, b.getAttribute('data-abs')); openPerson(sheetFor.person); return;
  }
  if (!act) return;
  if (act === 'close') { closeSheet(); return; }
  if (act === 'pdelyes') { var pkk = sheetFor.partKey; closeSheet(); delPart(pkk);
    if (cfgOpen) drawCfg(); return; }
  if (act === 'cdelyes') { var ckk = sheetFor.courseKey; closeSheet(); ctDel(ckk); return; }
  if (act === 'dutyadd') {
    var dv = $('dutyQ').value.trim();     // 안 쓰면 공백 자리로 들어간다
    if (dv && dutyAt(sheetFor.key, dv) >= 0) { toast(dv + '은(는) 이미 있습니다'); return; }
    var da = dutyList(sheetFor.key).slice();
    da.push({ n: dv, t: newT(), h: newH() });
    setDutyList(sheetFor.key, da);
    openDuty(sheetFor.key); return;
  }
  if (act === 'cartsave' && sheetFor.cart) {
    setCartToday(sheetFor.cart, $('cartN') ? $('cartN').value : 0);
    openCart(sheetFor.cart); return;
  }
  if (act === 'cartmine' && sheetFor.cart) {
    setCartToday(sheetFor.cart, ownCart(sheetFor.cart)); openCart(sheetFor.cart); return;
  }
  if (act === 'cartown' && sheetFor.cart) {
    setCart(sheetFor.cart, $('cartOwnN') ? $('cartOwnN').value : 0);
    openCart(sheetFor.cart); return;
  }
  if (act === 'cartpick' && sheetFor.cart) { openCartPick(sheetFor.cart); return; }
  if (b.hasAttribute('data-cartno') && sheetFor.cart) {
    var cpn2 = sheetFor.cart;
    setCartToday(cpn2, b.getAttribute('data-cartno')); openCart(cpn2); return;
  }
  if (act === 'cartbad' || act === 'cartok') {
    setCartBad(cartOf(sheetFor.cart), act === 'cartbad');
    openCart(sheetFor.cart); return;
  }
  if (act === 'dutyapply') { dutyApplyDef(sheetFor.key); openDuty(sheetFor.key); return; }
  if (act === 'dutyclear') { setDutyList(sheetFor.key, []); openDuty(sheetFor.key); return; }
  if (act === 'msdel') { var mi = sheetFor.key; closeSheet(); delMarshal(mi); paint(); return; }
  if (act === 'slotsave' || act === 'slotclear') {
    var v = (act === 'slotclear') ? '' : $('slotName').value.trim();
    if (sheetFor.kind === 'staff') {
      var tv = readTime($('slotTime'));
      setStaff(sheetFor.key, v, tv);
    }
    closeSheet(); return;
  }
  if (act === 'name') { setName(pk, i, $('shName').value.trim()); closeSheet(); return; }
  if (act === 'swap') {
    var r = active(part(pk))[i];
    pickSet(pk, riOf(pk, i), r ? r.n : '');
    closeSheet(); paint(); return;
  }
  if (act === 'role') { setRole(pk, i, b.getAttribute('data-v')); closeSheet(); return; }
  if (act === 'off') {
    var p = part(pk), r2 = active(p)[i];
    setOff(pk, p.roster.indexOf(r2), true); closeSheet(); return;
  }
  if (act === 'prmhere'){
    // 뺀 뒤에는 그 칸에 다른 사람이 올라온다 — 창을 열어 두면 딴 사람 이야기가 된다
    var rh = active(part(pk))[i];
    closeSheet();
    if (rh) delFromPart(pk, rh.n);
    return;
  }
  if (b.getAttribute('data-ttr')){ teeRest = !teeRest; openTeeTime(pk, i); return; }
  if (act === 'ttsave'){
    var tv = readTime($('ttTime'));
    if (!tv) { toast('시각을 24시간으로 적어 주세요 (예: 13:00)'); return; }
    setTeeTime(pk, i, tv, teeRest); closeSheet(); paint(); return;
  }
  // ★칸 창의 '시각 바꾸기'도 같은 문으로 보낸다 — 문이 둘이면 둘이 갈라진다
  if (act === 'time') { openTeeTime(pk, i); return; }
  if (act === 'course') { setCourse(pk, i, b.getAttribute('data-v')); closeSheet(); return; }
  if (act === 'pax') { setPax(pk, i, Number(b.getAttribute('data-v'))); closeSheet(); return; }
  if (act === 'cx') { cancelTee(pk, i); closeSheet(); return; }
  if (act === 'delteam') { delTeam(pk, i); closeSheet(); return; }
  if (act === 'addteam') {
    var at = readTime($('adTime'));
    if (!at) { toast('시각을 24시간으로 적어 주세요 (예: 13:00)'); return; }
    addTeam(pk, at, b.getAttribute('data-v') || ''); closeSheet(); return;
  }
});
$('drw').addEventListener('click', function(e){
  var b = e.target.closest('button');
  if (!b) return;
  var a;
  if ((a = b.getAttribute('data-dtab'))) { drwPart = a; drawDrawer(); return; }
  if ((a = b.getAttribute('data-up')) !== null && b.hasAttribute('data-up')) { moveRow(drwPart, Number(a), -1); return; }
  if (b.hasAttribute('data-down')) { moveRow(drwPart, Number(b.getAttribute('data-down')), 1); return; }
  if (b.hasAttribute('data-off')) {
    var ri = Number(b.getAttribute('data-off'));
    setOff(drwPart, ri, !part(drwPart).roster[ri].off); return;
  }
  if (b.hasAttribute('data-del')) { delRow(drwPart, Number(b.getAttribute('data-del'))); return; }
  if (b.hasAttribute('data-add')) { addRow(drwPart, $('drwNew').value.trim()); return; }
  if (b.hasAttribute('data-padd') && b.hasAttribute('data-pn')) {
    addRow(b.getAttribute('data-padd'), b.getAttribute('data-pn')); return;
  }
});
$('tabs').addEventListener('click', function(e){
  var b = e.target.closest('[data-tab]');
  if (b) { cur = b.getAttribute('data-tab'); paint(); }
});
$('workTable').addEventListener('input', function(e){
  if (!e.target || e.target.id !== 'wkQ') return;
  wkQ = e.target.value;
  drawWkList();                       // ★칸은 그대로 두고 목록만 — 한글 조합이 안 깨지게
});
$('workTable').addEventListener('click', function(e){
  // ★배지가 찾는 칸 옆으로 왔다 — 누르는 것도 여기서 받는다
  var bk = e.target.closest('[data-bulk]');
  if (bk){
    var bkt = bk.getAttribute('data-bulk');
    if (bulkOn() && bulkTag() === bkt) openBulkOff();   // 켜진 것을 또 누르면 끄기다
    else { bulkStart(bkt); var wqe = $('wkQ'); if (wqe) wqe.focus(); }
    return;
  }
  var ja = e.target.closest('[data-joadd]');
  if (ja){ openAddCaddie(ja.getAttribute('data-joadd')); return; }
  if (e.target.closest('[data-act="wkqx"]')) { wkQ = ''; paint(); return; }
  var f = e.target.closest('[data-wfil]');
  if (f) { wkFilter = f.getAttribute('data-wfil'); paint(); return; }
  var c = e.target.closest('[data-cart]');
  if (c) { openCart(c.getAttribute('data-cart')); return; }
  var w = e.target.closest('[data-who]');
  // ★켜 놓았으면 창을 열지 않는다 — 이름을 누르는 것이 곧 지정이다
  if (w) { var wn = w.getAttribute('data-who');
    if (bulkOn()) bulkTap(wn); else openPerson(wn); }
});
$('bulkbar').addEventListener('click', function(e){
  var b = e.target.closest('button');
  if (!b) return;
  var a = b.getAttribute('data-act');
  if (a === 'bkact') openBulkAct();
  else if (a === 'bkundo') bulkUndo();
  else if (a === 'bksave') bulkSave();
  else if (a === 'bkoff') openBulkOff();
});
$('staffBox').addEventListener('click', function(e){
  if (e.target.closest('[data-msadd]')) { addMarshal(); paint(); return; }
  var b = e.target.closest('[data-slot-staff]');
  if (b) openSlot('staff', Number(b.getAttribute('data-slot-staff')));
});
$('dutyBox').addEventListener('click', function(e){
  if (sortBlock) return;                       // 끌고 난 직후엔 창을 열지 않는다
  if (e.target.closest('[data-dtcfg]')) { cfgTab = 'dt'; openCfg(); return; }
  var b = e.target.closest('[data-slot-duty]');
  if (b) openDuty(b.getAttribute('data-slot-duty'));
});
sortable($('dutyBox'), '.slot', dtOrder);
sortable($('sheet'), '.drow', function(order){
  if (!sheetFor || !sheetFor.key) return;
  var k = sheetFor.key;
  dutyOrder(k, order);
  openDuty(k);
});
sortable($('cfg'), '.crow[data-dtrow]', dtOrder);
sortable($('cfg'), '.crow[data-ctrow]', ctOrder);
sortable($('drwBody'), '.rrow', function(order, moved){ rosterOrder(drwPart, order, moved); });
$('bnPick').addEventListener('click', openPicker);
$('hDate').addEventListener('click', openDayPick);   // 날짜를 누르면 다른 날로
$('btnRoster').addEventListener('click', openDrawer);
$('drwClose').addEventListener('click', closeDrawer);
$('scrim').addEventListener('click', function(){ closeSheet(); closeDrawer(); closeCfg(); closeLog(); });
$('bnCancel').addEventListener('click', function(){ pickClear(); paint(); });
$('bnGo').addEventListener('click', pickGo2);
// 상단 검색바
var fq = $('findQ'), fd = $('findDrop');
function drawDrop(){
  var q = fq.value.trim();
  if (!q) { fd.hidden = true; return; }
  fd.innerHTML = pickerList(q);
  fd.hidden = false;
}
fq.addEventListener('input', drawDrop);
fq.addEventListener('focus', drawDrop);
fq.addEventListener('keydown', function(e){
  if (e.key === 'Escape') { fq.value = ''; hideDrop(); fq.blur(); return; }
  if (e.key === 'Enter'){
    var one = fd.hidden ? null : fd.querySelector('button[data-swapto]:not(:disabled),button[data-swapoff]:not(:disabled)');
    if (one) { actOnResult(one); fq.value = ''; }
  }
});
fd.addEventListener('click', function(e){
  var b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.hasAttribute('data-filter')) { actOnResult(b); return; }   // 거르기는 검색어를 지우지 않는다
  if (actOnResult(b)) fq.value = '';
});
document.addEventListener('click', function(e){
  if (!fd.hidden && !e.target.closest('.find')) hideDrop();
});
$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);
$('btnSave').addEventListener('click', daySave);
$('btnApply').addEventListener('click', function(){
  alert('데모입니다 — 실제로는 여기서 캐디 앱에 반영되고, 바뀐 사람에게만 알림이 갑니다.');
});
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') { if (pickList.length) { pickClear(); paint(); }
    closeSheet(); closeDrawer(); closeCfg(); closeLog(); return; }
  // ★저장은 어디에 커서가 있든 저장이다 — 안 막으면 브라우저 '페이지 저장'이 뜬다
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's'){
    e.preventDefault();
    if (e.target && e.target.blur) e.target.blur();   // 치던 칸의 값을 먼저 매듭짓는다
    if (unsaved()) daySave(); else toast('이미 저장돼 있습니다 · ' + (savedAt || ''));
    return;
  }
  var tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;      // 글자 치는 중엔 글자 되돌리기가 먼저다
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'z'){
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'y'){   // 윈도우에서 흔한 다시하기
    e.preventDefault(); redo(); return;
  }
  if (String(e.key).toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey){
    e.preventDefault(); $('findQ').focus(); $('findQ').select();
  }
});



// ══ 설정 — 코드를 안 고치고 화면에서 바꾸는 것들 ═══════════════
var logOpen = false;
function openLog(){ logOpen = true; $('scrim').classList.add('on'); $('logdrw').classList.add('on'); }
function closeLog(){ logOpen = false; $('logdrw').classList.remove('on');
  if (!drwOpen && !cfgOpen) $('scrim').classList.remove('on'); }
$('btnLog').addEventListener('click', openLog);
$('logClose').addEventListener('click', closeLog);

var cfgOpen = false, cfgTab = 'jo';

// 조 편성
function joAdd(){ cfgChange('조 추가 · ' + (JOCNT + 1) + '조', function(){
  JOLABEL.push((JOCNT + 1) + '조'); JOCNT++; }); }
function joDel(i){
  if (JOCNT <= 1) { toast('조는 하나는 남아야 합니다'); return; }
  cfgChange(JOLABEL[i] + ' 지움 · 그 사람들은 다른 조로 옮겨집니다', function(){
    var to = (i === 0 ? 1 : 0);
    Object.keys(JOMAP).forEach(function(n){
      if (JOMAP[n] === i) JOMAP[n] = to;
      if (JOMAP[n] > i) JOMAP[n]--;
    });
    JOLABEL.splice(i, 1); JOCNT--;
  });
}
function joName(i, v){ cfgChange('조 이름 ' + JOLABEL[i] + ' → ' + v, function(){ JOLABEL[i] = v; }); }
function joSet(nm, i){ cfgChange(nm + ' → ' + JOLABEL[i], function(){ JOMAP[nm] = i; }); }
function joAuto(){ cfgChange('임시로 인원 수만 맞춰 나눔 — 실제 조 편성이 아닙니다', function(){
  var per = Math.ceil(JONAMES.length / JOCNT);
  JONAMES.forEach(function(n, k){ JOMAP[n] = Math.min(JOCNT - 1, Math.floor(k / per)); });
}); }
function joClear(){ cfgChange('조 배정을 전부 비움', function(){ JOMAP = {}; }); }
function joDrop(n){ cfgChange(n + ' 조에서 뺌', function(){ delete JOMAP[n]; }); }

// 경기과 자리
function stAdd(){ cfgChange('경기과 자리 추가', function(){
  STAFF.push({ k: '자리 이름', sub: '', n: '', fix: false, t: '07:00' }); }); }
// ★자리를 지우거나 이름을 바꾸면 마샬이 늘고 준다 — 배지도 같이 따라가야 한다
function stDel(i){ var k = STAFF[i].k;
  cfgChange('경기과 ' + k + ' 자리 지움', function(){
    staffEdit(function(){ STAFF.splice(i, 1); }); }); }
function stTitle(i, v){ var k = STAFF[i].k;
  cfgChange('경기과 자리 이름 ' + k + ' → ' + v, function(){
    staffEdit(function(){ STAFF[i].k = v; }); }); }

// 당번 종류
function setGap(v){ v = Math.max(3, Math.min(20, Number(v) || GAP));
  cfgChange('티오프 간격 ' + GAP + '분 → ' + v + '분', function(){ GAP = v; }); }
function setRows(v){ v = Math.max(4, Math.min(40, Number(v) || ROWS));
  cfgChange('격자 줄 수 ' + ROWS + ' → ' + v, function(){ ROWS = v; }); }
// ★대기는 '몇 번 순번까지'로 정한다 — 0이면 제한 없음
function setCapNo(pk, no){
  var p = part(pk), was = spareLastNo(p);
  var v = setSpareLastNo(p, no);
  if (spareCap(pk) === v) return;
  cfgChange(p.name + ' 대기 ' + (was ? was + '번까지' : '제한 없음')
    + ' → ' + (v ? (workLastNo(p) + v) + '번까지' : '제한 없음')
    + ' · 순번 세우기가 여기서 끊습니다', function(){ SMAX[pk] = v; });
}
function setStart(pk, v){ var p = part(pk);
  cfgChange(p.name + ' 시작 ' + p.start + ' → ' + v, function(){ p.start = v; }); }
function setCourseName(k, v){ if (!v) return;
  cfgChange('코스 이름 ' + cname(k) + ' → ' + v, function(){ COURSE[k] = v; }); }

function drawCfg(){
  var tabs = [['jo','조 편성'],['st','경기과 자리'],['dt','당번 종류'],['ct','부 · 코스']];
  $('cfgTabs').innerHTML = tabs.map(function(t){
    return '<button data-ctab="' + t[0] + '" class="' + (cfgTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
  }).join('');
  var h = '', i, i2, i3;

  if (cfgTab === 'jo'){
    var un = joUnset();
    h += '<div class="cfgsec"><h4>조가 몇 개입니까</h4>'
      + '<p>배치표 오른쪽 조편성표에 있는 그대로 적으세요. <b>조 이름이 그대로 화면에 뜹니다.</b><br>'
      + '조 명단은 <b>거의 안 바뀌는 값</b>이라 한 번 넣으면 계속 쓰입니다 — 날마다 다시 넣지 않습니다.</p>';
    for (var i2 = 0; i2 < JOCNT; i2++){
      h += '<div class="crow"><span class="lb">' + (i2 + 1) + '번째</span>'
        + '<input type="text" class="gr" data-joname="' + i2 + '" value="' + esc(JOLABEL[i2]) + '">'
        + '<span class="lb">' + joCount(i2) + '명</span>'
        + '<button class="x" data-jodel="' + i2 + '">지움</button></div>';
    }
    h += '<button class="cadd" data-joadd="1">조 추가</button></div>';

    h += '<div class="cfgsec"><h4>누가 몇 조입니까</h4>'
      + '<p>이름 옆 <b>번호를 누르면</b> 그 조로 갑니다. <b>×</b>는 다시 미배정으로 뺍니다.<br>'
      + '옆에 붙은 <b>근무 · 카트</b>는 오늘 판독본 그대로라 조편성표와 대조하며 넣으실 수 있습니다.</p>';
    if (un) h += '<div class="cnote" style="border-color:#e0c68d;border-left-color:#d8b25e">'
      + '<b>아직 ' + un + '명이 미배정입니다.</b> 조편성표를 보고 넣으세요. 지어낸 값은 넣지 않았습니다.</div>';

    var mk = function(n){
      var t = tagOf(n), c = cartOf(n), g = joOf(n), bt = '', q;
      for (q = 0; q < JOCNT; q++)
        bt += '<button data-joset="' + esc(n) + '|' + q + '" class="' + (q === g ? 'on' : '') + '">' + (q + 1) + '</button>';
      if (g >= 0) bt += '<button data-jodrop="' + esc(n) + '" class="rm">×</button>';
      return '<div class="jr"><span class="n">' + esc(n) + '</span>'
        + '<span class="tg' + (isAbs(t) ? ' ab' : '') + '">' + esc(t || '') + '</span>'
        + '<span class="cr">' + (c ? c : '') + '</span>'
        + '<span class="jopick">' + bt + '</span></div>';
    };

    var uns = JONAMES.filter(function(n){ return joOf(n) < 0; });
    if (uns.length){
      h += '<div class="jolist"><div class="jh">조 미배정<span>' + uns.length + '명</span></div>'
        + uns.map(mk).join('') + '</div>';
    }
    for (var i3 = 0; i3 < JOCNT; i3++){
      var mem = JONAMES.filter(function(n){ return joOf(n) === i3; });
      h += '<div class="jolist"><div class="jh">' + esc(JOLABEL[i3])
        + '<span>' + mem.length + '명</span></div>'
        + (mem.length ? mem.map(mk).join('') : '<div class="jr"><span class="n" style="color:#8b96a2">아직 없습니다</span></div>')
        + '</div>';
    }
    h += '<div class="cnote">조를 다 채우기 전에도 배치표는 그대로 돕니다. '
      + '<b>조는 지금 순번에 아무 영향도 주지 않습니다</b> — 조가 순번을 어떻게 정하는지 알기 전까지는 표시만 합니다.</div>';
    h += '<div class="cnote">여기서 넣은 조 명단은 <b>이 브라우저에 저장</b>돼 새로고침해도 남습니다. '
      + '실제 프로그램에서는 골프장 계정에 저장됩니다.</div>'
      + '<button class="cadd" style="margin-top:8px" data-cfgforget="1">저장된 설정 지우기</button>'
      + '<button class="cadd" style="margin-top:8px" data-joclear="1">조 배정 전부 비우기</button>'
      + '<div class="cnote">급하면 아래로 인원만 맞춰 나눌 수 있지만, <b>실제 조 편성이 아닙니다.</b></div>'
      + '<button class="cadd" style="margin-top:8px" data-joauto="1">임시로 인원 수만 맞춰 나누기</button></div>';
  }

  if (cfgTab === 'st'){
    h += '<div class="cfgsec"><h4>경기과에 어떤 자리가 있습니까</h4>'
      + '<p>자리 이름을 바꾸면 배치표 아래에 <b>그 이름으로</b> 뜹니다. 사람과 출근 시각은 배치표에서 누르면 고쳐집니다.</p>';
    STAFF.forEach(function(x, k){
      h += '<div class="crow">'
        + '<input type="text" class="gr" data-sttitle="' + k + '" value="' + esc(x.k) + '">'
        + '<span class="lb">' + esc(x.n || '비어 있음') + '</span>'
        + '<span class="lb">' + esc(x.t || '') + '</span>'
        + '<button class="x" data-stdel="' + k + '">지움</button></div>';
    });
    h += '<button class="cadd" data-stadd="1">자리 추가</button>'
      + '<div class="cnote"><b>마샬처럼 자리가 둘 이상이면</b> 출근 시각이 이른 쪽이 조출, 늦은 쪽이 마감으로 저절로 붙습니다.</div></div>';
  }

  if (cfgTab === 'dt'){
    h += '<div class="cfgsec"><h4>당번이 어떤 것들이 있습니까</h4>'
      + '<p>골프장마다 다릅니다. <b>여기 적은 그대로</b> 배치표 아래에 칸이 생깁니다.</p>';
    DUTYKEYS.forEach(function(k){
      h += '<div class="crow" data-dtrow="1" data-key="' + esc(k) + '">'
        + '<span class="grip" data-grip="1"></span>'
        + '<input type="text" class="gr" data-dtname="' + esc(k) + '" value="' + esc(k) + '">'
        + '<span class="fl"><em>근무</em><select class="gr dtw" data-dtwork="' + esc(k) + '">'
        + DUTYWORK.map(function(w){
            return '<option value="' + w + '"' + (defOf(k).w === w ? ' selected' : '') + '>'
              + esc(DUTYWTX[w]) + '</option>'; }).join('')
        + '</select></span>'
        + '<span class="fl"' + (defOf(k).w === 'in' ? ' style="opacity:.45"' : '') + '><em>시작</em>'
        + timeInput('class="dtm" data-dtdef="' + esc(k) + '"', defOf(k).t) + '</span>'
        + '<span class="fl"' + (defOf(k).w === 'in' ? ' style="opacity:.45"' : '') + '><em>서는</em><input type="number" class="dhr" data-dtdefh="' + esc(k) + '" value="'
        + (defOf(k).h || '') + '" min="0" max="24" step="0.5"><em>시간</em></span>'
        + '<span class="lb">' + esc(dutyLabel(k) || '지정 없음') + '</span>'
        + '<button class="x" data-dtdel="' + esc(k) + '">지움</button></div>';
    });
    h += '<div class="crow"><input type="text" class="gr" id="dtNew" placeholder="예: 그늘집 당번">'
      + '<button class="x" data-dtadd="1" style="color:var(--go);border-color:#a9c6e6">넣기</button></div>'
      + '<div class="cnote"><b>근무</b>가 그 당번의 성격입니다 — '
      + '<b>순번에 같이</b>는 그날 근무가 확정되는 당번입니다(순번 세우기가 자리를 줍니다). '
      + '<b>상황 따라</b>는 순번에서는 빼고, 적은 시각과 안 겹치는 라운드가 남아 있으면 가용으로 둡니다. '
      + '<b>근무 안 함</b>은 그날 캐디 근무를 안 하는 당번입니다. '
      + '시각·서는 시간은 <b>상황 따라</b>와 <b>근무 안 함</b>에서만 뜻이 있습니다.<br>'
      + '누가 설지는 배치표 아래에서 누르면 고칩니다. 여기서는 <b>당번의 종류</b>와 '
      + '<b>기본 시각·서는 시간</b>을 정합니다 — <b>배치표에서 당번 칸을 눌렀을 때 나오는 그 값</b>이라 '
      + '어느 쪽에서 고쳐도 같이 바뀝니다. 이미 서 있는 사람은 그대로 두고, 당번 창의 '
      + '<b>모두 이 값으로</b>를 눌러야 한꺼번에 바뀝니다.<br>'
      + '<b>왼쪽 손잡이를 끌면</b> 배치표에 뜨는 차례가 바뀝니다.</div></div>';
  }

  if (cfgTab === 'ct'){
    h += '<div class="cfgsec"><h4>부</h4><p>하루에 몇 번 나가는지입니다. '
      + '<b>3부를 안 하는 골프장이면 지우면 됩니다.</b> 최대 ' + MAXPART + '부.</p>';
    DAY.forEach(function(q){
      h += '<div class="crow"><input type="text" class="gr" data-pname="' + esc(q.key) + '" value="'
        + esc(q.name) + '">'
        + '<span class="lb">' + q.tees.length + '팀 · ' + active(q).length + '명</span>'
        + '<button class="x" data-pdel="' + esc(q.key) + '">지움</button></div>';
    });
    h += (DAY.length < MAXPART
        ? '<div class="crow"><span class="lb" style="flex:1">부를 하나 더</span>'
          + '<button class="x" data-padd="1" style="color:var(--go);border-color:#a9c6e6">넣기</button></div>'
        : '<div class="crow"><span class="lb" style="flex:1;color:var(--dim)">'
          + MAXPART + '부까지입니다 — 네 번 도는 골프장은 없습니다</span></div>')
      + '<div class="cnote">지운 부는 <b>되돌리기</b>로 되살아납니다. 새 부는 빈 명단으로 서고, '
      + '사람은 <b>순번 · 명단</b>에서 넣습니다.</div></div>';

    h += '<div class="cfgsec"><h4>코스</h4><p>배치표 열의 이름과 차례입니다. '
      + '<b>동 · 서</b>처럼 바꿔도 되고, 27홀이면 셋, 36홀이면 넷으로 늘리면 됩니다.</p>';
    COURSES.forEach(function(ck, ci){
      h += '<div class="crow" data-ctrow="' + esc(ck) + '" data-key="' + esc(ck) + '">'
        + '<span class="grip" data-grip="1"></span>'
        + '<span class="lb">' + (ci + 1) + '</span>'
        + '<input type="text" class="gr" data-cname="' + esc(ck) + '" value="' + esc(cname(ck)) + '">'
        + '<span class="lb">' + (courseUsed(ck) ? '쓰는 중' : '빈 코스') + '</span>'
        + '<button class="x" data-ctdel="' + esc(ck) + '">지움</button></div>';
    });
    h += (COURSES.length < MAXCOURSE
        ? '<div class="crow"><input type="text" class="gr" id="ctNew" placeholder="예: 남코스">'
          + '<button class="x" data-ctadd="1" style="color:var(--go);border-color:#a9c6e6">넣기</button></div>'
        : '<div class="crow"><span class="lb" style="flex:1;color:var(--dim)">'
          + '코스는 넷까지입니다 — 36홀이 가장 큽니다</span></div>')
      + '<div class="cnote"><b>왼쪽 손잡이를 끌면</b> 배치표 열 차례가 바뀝니다. '
      + '코스가 <b>둘이면 시각이 가운데</b>, <b>셋 이상이면 시각이 왼쪽</b>으로 갑니다.<br>'
      + '팀이 선 코스는 지울 수 없습니다 — 그 팀을 먼저 옮기십시오.</div></div>';
    h += '<div class="cfgsec"><h4>티오프 격자</h4><p>몇 분 간격으로 몇 줄을 깔지 정합니다.</p>'
      + '<div class="crow"><span class="lb">간격</span>'
      + '<input type="number" class="gr" data-gap="1" value="' + GAP + '" min="3" max="20"><span class="lb">분</span></div>'
      + '<div class="crow"><span class="lb">줄 수</span>'
      + '<input type="number" class="gr" data-rows="1" value="' + ROWS + '" min="4" max="40"><span class="lb">줄</span></div>';
    DAY.forEach(function(p){
      var g = gridTimes(p);
      h += '<div class="crow"><span class="lb">' + p.name + '</span>'
        + timeInput('class="gr tf" data-pstart="' + p.key + '"', p.start)
        + '<span class="lb">~ ' + g[g.length - 1] + '</span></div>';
    });
    h += '<div class="cnote">끝 시각은 <b>시작 + 간격 × 줄 수</b>로 저절로 정해집니다. 격자 밖 시각을 끼워 넣는 건 배치표에서 따로 합니다.</div></div>';

  }

  $('cfgBody').innerHTML = h;
}
function openCfg(){ cfgOpen = true; drawCfg(); $('scrim').classList.add('on'); $('cfg').classList.add('on'); }
function closeCfg(){ cfgOpen = false; $('scrim').classList.remove('on'); $('cfg').classList.remove('on'); }

$('btnCfg').addEventListener('click', openCfg);
$('cfgClose').addEventListener('click', closeCfg);
$('cfg').addEventListener('click', function(e){
  var b = e.target.closest('button');
  if (!b) return;
  var a;
  if ((a = b.getAttribute('data-ctab'))) { cfgTab = a; drawCfg(); return; }
  if (b.hasAttribute('data-joadd')) { joAdd(); return; }
  if (b.hasAttribute('data-joauto')) { joAuto(); return; }
  if (b.hasAttribute('data-joclear')) { joClear(); return; }
  if (b.hasAttribute('data-cfgforget')) { cfgForget(); dayForget(); return; }
  if (b.hasAttribute('data-jodrop')) { joDrop(b.getAttribute('data-jodrop')); return; }
  if (b.hasAttribute('data-jodel')) { joDel(Number(b.getAttribute('data-jodel'))); return; }
  if ((a = b.getAttribute('data-joset'))) { var q = a.split('|'); joSet(q[0], Number(q[1])); return; }
  if (b.hasAttribute('data-stadd')) { stAdd(); return; }
  if (b.hasAttribute('data-stdel')) { stDel(Number(b.getAttribute('data-stdel'))); return; }
  if (b.hasAttribute('data-dtadd')) { dtAdd($('dtNew') ? $('dtNew').value : ''); return; }
  if (b.hasAttribute('data-dtdel')) { dtDel(b.getAttribute('data-dtdel')); return; }
  if (b.hasAttribute('data-padd')) { addPart(); drawCfg(); return; }
  if (b.hasAttribute('data-pdel')) { confirmDelPart(b.getAttribute('data-pdel')); return; }
  if (b.hasAttribute('data-ctadd')) { ctAdd($('ctNew') ? $('ctNew').value : ''); return; }
  if (b.hasAttribute('data-ctdel')) { confirmDelCourse(b.getAttribute('data-ctdel')); return; }
});
$('sheet').addEventListener('change', function(e){
  var el = e.target;
  var k = sheetFor && sheetFor.key;
  if (!k) return;
  if (el.hasAttribute('data-dutyname')) { setDutyName(k, Number(el.getAttribute('data-dutyname')), el.value.trim()); return; }
  else if (el.hasAttribute('data-dutytime')) setDutyTime(k, Number(el.getAttribute('data-dutytime')), readTime(el));
  else if (el.hasAttribute('data-dutyhour')) setDutyHour(k, Number(el.getAttribute('data-dutyhour')), el.value);
  else if (el.id === 'dutyT') { setDutyDef(k, readTime(el)); redrawTil(); return; }
  else if (el.id === 'dutyH') { setDutyDefHour(k, el.value); redrawTil(); return; }
  else return;
  redrawTil();
});
// '끝 12:00'만 다시 쓴다 — 창을 통째로 다시 그리면 치던 자리를 잃는다
function redrawTil(){
  var k = sheetFor && sheetFor.key;
  if (!k) return;
  var rows = $('sheet').querySelectorAll('.drow');
  for (var i = 0; i < rows.length; i++){
    var x = dutyList(k)[Number(rows[i].getAttribute('data-key'))];
    var til = rows[i].querySelector('.til');
    if (x && til) til.textContent = (x.t && x.h) ? '끝 ' + endT(x.t, x.h) : '';
  }
  var nt = newT(), nh = newH(), ntil = $('sheet').querySelector('.dsp.mt .til');
  if (ntil) ntil.textContent = (nt && nh) ? '끝 ' + endT(nt, nh) : '';
}
$('cfg').addEventListener('change', function(e){
  var el = e.target;
  if (el.hasAttribute('data-joname')) { var ji = Number(el.getAttribute('data-joname'));
    joName(ji, el.value.trim() || (ji + 1) + '조'); return; }
  if (el.hasAttribute('data-sttitle')) { stTitle(Number(el.getAttribute('data-sttitle')), el.value.trim() || '자리'); return; }
  if (el.hasAttribute('data-dtname')) { dtName(el.getAttribute('data-dtname'), el.value.trim()); return; }
  if (el.hasAttribute('data-dtwork')) { setDutyWork(el.getAttribute('data-dtwork'), el.value); return; }
  if (el.hasAttribute('data-dtdef')) { setDutyDef(el.getAttribute('data-dtdef'), readTime(el)); return; }
  if (el.hasAttribute('data-dtdefh')) { setDutyDefHour(el.getAttribute('data-dtdefh'), el.value); return; }
  if (el.hasAttribute('data-pname')) { setPartName(el.getAttribute('data-pname'), el.value); return; }
  if (el.hasAttribute('data-cname')) { setCourseName(el.getAttribute('data-cname'), el.value.trim()); return; }
  if (el.hasAttribute('data-gap')) { setGap(el.value); return; }
  if (el.hasAttribute('data-rows')) { setRows(el.value); return; }
  if (el.hasAttribute('data-pstart')) {
    var pv = readTime(el);
    if (pv) setStart(el.getAttribute('data-pstart'), pv);
    return;
  }
});

// ── 창에 맞춘다 ─────────────────────────────────
// 이 배치표의 값어치는 '하루가 한 화면에 다 보인다'는 것 하나다. 그래서 창이 작아지면
// 짜임새를 바꾸는 게 아니라 종이 배치표를 통째로 줄인다. 넓으면 그만큼 키운다.
// ★글씨 크기는 창에 맞춘다 — 사람이 고르던 고르개는 걷어냈다(2026-09-11).
//   예전의 '보통'이 그대로 남은 자리다 — 배수가 1.00 이었으니 한 치도 안 다르다.
//   울타리는 그대로 둔다: fit 이 터무니없이 줄이거나 키우면 안 된다
var K_MIN = 0.92, K_MAX = 1.35;
var K_FLOOR = 0.55, K_CEIL = 2.20;
function setK(k){ document.documentElement.style.setProperty('--k', k.toFixed(3)); }
// 부 칸이 세로로 얼마나 넘치나 — 한 줄이라도 잘리면 안 된다
function colOver(){
  var ps = document.querySelectorAll('.pscroll'), m = 0;
  for (var i = 0; i < ps.length; i++) m = Math.max(m, ps[i].scrollHeight - ps[i].clientHeight);
  return m > 2 ? m : 0;      // 소수점 반올림 2px는 넘친 것으로 치지 않는다
}
// ★근무표가 세로로 얼마나 넘치나 — 레일·명단·경기과 띠가 한 화면에 들어와야 한다.
// 조 칸(.jobd) 안쪽은 원래 굴려 보는 곳이라 넘침으로 세지 않는다.
// 다만 근무표의 값어치는 '명단이 보인다'는 것이다. 안 넘쳐도 조 칸이 두어 줄뿐이면
// 그건 아직 큰 것이다 — 글씨를 줄여서 줄을 사는 편이 낫다.
var WANT_ROWS = 9;
function workOver(){
  var v = $('viewWork'), m = v.scrollHeight - v.clientHeight;
  if (m > 2) return m;
  var b = document.querySelector('.jobd'), r = b && b.querySelector('.wrow');
  if (b && r){
    var need = r.getBoundingClientRect().height * WANT_ROWS - b.clientHeight;
    if (need > 2) return need;
  }
  return 0;
}
// 지금 켜져 있는 화면이 얼마나 넘치나 — 숨은 칸은 잴 수 없다
function viewOver(){
  if ($('viewBoard').classList.contains('on')) return colOver();
  if ($('viewWork').classList.contains('on')) return workOver();
  return -1;
}
function fit(){
  var el = document.documentElement;
  if (!window.matchMedia('(min-width:901px)').matches){ el.style.removeProperty('--k'); return; }
  var board = $('viewBoard').classList.contains('on');
  if (!board && !$('viewWork').classList.contains('on')) return;   // 숨은 칸은 잴 수 없다
  // 가로가 허락하는 최대치에서 시작해, 세로로 들어오는 가장 큰 값을 찾는다.
  // 조금씩 줄여 가면 필요보다 작아져 자리가 남는다 — 그래서 이분법으로 정확히 찾는다.
  // 근무표는 조가 넷이라 배치표(부 셋 + 티오프)보다 좁아도 제 몫을 한다.
  var wide = board ? 1500 : 1240;
  var hi = Math.min(K_MAX, Math.max(K_MIN, window.innerWidth / wide)), lo = K_MIN, auto;
  setK(hi);
  if (viewOver() <= 0) auto = hi;              // 최대에서 이미 들어온다
  else {
    setK(lo);
    // 제일 작게 해도 안 들어오는 날(3부 스페어가 많은 날)은 여기 그대로 둔다.
    // 이 배치표는 '많이 보이는 것'이 값어치라 가장 작은 값이 낫다 — 나머지는 굴려서 본다.
    if (viewOver() > 0) auto = lo;
    else {
      for (var i = 0; i < 7; i++){             // 일곱 번이면 0.005까지 좁혀진다
        var mid = (lo + hi) / 2;
        setK(mid);
        if (viewOver() <= 0) lo = mid; else hi = mid;
      }
      auto = lo;
    }
  }
  // ★사람이 고른 크기를 여기서 얹는다. 보통이면 자동값 그대로다.
  // 크게를 골라 안 들어오게 되면, 줄이지 않고 굴려서 본다 — 그게 고른 뜻이다.
  setK(Math.max(K_FLOOR, Math.min(K_CEIL, auto)));
}
var fitT = 0;
window.addEventListener('resize', function(){
  clearTimeout(fitT);
  fitT = setTimeout(fit, 60);            // 창을 끄는 동안 열여섯 번씩 재지 않는다
});

// 폰으로 이 화면을 열었으면 돌아가는 길을 켠다(문지기 옆에 있을 때만)
if (/\/pc\.html$/.test(location.pathname)) $('toPhone').classList.add('can');

// ★서버가 있으면 서버 것을 먼저 가져온 뒤에 켜다.
//   파일 하나로 열었을 때는 그 자리에서 곳바로 켜진다 — 시간차도 안 생긴다
srvBoot(function(){
  bootLoad();
  paint();
  try { var v0 = localStorage.getItem('board.view'); if (v0 === 'work' || v0 === 'board') VIEW = v0; }
  catch (e) { /* 기본은 배치표 */ }
  setView(VIEW);
  if (PENDING) openPending();          // ★안 누르고 닫은 고침이 있으면 켜자마자 묻는다
});
