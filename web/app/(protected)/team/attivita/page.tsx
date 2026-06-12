import Link from "next/link";
import { getTeamActivity } from "@/lib/queries";
import ActivityCharts from "./ActivityCharts";
import RangePicker from "./RangePicker";

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
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <Link
            href="/team"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            Team
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            Attività
          </span>
        </nav>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            📊 Attività del team
          </h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            Chi ha lavorato e quanto · dal {fmt(activity.from)} al{" "}
            {fmt(activity.to)} · {activity.totalAll} azioni totali
          </p>
        </div>
      </div>

      <RangePicker from={activity.from} to={activity.to} days={activity.days} />

      <ActivityCharts activity={activity} />
    </div>
  );
}
