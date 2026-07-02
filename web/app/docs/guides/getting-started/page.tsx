import Link from "next/link";
import {
  DocHeader,
  Callout,
  H2,
  H3,
  P,
  UL,
  LI,
  Code,
  Pre,
  GitHubMore,
} from "../../DocKit";
import { repoFile } from "../../repo";
import type { Locale } from "@/i18n/config";
import { getRequestLocale } from "@/lib/request-locale";

type Dict = {
  title: string;
  tagline: string;
  headerBody: string;
  fastestLabel: string;
  fastestBody: string;
  subTitle: string;
  subIntroA: string;
  subIntroB: string;
  subIntroC: string;
  subEmphOne: string;
  subIntroD: string;
  kimi: string;
  codex: string;
  claude: string;
  dedicateLabel: string;
  dedicateBody: string;
  pricingPage: string;
  pickTitle: string;
  path1Title: string;
  path1Intro: string;
  path1AfterA: string;
  path1AfterB: string;
  path2Title: string;
  path2IntroA: string;
  downloadPage: string;
  path2IntroB: string;
  path2Li1: string;
  path2Li2: string;
  path2Li3A: string;
  path2Li3B: string;
  desktopLabel: string;
  desktopBodyA: string;
  desktopBodyB: string;
  path3Title: string;
  path3Mac: string;
  path3WinIntro: string;
  path3WizardIntro: string;
  dockerReqA: string;
  dockerReqB: string;
  firstRunTitle: string;
  firstRunIntro: string;
  fr1A: string;
  fr1B: string;
  fr1C: string;
  fr2A: string;
  emailForwarding: string;
  fr3A: string;
  fr3B: string;
  fr4A: string;
  dashboardLink: string;
  fr4B: string;
  stuckA: string;
  stuckB: string;
  vpsLink: string;
};

