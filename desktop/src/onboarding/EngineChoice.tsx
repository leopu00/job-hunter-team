import { useCallback, useEffect, useRef, useState } from "react";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { readHarnessChoice, setHarnessChoice, type HarnessChoice, type HarnessName, type HarnessOutcome } from "../lib/harness-choice";
import { HARNESS_CHOICE_TEXT } from "../pages/settings/harness-choice.i18n";

/**
 * The program that drives the agents, asked before the provider's sign-in: Codex (the usual one, signed in by the
 * app's own window) or Pi, where the team's provider allows it. Written by the team's own CLI (harness_choice.rs),
 * the same way as in Settings. With Pi the sign-in is Pi's own and is done in a terminal (`jht oauth-login`: Pi's
 * screen cannot be shown in the app's window), so while Pi is chosen and not signed in the step waits
 * (`onBlock(true)`), and «Check again» looks at the marker (never reads it); the step goes on when it is there.
 * Shown only where there is something to choose; if the choice cannot be read the step goes on as it always did.
 * `read` and `set` are for the tests.
 */
export default function EngineChoice({ onBlock, read = readHarnessChoice, set = setHarnessChoice }: {
  /** True while the person has to sign in to Pi in a terminal before the step can go on. */
  onBlock: (blocked: boolean) => void;
  read?: () => Promise<HarnessOutcome>;
  set?: (harness: HarnessName) => Promise<HarnessOutcome>;
}) {
  const t = HARNESS_CHOICE_TEXT[appLocale()];
  const [current, setCurrent] = useState<HarnessChoice | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const latest = useRef(onBlock);
  latest.current = onBlock;

  const show = useCallback((choice: HarnessChoice | null) => {
    setCurrent(choice);
    latest.current(choice !== null && choice.harness === "pi" && choice.login !== "signed_in" && choice.login !== "not_needed");
  }, []);

  const load = useCallback(async () => {
    const result = await read().catch((): HarnessOutcome => ({ ok: false, code: "harness_unavailable" }));
    show(result.ok ? result.value : null);
  }, [read, show]);

  useEffect(() => {
    void load();
    return () => latest.current(false);
  }, [load]);

  async function choose(harness: HarnessName) {
    if (pending || !current || harness === current.harness) return;
    setPending(true);
    setError(null);
    const result = await set(harness).catch((): HarnessOutcome => ({ ok: false, code: "harness_set_failed" }));
    if (result.ok && result.value.harness === harness) show(result.value);
    else setError(result.ok ? "harness_set_failed" : result.code);
    setPending(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(t.command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // nothing to choose: Pi is not allowed with this provider and Codex is what runs
  if (!current || (!current.piAllowed && current.harness === "codex")) return null;
  const told = error ? describeError(error, { locale: appLocale() }) : null;
  const options: [HarnessName, string][] = [["codex", t.codex], ["pi", t.pi]];
  const needsSignIn = current.harness === "pi" && current.login !== "signed_in" && current.login !== "not_needed";
  return (
    <section className="onboarding-provider-console onboarding-plan" aria-label={t.title} data-testid="engine-choice">
      <div className="onboarding-provider-console__heading"><div><strong>{t.title}</strong><small>{t.text}</small></div></div>
      <div className="onboarding-plan__list" role="radiogroup" aria-label={t.title}>
        {options.map(([name, label]) => (
          <label key={name} className={`onboarding-plan__option${current.harness === name ? " is-selected" : ""}`}>
            <input type="radio" name="agent-program" value={name} checked={current.harness === name} disabled={pending || (name === "pi" && !current.piAllowed)} onChange={() => void choose(name)} />
            <span><strong>{label}</strong>{name === "pi" && <>{" "}<small>{t.piNote}</small></>}</span>
          </label>
        ))}
      </div>
      {told && <p className="onboarding-error" role="alert" data-testid="engine-error">{told.text} {told.action}</p>}
      {current.harness === "pi" && current.login !== "not_needed" && (
        <div data-testid="engine-login" data-login={current.login}>
          <small className="onboarding-hint">{current.login === "signed_in" ? t.loginIn : current.login === "signed_out" ? (current.loginFound.length > 0 ? t.loginOther.replace("{names}", current.loginFound.join(", ")) : t.loginOut) : t.loginUnknown}</small>
          {needsSignIn && <p><code data-testid="engine-command">{t.command}</code></p>}
          <div className="onboarding-runtime-actions">
            {needsSignIn && <button className="onboarding-secondary" type="button" data-testid="engine-copy" onClick={() => void copy()}>{copied ? t.copied : t.copy}</button>}
            <button className="onboarding-secondary" type="button" data-testid="engine-recheck" disabled={pending} onClick={() => void load()}>{t.recheck}</button>
          </div>
        </div>
      )}
    </section>
  );
}
