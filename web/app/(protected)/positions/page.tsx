import Link from 'next/link'
import { getPositions } from '@/lib/queries'
import type { PositionWithScore, PositionStatus } from '@/lib/types'

const STATUS_COLORS: Record<string, string> = {
  new:      'var(--color-muted)',
  checked:  'var(--color-blue)',
  scored:   'var(--color-purple)',
  writing:  'var(--color-yellow)',
  review:   'var(--color-orange)',
  ready:    '#7fffb2',
  applied:  'var(--color-green)',
  response: '#58a6ff',
  excluded: 'var(--color-red)',
}

const ALL_STATUSES: PositionStatus[] = ['new', 'checked', 'scored', 'writing', 'review', 'ready', 'applied', 'response', 'excluded']

function scoreClass(s?: number) {
  if (!s) return 'text-[var(--color-dim)]'
  if (s >= 75) return 'text-[var(--color-green)]'
  if (s >= 55) return 'text-[var(--color-yellow)]'
  return 'text-[var(--color-red)]'
}

function scoreBg(s?: number) {
  if (!s) return 'var(--color-border)'
  if (s >= 75) return 'var(--color-green)'
  if (s >= 55) return 'var(--color-yellow)'
  return 'var(--color-red)'
}

function formatSalary(min: number | null, max: number | null, currency?: string | null) {
  if (!min && !max) return null
  const c = currency ?? 'EUR'
  if (min && max) return `${c} ${(min / 1000).toFixed(0)}–${(max / 1000).toFixed(0)}K`
  if (min) return `${c} ${(min / 1000).toFixed(0)}K+`
  return null
}

// ── Tier config (dal legacy) ──────────────────────────────────────
const TIERS = [
  { val: 'all',         label: 'Tutti',        color: undefined,                  min: undefined, max: undefined, noScore: false },
  { val: 'seria',       label: 'Seria ≥70',    color: 'var(--color-green)',        min: 70,        max: undefined, noScore: false },
  { val: 'practice',   label: 'Practice 40-69', color: 'var(--color-yellow)',     min: 40,        max: 69,        noScore: false },
  { val: 'riferimento', label: 'Riferimento <40', color: 'var(--color-orange)',   min: 1,         max: 39,        noScore: false },
  { val: 'noscore',    label: 'Non scored',    color: 'var(--color-dim)',          min: undefined, max: undefined, noScore: true  },
] as const

interface PageProps {
  searchParams: Promise<{ status?: string; remote?: string; tier?: string }>
}

