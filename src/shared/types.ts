export type MusicService = 'spotify' | 'apple-music' | 'none';

export type ServicePreference = 'automatic' | Exclude<MusicService, 'none'>;

export type PlaybackState = 'playing' | 'paused' | 'stopped';

export type KnobFineVolumeState = 'disabled' | 'pending' | 'active' | 'error';

export interface KnobKeymapBackup {
  left: string;
  right: string;
}

export interface TrackInfo {
  service: MusicService;
  state: PlaybackState;
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  artworkDataUrl?: string;
}

export interface AppConfig {
  servicePreference: ServicePreference;
  pollIntervalMs: number;
  showArtwork: boolean;
  showProgress: boolean;
  fineVolumeEnabled: boolean;
  fineVolumeStepsPerDetent: number;
  knobKeymapBackup?: KnobKeymapBackup;
  launchAtLogin: boolean;
}

export interface StatusSnapshot {
  deviceConnected: boolean;
  protocolReady: boolean;
  track: TrackInfo;
  monitorError: string | null;
  previewDataUrl: string | null;
  knobFineVolumeState: KnobFineVolumeState;
  knobFineVolumeError: string | null;
}

export const EMPTY_TRACK: TrackInfo = {
  service: 'none',
  state: 'stopped',
  id: '',
  title: '재생 중인 음악 없음',
  artist: 'Spotify 또는 Apple Music을 재생하세요',
  album: '',
  duration: 0,
  position: 0,
};

export const DEFAULT_CONFIG: AppConfig = {
  servicePreference: 'automatic',
  pollIntervalMs: 1500,
  showArtwork: true,
  showProgress: true,
  fineVolumeEnabled: true,
  fineVolumeStepsPerDetent: 1,
  launchAtLogin: false,
};
