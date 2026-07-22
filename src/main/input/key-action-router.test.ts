import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyboardSettings } from '../../shared/types';

vi.mock('electron', () => ({ globalShortcut: {} }));

import { KeyActionRouter } from './key-action-router';

describe('KeyActionRouter', () => {
  let callbacks: Map<string, () => void>;
  let register: ReturnType<
    typeof vi.fn<(accelerator: string, callback: () => void) => boolean>
  >;
  let unregister: ReturnType<typeof vi.fn<(accelerator: string) => void>>;

  beforeEach(() => {
    callbacks = new Map();
    register = vi.fn((accelerator: string, callback: () => void) => {
      callbacks.set(accelerator, callback);
      return true;
    });
    unregister = vi.fn((accelerator: string) => {
      callbacks.delete(accelerator);
    });
  });

  it('활성화 시 F16~F18만 등록하고 활성 프로파일 동작을 실행한다', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const settings = createDefaultKeyboardSettings();
    settings.enabled = true;
    settings.activeProfileId = 3;
    settings.profiles[3].assignments.right = {
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    };
    const router = new KeyActionRouter(execute, { register, unregister });

    const status = router.configure(settings);
    expect(status.shortcutState).toBe('active');
    expect(status.deviceApplySupported).toBe(true);
    expect(register.mock.calls.map(([accelerator]) => accelerator)).toEqual([
      'F16',
      'F17',
      'F18',
    ]);
    callbacks.get('F18')?.();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith(settings.profiles[3].assignments.right));
  });

  it('해제와 실패 정리에서도 F19/F20을 건드리지 않는다', () => {
    const settings = createDefaultKeyboardSettings();
    settings.enabled = true;
    register.mockImplementation((accelerator: string, callback: () => void) => {
      callbacks.set(accelerator, callback);
      return accelerator !== 'F17';
    });
    const router = new KeyActionRouter(vi.fn(), { register, unregister });

    expect(router.configure(settings).shortcutState).toBe('error');
    router.dispose();
    expect(new Set(unregister.mock.calls.flat())).toEqual(
      new Set(['F16', 'F17', 'F18'])
    );
  });

  it('프로파일 선택 즉시 세 버튼을 선택 프로파일 동작으로 라우팅한다', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const settings = createDefaultKeyboardSettings();
    settings.enabled = true;
    settings.activeProfileId = 2;
    settings.profiles[4].assignments.left = {
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    };
    const router = new KeyActionRouter(execute, { register, unregister });

    router.configure(settings);
    callbacks.get('F16')?.();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenLastCalledWith(settings.profiles[2].assignments.left);
    });

    router.selectProfile(4);
    callbacks.get('F16')?.();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenLastCalledWith(settings.profiles[4].assignments.left);
    });
    expect(register).toHaveBeenCalledTimes(3);
  });
});
