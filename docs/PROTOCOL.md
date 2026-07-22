# Pulsar Lab XPAD Mini 저수준 HID 프로토콜

문서 상태: **역공학 자료 / 실기기 일부 검증**

대상: VID `0x3710`, PID `0x2507`

최종 대조일: 2026-07-21

이 문서는 XPAD Mini의 벤더 HID 채널과 Sayo API v2 패킷을 바이트 단위로
정리한다. 사용자 관점의 실제 제어 기능 전체 목록은
[직접 연결 및 제어 기능 전체 가이드](./XPAD_MINI_DIRECT_API.md)를 참고한다.

## 1. 근거와 한계

다음 자료를 서로 대조했다.

1. 연결된 XPAD Mini의 `node-hid` 열거 및 프로브 결과
2. Bibimbap Web DRV: <https://bbb.pulsar.gg/sKey/>
3. Pulsar 제품 페이지:
   <https://us.pulsar.gg/products/pulsar-lab-xpad-mini-gaming-key-pad>
4. SayoGroup의 `SayoHid.cs`:
   <https://github.com/SayoGroup/SayoDeviceStreamingAssistant/blob/bdad1a3913be09252a3d289aee3b3f9486c9dbf7/SayoDeviceStreamingAssistant/Sources/SayoHid.cs>
5. Sayo O3C 역공학 노트:
   <https://gist.github.com/khang06/6186543b560548370ce7cc08cad7f710>
6. 초기 XPAD Mini 실험 저장소:
   <https://github.com/SpinnerMaster/xpad-mini-claude-code>

Pulsar가 공개한 네이티브 SDK/명령 사양서는 찾지 못했다. **실기기 확인**으로
표시하지 않은 구조는 같은 계열 Sayo API에서 얻은 상위 근거다.

## 2. 장치 정보

| 필드 | 값 | 근거 |
|---|---:|---|
| 제조사 | `Pulsar` | 실기기 HID 열거 |
| 제품명 | `Pulsar Lab Xpad Mini` | 실기기 HID 열거 |
| VID | `0x3710` | HID 열거/ScreenInfo |
| PID | `0x2507` | HID 열거/ScreenInfo |
| 모델 코드 | `0x23` (35) | 과거 실기기 Info 기록 |
| LCD | `240 × 135`, 60 Hz | 실기기 ScreenInfo 기록 |
| 픽셀 형식 | RGB565 little-endian | 프레임 쓰기/읽기 검증 |
| 프레임 크기 | 64,800바이트 | `240 × 135 × 2` |
| 주소 지정 LED | 13개 | `0x27` 읽기/쓰기 검증 |

Pulsar 마케팅 자료 일부의 136행 표기와 달리 펌웨어 응답과 프레임버퍼는
135행이었다. 직접 전송에는 135를 사용한다.

## 3. HID 채널

| Usage Page | Usage | Report ID | 크기 | 용도 |
|---:|---:|---:|---:|---|
| `0xFF00` | `0x01` | `0x02` | 64 | Sayo API v1 레거시 설정 |
| `0xFF11` | `0x02` | `0x21` | 64 | API v2 저속 |
| `0xFF12` | `0x02` | `0x22` | 1024 | API v2 고속/벌크 |

현재 앱은 `0xFF12`만 연다. 키보드, 마우스, 게임패드, Consumer Control
컬렉션은 열지 않는다.

macOS에서는 장치 전체가 키보드를 포함한 복합 HID로 분류되므로 `node-hid`의
`nonExclusive: true` 옵션으로 이 컬렉션을 연다. 최초 접근 시 입력 모니터링
권한 승인이 필요할 수 있다.

## 4. API v2 패킷

### 4.1 한 명령 패킷

```text
오프셋  크기  필드
0       1     report_id: 고속 0x22, 저속 0x21
1       1     echo: 응답에서 되돌아오는 클라이언트 태그
2       2     checksum: u16 little-endian
4       2     length: u16 little-endian = payload 길이 + 4
6       1     command
7       1     index
8       n     payload
나머지        0 패딩
```

Sayo 상위 자료에는 한 리포트에 여러 명령 블록을 이어 붙이는 형태도 있다. 이
프로젝트는 한 리포트에 한 명령만 사용한다.

### 4.2 `echo`와 `index`

- `echo`는 클라이언트 태그이며 응답에 반영된다.
- 웹 UI 기록에서는 `0x03`, Sayo 스트리밍 코드와 현재 앱은 `0x04`를 사용한다.
- `index`는 응답 상관관계 또는 항목 선택에 사용된다.
- `0x10 KeyInfo`에서는 헤더 `index`가 엔트리 번호다.

