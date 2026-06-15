import Link from "next/link";
import { getTeamActivityLog } from "@/lib/queries";
import ActivityLogTable from "./ActivityLogTable";

export const dynamic = "force-dynamic";

export default async function ActivityLogPage() {
  const events = await getTeamActivityLog();

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-6 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <Link href="/team" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Team
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <Link href="/team/attivita" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Attività
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Registro</span>
        </nav>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            📋 Registro attività
          </h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            Tutte le azioni del team, una riga per azione · {events.length}{" "}
            azioni totali
          </p>
          <p className="text-[var(--color-dim)] text-[10px] mt-1">
            Ogni azione è attribuita all&apos;istanza reale che l&apos;ha
            eseguita (scout-N, analista-N, scorer-N), dall&apos;event-log
            sincronizzato delle transizioni di stato.
          </p>
        </div>
      </div>

      <ActivityLogTable events={events} />
    </div>
  );
}
