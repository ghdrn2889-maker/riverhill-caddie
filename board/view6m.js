// ══════════════════════════════════════════════════════════════
//  view — 폰 화면
//  기계(core)에 paint·toast·resyncSheet·drawCfg·saveFlash 를 준다.
//  데스크톱과 같은 사실을 보되, 놓는 자리가 다르다.
// ══════════════════════════════════════════════════════════════

// 폰에는 설정 서랍이 없다 — 기계가 물으면 '안 열려 있다'고 답한다
var cfgOpen = false;
function drawCfg(){}

var sheetFor = null;      // 지금 열린 창이 무엇에 대한 것인가
var sheetKind = '';
// 몸통에 뜨는 것 — 부마다 배치표, 근무표, 당번
var VIEW = 'board';
// ★집은 자리는 하나가 아니라 여럿이다. 대바는 둘이서만 하지 않는다 —
// 한 사람 자리를 비워 주려고 셋 넷이 한 바퀴 돈다
var pickList = [];
function pickAt(pk, ri){
  for (var i = 0; i < pickList.length; i++)
    if (pickList[i].pk === pk && pickList[i].ri === ri) return i;
  return -1;
}
function pickSync(){ pick = pickList.length ? pickList[0] : null; }

// ── 말하기 ──────────────────────────────────
var toastT = 0;
function toast(m){
  var t = $('toast');
  t.textContent = m;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(function(){ t.classList.remove('on'); }, 2400);
}
// 저장했다고 화면이 잠깐 말한다
function saveFlash(){
  var s = $('hSave');
  s.textContent = '저장했습니다';
  s.className = 'sv ok';
  setTimeout(paintHead, 1800);
}
// 열려 있는 창을 지금 값으로 다시 그린다
function resyncSheet(){
  if (!sheetFor || !$('sheet').classList.contains('on')) return;
  if (sheetKind === 'cell'){
    var p = part(sheetFor.pk);
    if (sheetFor.i >= active(p).length) { closeSheet(); return; }
    openCell(sheetFor.pk, sheetFor.i);
  }
  else if (sheetKind === 'roster') openRoster();
  else if (sheetKind === 'person') openPerson(sheetFor.person);
  else if (sheetKind === 'dutypick') openDutyPick(sheetFor.dkey);
  else if (sheetKind === 'seonbal') openSeonbalPick(sbKind);
  else if (sheetKind === 'cartpick') openCartPick(sheetFor.person);
  else if (sheetKind === 'tee') openTeeTime(sheetFor.pk, sheetFor.i);
  else if (sheetKind === 'ins') drawInsList();   // 통째로 열면 치던 칸이 죽는다
  else if (sheetKind === 'bulkact') openBulkAct();
}

// ── 그리기 · 배치표 ──────────────────────────
// 종이 배치표처럼 꼬리표마다 칸 색이 다르다
function tagClass(r){
  if (!r || !cellTag(r.tag)) return '';
  var c = tagCls(cellTag(r.tag));
  return (c && c !== 'cet') ? ' ' + c : '';   // 칸 바탕은 뚜렷한 것만 물들인다
}
// 근무 칸에 적을 글씨. 꼬리표가 이미 근무를 말하면 부 번호를 겹쳐 적지 않는다
function wkText(st, tag){
  if (!tag) return st;
  if (tag === '54') return '54';
  if (tag === st) return tag;
  return st + ' ' + tag;
}
// 코스 칩 색 — 왼쪽 코스부터 차례로. 넷까지 다르게 나온다(36홀)
function coCls(ck){
  var i = cpos(ck);
  return i === 0 ? ' co-a' : i === 1 ? ' co-b' : i === 2 ? ' co-c' : i === 3 ? ' co-d' : '';
}
function tagsHTML(r, t, pk){
  var g = r ? cellTag(r.tag) : '';
  return (g ? '<span class="tag t' + tagCls(g) + '">' + esc(g) + '</span>' : '')
    + (r && r.role ? '<span class="tag rl">' + esc(r.role) + '</span>' : '')
    + (t && t.cx ? '<span class="tag x">취소</span>' : '')
    + (t && t.pax !== 4 ? '<span class="tag px">' + t.pax + '인</span>' : '');
}
// 근무 칸 하나. side 는 코스가 둘일 때만 쓴다(L·R) — 그때는 코스 칩을 안 단다.
// 자리가 곧 코스이기 때문이다: 왼쪽이 첫 코스, 오른쪽이 둘째 코스
function cellHTML(p, i, ck, tm, side){
  var sc = side ? ' ' + side : '';
  if (i == null){
    if (!tm) return '<span class="cell blank' + sc + '"></span>';
    return '<button class="cell slot' + sc + (side ? '' : coCls(ck))
      + '" data-slot="' + esc(tm) + '|' + esc(ck) + '">'
      + (side ? '' : '<span class="co">' + esc(cname(ck)) + '</span>')
      + '<span class="plus">+ 팀 넣기</span></button>';
  }
  var a = active(p), r = a[i], t = p.tees[i], ri = r ? p.roster.indexOf(r) : -1;
  var pi = pickAt(p.key, ri);
  var cls = 'cell' + sc + (side ? '' : coCls(ck)) + (isItn(r) ? ' itnc' : '')
    + tagClass(r) + (t && t.cx ? ' cx' : '')
    + (dirty[p.key + ':' + i] ? ' dirty' : '') + (pi >= 0 ? ' pick' : '');
  return '<button class="' + cls + '" data-pk="' + p.key + '" data-i="' + i + '">'
    + (side ? '' : '<span class="co">' + esc(cname(ck)) + '</span>')
    + '<span class="p' + (isItn(r) ? ' itn' : ' num') + '">' + seatNoTx(p, i) + '</span>'
    + '<span class="nm' + ((r && r.n) ? '' : ' e') + '">' + ((r && r.n) ? esc(r.n) : '비어 있음') + '</span>'
    + tagsHTML(r, t, p.key)
    + (pi >= 0 ? '<span class="tag pk num">' + (pi + 1) + '</span>' : '') + '</button>';
}
// 대기 칸 — 시각도 코스도 없다. 폭을 다 쓴다
function spareHTML(p, i){
  var a = active(p), r = a[i], ri = r ? p.roster.indexOf(r) : -1;
  var pi = pickAt(p.key, ri);
  var cls = 'cell' + (isItn(r) ? ' itnc' : '') + tagClass(r)
    + (dirty[p.key + ':' + i] ? ' dirty' : '') + (pi >= 0 ? ' pick' : '');
  return '<button class="' + cls + '" data-pk="' + p.key + '" data-i="' + i + '">'
    + '<span class="p' + (isItn(r) ? ' itn' : ' num') + '">' + seatNoTx(p, i) + '</span>'
    + '<span class="nm' + (r && r.n ? '' : ' e') + '">' + ((r && r.n) ? esc(r.n) : '비어 있음') + '</span>'
    + tagsHTML(r, null, p.key)
    + (pi >= 0 ? '<span class="tag pk num">' + (pi + 1) + '</span>' : '') + '</button>';
}
function boardHTML(p){
  var a = active(p), n = p.tees.length, N = COURSES.length, two = (N === 2);
  var at = {};
  p.tees.forEach(function(t, i){ at[t.time + '|' + t.course] = i; });

  var h = two
    ? '<div class="chead two"><div class="l">' + esc(cname(COURSES[0])) + '</div>'
      + '<div class="m">시각</div><div class="r">' + esc(cname(COURSES[1])) + '</div></div>'
    : '<div class="chead"><div class="a">시각</div><div class="b">'
      + COURSES.map(function(k){ return esc(cname(k)); }).join(' · ') + ' · 순번 · 캐디</div></div>';

  // ① 티오프 격자 — 기본 시간표를 통째로 깔고, 팀이 있는 칸만 채운다
  h += gridTimes(p).map(function(tm){
    // ★시각을 누르면 그 시각을 고칠 수 있다 — 뒤가 통째로 밀리는 날이 있다
    var ti0 = at[tm + '|' + COURSES[0]];
    if (ti0 == null) for (var ci = 1; ci < COURSES.length; ci++){
      if (at[tm + '|' + COURSES[ci]] != null) { ti0 = at[tm + '|' + COURSES[ci]]; break; }
    }
    var tmh = '<span class="tm num' + (ti0 == null ? '' : ' hit')
      + '"' + (ti0 == null ? '' : ' data-tee="' + p.key + '|' + ti0 + '"') + '>'
      + tm + (offGrid(p, tm) ? '<em>격자 밖</em>' : '') + '</span>';
    var at2 = function(ck){ var ti = at[tm + '|' + ck]; return ti == null ? null : ti; };
    if (two){
      return '<div class="trow">'
        + cellHTML(p, at2(COURSES[0]), COURSES[0], tm, 'L') + tmh
        + cellHTML(p, at2(COURSES[1]), COURSES[1], tm, 'R') + '</div>';
    }
    return '<div class="tgrp" style="--n:' + N + '">' + tmh
      + COURSES.map(function(ck){ return cellHTML(p, at2(ck), ck, tm); }).join('') + '</div>';
  }).join('');

  // ② 대기 — 폰은 좁아서 한 줄에 한 명. 순번이 위에서 아래로 곧게 이어진다
  var rest = a.length - n;
  if (rest > 0){
    h += '<div class="cut"><span class="ln"></span>'
      + '<span class="tx">확정선 · 여기까지 근무</span><span class="ln"></span></div>'
      + '<div class="chead"><div class="a">대기</div><div class="b">'
      + rest + '명 · 순번 ' + (seatNo(p, n - 1) + 1) + '번부터</div></div>'
      + '<div class="spares">';
    for (var i = n; i < a.length; i++) h += spareHTML(p, i);
    h += '</div>';
  } else {
    h += '<div class="empty">대기 없음 — 출근 ' + a.length + '명 전원 근무입니다</div>';
  }

  h += '<button class="addrow" data-addteam="' + p.key + '">+ 팀 추가</button>'
    + '<button class="addrow" data-act="padd" data-pk="' + p.key + '">+ 대기에 넣기</button>'
    + '<div class="note">칸을 <b>꾹 눌러 끌면</b> 두 사람을 바로 바꿉니다. '
    + '</div>';
  return h;
}

