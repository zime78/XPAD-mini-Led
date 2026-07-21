#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT_NAME="XPAD Mini Now Playing"
BUNDLE_ID="kr.co.zime.xpad-mini-now-playing"
INSTALL_APP="/Applications/${PRODUCT_NAME}.app"
DIST_DIR="${SCRIPT_DIR}/dist"
if [[ -n "${CSC_NAME:-}" ]] && [[ "${CSC_NAME}" != "-" ]]; then
  SIGNING_IDENTITY="${CSC_NAME}"
else
  SIGNING_IDENTITY=""
fi
BUILDER_CSC_NAME=""
MAIN_INSPECT_PORT="${XPAD_INSPECT_PORT:-9229}"
RENDERER_DEBUG_PORT="${XPAD_RENDERER_DEBUG_PORT:-9222}"
ACTIVE_MOUNT=""
MOUNTED_APP=""

cd "${SCRIPT_DIR}"

log() {
  printf '[XPAD] %s\n' "$*"
}

die() {
  printf '[XPAD] 오류: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "필수 명령을 찾지 못했습니다: $1"
}

detach_active_mount() {
  if [[ -n "${ACTIVE_MOUNT}" ]] && mount | grep -Fq "on ${ACTIVE_MOUNT} "; then
    hdiutil detach "${ACTIVE_MOUNT}" >/dev/null || true
  fi
  ACTIVE_MOUNT=""
  MOUNTED_APP=""
}

trap detach_active_mount EXIT INT TERM

usage() {
  cat <<'EOF'
XPAD Mini Now Playing 빌드·디버깅·배포 도구

사용법:
  ./build.sh <명령> [옵션]

명령:
  deps                    npm ci로 의존성 재설치
  check                   TypeScript 검사와 프로덕션 빌드
  audit                   런타임 의존성 보안 감사
  dev                     개발 모드 실행(HID 사용)
  dev-ui                  개발 모드 실행(HID 미사용)
  debug [main] [renderer] HID 없이 main/renderer 디버그 포트 실행
  debug-hid [main] [renderer]
                          실기기 HID를 사용해 디버그 포트 실행
  build                   out/ 프로덕션 번들 생성
  package [대상]          개인 Developer ID로 DMG 생성·서명·검증
  verify [대상]           기존 DMG와 내부 앱 서명 검증
  install [대상]          기존 DMG를 /Applications에 설치 후 실행
  deploy [대상]           package 후 /Applications에 설치·실행
  run                     설치 앱 실행
  stop                    설치 앱 정상 종료
  status                  설치·실행·서명 상태 확인
  signing                 패키징에 사용할 Developer ID 인증서 확인
  help                    이 도움말 출력

대상:
  host                    현재 Mac 아키텍처(기본값)
  arm64                   Apple Silicon
  x64                     Intel Mac
  all                     arm64와 x64 모두(package/verify만 지원)

환경 변수:
  CSC_NAME                코드 서명 인증서 이름
                          미지정 시 Keychain의 Developer ID Application 자동 선택
  XPAD_INSPECT_PORT       main process inspector 포트(기본 9229)
  XPAD_RENDERER_DEBUG_PORT renderer remote debugging 포트(기본 9222)

예시:
  ./build.sh debug
  ./build.sh stop && ./build.sh debug-hid
  ./build.sh check
  ./build.sh package all
  ./build.sh deploy host
EOF
}

normalize_arch() {
  local requested="${1:-host}"
  case "${requested}" in
    host)
      case "$(uname -m)" in
        arm64) printf 'arm64\n' ;;
        x86_64) printf 'x64\n' ;;
        *) die "지원하지 않는 현재 Mac 아키텍처: $(uname -m)" ;;
      esac
      ;;
    arm64|x64|all) printf '%s\n' "${requested}" ;;
    *) die "지원하지 않는 대상입니다: ${requested} (host|arm64|x64|all)" ;;
  esac
}

assert_node_dependencies() {
  require_command node
  require_command npm
  [[ -x "${SCRIPT_DIR}/node_modules/.bin/electron-vite" ]] ||
    die "의존성이 없습니다. 먼저 ./build.sh deps를 실행하십시오."
}

assert_signing_identity() {
  local identities
  local selected_identity
  require_command security
  identities="$(security find-identity -v -p codesigning)"

  if [[ -z "${SIGNING_IDENTITY}" ]]; then
    selected_identity="$(printf '%s\n' "${identities}" | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
  elif [[ "${SIGNING_IDENTITY}" == Developer\ ID\ Application:* ]]; then
    selected_identity="$(printf '%s\n' "${identities}" | grep -F "\"${SIGNING_IDENTITY}\"" | sed -n 's/.*"\([^"]*\)".*/\1/p' | head -1 || true)"
  else
    selected_identity="$(printf '%s\n' "${identities}" | grep -F "${SIGNING_IDENTITY}" | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1 || true)"
  fi

  if [[ -z "${selected_identity}" ]]; then
    die "Keychain에서 코드 서명 인증서를 찾지 못했습니다: ${SIGNING_IDENTITY:-자동 선택}"
  fi
  SIGNING_IDENTITY="${selected_identity}"
  BUILDER_CSC_NAME="${SIGNING_IDENTITY#Developer ID Application: }"
  log "서명 인증서 확인: ${SIGNING_IDENTITY}"
}

