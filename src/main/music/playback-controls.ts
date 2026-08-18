import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  MediaKeyCode,
  MusicService,
  ServicePreference,
} from '../../shared/types';

const execFileAsync = promisify(execFile);

/** 이 시간 안에 뒤로가기를 한 번 더 누르면 이전 곡으로 간다. */
export const PREVIOUS_RESTART_WINDOW_MS = 2500;

const COMMANDS: Record<MediaKeyCode, string> = {
  MediaTrackPrevious: 'previous track',
  MediaPlayPause: 'playpause',
  MediaTrackNext: 'next track',
};

let lastRestartAtMs: number | null = null;

/** 첫 뒤로가기=처음으로, 연속 두 번째=이전 곡. */
export function consumePreviousTrackAction(nowMs = Date.now()): 'restart' | 'previous' {
  if (lastRestartAtMs != null && nowMs - lastRestartAtMs <= PREVIOUS_RESTART_WINDOW_MS) {
    lastRestartAtMs = null;
    return 'previous';
  }
  lastRestartAtMs = nowMs;
  return 'restart';
}

export function resetPreviousTrackAction(): void {
  lastRestartAtMs = null;
}

export function playbackAppleScript(application: string, command: MediaKeyCode): string {
  if (command === 'MediaTrackPrevious') {
    const action = consumePreviousTrackAction();
    const verb = action === 'restart' ? 'set player position to 0' : 'previous track';
    return `tell application "${application}" to ${verb}`;
  }
  resetPreviousTrackAction();
  return `tell application "${application}" to ${COMMANDS[command]}`;
}

export async function controlPlayback(
  command: MediaKeyCode,
  currentService: MusicService,
  preference: ServicePreference
): Promise<void> {
  const application = await selectPlaybackApplication(currentService, preference);
  if (!application) {
    throw new Error('Spotify 또는 Music 앱이 실행 중이 아닙니다.');
  }
  const script = playbackAppleScript(application, command);
  await execFileAsync('/usr/bin/osascript', ['-e', script], {
    timeout: 2500,
    maxBuffer: 1024,
  });
}

export async function selectPlaybackApplication(
  currentService: MusicService,
  preference: ServicePreference,
  running: (name: string) => Promise<boolean> = isRunning
): Promise<'Spotify' | 'Music' | null> {
  const candidates: Array<'Spotify' | 'Music'> = [];
  const add = (name: 'Spotify' | 'Music') => {
    if (!candidates.includes(name)) candidates.push(name);
  };

  if (currentService === 'spotify') add('Spotify');
  if (currentService === 'apple-music') add('Music');
  if (preference === 'spotify') add('Spotify');
  if (preference === 'apple-music') add('Music');
  add('Spotify');
  add('Music');

  for (const candidate of candidates) {
    if (await running(candidate)) return candidate;
  }
  return null;
}

async function isRunning(processName: string): Promise<boolean> {
  try {
    await execFileAsync('/usr/bin/pgrep', ['-x', processName], {
      timeout: 1000,
      maxBuffer: 1024,
    });
    return true;
  } catch {
    return false;
  }
}
