import { useCallback, useEffect, useRef, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import {
  readTeamStatus,
  TEAM_STATUS_FIELDS,
  type TeamStatusReading,
} from "../../lib/existing-team-status";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import { EXISTING_TEAM_STATUS_TEXT } from "./existing-team-status.i18n";

function stamp(at: number): string {
  return new Date(at).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "medium" });
}

/**
 * «Squadra» of an existing team that is only read: the state its VPS reports,
 * eight yes-or-no fields from the probe the connection already runs, each with
 * what it means for the person. «Aggiorna» reads it again through the same
 * read-only command; a reading carries the time it was made, a failed one says
 * why and clears the last good one, and nothing here starts, stops or asks
 * anything of the team.
 */
export default function ExistingTeamStatusPage(_props: PageProps) {
  const t = EXISTING_TEAM_STATUS_TEXT[appLocale()];
  const [reading, setReading] = useState<TeamStatusReading>({ kind: "unknown" });
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

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
            {TEAM_STATUS_FIELDS.map((field) => {
              const on = reading.fields[field];
              const text = t.fields[field];
              return (
                <li
                  key={field}
                  data-testid={`team-status-${field}`}
                  data-value={on ? "yes" : "no"}
                  className="rounded-lg border p-3"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold" style={{ color: "var(--color-white)" }}>
                      {text.label}
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: on ? "var(--color-green)" : "var(--color-red)" }}
                    >
                      {on ? t.yes : t.no}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
                    {on ? text.yes : text.no}
                  </p>
                </li>
              );
            })}
          </ul>
          <p data-testid="team-status-actions" className="mt-4 text-[11px]" style={{ color: "var(--color-muted)" }}>
            {reading.fields.assistantRunning ? t.actionsReadOnly : t.actionsAssistantOff}
          </p>
        </section>
      )}
    </div>
  );
}
