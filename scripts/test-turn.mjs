// 실제 '당일 변동사항' 글 하나로 순번 계산(analyzeTurn)을 테스트한다.
// 사용: node scripts/test-turn.mjs [articleId]   (기본 26231 = 3부 변동)
import { loadEnv } from '../src/env.mjs';
loadEnv();
import { fetchArticle } from '../src/naverArticle.mjs';
import { analyzeTurn } from '../src/gemini.mjs';

const id = process.argv[2] || '26231';
console.log(`글 #${id} 불러오는 중...`);
const full = await fetchArticle(id);
console.log(`  제목: ${full.subject}`);
console.log(`  게시판: ${full.menuName} (menu ${full.menuId}) / 말머리: ${full.head}`);
console.log(`  이미지: ${full.images.length}개`);
if (full.images[0]) console.log(`    ${full.images[0].slice(0, 90)}...`);
console.log(`  본문텍스트: ${full.text.slice(0, 80) || '(없음)'}`);
console.log(`  댓글: ${full.comments.length}개`);

console.log('\nGemini 순번 계산 중...');
const ai = await analyzeTurn(full);
console.log('\n=== 결과 ===');
console.log(JSON.stringify(ai, null, 2));
