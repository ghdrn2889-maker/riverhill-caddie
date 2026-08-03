// 배치표 판독 오케스트레이터 — Claude(서버, MAX 구독)를 주 판독자로 삼는다.
//  흐름: 합본 배치표 → Claude 부 경계 → 부별 크롭(파이썬 crop_only, 업스케일) → Claude가 부별 명단·티오프·커트 판독.
//  변동(단일부 크롭 업로드)은 경계 없이 그 이미지를 바로 부 판독. 커트는 요약숫자(있으면)로 교차확정.
//  ★검증(8/4): 경계 정확 + 부별 명단/티오프/커트 정확(3부 29·티오프16·커트16). VLM보다 슬라이스에서 압도적.
//  비용: 합본당 Claude ~4회(경계1+부별3), 변동당 1회. 하루 하드캡(claudereader) 보호.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPartBoundaries, readPartWithClaude, claudeBudgetLeft } from './claudereader.mjs';
import { snapStrong, confirmedCaddies } from './roster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.PYTHON_BIN || 'python3';
const SCRIPT = path.join(HERE, '..', 'scripts', 'board_read_local.py');
const TMP = os.tmpdir();

function runPy(payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn(PY, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('py 타임아웃')); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (c) => { clearTimeout(timer); c === 0 ? resolve(JSON.parse(out)) : reject(new Error(err.slice(0, 200))); });
    p.stdin.write(JSON.stringify(payload)); p.stdin.end();
  });
}

// 이미지(URL/파일) → 로컬 파일 경로. URL이면 임시로 내려받는다.
async function ensureLocal(imageOrUrl) {
  if (!imageOrUrl) return null;
  if (fs.existsSync(imageOrUrl)) return imageOrUrl;
  if (/^https?:/.test(imageOrUrl)) {
    const dest = path.join(TMP, `board_${Date.now()}.png`);
    const buf = Buffer.from(await (await fetch(imageOrUrl)).arrayBuffer());
    fs.writeFileSync(dest, buf);
    return dest;
  }
  return null;
}

// 판독 명단에 명단 최근접 스냅 적용(장미화→장미희 등 1글자 오독 교정). 괄호 점유자도 각각.
function snapRoster(roster) {
  const snap1 = (x) => snapStrong(String(x || '').trim());
  return (roster || []).map((cell) => {
    const s = String(cell || '').trim();
    const m = s.match(/^(.+?)\(([^)]+)\)\s*$/);
    if (m) return `${snap1(m[1].trim())}(${m[2].trim()})`;   // 태그(54·조출 등)는 스냅 안 함
    return snap1(s) || s;
  });
}

// ── 합본 배치표: Claude 경계 → 부별 크롭 → Claude 부 판독. ──
//  반환 { boundaries, parts: { '1': {roster,tee,cut}, ... }, _claudeCalls }
export async function readBoardByClaude(imageOrUrl, { known = confirmedCaddies(), summaryCuts = {} } = {}) {
  const img = await ensureLocal(imageOrUrl);
  if (!img) return null;
  const startBudget = claudeBudgetLeft();
  const bounds = await getPartBoundaries(img);
  if (!bounds || !bounds.length) return null;
  const parts = {};
  for (const b of bounds) {
    try {
      const cropPath = path.join(TMP, `part_${b.part}_${Date.now()}.png`);
      await runPy({ image: img, crop_only: cropPath, slice: { x0: b.x0, x1: b.x1 }, scale: 6 }, 30000);
      const r = await readPartWithClaude(cropPath);
      try { fs.unlinkSync(cropPath); } catch { /* noop */ }
      if (!r) continue;
      const cut = Number(summaryCuts[b.part]) || r.cut || 0;   // 요약숫자 우선(더 신뢰)
      parts[String(b.part)] = { roster: snapRoster(r.roster), tee: r.tee, cut, x0: b.x0, x1: b.x1 };
    } catch (e) { console.error(`[boardreader] 부 ${b.part} 오류:`, e.message); }
  }
  return { boundaries: bounds, parts, _claudeCalls: startBudget - claudeBudgetLeft() };
}

// ── 단일부(변동 크롭): 경계 없이 그 이미지를 바로 부 판독. ──
export async function readSinglePartByClaude(imageOrUrl, { cut = 0 } = {}) {
  const img = await ensureLocal(imageOrUrl);
  if (!img) return null;
  // 작은 크롭은 업스케일이 결정적 — 통째 6배 업스케일 후 판독.
  const big = path.join(TMP, `single_${Date.now()}.png`);
  try { await runPy({ image: img, crop_only: big, slice: { x0: 0, x1: 1, y1: 1 }, scale: 4 }, 30000); }
  catch { return null; }
  const r = await readPartWithClaude(big);
  try { fs.unlinkSync(big); } catch { /* noop */ }
  if (!r) return null;
  return { roster: snapRoster(r.roster), tee: r.tee, cut: cut || r.cut || 0 };
}
