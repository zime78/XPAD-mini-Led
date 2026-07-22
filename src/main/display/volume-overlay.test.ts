import { describe, expect, it } from 'vitest';
import { renderVolumeOverlay } from './volume-overlay';

describe('renderVolumeOverlay', () => {
  it('returns no markup without active feedback', () => {
    expect(renderVolumeOverlay(null, '#fa2d48')).toBe('');
  });

  it('renders the current volume and proportional bar', () => {
    const markup = renderVolumeOverlay({ volume: 64 }, '#1ed760');

    expect(markup).toContain('id="volume-feedback"');
    expect(markup).toContain('>64<tspan');
    expect(markup).toContain('width="92" height="7"');
    expect(markup).toContain('fill="#1ed760"');
  });

  it('clamps boundary values and marks zero volume as muted', () => {
    const muted = renderVolumeOverlay({ volume: -10 }, '#fa2d48');
    const maximum = renderVolumeOverlay({ volume: 140 }, '#fa2d48');

    expect(muted).toContain('>0<tspan');
    expect(muted).toContain('width="0" height="7"');
    expect(muted).toContain('stroke="#fa2d48"');
    expect(maximum).toContain('>100<tspan');
    expect(maximum).toContain('width="144" height="7"');
  });
});
