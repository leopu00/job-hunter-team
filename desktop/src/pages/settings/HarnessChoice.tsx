import { useCallback, useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { readHarnessChoice, setHarnessChoice, type HarnessChoice as Choice, type HarnessName, type HarnessOutcome } from "../../lib/harness-choice";
import { HARNESS_CHOICE_TEXT } from "./harness-choice.i18n";

const buttonCls = "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-50";

/**
 * «Program of the agents» in the Settings «Provider» card: Codex or Pi, written by the team's own CLI
 * (harness_choice.rs). Shown only where there is something to choose (Pi allowed for this provider, or already
 * chosen). The change applies at the next start of the team, and the page says so. With Pi, the sign-in is Pi's
 * own, done in a terminal with `jht oauth-login`; the page shows the command and whether the login is there
 * (a look at the marker, never a read of it). `read` and `set` are for the tests.
 */
export default function HarnessChoice({
  read = readHarnessChoice,
  set = setHarnessChoice,
}: {
  read?: () => Promise<HarnessOutcome>;
  set?: (harness: HarnessName) => Promise<HarnessOutcome>;
}) {
  const t = HARNESS_CHOICE_TEXT[appLocale()];
  const [current, setCurrent] = useState<Choice | null>(null);
  const [selected, setSelected] = useState<HarnessName>("codex");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const result = await read().catch((): HarnessOutcome => ({ ok: false, code: "harness_unavailable" }));
    if (result.ok) {
      setCurrent(result.value);
      setSelected(result.value.harness);
    }
    return result;
  }, [read]);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply() {
    if (pending || !current || selected === current.harness) return;
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await set(selected).catch((): HarnessOutcome => ({ ok: false, code: "harness_set_failed" }));
    if (result.ok && result.value.harness === selected) {
      setCurrent(result.value);
      setSaved(true);
    } else {
      setError(result.ok ? "harness_set_failed" : result.code);
    }
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
  return (
    <div className="flex flex-col gap-2" data-testid="harness-choice">
      <h3 className="text-[12px] font-semibold text-[var(--color-bright)]">{t.title}</h3>
      <p className="text-[12px] text-[var(--color-muted)]">{t.text}</p>
      <div role="radiogroup" aria-label={t.title} className="flex gap-4">
        {options.map(([name, label]) => (
          <label key={name} className="flex items-center gap-1 text-[12px] text-[var(--color-bright)]">
            <input type="radio" name="harness" value={name} checked={selected === name} disabled={pending || (name === "pi" && !current.piAllowed)} onChange={() => { setSelected(name); setSaved(false); }} />
            {label}
            {name === "pi" && <small className="text-[var(--color-muted)]">({t.piNote})</small>}
          </label>
        ))}
        <button type="button" data-testid="harness-apply" className={buttonCls} disabled={pending || selected === current.harness} onClick={() => void apply()}>
          {pending ? t.saving : t.save}
        </button>
      </div>
      {saved && <p className="text-[12px] text-[var(--color-muted)]" role="status" data-testid="harness-saved">{t.saved}</p>}
      {told && (
        <p className="text-[12px] text-[var(--color-red)]" role="alert" data-testid="harness-error">{told.text} {told.action}</p>
      )}
      {current.harness === "pi" && current.login !== "not_needed" && (
        <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-3" data-testid="harness-login" data-login={current.login}>
          <strong className="text-[12px] text-[var(--color-bright)]">{t.loginTitle}</strong>
          <p className="text-[12px] text-[var(--color-muted)]">{current.login === "signed_in" ? t.loginIn : current.login === "signed_out" ? (current.loginFound.length > 0 ? t.loginOther.replace("{names}", current.loginFound.join(", ")) : t.loginOut) : t.loginUnknown}</p>
          {current.login !== "signed_in" && (
            <code className="text-[12px] text-[var(--color-bright)]" data-testid="harness-command">{t.command}</code>
          )}
          <div className="flex gap-2">
            {current.login !== "signed_in" && (
              <button type="button" data-testid="harness-copy" className={buttonCls} onClick={() => void copy()}>{copied ? t.copied : t.copy}</button>
            )}
            <button type="button" data-testid="harness-recheck" className={buttonCls} onClick={() => void load()}>{t.recheck}</button>
          </div>
        </div>
      )}
    </div>
  );
}
