// 운영 모니터링 사이트 — 본 앱과 별개의 작은 서버(다른 포트).
//  같은 data/(app.db·로그)를 '읽기 전용'으로 보고, 가입·방문·재접속·배치표 이해도를 한 눈에 표시.
//  실행:  node src/monitor.mjs   (pm2로 riverhill-monitor 로 따로 띄우면 됨)
//  보안:  MONITOR_TOKEN 설정 시 ?k=토큰 필요. 미설정이면 로컬/사설망 전용으로만 쓸 것.
import express from 'express';
import path from 'node:path';
import { loadEnv, ROOT_DIR } from './env.mjs';
import { computeStats, computeBoardParts } from './analytics.mjs';

loadEnv();
const PORT = Number(process.env.MONITOR_PORT || 3100);
const HOST = process.env.MONITOR_HOST || '0.0.0.0';
const TOKEN = process.env.MONITOR_TOKEN || '';

const app = express();

// 토큰 게이트 — 설정돼 있으면 ?k= / x-monitor-token 헤더 / Bearer 중 하나로 통과.
function gate(req, res, next) {
  if (!TOKEN) return next(); // 미설정 = 개방(로컬/사설망 전용 가정)
  const k = req.query.k || req.get('x-monitor-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (k === TOKEN) return next();
  res.status(401).send('unauthorized — ?k=토큰 이 필요합니다.');
}

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/api/stats', gate, (req, res) => {
  try { res.json({ ok: true, ...computeStats() }); }
  catch (e) { console.error('stats 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
// 판독검증 1·2·3부 탭 데이터 — 모니터가 직접 부별 판독(board별 1회 캐시). 앱 무관·읽기 전용.
app.get('/api/board-parts', gate, async (req, res) => {
  try { res.json({ ok: true, board: await computeBoardParts() }); }
  catch (e) { console.error('board-parts 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/', gate, (req, res) => res.sendFile(path.join(ROOT_DIR, 'monitor', 'index.html')));

app.listen(PORT, HOST, () => {
  console.log(`📊 모니터링 사이트 실행: http://localhost:${PORT}`
    + (TOKEN ? '  (접속 시 ?k=토큰 필요)' : '  (⚠️ MONITOR_TOKEN 미설정 — 접근 제한 없음)'));
});
