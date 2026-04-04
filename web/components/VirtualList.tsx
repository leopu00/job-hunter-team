'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface VirtualListProps<T> {
  items: T[]
  /** Altezza fissa di ogni riga in px */
  itemHeight: number
  /** Altezza contenitore scroll in px */
  height: number
  renderItem: (item: T, index: number) => React.ReactNode
  /** Quanti items extra renderizzare sopra/sotto viewport (default 3) */
  overscan?: number
  /** Callback quando si avvicina al fondo — integrabile con InfiniteScroll */
  onEndReached?: () => void
  /** Distanza dal fondo (in items) per triggerare onEndReached (default 5) */
  endReachedThreshold?: number
  className?: string
}

export default function VirtualList<T>({
  items,
  itemHeight,
  height,
  renderItem,
  overscan = 3,
  onEndReached,
  endReachedThreshold = 5,
  className,
}: VirtualListProps<T>) {
  const containerRef    = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const endCalledRef    = useRef(false)
  const lastItemCount   = useRef(items.length)

  // Reset end-reached flag quando arrivano nuovi items
  useEffect(() => {
    if (items.length > lastItemCount.current) endCalledRef.current = false
    lastItemCount.current = items.length
  }, [items.length])

  const totalHeight = items.length * itemHeight

  // Calcola finestra visibile
  const firstVisible = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2
  const lastVisible  = Math.min(items.length - 1, firstVisible + visibleCount)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setScrollTop(el.scrollTop)

    // onEndReached
    if (onEndReached && !endCalledRef.current) {
      const bottomIndex = Math.floor((el.scrollTop + height) / itemHeight)
      if (bottomIndex >= items.length - endReachedThreshold) {
        endCalledRef.current = true
        onEndReached()
      }
    }
  }, [height, itemHeight, items.length, onEndReached, endReachedThreshold])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Espone scrollToIndex
  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    containerRef.current?.scrollTo({ top: index * itemHeight, behavior })
  }, [itemHeight])

  // Espone tramite ref imperativo
  useEffect(() => {
    ;(containerRef.current as HTMLDivElement & { scrollToIndex?: typeof scrollToIndex })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      && ((containerRef.current as any).scrollToIndex = scrollToIndex)
  }, [scrollToIndex])

  const visibleItems = []
  for (let i = firstVisible; i <= lastVisible; i++) {
    visibleItems.push(
      <div key={i} style={{ position: 'absolute', top: i * itemHeight, left: 0, right: 0, height: itemHeight }}>
        {renderItem(items[i], i)}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height, overflowY: 'auto', position: 'relative', willChange: 'scroll-position' }}
    >
      {/* Spacer totale per scroll corretto */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems}
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--color-dim)' }}>
          Nessun elemento
        </div>
      )}
    </div>
  )
}

/* ── Hook useVirtualList ── */
export function useVirtualList<T>(allItems: T[], filterFn?: (item: T) => boolean) {
  const filtered = filterFn ? allItems.filter(filterFn) : allItems

  const scrollToItem = useCallback((containerEl: HTMLElement & { scrollToIndex?: (i: number) => void }, index: number) => {
    containerEl.scrollToIndex?.(index)
  }, [])

  return { items: filtered, count: filtered.length, scrollToItem }
}
