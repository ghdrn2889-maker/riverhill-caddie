// 대조판 생성기 — 고정 티오프 격자 위에 카카오 예약 상태와 배치표 순번을 겹쳐 그린다.
//  두 경로(사진 판독 / 예약 API)가 서로를 검증하는 유일한 화면이다.
//  입력: 서버에서 뽑은 JSON(배치표 + 카카오 스냅 + 고정 시간표 + 엔진 건강).
//  출력: 단일 HTML(외부 자원 0).
import fs from 'node:fs';
const { tagOf, assignPositions } = await import('../src/kakaobridge.mjs');

// 편집기는 별도 파일 — 템플릿 문자열 안에 JS를 겹쳐 넣으면 백틱·${}가 서로를 먹는다.
const CLIENT_JS = fs.readFileSync(new URL('./daejo-client.js', import.meta.url), 'utf8');

// ★렌더러는 함수다 — 파일로 뽑을 때(CLI)와 모니터가 띄울 때가 같은 코드를 써야 한다.
//  샘플만 예뻐지고 실제 화면은 다른 코드를 쓰는 구조라 '샘플에선 되는데 저장이 안 되는' 일이 났다.
export function renderDaejo(J) {
const snap = J.snap || {};
const sched = J.sched || {};

const toMin = (hhmm) => { const m = String(hhmm).match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 0; };
const toHM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// ★키 정규화 — 1부 판독은 "6:23"(앞자리 0 없음), 카카오는 "06:23"이다. 문자열로 맞추면 42칸이 통째로
//  '안 맞는다'고 나온다(실측). 시각 비교는 반드시 분(minute)으로 환산해서 한다.
const K = (time, course) => `${toHM(toMin(time))}|${String(course).toUpperCase()}`;

// 고정 격자 — 이 표가 대조의 바닥이다.
const cadence = Number(sched.cadence) || 7;
function slotsOf(part) {
  const p = sched.parts?.[part]; if (!p) return [];
  const a = toMin(p.first), b = toMin(p.last);
  const rows = [];
  for (let t = a; t <= b; t += cadence) rows.push(t);
  return rows;
}

// 카카오가 '찼다'고 본 칸 / '판매중'인 칸 / '보류'
const bookedSet = new Set();
for (const p of ['1', '2', '3']) for (const x of (snap.byPart?.[p] || [])) bookedSet.add(K(x.time, x.course));
const unsureSet = new Set((snap.unsure || []).map(String));   // "3|IN" 꼴 — 부·코스 단위
const idleSet = new Set((snap.idle || []).map(String));

// 배치표 격자(순번)+명단 — 세 부 모두. 3부는 lastboard, 1·2부는 board-parts-store에서 온다.
const bare = (x) => String(x).replace(/\([^)]*\)/g, '').trim();
const P = J.parts || {};
const rosterOf = (p) => (P[p]?.roster || []).map(String);
const cutOf = (p) => Number(P[p]?.cut) || 0;
const posMapOf = (p) => {
  const m = new Map();
  for (const r of (P[p]?.teeGrid || [])) m.set(K(r.time, r.course), Number(r.pos));
  return m;
};
const boardPos = { 1: posMapOf('1'), 2: posMapOf('2'), 3: posMapOf('3') };
const internOf = (p) => (P[p]?.internTees || []).map((t) => K(t.time, t.course));

