# XPAD Mini 직접 연결 및 제어 기능 전체 가이드

문서 상태: **macOS 직접 연결 확인 / 비공식 역공학 API**

대상 장치: `Pulsar Lab Xpad Mini`

최종 대조일: 2026-07-22

## 1. 결론

XPAD Mini는 웹브라우저 없이 USB로 직접 연결할 수 있다. 장치는 일반 키보드
입력과 별도로 벤더 HID 컬렉션을 노출한다. 이 프로젝트는 macOS의
`IOHIDManager`를 사용하는 `node-hid`로 고속 벤더 채널을 연다.

```text
XPAD Mini USB
  └─ macOS IOKit / IOHIDManager
      └─ node-hid
          └─ Electron Device Worker
              └─ Sayo API v2 / Usage Page 0xFF12
                  ├─ 0x02 ScreenInfo 읽기 / 프로필 RAM 선택
                  ├─ 0x10 노브 좌/우 RAM 임시 매핑
                  └─ 0x25 LCD RAM 프레임 쓰기
```

`https://bbb.pulsar.gg/sKey/`는 브라우저의 WebHID를 사용하는 공식 설정 UI다.
네이티브 앱은 같은 USB 장치 계열에 브라우저를 거치지 않고 직접 접근한다.

## 2. 확인된 하드웨어 연결

2026-07-21 실기기에서 `node tools/hid-enum.js`로 다음 컬렉션을 확인했다.

| Usage Page | Usage | 의미/용도 | 현재 앱 |
|---:|---:|---|---|
| `0x0001` | `0x01` | Generic Desktop/Pointer 계열 | 열지 않음 |
| `0x0001` | `0x02` | Mouse | 열지 않음 |
| `0x0001` | `0x05` | Game Pad | 열지 않음 |
| `0x0001` | `0x06` | Keyboard | 열지 않음 |
| `0x0001` | `0x30` | X axis | 열지 않음 |
| `0x0001` | `0x32` | Z axis | 열지 않음 |
| `0x000C` | `0x01` | Consumer Control/미디어 키 | 열지 않음 |
| `0xFF00` | `0x01` | Sayo API v1, 64바이트 | 열지 않음 |
| `0xFF11` | `0x02` | Sayo API v2 저속, 64바이트 | 열지 않음 |
| `0xFF12` | `0x02` | Sayo API v2 고속, 1024바이트 | **LCD, 프로필 선택과 제한된 노브 RAM 매핑용** |

```text
manufacturer = Pulsar
product      = Pulsar Lab Xpad Mini
vendorId     = 0x3710
productId    = 0x2507
bulk page    = 0xFF12
bulk usage   = 0x02
```

장치 경로와 USB 일련번호는 실행 시 운영체제에서 얻되 문서나 영구 로그에 저장하지
않는다.

## 3. WebHID와 직접 연결 비교

| 항목 | Bibimbap Web DRV | 이 macOS 앱 |
|---|---|---|
| 접근 API | Chromium WebHID | `node-hid` → IOHIDManager |
| 실행 위치 | 웹브라우저 탭 | Electron 앱/백그라운드 Worker |
| 장치 선택 | 브라우저 선택 창 | VID/PID/Usage Page 자동 탐색 |
| 인터넷 | 페이지 최초 로드에 필요 | 로컬 음악/LCD 출력에는 불필요 |
| 공식 지원 | Pulsar 공식 설정 경로 | 비공식 직접 구현 |
| 전체 설정 | 키맵, 성능, RGB, LCD, 펌웨어 등 | LCD RAM + P1~P5 RAM 선택 + 노브 좌/우 RAM 임시 매핑 |
| 충돌 | 벤더 HID를 점유할 수 있음 | 같은 컬렉션 동시 접근 시 실패 가능 |

### 동시 사용 주의

Bibimbap이 이미 XPAD Mini에 연결된 상태에서는 네이티브 앱이 `0xFF12`를 열지
못하거나 응답이 섞일 수 있다. 직접 연결 앱을 사용할 때는 Bibimbap의 장치 연결을
해제하거나 탭을 닫은 뒤 앱을 실행한다. HID 열거가 성공하는 것과 동일 벌크
컬렉션의 동시 읽기/쓰기가 안전한 것은 서로 다른 문제다.

