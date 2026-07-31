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

// 부별 순번표 저장(upsert). 새 배치표(articleId 변경)면 parts 초기화 → 옛 부 데이터가 남지 않음.
export function setBoardPart(articleId, meta, article, part, data) {
  const id = String(articleId || '');
  let s = loadBoardPartsStore();
  if (!s || String(s.articleId) !== id) {
    s = { articleId: id, at: meta.at || null, dateLabel: meta.dateLabel || '', subject: meta.subject || '',
      image: meta.image || '', url: meta.url || '', article: trimArticle(article), parts: {} };
  }
  if (meta.at) s.at = meta.at;
  if (meta.dateLabel) s.dateLabel = meta.dateLabel;
  if (meta.subject) s.subject = meta.subject;
  if (meta.image) s.image = meta.image;
  if (meta.url) s.url = meta.url;
  if (article) s.article = trimArticle(article);
  s.parts[String(part)] = data;
  saveBoardPartsStore(s);
  return s;
}
