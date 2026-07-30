type SkeletonBlockProps = { h?: string; w?: string; rounded?: string }

function Bone({ h = 'h-3', w = 'w-full', rounded = 'rounded' }: SkeletonBlockProps) {
  return <div className={`${h} ${w} ${rounded} animate-pulse`} style={{ background: 'var(--color-border)' }} />
}

type PageSkeletonProps = {
  /** Numero di card metriche nella riga superiore (0 = nessuna) */
  cards?: number
  /** Numero di righe tabella/lista */
  rows?: number
  /** Mostra header con titolo */
  header?: boolean
  /** Mostra barra filtri/azioni */
  toolbar?: boolean
}

export default function PageSkeleton({ cards = 0, rows = 5, header = true, toolbar = false }: PageSkeletonProps) {
  return (
    <main className="min-h-screen px-5 py-10 flex flex-col gap-6 max-w-4xl mx-auto w-full">

      {/* Header */}
      {header && (
        <div className="flex flex-col gap-2">
          <Bone h="h-2.5" w="w-20" />
          <Bone h="h-7" w="w-52" />
        </div>
      )}

      {/* Toolbar */}
      {toolbar && (
        <div className="flex gap-2">
          <Bone h="h-8" w="w-48" rounded="rounded-lg" />
          <Bone h="h-8" w="w-24" rounded="rounded-lg" />
          <div className="flex-1" />
          <Bone h="h-8" w="w-20" rounded="rounded-lg" />
        </div>
      )}

      {/* Cards metriche */}
      {cards > 0 && (
        <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${Math.min(cards, 4)}, minmax(0, 1fr))` }}>
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="p-4 rounded-lg border flex flex-col gap-2"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
              <Bone h="h-2.5" w="w-20" />
              <Bone h="h-6" w="w-14" />
              <Bone h="h-2" w="w-28" />
            </div>
          ))}
        </div>
      )}

      {/* Righe lista */}
      {rows > 0 && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
              <Bone h="h-2" w="w-2" rounded="rounded-full" />
              <div className="flex-1 flex flex-col gap-1.5">
                <Bone h="h-2.5" w={i % 3 === 0 ? 'w-40' : i % 3 === 1 ? 'w-56' : 'w-32'} />
                <Bone h="h-2" w={i % 2 === 0 ? 'w-64' : 'w-48'} />
              </div>
              <Bone h="h-5" w="w-14" rounded="rounded-full" />
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

// Varianti pronte
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <PageSkeleton header rows={rows} toolbar />
}

export function MetricsSkeleton({ cards = 4, rows = 4 }: { cards?: number; rows?: number }) {
  return <PageSkeleton header cards={cards} rows={rows} />
}
