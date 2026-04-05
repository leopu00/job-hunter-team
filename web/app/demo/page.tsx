'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

/* ── Step data ────────────────────────────────────────────────────── */

type Step = {
  n: string
  titleKey: string
  descKey: string
  icon: () => React.ReactNode
  mockup: () => React.ReactNode
}

const STEPS: Step[] = [
  { n: '01', titleKey: 'demo_s0_title', descKey: 'demo_s0_desc', icon: TerminalIcon, mockup: TerminalMockup },
  { n: '02', titleKey: 'demo_s1_title', descKey: 'demo_s1_desc', icon: ProfileIcon, mockup: ProfileMockup },
  { n: '03', titleKey: 'demo_s2_title', descKey: 'demo_s2_desc', icon: TeamIcon, mockup: TeamMockup },
  { n: '04', titleKey: 'demo_s3_title', descKey: 'demo_s3_desc', icon: PipelineIcon, mockup: PipelineMockup },
  { n: '05', titleKey: 'demo_s4_title', descKey: 'demo_s4_desc', icon: DashIcon, mockup: DashMockup },
  { n: '06', titleKey: 'demo_s5_title', descKey: 'demo_s5_desc', icon: CheckIcon, mockup: ApproveMockup },
]

/* ── Componente principale ────────────────────────────────────────── */

