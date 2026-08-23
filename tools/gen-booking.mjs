// 예약 구성판 — 예약팀장 전용 화면을 그린다.
//
//  대조판과 같은 골격(고정 티오프 격자 · 부별 세 표)을 쓰되, 보는 화면이 아니라 '짜는 화면'이다.
//  예약팀장은 여기서 팀을 받고 빼고, 격자 사이에 칸을 끼우고, 캐디 순번을 옮긴다.
//  그리고 오른쪽 폰에서 그 결정이 캐디 한 사람의 하루를 어떻게 바꾸는지 그 자리에서 본다.
//
//  ★회원 앱은 여기서 저절로 바뀌지 않는다. 저장은 테스트판으로 가고,
//   실제 반영은 관리자 링크(?admin=1)로 들어온 사람만, 확인을 한 번 더 받고 한다.
import fs from 'node:fs';

const CLIENT_JS = fs.readFileSync(new URL('./booking-client.js', import.meta.url), 'utf8');

const toMin = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const toHM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const K = (t, c) => `${toHM(toMin(t))}|${/IN/i.test(c) ? 'IN' : 'OUT'}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 그 부의 고정 격자 — 첫 티오프부터 끝까지 간격마다 OUT·IN 두 칸.
function slotsOf(sched, part) {
  const p = sched?.parts?.[part]; if (!p) return [];
  const cad = Number(sched.cadence) || 7;
  const a = toMin(p.first), b = toMin(p.last);
  if (a == null || b == null) return [];
  const out = [];
  for (let m = a; m <= b; m += cad) { out.push({ time: toHM(m), course: 'OUT' }); out.push({ time: toHM(m), course: 'IN' }); }
  return out;
}

export function renderBooking(J, opts = {}) {
  const admin = !!opts.admin;
  const sample = !!opts.sample;   // 파일로 뽑아 보여주는 견본 — 라이브와 헷갈리면 안 된다
  const sched = J.sched || {};
  const parts = {};
  for (const p of ['1', '2', '3']) {
    const src = J.parts?.[p];
    const slots = slotsOf(sched, p);
    const booked = [];
    const intern = [];
    for (const g of (src?.teeGrid || [])) { const k = K(g.time, g.course); if (k && !booked.includes(k)) booked.push(k); }
    for (const t of (src?.internTees || [])) { const k = K(t.time, t.course); if (!k) continue; if (!booked.includes(k)) booked.push(k); if (!intern.includes(k)) intern.push(k); }
    parts[p] = { slots, booked, intern, roster: (src?.roster || []).map((x) => String(x || '')) };
  }
  const D = { dateKey: J.dateKey || '', dateLabel: J.dateLabel || '', parts, admin };

  const partBlock = (p) => `
  <section class="part">
    <div class="ph">
      <h2>${p}부</h2>
      <span class="pn" id="sum${p}"></span>
    </div>
    <table class="grid">
      <thead><tr><th>아웃</th><th class="t">시각</th><th>인</th></tr></thead>
      <tbody id="g${p}"></tbody>
    </table>
    <div class="pf">
      <button type="button" id="extra${p}" class="mini">칸 끼워넣기</button>
      <div class="spares" id="sp${p}"></div>
    </div>
  </section>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sample ? '[샘플] ' : ''}예약 구성판 — ${esc(J.dateLabel || '')}</title>
<style>
:root{
  --bg:#f6f7f5; --panel:#fff; --ink:#16191c; --dim:#61696b; --line:#dde2dd;
  --ok:#1f6b45; --ok-bg:#e8f3ec; --warn:#8a5a12; --warn-bg:#fbf1de;
  --miss:#9c2b2b; --miss-bg:#fbeaea; --open:#f2f4f1; --accent:#1f5b6b; --accent-bg:#e6f0f2;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#14171a; --panel:#1b1f22; --ink:#e8ecea; --dim:#98a3a1; --line:#2c3336;
  --ok:#6cc38f; --ok-bg:#16301f; --warn:#e0b464; --warn-bg:#33280f;
  --miss:#e88b8b; --miss-bg:#341a1a; --open:#1f2427; --accent:#7fc4d4; --accent-bg:#152a30;
}}
:root[data-theme="dark"]{
  --bg:#14171a; --panel:#1b1f22; --ink:#e8ecea; --dim:#98a3a1; --line:#2c3336;
  --ok:#6cc38f; --ok-bg:#16301f; --warn:#e0b464; --warn-bg:#33280f;
  --miss:#e88b8b; --miss-bg:#341a1a; --open:#1f2427; --accent:#7fc4d4; --accent-bg:#152a30;
}
*{box-sizing:border-box}
[hidden]{display:none !important}
body{margin:0;background:var(--bg);color:var(--ink);padding:22px;line-height:1.45;
  font-family:system-ui,-apple-system,'Malgun Gothic','Apple SD Gothic Neo',sans-serif;
  font-variant-numeric:tabular-nums}