### 4.3 체크섬

1. 체크섬 필드를 0으로 둔다.
2. 사용 길이 `8 + payload.length`가 홀수면 0을 한 바이트 패딩한다.
3. 처음부터 16비트 little-endian 워드로 읽어 모두 더한다.
4. 하위 16비트를 오프셋 2에 little-endian으로 쓴다.

```ts
function checksum(packet: Buffer, payloadLength: number): number {
  const usedLength = 8 + payloadLength + (payloadLength % 2);
  let sum = 0;
  for (let offset = 0; offset < usedLength; offset += 2) {
    sum = (sum + packet.readUInt16LE(offset)) & 0xffff;
  }
  return sum;
}
```

현재 구현은 [`src/main/device/protocol.ts`](../src/main/device/protocol.ts)에 있다.

### 4.4 응답 판정

- Report ID, `echo`, `command`, `index`를 요청과 대조한다.
- `length <= 4`이면 유효 페이로드가 없다.
- 미지원/오류 응답에서 길이 필드 상위 바이트 `0xFC`가 관찰됐지만 전체 상태
  코드 표는 확인하지 못했다.
- LCD/LED 스트리밍 중 설정 읽기를 병행하면 응답이 섞일 수 있으므로 설정 조회
  시 스트리밍을 멈춘다.

## 5. 검증된 API v2 명령

### 5.1 `0x00 Info`

빈 페이로드로 읽는다.

```text
payload+0x00  u16    model_code
payload+0x02  u16    firmware_version
payload+0x04  u8[4]  미확인
payload+0x08  u8     battery
payload+0x09  u8     fn
payload+0x0A  u8     cpu_s
payload+0x0B  u8     cpu_ms
...                  추가 정보와 지원 명령 목록
```

XPAD Mini 실기기 기록의 지원 명령:

```text
01 02 03 05 0D 0E 10 15 16 17 18 19 1A 1C 1D 1E 1F 20 21 22 23 25 26 27 28 2A 2B
```

`0x00` 자체는 정보 조회 진입점이라 목록에서 생략될 수 있다.

### 5.2 `0x02 ScreenInfo/SystemInfo`

요청 페이로드는 비어 있다. 응답 패킷 오프셋:

```text
8   u16  width
10  u16  height
12  u8   refresh_rate
13  u8   `cfg_range:4 | cfg_selection:4`
14  u16  sys_ms
16  u32  sys_s
20  u16  vid
22  u16  pid
24  u8   cpu_load_1m
25  u8   cpu_load_5m
26  u16  padding
28  u32  cpu_freq
32  u32  hclk_freq
36  u32  pclk1_freq
40  u32  pclk2_freq
44  u32  adc0_freq
48  u32  adc1_freq
```

실기기 기록: `240 × 135 @ 60 Hz`, VID `0x3710`, PID `0x2507`.
`cfg_range`는 상위 4비트로 XPAD Mini에서 `5`, `cfg_selection`은 하위 4비트의
0-base 프로필 번호다. 예를 들어 Profile 1은 `0x50`, Profile 2는 `0x51`이다.

공식 Bibimbap은 현재 44바이트 SystemInfo에서 `cfg_selection`만 바꿔 같은 `0x02`로
전송한 뒤 설정을 다시 읽는다. 현재 앱도 이 방식을 RAM 전환으로만 사용한다. 키보드 설정
조회에서는 활성 프로필을 기억하고 편집 대상인 P2~P5의 KeyInfo를 읽은 다음 원래 프로필로
복원한다. 재생 화면의 P1~P5 단축 버튼은 선택한 값을 직접 전송한다. 모든 전환과 최종 복원은
SystemInfo readback으로 검증하며, 성공한 뒤에만 화면 선택 상태와 F16~F18 로컬 라우터를
갱신한다. P1의 하단 KeyInfo는 읽지 않고 고정 음악 제어값을 표시하지만, 실제 P1 프로필
선택 자체는 같은 `0x02` 경로를 사용한다. `0x0D Save`는 보내지 않는다.

### 5.3 `0x25 Display`

읽기:

```text
요청 payload  = u32 byte_offset
응답 payload  = u32 byte_offset + RGB565 데이터
```

쓰기:

```text
요청 payload  = u32 byte_offset + RGB565 데이터
```

