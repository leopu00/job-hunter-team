'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LandingI18nProvider } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'

type SectionId = 'install' | 'tui' | 'webapp'

const TABS: { id: SectionId; label: string }[] = [
  { id: 'install', label: 'Installazione' },
  { id: 'tui',     label: 'TUI' },
  { id: 'webapp',  label: 'Web App' },
]

function Code({ children }: { children: string }) {
  return (
    <pre className="px-4 py-3 rounded-lg text-[11px] font-mono leading-relaxed overflow-x-auto"
      style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-bright)' }}>
      {children}
    </pre>
  )
}

function H2({ children }: { children: string }) {
  return <h2 className="text-[16px] font-bold text-[var(--color-white)] mt-8 mb-3">{children}</h2>
}

function H3({ children }: { children: string }) {
  return <h3 className="text-[13px] font-semibold text-[var(--color-bright)] mt-5 mb-2">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-[var(--color-muted)] mb-3">{children}</p>
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[12px] text-[var(--color-muted)] leading-relaxed">
      <span className="text-[var(--color-green)] mt-0.5 flex-shrink-0">&#x25B8;</span>
      <span>{children}</span>
    </li>
  )
}

function CmdTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden" style={{ background: 'var(--color-panel)' }}>
      {rows.map(([cmd, desc], i) => (
        <div key={cmd} className={`flex items-start gap-4 px-4 py-2.5 ${i < rows.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}>
          <span className="text-[11px] font-mono text-[var(--color-green)] w-40 flex-shrink-0">{cmd}</span>
          <span className="text-[11px] text-[var(--color-dim)]">{desc}</span>
        </div>
      ))}
    </div>
  )
}

// ── Sections ────────────────────────────────────────────────────────

function InstallSection() {
  return (
    <div className="flex flex-col gap-1">
      <H2>Requisiti</H2>
      <ul className="flex flex-col gap-1.5 mb-4">
        <Li><strong>Node.js 18+</strong> &mdash; <a href="https://nodejs.org" className="text-[var(--color-green)] underline-offset-2 hover:underline">nodejs.org</a></Li>
        <Li><strong>macOS 12+</strong>, <strong>Linux</strong> (Ubuntu 20.04+, Fedora 36+) o <strong>Windows 10+</strong></Li>
        <Li><strong>tmux</strong> (opzionale, necessario per la TUI e gli agenti)</Li>
      </ul>

      <H2>Installazione rapida</H2>
      <H3>1. Scarica il pacchetto</H3>
      <P>Vai alla pagina <Link href="/download" className="text-[var(--color-green)] hover:underline">/download</Link> e scarica l&apos;archivio per il tuo sistema operativo.</P>

      <H3>2. Estrai e avvia</H3>
      <P>macOS / Linux:</P>
      <Code>{`tar -xzf job-hunter-team-*.tar.gz
cd job-hunter-team
./start.sh`}</Code>
      <P>Windows:</P>
      <Code>{`# Estrai lo ZIP, poi:
start.bat
# oppure PowerShell:
.\\start.ps1`}</Code>

      <H3>3. Primo avvio</H3>
      <P>Lo script di avvio installa le dipendenze e apre il browser su <code className="text-[var(--color-green)]">localhost:3000</code> con la dashboard.</P>
      <P>Al primo avvio ti viene chiesto di selezionare una cartella di lavoro. Tutti i dati (database, CV, documenti) restano nella cartella scelta.</P>

      <H2>Installazione da sorgente</H2>
      <Code>{`git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team
npm install
cd web && npm install && npm run dev`}</Code>
      <P>La web app sara disponibile su <code className="text-[var(--color-green)]">localhost:3000</code>.</P>

      <H2>Configurazione API (opzionale)</H2>
      <P>Per usare gli agenti AI serve una chiave API Anthropic:</P>
      <Code>{`# Nella TUI:
/setup sk-ant-api03-...

# Oppure via variabile d'ambiente:
export ANTHROPIC_API_KEY=sk-ant-api03-...`}</Code>
      <P>La chiave viene salvata localmente in <code className="text-[var(--color-green)]">~/.jht/secrets/</code> e non viene mai condivisa.</P>
    </div>
  )
}

function TuiSection() {
  return (
    <div className="flex flex-col gap-1">
      <H2>Cos&apos;e la TUI</H2>
      <P>La TUI (Terminal User Interface) e il pannello di controllo del team direttamente nel terminale. Permette di monitorare gli agenti, chattare via tmux, gestire i task e interagire con l&apos;AI.</P>

      <H2>Avvio</H2>
      <Code>{`cd tui
npm install
npm run dev`}</Code>

      <H2>Viste</H2>
      <P>La TUI ha 5 viste navigabili con <code className="text-[var(--color-green)]">Tab</code> o i comandi slash:</P>
      <CmdTable rows={[
        ['Team',      'Panoramica agenti tmux attivi, stato, ultimo output'],
        ['Chat',      'Chat diretta con un agente via tmux (invio/ricezione messaggi)'],
        ['Tasks',     'Dashboard task del team, raggruppati per stato'],
        ['Dashboard', 'Budget sentinella, stato deploy, riepilogo task'],
        ['AI',        'Chat con Anthropic API (Claude)'],
      ]} />

      <H2>Comandi</H2>
      <CmdTable rows={[
        ['/team',           'Passa alla vista team'],
        ['/chat <agente>',  'Apri chat tmux con un agente (es. /chat gatekeeper)'],
        ['/start <agente>', 'Avvia sessione tmux per un agente'],
        ['/stop <agente>',  'Ferma sessione tmux di un agente'],
        ['/tasks',          'Passa alla vista task'],
        ['/dashboard',      'Passa alla vista dashboard (alias /dash)'],
        ['/ai',             'Passa alla chat AI'],
        ['/send <msg>',     'Invia messaggio all\'agente selezionato'],
        ['/setup <key>',    'Configura API key Anthropic'],
        ['/refresh',        'Aggiorna vista corrente'],
        ['/status',         'Stato connessione e sessioni attive'],
        ['/abort',          'Interrompi run AI attivo'],
        ['/new',            'Nuova sessione AI'],
        ['/help',           'Mostra aiuto'],
      ]} />

      <H2>Scorciatoie</H2>
      <CmdTable rows={[
        ['Tab',    'Cicla tra le viste (team, chat, tasks, dashboard, ai)'],
        ['Ctrl+U', 'Cancella la riga di input'],
        ['Ctrl+O', 'Espandi/comprimi dettagli tool (vista AI)'],
        ['Ctrl+C', 'Esci dalla TUI'],
      ]} />

      <H2>Dashboard</H2>
      <P>La vista Dashboard mostra tre sezioni:</P>
      <ul className="flex flex-col gap-1.5 mb-4">
        <Li><strong>Budget Sentinella</strong> &mdash; Barra di utilizzo API con colori (verde/giallo/rosso), velocita e proiezione al reset</Li>
        <Li><strong>Deploy</strong> &mdash; Rileva automaticamente il progetto Vercel e mostra l&apos;URL di produzione</Li>
        <Li><strong>Task</strong> &mdash; Conteggio task per stato (in-progress, done, merged, rejected, blocked)</Li>
      </ul>
      <P>La dashboard si aggiorna automaticamente ogni 3 secondi.</P>
    </div>
  )
}

function WebAppSection() {
  return (
    <div className="flex flex-col gap-1">
      <H2>Panoramica</H2>
      <P>La web app e una dashboard completa costruita con Next.js. Funziona interamente in locale sul tuo computer &mdash; nessun dato viene inviato a server esterni (tranne le chiamate API agli agenti AI, se configurati).</P>

      <H2>Pagine principali</H2>
      <CmdTable rows={[
        ['/dashboard',     'Vista principale: metriche, attivita recente, stato agenti'],
        ['/team',          'Gestione team agenti: avvio, stop, monitoraggio, terminale'],
        ['/applications',  'Lista candidature: stato, azienda, ruolo, match score'],
        ['/jobs',          'Offerte di lavoro trovate dagli agenti scout'],
        ['/profile',       'Il tuo profilo professionale: competenze, esperienza, CV'],
        ['/analytics',     'Metriche dettagliate: token, costi, latenza, performance'],
        ['/tasks',         'Task del team con stato e assegnazione'],
        ['/settings',      'Impostazioni: lingua, notifiche, azioni pericolose'],
        ['/docs',          'Documentazione tecnica: architettura, moduli, API'],
      ]} />

      <H2>Agenti</H2>
      <P>Il sistema include 8 agenti AI specializzati che collaborano come un team:</P>
      <CmdTable rows={[
        ['Scout',      'Scansiona job board e canali per trovare offerte rilevanti'],
        ['Analista',   'Analizza requisiti, azienda, fit con il tuo profilo'],
        ['Scorer',     'Calcola un match score per ogni offerta'],
        ['Scrittore',  'Genera CV e cover letter personalizzate'],
        ['Critico',    'Revisiona e migliora le candidature'],
        ['Sentinella', 'Monitora budget API, throttle, salute del sistema'],
        ['Assistente', 'Chat interattiva per domande e supporto'],
        ['Capitano',   'Coordina il team e gestisce le priorita'],
      ]} />

      <H2>Workflow tipico</H2>
      <ul className="flex flex-col gap-1.5 mb-4">
        <Li><strong>1. Configura il profilo</strong> &mdash; Vai a /profile e compila competenze, esperienza e preferenze</Li>
        <Li><strong>2. Avvia gli agenti</strong> &mdash; Da /team, avvia Scout e gli altri agenti necessari</Li>
        <Li><strong>3. Monitora</strong> &mdash; La dashboard mostra le offerte trovate, i match score e le candidature in preparazione</Li>
        <Li><strong>4. Revisiona</strong> &mdash; In /applications trovi le candidature pronte. Approva, modifica o scarta</Li>
        <Li><strong>5. Controlla il budget</strong> &mdash; /analytics e la TUI Dashboard mostrano l&apos;utilizzo API in tempo reale</Li>
      </ul>

      <H2>Dati e privacy</H2>
      <P>Tutti i dati sono salvati nella cartella di lavoro scelta al primo avvio (di default <code className="text-[var(--color-green)]">~/.jht/</code>). Include:</P>
      <ul className="flex flex-col gap-1.5 mb-4">
        <Li><strong>Database</strong> &mdash; SQLite locale con candidature, offerte, profili</Li>
        <Li><strong>Documenti</strong> &mdash; CV, cover letter, report generati</Li>
        <Li><strong>Config</strong> &mdash; Impostazioni, migrazioni, notifiche</Li>
        <Li><strong>Secrets</strong> &mdash; Chiavi API salvate localmente, mai condivise</Li>
      </ul>
      <P>Puoi creare backup da /backup e ripristinarli in qualsiasi momento.</P>
    </div>
  )
}

// ── Main ────────────────────────────────────────────────────────────

const CONTENT: Record<SectionId, React.ReactNode> = {
  install: <InstallSection />,
  tui:     <TuiSection />,
  webapp:  <WebAppSection />,
}

function GuideContent() {
  const [active, setActive] = useState<SectionId>('install')

  return (
    <main style={{ position: 'relative', zIndex: 1 }}>
      <LandingNav />

      <div className="max-w-3xl mx-auto px-5 pt-32 pb-20">
        {/* Header */}
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 mb-3">
            <Link href="/" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Home</Link>
            <span className="text-[var(--color-border)]">/</span>
            <span className="text-[10px] text-[var(--color-muted)]">Guida</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Guida Utente</h1>
          <p className="text-[var(--color-muted)] text-[12px] mt-2 leading-relaxed">
            Come installare, configurare e usare Job Hunter Team &mdash; dalla TUI alla web app.
          </p>

          {/* Tabs */}
          <div className="flex gap-2 flex-wrap mt-5">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActive(tab.id)}
                className="px-4 py-2 rounded-lg text-[11px] font-semibold cursor-pointer transition-all"
                style={{
                  border: `1px solid ${active === tab.id ? 'var(--color-green)' : 'var(--color-border)'}`,
                  color: active === tab.id ? 'var(--color-green)' : 'var(--color-dim)',
                  background: active === tab.id ? 'rgba(0,232,122,0.08)' : 'transparent',
                }}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ animation: 'fade-in 0.2s ease both' }} key={active}>
          {CONTENT[active]}
        </div>

        {/* Footer nav */}
        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between">
          <Link href="/download"
            className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            &larr; Download
          </Link>
          <Link href="/docs"
            className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            Documentazione tecnica &rarr;
          </Link>
        </div>
      </div>
      <LandingFooter />
    </main>
  )
}

export default function GuidePage() {
  return (
    <LandingI18nProvider>
      <GuideContent />
    </LandingI18nProvider>
  )
}
