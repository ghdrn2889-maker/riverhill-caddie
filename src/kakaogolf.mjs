// 카카오골프 여집합 엔진 — 사진을 안 보고 '그날 팀이 찬 티오프'를 알아낸다.
//
//  원리(사용자 설계): 리버힐은 티오프 매칭 시간이 항상 고정이다. 그 고정 시간표를 적어두면,
//   카카오골프에 뜨는 시간 = 아직 예약 안 참 / 안 뜨는 시간 = 예약이 차서 팀이 있음.
//   따라서  고정표 − 카카오예약가능 = 그날 팀이 찬 티오프 = 우리만의 배치표(티오프 부분).
//
//  ★사진 판독과 완전히 독립이다. 같은 사실을 서로 다른 경로로 구해 맞춰볼 수 있다는 게 요점 —
//   지금까지는 틀렸는지 알 방법이 사람 눈밖에 없었다.
//  비용 0(Claude 호출 없음), 인증 불필요. robots.txt가 이 경로를 허용하며 Crawl-delay 1을 지킨다.
//
//  한계(정직하게): 골프장이 전 물량을 카카오에 내놓지 않으면(회원·전화 보류분) 그 칸은
//   '안 뜸 = 찬 것'으로 잘못 읽힌다. 그래서 당분간 판독을 고치지 않고 대조만 한다.
import { loadJSON, appendJSONL, DATA_DIR } from './store.mjs';
import { ROOT_DIR } from './env.mjs';
import fs from 'node:fs';
import path from 'node:path';

// 기준표는 저장소 기본값(config/)을 쓰되, data/에 두면 그쪽이 이긴다 —
//  data/는 깃에 안 올라가므로(회원 개인정보 보호) 관리자가 서버에서 바로 고쳐 쓰는 자리다.
const SCHEDULE_FILE = 'riverhill-tee-schedule.json';
function loadSchedule() {
  const own = loadJSON(SCHEDULE_FILE, null);
  if (own && own.parts) return own;
  try { return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'config', SCHEDULE_FILE), 'utf8')); } catch { return null; }
}
const SNAP_DIR = path.join(DATA_DIR, 'kakao-board');
const API = 'https://www.kakao.golf/api/golf/booktime';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const kakaoOn = () => String(process.env.KAKAO_GOLF || '1') !== '0';

