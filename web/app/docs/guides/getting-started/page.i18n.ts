// Dizionario di `page.tsx`.
//
// Le chiavi sono LOCALI a questa guida: lo stesso nome può valere tutt'altro
// altrove, quindi non vanno accorpate in un dizionario comune. Il tipo su
// `T` fa pretendere al compilatore ogni lingua dichiarata: una voce a cui
// ne manca una non compila, invece di mostrare l'inglese all'utente
// sbagliato.
import type { Locale } from "@/i18n/config";

export type Dict = {
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
  path2SoonA: string;
  downloadPage: string;
  path2SoonB: string;
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

export const T: Record<Locale, Dict> = {
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
    kimi: " (Moonshot) — the simplest tier to start with.",
    codex: " (OpenAI) — a balance of quality and cost.",
    claude:
      " (Anthropic) — the highest precision, best for scoring and writing.",
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
    path2Title: "🖥️ Path 2 — Desktop app (coming soon)",
    path2SoonA:
      "A graphical launcher for macOS, Windows and Linux is on its way: it will install everything and start the team with one click, no terminal needed. It's not downloadable yet — you can track it on ",
    downloadPage: "the install page",
    path2SoonB: ". In the meantime, use Path 1 or Path 3.",
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
    fr1B: " Chat with the Assistant during the first-run onboarding",
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
    kimi: " (Moonshot) — la fascia più semplice da cui partire.",
    codex: " (OpenAI) — un equilibrio tra qualità e costo.",
    claude:
      " (Anthropic) — la massima precisione, ideale per scoring e scrittura.",
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
    path2Title: "🖥️ Percorso 2 — App desktop (in arrivo)",
    path2SoonA:
      "Un launcher grafico per macOS, Windows e Linux è in arrivo: installerà tutto e avvierà il team con un clic, senza terminale. Non è ancora scaricabile — lo trovi segnalato sulla ",
    downloadPage: "pagina di installazione",
    path2SoonB: ". Nel frattempo usa il Percorso 1 o il Percorso 3.",
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
    fr1B: " Chatta con l'Assistente nell'onboarding al primo avvio",
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
    kimi: " (Moonshot) — el nivel más sencillo para empezar.",
    codex: " (OpenAI) — un equilibrio entre calidad y coste.",
    claude:
      " (Anthropic) — la máxima precisión, ideal para puntuar y redactar.",
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
    path2Title: "🖥️ Vía 2 — App de escritorio (próximamente)",
    path2SoonA:
      "Un lanzador gráfico para macOS, Windows y Linux está en camino: instalará todo e iniciará el equipo con un clic, sin terminal. Aún no se puede descargar — puedes seguirlo en ",
    downloadPage: "la página de instalación",
    path2SoonB: ". Mientras tanto, usa la Vía 1 o la Vía 3.",
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
    fr1B: " Chatea con el Asistente en el onboarding del primer arranque",
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
    kimi: " (Moonshot) — la formule la plus simple pour débuter.",
    codex: " (OpenAI) — un équilibre entre qualité et coût.",
    claude:
      " (Anthropic) — la plus haute précision, idéale pour la notation et la rédaction.",
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
    path2Title: "🖥️ Voie 2 — Application de bureau (bientôt disponible)",
    path2SoonA:
      "Un lanceur graphique pour macOS, Windows et Linux arrive : il installera tout et démarrera l'équipe en un clic, sans terminal. Il n'est pas encore téléchargeable — suivez-le sur ",
    downloadPage: "la page d'installation",
    path2SoonB: ". En attendant, utilisez la Voie 1 ou la Voie 3.",
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
    fr1B: " Discutez avec l'Assistant lors de l'onboarding au premier démarrage",
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
    kimi: " (Moonshot) — die einfachste Stufe für den Einstieg.",
    codex: " (OpenAI) — ein Gleichgewicht aus Qualität und Kosten.",
    claude:
      " (Anthropic) — die höchste Präzision, ideal für Bewertung und Verfassen.",
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
    path2Title: "🖥️ Weg 2 — Desktop-App (demnächst)",
    path2SoonA:
      "Ein grafischer Launcher für macOS, Windows und Linux ist unterwegs: Er wird alles installieren und das Team mit einem Klick starten, ganz ohne Terminal. Er ist noch nicht herunterladbar — du findest ihn angekündigt auf ",
    downloadPage: "der Installationsseite",
    path2SoonB: ". Nutze in der Zwischenzeit Weg 1 oder Weg 3.",
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
    fr1B: " Chatte mit dem Assistenten im Onboarding beim ersten Start",
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
    kimi: " (Moonshot) — a legegyszerűbb szint a kezdéshez.",
    codex: " (OpenAI) — egyensúly a minőség és a költség között.",
    claude:
      " (Anthropic) — a legnagyobb pontosság, ideális pontozáshoz és íráshoz.",
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
    path2Title: "🖥️ 2. út — Asztali alkalmazás (hamarosan)",
    path2SoonA:
      "Úton van egy grafikus indító macOS-re, Windowsra és Linuxra: mindent telepít majd, és egy kattintással elindítja a csapatot, terminál nélkül. Egyelőre nem tölthető le — a ",
    downloadPage: "telepítési oldalon",
    path2SoonB: " követheted. Addig használd az 1. vagy a 3. utat.",
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
    fr1B: " Beszélgess az Asszisztenssel az első indítás bevezetőjében",
    fr1C: " — megírja helyetted a ",
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
    kimi: " (Moonshot) — o nível mais simples para começar.",
    codex: " (OpenAI) — um equilíbrio entre qualidade e custo.",
    claude: " (Anthropic) — a máxima precisão, ideal para pontuar e escrever.",
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
    path2Title: "🖥️ Via 2 — App de ambiente de trabalho (em breve)",
    path2SoonA:
      "Está a caminho um launcher gráfico para macOS, Windows e Linux: vai instalar tudo e arrancar a equipa com um clique, sem terminal. Ainda não pode ser descarregado — podes acompanhá-lo na ",
    downloadPage: "página de instalação",
    path2SoonB: ". Entretanto, usa a Via 1 ou a Via 3.",
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
    fr1B: " Conversa com o Assistente no onboarding do primeiro arranque",
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
