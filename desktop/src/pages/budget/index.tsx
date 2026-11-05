import { useCallback, useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { readTeamState, type TeamControlState } from "../../lib/agent-control";
import UpdateTeamHelp from "../../components/UpdateTeamHelp";
import { reconnectDirectChat } from "../../lib/direct-chat";
import { describeError, errorCodeOf } from "../../lib/error-catalog";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { ROLE_COLOR } from "../../lib/role-color";
import { readTeamBudget, type BudgetResult, type TeamBudget } from "../../lib/team-budget-native";
import { fill } from "../../lib/text-slots";
import { navigate } from "../../shell/router";
import type { PageProps } from "../types";
import { BurstStrip } from "../work-hours/BurstControl";
import { BUDGET_TEXT, type BudgetText } from "./budget.i18n";

/** How often the page reads again while it is open: the team samples its usage every few minutes. */
export const REFRESH_MS = 60_000;
/** A reading older than this many minutes is called old (the same threshold the team uses for the per-role data). */
export const STALE_AFTER_MIN = 15;
/** Below this many points a «wasted» share is not worth a sentence. */
const WASTE_WORTH_SAYING_PCT = 5;

type Loaded = { kind: "loading" } | { kind: "failed"; code: string } | { kind: "ready"; budget: TeamBudget };
type Stopped = "stopped" | "paused" | null;

// Sizes and colours of the page. The numbers are read at a glance (big, in the colour of the verdict), the sentences are read
// (14 px, the body colour of the theme: «muted» is kept for the side notes), and every chart colour is a token of the chosen
// theme, so it follows the palette (light, dark, custom) and stays apart from its neighbours.
const card = "rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 flex flex-col gap-3";
const heading = "m-0 text-[16px] font-semibold text-[var(--color-white)]";
const line = "m-0 text-[14px] leading-6 text-[var(--color-base)]";
const note = "m-0 text-[13px] leading-5 text-[var(--color-muted)]";
const bigNumber = "m-0 text-[40px] leading-none font-bold tabular-nums";

const LINE_COLOR: Record<string, string> = {
  ahead: "var(--color-orange)",
  on: "var(--color-green)",
  behind: "var(--color-blue)",
};

function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="mt-[6px] inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />;
}

function failureText(code: string): string {
  const copy = describeError(code, { fallback: "budget_unreadable", locale: appLocale() });
  return `${copy.text} ${copy.action}`;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));

function number(value: number, locale: string, digits = 1): string {
  return value.toLocaleString(locale, { maximumFractionDigits: digits });
}

function duration(minutes: number, t: BudgetText): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? fill(t.durationHours, { h, m }) : fill(t.durationMinutes, { m });
}

