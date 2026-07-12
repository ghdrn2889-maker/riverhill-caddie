// 서버: PWA 파일 서빙 + 구독 API + 크롤러 구동 + 새 일정글 발생 시 푸시.
import { loadEnv, ROOT_DIR } from './env.mjs';
loadEnv();

import express from 'express';
import path from 'node:path';
import { initPush, addSubscription, broadcast } from './push.mjs';
import { startCrawler } from './crawler.mjs';
import { PERSONAL_REQUEST_RE } from './analyzer.mjs';
import { fetchArticle } from './naverArticle.mjs';
import { analyzeTurn } from './gemini.mjs';
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
    res.json({ ok: true, ...out });
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

// 본문을 보고 '나(김홍구, 3부)와 관련 있는 글'인지 최종 판단.
function isForMe(full) {
  const name = (process.env.MY_NAME || '').trim();
  const part = (process.env.MY_PART || '').trim();
  const blob = `${full.subject}\n${full.head || ''}\n${full.text || ''}`;
  const mentionsMe = name && blob.includes(name);
  const mentionsPart = part && blob.includes(`${part}부`);
  return { mentionsMe, mentionsPart };
}

const CHANGE_MENU_ID = process.env.CHANGE_MENU_ID || '13'; // 당일 변동사항

function titleForStatus(status) {
  return status === 'your_turn' ? '🚨 지금 근무 차례!'
    : status === 'near' ? '🔔 곧 근무 차례!'
    : status === 'assigned' ? '✅ 오늘 근무 배정됨'
    : '🏌️ 3부 변동사항';
}

// 전체 본문을 가져와 (필요시 AI 순번계산) 폰으로 푸시하고 최근목록에 저장.
async function notifyForArticle(full, result = { hits: [], priority: 'high' }) {
  const { mentionsMe, mentionsPart } = isForMe(full);

  // 남의 개인 근태 신청글(휴무/후출/조출 등)은 내 이름이 없으면 제외.
  // 본문/말머리까지 검사 (제목만으로 못 거른 경우의 백업).
  const label = `${full.head || ''} ${full.subject}`;
  if (PERSONAL_REQUEST_RE.test(label) && !mentionsMe) {
    console.log(`·  (개인 근태글, 건너뜀) [${full.head || ''}] ${full.subject} — ${full.writer || ''}`);
    return { skipped: true };
  }

  // 당일 변동 게시판인데 이미지도 없고 나/3부 언급도 없으면
  // = 남의 개인 요청(예: "우정민 휴무신청") → 알림/피드에서 제외.
  if (String(full.menuId) === CHANGE_MENU_ID && !full.images.length && !mentionsMe && !mentionsPart) {
    console.log(`·  (나와 무관, 건너뜀) [${full.head || ''}] ${full.subject} — ${full.writer || ''}`);
    return { skipped: true };
  }

  let title = result.priority === 'high' ? '🔔 일정 소식' : '🏌️ 새 소식';
  let body = full.subject;
  let ai = null;

  if (process.env.GEMINI_API_KEY && String(full.menuId) === CHANGE_MENU_ID && full.images.length) {
    ai = await analyzeTurn(full);
    if (ai?.message) { body = ai.message; title = titleForStatus(ai.status); }
    else title = '🏌️ 3부 변동사항';
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
