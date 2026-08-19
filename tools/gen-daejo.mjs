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
// 그 부에 사람이 끼워넣은 격자 밖 칸 — "17:30|OUT" 꼴.
//  ★7분 배수는 원칙이지 법이 아니다. 예약팀은 팀을 하나 더 받으려고 격자 사이에 칸을 끼운다
//   (실측 8/18 3부 17:30 — 순번 10만 5분 앞당겨지고 11번은 17:35를 그대로 받았다).
//   격자만 그리면 그 팀은 화면에 아예 없어서 볼 수도 고칠 수도 없다.
const extraOf = (part) => ((sched.declared?.[part] || {}).extra || []).map(String);
const extraKeys = new Set(['1', '2', '3'].flatMap((p) => extraOf(p).map((k) => `${p}|${K(k.split('|')[0], k.split('|')[1])}`)));
const extraMins = (part) => new Set(extraOf(part).map((k) => toMin(k.split('|')[0])));
const onGrid = (part, mins) => {
  const p = sched.parts?.[part]; if (!p) return true;
  return (mins - toMin(p.first)) % cadence === 0;
};

function slotsOf(part) {
  const p = sched.parts?.[part]; if (!p) return [];
  const a = toMin(p.first), b = toMin(p.last);
  const rows = new Set();
  for (let t = a; t <= b; t += cadence) rows.add(t);
  for (const m of extraMins(part)) rows.add(m);      // 끼운 칸도 한 줄을 차지한다
  return [...rows].sort((x, y) => x - y);
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
  // ★끼운 행의 반대편 코스는 '없는 칸'이다. 격자 행처럼 그리면 있지도 않은 팀이 하나 더 생긴다.
  if (!onGrid(part, mins) && !extraKeys.has(`${part}|${key}`)) {
    return `<td class="c none" data-t="${toHM(mins)}" data-c="${course}" data-p="${part}"></td>`;
  }
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

// -- 하루치 운영 선언 줄 -- 그날 이 부가 몇 시부터 몇 시까지, 몇 코스로 도는가.
//  ★기본틀(config/)이 아니라 '오늘'을 말하는 자리다. 예약팀은 날씨·수요로 앞뒤를 늘리고 줄이며,
//   캐디가 모자라면 한 코스만 돌린다(원웨이). 8/18엔 그걸 엔진이 관측으로 배우느라 반나절이 걸렸고,
//   그동안 3부 IN 24칸이 허위 팀이었다. 아는 사람이 그 자리에서 말할 수 있어야 한다.
function partCtl(part) {
  const cur = sched.parts?.[part] || {};
  const base = sched.base?.[part] || {};
  const dec = sched.declared?.[part] || {};
  const edge = (which, v) => {
    const ko = which === 'first' ? '첫' : '마지막';
    return `<button type="button" data-fr="${which}" data-d="-${cadence}" title="${ko} 티오프를 ${cadence}분 당깁니다 - ${which === 'first' ? '앞에 한 칸이 생깁니다' : '뒤의 한 칸이 없어집니다'}">&minus;${cadence}</button>`
      + `<b data-fv="${which}"${dec[which] ? ' class="dec"' : ''} title="기본틀 ${esc(base[which] || '-')}">${esc(v || '-')}</b>`
      + `<button type="button" data-fr="${which}" data-d="${cadence}" title="${ko} 티오프를 ${cadence}분 미룹니다 - ${which === 'first' ? '앞의 한 칸이 없어집니다' : '뒤에 한 칸이 생깁니다'}">+${cadence}</button>`;
  };
  // ★팀 수를 같이 쓴다 — 관리자가 세는 단위는 '시각'이 아니라 '팀'이다(1부 기본 44팀).
  //  시각만 보이면 한 칸 늘렸을 때 몇 팀이 되는지 눌러봐야 알고, 그러면 두 끝이 서로 묶인 것처럼 읽힌다.
  //  두 끝은 따로 움직인다 — 앞만 늘리면 46팀, 앞뒤를 다 늘리면 48팀이다.
  const span = (a, b) => (toMin(a) && toMin(b) && toMin(b) >= toMin(a)) ? Math.floor((toMin(b) - toMin(a)) / cadence) + 1 : 0;
  const rowsNow = span(cur.first, cur.last), rowsBase = span(base.first, base.last);
  // ★끼워넣은 칸도 팀이다 — 애초에 팀을 하나 더 받으려고 끼운 것이니 세지 않으면 뜻이 없다.
  //  격자 행 계산에서는 빠져 있다(그 시각은 격자 위에 없다). 코스 하나당 한 팀이므로 개수 그대로 더한다.
  const insN = (dec.extra || []).length;
  const teamsNow = rowsNow * (dec.oneway ? 1 : 2) + insN, teamsBase = rowsBase * 2;
  const cnt = rowsNow
    ? `<span class="cnt${teamsNow !== teamsBase ? ' dec' : ''}" title="기본틀 ${teamsBase}팀(${rowsBase}시각 &times; 2코스)${insN ? ` &middot; 끼워넣은 칸 ${insN}` : ''}">${rowsNow}시각${insN ? ` +${insN}칸` : ''} &middot; <b>${teamsNow}</b>팀${teamsNow !== teamsBase ? ` <i>(기본 ${teamsBase})</i>` : ''}</span>`
    : '';
  return `<div class="pctl" data-p="${part}">
    <span class="cl">시각</span>${edge('first', cur.first)}<span class="cs">&mdash;</span>${edge('last', cur.last)}${cnt}
    <button type="button" class="ins" data-ins="${part}" title="격자 밖 시각에 칸을 하나 끼워넣습니다(예: 17:30 OUT). 7분 배수가 깨지는 날에 씁니다.">＋칸</button>
    ${(dec.extra || []).map((k) => `<button type="button" class="chip" data-del="${part}" data-k="${esc(k)}" title="이 칸을 뺍니다">${esc(k.replace('|', ' '))} &times;</button>`).join('')}
    <button type="button" class="ow${dec.oneway ? ' on' : ''}" data-ow="${part}" title="투웨이 &rarr; OUT만 &rarr; IN만 순으로 바뀝니다. 카카오 엔진이 곧바로 읽습니다.">${dec.oneway ? `원웨이 ${dec.oneway}만` : '투웨이'}</button>
    ${(dec.first || dec.last || dec.oneway) ? `<button type="button" class="rev" data-rev="${part}" title="이 부의 선언을 거두고 기본틀(${esc(base.first || '-')}&ndash;${esc(base.last || '-')} &middot; 투웨이)로 되돌립니다">기본틀</button>` : ''}
  </div>`;
}

function partTable(part) {
  const rows = slotsOf(part);
  if (!rows.length) return '';
  const body = rows.map((t) => `<tr>${cell(part, t, 'OUT')}<th class="t${extraMins(part).has(t) ? ' ins' : ''}"${extraMins(part).has(t) ? ' title="격자 밖에 끼워넣은 칸"' : ''}>${toHM(t)}</th>${cell(part, t, 'IN')}</tr>`).join('\n');
  const n = (snap.byPart?.[part] || []).length;
  const c = CMP[part];
  return `<section class="part">
  <header class="ph"><h2>${part}부</h2><span class="pn">커트 <b>${c.cut || '-'}</b>${c.newCut !== c.cut ? ` &rarr; <b>${c.newCut}</b>` : ''} &middot; 찬 칸 ${n}</span></header>
  ${partCtl(part)}
  <table class="grid"><thead><tr><th>OUT</th><th class="t">시각</th><th>IN</th></tr></thead><tbody>
${body}
  </tbody></table>
  <div class="spares" data-p="${part}" hidden></div>
  <div class="offs" data-p="${part}" hidden></div>
  <div class="pool" data-p="${part}" hidden></div>
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
/* 하루치 운영 선언 줄 - 표 바로 위, 그 부의 '오늘'을 말하는 자리. 편집 도구보다 조용해야 한다
   (하루에 한 번 누르는 것이지 계속 만지는 게 아니다). */
.pctl{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px 11px;
  border-bottom:1px solid var(--line);background:var(--open);font-size:11px;color:var(--dim)}
.pctl .cl{font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;margin-right:2px}
.pctl .cs{opacity:.55;padding:0 2px}
.pctl b{min-width:38px;text-align:center;font-weight:700;font-size:11.5px;color:var(--ink);
  font-variant-numeric:tabular-nums}
.pctl b.dec{color:var(--warn);text-decoration:underline;text-underline-offset:3px}
.pctl button{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:5px;
  padding:1px 6px;font-size:11px;font-family:inherit;line-height:1.6;cursor:pointer}
.pctl button:hover{border-color:var(--warn)}
.pctl button:disabled{opacity:.45;cursor:default}
.pctl .cnt{margin-left:9px;padding-left:9px;border-left:1px solid var(--line);white-space:nowrap}
.pctl .cnt b{min-width:0;font-size:12px;color:var(--ink)}
.pctl .cnt.dec b{color:var(--warn)}
.pctl .cnt i{font-style:normal;opacity:.7;font-size:10px}
.pctl button.ins{font-weight:700}
.pctl button.chip{background:var(--warn-bg);color:var(--warn);border-color:var(--warn);font-weight:700}
th.t.ins{color:var(--warn);font-weight:700;box-shadow:inset 3px 0 0 var(--warn)}
td.c.none{background:repeating-linear-gradient(135deg,var(--open),var(--open) 5px,transparent 5px,transparent 10px);cursor:default}
.pctl button.ow{margin-left:auto;font-weight:600}
.pctl button.ow.on{background:var(--warn-bg);color:var(--warn);border-color:var(--warn)}
.pctl button.rev{color:var(--dim)}
.tools{display:flex;flex-wrap:wrap;align-items:center;gap:11px;margin:10px 0 4px}
.tools button{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:7px;
  padding:7px 15px;font-size:13px;font-family:inherit;cursor:pointer}
.tools button:hover{border-color:var(--warn)}
.tools button.on{background:var(--warn-bg);color:var(--warn);border-color:var(--warn);font-weight:600}
.tools button.save{background:var(--ok);color:var(--panel);border-color:var(--ok);font-weight:600}
/* 앱 반영은 되돌릴 수 없는 쪽이라 색을 달리한다 — 실수로 누르는 버튼과 같아 보이면 안 된다. */
.tools button.apply{background:var(--warn);color:var(--panel);border-color:var(--warn);font-weight:700}
/* 알림 대상 고르기 — 누구에게 갈지 눈으로 보고 손으로 고르는 판.
   ★목록을 안 보여주고 '전체에게 보냅니다'만 묻는 건 확인이 아니다. 이 화면의 값은 목록 그 자체다. */
.npick{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:12px 0 4px;overflow:hidden}
.nhead{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid var(--line)}
.nhead .nt{font-size:12px;font-weight:700;letter-spacing:-.01em}
.nhead button{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px;
  padding:3px 10px;font-size:11.5px;font-family:inherit;cursor:pointer}
.nhead button:hover{border-color:var(--warn)}
.nhead button.notify{background:var(--miss);color:var(--panel);border-color:var(--miss);font-weight:700}
.nhead button:disabled{opacity:.45;cursor:default}
.nseg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.nseg button{border:0;border-right:1px solid var(--line);border-radius:0;color:var(--dim);padding:3px 11px}
.nseg button:last-child{border-right:0}
.nseg button.on{background:var(--ok);color:var(--panel);font-weight:700}
.ncount{margin-left:auto;font-size:11.5px;color:var(--dim)}
.nnote{margin:0;padding:9px 13px;font-size:11.5px;line-height:1.6;color:var(--dim);background:var(--open);
  border-bottom:1px solid var(--line)}
.nlist{max-height:340px;overflow-y:auto}
.nrow{display:flex;align-items:flex-start;gap:9px;padding:8px 13px;border-bottom:1px solid var(--line);
  font-size:12px;cursor:pointer}
.nrow:last-child{border-bottom:0}
.nrow:hover{background:var(--open)}
.nrow input{margin:2px 0 0;width:15px;height:15px;accent-color:var(--ok);cursor:pointer}
.nrow .nm{font-weight:700;min-width:62px}
.nrow .bd{color:var(--dim);line-height:1.5}
.nrow.chg .nm{color:var(--warn)}
.nrow.chg .nm::after{content:' 바뀜';font-size:9.5px;font-weight:600}
.nempty{padding:14px;font-size:12px;color:var(--dim)}
/* 근태 칸 — 휴무·휴가·병가는 스페어가 아니다.
   ★스페어 줄에 순번을 달고 섞여 있으면 순서를 만질 때 헷갈린다(사용자 지적).
    그날 안 나오는 사람과 대기하는 사람은 하는 일이 정반대인데 같은 줄에 있을 이유가 없다.
   ★줄 자체가 놓는 자리다 — 끌어다 놓으면 그 상태가 되고, 스페어 줄로 끌면 풀린다. */
.offs{padding:9px 11px;border-top:1px solid var(--line);background:var(--open)}
.offs .lb{display:block;font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.offlane{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:5px 7px;margin-bottom:4px;
  border:1px dashed var(--line);border-radius:7px;min-height:32px}
.offlane:last-child{margin-bottom:0}
.offlane>b{font-size:10px;font-weight:800;letter-spacing:.02em;min-width:34px;color:var(--miss)}
.offlane.drop-to{border-style:solid;border-color:var(--warn);background:var(--warn-bg)}
.offlane .none{font-size:11px;color:var(--dim);opacity:.7}
.offc{display:inline-flex;align-items:center;gap:4px;background:var(--miss-bg);border:1px solid var(--miss);
  border-radius:6px;padding:3px 8px;font-size:12px;color:var(--miss);cursor:grab;user-select:none}
.offc b{font-size:10px;opacity:.7;font-weight:700}
.offc.dragging{opacity:.4}
body.editing .offc{touch-action:none}
.spares.drop-to{outline:2px dashed var(--ok);outline-offset:-3px}
/* 미배치 캐디 서랍 — 정본 명단에서 '오늘 이 부에 안 잡힌 사람'만. 끌어다 놓으면 명단에 들어간다.
   ★스페어 줄과 색을 나눈다: 스페어는 '오늘 이 부에 있는 사람', 서랍은 '아직 없는 사람'이다.
   둘이 같아 보이면 끌어다 놓는 방향을 헷갈린다. */
.pool{padding:9px 11px;border-top:1px dashed var(--line);background:var(--panel)}
.pool .lb{display:block;font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.pool .lb b{color:var(--ink)}
/* 상태 고르기 — 넣는 사람이 그날 스페어인지 휴무인지는 사람만 안다. 기본값으로 지어내지 않는다. */
.pool .pseg{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin:0 0 8px}
.pool .pseg button{background:var(--panel);color:var(--dim);border:1px solid var(--line);border-radius:6px;
  padding:2px 10px;font-size:11.5px;font-family:inherit;cursor:pointer}
.pool .pseg button.on{background:var(--warn-bg);color:var(--warn);border-color:var(--warn);font-weight:700}
.pool .pseg button.go{margin-left:auto;background:var(--ok);color:var(--panel);border-color:var(--ok);font-weight:700}
.pool .pseg button.go:disabled{background:var(--panel);color:var(--dim);border-color:var(--line);font-weight:400;cursor:default}
.pk.on{border-style:solid;border-color:var(--ok);background:var(--ok-bg);color:var(--ok);font-weight:700}
/* 근태 — 명단에 있지만 그날 안 나오는 사람. 스페어와 한눈에 갈려야 한다. */
.sp.duty{opacity:.75;border-style:dashed}
.sp .dy{font-size:9px;padding:0 4px;border-radius:3px;background:var(--miss-bg);color:var(--miss);font-weight:700}
td.c.duty{opacity:.65;box-shadow:inset 3px 0 0 var(--miss)}
.pool .wrap2{display:flex;flex-wrap:wrap;gap:5px;max-height:150px;overflow-y:auto}
.pk{display:inline-flex;align-items:center;gap:4px;background:var(--open);border:1px dashed var(--dim);
  border-radius:6px;padding:3px 9px;font-size:12px;cursor:grab;user-select:none;color:var(--dim)}
.pk:hover{border-style:solid;border-color:var(--ok);color:var(--ink);background:var(--ok-bg)}
.pk.dragging{opacity:.4}
.pk .el{font-size:9px;padding:0 3px;border-radius:3px;background:var(--warn-bg);color:var(--warn)}
body.editing .pk{touch-action:none}
/* 알림은 회원 폰으로 나간다 — 이 화면에서 유일하게 '밖으로' 나가는 버튼이라 색을 따로 준다.
   반영은 되돌릴 수 있지만 보낸 알림은 못 거둔다. */
.tools button.notify{background:var(--miss);color:var(--panel);border-color:var(--miss);font-weight:700}
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
.sp.add{border-style:dashed;color:var(--ok);font-weight:700;border-color:var(--ok)}
.sp.add:hover{background:var(--ok-bg)}
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
  <b>테스트판에 저장</b>은 회원 앱에 반영되지 않습니다 &mdash; 여기 안에서만 삽니다.
  회원 앱에 넘기려면 <b>실제 배치표를 앱에 반영</b>을 따로 눌러야 하고, 그때 넘어가는 건
  <b>실제 배치표 축만</b>입니다 &mdash; 카카오 예상 칸은 절대 넘어가지 않습니다(예상은 아직 관측 전용).
  반영해도 <b>알림은 나가지 않습니다</b>. 정정 알림은 모니터의 <b>배치표 검수</b> 탭에서 미리보기 후 보냅니다.
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
    <button id="vProj" type="button">대조 &mdash; 카카오 예상</button>
    <button id="vReal" type="button" class="on">실제 배치표</button>
  </div>
  <span id="viewNote" class="vnote">사진이 <b>실제로 읽은</b> 배치표입니다. 고치는 곳이자 앱으로 넘어가는 곳입니다.</span>
</div>

<div class="tools" id="tools" hidden>
  <button data-mode="team" type="button">티오프 추가·삭제</button>
  <button data-mode="intern" type="button">인턴 지정</button>
  <button data-mode="name" type="button">이름 고치기</button>
  <button data-mode="crew" type="button">캐디 추가·삭제</button>
  <button data-mode="swap" type="button">맞바꾸기</button>
  <button data-mode="move" type="button">순번 옮기기</button>
  <button id="undoBtn" type="button" hidden>되돌리기</button>
  <button id="saveBtn" type="button" class="save" hidden>테스트판에 저장</button>
  <button id="applyBtn" type="button" class="apply" hidden>실제 배치표를 앱에 반영</button>
  <button id="notifyBtn" type="button" class="notify" hidden>정정 알림 보내기</button>
  <button id="pickBtn" type="button">알림 대상 고르기</button>
  <button id="resetBtn" type="button" ${(J.sandbox?.edited || []).length ? '' : 'hidden'}>실제 판독으로 초기화</button>
  <span id="hint" class="hint">모드를 고르고 칸을 누르거나 끌어놓으세요.</span>
  <span id="state" class="hint"></span>
</div>

<div class="npick" id="npick" hidden>
  <div class="nhead">
    <span class="nt">알림 대상</span>
    <span class="nseg" id="npParts"></span>
    <button type="button" data-npsel="all">전체</button>
    <button type="button" data-npsel="chg">바뀐 사람만</button>
    <button type="button" data-npsel="none">해제</button>
    <span class="ncount" id="npCount"></span>
    <button type="button" id="npSend" class="notify">보내기</button>
    <button type="button" id="npClose">닫기</button>
  </div>
  <p class="nnote">지금 <b>그 회원의 현재 상태</b>를 그대로 알립니다(근무·티오프·순번 또는 스페어·휴무).
  방금 무엇이 어떻게 바뀌었는지를 알리려면 <b>정정 알림 보내기</b>를 쓰세요 &mdash; 그건 반영 직후에만 나옵니다.</p>
  <div class="nlist" id="npList"></div>
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
window.__DAEJO_SANDBOX = ${JSON.stringify((J.sandbox && J.sandbox.edited) || [])};
window.__DAEJO_FRAME = ${JSON.stringify(sched.declared || {})};
window.__DAEJO_ROSTER = ${JSON.stringify(J.officialRoster || [])};
window.__DAEJO_CAD = ${JSON.stringify(cadence)};
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
