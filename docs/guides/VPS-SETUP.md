# ☁️ VPS setup — JHT on Hetzner Cloud

Step-by-step guide to deploy Job Hunter Team on a Hetzner Cloud VPS
(Ubuntu 24.04 LTS). Validated end-to-end on **2026-05-06** on the
**CPX22** tier (€9.75/mo: 4 GB RAM / 2 vCPU AMD EPYC / 80 GB SSD, Helsinki).

> ⚠️ **Tech-only / manual mode.** This document describes the
> 🥉 "tier tech user" path: manual SSH + `curl install.sh | bash`. The
> 🥇 The non-technical path now lives in the native Godot office; follow
> [`VPS-SETUP-WIZARD.md`](VPS-SETUP-WIZARD.md).

> ℹ️ **There is no comparison between the execution modes yet.** An honest
> decision tree (local PC / dedicated PC / VPS) has never been written —
> earlier revisions of this page pointed at a `VPS-COMPARISON.md` that has
> never existed. It is tracked in [`BACKLOG.md`](../../BACKLOG.md) as
> `[JHT-VPS-COMPARISON-DOC]`. The only version that exists today is the
> three-line tree under "Verità scomoda" in
> [`../internal/ops/vps.md`](../internal/ops/vps.md).

## Design references

- `docs/internal/ops/vps.md` — consolidated VPS design (3-tier deployment, CLI host/container split, provider comparison, install UX, lifecycle)
- `docs/internal/architecture/bot-telegram.md` — multi-agent Telegram bot + document ingest

## TL;DR

```bash
# 1. Provision Hetzner CPX22 VPS with SSH key, Ubuntu 24.04.
ssh -i ~/.ssh/jht_key root@<VPS_IP>

# 2. On the VPS:
curl -fsSL https://jobhunterteam.ai/install.sh | bash      # 4 steps, ~1 min
exec bash -l                                                # picks up /etc/profile.d/jht.sh
jht up                                                      # pull image + start
jht setup --non-interactive --provider claude \
  --auth-method subscription --subscription-email tu@example.com --skip-health
jht providers update claude                                 # install provider CLI
docker exec -it jht claude                                  # OAuth device flow Anthropic → /login
jht cloud login                                             # browser pairing VPS↔web account (recommended)
jht team start                                              # start tmux Captain
jht team status                                             # verify
```

See the results on the cloud dashboard:

```
Browser on your PC → https://jobhunterteam.ai/positions
   (you're already logged in after `jht cloud login` — the data appears
    after the team finds the first jobs + auto-push)
```

## Step-by-step

### 1. Provision the VPS

