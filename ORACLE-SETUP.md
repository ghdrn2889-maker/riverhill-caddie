# Oracle Cloud 무료 서버 만들기 (24시간 호스팅)

노트북을 꺼도 되도록, Oracle의 **평생 무료(Always Free)** 리눅스 서버에 앱을 올립니다.
방화벽/포트 설정은 Tailscale Funnel 이 대신 처리하므로 건드리지 않습니다.

---

## 1단계. Oracle Cloud 계정 만들기

1. https://www.oracle.com/kr/cloud/free/ 접속 → **무료로 시작하기(Start for free)**
2. 이메일·이름 입력 → **국가: South Korea**
3. **홈 리전(Region) 선택**: `South Korea Central (Chuncheon)` 또는 `South Korea North (Seoul)`
   - ⚠️ 리전은 나중에 못 바꿉니다. 한국 리전 선택하세요.
4. 휴대폰 인증
5. **결제 카드 등록** — 본인확인용입니다. **과금되지 않아요.** (약 100원 정도 임시 승인 후 취소될 수 있음)
   - ⚠️ 체크카드는 가끔 거부돼요. 잘 안 되면 **신용카드**로 시도하세요.
6. 가입 완료 후 https://cloud.oracle.com 로그인

## 2단계. 무료 서버(VM) 만들기

1. 왼쪽 위 ☰ 메뉴 → **Compute → Instances → Create instance**
2. **Name**: `riverhill` (아무거나)
3. **Image and shape** 편집:
   - Image: **Canonical Ubuntu 22.04**
   - Shape: **Change shape** → **Specialty and previous generation** →
     **VM.Standard.E2.1.Micro** 선택 (옆에 **"Always Free-eligible"** 표시 확인!)
   - ※ ARM(A1.Flex)은 "out of capacity" 자주 떠요. E2.1.Micro 가 안정적입니다.
4. **SSH keys** (서버 접속 열쇠):
   - **Generate a key pair for me** 선택 → **Save private key** 눌러 파일 다운로드
   - 이 파일(`ssh-key-....key`)을 잘 보관하세요. 서버 접속에 필요합니다.
5. 나머지는 기본값 → **Create** 클릭
6. 1~2분 뒤 상태가 **RUNNING** 되면, **Public IP address** 를 복사해두세요. (예: `140.238.xxx.xxx`)

## 3단계. 서버에 접속하기 (Windows에서)

다운받은 키 파일이 예를 들어 `C:\Users\ghdrn\Downloads\ssh-key-2026.key` 라고 하면,
PowerShell에서:

```powershell
# 키 파일 권한 정리 (안 하면 접속 거부돼요)
icacls "C:\Users\ghdrn\Downloads\ssh-key-2026.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"

# 접속 (ubuntu = 기본 사용자, 뒤는 아까 복사한 Public IP)
ssh -i "C:\Users\ghdrn\Downloads\ssh-key-2026.key" ubuntu@140.238.xxx.xxx
```

`yes` 입력 후 접속되면, 프롬프트가 `ubuntu@riverhill:~$` 처럼 바뀝니다. **여기부터 리눅스 서버 안이에요.**

## 4단계. 코드 올리고 실행 (DEPLOY.md 대로)

먼저 **새 PowerShell 창**에서 zip 을 서버로 전송:

```powershell
scp -i "C:\Users\ghdrn\Downloads\ssh-key-2026.key" "c:\Users\ghdrn\Documents\리버힐 캐디 일정 앱\riverhill-deploy.zip" ubuntu@140.238.xxx.xxx:~/
```

그다음 **서버 접속한 창**에서 [DEPLOY.md](DEPLOY.md) 의 1~6단계를 그대로 진행:
Node 설치 → `unzip riverhill-deploy.zip -d ~/riverhill` → `npm install` → `.env` 확인 →
`pm2` 로 구동 → `tailscale funnel 3000` 으로 고정 HTTPS 주소 → 폰에 설치.

---

## 막히면?

각 단계에서 나오는 화면/에러 메시지를 그대로 붙여주세요. 특히:
- 가입 시 카드 거부 → 다른 카드 시도
- 인스턴스 생성 시 "out of capacity" → 잠시 후 재시도하거나 다른 가용 도메인(AD) 선택
- SSH 접속 안 됨 → 키 파일 경로/권한, Public IP 확인
