'use client'

import { useState, useTransition } from 'react'

type Action = 'pause' | 'snapshot-destroy' | 'terminate'

interface Props {
  // Mostrato solo quando il container gira su VPS. Il server component
  // padre (DashboardCompany) passa true sse `JHT_HOST_TYPE === 'vps'`.
  // In Local PC mode i 3 bottoni non hanno senso — niente "snapshot
  // Hetzner" della tua MacBook.
  visible: boolean
}

type Result =
  | { kind: 'idle' }
  | { kind: 'success'; action: Action; detail: string }
  | { kind: 'error'; action: Action; message: string }

const ACTION_META: Record<Action, { emoji: string; title: string; cost: string; resume: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  'pause': {
    emoji: '⏸️',
    title: 'Pausa team',
    cost: '€4.50/mo (continui a pagare la VPS)',
    resume: '5s, 1 click',
    tone: 'neutral',
  },
  'snapshot-destroy': {
    emoji: '📸',
    title: 'Snapshot + Elimina VPS',
    cost: '~€0.10/mo (solo storage snapshot)',
    resume: '~90s (ricrea VPS da snapshot)',
    tone: 'warn',
  },
  'terminate': {
    emoji: '💀',
    title: 'Termina VPS',
    cost: '€0',
    resume: 'from scratch (rifare wizard)',
    tone: 'danger',
  },
}

export default function VpsCompanycycleCard({ visible }: Props) {
  const [pending, startTransition] = useTransition()
  const [activeAction, setActiveAction] = useState<Action | null>(null)
  const [confirmFor, setConfirmFor] = useState<Action | null>(null)
  const [result, setResult] = useState<Result>({ kind: 'idle' })

  if (!visible) return null

  function callApi(action: Action, body?: unknown) {
    setActiveAction(action)
    setResult({ kind: 'idle' })
    startTransition(async () => {
      try {
        const res = await fetch(`/api/vps/${action}`, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        })
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok || json.ok === false) {
          throw new Error((json.error as string) || `HTTP ${res.status}`)
        }
        const detail =
          action === 'pause'
            ? `Container fermato (${json.container ?? 'jht'}). Riprendi con "jht up" o un nuovo deploy.`
            : action === 'snapshot-destroy'
            ? `Snapshot creato (image ${json.snapshotImageId ?? '?'}) e server eliminato. Fattura ferma.`
            : `Server eliminato. La VPS non e' piu' raggiungibile da questa pagina.`
        setResult({ kind: 'success', action, detail })
      } catch (e) {
        setResult({ kind: 'error', action, message: (e as Error).message })
      } finally {
        setActiveAction(null)
        setConfirmFor(null)
      }
    })
  }

  function onClick(action: Action) {
    if (action === 'pause') {
      // Pause e' reversibile in 5s, niente confirm step.
      callApi('pause')
      return
    }
    setConfirmFor(action)
  }

  function onConfirm(action: Action) {
    if (action === 'snapshot-destroy') callApi(action)
    if (action === 'terminate') callApi(action, { confirm: 'TERMINATE' })
  }

  return (
    <div className="mb-8" style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="section-label mb-4">🖥️ VPS — Companycycle</div>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        {(Object.keys(ACTION_META) as Action[]).map((action, i) => {
          const meta = ACTION_META[action]
          const isPending = pending && activeAction === action
          const isConfirming = confirmFor === action
          const tone =
            meta.tone === 'danger'
              ? 'var(--color-red)'
              : meta.tone === 'warn'
              ? 'var(--color-yellow)'
              : 'var(--color-blue)'
          return (
            <div
              key={action}
              className="flex items-start gap-4 p-4"
              style={{
                borderTop: i > 0 ? '1px solid var(--color-border)' : undefined,
                opacity: pending && !isPending ? 0.5 : 1,
              }}
            >
              <div
                className="text-2xl leading-none shrink-0 mt-0.5"
                aria-hidden
              >
                {meta.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-[var(--color-bright)] mb-1">
                  {meta.title}
                </div>
                <p className="text-[10px] text-[var(--color-muted)] m-0 leading-relaxed">
                  Costo dopo: <span style={{ color: tone }}>{meta.cost}</span>
                  {' · '}Riprendi: {meta.resume}
                </p>
                {isConfirming && (
                  <div
                    className="mt-3 p-3 rounded border text-[11px]"
                    style={{
                      borderColor: tone,
                      background: 'var(--color-panel)',
                      color: 'var(--color-bright)',
                    }}
                  >
                    {action === 'snapshot-destroy' ? (
                      <p className="m-0 mb-2">
                        Confermi snapshot + delete? Lo snapshot puo' impiegare 2-4 minuti, durante i quali
                        questa pagina restera' in attesa.
                      </p>
                    ) : (
                      <p className="m-0 mb-2">
                        Confermi distruzione del server? <strong>I dati locali sulla VPS verranno persi</strong>
                        . Il backup cloud (Supabase) resta intatto.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onConfirm(action)}
                        disabled={pending}
                        className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: tone,
                          color: 'var(--color-base)',
                          border: 'none',
                          cursor: pending ? 'wait' : 'pointer',
                        }}
                      >
                        Sì, procedi
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmFor(null)}
                        disabled={pending}
                        className="px-3 py-1.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                        style={{
                          background: 'transparent',
                          color: 'var(--color-muted)',
                          border: '1px solid var(--color-border)',
                          cursor: pending ? 'wait' : 'pointer',
                        }}
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onClick(action)}
                disabled={pending || isConfirming}
                className="px-3 py-2 rounded shrink-0 text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  background: isPending ? 'var(--color-border)' : 'var(--color-panel)',
                  color: tone,
                  border: `1px solid ${tone}`,
                  cursor: pending ? 'wait' : 'pointer',
                  minWidth: '90px',
                }}
              >
                {isPending ? '...' : meta.tone === 'danger' ? 'Termina' : meta.tone === 'warn' ? 'Snapshot' : 'Pausa'}
              </button>
            </div>
          )
        })}
      </div>

      {result.kind === 'success' && (
        <div
          className="mt-3 p-3 rounded border text-[11px]"
          style={{
            borderColor: 'var(--color-green)',
            background: 'rgba(0, 232, 122, 0.06)',
            color: 'var(--color-bright)',
          }}
        >
          <strong style={{ color: 'var(--color-green)' }}>{ACTION_META[result.action].emoji} OK:</strong>{' '}
          {result.detail}
        </div>
      )}
      {result.kind === 'error' && (
        <div
          className="mt-3 p-3 rounded border text-[11px]"
          style={{
            borderColor: 'var(--color-red)',
            background: 'rgba(255, 80, 80, 0.06)',
            color: 'var(--color-bright)',
          }}
        >
          <strong style={{ color: 'var(--color-red)' }}>Errore ({ACTION_META[result.action].title}):</strong>{' '}
          {result.message}
        </div>
      )}
    </div>
  )
}
