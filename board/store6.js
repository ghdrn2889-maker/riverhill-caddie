// ══════════════════════════════════════════════════════════════
//  store — 저장·설정 보관
//  화면에 닿는 곳은 saveFlash() 하나뿐이다.
// ══════════════════════════════════════════════════════════════
// ══ 설정 저장 — 조 명단·자리·격자는 거의 고정이라 한 번 넣으면 계속 쓴다 ══
var CFGKEY = 'board.cfg.v3';
// ── 저장 — 하루치 배치표를 통째로.
// ★칸이 하나뿐이면 내일을 짜는 순간 오늘이 지워진다. 그래서 날짜마다 한 칸이다.
// ★그리고 '눌러야 저장'만 있으면 창이 닫히는 순간 안 누른 것이 다 날아간다.
// 그래서 고칠 때마다 초안 칸에 몰래 적어 두고, 다음에 열 때 이어서 할지 묻는다.
// 초안은 저장이 아니다 — 저장본을 안 건드리므로 '저장 안 함' 표시는 그대로 남는다.
var DAYKEY = 'board.day.v3';        // 옛 칸 — 한 장뿐이던 시절. 켤 때 한 번 옮기고 지운다
var DAYPFX = 'board.day.v3::';      // 날짜마다 한 칸
var DRFPFX = 'board.draft.v3::';    // 안 누른 고침
var IDXKEY = 'board.days.v3';       // 어떤 날이 저장돼 있나
var CURKEY = 'board.cur.v3';        // 지금 보고 있는 날
var BUILD = '2026-09-13';           // 언제 만든 파일인가 — 올릴 때마다 바뀐다(보여 주기용)
// ★저장 글의 모양 번호. 파일 이름(BUILD)과 뗼어 놓는다 —
//   여태는 둘이 한 덩어리라 파일만 새로 올려도 그날 배치표를 통째로 못 읽었다.
//   모양을 바꿀 때만 이 수를 하나 올리고, 밑의 MIGRATE 에 옮기는 길을 적는다.
//   기능만 고칠 때는 손대지 않는다 — 그래야 업데이트가 저장본을 안 건드린다
var SCHEMA = 1;
// MIGRATE[n] : n번 모양의 글을 받아 n+1번 모양의 글로 돌려준다(둘 다 JSON 글자열).
// 모양을 바꾸는 날 여기에 한 칸을 더한다 — 보기는 이렇다:
//   MIGRATE[1] = function(str){ var o = JSON.parse(str); o.새칸 = 기본값; return JSON.stringify(o); };
// 길이 없는 모양은 함부로 안 읽는다 — 잘못 읽어 화면을 깨뜿리느니 안 펼치는 편이 낫다
var MIGRATE = {};
var BAKPFX = 'board.day.bak::';     // 옮기기 전 원본 — 옮기개가 틀렸을 때 돌아갈 자리
var LIFTBAD = '';                   // 이 판이 못 읽은 저장본의 날짜
var savedSig = null, savedAt = '';
var PENDING = null;                 // 이어서 할지 물어볼 초안 {at, s}
var CAUGHT = null;                  // 달력을 따라가며 새로 만든 날 {from, to}
var CGTKEY = 'board.caught.v3';     // 그 알림은 읽을 때까지 남는다

