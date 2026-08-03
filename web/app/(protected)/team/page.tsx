import { getTeamActivity } from "@/lib/queries";
import ActivityCharts from "./ActivityCharts";
import RangePicker from "./RangePicker";
import { ActivityPageHeader } from "./ActivityHeader";
import DirectivesPanel from "./DirectivesPanel";
import MobileTeamStatus from "./MobileTeamStatus";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

// 'YYYY-MM-DD' → 'DD/MM/YYYY'
function fmt(date: string): string {
  const p = date.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : date;
}

export default async function TeamActivityPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const activity = await getTeamActivity({ from: sp.from, to: sp.to });

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <ActivityPageHeader
        from={fmt(activity.from)}
        to={fmt(activity.to)}
        totalAll={activity.totalAll}
      />

      <MobileTeamStatus />

      <RangePicker from={activity.from} to={activity.to} days={activity.days} />

      <ActivityCharts activity={activity} />

      {/* 📋 Bacheca del team — ordini/strategia permanenti dell'utente. Il
          Capitano le rilegge a ogni riavvio (team_directives.py active). */}
      <section className="mx-auto w-full max-w-[900px] px-4 py-10">
        <DirectivesPanel readOnly />
      </section>
    </div>
  );
}
