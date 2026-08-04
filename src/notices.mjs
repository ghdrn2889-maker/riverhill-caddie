// 관리자 공지(팩스 출력지) — 모니터에서 작성 → 회원 앱이 열릴 때 '팩스 출력' 연출로 1회 표시.
//  저장: data/notices.json = [{id,title,body,admin,audience,userIds,tags,noticeDate,createdAt}].
//   audience: 'admin'(테스트=관리자만) | 'all'(전체) | 'users'(userIds 지정 회원만).
//   tags: ['회람','긴급','확인요망'] 부분집합(출력지 체크박스). noticeDate: 출력지 표시 날짜 'YYYY-MM-DD'(빈값=발송일).
//  열람표시: 회원별 data/users/<id>/notice-seen.json = [id,...] (본 공지는 다시 안 뜸).
import { loadJSON, saveJSON, loadUserJSON, saveUserJSON } from './store.mjs';

const FILE = 'notices.json';
const SEEN = 'notice-seen.json';
const TAGS = ['회람', '긴급', '확인요망'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function listNotices() {
  const a = loadJSON(FILE, []);
  return Array.isArray(a) ? a : [];
}

// 공지 등록 — audience 미지정/불명이면 안전하게 'admin'(관리자만). 길이 상한으로 방어.
export function addNotice({ title, body, admin, audience, userIds, tags, noticeDate } = {}) {
  const list = listNotices();
  // 대상: 'all'(전체) | 'users'(지정 회원) | 그 외=안전하게 'admin'(테스트)
  const aud = audience === 'all' ? 'all' : (audience === 'users' ? 'users' : 'admin');
  const ids = aud === 'users'
    ? Array.from(new Set((Array.isArray(userIds) ? userIds : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))).slice(0, 200)
    : [];
  const tg = Array.isArray(tags) ? TAGS.filter((t) => tags.includes(t)) : [];
  const nd = DATE_RE.test(String(noticeDate || '')) ? String(noticeDate) : '';
  const n = {
    id: 'n' + Date.now(),
    title: String(title || '').trim().slice(0, 80),
    body: String(body || '').trim().slice(0, 2000),
    admin: String(admin || '관리자').trim().slice(0, 20),
    audience: aud,
    userIds: ids,
    tags: tg,
    noticeDate: nd,
    createdAt: Date.now(),
  };
  list.push(n);
  while (list.length > 200) list.shift();
  saveJSON(FILE, list);
  return n;
}

export function seenIds(userId) {
  const a = loadUserJSON(userId, SEEN, []);
  return Array.isArray(a) ? a : [];
}

export function markSeen(userId, id) {
  const key = String(id || '');
  if (!key) return;
  const a = seenIds(userId);
  if (!a.includes(key)) { a.push(key); while (a.length > 300) a.shift(); saveUserJSON(userId, SEEN, a); }
}

// 이 회원에게 보여줄 '가장 최근 미열람' 공지 1건(대상 audience 필터). 없으면 null.
//  audience 'admin' = 관리자 회원에게만(테스트용). 'all' = 전체.
export function pendingFor(userId, isAdmin) {
  const uid = Number(userId);
  const seen = new Set(seenIds(userId));
  const forMe = (n) => {
    if (n.audience === 'all') return true;
    if (n.audience === 'users') return Array.isArray(n.userIds) && n.userIds.map(Number).includes(uid);
    return !!isAdmin;   // 'admin'(테스트) = 관리자 회원에게만
  };
  const list = listNotices().filter((n) => n && n.id && !seen.has(n.id) && forMe(n));
  if (!list.length) return null;
  const n = list[list.length - 1];   // 최신 1건만
  return {
    id: n.id, title: n.title, body: n.body, admin: n.admin, createdAt: n.createdAt,
    tags: Array.isArray(n.tags) ? n.tags : [], noticeDate: n.noticeDate || '',
  };
}
