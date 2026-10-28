import { useSignOut } from "../lib/account-actions";
import { appLocale } from "../lib/app-locale";
import { cloudSessionReadable } from "../lib/auth-storage-lock";
import { useExistingTeamView } from "../lib/existing-team-readonly";
import { CLOUD_DATA_NOTICE_TEXT } from "./cloud-data-notice.i18n";

/**
 * True when a page that reads the cloud has nothing to read with: there is no cloud session (a local
 * profile) and no team read on its VPS, whose own data would answer. Such a page shows `CloudDataNotice`
 * and nothing else: an empty page would say «no positions», «deck finished», «no team connected» about
 * data that was never asked for.
 */
export function useCloudDataBlocked(): boolean {
  const existingTeam = useExistingTeamView();
  return !cloudSessionReadable() && existingTeam === null;
}

/**
 * What a page that reads the cloud says when there is no cloud session to read with (a local profile):
 * the page itself, a card that says where the data comes from and where the team's work is, not an empty
 * page with no word, not «session expired» to someone who never signed in. A team read on its VPS has its
 * own data, so the card is not there. The top space clears the button the Team page floats on the right.
 */
export default function CloudDataNotice() {
  const blocked = useCloudDataBlocked();
  const signIn = useSignOut();
  if (!blocked) return null;
  const text = CLOUD_DATA_NOTICE_TEXT[appLocale()];
  return (
    <section role="note" className="max-w-6xl mx-auto px-5 pt-16">
      <div className="max-w-xl mx-auto flex flex-col items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-6 py-10 text-center text-[13px] text-[var(--color-muted)]">
        <p>{text.notice}</p>
        {signIn && (
          <button
            type="button"
            className="border border-[var(--color-border)] rounded px-3 py-1.5"
            onClick={() => void signIn().catch(() => undefined)}
          >
            {text.signIn}
          </button>
        )}
      </div>
    </section>
  );
}
