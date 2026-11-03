import { useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { readTeamState, type Outcome, type TeamControlState } from "../../lib/agent-control";
import { matchRoute, navigate } from "../../shell/router";
import { ROUTES } from "../../shell/routes";
import { BurstStrip } from "../work-hours/BurstControl";
import { ACCOUNT_TEXT } from "./account.i18n";
import { SECTIONS_TEXT } from "./settings-sections.i18n";

const linkCls = "text-left rounded border border-[var(--color-border)] px-4 py-3 hover:border-[var(--color-border-glow)]";

/**
 * The team's state in one line and the two ways to what the person asks for in Settings: the agents' panel
 * (start, pause, stop: those commands live there and keep their confirmations) and the hours, where the
 * weekly budget is set (not shown on a team that is only read: it writes to the team). «Work flat out until a
 * time» is here too, under the budget: it is the team's pace and budget, where people look for it (it was
 * only on the hours page and in the agents' panel, and was not found). The weekly budget has a page of its own
 * (/budget, in the navbar); the hours are in the section under this card.
 */
export default function TeamCard({ readOnly, read = readTeamState }: { readOnly: boolean; read?: () => Promise<Outcome<TeamControlState>> }) {
  const t = ACCOUNT_TEXT[appLocale()];
  const sections = SECTIONS_TEXT[appLocale()];
  const [state, setState] = useState<"running" | "stopped" | "paused" | "unknown" | null>(null);
  useEffect(() => {
    let live = true;
    read()
      .then((result) => {
        if (!live) return;
        if (!result.ok) return setState("unknown");
        setState(result.value.halted ? "stopped" : result.value.standby.state === "active" ? "paused" : "running");
      })
      .catch(() => live && setState("unknown"));
    return () => {
      live = false;
    };
  }, [read]);
  const line = state === null ? "" : { running: t.stateRunning, stopped: t.stateStopped, paused: t.statePaused, unknown: t.stateUnknown }[state];
  return (
    <section data-testid="settings-team" aria-labelledby="settings-team-title" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2">
      <h2 id="settings-team-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.teamTitle}</h2>
      <p className="text-[12px] text-[var(--color-muted)]" data-testid="settings-team-state">{line}</p>
      <button type="button" data-testid="settings-agents-link" onClick={() => navigate("/agents")} className={linkCls}>
        <span className="block text-[13px] font-semibold text-[var(--color-bright)]">{t.agentsLink}</span>
        <span className="mt-1 block text-[11px] text-[var(--color-muted)]">{t.agentsNote}</span>
      </button>
      {/* the budget has its page and its place in the navbar; here only the way to it, once that page is in the routes */}
      {!readOnly && matchRoute(ROUTES, "/budget") && (
        <button type="button" data-testid="settings-budget-link" onClick={() => navigate("/budget")} className={linkCls}>
          <span className="block text-[13px] font-semibold text-[var(--color-bright)]">{sections.budgetLink}</span>
          <span className="mt-1 block text-[11px] text-[var(--color-muted)]">{sections.budgetNote}</span>
        </button>
      )}
      {!readOnly && <BurstStrip />}
    </section>
  );
}