const T: Record<Locale, Dict> = {
  en: {
    title: "Getting Started",
    tagline: "From zero to a running team in about 10 minutes",
    headerBody:
      "Job Hunter Team is a team of AI agents that hunt, vet, score and tailor job applications for you, around the clock. This page gets it running.",
    fastestLabel: "The fastest path:",
    fastestBody:
      " if you already use an AI assistant (Claude Code, OpenClaw, Codex, Cursor…), just point it at this guide and the repo and ask it to set everything up. The whole CLI is built to be driven by an agent — you may not have to type a single command yourself.",
    subTitle: "🧠 First, one subscription",
    subIntroA: "The team runs on an ",
    subIntroB: "LLM subscription",
    subIntroC:
      ", not pay-per-use API keys — it works around the clock and that would get expensive. You need an active plan with ",
    subEmphOne: "one",
    subIntroD: " of three providers:",
    kimi: " (Moonshot Pro, ~€40/mo) — the affordable, mass-market tier. A great place to start.",
    codex: " (OpenAI Plus/Pro, ~€100/mo) — a balance of quality and cost.",
    claude:
      " (Anthropic Max x20, ~€200/mo) — the highest precision, best for scoring and writing.",
    dedicateLabel: "Dedicate the subscription to the team.",
    dedicateBody:
      " Don't reuse the same account you use for personal AI — they share one weekly quota and the team will hit limits unexpectedly. More on the ",
    pricingPage: "pricing page",
    pickTitle: "🛤️ Then, pick how you install",
    path1Title: "🦞 Path 1 — Let your AI assistant do it",
    path1Intro: "If you use a coding assistant, tell it something like:",
    path1AfterA: "It will read the docs, install the CLI, run ",
    path1AfterB:
      ", fix what's missing and start the team. This is a primary design goal, not a hack.",
    path2Title: "🖥️ Path 2 — Desktop app (no terminal)",
    path2IntroA: "Download the launcher from ",
    downloadPage: "the download page",
    path2IntroB: ". Open it, then the wizard:",
    path2Li1: "Picks your language and installs the container runtime for you.",
    path2Li2: "Signs you into your provider through an embedded terminal.",
    path2Li3A: "Click ",
    path2Li3B: " — the team boots and your browser opens on the dashboard.",
    desktopLabel: "interaction cockpit",
    desktopBodyA: "💡 The desktop app is your ",
    desktopBodyB:
      ": it sets up and starts the team, and it's where you chat with the agents, upload files and start or stop them. The public web dashboard is read-only — for viewing positions, scores and the map.",
    path3Title: "📦 Path 3 — One-liner installer",
    path3Mac: "macOS / Linux / WSL2:",
    path3WinIntro:
      "Windows (PowerShell, Docker Desktop must already be running):",
    path3WizardIntro: "Then bring the team up and run the wizard:",
    dockerReqA: "The one requirement is ",
    dockerReqB:
      " — the installer sets up the runtime on macOS and Linux for you (on Windows it expects Docker Desktop already installed). No Node, Python or tmux on your machine: everything lives inside the container.",
    firstRunTitle: "🎬 Your first run",
    firstRunIntro: "Whichever path you took:",
    fr1A: "Set up your profile.",
    fr1B: " Chat with the Assistant at ",
    fr1C: " — it writes your ",
    fr2A: "Feed it your job alerts (optional but recommended) — see ",
    emailForwarding: "Email Forwarding",
    fr3A: "Click Start.",
    fr3B: " The Captain dispatches Scout → Analyst → Scorer → Writer → Critic; the Sentinel keeps everyone within the subscription window.",
    fr4A: "Review the output",
    dashboardLink: "dashboard",
    fr4B: ". Nothing is ever submitted automatically — you decide what to send.",
    stuckA: "🩹 Stuck? ",
    stuckB: " tells you exactly what's missing. For the always-on setup see ",
    vpsLink: "Run 24/7 on a VPS",
  },
  it: {
    title: "Per iniziare",
    tagline: "Da zero a un team operativo in circa 10 minuti",
    headerBody:
      "Job Hunter Team è una squadra di agenti AI che cercano, valutano, assegnano un punteggio e personalizzano le candidature per te, 24 ore su 24. Questa pagina lo mette in funzione.",
    fastestLabel: "Il percorso più veloce:",
    fastestBody:
      " se usi già un assistente AI (Claude Code, OpenClaw, Codex, Cursor…), basta indirizzarlo a questa guida e al repo e chiedergli di configurare tutto. L'intera CLI è progettata per essere guidata da un agente — potresti non dover digitare nemmeno un comando.",
    subTitle: "🧠 Prima di tutto, un abbonamento",
    subIntroA: "Il team funziona con un ",
    subIntroB: "abbonamento LLM",
    subIntroC:
      ", non con chiavi API a consumo — lavora 24 ore su 24 e ciò diventerebbe costoso. Ti serve un piano attivo con ",
    subEmphOne: "uno",
    subIntroD: " dei tre provider:",
    kimi: " (Moonshot Pro, ~40 €/mese) — la fascia accessibile e di massa. Un ottimo punto di partenza.",
    codex:
      " (OpenAI Plus/Pro, ~100 €/mese) — un equilibrio tra qualità e costo.",
    claude:
      " (Anthropic Max x20, ~200 €/mese) — la massima precisione, ideale per scoring e scrittura.",
    dedicateLabel: "Dedica l'abbonamento al team.",
    dedicateBody:
      " Non riutilizzare lo stesso account che usi per l'AI personale — condividono un'unica quota settimanale e il team raggiungerà i limiti in modo imprevisto. Maggiori dettagli sulla ",
    pricingPage: "pagina dei prezzi",
    pickTitle: "🛤️ Poi, scegli come installare",
    path1Title: "🦞 Percorso 1 — Lascia fare al tuo assistente AI",
    path1Intro: "Se usi un assistente di programmazione, digli qualcosa come:",
    path1AfterA: "Leggerà la documentazione, installerà la CLI, eseguirà ",
    path1AfterB:
      ", sistemerà ciò che manca e avvierà il team. Questo è un obiettivo di progettazione primario, non un trucco.",
    path2Title: "🖥️ Percorso 2 — App desktop (nessun terminale)",
    path2IntroA: "Scarica il launcher dalla ",
    downloadPage: "pagina di download",
    path2IntroB: ". Aprilo, poi la procedura guidata:",
    path2Li1:
      "Sceglie la tua lingua e installa il runtime dei container per te.",
    path2Li2: "Ti fa accedere al tuo provider tramite un terminale integrato.",
    path2Li3A: "Clicca ",
    path2Li3B: " — il team si avvia e il browser si apre sulla dashboard.",
    desktopLabel: "cabina di comando",
    desktopBodyA: "💡 L'app desktop è la tua ",
    desktopBodyB:
      ": configura e avvia il team, ed è da lì che parli con gli agenti, carichi i file e li avvii o fermi. La dashboard web pubblica è in sola lettura — per consultare posizioni, punteggi e mappa.",
    path3Title: "📦 Percorso 3 — Installer one-liner",
    path3Mac: "macOS / Linux / WSL2:",
    path3WinIntro:
      "Windows (PowerShell, Docker Desktop deve essere già in esecuzione):",
    path3WizardIntro: "Poi avvia il team ed esegui la procedura guidata:",
    dockerReqA: "L'unico requisito è ",
    dockerReqB:
      " — l'installer configura il runtime su macOS e Linux per te (su Windows si aspetta Docker Desktop già installato). Niente Node, Python o tmux sulla tua macchina: tutto vive dentro il container.",
    firstRunTitle: "🎬 La tua prima esecuzione",
    firstRunIntro: "Qualunque percorso tu abbia scelto:",
    fr1A: "Configura il tuo profilo.",
    fr1B: " Chatta con l'Assistente su ",
    fr1C: " — scriverà il tuo ",
    fr2A: "Forniscigli i tuoi avvisi di lavoro (opzionale ma consigliato) — vedi ",
    emailForwarding: "Inoltro email",
    fr3A: "Clicca Start.",
    fr3B: " Il Capitano coordina Scout → Analista → Scorer → Scrittore → Critico; la Sentinella mantiene tutti entro la finestra dell'abbonamento.",
    fr4A: "Esamina i risultati",
    dashboardLink: "dashboard",
    fr4B: ". Nulla viene mai inviato automaticamente — decidi tu cosa inviare.",
    stuckA: "🩹 Bloccato? ",
    stuckB:
      " ti dice esattamente cosa manca. Per la configurazione sempre attiva vedi ",
    vpsLink: "Esegui 24/7 su un VPS",
  },
  es: {
    title: "Primeros pasos",
    tagline: "De cero a un equipo en marcha en unos 10 minutos",
    headerBody:
      "Job Hunter Team es un equipo de agentes de IA que buscan, evalúan, puntúan y adaptan tus candidaturas por ti, las 24 horas del día. Esta página lo pone en marcha.",
    fastestLabel: "La vía más rápida:",
    fastestBody:
      " si ya usas un asistente de IA (Claude Code, OpenClaw, Codex, Cursor…), basta con dirigirlo a esta guía y al repo y pedirle que lo configure todo. Toda la CLI está hecha para ser controlada por un agente — puede que no tengas que escribir ni un solo comando.",
    subTitle: "🧠 Primero, una suscripción",
    subIntroA: "El equipo funciona con una ",
    subIntroB: "suscripción a un LLM",
    subIntroC:
      ", no con claves API de pago por uso — trabaja las 24 horas y eso resultaría caro. Necesitas un plan activo con ",
    subEmphOne: "uno",
    subIntroD: " de tres proveedores:",
    kimi: " (Moonshot Pro, ~40 €/mes) — el nivel asequible y de gran público. Un excelente punto de partida.",
    codex:
      " (OpenAI Plus/Pro, ~100 €/mes) — un equilibrio entre calidad y coste.",
    claude:
      " (Anthropic Max x20, ~200 €/mes) — la máxima precisión, ideal para puntuar y redactar.",
    dedicateLabel: "Dedica la suscripción al equipo.",
    dedicateBody:
      " No reutilices la misma cuenta que usas para tu IA personal — comparten una única cuota semanal y el equipo alcanzará los límites de forma inesperada. Más información en la ",
    pricingPage: "página de precios",
    pickTitle: "🛤️ Después, elige cómo instalar",
    path1Title: "🦞 Vía 1 — Deja que lo haga tu asistente de IA",
    path1Intro: "Si usas un asistente de programación, dile algo como:",
    path1AfterA: "Leerá la documentación, instalará la CLI, ejecutará ",
    path1AfterB:
      ", arreglará lo que falte e iniciará el equipo. Este es un objetivo de diseño primordial, no un truco.",
    path2Title: "🖥️ Vía 2 — App de escritorio (sin terminal)",
    path2IntroA: "Descarga el lanzador desde ",
    downloadPage: "la página de descargas",
    path2IntroB: ". Ábrelo y luego el asistente:",
    path2Li1: "Elige tu idioma e instala el runtime de contenedores por ti.",
    path2Li2: "Te conecta a tu proveedor mediante un terminal integrado.",
    path2Li3A: "Haz clic en ",
    path2Li3B: " — el equipo arranca y tu navegador se abre en el panel.",
    desktopLabel: "cabina de mando",
    desktopBodyA: "💡 La app de escritorio es tu ",
    desktopBodyB:
      ": configura y arranca el equipo, y es desde donde hablas con los agentes, subes archivos y los inicias o detienes. El panel web público es de solo lectura — para consultar posiciones, puntuaciones y el mapa.",
    path3Title: "📦 Vía 3 — Instalador en una línea",
    path3Mac: "macOS / Linux / WSL2:",
    path3WinIntro:
      "Windows (PowerShell, Docker Desktop ya debe estar en ejecución):",
    path3WizardIntro: "Luego levanta el equipo y ejecuta el asistente:",
    dockerReqA: "El único requisito es ",
    dockerReqB:
      " — el instalador configura el runtime en macOS y Linux por ti (en Windows espera Docker Desktop ya instalado). Sin Node, Python ni tmux en tu máquina: todo vive dentro del contenedor.",
    firstRunTitle: "🎬 Tu primera ejecución",
    firstRunIntro: "Sea cual sea la vía que hayas elegido:",
    fr1A: "Configura tu perfil.",
    fr1B: " Chatea con el Asistente en ",
    fr1C: " — escribirá tu ",
    fr2A: "Aliméntalo con tus alertas de empleo (opcional pero recomendable) — consulta ",
    emailForwarding: "Reenvío de correo",
    fr3A: "Haz clic en Start.",
    fr3B: " El Capitán despacha Scout → Analista → Scorer → Redactor → Crítico; el Centinela mantiene a todos dentro de la ventana de la suscripción.",
    fr4A: "Revisa los resultados",
    dashboardLink: "panel",
    fr4B: ". Nunca se envía nada automáticamente — tú decides qué enviar.",
    stuckA: "🩹 ¿Atascado? ",
    stuckB:
      " te dice exactamente qué falta. Para la configuración siempre activa, consulta ",
    vpsLink: "Ejecuta 24/7 en un VPS",
  },
  fr: {
    title: "Pour commencer",
    tagline: "De zéro à une équipe opérationnelle en environ 10 minutes",
    headerBody:
      "Job Hunter Team est une équipe d'agents IA qui recherchent, évaluent, notent et personnalisent vos candidatures pour vous, 24 heures sur 24. Cette page la met en marche.",
    fastestLabel: "La voie la plus rapide :",
    fastestBody:
      " si vous utilisez déjà un assistant IA (Claude Code, OpenClaw, Codex, Cursor…), il suffit de le diriger vers ce guide et le dépôt et de lui demander de tout configurer. Toute la CLI est conçue pour être pilotée par un agent — vous n'aurez peut-être pas à taper la moindre commande.",
    subTitle: "🧠 D'abord, un abonnement",
    subIntroA: "L'équipe fonctionne avec un ",
    subIntroB: "abonnement LLM",
    subIntroC:
      ", pas avec des clés API à l'usage — elle travaille 24 heures sur 24 et cela coûterait cher. Vous avez besoin d'un forfait actif chez ",
    subEmphOne: "l'un",
    subIntroD: " des trois fournisseurs :",
    kimi: " (Moonshot Pro, ~40 €/mois) — la formule abordable et grand public. Un excellent point de départ.",
    codex:
      " (OpenAI Plus/Pro, ~100 €/mois) — un équilibre entre qualité et coût.",
    claude:
      " (Anthropic Max x20, ~200 €/mois) — la plus haute précision, idéale pour la notation et la rédaction.",
    dedicateLabel: "Dédiez l'abonnement à l'équipe.",
    dedicateBody:
      " Ne réutilisez pas le même compte que pour votre IA personnelle — ils partagent un quota hebdomadaire unique et l'équipe atteindra les limites de façon imprévue. Plus d'informations sur la ",
    pricingPage: "page des tarifs",
    pickTitle: "🛤️ Ensuite, choisissez comment installer",
    path1Title: "🦞 Voie 1 — Laissez faire votre assistant IA",
    path1Intro:
      "Si vous utilisez un assistant de codage, dites-lui quelque chose comme :",
    path1AfterA: "Il lira la documentation, installera la CLI, exécutera ",
    path1AfterB:
      ", corrigera ce qui manque et démarrera l'équipe. C'est un objectif de conception primordial, pas une bidouille.",
    path2Title: "🖥️ Voie 2 — Application de bureau (sans terminal)",
    path2IntroA: "Téléchargez le lanceur depuis ",
    downloadPage: "la page de téléchargement",
    path2IntroB: ". Ouvrez-le, puis l'assistant :",
    path2Li1:
      "Choisit votre langue et installe le runtime de conteneurs pour vous.",
    path2Li2: "Vous connecte à votre fournisseur via un terminal intégré.",
    path2Li3A: "Cliquez sur ",
    path2Li3B:
      " — l'équipe démarre et votre navigateur s'ouvre sur le tableau de bord.",
    desktopLabel: "poste de pilotage",
    desktopBodyA: "💡 L'application de bureau est votre ",
    desktopBodyB:
      " : elle configure et lance l'équipe, et c'est de là que vous parlez aux agents, téléversez des fichiers et les démarrez ou arrêtez. Le tableau de bord web public est en lecture seule — pour consulter postes, scores et carte.",
    path3Title: "📦 Voie 3 — Installateur en une ligne",
    path3Mac: "macOS / Linux / WSL2 :",
    path3WinIntro:
      "Windows (PowerShell, Docker Desktop doit déjà être en cours d'exécution) :",
    path3WizardIntro: "Puis démarrez l'équipe et lancez l'assistant :",
    dockerReqA: "La seule exigence est ",
    dockerReqB:
      " — l'installateur configure le runtime sur macOS et Linux pour vous (sous Windows, il attend Docker Desktop déjà installé). Pas de Node, Python ni tmux sur votre machine : tout vit à l'intérieur du conteneur.",
    firstRunTitle: "🎬 Votre première exécution",
    firstRunIntro: "Quelle que soit la voie choisie :",
    fr1A: "Configurez votre profil.",
    fr1B: " Discutez avec l'Assistant sur ",
    fr1C: " — il écrira votre ",
    fr2A: "Alimentez-le avec vos alertes d'emploi (facultatif mais recommandé) — voir ",
    emailForwarding: "Transfert d'e-mails",
    fr3A: "Cliquez sur Start.",
    fr3B: " Le Capitaine répartit Scout → Analyste → Scorer → Rédacteur → Critique ; la Sentinelle maintient tout le monde dans la fenêtre de l'abonnement.",
    fr4A: "Examinez les résultats",
    dashboardLink: "tableau de bord",
    fr4B: ". Rien n'est jamais soumis automatiquement — c'est vous qui décidez quoi envoyer.",
    stuckA: "🩹 Bloqué ? ",
    stuckB:
      " vous indique exactement ce qui manque. Pour la configuration permanente, voir ",
    vpsLink: "Exécuter 24/7 sur un VPS",
  },
  de: {
    title: "Erste Schritte",
    tagline: "In etwa 10 Minuten von null zu einem laufenden Team",
    headerBody:
      "Job Hunter Team ist ein Team aus KI-Agenten, die rund um die Uhr für dich Stellen suchen, prüfen, bewerten und Bewerbungen anpassen. Diese Seite bringt es zum Laufen.",
    fastestLabel: "Der schnellste Weg:",
    fastestBody:
      " wenn du bereits einen KI-Assistenten verwendest (Claude Code, OpenClaw, Codex, Cursor…), verweise ihn einfach auf diese Anleitung und das Repo und bitte ihn, alles einzurichten. Die gesamte CLI ist darauf ausgelegt, von einem Agenten gesteuert zu werden — du musst vielleicht keinen einzigen Befehl selbst eintippen.",
    subTitle: "🧠 Zuerst ein Abonnement",
    subIntroA: "Das Team läuft mit einem ",
    subIntroB: "LLM-Abonnement",
    subIntroC:
      ", nicht mit nutzungsbasierten API-Schlüsseln — es arbeitet rund um die Uhr, und das würde teuer werden. Du brauchst einen aktiven Plan bei ",
    subEmphOne: "einem",
    subIntroD: " von drei Anbietern:",
    kimi: " (Moonshot Pro, ~40 €/Monat) — die günstige Einstiegsstufe für die breite Masse. Ein großartiger Startpunkt.",
    codex:
      " (OpenAI Plus/Pro, ~100 €/Monat) — ein Gleichgewicht aus Qualität und Kosten.",
    claude:
      " (Anthropic Max x20, ~200 €/Monat) — die höchste Präzision, ideal für Bewertung und Verfassen.",
    dedicateLabel: "Widme das Abonnement dem Team.",
    dedicateBody:
      " Verwende nicht dasselbe Konto wie für deine persönliche KI — sie teilen sich ein einziges wöchentliches Kontingent, und das Team stößt unerwartet an die Grenzen. Mehr dazu auf der ",
    pricingPage: "Preisseite",
    pickTitle: "🛤️ Dann wähle, wie du installierst",
    path1Title: "🦞 Weg 1 — Lass es deinen KI-Assistenten erledigen",
    path1Intro:
      "Wenn du einen Coding-Assistenten verwendest, sage ihm etwa Folgendes:",
    path1AfterA: "Er liest die Dokumentation, installiert die CLI, führt ",
    path1AfterB:
      " aus, behebt, was fehlt, und startet das Team. Das ist ein primäres Designziel, kein Trick.",
    path2Title: "🖥️ Weg 2 — Desktop-App (kein Terminal)",
    path2IntroA: "Lade den Launcher von ",
    downloadPage: "der Download-Seite",
    path2IntroB: " herunter. Öffne ihn, dann den Assistenten:",
    path2Li1:
      "Wählt deine Sprache und installiert die Container-Laufzeitumgebung für dich.",
    path2Li2:
      "Meldet dich über ein eingebettetes Terminal bei deinem Anbieter an.",
    path2Li3A: "Klicke auf ",
    path2Li3B: " — das Team startet und dein Browser öffnet das Dashboard.",
    desktopLabel: "Steuerstand",
    desktopBodyA: "💡 Die Desktop-App ist dein ",
    desktopBodyB:
      ": Sie richtet das Team ein und startet es, und von dort aus sprichst du mit den Agenten, lädst Dateien hoch und startest oder stoppst sie. Das öffentliche Web-Dashboard ist schreibgeschützt — zum Ansehen von Stellen, Scores und Karte.",
    path3Title: "📦 Weg 3 — Einzeiler-Installer",
    path3Mac: "macOS / Linux / WSL2:",
    path3WinIntro: "Windows (PowerShell, Docker Desktop muss bereits laufen):",
    path3WizardIntro: "Dann starte das Team und führe den Assistenten aus:",
    dockerReqA: "Die einzige Voraussetzung ist ",
    dockerReqB:
      " — der Installer richtet die Laufzeitumgebung auf macOS und Linux für dich ein (unter Windows erwartet er ein bereits installiertes Docker Desktop). Kein Node, Python oder tmux auf deinem Rechner: alles lebt im Container.",
    firstRunTitle: "🎬 Dein erster Lauf",
    firstRunIntro: "Welchen Weg du auch gewählt hast:",
    fr1A: "Richte dein Profil ein.",
    fr1B: " Chatte mit dem Assistenten unter ",
    fr1C: " — er schreibt deine ",
    fr2A: "Füttere es mit deinen Job-Benachrichtigungen (optional, aber empfohlen) — siehe ",
    emailForwarding: "E-Mail-Weiterleitung",
    fr3A: "Klicke auf Start.",
    fr3B: " Der Kapitän verteilt Scout → Analyst → Scorer → Schreiber → Kritiker; die Wache hält alle innerhalb des Abonnement-Fensters.",
    fr4A: "Prüfe die Ergebnisse",
    dashboardLink: "Dashboard",
    fr4B: ". Nichts wird jemals automatisch eingereicht — du entscheidest, was gesendet wird.",
    stuckA: "🩹 Festgefahren? ",
    stuckB:
      " sagt dir genau, was fehlt. Für die Dauerbetrieb-Einrichtung siehe ",
    vpsLink: "Rund um die Uhr auf einem VPS betreiben",
  },
  hu: {
    title: "Első lépések",
    tagline: "A semmiből működő csapatig nagyjából 10 perc alatt",
    headerBody:
      "A Job Hunter Team mesterséges intelligencia ügynökök csapata, amely a nap 24 órájában keres, megvizsgál, pontoz és személyre szab álláspályázatokat helyetted. Ez az oldal beindítja.",
    fastestLabel: "A leggyorsabb út:",
    fastestBody:
      " ha már használsz egy MI-asszisztenst (Claude Code, OpenClaw, Codex, Cursor…), egyszerűen irányítsd rá erre az útmutatóra és a repóra, és kérd meg, hogy állítson be mindent. Az egész CLI úgy készült, hogy egy ügynök vezérelje — lehet, hogy egyetlen parancsot sem kell begépelned.",
    subTitle: "🧠 Először egy előfizetés",
    subIntroA: "A csapat egy ",
    subIntroB: "LLM-előfizetésen",
    subIntroC:
      " fut, nem használatalapú API-kulcsokon — a nap 24 órájában dolgozik, és az drága lenne. Aktív csomagra van szükséged az alábbi három szolgáltató ",
    subEmphOne: "egyikénél",
    subIntroD: ":",
    kimi: " (Moonshot Pro, ~40 €/hó) — a megfizethető, tömegpiaci szint. Remek kiindulópont.",
    codex:
      " (OpenAI Plus/Pro, ~100 €/hó) — egyensúly a minőség és a költség között.",
    claude:
      " (Anthropic Max x20, ~200 €/hó) — a legnagyobb pontosság, ideális pontozáshoz és íráshoz.",
    dedicateLabel: "Szenteld az előfizetést a csapatnak.",
    dedicateBody:
      " Ne használd újra ugyanazt a fiókot, amit a személyes MI-hez használsz — egyetlen heti kvótán osztoznak, és a csapat váratlanul eléri a korlátokat. Bővebben az ",
    pricingPage: "árazási oldalon",
    pickTitle: "🛤️ Aztán válaszd ki, hogyan telepítesz",
    path1Title: "🦞 1. út — Bízd az MI-asszisztensedre",
    path1Intro:
      "Ha kódolási asszisztenst használsz, mondj neki valami ilyesmit:",
    path1AfterA: "Elolvassa a dokumentációt, telepíti a CLI-t, lefuttatja a ",
    path1AfterB:
      " parancsot, kijavítja, ami hiányzik, és elindítja a csapatot. Ez elsődleges tervezési cél, nem trükk.",
    path2Title: "🖥️ 2. út — Asztali alkalmazás (terminál nélkül)",
    path2IntroA: "Töltsd le az indítót a ",
    downloadPage: "letöltési oldalról",
    path2IntroB: ". Nyisd meg, majd a varázsló:",
    path2Li1:
      "Kiválasztja a nyelvedet, és telepíti helyetted a konténer-futtatókörnyezetet.",
    path2Li2: "Beléptet a szolgáltatódhoz egy beágyazott terminálon keresztül.",
    path2Li3A: "Kattints a ",
    path2Li3B:
      " gombra — a csapat elindul, és a böngésződ megnyílik az irányítópulton.",
    desktopLabel: "vezérlőpultod",
    desktopBodyA: "💡 Az asztali alkalmazás a ",
    desktopBodyB:
      ": beállítja és elindítja a csapatot, és innen beszélsz az ügynökökkel, töltesz fel fájlokat, és indítod vagy állítod le őket. A nyilvános webes irányítópult csak olvasható — a pozíciók, pontszámok és a térkép megtekintésére.",
    path3Title: "📦 3. út — Egysoros telepítő",
    path3Mac: "macOS / Linux / WSL2:",
    path3WinIntro: "Windows (PowerShell, a Docker Desktopnak már futnia kell):",
    path3WizardIntro: "Aztán indítsd el a csapatot, és futtasd a varázslót:",
    dockerReqA: "Az egyetlen követelmény a ",
    dockerReqB:
      " — a telepítő beállítja helyetted a futtatókörnyezetet macOS-en és Linuxon (Windowson már telepített Docker Desktopot vár). Nincs Node, Python vagy tmux a gépeden: minden a konténeren belül él.",
    firstRunTitle: "🎬 Az első futtatásod",
    firstRunIntro: "Bármelyik utat is választottad:",
    fr1A: "Állítsd be a profilodat.",
    fr1B: " Beszélgess az Asszisztenssel az ",
    fr1C: " oldalon — megírja helyetted a ",
    fr2A: "Tápláld be az állásértesítéseidet (nem kötelező, de ajánlott) — lásd ",
    emailForwarding: "E-mail-továbbítás",
    fr3A: "Kattints a Start gombra.",
    fr3B: " A Kapitány elindítja a Felderítő → Elemző → Pontozó → Író → Kritikus sort; az Őrszem mindenkit az előfizetés ablakán belül tart.",
    fr4A: "Tekintsd át az eredményeket",
    dashboardLink: "irányítópult",
    fr4B: " oldalon. Semmi sem kerül automatikusan beadásra — te döntöd el, mit küldj el.",
    stuckA: "🩹 Elakadtál? ",
    stuckB:
      " pontosan megmondja, mi hiányzik. A folyamatos üzemű beállításhoz lásd ",
    vpsLink: "Folyamatos futtatás VPS-en",
  },
  pt: {
    title: "Primeiros passos",
    tagline: "Do zero a uma equipa em funcionamento em cerca de 10 minutos",
    headerBody:
      "O Job Hunter Team é uma equipa de agentes de IA que procuram, avaliam, pontuam e adaptam candidaturas por ti, 24 horas por dia. Esta página coloca tudo a funcionar.",
    fastestLabel: "O caminho mais rápido:",
    fastestBody:
      " se já usas um assistente de IA (Claude Code, OpenClaw, Codex, Cursor…), basta apontá-lo para este guia e para o repo e pedir-lhe que configure tudo. Toda a CLI foi feita para ser conduzida por um agente — podes nem ter de escrever um único comando.",
    subTitle: "🧠 Primeiro, uma subscrição",
    subIntroA: "A equipa funciona com uma ",
    subIntroB: "subscrição de LLM",
    subIntroC:
      ", não com chaves de API pagas por utilização — trabalha 24 horas por dia e isso ficaria caro. Precisas de um plano ativo com ",
    subEmphOne: "um",
    subIntroD: " de três fornecedores:",
    kimi: " (Moonshot Pro, ~40 €/mês) — o nível acessível e de grande público. Um excelente ponto de partida.",
    codex:
      " (OpenAI Plus/Pro, ~100 €/mês) — um equilíbrio entre qualidade e custo.",
    claude:
      " (Anthropic Max x20, ~200 €/mês) — a máxima precisão, ideal para pontuar e escrever.",
    dedicateLabel: "Dedica a subscrição à equipa.",
    dedicateBody:
      " Não reutilizes a mesma conta que usas para a IA pessoal — partilham uma única quota semanal e a equipa atingirá os limites de forma inesperada. Mais informações na ",
    pricingPage: "página de preços",
    pickTitle: "🛤️ Depois, escolhe como instalar",
    path1Title: "🦞 Caminho 1 — Deixa o teu assistente de IA fazê-lo",
    path1Intro: "Se usas um assistente de programação, diz-lhe algo como:",
    path1AfterA: "Ele lerá a documentação, instalará a CLI, executará ",
    path1AfterB:
      ", corrigirá o que falta e iniciará a equipa. Este é um objetivo de design primordial, não um truque.",
    path2Title:
      "🖥️ Caminho 2 — Aplicação de ambiente de trabalho (sem terminal)",
    path2IntroA: "Descarrega o launcher a partir da ",
    downloadPage: "página de transferências",
    path2IntroB: ". Abre-o e, em seguida, o assistente:",
    path2Li1: "Escolhe o teu idioma e instala o runtime de contentores por ti.",
    path2Li2:
      "Inicia a tua sessão no fornecedor através de um terminal incorporado.",
    path2Li3A: "Clica em ",
    path2Li3B: " — a equipa arranca e o teu navegador abre no painel.",
    desktopLabel: "cabina de comando",
    desktopBodyA: "💡 A app de ambiente de trabalho é a tua ",
    desktopBodyB:
      ": configura e arranca a equipa, e é dali que falas com os agentes, carregas ficheiros e os inicias ou paras. O painel web público é apenas de leitura — para consultar posições, pontuações e o mapa.",
    path3Title: "📦 Caminho 3 — Instalador numa só linha",
    path3Mac: "macOS / Linux / WSL2:",
    path3WinIntro:
      "Windows (PowerShell, o Docker Desktop já tem de estar em execução):",
    path3WizardIntro: "Depois levanta a equipa e executa o assistente:",
    dockerReqA: "O único requisito é o ",
    dockerReqB:
      " — o instalador configura o runtime no macOS e Linux por ti (no Windows espera o Docker Desktop já instalado). Sem Node, Python ou tmux na tua máquina: tudo vive dentro do contentor.",
    firstRunTitle: "🎬 A tua primeira execução",
    firstRunIntro: "Seja qual for o caminho que escolheste:",
    fr1A: "Configura o teu perfil.",
    fr1B: " Conversa com o Assistente em ",
    fr1C: " — ele escreve o teu ",
    fr2A: "Alimenta-o com os teus alertas de emprego (opcional, mas recomendado) — vê ",
    emailForwarding: "Reencaminhamento de e-mail",
    fr3A: "Clica em Start.",
    fr3B: " O Capitão despacha Scout → Analista → Scorer → Redator → Crítico; a Sentinela mantém todos dentro da janela da subscrição.",
    fr4A: "Revê os resultados",
    dashboardLink: "painel",
    fr4B: ". Nada é submetido automaticamente — és tu que decides o que enviar.",
    stuckA: "🩹 Preso? ",
    stuckB:
      " diz-te exatamente o que falta. Para a configuração sempre ativa, vê ",
    vpsLink: "Executar 24/7 num VPS",
  },
};

