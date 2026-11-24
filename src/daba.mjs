// ══ 대바(대기바꿈) — 배치표 댓글을 순번에 덮어씌운다 ═══════════════════════
//  판독기는 배치표 '원본'만 읽는다. 그런데 캐디들은 배치표가 올라온 뒤 댓글로 순번을 바꾼다.
//   "홍준표 김서현님 대기바꿈합니다" · "강경순님 1부 5 / 2부 19" · "최수아님 박태영님 휴무입니다"
//   · "박영순님 강아란 2부 대기 받습니다" · "------반영------"(경기과 확정)
//  원본만 믿으면 바꾼 사람의 근무·티오프·수입이 통째로 틀린다(사용자 실측, 2026-10-27·11-08).
//
//  ★자리는 그대로, 사람만 바뀐다. 티오프는 자리에 붙어 있으므로 바뀐 사람이 그 자리 티오프를 받는다.
//   그래서 스페어 '앞에 몇 명' 셈도 그대로 돈다.
//  ★댓글 하나 = 한 걸음. Claude 가 그 걸음 뒤 '주인이 바뀌는 자리'를 전부 적고, 코드가 맞는지 따진다.
//   한 부에 같은 사람이 둘·명단에 없는 이름·자리 밖 번호면 그 댓글은 적용하지 않는다(원본이 틀린 반영보다 낫다).
//  ★한 번 푼 걸음은 '그 직전 판 + 댓글 글자'를 열쇠로 저장한다 — 재시작·회원별 재해석에도 다시 부르지 않는다.
//  ★반영 표시를 기다리지 않는다(사용자 결정 11/23 "나"). 표시가 붙으면 그 앞 걸음을 '확정'으로 적는다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, appendJSONL } from './store.mjs';
import { runClaudeText } from './claudereader.mjs';
import { confirmedCaddies } from './roster.mjs';
import { broadcastOps } from './push.mjs';

// 풀이 방식이 바뀌면 올린다 — 예전 풀이를 열쇠로 다시 쓰지 않게
// v3: 대바 속 '휴무' = 자리를 내준 쪽(상대의 옛 자리로 간다) — 사용자 11/23
// v4: 두 사람 '대기바꿈'은 맞바꿈, 번호가 어긋나면 오타로 보고 안 적힌 사람은 안 옮긴다 + doubt — 사용자 11/24
//     (11/25 배문숙 "배문숙 2부 17번 / 심영운 2부 24번 대기바꿈": 배문숙 옛 자리는 25 — 이수련(24)을 25로 밀어냈다)
const PROMPT_VER = 'v4';

const DIR = path.join(DATA_DIR, 'daba');
const bare = (s) => String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
export const dabaOn = () => !['0', 'false', 'off'].includes(String(process.env.DABA_ON ?? '1').toLowerCase());

// 경기과 '반영' 표시 — 댓글 전체가 사실상 '반영'일 때만(긴 문장 속 '반영'은 아니다)
export function isMarker(text) {
  const t = String(text || '').replace(/[\s\-─—_=~.·*]+/g, '');
  return t === '반영' || t === '반영완료' || t === '반영했습니다' || t === '반영합니다';
}
// 대바 댓글일 수 있나 — 잡담·인사엔 Claude 를 부르지 않는다
export function maybeSwap(text) {
  return /대기\s*바꿈|대바|바꿈|휴무|받습니다|받아|넘깁|넘겨|\d+\s*번|[123]\s*부\s*\d+/.test(String(text || ''));
}

function loadSteps(id) { try { return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')); } catch { return { steps: {} }; } }
function saveSteps(id, o) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const p = path.join(DIR, `${id}.json`), t = p + '.tmp';
    fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, p);
  } catch (e) { console.error('[대바] 저장 실패:', e.message); }
}

