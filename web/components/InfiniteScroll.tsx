'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface InfiniteScrollProps<T> {
  /** Items già caricati */
  items: T[]
  /** Renderizza un singolo item */
  renderItem: (item: T, index: number) => React.ReactNode
  /** Chiamato quando il sentinel entra nel viewport — deve caricare la pagina successiva */
  onLoadMore: () => Promise<void> | void
  /** Se false, nasconde il sentinel e mostra "no more results" */
  hasMore: boolean
  /** Distanza dal fondo prima di triggerare (default 200px) */
  threshold?: string
  /** Testo "fine lista" custom */
  endMessage?: string
  /** Loader custom — se omesso usa spinner default */
  loader?: React.ReactNode
  /** Wrapper className */
  className?: string
  /** Chiave univoca per reset (es. cambio filtri) */
  resetKey?: string | number
}

/* ── Spinner default ── */
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
      <div style={{
        width: 20, height: 20, borderRadius: '50%',
        border: '2px solid var(--color-border)',
        borderTopColor: 'var(--color-green)',
        animation: 'spin 0.7s linear infinite',
      }} />
    </div>
  )
}

/* ── Hook useInfiniteScroll ── */
export function useInfiniteScroll<T>(
  fetcher: (page: number) => Promise<{ items: T[]; hasMore: boolean }>,
  deps: unknown[] = []
) {
  const [items, setItems]     = useState<T[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const pageRef               = useRef(0)
  const resetKey              = useRef(0)

  const load = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetcher(pageRef.current)
      setItems(prev => pageRef.current === 0 ? res.items : [...prev, ...res.items])
      setHasMore(res.hasMore)
      pageRef.current++
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, ...deps])

  const reset = useCallback(() => {
    pageRef.current = 0
    resetKey.current++
    setItems([])
    setHasMore(true)
  }, [])

  useEffect(() => { load() }, [load])

  return { items, hasMore, loading, loadMore: load, reset, resetKey: resetKey.current }
}

/* ── Componente ── */
export default function InfiniteScroll<T>({
  items,
  renderItem,
  onLoadMore,
  hasMore,
  threshold = '200px',
  endMessage = 'Nessun altro risultato',
  loader,
  className,
  resetKey,
}: InfiniteScrollProps<T>) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef  = useRef(false)

  // Reset loadingRef su resetKey change
  useEffect(() => { loadingRef.current = false }, [resetKey])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return

    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting || loadingRef.current) return
        loadingRef.current = true
        await onLoadMore()
        loadingRef.current = false
      },
      { rootMargin: threshold }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore, threshold, resetKey])

  return (
    <div className={className}>
      {items.map((item, i) => renderItem(item, i))}

      {/* Sentinel + loader */}
      {hasMore && (
        <div ref={sentinelRef}>
          {loader ?? <Spinner />}
        </div>
      )}

      {/* Fine lista */}
      {!hasMore && items.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 0', justifyContent: 'center',
        }}>
          <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
          <span style={{ fontSize: 10, color: 'var(--color-dim)', whiteSpace: 'nowrap' }}>
            {endMessage}
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
        </div>
      )}

      {/* Lista vuota */}
      {!hasMore && items.length === 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 11, color: 'var(--color-dim)' }}>
          {endMessage}
        </div>
      )}
    </div>
  )
}