// ★재매칭 — 순번은 사람에게 붙어 고정이고, 티오프는 '찬 칸을 시각 순으로 늘어놓은 순서'다.
//  중간에 예약이 하나 끼면(당추) 그 뒤 순번이 통째로 한 칸씩 밀린다.
//  우리가 따로 구현했던 '순번↔시각 재매칭'이 이 모델에선 그냥 다시 정렬한 결과다.
//  규칙: 시각 순, 같은 시각이면 OUT 먼저(실증 8/16 본배치 1번 16:25 OUT, 2번 16:25 IN, 3번 16:32 OUT).
// ★인턴 칸은 티오프를 차지하되 정규 순번을 안 먹는다 — 빼고 번호를 매긴다(judge.mjs:509 규칙).
function rematchOf(p) {
  const slots = (snap.byPart?.[p] || [])
    .map((x) => ({ k: K(x.time, x.course), time: x.time, course: x.course, t: toMin(x.time) }))
    .sort((a, b) => a.t - b.t || (a.course === 'OUT' ? -1 : 1));
  const full = assignPositions(slots, { roster: rosterOf(p), internTees: P[p]?.internTees || [] });
  const m = new Map();
  for (const s2 of full) m.set(s2.k, s2);
  return m;
}
const rematch = { 1: rematchOf('1'), 2: rematchOf('2'), 3: rematchOf('3') };
const regularCount = (p) => [...rematch[p].values()].filter((s2) => !s2.intern).length;

// 부별 대조 — 배치표가 말한 칸 vs 카카오가 본 칸
function compareOf(p) {
  const bk = [...boardPos[p].keys()];
  const kk = (snap.byPart?.[p] || []).map((x) => K(x.time, x.course));
  return {
    agree: bk.filter((k) => bookedSet.has(k)),
    boardOnly: bk.filter((k) => !bookedSet.has(k)),
    kakaoOnly: kk.filter((k) => !boardPos[p].has(k)),
    boardCount: bk.length, kakaoCount: kk.length,
    cut: cutOf(p), newCut: rematch[p].size,
  };
}
const CMP = { 1: compareOf('1'), 2: compareOf('2'), 3: compareOf('3') };

function cell(part, mins, course) {
  const key = K(toHM(mins), course);
  const bp = boardPos[part].get(key);
  const isBooked = bookedSet.has(key);
  const partUnsure = unsureSet.has(`${part}|${course}`);
  const partIdle = idleSet.has(`${part}|${course}`);
  const r = rematch[part].get(key);
  // ★인턴 지정 클릭 대상 — 라이브 모드에서 이 칸을 눌러 인턴을 켜고 끈다.
  const at = ` data-t="${toHM(mins)}" data-c="${course}" data-p="${part}"`;
  if (r?.intern) return `<td class="c intern"${at}></td>`;   // 글자는 CSS ::after가 그린다
  const pos = r?.pos || bp;
  if (pos) {
    // ★태그를 지우지 않는다 — (54)=전 부 근무, (1,3)(2,3)=두 부 중복. 리버힐 규칙상 이들은 앞 순번을
    //  차지하게 돼 있다. 이 정보를 버리면 '원래 앞에 설 사람'이 '새로 생긴 사람'처럼 보인다.
    const t = r?.name != null ? r : tagOf(rosterOf(part)[pos - 1] || '');
    const isNew = isBooked && !bp;                        // ★칸이 새로 찬 것이지 사람이 새로 온 게 아니다
    const moved = bp && bp !== pos;
    const cls = [isBooked ? 'c ok' : 'c board-only', isNew ? 'fresh' : '', t.guaranteed ? 'gtd' : (t.cross ? 'crs' : '')].filter(Boolean).join(' ');
    const mark = isNew ? '<span class="tag" title="이 칸이 새로 찼습니다(사람이 새로 온 게 아닙니다)">＋</span>'
      : moved ? `<span class="tag">${bp}&rarr;</span>` : '';
    const tg = t.tag ? `<span class="dt">${esc(t.tag)}</span>` : '';
    return `<td class="${cls}"${at}>${mark}<span class="pos">${pos}</span><span class="nm">${esc(t.name) || '&nbsp;'}</span>${tg}</td>`;
  }
  if (partIdle) return `<td class="c idle"${at}>미운영</td>`;
  if (isBooked) return `<td class="c kakao-only"${at}><span class="nm">${partUnsure ? '보류' : '예약'}</span></td>`;
  return `<td class="c open"${at}></td>`;
}

