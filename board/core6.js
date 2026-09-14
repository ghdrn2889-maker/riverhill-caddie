// ══════════════════════════════════════════════════════════════
//  core — 그날의 사실과 그것을 고치는 손
//  화면이 없어도 돈다. 폰과 데스크톱이 이 파일을 함께 쓴다.
// ══════════════════════════════════════════════════════════════
// 실제 판독본 — 2026년 08월 30일 · 글 #27766
//__BOARD__

var $ = function(id){ return document.getElementById(id); };
function esc(s){ return String(s).split('&').join('&amp;').split('<').join('&lt;').split('"').join('&quot;'); }
function mm(s){ var a = String(s).split(':'); return Number(a[0]) * 60 + Number(a[1]); }
function hm(n){ var h = Math.floor(n / 60), m = n % 60; return h + ':' + (m < 10 ? '0' + m : m); }
function pad(s){ var a = String(s).split(':'); return (a[0].length < 2 ? '0' + a[0] : a[0]) + ':' + a[1]; }
// 시각은 24시간으로만 적는다. 브라우저가 주는 오전/오후 고르개는 배치표와 말이 안 맞아 쓰지 않는다.
// '7' '730' '7:3' '18:30' 무엇으로 쳐도 같은 자리로 간다
function hhmm(v){
  var d = String(v == null ? '' : v).replace(/[^\d:]/g, '');
  if (!d) return '';
  var h, m, i = d.indexOf(':');
  if (i >= 0){ h = Number(d.slice(0, i) || 0); m = Number(d.slice(i + 1).slice(0, 2) || 0); }
  else if (d.length <= 2){ h = Number(d); m = 0; }
  else { h = Number(d.slice(0, d.length - 2)); m = Number(d.slice(-2)); }
  if (!isFinite(h) || !isFinite(m)) return '';
  h = Math.max(0, Math.min(23, h));
  m = Math.max(0, Math.min(59, m));
  return h + ':' + (m < 10 ? '0' + m : m);
}
// 칸에서 읽으면서 칸의 글자도 같이 반듯하게 고쳐 놓는다
function readTime(el){
  if (!el) return '';
  var v = hhmm(el.value);
  el.value = v ? pad(v) : '';
  return v;
}
// 시각 칸 하나 — 온 프로그램이 같은 모양을 쓴다
function timeInput(attrs, val, extra){
  return '<input type="text" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="13:00" '
    + 'data-time="1" ' + attrs + ' value="' + esc(val ? pad(val) : '') + '"' + (extra || '') + '>';
}
// 어느 시각 칸이든 손을 떼는 순간 24시간 모양으로 다듬는다 — '645'라 쳐도 06:45로 보인다.
// 내려가는 길(capture)에서 먼저 다듬어야 뒤따르는 처리가 다듬어진 값을 읽는다
document.addEventListener('change', function(e){
  var el = e.target;
  if (el && el.hasAttribute && el.hasAttribute('data-time')) readTime(el);
}, true);

var GAP = 7;      // 티오프 간격
var ROWS = 19;    // 부마다 깔아두는 기본 격자 줄 수 — 세 부가 같은 길이로 선다
// ★대기(스페어) 한도 — 부마다 몇 명까지 세울지. 0이면 제한 없음.
//   순번 세우기가 남는 사람을 대기로 쏟을 때 이 수에서 끊는다.
//   1·2부는 차례가 한 바퀴 더 도는 판이라 이 수가 곧 '어디서 끊느냐'다
var SMAX = { '1': 0, '2': 0, '3': 0 };
function spareCap(pk){ return Math.max(0, Math.floor(Number(SMAX[pk]) || 0)); }
// ★사람은 '대기 5명'이 아니라 '29번까지'로 말한다 — 배치표에 찍힌 것이 번호다.
//   마지막 근무 순번 다음부터가 대기이니, 한도는 그 뒤로 몇 칸이냐일 뿐이다
function spareLastNo(p){
  var c = spareCap(p.key);
  return c ? workLastNo(p) + c : 0;
}
// 티오프가 있는 마지막 자리의 순번 — 대기는 그 다음 번호부터다
function workLastNo(p){
  var n = p.tees.length;
  if (!n) return 0;
  var a = active(p);
  if (a.length >= n) return seatNo(p, n - 1);
  var k = 0;
  for (var i = 0; i < a.length; i++) if (!a[i].itn) k++;
  return k + (n - a.length);
}
// '몇 번까지'를 한도(몇 칸)로 바꿔 넣는다. 0이면 제한 없음
function setSpareLastNo(p, no){
  no = Math.floor(Number(no) || 0);
  if (no <= 0) return 0;
  return Math.max(1, no - workLastNo(p));
}
// 지금 그 부에 서 있는 대기 사람 수 (빈 줄은 안 센다)
function spareNow(p){
  var a = active(p), c = 0;
  for (var i = p.tees.length; i < a.length; i++) if (a[i].n && !a[i].itn) c++;
  return c;
}
// 명단 한 줄 = 사람 하나. 티오프는 시각순으로 붙는다(결근은 건너뛴다)
var DAY = ['1','2','3'].map(function(p){
  return { key: p, name: p + '부', start: BOARD.parts[p].tees[0].time,
    roster: BOARD.parts[p].roster.map(function(raw){
      var a = raw.indexOf('('), nm = a < 0 ? raw : raw.slice(0, a);
      var tg = a < 0 ? '' : raw.slice(a + 1).replace(')', '');
      return { n: nm.trim(), tag: tg.trim(), off: false, role: '' };
    }),
    tees: BOARD.parts[p].tees.map(function(t){
      return { time: t.time, course: t.course, pax: 4, cx: false };
    }) };
});
// ★조편성표 실물(2026-08-30 본배치표 #27766) — 총원 82 · 가용 65 · 제외 17
//  판독이 아니라 그림을 그대로 옮긴 값이다. 조는 거의 고정이라 이게 기본값이 된다.
var JOFIX = [
  ['김홍구','김상미','전형준','성지현','안정희','김정미','강성일','안준우','이은지','박신훈','석정일',
   '장소희','홍준표','연승준','고하나','문태익','정용호','김주희','우겸조','윤형수','송민지'],
  ['정진영','최수원','김수룡','이승현','박상욱','구경은','강민순','이지은','김민찬','임태희','박하늘',
   '허웅진','신지현','홍아름','김희용','강아란','이수련','박시윤','서동명','박선하','고창민'],
  ['서동환','김수안','조예린','김동윤','한지홍','정유경','정용만','남재권','배문숙','양태록','곽호완',
   '김태리','박준서','장미화','권미영','김동우','장성원','정이슬','조하빈','류곤','박영순'],
  ['천예영','전호성','박태영','최수아','박진수','표승완','도대영','김서현','이하늘','심영운','강경순',
   '강혜영','차은경','김기선','김예원','정민철','우정민','박수현','오동현']
];
// 오늘 배치표(부 명단)에 없는 사람 = 제외인원. 조편성표에서 빼서 구한다
var OFFDUTY = (function(){
  var on = {};
  DAY.forEach(function(p){ p.roster.forEach(function(r){ on[r.n] = 1; }); });
  var out = [];
  JOFIX.forEach(function(list){ list.forEach(function(n){ if (!on[n]) out.push(n); }); });
  return out;
})();

// 오늘 경기과에서 일하는 사람 — 팀장은 거의 고정, 마샬은 날마다 바뀐다
var STAFF = [
  { k: '대리', sub: '', n: '류동기', fix: true,  t: '07:00' },
  { k: '주임', sub: '', n: '박정미', fix: false, t: '07:00' },
  { k: '마샬',     sub: '',     n: '우겸조', fix: false, t: '05:40' },
  { k: '마샬',     sub: '',     n: '허웅진', fix: false, t: '12:30' }
];
// ★마샬 딱지(조출·마감·중간)는 다 걷었다(2026-09-11).
//   보기용 글자였고 아무 데도 안 쓰였다 — 마샬에게 실제로 붙는 배지는
//   '배치'이고, 순번을 막는 것도 그쪽이다.
//   자리에 박아 둔 딱지(x.fixed)만 남긴다 — 경기과가 다시 쓰고 싶을 때의 길이다
function staffRole(i){
  var x = STAFF[i];
  return x.fixed ? { t: x.fixed, c: 'jc' } : null;
}
// ★저장된 옆 모습을 지금 모습으로 고쳐 준다 — 저장본에 STAFF 가
//   통째로 들어 있어, 안 고쳐 주면 어제 판을 열 때 '경기팀장'과 '정출'이 되살아난다
function migrateStaff(){
  if (!STAFF || !STAFF.forEach) return;
  STAFF.forEach(function(x){
    if (x.k === '경기팀장') { x.k = '대리'; x.sub = ''; }
    if (x.k === '주임') delete x.fixed;
  });
}
var MARSHALS = ['우겸조','허웅진','김수룡','도영학','전호성','표승완','신철'];
var DUTYCOLOR = {};
var DUTYKEYS = ['당번','벌당','흡연실 당번'];
// 한 자리 = { 이름, 시각 }. 같은 당번이라도 7시 서는 사람과 13시 서는 사람이 따로다
var DUTY = { '당번': [{ n: '정용호', t: '7:00' }], '벌당': [], '흡연실 당번': [] };
// 새로 넣을 때 딸려 오는 값 — 시작 시각과 근무 시간. 골프장마다 다르니 설정에서 고친다
// ★당번마다 성격이 다르다 — 시각·시간만으로는 못 담는다.
//   w='in'  순번에 같이 세운다. 그날 근무가 확정되는 당번이다(흡연실 당번).
//           시간에 안 묶이고, 순번 세우기가 자리를 준다. 당번 배지는 그대로 붙는다.
//   w='may' 상황 따라. 순번 세우기에서는 빼고, 적힌 시각만 묶는다 —
//           안 겹치는 라운드가 남아 있으면 아직 일할 수 있는 사람(미배치·가용)이다.
//   w='no'  그날 캐디 근무는 없다. 시각과 무관하게 하루를 잡는다.
//   ★여태는 이 셋이 '시각이 있나 없나' 하나로 뭉개져 있었다. 그래서 시각을 안 적는
//    흡연실 당번이 하루 종일 묶인 것으로 읽혀 근무에서 통째로 빠졌다 — 실제와 정반대였다.
var DUTYWORK = ['in', 'may', 'no'];
var DUTYWTX = { 'in': '순번에 같이', 'may': '상황 따라', 'no': '근무 안 함' };
var DUTYDEF = { '당번': { t: '7:00', h: 5, w: 'may' },
                '벌당': { t: '13:00', h: 5, w: 'may' },
                '흡연실 당번': { t: '', h: 0, w: 'in' } };
var wkFilter = '';

// 지정 카트 — 사람에게 붙는다. 없는 사람은 있는 사람 것을 빌려 탄다
var CART = {"김주희":1,"허웅진":2,"정용만":3,"전호성":4,"강성일":5,"정진영":6,"김상미":7,"전형준":8,"성지현":9,"안정희":10,"김정미":11,"안준우":12,"이은지":13,"박신훈":14,"심영운":15,"석정일":16,"장소희":17,"고하나":18,"문태익":19,"송민지":20,"최수원":21,"김동윤":22,"한지홍":23,"이승현":24,"박상욱":25,"구경은":26,"강민순":27,"이지은":28,"김서현":29,"신지현":30,"홍아름":31,"강아란":32,"고창민":33,"천예영":34,"김수안":35,"이수련":36,"장성원":37,"배문숙":38,"박수현":39,"박영순":40,"김태리":41,"정이슬":43,"양태록":45,"조하빈":46,"김동우":47,"강경순":48,"강혜영":49,"우정민":50,"우겸조":51,"조예린":52,"정민철":53,"차은경":54,"김민찬":55,"박태영":56,"김희용":57,"최수아":58,"표승완":59,"윤형수":61,"최재영":62,"정유경":63,"정용호":64,"박선하":66,"박시윤":67,"오동현":68,"김수룡":69,"서동명":70};

// ★조편성표 '근무' 칸 — 2026-08-30 본배치표(#27766) 실제 판독본이다
// ★그날 어느 부에서 근무하나 — 배치표 자리와는 다른 말이다.
//   자리는 '몇 번 티오프에 선다'이고, 이건 '오늘 이 부에서 일한다'이다.
//   둘을 한 곳에 담았더니 근무표에서 부만 골라도 배치표에 줄이 생겨 순번이 흔들렸다.
//   그래서 따로 담는다. 여기에 넣어도 배치표에는 아무 일도 안 일어난다
var PLAN = {};
function planOf(n){ var a = PLAN[n]; return (a && a.length) ? a.slice() : []; }
function inPlan(n, pk){ return planOf(n).indexOf(pk) >= 0; }
// 눈에 보이는 '오늘 어느 부' — 실제로 앉은 자리와 지정한 부를 합쳐서 본다.
// 앉았으면 그것이 사실이고, 안 앉았으면 지정이 예정이다
function partsPlanned(n){
  var out = partsOf(n);
  planOf(n).forEach(function(k){ if (out.indexOf(k) < 0) out.push(k); });
  return out.sort(function(a, b){ return pIdx(a) - pIdx(b); });
}
function planText(n){
  // ★중복 근무 배지가 이미 '몇 부를 뛰나'를 말하고 있으면 글씨로 또 적지 않는다.
  //   그래서 어떤 사람은 배지, 어떤 사람은 글씨가 되는 일이 없다
  if (dupText(partsPlanned(n))) return '';
  var a = planOf(n).filter(function(k){ return partsOf(n).indexOf(k) < 0; });
  if (!a.length) return '';
  a.sort(function(x, y){ return pIdx(x) - pIdx(y); });
  return a.map(function(k){ return part(k).name; }).join(',') + ' 예정';
}
function setPlan(n, pk, on){
  if (!n) return false;
  var a = planOf(n), i = a.indexOf(pk);
  if (on && i >= 0) return false;
  if (!on && i < 0) return false;
  var b = whereMap(); snap();
  if (on) a.push(pk); else a.splice(i, 1);
  if (a.length) PLAN[n] = a; else delete PLAN[n];
  commit(n + ' ' + part(pk).name + (on ? ' 근무로 지정' : ' 지정 뗌')
    + ' · 배치표 자리는 그대로입니다', b);
  return true;
}
// 부 차례 — 설정에서 부를 지우면 지정도 같이 지운다
function pIdx(pk){
  for (var i = 0; i < DAY.length; i++) if (DAY[i].key === pk) return i;
  return 99;
}
function clearPlan(){
  var n = 0;
  Object.keys(PLAN).forEach(function(k){ n += (PLAN[k] || []).length; delete PLAN[k]; });
  return n;
}
var TAG = {
  "김동우":"54h","조하빈":"54h","오동현":"54h","정진영":"54h",
  "홍준표":"2,3","연승준":"2,3","윤형수":"2,3","송민지":"2,3","이수련":"2,3","박시윤":"2,3","박수현":"2,3",
  "김홍구":"3부","최수원":"3부","서동환":"3부","김동윤":"3부","한지홍":"3부","남재권":"3부","양태록":"3부",
  "곽호완":"3부","박준서":"3부","류곤":"3부","장성원":"3부","임태희":"3부","박하늘":"3부","박진수":"3부",
  "도대영":"3부","김서현":"3부","이하늘":"3부","김기선":"3부","김예원":"3부",
  "이은지":"조출","장소희":"조출","강혜영":"조출","김희용":"선발","강아란":"후출",
  "정용호":"당번","우겸조":"배치","허웅진":"배치","김수룡":"프리","박선하":"프리","전호성":"프리",
  "성지현":"휴무","강성일":"휴무","박상욱":"휴무","구경은":"휴무","신지현":"휴무","배문숙":"휴무",
  "표승완":"휴무","심영운":"휴무","정민철":"휴무","강민순":"휴가","차은경":"병가"};
// 조편성표에 적힌 카트(명단 파일과 다르면 배치표가 정답이다)
var CARTFIX = {"김주희":1,"정용호":64,"우겸조":51,"윤형수":61,"송민지":20,"허웅진":2,"김수룡":69,
  "박선하":66,"이수련":36,"박시윤":67,"서동명":70,"고창민":33,"김희용":57,"강아란":32,"홍아름":31,
  "신지현":30,"김민찬":55,"이지은":28,"강민순":27,"구경은":26,"박상욱":25,"이승현":24,"최수원":21,
  "정진영":6,"김동우":47,"조하빈":46,"오동현":68,"장성원":37,"정이슬":43,"김태리":41,"양태록":45,
  "배문숙":38,"정용만":3,"정유경":63,"한지홍":22,"김동윤":23,"조예린":52,"김수안":35,"박영순":40,
  "천예영":34,"전호성":4,"박태영":56,"최수아":58,"표승완":59,"김서현":29,"심영운":15,"강경순":48,
  "강혜영":49,"차은경":54,"정민철":53,"우정민":50,"박수현":39};
Object.keys(CARTFIX).forEach(function(n){ CART[n] = CARTFIX[n]; });
// 고장 난 카트 — 사람이 아니라 카트 번호에 붙는다. 51번이 고장이면 51번을 타는 사람 모두에게 빨갛게 뜬다
var CARTBAD = {};
// ★CART 는 '주인 카트'다 — 날이 바뀌어도 안 풀린다.
//   LEND 는 '오늘 빌려 탄 카트' — 그날치라 날을 넘기면 지운다.
//   한 칸에 같이 쓰면 빌린 번호가 주인표를 영영 덮는다(실측: 내일까지 따라왔다)
var LEND = {};
function ownCart(n){ return CART[n] || 0; }        // 주인 카트
function lendOf(n){ return LEND[n] || 0; }         // 오늘 빌린 것
function isLent(n){ return !!LEND[n]; }
function cartOf(n){ return LEND[n] || CART[n] || 0; }   // 오늘 타는 카트
function cartBad(c){ return !!(c && CARTBAD[c]); }
function cartNum(v){ return Math.max(0, Math.min(999, Math.floor(Number(v) || 0))); }

