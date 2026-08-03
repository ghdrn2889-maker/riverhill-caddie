// 서버 Claude Code(MAX 구독, 이미 로그인)를 '채점자'로 호출 — 부별 크롭을 업스케일해 독립 판독.
//  목적: 로컬 VLM(무료) 판독과 '교차검증'해 자신있는 오독·밀집부 누락을 잡는다(둘 다 틀리면 관리자 플래그).
//  ★사용량 억제: 부별 1회 + '하루 하드캡'(폭주 방지). 캡 초과 시 호출 스킵(VLM 단독으로 폴백).
//  전제: 서버에 `claude`(v2.x) 설치 + OAuth 로그인(ghdrn2889@gmail.com MAX). API 키 아님 = 종량제 과금 없음.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJSON, saveJSON } from './store.mjs';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 240000);
const DAILY_CAP = Number(process.env.CLAUDE_DAILY_CAP || 40);   // 하루 최대 호출(합본 4 + 변동들). 폭주 방지 상한.
const CAP_FILE = 'claude-calls.json';

// ── 하루 하드캡 ─────────────────────────────────────────────
function today() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function callsToday() { const s = loadJSON(CAP_FILE, {}); return s.date === today() ? (s.count || 0) : 0; }
function bumpCalls() {
  const s = loadJSON(CAP_FILE, {});
  const c = s.date === today() ? (s.count || 0) + 1 : 1;
  saveJSON(CAP_FILE, { date: today(), count: c });
  return c;
}
export function claudeBudgetLeft() { return Math.max(0, DAILY_CAP - callsToday()); }

// 부별 판독 프롬프트 — 순번 순서 명단 JSON만. 괄호 태그(54·1,3·조출·찾근) 원문 보존.
const READ_PROMPT = (
  'Read the given local image with the Read tool. It is one section of a Korean golf caddie assignment board (배치표). '
  + 'The left side has [순번 이름] roster column(s) (one or two side by side). '
  + 'List ALL caddies strictly in 순번(number) order as a JSON array, preserving parenthetical tags exactly like (54)/(1,3)/(조출)/(찾근). '
  + 'Skip truly empty rows. Output ONLY strict JSON, no prose: {"roster":["name1","name2",...]}'
);

// 이미지 파일(크롭)을 업스케일 저장 — 작은 크롭은 그대로 주면 tiny 한글이 안 읽힌다(업스케일이 결정적 레버).
//  Pillow는 파이썬이라 여기선 이미 업스케일된 파일 경로를 받는 걸 기본으로 하고, 원본이면 호출부에서 키워 넘긴다.

// article 크롭 이미지(로컬 파일 경로) → Claude 판독 명단 배열 또는 null.
//  ★비용 가드: 하루 캡 초과면 null(스킵). Claude가 죽거나 파싱 실패해도 null(안전 폴백).
export async function readCropWithClaude(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) {
    console.warn(`[claude] 하루 하드캡(${DAILY_CAP}) 도달 — 호출 스킵(VLM 단독 폴백)`);
    return null;
  }
  let out;
  try {
    out = await runClaude(`${READ_PROMPT}\nImage path: ${imagePath}`);
  } catch (e) {
    console.error('[claude] 호출 오류:', e.message);
    return null;
  }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);   // 프롬프트 밖 잡담 제거, JSON 블록만
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const roster = Array.isArray(j.roster) ? j.roster.map((s) => String(s || '').trim()) : [];
    return roster.length ? roster : null;
  } catch { return null; }
}

// 합본 배치표 → 부별 x경계(0~1). Claude가 레이아웃을 이해해 대략 경계를 준다(슬라이서). 아침 합본당 1회.
//  실증(8/4): Claude 1부0~0.24·2부0.24~0.44·3부0.44~0.63 ≈ 실제. 슬라이서는 대략이면 충분(단일부 판독이 흡수).
const BOUNDS_PROMPT = (
  'Read the given local image with the Read tool. It is a Korean golf caddie board (배치표) with sections laid out '
  + 'LEFT to RIGHT: 1부 (roster + morning tee table), 2부 (roster + midday tee table), 3부 (roster + afternoon tee table), '
  + 'then 조편성표 (crew grid on the far right). For EACH 부 that is present, estimate the horizontal span of its '
  + '[roster + its tee table] as fractions of total width (left=0.0, right=1.0). Output ONLY JSON: '
  + '{"parts":[{"part":1,"x0":0.0,"x1":0.24},...]}'
);

