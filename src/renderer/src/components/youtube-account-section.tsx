import type { StatusSnapshot } from '../../../shared/types';

type YoutubeAccountSectionProps = {
  status: StatusSnapshot;
  busy: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onRefresh: () => Promise<void>;
};

export function YoutubeAccountSection({
  status,
  busy,
  onSignIn,
  onSignOut,
  onRefresh,
}: YoutubeAccountSectionProps) {
  const signedIn = status.youtubeAccount.signedIn;

  return (
    <section className="settings-section youtube-account-section" aria-label="YouTube 계정">
      <h2>YouTube 계정</h2>
      <p className="youtube-premium-note">
        개인 Premium 계정은 이 앱이 연 Google 로그인 창에서만 인증하세요. 시스템 Chrome에
        로그인해도 이 앱과 세션이 공유되지 않습니다. 비밀번호는 Google만 받고, 앱은 이 Mac의
        로컬 세션 쿠키만 보관합니다. 공용 PC면 사용 후 로그아웃하세요.
      </p>
      <div className="youtube-account-row">
        <span>
          상태: <strong>{status.youtubeAccount.label}</strong>
        </span>
        <span className="youtube-account-actions">
          <button type="button" disabled={busy} onClick={() => void onRefresh()}>
            다시 확인
          </button>
          {signedIn ? (
            <button type="button" disabled={busy} onClick={() => void onSignOut()}>
              로그아웃
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void onSignIn()}
            >
              Google 계정 연결
            </button>
          )}
        </span>
      </div>
    </section>
  );
}
