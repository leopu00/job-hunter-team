// /case-studies/benchmark-0-4-0: first comparison of the 0.4.0 test rounds (services × systems).
// Static data in web/data/benchmark/benchmark-0-4-0.json (synthetic profiles only); the existing case studies page is untouched.

import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { LandingI18nProvider } from "../../components/landing/LandingI18n";
import LandingNav from "../../components/landing/LandingNav";
import { getRequestLocale } from "@/lib/request-locale";
import type { Locale } from "@/i18n/config";
import data from "@/data/benchmark/benchmark-0-4-0.json";
import BenchmarkCharts, { type BenchProfile, type BetaDay, type BuildPoint, type ChartRound } from "./BenchmarkCharts";
import { CHART_COPY } from "./chartsCopy";
import BenchmarkFinder, {
  type CandidateView,
  type FinderCopy,
} from "./BenchmarkFinder";
import type { Sector } from "@/lib/benchmark-match";
import { CASE_STUDIES, localizeCaseStudy } from "@/lib/case-studies";

export const dynamic = "force-dynamic";

type Round = (typeof data.rounds)[number];
type Copy = {
  metaTitle: string;
  title: string;
  lead: string;
  banner: string;
  roundsTitle: string;
  cols: {
    round: string;
    profile: string;
    minutes: string;
    spent: string;
    found: string;
    perScored: string;
    outcome: string;
    note: string;
  };
  colsHint: string;
  chartTitle: string;
  chartLead: string;
  chartNone: string;
  chartCaveat: string;
  servicesTitle: string;
  servicesCols: {
    service: string;
    kit: string;
    seen: string;
    rate: string;
  };
  servicesCaveat: string;
  osTitle: string;
  limitsTitle: string;
  limitsLead: string;
  limits: string[];
  needTitle: string;
  need: string;
  back: string;
  footer: string;
  tuxCredit: string;
  outcome: Record<string, string>;
  system: Record<string, string>;
  profiles: Record<string, string>;
  modes: Record<string, string>;
  services: Record<string, string>;
  notes: Record<string, string>;
  osNotes: Record<string, string>;
  night: string;
  day: string;
  targetsTitle: string;
  targetsLead: string;
  targetsCount: string;
  targetsCols: { target: string; status: string; build: string; proof: string };
  targetStatus: Record<string, string>;
  targets: Record<string, string>;
  targetNotes: Record<string, string>;
  targetSections: Record<string, string>;
  targetRows: Record<string, string>;
  buildsTitle: string;
  buildLabel: string;
  noRound: string;
  none: string;
  finder: FinderCopy;
};