## 4. Bibimbap에서 실제 확인한 제어 기능 전체

아래 목록은 2026-07-21 연결된 XPAD Mini의 Bibimbap 접근성 트리를 탭별로
읽어서 확인했다. 탭 이동과 화면 읽기만 수행했으며 저장, 초기화, 업데이트,
설정값 변경은 실행하지 않았다.

### 4.1 공통/프로필

- Profile 1~5 선택
- 장치 설정 읽기와 저장
- MCU 사용률 표시
- 장치 저장소 사용량 표시
- 메인 키 레이어와 게임패드 레이어
- 설정 되돌리기/앞으로 가기 계열 버튼

### 4.2 키 지정

물리 입력 대상으로 화면에서 확인된 항목:

- 3개 자석축 키
- 휠 위/아래
- 상단 기능 버튼 `PF 1`
- Main Layer / Gamepad Layer
- Profile 1~5별 매핑

지정 가능한 출력/동작:

- 영문 A~Z, 숫자, 기호, 방향키, 편집/탐색 키
- 좌/우 Ctrl, Shift, Alt, Windows/Command, Menu
- F1~F24
- 숫자 키패드 전체
- 국제/일본어 키: LANG3~5, Kana, 변환/무변환 등
- 시스템/브라우저: Search, Browser, Back, Forward, Stop, Refresh, Favorites
- 앱 실행: MediaPlayer, Email, Calculator, Explorer
- 디스플레이 밝기 증감
- 미디어: 이전, 재생/일시정지, 정지, 다음, 음소거, 볼륨 증감
- 마우스: 왼쪽/오른쪽/가운데, 추가 버튼 4~7
- 휠 위/아래
- Profile 1~5 전환
- SOCD 전환
- LED 테스트, LED 켜기/끄기, 밝기, 속도, 모드, 효과, 채도
- Key Lock, Screen Lock
- Task View, Voice Typing
- 매크로
- 조합 키, 2 Step, Tap & Hold, Combo, 최대 4키 조합
- 확장 키

이 목록은 UI가 제공한 선택지다. 특정 운영체제에서 모든 시스템 키가 같은 동작을
한다는 보장은 없으며, macOS에서는 Windows 전용 키가 다르게 해석될 수 있다.

### 4.3 성능

- 키별 작동 깊이/성능 값 표시
- 개별 선택, 전체 선택, 반전 선택, 선택 취소
- 자석축 키별 성능 편집 진입점
- 멀티 샘플링
- 속도/정확도 균형
- 폴링레이트 `1K`, `2K`, `4K`, `8K`
- 전체 키 보정
- Factory Reset
- 보정 절차 안내와 키별 LED 안내

UI가 키를 선택하기 전에는 세부 작동점 슬라이더를 노출하지 않아, 이번 읽기 전용
확인에서는 실제 값을 변경하거나 전체 세부 필드명을 확정하지 않았다. Pulsar 제품
페이지에서는 Rapid Trigger, Quick Tap, 100K scan rate, 0.1ms 지연을 명시한다.

### 4.4 고급 키

- 활성 고급 키 슬롯 표시: UI에서 `36/40` 관찰
- `DKS`: Dynamic Keystroke, 누름 깊이에 따라 여러 동작
- `MT`: Mod-Tap, 탭과 홀드에 서로 다른 동작
- `QT`: Quick Tap 계열
- `TK`: Toggle Key 계열
- `US`: UI 코드 확인, 정확한 풀네임은 확인하지 못함

웹 UI의 툴팁에는 Toggle 기능을 눌렀다 떼어 켜고 끄는 설명이 노출됐다. 각
모드의 전체 바이너리 페이로드는 아직 해석하지 않았다.

### 4.5 매크로

