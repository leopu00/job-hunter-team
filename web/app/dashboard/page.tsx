'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Stats = { jobs: { total: number; counts: Record<string, number> }; applications: { total: number; counts: Record<string, number> }; interviews: { total: number; upcoming: number; passed: number }; alerts: { total: number; enabled: number }; companies: { total: number; totalPositions: number }; profiles: { total: number; avgCompleteness: number } }

function StatCard({ label, value, sub, color, href }: { label: string; value: number | string; sub?: string; color: string; href: string }) {
  return (
    <Link href={href} className="no-underline flex flex-col p-4 rounded-lg hover:scale-[1.02] transition-transform" style={{ background: 'var(--color-row)', border: `1px solid ${color}25` }}>
      <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)] uppercase">{label}</span>
      <span className="text-2xl font-bold font-mono mt-1" style={{ color }}>{value}</span>
      {sub && <span className="text-[9px] text-[var(--color-dim)] mt-1">{sub}</span>}
    </Link>
  )
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link href={href} className="no-underline flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[var(--color-row)] transition-colors" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex-1">
        <p className="text-[11px] text-[var(--color-bright)] font-medium">{label}</p>
        <p className="text-[9px] text-[var(--color-dim)]">{desc}</p>
      </div>
      <span className="text-[var(--color-dim)]">&rarr;</span>
    </Link>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)

  const fetchAll = useCallback(async () => {
    const [jobs, apps, ints, alerts, cos, profs] = await Promise.all([
      fetch('/api/jobs').then(r => r.json()).catch(() => ({})),
      fetch('/api/applications').then(r => r.json()).catch(() => ({})),
      fetch('/api/interviews').then(r => r.json()).catch(() => ({})),
      fetch('/api/alerts').then(r => r.json()).catch(() => ({})),
      fetch('/api/companies').then(r => r.json()).catch(() => ({})),
      fetch('/api/profiles').then(r => r.json()).catch(() => ({})),
    ]);
    setStats({
      jobs: { total: jobs.total ?? 0, counts: jobs.counts ?? {} },
      applications: { total: apps.total ?? 0, counts: apps.counts ?? {} },
      interviews: { total: ints.total ?? 0, upcoming: ints.upcoming ?? 0, passed: ints.passed ?? 0 },
      alerts: { total: alerts.total ?? 0, enabled: alerts.enabled ?? 0 },
      companies: { total: cos.total ?? 0, totalPositions: cos.totalPositions ?? 0 },
      profiles: { total: profs.total ?? 0, avgCompleteness: profs.avgCompleteness ?? 0 },
    });
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  if (!stats) return <div className="py-20 text-center"><p className="text-[var(--color-dim)] text-[12px]">Caricamento...</p></div>;

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="inline-flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-[var(--color-green)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
          <span className="text-[9px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">sistema attivo</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Dashboard</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Vista d'insieme della tua ricerca lavoro</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard label="Offerte" value={stats.jobs.total} sub={`${stats.jobs.counts.interview ?? 0} colloqui · ${stats.jobs.counts.offer ?? 0} offerte`} color="var(--color-green)" href="/jobs" />
        <StatCard label="Candidature" value={stats.applications.total} sub={`${stats.applications.counts.sent ?? 0} inviate · ${stats.applications.counts.interview ?? 0} colloqui`} color="#61affe" href="/applications" />
        <StatCard label="Colloqui" value={stats.interviews.total} sub={`${stats.interviews.upcoming} in programma · ${stats.interviews.passed} superati`} color="#fca130" href="/interviews" />
        <StatCard label="Aziende" value={stats.companies.total} sub={`${stats.companies.totalPositions} posizioni aperte`} color="#50e3c2" href="/companies" />
        <StatCard label="Profili" value={stats.profiles.total} sub={`${stats.profiles.avgCompleteness}% completezza media`} color="var(--color-yellow)" href="/profiles" />
        <StatCard label="Alert" value={`${stats.alerts.enabled}/${stats.alerts.total}`} sub="alert attivi" color="var(--color-red)" href="/alerts" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mb-2">Job Hunting</p>
          <div className="flex flex-col gap-2">
            <QuickLink href="/jobs" label="Offerte Lavoro" desc="Cerca e traccia offerte" />
            <QuickLink href="/applications" label="Candidature" desc="Stato invii e timeline" />
            <QuickLink href="/interviews" label="Colloqui" desc="Calendario e preparazione" />
            <QuickLink href="/cover-letters" label="Cover Letter" desc="Gestisci lettere" />
          </div>
        </div>
        <div>
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mb-2">Sistema</p>
          <div className="flex flex-col gap-2">
            <QuickLink href="/status" label="Stato Sistema" desc="Uptime e servizi" />
            <QuickLink href="/workers" label="Workers" desc="Agenti attivi" />
            <QuickLink href="/api-explorer" label="API Explorer" desc="Documentazione endpoint" />
            <QuickLink href="/settings" label="Impostazioni" desc="Configurazione" />
          </div>
        </div>
      </div>
    </div>
  )
}
