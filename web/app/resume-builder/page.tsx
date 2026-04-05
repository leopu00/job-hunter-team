'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type ResumeData = { personal: Record<string, string>; experience: Array<Record<string, string>>; education: Array<Record<string, string>>; skills: string[]; languages: Array<Record<string, string>> }

const PERSONAL_FIELDS = [
  { key: 'nome', label: 'Nome' }, { key: 'cognome', label: 'Cognome' }, { key: 'email', label: 'Email' },
  { key: 'telefono', label: 'Telefono' }, { key: 'citta', label: 'Città' }, { key: 'titolo', label: 'Titolo Professionale' },
];

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)] uppercase">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} className="text-[10px] px-2 py-1.5 rounded" style={{ background: 'var(--color-deep)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }} />
    </div>
  )
}

function SectionTitle({ title }: { title: string }) {
  return <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mt-4 mb-2 border-b border-[var(--color-border)] pb-1">{title}</p>;
}

export default function ResumeBuilderPage() {
  const [data, setData] = useState<ResumeData>({ personal: {}, experience: [], education: [], skills: [], languages: [] })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/resume').catch(() => null);
    if (!res?.ok) return;
    const d = await res.json();
    setData({ personal: d.personal ?? {}, experience: d.experience ?? [], education: d.education ?? [], skills: d.skills ?? [], languages: d.languages ?? [] });
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const save = async () => {
    setSaving(true);
    await fetch('/api/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => null);
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  const updatePersonal = (key: string, val: string) => setData(d => ({ ...d, personal: { ...d.personal, [key]: val } }));
  const updateSkills = (val: string) => setData(d => ({ ...d, skills: val.split(',').map(s => s.trim()).filter(Boolean) }));

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-6 pb-4 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Resume Builder</span>
        </nav>
        <div className="flex items-center justify-between mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Resume Builder</h1>
          <div className="flex gap-2">
            <button onClick={() => setTab(tab === 'edit' ? 'preview' : 'edit')} className="px-3 py-1 rounded text-[10px] font-semibold cursor-pointer" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>{tab === 'edit' ? 'Preview' : 'Modifica'}</button>
            <button onClick={save} disabled={saving} className="px-3 py-1 rounded text-[10px] font-bold cursor-pointer" style={{ background: saved ? 'var(--color-green)' : 'var(--color-row)', color: saved ? '#000' : 'var(--color-green)', border: '1px solid var(--color-green)40' }}>{saving ? 'Salvo...' : saved ? 'Salvato!' : 'Salva'}</button>
          </div>
        </div>
      </div>

      {tab === 'edit' ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] p-5">
          <SectionTitle title="Dati Personali" />
          <div className="grid grid-cols-3 gap-3">{PERSONAL_FIELDS.map(f => <Field key={f.key} label={f.label} value={data.personal[f.key] ?? ''} onChange={v => updatePersonal(f.key, v)} />)}</div>

          <SectionTitle title="Esperienza" />
          {data.experience.map((exp, i) => (
            <div key={i} className="flex gap-2 mb-2">{['azienda', 'ruolo', 'periodo'].map(k => <Field key={k} label={k} value={exp[k] ?? ''} onChange={v => { const e = [...data.experience]; e[i] = { ...e[i], [k]: v }; setData(d => ({ ...d, experience: e })); }} />)}</div>
          ))}

          <SectionTitle title="Formazione" />
          {data.education.map((edu, i) => (
            <div key={i} className="flex gap-2 mb-2">{['istituto', 'titolo', 'anno'].map(k => <Field key={k} label={k} value={edu[k] ?? ''} onChange={v => { const e = [...data.education]; e[i] = { ...e[i], [k]: v }; setData(d => ({ ...d, education: e })); }} />)}</div>
          ))}

          <SectionTitle title="Competenze" />
          <Field label="Competenze (virgola)" value={data.skills.join(', ')} onChange={updateSkills} />

          <SectionTitle title="Lingue" />
          {data.languages.map((lng, i) => (
            <div key={i} className="flex gap-2 mb-2">{['lingua', 'livello'].map(k => <Field key={k} label={k} value={lng[k] ?? ''} onChange={v => { const l = [...data.languages]; l[i] = { ...l[i], [k]: v }; setData(d => ({ ...d, languages: l })); }} />)}</div>
          ))}
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] p-6">
          <div className="text-center mb-4 pb-3 border-b border-[var(--color-border)]">
            <p className="text-[16px] font-bold text-[var(--color-white)]">{data.personal.nome} {data.personal.cognome}</p>
            <p className="text-[11px] text-[var(--color-green)] font-medium">{data.personal.titolo}</p>
            <p className="text-[9px] text-[var(--color-dim)] mt-1">{[data.personal.email, data.personal.telefono, data.personal.citta].filter(Boolean).join(' · ')}</p>
          </div>
          {data.experience.length > 0 && (<><p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mb-2">Esperienza</p>
            {data.experience.map((e, i) => <div key={i} className="mb-2"><p className="text-[11px] text-[var(--color-bright)] font-medium">{e.ruolo} — {e.azienda}</p><p className="text-[9px] text-[var(--color-dim)]">{e.periodo}</p>{e.descrizione && <p className="text-[9px] text-[var(--color-muted)] mt-0.5">{e.descrizione}</p>}</div>)}</>)}
          {data.education.length > 0 && (<><p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mt-3 mb-2">Formazione</p>
            {data.education.map((e, i) => <div key={i} className="mb-1"><p className="text-[11px] text-[var(--color-bright)]">{e.titolo} — {e.istituto}</p><p className="text-[9px] text-[var(--color-dim)]">{e.anno}</p></div>)}</>)}
          {data.skills.length > 0 && (<><p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mt-3 mb-2">Competenze</p>
            <div className="flex flex-wrap gap-1">{data.skills.map(s => <span key={s} className="text-[9px] px-2 py-0.5 rounded" style={{ color: 'var(--color-green)', border: '1px solid var(--color-green)30', background: 'rgba(0,200,83,0.08)' }}>{s}</span>)}</div></>)}
          {data.languages.length > 0 && (<><p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mt-3 mb-2">Lingue</p>
            {data.languages.map((l, i) => <span key={i} className="text-[10px] text-[var(--color-muted)] mr-3">{l.lingua}: {l.livello}</span>)}</>)}
          <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
            <button className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>Export PDF (coming soon)</button>
          </div>
        </div>
      )}
    </div>
  )
}
