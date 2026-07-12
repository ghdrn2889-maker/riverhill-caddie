// GitHub Actions에서 실행: 한 번 뜨면 LOOP_SECONDS 동안 INTERVAL_SECONDS 마다
// 카페를 확인해(≈1분 간격) 새 3부 변동을 감지 → 순번 계산(Gemini) → 폰 웹푸시.
// 상태(seen)와 최근목록(recent)은 실행 끝에 한 번 저장 후 커밋.
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
const LOOP_SECONDS = Number(process.env.LOOP_SECONDS || 240);      // 이 실행이 도는 총 시간(초)
const INTERVAL_SECONDS = Number(process.env.INTERVAL_SECONDS || 60); // 확인 간격(초)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function load(file, fb) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fb; } }
function save(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

// ── 웹푸시 준비 ──
webpush.setVapidDetails(
  'mailto:' + (process.env.CONTACT_EMAIL || 'admin@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);
let subs;
try {
  const parsed = JSON.parse(process.env.PUSH_SUBSCRIPTION || '[]');
  subs = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  console.error('⚠️ PUSH_SUBSCRIPTION 파싱 실패'); subs = [];
}
async function push(title, body, url) {
  if (!subs.length) { console.log('(구독 기기 없음)'); return; }
  for (const s of subs) {
    try { await webpush.sendNotification(s, JSON.stringify({ title, body, url })); console.log('  → 푸시:', title); }
    catch (e) { console.error('  푸시 실패:', e.statusCode || e.message); }
  }
}
function titleForStatus(status) {
  return status === 'your_turn' ? '🚨 지금 근무 차례!'
    : status === 'near' ? '🔔 곧 근무 차례!'
    : status === 'assigned' ? '✅ 오늘 근무 배정됨'
    : '🏌️ 3부 변동사항';
}

// ── 상태 로드 ──
const seenArr = load(SEEN, null);
let baseline = !Array.isArray(seenArr) || seenArr.length === 0;
const seen = new Set(Array.isArray(seenArr) ? seenArr : []);
const recent = load(RECENT, []);
let cookieAlerted = false;

// 한 번 확인. 성공하면 true, 조회 실패(쿠키 만료 등)면 false.
async function checkOnce() {
  let articles;
  try {
    articles = await fetchLatestArticles(20);
  } catch (e) {
    console.error('조회 실패:', e.message);
    if (!cookieAlerted) {
      cookieAlerted = true;
      await push('⚠️ 네이버 쿠키 만료', '감시가 멈췄어요. GitHub Secret의 NID_AUT/NID_SES를 갱신해주세요.', './');
    }
    return false;
  }

  const fresh = articles.filter((a) => !seen.has(a.id));
  for (const a of articles) seen.add(a.id);

  if (baseline) {
    baseline = false;
    console.log(`[기준선] 현재 글 ${articles.length}건 기록`);
    return true;
  }

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
  return true;
}

// ── 반복 루프 (≈1분 간격) ──
const started = Date.now();
let n = 0;
while (true) {
  n++;
  console.log(`--- 확인 #${n} (${new Date().toISOString()}) ---`);
  const ok = await checkOnce();
  if (!ok) break; // 쿠키 만료 등 → 이번 실행 종료 (다음 예약 때 재시도)
  if (Date.now() - started >= LOOP_SECONDS * 1000) break;
  await sleep(INTERVAL_SECONDS * 1000);
}

save(SEEN, [...seen].slice(-MAX_SEEN));
save(RECENT, recent.slice(0, 50));
console.log(`실행 종료 (총 ${n}회 확인)`);
