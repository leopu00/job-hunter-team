import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { LOCAL_PROFILES_TEXT } from "../components/local-profiles.i18n";
import { appLocale } from "../lib/app-locale";
import { localIdentitySelected, readLocalProfile, readTeamOwnerCopy } from "../lib/local-profile";
import { useLocation } from "./router";

/** Whose the team of this computer is, as seen from the profile in use. */
export type TeamOwnerView = { owner: "self" | "none" } | { owner: "other"; name: string | null };

/**
 * The renderer's own copy of the answer: the profile in use against the one that started its setup
 * first (see `readTeamOwnerCopy`). The backend's marker is the truth, and its answer, when there is a
 * command to ask it, replaces this read in `read`.
 */
export function readTeamOwnerView(): TeamOwnerView {
  if (!localIdentitySelected()) return { owner: "none" };
  const active = readLocalProfile();
  const owner = readTeamOwnerCopy();
  if (!active || !owner) return { owner: "none" };
  return owner.profileId === active.profileId ? { owner: "self" } : { owner: "other", name: owner.displayName };
}

/**
 * The band inside the app while the profile in use does not own the team of this computer: it says
 * whose the team is and offers the way to that profile (signing out of this one leads to the choice).
 * A profile that does not own the team uses the pages all the same; this is the reason the team is
 * not here. Nothing shows to the owner, to a Google account, or when nobody is known to own the team.
 */
export function LocalTeamOwnerBanner({
  read = readTeamOwnerView,
  onSwitch,
  locale: localeOverride,
}: {
  read?: () => TeamOwnerView;
  /** the app's own sign-out: for a local profile it leaves it and opens the choice of profile */
  onSwitch?: () => Promise<void>;
  locale?: Locale;
}) {
  const locale = localeOverride ?? appLocale();
  const { path } = useLocation();
  const [view, setView] = useState<TeamOwnerView>(() => read());
  const [busy, setBusy] = useState(false);

  // read again where the answer can have changed: another page, the window coming back
  useEffect(() => {
    const again = () => setView(read());
    again();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [read, path]);

  if (view.owner !== "other") return null;
  const t = LOCAL_PROFILES_TEXT[locale];
  const text = view.name ? t.ownerBanner.replace("{name}", () => view.name as string) : t.ownerBannerUnknown;
  return (
    <div
      role="status"
      data-testid="local-team-owner-banner"
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <span>{text}</span>
      {onSwitch && (
        <button
          type="button"
          data-testid="local-team-owner-switch"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onSwitch().finally(() => setBusy(false));
          }}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-border-glow)] disabled:opacity-60"
        >
          {t.switchProfile}
        </button>
      )}
    </div>
  );
}