const PROMPT = (state, comment, outsiders) => [
  'You apply ONE comment from a Korean golf caddie board (배치표) to the current line-up. Reply with strict JSON only.',
  'Each 부 has numbered slots (순번). A slot keeps its number and tee time; only the PERSON in it changes.',
  'Comment kinds:',
  '- "A B 대기바꿈": A and B exchange ALL their slots (in every 부 where either appears).',
  '- "A 1부 5 / 2부 19": A now occupies 1부 slot 5 and 2부 slot 19. Several people may be listed together — treat them as one group move.',
  '- "휴무" written next to a move is NOT a plain day off — it names the person who GIVES UP the slot, i.e. the other side of a swap.',
  '  e.g. "배문숙 2부4번 신지현 휴무": 신지현 holds 2부 slot 4 → 배문숙 takes slot 4 and 신지현 takes 배문숙\'s OLD 2부 slot (a spare slot far back, so 신지현 calls it 휴무).',
  '  If the mover was NOT on that 부 line-up, the 휴무 person leaves that 부 (goes 휴무 for real).',
  '  e.g. "2부 9번 이지은 / 11번 안준우 … 박시윤 박선하 휴무": pair each target slot with the 휴무 person who holds it; 이지은 (off line-up) takes 9 → 박시윤 leaves; 안준우 (had 43) takes 11 → 박선하 takes 43.',
  '- "A 휴무입니다" with no mover at all: list A in "off" (the program keeps A in any slot nobody else took — a slot is lost only when someone takes it).',
  '- "A님 B 2부 대기 받습니다": A takes B\'s 2부 slot. If A already had a 2부 slot, B takes A\'s old slot (a swap); otherwise B simply leaves that 2부 slot.',
  '- "본인 순번 / 본인 대기": that person keeps that 부 unchanged.',
  '- "A 2부 17번 / B 2부 24번 대기바꿈": the word 대기바꿈 with exactly two people = A and B EXCHANGE their slots; the numbers only confirm it.',
  '  If a written number does not match the exchange (e.g. B\'s new slot should be A\'s old 25 but the comment says 24), it is a typo: do the plain exchange, do NOT move anyone the comment does not name, and put a short Korean explanation of the mismatch in "doubt".',
  'Never move a person the comment does not name, except the occupant pushed out of a slot someone named took (that person goes to the mover\'s old slot).',
  'Whenever someone moves INTO an occupied slot, the previous occupant must go somewhere: into a slot the group vacated (the mover\'s old slot) unless the comment says otherwise. Never leave two people in one 부.',
  'People who are NOT on today\'s line-up (listed below as "Not on the line-up") can enter through a comment: "A B 대기바꿈" where only B is on the line-up means A takes B\'s slot(s) and B leaves; "2부 9번 이지은님" means 이지은 takes 2부 slot 9. Use only names from the line-up or that list.',
  'A slot ends up empty ONLY when someone leaves and nobody takes it — then list that person in "off" and do not invent a replacement.',
  'Output: {"swap":true|false,"changes":[{"part":"1","pos":5,"name":"강경순"},...],"off":["최수아"],"note":"짧은 한국어 설명","doubt":"번호가 안 맞아 짐작한 것이 있으면 한국어로, 없으면 빈 문자열"}',
  '"changes" must list EVERY slot whose occupant is different after this comment (including displaced people). Use names exactly as in the line-up, without tags. If the comment is not a line-up change (chat, thanks, question, unclear), reply {"swap":false}.',
  '',
  'Current line-up:',
  state,
  '',
  `Not on the line-up: ${(outsiders || []).join(', ')}`,
  '',
  `Comment: ${comment}`,
].join('\n');

function stateText(rosters) {
  return Object.keys(rosters).sort().map((p) => `${p}부: ` + rosters[p].map((n, i) => (n ? `${i + 1} ${bare(n)}` : `${i + 1} (빈칸)`)).join(', ')).join('\n');
}

