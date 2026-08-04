// 응원 한 줄 — '수호천사 같은 아이 / 걱정 많은 엄마' 목소리로, 지금 그 사람 상황에 맞춘 존댓말 한마디.
//  · 상태(오늘 상황판 today.json) + 저널(그날 최종 결과) + 라운드 점검(근무 종료 신호) + 날씨 + 시각으로 '장면(scene)'을 판단.
//  · 장면이 바뀔 때만 Gemini로 문구 풀(5개)을 새로 생성해 캐시 → 앱 열 때는 그중 하나를 즉시 표시(지연 0).
//  · AI 실패/빈응답이면 사람이 써둔 안전망 풀로 대체. 발송은 푸시 아님(앱 안에서만).
import { callGeminiJSON } from './gemini.mjs';
import { loadUserJSON, saveUserJSON } from './store.mjs';
import { loadToday } from './today.mjs';
import * as journal from './journal.mjs';
import * as cartcheck from './cartcheck.mjs';
import * as weather from './weather.mjs';
import * as worklog from './worklog.mjs';

const FILE = 'cheer.json';
const ROUND_HOURS = Number(process.env.CHEER_ROUND_HOURS ?? 5); // 티오프+N시간 지나면 '라운드 종료'로 간주(보조 신호)
const isWork = (s) => ['assigned', 'work', 'your_turn'].includes(s);
const isWait = (s) => ['spare', 'waiting', 'near'].includes(s);

// ── KST 지금(ISO 날짜 + 시(hour)) ──
function kstNow() {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date()));
  return { iso, hour: Number.isFinite(hour) ? hour % 24 : 12 };
}
function timeBucket(h) {
  return h < 6 ? '새벽' : h < 11 ? '아침' : h < 14 ? '점심때' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤';
}
function seasonKo(m) { return (m >= 3 && m <= 5) ? '봄' : (m >= 6 && m <= 8) ? '여름' : (m >= 9 && m <= 11) ? '가을' : '겨울'; }
function tempBand(t) { return t >= 29 ? '무더움' : t >= 25 ? '더움' : t >= 17 ? '선선함' : t >= 9 ? '쌀쌀함' : '추움'; }
const CHEER_VER = 5; // 프롬프트/문맥 규칙 바뀌면 올려서 캐시 강제 무효화(오래된 문구 축출)

// ── WMO 코드 → 한글/카테고리(문맥·캐시키용) ──
function wmoDescKo(code) {
  const M = { 0: '맑음', 1: '대체로 맑음', 2: '구름 많음', 3: '흐림', 45: '안개', 48: '안개',
    51: '이슬비', 53: '이슬비', 55: '이슬비', 56: '어는 이슬비', 57: '어는 이슬비',
    61: '약한 비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '어는 비',
    71: '약한 눈', 73: '눈', 75: '많은 눈', 77: '싸락눈',
    80: '소나기', 81: '소나기', 82: '강한 소나기', 85: '소나기눈', 86: '소나기눈',
    95: '뇌우', 96: '우박 뇌우', 99: '우박 뇌우' };
  return M[code] || '흐림';
}
function wmoCat(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3 || code === 45 || code === 48) return 'cloud';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}
async function currentWeather(iso, hour) {
  try {
    const wx = await weather.getHourly();
    const cur = wx.hours.find((h) => h.date === iso && h.hour === hour)
      || wx.hours.find((h) => h.date === iso && h.hour >= hour)
      || wx.hours.find((h) => h.date === iso);
    if (!cur) return null;
    return { cat: wmoCat(cur.code), desc: wmoDescKo(cur.code), temp: cur.temp, pop: cur.pop, day: !!cur.day };
  } catch { return null; }
}

// ── 근무 종료 감지 ──
//  강한 신호: 오늘 라운드 점검(종료 체크리스트 완료 or 빈 카트 사진). 보조: 티오프 + ROUND_HOURS 경과.
function workEndSignal(t, ccDay, hour) {
  const checkDone = !!(ccDay && (ccDay.checklistDoneAt
    || (ccDay.photos && Array.isArray(ccDay.photos.exit) && ccDay.photos.exit.length)));
  let timeDone = false;
  const m = String(t?.teeTime || '').match(/^(\d{1,2}):/);
  if (m) timeDone = hour >= (Number(m[1]) + ROUND_HOURS);
  return { ended: checkDone || timeDone, checkDone };
}