- 고속 채널의 픽셀 데이터 최대치는 `1024 - 12 = 1012`바이트다.
- 64,800바이트 프레임은 최대 65개 청크다.
- RGB565 16비트 값은 little-endian이다.
- 쓰면 즉시 LCD에 나타난다.
- `0x0D Save`를 보내지 않으면 현재 앱의 화면 쓰기는 RAM 동작이다.
- 읽기/쓰기/재구성은 과거 `tools/readback.js` 실험에서 검증됐다.
- 현재 앱은 변경 청크만 보내고 주기적으로 전체 프레임을 다시 보낸다.

```ts
const rgb565 = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
output.writeUInt16LE(rgb565, pixelIndex * 2);
```

### 5.4 `0x27` 주소 지정 LED

```text
읽기 요청  = 빈 payload
읽기 응답  = 13 × [R, G, B, 0] = 52바이트
쓰기 요청  = 13 × [R, G, B, 0] = 정확히 52바이트
```

- 0~2: 왼쪽/가운데/오른쪽 키 LED
- 3~12: 오른쪽에서 왼쪽 방향 라이트 바
- 13개보다 많은 엔트리는 실기기에서 거부됐다.
- 즉시 적용되어 펌웨어 효과를 덮어 보이게 할 수 있다.
- 프로필 전환 또는 USB 재연결로 기본 효과가 돌아왔다.
- 현재 음악 앱은 이 명령을 구현하거나 호출하지 않는다.

### 5.5 `0x10 KeyInfo`

- 헤더 `index`로 엔트리를 선택한다.
- 읽기: 빈 페이로드, 응답 56바이트.
- 쓰기: 같은 56바이트 엔트리.
- Save가 없어도 입력 동작이 즉시 달라질 수 있어 고위험이다.
- 현재 앱에서 확인한 Profile 1 노브 방향 엔트리는 오른쪽 `14`, 왼쪽 `15`다.

```text
0   u32  엔트리/입력 클래스 (노브 방향 실기기 값 1, 앱은 보존)
4   u16  site_x
6   u16  site_y
8   u16  width
10  u16  height
12  u16  미확인, 실기기 값 100
14  u16  padding/미확인
16  u32  출력 타입 (0 = keyboard, 3 = extended/media)
20  u8   출력 데이터 0 (keyboard modifier 또는 extended action)
21  u8   출력 데이터 1 (keyboard USB HID usage)
22  u8   출력 데이터 2
23  u8   출력 데이터 3
```

| modifier | 키 |
|---:|---|
| `0x01` | Left Ctrl |
| `0x02` | Left Shift |
| `0x04` | Left Alt |
| `0x08` | Left GUI/Windows/Command |

실기기 엔트리 0~2는 왼쪽/가운데/오른쪽 자석축 키였고 출고 기록의 키코드는
`Q/W/E`였다. 노브 출고 동작은 출력 타입 `3`, 왼쪽 action `11`(Vol-), 오른쪽
action `10`(Vol+)였고, keyboard 출력은 타입 `0`과 `[modifier, usage, 0, 0]`으로
표현된다.

현재 앱은 키보드 설정 창을 열 때 각 프로필의 엔트리 0/1/2를 읽기 전용으로 조회한다.
엔트리 15/14의 원본 56바이트는 먼저 읽어 설정 파일에 백업하고,
출력 타입/데이터만 각각 F20/F19로 바꾼다. 쓰기 후 같은 출력 동작인지 readback으로
검증하며, 설정 비활성화와 정상 종료 때 원래 Vol-/Vol+ 엔트리로 복원한다. 노브 클릭과
하단 키 엔트리는 쓰지 않으며 `0x0D Save`도 보내지 않는다.

## 6. 부분 확인 또는 의미 미확인 명령