// 아는 번호 전부 — 주인표에 있는 것과 오늘 빌린 것
function allCarts(){
  var s = {};
  Object.keys(CART).forEach(function(n){ if (CART[n]) s[CART[n]] = 1; });
  Object.keys(LEND).forEach(function(n){ if (LEND[n]) s[LEND[n]] = 1; });
  return Object.keys(s).map(Number).sort(function(a, b){ return a - b; });
}
function cartOwnerOf(c){
  var out = '';
  Object.keys(CART).forEach(function(n){ if (CART[n] === c && !out) out = n; });
  return out;
}
var ABSTYPES = ['휴무','휴가','병가'];
var OTHERTAGS = ['당번','벌당','배치','프리','정출','조출','후출','찾근','선발'];
// ★손으로 붙이고 떼는 구분. 나머지는 임자가 따로 있다 —
//   당번·벌당은 당번 기계가, 휴무·휴가·병가는 근태가, 선발은 선발 고르개가 넣는다.
var DAYTAGS = ['조출', '후출', '정출', '찾근', '배치', '프리'];
// ★3부반 = 소속이다. 하루짜리 배지(TAG)가 아니라 조 편성처럼 오래 가는 값이라
// 설정(cfg)에 넣는다 — 날을 넘겨도, 달력이 저절로 따라가도 안 풀린다.
// 처음에는 배치표가 '3부'라고 읽어 준 사람들로 채운다
// ★씨앗은 여기서 바로 심는다. 늦게 뽑으면 '그날의 구분 비우기'가 먼저 지워 버려
// 명부가 빈 채로 시작한다 — 한 번 비면 되살릴 길이 없다
var BU3SET = Object.keys(TAG).filter(function(n){ return TAG[n] === '3부'; });
function bu3List(){ return BU3SET || (BU3SET = []); }
function isBu3(n){ return bu3List().indexOf(n) >= 0; }
function setBu3(n, on){
  var was = isBu3(n);
  if (was === !!on) return false;
  var b = whereMap(); snap();
  var L = bu3List().slice();
  if (on) L.push(n); else L.splice(L.indexOf(n), 1);
  BU3SET = L;
  if (!on && TAG[n] === '3부') delete TAG[n];    // 소속을 풀면 옛 배지도 같이 뗀다
  // ★설정을 못 적으면 새로고침하는 순간 사라진다 — 조용히 넘어가면 안 된다
  var ok = cfgSave();
  attTouch(['1', '2', '3']);
  commit(n + (on ? ' 3부반으로 지정' : ' 3부반에서 풂')
    + (on ? ' · 1·2부 순번에 안 섭니다' : ' · 이제 하우스 캐디입니다')
    + (ok ? '' : ' · 이 브라우저가 설정 저장을 막고 있습니다 — 새로고침하면 사라집니다'), b);
  return true;
}
// ★'3부' 배지는 3부반에서만 나온다 — 배지가 붙어 있는데 명부에 없으면
//   명부 쪽이 지워진 것이다. 소속을 도로 채운다. 반대로는 안 한다 —
//   명부에 있는데 오늘 배지가 없는 것은 흔한 일이다(그날 안 나온 사람)
function reconcileBu3(){
  var add = [];
  Object.keys(TAG).forEach(function(n){
    if (TAG[n] === '3부' && !isBu3(n)) add.push(n);
  });
  if (!add.length) return [];
  BU3SET = bu3List().concat(add);
  cfgSave();
  return add;
}
// ★중복 근무 표시(54h·2,3)는 '몇 부를 뛰는가'를 말한다 — 자리가 그 말을 못 받치면 거짓말이다.
// 어제 것이 저장본에 남아 '어느 부에도 없는데 2,3' 같은 줄이 생겼다.
// 그래서 자리와 안 맞는 중복 표시는 조용히 뗀다. 붙이지는 않는다 —
// 붙이기 시작하면 순번 세우기가 만든 중복이 다음 번에 얼어붙는다
function isDupTag(t){
  t = String(t || '');
  return t === '54' || t === '54h' || /^\d\s*(,\s*\d)+$/.test(t);
}
// ★중복 근무 표시의 이름은 여기서만 짓는다.
//   리버힐 말로 한 부가 18홀이라, 세 부를 다 뛰면 54홀 — 그냥 '54'다.
//   두 부면 그 두 부를 적는다(1,3 · 2,3). 한 부면 중복이 아니라 표시가 없다.
// ★'1,2' 는 없다. 1·2부에 이름이 겹치는 것은 지정이 아니라 차례가 한 바퀴 돈 자국이다 —
//   2부에 팀 수보다 사람이 모자라면 2부 마지막 다음에 다시 첫 순번부터 이어 붙는다.
//   그걸 배지로 달면 '이 사람은 1·2부 확정'이라는 거짓말이 된다
var DUPGONE = ['1,2'];
// ★손으로 만든 중복 근무에 박는 못. 이름표(배지)와 따로 산다 —
//   1·2부처럼 이름표가 없는 짝도 못은 박혀야 하기 때문이다.
//   못이 박힌 사람은 순번 세우기가 안 건드린다(자리도, 차례도)
var DUPPIN = {};
function dupPinned(n){ return !!DUPPIN[n]; }
// 못에 뭐라 적을까 — 이름표가 있으면 그것, 없으면 자리 그대로('1부·2부')
function dupPinText(n){
  return dupNow(n) || partsOf(n).map(function(k){ return part(k).name; }).join('\u00b7');
}
// ★못을 박은 까닭을 한마디로.
//   1부·2부는 중복 근무가 아니라 그냥 두 자리다 — 차례가 한 바퀴 더 돈 것뿐이다.
//   그걸 '중복 근무'라 부르면 진짜 중복(2,3 · 54)과 같은 무게로 읽힌다
function dupPinWhy(n){
  var t = dupNow(n);
  return t ? t + ' 중복 근무로 못 박습니다'
           : dupPinText(n) + ' 두 자리를 못 박습니다';
}
function dupText(ks){
  if (!ks || ks.length < 2) return '';
  if (ks.length >= 3) return '54';
  var t = ks.slice().sort(function(a, b){ return pIdx(a) - pIdx(b); }).join(',');
  return DUPGONE.indexOf(t) >= 0 ? '' : t;
}
// 저장본에 남아 있는, 이제는 없는 표시. 조용히 걷어 낸다
function goneDup(t){ return DUPGONE.indexOf(String(t || '')) >= 0; }
// ★'몇 부를 뛰나'는 앉은 자리와 근무표에서 지정한 부를 합쳐서 본다.
//   자리만 보면 '아직 안 앉힌 54홀'이 표시를 못 받는다 — 그게 지정하는 까닭인데도
function dupNow(n){ return dupText(partsPlanned(n)); }
// ★칸의 꼬리표를 사람의 배지에 맞춘다 — '그날의 구분'만 건드린다.
//   중복 표시(54h·2,3)와 소속(3부)은 다른 기계가 본다. 여기서 손대면 둘이 싸운다
function syncRowTags(){
  var n = 0;
  DAY.forEach(function(p){
    p.roster.forEach(function(r){
      if (!r.n || r.itn) return;
      var want = dayMark(r.n);
      var wantDay = DAYTAGS.indexOf(want) >= 0;
      var hasDay = DAYTAGS.indexOf(r.tag) >= 0;
      if (wantDay){ if (r.tag !== want) { r.tag = want; n++; } }
      else if (hasDay){ r.tag = ''; n++; }
    });
  });
  return n;
}
// ★중복 표시는 '예정'이다 — 경기과가 배치표에 '2,3'이라고 적어 놓은 것은
//   "이 사람은 2부와 3부를 뛴다"는 계획이지 이미 그렇다는 보고가 아니다.
//   자리가 아직 하나뿐이라고 지워 버리면, 두 번째 자리를 앉힐 근거가 사라진다.
//   그래서 자리가 하나도 없을 때만 지운다.
// ★다만 배치표 칸에는 자리가 둘 다 있을 때만 적는다 — 칸은 계획이 아니라 사실을 말한다
// ★손으로 넣어 두 부에 서게 된 사람에게 '2,3' 같은 표시를 찍는다.
//   이 표시가 곧 '이 자리는 내가 정했다'는 못이다 — 순번 세우기가 안 건드린다.
//   ★기계(순번 세우기)가 만든 중복에는 안 찍는다. 찍으면 두 번째 누를 때 결과가 달라진다
function dupStamp(n){
  // ★못이 먼저다. 이름표가 없는 짝(1·2부)도 손으로 만든 중복이면 못은 박는다
  var pinned = false;
  if (partsPlanned(n).length >= 2 && !DUPPIN[n]) { DUPPIN[n] = 1; pinned = true; }
  var want = dupNow(n);
  if (!want) return pinned;
  var t = tagOf(n);
  // ★'3부'는 소속 표시(3부반 명부가 임자)라 비켜 준다 — 덮어써도 3부반 배지는 그대로다.
  //   '선발'은 순번 세우기가 시작할 자리라 덮으면 안 된다
  if (t && !isDupTag(t) && t !== '3부') return pinned;
  if (/54/.test(t) && want !== '54') return pinned;  // 54홀 표시는 안 내린다
  if (t === want || (t === '54h' && want === '54')) return pinned;
  TAG[n] = want;
  return true;
}
function reconcileDupTags(){
  var n = 0;
  allPeople().forEach(function(nm){
    var t = TAG[nm], w = dupNow(nm);
    if (goneDup(t)) { delete TAG[nm]; t = ''; n++; }   // ★없앤 개념은 저장본에서도 뗀다
    // ★못은 자리가 받친다 — 두 부에 안 서 있으면 못도 없다
    // ★박을 때와 같은 잣대로 뽑아야 한다(자리 ∪ 근무표 지정).
    //   자리만 보고 뽑으면, 근무표에서 지정해 둔 중복 근무는 박자마자 뽑혔다
    if (DUPPIN[nm] && partsPlanned(nm).length < 2) { delete DUPPIN[nm]; n++; }
    if (t === '3부') t = '';                     // ★소속 표시는 비켜 준다(위 까닭과 같다)
    if (t && !isDupTag(t)) return;               // 다른 배지가 못 박고 있다
    if (w){                                      // 표시는 '몇 부를 뛰나'를 따라간다
      if (/54/.test(t) && w !== '54') return;    // 54홀 표시는 안 내린다
      if (t !== w && !(t === '54h' && w === '54')) { TAG[nm] = w; n++; }
      return;
    }
    if (!isDupTag(t)) return;
    // ★못을 뽑는 잣대와 같아야 한다(자리 ∪ 근무표 지정).
    //   예전엔 '자리가 하나라도 있으면 아직 예정이다' 하고 남겼는데,
    //   그 예정을 근무표 지정이 대신 들게 된 지금은 남길 까닭이 없다 —
    //   1부에만 선 사람에게 '1,3'이 그대로 남아 거짓말을 했다.
    //   못은 이미 위에서 빠지는데 이름표만 남아 둘이 딸말을 했다
    if (partsPlanned(nm).length >= 2) return;
    delete TAG[nm]; n++;
  });
  // ★배치표 칸의 꼬리표도 같은 말을 해야 한다 — 안 그러면 근무표와 칸이 딴말을 한다.
  //   앉은 뒤에 부가 늘면(2부 → 54) 칸이 옛말을 그대로 들고 있었다
  DAY.forEach(function(p){
    p.roster.forEach(function(r){
      if (!r.n || r.itn) return;
      var pt = TAG[r.n];
      if (pt === '3부') pt = '';
      if (pt && !isDupTag(pt)) return;            // 사람 배지가 딴것을 못 박고 있다
      if (goneDup(r.tag)) { r.tag = ''; n++; }
      var w = dupNow(r.n), rt = (r.tag === '3부' ? '' : r.tag);
      if (!w){ if (isDupTag(rt)) { r.tag = ''; n++; } return; }
      if (/54/.test(rt) && w !== '54') return;
      if ((isDupTag(rt) || !rt) && r.tag !== w) { r.tag = w; n++; }
    });
  });
  return n;
}
// ★그날의 표시는 그날 것이다.
// 중복 근무(54h·2,3)와 조출·후출 같은 구분은 그날 경기과가 정하는 것이라
// 날을 넘기면 지워야 한다 — 안 그러면 어제 것이 오늘 자리를 거짓으로 말한다.
//
// ★근태는 기본으로 안 들고 간다. 어제 쉰 사람이 오늘도 쉬는 것이 아니다 —
//   재 보니 11명이 전원 그대로 넘어와, 경기팀은 11번을 풀고 다시 지정해야 했다.
//   빈 판에서 시작하고 '한꺼번에 지정'으로 오늘 것을 넣는 편이 손이 덜 간다.
// 소속(3부반) 씨앗은 늘 남긴다 — 설정에 사는 값이라 지우면 되살릴 길이 없다
// tees: 어제 티오프표를 들고 갈지. 기본은 들고 간다 — 62팀을 손으로 다시 넣는 것은 벌이다.
// 다만 그것이 '예약'이 아니라 '어제 것'이라는 사실은 창에 또렷이 적는다
var CARRY = { abs: false, leave: true, role: true, ln3: true, seats: false, tees: true,
  grid: true,                        // ★팀을 비워도 시간대는 들고 간다
  staff: false };                    // 경기과 마샬 — 날마다 바뀌니 기본은 안 들고 간다
function carryOpt(k){ return !!CARRY[k]; }
function setCarryOpt(k, v){ CARRY[k] = !!v; cfgSave(); }
function keepOnCarry(t, o){
  o = o || CARRY;
  if (t === '3부') return true;
  // ★휴무와 휴가·병가는 성질이 다르다.
  //   휴무는 그날 하루짜리라 안 물려주고, 휴가·병가는 여러 날 이어지니 물려준다
  if (t === '휴무') return !!o.abs;
  if (isAbs(t)) return !!o.leave;
  if (t === '당번' || t === '벌당') return false;   // ★당번은 그날치다 — 늘 비운다
  if (t === '선발') return !!o.role;
  return false;
}
function clearDayMarks(o){
  var gone = 0;
  JONAMES.forEach(function(n){
    var t = TAG[n];
    if (!t || keepOnCarry(t, o)) return;
    delete TAG[n]; gone++;
    // ★쉬던 사람은 자리를 비운 채라 명단 밖에 있다. 배지만 떼면
    //   가용으로 보이면서 순번에는 영영 안 선다(lineupPool 은 명단에 있는 사람만 센다).
    //   있던 부의 뒤로 돌려놓는다 — 어느 칸에 설지는 순번 세우기가 잡는다
    if (isAbs(t)){
      returnSeats(n);
      var back = TAG[n];                       // 쉬기 전에 달고 있던 배지
      if (back && !keepOnCarry(back, o)) delete TAG[n];
    }
  });
  DAY.forEach(function(p){
    p.roster.forEach(function(r){ if (r.tag && !keepOnCarry(r.tag, o)) r.tag = ''; });
  });
  return gone;
}
// ★한 사람이 두 부에 겹쳐 서 있는 것도 '그날의 배치'다 — 내일로 물려주면 안 된다.
// 어제 중복 근무였다고 오늘도 중복인 것이 아니다. 3부반은 3부에, 나머지는 첫 부에 남기고
// 나머지 자리는 비운다 — 모자란 자리는 순번 세우기가 한 바퀴 더 돌며 채운다
function unstackParts(){
  var gone = 0;
  JONAMES.forEach(function(nm){
    var ks = partsOf(nm);
    if (ks.length < 2) return;
    var home = (isBu3(nm) && ks.indexOf('3') >= 0) ? '3' : ks[0];
    ks.forEach(function(k){
      if (k === home) return;
      var p = part(k);
      for (var i = p.roster.length - 1; i >= 0; i--)
        if (p.roster[i].n === nm) { p.roster.splice(i, 1); gone++; }
    });
  });
  return gone;
}
// 사람이 눌러서 지울 때 — 되돌리기 한 번으로 돌아온다
function wipeDayMarks(){
  var b = whereMap(); snap();
  // ★abs 와 leave 를 둘 다 적는다 — 빼면 keepOnCarry 가 휴가·병가를 지운다
  var n = clearDayMarks({ abs: true, leave: true, role: true }), u = unstackParts();
  attTouch(['1', '2', '3']);
  commit((n || u)
    ? '그날의 배치 비움 · 구분 ' + n + '건 · 겹쳐 선 자리 ' + u + '칸'
    : '비울 것이 없습니다', b);
  return n + u;
}
// 오늘 따로 붙은 배지 — 소속('3부')과 선발은 셈에서 빼고 본다
function dayMark(n){
  var t = tagOf(n);
  return (!t || t === '3부' || t === '선발') ? '' : t;
}
// ★색표는 한 벌뿐이다 — 배치표 칸과 근무표 배지가 같은 색을 써야 눈이 안 헷갈린다
function tagCls(t){
  var g = String(t || '');
  if (!g) return '';
  if (g === '54' || g === '54h') return 'c54';
  if (/^1\s*,/.test(g)) return 'c13';        // 1,3 — 2,3 과 갈라 본다
  if (g.indexOf(',') > 0) return 'c23';
  if (g === '3부' || g === '3부반') return 'c3b';
  if (g === '선발') return 'csb';
  if (g === '당번' || g === '벌당') return 'cdu';
  // 당번 종류는 경기과가 늘리고 이름도 바꾼다 — 이름을 못 박지 말고 장부를 본다
  if (typeof DUTYKEYS !== 'undefined' && DUTYKEYS.some(function(k){
        return k === g || dutyChip(k) === g || dutyBadge(k) === g; }))
    return 'cdu';
  if (g === '배치') return 'cbz';            // ★손으로 않힌 자리 — 당번과 한 집안(주황)으로 본다
  if (g === '찾근') return 'ccg';             // ★자기가 순번을 골라 온다 — 한 눈에 갈라 보여야
  if (g.indexOf('조출') >= 0) return 'cjo';
  if (g.indexOf('후출') >= 0) return 'chu';
  if (g.indexOf('프리') >= 0) return 'cpr';
  if (g.indexOf('인턴') >= 0) return 'cin';
  return 'cet';                               // 정출·찾근·배치 — 그 밖
}
// ★배치표 칸에 적을 꼬리표. '3부'·'3부반'은 그날의 구분이 아니라 소속이다.
//   어느 부 격자에 앉았는지는 배치표를 보면 이미 안다 — 소속까지 칸에 적으면
//   그날 정말 봐야 할 구분(54·2,3·조출)을 가린다. 소속은 근무표가 말한다
function cellTag(t){
  t = String(t || '');
  return (t === '3부' || t === '3부반') ? '' : t;
}
// ★3부 사람이 1·2부 칸에 앉아 있으면 눈에 띄어야 한다.
// 막지는 않는다 — 조출·대바로는 갈 수 있다. 다만 모르고 섞이는 일은 없어야 한다
function mix3(pk, n){ return (pk !== '3' && isBu3(n)); }
// 근무표 배지에 적을 말. 근태(휴무·휴가·병가)는 상태 칩이 이미 말하므로 겹쳐 적지 않는다
// ★3부반이면 3부반 배지를 단다 — 소속이니 늘 붙어 있어야 한다.
// 오늘 따로 붙은 구분(조출·중복 근무…)이 있으면 그 옆에 하나 더 단다.
// 근태(휴무·휴가·병가)는 상태 칩이 이미 말하므로 배지에 안 적는다
function wkBadges(n){
  var out = [];
  if (isBu3(n)) out.push('3부반');                 // 소속이 먼저
  // ★그날의 선발. 배지 칸에는 '선발'이 적혀 있지만 dayMark() 가 비켜 준다 —
  //   순번을 막는 배지가 아니라 순번을 시작하는 자리이기 때문이다.
  //   비켜 주는 것과 안 보이는 것은 다르다. 누가 선발인지는 한눈에 보여야 한다
  if (tagOf(n) === '선발') out.push('선발');
  // ★중복 근무 표시는 상태 칩과 겹칠 때만 접는다.
  //   두 부에 자리가 있으면 칩이 이미 '2,3'이라고 말한다 — 두 번 적지 않는다.
  //   그런데 자리가 아직 안 받치는 표시는 칩이 말해 주지 않는다. 그건 '예정'이면서
  //   동시에 순번 세우기를 막는 못이다 — 안 보이면 뗄 수도 없다. 그러니 적는다
  var t = dayMark(n);                              // 그날의 구분이 다음
  // ★중복 근무(54·2,3·1,3)도 제 배지를 단다.
  //   여기서 지우면 근무표에서 색을 통째로 잃고 그냥 '근무'로 보인다 —
  //   배치표 칸은 제 색으로 나오는데 근무표만 안 나와 두 화면이 딴말을 했다.
  //   두 번 적힐 걱정은 안 해도 된다: 그리는 쪽이 배지와 상태가 같으면 하나를 지운다
  if (t && !isAbs(t)) out.push(t);
  // ★맡은 일이 마지막. 배지 칸(TAG)은 하나뿐이라 당번이 조출에 밀리는 일이 있는데,
  //   밀렸다고 안 적으면 지정해 놓고도 지정한 줄을 모른다. 장부에서 바로 읽어 적는다
  dutyMarks(n).forEach(function(d){ if (out.indexOf(d) < 0) out.push(d); });
  return out;
}
function tagOf(n){ return TAG[n] || ''; }
// ★배지를 둘로 나눈다.
//   그날치(대기·휴무·2,3·당번…)는 이름 가까이에, 소속(3부반)은 맨 오른쪽에.
//   소속은 날마다 안 바뀌니 늘 같은 자리에 있어야 눈이 한 번에 훑는다
function dayBadges(bts){
  return (bts || []).filter(function(x){ return x !== '3부반'; });
}
function bu3BadgeHTML(n){
  return isBu3(n) ? '<span class="bt ' + tagCls('3부반') + '">3부반</span>' : '';
}
// ★오늘 이 사람이 선 당번 — 배지 칸(TAG) 하나로는 못 담는다.
//   조출을 단 사람도 벌당을 설 수 있고, 배치표 칸에서 바로 지정할 수도 있다.
//   그래서 당번 상자(DUTY)와 배치표 칸(role)에서 곧장 읽는다. 여기가 정본이다
function dutyMarks(n){
  var out = [];
  function put(v){ if (v && out.indexOf(v) < 0) out.push(v); }
  if (!n) return out;
  DUTYKEYS.forEach(function(k){ if (dutyAt(k, n) >= 0) put(dutyBadge(k)); });
  DAY.forEach(function(p){ p.roster.forEach(function(r){
    if (r.n === n && r.role) put(dutyBadge(r.role)); }); });
  return out;
}
function hasDuty(n){ return dutyMarks(n).length > 0; }
// ★이 사람이 오늘 당번으로 묶여 있는 시간대들. [시작분, 끝분]
//   시각을 안 정했으면 하루를 잡고, 길이를 안 적었으면 그 시각 뒤로 잡는다 —
//   모르면 넉넉히 잡는 쪽이 안전하다
function dutyBusy(n){
  var out = [];
  // w: 그 당번의 근무 성격. 'in' 은 아무 시간도 안 묶는다 — 근무를 같이 하는 당번이다.
  //    'no' 는 시각이 적혀 있어도 하루를 잡는다 — 그날 근무를 안 하는 당번이다.
  function put(w, t, h){
    if (w === 'in') return;
    if (w === 'no' || !t) { out.push([0, 1440]); return; }
    var a = mm(t);
    out.push([a, h > 0 ? a + Math.round(h * 60) : 1440]);
  }
  DUTYKEYS.forEach(function(k){
    var i = dutyAt(k, n); if (i < 0) return;
    var x = dutyList(k)[i] || {};
    put(dutyW(k), x.t || '', Number(x.h) || 0);
  });
  DAY.forEach(function(p){ p.roster.forEach(function(r){
    if (r.n !== n || !r.role) return;
    var d = defOf(r.role);
    put(d.w, d.t || '', Number(d.h) || 0);
  }); });
  return out;
}
// ★오늘 아직 뛸 수 있는 라운드가 있나 — 13시부터 서는 벌당이 아침까지 막지는 않는다.
//   한 라운드는 ROUNDMIN 분으로 본다(설정에서 고친다)
function canRound(n){
  var w = dutyBusy(n);
  if (!w.length) return true;                       // 당번이 없으면 볼 것도 없다
  for (var i = 0; i < w.length; i++)
    if (w[i][0] <= 0 && w[i][1] >= 1440) return false;   // 하루를 통째로 잡는 당번
  var any = false, ok = false;
  DAY.forEach(function(p){ p.tees.forEach(function(t){
    if (!t || t.cx) return;
    any = true;
    if (ok) return;
    var a = mm(t.time), b = a + ROUNDMIN;
    var clash = false;
    for (var j = 0; j < w.length; j++)
      if (a < w[j][1] && b > w[j][0]) { clash = true; break; }
    if (!clash) ok = true;
  }); });
  return any ? ok : true;      // 티오프가 아직 없으면 막을 근거도 없다
}
function isAbs(t){ return ABSTYPES.indexOf(t) >= 0; }
// ★배지가 없고 어느 부에도 없는 사람은 '휴무'가 아니다.
// 오늘 일할 수 있는데 아직 어디에도 안 넣은 사람 — 미배치이고 가용에 든다.
// 예전에는 여기서 '휴무'를 돌려줘서, 배치표에서 뺀 사람이 쉬는 사람으로 둔갑했다
// 당번 기계가 배지 칸에 적어 두는 말 — 이 둘뿐이다(OTHERTAGS 안에 있는 당번 종류)
function isDutyTag(t){ return t === '당번' || t === '벌당'; }
function absOf(n){
  var t = tagOf(n);
  if (isAbs(t)) return t;                    // 쉬는 날이 먼저다
  // ★당번 때문에 '그 밖'으로 밀리는 길은 여기 하나뿐이다.
  //   ① 배지 칸이 비었거나, 자리에 붙는 말(조출 등)이거나, 당번 기계가 적어 둔 말일 때만 본다.
  //      배지가 하나뿐이라 당번이 조출에 밀리는 일이 있는데, 셈까지 밀리면 안 된다.
  //   ② 그러고도 안 겹치는 라운드가 남아 있으면 아직 일할 수 있는 사람이다 —
  //      13시부터 서는 벌당이 아침 라운드까지 막지는 않는다.
  //   ③ 순번에 같이 세우는 당번(흡연실 당번 등)은 아무것도 안 민다 — 그 사람은 오늘 근무한다.
  //   ④ 소속 배지(3부반·선발)는 '오늘 무엇을 한다'는 말이 아니다 — 당번이 이긴다.
  //      여태는 소속이 당번을 가려서, 3부반인 사람은 당번을 서도 근무표가 늘 '미배치'였다.
  //      명부가 거의 다 3부반이라 '근무 안 함' 당번이 화면에 아예 안 드러났다.
  if (blockDuty(n) && (!t || seatTag(t) || isDutyTag(t) || ownTag(t)))
    return canRound(n) ? (seatTag(t) ? t : '미배치') : blockMarks(n)[0];
  return t || '미배치';
}
// ★배지에 두 갈래가 있다.
//   자리에 붙는 말(조출·후출·정출·찾근) — 배치표에 자리가 있어야 뜻이 있는 말이다.
//     자리를 빼면 남는 건 '오늘 일할 수 있다'뿐 — 미배치이고 가용에 든다.
//     (순번 세우기에서는 그래도 빠진다. 어디에 놓을지는 경기과가 정한다)
//   그날 맡은 일(당번·벌당·배치·프리) — 자리가 없어도 할 일이 있다. 그 밖으로 센다.
var SEATTAGS = ['조출', '후출', '정출', '찾근'];
function seatTag(t){ return SEATTAGS.indexOf(t) >= 0; }
// ★붙는 순간 배치표에서 내려오는 말.
//   자리에 붙는 말(조출·후출·정출·찾근)은 '순번은 내가 정한다'는 뜻이고,
//   맡은 일(배치·프리)은 '오늘 캐디 근무는 안 한다'는 뜻이다.
//   ─ 배치는 경기과에서 마샬로 서는 사람이다. 까닭은 달라도
//     어제 순번 그대로 배치표에 앉아 라운드를 잡고 있으면 안 되는 것은 같다.
//   seatTag 와 갈라 두는 까닭: 셈이 다르다. 조출은 아직 '가용'이고, 배치·프리는 '그 밖'이다
var OFFBOARDTAGS = SEATTAGS.concat(['배치', '프리']);
function offBoardTag(t){ return OFFBOARDTAGS.indexOf(t) >= 0; }
// ★소속·순번 시작점은 '오늘 맡은 일'이 아니다. 자리가 없으면 그냥 미배치다.
//   이걸 '자리 없음'으로 세면 3부반을 부에서 빼는 순간 가용에서 샌다(실측 70→69).
//   게다가 씨앗 배지가 남은 3부반과 손으로 지정한 3부반이 서로 다르게 보였다
function ownTag(t){ return t === '3부' || t === '선발'; }
function absCls(t){
  // ★중복 근무(54·2,3)는 '오늘 두세 부를 뛴다'는 말이다 — 가장 많이 일하는 사람이다.
  //   아직 자리를 안 앉혔다고 제외인원으로 세면 가용이 그만큼 비어 보인다
  return t === '휴가' ? 'v' : (t === '병가' ? 's'
    : (isAbs(t) ? 'r'
      : ((t === '미배치' || seatTag(t) || ownTag(t) || isDupTag(t)) ? 'u' : 'o')));
}
// 코스 — 몇 개든 된다. 18홀이면 둘, 27홀이면 셋, 36홀이면 넷.
// COURSES가 있는 것과 차례를 정하고, COURSE는 보이는 이름만 갖는다.
// ★열쇠(key)는 티오프가 가리키는 값이라 한 번 정하면 안 바꾼다. 바꾸는 건 이름뿐이다.
// ★있을 수 있는 최대치 — 4부를 도는 골프장은 없고, 36홀(18홀 코스 둘)보다 큰 곳도 없다.
// 상한을 두면 화면의 최악이 3부 × 4코스 하나로 고정된다
var MAXPART = 3, MAXCOURSE = 4;
var COURSES = ['OUT', 'IN'];
var COURSE = { OUT: 'OUT', IN: 'IN' };   // 코스 이름 — 골프장마다 다르다
function cname(k){ return COURSE[k] || k; }
function cpos(k){ var i = COURSES.indexOf(k); return i < 0 ? 99 : i; }
function courseUsed(k){                  // 그 코스에 선 팀이 있나
  for (var i = 0; i < DAY.length; i++)
    for (var j = 0; j < DAY[i].tees.length; j++)
      if (DAY[i].tees[j].course === k) return true;
  return false;
}

