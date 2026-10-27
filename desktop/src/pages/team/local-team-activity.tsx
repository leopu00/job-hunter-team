import { getTeamActivity } from "@/lib/queries";
import ActivityCharts from "@/app/(protected)/team/ActivityCharts";
import DirectivesPanel from "@/app/(protected)/team/DirectivesPanel";
import { ActivityPageHeader } from "@/app/(protected)/team/ActivityHeader";
import RangePicker from "@/app/(protected)/team/RangePicker";
import { appLocale } from "../../lib/app-locale";
import { LOCAL_TEAM_DATA_TEXT } from "../../lib/local-team-data.i18n";

// 'YYYY-MM-DD' → 'DD/MM/YYYY', as the web's team page writes it
function fmt(date: string): string {
  const p = date.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : date;
}

/**
 * The web's /team for a profile with no cloud account: the activity of the team of this computer, counted in
 * its database (getTeamActivity), and its board of standing orders, read from it; where the cloud's status card
 * would be, one line that says it is not shown here yet.
 */
export async function LocalTeamActivity({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const activity = await getTeamActivity({ from: sp.from, to: sp.to });
  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <ActivityPageHeader from={fmt(activity.from)} to={fmt(activity.to)} totalAll={activity.totalAll} />
      <p role="status" data-testid="team-local-profile" className="max-w-3xl mx-auto px-5 pt-4 text-[13px] text-[var(--color-muted)]">
        {LOCAL_TEAM_DATA_TEXT[appLocale()].teamPage}
      </p>
      <RangePicker from={activity.from} to={activity.to} days={activity.days} />
      <ActivityCharts activity={activity} />
      {/* the board of standing orders, read from the team's database; its controls are off (nothing writes here) */}
      <section className="mx-auto w-full max-w-[900px] px-4 py-10">
        <DirectivesPanel />
      </section>
    </div>
  );
}
