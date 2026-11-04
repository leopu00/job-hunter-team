import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { LOCAL_PROFILES_TEXT } from "../components/local-profiles.i18n";
import { appLocale } from "../lib/app-locale";
import { waitAtMost } from "../lib/wait-at-most";
import { probeDesktopLocalTeamOwner } from "../lib/desktop-account-scope";
import { readDesktopTeamOwnerIdentity } from "../lib/desktop-team-owner";
import { labelLocalProfiles, listLocalProfiles, localIdentitySelected, localProfileLabel, readLocalProfile, readTeamOwnerCopy } from "../lib/local-profile";
import { localOwnerWays } from "../lib/local-owner";
import { useProviderSetup } from "../lib/provider-setup";
import { useLocation } from "./router";

/** Whose the team of this computer is, as seen from the profile in use. */
export type TeamOwnerView =
  | { owner: "self" | "none" }
  /** the folder holds data that no profile owns and the profile in use cannot take: no owner to switch to */
  | { owner: "nobody" }
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
  if (owner.profileId === active.profileId) return { owner: "self" };
  return { owner: "other", name: localProfileLabel(owner.profileId) ?? owner.displayName };
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
  probe: typeof probeDesktopLocalTeamOwner = probeDesktopLocalTeamOwner,
): Promise<TeamOwnerView | null> {
  let identity;
  try {
    identity = await ask();
  } catch {
    return null;
  }
  if (!localIdentitySelected()) return { owner: "none" };
  const active = readLocalProfile();
  if (!active) return { owner: "none" };
  if (identity === null) {
    // No marker names anyone: either nobody took the team yet, or the folder holds data that belong to no
    // profile and this one may not take. Only the second has something to say; a probe that fails is the first.
    const owner = await probe().catch(() => null);
    return owner === "nobody" ? { owner: "nobody" } : { owner: "none" };
  }
  if (identity.kind === "local" && identity.profileId === active.profileId) return { owner: "self" };
  if (identity.kind === "google") return { owner: "other", name: null, account: true };
  const name = labelLocalProfiles(listLocalProfiles()).find((profile) => profile.profileId === identity.profileId)?.label ?? null;
  return { owner: "other", name };
}

const defaultWays = localOwnerWays(() => undefined);

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
  ways = defaultWays,
  locale: localeOverride,
}: {
  read?: () => TeamOwnerView;
  /** the backend's answer, which wins over `read` when it comes */
  readNative?: () => Promise<TeamOwnerView | null>;
  /** the app's own sign-out: for a local profile it leaves it and opens the choice of profile */
  onSwitch?: () => Promise<void>;
  /** the take-over of the team (and the probe that says it can be offered); the native side's, in the app */
  ways?: { probe: () => Promise<boolean>; takeOver: () => Promise<void> };
  locale?: Locale;
}) {
  const locale = localeOverride ?? appLocale();
  const { path } = useLocation();
  // null while the backend is asked: nothing shows, so the copy never shows only to be taken back
  const [view, setView] = useState<TeamOwnerView | null>(null);
  const [busy, setBusy] = useState(false);
  // The team can be taken over only when its owner is a local profile of this app that the native side names without doubt.
  const [canTake, setCanTake] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [takeFailed, setTakeFailed] = useState(false);
  // After taking the team over, the setup opens on the step where the team's place is chosen.
  const providerSetup = useProviderSetup();
  const ownerIsOther = view?.owner === "other" && !view.account;
  useEffect(() => {
    setCanTake(false);
    if (!ownerIsOther) { setConfirming(false); return; }
    let live = true;
    void ways.probe().then((known) => { if (live) setCanTake(known); }).catch(() => undefined);
    return () => { live = false; };
  }, [ownerIsOther, ways, view]);

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

  if (!view || (view.owner !== "other" && view.owner !== "nobody")) return null;
  const t = LOCAL_PROFILES_TEXT[locale];
  const text = view.owner === "nobody"
    ? t.ownerBannerNobody
    : view.account
      ? t.ownerBannerAccount
      : view.name ? t.ownerBanner.replace("{name}", () => view.name as string) : t.ownerBannerUnknown;
  const takeable = canTake && ownerIsOther;
  // With the two ways to offer, ONE sentence says the situation and both: the one-way sentence («switch to that profile
  // to use it») would contradict the second way.
  const ownerName = view?.owner === "other" ? view.name : null;
  const choicesText = ownerName ? t.ownerChoicesNamed.replace(/\{name\}/g, () => ownerName) : t.ownerChoices;
  async function takeTeam() {
    setBusy(true);
    setTakeFailed(false);
    try {
      await ways.takeOver();
      setConfirming(false);
      setView({ owner: "self" });
      providerSetup?.open();
    } catch {
      setTakeFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      role="status"
      data-testid="local-team-owner-banner"
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <span>{takeable ? choicesText : text}</span>
      {onSwitch && view.owner === "other" && (
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
      {takeable && !confirming && (
        <button
          type="button"
          data-testid="local-team-owner-take"
          disabled={busy}
          onClick={() => { setTakeFailed(false); setConfirming(true); }}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-border-glow)] disabled:opacity-60"
        >
          {t.takeTeam}
        </button>
      )}
      {takeable && confirming && (
        <>
          <span data-testid="local-team-owner-take-confirm" className="basis-full">{t.takeConfirm}</span>
          <button
            type="button"
            data-testid="local-team-owner-take-yes"
            disabled={busy}
            onClick={() => void takeTeam()}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-border-glow)] disabled:opacity-60"
          >
            {t.takeYes}
          </button>
          <button
            type="button"
            data-testid="local-team-owner-take-cancel"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-border-glow)] disabled:opacity-60"
          >
            {t.takeCancel}
          </button>
        </>
      )}
      {takeFailed && <span role="alert" data-testid="local-team-owner-take-failed" className="basis-full">{t.takeFailed}</span>}
    </div>
  );
}
