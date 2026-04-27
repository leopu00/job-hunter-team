'use client'

import { useState } from 'react'

interface SyncTokenRow {
  id: string
  name: string
  token_prefix: string
  last_used_at: string | null
  created_at: string
}

interface CreateResponse {
  id: string
  name: string
  token_prefix: string
  created_at: string
  token: string
}

export default function CloudSyncClient({ initialTokens }: { initialTokens: SyncTokenRow[] }) {
  const [tokens, setTokens] = useState<SyncTokenRow[]>(initialTokens)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [freshToken, setFreshToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/cloud-sync/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Creazione fallita')
        return
      }
      const created = data as CreateResponse
      setFreshToken(created.token)
      setTokens([
        {
          id: created.id,
          name: created.name,
          token_prefix: created.token_prefix,
          last_used_at: null,
          created_at: created.created_at,
        },
        ...tokens,
      ])
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revocare definitivamente questo token?')) return
    setError(null)
    const res = await fetch(`/api/cloud-sync/tokens?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setTokens(tokens.filter((t) => t.id !== id))
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Revoca fallita')
    }
  }

  async function copyToken() {
    if (!freshToken) return
    await navigator.clipboard.writeText(freshToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen px-5 py-8 max-w-2xl mx-auto">
      <header className="mb-8">
        <h1 className="text-xl font-medium tracking-tight text-[var(--color-white)] mb-1">
          Cloud Sync <span className="text-[var(--color-green)]">Tokens</span>
        </h1>
        <p className="text-[var(--color-dim)] text-[11px]">
          Token per sincronizzare il tuo JHT locale o la CLI headless con il cloud.
        </p>
      </header>

      {freshToken && (
        <div className="mb-6 p-4 border border-[var(--color-green)] bg-[var(--color-card)]">
          <div className="text-[var(--color-green)] text-[11px] font-medium mb-2">
            Token creato — copialo ORA, non verrà piu&apos; mostrato
          </div>
          <div className="flex gap-2">
            <code className="flex-1 p-2 bg-[var(--color-bg)] text-[11px] text-[var(--color-bright)] font-mono break-all">
              {freshToken}
            </code>
            <button
              onClick={copyToken}
              className="px-3 py-2 border border-[var(--color-border)] text-[11px] text-[var(--color-bright)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors cursor-pointer"
            >
              {copied ? 'Copiato' : 'Copia'}
            </button>
          </div>
          <button
            onClick={() => setFreshToken(null)}
            className="mt-3 text-[10px] text-[var(--color-dim)] hover:text-[var(--color-bright)] cursor-pointer"
          >
            Ho copiato, chiudi
          </button>
        </div>
      )}

      <form onSubmit={handleCreate} className="mb-8">
        <label className="block text-[11px] text-[var(--color-dim)] mb-2">
          Nome dispositivo (es. &quot;MacBook Leone&quot;, &quot;Linux cron&quot;)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="MacBook Leone"
            className="flex-1 px-3 py-2 bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-bright)] text-[12px] focus:outline-none focus:border-[var(--color-green)]"
            maxLength={100}
            disabled={creating}
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-2 bg-[var(--color-card)] border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-bright)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? 'Creating…' : 'Generate token'}
          </button>
        </div>
      </form>

      {error && (
        <div
          className="mb-4 px-3 py-2 border border-[var(--color-red)] text-[11px]"
          style={{ color: 'var(--color-red)' }}
        >
          {error}
        </div>
      )}

      <section>
        <h2 className="text-[11px] uppercase text-[var(--color-dim)] tracking-wider mb-3">
          Active tokens ({tokens.length})
        </h2>
        {tokens.length === 0 ? (
          <div className="text-[var(--color-dim)] text-[11px] py-4">
            Nessun token attivo.
          </div>
        ) : (
          <ul className="space-y-2">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 p-3 border border-[var(--color-border)] bg-[var(--color-card)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-[var(--color-bright)] font-medium truncate">
                    {t.name}
                  </div>
                  <div className="text-[10px] text-[var(--color-dim)] font-mono mt-0.5">
                    {t.token_prefix}… · created {new Date(t.created_at).toLocaleDateString()}
                    {t.last_used_at && ` · last used ${new Date(t.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(t.id)}
                  className="px-3 py-1.5 border border-[var(--color-border)] text-[10px] text-[var(--color-dim)] hover:border-[var(--color-red)] hover:text-[var(--color-red)] transition-colors cursor-pointer"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