// ── 그리기 · 근무표 ─────────────────────────
// 배치표가 '자리'라면 근무표는 '사람'이다. 조 편성 그대로 세로로 쌓는다
var wkFil = '', wkQ = '';
// 세운 뒤에 근태가 바뀌면 조용히 알려 준다. 저절로 다시 세우지는 않는다 —
// 세운 뒤에 사람이 손으로 옮겨 놓은 자리를 기계가 되돌리면 그게 더 큰 사고다
// 달력을 따라가며 스스로 만든 날 — 무엇이 넘어왔고 무엇이 안 넘어왔는지 적는다
function caughtHTML(){
  var c = caughtRead();
  if (!c || c.to !== DATE) return '';
  return '<div class="drift newd"><div class="dt"><b>' + esc(c.to) + '</b> 배치표를 새로 만들었습니다 '
    + '— ' + esc(c.from) + ' 것을 이어받았습니다. <b>순번은 아직 안 세웠습니다.</b>'
    + (c.abs ? '' : ' 근태는 <b>안 가져왔습니다</b> — 오늘 쉴 사람을 새로 넣으십시오.') + '</div>'
    + '<div class="dbtn"><button data-act="cgtseen">알겠습니다</button>'
    + '<button data-act="daypick">지난 날 보기</button></div></div>';
}
// ★한 카트를 같은 부에서 둘이 타는 것 — 사람은 못 세지만 기계는 센다
// ★두 부 시각이 겹치는 사람 — 앞 라운드가 안 끝났는데 뒤 티오프가 온다
function roundClashHTML(){
  var cl = roundClashes();
  if (!cl.length) return '';
  return '<div class="drift"><div class="dt"><b>두 부 시각이 겹칩니다</b> — '
    + cl.map(function(x){
        return esc(x.n) + ' ' + part(x.a.pk).name + ' ' + x.a.time
          + ' → ' + part(x.b.pk).name + ' ' + x.b.time
          + ' <b>' + gapText(x.gap) + '</b>'; }).join(' / ')
    + '</div><div class="dbtn"><span class="dnote" style="padding:0">한 라운드를 '
    + gapText(ROUNDMIN) + '으로 봅니다</span></div></div>';
}
function cartClashHTML(){
  var cl = cartClashes();
  if (!cl.length) return '';
  return '<div class="drift"><div class="dt">같은 부에서 <b>한 카트를 둘이</b> 탑니다 — '
    + cl.map(function(x){
        return part(x.pk).name + ' ' + x.cart + '번 <b>' + esc(x.who.join('·')) + '</b>'; }).join(' / ')
    + '</div></div>';
}
function driftHTML(){
  var n = driftN();
  if (!n) return '';
  return '<div class="drift"><div class="dt">순번을 세운 뒤 근태가 <b>' + n
    + '건</b> 바뀌었습니다 — 지금 자리가 순번과 다릅니다</div>'
    + '<div class="dbtn"><button class="on" data-act="dfgo">'
    + esc(driftName()) + ' 다시 세우기</button>'
    + '<button data-act="dfkeep">그대로 둡니다</button></div></div>';
}
// ── 한꺼번에 지정 ───────────────────────────
// 무엇을 붙일지 먼저 고르고, 아래 이름을 차례로 누른다.
// ★칸은 늘 여기 있다 — 켜고 끄기만 한다(사라지면 어디 갔나 찾게 된다)
function bulkChips(){
  var on = bulkOn(), t = bulkTag();
  // ★'캐디 선택'은 배지가 아니다 — 칩 줄에 끼우면 배지처럼 보인다. 제 줄로 뺐다
  return BULKTAGS.filter(function(x){ return x !== PICKTAG; }).map(function(x){
    var sel = on && t === x;
    var cc = !x ? 'cet' : (x === '휴무' ? 'cru' : isAbs(x) ? 'crs' : tagCls(x));
    return '<button class="bch' + (sel ? ' on ' + cc : '')
      + '" data-bulk="' + esc(x) + '">' + esc(bulkLabel(x)) + '</button>'; }).join('');
}
function bulkHTML(){
  var on = bulkOn();
  return '<div class="bulk' + (on ? ' on' : '') + '">'
    + '<div class="bh"><b>한꺼번에 지정</b><span>'
    + (on ? esc(bulkLabel(bulkTag())) + (bulkPicking() ? ' 중' : ' 지정 중') : '여러 명을 한 번에')
    + '</span></div>'
    + '<button class="bpickbtn' + (bulkPicking() ? ' on' : '')
    + '" data-bulk="' + esc(PICKTAG) + '">'
    + '<span class="ck"></span><span class="tx"><b>캐디 선택</b>여러 명을 먼저 선택하고, 무엇을 할지는 나중에 정합니다 \u2014 배지와 근태를 한 번에 바꿉니다</span></button>'
    + '<div class="bchs">' + bulkChips() + '</div>'
    + (on ? '<div class="bsr">이름은 <b>근무표 맨 위 찾기 칸</b>에 치십시오 \u2014 '
            + '좁혀진 목록에서 그대로 누르면 지정됩니다.</div>' : '')
    + '<div class="dnote">' + (bulkPicking()
        ? '아래 <b>이름을 차례로 누르면 선택</b>됩니다 (파랗게). 아직 아무것도 안 바뀝니다 \u2014 '
          + '다 고르면 아래 띠의 <b>한꺼번에 바꾸기</b>를 누르십시오.'
        : on
        ? '아래 <b>이름을 차례로 누르십시오.</b> 잘못 누른 사람은 한 번 더 누르면 빠집니다. '
          + '다 되면 아래 띠의 <b>저장하기</b>를 누르십시오.'
        : '<b>캐디 선택</b>은 이름부터 고르고 나중에 정합니다. '
          + '아래 배지를 고르면 이름을 누를 때마다 <b>바로</b> 붙습니다.')
    + '</div></div>';
}
// ★목록만 따로 그린다 — 찾기 칸을 통째로 다시 만들면 한글 조합이 깨진다
function wkListHTML(){
  var T = workTally(), rows = T.rows;
  var qv = String(wkQ || '').trim();
  var bsel = {};
  bulkDone().forEach(function(n){ bsel[n] = 'bund'; });
  bulkSet().forEach(function(n){ bsel[n] = 'bsel'; });
  bulkPicked().forEach(function(n){ bsel[n] = 'bpick'; });   // 고른 사람 — 아직 안 바꿨다
  var byName = {}, byJo = [], unset = [], j;
  rows.forEach(function(r){ byName[r.n] = r; });
  var keep = function(r){
    return wkKeep(r, wkFil, qv);
  };
  for (j = 0; j < JOCNT; j++)
    byJo.push(joMembers(j).map(function(n){ return byName[n]; }).filter(keep));
  rows.forEach(function(r){ if (joOf(r.n) < 0 && keep(r)) unset.push(r); });
  var secs = byJo.map(function(list, ji){ return { t: JOLABEL[ji] || (ji + 1) + '조', list: list }; });
  if (unset.length) secs.push({ t: '조 미배정', list: unset });
  var shown = 0;
  var h = secs.map(function(c){
    if (!c.list.length) return '';
    shown += c.list.length;
    var w = c.list.filter(function(r){ return r.cls === 'w'; }).length;
    return '<div class="josec"><div class="johd"><b>' + esc(c.t) + '</b>'
      + '<span>' + c.list.length + '명 · 근무 ' + w + '</span></div>'
      + c.list.map(function(r){
          var rest = (r.cls === 'r' || r.cls === 'v' || r.cls === 's');
          return '<button class="wrow' + (rest ? ' rest' : '') + (isBu3(r.n) ? ' b3' : '')
            + (bsel[r.n] ? ' ' + bsel[r.n] : '') + '" data-who="' + esc(r.n) + '">'
            + '<span class="nw"><span class="n">' + esc(r.n) + '</span>'
            + bu3BadgeHTML(r.n) + '</span>'                 // ★소속은 이름 바로 오른쪽
            + dayBadges(r.bts).map(function(x){
                return '<span class="bt ' + tagCls(x) + '">' + esc(x) + '</span>'; }).join('')
            // 배지가 이미 같은 말을 하면 상태 칩은 접는다 ('2,3 · 2,3' 이 안 되게)
            + (!r.chip || r.bts.indexOf(r.chip) >= 0 ? ''
               : '<span class="bg ' + r.cls + '">' + esc(r.chip) + '</span>')
            + '<span class="ct' + (r.cart ? '' : ' no') + (cartBad(r.cart) ? ' bad' : '')
            + (isLent(r.n) ? ' lent' : '') + '" title="'
            + (isLent(r.n) ? '빌린 카트' : '') + '">'
            + (r.cart || '') + '</span></button>'; }).join('')
      + '</div>';
  }).join('');
  if (!shown) h += '<div class="empty">' + (qv ? esc(qv) + ' — ' : '')
    + '고른 조건에 맞는 사람이 없습니다</div>';
  else if (qv) h += '<div class="note" style="padding-top:10px">' + esc(qv)
    + ' — ' + shown + '명' + (wkFil ? ' (거르개도 걸려 있습니다)' : '') + '</div>';
  return h;
}
function drawWkList(){
  var el = $('wkList');
  if (el) el.innerHTML = wkListHTML();
}
function workHTML(){
  var T = workTally();
  var rows = T.rows, cnt = T.cnt, cw = T.cw, cd = T.cd, ca = T.ca;
  var total = T.total, avail = T.avail, exc = T.exc;

  var qv = String(wkQ || '').trim();
  var h = '<div class="wsr"><input id="wkQ" autocomplete="off" value="' + esc(wkQ)
    + '" placeholder="이름으로 찾기 — 두 글자만 쳐도 됩니다">'
    + (qv ? '<button class="x" data-act="wkqx">지움</button>' : '') + '</div>'
    + '<div class="lineup">'
    + '<div class="lh"><b>순번 세우기</b><span>시작한 사람부터 조를 돌며 세웁니다</span></div>'
    + lineupRow('1·2부', seonbal(), 'lnpick', 'lnrun', '1부 · 2부 순번 세우기')
    + lineupRow('3부', bu3Start(), 'ln3pick', 'ln3run', '3부 순번 세우기')
    + caughtHTML()
    + roundClashHTML()
    + cartClashHTML()
    + driftHTML()
    + '</div>'
    + '<div class="sum">'
    + '<div><div class="v num">' + total + '</div><div class="k">총원</div></div>'
    + '<div class="sgo"><div class="v num">' + avail + '</div><div class="k">가용</div></div>'
    + '<div class="sno"><div class="v num">' + exc + '</div><div class="k">제외인원</div></div>'
    + '<div class="sgo"><div class="v num">' + cw + '</div><div class="k">근무</div></div>'
    + '<div class="scut"><div class="v num">' + cd + '</div><div class="k">대기</div></div>'
    + '<div class="sgo"><div class="v num">' + T.cu + '</div><div class="k">미배치</div></div>'
    + '</div>'
    + bulkHTML();

  // 조별로 나눈다 — 조 편성표가 그날 상태의 원본이다
  // ★근무표는 조 편성표 차례 그대로 세운다. 종이 근무표가 그렇게 생겼고,
  // 배치표 순번대로 세우면 같은 사람이 날마다 다른 줄로 옮겨 다녀 눈이 못 따라간다
  var byName = {}, byJo = [], unset = [], j;
  rows.forEach(function(r){ byName[r.n] = r; });
  // ★찾기와 거르개는 같이 걸린다 — '휴무 중에 김씨'가 된다
  var keep = function(r){
    return wkKeep(r, wkFil, qv);
  };
  for (j = 0; j < JOCNT; j++)
    byJo.push(joMembers(j).map(function(n){ return byName[n]; }).filter(keep));
  rows.forEach(function(r){ if (joOf(r.n) < 0 && keep(r)) unset.push(r); });
  var secs = byJo.map(function(list, ji){ return { t: JOLABEL[ji] || (ji + 1) + '조', list: list }; });
  if (unset.length) secs.push({ t: '조 미배정', list: unset });

  var bsel = {};
  bulkDone().forEach(function(n){ bsel[n] = 'bund'; });   // 손댔지만 지금은 안 달고 있다
  bulkSet().forEach(function(n){ bsel[n] = 'bsel'; });
  bulkPicked().forEach(function(n){ bsel[n] = 'bpick'; });   // 고른 사람 — 아직 안 바꿨다
  h += '<div id="wkList">' + wkListHTML() + '</div>';
  h += '<div class="note">이름을 누르면 오늘 어디 있는지 보고 그 자리로 갈 수 있습니다.</div>'
    + '<div class="nday"><div class="nh"><b>내일 준비</b>'
    + '<span>' + esc(nextDateLabel(DATE)) + '로 넘깁니다</span></div>'
    + '<button class="ngo" data-act="nday">내일로 넘기기</button></div>';
  return h;
}

// ── 그리기 · 당번 ───────────────────────────
// 그날의 역할. 종류를 만들고 지우는 건 설정이라 PC 몫이고,
// 오늘 누가 서느냐는 매일 하는 일이라 폰에 둔다
// 한 당번에 선 사람들의 시각 — 다 같으면 그 시각, 다르면 '여럿'.
// 첫 사람 것만 보여 주면 나머지가 그 시각인 줄 알게 된다
function dutyTimeText(k){
  var who = dutyList(k);
  if (!who.length) { var d = defOf(k); return dutySpan({ t: d.t, h: d.h }); }
  var first = dutySpan(who[0]), same = true;
  who.forEach(function(x){ if (dutySpan(x) !== first) same = false; });
  return same ? first : '여럿';
}
function dutyHTML(){
  var nPeople = 0;
  DUTYKEYS.forEach(function(k){ nPeople += dutyList(k).length; });
  var h = '<div class="dsec"><div class="dh2"><b>오늘 당번</b>'
    + '<span>' + DUTYKEYS.length + '종류 · ' + nPeople + '명 · 누르면 넣고 뺍니다</span></div>'
    + DUTYKEYS.map(function(k){
        var who = dutyList(k);
        return '<button class="drow2" data-duty="' + esc(k) + '">'
          + '<span class="dk2">' + esc(k) + '</span>'
          + '<span class="dv2' + (who.length ? '' : ' none') + '">'
          + (who.length ? who.map(function(x){ return esc(x.n || '—'); }).join(' · ') : '없음') + '</span>'
          + (who.length > 1 ? '<span class="dn2 num">' + who.length + '명</span>' : '')
          + '<span class="dt2 num">' + esc(dutyTimeText(k)) + '</span>'
          + '<span class="go2"></span></button>'; }).join('')
    + '<button class="addrow" data-act="dtnew">+ 당번 종류 추가</button>'
    + '</div>';

  h += '<div class="dsec"><div class="dh2"><b>경기과</b></div>'
    + STAFF.map(function(x, i){
        var rl = staffRole(i);
        return '<div class="drow2 ro"><span class="dk2">' + esc(x.k) + '</span>'
          + '<span class="dv2' + (x.n ? '' : ' none') + '">' + esc(x.n || '비어 있음') + '</span>'
          + '<span class="dt2 num">' + esc(x.t || '—') + (rl ? ' · ' + rl.t : '') + '</span></div>'; }).join('')
    + '</div>';
  return h;
}
// 당번 하나에 사람을 넣고 뺀다 — 오늘 나온 사람 중에서만 고른다
var dpQ = '';
function openDutyPick(k){
  var d = defOf(k), who = dutyList(k);
  var h = '<div class="grab"></div><div class="k">그날의 역할</div>'
    + '<div class="st">' + esc(k) + '</div>'
    + '<div class="sub">넣으면 기본 '
    + (dutySpan({ t: d.t, h: d.h }) || '시각 없음') + '으로 섭니다 · 이름을 다시 누르면 뺍니다</div>'
    + '<div class="grp dpick"><h4>지금 서는 사람 ' + who.length + '명</h4>'
    + (who.length
        ? '<div class="who">' + who.map(function(x){
            return '<button data-dtoggle="' + esc(k) + '|' + esc(x.n) + '">'
              + esc(x.n || '—') + '<i>빼기</i></button>'; }).join('') + '</div>'
        : '<div class="dnote">아직 아무도 없습니다</div>')
    + '</div>'
    + '<div class="grp"><h4>이 당번 종류</h4>'
    + '<div class="acts"><button data-act="dtedit">이름 · 기본 시간표 고치기</button></div></div>'
    + '<div class="srch"><input id="dpQ" autocomplete="off" value="' + esc(dpQ)
    + '" placeholder="이름으로 찾기"></div>'
    + '<div class="lst" id="dpOut"></div>'
    + '<button class="close" data-act="close">닫기</button>';
  openSheet(h, 'dutypick', { dkey: k });
  drawDutyPick();
  var q = $('dpQ');
  q.addEventListener('input', function(){ dpQ = q.value; drawDutyPick(); });
}
function drawDutyPick(){
  if (!sheetFor || !sheetFor.dkey) return;
  var k = sheetFor.dkey, q = (dpQ || '').trim(), out = '', n = 0;
  peopleIndex().order.forEach(function(nm){
    if (q && nm.indexOf(q) < 0) return;
    if (n >= 60) return;
    n++;
    var on = dutyAt(k, nm) >= 0, seats = peopleIndex().map[nm] || [];
    out += '<button class="row" data-dtoggle="' + esc(k) + '|' + esc(nm) + '">'
      + '<span class="p">' + (on ? '✓' : '') + '</span>'
      + '<span class="nm">' + esc(nm) + '</span>'
      + '<span class="wh">' + (seats.length ? esc(seats[0].label) : esc(absOf(nm))) + '</span></button>';
  });
  $('dpOut').innerHTML = out || '<div class="empty">' + esc(q) + ' — 오늘 명단에 없습니다</div>';
}