// 조 편성 — 실제 조 명부를 넣으면 그대로 뜬다. 지금은 명부 순서로 넷으로 나눈 데모다
var JOCNT = 4, JOMAP = {}, JONAMES = [], JOLABEL = ['1조','2조','3조','4조'];
(function(){
  var seen = {};
  JOFIX.forEach(function(list, i){
    list.forEach(function(n){ if (!seen[n]) { seen[n] = 1; JONAMES.push(n); JOMAP[n] = i; } });
  });
  // 조편성표에 없는데 부 명단에는 있는 사람(있으면 미배정으로 남는다)
  DAY.forEach(function(p){ p.roster.forEach(function(r){
    if (!seen[r.n]) { seen[r.n] = 1; JONAMES.push(r.n); } }); });
})();
// ★오늘 아는 사람 전부 — 조 편성 차례를 앞에 두고, 그 뒤에 생긴 사람을 뒤에 붙인다.
//   JONAMES 만 보면 나중에 생긴 사람을 영영 못 본다(근무표엔 뜨는데 여기선 없는 사람)
function allPeople(){
  var seen = {}, out = [];
  function put(n){ if (n && !seen[n]) { seen[n] = 1; out.push(n); } }
  JONAMES.forEach(put);
  DAY.forEach(function(p){ p.roster.forEach(function(r){ if (!r.itn) put(r.n); }); });
  OFFDUTY.forEach(put);
  Object.keys(TAG).forEach(put);
  return out;
}
// ── 명부 — 누가 우리 캐디인가 ──────────────────────────────
// ★명부는 그날의 사실이 아니다. 3부반 소속처럼 설정에 남아 날을 넘겨도 그대로다.
//   저장본을 읽은 뒤에는 배치표·명단 밖에만 있는 사람을 뒤에 붙인다 —
//   놓치면 근무표 조 칸에서 통째로 사라진다(joMembers 가 명부만 보기 때문이다)
function reconcileNames(){
  var seen = {}, add = [];
  JONAMES.forEach(function(n){ seen[n] = 1; });
  function put(n){ if (n && !seen[n]) { seen[n] = 1; JONAMES.push(n); add.push(n); } }
  DAY.forEach(function(p){ p.roster.forEach(function(r){ if (!r.itn) put(r.n); }); });
  OFFDUTY.forEach(put);
  return add;
}
function hasCaddie(n){ return JONAMES.indexOf(n) >= 0; }
// 명부에 넣는다. 조는 -1(미배정)도 된다 — 조를 모르면 나중에 옮기면 된다
function addCaddie(nm, jo){
  nm = String(nm || '').trim();
  if (!nm) { toast('이름을 적어 주세요'); return false; }
  if (hasCaddie(nm)) { toast(nm + ' 은(는) 이미 명부에 있습니다'); return false; }
  jo = Number(jo);
  if (!(jo >= 0 && jo < JOCNT)) jo = -1;
  var b = whereMap(); snap();
  JONAMES.push(nm);
  if (jo >= 0) JOMAP[nm] = jo; else delete JOMAP[nm];
  // ★자리는 없지만 근무표에는 보여야 한다 — 명단 밖 사람은 여기 있어야 뜬다
  if (OFFDUTY.indexOf(nm) < 0) OFFDUTY.push(nm);
  cfgSave();
  commit('명부에 ' + nm + ' 넣음 · ' + (jo >= 0 ? (JOLABEL[jo] || (jo + 1) + '조') : '조 미배정')
    + ' · 배치표 자리는 아직 없습니다(미배치)', b);
  return true;
}
// 명부에서 뺀다 — 오늘 선 자리도, 배지도, 카트도, 당번도 같이 턴다.
// 되돌리기 한 번으로 통째로 돌아온다
function delCaddie(nm){
  if (!nm || !hasCaddie(nm)) { toast('명부에 없는 사람입니다'); return false; }
  var b = whereMap(); snap();
  var from = [];
  DAY.forEach(function(p){
    var hit = false, i;
    for (i = p.roster.length - 1; i >= 0; i--)
      if (p.roster[i].n === nm) { p.roster.splice(i, 1); hit = true; }
    if (hit) from.push(p.name);
  });
  var dt = [];
  DUTYKEYS.forEach(function(k){
    var j = dutyAt(k, nm);
    if (j >= 0) { dutyList(k).splice(j, 1); dt.push(k); }
  });
  DAY.forEach(function(p){ p.roster.forEach(function(r){ if (r.n === nm) r.role = ''; }); });
  var i2 = JONAMES.indexOf(nm); if (i2 >= 0) JONAMES.splice(i2, 1);
  var o2 = OFFDUTY.indexOf(nm); if (o2 >= 0) OFFDUTY.splice(o2, 1);
  var L3 = bu3List(), i3 = L3.indexOf(nm); if (i3 >= 0) L3.splice(i3, 1);
  delete JOMAP[nm]; delete TAG[nm]; delete PLAN[nm]; delete DUPPIN[nm]; delete CART[nm];
  delete LEND[nm]; delete ABSFROM[nm];
  if (SB3 === nm) SB3 = '';
  cfgSave();
  commit('명부에서 ' + nm + ' 지움'
    + (from.length ? ' · ' + from.join('·') + ' 자리도 비움' : '')
    + (dt.length ? ' · ' + dt.join('·') + '에서도 뺌' : ''), b);
  return true;
}
// 조 배정은 비어 있다 — 실제 조편성표를 보고 넣는 값이지 우리가 지어낼 값이 아니다
function joOf(n){ return (n in JOMAP) ? JOMAP[n] : -1; }
function joCount(i){ var c = 0; JONAMES.forEach(function(n){ if (joOf(n) === i) c++; }); return c; }
function joUnset(){ var c = 0; JONAMES.forEach(function(n){ if (joOf(n) < 0) c++; }); return c; }

var cur = '2', pick = null, dirty = {}, LOG = [], STACK = [], REDO = [], drwPart = '2';

function part(k){ for (var i = 0; i < DAY.length; i++) if (DAY[i].key === k) return DAY[i]; return DAY[0]; }
function active(p){ return p.roster.filter(function(r){ return !r.off; }); }
function sortTees(p){
  p.tees.sort(function(a, b){
    var d = mm(a.time) - mm(b.time);
    return d !== 0 ? d : (cpos(a.course) - cpos(b.course));
  });
}
function offGrid(p, time){ return ((mm(time) - mm(p.start)) % GAP) !== 0; }
// ★격자는 팀에 끌려다니면 안 된다.
//   리버힐 종이 배치표는 그 부의 시간표가 먼저 있고, 팀이 그 칸에 들어간다.
//   OUT·IN 이 둘 다 비어도 시각은 그대로 남아야 거기에 팀을 도로 넣을 수 있다.
//   여태는 기본 줄(ROWS) 너머의 시각이 '팀이 있어야만' 있어서, 그 시각의 팀을
//   다 지우면 줄이 사라지고 격자 한가운데 구멍이 났다.
// 그래서 격자 길이는 셋 중 가장 큰 값으로 잡는다 —
//   ① 기본 줄 수(ROWS)  ② 오늘 이 부가 한 번이라도 늘어났던 길이(p.rows)
//   ③ 지금 서 있는 마지막 팀까지의 길이
// p.rows 는 '그날 여기까지 늘렸다'는 자국이라 팀을 지워도 안 줄어든다
// ★그 부가 원래 들고 온 시간표 길이 — 본배치표에 찍혀 나온 칸 수다.
//   자국(p.rows)은 오늘 늘린 길이만 기억하므로, 자국이 찍히기 전에
//   끝 시각의 팀을 지워 버린 판은 그 칸을 영영 잃는다.
//   종이 배치표는 그렇지 않다 — 칸은 처음부터 그자리에 있다.
var BOARDROWS = (function(){
  var m = {};
  try {
    var ps = BOARD.parts;
    for (var k in ps){
      if (!ps.hasOwnProperty(k)) continue;
      var ts = ps[k].tees || [], lo = null, hi = null;
      for (var i = 0; i < ts.length; i++){
        var v = mm(ts[i].time);
        if (lo === null || v < lo) lo = v;
        if (hi === null || v > hi) hi = v;
      }
      m[k] = (lo === null) ? 0 : Math.floor((hi - lo) / GAP) + 1;
    }
  } catch (e) { /* 못 읽으면 기본 줄만 쓴다 */ }
  return m;
})();
function gridRows(p){
  var n = Math.max(ROWS, Math.floor(Number(p.rows) || 0),
                   Math.floor(Number(BOARDROWS[p.key]) || 0));
  var last = 0;
  p.tees.forEach(function(t){ var m = mm(t.time); if (m > last) last = m; });
  var s0 = mm(p.start);
  if (last > s0) n = Math.max(n, Math.floor((last - s0) / GAP) + 1);
  return Math.max(1, Math.min(n, 240));      // 터무니없는 값에 화면이 굳지 않게
}
// ★실려 온 배치표에도 자국을 찍는다.
//   여태는 자국이 '끟어 넣기·밀기' 때만 찍혔다. 그래서 1부처럼
//   기본 줄(ROWS)보다 긴 부는 격자 길이가 '마지막 팀'에만 매여 있어,
//   마지막 시각의 팀을 전부 지우면 그 칸이 통째로 사라졌다 —
//   종이 배치표는 팀을 지워도 그 시각 칸이 빈 채로 남는다.
function stampGrids(){ DAY.forEach(function(p){ growGrid(p); stampTimes(p); }); }
// 팀이 격자 밖으로 나가면 격자를 그만큼 늘려 두고, 그 자국을 남긴다
function growGrid(p){
  var n = gridRows(p);
  if (n > (Math.floor(Number(p.rows) || 0))) p.rows = n;
  return n;
}
// 그날의 격자 = 기본 줄 + (격자 밖으로 끼워 넣은 시각)
// ★격자 밖 시각에도 자국을 남긴다.
//   시작보다 이른 칸(6:37)이나 7분 곱이 아닌 칸은 기본 시간표에 없어서,
//   여태는 '그 시각에 팀이 있어서' 만 서 있었다 — 팀을 지우면 칸이 통째로 사라졌다.
//   종이 배치표는 그렇지 않다: 끜워 넣은 칸도 빈 채로 남아 거기에 도로 넣는다.
function stampTimes(p){
  var n = gridRows(p), s0 = mm(p.start), on = {}, k;
  for (k = 0; k < n; k++) on[hm(s0 + k * GAP)] = 1;
  var xt = (p.xt || []).slice();
  p.tees.forEach(function(t){ if (!on[t.time] && xt.indexOf(t.time) < 0) xt.push(t.time); });
  xt = xt.filter(function(tm){ return !on[tm]; });   // 격자가 늘어 안으로 들어온 시각은 버린다
  xt.sort(function(a, b){ return mm(a) - mm(b); });
  p.xt = xt;
  return xt;
}
function gridTimes(p){
  var out = [], seen = {}, k, n = gridRows(p);
  for (k = 0; k < n; k++){ var t = hm(mm(p.start) + k * GAP); out.push(t); seen[t] = 1; }
  (p.xt || []).forEach(function(tm){ if (!seen[tm]) { seen[tm] = 1; out.push(tm); } });
  p.tees.forEach(function(t){ if (!seen[t.time]) { seen[t.time] = 1; out.push(t.time); } });
  out.sort(function(a, b){ return mm(a) - mm(b); });
  return out;
}
function whereMap(){                       // 사람 → 지금 어디
  var m = {};
  DAY.forEach(function(p){
    active(p).forEach(function(r, i){
      var t = p.tees[i];
      if (r.n) m[p.key + '|' + r.n] = t ? (t.time + ' ' + t.course + (t.cx ? ' 취소' : '')) : '대기';
    });
  });
  return m;
}

// ── 고침 기록 · 되돌리기 ──
var SB3 = '';           // 3부 회전의 시작점 — 어제 3부에서 일 못 한 첫 사람
var DATE = BOARD.date;  // 그날. 상태에 넣어야 '날 넘기기'를 되돌릴 수 있다
// ★배지는 '이 자리 건드리지 마'라는 뜻이지 '이 사람을 빼라'는 뜻이 아니었다.
// 그래서 세운 뒤에 휴무를 붙이면 그 사람이 근무 칸에 굳어, 다시 세워도 안 빠졌다.
// 휴무·휴가·병가 셋만 자리를 비운다 — 그 셋은 '오늘 안 나온다'는 뜻이니까.
// 중복 근무·조출·후출·당번·배치·프리는 '여기 놔둬'라는 뜻이라 손대지 않는다.
// ★처음 읽은 배치표 한 벌을 접어 둔다 — 판을 비운 뒤에도 되돌아갈 데가 있어야 한다
var BOOT0 = JSON.stringify({ day: DAY, tag: TAG });
function resetToBoard(){
  var o = JSON.parse(BOOT0);
  DAY = o.day; TAG = o.tag;
  OFFDUTY = []; ABSFROM = {}; LEND = {};
  stampGrids();
  return DAY.map(function(p){ return p.name + ' ' + p.roster.length; }).join(' · ');
}
var ABSFROM = {};       // 자리를 비운 사람 → 어느 부에 있었나 · 떼기 전 배지
var ATTCH = 0;          // 순번을 세운 뒤 근태가 몇 번 바뀌었나
var LNPKS = null;       // 마지막으로 세운 부. 없으면 아직 한 번도 안 세웠다
function state(){ return JSON.stringify({ day: DAY, log: LOG, dirty: dirty, off: OFFDUTY,
  sb3: SB3, date: DATE, absfrom: ABSFROM,
  staff: STAFF, duty: DUTY, dkeys: DUTYKEYS, ddef: DUTYDEF, dcol: DUTYCOLOR, jomap: JOMAP, jolab: JOLABEL, jocnt: JOCNT,
  gap: GAP, rows: ROWS, smax: SMAX, course: COURSE, courses: COURSES,
  tag: TAG, plan: PLAN, dpin: DUPPIN, cart: CART, lend: LEND, cbad: CARTBAD, bu3set: bu3List(),
  jonames: JONAMES }); }
function restore(s){
  var o = JSON.parse(s);
  DAY = o.day; LOG = o.log; dirty = o.dirty; OFFDUTY = o.off;
  stampGrids();
  if (o.staff) { STAFF = o.staff; migrateStaff(); }
  if (o.duty) DUTY = o.duty;
  if (o.dkeys) DUTYKEYS = o.dkeys;
  if (o.ddef) DUTYDEF = o.ddef;
  if (o.dcol) DUTYCOLOR = o.dcol;
  if (o.jomap) { JOMAP = o.jomap; JOLABEL = o.jolab; JOCNT = o.jocnt; }
  if (o.jonames && o.jonames.length) JONAMES = o.jonames;
  if (o.gap) { GAP = o.gap; ROWS = o.rows; }
  if (o.smax) SMAX = o.smax;
  if (o.course) COURSE = o.course;
  if (o.courses && o.courses.length) COURSES = o.courses;
  SB3 = o.sb3 || '';
  DATE = o.date || BOARD.date;
  ABSFROM = o.absfrom || {};
  if (o.tag) TAG = o.tag;
  PLAN = o.plan || {};
  DUPPIN = o.dpin || {};
  if (o.bu3set) BU3SET = o.bu3set;
  if (o.cart) CART = o.cart;
  LEND = o.lend || {};
  CARTBAD = o.cbad || {};
}
// ★여러 사람에게 같은 일을 할 때는 한 걸음으로 묶는다.
//   안 그러면 되돌리기를 스무 번 눌러야 하고, 알림도 스무 번 뜬다.
//   묶음 안에서는 자리를 안 찍고(snap) 마무리도 안 한다(commit) — 끝에서 한 번만 한다
var BATCH = null;
function batchOn(){ return !!BATCH; }
function batchStart(){ if (BATCH) return false; snap(); BATCH = { before: whereMap() }; return true; }
function batchEnd(msg){
  if (!BATCH) return false;
  var b = BATCH.before; BATCH = null;
  commit(msg, b);
  return true;
}
function snap(){ if (BATCH) return; STACK.push(state()); REDO = []; if (STACK.length > 60) STACK.shift(); }
function commit(msg, before){
  if (BATCH) return;                       // 묶음이 끝날 때 한 번에 친다
  var after = whereMap(), moved = 0;
  Object.keys(after).forEach(function(k){ if (before[k] !== undefined && before[k] !== after[k]) moved++; });
  Object.keys(before).forEach(function(k){ if (after[k] === undefined) moved++; });
  syncRowTags();                           // ★칸의 구분은 사람의 배지를 따라간다 — 문이 여럿이라 여기서 맞춘다
  reconcileDupTags();                      // ★자리가 안 받치는 중복 표시는 남겨 두지 않는다
  LOG.unshift({ msg: msg, moved: moved });
  draftPut();                              // ★닫혀도 안 잃게 — 저장본은 안 건드린다
  paint();
  toast(msg + (moved ? ' · ' + moved + '명 영향' : ''));
}
function undo(){
  if (!STACK.length) { toast('되돌릴 것이 없습니다'); return; }
  REDO.push(state());
  restore(STACK.pop());
  pick = null; cfgSave(); draftPut(); paint(); resyncSheet();
  toast('되돌렸습니다 · 다시 하려면 Ctrl+Shift+Z');
}
function redo(){
  if (!REDO.length) { toast('다시 할 것이 없습니다'); return; }
  STACK.push(state());
  restore(REDO.pop());
  pick = null; cfgSave(); draftPut(); paint(); resyncSheet(); toast('다시 했습니다');
}
function markDirty(pk, idx){ dirty[pk + ':' + idx] = 1; }

// ── 조작 ────────────────────────────────────
function setName(pk, i, v){
  var p = part(pk), a = active(p), r = a[i];
  if (!r) return;
  var b = whereMap(); snap();
  var old = r.n; r.n = v;
  markDirty(pk, i);
  commit(p.name + ' ' + (i + 1) + '번 ' + old + ' → ' + (v || '비움'), b);
}
function riOf(pk, i){                       // 근무·대기 i번째 → 명단에서 몇 번째 줄인가
  var p = part(pk), r = active(p)[i];
  return r ? p.roster.indexOf(r) : -1;
}
// 대바 — 부를 가리지 않고, 오늘 안 나온 사람과도 바꾼다.
// 자리의 성격(근무냐 휴무냐)은 자리에 남고 사람만 오간다.
// 한 사람이 오늘 앉아 있는 자리 전부 — 두 부 근무가 흔하다
function seatsOf(name){
  var out = [];
  DAY.forEach(function(p){
    active(p).forEach(function(r, i){
      if (r.n !== name) return;
      var t = p.tees[i];
      out.push({ pk: p.key, ri: p.roster.indexOf(r),
        label: p.name + ' ' + (i + 1) + '번 · ' + (t ? t.time + ' ' + t.course : '대기') });
    });
    p.roster.forEach(function(r, ri){
      if (r.off && r.n === name) out.push({ pk: p.key, ri: ri, label: p.name + ' 결근' });
    });
  });
  return out;
}
// 같은 부에 같은 사람이 두 번 들어가는 것만 막는다(두 부 근무는 정상)
function dupReason(A, B){
  if (!A || !B) return '';
  if (A.pk && B.pk && A.pk === B.pk) return '';
  var an = A.offName || ((part(A.pk).roster[A.ri] || {}).n);
  var bn = B.offName || ((part(B.pk).roster[B.ri] || {}).n);
  if (!an || !bn) return '';
  if (an === bn) return '같은 사람입니다';
  var pa = part(A.pk);
  if (pa.roster.some(function(r, i){ return i !== A.ri && !r.off && r.n === bn; }))
    return bn + '은(는) ' + pa.name + '에 이미 있습니다';
  if (B.pk){
    var pb = part(B.pk);
    if (pb.roster.some(function(r, i){ return i !== B.ri && !r.off && r.n === an; }))
      return an + '은(는) ' + pb.name + '에 이미 있습니다';
  }
  return '';
}
// ── 당번 — 그날의 역할. 누가 무슨 당번인가는 그날의 사실이다 ──
// 종류를 만들고 고치고 지우는 것 — 원래는 설정이지만 두 화면이 함께 쓴다
function dtAdd(v){ v = (v || '').trim() || '새 당번';
  if (DUTYKEYS.indexOf(v) >= 0) { toast('이미 있는 당번입니다'); return; }
  cfgChange('당번 종류 추가 · ' + v, function(){
    DUTYKEYS.push(v); DUTY[v] = []; DUTYDEF[v] = { t: '', h: 0, w: 'may' }; }); }
function dtDel(k){ cfgChange('당번 종류 지움 · ' + k, function(){
  DUTYKEYS.splice(DUTYKEYS.indexOf(k), 1);
  delete DUTY[k]; delete DUTYDEF[k]; delete DUTYCOLOR[k]; }); }
function dtName(k, v){
  if (!v || v === k) return;
  cfgChange('당번 이름 ' + k + ' → ' + v, function(){
    DUTYKEYS[DUTYKEYS.indexOf(k)] = v; DUTY[v] = DUTY[k]; delete DUTY[k];
    DUTYDEF[v] = defOf(k); delete DUTYDEF[k];
    DUTYCOLOR[v] = dutyColor(k); delete DUTYCOLOR[k]; });
}

// 부 · 코스 · 격자
function setDutyDef(k, t){
  var d = defOf(k);
  if (d.t === t) return;
  cfgChange(k + ' 기본 시각 ' + (d.t || '없음') + ' → ' + (t || '없음'),
    function(){ defOf(k).t = t; });
}
// 그 당번을 서면 그날 근무를 어떻게 보나 — 순번에 같이 / 상황 따라 / 근무 안 함
function setDutyWork(k, w){
  if (DUTYWORK.indexOf(w) < 0) return;
  var d = defOf(k);
  if (d.w === w) return;
  cfgChange(k + ' 근무 ' + DUTYWTX[d.w] + ' → ' + DUTYWTX[w], function(){ defOf(k).w = w; });
}
// 설정에서 기본값을 고쳐도 이미 서 있는 사람은 저절로 안 바뀐다 —
// 사람마다 7시·13시로 갈라 둔 것을 설정 한 번에 지워 버리면 안 되기 때문이다.
// 대신 '모두 맞추기'로 한 번에 밀어 넣을 수 있게 한다.
function setDutyDefHour(k, v){
  var d = defOf(k), h = hrNum(v);
  if ((d.h || 0) === h) return;
  cfgChange(k + ' 기본 근무 ' + (d.h ? hrText(d.h) : '없음') + ' → ' + (h ? hrText(h) : '없음'),
    function(){ defOf(k).h = h; });
}

