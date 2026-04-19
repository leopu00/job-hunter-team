'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

/* ── i18n inline ──────────────────────────────────────────────────── */

type Lang = 'it' | 'en'

function getLang(): Lang {
  if (typeof window === 'undefined') return 'it'
  return localStorage.getItem('jht-lang') === 'en' ? 'en' : 'it'
}

const T = {
  skip:   { it: 'Salta', en: 'Skip' },
  next:   { it: 'Avanti', en: 'Next' },
  back:   { it: 'Indietro', en: 'Back' },
  finish: { it: 'Ho capito', en: 'Got it' },
} as const

type StepDef = {
  selector: string | null
  title: { it: string; en: string }
  body:  { it: string; en: string }
}

const STEPS: StepDef[] = [
  {
    selector: null,
    title: { it: 'Benvenuto nella dashboard', en: 'Welcome to the dashboard' },
    body: {
      it: 'Il profilo è pronto. Da qui in poi pilotano gli agenti AI: facciamo un giro veloce delle pagine principali.',
      en: 'Your profile is ready. From here the AI agents take over — let\'s do a quick tour of the main pages.',
    },
  },
  {
    selector: '[data-tour="positions"]',
    title: { it: 'Positions', en: 'Positions' },
    body: {
      it: 'Tutte le offerte trovate dagli agenti. Le puoi filtrare, scartare o passare allo stato successivo.',
      en: 'Every listing the agents found. Filter, dismiss, or move them to the next stage.',
    },
  },
  {
    selector: '[data-tour="applications"]',
    title: { it: 'Applications', en: 'Applications' },
    body: {
      it: 'Le candidature che hai già inviato, con CV e cover letter generati su misura per ogni offerta.',
      en: 'The applications you\'ve sent, with CVs and cover letters tailored to each listing.',
    },
  },
  {
    selector: '[data-tour="team"]',
    title: { it: 'Team', en: 'Team' },
    body: {
      it: 'Qui avvii, fermi e controlli gli agenti: Scout, Analista, Scorer, Scrittore. Il resto è automatico.',
      en: 'Start, stop, and monitor the agents here: Scout, Analyst, Scorer, Writer. The rest is automatic.',
    },
  },
]

/* ── Component ────────────────────────────────────────────────────── */

type Rect = { top: number; left: number; width: number; height: number }

export default function OnboardingWizard() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const [lang, setLang] = useState<Lang>('it')
  const [rect, setRect] = useState<Rect | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const t = useCallback((k: keyof typeof T) => T[k][lang], [lang])

  useEffect(() => {
    setLang(getLang())
    let cancelled = false
    fetch('/api/preferences')
      .then(r => r.ok ? r.json() : null)
      .then(prefs => {
        if (cancelled) return
        if (!prefs?.ui_state?.tour_done) setVisible(true)
      })
      .catch(() => { /* API down → don't pester user with the tour */ })
    return () => { cancelled = true }
  }, [])

  const dismiss = useCallback(() => {
    setVisible(false)
    fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui_state: { tour_done: true } }),
    }).catch(() => {})
  }, [])

  // Measure current step target
  useEffect(() => {
    if (!visible) return
    const s = STEPS[step]
    if (!s.selector) { setRect(null); return }

    const measure = () => {
      const el = document.querySelector(s.selector!) as HTMLElement | null
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      // Chromium 128+ scala il BCR con il CSS zoom del body: senza compensazione
      // lo spotlight (anch'esso figlio body zoomato) viene ri-scalato → zoom².
      // `currentCSSZoom` è la property standard che restituisce il fattore
      // compound ereditato; dividendo otteniamo coordinate pre-zoom che il
      // body ri-scala esattamente una volta, e l'allineamento è corretto a
      // qualsiasi valore di --zoom. Fallback 1 per browser che non la supportano.
      const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1
      setRect({ top: r.top / z, left: r.left / z, width: r.width / z, height: r.height / z })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [visible, step])

  // Keyboard
  useEffect(() => {
    if (!visible) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') back()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  })

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1)
    else dismiss()
  }
  const back = () => { if (step > 0) setStep(s => s - 1) }

  if (!visible) return null
  if (typeof document === 'undefined') return null

  const s = STEPS[step]
  const title = s.title[lang]
  const body = s.body[lang]

  // Tooltip position: centered if no target, else below (or above if no room) the target
  const PAD = 8
  const TIP_W = 320
  const tipStyle: React.CSSProperties = (() => {
    if (!rect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    }
    const below = rect.top + rect.height + PAD
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const roomBelow = vh - below
    const top = roomBelow > 180 ? below : Math.max(PAD, rect.top - 180 - PAD)
    const centerX = rect.left + rect.width / 2
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
    const left = Math.min(Math.max(PAD, centerX - TIP_W / 2), vw - TIP_W - PAD)
    return { top, left }
  })()

  return createPortal(
    <div
      aria-hidden={false}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'auto',
      }}
    >
      {/* Backdrop with spotlight (or full dim if no target) */}
      {rect ? (
        <div
          style={{
            position: 'fixed',
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: 8,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
            border: '1px solid var(--color-green)',
            pointerEvents: 'none',
            transition: 'top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease',
          }}
        />
      ) : (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.72)',
            backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* Click-catcher so clicks outside tooltip don't hit the page */}
      <div
        onClick={dismiss}
        style={{ position: 'fixed', inset: 0, pointerEvents: rect ? 'none' : 'auto' }}
      />

      {/* Tooltip */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: 'fixed',
          width: TIP_W,
          padding: '16px 18px',
          borderRadius: 12,
          background: 'var(--color-card, #0d0d11)',
          border: '1px solid var(--color-green)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          color: 'var(--color-bright)',
          fontFamily: 'inherit',
          ...tipStyle,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--color-green)',
          }}>
            {step + 1} / {STEPS.length}
          </span>
          <button
            onClick={dismiss}
            style={{
              fontSize: 10, color: 'var(--color-dim)', background: 'none', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('skip')}
          </button>
        </div>

        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 6px', color: 'var(--color-white)' }}>
          {title}
        </h2>
        <p style={{ fontSize: 11, lineHeight: 1.55, margin: '0 0 14px', color: 'var(--color-muted)' }}>
          {body}
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button
            onClick={back}
            disabled={step === 0}
            style={{
              fontSize: 10, padding: '6px 12px', borderRadius: 6,
              background: 'transparent', border: '1px solid var(--color-border)',
              color: step === 0 ? 'var(--color-dim)' : 'var(--color-muted)',
              cursor: step === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('back')}
          </button>
          <button
            onClick={next}
            style={{
              fontSize: 10, fontWeight: 700, padding: '6px 14px', borderRadius: 6,
              background: 'var(--color-green)', border: 'none', color: '#000',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {step === STEPS.length - 1 ? t('finish') : t('next')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
