import type { Locale } from "@/i18n/config";
import { EXISTING_TEAM_DASHBOARD_TEXT, fill } from "./existing-team-dashboard.i18n";
import type { ExistingTeamDashboardInfo } from "./load-dashboard";

/**
 * The numbers the core counted on the team's VPS, with their denominators, and
 * what the dashboard below does not have in full. Shown only for an existing
 * team that is read.
 */
export default function ExistingTeamSummary({
  info,
  locale,
}: {
  info: ExistingTeamDashboardInfo;
  locale: Locale;
}) {
  const t = EXISTING_TEAM_DASHBOARD_TEXT[locale];
  const buckets = info.buckets.map((b) => `${b.min === 0 ? "≤ " + b.max : b.min + "–" + b.max}: ${b.count}`);
  const notes = [
    info.chartsIncluded < info.chartsOf && fill(t.chartsPartial, { n: info.chartsIncluded, of: info.chartsOf }),
    info.eventsIncluded < info.eventsOf && fill(t.eventsPartial, { n: info.eventsIncluded, of: info.eventsOf }),
    !info.ratesAvailable && info.salaryUnconverted > 0 && fill(t.ratesUnavailable, { n: info.salaryUnconverted }),
    !info.ratesAvailable && t.eurOnly,
  ].filter((note): note is string => typeof note === "string");

  return (
    <section
      aria-label={t.title}
      data-testid="existing-team-summary"
      className="mb-6 rounded-lg border p-4 text-[11px]"
      style={{ borderColor: "var(--color-border)", background: "var(--color-card)", color: "var(--color-muted)" }}
    >
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--color-base)" }}>
        {t.title}
      </h2>
      <p>
        {info.withScore > 0 && info.avgScore != null
          ? fill(t.scored, { avg: info.avgScore, n: info.withScore, active: info.active })
          : fill(t.unscored, { active: info.active })}
      </p>
      {info.withScore > 0 && (
        <p className="mt-1">
          <strong style={{ color: "var(--color-base)" }}>{t.scoreBuckets}</strong> · {buckets.join(" · ")}
        </p>
      )}
      {info.sources.length > 0 && (
        <p className="mt-1">
          <strong style={{ color: "var(--color-base)" }}>{t.sources}</strong> ·{" "}
          {info.sources.map((s) => `${s.source}: ${s.count}`).join(" · ")}
        </p>
      )}
      <ul className={notes.length ? "mt-2 list-disc pl-4" : "list-disc pl-4"} data-testid="existing-team-summary-notes">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}