// 폰에서는 되돌리기도 한 번이어야 한다 — 이름·기본 시각·시간을 한 번에 세운다
function dtAddWith(name, t, h){
  var nm = (name || '').trim();
  if (!nm) { toast('당번 이름을 적어 주세요'); return false; }
  if (DUTYKEYS.indexOf(nm) >= 0) { toast('이미 있는 당번입니다'); return false; }
  var nt = t || '', nh = hrNum(h);
  cfgChange('당번 종류 추가 · ' + nm + (nt || nh ? ' (' + dutySpan({ t: nt, h: nh }) + ')' : ''),
    function(){ DUTYKEYS.push(nm); DUTY[nm] = []; DUTYDEF[nm] = { t: nt, h: nh, w: 'may' }; });
  return true;
}
// 이름과 기본 시간표를 한 번에 고친다
function dtEdit(k, name, t, h){
  var nm = (name || '').trim() || k, d = defOf(k), nt = t || '', nh = hrNum(h);
  if (nm !== k && DUTYKEYS.indexOf(nm) >= 0) { toast('이미 있는 당번입니다'); return false; }
  if (nm === k && (d.t || '') === nt && (d.h || 0) === nh) { toast('바뀐 것이 없습니다'); return false; }
  cfgChange('당번 ' + k + (nm !== k ? ' → ' + nm : '') + ' 고침 · '
      + (dutySpan({ t: nt, h: nh }) || '시각 없음'),
    function(){
      if (nm !== k){
        DUTYKEYS[DUTYKEYS.indexOf(k)] = nm;
        DUTY[nm] = DUTY[k]; delete DUTY[k];
        DUTYDEF[nm] = defOf(k); delete DUTYDEF[k];
        DUTYCOLOR[nm] = dutyColor(k); delete DUTYCOLOR[k];
        k = nm;
      }
      defOf(k).t = nt; defOf(k).h = nh;
    });
  return true;
}
function dutyList(k){ return DUTY[k] || (DUTY[k] = []); }
function dutyNames(k){ return dutyList(k).map(function(x){ return x.n; }); }
function dutyAt(k, n){
  var a = dutyList(k);
  for (var i = 0; i < a.length; i++) if (a[i].n === n) return i;
  return -1;
}
// 기본값 — 옛 저장본은 시각 문자열 하나였다. 읽을 때 모양을 맞춘다
// 성격을 안 적던 판에서 올라온 값을 채울 때 쓰는 씨앗.
// ★이름으로 찍는 것은 여기 한 줄뿐이고, 한 번 채우면 설정에 남아 손으로 바꿀 수 있다.
//   리버힐에서 흡연실 당번은 그날 근무가 확정되는 당번이라 옛 값의 뜻('시각 없음=하루 종일')과 다르다.
var DUTYWSEED = { '흡연실 당번': 'in' };
function defOf(k){
  var d = DUTYDEF[k];
  if (typeof d === 'string') d = { t: d, h: 0 };
  if (!d || typeof d !== 'object') d = { t: '', h: 0 };
  // 옛 값의 뜻을 그대로 옮긴다 — 시각이 있으면 '상황 따라', 없으면 하루를 잡던 것이니 '근무 안 함'
  if (DUTYWORK.indexOf(d.w) < 0) d.w = DUTYWSEED[k] || (d.t ? 'may' : 'no');
  DUTYDEF[k] = d;
  return d;
}
// 그 당번의 근무 성격
function dutyW(k){ return defOf(k).w; }
// 그 사람이 선 당번 가운데 '근무를 막는' 것들 — 순번에 같이 세우는 당번(in)은 안 막는다
function blockMarks(n){
  var out = [];
  if (!n) return out;
  DUTYKEYS.forEach(function(k){ if (dutyW(k) !== 'in' && dutyAt(k, n) >= 0) out.push(dutyBadge(k)); });
  DAY.forEach(function(p){ p.roster.forEach(function(r){
    if (r.n === n && r.role && dutyW(r.role) !== 'in') {
      var v = dutyBadge(r.role); if (out.indexOf(v) < 0) out.push(v);
    } }); });
  return out;
}
function blockDuty(n){ return blockMarks(n).length > 0; }
function hrNum(v){ var n = Number(v); return (isFinite(n) && n > 0) ? Math.min(24, n) : 0; }
function hrText(h){ return (Math.round(h * 10) / 10) + '시간'; }
// 몇 시에 시작해 몇 시간 서면 몇 시에 끝나나 — 자정을 넘겨도 맞게 돈다
function endT(t, h){
  var n = mm(t) + Math.round(h * 60);
  return hm(((n % 1440) + 1440) % 1440);
}
// 이름이 없어도 자리는 자리다 — 이름 없이 시각만, 시각 없이 이름만도 된다
function dutyOne(x){
  var sp = dutySpan(x);
  if (x.n && sp) return x.n + ' ' + sp;
  return x.n || sp || '—';
}
// 한 사람의 근무 — '7:00~12:00' · 시각만 있으면 '7:00' · 시간만 있으면 '5시간'
function dutySpan(x){
  if (x.t && x.h) return x.t + '~' + endT(x.t, x.h);
  if (x.t) return x.t;
  if (x.h) return hrText(x.h);
  return '';
}
// 배치표에 뜨는 한 줄 — 시각도 시간도 없으면 이름만
function dutyLabel(k){ return dutyList(k).map(dutyOne).join(' · '); }
// 색은 당번마다 하나씩 붙잡아 둔다 — 칸 자리를 옮겨도 색이 따라 흔들리지 않는다
function dutyColor(k){
  if (DUTYCOLOR[k] === undefined){
    var used = {};
    Object.keys(DUTYCOLOR).forEach(function(x){ used[DUTYCOLOR[x]] = 1; });
    var c = 0; while (used[c] && c < 4) c++;
    DUTYCOLOR[k] = c;
  }
  return DUTYCOLOR[k];
}
// 칩에 쓸 짧은 이름: '흡연실 당번' → '흡연실', '당번' → '당번'
function dutyChip(k){
  var t = String(k).trim();
  return (t.length > 2 && /\s*당번$/.test(t)) ? t.replace(/\s*당번$/, '') : t;
}
// ★배지에 적을 이름도 짧은 쪽이다 — 당번 상자의 칩과 같은 말을 쓴다.
//   여태는 배지에 '흡연실 당번', 그 옆 상태 칸에 '당번 중'이라 두 번 적었다.
//   '부로 읽힌다'는 걱정은 색이 맡는다: 당번 색(cdu)은 근무 칩과 딴판이다
function dutyBadge(k){
  var t = dutyChip(k);
  // ★'1부 당번'을 줄이면 '1부'만 남아 근무한 부로 읽힐다.
  //   부 이름만 남는 당번은 부를 버리고 그냥 '당번'이라 적는다 —
  //   몇 부 당번인지는 당번 상자가 이미 말한다
  return /^\s*\d+\s*부\s*$/.test(t) ? '당번' : t;
}
// 문장에 쓸 이름 — 여기서는 안 줄인다.
//   '오늘 흡연실이라 순번에 못 섭니다'는 말이 안 된다. 장부 이름을 그대로 쓴다
function dutyFull(n){
  var out = '';
  DUTYKEYS.forEach(function(k){ if (!out && dutyAt(k, n) >= 0) out = String(k).trim(); });
  if (!out) DAY.forEach(function(p){ p.roster.forEach(function(r){
    if (!out && r.n === n && r.role) out = String(r.role).trim(); }); });
  return out;
}
// 종류 이름이 배치표 꼬리표와 같은 것(당번·벌당)만 근무표 꼬리표를 따라 고친다
function syncDutyTag(k, was, now){
  if (OTHERTAGS.indexOf(k) < 0) return;
  was.forEach(function(n){ if (TAG[n] === k && now.indexOf(n) < 0) delete TAG[n]; });
  now.forEach(function(n){ if (!TAG[n]) TAG[n] = k; });   // 남의 꼬리표는 덮지 않는다
}
// ★그날 선 당번을 비운다. 당번 종류와 기본 시각은 설정이라 남긴다 —
//   지우는 것은 '오늘 누가 섰나'뿐이다. 배치표 칸의 역할도 같이 턴다
function clearDutyDay(){
  var n = 0;
  DUTYKEYS.forEach(function(k){
    var a = dutyList(k);
    if (a.length) { n += a.length; DUTY[k] = []; }
  });
  DAY.forEach(function(p){ p.roster.forEach(function(r){
    if (r.role) { r.role = ''; n++; } }); });
  return n;
}
function setDutyList(k, arr){
  var b = whereMap(); snap();
  var was = dutyNames(k);
  DUTY[k] = arr;
  var now = arr.map(function(x){ return x.n; });
  syncDutyTag(k, was, now);
  commit(k + ' ' + (was.join('·') || '없음') + ' → ' + (now.join('·') || '없음'), b);
}
// 한 사람의 시각만 고친다 — 사람은 그대로 둔다
function setDutyTime(k, i, t){
  var a = dutyList(k);
  if (!a[i] || a[i].t === t) return;
  var b = whereMap(); snap();
  var was = a[i].t;
  a[i].t = t;
  commit(k + ' ' + (a[i].n || (i + 1) + '번') + ' 시각 ' + (was || '없음') + ' → ' + (t || '없음'), b);
}
// 이름 칸 — 비우면 그대로 공백으로 남는다. 지우지 않는다
function dutyToggle(k, n){
  var a = dutyList(k).slice(), i = dutyAt(k, n);
  if (i >= 0) a.splice(i, 1); else { var d = defOf(k); a.push({ n: n, t: d.t || '', h: d.h || 0 }); }
  setDutyList(k, a);
}

// 누가 오늘 어디 있나 — 이름 하나로 그 사람의 자리를 전부 모은다
function peopleIndex(){
  var map = {}, order = [];
  // ★이름 없는 줄은 '비어 있는 자리'지 사람이 아니다 — 총원에 끼면 안 된다
  function put(n, s){ if (!n) return; if (!map[n]) { map[n] = []; order.push(n); } map[n].push(s); }
  DAY.forEach(function(p){
    active(p).forEach(function(r, i){
      if (r.itn) return;                       // ★인턴은 우리 명단 밖 사람이다 — 총원에 안 든다
      var t = p.tees[i];
      put(r.n, { pk: p.key, ri: p.roster.indexOf(r), part: p.key,
        label: p.name + ' ' + (i + 1) + '번 · ' + (t ? t.time + ' ' + t.course + (t.cx ? ' 취소' : '') : '대기') });
    });
    p.roster.forEach(function(r, ri){
      if (r.off) put(r.n, { pk: p.key, ri: ri, part: p.key, label: p.name + ' 결근' });
    });
  });
  OFFDUTY.forEach(function(n){ if (!map[n]) { map[n] = []; order.push(n); } });
  return { map: map, order: order };
}

// 경기과 자리 · 당번 자리 고치기 — 언제든 바뀐다
// 오늘 안 나온 사람의 근태 · 지정 카트 — 화면이 아니라 그날의 사실이다
// 자리를 비운다 — 그 사람이 선 칸을 모두 빼고 제외인원으로 보낸다.
// 뒤 순번이 한 칸씩 당겨진다. 되돌리기 한 번으로 그대로 돌아온다
function vacateSeats(n, wasTag){
  var from = [], seen = {};
  DAY.forEach(function(p){
    var hit = false, i;
    for (i = p.roster.length - 1; i >= 0; i--)
      if (p.roster[i].n === n) { p.roster.splice(i, 1); hit = true; }
    if (hit && !seen[p.key]) { seen[p.key] = 1; from.push(p.key); }
  });
  ABSFROM[n] = { pks: from, tag: wasTag || '' };
  TOUCHED = from.slice();
  if (from.length && OFFDUTY.indexOf(n) < 0) OFFDUTY.push(n);
  return from.length
    ? ' · ' + from.map(function(k){ return part(k).name; }).join('·')
      + ' 자리를 비웁니다 — 뒤 순번이 당겨집니다'
    : '';
}
// 배지를 떼면 있던 부의 맨 뒤로 돌아온다. 어느 칸에 설지는 순번 세우기가 잡는다
function returnSeats(n){
  var rec = ABSFROM[n] || { pks: [], tag: '' };
  delete ABSFROM[n];
  if (rec.tag) TAG[n] = rec.tag; else delete TAG[n];
  TOUCHED = rec.pks.slice();
  if (!rec.pks.length) return '';
  var k = OFFDUTY.indexOf(n);
  if (k >= 0) OFFDUTY.splice(k, 1);
  rec.pks.forEach(function(pk){
    var p = part(pk);
    if (p.roster.some(function(r){ return r.n === n; })) return;
    p.roster.push({ n: n, tag: '', off: false, role: '' });
  });
  return ' · ' + rec.pks.map(function(pk){ return part(pk).name; }).join('·') + ' 대기 뒤로 돌아옵니다';
}
// 세운 뒤에 근태가 바뀌었나 — 자리가 실제로 움직인 부만 센다.
// 3부 사람이 쉬어도 1·2부 순번은 안 흔들리고,
// 자리가 없던 사람의 배지만 바뀌면 아무것도 안 움직인다
var TOUCHED = [];
function attTouch(pks){
  if (!LNPKS) return;
  var hit = (pks || []).some(function(k){ return LNPKS.indexOf(k) >= 0; });
  if (hit) ATTCH++;
}
// ★센 것만으로는 못 믿는다 — 되돌리기를 하면 셈은 남지만 자리는 돌아온다.
// 그래서 셈이 있고 '지금 자리가 순번과 실제로 다를 때'만 알린다.
// 고칠 것이 없으면 아무 말도 안 하는 편이 낫다
function driftN(){
  if (!LNPKS || !ATTCH) return 0;
  var st = driftStart();
  if (!st) return 0;
  var pl = lineupPlan(st, LNPKS);
  return (pl && pl.moved) ? ATTCH : 0;
}
function driftPks(){ return LNPKS || []; }
function driftName(){ return lineupKind(driftPks()) === 'bu3' ? '3부' : '1·2부'; }
function driftStart(){ return lineupKind(driftPks()) === 'bu3' ? bu3Start() : seonbal(); }
function driftKeep(){ ATTCH = 0; }          // '그대로 둡니다' — 자리는 안 건드린다

function setAbsent(n, t){
  var was = tagOf(n), extra = '';
  // ★'근무'는 쉬던 것을 푸는 단추다. 조출·당번 같은 배지까지 지우면 안 된다
  if (!t && !isAbs(was)) { if (!batchOn()) toast(n + '은(는) 이미 근무입니다'); return false; }
  var b = whereMap(); snap();
  if (isAbs(t) && !isAbs(was))      { TAG[n] = t; extra = vacateSeats(n, was); }
  else if (!isAbs(t) && isAbs(was)) { extra = returnSeats(n); }
  else if (t)                       { TAG[n] = t; }
  else                              { delete TAG[n]; }
  attTouch(TOUCHED); TOUCHED = [];
  commit(n + ' ' + (was || '근무') + ' → ' + (t || '근무') + extra, b);
  return true;
}
// 그날의 구분을 붙이거나 뗀다. 같은 것을 또 누르면 뗀다.
// ★자리는 안 움직인다 — 다만 배지가 붙으면 순번 셈에서 빠지므로 어긋남에는 센다
// ★배지 하나를 갈아 끼우는 속살. 자리 비우기·돌려주기·칸 꼬리표까지 한 묶음이다.
//   찍기(snap)와 마무리(commit)는 부르는 쪽이 한다 — 자리 하나 고치면서
//   배지도 같이 바뀌는 길(경기과 마샬)이 있어서 한 걸음으로 묶어야 하기 때문이다.
//   ★자리에 붙는 말(조출·후출·정출·찾근)은 '순번은 내가 정한다'는 뜻이고,
//     맡은 일(배치·프리)은 '오늘 캐디 근무는 안 한다'는 뜻이다.
//     둘 다 붙는 순간 어제 자리에서 내려오고, 떼면 있던 부 뒤로 돌아온다.
//     안 그러면 지정도 안 한 사람이 어제 순번 그대로 배치표에 앉아 있고,
//     그 칸이 순번 세우기의 셈에서 빠져 뒤쪽 사람들이 자리를 못 받는다
function applyDayTag(n, t){
  var was = tagOf(n);
  if (was === t) return '';
  var extra = '', wasSeat = offBoardTag(was), nowSeat = offBoardTag(t);
  if (nowSeat && !wasSeat)       extra = vacateSeats(n, '');
  else if (!nowSeat && wasSeat)  extra = returnSeats(n);
  if (t) TAG[n] = t; else delete TAG[n];   // returnSeats 가 TAG 를 건드리므로 그 뒤에
  // ★꼬리표는 두 군데 산다 — 근무표가 보는 TAG 와 배치표 칸이 보는 roster[i].tag.
  // 한 군데만 고치면 화면 둘이 서로 딴말을 한다
  DAY.forEach(function(p){
    p.roster.forEach(function(r, ix){
      if (r.n !== n) return;
      if (DAYTAGS.indexOf(r.tag) >= 0 || !r.tag || t) r.tag = t;
      markDirty(p.key, ix);
    });
  });
  return extra;
}
// ── 경기과 마샬 = 근무표의 '배치' ───────────────────────
// ★마샬 자리에 든 캐디는 그날 경기과에서 마샬로 선다. 캐디 근무는 안 한다.
//   그것이 근무표에서 '배치'다 — 같은 사실이니 두 번 적게 두면 안 된다.
//   자리가 정본이고 배지는 따라온다. 거꾸로는 아니다 —
//   '배치'는 마샬 말고 다른 까닭으로도 붙으니 배지가 자리를 만들지는 않는다.
var STAFFTAG = '배치';
function marshalNames(){
  var out = [];
  STAFF.forEach(function(x){
    // ★칸 이름이 아니라 '명부에 있는 사람이냐'로 가른다.
    //   경기팀장·주임은 캐디가 아니라 hasCaddie 에서 저절로 걸린다 —
    //   그 자리에 캐디가 대신 서면 그날은 그 사람도 경기과에서 일하는 것이니 '배치'다.
    //   예전엔 k==='마샬' 만 세어서, 대리·주임 칸에 넣은 캐디에게는 배지가 안 붙었다
    if (x.n && hasCaddie(x.n) && out.indexOf(x.n) < 0) out.push(x.n);
  });
  return out;
}
// 자리에서 빠진 사람의 배치를 떼고, 자리에 있는 사람에게는 붙여 놓는다.
// ★남의 배지는 안 덮는다 — 휴가 간 사람을 마샬 칸에 넣었다고 휴가가 없어지면 안 된다.
//   붙이지 못한 것은 소리 내어 말한다. 조용히 지나가면 사람이 못 알아챈다
function syncStaffTag(was, now){
  var on = [], off = [], skip = [];
  // ★떼는 쪽은 차분이라야 한다. '배치'는 마샬 말고 다른 까닭으로도 손으로 붙이니,
  //   자리에 없다고 남의 배치까지 걷어내면 안 된다. 자리에서 빠진 사람만 본다
  was.forEach(function(n){
    if (now.indexOf(n) >= 0) return;
    if (tagOf(n) !== STAFFTAG) return;       // 그 사이 사람이 바꿔 놓았으면 그대로 둔다
    applyDayTag(n, '');
    off.push(n);
  });
  // ★붙이는 쪽은 차분이면 안 된다 — 여기가 구멍이었다.
  //   '이번에 새로 들어온 사람'만 보면, 이미 자리에 앉아 있던 사람의 배지가
  //   빠져 있을 때 영영 안 고쳐진다. 허웅진이 그랬다 — 씨앗부터 마샬이라
  //   바꾸기 전에도 뒤에도 마샬이어서 늘 걸러졌다.
  //   자리가 정본이니 볼 때마다 맞춰 놓는다
  now.forEach(function(n){
    var t = tagOf(n);
    if (t === STAFFTAG) return;              // 이미 붙어 있다
    if (t) { skip.push(n + '은(는) ' + t); return; }
    applyDayTag(n, STAFFTAG);
    on.push(n);
  });
  var m = '';
  if (on.length)   m += ' · ' + on.join('·') + ' ' + STAFFTAG;
  if (off.length)  m += ' · ' + off.join('·') + ' ' + STAFFTAG + ' 뗌';
  if (skip.length) m += ' · ' + skip.join(' / ') + '라 ' + STAFFTAG + '를 안 붙였습니다';
  return m;
}
// ★판을 열 때 한 번 맞춰 놓는다. 옛 저장본에는 마샬 자리만 있고 배지가 없다 —
//   자리를 건드릴 때만 고치면, 안 건드린 사람은 영영 어긋난 채로 남는다.
//   찍기(snap)도 마무리(commit)도 안 한다 — 되돌릴 '고침'이 아니라 아귀를 맞추는 일이다
function reconcileStaff(){ return syncStaffTag([], marshalNames()); }
// ★마샬 칸을 비운다. 경기팀장·주임은 그대로 둔다 —
//   거의 안 바뀌는 자리라 날마다 다시 넣게 하면 손만 간다.
//   자리만 비우면 된다. 배지는 clearDayMarks 가 이미 떼 갔다
function clearMarshals(){
  var n = 0;
  // ★마샬 칸은 통째로 비운다. 대리·주임 칸은 거의 안 바뀌니 그대로 두되,
  //   거기 캐디가 대신 서 있었다면 그건 그날치라 같이 비운다 —
  //   안 비우면 다음 날에도 '배치'가 다시 붙어 그 사람이 근무에서 빠진다
  STAFF.forEach(function(x){
    if (!x.n) return;
    if (x.k === '마샬' || hasCaddie(x.n)) { x.n = ''; n++; }
  });
  return n;
}
// 경기과 자리를 건드리는 길은 모두 여기를 지난다 — 자리와 배지가 갈라지지 않게
function staffEdit(fn){
  var was = marshalNames();
  fn();
  return syncStaffTag(was, marshalNames());
}
// 사람 하나 = 덩어리 하나. 두 부에서 뛰든 세 부에서 뛰든 이름은 한 번만 나온다
// ★마샬은 날마다 몇이 서는지 다르다 — 칸을 늘리고 줄일 수 있어야 한다.
//   대리·주임은 자리 자체가 고정이라 늘리고 줄이는 것은 마샬뿐이다
function addMarshal(){
  var b = whereMap(); snap();
  STAFF.push({ k: '마샬', sub: '', n: '', fix: false, t: '12:00' });
  commit('경기과 마샬 칸 하나 늘림 — 눌러서 이름을 넣으십시오', b);
  return STAFF.length - 1;
}
function marshalSlots(){ var n = 0; STAFF.forEach(function(x){ if (x.k === '마샬') n++; }); return n; }
function delMarshal(i){
  var x = STAFF[i];
  if (!x || x.k !== '마샬') { toast('마샬 칸만 없앵 수 있습니다'); return false; }
  var b = whereMap(); snap();
  var was = x.n;
  // ★이름이 들어 있는 칸을 없애면 그 사람의 '배치'도 같이 떨어져야 한다
  var extra = staffEdit(function(){ STAFF.splice(i, 1); });
  commit('경기과 마샬 칸 없앵' + (was ? ' · ' + was : '') + extra, b);
  return true;
}
function setStaff(i, v, t){
  var b = whereMap(); snap();
  var was = STAFF[i].n, wt = STAFF[i].t;
  var extra = staffEdit(function(){
    STAFF[i].n = v;
    if (t) STAFF[i].t = t;
  });
  var rl = staffRole(i);
  commit('경기과 ' + STAFF[i].k + ' ' + (was || '비어 있음') + ' → ' + (v || '비움')
    + (t && t !== wt ? ' · 출근 ' + t : '')
    + (rl && rl.c !== 'jc' ? ' (' + rl.t + ')' : '') + extra, b);
  if (/안 붙였습니다/.test(extra)) toast(extra.replace(/^ · /, ''));
}
function setDayTag(n, t){
  var was = tagOf(n);
  if (isAbs(was)){
    if (!batchOn()) toast(n + '은(는) ' + was + '입니다 — 먼저 근태를 근무로 되돌리십시오');
    return false;
  }
  // ★선발은 그날의 구분이 아니라 순번의 시작점이다.
  //   덮어쓰면 순번 세우기가 시작할 곳을 잃고 소리 없이 멈춘다
  if (was === '선발'){
    if (!batchOn()) toast(n + '은(는) 선발입니다 — 먼저 다른 사람을 선발로 고르십시오');
    return false;
  }
  // ★같은 배지를 다시 누르면 떼는 것이 규칙이다. 그런데 중복 표시는 손으로 넣는 순간
  //   기계가 먼저 찍는다 — 사람이 '2,3'을 다시 지정하면 떼는 꼴이 된다. 그건 덫이다
  if (was === t && isDupTag(t) && partsOf(n).length >= 2) return false;
  if (was === t) t = '';
  if (was === t) return false;
  var b = whereMap(); snap();
  var extra = applyDayTag(n, t);
  attTouch(TOUCHED.length ? TOUCHED : partsOf(n)); TOUCHED = [];
  commit(n + ' ' + (was || '구분 없음') + ' → ' + (t || '구분 없음') + extra, b);
  return true;
}
// 주인 카트 — 좀처럼 안 바뀐다
function setCart(nm, v){
  var was = ownCart(nm), c = cartNum(v);
  if (was === c) return false;
  var b = whereMap(); snap();
  if (c) CART[nm] = c; else delete CART[nm];
  commit(nm + ' 주인 카트 ' + (was ? was + '번' : '없음') + ' → ' + (c ? c + '번' : '없음'), b);
  return true;
}
// ★오늘 타는 카트. 제 카트와 같으면 빌림이 아니므로 지운다 —
//   그래야 '빌림'이 늘 진짜 빌림만 가리킨다
function setCartToday(nm, v){
  var was = cartOf(nm), c = cartNum(v);
  if (was === c) return false;
  var b = whereMap(); snap();
  if (!c || c === ownCart(nm)) delete LEND[nm]; else LEND[nm] = c;
  var now = cartOf(nm);
  commit(nm + ' 오늘 카트 ' + (was ? was + '번' : '없음') + ' → '
    + (now ? now + '번' + (isLent(nm) ? ' (빌림)' : ' (제 카트)') : '없음'), b);
  return true;
}