function clock(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function resetWhen(unix: number, locale: string): string {
  return new Date(unix * 1000).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function WeekCard({ budget, t, locale }: { budget: TeamBudget; t: BudgetText; locale: string }) {
  const week = budget.week;
  const used = week?.usedPct ?? null;
  const ideal = week?.idealUsedPct ?? null;
  const pts = week?.deviationPts !== null && week?.deviationPts !== undefined ? number(Math.abs(week.deviationPts), locale) : "";
  const lineColor = (week?.line && LINE_COLOR[week.line]) || "var(--color-bright)";
  const verdict =
    week?.line === "ahead" ? fill(t.lineAhead, { pts }) : week?.line === "behind" ? fill(t.lineBehind, { pts }) : week?.line === "on" ? t.lineOn : t.lineUnknown;
  return (
    <section data-testid="budget-week" aria-labelledby="budget-week-title" className={card}>
      <h2 id="budget-week-title" className={heading}>{t.weekTitle}</h2>
      {used === null ? (
        <p className={line}>{t.unavailable}</p>
      ) : (
        <>
          <p className={bigNumber} style={{ color: lineColor }}>{number(used, locale)} %</p>
          <div
            role="img"
            aria-label={fill(t.barLabel, { used: number(used, locale), ideal: ideal === null ? t.unavailable : number(ideal, locale) })}
            data-testid="budget-bar"
            className="relative mt-2 h-4 w-full rounded-full bg-[var(--color-border)]"
          >
            <div data-testid="budget-bar-used" className="h-full rounded-full" style={{ width: `${clamp(used)}%`, background: lineColor }} />
            {ideal !== null && (
              <div
                data-testid="budget-bar-ideal"
                className="absolute -top-1.5 h-7 w-[3px] rounded-sm bg-[var(--color-white)] shadow-[0_0_0_2px_var(--color-card)]"
                style={{ left: `${clamp(ideal)}%`, transform: "translateX(-50%)" }}
              />
            )}
          </div>
          <p className={`${line} flex items-start gap-2`}><Swatch color={lineColor} />{fill(t.weekUsed, { used: number(used, locale) })}</p>
          {ideal !== null && (
            <p className={`${line} flex items-start gap-2`}>
              <span aria-hidden="true" className="mt-[6px] inline-block h-3 w-[3px] shrink-0 rounded-sm bg-[var(--color-white)]" />
              {fill(t.weekIdeal, { ideal: number(ideal, locale) })}
            </p>
          )}
          <p className="m-0 text-[15px] leading-6 font-semibold text-[var(--color-bright)]" data-testid="budget-line">{verdict}</p>
        </>
      )}
    </section>
  );
}

function LeftCard({ budget, t, locale }: { budget: TeamBudget; t: BudgetText; locale: string }) {
  const week = budget.week;
  return (
    <section data-testid="budget-left" aria-labelledby="budget-left-title" className={card}>
      <h2 id="budget-left-title" className={heading}>{t.leftTitle}</h2>
      {week?.remainingPct == null ? (
        <p className={line}>{t.unavailable}</p>
      ) : (
        <>
          <p className={bigNumber} style={{ color: "var(--color-bright)" }}>{number(week.remainingPct, locale)} %</p>
          <p className={line}>{fill(t.left, { left: number(week.remainingPct, locale) })}</p>
        </>
      )}
      <p className={line}>{week?.resetAtUnix == null ? t.resetUnknown : fill(t.resets, { when: resetWhen(week.resetAtUnix, locale) })}</p>
      {week?.activeHoursToReset != null && <p className={line}>{fill(t.activeLeft, { h: number(week.activeHoursToReset, locale, 0) })}</p>}
    </section>
  );
}

function RateCard({ budget, t, locale }: { budget: TeamBudget; t: BudgetText; locale: string }) {
  const rate = budget.rate;
  const rows: string[] = [];
  if (rate) {
    if (rate.loPctH !== null && rate.hiPctH !== null && rate.loPctH !== rate.hiPctH) {
      rows.push(fill(t.rateNowRange, { lo: number(rate.loPctH, locale, 2), hi: number(rate.hiPctH, locale, 2) }));
    } else if (rate.nowPctH !== null) {
      rows.push(fill(t.rateNow, { n: number(rate.nowPctH, locale, 2) }));
    }
    if (rate.sustainablePctH !== null) rows.push(fill(t.rateSustainable, { n: number(rate.sustainablePctH, locale, 2) }));
    const early = rate.lockoutEarlyActiveH;
    if (early !== null && rate.marginActiveH !== null && early > rate.marginActiveH) {
      rows.push(fill(t.projLockout, { h: number(early, locale, 0) }));
    } else if (rate.projectedFinalPct !== null) {
      rows.push(fill(t.projLand, { n: number(Math.min(rate.projectedFinalPct, 100), locale, 0) }));
      if (rate.wastedPct !== null && rate.wastedPct >= WASTE_WORTH_SAYING_PCT) rows.push(fill(t.projWaste, { n: number(rate.wastedPct, locale, 0) }));
    }
  }
  return (
    <section data-testid="budget-rate" aria-labelledby="budget-rate-title" className={card}>
      <h2 id="budget-rate-title" className={heading}>{t.rateTitle}</h2>
      {rows.length === 0 ? (
        <p className={line}>{t.projNone}</p>
      ) : (
        rows.map((row) => (
          <p key={row} className={line}>{row}</p>
        ))
      )}
    </section>
  );
}

function BrakesCard({ budget, stopped, t }: { budget: TeamBudget; stopped: Stopped; t: BudgetText }) {
  const rows: string[] = [];
  if (stopped === "stopped") rows.push(t.teamStopped);
  if (stopped === "paused") rows.push(t.teamPaused);
  for (const brake of budget.brakes) {
    const sentence = t[`brake_${brake}` as keyof BudgetText];
    rows.push(fill(sentence, { sec: budget.pauseSec ?? t.unavailable }));
  }
  return (
    <section data-testid="budget-brakes" aria-labelledby="budget-brakes-title" className={card}>
      <h2 id="budget-brakes-title" className={heading}>{t.brakesTitle}</h2>
      {rows.length === 0 ? (
        <p className={line} data-testid="budget-brakes-none">{t.brakesNone}</p>
      ) : (
        <ul className="m-0 pl-5 flex flex-col gap-2 list-disc marker:text-[var(--color-orange)]">
          {rows.map((row) => (
            <li key={row} className={line}>{row}</li>
          ))}
        </ul>
      )}
      {budget.burn.state === "active" && <p className={line} data-testid="budget-brakes-burn">{t.brakesBurn}</p>}
    </section>
  );
}

function BurnCard({ budget, readOnly, t, locale }: { budget: TeamBudget; readOnly: boolean; t: BudgetText; locale: string }) {
  const burn = budget.burn;
  const state =
    burn.state === "active"
      ? fill(t.burnActive, { left: burn.remainingMin === null ? t.unavailable : duration(burn.remainingMin, t), until: clock(burn.expiresAt, locale) })
      : burn.state === "expired"
        ? t.burnExpired
        : burn.state === "off"
          ? t.burnOff
          : t.burnUnknown;
  const early = budget.rate?.lockoutEarlyActiveH ?? null;
  const margin = budget.rate?.marginActiveH ?? null;
  return (
    <section data-testid="budget-burn" aria-labelledby="budget-burn-title" className={card}>
      <h2 id="budget-burn-title" className={heading}>{t.burnTitle}</h2>
      <p className={line} data-testid="budget-burn-state">{state}</p>
      {burn.state === "active" && (
        <>
          <p className={line} data-testid="budget-burn-cost">
            {burn.spentPts === null ? t.burnCostUnknown : fill(t.burnCost, { pts: number(burn.spentPts, locale) })}
          </p>
          {burn.paceBeforePctH !== null && burn.paceNowPctH !== null && (
            <p className={line}>{fill(t.burnPace, { before: number(burn.paceBeforePctH, locale, 2), now: number(burn.paceNowPctH, locale, 2) })}</p>
          )}
          {early !== null && margin !== null && early > margin ? (
            <p className={line} data-testid="budget-burn-wall">{fill(t.burnWall, { h: number(early, locale, 0) })}</p>
          ) : budget.rate ? (
            <p className={line}>{t.burnNoWall}</p>
          ) : null}
        </>
      )}
      {!readOnly && <BurstStrip />}
    </section>
  );
}

function RolesCard({ budget, t, locale }: { budget: TeamBudget; t: BudgetText; locale: string }) {
  const roles = budget.roles;
  return (
    <section data-testid="budget-roles" aria-labelledby="budget-roles-title" className={card}>
      <h2 id="budget-roles-title" className={heading}>{t.rolesTitle}</h2>
      {roles === null || roles.roles.length === 0 ? (
        <p className={line}>{t.rolesNone}</p>
      ) : (
        <>
          <p className={note}>{roles.window === "week" ? t.rolesWindowWeek : t.rolesWindow5h}</p>
          <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--color-border)]" aria-hidden="true" data-testid="budget-roles-stack">
            {roles.roles.map((item) => (
              <div key={item.role} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${clamp(item.sharePct)}%`, background: ROLE_COLOR[item.role] }} />
            ))}
          </div>
          <ul className="m-0 p-0 list-none flex flex-col gap-3">
            {roles.roles.map((item) => (
              <li key={item.role} data-testid={`budget-role-${item.role}`} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="flex items-start gap-2 text-[var(--color-bright)]">
                    <Swatch color={ROLE_COLOR[item.role]} />
                    {t[`role_${item.role}` as keyof BudgetText]}
                  </span>
                  <span className="tabular-nums text-[var(--color-base)]">
                    <strong className="font-semibold text-[var(--color-bright)]">{number(item.sharePct, locale)} %</strong>
                    {item.agents !== null && <span className="text-[var(--color-muted)]">{` · ${item.agents === 1 ? t.rolesAgentOne : fill(t.rolesAgents, { n: item.agents })}`}</span>}
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-[var(--color-border)]" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${clamp(item.sharePct)}%`, background: ROLE_COLOR[item.role] }} />
                </div>
              </li>
            ))}
          </ul>
          {roles.unattributedPct !== null && roles.unattributedPct > 0 && <p className={note}>{fill(t.rolesUnattributed, { n: number(roles.unattributedPct, locale) })}</p>}
          {roles.ageMin !== null && roles.ageMin > STALE_AFTER_MIN && <p className={note}>{fill(t.rolesOld, { min: roles.ageMin })}</p>}
        </>
      )}
    </section>
  );
}