function partTable(part) {
  const rows = slotsOf(part);
  if (!rows.length) return '';
  const body = rows.map((t) => `<tr>${cell(part, t, 'OUT')}<th class="t">${toHM(t)}</th>${cell(part, t, 'IN')}</tr>`).join('\n');
  const n = (snap.byPart?.[part] || []).length;
  const c = CMP[part];
  return `<section class="part">
  <header class="ph"><h2>${part}부</h2><span class="pn">커트 <b>${c.cut || '-'}</b>${c.newCut !== c.cut ? ` &rarr; <b>${c.newCut}</b>` : ''} &middot; 찬 칸 ${n}</span></header>
  <table class="grid"><thead><tr><th>OUT</th><th class="t">시각</th><th>IN</th></tr></thead><tbody>
${body}
  </tbody></table>
  <div class="spares" data-p="${part}" hidden></div>
</section>`;
}

const h = J.health || {};
const scanAt = snap.at ? new Date(snap.at).toLocaleString('ko-KR') : '-';
const okRate = (h.ok || h.fail) ? Math.round((h.ok / (h.ok + h.fail)) * 100) : 0;
const engineOk = (h.streak || 0) === 0 && (h.ok || 0) > 0;
const TOT = ['1', '2', '3'].reduce((a, p) => ({
  board: a.board + CMP[p].boardCount, agree: a.agree + CMP[p].agree.length,
  boardOnly: a.boardOnly + CMP[p].boardOnly.length, kakaoOnly: a.kakaoOnly + CMP[p].kakaoOnly.length,
}), { board: 0, agree: 0, boardOnly: 0, kakaoOnly: 0 });

