import { useEffect, useId, useState } from "react";
import { localeLabels, locales, type Locale } from "@/i18n/config";
import { TEAM_LANGUAGE_TEXT } from "../../components/TeamLanguagePrompt.i18n";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { readTeamLanguage, setTeamLanguage } from "../../lib/team-language";

const cardCls = "rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2";
const smallButtonCls =
  "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-50 disabled:cursor-not-allowed";

/** The chat's link may still be opening when Settings opens: look again this often, this many times. */
const RETRY_MS = 3000;
const ATTEMPTS = 5;

/**
 * Settings › Team: the language the agents speak, changed at any time. It writes the team's own language file
 * (the one the question after the app's language writes too), and nothing else: no setup, no restart of the
 * team. Shown once the team answers; a team that cannot be reached shows nothing here.
 */
export default function TeamLanguageCard({ retryMs = RETRY_MS }: { retryMs?: number }) {
  const t = TEAM_LANGUAGE_TEXT[appLocale()];
  const selectId = useId();
  const [team, setTeam] = useState<Locale | null>(null);
  const [choice, setChoice] = useState<Locale | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async (attempt: number) => {
      const read = await readTeamLanguage();
      if (cancelled) return;
      if (read) {
        setTeam(read.locale);
        setChoice(read.locale);
        return;
      }
      if (attempt + 1 < ATTEMPTS) timer = setTimeout(() => void look(attempt + 1), retryMs);
    };
    void look(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [retryMs]);

  if (!team || !choice) return null;

  const save = async () => {
    if (busy || choice === team) return;
    setBusy(true);
    setSaved(false);
    setFailure(null);
    const done = await setTeamLanguage(choice, { choose: true });
    setBusy(false);
    if (done.ok) {
      setTeam(done.language.locale);
      setChoice(done.language.locale);
      setSaved(true);
      return;
    }
    const copy = describeError(done.code, { fallback: "unknown", locale: appLocale() });
    setFailure(`${copy.text} ${copy.action}`);
  };

  return (
    <section data-testid="settings-team-language" aria-labelledby="settings-team-language-title" className={cardCls}>
      <h2 id="settings-team-language-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.cardTitle}</h2>
      <p className="text-[12px] text-[var(--color-muted)]">{t.cardText}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={selectId}
          aria-label={t.selectLabel}
          value={choice}
          disabled={busy}
          onChange={(event) => {
            setChoice(event.target.value as Locale);
            setSaved(false);
            setFailure(null);
          }}
          className="m-0 w-auto min-w-[10rem] rounded border border-[var(--color-border)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--color-bright)]"
        >
          {locales.map((code) => (
            <option key={code} value={code}>{localeLabels[code].label}</option>
          ))}
        </select>
        <button
          type="button"
          data-testid="settings-team-language-save"
          onClick={() => void save()}
          disabled={busy || choice === team}
          className={smallButtonCls}
        >
          {busy ? t.working : t.cardSave}
        </button>
      </div>
      <p role="status" data-testid="settings-team-language-saved" className="m-0 text-[11px] text-[var(--color-green)]">
        {saved ? t.cardSaved : ""}
      </p>
      {failure && (
        <p role="alert" data-testid="settings-team-language-failure" className="m-0 text-[11px] text-[var(--color-red)]">{failure}</p>
      )}
    </section>
  );
}