// ── 머리 · 띠 ───────────────────────────────
function paintHead(){
  $('hDate').textContent = DATE;
  $('hDate').setAttribute('data-act', 'daypick');
  $('hDate').style.textDecoration = 'underline dotted';
  $('hDate').style.textUnderlineOffset = '3px';
  $('hMeta').textContent = '리버힐 · 본배치표 #' + BOARD.id;
  var s = $('hSave'), un = unsaved(), n = LOG.length;
  if (un) { s.textContent = '저장 안 함 · ' + n + '건'; s.className = 'sv un'; }
  else if (savedAt) { s.textContent = savedAt + ' 저장됨'; s.className = 'sv ok'; }
  else { s.textContent = '고친 것 없음'; s.className = 'sv'; }
}
// 둘째 줄은 지금 보는 화면의 것만 담는다 — 배치표면 부, 근무표면 거르개.
// 화면을 바꾸는 문은 삼선 하나뿐이라, 36홀로 칸이 빽빽해져도 머리는 안 늘어난다
function paintTabs(){
  var t = $('ptabs');
  if (VIEW === 'duty'){ t.className = 'ptabs'; t.innerHTML = ''; t.hidden = true; return; }
  t.hidden = false;
  if (VIEW === 'work'){
    t.className = 'ptabs fil';
    var fd = workTally().fdef.slice(), bfd = bulkFilDef();
    if (bfd) fd.unshift(bfd);                  // ★창 대신 칩 하나
    t.innerHTML = fd.map(function(f){
      return '<button class="fchip' + (wkFil === f[0] ? ' on' : '') + '" data-wfil="' + f[0] + '">'
        + f[1] + ' ' + f[2] + '</button>'; }).join('');
    return;
  }
  t.className = 'ptabs';
  t.innerHTML = DAY.map(function(p){
    return '<button data-part="' + p.key + '"' + (p.key === cur ? ' class="on"' : '') + '>'
      + esc(p.name) + '<i class="num">' + p.tees.length + '팀</i></button>';
  }).join('');
}
var IC_LIST = '<svg viewBox="0 0 24 24"><circle cx="5" cy="7" r="1.3"/><circle cx="5" cy="12" r="1.3"/>'
  + '<circle cx="5" cy="17" r="1.3"/><path d="M10 7h10M10 12h10M10 17h7"/></svg>';
var IC_BOARD = '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/>'
  + '<path d="M9.5 4.5v15M14.5 4.5v15"/></svg>';
function paintBar(){
  $('tbUndo').disabled = !STACK.length;
  var b = $('tbSave'), un = unsaved();
  b.className = 'save' + (un ? ' un' : '');
  var d = b.querySelector('.dot');
  if (un && !d) { d = document.createElement('span'); d.className = 'dot'; b.appendChild(d); }
  else if (!un && d) d.remove();
  var away = (VIEW !== 'board'), r = $('tbRoster');
  r.querySelector('.ic').innerHTML = away ? IC_BOARD : IC_LIST;
  r.querySelector('.lb').textContent = away ? '배치표' : '순번 · 명단';
  r.disabled = false;
}
// 집힌 사람이 있으면 아래 띠가 통째로 바뀐다 — 지금 무슨 모드인지 감출 수 없게
function pickNames(){
  return pickList.map(function(s){ var r = part(s.pk).roster[s.ri]; return r ? r.n : '?'; });
}
function paintPickbar(){
  if (!pick) pickList = [];      // 기계가 집은 걸 놓았으면(되돌리기 등) 화면도 따라 놓는다
  var on = pickList.length > 0;
  $('app').classList.toggle('picking', on);
  $('tabbar').style.display = on ? 'none' : '';
  $('pickbar').classList.toggle('on', on);
  if (!on) return;
  var nm = pickNames(), n = nm.length, h;
  if (n === 1){
    h = '<span class="tx"><b>' + esc(nm[0]) + '</b>바꿀 자리를 누르십시오 · '
      + '빈 칸을 누르면 그리로 옮깁니다</span>';
  } else if (n === 2){
    h = '<span class="tx"><b>' + esc(nm.join(' ↔ ')) + '</b>두 자리를 맞바꿉니다</span>'
      + '<button class="go" data-act="pickgo">맞바꾸기</button>';
  } else {
    // '한 바퀴'라는 말에 마지막 사람이 첫 자리로 온다는 뜻이 이미 들어 있다
    h = '<span class="tx"><b>' + esc(nm.join(' → ')) + '</b>'
      + n + '명이 한 바퀴 돕니다</span>'
      + '<button class="go" data-act="pickgo">돌리기</button>';
  }
  $('pickbar').innerHTML = h + '<button class="x" data-act="pickoff">×</button>';
}
// 한꺼번에 지정 띠 — 탭 띠 위에 얹는다. 탭 띠를 가리면 다른 화면으로 갈 길이 막힌다
function paintBulkbar(){
  var on = bulkOn(), bb = $('bulkbar');
  if (!on && wkFil === BULKFIL) wkFil = '';
  $('app').classList.toggle('bulking', on);
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
    + (n ? esc((m ? set : done).slice(-3).join(' · '))
           + (m > 3 ? ' 외 ' + (m - 3) + '명' : '')
         : (K ? '이어서 더 누르셔도 됩니다 · 끄기를 눌러도 안 풀립니다'
              : '이름을 누르면 여기에 쌓입니다')) + '</span>'
    + '<button data-act="bkundo"' + (bulkSteps() ? '' : ' disabled') + '>되돌리기</button>'
    + (n ? '<button class="go" data-act="bksave">저장하기</button>' : '')
    + '<button class="x" data-act="bkoff">끄기</button>';
}
// 고르기 중 띠 — 이름부터 고르고, 무엇을 할지는 나중에 정한다
function paintPickBulk(bb){
  var L = bulkPicked(), n = L.length, ch = bulkDirty();
  bb.innerHTML = '<span class="tx"><b>' + (n ? n + '명 선택했습니다' : '캐디 선택')
    + '</b>' + (n ? esc(L.slice(-3).join(' \u00b7 ')) + (n > 3 ? ' 외 ' + (n - 3) + '명' : '')
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
  openSheet('<div class="grab"></div><div class="k">확인</div>'
    + '<div class="st">한꺼번에 지정을 끕니다</div>'
    + '<div class="warnbox"><b>지정한 ' + n + '명이 지정 전으로 돌아갑니다.</b><br>'
    + esc(done.join(', ')) + '</div>'
    + '<div class="calmbox">' + (K ? '<b>저장한 ' + K + '명은 그대로입니다.</b> ' : '')
    + '저장한 뒤에 지정한 <b>' + n + '명</b>만 없던 일이 됩니다. '
    + '이 뒤에도 아래 <b>되돌리기</b>로 되살릴 수 있습니다.</div>'
    + '<div class="acts two" style="margin:15px 14px 0">'
    + '<button data-act="bkyes" class="warn">확인</button>'
    + '<button data-act="close">취소</button></div>', 'bulkoff', {});
}
function paint(){
  var sc = $('main').scrollTop;
  var hadQ = (document.activeElement && document.activeElement.id === 'wkQ');
  paintHead();
  paintTabs();
  $('pad').innerHTML = VIEW === 'work' ? workHTML()
    : VIEW === 'duty' ? dutyHTML() : boardHTML(part(cur));
  $('main').scrollTop = sc;      // 고칠 때마다 맨 위로 튀지 않게
  paintPickbar();
  paintBulkbar();
  paintBar();
  var wq = $('wkQ');
  if (wq && hadQ){ wq.focus(); try { wq.setSelectionRange(wkQ.length, wkQ.length); } catch (e) {} }
}
function setView(v){
  if (VIEW === v) return;
  VIEW = v;
  wkFil = (v === 'work') ? wkFil : '';
  if (v !== 'work') wkQ = '';
  $('main').scrollTop = 0;
  try { localStorage.setItem('board.mview', v); } catch (e) {}
  paint();
}

// ── 두 번 눌러 맞바꾸기 ─────────────────────
// 폰에서 끌기는 스크롤과 싸운다. 그래서 집고, 놓는다
function pickStart(pk, i){
  var ri = riOf(pk, i);
  if (ri < 0) return;
  var r0 = part(pk).roster[ri];
  if (!r0 || !r0.n) { toast('빈 자리입니다 — 옮길 사람을 먼저 집으십시오'); return; }
  pickList = [{ pk: pk, ri: ri }];
  pickSync();
  closeSheet();
  if (VIEW !== 'board') { VIEW = 'board'; cur = pk; }
  paint();
  toast('바꿀 자리를 차례로 누르십시오 · 셋 넷도 한꺼번에 됩니다');
}
// 자리를 하나 더 얹는다. 이미 집힌 자리를 또 누르면 놓는다
function pickTap(pk, i){
  var ri = riOf(pk, i);
  // ★줄이 없는 꼬리를 누르면 옮기는 것이다 — 한 사람을 집고 있을 때만
  if (ri < 0){
    if (pickList.length === 1){
      if (moveToSeat(pickList[0], pk, i)) { pickList = []; pickSync(); }
      paint(); return;
    }
    toast('꼬리 빈 자리에는 한 사람만 옮길 수 있습니다');
    return;
  }
  var at = pickAt(pk, ri);
  if (at >= 0){
    if (at === 0 && pickList.length === 1) { pickOff(); return; }
    pickList.splice(at, 1);
  } else {
    pickList.push({ pk: pk, ri: ri });
  }
  pickSync();
  paint();
}
// 고른 차례대로 한 바퀴 — 둘이면 그냥 맞바꾸기다
function pickGo(){
  if (pickList.length < 2) return;
  if (rotateSeats(pickList.slice())) { pickList = []; pickSync(); }   // commit 안에서 paint 한다
  paint();
}
function pickOff(){ pickList = []; pickSync(); paint(); toast('그만뒀습니다'); }


// ── 끌기 ────────────────────────────────────
// 두 사람을 그 자리에서 바로 바꾸는 빠른 길. 셋 넷을 돌릴 때는 집어서 고른다.
// ★폰에서는 끄는 손과 굴리는 손이 같다 — 그래서 꾹 눌러야 들린다.
// 바로 들리게 하면 배치표를 굴릴 수가 없고, 안 들리게 하면 끌 수가 없다
var DRAG_HOLD = 280;    // 이만큼 누르고 있으면 들린다
var DRAG_SLOP = 9;      // 그 전에 이만큼 움직이면 굴리려는 손이다
var dg = null;          // 들린 뒤에만 생긴다
var dgWait = null;      // 꾹 누르기를 기다리는 중
var dgBlock = false;    // 끌고 난 뒤 따라오는 누름 한 번을 삼킨다

function dgRef(el){
  var pk = el.getAttribute('data-pk'), i = Number(el.getAttribute('data-i'));
  var ri = riOf(pk, i);
  // ★줄이 없는 꼬리도 놓을 자리다. 이름만 없는 줄은 보통 자리라 맞바꾸기가 맡는다
  return { pk: pk, ri: ri, i: i, empty: ri < 0 };
}
function dgGhostTo(x, y){
  dg.x = x; dg.y = y;
  dg.ghost.style.left = x + 'px';
  dg.ghost.style.top = y + 'px';
}
// 손가락은 정확하지 않다. 칸 사이 금이나 가운데 시각 기둥에 놓아도
// 좌우로 조금씩 더듬어 가장 가까운 칸을 찾아 준다
function cellAt(x, y){
  var d = [0, -26, 26, -54, 54, -84, 84];
  for (var k = 0; k < d.length; k++){
    var el = document.elementFromPoint(x + d[k], y);
    var c = (el && el.closest) ? el.closest('.cell[data-pk]') : null;
    if (c) return c;
  }
  return null;
}
function dgOver(x, y){
  var prev = document.querySelector('.cell.over');
  if (prev) prev.classList.remove('over');
  var c = cellAt(x, y);
  if (!c || c === dg.el) return null;
  var ref = dgRef(c);
  if (!ref) return null;
  c.classList.add('over');
  return ref;
}
// 화면 끝에 대면 저절로 굴러간다 — 안 그러면 먼 자리에는 못 놓는다
function dgAuto(){
  if (!dg) return;
  var m = $('main'), r = m.getBoundingClientRect(), v = 0;
  if (dg.y < r.top + 76) v = -Math.min(16, (r.top + 76 - dg.y) / 3);
  else if (dg.y > r.bottom - 76) v = Math.min(16, (dg.y - (r.bottom - 76)) / 3);
  if (v) { m.scrollTop += v; dgOver(dg.x, dg.y); }
  requestAnimationFrame(dgAuto);
}
function dgLift(el, x, y){
  var ref = dgRef(el);
  if (!ref || ref.empty) return;      // 빈 칸은 들 것이 없다
  var r = part(ref.pk).roster[ref.ri];
  if (!r || !r.n) return;             // 이름 없는 줄도 들 것이 없다
  dg = { pk: ref.pk, ri: ref.ri, el: el, x: x, y: y };
  el.classList.add('lift');
  var g = document.createElement('div');
  g.className = 'dghost';
  g.innerHTML = '<span class="p num">' + (ref.i + 1) + '</span>'
    + '<span class="nm">' + esc(r.n) + '</span>';
  document.body.appendChild(g);
  dg.ghost = g;
  dgGhostTo(x, y);
  try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* 없어도 그만 */ }
  requestAnimationFrame(dgAuto);
}
function dgEnd(e){
  if (dgWait) { clearTimeout(dgWait.t); dgWait = null; return; }
  if (!dg) return;
  var to = dgOver(e.clientX, e.clientY);
  // 들었던 자리에 도로 놓은 것인가 — 마음이 바뀐 것뿐이니 나무랄 일이 아니다
  var back = (cellAt(e.clientX, e.clientY) === dg.el);
  var over = document.querySelector('.cell.over');
  if (over) over.classList.remove('over');
  if (dg.el) dg.el.classList.remove('lift');
  if (dg.ghost) dg.ghost.remove();
  var from = { pk: dg.pk, ri: dg.ri };
  dg = null;
  dgBlock = true;
  setTimeout(function(){ dgBlock = false; }, 80);
  if (!to) { if (!back) toast('놓을 자리를 못 찾았습니다'); return; }
  if (to.empty) moveToSeat(from, to.pk, to.i);     // 줄 없는 꼬리면 그 칸으로 옮긴다
  else rotateSeats([from, { pk: to.pk, ri: to.ri }]);   // 둘을 도는 것이 곧 맞바꾸기다
  paint();
}
$('pad').addEventListener('pointerdown', function(e){
  if (e.button || VIEW !== 'board') return;
  if (pickList.length) return;        // 집어서 고르는 중에는 끌지 않는다 — 한 번에 한 가지만
  var c = e.target.closest ? e.target.closest('.cell[data-pk]') : null;
  if (!c) return;
  var x = e.clientX, y = e.clientY;
  dgWait = { x: x, y: y, t: setTimeout(function(){ dgWait = null; dgLift(c, x, y); }, DRAG_HOLD) };
});
document.addEventListener('pointermove', function(e){
  if (dgWait){
    if (Math.abs(e.clientX - dgWait.x) > DRAG_SLOP || Math.abs(e.clientY - dgWait.y) > DRAG_SLOP){
      clearTimeout(dgWait.t); dgWait = null;      // 굴리려는 손이었다
    }
    return;
  }
  if (!dg) return;
  dgGhostTo(e.clientX, e.clientY);
  dgOver(e.clientX, e.clientY);
});
document.addEventListener('pointerup', dgEnd);
document.addEventListener('pointercancel', dgEnd);
// 들린 뒤에는 화면이 따라 굴러가면 안 된다. touch-action 은 손이 닿는 순간 정해지므로
// 여기서 그때그때 막는다
document.addEventListener('touchmove', function(e){ if (dg) e.preventDefault(); }, { passive: false });

