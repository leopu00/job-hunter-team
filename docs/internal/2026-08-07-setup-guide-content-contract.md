# Setup guide content contract — 2026-08-07

This is the English source and screenshot contract for the unpublished public
setup guide. It reflects the desktop app, download page, and cloud-sync flow at
commit `7ae462e578378f15778e9219b59a3b6437d3d2e5`.

## Naming

Use **Setup Guide** at `/setup-guide` and call the installable artifact the
**Job Hunter Team desktop app** (short form: **desktop app**). This is the most
literal pair, matches the existing Download page, and does not frame the
product as a game.

Acceptable alternatives:

1. **Getting Started** at `/getting-started` + **Job Hunter Team desktop app**.
   Friendlier, but less explicit when linked next to Download and How to run.
2. **Install and Start** at `/install-and-start` + **Job Hunter Team desktop
   client**. Precise, but “client” understates that the app controls the local
   team.

Retire `/tutorials` as a public duplicate: redirect it to `/setup-guide` and
move the non-setup product tour under `/docs`. Keep `/setup-guide` unlinked and
`noindex` until the operator approves publication.

## Page-level English copy

### Guide index

**Title:** Set up Job Hunter Team

**Lead:** Download the desktop app, connect your AI subscription, add your CV,
and start a working team. Choose your operating system; each chapter shows the
exact screen you should see.

**Before you begin:** For a local team, keep about 3–4 GB of RAM free in
addition to the memory used by your operating system and other apps. This is an
operational estimate, not a guaranteed minimum; memory can spike when all eight
agents are active. Also check Docker's current requirements for your operating
system. A dedicated VPS has a separate validated baseline: Ubuntu 24.04, 4 GB
of total RAM, 2 vCPU, 80 GB SSD, and 2 GB of preventive swap. See
**Run 24/7 on a VPS**. Allow time for the first container image download; its
duration depends on your computer and connection. Job Hunter Team does not ask
for an API key: use a supported provider subscription.

Editorial provenance: the local 3–4 GB value is an operational estimate carried
by the [root README](../../README.md),
[Quickstart](../guides/QUICKSTART.md), and
[AI agent integration guide](../guides/AI-AGENT-INTEGRATION.md). No benchmark
report or enforced minimum was found, so the public guide must not describe it
as one. The dedicated-server figures come from the separately validated
[VPS page](../../web/app/docs/guides/run-on-a-vps/page.tsx); the preventive swap
behavior is documented in [VPS setup](../guides/VPS-SETUP.md).

### Setup screen

**Title:** Complete the four setup checks

**Lead:** Open **Activate team** in the desktop app. The office remains usable
while you prepare the container, connect a provider, complete your profile,
and set working hours. Continue only when all four checks are ready.

### Start screen

**Title:** Activate the team

**Lead:** Select **Activate the team** and keep the app open while the agents
start. Setup is complete only when the app shows **Team active** and at least
one operational agent beyond the Assistant is working with real, non-demo
data.

### Connect the local team to the web

**Title:** See your local team on the web

**Lead:** This optional connection syncs positions, profile, and commands with
your private dashboard. The team can remain fully local.

**Google sign-in:** In the desktop app, open **Settings → Account** and select
**Sign in with Google**. Use Google only to authenticate your web account. Job
Hunter Team's application code requests no additional Google product scopes;
review the permissions Google actually lists before continuing.

**Device authorization:** Approve the pairing in the browser. The local team
stores a revocable device token. It never stores your Google password or
browser cookies.

**Verify sync:** Return to **Settings → Account** and confirm **CLOUD ACCOUNT
— connected** and **DEVICE — paired**. Open the dashboard and check for
**✓ Cloud sync** and a recent **Last:** time. The desktop app and dashboard
must show the same data.

## TypeScript handoff

