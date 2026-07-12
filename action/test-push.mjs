// 테스트: PUSH_SUBSCRIPTION 으로 폰에 알림 한 번 발송 (전체 연결 확인용).
import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:' + (process.env.CONTACT_EMAIL || 'admin@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

let subs;
try {
  const parsed = JSON.parse(process.env.PUSH_SUBSCRIPTION || '[]');
  subs = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  console.error('❌ PUSH_SUBSCRIPTION 파싱 실패 — Secret 값을 확인하세요.');
  process.exit(1);
}
if (!subs.length) { console.error('❌ PUSH_SUBSCRIPTION 비어있음'); process.exit(1); }

let ok = 0;
for (const s of subs) {
  try {
    await webpush.sendNotification(s, JSON.stringify({
      title: '🏌️ 테스트 알림',
      body: 'GitHub에서 폰까지 정상 연결됐어요! 이제 진짜 3부 변동이 뜨면 알려드릴게요.',
      url: './',
    }));
    ok++;
    console.log('✅ 발송 성공');
  } catch (e) {
    console.error('❌ 발송 실패:', e.statusCode, e.body || e.message);
  }
}
if (!ok) process.exit(1);
console.log(`총 ${ok}대 발송 완료`);