function DemoContent() {
  const { t } = useLandingI18n()
  const [activeStep, setActiveStep] = useState(0)

  return (
    <>
      <LandingNav />
      <main style={{ position: 'relative', zIndex: 1 }} className="min-h-screen px-5 pt-28 pb-20">
        <div className="max-w-5xl mx-auto" style={{ animation: 'fade-in 0.5s ease both' }}>

          {/* Header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 rounded-full border border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
              <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">{t('demo_badge')}</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-[var(--color-white)] mb-3">
              {t('demo_title')}
            </h1>
            <p className="text-[12px] sm:text-[14px] text-[var(--color-muted)] leading-relaxed max-w-lg mx-auto">
              {t('demo_subtitle')}
            </p>
          </div>

          {/* Step selector (horizontal pills) */}
          <div className="flex flex-wrap justify-center gap-2 mb-10" role="tablist" aria-label="Passaggi demo">
            {STEPS.map((s, i) => (
              <button
                key={i}
                onClick={() => setActiveStep(i)}
                role="tab"
                aria-selected={i === activeStep}
                aria-controls={`demo-panel-${i}`}
                id={`demo-tab-${i}`}
                aria-label={`Passo ${s.n}: ${t(s.titleKey as any)}`}
                className="px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide transition-all"
                style={{
                  background: i === activeStep ? 'var(--color-green)' : 'var(--color-panel)',
                  color: i === activeStep ? '#000' : 'var(--color-muted)',
                  border: `1px solid ${i === activeStep ? 'var(--color-green)' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {s.n}
              </button>
            ))}
          </div>

          {/* Active step detail */}
          <div
            key={activeStep}
            role="tabpanel"
            id={`demo-panel-${activeStep}`}
            aria-labelledby={`demo-tab-${activeStep}`}
            className="grid md:grid-cols-2 gap-8 items-start"
            style={{ animation: 'fade-in 0.3s ease both' }}
          >
            {/* Left: description */}
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(0,232,122,0.08)', border: '1px solid rgba(0,232,122,0.2)' }}
                >
                  <span className="text-[var(--color-green)] text-[16px] font-bold">{STEPS[activeStep].n}</span>
                </div>
                <div>
                  <h2 className="text-[16px] sm:text-[18px] font-bold text-[var(--color-white)]">
                    {t(STEPS[activeStep].titleKey as any)}
                  </h2>
                </div>
              </div>

              <p className="text-[12px] sm:text-[13px] text-[var(--color-muted)] leading-relaxed mb-6">
                {t(STEPS[activeStep].descKey as any)}
              </p>

              {/* Step navigation */}
              <div className="flex items-center gap-3">
                {activeStep > 0 && (
                  <button
                    onClick={() => setActiveStep(activeStep - 1)}
                    aria-label={`Passo precedente: ${t(STEPS[activeStep - 1].titleKey as any)}`}
                    className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all"
                    style={{ background: 'var(--color-panel)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {'\u2190'} Precedente
                  </button>
                )}
                {activeStep < STEPS.length - 1 ? (
                  <button
                    onClick={() => setActiveStep(activeStep + 1)}
                    aria-label={`Passo successivo: ${t(STEPS[activeStep + 1].titleKey as any)}`}
                    className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all"
                    style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.25)', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Successivo {'\u2192'}
                  </button>
                ) : (
                  <Link
                    href="/download"
                    className="px-5 py-2 rounded-lg text-[12px] font-bold tracking-wide no-underline transition-all"
                    style={{ background: 'var(--color-green)', color: '#000' }}
                  >
                    {t('demo_cta')}
                  </Link>
                )}
              </div>
            </div>

            {/* Right: mockup */}
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)' }}
            >
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f44336', opacity: 0.6 }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ffc107', opacity: 0.6 }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#4caf50', opacity: 0.6 }} />
                <span className="ml-2 text-[9px] text-[var(--color-dim)]">{STEPS[activeStep].titleKey.replace('demo_s', 'step-').replace('_title', '')}</span>
              </div>
              <div className="p-4 sm:p-5 min-h-[220px]">
                {STEPS[activeStep].mockup()}
              </div>
            </div>
          </div>

          {/* All steps overview */}
          <div className="mt-20">
            <h3 className="text-[10px] font-semibold tracking-[0.25em] uppercase text-[var(--color-green)] mb-6 text-center">
              Tutti i passaggi
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {STEPS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setActiveStep(i); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  className="text-left p-4 rounded-xl transition-all"
                  style={{
                    background: i === activeStep ? 'rgba(0,232,122,0.05)' : 'var(--color-panel)',
                    border: `1px solid ${i === activeStep ? 'rgba(0,232,122,0.2)' : 'var(--color-border)'}`,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[12px] font-bold text-[var(--color-green)]">{s.n}</span>
                    <span className="text-[12px] font-semibold text-[var(--color-white)]">{t(s.titleKey as any)}</span>
                  </div>
                  <p className="text-[10px] text-[var(--color-dim)] leading-relaxed">{t(s.descKey as any)}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between">
            <Link href="/" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
              {'\u2190'} Home
            </Link>
            <Link href="/download" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
              Download {'\u2192'}
            </Link>
          </div>
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  )
}

export default function DemoPage() {
  return (
    <LandingI18nProvider>
      <DemoContent />
    </LandingI18nProvider>
  )
}

/* ── Mockup components ─────────────────────────────────────────────── */

function TerminalMockup() {
  const lines = [
    { c: 'var(--color-dim)', t: '$ tar -xzf job-hunter-team-0.1.0-mac.tar.gz' },
    { c: 'var(--color-dim)', t: '$ cd job-hunter-team' },
    { c: 'var(--color-dim)', t: '$ ./start.sh' },
    { c: 'var(--color-green)', t: '[ok] Node.js 22.x rilevato' },
    { c: 'var(--color-green)', t: '[ok] Dipendenze installate' },
    { c: 'var(--color-green)', t: '[ok] Build completata' },
    { c: 'var(--color-white)', t: '> Server attivo su http://localhost:3000' },
    { c: 'var(--color-green)', t: '> Browser aperto automaticamente' },
  ]
  return (
    <div className="font-mono text-[10px] sm:text-[11px] leading-relaxed space-y-1">
      {lines.map((l, i) => (
        <div key={i} style={{ color: l.c, animationDelay: `${i * 0.1}s` }} className="demo-line">{l.t}</div>
      ))}
    </div>
  )
}

function ProfileMockup() {
  const fields = [
    { label: 'Nome', value: 'Marco Rossi' },
    { label: 'Competenze', value: 'React, TypeScript, Node.js, Python' },
    { label: 'Zona', value: 'Milano / Remoto' },
    { label: 'Tipo', value: 'Full-time' },
    { label: 'Ruolo', value: 'Senior Frontend Developer' },
  ]
  return (
    <div className="space-y-3">
      {fields.map((f, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-[10px] font-semibold w-24 flex-shrink-0" style={{ color: 'var(--color-dim)' }}>{f.label}</span>
          <div className="flex-1 px-3 py-1.5 rounded-lg text-[11px]" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', color: 'var(--color-bright)' }}>
            {f.value}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
        <span className="text-[10px] text-[var(--color-green)]">Profilo completo</span>
      </div>
    </div>
  )
}

function TeamMockup() {
  const agents = [
    { emoji: '\u{1F468}\u200D\u2708\uFE0F', name: 'Alfa', color: '#ff9100', status: 'online' },
    { emoji: '\uD83D\uDD75\uFE0F', name: 'Scout', color: '#2196f3', status: 'online' },
    { emoji: '\u{1F468}\u200D\uD83D\uDD2C', name: 'Analista', color: '#00e676', status: 'online' },
    { emoji: '\u{1F468}\u200D\uD83D\uDCBB', name: 'Scorer', color: '#b388ff', status: 'avvio...' },
    { emoji: '\u{1F468}\u200D\uD83C\uDFEB', name: 'Scrittore', color: '#ffd600', status: 'avvio...' },
    { emoji: '\u{1F468}\u200D\u2696\uFE0F', name: 'Critico', color: '#f44336', status: 'offline' },
  ]
  return (
    <div className="grid grid-cols-3 gap-2">
      {agents.map((a, i) => (
        <div key={i} className="text-center p-2 rounded-lg" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
          <div className="text-lg mb-1">{a.emoji}</div>
          <div className="text-[9px] font-bold" style={{ color: a.color }}>{a.name}</div>
          <div className="flex justify-center mt-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.status === 'online' ? '#22c55e' : a.status === 'avvio...' ? '#f59e0b' : 'rgba(255,255,255,0.15)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function PipelineMockup() {
  const steps = [
    { agent: 'Scout', msg: '47 offerte trovate', color: '#2196f3' },
    { agent: 'Analista', msg: '12 rilevanti per il profilo', color: '#00e676' },
    { agent: 'Scorer', msg: 'Top match: 94% - Frontend Dev @Stripe', color: '#b388ff' },
    { agent: 'Scrittore', msg: 'CV e cover letter generati', color: '#ffd600' },
    { agent: 'Critico', msg: 'Revisione completata \u2713', color: '#f44336' },
  ]
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
          <span className="text-[10px] font-bold flex-shrink-0 w-16" style={{ color: s.color }}>{s.agent}</span>
          <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{s.msg}</span>
        </div>
      ))}
    </div>
  )
}

function DashMockup() {
  const rows = [
    { title: 'Frontend Developer', company: 'Stripe', score: '94%', status: 'pronto' },
    { title: 'React Engineer', company: 'Vercel', score: '91%', status: 'pronto' },
    { title: 'Full Stack Dev', company: 'Linear', score: '87%', status: 'in review' },
  ]
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 text-[9px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-dim)' }}>
        <span className="flex-1">Posizione</span>
        <span className="w-12 text-center">Match</span>
        <span className="w-16 text-center">Stato</span>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-[var(--color-white)] truncate">{r.title}</div>
              <div className="text-[9px] text-[var(--color-dim)]">{r.company}</div>
            </div>
            <span className="text-[11px] font-bold w-12 text-center" style={{ color: 'var(--color-green)' }}>{r.score}</span>
            <span
              className="text-[9px] font-semibold w-16 text-center px-2 py-0.5 rounded"
              style={{
                background: r.status === 'pronto' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                color: r.status === 'pronto' ? '#22c55e' : '#f59e0b',
              }}
            >
              {r.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ApproveMockup() {
  return (
    <div className="space-y-3">
      <div className="p-3 rounded-lg" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-[var(--color-white)]">Frontend Developer @ Stripe</span>
          <span className="text-[10px] font-bold text-[var(--color-green)]">94%</span>
        </div>
        <div className="flex gap-2 mb-2">
          <span className="text-[9px] px-2 py-0.5 rounded" style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.2)' }}>CV pronto</span>
          <span className="text-[9px] px-2 py-0.5 rounded" style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.2)' }}>Cover letter</span>
          <span className="text-[9px] px-2 py-0.5 rounded" style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.2)' }}>Critico: OK</span>
        </div>
        <div className="text-[10px] text-[var(--color-dim)] mb-3">
          Revisione completata dal Critico. Nessun problema trovato. Pronto per l'invio.
        </div>
        <div className="flex gap-2">
          <div className="flex-1 text-center py-1.5 rounded-lg text-[11px] font-bold" style={{ background: 'var(--color-green)', color: '#000' }}>
            {'\u2713'} Approva
          </div>
          <div className="px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
            Modifica
          </div>
          <div className="px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-dim)' }}>
            Scarta
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Icons ─────────────────────────────────────────────────────────── */

function TerminalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function TeamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function PipelineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function DashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}
