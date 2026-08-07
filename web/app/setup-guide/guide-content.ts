// Capitoli e fasi della guida di setup.
//
// FONTE UNICA: il contratto di HQ-DOCS,
// `docs/internal/2026-08-07-setup-guide-content-contract.md`. Id, titoli,
// corpi, link e id delle schermate sono i suoi, adottati alla radice: non
// esiste una seconda nomenclatura da mappare, e i file che i collaudatori
// consegnano si agganciano da soli perché il nome contiene già l'id.
//
// I quattro capitoli sono i quattro blocchi del contratto: l'indice della
// guida (dal download al primo avvio), la schermata di setup, la schermata
// di avvio, e il collegamento fra team locale e web.
//
// TRADUZIONI: i testi che arrivano dal contratto sono inglesi e passano da
// `untranslated()` finché HQ-FULLSTACK-1 non li traduce — la lacuna è
// esplicita e cercabile, invece di sembrare già fatta. Alt text e didascalie
// delle schermate (`guide-screens.ts`) e il microcopy della pagina
// (`guide-ui.i18n.ts`) sono invece tradotti davvero in tutte e sette.
//
// ⚠️ I requisiti di `check-requirements` sono NUMERI MISURATI. La regola
// dell'operatore: se un numero non è stato misurato, non si scrive. Per
// questo il testo dice esplicitamente che non esiste un minimo di disco —
// quella frase non si taglia per brevità, è la parte più onesta del testo.

import {
  ALT_ASSET,
  CLOUD_SYNC_SETTINGS,
  DASHBOARD,
  DOCKER_URL,
  DOCS_VPS,
  PRICING,
} from "./guide-config";
import { DOCS_TEAM_GMAIL, PRIVACY } from "./guide-config";
import { untranslated, type GuideChapter } from "./guide-types";

/** Segnaposto delle fasi `W02`–`W04`, dal contratto. Dice una cosa diversa
 *  dallo slot generico: non «la stiamo rigirando», ma «arriverà quando ci
 *  sarà un account di prova approvato». */
const GOOGLE_SCREEN_PLACEHOLDER = {
  title: untranslated("Screenshot pending"),
  body: untranslated(
    "This step is fully described below. A privacy-safe image will be added after an isolated Google test account is authorized.",
  ),
};

