# XPAD Mini Now Playing 개발 내용

## 1. 문서 개요

| 항목 | 내용 |
|---|---|
| 프로젝트 | XPAD Mini Now Playing |
| 현재 버전 | `0.1.0` |
| 대상 운영체제 | macOS |
| 대상 장치 | Pulsar Lab XPAD Mini |
| 개발 위치 | 프로젝트 저장소 루트 |
| 앱 식별자 | `kr.co.zime.xpad-mini-now-playing` |
| 최종 확인일 | 2026-07-21 |

이 문서는 현재 저장소에 구현된 기능, 내부 구조, XPAD Mini 연결 방식, 빌드·서명·설치
결과와 실기기 검증 범위를 기록한다. 저수준 명령의 전체 목록과 역공학 근거는
[직접 연결 및 제어 기능 전체 가이드](./XPAD_MINI_DIRECT_API.md)와
[저수준 HID 프로토콜](./PROTOCOL.md)을 참조한다.

## 2. 개발 목표와 결과

macOS에서 실행되는 데스크톱 앱이 Spotify 또는 Apple Music의 현재 재생 정보를 읽고,
웹브라우저를 거치지 않고 USB HID로 XPAD Mini에 직접 연결해 내장 LCD에 표시하도록
개발했다.

현재 완료된 결과는 다음과 같다.

| 영역 | 구현 내용 | 상태 |
|---|---|---|
| 음악 감지 | Spotify와 Apple Music 프로세스 및 재생 상태 감지 | 완료 |
| 메타데이터 | 곡명, 아티스트, 앨범, 재생 시간, 현재 위치 조회 | 완료 |
| 앨범아트 | Spotify URL 다운로드, Apple Music artwork 내보내기 | 완료 |
| LCD 화면 | 240×135 레이아웃, 서비스 색상, 재생 상태와 진행률 표시 | 완료 |
| 장치 연결 | `node-hid`를 통한 XPAD Mini Vendor HID 직접 연결 | 완료 |
| LCD 전송 | RGB565 little-endian 프레임을 RAM에 반복 전송 | 완료 |
| 미세 볼륨 | XPAD 노브 한 칸을 실제 출력 단계 한 칸과 매칭, 클릭 Mute 유지 | 완료 |
| 자동 복구 | 장치 분리 후 3초 간격 재연결 | 완료 |
| 설정 화면 | 음악 표시 설정, 노브 미세 볼륨 활성화·단위, 로그인 실행 | 완료 |
| macOS 배포 | Apple Silicon/Intel DMG 생성 및 Developer ID 서명 | 완료 |
| 실기기 동작 | USB 연결, ScreenInfo 확인, 실제 LCD 음악 화면 표시 | 확인 |
| Apple 공증 | notarization 자격정보 미설정 | 미완료 |

## 3. 전체 동작 구조

```mermaid
flowchart LR
    A[Spotify / Apple Music] -->|AppleScript 조회| B[NowPlayingMonitor]
    B -->|TrackInfo| C[오프스크린 SVG 렌더러]
    C -->|240×135 RGB565| D[Device Worker]
    D -->|Sayo API v2 / HID 0x25| E[XPAD Mini LCD RAM]
    D -->|0x10 / F20·F19 임시 매핑| G[XPAD 노브 좌·우]
    G -->|전역 단축키| H[다음 실제 macOS 출력 단계 탐색]
    B --> F[Electron 설정 화면·트레이]
    C -->|PNG 미리보기| F
    D -->|연결·프로토콜 상태| F
```

메인 프로세스는 음악 상태와 설정을 관리하고, 화면 렌더링이 완료되면 최신 프레임만
장치 Worker에 전달한다. HID I/O는 별도 Worker Thread에서 처리해 장치 전송이 Electron
UI와 음악 조회를 막지 않도록 분리했다.

## 4. 주요 구현 내용

