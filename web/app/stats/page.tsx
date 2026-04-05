'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

/* ── i18n ─────────────────────────────────────────────────────────── */

const T = {
  it: {
    title: 'Statistiche del progetto',
    subtitle: 'Metriche in tempo reale dal repository open source di Job Hunter Team.',
    loading: 'Caricamento metriche...',
    error: 'Impossibile caricare le metriche.',
    retry: 'Riprova',
    // Stat cards
    agents: 'Agenti AI',
    commits: 'Commit totali',
    days: 'Giorni di sviluppo',
    contributors: 'Contributori',
    api_routes: 'API Routes',
    pages: 'Pagine/componenti',
    shared: 'Moduli condivisi',
    tests: 'Test E2E',
    langs: 'Lingue (IT/EN)',
    // Sections
    weekly: 'Attivita settimanale',
    weekly_desc: 'Commit per settimana nelle ultime 12 settimane',
    types: 'Tipi di commit',
    types_desc: 'Distribuzione degli ultimi 200 commit per categoria',
    areas: 'Aree del codice',
    areas_desc: 'Numero di file per area del progetto',
    timeline: 'Timeline',
    first: 'Primo commit',
    last: 'Ultimo commit',
    // Chart labels
    feat: 'Feature',
    fix: 'Fix',
    merge: 'Merge',
    test: 'Test',
    other: 'Altro',
    web: 'Web App',
    api: 'API Routes',
    shared_label: 'Shared',
    e2e: 'E2E Tests',
    recent: 'Ultimi commit',
    recent_desc: 'Le modifiche piu recenti al repository',
    top_contributors: 'Top contributori',
    top_contributors_desc: 'I contributori piu attivi per numero di commit',
    commit_label: 'commit',
    stack: 'Tech Stack',
    stack_desc: 'Le tecnologie che alimentano Job Hunter Team',
    heatmap: 'Attivita giornaliera',
    heatmap_desc: 'Commit al giorno negli ultimi 90 giorni',
    less: 'Meno',
    more: 'Piu',
  },
  en: {
    title: 'Project Statistics',
    subtitle: 'Real-time metrics from the Job Hunter Team open source repository.',
    loading: 'Loading metrics...',
    error: 'Unable to load metrics.',
    retry: 'Retry',
    agents: 'AI Agents',
    commits: 'Total commits',
    days: 'Development days',
    contributors: 'Contributors',
    api_routes: 'API Routes',
    pages: 'Pages/components',
    shared: 'Shared modules',
    tests: 'E2E Tests',
    langs: 'Languages (IT/EN)',
    weekly: 'Weekly activity',
    weekly_desc: 'Commits per week over the last 12 weeks',
    types: 'Commit types',
    types_desc: 'Distribution of last 200 commits by category',
    areas: 'Code areas',
    areas_desc: 'Number of files per project area',
    timeline: 'Timeline',
    first: 'First commit',
    last: 'Last commit',
    feat: 'Feature',
    fix: 'Fix',
    merge: 'Merge',
    test: 'Test',
    other: 'Other',
    web: 'Web App',
    api: 'API Routes',
    shared_label: 'Shared',
    e2e: 'E2E Tests',
    recent: 'Recent commits',
    recent_desc: 'Latest changes to the repository',
    top_contributors: 'Top contributors',
    top_contributors_desc: 'Most active contributors by commit count',
    commit_label: 'commits',
    stack: 'Tech Stack',
    stack_desc: 'The technologies powering Job Hunter Team',
    heatmap: 'Daily activity',
    heatmap_desc: 'Commits per day over the last 90 days',
    less: 'Less',
    more: 'More',
  },
}

type StatsData = {
  source: 'git' | 'static'
  overview: {
    agents: number; languages: number; totalCommits: number; contributors: number
    devDays: number; apiRoutes: number; pages: number; sharedModules: number
    e2eTests: number; firstCommit: string; lastCommit: string
  }
  weeklyCommits: { week: string; count: number }[]
  typeCounts: { feat: number; fix: number; merge: number; test: number; other: number }
  areas: { web: number; api: number; shared: number; e2e: number }
  recentCommits: { hash: string; date: string; message: string; author: string }[]
  topContributors: { name: string; commits: number }[]
  dailyCommits: { date: string; count: number }[]
}

