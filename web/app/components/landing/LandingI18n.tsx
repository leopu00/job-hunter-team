'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Lang = 'it' | 'en'

const translations = {
  // Nav
  nav_features:      { it: 'Features',        en: 'Features' },
  nav_how:           { it: 'Come funziona',    en: 'How it works' },
  nav_github:        { it: 'GitHub',           en: 'GitHub' },
  nav_download:      { it: 'Download',         en: 'Download' },
  nav_login:         { it: 'Accedi',           en: 'Sign in' },

  // Hero
  hero_badge:        { it: 'beta pubblica',    en: 'public beta' },
  hero_title_1:      { it: 'Il tuo team di agenti AI', en: 'Your AI agent team' },
  hero_title_2:      { it: 'per trovare lavoro',       en: 'to land your next job' },
  hero_desc:         {
    it: 'Un sistema multi-agente che automatizza ogni fase della ricerca: dalla scansione delle offerte alla candidatura personalizzata. Tu decidi la strategia, gli agenti eseguono.',
    en: 'A multi-agent system that automates every step of your job search: from scanning listings to personalized applications. You set the strategy, the agents execute.',
  },
  hero_cta:          { it: 'Inizia gratis',            en: 'Start for free' },
  hero_cta2:         { it: 'Scopri come funziona',     en: 'See how it works' },

  // Features
  feat_label:        { it: 'capabilities',     en: 'capabilities' },
  feat_title_1:      { it: 'Tutto ciò che serve,',     en: 'Everything you need,' },
  feat_title_2:      { it: 'niente di superfluo',      en: 'nothing you don\'t' },
  feat_0_title:      { it: 'Team Multi-Agente',        en: 'Multi-Agent Team' },
  feat_0_desc:       {
    it: '7 agenti AI specializzati — Scout, Analista, Scorer, Scrittore, Critico, Sentinella e Capitano — che collaborano come un vero team.',
    en: '7 specialized AI agents — Scout, Analyst, Scorer, Writer, Critic, Sentinel and Captain — working together as a real team.',
  },
  feat_1_title:      { it: 'Scansione Continua',       en: 'Continuous Scanning' },
  feat_1_desc:       {
    it: 'Monitoring automatico di job board, LinkedIn e canali dedicati. Non perdere mai un\'opportunità rilevante.',
    en: 'Automatic monitoring of job boards, LinkedIn and dedicated channels. Never miss a relevant opportunity.',
  },
  feat_2_title:      { it: 'Candidature Smart',        en: 'Smart Applications' },
  feat_2_desc:       {
    it: 'CV e cover letter personalizzate per ogni posizione, ottimizzate per i sistemi ATS e per il recruiter.',
    en: 'Tailored CVs and cover letters for each position, optimized for ATS systems and recruiters.',
  },
  feat_3_title:      { it: 'Scoring Intelligente',     en: 'Intelligent Scoring' },
  feat_3_desc:       {
    it: 'Ogni offerta viene analizzata e valutata in base al tuo profilo, competenze e preferenze. Focus su ciò che conta.',
    en: 'Every listing is analyzed and scored based on your profile, skills and preferences. Focus on what matters.',
  },
  feat_4_title:      { it: 'Dashboard Real-Time',      en: 'Real-Time Dashboard' },
  feat_4_desc:       {
    it: 'Metriche, analytics e stato di ogni candidatura. Tutto in una vista: token, costi, latenza, pipeline completa.',
    en: 'Metrics, analytics and status of every application. All in one view: tokens, costs, latency, full pipeline.',
  },
  feat_5_title:      { it: 'Tu al Comando',            en: 'You\'re in Control' },
  feat_5_desc:       {
    it: 'Gli agenti propongono, tu decidi. Ogni candidatura richiede la tua approvazione prima dell\'invio.',
    en: 'Agents propose, you decide. Every application requires your approval before submission.',
  },

  // Steps
  steps_label:       { it: 'workflow',         en: 'workflow' },
  steps_title:       { it: 'Come funziona',    en: 'How it works' },
  step_0_title:      { it: 'Configura',        en: 'Configure' },
  step_0_desc:       {
    it: 'Imposta il tuo profilo, le competenze, il ruolo desiderato e i criteri di ricerca. Gli agenti si calibrano su di te.',
    en: 'Set up your profile, skills, desired role and search criteria. The agents calibrate to you.',
  },
  step_1_title:      { it: 'Gli agenti lavorano',      en: 'Agents get to work' },
  step_1_desc:       {
    it: 'Il team scansiona offerte, analizza requisiti, calcola match score e prepara candidature personalizzate.',
    en: 'The team scans listings, analyzes requirements, computes match scores and prepares personalized applications.',
  },
  step_2_title:      { it: 'Tu decidi',                en: 'You decide' },
  step_2_desc:       {
    it: 'Revisiona le candidature pronte nella dashboard. Approva, modifica o scarta. Sempre tu al comando.',
    en: 'Review ready applications in the dashboard. Approve, edit or discard. Always in control.',
  },

  // CTA
  cta_title_1:       { it: 'Pronto a rivoluzionare',           en: 'Ready to revolutionize' },
  cta_title_2:       { it: 'la tua ricerca lavoro?',           en: 'your job search?' },
  cta_desc:          {
    it: 'Smetti di inviare candidature generiche. Lascia che un team di agenti AI lavori per te, in modo intelligente e personalizzato.',
    en: 'Stop sending generic applications. Let a team of AI agents work for you, smart and personalized.',
  },
  cta_button:        { it: 'Inizia ora — è gratis',            en: 'Start now — it\'s free' },
  cta_note:          { it: 'Nessuna carta di credito richiesta · Beta pubblica', en: 'No credit card required · Public beta' },

  // Footer
  footer_jht:        { it: 'Job Hunter Team',  en: 'Job Hunter Team' },
} as const

type TranslationKey = keyof typeof translations

interface I18nCtx {
  lang: Lang
  toggle: () => void
  t: (key: TranslationKey) => string
}

const LandingI18nContext = createContext<I18nCtx>({
  lang: 'it',
  toggle: () => {},
  t: (key) => translations[key].it,
})

export function useLandingI18n() {
  return useContext(LandingI18nContext)
}

export function LandingI18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('it')

  const toggle = useCallback(() => {
    setLang(prev => prev === 'it' ? 'en' : 'it')
  }, [])

  const t = useCallback((key: TranslationKey) => {
    return translations[key][lang]
  }, [lang])

  return (
    <LandingI18nContext.Provider value={{ lang, toggle, t }}>
      {children}
    </LandingI18nContext.Provider>
  )
}