const toMin = (hhmm) => { const m = String(hhmm).match(/(\d{1,2}):?(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; };
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
export const toHM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const key = (mins, course) => `${toHM(mins)}|${course}`;

// ── 고정 시간표 → 칸 목록 ─────────────────────────────────────────────
//  이 표가 엔진의 기준이다. 틀리면 전부 틀리므로 관리자가 직접 고치는 파일로 둔다.
export function fixedSlots() {
  const cfg = loadSchedule();
  if (!cfg || !cfg.parts) return [];
  const cad = Number(cfg.cadence) || 7;
  const courses = Array.isArray(cfg.courses) && cfg.courses.length ? cfg.courses : ['OUT', 'IN'];
  const except = new Map((cfg.exceptions || []).map((e) => [toMin(e.time), e.courses || []]));
  const out = [];
  for (const [part, p] of Object.entries(cfg.parts)) {
    const a = toMin(p.first), b = toMin(p.last);
    if (a == null || b == null) continue;
    for (let t = a; t <= b; t += cad) {
      const cs = except.has(t) ? except.get(t) : courses;
      for (const c of cs) out.push({ part, mins: t, time: toHM(t), course: c });
    }
  }
  return out.sort((x, y) => x.mins - y.mins || x.course.localeCompare(y.course));
}

// ── 카카오골프: 그날 '아직 예약 가능한' 티오프 ────────────────────────
export async function fetchOpen(dateYYYYMMDD) {
  const cfg = loadSchedule() || {};
  const seq = Number(process.env.KAKAO_GOLF_SEQ || cfg.golfInfoSeq || 266);
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json',
      Origin: 'https://www.kakao.golf', Referer: `https://www.kakao.golf/golf/${seq}` },
    body: JSON.stringify({ golfInfoSeq: seq, date: String(dateYYYYMMDD), sigunguSeq: 0, weekType: 0 }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`카카오골프 HTTP ${res.status}`);
  const j = await res.json();
  return (j.list || []).map((x) => {
    const mins = toMin(String(x.bookTime).padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2'));
    return { mins, time: toHM(mins), course: String(x.CourseName || '').toUpperCase(), band: x.digitTime, fee: Number(x.greenFeeDP) || 0 };
  }).filter((x) => x.mins != null && x.course);
}

// ── 여집합 = 그날 팀이 찬 티오프 ──────────────────────────────────────
//  ★'안 뜬다 = 찼다'가 성립하려면 그 칸이 아직 팔리는 중이어야 한다. 아래 둘은 안 팔려서 사라진 게 아니다:
//   ①지난 시각 — 오늘 오전 티오프는 예약이 찼든 비었든 목록에 없다(실측 8/16: 1부 44칸이 전부 '찼음'으로 잘못 셈)
//   ②마감 임박 — 티오프 직전엔 판매를 닫는다
//   그래서 판단 가능한 칸만 센다. 배치표는 전날 저녁에 나오므로 '내일치'를 보면 전부 미래라 이 문제가 없다.
//  ★당일은 아예 판정하지 않는다(실측 8/16 16시: 18:03~18:45 칸이 한꺼번에 사라졌다 — 팔린 게 아니라
//   당일 판매를 닫은 것이다. 한 시간 전만 해도 판매중이었다). 마감선이 언제인지 아직 모르므로 추측하지 않는다.
//   본배치표는 전날 저녁에 나오니 '내일치'만 봐도 충분하다 — 아쉬울 게 없다.
//   KAKAO_TODAY=1 로 켜면 당일도 CUTOFF_MIN 기준으로 판정하되, 그 결과는 참고용이다.
const CUTOFF_MIN = Number(process.env.KAKAO_CUTOFF_MIN || 240);
const JUDGE_TODAY = String(process.env.KAKAO_TODAY || '0') === '1';

export async function bookedFor(dateYYYYMMDD) {
  const fixed = fixedSlots();
  if (!fixed.length) throw new Error(`고정 티오프 시간표(${SCHEDULE_FILE}) 없음 — 엔진의 기준표다`);
  const open = await fetchOpen(dateYYYYMMDD);
  const openSet = new Set(open.map((o) => key(o.mins, o.course)));
  // ★고정표에 없는데 카카오엔 뜨는 칸 = 우리 기준표가 틀렸다는 신호. 조용히 버리지 않고 남긴다.
  const fixedSet = new Set(fixed.map((f) => key(f.mins, f.course)));
  const unknown = open.filter((o) => !fixedSet.has(key(o.mins, o.course))).map((o) => key(o.mins, o.course));

  const now = new Date();
  const todayStr = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = String(dateYYYYMMDD) === todayStr;
  const isPast = String(dateYYYYMMDD) < todayStr;
  // 판단 가능한가 — 미래 날짜면 전부 가능, 지난 날짜와 당일은 불가(당일은 KAKAO_TODAY=1일 때만 참고용).
  const judgeable = (f) => (isPast ? false : (!isToday || (JUDGE_TODAY && f.mins > nowMin + CUTOFF_MIN)));

  // ★그날 아예 안 도는 코스 걸러내기 — 이게 이 엔진의 가장 큰 함정이다.
  //  실측: 8/18 3부는 OUT 10칸 열림·IN 0칸, 8/19는 OUT 0칸·IN 17칸. IN이 다 팔린 게 아니라 그날 안 돈다
  //  (야간은 한 코스만 도는 날이 있다). 모르고 지나가면 안 도는 코스 21칸이 통째로 '만석'이 된다.
  //  판정: 한 부에서 어떤 코스가 열린 칸 0인데 반대 코스는 넉넉히 열려 있으면 → 그 코스는 미운영.
  const idle = new Set();
  const partsOf = new Set(fixed.map((f) => f.part));
  for (const p of partsOf) {
    const cnt = {};
    for (const f of fixed) if (f.part === p) cnt[f.course] = (cnt[f.course] || 0) + (openSet.has(key(f.mins, f.course)) ? 1 : 0);
    const cs = Object.keys(cnt);
    if (cs.length < 2) continue;
    for (const c of cs) {
      const other = Math.max(...cs.filter((x) => x !== c).map((x) => cnt[x]));
      if (cnt[c] === 0 && other >= 3) idle.add(`${p}|${c}`);     // 반대 코스가 여유로운데 이쪽만 0 = 안 도는 것
    }
  }
  if (idle.size) console.log(`[카카오골프] ${dateYYYYMMDD} 미운영 코스: ${[...idle].map((k) => k.replace('|', '부 ')).join(', ')} — 만석 아님`);

  const booked = [], skipped = [];
  for (const f of fixed) {
    if (openSet.has(key(f.mins, f.course))) continue;            // 아직 팔리는 중 = 안 참
    if (idle.has(`${f.part}|${f.course}`)) { skipped.push(f); continue; }   // 그날 안 도는 코스 = 판단 대상 아님
    (judgeable(f) ? booked : skipped).push(f);                   // 안 뜸 → 찬 것. 단 판단 가능한 칸만.
  }
  const byPart = {};
  for (const b of booked) (byPart[b.part] ||= []).push({ time: b.time, mins: b.mins, course: b.course });
  return { date: String(dateYYYYMMDD), at: Date.now(), fixedCount: fixed.length,
    openCount: open.length, bookedCount: booked.length, byPart, unknown,
    skippedCount: skipped.length, judgeableFrom: isPast ? null : (isToday ? (JUDGE_TODAY ? toHM(nowMin + CUTOFF_MIN) : '판정안함(당일)') : '00:00'), cutoffMin: CUTOFF_MIN };
}

// ── 스냅샷 저장 — 시간에 따라 예약이 차는 과정을 남긴다(취소·추가 추적) ──
export function saveSnapshot(snap) {
  try {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    const f = path.join(SNAP_DIR, `${snap.date}.json`);
    const prev = (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } })();
    const hist = (prev?.history || []).slice(-47);
    hist.push({ at: snap.at, booked: snap.bookedCount, open: snap.openCount });
    fs.writeFileSync(f, JSON.stringify({ ...snap, history: hist }, null, 2));
  } catch (e) { console.error('[카카오골프] 스냅샷 저장 실패:', e.message); }
}
export function loadSnapshot(date) {
  try { return JSON.parse(fs.readFileSync(path.join(SNAP_DIR, `${date}.json`), 'utf8')); } catch { return null; }
}