// ── 창 ──────────────────────────────────────
function openSheet(html, kind, forWhat){
  sheetKind = kind; sheetFor = forWhat || {};
  $('sheet').innerHTML = html;
  $('sheet').scrollTop = 0;
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}
function closeSheet(){
  $('sheet').classList.remove('on');
  $('scrim').classList.remove('on');
  sheetFor = null; sheetKind = '';
}
function openCell(pk, i){
  var p = part(pk), a = active(p), r = a[i], t = p.tees[i];
  if (!sheetFor || sheetFor.pk !== pk || sheetFor.i !== i) swQ = '';

  var h = '<div class="grab"></div>'
    + '<div class="k">' + esc(p.name) + ' · '
    + (isItn(r) ? '인턴 칸' : '순번 ' + seatNoTx(p, i) + '번')
    + (t ? ' · ' + t.time + ' ' + esc(cname(t.course)) + (offGrid(p, t.time) ? ' (격자 밖)' : '') : ' · 대기') + '</div>'
    + '<div class="st">' + ((r && r.n) ? esc(r.n) : '비어 있음') + '</div>'
    + '<div class="sub">' + (t ? '이 자리는 ' + t.time + '에 ' + esc(cname(t.course)) + '으로 나갑니다'
                              : '티오프가 없는 대기 자리입니다') + '</div>'

    + '<div class="grp"><h4>자리 바꾸기</h4>'
    + '<div class="acts"><button data-act="pick" class="go">배치표에서 고르기</button></div>'
    + '<div class="dnote" style="margin-top:9px">배치표에서 바꿀 자리를 <b>차례로</b> 누릅니다. '
    + '둘이면 맞바꾸고, <b>셋 넷이면 그 차례로 한 바퀴 돕니다.</b><br>'
    + '둘만 바꿀 때는 칸을 <b>꾹 눌러 끄는 게</b> 빠릅니다.</div></div>'
    + '<div class="grp" style="padding-bottom:4px"><h4>또는 사람을 골라 바로 맞바꾸기</h4>'
    + '<div class="fld"><input id="swQ" autocomplete="off" placeholder="이름으로 찾기"></div></div>'
    + '<div class="lst inswap" id="swOut"></div>'

    // ★자리 번호가 제목에 있고 단추가 할 일을 말한다 — 밑에 또 풀어 적지 않는다
    + '<div class="grp"><h4>' + (i + 1) + '번에 캐디 끼워 넣기</h4>'
    + '<div class="acts"><button data-act="ins" class="go" style="flex:1">'
    + (i + 1) + '번에 끼워 넣을 캐디 고르기</button></div></div>'

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
    + '<div class="grp"><h4>매칭 캐디</h4>'
    + '<div class="fld"><input id="shName" value="' + (r ? esc(r.n) : '') + '" autocomplete="off" placeholder="이름">'
    + '<button data-act="name">고치기</button></div>'
    + '<div class="acts" style="margin-top:10px">'
    + '<button data-act="off" class="warn">결근 처리</button>'
    + '<button data-act="seatclr" class="warn">이 자리 비우기</button>'
    + '<button data-act="prmhere" class="warn">이 부에서 빼기</button>'
    + '</div>'
    + '<div class="grp"><h4>인턴</h4>'
    + (isItn(r)
       ? '<div class="fld"><input id="itnName" value="' + esc(r.n) + '" autocomplete="off" placeholder="인턴 이름">'
         + '<button data-act="itnname">이름 고치기</button></div>'
         + '<div class="acts" style="margin-top:10px">'
         + '<button data-act="itnoff" class="warn">인턴 풀기</button></div>'
         + '<div class="dnote" style="margin-top:9px">이 칸은 <b>인턴</b>입니다 \u2014 '
         + '티오프는 차지하지만 <b>순번을 안 씁니다.</b> 풀면 이 칸이 없어지고 '
         + '뒤 캐디가 <b>한 칸씩 앞 티오프로</b> 옵니다 \u2014 번호는 그대로입니다.</div>'
       : '<div class="fld"><input id="itnName" value="" autocomplete="off" placeholder="인턴 이름 (비우면 그냥 인턴)">'
         + '<button data-act="itnon">여기에 인턴 끼워 넣기</button></div>'
         + '<div class="dnote" style="margin-top:9px">인턴은 <b>티오프는 차지하되 순번은 안 씁니다.</b> '
         + '조 편성 명단 밖 사람이라 <b>총원\u00b7가용에도 안 듭니다.</b><br>'
         + '여기에 <b>끼워 넣습니다</b> \u2014 뒤 캐디들은 한 칸씩 <b>뒤 티오프로</b> 가고 '
         + '<b>번호는 그대로입니다.</b>'
         + (r && r.n ? '<br>지금 이 칸의 <b>' + esc(r.n) + '</b>은(는) 자리를 안 잃습니다.' : '')
         + '</div>')
    + '</div>'
    + (isItn(r) ? '' : (r ? dayTagGrp(r.n) : '')) + '<div class="grp">'
    + '<div class="dnote">이름 고치기는 <b>판독이 틀렸을 때</b> 씁니다. 사람이 바뀐 것이면 그 칸을 비우고 다시 앉히십시오.'
    + '</div>'
    + '</div>';

  if (t){
    h += '<div class="grp"><h4>이 팀</h4>'
      + '<div class="fld">' + timeInput('id="shTime" class="tf"', t.time)
      + '<button data-act="time">시각 바꾸기</button></div>'
      + '<div class="acts" style="margin-top:10px">'
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
  openSheet(h, 'cell', { pk: pk, i: i });
  drawSwapList();
  var qe = $('swQ');
  if (qe) qe.addEventListener('input', function(){ swQ = qe.value; drawSwapList(); });
}
// 바꿀 상대 목록. 대기든 근무든 오늘 나온 사람이면 다 나온다 —
// 같은 부에서 일하는 사람끼리 못 바꾸는 규칙 같은 건 없다
var swQ = '';
function drawSwapList(){
  if (!sheetFor || sheetKind !== 'cell') return;
  var pk = sheetFor.pk, me = sheetFor.i, q = (swQ || '').trim();
  var mine = part(pk), out = '', n = 0;
  // 두 부를 도는 캐디는 제 이름이 다른 부 줄로도 나온다 — 자기와는 바꿀 것이 없다
  var myName = (active(mine)[me] || {}).n;

  function rows(p, from, to, label){
    var a = active(p), h = '', c = 0;
    for (var j = from; j < to && j < a.length; j++){
      if (p.key === pk && j === me) continue;
      if (a[j].n === myName) continue;
      if (q && a[j].n.indexOf(q) < 0) continue;
      var t = p.tees[j];
      h += '<button class="row" data-swapto="' + p.key + '|' + p.roster.indexOf(a[j]) + '">'
        + '<span class="p num">' + (j + 1) + '</span>'
        + '<span class="nm">' + esc(a[j].n) + '</span>'
        + (a[j].tag ? '<span class="b">' + esc(a[j].tag) + '</span>' : '')
        + '<span class="wh">' + (t ? t.time + ' ' + esc(cname(t.course)) : '대기') + '</span></button>';
      c++;
    }
    if (!c) return '';
    n += c;
    return '<div class="hd2">' + label + ' · ' + c + '명</div>' + h;
  }

  var nw = mine.tees.length;
  out += rows(mine, 0, nw, esc(mine.name) + ' 근무');
  out += rows(mine, nw, active(mine).length, esc(mine.name) + ' 대기');
  DAY.forEach(function(p){
    if (p.key === pk) return;
    out += rows(p, 0, active(p).length, esc(p.name));
  });
  // ★자리 없는 사람도 넣을 수 있어야 한다 — 부에서 뺀 사람·미배치·쉬는 사람.
  //   기계는 이미 이 길을 안다(swapRef 의 offName). 목록만 없었다
  var seat = {};
  DAY.forEach(function(q2){ q2.roster.forEach(function(r){ if (r.n) seat[r.n] = 1; }); });
  var free = workRows().filter(function(r){
    return !seat[r.n] && (!q || r.n.indexOf(q) >= 0); });
  if (free.length){
    n += free.length;
    out += '<div class="hd2">자리 없는 사람 · ' + free.length + '명</div>'
      + free.map(function(r){
          return '<button class="row" data-swapoff="' + esc(r.n) + '">'
            + '<span class="p">—</span>'
            + '<span class="nm">' + esc(r.n) + '</span>'
            + (tagOf(r.n) ? '<span class="b">' + esc(tagOf(r.n)) + '</span>' : '')
            + '<span class="wh">' + esc(r.st) + '</span></button>'; }).join('');
  }
  $('swOut').innerHTML = out || '<div class="empty">'
    + (q ? esc(q) + ' — 오늘 명단에 없습니다' : '바꿀 사람이 없습니다') + '</div>';
}
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
  if (open) openSheet(seatGoHTML(), 'seatgo', sheetFor);
  else $('sheet').innerHTML = seatGoHTML();
}
// 끼워 넣기 — 그 자리에 들어가고 뒤가 밀린다. 맞바꾸기와 문을 나눠 둔다
var insQ = '';
function openInsert(pk, i){
  var p = part(pk), t = p.tees[i];
  openSheet('<div class="grab"></div>'
    + '<div class="k">' + esc(p.name) + ' · 순번 ' + (i + 1) + '번'
    + (t ? ' · ' + t.time + ' ' + esc(cname(t.course)) : ' · 대기') + '</div>'
    + '<div class="st">' + (i + 1) + '번에 끼워 넣을 캐디 고르기</div>'
    + '<div class="sub">고른 사람이 <b>' + (i + 1) + '번</b>이 되고 '
    + '<b>여기부터 뒤가 한 칸씩 밀립니다.</b> 자리를 바꾸는 것이 아닙니다 — 아무도 자리를 잃지 않습니다.</div>'
    + '<div class="grp" style="padding-bottom:4px"><h4>명부에서 찾기</h4>'
    + '<div class="fld"><input id="insQ" autocomplete="off" placeholder="이름으로 찾기"></div>'
    + '<div class="dnote" style="margin-top:9px">조출·중복 근무처럼 <b>배지가 붙은 사람</b>은 '
    + '순번 세우기가 안 건드립니다 — 여기 넣어 두면 그 자리에 그대로 있습니다.</div></div>'
    + '<div class="lst inswap" id="insOut"></div>'
    + '<button class="close" data-act="close">닫기</button>', 'ins', { pk: pk, i: i });
  drawInsList();
  var qe = $('insQ');
  if (qe) qe.addEventListener('input', function(){ insQ = qe.value; drawInsList(); });
}
// ★목록만 다시 그린다 — 창을 통째로 다시 열면 한글 치던 칸이 죽는다
function drawInsList(){
  if (!sheetFor || sheetKind !== 'ins') return;
  var pk = sheetFor.pk, me = sheetFor.i, q = (insQ || '').trim();
  var mine = part(pk), out = '';
  function row(nm, pos, where, tg){
    return '<button class="row" data-insn="' + esc(nm) + '">'
      + '<span class="p' + (pos ? ' num' : '') + '">' + (pos || '—') + '</span>'
      + '<span class="nm">' + esc(nm) + '</span>'
      + (tg ? '<span class="b">' + esc(tg) + '</span>' : '')
      + '<span class="wh">' + esc(where) + '</span></button>';
  }
  // ① 자리 없는 사람 — 조출·중복·미배치가 여기 있다. 이 문을 내는 까닭이다
  var seat = {};
  DAY.forEach(function(q2){ q2.roster.forEach(function(r){ if (r.n) seat[r.n] = 1; }); });
  var free = workRows().filter(function(r){ return !seat[r.n] && (!q || r.n.indexOf(q) >= 0); });
  if (free.length)
    out += '<div class="hd2">자리 없는 사람 · ' + free.length + '명</div>'
      + free.map(function(r){ return row(r.n, 0, r.st, tagOf(r.n)); }).join('');
  // ② 다른 부에 있는 사람 — 두 부를 뛰게 하는 일이다
  DAY.forEach(function(p){
    if (p.key === pk) return;
    var a = active(p), h = '', c = 0;
    a.forEach(function(r, j){
      if (!r.n || (q && r.n.indexOf(q) < 0)) return;
      var t = p.tees[j];
      h += row(r.n, j + 1, (t ? t.time + ' ' + cname(t.course) : '대기'), r.tag); c++;
    });
    if (c) out += '<div class="hd2">' + esc(p.name) + ' · ' + c + '명</div>' + h;
  });
  // ③ 이 부 안에서 자리만 옮기기
  var a2 = active(mine), h2 = '', c2 = 0;
  a2.forEach(function(r, j){
    if (!r.n || j === me || (q && r.n.indexOf(q) < 0)) return;
    var t = mine.tees[j];
    h2 += row(r.n, j + 1, (t ? t.time + ' ' + cname(t.course) : '대기'), r.tag); c2++;
  });
  if (c2) out += '<div class="hd2">' + esc(mine.name) + ' 안에서 자리만 옮기기 · ' + c2 + '명</div>' + h2;
  $('insOut').innerHTML = out || '<div class="empty">'
    + (q ? esc(q) + ' — 오늘 명단에 없습니다' : '넣을 사람이 없습니다') + '</div>';
}
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
    + '<div class="grp"><h4>부 선택</h4>'
    // ★한 부에 한 칸. 이름만 적고, 그 부에서 일하면 그 부 색으로 찬다 —
    //   글로 상태를 적어 두면 칸마다 글이 달라져 줄이 지저분해진다
    + '<div class="acts pm" style="grid-template-columns:repeat(' + DAY.length + ',minmax(0,1fr))">'
    + parts.map(function(p){
        var all = n > 0 && p.pln === n, some = p.pln > 0 && !all;
        return '<button class="pk' + esc(p.k) + (all ? ' on' : (some ? ' half' : ''))
          + '" data-bkdo="' + (all ? 'p-' : 'p+') + esc(p.k) + '">'
          + '<b>' + esc(p.name) + '</b></button>'; }).join('')
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
    + '</div>';
}
function openBulkAct(){
  openSheet(bulkActHTML() + '<button class="close" data-act="close">닫기</button>', 'bulkact', {});
}
// 시각 고치기 — 이 칸만인지, 뒤 시간대도 같이 미는지 고른다
var teeRest = true;
function openTeeTime(pk, i){
  var p = part(pk), t = p.tees[i];
  if (!t) return;
  var after = p.tees.filter(function(x, k){ return k !== i && mm(x.time) >= mm(t.time); }).length;
  openSheet('<div class="grab"></div>'
    + '<div class="k">' + esc(p.name) + ' · ' + t.time + '</div>'
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
    + '<button class="close" data-act="close">닫기</button>', 'tee', { pk: pk, i: i });
}
function openAddTeam(pk){
  var p = part(pk);
  var last = p.tees.length ? p.tees[p.tees.length - 1] : { time: p.start || '7:00' };
  openSheet('<div class="grab"></div>'
    + '<div class="k">' + esc(p.name) + '</div><div class="st">팀 추가</div>'
    + '<div class="sub">넣으면 시각순으로 자리를 다시 맞추고, 대기 첫 사람이 근무가 됩니다</div>'
    + '<div class="grp"><h4>시각</h4>'
    + '<div class="fld">' + timeInput('id="adTime" class="tf"', hm(mm(last.time) + GAP)) + '</div>'
    + '<div class="acts" style="margin-top:11px">'
    + '<button class="go" data-act="addteam" style="flex:1">넣기</button></div>'
    + '<div class="dnote">시각만 넣으면 <b>그 시각에 빈 코스</b>로 들어갑니다 — '
    + '코스는 안 고르셔도 됩니다. 다르면 그 칸에서 코스를 바꾸십시오.<br>'
    + GAP + '분 격자에 <b>맞추지 않아도 됩니다</b> — 끼워 넣는 날이 있습니다.</div></div>'
    + '<button class="close" data-act="close">닫기</button>', 'add', { pk: pk });
}
// 순번 · 명단 — 그 부의 명단을 순번 그대로. 결근한 사람도 자리에 남겨 보여준다
function openRoster(){
  var p = part(cur), n = p.tees.length, ai = 0;
  var rows = p.roster.map(function(r, ri){
    if (r.off){
      return '<button class="row off" data-offri="' + ri + '">'
        + '<span class="p">—</span><span class="nm">' + esc(r.n) + '</span>'
        + '<span class="b">결근</span></button>';
    }
    var i = ai++, t = p.tees[i];
    return '<button class="row" data-pk="' + p.key + '" data-i="' + i + '">'
      + '<span class="p num">' + (i + 1) + '</span>'
      + '<span class="nm">' + esc(r.n) + '</span>'
      + (r.tag ? '<span class="b">' + esc(r.tag) + '</span>' : '')
      + '<span class="wh">' + (t ? t.time + ' ' + esc(cname(t.course)) : '대기') + '</span></button>';
  }).join('');
  var offN = p.roster.length - active(p).length;
  openSheet('<div class="grab"></div>'
    + '<div class="k">' + esc(p.name) + '</div><div class="st">순번 · 명단</div>'
    + '<div class="sub">출근 ' + active(p).length + '명 · 근무 ' + n + '명 · 대기 '
    + (active(p).length - n) + '명' + (offN ? ' · 결근 ' + offN + '명 (누르면 되돌립니다)' : '') + '</div>'
    + '<div class="lst">' + rows + '</div>'
    + '<div class="acts" style="margin:12px 14px 0">'
    + '<button data-act="padd" data-pk="' + esc(cur) + '">이 부에 사람 넣기</button></div>'
    + '<div class="dnote">넣으면 <b>맨 뒤</b>에 붙습니다. 빼는 것은 이름을 누른 뒤 <b>부에서 빼기</b>에서 합니다.</div>'
    + '<button class="close" data-act="close">닫기</button>', 'roster', { pk: cur });
}
// ★자리가 없다고 칸을 없애지 않는다. 칸이 사라지면 아래가 통째로 뛰어올라
// 방금 누른 자리에 딴 단추가 와 있다 — 흐리게 두고 왜 없는지만 적는다
function seatsGrp(nm, seats, act){
  var body;
  if (seats.length){
    body = seats.map(function(s){
      return '<button data-' + act + '="' + s.pk + (act === 'goseat' ? '|' : ':') + s.ri + '">'
        + esc(s.label) + '</button>'; }).join('');
  } else {
    var rec = ABSFROM[nm], was = (rec && rec.pks) || [];
    var why = isAbs(tagOf(nm)) ? tagOf(nm) : '자리 없음';
    body = (was.length ? was : ['']).map(function(k){
      return '<button class="dim" disabled>' + (k ? esc(part(k).name) + ' · ' : '') + why + '</button>';
    }).join('');
  }
  return '<div class="grp"><h4>오늘 근무</h4><div class="acts">' + body + '</div>'
    + '<div class="dnote">' + (seats.length
        ? '자리를 누르면 <b>배치표의 그 칸으로 갑니다.</b>'
        : '오늘 자리가 없습니다. 아래에서 넣으십시오.')
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
            + '1·2부에는 배지가 없어도 안 들어갑니다. 중복 근무나 대기 바꿈으로 1·2부를 뛰는 것은 그대로 됩니다.'
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
// ★그날의 구분과 근태는 한 칸(TAG)을 나눠 쓴다 — 그래서 화면에서도 한 묶음이다.
//   칸 수는 못 박는다. '근무'가 생겼다 없어졌다 하면 단추가 한 칸씩 밀린다
function stateGrp(nm, hasSeat){
  var t = tagOf(nm), isA = isAbs(t), t0 = dayMark(nm);
  var none = !t0 && !isA;                      // 아무것도 안 붙은 것이 그대로 '근무'이다
  function btn(attr, v, label, on){
    return '<button data-' + attr + '="' + esc(v) + '"' + (on ? ' class="on"' : '') + '>'
      + esc(label) + '</button>';
  }
  return '<div class="grp"><h4>상태</h4>'
    + '<div class="acts fix" style="grid-template-columns:repeat(4,minmax(0,1fr))">'
    // ★'근무'는 붙은 것을 떼는 자리다 — 쉬고 있었으면 자리를 돌려주고,
    //   그날의 구분이었으면 구분만 둔다. 두 기계가 다르니 누를 부를지를 여기서 가른다
    + btn(isA ? 'abs' : 'dtag', '', '근무', none)
    + DAYTAGS.map(function(x){ return btn('dtag', x, x, t0 === x); }).join('')
    + '</div><div style="height:8px"></div>'
    + '<div class="acts fix" style="grid-template-columns:repeat(4,minmax(0,1fr))">'
    + ABSTYPES.map(function(x){ return btn('abs', x, x, t === x); }).join('')
    + '</div><div class="dnote">'
    + (t0 === '찾근'
       ? '<b>찾근</b>은 본인이 <b>원하는 순번을 골라 옵니다</b> — '
         + '그래서 순번 세우기가 안 세우고 배치표 자리에서도 내려와 있습니다.<br>'
       : '')
    + (isA
       ? '<b>근무</b>를 누르면 있던 부의 <b>대기 뒤로</b> 돌아옵니다.'
       : '조출·후출·정출·찾근을 붙이면 <b>순번 세우기에서 빠지고 배치표 자리에서도 내려옵니다</b> '
         + '— 어디에 놓을지는 사람이 정합니다.'
         + (hasSeat ? ' 휴무·휴가·병가는 <b>선 자리를 비우고</b> 뒤 순번이 당겨집니다.' : ''))
    + ' 되돌리기 한 번으로 그대로 돌아옵니다.</div></div>';
}
// 한 부만 넣고 뻐다 — 대바는 두 사람을 맞바꾸는 일이고, 이건 한 사람을 넣거나 빼는 일이다
function partMoveHTML(nm){
  if (!DAY.length) return '';
  // ★한 부에 한 칸. 이름만 적고, 그 부에서 일하면 그 부 색으로 찬다 —
  //   한꺼번에 바꾸기 창과 같은 모양이다.
  //   누른 뒤에도 그 부의 칸은 그 자리에 그대로 있다
  return '<div class="grp"><h4>부 선택</h4>'
    + '<div class="acts pm" style="grid-template-columns:repeat(' + DAY.length + ',minmax(0,1fr))">'
    + DAY.map(function(p){
        // ★누르면 '오늘 이 부에서 일한다'가 켜지고 꺼진다(PLAN).
        //   배치표 명단은 안 건드린다 — 대기에도 순번이 이어져 붙어서,
        //   여기서 줄을 만들면 관리자가 짜 놓은 순번이 흔들린다.
        //   자리는 배치표에서 빈 칸을 눌러 앉힌다
        var on = inPlan(nm, p.key);
        return '<button class="pk' + esc(p.key) + (on ? ' on' : '')
          + '" data-pln="' + esc(p.key) + '">'
          + '<b>' + esc(p.name) + '</b></button>'; }).join('')
    + '</div>'
    // ★배치표에 실제로 앉아 있는 자리는 따로 보여 준다 — 여기서만 자리를 미는다
    + (partsOf(nm).length
       ? '<div class="dnote" style="margin:9px 0 8px">배치표 자리 — '
         + partsOf(nm).map(function(k){ return '<b>' + esc(part(k).name) + '</b>'; }).join(' · ')
         + '</div><div class="acts">'
         + partsOf(nm).map(function(k){
             return '<button class="warn" data-prm="' + k + '">' + esc(part(k).name)
               + ' 자리 빼기</button>'; }).join('')
         + '</div>' : '')
    + '</div>';
}
// 사람 하나 — 오늘 어디 있나. 근무표에서 이름을 누르면 여기로 온다
// ── 카트 ────────────────────────────────────
// ★주인 카트와 오늘 타는 카트는 다른 값이다. 한 칸에 같이 쓰면 빌린 번호가 주인표를 덮는다
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
function cartGrp(nm){
  var own = ownCart(nm), now = cartOf(nm), lent = isLent(nm);
  var pks = workParts(nm), free = cartFreeFor(nm);
  var wh = pks.length ? pks.map(function(k){ return part(k).name; }).join('·') : '근무 없음';
  var h = '<div class="grp"><h4>오늘 타는 카트</h4>'
    + '<div class="fld"><input id="cartN" type="number" min="0" max="999" step="1" '
    + 'inputmode="numeric" placeholder="번호" value="' + (now || '') + '">'
    + '<button data-act="cartsave">넣기</button></div>'
    + '<div class="acts fix" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:7px">'
    + '<button data-act="cartpick">안 쓰는 카트 고르기</button>'
    + '<button data-act="cartmine"' + (lent ? '' : ' disabled') + '>제 카트로</button></div>'
    + '<div class="acts fix" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:7px">'
    + '<button data-act="cartok"' + (now && !cartBad(now) ? ' class="on"' : '')
    + (now ? '' : ' disabled') + '>쓸 수 있음</button>'
    + '<button data-act="cartbad" class="warn' + (now && cartBad(now) ? ' on' : '') + '"'
    + (now ? '' : ' disabled') + '>고장 — 못 씀</button></div>'
    + '<div class="dnote">';
  if (lent){
    var ow = cartOwnerOf(now);
    h += '<b>' + now + '번을 빌려 탑니다</b>' + (ow ? ' — 주인 ' + esc(ow) + ' · 지금 '
      + esc(cartWhere(ow)) : '') + '. 제 카트는 '
      + (own ? '<b>' + own + '번</b>' : '<b>없습니다</b>') + '. 빌림은 <b>오늘까지</b>입니다 — '
      + '날을 넘기면 저절로 풀립니다.';
  } else if (now){
    var mates = [];
    JONAMES.forEach(function(x){ if (x !== nm && cartOf(x) === now) mates.push(x); });
    h += '<b>제 카트 ' + now + '번</b>입니다' + (cartBad(now) ? ' · <b>고장</b>' : '')
      + (mates.length ? ' · <b>' + esc(mates.join(', ')) + '</b>도 오늘 같은 번호입니다' : '') + '. '
      + '오늘만 다른 카트를 타면 번호를 바꿔 넣으십시오 — 주인표는 안 건드립니다.';
  } else {
    h += '탈 카트가 <b>없습니다.</b> ' + wh + ' 기준으로 지금 안 쓰는 카트가 <b>'
      + free.length + '대</b> 있습니다.';
  }
  h += '</div></div>';
  h += '<div class="grp"><h4>주인 카트</h4>'
    + '<div class="fld"><input id="cartOwnN" type="number" min="0" max="999" step="1" '
    + 'inputmode="numeric" placeholder="번호" value="' + (own || '') + '">'
    + '<button data-act="cartown">고치기</button></div>'
    + '<div class="dnote">좀처럼 안 바뀌는 값입니다 — <b>날이 바뀌어도 안 풀립니다.</b> '
    + '오늘만 남의 카트를 타는 것이면 <b>위 칸</b>에 넣으십시오.</div></div>';
  return h;
}
// 안 쓰는 카트 고르기 — 빔·대기·사용중·고장을 갈라 놓는다
function openCartPick(nm){
  var pks = workParts(nm);
  if (!pks.length) pks = DAY.map(function(p){ return p.key; });
  var wh = pks.map(function(k){ return part(k).name; }).join('·');
  var now = cartOf(nm);
  var grp = { free: [], wait: [], busy: [], bad: [] };
  allCarts().forEach(function(c){
    if (c === now) return;
    grp[cartStateAll(c, pks)].push(c);
  });
  var sec = function(k, note){
    if (!grp[k].length) return '';
    return '<div class="bhd">' + CARTLBL[k] + ' ' + grp[k].length + '대'
      + (note ? ' · ' + note : '') + '</div>'
      + grp[k].map(function(c){
          var ow = cartOwnerOf(c), can = (k === 'free' || k === 'wait');
          return '<button class="brow ct' + k + '"' + (can ? '' : ' disabled')
            + ' data-cartno="' + c + '">'
            + '<span class="n">' + c + '번</span>'
            + '<span class="bg">' + (ow ? esc(ow) + ' · ' + esc(cartWhere(ow)) : '주인 없음') + '</span>'
            + '<span class="k">' + (can ? '빌리기' : CARTLBL[k]) + '</span></button>'; }).join('');
  };
  openSheet('<div class="grab"></div>'
    + '<div class="k">' + esc(nm) + ' · ' + esc(wh) + '</div>'
    + '<div class="st">안 쓰는 카트</div>'
    + '<div class="sub">' + esc(wh) + '에 <b>아무도 안 타는</b> 카트만 빌릴 수 있습니다. '
    + '주인이 그 시간에 타고 있으면 <b>사용중</b>으로 잠깁니다.</div>'
    + '<div class="lst blst">'
    + sec('free') + sec('wait', '주인이 대기입니다 — 불리면 탑니다')
    + sec('busy', '못 빌립니다') + sec('bad', '못 씁니다')
    + (allCarts().length ? '' : '<div class="bhd">아는 카트가 없습니다</div>')
    + '</div><button class="close" data-act="close">닫기</button>', 'cartpick', { person: nm });
}
function openPerson(nm){
  var seats = peopleIndex().map[nm] || [], cart = cartOf(nm);
  var h = '<div class="grab"></div><div class="k">근무표</div>'
    + '<div class="st">' + esc(nm) + '</div>'
    + '<div class="sub">' + esc(JOLABEL[joOf(nm)] || '조 미배정') + ' · '
    + (cart ? '지정 카트 ' + cart + '번' + (cartBad(cart) ? ' · 고장' : '') : '지정 카트 없음') + '</div>';

  h += seatsGrp(nm, seats, 'goseat');
  h += cartGrp(nm);
  h += partMoveHTML(nm);
  h += bu3Grp(nm);
  h += stateGrp(nm, seats.length);
  h += '<button class="close" data-act="close">닫기</button>';
  openSheet(h, 'person', { person: nm });
}
// 차림표 한 줄에 담을 당번 요약. 이름을 늘어놓으면 잘려서 '다 안 보인다'가 된다 —
// 그래서 센 수를 앞에 두고, 자리가 남을 때만 이름을 덧붙인다
function dutySummary(){
  var n = 0, empty = 0, names = [];
  DUTYKEYS.forEach(function(k){
    var w = dutyList(k);
    n += w.length;
    if (w.length) w.forEach(function(x){ names.push(x.n || '—'); });
    else empty++;
  });
  var head = DUTYKEYS.length + '종류 · ' + n + '명';
  if (empty) head += ' · 빈 자리 ' + empty;
  if (n && n <= 2) head += ' · ' + names.join('·');
  return head;
}
// 순번 세우기 카드의 한 줄 — 누가 시작인지, 오늘 어디 있는지, 그리고 세우는 단추
function lineupSpot(n){
  var s = '';
  DAY.forEach(function(p){
    if (s) return;
    var ix = active(p).map(function(r){ return r.n; }).indexOf(n);
    if (ix >= 0) s = p.name + ' ' + (ix + 1) + '번';
  });
  return s;
}
function lineupRow(label, who, pickAct, runAct, runText){
  var spot = who ? lineupSpot(who) : '';
  return '<button class="lrow" data-act="' + pickAct + '"><span class="lk">' + esc(label) + '</span>'
    + '<span class="lv' + (who ? '' : ' none') + '">' + esc(who || '아직 없습니다') + '</span>'
    + '<span class="lw">' + (who ? esc((JOLABEL[joOf(who)] || '조 미배정') + (spot ? ' · ' + spot : ''))
                                 : '누르면 고릅니다') + '</span>'
    + '<span class="go2"></span></button>'
    + '<button class="lgo" data-act="' + runAct + '"' + (who ? '' : ' disabled') + '>'
    + esc(runText) + '</button>';
}

// 선발 고르기 — 배지 없는 하우스캐디만 후보다.
// 중복 근무·휴무·병가·3부 같은 배지가 붙은 사람은 이 셈에서 빠진다
var sbQ = '', sbKind = 'house';
var apQ = '', apPk = '1';
function openAddPerson(pk){
  apPk = pk; apQ = '';
  openSheet('<div class="grab"></div><div class="k">' + esc(part(pk).name) + '</div>'
    + '<div class="st">이 부에 사람 넣기</div>'
    + '<div class="sub">고르면 <b>맨 뒤</b>에 붙습니다. 쉬는 사람을 고르면 근태가 <b>근무</b>로 바뀝니다.</div>'
    + '<div class="srch"><input id="apQ" autocomplete="off" placeholder="이름으로 찾기"></div>'
    + '<div class="lst inswap" id="apOut"></div>'
    + '<button class="close" data-act="close">닫기</button>', 'addperson', { pk: pk });
  drawAddPerson();
  var qe = $('apQ');
  if (qe) qe.addEventListener('input', function(){ apQ = qe.value; drawAddPerson(); });
}
function drawAddPerson(){
  var q = (apQ || '').trim(), pool = addablePool(apPk), out = '', g, c;
  for (g = 0; g < JOCNT; g++){
    var rows = '';
    c = 0;
    pool.forEach(function(n){
      if (joOf(n) !== g || (q && n.indexOf(q) < 0)) return;
      c++;
      var t = tagOf(n), where = partsOf(n).map(function(k){
        var a = active(part(k)).map(function(r){ return r.n; }), ix = a.indexOf(n);
        return part(k).name + ' ' + (ix >= 0 ? (ix + 1) + '번' : '결근');
      }).join(' · ');
      rows += '<button class="row" data-padd="' + esc(apPk) + '" data-pn="' + esc(n) + '">'
        + '<span class="nm">' + esc(n) + '</span>'
        + (t ? '<span class="b">' + esc(t) + '</span>' : '')
        + '<span class="wh">' + esc(where || '오늘 자리 없음') + '</span></button>';
    });
    if (c) out += '<div class="johd">' + esc(JOLABEL[g] || (g + 1) + '조') + ' · ' + c + '명</div>' + rows;
  }
  var el = $('apOut');
  if (el) el.innerHTML = out || '<div class="dnote">넣을 사람이 없습니다.</div>';
}
function openSeonbalPick(kind){
  sbKind = kind || 'house';
  var b3 = (sbKind === 'bu3');
  openSheet('<div class="grab"></div><div class="k">순번 세우기</div>'
    + '<div class="st">' + (b3 ? '3부 시작 고르기' : '선발 고르기') + '</div>'
    + '<div class="sub">고른 사람의 <b>조 자리부터</b> 조를 돌며(4조 다음은 1조) '
    + (b3 ? '<b>3부</b>가 차례로 섭니다. 3부 배지를 단 사람끼리만 돕니다'
          : '1부와 2부가 차례로 섭니다') + '</div>'
    + '<div class="srch"><input id="sbQ" autocomplete="off" value="' + esc(sbQ)
    + '" placeholder="이름으로 찾기"></div>'
    + '<div class="lst inswap" id="sbOut"></div>'
    + '<button class="close" data-act="close">닫기</button>', 'seonbal', {});
  drawSeonbalPick();
  var qe = $('sbQ');
  if (qe) qe.addEventListener('input', function(){ sbQ = qe.value; drawSeonbalPick(); });
}
function drawSeonbalPick(){
  var q = (sbQ || '').trim(), b3 = (sbKind === 'bu3');
  var now = b3 ? bu3Start() : seonbal(), pool = lineupPool(sbKind), out = '';
  for (var g = 0; g < JOCNT; g++){
    var rows = '', c = 0;
    pool.forEach(function(n){
      if (joOf(n) !== g) return;
      if (q && n.indexOf(q) < 0) return;
      c++;
      var where = '';
      DAY.forEach(function(p){
        if (where) return;
        var ix = active(p).map(function(r){ return r.n; }).indexOf(n);
        if (ix >= 0) where = p.name + ' ' + (ix + 1) + '번';
      });
      rows += '<button class="row" data-sb="' + esc(n) + '">'
        + '<span class="p">' + (n === now ? '✓' : '') + '</span>'
        + '<span class="nm">' + esc(n) + '</span>'
        + '<span class="wh">' + esc(where || '오늘 자리 없음') + '</span></button>';
    });
    if (c) out += '<div class="hd2">' + esc(JOLABEL[g] || (g + 1) + '조') + ' · ' + c + '명</div>' + rows;
  }
  $('sbOut').innerHTML = out || '<div class="empty">'
    + (q ? esc(q) + ' — 후보에 없습니다' : '고를 수 있는 사람이 없습니다') + '</div>';
}
// 세우기 전에 무엇이 바뀌는지 먼저 보여 준다 — 자리를 통째로 흔드는 일이다
function openLineupPreview(pks){
  pks = pks || ['1', '2'];
  var b3 = (pks.length === 1 && pks[0] === '3');
  var sb = b3 ? bu3Start() : seonbal();
  if (!sb) { toast(b3 ? '3부 시작을 먼저 고르십시오' : '선발을 먼저 고르십시오'); return; }
  var plan = lineupPlan(sb, pks);
  if (!plan) { toast('조 편성이 없어 순번을 못 세웁니다'); return; }
  var chg = plan.slots.filter(function(x){ return x.from !== x.to; });
  var rows = chg.slice(0, 40).map(function(x){
    return '<div class="pr"><span class="pw">' + esc(part(x.pk).name) + ' ' + (x.i + 1) + '번</span>'
      + '<span class="pa">' + esc(x.from) + '</span><span class="par">→</span>'
      + '<span class="pb">' + esc(x.to) + '</span></div>'; }).join('');
  openSheet('<div class="grab"></div><div class="k">'
    + (b3 ? '3부 시작 ' : '선발 ') + esc(sb) + '</div>'
    + '<div class="st">' + (b3 ? '3부 순번 세우기' : '순번 세우기') + '</div>'
    + '<div class="sub">세우는 자리 ' + plan.slots.length + '개 중 <b>' + chg.length + '개</b>가 바뀝니다 · '
    + '배지가 붙은 ' + plan.fixed.map(function(f){ return part(f.pk).name + ' ' + f.n; }).join('·')
    + '자리는 그대로 둡니다</div>'
    + (chg.length
        ? '<div class="plan">' + rows
          + (chg.length > 40 ? '<div class="pr"><span class="pw"></span>그 밖 '
              + (chg.length - 40) + '자리</div>' : '') + '</div>'
        : '<div class="empty">이미 그 차례대로 서 있습니다</div>')
    + '<div class="calmbox">세운 뒤에 손볼 수 있습니다. 이건 <b>정답이 아니라 출발점</b>입니다 — '
    + '되돌리기를 누르면 그대로 돌아옵니다.</div>'
    + '<div class="acts two" style="margin:15px 14px 0">'
    + '<button data-act="lnyes" class="go"' + (chg.length ? '' : ' disabled') + '>이대로 세웁니다</button>'
    + '<button data-act="close">그만두기</button></div>', 'lineup', { pks: pks });
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
  openSheet('<div class="grab"></div>'
    + '<div class="k">' + esc(DATE) + ' → ' + esc(c.date) + '</div>'
    + '<div class="st">내일 준비</div>'
    + '<div class="sub">아래 <b>캐디 상태를 먼저 확인</b>하십시오. '
    + '내일 달라질 사람은 넘긴 뒤에 고치고 <b>순번 세우기</b>를 다시 누르셔도 됩니다.</div>'
    + carryOptsHTML(c)
    + '<div class="grp"><h4>오늘 상태</h4><div class="crl">'
    + carryLines(c).map(function(x){
        return '<div class="cr"><span class="ck">' + esc(x[0]) + '</span>'
          + '<span class="cv">' + esc(x[1]) + '</span></div>'; }).join('') + '</div></div>'
    + '<div class="calmbox"><b>언제든 이전으로 되돌릴 수 있습니다.</b> '
    + '아래 <b>되돌리기</b>를 누르면 넘기기 직전으로 돌아갑니다. '
    + '저장을 누르기 전이라면 새로고침만 해도 됩니다.</div>'
    + '<div class="acts two" style="margin:15px 14px 0">'
    + '<button data-act="ndayyes" class="go">내일로 넘깁니다</button>'
    + '<button data-act="close">먼저 고치겠습니다</button></div>', 'nday', {});
}

// 날짜 — 하루에 한 칸이니, 다른 날로 건너갈 수 있어야 한다
function openDayPick(){
  var list = dayList(), cur0 = DATE;
  var rows = list.map(function(d){
    return '<button class="row" data-daygo="' + esc(d.date) + '">'
      + '<span class="p">' + (d.date === cur0 ? '✓' : '') + '</span>'
      + '<span class="nm">' + esc(d.date) + '</span>'
      + '<span class="wh">' + (d.at ? d.at + ' 저장' : '') + '</span></button>'; }).join('');
  var here = list.some(function(d){ return d.date === cur0; });
  openSheet('<div class="grab"></div><div class="k">배치표</div>'
    + '<div class="st">날짜 고르기</div>'
    + '<div class="sub">날마다 <b>따로 저장</b>됩니다. 건너가면 지금 것은 <b>오늘 칸에 두고</b> 갑니다 '
    + '— 내일을 짜도 오늘이 안 지워집니다.</div>'
    + (here ? '' : '<div class="dnote" style="margin:0 14px">지금 보고 있는 <b>' + esc(cur0)
        + '</b>은 아직 저장 전입니다.</div>')
    + '<div class="lst">' + (rows || '<div class="dnote">저장된 날이 없습니다.</div>') + '</div>'
    + '<div class="acts" style="margin:12px 14px 0">'
    + '<button data-act="nday">' + esc(nextDateLabel(DATE)) + ' 만들기</button>'
    + '<button data-act="wipemk" class="warn">이 날의 구분 비우기</button></div>'
    + '<div class="dnote">비우기는 <b>그날의 배치</b>를 지웁니다 — 구분(중복 근무·조출·후출)과 '
    + '<b>두 부에 겹쳐 선 자리</b>. 근태·선발·당번·3부반 소속은 그대로 둡니다.</div>'
    + '<button class="close" data-act="close">닫기</button>', 'daypick', {});
}
// 안 누르고 닫은 고침 — 켤 때 한 번 묻는다. 아직 아무것도 안 덮었다
function openPending(){
  if (!PENDING) return;
  openSheet('<div class="grab"></div><div class="k">' + esc(DATE) + '</div>'
    + '<div class="st">저장하지 않고 닫으셨습니다</div>'
    + '<div class="sub"><b>' + esc(PENDING.at) + '</b>까지 고친 것이 남아 있습니다. '
    + '저장본은 아직 그대로입니다 — 이어서 하시겠습니까?</div>'
    + '<div class="acts two" style="margin:15px 14px 0">'
    + '<button data-act="drfyes" class="go">이어서 하기</button>'
    + '<button data-act="drfno">저장본으로</button></div>', 'pending', {});
}

// 삼선 — 어느 화면을 볼지 고르는 곳. 지금 어디 있는지도 여기서 보인다
function openMenu(){
  var T = workTally();
  var h = '<div class="grab"></div>'
    + '<div class="k">' + esc(DATE) + '</div>'
    + '<div class="st">어느 화면을 볼까요</div>'
    + '<div class="menu">'
    + '<div class="mh">배치표</div>'
    + DAY.map(function(p){
        var g = gridTimes(p);
        return '<button class="mrow' + (VIEW === 'board' && p.key === cur ? ' on' : '')
          + '" data-goto="' + p.key + '"><span class="mn">' + esc(p.name) + '</span>'
          + '<span class="mm">' + p.tees.length + '팀 · ' + g[0] + '~' + g[g.length - 1] + '</span>'
          + '<span class="mk"></span></button>'; }).join('')
    + '<div class="mh">근무</div>'
    + '<button class="mrow' + (VIEW === 'work' ? ' on' : '') + '" data-goto="work">'
    + '<span class="mn">근무표</span><span class="mm">' + T.total + '명 · 근무 ' + T.cw
    + ' · 대기 ' + T.cd + '</span><span class="mk"></span></button>'
    + '<button class="mrow' + (VIEW === 'duty' ? ' on' : '') + '" data-goto="duty">'
    + '<span class="mn">당번</span><span class="mm">' + esc(dutySummary()) + '</span>'
    + '<span class="mk"></span></button>'
    + '</div><button class="close" data-act="close">닫기</button>';
  openSheet(h, 'menu', {});
}

// 당번 종류를 새로 만든다. 기본 시간표까지 여기서 정한다 —
// 넣을 때 정해 두면 사람을 세울 때마다 시각을 다시 칠 일이 없다
function dutyFields(nm, t, h){
  return '<div class="grp"><h4>이름</h4>'
    + '<div class="fld"><input id="dtName" autocomplete="off" value="' + esc(nm || '')
    + '" placeholder="예 · 그늘집 당번"></div>'
    + '<div class="dnote">이름 끝에 <b>당번</b>을 붙여도 됩니다.</div></div>'
    + '<div class="grp"><h4>기본 시간표</h4>'
    + '<div class="fld">' + timeInput('id="dtTime" class="tf"', t || '')
    + '<input id="dtHour" inputmode="decimal" value="' + esc(h ? String(h) : '')
    + '" placeholder="시간 (예 5)"></div>'
    + '<div class="dnote">사람을 세울 때 이 시각으로 섭니다. '
    + '비워 두면 시각 없이 이름만 섭니다.</div></div>';
}
function openDutyNew(){
  openSheet('<div class="grab"></div><div class="k">그날의 역할</div>'
    + '<div class="st">당번 종류 만들기</div>'
    + '<div class="sub">종류는 <b>저장을 안 눌러도</b> 곧바로 다른 화면에 넘어갑니다</div>'
    + dutyFields('', '', 0)
    + '<div class="acts" style="margin:15px 14px 0"><button data-act="dtmake" class="go">만듭니다</button>'
    + '<button data-act="close">그만두기</button></div>'
    + '<button class="close" data-act="close">닫기</button>', 'dutynew', {});
  setTimeout(function(){ var e = $('dtName'); if (e) e.focus(); }, 260);
}
function openDutyEdit(k){
  var d = defOf(k), who = dutyList(k);
  openSheet('<div class="grab"></div><div class="k">' + esc(k) + '</div>'
    + '<div class="st">종류 고치기</div>'
    + '<div class="sub">' + (who.length ? '지금 ' + who.length + '명이 서 있습니다' : '지금 아무도 없습니다') + '</div>'
    + dutyFields(k, d.t, d.h)
    + '<div class="acts" style="margin:15px 14px 0"><button data-act="dtsave" class="go">고칩니다</button>'
    + '<button data-act="dtdel" class="warn">종류 지우기</button></div>'
    + '<button class="close" data-act="close">닫기</button>', 'dutyedit', { dkey: k });
}
// 종류를 지우면 거기 선 사람도 같이 사라진다 — 한 번 더 묻는다
function confirmDelDuty(k){
  if (DUTYKEYS.length <= 1) { toast('당번 종류는 하나는 있어야 합니다'); return; }
  var who = dutyList(k);
  openSheet('<div class="grab"></div><div class="k">확인</div>'
    + '<div class="st">' + esc(k) + ' 종류를 지웁니다</div>'
    + '<div class="warnbox"><b>이 종류가 없어집니다.</b>'
    + (who.length ? '<br>지금 서 있는 ' + who.length + '명(' + esc(who.map(function(x){ return x.n; }).join(', '))
        + ')도 이 자리에서 빠집니다.' : '') + '</div>'
    + '<div class="calmbox">잘못 눌러도 <b>바로 되살릴 수 있습니다.</b> '
    + '아래 <b>되돌리기</b>를 누르면 지우기 직전으로 돌아갑니다.</div>'
    + '<div class="acts two" style="margin:15px 14px 0">'
    + '<button data-act="dtdelyes" class="warn">지웁니다</button>'
    + '<button data-act="close">그만두기</button></div>', 'dutydel', { dkey: k });
}

// 찾기 — 오늘 이 사람이 어디 있나
function openFind(){
  openSheet('<div class="grab"></div>'
    + '<div class="k">오늘</div><div class="st">이름 찾기</div>'
    + '<div class="srch"><input id="fdQ" autocomplete="off" placeholder="이름 두 글자만 쳐도 됩니다"></div>'
    + '<div class="lst" id="fdOut"></div>'
    + '<button class="close" data-act="close">닫기</button>', 'find', {});
  drawFind('');
  var q = $('fdQ');
  q.addEventListener('input', function(){ drawFind(q.value); });
  setTimeout(function(){ q.focus(); }, 260);
}
function drawFind(q){
  q = (q || '').trim();
  var out = '';
  if (!q){
    out = '<div class="empty">이름을 치면 오늘 어느 부 몇 번인지 찾아 줍니다</div>';
  } else {
    var hit = 0;
    DAY.forEach(function(p){
      active(p).forEach(function(r, i){
        if (r.n.indexOf(q) < 0) return;
        hit++;
        var t = p.tees[i];
        out += '<button class="row" data-jump="' + p.key + '|' + i + '">'
          + '<span class="p num">' + (i + 1) + '</span>'
          + '<span class="nm">' + esc(r.n) + '</span>'
          + '<span class="wh">' + esc(p.name) + ' · ' + (t ? t.time + ' ' + esc(cname(t.course)) : '대기')
          + '</span></button>';
      });
    });
    OFFDUTY.forEach(function(n){
      if (n.indexOf(q) < 0) return;
      hit++;
      out += '<button class="row off" data-who="' + esc(n) + '"><span class="p">—</span>'
        + '<span class="nm">' + esc(n) + '</span><span class="wh">' + esc(absOf(n)) + '</span></button>';
    });
    if (!hit) out = '<div class="empty">' + esc(q) + ' — 오늘 명단에 없습니다</div>';
  }
  $('fdOut').innerHTML = out;
}
function jumpTo(pk, i){
  cur = pk; VIEW = 'board';
  closeSheet();
  paint();
  setTimeout(function(){
    var el = document.querySelector('.cell[data-pk="' + pk + '"][data-i="' + i + '"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('pick');
    setTimeout(function(){ el.classList.remove('pick'); }, 1400);
  }, 30);
}
// 명단 줄번호(ri)로 온 자리를 근무 순번(i)으로 바꿔 그리로 간다
function jumpSeat(pk, ri){
  var p = part(pk), r = p.roster[ri];
  if (!r || r.off) { cur = pk; VIEW = 'board'; closeSheet(); paint();
    toast(r ? r.n + '은(는) ' + p.name + ' 결근입니다' : '없는 자리입니다'); return; }
  jumpTo(pk, active(p).indexOf(r));
}

// ── 손 ──────────────────────────────────────
$('ptabs').addEventListener('click', function(e){
  var b = e.target.closest('button');
  if (!b) return;
  var wf = b.getAttribute('data-wfil');
  if (wf !== null) { wkFil = wf; $('main').scrollTop = 0; paint(); return; }
  var pk = b.getAttribute('data-part');
  if (!pk) return;
  if (pk !== cur) $('main').scrollTop = 0;
  cur = pk;
  try { localStorage.setItem('board.cur', pk); } catch (e2) {}
  paint();
});
$('btnMenu').addEventListener('click', openMenu);
$('pad').addEventListener('input', function(e){
  if (!e.target || e.target.id !== 'wkQ') return;
  wkQ = e.target.value;
  drawWkList();                       // ★칸은 그대로 두고 목록만 — 한글 조합이 안 깨지게
});
$('pad').addEventListener('click', function(e){
  if (dgBlock) return;              // 방금 끌어서 놓은 것이다 — 창까지 열지는 않는다
  // ── 근무표 쪽 ──
  if (e.target.closest('[data-act="dtnew"]')) { openDutyNew(); return; }
  var dk = e.target.closest('[data-duty]');
  if (dk) { openDutyPick(dk.getAttribute('data-duty')); return; }
  if (e.target.closest('[data-act="wipemk"]')) { closeSheet(); wipeDayMarks(); paint(); return; }
  if (e.target.closest('[data-act="wkqx"]')) { wkQ = ''; paint(); return; }
  if (e.target.closest('[data-act="cgtseen"]')) { caughtSeen(); paint(); return; }
  if (e.target.closest('[data-act="daypick"]')) { openDayPick(); return; }
  if (e.target.closest('[data-act="dfkeep"]'))  { driftKeep(); paint(); return; }
  if (e.target.closest('[data-act="dfgo"]')){
    var ds = driftStart();
    if (!ds) toast('시작할 사람이 없습니다');
    else { applyLineup(ds, driftPks()); paint(); }
    return;
  }
  if (e.target.closest('[data-act="nday"]'))    { openCarry(); return; }
  // ★배치표 밑의 '+ 대기에 넣기' — 대기 맨 뒤에 순번을 하나 만든다
  var padd0 = e.target.closest('[data-act="padd"]');
  if (padd0) { openAddPerson(padd0.getAttribute('data-pk') || cur); return; }
  if (e.target.closest('[data-act="lnpick"]'))  { openSeonbalPick('house'); return; }
  if (e.target.closest('[data-act="ln3pick"]')) { openSeonbalPick('bu3'); return; }
  if (e.target.closest('[data-act="lnrun"]'))   { openLineupPreview(['1', '2']); return; }
  if (e.target.closest('[data-act="ln3run"]'))  { openLineupPreview(['3']); return; }
  var bk = e.target.closest('[data-bulk]');
  if (bk){
    var bkt = bk.getAttribute('data-bulk');
    if (bulkOn() && bulkTag() === bkt) openBulkOff();   // 켜진 것을 또 누르면 끄기다
    else bulkStart(bkt);
    return;
  }
  var wo = e.target.closest('[data-who]');
  // ★켜 놓았으면 창을 열지 않는다 — 이름을 누르는 것이 곧 지정이다
  if (wo) { var wn = wo.getAttribute('data-who');
    if (bulkOn()) bulkTap(wn); else openPerson(wn); return; }

  // ── 배치표 쪽 ──
  var ad = e.target.closest('[data-addteam]');
  if (ad) { openAddTeam(ad.getAttribute('data-addteam')); return; }
  var sl = e.target.closest('[data-slot]');
  if (sl){
    if (pickList.length) { toast('팀을 넣는 자리입니다 — 사람 칸이나 빈 칸을 누르십시오'); return; }
    var v = sl.getAttribute('data-slot').split('|');
    addTeam(cur, v[0], v[1]);
    return;
  }
  var tt = e.target.closest('[data-tee]');
  if (tt){
    var tv = tt.getAttribute('data-tee').split('|');
    openTeeTime(tv[0], Number(tv[1])); return;
  }
  var c = e.target.closest('.cell[data-pk]');
  if (!c) return;
  var pk = c.getAttribute('data-pk'), i = Number(c.getAttribute('data-i'));
  if (pickList.length) pickTap(pk, i); else openCell(pk, i);
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
$('pickbar').addEventListener('click', function(e){
  if (e.target.closest('[data-act="pickoff"]')) { pickOff(); return; }
  if (e.target.closest('[data-act="pickgo"]')) pickGo();
});
$('tbRoster').addEventListener('click', function(){
  // 단추에 적힌 대로 한다 — 배치표 밖이면 돌아가고, 배치표면 명단을 연다
  if (VIEW !== 'board') setView('board'); else openRoster();
});
$('tbFind').addEventListener('click', openFind);
$('tbUndo').addEventListener('click', undo);
$('tbSave').addEventListener('click', daySave);
$('scrim').addEventListener('click', closeSheet);

$('sheet').addEventListener('click', function(e){
  var b = e.target.closest('button');
  if (!b) return;

  var bkd = b.getAttribute('data-bkdo');
  if (bkd){
    if (bkd.charAt(0) === 'p'){                    // ★부 지정 — 배치표는 안 건드린다
      bulkApplyPlan(bkd.slice(2), bkd.charAt(1) === '+');
      paint(); openBulkAct(); return;
    }
    if (bkd.charAt(0) === 't') bulkApplyTag(bkd.slice(2));
    else bulkApplyPart(bkd.slice(1), bkd.charAt(0) === '+');
    openBulkAct(); return;
  }
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
  var insn = b.getAttribute('data-insn');
  if (insn && sheetFor){ insertAt(sheetFor.pk, sheetFor.i, insn); closeSheet(); paint(); return; }
  if (b.getAttribute('data-act') === 'ins' && sheetFor){
    insQ = ''; openInsert(sheetFor.pk, sheetFor.i); return;
  }
  var dt = b.getAttribute('data-dtoggle');
  if (dt){
    var ix = dt.indexOf('|');
    dutyToggle(dt.slice(0, ix), dt.slice(ix + 1));
    openDutyPick(dt.slice(0, ix));
    return;
  }
  var cop = b.getAttribute('data-copt');
  if (cop){ setCarryOpt(cop, !carryOpt(cop)); openCarry(); return; }
  if (b.getAttribute('data-act') === 'ndayyes'){
    closeSheet(); carryToNextDay(); paint();
    toast('내일로 넘겼습니다 · 되돌리려면 아래 되돌리기');
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
    closeSheet();
    applyLineup(sb2, pks2); paint(); return;
  }
  var gt = b.getAttribute('data-goto');
  if (gt){
    closeSheet();
    if (gt === 'work' || gt === 'duty') { setView(gt); return; }
    var same = (VIEW === 'board' && cur === gt);
    VIEW = 'board'; cur = gt;
    if (!same) $('main').scrollTop = 0;
    try { localStorage.setItem('board.cur', gt); localStorage.setItem('board.mview', 'board'); } catch (e2) {}
    paint();
    return;
  }
  // 목록에서 고른 것
  var jp = b.getAttribute('data-jump');
  if (jp) { var j = jp.split('|'); jumpTo(j[0], Number(j[1])); return; }
  var gs = b.getAttribute('data-goseat');
  if (gs) { var g = gs.split('|'); jumpSeat(g[0], Number(g[1])); return; }
  var wo = b.getAttribute('data-who');
  if (wo){
    openPerson(wo); return;
  }
  if (b.getAttribute('data-ttr') && sheetFor){
    teeRest = !teeRest; openTeeTime(sheetFor.pk, sheetFor.i); return;
  }
  if (b.getAttribute('data-act') === 'bkyes'){ closeSheet(); bulkReset(); return; }
  var cact = b.getAttribute('data-act'), cwho = sheetFor && sheetFor.person;
  if (cact === 'cartsave' && cwho){
    setCartToday(cwho, $('cartN') ? $('cartN').value : 0); openPerson(cwho); return;
  }
  if (cact === 'cartmine' && cwho){ setCartToday(cwho, ownCart(cwho)); openPerson(cwho); return; }
  if (cact === 'cartown' && cwho){
    setCart(cwho, $('cartOwnN') ? $('cartOwnN').value : 0); openPerson(cwho); return;
  }
  if (cact === 'cartpick' && cwho){ openCartPick(cwho); return; }
  if ((cact === 'cartbad' || cact === 'cartok') && cwho){
    setCartBad(cartOf(cwho), cact === 'cartbad'); openPerson(cwho); return;
  }
  var cno = b.getAttribute('data-cartno');
  if (cno && sheetFor && sheetFor.person){
    var cpn = sheetFor.person;
    setCartToday(cpn, cno); openPerson(cpn); return;
  }
  // ★시트 안 단추는 시트 듣개가 받는다 — #pad 듣개는 시트에 안 닿는다
  if (b.getAttribute('data-act') === 'wipemk'){ closeSheet(); wipeDayMarks(); paint(); return; }
  if (b.getAttribute('data-act') === 'nday'){ openCarry(); return; }
  if (b.getAttribute('data-act') === 'drfyes'){ closeSheet(); draftResume(); return; }
  if (b.getAttribute('data-act') === 'drfno'){ closeSheet(); draftDiscard(); return; }
  var dg2 = b.getAttribute('data-daygo');
  if (dg2){ closeSheet(); daySwitch(dg2); return; }
  var b3v = b.getAttribute('data-bu3');
  if (b3v !== null && sheetFor && sheetFor.person){
    setBu3(sheetFor.person, b3v === '1'); openPerson(sheetFor.person); return;
  }
  var dtg = b.getAttribute('data-dtag');
  if (dtg !== null){
    var dwho = (sheetFor && sheetFor.person) || (sheetFor && sheetFor.pk !== undefined
      && active(part(sheetFor.pk))[sheetFor.i] ? active(part(sheetFor.pk))[sheetFor.i].n : '');
    if (!dwho) return;
    setDayTag(dwho, dtg);
    if (sheetFor.person) openPerson(dwho); else openCell(sheetFor.pk, sheetFor.i);
    return;
  }
  // ★부 지정 — 배치표는 안 건드린다
  var pln = b.getAttribute('data-pln');
  if (pln && sheetFor.person){
    setPlan(sheetFor.person, pln, !inPlan(sheetFor.person, pln));
    paint(); openPerson(sheetFor.person); return;
  }
  var prm = b.getAttribute('data-prm');
  if (prm) { delFromPart(prm, sheetFor.person); openPerson(sheetFor.person); return; }
  var padd = b.getAttribute('data-padd');
  if (padd){
    var pn = b.getAttribute('data-pn');
    var who = pn || (sheetFor && sheetFor.person);
    if (!who) return;
    addRow(padd, who);
    // ★창은 닫지 않는다 — 한 사람을 여러 부에, 한 부에 여러 사람을 잇달아 넣는 일이다
    if (pn) drawAddPerson(); else openPerson(who);
    return;
  }
  if (b.getAttribute('data-act') === 'padd'){
    openAddPerson(b.getAttribute('data-pk') || cur); return;
  }
  var ab = b.getAttribute('data-abs');
  if (ab !== null && sheetFor && sheetFor.person) { setAbsent(sheetFor.person, ab); openPerson(sheetFor.person); return; }
  var swo = b.getAttribute('data-swapoff');
  if (swo && sheetFor){
    var spk = sheetFor.pk, sri = riOf(spk, sheetFor.i);
    var srow = sri >= 0 ? part(spk).roster[sri] : null;
    // ★빈 칸이면 앉히는 것이다 — 내줄 상대가 없으니 맞바꿀 수 없다
    if (!srow || !srow.n) seatPerson(spk, sheetFor.i, swo);
    else swapRef({ pk: spk, ri: sri }, { offName: swo });
    closeSheet(); paint(); return;
  }
  var sw = b.getAttribute('data-swapto');
  if (sw && sheetFor){
    var s = sw.split('|'), me = { pk: sheetFor.pk, ri: riOf(sheetFor.pk, sheetFor.i) };
    closeSheet();
    rotateSeats([me, { pk: s[0], ri: Number(s[1]) }]);
    paint();
    return;
  }
  var or = b.getAttribute('data-offri');
  if (or !== null && or !== undefined && sheetKind === 'roster'){
    setOff(cur, Number(or), false);
    openRoster();
    return;
  }
  if (sheetKind === 'roster' && b.hasAttribute('data-pk')){
    openCell(b.getAttribute('data-pk'), Number(b.getAttribute('data-i')));
    return;
  }

  var act = b.getAttribute('data-act');
  if (!act) return;
  if (act === 'close') { closeSheet(); return; }
  if (!sheetFor) return;
  if (act === 'dtnew') { openDutyNew(); return; }
  if (act === 'dtmake'){
    if (dtAddWith($('dtName').value, readTime($('dtTime')), $('dtHour').value)) closeSheet();
    return;
  }
  if (act === 'dtedit') { openDutyEdit(sheetFor.dkey); return; }
  if (act === 'dtsave'){
    if (dtEdit(sheetFor.dkey, $('dtName').value, readTime($('dtTime')), $('dtHour').value)) closeSheet();
    return;
  }
  if (act === 'dtdel') { confirmDelDuty(sheetFor.dkey); return; }
  if (act === 'dtdelyes'){ var dkk = sheetFor.dkey; closeSheet(); dtDel(dkk); return; }
  var pk = sheetFor.pk, i = sheetFor.i;
  if (pk == null) return;

  if (act === 'pick') { pickStart(pk, i); return; }
  if (act === 'name') { setName(pk, i, ($('shName').value || '').trim()); closeSheet(); return; }
  if (act === 'off')  { setOff(pk, riOf(pk, i), true); closeSheet(); return; }
  if (act === 'seatclr'){ clearSeat(pk, i); closeSheet(); paint(); return; }
  if (act === 'prmhere'){
    // 뺀 뒤에는 그 칸에 다른 사람이 올라온다 — 창을 열어 두면 딴 사람 이야기가 된다
    var rr = active(part(pk))[i];
    closeSheet();
    if (rr) delFromPart(pk, rr.n);
    return;
  }
  if (act === 'time') { setTeeTime(pk, i, readTime($('shTime'))); closeSheet(); return; }
  if (act === 'course'){ setCourse(pk, i, b.getAttribute('data-v')); closeSheet(); return; }
  if (act === 'pax')  { setPax(pk, i, Number(b.getAttribute('data-v'))); openCell(pk, i); return; }
  if (act === 'cx')   { cancelTee(pk, i); closeSheet(); return; }
  if (act === 'delteam'){ delTeam(pk, i); closeSheet(); return; }
  if (act === 'itnon' || act === 'itnoff'){
    setIntern(pk, i, act === 'itnon' ? ($('itnName') ? $('itnName').value : '') : '', act === 'itnon');
    closeSheet(); paint(); return;
  }
  if (act === 'itnname'){
    setIntern(pk, i, $('itnName') ? $('itnName').value : '', true);
    closeSheet(); paint(); return;
  }
  if (act === 'ttsave'){
    var nv = readTime($('ttTime'));
    if (!nv) { toast('시각을 24시간으로 적어 주세요 (예: 13:00)'); return; }
    setTeeTime(pk, i, nv, teeRest); closeSheet(); return;
  }
  if (act === 'addteam'){ addTeam(pk, readTime($('adTime')) || hm(mm(part(pk).start)), b.getAttribute('data-v') || '');
    closeSheet(); return; }
});

// 뒤로가기로 창을 닫는다 — 폰에서 가장 자연스러운 닫기
window.addEventListener('popstate', function(){
  if ($('sheet').classList.contains('on')) closeSheet();
  else if (pickList.length) pickOff();
});

$('hDate').addEventListener('click', openDayPick);   // 날짜를 누르면 다른 날로

// ── 켜기 ────────────────────────────────────
// ★서버가 있으면 서버 것을 먼저 가져온 뒤에 켜다.
//   파일 하나로 열었을 때는 그 자리에서 곳바로 켜진다 — 시간차도 안 생긴다
srvBoot(function(){
  bootLoad();
  try {
    var c0 = localStorage.getItem('board.cur'); if (c0 && part(c0).key === c0) cur = c0;
    var v0 = localStorage.getItem('board.mview');
    if (v0 === 'work' || v0 === 'board' || v0 === 'duty') VIEW = v0;
  } catch (e) { /* 기본은 2부 배치표 */ }
  paint();
  if (PENDING) openPending();          // ★안 누르고 닫은 고침이 있으면 켜자마자 묻는다
});
