// ══ 부 휴장 — "3부 휴장합니다" 한 줄이 그날 그 부를 통째로 닫는다 ═══════════════════
//  배치표에 3부가 1~2팀 잡혔다가 그날 오후 카톡에 "3부휴장입니다"가 올라오는 일이 잦다
//  (실측 8/30·10/6·10/27·10/28·10/29·11/1·11/20·11/21 — 거의 다 14~15시, 카톡).
//  카페 공지로 "내일은 3부가 휴장입니다"처럼 미리 오기도 한다.
//  예전엔 이 말을 받고도 아무것도 안 했다 → 3부 캐디 카드가 스페어·근무로 남았다.
//
//  ★날짜: 글 속 날짜("11월 24일") > '내일'(올린 날 +1) > 댓글이면 그 배치표 글의 날짜 > 올린 날.
//  ★한 번 닫히면 saveToday 길목에서 그 날 그 부 카드는 '휴무(휴장)'로 고정된다 — 배치표를 다시 읽어도 안 돌아간다.
//  ★"휴장 취소·아닙니다"면 다시 연다.
import { loadJSON, saveJSON, appendJSONL } from './store.mjs';

const FILE = 'part-closed.json';
const KST = 9 * 3600e3;

const isoOf = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// 글 속 날짜 → ISO. 연도가 없으면 기준일의 연도(12월에 1월 얘기면 다음 해).
function dateIn(text, baseISO) {
  const m = String(text || '').match(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!m) return '';
  let y = Number(m[1]) || Number(baseISO.slice(0, 4));
  const mo = Number(m[2]), d = Number(m[3]);
  if (!m[1] && mo === 1 && Number(baseISO.slice(5, 7)) === 12) y += 1;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const CLOSE_RE = /([123])\s*부\s*(?:는|가|도|를|만)?\s*(?:오늘|금일|내일|명일)?\s*(?:은|는)?\s*휴장/g;
const UNDO_RE = /휴장\s*(?:은|이)?\s*(?:취소|아니|아님|아닙|안\s*합|안\s*해|해제|철회)/;

// 한 덩어리 글에서 휴장/재개 말을 찾는다 → [{ part, iso, open }]
export function detectClosure(text, { postedISO, articleISO = '' } = {}) {
  const t = String(text || '');
  if (!/휴장/.test(t)) return [];
  const base = postedISO || isoOf(Date.now());
  const out = [];
  for (const m of t.matchAll(CLOSE_RE)) {
    const around = t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 20);
    const iso = dateIn(around, base) || (/내일|명일/.test(around) ? addDays(base, 1) : '') || articleISO || base;
    out.push({ part: m[1], iso, open: UNDO_RE.test(t.slice(m.index, m.index + m[0].length + 15)) });
  }
  return out;
}

export function loadClosed() { return loadJSON(FILE, {}) || {}; }

export function isPartClosed(iso, part) {
  if (!iso || !part) return false;
  const day = loadClosed()[iso];
  return !!(day && day[String(part)]);
}

// 기록 — 바뀌었으면 true
export function setPartClosed(iso, part, closed, meta = {}) {
  const all = loadClosed();
  const day = all[iso] || {};
  const p = String(part);
  if (!!day[p] === !!closed) return false;
  if (closed) day[p] = { at: Date.now(), ...meta };
  else delete day[p];
  if (Object.keys(day).length) all[iso] = day; else delete all[iso];
  // 오래된 날은 버린다(60일)
  const cutoff = addDays(isoOf(Date.now()), -60);
  for (const k of Object.keys(all)) if (k < cutoff) delete all[k];
  saveJSON(FILE, all);
  appendJSONL('part-closed.jsonl', { at: Date.now(), iso, part: p, closed: !!closed, ...meta });
  return true;
}

// 글 하나(카페 글·댓글·카톡)를 훑어 휴장/재개를 기록한다 → 바뀐 것들 [{part, iso, open}]
export function noteClosures(full, source = '') {
  const posted = Number(full?.writeDate) || Date.now();
  const postedISO = isoOf(posted);
  const subj = String(full?.subject || '');
  const articleISO = dateIn(subj, postedISO);
  const changed = [];
  const pieces = [
    { text: `${subj} ${full?.text || ''}`, articleISO: '' },
    // 댓글은 그 배치표 글의 날 얘기다(배치표 글에 단 "3부 휴장합니다")
    ...((full?.comments || []).map((c) => ({ text: String((c && (c.content ?? c.text)) ?? c ?? ''), articleISO }))),
  ];
  for (const pc of pieces) {
    for (const h of detectClosure(pc.text, { postedISO, articleISO: pc.articleISO })) {
      const did = setPartClosed(h.iso, h.part, !h.open, { source, id: String(full?.id || ''), text: pc.text.slice(0, 80) });
      if (did) changed.push(h);
    }
  }
  return changed;
}