export async function getPartBoundaries(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 경계 추정 스킵'); return null; }
  let out;
  try { out = await runClaude(`${BOUNDS_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 경계 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const parts = (Array.isArray(j.parts) ? j.parts : [])
      .map((p) => ({ part: Number(String(p.part).replace(/\D/g, '')), x0: Number(p.x0), x1: Number(p.x1) }))
      .filter((p) => p.part >= 1 && p.part <= 3 && p.x1 > p.x0 && p.x0 >= 0 && p.x1 <= 1);
    return parts.length ? parts : null;
  } catch { return null; }
}

// 부별 크롭(단일부) → 명단 + 티오프 + 커트를 '한 번에'. 슬라이스당 Claude 1회.
//  실증(8/4): 3부 명단 29 정확 + 티오프 16팀(IN 포함) + 커트16. VLM이 약했던 티오프까지 정확.
const PART_PROMPT = (
  'Read the given local image with the Read tool. It is ONE 부(section) of a Korean golf caddie board (배치표). '
  + 'LEFT: one or MORE [순번 이름] roster columns side by side (e.g. 순번 1-25 in the first column, then 26-50 continuing in the next column to its right). '
  + 'Read the columns left-to-right, and WITHIN each column top-to-bottom, following the printed 순번 numbers. '
  + 'List ALL caddies strictly in 순번 order, preserving parenthetical tags exactly like (54)/(1,3)/(조출)/(찾근); skip truly empty rows. '
  + 'IGNORE any text that is NOT a numbered 순번 row — e.g. notice/공지 boxes, phone-number legends, "흡연실 당번" boxes, 조편성표 grids. Only rows with a printed 순번 number count. '
  + 'RIGHT: a tee-time table with columns [OUT팀번호][시간 HH:MM][IN팀번호] — a number on the left tees off OUT, on the right tees off IN, blank = none. '
  + 'cut = the highest team number in the tee table (커트라인). '
  + 'Output ONLY strict JSON, no prose: {"roster":["name",...],"tee":[{"pos":n,"time":"HH:MM","course":"OUT|IN"}],"cut":N}'
);

export async function readPartWithClaude(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn(`[claude] 캡(${DAILY_CAP}) 도달 — 부 판독 스킵`); return null; }
  let out;
  try { out = await runClaude(`${PART_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 부 판독 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const roster = Array.isArray(j.roster) ? j.roster.map((s) => String(s || '').trim()) : [];
    const tee = (Array.isArray(j.tee) ? j.tee : [])
      .map((t) => ({ pos: Number(t.pos), time: String(t.time || ''), course: /IN/i.test(String(t.course)) ? 'IN' : 'OUT' }))
      .filter((t) => t.pos > 0 && /^\d{1,2}:\d{2}$/.test(t.time));
    const cut = Number(j.cut) || tee.reduce((mx, t) => Math.max(mx, t.pos), 0);
    return roster.length ? { roster, tee, cut } : null;
  } catch { return null; }
}

// 상단 요약 스트립("1부 21  2부 4  3부 16  총 41팀") → 부별 팀수(=커트). ★큰 인쇄 숫자라 안정적.
//  부별 티오프 행을 세는 것(±2 흔들림)보다 훨씬 신뢰. 합본당 1회. 부별 크롭엔 없어 null(그땐 per-part cut 사용).
const SUMMARY_PROMPT = (
  'Read the given local image with the Read tool. It is the top summary strip of a Korean golf caddie board (배치표) '
  + 'showing per-부 team counts, e.g. "1부 21  2부 4  3부 16  총 41팀". '
  + 'Output ONLY strict JSON mapping each 부 number to its team count: {"counts":{"1":21,"2":4,"3":16}}'
);

export async function readSummaryCounts(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 요약 판독 스킵'); return null; }
  let out;
  try { out = await runClaude(`${SUMMARY_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 요약 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const src = j.counts || j;
    const cuts = {};
    for (const k of ['1', '2', '3']) { const n = Number(src[k]); if (n > 0 && n <= 40) cuts[k] = n; }
    return Object.keys(cuts).length ? cuts : null;
  } catch { return null; }
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    // --allowedTools Read = 읽기 전용(파일 수정·실행 불가). 헤드리스 안전.
    const p = spawn(CLAUDE_BIN, ['-p', prompt, '--allowedTools', 'Read'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: os.tmpdir(),
    });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('타임아웃')); }, CLAUDE_TIMEOUT_MS);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) return reject(new Error(`claude exit ${code}: ${err.slice(0, 200)}`));
      resolve(out);
    });
  });
}
