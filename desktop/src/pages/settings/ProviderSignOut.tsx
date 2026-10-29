import { useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { readProviderSignIn, signOutProvider, type ProviderName, type ProviderOutcome } from "../../lib/team-provider";
import { fill } from "../../lib/text-slots";
import { PROVIDER_SIGNOUT_TEXT } from "./provider-signout.i18n";

const NAMES: Record<ProviderName, string> = { claude: "Claude", codex: "Codex", kimi: "Kimi" };
const buttonCls = "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border";

type State =
  | { step: "hidden" }
  | { step: "signed-in"; provider: ProviderName }
  | { step: "confirming"; provider: ProviderName }
  | { step: "working"; provider: ProviderName }
  | { step: "done" };

/**
 * The «Disconnect the account» part of the Provider card: only where the team of this computer is signed in
 * with its provider, never anywhere else (a read that fails shows nothing). The click asks first, in words:
 * the agents at work stop and the access at the provider is not revoked. Only «Yes» sends the request, and
 * what is told afterwards is what the team holds after it: a sign-in that is still there, or an answer about
 * another provider than the one confirmed, is an error, never «disconnected». `read` and `signOut` are for the tests.
 */
export default function ProviderSignOut({
  read = readProviderSignIn,
  signOut = signOutProvider,
}: {
  read?: () => Promise<ProviderOutcome>;
  signOut?: () => Promise<ProviderOutcome>;
}) {
  const t = PROVIDER_SIGNOUT_TEXT[appLocale()];
  const [state, setState] = useState<State>({ step: "hidden" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    read()
      .then((result) => {
        if (live && result.ok && result.value.authenticated) setState({ step: "signed-in", provider: result.value.provider });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [read]);

  const confirm = async (provider: ProviderName) => {
    setError(null);
    setState({ step: "working", provider });
    const result = await signOut().catch((): ProviderOutcome => ({ ok: false, code: "team_provider_unavailable" }));
    // «disconnected» only if the answer is about the provider the person confirmed and says no sign-in is left
    if (result.ok && result.value.provider === provider && !result.value.authenticated) return setState({ step: "done" });
    // not done: say why, and leave the person where the sign-in still is
    setError(result.ok ? (result.value.provider !== provider ? "provider_changed" : "provider_logout_incomplete") : result.code);
    setState({ step: "signed-in", provider });
  };

  if (state.step === "hidden") return null;
  const told = error ? describeError(error, { locale: appLocale() }) : null;
  return (
    <div className="flex flex-col gap-2" data-testid="provider-signout" data-step={state.step}>
      {state.step === "done" && (
        <p className="text-[12px] text-[var(--color-muted)]" role="status" data-testid="provider-signout-done">{t.signedOut}</p>
      )}
      {state.step !== "done" && (
        <p className="text-[12px] text-[var(--color-muted)]">{fill(t.signedIn, { provider: NAMES[state.provider] })}</p>
      )}
      {told && (
        <p className="text-[12px] text-[var(--color-red)]" role="alert" data-testid="provider-signout-error">
          {told.text} {told.action}
        </p>
      )}
      {(state.step === "signed-in" || state.step === "working") && (
        <div>
          <button
            type="button"
            data-testid="provider-signout-open"
            disabled={state.step === "working"}
            onClick={() => setState({ step: "confirming", provider: state.provider })}
            className={`${buttonCls} border-[var(--color-red)] text-[var(--color-red)] disabled:opacity-50`}
          >
            {state.step === "working" ? t.working : t.button}
          </button>
        </div>
      )}
      {state.step === "confirming" && (
        <div role="group" aria-labelledby="provider-signout-title" data-testid="provider-signout-confirm" className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-3">
          <h3 id="provider-signout-title" className="text-[12px] font-semibold text-[var(--color-bright)]">
            {fill(t.confirmTitle, { provider: NAMES[state.provider] })}
          </h3>
          <p className="text-[12px] text-[var(--color-muted)]">{fill(t.confirmText, { provider: NAMES[state.provider] })}</p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="provider-signout-yes"
              onClick={() => confirm(state.provider)}
              className={`${buttonCls} border-[var(--color-red)] text-[var(--color-red)]`}
            >
              {t.confirmYes}
            </button>
            <button
              type="button"
              data-testid="provider-signout-no"
              onClick={() => setState({ step: "signed-in", provider: state.provider })}
              className={`${buttonCls} border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]`}
            >
              {t.confirmNo}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
