import { useSignOut } from "../lib/account-actions";
import { appLocale } from "../lib/app-locale";
import { cloudSessionReadable } from "../lib/auth-storage-lock";
import { useExistingTeamView } from "../lib/existing-team-readonly";
import { CLOUD_DATA_NOTICE_TEXT } from "./cloud-data-notice.i18n";

/**
 * What a page that reads the cloud says when there is no cloud session to read with (a local profile):
 * not an empty page with no word, not «session expired» to someone who never signed in. A team read on
 * its VPS has its own data, so the line is not there.
 */
export default function CloudDataNotice() {
  const existingTeam = useExistingTeamView();
  const signIn = useSignOut();
  if (cloudSessionReadable() || existingTeam !== null) return null;
  const text = CLOUD_DATA_NOTICE_TEXT[appLocale()];
  return (
    <section
      role="note"
      className="max-w-6xl mx-auto px-5 pt-6 flex flex-wrap items-center justify-between gap-3 text-[12px] text-[var(--color-muted)]"
    >
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
    </section>
  );
}
