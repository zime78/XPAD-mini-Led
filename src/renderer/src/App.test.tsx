// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, StatusSnapshot } from '../../shared/types';
import { App } from './App';

const config: AppConfig = {
  servicePreference: 'automatic',
  pollIntervalMs: 1500,
  showArtwork: true,
  showProgress: true,
  fineVolumeEnabled: true,
  fineVolumeStepsPerDetent: 1,
  launchAtLogin: false,
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
      openSettingsWindow: vi.fn().mockResolvedValue(undefined),
      closeSettingsWindow: vi.fn().mockResolvedValue(undefined),
      onStatusChanged: vi.fn().mockImplementation((callback: (next: StatusSnapshot) => void) => {
        emitStatus = callback;
        return () => undefined;
      }),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('기본 화면에는 재생 정보와 설정 아이콘만 표시한다', async () => {
    render(<App />);

    const playerPanel = await screen.findByRole('region', { name: "Say You Won't Let Go" });

    expect(within(playerPanel).getByRole('button', { name: '설정 열기' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Now Playing' })).toBeNull();
    expect(screen.queryByText('PULSAR LAB XPAD MINI')).toBeNull();
    expect(
      screen.queryByText('Spotify와 Apple Music의 현재 곡을 XPAD LCD에 표시합니다.'),
    ).toBeNull();
    expect(screen.queryByText('USB 장치')).toBeNull();
    expect(screen.queryByRole('heading', { name: '표시 설정' })).toBeNull();
  });

  it('설정 아이콘으로 별도 설정 창을 요청하고 재생 화면은 유지한다', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '설정 열기' }));

    await waitFor(() => expect(window.xpad.openSettingsWindow).toHaveBeenCalledOnce());
    expect(screen.getByRole('heading', { name: "Say You Won't Let Go" })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '설정', level: 1 })).toBeNull();
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
});