// ══ 인턴 ═══════════════════════════════════════
// ★인턴 칸은 '티오프는 차지하되 정규 순번은 안 쓰는 자리'다(종이 배치표의 노란 칸).
//   빼지 않으면 인턴 하나당 그 뒤 전원의 순번이 한 칸씩 밀린다.
//   인턴은 조 편성 명단 밖 사람이라 총원·가용에도 안 든다 — 그날그날 섭외되고 이름은 손으로 친다.
function isItn(r){ return !!(r && r.itn); }
// 그 자리의 순번. 인턴이면 0 — 번호를 안 쓴다
function seatNo(p, i){
  var a = active(p), k = 0, j;
  // ★아직 줄이 없는 꼬리 칸. 여기서도 인턴이 쓴 자리는 빼고 세야 한다.
  //   'i + 1' 로 세던 탓에, 배치표가 대부분 비어 있는 날(줄보다 티오프가 많은 날)
  //   인턴을 끼워 넣으면 그 뒤 번호가 인턴 수만큼 건너뛰었다 — 10 다음이 13이었다
  if (!a[i]){
    for (j = 0; j < a.length; j++) if (!a[j].itn) k++;
    return k + (i - a.length) + 1;
  }
  if (a[i].itn) return 0;
  for (j = 0; j <= i; j++) if (!a[j].itn) k++;
  return k;
}
// 화면에 찍을 번호 글 — 인턴은 숫자 대신 '인턴'
function seatNoTx(p, i){ var k = seatNo(p, i); return k ? String(k) : '인턴'; }
// 아직 없는 맨 뒤 자리는 몇 번이 되나 — 인턴 칸은 순번을 안 쓰므로 빼고 센다
function nextSeatNo(p){
  return active(p).filter(function(r){ return !r.itn; }).length + 1;
}
function itnCount(p){ return active(p).filter(isItn).length; }
// 자리를 인턴으로 하거나 푼다. 이름은 손으로 친다(명부를 안 둔다)
function setIntern(pk, i, nm, on){
  var p = part(pk), a = active(p), r = a[i];
  nm = String(nm || '').trim();
  if (!on && !isItn(r)) { toast('인턴 칸이 아닙니다'); return false; }
  // 이미 인턴인데 이름도 그대로면 고칠 것이 없다 — 찍기 전에 돌려보낸다
  if (on && isItn(r) && (nm || '인턴') === r.n) return false;
  var b = whereMap(); snap();
  // 대기로 내려가거나 올라오는 사람을 세어 말에 쓴다
  function waitN(){
    var aa = active(p), c = 0;
    for (var k = p.tees.length; k < aa.length; k++) if (aa[k].n && !aa[k].itn) c++;
    return c;
  }
  var w0 = waitN(), msg;
  if (!on){
    // ★인턴을 풀면 그 줄이 없어진다 — 끼워 넣은 것의 반대다.
    //   줄만 남기고 딱지를 떼면, 명부에 없는 이름이 캐디 순번을 하나 차지해 버린다
    var j0 = p.roster.indexOf(r);
    if (j0 >= 0) p.roster.splice(j0, 1);
    msg = p.name + ' ' + (r.n || '빈 자리') + ' 인턴 뺌 — 뒤 캐디가 한 칸씩 앞 티오프로 옵니다';
  } else if (r && r.itn){
    // ★이미 인턴인 칸이면 이름만 고친다 — '이름 고치기'가 이 길로 온다.
    //   여기서 끼워 넣으면 누를 때마다 인턴이 하나씩 늘어난다
    var wasn = r.n;
    r.n = nm || '인턴';
    msg = p.name + ' 인턴 이름 ' + wasn + ' → ' + r.n;
  } else if (r && !r.n && !r.itn){
    // 빈 줄이면 그 줄을 쓴다 — 밀어 낼 사람이 없다
    r.n = nm || '인턴'; r.tag = ''; r.role = ''; r.itn = true;
    msg = p.name + ' ' + (i + 1) + '번째 빈 칸에 인턴 넣음(' + r.n + ')';
  } else if (r){
    // ★끼워 넣는다. 여기 앉아 있던 캐디는 자리를 안 잃는다 — 한 칸 뒤로 갈 뿐이다
    p.roster.splice(p.roster.indexOf(r), 0,
      { n: nm || '인턴', tag: '', off: false, role: '', itn: true });
    msg = p.name + ' ' + (i + 1) + '번째 칸에 인턴 끼워 넣음(' + (nm || '인턴') + ')'
      + (r.n ? ' · ' + r.n + '은(는) 한 칸 뒤로 갑니다' : '');
  } else {
    while (active(p).length < i) p.roster.push({ n: '', tag: '', off: false, role: '' });
    p.roster.push({ n: nm || '인턴', tag: '', off: false, role: '', itn: true });
    msg = p.name + ' ' + (i + 1) + '번째 칸에 인턴 넣음(' + (nm || '인턴') + ')';
  }
  var dw = waitN() - w0;
  markDirty(pk, i); attTouch([pk]);
  commit(msg + ' · 인턴은 순번을 안 씁니다 — 캐디 번호는 그대로입니다'
    + (dw > 0 ? ' · 뒤 ' + dw + '명이 대기로 내려갑니다'
              : (dw < 0 ? ' · 대기 ' + (-dw) + '명이 근무로 올라옵니다' : '')), b);
  return true;
}
// ── 한꺼번에 지정 ───────────────────────────
// ★한 명씩 창을 열어 누르면 서른 명이면 창을 서른 번 연다.
//   그래서 '무엇을 붙일지'를 먼저 못 박아 놓고, 이름만 차례로 누른다.
//
// ★켜 놓은 동안은 되돌릴 자리를 늘 들고 있는다 — base(켠 순간, 또는 마지막 저장한 순간).
//   그래야 끄면서 '초기화'를 눌러도 저장해 둔 것까지 날아가지 않는다.
// ★'고르기'는 배지가 아니라 '아직 안 정했다'는 뜻이다 — 이름부터 고르고 나중에 정한다
var PICKTAG = '@pick';
var BULKTAGS = [PICKTAG, '휴무', '휴가', '병가', '조출', '후출', '찾근', '프리', ''];
var BULK = null;    // { tag, base, was:{이름:켤 때 배지}, order:[이름], steps, kept, pick, changed }

function bulkOn(){ return !!BULK; }
function bulkTag(){ return BULK ? BULK.tag : null; }
function bulkSteps(){ return BULK ? BULK.steps : 0; }
function bulkLabel(t){ return t === PICKTAG ? '캐디 선택' : (t ? t : '근무로'); }
function bulkPicking(){ return !!BULK && BULK.tag === PICKTAG; }
function bulkPicked(){ return (BULK && BULK.pick) || []; }
function bulkPickHas(n){ return bulkPicked().indexOf(n) >= 0; }
function bulkPickTap(n){
  var L = BULK.pick, i = L.indexOf(n);
  if (i >= 0) L.splice(i, 1); else L.push(n);
  paint();                                 // 고르는 것은 아무것도 안 고치므로 commit 이 안 그려 준다
  return true;
}
function bulkPickClear(){ if (BULK) { BULK.pick = []; paint(); } }
// 손댄 것이 있나 — 배지를 바꿨거나(bulkDone) 자리를 넣고 뺐거나(changed)
function bulkChanged(){ return BULK ? BULK.changed : 0; }
function bulkDirty(){ return bulkDone().length + bulkChanged(); }
// ★고른 사람들에게 한꺼번에 배지를 붙인다 — 되돌리기 한 번이면 통째로 돌아온다
function bulkApplyTag(t){
  var L = bulkPicked().slice();
  if (!BULK) return false;
  if (!L.length) { toast('먼저 캐디를 선택하십시오'); return false; }
  batchStart();
  // ★배지를 떼면 그 사람은 있던 부의 대기 뒤로 돌아온다 — 배치표에 이름이 새로 뜬다.
  //   한꺼번에 할 때 그 말을 안 하면 "아무도 배치 안 했는데 왜 올라와 있지"가 된다
  var seat0 = 0;
  DAY.forEach(function(q){ active(q).forEach(function(r){ if (r.n) seat0++; }); });
  var ok = 0, no = [];
  L.forEach(function(n){
    if (!(n in BULK.was)) { BULK.was[n] = tagOf(n); BULK.order.push(n); }
    var r = (isAbs(t) || !t) ? setAbsent(n, t) : setDayTag(n, t);
    if (r !== false) ok++; else no.push(n);
  });
  var seat1 = 0;
  DAY.forEach(function(q){ active(q).forEach(function(r){ if (r.n) seat1++; }); });
  BULK.steps++;
  batchEnd('선택한 ' + L.length + '명 → ' + (t || '근무') + ' · ' + ok + '명 바뀜'
    + (seat1 > seat0 ? ' · 배치표 대기 뒤로 ' + (seat1 - seat0) + '명 돌아왔습니다(순번은 아직 안 정해졌습니다)'
       : seat1 < seat0 ? ' · 배치표에서 ' + (seat0 - seat1) + '명 자리를 비웠습니다' : '')
    + (no.length ? ' · ' + no.length + '명은 못 바꿨습니다(' + no.slice(0, 3).join(' ') + ')' : ''));
  return true;
}
// ★고른 사람들의 '오늘 어느 부' 를 한 번에 켜고 끈다.
//   배치표 명단은 안 건드린다 — 자리는 배치표에서 잡는다
function bulkApplyPlan(pk, on){
  var L = bulkPicked().slice();
  if (!BULK) return false;
  if (!L.length) { toast('먼저 캐디를 선택하십시오'); return false; }
  batchStart();
  var ok = 0;
  L.forEach(function(n){ if (setPlan(n, pk, on) !== false) ok++; });
  BULK.steps++;
  BULK.changed += ok;
  batchEnd(part(pk).name + ' 근무 지정 ' + (on ? '붙임 ' : '뗌 ') + ok + '명'
    + ' · 선택한 ' + L.length + '명 중 · 배치표 자리는 그대로');
  return true;
}
// ★중복 근무는 배지가 아니라 '두 부에 자리가 있다'는 사실이다 — 그래서 부에 넣고 뺀다
function bulkApplyPart(pk, on){
  var L = bulkPicked().slice();
  if (!BULK) return false;
  if (!L.length) { toast('먼저 캐디를 선택하십시오'); return false; }
  batchStart();
  var ok = 0;
  L.forEach(function(n){
    var has = partsOf(n).indexOf(pk) >= 0;
    if (on && !has) { if (addRow(pk, n) !== false) ok++; }
    else if (!on && has) { if (delFromPart(pk, n) !== false) ok++; }
  });
  BULK.steps++;
  BULK.changed += ok;
  batchEnd(part(pk).name + (on ? '에 ' : '에서 ') + ok + '명 ' + (on ? '넣음' : '뺌')
    + ' · 선택한 ' + L.length + '명 중'
    + (on && ok ? ' — 두 부에 서면 중복 근무입니다' : ''));
  return true;
}
// ★센 것을 믿지 않는다 — 눌렀다가 도로 눌러 제자리면 지정한 사람이 아니다.
//   되돌리기를 해도 이 셈은 저절로 맞는다
function bulkDone(){
  if (!BULK) return [];
  return BULK.order.filter(function(n){ return tagOf(n) !== BULK.was[n]; });
}
// 지금 그 배지를 달고 있는 사람 — 띠에 세는 것은 이쪽이다
function bulkSet(){
  if (!BULK) return [];
  var t = BULK.tag;
  return bulkDone().filter(function(n){ return tagOf(n) === t; });
}
function bulkKept(){ return BULK ? BULK.kept : []; }
// ★근무표의 찾기·거르개는 하나다.
//   '한꺼번에 지정'이 제 창을 따로 열고 거기 또 찾는 칸을 두던 것을 없앴다.
//   창이 혼자 하던 일 — '지금 그 배지인 사람만 보기' — 는 거르개 칩 하나가 대신한다
var BULKFIL = '*now';
function bulkFilName(){
  var t = bulkTag();
  return t ? '지금 ' + bulkLabel(t) : '손댄 사람';
}
// ★방금 누른 사람이 목록에서 달아나면 다음 누름이 엉뚱한 데 간다.
//   배지를 뗀 사람도 이번에 손댄 사람이면 자리에 남긴다
function bulkTouched(){ return (BULK && BULK.order) || []; }
function bulkFilHas(n){
  if (!bulkOn() || bulkPicking()) return true;
  // ★bulkDone() 이 아니라 손댄 사람 전부다. 배지를 도로 뗀 사람은 bulkDone() 에서
  //   빠지므로, 그걸 쓰면 뗀 순간 줄이 달아나 다음 누름이 엉뚱한 데 간다
  if (bulkTouched().indexOf(n) >= 0) return true;
  var t = bulkTag();
  return !!t && tagOf(n) === t;
}
function bulkFilDef(){
  if (!bulkOn() || bulkPicking()) return null;
  return [BULKFIL, bulkFilName(),
    workRows().filter(function(r){ return bulkFilHas(r.n); }).length];
}
// 근무표 한 줄이 찾기와 거르개를 지나는가 — 두 화면이 같은 자를 쓴다
function wkKeep(r, fil, q){
  if (!r) return false;
  if (fil === BULKFIL){ if (!bulkFilHas(r.n)) return false; }
  else if (fil && r.cls !== fil) return false;
  return !q || r.n.indexOf(q) >= 0;
}
// 여기까지가 '없던 일'로 칠 수 있는 자리다.
// ★저장한 사람은 셈에서 지우지 않고 '저장함'으로 옮긴다 —
//   띠가 0명으로 비면 저장한 것이 아니라 초기화된 것처럼 보인다
function bulkBase(){
  if (!BULK) return;
  bulkSet().forEach(function(n){ if (BULK.kept.indexOf(n) < 0) BULK.kept.push(n); });
  BULK.base = state(); BULK.was = {}; BULK.order = []; BULK.steps = 0; BULK.changed = 0;
}
function bulkStart(t){
  if (BULK){
    if (BULK.tag === t) return false;      // 같은 것을 또 누르면 화면이 끄기를 묻는다
    BULK.tag = t; paint();
    toast('이제 ' + bulkLabel(t) + ' 지정합니다 — 이름을 누르십시오');
    return true;
  }
  BULK = { tag: t, base: state(), was: {}, order: [], steps: 0, kept: [],
    pick: [], changed: 0 };
  paint();
  toast(bulkLabel(t) + ' 지정 중 — 이름을 차례로 누르십시오');
  return true;
}
// 이름 하나. 이미 그 상태면 뗀다 — 잘못 누른 사람은 한 번 더 눌러 뺀다
function bulkTap(n){
  if (!BULK) return false;
  if (bulkPicking()) return bulkPickTap(n);      // 고르기 중에는 표만 한다
  var t = BULK.tag, was = tagOf(n), ok;
  if (!(n in BULK.was)) { BULK.was[n] = was; BULK.order.push(n); }
  if (isAbs(t) || !t) ok = setAbsent(n, (was === t) ? '' : t);
  else                ok = setDayTag(n, t);
  if (ok !== false) BULK.steps++;
  return ok !== false;
}
// ★되돌리기는 '바로 직전 한 사람'만 되돌린다 — 켜기 전까지 파고들지 않는다
function bulkUndo(){
  if (!BULK || BULK.steps <= 0) { toast('되돌릴 지정이 없습니다'); return false; }
  BULK.steps--;
  undo();
  return true;
}
function bulkSave(){
  if (!BULK) return false;
  var n = bulkDirty();
  daySave();                               // 저장 안에서 bulkBase() 까지 옮긴다
  paint();
  toast(n + '명 지정을 저장했습니다 · 모두 ' + bulkKept().length
    + '명 · 이어서 더 하셔도 됩니다');
  return true;
}
// 끄면서 되돌린다 — 저장한 뒤 지정한 것만 없던 일이 된다
function bulkReset(){
  if (!BULK) return 0;
  var n = bulkDirty(), b = BULK.base;
  BULK = null;
  if (n){
    snap();
    restore(b);
    cfgSave(); draftPut();
  }
  paint(); resyncSheet();
  toast(n ? n + '명 지정을 되돌렸습니다 · 되살리려면 되돌리기' : '한꺼번에 지정을 껐습니다');
  return n;
}
function bulkOff(){                        // 되돌릴 것이 없을 때 — 그냥 끈다
  BULK = null; paint();
}

// ── 오늘 누가 어디 있나 ─────────────────────
// ★화면 얘기가 아니라 그날의 사실이다. 두 화면이 같은 답을 봐야 한다
function workRows(){
  var idx = peopleIndex(), out = [];
  idx.order.forEach(function(nm){
    var seats = idx.map[nm], st, cls, tag = '', chip = null;
    if (!seats.length){
      var t0 = tagOf(nm);
      cls = absCls(absOf(nm));
      // ★자리는 없어도 '오늘 어느 부에서 일하나'는 정해 둘 수 있다.
      //   그것이 근무표가 하는 말이다 — 배치표에 줄이 있다는 뜻이 아니다
      if (cls === 'u') {
        // ★찾근은 '아직 안 정했다'가 아니라 '본인이 고르는 중'이다.
        //   경기과가 자리를 짜 줘야 하는 사람과, 본인이 골라 올 사람은 다르다
        st = planText(nm) || (t0 === '찾근' ? '순번 고르는 중' : '미배치');
        tag = seatTag(t0) ? t0 : '';
      }
      // ★왜 자리가 없는지 적는다 — 당번을 서느라 못 뛰는 것과 그냥 자리가 없는 것은 다르다.
      //   배치·프리처럼 까닭이 배지에 이미 적혀 있으면 그 말을 그대로 쓴다.
      //   배치는 자리를 못 받은 것이 아니라 오늘 경기과에서 마샬로 서는 것이다 —
      //   '자리 없음'이라고 하면 못 앉힌 것처럼 읽혀 거짓말이 된다.
      //   배지와 같은 말이 되면 줄에 한 번만 나온다(그리는 쪽이 겹치면 지운다)
      // ★배지와 같은 말을 넣는다 — 그리는 쪽이 겹치는 것을 지워 배지 하나만 남는다.
      //   여태는 배지가 '흡연실 당번', 상태가 '당번 중'이라 한 줄에 두 번 적혔다
      else if (cls === 'o') st = (blockDuty(nm) && !canRound(nm)) ? (blockMarks(nm)[0] || '당번')
        : (offBoardTag(t0) ? t0 : '자리 없음');
      else st = absOf(nm);
    }
    else {
      var ps = [], working = false, allOff = true, ex = '';
      seats.forEach(function(x){
        if (ps.indexOf(x.part) < 0) ps.push(x.part);
        if (x.label.indexOf('결근') < 0){ allOff = false; if (x.label.indexOf('대기') < 0) working = true; }
      });
      DAY.forEach(function(p){ p.roster.forEach(function(r){ if (r.n === nm && r.tag && !ex) ex = r.tag; }); });
      // ★자리에 앉았어도 '아직 자리 없는 지정'은 따로 말해 준다 —
      //   1부에 앉고 3부도 하기로 한 사람은 그 3부가 안 보이면 잊힌다
      var pt = planText(nm);
      if (allOff){ st = '결근'; cls = 'a'; }
      // ★상태도 배지와 같은 말을 쓴다 — 세 부면 54다. '1,2,3' 은 아무도 안 쓰는 말이다.
      //   이름 없는 겹침(1부·2부)은 중복 근무가 아니다 — 1부 선발이 2부 뒤에 다시
      //   붙는 보통 구조다. 이름을 안 짓고 자리를 그대로 적는다(끼워 넣기 목록이 쓴다)
      else if (working){
        var dn = dupText(ps);
        st = (dn || ps.map(function(k){ return part(k).name; }).join('\u00b7'))
          + (pt ? ' · ' + pt : '');
        cls = 'w'; tag = ex;
        // ★근무표 줄에는 이름 있는 중복(2,3 · 54)과 아직 자리 없는 지정만 적는다.
        //   '근무'·'1부'·'2부'·'3부'는 아무 말도 안 한다 — 근무표에 선 사람은 일하는 사람이다
        chip = dn ? (dn + (pt ? ' · ' + pt : '')) : (pt || '');
      }
      // ★'대기' 칩도 걷는다. 대기인지 근무인지는 배치표가 자리로 말하고,
      //   근무표에서는 거르개('대기 18')로 본다. 줄마다 붙으면 소음이다
      else { st = '대기' + (pt ? ' · ' + pt : ''); cls = 'd'; tag = ex; chip = pt || ''; }
    }
    out.push({ n: nm, st: st, cls: cls, tag: tag, bts: wkBadges(nm), cart: cartOf(nm),
      chip: (chip === null ? st : chip) });
  });
  return out;
}
// 근무표 숫자 — 머리(거르개)와 몸통(집계)이 같은 셈을 쓴다
function workTally(){
  var rows = workRows();
  var cnt = function(c){ return rows.filter(function(r){ return r.cls === c; }).length; };
  var cw = cnt('w'), cd = cnt('d'), ca = cnt('a'), cu = cnt('u'), total = rows.length;
  // ★가용 = 근무 + 대기 + 미배치. 미배치는 오늘 일할 수 있는 사람이라 제외인원이 아니다
  var av = cw + cd + cu;
  return { rows: rows, cnt: cnt, cw: cw, cd: cd, ca: ca, cu: cu,
    total: total, avail: av, exc: total - av,
    // 'o' = 오늘 배치표에 없고 쉬지도 않지만 배지가 붙은 사람(프리·배치·정출 …).
    // 이 칸이 있어야 거르개 숫자가 총원과 맞아떨어진다
    fdef: [['', '전체', total], ['w', '근무', cw], ['d', '대기', cd],
      ['u', '미배치', cu],
      ['r', '휴무', cnt('r')], ['v', '휴가', cnt('v')], ['s', '병가', cnt('s')],
      ['a', '결근', ca], ['o', '그 밖', cnt('o')]] };
}

// ── 카트 ────────────────────────────────────
// ★번호는 사람에게, 고장은 카트에 붙는다.
//   사람이 아니라 카트라서, 그 번호를 쓰는 사람 모두에게 빨갛게 떠야 한다
function setCartBad(c, on){
  if (!c) return false;
  if (!!CARTBAD[c] === !!on) return false;
  var b = whereMap(); snap();
  if (on) CARTBAD[c] = 1; else delete CARTBAD[c];
  commit(c + '번 카트 ' + (on ? '고장 — 못 씁니다' : '고침 — 다시 씁니다'), b);
  return true;
}
// 같은 번호를 이미 쓰는 사람
function cartUsers(c, except){
  var out = [];
  Object.keys(CART).forEach(function(n){ if (CART[n] === c && n !== except) out.push(n); });
  return out;
}