| 명령 | 관찰/상위 명칭 | 확인 수준 |
|---:|---|---|
| `0x01` | DeviceName, Sayo 자료에서는 12개 유니코드 슬롯 | 상위 + XPAD 지원 |
| `0x03` | Setting, 실기기 읽기 40바이트 | 실기기 부분 |
| `0x05` | DeviceLock | 이름만 확인 |
| `0x0D` | Save | 고위험, 호출 안 함 |
| `0x0E` | SysControl | 의미 일부, 호출 안 함 |
| `0x15` | MagneticDepth | 이름만 확인 |
| `0x16` | Password | 이름만 확인 |
| `0x17` | GBK/ASCII 텍스트 | 이름만 확인 |
| `0x18` | UTF-16 텍스트 | 이름만 확인 |
| `0x19` | ScriptPreview/스크립트 이름 | 상위 자료 명칭 차이 |
| `0x1A` | ScriptStep/스크립트 데이터 | 상위 자료 명칭 차이 |
| `0x1C` | 의미/페이로드 미확인 | 지원만 확인 |
| `0x1D` | 의미/페이로드 미확인 | 지원만 확인 |
| `0x1E` | KeyStatus | 이름만 확인 |
| `0x1F` | KeyData/센서 데이터 | 이름만 확인 |
| `0x20` | Image 자산 | 이름만 확인 |
| `0x21` | 시작 화면 설정 | 이름만 확인 |
| `0x22` | 메인 화면 설정 | 이름만 확인 |
| `0x23` | 절전 화면 설정 | 이름만 확인 |
| `0x26` | LED 설정 블록. 끝에 `0x7296` 두 번 관찰 | 실기기 부분 |
| `0x28` | 밝기/감마 LUT 추정 | 실기기 부분 |
| `0x2A` | 의미/페이로드 미확인 | 지원만 확인 |
| `0x2B` | 플래시 이미지 자산 테이블, 다중 패킷 | 실기기 부분 |

일반 Sayo v2의 `0x11 Light`, `0x12 Palette`, `0x14 MagneticTrigger`는 XPAD
Mini의 지원 목록에 없다.

## 7. API v1

`0xFF00`은 64바이트 레거시 채널이다. 기본 읽기 요청의 관찰 형식:

```text
report_id  0x02
command    1바이트
size       1바이트, 기본 읽기 값 2
method     1바이트, 0 = read
id         1바이트
checksum   앞선 데이터 합에 2를 더한 하위 8비트
```

Sayo O3C 자료의 공통 v1 명령에는 MetaInfo, MemoryRead, MemoryWrite, Save,
SimpleKey, DeviceName, Password, Text, Light, Palette, Key, 화면 설정,
Bootloader가 있다. XPAD Mini에서 전체 검증하지 않았다. MemoryWrite, Save,
Bootloader는 브릭 위험이 있어 현재 앱은 v1 채널을 열지 않는다.

## 8. 현재 앱의 최소 프로토콜

1. VID/PID와 `0xFF12`로 벌크 채널 탐색
2. `0x02 ScreenInfo`로 `240 × 135`와 실제 활성 프로필 확인
3. 재생 화면 요청 시 `0x02 SystemInfo`로 P1~P5를 RAM 전환하고 readback 검증
4. `0x10 KeyInfo`로 노브 좌/우 원본을 백업하고 F20/F19를 RAM에 임시 적용
5. `0x25 Display`로 RGB565 프레임을 RAM 전송
6. 비활성화/정상 종료 시 노브 원본을 복원하고, 분리 시 3초 간격으로 재탐색

구현:

- [`src/main/device/hid.ts`](../src/main/device/hid.ts)
- [`src/main/device/protocol.ts`](../src/main/device/protocol.ts)
- [`src/main/device/device-worker.ts`](../src/main/device/device-worker.ts)

현재 앱 코드에는 Save, LED, 일반 키맵 쓰기, 플래시, 부트로더 명령 상수가 없다.
KeyInfo 쓰기는 위 노브 좌/우 RAM 임시 매핑 범위에서만 사용한다. 하단 키 엔트리 0~2는
프로필별 실제 표시를 위해 읽기만 한다.

2026-07-22 키보드 설정 UI는 `cfg_selection` RAM 전환으로 Profile 2~5의 하단 3버튼
실제 KeyInfo를 읽고 조회 전 프로필로 복원한다. 제품 정책상 Profile 1은 장치 KeyInfo 조회
대상에서 제외하고 이전 곡·재생/일시정지·다음 곡으로 정규화해 보기 전용으로 고정한다.
재생 화면에서는 P1~P5를 직접 선택하고 readback 성공 후 선택 강조·세 키 요약·F16~F18
action router의 활성 프로필을 함께 갱신한다. Profile 2~5만 로컬 편집·사용자 백업 대상으로
사용한다. 해석하지 못한 KeyInfo는 오류 코드 없이 `미지원`으로 표시한다. 일반 키 쓰기 전체 rollback은 아직 구현하지 않았으므로
`장치에 적용`은 비활성화되어 있다. 일반 키 `KeyInfo` 쓰기는 없으며, 기존 노브 엔트리
15/14와 F20/F19 처리도 변경하지 않았다.
