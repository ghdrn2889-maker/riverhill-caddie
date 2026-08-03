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
const DAILY_CAP = Number(process.env.CLAUDE_DAILY_CAP || 12);   // 하루 최대 호출(부별 1회×배치표 몇 건)
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
