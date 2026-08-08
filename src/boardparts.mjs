// 1·2부 board 레벨 판독 저장소 — 모니터가 3부처럼 1·2부도 '판독검증·배치표 검수'로 보고 고칠 수 있게.
//  메인 파이프라인(server.mjs 부별 공유 판독 outP)에서 부별 순번표를 이 파일에 저장.
//  ★3부는 lastboard.json에 이미 저장됨(불변) — 여긴 1·2부만.
//  파일: data/board-parts-store.json
//   { articleId, at, dateLabel, subject, image, url, article:{id,subject,images,comments,...},
//     parts: { '1': {roster,teeGrid,teamCount,internTees,internCount,cutoffPosition,cutoffName,crewDuty,rosterReliable,uncertain}, '2': {...} } }
import { loadJSON, saveJSON } from './store.mjs';

const FILE = 'board-parts-store.json';

export function loadBoardPartsStore() { return loadJSON(FILE, null); }
export function saveBoardPartsStore(obj) { saveJSON(FILE, obj); }
export function getBoardPart(part) {
  const s = loadBoardPartsStore();
  return (s && s.parts && s.parts[String(part)]) || null;
}

// interpretForMember·이미지 표시에 필요한 만큼만 저장(base64 이미지 1장·댓글 일부).
function trimArticle(a) {
  if (!a) return null;
  return {
    id: a.id, subject: a.subject || '', url: a.url || '', writer: a.writer || '', writeDate: a.writeDate || null,
    images: Array.isArray(a.images) ? a.images.slice(0, 1) : [],
    comments: Array.isArray(a.comments) ? a.comments.slice(0, 12) : [],
  };
}

// ★KST(Asia/Seoul) 달력일 — 서버 로컬시간이 KST가 아니어도 자정경계에서 오판하지 않게.
const localDayStr = (ts) => new Date(Number(ts) || 0).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

// 부별 순번표 저장(upsert).
//  ★핵심 불변식: '같은 날'이면 이번 판독에 담긴 그 부만 덮고 형제 부(예: 1부)는 절대 지우지 않는다.
//   과거엔 articleId만 다르면 parts를 통째로 리셋 → 2부만 담긴 '수정 배치표'가 새 글로 오면 1부가 통째로
//   사라졌다(모니터에서 1부 실종). 리셋은 '확실히 다른 날'일 때만 한다:
//    (a) 판독 날짜라벨이 둘 다 있고 서로 다르거나, (b) 저장본이 지난 달력일(자정 넘김).
//   같은 날 병합에선 원 배치표 정체성(articleId·이미지·URL·제목)은 유지하고, 그 부 데이터와 at만 갱신한다
//   (부별 이미지 스키마가 없어, 먼저 잡힌 본배치표 이미지를 유지하는 편이 검수에 덜 혼란스럽다).
export function setBoardPart(articleId, meta, article, part, data) {
  const id = String(articleId || '');
  let s = loadBoardPartsStore();
  // ★리셋은 '확실히 다른 달력일(KST)'일 때만. 판독 날짜라벨(OCR)은 오독이 잦아 폐기 트리거로 쓰지 않는다 —
  //  같은 날 2부 '수정 배치표'가 라벨/제목을 조금 다르게 읽어도 형제 부(1부)를 절대 지우지 않게.
  const atSaysNewDay = !!(s && s.at && localDayStr(s.at) !== localDayStr(Date.now()));
  if (!s || !s.parts || atSaysNewDay) {
    // 저장소 없음 또는 확실히 새 날 → 새로 시작(옛 부 데이터 폐기가 맞음).
    s = { articleId: id, at: meta.at || Date.now(), dateLabel: meta.dateLabel || '', subject: meta.subject || '',
      image: meta.image || '', url: meta.url || '', article: trimArticle(article), parts: {} };
  } else {
    // 같은 날 → 형제 부 보존. 메타는 비어 있을 때만 채워 원 배치표 정체성을 유지.
    if (meta.at) s.at = meta.at;
    if (!s.articleId && id) s.articleId = id;
    if (!s.dateLabel && meta.dateLabel) s.dateLabel = meta.dateLabel;
    if (!s.subject && meta.subject) s.subject = meta.subject;
    if (!s.image && meta.image) s.image = meta.image;
    if (!s.url && meta.url) s.url = meta.url;
    if (!s.article && article) s.article = trimArticle(article);
  }
  s.parts[String(part)] = data;
  saveBoardPartsStore(s);
  return s;
}
