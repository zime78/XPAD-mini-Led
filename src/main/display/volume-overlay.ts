export interface VolumeFeedback {
  volume: number;
}

export function normalizeVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(100, Math.max(0, Math.round(volume)));
}
