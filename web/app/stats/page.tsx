'use client'

import Link from 'next/link'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

const T = {
  it: {
    title: 'Panoramica del progetto',
    subtitle: 'Una sintesi chiara del repository: da dove nasce, cosa vuole costruire e con quali tecnologie.',
    open_source: 'open source',
    repo_cta: 'Repository GitHub',
    story_title: 'Storia e obiettivo',
    story_body_1:
      'Job Hunter Team è nato come progetto open source per automatizzare la ricerca di lavoro con una pipeline di agenti AI specializzati, eseguita in locale e controllata dall utente.',
    story_body_2:
      'L obiettivo della repo è costruire un sistema pratico: trovare offerte, analizzarle, preparare candidature personalizzate e coordinare tutto da un interfaccia unica, senza perdere controllo, privacy e trasparenza sul codice.',
    stack_title: 'Stack tecnologico',
    stack_desc: 'Le tecnologie principali del progetto, utili da conoscere prima di leggere il codice o contribuire.',
  },
  en: {
    title: 'Project overview',
    subtitle: 'A clear summary of the repository: where it comes from, what it is trying to build, and which technologies power it.',
    open_source: 'open source',
    repo_cta: 'GitHub repository',
    story_title: 'History and goal',
    story_body_1:
      'Job Hunter Team started as an open source project to automate job hunting through a pipeline of specialized AI agents, running locally and controlled by the user.',
    story_body_2:
      'The repository goal is to build a practical system: find listings, analyze them, prepare tailored applications, and coordinate everything from one interface without sacrificing control, privacy, or code transparency.',
    stack_title: 'Technology stack',
    stack_desc: 'The main technologies behind the project, worth knowing before reading the code or contributing.',
  },
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="w-4 h-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49C4 14.09 3.48 13.22 3.32 12.77c-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function StatsContent() {
  const { lang } = useLandingI18n()
  const t = T[lang as 'it' | 'en'] ?? T.it

  const stack = [
    { name: 'Next.js', category: 'Framework' },
    { name: 'React', category: 'UI' },
    { name: 'TypeScript', category: 'Language' },
    { name: 'Python', category: 'Agents runtime' },
    { name: 'Tailwind CSS', category: 'Styling' },
    { name: 'Supabase', category: 'Data' },
  ]

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
      <main className="px-5 sm:px-6 pt-28 pb-16 max-w-4xl mx-auto" style={{ animation: 'fade-in 0.4s ease both' }}>
        <div className="flex items-center gap-2 mb-6 justify-center">
          <Link href="/" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Home
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">{t.title}</span>
        </div>

        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 rounded-none border border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">{t.open_source}</span>
          </div>
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight mb-3">{t.title}</h1>
          <p className="text-[13px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed">{t.subtitle}</p>
          <div className="mt-6 flex justify-center">
            <a
              href="https://github.com/leopu00/job-hunter-team"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded text-[11px] font-bold tracking-wide no-underline transition-all hover:opacity-90"
              style={{ background: 'var(--color-green)', color: '#060608' }}
            >
              <GitHubIcon />
              <span>{t.repo_cta}</span>
            </a>
          </div>
        </div>

        <section className="p-6 rounded-xl border border-[var(--color-border)] mb-6" style={{ background: 'var(--color-panel)' }}>
          <h2 className="text-[15px] font-bold text-[var(--color-white)] mb-4">{t.story_title}</h2>
          <div className="flex flex-col gap-4">
            <p className="text-[12px] md:text-[13px] text-[var(--color-muted)] leading-relaxed">{t.story_body_1}</p>
            <p className="text-[12px] md:text-[13px] text-[var(--color-muted)] leading-relaxed">{t.story_body_2}</p>
          </div>
        </section>

        <section className="p-6 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-panel)' }}>
          <h2 className="text-[15px] font-bold text-[var(--color-white)] mb-2">{t.stack_title}</h2>
          <p className="text-[11px] text-[var(--color-dim)] mb-5">{t.stack_desc}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {stack.map((tech) => (
              <div key={tech.name} className="p-4 rounded-lg border border-[var(--color-border)]" style={{ background: 'var(--color-card)' }}>
                <div className="text-[11px] font-semibold text-[var(--color-bright)]">{tech.name}</div>
                <div className="text-[9px] text-[var(--color-dim)] uppercase tracking-wider mt-1">{tech.category}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between max-w-4xl mx-auto">
          <Link href="/about" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            &larr; {lang === 'en' ? 'About' : 'Chi siamo'}
          </Link>
          <Link href="/changelog" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            Changelog &rarr;
          </Link>
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  )
}

export default function StatsPage() {
  return (
    <LandingI18nProvider>
      <StatsContent />
    </LandingI18nProvider>
  )
}