On [console.hetzner.com](https://console.hetzner.com):

- **Project**: `jht` (create new, avoid Default)
- **Type**: Shared vCPU → **Regular Performance** → x86 (AMD) → **CPX22**
  - 4 GB RAM, 2 vCPU AMD EPYC, 80 GB SSD, €9.75/mo
- **Location**: Falkenstein or Helsinki (EU GDPR)
- **Image**: Ubuntu 24.04
- **SSH Keys**: upload a dedicated JHT key (do not reuse your personal one).
  If you don't have one:
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/jht_hetzner -C "jht-vps"
  cat ~/.ssh/jht_hetzner.pub  # copy into Hetzner
  ```
- **Volumes / Firewalls / Backups**: skip for the first test
- **Cloud config**: **leave empty** (NO custom user-data)
- **Name**: `jht-test` (or whatever you want)
- Click **Create & Buy now**

Hetzner shows you the IPv4 address. Note it down.

### 2. SSH into the VPS

From PowerShell or Git-Bash on your PC:

```bash
ssh -i ~/.ssh/jht_hetzner root@<VPS_IP>
# enter key passphrase
```

Verify the host fingerprint (anti-MITM):

```bash
# From your PC BEFORE the first SSH:
ssh-keyscan -t ed25519 <VPS_IP> | ssh-keygen -lf -
```

Compare the `SHA256:...` with the one shown in the Hetzner console (server details → "Host key fingerprints").

### 3. (Optional but recommended) Add swap

Hetzner does not configure swap by default. With 8 JHT agents, RAM spikes
can trigger an OOM kill. **2 GB of preventive swap** saves the day:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h    # verify: Swap: 2.0Gi
```

### 4. Install JHT (one-liner)

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

The Docker-mode flow runs 4 steps:

1. **System detection** (Ubuntu 24.04 / apt)
2. **Container runtime** — `apt install docker.io docker-compose-v2`
3. **Docker verification** (`docker info`)
4. **Download wrapper + compose** — downloads:
   - `~/.jht/runtime/docker-compose.yml`
   - `~/.local/bin/jht` (~165 LOC bash dispatcher)

Final output:
```
══════════════════════════════════════════
  Installation complete!
══════════════════════════════════════════
  Container mode active.
  Next steps:
      jht up
      jht setup
```

> 💡 **No Node, Python, or tmux on the VPS host.** Just `docker` +
> `bash` + the wrapper. Everything else lives inside the `jht` container.
>
> If `jht` is not in the PATH, the full path is `~/.local/bin/jht`.
> Add it to `.bashrc`:
> ```bash
> echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.bashrc
> source ~/.bashrc
> ```

### 5. `jht up` — pull image + start container

```bash
jht up
```

Output: `docker compose up -d` pulls the `ghcr.io/leopu00/jht:latest` image
(~750 MB, ~30s on the Hetzner mirror) and starts the long-running `jht`
container with `restart: unless-stopped`. The wrapper automatically runs
`chown -R 1001:1001 ~/.jht ~/Documents/Job\ Hunter\ Team/` to align the
bind-mounts to the container uid (`jht` user = 1001).

Verify:

```bash
jht status            # name=/jht status=running
docker ps             # jht ... (no published ports)
free -h               # memory in use after boot
jht logs --tail 10    # "mode: VPS" + watchdog/bridge lines
```

### 6. `jht setup` — provider config

> ⚠️ **On the VPS always use `--non-interactive`.** The interactive
> wizard (clack/prompts) has a known TTY bug via `docker exec -it`: the ↑↓
> arrows arrive as literal text `^[[A` instead of being intercepted.
> Tracked as [BUG-CLACK-TTY-DOCKER-EXEC] in the BACKLOG. Workaround:
> all the CLI flags exist, no need for the wizard.

For Claude Max (subscription):

```bash
jht setup --non-interactive \
  --provider claude \
  --auth-method subscription \
  --subscription-email tu@example.com \
  --skip-health
```

For Codex Plus/Pro:

```bash
jht setup --non-interactive \
  --provider openai \
  --auth-method subscription \
  --subscription-email tu@example.com \
  --skip-health
```

For Kimi:

```bash
jht setup --non-interactive \
  --provider kimi \
  --auth-method subscription \
  --subscription-email tu@example.com \
  --skip-health
```

For API key (the "metered" pay-per-use alternative, not recommended — see
ADR-0004):

```bash
jht setup --non-interactive \
  --provider claude \
  --auth-method api_key \
  --api-key sk-ant-api03-... \
  --skip-health
```

The config is saved to `~/.jht/jht.config.json`. Verify:

```bash
cat ~/.jht/jht.config.json
jht doctor   # should show "Provider: claude"
```

### 7. `jht providers update` — install the provider CLI in the container

```bash
jht providers update claude   # or: codex, kimi
```

What it does: inside the container, it runs `npm install -g @anthropic-ai/claude-code@latest`
in `/jht_home/.npm-global/` (bind-mounted). Persistent cross-restart.

> For Codex: same command, installs `@openai/codex@latest`.
>
> For Kimi: uses `uv tool install kimi-cli` (via `pip3 install --user --break-system-packages uv` as bootstrap).

Verify:

```bash
jht providers   # shows "claude [ACTIVE] — model: claude-sonnet-4-6"
                # CLI: 2.1.x   ← installed version
```

### 8. Provider OAuth login — device flow

```bash
docker exec -it jht claude
```

Claude Code starts. On the first run it begins the OAuth device flow and
shows a URL + code like:

```
Open this URL in the browser:
https://claude.ai/oauth/device?code=ABCD-EFGH
```

**Open the URL in the browser on YOUR PC** (not on the VPS, which has no
GUI browser), sign in with your Claude Max account, confirm the code.
Claude Code confirms "authenticated".

If it doesn't start automatically, type `/login` inside the Claude prompt.

Exit with `/quit` or `Ctrl+C` twice.

> 💡 The OAuth login writes to `~/.claude/` inside the container, which is
> bind-mounted to `~/.jht/.claude/` on the VPS host. The login persists
> cross-restart and cross-rebuild.

### 9. `jht cloud login` — link the VPS to the web account

> 💡 Without this step, the jobs found by the team stay ONLY on the VPS.
> To see them on the `jobhunterteam.ai/positions` dashboard (or for
> backup), you need to enable cloud sync. The pairing only needs to be
> done **once**: the token stays saved in `~/.jht/cloud.json`.

```bash
jht cloud login
```

The CLI shows:

```
Open this URL in the browser:
  https://jobhunterteam.ai/cli-link

Code to enter:
  ABCD-1234

Waiting for your confirmation… (TTL ~10 min, polling every 2s)
```

**On your PC** open the URL in the browser. If you're not logged in, log in
with Google or GitHub. Type the code shown by the CLI (e.g. `ABCD-1234`),
confirm. The CLI on the VPS unblocks automatically:

```
✓ Pairing complete
  Base URL:   https://jobhunterteam.ai
  Token name: cli-2026-05-08
  User ID:    <uuid>

Syncing local data to the cloud...
✓ Push complete
  positions:    0 upserted   ← the team hasn't searched yet
  scores:       0 upserted
  applications: 0 upserted
```

> 🔐 **Privacy**: the token lives only inside the VPS (`~/.jht/cloud.json`,
> mode 0600). It is NEVER exposed in cleartext outside the CLI →
> server (HTTPS). You can revoke it from [`/settings/cloud-sync`](https://jobhunterteam.ai/settings/cloud-sync).

> 🛠 **Advanced options:**
> - `jht cloud login --name vps-marco` — suggests a name for the token (visible on the web)
> - `jht cloud login --no-push` — skip the initial push (CI/scripts)
> - `jht cloud enable --token jht_sync_xxx` — alternative with manual paste of the token

> 🌍 **Self-hosting cloud** (for those who want to run the dashboard on
> their own domain): `jht cloud login --url https://my-domain.com`. The
> dashboard must be deployed with the 3 API routes
> (`/api/cloud-sync/{device-init,device-poll,device-confirm}`) +
> migration `008_cloud_sync_pairing.sql` applied.

### 10. `jht team start` — start the agents

```bash
jht team start
```

Output:
```
Starting agents in the jht container...
  Mode: default
  ✓ CAPTAIN started
Result: 1 started, 0 already active
  The Captain will scale the other agents according to its thresholds.
```

The **Captain** starts on its own. **Bridge / Sentinel** monitor it and
scale up `Scout`, `Analyst`, `Scorer`, `Writer`, `Critic` when
needed, according to the subscription provider's token budget.

Verify:

```bash
jht team status        # 1+ agents "jht container"
jht sentinella tail    # follow live monitoring
```

### 11. Cloud dashboard — `https://jobhunterteam.ai/positions`

After `jht cloud login` (step 9) the team's data is pushed to the cloud
dashboard. On **your PC**:

```
Browser → https://jobhunterteam.ai
   (you're already logged in from the pairing)
   ↓
   /positions  → table of jobs found for you (stack, score, status filters)
   /team       → agent org chart + chat for each one
   /sentinella → real-time token usage charts
   /settings/cloud-sync → manage/revoke the tokens
```

**When to refresh the cloud data**: `jht cloud login` does an auto-push
once (at pairing). For subsequent pushes:

```bash
jht cloud push                       # one-shot manual
jht cron add cloud-push '*/15 * * * *'   # every 15min (auto-sync)
```

> 💡 The cloud dashboard is the recommended way. The push is **local→cloud
> only**: your logs/agent state stay on the VPS, only positions/scores/
> applications are synchronized.

### 12. (Retired) Web UI on the VPS via SSH tunnel

> 🪦 **Retired 2026-07-23.** The container no longer serves a web UI on
> `127.0.0.1:3000` — the local/VPS interaction surface is the **desktop
> app** (it talks to the VPS over SSH directly). For a browser view use
> the cloud dashboard (`jobhunterteam.ai`, requires login). The SSH
> tunnel remains useful only for generic debugging, not for a web UI.

## Lifecycle and shutdown

Hetzner has a **billing trap**: "powered off" servers keep billing. To
stop the bill you need `delete server` or snapshot+delete.

| Command                       | What it does                          | Cost                           | Resume                |
|-------------------------------|---------------------------------------|--------------------------------|-----------------------|
| `jht team stop --all`         | Stops agents, container stays up      | €9.75/mo (VPS allocated)       | 1s, `team start`     |
| `jht down`                    | Stop + remove container, VPS up       | €9.75/mo                       | 5s, `jht up`          |
| Hetzner snapshot + delete     | Backup snapshot, destroy VPS          | ~€0.10/mo (storage only)       | 90s, recreate VPS     |
| Hetzner delete server         | Total destruction, data lost          | €0                             | from-scratch          |

> ⚠️ **Powering off via Hetzner ("power off") does NOT stop the bill.**
> The resources stay allocated. For real pauses → snapshot + delete.

## Update

Image:

```bash
jht upgrade   # docker compose pull + up -d
```

Wrapper + compose (in case of a new version):

```bash
curl -fsSL https://raw.githubusercontent.com/leopu00/job-hunter-team/master/scripts/jht-wrapper.sh -o ~/.local/bin/jht
chmod +x ~/.local/bin/jht
curl -fsSL https://raw.githubusercontent.com/leopu00/job-hunter-team/master/docker-compose.yml -o ~/.jht/runtime/docker-compose.yml
```

## Advanced overrides

All via env var:

| Var                 | Default                                          | Use                                            |
|---------------------|--------------------------------------------------|------------------------------------------------|
| `JHT_IMAGE`         | `ghcr.io/leopu00/jht:latest`                     | Test image branches (`:dev-1`, `:v1.0.0`, …)   |
| `JHT_RUNTIME_DIR`   | `~/.jht/runtime`                                 | Compose path                                   |
| `JHT_COMPOSE_FILE`  | `$JHT_RUNTIME_DIR/docker-compose.yml`            | Override a specific compose                    |
| `JHT_CONTAINER_NAME`| `jht`                                            | Multi-instance (not recommended)               |
| `JHT_BIND_OWNER`    | `1001:1001`                                      | Override bind dir uid/gid (Linux only)         |
| `JHT_NODE_ENTRY`    | `/app/cli/bin/jht.js`                            | Internal Node CLI path                         |

Example: test the `dev-1` image instead of `latest`:

```bash
export JHT_IMAGE=ghcr.io/leopu00/jht:dev-1
jht upgrade
```

## Troubleshooting / gotcha

### `docker compose: unknown shorthand flag: 'f'`

On Ubuntu 24.04, `apt install docker.io` does NOT install the `docker
compose` v2 plugin by default. `install.sh` automatically updates it
with `apt install docker-compose-v2`. If for some reason it's missing:

```bash
apt install -y docker-compose-v2
docker compose version
```

### `EACCES: permission denied, open '/jht_home/jht.config.json'`

Bind dir owned by root (uid 0) but the container runs as uid 1001. The
wrapper runs an auto-`chown` on `up`/`upgrade`, but if you manually
modified the paths:

```bash
chown -R 1001:1001 ~/.jht ~/Documents/Job\ Hunter\ Team
```

### Wizard `jht setup` (interactive) doesn't receive arrows, shows `^[[A`

TTY clack bug via `docker exec -it`. Workaround: use
`--non-interactive` with all the flags.

### `jht providers update` error "docker-compose.yml not found"

Command launched outside the container. On the VPS it runs **inside** the
container (automatic path via env IS_CONTAINER=1, set by the compose).
If it still fails, verify:

```bash
docker exec jht env | grep IS_CONTAINER   # should show =1
```

### Hydration error JSON-LD nonce in the landing

Pre-existing bug `[BUG-CSP-JSONLD-LANDING]` (server-rendered nonce ≠
client). Cosmetic, doesn't block login. See BACKLOG.

### Web UI auth doesn't work via SSH tunnel `localhost:3000`

🪦 Obsolete (2026-07-23): the container no longer serves a web UI, so
this can't happen anymore. Interaction = desktop app; browser = cloud
dashboard (`jobhunterteam.ai`).

### SSH `Permission denied (publickey,password)` with a key that should match

Local fingerprint = Hetzner fingerprint but OpenSSH refuses. Check
whether the private key is encrypted with a passphrase:

```bash
ssh-keygen -y -f ~/.ssh/<your-key>
# If it asks for a passphrase → the key is encrypted
```

In `BatchMode=yes` (script + automation) OpenSSH cannot decrypt it →
generates an invalid signature → server rejects. Solutions:

- Add the key to `ssh-agent`: `eval $(ssh-agent) && ssh-add ~/.ssh/<key>`
- Or generate an ephemeral key without a passphrase for automation:
  ```bash
  ssh-keygen -t ed25519 -N "" -f ~/.ssh/jht_ephemeral
  hcloud ssh-key create --name jht-ephemeral --public-key-from-file ~/.ssh/jht_ephemeral.pub
  ```

### Hetzner creates the VPS but the SSH key turns out not to be injected

Symptom: `hcloud server create --ssh-key <name>` returns OK but SSH asks
for a password (and in the create output you see `Root password: ...`).
Typical cause: the API token has limited permissions even though the UI
shows the "Read+Write" badges.

```bash
# Check the scope of the current token:
hcloud ssh-key list   # if empty/wrong, the token has no SSH scope
```

Generate a new token with explicit full Read+Write scope from
`console.hetzner.com/projects/<id>/security/tokens`. Cloud-init
`user_data` as a fallback is **not reliable** for key injection
on Hetzner Ubuntu 24.04 — rely only on `--ssh-key` / `ssh_keys` array.

## Monthly costs

| Item                              | €/mo  |
|-----------------------------------|-------|
| Hetzner CPX22 (4 GB / 2 vCPU)     | 9.75  |
| (opt) Snapshot backup ~10 GB      | 0.12  |
| AI provider (Claude Max x20)      | ~200  |
| **Total VPS infra**               | **~10**|
| **Total with subscription**       | **~210**|

The VPS infra costs ~5% of the budget. The subscription provider is the
main driver.

## Validation history

[JHT-VPS-VALIDATE] closed on 2026-05-06 with the first end-to-end bring-up.
Bugs found during the bring-up and committed on `dev-1`:

| Commit       | Fix                                                                                  |
|--------------|--------------------------------------------------------------------------------------|
| `3f7cfb71`   | Wrapper bash + container-proxy passthrough IS_CONTAINER                              |
| `fee1d685`   | install.sh redesigned (download instead of generating wrapper inline) + compose split |
| `c7e29cb6`   | Docs updated for host/container split                                                |
| `121c6ea3`   | Research VPS providers 2026                                                          |
| `11900977`   | install.sh adds `docker-compose-v2`                                                  |
| `86c08174`   | `setup --non-interactive --subscription-email`                                       |
| `4b10a9db`   | `JHT_IMAGE` override env var in the compose                                          |
| `f5df9545`   | Tracks `[BUG-CLACK-TTY-DOCKER-EXEC]`                                                 |
| `cb5b9bab`   | `providers update` IS_CONTAINER + `ensure_bind_owner` chown 1001                     |

For the dev-1 → master merge once the fixes are validated on a real VPS,
and the subsequent `latest` publish on GHCR.