/* ── Componenti grafici CSS puro ─────────────────────────────────── */

function useCountUp(target: number, duration = 1200) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!ref.current || started.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return
      started.current = true
      const start = performance.now()
      const step = (now: number) => {
        const progress = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        setCount(Math.round(eased * target))
        if (progress < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }, { threshold: 0.3 })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [target, duration])

  return { count, ref }
}

function StatCard({ value, label, accent }: { value: string | number; label: string; accent?: string }) {
  const isNumber = typeof value === 'number'
  const { count, ref } = useCountUp(isNumber ? value : 0)

  return (
    <div
      ref={ref}
      className="p-5 rounded-xl border border-[var(--color-border)] transition-all hover:border-[var(--color-border-glow)]"
      style={{ background: 'var(--color-panel)' }}
    >
      <div className="text-2xl font-bold mb-1" style={{ color: accent ?? 'var(--color-green)' }}>
        {isNumber ? count : value}
      </div>
      <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wider">{label}</div>
    </div>
  )
}

function BarChart({ data, maxVal }: { data: { label: string; value: number; color: string }[]; maxVal: number }) {
  return (
    <div className="flex flex-col gap-3">
      {data.map(d => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="text-[10px] text-[var(--color-dim)] w-16 text-right flex-shrink-0">{d.label}</span>
          <div className="flex-1 h-6 rounded overflow-hidden" style={{ background: 'var(--color-card)' }}>
            <div
              className="h-full rounded transition-all duration-700"
              style={{
                width: `${maxVal > 0 ? (d.value / maxVal) * 100 : 0}%`,
                background: d.color,
                minWidth: d.value > 0 ? '4px' : '0',
              }}
            />
          </div>
          <span className="text-[11px] font-mono text-[var(--color-muted)] w-10 flex-shrink-0">{d.value}</span>
        </div>
      ))}
    </div>
  )
}

