import { useState } from 'react';
import type { AppConfig } from '../../../shared/types';

type YoutubeSettingsSectionProps = {
  config: AppConfig;
  busy: boolean;
  message: string;
  error: string;
  onAdd: (input: string) => Promise<void>;
  onRemove: (index: number) => Promise<void>;
  onMove: (index: number, direction: -1 | 1) => Promise<void>;
  onPlay: (index: number) => Promise<void>;
};

export function YoutubeSettingsSection({
  config,
  busy,
  message,
  error,
  onAdd,
  onRemove,
  onMove,
  onPlay,
}: YoutubeSettingsSectionProps) {
  const [draft, setDraft] = useState('');
  const library = config.youtubeLibrary;

  const submit = async () => {
    const input = draft.trim();
    if (!input || busy) return;
    await onAdd(input);
    setDraft('');
  };

  return (
    <section className="settings-section youtube-settings" aria-label="YouTube 목록">
      <h2>YouTube 목록</h2>
      <p className="youtube-premium-note">
        P5에서 이전/다음으로 돌릴 영상입니다. 인증은 위 YouTube 계정에서 합니다.
      </p>
      <label className="youtube-url-field">
        영상 URL 또는 ID
        <span>
          <input
            value={draft}
            disabled={busy}
            placeholder="https://www.youtube.com/watch?v=…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <button type="button" disabled={busy || !draft.trim()} onClick={() => void submit()}>
            추가
          </button>
        </span>
      </label>
      {library.items.length === 0 ? (
        <p className="youtube-empty">재생 목록이 없습니다. URL을 추가하세요.</p>
      ) : (
        <ul className="youtube-library-list">
          {library.items.map((item, index) => {
            const current = index === library.currentIndex;
            return (
              <li key={item.videoId} className={current ? 'is-current' : undefined}>
                <button
                  type="button"
                  className="youtube-library-play"
                  disabled={busy}
                  onClick={() => void onPlay(index)}
                >
                  <strong>{item.title.trim() || item.videoId}</strong>
                  <small>{item.channel.trim() || '채널 정보 없음'}</small>
                </button>
                <span className="youtube-library-actions">
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    aria-label="위로"
                    onClick={() => void onMove(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === library.items.length - 1}
                    aria-label="아래로"
                    onClick={() => void onMove(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="삭제"
                    onClick={() => void onRemove(index)}
                  >
                    삭제
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="keyboard-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
