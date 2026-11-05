import type { ReactNode } from "react";
import { appLocale } from "../../lib/app-locale";
import { pluralText } from "../../lib/plural";
import { formatRelative } from "@/lib/message-display";
import type { Outcome, PanelHistory, SessionEnd } from "../../lib/agent-control";
import type { AgentsPanelText } from "./AgentsPanel.i18n";
import { roleColor } from "../../lib/role-color";
import { buildGantt, durationText, GANTT_SECONDS, sessionSeconds } from "./history";

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

/** The sessions of the last day as bars, from the start of each to its end: the page of ONE agent (`only`) shows its own.
 *  A session is open all day, so this says when it was up, never whether the agent worked: that is `WorkLanes`. */
export function Lanes({ t, history, roles, nowS, only }: { t: AgentsPanelText; history: Outcome<PanelHistory> | null; roles: string[]; nowS: number; only?: string }) {
  const built = history?.ok ? buildGantt(history.value, roles, nowS) : null;
  const rows = built && only ? built.filter((row) => row.agent === only) : built;
  // The axis: now, and a tick every six hours back to the start of the window, each with the clock time it stands for.
  const ticks = [0, 6, 12, 18, 24].map((hoursAgo) => ({ hoursAgo, at: nowS - hoursAgo * 3600, left: ((24 - hoursAgo) / 24) * 100 }));
  const place = (seconds: number) => ((seconds - (nowS - GANTT_SECONDS)) / GANTT_SECONDS) * 100;
  return (
    <section data-testid="panel-lanes" aria-label={t.sessionsTitle} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
      <h2 className="m-0 text-[14px] font-semibold" style={{ color: "var(--color-white)" }}>
        {t.sessionsTitle}
      </h2>
      <p className="text-[13px] leading-5 mt-1 mb-3 text-[var(--color-muted)]">{t.lanesHelp}</p>
      {history === null && <p className="text-[13px] text-[var(--color-muted)]">{t.historyReading}</p>}
      {history && !history.ok && <p className="text-[13px] text-[var(--color-muted)]">{t.historyUnavailable}</p>}
      {rows && rows.length === 0 && (
        <p data-testid="panel-lanes-empty" className="text-[13px] text-[var(--color-muted)]">
          {t.lanesEmpty}
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="flex items-end">
              <span className="w-[120px] shrink-0" />
              <div className="relative h-5 flex-1 text-[12px] text-[var(--color-muted)]" aria-hidden="true">
                {ticks.map((tick) => (
                  <span
                    key={tick.hoursAgo}
                    className="absolute bottom-0 whitespace-nowrap tabular-nums"
                    style={{ left: `${tick.left}%`, transform: tick.hoursAgo === 24 ? "none" : tick.hoursAgo === 0 ? "translateX(-100%)" : "translateX(-50%)" }}
                  >
                    {tick.hoursAgo === 0 ? t.lanesAxisEnd : shortTime(tick.at)}
                  </span>
                ))}
              </div>
            </div>
            <ul className="m-0 mt-1 p-0 list-none flex flex-col gap-1">
              {rows.map((row) => (
                <li key={row.agent} data-testid={`panel-lane-${row.agent}`} className="flex items-center">
                  <span className="w-[120px] shrink-0 flex items-center gap-2 pr-2 text-[13px] font-semibold text-[var(--color-bright)]">
                    <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: roleColor(row.role) }} />
                    <span className="truncate">{row.agent}</span>
                  </span>
                  <div className="relative h-6 flex-1 rounded bg-[var(--color-row)]">
                    {ticks.map((tick) => (
                      <span key={tick.hoursAgo} aria-hidden="true" className="absolute inset-y-0 w-px bg-[var(--color-border)]" style={{ left: `${tick.left}%` }} />
                    ))}
                    {row.bars.map((bar) => {
                      const when = `${shortTime(bar.start)}–${bar.open ? t.lanesAxisEnd : bar.endKnown ? shortTime(bar.end) : t.lanesEndUnknown}`;
                      const length = bar.endKnown ? ` · ${durationText(Math.max(0, bar.end - bar.start), { day: t.unitDay, hour: t.unitHour, min: t.unitMin })}` : "";
                      const label = `${row.agent} · ${when}${length}`;
                      return (
                        <div
                          key={`${bar.start}-${bar.end}`}
                          role="img"
                          aria-label={label}
                          title={label}
                          data-testid={`panel-bar-${row.agent}`}
                          data-known={bar.endKnown ? "true" : "false"}
                          className="absolute top-1 h-4 rounded-sm"
                          style={{
                            left: `${place(bar.start)}%`,
                            width: bar.endKnown ? `max(4px, ${place(bar.end) - place(bar.start)}%)` : "4px",
                            background: roleColor(row.role),
                            opacity: bar.endKnown ? 1 : 0.55,
                            boxShadow: bar.open ? "0 0 0 2px var(--color-card)" : undefined,
                          }}
                        />
                      );
                    })}
                    <span aria-hidden="true" className="absolute inset-y-0 right-0 w-[2px] bg-[var(--color-white)]" />
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
