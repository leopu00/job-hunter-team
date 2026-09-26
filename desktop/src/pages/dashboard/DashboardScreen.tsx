import ApplicationTimeline from "@/app/components/ApplicationTimeline";
import DashboardLinkedCharts from "@/app/components/DashboardLinkedCharts";
import RecentPositionsTable from "@/app/components/RecentPositionsTable";
import type { Locale } from "@/i18n/config";
import { buildApplicationTimeline } from "@/lib/application-timeline";
import { getDashboardT } from "@/lib/dashboard-i18n";
import { displayCurrencies, newestScored, type DashboardData } from "./load-dashboard";

/**
 * The body of web/app/(protected)/dashboard/page.tsx, block for block: counts,
 * latest scored positions, applications over time, linked charts. Same web
 * components, same labels. What stays on the web: the demo mode, the
 * onboarding popups and the cloud refresh button (the desktop topbar has its
 * own refresh).
 */
export default function DashboardScreen({
  data,
  locale,
}: {
  data: DashboardData;
  locale: Locale;
}) {
  const t = getDashboardT(locale);
  const { stats, positions, rates, applicationEvents } = data;
  const applicationTimeline = buildApplicationTimeline(applicationEvents);
  const activeTotal = stats.total - stats.excluded;
  const latest = newestScored(positions);

  return (
    <div style={{ animation: "fade-in 0.35s ease both", position: "relative" }}>
      <div style={{ position: "relative", background: "var(--color-deep)" }}>
        <div className="max-w-6xl mx-auto px-5 pt-8 pb-8">
          <div className="mb-6" style={{ animation: "fade-in 0.35s ease both" }}>
            <h1
              className="text-xl font-bold uppercase tracking-[0.18em] leading-none mb-2"
              style={{ color: "var(--color-white)" }}
            >
              {t.title}
            </h1>
            <div className="text-[11px] text-[var(--color-muted)]">
              {t.total_positions(stats.total, stats.excluded, activeTotal)}
            </div>
          </div>

          <div style={{ animation: "fade-in 0.35s ease both 0.06s" }}>
            <RecentPositionsTable
              rows={latest}
              firstCol="scored"
              filtered={false}
              totalFiltered={latest.length}
              labels={{
                title: t.new_positions,
                titleFiltered: t.new_positions,
                viewAll: t.view_all,
                noPositions: t.no_positions,
                unseen: t.unseen_marker,
                colId: t.col_id,
                colScored: t.col_scored,
                colTitle: t.col_title,
                colCompany: t.col_company,
                colCountry: t.col_country,
                colCity: t.col_city,
                colScore: t.col_score,
              }}
            />
          </div>

          {applicationTimeline && (
            <div style={{ animation: "fade-in 0.35s ease both 0.07s" }}>
              <ApplicationTimeline
                timeline={applicationTimeline}
                locale={locale}
                labels={{
                  title: t.application_timeline,
                  range: t.application_timeline_range(applicationTimeline.rangeDays),
                  total: t.application_timeline_total(applicationTimeline.visibleSubmitted),
                  description: t.application_timeline_description,
                  submitted: t.application_timeline_submitted,
                  accepted: t.application_timeline_accepted,
                  rejected: t.application_timeline_rejected,
                }}
              />
            </div>
          )}

          <div className="mb-8" style={{ animation: "fade-in 0.35s ease both 0.08s" }}>
            <DashboardLinkedCharts
              positions={positions}
              rates={rates}
              currencies={displayCurrencies()}
              labels={{
                types: t.position_types,
                countries: t.position_countries,
                cities: t.position_cities,
                score: t.score_distribution,
                salary: t.salary_distribution,
                noData: t.no_data,
                reset: t.reset_filters,
                table: {
                  title: t.recent_positions,
                  titleFiltered: t.recent_positions_filtered,
                  viewAll: t.view_all,
                  noPositions: t.no_positions,
                  unseen: t.unseen_marker,
                  colId: t.col_id,
                  colTitle: t.col_title,
                  colCompany: t.col_company,
                  colCountry: t.col_country,
                  colCity: t.col_city,
                  colScore: t.col_score,
                },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
