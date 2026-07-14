// 서버: PWA 파일 서빙 + 구독 API + 크롤러 구동 + 새 일정글 발생 시 푸시.
import { loadEnv, ROOT_DIR } from './env.mjs';
loadEnv();

import express from 'express';
import path from 'node:path';
import { initPush, addSubscription, broadcast } from './push.mjs';
import { startCrawler } from './crawler.mjs';
import { isScheduleWriter, PERSONAL_REQUEST_RE } from './analyzer.mjs';
import { fetchArticle } from './naverArticle.mjs';
import { analyzeTurn, analyzeSchedule } from './gemini.mjs';
import { judge } from './judge.mjs';
import { loadJSON, saveJSON } from './store.mjs';

initPush();

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT_DIR, 'public')));

// PWA 가 구독할 때 필요한 공개키
app.get('/api/config', (req, res) => {
  res.json({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY });
});

// 폰에서 '알림 켜기' 누르면 이 구독 정보가 저장됨
app.post('/api/subscribe', (req, res) => {
  if (!req.body?.endpoint) return res.status(400).json({ error: '잘못된 구독 정보' });
  addSubscription(req.body);
  res.json({ ok: true });
});

// 앱 화면에 보여줄 최근 감지 목록
app.get('/api/recent', (req, res) => {
  res.json(loadJSON('recent.json', []));
});

// 테스트용: 지금 바로 내 폰으로 알림 한 번 쏴보기
app.post('/api/test', async (req, res) => {
  await broadcast({ title: '🏌️ 테스트 알림', body: '알림이 정상 작동합니다!', url: '/' });
  res.json({ ok: true });
});