- 매크로 목록 추가/삭제
- Macro ID별 편집
- 녹화 시작
- 지연 요소 추가
- 전체 요소 삭제
- 키 스트로크
- 키 누르기, 키 놓기, 눌렀다 떼기
- 지속시간(ms)
- 마우스 왼쪽/오른쪽/앞/뒤/휠 클릭
- 스크롤 위/아래
- 마우스 위치 요소
- 기록된 지연 또는 고정 지연
- 반복 횟수
- 다른 키를 누르면 중지
- 키를 누르는 동안 반복
- 가져오기/내보내기/저장

UI는 일부 마우스 좌표/고정 지연 옵션을 `PC Software only` 및 브라우저 미지원으로
표시했다. 즉, 하드웨어가 가진 기능과 WebHID UI에서 편집 가능한 범위가 완전히
같지는 않다.

### 4.6 게임패드

- Game Pad 출력 `OFF`
- `CLASSIC CONTROLLER`
- `XBOX CONTROLLER`
- 키보드 키 출력 병행 켜기/끄기
- 게임패드 버튼 우선 적용
- 조이스틱 Quick Tap
- 반대 방향 동시 입력 처리
- 키 눌림 깊이를 아날로그 값으로 변환
- 게임패드 테스터
- Gamepad Layer 키 지정

### 4.7 RGB와 LED

- Key LED preset 켜기/끄기
- LED 속도와 밝기
- Profile 1~5별 LED 색상
- 효과에 Key Depth 또는 Typing Speed 반영
- RGB 직접 색상 입력
- 효과 그룹과 확인된 예시:
  - Wave: Band Saturation
  - Rainbow: Circle Left/Right
  - Touch: Heat Map
  - Breath: Breathing
  - Random: Raindrops
  - Basic: Solid Color
- RGB 절전 켜기/끄기
- 미사용 시 자동 밝기 감소 시간
- 자동 꺼짐 시간
- 실시간 13개 LED RGB 쓰기(`0x27`, 직접 API에서 검증)

UI에는 이 외에도 여러 효과 선택 버튼이 있었으나 접근성 이름이 비어 있어 이름을
추측하지 않았다. 직접 프로토콜의 `0x26`은 설정 블록, `0x27`은 즉시 13개 RGB
값으로 관찰됐다.

### 4.8 LCD

- LCD 메인 배경화면
- 화면 보호기
- LCD 절전 끄기
- LCD 밝기
- 단일 이미지 선택/업로드
- JPG, PNG, GIF
- UI 권장 크기 `240 × 135`
- UI 파일 제한 `200KB`
- 키 카운터 방향: 수평/수직
- 키 카운트 방식: 단일/전체
- 시작/메인/절전 화면 계열
- 실시간 프레임버퍼 읽기/쓰기(`0x25`)

`0x25` 실시간 전송은 플래시 이미지 업로드와 다르다. 현재 음악 앱은 매 프레임을
RAM으로 보낼 뿐 사용자 이미지 자산을 저장하지 않는다.

### 4.9 장치 설정/유지보수

- 멀티 샘플링
- 속도/정확도
- 1K/2K/4K/8K 폴링레이트
- 전체 키 보정
- Factory Reset
- RGB 절전, 자동 어두워짐, 자동 꺼짐
- Firmware History
- Driver History
- 사용 가이드
- 펌웨어 현재/최신 버전 조회
- 부트로더 검색/전환 안내
- 펌웨어 업데이트

테스트 장치에서 현재 버전과 최신 버전은 모두 `1.4.38`로 표시됐다. 펌웨어
업데이트와 공장 초기화는 실제 장치 상태를 영구 변경할 수 있어 실행하지 않았다.

## 5. 직접 접근 가능한 API 전체 목록

XPAD Mini의 `Info` 기록에 포함된 모든 API v2 명령과 `Info` 자체다.

