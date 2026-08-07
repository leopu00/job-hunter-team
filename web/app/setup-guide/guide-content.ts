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
        // Nessuna schermata: il selettore OS e l'indice dei capitoli sono
        // dal vivo appena sopra questa fase. Mostrare qui una foto della
        // pagina che il lettore sta già guardando non aggiungerebbe nulla
        // — decisione di HQ-DOCS del 7 agosto 2026, che ha cancellato la
        // richiesta PNG di `G00` e il suo duplicato mobile.
      },
      {
        id: "check-requirements",
        os: "all",
        title: untranslated("Check the requirements"),
        body: untranslated(
          "Docker is required. For comfortable local use, keep about 8 GB of RAM available before starting the team. In a measured 30-minute Windows run, a 12 GB machine retained more than 4 GB free with the team and Job Hunter Team Desktop active; its 2013 2-core, 4-thread CPU completed the run without saturation. Make sure Docker has room for the team image; no universal disk minimum is stated because one has not been measured. You also need internet access and a supported provider subscription. A dedicated VPS uses a separate validated baseline: Ubuntu 24.04, 4 GB total RAM, 2 vCPU, 80 GB SSD, and 2 GB preventive swap.",
        ),
        // La scheda dei requisiti è costruita nella pagina, non fotografata:
        // vedi `RequirementsCard`. Lo slot `S01` resta dichiarato nel
        // registro finché DOCS non conferma che l'immagine non serve più.
        card: "requirements",
        links: [
          {
            kind: "internal",
            href: PRICING,
            label: untranslated("Compare supported providers"),
          },
          {
            kind: "internal",
            href: DOCS_VPS,
            label: untranslated("Run 24/7 on a VPS"),
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
