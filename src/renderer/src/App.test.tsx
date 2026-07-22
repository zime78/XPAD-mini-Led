// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultKeyboardSettings,
  type AppConfig,
  type KeyboardRuntimeStatus,
  type KeyboardSettingsBackup,
  type StatusSnapshot,
} from '../../shared/types';
import { App } from './App';

const config: AppConfig = {
  servicePreference: 'automatic',
  pollIntervalMs: 1500,
  showArtwork: true,
  showProgress: true,
  fineVolumeEnabled: true,
  fineVolumeStepsPerDetent: 1,
  keyboardSettings: createDefaultKeyboardSettings(),
  launchAtLogin: false,
};

const keyboardRuntime: KeyboardRuntimeStatus = {
  shortcutState: 'disabled',
  shortcutError: null,
  deviceApplySupported: true,
  deviceApplyReason: 'P2~P5 앱 실행 키를 RAM에 적용합니다.',
};

const keyboardSettings = createDefaultKeyboardSettings();
keyboardSettings.enabled = true;
keyboardSettings.activeProfileId = 3;
keyboardSettings.profiles[3].assignments = {
  left: { type: 'key', keyCode: 'KeyQ' },
  center: {
    type: 'launch-app',
    appName: 'Safari',
    appPath: '/Applications/Safari.app',
  },
  right: { type: 'key', keyCode: 'F5' },
};

const status: StatusSnapshot = {
  deviceConnected: true,
  protocolReady: true,
  track: {
    service: 'apple-music',
    state: 'paused',
    id: 'track-1',
    title: "Say You Won't Let Go",
    artist: 'James Arthur',
    album: 'Back from the Edge (Deluxe Edition)',
    duration: 211,
    position: 96,
  },
  monitorError: null,
  previewDataUrl: null,
  knobFineVolumeState: 'active',
  knobFineVolumeError: null,
  keyboardProfileState: {
    activeProfileId: 3,
    profiles: keyboardSettings.profiles,
    switching: false,
    error: null,
  },
};

