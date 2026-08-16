// ── 보조 판독 다리 — 카카오골프가 네이버(사진 판독)를 '거들되 덮지는 않는다' ──────────
//
//  사용자 확정 경계(2026-08-17): "메인은 네이버 카페·카톡 시스템. 카카오골프는 보조.
//   저번처럼 네이버가 판독을 놓치면 그때 카카오 쪽으로 교체할 수 있게."
//
//  ★비대칭을 먼저 못 박는다 — 두 경로가 아는 것이 다르다.
//    네이버(사진): 순번↔이름↔티오프 전부. 이름은 여기서만 나온다.
//    카카오(예약): 어느 칸이 찼는지만. 누가 서는지는 영원히 모른다.
//   그래서 카카오는 '이름을 만들 수 없고', 할 수 있는 건 두 가지뿐이다:
//    ① 보강 — 사진이 읽은 격자에 빠진 칸을 채운다(당추). 이름은 기존 명단에서 순번대로 따라온다.
//    ② 대체 — 사진이 아예 실패했을 때 '몇 팀인가(커트)'만 준다. 이름은 못 준다.
//
//  ★기본은 관측이다. 회원 화면·알림을 바꾸는 건 관리자가 켜야 한다(data/use-kakao-assist).
//   오늘(2026-08-16) 배운 것: 조용히 뭔가를 바꾸는 자동장치가 제일 위험하다.
//   그래서 켜지 않은 동안에도 '켰다면 무엇을 했을지'를 전부 기록한다 — 켤 근거는 기록에서 나온다.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, appendJSONL } from './store.mjs';
import { loadSnapshot, kakaoHealth } from './kakaogolf.mjs';
import { raiseBoardIssue } from './boardalert.mjs';

// 즉시 토글(재시작 불필요). 롤백 = rm data/use-kakao-assist
export function assistOn() {
  if (['1', 'true', 'yes'].includes(String(process.env.KAKAO_ASSIST || '').toLowerCase())) return true;
  try { return fs.existsSync(path.join(DATA_DIR, 'use-kakao-assist')); } catch { return false; }
}

const toMin = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : NaN; };
const toHM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
// ★시각 키는 반드시 분으로 환산해 재조립한다 — 1부 판독은 "6:23", 카카오는 "06:23"을 쓴다.
//  글자로 맞추면 1부 42칸이 통째로 '안 맞는다'고 나온다(실측 8/17).
const K = (time, course) => `${toHM(toMin(time))}|${/IN/i.test(course) ? 'IN' : 'OUT'}`;
const ymdOf = (iso) => String(iso || '').replace(/\D/g, '').slice(0, 8);

// 카카오를 믿어도 되는 상태인가 — 하나라도 어긋나면 아무것도 안 한다.
//  건강하지 않은 관측으로 배치표를 건드리는 건 판독 실패보다 나쁘다(틀린 걸 맞다고 내보내는 것이므로).
export function kakaoTrustworthy(dateYYYYMMDD) {
  const h = kakaoHealth() || {};
  const snap = loadSnapshot(String(dateYYYYMMDD));
  const why = [];
  if (!snap) why.push('그 날짜 관측 없음');
  if ((h.streak || 0) > 0) why.push(`연속 실패 ${h.streak}회`);
  if (!(h.ok > 0)) why.push('성공 관측 0');
  // 관측이 얕으면 '완판'과 '아직 안 열림'을 못 가른다(kakaogolf의 everOpen 규칙과 같은 이유).
  if (snap && Number(snap.seenCount || 0) < 3) why.push(`관측 ${snap.seenCount || 0}회(3회 미만)`);
  if (snap && (snap.unsure || []).length) why.push(`판단보류 ${(snap.unsure || []).length}건`);
  return { ok: !why.length, why: why.join(', '), snap, health: h };
}

// 카카오가 본 그 부의 '찬 칸'을 규칙대로 정렬 — 시각 순, 같은 시각이면 OUT 먼저.
//  (실증 8/16 본배치표: 1번 16:25 OUT, 2번 16:25 IN, 3번 16:32 OUT …)
export function kakaoSlots(snap, part) {
  return (snap?.byPart?.[String(part)] || [])
    .map((x) => ({ time: x.time, course: x.course, m: toMin(x.time) }))
    .sort((a, b) => a.m - b.m || (a.course === 'OUT' ? -1 : 1))
    .map((s) => ({ time: s.time, course: s.course, k: K(s.time, s.course) }));
}

