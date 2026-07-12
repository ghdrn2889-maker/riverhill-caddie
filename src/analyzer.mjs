// 목록에 뜬 새 글이 나(김홍구, 3부)에게 관련 있는지 / 우선순위 판단.
// 게시판(menuId) 기반이 가장 정확 — 당일 변동사항(13), 배치 시간표(2)는 무조건 관련.
// 이름/키워드는 보조. (실제 순번 계산은 gemini.mjs 가 담당)

export function analyze(article) {
  const name = (process.env.MY_NAME || '').trim();               // 김홍구
  const part = (process.env.MY_PART || '').trim();               // 3
  const watchMenus = (process.env.WATCH_MENU_IDS || '2,13')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const keywords = (process.env.KEYWORDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const notifyAll = (process.env.NOTIFY_MODE || 'keyword') === 'all';

  const subject = article.subject || '';
  const menuId = String(article.menuId || '');
  const hits = [];
  let priority = 'info';

  // 1) 감시 게시판(당일 변동사항/배치 시간표)에 올라온 글 → 최우선
  if (watchMenus.includes(menuId)) {
    hits.push(`게시판:${article.menuName || menuId}`);
    priority = 'high';
  }
  // 2) 내 이름 직접 언급
  if (name && subject.includes(name)) {
    hits.push(`이름:${name}`);
    priority = 'high';
  }
  // 3) 내 부(部) 언급
  if (part && subject.includes(`${part}부`)) {
    hits.push(`${part}부`);
    if (priority !== 'high') priority = 'medium';
  }
  // 4) 신호어(보조) — 표시용으로만 기록. 단독으로는 알림을 띄우지 않는다.
  //    (예: 남의 "휴무" 글이 키워드만으로 알림 오던 문제 방지)
  for (const k of keywords) if (subject.includes(k)) hits.push(k);

  // 알림 대상: 감시 게시판 / 내 이름 / 내 부(部) 언급이 있을 때만.
  // 키워드만 걸린 글은 제외한다.
  const relevant = notifyAll || priority === 'high' || priority === 'medium';
  return { relevant, hits, priority };
}
