'use client'

import { Modal } from './Modal'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  loading?: boolean
}

export function ConfirmDialog({
  open, onClose, onConfirm,
  title = 'Conferma',
  message,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  danger = false,
  loading = false,
}: Props) {
  const confirmColor   = danger ? 'var(--color-red)'    : 'var(--color-green)'
  const confirmBorder  = danger ? 'rgba(255,69,96,0.4)' : 'rgba(0,232,122,0.4)'
  const confirmBg      = danger ? 'rgba(255,69,96,0.08)': 'rgba(0,232,122,0.08)'

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="flex flex-col gap-5">
        {danger && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded border text-[11px]"
            style={{ borderColor: 'rgba(255,69,96,0.25)', background: 'rgba(255,69,96,0.05)', color: 'var(--color-red)' }}>
            ⚠ Questa azione è irreversibile
          </div>
        )}
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 rounded-lg text-[11px] font-semibold cursor-pointer transition-all disabled:opacity-40"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-muted)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="px-4 py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all disabled:opacity-40"
            style={{ border: `1px solid ${confirmBorder}`, color: confirmColor, background: confirmBg }}>
            {loading ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
