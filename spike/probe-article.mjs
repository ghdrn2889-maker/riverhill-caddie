#!/usr/bin/env node
// 글 하나의 '본문 + 첨부이미지'를 가져오는 API 주소를 찾는 탐침.
// 최신 글 1건을 골라 여러 read 엔드포인트를 시험한다.
// 실행: node spike/probe-article.mjs  → 출력 전체를 클로드에게 붙여넣기

import { loadEnv } from '../src/env.mjs';
loadEnv();
import { fetchLatestArticles } from '../src/naverCafe.mjs';

const CLUB = process.env.CAFE_CLUB_ID || '31185658';
const H = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Referer': `https://cafe.naver.com/f-e/cafes/${CLUB}/menus/0?viewType=L`,
    'Cookie': `NID_AUT=${process.env.NID_AUT}; NID_SES=${process.env.NID_SES}`,
    'Accept': 'application/json, text/plain, */*',
  },
};

const arts = await fetchLatestArticles(5);
console.log('최근 글 5건:');
arts.forEach((a, i) => console.log(`  [${i}] #${a.id}  ${a.subject}`));
const target = arts[0];
console.log(`\n▼ 대상: #${target.id}  ${target.subject}\n`);

const CANDS = [
  ['A) articleapi v2.1', `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${CLUB}/articles/${target.id}?query=&useCafeId=true&requestFrom=A`],
  ['B) articleapi v3',   `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${CLUB}/articles/${target.id}?query=&useCafeId=true&requestFrom=A`],
  ['C) articleapi v2',   `https://apis.naver.com/cafe-web/cafe-articleapi/v2/cafes/${CLUB}/articles/${target.id}?query=&useCafeId=true`],
  ['D) ArticleRead.json', `https://apis.naver.com/cafe-web/cafe2/ArticleRead.json?clubid=${CLUB}&articleid=${target.id}`],
];

// naver 이미지 호스트 URL 추출
function findImages(s) {
  const re = /https?:\\?\/\\?\/[^"'\\ )]+?(?:pstatic\.net|cafefiles|cafeptthumb|phinf)[^"'\\ )]*/gi;
  return [...new Set((s.match(re) || []).map((u) => u.replace(/\\\//g, '/')))].slice(0, 6);
}

for (const [name, url] of CANDS) {
  console.log(`\n▶ ${name}`);
  try {
    const res = await fetch(url, H);
    const text = await res.text();
    console.log(`  HTTP ${res.status}`);
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (json) {
      const flat = JSON.stringify(json);
      const looksError = flat.includes('9999') || flat.includes('errorCode');
      console.log(`  최상위 키: ${Object.keys(json).join(', ')}`);
      console.log(`  ${looksError ? '⚠️ 에러 응답' : '✅ 응답 OK'}  (길이 ${flat.length})`);
      const imgs = findImages(flat);
      if (imgs.length) console.log('  🖼 이미지 URL:', imgs);
      console.log('  스니펫:', flat.slice(0, 260));
    } else {
      console.log('  (JSON 아님):', text.slice(0, 160).replace(/\s+/g, ' '));
    }
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
  }
}
console.log('\n── 위 출력 전체를 복사해서 클로드에게 붙여넣어 주세요 ──');