.wrap{max-width:1320px;margin:0 auto}
h1{font-size:21px;margin:0 0 3px;letter-spacing:-.01em}
.sub{color:var(--dim);font-size:13px;margin:0 0 16px;max-width:70ch}
.lay{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:18px;align-items:start}
@media (max-width:1080px){.lay{grid-template-columns:1fr}}
.parts{display:grid;grid-template-columns:repeat(auto-fit,minmax(238px,1fr));gap:12px;align-items:start}
.part{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.ph{display:flex;justify-content:space-between;align-items:baseline;padding:10px 13px;border-bottom:1px solid var(--line)}
.ph h2{font-size:14px;margin:0;letter-spacing:.02em}
.pn{font-size:12px;color:var(--dim)}
table.grid{width:100%;border-collapse:collapse;font-size:12.5px}
table.grid thead th{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.07em;
  padding:6px 4px;font-weight:600;border-bottom:1px solid var(--line)}
th.t{width:52px;font-weight:500;color:var(--dim);font-size:11.5px;background:var(--open);
  border-block:1px solid var(--line)}
td.c{width:calc(50% - 26px);height:29px;text-align:center;border:1px solid var(--line);padding:0 3px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;user-select:none}
td.c.off{background:repeating-linear-gradient(135deg,transparent,transparent 5px,var(--open) 5px,var(--open) 10px);cursor:default}
td.c.open{position:relative;color:var(--dim)}
/* 빈 칸에도 누를 수 있다는 표시 — 없으면 예약팀장은 차 있는 칸만 있는 표로 읽는다. */
td.c.open::after{content:'＋';font-size:12px;opacity:.22}
td.c.open:hover::after{opacity:1;color:var(--accent)}
td.c.open:hover{background:var(--accent-bg);outline:1px dashed var(--accent);outline-offset:-2px}
td.c.booked{background:var(--ok-bg);color:var(--ok)}
td.c.intern{background:var(--warn-bg);color:var(--warn);font-style:italic}
td.c.picked{outline:2px solid var(--accent);outline-offset:-2px}
td.c .pos{display:inline-block;min-width:16px;font-weight:700;font-size:11px;opacity:.75;margin-right:3px}
td.c .nm{font-size:12px}
td.c .dt{display:inline-block;font-size:9px;margin-left:3px;padding:0 3px;border-radius:3px;
  background:rgba(127,127,127,.18);opacity:.85}
td.c .ilab{font-size:10.5px;font-weight:600}
.pf{padding:9px 11px;border-top:1px solid var(--line)}
.mini{font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--line);
  background:var(--panel);color:var(--ink);font-family:inherit;cursor:pointer}
.spares{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.chip{font-size:10.5px;padding:2px 6px;border-radius:4px;background:var(--open);color:var(--dim)}
.chip.none{opacity:.6}
.tools{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:7px;align-items:center;
  margin-top:14px;padding:10px;background:var(--panel);border:1px solid var(--line);border-radius:9px}
.tools button{font-size:12.5px;padding:6px 11px;border-radius:6px;border:1px solid var(--line);
  background:var(--panel);color:var(--ink);font-family:inherit;cursor:pointer}
.tools button.on{background:var(--accent);color:var(--panel);border-color:var(--accent);font-weight:600}
.tools button.save{border-color:var(--ok);color:var(--ok);font-weight:600}
.tools button.apply{background:var(--miss);border-color:var(--miss);color:#fff;font-weight:600}
#state{font-size:12px;color:var(--dim);flex:1 1 200px}
/* ── 폰 미리보기 ── 캐디가 지금 보게 될 화면 그대로. */
.side{position:sticky;top:16px;display:flex;flex-direction:column;gap:14px}
.pvhead{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--dim)}
.pvhead select{font-family:inherit;font-size:12px;padding:4px 6px;border-radius:5px;
  border:1px solid var(--line);background:var(--panel);color:var(--ink);max-width:150px}
.phone{background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:14px;
  box-shadow:0 8px 26px rgba(0,0,0,.10)}
.pv-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px}
.pv-who{font-size:12.5px;font-weight:700}
.pv-lab{font-size:10.5px;color:var(--dim)}
.pv-card{border-radius:15px;padding:14px;background:var(--open)}
.pv-title{font-size:18px;font-weight:800;letter-spacing:-.02em;margin:0 0 2px}
.pv-title.work{color:var(--ok)}
.pv-title.spare{color:var(--warn)}
.pv-sub{font-size:11.5px;color:var(--dim);margin:0 0 11px}
.pv-big{display:flex;align-items:baseline;gap:6px;margin-bottom:11px}
.pv-big b{font-size:31px;letter-spacing:-.03em;line-height:1}
.pv-big span{font-size:11.5px;color:var(--dim)}
.pv-list{background:var(--panel);border-radius:11px;overflow:hidden}
.pv-row{display:grid;grid-template-columns:26px 1fr auto;gap:7px;padding:6px 9px;font-size:12px;
  border-bottom:1px solid var(--line)}
