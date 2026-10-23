import type { ReactNode } from "react";
import { appLocale } from "../../lib/app-locale";
import { pluralText } from "../../lib/plural";
import { formatRelative } from "@/lib/message-display";
import type { Outcome, PanelHistory, SessionEnd } from "../../lib/agent-control";
import type { AgentsPanelText } from "./AgentsPanel.i18n";
import { buildLanes, durationText, sessionSeconds } from "./history";

// The previous sessions of an agent and the lanes of the last day (JHT-T43). Both read the team's own files through
// the panel's history read; a part the team does not say is shown as not known, never as zero or as nothing.

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

function fullStamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "medium" });
}

function shortTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString(appLocale(), { hour: "2-digit", minute: "2-digit" });
}

function reasonText(t: AgentsPanelText, reason: SessionEnd): string {
  return {
    running: t.historyRunning,
    restarted_by_user: t.historyRestarted,
    stopped_by_user: t.historyStopped,
    contained: t.historyContained,
    retired: t.historyRetired,
    started_again: t.historyStartedAgain,
    unknown: t.historyUnknown,
  }[reason];
}

/** «Sessioni precedenti» in the detail of one agent. `history` is null while it is being read. */
export function SessionHistory({ t, history, session, nowS }: { t: AgentsPanelText; history: Outcome<PanelHistory> | null; session: string; nowS: number }) {
  const units = { day: t.unitDay, hour: t.unitHour, min: t.unitMin };
  let body: ReactNode;
  if (history === null) {
    body = <p className="text-[11px] text-[var(--color-muted)]">{t.historyReading}</p>;
  } else if (!history.ok) {
    body = (
      <p data-testid="panel-history-unavailable" className="text-[11px] text-[var(--color-muted)]">
        {t.historyUnavailable}
      </p>
    );
  } else {
    const mine = history.value.agents[session];
    const sessions = mine?.sessions ?? [];
    body = (
      <>
        {sessions.length === 0 ? (
          <p className="text-[11px] text-[var(--color-muted)]">{t.historyEmpty}</p>
        ) : (
          <ul data-testid="panel-history-list" className="flex flex-col gap-0.5">
            {sessions.map((past) => {
              const length = sessionSeconds(past, nowS);
              return (
                <li key={past.start} className="text-[11px] flex flex-wrap gap-x-2 text-[var(--color-muted)]">
                  <span title={fullStamp(past.start)} style={{ color: "var(--color-bright)" }}>
                    {formatRelative(new Date(past.start * 1000).toISOString(), appLocale())}
                  </span>
                  <span>{length === null ? "—" : durationText(length, units)}</span>
                  <span data-reason={past.reason} title={past.end === null ? undefined : fullStamp(past.end)}>
                    {reasonText(t, past.reason)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {mine && mine.failed.length > 0 && (
          <p className="text-[11px] mt-1 text-[var(--color-muted)]" title={mine.failed.map(fullStamp).join("\n")}>
            {pluralText(appLocale(), mine.failed.length, t.historyFailed)}
          </p>
        )}
        {history.value.since !== null && (
          <p className="text-[11px] mt-1 text-[var(--color-dim)]">{fill(t.historySince, { time: fullStamp(history.value.since) })}</p>
        )}
      </>
    );
  }
  return (
    <section data-testid="panel-history" aria-label={t.historyTitle} className="mt-3">
      {/* Closed until asked for: a long list of sessions must not push the chat out of the page. */}
      <details data-testid="panel-history-details">
        <summary
          className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--color-bright)" }}
        >
          {t.historyTitle}
        </summary>
        <div className="mt-1">{body}</div>
      </details>
    </section>
  );
}

/** One lane per department, an hour per box, for the last day. */
export function Lanes({ t, history, roles, nowS }: { t: AgentsPanelText; history: Outcome<PanelHistory> | null; roles: string[]; nowS: number }) {
  const lanes = history?.ok ? buildLanes(history.value, roles, nowS) : null;
  const most = Math.max(1, ...(lanes ?? []).flatMap((lane) => lane.cells.map((cell) => cell.moves)));
  return (
    <section data-testid="panel-lanes" aria-label={t.lanesTitle} className="rounded border p-3" style={{ borderColor: "var(--color-border)" }}>
      <h2 className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-bright)" }}>
        {t.lanesTitle}
      </h2>
      <p className="text-[11px] mt-1 mb-2 text-[var(--color-muted)]">{t.lanesHelp}</p>
      {history === null && <p className="text-[11px] text-[var(--color-muted)]">{t.historyReading}</p>}
      {history && !history.ok && <p className="text-[11px] text-[var(--color-muted)]">{t.historyUnavailable}</p>}
      {history?.ok && lanes === null && (
        <p data-testid="panel-lanes-unknown" className="text-[11px] text-[var(--color-muted)]">
          {t.lanesUnknown}
        </p>
      )}
      {lanes && (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="flex items-center text-[11px] text-[var(--color-dim)]">
              <span className="w-[96px] shrink-0" />
              <span className="flex-1">{t.lanesAxisStart}</span>
              <span>{t.lanesAxisEnd}</span>
            </div>
            <ul className="flex flex-col gap-1">
              {lanes.map((lane) => (
                <li key={lane.role} data-testid={`panel-lane-${lane.role}`} className="flex items-stretch">
                  <span className="w-[96px] shrink-0 text-[11px] font-semibold uppercase tracking-wider self-center" style={{ color: "var(--color-bright)" }}>
                    {lane.role}
                  </span>
                  <div className="flex-1 grid gap-px" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                    {lane.cells.map((cell) => (
                      <div
                        key={cell.from}
                        data-moves={cell.moves}
                        data-up={cell.up ? "true" : "false"}
                        title={`${pluralText(appLocale(), cell.moves, t.lanesMoves)} · ${shortTime(cell.from)}–${shortTime(cell.to)} · ${cell.up ? t.lanesUp : t.lanesDown}`}
                      >
                        <div
                          className="text-[11px] text-center leading-5 rounded-sm"
                          style={{
                            background: cell.moves > 0 ? `color-mix(in srgb, var(--color-green) ${Math.round(15 + (70 * cell.moves) / most)}%, transparent)` : "var(--color-row)",
                            color: cell.moves > 0 ? "var(--color-white)" : "var(--color-dim)",
                          }}
                        >
                          {cell.moves > 0 ? cell.moves : "·"}
                        </div>
                        <div className="h-[3px] mt-px rounded-sm" style={{ background: cell.up ? "var(--color-blue)" : "transparent" }} />
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
