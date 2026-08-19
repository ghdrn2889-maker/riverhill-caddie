// 발송 대기함 — 관리자가 보내기 전에 '실제로 무엇이 누구 폰에 뜨는지' 보고, 고치고, 그다음 보낸다.
//
//  ★왜 필요한가: 알림은 되돌릴 수 없다. 잘못 나간 알림은 회원 폰에 그대로 남는다.
//   그런데 지금까지 수동 발송은 대부분 누르는 즉시 나갔고, 문구는 코드가 만들어 그대로 갔다.
//   관리자가 볼 수 있는 건 발송 '후'의 로그뿐이었다 — 그건 확인이 아니라 부고다.
//
//  ★왜 한 곳에 모으나: 발송 지점마다 미리보기를 따로 만들면 열여섯 벌이 된다.
//   지금 문구가 쉰두 군데로 갈라진 것과 똑같은 일이 미리보기에서 반복된다.
//   그래서 '보내기'는 전부 이 관문을 지난다: 초안(stage) → 미리보기(peek) → 수정(editItem) → 발송(send).
//
//  ★이 모듈은 문구를 만들지 않는다. 받아서 보여주고, 고치게 하고, 보낼 뿐이다.
//   문구 생성은 부르는 쪽 책임이다(나중에 알림 카탈로그로 모은다).
import fs from 'node:fs';
import path from 'node:path';
import { getSubscriptions, inQuietHours, broadcast } from './push.mjs';
import { DATA_DIR, appendJSONL } from './store.mjs';

// 15분은 짧다 — 열 명치 문구를 읽고 고치다 보면 만료된다. 그렇다고 무한정 두면
// 하루 전 초안을 오늘 잘못 눌러 보내게 된다. 30분이면 한 번 앉은 자리에서 끝난다.
const TTL_MS = 30 * 60 * 1000;
const MAX_ITEMS = 200;

const box = new Map();

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const now = () => Date.now();

function sweep() {
  const t = now();
  for (const [k, v] of box) if (t - (v.at || 0) > TTL_MS) box.delete(k);
}

// 이 서버가 아예 알림을 안 보내는 상태인지(push.mjs의 두 스위치와 같은 판정).
//  ★이걸 미리보기에 안 띄우면 관리자는 '보냈다'고 믿고 넘어간다 — 가장 조용한 실패다.
export function pushOff() {
  const envOff = ['1', 'true', 'yes'].includes(String(process.env.PUSH_DISABLED || '').toLowerCase());
  const fileOff = (() => { try { return fs.existsSync(path.join(DATA_DIR, 'push-disabled')); } catch { return false; } })();
  return envOff ? 'PUSH_DISABLED' : (fileOff ? 'push-disabled 파일' : '');
}

// 오늘 이 회원에게 이미 나간 알림 — 같은 말을 두 번 보내지 않게 미리보기에 같이 띄운다.
function sentTodayMap() {
  const out = new Map();
  let raw = '';
  try { raw = fs.readFileSync(path.join(DATA_DIR, 'sent-push.jsonl'), 'utf8'); } catch { return out; }
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  const lines = raw.split('\n');
  // 뒤에서부터 훑다가 오늘 밖으로 나가면 멈춘다 — 파일이 커져도 읽는 양은 그날치뿐이다.
  for (let i = lines.length - 1; i >= 0 && lines.length - i < 4000; i--) {
    const ln = lines[i].trim();
    if (!ln) continue;
    let r; try { r = JSON.parse(ln); } catch { continue; }
    if (!(r.at >= from)) break;
    const k = Number(r.uid) || 0;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ at: r.at, title: r.title || '', sent: Number(r.sent) || 0 });
  }
  return out;
}

// ── 초안 세우기 ──
//  items: [{ id, name, title, body, url?, level?, meta? }]  (id = 회원 userId)
//  meta는 그대로 되돌려준다 — 발송 뒤 부르는 쪽이 장부에 적을 때 쓴다(markNotified 등).
export function stage({ kind = '알림', part = '', items = [], by = '관리자', bypassQuiet = true, url = '/', level = 'high' } = {}) {
  sweep();
  const list = (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS)
    .map((it) => ({
      id: Number(it.id) || 0,
      name: clip(it.name, 20),
      title: clip(it.title, 90),
      body: clip(it.body, 300),
      url: String(it.url || url),
      level: String(it.level || level),
      meta: it.meta ?? null,
      kind: String(it.kind || 'state'),   // 어떤 종류의 알림인가 — 관리자가 관문에서 바꿀 수 있다
      pick: it.pick !== false,          // 기본은 전원 선택 — 빼는 건 관리자가 정한다
      edited: false,
    }))
    .filter((it) => it.id && (it.title || it.body));
  if (!list.length) return null;
  const token = 'ob_' + now().toString(36) + Math.random().toString(36).slice(2, 7);
  box.set(token, { token, kind: String(kind), part: String(part), by: String(by).slice(0, 40), bypassQuiet: !!bypassQuiet, at: now(), items: list, sentAt: 0 });
  return token;
}

// ── 미리보기 ── 문구 + '정말 갈까'를 같이 답한다.
export function peek(token) {
  sweep();
  const e = box.get(String(token || ''));
  if (!e) return null;
  const st = sentTodayMap();
  const quiet = !e.bypassQuiet && inQuietHours();
  return {
    token: e.token, kind: e.kind, part: e.part, by: e.by, at: e.at,
    expiresInMs: Math.max(0, TTL_MS - (now() - e.at)),
    pushOff: pushOff(),
    quiet,                                   // 지금 보내면 아침 대기열로 간다
    items: e.items.map((it) => {
      const devices = (() => { try { return getSubscriptions(it.id).length; } catch { return 0; } })();
      return {
        id: it.id, name: it.name, title: it.title, body: it.body,
        level: it.level, pick: it.pick, edited: it.edited, kind: it.kind,
        part: String((it.meta && it.meta.part) || e.part || ''),   // 종류를 바꿀 때 어느 부 상태를 읽을지
        devices,                             // 0이면 이 회원 폰엔 안 뜬다
        sentToday: (st.get(it.id) || []).slice(0, 5),
      };
    }),
  };
}