const html = `<title>${esc(J.dateLabel || '')} 대조판</title>
<style>
:root{
  --bg:#f7f8f6; --panel:#fff; --ink:#16191c; --dim:#61696b; --line:#dde2dd;
  --ok:#1f6b45; --ok-bg:#e8f3ec; --warn:#8a5a12; --warn-bg:#fbf1de;
  --miss:#9c2b2b; --miss-bg:#fbeaea; --open:#f2f4f1; --idle:#eceeeb;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#14171a; --panel:#1b1f22; --ink:#e8ecea; --dim:#98a3a1; --line:#2c3336;
  --ok:#6cc38f; --ok-bg:#16301f; --warn:#e0b464; --warn-bg:#33280f;
  --miss:#e88b8b; --miss-bg:#341a1a; --open:#1f2427; --idle:#202427;
}}
:root[data-theme="dark"]{
  --bg:#14171a; --panel:#1b1f22; --ink:#e8ecea; --dim:#98a3a1; --line:#2c3336;
  --ok:#6cc38f; --ok-bg:#16301f; --warn:#e0b464; --warn-bg:#33280f;
  --miss:#e88b8b; --miss-bg:#341a1a; --open:#1f2427; --idle:#202427;
}
*{box-sizing:border-box}
/* ★[hidden]을 display 규칙이 이기지 못하게. .tools{display:flex}가 hidden을 무력화해서
   대조 보기에서도 편집 버튼이 보였고, 거기서 인턴을 지정하면 화면이 실제 배치표로 튀었다. */
[hidden]{display:none !important}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:system-ui,-apple-system,'Malgun Gothic','Apple SD Gothic Neo',sans-serif;
  font-variant-numeric:tabular-nums;line-height:1.45;padding:22px}
.wrap{max-width:1180px;margin:0 auto}
h1{font-size:20px;margin:0 0 2px;letter-spacing:-.01em}
.sub{color:var(--dim);font-size:13px;margin:0 0 18px}
.bar{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 18px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:9px 13px;min-width:120px}
.stat b{display:block;font-size:19px;letter-spacing:-.02em}
.stat span{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
.stat.live b{color:var(--ok)}
.stat.dead b{color:var(--miss)}
.parts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;align-items:start}
.part{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.ph{display:flex;justify-content:space-between;align-items:baseline;padding:10px 13px;border-bottom:1px solid var(--line)}
.ph h2{font-size:14px;margin:0;letter-spacing:.02em}
.pn{font-size:12px;color:var(--dim)}
.pn b{color:var(--ink)}
table.grid{width:100%;border-collapse:collapse;font-size:12.5px}
table.grid thead th{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.07em;
  padding:6px 4px;font-weight:600;border-bottom:1px solid var(--line)}
th.t{width:52px;font-weight:500;color:var(--dim);font-size:11.5px;background:var(--open);
  border-block:1px solid var(--line)}
td.c{width:calc(50% - 26px);height:27px;text-align:center;border:1px solid var(--line);padding:0 3px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
td.c .pos{display:inline-block;min-width:16px;font-weight:700;font-size:11px;opacity:.75;margin-right:3px}
td.c .nm{font-size:12px}
td.c .tag{display:inline-block;font-size:9px;opacity:.6;margin-right:3px;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
td.c .dt{display:inline-block;font-size:9px;margin-left:3px;padding:0 3px;border-radius:3px;
  background:rgba(127,127,127,.16);opacity:.85;letter-spacing:-.02em}
td.c.gtd{font-weight:700}
td.c.gtd .dt{background:var(--ok);color:var(--panel);opacity:1}
td.c.crs .dt{outline:1px solid var(--ok);outline-offset:-1px}
.promo-names i{font-style:normal;font-size:10px;opacity:.7;margin-left:4px}
td.ok{background:var(--ok-bg);color:var(--ok)}
td.board-only{background:var(--miss-bg);color:var(--miss)}
td.kakao-only{background:var(--warn-bg);color:var(--warn)}
td.open{background:var(--open)}
td.idle,td.unsure{background:var(--idle);color:var(--dim);font-size:10.5px}
/* ★인턴은 어떤 상태(일치·카카오만·빈칸) 위에도 보여야 한다 — 상태 규칙보다 뒤에, 더 강한 선택자로. */
td.c.intern{background:var(--warn-bg);color:var(--warn);font-style:italic;
  box-shadow:inset 0 0 0 2px var(--warn)}
td.c.intern .pos,td.c.intern .nm,td.c.intern .dt,td.c.intern .tag{display:none}
td.c.intern::after{content:'인턴';font-size:10.5px;font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin:18px 0 8px;font-size:12px;color:var(--dim)}
.legend i{display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid var(--line);
  margin-right:5px;vertical-align:-1px}
.note{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--warn);
  border-radius:8px;padding:12px 15px;margin-top:16px;font-size:13px}
.note h3{margin:0 0 6px;font-size:13px}
.note code{font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--open);
  padding:1px 5px;border-radius:3px}
.note.promo{border-left-color:var(--ok)}
/* 테스트판 띠 — 이 화면이 무엇인지 첫 화면에서 오해할 수 없게. 색은 경고색을 쓰되 요란하지 않게. */
.sandbox{background:var(--warn-bg);border:1px solid var(--warn);border-radius:10px;
  padding:11px 14px;margin:0 0 16px;font-size:13px;line-height:1.65;color:var(--warn)}
.sandbox b{font-weight:800}
.sandbox>b:first-child{display:block;font-size:14px;margin-bottom:2px;letter-spacing:-.01em}
.sandbox .sbon{display:block;margin-top:5px;font-weight:700}
/* ★보기 전환을 눈에 보이게 — 화면 하나에 배치표가 둘이라 어느 쪽을 보고 있는지 항상 알려야 한다.
   대조(카카오 예상)와 실제 배치표는 순번도 칸 수도 다르다. 말없이 바꾸면 반드시 헷갈린다. */
.viewbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:18px 0 6px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.seg button{background:var(--panel);color:var(--dim);border:0;padding:8px 16px;font-size:13px;
  font-family:inherit;cursor:pointer;border-right:1px solid var(--line)}
.seg button:last-child{border-right:0}
.seg button.on{background:var(--ok);color:var(--panel);font-weight:600}
.vnote{font-size:12px;color:var(--dim)}
body.realview .parts{outline:2px solid var(--warn);outline-offset:6px;border-radius:12px}
.tools{display:flex;flex-wrap:wrap;align-items:center;gap:11px;margin:10px 0 4px}
.tools button{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:7px;
  padding:7px 15px;font-size:13px;font-family:inherit;cursor:pointer}
.tools button:hover{border-color:var(--warn)}
.tools button.on{background:var(--warn-bg);color:var(--warn);border-color:var(--warn);font-weight:600}
.tools button.save{background:var(--ok);color:var(--panel);border-color:var(--ok);font-weight:600}
.tools button:disabled{opacity:.5;cursor:default}
.tools .hint{font-size:12px;color:var(--dim)}
body.editing td.c{cursor:pointer}
body.editing td.c:hover{outline:2px solid var(--warn);outline-offset:-2px}
td.c.picked{outline:2px solid var(--ok);outline-offset:-2px}
td.c.edited{box-shadow:inset 3px 0 0 var(--ok)}
td.c.moved{box-shadow:inset 3px 0 0 var(--warn)}
/* ★끌어놓기 — 편집 모드일 때만 칸이 끌기를 잡는다. 평소엔 touch-action이 살아 있어야 폰에서 표를 스크롤한다. */
body.editing td.c{touch-action:none;-webkit-user-select:none;user-select:none}
body.dragging-now{cursor:grabbing}
td.c.dragging{opacity:.4}
td.c.drop-to{outline:2px dashed var(--warn);outline-offset:-2px;background:var(--warn-bg)}
td.c.empty{background:var(--open)}
/* 스페어 — 티오프가 없는 순번. 편집할 때만 보인다(대바 상대가 되려면 보여야 한다). */
.spares{display:flex;flex-wrap:wrap;gap:5px;padding:9px 11px;border-top:1px solid var(--line);
  background:var(--open)}
.spares .lb{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;
  width:100%;margin-bottom:1px}
.sp{display:inline-flex;align-items:center;gap:4px;background:var(--panel);border:1px solid var(--line);
  border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer;user-select:none}
.sp b{font-size:10px;opacity:.65;font-weight:700}
.sp .dt{font-size:9px;padding:0 3px;border-radius:3px;background:rgba(127,127,127,.16)}
.sp.picked{outline:2px solid var(--ok);outline-offset:-2px}
.sp.drop-to{outline:2px dashed var(--warn);outline-offset:-2px;background:var(--warn-bg)}
.sp.dragging{opacity:.4}
.sp.edited{box-shadow:inset 3px 0 0 var(--ok)}
body.editing .sp{touch-action:none}

.ghost{position:fixed;left:0;top:0;z-index:99;pointer-events:none;
  background:var(--ok);color:var(--panel);font-size:12px;font-weight:600;
  padding:4px 10px;border-radius:6px;box-shadow:0 3px 12px rgba(0,0,0,.28);white-space:nowrap}
table.cmp{border-collapse:collapse;margin:8px 0 12px;font-size:12.5px}
table.cmp th,table.cmp td{border:1px solid var(--line);padding:4px 11px;text-align:right}
table.cmp thead th{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;text-align:center}
table.cmp tbody th{text-align:left;font-weight:600}
table.cmp td.good{color:var(--ok);font-weight:700}
table.cmp td.bad{color:var(--miss);font-weight:700}
table.cmp td.warn{color:var(--warn);font-weight:700}
.promo-names{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 10px}
.promo-names span{background:var(--ok-bg);color:var(--ok);border:1px solid var(--line);
  border-radius:6px;padding:4px 10px;font-size:13px}
.promo-names b{font-size:11px;opacity:.75;margin-right:4px}
</style>
<div class="wrap">
<h1>대조판 &mdash; ${esc(J.dateLabel || '')}</h1>
<p class="sub">고정 티오프 격자 위에 <b>카카오골프 예약</b>과 <b>배치표 순번</b>을 겹쳐 놓은 것. 두 경로는 서로 완전히 독립이다.</p>

${(() => {
  const cur = String(J.dateKey || '');
  const wd = ['일', '월', '화', '수', '목', '금', '토'];
  // 토큰(?k=)은 클라이언트가 붙인다 — 서버가 HTML에 토큰을 박아두지 않게.
  const nav = (J.dates || []).map((d) => {
    const dt = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
    return `<a class="dnav${d === cur ? ' on' : ''}" data-d="${d}" href="?date=${d}">${+d.slice(4, 6)}/${+d.slice(6, 8)}(${wd[dt.getDay()]})</a>`;
  }).join('');
  return nav ? `<div class="dates">날짜 ${nav}<span class="dhint">배치표가 있는 날만 순번이 겹쳐집니다</span></div>` : '';
})()}
${J.boardMissing ? `<div class="note">
  <h3>${esc(J.dateLabel || '')} 배치표는 아직 없습니다</h3>
  <p>지금 보시는 건 <b>카카오 예약 상태만</b>입니다 &mdash; 예약이 차는 걸 실시간으로 보는 화면이에요.
  배치표가 올라오면 이 격자 위에 순번이 겹쳐집니다. (현재 배치표: ${esc(J.boardKey || '없음')})</p>
