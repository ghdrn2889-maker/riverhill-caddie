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
  // 근무 대상일(0=오늘, 1=내일, 2=모레…). 저녁에 뜬 내일 배치표를 '오늘'로 말하지 않게.
  const off = Number(t.dayOffset) || 0;
  const dayW = off <= 0 ? '오늘' : off === 1 ? '내일' : off === 2 ? '모레' : (t.date || `${off}일 뒤`);
  $('heroLabel').textContent = `${dayW} 내 상황`;
  $('heroTitle').textContent = st === 'your_turn' ? '지금 출근 차례!'
    : isWork ? `${dayW} 근무 확정`
    : st === 'off' ? `${dayW} 휴무`
    : isSpare ? `${dayW} ${s.part || '3부'} 스페어${posTxt}` : '대기 중';
  $('heroSub').textContent = st === 'your_turn' ? '앞 순번이 모두 찼어요. 지금 바로 출근 준비하세요.'
    : (isWork && off >= 1) ? `${dayW} 근무예요. 아직 여유 있으니 출발 시각을 확인해두세요.`
    : isWork ? '아래 시간에 맞춰 움직이면 됩니다.'
    : st === 'off' ? `${dayW}은 예정된 근무가 없어요. 편히 쉬세요.`
    : isSpare ? '아래에서 대기 순번과 확정선을 확인하세요.'
    : '아직 상황이 확정되지 않았어요.';
  renderBoard(t);
}
// 오른쪽(백대기 방향)을 향한 자동차 SVG. driving=true면 바퀴 회전·배기 연기·바람 라인 모션.
function carSVG(driving) {
  const spin = driving ? '<animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 0 0" to="360 0 0" dur="0.55s" repeatCount="indefinite"/>' : '';
  const wheel = (cx) => `<g transform="translate(${cx} 17.9)"><circle r="3.3" fill="#242a26"/><circle r="1.2" fill="#93998f"/><g stroke="#c9cec7" stroke-width=".7">${spin}<line x1="-2.9" x2="2.9"/><line y1="-2.9" y2="2.9"/><line x1="-2" y1="-2" x2="2" y2="2"/><line x1="-2" y1="2" x2="2" y2="-2"/></g></g>`;
  const puff = (begin) => `<circle cx="7" cy="16.5" r="1"><animate attributeName="opacity" values="0;.6;0" dur="1.3s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="cy" values="16.5;11" dur="1.3s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="cx" values="7;2" dur="1.3s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="r" values=".7;2.3" dur="1.3s" begin="${begin}" repeatCount="indefinite"/></circle>`;
  const line = (y, begin) => `<line x1="2" y1="${y}" x2="6" y2="${y}"><animate attributeName="opacity" values=".7;0" dur="0.6s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="x1" values="6;-1" dur="0.6s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="x2" values="10;3" dur="0.6s" begin="${begin}" repeatCount="indefinite"/></line>`;
  const smoke = driving ? `<g fill="#aeb9b0">${puff('0s')}${puff('0.65s')}</g>` : '';
  const speed = driving ? `<g stroke="#c98b8b" stroke-width="1.2" stroke-linecap="round">${line(8, '0s')}${line(12, '0.3s')}</g>` : '';
  return `<svg class="carsvg${driving ? ' drv' : ''}" viewBox="0 0 44 24" width="42" height="23" aria-hidden="true">
    ${speed}${smoke}
    <path d="M6 16.4 L6 14.6 Q6 13.2 7.6 13.1 L12 12.9 Q14.6 9 19.4 8.9 L26.5 8.9 Q30.6 9.1 32.6 12.7 L36.2 13 Q38.8 13.3 38.8 15.2 L38.8 16.6 Q38.8 17.7 37.4 17.7 L7.4 17.7 Q6 17.7 6 16.4 Z" fill="#c0392b"/>
    <path d="M14 12.6 Q15.9 9.9 19.5 9.8 L22.8 9.8 L22.8 12.6 Z M24.1 9.8 L26.2 9.9 Q29.2 10.1 30.8 12.6 L24.1 12.6 Z" fill="#e8eef0"/>
    <circle cx="37.4" cy="15.5" r="1" fill="#ffe08a"/>
    ${wheel(14.5)}${wheel(31)}
  </svg>`;
}

// 골프백 SVG — 백대기(도착·준비) 단계 아이콘. 클럽이 위로 삐죽, 초록 백·황토 클럽헤드.
function golfBagSVG() {
  return `<svg class="bagsvg" viewBox="0 0 24 30" width="19" height="24" aria-hidden="true">
    <defs><linearGradient id="mtl" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eef1f3"/><stop offset=".5" stop-color="#bcc2c7"/><stop offset="1" stop-color="#8f979d"/>
    </linearGradient></defs>
    <g stroke="#8a7350" stroke-width="1.5" stroke-linecap="round">
      <line x1="9" y1="9" x2="7.4" y2="2.2"/><line x1="12" y1="8.6" x2="12" y2="1.3"/><line x1="15" y1="9" x2="16.6" y2="2.6"/>
    </g>
    <circle cx="7.2" cy="2.1" r="1.6" fill="url(#mtl)"/><circle cx="12" cy="1.3" r="1.6" fill="url(#mtl)"/><circle cx="16.8" cy="2.6" r="1.6" fill="url(#mtl)"/>
    <rect x="6.4" y="8.6" width="11.2" height="19.2" rx="5.6" fill="#26292b"/>
    <ellipse cx="12" cy="9.1" rx="5.6" ry="1.9" fill="#111315"/>
    <rect x="8.4" y="15.5" width="7.2" height="6.2" rx="2.2" fill="#3a3f42"/>
    <path d="M7 11.5 Q2.6 18 7.6 25.5" stroke="#c3c8c4" stroke-width="1.3" fill="none"/>
  </svg>`;
}

