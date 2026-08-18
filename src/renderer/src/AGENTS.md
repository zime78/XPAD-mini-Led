<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-18 | Updated: 2026-08-18 -->

# src

## Purpose

React UI. `?view=`가 없으면 재생 창, `settings`면 일반 설정, `keyboard`면 키보드 설정이다.

## Key Files

| File | Description |
|------|-------------|
| `main.tsx` | `createRoot` + `StrictMode` + `styles.css` |
| `App.tsx` | 뷰 분기, `window.xpad` 구독, 프로필 전환·재생 액션·설정 저장 |
| `App.test.tsx` | 뷰 라우팅·주요 상호작용 |
| `keyboard-action-label.ts` | 키/앱 실행 라벨(전체·compact) |
| `youtube-playback-label.ts` | YouTube 제목·진행률·베젤 전송 간격(`NNms`) |
| `styles.css` | 재생·설정·키보드 창 스타일. 확장 680×320 / 미니 300×248에 맞춤 |
| `env.d.ts` | `window.xpad: XpadApi` |
| `assets.d.ts` | 정적 에셋 모듈 선언 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `components/` | 화면 단위 컴포넌트 (see `components/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- 전역 상태 라이브러리를 추가하지 않는다. `App`이 `window.xpad` 상태를 내려준다.
- 창 크기는 `src/main/index.ts` `PLAYER_WINDOW_SIZES`와 CSS를 같이 맞춘다.
- 스타일 변경은 desktop 창 두 크기(확장/미니)와 설정·키보드 창을 확인한다.

### Testing Requirements

- `npm test` — `App.test.tsx`
- `./build.sh dev-ui`로 세 뷰를 직접 연다.

### Common Patterns

- 로딩: `<main className="loading-screen">불러오는 중…</main>`
- 한글 UI 카피 유지.

## Dependencies

### Internal

- `../../../shared/types.ts` (경로는 파일마다 상대 깊이가 다름 — `App.tsx`는 `../../shared/types`)
- `../../preload/index.ts` 타입 (`XpadApi`)

### External

- React 19, Testing Library

<!-- MANUAL: -->
