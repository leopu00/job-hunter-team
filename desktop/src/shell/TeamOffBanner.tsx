import { useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { useTeamOff } from "../lib/team-off";
import { TEAM_OFF_TEXT } from "./team-off.i18n";

/**
 * The fixed warning while the app is open without the team: which pages need it, and the two ways on.
 * «Turn the runtime on» only wakes the machine and the container (the halt gate is down first, so no agent
 * starts); «Start the team» goes back to the setup's start screen. Nothing shows in the usual app.
 */
export function TeamOffBanner({ locale: localeOverride }: { locale?: Locale }) {
  const teamOff = useTeamOff();
  const locale = localeOverride ?? appLocale();
  const [state, setState] = useState<{ phase: "idle" | "waking" | "woke" } | { phase: "failed"; code: string }>({ phase: "idle" });
  if (!teamOff) return null;
  const t = TEAM_OFF_TEXT[locale];
  async function wake() {
    setState({ phase: "waking" });
    try {
      await teamOff!.wakeRuntime();
      setState({ phase: "woke" });
    } catch (error) {
      setState({ phase: "failed", code: (error as { code?: string })?.code ?? (typeof error === "string" ? error : "runtime_wake_failed") });
    }
  }
  const failure = state.phase === "failed" ? describeError(state.code, { locale }) : null;
  return (
    <div
      role="status"
      data-testid="team-off-banner"
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <strong>{t.title}</strong>
      <span className="text-[var(--color-muted)]">{t.note}</span>
      {state.phase === "woke" && <span data-testid="team-off-woke" className="text-[var(--color-muted)]">{t.woke}</span>}
      {failure && <span role="alert" data-testid="team-off-wake-failed">{failure.text} {failure.action}</span>}
      <button
        type="button"
        data-testid="team-off-wake"
        disabled={state.phase === "waking"}
        onClick={() => void wake()}
        className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-border-glow)] disabled:opacity-60"
      >
        {state.phase === "waking" ? t.waking : t.wake}
      </button>
      {teamOff.startTeam && (
        <button
          type="button"
          data-testid="team-off-start"
          onClick={() => teamOff.startTeam?.()}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-border-glow)]"
        >
          {t.start}
        </button>
      )}
    </div>
  );
}
