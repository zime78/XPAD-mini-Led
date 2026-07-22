# XPAD Mini Now Playing

macOS의 Spotify와 Apple Music에서 현재 재생 중인 곡을 읽어 Pulsar Lab XPAD Mini의
240×135 LCD에 표시하는 Electron 트레이 앱입니다.

## 프로젝트 목표

- 별도 웹 드라이버(Bibimbap Web DRV) 없이 macOS에서 XPAD Mini LCD를 네이티브 USB HID로 직접 구동합니다.
- 재생 중인 음악(곡명·아티스트·앨범·앨범아트·진행률)을 책상 위 상시 디스플레이로 보여줍니다.
- LCD 프레임, 프로필 선택과 노브 좌/우 매핑은 RAM으로만 전송합니다. 펌웨어·LED·플래시
  저장 영역과 다른 키 매핑은 건드리지 않으며, 앱 종료 시 노브 원본을 복원합니다.
- 설정 없이 동작합니다 — 음악 앱과 장치를 자동 감지하고, 연결이 끊기면 자동 재연결합니다.

## 필수 장비

이 앱은 실물 **Pulsar Lab XPAD Mini**(VID `0x3710`, PID `0x2507`)가 USB로 연결되어
있어야 LCD 표시가 동작합니다. 장비 상세 정보와 구매는 제조사 제품 페이지를 참조하십시오.

