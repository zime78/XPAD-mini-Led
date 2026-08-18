# P5 YouTube 재생 정보·제어·로그인·목록

- 상태: 단계 A~E 구현
- 원본 계획: 세션 plan.md (2026-08-18)
- 구현 범위: 정보 패널, 화면/물리 전송, persist 세션 로그인, 로컬 목록 GUI

자세한 결정과 안전 경계는 세션 계획과 같다.

- P5는 YouTube 고정. 하단 3슬롯은 `youtube-transport`이며 F16~F18 RAM 매핑으로 앱이 가로챈다.
- 광고 제거는 YouTube Premium + `persist:youtube-lcd` 로그인. Data API OAuth는 쓰지 않는다.
- 목록은 `config.youtubeLibrary` 로컬 큐. Mix/재생목록 import는 제외.
- HID는 `0x02`/`0x10`/`0x25` RAM only.
