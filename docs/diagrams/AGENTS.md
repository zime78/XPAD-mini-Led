<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-18 | Updated: 2026-08-19 -->

# diagrams

## Purpose

런타임 아키텍처와 키 매핑 다이어그램의 HTML/JSON 원본. PNG/SVG 내보내기는 `docs/images/diagrams/`에 있다.

## Key Files

| File | Description |
|------|-------------|
| `runtime-architecture.html` | 프로세스·워커·HID 데이터 흐름 다이어그램 |
| `runtime-architecture.architecture.json` | 위 HTML의 구조 데이터 |
| `key-mapping.html` | 노브·하단 키·F16–F20 매핑 다이어그램 |
| `key-mapping.workflow.json` | 위 HTML의 워크플로 데이터 |
| `youtube-pipeline.html` | 소리/LCD 분리 → HID×0.55 캡처 → 시계 맞춤·watch 재로드 → 최신 1장 HID |
| `youtube-pipeline.process.json` | 위 그림의 process 입력 |
| `youtube-pipeline.svg` / `youtube-pipeline.png` | HTML SVG 보내기. README용 복본은 `docs/images/diagrams/` |

## Subdirectories

없음.

## For AI Agents

### Working In This Directory

- 프로토콜/키 매핑이 바뀌면 HTML/JSON과 `docs/images/diagrams/` export를 같이 갱신한다.
- 이 파일들은 diagram-design 산출물이다. 바이트 프로토콜의 정본은 `docs/PROTOCOL.md`다.

### Testing Requirements

- HTML을 브라우저로 열어 링크·레이블이 코드와 맞는지 확인한다.

## Dependencies

### Internal

- `docs/PROTOCOL.md`, `src/main/device/protocol.ts`, `src/main/input/`

<!-- MANUAL: -->
