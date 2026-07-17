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

/* ── 헤더 날짜·시각 ── */
function tickDate() {
  const d = new Date();
  $('date').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일 · ${hhmm(d.getHours() * 60 + d.getMinutes())}`;
}

/* ── 하단 내비 / 뷰 전환 ── */
const VIEWS = ['today', 'news', 'worklog'];
function showView(name) {
  if (!VIEWS.includes(name)) name = 'today';
  VIEWS.forEach((v) => { $('view-' + v).hidden = v !== name; $('tab-' + v).setAttribute('aria-selected', String(v === name)); });
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  if (name === 'worklog') loadWorklog();
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
  if (Notification.permission === 'granted' && sub) { set('', '● 이 폰 알림 정상'); btn.hidden = true; healSubscription(); }
  else { set('warn', '● 이 폰 알림 꺼짐'); btn.hidden = false; btn.disabled = false; }
}

/* ── 감시 상태 ── */
async function loadWatchHealth() {
  const el = $('hWatch');
  try {
    const h = await (await fetch('/api/health')).json();
    if (h.alive) { el.className = ''; el.textContent = `● 일정 감시 정상${h.ageSec != null ? ` · ${h.ageSec < 60 ? '방금' : Math.floor(h.ageSec / 60) + '분 전'}` : ''}`; }
    else { el.className = 'bad'; el.textContent = h.failStreak >= 2 ? '● 감시 오류(쿠키 확인)' : '● 감시 지연'; }
  } catch { el.className = 'warn'; el.textContent = '● 상태 확인 실패'; }
}

/* ── 오늘: 상황판 히어로 + 행동 보드 ── */
async function loadToday() {
  try { const t = await (await fetch('/api/today')).json(); lastToday = t; todayOk = true; renderToday(t); }
  catch { if (!todayOk) { $('heroTitle').textContent = '일정을 확인하지 못했어요'; $('heroSub').textContent = '잠시 후 다시 시도합니다.'; } }
}
function renderToday(t) {
  if (!t || t.empty || !t.state) {
    $('heroTitle').textContent = '아직 오늘 정보가 없어요';
    $('heroSub').textContent = '배치표나 3부 소식이 올라오면 여기에 표시됩니다.';
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
    : isSpare ? '배정 가능성이 있어 대기 중이에요. 확정되면 바로 알려드립니다.'
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
    const fill = ci === 1 ? 34 : 100;
    const preAlarm = hhmm(leave - 10);
    // 레일 3정거장(확정 시안 그대로): 일정확인 → 출발 → 도착
    const p2 = ci >= 2 ? 'style="background:#2e7149;border-color:#2e7149"' : '';
    const p3 = ci >= 2 ? 'style="border-color:#d99a31;box-shadow:0 0 0 4px rgba(217,154,49,.2)"' : '';
    const lab = ['일정 확인', '출발', '도착'];
    slot.innerHTML = `<div class="actionboard">
      <div class="actiontop"><b>다음 행동 · ${act}</b><span class="clock">현재 ${hhmm(now)}</span></div>
      <div class="nextline"><strong>${esc(big)}</strong><span>${rem}</span></div>
      <div class="rail"><i class="track"></i><i class="fill" style="width:${fill}%"></i>
        <i class="point p1"></i><i class="point p2" style="left:34%" ${p2}></i><i class="point p3" ${p3}></i></div>
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
  else if (st === 'spare' || st === 'waiting' || st === 'near') slot.innerHTML = `<div class="board-plain">아직 <b>근무 확정 전</b>이에요. 티오프가 배정되면 <b>집에서 나갈 시각</b>을 계산해 바로 알려드립니다.${s.cutoffName ? `<br>최근 확정: ${esc(s.cutoffName)}님까지` : ''}</div>`;
  else if (st === 'your_turn') slot.innerHTML = `<div class="board-plain"><b style="color:#bd312d">지금 바로 출근 준비하세요.</b> 티오프가 올라오면 시간 안내로 바뀝니다.</div>`;
  else slot.innerHTML = '';
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
  let all; try { all = await (await fetch('/api/recent')).json(); } catch { return; }
  const lastRead = getLastRead(); let unread = 0, newest = 0;
  all.forEach((a) => { const ts = a.detectedAt || 0; if (ts > newest) newest = ts; if (ts > lastRead && a.relevant !== false) unread++; });
  const u = $('unread'), r = $('readAll');
  if (unread > 0) { u.textContent = unread; u.hidden = false; r.hidden = false; } else { u.hidden = true; r.hidden = true; }
  r.dataset.newest = String(newest);

  const relevant = all.filter((a) => a.relevant !== false);
  $('todayNews').innerHTML = relevant.length ? relevant.slice(0, 3).map(newsHTML).join('') : '<div class="empty">관련 소식이 아직 없어요.</div>';

  const box = $('recent');
  if (!all.length) { box.innerHTML = '<div class="empty">아직 감지된 소식이 없어요.</div>'; return; }
  const hidden = all.filter((a) => a.relevant === false);
  let html = relevant.length ? relevant.map(newsHTML).join('') : '<div class="empty">관련 소식이 아직 없어요.</div>';
  if (hidden.length) html += `<button id="hiddenToggle" class="more" style="display:block;margin:12px auto 0;">무관한 소식 ${hidden.length}개 보기 ▾</button><div id="hiddenList" hidden style="margin-top:8px;">${hidden.map(newsHTML).join('')}</div>`;
  box.innerHTML = html;
  const tg = $('hiddenToggle');
  if (tg) tg.onclick = () => { const hl = $('hiddenList'); const open = hl.hidden; hl.hidden = !open; tg.textContent = open ? `무관한 소식 ${hidden.length}개 숨기기 ▴` : `무관한 소식 ${hidden.length}개 보기 ▾`; };
}
function markAllRead() { setLastRead(Number($('readAll').dataset.newest) || Date.now()); loadRecent(); }

