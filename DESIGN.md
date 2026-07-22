# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-07-22
- Primary product surfaces: 소형 Electron 재생 창, 독립 Electron 일반 설정 창, 독립 키보드 설정 창, XPAD Mini LCD 미리보기
- Evidence reviewed: `src/renderer/src/App.tsx`, `src/renderer/src/components/app-header.tsx`, `src/renderer/src/components/player-view.tsx`, `src/renderer/src/components/player-status.tsx`, `src/renderer/src/components/keyboard-settings-view.tsx`, `src/renderer/src/components/settings-view.tsx`, `src/renderer/src/styles.css`, `src/main/index.ts`, `src/main/input/fine-volume.ts`, `src/main/display/frame-renderer.ts`, `src/main/device/protocol.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `docs/PROTOCOL.md`, `docs/XPAD_MINI_DIRECT_API.md`, 사용자가 제공한 설정 아이콘 및 XPAD 키보드 배치 이미지·재생 화면 캡처·볼륨 피드백이 없는 LCD 미리보기, `https://bbb.pulsar.gg/sKey/`의 장치 연결 전 화면

## Brand

- Personality: 어두운 데스크톱 환경에 어울리는 절제된 장치 유틸리티, 음악 정보가 가장 먼저 읽히는 구성
- Trust signals: 재생 패널에는 기존 USB/LCD/노브 상태를 녹색 점·빨간 × 아이콘으로 간결하게 표시하고, 키 설정 화면에는 `수정 대상: 하단 버튼 3개만`, 연결 상태, RAM 전용/종료 시 원복 상태를 항상 표시한다.
- Avoid: 기본 화면의 진단 정보 과밀, 영구 저장이나 펌웨어 변경으로 오인할 수 있는 표현, 장식 목적의 과도한 애니메이션

## Product goals

- Goals: 재생 창은 패널과 최소 바깥 여백만 보이도록 고정 크기로 유지하고, 재생 패널 내부의 설정 아이콘으로 독립 설정 창을 연다.
- Goals: 설정 항목을 독립 컴포넌트 단위로 분리해 새 설정 섹션과 상태 카드를 쉽게 추가할 수 있게 한다.
- Goals: 설정 아이콘 왼쪽의 키보드 아이콘으로 전용 창을 열고, Profile 1은 이전 곡·재생/일시정지·다음 곡으로 고정하며 Profile 2~5의 하단 3개 키를 지원 키 또는 macOS 앱 실행에 연결한다.
- Goals: 사용자가 이름과 설명을 입력해 Profile 2~5 설정을 최대 10개까지 백업하고, 저장 당시 설정을 편집 화면에 정확히 복원한다. Profile 1은 백업 데이터와 무관하게 고정값을 유지한다.
- Goals: XPAD 노브로 볼륨을 조절하면 실제 적용된 출력값을 LCD와 앱 미리보기에 즉시 표시하고 마지막 입력 1.6초 후 곡 화면으로 복귀한다.
- Goals: 재생 화면 상단에서 P1~P5를 빠르게 전환하고, 선택한 프로파일의 하단 버튼 3개 동작을 설정 창을 열지 않고 확인한다.
- Non-goals: 기존 미세 볼륨 단계 계산과 노브 HID 매핑 변경, 노브 클릭, 상단 `PF1`, 화면·원형 컨트롤, 장치 플래시/Save/펌웨어 변경, 매크로·스크립트 실행, Windows/Linux 지원
- Success signals: 현재 안전 범위에서는 사용자가 프로파일과 키를 선택해 동작을 지정하고, 최대 10개 로컬 백업을 관리하며, 복원 내용을 검토한 뒤 로컬 설정을 저장할 수 있다. XPAD 노브 조절 직후에는 LCD에서 실제 출력값을 식별할 수 있다. 실제 장치 키맵 적용·원복은 프로토콜 안전 게이트 통과 전까지 제공하지 않는다.

## Personas and jobs

- Primary personas: XPAD Mini를 상시 음악 디스플레이로 사용하는 macOS 사용자
- User jobs: 현재 곡과 LCD 출력을 한눈에 확인하고, 필요할 때만 장치·표시·노브 설정을 조정하며, Profile 1의 고정 음악 제어를 유지한 채 Profile 2~5에 일반/탐색/기능/미디어 키·자주 쓰는 앱 실행 구성을 만들고 이름 있는 백업으로 재사용한다.
- Key contexts of use: 트레이에서 짧게 여는 데스크톱 유틸리티, 장치 연결 문제를 진단하는 설정 화면

