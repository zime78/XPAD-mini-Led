import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Marker used to recognize hook entries owned by this app (survives port changes). */
const MARKER = 'xpad-mini-claude-code';

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
] as const;

function settingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function hookCommand(port: number): string {
  // Forward the hook's stdin JSON to the local server; never block Claude for
  // long, and never fail the hook when the app isn't running (a PreToolUse
  // hook exiting 2 would BLOCK every tool call). Hooks run under a POSIX shell
  // on every platform — Git Bash on Windows — so `|| true` masks the exit
  // code. The marker header identifies entries owned by this app.
  return `curl -s -m 2 -X POST -H "Content-Type: application/json" -H "X-Client: ${MARKER}" --data-binary @- http://127.0.0.1:${port}/event || true`;
}

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

export function areHooksInstalled(port: number): boolean {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    const hooks = settings.hooks ?? {};
    return HOOK_EVENTS.every((event) =>
      (hooks[event] ?? []).some((entry: HookEntry) =>
        entry.hooks?.some(
          (h) => h.command?.includes(MARKER) && h.command?.includes(`:${port}/`)
        )
      )
    );
  } catch {
    return false;
  }
}

/**
 * Merge our hook entries into ~/.claude/settings.json. Existing unrelated hooks
 * are preserved; previous entries owned by this app are replaced. A timestamped
 * backup of the old file is written alongside it.
 */
export function installHooks(port: number): { backupPath: string | null } {
  const file = settingsPath();
  let settings: Record<string, any> = {};
  let backupPath: string | null = null;

  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    settings = raw.trim() ? JSON.parse(raw) : {};
    backupPath = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backupPath);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  settings.hooks = settings.hooks ?? {};
  for (const event of HOOK_EVENTS) {
    const entries: HookEntry[] = (settings.hooks[event] ?? []).filter(
      (entry: HookEntry) => !entry.hooks?.some((h) => h.command?.includes(MARKER))
    );
    const entry: HookEntry = {
      hooks: [{ type: 'command', command: hookCommand(port), timeout: 5 }],
    };
    // Tool hooks take a matcher; "*" matches every tool.
    if (event === 'PreToolUse' || event === 'PostToolUse') entry.matcher = '*';
    entries.push(entry);
    settings.hooks[event] = entries;
  }

  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return { backupPath };
}

export function uninstallHooks(): void {
  const file = settingsPath();
  if (!fs.existsSync(file)) return;
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!settings.hooks) return;
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = settings.hooks[event].filter(
      (entry: HookEntry) => !entry.hooks?.some((h) => h.command?.includes(MARKER))
    );
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}
