// 로컬 VLM 배치표 판독 — 홈서버 GPU의 ollama(qwen2.5vl)로 배치표를 읽는다. ★API 비용 0(전기만).
//  목적: Gemini(유료 크레딧) 의존 축소. 배치표는 세로로 긴 2단 리스트라 통이미지론 아래가 truncate →
//   scripts/board_read_local.py 가 좌/우 열로 크롭+업스케일+타일당 표결 후 순번(인쇄숫자)으로 병합한다.
//   실측(2026-08-03 #26955): 통이미지 50% → 타일링 30/30 이름·괄호점유자 정확(≈100%), 서동환(심영운) 등 쌍둥이까지.
//  ★현 단계 = '섀도'(라이브 judge/알림 파이프라인 미연결). readBoardLocal()로 판독만 뽑아 Gemini와 대조·검증.
//   검증 후 judge()의 1차 판독으로 승격 예정. 전제: 홈서버 ollama 실행 + qwen2.5vl:7b + python3+Pillow(설치됨).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.PYTHON_BIN || 'python3';
const SCRIPT = path.join(HERE, '..', 'scripts', 'board_read_local.py');
const VLM_TIMEOUT_MS = Number(process.env.VLM_TIMEOUT_MS || 120000);

// article → 로컬 타일링 판독 결과 또는 null.
//  반환: { part3Roster[], assign{순번:배정}, _source, _ms }  (순번 index+1, 괄호 점유자 원문 유지)
export async function readBoardLocal(article, { reads = 2 } = {}) {
  const img = article?.images?.[0] || article?.image || '';
  if (!img) return null;
  const t0 = Date.now();
  let out;
  try {
    out = await runPy({ image: img, reads });
  } catch (e) {
    console.error('[localvlm] 오류:', e.message);
    return null;
  }
  const roster = Array.isArray(out?.roster) ? out.roster.map((s) => String(s || '').trim()) : [];
  if (!roster.length) return null;
  return {
    part3Roster: roster,
    assign: out.assign || {},
    _source: out.source || 'local:qwen2.5vl',
    _ms: Date.now() - t0,
  };
}

function runPy(payload) {
  return new Promise((resolve, reject) => {
    const p = spawn(PY, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('타임아웃')); }, VLM_TIMEOUT_MS);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`py exit ${code}: ${err.slice(0, 200)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('py 출력 파싱 실패')); }
    });
    p.stdin.write(JSON.stringify(payload)); p.stdin.end();
  });
}