function lsGet(k){ try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsPut(k, v){ try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function lsDel(k){ try { localStorage.removeItem(k); } catch (e) {} }

// ══ 서버 창구 — 정본은 서버에 있다 ══════════════════════════════
// ★이 화면은 두 자리에서 돈다.
//   ① 파일 하나로 열었을 때(file://) — 서버가 없다. 여태처럼 브라우저에만 적는다.
//   ② 경기과 방(http://…) — 정본은 서버다. 브라우저는 손에 든 사본일 뿐이다.
// 그래서 여태 돌던 저장 길은 손대지 않고, 그 위에 '서버에도 올린다'를 얹었다.
// 길을 갈아엎지 않아야 고칠 때마다 화면이 안 깨진다.
var SRV = { on: false, sig: {}, clash: '', err: '' };

function srvOn(){ return !!SRV.on; }
// 날짜는 숫자 여덟 자리로만 주고받는다 — 주소에 한글을 넣으면 글자가 깨진다
function dayKey(d){ var t = String(d || '').replace(/[^0-9]/g, ''); return t.length >= 8 ? t.slice(0, 8) : ''; }
function dayLabel(k){ return k.slice(0, 4) + '년 ' + k.slice(4, 6) + '월 ' + k.slice(6, 8) + '일'; }
function isoHM(s){
  try { var d = new Date(s); if (isNaN(d.getTime())) return '';
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); } catch (e) { return ''; }
}
function srvReq(method, p, payload, done){
  try {
    var x = new XMLHttpRequest();
    x.open(method, p, true);
    x.timeout = 8000;
    if (payload) x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function(){
      if (x.readyState !== 4) return;
      var o = null; try { o = JSON.parse(x.responseText || 'null'); } catch (e) {}
      done(x.status, o);
    };
    x.ontimeout = function(){ done(0, null); };
    x.onerror   = function(){ done(0, null); };
    x.send(payload ? JSON.stringify(payload) : null);
  } catch (e) { done(0, null); }
}

// ★켤 때 — 서버가 있으면 서버 것을 먼저 브라우저 칸에 심고 나서 여느 때처럼 켠다.
//   서버가 없으면(파일로 열었을 때) 곧바로 여느 때처럼 켠다. 시간차도 안 생긴다
function srvBoot(done){
  if (!/^https?:$/.test(location.protocol)) { SRV.on = false; done(); return; }
  srvReq('GET', 'api/days', null, function(st, o){
    if (st !== 200 || !o || !o.ok) { SRV.on = false; done(); return; }   // 서버가 아니면 그냥 브라우저로
    SRV.on = true;
    var days = (o.days || []).slice(0, 120), i = 0, got = 0;
    srvReq('GET', 'api/cfg', null, function(st2, c){
      if (st2 === 200 && c && c.ok && c.s) lsPut(CFGKEY, c.s);
      step();
    });
    function step(){
      if (i >= days.length){
        var cur = lsGet(CURKEY);
        if ((!cur || !lsGet(DAYPFX + cur)) && days.length) lsPut(CURKEY, days[0].label || dayLabel(days[0].key));
        done();
        return;
      }
      var d = days[i++];
      srvReq('GET', 'api/day/' + d.key, null, function(st3, r){
        if (st3 === 200 && r && r.ok && r.s){
          var lab = r.label || dayLabel(d.key);
          lsPut(DAYPFX + lab, JSON.stringify({ v: r.v || '', sv: r.sv || SCHEMA, at: isoHM(r.at), s: r.s }));
          dayIndexPut(lab, isoHM(r.at));
          SRV.sig[lab] = r.sig || '';
          got++;
        }
        step();
      });
    }
  });
}

// ★올리기 — 브라우저 칸에 적은 뒤 그대로 서버에도 보낸다.
//   판본 검사(base): 내가 읽어 간 뒤 딴 자리에서 고쳤으면 서버가 막는다.
//   막히면 브라우저 것은 그대로 남는다 — 잃는 것은 없고, 한 번 더 누르면 덮는다
function srvPutDay(d){
  if (!SRV.on) return;
  var raw = lsGet(DAYPFX + d); if (!raw) return;
  var o; try { o = JSON.parse(raw); } catch (e) { return; }
  var k = dayKey(d); if (!k) return;
  var body = { v: o.v || '', sv: o.sv || SCHEMA, s: o.s, label: d };
  var force = (SRV.clash === d);
  if (!force && SRV.sig[d] !== undefined) body.base = SRV.sig[d];
  srvReq('PUT', 'api/day/' + k, body, function(st, r){
    if (st === 200 && r && r.ok){
      SRV.sig[d] = r.sig || ''; SRV.err = '';
      if (force) { SRV.clash = ''; toast(d + ' — 딴 자리 것을 덮었습니다(옛 판은 서버가 보관합니다)'); }
      return;
    }
    if (st === 409){
      SRV.clash = d;
      toast('★그새 딴 자리에서 ' + d + ' 을(를) 고쳤습니다 — 서버에 안 올렸습니다. '
        + '한 번 더 저장을 누르면 이 화면 것으로 덮습니다');
      return;
    }
    SRV.err = d;
    toast('서버에 못 올렸습니다 — 이 브라우저에는 남아 있습니다. 잠시 뒤 다시 저장해 보십시오');
  });
}
function srvPutCfg(){
  if (!SRV.on) return;
  var raw = lsGet(CFGKEY); if (!raw) return;
  srvReq('PUT', 'api/cfg', { sv: SCHEMA, s: raw }, function(){});
}
function srvDelDay(d){
  if (!SRV.on) return;
  var k = dayKey(d); if (!k) return;
  srvReq('DELETE', 'api/day/' + k, null, function(){ delete SRV.sig[d]; });
}
// ★저장본 한 장을 지금 모양까지 끌어올린다.
//   돌아오는 값은 { s: 글, from: 몇 번 모양이었나, lifted: 올렸나 } — 못 읽으면 null.
//   ★못 읽어도 지우지 않는다. 원본은 제자리에 그대로 둔다
function liftSaved(o){
  if (!o || typeof o.s !== 'string') return null;
  var from = Math.floor(Number(o.sv) || 0) || 1;   // sv 가 없던 시절 글은 1번 모양이다
  if (from > SCHEMA) return null;                  // 새 판이 저장한 글 — 옛 판은 못 읽는다
  var str = o.s, k, up;
  for (k = from; k < SCHEMA; k++){
    up = MIGRATE[k];
    if (typeof up !== 'function') return null;
    try { str = up(str); } catch (e) { return null; }
    if (typeof str !== 'string' || !str) return null;
  }
  return { s: str, from: from, lifted: from !== SCHEMA };
}
// 옛 원본을 한 번 밀어 둔다 — 옮긴 글로 덮어쓰기 전에도, 못 읽었을 때도.
// 이미 밀어 둔 것이 있으면 그대로 둔다 — 첫 원본이 가장 진짜다
function dayBak(d, raw){
  var k = BAKPFX + d;
  if (!raw || lsGet(k)) return false;
  return lsPut(k, raw);
}
// 밀어 둔 원본이 있는 날들
function bakList(){
  var out = [], i, k;
  try {
    for (i = 0; i < localStorage.length; i++){
      k = localStorage.key(i);
      if (k && k.indexOf(BAKPFX) === 0) out.push(k.slice(BAKPFX.length));
    }
  } catch (e) { /* 사생활 보호 창 */ }
  return out.sort().reverse();
}

// 저장된 날들 — { '2026년 08월 30일': { at: '14:32' } }
function dayIndex(){
  try { return JSON.parse(lsGet(IDXKEY) || '{}') || {}; } catch (e) { return {}; }
}
function dayIndexPut(d, at){
  var ix = dayIndex();
  ix[d] = { at: at };
  lsPut(IDXKEY, JSON.stringify(ix));
}
function dayList(){                 // 최근 날이 위로
  var ix = dayIndex();
  return Object.keys(ix).sort().reverse().map(function(d){ return { date: d, at: ix[d].at || '' }; });
}
function dayDrop(d){
  var ix = dayIndex();
  delete ix[d];
  lsPut(IDXKEY, JSON.stringify(ix));
  lsDel(DAYPFX + d); lsDel(DRFPFX + d);
  srvDelDay(d);           // 서버에서도 치운다(버리지 않고 옮겨 둔다)
  lsDel(BAKPFX + d);      // ★사람이 지우라고 한 날이다 — 밀어 둔 사본도 같이 걷는다(이름이 든 글이다)
}
// 초안 — 고칠 때마다. 저장본은 안 건드린다
function draftPut(){
  if (savedSig === null) return;    // 아직 켜는 중
  lsPut(DRFPFX + DATE, JSON.stringify({ v: BUILD, sv: SCHEMA, at: nowHM(), s: state() }));
}
function draftDrop(d){ lsDel(DRFPFX + (d || DATE)); }
function nowHM(){
  var d = new Date();
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
function unsaved(){ return savedSig !== null && savedSig !== state(); }
// 말없이 그 날 칸에 넣는다 — 날 넘기기가 오늘 것을 두고 갈 때 쓴다
function daySaveQuiet(){
  var at = nowHM();
  if (!lsPut(DAYPFX + DATE, JSON.stringify({ v: BUILD, sv: SCHEMA, at: at, s: state() }))) return '';
  dayIndexPut(DATE, at);
  draftDrop();
  srvPutDay(DATE);          // ★정본은 서버다
  return at;
}
function daySave(){
  var at = daySaveQuiet();
  cfgSave();
  lsPut(CURKEY, DATE);
  if (!at) { toast('이 브라우저가 저장을 막고 있습니다 — 화면은 그대로 씁니다'); return; }
  savedSig = state(); savedAt = at;
  // ★어느 단추로 저장했든 '없던 일로 칠 수 있는 자리'는 여기까지다.
  //   안 그러면 위쪽 저장으로 저장해 놓고 끄기를 누를 때 저장한 것까지 풀린다
  if (typeof bulkOn === 'function' && bulkOn()) bulkBase();
  paint();
  saveFlash();
  toast(DATE + ' 저장했습니다 · ' + at);
}
// 그 날 칸을 펼친다. 없으면 아무것도 안 한다
function dayLoadDate(d){
  var raw = lsGet(DAYPFX + d);
  if (!raw) return false;
  try {
    var o = JSON.parse(raw);
    var up = liftSaved(o);
    // ★못 읽는 글은 버리지 않는다 — 제자리에 두고 사본까지 밀어 둔다.
    //   그래야 나중에 그 모양을 아는 판이 와서 다시 펼칠 수 있다
    if (!up) { dayBak(d, raw); LIFTBAD = d; return false; }
    if (up.lifted) dayBak(d, raw);      // 옮긴 글로 저장되기 전의 원본을 두고 간다
    restore(up.s);
    // ★소속은 그날의 사실이 아니다 — 지난 날을 펼쳐도 오늘의 명부를 쓴다.
    //   안 그러면 어제를 한 번 열어 본 것만으로 3부반이 하우스로 되돌아간다
    var b3 = cfgBu3();
    if (b3) BU3SET = b3;
    savedSig = state(); savedAt = o.at || '';
    return true;
  } catch (e) { return false; }         // 깨진 저장본은 무시하고 처음 상태로 연다
}
// 다른 날로 건너간다 — 지금 것은 그 날 칸에 두고 간다
function daySwitch(d){
  if (d === DATE) return false;
  if (unsaved()) daySaveQuiet();
  if (!dayLoadDate(d)) { toast(d + ' 저장본이 없습니다'); return false; }
  lsPut(CURKEY, d);
  LOG = []; STACK = []; REDO = [];      // 어제 되돌리기로 오늘을 헤집으면 안 된다
  paint();
  toast(d + ' 을(를) 펼쳤습니다');
  return true;
}
function dayForget(){
  dayDrop(DATE);
  toast(DATE + ' 저장본을 지웠습니다 — 새로고침하면 처음 상태로 돌아갑니다');
}
function cfgSave(){
  try {
    localStorage.setItem(CFGKEY, JSON.stringify({
      jomap: JOMAP, jolab: JOLABEL, jocnt: JOCNT, bu3set: bu3List(),
      jonames: JONAMES,                 // ★명부도 설정이다 — 날을 넘겨도 그대로다
      staff: STAFF, dkeys: DUTYKEYS, ddef: DUTYDEF,
      course: COURSE, courses: COURSES, gap: GAP, rows: ROWS, smax: SMAX,
      carry: CARRY, rmin: ROUNDMIN
    }));
    srvPutCfg();                        // ★설정도 서버가 정본이다
    return true;
  } catch (e) { return false; }   // 사생활 보호 창·용량 초과 — 부른 쪽이 알아야 한다
}
// 설정에 적힌 3부반 명부 — 하루 저장본보다 이쪽이 새것이다
function cfgBu3(){
  try {
    var o = JSON.parse(lsGet(CFGKEY) || 'null');
    return (o && o.bu3set) || null;
  } catch (e) { return null; }
}
function cfgLoad(){
  var raw = null;
  try { raw = localStorage.getItem(CFGKEY); } catch (e) { return false; }
  if (!raw) return false;
  try {
    var o = JSON.parse(raw);
    if (o.jomap) { JOMAP = o.jomap; JOLABEL = o.jolab || JOLABEL; JOCNT = o.jocnt || JOCNT; }
    if (o.bu3set) BU3SET = o.bu3set;   // ★소속은 설정 쪽이 이긴다 — 날이 바뀌어도 그대로다
    if (o.jonames && o.jonames.length) JONAMES = o.jonames;   // ★명부도 마찬가지
    if (o.carry) CARRY = { abs: !!o.carry.abs, role: !!o.carry.role, ln3: !!o.carry.ln3,
      seats: !!o.carry.seats,
      // 옛 설정에는 없던 값 — 없으면 여러 날 가는 것이니 '가져간다'
      leave: ('leave' in o.carry) ? !!o.carry.leave : true,
      // 마샬은 그날치다 — 옛 설정에도 '안 가져간다'를 기본으로 준다
      staff: ('staff' in o.carry) ? !!o.carry.staff : false,
      // 옛 설정에는 없던 값 — 없으면 지금까지 하던 대로 '들고 간다'
      tees: ('tees' in o.carry) ? !!o.carry.tees : true };
    if (o.rmin) ROUNDMIN = o.rmin;
    if (o.staff && o.staff.length) { STAFF = o.staff; migrateStaff(); }
    if (o.dkeys && o.dkeys.length) {
      DUTYKEYS = o.dkeys;
      if (o.ddef) DUTYDEF = o.ddef;
      DUTYKEYS.forEach(function(k){ if (!(k in DUTY)) DUTY[k] = []; });
    }
    if (o.course) COURSE = o.course;
    if (o.courses && o.courses.length) COURSES = o.courses;
    if (o.gap) GAP = o.gap;
    if (o.rows) ROWS = o.rows;
    if (o.smax) SMAX = o.smax;
    return true;
  } catch (e) { return false; }
}
// ★켤 때는 하루칸을 먼저 펼치고 설정칸을 나중에 덮는다.
// 하루칸(저장본) 안에도 설정 사본이 들어 있는데, 그건 마지막으로 '저장'을 누른 때의 것이다.
// 설정칸은 바꿀 때마다(설정 변경·저장·되돌리기·부 추가) 곧바로 다시 써지므로 늘 더 새것이다.
// 순서를 거꾸로 하면 옛 사본이 새 설정을 덮어, 당번 종류를 늘려도 새로고침하면 사라진다.
function bootLoad(){
  // 옛 칸(한 장뿐이던 시절)이 있으면 그 안의 날짜로 옮겨 준다 — 한 번만
  var old = lsGet(DAYKEY);
  if (old){
    try {
      var oo = JSON.parse(old);
      var up0 = liftSaved(oo);
      if (up0){
        var od = (JSON.parse(up0.s) || {}).date || BOARD.date;
        if (!lsGet(DAYPFX + od)){
          lsPut(DAYPFX + od, JSON.stringify({ v: oo.v || BUILD, sv: SCHEMA, at: oo.at || '', s: up0.s }));
          dayIndexPut(od, oo.at || '');
          lsPut(CURKEY, od);
        }
      }
    } catch (e) { /* 깨진 옛 저장본은 버린다 */ }
    lsDel(DAYKEY);
  }
  var cur = lsGet(CURKEY), have = dayList();
  if (!cur || !lsGet(DAYPFX + cur)) cur = have.length ? have[0].date : '';
  if (cur) dayLoadDate(cur);
  cfgLoad();                 // 설정 — 당번 종류·조·코스·격자. 이쪽이 이긴다
  cfgLoad();                 // 설정 — 당번 종류·조·코스·격자. 이쪽이 이긴다
  // 당번의 빈 목록·기본값·색은 '처음 그릴 때' 만들어지는데, 그것들도 저장에 들어간다.
  // 그리다 만들면 아무것도 안 고쳤는데 '저장 안 함'이 뜬다 — 그래서 미리 만들어 둔다
  DUTYKEYS.forEach(function(k){ dutyList(k); defOf(k); dutyColor(k); });
  bu3List();                 // 처음 켤 때 3부반 명부를 만들어 둔다(안 그러면 '저장 안 함'이 뜬다)
  reconcileNames();          // ★저장된 명부에 없는데 배치표에는 있는 사람을 뒤에 붙인다
  var b3back = reconcileBu3();   // ★'3부' 배지가 말하는 소속을 되살린다
  reconcileDupTags();        // ★저장해 둔 옛 중복 표시가 자리와 안 맞으면 여기서 뗀다
  reconcileStaff();          // ★경기과 마샬 자리에 앉은 캐디는 '배치'다 — 자리가 정본이다
  savedSig = state();        // 설정까지 얹은 지금이 '저장된 상태'다
  if (LIFTBAD) setTimeout(function(){
    toast(LIFTBAD + ' 저장본을 이 판이 못 읽어 안 펼쳐습니다 — 지우지 않고 그대로 두었습니다');
  }, 900);
  if (b3back.length) setTimeout(function(){
    toast('3부반 명부가 비어 있어 배지를 보고 ' + b3back.length + '명 되살렸습니다 — '
      + b3back.slice(0, 4).join(' ') + (b3back.length > 4 ? ' 외' : ''));
  }, 400);
  catchUpToday();            // ★달력은 사람이 안 눌러도 넘어간다 — 배치표도 따라간다
  // 안 누르고 닫은 고침이 있나 — 있으면 물어본다(아직 아무것도 안 덮는다)
  var draw = lsGet(DRFPFX + DATE);
  if (draw){
    try {
      var dd = JSON.parse(draw);
      var upd = liftSaved(dd);
      if (upd && upd.s !== savedSig) PENDING = { at: dd.at || '', s: upd.s };
      else draftDrop();
    } catch (e) { draftDrop(); }
  }
}
// ★사람이 안 눌러도 날은 간다.
// 저장된 마지막 날이 오늘보다 뒤에 있으면, 오늘 칸을 만들어 준다.
// 날만 만든다 — 누구를 어디에 앉힐지는 여전히 사람이 정한다.
// 지난 날은 제 칸에 그대로 남아 날짜 고르개에서 다시 펼칠 수 있다.
function catchUpToday(){
  var t = todayLabel();
  if (!dateNum(DATE) || dateNum(DATE) >= dateNum(t)) return null;
  if (PENDING) return null;              // 안 누른 고침이 먼저다. 그것부터 묻는다
  var from = DATE;
  carryToDate(t, true);
  var at = daySaveQuiet();
  lsPut(CURKEY, t);
  savedSig = state(); savedAt = at;
  CAUGHT = { from: from, to: t, abs: carryOpt('abs') };
  lsPut(CGTKEY, JSON.stringify(CAUGHT));
  return CAUGHT;
}
function caughtRead(){                   // 지난번에 만들어 두고 아직 안 알린 것
  if (CAUGHT) return CAUGHT;
  try { CAUGHT = JSON.parse(lsGet(CGTKEY) || 'null'); } catch (e) { CAUGHT = null; }
  return CAUGHT;
}
function caughtSeen(){ CAUGHT = null; lsDel(CGTKEY); }

// '이어서 하기' — 초안을 펼친다. 저장은 여전히 사용자가 누른다
function draftResume(){
  if (!PENDING) return;
  restore(PENDING.s);
  PENDING = null;
  catchUpToday();            // 이어받은 초안이 지난 날 것이면 다시 따라간다
  paint();
  toast('이어서 합니다 — 저장하려면 저장을 누르십시오');
}
function draftDiscard(){
  PENDING = null;
  draftDrop();
  paint();
  toast('안 누른 고침을 버렸습니다');
}
function cfgForget(){
  try { localStorage.removeItem(CFGKEY); } catch (e) {}
  toast('저장된 설정을 지웠습니다 — 새로고침하면 처음 상태로 돌아갑니다');
}
function cfgChange(msg, fn){ var b = whereMap(); snap(); fn(); cfgSave(); commit(msg, b);
  if (cfgOpen) drawCfg(); }