.pv-row:last-child{border-bottom:0}
.pv-row.me{background:var(--accent-bg);font-weight:700}
.pv-row .p{color:var(--dim);text-align:right}
.pv-row .t i{font-style:normal;color:var(--dim);font-size:11px}
.pv-cut{font-size:11px;color:var(--dim);margin-top:9px;text-align:center}
/* ── 변경 로그 ── 숫자가 아니라 사람으로 말한다. */
.log{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.log h3{font-size:12px;margin:0 0 8px;letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}
.lg{font-size:12px;padding:7px 0;border-top:1px solid var(--line)}
.lg:first-child{border-top:0}
.lg b{display:block;font-size:12.5px;margin-bottom:3px}
.lg ul{margin:0;padding-left:15px}
.lg li{margin:1px 0}
.lg.hit li{color:var(--ok)}
.lg .none{margin:0;color:var(--dim);font-size:11.5px}
.lg .more{color:var(--dim)}
#logEmpty{font-size:11.5px;color:var(--dim);margin:0}
.guard{background:var(--warn-bg);border:1px solid var(--warn);color:var(--warn);
  border-radius:9px;padding:10px 13px;font-size:12.5px;margin:0 0 16px}
.guard b{display:block;margin-bottom:2px}
.smp{display:inline-block;vertical-align:2px;font-size:11px;font-weight:700;letter-spacing:.06em;
  padding:2px 7px;border-radius:5px;background:var(--miss);color:#fff}
.smpbar{background:var(--miss-bg);border:1px solid var(--miss);color:var(--miss);border-radius:9px;
  padding:9px 13px;font-size:12.5px;margin:0 0 12px}
</style></head><body>
<div class="wrap">
  <h1>${sample ? '<span class="smp">샘플</span> ' : ''}예약 구성판 — ${esc(J.dateLabel || '')}</h1>
  <p class="sub">예약을 짜는 화면입니다. 칸을 눌러 팀을 받고 빼면, 오른쪽 폰에 캐디가 보게 될 화면이 그 자리에서 바뀝니다.
  예약 칸은 시각 순서대로 캐디 순번 1번부터 짝지어집니다 — 그래서 중간에 한 팀을 끼우면 뒤 순번이 한 칸씩 당겨집니다.</p>

  ${sample ? '<p class="smpbar">이 파일은 승인용 견본입니다 — 실제 화면이 아니고, 여기 담긴 배치표는 뽑아둔 그 시점의 사본입니다.</p>' : ''}
  <p class="guard"><b>${admin ? '관리자 링크로 열었습니다' : '연습용 화면입니다'}</b>
  ${admin
    ? '‘회원 앱에 반영’을 누르면 캐디들이 실제로 보는 화면이 바뀝니다. 그 전까지는 아무 일도 일어나지 않습니다.'
    : '여기서 무엇을 하든 캐디들의 앱은 바뀌지 않습니다. 저장은 테스트판에만 남고, 실제 반영은 관리자가 따로 확인한 뒤에 합니다.'}</p>

  <div class="lay">
    <div>
      <div class="parts">
${['1', '2', '3'].map(partBlock).join('\n')}
      </div>
      <div class="tools">
        <button type="button" data-mode="book" class="on">예약 받기·빼기</button>
        <button type="button" data-mode="intern">인턴 지정</button>
        <button type="button" data-mode="swap">순번 맞바꾸기</button>
        <button type="button" data-mode="move">순번 옮기기</button>
        <button type="button" id="undoBtn" hidden>되돌리기</button>
        <button type="button" id="resetBtn" hidden>처음으로</button>
        <button type="button" id="saveBtn" class="save" hidden>테스트판에 저장</button>
        ${admin ? '<button type="button" id="applyBtn" class="apply" hidden>회원 앱에 반영</button>' : ''}
        <span id="state"></span>
      </div>
    </div>

    <aside class="side">
      <div class="pvhead">
        <span>캐디 앱 미리보기</span>
        <select id="pvPart"><option value="1">1부</option><option value="2">2부</option><option value="3" selected>3부</option></select>
        <select id="pvWho"></select>
      </div>
      <div class="phone">
        <div class="pv-top"><span class="pv-who" id="pvName"></span><span class="pv-lab" id="pvLabel"></span></div>
        <div class="pv-card">
          <p class="pv-title" id="pvTitle"></p>
          <p class="pv-sub" id="pvSub"></p>
          <div class="pv-big"><b id="pvBig"></b><span id="pvBigU"></span></div>
          <div class="pv-list" id="pvList"></div>
          <p class="pv-cut" id="pvCut"></p>
        </div>
      </div>
      <div class="log">
        <h3>내가 바꾼 것</h3>
        <p id="logEmpty">아직 아무것도 바꾸지 않았습니다.</p>
        <div id="logList"></div>
      </div>
    </aside>
  </div>
</div>
<script>window.__BOOK = ${JSON.stringify(D)};</script>
<script>${CLIENT_JS}</script>
</body></html>`;
}
