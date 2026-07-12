#!/usr/bin/env node
// 글 읽기(v2.1) 응답의 전체 구조를 data/article-dump.json 에 저장한다.
// (본문/이미지 필드 이름을 정확히 파악해서 파서를 짜기 위함)
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, ROOT_DIR } from '../src/env.mjs';
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

async function readArticle(id) {
  const url = `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${CLUB}/articles/${id}?query=&useCafeId=true&requestFrom=A`;
  const res = await fetch(url, H);
  return { id, status: res.status, body: await res.json() };
}

const list = await fetchLatestArticles(20);
// 배치표(이미지형) 1건 + 최신 텍스트 업데이트 몇 건을 골라 덤프
const baechi = list.find((a) => a.subject.includes('배치표'));
const picks = [];
if (baechi) picks.push(baechi);
for (const a of list.slice(0, 4)) if (!picks.some((p) => p.id === a.id)) picks.push(a);

const out = [];
for (const a of picks) {
  const r = await readArticle(a.id);
  out.push({ subject: a.subject, ...r });
  console.log(`덤프: #${a.id} (HTTP ${r.status})  ${a.subject}`);
}

const file = path.join(ROOT_DIR, 'data', 'article-dump.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`\n✅ 저장 완료 → data/article-dump.json  (${picks.length}건)`);
console.log('이제 클로드가 이 파일을 읽고 파서를 만듭니다.');
