# YouTube LCD 현재 구조

| 항목 | 내용 |
|---|---|
| 목적 | 인증 유지 + Mac 소리 끊김 방지 + 기기 240×135 RGB565 전송 |
| 대상 | `src/main/display/youtube-lcd.ts`, `src/main/index.ts`, `src/main/device/*` |
| 갱신 | 2026-08-18 |
| 그림 | [docs/diagrams/youtube-pipeline.html](../../diagrams/youtube-pipeline.html) |

## 결론

**로그인된 공식 watch를 유지한다.** 스트림을 앱이 받아 재인코딩하지 않는다.  
같은 `persist:youtube-lcd` 세션으로 창을 둘로 나눈다.

```
같은 로그인 세션
 ├─ 소리 창: 재생만. getImageData 없음. setPlaybackQuality 없음
 └─ LCD 창: 음소거, tiny 고정, 200ms마다 RGB565
      ├─ HID 0x25 → 기기
      └─ 같은 RGB565 → PNG 미리보기 (같은 주기)
```

## 단계

| 단계 | 누가 | 하는 일 |
|---|---|---|
| 1 LOAD | Electron main | 숨은 창 2개에 같은 `watch?v=…&vq=tiny` 로드 |
| 2 DECODE | 각 Chromium renderer | YouTube MSE 디코드. 앱은 디코더 API를 안 연다 |
| 3 PLAY | 소리 창 | 스피커로만 나감. 픽셀을 안 뜯음 |
| 4 TAP | LCD 창만 | 200ms `drawImage` + `getImageData` → 240×135 RGBA |
| 5 ENCODE | Electron main | RGBA → RGB565-LE 64,800바이트. 디더 없음 |
| 6 SEND | Device worker | `0x25` diff 청크, 220ms 유지 전송 |
| 미리보기 | 재생 창 UI | `rgb565ToPngDataUrl`로 기기와 같은 픽셀·같은 주기 |

보조:

| 주기 | 동작 |
|---|---|
| 2초 | 소리 창: play 유지. LCD 창: 음소거·tiny 유지·탭 재부착 |
| 1초 | 소리 창 메타/광고. LCD가 1.5초 이상 벌어지면 LCD만 seek |
| 200ms | LCD 창 프레임 + 미리보기 |

전송 지연: 장 기준 보통 **0.2–0.4초**. 소리 대비 LCD 창은 **최대 1.5초**까지 맞추지 않는다.

## 유지하는 결정

| 결정 | 이유 |
|---|---|
| 공식 watch, embed 금지 | Electron에서 embed 152-4 거절 사례. 로그인·Premium·광고는 YouTube가 처리 |
| 직접 다운로드/ffmpeg 사본 없음 | 인증 필수 조건과 충돌 |
| 기기에 영상 파일 없음 | 펌웨어는 RGB565만. `0x25` RAM |
| Mix/재생목록 ID 거부 | `parseYouTubeVideoId` |
| 화질 바닥 `tiny`(144p) | 이 영상이 제공하는 최저. LCD는 240×135 |
| 최신 1장만 HID | 큐를 쌓으면 기기만 바빠짐 |

## 이미 반영한 수정

| 이전 문제 | 현재 |
|---|---|
| 2초마다 소리 창에 setQuality/volume=1 | 화질 API는 LCD 창만. 소리는 미세 오차(≥0.99) 무시 |
| 소리 나는 renderer에서 getImageData | LCD 음소거 창에서만 탭 |
| 미리보기 500ms라 컴퓨터가 더 끊김 | 기기와 같은 RGB565·200ms |
| 내부 화질/볼륨 로그 없음 | 전환 시 `youtube-audio` jsonl |

## 남은 한계

- 창 2개라 RAM·CPU가 늘어난다.
- 광고 타이밍은 창마다 다를 수 있다 (허용).
- `sandbox: false`는 두 watch 창 모두. 픽셀 탭 때문에 켠 값이다.
- `hwdecode=on`은 로그 라벨이다. VideoToolbox 직접 호출은 없다.
- 설치본 확인은 `./build.sh deploy host` 이후.

## 확인

| 보고 싶은 것 | 보는 곳 |
|---|---|
| 분리 기동 | 콘솔 `source=split-audio-lcd` |
| LCD 화질 | `lcd quality=tiny` |
| 탭 5Hz | `[youtube-lcd] videoFps≈5` |
| HID | `[lcd-fps] hidFps≈5` (플래그 켜면) |
| 미리보기=기기 | 같은 장, 같은 끊김 |

## 문서

| 산출 | 경로 |
|---|---|
| 단계 그림 | `docs/diagrams/youtube-pipeline.html` |
| 그림 입력 | `docs/diagrams/youtube-pipeline.process.json` |
| 기능 계획 | `docs/plan/youtube-p5/PLAN.md` |
| 이 문서 | `docs/plan/youtube-p5/STRUCTURE_REVIEW.md` |
