// What the benchmark page and the page of each round share: the words in the seven languages, the marks of the systems
// and the services, the colours of the states. Static data in web/data/benchmark/benchmark-0-4-0.json (synthetic profiles only).

import { OsIcon } from "../../components/OsIcons";
import type { Locale } from "@/i18n/config";
import data from "@/data/benchmark/benchmark-0-4-0.json";
import type { FinderCopy } from "./BenchmarkFinder";
import type { Sector } from "@/lib/benchmark-match";
import ProviderMark, { PROVIDER_IDS } from "./providerMarks";

export type Round = (typeof data.rounds)[number];
export type Copy = {
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
  marks: string;
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
  invalidTitle: string;
  invalidLead: string;
  invalidReasons: Record<string, string>;
  targetTried: string;
  targetCriteria: Record<string, string>;
  targetRules: Record<string, string>;
  buildsTitle: string;
  buildLabel: string;
  previousBuild: string;
  paceNote: string;
  noRound: string;
  none: string;
  finder: FinderCopy;
};

export const T: Record<Locale, Copy> = {
  en: {
    metaTitle: "0.4.0 benchmark · Job Hunter Team",
    title: "0.4.0 benchmark: four services, three systems",
    lead: "What the team spent and found in the test rounds of 14-21 November 2026, with the API-key services the 0.4.0 harness offers. Numbers come from the test reports and the cost samplers.",
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
      "«Relevant» = positions whose title matches the trade, checked on a sample; a dash = not judged. «Earlier build» = a round before the numbered builds of the 0.4.0: it does not prove the 0.4.0.",
    chartTitle: "What a scored position costs",
    chartLead:
      "Dollars spent for each position the team scored. Shorter is better. Rounds with no scored position have no bar.",
    chartNone: "none scored",
    chartCaveat:
      "The two Mac rounds were 6 and 10 minutes with a minimal team, and the cost is mostly onboarding and the Captain: not comparable with rounds of 16-42 minutes.",
    servicesTitle: "Services: what we saw in the rounds",
    servicesCols: {
      service: "Service",
      seen: "Seen in the rounds",
      rate: "Pace seen",
    },
    servicesCaveat:
      "Only what the rounds measured; a dash means never tried. These numbers come from rounds on builds before the numbered ones of the 0.4.0 (r1–r8): they say what a service costs, not how the 0.4.0 behaves. Claude on Windows spent 5.28 $: the Captain and the Scorer weigh 3.05 $ of it.",
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
      "Synthetic profiles, no personal data · numbers from the test reports of 14-21/11/2026.",
    marks:
      "The logos only name the service a test used and imply no endorsement. Trademarks and logos belong to their owners.",
    outcome: {
      pass: "pass",
      reservations: "with reservations",
      fail: "fail",
      unjudged: "not judged",
      running: "running",
    },
    system: {
      pass: "passes",
      withReservations: "passes with reservations",
      running: "in progress",
    },
    profiles: {
      bricklayer: "Bricklayer",
      warehouseWorker: "Warehouse worker",
      officeClerk: "Office clerk, part time",
      dataAnalyst: "Data analyst",
      generic: "Generic test profile",
      restorer: "Restorer",
      waiter: "Waiter",
      receptionist: "Receptionist",
      truckDriver: "Truck driver",
      electrician: "Electrician",
      shopAssistant: "Shop assistant",
      careAssistant: "Care assistant",
    },
    modes: { onsite: "on site", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI (credit ended), then GLM",
    },
    notes: {
      updateBuild10Portuguese:
        "Update on build 10, all in Portuguese: the saved key kept, the queue restarted by itself, 1 new position (74); the pace brake paused the team and told the person.",
      updateWindowsBuild9to10:
        "Build 9 installed from scratch, all in German: 25 warehouse positions in a quarter of an hour; updated to build 10 with positions, profile and key kept, then the Analyst never started and 13 positions stayed waiting.",
      updateSwitchKept:
        "Update with the team running: data kept, old images removed, GLM → Claude without stopping the team. 3 relevant of 26 new in 10 minutes.",
      updateWelcomePaid:
        "Update and switch to Claude: 15 relevant of 18 in 12 minutes. The welcome was paid again at every restart.",
      cleanInstallWarehouse:
        "New user, guided onboarding: the brake stopped at 2.67 $. Mostly warehouse jobs: 2 relevant of 19.",
      updateNoNewPositions:
        "Update fine and no key file left on disk, but 0 new positions in 30 minutes: only 2 Scouts woken.",
      diskLowAfterUpdate:
        "Update fine, team never started: 4 GiB free of the 8 needed, with no warning before the download.",
      cleanInstallGerman:
        "New user in German: 10 relevant of 26. The brake stopped at 4.77 $, then a false unlock (4.95 $ at the end); Doctor and Maintainer did no turn.",
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
      updateWindowsBuild11:
        "Update from build 10 to 11, all in German: team and data kept, the Analyst starts again by itself; 5 relevant of 7 new.",
      installLinuxBuild11:
        "Install from scratch and guided onboarding all in Italian, the key kept: 14 relevant of 18. The memory guard retires the Scouts without telling the person, and they do not come back.",
      updateMacBuild11:
        "Update from build 10 to 11 in Portuguese: positions, scores and key kept, disk space back; the budget of the period is spent before the 6 new positions are scored.",
      updateLinuxBuild12b:
        "Update to the first version of build 12: team and data kept; the Doctor is started during the pace pause, and the resume after it spends the margin in seconds.",
      updateMacBuild12b:
        "Update to the first version of build 12: 6 relevant of 11 new, best score 89; the setup says the configuration failed while the team starts by itself.",
      updateWindowsBuild12c:
        "Update to build 12 with the Assistant chat open, all in French: it stops halfway and the jht command does not work until the installer is run again.",
      updateLinuxBuild12d:
        "Update to the last version of build 12: team and data kept; the resume after the pace pause works 275 seconds instead of about 80, and the service roles are not woken.",
      updateMacBuild12d:
        "Update to the last version of build 12: team and data kept, the false notice of a failed setup is gone; 12 new positions, not scored yet in the window.",
      updateLinuxBuild13:
        "Update to build 13: team and data kept; the enrichments run on every checked position but add no coordinates and no logos; 0.0085 $ per analysed position.",
      updateWindowsBuild13:
        "Retest of the update with the chat open: it ends and the jht command works; the chat itself still closes with a raw line.",
      candidateLinux:
        "Update to the release candidate, team and data kept: the first spending ceiling holds, the second is passed by 13% after a resume; 20 relevant of 33 new (61%, 70% needed).",
      retestBrake:
        "Brake retest on a test image built on the candidate: the ceiling holds both times (0.36 of 1 $ and 1.92 of 3 $); after the unlock of a new budget the pace lets 0.86 $ pass over its line.",
      retestPace:
        "Retest of the staged wake-up after the pace pause: the stages work and the period never passes its line or ceiling (2.55 of 3 $); two other channels still wake the workers that wait.",
      retestFull:
        "Full retest: line and ceiling never passed (2.55 of 3 $), but the workers waiting for their stage still work and the first pause comes 48 seconds after the unlock; 1 relevant of 15, all from one agency portal.",
      retestReserve:
        "Full retest, closed early: the stages work, but the estimated reserve of the restart stops the team 10 to 20 seconds after every stage; no new position.",
      retestResumes:
        "Retest, closed early: the unlock now works ten minutes before the first pause, but both resumes stop within the first minute, and after the update the Captain wakes all seven workers outside the stages.",
      retestDayQuota:
        "Retest of the budget split by day, over two days (41 h) with the pace off: the team works up to its share of the day, stops with one notice and resumes by itself the next day (1.38 of 2 $, never over a share). 4 minor defects; 4 relevant of 5 new.",
      candidateWindowsSpanish:
        "Release candidate on a new Windows user, everything in Spanish: 4 relevant of 10 in 5 minutes (5 more of the right trade, but part time or seasonal); the pace brake stops at 1.01 of 1.5 $. Open: empty help from the host, the Scout stopped after its first pass.",
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
    targetsLead:
      "0.4.0 is released only when every row is green. Updated at every build; the proof links to the round below.",
    targetsCount: "{g} of {n} green",
    targetsCols: {
      target: "Target",
      status: "Status",
      build: "Build",
      proof: "Proof",
    },
    targetStatus: {
      pass: "met",
      fail: "not met",
      pending: "to try",
      blocked: "blocked",
    },
    targets: {
      scoutBenchCook: "Cook",
      scoutBenchWarehouse: "Warehouse worker",
      scoutBenchNurse: "Nurse",
      scoutBenchBricklayer: "Bricklayer",
      languageWindows: "Setup and onboarding in the chosen language · Windows",
      languageLinux: "Setup and onboarding in the chosen language · Linux",
      languageMac: "Setup and onboarding in the chosen language · Mac",
      preTagReview: "Security review before the tag",
      installWindows: "Install by a new user · Windows",
      installLinux: "Install by a new user · Linux",
      installMac: "Install by a new user · Mac",
      updateLinux: "Update with a team and data already there · Linux",
      updateMac: "Update with a team and data already there · Mac",
      updateWindows: "Update with a team and data already there · Windows",
      nonItRelevant: "Positions of the person's trade (at least 70%)",
      scoutBench:
        "Scout bench, 4 trades outside IT (≥70% relevant, 0 duplicates, ≥15 positions)",
      budgetBrake:
        "Budget brake: never over the ceiling, no false unlock, the person is told",
      language: "Setup and onboarding in the chosen language",
      doctorMaintainer:
        "The Doctor and the Maintainer, the agents that look after the team, really work",
      serviceClaude: "Claude (Anthropic) · API key",
      serviceOpenai: "OpenAI · API key",
      serviceGlm: "Z.ai (GLM) · API key",
      serviceKimi: "Kimi (Moonshot) · API key",
      codexSubscription:
        "OpenAI Codex · subscription (only for those who already have 0.3.x, as in our beta test)",
      openaiSubscription: "OpenAI · ChatGPT subscription on Pi",
      noKeyOnDisk: "No API key is left written on the disk",
      betaTester: "Beta test: version updated and team at work",
    },
    targetNotes: {
      updateMacBuild10:
        "build 10: setup all in Portuguese, the saved key kept, 1 new position (score 74)",
      updateWindowsBuild10:
        "build 10: positions, profile and key kept, all in German; after the update the Analyst never started (13 positions waiting)",
      languagePortugueseOk: "build 10: Portuguese all the way on the Mac",
      notTried040:
        "not tried on the 0.4.0",
      updateLinuxBuild9:
        "build 9: passed (its round is not in the table below)",
      installerBlockedBuild9:
        "build 9: stopped by the installer (fix in build 10, round under way)",
      benchCook: "79% relevant",
      benchWarehouse: "90% relevant",
      benchNurse: "1 duplicate (94% relevant)",
      benchBricklayer: "6 positions, fewer than 15 (83% relevant)",
      brakeFixedRetry: "fixed in builds 9 and 10: to try again",
      languageGermanOk: "build 9: German all the way on Linux",
      securityPreTag:
        "review before the tag: the verdict comes on the exact version of the tag; the key-on-disk case is closed",
      cleanLinuxRoundMissing:
        "clean install on build 6: its round is not in the table below",
      openaiBuild6Redo:
        "tried on build 6 only (1.61 $, 10 minutes): to redo on the 0.4.0",
      redoOnBuild9: "to redo on build 9",
      diskFull: "disk full after the update (fix in progress)",
      neverTried: "never tried",
      relevantBelow: "0 new for the bricklayer, 10 of 26 for the receptionist",
      benchPaused: "paused until build 9",
      brakeFalseClear:
        "false unlock after the stop, the warning to the person failed",
      languageEnglish:
        "API key step, team start and status in English (fixed after build 8)",
      zeroTurns: "0 turns (fixed in build 9)",
      noCredit: "no credit to try them",
      loginNeverTried: "real sign-in never tried",
      keysChecked:
        "0 files with a key outside their place, on 20,927 file events",
      updateOnBuild9: "update on build 9",
      updateMacBuild11:
        "build 11: positions, scores and key kept, disk space back, all in Portuguese",
      updateWindowsBuild13:
        "build 13: the update with the chat open ends and the jht command works, all in French",
      relevantBuild15:
        "build 15: 4 relevant of 10 for the shop assistant profile on a new Windows user (40%; 5 more are part time or seasonal); 4 of 5 for the electrician on the retest; 20 of 33 (61%) on the first candidate. To be proven again on a new install",
      brakeDayQuota:
        "build 15: the day quota and the pace stop the team before every budget (1.38 of 2 $ over two days; 1.04 of 1.5 $ on Windows); minor defects left in the notices and the status",
      languageFrenchGermanOk:
        "builds 11-13: German and French all through the flow; a few lines still in English (help of the command)",
      languageItalianOk:
        "build 11: install and onboarding all in Italian on Linux",
      doctorWorks:
        "builds 11-12: Doctor and Maintainer do their turns with no error and unlock the right agents",
    },
    invalidTitle: "Rounds that do not count",
    invalidLead:
      "Rounds broken by causes of ours (credit run out, a test machine that switched itself off, a measurement mistake, cancelled bench attempts), not by defects of the product. They are left out of the table and of the charts; the defects they found stay in the chart of the defects.",
    invalidReasons: {
      noCreditMachineOff:
        "OpenAI had no credit and the test machine switched itself off: no Scout started. The service was changed to GLM halfway through the round.",
      cumulativeCap:
        "Our test ceiling of 3 $ was too low and was read on a counter that also held the round before: stopped after 6 minutes, before any new position.",
      benchDailyBudget:
        "Cancelled bench attempt: it started with a high daily budget left from before, and the pace brake stopped it after 70 seconds.",
      benchOpenRun:
        "Cancelled bench attempt: the first search of the previous build was still open.",
      creditEndedNoPositions:
        "The GLM credit of the test account ran out before any position: 0 positions.",
      benchCancelled: "Cancelled bench attempt, started again from zero.",
    },
    targetSections: {
      install: "Install by a new user",
      update: "Update with a team and data",
      scout: "Scout bench: does the Scout find ads of the right trade?",
      brake: "Criteria of the last tries (build 15).",
      language: "Language",
      doctor: "Doctor and Maintainer",
      services: "Services",
      security: "Security",
      beta: "Beta test",
      realUser: "Full round as a real user, with a trade outside IT",
    },
    targetCriteria: {
      relevant: "relevant {v}% (≥{min}%)",
      duplicates: "duplicates {v}",
      positions: "positions {v} (≥{min})",
      newPositions: "{trade}: {v} new",
      relevantOf: "{trade}: {v} relevant of {of}",
      underCeiling: "spent {v} of {max} $",
      noFalseUnlock: "no false unlock",
    },
    targetRules: {
      scout:
        "Only the search of the Scouts, on a server already set up, with four trades outside IT. A trade passes when all 3 criteria are green: at least 70% relevant, 0 duplicates, at least 15 positions.",
      brake: "Criteria of the last try (build 8); fixed since, to try again.",
      realUser:
        "A person installs the program from zero, answers the setup and lets the team work alone for 30 minutes. It passes when at least 70% of the positions found are of the person's trade.",
    },
    targetTried: "tried on build {n}",
    targetRows: {
      install: "First install on a computer without the program",
      update: "Update of a computer that already has a team and its data",
      language: "Setup and onboarding in the chosen language",
    },
    buildsTitle: "Rounds of each build",
    buildLabel: "Build {n}",
    previousBuild: "earlier build",
    paceNote:
      "The rounds run the team for minutes or hours, not for the days a budget is meant to last: the cost is squeezed into a short time and does not say how long a budget lasts in everyday use. Only round r33 covers two days, with the pace off and the budget split by day.",
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
    lead: "Quanto ha speso e trovato la squadra nei giri di prova del 14-21 novembre 2026, con i servizi a chiave API che l'harness 0.4.0 offre. I numeri vengono dai verbali dei collaudi e dai campionatori dei costi.",
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
      "«Pertinenti» = posizioni il cui titolo corrisponde al mestiere, controllate a campione; un trattino = non giudicato. «Build precedente» = giro anteriore alle build numerate della 0.4.0: non prova la 0.4.0.",
    chartTitle: "Quanto costa una posizione valutata",
    chartLead:
      "Dollari spesi per ogni posizione valutata dalla squadra. Più corta è la barra, meglio è. I giri senza posizioni valutate non hanno barra.",
    chartNone: "nessuna valutata",
    chartCaveat:
      "I due giri del Mac sono durati 6 e 10 minuti con una squadra minima, e il costo è quasi tutto onboarding e Capitano: non sono confrontabili con giri di 16-42 minuti.",
    servicesTitle: "Servizi: quello che abbiamo visto nei giri",
    servicesCols: {
      service: "Servizio",
      seen: "Visto nei giri",
      rate: "Ritmo visto",
    },
    servicesCaveat:
      "Solo ciò che i giri hanno misurato; un trattino = mai provato. Questi numeri vengono da giri su build precedenti a quelle numerate della 0.4.0 (r1–r8): dicono quanto costa un servizio, non come si comporta la 0.4.0. Claude su Windows ha speso 5,28 $: Capitano e Scorer ne pesano 3,05 $.",
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
      "Profili finti, nessun dato personale · numeri dai verbali dei collaudi del 14-21/11/2026.",
    marks:
      "I loghi indicano solo il servizio usato da una prova e non implicano alcuna approvazione. Marchi e loghi appartengono ai rispettivi proprietari.",
    outcome: {
      pass: "passa",
      reservations: "con riserva",
      fail: "non passa",
      unjudged: "non giudicato",
      running: "in corso",
    },
    system: {
      pass: "passa",
      withReservations: "passa con riserva",
      running: "in corso",
    },
    profiles: {
      bricklayer: "Muratore",
      warehouseWorker: "Magazziniere",
      officeClerk: "Impiegata amministrativa part time",
      dataAnalyst: "Data analyst",
      generic: "Profilo di prova generico",
      restorer: "Restauratrice",
      waiter: "Cameriere",
      receptionist: "Receptionist",
      truckDriver: "Autista C+E",
      electrician: "Elettricista",
      shopAssistant: "Commesso/a",
      careAssistant: "Operatrice socio-sanitaria",
    },
    modes: { onsite: "in sede", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI (credito finito), poi GLM",
    },
    notes: {
      updateBuild10Portuguese:
        "Aggiornamento sulla build 10, tutto in portoghese: chiave salvata tenuta, la coda ripartita da sola, 1 annuncio nuovo (74); il freno a ritmo ha messo in pausa la squadra e l'ha detto alla persona.",
      updateWindowsBuild9to10:
        "Build 9 installata da zero, tutto in tedesco: 25 annunci di magazzino in un quarto d'ora; aggiornata alla build 10 con annunci, profilo e chiave tenuti, poi l'Analista non è mai partito e 13 annunci sono rimasti in attesa.",
      updateSwitchKept:
        "Aggiornamento a squadra accesa: dati tenuti, immagini vecchie tolte, GLM → Claude senza fermare la squadra. 3 pertinenti su 26 nuove in 10 minuti.",
      updateWelcomePaid:
        "Aggiornamento e passaggio a Claude: 15 pertinenti su 18 in 12 minuti. Il benvenuto è stato pagato di nuovo a ogni ripartenza.",
      cleanInstallWarehouse:
        "Utente nuovo, onboarding guidato: il freno ha fermato a 2,67 $. Quasi solo magazzino: 2 pertinenti su 19.",
      updateNoNewPositions:
        "Aggiornamento riuscito e nessun file con chiave su disco, ma 0 posizioni nuove in 30 minuti: svegliati solo 2 Scout.",
      diskLowAfterUpdate:
        "Aggiornamento riuscito, squadra mai partita: 4 GiB liberi degli 8 necessari, senza avviso prima dello scaricamento.",
      cleanInstallGerman:
        "Utente nuovo in tedesco: 10 pertinenti su 26. Il freno ha fermato a 4,77 $, poi uno sblocco falso (4,95 $ alla fine); Dottore e Mantenitore senza turni.",
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
      updateWindowsBuild11:
        "Aggiornamento dalla build 10 alla 11, tutto in tedesco: squadra e dati tenuti, l'Analista riparte da solo; 5 pertinenti su 7 nuove.",
      installLinuxBuild11:
        "Installazione da zero e onboarding guidato tutto in italiano, chiave tenuta: 14 pertinenti su 18. La guardia della memoria ritira gli Scout senza dirlo alla persona, e non tornano.",
      updateMacBuild11:
        "Aggiornamento dalla build 10 alla 11 in portoghese: annunci, punteggi e chiave tenuti, spazio su disco tornato; il budget del periodo finisce prima che le 6 nuove abbiano un punteggio.",
      updateLinuxBuild12b:
        "Aggiornamento alla prima versione della build 12: squadra e dati tenuti; il Dottore viene avviato durante la pausa del ritmo, e la ripresa dopo spende il margine in pochi secondi.",
      updateMacBuild12b:
        "Aggiornamento alla prima versione della build 12: 6 pertinenti su 11 nuove, miglior punteggio 89; il setup dice che la configurazione è fallita mentre la squadra parte da sola.",
      updateWindowsBuild12c:
        "Aggiornamento alla build 12 con la chat dell'Assistente aperta, tutto in francese: si ferma a metà e il comando jht non funziona finché non si rilancia l'installer.",
      updateLinuxBuild12d:
        "Aggiornamento all'ultima versione della build 12: squadra e dati tenuti; la ripresa dopo la pausa del ritmo lavora 275 secondi invece di circa 80, e i ruoli di servizio non vengono svegliati.",
      updateMacBuild12d:
        "Aggiornamento all'ultima versione della build 12: squadra e dati tenuti, sparito il falso avviso di setup fallito; 12 annunci nuovi, ancora senza punteggio nella finestra.",
      updateLinuxBuild13:
        "Aggiornamento alla build 13: squadra e dati tenuti; gli arricchimenti girano su ogni annuncio controllato ma non danno né coordinate né loghi; 0,0085 $ per annuncio analizzato.",
      updateWindowsBuild13:
        "Riprova dell'aggiornamento con la chat aperta: arriva in fondo e il comando jht funziona; la chat però si chiude ancora con una riga grezza.",
      candidateLinux:
        "Aggiornamento alla candidata del rilascio, squadra e dati tenuti: il primo tetto di spesa tiene, il secondo è superato del 13% dopo una ripresa; 20 pertinenti su 33 nuove (61%, ne serve il 70%).",
      retestBrake:
        "Riprova del freno su un'immagine di prova costruita sulla candidata: il tetto tiene entrambe le volte (0,36 di 1 $ e 1,92 di 3 $); dopo lo sblocco di un budget nuovo il ritmo lascia passare 0,86 $ oltre la sua linea.",
      retestPace:
        "Riprova del risveglio a scaglioni dopo la pausa del ritmo: gli scaglioni funzionano e il periodo non supera mai la linea né il tetto (2,55 di 3 $); altri due canali svegliano ancora chi è in attesa.",
      retestFull:
        "Riprova completa: linea e tetto mai superati (2,55 di 3 $), ma chi aspetta il suo scaglione lavora lo stesso e la prima pausa arriva 48 secondi dopo lo sblocco; 1 pertinente su 15, tutte da un solo portale di agenzia.",
      retestReserve:
        "Riprova completa, chiusa prima: gli scaglioni funzionano, ma la riserva stimata della ripartenza ferma la squadra 10-20 secondi dopo ogni scaglione; nessun annuncio nuovo.",
      retestResumes:
        "Riprova, chiusa prima: lo sblocco ora lavora dieci minuti prima della prima pausa, ma entrambe le riprese si fermano entro il primo minuto, e dopo l'aggiornamento il Capitano sveglia tutti e sette i lavoratori fuori dagli scaglioni.",
      retestDayQuota:
        "Retest del budget diviso per giorno, su due giorni (41 h) con il ritmo spento: la squadra lavora fino alla quota del giorno, si ferma con un solo avviso e riparte da sola il giorno dopo (1,38 $ su 2, mai sopra una quota). 4 difetti minori; 4 pertinenti su 5 nuove.",
      candidateWindowsSpanish:
        "Candidata su un utente nuovo Windows, tutto in spagnolo: 4 pertinenti su 10 in 5 minuti (altre 5 del mestiere giusto, ma part time o stagionali); il freno del ritmo ferma a 1,01 su 1,5 $. Aperti: aiuto vuoto dall'host, Scout fermo dopo la prima passata.",
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
    targetsLead:
      "La 0.4.0 si rilascia solo con tutte le righe verdi. Aggiornata a ogni build; la prova porta al giro qui sotto.",
    targetsCount: "{g} di {n} verdi",
    targetsCols: {
      target: "Target",
      status: "Stato",
      build: "Build",
      proof: "Prova",
    },
    targetStatus: {
      pass: "raggiunto",
      fail: "non raggiunto",
      pending: "da provare",
      blocked: "bloccato",
    },
    targets: {
      scoutBenchCook: "Cuoco",
      scoutBenchWarehouse: "Magazziniere",
      scoutBenchNurse: "Infermiera",
      scoutBenchBricklayer: "Muratore",
      languageWindows: "Setup e onboarding nella lingua scelta · Windows",
      languageLinux: "Setup e onboarding nella lingua scelta · Linux",
      languageMac: "Setup e onboarding nella lingua scelta · Mac",
      preTagReview: "Controllo di sicurezza prima del tag",
      installWindows: "Installazione da utente vergine · Windows",
      installLinux: "Installazione da utente vergine · Linux",
      installMac: "Installazione da utente vergine · Mac",
      updateLinux: "Aggiornamento con squadra e dati esistenti · Linux",
      updateMac: "Aggiornamento con squadra e dati esistenti · Mac",
      updateWindows: "Aggiornamento con squadra e dati esistenti · Windows",
      nonItRelevant: "Annunci del mestiere della persona (almeno 70%)",
      scoutBench:
        "Banco degli Scout, 4 mestieri non IT (≥70% pertinenti, 0 doppioni, ≥15 posizioni)",
      budgetBrake:
        "Freno del budget: mai oltre il tetto, nessuno sblocco falso, avviso all'utente",
      language: "Setup e onboarding nella lingua scelta",
      doctorMaintainer:
        "Il Dottore e il Mantenitore, gli agenti che curano la squadra, lavorano davvero",
      serviceClaude: "Claude (Anthropic) · chiave API",
      serviceOpenai: "OpenAI · chiave API",
      serviceGlm: "Z.ai (GLM) · chiave API",
      serviceKimi: "Kimi (Moonshot) · chiave API",
      codexSubscription:
        "OpenAI Codex · abbonamento (solo chi ha già la 0.3.x, come nel nostro beta test)",
      openaiSubscription: "OpenAI · abbonamento ChatGPT su Pi",
      noKeyOnDisk: "Nessuna chiave API resta scritta sul disco",
      betaTester: "Beta test: versione aggiornata e squadra al lavoro",
    },
    targetNotes: {
      updateMacBuild10:
        "build 10: setup tutto in portoghese, chiave salvata tenuta, 1 annuncio nuovo (punteggio 74)",
      updateWindowsBuild10:
        "build 10: annunci, profilo e chiave tenuti, tutto in tedesco; dopo l'aggiornamento l'Analista non è mai partito (13 annunci in attesa)",
      languagePortugueseOk:
        "build 10: portoghese dall'inizio alla fine sul Mac",
      notTried040:
        "non provato sulla 0.4.0",
      updateLinuxBuild9:
        "build 9: superato (il giro non è nella tabella sotto)",
      installerBlockedBuild9:
        "build 9: fermato dall'installer (correzione in build 10, giro in corso)",
      benchCook: "79% pertinenti",
      benchWarehouse: "90% pertinenti",
      benchNurse: "1 doppione (94% pertinenti)",
      benchBricklayer: "6 posizioni, meno di 15 (83% pertinenti)",
      brakeFixedRetry: "corretto nelle build 9 e 10: da riprovare",
      languageGermanOk: "build 9: tedesco dall'inizio alla fine su Linux",
      securityPreTag:
        "controllo prima del tag: il verdetto arriva sulla versione esatta del tag; il caso della chiave su disco è chiuso",
      cleanLinuxRoundMissing:
        "installazione vergine sulla build 6: il suo giro non è nella tabella qui sotto",
      openaiBuild6Redo:
        "provato solo sulla build 6 (1,61 $, 10 minuti): da rifare sulla 0.4.0",
      redoOnBuild9: "da rifare sulla build 9",
      diskFull: "disco pieno dopo l'aggiornamento (correzione in corso)",
      neverTried: "mai provato",
      relevantBelow: "0 nuove per il muratore, 10 su 26 per la receptionist",
      benchPaused: "in pausa fino alla build 9",
      brakeFalseClear: "sblocco falso dopo lo stop, avviso all'utente fallito",
      languageEnglish:
        "passo della chiave API, avvio della squadra e status in inglese (corretti dopo la build 8)",
      zeroTurns: "0 turni (corretto nella build 9)",
      noCredit: "senza credito per provarli",
      loginNeverTried: "accesso vero mai provato",
      keysChecked: "0 file con chiave fuori posto, su 20.927 eventi sui file",
      updateOnBuild9: "aggiornamento sulla build 9",
      updateMacBuild11:
        "build 11: annunci, punteggi e chiave tenuti, spazio su disco tornato, tutto in portoghese",
      updateWindowsBuild13:
        "build 13: l'aggiornamento con la chat aperta arriva in fondo e il comando jht funziona, tutto in francese",
      relevantBuild15:
        "build 15: 4 pertinenti su 10 per il profilo commesso/a su un utente nuovo Windows (40%; altre 5 part time o stagionali); 4 su 5 per l'elettricista nel retest; 20 su 33 (61%) sulla prima candidata. Da riprovare con un'installazione nuova",
      brakeDayQuota:
        "build 15: la quota del giorno e il ritmo fermano la squadra prima di ogni budget (1,38 $ su 2 in due giorni; 1,04 $ su 1,5 su Windows); restano difetti minori negli avvisi e nello stato",
      languageFrenchGermanOk:
        "build 11-13: tedesco e francese in tutto il flusso; restano poche righe in inglese (aiuto del comando)",
      languageItalianOk:
        "build 11: installazione e onboarding tutto in italiano su Linux",
      doctorWorks:
        "build 11-12: Dottore e Mantenitore fanno i loro turni senza errori e sbloccano gli agenti giusti",
    },
    invalidTitle: "Giri che non contano",
    invalidLead:
      "Giri rotti da cause nostre (credito finito, una macchina di prova che si è spenta da sola, un errore di misura, tentativi annullati del banco), non da difetti del prodotto. Restano fuori dalla tabella e dai grafici; i difetti trovati restano nel grafico dei difetti.",
    invalidReasons: {
      noCreditMachineOff:
        "OpenAI senza credito e la macchina di prova si è spenta da sola: nessuno Scout è partito. A metà giro il servizio è stato cambiato in GLM.",
      cumulativeCap:
        "Il nostro tetto di prova di 3 $ era troppo basso ed è stato letto su un contatore che conteneva anche il giro prima: fermato dopo 6 minuti, prima di qualsiasi annuncio nuovo.",
      benchDailyBudget:
        "Tentativo del banco annullato: è partito con un budget giornaliero alto rimasto da prima, e il freno a ritmo l'ha fermato dopo 70 secondi.",
      benchOpenRun:
        "Tentativo del banco annullato: la prima ricerca della build precedente era ancora aperta.",
      creditEndedNoPositions:
        "Il credito GLM dell'account di prova è finito prima di qualsiasi annuncio: 0 annunci.",
      benchCancelled: "Tentativo del banco annullato e ripartito da zero.",
    },
    targetSections: {
      install: "Installazione da utente nuovo",
      update: "Aggiornamento con squadra e dati",
      scout: "Banco Scout: lo Scout trova annunci del mestiere giusto?",
      brake: "Criteri delle ultime prove (build 15).",
      language: "Lingua",
      doctor: "Dottore e Mantenitore",
      services: "Servizi",
      security: "Sicurezza",
      beta: "Beta test",
      realUser: "Giro completo da utente vero, con un mestiere non IT",
    },
    targetCriteria: {
      relevant: "pertinenti {v}% (≥{min}%)",
      duplicates: "doppioni {v}",
      positions: "annunci {v} (≥{min})",
      newPositions: "{trade}: {v} nuovi",
      relevantOf: "{trade}: {v} pertinenti su {of}",
      underCeiling: "spesi {v} di {max} $",
      noFalseUnlock: "nessuno sblocco falso",
    },
    targetRules: {
      scout:
        "Solo la ricerca degli Scout, su un server già configurato, con quattro mestieri non IT. Un mestiere passa se tutti e 3 i criteri sono verdi: almeno 70% pertinenti, 0 doppioni, almeno 15 annunci.",
      brake:
        "Criteri dell'ultima prova (build 8); corretto dopo, da riprovare.",
      realUser:
        "Una persona installa il programma da zero, risponde al setup e lascia lavorare la squadra da sola per 30 minuti. Passa se almeno il 70% degli annunci trovati è del suo mestiere.",
    },
    targetTried: "provato sulla build {n}",
    targetRows: {
      install: "Prima installazione su un computer senza il programma",
      update:
        "Aggiornamento di un computer che ha già una squadra e i suoi dati",
      language: "Setup e onboarding nella lingua scelta",
    },
    buildsTitle: "Giri di ogni build",
    buildLabel: "Build {n}",
    previousBuild: "build precedente",
    paceNote:
      "I giri fanno lavorare la squadra per minuti o ore, non per i giorni che un budget deve coprire: il costo è compresso in poco tempo e non dice quanto dura un budget nell'uso di tutti i giorni. Solo il giro r33 copre due giorni, con il ritmo spento e il budget diviso per giorno.",
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
    lead: "Was das Team in den Testläufen vom 14. bis 21. November 2026 ausgegeben und gefunden hat, mit den API-Schlüssel-Diensten des 0.4.0-Harness. Die Zahlen stammen aus den Testprotokollen und den Kostenmessungen.",
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
      "«Passend» = Stellen, deren Titel zum Beruf passt, stichprobenartig geprüft; ein Strich = nicht bewertet. «Frühere Build» = ein Lauf vor den nummerierten Builds der 0.4.0: er belegt die 0.4.0 nicht.",
    chartTitle: "Was eine bewertete Stelle kostet",
    chartLead:
      "Dollar pro vom Team bewerteter Stelle. Kürzer ist besser. Läufe ohne bewertete Stelle haben keinen Balken.",
    chartNone: "keine bewertet",
    chartCaveat:
      "Die beiden Mac-Läufe dauerten 6 und 10 Minuten mit minimalem Team; die Kosten sind fast nur Onboarding und Capitano: nicht vergleichbar mit Läufen von 16-42 Minuten.",
    servicesTitle: "Dienste: Beobachtetes in den Läufen",
    servicesCols: {
      service: "Dienst",
      seen: "In den Läufen gesehen",
      rate: "Beobachtetes Tempo",
    },
    servicesCaveat:
      "Nur, was die Läufe gemessen haben; ein Strich = nie ausprobiert. Diese Zahlen stammen aus Läufen auf Builds vor den nummerierten der 0.4.0 (r1–r8): sie sagen, was ein Dienst kostet, nicht wie sich die 0.4.0 verhält. Claude unter Windows gab 5,28 $ aus: Capitano und Scorer machen davon 3,05 $ aus.",
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
      "Synthetische Profile, keine personenbezogenen Daten · Zahlen aus den Testprotokollen vom 14.-21.11.2026.",
    marks:
      "Die Logos nennen nur den Dienst, den ein Test genutzt hat, und bedeuten keine Billigung. Marken und Logos gehören ihren jeweiligen Inhabern.",
    outcome: {
      pass: "bestanden",
      reservations: "mit Vorbehalt",
      fail: "nicht bestanden",
      unjudged: "nicht bewertet",
      running: "läuft",
    },
    system: {
      pass: "besteht",
      withReservations: "besteht mit Vorbehalt",
      running: "läuft",
    },
    profiles: {
      bricklayer: "Maurer",
      warehouseWorker: "Lagerarbeiter",
      officeClerk: "Bürokraft, Teilzeit",
      dataAnalyst: "Data Analyst",
      generic: "Allgemeines Testprofil",
      restorer: "Restauratorin",
      waiter: "Kellner",
      receptionist: "Rezeptionist",
      truckDriver: "Lkw-Fahrer",
      electrician: "Elektriker",
      shopAssistant: "Verkäufer/in",
      careAssistant: "Pflegehelferin",
    },
    modes: { onsite: "vor Ort", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI (Guthaben aufgebraucht), dann GLM",
    },
    notes: {
      updateBuild10Portuguese:
        "Update auf Build 10, ganz auf Portugiesisch: gespeicherter Schlüssel behalten, die Warteschlange lief von selbst weiter, 1 neue Stelle (74); die Tempobremse pausierte das Team und sagte es der Person.",
      updateWindowsBuild9to10:
        "Build 9 neu installiert, alles auf Deutsch: 25 Lagerstellen in einer Viertelstunde; Update auf Build 10 mit behaltenen Stellen, Profil und Schlüssel, danach startete der Analyst nie und 13 Stellen blieben wartend.",
      updateSwitchKept:
        "Update bei laufendem Team: Daten behalten, alte Images entfernt, GLM → Claude ohne das Team anzuhalten. 3 passende von 26 neuen in 10 Minuten.",
      updateWelcomePaid:
        "Update und Wechsel zu Claude: 15 passende von 18 in 12 Minuten. Die Begrüßung wurde bei jedem Neustart wieder bezahlt.",
      cleanInstallWarehouse:
        "Neuer Nutzer, geführtes Onboarding: Die Bremse hielt bei 2,67 $. Fast nur Lagerjobs: 2 passende von 19.",
      updateNoNewPositions:
        "Update gelungen und keine Schlüsseldatei auf der Platte, aber 0 neue Stellen in 30 Minuten: nur 2 Scouts geweckt.",
      diskLowAfterUpdate:
        "Update gelungen, Team nie gestartet: 4 GiB frei von 8 nötigen, ohne Warnung vor dem Download.",
      cleanInstallGerman:
        "Neuer Nutzer auf Deutsch: 10 passende von 26. Die Bremse hielt bei 4,77 $, dann eine falsche Freigabe (4,95 $ am Ende); Doktor und Wartung ohne Durchgang.",
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
      updateWindowsBuild11:
        "Update von Build 10 auf 11, alles auf Deutsch: Team und Daten behalten, der Analyst startet von selbst wieder; 5 passende von 7 neuen.",
      installLinuxBuild11:
        "Neuinstallation und geführtes Onboarding ganz auf Italienisch, Schlüssel behalten: 14 passende von 18. Der Speicherschutz zieht die Scouts zurück, ohne es der Person zu sagen, und sie kommen nicht wieder.",
      updateMacBuild11:
        "Update von Build 10 auf 11 auf Portugiesisch: Stellen, Scores und Schlüssel behalten, Speicherplatz zurück; das Budget des Zeitraums ist verbraucht, bevor die 6 neuen bewertet sind.",
      updateLinuxBuild12b:
        "Update auf die erste Fassung von Build 12: Team und Daten behalten; der Doktor wird während der Tempopause gestartet, und die Wiederaufnahme danach verbraucht den Spielraum in Sekunden.",
      updateMacBuild12b:
        "Update auf die erste Fassung von Build 12: 6 passende von 11 neuen, bester Score 89; das Setup meldet eine fehlgeschlagene Konfiguration, während das Team von selbst startet.",
      updateWindowsBuild12c:
        "Update auf Build 12 bei offenem Chat des Assistenten, alles auf Französisch: es bricht mittendrin ab, und der Befehl jht geht erst wieder, wenn der Installer neu läuft.",
      updateLinuxBuild12d:
        "Update auf die letzte Fassung von Build 12: Team und Daten behalten; die Wiederaufnahme nach der Tempopause arbeitet 275 Sekunden statt etwa 80, und die Dienstrollen werden nicht geweckt.",
      updateMacBuild12d:
        "Update auf die letzte Fassung von Build 12: Team und Daten behalten, der falsche Hinweis auf ein fehlgeschlagenes Setup ist weg; 12 neue Stellen, im Zeitfenster noch nicht bewertet.",
      updateLinuxBuild13:
        "Update auf Build 13: Team und Daten behalten; die Anreicherungen laufen für jede geprüfte Stelle, liefern aber weder Koordinaten noch Logos; 0,0085 $ pro analysierter Stelle.",
      updateWindowsBuild13:
        "Erneuter Test des Updates bei offenem Chat: es läuft durch und der Befehl jht funktioniert; der Chat selbst schließt aber noch mit einer rohen Zeile.",
      candidateLinux:
        "Update auf den Release-Kandidaten, Team und Daten behalten: das erste Ausgabenlimit hält, das zweite wird nach einer Wiederaufnahme um 13% überschritten; 20 passende von 33 neuen (61%, nötig sind 70%).",
      retestBrake:
        "Erneuter Bremstest auf einem Test-Image auf Basis des Kandidaten: das Limit hält beide Male (0,36 von 1 $ und 1,92 von 3 $); nach der Freigabe eines neuen Budgets lässt das Tempo 0,86 $ über seine Linie.",
      retestPace:
        "Erneuter Test des gestaffelten Weckens nach der Tempopause: die Staffeln funktionieren, und der Zeitraum überschreitet nie Linie oder Limit (2,55 von 3 $); zwei andere Kanäle wecken die Wartenden trotzdem.",
      retestFull:
        "Vollständiger erneuter Test: Linie und Limit nie überschritten (2,55 von 3 $), aber wer auf seine Staffel wartet, arbeitet trotzdem, und die erste Pause kommt 48 Sekunden nach der Freigabe; 1 passende von 15, alle von einem einzigen Agenturportal.",
      retestReserve:
        "Vollständiger erneuter Test, vorzeitig beendet: die Staffeln funktionieren, aber die geschätzte Reserve des Neustarts stoppt das Team 10 bis 20 Sekunden nach jeder Staffel; keine neue Stelle.",
      retestResumes:
        "Erneuter Test, vorzeitig beendet: die Freigabe arbeitet jetzt zehn Minuten bis zur ersten Pause, aber beide Wiederaufnahmen stoppen in der ersten Minute, und nach dem Update weckt der Kapitän alle sieben Arbeiter außerhalb der Staffeln.",
      retestDayQuota:
        "Retest des nach Tagen aufgeteilten Budgets über zwei Tage (41 Std.) bei ausgeschaltetem Tempo: das Team arbeitet bis zum Tagesanteil, hält mit einer einzigen Meldung an und läuft am nächsten Tag von selbst weiter (1,38 $ von 2, nie über einem Anteil). 4 kleine Mängel; 4 passende von 5 neuen.",
      candidateWindowsSpanish:
        "Release-Kandidat bei einem neuen Windows-Nutzer, alles auf Spanisch: 4 passende von 10 in 5 Minuten (5 weitere vom richtigen Beruf, aber Teilzeit oder saisonal); die Tempobremse stoppt bei 1,01 von 1,5 $. Offen: leere Hilfe vom Host, Scout nach dem ersten Durchgang gestoppt.",
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
    targetsLead:
      "0.4.0 wird nur veröffentlicht, wenn jede Zeile grün ist. Bei jedem Build aktualisiert; der Nachweis führt zum Lauf weiter unten.",
    targetsCount: "{g} von {n} grün",
    targetsCols: {
      target: "Ziel",
      status: "Stand",
      build: "Build",
      proof: "Nachweis",
    },
    targetStatus: {
      pass: "erreicht",
      fail: "nicht erreicht",
      pending: "zu prüfen",
      blocked: "blockiert",
    },
    targets: {
      scoutBenchCook: "Koch",
      scoutBenchWarehouse: "Lagerarbeiter",
      scoutBenchNurse: "Krankenpflegerin",
      scoutBenchBricklayer: "Maurer",
      languageWindows:
        "Setup und Onboarding in der gewählten Sprache · Windows",
      languageLinux: "Setup und Onboarding in der gewählten Sprache · Linux",
      languageMac: "Setup und Onboarding in der gewählten Sprache · Mac",
      preTagReview: "Sicherheitsprüfung vor dem Tag",
      installWindows: "Installation durch neuen Nutzer · Windows",
      installLinux: "Installation durch neuen Nutzer · Linux",
      installMac: "Installation durch neuen Nutzer · Mac",
      updateLinux: "Update mit vorhandenem Team und Daten · Linux",
      updateMac: "Update mit vorhandenem Team und Daten · Mac",
      updateWindows: "Update mit vorhandenem Team und Daten · Windows",
      nonItRelevant: "Stellen im Beruf der Person (mindestens 70 %)",
      scoutBench:
        "Scout-Prüfstand, 4 Berufe außerhalb der IT (≥70% passend, 0 Doppelte, ≥15 Stellen)",
      budgetBrake:
        "Budgetbremse: nie über der Obergrenze, keine falsche Freigabe, die Person wird informiert",
      language: "Setup und Onboarding in der gewählten Sprache",
      doctorMaintainer:
        "Der Doktor und die Wartung, die Agenten, die sich um das Team kümmern, arbeiten wirklich",
      serviceClaude: "Claude (Anthropic) · API-Schlüssel",
      serviceOpenai: "OpenAI · API-Schlüssel",
      serviceGlm: "Z.ai (GLM) · API-Schlüssel",
      serviceKimi: "Kimi (Moonshot) · API-Schlüssel",
      codexSubscription:
        "OpenAI Codex · Abo (nur wer schon 0.3.x hat, wie in unserem Betatest)",
      openaiSubscription: "OpenAI · ChatGPT-Abo auf Pi",
      noKeyOnDisk: "Kein API-Schlüssel bleibt auf der Festplatte gespeichert",
      betaTester: "Betatest: Version aktualisiert und Team bei der Arbeit",
    },
    targetNotes: {
      updateMacBuild10:
        "Build 10: Setup ganz auf Portugiesisch, gespeicherter Schlüssel behalten, 1 neue Stelle (Score 74)",
      updateWindowsBuild10:
        "Build 10: Stellen, Profil und Schlüssel behalten, alles auf Deutsch; nach dem Update startete der Analyst nie (13 Stellen warten)",
      languagePortugueseOk: "Build 10: durchgehend Portugiesisch auf dem Mac",
      notTried040:
        "auf der 0.4.0 nicht geprüft",
      updateLinuxBuild9:
        "Build 9: bestanden (die Runde steht nicht in der Tabelle unten)",
      installerBlockedBuild9:
        "Build 9: vom Installer gestoppt (Korrektur in Build 10, Runde läuft)",
      benchCook: "79 % passend",
      benchWarehouse: "90 % passend",
      benchNurse: "1 Duplikat (94 % passend)",
      benchBricklayer: "6 Stellen, weniger als 15 (83 % passend)",
      brakeFixedRetry: "in Build 9 und 10 korrigiert: erneut zu prüfen",
      languageGermanOk: "Build 9: durchgehend Deutsch auf Linux",
      securityPreTag:
        "Prüfung vor dem Tag: das Urteil kommt auf die genaue Version des Tags; der Fall des Schlüssels auf der Festplatte ist geschlossen",
      cleanLinuxRoundMissing:
        "Neuinstallation auf Build 6: ihr Lauf fehlt in der Tabelle unten",
      openaiBuild6Redo:
        "nur auf Build 6 geprüft (1,61 $, 10 Minuten): auf der 0.4.0 zu wiederholen",
      redoOnBuild9: "auf Build 9 zu wiederholen",
      diskFull: "Platte voll nach dem Update (Korrektur in Arbeit)",
      neverTried: "nie geprüft",
      relevantBelow: "0 neue für den Maurer, 10 von 26 für die Rezeptionistin",
      benchPaused: "pausiert bis Build 9",
      brakeFalseClear:
        "falsche Freigabe nach dem Stopp, Hinweis an die Person fehlgeschlagen",
      languageEnglish:
        "API-Schlüssel, Teamstart und Status auf Englisch (nach Build 8 behoben)",
      zeroTurns: "0 Durchgänge (in Build 9 behoben)",
      noCredit: "kein Guthaben zum Prüfen",
      loginNeverTried: "echte Anmeldung nie geprüft",
      keysChecked:
        "0 Dateien mit Schlüssel am falschen Ort, bei 20.927 Dateiereignissen",
      updateOnBuild9: "Update auf Build 9",
      updateMacBuild11:
        "Build 11: Stellen, Scores und Schlüssel behalten, Speicherplatz zurück, alles auf Portugiesisch",
      updateWindowsBuild13:
        "Build 13: das Update bei offenem Chat läuft durch und der Befehl jht funktioniert, alles auf Französisch",
      relevantBuild15:
        "Build 15: 4 passende von 10 für das Profil Verkäufer/in bei einem neuen Windows-Nutzer (40%; 5 weitere Teilzeit oder saisonal); 4 von 5 für den Elektriker im Retest; 20 von 33 (61%) beim ersten Kandidaten. Mit einer neuen Installation erneut zu prüfen",
      brakeDayQuota:
        "Build 15: Tagesanteil und Tempo halten das Team vor jedem Budget an (1,38 $ von 2 in zwei Tagen; 1,04 $ von 1,5 unter Windows); kleine Mängel bleiben in Meldungen und Status",
      languageFrenchGermanOk:
        "Builds 11-13: Deutsch und Französisch im ganzen Ablauf; ein paar Zeilen noch auf Englisch (Hilfe des Befehls)",
      languageItalianOk:
        "Build 11: Installation und Onboarding ganz auf Italienisch unter Linux",
      doctorWorks:
        "Builds 11-12: Doktor und Wartung machen ihre Durchgänge ohne Fehler und geben die richtigen Agenten frei",
    },
    invalidTitle: "Runden, die nicht zählen",
    invalidLead:
      "Runden, die an Ursachen auf unserer Seite gescheitert sind (Guthaben aufgebraucht, eine Testmaschine, die sich selbst abgeschaltet hat, ein Messfehler, abgebrochene Versuche der Bank), nicht an Fehlern des Produkts. Sie fehlen in der Tabelle und in den Diagrammen; ihre Fehler bleiben im Fehlerdiagramm.",
    invalidReasons: {
      noCreditMachineOff:
        "OpenAI ohne Guthaben, und die Testmaschine hat sich selbst abgeschaltet: kein Scout ist gestartet. Mitten in der Runde wurde der Dienst auf GLM gewechselt.",
      cumulativeCap:
        "Unsere Testgrenze von 3 $ war zu niedrig und wurde an einem Zähler abgelesen, der auch die Runde davor enthielt: nach 6 Minuten gestoppt, vor jeder neuen Stelle.",
      benchDailyBudget:
        "Abgebrochener Versuch der Bank: er startete mit einem hohen Tagesbudget von vorher, und die Tempobremse stoppte ihn nach 70 Sekunden.",
      benchOpenRun:
        "Abgebrochener Versuch der Bank: die erste Suche des vorherigen Builds war noch offen.",
      creditEndedNoPositions:
        "Das GLM-Guthaben des Testkontos war vor jeder Stelle aufgebraucht: 0 Stellen.",
      benchCancelled: "Abgebrochener Versuch der Bank, von null neu gestartet.",
    },
    targetSections: {
      install: "Installation durch neue Nutzer",
      update: "Update mit Team und Daten",
      scout: "Scout-Bank: findet der Scout Anzeigen des richtigen Berufs?",
      brake: "Kriterien der letzten Versuche (Build 15).",
      language: "Sprache",
      doctor: "Doktor und Wartung",
      services: "Dienste",
      security: "Sicherheit",
      beta: "Betatest",
      realUser:
        "Ganze Runde als echter Nutzer, mit einem Beruf außerhalb der IT",
    },
    targetCriteria: {
      relevant: "passend {v} % (≥{min} %)",
      duplicates: "Duplikate {v}",
      positions: "Anzeigen {v} (≥{min})",
      newPositions: "{trade}: {v} neu",
      relevantOf: "{trade}: {v} passend von {of}",
      underCeiling: "{v} von {max} $ ausgegeben",
      noFalseUnlock: "keine falsche Freigabe",
    },
    targetRules: {
      scout:
        "Nur die Suche der Scouts, auf einem schon eingerichteten Server, mit vier Berufen außerhalb der IT. Ein Beruf besteht, wenn alle 3 Kriterien grün sind: mindestens 70 % passend, 0 Duplikate, mindestens 15 Anzeigen.",
      brake:
        "Kriterien des letzten Versuchs (Build 8); seitdem korrigiert, erneut zu prüfen.",
      realUser:
        "Eine Person installiert das Programm von null, beantwortet das Setup und lässt das Team 30 Minuten allein arbeiten. Bestanden, wenn mindestens 70 % der gefundenen Stellen zum Beruf der Person passen.",
    },
    targetTried: "geprüft auf Build {n}",
    targetRows: {
      install: "Erstinstallation auf einem Computer ohne das Programm",
      update: "Update eines Computers, der schon ein Team und seine Daten hat",
      language: "Setup und Onboarding in der gewählten Sprache",
    },
    buildsTitle: "Läufe jedes Builds",
    buildLabel: "Build {n}",
    previousBuild: "frühere Build",
    paceNote:
      "Die Läufe lassen das Team Minuten oder Stunden arbeiten, nicht die Tage, die ein Budget abdecken soll: die Kosten sind auf kurze Zeit zusammengedrängt und sagen nicht, wie lange ein Budget im Alltag reicht. Nur Lauf r33 deckt zwei Tage ab, mit ausgeschaltetem Tempo und nach Tagen aufgeteiltem Budget.",
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
    lead: "Lo que el equipo gastó y encontró en las rondas de prueba del 14 al 21 de noviembre de 2026, con los servicios de clave API que ofrece el harness 0.4.0. Las cifras salen de los informes de las pruebas y de los muestreadores de coste.",
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
      "«Pertinentes» = puestos cuyo título corresponde al oficio, comprobados por muestreo; un guion = sin juzgar. «Build anterior» = ronda previa a las builds numeradas de la 0.4.0: no prueba la 0.4.0.",
    chartTitle: "Cuánto cuesta un puesto valorado",
    chartLead:
      "Dólares gastados por cada puesto que el equipo valoró. Más corta es mejor. Las rondas sin puestos valorados no tienen barra.",
    chartNone: "ninguna valorada",
    chartCaveat:
      "Las dos rondas del Mac duraron 6 y 10 minutos con un equipo mínimo, y el coste es casi todo onboarding y Capitán: no son comparables con rondas de 16-42 minutos.",
    servicesTitle: "Servicios: lo visto en las rondas",
    servicesCols: {
      service: "Servicio",
      seen: "Visto en las rondas",
      rate: "Ritmo visto",
    },
    servicesCaveat:
      "Solo lo que midieron las rondas; un guion = nunca probado. Estas cifras salen de rondas en builds anteriores a las numeradas de la 0.4.0 (r1–r8): dicen cuánto cuesta un servicio, no cómo se comporta la 0.4.0. Claude en Windows gastó 5,28 $: Capitán y Scorer pesan 3,05 $.",
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
      "Perfiles ficticios, sin datos personales · cifras de los informes de prueba del 14-21/11/2026.",
    marks:
      "Los logotipos solo indican el servicio que usó una prueba y no implican ningún respaldo. Las marcas y los logotipos pertenecen a sus respectivos propietarios.",
    outcome: {
      pass: "pasa",
      reservations: "con reservas",
      fail: "no pasa",
      unjudged: "sin juzgar",
      running: "en curso",
    },
    system: {
      pass: "pasa",
      withReservations: "pasa con reservas",
      running: "en curso",
    },
    profiles: {
      bricklayer: "Albañil",
      warehouseWorker: "Mozo de almacén",
      officeClerk: "Administrativa a tiempo parcial",
      dataAnalyst: "Analista de datos",
      generic: "Perfil de prueba genérico",
      restorer: "Restauradora",
      waiter: "Camarero",
      receptionist: "Recepcionista",
      truckDriver: "Conductor de camión",
      electrician: "Electricista",
      shopAssistant: "Dependiente/a",
      careAssistant: "Auxiliar de enfermería",
    },
    modes: { onsite: "presencial", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI (crédito agotado), luego GLM",
    },
    notes: {
      updateBuild10Portuguese:
        "Actualización en la build 10, todo en portugués: clave guardada conservada, la cola volvió a arrancar sola, 1 anuncio nuevo (74); el freno de ritmo pausó el equipo y se lo dijo a la persona.",
      updateWindowsBuild9to10:
        "Build 9 instalada desde cero, todo en alemán: 25 anuncios de almacén en un cuarto de hora; actualizada a la build 10 con anuncios, perfil y clave conservados, luego el Analista nunca arrancó y 13 anuncios quedaron en espera.",
      updateSwitchKept:
        "Actualización con el equipo en marcha: datos conservados, imágenes viejas quitadas, GLM → Claude sin parar el equipo. 3 pertinentes de 26 nuevas en 10 minutos.",
      updateWelcomePaid:
        "Actualización y paso a Claude: 15 pertinentes de 18 en 12 minutos. La bienvenida se volvió a pagar en cada reinicio.",
      cleanInstallWarehouse:
        "Usuario nuevo, onboarding guiado: el freno paró en 2,67 $. Casi solo almacén: 2 pertinentes de 19.",
      updateNoNewPositions:
        "Actualización correcta y ningún archivo con clave en disco, pero 0 ofertas nuevas en 30 minutos: solo 2 Scouts despertados.",
      diskLowAfterUpdate:
        "Actualización correcta, el equipo nunca arrancó: 4 GiB libres de los 8 necesarios, sin aviso antes de la descarga.",
      cleanInstallGerman:
        "Usuario nuevo en alemán: 10 pertinentes de 26. El freno paró en 4,77 $ y luego un desbloqueo falso (4,95 $ al final); Doctor y Mantenedor sin turnos.",
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
      updateWindowsBuild11:
        "Actualización de la build 10 a la 11, todo en alemán: equipo y datos conservados, el Analista vuelve a arrancar solo; 5 pertinentes de 7 nuevas.",
      installLinuxBuild11:
        "Instalación desde cero y onboarding guiado todo en italiano, clave conservada: 14 pertinentes de 18. La guarda de memoria retira a los Scouts sin decírselo a la persona, y no vuelven.",
      updateMacBuild11:
        "Actualización de la build 10 a la 11 en portugués: anuncios, puntuaciones y clave conservados, espacio en disco recuperado; el presupuesto del periodo se acaba antes de puntuar las 6 nuevas.",
      updateLinuxBuild12b:
        "Actualización a la primera versión de la build 12: equipo y datos conservados; el Doctor arranca durante la pausa de ritmo, y la reanudación posterior gasta el margen en segundos.",
      updateMacBuild12b:
        "Actualización a la primera versión de la build 12: 6 pertinentes de 11 nuevas, mejor puntuación 89; el setup dice que la configuración ha fallado mientras el equipo arranca solo.",
      updateWindowsBuild12c:
        "Actualización a la build 12 con el chat del Asistente abierto, todo en francés: se para a mitad y el comando jht no funciona hasta volver a lanzar el instalador.",
      updateLinuxBuild12d:
        "Actualización a la última versión de la build 12: equipo y datos conservados; la reanudación tras la pausa de ritmo trabaja 275 segundos en vez de unos 80, y los roles de servicio no se despiertan.",
      updateMacBuild12d:
        "Actualización a la última versión de la build 12: equipo y datos conservados, desaparece el falso aviso de setup fallido; 12 anuncios nuevos, aún sin puntuar en la ventana.",
      updateLinuxBuild13:
        "Actualización a la build 13: equipo y datos conservados; los enriquecimientos se ejecutan en cada anuncio revisado pero no dan ni coordenadas ni logos; 0,0085 $ por anuncio analizado.",
      updateWindowsBuild13:
        "Nueva prueba de la actualización con el chat abierto: llega al final y el comando jht funciona; el chat, eso sí, aún se cierra con una línea en bruto.",
      candidateLinux:
        "Actualización a la candidata de la versión, equipo y datos conservados: el primer tope de gasto aguanta, el segundo se supera un 13% tras una reanudación; 20 pertinentes de 33 nuevas (61%, hace falta el 70%).",
      retestBrake:
        "Nueva prueba del freno en una imagen de prueba construida sobre la candidata: el tope aguanta las dos veces (0,36 de 1 $ y 1,92 de 3 $); tras desbloquear un presupuesto nuevo, el ritmo deja pasar 0,86 $ por encima de su línea.",
      retestPace:
        "Nueva prueba del despertar escalonado tras la pausa de ritmo: los escalones funcionan y el periodo nunca supera la línea ni el tope (2,55 de 3 $); otros dos canales siguen despertando a quien espera.",
      retestFull:
        "Nueva prueba completa: línea y tope nunca superados (2,55 de 3 $), pero quien espera su escalón trabaja igual y la primera pausa llega 48 segundos después del desbloqueo; 1 pertinente de 15, todas de un solo portal de agencia.",
      retestReserve:
        "Nueva prueba completa, cerrada antes: los escalones funcionan, pero la reserva estimada del reinicio para el equipo 10-20 segundos después de cada escalón; ningún anuncio nuevo.",
      retestResumes:
        "Nueva prueba, cerrada antes: el desbloqueo ya trabaja diez minutos antes de la primera pausa, pero las dos reanudaciones se paran en el primer minuto, y tras la actualización el Capitán despierta a los siete trabajadores fuera de los escalones.",
      retestDayQuota:
        "Retest del presupuesto dividido por día, durante dos días (41 h) con el ritmo apagado: el equipo trabaja hasta la parte del día, se detiene con un solo aviso y reanuda solo al día siguiente (1,38 $ de 2, nunca por encima de una parte). 4 defectos menores; 4 pertinentes de 5 nuevas.",
      candidateWindowsSpanish:
        "Candidata con un usuario nuevo de Windows, todo en español: 4 pertinentes de 10 en 5 minutos (otras 5 del oficio correcto, pero a tiempo parcial o de temporada); el freno del ritmo se detiene en 1,01 de 1,5 $. Abiertos: ayuda vacía desde el host, Scout parado tras la primera pasada.",
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
    targetsLead:
      "La 0.4.0 se publica solo con todas las filas en verde. Se actualiza en cada build; la prueba lleva a la ronda de abajo.",
    targetsCount: "{g} de {n} en verde",
    targetsCols: {
      target: "Objetivo",
      status: "Estado",
      build: "Build",
      proof: "Prueba",
    },
    targetStatus: {
      pass: "cumplido",
      fail: "no cumplido",
      pending: "por probar",
      blocked: "bloqueado",
    },
    targets: {
      scoutBenchCook: "Cocinero",
      scoutBenchWarehouse: "Mozo de almacén",
      scoutBenchNurse: "Enfermera",
      scoutBenchBricklayer: "Albañil",
      languageWindows:
        "Configuración y onboarding en el idioma elegido · Windows",
      languageLinux: "Configuración y onboarding en el idioma elegido · Linux",
      languageMac: "Configuración y onboarding en el idioma elegido · Mac",
      preTagReview: "Revisión de seguridad antes del tag",
      installWindows: "Instalación por un usuario nuevo · Windows",
      installLinux: "Instalación por un usuario nuevo · Linux",
      installMac: "Instalación por un usuario nuevo · Mac",
      updateLinux: "Actualización con equipo y datos existentes · Linux",
      updateMac: "Actualización con equipo y datos existentes · Mac",
      updateWindows: "Actualización con equipo y datos existentes · Windows",
      nonItRelevant: "Anuncios del oficio de la persona (al menos 70 %)",
      scoutBench:
        "Banco de los Scouts, 4 oficios fuera de la informática (≥70% pertinentes, 0 duplicados, ≥15 ofertas)",
      budgetBrake:
        "Freno del presupuesto: nunca por encima del tope, ningún desbloqueo falso, aviso a la persona",
      language: "Setup y onboarding en el idioma elegido",
      doctorMaintainer:
        "El Doctor y el Mantenedor, los agentes que cuidan del equipo, funcionan de verdad",
      serviceClaude: "Claude (Anthropic) · clave API",
      serviceOpenai: "OpenAI · clave API",
      serviceGlm: "Z.ai (GLM) · clave API",
      serviceKimi: "Kimi (Moonshot) · clave API",
      codexSubscription:
        "OpenAI Codex · suscripción (solo quien ya tiene la 0.3.x, como en nuestra prueba beta)",
      openaiSubscription: "OpenAI · suscripción ChatGPT en Pi",
      noKeyOnDisk: "Ninguna clave API queda escrita en el disco",
      betaTester: "Beta test: versión actualizada y equipo trabajando",
    },
    targetNotes: {
      updateMacBuild10:
        "build 10: configuración toda en portugués, clave guardada conservada, 1 anuncio nuevo (puntuación 74)",
      updateWindowsBuild10:
        "build 10: anuncios, perfil y clave conservados, todo en alemán; tras la actualización el Analista nunca arrancó (13 anuncios en espera)",
      languagePortugueseOk: "build 10: portugués de principio a fin en el Mac",
      notTried040:
        "no probado en la 0.4.0",
      updateLinuxBuild9:
        "build 9: superada (su ronda no está en la tabla de abajo)",
      installerBlockedBuild9:
        "build 9: parada por el instalador (corrección en la build 10, ronda en curso)",
      benchCook: "79 % pertinentes",
      benchWarehouse: "90 % pertinentes",
      benchNurse: "1 duplicado (94 % pertinentes)",
      benchBricklayer: "6 puestos, menos de 15 (83 % pertinentes)",
      brakeFixedRetry: "corregido en las builds 9 y 10: por volver a probar",
      languageGermanOk: "build 9: alemán de principio a fin en Linux",
      securityPreTag:
        "revisión antes del tag: el veredicto llega sobre la versión exacta del tag; el caso de la clave en disco está cerrado",
      cleanLinuxRoundMissing:
        "instalación desde cero en la build 6: su ronda no está en la tabla de abajo",
      openaiBuild6Redo:
        "probado solo en la build 6 (1,61 $, 10 minutos): por rehacer en la 0.4.0",
      redoOnBuild9: "por repetir en la build 9",
      diskFull: "disco lleno tras la actualización (corrección en curso)",
      neverTried: "nunca probado",
      relevantBelow: "0 nuevas para el albañil, 10 de 26 para la recepcionista",
      benchPaused: "en pausa hasta la build 9",
      brakeFalseClear:
        "desbloqueo falso tras la parada, el aviso a la persona falló",
      languageEnglish:
        "paso de la clave de API, arranque del equipo y estado en inglés (corregidos tras la build 8)",
      zeroTurns: "0 turnos (corregido en la build 9)",
      noCredit: "sin crédito para probarlos",
      loginNeverTried: "inicio de sesión real nunca probado",
      keysChecked:
        "0 archivos con clave fuera de su sitio, en 20.927 eventos de archivos",
      updateOnBuild9: "actualización en la build 9",
      updateMacBuild11:
        "build 11: anuncios, puntuaciones y clave conservados, espacio en disco recuperado, todo en portugués",
      updateWindowsBuild13:
        "build 13: la actualización con el chat abierto llega al final y el comando jht funciona, todo en francés",
      relevantBuild15:
        "build 15: 4 pertinentes de 10 para el perfil dependiente/a con un usuario nuevo de Windows (40%; otras 5 a tiempo parcial o de temporada); 4 de 5 para el electricista en el retest; 20 de 33 (61%) en la primera candidata. Por volver a probar con una instalación nueva",
      brakeDayQuota:
        "build 15: la parte del día y el ritmo detienen al equipo antes de cada presupuesto (1,38 $ de 2 en dos días; 1,04 $ de 1,5 en Windows); quedan defectos menores en los avisos y el estado",
      languageFrenchGermanOk:
        "builds 11-13: alemán y francés en todo el flujo; quedan pocas líneas en inglés (ayuda del comando)",
      languageItalianOk:
        "build 11: instalación y onboarding todo en italiano en Linux",
      doctorWorks:
        "builds 11-12: Doctor y Mantenedor hacen sus turnos sin errores y desbloquean a los agentes correctos",
    },
    invalidTitle: "Rondas que no cuentan",
    invalidLead:
      "Rondas rotas por causas nuestras (crédito agotado, una máquina de prueba que se apagó sola, un error de medida, intentos anulados del banco), no por defectos del producto. Quedan fuera de la tabla y de los gráficos; los defectos encontrados siguen en el gráfico de defectos.",
    invalidReasons: {
      noCreditMachineOff:
        "OpenAI sin crédito y la máquina de prueba se apagó sola: ningún Scout arrancó. A mitad de ronda se cambió el servicio a GLM.",
      cumulativeCap:
        "Nuestro tope de prueba de 3 $ era demasiado bajo y se leyó en un contador que incluía también la ronda anterior: parada a los 6 minutos, antes de ningún anuncio nuevo.",
      benchDailyBudget:
        "Intento del banco anulado: arrancó con un presupuesto diario alto que quedaba de antes, y el freno de ritmo lo paró a los 70 segundos.",
      benchOpenRun:
        "Intento del banco anulado: la primera búsqueda de la build anterior seguía abierta.",
      creditEndedNoPositions:
        "El crédito GLM de la cuenta de prueba se agotó antes de cualquier anuncio: 0 anuncios.",
      benchCancelled: "Intento del banco anulado y reiniciado desde cero.",
    },
    targetSections: {
      install: "Instalación por un usuario nuevo",
      update: "Actualización con equipo y datos",
      scout:
        "Banco de Scouts: ¿encuentra el Scout anuncios del oficio correcto?",
      brake: "Criterios de las últimas pruebas (build 15).",
      language: "Idioma",
      doctor: "Doctor y Mantenedor",
      services: "Servicios",
      security: "Seguridad",
      beta: "Prueba beta",
      realUser:
        "Ronda completa como usuario real, con un oficio fuera de la informática",
    },
    targetCriteria: {
      relevant: "pertinentes {v} % (≥{min} %)",
      duplicates: "duplicados {v}",
      positions: "anuncios {v} (≥{min})",
      newPositions: "{trade}: {v} nuevos",
      relevantOf: "{trade}: {v} pertinentes de {of}",
      underCeiling: "gastados {v} de {max} $",
      noFalseUnlock: "ningún desbloqueo falso",
    },
    targetRules: {
      scout:
        "Solo la búsqueda de los Scouts, en un servidor ya configurado, con cuatro oficios fuera de la informática. Un oficio pasa si los 3 criterios están en verde: al menos 70 % pertinentes, 0 duplicados, al menos 15 anuncios.",
      brake:
        "Criterios de la última prueba (build 8); corregido después, por volver a probar.",
      realUser:
        "Una persona instala el programa desde cero, responde a la configuración y deja trabajar al equipo solo durante 30 minutos. Pasa si al menos el 70 % de los anuncios encontrados son de su oficio.",
    },
    targetTried: "probado en la build {n}",
    targetRows: {
      install: "Primera instalación en un ordenador sin el programa",
      update:
        "Actualización de un ordenador que ya tiene un equipo y sus datos",
      language: "Configuración y onboarding en el idioma elegido",
    },
    buildsTitle: "Rondas de cada build",
    buildLabel: "Build {n}",
    previousBuild: "build anterior",
    paceNote:
      "Las rondas hacen trabajar al equipo minutos u horas, no los días que un presupuesto debe cubrir: el coste queda comprimido en poco tiempo y no dice cuánto dura un presupuesto en el uso diario. Solo la ronda r33 cubre dos días, con el ritmo apagado y el presupuesto dividido por día.",
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
    lead: "Ce que l'équipe a dépensé et trouvé lors des tours d'essai du 14 au 21 novembre 2026, avec les services à clé API que propose le harness 0.4.0. Les chiffres viennent des procès-verbaux d'essai et des échantillonneurs de coûts.",
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
      "« Pertinentes » = postes dont l'intitulé correspond au métier, vérifiés par échantillon ; un tiret = non jugé. « Build précédente » = tour antérieur aux builds numérotées de la 0.4.0 : il ne prouve pas la 0.4.0.",
    chartTitle: "Ce que coûte un poste évalué",
    chartLead:
      "Dollars dépensés pour chaque poste évalué par l'équipe. Plus court, c'est mieux. Les tours sans poste évalué n'ont pas de barre.",
    chartNone: "aucune évaluée",
    chartCaveat:
      "Les deux tours du Mac ont duré 6 et 10 minutes avec une équipe minimale, et le coût est presque tout onboarding et Capitaine : pas comparables avec des tours de 16-42 minutes.",
    servicesTitle: "Services : ce que nous avons vu dans les tours",
    servicesCols: {
      service: "Service",
      seen: "Vu dans les tours",
      rate: "Rythme observé",
    },
    servicesCaveat:
      "Seulement ce que les tours ont mesuré ; un tiret = jamais essayé. Ces chiffres viennent de tours sur des builds antérieures aux builds numérotées de la 0.4.0 (r1–r8) : ils disent ce que coûte un service, pas comment se comporte la 0.4.0. Claude sous Windows a dépensé 5,28 $ : Capitaine et Scorer en pèsent 3,05 $.",
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
      "Profils fictifs, aucune donnée personnelle · chiffres des procès-verbaux d'essai du 14-21/11/2026.",
    marks:
      "Les logos indiquent seulement le service utilisé par un essai et n'impliquent aucune approbation. Les marques et les logos appartiennent à leurs propriétaires respectifs.",
    outcome: {
      pass: "réussi",
      reservations: "avec réserves",
      fail: "échec",
      unjudged: "non jugé",
      running: "en cours",
    },
    system: {
      pass: "réussit",
      withReservations: "réussit avec réserves",
      running: "en cours",
    },
    profiles: {
      bricklayer: "Maçon",
      warehouseWorker: "Magasinier",
      officeClerk: "Employée administrative à temps partiel",
      dataAnalyst: "Data analyst",
      generic: "Profil d'essai générique",
      restorer: "Restauratrice",
      waiter: "Serveur",
      receptionist: "Réceptionniste",
      truckDriver: "Chauffeur routier",
      electrician: "Électricien",
      shopAssistant: "Vendeur/vendeuse",
      careAssistant: "Aide-soignante",
    },
    modes: { onsite: "sur site", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI (crédit épuisé), puis GLM",
    },
    notes: {
      updateBuild10Portuguese:
        "Mise à jour sur la build 10, tout en portugais : clé enregistrée gardée, la file est repartie seule, 1 nouvelle annonce (74) ; le frein de rythme a mis l'équipe en pause et l'a dit à la personne.",
      updateWindowsBuild9to10:
        "Build 9 installée de zéro, tout en allemand : 25 annonces d'entrepôt en un quart d'heure ; mise à jour vers la build 10 avec annonces, profil et clé gardés, puis l'Analyste n'a jamais démarré et 13 annonces sont restées en attente.",
      updateSwitchKept:
        "Mise à jour avec l'équipe en marche : données gardées, anciennes images retirées, GLM → Claude sans arrêter l'équipe. 3 pertinentes sur 26 nouvelles en 10 minutes.",
      updateWelcomePaid:
        "Mise à jour et passage à Claude : 15 pertinentes sur 18 en 12 minutes. L'accueil a été payé de nouveau à chaque redémarrage.",
      cleanInstallWarehouse:
        "Nouvel utilisateur, onboarding guidé : le frein s'est arrêté à 2,67 $. Presque que de l'entrepôt : 2 pertinentes sur 19.",
      updateNoNewPositions:
        "Mise à jour réussie et aucun fichier avec clé sur le disque, mais 0 offre nouvelle en 30 minutes : seuls 2 Scouts réveillés.",
      diskLowAfterUpdate:
        "Mise à jour réussie, équipe jamais démarrée : 4 Gio libres sur les 8 nécessaires, sans avertissement avant le téléchargement.",
      cleanInstallGerman:
        "Nouvel utilisateur en allemand : 10 pertinentes sur 26. Le frein s'est arrêté à 4,77 $, puis un faux déblocage (4,95 $ à la fin) ; Docteur et Mainteneur sans tour.",
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
      updateWindowsBuild11:
        "Mise à jour de la build 10 à la 11, tout en allemand : équipe et données gardées, l'Analyste redémarre seul ; 5 pertinentes sur 7 nouvelles.",
      installLinuxBuild11:
        "Installation de zéro et onboarding guidé tout en italien, clé gardée : 14 pertinentes sur 18. La garde mémoire retire les Scouts sans le dire à la personne, et ils ne reviennent pas.",
      updateMacBuild11:
        "Mise à jour de la build 10 à la 11 en portugais : annonces, scores et clé gardés, espace disque revenu ; le budget de la période est épuisé avant que les 6 nouvelles soient notées.",
      updateLinuxBuild12b:
        "Mise à jour vers la première version de la build 12 : équipe et données gardées ; le Docteur est lancé pendant la pause de rythme, et la reprise ensuite dépense la marge en quelques secondes.",
      updateMacBuild12b:
        "Mise à jour vers la première version de la build 12 : 6 pertinentes sur 11 nouvelles, meilleur score 89 ; le setup dit que la configuration a échoué alors que l'équipe démarre seule.",
      updateWindowsBuild12c:
        "Mise à jour vers la build 12 avec le chat de l'Assistant ouvert, tout en français : elle s'arrête à mi-chemin et la commande jht ne marche plus tant qu'on ne relance pas l'installateur.",
      updateLinuxBuild12d:
        "Mise à jour vers la dernière version de la build 12 : équipe et données gardées ; la reprise après la pause de rythme travaille 275 secondes au lieu d'environ 80, et les rôles de service ne sont pas réveillés.",
      updateMacBuild12d:
        "Mise à jour vers la dernière version de la build 12 : équipe et données gardées, le faux avis de setup échoué a disparu ; 12 nouvelles annonces, pas encore notées dans la fenêtre.",
      updateLinuxBuild13:
        "Mise à jour vers la build 13 : équipe et données gardées ; les enrichissements tournent sur chaque annonce vérifiée mais ne donnent ni coordonnées ni logos ; 0,0085 $ par annonce analysée.",
      updateWindowsBuild13:
        "Nouvel essai de la mise à jour avec le chat ouvert : elle va au bout et la commande jht marche ; le chat se ferme toutefois encore sur une ligne brute.",
      candidateLinux:
        "Mise à jour vers la candidate de la version, équipe et données gardées : le premier plafond de dépense tient, le second est dépassé de 13 % après une reprise ; 20 pertinentes sur 33 nouvelles (61 %, il en faut 70 %).",
      retestBrake:
        "Nouvel essai du frein sur une image de test construite sur la candidate : le plafond tient les deux fois (0,36 sur 1 $ et 1,92 sur 3 $) ; après le déblocage d'un nouveau budget, le rythme laisse passer 0,86 $ au-dessus de sa ligne.",
      retestPace:
        "Nouvel essai du réveil par paliers après la pause de rythme : les paliers marchent et la période ne dépasse jamais sa ligne ni son plafond (2,55 sur 3 $) ; deux autres canaux réveillent encore ceux qui attendent.",
      retestFull:
        "Nouvel essai complet : ligne et plafond jamais dépassés (2,55 sur 3 $), mais ceux qui attendent leur palier travaillent quand même et la première pause arrive 48 secondes après le déblocage ; 1 pertinente sur 15, toutes d'un seul portail d'agence.",
      retestReserve:
        "Nouvel essai complet, arrêté plus tôt : les paliers marchent, mais la réserve estimée du redémarrage arrête l'équipe 10 à 20 secondes après chaque palier ; aucune nouvelle annonce.",
      retestResumes:
        "Nouvel essai, arrêté plus tôt : le déblocage travaille maintenant dix minutes avant la première pause, mais les deux reprises s'arrêtent dans la première minute, et après la mise à jour le Capitaine réveille les sept travailleurs hors des paliers.",
      retestDayQuota:
        "Retest du budget réparti par jour, sur deux jours (41 h) avec le rythme éteint : l'équipe travaille jusqu'à la part du jour, s'arrête avec un seul avis et reprend toute seule le lendemain (1,38 $ sur 2, jamais au-dessus d'une part). 4 défauts mineurs ; 4 pertinentes sur 5 nouvelles.",
      candidateWindowsSpanish:
        "Candidate sur un nouvel utilisateur Windows, tout en espagnol : 4 pertinentes sur 10 en 5 minutes (5 autres du bon métier, mais à temps partiel ou saisonnières) ; le frein du rythme s'arrête à 1,01 sur 1,5 $. Ouverts : aide vide depuis l'hôte, Scout arrêté après sa première passe.",
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
    targetsLead:
      "La 0.4.0 ne sort que si toutes les lignes sont vertes. Mis à jour à chaque build ; la preuve mène au tour ci-dessous.",
    targetsCount: "{g} sur {n} au vert",
    targetsCols: {
      target: "Objectif",
      status: "État",
      build: "Build",
      proof: "Preuve",
    },
    targetStatus: {
      pass: "atteint",
      fail: "non atteint",
      pending: "à essayer",
      blocked: "bloqué",
    },
    targets: {
      scoutBenchCook: "Cuisinier",
      scoutBenchWarehouse: "Magasinier",
      scoutBenchNurse: "Infirmière",
      scoutBenchBricklayer: "Maçon",
      languageWindows:
        "Configuration et onboarding dans la langue choisie · Windows",
      languageLinux:
        "Configuration et onboarding dans la langue choisie · Linux",
      languageMac: "Configuration et onboarding dans la langue choisie · Mac",
      preTagReview: "Revue de sécurité avant le tag",
      installWindows: "Installation par un nouvel utilisateur · Windows",
      installLinux: "Installation par un nouvel utilisateur · Linux",
      installMac: "Installation par un nouvel utilisateur · Mac",
      updateLinux: "Mise à jour avec équipe et données existantes · Linux",
      updateMac: "Mise à jour avec équipe et données existantes · Mac",
      updateWindows: "Mise à jour avec équipe et données existantes · Windows",
      nonItRelevant: "Annonces du métier de la personne (au moins 70 %)",
      scoutBench:
        "Banc des Scouts, 4 métiers hors informatique (≥70 % pertinentes, 0 doublon, ≥15 offres)",
      budgetBrake:
        "Frein du budget : jamais au-dessus du plafond, aucun faux déblocage, la personne est prévenue",
      language: "Setup et onboarding dans la langue choisie",
      doctorMaintainer:
        "Le Docteur et le Mainteneur, les agents qui veillent sur l'équipe, fonctionnent vraiment",
      serviceClaude: "Claude (Anthropic) · clé API",
      serviceOpenai: "OpenAI · clé API",
      serviceGlm: "Z.ai (GLM) · clé API",
      serviceKimi: "Kimi (Moonshot) · clé API",
      codexSubscription:
        "OpenAI Codex · abonnement (seulement pour qui a déjà la 0.3.x, comme dans notre test bêta)",
      openaiSubscription: "OpenAI · abonnement ChatGPT sur Pi",
      noKeyOnDisk: "Aucune clé API ne reste écrite sur le disque",
      betaTester: "Bêta-test : version mise à jour et équipe au travail",
    },
    targetNotes: {
      updateMacBuild10:
        "build 10 : configuration tout en portugais, clé enregistrée gardée, 1 nouvelle annonce (score 74)",
      updateWindowsBuild10:
        "build 10 : annonces, profil et clé gardés, tout en allemand ; après la mise à jour l'Analyste n'a jamais démarré (13 annonces en attente)",
      languagePortugueseOk: "build 10 : portugais du début à la fin sur le Mac",
      notTried040:
        "non essayé sur la 0.4.0",
      updateLinuxBuild9:
        "build 9 : réussi (son tour n'est pas dans le tableau ci-dessous)",
      installerBlockedBuild9:
        "build 9 : arrêté par l'installeur (correction dans la build 10, tour en cours)",
      benchCook: "79 % pertinents",
      benchWarehouse: "90 % pertinents",
      benchNurse: "1 doublon (94 % pertinents)",
      benchBricklayer: "6 postes, moins de 15 (83 % pertinents)",
      brakeFixedRetry: "corrigé dans les builds 9 et 10 : à réessayer",
      languageGermanOk: "build 9 : allemand du début à la fin sous Linux",
      securityPreTag:
        "revue avant le tag : le verdict porte sur la version exacte du tag ; le cas de la clé sur disque est clos",
      cleanLinuxRoundMissing:
        "installation vierge sur la build 6 : son tour n'est pas dans le tableau ci-dessous",
      openaiBuild6Redo:
        "essayé seulement sur la build 6 (1,61 $, 10 minutes) : à refaire sur la 0.4.0",
      redoOnBuild9: "à refaire sur la build 9",
      diskFull: "disque plein après la mise à jour (correction en cours)",
      neverTried: "jamais essayé",
      relevantBelow:
        "0 nouvelle pour le maçon, 10 sur 26 pour la réceptionniste",
      benchPaused: "en pause jusqu'à la build 9",
      brakeFalseClear:
        "faux déblocage après l'arrêt, l'avertissement à la personne a échoué",
      languageEnglish:
        "étape de la clé API, démarrage de l'équipe et état en anglais (corrigés après la build 8)",
      zeroTurns: "0 tour (corrigé dans la build 9)",
      noCredit: "pas de crédit pour les essayer",
      loginNeverTried: "vraie connexion jamais essayée",
      keysChecked:
        "0 fichier avec clé hors de sa place, sur 20 927 événements de fichiers",
      updateOnBuild9: "mise à jour sur la build 9",
      updateMacBuild11:
        "build 11 : annonces, scores et clé gardés, espace disque revenu, tout en portugais",
      updateWindowsBuild13:
        "build 13 : la mise à jour avec le chat ouvert va au bout et la commande jht marche, tout en français",
      relevantBuild15:
        "build 15 : 4 pertinentes sur 10 pour le profil vendeur/vendeuse sur un nouvel utilisateur Windows (40 % ; 5 autres à temps partiel ou saisonnières) ; 4 sur 5 pour l'électricien au retest ; 20 sur 33 (61 %) sur la première candidate. À refaire sur une nouvelle installation",
      brakeDayQuota:
        "build 15 : la part du jour et le rythme arrêtent l'équipe avant chaque budget (1,38 $ sur 2 en deux jours ; 1,04 $ sur 1,5 sous Windows) ; défauts mineurs restants dans les avis et le statut",
      languageFrenchGermanOk:
        "builds 11-13 : allemand et français dans tout le parcours ; quelques lignes encore en anglais (aide de la commande)",
      languageItalianOk:
        "build 11 : installation et onboarding tout en italien sous Linux",
      doctorWorks:
        "builds 11-12 : Docteur et Mainteneur font leurs tours sans erreur et débloquent les bons agents",
    },
    invalidTitle: "Tours qui ne comptent pas",
    invalidLead:
      "Tours cassés par des causes de notre côté (crédit épuisé, une machine de test qui s'est éteinte seule, une erreur de mesure, essais annulés du banc), pas par des défauts du produit. Ils sont exclus du tableau et des graphiques ; leurs défauts restent dans le graphique des défauts.",
    invalidReasons: {
      noCreditMachineOff:
        "OpenAI sans crédit et la machine de test s'est éteinte seule : aucun Scout n'a démarré. Le service a été changé pour GLM au milieu du tour.",
      cumulativeCap:
        "Notre plafond de test de 3 $ était trop bas et a été lu sur un compteur qui contenait aussi le tour précédent : arrêté après 6 minutes, avant toute nouvelle annonce.",
      benchDailyBudget:
        "Essai du banc annulé : il a démarré avec un budget quotidien élevé resté d'avant, et le frein de rythme l'a arrêté après 70 secondes.",
      benchOpenRun:
        "Essai du banc annulé : la première recherche de la build précédente était encore ouverte.",
      creditEndedNoPositions:
        "Le crédit GLM du compte de test s'est épuisé avant toute annonce : 0 annonce.",
      benchCancelled: "Essai du banc annulé et repris de zéro.",
    },
    targetSections: {
      install: "Installation par un nouvel utilisateur",
      update: "Mise à jour avec équipe et données",
      scout:
        "Banc des Scouts : le Scout trouve-t-il des annonces du bon métier ?",
      brake: "Critères des derniers essais (build 15).",
      language: "Langue",
      doctor: "Docteur et Mainteneur",
      services: "Services",
      security: "Sécurité",
      beta: "Test bêta",
      realUser:
        "Tour complet en vrai utilisateur, avec un métier hors informatique",
    },
    targetCriteria: {
      relevant: "pertinents {v} % (≥{min} %)",
      duplicates: "doublons {v}",
      positions: "annonces {v} (≥{min})",
      newPositions: "{trade} : {v} nouveaux",
      relevantOf: "{trade} : {v} pertinents sur {of}",
      underCeiling: "dépensé {v} sur {max} $",
      noFalseUnlock: "aucun faux déblocage",
    },
    targetRules: {
      scout:
        "Seulement la recherche des Scouts, sur un serveur déjà configuré, avec quatre métiers hors informatique. Un métier passe si les 3 critères sont verts : au moins 70 % pertinents, 0 doublon, au moins 15 annonces.",
      brake:
        "Critères du dernier essai (build 8) ; corrigé depuis, à réessayer.",
      realUser:
        "Une personne installe le programme à partir de zéro, répond à la configuration et laisse l'équipe travailler seule pendant 30 minutes. C'est réussi si au moins 70 % des annonces trouvées sont de son métier.",
    },
    targetTried: "essayé sur la build {n}",
    targetRows: {
      install: "Première installation sur un ordinateur sans le programme",
      update:
        "Mise à jour d'un ordinateur qui a déjà une équipe et ses données",
      language: "Configuration et onboarding dans la langue choisie",
    },
    buildsTitle: "Tours de chaque build",
    buildLabel: "Build {n}",
    previousBuild: "build précédente",
    paceNote:
      "Les tours font travailler l'équipe pendant des minutes ou des heures, pas pendant les jours qu'un budget doit couvrir : le coût est comprimé dans un temps court et ne dit pas combien de temps dure un budget à l'usage de tous les jours. Seul le tour r33 couvre deux jours, avec le rythme éteint et le budget réparti par jour.",
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
    lead: "O que a equipa gastou e encontrou nas rondas de teste de 14 a 21 de novembro de 2026, com os serviços de chave API que o harness 0.4.0 oferece. Os números vêm dos relatórios dos testes e dos amostradores de custo.",
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
      "«Pertinentes» = posições cujo título corresponde ao ofício, verificadas por amostragem; um traço = não avaliado. «Build anterior» = ronda anterior às builds numeradas da 0.4.0: não prova a 0.4.0.",
    chartTitle: "Quanto custa uma posição avaliada",
    chartLead:
      "Dólares gastos por cada posição avaliada pela equipa. Mais curta é melhor. As rondas sem posições avaliadas não têm barra.",
    chartNone: "nenhuma avaliada",
    chartCaveat:
      "As duas rondas do Mac duraram 6 e 10 minutos com uma equipa mínima, e o custo é quase todo onboarding e Capitano: não são comparáveis com rondas de 16-42 minutos.",
    servicesTitle: "Serviços: o que vimos nas rondas",
    servicesCols: {
      service: "Serviço",
      seen: "Visto nas rondas",
      rate: "Ritmo visto",
    },
    servicesCaveat:
      "Só o que as rondas mediram; um traço = nunca testado. Estes números vêm de rondas em builds anteriores às numeradas da 0.4.0 (r1–r8): dizem quanto custa um serviço, não como se comporta a 0.4.0. O Claude no Windows gastou 5,28 $: Capitano e Scorer pesam 3,05 $.",
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
      "Perfis fictícios, sem dados pessoais · números dos relatórios de teste de 14-21/11/2026.",
    marks:
      "Os logótipos indicam só o serviço usado num teste e não implicam qualquer aprovação. As marcas e os logótipos pertencem aos respetivos proprietários.",
    outcome: {
      pass: "passa",
      reservations: "com reservas",
      fail: "falha",
      unjudged: "não avaliado",
      running: "em curso",
    },
    system: {
      pass: "passa",
      withReservations: "passa com reservas",
      running: "em curso",
    },
    profiles: {
      bricklayer: "Pedreiro",
      warehouseWorker: "Operador de armazém",
      officeClerk: "Administrativa a tempo parcial",
      dataAnalyst: "Analista de dados",
      generic: "Perfil de teste genérico",
      restorer: "Restauradora",
      waiter: "Empregado de mesa",
      receptionist: "Rececionista",
      truckDriver: "Motorista de pesados",
      electrician: "Eletricista",
      shopAssistant: "Empregado/a de loja",
      careAssistant: "Auxiliar de saúde",
    },
    modes: { onsite: "presencial", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI (crédito esgotado), depois GLM",
    },
    notes: {
      updateBuild10Portuguese:
        "Atualização na build 10, tudo em português: chave guardada mantida, a fila recomeçou sozinha, 1 anúncio novo (74); o travão de ritmo pôs a equipa em pausa e disse-o à pessoa.",
      updateWindowsBuild9to10:
        "Build 9 instalada de raiz, tudo em alemão: 25 anúncios de armazém num quarto de hora; atualizada para a build 10 com anúncios, perfil e chave mantidos, depois o Analista nunca arrancou e 13 anúncios ficaram à espera.",
      updateSwitchKept:
        "Atualização com a equipa a correr: dados mantidos, imagens antigas retiradas, GLM → Claude sem parar a equipa. 3 pertinentes de 26 novas em 10 minutos.",
      updateWelcomePaid:
        "Atualização e passagem para o Claude: 15 pertinentes de 18 em 12 minutos. As boas-vindas foram pagas de novo a cada reinício.",
      cleanInstallWarehouse:
        "Utilizador novo, onboarding guiado: o travão parou em 2,67 $. Quase só armazém: 2 pertinentes de 19.",
      updateNoNewPositions:
        "Atualização bem-sucedida e nenhum ficheiro com chave no disco, mas 0 vagas novas em 30 minutos: só 2 Scouts acordados.",
      diskLowAfterUpdate:
        "Atualização bem-sucedida, a equipa nunca arrancou: 4 GiB livres dos 8 necessários, sem aviso antes da transferência.",
      cleanInstallGerman:
        "Utilizador novo em alemão: 10 pertinentes de 26. O travão parou em 4,77 $, depois um falso desbloqueio (4,95 $ no fim); Doutor e Mantenedor sem turnos.",
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
      updateWindowsBuild11:
        "Atualização da build 10 para a 11, tudo em alemão: equipa e dados mantidos, o Analista volta a arrancar sozinho; 5 pertinentes de 7 novas.",
      installLinuxBuild11:
        "Instalação de raiz e onboarding guiado tudo em italiano, chave mantida: 14 pertinentes de 18. A guarda da memória retira os Scouts sem o dizer à pessoa, e eles não voltam.",
      updateMacBuild11:
        "Atualização da build 10 para a 11 em português: anúncios, pontuações e chave mantidos, espaço em disco de volta; o orçamento do período acaba antes de as 6 novas terem pontuação.",
      updateLinuxBuild12b:
        "Atualização para a primeira versão da build 12: equipa e dados mantidos; o Doutor é iniciado durante a pausa de ritmo, e a retoma a seguir gasta a margem em segundos.",
      updateMacBuild12b:
        "Atualização para a primeira versão da build 12: 6 pertinentes de 11 novas, melhor pontuação 89; o setup diz que a configuração falhou enquanto a equipa arranca sozinha.",
      updateWindowsBuild12c:
        "Atualização para a build 12 com o chat do Assistente aberto, tudo em francês: para a meio e o comando jht não funciona até se voltar a correr o instalador.",
      updateLinuxBuild12d:
        "Atualização para a última versão da build 12: equipa e dados mantidos; a retoma depois da pausa de ritmo trabalha 275 segundos em vez de cerca de 80, e os papéis de serviço não são acordados.",
      updateMacBuild12d:
        "Atualização para a última versão da build 12: equipa e dados mantidos, desapareceu o falso aviso de setup falhado; 12 anúncios novos, ainda sem pontuação na janela.",
      updateLinuxBuild13:
        "Atualização para a build 13: equipa e dados mantidos; os enriquecimentos correm em cada anúncio verificado mas não dão coordenadas nem logótipos; 0,0085 $ por anúncio analisado.",
      updateWindowsBuild13:
        "Novo teste da atualização com o chat aberto: chega ao fim e o comando jht funciona; o chat, porém, ainda fecha com uma linha em bruto.",
      candidateLinux:
        "Atualização para a candidata da versão, equipa e dados mantidos: o primeiro teto de gasto aguenta, o segundo é ultrapassado em 13% depois de uma retoma; 20 pertinentes de 33 novas (61%, são precisos 70%).",
      retestBrake:
        "Novo teste do travão numa imagem de teste construída sobre a candidata: o teto aguenta as duas vezes (0,36 de 1 $ e 1,92 de 3 $); depois do desbloqueio de um orçamento novo, o ritmo deixa passar 0,86 $ acima da sua linha.",
      retestPace:
        "Novo teste do despertar por escalões depois da pausa de ritmo: os escalões funcionam e o período nunca passa a linha nem o teto (2,55 de 3 $); outros dois canais ainda acordam quem está à espera.",
      retestFull:
        "Novo teste completo: linha e teto nunca ultrapassados (2,55 de 3 $), mas quem espera o seu escalão trabalha na mesma e a primeira pausa chega 48 segundos depois do desbloqueio; 1 pertinente de 15, todas de um só portal de agência.",
      retestReserve:
        "Novo teste completo, fechado mais cedo: os escalões funcionam, mas a reserva estimada do reinício para a equipa 10-20 segundos depois de cada escalão; nenhum anúncio novo.",
      retestResumes:
        "Novo teste, fechado mais cedo: o desbloqueio já trabalha dez minutos antes da primeira pausa, mas as duas retomas param no primeiro minuto, e depois da atualização o Capitão acorda os sete trabalhadores fora dos escalões.",
      retestDayQuota:
        "Reteste do orçamento dividido por dia, durante dois dias (41 h) com o ritmo desligado: a equipa trabalha até à parte do dia, para com um único aviso e retoma sozinha no dia seguinte (1,38 $ de 2, nunca acima de uma parte). 4 defeitos menores; 4 pertinentes de 5 novas.",
      candidateWindowsSpanish:
        "Candidata com um utilizador novo do Windows, tudo em espanhol: 4 pertinentes de 10 em 5 minutos (outras 5 do ofício certo, mas a tempo parcial ou sazonais); o travão do ritmo para em 1,01 de 1,5 $. Em aberto: ajuda vazia a partir do host, Scout parado depois da primeira passagem.",
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
    targetsLead:
      "A 0.4.0 só é lançada com todas as linhas a verde. Atualizado a cada build; a prova leva à ronda mais abaixo.",
    targetsCount: "{g} de {n} a verde",
    targetsCols: {
      target: "Objetivo",
      status: "Estado",
      build: "Build",
      proof: "Prova",
    },
    targetStatus: {
      pass: "cumprido",
      fail: "não cumprido",
      pending: "por testar",
      blocked: "bloqueado",
    },
    targets: {
      scoutBenchCook: "Cozinheiro",
      scoutBenchWarehouse: "Operador de armazém",
      scoutBenchNurse: "Enfermeira",
      scoutBenchBricklayer: "Pedreiro",
      languageWindows:
        "Configuração e onboarding na língua escolhida · Windows",
      languageLinux: "Configuração e onboarding na língua escolhida · Linux",
      languageMac: "Configuração e onboarding na língua escolhida · Mac",
      preTagReview: "Revisão de segurança antes da tag",
      installWindows: "Instalação por um utilizador novo · Windows",
      installLinux: "Instalação por um utilizador novo · Linux",
      installMac: "Instalação por um utilizador novo · Mac",
      updateLinux: "Atualização com equipa e dados existentes · Linux",
      updateMac: "Atualização com equipa e dados existentes · Mac",
      updateWindows: "Atualização com equipa e dados existentes · Windows",
      nonItRelevant: "Anúncios do ofício da pessoa (pelo menos 70%)",
      scoutBench:
        "Banco dos Scouts, 4 profissões fora da informática (≥70% pertinentes, 0 duplicados, ≥15 vagas)",
      budgetBrake:
        "Travão do orçamento: nunca acima do teto, nenhum falso desbloqueio, aviso à pessoa",
      language: "Setup e onboarding na língua escolhida",
      doctorMaintainer:
        "O Doutor e o Mantenedor, os agentes que cuidam da equipa, funcionam mesmo",
      serviceClaude: "Claude (Anthropic) · chave API",
      serviceOpenai: "OpenAI · chave API",
      serviceGlm: "Z.ai (GLM) · chave API",
      serviceKimi: "Kimi (Moonshot) · chave API",
      codexSubscription:
        "OpenAI Codex · assinatura (só quem já tem a 0.3.x, como no nosso teste beta)",
      openaiSubscription: "OpenAI · assinatura ChatGPT no Pi",
      noKeyOnDisk: "Nenhuma chave API fica escrita no disco",
      betaTester: "Beta teste: versão atualizada e equipa a trabalhar",
    },
    targetNotes: {
      updateMacBuild10:
        "build 10: configuração toda em português, chave guardada mantida, 1 anúncio novo (pontuação 74)",
      updateWindowsBuild10:
        "build 10: anúncios, perfil e chave mantidos, tudo em alemão; depois da atualização o Analista nunca arrancou (13 anúncios à espera)",
      languagePortugueseOk: "build 10: português do início ao fim no Mac",
      notTried040:
        "não testado na 0.4.0",
      updateLinuxBuild9:
        "build 9: aprovado (a rodada não está na tabela abaixo)",
      installerBlockedBuild9:
        "build 9: parado pelo instalador (correção na build 10, rodada em curso)",
      benchCook: "79% pertinentes",
      benchWarehouse: "90% pertinentes",
      benchNurse: "1 duplicado (94% pertinentes)",
      benchBricklayer: "6 vagas, menos de 15 (83% pertinentes)",
      brakeFixedRetry: "corrigido nas builds 9 e 10: a voltar a testar",
      languageGermanOk: "build 9: alemão do início ao fim no Linux",
      securityPreTag:
        "revisão antes da tag: o veredicto chega sobre a versão exata da tag; o caso da chave no disco está fechado",
      cleanLinuxRoundMissing:
        "instalação de raiz na build 6: a sua ronda não está na tabela abaixo",
      openaiBuild6Redo:
        "testado só na build 6 (1,61 $, 10 minutos): a refazer na 0.4.0",
      redoOnBuild9: "a repetir na build 9",
      diskFull: "disco cheio após a atualização (correção em curso)",
      neverTried: "nunca testado",
      relevantBelow: "0 novas para o pedreiro, 10 de 26 para a rececionista",
      benchPaused: "em pausa até à build 9",
      brakeFalseClear:
        "falso desbloqueio após a paragem, o aviso à pessoa falhou",
      languageEnglish:
        "passo da chave de API, arranque da equipa e estado em inglês (corrigidos após a build 8)",
      zeroTurns: "0 turnos (corrigido na build 9)",
      noCredit: "sem crédito para os testar",
      loginNeverTried: "início de sessão real nunca testado",
      keysChecked:
        "0 ficheiros com chave fora do lugar, em 20 927 eventos de ficheiros",
      updateOnBuild9: "atualização na build 9",
      updateMacBuild11:
        "build 11: anúncios, pontuações e chave mantidos, espaço em disco de volta, tudo em português",
      updateWindowsBuild13:
        "build 13: a atualização com o chat aberto chega ao fim e o comando jht funciona, tudo em francês",
      relevantBuild15:
        "build 15: 4 pertinentes de 10 para o perfil empregado/a de loja com um utilizador novo do Windows (40%; outras 5 a tempo parcial ou sazonais); 4 de 5 para o eletricista no reteste; 20 de 33 (61%) na primeira candidata. A testar de novo numa instalação nova",
      brakeDayQuota:
        "build 15: a parte do dia e o ritmo param a equipa antes de cada orçamento (1,38 $ de 2 em dois dias; 1,04 $ de 1,5 no Windows); restam defeitos menores nos avisos e no estado",
      languageFrenchGermanOk:
        "builds 11-13: alemão e francês em todo o fluxo; ficam poucas linhas em inglês (ajuda do comando)",
      languageItalianOk:
        "build 11: instalação e onboarding tudo em italiano no Linux",
      doctorWorks:
        "builds 11-12: Doutor e Mantenedor fazem os seus turnos sem erros e desbloqueiam os agentes certos",
    },
    invalidTitle: "Rodadas que não contam",
    invalidLead:
      "Rodadas partidas por causas nossas (crédito esgotado, uma máquina de teste que se desligou sozinha, um erro de medição, tentativas anuladas da bancada), não por defeitos do produto. Ficam fora da tabela e dos gráficos; os defeitos encontrados ficam no gráfico dos defeitos.",
    invalidReasons: {
      noCreditMachineOff:
        "OpenAI sem crédito e a máquina de teste desligou-se sozinha: nenhum Scout arrancou. A meio da rodada o serviço foi mudado para GLM.",
      cumulativeCap:
        "O nosso teto de teste de 3 $ era baixo demais e foi lido num contador que incluía também a rodada anterior: parada aos 6 minutos, antes de qualquer anúncio novo.",
      benchDailyBudget:
        "Tentativa da bancada anulada: arrancou com um orçamento diário alto que vinha de antes, e o travão de ritmo parou-a aos 70 segundos.",
      benchOpenRun:
        "Tentativa da bancada anulada: a primeira pesquisa da build anterior ainda estava aberta.",
      creditEndedNoPositions:
        "O crédito GLM da conta de teste esgotou-se antes de qualquer anúncio: 0 anúncios.",
      benchCancelled: "Tentativa da bancada anulada e recomeçada do zero.",
    },
    targetSections: {
      install: "Instalação por um utilizador novo",
      update: "Atualização com equipa e dados",
      scout: "Bancada de Scouts: o Scout encontra anúncios do ofício certo?",
      brake: "Critérios das últimas tentativas (build 15).",
      language: "Língua",
      doctor: "Doutor e Mantenedor",
      services: "Serviços",
      security: "Segurança",
      beta: "Teste beta",
      realUser:
        "Rodada completa como utilizador real, com um ofício fora da informática",
    },
    targetCriteria: {
      relevant: "pertinentes {v}% (≥{min}%)",
      duplicates: "duplicados {v}",
      positions: "anúncios {v} (≥{min})",
      newPositions: "{trade}: {v} novos",
      relevantOf: "{trade}: {v} pertinentes de {of}",
      underCeiling: "gastos {v} de {max} $",
      noFalseUnlock: "nenhum desbloqueio falso",
    },
    targetRules: {
      scout:
        "Só a pesquisa dos Scouts, num servidor já configurado, com quatro ofícios fora da informática. Um ofício passa se os 3 critérios estiverem verdes: pelo menos 70% pertinentes, 0 duplicados, pelo menos 15 anúncios.",
      brake:
        "Critérios da última tentativa (build 8); corrigido depois, a voltar a testar.",
      realUser:
        "Uma pessoa instala o programa do zero, responde à configuração e deixa a equipa trabalhar sozinha durante 30 minutos. Passa se pelo menos 70% dos anúncios encontrados forem do seu ofício.",
    },
    targetTried: "testado na build {n}",
    targetRows: {
      install: "Primeira instalação num computador sem o programa",
      update:
        "Atualização de um computador que já tem uma equipa e os seus dados",
      language: "Configuração e onboarding na língua escolhida",
    },
    buildsTitle: "Rondas de cada build",
    buildLabel: "Build {n}",
    previousBuild: "build anterior",
    paceNote:
      "As rondas põem a equipa a trabalhar minutos ou horas, não os dias que um orçamento deve cobrir: o custo fica comprimido em pouco tempo e não diz quanto dura um orçamento no uso de todos os dias. Só a ronda r33 cobre dois dias, com o ritmo desligado e o orçamento dividido por dia.",
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
    lead: "Amit a csapat 2026. november 14–21. próbafutásaiban elköltött és megtalált, a 0.4.0 harness API-kulcsos szolgáltatásaival. A számok a próbák jegyzőkönyveiből és a költségmintavevőkből származnak.",
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
      "«Releváns» = olyan pozíciók, amelyek címe megfelel a szakmának, mintavétellel ellenőrizve; a kötőjel = nem értékelt. «Korábbi build» = a 0.4.0 számozott buildjei előtti futás: nem bizonyítja a 0.4.0-t.",
    chartTitle: "Mennyibe kerül egy értékelt pozíció",
    chartLead:
      "A csapat által értékelt pozíciónként elköltött dollár. Minél rövidebb, annál jobb. Értékelt pozíció nélküli futásnak nincs oszlopa.",
    chartNone: "nincs értékelt",
    chartCaveat:
      "A két Mac-futás 6 és 10 percig tartott minimális csapattal, a költség szinte csak onboarding és Capitano: nem összevethető a 16–42 perces futásokkal.",
    servicesTitle: "Szolgáltatások: amit a futásokban láttunk",
    servicesCols: {
      service: "Szolgáltatás",
      seen: "Látott a futásokban",
      rate: "Látott tempó",
    },
    servicesCaveat:
      "Csak amit a futások mértek; a kötőjel = soha nem próbáltuk. Ezek a számok a 0.4.0 számozott buildjei előtti buildeken futott körökből származnak (r1–r8): azt mutatják, mennyibe kerül egy szolgáltatás, nem azt, hogyan viselkedik a 0.4.0. A Claude Windowson 5,28 $-t költött: ebből a Capitano és a Scorer 3,05 $-t nyom.",
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
      "Kitalált profilok, személyes adat nélkül · számok a 2026.11.14–21-i próbák jegyzőkönyveiből.",
    marks:
      "A logók csak azt a szolgáltatást jelzik, amelyet egy próba használt, és nem jelentenek támogatást. A védjegyek és a logók a tulajdonosaiké.",
    outcome: {
      pass: "megfelelt",
      reservations: "fenntartással",
      fail: "megbukott",
      unjudged: "nem értékelt",
      running: "folyamatban",
    },
    system: {
      pass: "megfelel",
      withReservations: "fenntartással megfelel",
      running: "folyamatban",
    },
    profiles: {
      bricklayer: "Kőműves",
      warehouseWorker: "Raktáros",
      officeClerk: "Irodai ügyintéző, részmunkaidő",
      dataAnalyst: "Adatelemző",
      generic: "Általános próbaprofil",
      restorer: "Restaurátor",
      waiter: "Pincér",
      receptionist: "Recepciós",
      truckDriver: "Kamionsofőr",
      electrician: "Villanyszerelő",
      shopAssistant: "Eladó",
      careAssistant: "Ápolási asszisztens",
    },
    modes: { onsite: "helyszínen", unspecified: "" },
    services: {
      glm: "GLM",
      claude: "Claude",
      openai: "OpenAI",
      kimi: "Kimi",
      "openai-glm": "OpenAI (elfogyott a kredit), majd GLM",
    },
    notes: {
      updateBuild10Portuguese:
        "Frissítés a 10. buildre, végig portugálul: a mentett kulcs megmaradt, a sor magától újraindult, 1 új hirdetés (74); az ütemfék szüneteltette a csapatot és szólt a felhasználónak.",
      updateWindowsBuild9to10:
        "A 9. build nulláról telepítve, végig németül: negyedóra alatt 25 raktári hirdetés; frissítés a 10. buildre megtartott hirdetésekkel, profillal és kulccsal, utána az elemző sosem indult el, és 13 hirdetés várakozva maradt.",
      updateSwitchKept:
        "Frissítés futó csapattal: adatok megtartva, régi képfájlok törölve, GLM → Claude a csapat leállítása nélkül. 26 újból 3 releváns 10 perc alatt.",
      updateWelcomePaid:
        "Frissítés és váltás Claude-ra: 18-ból 15 releváns 12 perc alatt. Az üdvözlést minden újraindításkor újra kifizette.",
      cleanInstallWarehouse:
        "Új felhasználó, vezetett bevezetés: a fék 2,67 $-nál állt meg. Szinte csak raktári állás: 19-ből 2 releváns.",
      updateNoNewPositions:
        "A frissítés sikerült, és nem maradt kulcsos fájl a lemezen, de 30 perc alatt 0 új állás: csak 2 Scoutot ébresztett fel.",
      diskLowAfterUpdate:
        "A frissítés sikerült, a csapat sosem indult el: 4 GiB szabad a szükséges 8-ból, figyelmeztetés nélkül a letöltés előtt.",
      cleanInstallGerman:
        "Új felhasználó németül: 26-ból 10 releváns. A fék 4,77 $-nál megállt, aztán hamis feloldás (a végén 4,95 $); a Doktor és a Karbantartó egy kört sem futott.",
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
      updateWindowsBuild11:
        "Frissítés a 10. buildről a 11.-re, végig németül: a csapat és az adatok megmaradnak, az elemző magától újraindul; 7 új hirdetésből 5 releváns.",
      installLinuxBuild11:
        "Telepítés nulláról és vezetett bevezetés végig olaszul, a kulcs megmarad: 18-ból 14 releváns. A memóriaőr szó nélkül visszavonja a Scoutokat, és azok nem térnek vissza.",
      updateMacBuild11:
        "Frissítés a 10. buildről a 11.-re portugálul: hirdetések, pontszámok és kulcs megmaradnak, a lemezhely visszajön; az időszak kerete elfogy, mielőtt a 6 új hirdetés pontszámot kapna.",
      updateLinuxBuild12b:
        "Frissítés a 12. build első változatára: a csapat és az adatok megmaradnak; a Doktor a tempószünet alatt indul el, és az utána következő folytatás másodpercek alatt elkölti a tartalékot.",
      updateMacBuild12b:
        "Frissítés a 12. build első változatára: 11 új hirdetésből 6 releváns, legjobb pontszám 89; a beállítás sikertelen konfigurációt jelez, miközben a csapat magától elindul.",
      updateWindowsBuild12c:
        "Frissítés a 12. buildre nyitott asszisztens-csevegéssel, végig franciául: félúton megáll, és a jht parancs addig nem működik, amíg a telepítőt újra nem futtatják.",
      updateLinuxBuild12d:
        "Frissítés a 12. build utolsó változatára: a csapat és az adatok megmaradnak; a tempószünet utáni folytatás kb. 80 helyett 275 másodpercig dolgozik, és a kiszolgáló szerepeket nem ébreszti fel.",
      updateMacBuild12d:
        "Frissítés a 12. build utolsó változatára: a csapat és az adatok megmaradnak, eltűnt a hamis „sikertelen beállítás” jelzés; 12 új hirdetés, az ablakban még pontszám nélkül.",
      updateLinuxBuild13:
        "Frissítés a 13. buildre: a csapat és az adatok megmaradnak; a dúsítások minden ellenőrzött hirdetésen lefutnak, de sem koordinátát, sem logót nem adnak; elemzett hirdetésenként 0,0085 $.",
      updateWindowsBuild13:
        "A frissítés újrapróbája nyitott csevegéssel: végigfut, és a jht parancs működik; a csevegés viszont még mindig egy nyers sorral zárul.",
      candidateLinux:
        "Frissítés a kiadásjelöltre, a csapat és az adatok megmaradnak: az első költési plafon tart, a másodikat egy folytatás után 13%-kal túllépi; 33 új hirdetésből 20 releváns (61%, 70% kell).",
      retestBrake:
        "A fék újrapróbája a jelöltre épített tesztképen: a plafon mindkétszer tart (1 $-ból 0,36 és 3 $-ból 1,92); egy új keret feloldása után a tempó 0,86 $-t enged át a vonala fölött.",
      retestPace:
        "A tempószünet utáni lépcsőzetes ébresztés újrapróbája: a lépcsők működnek, és az időszak sosem lépi túl a vonalat vagy a plafont (3 $-ból 2,55); két másik csatorna még mindig felébreszti a várakozókat.",
      retestFull:
        "Teljes újrapróba: a vonalat és a plafont sosem lépi túl (3 $-ból 2,55), de aki a lépcsőjére vár, mégis dolgozik, és az első szünet 48 másodperccel a feloldás után jön; 15-ből 1 releváns, mind egyetlen ügynökségi portálról.",
      retestReserve:
        "Teljes újrapróba, korán lezárva: a lépcsők működnek, de az újraindítás becsült tartaléka minden lépcső után 10–20 másodperccel leállítja a csapatot; nincs új hirdetés.",
      retestResumes:
        "Újrapróba, korán lezárva: a feloldás most tíz percig dolgozik az első szünetig, de mindkét folytatás az első percen belül leáll, és a frissítés után a Kapitány a lépcsőkön kívül mind a hét dolgozót felébreszti.",
      retestDayQuota:
        "A napokra osztott költségkeret újratesztje két napon át (41 óra), kikapcsolt tempóval: a csapat a napi részéig dolgozik, egyetlen értesítéssel megáll, és másnap magától folytatja (1,38 $ a 2-ből, soha egy rész felett). 4 kisebb hiba; 5 új pozícióból 4 releváns.",
      candidateWindowsSpanish:
        "Kiadásjelölt új Windows-felhasználón, végig spanyolul: 10-ből 4 releváns 5 perc alatt (további 5 a megfelelő szakmából, de részmunkaidős vagy szezonális); a tempófék 1,01-nél áll meg az 1,5 $-ból. Nyitott: üres súgó a hosztról, a Scout az első kör után megállt.",
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
    targetsLead:
      "A 0.4.0 csak akkor jelenik meg, ha minden sor zöld. Minden buildnél frissül; a bizonyíték a lenti futáshoz visz.",
    targetsCount: "{n}-ből {g} zöld",
    targetsCols: {
      target: "Cél",
      status: "Állapot",
      build: "Build",
      proof: "Bizonyíték",
    },
    targetStatus: {
      pass: "teljesült",
      fail: "nem teljesült",
      pending: "kipróbálandó",
      blocked: "elakadt",
    },
    targets: {
      scoutBenchCook: "Szakács",
      scoutBenchWarehouse: "Raktáros",
      scoutBenchNurse: "Ápolónő",
      scoutBenchBricklayer: "Kőműves",
      languageWindows: "Beállítás és onboarding a választott nyelven · Windows",
      languageLinux: "Beállítás és onboarding a választott nyelven · Linux",
      languageMac: "Beállítás és onboarding a választott nyelven · Mac",
      preTagReview: "Biztonsági átnézés a tag előtt",
      installWindows: "Telepítés új felhasználóként · Windows",
      installLinux: "Telepítés új felhasználóként · Linux",
      installMac: "Telepítés új felhasználóként · Mac",
      updateLinux: "Frissítés meglévő csapattal és adatokkal · Linux",
      updateMac: "Frissítés meglévő csapattal és adatokkal · Mac",
      updateWindows: "Frissítés meglévő csapattal és adatokkal · Windows",
      nonItRelevant: "A személy szakmájába tartozó hirdetések (legalább 70%)",
      scoutBench:
        "Scout-próbapad, 4 IT-n kívüli szakma (≥70% releváns, 0 ismétlődés, ≥15 állás)",
      budgetBrake:
        "Keretfék: soha a plafon fölött, nincs hamis feloldás, a felhasználó értesül",
      language: "Beállítás és bevezetés a választott nyelven",
      doctorMaintainer:
        "A Doktor és a Karbantartó, a csapatra vigyázó ügynökök, tényleg működnek",
      serviceClaude: "Claude (Anthropic) · API-kulcs",
      serviceOpenai: "OpenAI · API-kulcs",
      serviceGlm: "Z.ai (GLM) · API-kulcs",
      serviceKimi: "Kimi (Moonshot) · API-kulcs",
      codexSubscription:
        "OpenAI Codex · előfizetés (csak akinek már megvan a 0.3.x, mint a bétatesztünkben)",
      openaiSubscription: "OpenAI · ChatGPT-előfizetés Pi-n",
      noKeyOnDisk: "Egyetlen API-kulcs sem marad a lemezre írva",
      betaTester: "Béta teszt: a verzió frissítve, a csapat munkában",
    },
    targetNotes: {
      updateMacBuild10:
        "10. build: a beállítás végig portugálul, a mentett kulcs megmaradt, 1 új hirdetés (pontszám 74)",
      updateWindowsBuild10:
        "10. build: hirdetések, profil és kulcs megmaradt, végig németül; a frissítés után az elemző sosem indult el (13 hirdetés vár)",
      languagePortugueseOk: "10. build: végig portugálul a Macen",
      notTried040:
        "a 0.4.0-n nem próbáltuk",
      updateLinuxBuild9:
        "9. build: sikeres (a köre nincs az alábbi táblázatban)",
      installerBlockedBuild9:
        "9. build: a telepítő megállította (javítás a 10. buildben, a kör folyamatban)",
      benchCook: "79% releváns",
      benchWarehouse: "90% releváns",
      benchNurse: "1 ismétlődés (94% releváns)",
      benchBricklayer: "6 állás, kevesebb mint 15 (83% releváns)",
      brakeFixedRetry: "javítva a 9. és 10. buildben: újra kipróbálandó",
      languageGermanOk: "9. build: végig németül Linuxon",
      securityPreTag:
        "átnézés a tag előtt: az ítélet a tag pontos verziójára születik; a lemezen maradt kulcs ügye lezárva",
      cleanLinuxRoundMissing:
        "tiszta telepítés a 6. buildön: a futása nincs a lenti táblázatban",
      openaiBuild6Redo:
        "csak a 6. buildön próbáltuk (1,61 $, 10 perc): a 0.4.0-n újra kell csinálni",
      redoOnBuild9: "a 9. buildön megismétlendő",
      diskFull: "megtelt lemez a frissítés után (javítás folyamatban)",
      neverTried: "sosem próbálták",
      relevantBelow: "0 új a kőművesnek, 26-ból 10 a recepciósnak",
      benchPaused: "szünetel a 9. buildig",
      brakeFalseClear:
        "hamis feloldás a leállás után, a felhasználó értesítése nem sikerült",
      languageEnglish:
        "API-kulcs lépés, csapatindítás és állapot angolul (a 8. build után javítva)",
      zeroTurns: "0 kör (a 9. buildben javítva)",
      noCredit: "nincs egyenleg a kipróbálásukhoz",
      loginNeverTried: "valódi bejelentkezés sosem próbálva",
      keysChecked: "0 kulcsos fájl a helyén kívül, 20 927 fájleseményből",
      updateOnBuild9: "frissítés a 9. buildön",
      updateMacBuild11:
        "11. build: hirdetések, pontszámok és kulcs megmaradnak, a lemezhely visszajön, végig portugálul",
      updateWindowsBuild13:
        "13. build: a frissítés nyitott csevegéssel végigfut, és a jht parancs működik, végig franciául",
      relevantBuild15:
        "15. build: új Windows-felhasználónál az eladó profilnál 10-ből 4 releváns (40%; további 5 részmunkaidős vagy szezonális); a villanyszerelőnél az újratesztben 5-ből 4; az első jelöltnél 33-ból 20 (61%). Új telepítésen újra bizonyítandó",
      brakeDayQuota:
        "15. build: a napi rész és a tempó minden költségkeret előtt megállítja a csapatot (1,38 $ a 2-ből két nap alatt; 1,04 $ az 1,5-ből Windowson); az értesítésekben és az állapotban kisebb hibák maradtak",
      languageFrenchGermanOk:
        "11–13. build: a német és a francia végig a folyamatban; néhány sor még angolul (a parancs súgója)",
      languageItalianOk:
        "11. build: telepítés és bevezetés végig olaszul Linuxon",
      doctorWorks:
        "11–12. build: a Doktor és a Karbantartó hiba nélkül lefutja a köreit, és a megfelelő ágenseket oldja fel",
    },
    invalidTitle: "Nem számító körök",
    invalidLead:
      "A mi oldalunkon keletkezett okok miatt megszakadt körök (elfogyott kredit, magától leállt tesztgép, mérési hiba, a pad törölt próbái), nem a termék hibái miatt. Kimaradnak a táblázatból és a grafikonokból; a bennük talált hibák a hibagrafikonon maradnak.",
    invalidReasons: {
      noCreditMachineOff:
        "Az OpenAI-nak nem volt kreditje, és a tesztgép magától leállt: egy Scout sem indult el. A kör közepén a szolgáltatást GLM-re cserélték.",
      cumulativeCap:
        "A 3 $-os tesztplafonunk túl alacsony volt, és egy olyan számlálón olvastuk le, amely az előző kört is tartalmazta: 6 perc után leállt, még egyetlen új hirdetés előtt.",
      benchDailyBudget:
        "Törölt próba a padon: korábbról maradt magas napi kerettel indult, és az ütemfék 70 másodperc után megállította.",
      benchOpenRun:
        "Törölt próba a padon: az előző build első keresése még nyitva volt.",
      creditEndedNoPositions:
        "A tesztfiók GLM-kreditje bármely hirdetés előtt elfogyott: 0 hirdetés.",
      benchCancelled: "Törölt próba a padon, a nulláról újraindítva.",
    },
    targetSections: {
      install: "Telepítés új felhasználóként",
      update: "Frissítés csapattal és adatokkal",
      scout: "Scout-pad: a Scout a megfelelő szakma hirdetéseit találja?",
      brake: "Az utolsó próbák feltételei (15. build).",
      language: "Nyelv",
      doctor: "Doktor és Karbantartó",
      services: "Szolgáltatások",
      security: "Biztonság",
      beta: "Bétateszt",
      realUser: "Teljes kör valódi felhasználóként, nem IT szakmával",
    },
    targetCriteria: {
      relevant: "releváns {v}% (≥{min}%)",
      duplicates: "ismétlődés {v}",
      positions: "hirdetés {v} (≥{min})",
      newPositions: "{trade}: {v} új",
      relevantOf: "{trade}: {v} releváns / {of}",
      underCeiling: "{v} / {max} $ elköltve",
      noFalseUnlock: "nincs hamis feloldás",
    },
    targetRules: {
      scout:
        "Csak a Scoutok keresése, egy már beállított szerveren, négy nem IT szakmával. Egy szakma sikeres, ha mind a 3 feltétel zöld: legalább 70% releváns, 0 ismétlődés, legalább 15 hirdetés.",
      brake:
        "Az utolsó próba feltételei (8. build); azóta javítva, újra kipróbálandó.",
      realUser:
        "Valaki a nulláról telepíti a programot, kitölti a beállítást, és 30 percig hagyja egyedül dolgozni a csapatot. Sikeres, ha a talált hirdetések legalább 70%-a az ő szakmájába tartozik.",
    },
    targetTried: "kipróbálva a(z) {n}. buildön",
    targetRows: {
      install: "Első telepítés a programot még nem ismerő gépre",
      update: "Olyan gép frissítése, amelyen már van csapat és adat",
      language: "Beállítás és onboarding a választott nyelven",
    },
    buildsTitle: "Az egyes buildek futásai",
    buildLabel: "{n}. build",
    previousBuild: "korábbi build",
    paceNote:
      "A futások percekig vagy óráig dolgoztatják a csapatot, nem annyi napig, amennyit egy költségkeretnek le kell fednie: a költség rövid időbe sűrűsödik, és nem mutatja meg, meddig tart egy költségkeret a mindennapi használatban. Csak az r33 futás fed le két napot, kikapcsolt tempóval és napokra osztott költségkerettel.",
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

// The three icons fill their boxes differently (the panes fill it all, the apple and the penguin less): these sizes make
// them look the same height next to each other.
const OS_ICON_PX: Record<string, number> = {
  windows: 14,
  linux: 17,
  macos: 18,
};

export function Mark({ id, label }: { id: string; label: string }) {
  // a service (or two, «openai-glm»): its marks as inline SVG, as tall as the text, no tile
  const services = id.split("-").filter((x) => PROVIDER_IDS.includes(x));
  if (services.length > 0 && services.length === id.split("-").length)
    return (
      <span className="inline-flex items-center gap-1 shrink-0" title={label}>
        {services.map((sv) => (
          <ProviderMark key={sv} id={sv} label={label} />
        ))}
      </span>
    );
  // the systems: the icons the site already draws in the setup guide, monochrome in the colour of the text
  if (id === "linux" || id === "windows" || id === "macos")
    return (
      <span
        className="inline-flex items-center justify-center shrink-0 [&>svg]:w-[var(--os-icon)] [&>svg]:h-[var(--os-icon)]"
        style={{
          width: 22,
          height: 22,
          ["--os-icon" as string]: `${OS_ICON_PX[id]}px`,
        }}
        title={label}
      >
        <OsIcon os={id} />
      </span>
    );
  return null;
}

export const OS_LABEL: Record<string, string> = {
  linux: "Linux",
  windows: "Windows",
  macos: "macOS",
};
// The release targets (web/data/benchmark/benchmark-0-4-0.json, «targets»): 0.4.0 is released only when every one is met.
export const TARGET_MARK: Record<string, string> = {
  pass: "✅",
  fail: "❌",
  pending: "⏳",
  blocked: "⛔",
};
export const TARGET_COLOR: Record<string, string> = {
  pass: "#22C55E",
  fail: "#EF4444",
  pending: "#F59E0B",
  blocked: "#A855F7",
};
export type Target = (typeof data.targets)[number];
// The sections of the targets table, with the emoji of their heading, and the columns of the targets that differ by system.
export const TARGET_SECTIONS: [string, string][] = [
  ["install", "📦"],
  ["update", "🔄"],
  ["realUser", "🧪"],
  ["scout", "🔍"],
  ["brake", "💸"],
  ["language", "🌍"],
  ["doctor", "🩺"],
  ["services", "🔌"],
  ["security", "🔒"],
  ["beta", "🧑‍💼"],
];
export const TARGET_OS = ["windows", "linux", "macos"];
// The emoji of each trade in the targets table, next to its name.
export const TRADE_EMOJI: Record<string, string> = {
  bricklayer: "🧱",
  cook: "🍳",
  warehouseWorker: "📦",
  nurse: "🩺",
  receptionist: "🛎️",
  truckDriver: "🚚",
  electrician: "⚡",
  shopAssistant: "🛍️",
  careAssistant: "🩹",
};
export type Build = (typeof data.builds)[number];

export const OUTCOME_COLOR: Record<string, string> = {
  pass: "#22C55E",
  reservations: "#84CC16",
  fail: "#EF4444",
  running: "#F59E0B",
  unjudged: "#9CA3AF",
};

// The sector of each profile of the rounds and of the category of a case study (the finder matches on it when the words differ).
export const PROFILE_SECTOR: Record<string, Sector | ""> = {
  dataAnalyst: "it",
  generic: "",
  restorer: "culture",
  waiter: "hospitality",
  receptionist: "hospitality",
  truckDriver: "transport",
  bricklayer: "trades",
  officeClerk: "office",
  electrician: "trades",
  shopAssistant: "",
  careAssistant: "health",
};
export const CATEGORY_SECTOR: Record<string, Sector | ""> = {
  finance: "office",
};
