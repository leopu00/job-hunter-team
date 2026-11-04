import { appLocale } from "../../lib/app-locale";
import { ACTIVITY_WINDOWS, type ActivityWindow, type Outcome, type PanelActivity } from "../../lib/agent-control";
import { roleColor } from "../../lib/role-color";
import type { AgentsPanelText } from "./AgentsPanel.i18n";
import { roleOfSession } from "./history";

/**
 * What each agent WORKED on, in a window of the person's choice (JHT-T171). A row per agent, a cell per bucket of the
 * window: a coloured cell is a stretch in which the agent wrote tokens (or is at work right now, for the last one), and the
 * stronger the colour the more it wrote. It is NOT the time a session stayed open: a session is open all day, and a
 * bar drawn from it is always full. On the right: the agent's total and hourly average of the window. Every figure
 * is the one answer of the activity read (lib/agent-control), the same for every view.
 */

export const WORK_WINDOW_KEY = "jht-agents-work-window";
const DEFAULT_WINDOW: ActivityWindow = "24h";

export function readWorkWindow(): ActivityWindow {
  try {
    const stored = window.localStorage.getItem(WORK_WINDOW_KEY);
    return (ACTIVITY_WINDOWS as readonly string[]).includes(stored ?? "") ? (stored as ActivityWindow) : DEFAULT_WINDOW;
  } catch {
    return DEFAULT_WINDOW;
  }
}

