// 관리자 공지 + 사용자 건의함(신고·수정요청·아이디어·공지답신).
//  - 공지: data/notices.json  { seq, items:[{id,title,body,createdAt,createdBy,active}] }
//    · 앱 홈 진입 시 '최신 활성 공지'가 출력기에서 인쇄됨. 사용자가 확인하면 그 사용자에겐 다시 안 뜸(회원별 ack).
//  - 받은함: data/inbox.jsonl  (한 줄=한 건) — 관리자 모니터(:3100)에서 열람. 유형별 배지로 구분.
import fs from 'node:fs';
import path from 'node:path';
import { loadJSON, saveJSON, appendJSONL, loadUserJSON, saveUserJSON, DATA_DIR } from './store.mjs';

const NOTICES_FILE = 'notices.json';
const INBOX_FILE = 'inbox.jsonl';
const ACK_FILE = 'notice-ack.json';       // 회원 폴더별(data/users/{id}/)
const SUBMIT_KINDS = ['report', 'fix', 'idea'];

// ── 공지 ──────────────────────────────────────────────
export function listNotices() {
  const s = loadJSON(NOTICES_FILE, { seq: 0, items: [] });
  if (!Array.isArray(s.items)) s.items = [];
  if (typeof s.seq !== 'number') s.seq = s.items.reduce((m, x) => Math.max(m, x.id || 0), 0);
  return s;
}
export function createNotice({ title, body, by }) {
  const s = listNotices();
  const id = ++s.seq;
  s.items.push({ id, title: String(title || '').trim(), body: String(body || '').trim(),
    createdAt: Date.now(), createdBy: by || '관리자', active: true });
  saveJSON(NOTICES_FILE, s);
  return id;
}
export function setNoticeActive(id, active) {
  const s = listNotices();
  const it = s.items.find((x) => x.id === Number(id));
  if (it) { it.active = !!active; saveJSON(NOTICES_FILE, s); }
  return !!it;
}
export function latestActiveNotice() {
  const s = listNotices();
  const act = s.items.filter((x) => x.active);
  return act.length ? act[act.length - 1] : null;
}

// ── 회원별 확인(ack) ──────────────────────────────────
function ackedIds(userId) {
  const a = loadUserJSON(userId, ACK_FILE, { ids: [] });
  return Array.isArray(a.ids) ? a.ids : [];
}
export function ackNotice(userId, id) {
  const a = loadUserJSON(userId, ACK_FILE, { ids: [] });
  if (!Array.isArray(a.ids)) a.ids = [];
  if (!a.ids.includes(Number(id))) a.ids.push(Number(id));
  saveUserJSON(userId, ACK_FILE, a);
}
// 이 회원에게 지금 보여줄 공지(확인 안 한 최신 활성 공지) — 없으면 null.
export function noticeForUser(userId) {
  const n = latestActiveNotice();
  if (!n) return null;
  if (ackedIds(userId).includes(n.id)) return null;
  return { id: n.id, title: n.title, body: n.body, createdAt: n.createdAt, by: n.createdBy };
}

// ── 받은함(inbox) ─────────────────────────────────────
//  entry: { kind, name, part, userId, text, subject?, category?, noticeId? }
export function addSubmission(entry) {
  const rec = { id: `${Date.now()}-${Math.floor(Math.random() * 1e4)}`, at: Date.now(), ...entry };
  appendJSONL(INBOX_FILE, rec);
  return rec.id;
}
export function listInbox(limit = 300) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(DATA_DIR, INBOX_FILE), 'utf8'); } catch { return []; }
  const out = [];
  const lines = txt.trim() ? txt.trim().split('\n') : [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { out.push(JSON.parse(lines[i])); } catch { /* 손상 줄 무시 */ }
  }
  return out;   // 최신순
}
