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

// ── 리버힐 근무 태그 ────────────────────────────────────────────────────────
//  배치표 명단 셀의 괄호가 그 사람의 그날 성격을 말한다. 카카오는 이걸 절대 모른다 —
//  사진에서만 나오고, 재매칭의 의미가 여기서 갈린다.
//   (54)      전 부 근무. ★커트 밖이어도 근무다(judge.mjs의 guaranteedWork와 같은 규칙).
//   (1,3)(2,3) 두 부 중복근무. 앞 순번을 차지하지만 커트는 따른다.
//   (조출)(후출) 시간대 지정.
//  ★리버힐 규칙(사용자 확정, boardreader.mjs:584에도 같은 문장): 중복근무자는 각 부의 앞 순번을
//   '같은 순서로' 차지한다(대바 없을 때). 그래서 명단 머리에 몰려 있는 게 정상이고,
//   그 사람들이 앞 티오프에 배정되는 건 '새로 생긴 일'이 아니라 원래 그렇게 되기로 돼 있던 일이다.
//   대조판이 이들을 '신규'라고 부른 건 칸(slot)에 붙일 말을 사람에게 붙인 것이라 틀렸다.
const GUARANTEED_RE = /(^|[^0-9])(54|찾근)([^0-9]|$)/;      // 커트 무관 근무
const CROSS_RE = /(^|[^0-9])(54|1[,、]\s*3|2[,、]\s*3)([^0-9]|$)/; // 부 중복근무
export function tagOf(cell) {
  const s = String(cell || '');
  const m = s.match(/\(([^)]*)\)/);
  const tag = m ? m[1].trim() : '';
  const name = s.replace(/\([^)]*\)/g, '').trim();
  return {
    name, tag,
    guaranteed: GUARANTEED_RE.test(tag),                  // 54·찾근 — 커트 밖이어도 근무
    cross: CROSS_RE.test(tag),                            // 54·1,3·2,3 — 앞 순번 차지
    early: /조출/.test(tag), late: /후출/.test(tag),
  };
}

// ── 인턴 보정 — 카카오 격자에 순번을 얹을 때 반드시 거쳐야 하는 단계 ─────────────────
//  ★인턴 캐디는 티오프 칸을 차지하지만 '정규 순번을 소비하지 않는다'(judge.mjs:509-511, 노란 칸).
//   카카오는 그 칸이 찼다는 것만 알지 인턴인지 정규인지 모른다 — 인턴 여부는 배치표에만 있다.
//   그래서 인턴 칸을 빼고 순번을 매겨야 한다. 안 그러면 인턴 하나당 그 뒤 전원이 한 칸씩 밀린다.
//   (인턴은 그날그날 섭외돼 중간에 끼기 때문에 밀림이 꼬리가 아니라 중간부터 시작된다.)
export function assignPositions(slots, { roster = [], internTees = [] } = {}) {
  const internSet = new Set((internTees || []).map((t) => K(t.time, t.course)));
  let pos = 0;
  return slots.map((s) => {
    if (internSet.has(s.k)) return { ...s, pos: 0, intern: true, name: '인턴', tag: '', guaranteed: false, cross: false };
    pos += 1;
    const t = tagOf(roster[pos - 1] || '');
    return { ...s, pos, intern: false, ...t };
  });
}