resolve_dmg() {
  local target_arch="$1"
  local version
  local expected_file
  version="$(node -p "require('./package.json').version")"
  if [[ "${target_arch}" == "arm64" ]]; then
    expected_file="${DIST_DIR}/${PRODUCT_NAME}-${version}-arm64.dmg"
  else
    expected_file="${DIST_DIR}/${PRODUCT_NAME}-${version}.dmg"
  fi
  [[ -f "${expected_file}" ]] || {
    log "현재 dist 파일 목록:"
    find "${DIST_DIR}" -maxdepth 1 -type f -name '*.dmg' -print 2>/dev/null || true
    die "${target_arch} DMG를 찾지 못했습니다: ${expected_file}"
  }
  printf '%s\n' "${expected_file}"
}

attach_dmg() {
  local dmg_file="$1"
  local attach_output
  detach_active_mount
  attach_output="$(hdiutil attach "${dmg_file}" -nobrowse -readonly)"
  ACTIVE_MOUNT="$(printf '%s\n' "${attach_output}" | awk 'index($0, "/Volumes/") { print substr($0, index($0, "/Volumes/")); exit }')"
  [[ -n "${ACTIVE_MOUNT}" ]] || die "DMG 마운트 위치를 확인하지 못했습니다: ${dmg_file}"
  MOUNTED_APP="$(find "${ACTIVE_MOUNT}" -maxdepth 1 -type d -name '*.app' -print -quit)"
  [[ -n "${MOUNTED_APP}" ]] || die "DMG 내부 앱을 찾지 못했습니다: ${dmg_file}"
}

verify_app() {
  local app_bundle="$1"
  codesign --verify --deep --strict --verbose=2 "${app_bundle}"
  spctl -a -vvv -t execute "${app_bundle}"
  log "앱 서명과 Gatekeeper 검증 통과: ${app_bundle}"
}

verify_dmg() {
  local dmg_file="$1"
  codesign --verify --verbose=2 "${dmg_file}"
  attach_dmg "${dmg_file}"
  verify_app "${MOUNTED_APP}"
  detach_active_mount
  shasum -a 256 "${dmg_file}"
}

run_check() {
  assert_node_dependencies
  npm run typecheck
  npm run build
}

assert_installed_app_not_running() {
  if pgrep -f "^${INSTALL_APP}/Contents/MacOS/${PRODUCT_NAME}$" >/dev/null 2>&1; then
    die "설치 앱이 HID를 사용 중입니다. ./build.sh stop 실행 후 다시 시도하십시오."
  fi
}

run_debug() {
  local hid_mode="$1"
  local main_port="${2:-${MAIN_INSPECT_PORT}}"
  local renderer_port="${3:-${RENDERER_DEBUG_PORT}}"
  assert_node_dependencies
  [[ "${main_port}" =~ ^[0-9]+$ ]] || die "잘못된 main 디버그 포트: ${main_port}"
  [[ "${renderer_port}" =~ ^[0-9]+$ ]] || die "잘못된 renderer 디버그 포트: ${renderer_port}"

  if [[ "${hid_mode}" == "enabled" ]]; then
    assert_installed_app_not_running
    log "실기기 HID 디버그: main=${main_port}, renderer=${renderer_port}"
    exec "${SCRIPT_DIR}/node_modules/.bin/electron-vite" \
      --inspect "${main_port}" \
      --remoteDebuggingPort "${renderer_port}" \
      --sourcemap \
      --debug
  fi

  log "HID 없는 안전 디버그: main=${main_port}, renderer=${renderer_port}"
  XPAD_DISABLE_HID=1 exec "${SCRIPT_DIR}/node_modules/.bin/electron-vite" \
    --inspect "${main_port}" \
    --remoteDebuggingPort "${renderer_port}" \
    --sourcemap \
    --debug
}

run_package() {
  local target_arch="$1"
  local dmg_file
  local target
  local targets=()
  assert_node_dependencies
  assert_signing_identity
  npm run build

  if [[ "${target_arch}" == "all" ]]; then
    targets=(arm64 x64)
    CSC_NAME="${BUILDER_CSC_NAME}" "${SCRIPT_DIR}/node_modules/.bin/electron-builder" \
      --mac dmg --arm64 --x64 --publish never
  else
    targets=("${target_arch}")
    CSC_NAME="${BUILDER_CSC_NAME}" "${SCRIPT_DIR}/node_modules/.bin/electron-builder" \
      --mac dmg "--${target_arch}" --publish never
  fi

  for target in "${targets[@]}"; do
    dmg_file="$(resolve_dmg "${target}")"
    codesign --force --timestamp --sign "${SIGNING_IDENTITY}" "${dmg_file}"
    verify_dmg "${dmg_file}"
  done
}