### 4.1 Spotify와 Apple Music 조회

구현 파일: [`src/main/music/now-playing.ts`](../src/main/music/now-playing.ts)

- `/usr/bin/pgrep`로 Spotify와 Music 실행 여부를 먼저 확인한다.
- `/usr/bin/osascript`로 각 앱의 재생 상태와 현재 곡 속성을 조회한다.
- 필드 구분자로 ASCII `0x1F`를 사용해 제목에 일반 문자가 포함되어도 안정적으로 파싱한다.
- 두 앱이 동시에 실행 중이면 사용자 우선순위, 실제 재생 상태, 직전에 활성화된 서비스를
  순서대로 고려한다.
- 기본 조회 주기는 1.5초이며 설정 정규화 범위는 750ms~10초다.
- AppleScript 실행 제한 시간은 3.5초다.
- Spotify 앨범아트는 현재 곡의 artwork URL을 최대 5초 제한으로 내려받는다.
- Apple Music 앨범아트는 현재 곡의 첫 번째 artwork 원시 데이터를 임시 파일로 내보낸다.
- 앨범아트는 곡별로 메모리에 캐시하며 최대 12개를 유지한다.

앱은 음악을 재생·정지하거나 곡을 변경하지 않는다. Apple Events 권한은 현재 곡 정보를
읽고 Apple Music 앨범아트를 가져오는 범위에서만 사용한다.

### 4.2 LCD 화면 생성

구현 파일: [`src/main/display/frame-renderer.ts`](../src/main/display/frame-renderer.ts)

- Electron의 숨겨진 offscreen `BrowserWindow`에서 240×135 SVG 화면을 렌더링한다.
- Spotify는 녹색, Apple Music은 붉은색 강조색을 사용한다.
- 앨범아트, 서비스명, 곡명, 아티스트, 앨범, 재생/일시 정지 아이콘과 진행률을 그린다.
- 앨범아트 표시 여부에 따라 텍스트 영역과 줄바꿈 길이를 자동 조정한다.
- 글자 수가 화면 폭을 넘으면 줄바꿈 또는 말줄임표를 적용한다.
- 폰트와 이미지 로딩이 완료된 다음 캡처하며, 빈 캡처가 나오면 최대 3회 재시도한다.
- 캡처된 PNG의 각 픽셀을 XPAD Mini가 사용하는 RGB565 little-endian 바이트로 변환한다.
- 같은 프레임으로 설정 화면의 LCD 미리보기도 제공한다.

메인 프로세스의 렌더 큐는 여러 상태 변경이 겹치면 오래된 결과를 버리고 가장 최근 곡과
설정만 장치에 전달한다.

### 4.3 XPAD Mini 직접 연결

구현 파일:

- [`src/main/device/hid.ts`](../src/main/device/hid.ts)
- [`src/main/device/protocol.ts`](../src/main/device/protocol.ts)
- [`src/main/device/device-worker.ts`](../src/main/device/device-worker.ts)
- [`src/main/device/device-host.ts`](../src/main/device/device-host.ts)

장치 식별값은 다음과 같다.

| 항목 | 값 |
|---|---|
| USB VID | `0x3710` |
| USB PID | `0x2507` |
| Vendor usage page | `0xFF12` |
| Vendor usage | `0x02` |
| HID 패킷 크기 | 1024바이트 |
| 리포트 ID | `0x22` |
| LCD 해상도 | 240×135 |
| 프레임 크기 | 64,800바이트 |

macOS에서 XPAD Mini는 키보드를 포함한 복합 HID로 나타난다. 앱은 키보드 컬렉션이
아니라 LCD 전송용 Vendor bulk 컬렉션만 선택하고, `node-hid`의
`nonExclusive: true` 모드로 연다. 연결에 실패하거나 장치가 분리되면 3초마다 다시
탐색한다.

프로토콜 준비 과정은 다음과 같다.

