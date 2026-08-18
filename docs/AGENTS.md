<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-18 | Updated: 2026-08-18 -->

# docs

## Purpose

XPAD Mini HID 프로토콜과 앱 구현의 권위 문서. 저수준 패킷 레퍼런스, 전체 명령·위험도 지도, 개발/검증 보고서, 기능 계획과 다이어그램을 둔다.

## Key Files

| File | Description |
|------|-------------|
| `README.md` | 문서 목록과 검증 표기(실기기 확인 / Bibimbap / 상위 구현) |
| `PROTOCOL.md` | 실기기 검증된 Sayo API v2 바이트 레퍼런스. 프로토콜 지식의 정본 |
| `XPAD_MINI_DIRECT_API.md` | 전체 명령·위험도 지도. 앱이 쓰지 않는 Save/LED/부트로더 포함 |
| `DEVELOPMENT_REPORT.md` | 구현·검증·빌드/배포 종합 보고서(한국어) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `diagrams/` | 런타임 아키텍처·키 매핑 HTML/JSON 원본 (see `diagrams/AGENTS.md`) |
| `images/` | 스크린샷·샘플 아트·다이어그램 내보내기 (see `images/AGENTS.md`) |
| `plan/` | 키보드 설정·프로필 단축·YouTube P5 구조 (see `plan/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- 저수준 명령·패킷·허용 범위를 바꾸면 `PROTOCOL.md`를 같은 변경에서 갱신한다.
- 앱이 실제로 쓰는 명령은 `0x02` ScreenInfo/SystemInfo, `0x10` KeyInfo, `0x25` Display뿐이다.
- `docs/images/settings-window.png`는 제3자 앨범아트가 들어 있어 gitignore다. 커밋하지 않는다.

### Testing Requirements

- 문서 변경은 코드와 모순이 없는지 `src/main/device/protocol.ts`와 대조한다.
- 장치 동작 변경 PR에는 Mac 아키텍처·펌웨어·검증 절차를 적는다.

### Common Patterns

- 검증 표기는 `README.md`의 다섯 단계만 쓴다. 확인하지 않은 바이트를 단정하지 않는다.

## Dependencies

### Internal

- 구현: `src/main/device/protocol.ts`, `hid.ts`
- 조사 도구: `tools/probe-*.js`, `tools/hid-enum.js`

### External

- SayoDeviceStreamingAssistant `SayoHid.cs`, Bibimbap Web DRV (`bbb.pulsar.gg/sKey/`)

<!-- MANUAL: -->
