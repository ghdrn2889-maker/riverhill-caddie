# 데이터 계약 — API 응답 & 상태 스키마

> 디자인 AI와 구현 AI 사이의 **인터페이스**. 디자인 AI는 이 값들이 화면에 어떻게 들어가는지 알고 화면을 만들고, 구현 AI는 이 계약대로 배선한다.
> 최종 갱신: 2026-07-17. ← [프로젝트 허브](PROJECT.md)

## 프론트엔드가 쓰는 API

### `GET /api/today` — 오늘 상황판 (오늘 화면의 핵심)
```jsonc
{
  "ok": true,
  "empty": false,                // true면 아직 오늘 정보 없음(히어로 숨김/안내)
  "date": "7월 18일 토요일",
  "summary": "김홍구 — 순번 6번 · 근무 확정 · 티오프 17:21(OUT)",
  "state": {
    "name": "김홍구", "part": "3부",
    "myPosition": 6,             // 내 순번(정수) 또는 null
    "status": "assigned",        // ↓ 아래 status 값 표 참고
    "teeTime": "17:21",          // 근무 확정 시 HH:MM, 아니면 ""
    "course": "OUT",             // OUT|IN|""
    "cutoffName": "", "cutoffPosition": null,
    "updatedAt": 1784299250308,  // epoch ms
    "roster3": ["...3부 명단..."], "crossPart3": ["..."]
  },
  "commute": { "tee": "17:21", "arrive": "16:21", "leave": "15:21" }  // teeTime 있을 때만, 없으면 null
}
```

**`status` 값 (UI가 반드시 다뤄야 하는 상태):**
| status | 뜻 | 화면 |
|---|---|---|
| `assigned` / `work` | 근무 확정 | 근무 색, 티오프·출발시각·행동보드 |
| `your_turn` | 지금 출근 차례 | 최고 강조(빨강) |
| `spare` / `waiting` / `near` | 스페어 대기 | 대기 색(주황), 순번. **시간 지어내지 않음** |
| `off` | 휴무 | 조용한 톤 |
| `unknown` / (empty) | 미상 | 히어로 숨김/안내 |

**commute 계산:** 도착 = 티오프 − 준비(PREP_MIN 기본60), 집출발 = 도착 − 이동(COMMUTE_MIN 기본60). "설정한 이동시간 기준"임을 표기(실시간 교통 아님).

### `GET /api/health` — 감시(서버) 상태
```jsonc
{ "ok": true, "alive": true, "ageSec": 12, "failStreak": 0, "lastError": null }
```
`alive`=최근 5분 내 폴링 & 쿠키오류 없음. UI의 "일정 감시" 표시.

### `GET /api/recent` — 소식 피드 (배열, 최신순)
```jsonc
[{
  "id": "26416", "subject": "...", "writer": "전호성", "url": "...",
  "menuName": "배치 시간표", "writeDate": "...",
  "aiMessage": "판독 요약(관련일 때)", "status": "assigned",
  "category": "배치표|변동|추가|취소|개인근태|공지|기타",
  "relevant": true,              // false면 흐리게+"무관한 소식" 토글로 접기
  "priority": "high|info",
  "detectedAt": 1784299250308
}]
```

### 알림 구독
- `GET /api/config` → `{ vapidPublicKey }`
- `POST /api/subscribe` (구독 객체) → 등록(멱등). 앱은 열 때마다 현재 구독 재등록(자가복구).
- `POST /api/test` → 폰에 테스트 알림 1회. **주의: 남용 금지(스팸).**

**"알림 전달"(이 폰) 상태는 클라이언트가 로컬 판정:** `Notification.permission` + `pushManager.getSubscription()` → 정상/권한없음/미연결.

### 근무·세무 기록
- `GET /api/worklog?year&month` → `{ days:[...], summary:{workedDays,totalKm,roundKm,pendingDays,blankDays,estFuel}, settings:{homeGolfKmOneway,driverName,carNo} }`
- `POST /api/worklog/confirm {date,worked}` · `/settings` · `/photo {date,leg,image}` · `/odo {date,odo}`
- `GET /api/worklog/export.csv` · `/report.html` (증빙 PDF용) · `/photo/:fname`

## judge verdict 스키마 (판독 결과 — 내부)

judge.mjs가 글+이미지를 Gemini로 판단해 내는 구조화 결과. today.mjs가 이걸 상황판에 병합.
```jsonc
{
  "relevant": true,              // 김홍구 3부와 관련?
  "part": "3",                   // 1|2|3|unknown (함부로 3 단정 금지)
  "myCellColor": "white",        // white|colored|gray|unknown ★근무/스페어 최우선 근거
  "myStatus": "assigned",        // status 값(위 표)
  "myPosition": 6,
  "teeGrid": [{"pos":6,"time":"17:21","course":"OUT"}],  // "OUT n부 IN" 표 전사
  "teeTime": "17:21", "course": "OUT",
  "cutoffAnnounced": false, "cutoffName": "", "cutoffPosition": null,
  "part3Roster": ["..."], "crossPartNames": ["..."], "subjectNames": ["..."],
  "category": "배치표", "note": "", "confidence": 0.9,
  "summary": "김홍구님 기준 한 문장"
}
```
- 코드가 `teeGrid`에서 myPosition으로 티오프 확정(모델 눈대중 방지).
- 배경색(myCellColor)이 근무/스페어 최우선 근거. 흰색=근무확정(티오프 없어도 유지).