| 명령 | 알려진 동작 | 읽기 | 쓰기 | 지속성/위험 | 확인 상태 | 현재 앱 |
|---:|---|:---:|:---:|---|---|:---:|
| `0x00` | `Info`: 모델, 펌웨어, 상태, 지원 명령 | O | - | 안전 | 실기기/상위 | - |
| `0x01` | `DeviceName`: 장치 이름 | O | O | Save 시 영구 가능 | 상위 + 지원 | - |
| `0x02` | `ScreenInfo/SystemInfo`: LCD/VID/PID/클럭, 프로필 선택 | O | O | `cfg_selection` RAM 전환 | **실기기/공식 UI** | **O** |
| `0x03` | `Setting`/장치 옵션, 40바이트 관찰 | O | O 추정 | Save 시 영구 가능 | 실기기 부분 | - |
| `0x05` | `DeviceLock` | O 추정 | O 추정 | 잠금 위험 | 상위 + 지원 | - |
| `0x0D` | `Save`: RAM 설정을 비휘발성 저장 | - | O | **영구** | 상위 + 지원 | - |
| `0x0E` | `SysControl`: 시스템 제어 계열 | O 추정 | O | 재부팅 가능 | 상위 + 지원 | - |
| `0x10` | `KeyInfo`: 키/노브 매핑 | O | O | 즉시 입력 변경, Save 가능 | **실기기** | **제한적 O** |
| `0x15` | `MagneticDepth`: 자석축 깊이/센서 | O 추정 | O 추정 | 설정 변경 | 상위 + 지원 | - |
| `0x16` | `Password` | O | O | 보호/저장 위험 | 상위 + 지원 | - |
| `0x17` | GBK/ASCII 텍스트 자산 | O | O | 자산 저장 가능 | 상위 + 지원 | - |
| `0x18` | UTF-16 텍스트 자산 | O | O | 자산 저장 가능 | 상위 + 지원 | - |
| `0x19` | 스크립트 이름/미리보기 | O | O | Save 가능 | 상위 명칭 차이 | - |
| `0x1A` | 스크립트 데이터/단계 | O | O | Save 가능 | 상위 명칭 차이 | - |
| `0x1C` | 의미 미확인 | ? | ? | 미확인 | **지원만 확인** | - |
| `0x1D` | 의미 미확인 | ? | ? | 미확인 | **지원만 확인** | - |
| `0x1E` | `KeyStatus` | O | 미확인 | 상태 조회 추정 | 상위 + 지원 | - |
| `0x1F` | `KeyData`: 센서/키 데이터 | O | 미확인 | 상태 조회 추정 | 상위 + 지원 | - |
| `0x20` | `Image`: 이미지 자산 | O | O | 플래시 연관 | 상위 + 지원 | - |
| `0x21` | `ScreenStart`: 시작 화면 | O | O | Save/자산 가능 | 상위 + 지원 | - |
| `0x22` | `ScreenMain`: 메인 화면 | O | O | Save/자산 가능 | 상위 + 지원 | - |
| `0x23` | `ScreenSleep`: 절전 화면 | O | O | Save/자산 가능 | 상위 + 지원 | - |
| `0x25` | `Display`: LCD 프레임버퍼 | O | O | Save 없이는 RAM | **실기기** | **O** |
| `0x26` | LED 설정 블록 | O | O | Save 가능 | 실기기 부분 | - |
| `0x27` | 13개 주소 지정 LED 즉시 RGB | O | O | Save 없이는 RAM | **실기기** | - |
| `0x28` | 밝기/감마 LUT 추정 | O | O 추정 | Save 가능 | 실기기 부분 | - |
| `0x2A` | 의미 미확인 | ? | ? | 미확인 | **지원만 확인** | - |
| `0x2B` | 플래시 이미지 자산 테이블 | O | 쓰기 미확인 | 플래시 연관 | 실기기 부분 | - |

`O 추정`은 같은 계열 Sayo 구현의 관례를 뜻할 뿐, XPAD Mini에서 안전한 호출을
보장하지 않는다. `0x1C`, `0x1D`, `0x2A`는 이름을 만들어내지 않고 미확인으로
남긴다.

일반 Sayo API v2의 `0x11 Light`, `0x12 Palette`, `0x14 MagneticTrigger`는
XPAD Mini의 위 지원 목록에 없다. 다른 SayoDevice의 명령을 그대로 보내면 안 된다.

