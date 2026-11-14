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
  codex: string;
  apiKey: string;
  dedicateLabel: string;
  dedicateBody: string;
  pricingPage: string;
  pickTitle: string;
  path1Title: string;
  path1Intro: string;
  path1AfterA: string;
  path1AfterB: string;
  path2Title: string;
  path2A: string;
  downloadPage: string;
  path2B: string;
  path3Title: string;
  path3Mac: string;
  path3WizardIntro: string;
  requirementA: string;
  requirementB: string;
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
    subTitle: "🧠 First, the AI provider",
    subIntroA: "In 0.4.0 the team runs on a ",
    subIntroB: "GLM (Z.ai) API key",
    subIntroC: " on the Pi harness, paid per call; jht setup asks for it (typed hidden). Use ",
    subEmphOne: "one",
    subIntroD: " key, for the team only:",
    codex: " — not in this version.",
    apiKey: "(Z.ai) — with an API key, paid per call: set a daily spending ceiling.",
    dedicateLabel: "Dedicate the key to the team.",
    dedicateBody: " Don't reuse a key you use elsewhere, and set a spending ceiling both in the team and with the provider. More on the ",
    pricingPage: "pricing page",
    pickTitle: "🛤️ Then, pick how you install",
    path1Title: "🦞 Path 1 — Let your AI assistant do it",
    path1Intro: "If you use a coding assistant, tell it something like:",
    path1AfterA: "It will read the docs, install the CLI, run ",
    path1AfterB:
      ", fix what's missing and start the team. This is a primary design goal, not a hack.",
    path2Title: "🖥️ Path 2 — Desktop app: not in 0.4.0",
    path2A:
      "There is no desktop app in 0.4.0: the team is driven from the jht CLI, installed with the one-liner below. On a Mac, Homebrew must already be installed: the installer uses it to set up Podman. Linux: CLI only, experimental. The requirements are on ",
    downloadPage: "the install page",
    path2B: ". Windows is a preview in 0.4.0, CLI only: tested on Windows 10, not on Windows 11 (its PowerShell installer is in the Quickstart of the repository).",
    path3Title: "📦 Path 3 — One-liner installer",
    path3Mac: "macOS / Linux:",
    path3WizardIntro: "Then bring the team up and run the wizard:",
    requirementA: "On a Mac the one requirement is ",
    requirementB:
      " — it must already be installed, and the installer then sets up the container runtime for you. Linux: CLI only, experimental. Windows is a preview in 0.4.0, CLI only: tested on Windows 10, not on Windows 11. No Node, Python or tmux on your machine: everything lives inside the container.",
    firstRunTitle: "🎬 Your first run",
    firstRunIntro: "Whichever path you took:",
    fr1A: "Set up your profile.",
    fr1B: " Chat with the Assistant during the first-run onboarding",
    fr1C: " — it writes your ",
    fr2A: "Feed it your job alerts (optional but recommended) — see ",
    emailForwarding: "Email Forwarding",
    fr3A: "Click Start.",
    fr3B: " The Captain dispatches Scout → Analyst → Scorer → Writer → Critic; the Sentinel keeps everyone within the spending ceiling.",
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
    subTitle: "🧠 Prima di tutto, il provider AI",
    subIntroA: "Nella 0.4.0 il team funziona con una ",
    subIntroB: "chiave API di GLM (Z.ai)",
    subIntroC: " sull'harness Pi, a consumo; jht setup la chiede (scritta nascosta). Usa ",
    subEmphOne: "una",
    subIntroD: " chiave solo per il team:",
    codex: " — non in questa versione.",
    apiKey: "(Z.ai) — con una chiave API, a consumo: imposta un tetto di spesa giornaliero.",
    dedicateLabel: "Dedica la chiave al team.",
    dedicateBody: " Non riusare una chiave che usi altrove, e metti un tetto di spesa sia nel team sia presso il provider. Di più nella ",
    pricingPage: "pagina dei prezzi",
    pickTitle: "🛤️ Poi, scegli come installare",
    path1Title: "🦞 Percorso 1 — Lascia fare al tuo assistente AI",
    path1Intro: "Se usi un assistente di programmazione, digli qualcosa come:",
    path1AfterA: "Leggerà la documentazione, installerà la CLI, eseguirà ",
    path1AfterB:
      ", sistemerà ciò che manca e avvierà il team. Questo è un obiettivo di progettazione primario, non un trucco.",
    path2Title: "🖥️ Percorso 2 — App desktop: non nella 0.4.0",
    path2A:
      "Nella 0.4.0 non c'è l'app desktop: il team si guida dalla CLI jht, installata con il comando unico qui sotto. Su un Mac Homebrew deve essere già installato: l'installer lo usa per configurare Podman. Linux: solo CLI, sperimentale. I requisiti sono nella ",
    downloadPage: "pagina di installazione",
    path2B: ". Windows è un'anteprima nella 0.4.0, solo CLI: provato su Windows 10, non su Windows 11 (il suo installer PowerShell è nel Quickstart del repository).",
    path3Title: "📦 Percorso 3 — Installer one-liner",
    path3Mac: "macOS / Linux:",
    path3WizardIntro: "Poi avvia il team ed esegui la procedura guidata:",
    requirementA: "Su Mac l'unico requisito è ",
    requirementB:
      " — deve essere già installato, poi l'installer configura il runtime dei container per te. Linux: solo CLI, sperimentale. Windows è un'anteprima nella 0.4.0, solo CLI: provato su Windows 10, non su Windows 11. Niente Node, Python o tmux sulla tua macchina: tutto vive dentro il container.",
    firstRunTitle: "🎬 La tua prima esecuzione",
    firstRunIntro: "Qualunque percorso tu abbia scelto:",
    fr1A: "Configura il tuo profilo.",
    fr1B: " Chatta con l'Assistente nell'onboarding al primo avvio",
    fr1C: " — scriverà il tuo ",
    fr2A: "Forniscigli i tuoi avvisi di lavoro (opzionale ma consigliato) — vedi ",
    emailForwarding: "Inoltro email",
    fr3A: "Clicca Start.",
    fr3B: " Il Capitano coordina Scout → Analista → Scorer → Scrittore → Critico; la Sentinella mantiene tutti entro il tetto di spesa.",
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
    subTitle: "🧠 Primero, el proveedor de IA",
    subIntroA: "En la 0.4.0 el equipo funciona con una ",
    subIntroB: "clave de API de GLM (Z.ai)",
    subIntroC: " sobre el harness Pi, de pago por uso; jht setup la pide (escrita oculta). Usa ",
    subEmphOne: "una",
    subIntroD: " clave solo para el equipo:",
    codex: " — no está en esta versión.",
    apiKey: "(Z.ai) — con una clave de API, de pago por uso: fija un tope de gasto diario.",
    dedicateLabel: "Dedica la clave al equipo.",
    dedicateBody: " No reutilices una clave que uses en otro sitio, y pon un tope de gasto tanto en el equipo como en el proveedor. Más en la ",
    pricingPage: "página de precios",
    pickTitle: "🛤️ Después, elige cómo instalar",
    path1Title: "🦞 Vía 1 — Deja que lo haga tu asistente de IA",
    path1Intro: "Si usas un asistente de programación, dile algo como:",
    path1AfterA: "Leerá la documentación, instalará la CLI, ejecutará ",
    path1AfterB:
      ", arreglará lo que falte e iniciará el equipo. Este es un objetivo de diseño primordial, no un truco.",
    path2Title: "🖥️ Vía 2 — App de escritorio: no está en la 0.4.0",
    path2A:
      "En la 0.4.0 no hay app de escritorio: el equipo se maneja desde la CLI jht, que se instala con el comando único de abajo. En un Mac, Homebrew debe estar ya instalado: el instalador lo usa para configurar Podman. Linux: solo CLI, experimental. Los requisitos están en ",
    downloadPage: "la página de instalación",
    path2B: ". Windows es una vista previa en la 0.4.0, solo CLI: probado en Windows 10, no en Windows 11 (su instalador de PowerShell está en el Quickstart del repositorio).",
    path3Title: "📦 Vía 3 — Instalador en una línea",
    path3Mac: "macOS / Linux:",
    path3WizardIntro: "Luego levanta el equipo y ejecuta el asistente:",
    requirementA: "En Mac el único requisito es ",
    requirementB:
      " — debe estar ya instalado, y después el instalador configura el runtime de contenedores por ti. Linux: solo CLI, experimental. Windows es una vista previa en la 0.4.0, solo CLI: probado en Windows 10, no en Windows 11. Sin Node, Python ni tmux en tu máquina: todo vive dentro del contenedor.",
    firstRunTitle: "🎬 Tu primera ejecución",
    firstRunIntro: "Sea cual sea la vía que hayas elegido:",
    fr1A: "Configura tu perfil.",
    fr1B: " Chatea con el Asistente en el onboarding del primer arranque",
    fr1C: " — escribirá tu ",
    fr2A: "Aliméntalo con tus alertas de empleo (opcional pero recomendable) — consulta ",
    emailForwarding: "Reenvío de correo",
    fr3A: "Haz clic en Start.",
    fr3B: " El Capitán despacha Scout → Analista → Scorer → Redactor → Crítico; el Centinela mantiene a todos dentro del tope de gasto.",
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
    subTitle: "🧠 D'abord, le fournisseur d'IA",
    subIntroA: "Dans la 0.4.0, l'équipe fonctionne avec une ",
    subIntroB: "clé d'API GLM (Z.ai)",
    subIntroC: " sur le harness Pi, payée à l'usage ; jht setup la demande (saisie masquée). Utilisez ",
    subEmphOne: "une",
    subIntroD: " clé réservée à l'équipe :",
    codex: " — pas dans cette version.",
    apiKey: "(Z.ai) — avec une clé d'API, payée à l'usage : fixez un plafond de dépense journalier.",
    dedicateLabel: "Dédiez la clé à l'équipe.",
    dedicateBody: " Ne réutilisez pas une clé utilisée ailleurs, et fixez un plafond de dépense dans l'équipe et chez le fournisseur. Plus de détails sur la ",
    pricingPage: "page des tarifs",
    pickTitle: "🛤️ Ensuite, choisissez comment installer",
    path1Title: "🦞 Voie 1 — Laissez faire votre assistant IA",
    path1Intro:
      "Si vous utilisez un assistant de codage, dites-lui quelque chose comme :",
    path1AfterA: "Il lira la documentation, installera la CLI, exécutera ",
    path1AfterB:
      ", corrigera ce qui manque et démarrera l'équipe. C'est un objectif de conception primordial, pas une bidouille.",
    path2Title: "🖥️ Voie 2 — Application de bureau : pas dans la 0.4.0",
    path2A:
      "La 0.4.0 n'a pas d'application de bureau : l'équipe se pilote depuis la CLI jht, installée avec la commande unique ci-dessous. Sur un Mac, Homebrew doit déjà être installé : l'installateur s'en sert pour configurer Podman. Linux : CLI uniquement, expérimental. Les prérequis sont sur ",
    downloadPage: "la page d'installation",
    path2B:
      ". Windows est un aperçu dans la 0.4.0, CLI uniquement : testé sur Windows 10, pas sur Windows 11 (son installateur PowerShell est dans le Quickstart du dépôt).",
    path3Title: "📦 Voie 3 — Installateur en une ligne",
    path3Mac: "macOS / Linux :",
    path3WizardIntro: "Puis démarrez l'équipe et lancez l'assistant :",
    requirementA: "Sur Mac, la seule exigence est ",
    requirementB:
      " — il doit déjà être installé, puis l'installateur configure l'environnement de conteneurs pour vous. Linux : CLI uniquement, expérimental. Windows est un aperçu dans la 0.4.0, CLI uniquement : testé sur Windows 10, pas sur Windows 11. Pas de Node, Python ni tmux sur votre machine : tout vit dans le conteneur.",
    firstRunTitle: "🎬 Votre première exécution",
    firstRunIntro: "Quelle que soit la voie choisie :",
    fr1A: "Configurez votre profil.",
    fr1B: " Discutez avec l'Assistant lors de l'onboarding au premier démarrage",
    fr1C: " — il écrira votre ",
    fr2A: "Alimentez-le avec vos alertes d'emploi (facultatif mais recommandé) — voir ",
    emailForwarding: "Transfert d'e-mails",
    fr3A: "Cliquez sur Start.",
    fr3B: " Le Capitaine répartit Scout → Analyste → Scorer → Rédacteur → Critique ; la Sentinelle maintient tout le monde sous le plafond de dépense.",
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
    subTitle: "🧠 Zuerst der KI-Anbieter",
    subIntroA: "In 0.4.0 läuft das Team mit einem ",
    subIntroB: "GLM-API-Key (Z.ai)",
    subIntroC: " auf dem Pi-Harness, pro Aufruf bezahlt; jht setup fragt danach (verdeckt eingegeben). Nutze ",
    subEmphOne: "einen",
    subIntroD: " Key nur für das Team:",
    codex: " — nicht in dieser Version.",
    apiKey: "(Z.ai) — mit einem API-Key, nach Verbrauch bezahlt: setze ein tägliches Ausgabenlimit.",
    dedicateLabel: "Widme den Key dem Team.",
    dedicateBody: " Nutze keinen Key, den du anderswo verwendest, und setze ein Ausgabenlimit im Team und beim Anbieter. Mehr auf der ",
    pricingPage: "Preisseite",
    pickTitle: "🛤️ Dann wähle, wie du installierst",
    path1Title: "🦞 Weg 1 — Lass es deinen KI-Assistenten erledigen",
    path1Intro:
      "Wenn du einen Coding-Assistenten verwendest, sage ihm etwa Folgendes:",
    path1AfterA: "Er liest die Dokumentation, installiert die CLI, führt ",
    path1AfterB:
      " aus, behebt, was fehlt, und startet das Team. Das ist ein primäres Designziel, kein Trick.",
    path2Title: "🖥️ Weg 2 — Desktop-App: nicht in 0.4.0",
    path2A:
      "In 0.4.0 gibt es keine Desktop-App: Das Team wird über die jht-CLI gesteuert, die du mit dem Einzeiler unten installierst. Auf einem Mac muss Homebrew bereits installiert sein: Der Installer richtet damit Podman ein. Linux: nur CLI, experimentell. Die Voraussetzungen stehen auf ",
    downloadPage: "der Installationsseite",
    path2B:
      ". Windows ist in 0.4.0 eine Vorschau, nur CLI: getestet auf Windows 10, nicht auf Windows 11 (der PowerShell-Installer steht im Quickstart des Repositorys).",
    path3Title: "📦 Weg 3 — Einzeiler-Installer",
    path3Mac: "macOS / Linux:",
    path3WizardIntro: "Dann starte das Team und führe den Assistenten aus:",
    requirementA: "Auf einem Mac ist die einzige Voraussetzung ",
    requirementB:
      " — es muss bereits installiert sein, danach richtet der Installer die Container-Laufzeit für dich ein. Linux: nur CLI, experimentell. Windows ist in 0.4.0 eine Vorschau, nur CLI: getestet auf Windows 10, nicht auf Windows 11. Kein Node, Python oder tmux auf deinem Rechner: alles lebt im Container.",
    firstRunTitle: "🎬 Dein erster Lauf",
    firstRunIntro: "Welchen Weg du auch gewählt hast:",
    fr1A: "Richte dein Profil ein.",
    fr1B: " Chatte mit dem Assistenten im Onboarding beim ersten Start",
    fr1C: " — er schreibt deine ",
    fr2A: "Füttere es mit deinen Job-Benachrichtigungen (optional, aber empfohlen) — siehe ",
    emailForwarding: "E-Mail-Weiterleitung",
    fr3A: "Klicke auf Start.",
    fr3B: " Der Kapitän verteilt Scout → Analyst → Scorer → Schreiber → Kritiker; die Wache hält alle unter dem Ausgabenlimit.",
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
    subTitle: "🧠 Először az AI-szolgáltató",
    subIntroA: "A 0.4.0-ban a csapat egy ",
    subIntroB: "GLM (Z.ai) API-kulccsal",
    subIntroC: " fut a Pi harness-en, hívásonként fizetve; a jht setup elkéri (rejtett beírással). Használj ",
    subEmphOne: "egy",
    subIntroD: " csak a csapatnak szánt kulcsot:",
    codex: " — nincs benne ebben a verzióban.",
    apiKey: "(Z.ai) — API-kulccsal, használat szerint fizetve: állíts be napi költési plafont.",
    dedicateLabel: "Szentelj egy kulcsot a csapatnak.",
    dedicateBody: " Ne használj olyan kulcsot, amelyet máshol is használsz, és állíts be költési plafont a csapatban és a szolgáltatónál is. Bővebben az ",
    pricingPage: "árazási oldalon",
    pickTitle: "🛤️ Aztán válaszd ki, hogyan telepítesz",
    path1Title: "🦞 1. út — Bízd az MI-asszisztensedre",
    path1Intro:
      "Ha kódolási asszisztenst használsz, mondj neki valami ilyesmit:",
    path1AfterA: "Elolvassa a dokumentációt, telepíti a CLI-t, lefuttatja a ",
    path1AfterB:
      " parancsot, kijavítja, ami hiányzik, és elindítja a csapatot. Ez elsődleges tervezési cél, nem trükk.",
    path2Title: "🖥️ 2. út — Asztali alkalmazás: nincs a 0.4.0-ban",
    path2A:
      "A 0.4.0-ban nincs asztali alkalmazás: a csapatot a jht CLI-ből irányítod, amelyet a lenti egysoros paranccsal telepítesz. Macen a Homebrew-nak már telepítve kell lennie: a telepítő ezzel állítja be a Podmant. Linux: csak CLI, kísérleti. A követelményeket a ",
    downloadPage: "telepítési oldalról",
    path2B:
      " nézheted meg. A Windows a 0.4.0-ban előzetes változat, csak CLI: Windows 10-en kipróbálva, Windows 11-en nem (a PowerShell-telepítője a repository Quickstart leírásában van).",
    path3Title: "📦 3. út — Egysoros telepítő",
    path3Mac: "macOS / Linux:",
    path3WizardIntro: "Aztán indítsd el a csapatot, és futtasd a varázslót:",
    requirementA: "Macen az egyetlen követelmény a ",
    requirementB:
      " — már telepítve kell lennie, utána a telepítő beállítja helyetted a konténer-futtatókörnyezetet. Linux: csak CLI, kísérleti. A Windows a 0.4.0-ban előzetes változat, csak CLI: Windows 10-en kipróbálva, Windows 11-en nem. Nincs Node, Python vagy tmux a gépeden: minden a konténeren belül él.",
    firstRunTitle: "🎬 Az első futtatásod",
    firstRunIntro: "Bármelyik utat is választottad:",
    fr1A: "Állítsd be a profilodat.",
    fr1B: " Beszélgess az Asszisztenssel az első indítás bevezetőjében",
    fr1C: " — megírja helyetted a ",
    fr2A: "Tápláld be az állásértesítéseidet (nem kötelező, de ajánlott) — lásd ",
    emailForwarding: "E-mail-továbbítás",
    fr3A: "Kattints a Start gombra.",
    fr3B: " A Kapitány elindítja a Felderítő → Elemző → Pontozó → Író → Kritikus sort; az Őrszem mindenkit a költési plafon alatt tart.",
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
    subTitle: "🧠 Primeiro, o fornecedor de IA",
    subIntroA: "Na 0.4.0 a equipa funciona com uma ",
    subIntroB: "chave de API do GLM (Z.ai)",
    subIntroC: " no harness Pi, paga por uso; o jht setup pede-a (escrita oculta). Usa ",
    subEmphOne: "uma",
    subIntroD: " chave só para a equipa:",
    codex: " — não está nesta versão.",
    apiKey: "(Z.ai) — com uma chave de API, paga por uso: define um teto de gasto diário.",
    dedicateLabel: "Dedica a chave à equipa.",
    dedicateBody: " Não reutilizes uma chave que uses noutro lado, e define um teto de gastos na equipa e no fornecedor. Mais na ",
    pricingPage: "página de preços",
    pickTitle: "🛤️ Depois, escolhe como instalar",
    path1Title: "🦞 Caminho 1 — Deixa o teu assistente de IA fazê-lo",
    path1Intro: "Se usas um assistente de programação, diz-lhe algo como:",
    path1AfterA: "Ele lerá a documentação, instalará a CLI, executará ",
    path1AfterB:
      ", corrigirá o que falta e iniciará a equipa. Este é um objetivo de design primordial, não um truque.",
    path2Title: "🖥️ Via 2 — App de ambiente de trabalho: não está na 0.4.0",
    path2A:
      "Na 0.4.0 não há app de ambiente de trabalho: a equipa é conduzida pela CLI jht, instalada com o comando único abaixo. Num Mac, o Homebrew tem de estar já instalado: o instalador usa-o para configurar o Podman. Linux: só CLI, experimental. Os requisitos estão na ",
    downloadPage: "página de instalação",
    path2B: ". O Windows é uma pré-visualização na 0.4.0, só CLI: testado no Windows 10, não no Windows 11 (o seu instalador PowerShell está no Quickstart do repositório).",
    path3Title: "📦 Caminho 3 — Instalador numa só linha",
    path3Mac: "macOS / Linux:",
    path3WizardIntro: "Depois levanta a equipa e executa o assistente:",
    requirementA: "No Mac, o único requisito é o ",
    requirementB:
      " — tem de estar já instalado, e depois o instalador configura o runtime de contentores por ti. Linux: só CLI, experimental. O Windows é uma pré-visualização na 0.4.0, só CLI: testado no Windows 10, não no Windows 11. Sem Node, Python ou tmux na tua máquina: tudo vive dentro do contentor.",
    firstRunTitle: "🎬 A tua primeira execução",
    firstRunIntro: "Seja qual for o caminho que escolheste:",
    fr1A: "Configura o teu perfil.",
    fr1B: " Conversa com o Assistente no onboarding do primeiro arranque",
    fr1C: " — ele escreve o teu ",
    fr2A: "Alimenta-o com os teus alertas de emprego (opcional, mas recomendado) — vê ",
    emailForwarding: "Reencaminhamento de e-mail",
    fr3A: "Clica em Start.",
    fr3B: " O Capitão despacha Scout → Analista → Scorer → Redator → Crítico; a Sentinela mantém todos dentro do teto de gastos.",
    fr4A: "Revê os resultados",
    dashboardLink: "painel",
    fr4B: ". Nada é submetido automaticamente — és tu que decides o que enviar.",
    stuckA: "🩹 Preso? ",
    stuckB:
      " diz-te exatamente o que falta. Para a configuração sempre ativa, vê ",
    vpsLink: "Executar 24/7 num VPS",
  },
};
