"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  lazy,
  Suspense,
  type ReactNode,
} from "react";

import { es } from "./i18n/es";
import { fr } from "./i18n/fr";
import { de } from "./i18n/de";
import { pt } from "./i18n/pt";

const CookieConsent = lazy(() => import("./CookieConsent"));

export type Lang = "it" | "en" | "es" | "fr" | "de" | "pt" | "hu";

// Overlay per le lingue aggiunte sopra la base it/en/hu. La risoluzione in
// t(): overlay[lang][key] → base[key][lang] → base[key].en (fallback EN).
const overlays: Partial<Record<Lang, Record<string, string>>> = {
  es,
  fr,
  de,
  pt,
};

export const SUPPORTED_LANGS: Lang[] = [
  "it",
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "hu",
];

const STORAGE_KEY = "jht-lang";

function getSavedLang(): Lang {
  if (typeof window === "undefined") return "en";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (SUPPORTED_LANGS as string[]).includes(saved)) {
    return saved as Lang;
  }
  return "en";
}

const translations = {
  // Nav
  nav_home: { it: "Home", en: "Home", hu: "Home" },
  nav_features: { it: "Features", en: "Features", hu: "Funkciók" },
  nav_how: { it: "Come funziona", en: "How it works", hu: "Hogyan működik" },
  nav_github: { it: "GitHub", en: "GitHub", hu: "GitHub" },
  nav_download: { it: "Installa", en: "Install", hu: "Telepítés" },
  nav_run: { it: "Come si avvia", en: "How to run it", hu: "Hogyan indítható" },
  nav_team: { it: "Team", en: "Team", hu: "Csapat" },
  nav_pricing: { it: "Prezzi", en: "Pricing", hu: "Árak" },
  nav_case_studies: {
    it: "Studies",
    en: "Studies",
    hu: "Studies",
  },
  nav_project: { it: "Il progetto", en: "Project", hu: "Projekt" },
  nav_chronicles: { it: "Cronache", en: "Chronicles", hu: "Krónikák" },
  nav_demo: { it: "Demo", en: "Demo", hu: "Demó" },
  nav_guide: { it: "Guida", en: "Guide", hu: "Útmutató" },
  nav_faq: { it: "FAQ", en: "FAQ", hu: "GYIK" },
  nav_about: { it: "Chi siamo", en: "About", hu: "Rólunk" },
  nav_stats: { it: "Stats", en: "Stats", hu: "Statisztikák" },
  nav_login: { it: "Accedi", en: "Sign in", hu: "Bejelentkezés" },

  // Hero
  hero_badge: { it: "beta pubblica", en: "public beta", hu: "nyilvános béta" },
  hero_title_1: {
    it: "Il tuo team di agenti AI",
    en: "Your AI agent team",
    hu: "A te AI ügynök csapatod",
  },
  hero_title_2: {
    it: "per trovare lavoro",
    en: "to land your next job",
    hu: "az álláskereséshez",
  },
  hero_desc_short: {
    it: "Una squadra di agenti AI autonomi per la tua ricerca di lavoro.",
    en: "An autonomous AI agent team for your job search.",
    hu: "Autonóm AI-ügynökök csapata az álláskeresésedhez.",
  },
  hero_desc: {
    it: "Un sistema multi-agente autonomo che gestisce ogni fase della ricerca: dalla scansione delle offerte alla candidatura personalizzata. Tu decidi la strategia, gli agenti eseguono.",
    en: "An autonomous multi-agent system that handles every step of your job search: from scanning listings to personalized applications. You set the strategy, the agents execute.",
    hu: "Autonóm multi-ügynök rendszer, amely az álláskeresés minden lépését elvégzi: az ajánlatok keresésétől a személyre szabott jelentkezésekig. Te döntesz a stratégiáról, az ügynökök végrehajtják.",
  },
  home_intro: {
    it: "Job Hunter Team è una squadra di agenti AI autonomi che cercano lavoro per te, di continuo. Ogni agente è uno specialista: c'è chi individua le offerte, chi le analizza nel dettaglio e chi assegna a ciascuna un punteggio, in base a quanto è vicina a ciò che conta davvero per te. Su tua richiesta preparano anche il CV per candidarti. E quando le candidature inviate non bastano a trovare lavoro, un agente dedicato ti affianca: ti aiuta a orientarti nel mercato del lavoro e ad avvicinarti al ruolo che desideri. La direzione la dai tu e l'ultima parola resta sempre tua; il resto lo porta avanti il team, in privato, sulla tua macchina.",
    en: "Job Hunter Team is a team of autonomous AI agents that hunt for jobs for you, around the clock. Each agent is a specialist: one finds the openings, one analyzes them in detail, and one gives each a score based on how close it is to what truly matters to you. On request, they also prepare your CV so you can apply. And when the applications you've sent aren't enough to land a job, a dedicated agent steps in alongside you: it helps you get your bearings in the job market and move closer to the role you want. You set the direction and the final word is always yours; the rest is carried forward by the team, privately, on your own machine.",
    hu: "A Job Hunter Team autonóm AI-ügynökök csapata, amely folyamatosan állást keres neked. Minden ügynök szakember: az egyik megtalálja az ajánlatokat, egy másik részletesen elemzi őket, egy pedig pontszámot ad mindegyiknek aszerint, mennyire áll közel ahhoz, ami igazán számít neked. Kérésedre az önéletrajzot is elkészítik a jelentkezéshez. És amikor az elküldött jelentkezések nem elegendők az álláshoz, egy dedikált ügynök áll melléd: segít eligazodni a munkaerőpiacon, és közelebb kerülni az áhított szerephez. Az irányt te adod meg, és a végső szó mindig a tiéd; a többit a csapat viszi tovább, privát módon, a saját gépeden.",
  },
  hero_cta: { it: "Inizia qui", en: "Start here", hu: "Kezdj itt" },
  hero_cta2: {
    it: "Scopri come funziona",
    en: "See how it works",
    hu: "Nézd meg, hogyan működik",
  },
  hero_project_cta: { it: "GitHub", en: "GitHub", hu: "GitHub" },
  cta_start_team: {
    it: "Crea il tuo team",
    en: "Start your team",
    hu: "Indítsd a csapatod",
  },

  // Features
  feat_aria: { it: "Funzionalità", en: "Features", hu: "Funkciók" },
  feat_label: { it: "capabilities", en: "capabilities", hu: "képességek" },
  feat_title_1: {
    it: "Tutto ciò che serve,",
    en: "Everything you need,",
    hu: "Minden, amire szükséged van,",
  },
  feat_title_2: {
    it: "niente di superfluo",
    en: "nothing you don't",
    hu: "semmi, amire nincs",
  },
  feat_0_title: {
    it: "Team Multi-Agente",
    en: "Multi-Agent Team",
    hu: "Multi-Ügynök Csapat",
  },
  feat_0_desc: {
    it: "7 agenti AI specializzati — Scout, Analista, Scorer, Scrittore, Critico, Sentinella e Capitano — che collaborano come un vero team.",
    en: "7 specialized AI agents — Scout, Analyst, Scorer, Writer, Critic, Sentinel and Captain — working together as a real team.",
    hu: "7 specializált AI ügynök — Scout, Analista, Scorer, Író, Kritikus, Sentinel és Kapitány — akik együtt dolgoznak, mint egy valódi csapat.",
  },
  feat_1_title: {
    it: "Scansione Continua",
    en: "Continuous Scanning",
    hu: "Folyamatos Keresés",
  },
  feat_1_desc: {
    it: "Monitoring automatico di job board, LinkedIn e canali dedicati. Non perdere mai un'opportunità rilevante.",
    en: "Automatic monitoring of job boards, LinkedIn and dedicated channels. Never miss a relevant opportunity.",
    hu: "Automatikus figyelés az állásportálokon, LinkedIn-en és dedikált csatornákon. Soha ne maradj le egy releváns lehetőségről sem.",
  },
  feat_2_title: {
    it: "Candidature Smart",
    en: "Smart Applications",
    hu: "Okos Jelentkezések",
  },
  feat_2_desc: {
    it: "CV e cover letter personalizzate per ogni posizione, ottimizzate per i sistemi ATS e per il recruiter.",
    en: "Tailored CVs and cover letters for each position, optimized for ATS systems and recruiters.",
    hu: "Személyre szabott önéletrajzok és motivációs levelek minden pozícióhoz, optimalizálva az ATS rendszerekhez és a toborzókhoz.",
  },
  feat_3_title: {
    it: "Scoring Intelligente",
    en: "Intelligent Scoring",
    hu: "Intelligens Pontozás",
  },
  feat_3_desc: {
    it: "Ogni offerta viene analizzata e valutata in base al tuo profilo, competenze e preferenze. Focus su ciò che conta.",
    en: "Every listing is analyzed and scored based on your profile, skills and preferences. Focus on what matters.",
    hu: "Minden ajánlatot elemeznek és pontoznak a profilod, készségeid és preferenciáid alapján. Fókusz azon, ami számít.",
  },
  feat_4_title: {
    it: "Dashboard Real-Time",
    en: "Real-Time Dashboard",
    hu: "Valós Idejű Irányítópult",
  },
  feat_4_desc: {
    it: "Metriche, analytics e stato di ogni candidatura. Tutto in una vista: avanzamento, costi e pipeline completa.",
    en: "Metrics, analytics and status of every application. All in one view: progress, costs and the full pipeline at a glance.",
    hu: "Metrikák, analitika és minden jelentkezés állapota. Minden egy nézetben: előrehaladás, költségek és a teljes folyamat egy pillantással.",
  },
  feat_5_title: {
    it: "Tu al Comando",
    en: "You're in Control",
    hu: "Te vagy az Irányításban",
  },
  feat_5_desc: {
    it: "Gli agenti propongono, tu decidi. Ogni candidatura richiede la tua approvazione prima dell'invio.",
    en: "Agents propose, you decide. Every application requires your approval before submission.",
    hu: "Az ügynökök javasolnak, te döntesz. Minden jelentkezéshez a te jóváhagyásod szükséges elküldés előtt.",
  },

  // Steps
  steps_label: { it: "workflow", en: "workflow", hu: "munkafolyamat" },
  steps_title: {
    it: "Come funziona",
    en: "How it works",
    hu: "Hogyan működik",
  },
  step_0_title: { it: "Configura", en: "Configure", hu: "Konfigurálás" },
  step_0_desc: {
    it: "Imposta il tuo profilo, le competenze, il ruolo desiderato e i criteri di ricerca. Gli agenti si calibrano su di te.",
    en: "Set up your profile, skills, desired role and search criteria. The agents calibrate to you.",
    hu: "Állítsd be a profilodat, készségeidet, a kívánt pozíciót és a keresési kritériumokat. Az ügynökök hozzád igazítják magukat.",
  },
  step_1_title: {
    it: "Gli agenti lavorano",
    en: "Agents get to work",
    hu: "Az ügynökök dolgoznak",
  },
  step_1_desc: {
    it: "Il team scansiona offerte, analizza requisiti, calcola match score e prepara candidature personalizzate.",
    en: "The team scans listings, analyzes requirements, computes match scores and prepares personalized applications.",
    hu: "A csapat keres ajánlatokat, elemzi a követelményeket, számítja az illeszkedési pontszámot és készíti a személyre szabott jelentkezéseket.",
  },
  step_2_title: { it: "Tu decidi", en: "You decide", hu: "Te döntesz" },
  step_2_desc: {
    it: "Revisiona le candidature pronte nella dashboard. Approva, modifica o scarta. Sempre tu al comando.",
    en: "Review ready applications in the dashboard. Approve, edit or discard. Always in control.",
    hu: "Tekintsd át a kész jelentkezéseket az irányítópulton. Hagyd jóvá, módosítsd vagy dobd el. Mindig te irányítasz.",
  },

  // Get Started
  gs_label: { it: "inizia subito", en: "get started", hu: "kezdj el" },
  gs_title: { it: "Come iniziare", en: "Get started", hu: "Hogyan kezdj el" },
  gs_0_title: { it: "Scarica", en: "Download", hu: "Letöltés" },
  gs_0_desc: {
    it: "Scarica il pacchetto per il tuo sistema operativo. Un solo file, nessuna installazione complessa.",
    en: "Download the package for your OS. One file, no complex installation.",
    hu: "Töltsd le a csomagot az operációs rendszeredhez. Egyetlen fájl, nincs bonyolult telepítés.",
  },
  gs_1_title: {
    it: "Imposta il profilo",
    en: "Set up your profile",
    hu: "Profil beállítása",
  },
  gs_1_desc: {
    it: "Indica il tuo ruolo, le competenze e la zona di ricerca. Il team si calibra su di te in pochi secondi.",
    en: "Enter your role, skills and search area. The team calibrates to you in seconds.",
    hu: "Add meg a pozíciódat, készségeidet és a keresési területet. A csapat másodpercek alatt hozzád igazítja magát.",
  },
  gs_2_title: {
    it: "Lascia lavorare il team",
    en: "Let the team work",
    hu: "Hagyd dolgozni a csapatot",
  },
  gs_2_desc: {
    it: "Gli agenti cercano, analizzano e preparano candidature mentre tu fai altro. Rivedi e approva dalla dashboard.",
    en: "Agents search, analyze and prepare applications while you do other things. Review and approve from the dashboard.",
    hu: "Az ügynökök keresnek, elemeznek és készítenek jelentkezéseket, amíg te mással foglalkozol. Tekintsd át és hagyd jóvá az irányítópulton.",
  },

  // Demo page
  demo_badge: { it: "tour guidato", en: "guided tour", hu: "vezetett túra" },
  demo_title: {
    it: "Come funziona JHT",
    en: "How JHT works",
    hu: "Hogyan működik a JHT",
  },
  demo_subtitle: {
    it: "Un tour passo passo del sistema: dall'installazione ai risultati.",
    en: "A step-by-step tour of the system: from installation to results.",
    hu: "Lépésről lépésre bemutató a rendszerről: a telepítéstől az eredményekig.",
  },
  demo_s0_title: {
    it: "Scarica e avvia",
    en: "Download and launch",
    hu: "Letöltés és indítás",
  },
  demo_s0_desc: {
    it: "Scarica l'installer desktop per il tuo sistema operativo, completa il primo avvio e lascia che il launcher apra la dashboard locale nel browser.",
    en: "Download the desktop installer for your operating system, complete first launch, and let the launcher open the local dashboard in your browser.",
    hu: "Töltsd le az asztali telepítőt az operációs rendszeredhez, fejezd be az első indítást, és hagyd, hogy a launcher megnyissa a helyi irányítópultot a böngészőben.",
  },
  demo_s1_title: {
    it: "Configura il profilo",
    en: "Configure your profile",
    hu: "Profil konfigurálása",
  },
  demo_s1_desc: {
    it: "Inserisci nome, competenze, zona di ricerca e tipo di lavoro. Gli agenti si calibrano sul tuo profilo per cercare le offerte giuste.",
    en: "Enter your name, skills, search area and job type. Agents calibrate to your profile to find the right listings.",
    hu: "Add meg a neved, készségeid, keresési területed és munkatípusod. Az ügynökök a profilodhoz igazítják magukat a megfelelő ajánlatok kereséséhez.",
  },
  demo_s2_title: {
    it: "Avvia il team",
    en: "Start the team",
    hu: "Csapat indítása",
  },
  demo_s2_desc: {
    it: 'Dalla pagina Team, premi "Avvia tutti". Ogni agente si attiva nella sua sessione: Scout cerca, Analista valuta, Scorer classifica.',
    en: 'From the Team page, click "Start all". Each agent activates in its session: Scout searches, Analyst evaluates, Scorer ranks.',
    hu: 'A Csapat oldalon kattints az "Összes indítása" gombra. Minden ügynök aktiválódik a saját munkamenetében: Scout keres, Analista értékel, Scorer rangsorol.',
  },
  demo_s3_title: {
    it: "Pipeline in azione",
    en: "Pipeline in action",
    hu: "Folyamat működés közben",
  },
  demo_s3_desc: {
    it: "La pipeline lavora in autonomia. Lo Scout trova offerte, l'Analista le esamina, lo Scorer calcola il match, lo Scrittore prepara i documenti.",
    en: "The pipeline works autonomously. Scout finds listings, Analyst examines them, Scorer computes matches, Writer prepares documents.",
    hu: "A folyamat önállóan működik. A Scout talál ajánlatokat, az Analista megvizsgálja őket, a Scorer számítja az illeszkedést, az Író készíti a dokumentumokat.",
  },
  demo_s4_title: {
    it: "Dashboard risultati",
    en: "Results dashboard",
    hu: "Eredmények irányítópult",
  },
  demo_s4_desc: {
    it: "Nella dashboard vedi le candidature pronte, il match score, e lo stato di ogni offerta. Approva, modifica o scarta con un click.",
    en: "In the dashboard you see ready applications, match scores, and each listing's status. Approve, edit or discard with one click.",
    hu: "Az irányítópulton látod a kész jelentkezéseket, az illeszkedési pontszámot és minden ajánlat állapotát. Hagyd jóvá, módosítsd vagy dobd el egy kattintással.",
  },
  demo_s5_title: {
    it: "Candidatura finale",
    en: "Final application",
    hu: "Végső jelentkezés",
  },
  demo_s5_desc: {
    it: "Il Critico revisiona ogni documento. Quando tutto e pronto, approvi l'invio. Tu resti sempre al comando, gli agenti eseguono.",
    en: "The Critic reviews every document. When everything is ready, you approve the submission. You stay in control, agents execute.",
    hu: "A Kritikus átnéz minden dokumentumot. Amikor minden kész, te hagyod jóvá a küldést. Te maradsz az irányításban, az ügynökök végrehajtják.",
  },
  demo_cta: { it: "Prova ora", en: "Try now", hu: "Próbáld ki" },
  demo_prev: { it: "Precedente", en: "Previous", hu: "Előző" },
  demo_next: { it: "Successivo", en: "Next", hu: "Következő" },
  demo_all_steps: {
    it: "Tutti i passaggi",
    en: "All steps",
    hu: "Minden lépés",
  },

  // CTA
  cta_title_1: {
    it: "Pronto a rivoluzionare",
    en: "Ready to revolutionize",
    hu: "Készen állsz a forradalomra",
  },
  cta_title_2: {
    it: "la tua ricerca lavoro?",
    en: "your job search?",
    hu: "az álláskeresésedben?",
  },
  cta_desc: {
    it: "Un team di agenti AI cerca in tutto il mercato e trova le offerte giuste per te — verificate e ordinate per quanto corrispondono al tuo profilo.",
    en: "A team of AI agents scours the whole market and finds the openings that fit you — vetted and ranked by how well they match your profile.",
    hu: "Egy AI ügynök csapat átfésüli az egész piacot, és megtalálja a hozzád illő állásokat — ellenőrizve és a profilodhoz való illeszkedés szerint rangsorolva.",
  },
  cta_button: {
    it: "Inizia",
    en: "Get started",
    hu: "Kezdés",
  },
  cta_team: {
    it: "Vedi il team",
    en: "Meet the team",
    hu: "Ismerd meg a csapatot",
  },
  cta_note: {
    it: "Nessuna carta di credito richiesta · Beta pubblica",
    en: "No credit card required · Public beta",
    hu: "Nincs szükség hitelkártyára · Nyilvános béta",
  },

  // Footer
  footer_jht: {
    it: "Job Hunter Team",
    en: "Job Hunter Team",
    hu: "Job Hunter Team",
  },
  footer_brand_desc: {
    it: "Una squadra di agenti AI autonomi che cercano lavoro per te. Open source, locale, privato.",
    en: "A team of autonomous AI agents that job-hunts for you. Open source, local, private.",
    hu: "Autonóm AI-ügynökök csapata, amely állást keres helyetted. Nyílt forráskódú, helyi, privát.",
  },
  footer_product: { it: "Prodotto", en: "Product", hu: "Termék" },
  footer_stats: { it: "Progetto", en: "Project", hu: "Projekt" },
  footer_report: { it: "Report", en: "Reports", hu: "Jelentések" },
  footer_resources: { it: "Risorse", en: "Resources", hu: "Források" },
  footer_guide: { it: "Guida", en: "Guide", hu: "Útmutató" },
  footer_docs: {
    it: "Documentazione",
    en: "Documentation",
    hu: "Dokumentáció",
  },
  footer_about: { it: "Chi siamo", en: "About", hu: "Rólunk" },
  footer_contacts: { it: "Contatti", en: "Contacts", hu: "Kapcsolat" },
  footer_bug: {
    it: "Segnala un bug",
    en: "Report a bug",
    hu: "Hiba jelentése",
  },
  footer_discuss: { it: "Discussioni", en: "Discussions", hu: "Beszélgetések" },
  footer_privacy: {
    it: "Privacy Policy",
    en: "Privacy Policy",
    hu: "Adatvédelmi Irányelvek",
  },
  footer_terms: {
    it: "Termini di Servizio",
    en: "Terms of Service",
    hu: "Szolgáltatási Feltételek",
  },
  footer_copyright: {
    it: "Open Source sotto licenza MIT",
    en: "Open Source under MIT License",
    hu: "Nyílt forráskód MIT licenc alatt",
  },
  theme_system: { it: "sistema", en: "system", hu: "rendszer" },
  theme_dark: { it: "notte", en: "night", hu: "éjszaka" },
  theme_light: { it: "giorno", en: "day", hu: "nappal" },

  // Download page
  dl_desc: {
    it: "La dashboard di JHT si avvia da terminale, con setup CLI e TUI. Il runtime gira sul tuo computer e i dati restano sotto il tuo controllo.",
    en: "The JHT dashboard is started from the terminal, via the CLI and TUI setup. The runtime runs on your machine and your data stays under your control.",
    hu: "A JHT irányítópultja a terminálból indul, CLI és TUI beállítással. A futtatókörnyezet a gépeden fut, és az adataid a te ellenőrzésed alatt maradnak.",
  },
  dl_back: { it: "← Indietro", en: "← Back", hu: "← Vissza" },
  dl_title_1: {
    it: "Configura il tuo team",
    en: "Set up your team",
    hu: "Állítsd be a csapatod",
  },
  dl_title_2: {
    it: "sul tuo PC",
    en: "on your computer",
    hu: "a számítógépeden",
  },
  dl_toggle_hide: {
    it: "− Nascondi altre opzioni",
    en: "− Hide other options",
    hu: "− További opciók elrejtése",
  },
  dl_toggle_show: {
    it: "+ Altre opzioni (altri OS / architetture)",
    en: "+ Other options (other OS / architectures)",
    hu: "+ További opciók (más OS / architektúra)",
  },
  dl_copy_cmd: {
    it: "Copia comando",
    en: "Copy command",
    hu: "Parancs másolása",
  },
  dl_norelease_title: {
    it: "Nessuna release desktop pubblicata al momento",
    en: "No desktop release published yet",
    hu: "Még nincs közzétett asztali kiadás",
  },
  dl_norelease_desc: {
    it: "Appena viene pubblicata la prossima release, questa pagina offre il download diretto. Nel frattempo puoi usare l'installazione da terminale qui sotto o consultare l'elenco su GitHub.",
    en: "As soon as the next release is published, this page will offer a direct download. Meanwhile you can use the terminal install below or check the list on GitHub.",
    hu: "Amint megjelenik a következő kiadás, ez az oldal közvetlen letöltést kínál. Addig használhatod az alábbi terminál telepítést, vagy megnézheted a listát a GitHubon.",
  },
  dl_open_releases: {
    it: "Apri GitHub Releases",
    en: "Open GitHub Releases",
    hu: "GitHub kiadások megnyitása",
  },
  dl_detected_label: { it: "Rilevato", en: "Detected", hu: "Észlelt" },
  dl_download_for: {
    it: "Scarica per",
    en: "Download for",
    hu: "Letöltés ehhez:",
  },
  dl_detected: { it: "rilevato", en: "detected", hu: "észlelt" },
  dl_mode_desktop_title: { it: "Desktop", en: "Desktop", hu: "Asztali" },
  dl_mode_terminal_title: { it: "CLI", en: "CLI", hu: "CLI" },
  dl_desktop_soon_desc: {
    it: "L'app desktop è in arrivo per tutti e tre i sistemi operativi: la stiamo rifinendo e non è ancora scaricabile. Nel frattempo installi tutto dalla CLI.",
    en: "The desktop app is coming to all three operating systems: we're polishing it and it's not downloadable yet. In the meantime, the CLI installs everything.",
    hu: "Az asztali app hamarosan érkezik mindhárom operációs rendszerre: még csiszoljuk, ezért egyelőre nem tölthető le. Addig a CLI-vel mindent telepíthetsz.",
  },
  dl_desktop_soon_badge: {
    it: "In arrivo",
    en: "Coming soon",
    hu: "Hamarosan",
  },
  dl_help_text: {
    it: "Non sai dove installarlo?",
    en: "Not sure where to install it?",
    hu: "Nem tudod, hová telepítsd?",
  },
  dl_help_link: {
    it: "Leggi la guida",
    en: "Read the guide",
    hu: "Olvasd el az útmutatót",
  },
  dl_instructions: { it: "Istruzioni", en: "Instructions", hu: "Utasítások" },
  dl_close: { it: "Chiudi", en: "Close", hu: "Bezárás" },
  dl_download: { it: "Scarica", en: "Download", hu: "Letöltés" },
  dl_view_release: {
    it: "Vedi release",
    en: "View release",
    hu: "Megtekintés",
  },
  dl_asset_pending: {
    it: "Installer non ancora presente nella latest release: apro la pagina release invece del download diretto.",
    en: "Installer not yet present in the latest release: opening the release page instead of a direct download.",
    hu: "A telepítő még nincs jelen a legújabb kiadásban: a kiadás oldalának megnyitása közvetlen letöltés helyett.",
  },
  dl_how_title: {
    it: "Come funziona",
    en: "How it works",
    hu: "Hogyan működik",
  },
  dl_step1_title: { it: "Scarica", en: "Download", hu: "Letöltés" },
  dl_step1_desc: {
    it: "Scegli il pacchetto per il tuo sistema operativo",
    en: "Choose the package for your operating system",
    hu: "Válaszd ki a csomagot az operációs rendszeredhez",
  },
  dl_step2_title: { it: "Avvia", en: "Launch", hu: "Indítás" },
  dl_step2_desc: {
    it: "Apri il launcher desktop e lascia che bootstrap e avvio del runtime partano automaticamente",
    en: "Open the desktop launcher and let bootstrap and runtime startup run automatically",
    hu: "Nyisd meg az asztali launchert és hagyd, hogy a bootstrap és a futtatókörnyezet automatikusan elinduljon",
  },
  dl_step3_title: { it: "Usa", en: "Use", hu: "Használat" },
  dl_step3_desc: {
    it: "Il browser si apre su localhost con la dashboard web del team",
    en: "The browser opens on localhost with the team web dashboard",
    hu: "A böngésző megnyílik a localhost-on a csapat webes irányítópultjával",
  },
  dl_setup_title: {
    it: "Nota installazione",
    en: "Install note",
    hu: "Telepítési megjegyzés",
  },
  dl_setup_desc: {
    it: "I pacchetti desktop per macOS, Windows e Linux includono il launcher e il payload web gia pronto. CLI e TUI offrono invece un accesso piu avanzato allo stesso runtime locale. Su Linux possono servire librerie di sistema standard per AppImage.",
    en: "The macOS, Windows, and Linux desktop packages include the launcher and a prebuilt web payload. CLI and TUI instead provide more advanced access to the same local runtime. On Linux you may still need standard system libraries for AppImage support.",
    hu: "A macOS, Windows és Linux asztali csomagok tartalmazzák a launchert és az előre elkészített webes payloadot. A CLI és TUI helyette fejlettebb hozzáférést biztosít ugyanahhoz a helyi futtatókörnyezethez. Linuxon még szükséged lehet szabványos rendszerkönyvtárakra az AppImage támogatáshoz.",
  },
  dl_terminal_title: { it: "Terminale", en: "Terminal", hu: "Terminál" },
  dl_terminal_desc: {
    it: "Se preferisci partire da riga di comando, puoi clonare la repository e avviare la dashboard web locale oppure usare CLI e TUI per un controllo piu avanzato del runtime.",
    en: "If you prefer the command line, you can clone the repository and start the local web dashboard or use CLI and TUI for more advanced control over the runtime.",
    hu: "Ha a parancssort részesíti előnyben, klónozhatod a repository-t és elindíthatod a helyi webes irányítópultot, vagy használhatod a CLI-t és TUI-t a futtatókörnyezet fejlettebb vezérléséhez.",
  },
  dl_terminal_source_tab: {
    it: "Da sorgente",
    en: "From source",
    hu: "Forrásból",
  },
  dl_terminal_cli_tab: { it: "One-liner", en: "One-liner", hu: "Egysoros" },
  dl_terminal_source_title: {
    it: "Build da sorgente",
    en: "Build from source",
    hu: "Építés forrásból",
  },
  dl_terminal_source_desc: {
    it: "Clona il repo, builda TUI e CLI. Consigliato per chi vuole contribuire.",
    en: "Clone the repo, build TUI and CLI. Recommended for contributors.",
    hu: "Klónozd a repo-t, építsd fel a TUI-t és a CLI-t. Közreműködőknek ajánlott.",
  },
  dl_terminal_source_note: {
    it: "Dopo il build puoi lanciare il wizard con node cli/bin/jht.js. I dati vanno in ~/.jht e ~/Documents/Job Hunter Team.",
    en: "After the build you can launch the wizard with node cli/bin/jht.js. Data goes to ~/.jht and ~/Documents/Job Hunter Team.",
    hu: "A build után a varázslót a node cli/bin/jht.js paranccsal indíthatod. Az adatok a ~/.jht és ~/Documents/Job Hunter Team mappákba kerülnek.",
  },
  dl_terminal_cli_title: {
    it: "Installer one-liner",
    en: "One-liner installer",
    hu: "Egysoros telepítő",
  },
  dl_terminal_cli_desc: {
    it: "Installa tutto con un solo comando: dipendenze di sistema, Node, Claude CLI, repo e wizard.",
    en: "Install everything with a single command: system deps, Node, Claude CLI, repo and wizard.",
    hu: "Mindent egyetlen paranccsal telepíthetsz: rendszerfüggőségek, Node, Claude CLI, repo és varázsló.",
  },
  dl_terminal_cli_note: {
    it: "Supportato su macOS, Linux (apt/dnf/pacman) e WSL. Crea ~/.jht (config, DB, agenti) e ~/Documents/Job Hunter Team (CV, output).",
    en: "Supported on macOS, Linux (apt/dnf/pacman) and WSL. Creates ~/.jht (config, DB, agents) and ~/Documents/Job Hunter Team (CV, output).",
    hu: "Támogatott: macOS, Linux (apt/dnf/pacman) és WSL. Létrehozza a ~/.jht (konfig, DB, ügynökök) és a ~/Documents/Job Hunter Team (CV, kimenet) mappákat.",
  },
  dl_setup_link: {
    it: "Node.js disponibile su",
    en: "Node.js available at",
    hu: "Node.js elérhető itt",
  },
  dl_home: { it: "Home", en: "Home", hu: "Kezdőlap" },
  dl_all_releases: {
    it: "Tutte le release",
    en: "All releases",
    hu: "Minden verzió",
  },
  dl_demo_question: {
    it: "Vuoi vedere come funziona prima di scaricare?",
    en: "Want to see how it works before downloading?",
    hu: "Szeretnéd megnézni, hogyan működik letöltés előtt?",
  },
  dl_demo_cta: {
    it: "Guarda la demo interattiva",
    en: "Watch the interactive demo",
    hu: "Nézd meg az interaktív demót",
  },
  dl_mac_instr: {
    it: [
      "Apri il file .dmg scaricato",
      "Trascina JHT Desktop nella cartella Applicazioni",
      "Avvia JHT Desktop: il launcher aprira la dashboard nel browser",
    ],
    en: [
      "Open the downloaded .dmg file",
      "Drag JHT Desktop into the Applications folder",
      "Launch JHT Desktop: the launcher will open the dashboard in your browser",
    ],
    hu: [
      "Nyisd meg a letöltött .dmg fájlt",
      "Húzd a JHT Desktopot az Alkalmazások mappába",
      "Indítsd el a JHT Desktopot: a launcher megnyitja az irányítópultot a böngészőben",
    ],
    es: [
      "Abre el archivo .dmg descargado",
      "Arrastra JHT Desktop a la carpeta Aplicaciones",
      "Inicia JHT Desktop: el launcher abrirá el panel en tu navegador",
    ],
    de: [
      "Öffne die heruntergeladene .dmg-Datei",
      "Ziehe JHT Desktop in den Ordner „Programme“",
      "Starte JHT Desktop: Der Launcher öffnet das Dashboard in deinem Browser",
    ],
    fr: [
      "Ouvrez le fichier .dmg téléchargé",
      "Faites glisser JHT Desktop dans le dossier Applications",
      "Lancez JHT Desktop : le launcher ouvrira le tableau de bord dans votre navigateur",
    ],
    pt: [
      "Abra o ficheiro .dmg transferido",
      "Arraste o JHT Desktop para a pasta Aplicações",
      "Inicie o JHT Desktop: o launcher abrirá o painel no seu navegador",
    ],
  },
  dl_linux_instr: {
    it: [
      "Scarica il file .AppImage",
      "Rendilo eseguibile e avvialo: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage",
      "JHT Desktop apre la dashboard locale nel browser",
    ],
    en: [
      "Download the .AppImage file",
      "Make it executable and launch it: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage",
      "JHT Desktop opens the local dashboard in your browser",
    ],
    hu: [
      "Töltsd le az .AppImage fájlt",
      "Tedd végrehajthatóvá és indítsd el: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage",
      "A JHT Desktop megnyitja a helyi irányítópultot a böngészőben",
    ],
    es: [
      "Descarga el archivo .AppImage",
      "Hazlo ejecutable e iníccialo: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage",
      "JHT Desktop abre el panel local en tu navegador",
    ],
    de: [
      "Lade die .AppImage-Datei herunter",
      "Mache sie ausführbar und starte sie: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage",
      "JHT Desktop öffnet das lokale Dashboard in deinem Browser",
    ],
    fr: [
      "Téléchargez le fichier .AppImage",
      "Rendez-le exécutable et lancez-le : chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage",
      "JHT Desktop ouvre le tableau de bord local dans votre navigateur",
    ],
    pt: [
      "Transfira o ficheiro .AppImage",
      "Torne-o executável e inicie-o: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage",
      "O JHT Desktop abre o painel local no seu navegador",
    ],
  },
  dl_windows_instr: {
    it: [
      "Scarica il file .exe",
      "Esegui il setup guidato NSIS e completa l'installazione",
      "Apri JHT Desktop dal menu Start: il launcher avvia la dashboard locale nel browser",
    ],
    en: [
      "Download the .exe file",
      "Run the NSIS setup wizard and complete the installation",
      "Open JHT Desktop from the Start menu: the launcher starts the local dashboard in your browser",
    ],
    hu: [
      "Töltsd le az .exe fájlt",
      "Futtasd az NSIS telepítő varázslót és fejezd be a telepítést",
      "Nyisd meg a JHT Desktopot a Start menüből: a launcher elindítja a helyi irányítópultot a böngészőben",
    ],
    es: [
      "Descarga el archivo .exe",
      "Ejecuta el asistente de instalación NSIS y completa la instalación",
      "Abre JHT Desktop desde el menú Inicio: el launcher inicia el panel local en tu navegador",
    ],
    de: [
      "Lade die .exe-Datei herunter",
      "Führe den NSIS-Installationsassistenten aus und schließe die Installation ab",
      "Öffne JHT Desktop über das Startmenü: Der Launcher startet das lokale Dashboard in deinem Browser",
    ],
    fr: [
      "Téléchargez le fichier .exe",
      "Exécutez l'assistant d'installation NSIS et terminez l'installation",
      "Ouvrez JHT Desktop depuis le menu Démarrer : le launcher démarre le tableau de bord local dans votre navigateur",
    ],
    pt: [
      "Transfira o ficheiro .exe",
      "Execute o assistente de instalação NSIS e conclua a instalação",
      "Abra o JHT Desktop a partir do menu Iniciar: o launcher inicia o painel local no seu navegador",
    ],
  },
  dl_mac_guide_title: {
    it: "Guida installazione macOS",
    en: "macOS Installation Guide",
    hu: "macOS Telepítési Útmutató",
  },
  dl_mac_prereq_title: {
    it: "Requisiti",
    en: "Requirements",
    hu: "Követelmények",
  },
  dl_mac_prereq: {
    it: [
      "macOS 12 Monterey o successivo",
      "Circa 500 MB di spazio libero",
      "Connessione internet per scaricare il pacchetto e il primo bootstrap",
      "Permesso per aprire il browser locale quando richiesto",
    ],
    en: [
      "macOS 12 Monterey or later",
      "About 500 MB of free disk space",
      "Internet connection to download the package and complete first bootstrap",
      "Permission to open the local browser when prompted",
    ],
    hu: [
      "macOS 12 Monterey vagy újabb",
      "Kb. 500 MB szabad lemezterület",
      "Internetkapcsolat a csomag letöltéséhez és az első bootstraphez",
      "Engedély a helyi böngésző megnyitásához, ha szükséges",
    ],
    es: [
      "macOS 12 Monterey o posterior",
      "Unos 500 MB de espacio libre en disco",
      "Conexión a internet para descargar el paquete y completar el primer bootstrap",
      "Permiso para abrir el navegador local cuando se solicite",
    ],
    de: [
      "macOS 12 Monterey oder neuer",
      "Etwa 500 MB freier Speicherplatz",
      "Internetverbindung zum Herunterladen des Pakets und für den ersten Bootstrap",
      "Berechtigung zum Öffnen des lokalen Browsers bei Aufforderung",
    ],
    fr: [
      "macOS 12 Monterey ou version ultérieure",
      "Environ 500 Mo d'espace disque libre",
      "Connexion internet pour télécharger le paquet et effectuer le premier bootstrap",
      "Autorisation d'ouvrir le navigateur local lorsque demandé",
    ],
    pt: [
      "macOS 12 Monterey ou posterior",
      "Cerca de 500 MB de espaço livre em disco",
      "Ligação à internet para transferir o pacote e concluir o primeiro bootstrap",
      "Permissão para abrir o navegador local quando solicitado",
    ],
  },
  dl_mac_node_title: {
    it: "Passo 1 — Apri il pacchetto",
    en: "Step 1 — Open the package",
    hu: "1. lépés — Csomag megnyitása",
  },
  dl_mac_node_desc: {
    it: "Il launcher desktop non richiede Node.js separato. Per iniziare:",
    en: "The desktop launcher does not require a separate Node.js install. To begin:",
    hu: "Az asztali launcher nem igényel külön Node.js telepítést. A kezdéshez:",
  },
  dl_mac_node_steps: {
    it: [
      "Scarica il pacchetto macOS dal bottone qui sopra",
      "Apri il file .dmg scaricato",
      "Trascina JHT Desktop nella cartella Applicazioni",
      "Se macOS chiede conferma, consenti l'apertura dell'app",
    ],
    en: [
      "Download the macOS package from the button above",
      "Open the downloaded .dmg file",
      "Drag JHT Desktop into Applications",
      "If macOS asks for confirmation, allow the app to open",
    ],
    hu: [
      "Töltsd le a macOS csomagot a fenti gombról",
      "Nyisd meg a letöltött .dmg fájlt",
      "Húzd a JHT Desktopot az Alkalmazások mappába",
      "Ha a macOS megerősítést kér, engedélyezd az app megnyitását",
    ],
    es: [
      "Descarga el paquete de macOS desde el botón de arriba",
      "Abre el archivo .dmg descargado",
      "Arrastra JHT Desktop a Aplicaciones",
      "Si macOS pide confirmación, permite que la app se abra",
    ],
    de: [
      "Lade das macOS-Paket über die Schaltfläche oben herunter",
      "Öffne die heruntergeladene .dmg-Datei",
      "Ziehe JHT Desktop in den Ordner „Programme“",
      "Wenn macOS eine Bestätigung verlangt, erlaube das Öffnen der App",
    ],
    fr: [
      "Téléchargez le paquet macOS depuis le bouton ci-dessus",
      "Ouvrez le fichier .dmg téléchargé",
      "Faites glisser JHT Desktop dans Applications",
      "Si macOS demande une confirmation, autorisez l'ouverture de l'application",
    ],
    pt: [
      "Transfira o pacote macOS a partir do botão acima",
      "Abra o ficheiro .dmg transferido",
      "Arraste o JHT Desktop para Aplicações",
      "Se o macOS pedir confirmação, permita a abertura da aplicação",
    ],
  },
  dl_mac_node_alt: {
    it: 'Se Gatekeeper blocca l\'app, vai in Impostazioni di Sistema > Privacy e Sicurezza e scegli "Apri comunque".',
    en: 'If Gatekeeper blocks the app, go to System Settings > Privacy & Security and choose "Open Anyway".',
    hu: 'Ha a Gatekeeper blokkolja az appot, menj a Rendszerbeállítások > Biztonság és adatvédelem menübe és válaszd a "Megnyitás mindenképp" lehetőséget.',
  },
  dl_mac_install_title: {
    it: "Passo 2 — Scarica e avvia",
    en: "Step 2 — Download and launch",
    hu: "2. lépés — Letöltés és indítás",
  },
  dl_mac_install_steps: {
    it: [
      "Apri JHT Desktop dalla cartella Applicazioni",
      "Attendi il bootstrap iniziale del runtime locale",
      "Se richiesto, consenti all'app di aprire il browser",
      "La dashboard verra aperta automaticamente su localhost",
    ],
    en: [
      "Open JHT Desktop from the Applications folder",
      "Wait for the first local runtime bootstrap",
      "If prompted, allow the app to open the browser",
      "The dashboard will open automatically on localhost",
    ],
    hu: [
      "Nyisd meg a JHT Desktopot az Alkalmazások mappából",
      "Várj az első helyi futtatókörnyezet bootstrap-re",
      "Ha szükséges, engedélyezd az appnak a böngésző megnyitását",
      "Az irányítópult automatikusan megnyílik a localhoston",
    ],
    es: [
      "Abre JHT Desktop desde la carpeta Aplicaciones",
      "Espera al primer bootstrap del runtime local",
      "Si se solicita, permite que la app abra el navegador",
      "El panel se abrirá automáticamente en localhost",
    ],
    de: [
      "Öffne JHT Desktop aus dem Ordner „Programme“",
      "Warte auf den ersten Bootstrap der lokalen Laufzeitumgebung",
      "Erlaube der App bei Aufforderung, den Browser zu öffnen",
      "Das Dashboard öffnet sich automatisch auf localhost",
    ],
    fr: [
      "Ouvrez JHT Desktop depuis le dossier Applications",
      "Attendez le premier bootstrap de l'environnement d'exécution local",
      "Si demandé, autorisez l'application à ouvrir le navigateur",
      "Le tableau de bord s'ouvrira automatiquement sur localhost",
    ],
    pt: [
      "Abra o JHT Desktop a partir da pasta Aplicações",
      "Aguarde o primeiro bootstrap do runtime local",
      "Se solicitado, permita que a aplicação abra o navegador",
      "O painel abrirá automaticamente em localhost",
    ],
  },
  dl_mac_expect_title: {
    it: "Cosa succede",
    en: "What happens",
    hu: "Mi történik",
  },
  dl_mac_expect_steps: {
    it: [
      "Il launcher verifica il payload web incluso nell'app",
      "Avvia il runtime locale su una porta libera, di default 3000",
      "Apre automaticamente il browser sulla dashboard locale",
      "Puoi fermare o riaprire JHT dal launcher desktop",
      "Se la porta 3000 e occupata, il launcher usa una porta vicina libera",
      "I log restano salvati localmente per il debug",
    ],
    en: [
      "The launcher verifies the web payload bundled inside the app",
      "It starts the local runtime on a free port, defaulting to 3000",
      "It automatically opens the browser on the local dashboard",
      "You can stop or reopen JHT from the desktop launcher",
      "If port 3000 is busy, the launcher picks a nearby free port",
      "Logs stay on disk locally for debugging",
    ],
    hu: [
      "A launcher ellenőrzi az appba csomagolt webes payloadot",
      "Elindítja a helyi futtatókörnyezetet egy szabad porton, alapértelmezés szerint 3000",
      "Automatikusan megnyitja a böngészőt a helyi irányítópulton",
      "Leállíthatod vagy újra megnyithatod a JHT-t az asztali launcherről",
      "Ha a 3000-es port foglalt, a launcher egy közeli szabad portot választ",
      "A naplók helyben maradnak a lemezen hibakereséshez",
    ],
    es: [
      "El launcher verifica el payload web incluido en la app",
      "Inicia el runtime local en un puerto libre, 3000 por defecto",
      "Abre automáticamente el navegador en el panel local",
      "Puedes detener o reabrir JHT desde el launcher de escritorio",
      "Si el puerto 3000 está ocupado, el launcher elige un puerto libre cercano",
      "Los registros quedan guardados localmente para depuración",
    ],
    de: [
      "Der Launcher überprüft das in der App enthaltene Web-Payload",
      "Er startet die lokale Laufzeitumgebung auf einem freien Port, standardmäßig 3000",
      "Er öffnet automatisch den Browser mit dem lokalen Dashboard",
      "Du kannst JHT über den Desktop-Launcher stoppen oder erneut öffnen",
      "Ist Port 3000 belegt, wählt der Launcher einen nahegelegenen freien Port",
      "Die Protokolle bleiben lokal auf der Festplatte für die Fehlersuche",
    ],
    fr: [
      "Le launcher vérifie le payload web inclus dans l'application",
      "Il démarre l'environnement d'exécution local sur un port libre, 3000 par défaut",
      "Il ouvre automatiquement le navigateur sur le tableau de bord local",
      "Vous pouvez arrêter ou rouvrir JHT depuis le launcher de bureau",
      "Si le port 3000 est occupé, le launcher choisit un port libre voisin",
      "Les journaux restent enregistrés localement pour le débogage",
    ],
    pt: [
      "O launcher verifica o payload web incluído na app",
      "Inicia o runtime local numa porta livre, 3000 por predefinição",
      "Abre automaticamente o navegador no painel local",
      "Pode parar ou reabrir o JHT a partir do launcher de ambiente de trabalho",
      "Se a porta 3000 estiver ocupada, o launcher escolhe uma porta livre próxima",
      "Os registos ficam guardados localmente para depuração",
    ],
  },

  // Guide page
  guide_title: {
    it: "Guida Utente",
    en: "User Guide",
    hu: "Felhasználói Útmutató",
  },
  guide_subtitle: {
    it: "Come installare, configurare e usare Job Hunter Team con launcher desktop, dashboard locale e strumenti avanzati.",
    en: "How to install, configure and use Job Hunter Team with the desktop launcher, local dashboard, and advanced tools.",
    hu: "Hogyan telepítsd, konfiguráld és használd a Job Hunter Team-et az asztali launcherral, helyi irányítópulttal és fejlett eszközökkel.",
  },
  guide_docs_link: {
    it: "Documentazione tecnica",
    en: "Technical documentation",
    hu: "Technikai dokumentáció",
  },

  // FAQ page
  faq_title: {
    it: "Domande Frequenti",
    en: "Frequently Asked Questions",
    hu: "Gyakran Ismételt Kérdések",
  },
  faq_subtitle: {
    it: "Tutto quello che devi sapere su Job Hunter Team.",
    en: "Everything you need to know about Job Hunter Team.",
    hu: "Minden, amit tudnod kell a Job Hunter Team-ről.",
  },
  faq_no_answer: {
    it: "Non trovi la risposta?",
    en: "Can't find the answer?",
    hu: "Nem találod a választ?",
  },
  faq_no_answer_desc: {
    it: "Consulta la guida completa o la documentazione tecnica.",
    en: "Check out the full guide or the technical documentation.",
    hu: "Nézd meg a teljes útmutatót vagy a technikai dokumentációt.",
  },
  faq_guide_btn: {
    it: "Guida Utente",
    en: "User Guide",
    hu: "Felhasználói Útmutató",
  },
  faq_docs_btn: {
    it: "Documentazione",
    en: "Documentation",
    hu: "Dokumentáció",
  },

  // About page
  about_badge: { it: "chi siamo", en: "about us", hu: "rólunk" },
  about_title_1: {
    it: "Un team di agenti AI",
    en: "An AI agent team",
    hu: "Egy AI ügynök csapat",
  },
  about_title_2: {
    it: "al tuo servizio",
    en: "at your service",
    hu: "a szolgálatodban",
  },
  about_intro: {
    it: "Job Hunter Team è un progetto open-source che automatizza la ricerca di lavoro con una squadra di agenti AI autonomi. Ogni agente ha un ruolo preciso, e insieme formano una pipeline completa: dalla scoperta delle offerte alla candidatura finale.",
    en: "Job Hunter Team is an open-source project that automates job hunting with a team of autonomous AI agents. Each agent has a precise role, and together they form a complete pipeline: from discovering listings to the final application.",
    hu: "A Job Hunter Team egy nyílt forráskódú projekt, amely autonóm AI-ügynökök csapatával automatizálja az álláskeresést. Minden ügynöknek pontos szerepe van, és együtt teljes folyamatot alkotnak: az ajánlatok felfedezésétől a végső jelentkezésig.",
  },

  about_story_label: { it: "la storia", en: "the story", hu: "a történet" },
  about_story_title: {
    it: "Come e nato il progetto",
    en: "How the project started",
    hu: "Hogyan született a projekt",
  },
  about_story_desc: {
    it: "Job Hunter Team e nato dall'idea che cercare lavoro non dovrebbe essere un lavoro a tempo pieno. Candidarsi richiede ore di ricerca, personalizzazione di CV e cover letter, tracking delle candidature. Abbiamo pensato: e se un team di agenti AI potesse fare tutto questo per te?",
    en: "Job Hunter Team was born from the idea that job hunting shouldn't be a full-time job. Applying requires hours of research, CV and cover letter customization, application tracking. We thought: what if a team of AI agents could do all of this for you?",
    hu: "A Job Hunter Team abból az ötletből született, hogy az álláskeresésnek nem kellene teljes munkaidős állásnak lennie. A jelentkezés órákig tartó kutatást, önéletrajz és motivációs levél személyre szabását, jelentkezések nyomon követését igényli. Azt gondoltuk: mi lenne, ha egy AI ügynök csapat mindezt megtenné helyetted?",
  },
  about_tl_0: {
    it: "Idea iniziale — sistema multi-agente per job hunting",
    en: "Initial idea — multi-agent system for job hunting",
    hu: "Kezdeti ötlet — multi-ügynök rendszer álláskereséshez",
  },
  about_tl_1: {
    it: "Primo prototipo con pipeline Scout → Analista → Scorer",
    en: "First prototype with Scout → Analyst → Scorer pipeline",
    hu: "Első prototípus Scout → Elemző → Pontozó folyamattal",
  },
  about_tl_2: {
    it: "Aggiunta dashboard locale e strumenti terminali avanzati",
    en: "Added local dashboard and advanced terminal tooling",
    hu: "Helyi irányítópult és fejlett terminál eszközök hozzáadása",
  },
  about_tl_3: {
    it: "Beta pubblica — launcher desktop e team operativo",
    en: "Public beta — desktop launcher and production-ready team",
    hu: "Nyilvános béta — asztali launcher és éles csapat",
  },

  about_agents_label: { it: "il team", en: "the team", hu: "a csapat" },
  about_agents_title: { it: "Gli agenti", en: "The agents", hu: "Az ügynökök" },
  about_agents_desc: {
    it: "Il sistema include 7 agenti operativi specializzati e un assistente di supporto. Lavorano in locale, coordinati da un runtime comune e da una pipeline strutturata.",
    en: "The system includes 7 specialized operational agents plus a support assistant. They work locally, coordinated by a shared runtime and a structured pipeline.",
    hu: "A rendszer 7 specializált operatív ügynököt és egy támogató asszisztenst tartalmaz. Helyben dolgoznak, egy közös futtatókörnyezet és egy strukturált folyamat koordinálásával.",
  },

  about_agent_alfa_name: { it: "Capitano", en: "Captain", hu: "Kapitány" },
  about_agent_alfa_desc: {
    it: "Il coordinatore del team. Riceve le direttive dall'utente, assegna i task agli agenti, monitora il progresso e garantisce che la pipeline funzioni senza intoppi. E il punto di contatto tra te e il team.",
    en: "The team coordinator. Receives directives from the user, assigns tasks to agents, monitors progress and ensures the pipeline runs smoothly. It's the point of contact between you and the team.",
    hu: "A csapat koordinátora. Fogadja a felhasználói utasításokat, kiosztja a feladatokat az ügynököknek, figyeli az előrehaladást és biztosítja, hogy a folyamat zökkenőmentesen működjön. Ő a kapcsolattartó közted és a csapat között.",
  },
  about_agent_scout_name: { it: "Scout", en: "Scout", hu: "Felfedező" },
  about_agent_scout_desc: {
    it: "L'esploratore. Scansiona job board, LinkedIn, canali Telegram e altre fonti alla ricerca di offerte rilevanti. Filtra il rumore e porta al team solo le opportunita' che corrispondono al tuo profilo.",
    en: "The explorer. Scans job boards, LinkedIn, Telegram channels and other sources looking for relevant listings. Filters noise and brings the team only opportunities that match your profile.",
    hu: "A felfedező. Átvizsgálja az állásportálokat, LinkedIn-t, Telegram csatornákat és más forrásokat releváns ajánlatok után. Kiszűri a zajt és csak a profilodhoz illő lehetőségeket hozza a csapatnak.",
  },
  about_agent_analista_name: { it: "Analista", en: "Analyst", hu: "Elemző" },
  about_agent_analista_desc: {
    it: "Lo stratega. Analizza ogni offerta in profondita': requisiti, cultura aziendale, tecnologie, seniority. Produce un report strutturato per ogni posizione, evidenziando punti di forza e rischi.",
    en: "The strategist. Analyzes each listing in depth: requirements, company culture, technologies, seniority. Produces a structured report for each position, highlighting strengths and risks.",
    hu: "A stratéga. Mélyen elemzi minden ajánlatot: követelmények, vállalati kultúra, technológiák, tapasztalati szint. Strukturált jelentést készít minden pozícióhoz, kiemelve az erősségeket és kockázatokat.",
  },
  about_agent_scorer_name: { it: "Scorer", en: "Scorer", hu: "Pontozó" },
  about_agent_scorer_desc: {
    it: "Il valutatore. Calcola un match score tra il tuo profilo e ogni offerta analizzata. Considera competenze tecniche, esperienza, localita', stipendio e preferenze personali. Le offerte migliori salgono in cima.",
    en: "The evaluator. Computes a match score between your profile and each analyzed listing. Considers technical skills, experience, location, salary and personal preferences. Top matches rise to the top.",
    hu: "Az értékelő. Kiszámítja az illeszkedési pontszámot a profilod és minden elemzett ajánlat között. Figyelembe veszi a technikai készségeket, tapasztalatot, helyszínt, fizetést és személyes preferenciákat. A legjobb ajánlatok felkerülnek a lista tetejére.",
  },
  about_agent_scrittore_name: { it: "Scrittore", en: "Writer", hu: "Író" },
  about_agent_scrittore_desc: {
    it: "Il copywriter. Per ogni candidatura approvata, genera un CV personalizzato e una cover letter su misura. Adatta tono, keyword e struttura ai requisiti specifici della posizione e dell'azienda.",
    en: "The copywriter. For each approved application, generates a personalized CV and tailored cover letter. Adapts tone, keywords and structure to the specific requirements of the position and company.",
    hu: "A szövegíró. Minden jóváhagyott jelentkezéshez személyre szabott önéletrajzot és motivációs levelet készít. Igazítja a hangnemet, kulcsszavakat és struktúrát a pozíció és vállalat specifikus követelményeihez.",
  },
  about_agent_critico_name: { it: "Critico", en: "Critic", hu: "Kritikus" },
  about_agent_critico_desc: {
    it: "Il revisore. Esamina ogni documento prodotto dallo Scrittore con occhio critico: coerenza, errori, keyword mancanti, tono inadeguato. Se necessario, rimanda il lavoro allo Scrittore con feedback preciso.",
    en: "The reviewer. Examines every document produced by the Writer with a critical eye: coherence, errors, missing keywords, inadequate tone. If needed, sends work back to the Writer with precise feedback.",
    hu: "A véleményező. Kritikus szemmel vizsgál minden dokumentumot, amit az Író készített: koherencia, hibák, hiányzó kulcsszavak, nem megfelelő hangnem. Szükség esetén visszaküldi a munkát az Írónak pontos visszajelzéssel.",
  },
  about_agent_sentinella_name: {
    it: "Sentinella",
    en: "Sentinel",
    hu: "Őrszem",
  },
  about_agent_sentinella_desc: {
    it: "Il guardiano. Monitora i costi API, i consumi, i tempi di risposta e la salute del sistema. Ti avvisa se qualcosa non va e garantisce che il team operi entro i limiti di budget impostati.",
    en: "The guardian. Monitors API costs, usage, response times and system health. Alerts you if something goes wrong and ensures the team operates within your budget limits.",
    hu: "Az őrző. Figyeli az API-költségeket, a használatot, a válaszidőket és a rendszer egészségét. Figyelmeztet, ha valami nem stimmel, és biztosítja, hogy a csapat a beállított költségvetési kereteken belül működjön.",
  },
  about_agent_assistente_name: {
    it: "Assistente",
    en: "Assistant",
    hu: "Asszisztens",
  },
  about_agent_assistente_desc: {
    it: "Il supporto. Risponde alle tue domande, ti guida nella configurazione, spiega le decisioni degli altri agenti. E il tuo punto di riferimento quando hai bisogno di aiuto o vuoi capire cosa sta succedendo.",
    en: "The helper. Answers your questions, guides you through configuration, explains other agents' decisions. It's your go-to when you need help or want to understand what's happening.",
    hu: "A támogató. Válaszol a kérdéseidre, végigvezet a konfiguráción, elmagyarázza más ügynökök döntéseit. Ő a kapcsolattartód, amikor segítségre van szükséged, vagy meg akarod érteni, mi történik.",
  },

  about_how_label: {
    it: "architettura",
    en: "architecture",
    hu: "architektúra",
  },
  about_how_title: {
    it: "Come funziona il sistema",
    en: "How the system works",
    hu: "Hogyan működik a rendszer",
  },
  about_how_desc: {
    it: "Job Hunter Team usa un'architettura multi-agente locale: ogni agente gira come worker indipendente, mentre il runtime coordina passaggi, stato e comunicazione tra i moduli.",
    en: "Job Hunter Team uses a local multi-agent architecture: each agent runs as an independent worker while the runtime coordinates handoffs, state, and communication between modules.",
    hu: "A Job Hunter Team helyi multi-ügynök architektúrát használ: minden ügynök önálló worker-ként fut, míg a futtatókörnyezet koordinálja az átadásokat, állapotot és kommunikációt a modulok között.",
  },
  about_how_0: {
    it: "Ogni agente gira come worker locale isolato",
    en: "Each agent runs as an isolated local worker",
    hu: "Minden ügynök elkülönített helyi worker-ként fut",
  },
  about_how_1: {
    it: "Il runtime orchestra passaggi e messaggi strutturati tra i moduli",
    en: "The runtime orchestrates handoffs and structured messages between modules",
    hu: "A futtatókörnyezet koordinálja az átadásokat és strukturált üzeneteket a modulok között",
  },
  about_how_2: {
    it: "Pipeline coordinata: Scout → Analista → Scorer → Scrittore → Critico",
    en: "Coordinated pipeline: Scout → Analyst → Scorer → Writer → Critic",
    hu: "Koordinált folyamat: Felfedező → Elemző → Pontozó → Író → Kritikus",
  },
  about_how_3: {
    it: "Task system con stato (pending → in-progress → done)",
    en: "Task system with state (pending → in-progress → done)",
    hu: "Feladat rendszer állapottal (függőben → folyamatban → kész)",
  },
  about_how_4: {
    it: "Sentinella monitora costi e salute in tempo reale",
    en: "Sentinel monitors costs and health in real-time",
    hu: "Az Őrszem valós időben figyeli a költségeket és az egészséget",
  },

  about_vision_label: { it: "visione", en: "vision", hu: "vízió" },
  about_vision_title: { it: "Il futuro", en: "The future", hu: "A jövő" },
  about_vision_desc: {
    it: "Stiamo costruendo il futuro della ricerca di lavoro automatizzata. La nostra visione e un sistema che impara dalle tue preferenze, migliora ad ogni candidatura, e ti permette di concentrarti su cio' che conta: prepararti per i colloqui.",
    en: "We're building the future of automated job hunting. Our vision is a system that learns from your preferences, improves with every application, and lets you focus on what matters: preparing for interviews.",
    hu: "Az automatizált álláskeresés jövőjét építjük. A víziónk egy olyan rendszer, amely tanul a preferenciáidból, fejlődik minden jelentkezéssel, és lehetővé teszi, hogy a lényegre koncentrálj: felkészülni az interjúkra.",
  },
  about_vision_0: {
    it: "Apprendimento continuo dal feedback dell'utente",
    en: "Continuous learning from user feedback",
    hu: "Folyamatos tanulás a felhasználói visszajelzésekből",
  },
  about_vision_1: {
    it: "Integrazione diretta con portali di candidatura",
    en: "Direct integration with application portals",
    hu: "Közvetlen integráció a jelentkezési portálokkal",
  },
  about_vision_2: {
    it: "Preparazione automatica ai colloqui con mock interview",
    en: "Automatic interview preparation with mock interviews",
    hu: "Automatikus interjúfelkészítés próbainterjúkkal",
  },
  about_vision_3: {
    it: "Networking assistito e follow-up automatizzati",
    en: "Assisted networking and automated follow-ups",
    hu: "Támogatott hálózatépítés és automatizált követések",
  },

  // Onboarding wizard
  ob_title: {
    it: "Benvenuto in Job Hunter Team",
    en: "Welcome to Job Hunter Team",
    hu: "Üdvözöljük a Job Hunter Team-ben",
  },
  ob_skip: { it: "Salta", en: "Skip", hu: "Kihagyás" },
  ob_next: { it: "Avanti", en: "Next", hu: "Következő" },
  ob_back: { it: "Indietro", en: "Back", hu: "Vissza" },
  ob_finish: {
    it: "Inizia a cercare",
    en: "Start searching",
    hu: "Keresés indítása",
  },
  ob_step: { it: "Passo", en: "Step", hu: "Lépés" },

  ob_s1_title: { it: "Benvenuto", en: "Welcome", hu: "Üdvözöljük" },
  ob_s1_desc: {
    it: "Job Hunter Team e il tuo team personale di agenti AI. Cercano offerte, le analizzano, scrivono CV e cover letter su misura — tutto in automatico, tutto sul tuo computer.",
    en: "Job Hunter Team is your personal AI agent team. They find listings, analyze them, write tailored CVs and cover letters — all automatically, all on your computer.",
    hu: "A Job Hunter Team a te személyes AI ügynök csapatod. Ajánlatokat keresnek, elemeznek, személyre szabott önéletrajzokat és motivációs leveleket írnak — mindezt automatikusan, a te számítógépeden.",
  },
  ob_s1_hint: {
    it: "Configuriamo insieme il tuo spazio in 5 passi veloci.",
    en: "Let's set up your workspace in 5 quick steps.",
    hu: "Állítsuk be együtt a munkateredet 5 gyors lépésben.",
  },

  ob_s2_title: {
    it: "Configura il profilo",
    en: "Set up your profile",
    hu: "Profil beállítása",
  },
  ob_s2_desc: {
    it: "Indica il tuo nome, il ruolo che cerchi e un breve riassunto della tua esperienza. Gli agenti useranno queste informazioni per personalizzare ogni candidatura.",
    en: "Enter your name, the role you're looking for and a brief summary of your experience. Agents will use this information to personalize every application.",
    hu: "Add meg a neved, a keresett pozíciót és a tapasztalataid rövid összefoglalóját. Az ügynökök ezeket az információkat fogják használni minden jelentkezés személyre szabásához.",
  },
  ob_s2_name: { it: "Nome", en: "Name", hu: "Név" },
  ob_s2_role: { it: "Ruolo target", en: "Target role", hu: "Cél pozíció" },
  ob_s2_bio: { it: "Breve bio", en: "Short bio", hu: "Rövid bemutatkozás" },

  ob_s3_title: {
    it: "Scegli le competenze",
    en: "Choose your skills",
    hu: "Válaszd ki a készségeidet",
  },
  ob_s3_desc: {
    it: "Seleziona le tecnologie e competenze che conosci. Lo Scorer le usera' per calcolare il match con ogni offerta.",
    en: "Select the technologies and skills you know. The Scorer will use them to compute the match with each listing.",
    hu: "Válaszd ki az ismert technológiákat és készségeket. A Pontozó ezeket fogja használni az illeszkedés kiszámításához minden ajánlathoz.",
  },
  ob_s3_hint: {
    it: "Clicca per selezionare, clicca di nuovo per deselezionare.",
    en: "Click to select, click again to deselect.",
    hu: "Kattints a kiválasztáshoz, kattints újra a kiválasztás megszüntetéséhez.",
  },

  ob_s4_title: {
    it: "Collega un provider AI",
    en: "Connect an AI provider",
    hu: "AI szolgáltató csatlakoztatása",
  },
  ob_s4_desc: {
    it: "Gli agenti girano su una delle tre CLI supportate (Claude Code, Codex, Kimi). Servira il login con l'abbonamento che hai gia attivo col provider; JHT non chiede ne memorizza chiavi API.",
    en: "Agents run on one of three supported CLIs (Claude Code, Codex, Kimi). You will sign in with the subscription you already have with the provider; JHT never asks for or stores API keys.",
    hu: "Az ügynökök három támogatott CLI valamelyikén futnak (Claude Code, Codex, Kimi). A szolgáltatónál már meglévő előfizetéssel kell bejelentkezned; a JHT soha nem kér és nem tárol API kulcsot.",
  },
  ob_s4_placeholder: {
    it: "claude login / codex login / kimi login",
    en: "claude login / codex login / kimi login",
    hu: "claude login / codex login / kimi login",
  },
  ob_s4_hint: {
    it: "Il login avviene dentro il container dal terminale della CLI scelta. I token di sessione restano gestiti dalla CLI in locale.",
    en: "Login happens inside the container from the chosen CLI terminal. Session tokens stay managed by the CLI, locally.",
    hu: "A bejelentkezés a konténeren belül történik a választott CLI termináljából. A munkamenet tokenek helyben maradnak, a CLI kezelése alatt.",
  },

  ob_s5_title: {
    it: "Avvia il primo agente",
    en: "Launch your first agent",
    hu: "Első ügynök indítása",
  },
  ob_s5_desc: {
    it: "Tutto pronto! Premi il bottone per avviare lo Scout — il primo agente che cerchera' offerte per te. Potrai avviare il team completo dalla pagina Team.",
    en: "All set! Press the button to launch the Scout — the first agent that will search listings for you. You can launch the full team from the Team page.",
    hu: "Minden kész! Nyomd meg a gombot a Felfedező elindításához — az első ügynök, amely ajánlatokat fog keresni neked. A teljes csapatot a Csapat oldalon indíthatod el.",
  },
  ob_s5_launch: {
    it: "Avvia Scout",
    en: "Launch Scout",
    hu: "Felfedező indítása",
  },
  ob_s5_skip_agent: {
    it: "Lo faro' dopo",
    en: "I'll do it later",
    hu: "Később megteszem",
  },
  ob_s5_launched: {
    it: "Scout avviato!",
    en: "Scout launched!",
    hu: "Felfedező elindítva!",
  },

  // ─── Home-beta: tabella top matches ───────────────────────────────
  table_title: {
    it: "Top {n} match",
    en: "Top {n} matches",
    hu: "Top {n} egyezés",
  },
  table_updated: { it: "Aggiornato", en: "Updated", hu: "Frissítve" },
  table_match_score: { it: "Match Score", en: "Match Score", hu: "Egyezés" },
  table_title_col: { it: "Titolo", en: "Title", hu: "Pozíció" },
  table_company: { it: "Azienda", en: "Company", hu: "Cég" },
  table_location: { it: "Località", en: "Location", hu: "Helyszín" },
  table_salary: { it: "Stipendio", en: "Salary", hu: "Fizetés" },
  table_cv: { it: "CV", en: "CV", hu: "Önéletrajz" },
  table_empty: {
    it: "Nessuna posizione ancora.",
    en: "No positions yet.",
    hu: "Még nincsenek pozíciók.",
  },

  // ─── Home-beta: nodi del team flow ────────────────────────────────
  agent_captain: { it: "Capitano", en: "Captain", hu: "Kapitány" },
  agent_scout: { it: "Scout", en: "Scout", hu: "Scout" },
  agent_analyst: { it: "Analista", en: "Analyst", hu: "Analista" },
  agent_scorer: { it: "Scorer", en: "Scorer", hu: "Scorer" },
  agent_writer: { it: "Scrittore", en: "Writer", hu: "Író" },
  agent_critic: { it: "Critico", en: "Critic", hu: "Kritikus" },

  // ─── Home-beta: speech bubbles del team flow ──────────────────────
  chat_captain_go: {
    it: "OK team, partiamo!",
    en: "OK team, let's go!",
    hu: "OK csapat, gyerünk!",
  },
  chat_captain_profile: {
    it: "Target: Sommelier in hotel 5★",
    en: "Target: Sommelier at 5★ hotels",
    hu: "Cél: Sommelier 5★ hotelekben",
  },
  chat_scout_europe: {
    it: "Trovati 3 in Europa!",
    en: "Found 3 in Europe!",
    hu: "Találtam 3-at Európában!",
  },
  chat_scout_asia: {
    it: "Asia in arrivo…",
    en: "Asia incoming…",
    hu: "Ázsia jön…",
  },
  chat_scout_usa: {
    it: "Grande mercato USA!",
    en: "Big USA market!",
    hu: "Nagy USA piac!",
  },
  chat_analyst_check: {
    it: "Verifico il match…",
    en: "Checking fit…",
    hu: "Illeszkedést ellenőrzöm…",
  },
  chat_captain_good: {
    it: "Tutto bene",
    en: "Looking good",
    hu: "Jól néz ki",
  },
  chat_scorer_top: {
    it: "Top match trovati",
    en: "Top matches found",
    hu: "Top egyezések megvannak",
  },
  chat_writer_cvs: {
    it: "Scrivo i CV…",
    en: "Writing CVs…",
    hu: "Önéletrajzokat írok…",
  },
  chat_critic_reviewing: {
    it: "Revisione…",
    en: "Reviewing…",
    hu: "Felülvizsgálom…",
  },

  // ─── Login page (LandingClient) ───────────────────────────────────
  login_save_progress: {
    it: "Accedi per salvare i tuoi progressi",
    en: "Sign in to save your progress",
    hu: "Jelentkezz be a haladásod mentéséhez",
  },
  login_auth_failed: {
    it: "Autenticazione fallita.",
    en: "Authentication failed.",
    hu: "A hitelesítés sikertelen.",
  },
  login_config_missing: {
    it: "Configurazione mancante.",
    en: "Configuration missing.",
    hu: "Hiányzó konfiguráció.",
  },
  login_with_google: {
    it: "Accedi con Google",
    en: "Login with Google",
    hu: "Bejelentkezés Google-lel",
  },
  login_with_github: {
    it: "Accedi con GitHub",
    en: "Login with GitHub",
    hu: "Bejelentkezés GitHub-bal",
  },
  back: { it: "Indietro", en: "Back", hu: "Vissza" },

  // ─── Relative time (LatestPositionsTable) ─────────────────────────
  rel_just_now: {
    it: "adesso",
    en: "just now",
    hu: "épp most",
  },
  rel_m_ago: {
    it: "{n}m fa",
    en: "{n}m ago",
    hu: "{n} perce",
  },
  rel_h_ago: {
    it: "{n}h fa",
    en: "{n}h ago",
    hu: "{n} órája",
  },
  rel_d_ago: {
    it: "{n}g fa",
    en: "{n}d ago",
    hu: "{n} napja",
  },
  rel_mo_ago: {
    it: "{n}mes fa",
    en: "{n}mo ago",
    hu: "{n} hónapja",
  },
  table_cv_written: {
    it: "CV scritto",
    en: "CV written",
    hu: "Önéletrajz megírva",
  },

  // ─── Aria-labels (mockup / placeholder / scroll / nav / cookie) ───
  dashboard_preview_alt: {
    it: "Anteprima della dashboard: lista di posizioni con punteggi, barre, donut e andamento",
    en: "Dashboard preview: list of positions with scores, bars, donut and trend",
    hu: "Irányítópult előnézet: pozíciók listája pontszámokkal, sávokkal, fánkdiagrammal és trenddel",
  },
  image_placeholder: {
    it: "Immagine — placeholder",
    en: "Image — placeholder",
    hu: "Kép — helykitöltő",
  },
  scroll_to_top: {
    it: "Torna in cima",
    en: "Back to top",
    hu: "Vissza a tetejére",
  },
  nav_main: {
    it: "Navigazione principale",
    en: "Main navigation",
    hu: "Fő navigáció",
  },
  nav_menu: { it: "Menu", en: "Menu", hu: "Menü" },
  nav_language: {
    it: "Lingua: {label}",
    en: "Language: {label}",
    hu: "Nyelv: {label}",
  },
  cookie_consent: {
    it: "Consenso ai cookie",
    en: "Cookie consent",
    hu: "Cookie hozzájárulás",
  },

  // ─── CTA / Footer aria-labels (LandingCTA) ────────────────────────
  cta_section_aria: {
    it: "Inizia ora",
    en: "Get started",
    hu: "Kezdés",
  },
  theme_aria: { it: "Tema", en: "Theme", hu: "Téma" },
  footer_aria: {
    it: "Footer Job Hunter Team",
    en: "Job Hunter Team footer",
    hu: "Job Hunter Team lábléc",
  },
  footer_links_aria: {
    it: "Link footer",
    en: "Footer links",
    hu: "Lábléc hivatkozások",
  },

  // ─── LandingHome: hero alt + sezioni ──────────────────────────────
  home_hero_alt: {
    it: "Illustrazione a fumetto: un team di agenti AI — tutti con gli stessi occhiali da sole neri — seduto attorno a un lungo tavolo da riunione in un elegante ufficio in grattacielo, mentre un agente in piedi presenta dei grafici su una lavagna.",
    en: "Comic-style illustration: a team of AI agents — all wearing the same black sunglasses — seated around a long boardroom table in an elegant high-rise office, while one standing agent presents charts on a whiteboard.",
    hu: "Képregény stílusú illusztráció: AI ügynökök csapata — mind ugyanazt a fekete napszemüveget viselve — egy hosszú tárgyalóasztal körül ül egy elegáns felhőkarcoló irodában, miközben egy álló ügynök diagramokat mutat be egy táblán.",
  },
  home_team_alt: {
    it: "Tre agenti del team a figura intera: lo Scout con la lente, l'Analista in camice, lo Scrittore con la penna d'oca — tutti con gli occhiali da sole.",
    en: "Three full-body team agents: the Scout with a magnifying glass, the Analyst in a lab coat, the Writer with a quill pen — all wearing sunglasses.",
    hu: "Három teljes alakos csapatügynök: a Scout nagyítóval, az Analista fehér köpenyben, az Író lúdtollal — mind napszemüvegben.",
  },
  home_setup_alt: {
    it: "Un laptop da cui esce un cono di luce blu che si apre fino a un cubo di vetro luminoso: dentro c'è l'ufficio del team al lavoro.",
    en: "A laptop emitting a blue cone of light that opens into a glowing glass cube: inside is the team's office at work.",
    hu: "Egy laptop, amelyből kék fénykúp árad, és egy világító üvegkockává nyílik: belül a csapat irodája dolgozik.",
  },
  home_pricing_alt: {
    it: "Un lucchetto aperto circondato da poche monete, una verde luminosa: la piattaforma è gratuita e open source, paghi solo il provider AI.",
    en: "An open padlock surrounded by a few coins, one glowing green: the platform is free and open source, you only pay the AI provider.",
    hu: "Egy nyitott lakat néhány érmével körülvéve, egy zölden világít: a platform ingyenes és nyílt forráskódú, csak az AI-szolgáltatót fizeted.",
  },

  home_team_kicker: { it: "Il team", en: "The team", hu: "A csapat" },
  home_team_title: {
    it: "Una squadra, non un singolo bot",
    en: "A team, not a single bot",
    hu: "Egy csapat, nem egyetlen bot",
  },
  home_team_body: {
    it: "Un solo chatbot deve fare tutto da sé e non eccelle in niente. Una squadra no: ogni agente ha un compito preciso e lo porta a fondo, e il lavoro di ciascuno passa al vaglio di quello successivo. Così ogni fase è curata da chi la sa fare meglio, e quello che arriva a te è già stato controllato più volte.",
    en: "A single chatbot spreads itself thin and masters nothing. Here every agent has one job and goes deep — and nothing one produces goes unchecked: each step is reviewed by the next. The focus of a specialist at every stage, not one generalist cutting corners.",
    hu: "Egyetlen chatbotnak mindent magának kell csinálnia, és semmiben sem jeleskedik. Egy csapatnál ez másképp van: minden ügynöknek egy pontos feladata van, amelyet alaposan elvégez, és mindegyikük munkáját a következő ellenőrzi. Így minden szakaszt az gondoz, aki a legjobban ért hozzá, és ami hozzád eljut, azt már többször ellenőrizték.",
  },
  home_team_cta: {
    it: "Scopri il team →",
    en: "Meet the team →",
    hu: "Ismerd meg a csapatot →",
  },
  home_dashboard_kicker: {
    it: "La tua dashboard",
    en: "Your dashboard",
    hu: "A te irányítópultod",
  },
  home_dashboard_title: {
    it: "Tutto sotto controllo, dal web",
    en: "Everything in view, from the web",
    hu: "Minden áttekinthető, a webről",
  },
  home_dashboard_body: {
    it: "Vedi ogni posizione trovata, il punteggio di compatibilità, la mappa delle opportunità per città e paese, lo stato delle tue candidature. Registrati per ritrovare tutto ovunque — ma non è obbligatorio: puoi tenere ogni dato solo sul tuo computer, senza cloud.",
    en: "See every opening found, its match score, the map of opportunities by city and country, the status of your applications. Sign up to find it all anywhere — but it's not required: you can keep every piece of data on your own computer, no cloud.",
    hu: "Lásd minden megtalált ajánlatot, az illeszkedési pontszámot, a lehetőségek térképét város és ország szerint, a jelentkezéseid állapotát. Regisztrálj, hogy bárhol megtaláld mindezt — de nem kötelező: minden adatot megtarthatsz csak a saját számítógépeden, felhő nélkül.",
  },
  home_dashboard_cta: {
    it: "Accedi o registrati →",
    en: "Sign in or sign up →",
    hu: "Jelentkezz be vagy regisztrálj →",
  },
  home_dashboard_note: {
    it: "Login facoltativo · i tuoi dati possono restare solo sul tuo PC.",
    en: "Login optional · your data can stay only on your PC.",
    hu: "A bejelentkezés opcionális · az adataid csak a PC-den maradhatnak.",
  },
  home_setup_kicker: { it: "Avvialo", en: "Run it", hu: "Indítsd el" },
  home_setup_title: {
    it: "Come vuoi, dove vuoi",
    en: "However and wherever you want",
    hu: "Ahogy és ahol szeretnéd",
  },
  home_setup_body: {
    it: "Gira su un computer dedicato sempre acceso o su una VPS economica, e lavora per te giorno e notte. Lo gestisci dall'app desktop: avvii, fermi e tieni d'occhio la squadra con un clic. E non sei costretto a stare al computer: dal web puoi seguire i risultati e parlare con il team anche da un altro PC o dal telefono.",
    en: "It runs on an always-on dedicated computer or an affordable VPS, working for you day and night. You manage it from the desktop app: start, stop and keep an eye on the team with one click. And you're not tied to that computer: from the web you can follow the results and talk to the team from another PC or your phone too.",
    hu: "Egy mindig bekapcsolt dedikált számítógépen vagy egy megfizethető VPS-en fut, és éjjel-nappal dolgozik érted. Az asztali appból kezeled: egyetlen kattintással indítod, leállítod és szemmel tartod a csapatot. És nem vagy ahhoz a géphez kötve: a webről is követheted az eredményeket, és beszélhetsz a csapattal egy másik PC-ről vagy a telefonodról is.",
  },
  home_setup_cta: {
    it: "Come si avvia →",
    en: "How to run it →",
    hu: "Hogyan indítsd el →",
  },
  home_pricing_kicker: { it: "Prezzi", en: "Pricing", hu: "Árak" },
  home_pricing_title: {
    it: "Open source. La piattaforma è gratis.",
    en: "Open source. The platform is free.",
    hu: "Nyílt forráskód. A platform ingyenes.",
  },
  home_pricing_body: {
    it: "Job Hunter Team non si paga. L'unico costo è l'abbonamento al provider AI che scegli — da circa €40 al mese — oppure nulla, se un domani userai modelli locali e pagherai solo l'elettricità.",
    en: "Job Hunter Team is free. The only cost is the subscription to the AI provider you choose — from about €40 a month — or nothing, if one day you use local models and pay only for electricity.",
    hu: "A Job Hunter Team ingyenes. Az egyetlen költség az általad választott AI szolgáltató előfizetése — körülbelül €40-tól havonta — vagy semmi, ha egy nap helyi modelleket használsz és csak az áramért fizetsz.",
  },
  home_pricing_cta: {
    it: "Vedi i costi →",
    en: "See the costs →",
    hu: "Lásd a költségeket →",
  },
  home_project_kicker: {
    it: "Il progetto",
    en: "The project",
    hu: "A projekt",
  },
  home_project_title: {
    it: "Cosa c'è dietro, in chiaro",
    en: "What's behind it, in the open",
    hu: "Mi van mögötte, nyíltan",
  },
  home_project_body: {
    it: "Codice aperto, dati tuoi, nessun vincolo. Scopri com'è fatto Job Hunter Team, la filosofia dietro alla squadra di agenti e dove sta andando.",
    en: "Open code, your data, no lock-in. See how Job Hunter Team is built, the philosophy behind the agent team, and where it's headed.",
    hu: "Nyílt kód, a te adataid, semmi kötöttség. Nézd meg, hogyan épül fel a Job Hunter Team, az ügynökcsapat mögötti filozófiát, és merre tart.",
  },
  home_project_cta: {
    it: "Scopri il progetto →",
    en: "Discover the project →",
    hu: "Fedezd fel a projektet →",
  },
  home_studies_kicker: {
    it: "Case studies",
    en: "Case studies",
    hu: "Esettanulmányok",
  },
  home_studies_title: {
    it: "Cosa fa davvero, sul campo",
    en: "What it really does, in the field",
    hu: "Mit csinál valójában, a terepen",
  },
  home_studies_body: {
    it: "Non promesse, ma risultati: cosa ha prodotto il team su profili candidato reali — posizioni trovate, analizzate e valutate. Dati aggregati e anonimi, una pagina che cresce a ogni nuovo team monitorato.",
    en: "Not promises but results: what the team produced on real candidate profiles — positions found, analyzed and scored. Aggregated, anonymous data; a page that grows with every team we monitor.",
    hu: "Nem ígéretek, hanem eredmények: mit termelt a csapat valódi jelölti profilokon — megtalált, elemzett és pontozott pozíciók. Aggregált, anonim adatok; egy oldal, amely minden új megfigyelt csapattal bővül.",
  },
  home_studies_cta: {
    it: "Vedi i case study →",
    en: "See the case studies →",
    hu: "Lásd az esettanulmányokat →",
  },
} as const;