### 5.1 제어 영역과 명령 매핑

| 제어 영역 | 관련 명령 | 직접 제어 판정 | 비고 |
|---|---|---|---|
| 장치/펌웨어 정보 | `0x00`, `0x02` | 읽기 가능, 구조 확인 | 모델, 버전, LCD, VID/PID |
| 장치 이름 | `0x01` | 읽기/쓰기 가능성 높음 | XPAD 쓰기 페이로드는 미검증 |
| 전역 장치 옵션 | `0x03` | 읽기 일부 확인 | 40바이트 구조 미해석 |
| 장치 잠금 | `0x05`, `0x16` | 지원 확인 | 잘못 쓰면 잠금 위험 |
| 영구 저장 | `0x0D` | 지원 확인 | 현재 앱 금지 |
| 재부팅/시스템 제어 | `0x0E` | 지원 확인 | 세부 opcode 미확인 |
| 키/노브 매핑 | `0x10` | **읽기/쓰기 실기기 확인** | 엔트리 56바이트 |
| 자석축 깊이/센서 | `0x15`, `0x1E`, `0x1F` | 이름/지원 확인 | 보정·작동점과 정확한 대응 미확인 |
| 고급 키 | `0x1C`, `0x1D` 가능성 | **매핑 미확인** | ID 의미를 단정하지 않음 |
| 매크로/스크립트 | `0x19`, `0x1A` | 상위 구조/지원 확인 | XPAD 전체 페이로드 미해석 |
| 텍스트 자산 | `0x17`, `0x18` | 상위 구조/지원 확인 | GBK/ASCII, UTF-16 계열 |
| 이미지 자산 | `0x20`, `0x2B` | 읽기 일부 확인 | 플래시 쓰기 형식 미확인 |
| 시작/메인/절전 화면 | `0x21`, `0x22`, `0x23` | 상위 구조/지원 확인 | 레이어/저장 구조 미해석 |
| LCD 실시간 화면 | `0x25` | **읽기/쓰기 실기기 확인** | RGB565 RAM 프레임버퍼 |
| LED 효과/설정 | `0x26`, `0x28` | 읽기 일부 확인 | 필드 전체 미해석 |
| 13개 LED 즉시 색 | `0x27` | **읽기/쓰기 실기기 확인** | 52바이트 RGB 배열 |
| 프로필 | `0x02 SystemInfo.cfg_selection` + `0x10 KeyInfo` | **P1~P5 RAM 선택·P2~P5 읽기 확인** | 재생 화면은 P1~P5를 직접 선택하고, 키보드 설정은 P1을 고정값으로 보호해 P2~P5만 읽은 뒤 원래 프로필을 readback 검증해 복원. Save 미사용 |
| 게임패드 설정 | `0x03`, 키/센서 계열 가능성 | **매핑 미확인** | UI 기능은 확인, 명령 대응 미확인 |
| Factory Reset | 시스템 제어 계열 가능성 | **매핑 미확인** | 실행하지 않음 |
| 펌웨어/부트로더 | 별도 부트로더/v1 경로 | **저수준 미확인** | 공식 UI만 권장 |

“가능성”으로 쓴 항목은 UI 동작과 지원 명령 목록을 함께 본 추론이다. 패킷 캡처나
실기기 쓰기 검증이 없으므로 확정 API로 취급하지 않는다.

## 6. API v1에서 가능한 명령군과 경계

Usage Page `0xFF00`의 Sayo API v1 공통 자료에는 다음 명령군이 있다.

- 메타 정보
- 메모리 읽기/쓰기
- 설정 저장
- 단순 키/키 매핑
- 장치 이름
- 암호와 텍스트
- LED와 팔레트
- 시작/메인/절전 화면
- 옵션
- 부트로더 전환

이 목록은 Sayo O3C 상위 자료이며 XPAD Mini에서 전체 검증하지 않았다.
`MemoryWrite`, `Save`, `Bootloader`는 장치를 복구하기 어렵게 만들 수 있어 현재
앱은 `0xFF00` 채널 자체를 열지 않는다.

