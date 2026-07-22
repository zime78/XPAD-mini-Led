import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createFixedProfileOne,
  KEYBOARD_SLOTS,
  KeyboardAction,
  KeyboardBackupList,
  KeyboardKeyCode,
  KeyboardRuntimeStatus,
  KeyboardSettings,
  KeyboardSettingsBackup,
  KeyboardSlot,
  MEDIA_KEY_CODES,
  MediaKeyCode,
  PROFILE_IDS,
  ProfileId,
  StatusSnapshot,
} from '../../../shared/types';
import { AppHeader } from './app-header';
import {
  keyboardActionLabel,
  keyboardKeyCodeLabel,
} from '../keyboard-action-label';

const SLOT_LABELS: Record<KeyboardSlot, string> = {
  left: '왼쪽 버튼',
  center: '가운데 버튼',
  right: '오른쪽 버튼',
};

const DEFAULT_KEYS: Record<KeyboardSlot, Extract<KeyboardAction, { type: 'key' }>> = {
  left: { type: 'key', keyCode: 'KeyQ' },
  center: { type: 'key', keyCode: 'KeyW' },
  right: { type: 'key', keyCode: 'KeyE' },
};

const SYMBOL_KEYS = [
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Backquote',
  'Comma',
  'Period',
  'Slash',
] as const satisfies readonly KeyboardKeyCode[];

const BASIC_KEYS = [
  'Space',
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'CapsLock',
] as const satisfies readonly KeyboardKeyCode[];

const NAVIGATION_KEYS = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
] as const satisfies readonly KeyboardKeyCode[];

const KEY_GROUPS: Array<{ label: string; keys: readonly KeyboardKeyCode[] }> = [
  {
    label: '영문 A~Z',
    keys: Array.from({ length: 26 }, (_, index) =>
      `Key${String.fromCharCode(65 + index)}` as KeyboardKeyCode
    ),
  },
  {
    label: '숫자 0~9',
    keys: Array.from({ length: 10 }, (_, index) => `Digit${index}` as KeyboardKeyCode),
  },
  { label: '기호', keys: SYMBOL_KEYS },
  { label: '기본 키', keys: BASIC_KEYS },
  { label: '탐색 키', keys: NAVIGATION_KEYS },
  {
    label: '기능 키',
    keys: [
      ...Array.from({ length: 18 }, (_, index) => `F${index + 1}` as KeyboardKeyCode),
      'F21',
      'F22',
      'F23',
      'F24',
    ],
  },
  { label: '미디어 키', keys: MEDIA_KEY_CODES },
];

type KeyboardSettingsViewProps = {
  status: StatusSnapshot;
  onClose: () => void;
};

