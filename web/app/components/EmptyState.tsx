'use client'

type Props = {
  icon?: string
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  size?: 'sm' | 'md' | 'lg'
}

export function EmptyState({ icon, title, description, action, size = 'md' }: Props) {
  const py = size === 'sm' ? 'py-8' : size === 'lg' ? 'py-20' : 'py-14'
  const iconSize = size === 'sm' ? 'text-2xl' : size === 'lg' ? 'text-5xl' : 'text-4xl'
  const titleSize = size === 'sm' ? 'text-[12px]' : 'text-[14px]'

  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${py}`}>
      {icon && <span className={`${iconSize} opacity-40`}>{icon}</span>}
      <div className="flex flex-col gap-1">
        <p className={`${titleSize} font-semibold`} style={{ color: 'var(--color-muted)' }}>{title}</p>
        {description && <p className="text-[11px]" style={{ color: 'var(--color-dim)' }}>{description}</p>}
      </div>
      {action && (
        <button onClick={action.onClick}
          className="mt-1 px-4 py-2 rounded-lg text-[11px] font-semibold cursor-pointer transition-all"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-green)'; e.currentTarget.style.color = 'var(--color-green)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-muted)' }}>
          {action.label}
        </button>
      )}
    </div>
  )
}