// ── 보강(augment) — 사진이 읽은 격자에 카카오가 본 빠진 칸을 채운다 ────────────────
//  ★받아들이는 조건이 핵심이다. 하나라도 어긋나면 손대지 않고 사람을 부른다.
//   ① 사진이 읽은 칸이 카카오에 '전부' 있어야 한다.
//      하나라도 없으면 둘 중 하나가 틀린 것이고, 어느 쪽인지 기계는 모른다 → 사람 판단.
//   ② 채울 칸이 있어야 한다(없으면 할 일 없음).
//   ③ 너무 많이 늘면 거부한다. 격자가 갑자기 배로 늘어나는 건 당추가 아니라 고장이다.
const MAX_ADD = Number(process.env.KAKAO_ASSIST_MAX_ADD || 8);
export function augmentGrid({ teeGrid = [], roster = [], cut = 0, internTees = [] }, snap, part) {
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
  // ★순번 재부여 = 다시 정렬한 결과다. 다만 인턴 칸은 건너뛴다 — 티오프는 차지하되 순번은 안 먹는다.
  const full = assignPositions(ks, { roster, internTees });
  const merged = full.filter((s) => !s.intern).map((s) => ({ pos: s.pos, time: s.time, course: s.course }));
  const internUsed = full.filter((s) => s.intern).length;
  const newCut = merged.length;                      // 정규 근무선 — 인턴은 안 센다
  const byKey = new Map(full.map((s) => [s.k, s]));
  const moved = board.map((g) => {
    const to = byKey.get(g.k)?.pos || 0;
    return { from: Number(g.pos), to };
  }).filter((x) => x.from && x.to && x.from !== x.to);
  // ★커트가 올라가도 '(54)·찾근'은 승격이 아니다 — 원래 커트 밖에서도 근무하기로 돼 있던 사람들이다.
  //  이들을 승격이라고 알리면 없던 좋은 소식을 지어내는 셈이라, 정말 바뀌는 사람만 남긴다.
  const promoted = [];
  if (cut > 0 && newCut > cut) {
    for (let p = cut + 1; p <= newCut; p++) {
      const t = tagOf(roster[p - 1] || '');
      if (!t.name) continue;
      if (t.guaranteed) continue;                    // 54·찾근 — 커트와 무관하게 이미 근무였다
      promoted.push({ pos: p, name: t.name, tag: t.tag, cross: t.cross });
    }
  }
  // ── ★인턴 앞에서 무엇이 살아남는가 ──────────────────────────────────────
  //  인턴을 모르면 이 엔진이 통째로 틀릴 수 있다. 다만 '전부'가 틀리는 건 아니다. 나눠서 봐야 한다.
  //   ① 팀 수(= 찬 칸 수)      — 인턴과 무관하게 맞다. 인턴도 한 팀을 맡으니까.
  //   ② 정규 근무선(커트)      — 인턴 수만큼 줄어든다. 인턴 n명이면 커트가 n 낮다.
  //   ③ 순번 ↔ 티오프 대응     — ★첫 인턴 칸 뒤로 전부 어긋난다. 여기가 제일 위험하다.
  //  그래서 인턴을 모르는 상태에서는 ①만 말해야 하고, ②③은 '인턴 0명 가정'이라고 밝혀야 한다.
  const firstIntern = full.findIndex((s) => s.intern);
  const risk = {
    teams: ks.length,                                    // ① 인턴과 무관하게 맞다
    cutIfInterns: (n) => Math.max(0, ks.length - n),     // ② 인턴 n명이면 커트는 이만큼
    // ③ 첫 인턴 칸부터 그 아래 순번은 전부 대응이 밀린다. 인턴을 모르면 '어디부터'조차 모른다.
    shiftedFrom: firstIntern >= 0 ? (full[firstIntern].pos || 1) : 0,
    internAssumed: internTees.length,
    note: internTees.length
      ? `인턴 ${internTees.length}칸 반영됨 — 그만큼 정규 근무선이 낮다`
      : '인턴 0명 가정 — 실제로 있으면 그 칸 뒤 순번의 티오프가 전부 한 칸씩 어긋난다',
  };
  return {
    mode: 'augment', teeGrid: merged, cut: newCut, prevCut: cut,
    added: add.map((s) => s.k), moved, internUsed, promoted, risk,
    // 화면·기록용 — 태그를 지우지 않고 그대로 들고 간다(대조판이 이걸 버려서 '신규' 오해가 났다).
    slots: full.map((s) => ({ pos: s.pos, time: s.time, course: s.course, name: s.name, tag: s.tag,
      intern: s.intern, guaranteed: s.guaranteed, cross: s.cross, isNew: !bset.has(s.k) })),
    why: `카카오가 ${add.length}칸 더 봄 — 커트 ${cut} → ${newCut}${internUsed ? ` (인턴 ${internUsed}칸 제외)` : ''}`,
  };
}

