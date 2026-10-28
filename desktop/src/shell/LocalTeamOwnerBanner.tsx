import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { LOCAL_PROFILES_TEXT } from "../components/local-profiles.i18n";
import { appLocale } from "../lib/app-locale";
import { waitAtMost } from "../lib/wait-at-most";
import { readDesktopTeamOwnerIdentity } from "../lib/desktop-team-owner";
import { listLocalProfiles, localIdentitySelected, readLocalProfile, readTeamOwnerCopy } from "../lib/local-profile";
import { useLocation } from "./router";

/** Whose the team of this computer is, as seen from the profile in use. */
export type TeamOwnerView =
  | { owner: "self" | "none" }
  | { owner: "other"; name: string | null; /** the owner is an account that signed in, not a local profile */ account?: boolean };

/** How long the first frame waits for the backend before it shows the renderer's copy. */
const NATIVE_WAIT_MS = 1500;

/**
 * The renderer's own copy of the answer: the profile in use against the one that started its setup
 * first (see `readTeamOwnerCopy`). It is what shows first and what stays when the backend cannot be
 * asked; the backend's marker is the truth and its answer (`readNativeTeamOwnerView`) replaces it.
 */
export function readTeamOwnerView(): TeamOwnerView {
  if (!localIdentitySelected()) return { owner: "none" };
  const active = readLocalProfile();
  const owner = readTeamOwnerCopy();
  if (!active || !owner) return { owner: "none" };
  return owner.profileId === active.profileId ? { owner: "self" } : { owner: "other", name: owner.displayName };
}

/**
 * The backend's answer, which is the truth: who the owner marker names, against the profile in use.
 * Null when it cannot be asked (not in the desktop app, a backend without the command, a reply that
 * is not one): the renderer's copy then speaks. A team nobody owns yet, or an owner that is an
 * account, are answers: the first is «none» and the second is another owner that is an account.
 * A local profile this list does not have is another owner whose name is not known.
 */
export async function readNativeTeamOwnerView(
  ask: typeof readDesktopTeamOwnerIdentity = readDesktopTeamOwnerIdentity,
): Promise<TeamOwnerView | null> {
  let identity;
  try {
    identity = await ask();
  } catch {
    return null;
  }
  if (!localIdentitySelected()) return { owner: "none" };
  const active = readLocalProfile();
  if (!active || identity === null) return { owner: "none" };
  if (identity.kind === "local" && identity.profileId === active.profileId) return { owner: "self" };
  if (identity.kind === "google") return { owner: "other", name: null, account: true };
  const name = listLocalProfiles().find((profile) => profile.profileId === identity.profileId)?.displayName ?? null;
  return { owner: "other", name };
}

/**
 * The band inside the app while the profile in use does not own the team of this computer: it says
 * whose the team is and offers the way to that profile (signing out of this one leads to the choice).
 * A profile that does not own the team uses the pages all the same; this is the reason the team is
 * not here. Nothing shows to the owner, to a Google account, or when nobody is known to own the team.
 */
export function LocalTeamOwnerBanner({
  read = readTeamOwnerView,
  readNative = readNativeTeamOwnerView,
  onSwitch,
  locale: localeOverride,
}: {
  read?: () => TeamOwnerView;
  /** the backend's answer, which wins over `read` when it comes */
  readNative?: () => Promise<TeamOwnerView | null>;
  /** the app's own sign-out: for a local profile it leaves it and opens the choice of profile */
  onSwitch?: () => Promise<void>;
  locale?: Locale;
}) {
  const locale = localeOverride ?? appLocale();
  const { path } = useLocation();
  // null while the backend is asked: nothing shows, so the copy never shows only to be taken back
  const [view, setView] = useState<TeamOwnerView | null>(null);
  const [busy, setBusy] = useState(false);

  // read again where the answer can have changed: another page, the window coming back (what shows stays until the new answer)
  useEffect(() => {
    let live = true;
    const again = () => {
      void waitAtMost(readNative(), NATIVE_WAIT_MS).then((native) => {
        if (live) setView(native ?? read());
      });
    };
    again();
    window.addEventListener("focus", again);
    return () => {
      live = false;
      window.removeEventListener("focus", again);
    };
  }, [read, readNative, path]);

  if (!view || view.owner !== "other") return null;
  const t = LOCAL_PROFILES_TEXT[locale];
  const text = view.account
    ? t.ownerBannerAccount
    : view.name ? t.ownerBanner.replace("{name}", () => view.name as string) : t.ownerBannerUnknown;
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
