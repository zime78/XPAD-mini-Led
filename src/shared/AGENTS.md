<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-18 | Updated: 2026-08-18 -->

# shared

## Purpose

main / preload / renderer가 같이 import하는 공용 계약. 런타임 로직 없이 타입·상수·기본값만 둔다.

## Key Files

| File | Description |
|------|-------------|
| `types.ts` | `TrackInfo`, `AppConfig`, `StatusSnapshot`(`youtubeLcdDelayMs`는 HID 전송 간격), `DEFAULT_CONFIG`. 프로필 P1–P5, 하단 슬롯, 키보드 액션, 노브·키맵 백업 |

## Subdirectories

없음.

## For AI Agents

### Working In This Directory

- IPC나 설정 필드를 바꾸면 이 파일과 양쪽 소비자를 한 변경에서 맞춘다.
- P1 하단 3키는 미디어 키로 고정이다. 기본값을 편집 가능하게 바꾸지 않는다.
- `KEYBOARD_KEY_CODES`에 없는 키를 UI/코덱에 넣지 않는다. F19/F20는 노브 전용이라 이 목록에 없다.
- `pollIntervalMs` 기본 1500, 허용 750–10000. `fineVolumeStepsPerDetent` 1–5.

### Testing Requirements

- 단독 테스트 없음. `keyboard-settings.test.ts` 등이 정규화를 검증한다.

### Common Patterns

- `as const` 배열 + derived union 타입.
- 기본 키보드: P1 미디어, P2–P5 Q/W/E.

## Dependencies

### Internal

- 소비: `src/main/**`, `src/preload/index.ts`, `src/renderer/src/**`
- tsconfig: `tsconfig.node.json`과 `tsconfig.web.json` 둘 다 include

### External

없음.

<!-- MANUAL: -->
