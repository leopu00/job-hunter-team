# Setup guide content contract — 2026-08-07

This is the English source and screenshot contract for the unpublished public
setup guide. It reflects Job Hunter Team Desktop, the download page, and the cloud-sync flow at
commit `7ae462e578378f15778e9219b59a3b6437d3d2e5`.

## Naming

The page name and the installable product name are separate decisions. The
recommended pair is **Setup Guide** + **Job Hunter Team Desktop**.

| Page name | Route | Advantage | Trade-off |
| --- | --- | --- | --- |
| **Setup Guide** — recommended | `/setup-guide` | Immediately clear next to Download and Docs; describes the whole path through activation. | Functional rather than editorial in tone. |
| **Getting Started** | `/getting-started` | Friendly and familiar to first-time users. | Can be confused with the existing getting-started documentation. |
| **Install & Activate** | `/install-and-activate` | States the concrete outcome and avoids “tutorial”. | Narrower and less future-proof if the guide later adds daily-use chapters. |

| Installable name | Advantage | Trade-off |
| --- | --- | --- |
| **Job Hunter Team Desktop** — recommended | A product name rather than a generic “app”; matches the Desktop choice on Download and does not imply a game. | Its first mention must explain that it controls the team running locally. |
| **Job Hunter Team Local Office** | Reinforces the local/private model and the office metaphor visible in the product. | Can sound like a workspace or service instead of a downloadable program. |
| **Job Hunter Team Desktop Client** | Clearly distinguishes the installed surface from the web dashboard. | “Client” suggests a thin remote front end, while the team actually runs on the user's machine. |

Retire `/tutorials` as a setup entry point: permanently redirect it to
`/setup-guide`. Preserve only its exploratory office content, moved under
`/docs` and renamed **Product Tour**. Keep `/setup-guide` unlinked and `noindex`
until the operator approves publication.

## Page-level English copy

### Guide index

**Title:** Set up Job Hunter Team

**Lead:** Download Job Hunter Team Desktop, connect your AI subscription, add
your CV, and start a working team. Choose your operating system; each chapter
shows the exact screen you should see.

**Before you begin:** Docker is required. For comfortable local use, keep about
8 GB of RAM available before starting the team. This recommendation is based
on a measured 30-minute Windows run: with the team and Job Hunter Team Desktop
active, a 12 GB machine still had more than 4 GB free. The same run completed
without saturation on a 2013 2-core, 4-thread CPU. Make sure Docker has room for
the team image; no universal disk minimum is stated because one has not been
measured. A dedicated VPS has a separate validated baseline: Ubuntu 24.04,
4 GB of total RAM, 2 vCPU, 80 GB SSD, and 2 GB of preventive swap. See
**Run 24/7 on a VPS**. Allow time for the first image download; its duration
depends on your computer and connection. Job Hunter Team does not ask for an
API key: use a supported provider subscription.

Editorial provenance: the local guidance comes from the Windows v0.3.5
30-minute load profile at E2E commit `6b4fca9`. The combined run used
7,949.36 MiB of host RAM on average, peaked at 8,003.24 MiB, and retained at
least 4,163.18 MiB free on a 12 GB ThinkPad with an Intel i5-4300U (2 cores,
4 threads). Host CPU averaged 51.14% and peaked at 63%; there was no OOM,
restart, or CPU/disk saturation. The macOS profile measured the desktop client
at 1.56% host CPU and 1,191 MiB RSS on an M3 Pro, but its operational-agent
slice was blocked, so it is not used to infer a whole-team requirement. The
dedicated-server figures come from the separately validated
[VPS page](../../web/app/docs/guides/run-on-a-vps/page.tsx); the preventive swap
behavior is documented in [VPS setup](../guides/VPS-SETUP.md).

### Setup screen

**Title:** Complete the four setup checks

**Lead:** Open **Activate team** in Job Hunter Team Desktop. The office remains usable
while you prepare the container, connect a provider, complete your profile,
and set working hours. Continue only when all four checks are ready.

### Start screen

**Title:** Activate the team