1. Sayo API v2 `ScreenInfo(0x02)`를 전송한다.
2. 장치 응답의 화면 크기가 240×135인지 확인한다.
3. 검증에 성공해야 `protocolReady`를 활성화한다.
4. `KeyInfo(0x10)`로 노브 좌/우 원본을 백업하고 앱 전용 F20/F19를 RAM에 적용한다.
5. `Display(0x25)` 명령으로 RGB565 프레임을 최대 1,012바이트씩 나누어 전송한다.
6. 동일한 청크는 생략하고, 약 66초마다 전체 프레임을 다시 보내 동기화를 보강한다.
7. 화면에 변화가 없어도 250ms 이상 전송이 없으면 첫 청크를 다시 보내며, Worker의
   기본 스트리밍 주기는 220ms다.

### 4.4 XPAD 노브 미세 볼륨

구현 파일:

- [`src/main/input/fine-volume.ts`](../src/main/input/fine-volume.ts)
- [`src/main/device/protocol.ts`](../src/main/device/protocol.ts)

Profile 1의 노브 왼쪽(엔트리 15)과 오른쪽(14)만 앱 실행 중 각각 F20/F19로
임시 매핑한다. Electron은 이 두 전역 단축키만 등록하고 XPAD 노브 한 칸마다 현재 실제
출력값에서 같은 방향의 정수값을 하나씩 시도한다. 출력 장치의 readback이 달라지는 첫
지점에서 중단하므로 불규칙한 macOS 출력값(예: 51→47→44)과 노브 칸을 1:1로 맞춘다.
빠른 회전 중 합쳐진 입력도 칸 수를 보존해 칸 수만큼 실제 단계를 반복 탐색한다. 설정의
1·2·3·5는 비율이나 퍼센트가 아니라 노브 한 칸당 이동할 실제 출력 단계 수다. 일반 Mac
키보드의 볼륨키는 등록하거나 가로채지 않으며, 노브 클릭(Mute)과 다른 XPAD 키도 변경하지
않는다. 이전 `fineVolumeStepPercent`·`fineVolumeStep` 값은 의미가 다르므로 승계하지 않고
새 `fineVolumeStepsPerDetent`의 기본값 1을 적용한다.

원본 56바이트 엔트리는 `config.json`에 보관하고 매 쓰기 후 출력 타입과 동작 데이터를
readback으로 확인한다. 설정 비활성화와 정상 종료 때 출고 Vol-/Vol+ 엔트리로 복원하며,
`Save(0x0D)`는 호출하지 않는다. 초기 F21 증가 신호가 macOS에서 전달되지 않은 실기기
결과에 따라 증가 신호는 F19로 교체했다.

노브 이벤트 누락과 출력 장치의 볼륨 단계 반올림을 구분하기 위해
`userData/logs/fine-volume.jsonl`에 다음 개인정보 비포함 이벤트를 기록한다.

- F20/F19 전역 단축키 등록 결과와 각 입력 수신 시각·방향·대기 노브 칸 수
- AppleScript 조절 시작, 수신한 노브 칸 수, 요청한 실제 단계 수, 탐색 시도 횟수,
  조절 전후 볼륨과 실제 이동 단계 수, 처리 시간
- 입력은 수신됐지만 적용 후 값이 같았는지 여부와 실행 오류
- 앱 시작·종료, 장치 연결·프로토콜·노브 매핑 상태

곡명·아티스트·앨범아트, HID 경로·시리얼, 사용자 홈 경로는 기록하지 않는다. 로그는
1MiB에서 회전하며 현재 파일과 직전 파일 하나만 유지한다.

### 4.5 설정 화면과 트레이

구현 파일:

- [`src/main/index.ts`](../src/main/index.ts)
- [`src/renderer/src/App.tsx`](../src/renderer/src/App.tsx)
- [`src/renderer/src/components/`](../src/renderer/src/components/)
- [`src/main/config.ts`](../src/main/config.ts)