// ★한 부에서 카트가 놓일 수 있는 자리는 셋이다.
//   사용중 — 그 부에서 누가 타고 있다(주인이든 빌린 사람이든)
//   대기   — 주인이 그 부 대기에 있다. 안 타고 있지만 불리면 탄다
//   빔     — 아무도 안 탄다
//   그리고 고장은 그 셋보다 위다 — 부와 상관없이 못 쓴다
function cartRidersIn(pk){
  var p = part(pk), a = active(p), n = Math.min(p.tees.length, a.length), map = {}, i, c;
  for (i = 0; i < n; i++){
    c = cartOf(a[i].n);
    if (c) (map[c] = map[c] || []).push(a[i].n);
  }
  return map;
}
function cartWaitersIn(pk){
  var p = part(pk), a = active(p), map = {}, i, c;
  for (i = p.tees.length; i < a.length; i++){
    c = cartOf(a[i].n);
    if (c) (map[c] = map[c] || []).push(a[i].n);
  }
  return map;
}
function cartState(c, pk){
  if (!c) return 'free';
  if (cartBad(c)) return 'bad';
  if ((cartRidersIn(pk)[c] || []).length) return 'busy';
  if ((cartWaitersIn(pk)[c] || []).length) return 'wait';
  return 'free';
}
// 그 사람이 오늘 일하는 부 — 대기만 걸린 부는 안 센다
function workParts(nm){
  var out = [];
  DAY.forEach(function(p){
    var a = active(p), n = Math.min(p.tees.length, a.length), i;
    for (i = 0; i < n; i++) if (a[i].n === nm) { out.push(p.key); return; }
  });
  return out;
}
// 그 사람이 일하는 부 '전부'에서 빌 수 있는 번호. 일하는 부가 없으면 전 부에서 빈 것
function cartFreeFor(nm){
  var pks = workParts(nm);
  if (!pks.length) pks = DAY.map(function(p){ return p.key; });
  var mine = cartOf(nm);
  return allCarts().filter(function(c){
    if (c === mine) return false;
    if (cartBad(c)) return false;
    return pks.every(function(pk){ return cartState(c, pk) === 'free'; });
  });
}
// ★같은 부에서 한 카트를 둘이 타는 것 — 이건 사고다. 기계가 잡아야 한다
// 3부반이 1·2부에 앉아 있는 자리 — 대바·중복 근무면 정상이지만, 남은 찌꺼기일 수도 있다
function bu3Strays(){
  var out = [];
  DAY.forEach(function(p){
    if (p.key === '3') return;
    active(p).forEach(function(r, i){
      if (r.n && isBu3(r.n)) out.push({ pk: p.key, i: i, n: r.n,
        wait: i >= p.tees.length });
    });
  });
  return out;
}
function cartClashes(){
  var out = [];
  DAY.forEach(function(p){
    var riders = cartRidersIn(p.key);
    Object.keys(riders).forEach(function(c){
      if (riders[c].length > 1) out.push({ pk: p.key, cart: Number(c), who: riders[c] });
    });
  });
  return out;
}

// ★빈 칸에 놓는 것은 맞바꾸기가 아니라 옮기기다 — 바꿀 상대가 없다.
//   이름 없는 줄이 이미 있으면 거기에 앉히고(순번 그대로),
//   줄 자체가 없으면 그 부의 첫 빈 자리로 간다(가운데 구멍은 이 모델에 없다)
// 줄 자체가 없는 꼬리로 옮긴다 — 그 부의 첫 빈 자리에 선다
function moveToSeat(from, pk, i){
  var sp = part(from.pk), r = sp.roster[from.ri];
  if (!r || !r.n) return false;
  var tp = part(pk), nm = r.n;
  var b = whereMap(); snap();
  var row = { n: nm, tag: r.tag || '', off: false, role: r.role || '' };
  sp.roster.splice(from.ri, 1);                 // 먼저 있던 자리에서 뺀다
  var a = active(tp);
  if (i === undefined || i === null) i = a.length;
  if (i < a.length){                            // 그 자리에 줄이 있으면 그 앞에 끼운다
    tp.roster.splice(tp.roster.indexOf(a[i]), 0, row);
  } else {
    // ★고른 번호에 정확히 앉힌다 — 사이가 비면 빈 줄을 깔아 자리를 만든다.
    //   맨 뒤에 붙이면 '39번에 놓았는데 2번으로 갔다'가 된다
    while (active(tp).length < i) tp.roster.push({ n: '', tag: '', off: false, role: '' });
    tp.roster.push(row);
  }
  var at = active(tp).map(function(x){ return x.n; }).indexOf(nm);
  markDirty(pk, at);
  attTouch([from.pk, pk]);
  commit(nm + ' → ' + tp.name + ' ' + (at + 1) + '번', b);
  return true;
}
// ★사람만 빼고 칸은 남긴다 — 순번은 그대로 두고 거기에 다른 사람을 놓으려는 것이다.
//   명단에서 아예 빼는 것(delRow)과는 다르다. 그건 뒤 순번이 당겨진다
function clearSeat(pk, i){
  var p = part(pk), a = active(p), r = a[i];
  if (!r || !r.n) return false;
  var b = whereMap(); snap();
  var was = r.n;
  r.n = ''; r.tag = ''; r.role = '';
  markDirty(pk, i);
  // ★뺀 사람은 미배치로 남는다 — 안 그러면 근무표에서 아예 사라진다
  var extra = '';
  if (!partsOf(was).length){
    if (OFFDUTY.indexOf(was) < 0) OFFDUTY.push(was);
    extra = ' · ' + was + '은(는) 미배치가 됩니다';
  }
  attTouch([pk]);
  commit(p.name + ' ' + (i + 1) + '번 ' + was + ' 자리 비움 — 순번은 그대로입니다' + extra, b);
  return true;
}

// ★한 사람이 두 부를 뛰면 앞 라운드가 끝나야 뒤 티오프에 설 수 있다.
//   순번은 팀이 늘고 줄어도 지켜지지만 시각은 재매칭된다 — 그래서 조용히 겹친다.
//   사람은 두 부를 나란히 놓고 못 본다. 기계가 본다
var ROUNDMIN = 270;                        // 한 라운드로 잡는 시간(분) — 4시간 30분
function setRoundMin(v){
  var m = Math.max(60, Math.min(600, Math.floor(Number(v) || 0)));
  if (m === ROUNDMIN) return false;
  ROUNDMIN = m; cfgSave(); paint();
  toast('한 라운드를 ' + Math.floor(m / 60) + '시간 ' + (m % 60) + '분으로 봅니다');
  return true;
}
function roundSeats(){                     // 이름 → 오늘 선 티오프들(시각순)
  var by = {};
  DAY.forEach(function(p){
    var a = active(p), n = Math.min(p.tees.length, a.length), i, t;
    for (i = 0; i < n; i++){
      t = p.tees[i];
      if (!t || t.cx || !a[i].n || a[i].off || a[i].itn) continue;
      (by[a[i].n] = by[a[i].n] || []).push({ pk: p.key, i: i, time: t.time, min: mm(t.time) });
    }
  });
  Object.keys(by).forEach(function(nm){
    by[nm].sort(function(x, y){ return x.min - y.min; });
  });
  return by;
}
function roundClashes(){
  var by = roundSeats(), out = [];
  Object.keys(by).forEach(function(nm){
    var L = by[nm], k;
    for (k = 1; k < L.length; k++){
      var gap = L[k].min - L[k - 1].min;
      if (gap < ROUNDMIN) out.push({ n: nm, a: L[k - 1], b: L[k], gap: gap });
    }
  });
  return out;
}
function gapText(m){
  var h = Math.floor(m / 60), r = m % 60;
  return (h ? h + '시간' + (r ? ' ' : '') : '') + (r ? r + '분' : (h ? '' : '0분'));
}

// ★중간에 끼워 넣는다 — 그 자리에 들어가고 뒤가 한 칸씩 밀린다.
//   맞바꾸기(rotateSeats)와 다른 일이다. 저쪽은 둘이 자리를 주고받아 아무도 안 밀린다.
//   조출·중복 근무처럼 순번을 사람이 못 박아야 하는 자리에 쓴다 — 그런 사람은
//   배지가 있어 순번 세우기가 안 건드린다(inLineup 이 걸러 낸다). 그래서 안 흔들린다
function insertAt(pk, i, nm){
  nm = String(nm || '').trim();
  if (!nm) return false;
  var p = part(pk);
  var b = whereMap(); snap();
  var extra = '';
  // 이미 이 부에 있으면 넣는 게 아니라 옮기는 것이다 — 먼저 빼고 번호를 다시 센다
  var a = active(p), had = a.map(function(r){ return r.n; }).indexOf(nm);
  if (had === i) { if (!batchOn()) toast(nm + '은(는) 이미 ' + (i + 1) + '번입니다'); return false; }
  if (had >= 0){
    p.roster.splice(p.roster.indexOf(a[had]), 1);
    if (had < i) i--;
  }
  // 쉬는 배지는 앉는 순간 근무로 돌린다. 조출·후출 같은 자리 배지는 그대로 둔다 —
  // 그 배지가 곧 '이 순번은 내가 정했다'는 표다
  if (isAbs(tagOf(nm))){
    var rec = ABSFROM[nm];
    if (rec && rec.tag) TAG[nm] = rec.tag; else delete TAG[nm];
    delete ABSFROM[nm];
    extra = ' · 근태를 근무로 바꿉니다';
  }
  if (i < 0) i = 0;
  a = active(p);
  var was0 = !!(a[i] && !a[i].n && !a[i].itn);      // 그 칸이 비어 있었나
  var row = { n: nm, tag: seatRowTag(nm), off: false, role: '' };
  // ★빈 줄이면 밀 것이 없다 — 그 칸을 채운다. 밀면 빈 줄이 뒤에 그대로 남는다
  if (a[i] && !a[i].n && !a[i].itn){
    a[i].n = nm; a[i].tag = seatRowTag(nm); a[i].off = false; a[i].role = '';
  }
  else if (i < a.length) p.roster.splice(p.roster.indexOf(a[i]), 0, row);
  else {
    // 꼬리보다 뒤를 고르면 사이를 빈 줄로 깔아 그 번호를 만든다
    while (active(p).length < i) p.roster.push({ n: '', tag: '', off: false, role: '' });
    p.roster.push(row);
  }
  var k = OFFDUTY.indexOf(nm);
  if (k >= 0) OFFDUTY.splice(k, 1);
  var at = active(p).map(function(x){ return x.n; }).indexOf(nm);
  markDirty(pk, at);
  attTouch([pk]);
  if (dupStamp(nm)) extra += ' · ' + dupPinWhy(nm);
  var pushed = was0 ? 0 : Math.max(0, active(p).length - at - 1);
  commit(p.name + ' ' + seatNo(p, at) + '번에 ' + nm + (was0 ? ' 앉힘(빈 칸)' : ' 끼워 넣음')
    + (!was0 && pushed ? ' · 뒤 ' + pushed + '명이 한 칸씩 밀립니다' : '') + extra, b);
  return true;
}
// ★칸을 짚고 '이 상태인 사람 전부 여기부터' — 어디에도 자리 없는 사람을 배지별로 묶는다.
//   쉬는 사람은 안 부른다.
// ★'다른 부에만 있는 사람'은 일부러 묶지 않는다 — 그건 서른 명이 되고, 한 번 누르면
//   서른 명이 쏟아진다. 중복 근무로 쓸 사람은 배지가 아니라 사람만 아는 값이라
//   끼워 넣기나 캐디 선택으로 골라 넣는다
// ★여기 들어오는 것은 '자리를 잡아 줘야 하는 사람'뿐이다 — 조출·후출과 중복 근무(54·2,3·1,3).
//   배치·당번·벌당·정출·찾근·프리는 아니다. 그것들은 자리를 정하는 값이 아니라
//   이미 자리가 있는 사람에게 붙는 말이다.
// ★DAYTAGS 를 가져다 쓰면 안 된다 — 그건 '순번 세우기가 안 건드리는 배지' 목록이지
//   '자리를 잡아 줘야 하는 사람' 목록이 아니다. 둘은 거의 같지만 같지 않다
var SEATGROUPTAGS = ['조출', '후출'];
function seatGroupTag(t){ return SEATGROUPTAGS.indexOf(t) >= 0 || isDupTag(t); }
// ★이 사람이 어느 묶음에 드나 — 없으면 ''.
//   ★자리가 곧 중복 근무다. 도장(TAG)만 보면 안 된다 — 도장은 오늘부터 찍기 시작했고,
//   그 전에 두 부에 앉혀 둔 사람에게는 없다. 그래서 묶음에 이가 빠졌다.
//   이 프로그램의 원칙이 '두 부에 자리가 있으면 그것이 중복 근무다'인데
//   정작 묶음만 도장을 보고 있었다
function seatGroupMark(n){
  var t = dayMark(n);
  if (t && seatGroupTag(t)) return t;                 // 조출·후출·54h·2,3 …
  if (t) return '';                                   // 배치·당번 같은 딴 배지
  var ps = partsOf(n);
  return ps.length >= 2 ? ps.join(',') : '';          // 배지가 없어도 두 부에 있으면 중복 근무다
}
// ★중복 표시는 어느 부인지까지 말한다 — '2,3'은 2부와 3부다. 1부 칸에서 부르면 안 된다.
//   '54h'는 부를 안 말한다(54홀) — 그때는 어느 부에서든 부른다
function dupParts(t){
  var m = String(t || '').match(/\d/g) || [];
  return m.filter(function(d){ return d === '1' || d === '2' || d === '3'; });
}
// ★묶음 이름이 말하는 부 — '1,3'은 1부와 3부, '54'는 그날 있는 부 전부.
//   화면이 이 부 색으로 띠를 그어 '무엇이 몇 명인지'를 글 없이 말한다
function sgParts(key){
  if (!isDupTag(key)) return [];
  var d = dupParts(key);
  if (d.length) return d;
  return DAY.map(function(q){ return q.key; });
}
// 그 묶음을 사람 말로 — '1부 · 3부'
function sgSub(key){
  var d = sgParts(key);
  if (!d.length) return '';
  return d.map(function(k){ var q = part(k); return q && q.key === k ? q.name : k + '부'; }).join(' · ');
}
// ★차례를 못 박는다 — 54가 먼저, 그 다음 두 부짜리, 그날의 구분은 뒤.
//   사람이 늘 같은 자리에서 같은 단추를 찾게 한다
function sgRank(k){ return !isDupTag(k) ? 2 : (sgParts(k).length >= 3 ? 0 : 1); }
function seatGroups(pk){
  var g = [], ix = {};
  function add(key, n){
    if (!(key in ix)) { ix[key] = g.length; g.push({ key: key, label: key, names: [] }); }
    g[ix[key]].names.push(n);
  }
  allPeople().forEach(function(n){
    if (isAbs(tagOf(n))) return;                      // 쉬는 사람은 안 부른다
    var m = seatGroupMark(n);
    if (!m) return;
    // ★자리가 있어도 부른다 — 이 부에 있으면 '여기로 옮기는 것'이지 새로 앉히는 것이 아니다.
    //   분류를 마친 사람은 이미 배치표에 앉아 있다. 자리가 없는 사람만 부르면
    //   정작 줄을 세워야 할 사람이 전원 걸러진다.
    // ★다른 부에만 있는 사람은 안 부른다 — 여기 넣으면 소리 없이 중복 근무가 된다.
    //   두 번 쓸 사람은 사람이 골라야 한다
    var ps = partsOf(n);
    if (isDupTag(m)){
      // ★이 부에 이미 있어도 부른다 — 자리를 여기로 옮기는 것이다.
      //   '이 부에 없는 사람만'으로 걸었더니 2·3을 둘 다 지정한 사람이
      //   아무 데서도 안 떴다 — 정작 줄을 세워야 할 사람이다
      var dp = dupParts(m);
      if (dp.length && dp.indexOf(pk) < 0) return;    // '2,3'을 1부 칸에서 부르지 않는다
    }
    else if (ps.length && ps.indexOf(pk) < 0) return; // 다른 부에만 있다
    add(m, n);
  });
  // ★다른 부에만 자리가 있는 사람은 안 부른다 — 여기 앉히면 중복 근무가 된다.
  //   한때 '2부→중복' 같은 묶음을 내어 줄줄이 앉힐 수 있게 했는데,
  //   그러면 그날 중복 근무가 아닌 그 부 사람이 통째로 후보에 올라왔다.
  //   중복 근무는 사람이 하나씩 고를 일이다 — 끼워 넣기로 넣는다
  g.sort(function(x, y){ return sgRank(x.key) - sgRank(y.key) || x.key.localeCompare(y.key, 'ko'); });
  return g;
}
function seatGroupNames(pk, key){
  var g = seatGroups(pk), hit = null;
  g.forEach(function(x){ if (x.key === key) hit = x; });
  return hit ? hit.names.slice() : [];
}
function seatGroupSeat(pk, i){
  var p = part(pk), no = seatNo(p, i);
  if (!no) no = Math.max(1, seatNo(p, i + 1) || (active(p).filter(function(r){ return !r.itn; }).length + 1));
  return no;
}
function seatGroup(pk, i, key, start){
  var names = seatGroupNames(pk, key);
  if (!names.length) { toast('그 상태로 부를 사람이 없습니다'); return false; }
  return seatMany(pk, seatGroupSeat(pk, i), names, start);
}
// ★순번(사람 번호)을 줄의 자리로 바꾼다 — 인턴 칸은 번호를 안 쓰므로 건너뛴다
function idxOfSeat(p, no){
  var a = active(p), i, k = 0;
  for (i = 0; i < a.length; i++) if (!a[i].itn && seatNo(p, i) === no) return i;
  // ★꼬리보다 뒤 번호다. 그 번호가 되는 자리를 셈해서 준다 —
  //   여태는 그냥 꼬리를 줬다. 그래서 줄이 없는 부(3부를 새로 짤 때)에서는
  //   '4번부터 앉히기'가 1번부터 앉았고, 비워 두려던 앞 순번이 먹혔다.
  //   사이는 insertAt 이 빈 줄로 깔아 그 번호를 만든다
  for (i = 0; i < a.length; i++) if (!a[i].itn) k++;
  return a.length + Math.max(0, no - k - 1);
}
// 차례는 조 편성이 정한다 — 고른 순서(누른 순서)는 사람이 기억 못 한다
function seatManyOrder(L, start){
  var pick = {};
  L.forEach(function(n){ pick[n] = 1; });
  var out = allPeople().filter(function(n){ return pick[n]; });
  L.forEach(function(n){ if (out.indexOf(n) < 0) out.push(n); });   // 조 편성 밖 사람은 뒤에
  // ★고른 사람부터 돈다 — 조 편성 차례를 그 사람 자리에서 끊어 앞뒤를 바꾼다.
  //   순번 세우기의 선발과 같은 규칙이다
  var i = start ? out.indexOf(start) : -1;
  if (i > 0) out = out.slice(i).concat(out.slice(0, i));
  return out;
}
// ★고른 사람들을 'N번부터' 줄줄이 앉힌다. 뒤는 한 칸씩 밀린다 — 아무도 자리를 잃지 않는다.
//   되돌리기는 한 번이다(묶음)
function seatMany(pk, from, names, start){
  var p = part(pk);
  var L = seatManyOrder((names || []).filter(function(n){ return n; }), start);
  if (!L.length) { toast('먼저 캐디를 선택하십시오'); return false; }
  from = Math.max(1, Math.floor(Number(from) || 1));
  var rest = L.filter(function(n){ return isAbs(tagOf(n)); }).length;   // 쉬는 사람은 근무로 돌아온다
  batchStart();
  var k = 0;
  L.forEach(function(n, j){
    if (insertAt(pk, idxOfSeat(p, from + j), n) !== false) k++;
  });
  var nums = [];
  L.forEach(function(n){
    var ix = active(p).map(function(r){ return r.n; }).indexOf(n);
    if (ix >= 0) nums.push(seatNo(p, ix));
  });
  nums.sort(function(x, y){ return x - y; });
  if (BULK) { BULK.steps++; BULK.changed += k; }
  batchEnd(p.name + ' ' + (nums.length ? nums[0] + '~' + nums[nums.length - 1] + '번에 ' : '')
    + k + '명 앉힘'
    + (L[0] ? ' · 첫 사람 ' + L[0] : '')
    + (rest ? ' · 쉬던 ' + rest + '명은 근무로 돌아왔습니다' : '')
    + ' · 순번 세우기는 배지 붙은 이 자리를 안 건드립니다');
  return k > 0;
}
// ★빈 칸에 사람을 앉힌다 — 자리를 내줄 상대가 없으니 맞바꾸기가 아니다.
//   줄이 있으면 그 줄에, 없으면 그 부 뒤에 붙인다
function seatPerson(pk, i, nm){
  nm = String(nm || '').trim();
  if (!nm) return false;
  var p = part(pk), r = active(p)[i];
  if (r && r.n) return false;                    // 빈 자리가 아니다
  var b = whereMap(); snap();
  var extra = '', t0 = tagOf(nm);
  if (isAbs(t0)){                                // 앉는 순간 쉬는 사람이 아니다
    var rec = ABSFROM[nm];
    if (rec && rec.tag) TAG[nm] = rec.tag; else delete TAG[nm];
    delete ABSFROM[nm];
    extra = ' · 근태를 근무로 바꿉니다';
  }
  // ★그날의 배지는 자리를 따라간다 — 안 그러면 조출인데 칸에 아무 표시가 없다
  var tg = seatRowTag(nm);
  // ★같은 부에 이미 서 있으면(대기로 넣어 둔 것) 옮기는 것이지 하나 더 만드는 것이 아니다.
  //   '부 넣기'가 대기로 들어가게 된 뒤로 이 길이 열렸다 — 1번과 대기에 둘이 됐다.
  //   있던 줄은 지우지 않고 '빈 칸'으로 남긴다. 지우면 뒤 순번이 통째로 당겨진다
  var dup = 0;
  p.roster.forEach(function(q){
    if (q === r || q.n !== nm) return;
    q.n = ''; q.tag = ''; q.role = ''; dup++;
  });
  if (dup) extra += ' · 이 부에 서 있던 자리는 비웁니다';
  if (r) { r.n = nm; r.tag = tg; r.off = false; r.role = ''; }
  else {
    // ★고른 번호에 정확히 앉힌다 — 사이가 비면 빈 줄을 깔아 자리를 만든다.
    //   맨 뒤에 붙이면 '35번을 골랐는데 2번으로 갔다'가 된다.
    //   깔아 둔 빈 줄은 순번 세우기가 채운다
    while (active(p).length < i) p.roster.push({ n: '', tag: '', off: false, role: '' });
    p.roster.push({ n: nm, tag: tg, off: false, role: '' });
  }
  var k = OFFDUTY.indexOf(nm);
  if (k >= 0) OFFDUTY.splice(k, 1);
  if (dup) trimBlanks(p);                        // 대기에 남은 빈 줄은 찌꺼기다
  var at = active(p).map(function(x){ return x.n; }).indexOf(nm);
  markDirty(pk, at < 0 ? i : at);
  attTouch([pk]);
  if (dupStamp(nm)) extra += ' · ' + dupPinWhy(nm);
  commit(p.name + ' ' + (at + 1) + '번에 ' + nm + ' 앉힘' + extra, b);
  return true;
}
// 배치표 칸에 실을 꼬리표 — 근태는 자리에 안 붙는다(자리를 비우는 값이니까)
function seatRowTag(nm){
  var t = tagOf(nm);
  return (!t || isAbs(t)) ? '' : t;
}

// ── 순번 세우기 ─────────────────────────────
// ★선발 한 사람을 정하면, 그 사람의 조 자리부터 조를 돌며(4조 끝나면 1조로)
// 배지 없는 하우스캐디가 차례로 선다. 1부를 채우고 남으면 2부로 이어지고,
// 사람이 모자라면 한 바퀴 더 돈다 — 두 부 뛰는 사람이 그렇게 생긴다.
//
// 배지가 붙은 사람(중복 근무·휴무·병가·3부·조출·후출·당번·배치·프리)은 건드리지 않는다.
// 그 자리는 경기과가 그날 사정을 보고 놓는 자리다.
//
// ★이건 정답이 아니라 출발점이다. 중복 근무가 늘 앞이라거나 하는 절대 규칙은 없고,
// 경기과가 상황에 따라 조절한다. 기계는 바탕을 깔아 줄 뿐 사람을 대신하지 않는다.
// (2026-08-30 · 08-31 두 날 배치표로 자리 57/57, 35/35 재현 확인)

