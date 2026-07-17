// 리버힐 캐디 PWA — 행동 진행 보드 + 하단 내비 + 알림 신뢰 상태.
// 설계 기준: sandbox/implementation-handoff.md (확정 시안: 행동 진행 보드).
const $ = (id) => document.getElementById(id);
const WD = ['일', '월', '화', '수', '목', '금', '토'];

let swReg = null;        // 서비스워커 등록
let lastToday = null;    // 마지막 정상 /api/today (로딩 실패 시 유지)
let todayOk = false;     // today 데이터를 한 번이라도 받았는가

/* ───────── 시간 유틸 (전부 폰 로컬시각 = KST 기준) ───────── */
const toMin = (hhmm) => { const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const fmtGap = (min) => {
  if (min <= 0) return '지금';
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
};
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ───────── 헤더 시계 ───────── */
function tickClock() {
  const d = new Date();
  $('clockT').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('clockD').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`;
}

/* ───────── 하단 내비 / 뷰 전환 ───────── */
const VIEWS = ['today', 'news', 'worklog'];
function showView(name) {
  if (!VIEWS.includes(name)) name = 'today';
  VIEWS.forEach((v) => {
    $('view-' + v).hidden = v !== name;
    $('tab-' + v).setAttribute('aria-selected', String(v === name));
  });
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  if (name === 'worklog') loadWorklog();
  if (name === 'news') { loadRecent(); markAllRead(); }
  window.scrollTo(0, 0);
}
function initNav() {
  document.querySelectorAll('nav.tabbar button').forEach((b) => {
    b.onclick = () => showView(b.dataset.view);
  });
  $('toNews').onclick = () => showView('news');
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
  showView(location.hash.slice(1) || 'today');
}

/* ───────── 서비스워커 + 알림 구독 ───────── */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function registerSW() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try { swReg = await navigator.serviceWorker.register('/sw.js'); } catch { swReg = null; }
  return swReg;
}
// 앱 열 때마다 현재 구독을 서버에 재등록(멱등) → '죽은 구독' 사고 예방(자가복구).
async function healSubscription() {
  try {
    if (!swReg) return;
    const sub = await swReg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    }
  } catch {}
}
async function enableNotifications() {
  const btn = $('enableBtn'), msg = $('enableMsg');
  try {
    btn.disabled = true; msg.textContent = '';
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      msg.textContent = '이 브라우저는 웹푸시를 지원하지 않아요. (안드로이드 크롬 권장)'; return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      msg.textContent = '알림 권한이 거부됐어요. 브라우저 설정에서 허용해주세요.'; btn.disabled = false; return;
    }
    if (!swReg) await registerSW();
    const { vapidPublicKey } = await (await fetch('/api/config')).json();
    const sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
    await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    await refreshPushHealth();
  } catch (e) {
    msg.textContent = '알림 켜기 실패: ' + e.message; btn.disabled = false;
  }
}
// 이 폰의 알림 '전달' 상태(로컬 판정) + 온보딩 카드 노출 제어.
async function refreshPushHealth() {
  const cell = $('tPush'), txt = $('tPushTxt'), card = $('enableCard');
  const set = (cls, label) => { cell.className = 'tcell ' + cls; txt.textContent = label; };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    set('bad', '이 브라우저는 알림 미지원'); card.hidden = true; return;
  }
  const perm = Notification.permission;
  if (perm === 'denied') { set('bad', '알림 권한이 꺼져 있어요'); card.hidden = true; return; }
  let sub = null;
  try { sub = swReg && await swReg.pushManager.getSubscription(); } catch {}
  if (perm === 'granted' && sub) {
    set('ok', '이 폰 알림 정상'); card.hidden = true;
    healSubscription();
  } else {
    set('warn', '이 폰이 알림에 연결 안 됨'); card.hidden = false;
    $('enableBtn').disabled = false;
  }
}

/* ───────── 오늘: 감시 상태 ───────── */
async function loadWatchHealth() {
  const cell = $('tWatch'), txt = $('tWatchTxt');
  try {
    const h = await (await fetch('/api/health')).json();
    if (h.alive) {
      cell.className = 'tcell ok';
      txt.textContent = `정상 · ${h.ageSec == null ? '' : h.ageSec < 60 ? '방금' : Math.floor(h.ageSec / 60) + '분 전'} 확인`;
    } else {
      cell.className = 'tcell bad';
      txt.textContent = (h.failStreak >= 2) ? '카페 접속 오류(쿠키 확인)'
        : (h.ageSec != null ? `${Math.floor(h.ageSec / 60)}분째 응답 없음` : '감시 멈춤');
    }
  } catch { cell.className = 'tcell warn'; txt.textContent = '상태 확인 실패'; }
}

/* ───────── 오늘: 상황판 히어로 + 행동 보드 ───────── */
async function loadToday() {
  try {
    const t = await (await fetch('/api/today')).json();
    lastToday = t; todayOk = true;
    renderToday(t);
  } catch {
    if (!todayOk) renderTodayError();
    // 이전 정상 데이터가 있으면 그대로 유지(오류를 휴무로 표현하지 않음).
  }
}
function renderTodayError() {
  $('heroWrap').innerHTML = `<div class="hero"><div class="hero-top" style="border-left-color:var(--ink-faint)">
    <div class="eyebrow">오늘 내 상황</div>
    <h2 style="font-size:19px;">일정을 확인하지 못했어요</h2>
    <p class="sub">잠시 후 자동으로 다시 시도합니다.</p>
    <div class="chips"><button class="chip" id="retryToday" style="cursor:pointer;">다시 시도</button></div>
  </div></div>`;
  const r = $('retryToday'); if (r) r.onclick = loadToday;
}
function renderToday(t) {
  const wrap = $('heroWrap');
  if (!t || t.empty || !t.state) {
    wrap.innerHTML = `<div class="hero s-off"><div class="hero-top">
      <div class="eyebrow">오늘 내 상황</div>
      <h2 style="font-size:20px;">아직 오늘 정보가 없어요</h2>
      <p class="sub">배치표나 3부 소식이 올라오면 여기에 바로 표시됩니다.</p>
    </div></div>`;
    return;
  }
  const s = t.state, st = s.status;
  const isWork = st === 'assigned' || st === 'work' || st === 'your_turn';
  const isSpare = st === 'spare' || st === 'waiting' || st === 'near';
  const cls = st === 'your_turn' ? 's-turn' : isWork ? 's-work' : st === 'off' ? 's-off' : isSpare ? 's-spare' : 's-off';
  const label = st === 'your_turn' ? '지금 출근 차례!' : isWork ? '오늘 근무 확정'
    : st === 'off' ? '오늘 휴무' : isSpare ? `${s.part || '3부'} 스페어` : '대기 중';
  const sub = st === 'your_turn' ? '앞 순번이 모두 찼어요. 지금 바로 출근 준비하세요.'
    : isWork ? '아래 시간에 맞춰 움직이면 됩니다.'
    : st === 'off' ? '오늘은 예정된 근무가 없어요.'
    : isSpare ? '배정 가능성이 있어 대기 중이에요. 확정되면 바로 알려드립니다.'
    : '아직 오늘 상황이 확정되지 않았어요.';

  const chips = [];
  if (s.myPosition) chips.push(`<span class="chip num">순번 ${s.myPosition}번</span>`);
  if (isWork && s.teeTime) chips.push(`<span class="chip num">티오프 ${escapeHtml(s.teeTime)}${s.course ? ` (${escapeHtml(s.course)})` : ''}</span>`);

  wrap.innerHTML = `<div class="hero ${cls}">
    <div class="hero-top">
      <div class="eyebrow">오늘 내 상황</div>
      <h2>${escapeHtml(label)}</h2>
      <p class="sub">${escapeHtml(sub)}</p>
      ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
    </div>
    <div id="boardSlot"></div>
  </div>`;
  renderBoard(t);
}
// 행동 진행 보드 — 근무(시간 있음)면 카운트다운 보드, 아니면 정직한 안내.
function renderBoard(t) {
  const slot = $('boardSlot'); if (!slot) return;
  const s = t.state, st = s.status;
  const isWork = st === 'assigned' || st === 'work' || st === 'your_turn';
  const c = t.commute; // {tee, arrive, leave}

  if (isWork && c && toMin(c.leave) != null) {
    const now = nowMin();
    const leave = toMin(c.leave), arrive = toMin(c.arrive), tee = toMin(c.tee);
    const commuteMin = (arrive != null && leave != null) ? arrive - leave : null;

    // 단계 판정
    let act, big, cap, remMin, stepIdx; // stepIdx: 0 확인 /1 출발 /2 도착 /3 티오프
    if (now < leave) { act = '집에서 출발'; big = c.leave; cap = '까지 출발'; remMin = leave - now; stepIdx = 1; }
    else if (now < arrive) { act = '골프장 도착'; big = c.arrive; cap = '까지 도착'; remMin = arrive - now; stepIdx = 2; }
    else if (now < tee) { act = '티오프'; big = c.tee; cap = '티오프'; remMin = tee - now; stepIdx = 3; }
    else { act = '근무 중'; big = c.tee; cap = '티오프 지남'; remMin = -1; stepIdx = 3; }

    const overdue = (stepIdx === 1 && now >= leave);
    const remTxt = remMin < 0 ? '' : `${fmtGap(remMin)} 남음`;
    const steps = ['일정 확인', '출발', '도착', '티오프'];
    const railPts = steps.map((_, i) => {
      const cls = i < stepIdx ? 'done' : i === stepIdx ? 'now' : '';
      const left = (i / (steps.length - 1)) * 100;
      return `<i class="pt ${cls}" style="left:${left}%"></i>`;
    }).join('');
    const fillPct = (stepIdx / (steps.length - 1)) * 100;
    const railLab = steps.map((lab, i) => `<span class="${i === stepIdx ? 'on' : ''}">${lab}</span>`).join('');

    slot.innerHTML = `<div class="board">
      <div class="board-top"><span class="act">다음 행동 · ${act}</span><span class="clk num">현재 ${String(Math.floor(now/60)).padStart(2,'0')}:${String(now%60).padStart(2,'0')}</span></div>
      <div class="bigline"><span class="big num">${escapeHtml(big)}</span><span class="cap">${cap}</span>${remTxt ? `<span class="rem num">${remTxt}</span>` : ''}</div>
      <div class="rail"><i class="track"></i><i class="fill" style="width:${fillPct}%"></i>${railPts}</div>
      <div class="rail-lab">${railLab}</div>
      ${overdue ? `<div class="board-note" style="color:var(--warn);font-weight:700;">⚠️ 출발 예정 시각이 지났어요 — 서두르세요.</div>`
        : `<div class="board-note">🕐 설정한 이동시간${commuteMin ? ` ${commuteMin}분` : ''} 기준 · 실제 교통상황과 다를 수 있어요</div>`}
      <div class="minirow">
        <div class="mini"><div class="k">예상 이동</div><div class="v num">${commuteMin != null ? commuteMin + '분' : '—'}</div></div>
        <div class="mini"><div class="k">티오프</div><div class="v num">${escapeHtml(c.tee)}${s.course ? ` ${escapeHtml(s.course)}` : ''}</div></div>
      </div>
    </div>`;
    return;
  }

  // 근무 시간 정보가 없는 상태 → 정직한 안내(시간 지어내지 않음).
  if (st === 'off') {
    slot.innerHTML = `<div class="board calm"><div class="msg">오늘은 <b>예정된 근무가 없어요.</b> 편히 쉬세요. 새 소식이 오면 알려드릴게요.</div></div>`;
  } else if (st === 'spare' || st === 'waiting' || st === 'near') {
    slot.innerHTML = `<div class="board calm"><div class="msg">아직 <b>근무 확정 전</b>이에요. 확정되면 <b>집에서 나갈 시각</b>을 바로 계산해 알려드릴게요.${s.cutoffName ? `<br><span style="color:var(--ink-faint);font-size:12px;">최근 확정: ${escapeHtml(s.cutoffName)}님까지</span>` : ''}</div></div>`;
  } else if (st === 'your_turn') {
    slot.innerHTML = `<div class="board calm"><div class="msg" style="color:var(--danger);font-weight:700;">지금 바로 출근 준비하세요. 자세한 티오프가 올라오면 시간 안내로 바뀝니다.</div></div>`;
  } else {
    slot.innerHTML = '';
  }
}

/* ───────── 소식 피드 (오늘 미리보기 + 소식 탭 전체) ───────── */
const LAST_READ_KEY = 'riverhill_lastReadTs';
const getLastRead = () => Number(localStorage.getItem(LAST_READ_KEY) || 0);
const setLastRead = (ts) => localStorage.setItem(LAST_READ_KEY, String(ts || 0));

function newsItemHTML(a, opts = {}) {
  const ts = a.detectedAt || 0;
  const isNew = ts > getLastRead();
  const badge = a.status === 'your_turn' ? '<span class="badge red">지금 차례</span>'
    : a.status === 'near' ? '<span class="badge red">곧 차례</span>'
    : (a.status === 'assigned' || a.status === 'work') ? '<span class="badge amb">근무</span>'
    : a.status === 'spare' ? '<span class="badge amb">스페어</span>'
    : a.status === 'off' ? '<span class="badge amb">근무없음</span>'
    : (a.relevant && a.priority === 'high') ? '<span class="badge amb">일정</span>' : '';
  const dim = a.relevant === false ? ' dim' : '';
  const cat = a.category ? `<span class="cat">${escapeHtml(a.category)}</span>` : '';
  const headline = a.aiMessage || a.subject;
  const when = timeAgo(ts) || a.writeDate || '';
  const rest = [a.aiMessage ? a.subject : '', a.writer, a.menuName].filter(Boolean).join(' · ');
  const meta = [when ? `<span class="time">${escapeHtml(when)}</span>` : '', rest ? escapeHtml(rest) : ''].filter(Boolean).join(' · ');
  const subjCls = (isNew && !opts.noNewDot) ? 'subj new-dot' : 'subj';
  return `<a class="news${isNew ? ' new' : ''}${dim}" href="${a.url}" target="_blank" rel="noopener">
    <div class="${subjCls}">${cat}${badge}${escapeHtml(headline)}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}</a>`;
}

async function loadRecent() {
  let all;
  try { all = await (await fetch('/api/recent')).json(); } catch { return; }

  // 안읽음 카운트(관련 소식만)
  const lastRead = getLastRead();
  let unread = 0, newest = 0;
  all.forEach((a) => { const ts = a.detectedAt || 0; if (ts > newest) newest = ts; if (ts > lastRead && a.relevant !== false) unread++; });
  const uEl = $('unread'), rEl = $('readAll');
  if (unread > 0) { uEl.textContent = unread; uEl.hidden = false; rEl.hidden = false; } else { uEl.hidden = true; rEl.hidden = true; }
  rEl.dataset.newest = String(newest);

  // 오늘 탭 미리보기: 관련 소식 상위 3개
  const relevant = all.filter((a) => a.relevant !== false);
  const preview = $('todayNews');
  preview.innerHTML = relevant.length ? relevant.slice(0, 3).map((a) => newsItemHTML(a)).join('')
    : '<div class="empty">관련 소식이 아직 없어요.</div>';

  // 소식 탭 전체
  const box = $('recent');
  if (!all.length) { box.innerHTML = '<div class="empty">아직 감지된 소식이 없어요.</div>'; return; }
  const hidden = all.filter((a) => a.relevant === false);
  let html = relevant.length ? relevant.map((a) => newsItemHTML(a)).join('') : '<div class="empty">관련 소식이 아직 없어요.</div>';
  if (hidden.length) {
    html += `<button id="hiddenToggle" class="link-btn" style="margin:12px auto 0;display:block;">무관한 소식 ${hidden.length}개 보기 ▾</button>
      <div id="hiddenList" hidden style="margin-top:8px;">${hidden.map((a) => newsItemHTML(a)).join('')}</div>`;
  }
  box.innerHTML = html;
  const tg = $('hiddenToggle');
  if (tg) tg.onclick = () => {
    const hl = $('hiddenList'); const open = hl.hidden;
    hl.hidden = !open; tg.textContent = open ? `무관한 소식 ${hidden.length}개 숨기기 ▴` : `무관한 소식 ${hidden.length}개 보기 ▾`;
  };
}
function markAllRead() {
  const rEl = $('readAll');
  setLastRead(Number(rEl.dataset.newest) || Date.now());
  loadRecent();
}
function initReadAll() { $('readAll').onclick = markAllRead; }

/* ───────── 근무·세무 기록 (기존 기능 보존) ───────── */
async function loadWorklog() {
  try {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth() + 1;
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
        </div>
        <div class="wl-up" id="up-${d.date}"></div></div>`;
      return `<div class="wl-day"><div><span class="d">${md}</span> <span class="t">${escapeHtml(tee)}</span></div>
        <div style="display:flex;gap:6px;align-items:center;">${right}${photoBtn}</div></div>${panel}`;
    }).join('') : '<div class="empty">이번 달 기록이 아직 없어요.</div>';

    $('wlDays').querySelectorAll('button[data-w]').forEach((b) => {
      b.onclick = async () => {
        await fetch('/api/worklog/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: b.dataset.d, worked: b.dataset.w === '1' }) });
        loadWorklog();
      };
    });
    $('wlDays').querySelectorAll('button[data-toggle]').forEach((b) => {
      b.onclick = () => { const p = $('wp-' + b.dataset.toggle); p.hidden = !p.hidden; };
    });
    $('wlDays').querySelectorAll('input[type=file][data-leg]').forEach((inp) => {
      inp.onchange = async () => {
        if (!inp.files || !inp.files[0]) return;
        const dt = inp.dataset.d, up = $('up-' + dt); up.textContent = '업로드 중…';
        try {
          const dataUrl = await compressImage(inp.files[0]);
          await fetch('/api/worklog/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: dt, leg: inp.dataset.leg, image: dataUrl }) });
          await loadWorklog(); const p = $('wp-' + dt); if (p) p.hidden = false;
        } catch (e) { up.textContent = '업로드 실패: ' + e.message; }
      };
    });
    $('wlDays').querySelectorAll('button[data-odosave]').forEach((b) => {
      b.onclick = async () => {
        const dt = b.dataset.odosave, odo = {};
        $('wlDays').querySelectorAll(`input[data-odo="${dt}"]`).forEach((i) => { if (i.value !== '') odo[i.dataset.leg] = Number(i.value); });
        await fetch('/api/worklog/odo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: dt, odo }) });
        await loadWorklog(); const p = $('wp-' + dt); if (p) p.hidden = false;
      };
    });
  } catch { $('wlSummary').textContent = '불러오기 실패'; }
}
function compressImage(file, maxSide = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (Math.max(w, h) > maxSide) { const r = maxSide / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    const fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
function initWorklogButtons() {
  $('wlSave').onclick = async () => {
    await fetch('/api/worklog/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeGolfKmOneway: Number($('wlKm').value) || 0, driverName: $('wlName').value.trim(), carNo: $('wlCar').value.trim() }) });
    loadWorklog();
  };
  $('wlExport').onclick = () => window.open(`/api/worklog/export.csv?year=${new Date().getFullYear()}`, '_blank');
  $('wlReport').onclick = () => window.open(`/api/worklog/report.html?year=${new Date().getFullYear()}`, '_blank');
}

/* ───────── 부팅 ───────── */
async function main() {
  tickClock();
  initNav();
  initReadAll();
  initWorklogButtons();
  $('enableBtn').onclick = enableNotifications;

  await registerSW();
  await refreshPushHealth();

  loadToday();
  loadWatchHealth();
  loadRecent();

  // 30초 폴링: 오늘/감시/피드 갱신 + 행동 보드 카운트다운 재계산.
  setInterval(() => { loadToday(); loadWatchHealth(); loadRecent(); refreshPushHealth(); }, 30000);
  // 20초 시계 + 보드 카운트다운(초 단위 체감).
  setInterval(() => { tickClock(); if (lastToday) renderBoard(lastToday); }, 20000);
}
main();