type StringKeys = {
  [K in keyof typeof translations]: (typeof translations)[K]["it"] extends string
    ? K
    : never;
}[keyof typeof translations];
type ArrayKeys = {
  [K in keyof typeof translations]: (typeof translations)[K]["it"] extends readonly string[]
    ? K
    : never;
}[keyof typeof translations];

interface I18nCtx {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKeys) => string;
  ta: (key: ArrayKeys) => string[];
}

const LandingI18nContext = createContext<I18nCtx>({
  lang: "en",
  setLang: () => {},
  t: (key) => translations[key].en as string,
  ta: (key) => Array.from(translations[key].en),
});

export function useLandingI18n() {
  return useContext(LandingI18nContext);
}

export function LandingI18nProvider({ children }: { children: ReactNode }) {
  // Inizializza sempre con 'en' per evitare hydration mismatch
  // Dopo il mount, legge il localStorage
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = getSavedLang();
    setLangState(saved);
    fetch("/api/i18n", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: saved }),
    }).catch(() => {
      /* best effort */
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    fetch("/api/i18n", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: l }),
    }).catch(() => {
      /* best effort */
    });
  }, []);

  const t = useCallback(
    (key: StringKeys) => {
      // Overlay lingua → base[lang] → fallback su `en`.
      const o = overlays[lang]?.[key];
      if (o) return o;
      const entry = translations[key] as Record<string, string>;
      return entry[lang] ?? entry.en;
    },
    [lang],
  );

  const ta = useCallback(
    (key: ArrayKeys) => {
      const entry = translations[key] as Record<string, readonly string[]>;
      return Array.from(entry[lang] ?? entry.en);
    },
    [lang],
  );

  return (
    <LandingI18nContext.Provider value={{ lang, setLang, t, ta }}>
      {children}
      <Suspense>
        <CookieConsent />
      </Suspense>
    </LandingI18nContext.Provider>
  );
}
