'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Contact = { id: string; name: string; company: string; role: string; email: string; linkedin: string; notes: string; lastContact: number | null; createdAt: number }

function timeAgo(ts: number | null): string {
  if (!ts) return 'mai';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function ContactRow({ c, expanded, onToggle, onDelete }: { c: Contact; expanded: boolean; onToggle: () => void; onDelete: (id: string) => void }) {
  return (
    <div className="border-b border-[var(--color-border)]">
      <div role="button" tabIndex={0} aria-expanded={expanded} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-row)] transition-colors cursor-pointer" onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          {c.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--color-bright)] font-medium truncate">{c.name}</p>
          <p className="text-[9px] text-[var(--color-dim)]">{c.role} · {c.company}</p>
        </div>
        {c.email && <span className="text-[9px] text-[var(--color-dim)] truncate max-w-[150px]">{c.email}</span>}
        <span className="text-[9px] text-[var(--color-dim)] w-14 text-right">{timeAgo(c.lastContact)}</span>
      </div>
      {expanded && (
        <div className="px-5 pb-3 pl-16">
          {c.notes && <p className="text-[10px] text-[var(--color-muted)] mb-2">{c.notes}</p>}
          <div className="flex gap-3 items-center">
            {c.email && <span className="text-[9px] font-mono text-[var(--color-dim)]">{c.email}</span>}
            {c.linkedin && <span className="text-[9px] font-mono text-[var(--color-dim)]">{c.linkedin}</span>}
            <span className="text-[9px] text-[var(--color-dim)]">Aggiunto: {timeAgo(c.createdAt)}</span>
            <button onClick={e => { e.stopPropagation(); onDelete(c.id); }} className="text-[9px] font-bold cursor-pointer ml-auto" style={{ color: 'var(--color-red)' }}>elimina</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(t) }, [search])

  const fetchData = useCallback(async () => {
    const params = debouncedSearch ? `?q=${encodeURIComponent(debouncedSearch)}` : '';
    const res = await fetch(`/api/contacts${params}`).catch(() => null);
    if (!res?.ok) { setLoading(false); return; }
    const data = await res.json();
    setContacts(data.contacts ?? []); setTotal(data.total ?? 0);
    setLoading(false);
  }, [debouncedSearch])

  useEffect(() => { fetchData() }, [fetchData])

  const addContact = async () => {
    if (!newName.trim()) return;
    await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, company: newCompany, role: newRole, email: newEmail }) }).catch(() => null);
    setNewName(''); setNewCompany(''); setNewRole(''); setNewEmail(''); setAdding(false); fetchData();
  }

  const deleteContact = async (id: string) => {
    await fetch('/api/contacts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null);
    fetchData();
  }

  const inputStyle = { background: 'var(--color-deep)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' } as const;

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Contatti</span>
        </nav>
        <div className="flex items-center justify-between mt-3">
          <div><h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Contatti</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} contatti professionali</p></div>
          <button onClick={() => setAdding(!adding)} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>{adding ? 'Annulla' : '+ Nuovo'}</button>
        </div>
      </div>

      {adding && (
        <div className="mb-4 p-4 rounded-lg flex gap-2 items-end" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
          <div className="flex flex-col gap-0.5"><label htmlFor="contact-name" className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">NOME</label><input id="contact-name" value={newName} onChange={e => setNewName(e.target.value)} className="text-[10px] px-2 py-1.5 rounded w-32" style={inputStyle} /></div>
          <div className="flex flex-col gap-0.5"><label htmlFor="contact-company" className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">AZIENDA</label><input id="contact-company" value={newCompany} onChange={e => setNewCompany(e.target.value)} className="text-[10px] px-2 py-1.5 rounded w-28" style={inputStyle} /></div>
          <div className="flex flex-col gap-0.5"><label htmlFor="contact-role" className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">RUOLO</label><input id="contact-role" value={newRole} onChange={e => setNewRole(e.target.value)} className="text-[10px] px-2 py-1.5 rounded w-28" style={inputStyle} /></div>
          <div className="flex flex-col gap-0.5"><label htmlFor="contact-email" className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">EMAIL</label><input type="email" id="contact-email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="text-[10px] px-2 py-1.5 rounded w-36" style={inputStyle} /></div>
          <button onClick={addContact} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>Aggiungi</button>
        </div>
      )}

      <div className="mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca nome, azienda, ruolo..."
          aria-label="Cerca contatti" className="text-[10px] px-3 py-1.5 rounded w-56" style={inputStyle} />
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {loading
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Caricamento...</p></div>
          : contacts.length === 0
          ? <div className="py-12 text-center">
              <p className="text-[var(--color-dim)] text-[12px]">{search ? 'Nessun contatto corrisponde alla ricerca.' : 'Nessun contatto ancora.'}</p>
              {!search && <p className="text-[var(--color-dim)] text-[10px] mt-1">Usa il pulsante <span className="font-bold text-[var(--color-muted)]">+ Nuovo</span> per aggiungere il primo contatto.</p>}
            </div>
          : contacts.map(c => <ContactRow key={c.id} c={c} expanded={expandedId === c.id} onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)} onDelete={deleteContact} />)}
      </div>
    </div>
  )
}
