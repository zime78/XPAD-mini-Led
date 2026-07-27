import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { applyRgb565OrderedDither, encodeRgb565 } from './frame-pipeline';

describe('applyRgb565OrderedDither', () => {
  it('creates RGB565 palette values with an ordered 4x4 pattern', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let index = 0; index < 16; index++) {
      data.set([128, 128, 128, 255], index * 4);
    }

    applyRgb565OrderedDither(data, 4, 4);

    const reds = new Set(Array.from({ length: 16 }, (_, index) => data[index * 4]));
    expect(reds.size).toBeGreaterThan(1);
    expect([...reds].every((value) => {
      const channel = value >> 3;
      return value === ((channel << 3) | (channel >> 2));
    })).toBe(true);
  });
});

describe('encodeRgb565', () => {
  it('encodes little-endian RGB565 and reconstructs an exact device preview', () => {
    const png = new PNG({ width: 3, height: 1 });
    png.data.set([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ]);

    const encoded = encodeRgb565(png);
    const preview = PNG.sync.read(encoded.previewPng);

    expect([...encoded.rgb565]).toEqual([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00]);
    expect([...preview.data]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ]);
  });

  it('shows RGB565 quantization in the preview instead of the source color', () => {
    const png = new PNG({ width: 1, height: 1 });
    png.data.set([123, 126, 129, 255]);

    const encoded = encodeRgb565(png);
    const preview = PNG.sync.read(encoded.previewPng);

    expect([...preview.data]).toEqual([123, 125, 132, 255]);
  });
});