창을 열면 별도 소개 헤더 없이 재생 패널만 표시한다. 패널 왼쪽 위에는 USB·LCD
프로토콜·XPAD 노브 상태를 텍스트 없이 장치 아이콘과 녹색 점(연결) 또는 빨간 ×(실패)로
표시한다. 패널 오른쪽 위 설정 아이콘을 누르면 재생 화면 대신 상세 장치 상태와 설정 화면이
열리며, 닫기 아이콘으로 재생 화면에 돌아간다. renderer의 IPC 상태 수명주기는 `App.tsx`가
담당하고 재생 화면, 소형 상태 표시, 상세 장치 상태, 표시 설정, 노브 설정은 각각 독립
컴포넌트로 분리했다.

설정 화면에서는 다음 항목을 확인하거나 변경할 수 있다.

- 음악 앱 자동 선택, Spotify 우선, Apple Music 우선
- 음악 확인 주기 1초, 1.5초, 2.5초, 5초
- 앨범아트 표시 여부
- 재생 진행률 표시 여부
- XPAD 노브 미세 볼륨 사용 여부와 한 칸당 실제 출력 단계 수(1·2·3·5)
- macOS 로그인 시 자동 실행

USB 연결 상태, LCD 프로토콜 준비 상태, 노브 적용 상태의 상세 문구와 조회 오류는 설정
화면에서 확인한다. 설정은 Electron의
`app.getPath('userData')/config.json`에 저장된다. macOS에서는 일반적으로
`~/Library/Application Support/xpad-mini-now-playing` 아래에 생성된다.

트레이 메뉴에서는 현재 재생 곡, XPAD Mini 연결 상태, 즉시 새로고침, 설정 창 열기와
앱 종료를 제공한다. 단일 인스턴스 잠금을 사용하므로 앱을 다시 실행하면 기존 프로세스를
중복 실행하지 않고 설정 창을 연다.

## 5. 안전 경계

현재 앱이 XPAD Mini에 보내는 장치 명령은 다음 세 개뿐이다.

| 명령 | ID | 사용 목적 |
|---|---:|---|
| `ScreenInfo` | `0x02` | LCD 해상도와 프로토콜 응답 확인 |
| `KeyInfo` | `0x10` | 노브 좌/우 원본 읽기와 RAM 임시 매핑/복원 |
| `Display` | `0x25` | 장치 RAM의 LCD 프레임 갱신 |

현재 코드에는 아래 동작이 포함되어 있지 않다.

- `Save(0x0D)` 및 플래시 영구 저장
- 노브 좌/우 외 키맵과 노브 클릭 변경
- 키 입력 전송 또는 매크로 실행
- LED 설정 변경
- 펌웨어 업데이트 또는 부트로더 진입
- 공장 초기화

따라서 이번 실기기 적용은 **LCD RAM 화면 갱신과 노브 좌/우 RAM 임시 매핑**이며
**펌웨어 업데이트가 아니다**.
앱이 전송을 중단하면 장치 펌웨어가 자체 화면을 다시 그릴 수 있으며, 음악 표시 내용이
영구 설정으로 저장되지는 않는다.

## 6. macOS 권한과 직접 연결 조건

- Spotify 또는 Music 조회 시 macOS가 자동화/Apple Events 권한을 요청할 수 있다.
- XPAD Mini Vendor HID 접근을 위해
  `시스템 설정 → 개인정보 보호 및 보안 → 입력 모니터링`에서
  `XPAD Mini Now Playing.app`을 허용해야 한다.
- 권한 변경 후에는 Finder 또는 `open -a`를 통해 앱을 다시 시작해야 TCC 권한이 올바르게
  적용된다.
- Bibimbap Web DRV, WebHID 페이지나 다른 HID 도구가 같은 인터페이스를 사용 중이면
  충돌할 수 있으므로 동시에 연결하지 않는다.

