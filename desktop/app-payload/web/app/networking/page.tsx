'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Contact = { id: string; name: string; company: string; role: string; lastContact: number | null }
type CompanyNetwork = { company: string; contacts: Contact[]; hasApplication: boolean; openPositions: number }
type Suggestion = { action: string; target: string; reason: string; priority: string }
type Interaction = { contactName: string; company: string; type: string; date: number }

const PRIO_CLR: Record<string, string> = { high: 'var(--color-red)', medium: 'var(--color-yellow)', low: 'var(--color-dim)' }

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function CompanyCard({ n }: { n: CompanyNetwork }) {
  return (
    <div className="p-3 rounded-lg" style={{ background: 'var(--color-row)', border: `1px solid ${n.hasApplication ? 'var(--color-green)' : 'var(--color-border)'}40` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-[var(--color-bright)] font-medium">{n.company}</span>
        <div className="flex gap-1">
          {n.hasApplication && <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ color: 'var(--color-green)', border: '1px solid var(--color-green)30' }}>candidatura</span>}
          {n.openPositions > 0 && <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ color: 'var(--color-yellow)', border: '1px solid var(--color-yellow)30' }}>{n.openPositions} pos.</span>}
        </div>
      </div>
      {n.contacts.length > 0 ? n.contacts.map(c => (
        <div key={c.id} className="flex items-center gap-2 ml-2 mb-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.lastContact && Date.now() - c.lastContact < 7 * 86400000 ? 'var(--color-green)' : 'var(--color-dim)' }} />
          <span className="text-[9px] text-[var(--color-muted)]">{c.name}</span>
          <span className="text-[8px] text-[var(--color-dim)]">{c.role}</span>
        </div>
      )) : <p className="text-[9px] text-[var(--color-dim)] ml-2">Nessun contatto</p>}
    </div>
  )
}

export default function NetworkingPage() {
  const [network, setNetwork] = useState<CompanyNetwork[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [companiesWithContacts, setCompaniesWithContacts] = useState(0)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/networking').catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setNetwork(data.network ?? []); setSuggestions(data.suggestions ?? []); setInteractions(data.interactions ?? []);
    setTotalContacts(data.totalContacts ?? 0); setCompaniesWithContacts(data.companiesWithContacts ?? 0);
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Networking</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Networking</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{totalContacts} contatti · {companiesWithContacts} aziende con contatti · {network.length} aziende totali</p>
      </div>

      {suggestions.length > 0 && (
        <div className="mb-6">
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mb-2">Suggerimenti</p>
          <div className="flex flex-col gap-1">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2 rounded" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIO_CLR[s.priority] ?? 'var(--color-dim)' }} />
                <span className="text-[10px] font-semibold" style={{ color: PRIO_CLR[s.priority] ?? 'var(--color-dim)' }}>{s.action}</span>
                <span className="text-[10px] text-[var(--color-bright)]">{s.target}</span>
                <span className="text-[9px] text-[var(--color-dim)] flex-1 truncate">{s.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mb-2">Mappa Contatti per Azienda</p>
          <div className="flex flex-col gap-2">
            {network.map((n, i) => <div key={n.company} style={{ animation: `fade-in 0.4s ease ${i * 0.08}s both` }}><CompanyCard n={n} /></div>)}
          </div>
        </div>
        <div>
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mb-2">Interazioni Recenti</p>
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
            {interactions.length === 0
              ? <div className="py-8 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna interazione.</p></div>
              : interactions.map((int, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)]">
                  <span className="text-[10px] text-[var(--color-bright)]">{int.contactName}</span>
                  <span className="text-[9px] text-[var(--color-dim)]">{int.company}</span>
                  <span className="text-[9px] text-[var(--color-dim)] ml-auto">{timeAgo(int.date)}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
