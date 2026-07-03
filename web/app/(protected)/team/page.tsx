import { getTeamActivity } from "@/lib/queries";
import ActivityCharts from "./ActivityCharts";
import RangePicker from "./RangePicker";
import { ActivityPageHeader } from "./ActivityHeader";

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

      <RangePicker from={activity.from} to={activity.to} days={activity.days} />

      <ActivityCharts activity={activity} />
    </div>
  );
}
