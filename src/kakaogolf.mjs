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
import { loadJSON, saveJSON, appendJSONL, DATA_DIR } from './store.mjs';
import { dayFrameParts, reframeSlots } from './dayframe.mjs';
import { ROOT_DIR } from './env.mjs';
import { raiseBoardIssue } from './boardalert.mjs';
import fs from 'node:fs';
import path from 'node:path';

// 기준표는 저장소 기본값(config/)을 쓰되, data/에 두면 그쪽이 이긴다 —
//  data/는 깃에 안 올라가므로(회원 개인정보 보호) 관리자가 서버에서 바로 고쳐 쓰는 자리다.
//  ★그래서 위험하다: data/ 사본이 낡으면 config/를 아무리 고쳐도 반영이 안 되는데 아무 표시가 없다.
//   실제로 그랬다(2026-08-16) — config/에서 잘못된 예외 3칸을 지웠는데 data/의 옛 사본이 계속 이겨서
//   16:25 OUT·16:32 OUT·11:50 IN 세 칸이 엔진 시야에서 통째로 빠져 있었다. 셋 다 실제로 팀이 차는 칸이다.
//   조용히 이기지 못하게, 덮어쓸 때는 반드시 부팅 로그에 남긴다.
const SCHEDULE_FILE = 'riverhill-tee-schedule.json';
let schedWarned = false;
function loadSchedule() {
  const own = loadJSON(SCHEDULE_FILE, null);
  if (own && own.parts) {
    if (!schedWarned) {
      schedWarned = true;
      const ex = Array.isArray(own.exceptions) ? own.exceptions.length : 0;
      console.warn(`⚠️ [카카오골프] 기준표를 data/${SCHEDULE_FILE}로 덮어씁니다(config/ 무시). 예외 ${ex}칸 — 낡았으면 지우세요.`);
    }
    return own;
  }
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

// ── 기본틀 밖의 '늘렸다 줄였다' 하는 칸 ────────────────────────────────
//  예약팀장 공식(2026-08-17): 1부는 더운 날 06:16을 열고 08:50을 빼며, 3부는 빠른 시간 수요가 많으면 앞으로 연다.
//  ★이 칸들은 여집합에 넣지 않는다 — 안 뜬다고 찼다고 볼 근거가 없다(원래 그날 없는 칸일 수 있다).
//   그래서 기준표(parts)에서 빼고 여기 따로 적는다. 카카오에 뜨면 '그날 틀이 늘었다'는 신호로 읽는다.
function expand(list) {
  const cfg = loadSchedule();
  const courses = Array.isArray(cfg?.courses) && cfg.courses.length ? cfg.courses : ['OUT', 'IN'];
  const out = [];
  for (const f of (Array.isArray(list) ? list : [])) {
    const m = toMin(f.time);
    if (m == null) continue;
    for (const c of courses) out.push({ part: String(f.part || ''), mins: m, time: toHM(m), course: c, why: f.why || '', drops: f.drops || '' });
  }
  return out;
}
export const flexSlots = () => expand(loadSchedule()?.flex);
// 기본틀 '안'이지만 기본으로 비워두는 칸 — 각 부의 맨 앞. 안 쓰는 날 판매에서 내려가는데
//  그게 '예약이 찼다'와 똑같이 보인다(8/18 06:23 실증: 없는 팀 2개를 만들었다).
export const holdSlots = () => expand(loadSchedule()?.hold);

// ── 카카오골프: 그날 '아직 예약 가능한' 티오프 ────────────────────────
//  ★우리가 만든 통로가 아니다. 저쪽이 주소나 응답 형태를 바꾸면 끊긴다.
//   그런데 진짜 위험은 '에러'가 아니라 '조용한 거짓말'이다 —
//   200 OK에 빈 목록이 오면 이 엔진은 "124칸 전부 예약 참"이라고 결론낸다. 그게 최악이다.
//   그래서 값을 받는 즉시 형태를 검사하고, 이상하면 숫자를 만들지 않고 던진다.
//   자주 두드리는 건 대비가 아니다. 검사가 대비다.
const HEALTH_FILE = 'kakao-health.json';
function health(patch) {
  const h = loadJSON(HEALTH_FILE, { ok: 0, fail: 0, streak: 0 }) || {};
  const next = { ...h, ...patch, at: Date.now() };
  saveJSON(HEALTH_FILE, next);
  return next;
}
export const kakaoHealth = () => loadJSON(HEALTH_FILE, null);

export class KakaoShapeError extends Error {}

export async function fetchOpen(dateYYYYMMDD) {
  const cfg = loadSchedule() || {};
  const seq = Number(process.env.KAKAO_GOLF_SEQ || cfg.golfInfoSeq || 266);
  let j;
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json',
        Origin: 'https://www.kakao.golf', Referer: `https://www.kakao.golf/golf/${seq}` },
      body: JSON.stringify({ golfInfoSeq: seq, date: String(dateYYYYMMDD), sigunguSeq: 0, weekType: 0 }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    j = await res.json();
  } catch (e) {
    const h = health({ fail: (loadJSON(HEALTH_FILE, {})?.fail || 0) + 1, streak: (loadJSON(HEALTH_FILE, {})?.streak || 0) + 1, lastErr: e.message });
    throw new Error(`카카오골프 조회 실패(${e.message}, 연속 ${h.streak}회)`);
  }
  // ★형태 검사 — 우리가 아는 모양이 아니면 숫자를 만들지 않는다.
  if (!j || typeof j !== 'object' || !Array.isArray(j.list)) {
    health({ streak: (loadJSON(HEALTH_FILE, {})?.streak || 0) + 1, lastErr: 'list 배열 없음' });
    throw new KakaoShapeError('카카오골프 응답에 list 배열이 없음 — 형식이 바뀌었을 수 있음');
  }
  const rows = j.list;
  if (rows.length) {
    const s = rows[0];
    const missing = ['bookTime', 'CourseName'].filter((k) => s[k] == null);
    if (missing.length) {
      health({ streak: (loadJSON(HEALTH_FILE, {})?.streak || 0) + 1, lastErr: `필드 없음: ${missing.join(',')}` });
      throw new KakaoShapeError(`카카오골프 응답에 ${missing.join('·')} 없음 — 필드 이름이 바뀌었을 수 있음`);
    }
  }
  const out = rows.map((x) => {
    const mins = toMin(String(x.bookTime).padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2'));
    return { mins, time: toHM(mins), course: String(x.CourseName || '').toUpperCase(), band: x.digitTime, fee: Number(x.greenFeeDP) || 0 };
  }).filter((x) => x.mins != null && x.course);
  // 목록은 왔는데 우리가 쓸 수 있는 줄이 하나도 안 남았다 = 값의 모양이 바뀌었다는 뜻.
  if (rows.length && !out.length) {
    health({ streak: (loadJSON(HEALTH_FILE, {})?.streak || 0) + 1, lastErr: '시각·코스 해석 실패' });
    throw new KakaoShapeError(`카카오골프 ${rows.length}건을 받았지만 시각·코스를 하나도 못 읽음 — 값 형식이 바뀌었을 수 있음`);
  }
  health({ ok: (loadJSON(HEALTH_FILE, {})?.ok || 0) + 1, streak: 0, lastOk: Date.now(), lastCount: out.length });
  return out;
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
//  ★2026-08-17 방침 변경: 당일을 통째로 버리지 않는다. 지나간 칸만 못 세는 것이지,
//   앞으로 남은 칸이 판매중에서 사라지는 건 당일에도 진짜 예약(당추) 신호다.
//   위험한 건 '판매 마감선'뿐이므로, 마감선 바깥(CUTOFF_MIN보다 먼 미래)만 센다.
//   그리고 마감선을 추측만 하지 않고 실제로 잰다 — 아래 noteCloseLead()가 사라진 칸의
//   '티오프까지 남은 시간'을 남기므로, 며칠이면 진짜 마감선이 데이터로 나온다.
//   (관측 8/16 16:00 — 18:03~18:45 칸이 한꺼번에 사라짐 = 티오프 123분 전. 그래서 240분은 바깥.)
//  ★가르는 건 시간이 아니라 '모양'이다.
//   한 칸만 사라졌다 = 그 한 팀이 예약된 것(당추). 즉시 반영해야 하는 진짜 신호다.
//   여러 칸이 한꺼번에 사라졌다 = 그 시간대 판매를 닫은 것. 이건 예약이 아니다.
//   시간으로 뭉뚱그려 끊으면(예: 4시간 전부터 무시) 방금 예약된 12:39 같은 칸까지 같이 버린다.
//   마감선은 추측하지 않고 관측해서 쓴다 — 뭉텅이 사라짐을 볼 때마다 그때의 '남은 시간'을
//   기록해 그 바깥만 판정한다.
//  ★단, '모양'만으로는 못 잡는 마감이 하나 있다(사용자 관측 2026-08-17): 티오프 1시간 전 판매 중단.
//   이건 뭉텅이가 아니라 시계를 따라 한 칸씩 차례로 내려간다. 7분 간격·두 코스에 관측이 5분마다면
//   한 틱에 한두 칸 — CLOSE_BULK(4)에 영영 안 걸리고 전부 '당일 예약'으로 샌다.
//   그래서 SALE_CLOSE_LEAD(기본 60분)를 바닥선으로 깔았다. 관측으로 더 큰 마감선을 배우면 그쪽이 이긴다.
const CLOSE_BULK = Number(process.env.KAKAO_CLOSE_BULK || 4);   // 이 개수 이상 한 번에 사라지면 판매 마감
const PULL_BULK = Number(process.env.KAKAO_PULL_BULK || 4);     // 한 부에서 이 개수 이상 한꺼번에 내려가면 철수(캐디 부족)
const MIN_LEAD = Number(process.env.KAKAO_MIN_LEAD || 0);       // 최소 안전선(분) — 기본 없음
const JUDGE_TODAY = String(process.env.KAKAO_TODAY || '1') === '1';
// ★판매 마감선(사용자 관측 2026-08-17): 카카오골프는 티오프 약 1시간 전이면 그 칸을 판매에서 내린다.
//  팀이 차서 사라지는 게 아니라 '이제 못 판다'고 내리는 것이다 — 실제로는 빈 칸일 수 있다.
//  뭉텅이 감지(CLOSE_BULK)로는 절대 못 잡는다: 티오프 간격 7분·두 코스에 관측이 5분마다면
//  한 틱에 한두 칸씩만 차례로 내려간다. 4칸 기준에 영영 안 걸리므로 전부 '당일 예약'으로 샌다.
//  그래서 관측으로 배우는 마감선(closeLead)과 별개로 '최소 마감선'을 바닥에 깐다.
//  ★값은 추측이 아니라 실측이다. 8/17 하루치 kakao-close.jsonl 26건이 두 무리로 깨끗이 갈렸다:
//    56~60분 전  8건 — 전부 같은 시각 IN+OUT이 동시에 소멸(한 팀이 두 코스를 동시에 잡을 수는 없다 = 마감)
//    78분 전 이상 18건 — 전부 한쪽 코스만 소멸(= 진짜 예약)
//    61~77분 전  0건 — 빈 구간
//   그 빈 구간 한가운데인 70을 쓴다. 5분 틱의 관측 흔들림(±5분)을 흡수하면서 진짜 예약은 하나도 안 버린다.
const SALE_CLOSE_LEAD = Number(process.env.KAKAO_SALE_CLOSE_LEAD || 70);

// ── 카카오가 아예 안 파는 칸 ────────────────────────────────────────────
//  ★이 엔진의 진짜 급소다. 골프장은 각 부 앞쪽 칸을 카카오에 안 내놓는다(전화·회원·단체 배정분).
//   그 칸은 팀이 있든 없든 영원히 '판매중'으로 안 뜬다 → 여집합이 늘 '찼다'로 읽는다.
//   실측(8개 날짜·관측 560회 통합): 3부 16:25·16:32·16:39는 한 번도 판매중이 아니었다.
//   사용자가 지적한 1부 06:16도 같은 부류 — 카카오가 파는 가장 이른 1부 시각은 06:23이다.
//
//  ★날짜 하나만 보면 못 가른다 — 관측을 늦게 시작하면 '이미 팔린 칸'도 똑같이 안 보인다.
//   전 날짜를 합쳐야 갈린다. 사흘 뒤 날짜는 아직 텅 비어 있으므로, 거기서도 안 뜨면 안 파는 칸이다.
//
//  ★그리고 함부로 단정하지 않는다. 그 부·코스의 판매 패턴을 충분히 봤을 때만 판단한다 —
//   패턴을 모르는 채로 '안 판다'고 우기면 그 부의 팀이 통째로 사라진다(미운영 오판과 같은 함정).
//  ★2026-08-17 저녁, 예약팀장(박가람) 공식 답변으로 이 추론의 전제가 깨졌다 — 그래서 기본으로 끈다.
//   팀장: "3부도 빠른 시간을 찾는 사람이 더 많으면 2부 팀 수에 따라 더 앞으로 여는 거고요."
//   즉 앞 칸은 안 파는 게 아니라 '제일 인기라 순식간에 팔린다'. 우리가 못 본 건 미판매가 아니라 완판이다.
//   실제로 8/18 배치표에 16:32 OUT·17:00 OUT 팀이 있었는데 이 규칙이 둘을 '모른다'로 지웠다(맞은 판정을 버렸다).
//   진짜 사각지대(기본틀 밖의 늘었다 줄었다 하는 칸)는 이제 기준표의 flex로 따로 다룬다 — 추론이 아니라 사실로.
//   ★기록은 계속한다. 며칠 더 쌓여서 '정말 한 번도 안 파는 칸'이 남으면 그때 KAKAO_BLIND=1로 되살린다.
const SELLABLE_FILE = 'kakao-sellable.json';        // { "06:23|OUT": ["20260819", ...] } 판매중으로 본 날짜들
const SELL_MATURE = Number(process.env.KAKAO_SELL_MATURE || 8);   // 이만큼의 시각을 팔아본 부·코스만 판단
const BLIND_ON = ['1', 'true', 'yes'].includes(String(process.env.KAKAO_BLIND || '').toLowerCase());
export const loadSellable = () => loadJSON(SELLABLE_FILE, {}) || {};

// 순수 함수로 뺀다 — 이 판단이 틀리면 팀이 통째로 생기거나 사라지므로 파일 없이 시험할 수 있어야 한다.
export function blindSlots(sell, fixed, mature = SELL_MATURE) {
  const soldTimes = {};
  for (const f of fixed) if ((sell[`${f.time}|${f.course}`] || []).length) (soldTimes[`${f.part}|${f.course}`] ||= new Set()).add(f.time);
  const blind = new Set();
  for (const f of fixed) {
    if ((soldTimes[`${f.part}|${f.course}`]?.size || 0) < mature) continue;   // 패턴을 아직 모른다 → 판단 보류
    if (!(sell[`${f.time}|${f.course}`] || []).length) blind.add(`${f.time}|${f.course}`);
  }
  return blind;
}

export async function bookedFor(dateYYYYMMDD, prevSnap = null) {
  // 이전 스냅샷의 '열린 적 있음' 기록을 이어받는다 — 완판과 미운영을 가르는 유일한 근거다.
  if (!prevSnap) prevSnap = loadSnapshot(String(dateYYYYMMDD));
  const base = fixedSlots();
  if (!base.length) throw new Error(`고정 티오프 시간표(${SCHEDULE_FILE}) 없음 — 엔진의 기준표다`);
  const open = await fetchOpen(dateYYYYMMDD);
  const openSet = new Set(open.map((o) => key(o.mins, o.course)));

  // ── 그날의 '틀'을 정한다 — 기본틀은 고정이 아니라 예약팀이 앞뒤로 늘리고 줄인다 ──────────
  //  ★비워두는 칸(hold·flex): 판정하지 않는다. 안 뜬다고 찼다고 볼 근거가 없기 때문이다.
  //   그 부의 맨 앞 칸은 예약팀이 그날 안 쓰기로 하면 판매에서 내려가는데,
  //   그게 '예약이 찼다'와 응답에서 똑같이 보인다 → 없는 팀이 생긴다(8/18 06:23, 실증).
  //   비어 있는 건 사람이 채우면 정답이 되지만, 없는 팀은 아무도 못 지운다. 그래서 비우는 쪽을 고른다.
  //  ★되살아나는 법: 그 날짜에 카카오가 그 칸을 한 번이라도 '판매중'으로 보여주면
  //   = 예약팀이 그날 그 칸을 쓴다는 뜻이다. 그때부터 그 날짜의 틀에 편입해 정상 판정한다.
  //   그 뒤 사라지면 진짜 예약이다. D+6까지 미리 보고 있으니 대개 제때 잡힌다(사용자 설계).
  const flexAll = flexSlots();
  const heldSet = new Set([...holdSlots(), ...flexAll].map((f) => key(f.mins, f.course)));
  const frameExtra = new Set(prevSnap?.frameExtra || []);
  for (const o of open) { const k = key(o.mins, o.course); if (heldSet.has(k)) frameExtra.add(k); }
  const inFrame = (f) => { const k = key(f.mins, f.course); return !heldSet.has(k) || frameExtra.has(k); };
  // ★관리자의 하루치 운영 선언이 마지막에 온다 — 아침에 이미 아는 사실을 저녁까지 추론하지 않는다.
  //  선언이 없으면 이 줄은 아무 일도 하지 않는다(기존 경로 그대로).
  const _cfg = loadSchedule() || {};
  const framed = reframeSlots([...base, ...flexAll].filter(inFrame), {
    cadence: Number(_cfg.cadence) || 7, courses: _cfg.courses, frame: dayFrameParts(dateYYYYMMDD),
  });
  const fixed = framed.slots;
  if (framed.added.length || framed.dropped.length) {
    console.log(`[카카오골프] ${dateYYYYMMDD} 운영 선언 — 칸 +${framed.added.length}·−${framed.dropped.length}`
      + ` (${framed.declared.map((p) => p + '부').join('·')})`);
  }
  const heldNow = [...heldSet].filter((k) => !frameExtra.has(k)).sort();   // 오늘 비워둔 칸
  // ★가장 위험한 경우 — 응답은 멀쩡한데 목록이 비었다. 그대로 두면 "그날 전 칸 만석"이 된다.
  //  먼 날짜(예약 오픈 전)는 정말 0일 수 있으니, 가까운 날짜에서만 의심한다.
  //  그리고 예전에 열려 있던 걸 본 적이 있으면 하루아침에 0이 될 수 없다 — 그건 고장이다.
  const dayGap = Math.round((new Date(`${String(dateYYYYMMDD).slice(0, 4)}-${String(dateYYYYMMDD).slice(4, 6)}-${String(dateYYYYMMDD).slice(6, 8)}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
  // ★기본틀에 없는데 카카오엔 뜨는 칸. 두 가지가 섞여 있어 갈라 놓는다:
  //   ①flex — 예약팀이 늘렸다 줄였다 하는 칸(06:16·16:25). 뜨면 '그날 틀이 늘었다'는 신호다. 정상.
  //   ②그 밖 — 우리 기준표가 틀렸다는 신호. 조용히 버리지 않고 남긴다.
  const fixedSet = new Set(fixed.map((f) => key(f.mins, f.course)));
  const unknown = open.filter((o) => !fixedSet.has(key(o.mins, o.course))).map((o) => key(o.mins, o.course));
  // 비워뒀다가 이번에 살아난 칸 = 예약팀이 그날 틀을 늘렸다는 신호.
  const flexOpen = [...frameExtra].filter((k) => !(prevSnap?.frameExtra || []).includes(k)).sort();

  const now = new Date();
  const todayStr = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = String(dateYYYYMMDD) === todayStr;
  const isPast = String(dateYYYYMMDD) < todayStr;
  const lastFixed = Math.max(...fixed.map((f) => f.mins));
  // ★가장 위험한 경우 — 응답은 멀쩡한데 목록이 비었다. 그대로 두면 "그날 전 칸 만석"이 된다.
  //  먼 날짜(예약 오픈 전)는 정말 0일 수 있으니, 가까운 날짜에서만 의심한다.
  //  그리고 예전에 열려 있던 걸 본 적이 있으면 하루아침에 0이 될 수 없다 — 그건 고장이다.
  //  ★단, 그날 하루가 끝나가면 0칸은 정상이다. 마지막 티오프까지 마감선 안쪽이면 팔 게 남아 있을 수 없다.
  //   이 예외가 없으면 매일 저녁 오늘치 관측이 통째로 멈춘다(실제로 8/17 17:40에 얼어붙었다) —
  //   고장 감지기가 오늘 데이터를 낡은 채로 붙잡아두는, 감지기가 사고를 만드는 모양이 된다.
  //  ★검사는 다른 계산보다 먼저 한다 — 고장난 응답으로 마감선을 배우거나 로그를 더럽히면 안 된다.
  const dayOver = isPast || (isToday && nowMin + Math.max(Number(prevSnap?.closeLead || 0), MIN_LEAD, SALE_CLOSE_LEAD) >= lastFixed);
  if (!open.length && !dayOver && dayGap >= 0 && dayGap <= 3 && Number(prevSnap?.everOpenCount || 0) > 0) {
    throw new KakaoShapeError(`카카오골프 ${dateYYYYMMDD} 판매중 0칸 — 직전엔 ${prevSnap.everOpenCount}칸 있었다. 만석보다 고장을 의심(전 칸 만석 처리 금지)`);
  }

  // ── 이번 틱에 판매중에서 사라진 칸 ──────────────────────────────────────
  //  한 칸씩 사라지면 예약, 뭉텅이로 사라지면 판매 마감. 마감이면 그때의 '남은 시간'을 마감선으로 배운다.
  const prevOpen = new Set(prevSnap?.openKeys || []);
  const goneNow = fixed.filter((f) => prevOpen.has(key(f.mins, f.course)) && !openSet.has(key(f.mins, f.course)) && (!isToday || f.mins > nowMin));
  // ── ★캐디가 동나서 내려간 칸(철수) — 예약이 아니다 ──────────────────────
  //  골프장은 팔 수 있는 시각을 넉넉히 던져놓고, 그날 나온 캐디 수만큼 팀이 차면 남은 칸을 내린다.
  //  여집합 엔진에는 이것도 그냥 '사라짐'이라 예약과 구분이 안 된다 — 8/18 1부 07:01에 24칸이
  //  한꺼번에 내려갔고, 그중 마감선 밖 12칸이 예약으로 잡혀 배치표 3팀이 카카오 15팀이 됐다.
  //  ★가르는 건 '한 부 안에서 한꺼번에'다. 실측 40건: 예약은 한 틱에 1~2칸(38건)이고, 4칸짜리
  //   사건 하나는 부가 섞인 우연이었다(2부 2칸 마감 + 3부 2칸). 철수만 한 부에서 24칸이었다.
  //   그래서 전체가 아니라 부별로 센다 — 그래야 문턱을 4로 낮춰도 우연한 겹침에 안 걸린다.
  //  판정은 그날 내내 유지한다(원웨이와 같은 이유 — 안 그러면 다음 틱에 또 예약으로 굳는다).
  //  뒤집는 사실은 하나뿐: 그 칸이 다시 판매중이 되는 것.
  const pulled = new Set(prevSnap?.pulledKeys || []);
  for (const k of [...pulled]) if (openSet.has(k)) pulled.delete(k);   // 다시 팔린다 = 철수가 아니었다
  const pulledNow = new Set();
  {
    const goneByPart = {};
    for (const f of goneNow) (goneByPart[f.part] ||= []).push(f);
    for (const [p, arr] of Object.entries(goneByPart)) {
      if (arr.length < PULL_BULK) continue;
      for (const f of arr) { pulled.add(key(f.mins, f.course)); pulledNow.add(key(f.mins, f.course)); }
      console.warn(`[카카오골프] ${dateYYYYMMDD} ${p}부 ${arr.length}칸이 한 번에 내려감 — 예약이 아니라 철수로 봅니다(캐디 수만큼만 팀을 받는다): ${arr.map((f) => key(f.mins, f.course)).join(' ')}`);
    }
  }

  // ★마감선 학습에는 '철수로 설명된 사라짐'을 넣지 않는다.
  //  마감선 학습기는 뭉텅이 사라짐을 전부 '판매 마감'으로 읽고 그때의 남은 시간을 마감선으로 삼는다.
  //  철수까지 삼키면 엉뚱하게 큰 마감선을 배우고(실측: 516분), 그 뒤 하루 종일 아무것도 판정하지 못한다.
  //  둘은 뜻이 정반대다 — 마감은 티오프가 임박해서, 철수는 캐디가 없어서 내린다.
  const goneForClose = goneNow.filter((f) => !pulledNow.has(key(f.mins, f.course)));
  let closeLead = Number(prevSnap?.closeLead || 0);
  if (isToday && goneForClose.length >= CLOSE_BULK) {
    const lead = Math.min(...goneForClose.map((f) => f.mins)) - nowMin;
    if (lead > closeLead) {
      closeLead = lead;
      console.warn(`[카카오골프] ${dateYYYYMMDD} 판매 마감으로 봅니다 — ${goneForClose.length}칸이 한꺼번에 사라짐(티오프 ${lead}분 전). 이 안쪽은 판정하지 않습니다.`);
    }
  } else if (isToday && goneForClose.length) {
    const ld = Math.max(closeLead, MIN_LEAD, SALE_CLOSE_LEAD);
    for (const f of goneForClose) {
      const gl = f.mins - nowMin;
      if (gl <= ld) console.log(`[카카오골프] ${dateYYYYMMDD} ${f.time} ${f.course} 판매 마감(티오프 ${gl}분 전) — 예약으로 세지 않음`);
      else console.log(`[카카오골프] ${dateYYYYMMDD} ${f.time} ${f.course} 예약됨(당일) — 티오프 ${gl}분 전`);
    }
  }

  if (isToday && goneNow.length) {
    try {
      appendJSONL('kakao-close.jsonl', { at: Date.now(), date: String(dateYYYYMMDD), n: goneNow.length,
        bulk: goneNow.length >= CLOSE_BULK, leads: goneNow.map((f) => f.mins - nowMin),
        slots: goneNow.map((f) => key(f.mins, f.course)) });
    } catch { /* 기록 실패가 판정을 막지는 않는다 */ }
  }
  const lead = Math.max(closeLead, MIN_LEAD, SALE_CLOSE_LEAD);
  // 판단 가능한가 — 지난 날짜는 불가. 당일은 '지나간 칸'과 '마감선 안쪽'만 빼고 판정한다.
  const judgeable = (f) => (isPast ? false : (!isToday || (JUDGE_TODAY && f.mins > nowMin + lead)));

  // ★'그날 안 도는 코스'와 '다 팔린 코스'를 가려낸다 — 이게 이 엔진의 가장 큰 함정이다.
  //  둘 다 판매중 0칸으로 똑같이 보이지만 뜻은 정반대다:
  //   · 안 도는 코스(8/18 3부 IN, 8/19 3부 OUT — 야간은 한 코스만 도는 날이 있다) → 팀 0
  //   · 다 팔린 코스(8/17 1부 OUT 44칸 완판) → 팀 만석
  //  처음엔 '반대 코스가 여유로운데 이쪽만 0'을 미운영으로 봤다. 틀렸다 — 완판도 똑같이 0이라,
  //  8/17에 멀쩡한 1부 OUT 22칸이 통째로 판단에서 빠졌다(사용자가 06:44 OUT으로 잡아냄).
  //
  //  ★가르는 건 '역사'다. 한 번이라도 팔린 적(=열린 적) 있으면 그 코스는 돈다. 그 뒤의 0은 완판이다.
  //  안 도는 코스는 처음 볼 때부터 끝까지 0이다. 그래서 며칠 앞부터 봐두면 저절로 갈린다.
  const ever = (prevSnap?.everOpen && typeof prevSnap.everOpen === 'object') ? { ...prevSnap.everOpen } : {};
  const seenCount = Number(prevSnap?.seenCount || 0) + 1;
  const partsOf = new Set(fixed.map((f) => f.part));
  for (const f of fixed) if (openSet.has(key(f.mins, f.course))) ever[`${f.part}|${f.course}`] = true;
  // ★칸 하나하나에 대해 '판매중인 걸 본 적이 있는가'를 남긴다.
  //  이 엔진의 급소: 골프장이 그날 티오프 자체를 없애면(팀이 안 차면 첫 칸 16:25를 지우는 식)
  //  그 칸은 영원히 판매중으로 안 뜬다 → 여집합 계산이 '찼다'로 읽는다. 실제로는 팀이 없는데.
  //  한 번이라도 판매중인 걸 봤으면 그 칸은 팔 수 있는 칸이고, 그 뒤의 사라짐은 진짜 예약이다.
  const everOpenKeys = new Set(prevSnap?.everOpenKeys || []);
  for (const o of open) everOpenKeys.add(key(o.mins, o.course));

  // ── 전 날짜 통합 증거: 이 칸을 '판매중'으로 본 날짜들 ──────────────────
  //  날짜 하나로는 못 가른다(관측을 늦게 시작하면 이미 팔린 칸도 안 보인다). 합쳐야 갈린다.
  const sell = loadSellable();
  let sellDirty = false;
  for (const o of open) {
    const k = key(o.mins, o.course);
    const arr = (sell[k] ||= []);
    if (!arr.includes(String(dateYYYYMMDD))) { arr.push(String(dateYYYYMMDD)); if (arr.length > 40) arr.shift(); sellDirty = true; }
  }
  if (sellDirty) { try { saveJSON(SELLABLE_FILE, sell); } catch (e) { console.error('[카카오골프] 판매이력 저장 실패:', e.message); } }

  // 그 부·코스의 판매 패턴을 충분히 봤는가 — 봤을 때만 '안 파는 칸'을 판단한다.
  //  ★기본은 '세기만' 한다(BLIND_ON=false). 위 주석 참조 — 앞 칸은 안 파는 게 아니라 빨리 팔린다.
  const blindSeen = blindSlots(sell, fixed);
  const blind = BLIND_ON ? blindSeen : new Set();

  //  ★'안 도는 코스' 판정은 그날 내내 유지한다(찼다고 본 칸과 같은 원리).
  //   근거인 '반대 코스가 몇 칸 팔리는 중인가'는 하루가 저물면 저절로 0이 된다. 그 순간 미운영 판정이
  //   풀리고, 안 도는 코스 전체가 한꺼번에 '찼다'로 굳었다 — 8/18 원웨이 실사고(OUT 한 코스만 운영):
  //   3부 IN 24칸이 통째로 허위 팀이 되어 배치표 13팀이 카카오 39팀으로 부풀었다.
  //   원웨이는 하루 단위 결정이라 중간에 안 바뀐다. 뒤집는 사실은 하나뿐 — 그 코스가 실제로 팔리는 것이고,
  //   그러면 ever가 참이 되어 아래에서 저절로 풀린다.
  const idle = new Set(), unsure = new Set();
  // ★선언으로 굳은 판정은 선언을 거두면 같이 풀린다 — 안 그러면 잘못 누른 버튼을 되돌릴 방법이 없다
  //  (한 번 미운영이 되면 그날 내내 유지되는 게 기본 규칙이라, 관측만으로는 절대 안 풀린다).
  const prevFrameIdle = new Set(prevSnap?.frameIdle || []);
  const nowFrameIdle = new Set(framed.idle);
  for (const ck of (prevSnap?.idle || [])) {
    if (ever[ck]) continue;
    if (prevFrameIdle.has(ck) && !nowFrameIdle.has(ck)) continue;
    idle.add(ck);
  }
  for (const p of partsOf) {
    const cnt = {};
    for (const f of fixed) if (f.part === p) cnt[f.course] = (cnt[f.course] || 0) + (openSet.has(key(f.mins, f.course)) ? 1 : 0);
    const cs = Object.keys(cnt);
    if (cs.length < 2) continue;
    for (const c of cs) {
      if (cnt[c] > 0) continue;                       // 팔리는 중 = 돈다
      if (ever[`${p}|${c}`]) continue;                // 예전에 열린 적 있다 = 돌고, 지금은 완판 → '참'으로 센다
      // ★근거는 '지금 몇 칸 팔리는 중인가'가 아니라 '오늘 몇 칸이 팔리는 걸 봤는가'다.
      //  현재 시점만 보면 저녁엔 반대 코스도 0칸이라(완판·마감) 근거가 사라지고, 그때 판정이 풀린다.
      //  오늘 본 것은 사라지지 않는다 — everOpenKeys가 그 기억이다.
      const other = Math.max(...cs.filter((x) => x !== c)
        .map((x) => fixed.filter((f) => f.part === p && f.course === x && everOpenKeys.has(key(f.mins, f.course))).length));
      if (other < 3) continue;                        // 반대 코스도 오늘 거의 안 팔렸으면 판단 근거 부족
      // 한 번도 열린 걸 못 봤다. 관측이 충분히 쌓였을 때만 미운영으로 보고, 아니면 판단을 미룬다.
      //  ★관측을 늦게 시작하면 '이미 완판된 코스'도 한 번도 안 열린 것처럼 보인다. 그때는 모른다고 하는 게 맞다 —
      //   미운영이라 우기면 그 부의 팀이 통째로 사라지고, 완판이라 우기면 없는 팀이 생긴다. 둘 다 나쁘다.
      //   5분마다 도는 관측이 며칠 앞 날짜부터 쌓이므로, 정작 필요한 시점엔 거의 항상 답이 있다.
      (seenCount >= 3 ? idle : unsure).add(`${p}|${c}`);
    }
  }
  // ★선언한 원웨이는 증거를 기다리지 않는다. 여집합이 스스로 배우는 데 반나절이 걸렸고,
  //  그 반나절 동안 3부 IN 24칸이 허위 팀이었다(8/18). 사람이 아는 사실은 즉시 반영한다.
  for (const ck of framed.idle) {
    idle.add(ck); unsure.delete(ck);
    if (ever[ck]) console.warn(`[카카오골프] ${dateYYYYMMDD} ${ck.replace('|', '부 ')} — 원웨이로 선언됐는데 실제로 판매된 적이 있습니다. 선언을 따르지만 확인해보세요.`);
  }
  if (framed.idle.length) console.log(`[카카오골프] ${dateYYYYMMDD} 원웨이 선언: ${framed.idle.map((k) => k.replace('|', '부 ')).join(', ')} — 관리자 선언(관측보다 우선)`);
  if (idle.size) console.log(`[카카오골프] ${dateYYYYMMDD} 미운영 코스: ${[...idle].map((k) => k.replace('|', '부 ')).join(', ')} — 만석 아님(한 번도 안 열림)`);
  if (unsure.size) console.warn(`[카카오골프] ${dateYYYYMMDD} 판단보류: ${[...unsure].map((k) => k.replace('|', '부 ')).join(', ')} — 완판인지 미운영인지 아직 모름(관측 1회차)`);

  // ★한 번 '찼다'고 본 칸은 시각이 지나도 유지한다.
  //  판정은 "지금 팔리는 중이 아니다"를 보는 것이라 시계가 앞으로 가면 판정 자격이 사라진다 —
  //  그래서 오후가 되면 오전 칸이 조용히 목록에서 빠졌다(실제로 16:25 IN/OUT이 17시에 사라져
  //  대조표 데이터가 섞인 것처럼 보였다). 사라진 게 아니라 '판정 대상에서 빠진' 것이었다.
  //  판정은 한 번만 하면 된다. 뒤집는 사실은 하나뿐 — 그 칸이 다시 판매중이 되는 것(=취소)이고,
  //  그건 아래에서 openSet이 알아서 걸러낸다.
  // ★선언으로 '범위를 늘려' 새로 생긴 칸 — 우리가 만든 칸이지 카카오가 파는 칸이 아니다.
  //  관리자가 말한 건 '그날 꼬리가 여기까지'이지 '거기 팀이 있다'가 아니다. 그런데 카카오 목록엔
  //  그 칸이 아예 없으니 영영 판매중으로 안 뜨고, 여집합이 그대로 '찼다'로 읽었다.
  //  실사고 8/19: 3부 last를 18:52로 선언한 17초 뒤 관측에서 18:52 OUT·IN이 통째로 허위 팀이 됐다
  //  (기준표 3부 끝은 18:45 — 18:52는 선언이 만들어낸 칸이다).
  //  ★'끼워넣기(extra)'는 다르다 — 그건 사람이 '여기 팀을 끼웠다'고 말한 것이라 찼다고 보는 게 맞다.
  //   그래서 inserted 표식이 있는 칸은 건드리지 않는다.
  //  ★영원히 모른다고 하지도 않는다 — 그 칸이 실제로 팔리는 걸 보면(오늘이든 지난 날짜든)
  //   카카오 재고에 있는 칸이므로 그때부터는 보통 칸으로 판정한다.
  const frameGrown = new Set(framed.added.filter((s) => !s.inserted).map((s) => key(s.mins, s.course)));
  const neverSold = (k) => !everOpenKeys.has(k) && !((sell[k] || []).length);
  const grownSkip = new Set([...frameGrown].filter(neverSold));
  if (grownSkip.size) console.log(`[카카오골프] ${dateYYYYMMDD} 선언으로 늘어난 칸 ${grownSkip.size}개 — 카카오가 판 적 없어 판정하지 않음(${[...grownSkip].join(', ')})`);

  const prevConfirmed = new Set(prevSnap?.confirmedKeys || []);
  const confirmed = new Set();
  const booked = [], skipped = [];
  for (const f of fixed) {
    const k = key(f.mins, f.course);
    const ck = `${f.part}|${f.course}`;
    if (openSet.has(k)) continue;                                          // 아직 팔리는 중 = 안 참(취소도 여기로 돌아온다)
    if (grownSkip.has(k)) { skipped.push(f); continue; }                    // 선언이 늘려 만든 칸 — 카카오에 없던 칸이라 못 판정
    if (blind.has(k)) { skipped.push(f); continue; }                        // 카카오가 안 파는 칸 — 찼는지 영영 모른다
    if (idle.has(ck) || unsure.has(ck)) { skipped.push(f); continue; }      // 안 도는 코스·판단보류
    if (pulled.has(k)) { skipped.push(f); continue; }                       // 캐디가 동나 내려간 칸 — 팀이 없다
    if (judgeable(f) || prevConfirmed.has(k)) { booked.push(f); confirmed.add(k); }
    else skipped.push(f);                                                  // 마감선 안쪽에서 처음 본 칸 — 예약인지 마감인지 모른다
  }
  const byPart = {};
  for (const b of booked) (byPart[b.part] ||= []).push({ time: b.time, mins: b.mins, course: b.course });
  // ★그 부에서 가장 많이 찼다고 본 순간을 따로 남긴다.
  //  byPart는 '지금 판정 가능한 칸'이라 시각이 지나면 줄어든다 — 오후에 보면 1·2부가 0칸이다.
  //  그래서 하루가 끝난 뒤 사람 경로와 맞대려면 이 최대치가 있어야 한다(없으면 '카카오가 못 봤다'로 오독된다).
  const peakByPart = { ...(prevSnap?.peakByPart || {}) };
  // ★안 도는 코스로 판정이 바뀌면, 최대치에 남아 있는 그 코스의 칸도 걷어낸다.
  //  최대치는 줄지 않는 값이라 걷어내지 않으면 이미 쌓인 허위 팀이 하루 종일 대조표에 남는다.
  for (const ck of idle) {
    const [p, c] = ck.split('|');
    if (Array.isArray(peakByPart[p])) peakByPart[p] = peakByPart[p].filter((x) => x.course !== c);
  }
  // 선언이 늘려 만든 칸도 걷어낸다 — 규칙이 생기기 전에 쌓인 허위 팀이 최대치에 그대로 남아 있다.
  for (const k of grownSkip) {
    const [t, c] = k.split('|');
    for (const p of Object.keys(peakByPart)) {
      if (Array.isArray(peakByPart[p])) peakByPart[p] = peakByPart[p].filter((x) => !(x.time === t && x.course === c));
    }
  }
  // 선언으로 틀에서 빠진 칸도 걷어낸다 — 최대치는 줄지 않는 값이라 두면 허위 팀이 하루 종일 남는다.
  for (const d of framed.dropped) {
    if (Array.isArray(peakByPart[d.part])) peakByPart[d.part] = peakByPart[d.part].filter((x) => !(x.time === d.time && x.course === d.course));
  }
  // 철수한 칸도 같은 이유로 걷어낸다(key가 곧 '시각|코스'라 그대로 대조된다).
  if (pulled.size) for (const p of Object.keys(peakByPart)) {
    if (Array.isArray(peakByPart[p])) peakByPart[p] = peakByPart[p].filter((x) => !pulled.has(`${x.time}|${x.course}`));
  }
  for (const [p, arr] of Object.entries(byPart)) {
    if (!peakByPart[p] || arr.length > peakByPart[p].length) peakByPart[p] = arr.map((x) => ({ time: x.time, course: x.course }));
  }
  return { date: String(dateYYYYMMDD), at: Date.now(), fixedCount: fixed.length,
    openCount: open.length, bookedCount: booked.length, byPart, peakByPart, unknown,
    frameExtra: [...frameExtra].sort(),             // 이 날짜에서 살아난(=예약팀이 쓰는) 비움 칸
    flexOpen,                                       // 이번 틱에 새로 살아난 칸 = 틀이 늘어난 순간
    held: heldNow,                                  // 지금 비워둔 칸 — 카카오가 판정하지 않는다(사람이 채운다)
    everOpen: ever, seenCount, idle: [...idle], unsure: [...unsure],
    dayFrame: dayFrameParts(dateYYYYMMDD),          // 그날의 운영 선언(관리자) — 대조판이 그대로 보여준다
    frameIdle: framed.idle,                          // 그중 원웨이로 안 도는 부·코스
    // ★판매중 목록을 남긴다 — 다음 틱에 '무엇이 사라졌는지'를 알아야 예약과 마감을 가른다.
    openKeys: open.map((o) => key(o.mins, o.course)),
    everOpenKeys: [...everOpenKeys],               // 이 날짜에서 한 번이라도 판매중인 걸 본 칸
    confirmedKeys: [...confirmed],                 // '찼다'고 확정한 칸 — 시각이 지나도 유지(취소되면 빠진다)
    pulledKeys: [...pulled].sort(),                // 캐디가 동나 내려간 칸 — 그날 내내 유지(다시 팔리면 빠진다)
    // ★'찼다'고 본 칸 중, 이 날짜에서 판매중인 걸 한 번도 못 본 것 — 관측을 늦게 시작해도 이렇게 보인다.
    //  그래서 이건 '경고'일 뿐 판정 근거가 아니다. 판정 근거는 아래 blind(전 날짜 통합)다.
    unverified: booked.filter((b) => !everOpenKeys.has(key(b.mins, b.course))).map((b) => key(b.mins, b.course)),
    // ★카카오가 아예 안 파는 칸 — 판정에 쓰는 것(blind)과, 판정엔 안 쓰고 세기만 하는 것(blindSeen)을 나눈다.
    //  전제가 흔들려서 지금은 세기만 한다(KAKAO_BLIND=1이면 판정에도 쓴다).
    blind: [...blind].sort(),
    blindSeen: [...blindSeen].sort(),
    blindOn: BLIND_ON,
    grownSkipped: [...grownSkip],                    // 선언이 늘려 만들어 판정에서 뺀 칸(계측을 가르는 근거)
    closeLead,                                     // 관측으로 배운 판매 마감선(분). 안 봤으면 0.
    everOpenCount: Math.max(Number(prevSnap?.everOpenCount || 0), open.length),   // 이 날짜에서 본 최대 판매중 칸 수(고장 감지용)
    skippedCount: skipped.length,
    judgeableFrom: isPast ? null : (isToday ? (JUDGE_TODAY ? toHM(Math.min(nowMin + lead, 1439)) : '판정안함(당일)') : '00:00'),
    cutoffMin: lead };
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

// from..days-1 일치를 훑는다. 가까운 날은 자주, 먼 날은 드물게 부르기 위해 시작점을 받는다.
//  ★먼 날부터 봐둬야 '한 번이라도 판매중인 걸 봤는가'가 쌓인다. 하루 전에야 처음 보면
//   이미 팔린 칸과 골프장이 지운 칸이 똑같이 '한 번도 안 열림'으로 보인다(실측: 8/17을 8/16 저녁에 처음 봤다).
export async function tick({ days = 3, from = 0 } = {}) {
  if (!kakaoOn()) return;
  const today = new Date();
  for (let i = from; i < days; i++) {
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
      if ((snap.blindSeen || []).length && i <= 2) {
        console.log(`[카카오골프] ${date} 판매중을 한 번도 못 본 칸 ${snap.blindSeen.length}개`
          + `${snap.blindOn ? ' — 찼다고 안 센다' : ' — 세기만 한다(빨리 팔린 것일 수 있음)'}`
          + `: ${snap.blindSeen.slice(0, 8).join(' ')}`);
      }
      const unv = (snap.unverified || []).filter((k) => !(snap.blind || []).includes(k));
      if (unv.length && i <= 2) {
        console.warn(`[카카오골프] ${date} 확인 못 한 칸 ${unv.length}개 — 이 날짜에선 판매중인 걸 못 봤다`
          + `(관측을 늦게 시작해서일 수 있음): ${unv.slice(0, 6).join(' ')}`);
      }
      if ((snap.flexOpen || []).length) {
        console.warn(`⚠️ [카카오골프] ${date} 틀 확장 — 비워둔 칸이 판매중으로 떴습니다: ${snap.flexOpen.join(' ')}`
          + ` (예약팀이 그날 이 칸을 씁니다. 지금부터 정상 판정합니다)`);
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
    } catch (e) {
      console.error(`[카카오골프] ${date} 조회 실패:`, e.message);
      // ★끊긴 걸 모른 채 지나가는 게 제일 나쁘다 — 엔진이 죽었는데 화면은 멀쩡해 보인다.
      //  연속 실패가 쌓이면 관리자에게 한 번 알린다(6시간 중복차단은 boardalert이 처리).
      const h = kakaoHealth();
      if (h && h.streak >= 6) {
        raiseBoardIssue({ kind: 'kakao_down', part: 3,
          note: `카카오골프 연속 ${h.streak}회 실패 — ${h.lastErr || ''}`.slice(0, 90) });
      }
    }
    await sleep(1500);   // robots.txt Crawl-delay: 1 — 넉넉히 지킨다
  }
}
