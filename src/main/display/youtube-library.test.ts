import { describe, expect, it } from 'vitest';
import {
  DEFAULT_YOUTUBE_VIDEO_ID,
  createDefaultYoutubeLibrary,
} from '../../shared/types';
import {
  addYoutubeVideo,
  currentYoutubeItem,
  moveYoutubeVideo,
  normalizeYoutubeLibrary,
  removeYoutubeVideo,
  sameYoutubePlayback,
  stepYoutubeIndex,
  withYoutubeQueue,
} from './youtube-library';

describe('normalizeYoutubeLibrary', () => {
  it('fills the sample video when the value is missing', () => {
    expect(normalizeYoutubeLibrary(undefined)).toEqual(createDefaultYoutubeLibrary());
  });

  it('keeps an explicit empty list', () => {
    expect(normalizeYoutubeLibrary({ items: [], currentIndex: 3 })).toEqual({
      items: [],
      currentIndex: -1,
    });
  });

  it('drops invalid ids, duplicates, and clamps the index', () => {
    const library = normalizeYoutubeLibrary({
      currentIndex: 99,
      items: [
        { videoId: 'RDnotavide', title: 'mix', channel: '', addedAt: '' },
        {
          videoId: DEFAULT_YOUTUBE_VIDEO_ID,
          title: 'One',
          channel: 'A',
          addedAt: '2026-02-01T00:00:00.000Z',
        },
        {
          videoId: DEFAULT_YOUTUBE_VIDEO_ID,
          title: 'Dup',
          channel: 'B',
          addedAt: '2026-03-01T00:00:00.000Z',
        },
        {
          videoId: 'abcdefghijk',
          title: 'Two',
          channel: 'C',
          addedAt: '2026-04-01T00:00:00.000Z',
        },
      ],
    });
    expect(library.items.map((item) => item.videoId)).toEqual([
      DEFAULT_YOUTUBE_VIDEO_ID,
      'abcdefghijk',
    ]);
    expect(library.currentIndex).toBe(1);
  });
});

describe('currentYoutubeItem', () => {
  it('returns the selected item or the default id', () => {
    const library = createDefaultYoutubeLibrary();
    expect(currentYoutubeItem(library)?.videoId).toBe(DEFAULT_YOUTUBE_VIDEO_ID);
    expect(currentYoutubeItem({ items: [], currentIndex: -1 })).toBeNull();
  });
});

describe('withYoutubeQueue', () => {
  it('copies the library cursor onto playback info', () => {
    const info = withYoutubeQueue(
      {
        videoId: DEFAULT_YOUTUBE_VIDEO_ID,
        title: 'A',
        channel: 'B',
        state: 'playing',
        duration: 10,
        position: 1,
        signedIn: false,
        adPlaying: false,
      },
      { items: createDefaultYoutubeLibrary().items, currentIndex: 0 }
    );
    expect(info.queueIndex).toBe(0);
    expect(info.queueCount).toBe(1);
  });
});

describe('sameYoutubePlayback', () => {
  it('treats whole-second position changes as a new snapshot', () => {
    const left = withYoutubeQueue(
      {
        videoId: 'abcdefghijk',
        title: 'A',
        channel: 'B',
        state: 'playing',
        duration: 10,
        position: 1,
        signedIn: false,
        adPlaying: false,
      },
      createDefaultYoutubeLibrary()
    );
    expect(sameYoutubePlayback(left, { ...left, position: 1.4 })).toBe(true);
    expect(sameYoutubePlayback(left, { ...left, position: 8 })).toBe(false);
    expect(sameYoutubePlayback(left, { ...left, title: 'C' })).toBe(false);
  });
});

describe('youtube library mutations', () => {
  it('adds, steps, moves, and removes items', () => {
    let library = createDefaultYoutubeLibrary();
    library = addYoutubeVideo(library, {
      videoId: 'abcdefghijk',
      title: 'Two',
      channel: 'C',
      addedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(library.items).toHaveLength(2);
    library = stepYoutubeIndex(library, 1);
    expect(library.currentIndex).toBe(1);
    library = moveYoutubeVideo(library, 1, -1);
    expect(library.items[0].videoId).toBe('abcdefghijk');
    expect(library.currentIndex).toBe(0);
    library = removeYoutubeVideo(library, 0);
    expect(library.items[0].videoId).toBe(DEFAULT_YOUTUBE_VIDEO_ID);
    library = removeYoutubeVideo(library, 0);
    expect(library).toEqual({ items: [], currentIndex: -1 });
  });
});
