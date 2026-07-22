export interface VolumeFeedback {
  volume: number;
}

const BAR_WIDTH = 144;

export function renderVolumeOverlay(
  feedback: VolumeFeedback | null,
  accent: string
): string {
  if (!feedback) return '';
  const volume = normalizeVolume(feedback.volume);
  const filledWidth = Math.round((BAR_WIDTH * volume) / 100);
  const soundWaves =
    volume === 0
      ? '<path d="M67 52l16 26" fill="none" stroke="#fa2d48" stroke-width="3" stroke-linecap="round"/>'
      : '<path d="M72 57c4 3 4 9 0 12M77 52c8 7 8 17 0 23" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.9"/>';

  return `
  <g id="volume-feedback">
    <rect x="24" y="16" width="192" height="103" rx="14" fill="#05070a" fill-opacity="0.95" stroke="${accent}" stroke-width="1.5"/>
    <path d="M47 58h9l11-9v28l-11-9h-9z" fill="#ffffff"/>
    ${soundWaves}
    <text x="94" y="48" font-family="Apple SD Gothic Neo, Arial Unicode MS, sans-serif" font-size="9" font-weight="700" letter-spacing="1.4" fill="#a0aec0">VOLUME</text>
    <text x="192" y="82" text-anchor="end" font-family="Apple SD Gothic Neo, Arial Unicode MS, sans-serif" font-size="34" font-weight="700" fill="#ffffff">${volume}<tspan font-size="15" fill="#cbd5e1">%</tspan></text>
    <rect x="48" y="98" width="${BAR_WIDTH}" height="7" rx="3.5" fill="#263141"/>
    <rect x="48" y="98" width="${filledWidth}" height="7" rx="3.5" fill="${accent}"/>
  </g>`;
}

function normalizeVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(100, Math.max(0, Math.round(volume)));
}
