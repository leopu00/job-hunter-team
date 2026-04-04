'use client'

export type SkeletonVariant = 'card' | 'table' | 'profile' | 'chart' | 'text' | 'custom'

export interface SkeletonProps {
  variant?: SkeletonVariant
  /** Per variant='table': numero di righe */
  rows?: number
  /** Per variant='custom' o override */
  width?: number | string
  height?: number | string
  /** Bordo tondo */
  rounded?: boolean
  className?: string
}

/* ── Base shimmer block ── */
function Bone({ w, h, r = 6, style }: { w?: number|string; h?: number|string; r?: number; style?: React.CSSProperties }) {
  return (
    <div style={{
      width: w ?? '100%', height: h ?? 14, borderRadius: r,
      background: 'var(--color-row)',
      backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)',
      backgroundSize: '200% 100%',
      animation: 'skeleton-shimmer 1.6s ease-in-out infinite',
      flexShrink: 0,
      ...style,
    }} />
  )
}

/* ── Varianti ── */
function CardSkeleton() {
  return (
    <div style={{ padding: 16, borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-panel)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Bone w={40} h={40} r={8} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Bone h={13} w="65%" />
          <Bone h={10} w="40%" />
        </div>
        <Bone w={52} h={22} r={10} />
      </div>
      <Bone h={10} w="90%" />
      <Bone h={10} w="75%" />
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        {[52,44,60].map((w,i) => <Bone key={i} w={w} h={20} r={10} />)}
      </div>
    </div>
  )
}

function TableSkeleton({ rows = 5 }: { rows: number }) {
  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, padding: '10px 14px', background: 'var(--color-row)', borderBottom: '1px solid var(--color-border)' }}>
        <Bone w={16} h={16} r={4} style={{ flexShrink: 0 }} />
        {[120,90,80,60,50].map((w,i) => <Bone key={i} w={w} h={11} />)}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '9px 14px', borderBottom: i < rows-1 ? '1px solid var(--color-border)' : 'none', alignItems: 'center' }}>
          <Bone w={16} h={16} r={4} style={{ flexShrink: 0 }} />
          {[120,90,80,60,50].map((w,j) => <Bone key={j} w={w * (0.7 + Math.random() * 0.6)} h={10} />)}
        </div>
      ))}
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Bone w={72} h={72} r={36} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Bone h={16} w="50%" />
          <Bone h={11} w="35%" />
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            {[70,56,80].map((w,i) => <Bone key={i} w={w} h={22} r={10} />)}
          </div>
        </div>
        <Bone w={88} h={32} r={8} />
      </div>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Bone h={18} w="50%" />
            <Bone h={10} w="70%" />
          </div>
        ))}
      </div>
      {/* Bio lines */}
      {[100,85,90,60].map((w,i) => <Bone key={i} h={11} w={`${w}%`} />)}
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Titolo + legenda */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Bone h={14} w={120} />
        <div style={{ display: 'flex', gap: 8 }}>
          {[48,56,44].map((w,i) => <Bone key={i} w={w} h={11} />)}
        </div>
      </div>
      {/* Bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100, paddingTop: 8 }}>
        {[65,45,80,55,70,40,90,60,75,50,85,45].map((h,i) => (
          <Bone key={i} style={{ flex: 1 }} h={h} r={4} />
        ))}
      </div>
      {/* Asse x */}
      <div style={{ display: 'flex', gap: 8 }}>
        {Array.from({length:12}).map((_,i) => <Bone key={i} style={{ flex: 1 }} h={9} />)}
      </div>
    </div>
  )
}

/* ── Export principale ── */
export default function Skeleton({ variant = 'text', rows = 5, width, height, rounded, className }: SkeletonProps) {
  if (variant === 'card')    return <CardSkeleton />
  if (variant === 'table')   return <TableSkeleton rows={rows} />
  if (variant === 'profile') return <ProfileSkeleton />
  if (variant === 'chart')   return <ChartSkeleton />

  // 'text' | 'custom'
  return <Bone w={width ?? '100%'} h={height ?? 14} r={rounded ? 999 : 6} />
}

/* ── CSS keyframe (iniettato una sola volta) ── */
if (typeof document !== 'undefined' && !document.getElementById('skeleton-kf')) {
  const s = document.createElement('style')
  s.id = 'skeleton-kf'
  s.textContent = '@keyframes skeleton-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }'
  document.head.appendChild(s)
}