// ── 스냅샷 사이의 변화 = 예약과 캔슬 ──────────────────────────────────
//  찼던 칸이 다시 판매중으로 돌아오면 그게 캔슬이다. 사람이 글로 알려주기 전에 우리가 먼저 안다.
//  (카페·카톡의 "IN 12:18분 이하늘님 캔슬" 같은 글과 짝을 맞추면 확정이 된다.)
export function diffSnapshots(prev, next) {
  const setOf = (s) => new Set(Object.values(s?.byPart || {}).flat().map((x) => key(x.mins, x.course)));
  const a = setOf(prev), b = setOf(next);
  return {
    booked: [...b].filter((k) => !a.has(k)).sort(),   // 새로 찬 칸
    freed: [...a].filter((k) => !b.has(k)).sort(),    // 다시 풀린 칸 = 캔슬
  };
}

// ── 예약 격자 + (있으면) 본배치표 이름 ────────────────────────────────
//  ★명단보다 예약이 먼저 확정된다. 그래서 격자를 먼저 세우고, 이름은 본배치표가 오면 그 자리에 얹는다.
//  배정 규칙은 실제 배치표에서 읽어낸 것: 시각 순, 같은 시각이면 OUT 먼저
//  (8/16 본배치 실측: 1번 16:25 OUT, 2번 16:25 IN, 3번 16:32 OUT …).
export function gridFor(snap, part = '3', { teeGrid = null, roster = null } = {}) {
  const slots = (snap.byPart?.[part] || []).slice()
    .sort((x, y) => x.mins - y.mins || (x.course === 'OUT' ? -1 : 1));
  // 본배치표가 있으면 '그 표가 말하는 순번'을 우선한다 — 추정보다 사실이 낫다.
  const byKey = new Map((teeGrid || []).map((r) => [key(toMin(r.time), String(r.course || '').toUpperCase()), Number(r.pos)]));
  const nameOf = (pos) => (pos > 0 && roster ? String(roster[pos - 1] || '').replace(/\(.*?\)/g, '').trim() : '');
  return slots.map((s, i) => {
    const k = key(s.mins, s.course);
    const posFromBoard = byKey.get(k) || 0;
    const pos = posFromBoard || (byKey.size ? 0 : i + 1);   // 본배치표가 있으면 추정 순번을 붙이지 않는다
    return { time: s.time, mins: s.mins, course: s.course, pos, name: nameOf(pos),
      fromBoard: !!posFromBoard, guess: !byKey.size };
  });
}

