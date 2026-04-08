'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'

/* ── i18n inline (standalone, no provider needed) ─────────────────── */

type Lang = 'it' | 'en'

function getLang(): Lang {
  if (typeof window === 'undefined') return 'it'
  return localStorage.getItem('jht-lang') === 'en' ? 'en' : 'it'
}

const T = {
  title:       { it: 'Benvenuto in Job Hunter Team', en: 'Welcome to Job Hunter Team' },
  skip:        { it: 'Salta',  en: 'Skip' },
  next:        { it: 'Avanti', en: 'Next' },
  back:        { it: 'Indietro', en: 'Back' },
  finish:      { it: 'Inizia a cercare', en: 'Start searching' },

  s1_title:    { it: 'Benvenuto', en: 'Welcome' },
  s1_desc:     { it: 'Job Hunter Team e il tuo team personale di agenti AI. Cercano offerte, le analizzano, scrivono CV e cover letter su misura — tutto in automatico, tutto sul tuo computer.', en: 'Job Hunter Team is your personal AI agent team. They find listings, analyze them, write tailored CVs and cover letters — all automatically, all on your computer.' },
  s1_hint:     { it: 'Configuriamo insieme il tuo spazio in 5 passi veloci.', en: 'Let\'s set up your workspace in 5 quick steps.' },

  s2_title:    { it: 'Configura il profilo', en: 'Set up your profile' },
  s2_desc:     { it: 'Indica il tuo nome, il ruolo che cerchi e un breve riassunto della tua esperienza.', en: 'Enter your name, the role you\'re looking for and a brief summary of your experience.' },
  s2_name:     { it: 'Nome', en: 'Name' },
  s2_role:     { it: 'Ruolo target', en: 'Target role' },
  s2_bio:      { it: 'Breve bio', en: 'Short bio' },

  s3_title:    { it: 'Scegli le competenze', en: 'Choose your skills' },
  s3_desc:     { it: 'Seleziona le tecnologie e competenze che conosci. Lo Scorer le usera\' per calcolare il match.', en: 'Select the technologies and skills you know. The Scorer will use them to compute the match.' },
  s3_hint:     { it: 'Clicca per selezionare, clicca di nuovo per deselezionare.', en: 'Click to select, click again to deselect.' },

  s4_title:    { it: 'Configura la API Key', en: 'Configure your API Key' },
  s4_desc:     { it: 'Gli agenti usano Claude (Anthropic) per ragionare. La chiave resta sul tuo computer.', en: 'Agents use Claude (Anthropic) to reason. The key stays on your computer.' },
  s4_hint:     { it: 'Ottienila su console.anthropic.com', en: 'Get it at console.anthropic.com' },

  s5_title:    { it: 'Avvia il primo agente', en: 'Launch your first agent' },
  s5_desc:     { it: 'Tutto pronto! Avvia lo Scout per iniziare a cercare offerte, oppure fallo dopo dalla pagina Team.', en: 'All set! Launch the Scout to start searching, or do it later from the Team page.' },
  s5_launch:   { it: 'Avvia Scout', en: 'Launch Scout' },
  s5_later:    { it: 'Lo faro\' dopo', en: 'I\'ll do it later' },
  s5_launched: { it: 'Scout avviato!', en: 'Scout launched!' },
} as const

/* ── Skills list ──────────────────────────────────────────────────── */

