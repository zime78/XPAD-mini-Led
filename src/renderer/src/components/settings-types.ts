import type { AppConfig } from '../../../shared/types';

export type ConfigPatch = (change: (draft: AppConfig) => void) => void;
