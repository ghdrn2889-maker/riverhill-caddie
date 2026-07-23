// 리버힐 캐디 PWA — 확정 시안(행동 진행 보드)에 실데이터를 물린다.
// 화면/스타일은 sandbox/hybrid-prototypes.html(HYBRID 02)을 그대로 이식한 index.html을 따른다.
const $ = (id) => document.getElementById(id);
const WD = ['일', '월', '화', '수', '목', '금', '토'];

let swReg = null;
let lastToday = null;
let todayOk = false;

/* ── 시간 유틸(폰 로컬시각 = KST) ── */
const toMin = (hhmm) => { const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = (min) => { const v = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
const gap = (m) => m <= 0 ? '지금' : m < 60 ? `${m}분 남음` : (m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분 남음` : `${Math.floor(m / 60)}시간 남음`);
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const postJSON = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

/* ── 헤더 날짜·시각 ── */
function tickDate() {
  const d = new Date();
  $('date').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일 · ${hhmm(d.getHours() * 60 + d.getMinutes())}`;
}

/* ── 하단 내비 / 뷰 전환 ── */
const VIEWS = ['today', 'news', 'cart', 'worklog'];
function showView(name) {
  if (!VIEWS.includes(name)) name = 'today';
  VIEWS.forEach((v) => { $('view-' + v).hidden = v !== name; $('tab-' + v).setAttribute('aria-selected', String(v === name)); });
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  if (name === 'worklog') { loadJournal(); loadWorklog(); }
  if (name === 'cart') loadCartCheck();
  if (name === 'news') markAllRead();
  window.scrollTo(0, 0);
}
function initNav() {
  document.querySelectorAll('nav.nav button').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
  $('toNews').onclick = () => showView('news');
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
  showView(location.hash.slice(1) || 'today');
}

/* ── 서비스워커 + 알림 구독(자가복구) ── */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function registerSW() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try { swReg = await navigator.serviceWorker.register('/sw.js'); } catch { swReg = null; }
  return swReg;
}
async function healSubscription() {
  try {
    if (!swReg) return;
    const sub = await swReg.pushManager.getSubscription();
    if (sub) await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
  } catch {}
}
async function enableNotifications() {
  const btn = $('enableBtn'), msg = $('enableMsg');
  try {
    btn.disabled = true; msg.textContent = '';
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { msg.textContent = '이 브라우저는 웹푸시를 지원하지 않아요(안드로이드 크롬 권장).'; return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { msg.textContent = '알림 권한이 거부됐어요. 브라우저 설정에서 허용해주세요.'; btn.disabled = false; return; }
    if (!swReg) await registerSW();
    const { vapidPublicKey } = await (await fetch('/api/config')).json();
    const sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
    await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    await refreshPushHealth();
  } catch (e) { msg.textContent = '알림 켜기 실패: ' + e.message; btn.disabled = false; }
}
async function refreshPushHealth() {
  const el = $('hPush'), btn = $('enableBtn');
  const set = (cls, txt) => { el.className = cls; el.textContent = txt; };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { set('bad', '● 알림 미지원'); btn.hidden = true; return; }
  if (Notification.permission === 'denied') { set('bad', '● 알림 권한 꺼짐'); btn.hidden = true; return; }
  let sub = null;
  try { sub = swReg && await swReg.pushManager.getSubscription(); } catch {}
  if (Notification.permission === 'granted' && sub) { set('', ''); btn.hidden = true; healSubscription(); } // 정상이면 표시 숨김(사용자용)
  else { set('warn', '● 이 폰 알림 꺼짐'); btn.hidden = false; btn.disabled = false; }
  syncHealthVisibility();
}

// 감시·알림 표시가 모두 '정상(빈 값)'이면 상태 바 자체를 숨김 — 문제가 있을 때만 노출.
function syncHealthVisibility() {
  const box = $('health'), w = $('hWatch'), p = $('hPush');
  if (!box) return;
  const empty = (!w || !w.textContent.trim()) && (!p || !p.textContent.trim());
  box.style.display = empty ? 'none' : '';
}

/* ── 감시 상태 ── */
async function loadWatchHealth() {
  const el = $('hWatch');
  try {
    const h = await (await fetch('/api/health')).json();
    if (h.alive) { el.className = ''; el.textContent = ''; } // 정상이면 표시 숨김(사용자용) — 문제일 때만 노출
    else { el.className = 'bad'; el.textContent = h.failStreak >= 2 ? '● 감시 오류(쿠키 확인)' : '● 감시 지연'; }
  } catch { el.className = 'warn'; el.textContent = '● 상태 확인 실패'; }
  syncHealthVisibility();
}

/* ── 오늘: 상황판 히어로 + 행동 보드 ── */
async function loadToday() {
  try { const t = await (await fetch('/api/today')).json(); lastToday = t; todayOk = true; renderToday(t); }
  catch { if (!todayOk) { $('heroTitle').textContent = '일정을 확인하지 못했어요'; $('heroSub').textContent = '잠시 후 다시 시도합니다.'; } }
}
function renderToday(t) {
  if (!t || t.empty || !t.state) {
    if (t && t.stale) {
      $('heroTitle').textContent = '오늘 배치표 확인 중';
      $('heroSub').textContent = t.message || '아직 오늘 배치표를 확보하지 못했어요. 확인되면 바로 갱신됩니다.';
    } else {
      $('heroTitle').textContent = '아직 오늘 정보가 없어요';
      $('heroSub').textContent = '배치표나 3부 소식이 올라오면 여기에 표시됩니다.';
    }
    $('boardSlot').innerHTML = ''; return;
  }
  const s = t.state, st = s.status;
  const isWork = st === 'assigned' || st === 'work' || st === 'your_turn';
  const isSpare = st === 'spare' || st === 'waiting' || st === 'near';
  const posTxt = s.myPosition ? ` · ${s.myPosition}번째` : '';
  $('heroTitle').textContent = st === 'your_turn' ? '지금 출근 차례!'
    : isWork ? '오늘 근무 확정'
    : st === 'off' ? '오늘 휴무'
    : isSpare ? `${s.part || '3부'} 스페어${posTxt}` : '대기 중';
  $('heroSub').textContent = st === 'your_turn' ? '앞 순번이 모두 찼어요. 지금 바로 출근 준비하세요.'
    : isWork ? '아래 시간에 맞춰 움직이면 됩니다.'
    : st === 'off' ? '오늘은 예정된 근무가 없어요. 편히 쉬세요.'
    : isSpare ? '아래에서 대기 순번과 확정선을 확인하세요.'
    : '아직 오늘 상황이 확정되지 않았어요.';
  renderBoard(t);
}
function renderBoard(t) {
  const slot = $('boardSlot'); if (!slot) return;
  const s = t.state, st = s.status;
  const isWork = st === 'assigned' || st === 'work' || st === 'your_turn';
  const c = t.commute;

  if (isWork && c && toMin(c.leave) != null) {
    const now = nowMin(), leave = toMin(c.leave), arrive = toMin(c.arrive), tee = toMin(c.tee);
    const commuteMin = (arrive != null && leave != null) ? arrive - leave : null;
    const before = now < leave;
    const act = before ? '집에서 출발' : (now < tee ? '골프장 도착' : '근무 중');
    const big = before ? c.leave : (now < tee ? c.arrive : c.tee);
    const rem = before ? gap(leave - now) : (now < arrive ? gap(arrive - now) : (now < tee ? gap(tee - now) : ''));
    const ci = before ? 1 : 2;                     // 0 일정확인 / 1 출발 / 2 도착
    const fill = ci === 1 ? 50 : 100;              // '출발'(가운데 50%)까지 / '도착'(100%)까지
    const preAlarm = hhmm(leave - 10);
    // 레일 3정거장: 일정확인(왼쪽) → 출발(가운데) → 도착(오른쪽). 동그라미를 라벨 위치에 정확히 맞춤.
    //  ★출발 점은 라벨과 동일하게 가운데(50%)에 두고 translateX로 중심 정렬(예전엔 34%라 라벨과 어긋남).
    const p2base = 'left:50%;transform:translateX(-50%)';
    const p2 = ci >= 2 ? `${p2base};background:#2e7149;border-color:#2e7149` : p2base;
    const p3 = ci >= 2 ? 'border-color:#d99a31;box-shadow:0 0 0 4px rgba(217,154,49,.2)' : '';
    const lab = ['일정 확인', '출발', '도착'];
    slot.innerHTML = `<div class="actionboard">
      <div class="actiontop"><b>다음 행동 · ${act}</b><span class="clock">현재 ${hhmm(now)}</span></div>
      <div class="nextline"><strong>${esc(big)}</strong><span>${rem}</span></div>
      <div class="rail"><i class="track"></i><i class="fill" style="width:${fill}%"></i>
        <i class="point p1"></i><i class="point p2" style="${p2}"></i><i class="point p3" style="${p3}"></i></div>
      <div class="railtext"><span>${lab[0]}</span>${ci === 1 ? `<b>${lab[1]}</b>` : `<span>${lab[1]}</span>`}${ci >= 2 ? `<b>${lab[2]}</b>` : `<span>${lab[2]}</span>`}</div>
      <div class="alert"><span>${preAlarm}에 다시 알려드릴게요</span><b>10분 전</b></div>
      <div class="minirow">
        <div class="mini"><span>예상 이동</span><b>${commuteMin != null ? commuteMin + '분' : '—'}</b></div>
        <div class="mini"><span>티오프</span><b>${esc(c.tee)}${s.course ? ` ${esc(s.course)}` : ''}</b></div>
      </div>
    </div>`;
    return;
  }
  // 티오프 미배정(스페어/휴무/미상) — 시간 지어내지 않음.
  if (st === 'off') slot.innerHTML = `<div class="board-plain"><b>오늘은 예정된 근무가 없어요.</b> 편히 쉬세요. 새 소식이 오면 알려드릴게요.</div>`;
  else if (st === 'spare' || st === 'waiting' || st === 'near') slot.innerHTML = renderSpareBoard(s);
  else if (st === 'your_turn') slot.innerHTML = `<div class="board-plain"><b style="color:#bd312d">지금 바로 출근 준비하세요.</b> 티오프가 올라오면 시간 안내로 바뀝니다.</div>`;
  else slot.innerHTML = '';
}

// 스페어(대기) 대시보드 — '대기 순번 리스트'(깔끔 리스트 확정안). 실데이터로 그림.
function renderSpareBoard(s) {
  const myPos = Number(s.myPosition) || 0;
  const cut = Number(s.cutLine) || 0;
  const roster = Array.isArray(s.roster3) ? s.roster3 : [];
  const nameAt = (p) => (typeof p === 'number' && p >= 1 && roster[p - 1]) ? roster[p - 1] : '';
  const note = ''; // (사용자 요청) 티오프 당겨짐 안내 문구 숨김

  // 확정선 정보가 없으면(텍스트-only 등) 간단 안내로 폴백.
  if (!myPos || !cut || myPos <= cut) {
    return `<div class="sp-board"><div class="sp-foot" style="border-top:0"><span>🕒</span>` +
      `<span>아직 <b>근무 확정 전</b>이에요${myPos ? ` · 순번 ${myPos}번` : ''}. 확정선 소식이 오면 앞으로 몇 명 남았는지 계산해 알려드릴게요.</span></div>${note}</div>`;
  }

  const ahead = Math.max(0, myPos - cut - 1);
  const rows = [];
  const rowHTML = (p, kind) => {
    const nm = nameAt(p);
    let st, badge;
    if (kind === 'done') { st = nm || '확정'; badge = '<span class="sp-badge sp-b-work">근무</span>'; }
    else if (kind === 'me') { st = '나 — 대기 중'; badge = '<span class="sp-badge sp-b-me">나</span>'; }
    else { st = nm || '대기'; badge = '<span class="sp-badge sp-b-wait">스페어</span>'; }
    return `<div class="sp-row ${kind}"><span class="no">${p}</span><span class="st">${esc(st)}</span>${badge}</div>`;
  };
  // 확정 구간(커트라인 직전 2행)
  if (cut - 1 >= 1) rows.push(rowHTML(cut - 1, 'done'));
  rows.push(rowHTML(cut, 'done'));
  rows.push(`<div class="sp-cut"><i></i><b>확정선 · 여기까지 근무</b><i></i></div>`);
  // 대기 구간(길면 가운데 ⋯로 접기)
  const waitStart = cut + 1;
  if (myPos - 1 - waitStart <= 2) {
    for (let p = waitStart; p <= myPos - 1; p++) rows.push(rowHTML(p, 'wait'));
  } else {
    rows.push(rowHTML(waitStart, 'wait'));
    rows.push(`<div class="sp-row"><span class="no">⋯</span><span class="st">대기</span><span class="sp-badge sp-b-wait">스페어</span></div>`);
    rows.push(rowHTML(myPos - 1, 'wait'));
  }
  rows.push(rowHTML(myPos, 'me'));
  rows.push(rowHTML(myPos + 1, 'wait'));

  return `<div class="sp-board">
    <div class="sp-head">
      <div><div class="lbl">3부 대기 순번</div><div class="sp-cutinfo">현재 확정선 ${cut}번</div></div>
      <div class="sp-ahead"><b>${ahead}</b><span>내 앞</span></div>
    </div>
    <div class="sp-list">${rows.join('')}</div>
  </div>`;
}

/* ── 소식 피드 ── */
const LAST_READ_KEY = 'riverhill_lastReadTs';
const getLastRead = () => Number(localStorage.getItem(LAST_READ_KEY) || 0);
const setLastRead = (ts) => localStorage.setItem(LAST_READ_KEY, String(ts || 0));
function newsHTML(a) {
  const ts = a.detectedAt || 0;
  const isNew = ts > getLastRead();
  const tag = a.status === 'your_turn' ? '<span class="tag red">지금 차례</span>'
    : a.status === 'near' ? '<span class="tag red">곧 차례</span>'
    : (a.status === 'assigned' || a.status === 'work') ? '<span class="tag amb">근무</span>'
    : a.status === 'spare' ? '<span class="tag amb">스페어</span>'
    : (a.relevant && a.priority === 'high') ? '<span class="tag amb">일정</span>' : '';
  const cat = a.category ? `<span class="tag cat">${esc(a.category)}</span>` : '';
  const dot = isNew ? '<span class="red">● </span>' : '';
  const head = a.aiMessage || a.subject;
  const when = timeAgo(ts) || a.writeDate || '';
  const rest = [a.aiMessage ? a.subject : '', a.writer, a.menuName].filter(Boolean).join(' · ');
  return `<a class="news${isNew ? ' newitem' : ''}${a.relevant === false ? ' dim' : ''}" href="${a.url}" target="_blank" rel="noopener">
    <b>${dot}${cat}${tag}${esc(head)}</b><small>${[when, rest].filter(Boolean).map(esc).join(' · ')}</small></a>`;
}
async function loadRecent() {
  let raw; try { raw = await (await fetch('/api/recent')).json(); } catch { return; }
  // 관련 있는 소식만 표시(무관한 건 서버가 애초에 안 남김 — 사용자 요청). 옛 무관 항목 대비 방어 필터.
  const all = (raw || []).filter((a) => a.relevant !== false);
  const lastRead = getLastRead(); let unread = 0, newest = 0;
  all.forEach((a) => { const ts = a.detectedAt || 0; if (ts > newest) newest = ts; if (ts > lastRead) unread++; });
  const u = $('unread'), r = $('readAll');
  if (unread > 0) { u.textContent = unread; u.hidden = false; r.hidden = false; } else { u.hidden = true; r.hidden = true; }
  r.dataset.newest = String(newest);

  $('todayNews').innerHTML = all.length ? all.slice(0, 3).map(newsHTML).join('') : '<div class="empty">관련 소식이 아직 없어요.</div>';
  $('recent').innerHTML = all.length ? all.map(newsHTML).join('') : '<div class="empty">아직 감지된 소식이 없어요.</div>';
}
function markAllRead() { setLastRead(Number($('readAll').dataset.newest) || Date.now()); loadRecent(); }

/* ── 일일 근무 일지(근무/스페어/휴무 하루하루) ── */
async function loadJournal() {
  try {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
    const r = await (await fetch(`/api/journal?year=${y}&month=${m}`)).json();
    const s = r.summary || {}, days = r.days || [];
    $('jSummary').textContent = `${y}년 ${m}월`;
    $('jSub').textContent = `근무 ${s.work || 0}일 · 스페어 ${s.spare || 0}일 · 휴무 ${s.off || 0}일`;
    const KIND = { work: ['work', '근무'], spare: ['spare', '스페어'], off: ['off', '휴무'] };
    $('jDays').innerHTML = days.length ? days.map((d) => {
      const dow = WD[new Date(d.date + 'T00:00:00').getDay()];
      const md = `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}(${dow})`;
      const [cls, label] = KIND[d.kind] || ['off', '기타'];
      const detail = d.kind === 'work' && d.teeTime ? `<span class="jt">티오프 ${esc(d.teeTime)}${d.course ? ' ' + esc(d.course) : ''}</span>`
        : d.myPosition ? `<span class="jt">순번 ${d.myPosition}</span>` : '';
      return `<div class="jday"><div><span class="jd">${md}</span>${detail}</div><span class="jk ${cls}">${label}</span></div>`;
    }).join('') : '<div class="empty">이번 달 기록이 아직 없어요.</div>';
  } catch { $('jSummary').textContent = '불러오기 실패'; }
}

/* ── 근무·세무 기록 (월 단위 · 요약 카드 · 정리 필터) ── */
let wlYear = null, wlMonth = null, wlFilter = 'all', wlFuelOn = false, wlOpenDate = null;
let wlCache = { year: null, days: [], settings: {} }; // 연 단위로 한 번만 로드 → 월 이동은 재요청 없이

const wlIsAsk = (d) => d.worked == null;
const wlIsBlank = (d) => d.worked === true
  && !(d.photos && Object.keys(d.photos).length) && !(d.odo && Object.keys(d.odo).length);
function wlDayKm(d, roundKm) {
  const o = d.odo || {};
  if (o.start != null && o.home != null && o.home >= o.start) return o.home - o.start;
  return roundKm;
}

async function loadWorklog() {
  const now = new Date();
  if (wlYear == null) { wlYear = now.getFullYear(); wlMonth = now.getMonth() + 1; }
  if (wlCache.year !== wlYear) {
    try {
      const r = await (await fetch(`/api/worklog?year=${wlYear}`)).json();
      wlCache = { year: wlYear, days: r.days || [], settings: r.settings || {} };
    } catch { $('wlMLabel').textContent = '불러오기 실패'; return; }
  }
  renderWorklog();
}
function reloadWorklog() { wlCache.year = null; return loadWorklog(); } // 변경 후 강제 새로고침

function renderWorklog() {
  const now = new Date(), realY = now.getFullYear(), realM = now.getMonth() + 1;
  const s = wlCache.settings || {};
  const roundKm = (Number(s.homeGolfKmOneway) || 30) * 2;
  const kmPerL = Number(s.kmPerL) || 12, price = Number(s.fuelPrice) || 1700;

  // 설정 입력칸(포커스 중 아니면 갱신)
  if (document.activeElement !== $('wlKm')) $('wlKm').value = s.homeGolfKmOneway ?? 30;
  if (document.activeElement !== $('wlName')) $('wlName').value = s.driverName || '';
  if (document.activeElement !== $('wlCar')) $('wlCar').value = s.carNo || '';

  // 월 라벨·네비
  $('wlMLabel').textContent = `${wlYear}년 ${wlMonth}월`;
  const isNow = wlYear === realY && wlMonth === realM;
  $('wlMSub').textContent = isNow ? '이번 달' : '지난 기록';
  $('wlMSub').style.opacity = isNow ? '.72' : '.5';
  $('wlThisMo').hidden = isNow;
  $('wlNext').disabled = (wlYear > realY) || (wlYear === realY && wlMonth >= realM);
  $('wlSc1').textContent = $('wlSc2').textContent = `${wlMonth}월`;

  const yearDays = wlCache.days;
  const monthDays = yearDays.filter((d) => Number(d.date.slice(5, 7)) === wlMonth);

  // 연 누적
  const yWorked = yearDays.filter((d) => d.worked === true);
  $('wlYrY').textContent = `${wlYear}년`;
  $('wlYrDays').textContent = yWorked.length;
  $('wlYrKm').textContent = yWorked.reduce((a, d) => a + wlDayKm(d, roundKm), 0).toLocaleString();

  // 월 통계
  const mWorked = monthDays.filter((d) => d.worked === true);
  const mKm = mWorked.reduce((a, d) => a + wlDayKm(d, roundKm), 0);
  $('wlSDays').textContent = mWorked.length;
  $('wlSKm').textContent = mKm.toLocaleString();

  // 세 번째 칸: 기본 '증빙 사진 있는 날', 켜면 '예상 유류비 어림값'
  if (wlFuelOn) {
    const fuel = Math.round(mKm / kmPerL * price);
    $('wlS3k').innerHTML = `예상 유류비 <span class="tg">어림값</span>`;
    $('wlS3v').innerHTML = fuel >= 10000 ? `${(fuel / 10000).toFixed(1)}<small>만</small>` : fuel.toLocaleString();
    $('wlS3u').textContent = '원';
    $('wlAssume').hidden = false;
    $('wlAssume').innerHTML = `※ 유류비는 <b>주행거리 ÷ 연비(${kmPerL}km/L) × 평균유가(${price.toLocaleString()}원)</b> 로 낸 <b>어림값</b>이에요. 기름값은 매일·주유소마다 달라 정확할 수 없고, <b>실제 공제는 주유 영수증 기준</b>입니다.`;
    $('wlFuelToggle').textContent = '예상 유류비 어림값 끄기';
  } else {
    $('wlS3k').textContent = '증빙 사진';
    $('wlS3v').textContent = mWorked.filter((d) => d.photos && Object.keys(d.photos).length).length;
    $('wlS3u').textContent = `/ ${mWorked.length}일`;
    $('wlAssume').hidden = true;
    $('wlFuelToggle').textContent = '예상 유류비 어림값 켜기';
  }

  // 정리 상태 + 세그먼트 카운트
  const nAsk = monthDays.filter(wlIsAsk).length, nPhoto = monthDays.filter(wlIsBlank).length;
  $('wlCAll').textContent = monthDays.length; $('wlCAsk').textContent = nAsk; $('wlCPhoto').textContent = nPhoto;
  const tidy = $('wlTidy');
  if (nAsk + nPhoto === 0) {
    tidy.className = 'wl-tidy ok'; tidy.querySelector('.ic').textContent = '✓';
    $('wlTidyTxt').textContent = '모두 정리됐어요';
  } else {
    tidy.className = 'wl-tidy warn'; tidy.querySelector('.ic').textContent = '⚠️';
    const parts = []; if (nAsk) parts.push(`확인 대기 ${nAsk}일`); if (nPhoto) parts.push(`사진 미입력 ${nPhoto}일`);
    $('wlTidyTxt').innerHTML = parts.join(' · ') + `<span class="go">아래에서 정리 ↓</span>`;
  }

  // 목록(필터 적용)
  let list = monthDays;
  if (wlFilter === 'ask') list = monthDays.filter(wlIsAsk);
  else if (wlFilter === 'photo') list = monthDays.filter(wlIsBlank);
  $('wlDays').innerHTML = list.length ? list.map((d) => wlCard(d, roundKm)).join('')
    : `<div class="empty">${wlFilter === 'all' ? '이 달 기록이 아직 없어요.' : '해당 항목이 없어요.'}</div>`;
  wlBind();
}

const WL_LEG = [['start', '🏠 집출발'], ['work', '⛳ 직장도착'], ['home', '🏠 집복귀']];
function wlCard(d, roundKm) {
  const dt = new Date(d.date + 'T00:00:00'), day = Number(d.date.slice(8, 10)), dow = dt.getDay();
  const wc = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
  const attn = wlIsAsk(d) || wlIsBlank(d);
  const nPhoto = d.photos ? Object.keys(d.photos).length : 0;
  let right, meta;
  if (d.worked == null) {
    right = `<button class="wl-btn wl-yes" data-w="1" data-d="${d.date}">예</button><button class="wl-btn wl-no" data-w="0" data-d="${d.date}">아니오</button>`;
    meta = `<span>근무 확정 감지 · 근무하셨나요?</span>`;
  } else if (d.worked === false) {
    right = `<span class="wl-chip x">안 함</span>`; meta = `<span>근무 안 한 날</span>`;
  } else {
    right = `<span class="wl-chip ok">✓ 근무</span>`;
    const ph = nPhoto > 0 ? `<span class="ph">📷 ${nPhoto}장</span>` : `<span class="ph miss">📷 사진 미입력</span>`;
    const odo = d.odo && Object.keys(d.odo).length ? `<span>· 계기판 입력됨</span>` : '';
    meta = `${ph}${odo}`;
  }
  const tee = d.teeTime ? `${d.teeTime}${d.course ? ' ' + d.course : ''}` : (d.worked === false ? '—' : (d.source === 'manual' ? '수동 입력' : ''));
  const expandable = d.worked !== false;
  let panel = '';
  if (expandable) {
    const odo = d.odo || {};
    const slots = WL_LEG.map(([leg, lab]) => {
      const has = d.photos && d.photos[leg];
      const inner = has ? `<img src="/api/worklog/photo/${d.photos[leg]}?t=${d.confirmedAt || 0}">` : '📷';
      return `<label class="wl-slot"><span class="box${has ? ' done' : ''}">${inner}</span><span class="lab">${lab}</span>
        <input type="file" accept="image/*" capture="environment" data-d="${d.date}" data-leg="${leg}" hidden></label>`;
    }).join('');
    panel = `<div class="wl-panel">
      <div class="wl-slots">${slots}</div>
      <div class="wl-odo">계기판 km(선택):
        <input type="number" inputmode="numeric" placeholder="출발" data-odo="${d.date}" data-leg="start" value="${odo.start ?? ''}">
        <input type="number" inputmode="numeric" placeholder="복귀" data-odo="${d.date}" data-leg="home" value="${odo.home ?? ''}">
        <button class="wl-btn wl-no" data-odosave="${d.date}">저장</button>
      </div><div class="wl-up" id="up-${d.date}"></div></div>`;
  }
  const open = d.date === wlOpenDate ? ' open' : '';
  return `<div class="wl-card${attn ? ' attn' : ''}${open}" data-card="${d.date}">
    <div class="wl-crow">
      <div class="wl-badge"><div class="dd">${day}</div><div class="ww ${wc}">${WD[dow]}</div></div>
      <div class="wl-cmid"><div class="tee">${esc(tee)}</div><div class="meta">${meta}</div></div>
      ${right}
      ${expandable ? `<span class="wl-caret">▾</span>` : ''}
    </div>${panel}</div>`;
}

function wlBind() {
  // 카드 펼침/접힘(버튼 클릭은 제외)
  $('wlDays').querySelectorAll('.wl-card').forEach((el) => {
    const row = el.querySelector('.wl-crow');
    if (!el.querySelector('.wl-caret')) return;
    row.onclick = (e) => {
      if (e.target.closest('button')) return;
      const d = el.dataset.card;
      wlOpenDate = el.classList.contains('open') ? null : d;
      el.classList.toggle('open');
    };
  });
  // 예/아니오
  $('wlDays').querySelectorAll('button[data-w]').forEach((b) => {
    b.onclick = async () => { await postJSON('/api/worklog/confirm', { date: b.dataset.d, worked: b.dataset.w === '1' }); reloadWorklog(); };
  });
  // 계기판 사진 업로드
  $('wlDays').querySelectorAll('input[type=file][data-leg]').forEach((inp) => {
    inp.onchange = async () => {
      if (!inp.files || !inp.files[0]) return;
      const dt = inp.dataset.d, up = $('up-' + dt); if (up) up.textContent = '업로드 중…';
      wlOpenDate = dt;
      try { const image = await compressImage(inp.files[0]); await postJSON('/api/worklog/photo', { date: dt, leg: inp.dataset.leg, image }); await reloadWorklog(); }
      catch (e) { if (up) up.textContent = '업로드 실패: ' + e.message; }
    };
  });
  // 계기판 숫자 저장
  $('wlDays').querySelectorAll('button[data-odosave]').forEach((b) => {
    b.onclick = async () => {
      const dt = b.dataset.odosave, odo = {};
      $('wlDays').querySelectorAll(`input[data-odo="${dt}"]`).forEach((i) => { if (i.value !== '') odo[i.dataset.leg] = Number(i.value); });
      wlOpenDate = dt;
      await postJSON('/api/worklog/odo', { date: dt, odo }); await reloadWorklog();
    };
  });
}
function compressImage(file, maxSide = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { let w = img.width, h = img.height; if (Math.max(w, h) > maxSide) { const r = maxSide / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); } const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h); resolve(cv.toDataURL('image/jpeg', quality)); };
    img.onerror = reject;
    const fr = new FileReader(); fr.onload = () => { img.src = fr.result; }; fr.onerror = reject; fr.readAsDataURL(file);
  });
}
function initWorklogButtons() {
  $('wlSave').onclick = async () => { await postJSON('/api/worklog/settings', { homeGolfKmOneway: Number($('wlKm').value) || 0, driverName: $('wlName').value.trim(), carNo: $('wlCar').value.trim() }); reloadWorklog(); };
  // 월 이동 (연 경계 넘으면 자동으로 연도도 이동 → 필요 시 재요청)
  $('wlPrev').onclick = () => { wlMonth--; if (wlMonth < 1) { wlMonth = 12; wlYear--; } wlOpenDate = null; loadWorklog(); };
  $('wlNext').onclick = () => { if ($('wlNext').disabled) return; wlMonth++; if (wlMonth > 12) { wlMonth = 1; wlYear++; } wlOpenDate = null; loadWorklog(); };
  $('wlJump').onclick = () => { const n = new Date(); wlYear = n.getFullYear(); wlMonth = n.getMonth() + 1; wlOpenDate = null; loadWorklog(); };
  $('wlFuelToggle').onclick = () => { wlFuelOn = !wlFuelOn; renderWorklog(); };
  $('wlSeg').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { wlFilter = b.dataset.f; $('wlSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderWorklog(); };
  });
  // 내보내기 — 지금 보는 그 달 기준
  $('wlExport').onclick = () => window.open(`/api/worklog/export.csv?year=${wlYear}&month=${wlMonth}`, '_blank');
  $('wlReport').onclick = () => window.open(`/api/worklog/report.html?year=${wlYear}&month=${wlMonth}`, '_blank');
}

