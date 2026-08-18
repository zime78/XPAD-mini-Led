import { describe, expect, it } from 'vitest';
import { LCD_HEIGHT, LCD_WIDTH } from '../device/protocol';
import {
  blendRgbaOverRgb565,
  normalizeVolume,
  volumeOverlayDrawSource,
} from './volume-overlay';

describe('normalizeVolume', () => {
  it('rounds and clamps volume values', () => {
    expect(normalizeVolume(63.6)).toBe(64);
    expect(normalizeVolume(-10)).toBe(0);
    expect(normalizeVolume(140)).toBe(100);
    expect(normalizeVolume(Number.NaN)).toBe(0);
  });
});

describe('volumeOverlayDrawSource', () => {
  it('keeps the P1 VOLUME card drawing', () => {
    expect(volumeOverlayDrawSource()).toContain('VOLUME');
    expect(volumeOverlayDrawSource()).toContain('drawVolumeOverlay');
  });
});

describe('blendRgbaOverRgb565', () => {
  it('paints opaque overlay pixels onto a copy', () => {
    const base = Buffer.alloc(LCD_WIDTH * LCD_HEIGHT * 2, 0);
    const overlay = Buffer.alloc(LCD_WIDTH * LCD_HEIGHT * 4, 0);
    overlay[0] = 255;
    overlay[1] = 0;
    overlay[2] = 0;
    overlay[3] = 255;
    const painted = blendRgbaOverRgb565(base, overlay);
    expect(base.readUInt16LE(0)).toBe(0);
    expect(painted.readUInt16LE(0)).toBe(0xf800);
  });
});