const SKILL_GROUPS: { group: string; items: string[] }[] = [
  { group: 'Frontend', items: ['React', 'Next.js', 'Vue', 'Angular', 'TypeScript', 'CSS/Tailwind', 'HTML'] },
  { group: 'Backend', items: ['Node.js', 'Python', 'Go', 'Java', 'Rust', 'C#/.NET', 'PHP'] },
  { group: 'Data', items: ['SQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Kafka'] },
  { group: 'DevOps', items: ['Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'CI/CD', 'Terraform'] },
  { group: 'Altro', items: ['Git', 'Linux', 'API REST', 'GraphQL', 'Machine Learning', 'Mobile'] },
]

/* ── Storage key ──────────────────────────────────────────────────── */

const STORAGE_KEY = 'jht-onboarding-done'

/* ── Component ────────────────────────────────────────────────────── */

export default function OnboardingWizard() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const [lang, setLangState] = useState<Lang>('it')

  // Form state
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [bio, setBio] = useState('')
  const [skills, setSkills] = useState<Set<string>>(new Set())
  const [apiKey, setApiKey] = useState('')
  const [scoutLaunched, setScoutLaunched] = useState(false)

  const t = useCallback((key: keyof typeof T) => T[key][lang], [lang])

  useEffect(() => {
    setLangState(getLang())
    const done = localStorage.getItem(STORAGE_KEY)
    if (!done) setVisible(true)
  }, [])

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }, [])

  const toggleSkill = (s: string) => {
    setSkills(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
  }

  const launchScout = async () => {
    try {
      await fetch('/api/team/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'scout' }) })
      setScoutLaunched(true)
    } catch { /* silently fail */ }
  }

  const saveProfile = async () => {
    if (!name.trim() && !role.trim()) return
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, bio, skills: [...skills] }),
      })
    } catch { /* silently fail */ }
  }

  const saveApiKey = async () => {
    if (!apiKey.trim()) return
    try {
      await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_provider: 'claude', providers: { claude: { auth_method: 'api_key', api_key: apiKey, model: 'claude-sonnet-4-6' } } }),
      })
    } catch { /* silently fail */ }
  }

  const next = async () => {
    if (step === 1) await saveProfile()
    if (step === 3) await saveApiKey()
    if (step < 4) setStep(s => s + 1)
    else dismiss()
  }

  const back = () => { if (step > 0) setStep(s => s - 1) }

  const dialogRef = useRef<HTMLDivElement>(null)

  // ESC + focus trap
  useEffect(() => {
    if (!visible || !dialogRef.current) return
    const el = dialogRef.current
    const sel = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(sel))
    focusables()[0]?.focus()
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { dismiss(); return }
      if (e.key !== 'Tab') return
      const fs = focusables()
      if (!fs.length) { e.preventDefault(); return }
      if (e.shiftKey) { if (document.activeElement === fs[0]) { e.preventDefault(); fs.at(-1)?.focus() } }
      else            { if (document.activeElement === fs.at(-1)) { e.preventDefault(); fs[0]?.focus() } }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [visible, step])

  if (!visible) return null

  const STEPS = [t('s1_title'), t('s2_title'), t('s3_title'), t('s4_title'), t('s5_title')]
  const inp = 'w-full px-3 py-2 rounded text-[11px] outline-none focus:border-[var(--color-green)] transition-colors'
  const inputStyle = { background: 'var(--color-panel)', color: 'var(--color-bright)', border: '1px solid var(--color-border)' }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('title')} className="w-full max-w-lg mx-4 rounded-xl overflow-hidden" style={{ background: 'var(--color-card, #0d0d11)', border: '1px solid var(--color-border)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)', animation: 'fade-in 0.3s ease both' }}>

        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[var(--color-border)]">
          <div className="flex items-center">
            <span className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--color-green)' }}>
              {t('s1_title') === 'Benvenuto' ? 'setup' : 'setup'}
            </span>
          </div>
          <button onClick={dismiss} className="text-[10px] cursor-pointer transition-colors" style={{ background: 'none', border: 'none', color: 'var(--color-dim)', fontFamily: 'inherit' }}>
            {t('skip')}
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center gap-1">
            {STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-1 flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-all"
                    style={{
                      background: i < step ? 'var(--color-green)' : i === step ? 'var(--color-white)' : 'var(--color-border)',
                      color: i <= step ? '#000' : 'var(--color-dim)',
                    }}>
                    {i < step ? '\u2713' : i + 1}
                  </div>
                  <span className="text-[7px] mt-1 text-center leading-tight hidden sm:block" style={{ color: i === step ? 'var(--color-bright)' : 'var(--color-dim)' }}>
                    {label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="h-px flex-1 mt-[-12px]" style={{ background: i < step ? 'var(--color-green)' : 'var(--color-border)' }} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 min-h-[280px]">

          {/* Step 1: Benvenuto */}
          {step === 0 && (
            <div className="text-center py-4">
              <span className="text-4xl mb-4 block">{'\uD83D\uDE80'}</span>
              <h2 className="text-lg font-bold text-[var(--color-white)] mb-3">{t('title')}</h2>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed max-w-sm mx-auto mb-3">
                {t('s1_desc')}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--color-green)' }}>
                {t('s1_hint')}
              </p>
            </div>
          )}

          {/* Step 2: Profilo */}
          {step === 1 && (
            <div>
              <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t('s2_title')}</h2>
              <p className="text-[10px] text-[var(--color-dim)] mb-5">{t('s2_desc')}</p>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[8px] font-bold tracking-widest uppercase" style={{ color: 'var(--color-dim)' }}>{t('s2_name')}</label>
                  <input value={name} onChange={e => setName(e.target.value)} className={inp} style={inputStyle} placeholder="Mario Rossi" autoComplete="name" required />
                </div>
                <div>
                  <label className="text-[8px] font-bold tracking-widest uppercase" style={{ color: 'var(--color-dim)' }}>{t('s2_role')}</label>
                  <input value={role} onChange={e => setRole(e.target.value)} className={inp} style={inputStyle} placeholder="Full Stack Developer" autoComplete="organization-title" />
                </div>
                <div>
                  <label className="text-[8px] font-bold tracking-widest uppercase" style={{ color: 'var(--color-dim)' }}>{t('s2_bio')}</label>
                  <textarea value={bio} onChange={e => setBio(e.target.value)} className={inp} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} placeholder="5 anni di esperienza in..." />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Competenze */}
          {step === 2 && (
            <div>
              <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t('s3_title')}</h2>
              <p className="text-[10px] text-[var(--color-dim)] mb-4">{t('s3_desc')}</p>
              <div className="flex flex-col gap-4 max-h-[200px] overflow-y-auto pr-1">
                {SKILL_GROUPS.map(g => (
                  <div key={g.group}>
                    <span className="text-[8px] font-bold tracking-widest uppercase" style={{ color: 'var(--color-dim)' }}>{g.group}</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {g.items.map(s => {
                        const active = skills.has(s)
                        return (
                          <button key={s} onClick={() => toggleSkill(s)} aria-pressed={active} className="px-2.5 py-1 rounded text-[10px] cursor-pointer transition-all"
                            style={{
                              background: active ? 'rgba(0,232,122,0.15)' : 'var(--color-panel)',
                              color: active ? 'var(--color-green)' : 'var(--color-muted)',
                              border: `1px solid ${active ? 'rgba(0,232,122,0.4)' : 'var(--color-border)'}`,
                              fontFamily: 'inherit',
                            }}>
                            {s}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] mt-3" style={{ color: 'var(--color-dim)' }}>{t('s3_hint')}</p>
            </div>
          )}

          {/* Step 4: API Key */}
          {step === 3 && (
            <div>
              <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-1">{t('s4_title')}</h2>
              <p className="text-[10px] text-[var(--color-dim)] mb-5">{t('s4_desc')}</p>
              <div>
                <label className="text-[8px] font-bold tracking-widest uppercase" style={{ color: 'var(--color-dim)' }}>API KEY</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className={inp} style={inputStyle} placeholder="sk-ant-..." autoComplete="off" />
                <p className="text-[9px] mt-2" style={{ color: 'var(--color-dim)' }}>
                  {t('s4_hint')}
                </p>
              </div>
              <div className="mt-4 p-3 rounded-lg" style={{ background: 'rgba(0,232,122,0.04)', border: '1px solid rgba(0,232,122,0.15)' }}>
                <p className="text-[9px] text-[var(--color-muted)] leading-relaxed">
                  {lang === 'it'
                    ? 'Non hai una chiave? Puoi saltare questo passaggio e configurarla dopo in Impostazioni.'
                    : 'Don\'t have a key? You can skip this step and configure it later in Settings.'}
                </p>
              </div>
            </div>
          )}

          {/* Step 5: Avvia agente */}
          {step === 4 && (
            <div className="text-center py-4">
              {scoutLaunched ? (
                <>
                  <span className="text-4xl mb-4 block">{'\u2705'}</span>
                  <h2 className="text-[14px] font-bold mb-2" style={{ color: 'var(--color-green)' }}>{t('s5_launched')}</h2>
                  <p className="text-[10px] text-[var(--color-muted)] leading-relaxed max-w-sm mx-auto">
                    {lang === 'it'
                      ? 'Lo Scout sta cercando offerte per te. Vai alla dashboard per seguire i risultati.'
                      : 'The Scout is searching listings for you. Go to the dashboard to follow results.'}
                  </p>
                </>
              ) : (
                <>
                  <span className="text-4xl mb-4 block">{'\uD83D\uDD75\uFE0F'}</span>
                  <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-2">{t('s5_title')}</h2>
                  <p className="text-[10px] text-[var(--color-muted)] leading-relaxed max-w-sm mx-auto mb-5">
                    {t('s5_desc')}
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <button onClick={launchScout} className="px-5 py-2 rounded text-[11px] font-bold cursor-pointer transition-all"
                      style={{ background: 'var(--color-green)', color: '#000', border: 'none', fontFamily: 'inherit' }}>
                      {t('s5_launch')}
                    </button>
                    <button onClick={() => setStep(5)} className="px-4 py-2 rounded text-[10px] cursor-pointer"
                      style={{ background: 'transparent', color: 'var(--color-dim)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}>
                      {t('s5_later')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="px-6 pb-5 flex items-center justify-between">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <div key={i} className="h-1 rounded-full transition-all"
                style={{
                  width: i === step ? 16 : 6,
                  background: i < step ? 'var(--color-green)' : i === step ? 'var(--color-green)' : 'var(--color-border)',
                  opacity: i <= step ? 1 : 0.4,
                }} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && step < 5 && (
              <button onClick={back} className="px-3 py-1.5 rounded text-[10px] cursor-pointer"
                style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-muted)', fontFamily: 'inherit' }}>
                {t('back')}
              </button>
            )}
            {step < 4 && (
              <button onClick={next} className="px-4 py-1.5 rounded text-[10px] font-bold cursor-pointer"
                style={{ background: 'var(--color-green)', border: 'none', color: '#000', fontFamily: 'inherit' }}>
                {t('next')}
              </button>
            )}
            {(step === 4 && scoutLaunched) || step === 5 ? (
              <button onClick={dismiss} className="px-4 py-1.5 rounded text-[10px] font-bold cursor-pointer"
                style={{ background: 'var(--color-green)', border: 'none', color: '#000', fontFamily: 'inherit' }}>
                {t('finish')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
