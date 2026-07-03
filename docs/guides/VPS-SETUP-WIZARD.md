# 🖥️ VPS setup via desktop wizard — Path 2 (non-tech)

User-facing guide to install Job Hunter Team on a Hetzner VPS using
**the Electron desktop app** (no terminal, no manual SSH). Validated end-to-end
on **2026-05-16** in "fresh wipe" mode with 0 manual patches needed
post-wizard.

> 🚧 **The desktop app is not publicly released yet** — the website's download page is
> intentionally disabled and this path currently requires building the app from source
> ([`desktop/STATUS.md`](../../desktop/STATUS.md)). The supported beta path for a VPS is
> the manual CLI one → [`VPS-SETUP.md`](VPS-SETUP.md).

> ℹ️ **Path 2** = "Desktop on your Mac/PC + team running on a remote Hetzner VPS".
> Just want manual CLI via SSH? → [`VPS-SETUP.md`](VPS-SETUP.md) (tech path).
> Want everything local on your PC, no cloud? → [`QUICKSTART.md`](QUICKSTART.md).

## TL;DR

Open the JHT Desktop app → follow the wizard. At the end of the wizard you get **3 welcome
messages on Telegram** (Assistant, Captain, Mentor). You upload your CV in
chat to the Assistant → within ~30 min the team writes the first personalized CVs
for real positions.

No terminal commands on the user side.

## 🧰 Prerequisites

You need these ready in advance (5 minutes of prep):