## Information architecture

- Primary navigation: 재생 패널 우상단에서 키보드 아이콘, 설정 아이콘 순으로 독립 창을 열고 각 창의 닫기 아이콘이나 macOS 창 닫기로 해당 창만 닫는다.
- Core routes/screens: `player`, `settings`, `keyboard` 역할의 독립 BrowserWindow가 동일 renderer 엔트리를 역할별로 로드한다.
- Content hierarchy: 재생 화면은 소형 장치 상태 → P1~P5 단축 전환과 선택 프로파일의 하단 버튼 3개 요약 → 키보드/일반 설정 진입 → LCD 미리보기 → 곡 정보 순서다. 키보드 화면은 연결/안전 상태 → P1~P5 탭 → 장치 키 선택 → 동작 설정 → 사용자 백업 관리 → 적용/원복 순서다.

## Design principles

- 집중: 기본 화면에는 장치 정상 여부만 아이콘으로 노출하고 진단 문구와 설정 항목은 노출하지 않는다.
- 점진적 공개: 진단과 변경 기능은 설정 화면에서만 제공하되 한 번의 클릭으로 접근한다.
- 직접 조작: 사용자가 지정한 하단 물리 버튼 3개만 큰 클릭 영역으로 표시하고, 선택한 버튼의 설정만 오른쪽 패널에 노출한다.
- 안전한 기본값: 노브·PF1·화면·원형 컨트롤은 키 설정 화면의 편집 컨트롤과 포커스 순서에서 완전히 제외한다.
- 비간섭: 기존 볼륨 기능의 노브 엔트리 14/15, F19/F20, `fineVolume*` 설정·상태·로그·안전 백업은 읽거나 변경하지 않는다.
- 즉각 피드백: 볼륨 조절 성공 후 실제 readback 값을 큰 숫자와 막대로 표시하고, 연속 입력은 최신 값으로 교체하며 표시 시간을 마지막 입력부터 다시 센다.
- 빠른 전환: 상태 아이콘과 P1~P5 단축 버튼 사이에 명확한 간격·구분을 두고, 실제 readback 성공 후에만 사용 중 프로파일 강조와 세 버튼 요약을 갱신한다.
- 명시적 복원: 사용자 백업 복원은 편집 초안만 바꾸며 별도의 `장치에 적용` 전에는 HID 쓰기를 하지 않는다.
- 백업 분리: 이름·설명을 갖는 사용자 설정 백업과 장치 원복용 원본 KeyInfo 안전 백업을 문구·저장소·UI에서 구분한다.
- 확장 가능한 경계: 음악/HID 데이터 수명주기는 Electron main, 안전한 창 동작은 preload IPC, 역할별 화면 표현은 renderer 컴포넌트가 담당한다.
- Tradeoffs: renderer 번들은 하나를 유지하되 URL query로 창 역할을 구분하고, main이 세 창의 생성·재사용·상태 브로드캐스트를 소유한다.

## Visual language

- Color: 기존 다크 네이비 배경, 파란 상호작용 색, Spotify/Apple Music 서비스 색, 녹색/노랑/분홍 상태 색을 유지한다.
- Typography: macOS 시스템 폰트와 `Apple SD Gothic Neo`, 곡명 우선의 크기 계층을 유지한다.
- Spacing/layout rhythm: 8px 계열 간격과 카드 단위 여백을 유지하되 재생 창은 패널 바깥 6px 여백만 사용하고 일반 설정은 기존 720px 중심 컨테이너, 키보드 설정은 장치 그림·동작 편집의 2열과 필요할 때 열리는 백업 관리 패널을 사용한다.
- Shape/radius/elevation: LCD 하드웨어 셸의 큰 라운드, 정보 카드의 중간 라운드, 낮은 테두리 대비를 유지한다.
- Motion: 화면 전환 애니메이션은 필수로 두지 않는다.
- Imagery/iconography: 외부 아이콘 의존성 없이 선형 SVG 아이콘을 사용하고 아이콘 버튼에는 접근 가능한 이름을 제공한다.

## Components

