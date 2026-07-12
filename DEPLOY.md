# 리버힐 알림 — 리눅스 24시간 배포 가이드

목표: 리눅스 서버에서 24시간 자동 구동(재부팅해도 자동 실행) + 폰에서 접속할 **고정 HTTPS 주소**.

---

## 0. 코드 옮기기

Windows PC의 프로젝트를 리눅스로 복사합니다. (제공된 `riverhill-deploy.zip` 사용)

```bash
# 리눅스에서, zip을 홈으로 옮긴 뒤
mkdir -p ~/riverhill && cd ~/riverhill
unzip ~/riverhill-deploy.zip -d ~/riverhill
ls   # src, public, package.json, .env 등이 보이면 OK
```

> ⚠️ `.env` 에는 쿠키·키가 들어 있어요. 이 zip을 **외부에 업로드하지 마세요.** 내 두 기기 사이 복사에만 쓰세요.

## 1. Node.js 설치 (18 이상)

```bash
# Ubuntu / Debian 계열
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs unzip
node -v    # v18 이상이면 OK
```

## 2. 의존성 설치

```bash
cd ~/riverhill
npm install
```

## 3. .env 확인

Windows에서 가져온 `.env` 를 그대로 씁니다. 아래 값들이 있는지 확인:

```bash
grep -E 'NID_AUT|NID_SES|GEMINI_API_KEY|VAPID_PUBLIC|VAPID_PRIVATE|MY_NAME' .env
```

없으면 `cp .env.example .env` 후 값을 채우세요.

## 4. pm2 로 24시간 구동 (자동 재시작 + 부팅 시 자동 실행)

```bash
sudo npm install -g pm2
pm2 start src/server.mjs --name riverhill
pm2 save
pm2 startup        # 출력되는 'sudo env ... ' 명령을 복사해 그대로 한 번 실행
pm2 logs riverhill # 로그 확인 (빠져나오려면 Ctrl+C)
```

이제 서버가 리눅스에서 항상 켜져 있고, 죽어도 자동 재시작됩니다.

## 5. 고정 HTTPS 주소 만들기 (Tailscale Funnel — 무료·도메인 불필요)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up             # 브라우저로 로그인 링크가 뜸 → 구글/깃허브로 로그인
sudo tailscale funnel 3000    # 로컬 3000 포트를 공개 HTTPS 로 노출
```

- 실행하면 `https://<기기이름>.<이름>.ts.net` 형태의 **고정 주소**가 출력됩니다.
- 만약 "Funnel 기능을 켜라"는 안내가 나오면, 출력된 링크(admin console)에서 Funnel 을 활성화한 뒤 위 명령을 다시 실행하세요.
- 백그라운드로 계속 두려면: `sudo tailscale funnel --bg 3000`

## 6. 폰에 최종 앱 설치

1. 위 `https://....ts.net` 주소를 **폰 크롬**으로 열기
2. `⋮` → **홈 화면에 추가**
3. 홈 아이콘으로 실행 → **알림 켜기**

끝! 이제 이 PC를 꺼도 리눅스 서버가 24시간 감시하고, 3부 변동이 뜨면 폰으로 순번 알림이 옵니다.

---

## 유지보수 메모

- **쿠키 만료 시**: 감시가 멈추면 앱이 "쿠키 만료" 알림을 보냅니다. Windows에서 새 쿠키를 뽑아 리눅스 `.env` 의 `NID_AUT`/`NID_SES` 를 갱신하고 `pm2 restart riverhill`.
- **로그 보기**: `pm2 logs riverhill`
- **재시작**: `pm2 restart riverhill` / **중지**: `pm2 stop riverhill`
- **상태**: `pm2 status`
