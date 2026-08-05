// 감시 클로드(골격) — 시스템이 오류·이상을 뱉을 때마다 자동으로 '원인을 진단'한다.
//  ★안전 경계(사용자 확정): 진단·제안까지만. 코드 자동수정·자동배포는 안 한다(--allowedTools Read,Grep,Glob =
//   읽기 전용, Edit/Bash 없음). 상태 이상은 이미 결정적 자가복구가 처리하고, 여긴 사람이 검토할 진단서를 만든다.
//  ★별도 프로세스(monitor)에서 구동 — 메인 서버가 크래시해도 그걸 진단할 수 있게.
//  ★비용: 새 신호가 뜰 때만·시간당 상한·중복 서명 억제. 잡음엔 클로드를 안 부른다(MAX 정액이지만 폭주 방지).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './env.mjs';
import { DATA_DIR, appendJSONL, loadJSON, saveJSON } from './store.mjs';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const SCAN_MS = Number(process.env.WATCHDOG_SCAN_MS || 5 * 60 * 1000);   // 5분마다 신호 점검
const MAX_PER_HOUR = Number(process.env.WATCHDOG_MAX_PER_HOUR || 3);      // 진단 폭주 상한
const STATE_FILE = 'watchdog-state.json';

// 읽기 전용 조사 러너 — repo cwd 에서 클로드가 소스+로그를 실제로 읽어 원인을 파고든다. 절대 수정 안 함.
function runInvestigate(prompt, timeoutMs = 300000) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let p;
    try {
      p = spawn(CLAUDE_BIN, ['-p', prompt, '--allowedTools', 'Read,Grep,Glob'], {
        stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env }, cwd: ROOT_DIR,
      });
    } catch (e) { return resolve(null); }
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } resolve(null); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => { clearTimeout(timer); resolve(null); });
    p.on('close', () => { clearTimeout(timer); resolve(out || null); });
  });
}

function parseJsonLoose(s) {
  const t = String(s || '');
  const a = t.indexOf('{'); if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true; else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(t.slice(a, i + 1)); } catch { return null; } }
  }
  return null;
}

// 신호원에서 '지난 점검 이후 새로 생긴 것'만 모은다. 각 항목은 { source, at, summary, raw }.
function readNewSignals(state) {
  const since = Number(state.lastAt || 0);
  const out = [];
  const tailJsonl = (name, label, map) => {
    try {
      const p = path.join(DATA_DIR, name);
      if (!fs.existsSync(p)) return;
      const lines = fs.readFileSync(p, 'utf8').trim().split(/\n/).slice(-200);
      for (const ln of lines) {
        let o; try { o = JSON.parse(ln); } catch { continue; }
        if (Number(o.at) > since) out.push({ source: label, at: Number(o.at), ...map(o) });
      }
    } catch { /* noop */ }
  };
  // 칠판 정합성/복구 실패 — 자가복구가 실패했거나 이상이 반복되면 여기로.
  tailJsonl('dayboard-anomaly.jsonl', 'dayboard', (o) => ({ summary: `${o.kind} want=${o.want} got=${o.got} (${o.date})`, raw: o, weight: o.kind === 'cut_heal_failed' ? 3 : 1 }));
  // 폴링 실패(쿠키 만료 등) — health.json 은 단일 스냅샷이라 failStreak 로 판단.
  try {
    const h = loadJSON('health.json', {});
    if (Number(h.failStreak) >= 3 && Number(h.lastPollAt) > since) out.push({ source: 'health', at: Number(h.lastPollAt), summary: `크롤러 폴링 실패 ${h.failStreak}회 (${h.lastError || ''})`, raw: h, weight: 3 });
  } catch { /* noop */ }
  return out;
}