// ── 장면(scene) 판단 + 사실(문맥) 구성 ──
function buildScene(uid, now) {
  const t = loadToday(uid);
  const tISO = t && t.date ? worklog.labelToISO(t.date) : null;
  const offset = tISO ? Math.round((Date.parse(tISO) - Date.parse(now.iso)) / 86400000) : 0;
  const part = (t && t.part) || '3부';

  // 오늘보다 과거 날짜만 남아 있으면(새 배치표 미확보) 응원 생략 — 지어낼 근거 없음.
  if (tISO && tISO < now.iso) return { scene: 'skip' };

  let scene, checkDone = false;
  const todayKind = (journal.getDay(now.iso, uid) || {}).kind || '';

  if (offset >= 1) {
    scene = 'nextday'; // 다음 날(+) 배치표가 떠 있음 — 오늘은 마무리, 내일 안내
  } else if (!t || !t.status || t.status === 'unknown') {
    return { scene: 'skip' };
  } else if (isWork(t.status)) {
    const ccDay = cartcheck.getDay(now.iso, uid);
    const sig = workEndSignal(t, ccDay, now.hour);
    checkDone = sig.checkDone;
    scene = sig.ended ? 'work_done' : 'work_active';
  } else if (isWait(t.status)) {
    scene = 'spare';
  } else if (t.status === 'off') {
    scene = 'off_today';
  } else {
    return { scene: 'skip' };
  }
  return { scene, t, offset, part, todayKind, checkDone };
}

// 사람이 읽는 '오늘 상황' 문맥(프롬프트에 넣을 사실). 주어진 사실만.
function factsText(s, now, wx) {
  const t = s.t || {};
  const tee = t.teeTime ? `${t.teeTime}${t.course ? ` ${t.course} 코스` : ''}` : '';
  const timeStr = `지금 ${timeBucket(now.hour)}(${now.hour}시경).`;
  const month = Number(now.iso.split('-')[1]) || 0;
  const season = seasonKo(month);
  const wStr = wx
    ? ` 계절: ${season}. 날씨: ${wx.desc}, ${wx.temp}도(${tempBand(wx.temp)}), 강수확률 ${wx.pop}%.`
    : ` 계절: ${season}.`;
  const ahead = (t.myPosition && t.cutLine) ? Math.max(0, Number(t.myPosition) - Number(t.cutLine) - 1) : null;

  switch (s.scene) {
    case 'work_active':
      return `오늘 ${s.part} 근무 확정.${t.myPosition ? ` 순번 ${t.myPosition}번.` : ''}${tee ? ` 티오프 ${tee}.` : ''} ${timeStr}${wStr}`;
    case 'work_done':
      return `오늘 ${s.part} 근무를 마침(라운드 종료).${tee ? ` 티오프는 ${tee}였음.` : ''}${s.checkDone ? ' 방금 라운드 점검(빈 카트)까지 끝냄.' : ''} 이제 하루 일 끝내고 쉴 시간. ${timeStr}${wStr}`;
    case 'spare':
      return `${s.part} 스페어(대기) 중.${t.myPosition ? ` 내 순번 ${t.myPosition}번.` : ''}${t.cutLine ? ` 현재 확정선 ${t.cutLine}번${ahead != null ? `, 앞으로 ${ahead}명 남음` : ''}.` : ''} ${timeStr}${wStr}`;
    case 'off_today':
      return `오늘은 휴무라 쉬는 날. ${timeStr}${wStr}`;
    case 'nextday': {
      const dayW = s.offset === 1 ? '내일' : s.offset === 2 ? '모레' : `${s.offset}일 뒤`;
      const todayStory = s.todayKind === 'work' ? '오늘은 근무를 했고 이제 마무리됨.'
        : s.todayKind === 'spare' ? '오늘은 스페어로 대기했지만 끝내 순번이 안 와 무근무로 하루가 끝남.'
          : s.todayKind === 'off' ? '오늘은 휴무라 쉬었음.'
            : '오늘 하루가 저물어 감.';
      const tmr = isWork(t.status)
        ? `${dayW}은 ${s.part} 근무 확정${t.myPosition ? ` 순번 ${t.myPosition}번` : ''}${tee ? `, 티오프 ${tee}` : ''}.`
        : isWait(t.status) ? `${dayW}도 ${s.part} 스페어 대기${t.myPosition ? `(순번 ${t.myPosition}번)` : ''}.`
          : t.status === 'off' ? `${dayW}은 휴무.` : `${dayW} 일정이 올라옴.`;
      return `${todayStory} 방금 ${dayW} 배치표가 올라옴 — ${tmr} ${timeStr}`;
    }
    default: return '';
  }
}

