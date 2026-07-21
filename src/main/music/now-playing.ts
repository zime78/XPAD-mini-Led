import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  EMPTY_TRACK,
  ServicePreference,
  TrackInfo,
} from '../../shared/types';

const execFileAsync = promisify(execFile);
const FIELD_SEPARATOR = '\u001f';
const SCRIPT_TIMEOUT_MS = 3500;

interface RawTrack extends Omit<TrackInfo, 'artworkDataUrl'> {
  artworkRef?: string;
}

export class NowPlayingMonitor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private current: TrackInfo = structuredClone(EMPTY_TRACK);
  private preference: ServicePreference;
  private intervalMs: number;
  private artworkCache = new Map<string, string>();
  private polling = false;
  private lastActiveService: TrackInfo['service'] = 'none';
  lastError: string | null = null;

  constructor(
    preference: ServicePreference,
    intervalMs: number,
    private tempDir: string
  ) {
    super();
    this.preference = preference;
    this.intervalMs = intervalMs;
  }

  get track(): TrackInfo {
    return this.current;
  }

  start(): void {
    this.stop();
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  configure(preference: ServicePreference, intervalMs: number): void {
    const intervalChanged = intervalMs !== this.intervalMs;
    this.preference = preference;
    this.intervalMs = intervalMs;
    if (intervalChanged && this.timer) this.start();
    else void this.poll();
  }

  refresh(): Promise<void> {
    return this.poll();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const [spotify, music] = await Promise.all([
        this.querySpotify(),
        this.queryAppleMusic(),
      ]);
      const selected = this.selectTrack([spotify, music].filter(Boolean) as RawTrack[]);
      const next = selected ? await this.hydrateArtwork(selected) : structuredClone(EMPTY_TRACK);
      this.lastError = null;
      this.update(next);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emit('status');
    } finally {
      this.polling = false;
    }
  }

  private selectTrack(tracks: RawTrack[]): RawTrack | null {
    if (tracks.length === 0) return null;
    const preferred =
      this.preference === 'automatic'
        ? null
        : tracks.find((track) => track.service === this.preference);
    if (preferred?.state === 'playing') return preferred;

    const playing = tracks.filter((track) => track.state === 'playing');
    if (playing.length > 0) {
      return (
        playing.find((track) => track.service === this.lastActiveService) ??
        preferred ??
        playing[0]
      );
    }
    if (preferred) return preferred;
    return (
      tracks.find((track) => track.service === this.lastActiveService) ??
      tracks.find((track) => track.state === 'paused') ??
      tracks[0]
    );
  }

  private update(next: TrackInfo): void {
    const previousKey = JSON.stringify(this.current);
    const nextKey = JSON.stringify(next);
    this.current = next;
    if (next.service !== 'none') this.lastActiveService = next.service;
    if (previousKey !== nextKey) this.emit('change', next);
    this.emit('status');
  }

  private async querySpotify(): Promise<RawTrack | null> {
    if (!(await isRunning('Spotify'))) return null;
    const script = `
tell application "Spotify"
  try
    set playbackState to player state as text
    if playbackState is "stopped" then return "stopped"
    set currentItem to current track
    set sep to ASCII character 31
    return playbackState & sep & (name of currentItem as text) & sep & (artist of currentItem as text) & sep & (album of currentItem as text) & sep & (duration of currentItem as text) & sep & (player position as text) & sep & (id of currentItem as text) & sep & (artwork url of currentItem as text)
  on error
    return "stopped"
  end try
end tell`;
    return parseTrack('spotify', await runAppleScript(script));
  }

  private async queryAppleMusic(): Promise<RawTrack | null> {
    if (!(await isRunning('Music'))) return null;
    const script = `
tell application "Music"
  try
    set playbackState to player state as text
    if playbackState is "stopped" then return "stopped"
    set currentItem to current track
    set sep to ASCII character 31
    set trackId to ""
    try
      set trackId to persistent ID of currentItem as text
    end try
    return playbackState & sep & (name of currentItem as text) & sep & (artist of currentItem as text) & sep & (album of currentItem as text) & sep & (duration of currentItem as text) & sep & (player position as text) & sep & trackId & sep & "music-artwork"
  on error
    return "stopped"
  end try
end tell`;
    return parseTrack('apple-music', await runAppleScript(script));
  }

  private async hydrateArtwork(track: RawTrack): Promise<TrackInfo> {
    const cacheKey = `${track.service}:${track.id || `${track.title}:${track.artist}`}`;
    const cached = this.artworkCache.get(cacheKey);
    if (cached) return { ...track, artworkDataUrl: cached };

    let artworkDataUrl: string | undefined;
    if (track.service === 'spotify' && track.artworkRef?.startsWith('http')) {
      artworkDataUrl = await fetchArtwork(track.artworkRef);
    } else if (track.service === 'apple-music') {
      artworkDataUrl = await this.exportAppleMusicArtwork();
    }
    if (artworkDataUrl) {
      this.artworkCache.set(cacheKey, artworkDataUrl);
      while (this.artworkCache.size > 12) {
        const oldest = this.artworkCache.keys().next().value as string | undefined;
        if (!oldest) break;
        this.artworkCache.delete(oldest);
      }
    }
    const { artworkRef: _artworkRef, ...publicTrack } = track;
    return { ...publicTrack, artworkDataUrl };
  }

  private async exportAppleMusicArtwork(): Promise<string | undefined> {
    const artworkPath = path.join(this.tempDir, 'xpad-mini-now-playing-artwork');
    const escapedPath = artworkPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    const script = `
set outputFile to POSIX file "${escapedPath}"
tell application "Music"
  if (count of artworks of current track) is 0 then error "no artwork"
  set artworkData to raw data of artwork 1 of current track
end tell
set fileRef to open for access outputFile with write permission
try
  set eof fileRef to 0
  write artworkData to fileRef
  close access fileRef
on error errMsg
  try
    close access fileRef
  end try
  error errMsg
end try`;
    try {
      await runAppleScript(script);
      const data = await fs.readFile(artworkPath);
      return toDataUrl(data);
    } catch {
      return undefined;
    }
  }
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

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
    timeout: SCRIPT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function parseTrack(service: RawTrack['service'], output: string): RawTrack | null {
  if (!output || output === 'stopped') return null;
  const [state, title, artist, album, duration, position, id, artworkRef] =
    output.split(FIELD_SEPARATOR);
  if (!title) return null;
  return {
    service,
    state: state === 'playing' ? 'playing' : 'paused',
    id: id || `${title}:${artist}`,
    title,
    artist: artist || '알 수 없는 아티스트',
    album: album || '',
    duration: Math.max(0, Number(duration) || 0),
    position: Math.max(0, Number(position) || 0),
    artworkRef,
  };
}

async function fetchArtwork(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    return toDataUrl(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type'));
  } catch {
    return undefined;
  }
}

function toDataUrl(data: Buffer, declaredType?: string | null): string | undefined {
  const mime =
    declaredType?.split(';')[0] ||
    (data[0] === 0x89 && data[1] === 0x50
      ? 'image/png'
      : data[0] === 0xff && data[1] === 0xd8
        ? 'image/jpeg'
        : data.subarray(0, 3).toString('ascii') === 'GIF'
          ? 'image/gif'
          : null);
  return mime ? `data:${mime};base64,${data.toString('base64')}` : undefined;
}
