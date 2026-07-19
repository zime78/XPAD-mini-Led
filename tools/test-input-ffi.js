// Validates the koffi FFI signatures used by src/main/input/ on Windows:
// 1) reads the focused process name (read-only)
// 2) calls SendInput with VK 0x07 (undefined/unassigned key: no app reacts)
// Usage: node tools/test-input-ffi.js
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// --- focused process ---------------------------------------------------------
const GetForegroundWindow = user32.func('void* GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func(
  'uint32 GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)'
);
const OpenProcess = kernel32.func(
  'void* OpenProcess(uint32 access, bool inherit, uint32 pid)'
);
const QueryFullProcessImageNameW = kernel32.func(
  'bool QueryFullProcessImageNameW(void* h, uint32 flags, void* buf, _Inout_ uint32* size)'
);
const CloseHandle = kernel32.func('bool CloseHandle(void* h)');

const hwnd = GetForegroundWindow();
console.log('GetForegroundWindow:', hwnd ? 'ok' : 'null');
const pidOut = [0];
GetWindowThreadProcessId(hwnd, pidOut);
console.log('pid:', pidOut[0]);
const handle = OpenProcess(0x1000, false, pidOut[0]);
const buf = Buffer.alloc(2048);
const size = [buf.length / 2];
const ok = QueryFullProcessImageNameW(handle, 0, buf, size);
CloseHandle(handle);
const fullPath = buf.toString('utf16le', 0, size[0] * 2);
console.log('focused process:', ok ? fullPath.split(/[\\/]/).pop() : 'FAILED');

// --- SendInput with an unassigned VK ----------------------------------------
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
const INPUT_UNION = koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT });
const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_UNION });
const SendInput = user32.func('uint32 SendInput(uint32 count, INPUT* inputs, int32 size)');

console.log('sizeof(INPUT):', koffi.sizeof(INPUT), '(expect 40 on x64)');
const events = [
  { type: 1, u: { ki: { wVk: 0x07, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } } },
  { type: 1, u: { ki: { wVk: 0x07, wScan: 0, dwFlags: 2, time: 0, dwExtraInfo: 0 } } },
];
const sent = SendInput(events.length, events, koffi.sizeof(INPUT));
console.log('SendInput:', sent === 2 ? 'ok (2/2)' : `FAILED (${sent}/2)`);
