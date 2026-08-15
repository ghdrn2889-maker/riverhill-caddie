// 1·2부 board 레벨 판독 저장소 — 모니터가 3부처럼 1·2부도 '판독검증·배치표 검수'로 보고 고칠 수 있게.
//  메인 파이프라인(server.mjs 부별 공유 판독 outP)에서 부별 순번표를 이 파일에 저장.
//  ★3부는 lastboard.json에 이미 저장됨(불변) — 여긴 1·2부만.
//  파일: data/board-parts-store.json
//   { articleId, at, dateLabel, subject, image, url, article:{id,subject,images,comments,...},
//     parts: { '1': {roster,teeGrid,teamCount,internTees,internCount,cutoffPosition,cutoffName,crewDuty,rosterReliable,uncertain}, '2': {...} } }
import { loadJSON, saveJSON } from './store.mjs';
import { labelToISO } from './worklog.mjs';

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
const kstTodayISO = () => localDayStr(Date.now());
// 근무일을 모를 때만 쓰는 나이 한도. 배치표는 전날 저녁(≈T-12h)에 올라오므로, 근무일 오전까지는
//  반드시 살아있어야 한다 → 30시간(전날 21시 판독본이 당일 정오까지 유효).
const STALE_MS = 30 * 3600 * 1000;

// 이 부 데이터가 '이번 판독의 근무일'과 어긋나 낡았는가.
//  ★판단은 반드시 부 단위 — 형제 부를 통째로 버리는 판단은 하지 않는다.
function partIsStale(pd, storeAt, newISO, todayISO) {
  if (!pd) return true;
  const iso = pd._targetISO || '';
  if (iso) {
    if (newISO && iso !== newISO) return true;   // 다른 근무일 판독본(내일 배치표가 왔는데 오늘치가 남음)
    return iso < todayISO;                       // 근무일이 이미 지남
  }
  const at = Number(pd._at) || Number(storeAt) || 0;   // 옛 저장본(부별 도장 없음) → 저장소 시각으로
  return at > 0 && (Date.now() - at) > STALE_MS;
}

// 부별 순번표 저장(upsert).
//  ★핵심 불변식: 형제 부(예: 1부)는 '그 부 자신이 낡았다는 증거'가 있을 때만 사라진다.
//   1차 사고(2026-08 초): articleId만 다르면 parts를 통째 리셋 → 2부 수정 배치표가 새 글로 오면 1부 실종.
//   2차 사고(2026-08-15): 리셋 기준을 '저장본의 KST 달력일 ≠ 오늘'로 바꿨는데, 이건 근무일이 아니라
//    '판독한 시각'이다. 배치표는 전날 저녁에 올라온다 — 8/15 배치표를 8/14 21:00에 읽어두면 저장본 날짜가
//    8/14가 되고, 8/15 아침 7:39에 단독 2부 수정본이 오는 순간 '새 날'로 오판해 1부를 통째로 지웠다.
//   그래서 기준을 '판독 시각'이 아니라 배치표가 가리키는 근무일(dateLabel→ISO)로 바꾸고, 폐기도
//   통째 리셋이 아니라 낡은 부만 골라내는 방식으로 바꾼다. 근무일을 모르면(단독 수정본 등) 아무도 안 버린다
//   — 낡은 순번표가 잠깐 남는 손해보다 1부가 통째로 사라지는 손해가 훨씬 크다(모니터에서 눈에도 안 띔).
export function setBoardPart(articleId, meta, article, part, data) {
  const id = String(articleId || '');
  const newISO = labelToISO(meta.dateLabel || '') || '';   // 이 판독이 가리키는 근무일(모르면 '')
  const todayISO = kstTodayISO();
  let s = loadBoardPartsStore();
  if (!s || !s.parts) {
    s = { articleId: id, at: meta.at || Date.now(), targetISO: newISO, dateLabel: meta.dateLabel || '',
      subject: meta.subject || '', image: meta.image || '', url: meta.url || '', article: trimArticle(article), parts: {} };
  } else {
    // 낡은 부만 골라 정리. 이번에 저장할 부는 어차피 덮어쓰므로 지우지 않되, '갈아탔는지' 판정엔 포함한다.
    const keys = Object.keys(s.parts);
    const allStale = keys.length > 0 && keys.every((k) => partIsStale(s.parts[k], s.at, newISO, todayISO));
    for (const k of keys) {
      if (k === String(part)) continue;
      if (partIsStale(s.parts[k], s.at, newISO, todayISO)) {
        console.log(`·  [board-parts] ${k}부 폐기 — 낡은 판독본(근무일 ${s.parts[k]?._targetISO || '미상'} ≠ ${newISO || todayISO})`);
        delete s.parts[k];
      }
    }
    // 저장돼 있던 부가 전부 낡았으면 '새 배치표로 갈아탄 것' → 정체성(글·이미지)도 이번 것으로.
    //  하나라도 살아 있으면 같은 근무일의 부분 수정본이므로 원 배치표 정체성을 유지한다(검수 혼란 방지).
    if (!keys.length || allStale) {
      s = { articleId: id, at: meta.at || Date.now(), targetISO: newISO, dateLabel: meta.dateLabel || '',
        subject: meta.subject || '', image: meta.image || '', url: meta.url || '', article: trimArticle(article), parts: {} };
    } else {
      if (meta.at) s.at = meta.at;
      if (newISO) s.targetISO = newISO;
      if (!s.articleId && id) s.articleId = id;
      if (!s.dateLabel && meta.dateLabel) s.dateLabel = meta.dateLabel;
      if (!s.subject && meta.subject) s.subject = meta.subject;
      if (!s.image && meta.image) s.image = meta.image;
      if (!s.url && meta.url) s.url = meta.url;
      if (!s.article && article) s.article = trimArticle(article);
    }
  }
  // ★부별 도장 — 다음 판독이 '이 부가 어느 근무일 것인지'를 시각이 아니라 근무일로 판단할 수 있게.
  //  날짜라벨이 없는 단독 수정본('2부 시간표 입니다')은 '지금 추적 중인 근무일'의 수정으로 본다 —
  //  단, 형제 부가 살아남았을 때만(방금 전부 폐기했다면 그 근무일 자체가 낡은 것이라 물려받으면 안 된다).
  const stampISO = newISO || (Object.keys(s.parts).length ? (s.targetISO || '') : '');
  s.parts[String(part)] = { ...data, _at: meta.at || Date.now(), _targetISO: stampISO };
  saveBoardPartsStore(s);
  return s;
}
