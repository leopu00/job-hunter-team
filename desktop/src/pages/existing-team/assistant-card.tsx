import { useRef, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { startExistingTeamAssistant, type AssistantStartOutcome } from "../../lib/existing-team-assistant";
import { enterExistingTeamReadOnly, useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { EXISTING_TEAM_ASSISTANT_TEXT } from "./existing-team-assistant.i18n";
import { linkAllowsActions, useVpsLink } from "../../lib/vps-link";
import { VPS_LINK_TEXT } from "../../lib/vps-link.i18n";

function stamp(at: number): string {
  return new Date(at).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "medium" });
}

type Phase = "idle" | "confirming" | "starting";

/**
 * «Attiva assistente»: the one action of this view that changes the team, so it is the one with a
 * confirmation that says what it costs first. Nothing here runs by itself: the button only opens
 * the confirmation, and only «Conferma e avvia» calls the native command, once at a time. The
 * result is shown by kind (started and checked, already running, timed out, failed with its
 * code); only the first two change what the pages know, and only with the probe the command made.
 */
export function AssistantCard() {
  const t = EXISTING_TEAM_ASSISTANT_TEXT[appLocale()];
  const readOnly = useExistingTeamReadOnly();
  const connection = readOnly?.connection ?? null;
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<AssistantStartOutcome | null>(null);
  const inFlight = useRef(false);
  // A change to the team never leaves on an uncertain link: only on a recent working read.
  const link = useVpsLink();
  const linked = linkAllowsActions(link, Date.now());

  const running = connection ? connection.assistantRunning : readOnly?.assistantActive === true;
  const when = connection
    ? (connection.source === "assistant_start" ? t.whenStart : t.whenConnection).replace("{time}", stamp(connection.at))
    : null;

  async function confirm() {
    if (inFlight.current || !linked) return;
    inFlight.current = true;
    setPhase("starting");
    setOutcome(null);
    const result = await startExistingTeamAssistant();
    inFlight.current = false;
    if (result.kind === "started" || result.kind === "already_active") {
      // the probe the command just made is the new value, with its own time
      enterExistingTeamReadOnly(true, {
        at: result.at,
        captainRunning: result.captainRunning,
        assistantRunning: true,
        source: "assistant_start",
      });
    }
    setOutcome(result);
    setPhase("idle");
  }

  const failure = outcome && (outcome.kind === "error" || outcome.kind === "timeout")
    ? describeError(outcome.code, { fallback: "existing_team_unavailable", locale: appLocale() })
    : null;

  return (
    <section
      data-testid="assistant-card"
      className="rounded-lg border p-3 mb-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold" style={{ color: "var(--color-white)" }}>
          {t.title}
        </span>
        {!running && phase === "idle" && (
          <button
            type="button"
            data-testid="assistant-activate"
            disabled={!linked}
            title={linked ? undefined : VPS_LINK_TEXT[appLocale()].actionsWait}
            onClick={() => setPhase("confirming")}
            className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t.activate}
          </button>
        )}
      </div>
      <p data-testid="assistant-status" data-running={running ? "yes" : "no"} className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
        {when === null ? t.unknown : (running ? t.active : t.inactive).replace("{when}", when)}
      </p>

      {!running && !linked && (
        <p data-testid="assistant-link-wait" className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
          {VPS_LINK_TEXT[appLocale()].actionsWait}
        </p>
      )}

      {phase !== "idle" && (
        <div role="dialog" aria-label={t.confirmTitle} data-testid="assistant-confirm-panel" className="mt-3 text-[11px]" style={{ color: "var(--color-muted)" }}>
          <p className="font-semibold" style={{ color: "var(--color-white)" }}>{t.confirmTitle}</p>
          <p data-testid="assistant-effects" className="mt-1">{t.effects}</p>
          <p data-testid="assistant-no-stop" className="mt-1">{t.noStop}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="assistant-confirm"
              disabled={phase === "starting" || !linked}
              onClick={() => void confirm()}
              className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-bright)] disabled:opacity-60 disabled:cursor-wait"
            >
              {phase === "starting" ? t.starting : t.confirm}
            </button>
            <button
              type="button"
              data-testid="assistant-cancel"
              disabled={phase === "starting"}
              onClick={() => setPhase("idle")}
              className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] disabled:opacity-60"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {outcome && (
        <p
          data-testid="assistant-outcome"
          data-kind={outcome.kind}
          role={outcome.kind === "started" || outcome.kind === "already_active" ? "status" : "alert"}
          className="mt-2 text-[11px]"
          style={{ color: outcome.kind === "started" || outcome.kind === "already_active" ? "var(--color-green)" : "var(--color-red)" }}
        >
          {outcome.kind === "started" && t.started.replace("{time}", stamp(outcome.at))}
          {outcome.kind === "already_active" && t.alreadyActive.replace("{time}", stamp(outcome.at))}
          {outcome.kind === "timeout" && t.timedOut.replace("{code}", outcome.code)}
          {outcome.kind === "error" && t.failed.replace("{code}", outcome.code)}
          {failure ? ` ${failure.text} ${failure.action}` : ""}
        </p>
      )}
    </section>
  );
}
