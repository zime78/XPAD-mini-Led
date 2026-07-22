import { describe, expect, it } from 'vitest';
import { createDefaultKeyboardSettings, PROFILE_IDS } from '../shared/types';
import { mergeKeyboardDeviceSnapshot, normalizeKeyboardSettings } from './keyboard-settings';

describe('normalizeKeyboardSettings', () => {
  it('잘못된 입력은 5개 프로파일 기본값으로 복구한다', () => {
    const settings = normalizeKeyboardSettings({
      enabled: 'yes',
      activeProfileId: 8,
      profiles: {},
    });

    expect(settings.enabled).toBe(false);
    expect(settings.activeProfileId).toBe(1);
    expect(Object.keys(settings.profiles)).toEqual(['1', '2', '3', '4', '5']);
    expect(settings.profiles[5].assignments.center).toEqual({
      type: 'key',
      keyCode: 'KeyW',
    });
  });

  it('프로파일별 하단 3버튼 앱/키 설정을 보존한다', () => {
    const source = createDefaultKeyboardSettings();
    source.enabled = true;
    source.activeProfileId = 4;
    source.profiles[4].assignments.right = {
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    };

    expect(normalizeKeyboardSettings(source)).toEqual(source);
  });

  it('P2~P5 앱 실행 설정이 있으면 F16~F18 라우터를 자동 활성화한다', () => {
    const source = createDefaultKeyboardSettings();
    source.enabled = false;
    source.profiles[2].assignments.left = {
      type: 'launch-app',
      appName: 'Discord',
      appPath: '/Applications/Discord.app',
    };

    expect(normalizeKeyboardSettings(source).enabled).toBe(true);
  });

  it('Profile 1은 음악 제어로 고정하고 Profile 2~5의 서로 다른 키를 보존한다', () => {
    const source = createDefaultKeyboardSettings();
    const keyCodes = ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE'] as const;
    keyCodes.forEach((keyCode, index) => {
      const profileId = (index + 1) as 1 | 2 | 3 | 4 | 5;
      source.profiles[profileId].assignments.left = { type: 'key', keyCode };
    });

    const normalized = normalizeKeyboardSettings(source);

    expect(normalized.profiles[1].assignments).toEqual({
      left: { type: 'key', keyCode: 'MediaTrackPrevious' },
      center: { type: 'key', keyCode: 'MediaPlayPause' },
      right: { type: 'key', keyCode: 'MediaTrackNext' },
    });
    keyCodes.slice(1).forEach((keyCode, index) => {
      const profileId = (index + 2) as 2 | 3 | 4 | 5;
      expect(normalized.profiles[profileId].assignments.left).toEqual({
        type: 'key',
        keyCode,
      });
    });
  });

  it('상대경로나 .app이 아닌 실행 경로는 해당 버튼 기본값으로 복구한다', () => {
    const source = createDefaultKeyboardSettings();
    source.profiles[2].assignments.left = {
      type: 'launch-app',
      appName: 'unsafe',
      appPath: '../unsafe.sh',
    };

    expect(normalizeKeyboardSettings(source).profiles[2].assignments.left).toEqual({
      type: 'key',
      keyCode: 'KeyQ',
    });
  });

  it('기존 미디어 전용 설정을 새 키 동작 형식으로 승계한다', () => {
    const normalized = normalizeKeyboardSettings({
      enabled: true,
      activeProfileId: 2,
      profiles: {
        2: {
          assignments: {
            left: { type: 'media', command: 'previous' },
            center: { type: 'media', command: 'play-pause' },
            right: { type: 'media', command: 'next' },
          },
        },
      },
    });

    expect(normalized.profiles[2].assignments).toEqual({
      left: { type: 'key', keyCode: 'MediaTrackPrevious' },
      center: { type: 'key', keyCode: 'MediaPlayPause' },
      right: { type: 'key', keyCode: 'MediaTrackNext' },
    });
  });

  it('장치에서 읽은 프로필을 사용하되 F16~F18 앱 실행 연결은 보존한다', () => {
    const local = createDefaultKeyboardSettings();
    local.profiles[2].assignments.left = {
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    };
    const profiles = structuredClone(local.profiles);
    for (const profileId of PROFILE_IDS) {
      profiles[profileId].assignments.left = { type: 'key', keyCode: 'KeyA' };
      profiles[profileId].assignments.center = { type: 'key', keyCode: 'KeyB' };
      profiles[profileId].assignments.right = { type: 'key', keyCode: 'KeyC' };
    }
    profiles[2].assignments.left = { type: 'key', keyCode: 'F16' };

    const merged = mergeKeyboardDeviceSnapshot(local, {
      activeProfileId: 4,
      profiles,
    });

    expect(merged.activeProfileId).toBe(4);
    expect(merged.profiles[1].assignments.left).toEqual({
      type: 'key',
      keyCode: 'MediaTrackPrevious',
    });
    expect(merged.profiles[2].assignments.left).toEqual(local.profiles[2].assignments.left);
  });

  it('장치 재조회가 미지원 값을 반환해도 저장된 앱 연결은 유지한다', () => {
    const local = createDefaultKeyboardSettings();
    local.profiles[2].assignments.left = {
      type: 'launch-app',
      appName: 'Discord',
      appPath: '/Applications/Discord.app',
    };
    const profiles = structuredClone(local.profiles);
    profiles[2].assignments.left = {
      type: 'unsupported',
      description: '장치에서 해석할 수 없는 키',
    };
    profiles[2].assignments.center = { type: 'key', keyCode: 'KeyZ' };

    const merged = mergeKeyboardDeviceSnapshot(local, {
      activeProfileId: 2,
      profiles,
    });

    expect(merged.profiles[2].assignments.left).toEqual(local.profiles[2].assignments.left);
    expect(merged.profiles[2].assignments.center).toEqual({
      type: 'key',
      keyCode: 'KeyZ',
    });
  });
});