describe('XPAD Mini Now Playing 화면', () => {
  let emitStatus: (next: StatusSnapshot) => void;

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    window.xpad = {
      getStatus: vi.fn().mockResolvedValue(status),
      getConfig: vi.fn().mockResolvedValue(config),
      setConfig: vi.fn().mockImplementation(async (next) => next),
      refreshNowPlaying: vi.fn().mockResolvedValue(status),
      switchKeyboardProfile: vi.fn().mockImplementation(async (profileId) => ({
        ...status,
        keyboardProfileState: {
          ...status.keyboardProfileState,
          activeProfileId: profileId,
        },
      })),
      getPlayerViewMode: vi.fn().mockResolvedValue('expanded'),
      setPlayerViewMode: vi.fn().mockImplementation(async (mode) => mode),
      runPlayerAction: vi.fn().mockResolvedValue({ ok: true, error: null }),
      openSettingsWindow: vi.fn().mockResolvedValue(undefined),
      closeSettingsWindow: vi.fn().mockResolvedValue(undefined),
      openKeyboardSettingsWindow: vi.fn().mockResolvedValue(undefined),
      closeKeyboardSettingsWindow: vi.fn().mockResolvedValue(undefined),
      getKeyboardSettings: vi.fn().mockResolvedValue(createDefaultKeyboardSettings()),
      saveKeyboardSettings: vi.fn().mockImplementation(async (settings) => ({
        settings,
        runtimeStatus: keyboardRuntime,
      })),
      getKeyboardRuntimeStatus: vi.fn().mockResolvedValue(keyboardRuntime),
      listKeyboardBackups: vi.fn().mockResolvedValue({
        items: [],
        maxItems: 10,
        warning: null,
      }),
      createKeyboardBackup: vi.fn().mockResolvedValue({
        items: [],
        maxItems: 10,
        warning: null,
      }),
      overwriteKeyboardBackup: vi.fn().mockResolvedValue({
        items: [],
        maxItems: 10,
        warning: null,
      }),
      deleteKeyboardBackup: vi.fn().mockResolvedValue({
        items: [],
        maxItems: 10,
        warning: null,
      }),
      loadKeyboardBackup: vi.fn().mockResolvedValue(createDefaultKeyboardSettings()),
      pickApplication: vi.fn().mockResolvedValue(null),
      testKeyboardAction: vi.fn().mockResolvedValue({ ok: true, error: null }),
      checkApplicationPath: vi.fn().mockResolvedValue({ ok: true, error: null }),
      onStatusChanged: vi.fn().mockImplementation((callback: (next: StatusSnapshot) => void) => {
        emitStatus = callback;
        return () => undefined;
      }),
      onKeyboardStatusChanged: vi.fn().mockReturnValue(() => undefined),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('기본 화면에는 재생 정보, 빠른 프로파일과 설정 아이콘을 표시한다', async () => {
    render(<App />);

    const playerPanel = await screen.findByRole('region', { name: "Say You Won't Let Go" });

    expect(within(playerPanel).getByRole('button', { name: '설정 열기' })).toBeTruthy();
    expect(within(playerPanel).getByRole('button', { name: '키보드 설정 열기' })).toBeTruthy();
    expect(within(playerPanel).getAllByRole('button', { name: /Profile [1-5]/ })).toHaveLength(5);
    expect(within(playerPanel).queryByText('QUICK PROFILE')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Now Playing' })).toBeNull();
    expect(screen.queryByText('PULSAR LAB XPAD MINI')).toBeNull();
    expect(
      screen.queryByText('Spotify와 Apple Music의 현재 곡을 XPAD LCD에 표시합니다.'),
    ).toBeNull();
    expect(screen.queryByText('USB 장치')).toBeNull();
    expect(screen.queryByRole('heading', { name: '표시 설정' })).toBeNull();
  });

  it('선택 프로파일과 등록 키 3개를 표시하고 다른 프로파일로 전환한다', async () => {
    render(<App />);

    const playerPanel = await screen.findByRole('region', { name: "Say You Won't Let Go" });
    const profile3 = within(playerPanel).getByRole('button', { name: 'Profile 3' });
    const assignments = within(playerPanel).getByLabelText('Profile 3 등록 키');

    expect(profile3.getAttribute('aria-pressed')).toBe('true');
    expect(within(assignments).getByText('Q')).toBeTruthy();
    expect(within(assignments).getByText('Safari')).toBeTruthy();
    expect(within(assignments).getByText('F5')).toBeTruthy();

    fireEvent.click(within(playerPanel).getByRole('button', { name: 'Profile 4' }));

    await waitFor(() => expect(window.xpad.switchKeyboardProfile).toHaveBeenCalledWith(4));
    await waitFor(() => {
      expect(
        within(playerPanel).getByRole('button', { name: 'Profile 4' }).getAttribute('aria-pressed')
      ).toBe('true');
    });
  });

  it('장치가 준비되지 않았거나 전환 중이면 프로파일 선택을 차단한다', async () => {
    window.xpad.getStatus = vi.fn().mockResolvedValue({
      ...status,
      protocolReady: false,
    });
    render(<App />);

    const profile1 = await screen.findByRole('button', { name: 'Profile 1' });
    expect((profile1 as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(profile1);
    expect(window.xpad.switchKeyboardProfile).not.toHaveBeenCalled();
  });

  it('설정 아이콘으로 별도 설정 창을 요청하고 재생 화면은 유지한다', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '설정 열기' }));

    await waitFor(() => expect(window.xpad.openSettingsWindow).toHaveBeenCalledOnce());
    expect(screen.getByRole('heading', { name: "Say You Won't Let Go" })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '설정', level: 1 })).toBeNull();
  });

  it('키보드 아이콘으로 별도 키보드 설정 창을 요청한다', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '키보드 설정 열기' }));

    await waitFor(() => expect(window.xpad.openKeyboardSettingsWindow).toHaveBeenCalledOnce());
    expect(screen.getByRole('heading', { name: "Say You Won't Let Go" })).toBeTruthy();
  });

  it('미니뷰에서 현재 프로파일 동작을 버튼으로 표시하고 실행한 뒤 확장뷰로 돌아간다', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '미니뷰로 축소' }));

    await waitFor(() => expect(window.xpad.setPlayerViewMode).toHaveBeenCalledWith('mini'));
    const miniView = await screen.findByRole('region', { name: 'XPAD LCD 미니뷰' });
    expect(within(miniView).getByRole('button', { name: '왼쪽 버튼 동작 실행: Q' }).textContent)
      .toBe('Q');
    expect(
      within(miniView).getByRole('button', { name: '가운데 버튼 동작 실행: Safari 실행' })
        .textContent
    ).toBe('Safari');
    expect(within(miniView).getByRole('button', { name: '오른쪽 버튼 동작 실행: F5' }).textContent)
      .toBe('F5');
    expect(within(miniView).queryByText('왼쪽')).toBeNull();
    expect(within(miniView).queryByText('가운데')).toBeNull();
    expect(within(miniView).queryByText('오른쪽')).toBeNull();
    expect(within(miniView).queryAllByRole('button', { name: /Profile [1-5]/ })).toHaveLength(0);
    expect(within(miniView).getByRole('button', { name: '키보드 설정 열기' })).toBeTruthy();
    expect(within(miniView).getByRole('button', { name: '설정 열기' })).toBeTruthy();

    fireEvent.click(
      within(miniView).getByRole('button', { name: '가운데 버튼 동작 실행: Safari 실행' })
    );
    await waitFor(() => expect(window.xpad.runPlayerAction).toHaveBeenCalledWith('center'));

    fireEvent.click(within(miniView).getByRole('button', { name: '확장뷰로 확대' }));
    await waitFor(() => expect(window.xpad.setPlayerViewMode).toHaveBeenLastCalledWith('expanded'));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Profile [1-5]/ })).toHaveLength(5));
  });

  it('미니뷰 동작 실행 실패를 사용자에게 표시한다', async () => {
    window.xpad.getPlayerViewMode = vi.fn().mockResolvedValue('mini');
    window.xpad.runPlayerAction = vi.fn().mockResolvedValue({
      ok: false,
      error: '일반 키는 실행할 수 없습니다.',
    });
    render(<App />);

    const action = await screen.findByRole('button', { name: '왼쪽 버튼 동작 실행: Q' });
    fireEvent.click(action);

    expect((await screen.findByRole('alert')).textContent).toBe('일반 키는 실행할 수 없습니다.');
  });

  it('설정 창에서 상세 상태를 표시하고 현재 창 닫기를 요청한다', async () => {
    window.history.replaceState({}, '', '/?view=settings');
    render(<App />);

    expect(await screen.findByRole('heading', { name: '설정', level: 1 })).toBeTruthy();
    expect(screen.getByText('USB 장치')).toBeTruthy();
    expect(screen.getByText('LCD 프로토콜')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '표시 설정' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'XPAD 노브 설정' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '현재 곡 새로고침' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: "Say You Won't Let Go" })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '설정 창 닫기' }));

    await waitFor(() => expect(window.xpad.closeSettingsWindow).toHaveBeenCalledOnce());
  });

  it('재생 패널의 장치 아이콘을 연결 상태에 따라 녹색 또는 빨간색으로 표시한다', async () => {
    render(<App />);

    const playerPanel = await screen.findByRole('region', { name: "Say You Won't Let Go" });
    const deviceStatus = within(playerPanel).getByRole('status', { name: '장치 연결 상태' });

    expect(within(deviceStatus).getByRole('img', { name: 'USB 연결됨' }).getAttribute('data-state'))
      .toBe('connected');
    expect(
      within(deviceStatus)
        .getByRole('img', { name: 'LCD 프로토콜 연결됨' })
        .getAttribute('data-state'),
    ).toBe('connected');
    expect(
      within(deviceStatus).getByRole('img', { name: 'XPAD 노브 연결됨' }).getAttribute('data-state'),
    ).toBe('connected');

    act(() => {
      emitStatus({
        ...status,
        deviceConnected: false,
        protocolReady: false,
        knobFineVolumeState: 'error',
      });
    });

    expect(within(deviceStatus).getByRole('img', { name: 'USB 연결 실패' }).getAttribute('data-state'))
      .toBe('failed');
    expect(
      within(deviceStatus)
        .getByRole('img', { name: 'LCD 프로토콜 연결 실패' })
        .getAttribute('data-state'),
    ).toBe('failed');
    expect(
      within(deviceStatus)
        .getByRole('img', { name: 'XPAD 노브 연결 실패' })
        .getAttribute('data-state'),
    ).toBe('failed');
  });

  it('설정 변경값을 저장하고 결과를 알린다', async () => {
    window.history.replaceState({}, '', '/?view=settings');
    render(<App />);

    expect(await screen.findByRole('heading', { name: '설정', level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '앨범아트 표시' }));
    fireEvent.click(screen.getByRole('button', { name: '설정 저장' }));

    await waitFor(() => {
      expect(window.xpad.setConfig).toHaveBeenCalledWith({
        ...config,
        showArtwork: false,
      });
    });
    expect((await screen.findByRole('status')).textContent).toBe('설정을 저장했습니다.');
  });

  it('장치 연결 또는 프로토콜 준비 실패 시 일반 설정 변경과 저장을 차단한다', async () => {
    window.history.replaceState({}, '', '/?view=settings');
    window.xpad.getStatus = vi.fn().mockResolvedValue({
      ...status,
      deviceConnected: false,
      protocolReady: false,
    });
    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'XPAD Mini 연결과 LCD 프로토콜 준비 후 설정을 변경할 수 있습니다.'
    );
    const artwork = screen.getByRole('checkbox', { name: '앨범아트 표시' });
    const service = screen.getByRole('combobox', { name: '우선 음악 앱' });
    expect((artwork as HTMLInputElement).disabled).toBe(true);
    expect((service as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '설정 저장' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(artwork);
    fireEvent.click(screen.getByRole('button', { name: '설정 저장' }));
    expect(window.xpad.setConfig).not.toHaveBeenCalled();
  });

  it('키보드 창에는 5개 프로파일과 하단 물리 버튼 3개만 표시한다', async () => {
    window.history.replaceState({}, '', '/?view=keyboard');
    render(<App />);

    expect(await screen.findByRole('heading', { name: '키보드 설정', level: 1 })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    const keyMap = screen.getByLabelText('Profile 1 하단 버튼');
    expect(within(keyMap).getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: 'XPAD 노브 설정' })).toBeNull();
    expect(screen.getByText('Profile 1 고정')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '키 변경' })).toBeNull();
    expect(
      within(keyMap).getByRole('button', { name: '왼쪽 버튼, 현재 동작 이전 곡' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'P2 · Profile 2' }));
    expect(screen.getByRole('button', { name: '키 변경' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '음악 제어' })).toBeNull();
    expect(screen.getByRole('option', { name: '재생/일시정지' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Q' })).toBeTruthy();
    expect(screen.getByText('P2~P5 앱 실행 키를 RAM에 적용합니다.')).toBeTruthy();
    expect(document.title).toBe('XPAD Mini 키보드 설정');
  });

  it('Profile 1~5 클릭 시 각 프로필에 저장된 설정만 정확히 로드한다', async () => {
    window.history.replaceState({}, '', '/?view=keyboard');
    const profileSettings = createDefaultKeyboardSettings();
    const expected = [
      { profileId: 1, keyCode: 'KeyA', label: '이전 곡' },
      { profileId: 2, keyCode: 'KeyB', label: 'B' },
      { profileId: 3, keyCode: 'KeyC', label: 'C' },
      { profileId: 4, keyCode: 'KeyD', label: 'D' },
      { profileId: 5, keyCode: 'KeyE', label: 'E' },
    ] as const;
    for (const item of expected) {
      profileSettings.profiles[item.profileId].assignments.left = {
        type: 'key',
        keyCode: item.keyCode,
      };
    }
    window.xpad.getKeyboardSettings = vi.fn().mockResolvedValue(profileSettings);
    render(<App />);

    await screen.findByRole('heading', { name: '키보드 설정', level: 1 });
    for (const item of expected) {
      const tab = screen.getByRole('tab', {
        name: new RegExp(`P${item.profileId} · Profile ${item.profileId}`),
      });
      fireEvent.click(tab);
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(
        within(screen.getByLabelText(`Profile ${item.profileId} 하단 버튼`)).getByRole(
          'button',
          { name: new RegExp(`왼쪽 버튼, 현재 동작 ${item.label}$`) }
        )
      ).toBeTruthy();
      expect(
        (screen.getByRole('combobox', {
          name: 'F16~F18 사용 프로파일',
        }) as HTMLSelectElement).value
      ).toBe('1');
      expect(screen.getByRole('button', { name: '저장하고 장치에 적용' }).hasAttribute('disabled'))
        .toBe(true);
    }
  });

  it('장치 연결 또는 프로토콜 준비 실패 시 키보드 프로필 선택과 편집을 차단한다', async () => {
    window.history.replaceState({}, '', '/?view=keyboard');
    window.xpad.getStatus = vi.fn().mockResolvedValue({
      ...status,
      deviceConnected: true,
      protocolReady: false,
    });
    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'XPAD Mini 연결과 LCD 프로토콜 준비 후 프로필을 불러오고 키보드 설정을 변경할 수 있습니다.'
    );
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '장치에서 다시 읽기' }).matches(':disabled'))
      .toBe(true);
    expect(window.xpad.getKeyboardSettings).not.toHaveBeenCalled();
    expect(window.xpad.saveKeyboardSettings).not.toHaveBeenCalled();
  });

  it('프로필 탭에서 저장된 설정을 표시하되 F16~F18 사용 프로필은 바꾸지 않는다', async () => {
    window.history.replaceState({}, '', '/?view=keyboard');
    const initialSettings = createDefaultKeyboardSettings();
    initialSettings.profiles[3].assignments.left = {
      type: 'key',
      keyCode: 'MediaPlayPause',
    };
    window.xpad.getKeyboardSettings = vi.fn().mockResolvedValue(initialSettings);
    window.xpad.pickApplication = vi.fn().mockResolvedValue({
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
      iconDataUrl: 'data:image/png;base64,AA==',
    });
    render(<App />);

    await screen.findByRole('heading', { name: '키보드 설정', level: 1 });
    fireEvent.click(screen.getByRole('tab', { name: 'P3 · Profile 3' }));
    expect(
      within(screen.getByLabelText('Profile 3 하단 버튼')).getByRole('button', {
        name: /왼쪽 버튼, 현재 동작 재생\/일시정지/,
      })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '저장하고 장치에 적용' }).hasAttribute('disabled'))
      .toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 버튼/ }));
    fireEvent.click(screen.getByRole('button', { name: '앱 실행' }));
    await screen.findByText('Finder');
    expect(
      screen.getByRole('checkbox', { name: /F16~F18 컴퓨터 단축키 활성화/ })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByRole('tab', { name: /P3 · Profile 3.*변경됨/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '저장하고 장치에 적용' }));

    await waitFor(() => expect(window.xpad.saveKeyboardSettings).toHaveBeenCalledOnce());
    const savedKeyboardSettings = vi.mocked(window.xpad.saveKeyboardSettings).mock.calls[0][0];
    expect(savedKeyboardSettings.enabled).toBe(true);
    expect(savedKeyboardSettings.activeProfileId).toBe(1);
    expect(savedKeyboardSettings.profiles[3].assignments.right).toEqual({
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    });
    expect(savedKeyboardSettings).not.toHaveProperty('fineVolumeEnabled');
    expect(window.xpad.setConfig).not.toHaveBeenCalled();
  });

  it('이름과 설명을 입력해 Profile 2~5 백업을 요청한다', async () => {
    window.history.replaceState({}, '', '/?view=keyboard');
    render(<App />);

    await screen.findByRole('heading', { name: '키보드 설정', level: 1 });
    fireEvent.change(screen.getByPlaceholderText('예: 작업용 키 세팅'), {
      target: { value: '작업용' },
    });
    fireEvent.change(screen.getByPlaceholderText('백업 내용을 입력하세요.'), {
      target: { value: '앱 실행 설정 포함' },
    });
    fireEvent.click(screen.getByRole('button', { name: '백업 저장' }));

    await waitFor(() => expect(window.xpad.createKeyboardBackup).toHaveBeenCalledOnce());
    expect(window.xpad.createKeyboardBackup).toHaveBeenCalledWith({
      name: '작업용',
      description: '앱 실행 설정 포함',
      settings: createDefaultKeyboardSettings(),
    });
  });

  it('미지원 장치 동작은 오류 코드 없이 한 줄 미지원으로 표시한다', async () => {
    window.history.replaceState({}, '', '/?view=keyboard');
    const profileSettings = createDefaultKeyboardSettings();
    profileSettings.profiles[2].assignments.left = {
      type: 'unsupported',
      description: '미지원 장치 동작 (output=63, action=f0000000)',
    };
    window.xpad.getKeyboardSettings = vi.fn().mockResolvedValue(profileSettings);
    render(<App />);

    await screen.findByRole('heading', { name: '키보드 설정', level: 1 });
    fireEvent.click(screen.getByRole('tab', { name: 'P2 · Profile 2' }));

    const keyMap = screen.getByLabelText('Profile 2 하단 버튼');
    expect(
      within(keyMap).getByRole('button', { name: '왼쪽 버튼, 현재 동작 미지원' })
    ).toBeTruthy();
    expect(screen.getAllByText('미지원').length).toBeGreaterThan(0);
    expect(screen.queryByText(/output=63|action=f0000000/)).toBeNull();
  });

  it('백업의 활성 프로파일과 버튼 설정을 편집 화면에 그대로 복원한다', async () => {
    window.history.replaceState({}, '', '/?view=keyboard');
    const restored = createDefaultKeyboardSettings();
    restored.enabled = true;
    restored.activeProfileId = 5;
    restored.profiles[5].assignments.left = {
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    };
    const backup: KeyboardSettingsBackup = {
      schemaVersion: 1,
      id: 'backup-1',
      name: '복원 테스트',
      description: '5개 프로파일',
      createdAt: '2026-07-22T00:00:00.000Z',
      enabled: restored.enabled,
      activeProfileId: restored.activeProfileId,
      profiles: restored.profiles,
    };
    window.xpad.listKeyboardBackups = vi.fn().mockResolvedValue({
      items: [backup],
      maxItems: 10,
      warning: null,
    });
    window.xpad.loadKeyboardBackup = vi.fn().mockResolvedValue(restored);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /복원 테스트/ }));
    fireEvent.click(screen.getByRole('button', { name: '편집 화면에 복원' }));

    await waitFor(() => expect(window.xpad.loadKeyboardBackup).toHaveBeenCalledWith('backup-1'));
    expect(screen.getByRole('tab', { name: /P5 · Profile 5/ }).getAttribute('aria-selected'))
      .toBe('true');
    expect(
      within(screen.getByLabelText('Profile 5 하단 버튼')).getByRole('button', {
        name: /왼쪽 버튼, 현재 동작 Finder 실행/,
      })
    ).toBeTruthy();
    expect(window.xpad.saveKeyboardSettings).not.toHaveBeenCalled();
  });
});