/* ── 근무·세무 기록(기존 기능 보존) ── */
async function loadWorklog() {
  try {
    const now = new Date(); const y = now.getFullYear(), m = now.getMonth() + 1;
    const r = await (await fetch(`/api/worklog?year=${y}&month=${m}`)).json();
    const s = r.summary || {}, set = r.settings || {};
    $('wlSummary').textContent = `${y}년 ${m}월 · 근무 ${s.workedDays || 0}일 · 주행 ${(s.totalKm || 0).toLocaleString()}km` + (s.estFuel != null ? ` · 예상 유류비 ${s.estFuel.toLocaleString()}원` : '');
    const warn = [];
    if (s.pendingDays) warn.push(`확인 대기 ${s.pendingDays}일`);
    if (s.blankDays) warn.push(`📷 기록 미입력 ${s.blankDays}일`);
    $('wlSub').textContent = (warn.length ? '⚠️ ' + warn.join(' · ') : '모두 정리됨') + ` · 왕복 ${s.roundKm || 0}km/일`;
    if ($('wlKm').value === '' || document.activeElement !== $('wlKm')) $('wlKm').value = set.homeGolfKmOneway ?? 30;
    if (document.activeElement !== $('wlName')) $('wlName').value = set.driverName || '';
    if (document.activeElement !== $('wlCar')) $('wlCar').value = set.carNo || '';
    const days = r.days || [];
    const LEG = [['start', '🏠 집출발'], ['work', '⛳ 직장도착'], ['home', '🏠 집복귀']];
    $('wlDays').innerHTML = days.length ? days.map((d) => {
      const dow = WD[new Date(d.date + 'T00:00:00').getDay()];
      const md = `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}(${dow})`;
      const tee = d.teeTime ? `티오프 ${d.teeTime}${d.course ? ' ' + d.course : ''}` : (d.source === 'manual' ? '수동입력' : '');
      const nPhoto = d.photos ? Object.keys(d.photos).length : 0;
      let right;
      if (d.worked === true) right = `<span class="wl-chip ok">✓ 근무</span>`;
      else if (d.worked === false) right = `<span class="wl-chip x">안함</span>`;
      else right = `<button class="wl-btn wl-yes" data-d="${d.date}" data-w="1">예</button><button class="wl-btn wl-no" data-d="${d.date}" data-w="0">아니오</button>`;
      const photoBtn = d.worked !== false ? `<button class="wl-btn wl-no wl-photo" data-toggle="${d.date}">📷 ${nPhoto}/3</button>` : '';
      const slots = LEG.map(([leg, lab]) => {
        const has = d.photos && d.photos[leg];
        const inner = has ? `<img src="/api/worklog/photo/${d.photos[leg]}?t=${d.confirmedAt || 0}">` : '📷';
        return `<label class="wl-slot"><span class="lab">${lab}</span><span class="box${has ? ' done' : ''}">${inner}</span>
          <input type="file" accept="image/*" capture="environment" data-d="${d.date}" data-leg="${leg}" hidden></label>`;
      }).join('');
      const odo = d.odo || {};
      const panel = `<div class="wl-photos" id="wp-${d.date}" hidden>
        <div class="wl-slots">${slots}</div>
        <div class="wl-odo">계기판 km(선택):
          <input type="number" inputmode="numeric" placeholder="출발" data-odo="${d.date}" data-leg="start" value="${odo.start ?? ''}">
          <input type="number" inputmode="numeric" placeholder="도착" data-odo="${d.date}" data-leg="work" value="${odo.work ?? ''}">
          <input type="number" inputmode="numeric" placeholder="복귀" data-odo="${d.date}" data-leg="home" value="${odo.home ?? ''}">
          <button class="wl-btn wl-no" data-odosave="${d.date}">저장</button>
        </div><div class="wl-up" id="up-${d.date}"></div></div>`;
      return `<div class="wl-day"><div><span class="d">${md}</span> <span class="t">${esc(tee)}</span></div>
        <div style="display:flex;gap:6px;align-items:center;">${right}${photoBtn}</div></div>${panel}`;
    }).join('') : '<div class="empty">이번 달 기록이 아직 없어요.</div>';

    $('wlDays').querySelectorAll('button[data-w]').forEach((b) => { b.onclick = async () => { await fetch('/api/worklog/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: b.dataset.d, worked: b.dataset.w === '1' }) }); loadWorklog(); }; });
    $('wlDays').querySelectorAll('button[data-toggle]').forEach((b) => { b.onclick = () => { const p = $('wp-' + b.dataset.toggle); p.hidden = !p.hidden; }; });
    $('wlDays').querySelectorAll('input[type=file][data-leg]').forEach((inp) => {
      inp.onchange = async () => {
        if (!inp.files || !inp.files[0]) return;
        const dt = inp.dataset.d, up = $('up-' + dt); up.textContent = '업로드 중…';
        try { const dataUrl = await compressImage(inp.files[0]); await fetch('/api/worklog/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: dt, leg: inp.dataset.leg, image: dataUrl }) }); await loadWorklog(); const p = $('wp-' + dt); if (p) p.hidden = false; }
        catch (e) { up.textContent = '업로드 실패: ' + e.message; }
      };
    });
    $('wlDays').querySelectorAll('button[data-odosave]').forEach((b) => {
      b.onclick = async () => { const dt = b.dataset.odosave, odo = {}; $('wlDays').querySelectorAll(`input[data-odo="${dt}"]`).forEach((i) => { if (i.value !== '') odo[i.dataset.leg] = Number(i.value); }); await fetch('/api/worklog/odo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: dt, odo }) }); await loadWorklog(); const p = $('wp-' + dt); if (p) p.hidden = false; };
    });
  } catch { $('wlSummary').textContent = '불러오기 실패'; }
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
  $('wlSave').onclick = async () => { await fetch('/api/worklog/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ homeGolfKmOneway: Number($('wlKm').value) || 0, driverName: $('wlName').value.trim(), carNo: $('wlCar').value.trim() }) }); loadWorklog(); };
  $('wlExport').onclick = () => window.open(`/api/worklog/export.csv?year=${new Date().getFullYear()}`, '_blank');
  $('wlReport').onclick = () => window.open(`/api/worklog/report.html?year=${new Date().getFullYear()}`, '_blank');
}

/* ── 부팅 ── */
async function main() {
  tickDate(); initNav(); initWorklogButtons();
  $('enableBtn').onclick = enableNotifications;
  $('readAll').onclick = markAllRead;
  await registerSW();
  await refreshPushHealth();
  loadToday(); loadWatchHealth(); loadRecent();
  setInterval(() => { loadToday(); loadWatchHealth(); loadRecent(); refreshPushHealth(); }, 30000);
  setInterval(() => { tickDate(); if (lastToday) renderBoard(lastToday); }, 20000);
}
main();