// ── 대체(substitute) — 사진이 아예 실패했을 때 ──────────────────────────────────
//  ★카카오는 이름을 만들 수 없다. 줄 수 있는 건 '몇 팀인가'뿐이다.
//   그래도 이게 작지 않다 — 자기 순번을 아는 회원에겐 '근무냐 스페어냐'가 이 숫자 하나로 정해진다.
//   (시스템은 이미 텍스트 글의 "현재 3부 N팀"을 teamCount로 받아 같은 계산을 한다. 같은 입구를 쓴다.)
//  ★그리고 이 팀 수는 '인턴 보정이 안 된' 수다. 인턴은 티오프를 차지하되 정규 순번을 안 먹는데,
//   인턴 여부는 배치표에만 있고 사진이 실패한 상황이라 알 길이 없다. 인턴이 있는 날이면 이 수가
//   그만큼 부풀어 있다 — 그래서 대체는 늘 '상한'으로 읽어야 하고, 이 한계를 값에 붙여 내보낸다.
export function substituteTeamCount(snap, part) {
  const ks = kakaoSlots(snap, part);
  if (!ks.length) return { mode: 'none', why: '카카오가 본 찬 칸 없음' };
  return { mode: 'substitute', teamCount: ks.length, internUnknown: true,
    teeGrid: ks.map((s, i) => ({ pos: i + 1, time: s.time, course: s.course })),
    why: `사진 판독 없음 — 카카오 예약으로 ${part}부 ${ks.length}팀(인턴 보정 불가 · 상한값)` };
}

// ── 바깥 입구 ────────────────────────────────────────────────────────────────
//  boardOk=false(사진 판독 실패)면 대체, true면 보강을 시도한다.
//  ★반환만 하고 아무것도 안 바꾼다. 적용 여부는 호출부가 assistOn()으로 정한다 —
//   이 파일이 스스로 상태를 바꾸면, 켜지지 않은 줄 알았던 장치가 조용히 일하는 그 사고가 또 난다.
export async function kakaoAssist({ dateISO, part = '3', boardOk = true, teeGrid = [], roster = [], cut = 0, internTees = [] }) {
  const date = ymdOf(dateISO);
  if (!date) return { mode: 'none', why: '날짜 없음' };
  const t = kakaoTrustworthy(date);
  if (!t.ok) return { mode: 'none', why: `카카오 신뢰 불가 — ${t.why}` };
  const r = boardOk
    ? augmentGrid({ teeGrid, roster, cut, internTees }, t.snap, part)
    : substituteTeamCount(t.snap, part);
  // ★인턴 이력 — 지금까지 어디에도 안 남기고 있었다(판독 기록 3,505건에 인턴 항목 0).
  //  그래서 '인턴이 얼마나 자주·몇 명인가'를 아무도 모른다. 이 엔진의 최대 오차원인데 크기를 모른다.
  //  인턴 하나를 놓치면 그 뒤 전원의 티오프가 한 칸씩 어긋난다 — 조금 틀리는 게 아니라 아래가 다 틀린다.
  //  오늘부터 남긴다. 며칠 쌓이면 '보정 없이 써도 되는가'를 추측이 아니라 숫자로 답할 수 있다.
  appendJSONL('intern-history.jsonl', { at: Date.now(), date, part, boardOk,
    internCount: (internTees || []).length, tees: (internTees || []).map((x) => `${x.time}|${x.course}`),
    boardTees: (teeGrid || []).length, kakaoTees: kakaoSlots(t.snap, part).length });
  const rec = { at: Date.now(), date, part, boardOk, applied: assistOn(),
    internCount: (internTees || []).length, internKnown: boardOk, ...r };
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
