# GitHub Actions 무료 배포 가이드

노트북/서버 없이, GitHub이 5분마다 카페를 확인해 폰으로 알림을 보냅니다.
- 감시: **GitHub Actions** (5분 주기)
- 앱(PWA): **GitHub Pages** (무료 고정 HTTPS 주소)
- 비밀값(쿠키·키·구독): **GitHub Secrets** (암호화 저장, 코드엔 안 들어감)

---

## 1. 저장소 만들기 (Public 권장)

GitHub에서 새 저장소 생성 → 이름 예: `riverhill-caddie` → **Public** 선택.

> ❓ 왜 Public? Private은 Actions 무료 시간이 월 2000분이라 5분 주기면 초과돼요.
> **Public은 Actions 무제한 무료.** 비밀값은 Secrets에 암호화되어 공개되지 않으니 안전합니다.
> (코드에는 쿠키/키가 없어요. `.env`·zip은 업로드에서 제외돼 있습니다.)

## 2. 코드 올리기

이미 로컬에서 git 커밋까지 해뒀어요. 저장소 주소만 연결해 푸시하면 됩니다.
(아래 `<사용자명>`, `<저장소>` 를 본인 것으로 바꾸세요.)

```powershell
git remote add origin https://github.com/<사용자명>/<저장소>.git
git branch -M main
git push -u origin main
```
> 처음 push 시 로그인 창이 뜨면 GitHub 계정으로 로그인하면 됩니다.

## 3. Actions 쓰기 권한 켜기 (중요)

저장소 → **Settings → Actions → General** → 맨 아래 **Workflow permissions** →
**"Read and write permissions"** 선택 → Save.
(감시 결과 상태를 저장소에 기록하려면 필요해요.)

## 4. 비밀값(Secrets) 등록

저장소 → **Settings → Secrets and variables → Actions** → **New repository secret** 로
아래 5개를 등록. 값은 **본인 PC의 `.env` 파일**에서 복사하세요.

| 이름 | 값 (.env 에서 복사) |
|---|---|
| `NID_AUT` | .env 의 NID_AUT 값 |
| `NID_SES` | .env 의 NID_SES 값 |
| `GEMINI_API_KEY` | .env 의 GEMINI_API_KEY 값 |
| `VAPID_PUBLIC_KEY` | .env 의 VAPID_PUBLIC_KEY 값 |
| `VAPID_PRIVATE_KEY` | .env 의 VAPID_PRIVATE_KEY 값 |
| `CONTACT_EMAIL` | 본인 이메일 (예: ghdrn2889@gmail.com) |

> `PUSH_SUBSCRIPTION` 은 6단계에서 폰으로 구독한 뒤 추가합니다.

## 5. GitHub Pages 켜기 (앱 주소 만들기)

저장소 → **Settings → Pages** → Source: **Deploy from a branch** →
Branch: **main**, 폴더: **/docs** → Save.
1~2분 뒤 주소가 나옵니다: `https://<사용자명>.github.io/<저장소>/`

## 6. 폰에 앱 설치 + 구독 등록

1. 위 Pages 주소를 **폰 크롬**으로 열기 → `⋮` → **홈 화면에 추가** → 실행
2. **알림 켜기** → 권한 허용
3. 화면에 뜬 **"구독 정보"를 복사**
4. 저장소 → **Settings → Secrets → New repository secret** →
   이름 `PUSH_SUBSCRIPTION`, 값에 붙여넣기 → 저장

## 7. 첫 실행 + 확인

저장소 → **Actions** 탭 → **watch-cafe** → **Run workflow** 버튼으로 수동 1회 실행.
- 첫 실행은 "기준선"이라 알림이 안 와요 (현재 글을 기록만).
- 이후 **5분마다 자동 실행**되고, 새 3부 변동이 뜨면 폰으로 순번 알림이 옵니다.

끝! 이제 아무 기기도 안 켜둬도 GitHub이 24시간 감시합니다.

---

## 유지보수

- **쿠키 만료 시**: "쿠키 만료" 알림이 와요. PC 크롬에서 새 NID_AUT/NID_SES 를 뽑아
  Secrets의 값을 업데이트하면 됩니다. (재배포 불필요)
- **로그 보기**: Actions 탭에서 각 실행 로그 확인.
- **감시 멈추기**: Actions 탭 → watch-cafe → 오른쪽 `···` → Disable workflow.
- **60일 무활동 시** 예약 실행이 자동 중지될 수 있어요. 가끔 아무 커밋이나 하면 유지됩니다.