// ── 회원별 문구 수정 ── 한 사람 것만 고쳐도 나머지는 그대로다.
export function editItem(token, id, { title, body, pick, kind } = {}) {
  sweep();
  const e = box.get(String(token || ''));
  if (!e) return null;
  const it = e.items.find((x) => x.id === Number(id));
  if (!it) return null;
  if (title != null) { it.title = clip(title, 90); it.edited = true; }
  if (body != null) { it.body = clip(body, 300); it.edited = true; }
  if (pick != null) it.pick = !!pick;
  if (kind != null) it.kind = String(kind);
  return { id: it.id, title: it.title, body: it.body, pick: it.pick, edited: it.edited, kind: it.kind };
}

// ── 여러 명에게 같은 문구로 ──
//  ★한 사람씩 고치는 것만으로는 모자란다. '내일 배치표가 늦습니다' 같은 말은 열 명에게 똑같이 가야 하는데,
//   열 번 같은 글자를 치게 하면 그중 한 줄이 달라지고 그 한 줄이 제일 눈에 띈다.
//  ★고른 사람만 덮는다. 체크를 푼 사람은 이 문구도 안 받는다 — 화면에서 뺀 사람이 글자만 받는 건 앞뒤가 안 맞는다.
export function bulkEdit(token, { ids = null, title, body } = {}) {
  sweep();
  const e = box.get(String(token || ''));
  if (!e) return null;
  const only = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
  const hit = e.items.filter((it) => (only ? only.has(it.id) : it.pick));
  if (!hit.length) return { changed: 0, ids: [] };
  for (const it of hit) {
    if (title != null) it.title = clip(title, 90);
    if (body != null) it.body = clip(body, 300);
    it.kind = 'free';                 // 손으로 쓴 문구다 — 상태가 바뀌어도 다시 쓰지 않는다
    it.edited = true;
  }
  return { changed: hit.length, ids: hit.map((it) => it.id) };
}

export function drop(token) { return box.delete(String(token || '')); }

// ── 여러 초안을 한 장으로 ──
//  ★한 번 반영에 부마다 초안이 하나씩 생긴다. 그걸 따로 확인하게 두면 관리자가 세 번 훑어야 하고,
//   그중 하나를 빠뜨리면 그 부만 조용히 안 간다. 한 사람에게 두 장이 겹치면 나중 것이 이긴다.
export function merge(tokens = []) {
  sweep();
  const es = tokens.map((t) => box.get(String(t || ''))).filter(Boolean);
  if (!es.length) return null;
  if (es.length === 1) return es[0].token;
  const byId = new Map();
  for (const e of es) for (const it of e.items) byId.set(it.id, it);
  for (const e of es) box.delete(e.token);
  const token = 'ob_' + now().toString(36) + Math.random().toString(36).slice(2, 7);
  box.set(token, {
    token, kind: [...new Set(es.map((e) => e.kind))].join(' · '),
    part: [...new Set(es.map((e) => e.part).filter(Boolean))].join('·'),
    by: es[0].by, bypassQuiet: es.every((e) => e.bypassQuiet), at: now(),
    items: [...byId.values()], sentAt: 0,
  });
  return token;
}

// ── 확정 발송 ── 고른 사람에게만. 토큰은 먼저 지운다(두 번 눌러 두 번 가는 사고 방지).
//  반환: { sent, total, ok:[{id,name,meta}], none:[...기기 없음], failed:[...] }
export async function send(token, ids = null) {
  sweep();
  const key = String(token || '');
  const e = box.get(key);
  if (!e) return { error: '대기 중인 알림이 없어요(이미 보냈거나 만료됐습니다).', code: 404 };
  box.delete(key);                                   // ★재발송 방지 — 보내기 전에 지운다
  const only = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
  const targets = e.items.filter((it) => it.pick && (!only || only.has(it.id)));
  const ok = [], none = [], failed = [];
  for (const it of targets) {
    let devices = 0;
    try { devices = getSubscriptions(it.id).length; } catch { devices = 0; }
    try {
      await broadcast({ title: it.title, body: it.body, url: it.url, level: it.level, bypassQuiet: e.bypassQuiet }, it.id);
      if (devices) ok.push({ id: it.id, name: it.name, meta: it.meta });
      else none.push({ id: it.id, name: it.name, meta: it.meta });
    } catch (err) {
      failed.push({ id: it.id, name: it.name, error: err.message });
      console.error(`발송 실패(회원 ${it.id}):`, err.message);
    }
  }
  appendJSONL('outbox.jsonl', {
    at: now(), kind: e.kind, part: e.part, by: e.by,
    total: targets.length, ok: ok.length, none: none.length, failed: failed.length,
    edited: e.items.filter((x) => x.edited).map((x) => x.id),
    titles: [...new Set(targets.map((x) => x.title))].slice(0, 5),
  });
  console.log(`📢 [발송] ${e.kind}${e.part ? ` ${e.part}부` : ''} — ${ok.length}명 도달`
    + (none.length ? ` · 기기 없어 미도달 ${none.length}명` : '')
    + (failed.length ? ` · 실패 ${failed.length}명` : ''));
  return { sent: ok.length, total: targets.length, ok, none, failed };
}
