// GitHub Actions에서 5분마다 실행: 카페 확인 → 새 3부 변동 감지 →
// 순번 계산(Gemini) → 폰 웹푸시. 상태(seen)와 최근목록(recent)은 파일로 저장 후 커밋.
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { fetchLatestArticles } from '../src/naverCafe.mjs';
import { fetchArticle } from '../src/naverArticle.mjs';
import { analyze } from '../src/analyzer.mjs';
import { analyzeTurn } from '../src/gemini.mjs';

const SEEN = 'state/seen.json';
const RECENT = 'docs/recent.json';
const MAX_SEEN = 800;
const CHANGE_MENU_ID = process.env.CHANGE_MENU_ID || '13';

function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function save(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// ── 웹푸시 준비 ──
webpush.setVapidDetails(
  'mailto:' + (process.env.CONTACT_EMAIL || 'admin@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);
const rawSub = process.env.PUSH_SUBSCRIPTION || '[]';
let subs;
try {
  const parsed = JSON.parse(rawSub);
  subs = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  console.error('⚠️ PUSH_SUBSCRIPTION 파싱 실패 — 폰 구독 정보를 Secret에 등록했는지 확인하세요.');
  subs = [];
}

async function push(title, body, url) {
  if (!subs.length) { console.log('(구독 기기 없음)'); return; }
  for (const s of subs) {
    try {
      await webpush.sendNotification(s, JSON.stringify({ title, body, url }));
      console.log('  → 푸시 발송:', title);
    } catch (e) {
      console.error('  푸시 실패:', e.statusCode || e.message);
    }
  }
}

function titleForStatus(status) {
  return status === 'your_turn' ? '🚨 지금 근무 차례!'
    : status === 'near' ? '🔔 곧 근무 차례!'
    : status === 'assigned' ? '✅ 오늘 근무 배정됨'
    : '🏌️ 3부 변동사항';
}

// ── 메인 ──
const seenArr = load(SEEN, null);
const baseline = !Array.isArray(seenArr) || seenArr.length === 0; // 파일이 없거나 비어있으면 기준선
const seen = new Set(Array.isArray(seenArr) ? seenArr : []);

let articles;
try {
  articles = await fetchLatestArticles(20);
} catch (e) {
  // 쿠키 만료 등 → 폰으로 경고
  console.error('카페 조회 실패:', e.message);
  await push('⚠️ 네이버 쿠키 만료', '감시가 멈췄어요. GitHub Secret의 쿠키를 갱신해주세요.', './');
  process.exit(0);
}

const fresh = articles.filter((a) => !seen.has(a.id));
for (const a of articles) seen.add(a.id);
save(SEEN, [...seen].slice(-MAX_SEEN));

if (baseline) {
  console.log(`[기준선] 현재 글 ${articles.length}건 기록. 다음부터 새 글만 알립니다.`);
  process.exit(0);
}

console.log(`새 글 ${fresh.length}건 검사`);
const recent = load(RECENT, []);

for (const a of fresh.reverse()) {
  const result = analyze(a);
  if (!result.relevant) { console.log('· (무관)', a.subject); continue; }

  let title = result.priority === 'high' ? '🔔 일정 소식' : '🏌️ 새 소식';
  let body = a.subject;
  let ai = null;
  try {
    const full = await fetchArticle(a.id);
    if (process.env.GEMINI_API_KEY && String(full.menuId) === CHANGE_MENU_ID && full.images.length) {
      ai = await analyzeTurn(full);
      if (ai?.message) { body = ai.message; title = titleForStatus(ai.status); }
      else title = '🏌️ 3부 변동사항';
    }
  } catch (e) {
    console.error('본문/AI 실패:', e.message);
  }

  await push(title, body, a.url);
  recent.unshift({
    id: a.id, subject: a.subject, url: a.url, menuName: a.menuName, writeDate: a.writeDate,
    aiMessage: ai?.message || null, status: ai?.status || null,
  });
}

save(RECENT, recent.slice(0, 50));
console.log('완료');
