import { PNG } from 'pngjs';

export interface EncodedRgb565Frame {
  rgb565: Buffer;
  previewPng: Buffer;
}

export function applyRgb565OrderedDither(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 0.85
): void {
  const matrix = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
  ];
  const expand5 = (value: number): number => (value << 3) | (value >> 2);
  const expand6 = (value: number): number => (value << 2) | (value >> 4);
  const quantize = (
    value: number,
    levels: number,
    threshold: number
  ): number => {
    const step = 255 / levels;
    const adjusted = value + threshold * step * strength;
    return Math.min(levels, Math.max(0, Math.round((adjusted * levels) / 255)));
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] === 0) continue;
      const threshold = (matrix[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
      data[offset] = expand5(quantize(data[offset], 31, threshold));
      data[offset + 1] = expand6(quantize(data[offset + 1], 63, threshold));
      data[offset + 2] = expand5(quantize(data[offset + 2], 31, threshold));
    }
  }
}

export function encodeRgb565(png: PNG): EncodedRgb565Frame {
  const rgb565 = Buffer.alloc(png.width * png.height * 2);
  const preview = new PNG({ width: png.width, height: png.height });

  for (let index = 0; index < png.width * png.height; index++) {
    const pixel = index * 4;
    const red = png.data[pixel] >> 3;
    const green = png.data[pixel + 1] >> 2;
    const blue = png.data[pixel + 2] >> 3;
    const value = (red << 11) | (green << 5) | blue;
    rgb565.writeUInt16LE(value, index * 2);
    preview.data[pixel] = (red << 3) | (red >> 2);
    preview.data[pixel + 1] = (green << 2) | (green >> 4);
    preview.data[pixel + 2] = (blue << 3) | (blue >> 2);
    preview.data[pixel + 3] = 255;
  }

  return {
    rgb565,
    previewPng: PNG.sync.write(preview),
  };
}
