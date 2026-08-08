# VPS setup from the native office

This is the current non-terminal path for running Job Hunter Team on an
always-on VPS. The desktop application is the Godot office; the retired
Electron wizard is not involved.

## What you need

- A Linux host reachable over SSH as `root`, with passwordless `sudo`, or with
  an account already allowed to run Docker. Automated migration involving a
  remote host still requires the root-owned path layout described below.
- SSH available on the standard port 22. The native host field currently
  accepts a hostname or IPv4 address, not a custom port or IPv6 address.
- The SSH private key matching a public key installed on the VPS.
- A dedicated Claude, Codex or Kimi subscription.
- Optionally, three Telegram bots and a dedicated job-alert mailbox.

The native app can generate a dedicated Ed25519 key under
`~/.jht/ssh/id_ed25519`. The **Copy public key** button copies only the `.pub`
line expected by Hetzner; **Open folder** reveals both files and the UI shows
the fingerprint. The private file never needs to leave the computer and is
explicitly excluded from migrations.

## Guided path

1. Open the application. It always opens directly into the office.
2. Click **Attiva team**, then talk to the **Coordinator** and choose
   **The team will run on a VPS**. The same settings are available directly
   under **Settings → Connect VPS**.
3. Generate or select the SSH key, copy the public key into the provider's
   server-creation form and enter the new server IP.
4. Choose **Verify SSH**. The app verifies key authentication and either root,
   passwordless `sudo`, or working Docker access before changing the server.
5. Choose **Prepare and connect automatically**. It installs the host runtime,
   writes VPS host mode, pulls and starts the container, saves the connection
   and switches the office to the remote backend. **Advanced console** keeps a
   visible recovery path for troubleshooting.
6. In the Coordinator conversation, choose Claude, Codex or Kimi and open
   subscription login. The provider CLI runs in the embedded console. A
   browser may open only for provider authorization; codes and prompts remain
   visible in the app.
7. Complete **Profile**. This is a native form and does not require an LLM.
   The scripted Assistant can prefill role, experience and geographic scope.
8. Optionally configure **Telegram**, **Email** and **Account**. Telegram
   verifies each token and detects the chat after you press Start in the bot.
9. Return to **Attiva team** and start the team. Agents appear in the office as
   their real remote sessions come online.

## Move an existing team

**Settings → Connect VPS → Complete migration** supports these host changes
when every remote source or destination uses the current root-owned layout:

- this computer → a new VPS;
- the currently saved VPS → a new VPS; or
- the currently saved VPS → this computer.

A fresh prepare/connect flow supports non-root accounts with passwordless
`sudo` or Docker access, but the automated migration scripts still use paths
under `/root`. Migration to or from a non-root remote account is therefore not
implemented. A successful **Verify SSH** result does not remove this limit.

For a VPS destination, enter its IP/key, select the source and confirm. For a
local destination, use **Migrate from VPS to this computer**. The app:

1. verifies and provisions the destination;
2. stops the source so SQLite and session files form one coherent snapshot;
3. transfers `~/.jht` and `~/Documents/Job Hunter Team`, including database,
   profile, outputs, team configuration, provider login and cloud pairing;
4. excludes SSH private keys, runtime files and the source `host.env`;
5. verifies the archive checksum after every network transfer;
6. extracts into a staging directory and validates the payload before touching
   the destination;
7. creates and verifies a timestamped backup on the destination;
8. atomically replaces the destination state instead of merging stale files;
9. enforces the destination host mode, checks SQLite integrity and starts the
   container (and the team if it was active);
10. archives and verifies the old source cloud token, then connects the office
    to the destination.

If snapshot, checksum, backup, extraction, database validation, team startup or
cloud handoff fails, both source and destination are rolled back. Nothing is
deleted automatically; the destination backup path is shown in the result.

SSH host keys are pinned in an app-owned known-hosts file before login. A key
change is rejected instead of being accepted silently. **Verify SSH** shows the
fingerprint to compare with the server provider.

This single-source handoff is important: do not restart the old team after a
successful migration unless you are intentionally rolling back.

## Google account and local-only mode

Under **Settings → Account**, **Sign in with Google** starts the cloud device
flow inside the embedded console. The browser is used only to authenticate and
approve the displayed code. Google passwords/cookies never enter the game;
the team stores a revocable `jht_sync_…` device token in `~/.jht/cloud.json`
with restricted permissions.

Pairing automatically performs the initial push when a database exists. The
same page exposes status, one-shot sync, profile recovery and pipeline disaster
recovery (positions, scores and applications). **Stop sync and continue locally** revokes the current device token
on the server and removes it from the running computer/VPS. Local database,
profile and generated files are retained and the team continues to work.

## First-run conversations

Assistant, Coordinator and Mentor have persistent scripted conversations that
work before a provider is connected. They never consume tokens. Once the
provider and the relevant agent are online, the same panel keeps suggested
replies and enables free text to the real agent.

See [`game/docs/FIRST-RUN.md`](../../game/docs/FIRST-RUN.md) for the state and
security contract.

## Troubleshooting

- **SSH does not connect:** verify the hostname or IPv4 address, SSH user, key
  path, port 22 and server firewall, then confirm that
  `ssh -i <key> <user>@<host>` works.
- **Install console fails:** keep the console open and use its Copy button;
  then run **Advanced → Diagnostics**.
- **Provider stays disconnected:** finish the browser authorization, return to
  the embedded console and wait for the provider CLI to exit. Use **Recheck**.
- **Profile gate stays yellow:** all eight fields are required: name, email,
  target role, location, experience, seniority, at least two skills and one
  language.
- **Telegram chat is not detected:** open the bot link, press Start, then retry
  **Save and detect chat**.

The CLI recovery path remains documented in [`VPS-SETUP.md`](VPS-SETUP.md).
