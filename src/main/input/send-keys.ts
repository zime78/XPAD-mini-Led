import { execFile } from 'node:child_process';
import type { HidTarget } from '../../shared/types';

/**
 * Synthesize a key chord like "Enter", "Escape", or "Ctrl+Alt+Space" into the
 * focused window. Windows uses SendInput via koffi; macOS uses System Events
 * (requires the app to be granted Accessibility permission).
 */
export async function sendKeys(chord: string): Promise<void> {
  const parsed = parseChord(chord);
  if (!parsed) throw new Error(`Unrecognized key chord: "${chord}"`);
  if (process.platform === 'win32') return sendWin32(parsed);
  if (process.platform === 'darwin') return sendDarwin(parsed);
  throw new Error(`sendKeys not supported on ${process.platform}`);
}

export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean; // Win key / Cmd
  key: string; // normalized, e.g. "enter", "f14", "a"
}

export function parseChord(chord: string): Chord | null {
  const parts = chord
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out: Chord = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') out.ctrl = true;
    else if (part === 'alt' || part === 'option' || part === 'opt') out.alt = true;
    else if (part === 'shift') out.shift = true;
    else if (part === 'cmd' || part === 'meta' || part === 'win' || part === 'super')
      out.meta = true;
    else if (out.key) return null; // two non-modifier keys
    else out.key = normalizeKey(part);
  }
  // Modifier-only chords (e.g. "Ctrl+Win" push-to-talk) are valid too.
  if (!out.key && !(out.ctrl || out.alt || out.shift || out.meta)) return null;
  return out;
}

function normalizeKey(key: string): string {
  const aliases: Record<string, string> = {
    return: 'enter',
    esc: 'escape',
    spacebar: 'space',
  };
  return aliases[key] ?? key;
}

// --- USB HID usage codes (for on-device key mapping) -------------------------

const HID_USAGE: Record<string, number> = {
  enter: 0x28,
  escape: 0x29,
  backspace: 0x2a,
  tab: 0x2b,
  space: 0x2c,
  delete: 0x4c,
  up: 0x52,
  down: 0x51,
  left: 0x50,
  right: 0x4f,
  home: 0x4a,
  end: 0x4d,
  pageup: 0x4b,
  pagedown: 0x4e,
};
for (let c = 0; c < 26; c++) HID_USAGE[String.fromCharCode(97 + c)] = 0x04 + c;
for (let d = 1; d <= 9; d++) HID_USAGE[String(d)] = 0x1e + d - 1;
HID_USAGE['0'] = 0x27;
for (let i = 1; i <= 12; i++) HID_USAGE[`f${i}`] = 0x3a + i - 1;
for (let i = 13; i <= 24; i++) HID_USAGE[`f${i}`] = 0x68 + i - 13;

/**
 * What the pad should emit for a chord (modifier bits + usage), or null if
 * the chord names a key the keyboard page can't express — those need the
 * app's synthesizer.
 */
export function chordToHidTarget(chord: string): HidTarget | null {
  const parsed = parseChord(chord);
  if (!parsed) return null;
  const key = parsed.key ? HID_USAGE[parsed.key] : 0;
  if (key === undefined) return null;
  const mod =
    (parsed.ctrl ? 0x01 : 0) |
    (parsed.shift ? 0x02 : 0) |
    (parsed.alt ? 0x04 : 0) |
    (parsed.meta ? 0x08 : 0);
  return { mod, key };
}

// --- Windows: SendInput ------------------------------------------------------

const WIN_VK: Record<string, number> = {
  enter: 0x0d,
  escape: 0x1b,
  space: 0x20,
  tab: 0x09,
  backspace: 0x08,
  delete: 0x2e,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
};
for (let i = 1; i <= 24; i++) WIN_VK[`f${i}`] = 0x70 + (i - 1);
for (let c = 0; c < 26; c++) WIN_VK[String.fromCharCode(97 + c)] = 0x41 + c;
for (let d = 0; d <= 9; d++) WIN_VK[String(d)] = 0x30 + d;

const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_LWIN = 0x5b;
const KEYEVENTF_KEYUP = 0x0002;

let sendInputFn: ((events: { vk: number; up: boolean }[]) => void) | null = null;

function loadSendInput(): NonNullable<typeof sendInputFn> {
  if (sendInputFn) return sendInputFn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi');
  const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
    wVk: 'uint16',
    wScan: 'uint16',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr_t',
  });
  const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
    dx: 'int32',
    dy: 'int32',
    mouseData: 'uint32',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr_t',
  });
  const INPUT_UNION = koffi.union('INPUT_UNION', {
    mi: MOUSEINPUT,
    ki: KEYBDINPUT,
  });
  const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_UNION });
  const user32 = koffi.load('user32.dll');
  const SendInput = user32.func(
    'uint32 SendInput(uint32 count, INPUT* inputs, int32 size)'
  );
  const INPUT_KEYBOARD = 1;
  const size = koffi.sizeof(INPUT);

  sendInputFn = (events) => {
    const inputs = events.map((e) => ({
      type: INPUT_KEYBOARD,
      u: {
        ki: {
          wVk: e.vk,
          wScan: 0,
          dwFlags: e.up ? KEYEVENTF_KEYUP : 0,
          time: 0,
          dwExtraInfo: 0,
        },
      },
    }));
    const sent = SendInput(inputs.length, inputs, size);
    if (sent !== inputs.length) {
      throw new Error(`SendInput sent ${sent}/${inputs.length} events`);
    }
  };
  return sendInputFn;
}

async function sendWin32(chord: Chord): Promise<void> {
  const vk = WIN_VK[chord.key];
  if (vk === undefined) throw new Error(`No Windows VK for key "${chord.key}"`);
  const mods: number[] = [];
  if (chord.ctrl) mods.push(VK_CONTROL);
  if (chord.alt) mods.push(VK_MENU);
  if (chord.shift) mods.push(VK_SHIFT);
  if (chord.meta) mods.push(VK_LWIN);

  const events: { vk: number; up: boolean }[] = [
    ...mods.map((m) => ({ vk: m, up: false })),
    { vk, up: false },
    { vk, up: true },
    ...[...mods].reverse().map((m) => ({ vk: m, up: true })),
  ];
  loadSendInput()(events);
}

// --- macOS: System Events key codes ------------------------------------------

const MAC_KEYCODE: Record<string, number> = {
  enter: 36,
  escape: 53,
  space: 49,
  tab: 48,
  backspace: 51,
  delete: 117,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  a: 0, b: 11, c: 8, d: 2, e: 14, f: 3, g: 5, h: 4, i: 34, j: 38, k: 40,
  l: 37, m: 46, n: 45, o: 31, p: 35, q: 12, r: 15, s: 1, t: 17, u: 32,
  v: 9, w: 13, x: 7, y: 16, z: 6,
  '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26,
  '8': 28, '9': 25,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111, f13: 105, f14: 107, f15: 113,
  f16: 106, f17: 64, f18: 79, f19: 80, f20: 90,
};

function sendDarwin(chord: Chord): Promise<void> {
  const code = MAC_KEYCODE[chord.key];
  if (code === undefined)
    return Promise.reject(new Error(`No macOS key code for "${chord.key}"`));
  const mods: string[] = [];
  if (chord.ctrl) mods.push('control down');
  if (chord.alt) mods.push('option down');
  if (chord.shift) mods.push('shift down');
  if (chord.meta) mods.push('command down');
  const using = mods.length > 0 ? ` using {${mods.join(', ')}}` : '';
  const script = `tell application "System Events" to key code ${code}${using}`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err) =>
      err ? reject(err) : resolve()
    );
  });
}