export function KeyboardSettingsView({ status, onClose }: KeyboardSettingsViewProps) {
  const [settings, setSettings] = useState<KeyboardSettings | null>(null);
  const [saved, setSaved] = useState<KeyboardSettings | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<ProfileId>(1);
  const [runtime, setRuntime] = useState<KeyboardRuntimeStatus | null>(null);
  const [backups, setBackups] = useState<KeyboardBackupList | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<KeyboardSlot>('left');
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null);
  const [backupName, setBackupName] = useState('');
  const [backupDescription, setBackupDescription] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [applicationError, setApplicationError] = useState<string | null>(null);
  const [applicationIcons, setApplicationIcons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loadDeviceSettings = useCallback(async () => {
    if (!status.deviceConnected || !status.protocolReady) {
      setError(
        'XPAD Mini 연결과 LCD 프로토콜 준비 후 프로필을 불러오고 키보드 설정을 변경할 수 있습니다.'
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextSettings = await window.xpad.getKeyboardSettings();
      nextSettings.profiles[1] = createFixedProfileOne();
      setSettings(nextSettings);
      setSaved(nextSettings);
      setSelectedProfileId(nextSettings.activeProfileId);
      setSelectedSlot('left');
      setMessage('P1 고정값과 장치의 P2~P5 설정을 불러왔습니다.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [status.deviceConnected, status.protocolReady]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.xpad.getKeyboardRuntimeStatus(),
      window.xpad.listKeyboardBackups(),
    ])
      .then(([nextRuntime, nextBackups]) => {
        if (!active) return;
        setRuntime(nextRuntime);
        setBackups(nextBackups);
      })
      .catch((reason) => active && setError(errorMessage(reason)));
    const unsubscribe = window.xpad.onKeyboardStatusChanged(setRuntime);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (status.deviceConnected && status.protocolReady) {
      void loadDeviceSettings();
    } else {
      setError(
        'XPAD Mini 연결과 LCD 프로토콜 준비 후 프로필을 불러오고 키보드 설정을 변경할 수 있습니다.'
      );
    }
  }, [loadDeviceSettings, status.deviceConnected, status.protocolReady]);

  const selectedAction = settings
    ? settings.profiles[selectedProfileId].assignments[selectedSlot]
    : null;

  useEffect(() => {
    let active = true;
    if (selectedAction?.type !== 'launch-app') {
      setApplicationError(null);
      return () => {
        active = false;
      };
    }
    void window.xpad
      .checkApplicationPath(selectedAction.appPath)
      .then((result) => {
        if (active) setApplicationError(result.ok ? null : result.error);
      })
      .catch((reason) => {
        if (active) setApplicationError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [selectedAction]);

  const dirty = useMemo(
    () => Boolean(settings && saved && JSON.stringify(settings) !== JSON.stringify(saved)),
    [settings, saved]
  );
  const settingsDisabled = !status.deviceConnected || !status.protocolReady;
  const profileIsFixed = selectedProfileId === 1;

  if (!runtime || !backups) {
    return <main className="loading-screen">키보드 설정 불러오는 중…</main>;
  }

  if (!settings || !saved) {
    return (
      <main className="app-shell keyboard-screen">
        <AppHeader
          title="키보드 설정"
          subtitle="Profile 1은 고정하고 Profile 2~5의 실제 하단 버튼 설정을 장치에서 읽습니다."
          closeLabel="키보드 설정 창 닫기"
          onClose={onClose}
        />
        <p className="connection-required" role="alert">
          {error || 'XPAD Mini의 실제 프로필을 읽는 중입니다.'}
        </p>
        <button
          className="primary"
          disabled={busy || settingsDisabled}
          onClick={() => void loadDeviceSettings()}
        >
          {busy ? '장치 프로필 읽는 중…' : '장치에서 다시 읽기'}
        </button>
      </main>
    );
  }

  const patchSettings = (change: (draft: KeyboardSettings) => void) => {
    if (settingsDisabled) return;
    const draft = structuredClone(settings);
    change(draft);
    setSettings(draft);
    setMessage('');
    setError('');
  };

  const setProfile = (profileId: ProfileId) => {
    if (settingsDisabled) return;
    setSelectedProfileId(profileId);
    setSelectedSlot('left');
    setMessage('');
    setError('');
  };

  const setSelectedAction = (action: KeyboardAction) => {
    if (profileIsFixed) return;
    patchSettings((draft) => {
      draft.profiles[selectedProfileId].assignments[selectedSlot] = action;
    });
  };

  const chooseApplication = async () => {
    if (settingsDisabled || profileIsFixed) return;
    setBusy(true);
    try {
      const application = await window.xpad.pickApplication();
      if (!application) return;
      setApplicationIcons((current) => ({
        ...current,
        [application.appPath]: application.iconDataUrl,
      }));
      setSelectedAction({
        type: 'launch-app',
        appName: application.appName,
        appPath: application.appPath,
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const testAction = async () => {
    if (settingsDisabled || !selectedAction) return;
    setBusy(true);
    try {
      const result = await window.xpad.testKeyboardAction(selectedAction);
      if (!result.ok) throw new Error(result.error ?? '동작을 실행하지 못했습니다.');
      setMessage(
        selectedAction.type === 'launch-app'
          ? `${selectedAction.appName} 앱을 실행했습니다.`
          : `${keyboardActionLabel(selectedAction)} 동작을 실행했습니다.`
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (settingsDisabled) return;
    setBusy(true);
    try {
      const result = await window.xpad.saveKeyboardSettings(settings);
      setSettings(result.settings);
      setSaved(result.settings);
      setRuntime(result.runtimeStatus);
      setMessage('키보드 설정과 F16~F18 단축키 상태를 저장했습니다.');
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const createBackup = async () => {
    if (settingsDisabled) return;
    setBusy(true);
    try {
      const next = await window.xpad.createKeyboardBackup({
        name: backupName,
        description: backupDescription,
        settings,
      });
      setBackups(next);
      setSelectedBackupId(next.items[0]?.id ?? null);
      setBackupName('');
      setBackupDescription('');
      setMessage('Profile 2~5 설정을 백업했습니다.');
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const overwriteBackup = async (backup: KeyboardSettingsBackup) => {
    if (settingsDisabled) return;
    if (!window.confirm(`‘${backup.name}’ 백업을 현재 설정으로 덮어쓰시겠습니까?`)) return;
    setBusy(true);
    try {
      const next = await window.xpad.overwriteKeyboardBackup(backup.id, {
        name: backupName.trim() || backup.name,
        description: backupDescription.trim() || backup.description,
        settings,
      });
      setBackups(next);
      setMessage('선택한 백업을 덮어썼습니다.');
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const deleteBackup = async (backup: KeyboardSettingsBackup) => {
    if (settingsDisabled) return;
    if (!window.confirm(`‘${backup.name}’ 백업을 삭제하시겠습니까?`)) return;
    setBusy(true);
    try {
      const next = await window.xpad.deleteKeyboardBackup(backup.id);
      setBackups(next);
      setSelectedBackupId(null);
      setMessage('백업을 삭제했습니다.');
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async (backup: KeyboardSettingsBackup) => {
    if (settingsDisabled) return;
    if (dirty && !window.confirm('현재 미저장 변경을 버리고 이 백업을 불러오시겠습니까?')) {
      return;
    }
    setBusy(true);
    try {
      const restored = await window.xpad.loadKeyboardBackup(backup.id);
      restored.profiles[1] = createFixedProfileOne();
      setSettings(restored);
      setSelectedProfileId(restored.activeProfileId);
      setSelectedSlot('left');
      setMessage('백업을 편집 화면에 복원했습니다. 아직 저장하거나 장치에 적용하지 않았습니다.');
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell keyboard-screen">
      <AppHeader
        title="키보드 설정"
        subtitle="Profile 1은 음악 제어 고정이며, Profile 2~5의 하단 버튼 3개만 설정합니다."
        closeLabel="키보드 설정 창 닫기"
        onClose={onClose}
      />

      <div className="keyboard-status-row">
        <span className={settingsDisabled ? 'status-pill bad' : 'status-pill ok'}>
          {!status.deviceConnected
            ? 'XPAD Mini 연결 필요'
            : !status.protocolReady
              ? 'LCD 프로토콜 준비 필요'
              : 'XPAD Mini 설정 준비됨'}
        </span>
        <span className={`status-pill ${runtime.shortcutState === 'active' ? 'ok' : 'warn'}`}>
          F16~F18 {shortcutStateLabel(runtime.shortcutState)}
        </span>
        <strong>수정 대상: Profile 2~5 하단 버튼 3개</strong>
        <button disabled={busy || settingsDisabled || dirty} onClick={() => void loadDeviceSettings()}>
          {busy ? '읽는 중…' : '장치에서 다시 읽기'}
        </button>
      </div>

      {(error || runtime.shortcutError) && (
        <p className="error" role="alert">{error || runtime.shortcutError}</p>
      )}
      {message && <p className="keyboard-message" role="status">{message}</p>}

      {settingsDisabled && (
        <p className="connection-required" role="alert">
          XPAD Mini 연결과 LCD 프로토콜 준비 후 프로필을 불러오고 키보드 설정을 변경할
          수 있습니다.
        </p>
      )}

      <fieldset className="keyboard-connection-gate" disabled={settingsDisabled}>
        <legend className="visually-hidden">키보드 프로필 설정</legend>
        <div className="keyboard-layout">
          <section className="keyboard-editor" aria-label="프로파일 키 편집">
          <div
            className="profile-tabs"
            role="tablist"
            aria-label="키보드 프로파일"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const index = PROFILE_IDS.indexOf(selectedProfileId);
              const offset = event.key === 'ArrowRight' ? 1 : -1;
              setProfile(PROFILE_IDS[(index + offset + PROFILE_IDS.length) % PROFILE_IDS.length]);
            }}
          >
            {PROFILE_IDS.map((profileId) => (
              <button
                key={profileId}
                role="tab"
                aria-selected={selectedProfileId === profileId}
                className={selectedProfileId === profileId ? 'active' : ''}
                onClick={() => setProfile(profileId)}
              >
                P{profileId} · Profile {profileId}{profileId === 1 ? ' · 고정' : ''}
                {settings.activeProfileId === profileId && (
                  <span className="profile-runtime-badge">사용 중</span>
                )}
                {JSON.stringify(settings.profiles[profileId]) !==
                  JSON.stringify(saved.profiles[profileId]) && (
                  <span className="profile-dirty-dot" aria-label="변경됨" />
                )}
              </button>
            ))}
          </div>

          <div className="keyboard-workspace">
            <div className="three-key-card">
              <div className="scope-lock">
                <strong>Profile {selectedProfileId} {profileIsFixed ? '고정 설정' : '장치 설정'}</strong>
                <span>
                  {profileIsFixed
                    ? '음악 제어 전용이며 변경할 수 없습니다.'
                    : '장치에서 읽은 하단 세 버튼 값을 표시합니다.'}
                </span>
              </div>
              <div className="device-keys" aria-label={`Profile ${selectedProfileId} 하단 버튼`}>
                {KEYBOARD_SLOTS.map((slot) => {
                  const action = settings.profiles[selectedProfileId].assignments[slot];
                  return (
                    <button
                      key={slot}
                      className={selectedSlot === slot ? 'device-key selected' : 'device-key'}
                      aria-pressed={selectedSlot === slot}
                      aria-label={`${SLOT_LABELS[slot]}, 현재 동작 ${keyboardActionLabel(action)}`}
                      title={keyboardActionLabel(action)}
                      onClick={() => setSelectedSlot(slot)}
                    >
                      <small>{SLOT_LABELS[slot]}</small>
                      <strong>{keyboardActionLabel(action)}</strong>
                      {selectedSlot === slot && <span>선택됨</span>}
                    </button>
                  );
                })}
              </div>
              <p>
                P1은 고정값으로 보호하고 P2~P5를 RAM에서 읽은 뒤 조회 전 프로필로
                자동 복원합니다. Save·펌웨어·LED 명령은 사용하지 않습니다.
              </p>
            </div>

            <aside className="key-action-editor" aria-label="선택한 버튼 동작">
              <small>Profile {selectedProfileId} · 선택한 버튼</small>
              <h2>{SLOT_LABELS[selectedSlot]}</h2>

              {profileIsFixed ? (
                <div className="fixed-profile-notice" role="note">
                  <strong>Profile 1 고정</strong>
                  <span>왼쪽은 이전 곡, 가운데는 재생/일시정지, 오른쪽은 다음 곡입니다.</span>
                </div>
              ) : (
                <>
              <div className="action-type-switch" role="group" aria-label="동작 종류">
                <button
                  className={selectedAction?.type === 'key' ? 'active' : ''}
                  onClick={() => setSelectedAction(DEFAULT_KEYS[selectedSlot])}
                >
                  키 변경
                </button>
                <button
                  className={selectedAction?.type === 'launch-app' ? 'active' : ''}
                  disabled={busy}
                  onClick={() => void chooseApplication()}
                >
                  앱 실행
                </button>
              </div>

              {selectedAction?.type === 'key' ? (
                <label className="keyboard-field">
                  <span>지원 키</span>
                  <select
                    aria-label="지원 키"
                    value={selectedAction.keyCode}
                    onChange={(event) =>
                      setSelectedAction({
                        type: 'key',
                        keyCode: event.target.value as KeyboardKeyCode,
                      })
                    }
                  >
                    {KEY_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.keys.map((keyCode) => (
                          <option key={keyCode} value={keyCode}>{keyboardKeyCodeLabel(keyCode)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <small>F16~F18은 앱 라우터, F19/F20은 기존 볼륨 기능이 사용해 제외했습니다.</small>
                </label>
              ) : selectedAction?.type === 'launch-app' ? (
                <div className="selected-application">
                  {applicationIcons[selectedAction.appPath] ? (
                    <img
                      className="application-icon"
                      src={applicationIcons[selectedAction.appPath]}
                      alt=""
                    />
                  ) : (
                    <span className="application-icon" aria-hidden="true">
                      {selectedAction.appName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <strong>{selectedAction.appName}</strong>
                    <small>{selectedAction.appPath}</small>
                  </div>
                  <button disabled={busy} onClick={() => void chooseApplication()}>
                    앱 선택…
                  </button>
                </div>
              ) : selectedAction?.type === 'unsupported' ? (
                <p className="unsupported-action">미지원</p>
              ) : null}

              {applicationError && (
                <p className="inline-error" role="alert">
                  앱을 찾을 수 없음: {applicationError}
                </p>
              )}

              <button
                className="test-action"
                disabled={
                  busy ||
                  Boolean(applicationError) ||
                  selectedAction?.type === 'unsupported' ||
                  (selectedAction?.type === 'key' && !isMediaKeyCode(selectedAction.keyCode))
                }
                title={
                  selectedAction?.type === 'key' && !isMediaKeyCode(selectedAction.keyCode)
                    ? '일반 키는 안전한 장치 적용 지원 후 테스트할 수 있습니다.'
                    : undefined
                }
                onClick={() => void testAction()}
              >
                테스트 실행
              </button>

              {selectedAction?.type === 'key' && !isMediaKeyCode(selectedAction.keyCode) && (
                <p className="key-test-note">
                  일반 키는 현재 로컬 저장·백업만 가능합니다. 미디어 키와 앱 실행은 바로
                  테스트할 수 있습니다.
                </p>
              )}
                </>
              )}

              <label className="keyboard-field runtime-profile-field">
                <span>F16~F18 사용 프로파일</span>
                <select
                  aria-label="F16~F18 사용 프로파일"
                  value={settings.activeProfileId}
                  onChange={(event) =>
                    patchSettings((draft) => {
                      draft.activeProfileId = Number(event.target.value) as ProfileId;
                    })
                  }
                >
                  {PROFILE_IDS.map((profileId) => (
                    <option key={profileId} value={profileId}>Profile {profileId}</option>
                  ))}
                </select>
                <small>프로필 탭은 보기·편집만 하며, 이 선택값은 별도로 저장됩니다.</small>
              </label>

              <label className="shortcut-toggle">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(event) =>
                    patchSettings((draft) => {
                      draft.enabled = event.target.checked;
                    })
                  }
                />
                <span>
                  F16~F18 컴퓨터 단축키 활성화
                  <small>기존 볼륨 단축키 F19/F20은 변경하지 않습니다.</small>
                </span>
              </label>

              <div className="keyboard-save-actions">
                <button
                  disabled={!dirty || busy}
                  onClick={() => {
                    setSettings(saved);
                    setSelectedProfileId(saved.activeProfileId);
                    setSelectedSlot('left');
                  }}
                >
                  되돌리기
                </button>
                <button className="primary" disabled={!dirty || busy} onClick={() => void save()}>
                  로컬 설정 저장
                </button>
              </div>
              <button
                className="device-apply"
                disabled
                title={runtime.deviceApplyReason}
              >
                장치에 적용
              </button>
              <p className="protocol-blocked">{runtime.deviceApplyReason}</p>
            </aside>
          </div>
          </section>

          <aside className="backup-manager" aria-labelledby="backup-heading">
          <div className="backup-title-row">
            <div>
              <h2 id="backup-heading">사용자 백업</h2>
              <p>Profile 2~5의 하단 버튼 설정을 로컬에 저장합니다.</p>
            </div>
            <span>{backups.items.length} / {backups.maxItems}</span>
          </div>

          {backups.warning && <p className="error" role="alert">{backups.warning}</p>}

          <div className="backup-form">
            <h3>새 백업</h3>
            <label>
              <span>백업 이름 *</span>
              <input
                maxLength={40}
                value={backupName}
                placeholder="예: 작업용 키 세팅"
                onChange={(event) => setBackupName(event.target.value)}
              />
              <small>{backupName.length} / 40</small>
            </label>
            <label>
              <span>설명</span>
              <textarea
                maxLength={500}
                value={backupDescription}
                placeholder="백업 내용을 입력하세요."
                onChange={(event) => setBackupDescription(event.target.value)}
              />
              <small>{backupDescription.length} / 500</small>
            </label>
            <button
              className="primary"
              disabled={
                busy ||
                Boolean(backups.warning) ||
                backupName.trim().length === 0 ||
                backups.items.length >= backups.maxItems
              }
              onClick={() => void createBackup()}
            >
              백업 저장
            </button>
            {backups.warning && (
              <p className="capacity-message">
                백업 파일 오류를 해결하기 전에는 저장·덮어쓰기·삭제할 수 없습니다.
              </p>
            )}
            {backups.items.length >= backups.maxItems && (
              <p className="capacity-message">10/10 · 백업을 삭제하거나 기존 백업에 덮어쓰세요.</p>
            )}
          </div>

          <div className="backup-list">
            <h3>저장된 백업</h3>
            {backups.items.length === 0 ? (
              <p className="backup-empty">저장된 백업이 없습니다.</p>
            ) : (
              backups.items.map((backup) => (
                <article
                  key={backup.id}
                  className={selectedBackupId === backup.id ? 'backup-item selected' : 'backup-item'}
                >
                  <button
                    className="backup-summary"
                    aria-pressed={selectedBackupId === backup.id}
                    onClick={() => setSelectedBackupId(backup.id)}
                  >
                    <strong>{backup.name}</strong>
                    <small>{formatDate(backup.createdAt)} · P2~P5 · 논리 설정 12개</small>
                    {backup.description && <span>{backup.description}</span>}
                  </button>
                  {selectedBackupId === backup.id && (
                    <div className="backup-item-actions">
                      <button onClick={() => void restoreBackup(backup)}>편집 화면에 복원</button>
                      <button
                        disabled={busy || Boolean(backups.warning)}
                        onClick={() => void overwriteBackup(backup)}
                      >
                        현재 설정으로 덮어쓰기
                      </button>
                      <button
                        className="danger-button"
                        disabled={busy || Boolean(backups.warning)}
                        onClick={() => void deleteBackup(backup)}
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
          </aside>
        </div>
      </fieldset>

      <p className="keyboard-safety">
        P1 고정값과 P2~P5 하단 버튼 설정만 저장합니다. 기존 볼륨·노브, 장치 원복용 안전 백업,
        Save·펌웨어·LED는 변경하지 않습니다.
      </p>
    </main>
  );
}

function isMediaKeyCode(keyCode: KeyboardKeyCode): keyCode is MediaKeyCode {
  return MEDIA_KEY_CODES.includes(keyCode as MediaKeyCode);
}

function shortcutStateLabel(state: KeyboardRuntimeStatus['shortcutState']): string {
  if (state === 'active') return '활성';
  if (state === 'error') return '오류';
  return '비활성';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