## 7. 현재 음악 앱의 실제 사용 범위

| 단계 | 동작 | 코드 |
|---:|---|---|
| 1 | VID/PID/`0xFF12` 탐색 | [`hid.ts`](../src/main/device/hid.ts) |
| 2 | 벌크 HID 핸들 열기 | [`hid.ts`](../src/main/device/hid.ts) |
| 3 | `0x02`로 `240 × 135`와 실제 활성 프로필 확인 | [`protocol.ts`](../src/main/device/protocol.ts) |
| 4 | 재생 화면 요청 시 P1~P5 RAM 선택 후 SystemInfo readback 검증 | [`device-worker.ts`](../src/main/device/device-worker.ts) |
| 5 | `0x10`으로 노브 좌/우 원본 백업 후 F20/F19 임시 적용 | [`protocol.ts`](../src/main/device/protocol.ts) |
| 6 | Apple Music/Spotify 현재 곡 읽기 | [`now-playing.ts`](../src/main/music/now-playing.ts) |
| 7 | 화면 렌더링/RGB565 변환 | [`frame-renderer.ts`](../src/main/display/frame-renderer.ts) |
| 8 | `0x25`로 변경 청크 RAM 전송 | [`protocol.ts`](../src/main/device/protocol.ts) |
| 9 | 비활성화/정상 종료 시 노브 원복, 분리 시 3초마다 재연결 | [`device-worker.ts`](../src/main/device/device-worker.ts) |

현재 앱이 하지 않는 것:

- 키보드/마우스/게임패드 컬렉션 열기
- 노브 좌/우 외 키맵, 노브 클릭, 매크로, 자석축 설정 변경
- LED 변경
- `0x0D Save`
- 플래시 이미지 쓰기
- 공장 초기화
- 펌웨어 업데이트/부트로더 전환

## 8. 네이티브 연결 코드 예

### 장치 열기

```ts
import HID from 'node-hid';

const info = HID.devices().find(
  (device) =>
    device.vendorId === 0x3710 &&
    device.productId === 0x2507 &&
    device.usagePage === 0xff12 &&
    device.usage === 0x02
);

if (!info?.path) throw new Error('XPAD Mini bulk HID를 찾지 못했습니다.');
const device = new HID.HID(info.path, { nonExclusive: true });
```

### LCD 프레임 청크 전송

```ts
const maxPixelBytes = 1024 - 12;

for (let offset = 0; offset < frame.length; offset += maxPixelBytes) {
  const pixels = frame.subarray(offset, offset + maxPixelBytes);
  const payload = Buffer.alloc(4 + pixels.length);
  payload.writeUInt32LE(offset, 0);
  pixels.copy(payload, 4);
  device.write(buildPacket(0x25, payload));
}
```

완전한 패킷 구조와 체크섬은 [PROTOCOL.md](./PROTOCOL.md)에 있다.

## 9. 로컬 확인 명령

장치 식별만 수행:

```bash
cd /path/to/XPAD-mini-Led
node tools/hid-enum.js
```

`ScreenInfo` 읽기 요청:

```bash
node tools/probe-screeninfo.js
```

HID를 열지 않고 앱 미리보기:

```bash
XPAD_DISABLE_HID=1 npm run start
```

Bibimbap이나 앱이 장치를 사용 중일 때는 프로브를 동시에 실행하지 않는다.

## 10. macOS 권한

### USB HID

- 네이티브 앱은 브라우저 장치 선택 창을 사용하지 않는다.
- `node-hid`는 macOS IOHIDManager 백엔드를 사용한다.
- XPAD Mini는 키보드를 포함한 복합 HID이므로 `nonExclusive: true`로 벌크
  컬렉션을 연다. macOS는 최초 접근 시 입력 모니터링 승인을 요구할 수 있다.
- 설치 앱은 `시스템 설정 → 개인정보 보호 및 보안 → 입력 모니터링`에
  `XPAD Mini Now Playing.app`을 추가하고 스위치를 켠 뒤 다시 실행한다.
