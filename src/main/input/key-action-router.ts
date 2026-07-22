import { EventEmitter } from 'node:events';
import { globalShortcut } from 'electron';
import type {
  KeyboardAction,
  KeyboardRuntimeStatus,
  KeyboardSettings,
  KeyboardSlot,
} from '../../shared/types';

const SHORTCUTS: Record<KeyboardSlot, string> = {
  left: 'F16',
  center: 'F17',
  right: 'F18',
};

interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export const KEYBOARD_DEVICE_APPLY_REASON =
  'Profile 1은 고정하며 Profile 2~5 실제 설정 읽기만 지원합니다. 일반 키 쓰기·실패 시 전체 원복 검증이 완료될 때까지 장치 적용은 비활성화됩니다.';

export class KeyActionRouter extends EventEmitter {
  private settings: KeyboardSettings | null = null;
  private shortcutState: KeyboardRuntimeStatus['shortcutState'] = 'disabled';
  private shortcutError: string | null = null;

  constructor(
    private readonly execute: (action: KeyboardAction) => Promise<void>,
    private readonly registry: ShortcutRegistry = globalShortcut
  ) {
    super();
  }

  configure(settings: KeyboardSettings): KeyboardRuntimeStatus {
    this.unregisterOwnedShortcuts();
    this.settings = structuredClone(settings);
    if (!settings.enabled) {
      this.shortcutState = 'disabled';
      this.shortcutError = null;
      this.emit('status');
      return this.status;
    }

    const failed: string[] = [];
    for (const [slot, accelerator] of Object.entries(SHORTCUTS) as Array<
      [KeyboardSlot, string]
    >) {
      const registered = this.registry.register(accelerator, () => {
        void this.run(slot);
      });
      if (!registered) failed.push(accelerator);
    }
    if (failed.length > 0) {
      this.unregisterOwnedShortcuts();
      this.shortcutState = 'error';
      this.shortcutError = `${failed.join(', ')} 단축키를 등록하지 못했습니다.`;
    } else {
      this.shortcutState = 'active';
      this.shortcutError = null;
    }
    this.emit('status');
    return this.status;
  }

  get status(): KeyboardRuntimeStatus {
    return {
      shortcutState: this.shortcutState,
      shortcutError: this.shortcutError,
      deviceApplySupported: false,
      deviceApplyReason: KEYBOARD_DEVICE_APPLY_REASON,
    };
  }

  dispose(): void {
    this.unregisterOwnedShortcuts();
    this.settings = null;
    this.shortcutState = 'disabled';
    this.shortcutError = null;
    this.removeAllListeners();
  }

  private async run(slot: KeyboardSlot): Promise<void> {
    const settings = this.settings;
    if (!settings || !settings.enabled) return;
    const action = settings.profiles[settings.activeProfileId].assignments[slot];
    try {
      await this.execute(action);
      if (this.shortcutError) {
        this.shortcutError = null;
        this.emit('status');
      }
    } catch (error) {
      this.shortcutError = error instanceof Error ? error.message : String(error);
      this.emit('status');
    }
  }

  private unregisterOwnedShortcuts(): void {
    for (const accelerator of Object.values(SHORTCUTS)) {
      this.registry.unregister(accelerator);
    }
  }
}