</div>` : ''}
${(J.judgeNote === '판정안함(당일)') ? `<div class="note">
  <h3>오늘 날짜는 카카오 판정을 하지 않습니다</h3>
  <p>당일에는 카카오가 <b>이미 지나간 티오프를 목록에서 빼기</b> 때문에 &lsquo;안 뜬다 = 찼다&rsquo;가 성립하지 않습니다.
  억지로 세면 지나간 시간이 전부 &lsquo;찬 칸&rsquo;이 되어 커트가 부풀어요. 그래서 오늘은 <b>찬 칸 0</b>으로 둡니다 &mdash; 고장이 아닙니다.
  실시간으로 차는 걸 보시려면 <b>내일 날짜</b>를 눌러주세요.</p>
</div>` : ''}
<div class="sandbox">
  <b>관리자 테스트판</b>
  여기서 고치고 저장하는 값은 <b>회원 앱에 반영되지 않습니다</b> &mdash; 알림도 나가지 않고, 카카오 엔진도 보지 않습니다.
  이 화면의 &lsquo;실제 배치표&rsquo;는 아직 기능이 덜 여물었기 때문입니다.
  회원에게 실제로 반영되는 교정은 모니터의 <b>배치표 검수</b> 탭에서만 합니다.
  ${(J.sandbox?.edited || []).length ? `<span class="sbon">지금 ${J.sandbox.edited.map((p) => p + '부').join('·')}는 테스트판이 덮여 있습니다${J.sandbox.at ? ` (${esc(new Date(J.sandbox.at).toLocaleString('ko-KR'))})` : ''}.</span>` : ''}
</div>

<div class="bar">
  <div class="stat ${engineOk ? 'live' : 'dead'}"><b>${engineOk ? '가동' : '중단'}</b><span>카카오 엔진</span></div>
  <div class="stat"><b>${h.ok || 0}<small style="font-size:12px;color:var(--dim)"> / ${(h.ok || 0) + (h.fail || 0)}</small></b><span>조회 성공 ${okRate}%</span></div>
  <div class="stat"><b>${snap.bookedCount || 0}<small style="font-size:12px;color:var(--dim)"> / ${snap.fixedCount || 0}</small></b><span>찬 칸</span></div>
  <div class="stat"><b>${snap.openCount || 0}</b><span>판매중</span></div>
  <div class="stat"><b>${snap.seenCount || 0}</b><span>관측 횟수</span></div>
  <div class="stat"><b>${TOT.agree}<small style="font-size:12px;color:var(--dim)"> / ${TOT.board}</small></b><span>배치표 칸 일치</span></div>
  <div class="stat"><b>${TOT.kakaoOnly}</b><span>카카오만(당추 후보)</span></div>
</div>

<div class="parts">
${['1', '2', '3'].map(partTable).join('\n')}
</div>

<div class="viewbar">
  <div class="seg">
    <button id="vProj" type="button" class="on">대조 &mdash; 카카오 예상</button>
    <button id="vReal" type="button">실제 배치표</button>
  </div>
  <span id="viewNote" class="vnote">사진 판독 위에 카카오 예약을 겹친 <b>예상</b> 배치표입니다. 여기서도 고칠 수 있습니다.</span>
</div>

<div class="tools" id="tools" hidden>
  <button data-mode="intern" type="button">인턴 지정</button>
  <button data-mode="name" type="button">이름 고치기</button>
  <button data-mode="swap" type="button">맞바꾸기</button>
  <button data-mode="move" type="button">순번 옮기기</button>
  <button id="undoBtn" type="button" hidden>되돌리기</button>
  <button id="saveBtn" type="button" class="save" hidden>테스트판에 저장</button>
  <button id="resetBtn" type="button" ${(J.sandbox?.edited || []).length ? '' : 'hidden'}>실제 판독으로 초기화</button>
  <span id="hint" class="hint">모드를 고르고 칸을 누르거나 끌어놓으세요.</span>
  <span id="state" class="hint"></span>
</div>

<div class="legend">
  <span><i style="background:var(--ok-bg);border-color:var(--ok)"></i>배치표와 카카오 일치</span>
  <span><i style="background:var(--warn-bg);border-color:var(--warn)"></i>카카오만 &mdash; 예약은 찼는데 배치표엔 없음</span>
  <span><b style="color:var(--warn)">＋</b> 이 <b>칸</b>이 새로 찼음(사람이 새로 온 게 아님)</span>
  <span><i style="background:var(--ok-bg);border-color:var(--ok)"></i><b>54</b> 전 부 근무 &middot; <b>1,3</b>/<b>2,3</b> 두 부 중복 &mdash; 리버힐 규칙상 앞 순번</span>
  <span><i style="background:var(--miss-bg);border-color:var(--miss)"></i>배치표만 &mdash; 카카오는 비었다고 봄</span>
  <span><i style="background:var(--open)"></i>판매중(빈 칸)</span>
  <span><i style="background:var(--idle)"></i>미운영 · 보류</span>
</div>

<div class="note">
  <h3>대조 결과 &mdash; 배치표와 카카오가 서로를 검증한다</h3>
  <table class="cmp"><thead><tr><th>부</th><th>배치표</th><th>카카오</th><th>일치</th><th>배치표만</th><th>카카오만</th><th>커트</th></tr></thead><tbody>
  ${['1', '2', '3'].map((p) => { const c = CMP[p]; return `<tr>
    <th>${p}부</th><td>${c.boardCount}</td><td>${c.kakaoCount}</td>
    <td class="${c.agree.length === c.boardCount ? 'good' : ''}">${c.agree.length}</td>
    <td class="${c.boardOnly.length ? 'bad' : ''}">${c.boardOnly.length}</td>
    <td class="${c.kakaoOnly.length ? 'warn' : ''}">${c.kakaoOnly.length}</td>
    <td>${c.cut || '-'}${c.newCut !== c.cut ? ` &rarr; <b>${c.newCut}</b>` : ''}</td></tr>`; }).join('')}
  </tbody></table>
  ${TOT.boardOnly ? `<p><b>배치표에만 있는 칸 ${TOT.boardOnly}개</b> &mdash; 카카오가 놓쳤거나 배치표 오판독. 여기가 어긋나면 둘 중 하나는 틀린 것이다.</p>`
    : '<p><b>배치표에 있는 칸은 전부 카카오에도 있다</b> &mdash; 어긋난 칸 0. 사진 판독과 예약 API는 완전히 독립된 경로다.</p>'}
  ${TOT.kakaoOnly ? `<p>카카오에만 있는 칸 <b>${TOT.kakaoOnly}개</b> &mdash; 배치표가 뜬 뒤 들어온 예약(당추)이거나,
    전화&middot;회원 예약이라 카카오에 안 뜨는 칸을 '찼다'고 읽은 것. 최종 배치표의 커트가 답을 준다.</p>` : ''}
  <span style="color:var(--dim)">마지막 스캔 ${esc(scanAt)} &middot; 5분 간격 자동 &middot; Claude 호출 0</span>
</div>

${['1', '2', '3'].filter((p) => CMP[p].newCut > CMP[p].cut && CMP[p].cut > 0).map((p) => {
  const c = CMP[p]; const R = rosterOf(p); const n = c.newCut - c.cut;
  return `<div class="note promo">
  <h3>${p}부 커트가 ${c.cut} &rarr; ${c.newCut}로 올라갑니다 &mdash; 승격 ${n}명</h3>
  <p class="promo-names">${R.slice(c.cut, c.newCut).map((x, i) => ({ p: c.cut + i + 1, ...tagOf(x) }))
    .filter((t) => t.name && !t.guaranteed).map((t) => `<span><b>${t.p}번</b> ${esc(t.name)}${t.tag ? `<i>${esc(t.tag)}</i>` : ''}</span>`).join('')
    || '<span>(승격 없음 &mdash; 늘어난 자리가 전부 무조건근무자였습니다)</span>'}</p>
  스페어였던 사람이 근무로 바뀝니다. <b>(54)&middot;(찾근)</b>은 커트 밖에서도 근무하는 사람이라 승격에서 뺐습니다 &mdash;
  원래 나가기로 돼 있던 사람을 승격이라 부르면 없던 소식을 지어내는 셈입니다. 카카오가 본 예약이 전부 진짜 팀일 때의 이야기고,
  전화&middot;회원 예약이라 카카오에 안 뜨는 칸을 '찼다'고 잘못 읽었다면 이 승격도 틀립니다.
  <b>최종 배치표의 커트가 ${c.newCut}이면 맞습니다.</b>