브라우저 없이 직접 연결할 수 있는 이유는 앱이 WebHID 대신 로컬 네이티브 모듈
`node-hid`를 사용하기 때문이다. 다만 프로토콜은 Pulsar의 공식 네이티브 SDK가 아니라
실기기와 공개 Sayo 호환 구현을 대조한 비공식 역공학 결과다.

## 7. 빌드, 디버깅, 배포 및 설치

저장소 루트의 [`build.sh`](../build.sh)가 의존성 설치, 검사, 디버깅, 개인 인증서 서명,
DMG 검증과 `/Applications` 설치를 담당한다. 모든 명령은 저장소 어느 위치가 아니라
`build.sh`가 있는 프로젝트 루트를 기준으로 실행된다.

### 7.1 앱 수정과 로컬 검증 절차

```sh
# 최초 1회 또는 package-lock.json 변경 후
./build.sh deps

# HID를 사용하는 일반 개발 실행(설치 앱 종료 후)
./build.sh stop
./build.sh dev

# TypeScript 검사와 프로덕션 빌드
./build.sh check

# 런타임 의존성 보안 감사
./build.sh audit
```

`dev`도 `debug-hid`와 마찬가지로 설치 앱이 실행 중이면 HID 충돌 방지를 위해 실행을
거부한다. `check`가 실패한 상태에서는 배포하지 않는다. `check`는 TypeScript
main/preload 및 renderer 검사 후 프로덕션 번들을 새로 생성한다.

### 7.2 디버깅 방법

기본 디버깅은 설치 앱이 계속 LCD를 표시하는 상태에서도 장치 인터페이스를 빼앗지 않도록
HID를 비활성화한다.

```sh
./build.sh debug
```

기본 디버그 포트는 다음과 같다.

| 대상 | 포트 | 연결 용도 |
|---|---:|---|
| Electron main process | `9229` | VS Code/Node Inspector attach |
| Renderer | `9222` | Chromium DevTools Protocol |

포트를 직접 지정할 수도 있다.

```sh
./build.sh debug 9230 9231
```

실제 XPAD Mini 연결까지 디버깅할 때는 동일 HID 채널을 사용 중인 설치 앱을 먼저 정상
종료한다. `debug-hid`는 설치 앱이 실행 중이면 충돌을 피하기 위해 실행을 거부한다.

```sh
./build.sh stop
./build.sh debug-hid
```

`debug`와 `debug-hid`는 source map, electron-vite debug log, main V8 inspector와 renderer
remote debugging을 함께 활성화한다. 디버그 프로세스를 종료한 뒤 설치 앱을 다시 사용할
때는 `./build.sh run`을 실행한다.

### 7.3 배포 파일 생성

현재 Mac 아키텍처만 생성:

```sh
./build.sh package host
```

Apple Silicon 또는 Intel만 생성:

```sh
./build.sh package arm64
./build.sh package x64
```

두 아키텍처 모두 생성:

```sh
./build.sh package all
```

`package`는 다음 작업을 순서대로 수행한다.

1. TypeScript/Electron 프로덕션 번들 생성
2. Keychain에서 사용 가능한 개인 `Developer ID Application` 인증서 확인
3. electron-builder로 대상 DMG와 내부 앱 생성 및 서명
4. DMG 자체에 타임스탬프를 포함한 Developer ID 서명 적용
5. DMG를 읽기 전용으로 마운트해 내부 앱의 deep/strict 서명 검사
6. Gatekeeper `spctl` 검사와 SHA-256 출력

인증서가 하나면 `CSC_NAME`을 생략할 수 있으며 스크립트가 Keychain에서 첫 번째
`Developer ID Application` 인증서를 선택한다. 인증서가 여러 개면 `CSC_NAME`으로
대상을 지정한다. 전체 인증서 이름을 전달해도 스크립트가 electron-builder 26.x에 필요한
선택값과 `codesign`에 필요한 전체 이름을 구분해 처리한다. 기존 환경의 `CSC_NAME=-`
값은 무시하고 Keychain에서 인증서를 자동 선택한다.

