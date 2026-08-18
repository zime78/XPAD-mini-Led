import { describe, expect, it, vi } from 'vitest';
import {
  consumePreviousTrackAction,
  playbackAppleScript,
  PREVIOUS_RESTART_WINDOW_MS,
  resetPreviousTrackAction,
  selectPlaybackApplication,
} from './playback-controls';

describe('selectPlaybackApplication', () => {
  it('현재 재생 서비스를 우선한다', async () => {
    const running = vi.fn().mockResolvedValue(true);
    await expect(
      selectPlaybackApplication('apple-music', 'spotify', running)
    ).resolves.toBe('Music');
    expect(running).toHaveBeenCalledWith('Music');
  });

  it('현재 서비스가 없으면 사용자 선호 서비스를 우선한다', async () => {
    const running = vi.fn(async (name: string) => name === 'Spotify');
    await expect(
      selectPlaybackApplication('none', 'spotify', running)
    ).resolves.toBe('Spotify');
  });
});

describe('consumePreviousTrackAction', () => {
  it('goes to the start first, then the previous track if pressed again quickly', () => {
    resetPreviousTrackAction();
    expect(consumePreviousTrackAction(1000)).toBe('restart');
    expect(consumePreviousTrackAction(1000 + PREVIOUS_RESTART_WINDOW_MS)).toBe('previous');
    expect(consumePreviousTrackAction(4000)).toBe('restart');
  });

  it('restarts again after the consecutive window expires', () => {
    resetPreviousTrackAction();
    expect(consumePreviousTrackAction(1000)).toBe('restart');
    expect(consumePreviousTrackAction(1001 + PREVIOUS_RESTART_WINDOW_MS)).toBe('restart');
  });
});

describe('playbackAppleScript', () => {
  it('seeks to zero on the first previous press', () => {
    resetPreviousTrackAction();
    expect(playbackAppleScript('Music', 'MediaTrackPrevious')).toBe(
      'tell application "Music" to set player position to 0'
    );
    expect(playbackAppleScript('Spotify', 'MediaTrackPrevious')).toBe(
      'tell application "Spotify" to previous track'
    );
  });

  it('resets consecutive previous when skipping forward', () => {
    resetPreviousTrackAction();
    playbackAppleScript('Music', 'MediaTrackPrevious');
    expect(playbackAppleScript('Music', 'MediaTrackNext')).toBe(
      'tell application "Music" to next track'
    );
    expect(playbackAppleScript('Music', 'MediaTrackPrevious')).toBe(
      'tell application "Music" to set player position to 0'
    );
  });
});
