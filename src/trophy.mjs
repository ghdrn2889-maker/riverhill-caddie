// 업적(트로피) 판정 엔진 — 이미 쌓인 기록을 읽어 '언제 열렸는지'를 되짚는다.
//
// ★설계의 뿌리는 비착취 원칙이다(사용자가 캐디 당사자로서 못박음):
//   1. '결근' 개념이 없다 — 안 뛴 날은 마이너스가 아니라 세지 않는 날이다.
//   2. 오직 +만. 무엇도 깎이지 않는다.
//   3. 출근율·개근·연속 스트릭은 만들지 않는다(휴무·휴가·병가는 권리다).
//   4. 순수 물량으로 '더 일해라' 압박하지 않는다.
//  그래서 이 파일에는 '연속', '비율', '감점'을 세는 코드가 없다. 앞으로도 넣지 않는다.
//
// ★판정은 전부 '되짚기(retroactive)'다 — 각 업적은 "이 조건을 처음 만족한 날짜"를 돌려준다.
//  적립식으로 세지 않는 이유: 적립은 한 번 틀리면 영영 틀린 채로 남는다. 되짚기는 기록이
//  고쳐지면(일지 수동 보정 등) 판정도 같이 고쳐진다. 기록이 진실이고 트로피는 그 그림자다.
//
// ★하루 1일 규칙(확정): 그날 한 번이라도 근무했으면 근무 1일. 54라고 세 번 치지 않는다.
//  물량(투·54)은 '근무 일수'가 아니라 별도 업적으로 인정한다.
import * as journal from './journal.mjs';
import * as wd from './workday.mjs';
import * as ledger from './ledger.mjs';
import { loadUserJSON, saveUserJSON } from './store.mjs';

// ── 등급 · 경험치 · 우주 등급 ──────────────────────────────
export const TIER_XP = { bronze: 20, silver: 60, hidden: 100, gold: 160, platinum: 500 };
export const TIER_KO = { bronze: '브론즈', silver: '실버', hidden: '히든', gold: '골드', platinum: '플래티넘' };

// 누적 XP 사다리. 정점(apex)은 이름이 비어 있다 — 그 자리에 회원 본인 이름이 들어간다.
export const RANKS = [
  { name: '위성 캐디', min: 0, body: 'moon' },
  { name: '행성 캐디', min: 300, body: 'planet' },
  { name: '항성 캐디', min: 600, body: 'star' },
  { name: '거성 캐디', min: 1050, body: 'giant' },
  { name: '초신성 캐디', min: 1600, body: 'nova' },
  { name: '성단 캐디', min: 2400, body: 'cluster' },
  { name: '성운 캐디', min: 3600, body: 'nebula' },
  { name: '', min: 5000, apex: true, gate: 'platinum' },   // 잠긴 정점 — 플래티넘 보유가 조건
];

