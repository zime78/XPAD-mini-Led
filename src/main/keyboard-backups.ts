import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  KeyboardBackupInput,
  KeyboardBackupList,
  KeyboardSettings,
  KeyboardSettingsBackup,
} from '../shared/types';
import {
  normalizeBackupText,
  normalizeKeyboardSettings,
} from './keyboard-settings';

export const MAX_KEYBOARD_BACKUPS = 10;

interface BackupFile {
  schemaVersion: 1;
  items: KeyboardSettingsBackup[];
}

export class KeyboardBackupStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'keyboard-backups.json');
  }

  list(): KeyboardBackupList {
    const { items, warning } = this.readFile();
    return {
      items: sortNewestFirst(items).map((item) => structuredClone(item)),
      maxItems: MAX_KEYBOARD_BACKUPS,
      warning,
    };
  }

  create(input: KeyboardBackupInput): KeyboardBackupList {
    const items = this.readForMutation();
    if (items.length >= MAX_KEYBOARD_BACKUPS) {
      throw new Error('백업은 최대 10개까지 저장할 수 있습니다.');
    }
    items.push(this.createItem(crypto.randomUUID(), input));
    this.writeFile(items);
    return this.list();
  }

  overwrite(id: string, input: KeyboardBackupInput): KeyboardBackupList {
    const items = this.readForMutation();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('덮어쓸 백업을 찾지 못했습니다.');
    items[index] = this.createItem(id, input);
    this.writeFile(items);
    return this.list();
  }

  delete(id: string): KeyboardBackupList {
    const items = this.readForMutation();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) throw new Error('삭제할 백업을 찾지 못했습니다.');
    this.writeFile(next);
    return this.list();
  }

  load(id: string): KeyboardSettings {
    const { items } = this.readFile();
    const item = items.find((backup) => backup.id === id);
    if (!item) throw new Error('복원할 백업을 찾지 못했습니다.');
    return structuredClone({
      enabled: item.enabled,
      activeProfileId: item.activeProfileId,
      profiles: item.profiles,
    });
  }

  private createItem(id: string, input: KeyboardBackupInput): KeyboardSettingsBackup {
    const settings = normalizeKeyboardSettings(input.settings);
    return {
      schemaVersion: 1,
      id,
      name: normalizeBackupText(input.name, 40, true),
      description: normalizeBackupText(input.description, 500, false),
      createdAt: new Date().toISOString(),
      enabled: settings.enabled,
      activeProfileId: settings.activeProfileId,
      profiles: structuredClone(settings.profiles),
    };
  }

  private readForMutation(): KeyboardSettingsBackup[] {
    const { items, warning } = this.readFile();
    if (warning) throw new Error(warning);
    return items;
  }

  private readFile(): { items: KeyboardSettingsBackup[]; warning: string | null } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      if (isMissingFile(error)) return { items: [], warning: null };
      return {
        items: [],
        warning: '백업 파일을 읽지 못했습니다. 새 백업을 저장하기 전에 파일 상태를 확인하세요.',
      };
    }

    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.items)
    ) {
      return { items: [], warning: '백업 파일 형식이 올바르지 않습니다.' };
    }

    const items: KeyboardSettingsBackup[] = [];
    const ids = new Set<string>();
    let skipped = Math.max(0, parsed.items.length - MAX_KEYBOARD_BACKUPS);
    for (const value of parsed.items.slice(0, MAX_KEYBOARD_BACKUPS)) {
      const item = normalizeStoredBackup(value);
      if (item && !ids.has(item.id)) {
        items.push(item);
        ids.add(item.id);
      } else {
        skipped++;
      }
    }
    return {
      items,
      warning: skipped > 0 ? `손상된 백업 ${skipped}개를 제외했습니다.` : null,
    };
  }

  private writeFile(items: KeyboardSettingsBackup[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const body: BackupFile = {
      schemaVersion: 1,
      items: sortNewestFirst(items).slice(0, MAX_KEYBOARD_BACKUPS),
    };
    try {
      fs.writeFileSync(tempPath, JSON.stringify(body, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // 임시 파일이 이미 없으면 정리할 것이 없다.
      }
      throw error;
    }
  }
}

function normalizeStoredBackup(value: unknown): KeyboardSettingsBackup | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    return null;
  }
  try {
    const settings = normalizeKeyboardSettings({
      enabled: value.enabled,
      activeProfileId: value.activeProfileId,
      profiles: value.profiles,
    });
    return {
      schemaVersion: 1,
      id: value.id,
      name: normalizeBackupText(value.name, 40, true),
      description: normalizeBackupText(value.description, 500, false),
      createdAt: value.createdAt,
      enabled: settings.enabled,
      activeProfileId: settings.activeProfileId,
      profiles: settings.profiles,
    };
  } catch {
    return null;
  }
}

function sortNewestFirst(items: KeyboardSettingsBackup[]): KeyboardSettingsBackup[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
