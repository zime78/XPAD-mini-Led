import { describe, expect, it } from 'vitest';
import { EMPTY_TRACK, type TrackInfo } from '../../shared/types';
import { resolveDisplayTrack } from './display-state';

const playing: TrackInfo = {
  service: 'apple-music',
  state: 'playing',
  id: '1',
  title: 'You Were My Twenties',
  artist: '이예준',
  album: 'Heart Breaking Story 1,2,3 - Single',
  duration: 200,
  position: 10,
};

describe('resolveDisplayTrack', () => {
  it('keeps a playing or paused track', () => {
    expect(resolveDisplayTrack(playing).title).toBe(playing.title);
    expect(resolveDisplayTrack({ ...playing, state: 'paused' }).state).toBe('paused');
  });

  it('uses the empty default when there is no track to show', () => {
    expect(resolveDisplayTrack(null)).toEqual(EMPTY_TRACK);
    expect(resolveDisplayTrack(structuredClone(EMPTY_TRACK))).toEqual(EMPTY_TRACK);
    expect(resolveDisplayTrack({ ...playing, state: 'stopped' })).toEqual(EMPTY_TRACK);
    expect(resolveDisplayTrack({ ...playing, title: '   ' })).toEqual(EMPTY_TRACK);
  });
});
