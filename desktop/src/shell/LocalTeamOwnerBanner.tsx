import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import { LOCAL_PROFILES_TEXT } from "../components/local-profiles.i18n";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { LOCAL_RUNTIME_REMOVED_EVENT } from "../lib/local-uninstall";
import { setAsideUnassignedLocalData } from "../lib/onboarding-runtime";
import { ONBOARDING_TEXT } from "../onboarding/onboarding.i18n";
import { waitAtMost } from "../lib/wait-at-most";
import { probeDesktopLocalTeamOwner } from "../lib/desktop-account-scope";
import { readDesktopTeamOwnerIdentity } from "../lib/desktop-team-owner";
import { listLocalProfiles, localIdentitySelected, readLocalProfile, readTeamOwnerCopy } from "../lib/local-profile";
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
  const name = listLocalProfiles().find((profile) => profile.profileId === identity.profileId)?.displayName ?? null;
  return { owner: "other", name };
}

/**
 * Back to the first start, as the app does when the runtime was removed: DashboardApp listens for this, forgets
 * the profile's setup marker, goes to the dashboard and reloads, so the gate asks for a setup on the empty Mac.
 * If nothing is listening (no profile in use) the page is only reloaded.
 */
export function startAgain(): void {
  window.dispatchEvent(new CustomEvent(LOCAL_RUNTIME_REMOVED_EVENT));
  window.setTimeout(() => window.location.reload(), 500);
}

/** The code a failed native call carries, a string for a thrown plain one; the catalog has the rest. */
function codeOf(error: unknown): string {
  if (typeof error === "string") return error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "local_data_set_aside_failed";
}

/**
 * What to do about data on this Mac that no profile owns and this one may not take: set them aside and
 * start again. After a confirmation that says what happens (the folder is moved to one named with the date,
 * nothing is deleted or copied), the native side moves it, the person is told where it went, and the app is
 * opened again so its setup finds an empty Mac. The words are the setup's own for the same choice.
 */
function SetAsideData({
  locale,
  setAside,
  restart,
}: {
  locale: Locale;
  setAside: () => Promise<string>;
  restart: () => void;
}) {
  const t = ONBOARDING_TEXT[locale];
  const [step, setStep] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [folder, setFolder] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const taken = useRef(false);

  async function confirm() {
    if (taken.current) return;
    taken.current = true;
    setStep("busy");
    setFailure(null);
    try {
      setFolder(await setAside());
      setStep("done");
    } catch (error) {
      const { text, action } = describeError(codeOf(error), { locale, fallback: "local_data_set_aside_failed" });
      setFailure(`${text} ${action}`);
      setStep("confirm");
    } finally {
      taken.current = false;
    }
  }

  const button = "rounded border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-border-glow)] disabled:opacity-60";
  if (step === "done") {
    return (
      <span data-testid="local-data-aside-done" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{t.dataAsideDone.replace("{folder}", () => folder)}</span>
        <button type="button" data-testid="local-data-aside-continue" className={button} onClick={restart}>{t.continue}</button>
      </span>
    );
  }
  if (step === "idle") {
    return (
      <button type="button" data-testid="local-data-aside" className={button} onClick={() => setStep("confirm")}>
        {t.dataAside}
      </button>
    );
  }
  return (
    <span role="group" aria-label={t.dataAsideAria} data-testid="local-data-aside-confirm" className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1">
      <strong>{t.dataAsideTitle}</strong>
      <span className="text-[var(--color-muted)]">{t.dataAsideText}</span>
      {failure && <span role="alert" data-testid="local-data-aside-failed">{failure}</span>}
      <button type="button" data-testid="local-data-aside-yes" className={button} disabled={step === "busy"} onClick={() => void confirm()}>
        {step === "busy" ? t.dataBusy : t.dataAsideYes}
      </button>
      <button type="button" data-testid="local-data-aside-cancel" className={button} disabled={step === "busy"} onClick={() => { setFailure(null); setStep("idle"); }}>
        {t.cancel}
      </button>
    </span>
  );
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
  setAside = setAsideUnassignedLocalData,
  restart = startAgain,
  locale: localeOverride,
}: {
  read?: () => TeamOwnerView;
  /** the backend's answer, which wins over `read` when it comes */
  readNative?: () => Promise<TeamOwnerView | null>;
  /** the app's own sign-out: for a local profile it leaves it and opens the choice of profile */
  onSwitch?: () => Promise<void>;
  /** «set it aside and start again» for data no profile owns: resolves with the name of the folder they went to */
  setAside?: () => Promise<string>;
  /** takes the app back to its first start once the data are set aside, so its setup runs on an empty Mac */
  restart?: () => void;
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

  if (!view || (view.owner !== "other" && view.owner !== "nobody")) return null;
  const t = LOCAL_PROFILES_TEXT[locale];
  const text = view.owner === "nobody"
    ? t.ownerBannerNobody
    : view.account
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
      {view.owner === "nobody" && <SetAsideData locale={locale} setAside={setAside} restart={restart} />}
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
    </div>
  );
}
