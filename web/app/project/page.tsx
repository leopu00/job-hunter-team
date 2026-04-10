'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import ScrollToTop from '../components/landing/ScrollToTop'

const T = {
  it: {
    title: 'Panoramica del progetto',
    subtitle: 'Un team di agenti AI che cerca lavoro per te.',
    back: '← Indietro',
    open_source: 'open source',
    repo_cta: 'Repository',
    story_title: 'Storia e obiettivo',
    story_body_1:
      'Job Hunter Team nasce come progetto open source per automatizzare la ricerca di lavoro con una pipeline di agenti AI specializzati, eseguita in locale e controllata dall\'utente.',
    story_body_2:
      'L\'obiettivo è costruire uno strumento accessibile a tutti: chi preferisce semplicità può scaricare il launcher desktop e usare l\'interfaccia web, mentre chi ha competenze tecniche può clonare la repository o utilizzare la TUI per un controllo avanzato.',
    story_body_3:
      'Il progetto è interamente gratuito e senza costi nascosti: se usi un provider AI esterno pagherai solo il tuo consumo, ma puoi anche utilizzare modelli locali gratuitamente. Le contribuzioni degli sviluppatori sono benvenute per migliorare insieme uno strumento che usa l\'intelligenza artificiale a favore dei lavoratori, non contro.'
  },
  en: {
    title: 'Project overview',
    subtitle: 'An AI agent team that finds jobs for you.',
    back: '← Back',
    open_source: 'open source',
    repo_cta: 'Repository',
    story_title: 'History and goal',
    story_body_1:
      'Job Hunter Team started as an open source project to automate job hunting through a pipeline of specialized AI agents, running locally and controlled by the user.',
    story_body_2:
      'The goal is to build a tool accessible to everyone: those who prefer simplicity can download the desktop launcher and use the web interface, while technical users can clone the repository or use the TUI for advanced control.',
    story_body_3:
      'The project is entirely free with no hidden costs: if you use an external AI provider you only pay for your usage, but you can also use local models for free. Developer contributions are welcome to improve together a tool that uses artificial intelligence in favor of workers, not against them.'
  },
} as const

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="w-4 h-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49C4 14.09 3.48 13.22 3.32 12.77c-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function BackLink({ label }: { label: string }) {
  const router = useRouter()
  
  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push('/')
    }
  }

  return (
    <button
      onClick={handleBack}
      className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors cursor-pointer bg-transparent border-0"
    >
      {label}
    </button>
  )
}

function ProjectContent() {
  const { lang } = useLandingI18n()
  const t = T[lang as 'it' | 'en'] ?? T.it

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: t.title,
            description: t.subtitle,
            isPartOf: { '@type': 'WebSite', name: 'Job Hunter Team', url: 'https://jobhunterteam.ai' },
          }),
        }}
      />
      <LandingNav />
      <main className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto" style={{ animation: 'fade-in 0.4s ease both' }}>
        <div className="text-center mb-12">
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight mb-3">{t.title}</h1>
          <p className="text-[13px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed">{t.subtitle}</p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
              <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">{t.open_source}</span>
            </div>
            <a
              href="https://github.com/leopu00/job-hunter-team"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-[11px] font-bold tracking-wide no-underline transition-all hover:opacity-90"
              style={{ background: 'var(--color-green)', color: '#060608' }}
            >
              <GitHubIcon />
              <span>{t.repo_cta}</span>
            </a>
          </div>
        </div>

        <section className="p-6 border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
          <h2 className="text-[15px] font-bold text-[var(--color-white)] mb-4">{t.story_title}</h2>
          <div className="flex flex-col gap-4">
            <p className="text-[12px] md:text-[13px] text-[var(--color-base)] leading-relaxed">{t.story_body_1}</p>
            <p className="text-[12px] md:text-[13px] text-[var(--color-base)] leading-relaxed">{t.story_body_2}</p>
            <p className="text-[12px] md:text-[13px] text-[var(--color-base)] leading-relaxed">{t.story_body_3}</p>
          </div>
        </section>

        <div className="mt-8 flex justify-center">
          <BackLink label={t.back} />
        </div>
      </main>
      <ScrollToTop />
    </>
  )
}

export default function ProjectPage() {
  return (
    <LandingI18nProvider>
      <ProjectContent />
    </LandingI18nProvider>
  )
}
