# -*- coding: utf-8 -*-
"""샘플을 손으로 안 그린다 — 진짜 앱(index.html + app.js)을 그대로 담고,
서버 자리에만 가짜 장부를 끼워 넣는다. 그래야 샘플과 배포본이 영영 안 어긋난다."""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 내보낼 자리 — 첫 번째 인자로 바꿀 수 있다
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '_sample_cart.html')

html = io.open(os.path.join(ROOT, 'public', 'index.html'), encoding='utf-8').read()
appjs = io.open(os.path.join(ROOT, 'public', 'app.js'), encoding='utf-8').read()

head = html.split('<head>', 1)[1].split('</head>', 1)[0]
body = html.split('<body>', 1)[1].rsplit('</body>', 1)[0]

# 바깥에서 끌어오는 것은 다 뺀다 — 아티팩트는 제 밖으로 못 나간다
head = re.sub(r'<link rel="manifest"[^>]*>', '', head)
head = re.sub(r'<link rel="apple-touch-icon"[^>]*>', '', head)
head = head.replace('<title>리버힐 캐디 일정</title>', '<title>카트 점검 새 안</title>')  # 이름은 그대로 둔다
body = re.sub(r'<script src="/html2pdf[^"]*"></script>', '', body)
assert '<script src="/app.js"></script>' in body