function WeeklyChart({ weeks }: { weeks: { week: string; count: number }[] }) {
  const max = Math.max(...weeks.map(w => w.count), 1)

  return (
    <div className="flex items-end gap-1.5 h-32">
      {weeks.map(w => {
        const pct = (w.count / max) * 100
        const weekDate = new Date(w.week + 'T00:00:00')
        const label = `${weekDate.getDate()}/${weekDate.getMonth() + 1}`
        return (
          <div key={w.week} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <span className="text-[9px] font-mono text-[var(--color-dim)]">{w.count}</span>
            <div className="w-full rounded-t relative" style={{ height: `${Math.max(pct, 3)}%`, minHeight: '3px' }}>
              <div
                className="absolute inset-0 rounded-t transition-all duration-500"
                style={{ background: 'var(--color-green)', opacity: 0.3 + (pct / 100) * 0.7 }}
              />
            </div>
            <span className="text-[8px] text-[var(--color-dim)] truncate w-full text-center">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  let offset = 0
  const segments = data.map(d => {
    const pct = total > 0 ? (d.value / total) * 100 : 0
    const seg = { ...d, pct, offset }
    offset += pct
    return seg
  })

  const gradientStops = segments
    .map(s => `${s.color} ${s.offset}% ${s.offset + s.pct}%`)
    .join(', ')

  return (
    <div className="flex items-center gap-6">
      <div
        className="w-28 h-28 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{
          background: `conic-gradient(${gradientStops})`,
        }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: 'var(--color-panel)' }}
        >
          <span className="text-[14px] font-bold text-[var(--color-white)]">{total}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {segments.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[11px] text-[var(--color-muted)]">{s.label}</span>
            <span className="text-[11px] font-mono text-[var(--color-dim)] ml-auto">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Heatmap({ days, lessLabel, moreLabel }: { days: { date: string; count: number }[]; lessLabel: string; moreLabel: string }) {
  const dayMap = new Map(days.map(d => [d.date, d.count]))
  const max = Math.max(...days.map(d => d.count), 1)

  // Build 90-day grid (13 weeks), starting from 90 days ago
  const today = new Date()
  const cells: { date: string; count: number; col: number; row: number }[] = []
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const dayOfWeek = d.getDay()
    const col = Math.floor((89 - i + (new Date(today.getTime() - 89 * 86400000).getDay())) / 7)
    cells.push({ date: key, count: dayMap.get(key) ?? 0, col, row: dayOfWeek })
  }

  const totalCols = Math.max(...cells.map(c => c.col)) + 1

  const getColor = (count: number) => {
    if (count === 0) return 'var(--color-card)'
    const intensity = count / max
    if (intensity <= 0.25) return '#00e87a33'
    if (intensity <= 0.5) return '#00e87a66'
    if (intensity <= 0.75) return '#00e87aaa'
    return '#00e87a'
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${totalCols}, 12px)`, gridTemplateRows: 'repeat(7, 12px)' }}>
          {cells.map(cell => (
            <div
              key={cell.date}
              className="rounded-sm transition-colors"
              style={{
                gridColumn: cell.col + 1,
                gridRow: cell.row + 1,
                width: 12,
                height: 12,
                background: getColor(cell.count),
              }}
              title={`${cell.date}: ${cell.count} commit`}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3 justify-end">
        <span className="text-[9px] text-[var(--color-dim)]">{lessLabel}</span>
        {[0, 0.25, 0.5, 0.75, 1].map((level, i) => (
          <div key={i} className="w-3 h-3 rounded-sm" style={{ background: getColor(level * max) }} />
        ))}
        <span className="text-[9px] text-[var(--color-dim)]">{moreLabel}</span>
      </div>
    </div>
  )
}

/* ── Pagina ───────────────────────────────────────────────────────── */

function StatsContent() {
  const { lang } = useLandingI18n()
  const t = T[lang as 'it' | 'en'] ?? T.it
  const [data, setData] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchData = () => {
    setLoading(true)
    setError(false)
    fetch('/api/stats')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const formatDate = (iso: string) => {
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString(lang === 'en' ? 'en-US' : 'it-IT', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    } catch { return iso }
  }

  return (
    <>
      <LandingNav />
      <main className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto" style={{ animation: 'fade-in 0.4s ease both' }}>
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 rounded-full border border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">open source</span>
          </div>
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight mb-3">
            {t.title}
          </h1>
          <p className="text-[13px] text-[var(--color-muted)] max-w-lg mx-auto leading-relaxed">
            {t.subtitle}
          </p>
          {data && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-semibold tracking-wider uppercase"
              style={{
                background: data.source === 'git' ? 'rgba(0,232,122,0.1)' : 'rgba(255,193,7,0.1)',
                color: data.source === 'git' ? 'var(--color-green)' : 'var(--color-yellow)',
                border: `1px solid ${data.source === 'git' ? 'rgba(0,232,122,0.2)' : 'rgba(255,193,7,0.2)'}`,
              }}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{
                background: data.source === 'git' ? 'var(--color-green)' : 'var(--color-yellow)',
                animation: data.source === 'git' ? 'pulse-dot 2s ease-in-out infinite' : 'none',
              }} />
              {data.source === 'git' ? 'live' : 'snapshot'}
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--color-green)', animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }} />
                ))}
              </div>
              <span className="text-[12px] text-[var(--color-dim)]">{t.loading}</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex flex-col items-center py-20 gap-4">
            <span className="text-[var(--color-red)] text-2xl">!</span>
            <p className="text-[12px] text-[var(--color-muted)]">{t.error}</p>
            <button
              onClick={fetchData}
              className="px-4 py-2 rounded text-[11px] font-semibold cursor-pointer transition-colors"
              style={{ border: '1px solid var(--color-green)', color: 'var(--color-green)', background: 'transparent' }}
            >
              {t.retry}
            </button>
          </div>
        )}

        {/* Data */}
        {data && !loading && (
          <div className="flex flex-col gap-10">
            {/* Stat cards grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard value={data.overview.agents} label={t.agents} />
              <StatCard value={data.overview.totalCommits} label={t.commits} />
              <StatCard value={data.overview.devDays} label={t.days} accent="var(--color-blue)" />
              <StatCard value={data.overview.contributors} label={t.contributors} accent="var(--color-purple)" />
              <StatCard value={data.overview.languages} label={t.langs} accent="var(--color-yellow)" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard value={data.overview.apiRoutes} label={t.api_routes} accent="var(--color-orange)" />
              <StatCard value={data.overview.pages} label={t.pages} accent="var(--color-blue)" />
              <StatCard value={data.overview.sharedModules} label={t.shared} accent="var(--color-purple)" />
              <StatCard value={data.overview.e2eTests} label={t.tests} accent="var(--color-yellow)" />
            </div>

            {/* Weekly activity chart */}
            {data.weeklyCommits.length > 0 && (
              <section className="p-6 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
                <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t.weekly}</h2>
                <p className="text-[11px] text-[var(--color-dim)] mb-5">{t.weekly_desc}</p>
                <WeeklyChart weeks={data.weeklyCommits} />
              </section>
            )}

            {/* Daily heatmap */}
            {data.dailyCommits && data.dailyCommits.length > 0 && (
              <section className="p-6 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
                <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t.heatmap}</h2>
                <p className="text-[11px] text-[var(--color-dim)] mb-5">{t.heatmap_desc}</p>
                <Heatmap days={data.dailyCommits} lessLabel={t.less} moreLabel={t.more} />
              </section>
            )}

            {/* Two columns: commit types + code areas */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Commit types donut */}
              <section className="p-6 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
                <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t.types}</h2>
                <p className="text-[11px] text-[var(--color-dim)] mb-5">{t.types_desc}</p>
                <DonutChart
                  data={[
                    { label: t.feat, value: data.typeCounts.feat, color: '#00e676' },
                    { label: t.fix, value: data.typeCounts.fix, color: '#ffc107' },
                    { label: t.merge, value: data.typeCounts.merge, color: '#2196f3' },
                    { label: t.test, value: data.typeCounts.test, color: '#b388ff' },
                    { label: t.other, value: data.typeCounts.other, color: '#607d8b' },
                  ]}
                />
              </section>

              {/* Code areas bar chart */}
              <section className="p-6 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
                <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t.areas}</h2>
                <p className="text-[11px] text-[var(--color-dim)] mb-5">{t.areas_desc}</p>
                <BarChart
                  maxVal={Math.max(data.areas.web, data.areas.api, data.areas.shared, data.areas.e2e)}
                  data={[
                    { label: t.web, value: data.areas.web, color: '#00e676' },
                    { label: t.api, value: data.areas.api, color: '#ffc107' },
                    { label: t.shared_label, value: data.areas.shared, color: '#b388ff' },
                    { label: t.e2e, value: data.areas.e2e, color: '#2196f3' },
                  ]}
                />
              </section>
            </div>

            {/* Recent commits */}
            {data.recentCommits && data.recentCommits.length > 0 && (
              <section className="p-6 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
                <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t.recent}</h2>
                <p className="text-[11px] text-[var(--color-dim)] mb-4">{t.recent_desc}</p>
                <div className="flex flex-col gap-2">
                  {data.recentCommits.map(c => {
                    const typeMatch = c.message.match(/^(feat|fix|merge|test)/i)
                    const typeColor = typeMatch
                      ? { feat: '#00e676', fix: '#ffc107', merge: '#2196f3', test: '#b388ff' }[typeMatch[1].toLowerCase()] ?? '#607d8b'
                      : '#607d8b'
                    return (
                      <div key={c.hash} className="flex items-start gap-3 py-2 border-b border-[var(--color-border)] last:border-0">
                        <span className="text-[10px] font-mono flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--color-card)', color: 'var(--color-dim)' }}>
                          {c.hash}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-[var(--color-muted)] truncate leading-relaxed">
                            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 -mb-px" style={{ background: typeColor }} />
                            {c.message}
                          </p>
                          <p className="text-[9px] text-[var(--color-dim)] mt-0.5">{c.author} &middot; {c.date}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Top contributors */}
            {data.topContributors && data.topContributors.length > 0 && (
              <section className="p-6 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
                <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t.top_contributors}</h2>
                <p className="text-[11px] text-[var(--color-dim)] mb-4">{t.top_contributors_desc}</p>
                <div className="flex flex-col gap-2">
                  {data.topContributors.map((c, i) => {
                    const maxCommits = data.topContributors[0]?.commits ?? 1
                    const initials = c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                    const colors = ['#00e676', '#4d9fff', '#b388ff', '#ffc107', '#ff8c42', '#26c6da', '#f44336', '#607d8b', '#a855f7', '#ff4560']
                    return (
                      <div key={c.name} className="flex items-center gap-3 py-1.5">
                        <span className="text-[10px] font-mono text-[var(--color-dim)] w-5 text-right flex-shrink-0">
                          {i + 1}
                        </span>
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold"
                          style={{ background: `${colors[i % colors.length]}22`, color: colors[i % colors.length], border: `1px solid ${colors[i % colors.length]}44` }}
                        >
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-[var(--color-muted)] truncate">{c.name}</span>
                            <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0">{c.commits} {t.commit_label}</span>
                          </div>
                          <div className="h-1 rounded-full mt-1" style={{ background: 'var(--color-card)' }}>
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${(c.commits / maxCommits) * 100}%`, background: colors[i % colors.length] }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Timeline */}
            <section className="p-6 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
              <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-4">{t.timeline}</h2>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--color-green)]" />
                  <div>
                    <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wider">{t.first}</div>
                    <div className="text-[13px] font-semibold text-[var(--color-bright)]">
                      {formatDate(data.overview.firstCommit)}
                    </div>
                  </div>
                </div>
                <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, var(--color-green), var(--color-border))' }} />
                <div className="flex items-center gap-2">
                  <div>
                    <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wider text-right">{t.last}</div>
                    <div className="text-[13px] font-semibold text-[var(--color-bright)]">
                      {formatDate(data.overview.lastCommit)}
                    </div>
                  </div>
                  <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-green)', animation: 'pulse-dot 2s ease-in-out infinite' }} />
                </div>
              </div>
            </section>

            {/* Tech Stack */}
            <section className="p-6 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
              <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t.stack}</h2>
              <p className="text-[11px] text-[var(--color-dim)] mb-5">{t.stack_desc}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {[
                  { name: 'Next.js', cat: 'Framework', color: '#fff' },
                  { name: 'React', cat: 'UI', color: '#61dafb' },
                  { name: 'TypeScript', cat: 'Language', color: '#3178c6' },
                  { name: 'Python', cat: 'Language', color: '#3776ab' },
                  { name: 'Tailwind CSS', cat: 'Styling', color: '#06b6d4' },
                  { name: 'Supabase', cat: 'Database', color: '#3ecf8e' },
                  { name: 'Claude API', cat: 'AI', color: '#d97757' },
                  { name: 'Zod', cat: 'Validation', color: '#3068b7' },
                ].map(tech => (
                  <div key={tech.name} className="flex items-center gap-2.5 p-3 rounded-lg border border-[var(--color-border)] transition-all hover:border-[var(--color-border-glow)]"
                    style={{ background: 'var(--color-card)' }}>
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tech.color }} />
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-[var(--color-bright)] truncate">{tech.name}</div>
                      <div className="text-[9px] text-[var(--color-dim)] uppercase tracking-wider">{tech.cat}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  )
}

export default function StatsPage() {
  return (
    <LandingI18nProvider>
      <StatsContent />
    </LandingI18nProvider>
  )
}