// 캐시 키 — 장면·핵심 사실·시간대·날씨가 바뀌면 새로 생성.
function stateKey(s, now, wx) {
  const t = s.t || {};
  const month = Number(now.iso.split('-')[1]) || 0;
  return [CHEER_VER, s.scene, s.offset ?? 0, t.status || '', t.teeTime || '', t.myPosition ?? '', t.cutLine ?? '',
    s.todayKind || '', wx ? wx.cat : '', wx ? (wx.day ? 'd' : 'n') : '', wx ? tempBand(wx.temp) : '',
    seasonKo(month), timeBucket(now.hour)].join('|');
}

// ── AI 생성 프롬프트(수호천사 아이/걱정 많은 엄마 · 존댓말) ──
function buildPrompt(facts, n) {
  return `당신은 이 사람을 늘 지켜보며 걱정하고 응원하는 목소리입니다.
느낌은 '이 사람을 지켜주는 수호천사 같은 어린아이', 그리고 '걱정 많은 엄마'가 섞인 결입니다.
사용자는 골프장 캐디이고, 오늘 일이 있는지 확인하려고 이 앱을 켰습니다.
아래 '오늘 상황'에 놓인 그 사람에게 건네는 짧은 한마디를, 서로 겹치지 않게 ${n}개 만들어 주세요.

[말투 — 매우 중요]
- 반드시 존댓말(~요 / ~세요 / ~해요).
- 엄마가 챙기듯 '구체적으로' 챙겨주되(밥·물·안전·컨디션·쉬기 등), 조언은 반드시 아래 '오늘 상황'의 계절·기온에 맞추세요.
- ★계절/기온 준수(가장 중요): 더운 날·여름이면 더위·수분·햇빛·그늘·시원함을 챙기고, 추운 날·겨울이면 방한을 챙기세요.
  여름이나 더운 날에 '따뜻하게 입어라 / 몸 녹여라 / 감기 조심 / 핫팩 / 체온 떨어질라' 같은 방한 표현은 절대 금지.
  반대로 추운 날에 '더위·자외선 조심' 같은 표현도 금지. 계절과 안 맞는 말은 공감이 확 깨집니다.
- 오글거리는 감정 선언 금지: "곁에 있을게요", "함께할게요", "마음 챙겨요" 같은 표현 절대 금지.
- 시적 미사여구 자제. 실제 엄마·아이가 말하듯 자연스럽고 담백하게. 훈계·조언질 금지.

[반드시 지킬 것]
- 한국어 한 문장. 공백 포함 22자 내외(최대 30자)로, 한 문장이 자연스럽게 완결되게. (너무 짧아 사무적이면 안 됨)
- 엄마가 챙기듯 따뜻하고 다정하게. 걱정 한 스푼 담아 정말 챙겨주는 느낌으로(차갑거나 딱딱하면 안 됨).
- 아래 '오늘 상황'에 주어진 사실만 사용. 없는 사실 지어내지 마세요.
- 근무를 마쳤으면 진심으로 수고를 알아주고, 일이 없던 날이면 억지 긍정 없이 담담히 쉬라고.
- 이모지는 없거나 최대 1개. ${n}개는 서로 확실히 다른 말이어야 합니다.

[좋은 예 — 이 정도 길이·따뜻함]
"밥은 챙겨 드셨어요? 조심히 다녀오세요." / "그늘에서 물 자주 드시며 쉬엄쉬엄해요." / "오늘 고생 많았어요, 얼른 씻고 푹 쉬어요." / "너무 조바심 내지 말고 편히 기다려요."

[오늘 상황]
${facts}

JSON "하나만" 출력: {"lines": ["문구1", "문구2", ...]}`;
}