```ts
export const SETUP_GUIDE = {
  slug: "/setup-guide",
  pageName: "Setup Guide",
  artifactName: "Job Hunter Team desktop app",
  blocks: [
    {
      id: "guide-index",
      title: "Set up Job Hunter Team",
      body: "Download the desktop app, connect your AI subscription, add your CV, and start a working team. Choose your operating system; each chapter shows the exact screen you should see.",
    },
    {
      id: "setup-screen",
      title: "Complete the four setup checks",
      body: "Open Activate team in the desktop app. Prepare the container, connect a provider, complete your profile, and set working hours. Continue only when all four checks are ready.",
    },
    {
      id: "start-screen",
      title: "Activate the team",
      body: "Select Activate the team and keep the app open while the agents start. Setup is complete only when Team active and an operational agent beyond the Assistant are visible with real, non-demo data.",
    },
    {
      id: "local-web",
      title: "See your local team on the web",
      body: "Optionally sync positions, profile, and commands with your private dashboard. The team can remain fully local.",
    },
  ],
  phases: [
    {
      id: "choose-setup-path",
      title: "Choose your setup path",
      body: "Choose macOS, Windows, or Linux, then use the chapter index to move through Setup, Start, and Connect to web. The selected operating system stays active across every chapter.",
      os: "all",
      screen: ["G00-guide-index", "G00-guide-index-mobile"],
      links: [],
    },
    {
      id: "check-requirements",
      title: "Check the requirements",
      body: "For a local team, keep about 3–4 GB of RAM free beyond what your operating system and other apps use. This is an operational estimate, not a guaranteed minimum; memory can spike when all eight agents are active. You also need internet access, a supported provider subscription, and a computer that meets Docker's current requirements for your operating system. A dedicated VPS uses a separate validated baseline: Ubuntu 24.04, 4 GB total RAM, 2 vCPU, 80 GB SSD, and 2 GB preventive swap.",
      os: "all",
      screen: "S01-prerequisites",
      links: [
        { label: "Compare supported providers", href: "/pricing" },
        { label: "Run 24/7 on a VPS", href: "/docs/guides/run-on-a-vps" },
      ],
    },
    {
      id: "install-docker-macos",
      title: "Install Docker Desktop on macOS",
      body: "Job Hunter Team runs the local team in Docker. If Docker is not installed, download Docker Desktop from the official macOS instructions, install it, and start it before continuing.",
      os: ["macos"],
      screen: "S02-docker-download",
      links: [{ label: "Get Docker Desktop for Mac", href: "https://docs.docker.com/desktop/setup/install/mac-install/" }],
    },
    {
      id: "install-docker-windows",
      title: "Install Docker Desktop on Windows",
      body: "Job Hunter Team runs the local team in Docker. If Docker is not installed, download Docker Desktop from the official Windows instructions, install it, and start it before continuing.",
      os: ["windows"],
      screen: "S02-docker-download",
      links: [{ label: "Get Docker Desktop for Windows", href: "https://docs.docker.com/desktop/setup/install/windows-install/" }],
    },
    {
      id: "install-docker-linux",
      title: "Install Docker Engine on Linux",
      body: "Job Hunter Team runs the local team in Docker. If Docker is not installed, choose your distribution in the official Docker Engine instructions, install it, and start it before continuing.",
      os: ["linux"],
      screen: "S02-docker-download",
      links: [{ label: "Get Docker Engine for Linux", href: "https://docs.docker.com/engine/install/" }],
    },
    {
      id: "download-desktop-app",
      title: "Download the desktop app",
      body: "Open Download, keep Desktop selected, and choose the package for this operating system.",
      os: "all",
      screen: "S03-artifact-download",
      links: [{ label: "Download Job Hunter Team", href: "/download" }],
    },
    {
      id: "install-macos",
      title: "Install on macOS",
      body: "Open job-hunter-team.zip, then open the extracted Job Hunter Team app. The current macOS build is signed and notarized.",
      os: ["macos"],
      screen: "S04-installation-macos",
      links: [],
    },
    {
      id: "install-windows",
      title: "Install on Windows",
      body: "Run job-hunter-team-windows-x64-setup.exe and complete the installer. Continue through a warning only when the file came from the official Download page.",
      os: ["windows"],
      screen: "S04-installation-windows",
      links: [],
    },
    {
      id: "install-linux",
      title: "Install on Linux",
      body: "Extract job-hunter-team-linux-x64.tar.gz. Allow job-hunter-team.x86_64 to run, enable its executable permission if needed, and open it.",
      os: ["linux"],
      screen: "S04-installation-linux",
      links: [],
    },
    {
      id: "open-for-the-first-time",
      title: "Open Job Hunter Team",
      body: "The first complete app window is the language picker. If it does not appear, reset only the app language preference before capturing or testing a clean start.",
      os: "all",
      screen: "S05-first-launch",
      links: [],
    },
    {
      id: "choose-language",
      title: "Choose your language",
      body: "Choose one of the seven interface languages. English is preselected on a clean first launch. Confirm the choice to save it on this device.",
      os: "all",
      screen: "S06-choose-language",
      links: [],
    },
    {
      id: "enter-office",
      title: "Enter the office",
      body: "On the title screen, leave the optional name field empty or use a neutral fixture name, then enter the office. Exploring the office does not start a live team.",
      os: "all",
      screen: "S07-enter-office",
      links: [],
    },
    {
      id: "open-setup",
      title: "Open Activate team",
      body: "Select Team setup to open Activate team. A clean setup shows four incomplete checks: Container, AI provider, Profile and CV, and Working hours.",
      os: "all",
      screen: "S08-setup-overview-empty",
      links: [],
    },
    {
      id: "start-container",
      title: "Start the container",
      body: "Start the isolated workspace. On the first run the app checks the Docker engine, downloads the team image, and starts the JHT container. Keep the app open until the container is ready.",
      os: "all",
      screen: "S09-start-container",
      links: [],
    },
    {
      id: "choose-provider",
      title: "Choose an AI provider",
      body: "Choose Claude, Codex, or Kimi and the subscription plan you already use. Job Hunter Team uses subscription login and never asks for an API key.",
      os: "all",
      screen: "S10-choose-provider",
      links: [{ label: "Compare plans", href: "/pricing" }],
    },
    {
      id: "authorize-provider",
      title: "Authorize your subscription",
      body: "Open the embedded console and follow the provider login. A browser may open for authorization. Return when the provider screen shows Login detected.",
      os: "all",
      screen: "S11-authorize-provider",
      links: [],
    },
    {
      id: "upload-cv",
      title: "Upload your CV",
      body: "Open Profile and CV, talk to the Assistant, and upload your CV. The profile badge shows which required fields are still missing.",
      os: "all",
      screen: "S12-upload-cv",
      links: [],
    },
    {
      id: "complete-profile",
      title: "Complete your profile",
      body: "Confirm name, email, target role, location, experience, seniority, at least two skills, and at least one language. Continue when the badge shows 8/8 fields.",
      os: "all",
      screen: "S13-profile-ready",
      links: [],
    },
    {
      id: "set-working-hours",
      title: "Set working hours",
      body: "Choose when the team may work and save the schedule. Without working hours the team can run at any time and use your subscription.",
      os: "all",
      screen: "S14-working-hours",
      links: [],
    },
    {
      id: "review-setup",
      title: "Review the four checks",
      body: "Return to Activate team. Container, AI provider, Profile and CV, and Working hours must all be ready before the team can start.",
      os: "all",
      screen: "S15-setup-complete",
      links: [],
    },
    {
      id: "activate-team",
      title: "Activate the team",
      body: "Select Activate the team. The app reports the real startup phase and elapsed time; wait until startup finishes.",
      os: "all",
      screen: "S16-team-starting",
      links: [],
    },
    {
      id: "verify-team-working",
      title: "Verify that the team is working",
      body: "Confirm Team active, real data, and at least one operational agent beyond the Assistant. Open a live activity or result; a running container alone is not enough.",
      os: "all",
      screen: "S17-team-working",
      links: [],
    },
    {
      id: "open-account-link",
      title: "Open the optional web connection",
      body: "With the container running, open Settings, then Account. Local or guest mode means the team is not linked yet.",
      os: "all",
      screen: "W01-local-account-entry",
      links: [],
    },
    {
      id: "sign-in-with-google",
      title: "Sign in with Google",
      body: "Select Sign in with Google and complete sign-in in an isolated browser. Google authenticates your web account; do not continue from a browser that exposes another account.",
      os: "all",
      screen: "W02-google-login",
      links: [{ label: "Cloud sync settings", href: "/settings/cloud-sync" }],
    },
    {
      id: "review-permissions",
      title: "Review and grant access",
      body: "Review the permissions Google actually lists. The app requests no additional Google product scopes. The local team receives a revocable device token, never your Google password or browser cookies.",
      os: "all",
      screen: "W03-permissions",
      links: [],
    },
    {
      id: "verify-dashboard-sync",
      title: "Verify the dashboard sync",
      body: "Confirm CLOUD ACCOUNT — connected and DEVICE — paired in the desktop app. In the web dashboard, confirm ✓ Cloud sync, a recent Last: time, and the same positions and profile.",
      os: "all",
      screen: ["W04a-local-linked", "W04b-dashboard-synced"],
      links: [{ label: "Open the dashboard", href: "/dashboard" }],
    },
  ],
} as const;
```

