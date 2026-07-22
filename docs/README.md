# XPAD Mini 기술 문서

이 폴더는 Pulsar Lab XPAD Mini를 웹브라우저 없이 직접 USB HID로 연결하는
방법과, 현재까지 확인된 API 및 실제 제어 기능을 정리한다.

## 문서 목록

- [키보드 설정 및 macOS 앱 실행 기능 계획·구현 현황](./plan/keyboard-settings/PLAN.md)
  - 재생 창 키보드 아이콘과 전용 설정 창 GUI 시안
  - Profile 1 고정 음악 제어와 Profile 2~5 하단 키의 음악 제어/앱 실행 UX
  - 이름·설명을 갖는 사용자 백업 최대 10개와 정확 복원 계약
  - 하단 물리 버튼 3개만 수정하고 기존 볼륨·노브 기능은 변경하지 않는 비간섭 계약
  - 일반 키·프로파일 RAM 매핑의 안전 승인 게이트와 단계별 구현·검증 계획
- [현재 개발 내용 및 검증 보고서](./DEVELOPMENT_REPORT.md)
  - Spotify/Apple Music 음악 정보 조회 구현
  - LCD 렌더링과 네이티브 HID 전송 구조
  - XPAD 노브 좌/우 RAM 임시 매핑과 미세 볼륨 설정
  - macOS 권한, 개인 인증서 서명과 설치 결과
  - 실기기 검증 결과, 운영 방법과 남은 제한사항
- [직접 연결 및 제어 기능 전체 가이드](./XPAD_MINI_DIRECT_API.md)
  - macOS 네이티브 연결 구조
  - WebHID와 `node-hid`의 차이
  - Bibimbap에서 실제 확인한 모든 제어 범주
  - API v2 지원 명령 전체 목록과 위험도
  - 현재 음악 표시 앱이 사용하는 범위
- [저수준 HID 프로토콜](./PROTOCOL.md)
  - HID 컬렉션과 리포트 크기
  - Sayo API v1/v2 패킷 구조
  - 체크섬, 응답 판정, 청크 전송
  - 검증된 명령의 바이트 단위 페이로드

## 검증 표기

| 표기 | 의미 |
|---|---|
| **실기기 확인** | 연결된 XPAD Mini로 응답 또는 동작 확인 |
| **Bibimbap UI 확인** | 연결된 장치의 공식 Web DRV 화면에서 컨트롤 확인 |
| **상위 구현 확인** | 공개 Sayo 구현/역공학 자료에서 이름 또는 구조 확인 |
| **지원만 확인** | XPAD Mini `Info` 응답에 명령 ID가 있으나 의미는 미확인 |
| **미확인** | 현재 근거로 단정할 수 없음 |

> Pulsar가 공개한 XPAD Mini 네이티브 SDK나 명령 사양서는 찾지 못했다. 이 문서는
> 실기기 관찰과 공개 SayoDevice 구현을 대조한 비공식 역공학 자료다. 펌웨어에
> 영구 기록하는 기능은 공식 Bibimbap Web DRV 사용을 우선한다.
