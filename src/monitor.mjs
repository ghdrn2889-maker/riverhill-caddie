// 운영 모니터링 사이트 — 본 앱과 별개의 작은 서버(다른 포트).
//  같은 data/(app.db·로그)를 '읽기 전용'으로 보고, 가입·방문·재접속·배치표 이해도를 한 눈에 표시.
//  실행:  node src/monitor.mjs   (pm2로 riverhill-monitor 로 따로 띄우면 됨)
//  보안:  MONITOR_TOKEN 설정 시 ?k=토큰 필요. 미설정이면 로컬/사설망 전용으로만 쓸 것.
import express from 'express';
import path from 'node:path';
import { loadEnv, ROOT_DIR } from './env.mjs';
import { computeStats, computeBoardParts } from './analytics.mjs';
import { listMembersForAdmin, setUserStatus, getUser, getProfile } from './users.mjs';
import { initPush, broadcast } from './push.mjs';

loadEnv();
const PORT = Number(process.env.MONITOR_PORT || 3100);
const HOST = process.env.MONITOR_HOST || '0.0.0.0';
const TOKEN = process.env.MONITOR_TOKEN || '';

// 승인 시 그 회원 폰으로 알림을 보내려면 VAPID 필요. 없으면 승인은 되되 알림만 비활성(모니터는 계속 동작).
let pushReady = false;
try { initPush(); pushReady = true; }
catch (e) { console.warn('⚠️ 푸시 초기화 실패 — 승인 알림 비활성:', e.message); }

const app = express();
app.use(express.json());   // 승인 POST 바디 파싱

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
// ── 회원 승인(관리자) — 실시간 승인신청 처리. 앱의 회원관리 대체. ──
app.get('/api/members', gate, (req, res) => {
  try { res.json({ ok: true, members: listMembersForAdmin(), pushReady }); }
  catch (e) { console.error('members 오류:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/user-status', gate, async (req, res) => {
  const id = Number(req.body?.id);
  const status = String(req.body?.status || '');
  const reason = String(req.body?.reason || '') || null;   // 차단 사유(roster|other)
  if (!id || !['active', 'pending', 'disabled'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'id·status(active|pending|disabled) 필요' });
  }
  const target = getUser(id);
  if (!target) return res.status(404).json({ ok: false, error: '회원을 찾을 수 없어요.' });
  if (target.role === 'admin') return res.status(400).json({ ok: false, error: '관리자 계정 상태는 바꿀 수 없어요.' });
  const u = setUserStatus(id, status, reason);
  // ★승인(active) 즉시 그 회원 폰으로 알림 — 대기화면이 곧바로 앱으로 넘어가도록.
  let notified = false;
  if (status === 'active' && pushReady) {
    try {
      const nm = (getProfile(id) || {}).board_name || '회원';
      await broadcast({
        title: '가입 승인 완료 🎉',
        body: `${nm}님, 리버힐 캐디 앱 이용이 승인됐어요. 지금 바로 열어보세요!`,
        url: '/', level: 'high', bypassQuiet: true,
      }, id);
      notified = true;
    } catch (e) { console.error('승인 알림 발송 실패:', e.message); }
  }
  console.log(`👤 [monitor] 회원 #${id} 상태 → ${status}${status === 'disabled' ? `(${u.block_reason})` : ''}${notified ? ' · 승인알림 발송' : ''}`);
  res.json({ ok: true, id, status, notified, blockReason: u.block_reason || null });
});

app.get('/', gate, (req, res) => res.sendFile(path.join(ROOT_DIR, 'monitor', 'index.html')));

app.listen(PORT, HOST, () => {
  console.log(`📊 모니터링 사이트 실행: http://localhost:${PORT}`
    + (TOKEN ? '  (접속 시 ?k=토큰 필요)' : '  (⚠️ MONITOR_TOKEN 미설정 — 접근 제한 없음)'));
});