```sh
CSC_NAME="Developer ID Application: 이름 (TEAMID)" ./build.sh package arm64
```

`electron-builder.yml`에는 macOS arm64/x64 DMG, music 카테고리, Hardened Runtime과
Apple Events 용도 문구가 설정되어 있다.

### 7.4 설치와 실제 배포 앱 갱신

이미 만들어진 현재 Mac용 DMG 설치:

```sh
./build.sh install host
```

소스 수정분을 새로 빌드하고 서명한 뒤 `/Applications`에 설치하고 실행:

```sh
./build.sh deploy host
```

`install`과 `deploy`는 DMG 및 내부 앱을 먼저 검증하고, 실행 중인 설치 앱에 정상 종료를
요청한다. 5초 안에 종료되지 않으면 강제 종료하거나 덮어쓰지 않고 중단한다. 기존 앱은
삭제하지 않고 Finder 휴지통으로 이동한 다음 새 앱을 설치하므로 복구할 수 있다.

배포 상태 확인과 앱 제어:

```sh
./build.sh status
./build.sh run
./build.sh stop
./build.sh verify host
./build.sh verify all
./build.sh signing
```

지원되는 모든 명령과 환경 변수는 `./build.sh help`에서 확인한다.

### 7.5 현재 설치 결과

| 항목 | 결과 |
|---|---|
| 설치 위치 | `/Applications/XPAD Mini Now Playing.app` |
| 앱 아키텍처 | arm64 |
| 코드 서명 | Keychain에서 선택한 `Developer ID Application` |
| Team ID | 선택한 서명 인증서의 Team ID |
| Hardened Runtime | 활성화 |
| `codesign --verify --deep --strict` | 통과 |
| `spctl -a -t execute` | `accepted`, `source=Developer ID` |
| Apple notarization | 자격정보 미설정으로 수행하지 못함 |

생성된 배포 파일과 SHA-256은 다음과 같다.

| 대상 | 파일 | SHA-256 |
|---|---|---|
| Apple Silicon | `dist/XPAD Mini Now Playing-0.1.0-arm64.dmg` | `ece4320fd9c3d78597930d763fbde2f989ac12b99484fc31c9452fa3d2e9ad15` |
| Intel Mac | `dist/XPAD Mini Now Playing-0.1.0.dmg` | `25b47a8d86a1ba5df65ff888ee98121c416247453e0ff33f9199f1a42de3f2be` |

서명과 로컬 Gatekeeper 검사는 통과했지만 Apple 공증은 별도 상태다. 다른 Mac에 외부
배포할 때 경고 없는 설치 경험이 필요하면 App Store Connect API Key 또는 Apple ID
notarytool 자격정보를 설정한 뒤 notarization과 staple 검증을 추가해야 한다.

## 8. 검증 결과

2026-07-21에 다음 항목을 다시 확인했다.