- 권한은 서명과 앱 경로에 연결되므로 개인 `Developer ID Application` 인증서로
  서명한 앱을 `/Applications`에 설치한 후 허용한다.
- 열기 실패 시 다른 앱/브라우저의 점유 여부를 확인한다.
- 패키지 CPU 아키텍처와 `node-hid` 네이티브 모듈 아키텍처가 맞아야 한다.

### 음악 메타데이터

- Apple Music/Spotify 정보는 HID가 아닌 각 앱의 AppleScript 인터페이스에서 읽는다.
- 최초 실행 시 macOS가 음악 앱 자동화 권한을 요청할 수 있다.
- 권한을 거부하면 HID 연결은 가능해도 곡 정보가 표시되지 않을 수 있다.

## 11. 안전 등급과 복구

| 등급 | 동작 | 예 | 복구 |
|---|---|---|---|
| 낮음 | 식별/상태 읽기 | HID 열거, `Info`, `ScreenInfo` | 불필요 |
| 낮음~중간 | RAM 화면 쓰기 | `0x25 Display` | 앱 종료/USB 재연결 |
| 중간 | RAM LED 쓰기 | `0x27` | 프로필 전환/USB 재연결 |
| 높음 | RAM 키맵 쓰기 | `0x10` 쓰기 | 입력 즉시 변경, 재연결 필요 가능 |
| 매우 높음 | 영구 저장/플래시 | `Save`, 이미지 자산 | 공식 복원/초기화 필요 가능 |
| 위험 | 메모리/부트로더/펌웨어 | v1 MemoryWrite, Bootloader | 복구 불가 가능 |

문제가 생기면 다음 순서로 복구한다.

1. 네이티브 앱과 Bibimbap 탭을 종료한다.
2. XPAD Mini USB를 분리했다 다시 연결한다.
3. 공식 Bibimbap에서 프로필과 장치 상태를 확인한다.
4. 영구 변경은 공식 백업/복원 또는 Factory Reset 절차를 사용한다.
5. 펌웨어/부트로더 문제에는 임의 명령을 더 보내지 않는다.

## 12. 확인하지 못한 사항

- `0x1C`, `0x1D`, `0x2A`의 이름과 페이로드
- `0x26`, `0x28`, `0x2B`의 모든 필드
- 고급 키 `US`의 정확한 풀네임과 모든 바이너리 구조
- XPAD Mini 펌웨어 버전별 프로토콜 호환성
- Bibimbap 펌웨어 업데이트/부트로더 전용 저수준 프로토콜
- JPG/PNG/GIF의 플래시 저장 내부 포맷
- 모든 오류 상태 코드

이 항목은 추측해 구현하지 않는다.

## 13. 참고 사이트와 소스

### Pulsar

- Bibimbap Web DRV: <https://bbb.pulsar.gg/sKey/>
- XPAD Mini 제품 페이지:
  <https://us.pulsar.gg/products/pulsar-lab-xpad-mini-gaming-key-pad>
- XPAD Mini 시작 가이드:
  <https://www.youtube.com/watch?v=9AwvtgS0QqI>

### 프로토콜/공개 구현

- SayoGroup `SayoDeviceStreamingAssistant`:
  <https://github.com/SayoGroup/SayoDeviceStreamingAssistant>
- `SayoHid.cs` 고정 커밋:
  <https://github.com/SayoGroup/SayoDeviceStreamingAssistant/blob/bdad1a3913be09252a3d289aee3b3f9486c9dbf7/SayoDeviceStreamingAssistant/Sources/SayoHid.cs>
- Sayo O3C 역공학 노트:
  <https://gist.github.com/khang06/6186543b560548370ce7cc08cad7f710>
- XPAD Mini 초기 실기기 실험 저장소:
  <https://github.com/SpinnerMaster/xpad-mini-claude-code>

### HID API

- `node-hid`: <https://github.com/node-hid/node-hid>
- WebHID 사양: <https://wicg.github.io/webhid/>
- Apple IOHIDManager:
  <https://developer.apple.com/documentation/iokit/iohidmanager_h>