/* ── 카트 점검 ── */
let ccDate = null;
let ccEditMode = false;
let ccIntakeCount = 0; // 현재 저장된 '카트 상태' 사진 수 — 다중 업로드 시 10장 상한 계산용
function ccSetPhoto(leg, fname) {
  const lbl = $(leg === 'intake' ? 'ccIntakeLbl' : 'ccExitLbl');
  const thumb = $(leg === 'intake' ? 'ccIntakeThumb' : 'ccExitThumb');
  if (fname) { thumb.src = `/api/cartcheck/photo/${fname}?t=${Date.now()}`; thumb.hidden = false; lbl.classList.add('has'); }
  else { thumb.hidden = true; lbl.classList.remove('has'); }
}
// 카트 상태(intake) — 여러 장 썸네일 + 각 삭제 버튼. 카메라로 찍을 때마다 추가됨.
function ccRenderIntakeThumbs(list) {
  const box = $('ccIntakeThumbs'), lbl = $('ccIntakeLbl');
  const arr = Array.isArray(list) ? list : (list ? [list] : []);
  ccIntakeCount = arr.length;
  box.innerHTML = arr.map((f) => `<span class="cc-thumbwrap"><img class="cc-thumb" src="/api/cartcheck/photo/${f}?t=${Date.now()}" alt="카트 상태"><button class="cc-thumbdel" data-f="${f}" aria-label="삭제">✕</button></span>`).join('');
  box.querySelectorAll('button[data-f]').forEach((b) => {
    b.onclick = async () => { await postJSON('/api/cartcheck/photo/remove', { date: ccDate, leg: 'intake', fname: b.dataset.f }); loadCartCheck(); };
  });
  lbl.classList.toggle('has', arr.length > 0);
  if (lbl.firstChild) lbl.firstChild.textContent = arr.length ? `📷 사진 추가 (${arr.length}장)` : '📷 사진 찍기';
}
function ccRenderList(items, checklist, progress) {
  const list = $('ccList'), prog = $('ccProg'), editBtn = $('ccEdit');
  if (ccEditMode) {
    editBtn.textContent = '✓ 편집 완료';
    prog.textContent = '항목 편집 중'; prog.classList.remove('done');
    list.innerHTML =
      items.map((it) => `<div class="cc-edit-item"><input value="${esc(it.label)}" data-key="${it.key}" aria-label="항목 이름"><button class="cc-del" data-del="${it.key}" title="삭제">✕</button></div>`).join('') +
      `<div class="cc-add-row"><input id="ccNewItem" placeholder="새 점검 항목 입력" aria-label="새 항목"><button id="ccAddItem" class="wl-btn wl-yes">추가</button></div>` +
      `<div class="cc-edit-foot"><button id="ccResetItems" class="wl-btn wl-no">항목 추천 받기</button><span class="cc-hint">추천 항목을 목록에 더해줘요(기존 항목은 그대로).</span></div>`;
    list.querySelectorAll('.cc-edit-item input').forEach((inp) => {
      inp.onchange = async () => { const v = inp.value.trim(); if (v) await postJSON('/api/cartcheck/items/rename', { key: inp.dataset.key, label: v }); };
    });
    list.querySelectorAll('button[data-del]').forEach((b) => {
      b.onclick = async () => { await postJSON('/api/cartcheck/items/remove', { key: b.dataset.del }); loadCartCheck(); };
    });
    $('ccAddItem').onclick = async () => { const v = $('ccNewItem').value.trim(); if (!v) return; await postJSON('/api/cartcheck/items/add', { label: v }); loadCartCheck(); };
    $('ccNewItem').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('ccAddItem').click(); } };
    $('ccResetItems').onclick = async () => { await postJSON('/api/cartcheck/items/recommend', {}); loadCartCheck(); };
  } else {
    editBtn.textContent = '✎ 항목 편집';
    list.innerHTML = items.length
      ? items.map((it) => { const on = !!checklist[it.key]; return `<div class="cc-item ${on ? 'on' : ''}" data-key="${it.key}"><span class="box">${on ? '✓' : ''}</span><span>${esc(it.label)}</span></div>`; }).join('')
      : `<div class="wl-sub">항목이 없어요. ‘✎ 항목 편집’에서 추가하세요.</div>`;
    list.querySelectorAll('.cc-item').forEach((el) => {
      el.onclick = async () => { const on = el.classList.contains('on'); await postJSON('/api/cartcheck/check', { date: ccDate, key: el.dataset.key, done: !on }); loadCartCheck(); };
    });
    prog.textContent = `${progress.checked}/${progress.total}${progress.done ? ' ✓ 완료' : ''}`;
    prog.classList.toggle('done', !!progress.done);
  }
}
async function loadCartCheck() {
  try {
    const r = await (await fetch('/api/cartcheck')).json();
    ccDate = r.date;
    const day = r.day || {}, work = r.work || {}, items = r.items || [];
    const md = `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`;
    if (work.isWorkToday) {
      $('ccHead').textContent = `오늘(${md}) 근무 · 카트 정리 점검`;
      $('ccSub').textContent = work.teeTime ? `티오프 ${work.teeTime}${work.course ? `(${work.course})` : ''} · 반납 전 아래를 하나씩 훑으세요.` : '반납 전 아래를 하나씩 훑으세요.';
    } else {
      $('ccHead').textContent = `${md} 카트 점검`;
      $('ccSub').textContent = '오늘 근무일이 아니어도 기록할 수 있어요.';
    }
    $('ccCart').value = day.cartNo || work.cartNo || '';
    ccRenderIntakeThumbs(day.photos && day.photos.intake);
    ccSetPhoto('exit', day.photos && day.photos.exit);
    ccRenderList(items, day.checklist || {}, day.progress || { checked: 0, total: items.length, done: false });
  } catch { $('ccHead').textContent = '불러오기 실패'; $('ccSub').textContent = '잠시 후 다시 시도해주세요.'; }
}
async function ccUpload(leg, inp) {
  if (!inp.files || !inp.files[0]) return;
  const files = Array.from(inp.files);
  try {
    if (leg === 'intake') {
      const CAP = 10;
      const room = Math.max(0, CAP - ccIntakeCount);
      let pick = files.filter((f) => /^image\//.test(f.type));
      if (pick.length > room) { alert(`카트 상태 사진은 최대 ${CAP}장까지예요. 앞에서 ${room}장만 올릴게요.`); pick = pick.slice(0, room); }
      const lbl = $('ccIntakeLbl'); const orig = lbl.textContent;
      for (let i = 0; i < pick.length; i++) {
        lbl.textContent = `⏳ 올리는 중 ${i + 1}/${pick.length}`;
        const image = await compressImage(pick[i]);
        await postJSON('/api/cartcheck/photo', { date: ccDate, leg, image });
      }
      lbl.textContent = orig;
    } else {
      const image = await compressImage(files[0]);
      await postJSON('/api/cartcheck/photo', { date: ccDate, leg, image });
    }
  } finally { inp.value = ''; loadCartCheck(); }
}
function initCartButtons() {
  $('ccEdit').onclick = () => { ccEditMode = !ccEditMode; loadCartCheck(); };
  $('ccCartSave').onclick = async () => { await postJSON('/api/cartcheck/cart', { date: ccDate, cartNo: $('ccCart').value.trim() }); };
  $('ccIntake').onchange = (e) => ccUpload('intake', e.target);
  $('ccExit').onchange = (e) => ccUpload('exit', e.target);
}

/* ── 계정 · 가입(온보딩) ── */
let meState = null;
async function loadMe() {
  try { meState = await (await fetch('/api/me')).json(); } catch { meState = null; }
  // 회원제 모드에서 비로그인이면 로그인 게이트, 로그인했으면 앱 사용.
  if (meState && !meState.authed) { showLogin(); renderAccount(); return; }
  hideLogin();
  renderAccount();
  if (meState && meState.authed && meState.needsOnboarding) openOnboarding();
}
// 계정 오버레이(#ov) 닫기 제어 — 계정 화면은 닫기 가능, 가입(온보딩) 화면은 닫기 금지.
let ovDismissable = false;
function ovIsOpen() { return !$('ov').hidden; }
// 오버레이를 열 때 히스토리에 한 칸 쌓아, 폰 뒤로가기가 '앱 종료'가 아니라 '팝업 닫기'가 되게 한다.
function pushOvHistory() { if (!(history.state && history.state.ov)) history.pushState({ ov: 1 }, ''); }
function closeOv() {
  $('ov').hidden = true;
  ovDismissable = false;
  if (history.state && history.state.ov) history.back(); // 쌓아둔 히스토리 정리
}
// 폰 뒤로가기: 오버레이가 열려 있으면 앱을 나가지 않고 팝업만 닫는다.
window.addEventListener('popstate', () => {
  if (ovIsOpen() && ovDismissable) { $('ov').hidden = true; ovDismissable = false; }
});
function showLogin() {
  $('naverLoginBtn').style.display = meState.naverEnabled ? 'block' : 'none';
  $('loginErr').textContent = !meState.naverEnabled ? '로그인 수단이 아직 설정되지 않았어요.' : '';
  $('loginOv').hidden = false;
}
function hideLogin() { $('loginOv').hidden = true; }
function renderAccount() {
  const btn = $('acctBtn');
  if (!meState || !meState.authed) { btn.hidden = true; return; }
  btn.hidden = false;
  $('acctName').textContent = (meState.profile && meState.profile.boardName) || '회원';
}
function fillProfileForm() {
  const p = (meState && meState.profile) || {};
  $('obName').value = p.boardName || '';
  $('obPart').value = p.part || '3';
  $('obKm').value = p.homeKm != null && p.homeKm !== 0 ? p.homeKm : '';
  $('obCar').value = p.carNo || '';
}
function openOnboarding() {
  $('ovTitle').textContent = '가입을 완성해주세요';
  $('ovDesc').innerHTML = '근무 알림이 정확히 오려면 <b>배치표에 뜨는 이름 그대로</b> 입력해야 해요.';
  $('obSubmit').textContent = '가입 완료';
  fillProfileForm();
  $('ovActions').hidden = true;      // 신규 가입은 닫기 불가
  $('obSwitch').hidden = true;       // 가입 화면에선 계정전환 숨김
  $('ovErr').textContent = '';
  ovDismissable = false;             // 가입 화면: 배경/뒤로가기로 닫히지 않게
  $('ov').hidden = false;
}
function openAccount() {
  $('ovTitle').textContent = '내 계정 · 프로필';
  const p = (meState && meState.profile) || {};
  const who = p.boardName ? `${p.boardName} · ${p.part}부` : '회원';
  $('ovDesc').innerHTML = `현재 <b>${esc(who)}</b>로 로그인됨. 정보를 수정할 수 있어요.`;
  $('obSubmit').textContent = '저장';
  fillProfileForm();
  $('ovActions').hidden = false;
  $('obSwitch').hidden = false;      // 계정 화면에선 '다른 계정으로 로그인' 노출
  $('ovErr').textContent = '';
  ovDismissable = true;              // 계정 화면: 배경 클릭·뒤로가기로 닫힘
  $('ov').hidden = false;
  pushOvHistory();
}
async function submitProfile() {
  const boardName = $('obName').value.trim();
  if (!boardName) { $('ovErr').textContent = '배치표에 뜨는 실명을 입력해주세요.'; return; }
  const body = { boardName, part: $('obPart').value, homeKm: Number($('obKm').value) || 0, carNo: $('obCar').value.trim() };
  $('obSubmit').disabled = true;
  try {
    const r = await postJSON('/api/profile', body);
    if (!r || !r.ok) throw new Error((r && r.error) || '저장 실패');
    if (ovDismissable) closeOv(); else $('ov').hidden = true; // 가입완료 직후엔 히스토리 없음
    await loadMe();
    loadToday();
  } catch (e) { $('ovErr').textContent = e.message || '저장 실패'; }
  finally { $('obSubmit').disabled = false; }
}
function initAccount() {
  $('acctBtn').onclick = openAccount;
  $('obSubmit').onclick = submitProfile;
  $('obClose').onclick = () => closeOv();
  // 카드 바깥(어두운 배경) 클릭 시 닫기 — 계정 화면에서만(가입 화면은 무시).
  $('ov').addEventListener('click', (e) => { if (e.target === $('ov') && ovDismissable) closeOv(); });
  $('obLogout').onclick = async () => { try { await postJSON('/api/logout', {}); } catch {} location.reload(); };
}

/* ── 부팅 ── */
async function main() {
  tickDate(); initNav(); initWorklogButtons(); initCartButtons(); initAccount();
  $('enableBtn').onclick = enableNotifications;
  $('readAll').onclick = markAllRead;
  await registerSW();
  await refreshPushHealth();
  loadMe();
  loadToday(); loadWatchHealth(); loadRecent();
  setInterval(() => { loadToday(); loadWatchHealth(); loadRecent(); refreshPushHealth(); }, 30000);
  setInterval(() => { tickDate(); if (lastToday) renderBoard(lastToday); }, 20000);
}
main();