const T: Record<Locale, Copy> = {
  en: {
    metaTitle: "0.4.0 benchmark · Job Hunter Team",
    title: "0.4.0 benchmark: four services, three systems",
    lead: "What the team spent and found in the test rounds of 14-17 November 2026, with the API-key services the 0.4.0 harness offers. Numbers come from the test reports and the cost samplers.",
    banner:
      "A first comparison, not a clean benchmark. Machines, profiles, builds, budgets and team sizes differ between rounds, and there is one round per service: read the limits below before comparing.",
    roundsTitle: "Every round",
    cols: {
      round: "Round",
      profile: "Profile",
      minutes: "Minutes",
      spent: "Spent",
      found: "Found / scored / relevant",
      perScored: "$ per scored",
      outcome: "Outcome",
      note: "What happened",
    },
    colsHint:
      "«Relevant» = positions whose title matches the trade, checked on a sample.",
    chartTitle: "What a scored position costs",
    chartLead:
      "Dollars spent for each position the team scored. Shorter is better. Rounds with no scored position have no bar.",
    chartNone: "none scored",
    chartCaveat:
      "The two Mac rounds were 6 and 10 minutes with a minimal team, and the cost is mostly onboarding and the Captain: not comparable with rounds of 16-42 minutes.",
    servicesTitle: "Services: what we saw next to the estimates",
    servicesCols: {
      service: "Service",
      kit: "Estimate for 30 min",
      seen: "Seen in the rounds",
      rate: "Pace seen",
    },
    servicesCaveat:
      "The estimates come from GLM's volume re-priced, not from measurements on the other services. Claude on Windows spent more than estimated: the Captain and the Scorer weigh 3.05 $ of 5.28 $.",
    osTitle: "By system",
    limitsTitle: "What this comparison is worth, and what it is not",
    limitsLead:
      "Each round differs from the others in something that weighs on the numbers:",
    limits: [
      "different machines: a 2 vCPU / 4 GB Linux VPS, a Windows laptop, a Mac with other programs running;",
      "different profiles (data analyst, restorer, waiter, receptionist, truck driver) and different job markets;",
      "different builds and budgets (3 $ ceiling, 5 $ for 30 minutes preset);",
      "different team sizes: 5/3/2 on Linux, 1/1/1 on the Mac and on the Windows night round, because of a defect in the budget brake;",
      "short working times (6-42 minutes) and one round per service: below a 25% difference you cannot tell noise from signal.",
    ],
    needTitle: "What a clean benchmark needs",
    need: "Four identical VPSs started together, the same profile for everyone, 30 minutes of work after onboarding, the same build with the budget brake fixed, and credit on all four services.",
    back: "← All case studies",
    tuxCredit: "Tux, the Linux penguin: Larry Ewing and The GIMP.",
    footer:
      "Synthetic profiles, no personal data · numbers from the test reports of 14-17/11/2026.",
    outcome: {
      pass: "pass",
      reservations: "with reservations",
      fail: "fail",
      running: "running",
    },
    system: {
      pass: "passes",
      withReservations: "passes with reservations",
      running: "in progress",
    },
    profiles: {
      bricklayer: "Bricklayer",
      officeClerk: "Office clerk, part time",
      dataAnalyst: "Data analyst",
      generic: "Generic test profile",
      restorer: "Restorer",
      waiter: "Waiter",
      receptionist: "Receptionist",
      truckDriver: "Truck driver",
    },
    modes: { onsite: "on site", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI → GLM",
    },
    notes: {
      updateSwitchKept: "Update with the team running: data kept, old images removed, GLM → Claude without stopping the team. 3 relevant of 26 new in 10 minutes.",
      updateWelcomePaid: "Update and switch to Claude: 15 relevant of 18 in 12 minutes. The welcome was paid again at every restart.",
      cleanInstallWarehouse: "New user, guided onboarding: the brake stopped at 2.67 $. Mostly warehouse jobs: 2 relevant of 19.",
      updateNoNewPositions: "Update fine and no key file left on disk, but 0 new positions in 30 minutes: only 2 Scouts woken.",
      diskLowAfterUpdate: "Update fine, team never started: 4 GiB free of the 8 needed, with no warning before the download.",
      cleanInstallGerman: "New user in German: 10 relevant of 26. The brake stopped at 4.77 $, then a false unlock (4.95 $ at the end); Doctor and Maintainer did no turn.",
      scoutsNoTools:
        "Scouts had no tools from the CLI (fixed); CPU saturated on 2 vCPU.",
      creditEnded: "Same defect; the GLM credit ran out.",
      minimalTeam:
        "Minimal team (1/1/1); setup→up refused after --reset (fixed).",
      ceilingReached: "Spending ceiling of 3 $ reached in under 6 minutes.",
      wrongSources:
        "Remote and IT boards for a person working on site (fixed).",
      budgetFromSetup: "Budget counted from the setup (15 minutes lost).",
      brakeDidNotTrigger:
        "The budget brake did not trigger: stopped by the test at 5.28 $.",
      noCredit:
        "OpenAI had no credit and the machine shut down with the terminal: no Scout started, 0 positions in 30 minutes; only the Assistant (on GLM) spent 0.23 $.",
    },
    osNotes: {
      linux:
        "Install, time zone, budget presets, 5/3/2 team and brake work. The «trade outside IT, on site» case passes (10 relevant of 14).",
      windows:
        "First real round with the new scripts: install fine, 50 relevant positions. Open: budget brake and team size do not act; team does not grow back after a switch.",
      macos:
        "Round 19 passed with defects, all blockers fixed. Night round failed (OpenAI out of credit, machine off with the terminal); open: the machine shuts down when the terminal closes.",
    },
    night: "night",
    day: "",
    targetsTitle: "Release targets",
    targetsLead: "0.4.0 is released only when every row is green. Updated at every build; the proof links to the round below.",
    targetsCount: "{g} of {n} green",
    targetsCols: {
      "target": "Target",
      "status": "Status",
      "build": "Build",
      "proof": "Proof"
    },
    targetStatus: {
      "pass": "met",
      "fail": "not met",
      "pending": "to try",
      "blocked": "blocked"
    },
    targets: {
      "scoutBenchCook": "Scout bench · cook",
      "scoutBenchWarehouse": "Scout bench · warehouse worker",
      "scoutBenchNurse": "Scout bench · nurse",
      "scoutBenchBricklayer": "Scout bench · bricklayer",
      "languageWindows": "Setup and onboarding in the chosen language · Windows",
      "languageLinux": "Setup and onboarding in the chosen language · Linux",
      "languageMac": "Setup and onboarding in the chosen language · Mac",
      "preTagReview": "Security review before the tag",
      "installWindows": "Install by a new user · Windows",
      "installLinux": "Install by a new user · Linux",
      "installMac": "Install by a new user · Mac",
      "updateLinux": "Update with a team and data already there · Linux",
      "updateMac": "Update with a team and data already there · Mac",
      "updateWindows": "Update with a team and data already there · Windows",
      "nonItRelevant": "Profile outside IT, on site: at least 70% relevant positions",
      "scoutBench": "Scout bench, 4 trades outside IT (≥70% relevant, 0 duplicates, ≥15 positions)",
      "budgetBrake": "Budget brake: never over the ceiling, no false unlock, the person is told",
      "language": "Setup and onboarding in the chosen language",
      "doctorMaintainer": "The Doctor and the Maintainer really work",
      "serviceClaude": "Claude service",
      "serviceOpenai": "OpenAI service with an API key",
      "serviceGlmKimi": "GLM and Kimi services",
      "openaiSubscription": "OpenAI on Pi with a ChatGPT subscription",
      "noKeyOnDisk": "No key left on disk",
      "betaTester": "Beta test: version updated and team at work"
    },
    targetNotes: {
      "updateLinuxBuild9": "build 9: passed (its round is not in the table below)",
      "installerBlockedBuild9": "build 9: stopped by the installer (fix in build 10, round under way)",
      "benchCook": "79% relevant",
      "benchWarehouse": "90% relevant",
      "benchNurse": "1 duplicate (94% relevant)",
      "benchBricklayer": "6 positions, fewer than 15 (83% relevant)",
      "brakeFixedRetry": "fixed in builds 9 and 10: to try again",
      "languageGermanOk": "build 9: German all the way on Linux",
      "chatgptFreeRefused": "sign-in refused (Free plan)",
      "securityPreTag": "review before the tag: no P0 or P1; the key-on-disk case is closed",
      "cleanLinuxRoundMissing": "clean install on build 6: its round is not in the table below (r9 is an update)",
      "openaiRoundMissing": "proved on build 6: its round is not in the table below",
      "redoOnBuild9": "to redo on build 9",
      "diskFull": "disk full after the update (fix in progress)",
      "neverTried": "never tried",
      "relevantBelow": "0 new for the bricklayer, 10 of 26 for the receptionist",
      "benchPaused": "paused until build 9",
      "brakeFalseClear": "false unlock after the stop, the warning to the person failed",
      "languageEnglish": "API key step, team start and status in English (fixed after build 8)",
      "zeroTurns": "0 turns (fixed in build 9)",
      "noCredit": "no credit to try them",
      "loginNeverTried": "real sign-in never tried",
      "keysChecked": "0 files with a key outside their place, on 20,927 file events",
      "updateOnBuild9": "update on build 9"
    },
    targetSections: {
      "install": "Install by a new user",
      "update": "Update with a team and data",
      "scout": "Scout, trades outside IT",
      "brake": "Spending brake",
      "language": "Language",
      "doctor": "Doctor and Maintainer",
      "services": "Services",
      "security": "Security",
      "beta": "Beta tester",
    },
    targetRows: {
      "install": "Install by a new user",
      "update": "Update with a team and data already there",
      "language": "Setup and onboarding in the chosen language",
    },
    buildsTitle: "Rounds of each build",
    buildLabel: "Build {n}",
    noRound: "no round",
    none: "—",
    finder: {
      title: "Find the tests closest to your case",
      lead: "Say which computer you have, which service you would use, your budget and your trade. You see the rounds and case studies that match, then the closest ones, with the reason. In our tests, with our profiles: not a promise of what you will get.",
      computer: "Your computer",
      service: "Service",
      budget: "Budget (US dollars)",
      budgetHint: "What you would spend, e.g. 15",
      trade: "Your trade",
      tradeHint: "Free text; the suggestions are the trades of our tests",
      sector: "Sector",
      any: "Any",
      reset: "Clear the fields",
      searchLabel: "Find tests close to your case",
      prompt:
        "Fill in at least one field to see the tests closest to your case.",
      matchTitle: "They match",
      closeTitle: "The closest",
      none: "No round or case study is close to this: change a field.",
      count: "{n} tests found",
      roundKind: "Round",
      caseKind: "Case study",
      openCase: "Open the case study",
      nothingExact:
        "None matches every field you filled in: here are the closest.",
      disclaimer:
        "In our tests, with synthetic profiles and the builds shown. What you get depends on your CV, your market and your budget; we do not promise a result.",
      whyLabel: "Why:",
      estimateLabel: "estimate",
      estimateMore:
        "With {b} $ ≈ {x}× what this round spent ({c} $). A proportion, not a promise: costs and results do not scale in a straight line.",
      estimateLess:
        "With {b} $ ≈ {x}% of what this round spent ({c} $). A proportion, not a promise: a smaller budget may stop the team earlier.",
      sectors: {
        hospitality: "Hospitality and catering",
        health: "Health",
        trades: "Trades and crafts",
        office: "Office and finance",
        culture: "Culture and heritage",
        it: "IT",
        transport: "Transport and logistics",
      },
      reasons: {
        "service-same": "same service ({v})",
        "service-other": "another service ({v})",
        "os-same": "same system ({v})",
        "os-other": "another system ({v})",
        "sector-same": "same sector ({v})",
        "sector-other": "another sector ({v})",
        "trade-same": "same trade",
        "trade-similar": "similar trade ({v})",
        "budget-close": "close budget ({v} $ spent)",
        "budget-other": "this one spent {v} $, you have {w} $",
      },
    },
  },
  it: {
    metaTitle: "Benchmark 0.4.0 · Job Hunter Team",
    title: "Benchmark 0.4.0: quattro servizi, tre sistemi",
    lead: "Quanto ha speso e trovato la squadra nei giri di prova del 14-17 novembre 2026, con i servizi a chiave API che l'harness 0.4.0 offre. I numeri vengono dai verbali dei collaudi e dai campionatori dei costi.",
    banner:
      "Un primo confronto, non un benchmark pulito. Macchine, profili, build, budget e dimensioni della squadra cambiano da un giro all'altro, e c'è un giro per servizio: leggi i limiti qui sotto prima di confrontare.",
    roundsTitle: "Ogni giro",
    cols: {
      round: "Giro",
      profile: "Profilo",
      minutes: "Minuti",
      spent: "Spesa",
      found: "Trovate / valutate / pertinenti",
      perScored: "$ per valutata",
      outcome: "Esito",
      note: "Cosa è successo",
    },
    colsHint:
      "«Pertinenti» = posizioni il cui titolo corrisponde al mestiere, controllate a campione.",
    chartTitle: "Quanto costa una posizione valutata",
    chartLead:
      "Dollari spesi per ogni posizione valutata dalla squadra. Più corta è la barra, meglio è. I giri senza posizioni valutate non hanno barra.",
    chartNone: "nessuna valutata",
    chartCaveat:
      "I due giri del Mac sono durati 6 e 10 minuti con una squadra minima, e il costo è quasi tutto onboarding e Capitano: non sono confrontabili con giri di 16-42 minuti.",
    servicesTitle: "Servizi: quello che abbiamo visto accanto alle stime",
    servicesCols: {
      service: "Servizio",
      kit: "Stima per 30 min",
      seen: "Visto nei giri",
      rate: "Ritmo visto",
    },
    servicesCaveat:
      "Le stime vengono dal volume di GLM riprezzato, non da misure sugli altri servizi. Claude su Windows ha speso più della stima: Capitano e Scorer pesano 3,05 $ su 5,28 $.",
    osTitle: "Per sistema",
    limitsTitle: "Cosa vale e cosa no di questo confronto",
    limitsLead:
      "Ogni giro differisce dagli altri per qualcosa che pesa sui numeri:",
    limits: [
      "macchine diverse: una VPS Linux con 2 vCPU e 4 GB, un portatile Windows, un Mac con altri programmi accesi;",
      "profili diversi (data analyst, restauratrice, cameriere, receptionist, autista) e mercati del lavoro diversi;",
      "build e budget diversi (tetto di 3 $, preset 5 $ per 30 minuti);",
      "squadre di dimensioni diverse: 5/3/2 su Linux, 1/1/1 sul Mac e sul giro Windows di notte, per un difetto del freno del budget;",
      "tempi di lavoro corti (6-42 minuti) e un solo giro per servizio: sotto il 25% di differenza non si distingue il rumore dal segnale.",
    ],
    needTitle: "Cosa serve per un benchmark pulito",
    need: "Quattro VPS uguali accese insieme, lo stesso profilo per tutti, 30 minuti di lavoro dopo l'onboarding, la stessa build con il freno del budget corretto e credito su tutti e quattro i servizi.",
    back: "← Tutti i case study",
    tuxCredit: "Tux, il pinguino di Linux: Larry Ewing e The GIMP.",
    footer:
      "Profili finti, nessun dato personale · numeri dai verbali dei collaudi del 14-17/11/2026.",
    outcome: {
      pass: "passa",
      reservations: "con riserva",
      fail: "non passa",
      running: "in corso",
    },
    system: {
      pass: "passa",
      withReservations: "passa con riserva",
      running: "in corso",
    },
    profiles: {
      bricklayer: "Muratore",
      officeClerk: "Impiegata amministrativa part time",
      dataAnalyst: "Data analyst",
      generic: "Profilo di prova generico",
      restorer: "Restauratrice",
      waiter: "Cameriere",
      receptionist: "Receptionist",
      truckDriver: "Autista C+E",
    },
    modes: { onsite: "in sede", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI → GLM",
    },
    notes: {
      updateSwitchKept: "Aggiornamento a squadra accesa: dati tenuti, immagini vecchie tolte, GLM → Claude senza fermare la squadra. 3 pertinenti su 26 nuove in 10 minuti.",
      updateWelcomePaid: "Aggiornamento e passaggio a Claude: 15 pertinenti su 18 in 12 minuti. Il benvenuto è stato pagato di nuovo a ogni ripartenza.",
      cleanInstallWarehouse: "Utente nuovo, onboarding guidato: il freno ha fermato a 2,67 $. Quasi solo magazzino: 2 pertinenti su 19.",
      updateNoNewPositions: "Aggiornamento riuscito e nessun file con chiave su disco, ma 0 posizioni nuove in 30 minuti: svegliati solo 2 Scout.",
      diskLowAfterUpdate: "Aggiornamento riuscito, squadra mai partita: 4 GiB liberi degli 8 necessari, senza avviso prima dello scaricamento.",
      cleanInstallGerman: "Utente nuovo in tedesco: 10 pertinenti su 26. Il freno ha fermato a 4,77 $, poi uno sblocco falso (4,95 $ alla fine); Dottore e Mantenitore senza turni.",
      scoutsNoTools:
        "Gli Scout senza strumenti dalla CLI (corretto); CPU satura su 2 vCPU.",
      creditEnded: "Stesso difetto; credito GLM finito.",
      minimalTeam:
        "Squadra minima (1/1/1); setup→up rifiutato dopo --reset (corretto).",
      ceilingReached: "Tetto di spesa di 3 $ raggiunto in meno di 6 minuti.",
      wrongSources:
        "Portali remoti e informatici per chi lavora in sede (corretto).",
      budgetFromSetup: "Budget contato dal setup (15 minuti persi).",
      brakeDidNotTrigger:
        "Il freno del budget non è scattato: fermato dal collaudo a 5,28 $.",
      noCredit:
        "OpenAI senza credito e macchina spenta con il terminale: nessuno Scout è partito, 0 posizioni in 30 minuti; ha speso solo l'Assistente (su GLM), 0,23 $.",
    },
    osNotes: {
      linux:
        "Installazione, fuso, preset di budget, squadra 5/3/2 e freno funzionano. Il caso «mestiere non IT in sede» passa (10 pertinenti su 14).",
      windows:
        "Primo giro vero con i nuovi script: installazione ok, 50 posizioni pertinenti. Aperti: freno del budget e dimensione della squadra non agiscono; la squadra non risale dopo lo switch.",
      macos:
        "Il giro 19 è passato con difetti, tutti i bloccanti corretti. Giro notturno fallito (OpenAI senza credito, macchina spenta con il terminale); aperto: la macchina si spegne chiudendo il terminale.",
    },
    night: "notte",
    day: "",
    targetsTitle: "Target di rilascio",
    targetsLead: "La 0.4.0 si rilascia solo con tutte le righe verdi. Aggiornata a ogni build; la prova porta al giro qui sotto.",
    targetsCount: "{g} di {n} verdi",
    targetsCols: {
      "target": "Target",
      "status": "Stato",
      "build": "Build",
      "proof": "Prova"
    },
    targetStatus: {
      "pass": "raggiunto",
      "fail": "non raggiunto",
      "pending": "da provare",
      "blocked": "bloccato"
    },
    targets: {
      "scoutBenchCook": "Banco Scout · cuoco",
      "scoutBenchWarehouse": "Banco Scout · magazziniere",
      "scoutBenchNurse": "Banco Scout · infermiera",
      "scoutBenchBricklayer": "Banco Scout · muratore",
      "languageWindows": "Setup e onboarding nella lingua scelta · Windows",
      "languageLinux": "Setup e onboarding nella lingua scelta · Linux",
      "languageMac": "Setup e onboarding nella lingua scelta · Mac",
      "preTagReview": "Controllo di sicurezza prima del tag",
      "installWindows": "Installazione da utente vergine · Windows",
      "installLinux": "Installazione da utente vergine · Linux",
      "installMac": "Installazione da utente vergine · Mac",
      "updateLinux": "Aggiornamento con squadra e dati esistenti · Linux",
      "updateMac": "Aggiornamento con squadra e dati esistenti · Mac",
      "updateWindows": "Aggiornamento con squadra e dati esistenti · Windows",
      "nonItRelevant": "Profilo non IT in sede: almeno il 70% di posizioni pertinenti",
      "scoutBench": "Banco degli Scout, 4 mestieri non IT (≥70% pertinenti, 0 doppioni, ≥15 posizioni)",
      "budgetBrake": "Freno del budget: mai oltre il tetto, nessuno sblocco falso, avviso all'utente",
      "language": "Setup e onboarding nella lingua scelta",
      "doctorMaintainer": "Dottore e Mantenitore lavorano davvero",
      "serviceClaude": "Servizio Claude",
      "serviceOpenai": "Servizio OpenAI con chiave API",
      "serviceGlmKimi": "Servizi GLM e Kimi",
      "openaiSubscription": "OpenAI su Pi con abbonamento ChatGPT",
      "noKeyOnDisk": "Nessuna chiave lasciata su disco",
      "betaTester": "Beta test: versione aggiornata e squadra al lavoro"
    },
    targetNotes: {
      "updateLinuxBuild9": "build 9: superato (il giro non è nella tabella sotto)",
      "installerBlockedBuild9": "build 9: fermato dall'installer (correzione in build 10, giro in corso)",
      "benchCook": "79% pertinenti",
      "benchWarehouse": "90% pertinenti",
      "benchNurse": "1 doppione (94% pertinenti)",
      "benchBricklayer": "6 posizioni, meno di 15 (83% pertinenti)",
      "brakeFixedRetry": "corretto nelle build 9 e 10: da riprovare",
      "languageGermanOk": "build 9: tedesco dall'inizio alla fine su Linux",
      "chatgptFreeRefused": "accesso rifiutato (piano Free)",
      "securityPreTag": "controllo prima del tag: nessun P0 o P1; il caso della chiave su disco è chiuso",
      "cleanLinuxRoundMissing": "installazione vergine sulla build 6: il suo giro non è nella tabella qui sotto (r9 è un aggiornamento)",
      "openaiRoundMissing": "provato sulla build 6: il suo giro non è nella tabella qui sotto",
      "redoOnBuild9": "da rifare sulla build 9",
      "diskFull": "disco pieno dopo l'aggiornamento (correzione in corso)",
      "neverTried": "mai provato",
      "relevantBelow": "0 nuove per il muratore, 10 su 26 per la receptionist",
      "benchPaused": "in pausa fino alla build 9",
      "brakeFalseClear": "sblocco falso dopo lo stop, avviso all'utente fallito",
      "languageEnglish": "passo della chiave API, avvio della squadra e status in inglese (corretti dopo la build 8)",
      "zeroTurns": "0 turni (corretto nella build 9)",
      "noCredit": "senza credito per provarli",
      "loginNeverTried": "accesso vero mai provato",
      "keysChecked": "0 file con chiave fuori posto, su 20.927 eventi sui file",
      "updateOnBuild9": "aggiornamento sulla build 9"
    },
    targetSections: {
      "install": "Installazione da utente nuovo",
      "update": "Aggiornamento con squadra e dati",
      "scout": "Scout, mestieri non IT",
      "brake": "Freno della spesa",
      "language": "Lingua",
      "doctor": "Dottore e Mantenitore",
      "services": "Servizi",
      "security": "Sicurezza",
      "beta": "Beta tester",
    },
    targetRows: {
      "install": "Installazione da utente nuovo",
      "update": "Aggiornamento con squadra e dati già presenti",
      "language": "Setup e onboarding nella lingua scelta",
    },
    buildsTitle: "Giri di ogni build",
    buildLabel: "Build {n}",
    noRound: "nessun giro",
    none: "—",
    finder: {
      title: "Trova i test più vicini al tuo caso",
      lead: "Dicci che computer hai, quale servizio useresti, il tuo budget e il tuo mestiere. Vedi i giri e i case study che corrispondono, poi i più vicini, con il motivo. Nei nostri test, con i nostri profili: non è una promessa di quello che otterrai.",
      computer: "Il tuo computer",
      service: "Servizio",
      budget: "Budget (dollari)",
      budgetHint: "Quanto spenderesti, es. 15",
      trade: "Il tuo mestiere",
      tradeHint: "Testo libero; i suggerimenti sono i mestieri dei nostri test",
      sector: "Settore",
      any: "Qualsiasi",
      reset: "Svuota i campi",
      searchLabel: "Trova i test vicini al tuo caso",
      prompt:
        "Compila almeno un campo per vedere i test più vicini al tuo caso.",
      matchTitle: "Corrispondono",
      closeTitle: "I più vicini",
      none: "Nessun giro o case study è vicino a questo: cambia un campo.",
      count: "{n} test trovati",
      roundKind: "Giro",
      caseKind: "Case study",
      openCase: "Apri il case study",
      nothingExact:
        "Nessuno corrisponde a tutti i campi compilati: ecco i più vicini.",
      disclaimer:
        "Nei nostri test, con profili finti e le build indicate. Quello che otterrai dipende dal tuo CV, dal tuo mercato e dal tuo budget; non promettiamo un risultato.",
      whyLabel: "Perché:",
      estimateLabel: "stima",
      estimateMore:
        "Con {b} $ ≈ {x}× quello che ha speso questo giro ({c} $). Una proporzione, non una promessa: costi e risultati non crescono in linea retta.",
      estimateLess:
        "Con {b} $ ≈ {x}% di quello che ha speso questo giro ({c} $). Una proporzione, non una promessa: un budget più piccolo può fermare la squadra prima.",
      sectors: {
        hospitality: "Ristorazione e ospitalità",
        health: "Sanità",
        trades: "Artigianato e mestieri",
        office: "Ufficio e finanza",
        culture: "Cultura e beni culturali",
        it: "Informatica",
        transport: "Trasporti e logistica",
      },
      reasons: {
        "service-same": "stesso servizio ({v})",
        "service-other": "altro servizio ({v})",
        "os-same": "stesso sistema ({v})",
        "os-other": "altro sistema ({v})",
        "sector-same": "stesso settore ({v})",
        "sector-other": "altro settore ({v})",
        "trade-same": "stesso mestiere",
        "trade-similar": "mestiere simile ({v})",
        "budget-close": "budget vicino ({v} $ spesi)",
        "budget-other": "questo ha speso {v} $, tu hai {w} $",
      },
    },
  },
  de: {
    metaTitle: "Benchmark 0.4.0 · Job Hunter Team",
    title: "Benchmark 0.4.0: vier Dienste, drei Systeme",
    lead: "Was das Team in den Testläufen vom 14. bis 17. November 2026 ausgegeben und gefunden hat, mit den API-Schlüssel-Diensten des 0.4.0-Harness. Die Zahlen stammen aus den Testprotokollen und den Kostenmessungen.",
    banner:
      "Ein erster Vergleich, kein sauberer Benchmark. Maschinen, Profile, Builds, Budgets und Teamgrößen unterscheiden sich von Lauf zu Lauf, und es gibt einen Lauf pro Dienst: lies die Grenzen unten, bevor du vergleichst.",
    roundsTitle: "Jeder Lauf",
    cols: {
      round: "Lauf",
      profile: "Profil",
      minutes: "Minuten",
      spent: "Ausgaben",
      found: "Gefunden / bewertet / passend",
      perScored: "$ pro bewertet",
      outcome: "Ergebnis",
      note: "Was passiert ist",
    },
    colsHint:
      "«Passend» = Stellen, deren Titel zum Beruf passt, stichprobenartig geprüft.",
    chartTitle: "Was eine bewertete Stelle kostet",
    chartLead:
      "Dollar pro vom Team bewerteter Stelle. Kürzer ist besser. Läufe ohne bewertete Stelle haben keinen Balken.",
    chartNone: "keine bewertet",
    chartCaveat:
      "Die beiden Mac-Läufe dauerten 6 und 10 Minuten mit minimalem Team; die Kosten sind fast nur Onboarding und Capitano: nicht vergleichbar mit Läufen von 16-42 Minuten.",
    servicesTitle: "Dienste: Beobachtetes neben den Schätzungen",
    servicesCols: {
      service: "Dienst",
      kit: "Schätzung für 30 Min",
      seen: "In den Läufen gesehen",
      rate: "Beobachtetes Tempo",
    },
    servicesCaveat:
      "Die Schätzungen stammen aus dem umgerechneten GLM-Volumen, nicht aus Messungen der anderen Dienste. Claude unter Windows gab mehr aus als geschätzt: Capitano und Scorer machen 3,05 $ von 5,28 $ aus.",
    osTitle: "Nach System",
    limitsTitle: "Was dieser Vergleich wert ist und was nicht",
    limitsLead:
      "Jeder Lauf unterscheidet sich von den anderen in etwas, das die Zahlen beeinflusst:",
    limits: [
      "unterschiedliche Maschinen: Linux-VPS mit 2 vCPU und 4 GB, Windows-Laptop, Mac mit anderen laufenden Programmen;",
      "unterschiedliche Profile (Data Analyst, Restauratorin, Kellner, Rezeptionist, Lkw-Fahrer) und Arbeitsmärkte;",
      "unterschiedliche Builds und Budgets (Limit 3 $, Preset 5 $ für 30 Minuten);",
      "unterschiedliche Teamgrößen: 5/3/2 unter Linux, 1/1/1 auf dem Mac und im Windows-Nachtlauf, wegen eines Fehlers der Budgetbremse;",
      "kurze Arbeitszeiten (6-42 Minuten) und ein Lauf pro Dienst: unter 25 % Unterschied ist Rauschen nicht von Signal zu trennen.",
    ],
    needTitle: "Was ein sauberer Benchmark braucht",
    need: "Vier identische VPS gleichzeitig gestartet, dasselbe Profil für alle, 30 Minuten Arbeit nach dem Onboarding, derselbe Build mit korrigierter Budgetbremse und Guthaben bei allen vier Diensten.",
    back: "← Alle Fallstudien",
    tuxCredit: "Tux, der Linux-Pinguin: Larry Ewing und The GIMP.",
    footer:
      "Synthetische Profile, keine personenbezogenen Daten · Zahlen aus den Testprotokollen vom 14.-17.11.2026.",
    outcome: {
      pass: "bestanden",
      reservations: "mit Vorbehalt",
      fail: "nicht bestanden",
      running: "läuft",
    },
    system: {
      pass: "besteht",
      withReservations: "besteht mit Vorbehalt",
      running: "läuft",
    },
    profiles: {
      bricklayer: "Maurer",
      officeClerk: "Bürokraft, Teilzeit",
      dataAnalyst: "Data Analyst",
      generic: "Allgemeines Testprofil",
      restorer: "Restauratorin",
      waiter: "Kellner",
      receptionist: "Rezeptionist",
      truckDriver: "Lkw-Fahrer",
    },
    modes: { onsite: "vor Ort", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI → GLM",
    },
    notes: {
      updateSwitchKept: "Update bei laufendem Team: Daten behalten, alte Images entfernt, GLM → Claude ohne das Team anzuhalten. 3 passende von 26 neuen in 10 Minuten.",
      updateWelcomePaid: "Update und Wechsel zu Claude: 15 passende von 18 in 12 Minuten. Die Begrüßung wurde bei jedem Neustart wieder bezahlt.",
      cleanInstallWarehouse: "Neuer Nutzer, geführtes Onboarding: Die Bremse hielt bei 2,67 $. Fast nur Lagerjobs: 2 passende von 19.",
      updateNoNewPositions: "Update gelungen und keine Schlüsseldatei auf der Platte, aber 0 neue Stellen in 30 Minuten: nur 2 Scouts geweckt.",
      diskLowAfterUpdate: "Update gelungen, Team nie gestartet: 4 GiB frei von 8 nötigen, ohne Warnung vor dem Download.",
      cleanInstallGerman: "Neuer Nutzer auf Deutsch: 10 passende von 26. Die Bremse hielt bei 4,77 $, dann eine falsche Freigabe (4,95 $ am Ende); Doktor und Wartung ohne Durchgang.",
      scoutsNoTools:
        "Scouts ohne Werkzeuge aus der CLI (behoben); CPU auf 2 vCPU ausgelastet.",
      creditEnded: "Derselbe Fehler; das GLM-Guthaben war aufgebraucht.",
      minimalTeam:
        "Minimales Team (1/1/1); setup→up nach --reset abgelehnt (behoben).",
      ceilingReached: "Ausgabenlimit von 3 $ in unter 6 Minuten erreicht.",
      wrongSources:
        "Remote- und IT-Portale für jemanden, der vor Ort arbeitet (behoben).",
      budgetFromSetup: "Budget ab dem Setup gezählt (15 Minuten verloren).",
      brakeDidNotTrigger:
        "Die Budgetbremse griff nicht: vom Test bei 5,28 $ gestoppt.",
      noCredit:
        "OpenAI ohne Guthaben und die Maschine schaltete sich mit dem Terminal aus: kein Scout startete, 0 Stellen in 30 Minuten; nur der Assistent (auf GLM) gab 0,23 $ aus.",
    },
    osNotes: {
      linux:
        "Installation, Zeitzone, Budget-Presets, Team 5/3/2 und Bremse funktionieren. Der Fall «Beruf außerhalb der IT, vor Ort» besteht (10 passende von 14).",
      windows:
        "Erster echter Lauf mit den neuen Skripten: Installation ok, 50 passende Stellen. Offen: Budgetbremse und Teamgröße greifen nicht; das Team wächst nach einem Wechsel nicht zurück.",
      macos:
        "Lauf 19 bestand mit Mängeln, alle Blocker behoben. Nachtlauf fehlgeschlagen (OpenAI ohne Guthaben, Maschine mit dem Terminal aus); offen: die Maschine schaltet sich beim Schließen des Terminals aus.",
    },
    night: "Nacht",
    day: "",
    targetsTitle: "Release-Ziele",
    targetsLead: "0.4.0 wird nur veröffentlicht, wenn jede Zeile grün ist. Bei jedem Build aktualisiert; der Nachweis führt zum Lauf weiter unten.",
    targetsCount: "{g} von {n} grün",
    targetsCols: {
      "target": "Ziel",
      "status": "Stand",
      "build": "Build",
      "proof": "Nachweis"
    },
    targetStatus: {
      "pass": "erreicht",
      "fail": "nicht erreicht",
      "pending": "zu prüfen",
      "blocked": "blockiert"
    },
    targets: {
      "scoutBenchCook": "Scout-Bank · Koch",
      "scoutBenchWarehouse": "Scout-Bank · Lagerarbeiter",
      "scoutBenchNurse": "Scout-Bank · Krankenpflegerin",
      "scoutBenchBricklayer": "Scout-Bank · Maurer",
      "languageWindows": "Setup und Onboarding in der gewählten Sprache · Windows",
      "languageLinux": "Setup und Onboarding in der gewählten Sprache · Linux",
      "languageMac": "Setup und Onboarding in der gewählten Sprache · Mac",
      "preTagReview": "Sicherheitsprüfung vor dem Tag",
      "installWindows": "Installation durch neuen Nutzer · Windows",
      "installLinux": "Installation durch neuen Nutzer · Linux",
      "installMac": "Installation durch neuen Nutzer · Mac",
      "updateLinux": "Update mit vorhandenem Team und Daten · Linux",
      "updateMac": "Update mit vorhandenem Team und Daten · Mac",
      "updateWindows": "Update mit vorhandenem Team und Daten · Windows",
      "nonItRelevant": "Profil außerhalb der IT, vor Ort: mindestens 70% passende Stellen",
      "scoutBench": "Scout-Prüfstand, 4 Berufe außerhalb der IT (≥70% passend, 0 Doppelte, ≥15 Stellen)",
      "budgetBrake": "Budgetbremse: nie über der Obergrenze, keine falsche Freigabe, die Person wird informiert",
      "language": "Setup und Onboarding in der gewählten Sprache",
      "doctorMaintainer": "Doktor und Wartung arbeiten wirklich",
      "serviceClaude": "Dienst Claude",
      "serviceOpenai": "Dienst OpenAI mit API-Schlüssel",
      "serviceGlmKimi": "Dienste GLM und Kimi",
      "openaiSubscription": "OpenAI auf Pi mit ChatGPT-Abo",
      "noKeyOnDisk": "Kein Schlüssel bleibt auf der Platte",
      "betaTester": "Betatest: Version aktualisiert und Team bei der Arbeit"
    },
    targetNotes: {
      "updateLinuxBuild9": "Build 9: bestanden (die Runde steht nicht in der Tabelle unten)",
      "installerBlockedBuild9": "Build 9: vom Installer gestoppt (Korrektur in Build 10, Runde läuft)",
      "benchCook": "79 % passend",
      "benchWarehouse": "90 % passend",
      "benchNurse": "1 Duplikat (94 % passend)",
      "benchBricklayer": "6 Stellen, weniger als 15 (83 % passend)",
      "brakeFixedRetry": "in Build 9 und 10 korrigiert: erneut zu prüfen",
      "languageGermanOk": "Build 9: durchgehend Deutsch auf Linux",
      "chatgptFreeRefused": "Anmeldung abgelehnt (Free-Tarif)",
      "securityPreTag": "Prüfung vor dem Tag: kein P0 oder P1; der Fall des Schlüssels auf der Festplatte ist geschlossen",
      "cleanLinuxRoundMissing": "Neuinstallation auf Build 6: ihr Lauf fehlt in der Tabelle unten (r9 ist ein Update)",
      "openaiRoundMissing": "auf Build 6 geprüft: der Lauf fehlt in der Tabelle unten",
      "redoOnBuild9": "auf Build 9 zu wiederholen",
      "diskFull": "Platte voll nach dem Update (Korrektur in Arbeit)",
      "neverTried": "nie geprüft",
      "relevantBelow": "0 neue für den Maurer, 10 von 26 für die Rezeptionistin",
      "benchPaused": "pausiert bis Build 9",
      "brakeFalseClear": "falsche Freigabe nach dem Stopp, Hinweis an die Person fehlgeschlagen",
      "languageEnglish": "API-Schlüssel, Teamstart und Status auf Englisch (nach Build 8 behoben)",
      "zeroTurns": "0 Durchgänge (in Build 9 behoben)",
      "noCredit": "kein Guthaben zum Prüfen",
      "loginNeverTried": "echte Anmeldung nie geprüft",
      "keysChecked": "0 Dateien mit Schlüssel am falschen Ort, bei 20.927 Dateiereignissen",
      "updateOnBuild9": "Update auf Build 9"
    },
    targetSections: {
      "install": "Installation durch neue Nutzer",
      "update": "Update mit Team und Daten",
      "scout": "Scout, Berufe außerhalb der IT",
      "brake": "Ausgabenbremse",
      "language": "Sprache",
      "doctor": "Doktor und Wartung",
      "services": "Dienste",
      "security": "Sicherheit",
      "beta": "Betatester",
    },
    targetRows: {
      "install": "Installation durch neue Nutzer",
      "update": "Update mit vorhandenem Team und Daten",
      "language": "Setup und Onboarding in der gewählten Sprache",
    },
    buildsTitle: "Läufe jedes Builds",
    buildLabel: "Build {n}",
    noRound: "kein Lauf",
    none: "—",
    finder: {
      title: "Finde die Tests, die deinem Fall am nächsten kommen",
      lead: "Sag, welchen Computer du hast, welchen Dienst du nutzen würdest, dein Budget und deinen Beruf. Du siehst die passenden Läufe und Fallstudien, dann die nächstliegenden, mit Begründung. In unseren Tests, mit unseren Profilen: kein Versprechen dafür, was du bekommst.",
      computer: "Dein Computer",
      service: "Dienst",
      budget: "Budget (US-Dollar)",
      budgetHint: "Was du ausgeben würdest, z. B. 15",
      trade: "Dein Beruf",
      tradeHint: "Freitext; die Vorschläge sind die Berufe unserer Tests",
      sector: "Branche",
      any: "Beliebig",
      reset: "Felder leeren",
      searchLabel: "Tests nahe an deinem Fall finden",
      prompt:
        "Fülle mindestens ein Feld aus, um die Tests zu sehen, die deinem Fall am nächsten kommen.",
      matchTitle: "Passen",
      closeTitle: "Die nächstliegenden",
      none: "Kein Lauf und keine Fallstudie kommt dem nahe: ändere ein Feld.",
      count: "{n} Tests gefunden",
      roundKind: "Lauf",
      caseKind: "Fallstudie",
      openCase: "Fallstudie öffnen",
      nothingExact:
        "Keiner passt zu allen ausgefüllten Feldern: hier die nächstliegenden.",
      disclaimer:
        "In unseren Tests, mit synthetischen Profilen und den angegebenen Builds. Was du bekommst, hängt von deinem Lebenslauf, deinem Markt und deinem Budget ab; wir versprechen kein Ergebnis.",
      whyLabel: "Warum:",
      estimateLabel: "Schätzung",
      estimateMore:
        "Mit {b} $ ≈ {x}× dessen, was dieser Lauf ausgab ({c} $). Ein Verhältnis, kein Versprechen: Kosten und Ergebnisse wachsen nicht linear.",
      estimateLess:
        "Mit {b} $ ≈ {x} % dessen, was dieser Lauf ausgab ({c} $). Ein Verhältnis, kein Versprechen: ein kleineres Budget kann das Team früher stoppen.",
      sectors: {
        hospitality: "Gastronomie und Hotellerie",
        health: "Gesundheit",
        trades: "Handwerk",
        office: "Büro und Finanzen",
        culture: "Kultur und Denkmalpflege",
        it: "IT",
        transport: "Transport und Logistik",
      },
      reasons: {
        "service-same": "gleicher Dienst ({v})",
        "service-other": "anderer Dienst ({v})",
        "os-same": "gleiches System ({v})",
        "os-other": "anderes System ({v})",
        "sector-same": "gleiche Branche ({v})",
        "sector-other": "andere Branche ({v})",
        "trade-same": "gleicher Beruf",
        "trade-similar": "ähnlicher Beruf ({v})",
        "budget-close": "ähnliches Budget ({v} $ ausgegeben)",
        "budget-other": "dieser gab {v} $ aus, du hast {w} $",
      },
    },
  },
  es: {
    metaTitle: "Benchmark 0.4.0 · Job Hunter Team",
    title: "Benchmark 0.4.0: cuatro servicios, tres sistemas",
    lead: "Lo que el equipo gastó y encontró en las rondas de prueba del 14 al 17 de noviembre de 2026, con los servicios de clave API que ofrece el harness 0.4.0. Las cifras salen de los informes de las pruebas y de los muestreadores de coste.",
    banner:
      "Una primera comparación, no un benchmark limpio. Máquinas, perfiles, builds, presupuestos y tamaños del equipo cambian de una ronda a otra, y hay una ronda por servicio: lee los límites de abajo antes de comparar.",
    roundsTitle: "Cada ronda",
    cols: {
      round: "Ronda",
      profile: "Perfil",
      minutes: "Minutos",
      spent: "Gasto",
      found: "Encontradas / valoradas / pertinentes",
      perScored: "$ por valorada",
      outcome: "Resultado",
      note: "Qué pasó",
    },
    colsHint:
      "«Pertinentes» = puestos cuyo título corresponde al oficio, comprobados por muestreo.",
    chartTitle: "Cuánto cuesta un puesto valorado",
    chartLead:
      "Dólares gastados por cada puesto que el equipo valoró. Más corta es mejor. Las rondas sin puestos valorados no tienen barra.",
    chartNone: "ninguna valorada",
    chartCaveat:
      "Las dos rondas del Mac duraron 6 y 10 minutos con un equipo mínimo, y el coste es casi todo onboarding y Capitán: no son comparables con rondas de 16-42 minutos.",
    servicesTitle: "Servicios: lo visto junto a las estimaciones",
    servicesCols: {
      service: "Servicio",
      kit: "Estimación para 30 min",
      seen: "Visto en las rondas",
      rate: "Ritmo visto",
    },
    servicesCaveat:
      "Las estimaciones salen del volumen de GLM reevaluado, no de mediciones en los otros servicios. Claude en Windows gastó más de lo estimado: Capitán y Scorer pesan 3,05 $ de 5,28 $.",
    osTitle: "Por sistema",
    limitsTitle: "Qué vale y qué no vale esta comparación",
    limitsLead:
      "Cada ronda se distingue de las otras en algo que pesa en las cifras:",
    limits: [
      "máquinas distintas: una VPS Linux de 2 vCPU y 4 GB, un portátil Windows, un Mac con otros programas abiertos;",
      "perfiles distintos (analista de datos, restauradora, camarero, recepcionista, conductor) y mercados laborales distintos;",
      "builds y presupuestos distintos (tope de 3 $, preset de 5 $ por 30 minutos);",
      "equipos de tamaños distintos: 5/3/2 en Linux, 1/1/1 en el Mac y en la ronda nocturna de Windows, por un defecto del freno del presupuesto;",
      "tiempos de trabajo cortos (6-42 minutos) y una sola ronda por servicio: por debajo del 25 % de diferencia no se distingue el ruido de la señal.",
    ],
    needTitle: "Qué hace falta para un benchmark limpio",
    need: "Cuatro VPS iguales encendidas a la vez, el mismo perfil para todos, 30 minutos de trabajo después del onboarding, la misma build con el freno del presupuesto corregido y crédito en los cuatro servicios.",
    back: "← Todos los casos de estudio",
    tuxCredit: "Tux, el pingüino de Linux: Larry Ewing y The GIMP.",
    footer:
      "Perfiles ficticios, sin datos personales · cifras de los informes de prueba del 14-17/11/2026.",
    outcome: {
      pass: "pasa",
      reservations: "con reservas",
      fail: "no pasa",
      running: "en curso",
    },
    system: {
      pass: "pasa",
      withReservations: "pasa con reservas",
      running: "en curso",
    },
    profiles: {
      bricklayer: "Albañil",
      officeClerk: "Administrativa a tiempo parcial",
      dataAnalyst: "Analista de datos",
      generic: "Perfil de prueba genérico",
      restorer: "Restauradora",
      waiter: "Camarero",
      receptionist: "Recepcionista",
      truckDriver: "Conductor de camión",
    },
    modes: { onsite: "presencial", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI → GLM",
    },
    notes: {
      updateSwitchKept: "Actualización con el equipo en marcha: datos conservados, imágenes viejas quitadas, GLM → Claude sin parar el equipo. 3 pertinentes de 26 nuevas en 10 minutos.",
      updateWelcomePaid: "Actualización y paso a Claude: 15 pertinentes de 18 en 12 minutos. La bienvenida se volvió a pagar en cada reinicio.",
      cleanInstallWarehouse: "Usuario nuevo, onboarding guiado: el freno paró en 2,67 $. Casi solo almacén: 2 pertinentes de 19.",
      updateNoNewPositions: "Actualización correcta y ningún archivo con clave en disco, pero 0 ofertas nuevas en 30 minutos: solo 2 Scouts despertados.",
      diskLowAfterUpdate: "Actualización correcta, el equipo nunca arrancó: 4 GiB libres de los 8 necesarios, sin aviso antes de la descarga.",
      cleanInstallGerman: "Usuario nuevo en alemán: 10 pertinentes de 26. El freno paró en 4,77 $ y luego un desbloqueo falso (4,95 $ al final); Doctor y Mantenedor sin turnos.",
      scoutsNoTools:
        "Scouts sin herramientas desde la CLI (corregido); CPU saturada en 2 vCPU.",
      creditEnded: "Mismo defecto; se agotó el crédito de GLM.",
      minimalTeam:
        "Equipo mínimo (1/1/1); setup→up rechazado tras --reset (corregido).",
      ceilingReached: "Tope de gasto de 3 $ alcanzado en menos de 6 minutos.",
      wrongSources:
        "Portales remotos e informáticos para quien trabaja presencialmente (corregido).",
      budgetFromSetup:
        "Presupuesto contado desde el setup (15 minutos perdidos).",
      brakeDidNotTrigger:
        "El freno del presupuesto no saltó: detenido por la prueba a 5,28 $.",
      noCredit:
        "OpenAI sin crédito y la máquina se apagó con el terminal: ningún Scout arrancó, 0 puestos en 30 minutos; solo gastó el Asistente (en GLM), 0,23 $.",
    },
    osNotes: {
      linux:
        "Instalación, zona horaria, presets de presupuesto, equipo 5/3/2 y freno funcionan. El caso «oficio fuera de TI, presencial» pasa (10 pertinentes de 14).",
      windows:
        "Primera ronda real con los scripts nuevos: instalación bien, 50 puestos pertinentes. Abiertos: el freno y el tamaño del equipo no actúan; el equipo no vuelve a crecer tras un cambio.",
      macos:
        "La ronda 19 pasó con defectos, bloqueantes corregidos. Ronda nocturna fallida (OpenAI sin crédito, máquina apagada con el terminal); abierto: la máquina se apaga al cerrar el terminal.",
    },
    night: "noche",
    day: "",
    targetsTitle: "Objetivos de lanzamiento",
    targetsLead: "La 0.4.0 se publica solo con todas las filas en verde. Se actualiza en cada build; la prueba lleva a la ronda de abajo.",
    targetsCount: "{g} de {n} en verde",
    targetsCols: {
      "target": "Objetivo",
      "status": "Estado",
      "build": "Build",
      "proof": "Prueba"
    },
    targetStatus: {
      "pass": "cumplido",
      "fail": "no cumplido",
      "pending": "por probar",
      "blocked": "bloqueado"
    },
    targets: {
      "scoutBenchCook": "Banco de Scouts · cocinero",
      "scoutBenchWarehouse": "Banco de Scouts · mozo de almacén",
      "scoutBenchNurse": "Banco de Scouts · enfermera",
      "scoutBenchBricklayer": "Banco de Scouts · albañil",
      "languageWindows": "Configuración y onboarding en el idioma elegido · Windows",
      "languageLinux": "Configuración y onboarding en el idioma elegido · Linux",
      "languageMac": "Configuración y onboarding en el idioma elegido · Mac",
      "preTagReview": "Revisión de seguridad antes del tag",
      "installWindows": "Instalación por un usuario nuevo · Windows",
      "installLinux": "Instalación por un usuario nuevo · Linux",
      "installMac": "Instalación por un usuario nuevo · Mac",
      "updateLinux": "Actualización con equipo y datos existentes · Linux",
      "updateMac": "Actualización con equipo y datos existentes · Mac",
      "updateWindows": "Actualización con equipo y datos existentes · Windows",
      "nonItRelevant": "Perfil fuera de la informática, presencial: al menos 70% de ofertas pertinentes",
      "scoutBench": "Banco de los Scouts, 4 oficios fuera de la informática (≥70% pertinentes, 0 duplicados, ≥15 ofertas)",
      "budgetBrake": "Freno del presupuesto: nunca por encima del tope, ningún desbloqueo falso, aviso a la persona",
      "language": "Setup y onboarding en el idioma elegido",
      "doctorMaintainer": "El Doctor y el Mantenedor trabajan de verdad",
      "serviceClaude": "Servicio Claude",
      "serviceOpenai": "Servicio OpenAI con clave de API",
      "serviceGlmKimi": "Servicios GLM y Kimi",
      "openaiSubscription": "OpenAI en Pi con suscripción de ChatGPT",
      "noKeyOnDisk": "Ninguna clave queda en disco",
      "betaTester": "Beta test: versión actualizada y equipo trabajando"
    },
    targetNotes: {
      "updateLinuxBuild9": "build 9: superada (su ronda no está en la tabla de abajo)",
      "installerBlockedBuild9": "build 9: parada por el instalador (corrección en la build 10, ronda en curso)",
      "benchCook": "79 % pertinentes",
      "benchWarehouse": "90 % pertinentes",
      "benchNurse": "1 duplicado (94 % pertinentes)",
      "benchBricklayer": "6 puestos, menos de 15 (83 % pertinentes)",
      "brakeFixedRetry": "corregido en las builds 9 y 10: por volver a probar",
      "languageGermanOk": "build 9: alemán de principio a fin en Linux",
      "chatgptFreeRefused": "acceso rechazado (plan Free)",
      "securityPreTag": "revisión antes del tag: ningún P0 ni P1; el caso de la clave en disco está cerrado",
      "cleanLinuxRoundMissing": "instalación desde cero en la build 6: su ronda no está en la tabla de abajo (r9 es una actualización)",
      "openaiRoundMissing": "probado en la build 6: su ronda no está en la tabla de abajo",
      "redoOnBuild9": "por repetir en la build 9",
      "diskFull": "disco lleno tras la actualización (corrección en curso)",
      "neverTried": "nunca probado",
      "relevantBelow": "0 nuevas para el albañil, 10 de 26 para la recepcionista",
      "benchPaused": "en pausa hasta la build 9",
      "brakeFalseClear": "desbloqueo falso tras la parada, el aviso a la persona falló",
      "languageEnglish": "paso de la clave de API, arranque del equipo y estado en inglés (corregidos tras la build 8)",
      "zeroTurns": "0 turnos (corregido en la build 9)",
      "noCredit": "sin crédito para probarlos",
      "loginNeverTried": "inicio de sesión real nunca probado",
      "keysChecked": "0 archivos con clave fuera de su sitio, en 20.927 eventos de archivos",
      "updateOnBuild9": "actualización en la build 9"
    },
    targetSections: {
      "install": "Instalación por un usuario nuevo",
      "update": "Actualización con equipo y datos",
      "scout": "Scout, oficios fuera de la informática",
      "brake": "Freno del gasto",
      "language": "Idioma",
      "doctor": "Doctor y Mantenedor",
      "services": "Servicios",
      "security": "Seguridad",
      "beta": "Beta tester",
    },
    targetRows: {
      "install": "Instalación por un usuario nuevo",
      "update": "Actualización con equipo y datos ya presentes",
      "language": "Configuración y onboarding en el idioma elegido",
    },
    buildsTitle: "Rondas de cada build",
    buildLabel: "Build {n}",
    noRound: "ninguna ronda",
    none: "—",
    finder: {
      title: "Encuentra las pruebas más cercanas a tu caso",
      lead: "Di qué ordenador tienes, qué servicio usarías, tu presupuesto y tu oficio. Ves las rondas y casos de estudio que coinciden, luego los más cercanos, con el motivo. En nuestras pruebas, con nuestros perfiles: no es una promesa de lo que conseguirás.",
      computer: "Tu ordenador",
      service: "Servicio",
      budget: "Presupuesto (dólares)",
      budgetHint: "Lo que gastarías, p. ej. 15",
      trade: "Tu oficio",
      tradeHint:
        "Texto libre; las sugerencias son los oficios de nuestras pruebas",
      sector: "Sector",
      any: "Cualquiera",
      reset: "Vaciar los campos",
      searchLabel: "Encontrar pruebas cercanas a tu caso",
      prompt:
        "Rellena al menos un campo para ver las pruebas más cercanas a tu caso.",
      matchTitle: "Coinciden",
      closeTitle: "Las más cercanas",
      none: "Ninguna ronda ni caso de estudio se acerca a esto: cambia un campo.",
      count: "{n} pruebas encontradas",
      roundKind: "Ronda",
      caseKind: "Caso de estudio",
      openCase: "Abrir el caso de estudio",
      nothingExact:
        "Ninguna coincide con todos los campos rellenados: aquí van las más cercanas.",
      disclaimer:
        "En nuestras pruebas, con perfiles ficticios y las builds indicadas. Lo que consigas depende de tu CV, tu mercado y tu presupuesto; no prometemos un resultado.",
      whyLabel: "Por qué:",
      estimateLabel: "estimación",
      estimateMore:
        "Con {b} $ ≈ {x}× lo que gastó esta ronda ({c} $). Una proporción, no una promesa: costes y resultados no crecen en línea recta.",
      estimateLess:
        "Con {b} $ ≈ {x} % de lo que gastó esta ronda ({c} $). Una proporción, no una promesa: un presupuesto menor puede detener antes al equipo.",
      sectors: {
        hospitality: "Hostelería y restauración",
        health: "Sanidad",
        trades: "Oficios y artesanía",
        office: "Oficina y finanzas",
        culture: "Cultura y patrimonio",
        it: "Informática",
        transport: "Transporte y logística",
      },
      reasons: {
        "service-same": "mismo servicio ({v})",
        "service-other": "otro servicio ({v})",
        "os-same": "mismo sistema ({v})",
        "os-other": "otro sistema ({v})",
        "sector-same": "mismo sector ({v})",
        "sector-other": "otro sector ({v})",
        "trade-same": "mismo oficio",
        "trade-similar": "oficio parecido ({v})",
        "budget-close": "presupuesto cercano ({v} $ gastados)",
        "budget-other": "esta gastó {v} $, tú tienes {w} $",
      },
    },
  },
  fr: {
    metaTitle: "Benchmark 0.4.0 · Job Hunter Team",
    title: "Benchmark 0.4.0 : quatre services, trois systèmes",
    lead: "Ce que l'équipe a dépensé et trouvé lors des tours d'essai du 14 au 17 novembre 2026, avec les services à clé API que propose le harness 0.4.0. Les chiffres viennent des procès-verbaux d'essai et des échantillonneurs de coûts.",
    banner:
      "Une première comparaison, pas un benchmark propre. Machines, profils, builds, budgets et tailles d'équipe changent d'un tour à l'autre, et il y a un tour par service : lis les limites ci-dessous avant de comparer.",
    roundsTitle: "Chaque tour",
    cols: {
      round: "Tour",
      profile: "Profil",
      minutes: "Minutes",
      spent: "Dépense",
      found: "Trouvées / évaluées / pertinentes",
      perScored: "$ par évaluée",
      outcome: "Résultat",
      note: "Ce qui s'est passé",
    },
    colsHint:
      "« Pertinentes » = postes dont l'intitulé correspond au métier, vérifiés par échantillon.",
    chartTitle: "Ce que coûte un poste évalué",
    chartLead:
      "Dollars dépensés pour chaque poste évalué par l'équipe. Plus court, c'est mieux. Les tours sans poste évalué n'ont pas de barre.",
    chartNone: "aucune évaluée",
    chartCaveat:
      "Les deux tours du Mac ont duré 6 et 10 minutes avec une équipe minimale, et le coût est presque tout onboarding et Capitaine : pas comparables avec des tours de 16-42 minutes.",
    servicesTitle: "Services : ce que nous avons vu à côté des estimations",
    servicesCols: {
      service: "Service",
      kit: "Estimation pour 30 min",
      seen: "Vu dans les tours",
      rate: "Rythme observé",
    },
    servicesCaveat:
      "Les estimations viennent du volume de GLM retarifé, pas de mesures sur les autres services. Claude sous Windows a dépensé plus que prévu : Capitaine et Scorer pèsent 3,05 $ sur 5,28 $.",
    osTitle: "Par système",
    limitsTitle: "Ce que vaut cette comparaison, et ce qu'elle ne vaut pas",
    limitsLead:
      "Chaque tour diffère des autres par quelque chose qui pèse sur les chiffres :",
    limits: [
      "machines différentes : un VPS Linux de 2 vCPU et 4 Go, un portable Windows, un Mac avec d'autres programmes ouverts ;",
      "profils différents (data analyst, restauratrice, serveur, réceptionniste, chauffeur routier) et marchés de l'emploi différents ;",
      "builds et budgets différents (plafond de 3 $, préréglage 5 $ pour 30 minutes) ;",
      "équipes de tailles différentes : 5/3/2 sur Linux, 1/1/1 sur le Mac et sur le tour Windows de nuit, à cause d'un défaut du frein du budget ;",
      "temps de travail courts (6-42 minutes) et un seul tour par service : sous 25 % d'écart, on ne distingue pas le bruit du signal.",
    ],
    needTitle: "Ce qu'il faut pour un benchmark propre",
    need: "Quatre VPS identiques allumés ensemble, le même profil pour tous, 30 minutes de travail après l'onboarding, la même build avec le frein du budget corrigé et du crédit sur les quatre services.",
    back: "← Toutes les études de cas",
    tuxCredit: "Tux, le manchot de Linux : Larry Ewing et The GIMP.",
    footer:
      "Profils fictifs, aucune donnée personnelle · chiffres des procès-verbaux d'essai du 14-17/11/2026.",
    outcome: {
      pass: "réussi",
      reservations: "avec réserves",
      fail: "échec",
      running: "en cours",
    },
    system: {
      pass: "réussit",
      withReservations: "réussit avec réserves",
      running: "en cours",
    },
    profiles: {
      bricklayer: "Maçon",
      officeClerk: "Employée administrative à temps partiel",
      dataAnalyst: "Data analyst",
      generic: "Profil d'essai générique",
      restorer: "Restauratrice",
      waiter: "Serveur",
      receptionist: "Réceptionniste",
      truckDriver: "Chauffeur routier",
    },
    modes: { onsite: "sur site", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI → GLM",
    },
    notes: {
      updateSwitchKept: "Mise à jour avec l'équipe en marche : données gardées, anciennes images retirées, GLM → Claude sans arrêter l'équipe. 3 pertinentes sur 26 nouvelles en 10 minutes.",
      updateWelcomePaid: "Mise à jour et passage à Claude : 15 pertinentes sur 18 en 12 minutes. L'accueil a été payé de nouveau à chaque redémarrage.",
      cleanInstallWarehouse: "Nouvel utilisateur, onboarding guidé : le frein s'est arrêté à 2,67 $. Presque que de l'entrepôt : 2 pertinentes sur 19.",
      updateNoNewPositions: "Mise à jour réussie et aucun fichier avec clé sur le disque, mais 0 offre nouvelle en 30 minutes : seuls 2 Scouts réveillés.",
      diskLowAfterUpdate: "Mise à jour réussie, équipe jamais démarrée : 4 Gio libres sur les 8 nécessaires, sans avertissement avant le téléchargement.",
      cleanInstallGerman: "Nouvel utilisateur en allemand : 10 pertinentes sur 26. Le frein s'est arrêté à 4,77 $, puis un faux déblocage (4,95 $ à la fin) ; Docteur et Mainteneur sans tour.",
      scoutsNoTools:
        "Scouts sans outils depuis la CLI (corrigé) ; CPU saturé sur 2 vCPU.",
      creditEnded: "Même défaut ; le crédit GLM s'est épuisé.",
      minimalTeam:
        "Équipe minimale (1/1/1) ; setup→up refusé après --reset (corrigé).",
      ceilingReached:
        "Plafond de dépense de 3 $ atteint en moins de 6 minutes.",
      wrongSources:
        "Portails à distance et informatiques pour quelqu'un qui travaille sur site (corrigé).",
      budgetFromSetup: "Budget compté depuis le setup (15 minutes perdues).",
      brakeDidNotTrigger:
        "Le frein du budget ne s'est pas déclenché : arrêté par l'essai à 5,28 $.",
      noCredit:
        "OpenAI sans crédit et la machine s'est éteinte avec le terminal : aucun Scout n'a démarré, 0 poste en 30 minutes ; seul l'Assistant (sur GLM) a dépensé 0,23 $.",
    },
    osNotes: {
      linux:
        "Installation, fuseau, préréglages de budget, équipe 5/3/2 et frein fonctionnent. Le cas « métier hors informatique, sur site » réussit (10 pertinentes sur 14).",
      windows:
        "Premier vrai tour avec les nouveaux scripts : installation ok, 50 postes pertinents. Ouverts : le frein et la taille de l'équipe n'agissent pas ; l'équipe ne remonte pas après un changement.",
      macos:
        "Le tour 19 a réussi avec des défauts, bloquants corrigés. Tour de nuit en échec (OpenAI sans crédit, machine éteinte avec le terminal) ; ouvert : la machine s'éteint à la fermeture du terminal.",
    },
    night: "nuit",
    day: "",
    targetsTitle: "Objectifs de version",
    targetsLead: "La 0.4.0 ne sort que si toutes les lignes sont vertes. Mis à jour à chaque build ; la preuve mène au tour ci-dessous.",
    targetsCount: "{g} sur {n} au vert",
    targetsCols: {
      "target": "Objectif",
      "status": "État",
      "build": "Build",
      "proof": "Preuve"
    },
    targetStatus: {
      "pass": "atteint",
      "fail": "non atteint",
      "pending": "à essayer",
      "blocked": "bloqué"
    },
    targets: {
      "scoutBenchCook": "Banc des Scouts · cuisinier",
      "scoutBenchWarehouse": "Banc des Scouts · magasinier",
      "scoutBenchNurse": "Banc des Scouts · infirmière",
      "scoutBenchBricklayer": "Banc des Scouts · maçon",
      "languageWindows": "Configuration et onboarding dans la langue choisie · Windows",
      "languageLinux": "Configuration et onboarding dans la langue choisie · Linux",
      "languageMac": "Configuration et onboarding dans la langue choisie · Mac",
      "preTagReview": "Revue de sécurité avant le tag",
      "installWindows": "Installation par un nouvel utilisateur · Windows",
      "installLinux": "Installation par un nouvel utilisateur · Linux",
      "installMac": "Installation par un nouvel utilisateur · Mac",
      "updateLinux": "Mise à jour avec équipe et données existantes · Linux",
      "updateMac": "Mise à jour avec équipe et données existantes · Mac",
      "updateWindows": "Mise à jour avec équipe et données existantes · Windows",
      "nonItRelevant": "Profil hors informatique, sur site : au moins 70 % d'offres pertinentes",
      "scoutBench": "Banc des Scouts, 4 métiers hors informatique (≥70 % pertinentes, 0 doublon, ≥15 offres)",
      "budgetBrake": "Frein du budget : jamais au-dessus du plafond, aucun faux déblocage, la personne est prévenue",
      "language": "Setup et onboarding dans la langue choisie",
      "doctorMaintainer": "Le Docteur et le Mainteneur travaillent vraiment",
      "serviceClaude": "Service Claude",
      "serviceOpenai": "Service OpenAI avec clé API",
      "serviceGlmKimi": "Services GLM et Kimi",
      "openaiSubscription": "OpenAI sur Pi avec un abonnement ChatGPT",
      "noKeyOnDisk": "Aucune clé laissée sur le disque",
      "betaTester": "Bêta-test : version mise à jour et équipe au travail"
    },
    targetNotes: {
      "updateLinuxBuild9": "build 9 : réussi (son tour n'est pas dans le tableau ci-dessous)",
      "installerBlockedBuild9": "build 9 : arrêté par l'installeur (correction dans la build 10, tour en cours)",
      "benchCook": "79 % pertinents",
      "benchWarehouse": "90 % pertinents",
      "benchNurse": "1 doublon (94 % pertinents)",
      "benchBricklayer": "6 postes, moins de 15 (83 % pertinents)",
      "brakeFixedRetry": "corrigé dans les builds 9 et 10 : à réessayer",
      "languageGermanOk": "build 9 : allemand du début à la fin sous Linux",
      "chatgptFreeRefused": "connexion refusée (forfait Free)",
      "securityPreTag": "revue avant le tag : aucun P0 ni P1 ; le cas de la clé sur disque est clos",
      "cleanLinuxRoundMissing": "installation vierge sur la build 6 : son tour n'est pas dans le tableau ci-dessous (r9 est une mise à jour)",
      "openaiRoundMissing": "vérifié sur la build 6 : son tour n'est pas dans le tableau ci-dessous",
      "redoOnBuild9": "à refaire sur la build 9",
      "diskFull": "disque plein après la mise à jour (correction en cours)",
      "neverTried": "jamais essayé",
      "relevantBelow": "0 nouvelle pour le maçon, 10 sur 26 pour la réceptionniste",
      "benchPaused": "en pause jusqu'à la build 9",
      "brakeFalseClear": "faux déblocage après l'arrêt, l'avertissement à la personne a échoué",
      "languageEnglish": "étape de la clé API, démarrage de l'équipe et état en anglais (corrigés après la build 8)",
      "zeroTurns": "0 tour (corrigé dans la build 9)",
      "noCredit": "pas de crédit pour les essayer",
      "loginNeverTried": "vraie connexion jamais essayée",
      "keysChecked": "0 fichier avec clé hors de sa place, sur 20 927 événements de fichiers",
      "updateOnBuild9": "mise à jour sur la build 9"
    },
    targetSections: {
      "install": "Installation par un nouvel utilisateur",
      "update": "Mise à jour avec équipe et données",
      "scout": "Scout, métiers hors informatique",
      "brake": "Frein des dépenses",
      "language": "Langue",
      "doctor": "Docteur et Mainteneur",
      "services": "Services",
      "security": "Sécurité",
      "beta": "Bêta-testeur",
    },
    targetRows: {
      "install": "Installation par un nouvel utilisateur",
      "update": "Mise à jour avec équipe et données déjà là",
      "language": "Configuration et onboarding dans la langue choisie",
    },
    buildsTitle: "Tours de chaque build",
    buildLabel: "Build {n}",
    noRound: "aucun tour",
    none: "—",
    finder: {
      title: "Trouve les tests les plus proches de ton cas",
      lead: "Dis quel ordinateur tu as, quel service tu utiliserais, ton budget et ton métier. Tu vois les tours et études de cas qui correspondent, puis les plus proches, avec la raison. Dans nos tests, avec nos profils : pas une promesse de ce que tu obtiendras.",
      computer: "Ton ordinateur",
      service: "Service",
      budget: "Budget (dollars)",
      budgetHint: "Ce que tu dépenserais, p. ex. 15",
      trade: "Ton métier",
      tradeHint: "Texte libre ; les suggestions sont les métiers de nos tests",
      sector: "Secteur",
      any: "Peu importe",
      reset: "Vider les champs",
      searchLabel: "Trouver des tests proches de ton cas",
      prompt:
        "Remplis au moins un champ pour voir les tests les plus proches de ton cas.",
      matchTitle: "Correspondent",
      closeTitle: "Les plus proches",
      none: "Aucun tour ni étude de cas n'est proche : change un champ.",
      count: "{n} tests trouvés",
      roundKind: "Tour",
      caseKind: "Étude de cas",
      openCase: "Ouvrir l'étude de cas",
      nothingExact:
        "Aucun ne correspond à tous les champs remplis : voici les plus proches.",
      disclaimer:
        "Dans nos tests, avec des profils fictifs et les builds indiquées. Ce que tu obtiendras dépend de ton CV, de ton marché et de ton budget ; nous ne promettons aucun résultat.",
      whyLabel: "Pourquoi :",
      estimateLabel: "estimation",
      estimateMore:
        "Avec {b} $ ≈ {x}× ce que ce tour a dépensé ({c} $). Une proportion, pas une promesse : coûts et résultats ne croissent pas en ligne droite.",
      estimateLess:
        "Avec {b} $ ≈ {x} % de ce que ce tour a dépensé ({c} $). Une proportion, pas une promesse : un budget plus petit peut arrêter l'équipe plus tôt.",
      sectors: {
        hospitality: "Restauration et hôtellerie",
        health: "Santé",
        trades: "Artisanat et métiers manuels",
        office: "Bureau et finance",
        culture: "Culture et patrimoine",
        it: "Informatique",
        transport: "Transport et logistique",
      },
      reasons: {
        "service-same": "même service ({v})",
        "service-other": "autre service ({v})",
        "os-same": "même système ({v})",
        "os-other": "autre système ({v})",
        "sector-same": "même secteur ({v})",
        "sector-other": "autre secteur ({v})",
        "trade-same": "même métier",
        "trade-similar": "métier proche ({v})",
        "budget-close": "budget proche ({v} $ dépensés)",
        "budget-other": "celui-ci a dépensé {v} $, tu as {w} $",
      },
    },
  },
  pt: {
    metaTitle: "Benchmark 0.4.0 · Job Hunter Team",
    title: "Benchmark 0.4.0: quatro serviços, três sistemas",
    lead: "O que a equipa gastou e encontrou nas rondas de teste de 14 a 17 de novembro de 2026, com os serviços de chave API que o harness 0.4.0 oferece. Os números vêm dos relatórios dos testes e dos amostradores de custo.",
    banner:
      "Uma primeira comparação, não um benchmark limpo. Máquinas, perfis, builds, orçamentos e tamanhos da equipa mudam de ronda para ronda, e há uma ronda por serviço: lê os limites abaixo antes de comparar.",
    roundsTitle: "Cada ronda",
    cols: {
      round: "Ronda",
      profile: "Perfil",
      minutes: "Minutos",
      spent: "Gasto",
      found: "Encontradas / avaliadas / pertinentes",
      perScored: "$ por avaliada",
      outcome: "Resultado",
      note: "O que aconteceu",
    },
    colsHint:
      "«Pertinentes» = posições cujo título corresponde ao ofício, verificadas por amostragem.",
    chartTitle: "Quanto custa uma posição avaliada",
    chartLead:
      "Dólares gastos por cada posição avaliada pela equipa. Mais curta é melhor. As rondas sem posições avaliadas não têm barra.",
    chartNone: "nenhuma avaliada",
    chartCaveat:
      "As duas rondas do Mac duraram 6 e 10 minutos com uma equipa mínima, e o custo é quase todo onboarding e Capitano: não são comparáveis com rondas de 16-42 minutos.",
    servicesTitle: "Serviços: o que vimos ao lado das estimativas",
    servicesCols: {
      service: "Serviço",
      kit: "Estimativa para 30 min",
      seen: "Visto nas rondas",
      rate: "Ritmo visto",
    },
    servicesCaveat:
      "As estimativas vêm do volume do GLM reprecificado, não de medições nos outros serviços. O Claude no Windows gastou mais do que o estimado: Capitano e Scorer pesam 3,05 $ de 5,28 $.",
    osTitle: "Por sistema",
    limitsTitle: "O que vale e o que não vale esta comparação",
    limitsLead: "Cada ronda difere das outras em algo que pesa nos números:",
    limits: [
      "máquinas diferentes: uma VPS Linux de 2 vCPU e 4 GB, um portátil Windows, um Mac com outros programas abertos;",
      "perfis diferentes (analista de dados, restauradora, empregado de mesa, rececionista, motorista) e mercados de trabalho diferentes;",
      "builds e orçamentos diferentes (teto de 3 $, predefinição de 5 $ por 30 minutos);",
      "equipas de tamanhos diferentes: 5/3/2 em Linux, 1/1/1 no Mac e na ronda noturna do Windows, por um defeito do travão do orçamento;",
      "tempos de trabalho curtos (6-42 minutos) e uma só ronda por serviço: abaixo de 25 % de diferença não se distingue o ruído do sinal.",
    ],
    needTitle: "O que é preciso para um benchmark limpo",
    need: "Quatro VPS iguais ligadas ao mesmo tempo, o mesmo perfil para todos, 30 minutos de trabalho depois do onboarding, a mesma build com o travão do orçamento corrigido e crédito nos quatro serviços.",
    back: "← Todos os estudos de caso",
    tuxCredit: "Tux, o pinguim do Linux: Larry Ewing e The GIMP.",
    footer:
      "Perfis fictícios, sem dados pessoais · números dos relatórios de teste de 14-17/11/2026.",
    outcome: {
      pass: "passa",
      reservations: "com reservas",
      fail: "falha",
      running: "em curso",
    },
    system: {
      pass: "passa",
      withReservations: "passa com reservas",
      running: "em curso",
    },
    profiles: {
      bricklayer: "Pedreiro",
      officeClerk: "Administrativa a tempo parcial",
      dataAnalyst: "Analista de dados",
      generic: "Perfil de teste genérico",
      restorer: "Restauradora",
      waiter: "Empregado de mesa",
      receptionist: "Rececionista",
      truckDriver: "Motorista de pesados",
    },
    modes: { onsite: "presencial", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI → GLM",
    },
    notes: {
      updateSwitchKept: "Atualização com a equipa a correr: dados mantidos, imagens antigas retiradas, GLM → Claude sem parar a equipa. 3 pertinentes de 26 novas em 10 minutos.",
      updateWelcomePaid: "Atualização e passagem para o Claude: 15 pertinentes de 18 em 12 minutos. As boas-vindas foram pagas de novo a cada reinício.",
      cleanInstallWarehouse: "Utilizador novo, onboarding guiado: o travão parou em 2,67 $. Quase só armazém: 2 pertinentes de 19.",
      updateNoNewPositions: "Atualização bem-sucedida e nenhum ficheiro com chave no disco, mas 0 vagas novas em 30 minutos: só 2 Scouts acordados.",
      diskLowAfterUpdate: "Atualização bem-sucedida, a equipa nunca arrancou: 4 GiB livres dos 8 necessários, sem aviso antes da transferência.",
      cleanInstallGerman: "Utilizador novo em alemão: 10 pertinentes de 26. O travão parou em 4,77 $, depois um falso desbloqueio (4,95 $ no fim); Doutor e Mantenedor sem turnos.",
      scoutsNoTools:
        "Scouts sem ferramentas a partir da CLI (corrigido); CPU saturado em 2 vCPU.",
      creditEnded: "Mesmo defeito; o crédito GLM esgotou-se.",
      minimalTeam:
        "Equipa mínima (1/1/1); setup→up recusado após --reset (corrigido).",
      ceilingReached: "Teto de gasto de 3 $ atingido em menos de 6 minutos.",
      wrongSources:
        "Portais remotos e informáticos para quem trabalha presencialmente (corrigido).",
      budgetFromSetup: "Orçamento contado desde o setup (15 minutos perdidos).",
      brakeDidNotTrigger:
        "O travão do orçamento não disparou: parado pelo teste a 5,28 $.",
      noCredit:
        "OpenAI sem crédito e a máquina desligou com o terminal: nenhum Scout arrancou, 0 posições em 30 minutos; só o Assistente (em GLM) gastou 0,23 $.",
    },
    osNotes: {
      linux:
        "Instalação, fuso horário, predefinições de orçamento, equipa 5/3/2 e travão funcionam. O caso «ofício fora de TI, presencial» passa (10 pertinentes de 14).",
      windows:
        "Primeira ronda real com os scripts novos: instalação ok, 50 posições pertinentes. Em aberto: o travão e o tamanho da equipa não atuam; a equipa não volta a crescer após uma troca.",
      macos:
        "A ronda 19 passou com defeitos, bloqueantes corrigidos. Ronda noturna falhada (OpenAI sem crédito, máquina desligada com o terminal); em aberto: a máquina desliga ao fechar o terminal.",
    },
    night: "noite",
    day: "",
    targetsTitle: "Objetivos de lançamento",
    targetsLead: "A 0.4.0 só é lançada com todas as linhas a verde. Atualizado a cada build; a prova leva à ronda mais abaixo.",
    targetsCount: "{g} de {n} a verde",
    targetsCols: {
      "target": "Objetivo",
      "status": "Estado",
      "build": "Build",
      "proof": "Prova"
    },
    targetStatus: {
      "pass": "cumprido",
      "fail": "não cumprido",
      "pending": "por testar",
      "blocked": "bloqueado"
    },
    targets: {
      "scoutBenchCook": "Bancada de Scouts · cozinheiro",
      "scoutBenchWarehouse": "Bancada de Scouts · operador de armazém",
      "scoutBenchNurse": "Bancada de Scouts · enfermeira",
      "scoutBenchBricklayer": "Bancada de Scouts · pedreiro",
      "languageWindows": "Configuração e onboarding na língua escolhida · Windows",
      "languageLinux": "Configuração e onboarding na língua escolhida · Linux",
      "languageMac": "Configuração e onboarding na língua escolhida · Mac",
      "preTagReview": "Revisão de segurança antes da tag",
      "installWindows": "Instalação por um utilizador novo · Windows",
      "installLinux": "Instalação por um utilizador novo · Linux",
      "installMac": "Instalação por um utilizador novo · Mac",
      "updateLinux": "Atualização com equipa e dados existentes · Linux",
      "updateMac": "Atualização com equipa e dados existentes · Mac",
      "updateWindows": "Atualização com equipa e dados existentes · Windows",
      "nonItRelevant": "Perfil fora da informática, presencial: pelo menos 70% de vagas pertinentes",
      "scoutBench": "Banco dos Scouts, 4 profissões fora da informática (≥70% pertinentes, 0 duplicados, ≥15 vagas)",
      "budgetBrake": "Travão do orçamento: nunca acima do teto, nenhum falso desbloqueio, aviso à pessoa",
      "language": "Setup e onboarding na língua escolhida",
      "doctorMaintainer": "O Doutor e o Mantenedor trabalham mesmo",
      "serviceClaude": "Serviço Claude",
      "serviceOpenai": "Serviço OpenAI com chave de API",
      "serviceGlmKimi": "Serviços GLM e Kimi",
      "openaiSubscription": "OpenAI no Pi com assinatura ChatGPT",
      "noKeyOnDisk": "Nenhuma chave deixada no disco",
      "betaTester": "Beta teste: versão atualizada e equipa a trabalhar"
    },
    targetNotes: {
      "updateLinuxBuild9": "build 9: aprovado (a rodada não está na tabela abaixo)",
      "installerBlockedBuild9": "build 9: parado pelo instalador (correção na build 10, rodada em curso)",
      "benchCook": "79% pertinentes",
      "benchWarehouse": "90% pertinentes",
      "benchNurse": "1 duplicado (94% pertinentes)",
      "benchBricklayer": "6 vagas, menos de 15 (83% pertinentes)",
      "brakeFixedRetry": "corrigido nas builds 9 e 10: a voltar a testar",
      "languageGermanOk": "build 9: alemão do início ao fim no Linux",
      "chatgptFreeRefused": "acesso recusado (plano Free)",
      "securityPreTag": "revisão antes da tag: nenhum P0 ou P1; o caso da chave no disco está fechado",
      "cleanLinuxRoundMissing": "instalação de raiz na build 6: a sua ronda não está na tabela abaixo (r9 é uma atualização)",
      "openaiRoundMissing": "provado na build 6: a sua ronda não está na tabela abaixo",
      "redoOnBuild9": "a repetir na build 9",
      "diskFull": "disco cheio após a atualização (correção em curso)",
      "neverTried": "nunca testado",
      "relevantBelow": "0 novas para o pedreiro, 10 de 26 para a rececionista",
      "benchPaused": "em pausa até à build 9",
      "brakeFalseClear": "falso desbloqueio após a paragem, o aviso à pessoa falhou",
      "languageEnglish": "passo da chave de API, arranque da equipa e estado em inglês (corrigidos após a build 8)",
      "zeroTurns": "0 turnos (corrigido na build 9)",
      "noCredit": "sem crédito para os testar",
      "loginNeverTried": "início de sessão real nunca testado",
      "keysChecked": "0 ficheiros com chave fora do lugar, em 20 927 eventos de ficheiros",
      "updateOnBuild9": "atualização na build 9"
    },
    targetSections: {
      "install": "Instalação por um utilizador novo",
      "update": "Atualização com equipa e dados",
      "scout": "Scout, ofícios fora da informática",
      "brake": "Travão da despesa",
      "language": "Língua",
      "doctor": "Doutor e Mantenedor",
      "services": "Serviços",
      "security": "Segurança",
      "beta": "Beta tester",
    },
    targetRows: {
      "install": "Instalação por um utilizador novo",
      "update": "Atualização com equipa e dados já presentes",
      "language": "Configuração e onboarding na língua escolhida",
    },
    buildsTitle: "Rondas de cada build",
    buildLabel: "Build {n}",
    noRound: "nenhuma ronda",
    none: "—",
    finder: {
      title: "Encontra os testes mais próximos do teu caso",
      lead: "Diz que computador tens, que serviço usarias, o teu orçamento e o teu ofício. Vês as rondas e os estudos de caso que correspondem, depois os mais próximos, com o motivo. Nos nossos testes, com os nossos perfis: não é uma promessa do que vais conseguir.",
      computer: "O teu computador",
      service: "Serviço",
      budget: "Orçamento (dólares)",
      budgetHint: "O que gastarias, p. ex. 15",
      trade: "O teu ofício",
      tradeHint: "Texto livre; as sugestões são os ofícios dos nossos testes",
      sector: "Setor",
      any: "Qualquer",
      reset: "Limpar os campos",
      searchLabel: "Encontrar testes próximos do teu caso",
      prompt:
        "Preenche pelo menos um campo para ver os testes mais próximos do teu caso.",
      matchTitle: "Correspondem",
      closeTitle: "Os mais próximos",
      none: "Nenhuma ronda nem estudo de caso se aproxima disto: muda um campo.",
      count: "{n} testes encontrados",
      roundKind: "Ronda",
      caseKind: "Estudo de caso",
      openCase: "Abrir o estudo de caso",
      nothingExact:
        "Nenhum corresponde a todos os campos preenchidos: aqui ficam os mais próximos.",
      disclaimer:
        "Nos nossos testes, com perfis fictícios e as builds indicadas. O que vais conseguir depende do teu CV, do teu mercado e do teu orçamento; não prometemos um resultado.",
      whyLabel: "Porquê:",
      estimateLabel: "estimativa",
      estimateMore:
        "Com {b} $ ≈ {x}× o que esta ronda gastou ({c} $). Uma proporção, não uma promessa: custos e resultados não crescem em linha reta.",
      estimateLess:
        "Com {b} $ ≈ {x} % do que esta ronda gastou ({c} $). Uma proporção, não uma promessa: um orçamento menor pode parar a equipa mais cedo.",
      sectors: {
        hospitality: "Restauração e hotelaria",
        health: "Saúde",
        trades: "Ofícios e artesanato",
        office: "Escritório e finanças",
        culture: "Cultura e património",
        it: "Informática",
        transport: "Transporte e logística",
      },
      reasons: {
        "service-same": "mesmo serviço ({v})",
        "service-other": "outro serviço ({v})",
        "os-same": "mesmo sistema ({v})",
        "os-other": "outro sistema ({v})",
        "sector-same": "mesmo setor ({v})",
        "sector-other": "outro setor ({v})",
        "trade-same": "mesmo ofício",
        "trade-similar": "ofício parecido ({v})",
        "budget-close": "orçamento próximo ({v} $ gastos)",
        "budget-other": "esta gastou {v} $, tu tens {w} $",
      },
    },
  },
  hu: {
    metaTitle: "0.4.0 benchmark · Job Hunter Team",
    title: "0.4.0 benchmark: négy szolgáltatás, három rendszer",
    lead: "Amit a csapat 2026. november 14–17. próbafutásaiban elköltött és megtalált, a 0.4.0 harness API-kulcsos szolgáltatásaival. A számok a próbák jegyzőkönyveiből és a költségmintavevőkből származnak.",
    banner:
      "Első összevetés, nem tiszta benchmark. A gépek, profilok, buildek, költségkeretek és csapatméretek futásonként eltérnek, és szolgáltatásonként egy futás van: összehasonlítás előtt olvasd el az alábbi korlátokat.",
    roundsTitle: "Minden futás",
    cols: {
      round: "Futás",
      profile: "Profil",
      minutes: "Perc",
      spent: "Költés",
      found: "Talált / értékelt / releváns",
      perScored: "$ / értékelt",
      outcome: "Eredmény",
      note: "Mi történt",
    },
    colsHint:
      "«Releváns» = olyan pozíciók, amelyek címe megfelel a szakmának, mintavétellel ellenőrizve.",
    chartTitle: "Mennyibe kerül egy értékelt pozíció",
    chartLead:
      "A csapat által értékelt pozíciónként elköltött dollár. Minél rövidebb, annál jobb. Értékelt pozíció nélküli futásnak nincs oszlopa.",
    chartNone: "nincs értékelt",
    chartCaveat:
      "A két Mac-futás 6 és 10 percig tartott minimális csapattal, a költség szinte csak onboarding és Capitano: nem összevethető a 16–42 perces futásokkal.",
    servicesTitle: "Szolgáltatások: amit láttunk a becslések mellett",
    servicesCols: {
      service: "Szolgáltatás",
      kit: "Becslés 30 percre",
      seen: "Látott a futásokban",
      rate: "Látott tempó",
    },
    servicesCaveat:
      "A becslések az újraárazott GLM-volumenből származnak, nem a többi szolgáltatás méréseiből. A Claude Windowson többet költött a becsültnél: a Capitano és a Scorer 3,05 $-t nyom az 5,28 $-ból.",
    osTitle: "Rendszerenként",
    limitsTitle: "Mit ér és mit nem ez az összevetés",
    limitsLead:
      "Minden futás eltér a többitől valamiben, ami nyom a számokban:",
    limits: [
      "különböző gépek: 2 vCPU-s, 4 GB-os Linux VPS, Windows laptop, Mac más futó programokkal;",
      "különböző profilok (adatelemző, restaurátor, pincér, recepciós, kamionsofőr) és munkaerőpiacok;",
      "különböző buildek és költségkeretek (3 $-os plafon, 5 $ / 30 perces előbeállítás);",
      "különböző csapatméretek: 5/3/2 Linuxon, 1/1/1 a Macen és az éjszakai Windows-futásban, a költségfék hibája miatt;",
      "rövid munkaidők (6–42 perc) és szolgáltatásonként egy futás: 25 % alatti különbségnél a zaj nem választható el a jeltől.",
    ],
    needTitle: "Mi kell egy tiszta benchmarkhoz",
    need: "Négy egyforma VPS egyszerre elindítva, mindenkinek ugyanaz a profil, az onboarding után 30 perc munka, ugyanaz a build javított költségfékkel, és egyenleg mind a négy szolgáltatáson.",
    back: "← Minden esettanulmány",
    tuxCredit: "Tux, a Linux pingvinje: Larry Ewing és The GIMP.",
    footer:
      "Kitalált profilok, személyes adat nélkül · számok a 2026.11.14–17-i próbák jegyzőkönyveiből.",
    outcome: {
      pass: "megfelelt",
      reservations: "fenntartással",
      fail: "megbukott",
      running: "folyamatban",
    },
    system: {
      pass: "megfelel",
      withReservations: "fenntartással megfelel",
      running: "folyamatban",
    },
    profiles: {
      bricklayer: "Kőműves",
      officeClerk: "Irodai ügyintéző, részmunkaidő",
      dataAnalyst: "Adatelemző",
      generic: "Általános próbaprofil",
      restorer: "Restaurátor",
      waiter: "Pincér",
      receptionist: "Recepciós",
      truckDriver: "Kamionsofőr",
    },
    modes: { onsite: "helyszínen", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI → GLM",
    },
    notes: {
      updateSwitchKept: "Frissítés futó csapattal: adatok megtartva, régi képfájlok törölve, GLM → Claude a csapat leállítása nélkül. 26 újból 3 releváns 10 perc alatt.",
      updateWelcomePaid: "Frissítés és váltás Claude-ra: 18-ból 15 releváns 12 perc alatt. Az üdvözlést minden újraindításkor újra kifizette.",
      cleanInstallWarehouse: "Új felhasználó, vezetett bevezetés: a fék 2,67 $-nál állt meg. Szinte csak raktári állás: 19-ből 2 releváns.",
      updateNoNewPositions: "A frissítés sikerült, és nem maradt kulcsos fájl a lemezen, de 30 perc alatt 0 új állás: csak 2 Scoutot ébresztett fel.",
      diskLowAfterUpdate: "A frissítés sikerült, a csapat sosem indult el: 4 GiB szabad a szükséges 8-ból, figyelmeztetés nélkül a letöltés előtt.",
      cleanInstallGerman: "Új felhasználó németül: 26-ból 10 releváns. A fék 4,77 $-nál megállt, aztán hamis feloldás (a végén 4,95 $); a Doktor és a Karbantartó egy kört sem futott.",
      scoutsNoTools:
        "A Scoutok eszközök nélkül a CLI-ből (javítva); a CPU 2 vCPU-n telített.",
      creditEnded: "Ugyanaz a hiba; a GLM-egyenleg elfogyott.",
      minimalTeam:
        "Minimális csapat (1/1/1); a setup→up --reset után elutasítva (javítva).",
      ceilingReached: "A 3 $-os költségplafon 6 percen belül elérve.",
      wrongSources:
        "Távoli és informatikai portálok a helyszínen dolgozónak (javítva).",
      budgetFromSetup: "A keret a setuptól számolva (15 perc elveszett).",
      brakeDidNotTrigger:
        "A költségfék nem lépett működésbe: a próba 5,28 $-nál leállította.",
      noCredit:
        "Az OpenAI egyenlege elfogyott, és a gép a terminállal együtt kikapcsolt: egy Scout sem indult el, 0 pozíció 30 perc alatt; csak az Asszisztens (GLM-en) költött 0,23 $-t.",
    },
    osNotes: {
      linux:
        "Telepítés, időzóna, költségkeret-előbeállítások, 5/3/2 csapat és fék működik. Az «IT-n kívüli szakma, helyszínen» eset megfelel (14-ből 10 releváns).",
      windows:
        "Az első valódi futás az új szkriptekkel: telepítés rendben, 50 releváns pozíció. Nyitott: a költségfék és a csapatméret nem hat; váltás után a csapat nem nő vissza.",
      macos:
        "A 19. futás hibákkal megfelelt, a blokkolók javítva. Az éjszakai futás megbukott (OpenAI-egyenleg nélkül, a gép a terminállal együtt kikapcsolt); nyitott: a gép kikapcsol a terminál bezárásakor.",
    },
    night: "éjszaka",
    day: "",
    targetsTitle: "Kiadási célok",
    targetsLead: "A 0.4.0 csak akkor jelenik meg, ha minden sor zöld. Minden buildnél frissül; a bizonyíték a lenti futáshoz visz.",
    targetsCount: "{n}-ből {g} zöld",
    targetsCols: {
      "target": "Cél",
      "status": "Állapot",
      "build": "Build",
      "proof": "Bizonyíték"
    },
    targetStatus: {
      "pass": "teljesült",
      "fail": "nem teljesült",
      "pending": "kipróbálandó",
      "blocked": "elakadt"
    },
    targets: {
      "scoutBenchCook": "Scout-pad · szakács",
      "scoutBenchWarehouse": "Scout-pad · raktáros",
      "scoutBenchNurse": "Scout-pad · ápolónő",
      "scoutBenchBricklayer": "Scout-pad · kőműves",
      "languageWindows": "Beállítás és onboarding a választott nyelven · Windows",
      "languageLinux": "Beállítás és onboarding a választott nyelven · Linux",
      "languageMac": "Beállítás és onboarding a választott nyelven · Mac",
      "preTagReview": "Biztonsági átnézés a tag előtt",
      "installWindows": "Telepítés új felhasználóként · Windows",
      "installLinux": "Telepítés új felhasználóként · Linux",
      "installMac": "Telepítés új felhasználóként · Mac",
      "updateLinux": "Frissítés meglévő csapattal és adatokkal · Linux",
      "updateMac": "Frissítés meglévő csapattal és adatokkal · Mac",
      "updateWindows": "Frissítés meglévő csapattal és adatokkal · Windows",
      "nonItRelevant": "IT-n kívüli, helyszíni profil: legalább 70% releváns állás",
      "scoutBench": "Scout-próbapad, 4 IT-n kívüli szakma (≥70% releváns, 0 ismétlődés, ≥15 állás)",
      "budgetBrake": "Keretfék: soha a plafon fölött, nincs hamis feloldás, a felhasználó értesül",
      "language": "Beállítás és bevezetés a választott nyelven",
      "doctorMaintainer": "A Doktor és a Karbantartó tényleg dolgozik",
      "serviceClaude": "Claude szolgáltatás",
      "serviceOpenai": "OpenAI szolgáltatás API-kulccsal",
      "serviceGlmKimi": "GLM és Kimi szolgáltatás",
      "openaiSubscription": "OpenAI a Pi-n ChatGPT-előfizetéssel",
      "noKeyOnDisk": "Nem marad kulcs a lemezen",
      "betaTester": "Béta teszt: a verzió frissítve, a csapat munkában"
    },
    targetNotes: {
      "updateLinuxBuild9": "9. build: sikeres (a köre nincs az alábbi táblázatban)",
      "installerBlockedBuild9": "9. build: a telepítő megállította (javítás a 10. buildben, a kör folyamatban)",
      "benchCook": "79% releváns",
      "benchWarehouse": "90% releváns",
      "benchNurse": "1 ismétlődés (94% releváns)",
      "benchBricklayer": "6 állás, kevesebb mint 15 (83% releváns)",
      "brakeFixedRetry": "javítva a 9. és 10. buildben: újra kipróbálandó",
      "languageGermanOk": "9. build: végig németül Linuxon",
      "chatgptFreeRefused": "bejelentkezés elutasítva (Free csomag)",
      "securityPreTag": "átnézés a tag előtt: nincs P0 vagy P1; a lemezen maradt kulcs ügye lezárva",
      "cleanLinuxRoundMissing": "tiszta telepítés a 6. buildön: a futása nincs a lenti táblázatban (az r9 frissítés)",
      "openaiRoundMissing": "a 6. buildön igazolva: a futása nincs a lenti táblázatban",
      "redoOnBuild9": "a 9. buildön megismétlendő",
      "diskFull": "megtelt lemez a frissítés után (javítás folyamatban)",
      "neverTried": "sosem próbálták",
      "relevantBelow": "0 új a kőművesnek, 26-ból 10 a recepciósnak",
      "benchPaused": "szünetel a 9. buildig",
      "brakeFalseClear": "hamis feloldás a leállás után, a felhasználó értesítése nem sikerült",
      "languageEnglish": "API-kulcs lépés, csapatindítás és állapot angolul (a 8. build után javítva)",
      "zeroTurns": "0 kör (a 9. buildben javítva)",
      "noCredit": "nincs egyenleg a kipróbálásukhoz",
      "loginNeverTried": "valódi bejelentkezés sosem próbálva",
      "keysChecked": "0 kulcsos fájl a helyén kívül, 20 927 fájleseményből",
      "updateOnBuild9": "frissítés a 9. buildön"
    },
    targetSections: {
      "install": "Telepítés új felhasználóként",
      "update": "Frissítés csapattal és adatokkal",
      "scout": "Scout, nem IT szakmák",
      "brake": "Költségfék",
      "language": "Nyelv",
      "doctor": "Doktor és Karbantartó",
      "services": "Szolgáltatások",
      "security": "Biztonság",
      "beta": "Bétatesztelő",
    },
    targetRows: {
      "install": "Telepítés új felhasználóként",
      "update": "Frissítés meglévő csapattal és adatokkal",
      "language": "Beállítás és onboarding a választott nyelven",
    },
    buildsTitle: "Az egyes buildek futásai",
    buildLabel: "{n}. build",
    noRound: "nincs futás",
    none: "—",
    finder: {
      title: "Keresd meg a te esetedhez legközelebbi teszteket",
      lead: "Add meg, milyen számítógéped van, melyik szolgáltatást használnád, mekkora a költségkereted és mi a szakmád. Látod az egyező futásokat és esettanulmányokat, utána a legközelebbieket, indoklással. A mi tesztjeinkben, a mi profiljainkkal: nem ígéret arra, amit te elérsz.",
      computer: "A számítógéped",
      service: "Szolgáltatás",
      budget: "Költségkeret (dollár)",
      budgetHint: "Amit elköltenél, pl. 15",
      trade: "A szakmád",
      tradeHint: "Szabad szöveg; a javaslatok a tesztjeink szakmái",
      sector: "Ágazat",
      any: "Bármelyik",
      reset: "Mezők törlése",
      searchLabel: "Az esetedhez közeli tesztek keresése",
      prompt:
        "Tölts ki legalább egy mezőt, hogy lásd az esetedhez legközelebbi teszteket.",
      matchTitle: "Egyeznek",
      closeTitle: "A legközelebbiek",
      none: "Egyetlen futás vagy esettanulmány sem áll ehhez közel: módosíts egy mezőt.",
      count: "{n} teszt található",
      roundKind: "Futás",
      caseKind: "Esettanulmány",
      openCase: "Az esettanulmány megnyitása",
      nothingExact:
        "Egyik sem egyezik az összes kitöltött mezővel: itt vannak a legközelebbiek.",
      disclaimer:
        "A mi tesztjeinkben, kitalált profilokkal és a jelzett buildekkel. Amit elérsz, az az önéletrajzodtól, a piacodtól és a költségkeretedtől függ; eredményt nem ígérünk.",
      whyLabel: "Miért:",
      estimateLabel: "becslés",
      estimateMore:
        "{b} $-ral ≈ {x}× annyi, mint amennyit ez a futás költött ({c} $). Arány, nem ígéret: a költség és az eredmény nem nő egyenes vonalban.",
      estimateLess:
        "{b} $-ral ≈ {x} %-a annak, amennyit ez a futás költött ({c} $). Arány, nem ígéret: kisebb költségkeret korábban leállíthatja a csapatot.",
      sectors: {
        hospitality: "Vendéglátás és szállodaipar",
        health: "Egészségügy",
        trades: "Kézműipar és szakmák",
        office: "Iroda és pénzügy",
        culture: "Kultúra és örökségvédelem",
        it: "Informatika",
        transport: "Szállítás és logisztika",
      },
      reasons: {
        "service-same": "ugyanaz a szolgáltatás ({v})",
        "service-other": "másik szolgáltatás ({v})",
        "os-same": "ugyanaz a rendszer ({v})",
        "os-other": "másik rendszer ({v})",
        "sector-same": "ugyanaz az ágazat ({v})",
        "sector-other": "másik ágazat ({v})",
        "trade-same": "ugyanaz a szakma",
        "trade-similar": "hasonló szakma ({v})",
        "budget-close": "közeli költségkeret ({v} $ elköltve)",
        "budget-other": "ez {v} $-t költött, neked {w} $ van",
      },
    },
  },
};