// ── 보강(augment) — 사진이 읽은 격자에 카카오가 본 빠진 칸을 채운다 ────────────────
//  ★받아들이는 조건이 핵심이다. 하나라도 어긋나면 손대지 않고 사람을 부른다.
//   ① 사진이 읽은 칸이 카카오에 '전부' 있어야 한다.
//      하나라도 없으면 둘 중 하나가 틀린 것이고, 어느 쪽인지 기계는 모른다 → 사람 판단.
//   ② 채울 칸이 있어야 한다(없으면 할 일 없음).
//   ③ 너무 많이 늘면 거부한다. 격자가 갑자기 배로 늘어나는 건 당추가 아니라 고장이다.
const MAX_ADD = Number(process.env.KAKAO_ASSIST_MAX_ADD || 8);
export function augmentGrid({ teeGrid = [], roster = [], cut = 0 }, snap, part) {
  const ks = kakaoSlots(snap, part);
  if (!ks.length) return { mode: 'none', why: '카카오가 본 찬 칸 없음' };
  const kset = new Set(ks.map((s) => s.k));
  const board = (teeGrid || []).map((g) => ({ ...g, k: K(g.time, g.course) }));
  const boardOnly = board.filter((g) => !kset.has(g.k));
  if (boardOnly.length) {
    return { mode: 'conflict', why: `배치표에만 있는 칸 ${boardOnly.length}개(${boardOnly.slice(0, 4).map((g) => g.k).join(' ')})`,
      boardOnly: boardOnly.map((g) => g.k) };
  }
  const bset = new Set(board.map((g) => g.k));
  const add = ks.filter((s) => !bset.has(s.k));
  if (!add.length) return { mode: 'agree', why: '격자 완전 일치 — 채울 칸 없음', cut, newCut: board.length };
  if (add.length > MAX_ADD) {
    return { mode: 'refuse', why: `채울 칸이 ${add.length}개(상한 ${MAX_ADD}) — 당추라기엔 너무 많다. 고장을 의심`, add: add.map((s) => s.k) };
  }
  // 순번 재부여 = 그냥 다시 정렬한 결과다. 순번은 사람에게 붙어 고정이고 티오프가 밀린다.
  const merged = ks.map((s, i) => ({ pos: i + 1, time: s.time, course: s.course }));
  const moved = board.map((g) => {
    const to = merged.find((m) => K(m.time, m.course) === g.k)?.pos || 0;
    return { from: Number(g.pos), to };
  }).filter((x) => x.from && x.to && x.from !== x.to);
  return {
    mode: 'augment', teeGrid: merged, cut: merged.length, prevCut: cut,
    added: add.map((s) => s.k), moved,
    // 커트가 올라가면 그 사이 순번이 스페어→근무로 승격된다. 이름은 기존 명단에서 그대로 따라온다.
    promoted: (cut > 0 && merged.length > cut)
      ? roster.slice(cut, merged.length).map((n, i) => ({ pos: cut + i + 1, name: String(n).replace(/\([^)]*\)/g, '').trim() }))
      : [],
    why: `카카오가 ${add.length}칸 더 봄 — 커트 ${cut} → ${merged.length}`,
  };
}

// ── 대체(substitute) — 사진이 아예 실패했을 때 ──────────────────────────────────
//  ★카카오는 이름을 만들 수 없다. 줄 수 있는 건 '몇 팀인가'뿐이다.
//   그래도 이게 작지 않다 — 자기 순번을 아는 회원에겐 '근무냐 스페어냐'가 이 숫자 하나로 정해진다.
//   (시스템은 이미 텍스트 글의 "현재 3부 N팀"을 teamCount로 받아 같은 계산을 한다. 같은 입구를 쓴다.)
export function substituteTeamCount(snap, part) {
  const ks = kakaoSlots(snap, part);
  if (!ks.length) return { mode: 'none', why: '카카오가 본 찬 칸 없음' };
  return { mode: 'substitute', teamCount: ks.length, teeGrid: ks.map((s, i) => ({ pos: i + 1, time: s.time, course: s.course })),
    why: `사진 판독 없음 — 카카오 예약으로 ${part}부 ${ks.length}팀` };
}

// ── 바깥 입구 ────────────────────────────────────────────────────────────────
//  boardOk=false(사진 판독 실패)면 대체, true면 보강을 시도한다.
//  ★반환만 하고 아무것도 안 바꾼다. 적용 여부는 호출부가 assistOn()으로 정한다 —
//   이 파일이 스스로 상태를 바꾸면, 켜지지 않은 줄 알았던 장치가 조용히 일하는 그 사고가 또 난다.
export async function kakaoAssist({ dateISO, part = '3', boardOk = true, teeGrid = [], roster = [], cut = 0 }) {
  const date = ymdOf(dateISO);
  if (!date) return { mode: 'none', why: '날짜 없음' };
  const t = kakaoTrustworthy(date);
  if (!t.ok) return { mode: 'none', why: `카카오 신뢰 불가 — ${t.why}` };
  const r = boardOk
    ? augmentGrid({ teeGrid, roster, cut }, t.snap, part)
    : substituteTeamCount(t.snap, part);
  const rec = { at: Date.now(), date, part, boardOk, applied: assistOn(), ...r };
  appendJSONL('kakao-assist.jsonl', rec);

  // ★어긋남은 무조건 사람에게 — 켜졌든 안 켜졌든. 이게 이 다리의 제일 큰 값어치다.
  //  둘 중 하나가 틀렸는데 어느 쪽인지 기계는 모른다. 모를 때 조용한 게 오늘의 사고였다.
  if (r.mode === 'conflict') {
    await raiseBoardIssue({ kind: 'kakao_conflict', part, articleId: `${date}-${part}`,
      note: `${part}부 배치표에는 있는데 카카오 예약엔 없는 칸이 ${(r.boardOnly || []).length}개 (${(r.boardOnly || []).slice(0, 4).join(' ')}). 둘 중 하나가 틀렸습니다 — 원본과 대조해주세요.` });
  } else if (r.mode === 'refuse') {
    await raiseBoardIssue({ kind: 'kakao_conflict', part, articleId: `${date}-${part}-add`,
      note: `${part}부에 카카오만 본 칸이 ${(r.add || []).length}개로 너무 많습니다(상한 ${MAX_ADD}). 자동 보강을 거부했습니다 — 직접 확인해주세요.` });
  }
  return rec;
}

// 관리자 화면용 — 오늘까지의 보조 판단 기록(켰다면 무엇을 했을지 포함).
export function assistLog(limit = 40) {
  try {
    const p = path.join(DATA_DIR, 'kakao-assist.jsonl');
    return fs.readFileSync(p, 'utf8').trim().split(/\n/).slice(-limit)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
