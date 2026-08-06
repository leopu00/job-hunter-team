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
import { untranslated, type GuideChapter } from "./guide-types";

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
        title: untranslated("Check the requirements"),
        body: untranslated(
          "Docker is required. For comfortable local use, keep about 8 GB of RAM available before starting the team. In a measured 30-minute Windows run, a 12 GB machine retained more than 4 GB free with the team and Job Hunter Team Desktop active; its 2013 2-core, 4-thread CPU completed the run without saturation. Make sure Docker has room for the team image; no universal disk minimum is stated because one has not been measured. You also need internet access and a supported provider subscription. A dedicated VPS uses a separate validated baseline: Ubuntu 24.04, 4 GB total RAM, 2 vCPU, 80 GB SSD, and 2 GB preventive swap.",
        ),
        screen: { screenId: "S01-prerequisites" },
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
          "Select SIGN IN WITH GOOGLE. The embedded console shows a one-time link and code. Open the link, sign in to the web with Google if asked, and enter the code on Connect the CLI. The OAuth call requests no explicit additional scopes; review the Google screen shown to you instead of relying on a fixed permission list.",
        ),
        screen: { screenId: "W02-google-login" },
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
        title: untranslated("Approve this device"),
        body: untranslated(
          "On Connect the CLI, add an optional token name and select Confirm pairing. Pairing complete authorizes this device to sync positions, profile, and commands. Return to Settings → Account and select SYNC NOW. The local team receives a revocable device token, never your Google password or browser cookies.",
        ),
        screen: { screenId: "W03-permissions" },
      },
      {
        id: "verify-dashboard-sync",
        os: "all",
        title: untranslated("Verify the dashboard sync"),
        body: untranslated(
          "Confirm CLOUD ACCOUNT — connected and DEVICE — paired in Job Hunter Team Desktop. In the web dashboard, confirm ✓ Cloud sync, a recent Last: time, and the same positions and profile.",
        ),
        // Due immagini di proposito: il contratto vieta di mettere finestra
        // dell'app e browser collegato in un unico frame.
        screen: [
          { screenId: "W04a-local-linked" },
          { screenId: "W04b-dashboard-synced" },
        ],
        links: [
          {
            kind: "internal",
            href: DASHBOARD,
            label: untranslated("Open the dashboard"),
          },
        ],
      },
    ],
  },
];