const ICON: Record<string, string[]> = {
  glm: ["zai"],
  claude: ["claude"],
  openai: ["openai"],
  kimi: ["kimi"],
  "openai-glm": ["openai", "zai"],
  // Linux is Tux, free to use crediting Larry Ewing and The GIMP (the credit line is at the foot of the page);
  // Windows and macOS are drawn inline below (SYSTEM_MARK), in the colour of the text
  linux: ["tux"],
};

// The marks of Windows (four panes) and macOS (the apple): small monochrome shapes in a 16×16 box, in the colour of
// the text so they read on the light and the dark theme. Shown only to name the system a round ran on.
const SYSTEM_MARK: Record<string, string> = {
  windows: "M1.5 1.5 H7.3 V7.3 H1.5 Z M8.7 1.5 H14.5 V7.3 H8.7 Z M1.5 8.7 H7.3 V14.5 H1.5 Z M8.7 8.7 H14.5 V14.5 H8.7 Z",
  macos:
    "M11.3 8.6 C11.3 7 12.6 6.2 12.7 6.1 C11.9 5 10.7 4.8 10.3 4.8 C9.3 4.7 8.3 5.4 7.8 5.4 C7.3 5.4 6.5 4.8 5.6 4.8 C4.5 4.8 3.4 5.5 2.8 6.6 C1.6 8.7 2.5 11.8 3.7 13.5 C4.3 14.3 4.9 15.2 5.8 15.2 C6.6 15.2 7 14.7 8 14.7 C9 14.7 9.3 15.2 10.2 15.2 C11.1 15.2 11.7 14.4 12.2 13.5 C12.8 12.6 13.1 11.7 13.1 11.6 C13.1 11.6 11.3 10.9 11.3 8.6 Z M9.7 3.7 C10.1 3.2 10.5 2.4 10.4 1.7 C9.8 1.7 9 2.1 8.6 2.6 C8.2 3.1 7.8 3.8 7.9 4.5 C8.6 4.6 9.3 4.2 9.7 3.7 Z",
};

