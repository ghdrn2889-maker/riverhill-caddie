// 목록에 뜬 새 글이 나(김홍구, 3부)에게 관련 있는지 / 우선순위 판단.
//
// 핵심 규칙(작성자 중심):
//  - 번호표/배치표 담당 작성자(SCHEDULE_WRITERS: 류동기·우겸조·허웅진·박정미 등)의 글
//    → 민감하게 반응(알림 후보). 실제 내 순번/근무 여부는 gemini.mjs 가 이미지에서 판단.
//  - 그 외 작성자의 글 → '내 이름'이 제목에 있을 때만 반응.
//  - 나머지(남의 개인 소식/근태 신청)는 전부 무시.

// 남의 개인 근태 신청글 패턴 (혹시 신뢰 작성자가 아닌데 걸릴 때의 백업 차단)
export const PERSONAL_REQUEST_RE = /(휴무|후출|조출|연차|반차|월차|병가)/;

// 작성자 nick 이 신뢰 작성자 목록에 드는지 (닉네임이 실명과 다를 수 있어 부분일치도 허용)
export function isScheduleWriter(writer) {
  const list = (process.env.SCHEDULE_WRITERS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const w = (writer || '').trim();
  if (!w || list.length === 0) return false;
  return list.some((n) => w === n || w.includes(n) || n.includes(w));
}

export function analyze(article) {
  const name = (process.env.MY_NAME || '').trim();               // 김홍구
  const part = (process.env.MY_PART || '').trim();               // 3
  const keywords = (process.env.KEYWORDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const notifyAll = (process.env.NOTIFY_MODE || 'keyword') === 'all';

  const subject = article.subject || '';
  const writer = (article.writer || '').trim();
  const hits = [];

  const aboutMe = !!(name && subject.includes(name));
  const fromWriter = isScheduleWriter(writer);
  // 일정 게시판(번호표=당일변동 / 배치표=배치시간표)은 작성자가 누구든 일단 통과시켜
  // notifyForArticle 에서 부·이름·이미지로 정밀 판단하게 한다. (작성자 명단 밖 담당자가 올려도 안 놓침)
  const menuId = String(article.menuId || '');
  const scheduleBoard = menuId === (process.env.CHANGE_MENU_ID || '13')
    || menuId === (process.env.SCHEDULE_MENU_ID || '2');

  if (fromWriter) hits.push(`번호표작성자:${writer}`);
  if (aboutMe) hits.push(`이름:${name}`);
  if (scheduleBoard) hits.push('일정게시판');
  if (part && subject.includes(`${part}부`)) hits.push(`${part}부`);
  for (const k of keywords) if (subject.includes(k)) hits.push(k);

  // 신뢰 작성자도 아니고 내 이름도 없는 개인 근태글 → 확실히 제외 (단, 일정 게시판은 예외)
  if (!scheduleBoard && !fromWriter && !aboutMe && PERSONAL_REQUEST_RE.test(subject)) {
    return { relevant: notifyAll, hits: [...hits, '개인근태(제외)'], priority: 'info' };
  }

  // 알림 후보: 일정 게시판 글 / 신뢰 작성자 글 / 내 이름이 들어간 글.
  const relevant = notifyAll || fromWriter || aboutMe || scheduleBoard;
  const priority = (fromWriter || aboutMe || scheduleBoard) ? 'high' : 'info';
  return { relevant, hits, priority };
}