// ── 사진 판독과 대조(섀도우) ──────────────────────────────────────────
//  판독 경로는 건드리지 않는다. 같은 날짜의 두 결과를 나란히 놓고 차이만 기록한다.
//  ★어느 쪽이 옳은지 단정하지 않는다 — 그걸 정하는 게 이번 테스트 기간의 목적이다.
export function compareWithBoard(snap, teeGrid, part = '3') {
  const mine = (snap.byPart?.[part] || []).map((x) => key(x.mins, x.course));
  const mineSet = new Set(mine);
  const read = [], readSet = new Set();
  for (const r of (teeGrid || [])) {
    const m = toMin(r.time); const c = String(r.course || '').toUpperCase();
    if (m == null || !c) continue;
    read.push({ pos: r.pos, k: key(m, c) }); readSet.add(key(m, c));
  }
  return {
    part,
    kakaoOnly: mine.filter((k) => !readSet.has(k)),                    // 카카오는 '찼다'는데 배치표엔 없는 칸
    boardOnly: read.filter((r) => !mineSet.has(r.k)).map((r) => `${r.pos}번 ${r.k}`), // 배치표엔 있는데 카카오는 '비었다'는 칸
    agree: read.filter((r) => mineSet.has(r.k)).length,
    kakaoCount: mine.length, boardCount: read.length,
  };
}

// ── 주기 실행 ─────────────────────────────────────────────────────────
//  D..D+N일치를 훑는다. robots.txt Crawl-delay 1을 지켜 요청 사이에 1초 이상 쉰다.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function tick({ days = 3 } = {}) {
  if (!kakaoOn()) return;
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const date = ymd(d);
    try {
      const prev = loadSnapshot(date);
      const snap = await bookedFor(date);
      const dif = diffSnapshots(prev, snap);
      saveSnapshot(snap);
      // ★캔슬 감지 — 찼던 칸이 다시 판매중으로 돌아왔다. 사람이 글로 알리기 전에 우리가 먼저 본다.
      //  (카페·카톡의 "IN 12:18분 이하늘님 캔슬" 같은 글과 짝을 맞추면 확정이 된다.)
      if (prev && dif.freed.length) {
        console.warn(`⚠️ [카카오골프] ${date} 예약 취소로 보이는 칸 ${dif.freed.length}개: ${dif.freed.join(' ')}`);
      }
      if (prev && dif.booked.length && i <= 1) {
        console.log(`·  [카카오골프] ${date} 새로 찬 칸 ${dif.booked.length}개: ${dif.booked.slice(0, 8).join(' ')}`);
      }
      if (i <= 1) {
        const p3 = snap.byPart['3'] || [];
        console.log(`[카카오골프] ${date} 여집합 — 찬 티오프 ${snap.bookedCount}/${snap.fixedCount}칸`
          + ` (3부 ${p3.length}칸${p3.length ? `: ${p3.slice(0, 6).map((x) => `${x.time}${x.course}`).join(' ')}${p3.length > 6 ? '…' : ''}` : ''})`
          + (snap.unknown.length ? ` ★기준표 밖 ${snap.unknown.length}칸: ${snap.unknown.slice(0, 5).join(' ')}` : ''));
      }
      // 변화가 있을 때만 남긴다 — 몇 분마다 도는 루프라 매번 적으면 로그가 사실을 덮는다.
      if (!prev || dif.booked.length || dif.freed.length) {
        appendJSONL('kakao-golf.jsonl', { at: snap.at, date, booked: snap.bookedCount, open: snap.openCount,
          fixed: snap.fixedCount, p3: (snap.byPart['3'] || []).length,
          newBooked: dif.booked, freed: dif.freed, unknown: snap.unknown });
      }
    } catch (e) { console.error(`[카카오골프] ${date} 조회 실패:`, e.message); }
    await sleep(1500);   // robots.txt Crawl-delay: 1 — 넉넉히 지킨다
  }
}
