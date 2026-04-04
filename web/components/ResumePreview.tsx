'use client'

import { useRef } from 'react'

export interface ExperienceEntry {
  company: string; role: string; startDate: string; endDate?: string
  description?: string; highlights?: string[]
}
export interface EducationEntry {
  institution: string; degree: string; field?: string
  startDate: string; endDate?: string; grade?: string
}
export interface LanguageEntry { language: string; level: string }

export interface ResumeData {
  name: string; title?: string; email?: string; phone?: string
  location?: string; website?: string; linkedin?: string
  summary?: string
  experience: ExperienceEntry[]
  education: EducationEntry[]
  skills: string[]
  languages: LanguageEntry[]
}

export interface ResumePreviewProps {
  data: ResumeData
  /** Mostra pulsante stampa */
  printable?: boolean
}

const S = {
  page:     { maxWidth: 794, margin: '0 auto', background: '#fff', color: '#111', fontFamily: 'Georgia, serif', fontSize: 11, lineHeight: 1.5, padding: '36px 48px', boxShadow: '0 2px 24px rgba(0,0,0,0.12)' } as React.CSSProperties,
  h1:       { fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: -0.5 } as React.CSSProperties,
  subtitle: { fontSize: 12, color: '#555', marginTop: 2 } as React.CSSProperties,
  contact:  { display: 'flex', flexWrap: 'wrap' as const, gap: '4px 16px', fontSize: 10, color: '#666', marginTop: 6 },
  divider:  { border: 'none', borderTop: '1.5px solid #222', margin: '14px 0 10px' } as React.CSSProperties,
  secTitle: { fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: '#333', margin: '0 0 8px' },
  section:  { marginBottom: 18 } as React.CSSProperties,
  row:      { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } as React.CSSProperties,
  bold:     { fontWeight: 700, fontSize: 11 } as React.CSSProperties,
  dim:      { fontSize: 10, color: '#666' } as React.CSSProperties,
  small:    { fontSize: 10, color: '#444', marginTop: 2 } as React.CSSProperties,
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={S.section}>
      <hr style={S.divider} />
      <p style={S.secTitle}>{title}</p>
      {children}
    </div>
  )
}

export default function ResumePreview({ data, printable = true }: ResumePreviewProps) {
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    const el = printRef.current
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return
    win.document.write(`<html><head><title>${data.name} — CV</title><style>
      body{margin:0;background:#fff} @page{size:A4;margin:15mm}
      @media print{body{margin:0}}
    </style></head><body>${el.outerHTML}</body></html>`)
    win.document.close()
    win.focus()
    win.print()
  }

  return (
    <div>
      {printable && (
        <div className="flex justify-end mb-3">
          <button onClick={handlePrint} className="px-4 py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all"
            style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
            🖨 Stampa / Salva PDF
          </button>
        </div>
      )}

      <div ref={printRef} style={S.page}>
        {/* Header */}
        <div>
          <h1 style={S.h1}>{data.name}</h1>
          {data.title && <p style={S.subtitle}>{data.title}</p>}
          <div style={S.contact}>
            {data.email    && <span>✉ {data.email}</span>}
            {data.phone    && <span>📞 {data.phone}</span>}
            {data.location && <span>📍 {data.location}</span>}
            {data.website  && <span>🌐 {data.website}</span>}
            {data.linkedin && <span>in {data.linkedin}</span>}
          </div>
        </div>

        {/* Summary */}
        {data.summary && (
          <Section title="Profilo">
            <p style={S.small}>{data.summary}</p>
          </Section>
        )}

        {/* Experience */}
        {data.experience.length > 0 && (
          <Section title="Esperienza">
            {data.experience.map((e, i) => (
              <div key={i} style={{ marginBottom: i < data.experience.length - 1 ? 12 : 0 }}>
                <div style={S.row}>
                  <span style={S.bold}>{e.role} — {e.company}</span>
                  <span style={S.dim}>{e.startDate} – {e.endDate ?? 'presente'}</span>
                </div>
                {e.description && <p style={{ ...S.small, marginTop: 3 }}>{e.description}</p>}
                {e.highlights && e.highlights.length > 0 && (
                  <ul style={{ margin: '3px 0 0', paddingLeft: 16 }}>
                    {e.highlights.map((h, j) => <li key={j} style={S.small}>{h}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </Section>
        )}

        {/* Education */}
        {data.education.length > 0 && (
          <Section title="Istruzione">
            {data.education.map((e, i) => (
              <div key={i} style={{ marginBottom: i < data.education.length - 1 ? 8 : 0 }}>
                <div style={S.row}>
                  <span style={S.bold}>{e.degree}{e.field ? `, ${e.field}` : ''}</span>
                  <span style={S.dim}>{e.startDate} – {e.endDate ?? 'presente'}</span>
                </div>
                <p style={S.dim}>{e.institution}{e.grade ? ` · ${e.grade}` : ''}</p>
              </div>
            ))}
          </Section>
        )}

        {/* Skills */}
        {data.skills.length > 0 && (
          <Section title="Competenze">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
              {data.skills.map((s, i) => (
                <span key={i} style={{ fontSize: 10, background: '#f0f0f0', borderRadius: 3, padding: '1px 6px', color: '#333' }}>{s}</span>
              ))}
            </div>
          </Section>
        )}

        {/* Languages */}
        {data.languages.length > 0 && (
          <Section title="Lingue">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px' }}>
              {data.languages.map((l, i) => (
                <span key={i} style={S.small}><strong>{l.language}</strong> — {l.level}</span>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