// 한 걸음을 판에 얹어 본다 — 문제가 있으면 { problem } 을, 아니면 새 판을 돌려준다(원본은 안 건드린다).
export function applyStep(rosters, step, display = {}) {
  const next = {};
  for (const p of Object.keys(rosters)) next[p] = rosters[p].slice();
  const everyone = new Set(Object.values(rosters).flat().map(bare).filter(Boolean));
  const known = new Set([...everyone, ...Object.keys(display), ...(step._known || [])]);
  for (const c of step.changes || []) {
    const p = String(c.part || '').replace(/\D/g, ''), pos = Number(c.pos), nm = bare(c.name);
    if (!next[p]) return { problem: `${p}부가 이 배치표에 없음` };
    if (!(pos >= 1 && pos <= next[p].length)) return { problem: `${p}부 ${pos}번은 자리 밖(1~${next[p].length})` };
    if (!nm || nm === '빈칸') { next[p][pos - 1] = ''; continue; }   // Claude 가 판의 '(빈칸)' 표기를 이름으로 베껴 오기도 한다   // 빈 자리 — 번호는 그대로, 셀 때만 뺀다(끝에서)
    if (!known.has(nm)) return { problem: `명단에 없는 이름 '${c.name}'` };
    next[p][pos - 1] = display[nm] || nm;
  }
  for (const o of step.off || []) {
    const nm = bare(o);
    if (!known.has(nm)) return { problem: `명단에 없는 이름 '${o}'(휴무)` };
    for (const p of Object.keys(next)) next[p] = next[p].map((x) => (bare(x) === nm ? '' : x));
  }
  // ★자리를 내준 사람은 들어온 사람의 옛 자리로 간다 — 대바 속 '휴무'는 맞바꿈이다(사용자 11/23 예시).
  //  X 자리에 Y 가 들어왔고, Y 가 원래 같은 부에 있었고, Y 의 옛 자리가 비었으면 → X 를 거기 앉힌다.
  //  Y 가 줄 밖에서 들어왔거나 Y 의 옛 자리를 이미 누가 받았으면 X 는 진짜로 빠진다. 순수 휴무(들어온 사람 없음)는 그대로 빈 칸.
  for (const p of Object.keys(next)) {
    const prevPos = {}; rosters[p].forEach((n, i) => { if (bare(n)) prevPos[bare(n)] = i; });
    const stays = new Set(next[p].map(bare).filter(Boolean));
    for (const [x, xi] of Object.entries(prevPos)) {
      if (stays.has(x) || Object.values(next).some((r) => r.some((n) => bare(n) === x) && r !== next[p])) continue;
      const y = bare(next[p][xi]); if (!y || !(y in prevPos)) continue;
      const yi = prevPos[y]; if (yi === xi || bare(next[p][yi])) continue;
      next[p][yi] = display[x] || rosters[p][xi]; stays.add(x);
    }
  }
  // ★자리는 남이 받아 갈 때만 없어진다 — '휴무'라고만 적고 아무도 안 받은 자리는 그 사람 것으로 남는다.
  //  (사용자 11/22 고창민: 1부 26번은 넘겼고, 2부 50번은 받은 사람이 없어 그대로 2부 50번. 마지막 스페어라 휴무라 적었을 뿐)
  for (const p of Object.keys(next)) {
    for (let i = 0; i < rosters[p].length; i++) {
      const x = bare(rosters[p][i]);
      if (!x || bare(next[p][i]) || next[p].some((n) => bare(n) === x)) continue;
      next[p][i] = rosters[p][i];
    }
  }
  for (const p of Object.keys(next)) {
    const seen = new Set();
    for (const x of next[p]) { const b = bare(x); if (!b) continue; if (seen.has(b)) return { problem: `${p}부에 '${b}'가 두 자리` }; seen.add(b); }
  }
  return { rosters: next };
}

// 사람마다 '어디서 어디로' — 화면·기록용
export function movesBetween(before, after) {
  const where = (r) => { const m = {}; for (const p of Object.keys(r)) r[p].forEach((n, i) => { const b = bare(n); if (b) (m[b] = m[b] || []).push(`${p}부 ${i + 1}번`); }); return m; };
  const A = where(before), B = where(after), out = [];
  for (const nm of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const a = (A[nm] || []).join('·'), b = (B[nm] || []).join('·');
    if (a !== b) out.push({ name: nm, from: a || '없음', to: b || '휴무' });
  }
  return out;
}

// 배치표 칸 "A(B)" = 원래 주인 A, 실제로 나오는 사람 B. 괄호가 근무 태그("A(조출)")면 A 가 그대로 주인이자 나오는 사람.
const DUTY_RE = /^(찾근|조출|후출|정출|선발|당번|프리|벌당|배치|콜|정근|휴무|휴가|병가|연차|반차|월차|격리|54|[123](,[123])*)$/;
function splitCell(cell) {
  const m = String(cell || '').match(/^([^()]*)\(([^)]*)\)/);
  if (m) {
    const a = m[1].replace(/\s/g, ''), b = m[2].replace(/\s/g, '');
    if (a && /^[가-힣]{2,4}$/.test(b) && !DUTY_RE.test(b)) return { holder: a, occ: b };
  }
  const n = bare(cell);
  return { holder: n, occ: n };
}

