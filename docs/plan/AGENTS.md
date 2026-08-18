<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-18 | Updated: 2026-08-18 -->

# plan

## Purpose

구현이 끝난 기능의 설계·시안·검증 기록. 새 작업 백로그가 아니라 결정과 범위를 남긴 폴더다.

## Key Files

없음.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `keyboard-settings/` | 키보드 설정·앱 실행·백업 계획 (see `keyboard-settings/AGENTS.md`) |
| `profile-quick-switch/` | 재생 화면 P1–P5 단축 전환 (see `profile-quick-switch/AGENTS.md`) |
| `youtube-p5/` | P5 YouTube 재생·구조 검토 (`PLAN.md`, `STRUCTURE_REVIEW.md`) |

## For AI Agents

### Working In This Directory

- 여기 문서는 구현 근거로 읽는다. 코드와 어긋나면 코드를 우선하고 문서를 고친다.
- 일반 키 HID 적용(PLAN 단계 0·5)은 안전 경계 승인 전까지 열지 않는다.

### Testing Requirements

- 계획서의 “완료” 항목은 해당 `*.test.ts`와 `docs/DEVELOPMENT_REPORT.md`로 교차 확인한다.

## Dependencies

### Internal

- `src/renderer/src/components/`, `src/main/keyboard-settings.ts`, `src/main/device/protocol.ts`

<!-- MANUAL: -->
