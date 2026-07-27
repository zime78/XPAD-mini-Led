import { describe, expect, it } from 'vitest';
import { normalizeVolume } from './volume-overlay';

describe('normalizeVolume', () => {
  it('rounds and clamps volume values', () => {
    expect(normalizeVolume(63.6)).toBe(64);
    expect(normalizeVolume(-10)).toBe(0);
    expect(normalizeVolume(140)).toBe(100);
    expect(normalizeVolume(Number.NaN)).toBe(0);
  });
});
