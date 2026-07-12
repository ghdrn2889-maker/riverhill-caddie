#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 엔드포인트 탐침: 새 네이버 카페(f-e)의 '전체글' 목록 API가
// 어떤 주소인지 여러 후보를 한 번에 시험해서 찾아낸다.
// 실행: node spike/probe.mjs   → 출력 전체를 클로드에게 붙여넣기
// ─────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) { console.error('❌ .env 없음'); process.exit(1); }
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const CLUB = process.env.CAFE_CLUB_ID || '31185658';
const MENU = process.env.CAFE_MENU_ID || '0';
const COOKIE = `NID_AUT=${process.env.NID_AUT}; NID_SES=${process.env.NID_SES}`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer': `https://cafe.naver.com/f-e/cafes/${CLUB}/menus/${MENU}?viewType=L`,
  'Cookie': COOKIE,
  'Accept': 'application/json, text/plain, */*',
  'X-Requested-With': 'XMLHttpRequest',
};

const CANDIDATES = [
  ['A) articleapi v3 menus/x/articles',
    `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${CLUB}/menus/${MENU}/articles?query=&page=1&pageSize=20&sortBy=TIME&viewType=L`],
  ['B) articleapi v2.1 menus/x/articles',
    `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${CLUB}/menus/${MENU}/articles?query=&page=1&pageSize=20&sortBy=TIME&viewType=L`],
  ['C) articleapi v3 cafes/x/articles (no menu)',
    `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${CLUB}/articles?query=&page=1&pageSize=20&sortBy=TIME&viewType=L`],
  ['D) articleapi v2 menus/x/articles',
    `https://apis.naver.com/cafe-web/cafe-articleapi/v2/cafes/${CLUB}/menus/${MENU}/articles?query=&page=1&pageSize=20&sortBy=TIME&viewType=L`],
  ['E) ArticleListV2 lastArticle (no menuid)',
    `https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json?search.clubid=${CLUB}&search.queryType=lastArticle&search.page=1&search.perPage=20`],
  ['F) ArticleList.json menuid',
    `https://apis.naver.com/cafe-web/cafe2/ArticleList.json?search.clubid=${CLUB}&search.menuid=${MENU}&search.page=1&search.perPage=20`],
];

// 응답 어딘가에 있는 글 목록(배열)을 재귀로 찾아본다
function findArticleArray(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (Array.isArray(obj)) {
    const looksLikeArticles = obj.length && obj.some(x =>
      x && typeof x === 'object' &&
      (x.subject || x.articleId || (x.item && (x.item.subject || x.item.articleId))));
    return looksLikeArticles ? obj : null;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const found = findArticleArray(obj[k], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function subjectOf(a) {
  return a.subject ?? a.item?.subject ?? a.title ?? a.item?.title ?? '(제목필드 못찾음)';
}

for (const [name, url] of CANDIDATES) {
  process.stdout.write(`\n▶ ${name}\n  ${url}\n`);
  try {
    const res = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    process.stdout.write(`  HTTP ${res.status}\n`);
    if (json) {
      const list = findArticleArray(json);
      if (list) {
        process.stdout.write(`  ✅ 글 목록 발견! ${list.length}건\n`);
        for (const a of list.slice(0, 5)) {
          process.stdout.write(`     · ${subjectOf(a)}\n`);
        }
        process.stdout.write(`  👉 이 후보(${name.slice(0, 2).trim()})가 정답일 확률이 높습니다.\n`);
      } else {
        process.stdout.write(`  ⚠️ 글 목록 배열은 못 찾음. 응답 앞부분:\n`);
        process.stdout.write('     ' + JSON.stringify(json).slice(0, 400) + '\n');
      }
    } else {
      process.stdout.write(`  ⚠️ JSON 아님. 앞부분: ${text.slice(0, 200).replace(/\s+/g, ' ')}\n`);
    }
  } catch (e) {
    process.stdout.write(`  ❌ 요청 실패: ${e.message}\n`);
  }
}

process.stdout.write('\n── 위 결과 전체를 복사해서 클로드에게 붙여넣어 주세요 ──\n');
