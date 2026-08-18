<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-18 | Updated: 2026-08-19 -->

# components

## Purpose

재생·일반 설정·키보드 설정 창을 구성하는 React 컴포넌트. 상태와 IPC는 `App.tsx`가 갖고, 여기는 표시와 콜백만 담당한다.

## Key Files

| File | Description |
|------|-------------|
| `player-view.tsx` | 확장/미니 재생 창. P1–P5, YouTube 베젤·시크 바·목록 추가/리스트 |
| `youtube-settings-section.tsx` | 설정 창 YouTube 목록 추가·이동·재생·삭제 |
| `youtube-account-section.tsx` | persist 세션 로그인/로그아웃 |
| `player-status.tsx` | USB/LCD/노브 상태 점과 트랙 메타, LCD 미리보기 |
| `quick-profile-switch.tsx` | P1–P5 단축 버튼 + 현재 슬롯 라벨 |
| `app-header.tsx` | 설정/키보드 창 헤더와 재생 창 아이콘 버튼 |
| `settings-view.tsx` | 일반 설정 조립. 장치 미준비면 편집 비활성 |
| `device-status-section.tsx` | 연결·프로토콜·모니터 오류, 재연결 |
| `display-settings-section.tsx` | 서비스 선호, 폴링 주기, 아트/진행률, 로그인 시 실행 |
| `knob-settings-section.tsx` | 미세 볼륨 on/off와 detent당 단계 |
| `settings-types.ts` | `ConfigPatch` 콜백 타입 |
| `keyboard-settings-view.tsx` | P1 고정 표시, P2–P5 키/앱 실행, 백업 CRUD, 액션 테스트 |

## Subdirectories

없음.

## For AI Agents

### Working In This Directory

- 새 설정 섹션은 `settings-view.tsx`에 섹션 컴포넌트로 붙인다. `App.tsx`를 비대하게 만들지 않는다.
- P1 슬롯을 편집 UI로 열지 않는다.
- 미니뷰는 말줄임이 플레이어 영역을 밀지 않게 CSS 폭을 유지한다.

### Testing Requirements

- `../App.test.tsx`와 `./build.sh dev-ui`
- 레이아웃 변경은 확장(680×320)과 미니(300×248) 둘 다 본다.

### Common Patterns

- props로 `StatusSnapshot` / `AppConfig`를 받고 이벤트는 `on*` 콜백.
- 라벨 문자열은 `keyboard-action-label.ts`.

## Dependencies

### Internal

- `../../../shared/types.ts`
- `../keyboard-action-label.ts`, `../App.tsx`

### External

- React 19

<!-- MANUAL: -->