export const GUIDE_CHAPTERS: GuideChapter[] = [
  {
    id: "guide-index",
    title: untranslated("Set up Job Hunter Team"),
    summary: untranslated(
      "Download Job Hunter Team Desktop, connect your AI subscription, add your CV, and start a working team. Choose your operating system; each chapter shows the exact screen you should see.",
    ),
    phases: [
      {
        id: "choose-setup-path",
        os: "all",
        title: untranslated("Choose your setup path"),
        body: untranslated(
          "Choose macOS, Windows, or Linux, then use the chapter index to move through Setup, Start, and Connect to web. The selected operating system stays active across every chapter.",
        ),
        screen: { screenId: "G00-guide-index" },
      },
      {
        id: "check-requirements",
        os: "all",
        title: {
          en: "Check the requirements",
          it: "Controlla i requisiti",
          es: "Comprueba los requisitos",
          fr: "Vérifiez les prérequis",
          de: "Prüfe die Voraussetzungen",
          pt: "Verifica os requisitos",
          hu: "Ellenőrizd a követelményeket",
        },
        body: {
          en: "Docker is required. For comfortable local use, keep about 8 GB of RAM available before starting the team. In a measured 30-minute Windows run, a 12 GB machine retained more than 4 GB free with the team and Job Hunter Team Desktop active; its 2013 2-core, 4-thread CPU completed the run without saturation. Make sure Docker has room for the team image; no universal disk minimum is stated because one has not been measured. You also need internet access and a supported provider subscription. A dedicated VPS uses a separate validated baseline: Ubuntu 24.04, 4 GB total RAM, 2 vCPU, 80 GB SSD, and 2 GB preventive swap.",
          it: "Docker è obbligatorio. Per un uso locale confortevole, prima di avviare il team assicurati che siano disponibili circa 8 GB di RAM. In un test misurato di 30 minuti su Windows, una macchina con 12 GB ha mantenuto più di 4 GB liberi con il team e Job Hunter Team Desktop attivi; la sua CPU del 2013 con 2 core e 4 thread ha completato il test senza saturarsi. Assicurati che Docker disponga dello spazio necessario per l'immagine del team; non viene indicato un requisito minimo universale di spazio su disco perché non è stato misurato. Servono inoltre una connessione a Internet e un abbonamento presso un provider supportato. Per una VPS dedicata vale una baseline separata e verificata: Ubuntu 24.04, 4 GB di RAM totali, 2 vCPU, SSD da 80 GB e 2 GB di spazio di swap preventivo.",
          es: "Docker es obligatorio. Para un uso local cómodo, asegúrate de tener disponibles unos 8 GB de RAM antes de iniciar el equipo. En una prueba medida de 30 minutos en Windows, una máquina con 12 GB mantuvo más de 4 GB libres con el equipo y Job Hunter Team Desktop activos; su CPU de 2013, con 2 núcleos y 4 hilos, completó la prueba sin saturarse. Asegúrate de que Docker tenga espacio para la imagen del equipo; no se indica un mínimo universal de espacio en disco porque no se ha medido. También necesitas conexión a Internet y una suscripción con un proveedor compatible. Una VPS dedicada utiliza una base de referencia separada y validada: Ubuntu 24.04, 4 GB de RAM total, 2 vCPU, SSD de 80 GB y 2 GB de swap preventivo.",
          fr: "Docker est requis. Pour une utilisation locale confortable, gardez environ 8 Go de RAM disponibles avant de démarrer l’équipe. Lors d’un essai mesuré de 30 minutes sous Windows, une machine équipée de 12 Go a conservé plus de 4 Go libres avec l’équipe et Job Hunter Team Desktop actifs ; son processeur de 2013 à 2 cœurs et 4 threads a terminé l’essai sans saturation. Vérifiez que Docker dispose d’assez d’espace pour l’image de l’équipe ; aucun minimum universel d’espace disque n’est indiqué, car il n’a pas été mesuré. Vous avez également besoin d’un accès à Internet et d’un abonnement auprès d’un fournisseur pris en charge. Un VPS dédié suit une base de référence distincte et validée : Ubuntu 24.04, 4 Go de RAM au total, 2 vCPU, un SSD de 80 Go et 2 Go de swap préventif.",
          de: "Docker ist erforderlich. Für eine komfortable lokale Nutzung sollten vor dem Start des Teams etwa 8 GB RAM verfügbar sein. In einem gemessenen 30-minütigen Windows-Test blieben auf einem Rechner mit 12 GB mehr als 4 GB frei, während das Team und Job Hunter Team Desktop aktiv waren; seine CPU aus dem Jahr 2013 mit 2 Kernen und 4 Threads absolvierte den Test, ohne an die Auslastungsgrenze zu kommen. Stelle sicher, dass Docker genügend Platz für das Docker-Image des Teams hat; ein allgemeingültiges Minimum für den Festplattenspeicher wird nicht angegeben, weil es nicht gemessen wurde. Außerdem benötigst du Internetzugang und ein Abonnement bei einem unterstützten Anbieter. Für einen dedizierten VPS gilt eine separate, validierte Basis: Ubuntu 24.04, insgesamt 4 GB RAM, 2 vCPUs, 80 GB SSD und vorsorglich 2 GB Swap.",
          pt: "O Docker é obrigatório. Para uma utilização local confortável, mantém cerca de 8 GB de RAM disponíveis antes de iniciares a equipa. Num teste medido de 30 minutos no Windows, uma máquina com 12 GB manteve mais de 4 GB livres com a equipa e o Job Hunter Team Desktop ativos; o seu processador de 2013, com 2 núcleos e 4 threads, concluiu o teste sem saturar. Garante que o Docker tem espaço para a imagem Docker da equipa; não é indicado um mínimo universal de espaço em disco porque não foi medido. Também precisas de acesso à Internet e de uma subscrição junto de um fornecedor suportado. Uma VPS dedicada utiliza uma base de referência separada e validada: Ubuntu 24.04, 4 GB de RAM total, 2 vCPU, SSD de 80 GB e 2 GB de swap preventivo.",
          hu: "A Docker szükséges. A kényelmes helyi használathoz a csapat indítása előtt legyen körülbelül 8 GB szabad RAM. Egy mért, 30 perces Windows-futtatás során egy 12 GB-os gépen több mint 4 GB maradt szabadon, miközben a csapat és a Job Hunter Team Desktop aktív volt; a gép 2013-as, 2 magos, 4 szálas processzora telítődés nélkül teljesítette a futtatást. Gondoskodj róla, hogy a Dockernek legyen elegendő helye a csapat Docker-image-éhez; általános minimális lemezterület nincs megadva, mert ilyet nem mértek. Internet-hozzáférésre és egy támogatott szolgáltatónál fennálló előfizetésre is szükséged van. Egy dedikált VPS-re külön, validált alapérték vonatkozik: Ubuntu 24.04, összesen 4 GB RAM, 2 vCPU, 80 GB-os SSD és 2 GB megelőző célú swap.",
        },
        screen: { screenId: "S01-prerequisites" },
        links: [
          {
            kind: "internal",
            href: PRICING,
            label: {
              en: "Compare supported providers",
              it: "Confronta i provider supportati",
              es: "Compara los proveedores compatibles",
              fr: "Comparez les fournisseurs pris en charge",
              de: "Unterstützte Anbieter vergleichen",
              pt: "Compara os fornecedores suportados",
              hu: "Hasonlítsd össze a támogatott szolgáltatókat",
            },
          },
          {
            kind: "internal",
            href: DOCS_VPS,
            label: {
              en: "Run 24/7 on a VPS",
              it: "Esegui il team 24/7 su una VPS",
              es: "Ejecuta el equipo 24/7 en una VPS",
              fr: "Faites tourner l’équipe 24/7 sur un VPS",
              de: "Team rund um die Uhr auf einem VPS betreiben",
              pt: "Executa a equipa 24/7 num VPS",
              hu: "Futtasd a csapatot 24/7 egy VPS-en",
            },
          },
        ],
      },
      {
        id: "install-docker-macos",
        os: ["macos"],
        title: untranslated("Install Docker Desktop on macOS"),
        body: untranslated(
          "Job Hunter Team runs the local team in Docker. If Docker is not installed, download Docker Desktop from the official macOS instructions, install it, and start it before continuing.",
        ),
        screen: { screenId: "S02-docker-download" },
        links: [
          {
            kind: "external",
            href: DOCKER_URL.macos,
            label: untranslated("Get Docker Desktop for Mac"),
          },
        ],
      },
      {
        id: "install-docker-windows",
        os: ["windows"],
        title: untranslated("Install Docker Desktop on Windows"),
        body: untranslated(
          "Job Hunter Team runs the local team in Docker. If Docker is not installed, download Docker Desktop from the official Windows instructions, install it, and start it before continuing.",
        ),
        screen: { screenId: "S02-docker-download" },
        links: [
          {
            kind: "external",
            href: DOCKER_URL.windows,
            label: untranslated("Get Docker Desktop for Windows"),
          },
        ],
      },
      {
        id: "install-docker-linux",
        os: ["linux"],
        title: untranslated("Install Docker Engine on Linux"),
        body: untranslated(
          "Job Hunter Team runs the local team in Docker. If Docker is not installed, choose your distribution in the official Docker Engine instructions, install it, and start it before continuing.",
        ),
        screen: { screenId: "S02-docker-download" },
        links: [
          {
            kind: "external",
            href: DOCKER_URL.linux,
            label: untranslated("Get Docker Engine for Linux"),
          },
        ],
      },
      {
        id: "download-desktop-app",
        os: "all",
        title: untranslated("Download Job Hunter Team Desktop"),
        body: untranslated(
          "Download the latest package for your operating system from the official GitHub Release. On Windows, the installer is the primary choice and the portable executable is available when you do not want to install it.",
        ),
        screen: { screenId: "S03-artifact-download" },
        links: [
          {
            kind: "download",
            os: ["macos"],
            label: untranslated("Download for macOS"),
          },
          {
            kind: "download",
            os: ["windows"],
            label: untranslated("Download the Windows installer"),
          },
          {
            kind: "download",
            os: ["windows"],
            asset: ALT_ASSET.windowsPortable,
            label: untranslated("Download Windows portable"),
          },
          {
            kind: "download",
            os: ["linux"],
            label: untranslated("Download for Linux"),
          },
        ],
      },
      {
        id: "install-macos",
        os: ["macos"],
        title: untranslated("Install on macOS"),
        body: untranslated(
          "Open job-hunter-team.zip, then open the extracted Job Hunter Team app. The current macOS build is signed and notarized.",
        ),
        screen: { screenId: "S04-installation-macos" },
      },
      {
        id: "install-windows",
        os: ["windows"],
        title: untranslated("Open on Windows"),
        body: untranslated(
          "Windows offers two official paths. Run job-hunter-team-windows-x64-setup.exe to install it, or download the portable executable and open it directly. This guide shows the portable path. Continue through a SmartScreen warning only when the file came from the official GitHub Release.",
        ),
        screen: { screenId: "S04-installation-windows" },
      },
      {
        id: "install-linux",
        os: ["linux"],
        title: untranslated("Install on Linux"),
        body: untranslated(
          "Extract job-hunter-team-linux-x64.tar.gz. Allow job-hunter-team.x86_64 to run, enable its executable permission if needed, and open it.",
        ),
        screen: { screenId: "S04-installation-linux" },
      },
      {
        id: "open-for-the-first-time",
        os: "all",
        title: untranslated("Open Job Hunter Team"),
        body: untranslated(
          "On a clean first launch, Job Hunter Team opens with the language picker before the title screen.",
        ),
        screen: { screenId: "S05-first-launch" },
      },
      {
        id: "choose-language",
        os: "all",
        title: untranslated("Choose your language"),
        body: untranslated(
          "Choose one of the seven interface languages. English is preselected on a clean first launch. Confirm the choice to save it on this device.",
        ),
        screen: { screenId: "S06-choose-language" },
      },
      {
        id: "enter-office",
        os: "all",
        title: untranslated("Enter the office"),
        body: untranslated(
          "On the title screen, the name field is optional. Enter the office when you are ready. Exploring the office does not start a live team.",
        ),
        screen: { screenId: "S07-enter-office" },
      },
    ],
  },
  {
    id: "setup-screen",
    title: untranslated("Complete the four setup checks"),
    summary: untranslated(
      "Open Activate team in Job Hunter Team Desktop. Prepare the container, connect a provider, complete your profile, and set working hours. Continue only when all four checks are ready.",
    ),
    phases: [
      {
        id: "open-setup",
        os: "all",
        title: untranslated("Open Activate team"),
        body: untranslated(
          "Select Team setup to open Activate team. A clean setup shows four incomplete checks: Container, AI provider, Profile and CV, and Working hours.",
        ),
        screen: { screenId: "S08-setup-overview-empty" },
      },
      {
        id: "start-container",
        os: "all",
        title: untranslated("Start the container"),
        body: untranslated(
          "Start the isolated workspace. On the first run Job Hunter Team Desktop checks the Docker engine, downloads the team image, and starts the JHT container. Keep it open until the container is ready.",
        ),
        screen: { screenId: "S09-start-container" },
      },
      {
        id: "choose-provider",
        os: "all",
        title: untranslated("Choose an AI provider"),
        body: untranslated(
          "Choose Claude, Codex, or Kimi and the subscription plan you already use. Job Hunter Team uses subscription login and never asks for an API key.",
        ),
        screen: { screenId: "S10-choose-provider" },
        links: [
          {
            kind: "internal",
            href: PRICING,
            label: untranslated("Compare plans"),
          },
        ],
      },
      {
        id: "authorize-provider",
        os: "all",
        title: untranslated("Authorize your subscription"),
        body: untranslated(
          "Open the embedded console and follow the provider login. A browser may open for authorization. Return when the provider screen shows Login detected.",
        ),
        screen: { screenId: "S11-authorize-provider" },
      },
      {
        id: "upload-cv",
        os: "all",
        title: untranslated("Upload your CV"),
        body: untranslated(
          "Open Profile and CV, talk to the Assistant, and upload your CV. The profile badge shows which required fields are still missing.",
        ),
        screen: { screenId: "S12-upload-cv" },
      },
      {
        id: "complete-profile",
        os: "all",
        title: untranslated("Complete your profile"),
        body: untranslated(
          "Confirm name, email, target role, location, experience, seniority, at least two skills, and at least one language. Continue when the badge shows 8/8 fields.",
        ),
        screen: { screenId: "S13-profile-ready" },
      },
      {
        id: "set-working-hours",
        os: "all",
        title: untranslated("Set working hours"),
        body: untranslated(
          "Choose when the team may work and save the schedule. Without working hours the team can run at any time and use your subscription.",
        ),
        screen: { screenId: "S14-working-hours" },
      },
      {
        id: "review-setup",
        os: "all",
        title: untranslated("Review the four checks"),
        body: untranslated(
          "Return to Activate team. Container, AI provider, Profile and CV, and Working hours must all be ready before the team can start.",
        ),
        screen: { screenId: "S15-setup-complete" },
      },
    ],
  },
  {
    id: "start-screen",
    title: untranslated("Activate the team"),
    summary: untranslated(
      "Select Activate the team and keep Job Hunter Team Desktop open while the agents start. Setup is complete only when Team active and an operational agent beyond the Assistant are visible with real, non-demo data.",
    ),
    phases: [
      {
        id: "activate-team",
        os: "all",
        title: untranslated("Activate the team"),
        body: untranslated(
          "Select Activate the team. Job Hunter Team Desktop reports the real startup phase and elapsed time; wait until startup finishes.",
        ),
        screen: { screenId: "S16-team-starting" },
      },
      {
        id: "verify-team-working",
        os: "all",
        title: untranslated("Verify that the team is working"),
        body: untranslated(
          "Confirm Team active, real data, and at least one operational agent beyond the Assistant. Open a live activity or result; a running container alone is not enough.",
        ),
        screen: { screenId: "S17-team-working" },
      },
    ],
  },
  {
    id: "local-web",
    title: untranslated("See your local team on the web"),
    summary: untranslated(
      "Optionally sync positions, profile, and commands with your private dashboard. The team can remain fully local.",
    ),
    phases: [
      {
        id: "open-account-link",
        os: "all",
        title: untranslated("Open the optional web connection"),
        body: untranslated(
          "With the container running, open Settings, then select Account under Account and channels. CLOUD ACCOUNT — local / guest mode means the team is not linked yet. The sign-in control remains unavailable until the container is running.",
        ),
        screen: { screenId: "W01-local-account-entry" },
      },
      {
        id: "sign-in-with-google",
        os: "all",
        title: untranslated("Sign in with Google"),
        body: untranslated(
          "With the container running, open Settings → Account, select Account under Account and channels, then select SIGN IN WITH GOOGLE. The embedded console shows a temporary verification link and one-time code. Open the link. The browser may show the Job Hunter Team sign-in page, Google's account chooser, and a consent screen. Select the Google account that should own your private dashboard. Do not enter the one-time code on any page whose address is not the expected Job Hunter Team site.",
        ),
        screen: { screenId: "W02-google-login" },
        screenFallback: GOOGLE_SCREEN_PLACEHOLDER,
        links: [
          {
            kind: "internal",
            href: CLOUD_SYNC_SETTINGS,
            label: untranslated("Cloud sync settings"),
          },
        ],
      },
      {
        id: "review-permissions",
        os: "all",
        title: untranslated("Review access and approve this device"),
        body: untranslated(
          "Before continuing, review two separate grants. Google sign-in uses only OpenID to authenticate you, email to read your primary email address and verification status, and profile to read basic information such as your display name and profile picture. Job Hunter Team requests no Google Drive, Gmail, Calendar, Contacts, or other Google product access. The optional Team Gmail setup is separate: you explicitly connect a dedicated inbox later with its own app password, stored locally, and it does not add Gmail access to this sign-in. Next, Connect the CLI asks for the one-time code and an optional token name. Confirm pairing issues this installation a revocable Job Hunter Team device token: it may sync positions and profile data to your private dashboard and receive dashboard commands for the local team. It never contains or stores your Google password or browser cookies. Continue only if the Google account and these uses are correct.",
        ),
        screen: { screenId: "W03-permissions" },
        screenFallback: GOOGLE_SCREEN_PLACEHOLDER,
        links: [
          {
            kind: "internal",
            href: PRIVACY,
            label: untranslated("Privacy policy"),
          },
          {
            kind: "internal",
            href: DOCS_TEAM_GMAIL,
            label: untranslated("Set up a separate team inbox"),
          },
          {
            kind: "internal",
            href: CLOUD_SYNC_SETTINGS,
            label: untranslated("Manage devices and revoke access"),
          },
        ],
      },
      {
        id: "verify-dashboard-sync",
        os: "all",
        title: untranslated("Verify the dashboard sync"),
        body: untranslated(
          "After Pairing complete, return to Settings → Account in Job Hunter Team Desktop. Confirm CLOUD ACCOUNT — connected and DEVICE — paired, or the safe token name you chose, then select SYNC NOW. Open the dashboard with the same Google account. ✓ Cloud sync means the local and cloud counts match; ◐ To sync means changes are still pending. Last: shows when the most recent successful sync completed. Confirm that the dashboard shows the same profile and positions as the local team. If it is empty, wait until the team has produced a scored position, select SYNC NOW again, and refresh the dashboard. If the app still says local / guest mode, repeat sign-in and pairing. You can stop future sync at any time by revoking the device under Cloud sync settings; local data is not deleted.",
        ),
        // Due immagini di proposito: il contratto vieta di mettere finestra
        // dell'app e browser collegato in un unico frame.
        screen: [
          { screenId: "W04a-local-linked" },
          { screenId: "W04b-dashboard-synced" },
        ],
        screenFallback: GOOGLE_SCREEN_PLACEHOLDER,
        links: [
          {
            kind: "internal",
            href: DASHBOARD,
            label: untranslated("Open the dashboard"),
          },
          {
            kind: "internal",
            href: CLOUD_SYNC_SETTINGS,
            label: untranslated("Manage devices and revoke access"),
          },
        ],
      },
    ],
  },
];