function Logo({
  name,
  label,
  size = 20,
}: {
  name: string;
  label: string;
  size?: number;
}) {
  // A light chip so that black marks stay readable on the dark theme; the SVGs themselves are not modified.
  return (
    <span
      className="inline-flex items-center justify-center rounded bg-white shrink-0"
      style={{ width: size + 8, height: size + 8 }}
      title={label}
    >
      <Image
        src={`/benchmark/logos/${name}.svg`}
        alt={label}
        width={size}
        height={size}
        unoptimized
      />
    </span>
  );
}

function Mark({ id, label }: { id: string; label: string }) {
  if (SYSTEM_MARK[id])
    return (
      <span className="inline-flex items-center justify-center shrink-0" style={{ width: 28, height: 28 }} title={label}>
        <svg viewBox="0 0 16 16" width={18} height={18} role="img" aria-label={label} style={{ fill: "currentColor" }}>
          <path d={SYSTEM_MARK[id]} />
        </svg>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1">
      {ICON[id].map((n) => (
        <Logo key={n} name={n} label={label} />
      ))}
    </span>
  );
}

const OS_LABEL: Record<string, string> = {
  linux: "Linux",
  windows: "Windows",
  macos: "macOS",
};
// The release targets (web/data/benchmark/benchmark-0-4-0.json, «targets»): 0.4.0 is released only when every one is met.
const TARGET_MARK: Record<string, string> = {
  pass: "✅",
  fail: "❌",
  pending: "⏳",
  blocked: "⛔",
};
const TARGET_COLOR: Record<string, string> = {
  pass: "#22C55E",
  fail: "#EF4444",
  pending: "#F59E0B",
  blocked: "#A855F7",
};
type Target = (typeof data.targets)[number];
// The sections of the targets table, with the emoji of their heading, and the columns of the targets that differ by system.
const TARGET_SECTIONS: [string, string][] = [
  ["install", "📦"],
  ["update", "🔄"],
  ["scout", "🔍"],
  ["brake", "💸"],
  ["language", "🌍"],
  ["doctor", "🩺"],
  ["services", "🔌"],
  ["security", "🔒"],
  ["beta", "🧑‍💼"],
];
const TARGET_OS = ["windows", "linux", "macos"];
type Build = (typeof data.builds)[number];

