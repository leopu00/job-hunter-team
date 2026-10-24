import { useEffect, useRef, useState } from "react";
import { localeLabels, locales, type Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { fill } from "../lib/text-slots";
import {
  readTeamLanguage,
  rememberTeamLanguageAsked,
  setTeamLanguage,
  shouldAskTeamLanguage,
  teamLanguageAsked,
} from "../lib/team-language";
import { TEAM_LANGUAGE_TEXT } from "./TeamLanguagePrompt.i18n";

/** The team may not be answering yet (the chat's link is still opening): look again this often, this many times. */
const RETRY_MS = 3000;
const ATTEMPTS = 8;

/**
 * Asks once, «Team language: Italiano?», when the team a person has just linked (or just had prepared) still
 * speaks the English every team starts with and the app does not: the agents would answer in English to
 * someone who writes in Italian. The app's language is the one preselected. The answer is written to the team
 * the way the game's language setting writes it, and only over that English: a language already chosen is
 * never replaced. Either answer is remembered for this account, so the question is not asked again.
 */
export default function TeamLanguagePrompt({
  identityKey,
  retryMs = RETRY_MS,
}: {
  identityKey: string;
  retryMs?: number;
}) {
  const [asking, setAsking] = useState<Locale | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (teamLanguageAsked(identityKey)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async (attempt: number) => {
      const team = await readTeamLanguage();
      if (cancelled) return;
      if (team) {
        if (shouldAskTeamLanguage(team, appLocale())) setAsking(appLocale());
        return;
      }
      if (attempt + 1 < ATTEMPTS) timer = setTimeout(() => void look(attempt + 1), retryMs);
    };
    void look(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [identityKey, retryMs]);

  useEffect(() => {
    if (asking) selectRef.current?.focus();
  }, [asking]);

  if (!asking) return null;
  const t = TEAM_LANGUAGE_TEXT[appLocale()];

  const close = () => {
    rememberTeamLanguageAsked(identityKey);
    setAsking(null);
  };
  const confirm = async () => {
    if (asking === "en") return close();
    setBusy(true);
    setFailure(null);
    const done = await setTeamLanguage(asking);
    setBusy(false);
    if (done.ok) return close();
    const copy = describeError(done.code, { fallback: "unknown", locale: appLocale() });
    setFailure(`${copy.text} ${copy.action}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" data-testid="team-language-prompt">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-language-title"
        aria-describedby="team-language-body"
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-5 flex flex-col gap-3"
      >
        <h2 id="team-language-title" className="text-[14px] font-semibold text-[var(--color-bright)]">
          {fill(t.title, { language: localeLabels[asking].label })}
        </h2>
        <p id="team-language-body" className="text-[12px] text-[var(--color-muted)]">{t.body}</p>
        <select
          ref={selectRef}
          aria-label={t.selectLabel}
          value={asking}
          disabled={busy}
          onChange={(event) => setAsking(event.target.value as Locale)}
          className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--color-bright)]"
        >
          {locales.map((code) => (
            <option key={code} value={code}>{localeLabels[code].label}</option>
          ))}
        </select>
        {failure && (
          <p role="alert" data-testid="team-language-failure" className="text-[11px] text-[var(--color-red)]">{failure}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="team-language-keep"
            onClick={close}
            disabled={busy}
            className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
          >
            {t.keepEnglish}
          </button>
          <button
            type="button"
            data-testid="team-language-confirm"
            onClick={() => void confirm()}
            disabled={busy}
            className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border disabled:opacity-60 disabled:cursor-wait"
            style={{ color: "var(--color-green)", borderColor: "var(--color-green)" }}
          >
            {busy ? t.working : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
