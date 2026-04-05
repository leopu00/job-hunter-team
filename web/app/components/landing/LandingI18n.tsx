'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

export type Lang = 'it' | 'en'

const STORAGE_KEY = 'jht-lang'

function getSavedLang(): Lang {
  if (typeof window === 'undefined') return 'it'
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'en') return 'en'
  return 'it'
}

const translations = {
  // Nav
  nav_features:      { it: 'Features',        en: 'Features' },
  nav_how:           { it: 'Come funziona',    en: 'How it works' },
  nav_github:        { it: 'GitHub',           en: 'GitHub' },
  nav_download:      { it: 'Download',         en: 'Download' },
  nav_demo:          { it: 'Demo',             en: 'Demo' },
  nav_guide:         { it: 'Guida',            en: 'Guide' },
  nav_faq:           { it: 'FAQ',              en: 'FAQ' },
  nav_pricing:       { it: 'Pricing',          en: 'Pricing' },
  nav_about:         { it: 'Chi siamo',        en: 'About' },
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

  // Get Started
  gs_label:          { it: 'inizia subito',      en: 'get started' },
  gs_title:          { it: 'Come iniziare',       en: 'Get started' },
  gs_0_title:        { it: 'Scarica',             en: 'Download' },
  gs_0_desc:         {
    it: 'Scarica il pacchetto per il tuo sistema operativo. Un solo file, nessuna installazione complessa.',
    en: 'Download the package for your OS. One file, no complex installation.',
  },
  gs_1_title:        { it: 'Imposta il profilo',  en: 'Set up your profile' },
  gs_1_desc:         {
    it: 'Indica il tuo ruolo, le competenze e la zona di ricerca. Il team si calibra su di te in pochi secondi.',
    en: 'Enter your role, skills and search area. The team calibrates to you in seconds.',
  },
  gs_2_title:        { it: 'Lascia lavorare il team', en: 'Let the team work' },
  gs_2_desc:         {
    it: 'Gli agenti cercano, analizzano e preparano candidature mentre tu fai altro. Rivedi e approva dalla dashboard.',
    en: 'Agents search, analyze and prepare applications while you do other things. Review and approve from the dashboard.',
  },

  // Demo page
  demo_badge:        { it: 'tour guidato',           en: 'guided tour' },
  demo_title:        { it: 'Come funziona JHT',      en: 'How JHT works' },
  demo_subtitle:     {
    it: 'Un tour passo passo del sistema: dall\'installazione ai risultati.',
    en: 'A step-by-step tour of the system: from installation to results.',
  },
  demo_s0_title:     { it: 'Scarica e avvia',        en: 'Download and launch' },
  demo_s0_desc:      {
    it: 'Scarica il pacchetto, estrai e lancia start.sh. Il server si avvia su localhost:3000 e il browser si apre automaticamente.',
    en: 'Download the package, extract and run start.sh. The server starts on localhost:3000 and the browser opens automatically.',
  },
  demo_s1_title:     { it: 'Configura il profilo',   en: 'Configure your profile' },
  demo_s1_desc:      {
    it: 'Inserisci nome, competenze, zona di ricerca e tipo di lavoro. Gli agenti si calibrano sul tuo profilo per cercare le offerte giuste.',
    en: 'Enter your name, skills, search area and job type. Agents calibrate to your profile to find the right listings.',
  },
  demo_s2_title:     { it: 'Avvia il team',          en: 'Start the team' },
  demo_s2_desc:      {
    it: 'Dalla pagina Team, premi "Avvia tutti". Ogni agente si attiva nella sua sessione: Scout cerca, Analista valuta, Scorer classifica.',
    en: 'From the Team page, click "Start all". Each agent activates in its session: Scout searches, Analyst evaluates, Scorer ranks.',
  },
  demo_s3_title:     { it: 'Pipeline in azione',     en: 'Pipeline in action' },
  demo_s3_desc:      {
    it: 'La pipeline lavora in autonomia. Lo Scout trova offerte, l\'Analista le esamina, lo Scorer calcola il match, lo Scrittore prepara i documenti.',
    en: 'The pipeline works autonomously. Scout finds listings, Analyst examines them, Scorer computes matches, Writer prepares documents.',
  },
  demo_s4_title:     { it: 'Dashboard risultati',    en: 'Results dashboard' },
  demo_s4_desc:      {
    it: 'Nella dashboard vedi le candidature pronte, il match score, e lo stato di ogni offerta. Approva, modifica o scarta con un click.',
    en: 'In the dashboard you see ready applications, match scores, and each listing\'s status. Approve, edit or discard with one click.',
  },
  demo_s5_title:     { it: 'Candidatura finale',     en: 'Final application' },
  demo_s5_desc:      {
    it: 'Il Critico revisiona ogni documento. Quando tutto e pronto, approvi l\'invio. Tu resti sempre al comando, gli agenti eseguono.',
    en: 'The Critic reviews every document. When everything is ready, you approve the submission. You stay in control, agents execute.',
  },
  demo_cta:          { it: 'Prova ora',              en: 'Try now' },

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
  footer_brand_desc: { it: 'Un team di agenti AI che cercano lavoro per te. Open source, locale, privato.', en: 'An AI agent team that job-hunts for you. Open source, local, private.' },
  footer_product:    { it: 'Prodotto',          en: 'Product' },
  footer_stats:      { it: 'Statistiche',       en: 'Statistics' },
  footer_report:     { it: 'Report',             en: 'Reports' },
  footer_resources:  { it: 'Risorse',            en: 'Resources' },
  footer_guide:      { it: 'Guida',              en: 'Guide' },
  footer_docs:       { it: 'Documentazione',     en: 'Documentation' },
  footer_about:      { it: 'Chi siamo',          en: 'About' },
  footer_contacts:   { it: 'Contatti',           en: 'Contacts' },
  footer_bug:        { it: 'Segnala un bug',     en: 'Report a bug' },
  footer_discuss:    { it: 'Discussioni',        en: 'Discussions' },

  // Download page
  dl_desc:           {
    it: 'Scarica il sistema multi-agente che automatizza la tua ricerca di lavoro. Funziona interamente sul tuo computer — i tuoi dati restano tuoi.',
    en: 'Download the multi-agent system that automates your job search. Runs entirely on your computer — your data stays yours.',
  },
  dl_detected:       { it: 'rilevato',                  en: 'detected' },
  dl_instructions:   { it: 'Istruzioni',                en: 'Instructions' },
  dl_close:          { it: 'Chiudi',                     en: 'Close' },
  dl_download:       { it: 'Scarica',                    en: 'Download' },
  dl_how_title:      { it: 'Come funziona',              en: 'How it works' },
  dl_step1_title:    { it: 'Scarica',                    en: 'Download' },
  dl_step1_desc:     { it: 'Scegli il pacchetto per il tuo sistema operativo', en: 'Choose the package for your operating system' },
  dl_step2_title:    { it: 'Avvia',                      en: 'Launch' },
  dl_step2_desc:     { it: 'Esegui lo script di avvio — installa tutto automaticamente', en: 'Run the startup script — installs everything automatically' },
  dl_step3_title:    { it: 'Usa',                        en: 'Use' },
  dl_step3_desc:     { it: 'Il browser si apre su localhost con l\'interfaccia del team', en: 'The browser opens on localhost with the team interface' },
  dl_node_title:     { it: 'Requisito: Node.js 18+',    en: 'Requirement: Node.js 18+' },
  dl_node_desc:      {
    it: 'Job Hunter Team richiede Node.js per funzionare. Se non lo hai installato, lo script di avvio ti guidera\' nell\'installazione.',
    en: 'Job Hunter Team requires Node.js to run. If you don\'t have it installed, the startup script will guide you through the installation.',
  },
  dl_node_link:      { it: 'Scarica Node.js da',        en: 'Download Node.js from' },
  dl_home:           { it: 'Home',                       en: 'Home' },
  dl_all_releases:   { it: 'Tutte le release',           en: 'All releases' },
  dl_mac_instr:      {
    it: ["Estrai l'archivio: tar -xzf job-hunter-team-*.tar.gz", 'Entra nella cartella: cd job-hunter-team', 'Avvia: ./start.sh'],
    en: ['Extract the archive: tar -xzf job-hunter-team-*.tar.gz', 'Enter the folder: cd job-hunter-team', 'Launch: ./start.sh'],
  },
  dl_mac_guide_title: {
    it: 'Guida installazione macOS',
    en: 'macOS Installation Guide',
  },
  dl_mac_prereq_title: {
    it: 'Requisiti',
    en: 'Requirements',
  },
  dl_mac_prereq: {
    it: ['macOS 12 Monterey o successivo', 'Node.js 18 o successivo (vedi sotto come installarlo)', 'Circa 500 MB di spazio libero', 'Connessione internet (solo per la prima installazione)'],
    en: ['macOS 12 Monterey or later', 'Node.js 18 or later (see below how to install it)', 'About 500 MB of free disk space', 'Internet connection (only for the first install)'],
  },
  dl_mac_node_title: {
    it: 'Passo 1 — Installa Node.js',
    en: 'Step 1 — Install Node.js',
  },
  dl_mac_node_desc: {
    it: 'Se non hai gia\' Node.js, il metodo piu\' semplice e\' con Homebrew:',
    en: 'If you don\'t have Node.js yet, the easiest method is with Homebrew:',
  },
  dl_mac_node_steps: {
    it: [
      'Apri il Terminale (Applicazioni > Utility > Terminale, oppure cerca "Terminale" in Spotlight con Cmd+Spazio)',
      'Se non hai Homebrew, installalo: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      'Installa Node.js: brew install node',
      'Verifica: node -v (deve mostrare v18 o superiore)',
    ],
    en: [
      'Open Terminal (Applications > Utilities > Terminal, or search "Terminal" in Spotlight with Cmd+Space)',
      'If you don\'t have Homebrew, install it: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      'Install Node.js: brew install node',
      'Verify: node -v (should show v18 or higher)',
    ],
  },
  dl_mac_node_alt: {
    it: 'In alternativa, scarica l\'installer da nodejs.org e segui la procedura guidata.',
    en: 'Alternatively, download the installer from nodejs.org and follow the setup wizard.',
  },
  dl_mac_install_title: {
    it: 'Passo 2 — Scarica e avvia',
    en: 'Step 2 — Download and launch',
  },
  dl_mac_install_steps: {
    it: [
      'Scarica il pacchetto macOS dal bottone qui sopra',
      'Apri il Terminale e vai nella cartella Downloads: cd ~/Downloads',
      'Estrai l\'archivio: tar -xzf job-hunter-team-*.tar.gz',
      'Entra nella cartella: cd job-hunter-team',
      'Rendi eseguibile lo script: chmod +x start.sh',
      'Avvia: ./start.sh',
    ],
    en: [
      'Download the macOS package from the button above',
      'Open Terminal and go to your Downloads folder: cd ~/Downloads',
      'Extract the archive: tar -xzf job-hunter-team-*.tar.gz',
      'Enter the folder: cd job-hunter-team',
      'Make the script executable: chmod +x start.sh',
      'Launch: ./start.sh',
    ],
  },
  dl_mac_expect_title: {
    it: 'Cosa succede',
    en: 'What happens',
  },
  dl_mac_expect_steps: {
    it: [
      'Lo script verifica che Node.js sia installato',
      'Installa le dipendenze automaticamente (solo la prima volta)',
      'Compila l\'applicazione (solo la prima volta, richiede qualche minuto)',
      'Avvia il server locale sulla porta 3000',
      'Apre automaticamente Safari su http://localhost:3000',
      'Per fermare il server: premi Ctrl+C nel Terminale',
    ],
    en: [
      'The script checks that Node.js is installed',
      'Installs dependencies automatically (first time only)',
      'Builds the application (first time only, takes a few minutes)',
      'Starts the local server on port 3000',
      'Automatically opens Safari at http://localhost:3000',
      'To stop the server: press Ctrl+C in the Terminal',
    ],
  },
  dl_linux_instr:    {
    it: ["Estrai l'archivio: tar -xzf job-hunter-team-*.tar.gz", 'Entra nella cartella: cd job-hunter-team', 'Avvia: ./start.sh'],
    en: ['Extract the archive: tar -xzf job-hunter-team-*.tar.gz', 'Enter the folder: cd job-hunter-team', 'Launch: ./start.sh'],
  },
  dl_windows_instr:  {
    it: ['Estrai lo ZIP in una cartella', 'Doppio click su start.bat', 'Oppure: PowerShell > .\\start.ps1'],
    en: ['Extract the ZIP to a folder', 'Double-click start.bat', 'Or: PowerShell > .\\start.ps1'],
  },

  // About page
  about_badge:       { it: 'chi siamo',           en: 'about us' },
  about_title_1:     { it: 'Un team di agenti AI',  en: 'An AI agent team' },
  about_title_2:     { it: 'al tuo servizio',       en: 'at your service' },
  about_intro:       {
    it: 'Job Hunter Team e un progetto open-source che automatizza la ricerca di lavoro con un sistema multi-agente. Ogni agente ha un ruolo preciso, e insieme formano una pipeline completa: dalla scoperta delle offerte alla candidatura finale.',
    en: 'Job Hunter Team is an open-source project that automates job hunting with a multi-agent system. Each agent has a precise role, and together they form a complete pipeline: from discovering listings to the final application.',
  },

  about_story_label: { it: 'la storia',            en: 'the story' },
  about_story_title: { it: 'Come e nato il progetto', en: 'How the project started' },
  about_story_desc:  {
    it: 'Job Hunter Team e nato dall\'idea che cercare lavoro non dovrebbe essere un lavoro a tempo pieno. Candidarsi richiede ore di ricerca, personalizzazione di CV e cover letter, tracking delle candidature. Abbiamo pensato: e se un team di agenti AI potesse fare tutto questo per te?',
    en: 'Job Hunter Team was born from the idea that job hunting shouldn\'t be a full-time job. Applying requires hours of research, CV and cover letter customization, application tracking. We thought: what if a team of AI agents could do all of this for you?',
  },
  about_tl_0:       { it: 'Idea iniziale — sistema multi-agente per job hunting',    en: 'Initial idea — multi-agent system for job hunting' },
  about_tl_1:       { it: 'Primo prototipo con pipeline Scout → Analista → Scorer',  en: 'First prototype with Scout → Analyst → Scorer pipeline' },
  about_tl_2:       { it: 'Aggiunta TUI terminale e interfaccia web',                en: 'Added terminal TUI and web interface' },
  about_tl_3:       { it: 'Beta pubblica — team completo di 8 agenti',               en: 'Public beta — complete team of 8 agents' },

  about_agents_label:  { it: 'il team',            en: 'the team' },
  about_agents_title:  { it: 'Gli agenti',         en: 'The agents' },
  about_agents_desc:   {
    it: 'Ogni agente e un\'istanza Claude specializzata con personalita\', competenze e obiettivi unici. Comunicano tra loro via tmux e collaborano in una pipeline coordinata.',
    en: 'Each agent is a specialized Claude instance with unique personality, skills and goals. They communicate via tmux and collaborate in a coordinated pipeline.',
  },

  about_agent_alfa_name:  { it: 'Alfa (Capitano)',     en: 'Alfa (Captain)' },
  about_agent_alfa_desc:  {
    it: 'Il coordinatore del team. Riceve le direttive dall\'utente, assegna i task agli agenti, monitora il progresso e garantisce che la pipeline funzioni senza intoppi. E il punto di contatto tra te e il team.',
    en: 'The team coordinator. Receives directives from the user, assigns tasks to agents, monitors progress and ensures the pipeline runs smoothly. He\'s the point of contact between you and the team.',
  },
  about_agent_scout_name:  { it: 'Scout',              en: 'Scout' },
  about_agent_scout_desc:  {
    it: 'L\'esploratore. Scansiona job board, LinkedIn, canali Telegram e altre fonti alla ricerca di offerte rilevanti. Filtra il rumore e porta al team solo le opportunita\' che corrispondono al tuo profilo.',
    en: 'The explorer. Scans job boards, LinkedIn, Telegram channels and other sources looking for relevant listings. Filters noise and brings the team only opportunities that match your profile.',
  },
  about_agent_analista_name:  { it: 'Analista',        en: 'Analyst' },
  about_agent_analista_desc:  {
    it: 'Lo stratega. Analizza ogni offerta in profondita\': requisiti, cultura aziendale, tecnologie, seniority. Produce un report strutturato per ogni posizione, evidenziando punti di forza e rischi.',
    en: 'The strategist. Analyzes each listing in depth: requirements, company culture, technologies, seniority. Produces a structured report for each position, highlighting strengths and risks.',
  },
  about_agent_scorer_name:  { it: 'Scorer',            en: 'Scorer' },
  about_agent_scorer_desc:  {
    it: 'Il valutatore. Calcola un match score tra il tuo profilo e ogni offerta analizzata. Considera competenze tecniche, esperienza, localita\', stipendio e preferenze personali. Le offerte migliori salgono in cima.',
    en: 'The evaluator. Computes a match score between your profile and each analyzed listing. Considers technical skills, experience, location, salary and personal preferences. Top matches rise to the top.',
  },
  about_agent_scrittore_name:  { it: 'Scrittore',      en: 'Writer' },
  about_agent_scrittore_desc:  {
    it: 'Il copywriter. Per ogni candidatura approvata, genera un CV personalizzato e una cover letter su misura. Adatta tono, keyword e struttura ai requisiti specifici della posizione e dell\'azienda.',
    en: 'The copywriter. For each approved application, generates a personalized CV and tailored cover letter. Adapts tone, keywords and structure to the specific requirements of the position and company.',
  },
  about_agent_critico_name:  { it: 'Critico',          en: 'Critic' },
  about_agent_critico_desc:  {
    it: 'Il revisore. Esamina ogni documento prodotto dallo Scrittore con occhio critico: coerenza, errori, keyword mancanti, tono inadeguato. Se necessario, rimanda il lavoro allo Scrittore con feedback preciso.',
    en: 'The reviewer. Examines every document produced by the Writer with a critical eye: coherence, errors, missing keywords, inadequate tone. If needed, sends work back to the Writer with precise feedback.',
  },
  about_agent_sentinella_name:  { it: 'Sentinella',    en: 'Sentinel' },
  about_agent_sentinella_desc:  {
    it: 'Il guardiano. Monitora i costi API, il consumo di token, la latenza e la salute del sistema. Ti avvisa se qualcosa non va e garantisce che il team operi entro i limiti di budget impostati.',
    en: 'The guardian. Monitors API costs, token consumption, latency and system health. Alerts you if something goes wrong and ensures the team operates within your budget limits.',
  },
  about_agent_assistente_name:  { it: 'Assistente',    en: 'Assistant' },
  about_agent_assistente_desc:  {
    it: 'Il supporto. Risponde alle tue domande, ti guida nella configurazione, spiega le decisioni degli altri agenti. E il tuo punto di riferimento quando hai bisogno di aiuto o vuoi capire cosa sta succedendo.',
    en: 'The support. Answers your questions, guides you through configuration, explains other agents\' decisions. He\'s your go-to when you need help or want to understand what\'s happening.',
  },

  about_how_label:   { it: 'architettura',         en: 'architecture' },
  about_how_title:   { it: 'Come funziona il sistema', en: 'How the system works' },
  about_how_desc:    {
    it: 'Job Hunter Team usa un\'architettura multi-agente dove ogni agente e un processo indipendente che gira in una sessione tmux. Gli agenti comunicano tra loro attraverso messaggi strutturati e un file system condiviso.',
    en: 'Job Hunter Team uses a multi-agent architecture where each agent is an independent process running in a tmux session. Agents communicate through structured messages and a shared file system.',
  },
  about_how_0:       { it: 'Ogni agente gira in una sessione tmux isolata',          en: 'Each agent runs in an isolated tmux session' },
  about_how_1:       { it: 'Comunicazione via messaggi strutturati [@agent -> @agent]', en: 'Communication via structured messages [@agent -> @agent]' },
  about_how_2:       { it: 'Pipeline coordinata: Scout → Analista → Scorer → Scrittore → Critico', en: 'Coordinated pipeline: Scout → Analyst → Scorer → Writer → Critic' },
  about_how_3:       { it: 'Task system con stato (pending → in-progress → done)',   en: 'Task system with state (pending → in-progress → done)' },
  about_how_4:       { it: 'Sentinella monitora costi e salute in tempo reale',      en: 'Sentinel monitors costs and health in real-time' },

  about_vision_label:  { it: 'visione',            en: 'vision' },
  about_vision_title:  { it: 'Il futuro',          en: 'The future' },
  about_vision_desc:   {
    it: 'Stiamo costruendo il futuro della ricerca di lavoro automatizzata. La nostra visione e un sistema che impara dalle tue preferenze, migliora ad ogni candidatura, e ti permette di concentrarti su cio\' che conta: prepararti per i colloqui.',
    en: 'We\'re building the future of automated job hunting. Our vision is a system that learns from your preferences, improves with every application, and lets you focus on what matters: preparing for interviews.',
  },
  about_vision_0:    { it: 'Apprendimento continuo dal feedback dell\'utente',       en: 'Continuous learning from user feedback' },
  about_vision_1:    { it: 'Integrazione diretta con portali di candidatura',        en: 'Direct integration with application portals' },
  about_vision_2:    { it: 'Preparazione automatica ai colloqui con mock interview', en: 'Automatic interview preparation with mock interviews' },
  about_vision_3:    { it: 'Networking assistito e follow-up automatizzati',         en: 'Assisted networking and automated follow-ups' },

  // Onboarding wizard
  ob_title:          { it: 'Benvenuto in Job Hunter Team',   en: 'Welcome to Job Hunter Team' },
  ob_skip:           { it: 'Salta',                          en: 'Skip' },
  ob_next:           { it: 'Avanti',                         en: 'Next' },
  ob_back:           { it: 'Indietro',                       en: 'Back' },
  ob_finish:         { it: 'Inizia a cercare',               en: 'Start searching' },
  ob_step:           { it: 'Passo',                          en: 'Step' },

  ob_s1_title:       { it: 'Benvenuto',                      en: 'Welcome' },
  ob_s1_desc:        {
    it: 'Job Hunter Team e il tuo team personale di agenti AI. Cercano offerte, le analizzano, scrivono CV e cover letter su misura — tutto in automatico, tutto sul tuo computer.',
    en: 'Job Hunter Team is your personal AI agent team. They find listings, analyze them, write tailored CVs and cover letters — all automatically, all on your computer.',
  },
  ob_s1_hint:        {
    it: 'Configuriamo insieme il tuo spazio in 5 passi veloci.',
    en: 'Let\'s set up your workspace in 5 quick steps.',
  },

  ob_s2_title:       { it: 'Configura il profilo',           en: 'Set up your profile' },
  ob_s2_desc:        {
    it: 'Indica il tuo nome, il ruolo che cerchi e un breve riassunto della tua esperienza. Gli agenti useranno queste informazioni per personalizzare ogni candidatura.',
    en: 'Enter your name, the role you\'re looking for and a brief summary of your experience. Agents will use this information to personalize every application.',
  },
  ob_s2_name:        { it: 'Nome',                           en: 'Name' },
  ob_s2_role:        { it: 'Ruolo target',                   en: 'Target role' },
  ob_s2_bio:         { it: 'Breve bio',                      en: 'Short bio' },

  ob_s3_title:       { it: 'Scegli le competenze',           en: 'Choose your skills' },
  ob_s3_desc:        {
    it: 'Seleziona le tecnologie e competenze che conosci. Lo Scorer le usera\' per calcolare il match con ogni offerta.',
    en: 'Select the technologies and skills you know. The Scorer will use them to compute the match with each listing.',
  },
  ob_s3_hint:        {
    it: 'Clicca per selezionare, clicca di nuovo per deselezionare.',
    en: 'Click to select, click again to deselect.',
  },

  ob_s4_title:       { it: 'Configura la API Key',           en: 'Configure your API Key' },
  ob_s4_desc:        {
    it: 'Gli agenti usano Claude (Anthropic) per ragionare. Inserisci la tua chiave API per attivarli. La chiave resta sul tuo computer, non viene mai inviata a terzi.',
    en: 'Agents use Claude (Anthropic) to reason. Enter your API key to activate them. The key stays on your computer, never sent to third parties.',
  },
  ob_s4_placeholder: { it: 'sk-ant-...',                     en: 'sk-ant-...' },
  ob_s4_hint:        {
    it: 'Ottienila su console.anthropic.com. Salvata in ~/.jht/jht.config.json.',
    en: 'Get it at console.anthropic.com. Saved in ~/.jht/jht.config.json.',
  },

  ob_s5_title:       { it: 'Avvia il primo agente',          en: 'Launch your first agent' },
  ob_s5_desc:        {
    it: 'Tutto pronto! Premi il bottone per avviare lo Scout — il primo agente che cerchera\' offerte per te. Potrai avviare il team completo dalla pagina Team.',
    en: 'All set! Press the button to launch the Scout — the first agent that will search listings for you. You can launch the full team from the Team page.',
  },
  ob_s5_launch:      { it: 'Avvia Scout',                    en: 'Launch Scout' },
  ob_s5_skip_agent:  { it: 'Lo faro\' dopo',                 en: 'I\'ll do it later' },
  ob_s5_launched:    { it: 'Scout avviato!',                  en: 'Scout launched!' },
} as const

type StringKeys = { [K in keyof typeof translations]: (typeof translations)[K]['it'] extends string ? K : never }[keyof typeof translations]
type ArrayKeys = { [K in keyof typeof translations]: (typeof translations)[K]['it'] extends readonly string[] ? K : never }[keyof typeof translations]

interface I18nCtx {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: StringKeys) => string
  ta: (key: ArrayKeys) => string[]
}

const LandingI18nContext = createContext<I18nCtx>({
  lang: 'it',
  setLang: () => {},
  t: (key) => translations[key].it as string,
  ta: (key) => [...translations[key].it] as string[],
})

export function useLandingI18n() {
  return useContext(LandingI18nContext)
}

export function LandingI18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('it')

  useEffect(() => {
    setLangState(getSavedLang())
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }, [])

  const t = useCallback((key: StringKeys) => {
    return translations[key][lang] as string
  }, [lang])

  const ta = useCallback((key: ArrayKeys) => {
    return [...translations[key][lang]] as string[]
  }, [lang])

  return (
    <LandingI18nContext.Provider value={{ lang, setLang, t, ta }}>
      {children}
    </LandingI18nContext.Provider>
  )
}