// 오늘의 선발 — 한 사람뿐이다
function seonbal(){
  for (var i = 0; i < JONAMES.length; i++) if (TAG[JONAMES[i]] === '선발') return JONAMES[i];
  return '';
}
function setSeonbal(n){
  var was = seonbal();
  if (was === n) return false;
  var b = whereMap(); snap();
  if (was) delete TAG[was];
  if (n) TAG[n] = '선발';
  commit('선발 ' + (was ? was + ' → ' : '') + (n || '없음')
    + (n ? ' · 아직 자리는 그대로입니다 — 순번 세우기를 누르십시오' : ''), b);
  return true;
}
function joMembers(g){
  return JONAMES.filter(function(n){ return joOf(n) === g; });
}
// 선발부터 조를 도는 이름 차례 — 딱 한 바퀴
function joRing(startName){
  var g0 = joOf(startName);
  if (g0 < 0) return [];
  var mem = joMembers(g0), at = mem.indexOf(startName);
  if (at < 0) return [];
  var ring = mem.slice(at);
  for (var k = 1; k < JOCNT; k++) ring = ring.concat(joMembers((g0 + k) % JOCNT));
  return ring.concat(mem.slice(0, at));
}
// 도는 무리가 둘이다.
//   house : 1·2부 — 배지 없는 하우스캐디. '선발'도 넣는다(선발 본인 자리를 빼면
//           새 선발을 골라도 그 사람이 안 앉는다)
//   bu3   : 3부  — '3부' 배지를 단 사람끼리 따로 돈다. 1·2부 순환과 섞이지 않는다
function lineupKind(pks){
  return (pks.length === 1 && pks[0] === '3') ? 'bu3' : 'house';
}
// ★3부반은 하우스 셈에 아예 안 든다 — 오늘 배지가 없어도 안 든다.
// 그래야 시간이 지나고 배지가 지워져도 1·2부에 섞여 들어가지 않는다.
// 오늘 따로 배지가 붙은 사람(중복 근무·조출 …)은 두 무리 다에서 빠진다 — 그 자리는 사람이 놓는다
function inLineup(n, kind){
  if (dayMark(n)) return false;
  // ★당번은 순번이 아니라 당번이다.
  //   당번은 배지가 아니라 따로 사는 장부라(DUTY·줄의 role) dayMark 로는 안 걸린다.
  //   빼지 않으면 두 가지가 한꺼번에 어긋난다 —
  //   ① 당번인 사람이 순번에 빨려 들어가 라운드를 받고
  //   ② 당번 딱지는 '자리'에 붙어 있어서, 그 자리에 앉은 딴 사람에게 옮겨 붙는다.
  //   필요하면 관리자가 손으로 앉힌다 — 배지와 같은 규칙이다
  //   ★다만 '순번에 같이 세우는' 당번은 뺀다는 말이 안 된다. 그 사람은 오늘 근무한다 —
  //    빼 버리면 근무가 확정된 사람이 자리를 못 받는다.
  if (blockDuty(n)) return false;
  // ★손으로 만든 중복 근무는 관리자가 정한 것이다 — 기계가 흩지 않는다.
  //   여태는 '2,3' 같은 배지가 이 못 노릇을 했는데, 1·2부 짝은 배지가 없다
  if (dupPinned(n)) return false;
  return (kind === 'bu3') ? isBu3(n) : !isBu3(n);
}
// 순번에 왜 못 서는지 한마디로. 배지가 먼저고, 없으면 당번이다
function whyNoLineup(n){
  return dayMark(n) || (blockDuty(n) ? (dutyFull(n) || '당번') : '')
    || (dupPinned(n) ? (dupNow(n) ? dupNow(n) + ' 중복 근무' : dupPinText(n) + ' 두 자리') : '');
}
// 오늘 설 수 있는 사람 — 그 무리에 들고 배지가 없으면 다 후보다.
// ★'오늘 배치표에 있어야 한다'는 조건을 뺐다. 그 조건 때문에 자리가 없던 사람은
//   가용으로 세어지면서 순번에는 영영 못 섰다(실측 16명). 배치표에 없다는 것은
//   '오늘 안 나온다'가 아니라 '아직 안 넣었다'는 뜻이다 — 그건 미배치이고 가용이다.
// ★안 세우고 싶으면 배지를 붙인다(휴무·조출·프리 …). 부에서 빼는 것으로는 못 막는다
function lineupPool(kind){
  return JONAMES.filter(function(n){ return inLineup(n, kind); });
}
// ★3부의 시작점은 사람이 안 골라도 된다 — 어제 3부에서 일 못 한 첫 사람이다.
// 다만 그러려면 '어제'가 있어야 하는데 지금 저장은 하루치뿐이라, 오늘 명단으로만 짐작한다
function bu3Start(){
  if (SB3) return SB3;
  var p = part('3'), a = active(p);
  for (var i = 0; i < a.length; i++) if (inLineup(a[i].n, 'bu3')) return a[i].n;
  return '';
}
function setBu3Start(n){
  if (SB3 === n) return false;
  var b = whereMap(); snap();
  var was = SB3;
  SB3 = n;
  commit('3부 시작 ' + (was ? was + ' → ' : '') + (n || '없음')
    + (n ? ' · 아직 자리는 그대로입니다 — 3부 순번 세우기를 누르십시오' : ''), b);
  return true;
}
// 무엇이 어떻게 바뀌는지 미리 세워 본다 — 아직 아무것도 안 고친다
function lineupPlan(startName, pks){
  var okPool = {}, i, kind = lineupKind(pks);
  lineupPool(kind).forEach(function(n){ okPool[n] = 1; });
  var pool = joRing(startName).filter(function(n){ return okPool[n]; });
  if (!pool.length) return null;
  var slots = [];
  pks.forEach(function(pk){
    var p = part(pk), a = active(p);
    a.forEach(function(r, ix){
      if (r.itn) return;                       // ★인턴 칸은 사람이 못 박은 자리다
      // ★이름 없는 줄은 임자 없는 자리다 — 3부든 하우스든 그 줄은 채워야 한다.
      //   안 그러면 3부에서 자리를 비운 칸이 영영 빈 채로 남는다
      if (!r.n || inLineup(r.n, kind)) slots.push({ pk: pk, i: ix, from: r.n });
    });
    // ★비어 있는 티오프도 채운다. 사람이 모자라면 차례가 한 바퀴 더 돌고,
    // 그렇게 두 부 뛰는 사람이 생긴다 — 종이 배치표가 그렇게 만들어진다.
    // ★관리자가 깔아 둔 대기 자리도 여기 든다. '31번까지'라고 깔아 둔 것은
    //   티오프를 깔아 둔 것과 같다 — 채워야 할 자리다.
    //   사람이 남을 때만 서던 것이 아니라, 모자라면 차례가 한 바퀴 더 돌아 채운다
    var want = p.tees.length + spareCap(pk);
    for (var e = a.length; e < want; e++)
      slots.push({ pk: pk, i: e, from: '', add: true, wait: e >= p.tees.length });
  });
  // ★자리를 다 채우고도 사람이 남으면 마지막 부 뒤에 '대기'로 세운다.
  //   안 그러면 차례가 뒤인 사람들이 명단 밖(미배치)에 남아 '안 세워졌다'가 된다
  // ★마지막 부에 대기 한도를 안 정해 뒀으면, 남는 사람은 여태처럼 그 뒤에 다 세운다.
  //   정해 뒀으면 그것이 곧 '여기까지'다 — 그 밖으로는 안 세우고 미배치로 남긴다.
  //   미배치는 '오늘 못 나온다'가 아니라 '아직 자리를 안 줬다'이고 가용에 든다
  var lastPk = pks[pks.length - 1], lastP = part(lastPk);
  if (pool.length > slots.length && !spareCap(lastPk)){
    var back = Math.max(active(lastP).length, lastP.tees.length);
    var extra = pool.length - slots.length;
    for (i = 0; i < extra; i++)
      slots.push({ pk: lastPk, i: back + i, from: '', add: true, wait: true });
  }
  // ★한 사람은 한 부에 한 번만 앉는다.
  //   차례가 한 바퀴 더 돌 때 1·2부는 다음 부로 넘어가 두 부 뛰기가 되지만,
  //   묶음이 한 부뿐이면(3부) 넘어갈 데가 없어 제 부에 또 앉혔다 —
  //   한 사람이 같은 부에서 두 번 일하는 일은 없다. 그런 자리는
  //   티오프의 빈 칸처럼 비워 둔다 — 자리는 깔려 있고 사람만 없는 것이다.
  //   1·2부도 같은 규칙을 받는다: 한 부에 사람보다 많은 자리를 깔면 똑같이 빈다
  var used = {}, moved = 0;
  for (i = 0; i < slots.length; i++){
    var want2 = pool[i % pool.length];
    var seen = used[slots[i].pk] || (used[slots[i].pk] = {});
    slots[i].to = seen[want2] ? '' : want2;
    if (slots[i].to) seen[want2] = 1;
    if (slots[i].to !== slots[i].from) moved++;
  }
  return { start: startName, pool: pool, slots: slots, moved: moved,
    kind: kind,
    fixed: pks.map(function(pk){
      return { pk: pk, n: active(part(pk)).filter(function(r){ return r.n && (r.itn || !inLineup(r.n, kind)); }).length };
    }) };
}
function applyLineup(startName, pks){
  var plan = lineupPlan(startName, pks);
  if (!plan) { toast('조 편성이 없어 순번을 못 세웁니다'); return false; }
  LNPKS = pks.slice(); ATTCH = 0;
  // ★고른 사람이 오늘 배지 때문에 순번에 못 서면, 딴 사람이 1번이 된다.
  //   그걸 말 안 하면 "왜 저 사람이 앞이지"가 된다
  var real = plan.pool[0], off = (startName && real !== startName);
  if (off) toast(startName + '은(는) 오늘 ' + (whyNoLineup(startName) || '배지') + '이라 순번에 못 섭니다 — '
    + real + '부터 세웁니다');
  if (!plan.moved) { toast('이미 그 차례대로 서 있습니다'); return false; }
  var before = whereMap(); snap();
  // 자리를 먼저 붙잡아 둔다 — 이름을 바꾸는 동안 active() 가 흔들리면 안 된다
  var rows = plan.slots.filter(function(s){ return !s.add; }).map(function(s){
    var p = part(s.pk), r = active(p)[s.i];
    return { p: p, ri: p.roster.indexOf(r), to: s.to, i: s.i, pk: s.pk };
  });
  rows.forEach(function(x){
    if (x.ri < 0) return;
    if (x.p.roster[x.ri].n !== x.to) markDirty(x.pk, x.i);
    x.p.roster[x.ri].n = x.to;
  });
  // 빈 티오프는 줄을 새로 만들어 채운다 — 자리 차례대로 붙여야 순서가 안 엉킨다
  plan.slots.filter(function(s){ return s.add; })
    .sort(function(a, b2){ return (a.pk === b2.pk) ? a.i - b2.i : 0; })
    .forEach(function(s){
      part(s.pk).roster.push({ n: s.to, tag: '', off: false, role: '' });
      markDirty(s.pk, s.i);
    });
  // ★부른 사람 중 어디에도 줄이 없으면 미배치 명단에 남긴다.
  //   안 그러면 근무표에서 아예 사라진다 — 총원이 조용히 줄어든다
  var lost = 0;
  plan.pool.forEach(function(n){
    if (partsOf(n).length) return;
    if (OFFDUTY.indexOf(n) < 0) { OFFDUTY.push(n); lost++; }
  });
  commit((lineupKind(pks) === 'bu3' ? '3부 시작 ' : '선발 ') + startName
    + (off ? '(못 섬) → ' + real : '') + '부터 순번 세움 · '
    + pks.map(function(k){ return part(k).name; }).join('·')
    + ' ' + plan.moved + '자리 바뀜'
    + (lost ? ' · 대기 한도를 넘은 ' + lost + '명은 미배치로 남습니다(가용에 그대로 듭니다)' : ''), before);
  return true;
}

// ── 공지사항 — 캠디 총무 앱으로 보낼 글 ───────────
// ★아직 앱과 안 이어졌다(2026-09-11). 여기서는 '무엇을 보낼지'까지만 만든다.
//   보내는 길이 뚫리면 noticeSend() 한 곳만 고치면 된다 — 화면은 안 건든다.
//   보낸 척하지 않는다: 그게 제일 큰 사고다('보냈는데 안 왔다').
var NOTETO   = ['전체', '오늘 근무', '3부반'];
var NOTEKIND = ['공지', '변경', '긴급'];
var NOTICE = { to: NOTETO[0], kind: NOTEKIND[0], body: '' };
function noticeSet(k, v){ if (NOTICE[k] === v) return false; NOTICE[k] = v; return true; }
// 받는 사람 수 — 보내기 전에 몇 명인지 보여 준다
function noticeWho(){
  if (NOTICE.to === '3부반') return JONAMES.filter(isBu3).length;
  if (NOTICE.to === '오늘 근무') return workRows().filter(function(r){ return r.cls === 'w'; }).length;
  return JONAMES.length;
}
// 글머리는 기계가 적는다 — 사람이 날짜를 잘못 적는 일이 없게
function noticeHead(){
  return DATE + ' · ' + DAY.filter(function(p){ return p.tees.length; })
    .map(function(p){ return p.name + ' ' + p.tees.length + '팀'; }).join(' · ');
}
function noticeBody(){ return String(NOTICE.body || '').trim(); }
function noticeText(){
  return '[' + NOTICE.kind + '] ' + noticeHead() + String.fromCharCode(10, 10) + noticeBody();
}
// 앱에 넘길 꺾러미 — 길이 뚫리면 이걸 그대로 부친다
function noticePayload(){
  return { date: DATE, board: BOARD.id, kind: NOTICE.kind, to: NOTICE.to,
    count: noticeWho(), body: noticeBody(), text: noticeText() };
}
function noticeSend(){
  if (!noticeBody()) { toast('보낼 내용을 적으십시오'); return null; }
  var p = noticePayload();
  // ★여기에 앱으로 보내는 길을 넣는다(주소·열쇠·안 갔을 때 다시 보내기)
  toast('아직 캠디 총무 앱과 안 이어졌습니다 — '
    + p.to + ' ' + p.count + '명에게 보낼 ' + p.body.length + '자를 담아 둠습니다');
  return p;
}

// ── 날 넘기기 ───────────────────────────────
// ★손잡이는 숫자가 아니라 '이름'으로 넘긴다.
// "어제 3부 12번까지 일했다"로 적으면 오늘 명단이 달라지는 순간 12번이 딴 사람이 된다.
// "어제 3부 마지막 근무자는 한지홍"으로 적으면, 오늘 시작은 '조 순환에서 한지홍 다음,
// 오늘 설 수 있는 사람'이라 근태를 나중에 고쳐도 안 깨진다.
//
// ★그래서 순서를 강제하지 않는다. 근태를 먼저 고치든 나중에 고치든,
// 순번 세우기를 다시 누르면 그만이다. 순서를 강제하는 프로그램은
// 그 순서를 못 지키는 날 반드시 사고를 낸다.