- Existing components to reuse: LCD 미리보기 셸, 곡 정보, 상태 카드, 표시 설정 필드, 노브 설정 필드, 저장 바
- New/changed components: `KeyboardSettingsButton`, `KeyboardSettingsView`, `ProfileSelector`, `QuickProfileSwitch`, 하단 3버튼 전용 `DeviceKeyMap`, `KeyActionEditor`, `ApplicationPicker`, `BackupManager`, `BackupEditor`, `RestorePreview`, main의 keyboard 창 생성 함수, LCD `VolumeFeedback` OSD
- Variants and states: P1 보기 전용 고정/P2~P5 편집 선택/별도 F16~F18 사용 프로필, 재생 화면 프로파일 정상/전환 중/readback 실패/장치 미연결, 선택 프로파일의 일반 키/미디어 키/앱 실행/미지원 요약, 키 선택/미선택, 키 변경/앱 실행, 미지원 한 줄 표시, 앱 미선택/선택/경로 오류, 백업 0~9개/10개 가득 참, 복원 초안/덮어쓰기/삭제 확인, 적용 전/적용 중/적용됨/롤백됨, 장치 미연결/LCD 프로토콜 미준비 시 전체 설정 잠금, 안전 검증 실패, 볼륨 0% 음소거 표시/1~99%/100% 경계 표시
- Token/component ownership: 색·간격·라운드는 `styles.css`의 CSS custom property, 화면 구조와 상태 표현은 renderer 컴포넌트가 소유한다.

## Accessibility

- Target standard: 키보드로 모든 설정과 화면 전환을 사용할 수 있는 WCAG 2.1 AA 수준의 기본 관행
- Keyboard/focus behavior: 아이콘 버튼과 폼 컨트롤에 명확한 `:focus-visible` 링을 제공하고, 재생 화면 P1~P5 단축 버튼은 Tab/Enter/Space, 프로파일 탭은 표준 tablist 키 동작으로 조작한다. 장치 그림의 키 영역도 실제 `button` 요소로 구현한다. 백업 패널을 닫으면 `백업 관리` 버튼으로 포커스를 되돌린다.
- Contrast/readability: 본문과 상태 텍스트는 기존 고대비 팔레트를 유지하고, 소형 상태는 색과 점/× 형태를 함께 사용한다.
- Screen-reader semantics: 곡 제목으로 이름을 얻는 재생 `region`, `aria-label`이 있는 아이콘 버튼, 각 물리 키의 현재 동작을 포함한 접근 가능한 이름, 오류 `role="alert"`, 적용 결과 `role="status"`를 사용한다.
- Reduced motion and sensory considerations: 필수 애니메이션을 추가하지 않는다.

## Responsive behavior

- Supported breakpoints/devices: 재생 창은 680×320 고정, 일반 설정 창은 760×690(최소 680×620), 키보드 설정 창은 권장 1,080×760(최소 900×680)이다.
- Layout adaptations: 키보드 설정은 넓은 창에서 장치 그림/편집 패널 2열과 백업 패널을 사용한다. 좁은 폭에서는 백업 패널과 장치 그림·편집 패널을 순서대로 한 열에 배치한다.
- Touch/hover differences: 기본 대상은 포인터/키보드이며 hover와 focus를 모두 제공한다.

## Interaction states

- Loading: 초기 IPC 응답 전 `불러오는 중…`을 표시한다.
- Empty: 재생 곡이 없으면 공용 `EMPTY_TRACK` 문구와 LCD 준비 상태를 표시한다.
- Error: 음악 조회와 노브 오류는 설정 화면의 장치 상태 다음에 표시한다.
- Success: 저장 완료 메시지를 설정 저장 바에 표시한다.
- Profile switch: 전환 중에는 P1~P5를 잠시 비활성화하고 readback 성공 후 선택 강조·등록 키 요약을 함께 바꾼다. 실패하면 이전 표시를 유지하고 접근 가능한 오류 상태를 제공한다.
- Volume feedback: 조절 완료 시 기존 곡 화면 위에 고대비 OSD로 실제 출력값과 막대를 표시한다. 0%와 100%에서도 피드백을 표시하고 마지막 성공 입력 1.6초 후 자동으로 곡 화면을 복원한다.
- Disabled: 변경이 없으면 저장/되돌리기, 미세 볼륨이 꺼져 있으면 단계 선택을 비활성화한다.
- Applying: 현재는 로컬 설정 저장 중 중복 동작을 막는다. 장치 키맵 적용 상태는 안전 게이트 통과 후 추가한다.
- Rollback: F16~F18 등록에 실패하면 이 기능이 소유한 세 단축키를 모두 해제하고 오류를 표시한다. 장치 키맵 롤백은 아직 실행 경로가 없다.
- Backup capacity: 10개에 도달하면 새 백업을 비활성화하고 삭제 또는 선택 백업 덮어쓰기를 안내한다.
- Restored draft: 사용자 백업 복원 후 저장본과 다른 프로파일을 `변경됨`으로 표시하고 로컬 미저장 상태를 알린다.
- Missing app: 복원된 앱 경로가 없으면 값을 보존하되 `앱을 찾을 수 없음`과 재선택 동작을 해당 슬롯에 표시한다.
- Offline/slow network, if applicable: 앨범아트 준비 전에도 곡 텍스트와 LCD 준비 상태를 유지한다.

