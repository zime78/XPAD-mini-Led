import { execFile } from 'node:child_process';

/**
 * Returns the executable/app name of the currently focused window, lowercase
 * (e.g. "windowsterminal.exe", "iterm2"), or null if it can't be determined.
 */
export async function getFocusedProcessName(): Promise<string | null> {
  if (process.platform === 'win32') return getFocusedWin32();
  if (process.platform === 'darwin') return getFocusedDarwin();
  return null;
}

// --- Windows: user32/kernel32 via koffi (fast, no subprocess) ---------------

let win32Fns: {
  GetForegroundWindow: () => unknown;
  GetWindowThreadProcessId: (hwnd: unknown, out: number[]) => number;
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown;
  QueryFullProcessImageNameW: (
    h: unknown,
    flags: number,
    buf: Buffer,
    size: number[]
  ) => boolean;
  CloseHandle: (h: unknown) => boolean;
} | null = null;

function loadWin32(): NonNullable<typeof win32Fns> {
  if (win32Fns) return win32Fns;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  win32Fns = {
    GetForegroundWindow: user32.func('void* GetForegroundWindow()'),
    GetWindowThreadProcessId: user32.func(
      'uint32 GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)'
    ),
    OpenProcess: kernel32.func(
      'void* OpenProcess(uint32 access, bool inherit, uint32 pid)'
    ),
    QueryFullProcessImageNameW: kernel32.func(
      'bool QueryFullProcessImageNameW(void* h, uint32 flags, void* buf, _Inout_ uint32* size)'
    ),
    CloseHandle: kernel32.func('bool CloseHandle(void* h)'),
  };
  return win32Fns;
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function getFocusedWin32(): string | null {
  try {
    const fns = loadWin32();
    const hwnd = fns.GetForegroundWindow();
    if (!hwnd) return null;
    const pidOut = [0];
    fns.GetWindowThreadProcessId(hwnd, pidOut);
    if (!pidOut[0]) return null;
    const handle = fns.OpenProcess(
      PROCESS_QUERY_LIMITED_INFORMATION,
      false,
      pidOut[0]
    );
    if (!handle) return null;
    try {
      const buf = Buffer.alloc(2048);
      const size = [buf.length / 2];
      if (!fns.QueryFullProcessImageNameW(handle, 0, buf, size)) return null;
      const fullPath = buf.toString('utf16le', 0, size[0] * 2);
      const base = fullPath.split(/[\\/]/).pop() ?? null;
      return base ? base.toLowerCase() : null;
    } finally {
      fns.CloseHandle(handle);
    }
  } catch (err) {
    console.error('[focused-app] win32 query failed', err);
    return null;
  }
}

// --- macOS: System Events via osascript -------------------------------------

function getFocusedDarwin(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      [
        '-e',
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ],
      { timeout: 2000 },
      (err, stdout) => {
        if (err) {
          console.error('[focused-app] osascript failed', err.message);
          resolve(null);
        } else {
          resolve(stdout.trim().toLowerCase() || null);
        }
      }
    );
  });
}