export default async function PositionsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const statusFilter = params.status ?? 'all'
  const remoteFilter = params.remote ?? 'all'
  const tierFilter   = params.tier ?? 'all'

  const tier = TIERS.find(t => t.val === tierFilter) ?? TIERS[0]

  const positions = await getPositions({
    status:     statusFilter !== 'all' ? statusFilter : undefined,
    remoteType: remoteFilter !== 'all' ? remoteFilter : undefined,
    minScore:   tier.min,
    maxScore:   tier.max,
    noScore:    tier.noScore,
    limit: 600,
  })

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Posizioni</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">
          Posizioni
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {positions.length} risultati
          {statusFilter !== 'all' && ` · status: ${statusFilter}`}
          {remoteFilter !== 'all' && ` · ${remoteFilter.replace('_', ' ')}`}
          {tierFilter !== 'all' && ` · ${tier.label}`}
        </p>
      </div>

      {/* ── Tier filter (dal legacy: Seria / Practice / Riferimento) ── */}
      <div className="mb-5">
        <span className="text-[9.5px] font-semibold tracking-[0.14em] uppercase text-[var(--color-dim)] mr-3">Tier</span>
        <span className="inline-flex flex-wrap gap-1.5">
          {TIERS.map(t => (
            <FilterChip
              key={t.val}
              href={`/positions?${statusFilter !== 'all' ? `status=${statusFilter}&` : ''}${remoteFilter !== 'all' ? `remote=${remoteFilter}&` : ''}${t.val !== 'all' ? `tier=${t.val}` : ''}`}
              label={t.label}
              active={tierFilter === t.val}
              color={t.color}
            />
          ))}
        </span>
      </div>

      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status filter */}
        <div className="flex flex-wrap gap-1">
          <FilterChip href={`/positions?${tierFilter !== 'all' ? `tier=${tierFilter}&` : ''}${remoteFilter !== 'all' ? `remote=${remoteFilter}` : ''}`} label="Tutti" active={statusFilter === 'all'} />
          {ALL_STATUSES.map(s => (
            <FilterChip
              key={s}
              href={`/positions?status=${s}${remoteFilter !== 'all' ? `&remote=${remoteFilter}` : ''}${tierFilter !== 'all' ? `&tier=${tierFilter}` : ''}`}
              label={s}
              active={statusFilter === s}
              color={STATUS_COLORS[s]}
            />
          ))}
        </div>

        {/* Remote filter */}
        <div className="flex gap-1 ml-auto">
          {[
            { val: 'all', label: 'Remote: tutti' },
            { val: 'full_remote', label: 'Full remote' },
            { val: 'hybrid', label: 'Hybrid' },
            { val: 'onsite', label: 'On-site' },
          ].map(({ val, label }) => (
            <FilterChip
              key={val}
              href={`/positions?${statusFilter !== 'all' ? `status=${statusFilter}&` : ''}remote=${val}${tierFilter !== 'all' ? `&tier=${tierFilter}` : ''}`}
              label={label}
              active={remoteFilter === val}
            />
          ))}
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg">
        <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
              {['ID', 'Titolo', 'Azienda', 'Location', 'Remote', 'Stipendio', 'Score', 'Stato'].map(h => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-[9.5px] font-semibold tracking-[0.15em] uppercase whitespace-nowrap"
                  style={{ color: 'var(--color-dim)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-[var(--color-dim)] text-[11px]">
                  Nessuna posizione trovata con questi filtri.
                </td>
              </tr>
            ) : positions.map((p: PositionWithScore, i: number) => (
              <tr
                key={p.id}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
                style={{
                  borderBottomColor: i === positions.length - 1 ? 'transparent' : undefined,
                  background: i % 2 === 1 ? 'rgba(255,255,255,0.008)' : undefined,
                }}
              >
                <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] whitespace-nowrap">
                  {p.legacy_id ? `JHT-${String(p.legacy_id).padStart(3, '0')}` : p.id.slice(0, 8)}
                </td>
                <td className="px-4 py-3 font-medium max-w-[220px]">
                  <Link
                    href={`/positions/${p.id}`}
                    className="text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors line-clamp-2"
                  >
                    {p.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--color-base)] whitespace-nowrap max-w-[140px] truncate" title={p.company}>
                  {p.company}
                </td>
                <td className="px-4 py-3 text-[11px] text-[var(--color-muted)] whitespace-nowrap">
                  {p.location ?? '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-[10px]" style={{
                    color: p.remote_type === 'full_remote'
                      ? 'var(--color-green)'
                      : p.remote_type === 'hybrid'
                      ? 'var(--color-yellow)'
                      : p.remote_type === 'onsite'
                      ? 'var(--color-red)'
                      : 'var(--color-dim)',
                  }}>
                    {p.remote_type?.replace('_', ' ') ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-[11px] text-[var(--color-muted)] whitespace-nowrap">
                  {formatSalary(p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency) ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <span className={`text-[12px] font-semibold w-6 text-right ${scoreClass(p.score)}`}>
                      {p.score ?? '—'}
                    </span>
                    <div className="w-10 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${p.score ?? 0}%`, background: scoreBg(p.score) }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap"
                    style={{
                      color: STATUS_COLORS[p.status] ?? 'var(--color-dim)',
                      borderColor: STATUS_COLORS[p.status] ?? 'var(--color-border)',
                      background: `${STATUS_COLORS[p.status]}18`,
                    }}
                  >
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}

function FilterChip({
  href,
  label,
  active,
  color,
}: {
  href: string
  label: string
  active?: boolean
  color?: string
}) {
  return (
    <Link
      href={href}
      className="px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-colors no-underline whitespace-nowrap"
      style={active
        ? {
            color: color ?? 'var(--color-bright)',
            borderColor: color ?? 'var(--color-green)',
            background: color ? `${color}20` : 'var(--color-card)',
          }
        : {
            color: 'var(--color-dim)',
            borderColor: 'var(--color-border)',
            background: 'transparent',
          }
      }
    >
      {label}
    </Link>
  )
}
