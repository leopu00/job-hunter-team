function SkeletonBlock({ h = 'h-4', w = 'w-full', rounded = 'rounded' }: { h?: string; w?: string; rounded?: string }) {
  return (
    <div
      className={`${h} ${w} ${rounded} animate-pulse`}
      style={{ background: 'var(--color-border)' }}
    />
  )
}

function SkeletonCard() {
  return (
    <div
      className="p-4 rounded-lg border flex flex-col gap-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
    >
      <SkeletonBlock h="h-2.5" w="w-20" />
      <SkeletonBlock h="h-6" w="w-16" />
      <SkeletonBlock h="h-2" w="w-24" />
    </div>
  )
}

function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg border"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
    >
      <SkeletonBlock h="h-2" w="w-2" rounded="rounded-full" />
      <div className="flex-1 flex flex-col gap-1.5">
        <SkeletonBlock h="h-2.5" w="w-32" />
        <SkeletonBlock h="h-2" w="w-48" />
      </div>
    </div>
  )
}

export default function DashboardSkeleton() {
  return (
    <main className="min-h-screen px-5 py-10 flex flex-col gap-8 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <SkeletonBlock h="h-2.5" w="w-24" />
        <SkeletonBlock h="h-7" w="w-48" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>

      {/* Section rows */}
      <div className="flex flex-col gap-2">
        <SkeletonBlock h="h-3" w="w-32" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      </div>
    </main>
  )
}
