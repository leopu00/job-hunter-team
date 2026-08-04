# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [0.3.4] — 2026-08-04

**A release you can trust at the moment it says “ready”** — the web, game,
CLI, embedded payload and runtime image now identify the same build; setup,
sync and updates fail closed instead of presenting stale or simulated state as
live.

### 🖥️ Desktop and runtime

- The first-run and recording profiles now open on a light, live surface with
  no demo banner; the simulation badge remains visible until both the backend
  and positions are genuinely live.
- Setup and the embedded terminal keep truthful process ownership and exit
  status across macOS, Linux and Windows, including interrupted installers and
  PowerShell-hosted commands.
- Runtime upgrades are host-owned, transactional and crash-safe: they acquire
  a lock, journal each phase, verify the candidate and restore the previous
  image and metadata on failure. The game exposes an explicit, user-triggered
  update check instead of polling or silently restarting Docker.

### 🔄 Web, chat and job-search autonomy

- Web↔VPS synchronization now correlates every request and acknowledgement,
  uses compare-and-swap closure, and acknowledges only rows actually
  delivered. A newer request can no longer be closed by an older worker.
- Applications remain user-initiated: deadlines exist only when requested,
  empty states are neutral, and the UI no longer turns streaks or deficits into
  pressure to apply.
- The public site gains the Landing Globe, localized tutorial and trailer
  routes in publish-off mode, a localized non-blank loading shell, and improved
  mobile readability without publishing media ahead of approval.

### 🔒 Release integrity

- Public authenticated E2E runs are serialized and mask the complete session
  family — cookie chunks, reconstructed cookie, token/header values, storage
  state and URL-encoded variants. Public CI no longer retains traces, videos or
  network-bearing reports.
- Private identity and machine data are rejected by repository hooks and the
  public fixtures/security documentation use synthetic values only.
- Every publishable component and lockfile is aligned to `0.3.4`; the Godot
  export and NSIS metadata match, and production installers/compose files pin
  `ghcr.io/leopu00/jht:0.3.4` instead of a moving `latest` image.

---

## [0.3.3] — 2026-07-30

**Everyone in the office has their own face** — the portrait gap opened by the comic chat in 0.3.2 is closed, and the download page finally hands out the app.

### 🎨 Portraits

- **The six missing `pensieroso` poses** — assistant, coordinator, critic, writer, sentinel, maintainer. The chat switches to that pose *while an agent is composing its reply*, and those six were silently falling back to `neutro`: waiting looked exactly like answered, which is the one thing the pose exists to say.
- **Sixty per-instance portraits**, `neutro` and `pensieroso` for all thirty desks across the five departments. These are not new characters: the office already gave each agent a face by desk, and the chat was the side flattening them onto the role — so `scout-1` and `scout-5` shared one portrait while sitting as visibly different people ten metres apart. Each face is derived from that desk's own sprite. The `a` variants deliberately reuse the role portrait, because they *are* the same identity: the department lead.
- **Overlapping and clipped sprite frames repaired** across the character sheets, plus two audit tools that make the whole thing checkable without opening the game: `audit_instance_portraits.py` (format, alpha, import files, lead mapping) and `audit_character_sheets.py` (36 sheets, frame geometry).

Combined with the surnames from 0.3.2, opening a chat now reads `HOLMES · SCOUT-1` next to the face that agent actually has at their desk.

### 🌐 Web

- **The desktop app is downloadable from the site**, marked beta, for all three systems. The Desktop tab had announced "coming soon" since 2026-07-03 while three releases shipped past it. Links resolve through `releases/latest/download/`, so a new release no longer requires touching the site.
- The unsigned platforms are stated up front instead of left to be discovered: Windows will show SmartScreen and the note names the two buttons to press; Linux needs the archive extracted and made executable. macOS opens on a double click, which is what the notarization bought.

### 🧪 Also

- **A first-run wizard was failing the report-dialog specs**, and no HTTP guard could have seen it: `/dashboard` answers 200 and the wizard takes over on the client after hydration, so the spec waited thirty seconds for a menu that was never going to render — while the screen showed a language picker. A session minted fresh for every CI run is by definition one the wizard has never met.
- **The Windows export gets a settled process and one loud retry.** It segfaulted mid-packing on 2026-07-29 with every self-test green above it, then passed on rerun — intermittent, which is worse than broken, because a random red makes a release semaphore worthless.

---

## [0.3.2] — 2026-07-29

**Talking to the team, and the team not getting stuck** — 75 commits since v0.3.1. Two days spent on things found by running the product rather than by reading it: a coordinator lost for eleven hours behind a single unsent line, a chat that had never delivered anything, and a window that burned more CPU than the whole team it was watching.

### 🎭 Every agent can be talked to, in comic balloons

