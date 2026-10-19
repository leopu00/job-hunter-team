import { useCallback, useEffect, useRef, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import {
  CONNECTION_STATUS_FIELDS,
  readTeamStatus,
  TEAM_STATUS_FIELDS,
  type ConnectionStatusField,
  type TeamStatusField,
  type TeamStatusReading,
} from "../../lib/existing-team-status";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import { AssistantCard } from "./assistant-card";
import { EXISTING_TEAM_STATUS_TEXT } from "./existing-team-status.i18n";

function stamp(at: number): string {
  return new Date(at).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "medium" });
}

// The order the person reads them in; the two sessions come from the connection.
const ROWS: Array<TeamStatusField | ConnectionStatusField> = [
  "runtimeInstalled",
  "containerRunning",
  "providerConfigured",
  "providerAuthenticated",
  "captainRunning",
  "assistantRunning",
  "profileReady",
  "assistantWelcomed",
];

/**
 * «Squadra» of an existing team that is only read: the state its VPS reports.
 * Six yes-or-no fields are read by the command «Aggiorna» runs again, each with
 * the time of that read; the captain and assistant sessions are not printed by
 * that command, so they show what the connection's own probe said, with the
 * connection's time, and are never rewritten by a refresh. A failed read says
 * why and clears the last good one, and nothing here starts, stops or asks
 * anything of the team.
 */
export default function ExistingTeamStatusPage(_props: PageProps) {
  const t = EXISTING_TEAM_STATUS_TEXT[appLocale()];
  const [reading, setReading] = useState<TeamStatusReading>({ kind: "unknown" });
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const readOnly = useExistingTeamReadOnly();
  const connection = readOnly?.connection ?? null;

  const read = useCallback(async () => {
    const mine = ++latest.current;
    setBusy(true);
    const result = await readTeamStatus();
    // A read that finished after a newer one started, or after leaving the page, is not shown.
    if (latest.current !== mine) return;
    setReading(result);
    setBusy(false);
  }, []);

  useEffect(() => {
    void read();
    return () => {
      latest.current++;
    };
  }, [read]);
  useRefresh(() => void read());

  const failure =
    reading.kind === "error"
      ? describeError(reading.code, { fallback: "existing_team_unavailable", locale: appLocale() })
      : null;

  return (
    <div className="max-w-3xl mx-auto px-5 pt-8 pb-10" style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <h1
          className="text-xl font-bold uppercase tracking-[0.18em] leading-none"
          style={{ color: "var(--color-white)" }}
        >
          {t.title}
        </h1>
        <button
          type="button"
          onClick={() => void read()}
          disabled={busy}
          className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-60 disabled:cursor-wait"
        >
          {busy ? t.refreshing : t.refresh}
        </button>
      </div>
      <p className="text-[11px] mb-5" style={{ color: "var(--color-muted)" }}>
        {t.intro}
      </p>

      {reading.kind === "read" && !reading.fields.containerRunning && (
        <p
          role="status"
          data-testid="team-status-summary"
          className="mb-4 rounded-lg border p-3 text-[12px] font-semibold"
          style={{ borderColor: "var(--color-yellow)", color: "var(--color-yellow)", background: "var(--color-card)" }}
        >
          {t.summaryOff}
        </p>
      )}

      <AssistantCard />

      {reading.kind === "unknown" && (
        <p data-testid="team-status-unknown" className="text-[12px]" style={{ color: "var(--color-muted)" }}>
          {t.unknown}
        </p>
      )}

      {reading.kind === "error" && failure && (
        <div role="alert" data-testid="team-status-error" className="text-[12px]" style={{ color: "var(--color-red)" }}>
          <strong>{t.failed}</strong>
          <p>
            {failure.text} {failure.action} ({reading.code})
          </p>
          <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
            {t.failedAt.replace("{time}", stamp(reading.at))}
          </p>
        </div>
      )}

      {reading.kind === "read" && (
        <section aria-busy={busy} data-testid="team-status-read">
          <p data-testid="team-status-time" className="text-[11px] mb-3" style={{ color: "var(--color-muted)" }}>
            {(busy ? t.staleWhileReading : t.readAt).replace("{time}", stamp(reading.at))}
          </p>
          <ul className="flex flex-col gap-2" style={{ opacity: busy ? 0.55 : 1 }}>
            {ROWS.map((field) => {
              const text = t.fields[field];
              const fromConnection = (CONNECTION_STATUS_FIELDS as readonly string[]).includes(field);
              // A session row is the connection's value, or nothing: never a refresh's «no».
              const known = fromConnection
                ? connection && connection[field as ConnectionStatusField]
                : reading.fields[field as TeamStatusField];
              const hasValue = !fromConnection || connection !== null;
              const on = known === true;
              return (
                <li
                  key={field}
                  data-testid={`team-status-${field}`}
                  data-value={hasValue ? (on ? "yes" : "no") : "unknown"}
                  data-source={fromConnection ? "connection" : "read"}
                  className="rounded-lg border p-3"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold" style={{ color: "var(--color-white)" }}>
                      {text.label}
                    </span>
                    {hasValue && (
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest"
                        style={{ color: on ? "var(--color-green)" : "var(--color-red)" }}
                      >
                        {on ? t.yes : t.no}
                      </span>
                    )}
                  </div>
                  {hasValue && (
                    <p className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
                      {on ? text.yes : text.no}
                    </p>
                  )}
                  {fromConnection && (
                    <p data-testid={`team-status-${field}-source`} className="mt-1 text-[10px]" style={{ color: "var(--color-muted)" }}>
                      {connection
                        ? (connection.source === "assistant_start" ? t.atAssistantStart : t.atConnection).replace("{time}", stamp(connection.at))
                        : t.noConnectionValue}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p data-testid="team-status-actions" className="mt-4 text-[11px]" style={{ color: "var(--color-muted)" }}>
            {(connection?.source === "assistant_start"
              ? t.actionsAfterStart
              : (connection ? connection.assistantRunning : readOnly?.assistantActive)
                ? t.actionsReadOnly
                : t.actionsAssistantOff
            ).replace("{time}", connection ? stamp(connection.at) : "—")}
          </p>
        </section>
      )}
    </div>
  );
}