| 검증 | 결과와 근거 |
|---|---|
| TypeScript | `npm run typecheck` 통과 |
| 프로덕션 빌드 | `npm run build` 통과 |
| 배포 스크립트 | `bash -n`, ShellCheck, `help`, `status`, HID 충돌 차단 통과 |
| arm64 패키지 | `./build.sh package host` 전체 과정 통과 |
| 변경 파일 형식 | `git diff --check` 통과 |
| 런타임 취약점 | `npm audit --omit=dev` 결과 0건 |
| 앱 서명 | `codesign --verify --deep --strict` 통과 |
| Gatekeeper | 설치 앱 `accepted`, Developer ID 원본 확인 |
| 실기기 USB | 앱 화면에서 `XPAD Mini 연결됨` 확인 |
| LCD 프로토콜 | 앱 화면에서 `RAM 스트리밍 준비됨` 확인 |
| 노브 매핑 | 원본 56바이트 2개 저장, Vol-/Vol+ action 11/10 확인, F20/F19 readback 후 `미세 볼륨 적용됨` 확인 |
| 미세 볼륨 축소 | XPAD 노브 왼쪽 회전으로 실제 다음 출력 단계 적용 확인 |
| 미세 볼륨 증가 | F19 readback과 실제 60에서 다음 출력 단계 64 탐색 후 XPAD 노브 오른쪽 회전 확인 |
| 볼륨 단계 진단 | 출력 47에서 46을 요청해도 적용값이 47로 반환되고 47로 원복됨 — 일부 1% 입력은 출력 장치/AppleScript 경로에서 같은 단계로 반올림됨 |
| 노브-출력 단계 매칭 | 실제 51에서 한 칸 내림은 3회 탐색 후 47, 한 칸 올림은 2회 탐색 후 51, 빠른 두 칸 내림은 실제 두 단계 44 적용 후 원래 51로 복원 |
| 음악 정보 | Apple Music 곡명·아티스트·앨범·앨범아트 표시 확인 |
| 실제 LCD | 연결된 XPAD Mini LCD의 음악 화면 갱신 확인 |

현재 자동화된 단위 테스트와 통합 테스트 스위트는 없다. 위 결과는 정적 검사, 빌드,
서명 검사와 연결된 실기기의 수동 E2E 확인에 근거한다.

## 9. 현재 실행 상태와 운영 방법

설치 앱 상태는 배포 스크립트로 확인할 수 있다.

```sh
./build.sh status
```

앱과 LCD 스트리밍 종료:

```sh
./build.sh stop
```

앱을 다시 실행할 때는 다음 명령을 사용할 수 있다.

```sh
./build.sh run
```

## 10. 현재 제한사항과 후속 과제

1. Apple notarization은 아직 수행되지 않았다.
2. 자동화된 프로토콜/렌더링 테스트가 아직 없다.
3. Apple Music artwork가 없는 곡이거나 앱이 원시 artwork를 제공하지 않으면 앨범아트
   없이 텍스트 레이아웃으로 표시된다.
4. Spotify 앨범아트 네트워크 요청이 실패하면 해당 프레임은 텍스트 정보만 사용한다.
5. LCD 명령은 비공식 역공학 프로토콜에 근거한다. 현재 앱은 실기기로 검증한 최소 두
   명령만 사용하며, 문서에 정리된 다른 명령을 자동으로 실행하지 않는다.
6. 앱은 현재 macOS 전용이다. Windows 배포 설정은 기존 설정 파일에 남아 있지만 음악
   조회 구현이 AppleScript를 사용하므로 Windows에서 동작하는 상태는 아니다.

## 11. 관련 문서와 참고 자료

프로젝트 내부 문서:

- [프로젝트 README](../README.md)
- [XPAD Mini 직접 연결 및 제어 기능 전체 가이드](./XPAD_MINI_DIRECT_API.md)
- [저수준 HID 프로토콜](./PROTOCOL.md)

외부 자료:

- [Pulsar Bibimbap Web DRV](https://bbb.pulsar.gg/sKey/)
- [Pulsar Lab XPAD Mini 제품 페이지](https://us.pulsar.gg/products/pulsar-lab-xpad-mini-gaming-key-pad)
- [SayoDeviceStreamingAssistant](https://github.com/SayoGroup/SayoDeviceStreamingAssistant)
- [원본 xpad-mini-claude-code 저장소](https://github.com/SpinnerMaster/xpad-mini-claude-code)
- [node-hid 공식 저장소](https://github.com/node-hid/node-hid)
- [WebHID 사양](https://wicg.github.io/webhid/)
- [Apple IOHIDManager 문서](https://developer.apple.com/documentation/iokit/iohidmanager_h)