## Screenshot rules

Each logical screen ID maps to `<ID>-<slug>-<os>.png`, where `os` is
`linux`, `macos`, or `windows`. Capture the complete product window or browser
viewport in English at native resolution. `G00-guide-index` needs each selected
OS state plus `G00-guide-index-mobile.png` at a 390 px viewport.
`S05-first-launch` may reuse `S06-choose-language` because the language picker
is the first clean-launch screen. `W04` deliberately uses two source images
rather than placing an app window and a signed-in browser in one raw frame.

`S01-prerequisites` is the guide requirement card. Its local-computer row shows
about 3–4 GB of RAM **free beyond the operating system and other apps**, marks
that value as an operational estimate rather than a guaranteed minimum, and
warns that all eight active agents can cause memory spikes. Its separate VPS
note shows the validated Ubuntu 24.04 baseline of 4 GB total RAM, 2 vCPU,
80 GB SSD, and 2 GB preventive swap, with a link to **Run 24/7 on a VPS**. The
card also shows internet access, a provider subscription, and a prompt to check
the selected platform's Docker requirements. It must not present CPU or disk
figures as universal local-computer requirements.
`S02-docker-download` is the official Docker installation page for the target
OS: Docker Desktop on macOS/Windows, Docker Engine on Linux. It is not an app
screen, because the desktop app has not been downloaded at that point.

