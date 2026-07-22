import { describe, expect, it, vi } from 'vitest';
import { selectPlaybackApplication } from './playback-controls';

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