stop_installed_app() {
  local app_pid
  app_pid="$(pgrep -f "^${INSTALL_APP}/Contents/MacOS/${PRODUCT_NAME}$" | head -1 || true)"
  if [[ -z "${app_pid}" ]]; then
    log "설치 앱이 실행 중이 아닙니다."
    return
  fi

  /usr/bin/osascript -e "tell application id \"${BUNDLE_ID}\" to quit" >/dev/null 2>&1 || true
  for _attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if ! pgrep -f "^${INSTALL_APP}/Contents/MacOS/${PRODUCT_NAME}$" >/dev/null 2>&1; then
      log "설치 앱을 정상 종료했습니다."
      return
    fi
    sleep 0.25
  done
  die "앱이 5초 안에 종료되지 않았습니다. 강제 종료하지 않았습니다. PID=${app_pid}"
}

move_installed_app_to_trash() {
  [[ -d "${INSTALL_APP}" ]] || return
  /usr/bin/osascript - "${INSTALL_APP}" <<'APPLESCRIPT' >/dev/null
on run argv
  tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)
end run
APPLESCRIPT
  log "기존 설치 앱을 휴지통으로 이동했습니다."
}

install_dmg() {
  local target_arch="$1"
  local dmg_file
  [[ "${target_arch}" != "all" ]] || die "install/deploy에는 all을 사용할 수 없습니다."
  dmg_file="$(resolve_dmg "${target_arch}")"
  verify_dmg "${dmg_file}"
  attach_dmg "${dmg_file}"
  stop_installed_app
  move_installed_app_to_trash
  ditto "${MOUNTED_APP}" "${INSTALL_APP}"
  detach_active_mount
  verify_app "${INSTALL_APP}"
  open -a "${INSTALL_APP}"
  log "설치 및 실행 완료: ${INSTALL_APP}"
}

show_status() {
  if [[ -d "${INSTALL_APP}" ]]; then
    log "설치됨: ${INSTALL_APP}"
    codesign -dvv "${INSTALL_APP}" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Runtime Version)=' || true
  else
    log "설치되지 않음: ${INSTALL_APP}"
  fi
  local running_pids
  running_pids="$(pgrep -f "^${INSTALL_APP}/Contents/MacOS/${PRODUCT_NAME}$" || true)"
  if [[ -n "${running_pids}" ]]; then
    log "실행 중 PID: ${running_pids//$'\n'/, }"
  else
    log "설치 앱이 실행 중이 아닙니다."
  fi
  log "배포 DMG:"
  find "${DIST_DIR}" -maxdepth 1 -type f -name '*.dmg' -print 2>/dev/null | sort || true
}

command_name="${1:-help}"
shift || true

case "${command_name}" in
  help|-h|--help)
    usage
    ;;
  deps)
    require_command npm
    npm ci
    ;;
  check)
    run_check
    ;;
  audit)
    assert_node_dependencies
    npm audit --omit=dev
    ;;
  dev)
    assert_node_dependencies
    assert_installed_app_not_running
    exec npm run dev
    ;;
  dev-ui)
    assert_node_dependencies
    XPAD_DISABLE_HID=1 exec npm run dev
    ;;
  debug)
    run_debug disabled "${1:-${MAIN_INSPECT_PORT}}" "${2:-${RENDERER_DEBUG_PORT}}"
    ;;
  debug-hid)
    run_debug enabled "${1:-${MAIN_INSPECT_PORT}}" "${2:-${RENDERER_DEBUG_PORT}}"
    ;;
  build)
    assert_node_dependencies
    npm run build
    ;;
  package)
    run_package "$(normalize_arch "${1:-host}")"
    ;;
  verify)
    selected_arch="$(normalize_arch "${1:-host}")"
    if [[ "${selected_arch}" == "all" ]]; then
      verify_dmg "$(resolve_dmg arm64)"
      verify_dmg "$(resolve_dmg x64)"
    else
      verify_dmg "$(resolve_dmg "${selected_arch}")"
    fi
    ;;
  install)
    install_dmg "$(normalize_arch "${1:-host}")"
    ;;
  deploy)
    selected_arch="$(normalize_arch "${1:-host}")"
    [[ "${selected_arch}" != "all" ]] || die "deploy에는 all을 사용할 수 없습니다. package all을 별도로 사용하십시오."
    run_package "${selected_arch}"
    install_dmg "${selected_arch}"
    ;;
  run)
    [[ -d "${INSTALL_APP}" ]] || die "설치 앱을 찾지 못했습니다: ${INSTALL_APP}"
    open -a "${INSTALL_APP}"
    ;;
  stop)
    stop_installed_app
    ;;
  status)
    show_status
    ;;
  signing)
    assert_signing_identity
    ;;
  *)
    usage >&2
    die "알 수 없는 명령입니다: ${command_name}"
    ;;
esac
