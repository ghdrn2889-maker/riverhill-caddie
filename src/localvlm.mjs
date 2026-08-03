// 로컬 VLM 배치표 판독 — 홈서버 GPU의 ollama(qwen2.5vl)로 배치표를 읽는다. ★API 비용 0(전기만).
//  목적: Gemini(유료 크레딧) 의존 축소. 배치표는 세로로 긴 2단 리스트라 통이미지론 아래가 truncate →
//   scripts/board_read_local.py 가 좌/우 열로 크롭+업스케일+타일당 표결 후 순번(인쇄숫자)으로 병합한다.
//   실측(2026-08-03 #26955): 통이미지 50% → 타일링 30/30 이름·괄호점유자 정확(≈100%), 서동환(심영운) 등 쌍둥이까지.
//  ★현 단계 = '섀도'(라이브 judge/알림 파이프라인 미연결). readBoardLocal()로 판독만 뽑아 Gemini와 대조·검증.
//   검증 후 judge()의 1차 판독으로 승격 예정. 전제: 홈서버 ollama 실행 + qwen2.5vl:7b + python3+Pillow(설치됨).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.PYTHON_BIN || 'python3';
const SCRIPT = path.join(HERE, '..', 'scripts', 'board_read_local.py');
const VLM_TIMEOUT_MS = Number(process.env.VLM_TIMEOUT_MS || 180000);

// ★즉시 토글(재시작 불필요) — data/use-local-vlm 파일 있으면 배치표 판독을 로컬 VLM으로. 롤백=rm 파일.
//  (env LOCAL_VLM=1 도 허용.) 판독 시점마다 확인하므로 touch/rm 즉시 반영.
export function useLocalVLM() {
  if (['1', 'true', 'yes'].includes(String(process.env.LOCAL_VLM || '').toLowerCase())) return true;
  try { return fs.existsSync(path.join(DATA_DIR, 'use-local-vlm')); } catch { return false; }
}

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

// 로컬 판독 → judge()가 쓰는 verdict 형식. 이후 코드-only 후처리(resolveCutoff·fixMemberPosByRoster·
//  resolveTeeByGrid·decide)가 회원 순번·근무판정·티오프를 도출한다. Gemini 판독을 완전히 대체.
//  괄호 점유자 = 그 자리 실제 근무자(리버힐 규칙). cutoffName·회원매칭 모두 점유자 기준.
const occHolder = (cell) => { const m = String(cell || '').match(/\(([^)]+)\)/); return (m ? m[1] : String(cell || '')).replace(/\s/g, ''); };

export async function readBoardLocalVerdict(article, member) {
  const b = await readBoardLocal(article, { reads: 3 });
  if (!b || !Array.isArray(b.part3Roster) || !b.part3Roster.length) return null;
  const roster = b.part3Roster.slice();
  const cutPos = Number(b.cutPos) || 0;
  const teeGrid = (b.teeGrid || []).map((t) => ({ pos: Number(t.n), time: String(t.time || ''), course: String(t.course || '').toUpperCase() }))
    .filter((t) => t.pos > 0 && /^\d{1,2}:\d{2}$/.test(t.time));
  const gridMax = teeGrid.reduce((mx, t) => Math.max(mx, t.pos), 0);
  // 날짜: 글 제목에서(예 "2026년 08월 03일 월요일 배치표입니다")
  const dm = String(article?.subject || '').match(/(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일(?:\s*[월화수목금토일]요일)?/);
  // 회원 본인 순번(점유자 기준 매칭)
  const nk = String(member?.name || '').replace(/\s/g, '');
  let myPos = 0;
  for (let i = 0; i < roster.length; i++) { if (nk && occHolder(roster[i]) === nk) { myPos = i + 1; break; } }
  const cut = cutPos || gridMax || 0;
  const myStatus = myPos > 0 ? (cut && myPos <= cut ? 'assigned' : 'spare') : 'off';
  const tee = myPos > 0 ? teeGrid.find((t) => t.pos === myPos) : null;
  return {
    part: '3', category: '배치표', relevant: true, rosterReliable: true,
    part3Roster: roster,
    teeGrid,
    teamCount: cut || null,
    cutoffPosition: cutPos || null,
    cutoffName: cutPos ? occHolder(roster[cutPos - 1] || '') : '',
    cutoffAnnounced: !!cutPos,
    internCount: Number(b.internCount) || 0,
    internTees: [],
    dateLabel: dm ? dm[0].trim() : '',
    assignMap: b.assign || {},
    myPosition: myPos,
    myStatus,
    teeTime: tee ? tee.time : '',
    course: tee ? tee.course : '',
    confidence: 0.9,
    _local: true,
    _source: b._source,
    _ms: b._ms,
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