// 안전망 풀(사람이 써둔 존댓말) — AI 실패/빈응답 시 대체.
// 계절 중립(방한/더위 어느 쪽으로도 안 치우친) 문구 — AI 실패 시에도 어색하지 않게.
const FALLBACK = {
  work_active: ['오늘도 다치지 않게 조심히 다녀오세요.', '밥은 챙겨 드셨어요? 든든히 먹고 나가요.', '무리하지 말고 천천히, 안전하게 하세요.', '물 자주 마시면서 하세요, 힘내요.'],
  work_done: ['오늘 하루 정말 수고 많으셨어요, 푹 쉬세요.', '고생했어요, 밥 꼭 챙겨 드시고 쉬어요.', '다리 아프죠, 오늘은 얼른 씻고 쉬세요.', '무사히 마쳤으니 이제 편히 쉬어요.'],
  spare: ['너무 조바심 내지 말고 편하게 기다려요.', '물 한 잔 마시면서 여유 있게 기다려요.', '대기하느라 힘들죠, 잠깐 앉아서 쉬어요.', '밥은 드셨어요? 속 든든하게 챙겨요.'],
  off_today: ['오늘은 쉬는 날이니 푹 쉬세요.', '모처럼 쉬는 날, 편하게 보내요.', '오늘은 아무 걱정 말고 쉬어요.'],
  nextday: ['오늘도 고생했어요, 저녁 챙겨 먹고 푹 자요.', '오늘은 이만 쉬고 내일 또 힘내요.', '얼른 씻고 일찍 잠자리에 들어요.', '고단한 하루였죠, 오늘은 푹 쉬세요.'],
};

// 계절 금지어 하드 필터 — 여름엔 추운 뉘앙스, 겨울엔 더운 뉘앙스 문구를 아예 축출.
//  (봄/가을은 온화하므로 필터 없음. 골프장갑 오탐 방지 위해 '장갑'은 목록에서 제외.)
const SEASON_BAN = {
  여름: /따뜻|따끈|몸.?녹|녹여|녹이|핫팩|감기|체온|방한|외투|겉옷|점퍼|패딩|목도리|내복|두껍게|두툼|춥|추워|추운|추울|추위|쌀쌀|싸늘|냉기|한파|얼어|동상/,
  겨울: /더위|더워|더운|더울|무더|폭염|열대야|시원|자외선|선크림|그늘|열사병|일사병|부채|선풍기|에어컨|얼음물|아이스|땀/,
};
function seasonOk(line, season) {
  const re = SEASON_BAN[season];
  return !re || !re.test(line);
}

// ★Gemini 응원문구 생성 게이트 — 기본 OFF(GEMINI_CHEER=1일 때만). 크레딧 고갈 시 429 스팸·앱 지연 방지.
//  꺼지면 빈 풀 반환 → getCheer가 사람이 써둔 안전망 문구로 대체(따뜻함 유지, 비용 0).
const useGeminiCheer = () => ['1', 'true', 'yes'].includes(String(process.env.GEMINI_CHEER || '').toLowerCase());
async function generatePool(facts, season, n = 6) {
  if (!useGeminiCheer()) return [];
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const out = await callGeminiJSON(buildPrompt(facts, n), null, model, { temperature: 1.0, topP: 0.95 });
  const lines = Array.isArray(out?.lines) ? out.lines : [];
  // 길이 컷(30자 초과만 버림 — 한두 줄로 깔끔히 끝나게, 따뜻함은 유지) + 계절 금지어 컷.
  return lines.map((l) => String(l || '').trim())
    .filter((l) => l.length >= 6 && l.length <= 30 && seasonOk(l, season)).slice(0, n);
}

// 공개: 현재 회원의 응원 문구 풀을 얻는다(캐시 우선, 장면 바뀌면 재생성, 실패 시 안전망).
//  반환: { key, scene, lines:[...] }  · lines가 비면 화면에서 숨김.
export async function getCheer(userId = 1) {
  const now = kstNow();
  const s = buildScene(userId, now);
  if (s.scene === 'skip') return { key: 'skip', scene: 'skip', lines: [] };

  const wx = await currentWeather(now.iso, now.hour);
  const key = stateKey(s, now, wx);

  const cached = loadUserJSON(userId, FILE, null);
  if (cached && cached.key === key && Array.isArray(cached.lines) && cached.lines.length) {
    return { key, scene: s.scene, lines: cached.lines };
  }

  const season = seasonKo(Number(now.iso.split('-')[1]) || 0);
  let lines = await generatePool(factsText(s, now, wx), season, 6);
  if (!lines.length) lines = (FALLBACK[s.scene] || []).slice();
  if (!lines.length) return { key: 'skip', scene: s.scene, lines: [] };

  saveUserJSON(userId, FILE, { key, scene: s.scene, lines, at: Date.now() });
  return { key, scene: s.scene, lines };
}
