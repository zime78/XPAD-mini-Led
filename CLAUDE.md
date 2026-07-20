# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Electron tray app that turns a Pulsar Lab XPAD Mini keypad (VID `0x3710`, PID `0x2507`) into a status display and control surface for Claude Code: LEDs mirror Claude's state, the 240×135 LCD plays Clawd animations, and the pad keys approve/reject/dictate.

## Commands

```sh
npm install
npm run gen-icons        # generate assets/tray icons (required before first run)
node tools/gen-clawd.js  # generate procedural Clawd LCD frames into assets/clawd
npm run dev              # electron-vite dev with hot reload
npm run build            # production build into out/
npm run typecheck        # tsc -p tsconfig.node.json && tsc -p tsconfig.web.json
npm run dist             # build + electron-builder installer
```

There are no tests and no linter. CI (`.github/workflows/build.yml`) runs gen-icons, gen-clawd, typecheck, build, and electron-builder on Windows and macOS.

**`npm run dev` only hot-reloads the renderer** — edits under `src/main/` (including the device worker) require killing and relaunching the dev process, or you will be testing stale code.

`node tools/import-clawd-gifs.js` optionally imports pixel-art Clawd animations into `assets/clawd-external/` — that artwork is All-Rights-Reserved fan art, gitignored, and must **never** be committed or redistributed.

## Architecture

Electron three-process split built by electron-vite (`src/main`, `src/preload`, `src/renderer`), plus a Node worker thread. `src/shared/types.ts` is the contract shared by all of them: `ClaudeState`, `AppConfig`, `DEFAULT_CONFIG`, `StatusSnapshot`.

Data flow, end to end:

1. **Claude Code hooks → HTTP.** `claude/hook-installer.ts` merges hook entries (identified by an `xpad-mini-claude-code` marker) into `~/.claude/settings.json`; each lifecycle event `curl`s its JSON to `127.0.0.1:3939/event`. `claude/hook-server.ts` receives them.
2. **State machine.** `claude/state-machine.ts` tracks per-session state and aggregates with priority `attention > working > done > idle`; `done` decays to idle after `doneDecaySeconds`. It filters out the "Claude is waiting for your input" Notification so idle-timeout doesn't flash red.
3. **Main orchestration.** `main/index.ts` wires state changes to the tray icon, the settings window (IPC channels `get-status`/`get-config`/`set-config`/`simulate-state`/`install-hooks`, push via `status-changed`), and the device.
4. **Device worker.** `device/device-host.ts` is a thin main-thread proxy; all HID I/O and animation timing runs in a worker thread (`device/device-worker.ts`, a second rollup entry in `electron.vite.config.ts`) so animations stay smooth. Messages are the typed `WorkerInMessage`/`WorkerOutMessage`.
5. **Device layer.** `device/hid.ts` opens the three vendor HID collections (usage pages 0xFF00 config, 0xFF11 aux, 0xFF12 bulk — the 1024-byte fast channel actually used) and auto-reconnects. `device/protocol.ts` implements the Sayo v2 protocol: cmd `0x27` sets all 13 LEDs per frame; cmd `0x25` streams RGB565-LE framebuffer chunks, diffing against the last frame to skip unchanged chunks. `led-engine.ts` renders 30 Hz effects (scan/pulse/flash/steady) plus role-aware key LEDs, applies the global `ledBrightness` then gamma as the final output step, and has an "orbit" overlay (dot circling all 13 LEDs over a dim base) that the worker enables whenever the LCD's active animation is `building` — the LCD engine reports animation changes via `setAnimationListener`; `lcd-engine.ts` loads PNG frame directories from `assets/clawd` (fallback) and `assets/clawd-external` (preferred) and schedules frames.
6. **Input.** Pad keys are remapped on-device to F13/F14/F15; `input/hotkeys.ts` registers them as Electron global shortcuts. Approve/reject synthesize keystrokes (`input/send-keys.ts`: SendInput via koffi on Windows, System Events on macOS) only when the focused process (`input/focused-app.ts`) matches the configured allowlist.

Config lives at `userData/config.json`, deep-merged over `DEFAULT_CONFIG` on load (`main/config.ts`) so new fields pick up defaults; it also migrates legacy state colors.

## Hard constraints

- **Device writes are RAM-only.** Never send Save (`0x0D`), MemoryWrite, or bootloader commands, and never touch the keyboard HID collections — unplugging must always restore factory behavior. `docs/PROTOCOL.md` is the authoritative, device-verified protocol reference; update it when protocol knowledge changes.
- **Claude Code hooks run under Git Bash on Windows**, not cmd. Hook commands must be POSIX sh and end in `|| true` — a PreToolUse hook exiting non-zero blocks every tool call.
- **LED colors must be fully saturated** (e.g. `#0044ff`, not `#2563eb`): the engine applies gamma 2.2 at output and mixed sRGB palette colors wash out on the strip.
- LCD is 240×**135** (firmware-reported), not the 136 in marketing copy.

## Repo notes

- `tools/` holds standalone Node scripts that speak the protocol directly (hid-enum, led-demo, test-leds, stream-clawd, probe-*) for device experimentation; they duplicate protocol constants on purpose so they run without a build.
- `re/` (gitignored) holds reverse-engineering artifacts of Pulsar's Bibimbap web driver.