// ── 날짜 유틸 ──────────────────────────────────────────────
const yearOf = (iso) => Number(String(iso).slice(0, 4));
const monthOf = (iso) => Number(String(iso).slice(5, 7));
const ymOf = (iso) => String(iso).slice(0, 7);
const dowOf = (iso) => new Date(`${iso}T00:00:00`).getDay();
export const seasonOf = (iso) => {
  const m = monthOf(iso);
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
};
// ISO 주(월요일 시작) 키 — '알찬 한 주'가 주를 세는 기준.
function weekKey(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const day = (d.getDay() + 6) % 7;                 // 월=0
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// ── '마친 근무인가' ──────────────────────────
//  판정은 workday.mjs에 하나만 있다 — 정산과 같은 자를 쓴다.
//  여기서 다시 내보내는 건 기존 가져다 쓰던 곳(검사)을 안 깨뜨려는 것뿐이다.
export { ROUND_MIN, isSettled } from './workday.mjs';

// 조건을 만족한 '그 순간의 날짜'를 준다. 없으면 빈 문자열.
const firstWhere = (arr, fn) => { const hit = (arr || []).find(fn); return hit ? hit.date : ''; };
// n번째로 조건을 만족한 날 — "다섯 걸음"처럼 '몇 번째에 열렸나'를 정확히 집는다.
const nth = (arr, n) => (arr && arr.length >= n ? arr[n - 1].date : '');

// ── 회원 한 명의 기록을 판정에 쓰기 좋은 모양으로 ──────────
//  ★여기서 한 번만 훑는다. 업적 40여 개가 각자 파일을 읽으면 같은 걸 40번 읽는다.
export function buildContext(userId = 1) {
  const j = journal.listJournal({}, userId) || [];
  const jMap = {};
  for (const r of j) if (r && r.date) jMap[r.date] = r;

  // 근무한 날 — 판정은 workday.mjs가 한다(일지·정산과 같은 자).
  const days = [];
  for (const date of Object.keys(jMap).sort()) {
    const r = jMap[date];
    if (!wd.isWorkDone(r)) continue;                   // 근무인가 · 마쳤는가 — 정산과 똑같은 판정
    const worked = Object.values(r.rounds || {}).filter((x) => x && x.kind === 'work');
    // rounds가 비었는데 kind만 work인 옛 기록은 대표 부(3부)로 본다 — 기록을 버리지 않는다.
    const parts = worked.length ? [...new Set(worked.map((x) => String(x.part)))].sort() : ['3'];
    // ★인·아웃은 별도 필드가 아니라 course에 그대로 들어 있다('IN'/'OUT').
     //  시드 테스트 계정만 코스 이름(East/West/South)을 쓰므로 IN/OUT일 때만 취한다.
    const sideOf = (v) => { const c = String(v || '').toUpperCase(); return c === 'IN' || c === 'OUT' ? c : ''; };
    const sides = [...new Set([...worked.map((x) => sideOf(x.course)), sideOf(r.course)].filter(Boolean))];
    days.push({
      date, parts, sides,
      courses: [...new Set(worked.map((x) => String(x.course || '')).filter(Boolean))],
      weekend: dowOf(date) === 0 || dowOf(date) === 6,
      season: seasonOf(date), year: yearOf(date), ym: ymOf(date), week: weekKey(date),
    });
  }

  // 기분·메모를 남긴 날(근무 여부와 무관 — 쉬는 날의 한 줄도 기록이다).
  const notes = Object.keys(jMap).sort()
    .filter((d) => jMap[d] && (jMap[d].memo || jMap[d].mood))
    .map((d) => ({ date: d, memo: jMap[d].memo || '', mood: jMap[d].mood || '', season: seasonOf(d), ym: ymOf(d), year: yearOf(d) }));

  const led = ledger.summary({}, userId) || {};
  const raw = loadUserJSON(userId, 'ledger.json', {}) || {};
  const tips = Object.entries(raw.tips || {})
    .filter(([, v]) => Number(v) > 0)
    .map(([date, amount]) => ({ date, amount: Number(amount) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const expenses = (raw.expenses || [])
    .map((e) => ({ date: e.date, amount: Number(e.amount) || 0, scanned: !!e.scanned }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // 목표는 'YYYY-MM' → 금액. 세운 날짜가 기록에 없어 그 달 1일로 본다(트로피 날짜는 그달을 가리키면 충분).
  //  ★목표는 '언제 세웠는지'가 기록에 없다. 그 달 1일로 본다 —
  //   다만 다음 달 목표를 미리 세우면 아직 오지 않은 날짜가 되므로 오늘로 당긴다.
  const tISO = todayISO();
  const goals = Object.entries(raw.goals || {})
    .filter(([, v]) => Number(v) > 0)
    .map(([ym, amount]) => ({ date: `${ym}-01` > tISO ? tISO : `${ym}-01`, ym, amount: Number(amount) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const firsts = loadUserJSON(userId, 'firsts.json', {}) || {};
  const cart = loadUserJSON(userId, 'cartcheck.json', {}) || {};

  return { userId, days, notes, tips, expenses, goals, firsts, cart, ledgerRaw: raw, ledgerSummary: led };
}

// 한 해로 좁힌 맥락 — '올해 첫 3부'처럼 해마다 다시 열리는 업적에 쓴다.
function scopeYear(ctx, year) {
  return {
    ...ctx,
    days: ctx.days.filter((d) => d.year === year),
    notes: ctx.notes.filter((n) => n.year === year),
  };
}

// ── 업적 목록 ──────────────────────────────────────────────
//  key = 영구 식별자(이름이 바뀌어도 안 바뀐다). name·msg는 화면 문구라 언제든 손볼 수 있다.
//  at(ctx) = '이 조건을 처음 만족한 날짜'(없으면 ''). rep:'year'면 해마다, 'month'면 달마다 다시 열린다.
//  need = 이 업적이 기대는 기록. 아직 그 기록을 안 모으면 판정 자체를 건너뛴다(거짓으로 잠그지 않는다).
const P = (d, p) => d.parts.includes(String(p));

export const CATALOG = [
  // ── 근무 ──
  { key: 'first-work', name: '첫 출근', tier: 'bronze', rep: 'year', need: 'journal',
    short: '첫 근무 완수', cond: '올해 첫 근무를 완수하면 열려요.', msg: '올해의 첫 라운드를 시작했어요. 힘차게 달려봐요!',
    at: (c) => nth(c.days, 1) },
  { key: 'first-p3', name: '첫 3부', tier: 'bronze', rep: 'year', need: 'journal',
    short: '3부 첫 근무', cond: '올해 3부 근무를 처음 완수하면 열려요.', msg: '올해 첫 3부. 있어 든든해요!',
    at: (c) => firstWhere(c.days, (d) => P(d, 3)) },
  { key: 'first-p2', name: '첫 2부', tier: 'bronze', rep: 'year', need: 'journal',
    short: '2부 첫 근무', cond: '올해 2부 근무를 처음 완수하면 열려요.', msg: '올해 첫 2부를 시작했어요. 오늘도 잘 부탁해요!',
    at: (c) => firstWhere(c.days, (d) => P(d, 2)) },
  { key: 'first-p1', name: '첫 1부', tier: 'bronze', rep: 'year', need: 'journal',
    short: '1부 첫 근무', cond: '올해 1부 근무를 처음 완수하면 열려요.', msg: '올해 첫 1부, 이른 새벽 대단해요! 부지런한 캐디의 모습!',
    at: (c) => firstWhere(c.days, (d) => P(d, 1)) },
  { key: 'days-5', name: '다섯 걸음', tier: 'bronze', need: 'journal',
    short: '근무 5일', cond: '누적 근무 다섯 번을 채우면 열려요.', msg: '벌써 다섯 번째 근무 달성!',
    at: (c) => nth(c.days, 5) },
  { key: 'days-10', name: '열 걸음', tier: 'bronze', need: 'journal',
    short: '근무 10일', cond: '누적 근무 열 번을 채우면 열려요.', msg: '두 자리 수 진입!',
    at: (c) => nth(c.days, 10) },
  { key: 'days-30', name: '서른 고개', tier: 'bronze', need: 'journal',
    short: '근무 30일', cond: '누적 근무 서른 번을 채우면 열려요.', msg: '서른 번의 라운드, 정말 성실하네요!',
    at: (c) => nth(c.days, 30) },
  { key: 'p3-5', name: '3부의 발자국', tier: 'bronze', need: 'journal',
    short: '3부 5회', cond: '3부 근무를 다섯 번 달성하면 열려요.', msg: '3부만 다섯 번, 이 자리를 지켜줘서 고마워요.',
    at: (c) => nth(c.days.filter((d) => P(d, 3)), 5) },
  { key: 'double-1', name: '투의 첫날', tier: 'bronze', need: 'journal',
    short: '하루 2회 근무 첫 완수', cond: '하루에 두 번(투) 근무를 처음 완수하면 열려요.', msg: '이번 달 첫 브이!',
    at: (c) => firstWhere(c.days, (d) => d.parts.length >= 2) },
  { key: 'double-3', name: '남들보다 한 걸음 더', tier: 'bronze', need: 'journal',
    short: '투 근무 3번', cond: '하루 두 번 근무를 세 번 달성하면 열려요.', msg: '한 걸음 더 앞서나가는 모습!',
    at: (c) => nth(c.days.filter((d) => d.parts.length >= 2), 3) },
  { key: 'first-54', name: '첫 54', tier: 'bronze', need: 'journal',
    short: '54 첫 완수', cond: '하루에 1·2·3부(54)를 처음 완수하면 열려요.', msg: '첫 54 달성! 대단해요!',
    at: (c) => firstWhere(c.days, (d) => d.parts.length >= 3) },
  { key: 'weekend-1', name: '주말의 그린', tier: 'bronze', need: 'journal',
    short: '첫 주말 근무', cond: '주말에 처음 근무하면 열려요.', msg: '고객들의 주말을 책임지는 당신은 멋진 캐디!',
    at: (c) => firstWhere(c.days, (d) => d.weekend) },
  { key: 'week-5', name: '알찬 한 주', tier: 'bronze', need: 'journal',
    short: '한 주 5번 근무', cond: '한 주에 다섯 번 근무하면 열려요.', msg: '한 주의 나 칭찬해!',
    at: (c) => {
      // ★'연속'이 아니라 '한 주 안에 다섯 날'이다 — 스트릭을 만들지 않는다는 원칙과 어긋나지 않는다.
      const cnt = {};
      for (const d of c.days) { cnt[d.week] = (cnt[d.week] || 0) + 1; if (cnt[d.week] === 5) return d.date; }
      return '';
    } },
  { key: 'in-and-out', name: 'In and Out 캐디', tier: 'bronze', need: 'journal',
    short: '첫 인·아웃코스', cond: '인코스와 아웃코스를 모두 한 번씩 돌면 열려요.', msg: '인이냐 아웃이냐 그것이 문제로다',
    at: (c) => {
      const seen = new Set();
      for (const d of c.days) { for (const s of d.sides) seen.add(s); if (seen.has('IN') && seen.has('OUT')) return d.date; }
      return '';
    } },

  // ── 계절 ──
  { key: 'season-spring', name: '봄의 함께', tier: 'silver', rep: 'year', need: 'journal',
    short: '봄(3~5월) 첫 근무', cond: '3~5월 사이 올해 첫 근무를 하면 열려요.', msg: '오늘 출근길이 봄길이였길',
    at: (c) => firstWhere(c.days, (d) => d.season === 'spring') },
  { key: 'season-summer', name: '여름을 대비해!', tier: 'silver', rep: 'year', need: 'journal',
    short: '여름(6~8월) 첫 근무', cond: '6~8월 사이 올해 첫 근무를 하면 열려요.', msg: '몸이 가장 소중하니까',
    at: (c) => firstWhere(c.days, (d) => d.season === 'summer') },
  { key: 'season-autumn', name: '나 가을 타나봐', tier: 'silver', rep: 'year', need: 'journal',
    short: '가을(9~11월) 첫 근무', cond: '9~11월 사이 올해 첫 근무를 하면 열려요.', msg: '소중한 추억이 가득하길',
    at: (c) => firstWhere(c.days, (d) => d.season === 'autumn') },
  { key: 'season-winter', name: '이 날씨에 골프를 쳐?', tier: 'silver', rep: 'year', need: 'journal',
    short: '겨울(12~2월) 첫 근무', cond: '12~2월 사이 올해 첫 근무를 하면 열려요.', msg: '따뜻하게 입었죠? 감기 걸리면 혼나요!',
    at: (c) => firstWhere(c.days, (d) => d.season === 'winter') },

  // ── 기록(일지) ──
  { key: 'note-1', name: '마음도 한 줄', tier: 'bronze', need: 'journal',
    short: '기분·메모 첫 기록', cond: '근무 일지에 그날의 기분·메모를 처음 남기면 열려요.', msg: '오늘의 나를 처음으로 기록했어요',
    at: (c) => nth(c.notes, 1) },
  { key: 'mood-good', name: '좋았던 하루', tier: 'bronze', need: 'journal',
    short: "'좋음' 이상 기분 첫 기록", cond: "'좋음' 이상의 기분을 처음 기록하면 열려요.", msg: '좋았던 순간은 오래 기억되길',
    at: (c) => firstWhere(c.notes, (n) => n.mood === 'great' || n.mood === 'good') },
  { key: 'note-10', name: '열흘의 마음', tier: 'silver', rep: 'month', need: 'journal',
    short: '한 달 기분·메모 10일', cond: '한 달에 기분·메모를 10일 이상 남기면 열려요.', msg: '당신의 계절이 문장으로 남고 있어요',
    at: (c) => nth(c.notes, 10) },
  { key: 'note-4seasons', name: '사계의 일기', tier: 'gold', need: 'journal',
    short: '네 계절 기분·메모', cond: '봄·여름·가을·겨울 네 계절 모두 그날의 기분·메모를 한 번 이상 남기면 열려요.', msg: '한 해의 사계가 당신의 문장으로 남았어요',
    at: (c) => {
      const seen = new Set();
      for (const n of c.notes) { seen.add(n.season); if (seen.size === 4) return n.date; }
      return '';
    } },

  // ── 정산 ──
  { key: 'goal-1', name: '목표를 응원해', tier: 'bronze', need: 'ledger',
    short: '첫 목표 세우기', cond: '정산에서 월 목표를 처음 세우면 열려요.', msg: '목표가 있는 캐디란 멋지지 않나요?',
    at: (c) => nth(c.goals, 1) },
  { key: 'tip-1', name: '누군가의 감사', tier: 'bronze', need: 'ledger',
    short: '첫 팁 기록', cond: '팁을 처음 기록하면 열려요.', msg: '고객들이 당신에게 감사하고 있어요!',
    at: (c) => nth(c.tips, 1) },
  { key: 'tip-10', name: '감사가 쌓여', tier: 'silver', need: 'ledger',
    short: '누적 팁 10건', cond: '팁을 열 번 기록하면 열려요.', msg: '고객의 마음이 이만큼 모였어요',
    at: (c) => nth(c.tips, 10) },
  { key: 'exp-1', name: '나를 위한 소비', tier: 'bronze', need: 'ledger',
    short: '첫 지출 기록', cond: '정산에 지출을 처음 기록하면 열려요.', msg: '절세를 위한 첫걸음',
    at: (c) => nth(c.expenses, 1) },
  { key: 'exp-10', name: '절세의 습관', tier: 'silver', need: 'ledger',
    short: '지출 10건', cond: '정산에 지출을 열 건 기록하면 열려요.', msg: '새는 돈을 지킨 꼼꼼함',
    at: (c) => nth(c.expenses, 10) },
  { key: 'exp-scan', name: '영수증 스캐너', tier: 'bronze', need: 'ledger',
    short: 'AI 영수증 첫 인식', cond: '지출 등록 시 AI 영수증 인식을 처음 사용하면 열려요.', msg: '찍기만 하면 끝, 똑똑한 절세',
    at: (c) => firstWhere(c.expenses, (e) => e.scanned) },
  { key: 'goal-hit', name: '목표 달성', tier: 'silver', need: 'ledger',
    short: '월 목표 첫 달성', cond: '정산에서 세운 월 목표 금액을 실제 수입으로 처음 넘어서면 열려요.', msg: '세운 목표를 스스로 넘어선 날',
    at: (c) => {
      // 목표를 세운 달만 본다 — 목표가 없으면 '달성'도 없다.
      for (const g of c.goals) {
        const s = ledger.summary({ year: Number(g.ym.slice(0, 4)), month: Number(g.ym.slice(5, 7)) }, c.userId) || {};
        // ★'넘어선 그날'을 집는다 — 달 단위로 뭉뚱그리면 트로피 날짜가 근무보다 앞서는 날이 생긴다.
        //  목표가 겨루는 상대는 정산이 쓰는 그 값(revenueTotal = 근무 수입 + 팁)이다.
        let acc = 0;
        for (const r of (s.rows || []).slice().sort((a, b) => a.date.localeCompare(b.date))) {
          acc += (Number(r.revenue) || 0) + (Number(r.tip) || 0);
          if (acc >= g.amount) return r.date;
        }
      }
      return '';
    } },

  // ── 점검 ──
  { key: 'cart-1', name: '찰칵! 찰칵!', tier: 'bronze', need: 'cart',
    short: '첫 카트 점검', cond: '카트 점검을 처음 완료하면 열려요.', msg: '꼼꼼한 모습이 인상적이네요',
    at: (c) => firstCartDate(c.cart, ['intake', 'exit']) },
  { key: 'club-1', name: '틀린 그림 찾기', tier: 'bronze', need: 'cart',
    short: '첫 클럽 점검', cond: '클럽 점검을 처음 완료하면 열려요.', msg: '여기 증거가 있소!',
    at: (c) => firstCartDate(c.cart, ['club_pre', 'club_post']) },

  // ── 앱 첫 경험 ──
  { key: 'app-1', name: '입문', tier: 'bronze', need: 'firsts',
    short: '앱 첫 방문', cond: '앱에 처음 방문하면 열려요.', msg: '기다렸어요! 앞으로 잘 부탁드려요!',
    at: (c) => c.firsts.app || '' },
  { key: 'view-board', name: '첫 확인', tier: 'bronze', need: 'firsts',
    short: '배치 첫 확인', cond: '앱에서 배치표를 처음 확인하면 열려요.', msg: '내 근무는 내가 챙겨!',
    at: (c) => c.firsts.board || '' },
  { key: 'view-journal', name: '기록의 시작', tier: 'bronze', need: 'firsts',
    short: '일지 첫 열기', cond: '근무 일지를 처음 열면 열려요.', msg: '나를 기록해줘!',
    at: (c) => c.firsts.journal || '' },
  { key: 'view-settle', name: '셈의 시작', tier: 'bronze', need: 'firsts',
    short: '정산 첫 확인', cond: '정산을 처음 확인하면 열려요.', msg: '차곡차곡 쌓이는 숫자',
    at: (c) => c.firsts.settle || '' },
  { key: 'view-profile', name: '나의 자리', tier: 'bronze', need: 'firsts',
    short: '프로필 첫 열기', cond: '프로필을 처음 열면 열려요.', msg: '나는 어떤 캐디일까?',
    at: (c) => c.firsts.profile || '' },
  { key: 'report-1', name: '돌아보기', tier: 'silver', need: 'firsts',
    short: '수익계산서 첫 발급', cond: '한 달 근무 10일 이상이 기록된 수익계산서를 처음 발급하면 열려요.', msg: '당신의 걸어온 자리가 선명하도록',
    // ★'10일 이상이 기록된' 계산서다 — 아무 달이나 뽑았다고 열리지 않는다.
    at: (c) => (reportsOf(c).find((r) => r.days >= 10) || {}).at || '' },
  { key: 'report-6', name: '반년의 장부', tier: 'gold', need: 'firsts',
    short: '수익계산서 6개월', cond: '수익계산서를 여섯 달 발급하면 열려요.', msg: '성실히 걸어온 반년',
    // 여섯 '달'이다 — 같은 달을 여섯 번 뽑는 걸로는 안 열린다.
    at: (c) => {
      const seen = new Set();
      for (const r of reportsOf(c)) { seen.add(r.ym); if (seen.size === 6) return r.at; }
      return '';
    } },

  // ── 기준 준비 중 ──
  //  ★조건이 아직 안 정해진 것들. 판정하지 않고 '준비 중'으로 진열만 한다 —
  //   조건 없이 잠가두면 회원은 '내가 못 딴 것'으로 오해한다. 그래서 화면이 이유를 밝힌다.
  { key: 'plat-orb', name: '코스믹 오브', tier: 'platinum', need: null, sym: 'orb',
    short: '한 해, 캐디 중 단 한 분께', cond: '한 해, 리버힐 캐디 중 단 한 분께 주어지는 최고의 영광이에요. 올해의 수상 기준은 준비 중이에요.', msg: '', at: () => '' },
  { key: 'plat-galaxy', name: '네뷸라 은하', tier: 'platinum', need: null, sym: 'galaxy',
    short: '한 해를 온전히 기록한 이에게', cond: '한 해, 리버힐 캐디 중 단 한 분께 주어지는 최고의 영광이에요. 올해의 수상 기준은 준비 중이에요.', msg: '', at: () => '' },
  { key: 'plat-cube', name: '테서랙트 큐브', tier: 'platinum', need: null, sym: 'cube',
    short: '쌓아 올린 라운드의 탑', cond: '한 해, 리버힐 캐디 중 단 한 분께 주어지는 최고의 영광이에요. 올해의 수상 기준은 준비 중이에요.', msg: '', at: () => '' },
  { key: 'hidden-1', name: '숨겨진 이야기', tier: 'hidden', need: null, hidden: true,
    short: '', cond: '', msg: '', at: () => '' },
];

// 발급 기록 — 옛 모양(날짜 문자열 배열)도 읽는다. 기록을 버리지 않는다.
function reportsOf(c) {
  return ((c.firsts || {}).reports || [])
    .map((r) => (typeof r === 'string' ? { at: r, ym: r.slice(0, 7), days: 0 } : r))
    .filter((r) => r && r.at)
    .sort((a, b) => a.at.localeCompare(b.at));
}

// 카트/클럽 점검 기록에서 '처음 사진을 남긴 날'. 점검 저장 구조는 날짜별 photos 맵.
function firstCartDate(cart, legs) {
  const days = (cart && cart.days) || cart || {};
  const dates = Object.keys(days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  for (const d of dates) {
    const ph = (days[d] && days[d].photos) || {};
    // ★빈 배열([])도 참이다 — 길이를 봐야 '사진 없는 날'이 첫 점검으로 잡히지 않는다.
    if (legs.some((l) => Array.isArray(ph[l]) ? ph[l].length : !!ph[l])) return d;
  }
  return '';
}

// ── 판정 ───────────────────────────────────────────────────
//  결과 한 줄 = 트로피 '한 개(instance)'. 해마다 열리는 건 해마다 한 줄이 늘어난다.
export function evaluate(ctx) {
  const out = [];
  const years = [...new Set([...ctx.days.map((d) => d.year), ...ctx.notes.map((n) => n.year)])].sort();

  for (const t of CATALOG) {
    if (t.rep === 'year') {
      for (const y of years) {
        const date = t.at(scopeYear(ctx, y));
        if (date) out.push(mk(t, date, `${t.key}@${y}`, `${y} ${t.name}`));
      }
      continue;
    }
    if (t.rep === 'month') {
      // 달마다 다시 열린다. 같은 트로피를 여러 번 받을수록 XP는 기본/√n으로 체감 —
      //  "꾸준함은 계속 인정하되 독점은 막는다"(사용자 문구).
      const byMonth = {};
      for (const n of ctx.notes) (byMonth[n.ym] = byMonth[n.ym] || []).push(n);
      let round = 0;
      for (const ym of Object.keys(byMonth).sort()) {
        const date = t.at({ ...ctx, notes: byMonth[ym] });
        if (!date) continue;
        round += 1;
        out.push({ ...mk(t, date, `${t.key}@${ym}`, `${ym.replace('-', '.')} ${t.name}`), xp: Math.round(TIER_XP[t.tier] / Math.sqrt(round)), round });
      }
      continue;
    }
    const date = t.at(ctx);
    if (date) out.push(mk(t, date, t.key, t.name));
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function mk(t, date, id, label) {
  return { id, key: t.key, name: t.name, label, tier: t.tier, rep: t.rep || '', short: t.short, cond: t.cond, msg: t.msg,
    date, season: yearOf(date), xp: TIER_XP[t.tier] || 0 };
}

// ── 시즌 · 등급 ────────────────────────────────────────────
//  ★시즌이 리셋하는 건 XP와 등급뿐이다. 트로피 자체는 진열장에 영구히 남는다("초기화 ≠ 삭제").
export function rankFor(xp, { hasPlatinum = false, name = '' } = {}) {
  let cur = RANKS[0], next = null;
  for (let i = 0; i < RANKS.length; i++) {
    const r = RANKS[i];
    if (r.gate === 'platinum' && !hasPlatinum) { next = { ...r, name: name ? `${name} 캐디` : '정점', locked: true }; break; }
    if (xp >= r.min) cur = r; else { next = r; break; }
  }
  const label = cur.apex ? (name ? `${name} 캐디` : '정점') : cur.name;
  const nextLabel = next ? (next.apex ? (name ? `${name} 캐디` : '정점') : next.name) : '';
  const span = next ? Math.max(1, next.min - cur.min) : 1;
  return {
    name: label, level: RANKS.indexOf(cur) + 1, body: cur.body || 'apex', apex: !!cur.apex,
    min: cur.min, next: next ? { name: nextLabel, min: next.min, locked: !!next.locked } : null,
    //  0 아래로 안 내려간다 — XP는 오직 +만 있지만, 진행 막대가 음수 폭으로 그려지는 건 막아둔다.
    pct: next ? Math.max(0, Math.min(100, Math.round(((xp - cur.min) / span) * 100))) : 100,
  };
}

// 한 회원의 성장 공간 전체 — 화면이 이걸 그대로 그린다.
export function growthFor(userId = 1, { seasonYear = new Date().getFullYear(), name = '' } = {}) {
  const ctx = buildContext(userId);
  const earned = evaluate(ctx);
  const earnedBy = {};
  for (const e of earned) earnedBy[e.id] = e;

  const seasonXP = earned.filter((e) => e.season === seasonYear).reduce((s, e) => s + e.xp, 0);
  const hasPlatinum = earned.some((e) => e.tier === 'platinum');
  const counts = { bronze: 0, silver: 0, gold: 0, hidden: 0, platinum: 0 };
  for (const e of earned) counts[e.tier] = (counts[e.tier] || 0) + 1;

  // 아직 못 딴 것들 — 진열장의 빈칸. 해마다 열리는 건 '올해분'만 빈칸으로 보여준다.
  const locked = [];
  for (const t of CATALOG) {
    const id = t.rep === 'year' ? `${t.key}@${seasonYear}` : t.key;
    if (t.rep === 'month') { if (!earned.some((e) => e.key === t.key)) locked.push(lk(t, t.key)); continue; }
    if (!earnedBy[id]) locked.push(lk(t, id, t.rep === 'year' ? `${seasonYear} ${t.name}` : t.name));
  }

  // ★미획득 진열장은 플래티넘을 맨 앞에 둔다 — '나도 주인이 될 수 있다'를 먼저 보이게(시안 v3 의도).
  const ORD = { platinum: 0, gold: 1, silver: 2, bronze: 3, hidden: 4 };
  locked.sort((a, b) => (ORD[a.tier] ?? 9) - (ORD[b.tier] ?? 9));

  return {
    season: seasonYear, xp: seasonXP, counts,
    total: earned.length, catalogTotal: CATALOG.length,
    rank: rankFor(seasonXP, { hasPlatinum, name }),
    earned, locked,
  };
}
function lk(t, id, label) {
  return { id, key: t.key, name: t.name, label: label || t.name, tier: t.tier, rep: t.rep || '',
    short: t.short, cond: t.cond, hidden: !!t.hidden, pending: t.need === null, sym: t.sym || '', got: 0 };
}

// ── '처음'을 적는다 ────────────────────────────────────────
//  ★앱 안에서만 알 수 있는 것들(첫 방문·탭 첫 열기·정산서 발급)은 기록이 없으면 판정도 못 한다.
//   그래서 '처음 그 일이 일어난 날'만 남긴다 — 몇 번 봤는지는 세지 않는다(감시 도구로 쓰지 않는다).
const FIRSTS_FILE = 'firsts.json';
// ── 잠금 ── 판정이 아직 여러 군데서 틀린다(사장님 지적). 열려 있으면 틀린 축하가 회원 폰까지 간다.
//  ★기본값은 '잠김'이다 — 켜는 쪽이 명시적이어야 한다. 새 서버·새 배포가 조용히 열리면 안 된다.
//  ★잠겨도 markFirst('처음 열어본 날')는 계속 적는다. 그건 판정이 아니라 사실이고, 지금 안 적으면 영영 잃는다.
export function trophyOn() {
  return ['1', 'true', 'yes'].includes(String(process.env.TROPHY_ON || '').toLowerCase());
}

export function markFirst(userId, what, dateISO = todayISO(), meta = {}) {
  if (!userId || !what) return false;
  const f = loadUserJSON(userId, FIRSTS_FILE, {}) || {};
  if (what === 'report') {
    // 계산서는 '어느 달을 언제 뽑았나'까지 남긴다 — 돌아보기는 그달 근무 10일 조건이 붙어 있고,
    //  반년의 장부는 '여섯 달'을 세기 때문이다. 같은 달을 다시 뽑는 건 한 번으로 친다.
    const list = (f.reports || []).map((r) => (typeof r === 'string' ? { at: r, ym: r.slice(0, 7), days: 0 } : r));
    const ym = String(meta.ym || dateISO.slice(0, 7));
    const hit = list.find((r) => r.ym === ym);
    if (hit) { if ((meta.days || 0) > (hit.days || 0)) { hit.days = meta.days; saveUserJSON(userId, FIRSTS_FILE, { ...f, reports: list }); } return false; }
    f.reports = [...list, { at: dateISO, ym, days: Math.max(0, Number(meta.days) || 0) }].sort((a, b) => a.at.localeCompare(b.at));
    saveUserJSON(userId, FIRSTS_FILE, f);
    return true;
  }
  if (f[what]) return false;
  f[what] = dateISO;
  saveUserJSON(userId, FIRSTS_FILE, f);
  return true;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 새로 열린 트로피 찾기 ──────────────────────────────────
//  ★두 가지를 따로 센다.
//   seen    = 지금까지 판정해 본 것(새로 열린 게 있는지 가르는 기준)
//   pending = 열렸지만 아직 회원에게 '축하 화면'을 못 보여준 것
//  나눠야 하는 이유: 알림은 앱 밖에서 먼저 나간다. 알림이 seen만 갱신하면
//  회원이 앱을 열었을 때 축하할 거리가 이미 사라져 있다.
//
//  ★지난 기록으로 소급된 것은 알리지도 축하하지도 않는다. 처음 판정하는 순간
//   이미 딴 것들을 전부 본 것으로 덮어둔다 — 안 그러면 폰에 축하가 열 몇 개씩 터진다.
const SEEN_FILE = 'trophies.json';

// 대표 트로피 뽑는 순서 — 높은 등급 먼저, 같으면 최신 먼저.
export function rankFresh(list) {
  return [...(list || [])].sort((a, b) => (TIER_XP[b.tier] || 0) - (TIER_XP[a.tier] || 0)
    || String(b.date).localeCompare(String(a.date))
    || String(a.id).localeCompare(String(b.id)));
}

// 한 회원을 판정하고, 새로 열린 것을 '축하 대기'에 쌓는다.
//  announce=false면 대기에만 쌓고 알림은 부르는 쪽이 알아서 한다.
export function sweep(userId = 1) {
  const g = growthFor(userId);
  const store = loadUserJSON(userId, SEEN_FILE, null);
  const first = !store;
  const known = new Set((store && store.seen) || []);
  const fresh = first ? [] : g.earned.filter((e) => !known.has(e.id));

  // 대기는 id로만 들고 있는다 — 문구·등급은 늘 지금 판정에서 가져온다(옛 값이 굳지 않게).
  const pendIds = new Set([...((store && store.pending) || []), ...fresh.map((e) => e.id)]);
  const byId = new Map(g.earned.map((e) => [e.id, e]));
  const pending = rankFresh([...pendIds].map((id) => byId.get(id)).filter(Boolean));   // 사라진 건 조용히 버린다

  saveUserJSON(userId, SEEN_FILE, {
    seen: g.earned.map((e) => e.id),
    pending: pending.map((e) => e.id),
    at: Date.now(),
    backfilledAt: (store && store.backfilledAt) || Date.now(),
  });
  return { growth: g, fresh: rankFresh(fresh), pending, first, backfilled: first ? g.earned.length : 0 };
}

// 축하를 보여줬다 — 대기에서 지운다. 화면이 끝난 뒤에 부른다(중간에 꺼져도 다시 축하하도록).
export function ackCelebrated(userId = 1, ids = []) {
  const store = loadUserJSON(userId, SEEN_FILE, null);
  if (!store) return 0;
  const drop = new Set(ids.map(String));
  const left = (store.pending || []).filter((id) => !drop.has(String(id)));
  const n = (store.pending || []).length - left.length;
  saveUserJSON(userId, SEEN_FILE, { ...store, pending: left, at: Date.now() });
  return n;
}