// 라이브 테스트용: 특정 글을 실제로 분석해서 폰으로 푸시 (?id=26231)
app.post('/api/simulate', async (req, res) => {
  const id = req.body?.id || req.query.id;
  if (!id) return res.status(400).json({ error: 'id 필요 (예: /api/simulate?id=26231)' });
  try {
    const full = await fetchArticle(id);
    const out = await notifyForArticle(full, { hits: [], priority: 'high' }, { force: true });
    res.json({ ok: true, writer: full.writer, menuId: full.menuId, menuName: full.menuName, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 새 두뇌(judge) 검증용: 글을 통합 판단기로만 돌려 결과 확인 (푸시 안 함, 라이브 흐름 무관).
app.post('/api/judge', async (req, res) => {
  const id = req.body?.id || req.query.id;
  if (!id) return res.status(400).json({ error: 'id 필요 (예: /api/judge?id=26299)' });
  try {
    const full = await fetchArticle(id);
    const baseline = loadJSON('baseline.json', null);
    const out = await judge(full, baseline);
    res.json({ ok: true, subject: full.subject, writer: full.writer, menuId: full.menuId,
      push: out.push, title: out.title, body: out.body, verdict: out.rawVerdict });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`🌐 서버 실행: http://localhost:${PORT}`));

function saveRecent(article, result, ai) {
  const recent = loadJSON('recent.json', []);
  recent.unshift({
    ...article,
    hits: result.hits,
    priority: result.priority,
    aiMessage: ai?.message || null,
    status: ai?.status || null,
    detectedAt: Date.now(),
  });
  saveJSON('recent.json', recent.slice(0, 100));
}

// 본문을 보고 '나(김홍구)'가 글/본문에 직접 언급됐는지.
function mentionsMe(full) {
  const name = (process.env.MY_NAME || '').trim();
  const blob = `${full.subject}\n${full.head || ''}\n${full.text || ''}`;
  return !!(name && blob.includes(name));
}

// 내 부(3부) 티오프 시간대 (이 시간대의 추가/변동만 나와 관련). 기본: 3부=15시 이후.
function myPartHours() {
  const part = (process.env.MY_PART || '3').trim();
  const def = part === '1' ? [5, 10] : part === '2' ? [10, 15] : [15, 24];
  const s = Number(process.env.PART_START_HOUR ?? def[0]);
  const e = Number(process.env.PART_END_HOUR ?? def[1]);
  return [s, e];
}

// 내 부(3부)와 관련된 글인지 판단.
//  - 내 이름/내 부(3부) 언급 → 관련(true)
//  - 다른 부(1·2·4·5부)만 언급 → 무관(false)
//  - 티오프 시간이 있는데 전부 내 부 시간대 밖 → 무관(false)  (예: 아침 6:30 추가 = 1부)
//  - 그 외(부/시간 정보 없음 = 전체 공지 등) → 관련(true)
function partRelevant(full) {
  const part = (process.env.MY_PART || '').trim();
  if (!part) return true;
  const name = (process.env.MY_NAME || '').trim();
  const blob = `${full.subject}\n${full.head || ''}\n${full.text || ''}`;
  if (name && blob.includes(name)) return true;
  if (blob.includes(`${part}부`)) return true;

  const others = ['1부', '2부', '3부', '4부', '5부'].filter((p) => p !== `${part}부`);
  if (others.some((p) => blob.includes(p))) return false; // 다른 부만 언급

  // 티오프 시간대 판별 (HH:MM 들이 있는데 내 부 시간대가 하나도 없으면 무관)
  const [startH, endH] = myPartHours();
  const hours = [...blob.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => Number(m[1]));
  if (hours.length && !hours.some((h) => h >= startH && h < endH)) return false;

  return true; // 부/시간 단서 없음 → 전체 공지로 보고 통과
}

// 번호표 이미지에서 읽은 순번 명단을 baseline 에 저장 (이후 텍스트-only 변동 계산에 재사용).
function saveRoster(nameList) {
  const b = loadJSON('baseline.json', {}) || {};
  b.spareList = nameList;
  b.rosterAt = Date.now();
  saveJSON('baseline.json', b);
  console.log(`[명단 저장] 번호표에서 ${nameList.length}명 순번 확보`);
}

// 배치표 조 표시(dayStatus)로 role 을 코드가 확정 (Gemini role 오판 방지) + 메시지 정리.
function deriveScheduleRole(ai) {
  const name = (process.env.MY_NAME || '').trim();
  const part = (process.env.MY_PART || '').trim();
  const ds = ai.dayStatus || '';
  const d = ai.dateLabel || '';
  let role = ai.role || 'unknown';
  if (/휴무|휴가|병가/.test(ds)) role = 'off';
  else if (/\b54\b|54/.test(ds)) role = 'work';
  else if (new RegExp(`${part}부`).test(ds) || /2\s*[,、]\s*3/.test(ds)) role = 'spare';
  const message = role === 'off' ? `${name}님, ${d} 휴무입니다. 편히 쉬세요`
    : role === 'work' ? `${name}님, ${d} 근무입니다 (출근 확정)`
    : role === 'spare' ? `${name}님, ${d} ${part}부 스페어(대기)입니다. 근무 순번이 오면 바로 알려드릴게요`
    : (ai.message || `${name}님, ${d} 배치표 확인하세요`);
  return { ...ai, role, status: role, message };
}

// 배치표에서 뽑은 '오늘의 김홍구 기준점 + 3부 스페어 명단'을 저장.
function saveBaseline(full, ai) {
  const baseline = {
    date: ai.dateLabel || full.writeDate || '',
    name: (process.env.MY_NAME || '').trim(),
    part: ai.part || `${(process.env.MY_PART || '').trim()}부`,
    role: ai.role || ai.status || '',
    dayStatus: ai.dayStatus || '',
    spareList: Array.isArray(ai.spareList) ? ai.spareList : [],
    myIndex: ai.myIndex ?? null,
    articleId: full.id,
    savedAt: Date.now(),
  };
  saveJSON('baseline.json', baseline);
  console.log(`[기준점 저장] ${baseline.date} ${baseline.role} (스페어 ${baseline.myIndex ?? '-'}/${baseline.spareList.length}명)`);
}

// 티오프 시간(HH:MM) → 골프장 도착시간 + 집 출발시간 계산.
//  도착(출근) = 티오프 - 준비시간(기본 60분),  집출발 = 도착 - 이동시간(기본 60분).
function commuteInfo(teeTime) {
  const m = String(teeTime || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const prep = Number(process.env.PREP_MIN ?? 60);       // 골프장 도착 후 근무 준비
  const commute = Number(process.env.COMMUTE_MIN ?? 60); // 집 → 골프장 이동
  const tot = Number(m[1]) * 60 + Number(m[2]);
  const fmt = (mins) => {
    const x = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  };
  return { tee: fmt(tot), arrive: fmt(tot - prep), leave: fmt(tot - prep - commute) };
}

// 출근 확정 시 메시지에 붙일 '티오프/도착/집출발' 안내 한 줄.
function commuteLine(teeTime, course) {
  const c = commuteInfo(teeTime);
  if (!c) return '';
  const crs = course ? ` (${String(course).toUpperCase()}코스)` : '';
  return `\n⛳ 티오프 ${c.tee}${crs} · ${c.arrive} 도착 · 집에서 ${c.leave} 출발`;
}

// 남은 인원(remaining) → 상태/메시지 (계산은 항상 코드가; Gemini 산수 안 씀).
function turnResult(name, cutoff, remaining, extra = {}) {
  let status, message;
  // 티오프가 이미 잡혀 있으면 그 자체가 확정 증거 → 커트라인 꼬리표(지어냈을 수 있음)는 생략.
  const tail = (cutoff && !extra.teeTime) ? ` (${cutoff}님까지 근무)` : '';
  if (remaining < 0) {
    status = 'assigned';
    message = `${name}님, 오늘 근무 배정됐어요!${tail}`;
  } else if (remaining === 0) {
    status = 'your_turn';
    message = `${name}님, 지금 출근하실 차례예요!${tail}`;
  } else {
    status = remaining <= 2 ? 'near' : 'waiting';
    const before = extra.before ? ` (바로 앞 ${extra.before}님)` : '';
    message = `${name}님, 앞으로 ${remaining}명 남았어요${before}${tail}`;
  }
  // 출근 확정(배정/내 차례)이고 티오프 시간을 읽었으면 출근·출발 시간을 덧붙임.
  if ((status === 'assigned' || status === 'your_turn') && extra.teeTime) {
    message += commuteLine(extra.teeTime, extra.course);
  }
  // 제목/본문에서 뽑은 주의사항(시간 변동 가능/취소 등)이 있으면 경고로 덧붙임.
  if (extra.note && String(extra.note).trim()) {
    message += `\n⚠️ ${String(extra.note).trim()}`;
  }
  return { found: true, cutoffName: cutoff, remaining, status, message, ...extra };
}

// 저장된 3부 스페어 명단 + 변동글의 "○○님까지" 로 남은 인원을 코드로 계산 (이미지 불필요).
function computeTurnFromRoster(full, baseline) {
  const list = baseline?.spareList;
  if (!Array.isArray(list) || list.length === 0) return null;
  // 명단이 하루 지났으면(어제 것) 신뢰 안 함 → null 반환해 오늘 이미지로 다시 읽게 함
  const age = baseline.rosterAt ? Date.now() - baseline.rosterAt : Infinity;
  if (age > 18 * 3600 * 1000) return null;
  const name = baseline.name || (process.env.MY_NAME || '').trim();
  const blob = `${full.subject}\n${full.text || ''}`;
  const m = blob.match(/([가-힣]{2,4})\s*님?\s*까지/); // "○○님까지"
  if (!m) return null;
  const cutoff = m[1].replace(/님$/, ''); // 이름에 딸려온 "님" 제거
  const norm = (s) => String(s).replace(/\(.*?\)/g, '').trim();       // 괄호 밖(주 이름)
  const paren = (s) => (String(s).match(/\(([^)]*)\)/) || [])[1] || ''; // 괄호 안
  const isPerson = (p) => /[가-힣]{2,4}/.test(p) && !/54|2\s*,\s*3/.test(p);
  // 순번 교환 반영: 'X(대상)'처럼 괄호 안에 대상이 있으면 그 자리가 진짜 순번(우선).
  const findEff = (target) => {
    let i = list.findIndex((n) => paren(n).includes(target)); // 괄호 안에 target
    if (i < 0) i = list.findIndex((n) => norm(n) === target && !isPerson(paren(n))); // 주 이름 target (교환 아님)
    if (i < 0) i = list.findIndex((n) => { const a = norm(n); return a.includes(target) || target.includes(a); });
    return i;
  };
  const ci = findEff(cutoff);
  const mi = findEff(name);
  if (ci < 0 || mi < 0) return null;
  const before = mi > 0 ? norm(list[mi - 1]) : '';
  return turnResult(name, cutoff, mi - ci - 1, { source: 'roster', before });
}

// Gemini가 읽은 '위치'(myPosition/cutoffPosition)로 remaining 을 코드가 다시 계산.
// (Gemini는 위치는 잘 읽지만 뺄셈을 자주 틀림 → 산수는 코드가 담당)
function refineTurn(ai, name) {
  if (!ai || ai.found === false) return ai;
  // 티오프가 배정돼 있으면 = 출근 확정. 커트라인 산수와 무관하게 assigned + 출근/출발시간.
  if (ai.teeTime && /\d{1,2}:\d{2}/.test(ai.teeTime)) {
    return turnResult(name, '', -1, {
      source: 'vision', teeTime: ai.teeTime, course: ai.course || '',
      myPosition: Number(ai.myPosition) || null, note: ai.note || '',
    });
  }
  const mp = Number(ai.myPosition), cp = Number(ai.cutoffPosition);
  if (!Number.isFinite(mp) || !Number.isFinite(cp)) return ai;
  return turnResult(name, ai.cutoffName || '', mp - cp - 1, {
    source: 'vision', myPosition: mp, cutoffPosition: cp, note: ai.note || '',
  });
}

// AI 결과를 '내 상태' 시그니처로 요약 → 직전과 같으면 변동 없음(중복 알림 방지).
// 중복 알림 방지 시그니처. 글번호(full.id)를 포함해 '서로 다른 글'은 절대 안 막는다.
//  → 삭제 후 재게시/수정본(새 글번호)도 항상 알림. 같은 글 반복 처리는 크롤러 seen.json이 이미 차단.
function stateSig(full, ai) {
  if (!ai || ai.found === false) return null;
  const d = ai.dateLabel || full.writeDate || '';
  if (ai.role) return `${full.id}|sch|${d}|${ai.role}|${ai.teeTime || ''}`;
  if (ai.status) return `${full.id}|turn|${d}|${ai.status}|${ai.remaining ?? ''}|${ai.cutoffName || ''}|${ai.teeTime || ''}`;
  return null;
}

const CHANGE_MENU_ID = process.env.CHANGE_MENU_ID || '13';     // 당일 변동사항
const SCHEDULE_MENU_ID = process.env.SCHEDULE_MENU_ID || '2';  // 배치 시간표(배치표)

// AI가 판단한 상태(status)에 맞춰 알림 제목을 정한다.
function titleForStatus(status) {
  switch (status) {
    case 'your_turn': return '🚨 지금 출근 순번!';
    case 'near':      return '🔔 곧 출근 순번!';
    case 'assigned':  return '✅ 오늘 근무 배정됨';
    case 'waiting':   return '🏌️ 3부 대기 현황';
    case 'work':      return '✅ 출근 확정!';
    case 'spare':     return '🏌️ 스페어(대기)';
    case 'off':       return '😴 근무 없음';
    default:          return '🏌️ 새 소식';
  }
}

// 피드에 저장할 항목 (관련·무관 모두 — 데이터는 절대 안 버린다).
function saveRecentV2(full, out) {
  const v = out.rawVerdict || {};
  const recent = loadJSON('recent.json', []);
  recent.unshift({
    id: full.id, subject: full.subject, writer: full.writer, url: full.url,
    menuId: full.menuId, menuName: full.menuName, writeDate: full.writeDate,
    aiMessage: out.relevant ? out.body : (v.summary || null),
    status: out.status || null,
    category: v.category || null,
    relevant: !!out.relevant,
    push: out.push,
    priority: out.push === 'high' ? 'high' : 'info',
    detectedAt: Date.now(),
  });
  saveJSON('recent.json', recent.slice(0, 100));
}

// 배치표 판정에서 '오늘 내 기준(부/역할/순번/티오프)'을 뽑아 저장 → 다음 글 판단 앵커.
function saveBaselineFromVerdict(full, v) {
  const s = v.myStatus;
  const role = (s === 'work' || s === 'assigned' || s === 'your_turn') ? 'work'
    : s === 'off' ? 'off' : (s === 'spare' || s === 'waiting') ? 'spare' : '';
  const baseline = {
    date: v.dateLabel || full.writeDate || '',
    name: (process.env.MY_NAME || '').trim(),
    part: `${(process.env.MY_PART || '').trim()}부`,
    role, myPosition: v.myPosition ?? null, teeTime: v.teeTime || '',
    articleId: full.id, savedAt: Date.now(),
  };
  saveJSON('baseline.json', baseline);
  console.log(`[기준표] ${baseline.date} ${role || '?'} pos=${baseline.myPosition ?? '-'} tee=${baseline.teeTime || '-'}`);
}

// 새 두뇌(judge)로 판단 → 피드-우선 저장 → 확신도 라우팅으로 푸시.
//  push: 'high'(바로 알림) | 'check'(확인필요 알림) | 'low'(피드만, 무푸시)
async function notifyForArticle(full, result = {}, opts = {}) {
  const baseline = loadJSON('baseline.json', null);
  const out = await judge(full, baseline);
  const v = out.rawVerdict;
  const ret = { push: out.push, title: out.title, body: out.body, status: out.status, relevant: out.relevant, category: v?.category || null };

  // 피드-우선: 관련 여부와 무관하게 항상 피드에 기록(놓침 구조적 불가).
  saveRecentV2(full, out);

  // 배치표에서 내 상태를 읽었으면 기준표 갱신(다음 글 판단 앵커).
  if (out.relevant && v && v.category === '배치표' && v.myStatus && v.myStatus !== 'unknown') {
    saveBaselineFromVerdict(full, v);
  }

  // 라우팅: 무관/가배치 → 피드에만, 푸시 안 함.
  if (out.push === 'low') {
    console.log(`·  (피드만) ${full.subject} — ${v?.category || ''} (relevant=${out.relevant})`);
    return { pushed: false, ...ret };
  }

  // 중복 푸시 방지(글번호 기반 → 서로 다른 글은 항상 통과). opts.force 면 건너뜀.
  if (!opts.force) {
    const sig = `${full.id}|${out.status}|${v?.teeTime || ''}`;
    const last = loadJSON('laststate.json', {});
    if (last.sig === sig) { console.log(`·  (직전과 동일 → 무푸시) ${full.subject}`); return { pushed: false, ...ret }; }
    saveJSON('laststate.json', { sig, at: Date.now(), subject: full.subject });
  }

  await broadcast({ title: out.title, body: out.body, url: full.url });
  console.log(`🔔 [${out.push}] ${out.title} | ${String(out.body).replace(/\n/g, ' ')}`);
  return { pushed: true, ...ret };
}

startCrawler({
  onMatch: async (article, result) => {
    try {
      const full = await fetchArticle(article.id);
      full.writer = full.writer || article.writer || '';
      full.writeDate = full.writeDate || article.writeDate || '';
      await notifyForArticle(full, result);
    } catch (e) {
      console.error('본문 분석 실패, 제목으로 알림:', e.message);
      saveRecent(article, result, null);
      const title = result.priority === 'high' ? '🔔 일정 소식' : '🏌️ 새 소식';
      await broadcast({ title, body: article.subject, url: article.url });
    }
  },
  onCafeError: async () => {
    await broadcast({
      title: '⚠️ 네이버 쿠키 만료',
      body: '카페 감시가 멈췄어요. .env 의 쿠키를 새로 갱신해주세요.',
      url: '/',
    });
  },
});
