# VPS setup from the native office

This is the current non-terminal path for running Job Hunter Team on an
always-on VPS. The desktop application is the Godot office; the retired
Electron wizard is not involved.

## What you need

- A Linux VPS reachable as `root` over SSH.
- The SSH private key matching a public key installed on the VPS.
- A dedicated Claude, Codex or Kimi subscription.
- Optionally, three Telegram bots and a dedicated job-alert mailbox.

The native app can generate an Ed25519 key under `~/.jht/ssh/id_ed25519`.
Add its `.pub` content to the server when creating the VPS.

## Guided path

1. Open the application. It always opens directly into the office.
2. Click **Attiva team**, then talk to the **Coordinator** and choose
   **The team will run on a VPS**. The same settings are available directly
   under **Settings → Connect VPS**.
3. Generate or select the SSH key, enter the server IP, then choose
   **Install JHT on VPS**. Installation output stays in the embedded console.
4. Connect to the VPS from the same page. The status turns green when the
   native backend can read the remote runtime.
5. In the Coordinator conversation, choose Claude, Codex or Kimi and open
   subscription login. The provider CLI runs in the embedded console. A
   browser may open only for provider authorization; codes and prompts remain
   visible in the app.
6. Complete **Profile**. This is a native form and does not require an LLM.
   The scripted Assistant can prefill role, experience and geographic scope.
7. Optionally configure **Telegram**, **Email** and **Account**. Telegram
   verifies each token and detects the chat after you press Start in the bot.
8. Return to **Attiva team** and start the team. Agents appear in the office as
   their real remote sessions come online.

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