Screens must contain no real name, email, CV, file path, account identifier,
device identifier, user ID, token, authorization code, notification, or other
personal surface. Do not blur. Use an isolated, approved synthetic fixture or
recapture. A mock/simulation frame cannot prove `S17-team-working`.

## Existing-image census

| Source | Existing usable material | Decision for this guide |
| --- | --- | --- |
| `web/public/tutorials/game/` | `office-overview.png` and `departments.png`, 1600×900, synthetic, English, privacy-attested in `docs/about/TUTORIAL-GAME-SCREENSHOTS.md` | Reusable only for a later product-exploration section. They do not prove setup or a live working team. |
| `docs/about/TUTORIAL-GAME-SCREENSHOTS.md` | Provenance, hashes, and privacy attestation for the two public images | Reuse the attestation process, not the images for `S17`. |
| Linux E2E runs | Setup plans and blocked attempts; landscape public-site/install baselines; later 1920×1080 office/dashboard/activity candidates under local regia | No accepted setup-guide frame. Prior attempts were blocked by privacy or do not attest the new logical state. Linux reports `G00`, `S01–S17`, and `W01–W04` missing. The existing office and positions candidates do not prove `TEAM ACTIVE`. |
| Windows E2E runs | 83 PNGs from the 2026-08-03 runs and later setup protocols; 58 files are malformed | No reuse. `S02–S11`, `S13–S17`, `W01`, and `W02` can be recaptured. `G00`/`S01` wait for the new page; `S12` waits for a canonical neutral `sample-cv.pdf`; `W03` and `W04` wait for an attested non-personal Google test account and paired sync fixture. Old candidates were Italian, obsolete/portable artifacts, mock data, a stopped team, or the wrong state. A remote authentication raw is not clean and must not be distributed. |
| macOS E2E runs | Finder/first-window/language/onboarding evidence; setup busy states; live profile/roster evidence | No reuse. Old candidates show an obsolete artifact, Italian simulation/mock states, or an idle roster backed by zero jobs; they do not prove the required English real state. Every phase needs a new capture. `S13` and `W02–W04` remain missing without explicitly safe fixtures/account access. |
| `regia/tutorial-2026-08-rel008/incoming/` | Linux G16-H department-zoom reference, gate reports, analysis frames, and OCR crops; no macOS or Windows material | Not reusable for `G00`, `S01–S17`, or `W01–W04`: it is an exploration/department shot, not a setup or working-team state. |

The current public screenshots therefore reduce no required capture count yet.
Reuse is allowed only after the E2E owner returns an `ID → asset → privacy →
semantic-state → quality` matrix.
