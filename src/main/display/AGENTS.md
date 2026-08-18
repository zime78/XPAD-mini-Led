<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-18 | Updated: 2026-08-19 -->

# display

## Purpose

트랙 정보와 볼륨 OSD를 240×135 RGB565-LE 프레임과 설정 UI 미리보기 PNG data URL로 만든다.

## Key Files

| File | Description |
|------|-------------|
| `frame-renderer.ts` | offscreen `BrowserWindow`에 캔버스 스크립트를 올려 `capturePage` → PNG → RGB565. 액센트 `#1ed760`(Spotify) / `#fa2d48`(Apple Music) |
| `frame-pipeline.ts` | PNG → RGB565, ordered dither |
| `frame-pipeline.test.ts` | 인코딩·디더 단위 테스트 |
| `text-layout.ts` | 폭 측정 콜백으로 폰트 크기·줄 수·말줄임 맞춤 |
| `text-layout.test.ts` | 고정폭 측정기로 레이아웃 검증 |
| `volume-overlay.ts` | `VolumeFeedback` 정규화. LCD/미리보기 OSD |
| `volume-overlay.test.ts` | 볼륨 클램프 |
| `youtube-lcd.ts` | 소리 창 + LCD 창. LCD만 `getImageData`. 캡처 HID×0.55. Chromium mute. loudness 핀. 곡 전환은 watch 재로드. LCD 시계=소리+HID 리드(400ms/60ms) |
| `youtube-lcd.test.ts` | video ID, prepare 역할, 볼륨 핀, 시계 목표, RGB565 미리보기 |
| `youtube-library.ts` | 로컬 재생 목록·현재 인덱스 |
| `youtube-oembed.ts` | 목록 추가 시 제목·채널 조회 |

## Subdirectories

없음.

## For AI Agents

### Working In This Directory

- 해상도는 `protocol.ts`의 `LCD_WIDTH`/`LCD_HEIGHT`(240×135)만 쓴다.
- 한글은 Apple SD Gothic Neo. 웹 폰트를 원격 로드하지 않는다.
- 미리보기 data URL은 main이 `StatusSnapshot.previewDataUrl`로 푸시한다. YouTube는 기기와 같은 RGB565에서 복원한다.
- YouTube 소리 창에서는 `getImageData`를 호출하지 않는다. 화질 고정·픽셀 탭은 LCD 창만.
- LCD 음소거는 `setAudioMuted`와 요소 mute. `player.mute`/`setVolume` 금지.
- 곡 전환은 `loadVideoById`가 아니라 양쪽 `watch?v=` 재로드.
- `StatusSnapshot.youtubeLcdDelayMs`는 끝-끝 딜레이가 아니라 직전 `0x25` 전송 간격이다.

### Testing Requirements

- `npm test`의 display 테스트
- 픽셀 확인은 `./build.sh dev-ui` 미리보기 또는 실기기 LCD

### Common Patterns

- 렌더 요청은 `src/main/index.ts` 시퀀스 큐가 직렬화한다. 여기서 장치를 직접 쓰지 않는다.

## Dependencies

### Internal

- `../device/protocol.ts` (`LCD_WIDTH`/`LCD_HEIGHT`)
- `../../shared/types.ts` (`TrackInfo`, `AppConfig`)

### External

- `electron` `BrowserWindow.capturePage`, `pngjs`

<!-- MANUAL: -->
