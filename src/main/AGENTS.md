<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-18 | Updated: 2026-08-19 -->

# main

## Purpose

Electron main 프로세스. 트레이·창·IPC 오케스트레이션, `userData/config.json`, 키보드 설정/백업, 미세 볼륨 진단 로그를 담당한다. HID I/O는 `device/` worker, LCD 픽셀은 `display/`, 음악은 `music/`, 단축키 라우팅은 `input/`으로 나뉜다.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | single-instance lock, 트레이, player/settings/keyboard 창, IPC, 렌더 큐(시퀀스 번호로 stale 드롭), 종료 시 monitor 정지·worker shutdown(최대 4초) |
| `config.ts` | `userData/config.json` load/save. `DEFAULT_CONFIG` merge 후 클램프. 키맵 백업은 76자 base64만 인정 |
| `keyboard-settings.ts` | 프로필 정규화, 장치 스냅샷 병합(P1 고정, launch-app는 로컬 유지), 앱 경로 검증 |
| `keyboard-settings.test.ts` | 정규화·병합 단위 테스트 |
| `keyboard-backups.ts` | `userData/keyboard-backups.json`, 최대 10개, UUID 항목 |
| `keyboard-backups.test.ts` | 수량 한도·덮어쓰기·손상 파일 비파괴 |
| `diagnostic-log.ts` | `userData/logs/fine-volume.jsonl`, 노브 숫자 + `youtube-audio` 전환, 최대 1MiB |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `device/` | HID + Sayo 프로토콜 + worker (see `device/AGENTS.md`) |
| `display/` | 음악 프레임 + YouTube 소리/LCD 분리, HID×0.55, LCD 시계 맞춤 (see `display/AGENTS.md`) |
| `input/` | F19/F20 미세 볼륨, F16–F18 키 액션 (see `input/AGENTS.md`) |
| `music/` | osascript now-playing / playback (see `music/AGENTS.md`) |

`claude/`는 빈 잔재다. AGENTS.md를 두지 않았다.

## For AI Agents

### Working In This Directory

- IPC 채널을 추가하면 `src/preload/index.ts`와 `src/shared/types.ts`를 같은 변경에서 맞춘다.
- 장치 설정 변경은 `requireDeviceSettingsReady()` 뒤에만 한다.
- `XPAD_DISABLE_HID=1`이면 DeviceHost를 켜지 않는다.
- main 수정은 dev 핫 리로드가 없다. 프로세스를 재시작한다.
- 렌더는 `renderSequence`로 최신 요청만 장치에 보낸다.

### Testing Requirements

- `npm test` — 이 디렉터리와 하위 `*.test.ts`
- HID 변경은 설치 앱을 끈 뒤 실기기에서 검증한다.

### Common Patterns

- 창은 `?view=settings` / `?view=keyboard` 쿼리로 같은 renderer 번들을 재사용한다.
- 트레이 아이콘은 `assets/tray/{working,attention,idle}.png`.

## Dependencies

### Internal

- `../shared/types.ts`, `../preload/index.ts`(채널 계약)
- `electron.vite.config.ts` rollup entries: `index`, `device-worker`

### External

- `electron`, Node `fs`/`worker_threads`/`child_process`

<!-- MANUAL: -->
