# Repository Guidelines

Pulsar Lab XPAD Mini(VID `0x3710`, PID `0x2507`)의 240×135 LCD에 macOS의 Spotify / Apple Music 현재 재생 곡(곡명·아티스트·앨범·앨범아트·진행률)을 표시하는 Electron 트레이 앱. 패키지명 `xpad-mini-now-playing`, 제품명 "XPAD Mini Now Playing". 이전 세대인 Claude Code 상태 표시 앱(MIT, `SpinnerMaster/xpad-mini-claude-code`)의 HID 프로토콜 구현을 물려받아 음악 표시 전용으로 피벗한 프로젝트다.

## 프로젝트 구조와 모듈 구성

`src/main/`은 앱 수명 주기, 음악 조회, LCD 렌더링, HID 통신을 담당하고, `src/preload/`는 안전한 IPC 브리지를 제공한다. React 설정 UI는 `src/renderer/`에 있으며 공용 타입은 `src/shared/`에 둔다. 이미지와 트레이 아이콘은 `assets/`, 프로토콜 및 개발 기록은 `docs/`, 장치 조사·에셋 생성 스크립트는 `tools/`에 있다. 생성물인 `out/`, `dist/`, `node_modules/`는 수정하거나 커밋하지 말 것.

## 빌드, 검증, 개발 명령

`build.sh`가 표준 진입점이다 (npm scripts를 감싸며 의존성 확인·HID 충돌 가드·서명·검증을 포함):

```sh
./build.sh deps        # npm ci
./build.sh dev         # HID 사용 개발 실행 (설치 앱이 실행 중이면 거부)
./build.sh dev-ui      # XPAD_DISABLE_HID=1 — 장치 없이 UI/음악 조회만
./build.sh debug       # HID 없이 main(9229)/renderer(9222) 디버그 포트 실행
./build.sh debug-hid   # 실기기 HID + 디버그 포트 (설치 앱 먼저 stop)
./build.sh check       # npm run typecheck + npm run build — 기본 검증
./build.sh package all # Developer ID 서명 DMG(arm64+x64) 생성·검증
./build.sh deploy host # package 후 /Applications 설치·실행
./build.sh stop        # 설치 앱 정상 종료 (HID 해제)
./build.sh status      # 설치·실행·서명 상태 확인
```

npm 직접 실행: `npm run dev` / `build` / `typecheck` / `dist`. 전체 명령은 `./build.sh help`.

- **`npm run dev`는 renderer만 핫 리로드된다** — `src/main/`(device worker 포함) 수정은 dev 프로세스를 죽이고 재시작해야 한다. 아니면 stale 코드를 테스트하게 된다.
- **HID는 한 프로세스만 사용해야 한다**: 설치된 앱(`/Applications/XPAD Mini Now Playing.app`)이나 Bibimbap Web DRV가 장치를 잡고 있으면 dev/debug-hid를 실행하지 말 것. `./build.sh stop`으로 먼저 내린다. `XPAD_DISABLE_HID=1`이면 device 계층 전체가 비활성화된다.
- 패키징은 Keychain의 `Developer ID Application` 인증서를 자동 선택하며, 인증서가 여러 개면 `CSC_NAME`으로 지정한다. 인증서 이름이나 개인키를 저장소에 기록하지 않는다.
- `.github/workflows/build.yml`은 macOS에서 `npm ci`, 타입 검사, 프로덕션 빌드와 런타임 의존성 감사를 수행한다. 패키징·서명은 로컬 `build.sh`를 사용한다.

## 아키텍처

electron-vite 3분할(`src/main`, `src/preload`, `src/renderer`) + Node worker thread. `src/shared/types.ts`가 전 프로세스 공용 계약: `TrackInfo`, `AppConfig`, `StatusSnapshot`, `DEFAULT_CONFIG`.

데이터 흐름, 끝에서 끝까지:

1. **음악 폴링.** `music/now-playing.ts`의 `NowPlayingMonitor`가 `pollIntervalMs`(기본 1500ms, 750–10000 클램프) 주기로 osascript AppleScript를 통해 Spotify·Music 앱을 병렬 조회한다(pgrep로 해당 앱이 실행 중일 때만). 트랙 선택 우선순위: 명시 선호 서비스가 재생 중 > 재생 중 트랙(직전 활성 서비스 우대) > 일시정지 트랙. 앨범아트는 Spotify는 artwork URL fetch, Apple Music은 AppleScript `raw data`를 temp 파일로 내보내 읽고, data URL로 최대 12개 캐시한다. 변경 시 `change` 이벤트 발생.
2. **프레임 렌더링.** `display/frame-renderer.ts`가 트랙 정보를 SVG로 구성해 숨김 offscreen `BrowserWindow`에 로드 → `capturePage` → PNG → RGB565-LE `Buffer`(240×135×2)로 변환한다. 설정 UI 미리보기용 PNG data URL도 함께 반환. 폰트는 Apple SD Gothic Neo(한글 지원), 서비스별 액센트 색(#1ed760 / #fa2d48).
3. **오케스트레이션.** `main/index.ts`: single-instance lock, 트레이, 재생/설정/키보드 창, IPC(`get-status`/`get-config`/`set-config`/`refresh-now-playing`/`switch-keyboard-profile`, push `status-changed` — preload가 `window.xpad`로 노출). 실제 장치 프로필 readback을 설정과 `KeyActionRouter`의 F16~F18 대상 프로필에 동기화한다. 렌더 큐는 시퀀스 번호로 최신 요청만 장치에 반영한다(stale 렌더 드롭). `diagnostic-log.ts`는 노브 단축키 수신과 볼륨 적용 전후 숫자만 `userData/logs/fine-volume.jsonl`에 최대 1MiB로 기록한다. 종료 시 monitor 정지 후 노브 원본 복원을 포함한 worker shutdown을 최대 4초 기다리고 로그 쓰기를 flush한다.
4. **디바이스 워커.** `device/device-host.ts`는 얇은 main-thread 프록시이고, 실제 HID I/O는 worker thread(`device/device-worker.ts`, `electron.vite.config.ts`의 두 번째 rollup entry)가 수행한다. ready 상태에서는 현재 프레임을 220ms마다 재전송해 펌웨어 자체 UI가 되살아나지 않게 유지하며, KeyInfo 읽기/쓰기 중에는 LCD 전송을 잠시 멈춘다.
5. **HID 계층.** `device/hid.ts`는 vendor bulk 컬렉션(usage page `0xFF12`, usage `0x02`)만 연다. 복합 키보드 장치라 macOS Input Monitoring 허용을 위해 `nonExclusive: true`가 필수. 3초 주기로 재연결 폴링.
6. **프로토콜.** `device/protocol.ts`는 최소 Sayo API v2 클라이언트: 연결 시 `0x02 ScreenInfo/SystemInfo`로 240×135와 활성 프로필을 확인한 뒤 ready, 같은 `0x02`의 `cfg_selection`만 바꿔 P1~P5를 RAM에서 선택하고 readback 검증한다. `0x25 Display`는 RGB565 청크 스트리밍에 사용한다 — 직전 프레임과 diff해 변경된 청크만 보내고, 300프레임마다 전체 프레임 강제, 250ms 이상 무전송이면 keep-alive 청크 전송. `0x10 KeyInfo`는 Profile 1 노브 좌/우 엔트리(15/14)를 F20/F19로 임시 변경하는 데만 사용하며, 원본 56바이트 백업·readback 검증·비활성화/종료 복원을 거친다. 패킷은 1024바이트 + 16비트 체크섬. Save/flash/LED/부트로더 명령은 의도적으로 구현되어 있지 않다.

Config는 `userData/config.json` — `DEFAULT_CONFIG` 위에 merge 후 normalize(값 클램프)된다 (`main/config.ts`).

## 하드 제약 (안전 경계)

- **장치 쓰기는 RAM 전용이며, 사용하는 명령은 제한된 `0x02 ScreenInfo/SystemInfo`·`0x10 KeyInfo`·`0x25 Display`뿐이다.** `0x02` 쓰기는 `cfg_selection` P1~P5 전환에만 허용하고 readback 성공 후에만 앱 상태를 갱신한다. `0x10` 쓰기는 Profile 1 노브 좌/우 엔트리(15/14)에만 허용하며, 물리 엔트리 메타데이터와 노브 클릭(12)·다른 키는 건드리지 않고 원본 백업·readback·복원을 필수로 한다. Save(`0x0D`)·MemoryWrite·LED·부트로더 명령과 키보드 HID 컬렉션은 절대 건드리지 말 것 — 앱 종료/비활성화 시 노브는 원래 Vol-/Vol+로 복원되고, 케이블을 뽑으면 장치는 자체 화면으로 복귀해야 한다.
- `docs/PROTOCOL.md`가 실기기 검증된 프로토콜 레퍼런스(권위 문서)다. `docs/XPAD_MINI_DIRECT_API.md`는 전체 명령·위험도 지도. 프로토콜 지식이 바뀌면 문서를 함께 갱신할 것.
- LCD는 240×**135**(펌웨어 보고값)이며, 마케팅 문구의 136이 아니다.
- 음악 조회와 앨범아트 추출이 전부 osascript 기반이라 **기능적으로 macOS 전용**이다. `electron-builder.yml`의 win 타깃은 이전 세대의 잔재.

## 코딩 스타일과 명명 규칙

TypeScript는 2칸 들여쓰기, 작은따옴표, 세미콜론을 사용하며 기존 파일의 형식을 따른다. 컴포넌트와 클래스는 `PascalCase`, 함수·변수는 `camelCase`, 상수는 `UPPER_SNAKE_CASE`, 파일은 `kebab-case`로 명명한다. main/preload/renderer 경계를 유지하고 공유 IPC 데이터는 `src/shared/types.ts`에서 정의할 것. ESLint나 Prettier 설정은 없으므로 불필요한 전체 파일 재포맷을 피한다.

## 테스트 지침

현재 자동 테스트 프레임워크와 커버리지 기준은 없다. 모든 변경에서 `./build.sh check`를 통과시키고, UI 변경은 `./build.sh dev-ui`로 확인할 것. HID·프로토콜 변경은 설치 앱을 종료한 뒤 실기기에서 검증하고 결과를 PR에 기록한다. `tools/test-*.js`와 `tools/probe-*.js`는 하드웨어 조사용 수동 도구이며 일반 테스트 스위트가 아니다. 자동 테스트를 추가할 때는 대상 코드 옆에 `*.test.ts` 또는 `*.test.tsx`로 배치한다.

## 커밋과 Pull Request 지침

최근 이력처럼 커밋 제목은 짧은 영어 명령형 문장으로 작성한다(예: `Improve LCD reconnect handling`). Conventional Commit 접두사는 현재 사용하지 않는다. PR에는 변경 목적, 사용자 영향, 실행한 검증 명령, 관련 이슈를 포함할 것. UI 변경에는 스크린샷을, 장치 동작 변경에는 사용한 Mac 아키텍처·펌웨어·검증 절차를 첨부한다. 저수준 명령을 바꾸면 `docs/PROTOCOL.md`도 함께 갱신한다.

## 보안과 배포 주의사항

인증서, 개인 키, 로컬 매뉴얼 또는 재배포 권한이 없는 에셋을 커밋하지 말 것. 패키징·설치 변경은 `electron-builder.yml`과 `build.sh` 양쪽을 확인하고, 배포 전 `./build.sh verify host`로 코드 서명과 Gatekeeper 검증을 수행한다.

## 저장소 참고 사항

- `tools/`는 프로토콜을 직접 말하는 독립 Node 스크립트 모음(빌드 없이 돌도록 프로토콜 상수를 의도적으로 중복). LED·clawd 계열(led-demo, test-leds, stream-clawd, gen-clawd 등)은 이전 세대 잔재로 앱이 더는 쓰지 않는 명령을 다루므로, 실행할 때도 RAM-only 규칙이 동일하게 적용된다.
- 앱에 번들되는 에셋은 `assets/tray`뿐이다(extraResources). `assets/clawd`는 이전 세대 잔재. `tools/import-clawd-gifs.js`가 받는 `assets/clawd-external/` 아트웍은 All-Rights-Reserved 팬아트라 gitignore 대상 — 절대 커밋·재배포 금지.
- `re/`(gitignored)는 Pulsar Bibimbap Web DRV 역공학 산출물이고, `Manual_XPad_mini.pdf`도 재배포 금지 대상이다.
- `docs/DEVELOPMENT_REPORT.md`가 현재 구현·검증 결과와 빌드/디버깅/배포 절차의 종합 보고서다(한국어).
