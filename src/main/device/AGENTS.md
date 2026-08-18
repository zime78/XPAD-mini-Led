<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-18 | Updated: 2026-08-18 -->

# device

## Purpose

XPAD Mini(VID `0x3710`, PID `0x2507`) HID I/O와 최소 Sayo API v2 클라이언트. main 스레드는 `DeviceHost`만 보고, 실제 쓰기는 worker에서만 한다.

## Key Files

| File | Description |
|------|-------------|
| `device-host.ts` | main 프록시. 프레임/노브/프로필/키맵 중계. `lastLcdDrawMs`는 `lcdStats` 지수평균. YouTube 자동 주기와 베젤 전송 간격의 입력 |
| `device-worker.ts` | 장이 바뀌면 전송 직후 최신 장. 유휴 220ms 재전송. 전송 후 `lcdStats`. KeyInfo 중 LCD 일시 정지 |
| `hid.ts` | vendor bulk만 연다(usage page `0xFF12`, usage `0x02`). `nonExclusive: true` 필수. 3초 재연결, write 실패 5회로 분리 판정 |
| `protocol.ts` | `0x02` ScreenInfo/SystemInfo(240×135, `cfg_selection` P1–P5), `0x25` RGB565 청크(diff, 300프레임 풀, 250ms keep-alive), `0x10` KeyInfo. `LCD_WIDTH`/`LCD_HEIGHT` |
| `protocol.test.ts` | 프로필 인덱스·키 엔트리 순수 로직 |
| `keyboard-profile-codec.ts` | 56바이트 KeyInfo ↔ `KeyboardAction`. 슬롯 인덱스 left=0, center=1, right=2와 F16–F18 usage |
| `keyboard-profile-codec.test.ts` | encode/decode 라운드트립 |

## Subdirectories

없음.

## For AI Agents

### Working In This Directory

- **허용 명령:** `0x02`(cfg_selection만 쓰기, readback 성공 후 상태 갱신), `0x10`(P1 노브 15/14와 P2–P5 하단 슬롯의 RAM 임시 매핑만), `0x25`(프레임).
- **금지:** Save `0x0D`, MemoryWrite, LED, 부트로더, 키보드 HID 컬렉션, 노브 클릭(12), 다른 키 엔트리, 물리 엔트리 메타데이터 변경.
- `0x10`은 원본 56바이트 백업·readback·비활성화/종료 복원이 필수다.
- LCD는 240×**135**. 마케팅 136을 코드/패킷에 넣지 않는다.
- 지식 변경 시 `docs/PROTOCOL.md`를 같은 PR에서 고친다.
- HID는 한 프로세스만. 설치 앱이 잡고 있으면 `./build.sh stop` 후 실기기 검증.

### Testing Requirements

- `npm test` — codec/protocol 단위 테스트
- 프로토콜 변경은 실기기에서 연결·프레임 유지·프로필 전환·종료 원복을 확인한다.

### Common Patterns

- 패킷 1024바이트 + 16비트 체크섬, report id `0x22`
- 노브 좌=index 15→F20, 우=index 14→F19. 기본 Vol-/Vol+로 복원
- P2–P5 하단 앱 실행 슬롯은 F16/F17/F18 RAM 매핑

## Dependencies

### Internal

- `../../shared/types.ts`
- `docs/PROTOCOL.md` (권위), `docs/XPAD_MINI_DIRECT_API.md` (전체 지도)

### External

- `node-hid`

<!-- MANUAL: -->