- [Pulsar Lab XPAD Mini — 제조사(Pulsar) 제품 페이지](https://us.pulsar.gg/products/pulsar-lab-xpad-mini-gaming-key-pad)

장치가 없어도 `./build.sh dev-ui`(HID 비활성)로 설정 UI와 음악 조회 기능까지는 실행해 볼 수 있습니다.

## 기능

- Spotify / Apple Music 자동 감지
- 곡명, 아티스트, 앨범, 재생 상태와 진행률 표시
- 앨범아트 표시
- XPAD 노브 한 칸을 실제 출력 단계와 맞춘 미세 볼륨 조절(한 칸당 1·2·3·5단계 설정)
- 노브 조절 직후 실제 macOS 출력 볼륨을 LCD와 앱 미리보기에 퍼센트·막대로 표시하고
  마지막 입력 1.6초 후 곡 화면으로 자동 복귀
- 재생 화면에서 P1~P5 실제 장치 프로필을 빠르게 전환하고, SystemInfo readback 성공 뒤
  선택 프로필의 하단 버튼 3개 동작과 F16~F18 로컬 라우팅 대상을 함께 갱신
- XPAD Mini 자동 재연결
- 로그인 시 자동 실행 옵션
- HID 명령 `0x25`를 사용한 RAM 전용 LCD 스트리밍
- `0x02` SystemInfo readback을 사용하는 RAM 전용 P1~P5 프로필 전환
- `0x10` KeyInfo를 사용한 Profile 1 노브 좌/우 RAM 임시 매핑과 종료 시 원복

일반 Mac 키보드 볼륨키, XPAD 노브 클릭(Mute), 다른 XPAD 키 매핑, 펌웨어, LED 설정,
장치 플래시 저장 영역은 변경하지 않습니다. 앱이 종료되면 노브는 원래 Vol-/Vol+로
복원되고 장치의 기본 화면이 다시 그려집니다.

## 개발

```sh
./build.sh deps
./build.sh dev
./build.sh check
```

처음 실행할 때 macOS가 Spotify 또는 Music 제어 권한을 요청할 수 있습니다. 이 권한은
재생 정보를 읽는 데만 사용합니다.

HID 충돌 없이 UI와 음악 조회를 디버깅하려면 `./build.sh debug`, 실제 장치까지
디버깅하려면 설치 앱을 종료한 다음 `./build.sh debug-hid`를 사용합니다. 개인 인증서로
DMG를 생성하려면 `./build.sh package all`, 현재 Mac용 앱을 빌드·설치하려면
`./build.sh deploy host`를 실행합니다. 전체 옵션과 수정·배포 절차는
[개발 내용 및 검증 보고서](docs/DEVELOPMENT_REPORT.md#7-빌드-디버깅-배포-및-설치)를 참조하십시오.

XPAD 노브 입력 진단 로그는
`~/Library/Application Support/xpad-mini-now-playing/logs/fine-volume.jsonl`에 JSONL로
기록됩니다. 노브 방향·요청 단위·조절 전후 볼륨·처리 시간만 저장하며 곡 정보나 장치
식별자는 기록하지 않습니다. 파일이 1MiB를 넘으면 이전 로그 한 개로 회전합니다.

## 프로젝트 구조

git에 커밋되는 파일 기준의 워크트리입니다 (생성물 `out/`·`dist/`·`node_modules/` 등은 제외).

```
.
├─ AGENTS.md                        # 에이전트 공용 저장소 지침 (아키텍처·안전 경계·규칙)
├─ CLAUDE.md                        # Claude Code 진입점 — AGENTS.md를 import
├─ LICENSE                          # MIT 라이선스
├─ README.md                        # 이 문서
├─ build.sh                         # 빌드·디버깅·서명·배포 통합 스크립트 (표준 진입점)
├─ electron-builder.yml             # DMG 패키징 설정 (appId, Hardened Runtime)
├─ electron.vite.config.ts          # main/preload/renderer + device-worker 번들 설정
├─ package.json                     # npm 메타데이터·스크립트·의존성
├─ package-lock.json                # 의존성 잠금
├─ tsconfig.json                    # TypeScript 프로젝트 참조 루트
├─ tsconfig.node.json               # main/preload용 TS 설정 (strict)
├─ tsconfig.web.json                # renderer용 TS 설정 (strict)
├─ .gitignore                       # 생성물·로컬 상태·인증서·재배포 불가 에셋 제외
├─ .github/
│  └─ workflows/build.yml           # macOS 타입 검사·빌드·런타임 의존성 감사
├─ build/
│  └─ icon.png                      # 앱 아이콘 원본 (electron-builder가 icns/ico로 변환)
├─ assets/
│  ├─ tray/                         # 상태별 트레이 아이콘 (재생·일시정지·대기, 앱에 번들)
│  └─ clawd/                        # 이전 세대 LCD 애니메이션 프레임 (잔재, 현재 앱 미사용)
├─ docs/
│  ├─ README.md                     # 기술 문서 인덱스
│  ├─ DEVELOPMENT_REPORT.md         # 개발 내용·검증 결과·빌드/배포 절차 종합 보고서
│  ├─ XPAD_MINI_DIRECT_API.md       # 직접 연결·전체 제어 기능·위험도 가이드
│  ├─ PROTOCOL.md                   # 실기기 검증 저수준 HID 프로토콜 (권위 문서)
├─ src/
│  ├─ shared/
│  │  └─ types.ts                   # 전 프로세스 공용 타입 (TrackInfo, AppConfig 등)
│  ├─ main/
│  │  ├─ index.ts                   # 앱 수명 주기·트레이·재생/일반/키보드 창·IPC 오케스트레이션
│  │  ├─ diagnostic-log.ts          # 개인정보 없는 노브 입력·볼륨 적용 JSONL 로그
│  │  ├─ config.ts                  # userData/config.json 로드·저장·정규화
│  │  ├─ music/
│  │  │  └─ now-playing.ts          # AppleScript로 Spotify/Music 폴링·앨범아트 수집
│  │  ├─ display/
│  │  │  ├─ frame-renderer.ts       # 트랙 정보·볼륨 OSD → RGB565 LCD 프레임 렌더링
│  │  │  ├─ volume-overlay.ts       # 실제 출력 볼륨 퍼센트·막대 SVG 생성
│  │  │  └─ volume-overlay.test.ts  # 볼륨 값·막대·0/100% 경계 자동 검증
│  │  ├─ input/
│  │  │  ├─ fine-volume.ts          # F20/F19 → 다음 실제 출력 단계 탐색·결과 전달
│  │  │  └─ fine-volume.test.ts     # 조절 후 실제 readback 이벤트 자동 검증
│  │  └─ device/
│  │     ├─ device-host.ts          # 디바이스 워커 스레드 프록시 (main 쪽)
│  │     ├─ device-worker.ts        # HID I/O 워커 — 220ms 주기 프레임 스트리밍
│  │     ├─ hid.ts                  # XPAD Mini bulk 채널 열기·자동 재연결
│  │     └─ protocol.ts             # ScreenInfo/프로필 0x02, 노브 KeyInfo 0x10, Display 0x25
│  ├─ preload/
│  │  └─ index.ts                   # contextBridge — window.xpad IPC API 노출
│  └─ renderer/
│     ├─ index.html                 # 재생/설정 창 공용 HTML 엔트리
│     └─ src/
│        ├─ main.tsx                # React 마운트
│        ├─ App.tsx                 # 창 역할별 재생/설정 화면과 IPC 상태 수명주기
│        ├─ App.test.tsx            # 공개 UI 동작 테스트
│        ├─ components/             # 재생 화면과 설정 섹션별 React 컴포넌트
│        ├─ styles.css              # 재생·설정 화면 스타일과 디자인 토큰
│        ├─ assets.d.ts             # 에셋 import 타입 선언
│        └─ env.d.ts                # 환경 타입 선언
└─ tools/                           # 빌드 없이 실행하는 장치 실험 스크립트 (프로토콜 상수 중복은 의도)
   ├─ hid-enum.js                   # XPAD Mini HID 인터페이스 열거
   ├─ probe-screeninfo.js           # ScreenInfo(0x02) 읽기 전용 프로브
   ├─ probe-cmd.js                  # 임의 v2 명령 읽기 전용 프로브
   ├─ probe-v1.js                   # API v1 채널(0xFF00) 읽기 전용 프로브
   ├─ readback.js                   # LCD 프레임버퍼 리드백 검증
   ├─ sweep-diff.js                 # 펌웨어 애니메이션 중 명령 응답 변화 관찰
   ├─ led-demo.js                   # LED 인덱스 매핑 데모 (이전 세대)
   ├─ test-leds.js                  # LED 쓰기(0x27) 테스트, RAM 전용 (이전 세대)
   ├─ identify-leds.js              # LED 물리 위치 식별 실험 1 (이전 세대)
   ├─ identify-leds2.js             # LED 물리 위치 식별 실험 2 (이전 세대)
   ├─ probe-key-leds.js             # 키 LED 명령 탐색, RAM 전용 (이전 세대)
   ├─ probe-extra-leds.js           # 13개 초과 LED 존재 여부 프로브 (이전 세대)
   ├─ stream-clawd.js               # LCD 애니메이션 스트리밍 테스트 (이전 세대)
   ├─ gen-clawd.js                  # Clawd 애니메이션 프레임 생성 (이전 세대)
   ├─ import-clawd-gifs.js          # 외부 Clawd GIF 로컬 임포트 (이전 세대, 산출물 커밋 금지)
   ├─ gen-app-icon.js               # build/icon.png 앱 아이콘 생성
   ├─ gen-tray-icons.js             # assets/tray 트레이 아이콘 생성
   └─ test-input-ffi.js             # Windows 입력 FFI 검증 (이전 세대)
```

## macOS 설치

- Apple Silicon: `dist/XPAD Mini Now Playing-0.1.0-arm64.dmg`
- Intel Mac: `dist/XPAD Mini Now Playing-0.1.0.dmg`
- 설치 위치: `/Applications/XPAD Mini Now Playing.app`

배포 앱과 DMG는 개인 `Developer ID Application` 인증서로 서명하며 Hardened Runtime을
사용합니다. XPAD Mini가 키보드를 포함한 복합 HID이므로 최초 직접 연결 시
`시스템 설정 → 개인정보 보호 및 보안 → 입력 모니터링`에서 앱을 허용해야 합니다.
Bibimbap Web DRV나 다른 HID 도구와 동시에 연결하지 마십시오.

## 기술 문서

- [현재 개발 내용 및 검증 보고서](docs/DEVELOPMENT_REPORT.md)
- [재생 화면 P1~P5 단축 전환 설계·구현 기록](docs/plan/profile-quick-switch/GUI.md)
- [키보드 설정·프로파일·백업 기능 계획과 구현 현황](docs/plan/keyboard-settings/PLAN.md)
- [XPAD Mini 직접 연결 및 제어 기능 전체 가이드](docs/XPAD_MINI_DIRECT_API.md)
- [저수준 HID 프로토콜](docs/PROTOCOL.md)
- [문서 인덱스](docs/README.md)

## 장치

- Pulsar Lab XPAD Mini — [제조사 제품 페이지](https://us.pulsar.gg/products/pulsar-lab-xpad-mini-gaming-key-pad)
- VID `0x3710`, PID `0x2507`
- Vendor HID bulk usage page `0xFF12`
- LCD `240×135`, RGB565 little-endian

## 출처와 라이선스

이 프로젝트는 MIT 라이선스의
[`SpinnerMaster/xpad-mini-claude-code`](https://github.com/SpinnerMaster/xpad-mini-claude-code)에
포함된 XPAD Mini HID 프로토콜 구현을 기반으로 합니다. 프로토콜 역분석 근거는
[`docs/PROTOCOL.md`](docs/PROTOCOL.md)에 보존되어 있습니다.
