# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-07-22
- Primary product surfaces: 소형 Electron 재생 창, 독립 Electron 설정 창, XPAD Mini LCD 미리보기
- Evidence reviewed: `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `README.md`, `docs/DEVELOPMENT_REPORT.md`, 사용자가 제공한 재생 패널 목표 영역과 현재 전체 창 스크린샷

## Brand

- Personality: 어두운 데스크톱 환경에 어울리는 절제된 장치 유틸리티, 음악 정보가 가장 먼저 읽히는 구성
- Trust signals: 재생 패널에는 USB/LCD/노브 상태를 녹색 점·빨간 × 아이콘으로 간결하게 표시하고, 상세 문구와 RAM 전용 안전 경계는 설정 화면에 유지
- Avoid: 기본 화면의 진단 정보 과밀, 영구 저장이나 펌웨어 변경으로 오인할 수 있는 표현, 장식 목적의 과도한 애니메이션

## Product goals

- Goals: 재생 창은 패널과 최소 바깥 여백만 보이도록 고정 크기로 유지하고, 재생 패널 내부의 설정 아이콘으로 독립 설정 창을 연다.
- Goals: 설정 항목을 독립 컴포넌트 단위로 분리해 새 설정 섹션과 상태 카드를 쉽게 추가할 수 있게 한다.
- Non-goals: LCD 렌더링, 음악 조회, HID 프로토콜, IPC 데이터 계약의 동작 변경
- Success signals: 앱을 열면 재생 카드 아래 빈 영역 없이 패널 전체가 보이고, 설정 버튼을 눌러도 재생 창은 유지되며 별도 설정 창에서 상세 상태와 모든 설정·저장 동작을 사용할 수 있다.

## Personas and jobs

- Primary personas: XPAD Mini를 상시 음악 디스플레이로 사용하는 macOS 사용자
- User jobs: 현재 곡과 LCD 출력을 한눈에 확인하고, 필요할 때만 장치·표시·노브 설정을 조정한다.
- Key contexts of use: 트레이에서 짧게 여는 데스크톱 유틸리티, 장치 연결 문제를 진단하는 설정 화면

## Information architecture

- Primary navigation: 재생 패널 우상단 설정 아이콘으로 독립 설정 창을 열고, 설정 창의 닫기 아이콘이나 macOS 창 닫기로 설정만 닫는다.
- Core routes/screens: `player` 역할의 소형 BrowserWindow와 `settings` 역할의 독립 BrowserWindow가 동일 renderer 엔트리를 역할별로 로드한다.
- Content hierarchy: 재생 화면은 소형 장치 상태/설정 동작 → LCD 미리보기 → 곡 정보, 설정 화면은 화면 제목/동작 → 상세 장치 상태 → 오류 → 표시 설정 → 노브 설정 → 안전 고지/저장 순서다.

## Design principles

- 집중: 기본 화면에는 장치 정상 여부만 아이콘으로 노출하고 진단 문구와 설정 항목은 노출하지 않는다.
- 점진적 공개: 진단과 변경 기능은 설정 화면에서만 제공하되 한 번의 클릭으로 접근한다.
- 확장 가능한 경계: 음악/HID 데이터 수명주기는 Electron main, 안전한 창 동작은 preload IPC, 역할별 화면 표현은 renderer 컴포넌트가 담당한다.
- Tradeoffs: renderer 번들은 하나를 유지하되 URL query로 창 역할을 구분하고, main이 두 창의 생성·재사용·상태 브로드캐스트를 소유한다.

## Visual language

- Color: 기존 다크 네이비 배경, 파란 상호작용 색, Spotify/Apple Music 서비스 색, 녹색/노랑/분홍 상태 색을 유지한다.
- Typography: macOS 시스템 폰트와 `Apple SD Gothic Neo`, 곡명 우선의 크기 계층을 유지한다.
- Spacing/layout rhythm: 8px 계열 간격과 카드 단위 여백을 유지하되 재생 창은 패널 바깥 6px 여백만 사용하고 설정 창은 기존 720px 중심 컨테이너를 유지한다.
- Shape/radius/elevation: LCD 하드웨어 셸의 큰 라운드, 정보 카드의 중간 라운드, 낮은 테두리 대비를 유지한다.
- Motion: 화면 전환 애니메이션은 필수로 두지 않는다.
- Imagery/iconography: 외부 아이콘 의존성 없이 선형 SVG 아이콘을 사용하고 아이콘 버튼에는 접근 가능한 이름을 제공한다.

## Components

- Existing components to reuse: LCD 미리보기 셸, 곡 정보, 상태 카드, 표시 설정 필드, 노브 설정 필드, 저장 바
- New/changed components: 역할별 renderer `App`, `AppHeader`, `PlayerView`, `PlayerStatus`, `SettingsView`, 설정 섹션 단위 컴포넌트, 재사용 가능한 `IconButton`, main의 player/settings 창 생성 함수
- Variants and states: 재생/일시정지/대기, Spotify/Apple Music/없음, 소형 장치 상태 연결/실패, 상세 장치 정상/대기/오류, 저장 변경 있음/없음
- Token/component ownership: 색·간격·라운드는 `styles.css`의 CSS custom property, 화면 구조와 상태 표현은 renderer 컴포넌트가 소유한다.

## Accessibility

- Target standard: 키보드로 모든 설정과 화면 전환을 사용할 수 있는 WCAG 2.1 AA 수준의 기본 관행
- Keyboard/focus behavior: 아이콘 버튼과 폼 컨트롤에 명확한 `:focus-visible` 링을 제공한다.
- Contrast/readability: 본문과 상태 텍스트는 기존 고대비 팔레트를 유지하고, 소형 상태는 색과 점/× 형태를 함께 사용한다.
- Screen-reader semantics: 곡 제목으로 이름을 얻는 재생 `region`, `aria-label`이 있는 아이콘 버튼, 장치별 접근 가능한 상태 이름, 상태 섹션 제목, 저장 결과의 `role="status"`를 사용한다.
- Reduced motion and sensory considerations: 필수 애니메이션을 추가하지 않는다.

## Responsive behavior

- Supported breakpoints/devices: 재생 창은 680×320 고정, 설정 창은 760×690(최소 680×620)이며 설정 CSS는 더 좁은 폭에서도 한 열로 축소한다.
- Layout adaptations: 재생 창은 패널 전체가 항상 보이는 고정 2열이고, 설정 창의 상태 카드는 좁은 폭에서 한 열로 배치한다.
- Touch/hover differences: 기본 대상은 포인터/키보드이며 hover와 focus를 모두 제공한다.

## Interaction states

- Loading: 초기 IPC 응답 전 `불러오는 중…`을 표시한다.
- Empty: 재생 곡이 없으면 공용 `EMPTY_TRACK` 문구와 LCD 준비 상태를 표시한다.
- Error: 음악 조회와 노브 오류는 설정 화면의 장치 상태 다음에 표시한다.
- Success: 저장 완료 메시지를 설정 저장 바에 표시한다.
- Disabled: 변경이 없으면 저장/되돌리기, 미세 볼륨이 꺼져 있으면 단계 선택을 비활성화한다.
- Offline/slow network, if applicable: 앨범아트 준비 전에도 곡 텍스트와 LCD 준비 상태를 유지한다.

## Content voice

- Tone: 짧고 구체적인 한국어 상태·설정 문구
- Terminology: `재생`, `설정`, `USB 장치`, `LCD 프로토콜`, `XPAD 노브`, `RAM` 용어를 일관되게 사용한다.
- Microcopy rules: 사용자 행동을 명령형으로 명확히 표시하고, 위험 경계는 기술적으로 정확하게 설명한다.

## Implementation constraints

- Framework/styling system: React 19, TypeScript, 단일 `styles.css`, Electron renderer
- Design-token constraints: 새 UI 프레임워크나 아이콘 패키지를 추가하지 않고 기존 색을 CSS custom property로 정리한다.
- Performance constraints: 창을 분리해도 음악/HID 폴링은 main에서 한 번만 실행하고 상태 스냅샷을 열린 두 창에 브로드캐스트한다.
- Compatibility constraints: macOS 전용 동작, 680×320 고정 재생 창, 기존 760×690/최소 680×620 설정 창을 유지한다.
- Test/screenshot expectations: 공개 renderer UI에서 창 역할별 화면, 별도 설정 창 요청, 설정 저장 동작을 검증하고, `./build.sh check`와 `./build.sh dev-ui`에서 두 창 크기·동시 표시를 확인한다.

## Open questions

- [ ] 향후 설정 항목이 현재 한 화면을 크게 초과하면 내부 탭 또는 사이드바를 도입할지 재검토 / 제품 소유자 / 설정 확장성