// 집 SVG — 출발 전(집에 있음) 상태 아이콘. 초록 지붕·크림 벽·문·창·굴뚝.
function homeSVG() {
  return `<svg class="homesvg" viewBox="0 0 28 26" width="22" height="20" aria-hidden="true">
    <rect x="19.4" y="5" width="2.4" height="5.6" fill="#7a4a3a"/>
    <path d="M1.6 13.4 L14 3 L26.4 13.4 Z" fill="#c0392b" stroke="#96271d" stroke-width=".6" stroke-linejoin="round"/>
    <rect x="6" y="12.6" width="16" height="11.4" rx="1.3" fill="#f4ecda" stroke="#b79b6e" stroke-width=".9"/>
    <rect x="7.8" y="15" width="3.8" height="3.8" rx=".5" fill="#bcd6e0" stroke="#9fb9c4" stroke-width=".4"/>
    <rect x="12.6" y="16.6" width="5.2" height="7.4" rx=".8" fill="#8a5a2b"/>
    <circle cx="16.6" cy="20.3" r=".65" fill="#e8c877"/>
  </svg>`;
}

function renderBoard(t) {
  const slot = $('boardSlot'); if (!slot) return;
  const s = t.state, st = s.status;
  const isWork = st === 'assigned' || st === 'work' || st === 'your_turn';
  const c = t.commute;

  if (isWork && c && toMin(c.leave) != null && toMin(c.arrive) != null && toMin(c.standby) != null && toMin(c.tee) != null) {
    // 초 단위까지 반영해 실시간으로 게이지·아이콘이 함께 채워지며 이동하도록.
    const d = new Date();
    const nowS = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    const L = toMin(c.leave) * 60;    // 출발(집)
    const A = toMin(c.arrive) * 60;   // 도착(백대기 10분 전)
    const B = toMin(c.standby) * 60;  // 백대기(티오프 50분 전)
    const T = toMin(c.tee) * 60;      // 티오프
    const nowMinNow = Math.floor(nowS / 60);
    const off = Number(t.dayOffset) || 0;
    const dayW = off <= 0 ? '오늘' : off === 1 ? '내일' : off === 2 ? '모레' : (t.date || `${off}일 뒤`);
    // 5단계: 0 출발전 / 1 이동중(집→도착) / 2 도착(백대기 대기 10분) / 3 백대기중(→티오프) / 4 근무중
    //  ★가운데 지점은 '도착'(도착 전) ↔ '백대기'(도착 이후)로 라벨·시각이 전환된다.
    //  ★미래 근무일(off>=1)은 아직 시작 전 → '출발 전' 고정(게이지 0).
    let phase;
    if (off >= 1)      phase = 0;
    else if (nowS < L) phase = 0;
    else if (nowS < A) phase = 1;
    else if (nowS < B) phase = 2;
    else if (nowS < T) phase = 3;
    else               phase = 4;
    // 가운데 지점 morph: 도착 전이면 '도착'(=출근시각), 도착 이후면 '백대기'
    const midLabel = phase <= 1 ? '도착' : '백대기';
    const midTime  = phase <= 1 ? c.arrive : c.standby;
    // 게이지·타깃(초 단위 실시간 이동). animate=true인 구간만 실시간 채움.
    let big, cap, pct, targetPct, targetS, animate;
    if (phase === 0)      { big = c.leave;   cap = off >= 1 ? `${dayW} ${c.leave} 출발` : `출발까지 ${gap(Math.round((L - nowS) / 60))}`; pct = 0;  targetPct = 0;   targetS = L; animate = false; }
    else if (phase === 1) { big = c.arrive;  cap = `도착까지 ${gap(Math.round((A - nowS) / 60))}`;   pct = 50 * (nowS - L) / Math.max(1, A - L); targetPct = 50;  targetS = A; animate = true; }
    else if (phase === 2) { big = c.standby; cap = `백대기까지 ${gap(Math.round((B - nowS) / 60))}`; pct = 50;                                   targetPct = 50;  targetS = B; animate = false; }
    else if (phase === 3) { big = c.tee;     cap = `티오프까지 ${gap(Math.round((T - nowS) / 60))}`; pct = 50 + 50 * (nowS - B) / Math.max(1, T - B); targetPct = 100; targetS = T; animate = true; }
    else                  { big = c.tee;     cap = '근무 중';                                        pct = 100; targetPct = 100; targetS = T; animate = false; }
    pct = Math.max(0, Math.min(100, pct));
    const act = off >= 1 ? `${dayW} 출발 준비`
      : ['집에서 출발 준비', '골프장으로 이동 중', '도착 · 백대기 대기', '백대기 · 티오프 준비', '근무 중'][phase];
    const crs = s.course ? ` ${esc(s.course)}` : '';
    // 지점 상태(done=지남·노랑, next=다음 목표·글로우)
    const pStart = phase === 0 ? 'next' : 'done';
    const pMid   = (phase === 1 || phase === 2) ? 'next' : (phase >= 3 ? 'done' : '');
    const pEnd   = phase === 3 ? 'next' : (phase >= 4 ? 'done' : '');
    // 🏠 출발전(0) / 🚗 이동(1) / 골프백 백대기(2·3) / 🏌️ 근무중(4)
    const homeHtml = phase === 0 ? `<span class="ricon home" style="left:0%">${homeSVG()}</span>` : '';
    const carHtml = phase === 1 ? `<span class="ricon car" style="left:${pct}%">${carSVG(true)}</span>` : '';
    const bagHtml = (phase === 2 || phase === 3) ? `<span class="ricon prep" style="left:${phase === 2 ? 50 : pct}%">${golfBagSVG()}</span>` : '';
    const golferHtml = phase === 4 ? `<span class="ricon golfer" style="left:100%">🏌️</span>` : '';
    const filling = animate ? ' filling' : '';
    const alert = phase === 0 ? [`${off >= 1 ? dayW + ' ' : ''}${hhmm(Math.round(L / 60) - 10)}에 출발 알림을 보내드릴게요`, off >= 1 ? '출발 전' : '10분 전']
      : phase === 1 ? [`곧 골프장 도착 예정(${c.arrive})`, '이동 중']
      : phase === 2 ? [`백대기 시간(${c.standby})까지 잠시 대기`, '도착']
      : phase === 3 ? [`티오프(${c.tee}) 준비 시간이에요`, '백대기 중']
      : ['좋은 라운드 되세요!', '근무 중'];
    slot.innerHTML = `<div class="actionboard">
      <div class="actiontop"><b>다음 행동 · ${act}</b><span class="clock">현재 ${hhmm(nowMinNow)}</span></div>
      <div class="nextline"><strong>${esc(big)}</strong><span>${cap}</span></div>
      <div class="rail2">
        <i class="track"></i><i class="fill${filling}" style="width:${pct}%"></i>
        ${bagHtml}${carHtml}${homeHtml}${golferHtml}
        <i class="rp ${pStart}" style="left:0"></i>
        <i class="rp ${pMid}" style="left:50%"></i>
        <i class="rp ${pEnd}" style="left:100%"></i>
      </div>
      <div class="railtext3">
        <div class="rt l ${phase >= 1 ? 'done' : (phase === 0 ? 'next' : '')}"><b>출발</b><time>${esc(c.leave)}</time></div>
        <div class="rt c ${phase >= 3 ? 'done' : ((phase === 1 || phase === 2) ? 'next' : '')}"><b>${midLabel}</b><time>${esc(midTime)}</time></div>
        <div class="rt r ${phase >= 4 ? 'done' : (phase === 3 ? 'next' : '')}"><b>티오프</b><time>${esc(c.tee)}</time></div>
      </div>
      <div class="alert"><span>${alert[0]}</span><b>${alert[1]}</b></div>
      <div class="minirow">
        <div class="mini"><span>백대기 <small>티오프 ${c.backWaitMin || 50}분 전</small></span><b>${esc(c.standby)}</b></div>
        <div class="mini"><span>티오프</span><b>${esc(c.tee)}<small>${crs}</small></b></div>
      </div>
    </div>`;
    // ★실시간 진행: 현재 위치에서 다음 지점까지 남은 시간 동안 게이지·아이콘을 선형으로 이동.
    if (animate) {
      const remMs = Math.max(0, (targetS - nowS) * 1000);
      const fillEl = slot.querySelector('.fill');
      const iconEl = slot.querySelector(phase === 1 ? '.ricon.car' : '.ricon.prep');
      if (fillEl && remMs > 0) {
        fillEl.style.transition = 'none'; fillEl.style.width = pct + '%';
        if (iconEl) { iconEl.style.transition = 'none'; iconEl.style.left = pct + '%'; }
        void fillEl.offsetWidth; // reflow — 시작점 고정 후 목표로 선형 이동
        fillEl.style.transition = `width ${remMs}ms linear`; fillEl.style.width = targetPct + '%';
        if (iconEl) { iconEl.style.transition = `left ${remMs}ms linear`; iconEl.style.left = targetPct + '%'; }
      }
    }
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
  $('obCommute').value = p.commuteMin != null && p.commuteMin !== 0 ? p.commuteMin : '';
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
  const body = { boardName, part: $('obPart').value, commuteMin: Number($('obCommute').value) || 0, homeKm: Number($('obKm').value) || 0, carNo: $('obCar').value.trim() };
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
