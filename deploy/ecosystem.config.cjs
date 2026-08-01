// pm2 프로세스 정의 — Lightsail 공존 배치용.
//  실행:  pm2 start deploy/ecosystem.config.cjs
//         pm2 save
//         pm2 startup   (출력되는 sudo 명령 1회 실행 → 부팅 시 자동 기동)
//
// ※ 비밀값(GEMINI_API_KEY·VAPID·네이버 쿠키/OAuth·MONITOR_TOKEN 등)과 운영 플래그
//    (MINOR_PART_PUSH·LEDGER_SCAN_GEMINI_FALLBACK·HOST·PORT)는 여기 넣지 말고
//    /home/admin/riverhill-caddie/.env 에 둔다(앱이 loadEnv()로 읽음). deploy/MIGRATION.md 참고.
module.exports = {
  apps: [
    {
      name: 'riverhill',                 // 사용자 앱 (Apache가 :3000으로 프록시)
      script: 'src/server.mjs',
      cwd: '/home/admin/riverhill-caddie',
      max_memory_restart: '450M',        // Gemini 이미지(배치표·영수증) 처리 스파이크 안전핀
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'riverhill-monitor',         // 관리자 모니터 (Tailscale 사설 접근, 공개 X)
      script: 'src/monitor.mjs',
      cwd: '/home/admin/riverhill-caddie',
      max_memory_restart: '250M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
  ],
};