- **The office chat is a comic page.** Portrait on the right, balloons in the middle, composer at the bottom: the agent's balloon is always white with black ink and its tail points at the character's head; yours is mirrored, tinted, and sits underneath. Scrolling back reads the conversation; a message arriving while you read does not yank the page away.
- **Every operative role can now answer** — Scout, Analyst, Scorer, Writer, Critic, on top of the three coordinators. The skill keeps it cheap on purpose: answer from context only, one to three sentences, one reply and back to work. Answering is a turn of that agent's model, so a chat that becomes a conversation is a chat that stops production. The Critic can answer but may **not accept candidate information** through it — its blind review is the only thing its verdict is worth. Doctor, Maintainer and Sentinel stay out, each for a stated reason.
- **Agents have surnames**, as a pure function of role and number: `scout-1` is Holmes on every machine, forever — the same rule that already governs desks and faces. Detectives for the Scouts, scientists for the Analysts, people who put points on the board for the Scorers (Ronaldo, Sinner, an archer), writers and critics for the rest. The technical uid never changes; only what you read does. Two places deliberately keep the bare uid, because a name there would be a lie: the pooled consumption row (six agents' spend, one workdir) and labels that show a tmux session name.

### 💬 One chat, and a reply that arrives

The web chat did not work, and the reason was not a bug but **four missing links**. A message written on the site reached the box within a minute and then waited: nobody was responsible for putting it in front of the agent, who was expected to go and look on its own initiative. The reply, once written, waited again — for the user to press *Sync now*, since periodic pushes were disabled to protect quota. And whatever did arrive was filtered out of the page by a `delivered_via='web'` clause that Telegram-delivered messages never match. A message sent twenty hours earlier had simply never been delivered to anyone.

Now the turn reaches the agent's pane **within about five seconds** and the answer is on the browser in as many, over a lane that costs nothing while the conversation is idle — every step is fronted by a local guard, so a quiet chat touches neither Supabase nor Vercel. Game and site are **one conversation**: `chat.jsonl` on the box is the meeting point, mirrored both ways with the turn's own timestamp as the dedup key, so what you write in the office you find on the site, and the other way round. Replies written with `jht-send`, which never reached the cloud at all, now do.

The composer also stopped going dark: it used to attach itself to the agent's last message, so once you had answered them all there was nothing left to write into — the schema could not represent a message **you** started. Migration `060` (additive; until it is applied everything degrades to the previous behaviour, declared and silent). The three chat icons are now the agents' drawn portraits, cropped to the bust.

### 🩺 The team stops getting stuck

- **A step-capped agent is resumed.** The `max_steps=100` cap interrupts an agent without terminating it: the session stays alive, the pane ends on *"Send another message to continue"*, and it waits for an input no component was responsible for sending. Found in production with the only active Scout stalled that way — the Analysts' queue emptied, the Scorers starved, and every health indicator read green, because the existing watchdogs check that a session *exists*. The new watchdog asks whether the **database advances**, applies a throttle before resuming (the cap is usually a rabbit-hole; resuming instantly sends the agent back into the same loop), and escalates to the Captain on the fourth consecutive stall instead of nudging forever.
- **The Doctor dissolves blocks instead of reporting them.** It had diagnosed a deadlock perfectly — an unsent line in the coordinator's pane, an agent looping on retries for hours — written it down, and stood by while the team stayed frozen for six more hours. It now has an unblock phase that runs before anything else, and a round that leaves a block alive is logged as **failed**. It still never touches text you typed: it forwards the question to the Assistant and tells the coordinator to carry on meanwhile.
- **The sender stopped lying.** `jht-tmux-send` returned success right after pressing Enter, without checking. When the key was lost the message sat in the composer — and unsent text makes a pane look busy to everyone, turning one lost Enter into a permanent deadlock. It now re-reads the pane, looking only at the prompt line (after a successful submit the text is still on screen, in the transcript). The `Space+Enter` reinforcement is no longer gated to Kimi: the failure was reproduced on Claude.
- **Sessions expire at 12 hours**, on age alone — no context threshold, no PARKED state, no health heuristic can override it, and a test greps the function body to keep it that way. In the incident the sessions were 38, 29 and 27 hours old and every heuristic said *healthy*. Enforced by the watchdog too, because the Doctor is an agent and can itself be stuck.
- **Workers are watched.** The deterministic safety net covered only the four core roles, so four dead workers went unnoticed with no log line and no respawn. It now reads the live roster — with three guards against fighting the coordinator, since "dead" and "deliberately removed" are genuinely indistinguishable today.

### 💰 Spending

- **`jht standby on`** — a running team costs money even with every worker at maximum throttle: measured at ~2 weekly points per hour on a completely idle pipeline, which hit the wall and froze the team for four and a half days. The residual is the core roles and the bridges, none of which the throttle governs. In standby **the bridges keep reading and stop talking**: quota is read over HTTP, which costs no model turn, so the alarm clock survives at zero cost. It always carries an exit condition — a standby that cannot end is refused.
- **The Captain is woken 81% less.** Of 37 inbound messages in an hour and a half, 30 were pure status — and he runs on the most expensive model in the fleet while the workers run on the cheapest. The workers no longer announce start and finish; what leaves no trace in the database (blocked, conflicts, decisions) still arrives immediately. He pulls the rest with one query that rides inside the hourly beat he was taking anyway. The asymmetry is written down where it bites: that query shows who *produces*, so a stalled agent **disappears** from it — a missing name is exactly what you must go and look at.
- **The spawn offset comes from the rung.** It was a fixed ten minutes, unrelated to the period the workers would actually run on; with N workers sharing period T the spacing that spreads them is T/N. Measured from the previous worker's phase rather than from now, because a burst spawns back-to-back and everyone would otherwise land in the same minute.

### 🖥️ The window

- **The game used to cost more CPU than the team it was watching** — 37% against ~8% each for five agents, at 75 °C. Measured before touching anything: headless 3.8% against 31.8% windowed, so seven eighths of the bill is frames drawn, not logic. Now 10 fps unfocused and 3 minimized: **31% → 14.7% → 4.6%**. Two traps defused on the way: the adaptive graphics calibration would have read our own low frame rate as a struggling machine and pixelated the world *while nobody was watching*, persisting it to disk; and below 7.5 fps Godot discards game time, so a three-hour absence would have come back minutes behind.
- **Closing the window no longer means stopping the team.** Three explicit ways out, each with its consequence written next to it: stop the team and close, **leave the agents working** (with the budget still running, said out loud), or close everything immediately without waiting for anyone to save their place. Coming back, a band tells you how long the team worked without you.
- **The sidebar went from 28 rows to 13** without losing a destination: the five monitoring views became tabs of one window, the twelve configuration pages tiles behind *Impostazioni*. No section id was renamed, so every deep link and the whole guided tour still resolve.
- **The app notices a new version.** Until now whoever installed 0.3.0 stayed on 0.3.0 forever, without being told otherwise. On macOS it can install it, and only after proving the package is *ours*: signature, Gatekeeper, and the team anchor compared against the running copy — notarization alone means Apple looked at it, not that we built it. The package must also start before anything is replaced, and rolls back if it does not. On Windows and Linux, where the exports are unsigned, it opens the release page and nothing else.

### 🔒 Also

The provider CLI refreshes itself at boot and **substitutes** a stale model pin instead of deleting it (deleting brought the old one straight back, because that is the plan's default); a tag now runs the same self-tests as a push; Windows users are told what the SmartScreen warning is and what to click; and the `soft_pause_team` brake is classified in writing as a safety net that does not yield to the user's spending derogation — it fires when *no* usage number can be read, and yielding there would not mean spending more, it would mean spending blind.

---

## [0.3.1] — 2026-07-28

**Connecting a real VPS, and giving the throttle back to the Captain** — 43 commits since v0.3.0. All five game fixes below were found by connecting the freshly released 0.3.0 to a newly provisioned box on a provider that is not Hetzner; two of them made activation impossible there. The other half of the release moves pacing decisions out of scripts and into the agents who are supposed to make them.

### 🖥️ Native desktop application

- **A VPS can be connected as any SSH user, not just `root`.** The connect panel hardcoded `root@` in seven call sites, so it only ever worked with providers that hand out root — Hetzner. On OVHcloud the connection died with `Permission denied (publickey)` because that box logs you in as `ubuntu`, and AWS (`ubuntu`/`ec2-user`), Google Cloud and Azure (the account name) are no different. There is now an **SSH user** field next to the IP, default `root`, persisted with the rest of the VPS configuration; an empty value behaves exactly as before, so saved configurations are untouched. The SSH check went with it: it required `id -u = 0` and would have rejected a correctly-connected `ubuntu` box, so it now accepts root **or** passwordless `sudo` **or** a working `docker info`.
- **The activation checklist grades the connected box, not the laptop.** Steps 02-04 read the local `~/.jht/` while connected to a VPS: a correctly provisioned box could never reach 4/4 (so the activation gate never opened), and — worse — step 03 went **green while validating a different tester's profile** left over on the operator's machine. Every probe now travels the same transport as step 01, and a remote value that cannot be read renders as **unknown**, never as the local one and never as green.
- **Switching VPS no longer leaves the previous machine's state on the bus.** The office kept drawing the old box's pipeline — a 692→697 paper pile against 14 positions actually in the new database — because a freshly provisioned box publishes an empty list and the re-seed only ran on non-empty ones. The audit found much more than the counters surviving a reconnect: CPU telemetry, `live_settings` (which fed back into the setup screen as the active provider), chat history with its unread badges, coordinator state, usage history and profile status. All of it is now invalidated and re-seeded before the first paint, covered by a new headless self-test. With one box per beta tester, this was showing one user another user's work.
- **The map fetches the office address and how sure the team is of it.** `office_address` appeared in no `.gd` file at all: the exact street address the Analysts work to obtain could not be displayed anywhere, and without `office_verified` a pin resolved to a street number rendered identically to one resolved to the city centroid — 30 geocoded positions collapsing onto 24 distinct points, which reads as a broken map. Verified offices are now a filled disc labelled with the company; everything else in that city is a single hollow ring marked `≈ City (n)`, and the address appears in the position card.
- **The SSH key fingerprint is recomputed when the key changes.** It was written once while the panel was built, into a label nobody kept a reference to: picking a different key left the previous fingerprint on screen while the *new* key was the one actually used. That field exists to be compared against what the provider shows, so a stale value does not merely mislead — it turns an anti-MITM check into false assurance. When it cannot be computed it now says so instead of falling back to anything.

### 🤖 Pacing — decisions move from scripts to agents

- **The pace guard advises, the Captain decides.** It used to rewrite the worker throttle at every bridge sample, which made any manual override last less than five minutes. It now measures, produces a verdict and writes one line to the Captain — nothing applies it automatically. The reason is not ceremony: its correction is **one number for everybody**, derived from the most-braked worker, and it slowed the Analyst and the Scorer — the two roles that turn a backlog into a position *with a score* — exactly as hard as a Scout that was over-sourcing.
- **New `throttle-distribution` skill** (7 languages) that owns the arithmetic of *who* pays the cut and *how much*: share answers who, production data answers who is worth slowing, and the role asymmetry says the Analyst and the Scorer go last. It also owns the do-nothing cases, because an intervention at every tick is noise and waking the Captain costs real budget. A pre-existing calibration formula was corrected along the way: it was linear and computed before the floor, producing 40-second durations that the 5-minute floor silently clamped to 300.
- **Coprime throttle ladder.** The rungs were 5, 10, 15, 20, 25, 30, 40, 50, 60 minutes — every one a multiple of five, so two workers on different rungs resynchronised *by construction*: 5+10 collided every 10 minutes. Each coincidence was a burst of simultaneous requests. The rungs are now prime minutes (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60); worst-case time between any pair goes from 10 to 35 minutes.
- **Per-agent exemption from the worker floor**, deliberately not a global switch — the floor exists because of a measured incident, and removing it everywhere reproduces the July 15 night burn where floor and hard-stop were both off.

### 🔥 The user can suspend the spending automatisms

`jht burn on [--hours N]` — when the user orders *"the budget is not a constraint"*, that order finally has a place to live instead of five separate derogations dismantled by hand. Ten points consult it **before** braking rather than after: the three bridges before writing `daily-halt`, the working-hours gate, and `throttle-config` — which matters most, because the floor and the ladder apply **on read**, which is why every manual override used to snap back to 300 seconds on its own.

It expires by itself (5 hours by default, one window; hard cap 12) and it reaches the agents, which was the requirement that made this hard: a technical derogation is not enough if the prompts do not know about it. On 2026-07-27 six workers had been exempted in code and the coordinator re-narrowed the exemption *in good faith*, correctly citing its own rule, undoing the user's order. So the Captain gets **C-23** and the Sentinella **S-10**, in all seven languages, both stating that narrowing the derogation is not theirs to do. The Sentinella's evening reserve stands down with the daily cap — it is the same ceiling under another name — and the brake re-arms immediately at expiry, bypassing its own cooldown.

**Four brakes never yield**, and they are a code constant rather than prose: `weekly-halt` (beyond it the provider stops answering), `host_agent_cap` (19 sessions → load 24 on 6 cores → SSH unreachable: forcing it produces *less*), one-position-per-iteration, and `freeze_team`.

### 🐳 Container, CLI & CI

- **The provider CLI refreshes itself at boot.** A production VPS was running a CLI eleven days old, on a model one generation behind, with two agents stuck at 565k and 168k tokens against a 262k window — the current release offers 1M. Nobody noticed because no component had the job. The update now runs before the team starts, fails safe (no network, no problem: the container boots with the CLI it has), touches only the active provider, and **never changes the model** — a newer one is reported to the Captain as a finding, because that decision costs money and is the user's.
- **Doctor and Maintainer can find the provider CLI again.** Their tmux pane PATH is a hardcoded list that never gained `/opt/jht-deps/npm-global/bin` after dependencies moved into the volume, so both spawns died with `REPL non partito` and retried in a loop while sixteen agents worked normally. `/opt/jht-deps/python/bin` (where `uv` lives) was missing too. The list now also **inherits** the container PATH, so the next time an install location moves nothing rots silently.
- **Five self-tests existed and no workflow ran them** — including the seven-language parity guard, written specifically to prevent a repeat of the duplicated keys that broke startup in every language except Italian. They are now wired into `game.yml` and `release.yml`.
- **Notarization survives a network blip.** `notarytool --wait` exits on the first network error: during the 0.3.0 release the runner lost the network after 45 minutes of waiting and discarded a submission that was perfectly valid — Apple's queue ran 4h30 that day. Submission and polling are now separate, and a failed query is retried rather than treated as a verdict.

---

## [0.3.0] — 2026-07-27

**The native-application cycle** — 2026-07-06 → 2026-07-27, 842 commits since v0.2.0. The desktop surface moved from an Electron launcher wrapping a web dashboard to a **native Godot office**; the browser is now cloud-only. Four user-visible removals are listed under *Breaking changes* below — read those first if you are upgrading an existing install.

### 💥 Breaking changes

- **Electron desktop launcher removed.** The whole `desktop/` tree is gone (−35k lines); the supported desktop application is the Godot office in [`game/`](game/), built by `.github/workflows/release.yml` for macOS (signed + notarized `.zip`), Windows (NSIS `.exe`) and Linux (`.tar.gz`). Release version consistency is now checked against `package.json` + `game/project.godot` + `game/export_presets.cfg` — see [`docs/internal/ops/release.md`](docs/internal/ops/release.md).
- **Local web dashboard on `:3000` retired.** The container no longer serves Next.js: no `EXPOSE 3000`, no `ports:` in `docker-compose.yml`, no dashboard child process in `jht pid1`. Local and VPS interaction happen in the native app (`docker exec` / SSH); the browser only ever talks to the cloud deployment (jobhunterteam.ai, authenticated). `jht dashboard` still exists but prints a pointer and exits 0.
- **`/onboarding` removed from the web app.** Onboarding is a first-run experience of the native office; the cloud app opens at `/dashboard`, and new cloud users get the `/welcome` wizard (see *Demo mode* below) instead.
- **The TUI is gone.** `tui/` (29 files) is removed: it was compiled by every user on install and its job — watching sessions, reading logs — is done by the CLI and by the native office. With it went the Python LLM layer in `shared/` and the two SDKs only it needed, plus 30 unreachable `shared/` subdirectories.

### 🖥️ Native desktop application (Godot 4.7)

- **Bidirectional team migration.** Settings can now move the complete team local → VPS, VPS → VPS, or VPS → local. Transfers are checksummed, validated in staging, backed up before replacement, switched atomically, checked with SQLite integrity probes, and rolled back if startup or cloud handoff fails. Destination SSH/runtime credentials stay local to that host; VPS host keys are pinned before authentication.
- **Feature-complete migration.** Setup wizard, provider login through an embedded console, local/VPS container lifecycle, candidate profile, working hours, email and Telegram configuration, cloud sync, positions/statistics/applications/map views, per-agent pages and observability are all native. The office is a live view of the real team: agents are the real roster, the paper flow tracks real pipeline counters, transitions and chat come from the running team.
- **Onboarding.** Assistant-driven first run (title → wizard → office) with an escorted tour: the Assistant walks the user around the departments with a quest tracker, addresses them by name, allows free roaming, and adapts to the state already configured. Offline showroom mode for demoing without a container.
- **Observability.** Usage window (5-hour and weekly), per-agent burn, per-role CPU/RAM series over SSH sampled by a dedicated vitals collector, activity LEDs driven by real CPU, agent history charts with deep links.
- **Documents.** In-game CV/PDF preview from the output archive, folder reveal, artifact fetch channel over the backend bus.
- **Art & world.** Painted portrait sets for the full roster, painterly sprite sheets (walk/work/sit) for every department, five-department layout with per-department rugs, glass partitions that agents can walk through, day/night cycle on local time, switchable light interface theme, automatic graphics calibration that keeps text readable on any resolution.
- **Platform work.** Windows-compatible quoting and pty allocation for the embedded terminal, native Windows Docker setup flow, NSIS installer, faster installer startup, VRAM-compressed world art and mipmaps, and a per-frame retessellation fix that made weak GPUs usable.
- **Chat delivery** goes through `jht-tmux-send` instead of a blind paste + Enter, so messages survive composer quirks of the provider CLIs.
- **An agent's number is its identity.** Desk and face follow the number instead of the spawn order, so scout-2 is the same character across restarts.
- **The office says why it went quiet.** When the work window closes or the budget runs down, a window explains it instead of leaving the team silent.
- **Provider step reads the container.** The plans offered match the provider just picked, the login is detected from the container instead of being typed, and the embedded console text can be selected and copied in one click.
- **Report a problem, from inside the game.** A panel with three free-text fields and an inspectable preview; everything technical (Docker version, agent role, session capture) is collected for the user, with a PII redactor over it. The GitHub bug template asked questions only a developer could answer.
- Closing the window no longer aborts the process: the shutdown thread is joined before quitting, instead of having its tree pulled out mid `docker stop` (SIGABRT, ThinkPad 2026-07-26).

### 🌐 Web & cloud dashboard

- **Demo mode + `/welcome` wizard.** A new cloud user picks a language, then either pairs a real team or explores a full read-only product with one of **4 personas** (software, design, marketing, finance), **56 positions each**, localized in all **7 languages**. The persona lives in the `jht_demo_persona` cookie; every query branches to a static dataset and every write API is a no-op on demo ids. Design record: [`docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md`](docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md).
- **Realtime-first sync.** Client polling is gone on the cloud deployment: live data and messages arrive over Supabase Realtime, with graceful degradation when a subscription fails. Configurable browser notifications (messages + position rules) on top of the new `notification_prefs` table. Design record: [`docs/internal/architecture/2026-07-21-web-sync-realtime-rework.md`](docs/internal/architecture/2026-07-21-web-sync-realtime-rework.md).
- **`/swipe` triage.** Mobile-first rapid judgment over the scored backlog: 4-level interest scale plus free (or dictated) comment, re-judgeable stamps, prev/next navigation, deck sort modes, collapsible filters with per-chip counts and dual-range histograms, on-demand JD summaries.
- **Position page rework.** Overview card with score, per-dimension score rationale from the Scorer, company card with logo, location card (map pin, exact clickable address, HQ for full-remote roles), self-explanatory action rows, prev/next navigation, mobile card list below `md`.
- **Feedback that can be withdrawn.** Clicking the active verdict again retracts it (`clear` event, append-only log); excluding a position asks for a reason and keeps that reason visible afterwards.
- **Map.** Pins never move with zoom: exact office coordinates when known, a fixed north grid for positions without a location, city/country bundles at low zoom, and full-remote roles resolved onto the map with their own styling.
- **Messages.** Dedicated `/messages` page (Assistant/Mentor/Captain sections), navbar messenger drawer, exact unread counts, history endpoint, inline markdown, and reply/ack backflow from the cloud down to the local SQLite.
- **Team board.** `team_directives` — the user's standing orders — are editable from the dashboard, mirrored to Supabase and re-read by the Captain at every wake (C-21).
- **Settings & dashboard.** Account, language and salary-currency sections on cloud; salaries follow the preferred display currency; dashboard decluttered around a newest-scored table with a single score-colour spectrum shared by every visual.
- **Company card in demo mode.** `demoPositionById` used to return `company: null`, so the company card — sector, size, HQ, Glassdoor rating, Analyst verdict — never appeared to anyone evaluating the product through the demo. The dossier is now derived deterministically from the seed data (no logo: an invented company has none; no prose: nothing new to localize).
- **36 dead API routes removed** (149 → 113). All of them fed surfaces that no longer exist: the retired local dashboard, the archived team-v1 page, the VPS lifecycle buttons (now in the native app), the profile-assistant lane, bridge start/stop, and `team/{start-all,stop-all}` — of which the CLI now holds the only implementation. Each removal was checked for callers across `web/`, `game/`, `cli/`, `.launcher/`, `shared/`, `e2e/` and the docs; `/api/canary` was deliberately kept as a hand-run diagnostic.
- **Public `/contact` page** with a real form in all seven languages, the sender's own subject line, and `/api/feedback` as the single destination for both the page and the in-app reports.
- **Report a problem from the dashboard** (`SupportDialog`, reachable from the user menu), delivering to the project mailbox and not only to GitHub.
- Unguarded API routes closed, and `GET /api/setup` no longer returns channel secrets.

### 🤖 Agents & runtime

- **Scorer refuses to score without a candidate profile.** New deterministic gate (`shared/skills/profile_gate.py`) plus RULE-01 step 0 in all 7 prompt locales: a missing or empty `candidate_profile.yml` stops scoring instead of producing meaningless numbers. Covered by `tests/test_score_profile_gate.py`.
- **Single-home content contract for position cards** (Analyst + Scorer, 7 locales): every fact lives in exactly one card, per-dimension score breakdown is mandatory, the redundant pro/con card is gone.
- **Company logos.** New `logo-extraction` duty for Analysts, `shared/skills/logo_fetch.py` (35 KB cap, data-URI), maintenance queue, cloud sync of the logo columns.
- **Enrichment savings policy** — a code-enforced spend brake (C-18) with matching awareness in the Captain and Analyst prompts.
- **Scout self-loop sourcing** (one position per iteration, no external "continue"), Doctor session refresh gated on measured context (>50%) instead of session age, deterministic cold-archive flow for monitoring logs, cloud-sync failure detection and escalation by the Maintainer.
- **Watchdog / pid1 credential markers** now accept vendor provider names (`openai`, `anthropic`) — the same time bomb was fixed in the watchdog on 2026-07-18 and in `pid1` on 2026-07-23, where it had been silently preventing auto-start.

### 🗄️ Database & sync

- Migrations **054–059**: `team_directives` (team board), `position_views` (cross-device seen state), `companies.logo*`, `pending_messages` merge-upsert that stops the VPS push from clobbering web-written replies, `notification_prefs` + positions in the Realtime publication, `position_feedback` `clear` action.
- **Cloud-sync resilience**: chunked push and cursor unfreezing after the 2026-07-15 HTTP 413 incident ([postmortem](docs/internal/postmortems/2026-07-15-cloud-sync-413-freeze.md)), `sync_completed_at` acknowledged only on a fully successful push, server-side `sync_requested_at` stamp with a no-op skip in the merge RPC.
- **Cloud builds never look local**: `isLocalRequest`/`workspaceHasDb` are false on the Vercel deployment regardless of request origin, so a cloud page can never read a stale local `jobs.db`.

### 🐳 Container, CLI & install

- **Runtime image 7.2 GB → 3.2 GB (−55%)**: `/app` dropped from the final `chown -R` (a duplicated ~1.7 GB layer), no `npm ci --prefix web` now that the container does not run Next.js, and a `.dockerignore` that keeps `game/`, `docs/`, `tests/` and `e2e/` out of the build context.
- **Windows (Docker Desktop/WSL2):** the container could not write to the bind-mounted `/jht_home` / `/jht_user` (root-owned mounts + non-root `jht` user → `Permission denied` on startup). A new entrypoint wrapper probes the mounts and repairs their ownership through the existing sudo whitelist — agents still run as `jht`, no behavior change on macOS/Linux.
- `jht pid1` keeps itself alive explicitly (it used to be anchored to the dashboard child) and took over the orphan bridge pid/state cleanup.
- File-bridge poller enabled by default on the VPS to serve on-demand CV/attachment downloads from the web.
- **The installers are English at the source — and this time the website agrees.** The 2026-07-03 translation pass had been applied only to the published mirror `web/public/install.sh`; but Vercel's `buildCommand` regenerates that mirror from `scripts/install.sh` on every deploy (since 2026-04-11), so **jobhunterteam.ai kept serving the Italian installer** while the repository looked translated. `install.ps1` had never been translated at all. Both are now English in `scripts/`, the Vercel build regenerates **both** through `scripts/sync-public-installers.sh`, and `tests/test_public_installers_sync.py` (now in CI) keeps the committed mirror honest.

### 🔒 Security & dependencies

- Next.js 16.2.9 → 16.2.11 with a `sharp ^0.35.3` override (July-2026 advisories), plus fixes for the high-severity `brace-expansion` and `js-yaml` DoS advisories.
- Routine dependency bumps: `@supabase/supabase-js`, `@supabase/ssr`, `tailwindcss`, `eslint-config-next`, `actions/checkout` 4→7, `actions/setup-node` 4→7, `grammy` in the test runner.
- The pairing token is written `0600`, every Python dependency is pinned, and the C toolchain is out of the runtime image.
- `postcss` raised past GHSA-r28c-9q8g-f849 (path traversal in previous-source-map auto-loading) in both `web/` and `tests/js`.

### 🧹 Dead code removed (2026-07-25)

A reachability walk from the real entry points (`cli/`, `web/`, `game/`,
`scripts/`, `Dockerfile`) — resolving actual `import`/`require` statements, not
grepping for names — found that **nine files** of `shared/`'s TypeScript were
reachable at all: `config/schema.ts`, `paths.js`, `runtime/container.js` and
`cron/`. Everything else was scaffolding ported from OpenClaw in April 2026 and
never wired to anything: an agent runtime, a gateway, a plugin system, a queue,
a rate limiter, a session store, a context engine, a second SSRF implementation,
and twenty more. Untouched since birth except by one repo-wide Prettier pass.

- **30 subdirectories of `shared/` removed** — 130 files, ~17.000 lines. Their
  only callers were their own tests, which went with them.
- **The CI matrix follows the code**: 11 vitest modules → 3. Of the 933 tests,
  692 guarded code the product cannot reach; the surviving 241 cover the demo
  mode, config schemas, cron, credentials, the daemon templates and the CLI
  setup wizard. The suite got faster and started meaning something.
- **`shared/llm/` and its credential resolvers removed** (11 files) — the agents
  talk to models as CLI processes in tmux, never through a Python SDK. That also
  retired `anthropic` and `openai` from `requirements.txt`, installed into every
  container build for zero imports.
- **`tests/js/tasks/_disabled/` deleted** (40 specs, 6068 lines) — parked on
  2026-05-31 with a re-enable procedure nobody ran, asserting against surfaces
  that were *removed* rather than renamed. Dropping the folder-wide vitest
  exclude then revealed a second, unknown `_disabled/` holding one **working**
  file: its move had broken a relative import, not its subject. 18 passing tests
  came back.
- `shared/skills/browse_folder.py` removed: the native folder picker behind the
  `/assistente` page, orphaned when that route went on 2026-07-25; the game has
  used Godot's own `FileDialog` for a month.

Nothing here changes behaviour — that is the point. `git show d8fd3088:<path>`
restores any of it.

### 🧪 Tests, CI & tooling

- **pytest now runs in CI.** The Python suite (447 passing, 62 skipped) was runnable only by hand, which is why the installer-mirror drift went unnoticed for three weeks; `.github/workflows/test.yml` gained a `pytest` job (with `npm ci` in `cli/`, since two test files shell out to the Node CLI) and the root `npm test` now runs both runners.
- Godot self-tests wired into `release.yml` and `game.yml`: scene import, nav grid, speech bubble, pipeline queue, embedded terminal, plus VPS-contract, pipeline and doctor headless scenarios and a smoke test of the exported binary.
- `tests/test_sync_supabase.py` builds its database with the real `shared/skills/_db.ensure_schema()` instead of a hand-copied DDL — the copy had gone stale against the `companies.logo*` columns and was failing on healthy code.
- **CLI ↔ game parity guard**: every public `BackendBus` verb must be classified as covered by a CLI command, a known gap with its tag, or not-applicable with a reason. A new verb nobody decided about fails the suite.
- **Seven-language parity guard** for the game dictionaries, as a headless self-test: all 746 keys in all 7 languages. It exists because a duplicated key in `ui_en.gd` broke every non-Italian boot while Italian stayed clean — the translated dictionaries load lazily.
- 75 e2e specs that no longer describe the product are quarantined instead of silently skipped, and every `tests/js` module runs exactly once per push.

### 📚 Documentation

User-facing guides were updated in the same commit as the `:3000` retirement (QUICKSTART, CLI-REFERENCE, VPS-SETUP, AI-AGENT-INTEGRATION and the public *dashboard-and-results* page in 7 languages). The rest of the documentation had fallen three weeks behind and was realigned on 2026-07-24/25:

- [`docs/internal/ops/release.md`](docs/internal/ops/release.md) rewritten for the Godot pipeline — it still told the maintainer to bump `desktop/package.json` and to expect electron-builder artifacts, which would have failed on the first CI job. The macOS signing playbook in `MAINTAINERS.md` went with it (signing is mandatory now, not "deferred post-beta").
- [`04-threat-model.md`](docs/security/04-threat-model.md) → v0.2: the document meant to become the public `SECURITY.md` still modelled "Electron + a dashboard on localhost:3000". The April audit documents around it are now labelled as the dated snapshot they are.
- Design record written for [demo mode and `/welcome`](docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md); the site cookies are declared on the public privacy page in all 7 languages.
- Planning docs realigned: `BACKLOG.md` (superseded entries closed, newly-surfaced debt added), `ROADMAP.md`, and the beta coverage matrix.
- Housekeeping: the two 2026-07-03 Electron status notes archived, `docs/review-log.json` resynced (20 dead entries dropped, everything since May added, 251 files with a description each), 18 links to a deleted document repaired, and three registered CLI commands documented (`working-hours`, `profile validate`, `tools`).

## [0.2.0] — 2026-07-03

**First public release** — the version announced on Reddit. CLI-first beta, built for contributors.

**What it is:** a self-hosted team of AI agents (Captain, Scout, Analyst, Scorer, Writer, Critic + support core) that runs your job search on your own LLM subscription. Everything below this section was previously tracked under *Unreleased* and shipped with this tag.

**Highlights of the launch sprint (2026-07-02 → 03):**

- 🧹 **Git history sanitized** with `git filter-repo` (three passes): application dossiers, employer names, e-mails, VPS IPs and identifying names purged or pseudonymized across every ref. Stated in `SECURITY.md`.
- 🌍 **Public site fully internationalized** (7 languages), including the case-studies dashboards and the maintainer's notes; `install.sh` output translated to English.
- 📊 **Case studies refreshed** to the 2026-07-03 snapshot: month-long autonomous Codex run — 658 positions found, 520 scored, 307 strong matches, weekly budget self-managed at 99–100%.
- 📄 **Honest docs pass:** upfront cost callout, self-reported-numbers note, provider ToS note, solo-maintainer wording, screenshots + CI badges in the README.
- 🧪 **Test suite made real:** root `npm test` now runs the actual runners (869 vitest + 425 pytest, all green); 11 stale pytest fixed; Kimi provider model IDs corrected.
- 🤝 **Contributor on-ramp:** 7 `good first issue` tasks with context and done-criteria, 5 mission issues (M1–M5), 3 real bug reports, labels and templates in place.
- 🖥️ **Desktop installers** for macOS/Windows/Linux attached as unsupported preview builds (the supported path is the CLI); three Windows-runner build bugs fixed along the way (electron-builder auto-publish, `npm.cmd` spawn, GNU tar vs `C:\` paths).

> ℹ️ Historical entries below this point are a mixed Italian/English engineering log that predates the English-only policy (2026-07-03). They are kept verbatim as project history.


### 📚 Docs restructure: one-screen ROADMAP + slim BACKLOG index — 2026-07-03

- **`docs/about/ROADMAP.md`** rewritten as a one-screen strategic view: verbal states instead of invented percentages (i18n was listed "~70%" with all 7 locales already shipped; "multi-cloud ~50%" had zero code behind it and is now an explicit scope-note), a theme table, and the contributor missions M1–M8. Unique content preserved, not deleted: the skill-distribution design moved to `docs/internal/architecture/skill-distribution.md`, the DB schema plan to `docs/internal/roadmap/db-schema-optimization.md`.
- **`BACKLOG.md`** (1487 lines, mostly done-entries masquerading as backlog) reduced to a slim index of open tactical work. The full pre-restructure file is frozen verbatim in `docs/internal/_archive/BACKLOG-2026-07-03-frozen.md` — every closed `[TAG]` referenced from code or docs resolves there.
- Shipped work the old BACKLOG recorded that this changelog didn't yet: **CLI ↔ container coordination** complete (post 04-22); **~14 KNOWN BUGS closed** (TUI build, clack TTY, doctor tmux, codex provider-alias + trust-prompt, pid1 auto-migrate, claude trust-prompt, install PATH, VPS auth over tunnel, CSP JSON-LD ×2, Turbopack shared-resolve, plus the 13-bug/3-feature team-strategy sprint of 2026-05-17/18); **[OBS-TELEGRAM-SEND-LOG]** central outgoing-message log (2026-05-31); **[JHT-LOCAL-NO-API]** local-PC mode bypassing Supabase entirely (2026-05-31). Full details with commit hashes: the frozen archive.
- The graphics-polish `docs/internal/MINOR-TRACKER.md` merged into `docs/internal/landing-image-prompts.md`, ending the name collision with the canonical debt tracker `docs/internal/roadmap/MINOR-TRACKER.md`; the 39 dated notes in the `docs/internal/` root moved into `architecture/` / `postmortems/` / `roadmap/` / `_archive/` with a formal note protocol in the README-index.

### 🐳 macOS container runtime: user choice (Colima or Docker Desktop) — 2026-06-20

Supera l'ADR-0001 (Colima-only su macOS) con [ADR-0006](docs/adr/0006-user-choice-container-runtime-macos.md). Su **macOS** l'utente sceglie il runtime:

- **Detect-first ovunque**: se un daemon Docker risponde già (Docker Desktop, una Colima esistente, OrbStack…) viene riusato — niente seconda VM installata sopra (risolve il clash a due VM).
- **Wizard desktop**: card a due opzioni nella schermata setup — 🟢 Colima (consigliato, headless, gestito da noi) vs 🔵 Docker Desktop (il tuo, lo avvii tu). Preferenza persistita host-side in `userData/preferences.json` (mai sul container/cloud), commutabile anche a daemon attivo.
- **CLI**: `install.sh --runtime=colima|docker-desktop` (non interattivo → flag, non prompt) + `install_docker_desktop_macos` (`open -a Docker`, mai silent-install). Guardrail daemon-down specifici per mac (`colima start` / `open -a Docker`).
- Windows (Docker Desktop) e Linux (Engine nativo) invariati. Decisione confinata a macOS (Colima non esiste su Windows; su Linux il motore è già nativo).

> 289 commits and 10 days of intensive work since v0.1.12 — desktop launcher rewritten with one-click install on macOS (Colima via Homebrew/osascript) and Windows (WSL2 + Docker Desktop + Git in a single UAC flow), monitoring stack pivoted multiple times (Sentinel eliminated then reintroduced as event-driven watchdog, Bridge promoted to separate clock-only daemon), web team page redesigned with live inter-agent message animations and embedded terminal per agent, web platform restructured around the subscription model, complete pre-launch documentation suite (10 new docs), Kimi (Moonshot) provider support added, **pre-launch security hardening sprint** (31/34 fix, score 30% → 74%, audit suite in `docs/security/`).

### 🌥️ Cloud sync v2: desired-state Kubernetes-style + on-demand UX — 2026-05-22 / 2026-05-31

Dettaglio architettura in [`docs/internal/architecture/cloud-sync-architecture.md`](docs/internal/architecture/cloud-sync-architecture.md) (living doc).

**Macro-shift architetturale**: il modello "push-only macro-events" del 2026-05-13 è stato superato. Cloud sync v2 è ora **ibrido push + pull desired-state**: il container resta source-of-truth dei *risultati* (positions/scores/applications, push delta-only ~30s), mentre le **intenzioni utente** che entrano dal web (start/stop team, "scrivi CV", "geocodifica", like/dislike, chat) tornano al container via 2 long-poller HTTP (`team-state-reconciler` + `team-commands-poller`) + endpoint dedicato `pull-desired-state` per i flag per-row. Pattern desired-state Kubernetes-style: il browser scrive `should_run=true`, il reconciler converge.

**On-demand UX — l'utente decide cosa fare lavorare al team**:
- ✅ **Writer-on-demand V6** (mig 024): Scrittore NON spawnato al boot, lazy-spawn dal Capitano quando `positions.write_requested=1`. Bottone "Scrivi CV" sul dashboard + Telegram `/cv <id>` setta il flag. Latenza ~15s/ondata, zero token bruciati in idle loop. RULE C-10.
- ✅ **Geocoding opt-in/out V8** (mig 027): replica esatta del pattern, `positions.geocode_requested` flag, button "Geocodifica" detail page. Analista REGOLA-16 diventa OPT-IN (skippa silenziosamente quando flag=0). Nuova coda parallela `next-for-geocoding` per posizioni già processate.
- ✅ **Feedback loop esteso** (mig 028): `position_feedback` + `comment` (≤2000 char) + `score` (1-5) + `direction` (more_like_this/less_like_this). Skill `feedback_query.py` espone `latest_direction` (più recente non-NULL). Scout prompt EN+IT con sezione "pattern steering": `less_like_this` → deprioritize fonte/company, `more_like_this` → replica pattern. Scorer Step 5 obbligatorio multiplier (like ×1.10, star ×1.15, dislike ×0.85, hide → excluded), cap 100.
- ✅ **Chat utente→agente bidirezionale**: `user_to_agent_messages` poller container-side fa long-poll `/api/messages?status=pending`, claim atomico PATCH `delivered`, forward al tmux pane dell'agente target via `jht-tmux-send`. Polling adattivo 3 tier (active 5s / idle 30s / deep-idle 120s) basato su ultima consegna riuscita — riduce carico Vercel ~90% in idle h24.

**Backend bidirezionale completo**:
- ✅ **`team_state` desired-state + 3 event lanes** (mig 019-022): single-team enforcement (claim 409 + push 409 + PATCH 409), status inference, `user_to_agent_messages`, `position_feedback`. Realtime publication su tutte le lane (~200ms browser).
- ✅ **Pull cloud→SQLite al boot** + **periodic pull nel daemon**: GET `/api/cloud-sync/pull-desired-state?since=<ISO>` wired al boot di `startActionContainer` + ad ogni tick del push daemon. Cursor separato `.cloud-pull-cursor.json`. Chiude multi-device "live" (mobile click + team su VPS).
- ✅ **Route write-request supporta cloud-mode senza SQLite locale**: discriminazione `hasLocal` (SQLite presente → path locale, altrimenti SELECT+UPDATE solo Supabase con embedded validate). Loop chiuso: utente clicca su Vercel con container offline → flag su cloud → pull al boot applica → Capitano spawn Scrittore.
- ✅ **DELETE propagation con tombstone end-to-end** (mig 028): `deleted_at TIMESTAMPTZ` su positions/scores/applications + SQLite V7 `_tombstones` table + 3 trigger BEFORE DELETE. CLI push include tombstones nel payload con cursor proprio. Web receive UPDATE soft con idempotency `WHERE deleted_at IS NULL`. **34 query** `web/lib/queries.ts` filtrate con `.is('deleted_at', null)` (caso speciale `getCriticScores` con nested `positions!inner` ha anche `.is('positions.deleted_at', null)`).
- ✅ **Killswitch dedicato 401/403**: counter separato `MAX_CONSECUTIVE_AUTH_FAILS=3` (vs 5 generico, perché token revocato non recupera mai). Halt + INSERT `pending_user_messages` con istruzioni "riapri pairing + jht cloud login". Reset solo su push success 200.

**Disaster recovery + privacy-first**:
- ✅ **`jht cloud restore`** (CLI + endpoint `/api/cloud-sync/full-dump`): full DB rebuild da cloud per container vuoto o SQLite corrotto. 3 tabelle (positions/scores/applications, `deleted_at IS NULL`, cap 10k righe/tabella, rate limit 5/min). Conferma esplicita interattiva via `@clack/prompts`, flag `--confirm-restore` per skip in CI. Mappa cloud_uuid→legacy_id per scores/apps. INSERT OR REPLACE idempotente. Reset cursor push a "now".
- ✅ **JHT-LOCAL-NO-API**: privacy-first switch. `web/lib/workspace.ts` espone `isCloudEnabled()` + `isLocalOnlyMode()`. Quando l'utente disabilita cloud sync e gira tutto localmente → **zero chiamate Supabase** (skip `supabase.auth.getUser()` e fetch in `layout.tsx`, `dashboard/page.tsx`, `map/page.tsx`, `positions/page.tsx`). Su Vercel/remote sempre false, comportamento immutato.

**Refactor naming + hygiene**:
- ✅ **`realtime-subscriber.js` → `team-commands-poller.js`**: il file faceva HTTP long-poll, non WebSocket Realtime (il nome era ereditato dall'intent originale). Il comando CLI `jht cloud realtime-listen` resta per compat con i pid1 deployati; sarà ribattezzato `team-commands-listen` quando il cutover handleAction singolo agente finisce.
- ✅ **DB hygiene + RLS init-plan fix** (mig 024-026): 9 FK indexes mancanti aggiunti, 22 policy `auth.uid()` per-row riavvolte a `(select auth.uid())` (Postgres materializza init-plan una sola volta, da O(N×K) a O(N+K)), 9 unused indexes droppati.

**Throttling + freshness team — context drift mitigation**:
- ✅ **TOKEN-MONITOR-WRITER-CRITIC**: il Critico (`CRITICO-S<N>`) è child task atomico dello Scrittore N, ma il suo consumo token NON era attribuito al parent. Il Capitano vedeva `scrittore-1=200kT/min` e decideva "throttle OK", mentre la unit reale Scrittore-1 stava consumando 280kT/min (40% in più). Nuova funzione `aggregate_writer_critic_rates()` mappa 1:1 e produce `per_writer_aggregated` nel state JSON. RULE Capitano **C-11** (IT+EN) istruisce a leggere `combined_rate_kt_per_min` per le decisioni di throttle.
- ✅ **DOCTOR-DAILY-RESTART MVP**: nuova skill `daily-restart-wave` (gating triplo: finestra 03:00 UTC ± 30 min + 23h anti-thrash via state file + rispetto `.team-halted.flag`/`.weekly-halt.flag`). Restart pre-emptivo di TUTTI gli agenti (vivi inclusi) per context freshness. Ordine tier 3 → tier 1 (workers first, Capitano LAST). Heads-up Capitano 10 min prima. Chiude il gap Case Study #1 (Codex run 2026-05-19/21) dove l'utente aveva dovuto fare 1 restart manuale per arrestare drift di lucidità dopo ~12-24h.

**CI/DX**:
- ✅ Migration dev3 rinumerate 024/025 → 027/028 per evitare collisione con master.
- ✅ Prettier autoformat post-merge dev3 (5 file Writer-on-demand + 3 file Geocoding).
- ✅ ESLint 8 errori bloccanti risolti.
- ✅ Node 20 → 24 sui workflow CI/CD.
- ✅ `npm ci` di `shared/` aggiunto ai job lint-typecheck/test/build.
- ✅ Vitest exclude `_disabled` + 42 test legacy disabilitati con scopo (CI signal pulito).
- ✅ Governance: PR template per tier+area, CONTRIBUTING evidence-by-area, beta_feedback issue template.

### 🐛 Team strategy bugs sprint — 2026-05-17 / 2026-05-18 (19 commit, 48h)

Dettaglio in
[`docs/internal/_archive/BACKLOG-2026-07-03-frozen.md`](docs/internal/_archive/BACKLOG-2026-07-03-frozen.md) (§ Team strategy bugs sprint)
e [`docs/sessions/2026-05-18-fix-effectiveness-review/`](docs/sessions/2026-05-18-fix-effectiveness-review/).

**Effetto cumulativo misurato (pre/post-fix)**:
- 🚨 EMERGENZA Sentinella **−96%** (25 → 1)
- 🚨 URG msg **−71%** (24 → 7)
- 🚨 FREEZE menzioni **−82%** (34 → 6)
- ✅ applications status='ready' visibili **0 → 19** (era bug #21!)
- ✅ state_transitions log **0 → 243** tracciate (bug #14)
- ✅ CV con engine corretto **27/27 → 71/73** (wkhtmltopdf)
- ✅ Dottore vivo nel team **mai → spawn ogni 2h** (bug #18)
- ✅ Boot container **4/9 auto-start → 9/9 auto-start** (zero comandi manuali)

**13 bug strategici + 3 feature chiusi**:
- **#14** state-event log positions transitions (commit `2ceb0a17`)
- **#15** timezone CEST/UTC — setup wizard chiede TZ + cascade format_time (commit `78004470`, `eb4cad5d`)
- **#17** Capitano C-05 auto-triage attivo (commit `426f1865`)
- **#18** Dottore mai spawnato — regressione storica + post-mortem zombie night chiuso (commit `db2c2d47`, `dad3c94a`, `d012b75c`)
- **#19A** weekly_reset_at log nei tick bridge (commit `dca5a614`)
- **#19B** Capitano "indaga prima di non lo so" — confluito in C-04 (commit `43cf5072`)
- **#20** `/reports` query Supabase reali al posto di mock + migration 014 (commit `964afc4d`)
- **#21** Scrittore promuove `applications.status='ready'` dopo Critic PASS (commit `5c9c5042`)
- **#23** "Leggi fonte non memoria" — regole A-04/C-04/M-05 (commit `43cf5072`)
- **#24** Sentinella 3 fasi + scala throttle continua 60-600s (commit `d6c1c646`)
- **#25** Dedup gerarchica 3 livelli SC-05 + naming CV con position_id (commit `22aaeb72`)
- **#26** Atomic CV PDF write + status gate + cv-disk-audit + engine wkhtmltopdf (commit `b1b5145f`, `f695b503`)
- **#27** Salary cache locale + skill salary-estimate gerarchica (commit `16f55be2`)
- **F-1** Telegram UX: setMyCommands + reply keyboard + auto-report PNG ogni 2h (commit `d019f192`, `39169b46`)
- **F-2** Scout web access 5 componenti: anti-bot cascade L1/L2/L3, LinkedIn no-login via `/jobs/view/<id>`, email-monitor IMAP, multi-Scout workspace, freshness SC-07 (commit `3b3e93eb`, `f4695cec`)
- **F-4** Expiration tracking: deadline parser EN/IT + alert utente idempotente (commit `69a7c117`)

**2 regressioni introdotte durante lo sprint, già risolte**:
- Zombie night 18/5 23:14→09:05 UTC — agent-watchdog non controllava pane_current_command, kimi crashato in sessione tmux viva = silent zombie 6h. Fix: pane check + kill+respawn + cadenza Dottore 30min→2h + skill `spawn-doctor` per coordinatori (commit `dad3c94a`, `d012b75c`). Post-mortem [`docs/sessions/2026-05-18-capitano-zombie-night/`](docs/sessions/2026-05-18-capitano-zombie-night/).
- CV "estetica semplificata" 18/5 — skill cv-structure citava `--pdf-engine=typst` non disponibile in pandoc 2.17 container, Scrittori fallback a fpdf2 1-pagina spartana. Fix: 4 reti di sicurezza (preflight engine + gate Producer post-render + guard pdf_gen.py refuse CV paths + regola scrittore S-05). 31 CV brutti rigenerati retroattivamente (commit `f695b503`).

**Infrastruttura altri fix correlati**:
- `488ff9ac` — pid1.js auto-spawn `sentinella` tmux + `sentinel-bridge.py` + `pacing-bridge.py` (boot 9/9 senza intervento manuale)

**Debt residuo identificato** (non blocking):
- 🟡 Capitano context bloat (83.7k tokens/turn vs 50k storico) → soluzione proposta: refresh contesto periodico dei coordinatori (memoria nel DB, conversazione non critica)
- 🟡 Scout sweep 116k tokens/turn — cap parziale linkedin_access.py, retrofit `web_scrape_robust.py` da fare
- 🟡 F-3 weekly distribution (deferred — default G-spot OK)
- 🟡 F-1.C inline keyboard show_cv:X callback (deferred)
- 🟡 F-4.B Analista re-check periodica positions vecchie (deferred)

**Analisi consumo settimanale** ([`docs/sessions/2026-05-18-weekly-budget-analysis/`](docs/sessions/2026-05-18-weekly-budget-analysis/)):
- 1% finestra Kimi ≈ 0.20% weekly budget (+8.5% rispetto a 0.189 settimana scorsa, causa context bloat)
- ~5 finestre piene/settimana capacità (vs 5.9 settimana scorsa)

### 🖥️ Desktop launcher

- **Setup wizard rewrite** — i18n (en/it/hu), language picker, new step flow, progress UI; "Install everything" button orchestrates the full one-click setup
- **🍎 macOS one-click install** — Homebrew auto-installed via official `.pkg` (no Terminal needed for the user), Xcode Command Line Tools installed first, Colima detected and installed via `brew install colima docker`, fall back to QEMU backend (with auto-installed `qemu`) when Colima can't start on Apple VZ
- **🪟 Windows one-click install** — WSL2 + Docker Desktop installed via single UAC prompt + reboot flow; Git installed via `winget`; checklist unifies all required deps; "Install everything" button moved out of the Docker card to an OS-level action
- **🔌 Embedded terminal for login** — backed by `@lydell/node-pty` (real Windows prebuilts), xterm + addons, clipboard bridge for right-click copy/paste, ephemeral container spawned via `compose run`, modal stays open on non-zero exit, per-session container cleanup
- **🚀 Smart boot** — home opens directly if setup is already done (no wizard re-run), runtime button reflects current OS, post-setup home with sidebar + dev-mode card
- **🔧 Provider modules** — new backend modules: `provider-install`, `provider-store`, `provider-auth`, `container-prep`, `deps`, `disk-space`
- **🐳 Docker installer module** — refined three-state status (`ok` / `needs-reboot` / `missing`), desktop path, bundled Docker logo, macOS download URL points to Colima guide; status check uses `colima status` on macOS
- **🍎 macOS code signing** — re-sign ad-hoc bundle with `--deep` to prevent Team ID mismatch at launch; re-sign moved from `afterPack` to `afterSign` so it survives notarization
- **🛠️ Setup IPC + dev mode** — new `dev:probe` / `dev:stop` IPC handlers to manage dev-mode from UI, "open terminal" buttons for Captain/Sentinel/agent sessions trigger native Terminal with `tmux attach`
- **🐳 Container hygiene** — runtime container always named `jht`, stale containers cleaned on start; auto-launch Docker Desktop on Windows if daemon is off; drop unused `GEMINI`/`GOOGLE` env vars
- **🐛 Fixes** — wrong-platform flash on darwin checklist (belt-and-suspenders hide), provider switch from home returns home (not wizard), `@lydell/node-pty-win32-arm64` declared as dependency, `dev-up.sh` stdout/stderr redirected to `.dev-logs/dev-up.log`, don't auto-open browser on `dev:launch`

### 📊 Monitoring & Bridge — non-linear architectural iteration

The 10-day arc was not a clean V1→V5 progression — it was a real-world exploration:

1. **Bridge V1 (clock-only)** — `sentinel-bridge.py` daemon, no LLM, just polls usage on a fixed clock and computes projections
2. **Sentinel temporarily eliminated** — Bridge talks to Captain directly; Sentinel LLM removed because it was burning too many tokens
3. **Sentinel reintroduced as LLM watchdog** — turns out a thin LLM layer is needed for nuanced decisions Bridge can't make deterministically
4. **Bridge V3** — active fetcher, Sentinel as fallback only
5. **Bridge V4** — Sentinel repositioned as filter between Bridge and Captain
6. **Bridge V5 (current)** — "Pasqua-style" activates above V4 stack
- **🚦 Bridge rule-set** — single rule 85–95% with L1/L2/L3 escalation, lazy WORKER fallback, throttle on absolute usage with target 95% and EMA reset on gap, singleton lock + kill-before-spawn in `start-agent.sh`, EMA 10-tick + burst filter on cumulative delta of last hour, invalidate last sample on provider change, notify only on throttle/host change (not on every status), tau-aware projection, watchdog degraded mode, default poll 5min
- **🌉 Bridge as separate role in launcher** — ordered startup (Captain → Sentinel → Bridge), first usage sample now comes from Bridge (removed pre-Bridge `sleep 20`)
- **🌉 Bridge API + UI** — `/api/bridge/{start,stop,status}` endpoints, popover in web team page with interval slider, live LED tied to real bridge state, start/stop from UI, countdown + animation synced with the real bridge clock
- **💂 Sentinel prompt refactor** — from 491 lines (inline) to 130 lines (orchestrator) + 6 on-demand skills:
  - `check_usage_http` / `check_usage_tui` (multi-source usage checks)
  - `decision_throttle` (rate-limit decision logic)
  - `emergency_handling` (rate-limit recovery)
  - `memory_state` (Sentinel state across ticks)
  - `order_formats` (orders to Captain)
  - `bridge_health` (Bridge maintenance from Sentinel)
- **🛡️ Other Sentinel skills** — `freeze_team`, `soft_pause_team` (graceful team pause), TUI worker fallback
- **⏰ Captain** — 1-spawn/tick mode, kick-off at boot, tick interval as float with 0.25 step, autonomous mode (no escalation needed for normal operation), new `rate-budget` skill for proactive budget checks, live `rate_budget` command for on-demand API fetch
- **📊 Monitoring G-spot** — target window raised from 85–95% to 90–95% (more aggressive utilization)
- **🐛 Fixes** — TUI parser was reading wrong modal (now reads the latest), handles `RATE_LIMIT` as a string; 3 concomitant bugs that caused rate-limit overshoot; `check_usage` dispatcher now multi-provider (no more hardcoded `claude`)

### 🌐 Web platform

- **💬 Live team page** — org-chart with multiple iterations: Sentinel removed then re-added with green LED on active agents, Bridge node added with inter-agent message animations, sender color dot, popover on click, stable LED, more breathing room (width 620 → 820 → 1080, larger gap), smaller LED dots (9px → 5px)
- **📊 UsageChart** — interactive (hover tooltip + range selector), time-based x-axis with 85–95% target band + 10/30min zoom, multi-source coloring with legend showing which agent did each check, `GAP_MS` 3min → 12min (no more visible line breaks), pan via drag, taller (220 → 360px), section margins + centered charts, mini-chart variant under org-chart
- **💬 Live event channel** — team message stream for inter-agent communication visible in UI
- **🖥️ Embedded terminal access** — "open terminal" buttons in Captain/Sentinella/AgentInteraction panels open native Terminal with `tmux attach`; `JHT_SHELL_VIA=docker:<container>` mode for `docker exec` from web; gate behind dev-mode toggle; SettingsMenu with dev-mode toggle + direct Team link (no dropdown)
- **👤 Profile UI** — `ProfilePageClient` removed (folded into the page), FAB redesigned as flex sibling, deep-links from missing-fields to edit sections, completion-only stats; Floating Assistant Button with chat panel wired to `/api/assistente/*`
- **🧭 Navbar** — nav links flow-centered with `mx-auto` (no more overlap), workspace-folder widget removed from header
- **🔌 Provider management** — `/providers` page can check CLI versions and trigger updates from the UI
- **🌍 Public site restructured for subscription model** — `LandingFooter` added to home, `/download` polished (back link, minimal CLI box, footer), privacy/terms/project rewritten for subscription pricing, deprecated public pages deleted, footer cleaned, admin pages moved under `(protected)` route group
- **🌍 i18n** — defaults switched to English, Hungarian (`hu.json`) diacritics fixed, subscription copy translated en/it/hu
- **🚦 Web/team bulk** — bulk action buttons relabeled (shorter: Start / Active / Stop), Stop-all preserves the Assistant agent
- **🐛 Fixes** — `next.config.ts` `turbopack.root` always set to cwd (avoids postcss leak), `web/AgentInteraction` stick-to-bottom is conditional with 1.5s refresh, Sentinella reachable via `/api/agents` and `/api/health`, role-id → session map updated to include Sentinella

### 🔧 CLI

- **`jht team` / `jht container` / `jht sentinella`** — full container coordination (proxy via `docker exec`, `docker compose` wrapper, JSONL reader + ASCII sparkline)
- **`jht providers`** — `list/current/use/update/check` with version detection and CLI alias normalization
- **`jht positions`** — `list/show/dashboard` reading from container's `db_query.py`
- **`cli/container`** — auto-launch Docker Desktop on Windows when daemon is off

### 🤖 Agents & runtime

- **🌙 Kimi (Moonshot) provider support** — multi-provider start-agent reads `active_provider` from config, Kimi tmux requires Ctrl-S after Enter for immediate submit, TUI parser handles Kimi RATE_LIMIT strings, dismiss `codex` auto-update prompt before launch
- **🐚 jht-tmux-send** — `verify-then-Enter` pattern + retry to avoid lost characters
- **🚀 Launcher** — readiness check via idle-diff, verify-then-Enter for kick-off
- **📁 Skills runtime data** — moved out of repo into `$JHT_HOME/data` (no more polluting the working directory)
- **🐳 Container** — unbundled CLIs (lighter image), Google → Moonshot provider swap

### 📚 Documentation

- **📘 README rewritten** end-to-end for pre-launch — story, providers, vision, monitoring stack, AI-agent integration. Manifesto: *"AI on the side of workers, not against them."* Track record callout (~200 offers · ~20 applications · 5 interview invites in 2 weeks). Local-first positioning. Demo placeholder. AI-agent CLI USP section.
- **📋 BACKLOG rewritten** in English with status refresh — 12 tasks flipped ⬜→✅ (CLOUDSYNC ping/push, ONBOARDING split-screen, FRONTEND 1-5, multi-provider, CLI ↔ container 5/5, JHT-QA-01 with 75+ Playwright specs); 5 known bugs removed (all fixed); restructured by area; added PHASE 6 (Pre-Launch) with 4 BLOCKERs (SECURITY, COC, demo video, security review) + new tasks (test campaign, VPS validate, monitoring weekly window, user work hours, Kimi optimize, Sentinel optimize).
- **🆕 9 new documents:**
  - `docs/about/STORY.md` — origin story (legacy team results, why open source)
  - `docs/about/PROVIDERS.md` — supported subscriptions matrix (🟠 Claude / 🔵 Codex / 🌙 Kimi)
  - `docs/guides/AI-AGENT-INTEGRATION.md` — how Claude Code / 🦞 OpenClaw / Codex / Cursor can drive JHT
  - `docs/about/VISION.md` — gamification philosophy, agents as characters, anti-goals
  - `docs/about/MONITORING.md` — Bridge/Sentinel monitoring stack (architecture + test data)
  - `docs/about/RESULTS.md` — case studies + community template
  - `docs/guides/BETA.md` — beta tester program + coverage matrix (provider × persona, 10 cells, 1/10 done) + status board
  - `docs/internal/ops/MAINTAINERS.md` — internal operations reference (Supabase, Vercel, OAuth, security)
  - `agents/mentor/mentor.md` — career-coach agent spec (added as `maestro`, since renamed and shipped as **Mentor**)
- **📐 ADR-0004** added — subscription-only, no API keys (decision rationale)
- **📚 ROADMAP, INFRA, BETA, MONITORING** updated for consistency (team size + page counts as of that update, 📡 Bridge in monitoring stack)
- **🦞 OpenClaw integration** — emoji standardized across README + AI-AGENT-INTEGRATION.md

### 🔒 Security

- **🛡️ Pre-launch hardening sprint** (sha `7a2cb6ae`) — 4 agenti Claude in parallelo (worktrees dev-1..dev-4), 31/34 fix in ~95min, security score **30% → 74%**, gap vs OpenClaw chiuso da -78 a -25 punti
- **Phase 1 (bloccanti pre-launch) 9/9 ✅** — C1-C5, H1, H2, H8, H9
- **Phase 2 (post-launch) 12/12 ✅** — H3-H6, M1-M8
- **Phase 3 (hardening) 10/13 🟡** — gap residui (blockers per public release): SSRF dispatcher generico, `resolve-system-bin` strict, CSP hash-based prod L1
- **🆕 Moduli nuovi:** `web/lib/{auth,csrf,error-response,fs-safety,local-token}.ts`, `shared/{credentials/passphrase,credentials/manager,logger/redact}.ts`, `cli/src/commands/keyring.js`
- **🔑 Innovazioni vs OpenClaw:** dual-channel auth (cookie HttpOnly + Bearer fallback), `jht keyring set/get/delete` CLI, PBKDF2 + salt random per file OAuth storage
- **🧹 Logger redaction** — pattern segreti (Bearer/PBKDF2/JWT/API key) hookato nel Logger
- **🐳 Docker base image** pinned a SHA256 + Dependabot Docker weekly
- **🪝 Pre-commit hooks** — gitleaks, detect-secrets (con baseline), actionlint, zizmor, npm-audit-prod
- **📚 7 nuovi documenti** in `docs/security/` (~2336 righe) — pre-launch review (27 finding), OpenClaw comparison file-per-file, implementation tradeoffs, threat model, checklist, post-fix snapshot

### 🧪 Testing

- E2E provider smoke test added
- 75+ Playwright specs already covered web platform end-to-end (auth, dashboard, profile, applications, security headers, accessibility, performance) — now formally tracked in BACKLOG

### 📦 Internal

- `0.1.13-dev` version bump
- `chore(container)`: unbundle CLIs, switch Google → Moonshot, add ADR-0004

---

## [0.1.12] — 2026-04-17

### 🐛 Fixed

- **Bundle**: the v0.1.11 DMG/EXE crashed on first launch with `Cannot find module './docker-installer'` because the `build.files` field in `desktop/package.json` is an explicit whitelist and the new modules (`disk-space.js`, `docker-installer/**`) were not included. Added them to the list; the new modules' `*.test.js` are explicitly excluded from the release bundle.

No other functional change vs v0.1.11: this is a pure install-time bugfix.

---

## [0.1.11] — 2026-04-17

Release focused on rewriting the desktop launcher experience based on the 2nd round of E2E tests on Windows ARM64 (see `e2e-runs/2026-04-17-windows-arm64-round2/`).

### 🖥️ Desktop launcher — wizard rewrite

- **Step-based UI** instead of a single scrollable page: four discrete steps — Welcome → Setup → Ready → Running — each with a single primary button. The technical log is no longer visible by default; it sits behind a "Technical details" disclosure in the Running step.
- **"Alpha · in testing" topbar** persistent across all steps, so the user always knows the product status.
- **Essential dependency checklist**: the Setup screen shows only Docker (the single mandatory dependency in container mode). Node/Git/Python are removed from the main surface.
- **Start blocked** until Docker is ready: the "Start Job Hunter Team" button only appears in the Ready step, and Ready is only reachable after the checklist is green.

### 🔧 Setup wizard — dependency management

- **Docker status with three values**: `ok` (ready), `needs-reboot` (binary present but `docker ps` doesn't respond — typically the user installed Docker Desktop without rebooting), `missing` (not installed).
- **Guided manual install flow**: when Docker is missing, a "Download installer" button opens the official `docker.com/products/docker-desktop/` page in the default browser. The user installs it, reboots if needed, returns to the launcher and clicks "I installed, recheck" / "I rebooted, recheck".
- **Pre-install preview**: before installing, the Docker card shows the estimated install size and free disk space (via `powershell Get-PSDrive` on Windows, `fs.statfs`/`df` on Unix — zero extra npm dependencies).
- New `desktop/docker-installer/` module with `manifest` (per-OS strategy), `check` (three-value status), `download-url` (official URL per OS). Policy respected: macOS strategy is Colima via Homebrew (NOT Docker Desktop); Linux is `get.docker.com`; only Windows uses Docker Desktop.

### 🔌 IPC

- New channel `setup:get-docker-status` → `{platform, arch, strategy, check, disk}`.
- New channel `setup:open-docker-download-page` → opens the official Docker URL in the browser.
- Exposed to the renderer as `window.setupApi`.

### 📝 Notes

- **F4** (Windows installer closes on first attempt, round 1): not addressed in this release, still open.
- The previous `launcher:open-external` with HTTP whitelist remains for general use; the new `setup:open-docker-download-page` is a dedicated endpoint that does not expose arbitrary URLs.

---

## [0.1.10] — 2026-04-16

Release focused on friction points that emerged from manual E2E tests on Windows ARM64 and macOS (see `e2e-runs/2026-04-16-windows-arm64-parallels/` and `e2e-runs/2026-04-16-macos-dev-machine/`).

### 🖥️ Desktop launcher

- New **in-app dependency checklist** that detects Docker, Node (≥20), Git and Python with per-OS install hints; Start is blocked until mandatory dependencies are OK — fixes the UX gap found during testing (the app didn't signal anything if Docker was missing).
- **Thin launcher**: removed `extraResources: app-payload` from electron-builder; the payload (web app) is downloaded into `userData/app-payload` on first Start via git sparse-checkout and is updatable from the UI. `JHT Desktop.app` size cut from ~300 MB to a much lighter footprint; no more re-download of the installer for every web app update.
- New "How to install" button per missing dependency, opens the official docs in browser.
- `launcher:open-external` IPC handler with http/https allowlist.

### 🍎 macOS code signing & notarization

- electron-builder config with `hardenedRuntime: true`, `notarize: true`, `desktop/build/entitlements.mac.plist` (minimal set: JIT, unsigned-executable-memory, network.client).
- Release workflow imports cert from `MACOS_CERTIFICATE` + `MACOS_CERTIFICATE_PWD`, passes `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` to `@electron/notarize`.
- Post-build verification with `codesign -dv --verbose=4` and `spctl --assess` — the mac job fails if Gatekeeper rejects the DMG.
- Fallback to **unsigned** build when secrets are missing (warning, build doesn't fail → other OSes still publish).
- Maintainer playbook in `docs/internal/ops/release.md` with all steps: CSR → `.p12` → base64, App-Specific Password, Team ID, certificate rotation.

### 🚢 Release pipeline

- New `scripts/check-release-version.sh` as **first CI job**: verifies that git tag (`vX.Y.Z`), root `package.json` and `desktop/package.json` are at the same version. Blocks release with non-zero exit on mismatch — fixes the bug seen in v0.1.8 (tag `v0.1.8` with assets named `0.1.7` because `desktop/package.json` was not bumped).
- Pre-release checklist for the maintainer in `docs/internal/ops/release.md`.

### 🪟 Windows

- **Native ARM64 build**: `desktop/package.json` now produces both `job-hunter-team-<ver>-windows-x64.exe` and `job-hunter-team-<ver>-windows-arm64.exe`. Previously only x64 → on Windows ARM (Surface, Snapdragon, Apple Silicon VMs) it ran in emulation.

### ⬇️ Download page

- `/download` detects user OS and architecture **server-side via User-Agent** (`Windows NT ... ARM64` / `aarch64`, `Mac OS X` → default arm64, `Linux`).
- Shows a single primary CTA with a direct link to the correct asset of the **latest release** (fetched via `api.github.com/repos/.../releases/latest` with `revalidate: 300`).
- Collapsible "Other options" for the rest of OS/arch combinations.
- **No more redirects to GitHub Releases** — the user stays on `jobhunterteam.ai`.
- `/api/download` API reorganized around the "variant" concept (id + arch), backward-compatible with the `platforms` field.

### 📦 CLI install

- `scripts/install.sh --dry-run` prints every command that would be executed without touching the system (useful for debug and pairing).
- `setup.ps1` aligned with `install.sh` on dependency checks (minimal parity, not a full rewrite).
- New `docs/guides/CLI-INSTALL.md` with AS-IS description of the script and a "tested environments" section.

### ⚠️ Known issues (not resolved in this release)

- **F4**: Windows installer closes silently after the 2nd screen on the **first** double-click (works on the second attempt). Root cause not identified — needs to be reproduced on a fresh VM watching Event Viewer and `%TEMP%\nsis*.log`. Documented in `e2e-runs/2026-04-16-windows-arm64-parallels/README.md`.

---

## [0.1.9] — 2026-04-11

### 🔐 Auth

- Added **GitHub OAuth** login as a second provider alongside Google, targeting developers and OSS contributors.
- Whitelisted `avatars.githubusercontent.com` in `next/image` and the CSP `img-src` to avoid the dashboard crash on first GitHub login.

### ☁️ Cloud Sync (opt-in)

- New `cloud_sync_tokens` table (migration 006) with per-user RLS, SHA-256 token hash, soft-delete via `revoked_at`.
- API CRUD `/api/cloud-sync/tokens` (GET list, POST create, DELETE revoke) — the plaintext token is returned only once at creation time.
- `/settings/cloud-sync` page to generate, copy, and revoke tokens; each token has a human-readable name to identify the device (e.g. "MacBook home", "Linux cron").
- `/api/cloud-sync/ping` endpoint for Bearer token verification (uses service-role admin client to bypass RLS), updates `last_used_at` on every check.
- CLI commands `jht cloud enable/status/disable` — `enable` validates the token against `/api/cloud-sync/ping` and persists it in `~/.jht/cloud.json` (chmod 0600); `--url` supports self-hosted and local development.
- New helper `web/lib/supabase/admin.ts` for service-role client used only server-side.
- Migration 007: `UNIQUE (user_id, legacy_id)` constraint on `positions` to allow atomic upsert of rows synced from local SQLite.
- `POST /api/cloud-sync/push` endpoint accepting batches of `positions/scores/applications`: idempotent positions upsert via `legacy_id`, build of the legacy_id → UUID mapping, upsert of scores and applications with the new UUIDs as FKs. `status` and `critic_verdict` normalization against Supabase enums.
- CLI command `jht cloud push` reads SQLite via the built-in `node:sqlite` (requires Node 22.5+, zero native deps), supports `--db <path>` and `--dry-run`, gracefully handles missing database/tables.
- New helper `web/lib/cloud-sync/auth.ts` with `verifyBearerToken` shared between ping and push.
- Operational note: the env var `SUPABASE_SERVICE_ROLE_KEY` must be configured on Vercel (Production + Preview) for the cloud-sync endpoints to work in prod.

### 🐳 Docker Runtime (default-on)

- New root `Dockerfile` + `docker-compose.yml` for the JHT container runtime, published as `ghcr.io/leopu00/jht:latest` (multi-arch amd64+arm64).
- New GitHub Actions workflow for automatic build and push to GHCR.
- Node runtime bumped to **Node 22 LTS** for compatibility with the built-in `node:sqlite` used by cloud-sync.
- Automatic bootstrap of `shared/` modules and TUI build inside the container, `dashboard` wired as PID 1.
- `isContainer()` gate (env `IS_CONTAINER=1` or `/.dockerenv`) at all `open/xdg-open/explorer` call sites: instead of launching the browser from the container, the CLI prints path/URL.
- Bind mount contract: `~/.jht → /jht_home`, `~/Documents/Job Hunter Team → /jht_user`.

### 📦 Installer

- `install.sh` rewritten **Docker-by-default**: installs the runtime (Colima on macOS, docker.io on Linux/WSL2), pulls the GHCR image, creates a `jht` wrapper in `~/.local/bin` that does `docker run` with the standard contract.
- Opt-out with `curl ... | bash -s -- --no-docker` for native mode (expert mode).
- `install.sh` now served as a **Vercel static asset**: `curl -fsSL https://jobhunterteam.ai/install.sh | bash`.
- Wrapper compatible with bash 3.2 (macOS system bash).
- Fix `--help` line range and `set -e` leak.
- `cancel-wizard` hint updated to `jht setup`.

### 🖥️ Desktop Launcher

- Electron launcher now spawns `docker run ghcr.io/leopu00/jht:latest dashboard --no-browser` instead of native `next dev`.
- Automatic Colima bootstrap on macOS at first launch.
- `JHT_NO_DOCKER=1` for fallback in native mode (debug/development).

### 🐛 Fixed

- **Vercel build**: `next.config.ts` now explicitly sets `outputFileTracingRoot` and `turbopack.root` to the monorepo root, with `outputFileTracingExcludes` to skip `cli/`, `desktop/`, `tui/`, `agents/`, `e2e/`, `scripts/`, etc. This solves the 250 MB unzipped Serverless Function limit, which otherwise included the entire monorepo.
- **Assistente page**: removed orphan JSX block `{workspace && (...)}` left over from the refactor that removed the `workspace` state (build broken with `Cannot find name 'workspace'`).
- **Download banner**: removed the yellow "asset pending" banner from the `/download` page (obsolete after desktop packages were released).
- **Post-merge path refactor fix**: consistency on paths centralized on `JHT_HOME`.

---

## [0.1.8] — 2026-04-10

### 🐛 Fixed

- Added `overrides` for `@swc/helpers` in `package.json` to resolve dependency conflicts during `npm ci` in the release workflow.

---

## [0.1.7] — 2026-04-10

### 🌐 Web app

- Removed (again) from the homepage the deprecated landing that had returned during the `0.1.6` recovery, keeping the simplified version intended for live.
- Realigned the homepage to the section set actually supported in production.

### 🚢 Release & deploy

- Fixed the Vercel verification flow in CI, which now checks the linked Git project even without local `.vercel` metadata.
- Blocked publication of release tags that don't point to the current `production` HEAD.
- Added a dedicated workflow to create the release tag directly from `production` HEAD.

---

## [0.1.6] — 2026-04-09

### 🌐 Web app

- Reintroduced the full i18n layer with `it` / `en` / `hu` support, more robust fallbacks and correct language persistence across API, landing and dashboard.
- Realigned landing, `/project` page, download and app chrome with metadata and content consistent with the current release.
- Restored translated messages, layout and loading state in the main protected and public pages.

### 📺 TUI

- New setup wizard with clean vertical flow, fixed file picker and restored select navigation.
- Added multi-provider auth system with OpenAI OAuth PKCE, API key support and encrypted credential storage.
- Refined wizard integration with provider, authentication method and workspace bootstrap.

### 🖥️ Desktop, tests & tooling

- Updated standalone desktop payload and runtime preparation for local packaging.
- Fixed tests and runtime scripts tied to the desktop launcher and setup documentation.
- Versions and visible metadata aligned to `0.1.6` across all tracked packages in the monorepo.

---

## [0.1.5] — 2026-04-09

### 🎨 UI simplifications

- Web landing simplified, redundant sections removed, dev CSP fixed.
- Hero and download page polished; download platform ordering finalized.
- Auth: aligned public login redirects and `app_url` for deployed environments.

### 📺 TUI setup

- macOS workspace picker improved.
- Setup banner alignment fixed.
- Workspace config aligned with web side.

### 📝 Internal

- `chore(release)`: `0.1.5` metadata prepared.
- Restored `FloatingChat` type aliases for the test suite.

---

## [0.1.4] — 2026-04-08

### 🌐 Web access & setup

- Web login reorganized with cloud-first access and immediate fallback to local workspace.
- Added `NEXT_PUBLIC_APP_URL` to correctly compose the OAuth redirect in deployed environments.
- Ignored Supabase temp files and dev server local logs.

### 📺 TUI

- New guided profile flow with validations, checkpoints and initial setup banner.
- Cleaned-up team view with horizontal layout, fixed ASCII banner and `/workspace` command.
- Improved prompts, examples and redraw of the profile wizard.

### 🌍 Public site

- Landing simplified and made more readable in hero and CTA sections.
- Widespread cleanup of marketing pages and significant content reduction on the stats page.

---

## [0.1.3] — 2026-04-08

### 🪟 Desktop Windows

- Lightened the web payload included in the desktop installer, copying only production assets and dependencies.
- Removed cache and sourcemaps from the packaged payload to reduce size and install time on Windows.
- Confirmed the `nsis` build locally with a noticeably smaller Windows installer.

---

## [0.1.2] — 2026-04-08

### 📦 Desktop release

- Added the metadata required by `electron-builder` for the Linux `.deb` package.
- Confirmed Windows `.exe` and macOS `.dmg` packaging in the release workflow.
- Prepared the cross-platform desktop release publishable via GitHub Actions.

---

## [0.1.1] — 2026-04-08

### 📦 Desktop release

- Aligned all `package.json` and `package-lock.json` versions to `0.1.1`.
- Confirmed Electron desktop packaging for macOS, Windows and Linux.
- GitHub Release workflow ready to publish real `.dmg`, `.exe`, `.AppImage` and `.deb` installers.
- Download page and API read the actual assets of the latest release instead of assuming legacy archives.

---

## [0.1.0] — 2026-04-04

### 🤖 Multi-agent pipeline

- Scout, Analyst, Scorer, Writer, Critic, Sentinel, Captain.
- Agent runner with tool loop, abort and error handling.
- Shared SQLite database with anti-collision between agents.

### ⌨️ CLI `jht`

- Interactive setup wizard with `@clack/prompts`.
- `jht team start/stop` with `JHT-` session prefix for TUI compatibility.
- `jht status`, `jht config show`, `jht cron list`.
- `jht export/import` (JSON/CSV, dry-run, merge/replace).
- `jht health` (7 modules with semaphores).
- `jht backup/restore` with manifest and retention.
- `jht migrate` (config versioning with dry-run).
- `jht logs`, `jht providers`, `jht stats`.
- `jht plugins`, `jht agents`.

### 📺 TUI (Terminal UI)

- Multi-agent navigation with `@mariozechner/pi-tui`.
- Chat panel with streaming, tool messages, thinking blocks.
- Real-time counter of active tmux sessions.
- Single Ctrl+C to exit.

### 🌐 Web Dashboard (50+ pages)

- Pipeline: agents, sessions, applications, analytics.
- Infrastructure: health, retry/circuit-breaker, rate-limiter, queue, events SSE.
- Configuration: settings, credentials, plugins, tools, templates, providers, memory.
- System: overview, gateway, channels, notifications, cron, daemon, deploy.
- Data import/export, backup, migrations, i18n it/en.

### 🧱 Shared modules

- `config/` — Zod schema, centralized I/O.
- `llm/` — factory for Claude, OpenAI, Kimi.
- `sessions/` — registry with JSON persistence.
- `hooks/` — source precedence, frontmatter loader.
- `events/` — typed pub/sub event bus.
- `plugins/` — discovery, lifecycle, toggle.
- `context-engine/` — LLM context collection and prioritization.
- `rate-limiter/`, `retry/` — 3-state circuit breaker.
- `queue/` — dead-letter, exponential backoff retry + jitter.
- `templates/` — variables, sections with character budget.
- `notifications/` — multi-channel adapter registry.
- `analytics/` — token usage, p95 latency, provider costs.
- `credentials/` — AES-256-GCM, OAuth.
- `memory/` — SOUL/IDENTITY/MEMORY.
- `history/`, `tasks/`, `validators/`, `migrations/`, `backup/`, `cache/`, `i18n/`.

### 🧪 Testing

- 736+ test cases across 168 files (vitest).
- Unit, integration, E2E CLI and web tests (Playwright).

### 🛠️ CI/CD

- GitHub Actions: lint, type-check, vitest matrix, build, Vercel deploy.
- Security: npm audit, gitleaks, Semgrep SAST.
- Dependabot for npm and GitHub Actions.
- PR template, issue templates, CONTRIBUTING.md.

---

## [Pre-0.1.0] — 2026-02-22 — Legacy team optimizations

11 fixes applied to the early V2 worktree-based team (one CLAUDE.md per agent worktree) before the project was packaged as v0.1.0. Captured here for historical traceability after the standalone optimization log (`ottimizzazioni-team.md`) was retired.

- **OPT-001** — *Scout: tool strategy table.* Explicit site→tool mapping in CLAUDE.md; lists sites blocked by robots.txt (LinkedIn, Wellfound, Revolut, WTTJ) so scouts stop wasting turns trying `fetch` on them.
- **OPT-002** — *Scout: LinkedIn auth fallback.* On intermittent `linkedin` MCP `authentication_failed`, don't retry immediately; wait 2-3 turns and use `jobspy` for bulk search in the meantime.
- **OPT-003** — *Scout: insert-fast / update-later.* Write the position to DB on discovery (title + company + URL) and fill the JD afterwards, instead of waiting for full data.
- **OPT-004** — *Scout: stop condition.* One cycle = all assigned sources × 2-3 queries, max 15-20 minutes, mandatory end-of-cycle summary, then STOP and wait for instructions; never re-run on already-covered sources.
- **OPT-005** — *Scout: Captain (`🐺 ALFA`) communication.* Verify with `tmux has-session` before sending; the Captain reads via `capture-pane`, no message needed.
- **OPT-006** — *Scout: geographic + relocation availability.* Added "DISPONIBILITÀ GEOGRAFICA" section to the candidate profile in CLAUDE.md; only hard exclusion is "US work authorization required"; queries updated to include city names (Berlin, Amsterdam, London…); removed "On-site fuori Roma" as a negative criterion.
- **OPT-007** — *Scout: concentric circles protocol.* 5 circles (Remote EU → Roma → Italia → EU capitals → rest of EU) split between scouts by opportunity type (not by source); all scouts use all sources, but with circle-specific queries; added EU tech career-page list (Spotify, Booking, Adyen, Wise).
- **OPT-008** — *Scorer + Writers: practice-interview tier.* New score tiers 🟢 SERIOUS (≥70) · 🟡 PRACTICE (40-69) · 🔵 REFERENCE_ONLY (<40); writer effort levels match (full personalization · template · skip); on-site penalty rebalanced (relocation OK, US-only −25).
- **OPT-009** — *Analysts: data cleaning + filtering.* Analysts now correct company name / location / remote_type via `db_update.py` (not just in notes); new `excluded` status for unfit positions (US-only, no Python, senior 5+, scam, UK-only post-Brexit); scorer only ever sees clean, fit-able positions.
- **OPT-010** — *Scorer: sequential one-at-a-time.* Never load all positions in a bash batch; the loop is query next → detail → score → insert → update → repeat.
- **OPT-011** — *Scout + Analysts: URL and deadline mandatory.* `--url` is now `required=True` in `db_insert.py position` (script fails without it); new `deadline` column in DB; analysts scrub for missing URLs and mark expired/404 JDs as `excluded`; dashboard surfaces deadline on cards.

> Note: paths in the entries above (`scout-1/CLAUDE.md`, `scrittore-1/CLAUDE.md`, sessione `🐺 ALFA`) reference the pre-0.1.0 worktree-per-agent architecture. The current single-prompt-multi-instance model lives at `agents/<role>/<role>.md`.
