// 서버: PWA 파일 서빙 + 구독 API + 크롤러 구동 + 새 일정글 발생 시 푸시.
import { loadEnv, ROOT_DIR } from './env.mjs';
loadEnv();

import express from 'express';
import path from 'node:path';
import { initPush, addSubscription, broadcast } from './push.mjs';
import { startCrawler } from './crawler.mjs';
import { isScheduleWriter } from './analyzer.mjs';
import { fetchArticle } from './naverArticle.mjs';
import { analyzeTurn, analyzeSchedule } from './gemini.mjs';
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
    const out = await notifyForArticle(full);
    res.json({ ok: true, writer: full.writer, menuId: full.menuId, menuName: full.menuName, ...out });
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

// AI 결과를 '내 상태' 시그니처로 요약 → 직전과 같으면 변동 없음(중복 알림 방지).
function stateSig(full, ai) {
  if (!ai || ai.found === false) return null;
  const d = ai.dateLabel || full.writeDate || '';
  if (ai.role) return `sch|${d}|${ai.role}|${ai.team || ''}|${ai.teeTime || ''}|${ai.spareOrder ?? ''}`;
  if (ai.status) return `turn|${d}|${ai.status}|${ai.remaining ?? ''}|${ai.cutoffName || ''}`;
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
    case 'work':      return '✅ 근무입니다';
    case 'spare':     return '🏌️ 스페어(대기)입니다';
    case 'off':       return '😴 근무 없음';
    default:          return '🏌️ 새 소식';
  }
}

// 전체 본문을 가져와 (필요시 AI 순번계산) 폰으로 푸시하고 최근목록에 저장.
async function notifyForArticle(full, result = { hits: [], priority: 'high' }) {
  const trusted = isScheduleWriter(full.writer);
  const aboutMe = mentionsMe(full);

  // 1) 신뢰 작성자(번호표/배치표 담당)도 아니고, 내 이름도 없으면 → 남의 소식 → 무시
  if (!trusted && !aboutMe) {
    console.log(`·  (무관 작성자, 건너뜀) ${full.subject} — ${full.writer || ''}`);
    return { skipped: true };
  }

  let title = result.priority === 'high' ? '🔔 일정 소식' : '🏌️ 새 소식';
  let body = full.subject;
  let ai = null;

  if (process.env.GEMINI_API_KEY && full.images.length) {
    if (String(full.menuId) === CHANGE_MENU_ID) {
      // 당일 변동사항(번호표) → 순번 계산
      ai = await analyzeTurn(full);
      if (ai?.message) { body = ai.message; title = titleForStatus(ai.status); }
      else title = '🏌️ 3부 변동사항';
    } else if (String(full.menuId) === SCHEDULE_MENU_ID) {
      // 배치표 → 내가 근무/스페어인지 번역
      ai = await analyzeSchedule(full);
      if (ai?.message) { body = ai.message; title = titleForStatus(ai.status); }
      else title = '🏌️ 배치표';
    }
  }

  // 2) 배치표/번호표에 내 이름이 없으면(found=false) → 나와 무관 → 알림 안 함
  if (ai && ai.found === false) {
    console.log(`·  (배치표/번호표에 내 이름 없음, 건너뜀) ${full.subject}`);
    return { skipped: true };
  }

  // 3) 내 상태가 직전 알림과 동일하면(변동 없음) → 중복 알림 방지
  const sig = stateSig(full, ai);
  if (sig) {
    const last = loadJSON('laststate.json', {});
    if (last.sig === sig) {
      console.log(`·  (직전과 동일, 변동 없음 → 건너뜀) ${full.subject}`);
      return { skipped: true };
    }
    saveJSON('laststate.json', { sig, at: Date.now(), subject: full.subject });
  }

  saveRecent(
    { id: full.id, subject: full.subject, writer: full.writer, url: full.url, menuId: full.menuId, menuName: full.menuName, writeDate: full.writeDate },
    result, ai,
  );
  await broadcast({ title, body, url: full.url });
  return { title, body, ai };
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
