import { useCallback, useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { clearWorkStats, readWorkStats, type WorkNight, type WorkStats } from "../../lib/work-stats-native";
import type { WorkingHours } from "../../lib/team-settings-native";
import type { Locale } from "@/i18n/config";
import { WORK_HOURS_TEXT } from "./work-hours.i18n";
import { WORK_STATS_TEXT, type WorkStatsText } from "./work-stats.i18n";

/** Nights of data under which nothing is said about how the team did: the one place this number lives. */
export const MIN_NIGHTS = 3;
/** Days after the last observation from which the data is called old. */
export const STALE_AFTER_DAYS = 7;

type Loaded = { kind: "loading" } | { kind: "failed"; code: string } | { kind: "ready"; stats: WorkStats };

function errorText(code: string): string {
  const copy = describeError(code, { fallback: "stats_unavailable", locale: appLocale() });
  return `${copy.text} ${copy.action}`;
}

/** «Night» for hours that reach into the night (a window across midnight, or one that starts before 06:00), «day» otherwise and for 24/7. */
export function samplesAreNights(hours: WorkingHours | null): boolean {
  return (hours?.windows ?? []).some((window) => window.end < window.start || window.start < "06:00");
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));

function localDay(day: string, locale: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

function sumOf(nights: WorkNight[], pick: (night: WorkNight) => number | null): { total: number; over: number } {
  const known = nights.map(pick).filter((value): value is number => value !== null);
  return { total: known.reduce((sum, value) => sum + value, 0), over: known.length };
}

/**
 * «What happened» (/settings/hours): the nights the team worked, from the statistics it keeps (the native
 * `work_stats_read`). Every number comes with the nights it comes from; under {@link MIN_NIGHTS} nights
 * the page says the data is not enough instead of adding anything up; a number the team does not have is
 * «not available», never 0. The person clears the statistics with a confirmation that says the team
 * starts collecting again.
 */
export default function WorkStatsCard({ target, hours, now = new Date() }: { target: "local" | "vps"; hours: WorkingHours | null; now?: Date }) {
  const locale = appLocale();
  const t: WorkStatsText = WORK_STATS_TEXT[locale];
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [asking, setAsking] = useState(false);
  const [clearProblem, setClearProblem] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  const load = useCallback(async () => {
    setLoaded({ kind: "loading" });
    const read = await readWorkStats();
    setLoaded(read.ok ? { kind: "ready", stats: read.stats } : { kind: "failed", code: read.error });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const clear = async () => {
    setClearProblem(null);
    const done = await clearWorkStats();
    setAsking(false);
    if (!done.ok) {
      setClearProblem(errorText(done.error));
      return;
    }
    setCleared(true);
    await load();
  };

  const nights = samplesAreNights(hours);
  const unit = (n: number) => (nights ? (n === 1 ? t.nightOne : t.nightMany) : n === 1 ? t.dayOne : t.dayMany);
  const sample = (n: number) => fill(t.sample, { n, unit: unit(n) });

  return (
    <section data-testid="work-stats" aria-labelledby="work-stats-title" className="border border-[var(--color-border)] bg-[var(--color-panel)] rounded-lg p-4 flex flex-col gap-3">
      <h2 id="work-stats-title" className="text-[13px] font-semibold text-[var(--color-bright)]">
        {t.title}
      </h2>
      <p className="m-0 text-[11px] text-[var(--color-muted)]" data-testid="work-stats-where">
        {fill(target === "vps" ? t.whereVps : t.whereLocal, { days: loaded.kind === "ready" ? loaded.stats.retentionDays : 90 })}
      </p>
      {loaded.kind === "loading" && (
        <p role="status" className="m-0 text-[12px] text-[var(--color-muted)]">
          {t.loading}
        </p>
      )}
      {loaded.kind === "failed" && (
        <div role="alert" data-testid="work-stats-failed" className="text-[12px]">
          <p className="m-0 text-[var(--color-yellow)]">{t.readFailed}</p>
          <p className="m-0 mt-1 text-[var(--color-muted)]">{errorText(loaded.code)}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)]">
            {t.retry}
          </button>
        </div>
      )}
      {loaded.kind === "ready" && <StatsBody stats={loaded.stats} t={t} locale={locale} unit={unit} sample={sample} now={now} />}
      {cleared && loaded.kind === "ready" && (
        <p role="status" data-testid="work-stats-cleared" className="m-0 text-[11px] text-[var(--color-muted)]">
          {t.cleared}
        </p>
      )}
      {clearProblem !== null && (
        <p role="alert" data-testid="work-stats-clear-problem" className="m-0 text-[12px] text-[var(--color-yellow)]">
          {clearProblem}
        </p>
      )}
      {loaded.kind === "ready" && !asking && (
        <button
          type="button"
          data-testid="work-stats-clear"
          onClick={() => {
            setCleared(false);
            setAsking(true);
          }}
          className="self-start text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)]"
        >
          {t.clear}
        </button>
      )}
      {asking && (
        <div role="alertdialog" aria-labelledby="work-stats-ask" data-testid="work-stats-confirm" className="rounded border border-[var(--color-border)] px-3 py-2 flex flex-col gap-2">
          <p id="work-stats-ask" className="m-0 text-[12px] text-[var(--color-bright)]">
            {t.clearAsk}
          </p>
          <div className="flex gap-2">
            <button type="button" data-testid="work-stats-clear-yes" onClick={() => void clear()} className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)]">
              {t.clearYes}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-muted)]">
              {t.clearNo}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StatsBody({ stats, t, locale, unit, sample, now }: { stats: WorkStats; t: WorkStatsText; locale: string; unit: (n: number) => string; sample: (n: number) => string; now: Date }) {
  // a night under an hour of work counts for nothing: it is not a night the team worked
  const counted = stats.nights.filter((night) => night.hoursActive >= 1);
  if (stats.nights.length === 0) {
    return (
      <p role="status" data-testid="work-stats-none" className="m-0 text-[12px] text-[var(--color-muted)]">
        {fill(t.none, { min: MIN_NIGHTS, unit: unit(MIN_NIGHTS) })}
      </p>
    );
  }
  const idle = stats.lastObservation === null ? 0 : Math.floor((now.getTime() - Date.parse(stats.lastObservation)) / 86_400_000);
  const found = sumOf(counted, (night) => night.found);
  // «above the threshold» adds up only the nights counted with today's threshold: two thresholds are never mixed
  const sameThreshold = counted.filter((night) => night.scoreThreshold === stats.threshold);
  const otherThreshold = counted.filter((night) => night.aboveThreshold !== null && night.scoreThreshold !== stats.threshold);
  const above = sumOf(sameThreshold, (night) => night.aboveThreshold);
  const use = sumOf(counted, (night) => night.consumptionPct);
  const aboveWith = stats.threshold === null ? t.above : fill(t.aboveWith, { threshold: stats.threshold });
  return (
    <>
      {stats.scheduleState === "unreadable" && (
        <p role="alert" data-testid="work-stats-schedule-unreadable" className="m-0 text-[12px] text-[var(--color-yellow)]">
          {WORK_HOURS_TEXT[locale as Locale].unreadable}
        </p>
      )}
      {idle > STALE_AFTER_DAYS && (
        <p role="status" data-testid="work-stats-stale" className="m-0 text-[12px] text-[var(--color-yellow)]">
          {fill(t.stale, { days: idle })}
        </p>
      )}
      {counted.length < MIN_NIGHTS ? (
        <p role="status" data-testid="work-stats-insufficient" className="m-0 text-[12px] text-[var(--color-muted)]">
          {fill(t.insufficient, { n: counted.length, min: MIN_NIGHTS, unit: unit(MIN_NIGHTS) })}
        </p>
      ) : (
        <div data-testid="work-stats-summary" className="text-[12px] text-[var(--color-bright)] flex flex-col gap-1">
          {stats.from && stats.to && (
            <p className="m-0 text-[var(--color-muted)]">{fill(t.range, { from: localDay(stats.from, locale), to: localDay(stats.to, locale), sample: sample(counted.length) })}</p>
          )}
          <p className="m-0">
            {found.over === 0 ? (
              <span className="text-[var(--color-muted)]">{t.found}: {t.unavailable}</span>
            ) : (
              <>
                <span data-testid="work-stats-found-total">{found.total}</span> {t.found} <span className="text-[var(--color-muted)]">({sample(found.over)})</span>
              </>
            )}
          </p>
          <p className="m-0">
            {above.over === 0 ? (
              <span className="text-[var(--color-muted)]">{aboveWith}: {t.unavailable}</span>
            ) : (
              <>
                <span data-testid="work-stats-above-total">{above.total}</span> {aboveWith} <span className="text-[var(--color-muted)]">({sample(above.over)})</span>
              </>
            )}
          </p>
          {otherThreshold.length > 0 && (
            <p data-testid="work-stats-other-threshold" className="m-0 text-[11px] text-[var(--color-yellow)]">
              {fill(t.otherThreshold, { n: otherThreshold.length, unit: unit(otherThreshold.length) })}
            </p>
          )}
          <p className="m-0">
            {use.over === 0 ? (
              <span className="text-[var(--color-muted)]">{t.consumption}: {t.unavailable}</span>
            ) : (
              <>
                <span data-testid="work-stats-use-total">{use.total}</span> {t.consumption} <span className="text-[var(--color-muted)]">({sample(use.over)})</span>
              </>
            )}
          </p>
        </div>
      )}
      <p data-testid="work-stats-legend" className="m-0 text-[11px] text-[var(--color-muted)]">
        {fill(t.legend, { unit: unit(2) })}
      </p>
      <table data-testid="work-stats-table" className="w-full text-left text-[11px] text-[var(--color-muted)]">
        <caption className="sr-only">{t.tableLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{t.colDate}</th>
            <th scope="col">{t.colHours}</th>
            <th scope="col">{t.colFound}</th>
            <th scope="col">{t.colAbove}</th>
            <th scope="col">{t.colConsumption}</th>
          </tr>
        </thead>
        <tbody>
          {stats.nights.map((night) => (
            <tr key={night.date} data-testid="work-stats-row">
              <th scope="row" className="font-normal">{localDay(night.date, locale)}</th>
              <td>{night.hoursActive}</td>
              <td>{night.found ?? t.unavailable}</td>
              <td>{night.aboveThreshold === null ? t.unavailable : night.scoreThreshold === null ? night.aboveThreshold : `${night.aboveThreshold} (≥ ${night.scoreThreshold})`}</td>
              <td>{night.consumptionPct ?? t.unavailable}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