**Lead:** Select **Activate the team** and keep Job Hunter Team Desktop open while the agents
start. Setup is complete only when it shows **Team active** and at least
one operational agent beyond the Assistant is working with real, non-demo
data.

### Connect the local team to the web

**Title:** See your local team on the web

**Lead:** This optional connection syncs positions, profile, and commands with
your private dashboard. The team can remain fully local.

**Google sign-in:** With the container running, open **Settings → Account** in
Job Hunter Team Desktop, then select the **Account** tile under **Account and
channels** and select **Sign in with Google**. The embedded console shows a
one-time link and code. Open the link, sign in to the web with Google if asked,
and enter the code. Google authenticates the web account. The OAuth call
requests no explicit additional scopes; the guide must not claim which consent
permissions Google will display before that screen is measured with an
approved test account.

**Device authorization:** On **Connect the CLI**, enter the one-time code, add
an optional token name if useful, and select **Confirm pairing**. **Pairing
complete** means this device may sync positions, profile, and commands with the
account. Return to **Settings → Account** and select **Sync now**. The local
team stores a revocable device token. It never stores your Google password or
browser cookies.

**Verify sync:** Return to **Settings → Account** and confirm **CLOUD ACCOUNT
— connected** and **DEVICE — paired**. Open the dashboard and check for
**✓ Cloud sync** and a recent **Last:** time. Job Hunter Team Desktop and the dashboard
must show the same data.

## TypeScript handoff

