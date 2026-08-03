// 로컬 VLM 배치표 판독 — 홈서버 GPU의 ollama(qwen2.5vl)로 배치표를 읽는다. ★API 비용 0(전기만).
//  목적: Gemini(유료 크레딧) 의존을 줄인다. 로컬은 공짜라 표결(다회)·섀도검증을 마음껏 돌릴 수 있다.
//  ★현 단계 = '섀도'(라이브 알림/대시보드 파이프라인엔 미연결). readBoardLocal()로 판독만 뽑아
//   Gemini 결과와 대조·프롬프트 튜닝하는 검증 도구. 검증되면 judge()의 1차 판독으로 승격 예정.
//  전제: 홈서버에 ollama 실행 중 + `qwen2.5vl:7b` pull됨(이미 설치됨). GPU 드라이버 mismatch여도 CUDA 연산은 동작.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const VLM_MODEL = process.env.VLM_MODEL || 'qwen2.5vl:7b';
const VLM_TIMEOUT_MS = Number(process.env.VLM_TIMEOUT_MS || 60000);

// 이미지 소스(data URI · http URL · 순수 base64) → base64 문자열.
async function toBase64(img) {
  if (!img) return null;
  if (img.startsWith('data:')) return img.split(',')[1] || null;
  if (/^https?:/.test(img)) {
    const r = await fetch(img);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  return img; // 이미 base64로 간주
}

// 배치표 판독 프롬프트 — 순번 정렬·괄호 점유자·근무배정 숫자 무시·커트·인턴 규칙 명시.
function boardPrompt(part) {
  return `이건 골프장 캐디 배치표(${part}부)다. 표를 정확히 읽어 JSON으로만 답하라.
규칙:
- roster: 순번 1번부터 끝까지 '순서대로' 이름 배열(위→아래, 좌→우). 빈칸도 ""로 유지해 순번(=index+1)이 어긋나지 않게.
- 괄호가 있으면 "이름(점유자)" 원문 그대로 넣어라(예: "신지현(오동현)"). 괄호 안이 그 자리 실제 근무자다.
- 이름 옆 숫자(54, 1,3 등)는 근무배정 표시다 — roster 이름에는 넣지 말고 무시하라.
- cutName/cutPos: 근무 확정선(근무하는 마지막 순번)의 이름과 그 순번 번호(선/색 경계로 판단).
- teamCount: 근무하는 총 팀(순번) 수.
- 노란색 칸(순번 숫자 없이 색만 찬 티오프)은 인턴 → roster에 넣지 말고 internCount만 세라.
JSON 스키마: {"roster":[...], "cutName":"", "cutPos":0, "teamCount":0, "internCount":0}`;
}

// article → 로컬 판독 결과(앱 verdict 유사 스키마) 또는 null.
//  반환: { part3Roster[], teamCount, cutoffName, cutoffPosition, internCount, _source, _ms }
export async function readBoardLocal(article, { part = '3' } = {}) {
  const img0 = article?.images?.[0] || article?.image || '';
  const b64 = await toBase64(img0);
  if (!b64) return null;
  const t0 = Date.now();
  let j;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(VLM_TIMEOUT_MS),
      body: JSON.stringify({ model: VLM_MODEL, prompt: boardPrompt(part), images: [b64],
        stream: false, format: 'json', options: { temperature: 0, num_ctx: 8192 } }),
    });
    if (!res.ok) { console.error(`[localvlm] HTTP ${res.status}`); return null; }
    j = await res.json();
  } catch (e) { console.error('[localvlm] 호출 오류:', e.message); return null; }
  let out;
  try { out = JSON.parse(j.response); } catch { console.error('[localvlm] JSON 파싱 실패'); return null; }
  const roster = Array.isArray(out.roster) ? out.roster.map((s) => String(s || '').trim()) : [];
  if (!roster.length) return null;
  return {
    part3Roster: roster,
    teamCount: Number(out.teamCount) || 0,
    cutoffName: String(out.cutName || '').trim(),
    cutoffPosition: Number(out.cutPos) || null,
    internCount: Number(out.internCount) || 0,
    _source: `local:${VLM_MODEL}`,
    _ms: Date.now() - t0,
  };
}

// 다회 표결(로컬은 공짜라 정확도용) — N회 판독해 순번별 최빈 이름 채택. 갈리면 그대로(호출부가 구조검증).
export async function readBoardLocalConsensus(article, { part = '3', reads = 3 } = {}) {
  const runs = [];
  for (let i = 0; i < reads; i++) { const r = await readBoardLocal(article, { part }); if (r) runs.push(r); }
  if (!runs.length) return null;
  if (runs.length === 1) return runs[0];
  const maxLen = Math.max(...runs.map((r) => r.part3Roster.length));
  const roster = [];
  for (let p = 0; p < maxLen; p++) {
    const tally = {};
    for (const r of runs) { const nm = r.part3Roster[p] || ''; if (nm) tally[nm] = (tally[nm] || 0) + 1; }
    const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    roster.push(best ? best[0] : '');
  }
  const pick = (key) => { const t = {}; for (const r of runs) { const v = r[key]; if (v) t[v] = (t[v] || 0) + 1; } const b = Object.entries(t).sort((a, b) => b[1] - a[1])[0]; return b ? b[0] : (runs[0][key]); };
  return {
    part3Roster: roster,
    teamCount: Number(pick('teamCount')) || runs[0].teamCount,
    cutoffName: pick('cutoffName') || '',
    cutoffPosition: Number(pick('cutoffPosition')) || null,
    internCount: Number(pick('internCount')) || 0,
    _source: `local:${VLM_MODEL}×${runs.length}`,
    _ms: runs.reduce((a, r) => a + r._ms, 0),
  };
}
