export interface TextBlockLayout {
  lines: string[];
  fontSize: number;
  truncated: boolean;
}

export type TextWidthMeasurer = (value: string, fontSize: number) => number;

export function fitTextBlock(
  value: string,
  maxWidth: number,
  minimumFontSize: number,
  maximumFontSize: number,
  maxLines: number,
  measure: TextWidthMeasurer
): TextBlockLayout {
  const normalized = (value || '').trim().replace(/\s+/gu, ' ');
  const firstFontSize = Math.max(minimumFontSize, maximumFontSize);
  const lastFontSize = Math.min(minimumFontSize, maximumFontSize);
  const lineLimit = Math.max(1, Math.floor(maxLines));

  const segmentGraphemes = (text: string): string[] => {
    try {
      return Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
        ({ segment }) => segment
      );
    } catch {
      return Array.from(text);
    }
  };

  const segmentWords = (text: string): string[] => {
    try {
      return Array.from(
        new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text),
        ({ segment }) => segment
      );
    } catch {
      return text.split(/(\s+)/u).filter(Boolean);
    }
  };

  const wrapAtSize = (fontSize: number): string[] => {
    if (!normalized) return [''];
    const lines: string[] = [];
    let current = '';

    const pushCurrent = (): void => {
      const line = current.trimEnd();
      if (line) lines.push(line);
      current = '';
    };

    const appendOversizedToken = (token: string): void => {
      for (const grapheme of segmentGraphemes(token)) {
        const candidate = `${current}${grapheme}`;
        if (current && measure(candidate, fontSize) > maxWidth) {
          pushCurrent();
        }
        current += grapheme;
      }
    };

    for (const token of segmentWords(normalized)) {
      if (!current && /^\s+$/u.test(token)) continue;
      const candidate = `${current}${token}`;
      if (measure(candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current.trim()) pushCurrent();
      const trimmedToken = token.trimStart();
      if (!trimmedToken) continue;
      if (measure(trimmedToken, fontSize) <= maxWidth) {
        current = trimmedToken;
      } else {
        appendOversizedToken(trimmedToken);
      }
    }
    pushCurrent();
    return lines.length > 0 ? lines : [''];
  };

  const ellipsize = (line: string, fontSize: number): string => {
    const ellipsis = '…';
    const graphemes = segmentGraphemes(line.trimEnd());
    while (
      graphemes.length > 0 &&
      measure(`${graphemes.join('')}${ellipsis}`, fontSize) > maxWidth
    ) {
      graphemes.pop();
    }
    return measure(ellipsis, fontSize) <= maxWidth
      ? `${graphemes.join('')}${ellipsis}`
      : '';
  };

  for (let fontSize = firstFontSize; fontSize >= lastFontSize; fontSize--) {
    const lines = wrapAtSize(fontSize);
    if (lines.length <= lineLimit) {
      return { lines, fontSize, truncated: false };
    }
  }

  const lines = wrapAtSize(lastFontSize).slice(0, lineLimit);
  lines[lineLimit - 1] = ellipsize(lines[lineLimit - 1] || '', lastFontSize);
  return { lines, fontSize: lastFontSize, truncated: true };
}
