import Link from 'next/link'
import { getPositions } from '@/lib/queries'
import type { PositionWithScore, PositionStatus } from '@/lib/types'
import { createClient } from '@/lib/supabase/server'
import CloudSyncStatusBanner from '@/app/components/CloudSyncStatusBanner'

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

function formatFoundAt(ts: string | null | undefined) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
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
  searchParams: Promise<{ status?: string; remote?: string; tier?: string; sync?: string }>
}

const SYNC_FILTERS = [
  { val: 'all',      label: 'Tutti' },
  { val: 'synced',   label: '☁ Sincronizzate' },
  { val: 'unsynced', label: 'Da sincronizzare' },
] as const
type SyncFilter = typeof SYNC_FILTERS[number]['val']

export default async function PositionsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const statusFilter = params.status ?? 'all'
  const remoteFilter = params.remote ?? 'all'
  const tierFilter   = params.tier ?? 'all'
  const syncFilter: SyncFilter =
    params.sync === 'synced' || params.sync === 'unsynced' ? params.sync : 'all'

  const tier = TIERS.find(t => t.val === tierFilter) ?? TIERS[0]

  const allPositions = await getPositions({
    status:     statusFilter !== 'all' ? statusFilter : undefined,
    remoteType: remoteFilter !== 'all' ? remoteFilter : undefined,
    minScore:   tier.min,
    maxScore:   tier.max,
    noScore:    tier.noScore,
    limit: 600,
  })

  // Fetch dei legacy_id già su Supabase per l'utente loggato (set per
  // lookup O(1) dentro il loop righe). Errori → set vuoto, niente icona
  // ma la lista funziona comunque.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  let syncedIds = new Set<number>()
  if (user) {
    const { data } = await supabase
      .from('positions')
      .select('legacy_id')
      .eq('user_id', user.id)
      .not('legacy_id', 'is', null)
    syncedIds = new Set((data ?? []).map((r: { legacy_id: number | null }) => r.legacy_id).filter((x: number | null): x is number => typeof x === 'number'))
  }

  // Applica filtro sync dopo aver caricato syncedIds. Una position senza
  // legacy_id non può essere sincronizzata → cade in "unsynced".
  const positions = syncFilter === 'all'
    ? allPositions
    : allPositions.filter((p) => {
        const isSynced = p.legacy_id != null && syncedIds.has(p.legacy_id)
        return syncFilter === 'synced' ? isSynced : !isSynced
      })

  // Helper per costruire URL preservando filtri attivi.
  const buildHref = (overrides: Partial<Record<'status' | 'remote' | 'tier' | 'sync', string>>) => {
    const merged: Record<string, string> = {}
    if (statusFilter !== 'all') merged.status = statusFilter
    if (remoteFilter !== 'all') merged.remote = remoteFilter
    if (tierFilter !== 'all') merged.tier = tierFilter
    if (syncFilter !== 'all') merged.sync = syncFilter
    Object.assign(merged, overrides)
    // Rimuovi chiavi con valore 'all' (default → URL pulito)
    for (const k of Object.keys(merged)) if (merged[k] === 'all') delete merged[k]
    const qs = new URLSearchParams(merged).toString()
    return qs ? `/positions?${qs}` : '/positions'
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* Banner stato cloud-sync (compatto, nascosto se non loggato). */}
      <CloudSyncStatusBanner />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Posizioni</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">
          Posizioni
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {positions.length} risultati
          {statusFilter !== 'all' && ` · status: ${statusFilter}`}
          {remoteFilter !== 'all' && ` · ${remoteFilter.replace('_', ' ')}`}
          {tierFilter !== 'all' && ` · ${tier.label}`}
          {syncFilter !== 'all' && ` · ${SYNC_FILTERS.find(s => s.val === syncFilter)?.label}`}
        </p>
      </div>

      {/* ── Tier filter (dal legacy: Seria / Practice / Riferimento) ── */}
      <div className="mb-5">
        <span className="text-[9.5px] font-semibold tracking-[0.14em] uppercase text-[var(--color-dim)] mr-3">Tier</span>
        <span className="inline-flex flex-wrap gap-1.5">
          {TIERS.map(t => (
            <FilterChip
              key={t.val}
              href={buildHref({ tier: t.val })}
              label={t.label}
              active={tierFilter === t.val}
              color={t.color}
            />
          ))}
        </span>
      </div>

      {/* ── Sync filter (mostra solo se utente loggato — sennò info inutile) ── */}
      {user && (
        <div className="mb-5">
          <span className="text-[9.5px] font-semibold tracking-[0.14em] uppercase text-[var(--color-dim)] mr-3">Cloud sync</span>
          <span className="inline-flex flex-wrap gap-1.5">
            {SYNC_FILTERS.map(s => (
              <FilterChip
                key={s.val}
                href={buildHref({ sync: s.val })}
                label={s.label}
                active={syncFilter === s.val}
                color={s.val === 'synced' ? 'var(--color-green)' : s.val === 'unsynced' ? 'var(--color-yellow, #d4a85a)' : undefined}
              />
            ))}
          </span>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status filter */}
        <div className="flex flex-wrap gap-1">
          <FilterChip href={buildHref({ status: 'all' })} label="Tutti" active={statusFilter === 'all'} />
          {ALL_STATUSES.map(s => (
            <FilterChip
              key={s}
              href={buildHref({ status: s })}
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
              href={buildHref({ remote: val })}
              label={label}
              active={remoteFilter === val}
            />
          ))}
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg">
        <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }} aria-label="Lista posizioni">
          <thead>
            <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
              {['ID', 'Titolo', 'Azienda', 'Fonte', 'Location', 'Score', 'Rilevata', 'Stato'].map(h => (
                <th
                  key={h}
                  scope="col"
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
                  <span className="inline-flex items-center gap-1.5">
                    {p.legacy_id ? `JHT-${String(p.legacy_id).padStart(3, '0')}` : p.id.slice(0, 8)}
                    {p.legacy_id != null && syncedIds.has(p.legacy_id) && (
                      <span
                        title="Sincronizzato sul cloud"
                        aria-label="Sincronizzato sul cloud"
                        style={{ color: 'var(--color-green)', fontSize: '11px', lineHeight: 1 }}
                      >
                        ☁
                      </span>
                    )}
                  </span>
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
                <td className="px-4 py-3 text-[10px] text-[var(--color-muted)] whitespace-nowrap font-mono">
                  {p.source ?? '—'}
                </td>
                <td className="px-4 py-3 text-[11px] text-[var(--color-muted)] whitespace-nowrap">
                  {p.location ?? '—'}
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
                <td className="px-4 py-3 text-[10px] text-[var(--color-muted)] whitespace-nowrap font-mono">
                  {formatFoundAt(p.found_at)}
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
// Thu Apr 23 09:14:05 UTC 2026
