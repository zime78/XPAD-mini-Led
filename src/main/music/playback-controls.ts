import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  MediaKeyCode,
  MusicService,
  ServicePreference,
} from '../../shared/types';

const execFileAsync = promisify(execFile);

const COMMANDS: Record<MediaKeyCode, string> = {
  MediaTrackPrevious: 'previous track',
  MediaPlayPause: 'playpause',
  MediaTrackNext: 'next track',
};

export async function controlPlayback(
  command: MediaKeyCode,
  currentService: MusicService,
  preference: ServicePreference
): Promise<void> {
  const application = await selectPlaybackApplication(currentService, preference);
  if (!application) {
    throw new Error('Spotify 또는 Music 앱이 실행 중이 아닙니다.');
  }
  const script = `tell application "${application}" to ${COMMANDS[command]}`;
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