| What | Where to get it | How long it takes |
|---|---|---|
| **Supabase account via Google OAuth** | created by the wizard at first login | instant |
| **3 Telegram bot tokens** | [@BotFather](https://t.me/BotFather) → `/newbot` × 3 (Assistant, Captain, Mentor) | ~3 min |
| **Hetzner Cloud account** | [console.hetzner.com](https://console.hetzner.com) — credit card required | ~5 min |
| **AI provider account** | Kimi (Moonshot, free) or a Claude/Codex subscription | depends |
| **JHT Desktop app installed** | build from source — see [`desktop/STATUS.md`](../../desktop/STATUS.md) (public download disabled during beta) | ~15 min |

> 💡 **Telegram tip**: at each `/newbot` BotFather asks for a name (visible in
> chat, e.g. "My JHT Assistant") and a username (must end in `_bot`,
> e.g. `my_assistant_jht_bot`). Save the 3 tokens in a safe place — the wizard
> will ask you to copy-paste them.

## 🎬 Wizard sequence

Open **JHT Desktop**. The wizard takes you through these steps in order.

> 📸 **Missing screenshots**: this guide doesn't have screenshots of the 6 steps yet.
> See [§Graphic materials](#-screenshot-todo) at the bottom for the placeholders to
> fill in and contribute.

### 1️⃣ Language + location

- Language: Italian / English
- Location: choose **"VPS"** (≠ Local / ≠ dedicated PC)

### 2️⃣ Supabase login

- Click "Sign in with Google" → the browser opens → you authorize
- Return to the app, you're logged in

### 3️⃣ Telegram tokens (3)

Paste the 3 tokens you got from BotFather:
- **Assistant bot** → helps you set up the profile, receives the CV
- **Captain bot** → updates you on the team's operational decisions
- **Mentor bot** → writes to you once a week with strategic analyses

> ⚠️ The wizard verifies each token by calling the Telegram API. If one is invalid
> it tells you right away.

### 4️⃣ Hetzner VPS provisioning

Two options:

- **Existing VPS**: paste the public IP of a Hetzner VPS you already have
- **New VPS**: create a `CPX22` on the Hetzner portal (€9.75/month, 4 GB RAM,
  Helsinki) with the SSH key the wizard shows you, then paste the IP

The wizard SSHes in and runs `install.sh` automatically on the VPS:
- writes `host.env` (VPS mode)
- saves the pairing-token in `/root/.jht/`
- aligns ownership to UID 1001 (the container runs as `jht`)
- pulls the GHCR Docker image `ghcr.io/leopu00/jht:latest`
- starts the container with `docker compose up`

**Time**: 2-3 minutes the first time (image pull), 30s on subsequent runs.

### 5️⃣ AI provider (OAuth)

Choose the provider (Kimi recommended, free):
- An **embedded terminal** opens in the desktop app with `kimi --yolo`
- It gives you a device code + link → open it in the browser → authorize
- Return to the app: you see `OAuth completed ✅`

> ⚠️ **Important**: wait until you see "OAuth completed" before closing
> the embedded terminal. If you close it earlier, the `kimi.json` file isn't
> written and the container's first boot skips the agents
> (the watchdog recovers you after 30s, but it's better to wait).

### 6️⃣ Continue → bypass-to-home

The wizard finishes. **You don't need to click anything on the cloud dashboard.**

## 🎉 What happens automatically (zero-touch)

Right after the wizard closes:

```
T+0s    Docker container already running on the VPS
T+15s   pid1: sees Telegram bots + active_provider + OAuth credentials
T+18s   tmux ASSISTANT + CAPTAIN + MENTOR start in sequence (kimi loaded)
T+19s   Telegram: 3 welcome messages arrive in their respective bots
```

**Check Telegram within 30 seconds**: 3 messages should arrive:
- from `@TuoAssistente`: «Hi 👋 I'm the Assistant… send me your CV»
- from `@TuoCapitano`: «I'm the Captain. I coordinate the team that will take care of you…»
- from `@TuoMentor`: «I'm the Mentor 🧙‍♂️. I handle the big picture…»

## 📄 The workflow: from CV to the first 5 candidates

1. **You** → send the CV to the @Assistant via Telegram (PDF, DOC, even a photo)
2. **Assistant** (5-10 min) → extracts data, writes `candidate_profile.yml`,
   asks you for missing details (role, city, target salary)
3. **You** → reply "ok go ahead"
4. **Assistant** → passes the ball to the Captain
5. **Captain** → spawns Scout, Analyst, Scorer, Writer, Critic
6. **Pipeline** (~25-30 min per CV) → finds positions, analyzes them, scores them,
   writes a personalized CV, the Critic does an iterative review (v1/v2/v3 until
   it passes)
7. **CV PDFs** generated in `/jht_user/cv/` on the VPS, also visible on
   `jobhunterteam.ai/positions`

> ⏱️ **Real measured times** (session 2026-05-16): first CV written after
> ~35 min from CV upload. 5th CV after ~2 h 16 min. Kimi is the
> bottleneck (~2-5 min per LLM call), Claude/Codex are faster but paid.

## 🖥️ What you see on the web dashboard

Open [jobhunterteam.ai](https://jobhunterteam.ai) (you're already logged in):

| Page | What it shows |
|---|---|
| `/team` | Status of the running agents (running/stopped) — Start/Stop team button |
| `/team/assistente` | Chat with the Assistant (mirrored from Telegram) |
| `/team/capitano` | Chat with the Captain |
| `/team/sentinella` | Real-time Kimi usage chart + window budget |
| `/positions` | Positions found, scored, written, applied |
| `/candidate` | Your profile extracted from the CV |

## 🛟 Common troubleshooting

### ❌ "Download the desktop app" on the cloud dashboard instead of the team

The VPS↔Supabase pairing didn't succeed. Symptom: the dashboard sees
`user_onboarding_state.vps_setup_completed_at = NULL`.

**Possible causes**:
- You logged into Supabase with an account different from the one in the browser
- `install.sh` on the VPS exited with an error → check the log in the app

**Fix**: SSH into the VPS and reset the cloud configuration, then re-run
the wizard from the desktop app:
```bash
ssh root@<VPS_IP> 'jht reset creds'   # delete cloud.json + token, preserve config
# then reopen the wizard in the desktop app
```
See also [§Maintenance](#-maintenance-common-post-setup-operations) for the `jht reset config|creds|full` options.

### ❌ The 3 Telegram welcomes don't arrive

Wait 60 seconds (the watchdog retries every 30s). If still nothing:
- Make sure you sent `/start` to each of the 3 bots before setup
  (Telegram silently drops messages to anyone who never started the chat)
- Check that the tokens in the prerequisites are correct

### ❌ "Start Assistant" button stays on "Queued on the VPS…" for > 60s

The realtime subscriber on the VPS isn't receiving events. Verify:
- The `jht` container is UP on the VPS (`ssh root@<IP> docker ps`)
- The Telegram bot's network works (Hetzner Helsinki has good throughput)

### ❌ The Captain replies but says "LLM not set"

Known kimi-cli bug, already fixed with the `KIMI_SHARE_DIR` export in `start-agent.sh`. If you see this
error, the GHCR image is stale: rebuild it with `docker compose pull && docker
compose up -d` via SSH.

## 🔐 Security and privacy

- **SSH key**: generated by the wizard, saved in
  `~/Library/Application Support/jht-desktop/ssh/jht_ed25519` (Mac) or
  `%APPDATA%/jht-desktop/ssh/jht_ed25519` (Win). Don't share it.
- **Telegram tokens**: stored encrypted in Supabase + replicated on the VPS in
  `/root/.jht/jht.config.json` (mode 0644, readable only by whoever has SSH to the VPS).
- **CV PDFs**: persisted on `/jht_user/cv/` on the VPS + synced to
  Supabase Storage (RLS active, only you see yours).
- **AI provider OAuth**: token in `/jht_home/.kimi/credentials/kimi-code.json`
  (or the Claude/Codex equivalent). Never pushed to Supabase, they stay on the VPS.

## 💰 Monthly costs

| Item | Cost |
|---|---|
| Hetzner CPX22 | €9.75/month |
| Supabase Free tier | €0 (under the 500 MB DB + 1 GB Storage threshold) |
| Vercel Hobby | €0 (jobhunterteam.ai) |
| Telegram Bot API | €0 |
| Kimi (Moonshot) | €0 (with 5h window limits) |
| Claude / Codex (optional) | €17-20/month subscription |

**Typical total**: €9.75/month with free Kimi.

## 🔜 What happens if you close the desktop app

Nothing breaks — **the team keeps running on the Hetzner VPS 24/7**, independently
of the desktop app. But the desktop app is your **interaction cockpit**: chat,
file upload and start/stop reach the VPS over an SSH tunnel, so re-open it whenever
you want to control or talk to the team. While it's closed:
- **Telegram** stays available for async chat
- the **jobhunterteam.ai web dashboard** lets you **view** your data from anywhere
  (positions, scores, map) — read-only, no team control

## 🛠️ Maintenance (common post-setup operations)

> ⚠️ All the operations below are done via **SSH to the VPS**. The SSH key
> is in `~/Library/Application Support/jht-desktop/ssh/jht_ed25519` (Mac) or
> `%APPDATA%\jht-desktop\ssh\jht_ed25519` (Win). Use:
> ```bash
> ssh -i "<path/jht_ed25519>" root@<VPS_IP>
> ```

### 📦 Updating the team image (new releases)

The GHCR image `ghcr.io/leopu00/jht:latest` is rebuilt on every push to
master. To pull the update on your VPS:

```bash
ssh root@<VPS_IP> 'cd /root && docker compose pull && jht recreate'
```

Note: `jht recreate` recreates the container and loses the active tmux sessions
(they'll be respawned by pid1 + watchdog in ~30s). The data on `/jht_home` and
`/jht_user` (CV, profile, configurations) is **bind-mounted and preserved**.

### 💾 Backing up the data (CV, profile, applications)

Everything is inside `/jht_home` + `/jht_user` on the VPS, already mounted as bind mounts.
`jht backup` commands:

```bash
ssh root@<VPS_IP> 'jht backup create'   # create tarball in /jht_home/backups/
ssh root@<VPS_IP> 'jht backup list'     # list existing backups
ssh root@<VPS_IP> 'jht backup restore <id>'

# Download a backup to your Mac
scp -i <ssh-key> root@<VPS_IP>:/jht_home/backups/<file>.tar.gz ~/Downloads/
```

The CV PDFs are in `/jht_user/cv/`, also downloadable individually with `scp`.
A synced copy also lives on Supabase Storage (RLS active).

### 🔄 Changing AI provider (e.g. Kimi → Claude)

```bash
ssh root@<VPS_IP>
jht providers list             # see the supported providers
jht providers use claude       # change active_provider in jht.config.json
jht providers update claude    # install the new provider's CLI
docker exec -it jht claude     # interactive OAuth in the container
jht recreate                   # restart to reload config
```

After `jht providers use`, the 3 user-facing agents (assistant/captain/mentor)
will restart with the new provider on the next respawn (max 30s, or immediately
with `jht team stop --all && jht team start`).

### 🤖 Rotating the Telegram tokens

If a token is stolen or you want to change a bot:
1. Go to [@BotFather](https://t.me/BotFather) → select the bot → `/revoke`
2. Create the new token with `/newbot` or `/token` on an existing bot
3. Update `jht.config.json` on the VPS:
   ```bash
   ssh root@<VPS_IP> 'nano /jht_home/jht.config.json'
   # edit channels.telegram.bots.<role>.bot_token
   ```
4. Restart tg-bridge: `ssh root@<VPS_IP> 'jht recreate'`

### 🧹 Full reset / destroy

`jht reset` has 3 modes (increasing granularity):

| Mode | What it deletes | When to use it |
|---|---|---|
| `jht reset config` | jht.config.json (provider, bot, settings) | full setup change |
| `jht reset creds` | cloud.json + Supabase token + provider OAuth | re-pair with another account |
| `jht reset full` | everything: config + creds + agents + kimi sessions | clean slate, "fresh wizard" |

```bash
ssh root@<VPS_IP> 'jht reset full'   # interactive confirmation required
```

For a **total destroy** of the VPS:
1. `jht reset full` on the VPS (for hygiene, optional)
2. From the Hetzner portal → select the server → **Delete**
3. On the Mac: delete `~/Library/Application Support/jht-desktop/`
4. On Supabase: your `user_id` remains, but `user_onboarding_state` can be
   reset from the web `/settings` dashboard (TODO: feature not yet exposed)

### 📋 Reading the logs (debug)

| Layer | Command |
|---|---|
| Full container (pid1 + agents + daemon) | `ssh root@<VPS_IP> 'jht logs'` |
| Cloud push daemon only | `ssh root@<VPS_IP> 'docker exec jht tail -50 /jht_home/logs/cloud-daemon.log'` |
| tg-bridge only (Telegram inbound) | `ssh root@<VPS_IP> 'docker exec jht tail -50 /tmp/tg-bridge-assistente.log'` |
| Desktop app (Mac) | `~/Library/Application Support/jht-desktop/logs/jht-desktop-<ts>.log` |
| Kimi sessions (chat history) | `ssh root@<VPS_IP> 'docker exec jht ls /jht_home/.kimi/user-history/'` |

### 🌍 Migrating to another VPS / changing region

There's no one-shot command yet. Manual procedure:
1. `jht backup create` on the old VPS
2. `scp` the tarball to the Mac
3. Provision the new VPS (re-run the wizard, paste the new IP)
4. `scp` the tarball to the new VPS in `/jht_home/backups/`
5. `jht backup restore <id>` on the new VPS
6. Delete the old VPS from the Hetzner portal

## 📚 Further reading

- [`docs/sessions/2026-05-17-vps-path2-e2e/`](../sessions/2026-05-17-vps-path2-e2e/README.md)
  — session report of the end-to-end test with 27 fixes tracked
- [`docs/sessions/2026-05-17-budget-windows/`](../sessions/2026-05-17-budget-windows/README.md)
  — how the team manages the Kimi budget windows (with matplotlib charts)
- [`VPS-SETUP.md`](VPS-SETUP.md) — tech version (manual CLI via SSH)
- [`QUICKSTART.md`](QUICKSTART.md) — all-in-local installation

## 🐛 Known bugs (non-blocking, validated 2026-05-17)

| Bug | Impact | Workaround |
|---|---|---|
| Telegram voice messages not transcribed | Captain says "I can't process audio" | Write it out in words |
| Telegram photos/screenshots not interpreted | Captain says "I have no OCR" | Describe in words or link to `/positions` |
| Sentinel freezes team at 30% if proj > 100% (rare) | Pipeline stalled 30-60 min | Write "restart" to the Captain |
| Chat history not synced to web | Agent replies visible only on Telegram | Open Telegram directly |

## 📸 Screenshot TODO

This guide is user-facing but **has no screenshots yet**. Placeholders for
future contributions (PRs welcome):

| # | Expected screenshot | Target path |
|---|---|---|
| 1 | App splash + language selection + VPS location | `docs/guides/assets/vps-wizard-01-splash.png` |
| 2 | Supabase login button + Google OAuth popup | `docs/guides/assets/vps-wizard-02-supabase.png` |
| 3 | 3-Telegram-token form with verification status | `docs/guides/assets/vps-wizard-03-telegram.png` |
| 4 | Hetzner provisioning step (paste IP + SSH key to copy) | `docs/guides/assets/vps-wizard-04-hetzner.png` |
| 5 | Embedded terminal with `kimi --yolo` + device code | `docs/guides/assets/vps-wizard-05-oauth.png` |
| 6 | "Setup completed" screen → bypass home | `docs/guides/assets/vps-wizard-06-done.png` |
| 7 | `/team` dashboard with the team running | `docs/guides/assets/vps-dashboard-team.png` |
| 8 | `/team/sentinella` chart (Kimi UsageChart) | `docs/guides/assets/vps-dashboard-sentinella.png` |

When you add the images, replace the `> 📸 Missing screenshots` with
markdown embeds: `![Step 1](assets/vps-wizard-01-splash.png)`.