// ── 댓글 줄 세우기 ─────────────────────────────────────────────────────────
//  ★쓴 시각 순서로 편다 — 네이버는 답글을 '원 댓글 바로 밑'에 끼워 준다. 화면 순서대로 얹으면
//   나중에 단 답글이 먼저 적용돼 뒤 댓글에 덮인다(11/25 김홍구: 1부 선발 → 2부 3번 → 답글로 2부 8번인데 3번으로 남음).
//  ★고친 댓글(사용자 11/24): 내용이 같으면(띄어쓰기·'님'·오타 한두 글자, 숫자는 그대로) 처음 쓴 자리를 지킨다.
//   내용이 바뀌었으면 고친 시각에 새로 쓴 대바로 본다. 그래서 댓글마다 '처음 본 시각·글자'를 기억한다(data/daba/<글>.json cmts).
//   네이버는 고친 시각만 준다 — 처음 본 시각이 곧 쓴 시각이다(1분마다 보니 거의 같다).
//  지운 댓글은 목록에서 빠지므로 그 대바도 저절로 빠진다(원본부터 다시 얹는다).
const _norm = (s) => String(s || '').replace(/님/g, '').replace(/[\s.,·~!?\-─—_=ㅡ:;'"()[\]/|]+/g, '');
const _digits = (s) => (String(s || '').match(/\d+/g) || []).join(',');
function _lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
export function sameContent(a, b) {
  const x = _norm(a), y = _norm(b);
  if (x === y) return true;
  return _digits(a) === _digits(b) && _lev(x, y) <= 2;
}
function orderComments(articleId, list) {
  const ms = (d) => { const n = typeof d === 'number' ? d : Date.parse(d || ''); return Number.isFinite(n) ? n : null; };
  const store = articleId ? loadSteps(articleId) : { steps: {} };
  const mem = store.cmts || {};
  let dirty = false;
  const rows = list.map((c, k) => {
    const text = String((c && (c.content ?? c.text)) ?? c ?? '').trim();
    const cid = c && typeof c === 'object' && c.id != null ? String(c.id) : '';
    let t = ms(c && typeof c === 'object' ? c.date : null);
    if (cid) {
      const m = mem[cid];
      if (!m) { mem[cid] = { t, text }; dirty = true; }
      else if (m.text !== text) {
        if (sameContent(m.text, text)) mem[cid] = { t: m.t, text };              // 같은 내용 — 처음 자리 그대로
        else { mem[cid] = { t, text, editedFrom: m.text }; console.log(`✏️ [대바] #${articleId} 댓글 내용이 바뀜 → 고친 시각에 새 대바로: "${text.slice(0, 40)}"`); }
        dirty = true;
      }
      t = mem[cid].t;
    }
    return { text, k, t };
  }).filter((r) => r.text);
  if (dirty && articleId) saveSteps(articleId, { ...store, cmts: mem });
  if (rows.every((x) => x.t != null)) rows.sort((a, b) => (a.t - b.t) || (a.k - b.k));
  return rows.map((r) => r.text);
}

const _mem = new Map();   // 글번호 → { sig, promise }
// 배치표 판독 결과(board)에 댓글 바꿈을 덮어씌운 새 board 를 돌려준다. 댓글이 없거나 꺼져 있으면 그대로.
export async function withDaba(article, board) {
  if (!dabaOn() || !board || !board.parts || !article || !article.id) return board;
  // ★쓴 시각 순서로 편다 — 네이버는 답글을 '원 댓글 바로 밑'에 끼워 준다. 화면 순서대로 얹으면
  //  나중에 단 답글이 먼저 적용돼 뒤 댓글에 덮인다(11/25 김홍구: 1부 선발 → 2부 3번 → 답글로 2부 8번인데 3번으로 남음).
  //  시각이 없거나 같으면 원래 순서(정렬은 안정적이다).
  const comments = orderComments(String(article.id), article.comments || []);
  if (!comments.length) return board;
  const base = {};
  for (const p of Object.keys(board.parts)) if (Array.isArray(board.parts[p]?.roster) && board.parts[p].roster.length) base[p] = board.parts[p].roster.slice();
  if (!Object.keys(base).length) return board;
  // ★망가진 판독 위에는 얹지 않는다 — 11/23: 2부 뒷사람 25명이 1~25번에 밀려 들어간 판독에 댓글 번호를 얹어
  //  엉뚱한 사람끼리 바뀌었다. 명단 가운데 빈 칸이 있거나, 팀 수보다 명단이 짧으면 원본 그대로 둔다.
  for (const p of Object.keys(base)) {
    const r = base[p], last = r.map((x) => !!bare(x)).lastIndexOf(true);
    const holes = r.slice(0, last + 1).filter((x) => !bare(x)).length;
    const cut = Number(board.parts[p]?.cut) || (board.parts[p]?.tee || []).length || 0;
    const filled = r.filter((x) => bare(x)).length;
    if (holes || (cut && filled < cut)) {
      console.warn(`⚠ [대바] #${article.id} ${p}부 명단이 성치 않아(빈 칸 ${holes} · 명단 ${filled}/${cut}팀) 댓글 반영 안 함 — 원본 그대로`);
      return board;
    }
  }
  const sig = sha(JSON.stringify(base) + '\u0001' + comments.join('\u0002'));
  const hit = _mem.get(String(article.id));
  if (hit && hit.sig === sig) return hit.promise;
  const promise = (async () => {
    const id = String(article.id);
    const store = loadSteps(id);
    // ★배치표에 이미 "A(B)"로 바뀐 칸이 있으면 나오는 사람 B 로 풀어 놓고, 주인 A 는 따로 기억한다.
    const holderOf = {}, work = {};
    for (const p of Object.keys(base)) {
      holderOf[p] = base[p].map((c) => splitCell(c).holder);
      work[p] = base[p].map((c) => { const s = splitCell(c); return s.holder !== s.occ ? s.occ : c; });
    }
    const display = {};
    for (const r of Object.values(work)) for (const n of r) if (bare(n) && !display[bare(n)]) display[bare(n)] = n;
    let cur = work;
    const log = [];
    let official = [];
    try { official = [...new Set((confirmedCaddies() || []).map(bare).filter(Boolean))]; } catch { /* 명단 없으면 배치표 안 이름만 */ }
    let lastMarker = -1;
    comments.forEach((t, i) => { if (isMarker(t)) lastMarker = i; });
    for (let i = 0; i < comments.length; i++) {
      const t = comments[i];
      if (isMarker(t) || !maybeSwap(t)) continue;
      const key = sha(PROMPT_VER + JSON.stringify(cur) + '\u0001' + t);
      let step = store.steps[key];
      if (!step) {
        const onBoard = new Set(Object.values(cur).flat().map(bare).filter(Boolean));
        const out = await runClaudeText(PROMPT(stateText(cur), t, official.filter((n) => !onBoard.has(n))));
        const m = String(out || '').match(/\{[\s\S]*\}/);
        if (!m) { log.push({ i, text: t, status: 'unread' }); continue; }   // 못 불렀으면 저장하지 않는다 — 다음에 다시
        try { step = JSON.parse(m[0]); } catch { log.push({ i, text: t, status: 'unread' }); continue; }
        store.steps[key] = step;
      }
      // ★풀이가 있으면 받는다 — Claude 는 자리가 비는 풀이에 스스로 swap:false 를 달곤 했다(11/23 실측: 풀이는 정확).
      //  맞는지는 아래 applyStep 이 따진다(두 자리·없는 이름·자리 밖).
      const hasWork = (step.changes || []).length || (step.off || []).length;
      if (!step.swap && !hasWork) { log.push({ i, text: t, status: 'skip' }); continue; }
      const r = applyStep(cur, { ...step, _known: official }, display);
      if (r.problem) { log.push({ i, text: t, status: 'problem', problem: r.problem, note: step.note || '' }); continue; }
      const doubt = String(step.doubt || '').trim();
      log.push({ i, text: t, status: 'applied', confirmed: i < lastMarker, note: step.note || '', ...(doubt ? { doubt } : {}), moves: movesBetween(cur, r.rosters) });
      // ★번호가 어긋나 짐작한 댓글은 사람에게 묻는다 — 한 댓글에 한 번만(사용자 11/24 배문숙 24/25)
      if (doubt) {
        store.told = store.told || {};
        if (!store.told[key]) {
          store.told[key] = Date.now();
          console.warn(`   ⚠ [대바] 번호가 어긋나 짐작함: "${t.replace(/\s+/g, ' ').slice(0, 50)}" — ${doubt}`);
          broadcastOps({ title: '대바 댓글 번호가 어긋납니다', body: `"${t.replace(/\s+/g, ' ').slice(0, 40)}" — ${doubt.slice(0, 80)}. 맞바꿈으로 반영했습니다. 확인해 주세요.`, url: '/', level: 'check', bypassQuiet: true }).catch(() => {});
        }
      }
      cur = r.rosters;
    }
    // ★배치표 번호는 그대로 기억한다 — 캐디들은 댓글·대화에서 배치표 번호("40번")를 쓴다(사용자 11/23).
    //  계산(근무 여부·티오프·앞에 몇 명·당일 추가)은 'N팀이면 앞에서 N명'이라 빈 칸을 빼고 센 순서로 한다.
    //  그래서 아래 순서는 당겨 세고, 보이는 번호는 _boardNo(이름 → 배치표 번호)로 따로 들고 간다.
    const boardNo = {};
    for (const p of Object.keys(cur)) { boardNo[p] = {}; cur[p].forEach((n, i) => { if (bare(n)) boardNo[p][bare(n)] = i + 1; }); }
    const moves = movesBetween(work, cur);
    // ★배치표처럼 적는다 — 주인이 아닌 사람이 앉은 칸은 "주인(나오는 사람)" (사용자 11/23 "A(B) 이런 식으로")
    for (const p of Object.keys(cur)) {
      if (cur[p] === work[p]) continue;
      cur = { ...cur, [p]: cur[p].map((c, i) => { const o = bare(c), h = holderOf[p][i]; return (o && h && o !== h) ? `${h}(${o})` : c; }) };
    }
    for (const p of Object.keys(cur)) {
      if (cur[p] === work[p]) continue;
      const filled = cur[p].filter((x) => bare(x));
      cur = { ...cur, [p]: filled.concat(new Array(cur[p].length - filled.length).fill('')) };
    }
    store.log = log; store.at = Date.now(); store.subject = article.subject || '';
    saveSteps(id, store);
    const applied = log.filter((x) => x.status === 'applied').length;
    const problems = log.filter((x) => x.status === 'problem');
    if (applied || problems.length) {
      console.log(`🔄 [대바] #${id} 댓글 ${comments.length}개 → 반영 ${applied}건${problems.length ? ` · 못 알아들음 ${problems.length}건` : ''} · 자리 바뀐 사람 ${moves.length}명`);
      for (const p of problems) console.warn(`   ⚠ [대바] "${p.text.slice(0, 50)}" — ${p.problem}`);
    }
    appendJSONL('daba.jsonl', { at: Date.now(), id, applied, problems: problems.length, moves });
    // 못 부른 댓글이 있으면 기억에서 빼 둔다 — 다음 판독 때 다시 부른다(푼 걸음은 파일에 남아 있다)
    if (log.some((x) => x.status === 'unread')) _mem.delete(id);
    if (!applied) return board;
    // ★댓글로 이 부를 떠난 사람 — 판독 오류로 이름이 빠진 것과 구별한다(이 사람의 이 부 카드는 지운다).
    //  11/25 김홍구: 1부 선발을 넘겼는데 '이름이 안 보임 = 오독 의심'으로 다뤄 1부 2번 카드가 그대로 남았다.
    const leftOf = {};
    for (const p of Object.keys(cur)) {
      const now = new Set(cur[p].map((c) => splitCell(c).occ).map(bare).filter(Boolean));
      leftOf[p] = [...new Set(work[p].map(bare).filter((n) => n && !now.has(n)))];
    }
    const parts = {};
    for (const p of Object.keys(board.parts)) parts[p] = cur[p] ? { ...board.parts[p], roster: cur[p], _daba: true, _boardNo: boardNo[p], _dabaLeft: leftOf[p] || [] } : board.parts[p];
    return { ...board, parts, _daba: { applied, moves, problems: problems.map((x) => ({ text: x.text, problem: x.problem })) } };
  })().catch((e) => { console.error('[대바] 오류 — 원본 그대로:', e.message); _mem.delete(String(article.id)); return board; });
  _mem.set(String(article.id), { sig, promise });
  if (_mem.size > 8) _mem.delete(_mem.keys().next().value);
  return promise;
}