FAKE = r"""
<!-- ══ 샘플 전용 — 진짜 앱에는 없습니다 ═══════════════════════════════
     아래는 '서버인 척하는 장부' 하나뿐입니다. 화면과 움직임은 전부
     배포된 앱(index.html · app.js) 그대로입니다. -->
<style>
.smpclk { position:sticky; top:0; z-index:90; background:#1d2129; color:#fff; padding:9px 14px 11px; }
.smpclk .t { font-size:10px; font-weight:800; letter-spacing:.05em; opacity:.6; }
.smpclk .r { display:flex; align-items:center; gap:11px; margin-top:6px; }
.smpclk .now { flex:none; font-size:19px; font-weight:900; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
.smpclk input { flex:1 1 auto; min-width:0; accent-color:#3fd9ad; }
.smpclk .tees { font-size:10px; font-weight:750; opacity:.55; margin-top:5px; }
/* 시계 막대가 앱의 '‹ 홈' 단추를 가린다 — 샘플에서만 그만큼 내려 앉힌다 */
body .vback { top:84px; }
</style>
<div class="smpclk">
  <div class="t">샘플 전용 시계 · 진짜 앱에는 없습니다</div>
  <div class="r"><span class="now" id="smpNow">06:20</span>
    <input id="smpIn" type="range" min="330" max="1230" step="5" value="380"></div>
  <div class="tees" id="smpTees"></div>
</div>
@@SPLIT@@
<script>
(function () {
  /* ── 시계 — 앱이 '지금'을 묻는 자리를 한 군데서 옮겨 준다 ── */
  var RD = Date, SHIFT = 0;
  function setClock(min) {
    var n = new RD(), cur = n.getHours() * 60 + n.getMinutes();
    SHIFT = (min - cur) * 60000;
    document.getElementById('smpNow').textContent =
      String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }
  window.Date = new Proxy(RD, {
    construct: function (t, a) { return a.length ? Reflect.construct(RD, a) : new RD(RD.now() + SHIFT); },
    get: function (t, k) { return k === 'now' ? function () { return RD.now() + SHIFT; } : Reflect.get(t, k); },
  });

  /* ── 가짜 장부 — src/cartcheck.mjs 가 하는 셈을 그대로 ── */
  var TEES = [{ part: '1부', teeTime: '06:50' }, { part: '2부', teeTime: '11:20' }, { part: '3부', teeTime: '15:40' }];
  var OPS = [['battery', '보조배터리 충전'], ['tablet', '태블릿 충전'], ['radio', '무전기 충전'], ['guidekey', '유도키 전용칸 반납']];
  var seq = 0;
  var TODAY = (function () { var d = new RD(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  var day = {
    date: TODAY, cartNo: '12', clubN: 1,
    carts: [{ id: 'c1', no: '12', chg: false, chgAt: null, bad: false, note: '', outAt: null }],
    photos: {}, checklist: {}, opsReturn: {}, stampedAt: null, lostItems: [],
  };
  var legOf = function (b, i) { return i > 0 ? b + '#' + (i + 1) : b; };
  var arr = function (leg) { return day.photos[leg] || []; };
  function status() {
    var need = day.carts.map(function (c, i) { return c.no ? -1 : i; }).filter(function (i) { return i >= 0; });
    var checks = OPS.map(function (o) { return { key: o[0], label: o[1], done: !!day.opsReturn[o[0]], at: day.opsReturn[o[0]] || null }; });
    var cs = day.carts.map(function (c, i) { return { before: arr(legOf('intake', i)).length, after: arr(legOf('exit', i)).length }; });
    var ls = []; for (var i = 0; i < day.clubN; i++) ls.push({ before: arr(legOf('club_pre', i)).length, after: arr(legOf('club_post', i)).length });
    var np = 0; for (var k in day.photos) np += day.photos[k].length;
    return { cart: { before: cs[0].before, after: cs[0].after, done: cs[0].before > 0 && cs[0].after > 0 },
      club: { before: ls[0].before, after: ls[0].after, done: ls[0].before > 0 && ls[0].after > 0 },
      cartShots: cs, clubShots: ls, carts: day.carts, clubN: day.clubN, checks: checks,
      nums: { need: need, done: !need.length }, nPhoto: np,
      doneCount: need.length ? 0 : 1, total: 1, allDone: !need.length, dutyDay: false };
  }
  function snap() {
    var d = JSON.parse(JSON.stringify(day));
    d.progress = { checked: 0, total: 9, done: false };
    d.returnStatus = status();
    if (!d.returnStatus.allDone) { day.stampedAt = null; d.stampedAt = null; }
    return d;
  }
  var blankCart = function () { return { id: 'c' + (++seq), no: '', chg: false, chgAt: null, bad: false, note: '', outAt: null }; };
  function shift(bases, i, n) {
    bases.forEach(function (b) {
      delete day.photos[legOf(b, i)];
      for (var k = i; k < n - 1; k++) day.photos[legOf(b, k)] = arr(legOf(b, k + 1));
      delete day.photos[legOf(b, n - 1)];
    });
  }
  var ROUTES = {
    '/api/me': function () { return { ok: true, authed: true, googleEnabled: true, status: 'active',
      user: { id: 1, role: 'member', name: '김홍구' }, profile: { boardName: '김홍구', part: '3부', caddieType: 'part3' } }; },
    '/api/cart-owners': function () { return { ok: true, owners: { 12: '김홍구', 27: '강민순', 41: '이수련' } }; },
    '/api/cartcheck': function () { return { ok: true, date: TODAY, today: TODAY, items: [], day: snap(), tees: TEES,
      work: { isWorkToday: true, teeTime: '06:50', course: '동', cartNo: day.carts[0].no } }; },
    '/api/cartcheck/recent': function () { return { ok: true, today: TODAY, retainDays: 45, days: [] }; },
    '/api/cartcheck/records': function () { return { ok: true, today: TODAY, records: [] }; },
    '/api/cartcheck/cart/set': function (b) {
      var c = day.carts[b.i]; if (!c) return { ok: true, day: snap() };
      if (b.no !== undefined) { c.no = String(b.no || '').replace(/[^0-9]/g, '').slice(0, 4); day.cartNo = day.carts[0].no; }
      if (b.bad !== undefined) { c.bad = !!b.bad; if (!c.bad) c.note = ''; }
      if (b.note !== undefined) c.note = String(b.note || '').slice(0, 60);
      if (b.chg !== undefined) { c.chg = !!b.chg; c.chgAt = c.chg ? (c.chgAt || Date.now()) : null; }
      return { ok: true, day: snap() };
    },
    '/api/cartcheck/cart/add': function () {
      if (day.carts.length < 6) { var l = day.carts[day.carts.length - 1]; if (l && !l.outAt) l.outAt = Date.now(); day.carts.push(blankCart()); }
      return { ok: true, day: snap() };
    },
    '/api/cartcheck/cart/remove': function (b) {
      if (day.carts.length > 1) { shift(['intake', 'exit'], b.i, day.carts.length); day.carts.splice(b.i, 1); day.cartNo = day.carts[0].no; }
      return { ok: true, day: snap() };
    },
    '/api/cartcheck/club/add': function () { day.clubN = Math.min(6, day.clubN + 1); return { ok: true, day: snap() }; },
    '/api/cartcheck/club/remove': function (b) {
      if (day.clubN > 1) { shift(['club_pre', 'club_post'], b.i, day.clubN); day.clubN--; }
      return { ok: true, day: snap() };
    },
    '/api/cartcheck/return': function (b) {
      if (b.done) day.opsReturn[b.key] = Date.now(); else delete day.opsReturn[b.key];
      return { ok: true, day: snap() };
    },
    '/api/cartcheck/stamp': function (b) {
      if (b.stamped && !status().allDone) { var d = snap(); d.stampError = 'incomplete'; return { ok: false, day: d }; }
      day.stampedAt = b.stamped ? (day.stampedAt || Date.now()) : null;
      return { ok: true, day: snap() };
    },
    '/api/cartcheck/photo': function (b) {
      (day.photos[b.leg] = day.photos[b.leg] || []).push(b.image);   // 샘플은 그림을 통째로 들고 있는다
      return { ok: true, day: snap() };
    },
    '/api/cartcheck/photo/remove': function (b) {
      day.photos[b.leg] = arr(b.leg).filter(function (f) { return f !== b.fname; });
      return { ok: true, day: snap() };
    },
    '/api/cartcheck/lost/add': function (b) {
      day.lostItems.push({ id: 'l' + (++seq), name: String(b.name || '').slice(0, 60), photo: b.image || null, at: Date.now(), sentAt: Date.now() });
      return { ok: true, day: snap() };
    },
    '/api/cartcheck/lost/remove': function (b) {
      day.lostItems = day.lostItems.filter(function (x) { return x.id !== b.id; });
      return { ok: true, day: snap() };
    },
  };
  var realFetch = window.fetch;
  window.fetch = function (url, opt) {
    var u = String(url && url.url ? url.url : url);
    var p = u.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
    var fn = ROUTES[p];
    if (!fn && p.indexOf('/api/') !== 0) return realFetch.apply(window, arguments);
    var body = {};
    try { body = JSON.parse((opt && opt.body) || '{}'); } catch (e) { body = {}; }
    var o = fn ? fn(body) : { ok: true };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(o); },
      text: function () { return Promise.resolve(JSON.stringify(o)); } });
  };
  if (navigator.serviceWorker) { try { navigator.serviceWorker.register = function () { return Promise.reject(new Error('샘플')); }; } catch (e) { /* 무해 */ } }

  /* 켜자마자 카트 화면으로 */
  location.hash = '#cart';
  setClock(380);
  window.addEventListener('DOMContentLoaded', function () {
    document.getElementById('smpTees').textContent = '오늘 티오프  ' + TEES.map(function (t) { return t.part + ' ' + t.teeTime; }).join('   ·   ');
    document.getElementById('smpIn').oninput = function () {
      setClock(+this.value);
      if (window.loadCartCheck) window.loadCartCheck(undefined, {});
    };
  });
})();
</script>
"""

# 시계 막대는 몸의 맨 위에 — 이 앱은 body가 세로 칸이고 main만 구른다(sticky가 안 먹는다)
bar, fakejs = FAKE.split('@@SPLIT@@')
body = bar + body.replace('<script src="/app.js"></script>',
                          fakejs + '<script>\n' + appjs + '\n</script>')

io.open(OUT, 'w', encoding='utf-8').write(head + '\n' + body)
sys.stdout.write('%s  %d bytes\n' % (OUT, os.path.getsize(OUT)))
