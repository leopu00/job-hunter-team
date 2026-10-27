import { useState } from "react";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { stateText } from "../lib/onboarding-state.i18n";
import { resumeOnboardingTeamStart } from "../lib/onboarding-runtime";
import { TEAM_OFF_TEXT } from "./team-off.i18n";

/**
 * «Start the team» where a page says the team of this computer is stopped (the chat's bar, the Agents page):
 * the same start the setup's resume runs (it wakes the runtime first, and starts only the sessions that are
 * missing). `onStarted` runs when the team is up, so the page reads again; a refusal is told with the
 * catalog's own sentence, never the raw code.
 */
export function StartTeamAction({ onStarted }: { onStarted: () => void }) {
  const locale = appLocale();
  const [state, setState] = useState<{ phase: "idle" | "starting" } | { phase: "failed"; code: string }>({ phase: "idle" });
  async function start() {
    setState({ phase: "starting" });
    try {
      await resumeOnboardingTeamStart(() => undefined);
    } catch (error) {
      setState({ phase: "failed", code: (error as { code?: string })?.code ?? (typeof error === "string" ? error : "team_start_failed") });
      return;
    }
    setState({ phase: "idle" });
    onStarted();
  }
  const failure = state.phase === "failed" ? describeError(state.code, { locale, fallback: "team_start_failed" }) : null;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="start-team-action">
      {state.phase === "starting" && <span className="text-[var(--color-muted)]">{stateText().startingContainerAndAgents}</span>}
      {failure && <span role="alert" data-testid="start-team-failed">{failure.text} {failure.action}</span>}
      <button
        type="button"
        data-testid="start-team"
        disabled={state.phase === "starting"}
        onClick={() => void start()}
        className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[12px] font-semibold text-[var(--color-bright)] hover:border-[var(--color-border-glow)] disabled:opacity-50"
      >
        {TEAM_OFF_TEXT[locale].start}
      </button>
    </span>
  );
}
