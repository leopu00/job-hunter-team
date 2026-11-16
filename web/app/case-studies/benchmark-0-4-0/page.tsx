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
  outcome: Record<string, string>;
  system: Record<string, string>;
  profiles: Record<string, string>;
  modes: Record<string, string>;
  services: Record<string, string>;
  notes: Record<string, string>;
  osNotes: Record<string, string>;
  night: string;
  day: string;
  finder: FinderCopy;
};

const T: Record<Locale, Copy> = {
  en: {
    metaTitle: "0.4.0 benchmark · Job Hunter Team",
    title: "0.4.0 benchmark: four services, three systems",
    lead: "What the team spent and found in the test rounds of 14-16 November 2026, with the API-key services the 0.4.0 harness offers. Numbers come from the test reports and the cost samplers.",
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
    footer:
      "Synthetic profiles, no personal data · numbers from the test reports of 14-16/11/2026.",
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
    lead: "Quanto ha speso e trovato la squadra nei giri di prova del 14-16 novembre 2026, con i servizi a chiave API che l'harness 0.4.0 offre. I numeri vengono dai verbali dei collaudi e dai campionatori dei costi.",
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
    footer:
      "Profili finti, nessun dato personale · numeri dai verbali dei collaudi del 14-16/11/2026.",
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
    lead: "Was das Team in den Testläufen vom 14. bis 16. November 2026 ausgegeben und gefunden hat, mit den API-Schlüssel-Diensten des 0.4.0-Harness. Die Zahlen stammen aus den Testprotokollen und den Kostenmessungen.",
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
    footer:
      "Synthetische Profile, keine personenbezogenen Daten · Zahlen aus den Testprotokollen vom 14.-16.11.2026.",
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
    lead: "Lo que el equipo gastó y encontró en las rondas de prueba del 14 al 16 de noviembre de 2026, con los servicios de clave API que ofrece el harness 0.4.0. Las cifras salen de los informes de las pruebas y de los muestreadores de coste.",
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
    footer:
      "Perfiles ficticios, sin datos personales · cifras de los informes de prueba del 14-16/11/2026.",
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
    lead: "Ce que l'équipe a dépensé et trouvé lors des tours d'essai du 14 au 16 novembre 2026, avec les services à clé API que propose le harness 0.4.0. Les chiffres viennent des procès-verbaux d'essai et des échantillonneurs de coûts.",
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
    footer:
      "Profils fictifs, aucune donnée personnelle · chiffres des procès-verbaux d'essai du 14-16/11/2026.",
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
    lead: "O que a equipa gastou e encontrou nas rondas de teste de 14 a 16 de novembro de 2026, com os serviços de chave API que o harness 0.4.0 oferece. Os números vêm dos relatórios dos testes e dos amostradores de custo.",
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
    footer:
      "Perfis fictícios, sem dados pessoais · números dos relatórios de teste de 14-16/11/2026.",
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
    lead: "Amit a csapat 2026. november 14–16. próbafutásaiban elköltött és megtalált, a 0.4.0 harness API-kulcsos szolgáltatásaival. A számok a próbák jegyzőkönyveiből és a költségmintavevőkből származnak.",
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
    footer:
      "Kitalált profilok, személyes adat nélkül · számok a 2026.11.14–16-i próbák jegyzőkönyveiből.",
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
  // generic icons (Lucide, ISC), not the marks of Apple, Microsoft or Linux: the name of the system is always written next to them
  linux: ["terminal"],
  windows: ["app-window"],
  macos: ["laptop"],
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
                    className="border-t border-[var(--color-border)] align-top"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Logo name={ICON[r.os][0]} label={OS_LABEL[r.os]} />
                        <Mark id={r.service} label={t.services[r.service]} />
                        <span>
                          <span className="font-semibold">
                            {t.services[r.service]}
                          </span>
                          <br />
                          <span className="text-[var(--color-muted)]">
                            {OS_LABEL[r.os]} · {dayLabel(r)}
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
                  <Logo name={ICON[os][0]} label={OS_LABEL[os]} size={22} />
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
      </footer>
    </main>
  );
}
