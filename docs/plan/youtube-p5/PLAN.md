# P5 YouTube 재생 정보·제어·로그인·목록

- 상태: 단계 A~E 구현
- 원본 계획: 세션 plan.md (2026-08-18)
- 구현 범위: 정보 패널, 화면/물리 전송, persist 세션 로그인, 로컬 목록 GUI

자세한 결정과 안전 경계는 세션 계획과 같다.

구조 검토(개선 후보·유지 결정): [`STRUCTURE_REVIEW.md`](./STRUCTURE_REVIEW.md).
단계 그림: [`docs/diagrams/youtube-pipeline.html`](../../diagrams/youtube-pipeline.html).

- P5는 YouTube 고정. 하단 3슬롯은 `youtube-transport`이며 F16~F18 RAM 매핑으로 앱이 가로챈다.
- 광고 제거는 YouTube Premium + `persist:youtube-lcd` 로그인. Data API OAuth는 쓰지 않는다.
- 목록은 `config.youtubeLibrary` 로컬 큐. Mix/재생목록 import는 제외.
- HID는 `0x02`/`0x10`/`0x25` RAM only.
- 재생 엔진은 로그인된 공식 watch 페이지다. 스트림을 앱이 직접 받아 재인코딩하지 않는다.
- 같은 세션으로 숨은 창을 둘로 나눈다. 소리 창은 픽셀을 안 뜯고, LCD 창은 음소거 후 240×135 RGB565만 뽑는다.
- 앱 미리보기는 기기로 보낸 그 RGB565를 PNG로 복원해 같은 캡처 주기로 표시한다.
- LCD 캡처는 HID 한 장 전송 ms×0.55(40–100ms)로 자동 조절한다. 워커는 최신 1장만 보낸다.
- 재생 창 베젤 우측 하단은 끝-끝 딜레이가 아니라 직전 HID 전송 간격(ms)을 보여 준다.
