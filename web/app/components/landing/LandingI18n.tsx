'use client'

import { createContext, useContext, useState, useCallback, useEffect, lazy, Suspense, type ReactNode } from 'react'

const CookieConsent = lazy(() => import('./CookieConsent'))

export type Lang = 'it' | 'en' | 'hu'

const STORAGE_KEY = 'jht-lang'

function getSavedLang(): Lang {
  if (typeof window === 'undefined') return 'it'
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'en') return 'en'
  if (saved === 'hu') return 'hu'
  return 'it'
}

const translations = {
  // Nav
  nav_features:      { it: 'Features',        en: 'Features',        hu: 'Funkciók' },
  nav_how:           { it: 'Come funziona',    en: 'How it works',    hu: 'Hogyan működik' },
  nav_github:        { it: 'GitHub',           en: 'GitHub',          hu: 'GitHub' },
  nav_download:      { it: 'Download',         en: 'Download',        hu: 'Letöltés' },
  nav_demo:          { it: 'Demo',             en: 'Demo',            hu: 'Demó' },
  nav_guide:         { it: 'Guida',            en: 'Guide',           hu: 'Útmutató' },
  nav_faq:           { it: 'FAQ',              en: 'FAQ',             hu: 'GYIK' },
  nav_pricing:       { it: 'Pricing',          en: 'Pricing',         hu: 'Árak' },
  nav_about:         { it: 'Chi siamo',        en: 'About',           hu: 'Rólunk' },
  nav_stats:         { it: 'Stats',            en: 'Stats',           hu: 'Statisztikák' },
  nav_login:         { it: 'Accedi',           en: 'Sign in',         hu: 'Bejelentkezés' },

  // Hero
  hero_badge:        { it: 'beta pubblica',    en: 'public beta',    hu: 'nyilvános béta' },
  hero_title_1:      { it: 'Il tuo team di agenti AI', en: 'Your AI agent team', hu: 'A te AI ügynök csapatod' },
  hero_title_2:      { it: 'per trovare lavoro',       en: 'to land your next job', hu: 'az álláskereséshez' },
  hero_desc:         {
    it: 'Un sistema multi-agente che automatizza ogni fase della ricerca: dalla scansione delle offerte alla candidatura personalizzata. Tu decidi la strategia, gli agenti eseguono.',
    en: 'A multi-agent system that automates every step of your job search: from scanning listings to personalized applications. You set the strategy, the agents execute.',
    hu: 'Egy multi-ügynök rendszer, amely automatizálja az álláskeresés minden lépését: az ajánlatok keresésétől a személyre szabott jelentkezésekig. Te döntesz a stratégiáról, az ügynökök végrehajtják.',
  },
  hero_cta:          { it: 'Inizia qui',               en: 'Start here', hu: 'Kezdj itt' },
  hero_cta2:         { it: 'Scopri come funziona',     en: 'See how it works', hu: 'Nézd meg, hogyan működik' },
  hero_project_cta:  { it: 'GitHub',                   en: 'GitHub', hu: 'GitHub' },

  // Features
  feat_label:        { it: 'capabilities',     en: 'capabilities', hu: 'képességek' },
  feat_title_1:      { it: 'Tutto ciò che serve,',     en: 'Everything you need,', hu: 'Minden, amire szükséged van,' },
  feat_title_2:      { it: 'niente di superfluo',      en: 'nothing you don\'t', hu: 'semmi, amire nincs' },
  feat_0_title:      { it: 'Team Multi-Agente',        en: 'Multi-Agent Team', hu: 'Multi-Ügynök Csapat' },
  feat_0_desc:       {
    it: '7 agenti AI specializzati — Scout, Analista, Scorer, Scrittore, Critico, Sentinella e Capitano — che collaborano come un vero team.',
    en: '7 specialized AI agents — Scout, Analyst, Scorer, Writer, Critic, Sentinel and Captain — working together as a real team.',
    hu: '7 specializált AI ügynök — Scout, Analista, Scorer, Író, Kritikus, Sentinel és Kapitány — akik együtt dolgoznak, mint egy valódi csapat.',
  },
  feat_1_title:      { it: 'Scansione Continua',       en: 'Continuous Scanning', hu: 'Folyamatos Keresés' },
  feat_1_desc:       {
    it: 'Monitoring automatico di job board, LinkedIn e canali dedicati. Non perdere mai un\'opportunità rilevante.',
    en: 'Automatic monitoring of job boards, LinkedIn and dedicated channels. Never miss a relevant opportunity.',
    hu: 'Automatikus figyelés az állásportálokon, LinkedIn-en és dedikált csatornákon. Soha ne maradj le egy releváns lehetőségről sem.',
  },
  feat_2_title:      { it: 'Candidature Smart',        en: 'Smart Applications', hu: 'Okos Jelentkezések' },
  feat_2_desc:       {
    it: 'CV e cover letter personalizzate per ogni posizione, ottimizzate per i sistemi ATS e per il recruiter.',
    en: 'Tailored CVs and cover letters for each position, optimized for ATS systems and recruiters.',
    hu: 'Személyre szabott önéletrajzok és motivációs levelek minden pozícióhoz, optimalizálva az ATS rendszerekhez és a toborzókhoz.',
  },
  feat_3_title:      { it: 'Scoring Intelligente',     en: 'Intelligent Scoring', hu: 'Intelligens Pontozás' },
  feat_3_desc:       {
    it: 'Ogni offerta viene analizzata e valutata in base al tuo profilo, competenze e preferenze. Focus su ciò che conta.',
    en: 'Every listing is analyzed and scored based on your profile, skills and preferences. Focus on what matters.',
    hu: 'Minden ajánlatot elemeznek és pontoznak a profilod, készségeid és preferenciáid alapján. Fókusz azon, ami számít.',
  },
  feat_4_title:      { it: 'Dashboard Real-Time',      en: 'Real-Time Dashboard', hu: 'Valós Idejű Irányítópult' },
  feat_4_desc:       {
    it: 'Metriche, analytics e stato di ogni candidatura. Tutto in una vista: token, costi, latenza, pipeline completa.',
    en: 'Metrics, analytics and status of every application. All in one view: tokens, costs, latency, full pipeline.',
    hu: 'Metrikák, analitika és minden jelentkezés állapota. Minden egy nézetben: tokenek, költségek, késleltetés, teljes folyamat.',
  },
  feat_5_title:      { it: 'Tu al Comando',            en: 'You\'re in Control', hu: 'Te vagy az Irányításban' },
  feat_5_desc:       {
    it: 'Gli agenti propongono, tu decidi. Ogni candidatura richiede la tua approvazione prima dell\'invio.',
    en: 'Agents propose, you decide. Every application requires your approval before submission.',
    hu: 'Az ügynökök javasolnak, te döntesz. Minden jelentkezéshez a te jóváhagyásod szükséges elküldés előtt.',
  },

  // Steps
  steps_label:       { it: 'workflow',         en: 'workflow', hu: 'munkafolyamat' },
  steps_title:       { it: 'Come funziona',    en: 'How it works', hu: 'Hogyan működik' },
  step_0_title:      { it: 'Configura',        en: 'Configure', hu: 'Konfigurálás' },
  step_0_desc:       {
    it: 'Imposta il tuo profilo, le competenze, il ruolo desiderato e i criteri di ricerca. Gli agenti si calibrano su di te.',
    en: 'Set up your profile, skills, desired role and search criteria. The agents calibrate to you.',
    hu: 'Állítsd be a profilodat, készségeidet, a kívánt pozíciót és a keresési kritériumokat. Az ügynökök hozzád igazítják magukat.',
  },
  step_1_title:      { it: 'Gli agenti lavorano',      en: 'Agents get to work', hu: 'Az ügynökök dolgoznak' },
  step_1_desc:       {
    it: 'Il team scansiona offerte, analizza requisiti, calcola match score e prepara candidature personalizzate.',
    en: 'The team scans listings, analyzes requirements, computes match scores and prepares personalized applications.',
    hu: 'A csapat keres ajánlatokat, elemzi a követelményeket, számítja az illeszkedési pontszámot és készíti a személyre szabott jelentkezéseket.',
  },
  step_2_title:      { it: 'Tu decidi',                en: 'You decide', hu: 'Te döntesz' },
  step_2_desc:       {
    it: 'Revisiona le candidature pronte nella dashboard. Approva, modifica o scarta. Sempre tu al comando.',
    en: 'Review ready applications in the dashboard. Approve, edit or discard. Always in control.',
    hu: 'Tekintsd át a kész jelentkezéseket az irányítópulton. Hagyd jóvá, módosítsd vagy dobd el. Mindig te irányítasz.',
  },

  // Get Started
  gs_label:          { it: 'inizia subito',      en: 'get started', hu: 'kezdj el' },
  gs_title:          { it: 'Come iniziare',       en: 'Get started', hu: 'Hogyan kezdj el' },
  gs_0_title:        { it: 'Scarica',             en: 'Download', hu: 'Letöltés' },
  gs_0_desc:         {
    it: 'Scarica il pacchetto per il tuo sistema operativo. Un solo file, nessuna installazione complessa.',
    en: 'Download the package for your OS. One file, no complex installation.',
    hu: 'Töltsd le a csomagot az operációs rendszeredhez. Egyetlen fájl, nincs bonyolult telepítés.',
  },
  gs_1_title:        { it: 'Imposta il profilo',  en: 'Set up your profile', hu: 'Profil beállítása' },
  gs_1_desc:         {
    it: 'Indica il tuo ruolo, le competenze e la zona di ricerca. Il team si calibra su di te in pochi secondi.',
    en: 'Enter your role, skills and search area. The team calibrates to you in seconds.',
    hu: 'Add meg a pozíciódat, készségeidet és a keresési területet. A csapat másodpercek alatt hozzád igazítja magát.',
  },
  gs_2_title:        { it: 'Lascia lavorare il team', en: 'Let the team work', hu: 'Hagyd dolgozni a csapatot' },
  gs_2_desc:         {
    it: 'Gli agenti cercano, analizzano e preparano candidature mentre tu fai altro. Rivedi e approva dalla dashboard.',
    en: 'Agents search, analyze and prepare applications while you do other things. Review and approve from the dashboard.',
    hu: 'Az ügynökök keresnek, elemeznek és készítenek jelentkezéseket, amíg te mással foglalkozol. Tekintsd át és hagyd jóvá az irányítópulton.',
  },

  // Demo page
  demo_badge:        { it: 'tour guidato',           en: 'guided tour', hu: 'vezetett túra' },
  demo_title:        { it: 'Come funziona JHT',      en: 'How JHT works', hu: 'Hogyan működik a JHT' },
  demo_subtitle:     {
    it: 'Un tour passo passo del sistema: dall\'installazione ai risultati.',
    en: 'A step-by-step tour of the system: from installation to results.',
    hu: 'Lépésről lépésre bemutató a rendszerről: a telepítéstől az eredményekig.',
  },
  demo_s0_title:     { it: 'Scarica e avvia',        en: 'Download and launch', hu: 'Letöltés és indítás' },
  demo_s0_desc:      {
    it: 'Scarica l\'installer desktop per il tuo sistema operativo, completa il primo avvio e lascia che il launcher apra la dashboard locale nel browser.',
    en: 'Download the desktop installer for your operating system, complete first launch, and let the launcher open the local dashboard in your browser.',
    hu: 'Töltsd le az asztali telepítőt az operációs rendszeredhez, fejezd be az első indítást, és hagyd, hogy a launcher megnyissa a helyi irányítópultot a böngészőben.',
  },
  demo_s1_title:     { it: 'Configura il profilo',   en: 'Configure your profile', hu: 'Profil konfigurálása' },
  demo_s1_desc:      {
    it: 'Inserisci nome, competenze, zona di ricerca e tipo di lavoro. Gli agenti si calibrano sul tuo profilo per cercare le offerte giuste.',
    en: 'Enter your name, skills, search area and job type. Agents calibrate to your profile to find the right listings.',
    hu: 'Add meg a neved, készségeid, keresési területed és munkatípusod. Az ügynökök a profilodhoz igazítják magukat a megfelelő ajánlatok kereséséhez.',
  },
  demo_s2_title:     { it: 'Avvia il team',          en: 'Start the team', hu: 'Csapat indítása' },
  demo_s2_desc:      {
    it: 'Dalla pagina Team, premi "Avvia tutti". Ogni agente si attiva nella sua sessione: Scout cerca, Analista valuta, Scorer classifica.',
    en: 'From the Team page, click "Start all". Each agent activates in its session: Scout searches, Analyst evaluates, Scorer ranks.',
    hu: 'A Csapat oldalon kattints az "Összes indítása" gombra. Minden ügynök aktiválódik a saját munkamenetében: Scout keres, Analista értékel, Scorer rangsorol.',
  },
  demo_s3_title:     { it: 'Pipeline in azione',     en: 'Pipeline in action', hu: 'Folyamat működés közben' },
  demo_s3_desc:      {
    it: 'La pipeline lavora in autonomia. Lo Scout trova offerte, l\'Analista le esamina, lo Scorer calcola il match, lo Scrittore prepara i documenti.',
    en: 'The pipeline works autonomously. Scout finds listings, Analyst examines them, Scorer computes matches, Writer prepares documents.',
    hu: 'A folyamat önállóan működik. A Scout talál ajánlatokat, az Analista megvizsgálja őket, a Scorer számítja az illeszkedést, az Író készíti a dokumentumokat.',
  },
  demo_s4_title:     { it: 'Dashboard risultati',    en: 'Results dashboard', hu: 'Eredmények irányítópult' },
  demo_s4_desc:      {
    it: 'Nella dashboard vedi le candidature pronte, il match score, e lo stato di ogni offerta. Approva, modifica o scarta con un click.',
    en: 'In the dashboard you see ready applications, match scores, and each listing\'s status. Approve, edit or discard with one click.',
    hu: 'Az irányítópulton látod a kész jelentkezéseket, az illeszkedési pontszámot és minden ajánlat állapotát. Hagyd jóvá, módosítsd vagy dobd el egy kattintással.',
  },
  demo_s5_title:     { it: 'Candidatura finale',     en: 'Final application', hu: 'Végső jelentkezés' },
  demo_s5_desc:      {
    it: 'Il Critico revisiona ogni documento. Quando tutto e pronto, approvi l\'invio. Tu resti sempre al comando, gli agenti eseguono.',
    en: 'The Critic reviews every document. When everything is ready, you approve the submission. You stay in control, agents execute.',
    hu: 'A Kritikus átnéz minden dokumentumot. Amikor minden kész, te hagyod jóvá a küldést. Te maradsz az irányításban, az ügynökök végrehajtják.',
  },
  demo_cta:          { it: 'Prova ora',              en: 'Try now', hu: 'Próbáld ki' },
  demo_prev:         { it: 'Precedente',             en: 'Previous', hu: 'Előző' },
  demo_next:         { it: 'Successivo',             en: 'Next', hu: 'Következő' },
  demo_all_steps:    { it: 'Tutti i passaggi',       en: 'All steps', hu: 'Minden lépés' },

  // CTA
  cta_title_1:       { it: 'Pronto a rivoluzionare',           en: 'Ready to revolutionize', hu: 'Készen állsz a forradalomra' },
  cta_title_2:       { it: 'la tua ricerca lavoro?',           en: 'your job search?', hu: 'az álláskeresésedben?' },
  cta_desc:          {
    it: 'Smetti di inviare candidature generiche. Lascia che un team di agenti AI lavori per te, in modo intelligente e personalizzato.',
    en: 'Stop sending generic applications. Let a team of AI agents work for you, smart and personalized.',
    hu: 'Hagyd abba az általános jelentkezések küldését. Hagyd, hogy egy AI ügynök csapat dolgozzon érted, intelligensen és személyre szabva.',
  },
  cta_button:        { it: 'Inizia ora — è gratis',            en: 'Start now — it\'s free', hu: 'Kezdj most — ingyenes' },
  cta_team:          { it: 'Vedi il team',                      en: 'Meet the team', hu: 'Ismerd meg a csapatot' },
  cta_note:          { it: 'Nessuna carta di credito richiesta · Beta pubblica', en: 'No credit card required · Public beta', hu: 'Nincs szükség hitelkártyára · Nyilvános béta' },

  // Footer
  footer_jht:        { it: 'Job Hunter Team',  en: 'Job Hunter Team', hu: 'Job Hunter Team' },
  footer_brand_desc: { it: 'Un team di agenti AI che cercano lavoro per te. Open source, locale, privato.', en: 'An AI agent team that job-hunts for you. Open source, local, private.', hu: 'Egy AI ügynök csapat, amely állást keres helyetted. Nyílt forráskódú, helyi, privát.' },
  footer_product:    { it: 'Prodotto',          en: 'Product', hu: 'Termék' },
  footer_stats:      { it: 'Progetto',          en: 'Project', hu: 'Projekt' },
  footer_report:     { it: 'Report',             en: 'Reports', hu: 'Jelentések' },
  footer_resources:  { it: 'Risorse',            en: 'Resources', hu: 'Források' },
  footer_guide:      { it: 'Guida',              en: 'Guide', hu: 'Útmutató' },
  footer_docs:       { it: 'Documentazione',     en: 'Documentation', hu: 'Dokumentáció' },
  footer_about:      { it: 'Chi siamo',          en: 'About', hu: 'Rólunk' },
  footer_contacts:   { it: 'Contatti',           en: 'Contacts', hu: 'Kapcsolat' },
  footer_bug:        { it: 'Segnala un bug',     en: 'Report a bug', hu: 'Hiba jelentése' },
  footer_discuss:    { it: 'Discussioni',        en: 'Discussions', hu: 'Beszélgetések' },
  footer_privacy:    { it: 'Privacy Policy',    en: 'Privacy Policy', hu: 'Adatvédelmi Irányelvek' },
  footer_terms:      { it: 'Termini di Servizio', en: 'Terms of Service', hu: 'Szolgáltatási Feltételek' },
  footer_copyright:  { it: 'Open Source sotto licenza MIT', en: 'Open Source under MIT License', hu: 'Nyílt forráskód MIT licenc alatt' },

  // Download page
  dl_desc:           {
    it: 'La dashboard web di JHT puo essere avviata dal launcher desktop oppure da terminale tramite setup avanzato con CLI e TUI. Il runtime gira sul tuo computer e i dati restano sotto il tuo controllo.',
    en: 'JHT web dashboard can be started from the desktop launcher or from the terminal through advanced CLI and TUI setup. The runtime runs on your machine and your data stays under your control.',
    hu: 'A JHT webes irányítópult elindítható az asztali launcherről vagy a terminálból fejlett CLI és TUI beállítással. A futtatókörnyezet a gépeden fut, és az adataid a te ellenőrzésed alatt maradnak.',
  },
  dl_detected:       { it: 'rilevato',                  en: 'detected', hu: 'észlelt' },
  dl_mode_desktop_title: { it: 'Desktop',               en: 'Desktop', hu: 'Asztali' },
  dl_mode_terminal_title: { it: 'CLI',                  en: 'CLI', hu: 'CLI' },
  dl_instructions:   { it: 'Istruzioni',                en: 'Instructions', hu: 'Utasítások' },
  dl_close:          { it: 'Chiudi',                     en: 'Close', hu: 'Bezárás' },
  dl_download:       { it: 'Scarica',                    en: 'Download', hu: 'Letöltés' },
  dl_view_release:   { it: 'Vedi release',               en: 'View release', hu: 'Megtekintés' },
  dl_asset_pending:  { it: 'Installer non ancora presente nella latest release: apro la pagina release invece del download diretto.', en: 'Installer not yet present in the latest release: opening the release page instead of a direct download.', hu: 'A telepítő még nincs jelen a legújabb kiadásban: a kiadás oldalának megnyitása közvetlen letöltés helyett.' },
  dl_how_title:      { it: 'Come funziona',              en: 'How it works', hu: 'Hogyan működik' },
  dl_step1_title:    { it: 'Scarica',                    en: 'Download', hu: 'Letöltés' },
  dl_step1_desc:     { it: 'Scegli il pacchetto per il tuo sistema operativo', en: 'Choose the package for your operating system', hu: 'Válaszd ki a csomagot az operációs rendszeredhez' },
  dl_step2_title:    { it: 'Avvia',                      en: 'Launch', hu: 'Indítás' },
  dl_step2_desc:     { it: 'Apri il launcher desktop e lascia che bootstrap e avvio del runtime partano automaticamente', en: 'Open the desktop launcher and let bootstrap and runtime startup run automatically', hu: 'Nyisd meg az asztali launchert és hagyd, hogy a bootstrap és a futtatókörnyezet automatikusan elinduljon' },
  dl_step3_title:    { it: 'Usa',                        en: 'Use', hu: 'Használat' },
  dl_step3_desc:     { it: 'Il browser si apre su localhost con la dashboard web del team', en: 'The browser opens on localhost with the team web dashboard', hu: 'A böngésző megnyílik a localhost-on a csapat webes irányítópultjával' },
  dl_setup_title:    { it: 'Nota installazione',        en: 'Install note', hu: 'Telepítési megjegyzés' },
  dl_setup_desc:     {
    it: 'I pacchetti desktop per macOS, Windows e Linux includono il launcher e il payload web gia pronto. CLI e TUI offrono invece un accesso piu avanzato allo stesso runtime locale. Su Linux possono servire librerie di sistema standard per AppImage.',
    en: 'The macOS, Windows, and Linux desktop packages include the launcher and a prebuilt web payload. CLI and TUI instead provide more advanced access to the same local runtime. On Linux you may still need standard system libraries for AppImage support.',
    hu: 'A macOS, Windows és Linux asztali csomagok tartalmazzák a launchert és az előre elkészített webes payloadot. A CLI és TUI helyette fejlettebb hozzáférést biztosít ugyanahhoz a helyi futtatókörnyezethez. Linuxon még szükséged lehet szabványos rendszerkönyvtárakra az AppImage támogatáshoz.',
  },
  dl_terminal_title: { it: 'Terminale',                 en: 'Terminal', hu: 'Terminál' },
  dl_terminal_desc:  {
    it: 'Se preferisci partire da riga di comando, puoi clonare la repository e avviare la dashboard web locale oppure usare CLI e TUI per un controllo piu avanzato del runtime.',
    en: 'If you prefer the command line, you can clone the repository and start the local web dashboard or use CLI and TUI for more advanced control over the runtime.',
    hu: 'Ha a parancssort részesíti előnyben, klónozhatod a repository-t és elindíthatod a helyi webes irányítópultot, vagy használhatod a CLI-t és TUI-t a futtatókörnyezet fejlettebb vezérléséhez.',
  },
  dl_terminal_source_tab: { it: 'Dashboard locale',     en: 'Local dashboard', hu: 'Helyi irányítópult' },
  dl_terminal_cli_tab:    { it: 'CLI e setup',          en: 'CLI and setup', hu: 'CLI és beállítás' },
  dl_terminal_source_title: { it: 'Setup da sorgente',  en: 'Source setup', hu: 'Telepítés forrásból' },
  dl_terminal_source_desc:  {
    it: 'Clona il progetto e avvia la dashboard web locale in sviluppo.',
    en: 'Clone the project and start the local web dashboard in development mode.',
    hu: 'Klónozd a projektet és indítsd el a helyi webes irányítópultot fejlesztői módban.',
  },
  dl_terminal_source_note:  {
    it: 'Dopo il comando, la dashboard web sara disponibile su localhost:3000. Questo percorso e pensato per sviluppo locale e uso manuale del repo.',
    en: 'After running the command, the web dashboard will be available on localhost:3000. This path is meant for local development and manual repo usage.',
    hu: 'A parancs futtatása után a webes irányítópult elérhető lesz a localhost:3000 címen. Ez az útvonal helyi fejlesztéshez és manuális repo használathoz készült.',
  },
  dl_terminal_cli_title: { it: 'CLI senza installazione globale', en: 'CLI without global install', hu: 'CLI globális telepítés nélkül' },
  dl_terminal_cli_desc:  {
    it: 'Prepara il progetto e avvia il wizard di setup dal binario CLI. Da qui puoi poi usare anche la TUI e gli altri comandi operativi.',
    en: 'Prepare the project and launch the setup wizard from the CLI binary. From there you can also use the TUI and the other operational commands.',
    hu: 'Készítsd elő a projektet és indítsd el a beállító varázslót a CLI binárisból. Innen használhatod a TUI-t és a többi operatív parancsot is.',
  },
  dl_terminal_cli_note:  {
    it: 'Per la TUI puoi poi eseguire npm --prefix tui install && npm --prefix tui run dev dalla root del progetto. CLI e TUI lavorano sullo stesso runtime locale della dashboard web.',
    en: 'For the TUI you can then run npm --prefix tui install && npm --prefix tui run dev from the project root. CLI and TUI work on the same local runtime as the web dashboard.',
    hu: 'A TUI-hoz futtathatod az npm --prefix tui install && npm --prefix tui run dev parancsot a projekt gyökeréből. A CLI és TUI ugyanazon a helyi futtatókörnyezeten dolgozik, mint a webes irányítópult.',
  },
  dl_setup_link:     { it: 'Node.js disponibile su',    en: 'Node.js available at', hu: 'Node.js elérhető itt' },
  dl_home:           { it: 'Home',                       en: 'Home', hu: 'Kezdőlap' },
  dl_all_releases:   { it: 'Tutte le release',           en: 'All releases', hu: 'Minden verzió' },
  dl_demo_question:  { it: 'Vuoi vedere come funziona prima di scaricare?', en: 'Want to see how it works before downloading?', hu: 'Szeretnéd megnézni, hogyan működik letöltés előtt?' },
  dl_demo_cta:       { it: 'Guarda la demo interattiva', en: 'Watch the interactive demo', hu: 'Nézd meg az interaktív demót' },
  dl_mac_instr:      {
    it: ['Apri il file .dmg scaricato', 'Trascina JHT Desktop nella cartella Applicazioni', 'Avvia JHT Desktop: il launcher aprira la dashboard nel browser'],
    en: ['Open the downloaded .dmg file', 'Drag JHT Desktop into the Applications folder', 'Launch JHT Desktop: the launcher will open the dashboard in your browser'],
    hu: ['Nyisd meg a letöltött .dmg fájlt', 'Húzd a JHT Desktopot az Alkalmazások mappába', 'Indítsd el a JHT Desktopot: a launcher megnyitja az irányítópultot a böngészőben'],
  },
  dl_linux_instr:    {
    it: ['Scarica il file .AppImage', 'Rendilo eseguibile e avvialo: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage', 'JHT Desktop apre la dashboard locale nel browser'],
    en: ['Download the .AppImage file', 'Make it executable and launch it: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage', 'JHT Desktop opens the local dashboard in your browser'],
    hu: ['Töltsd le az .AppImage fájlt', 'Tedd végrehajthatóvá és indítsd el: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage', 'A JHT Desktop megnyitja a helyi irányítópultot a böngészőben'],
  },
  dl_windows_instr:  {
    it: ['Scarica il file .exe', 'Esegui il setup guidato NSIS e completa l\'installazione', 'Apri JHT Desktop dal menu Start: il launcher avvia la dashboard locale nel browser'],
    en: ['Download the .exe file', 'Run the NSIS setup wizard and complete the installation', 'Open JHT Desktop from the Start menu: the launcher starts the local dashboard in your browser'],
    hu: ['Töltsd le az .exe fájlt', 'Futtasd az NSIS telepítő varázslót és fejezd be a telepítést', 'Nyisd meg a JHT Desktopot a Start menüből: a launcher elindítja a helyi irányítópultot a böngészőben'],
  },
  dl_mac_guide_title: {
    it: 'Guida installazione macOS',
    en: 'macOS Installation Guide',
    hu: 'macOS Telepítési Útmutató',
  },
  dl_mac_prereq_title: {
    it: 'Requisiti',
    en: 'Requirements',
    hu: 'Követelmények',
  },
  dl_mac_prereq: {
    it: ['macOS 12 Monterey o successivo', 'Circa 500 MB di spazio libero', 'Connessione internet per scaricare il pacchetto e il primo bootstrap', 'Permesso per aprire il browser locale quando richiesto'],
    en: ['macOS 12 Monterey or later', 'About 500 MB of free disk space', 'Internet connection to download the package and complete first bootstrap', 'Permission to open the local browser when prompted'],
    hu: ['macOS 12 Monterey vagy újabb', 'Kb. 500 MB szabad lemezterület', 'Internetkapcsolat a csomag letöltéséhez és az első bootstraphez', 'Engedély a helyi böngésző megnyitásához, ha szükséges'],
  },
  dl_mac_node_title: {
    it: 'Passo 1 — Apri il pacchetto',
    en: 'Step 1 — Open the package',
    hu: '1. lépés — Csomag megnyitása',
  },
  dl_mac_node_desc: {
    it: 'Il launcher desktop non richiede Node.js separato. Per iniziare:',
    en: 'The desktop launcher does not require a separate Node.js install. To begin:',
    hu: 'Az asztali launcher nem igényel külön Node.js telepítést. A kezdéshez:',
  },
  dl_mac_node_steps: {
    it: [
      'Scarica il pacchetto macOS dal bottone qui sopra',
      'Apri il file .dmg scaricato',
      'Trascina JHT Desktop nella cartella Applicazioni',
      'Se macOS chiede conferma, consenti l\'apertura dell\'app',
    ],
    en: [
      'Download the macOS package from the button above',
      'Open the downloaded .dmg file',
      'Drag JHT Desktop into Applications',
      'If macOS asks for confirmation, allow the app to open',
    ],
    hu: [
      'Töltsd le a macOS csomagot a fenti gombról',
      'Nyisd meg a letöltött .dmg fájlt',
      'Húzd a JHT Desktopot az Alkalmazások mappába',
      'Ha a macOS megerősítést kér, engedélyezd az app megnyitását',
    ],
  },
  dl_mac_node_alt: {
    it: 'Se Gatekeeper blocca l\'app, vai in Impostazioni di Sistema > Privacy e Sicurezza e scegli "Apri comunque".',
    en: 'If Gatekeeper blocks the app, go to System Settings > Privacy & Security and choose "Open Anyway".',
    hu: 'Ha a Gatekeeper blokkolja az appot, menj a Rendszerbeállítások > Biztonság és adatvédelem menübe és válaszd a "Megnyitás mindenképp" lehetőséget.',
  },
  dl_mac_install_title: {
    it: 'Passo 2 — Scarica e avvia',
    en: 'Step 2 — Download and launch',
    hu: '2. lépés — Letöltés és indítás',
  },
  dl_mac_install_steps: {
    it: [
      'Apri JHT Desktop dalla cartella Applicazioni',
      'Attendi il bootstrap iniziale del runtime locale',
      'Se richiesto, consenti all\'app di aprire il browser',
      'La dashboard verra aperta automaticamente su localhost',
    ],
    en: [
      'Open JHT Desktop from the Applications folder',
      'Wait for the first local runtime bootstrap',
      'If prompted, allow the app to open the browser',
      'The dashboard will open automatically on localhost',
    ],
    hu: [
      'Nyisd meg a JHT Desktopot az Alkalmazások mappából',
      'Várj az első helyi futtatókörnyezet bootstrap-re',
      'Ha szükséges, engedélyezd az appnak a böngésző megnyitását',
      'Az irányítópult automatikusan megnyílik a localhoston',
    ],
  },
  dl_mac_expect_title: {
    it: 'Cosa succede',
    en: 'What happens',
    hu: 'Mi történik',
  },
  dl_mac_expect_steps: {
    it: [
      'Il launcher verifica il payload web incluso nell\'app',
      'Avvia il runtime locale su una porta libera, di default 3000',
      'Apre automaticamente il browser sulla dashboard locale',
      'Puoi fermare o riaprire JHT dal launcher desktop',
      'Se la porta 3000 e occupata, il launcher usa una porta vicina libera',
      'I log restano salvati localmente per il debug',
    ],
    en: [
      'The launcher verifies the web payload bundled inside the app',
      'It starts the local runtime on a free port, defaulting to 3000',
      'It automatically opens the browser on the local dashboard',
      'You can stop or reopen JHT from the desktop launcher',
      'If port 3000 is busy, the launcher picks a nearby free port',
      'Logs stay on disk locally for debugging',
    ],
    hu: [
      'A launcher ellenőrzi az appba csomagolt webes payloadot',
      'Elindítja a helyi futtatókörnyezetet egy szabad porton, alapértelmezés szerint 3000',
      'Automatikusan megnyitja a böngészőt a helyi irányítópulton',
      'Leállíthatod vagy újra megnyithatod a JHT-t az asztali launcherről',
      'Ha a 3000-es port foglalt, a launcher egy közeli szabad portot választ',
      'A naplók helyben maradnak a lemezen hibakereséshez',
    ],
  },

  // Guide page
  guide_title:       { it: 'Guida Utente',           en: 'User Guide', hu: 'Felhasználói Útmutató' },
  guide_subtitle:    { it: 'Come installare, configurare e usare Job Hunter Team con launcher desktop, dashboard locale e strumenti avanzati.', en: 'How to install, configure and use Job Hunter Team with the desktop launcher, local dashboard, and advanced tools.', hu: 'Hogyan telepítsd, konfiguráld és használd a Job Hunter Team-et az asztali launcherral, helyi irányítópulttal és fejlett eszközökkel.' },
  guide_docs_link:   { it: 'Documentazione tecnica', en: 'Technical documentation', hu: 'Technikai dokumentáció' },

  // FAQ page
  faq_title:         { it: 'Domande Frequenti',      en: 'Frequently Asked Questions', hu: 'Gyakran Ismételt Kérdések' },
  faq_subtitle:      { it: 'Tutto quello che devi sapere su Job Hunter Team.', en: 'Everything you need to know about Job Hunter Team.', hu: 'Minden, amit tudnod kell a Job Hunter Team-ről.' },
  faq_no_answer:     { it: 'Non trovi la risposta?', en: 'Can\'t find the answer?', hu: 'Nem találod a választ?' },
  faq_no_answer_desc: { it: 'Consulta la guida completa o la documentazione tecnica.', en: 'Check out the full guide or the technical documentation.', hu: 'Nézd meg a teljes útmutatót vagy a technikai dokumentációt.' },
  faq_guide_btn:     { it: 'Guida Utente',           en: 'User Guide', hu: 'Felhasználói Útmutató' },
  faq_docs_btn:      { it: 'Documentazione',         en: 'Documentation', hu: 'Dokumentáció' },

  // About page
  about_badge:       { it: 'chi siamo',           en: 'about us', hu: 'róllunk' },
  about_title_1:     { it: 'Un team di agenti AI',  en: 'An AI agent team', hu: 'Egy AI ügynök csapat' },
  about_title_2:     { it: 'al tuo servizio',       en: 'at your service', hu: 'a szolgálatodban' },
  about_intro:       {
    it: 'Job Hunter Team e un progetto open-source che automatizza la ricerca di lavoro con un sistema multi-agente. Ogni agente ha un ruolo preciso, e insieme formano una pipeline completa: dalla scoperta delle offerte alla candidatura finale.',
    en: 'Job Hunter Team is an open-source project that automates job hunting with a multi-agent system. Each agent has a precise role, and together they form a complete pipeline: from discovering listings to the final application.',
    hu: 'A Job Hunter Team egy nyílt forráskódú projekt, amely automatizálja az álláskeresést egy multi-ügynök rendszerrel. Minden ügynöknek pontos szerepe van, és együtt egy teljes folyamatot alkotnak: az ajánlatok felfedezésétől a végső jelentkezésig.',
  },

  about_story_label: { it: 'la storia',            en: 'the story', hu: 'a történet' },
  about_story_title: { it: 'Come e nato il progetto', en: 'How the project started', hu: 'Hogyan született a projekt' },
  about_story_desc:  {
    it: 'Job Hunter Team e nato dall\'idea che cercare lavoro non dovrebbe essere un lavoro a tempo pieno. Candidarsi richiede ore di ricerca, personalizzazione di CV e cover letter, tracking delle candidature. Abbiamo pensato: e se un team di agenti AI potesse fare tutto questo per te?',
    en: 'Job Hunter Team was born from the idea that job hunting shouldn\'t be a full-time job. Applying requires hours of research, CV and cover letter customization, application tracking. We thought: what if a team of AI agents could do all of this for you?',
    hu: 'A Job Hunter Team abból az ötletből született, hogy az álláskeresésnek nem kellene teljes munkaidős állásnak lennie. A jelentkezés órákig tartó kutatást, önéletrajz és motivációs levél személyre szabását, jelentkezések nyomon követését igényli. Azt gondoltuk: mi lenne, ha egy AI ügynök csapat mindezt megtenné helyetted?',
  },
  about_tl_0:       { it: 'Idea iniziale — sistema multi-agente per job hunting',    en: 'Initial idea — multi-agent system for job hunting', hu: 'Kezdeti ötlet — multi-ügynök rendszer álláskereséshez' },
  about_tl_1:       { it: 'Primo prototipo con pipeline Scout → Analista → Scorer',  en: 'First prototype with Scout → Analyst → Scorer pipeline', hu: 'Első prototípus Scout → Elemző → Pontozó folyamattal' },
  about_tl_2:       { it: 'Aggiunta dashboard locale e strumenti terminali avanzati', en: 'Added local dashboard and advanced terminal tooling', hu: 'Helyi irányítópult és fejlett terminál eszközök hozzáadása' },
  about_tl_3:       { it: 'Beta pubblica — launcher desktop e team operativo',        en: 'Public beta — desktop launcher and production-ready team', hu: 'Nyilvános béta — asztali launcher és éles csapat' },

  about_agents_label:  { it: 'il team',            en: 'the team', hu: 'a csapat' },
  about_agents_title:  { it: 'Gli agenti',         en: 'The agents', hu: 'Az ügynökök' },
  about_agents_desc:   {
    it: 'Il sistema include 7 agenti operativi specializzati e un assistente di supporto. Lavorano in locale, coordinati da un runtime comune e da una pipeline strutturata.',
    en: 'The system includes 7 specialized operational agents plus a support assistant. They work locally, coordinated by a shared runtime and a structured pipeline.',
    hu: 'A rendszer 7 specializált operatív ügynököt és egy támogató asszisztenst tartalmaz. Helyben dolgoznak, egy közös futtatókörnyezet és egy strukturált folyamat koordinálásával.',
  },

  about_agent_alfa_name:  { it: 'Alfa (Capitano)',     en: 'Alfa (Captain)', hu: 'Alfa (Kapitány)' },
  about_agent_alfa_desc:  {
    it: 'Il coordinatore del team. Riceve le direttive dall\'utente, assegna i task agli agenti, monitora il progresso e garantisce che la pipeline funzioni senza intoppi. E il punto di contatto tra te e il team.',
    en: 'The team coordinator. Receives directives from the user, assigns tasks to agents, monitors progress and ensures the pipeline runs smoothly. He\'s the point of contact between you and the team.',
    hu: 'A csapat koordinátora. Fogadja a felhasználói utasításokat, kiosztja a feladatokat az ügynököknek, figyeli az előrehaladást és biztosítja, hogy a folyamat zökkenőmentesen működjön. Ő a kapcsolattartó közted és a csapat között.',
  },
  about_agent_scout_name:  { it: 'Scout',              en: 'Scout', hu: 'Felfedező' },
  about_agent_scout_desc:  {
    it: 'L\'esploratore. Scansiona job board, LinkedIn, canali Telegram e altre fonti alla ricerca di offerte rilevanti. Filtra il rumore e porta al team solo le opportunita\' che corrispondono al tuo profilo.',
    en: 'The explorer. Scans job boards, LinkedIn, Telegram channels and other sources looking for relevant listings. Filters noise and brings the team only opportunities that match your profile.',
    hu: 'A felfedező. Átvizsgálja az állásportálokat, LinkedIn-t, Telegram csatornákat és más forrásokat releváns ajánlatok után. Kiszűri a zajt és csak a profilodhoz illő lehetőségeket hozza a csapatnak.',
  },
  about_agent_analista_name:  { it: 'Analista',        en: 'Analyst', hu: 'Elemző' },
  about_agent_analista_desc:  {
    it: 'Lo stratega. Analizza ogni offerta in profondita\': requisiti, cultura aziendale, tecnologie, seniority. Produce un report strutturato per ogni posizione, evidenziando punti di forza e rischi.',
    en: 'The strategist. Analyzes each listing in depth: requirements, company culture, technologies, seniority. Produces a structured report for each position, highlighting strengths and risks.',
    hu: 'A stratéga. Mélyen elemzi minden ajánlatot: követelmények, vállalati kultúra, technológiák, tapasztalati szint. Strukturált jelentést készít minden pozícióhoz, kiemelve az erősségeket és kockázatokat.',
  },
  about_agent_scorer_name:  { it: 'Scorer',            en: 'Scorer', hu: 'Pontozó' },
  about_agent_scorer_desc:  {
    it: 'Il valutatore. Calcola un match score tra il tuo profilo e ogni offerta analizzata. Considera competenze tecniche, esperienza, localita\', stipendio e preferenze personali. Le offerte migliori salgono in cima.',
    en: 'The evaluator. Computes a match score between your profile and each analyzed listing. Considers technical skills, experience, location, salary and personal preferences. Top matches rise to the top.',
    hu: 'Az értékelő. Kiszámítja az illeszkedési pontszámot a profilod és minden elemzett ajánlat között. Figyelembe veszi a technikai készségeket, tapasztalatot, helyszínt, fizetést és személyes preferenciákat. A legjobb ajánlatok felkerülnek a lista tetejére.',
  },
  about_agent_scrittore_name:  { it: 'Scrittore',      en: 'Writer', hu: 'Író' },
  about_agent_scrittore_desc:  {
    it: 'Il copywriter. Per ogni candidatura approvata, genera un CV personalizzato e una cover letter su misura. Adatta tono, keyword e struttura ai requisiti specifici della posizione e dell\'azienda.',
    en: 'The copywriter. For each approved application, generates a personalized CV and tailored cover letter. Adapts tone, keywords and structure to the specific requirements of the position and company.',
    hu: 'A szövegíró. Minden jóváhagyott jelentkezéshez személyre szabott önéletrajzot és motivációs levelet készít. Igazítja a hangnemet, kulcsszavakat és struktúrát a pozíció és vállalat specifikus követelményeihez.',
  },
  about_agent_critico_name:  { it: 'Critico',          en: 'Critic', hu: 'Kritikus' },
  about_agent_critico_desc:  {
    it: 'Il revisore. Esamina ogni documento prodotto dallo Scrittore con occhio critico: coerenza, errori, keyword mancanti, tono inadeguato. Se necessario, rimanda il lavoro allo Scrittore con feedback preciso.',
    en: 'The reviewer. Examines every document produced by the Writer with a critical eye: coherence, errors, missing keywords, inadequate tone. If needed, sends work back to the Writer with precise feedback.',
    hu: 'A véleményező. Kritikus szemmel vizsgál minden dokumentumot, amit az Író készített: koherencia, hibák, hiányzó kulcsszavak, nem megfelelő hangnem. Szükség esetén visszaküldi a munkát az Írónak pontos visszajelzéssel.',
  },
  about_agent_sentinella_name:  { it: 'Sentinella',    en: 'Sentinel', hu: 'Őrszem' },
  about_agent_sentinella_desc:  {
    it: 'Il guardiano. Monitora i costi API, il consumo di token, la latenza e la salute del sistema. Ti avvisa se qualcosa non va e garantisce che il team operi entro i limiti di budget impostati.',
    en: 'The guardian. Monitors API costs, token consumption, latency and system health. Alerts you if something goes wrong and ensures the team operates within your budget limits.',
    hu: 'A őrző. Figyeli az API költségeket, token fogyasztást, késleltetést és a rendszer egészségét. Figyelmeztet, ha valami nem stimmel, és biztosítja, hogy a csapat a beállított költségvetési kereteken belül működjön.',
  },
  about_agent_assistente_name:  { it: 'Assistente',    en: 'Assistant', hu: 'Asszisztens' },
  about_agent_assistente_desc:  {
    it: 'Il supporto. Risponde alle tue domande, ti guida nella configurazione, spiega le decisioni degli altri agenti. E il tuo punto di riferimento quando hai bisogno di aiuto o vuoi capire cosa sta succedendo.',
    en: 'The support. Answers your questions, guides you through configuration, explains other agents\' decisions. He\'s your go-to when you need help or want to understand what\'s happening.',
    hu: 'A támogató. Válaszol a kérdéseidre, végigvezet a konfiguráción, elmagyarázza más ügynökök döntéseit. Ő a kapcsolattartód, amikor segítségre van szükséged, vagy meg akarod érteni, mi történik.',
  },

  about_how_label:   { it: 'architettura',         en: 'architecture', hu: 'architektúra' },
  about_how_title:   { it: 'Come funziona il sistema', en: 'How the system works', hu: 'Hogyan működik a rendszer' },
  about_how_desc:    {
    it: 'Job Hunter Team usa un\'architettura multi-agente locale: ogni agente gira come worker indipendente, mentre il runtime coordina passaggi, stato e comunicazione tra i moduli.',
    en: 'Job Hunter Team uses a local multi-agent architecture: each agent runs as an independent worker while the runtime coordinates handoffs, state, and communication between modules.',
    hu: 'A Job Hunter Team helyi multi-ügynök architektúrát használ: minden ügynök önálló worker-ként fut, míg a futtatókörnyezet koordinálja az átadásokat, állapotot és kommunikációt a modulok között.',
  },
  about_how_0:       { it: 'Ogni agente gira come worker locale isolato',            en: 'Each agent runs as an isolated local worker', hu: 'Minden ügynök elkülönített helyi worker-ként fut' },
  about_how_1:       { it: 'Il runtime orchestra passaggi e messaggi strutturati tra i moduli', en: 'The runtime orchestrates handoffs and structured messages between modules', hu: 'A futtatókörnyezet koordinálja az átadásokat és strukturált üzeneteket a modulok között' },
  about_how_2:       { it: 'Pipeline coordinata: Scout → Analista → Scorer → Scrittore → Critico', en: 'Coordinated pipeline: Scout → Analyst → Scorer → Writer → Critic', hu: 'Koordinált folyamat: Felfedező → Elemző → Pontozó → Író → Kritikus' },
  about_how_3:       { it: 'Task system con stato (pending → in-progress → done)',   en: 'Task system with state (pending → in-progress → done)', hu: 'Feladat rendszer állapottal (függőben → folyamatban → kész)' },
  about_how_4:       { it: 'Sentinella monitora costi e salute in tempo reale',      en: 'Sentinel monitors costs and health in real-time', hu: 'Az Őrszem valós időben figyeli a költségeket és az egészséget' },

  about_vision_label:  { it: 'visione',            en: 'vision', hu: 'vízió' },
  about_vision_title:  { it: 'Il futuro',          en: 'The future', hu: 'A jövő' },
  about_vision_desc:   {
    it: 'Stiamo costruendo il futuro della ricerca di lavoro automatizzata. La nostra visione e un sistema che impara dalle tue preferenze, migliora ad ogni candidatura, e ti permette di concentrarti su cio\' che conta: prepararti per i colloqui.',
    en: 'We\'re building the future of automated job hunting. Our vision is a system that learns from your preferences, improves with every application, and lets you focus on what matters: preparing for interviews.',
    hu: 'Az automatizált álláskeresés jövőjét építjük. A víziónk egy olyan rendszer, amely tanul a preferenciáidból, fejlődik minden jelentkezéssel, és lehetővé teszi, hogy a lényegre koncentrálj: felkészülni az interjúkra.',
  },
  about_vision_0:    { it: 'Apprendimento continuo dal feedback dell\'utente',       en: 'Continuous learning from user feedback', hu: 'Folyamatos tanulás a felhasználói visszajelzésekből' },
  about_vision_1:    { it: 'Integrazione diretta con portali di candidatura',        en: 'Direct integration with application portals', hu: 'Közvetlen integráció a jelentkezési portálokkal' },
  about_vision_2:    { it: 'Preparazione automatica ai colloqui con mock interview', en: 'Automatic interview preparation with mock interviews', hu: 'Automatikus interjúfelkészítés próbainterjúkkal' },
  about_vision_3:    { it: 'Networking assistito e follow-up automatizzati',         en: 'Assisted networking and automated follow-ups', hu: 'Támogatott hálózatépítés és automatizált követések' },

  // Onboarding wizard
  ob_title:          { it: 'Benvenuto in Job Hunter Team',   en: 'Welcome to Job Hunter Team', hu: 'Üdvözöljük a Job Hunter Team-ben' },
  ob_skip:           { it: 'Salta',                          en: 'Skip', hu: 'Kihagyás' },
  ob_next:           { it: 'Avanti',                         en: 'Next', hu: 'Következő' },
  ob_back:           { it: 'Indietro',                       en: 'Back', hu: 'Vissza' },
  ob_finish:         { it: 'Inizia a cercare',               en: 'Start searching', hu: 'Keresés indítása' },
  ob_step:           { it: 'Passo',                          en: 'Step', hu: 'Lépés' },

  ob_s1_title:       { it: 'Benvenuto',                      en: 'Welcome', hu: 'Üdvözöljük' },
  ob_s1_desc:        {
    it: 'Job Hunter Team e il tuo team personale di agenti AI. Cercano offerte, le analizzano, scrivono CV e cover letter su misura — tutto in automatico, tutto sul tuo computer.',
    en: 'Job Hunter Team is your personal AI agent team. They find listings, analyze them, write tailored CVs and cover letters — all automatically, all on your computer.',
    hu: 'A Job Hunter Team a te személyes AI ügynök csapatod. Ajánlatokat keresnek, elemeznek, személyre szabott önéletrajzokat és motivációs leveleket írnak — mindezt automatikusan, a te számítógépeden.',
  },
  ob_s1_hint:        {
    it: 'Configuriamo insieme il tuo spazio in 5 passi veloci.',
    en: 'Let\'s set up your workspace in 5 quick steps.',
    hu: 'Állítsuk be együtt a munkateredet 5 gyors lépésben.',
  },

  ob_s2_title:       { it: 'Configura il profilo',           en: 'Set up your profile', hu: 'Profil beállítása' },
  ob_s2_desc:        {
    it: 'Indica il tuo nome, il ruolo che cerchi e un breve riassunto della tua esperienza. Gli agenti useranno queste informazioni per personalizzare ogni candidatura.',
    en: 'Enter your name, the role you\'re looking for and a brief summary of your experience. Agents will use this information to personalize every application.',
    hu: 'Add meg a neved, a keresett pozíciót és a tapasztalataid rövid összefoglalóját. Az ügynökök ezeket az információkat fogják használni minden jelentkezés személyre szabásához.',
  },
  ob_s2_name:        { it: 'Nome',                           en: 'Name', hu: 'Név' },
  ob_s2_role:        { it: 'Ruolo target',                   en: 'Target role', hu: 'Cél pozíció' },
  ob_s2_bio:         { it: 'Breve bio',                      en: 'Short bio', hu: 'Rövid bemutatkozás' },

  ob_s3_title:       { it: 'Scegli le competenze',           en: 'Choose your skills', hu: 'Válaszd ki a készségeidet' },
  ob_s3_desc:        {
    it: 'Seleziona le tecnologie e competenze che conosci. Lo Scorer le usera\' per calcolare il match con ogni offerta.',
    en: 'Select the technologies and skills you know. The Scorer will use them to compute the match with each listing.',
    hu: 'Válaszd ki az ismert technológiákat és készségeket. A Pontozó ezeket fogja használni az illeszkedés kiszámításához minden ajánlathoz.',
  },
  ob_s3_hint:        {
    it: 'Clicca per selezionare, clicca di nuovo per deselezionare.',
    en: 'Click to select, click again to deselect.',
    hu: 'Kattints a kiválasztáshoz, kattints újra a kiválasztás megszüntetéséhez.',
  },

  ob_s4_title:       { it: 'Configura la API Key',           en: 'Configure your API Key', hu: 'API kulcs beállítása' },
  ob_s4_desc:        {
    it: 'Gli agenti usano Claude (Anthropic) per ragionare. Inserisci la tua chiave API per attivarli. La chiave resta sul tuo computer, non viene mai inviata a terzi.',
    en: 'Agents use Claude (Anthropic) to reason. Enter your API key to activate them. The key stays on your computer, never sent to third parties.',
    hu: 'Az ügynökök a Claude-ot (Anthropic) használják a következtetéshez. Add meg az API kulcsodat az aktiválásukhoz. A kulcs a számítógépeden marad, soha nem kerül elküldésre harmadik feleknek.',
  },
  ob_s4_placeholder: { it: 'sk-ant-...',                     en: 'sk-ant-...', hu: 'sk-ant-...' },
  ob_s4_hint:        {
    it: 'Ottienila su console.anthropic.com. Salvata in ~/.jht/jht.config.json.',
    en: 'Get it at console.anthropic.com. Saved in ~/.jht/jht.config.json.',
    hu: 'Szerezd be a console.anthropic.com oldalon. Mentve: ~/.jht/jht.config.json.',
  },

  ob_s5_title:       { it: 'Avvia il primo agente',          en: 'Launch your first agent', hu: 'Első ügynök indítása' },
  ob_s5_desc:        {
    it: 'Tutto pronto! Premi il bottone per avviare lo Scout — il primo agente che cerchera\' offerte per te. Potrai avviare il team completo dalla pagina Team.',
    en: 'All set! Press the button to launch the Scout — the first agent that will search listings for you. You can launch the full team from the Team page.',
    hu: 'Minden kész! Nyomd meg a gombot a Felfedező elindításához — az első ügynök, amely ajánlatokat fog keresni neked. A teljes csapatot a Csapat oldalon indíthatod el.',
  },
  ob_s5_launch:      { it: 'Avvia Scout',                    en: 'Launch Scout', hu: 'Felfedező indítása' },
  ob_s5_skip_agent:  { it: 'Lo faro\' dopo',                 en: 'I\'ll do it later', hu: 'Később megteszem' },
  ob_s5_launched:    { it: 'Scout avviato!',                  en: 'Scout launched!', hu: 'Felfedező elindítva!' },
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
  ta: (key) => Array.from(translations[key].it),
})

export function useLandingI18n() {
  return useContext(LandingI18nContext)
}

export function LandingI18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getSavedLang())

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }, [])

  const t = useCallback((key: StringKeys) => {
    const value = translations[key][lang]
    if (!value && lang !== 'it') {
      return translations[key].it as string
    }
    return value as string
  }, [lang])

  const ta = useCallback((key: ArrayKeys) => {
    const value = translations[key][lang]
    if (!value && lang !== 'it') {
      return Array.from(translations[key].it)
    }
    return Array.from(value)
 }, [lang])

  return (
    <LandingI18nContext.Provider value={{ lang, setLang, t, ta }}>
      {children}
      <Suspense><CookieConsent /></Suspense>
    </LandingI18nContext.Provider>
  )
}
