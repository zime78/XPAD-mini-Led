import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultKeyboardSettings } from '../shared/types';
import { KeyboardBackupStore } from './keyboard-backups';

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createStore(): KeyboardBackupStore {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xpad-keyboard-backups-'));
  tempDirs.push(directory);
  return new KeyboardBackupStore(directory);
}

function createStoreWithDirectory(): {
  store: KeyboardBackupStore;
  directory: string;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xpad-keyboard-backups-'));
  tempDirs.push(directory);
  return { store: new KeyboardBackupStore(directory), directory };
}

describe('KeyboardBackupStore', () => {
  it('P1 변경 시도는 버리고 이름·설명과 P2~P5 설정을 정확히 복원한다', () => {
    const store = createStore();
    const settings = createDefaultKeyboardSettings();
    settings.enabled = true;
    settings.activeProfileId = 5;
    settings.profiles[1].assignments.left = {
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    };
    settings.profiles[2].assignments.left = {
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    };
    const created = store.create({
      name: '작업용',
      description: 'P2~P5 프로파일',
      settings,
    });

    expect(created.items).toHaveLength(1);
    expect(created.items[0].name).toBe('작업용');
    const restored = store.load(created.items[0].id);
    expect(restored.profiles[1].assignments.left).toEqual({
      type: 'key',
      keyCode: 'MediaTrackPrevious',
    });
    expect(restored.profiles[2].assignments.left).toEqual(
      settings.profiles[2].assignments.left
    );
  });

  it('최대 10개만 저장하고 11번째 저장은 파일을 변경하지 않는다', () => {
    const store = createStore();
    const settings = createDefaultKeyboardSettings();
    for (let index = 1; index <= 10; index++) {
      store.create({ name: `백업 ${index}`, description: '', settings });
    }

    expect(() =>
      store.create({ name: '백업 11', description: '', settings })
    ).toThrow('최대 10개');
    expect(store.list().items).toHaveLength(10);
  });

  it('선택 백업 덮어쓰기와 삭제를 ID 기준으로 수행한다', () => {
    const store = createStore();
    const settings = createDefaultKeyboardSettings();
    const first = store.create({ name: '초기', description: '', settings }).items[0];
    settings.activeProfileId = 3;

    const overwritten = store.overwrite(first.id, {
      name: '변경',
      description: '설명',
      settings,
    });
    expect(overwritten.items[0]).toMatchObject({ id: first.id, name: '변경' });
    expect(store.load(first.id).activeProfileId).toBe(3);
    expect(store.delete(first.id).items).toHaveLength(0);
  });

  it('손상된 백업 파일을 새 데이터로 덮어쓰지 않는다', () => {
    const { store, directory } = createStoreWithDirectory();
    const filePath = path.join(directory, 'keyboard-backups.json');
    fs.writeFileSync(filePath, '{invalid json', 'utf8');

    expect(store.list().warning).toContain('읽지 못했습니다');
    expect(() =>
      store.create({
        name: '새 백업',
        description: '',
        settings: createDefaultKeyboardSettings(),
      })
    ).toThrow('파일 상태를 확인하세요');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{invalid json');
  });

  it('지원하지 않는 백업 스키마를 읽거나 덮어쓰지 않는다', () => {
    const { store, directory } = createStoreWithDirectory();
    const filePath = path.join(directory, 'keyboard-backups.json');
    const unsupported = JSON.stringify({ schemaVersion: 2, items: [] });
    fs.writeFileSync(filePath, unsupported, 'utf8');

    expect(store.list().warning).toContain('형식이 올바르지 않습니다');
    expect(() =>
      store.create({
        name: '새 백업',
        description: '',
        settings: createDefaultKeyboardSettings(),
      })
    ).toThrow('형식이 올바르지 않습니다');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(unsupported);
  });
});
