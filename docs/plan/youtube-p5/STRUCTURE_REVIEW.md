# YouTube LCD 현재 구조

| 항목 | 내용 |
|---|---|
| 목적 | 인증 유지 + Mac 소리 끊김 방지 + 기기 240×135 RGB565 전송 |
| 대상 | `src/main/display/youtube-lcd.ts`, `src/main/index.ts`, `src/main/device/*`, `src/renderer/src/components/player-view.tsx` |
| 갱신 | 2026-08-18 |
| 그림 | [docs/diagrams/youtube-pipeline.html](../../diagrams/youtube-pipeline.html) |

## 결론

**로그인된 공식 watch를 유지한다.** 스트림을 앱이 받아 재인코딩하지 않는다.  
같은 `persist:youtube-lcd` 세션으로 창을 둘로 나눈다.

```
같은 로그인 세션
 ├─ 소리 창: 재생만. getImageData 없음. setPlaybackQuality 없음
 └─ LCD 창: 음소거, tiny 고정, HID 전송 ms×0.55 자동 폴링(40–100ms)
      ├─ HID 0x25 → 기기 (최신 1장만)
      └─ 같은 RGB565 → PNG 미리보기 (같은 캡처 주기)
           └─ 베젤 우측 하단: 직전 HID 전송 간격(ms)
```

## 단계

| 단계 | 누가 | 하는 일 |
|---|---|---|
| 1 LOAD | Electron main | 숨은 창 2개에 같은 `watch?v=…&vq=tiny` 로드 |
| 2 DECODE | 각 Chromium renderer | YouTube MSE 디코드. 앱은 디코더 API를 안 연다 |
| 3 PLAY | 소리 창 | 스피커로만 나감. 픽셀을 안 뜯음 |
| 4 TAP | LCD 창만 | HID `drawMs×0.55` 자동 주기(40–100ms), 진행 중이면 스킵. `getImageData` → 240×135 RGBA |
| 5 ENCODE | Electron main | RGBA → RGB565-LE 64,800바이트. 디더 없음 |
| 6 SEND | Device worker | `0x25` 최신 1장만. 전송 후 `lcdStats.drawMs` |
| 미리보기 | 재생 창 UI | 같은 RGB565를 PNG로 복원. 베젤에 전송 간격 표시 |

보조:

| 주기 | 동작 |
|---|---|
| 2초 | 소리 창: play 유지. LCD 창: 음소거·tiny 유지·탭 재부착 |
| 1초 | 소리 창 메타/광고. LCD가 1.5초 이상 벌어지면 LCD만 seek |
| 자동 40–100ms | LCD 캡처. `nextYoutubeCaptureIntervalMs` = `clamp(hidDrawMs×0.55, 40, 100)`. HID 실측 전 기본 55ms |
| HID ~95–110ms | 전체 장 전송 1회. 기기 상한 약 10fps. 전송이 끝나면 대기 중인 최신 장을 바로 보냄 |

## 자동 주기와 겹침

캡처를 HID보다 조금 빨리 해서, 전송이 끝날 때 더 새 장이 대기하게 둔다. 워커는 큐를 쌓지 않고 **최신 1장만** 보낸다.

| 항목 | 값 | 의미 |
|---|---|---|
| `CAPTURE_HID_OVERLAP` | 0.55 | 캡처 주기 = HID 전송 시간의 55% |
| 겹침(무시) | 약 45% | 뽑은 장 중 HID가 안 보내는 비율 (`hidIgnorePct`) |
| 1ms 고정 | 쓰지 않음 | 실측에서 캡처의 ~96%가 HID에서 버려짐 |
| 전송 간격 | `hidDrawMs` | 초당 장 수. 겹침과 무관 |

`DeviceHost.lastLcdDrawMs`는 워커 `lcdStats`의 지수평균(0.7/0.3)이다.

## 베젤 숫자

재생 창 LCD 셸 오른쪽 맨 아래에 `97ms`처럼 표시한다.

- **보내는 간격**이다. 직전 `0x25` 한 장 전송 ms (`youtubeLcdSendIntervalMs`).
- 뽑기·인코딩·대기 장 나이를 더한 끝-끝 딜레이가 아니다.
- YouTube일 때만. 아직 한 장도 안 보냈으면 숨긴다.
- 상태 필드명은 `StatusSnapshot.youtubeLcdDelayMs`이나 값은 전송 간격이다.

## 유지하는 결정

| 결정 | 이유 |
|---|---|
| 공식 watch, embed 금지 | Electron에서 embed 152-4 거절 사례. 로그인·Premium·광고는 YouTube가 처리 |
| 직접 다운로드/ffmpeg 사본 없음 | 인증 필수 조건과 충돌 |
| 기기에 영상 파일 없음 | 펌웨어는 RGB565만. `0x25` RAM |
| Mix/재생목록 ID 거부 | `parseYouTubeVideoId` |
| 화질 바닥 `tiny`(144p) | LCD는 240×135 |
| 최신 1장만 HID | 큐를 쌓으면 기기만 바빠짐 |
| 캡처 자동 + 한 장 겹침 | 전송 fps를 올리지 않고 보내는 장만 더 새것으로 |

## 이미 반영한 수정

| 이전 문제 | 현재 |
|---|---|
| 2초마다 소리 창에 setQuality/volume=1 | 화질 API는 LCD 창만. 소리는 미세 오차(≥0.99) 무시 |
| 소리 나는 renderer에서 getImageData | LCD 음소거 창에서만 탭 |
| 미리보기 500ms라 컴퓨터가 더 끊김 | 기기와 같은 RGB565·같은 캡처 주기 |
| 1ms/고정 주기로 CPU만 낭비 | HID `drawMs×0.55` 자동. 무시 ~45% |
| 베젤에 끝-끝 딜레이(122ms) | 직전 HID 전송 간격만 표시 |
| 내부 화질/볼륨 로그 없음 | 전환 시 `youtube-audio` jsonl |

## 남은 한계

- 창 2개라 RAM·CPU가 늘어난다.
- 광고 타이밍은 창마다 다를 수 있다 (허용).
- `sandbox: false`는 두 watch 창 모두. 픽셀 탭 때문에 켠 값이다.
- `hwdecode=on`은 로그 라벨이다. VideoToolbox 직접 호출은 없다.
- 소리 창과 LCD 창 시각 차이는 베젤 숫자에 안 들어간다 (허용 1.5초).
- 설치본 확인은 `./build.sh deploy host` 이후.

## 확인

| 보고 싶은 것 | 보는 곳 |
|---|---|
| 분리 기동 | 콘솔 `source=split-audio-lcd` `capture=auto` |
| LCD 화질 | `lcd quality=tiny` |
| 자동 주기 | `intervalMs=` · `hidIgnorePct≈45` |
| HID 전송 간격 | 베젤 `NNms` = `hidDrawMs`. 콘솔은 `XPAD_LCD_FPS_LOG=1` 때 `[lcd-fps] hidFps≈10` |
| 미리보기=기기 | 같은 장, 같은 끊김 |

## 문서

| 산출 | 경로 |
|---|---|
| 단계 그림 | `docs/diagrams/youtube-pipeline.html` |
| 그림 입력 | `docs/diagrams/youtube-pipeline.process.json` |
| 기능 계획 | `docs/plan/youtube-p5/PLAN.md` |
| 이 문서 | `docs/plan/youtube-p5/STRUCTURE_REVIEW.md` |
