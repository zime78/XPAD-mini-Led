import { globalShortcut } from 'electron';
import { exec } from 'node:child_process';
import { AppConfig, KeyId } from '../../shared/types';
import { getFocusedProcessName } from './focused-app';
import { sendKeys } from './send-keys';

export type KeyPressListener = (key: KeyId, executed: boolean) => void;

/**
 * Registers the pad's keys (F13/F14/F15 after device remap) as global
 * shortcuts and runs the configured action. Keys with action "none" are left
 * unregistered so other apps (e.g. Wispr Flow bound directly to F14) receive
 * them.
 */
export class HotkeyManager {
  private listener: KeyPressListener | null = null;

  onKeyPress(listener: KeyPressListener): void {
    this.listener = listener;
  }

  apply(config: AppConfig): void {
    globalShortcut.unregisterAll();
    for (const keyId of ['left', 'center', 'right'] as KeyId[]) {
      const action = config.keys[keyId];
      const accelerator = config.hotkeys[keyId];
      if (!accelerator || action.type === 'none') continue;
      try {
        const ok = globalShortcut.register(accelerator, () => {
          void this.execute(keyId, config);
        });
        if (!ok) console.error(`[hotkeys] failed to register ${accelerator}`);
      } catch (err) {
        console.error(`[hotkeys] register ${accelerator} threw`, err);
      }
    }
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
  }

  private async execute(keyId: KeyId, config: AppConfig): Promise<void> {
    const action = config.keys[keyId];
    let executed = false;
    try {
      switch (action.type) {
        case 'approve':
        case 'reject': {
          if (config.guardEnabled && !(await this.focusedAppAllowed(config))) {
            console.log(`[hotkeys] ${keyId}: blocked by focus guard`);
            break;
          }
          await sendKeys(action.keys || (action.type === 'approve' ? 'Enter' : 'Escape'));
          executed = true;
          break;
        }
        case 'hotkey': {
          // Dictation etc. should work anywhere: no focus guard.
          if (action.keys) {
            await sendKeys(action.keys);
            executed = true;
          }
          break;
        }
        case 'command': {
          if (action.command) {
            exec(action.command, (err) => {
              if (err) console.error(`[hotkeys] command failed`, err);
            });
            executed = true;
          }
          break;
        }
        case 'none':
          break;
      }
    } catch (err) {
      console.error(`[hotkeys] action for ${keyId} failed`, err);
    }
    this.listener?.(keyId, executed);
  }

  private async focusedAppAllowed(config: AppConfig): Promise<boolean> {
    const name = await getFocusedProcessName();
    if (!name) return false;
    return config.processAllowlist.some((entry) =>
      name.includes(entry.toLowerCase())
    );
  }
}
