# 리버힐 캐디 — 홈서버 → Lightsail 공존 이관 런북

Apache(80/443)가 이미 도는 Lightsail(약 1GB)에 **vhost 추가만으로** 얹는다. 기존 앱
(bukbuid·viberush) **무손상**이 최우선. 도메인 = `riverhill.solar-lend.com`.

## 절대 불가침 (도현 지정)
- 기존 vhost 파일(`000-default*`, `viberush.solar-lend.com*`), `/var/www/html`, `/var/www/viberush`
- cron(BUKBUID `git pull`, `viberush_app_deploy.sh`, 백업/태그/감사), MariaDB(3306), Exim4(25)
- 기존 Let's Encrypt 인증서·심볼릭 링크
→ **우리는 `/home/admin/riverhill-caddie` + 새 vhost 1개 + `/var/www/riverhill-well-known/` 만 추가.**

## 사전 확인
- **Node ≥ 22.5** 필요(앱이 `node:sqlite` 사용). `node -v` 확인. 없거나 낮으면 nodesource로 22 설치
  (기존 앱이 node를 쓰면 버전 영향 주의 — 필요 시 nvm 격리).
- Apache 모듈: `sudo a2enmod proxy proxy_http && sudo systemctl reload apache2`
- 고정 IP: 기존 서브도메인이 이미 서비스 중 → 인스턴스 IP로 확정. `riverhill` A레코드를 **그 IP**로.

## 단계
1. **코드 배치**: `git clone <repo> /home/admin/riverhill-caddie && cd $_ && npm ci`
2. **`.env` 작성** (`/home/admin/riverhill-caddie/.env`) — 비밀값은 홍구님이 홈서버에서 복사(`scp`).
   운영 필수 키:
   ```
   HOST=127.0.0.1            # Apache 프록시 뒤 로컬 전용 바인딩
   PORT=3000
   MONITOR_PORT=3100
   MONITOR_HOST=0.0.0.0      # 방화벽이 공개 3100 차단 · Tailscale로만 접근
   MONITOR_TOKEN=<임의 토큰>  # 사설망이라도 방어(?k=토큰)
   MINOR_PART_PUSH=1
   LEDGER_SCAN_GEMINI_FALLBACK=1   # ★로컬 GPU(Ollama) 없음 → 영수증은 Gemini 폴백
   # + GEMINI_API_KEY, VAPID_*, 네이버 쿠키/OAuth, INGEST_TOKEN 등 홈서버 .env 그대로
   ```
3. **데이터 이관** (무손실): 홈서버에서 앱 잠깐 정지 or WAL 체크포인트 후 `data/` 통째 복사.
   ```
   # 홈서버: pm2 stop riverhill riverhill-monitor  (짧게)
   # data/ 전체(app.db·app.db-wal·app.db-shm·users/·*.json) rsync/scp → Lightsail 앱폴더
   # 복사 후 무결성: node -e 'require("node:sqlite")' 로 열어 카운트 확인
   ```
4. **pm2 기동**: `pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup`(안내 sudo 1회)
5. **Tailscale**(모니터 사설 접근): `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`
   → 홍구님이 `<lightsail-tailscale-ip>:3100?k=토큰` 으로 접근(홈서버와 동일 방식).
6. **assetlinks 정적 배치**: `sudo mkdir -p /var/www/riverhill-well-known && sudo cp deploy/assetlinks.json $_/`
   (지문은 TWA 빌드 후 채움)
7. **vhost 추가 + HTTPS**:
   ```
   sudo cp deploy/riverhill.solar-lend.com.conf /etc/apache2/sites-available/
   sudo a2ensite riverhill.solar-lend.com.conf && sudo systemctl reload apache2
   # ★리로드 직후 기존 두 도메인 200 확인:
   curl -sI https://bukbuid.solar-lend.com | head -1 ; curl -sI https://viberush.solar-lend.com | head -1
   sudo certbot --apache -d riverhill.solar-lend.com
   ```
8. **네이버 OAuth 콜백 URL** 갱신(홍구님, 네이버 개발자콘솔): `https://riverhill.solar-lend.com/api/auth/naver/callback`
9. **검증**: 앱 로드·네이버 로그인·웹푸시 구독·대시보드 데이터·모니터(Tailscale) 확인.
10. **컷오버**: 회원들 새 도메인에서 재설치 안내(홈서버 ts.net 설치본은 그쪽을 가리킴 · 13명 소수).
    홈서버는 검증 끝날 때까지 유지 → 안정되면 정지/개발용 전환.

## 롤백
문제 시 `sudo a2dissite riverhill.solar-lend.com.conf && sudo systemctl reload apache2`
(우리 vhost만 내림 — 기존 앱 무관). Node는 `pm2 delete riverhill riverhill-monitor`.