export default async function GettingStartedPage() {
  const locale = await getRequestLocale();
  const t = T[locale];
  return (
    <div>
      <DocHeader emoji="🚀" title={t.title} tagline={t.tagline}>
        {t.headerBody}
      </DocHeader>

      <Callout>
        ⚡ <strong>{t.fastestLabel}</strong>
        {t.fastestBody}
      </Callout>

      <H2>{t.subTitle}</H2>
      <P>
        {t.subIntroA}
        <strong>{t.subIntroB}</strong>
        {t.subIntroC}
        <strong>{t.subEmphOne}</strong>
        {t.subIntroD}
      </P>
      <UL>
        <LI>
          🌙 <strong>Kimi</strong>
          {t.kimi}
        </LI>
        <LI>
          🔵 <strong>Codex</strong>
          {t.codex}
        </LI>
        <LI>
          🟠 <strong>Claude</strong>
          {t.claude}
        </LI>
      </UL>
      <Callout>
        ⚠️ <strong>{t.dedicateLabel}</strong>
        {t.dedicateBody}
        <Link
          href="/pricing"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          {t.pricingPage}
        </Link>
        .
      </Callout>

      <H2>{t.pickTitle}</H2>

      <H3>{t.path1Title}</H3>
      <P>{t.path1Intro}</P>
      <Pre>
        {`"Set up Job Hunter Team from
github.com/leopu00/job-hunter-team for my profile.
I have a [Kimi Pro / Codex / Claude Max] subscription.
Walk me through what you need."`}
      </Pre>
      <P>
        {t.path1AfterA}
        <Code>jht doctor</Code>
        {t.path1AfterB}
      </P>

      <H3>{t.path2Title}</H3>
      <P>
        {t.path2IntroA}
        <Link
          href="/download"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          {t.downloadPage}
        </Link>{" "}
        (macOS <Code>.dmg</Code>, Windows <Code>.exe</Code>, Linux{" "}
        <Code>.AppImage</Code>/<Code>.deb</Code>){t.path2IntroB}
      </P>
      <UL>
        <LI>{t.path2Li1}</LI>
        <LI>{t.path2Li2}</LI>
        <LI>
          {t.path2Li3A}
          <strong>Start</strong>
          {t.path2Li3B}
        </LI>
      </UL>
      <Callout>
        {t.desktopBodyA}
        <strong>{t.desktopLabel}</strong>
        {t.desktopBodyB}
      </Callout>

      <H3>{t.path3Title}</H3>
      <P>{t.path3Mac}</P>
      <Pre>{`curl -fsSL https://jobhunterteam.ai/install.sh | bash`}</Pre>
      <P>{t.path3WinIntro}</P>
      <Pre>{`iwr -useb https://jobhunterteam.ai/install.ps1 | iex`}</Pre>
      <P>{t.path3WizardIntro}</P>
      <Pre>
        {`jht up            # start the container (pulls the image first run)
jht setup         # wizard: provider, OAuth login, team start
jht doctor        # check everything is healthy
jht team status   # confirm it's running`}
      </Pre>
      <P>
        {t.dockerReqA}
        <strong>Docker</strong>
        {t.dockerReqB}
      </P>

      <H2>{t.firstRunTitle}</H2>
      <P>{t.firstRunIntro}</P>
      <UL>
        <LI>
          <strong>{t.fr1A}</strong>
          {t.fr1B}
          <Code>/onboarding</Code>
          {t.fr1C}
          <Code>candidate_profile.yml</Code>.
        </LI>
        <LI>
          {t.fr2A}
          <Link
            href="/docs/guides/email-forwarding"
            className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
          >
            {t.emailForwarding}
          </Link>
          .
        </LI>
        <LI>
          <strong>{t.fr3A}</strong>
          {t.fr3B}
        </LI>
        <LI>
          <strong>{t.fr4A}</strong>{" "}
          <Link
            href="/docs/guides/dashboard-and-results"
            className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
          >
            {t.dashboardLink}
          </Link>
          {t.fr4B}
        </LI>
      </UL>

      <Callout>
        {t.stuckA}
        <Code>jht doctor</Code>
        {t.stuckB}
        <Link
          href="/docs/guides/run-on-a-vps"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          {t.vpsLink}
        </Link>
        .
      </Callout>

      <GitHubMore href={repoFile("docs/guides/QUICKSTART.md")}>
        QUICKSTART.md
      </GitHubMore>
    </div>
  );
}