```ts
export const SETUP_GUIDE = {
  slug: "/setup-guide",
  pageName: "Setup Guide",
  artifactName: "Job Hunter Team Desktop",
  blocks: [
    {
      id: "guide-index",
      title: "Set up Job Hunter Team",
      body: "Download Job Hunter Team Desktop, connect your AI subscription, add your CV, and start a working team. Choose your operating system; each chapter shows the exact screen you should see.",
    },
    {
      id: "setup-screen",
      title: "Complete the four setup checks",
      body: "Open Activate team in Job Hunter Team Desktop. Prepare the container, connect a provider, complete your profile, and set working hours. Continue only when all four checks are ready.",
    },
    {
      id: "start-screen",
      title: "Activate the team",
      body: "Select Activate the team and keep Job Hunter Team Desktop open while the agents start. Setup is complete only when Team active and an operational agent beyond the Assistant are visible with real, non-demo data.",
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
      body: "Docker is required. For comfortable local use, keep about 8 GB of RAM available before starting the team. In a measured 30-minute Windows run, a 12 GB machine retained more than 4 GB free with the team and Job Hunter Team Desktop active; its 2013 2-core, 4-thread CPU completed the run without saturation. Make sure Docker has room for the team image; no universal disk minimum is stated because one has not been measured. You also need internet access and a supported provider subscription. A dedicated VPS uses a separate validated baseline: Ubuntu 24.04, 4 GB total RAM, 2 vCPU, 80 GB SSD, and 2 GB preventive swap.",
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
      title: "Download Job Hunter Team Desktop",
      body: "Download the latest package for your operating system from the official GitHub Release. On Windows, the installer is the primary choice and the portable executable is available when you do not want to install it.",
      os: "all",
      screen: "S03-artifact-download",
      links: [
        { label: "Download for macOS", href: "https://github.com/leopu00/job-hunter-team/releases/latest/download/job-hunter-team.zip", os: ["macos"] },
        { label: "Download the Windows installer", href: "https://github.com/leopu00/job-hunter-team/releases/latest/download/job-hunter-team-windows-x64-setup.exe", os: ["windows"] },
        { label: "Download Windows portable", href: "https://github.com/leopu00/job-hunter-team/releases/latest/download/job-hunter-team-windows-x64-portable.exe", os: ["windows"] },
        { label: "Download for Linux", href: "https://github.com/leopu00/job-hunter-team/releases/latest/download/job-hunter-team-linux-x64.tar.gz", os: ["linux"] },
      ],
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
      title: "Open on Windows",
      body: "Windows offers two official paths. Run job-hunter-team-windows-x64-setup.exe to install it, or download the portable executable and open it directly. This guide shows the portable path. Continue through a SmartScreen warning only when the file came from the official GitHub Release.",
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
      body: "On a clean first launch, Job Hunter Team opens with the language picker before the title screen.",
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
      body: "On the title screen, the name field is optional. Enter the office when you are ready. Exploring the office does not start a live team.",
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
      body: "Start the isolated workspace. On the first run Job Hunter Team Desktop checks the Docker engine, downloads the team image, and starts the JHT container. Keep it open until the container is ready.",
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
      body: "Select Activate the team. Job Hunter Team Desktop reports the real startup phase and elapsed time; wait until startup finishes.",
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
      body: "With the container running, open Settings, then select Account under Account and channels. CLOUD ACCOUNT — local / guest mode means the team is not linked yet. The sign-in control remains unavailable until the container is running.",
      os: "all",
      screen: "W01-local-account-entry",
      links: [],
    },
    {
      id: "sign-in-with-google",
      title: "Sign in with Google",
      body: "Select SIGN IN WITH GOOGLE. The embedded console shows a one-time link and code. Open the link, sign in to the web with Google if asked, and enter the code on Connect the CLI. The OAuth call requests no explicit additional scopes; review the Google screen shown to you instead of relying on a fixed permission list.",
      os: "all",
      screen: "W02-google-login",
      links: [{ label: "Cloud sync settings", href: "/settings/cloud-sync" }],
    },
    {
      id: "review-permissions",
      title: "Approve this device",
      body: "On Connect the CLI, add an optional token name and select Confirm pairing. Pairing complete authorizes this device to sync positions, profile, and commands. Return to Settings → Account and select SYNC NOW. The local team receives a revocable device token, never your Google password or browser cookies.",
      os: "all",
      screen: "W03-permissions",
      links: [],
    },
    {
      id: "verify-dashboard-sync",
      title: "Verify the dashboard sync",
      body: "Confirm CLOUD ACCOUNT — connected and DEVICE — paired in Job Hunter Team Desktop. In the web dashboard, confirm ✓ Cloud sync, a recent Last: time, and the same positions and profile.",
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
Docker as required and recommends keeping about 8 GB of RAM available before
starting the team. The evidence note says that a measured 30-minute Windows
run on a 12 GB machine retained more than 4 GB free with the complete product
active, and that its 2013 2-core, 4-thread CPU completed the run without
saturation. For disk, it says only to leave room for the Docker image: no
unmeasured number appears. Its separate VPS note shows the validated Ubuntu
24.04 baseline of 4 GB total RAM, 2 vCPU, 80 GB SSD, and 2 GB preventive swap,
with a link to **Run 24/7 on a VPS**. The card also shows internet access and a
provider subscription. It must not present the VPS figures as universal local
requirements.
`S02-docker-download` is the official Docker installation page for the target
OS: Docker Desktop on macOS/Windows, Docker Engine on Linux. It is not an app
screen, because Job Hunter Team Desktop has not been downloaded at that point.
`S04-installation-windows` uses the official portable build as a declared
Windows variant: show
`job-hunter-team-windows-x64-portable.exe` downloaded and ready to open, or the
English Job Hunter Team window immediately after opening it. Do not show the
localized installer UI. The installer remains the primary public download and
the copy must present both official paths; the portable path is illustrated
because the installer language follows the host and cannot be switched safely
on the recording machine.

`S05-first-launch` is a clean first launch at the English language picker.
`S07-enter-office` uses an empty optional name field or a neutral fixture name.
`W02-google-login` is blocked for an English capture until the embedded
technical-terminal title and hint are localized: they are currently hardcoded
in Italian even when the rest of the product is English. Do not publish the
Italian frame and do not fabricate an English replacement. After that product
fix, the frame may show only the pairing instructions, with every code and
account detail excluded. `W03-permissions` uses the real English web title
**Connect the CLI** and shows the device-approval state without an email,
avatar, device identifier, or authorization code. `W04a-local-linked` and
`W04b-dashboard-synced` show only the exact connected/sync labels defined above
and synthetic profile/position data.

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
