import { beforeEach, describe, expect, it, vi } from 'vitest';

const shortcutMocks = vi.hoisted(() => ({
  callbacks: new Map<string, () => void>(),
  register: vi.fn<(accelerator: string, callback: () => void) => boolean>(),
  unregister: vi.fn<(accelerator: string) => void>(),
}));

vi.mock('electron', () => ({
  globalShortcut: {
    register: shortcutMocks.register,
    unregister: shortcutMocks.unregister,
  },
}));

import type { DiagnosticLog } from '../diagnostic-log';
import {
  type FineVolumeAdjustment,
  FineVolumeController,
} from './fine-volume';

describe('FineVolumeController', () => {
  beforeEach(() => {
    shortcutMocks.callbacks.clear();
    shortcutMocks.register.mockReset().mockImplementation((accelerator, callback) => {
      shortcutMocks.callbacks.set(accelerator, callback);
      return true;
    });
    shortcutMocks.unregister.mockReset();
  });

  it('emits the applied output volume after a knob adjustment', async () => {
    const result = {
      before: 60,
      target: 64,
      after: 64,
      requestedSteps: 2,
      movedSteps: 2,
      attemptCount: 4,
    };
    const adjustVolume = vi.fn(async () => result);
    const diagnostics: Pick<DiagnosticLog, 'log'> = { log: vi.fn() };
    const controller = new FineVolumeController(diagnostics, adjustVolume);
    const adjusted = new Promise<FineVolumeAdjustment>((resolve) => {
      controller.once('volume-adjusted', resolve);
    });

    expect(controller.configure(true, 2)).toBe(true);
    shortcutMocks.callbacks.get('F19')?.();

    await expect(adjusted).resolves.toEqual({
      volume: 64,
    });
    expect(adjustVolume).toHaveBeenCalledWith(1, 2);
    controller.dispose();
  });
});
