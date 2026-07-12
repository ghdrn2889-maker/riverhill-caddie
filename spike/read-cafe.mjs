#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 스파이크(검증) 스크립트
// 목적: 운영자 네이버 쿠키로 리버힐 카페 '전체글' 최신 목록을
//       내부 JSON API로 실제 읽어올 수 있는지 확인한다.
// 이게 성공하면 → 크롤러/푸시/PWA 를 그 위에 쌓으면 된다.
// 실행: npm run spike   (Node 18 이상 필요)
// ─────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── .env 로드 (외부 라이브러리 없이) ──
function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) {
    console.error('❌ .env 파일이 없습니다.');
    console.error('   .env.example 을 복사해 .env 로 만들고 쿠키를 채워주세요.');
    console.error('   (PowerShell)  Copy-Item .env.example .env');
    process.exit(1);
  }
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const CLUB_ID = process.env.CAFE_CLUB_ID || '31185658';
const MENU_ID = process.env.CAFE_MENU_ID || '0';
const NID_AUT = process.env.NID_AUT;
const NID_SES = process.env.NID_SES;
const KEYWORDS = (process.env.KEYWORDS || '배치표,당일추가,3부')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!NID_AUT || !NID_SES || NID_AUT.includes('여기에') || NID_SES.includes('여기에')) {
  console.error('❌ .env 의 NID_AUT / NID_SES 쿠키 값을 채워주세요. (README 의 "쿠키 얻는 법")');
  process.exit(1);
}

// 네이버 카페 내부 API — 전체글(lastArticle) 최신 목록
const url = 'https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json'
  + `?search.clubid=${CLUB_ID}`
  + '&search.queryType=lastArticle'
  + `&search.menuid=${MENU_ID}`
  + '&search.page=1'
  + '&search.perPage=20';

console.log(`🔎 리버힐 카페(${CLUB_ID}) 전체글 최신 20건 요청...\n`);

let res;
try {
  res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': `https://cafe.naver.com/f-e/cafes/${CLUB_ID}/menus/${MENU_ID}?viewType=L`,
      'Cookie': `NID_AUT=${NID_AUT}; NID_SES=${NID_SES}`,
      'Accept': 'application/json, text/plain, */*',
    },
  });
} catch (e) {
  console.error('❌ 네트워크 요청 실패:', e.message);
  process.exit(1);
}

if (!res.ok) {
  console.error(`❌ HTTP ${res.status} ${res.statusText}`);
  console.error((await res.text()).slice(0, 1500));
  process.exit(1);
}

const data = await res.json();
const list = data?.message?.result?.articleList;

if (!Array.isArray(list)) {
  console.error('⚠️  글 목록을 못 찾았습니다. 엔드포인트/파라미터가 바뀌었거나 로그인이 안 됐을 수 있어요.');
  console.error('아래 원본 응답을 저(클로드)에게 그대로 붙여주시면 바로 잡겠습니다:\n');
  console.error(JSON.stringify(data, null, 2).slice(0, 2500));
  process.exit(1);
}

console.log(`✅ ${list.length}건 수신 성공!\n`);
for (const a of list) {
  const when = a.writeDate
    || (a.writeDateTimestamp ? new Date(a.writeDateTimestamp).toLocaleString('ko-KR') : '(시간)');
  const subject = a.subject ?? '(제목없음)';
  const hits = KEYWORDS.filter(k => subject.includes(k));
  const mark = hits.length ? `🔔[${hits.join(',')}]` : '   ·   ';
  console.log(`${mark}  ${when}  #${a.articleId}  ${subject}   〈${a.menuName ?? '?'}〉`);
}
console.log(`\n🔔 = 감시 키워드(${KEYWORDS.join(', ')}) 가 제목에 걸린 글`);
console.log('※ 실제 제목들을 보고 키워드를 정밀 조정하면 됩니다.');