## Content voice

- Tone: 짧고 구체적인 한국어 상태·설정 문구
- Terminology: `재생`, `설정`, `키보드 설정`, `프로파일`, `사용자 백업`, `안전 백업`, `편집 화면에 복원`, `USB 장치`, `LCD 프로토콜`, `XPAD 노브`, `앱 실행`, `RAM`, `원래 키로 복원` 용어를 일관되게 사용한다.
- Microcopy rules: 사용자 행동을 명령형으로 명확히 표시하고, 위험 경계는 기술적으로 정확하게 설명한다.

## Implementation constraints

- Framework/styling system: React 19, TypeScript, 단일 `styles.css`, Electron renderer
- Design-token constraints: 새 UI 프레임워크나 아이콘 패키지를 추가하지 않고 기존 색을 CSS custom property로 정리한다.
- Performance constraints: 창을 분리해도 음악/HID 폴링은 main에서 한 번만 실행하고 상태 스냅샷을 열린 모든 창에 브로드캐스트한다.
- Compatibility constraints: macOS 전용 동작이다. Profile 1은 고정값을 사용하고 Profile 2~5 실제 하단 키만 SystemInfo의 `cfg_selection` RAM 전환과 최종 원복 readback으로 읽는다. 일반 키 HID 쓰기는 `docs/plan/keyboard-settings/PLAN.md`의 전체 rollback 안전 게이트를 통과한 범위만 허용한다.
- Connection constraints: 키보드와 일반 설정 창은 열어 연결 상태와 차단 사유를 확인할 수 있지만, USB 연결과 LCD 프로토콜 준비가 모두 완료되기 전에는 설정·저장·백업·복원·테스트를 허용하지 않는다. renderer 비활성화와 main IPC 검사를 함께 적용한다.
- Existing-feature constraints: 볼륨 피드백은 기존 조절 결과를 읽어 표시만 하며 노브 엔트리 14/15, F19/F20, `fineVolumeEnabled`, `fineVolumeStepsPerDetent`, `knobKeymapBackup`, 조절 알고리즘·노브 상태·진단 로그를 수정하거나 초기화하지 않는다.
- Security constraints: 앱 선택은 native open dialog로 받은 기존 `.app` 절대경로만 허용하고 셸 명령·인자·URL을 저장하거나 실행하지 않는다.
- Test/screenshot expectations: 역할별 화면/창 요청/P1 고정/P2~P5 하단 3버튼 편집/미지원 코드 비노출/백업 최대 10개/정확 복원/F16~F18 전용 등록과 기존 미세 볼륨 비간섭, 볼륨 이벤트의 실제 readback 전달, OSD 값·막대·경계 클램프를 자동 검증하고, `./build.sh check`, `./build.sh dev-ui`, 승인된 HID 실기기 절차를 분리해 기록한다.
- Profile-switch constraints: 재생 화면 단축 전환은 `cfg_selection` RAM 변경과 SystemInfo readback 검증만 사용하고 `Save(0x0D)`를 호출하지 않는다. 표시하는 세 키는 현재 저장된 프로파일 설정과 일치해야 한다.

## Open questions

- [x] Profile 1~5 선택·주소 지정과 각 하단 키 엔트리 읽기 확인 / `0x02` RAM 전환·`0x10` 읽기·원복 구현
- [ ] 일반 키 쓰기 전체 rollback과 실패 경로 실기기 확인 / 장치 적용 구현 차단
- [ ] 확인된 5개 프로파일 일반 키의 RAM 임시 쓰기를 새 안전 경계로 승인할지 결정 / 제품 소유자 / 장치 적용 구현 차단
- [ ] 앱 종료 후에도 설정을 유지하는 공식 영구 저장은 계속 제외할지 결정 / 제품 소유자 / 현재 권고는 제외 유지
- [ ] 1차 범위 이후 임의 키 조합을 지원할지 재검토 / 제품 소유자 / 후속 범위
- [x] `profile-quick-switch-gui.svg`의 2단 배치, 독립 버튼 3개와 선택값 강조 방식 승인 및 구현