// 신호 묶음 → 클로드 진단서. 코드+로그를 실제로 읽고 원인·심각도·수정안을 JSON으로.
export async function diagnose(signals) {
  const brief = signals.map((s) => `- [${s.source}] ${s.summary}`).join('\n');
  const prompt = `당신은 리버힐 캐디 배치표 시스템(Node.js, src/*.mjs)의 자동 진단자입니다.
방금 아래 이상 신호가 감지됐습니다. 코드(src/)와 로그(data/*.jsonl, data/*.json)를 읽어 원인을 파악하세요.
읽기 전용입니다 — 절대 파일을 수정하지 말고, 진단과 '제안'만 하세요.

이상 신호:
${brief}

조사 후 JSON 하나로만 답하세요(설명·코드펜스 금지):
{
 "isRealBug": true|false,          // 실제 버그인가, 아니면 무해한 잡음/외부요인인가
 "severity": "low"|"med"|"high",
 "rootCause": "한두 문장으로 근본 원인",
 "evidence": "근거(파일:라인, 로그 등)",
 "proposedFix": "제안하는 수정(코드 변경 방향). 자동배포는 안 하니 사람이 검토할 수 있게 구체적으로",
 "autoRecoverable": true|false     // 코드 수정 없이 상태 재처리(재스캔 등)로 복구 가능한가
}`;
  const raw = await runInvestigate(prompt);
  return { report: parseJsonLoose(raw), rawLen: (raw || '').length };
}

export function startWatchdog({ notify } = {}) {
  let busy = false;
  async function tick(now) {
    if (busy) return;
    const state = loadJSON(STATE_FILE, { lastAt: 0, diagAts: [] });
    // 시간당 상한(최근 1시간 진단 수).
    state.diagAts = (state.diagAts || []).filter((t) => now - t < 3600 * 1000);
    const signals = readNewSignals(state);
    const maxAt = signals.reduce((m, s) => Math.max(m, s.at), state.lastAt || 0);
    if (!signals.length) { state.lastAt = Math.max(state.lastAt || 0, maxAt); saveJSON(STATE_FILE, state); return; }
    if (state.diagAts.length >= MAX_PER_HOUR) {
      console.warn(`🐕 [감시] 시간당 진단 상한(${MAX_PER_HOUR}) — 이번 신호는 진단 보류(신호는 로그에 있음)`);
      state.lastAt = maxAt; saveJSON(STATE_FILE, state); return;
    }
    busy = true;
    try {
      console.log(`🐕 [감시] 새 이상 신호 ${signals.length}건 → 클로드 진단 시작`);
      const { report } = await diagnose(signals);
      state.diagAts.push(now);
      state.lastAt = maxAt;
      saveJSON(STATE_FILE, state);
      const rec = { at: now, signals: signals.map((s) => ({ source: s.source, summary: s.summary })), report };
      appendJSONL('watchdog-reports.jsonl', rec);
      if (report) {
        console.log(`🐕 [감시] 진단: real=${report.isRealBug} sev=${report.severity} — ${report.rootCause}`);
        if (report.isRealBug && ['med', 'high'].includes(report.severity) && typeof notify === 'function') {
          try { await notify(report, signals); } catch (e) { console.error('[감시] 알림 오류:', e.message); }
        }
      } else {
        console.warn('🐕 [감시] 진단 파싱 실패(클로드 응답 형식) — 원문은 리포트에 없음, 재시도 다음 신호에');
      }
    } catch (e) { console.error('[감시] 진단 오류:', e.message); }
    finally { busy = false; }
  }
  // 시작 신호 기준선: 지금까지의 이상은 '이미 처리됨'으로 보고 이후 새 신호만 진단.
  const s0 = loadJSON(STATE_FILE, null);
  if (!s0) { saveJSON(STATE_FILE, { lastAt: bootNow(), diagAts: [] }); }
  setInterval(() => { tick(bootNow()).catch(() => {}); }, SCAN_MS);
  console.log(`🐕 감시 클로드 골격 가동: ${SCAN_MS / 1000}s 간격·시간당 최대 ${MAX_PER_HOUR}건 진단(읽기전용·자문, 자동배포 안 함)`);
}

// 서버 TZ 무관 현재 ms(테스트/재현 안전성 위해 함수화).
function bootNow() { return Date.now(); }