// 진짜 달력의 오늘. 배치표가 여기보다 뒤에 있으면 따라와야 한다
function todayLabel(){
  var d = new Date(), p2 = function(n){ return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '년 ' + p2(d.getMonth() + 1) + '월 ' + p2(d.getDate()) + '일';
}
function dateNum(s){
  var m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}
// '2026년 08월 30일' → '2026년 08월 31일'
function nextDateLabel(s){
  var m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return s;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
  var p2 = function(n){ return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '년 ' + p2(d.getMonth() + 1) + '월 ' + p2(d.getDate()) + '일';
}
// 그 부에서 마지막으로 일한 사람 — 그 무리 안에서만 본다
function lastWorkedIn(pk, kind){
  var p = part(pk), a = active(p), n = Math.min(p.tees.length, a.length), last = '';
  for (var i = 0; i < n; i++) if (!a[i].itn && inLineup(a[i].n, kind)) last = a[i].n;
  return last;
}
// 조 순환에서 그 사람 다음, 오늘 설 수 있는 첫 사람
function nextAfter(name, kind){
  if (!name) return '';
  var ring = joRing(name), pool = {};
  lineupPool(kind).forEach(function(n){ pool[n] = 1; });
  for (var i = 1; i < ring.length; i++) if (pool[ring[i]]) return ring[i];
  return '';
}
// 넘기면 무엇이 되는지 먼저 세워 본다 — 아직 아무것도 안 고친다
function carryPlan(){
  var last3 = lastWorkedIn('3', 'bu3');
  var next3 = last3 ? nextAfter(last3, 'bu3') : bu3Start();
  var abs = { 휴무: 0, 휴가: 0, 병가: 0 }, dup = 0, b3 = 0, off = 0;
  JONAMES.forEach(function(n){
    var t = tagOf(n);
    if (t in abs) abs[t]++;
    else if (t === '3부') { /* 소속은 아래에서 따로 센다 */ }
    else if (t && t !== '선발' && !isAbs(t)) { if (isDupTag(t)) dup++; }
  });
  DAY.forEach(function(p){ p.roster.forEach(function(r){ if (r.off) off++; }); });
  b3 = bu3List().length;
  return { date: nextDateLabel(DATE), last3: last3, sb3: next3, sb: seonbal(),
    abs: abs, dup: dup, b3: b3, off: off, ms: marshalNames(),
    teams: DAY.map(function(p){ return { name: p.name, n: p.tees.length }; }) };
}
// 실제로 넘긴다. 한 번의 되돌리기로 통째로 돌아온다
function carryToNextDay(){ return carryToDate(nextDateLabel(DATE), false); }
// ★날짜를 만드는 일과 사람을 앉히는 일은 다르다.
//   quiet(달력이 저절로 따라올 때) — 날만 만들고 사람은 안 앉힌다. 앉히는 건 판단이다.
//   손으로 누를 때 — 3부까지 세워 준다(확인 창을 이미 봤으니까).
function carryToDate(target, quiet){
  var c = carryPlan();
  c.opt = { abs: carryOpt('abs'), leave: carryOpt('leave'),
    role: carryOpt('role'), ln3: carryOpt('ln3'),
    seats: carryOpt('seats'), tees: carryOpt('tees'), staff: carryOpt('staff'),
    grid: carryOpt('grid') };
  c.date = target;
  c.from = DATE;
  var before = quiet ? null : whereMap();
  if (!quiet) snap();
  daySaveQuiet();                               // ★지난 날은 제 칸에 두고 간다 — 안 그러면 덮인다
  DATE = target;
  SB3 = c.sb3;
  dirty = {};                                   // 지난 날 고친 표시는 그 날 것이다
  DAY.forEach(function(p){                      // 결근은 그날 일어난 일이라 안 물려준다
    p.roster.forEach(function(r){ r.off = false; });
  });
  var dropped = clearDayMarks(c.opt);           // ★중복 근무·조출·후출은 내일 다시 정한다
  LEND = {};                                   // ★빌린 카트는 그날치다 — 내일 다시 빌린다
  var dutyGone = clearDutyDay();               // ★당번도 그날치다 — 내일 다시 세운다
  // ★자리는 그날 정하는 것이다. 어제 자리를 물려주면
  //   ① 관리자가 손으로 놓기 전에 이미 누가 앉아 있고
  //   ② 팀을 넣을 때마다 뒤에서 스페어가 저절로 올라온다.
  //   비워 두면 빈 판에서 시작해 원하는 사람만 놓고 순번 세우기로 채운다
  // ★팀도 어제 것이다 — 안 들고 가면 티오프까지 빈 판에서 시작한다
  // ★팀을 안 들고 가더라도 시간대는 들고 갈 수 있다 —
  //   어제와 같은 시각 칸이 빈 채로 서 있고, 거기에 오늘 팀을 넣는다.
  //   시간대까지 비우면 기본 격자로 돌아간다
  if (!c.opt.tees) DAY.forEach(function(q2){
    q2.tees = [];
    if (!c.opt.grid) { q2.rows = 0; q2.xt = []; }
  });
  if (!c.opt.seats){
    DAY.forEach(function(q2){ q2.roster = []; });
    ABSFROM = {};
    clearPlan();                                // ★부 지정도 그날치다 — 자리와 같이 간다
    DUPPIN = {};                                // 자리를 안 들고 가면 못도 없다
    // ★명단 밖 사람은 OFFDUTY 에 있어야 근무표에 보인다.
    //   안 그러면 총원이 82명에서 몇 명으로 줄어 사람을 고를 수조차 없다
    OFFDUTY = JONAMES.slice();
  } else {
    // ★자리를 이어받을 때도 마찬가지다. 여기에 이 손질이 빠져 있어서,
    //   명부에 있는데 오늘 자리가 없는 사람이 근무표에서 통째로 사라졌다.
    //   앉은 사람은 건드리지 않고, 자리 없는 사람만 명단 밖으로 세워 준다
    JONAMES.forEach(function(n){
      if (!partsOf(n).length && OFFDUTY.indexOf(n) < 0) OFFDUTY.push(n);
    });
  }
  unstackParts();                               // ★두 부에 겹쳐 선 자리도 내일 다시 정한다
  // ★마샬은 날마다 바뀐다 — 당번과 같은 그날치다. 그래서 넘길 때 칸을 비운다.
  //   경기팀장·주임은 안 건드린다. '배치'는 clearDayMarks 가 이미 떼 갔다
  var msGone = c.opt.staff ? 0 : clearMarshals();
  // 자리가 정본이다 — 그대로 들고 가기로 했으면 '배치'를 도로 붙여 준다
  var msM = reconcileStaff();
  LOG = [];
  var msg = (quiet ? c.from + ' 것을 이어 ' + target + ' 만듦'
                   : '내일(' + target + ')로 넘김');
  if (!c.opt.seats) msg += ' · 자리는 비움(빈 배치표로 시작)';
  msg += c.opt.tees ? ' · 팀은 어제 것 그대로'
    : (c.opt.grid ? ' · 팀은 비우고 시간대만 그대로' : ' · 팀도 비움');
  if (!c.opt.abs) msg += ' · 휴무는 안 가져옴';
  if (!c.opt.leave) msg += ' · 휴가·병가도 안 가져옴';
  if (dutyGone) msg += ' · 당번 ' + dutyGone + '자리 비움';
  if (msGone) msg += ' · 경기과 마샬 ' + msGone + '자리 비움(내일 다시 넣으십시오)';
  if (msM) msg += ' · 경기과 마샬' + msM;
  if (c.last3 && c.opt.ln3 && c.opt.seats)
    msg += ' · 3부는 ' + c.last3 + ' 다음인 ' + (c.sb3 || '없음') + '부터';
  c.dropped = dropped;
  if (quiet) { LOG.unshift({ msg: msg, moved: 0 }); }
  else {
    commit(msg, before);
    // ★자리를 비웠으면 3부도 안 세운다 — '전부 비운다'는 말과 어긋난다
    if (c.sb3 && c.opt.ln3 && c.opt.seats) applyLineup(c.sb3, ['3']);
  }
  return c;
}

// 확인 창에 넣을 글. 두 화면이 같은 말을 하도록 여기서 만든다
function carryLines(c){
  var L = [];
  L.push(['오늘 캐디 상태',
    '휴무 ' + c.abs['휴무'] + ' · 휴가 ' + c.abs['휴가'] + ' · 병가 ' + c.abs['병가']
    + ' · 결근 ' + c.off + '  |  중복 근무 ' + c.dup + ' · 3부 ' + c.b3 + '명']);
  L.push(['3부 시작', c.last3
    ? c.last3 + ' 다음인 ' + (c.sb3 || '없음') + ' — 오늘 3부에서 ' + c.last3 + '까지 일했습니다'
    : (c.sb3 || '없음') + ' — 오늘 3부에서 일한 사람이 없어 그대로 둡니다']);
  L.push(['1·2부 선발', (c.sb || '없음') + ' — 오늘 것 그대로입니다. 내일 선발은 직접 고르십시오']);
  L.push(['팀(티오프)', c.teams.map(function(t){ return t.name + ' ' + t.n; }).join(' · ')
    + (carryOpt('tees') ? ' — 어제 것을 그대로 들고 갑니다(예약처에서 온 것이 아닙니다)'
                        : ' — 비웁니다. 팀부터 직접 넣으십시오')]);
  L.push(['결근', '지웁니다 — 결근은 그날 일어난 일입니다']);
  L.push(['그날의 배치', '구분(중복 근무·조출·후출)과 두 부에 겹쳐 선 자리를 지웁니다 '
    + '— 내일 것은 순번 세우기로 다시 정합니다']);
  L.push(['오늘 것', '그대로 저장해 두고 갑니다 — 날짜를 눌러 언제든 다시 펼칩니다']);
  return L;
}

// ── 자리 돌리기 ─────────────────────────────
// 고른 차례대로 앞사람이 뒷사람 자리로 가고, 마지막 사람이 첫 자리로 온다.
// 둘만 고르면 그냥 맞바꾸기다 — 규칙이 하나라 머리속에서 갈라지지 않는다.

// 자리가 비었거나, 돌리고 나면 한 부에 같은 사람이 둘이 되는가
function rotateBlock(list){
  for (var i = 0; i < list.length; i++)
    for (var j = i + 1; j < list.length; j++)
      if (list[i].pk === list[j].pk && list[i].ri === list[j].ri)
        return '같은 자리를 두 번 골랐습니다';

  var who = list.map(function(s){ var r = part(s.pk).roster[s.ri]; return r ? r.n : ''; });
  for (var k = 0; k < who.length; k++)
    if (!part(list[k].pk).roster[list[k].ri]) return '없는 자리가 끼어 있습니다';
  // ★빈 자리는 끼어도 된다 — 거기로 옮기는 것이 곧 이 일이다.
  //   전부 비었을 때만 거절한다. 그때는 정말 바꿀 것이 없다
  if (!who.some(function(n){ return !!n; })) return '빈 자리끼리는 바꿀 것이 없습니다';

  // 돌려도 자리마다 그 사람이 그대로면 헛일이다 — 두 부에 다 있는 캐디의
  // 두 자리를 고르면 자기와 자기를 바꾸게 된다. 기록만 남고 아무 일도 안 일어난다
  var moved = false;
  for (var m = 0; m < list.length; m++)
    if (who[m] !== who[(m + 1) % list.length]) { moved = true; break; }
  if (!moved) return '바뀌는 것이 없습니다';

  // 옮겨 놓은 셈 치고 부마다 이름을 세어 본다. 쉬는 자리는 배치표에 안 서니 안 센다
  var after = {};
  DAY.forEach(function(p){
    after[p.key] = p.roster.map(function(r){ return r.off ? null : r.n; });
  });
  list.forEach(function(s, i){
    var to = list[(i + 1) % list.length], r = part(to.pk).roster[to.ri];
    after[to.pk][to.ri] = r && r.off ? null : who[i];
  });
  var bad = '';
  DAY.forEach(function(p){
    if (bad) return;
    var seen = {};
    after[p.key].forEach(function(n){
      if (!n || bad) return;
      if (seen[n]) bad = n + '은(는) ' + p.name + '에 두 번 서게 됩니다';
      seen[n] = 1;
    });
  });
  return bad;
}
// 돌린 뒤 무슨 일이 일어나는지 한 줄로 — 되짚어 볼 때 이 글이 남는다
function rotateMsg(list, who){
  var nm = who.map(function(n){ return n || '빈 자리'; });
  if (list.length === 2) return nm[0] + ' ↔ ' + nm[1] + ' 맞바꿈';
  return nm.length + '명 자리 돌림 · ' + nm.join(' → ') + ' → 처음 자리';
}
function rotateSeats(list){
  if (!list || list.length < 2) return false;
  var why = rotateBlock(list);
  if (why) { toast(why + ' — 자리를 못 돌립니다'); return false; }

  var people = list.map(function(s){ return part(s.pk).roster[s.ri]; });
  var who = people.map(function(r){ return r.n; });
  // 쉬는지 아닌지는 사람이 아니라 자리에 붙어 있다 — 자리에 두고 간다
  var offs = list.map(function(s){ return !!part(s.pk).roster[s.ri].off; });
  var parts = list.map(function(s){ return part(s.pk).name; });

  var before = whereMap(); snap();
  for (var i = 0; i < list.length; i++){
    var j = (i + 1) % list.length, to = list[j];
    part(to.pk).roster[to.ri] = people[i];
    people[i].off = offs[j];
  }
  var cross = parts.some(function(n){ return n !== parts[0]; });
  var woke = offs.some(function(v, i){ return v !== offs[(i + list.length - 1) % list.length]; });
  commit(rotateMsg(list, who)
    + (cross ? ' (' + parts.join(' ↔ ') + ')' : '')
    + (woke ? ' · 쉬던 사람이 나옵니다' : ''), before);
  return true;
}

function swapRef(A, B){
  if (!A || !B) return;
  if (A.offName && B.pk) { var t0 = A; A = B; B = t0; }
  if (!A.pk) return;
  if (A.pk && B.pk && A.pk === B.pk && A.ri === B.ri){
    toast('같은 자리입니다 — 대기 바꿈을 못 합니다');    // 본인하고는 바꿀 것이 없다
    return;
  }
  var why = dupReason(A, B);
  if (why) { toast(why + ' — 대기 바꿈을 못 합니다'); return; }
  var before = whereMap(); snap();
  if (A.pk && B.pk){
    var pa = part(A.pk), pb = part(B.pk);
    var ra = pa.roster[A.ri], rb = pb.roster[B.ri];
    if (!ra || !rb) return;
    var offA = ra.off, offB = rb.off;
    pa.roster[A.ri] = rb; pb.roster[B.ri] = ra;
    rb.off = offA; ra.off = offB;
    commit((ra.n || '빈 자리') + ' ↔ ' + (rb.n || '빈 자리') + ' 맞바꿈'
      + (A.pk !== B.pk ? ' (' + pa.name + ' ↔ ' + pb.name + ')' : '')
      + (offA !== offB ? ' · 쉬던 사람이 나옵니다' : ''), before);
  } else if (A.pk && B.offName){
    var p = part(A.pk), r = p.roster[A.ri];
    if (!r) return;
    p.roster[A.ri] = { n: B.offName, tag: seatRowTag(B.offName), off: false, role: '' };
    var k = OFFDUTY.indexOf(B.offName);
    if (k >= 0) OFFDUTY.splice(k, 1);
    if (isAbs(tagOf(B.offName))){          // 나오는 사람은 더 이상 쉬는 사람이 아니다
      var recB = ABSFROM[B.offName];
      if (recB && recB.tag) TAG[B.offName] = recB.tag; else delete TAG[B.offName];
      delete ABSFROM[B.offName];
    }
    // ★자리를 내준 사람은 '휴무'가 아니다 — 오늘 일할 수 있는데 자리가 없을 뿐이다
    var stillOn = partsOf(r.n).length;
    if (!stillOn && OFFDUTY.indexOf(r.n) < 0) OFFDUTY.push(r.n);
    commit(r.n + ' ↔ ' + B.offName + ' 맞바꿈 · ' + B.offName + '이(가) 대신 나오고 '
      + r.n + '은(는) ' + (stillOn ? '남은 부에 그대로 있습니다' : '오늘 자리가 없습니다'), before);
  }
}
function setOff(pk, ri, v){
  var p = part(pk), r = p.roster[ri];
  var b = whereMap(); snap();
  r.off = v;
  attTouch([pk]);
  commit(p.name + ' ' + r.n + (v ? ' 결근 처리 · 뒤 순번이 당겨집니다' : ' 결근 해제'), b);
}
function moveRow(pk, ri, d){
  var p = part(pk), j = ri + d;
  if (j < 0 || j >= p.roster.length) return;
  var b = whereMap(); snap();
  var t = p.roster[ri]; p.roster[ri] = p.roster[j]; p.roster[j] = t;
  commit(p.name + ' ' + t.n + ' 순번 ' + (d < 0 ? '올림' : '내림'), b);
}
// 명단에서 몇 번째 순번인가(결근은 순번을 안 받는다)
function posIn(list, r){
  var k = 0;
  for (var i = 0; i < list.length; i++){
    if (list[i].off) continue;
    k++;
    if (list[i] === r) return k;
  }
  return 0;
}
// 끌어서 순번 옮기기 — 자리를 맞바꾸는 게 아니라 그 자리에 끼워 넣고 나머지가 밀린다
function rosterOrder(pk, order, movedKey){
  var p = part(pk), a = p.roster;
  if (!order || order.length !== a.length) return;
  var next = [], same = true;
  for (var i = 0; i < order.length; i++){
    var j = Number(order[i]);
    if (!a[j]) return;                       // 못 맞추면 손대지 않는다
    if (j !== i) same = false;
    next.push(a[j]);
  }
  if (same) return;
  var r = a[Number(movedKey)];
  var was = r ? posIn(a, r) : 0;
  var b = whereMap(); snap();
  p.roster = next;
  var now = r ? posIn(next, r) : 0;
  commit(p.name + ' ' + (r ? r.n : '') + ' 순번 '
    + (was ? was + '번' : '결근') + ' → ' + (now ? now + '번' : '결근'), b);
}
// ★한 부만 손보는 문이다. 대바는 두 사람을 맞바꾸는 일이고 이건 한 사람을 넣거나 빼는 일이다.
// 어느 부에도 없는 사람은 제외인원에 있어야 한다 — 그 셈이 어긋나면 총원·가용이 거짓말을 한다
function partsOf(n){
  return DAY.filter(function(p){
    return p.roster.some(function(r){ return r.n === n && !r.itn; });
  }).map(function(p){ return p.key; });
}
function delRow(pk, ri){
  var p = part(pk), r = p.roster[ri];
  if (!r) return false;
  var b = whereMap(); snap();
  p.roster.splice(ri, 1);
  var extra = '';
  if (!partsOf(r.n).length){
    if (OFFDUTY.indexOf(r.n) < 0) OFFDUTY.push(r.n);
    extra = ' · 이제 어느 부에도 없어 미배치가 됩니다(쉬는 것이 아닙니다)';
  }
  attTouch([pk]);
  commit(p.name + ' ' + r.n + ' 명단에서 뺌 · 뒤 순번이 당겨집니다' + extra, b);
  return true;
}
// 이름으로 뺀다 — 화면은 순번(자리)이 아니라 사람을 쥐고 있을 때가 많다
function delFromPart(pk, nm){
  var p = part(pk);
  for (var i = 0; i < p.roster.length; i++)
    if (p.roster[i].n === nm){
      var ok = delRow(pk, i);
      // ★빼도 순번 세우기가 도로 데려온다 — 배지가 빼는 문이다
      if (ok && !batchOn() && !partsOf(nm).length && !tagOf(nm))
        toast(nm + '은(는) 이제 미배치입니다 — 순번을 다시 세우면 돌아옵니다. '
          + '오늘 안 나오면 휴무를 붙이십시오');
      return ok;
    }
  if (!batchOn()) toast(p.name + '에 ' + nm + '이(가) 없습니다');
  return false;
}
// ★대기 쪽 빈 줄은 자리가 아니라 찌꺼기다 — 팀을 지우면 생긴다.
//   확정선(팀 수) 아래의 빈 줄은 위치를 가리지 말고 다 걷는다.
//   확정선 위의 빈 줄은 '아직 아무도 안 앉은 자리'라 그대로 둔다
function trimBlanks(p){
  var a = active(p), kill = [], i;
  // ★관리자가 '대기는 29번까지'라고 깔아 둔 자리는 티오프와 같은 자리다 —
  //   그 안의 빈 줄을 걷으면 29번에 앉힌 사람이 25번으로 딸려 올라간다
  var keep = p.tees.length + spareCap(p.key);
  for (i = keep; i < a.length; i++)
    if (!a[i].n && !a[i].itn) kill.push(a[i]);
  kill.forEach(function(r){
    var j = p.roster.indexOf(r);
    if (j >= 0) p.roster.splice(j, 1);
  });
  return kill.length;
}
// ★팀이 있는 자리까지 빈 줄로 메운다 — 새로 넣는 사람이 그 자리를 안 뺏게.
//   메운 자리는 배치표에 '비어 있음'으로 보인다. 원래도 그렇게 보이던 칸이다
function padBlanks(p){
  var n = 0;
  while (active(p).length < p.tees.length){
    p.roster.push({ n: '', tag: '', off: false, role: '' });
    n++;
  }
  return n;
}
function addRow(pk, nm){
  nm = String(nm || '').trim();
  if (!nm) return false;
  var p = part(pk);
  if (p.roster.some(function(r){ return r.n === nm; })){
    if (!batchOn()) toast(p.name + '에 이미 ' + nm + '이(가) 있습니다');
    return false;
  }
  var b = whereMap(); snap();
  var extra = '';
  if (isAbs(tagOf(nm))){                    // 넣는 순간 쉬는 사람이 아니다
    var rec = ABSFROM[nm];
    if (rec && rec.tag) TAG[nm] = rec.tag; else delete TAG[nm];
    delete ABSFROM[nm];
    extra = ' · 근태를 근무로 바꿉니다';
  }
  // ★팀이 있는 자리는 건너뛴다 — 부에 넣는 것이 곧 자리를 차지하는 것이면
  //   관리자가 손으로 짜 놓은 배치표가 누를 때마다 밀린다
  trimBlanks(p);
  padBlanks(p);
  p.roster.push({ n: nm, tag: '', off: false, role: '' });
  var k = OFFDUTY.indexOf(nm);
  if (k >= 0) OFFDUTY.splice(k, 1);
  attTouch([pk]);
  if (dupStamp(nm)) extra += ' · ' + dupPinWhy(nm) + '(순번 세우기가 안 건드립니다)';
  var cap0 = spareCap(pk);
  var over = (cap0 > 0 && spareNow(p) > cap0)
    ? ' · 대기 한도 ' + cap0 + '명을 넘었습니다(' + spareNow(p) + '명)' : '';
  commit(p.name + ' ' + nm + ' 대기에 넣음 — 자리는 직접 앉히거나 순번 세우기가 잡습니다' + over
    + extra, b);
  return true;
}
// 그 부에 아직 없는 사람 — 넣기 고르개가 보여 줄 목록
function addablePool(pk){
  var p = part(pk), on = {};
  p.roster.forEach(function(r){ if (!r.itn) on[r.n] = 1; });
  return JONAMES.filter(function(n){ return !on[n]; });
}
function setRole(pk, i, role){
  var p = part(pk), r = active(p)[i];
  var b = whereMap(); snap();
  r.role = (r.role === role ? '' : role);
  markDirty(pk, i);
  commit(p.name + ' ' + r.n + ' ' + (r.role ? r.role + ' 지정' : '역할 해제'), b);
}
// 3부를 안 하는 골프장도 있고, 4부까지 하는 날도 있다.
// 지워도 되돌리기로 되살아난다 — 그래서 물어보지 않는다.
function addPart(){
  if (DAY.length >= MAXPART) { toast('부는 ' + MAXPART + '부까지입니다'); return; }
  var mx = 0;
  DAY.forEach(function(q){ var n = Number(q.key); if (isFinite(n) && n > mx) mx = n; });
  var key = String(mx + 1), lastP = DAY[DAY.length - 1];
  var st = lastP ? hm((mm(lastP.start) + GAP * ROWS + 60) % 1440) : '7:00';
  var b = whereMap(); snap();
  DAY.push({ key: key, name: key + '부', start: st, roster: [], tees: [] });
  cfgSave();
  commit(key + '부 만듦 · 명단은 순번 · 명단에서 넣습니다', b);
}
function delPart(pk){
  if (DAY.length <= 1) { toast('부는 하나는 있어야 합니다'); return; }
  var q = part(pk), b = whereMap(); snap();
  DAY = DAY.filter(function(x){ return x.key !== pk; });
  if (cur === pk) cur = DAY[0].key;
  if (drwPart === pk) drwPart = DAY[0].key;
  cfgSave();
  commit(q.name + ' 지움 · 되돌리기로 되살아납니다', b);
}
function setPartName(pk, v){
  var q = part(pk); v = (v || '').trim();
  if (!v || v === q.name) { if (cfgOpen) drawCfg(); return; }
  cfgChange('부 이름 ' + q.name + ' → ' + v, function(){ q.name = v; });
}
// ── 코스를 늘리고 줄인다 ─────────────────────────────────────
function ctAdd(v){
  v = (v || '').trim();
  if (!v) { toast('코스 이름을 적어 주세요'); return; }
  if (COURSES.length >= MAXCOURSE) { toast('코스는 넷까지입니다 — 36홀이 가장 큽니다'); return; }
  var n = COURSES.length + 1, key = 'C' + n;
  while (COURSES.indexOf(key) >= 0) { n++; key = 'C' + n; }
  cfgChange('코스 추가 · ' + v, function(){ COURSES.push(key); COURSE[key] = v; });
}
function ctDel(k){
  if (COURSES.length <= 1) { toast('코스는 하나는 있어야 합니다'); return; }
  if (courseUsed(k)) { toast(cname(k) + '에 선 팀이 있습니다 — 팀을 옮기고 지우십시오'); return; }
  cfgChange('코스 지움 · ' + cname(k), function(){
    COURSES = COURSES.filter(function(x){ return x !== k; });
    delete COURSE[k];
  });
}
function ctOrder(order){
  var next = [];
  for (var i = 0; i < order.length; i++){ if (COURSES.indexOf(order[i]) < 0) return; next.push(order[i]); }
  if (next.length !== COURSES.length) return;
  if (next.join('|') === COURSES.join('|')) return;
  cfgChange('코스 차례 · ' + next.map(cname).join(' · '), function(){
    COURSES = next;
    DAY.forEach(function(q){ sortTees(q); });
  });
}
// ★그 시각에 아직 안 쓴 코스 — 한 시각에 코스마다 한 팀씩 나간다.
//   둘 다 찼으면(격자 밖에 끼워 넣는 날) 그 부에서 팀이 적은 코스로 간다
function pickCourse(pk, time){
  var p = part(pk), used = {}, cnt = {};
  COURSES.forEach(function(c){ cnt[c] = 0; });
  p.tees.forEach(function(t){
    if (t.time === time) used[t.course] = 1;
    if (cnt[t.course] !== undefined) cnt[t.course]++;
  });
  var free = COURSES.filter(function(c){ return !used[c]; });
  if (free.length) return free[0];
  return COURSES.slice().sort(function(x, y){ return cnt[x] - cnt[y]; })[0];
}
// ★자리는 줄 번호로 맞췄다 — 티오프 i 번째 칸에 명단 i 번째 사람이 앉는다.
//   그래서 칸 하나를 끼우면 그 뒤 순번이 통째로 한 칸씩 당겨진다.
//   앞 쪽에 팀을 넣으면 그 시각부터 뒤 사람이 저마다 한 칸 이른 티오프로 올라오고,
//   맨 끝에서 대기 첫 사람이 배치표 안으로 들어온다 — 종이 배치표가 그렇게 움직인다.
//   ★빈 줄을 끼우지 않는다. 비는 칸이 생긴다면 그것은 맨 끝 —
//     뒤에 설 사람이 아무도 없는 자리다
function addTeam(pk, time, course){
  var p = part(pk);
  var ck = course || pickCourse(pk, time);
  var b = whereMap(); snap();
  var tee = { time: time, course: ck, pax: 4, cx: false };
  p.tees.push(tee);
  sortTees(p);
  var ai = p.tees.indexOf(tee), a = active(p), last = p.tees.length - 1;
  var tail = a[last];                       // 맨 끝 칸에 앉게 된 사람 — 새로 들어온 줄이다
  var up = 0, i;
  for (i = ai; i < last && i < a.length; i++) if (a[i].n) up++;
  growGrid(p); stampTimes(p);        // ★격자 밖에 넣었으면 그 칸을 기억해 둔다
  commit(p.name + ' 팀 추가 ' + time + ' ' + cname(ck)
    + (course ? '' : ' · 코스는 빈 쪽으로 넣었습니다')
    + (up ? ' · 뒤 ' + up + '명이 한 칸씩 당겨졌습니다' : '')
    + (tail && tail.n ? ' · 끝 칸으로 ' + tail.n + ' 들어왔습니다'
                      : ' · 끝 칸은 비어 있습니다'), b);
  return ck;
}
function teeIdx(pk, i){ return i; }         // 시각순 i번째 티오프 = 근무 i번째 사람
// ★뒤 시간대까지 미는 것은 '그 시각부터 통째로 늦춘다'는 뜻이다.
//   같은 시각의 다른 코스도 같이 민다 — 한 시각은 한 덩어리다.
//   격자에 안 맞아도 된다. 끼워 넣는 날이 있으니까
function setTeeTime(pk, i, v, rest){
  var p = part(pk), t = p.tees[i];
  if (!t || t.time === v) return false;
  growGrid(p); stampTimes(p);        // ★당기기 전에 지금 길이와 칸을 붙잡아 둔다
  var d = mm(v) - mm(t.time), base0 = mm(t.time), n = 0;
  var b = whereMap(); snap();
  // ★첫 티오프를 밀면 격자도 같이 민다 — 안 그러면 옛 격자 줄이 빈 채로 남는다
  var moved0 = false;
  if (rest && d && base0 <= mm(p.start)){ p.start = hm(mm(p.start) + d); moved0 = true; }
  if (rest && d){
    p.tees.forEach(function(x, k){
      if (k === i) return;
      if (mm(x.time) >= base0) { x.time = hm(mm(x.time) + d); n++; }
    });
  }
  t.time = v;
  growGrid(p); stampTimes(p);        // ★뒤로 밀었으면 격자도 그만큼 길어진다
  sortTees(p);
  markDirty(pk, i);
  var sign = d > 0 ? '+' : '';
  commit(p.name + ' ' + hm(base0) + ' → ' + v
    + (rest && n ? ' · 뒤 ' + n + '팀도 ' + sign + d + '분 밀었습니다'
                 : ' · 이 칸만 고쳤습니다')
    + (moved0 ? ' · 격자도 같이 밀었습니다' : ''), b);
  return true;
}
function setCourse(pk, i, to){
  var p = part(pk), t = p.tees[i];
  if (!to || COURSES.indexOf(to) < 0 || to === t.course) return;
  var b = whereMap(); snap();
  t.course = to; sortTees(p);
  markDirty(pk, i);
  commit(p.name + ' 코스 바꿈 → ' + cname(to), b);
}
function setPax(pk, i, v){
  var p = part(pk);
  var b = whereMap(); snap();
  p.tees[i].pax = v;
  markDirty(pk, i);
  commit(p.name + ' 인원 ' + v + '인 · 배정은 그대로', b);
}
function cancelTee(pk, i){
  var p = part(pk), t = p.tees[i];
  var b = whereMap(); snap();
  t.cx = !t.cx;
  markDirty(pk, i);
  commit(p.name + ' ' + t.time + ' ' + t.course + (t.cx ? ' 취소 · 칸은 남깁니다' : ' 취소 풀기'), b);
}
// ★여러 팀을 한 번에 지운다. 뒤에서부터 지워야 앞 번호가 안 밀린다.
//   되돌리기는 한 번이어야 한다 — 마흔 번 눌러 되돌리게 하면 안 지운 것만 못하다
function delTeams(pk, idxs){
  var p = part(pk), seen = {}, ix = [];
  (idxs || []).forEach(function(v){
    v = Number(v);
    if (seen[v] || !p.tees[v]) return;
    seen[v] = 1; ix.push(v);
  });
  if (!ix.length) return 0;
  ix.sort(function(a, b){ return b - a; });
  var b = whereMap(); snap();
  growGrid(p); stampTimes(p);        // ★지우기 전에 지금 길이와 칸을 붙잡아 둔다
  var all = (ix.length === p.tees.length);
  var one = p.tees[ix[ix.length - 1]];               // 가장 이른 팀 — 말에 쓴다
  // ★사람이 대기로 내려가는 것은 '팀보다 사람이 많아졌을 때'뿐이다.
  //   그 밖에는 뒤 시각이 당겨질 뿐 자리에 그대로 남는다 — 세어 보고 적는다
  function waitN(){
    var a = active(p), c = 0;
    for (var k = p.tees.length; k < a.length; k++) if (a[k].n) c++;
    return c;
  }
  var w0 = waitN();
  ix.forEach(function(i){ p.tees.splice(i, 1); });
  trimBlanks(p);
  var moved = waitN() - w0;
  commit(p.name + ' ' + (all ? '팀 ' + ix.length + '개를 통째로 비움'
      : ix.length + '팀 지움 · ' + one.time + (ix.length > 1 ? ' 외' : ' ' + one.course))
    + (moved > 0 ? ' · ' + moved + '명이 대기로 내려갑니다(명단에는 그대로 있습니다)'
                 : ' · 뒤 시각이 당겨집니다'), b);
  return ix.length;
}
// 그 부의 팀을 통째로 비운다 — 사람은 명단에 남는다
function clearTees(pk){
  var p = part(pk), n = p.tees.length, a = [];
  for (var i = 0; i < n; i++) a.push(i);
  return delTeams(pk, a);
}
function delTeam(pk, i){
  var p = part(pk), t = p.tees[i];
  growGrid(p); stampTimes(p);        // ★지우기 전에 지금 길이와 칸을 붙잡아 둔다
  var b = whereMap(); snap();
  p.tees.splice(i, 1);
  trimBlanks(p);                     // ★메워 둔 빈 줄이 대기로 흘러내리지 않게
  commit(p.name + ' ' + t.time + ' ' + t.course + ' 팀 지움 · 뒤 시각이 당겨집니다', b);
}