const OUTCOME_COLOR: Record<string, string> = {
  pass: "#22C55E",
  reservations: "#84CC16",
  fail: "#EF4444",
  running: "#F59E0B",
};

// The sector of each profile of the rounds and of the category of a case study (the finder matches on it when the words differ).
const PROFILE_SECTOR: Record<string, Sector | ""> = {
  dataAnalyst: "it",
  generic: "",
  restorer: "culture",
  waiter: "hospitality",
  receptionist: "hospitality",
  truckDriver: "transport",
  bricklayer: "trades",
  officeClerk: "office",
};
const CATEGORY_SECTOR: Record<string, Sector | ""> = { finance: "office" };

export async function generateMetadata() {
  const t = T[await getRequestLocale()];
  return { title: t.metaTitle };
}

export default async function BenchmarkPage() {
  const locale = await getRequestLocale();
  const t = T[locale];
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money = (n: number | null) => (n == null ? "—" : `${nf.format(n)} $`);
  const num = (n: number | null) => (n == null ? "—" : String(n));
  const dayLabel = (r: Round) => r.day.replace("night", t.night);
  const found = (r: Round) =>
    r.found == null
      ? "—"
      : `${r.found} / ${num(r.scored)} / ${r.relevant == null ? "—" : `${(r as { relevantApprox?: boolean }).relevantApprox ? "≈" : ""}${r.relevant}`}`;
  const perScored = (r: Round) =>
    r.cost != null && r.scored ? r.cost / r.scored : null;
  const chartRows = data.rounds.filter((r) => r.outcome !== "running");
  const buildNo = (r: Round) => (r as { buildNo?: number }).buildNo;
  const roundById = new Map(data.rounds.map((r) => [r.id, r]));
  const green = data.targets.filter((x: Target) => x.status === "pass").length;
  const roundLink = (id: string) => {
    const r = roundById.get(id);
    if (!r) return null;
    return (
      <a
        key={id}
        href={`#${id}`}
        className="underline decoration-dotted hover:decoration-solid whitespace-nowrap"
      >
        {OS_LABEL[r.os]} · {t.profiles[r.profile]} · {dayLabel(r)}
      </a>
    );
  };
  // One cell of the targets table: the status, the build, the rounds that prove it; the note small below and whole in the tooltip.
  const targetCell = (x: Target) => {
    const note = x.note ? t.targetNotes[x.note] : "";
    return (
      <div className="space-y-0.5" title={note || undefined}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap"
            style={{ color: TARGET_COLOR[x.status], background: `color-mix(in srgb, ${TARGET_COLOR[x.status]} 16%, transparent)` }}
          >
            <span aria-hidden="true">{TARGET_MARK[x.status]}</span> {t.targetStatus[x.status]}
          </span>
          {x.build != null && (
            <span className="text-[11px] tabular-nums text-[var(--color-muted)] whitespace-nowrap">
              {t.buildLabel.replace("{n}", String(x.build))}
            </span>
          )}
          {x.proof.map((id: string) => {
            const r = roundById.get(id);
            return (
              <a
                key={id}
                href={`#${id}`}
                title={r ? `${OS_LABEL[r.os]} · ${t.profiles[r.profile]} · ${dayLabel(r)}` : id}
                className="text-[11px] underline decoration-dotted hover:decoration-solid tabular-nums"
              >
                {id}
              </a>
            );
          })}
        </div>
        {note && <div className="text-[10px] leading-snug text-[var(--color-dim)] line-clamp-2">{note}</div>}
      </div>
    );
  };
  const maxChart = Math.max(...chartRows.map((r) => perScored(r) ?? 0), 0.0001);

  const trade = (key: string) =>
    (Object.values(T) as Copy[]).map((c) => c.profiles[key]).filter(Boolean);
  const roundViews: CandidateView[] = data.rounds.map((r) => ({
    kind: "round",
    id: r.id,
    os: r.os,
    service: r.service,
    cost: r.cost,
    sector: PROFILE_SECTOR[r.profile] ?? "",
    trades: trade(r.profile),
    title: `${t.services[r.service]} · ${OS_LABEL[r.os]}`,
    subtitle: `${t.profiles[r.profile]}${t.modes[r.mode] ? ` · ${t.modes[r.mode]}` : ""} · ${dayLabel(r)}`,
    pill: { label: t.outcome[r.outcome], color: OUTCOME_COLOR[r.outcome] },
    stats: [
      { label: t.cols.spent, value: money(r.cost) },
      { label: t.cols.found, value: found(r) },
    ],
  }));
  const caseViews: CandidateView[] = CASE_STUDIES.map((c) => {
    const l = localizeCaseStudy(c, locale);
    return {
      kind: "case",
      id: c.id,
      href: `/case-studies/${c.id}`,
      service: c.model.toLowerCase(),
      sector: CATEGORY_SECTOR[c.category.toLowerCase()] ?? "",
      trades: [l.category, c.category, l.label],
      title: l.label,
      subtitle: l.tagline,
      stats: [{ label: c.subscription.provider, value: l.subscription.price }],
    };
  });
  const tradeSuggestions = Array.from(
    new Set([
      ...Object.keys(t.profiles)
        .filter((k) => k !== "generic")
        .map((k) => t.profiles[k]),
      ...CASE_STUDIES.map((c) => localizeCaseStudy(c, locale).category),
    ]),
  );
  // The charts: the rounds with their minute-by-minute series where one was extracted, and the Scout bench.
  type Extra = {
    minutes?: number | null;
    cost?: number | null;
    found?: number | null;
    scored?: number | null;
    ceiling?: number | null;
    timeline?: ChartRound["timeline"];
    scores?: ChartRound["scores"];
    brake?: ChartRound["brake"];
    agents?: Record<string, number> | null;
    relevance?: BenchProfile["relevance"];
    discarded?: Record<string, number> | null;
    bySource?: Record<string, number> | null;
  };
  const cc = CHART_COPY[locale];
  const roundSeries = ((data as { roundSeries?: Record<string, Extra> }).roundSeries ?? {}) as Record<string, Extra>;
  const benchRaw = ((data as { bench?: (Extra & { id: string; profile: string; os: string; service: string; buildNo: number })[] }).bench ?? []);
  const chartRounds: ChartRound[] = [
    ...data.rounds.map((r) => {
      const x = roundSeries[r.id] ?? {};
      return {
        id: r.id,
        label: `${OS_LABEL[r.os]} · ${t.profiles[r.profile]} · ${dayLabel(r)}`,
        group: "round" as const,
        os: r.os,
        service: r.service,
        buildNo: buildNo(r) ?? null,
        minutes: r.minutes,
        cost: r.cost,
        found: r.found,
        scored: r.scored,
        relevant: r.relevant,
        bestScore: r.bestScore,
        ceiling: x.ceiling ?? null,
        brake: x.brake ?? [],
        timeline: x.timeline ?? [],
        scores: x.scores ?? [],
        agents: x.agents ?? null,
      };
    }),
    ...benchRaw.map((b) => ({
      id: b.id,
      label: `${OS_LABEL[b.os]} · ${cc.benchProfiles[b.profile] ?? b.profile}${b.id.endsWith("bricklayer") ? ` (${cc.second})` : ""}`,
      group: "bench" as const,
      os: b.os,
      service: b.service,
      buildNo: b.buildNo,
      minutes: b.minutes ?? null,
      cost: b.cost ?? null,
      found: b.found ?? null,
      scored: b.scored ?? null,
      relevant: b.relevance?.P ?? null,
      bestScore: null,
      ceiling: b.ceiling ?? null,
      brake: b.brake ?? [],
      timeline: b.timeline ?? [],
      scores: b.scores ?? [],
      agents: b.agents ?? null,
    })),
  ];
  const chartBench: BenchProfile[] = benchRaw.map((b) => ({
    id: b.id,
    label: `${cc.benchProfiles[b.profile] ?? b.profile}${b.id.endsWith("bricklayer") ? ` (${cc.second})` : ""}`,
    relevance: b.relevance ?? null,
    discarded: b.discarded ?? null,
    bySource: b.bySource
      ? Object.fromEntries(Object.entries(b.bySource).map(([k, v]) => [cc.sources[k] ?? k, v]))
      : null,
  }));
  type BetaRaw = {
    day: string;
    hours: { h: number; positions: number | null; atLeast70: number | null }[];
    codex: { t: number; usedPct: number }[];
    experiments: { t: number; kind: string }[];
  };
  const betaRaw = (data as { betaDay?: BetaRaw }).betaDay;
  const chartBeta: BetaDay = betaRaw
    ? { ...betaRaw, experiments: betaRaw.experiments.map((e) => ({ t: e.t, label: cc.experimentKinds[e.kind] ?? e.kind })) }
    : null;
  const buildNos = Array.from(new Set([5, 6, 7, 8, 9, 10, ...data.builds.map((b: Build) => b.n)])).sort((a, b) => a - b);
  const chartBuilds: BuildPoint[] = buildNos.map((n) => {
    const snap = data.builds.find((b: Build) => b.n === n) as (Build & { targetsSnapshot?: Record<string, number>; defects?: { found: number; closed: number } }) | undefined;
    const counted: Record<string, number> = {};
    for (const x of data.targets as Target[]) if (x.build === n) counted[x.status] = (counted[x.status] ?? 0) + 1;
    return {
      n,
      targets: snap?.targetsSnapshot ?? (Object.keys(counted).length ? counted : null),
      defects: snap?.defects ?? ((data as { defects?: Record<string, { found: number | null; closed: number | null }> }).defects?.[String(n)] ?? null),
      fromCurrent: !snap?.targetsSnapshot,
    };
  });

  const serviceOptions = ["glm", "kimi", "openai", "claude"].map((v) => ({
    value: v,
    label: t.services[v],
  }));
  const osOptions = ["macos", "windows", "linux"].map((v) => ({
    value: v,
    label: OS_LABEL[v],
  }));

  return (
    <main className="min-h-screen bg-[var(--color-panel)] text-[var(--color-white)]">
      <LandingI18nProvider>
        <LandingNav />
      </LandingI18nProvider>
      <div aria-hidden="true" className="h-14" />

      <div className="mx-auto max-w-6xl px-4 py-8 space-y-10">
        <Link
          href="/case-studies"
          className="text-[12px] text-[var(--color-muted)] hover:underline"
        >
          {t.back}
        </Link>

        <header className="space-y-3">
          <h1 className="text-[28px] font-extrabold leading-tight">
            {t.title}
          </h1>
          <p className="text-[13px] text-[var(--color-muted)] max-w-3xl">
            {t.lead}
          </p>
          <div
            className="border-l-4 px-4 py-3 text-[13px] bg-[var(--color-card)] max-w-3xl"
            style={{ borderColor: "#F59E0B" }}
          >
            {t.banner}
          </div>
        </header>

        <section className="space-y-3" id="targets">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="section-label">{t.targetsTitle}</h2>
            <span
              className="text-[12px] font-semibold tabular-nums"
              style={{
                color:
                  green === data.targets.length
                    ? TARGET_COLOR.pass
                    : TARGET_COLOR.fail,
              }}
            >
              {t.targetsCount
                .replace("{g}", String(green))
                .replace("{n}", String(data.targets.length))}
            </span>
          </div>
          <p className="text-[12px] text-[var(--color-muted)] max-w-3xl">
            {t.targetsLead}
          </p>
          <div className="overflow-x-auto border border-[var(--color-border)] bg-[var(--color-card)]">
            <table className="w-full min-w-[620px] text-[12px] border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  <th className="px-3 py-2 font-semibold">{t.targetsCols.target}</th>
                  {TARGET_OS.map((os) => (
                    <th key={os} className="px-3 py-2 font-semibold w-[22%] border-l border-[var(--color-border)]">
                      <span className="inline-flex items-center gap-1.5 normal-case text-[12px] text-[var(--color-white)]">
                        <Mark id={os} label={OS_LABEL[os]} />
                        {OS_LABEL[os]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              {TARGET_SECTIONS.map(([section, emoji]) => {
                const list = (data.targets as Target[]).filter((x) => x.section === section);
                if (list.length === 0) return null;
                const ok = list.filter((x) => x.status === "pass").length;
                const rows: { key: string; label: string; byOs: Record<string, Target> | null; one: Target | null }[] = [];
                for (const x of list) {
                  const row = (x as { row?: string }).row;
                  const os = (x as { os?: string }).os;
                  if (row && os) {
                    const r = rows.find((y) => y.key === row);
                    if (r?.byOs) r.byOs[os] = x;
                    else rows.push({ key: row, label: t.targetRows[row], byOs: { [os]: x }, one: null });
                  } else rows.push({ key: x.id, label: t.targets[x.id], byOs: null, one: x });
                }
                return (
                  <tbody key={section}>
                    <tr className="border-t-2 border-[var(--color-border-glow)] bg-[var(--color-row)]">
                      <th colSpan={4} scope="colgroup" className="px-3 py-2 text-left">
                        <span className="inline-flex items-center gap-2 text-[13px] font-bold">
                          <span aria-hidden="true">{emoji}</span>
                          {t.targetSections[section]}
                          <span
                            className="text-[11px] font-semibold tabular-nums rounded-full px-2 py-0.5"
                            style={{
                              color: ok === list.length ? TARGET_COLOR.pass : TARGET_COLOR.fail,
                              background: `color-mix(in srgb, ${ok === list.length ? TARGET_COLOR.pass : TARGET_COLOR.fail} 14%, transparent)`,
                            }}
                          >
                            {`${ok}/${list.length}`}
                          </span>
                        </span>
                      </th>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-[var(--color-border)] align-top">
                        <th scope="row" className="px-3 py-2 text-left font-normal min-w-[180px]">
                          {r.label}
                        </th>
                        {r.byOs ? (
                          TARGET_OS.map((os) => (
                            <td key={os} className="px-3 py-2 border-l border-[var(--color-border)]">
                              {r.byOs![os] ? targetCell(r.byOs![os]) : <span className="text-[var(--color-dim)]">{t.none}</span>}
                            </td>
                          ))
                        ) : (
                          <td colSpan={3} className="px-3 py-2 border-l border-[var(--color-border)]">
                            {targetCell(r.one!)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
          <div className="space-y-1 text-[12px]">
            <h3 className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              {t.buildsTitle}
            </h3>
            <ul className="space-y-1">
              {data.builds.map((b: Build) => (
                <li key={b.n} className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="font-semibold tabular-nums">
                    {t.buildLabel.replace("{n}", String(b.n))}
                    {b.commit ? (
                      <span className="text-[var(--color-dim)] font-normal">
                        {" "}
                        · {b.commit}
                        {b.day ? ` · ${b.day}` : ""}
                      </span>
                    ) : null}
                  </span>
                  {b.rounds.length ? (
                    b.rounds.map((id: string) => roundLink(id))
                  ) : (
                    <span className="text-[var(--color-muted)]">
                      {t.noRound}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Suspense fallback={null}>
          <BenchmarkFinder
            copy={t.finder}
            candidates={[...roundViews, ...caseViews]}
            trades={tradeSuggestions}
            osOptions={osOptions}
            serviceOptions={serviceOptions}
            locale={locale}
          />
        </Suspense>

        <section className="space-y-3">
          <h2 className="section-label">{t.roundsTitle}</h2>
          <div className="overflow-x-auto border border-[var(--color-border)] bg-[var(--color-card)]">
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {[
                    t.cols.round,
                    t.cols.profile,
                    t.cols.minutes,
                    t.cols.spent,
                    t.cols.found,
                    t.cols.perScored,
                    t.cols.outcome,
                    t.cols.note,
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 font-semibold whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rounds.map((r) => (
                  <tr
                    key={r.id}
                    id={r.id}
                    className="border-t border-[var(--color-border)] align-top scroll-mt-20"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Mark id={r.os} label={OS_LABEL[r.os]} />
                        <Mark id={r.service} label={t.services[r.service]} />
                        <span>
                          <span className="font-semibold">
                            {t.services[r.service]}
                          </span>
                          <br />
                          <span className="text-[var(--color-muted)]">
                            {OS_LABEL[r.os]} · {dayLabel(r)}
                            {buildNo(r)
                              ? ` · ${t.buildLabel.replace("{n}", String(buildNo(r)))}`
                              : ""}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {t.profiles[r.profile]}
                      {t.modes[r.mode] ? (
                        <span className="text-[var(--color-muted)]">
                          {" "}
                          · {t.modes[r.mode]}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.minutes == null ? "—" : r.minutes}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {money(r.cost)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {found(r)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {money(perScored(r))}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap"
                        style={{
                          color: OUTCOME_COLOR[r.outcome],
                          background: `color-mix(in srgb, ${OUTCOME_COLOR[r.outcome]} 16%, transparent)`,
                        }}
                      >
                        {t.outcome[r.outcome]}
                      </span>
                    </td>
                    <td className="px-3 py-2 min-w-[240px] text-[var(--color-muted)]">
                      {t.notes[r.note]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--color-dim)]">{t.colsHint}</p>
        </section>

        <BenchmarkCharts
          locale={locale}
          rounds={chartRounds}
          bench={chartBench}
          builds={chartBuilds}
          beta={chartBeta}
          labels={{ services: t.services, os: OS_LABEL, targetStatus: t.targetStatus }}
        />

        <section className="space-y-3">
          <h2 className="section-label">{t.chartTitle}</h2>
          <p className="text-[12px] text-[var(--color-muted)] max-w-3xl">
            {t.chartLead}
          </p>
          <div
            className="bg-[var(--color-card)] border border-[var(--color-border)] p-5 space-y-3"
            role="img"
            aria-label={t.chartTitle}
          >
            {chartRows.map((r) => {
              const v = perScored(r);
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-[minmax(150px,230px)_1fr_90px] items-center gap-3 text-[12px]"
                >
                  <span className="inline-flex items-center gap-2 truncate">
                    <Mark id={r.service} label={t.services[r.service]} />
                    <span className="truncate">
                      {OS_LABEL[r.os]} · {t.profiles[r.profile]}
                    </span>
                  </span>
                  <span className="h-3.5 border-l border-[var(--color-border)]">
                    {v != null && (
                      <span
                        className="block h-full"
                        style={{
                          width: `${(v / maxChart) * 100}%`,
                          background: "#0EA5A4",
                        }}
                      />
                    )}
                  </span>
                  <span className="text-right tabular-nums font-semibold">
                    {v == null ? t.chartNone : money(v)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--color-dim)] max-w-3xl">
            {t.chartCaveat}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="section-label">{t.servicesTitle}</h2>
          <div className="overflow-x-auto border border-[var(--color-border)] bg-[var(--color-card)]">
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {Object.values(t.servicesCols).map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 font-semibold whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.services.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-[var(--color-border)] align-top"
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <Mark id={s.id} label={t.services[s.id]} />
                        {t.services[s.id]}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {nf.format(s.kitEstimate30min[0])} –{" "}
                      {nf.format(s.kitEstimate30min[1])} $
                    </td>
                    <td className="px-3 py-2">
                      {s.seen.length === 0
                        ? "—"
                        : s.seen
                            .map(
                              (x) =>
                                `${nf.format(x.cost)} $ / ${x.minutes} min`,
                            )
                            .join(" · ")}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {s.ratePerMinute
                        ? s.ratePerMinute[0] === s.ratePerMinute[1]
                          ? `${nf.format(s.ratePerMinute[0])} $/min`
                          : `${nf.format(s.ratePerMinute[0])} – ${nf.format(s.ratePerMinute[1])} $/min`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--color-dim)] max-w-3xl">
            {t.servicesCaveat}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="section-label">{t.osTitle}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {(["linux", "windows", "macos"] as const).map((os) => (
              <div
                key={os}
                className="border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Mark id={os} label={OS_LABEL[os]} />
                  <span className="text-[14px] font-bold">{OS_LABEL[os]}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                    {t.system[data.systems[os]]}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--color-muted)]">
                  {t.osNotes[os]}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="section-label">{t.limitsTitle}</h2>
          <div
            className="border-l-4 bg-[var(--color-card)] px-4 py-3 space-y-2 max-w-3xl"
            style={{ borderColor: "#F59E0B" }}
          >
            <p className="text-[13px]">{t.limitsLead}</p>
            <ul className="list-disc pl-5 text-[12px] text-[var(--color-muted)] space-y-1">
              {t.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="text-[13px] pt-2">
              <strong>{t.needTitle}.</strong> {t.need}
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-[11px] text-[var(--color-muted)]">
        {t.footer}
        <p className="mt-1 text-[10px] text-[var(--color-dim)]">{t.tuxCredit}</p>
      </footer>
    </main>
  );
}