export function rememberWorkWindow(value: ActivityWindow): void {
  try {
    window.localStorage.setItem(WORK_WINDOW_KEY, value);
  } catch {
    // a browser that does not keep it: the window is the default at the next opening
  }
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

const windowLabel = (t: AgentsPanelText, value: ActivityWindow): string =>
  ({ "5m": t.window5m, "15m": t.window15m, "1h": t.window1h, "5h": t.window5h, "24h": t.window24h, "7d": t.window7d })[value];

/** The clock for a short window, the day for the long one (a 3-hour cell of a week has no use for the minutes). */
function stamp(seconds: number, window: ActivityWindow): string {
  const at = new Date(seconds * 1000);
  const clock = at.toLocaleTimeString(appLocale(), { hour: "2-digit", minute: "2-digit", ...(window === "5m" ? { second: "2-digit" as const } : {}) });
  return window === "7d" ? `${at.toLocaleDateString(appLocale(), { day: "2-digit", month: "2-digit" })} ${clock}` : clock;
}

function axisStamp(seconds: number, window: ActivityWindow): string {
  const at = new Date(seconds * 1000);
  return window === "7d"
    ? at.toLocaleDateString(appLocale(), { day: "2-digit", month: "2-digit" })
    : at.toLocaleTimeString(appLocale(), { hour: "2-digit", minute: "2-digit" });
}

function kt(value: number): string {
  return value.toLocaleString(appLocale(), { maximumFractionDigits: value < 10 ? 1 : 0 });
}

export function WorkLanes({
  t,
  activity,
  window,
  onWindow,
}: {
  t: AgentsPanelText;
  /** null while it is being read */
  activity: Outcome<PanelActivity> | null;
  window: ActivityWindow;
  onWindow: (value: ActivityWindow) => void;
}) {
  // An answer of another window than the one chosen is the one before the choice: «reading» until the right one is in.
  const data = activity?.ok && activity.value.window === window ? activity.value : null;
  const strongest = data ? Math.max(0, ...data.agents.flatMap((agent) => agent.kt)) : 0;
  const working = data ? data.agents.filter((agent) => agent.workedBuckets > 0).length : 0;
  const total = data ? data.agents.reduce((sum, agent) => sum + agent.totalKt, 0) : 0;
  const ticks = [0, 25, 50, 75, 100];
  return (
    <section data-testid="panel-work" aria-label={t.workTitle} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
      <h2 className="m-0 text-[14px] font-semibold" style={{ color: "var(--color-white)" }}>
        {t.workTitle}
      </h2>
      <p className="text-[13px] leading-5 mt-1 mb-3 text-[var(--color-muted)]">{t.workHelp}</p>
      <div role="group" aria-label={t.workWindowLabel} className="flex flex-wrap gap-2 mb-3">
        {ACTIVITY_WINDOWS.map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`work-window-${value}`}
            aria-pressed={window === value}
            onClick={() => onWindow(value)}
            className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border"
            style={{
              borderColor: window === value ? "var(--color-white)" : "var(--color-border)",
              color: window === value ? "var(--color-white)" : "var(--color-muted)",
            }}
          >
            {windowLabel(t, value)}
          </button>
        ))}
      </div>

      {activity === null || (activity.ok && !data) ? <p className="text-[13px] text-[var(--color-muted)]">{t.workReading}</p> : null}
      {activity && !activity.ok && (
        <p data-testid="work-unavailable" className="text-[13px] text-[var(--color-muted)]">
          {t.workUnavailable}
        </p>
      )}
      {data && data.agents.length === 0 && (
        <p data-testid="work-empty" className="text-[13px] text-[var(--color-muted)]">
          {t.workEmpty}
        </p>
      )}
      {data && data.agents.length > 0 && (
        <>
          <p data-testid="work-summary" className="m-0 mb-2 text-[13px] text-[var(--color-base)]">
            {fill(t.workSummary, { working, total: data.agents.length, kt: kt(total) })}
          </p>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="flex items-end">
                <span className="w-[148px] shrink-0" />
                <div className="relative h-5 flex-1 text-[12px] text-[var(--color-muted)]" aria-hidden="true">
                  {ticks.map((tick) => (
                    <span
                      key={tick}
                      className="absolute bottom-0 whitespace-nowrap tabular-nums"
                      style={{ left: `${tick}%`, transform: tick === 0 ? "none" : tick === 100 ? "translateX(-100%)" : "translateX(-50%)" }}
                    >
                      {tick === 100 ? t.lanesAxisEnd : axisStamp(data.since + (data.end - data.since) * (tick / 100), window)}
                    </span>
                  ))}
                </div>
                <span className="w-[190px] shrink-0 flex justify-end gap-3 pl-3 text-[11px] uppercase tracking-widest text-[var(--color-muted)]" aria-hidden="true">
                  <span className="w-[84px] text-right">{t.workColTotal}</span>
                  <span className="w-[84px] text-right">{t.workColAvg}</span>
                </span>
              </div>
              <ul className="m-0 mt-1 p-0 list-none flex flex-col gap-1">
                {data.agents.map((agent) => {
                  const color = roleColor(roleOfSession(agent.name));
                  return (
                    <li key={agent.name} data-testid={`work-lane-${agent.name}`} className="flex items-center">
                      <span className="w-[148px] shrink-0 flex items-center gap-2 pr-2 text-[13px] font-semibold text-[var(--color-bright)]">
                        <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />
                        <span className="truncate" title={agent.state === "lavora" ? t.workNowWorking : undefined}>{agent.name}</span>
                        {agent.state === "lavora" && (
                          <span data-testid={`work-now-${agent.name}`} role="img" aria-label={t.workNowWorking} title={t.workNowWorking} className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--color-green)" }} />
                        )}
                      </span>
                      <div
                        className="flex h-6 flex-1 overflow-hidden rounded bg-[var(--color-row)]"
                        role="img"
                        aria-label={agent.workedBuckets === 0 ? `${agent.name} · ${t.workNoWork}` : `${agent.name} · ${kt(agent.totalKt)} kT`}
                      >
                        {agent.work.map((mark, index) => {
                          const from = data.since + index * data.bucketS;
                          const tokens = agent.kt[index];
                          return (
                            <span
                              key={index}
                              data-work={mark}
                              title={mark ? fill(t.workCellLabel, { agent: agent.name, from: stamp(from, window), to: stamp(from + data.bucketS, window), kt: kt(tokens) }) : undefined}
                              className="h-full"
                              style={{
                                flex: "1 1 0",
                                // a stretch with tokens: 0.45 to 1 by how much; at work now with no token yet: half
                                background: mark ? color : "transparent",
                                opacity: mark ? (tokens > 0 && strongest > 0 ? 0.45 + 0.55 * (tokens / strongest) : 0.5) : 1,
                                borderRight: index < agent.work.length - 1 ? "1px solid var(--color-card)" : undefined,
                              }}
                            />
                          );
                        })}
                      </div>
                      <span className="w-[190px] shrink-0 flex justify-end gap-3 pl-3 text-[13px] tabular-nums text-[var(--color-bright)]">
                        <span data-testid={`work-total-${agent.name}`} className="w-[84px] text-right">{kt(agent.totalKt)} kT</span>
                        <span data-testid={`work-avg-${agent.name}`} className="w-[84px] text-right text-[var(--color-muted)]">{kt(agent.avgKtH)} kT/h</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