/**
 * /budget: how the team's weekly budget is going, in plain words. The numbers are the team's own (the same line of the
 * working hours, the same rate and the same verdict the Sentinella and the pace guard use), read through the native
 * `team_budget_read`; the page only reads (it works on a team that is only read too) and says each number with what it is
 * measured against. A number the team does not have is «not available», never 0. The quota and the hours are set where they
 * always were, in /settings/hours.
 */
export default function BudgetPage(_props: PageProps) {
  const locale = appLocale();
  const t = BUDGET_TEXT[locale];
  const readOnly = useExistingTeamReadOnly() !== null;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [stopped, setStopped] = useState<Stopped>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const load = useCallback(async (keepWhileReading: boolean) => {
    if (!keepWhileReading) setLoaded({ kind: "loading" });
    const [budget, state]: [BudgetResult, Awaited<ReturnType<typeof readTeamState>>] = await Promise.all([
      readTeamBudget(),
      readTeamState().catch(() => ({ ok: false as const, at: 0, code: "unknown" })),
    ]);
    setLoaded(budget.ok ? { kind: "ready", budget: budget.budget } : { kind: "failed", code: budget.error });
    const value: TeamControlState | null = state.ok ? state.value : null;
    setStopped(value === null ? null : value.halted ? "stopped" : value.standby.state === "active" ? "paused" : null);
  }, []);

  // «Reconnect the chat»: the same native reconnect the chat's own page uses; then the budget is read again.
  const reconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      await reconnectDirectChat();
    } catch (error) {
      setLoaded({ kind: "failed", code: errorCodeOf(error) ?? "disconnected" });
      setReconnecting(false);
      return;
    }
    setReconnecting(false);
    await load(false);
  }, [load]);

  useEffect(() => {
    let alive = true;
    void load(false);
    const timer = setInterval(() => {
      if (alive) void load(true);
    }, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load]);

  return (
    <section className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-5" aria-labelledby="budget-title" data-testid="budget-page">
      <h1 id="budget-title" className="m-0 text-[24px] font-bold text-[var(--color-white)]">{t.title}</h1>
      {loaded.kind === "loading" && <p role="status" className={note}>{t.loading}</p>}
      {loaded.kind === "failed" && (
        <div role="alert" data-testid="budget-failed" className="rounded-xl border border-[var(--color-border)] px-5 py-4 text-[14px]">
          <p className="m-0 text-[var(--color-yellow)]">{t.readFailed}</p>
          <p className="m-0 mt-1 text-[var(--color-base)]">{failureText(loaded.code)}</p>
          <UpdateTeamHelp code={loaded.code} />
          {loaded.code === "disconnected" ? (
            <button
              type="button"
              data-testid="budget-reconnect"
              disabled={reconnecting}
              onClick={() => void reconnect()}
              className="mt-3 text-[12px] font-semibold uppercase tracking-widest px-4 py-2 rounded border border-[var(--color-border)] text-[var(--color-bright)] disabled:opacity-60"
            >
              {t.reconnect}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void load(false)}
              className="mt-3 text-[12px] font-semibold uppercase tracking-widest px-4 py-2 rounded border border-[var(--color-border)] text-[var(--color-bright)]"
            >
              {t.retry}
            </button>
          )}
        </div>
      )}
      {loaded.kind === "ready" && (
        <>
          <p className={note} data-testid="budget-freshness">
            {loaded.budget.sampleAgeMin === null
              ? t.noReading
              : loaded.budget.sampleAgeMin > STALE_AFTER_MIN
                ? fill(t.stale, { min: loaded.budget.sampleAgeMin })
                : loaded.budget.sampleAgeMin === 0
                  ? t.updatedNow
                  : fill(t.updated, { min: loaded.budget.sampleAgeMin })}
          </p>
          {loaded.budget.week === null && stopped !== null && <p className={note}>{stopped === "stopped" ? t.teamStopped : t.teamPaused}</p>}
          <div className="grid gap-5 md:grid-cols-[3fr_2fr]">
            <WeekCard budget={loaded.budget} t={t} locale={locale} />
            <LeftCard budget={loaded.budget} t={t} locale={locale} />
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <RateCard budget={loaded.budget} t={t} locale={locale} />
            <BrakesCard budget={loaded.budget} stopped={stopped} t={t} />
          </div>
          <BurnCard budget={loaded.budget} readOnly={readOnly} t={t} locale={locale} />
          <RolesCard budget={loaded.budget} t={t} locale={locale} />
          {!readOnly && (
            <button
              type="button"
              data-testid="budget-hours-link"
              onClick={() => navigate("/settings/hours")}
              className="self-start text-[12px] tracking-[0.14em] uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)]"
            >
              {t.hoursLink} →
            </button>
          )}
        </>
      )}
    </section>
  );
}
