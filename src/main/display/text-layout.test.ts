import { describe, expect, it } from 'vitest';
import { fitTextBlock } from './text-layout';

const measureMonospace = (value: string, fontSize: number): number =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)
  ).length * fontSize;

describe('fitTextBlock', () => {
  it('wraps an English title at word boundaries', () => {
    const layout = fitTextBlock('Break My Heart', 80, 10, 10, 2, measureMonospace);

    expect(layout.lines).toEqual(['Break My', 'Heart']);
    expect(layout.truncated).toBe(false);
  });

  it('falls back to grapheme boundaries for long unbroken text', () => {
    const layout = fitTextBlock('가나다라마바사아자차카타파하', 50, 10, 10, 2, measureMonospace);

    expect(layout.lines).toEqual(['가나다라마', '바사아자…']);
    expect(layout.truncated).toBe(true);
  });

  it('does not split a joined emoji sequence', () => {
    const layout = fitTextBlock('A 👨‍👩‍👧‍👦 B', 30, 10, 10, 2, measureMonospace);

    expect(layout.lines).toEqual(['A 👨‍👩‍👧‍👦', 'B']);
    expect(layout.lines.some((line) => line.includes('\u200d'))).toBe(true);
  });

  it('selects the largest font size that fits without truncation', () => {
    const layout = fitTextBlock('AB CD', 40, 8, 12, 1, measureMonospace);

    expect(layout.fontSize).toBe(8);
    expect(layout.lines).toEqual(['AB CD']);
  });
});
