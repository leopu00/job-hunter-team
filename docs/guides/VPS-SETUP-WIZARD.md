# VPS setup from the native office

This is the current non-terminal path for running Job Hunter Team on an
always-on VPS. The desktop application is the Godot office; the retired
Electron wizard is not involved.

## What you need

- A Linux VPS reachable as `root` over SSH.
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
4. Choose **Verify SSH**. The app verifies key authentication and root access
   before changing the server.
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

## Move an existing team to a new VPS

**Settings → Connect VPS → Complete migration** supports both sources:

- this computer (local container), or
- the VPS currently saved in the native app.

Enter the *destination* IP/key, select the source and confirm. The app:

1. verifies and provisions the destination;
2. stops the source so SQLite and session files form one coherent snapshot;
3. transfers `~/.jht` and `~/Documents/Job Hunter Team`, including database,
   profile, outputs, team configuration, provider login and cloud pairing;
4. excludes SSH private keys, runtime files and the source `host.env`;
5. creates a timestamped backup on the destination before extracting;
6. enforces VPS host mode and safe ownership/credential permissions;
7. starts the new container (and the team if it was active), archives the old
   source cloud token and connects the office to the destination.

If snapshot, upload or extraction fails, the old source is restarted. Nothing
is deleted automatically; the destination backup path is shown in the result.

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

- **SSH does not connect:** verify the IP, key path, server firewall and that
  `ssh -i <key> root@<ip>` works.
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