</div>`; }).join('')}
<script>
window.__DAEJO_DATE = ${JSON.stringify(String(J.dateKey || ''))};
window.__DAEJO_BOARD = ${JSON.stringify(Object.fromEntries(['1', '2', '3'].map((p) => [p, {
  ...(J.parts?.[p] || {}),
  // 예상 보기에서도 편집하려면 카카오가 '찼다'고 본 칸을 클라이언트가 알아야 한다.
  kakaoSlots: (snap.byPart?.[p] || []).map((x) => ({ time: x.time, course: x.course })),
}])))};
${CLIENT_JS}
</script>
</div>`;

for (const p of ['1', '2', '3']) { const c = CMP[p];
  console.log(`  ${p}부 일치 ${c.agree.length}/${c.boardCount} · 배치표만 ${c.boardOnly.length} · 카카오만 ${c.kakaoOnly.length} · 커트 ${c.cut}${c.newCut !== c.cut ? ` → ${c.newCut}` : ''}`); }
return html;
}

// CLI — 파일로 뽑기.  node tools/gen-daejo.mjs <src.json> [out.html]
if (process.argv[1] && /gen-daejo\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const src = process.argv[2];
  const out = process.argv[3] || 'daejo.html';
  if (!src) { console.error('사용법: node tools/gen-daejo.mjs <src.json> [out.html]'); process.exit(1); }
  fs.writeFileSync(out, renderDaejo(JSON.parse(fs.readFileSync(src, 'utf8'))));
  console.log(`대조판 → ${out}`);
}
