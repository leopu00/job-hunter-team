# VPS setup from the desktop app

This is the guided, non-terminal path for running Job Hunter Team on an
always-on Linux VPS from the desktop app. The terminal-first path is in
[`VPS-SETUP.md`](VPS-SETUP.md).

JHT does not create, bill or delete a VPS. Choose and provision the machine
with your infrastructure provider before you start.

## What you need

- A Linux VPS reachable over SSH with key authentication, and a normal user
  that is not `root`. The team runs in rootless Podman: the app refuses to
  install it as the administrator.
- Passwordless `sudo` for that user, so the installer can add what is missing:
  `podman`, `podman-compose`, `uidmap`, a subordinate ID range in
  `/etc/subuid` and `/etc/subgid`, and linger for the user. Without it, ask the
  server's administrator to prepare those before you start.
- An ed25519 SSH host key on the server: the app confirms the server's
  identity with its fingerprint.
- The SSH private key file on this computer, matching a public key installed
  on the VPS. It stays on this computer: the app only uses it to connect.
- A Google sign-in in the app. A new team on a VPS is paired with your
  account during the preparation; a local profile has no account to pair it
  with.
- A dedicated Codex (recommended), Claude or Kimi subscription. Kimi is not
  available in the Windows app yet.

## Guided path

1. Open the app and choose **Continue with Google**.
2. Select **Start the setup**, then **VPS server**. Enter the VPS address
   (hostname or IP address), the SSH user and the SSH port, and choose the
   private key file. While something is missing, **Continue** stays off and
   the screen says what.
3. Choose the provider, then select **Review the setup** and **Prepare the
   team**. Keep the app open while it works.
4. The app reads the server's SSH fingerprint. Compare it with the one your
   VPS provider shows: confirm only if it is the same, and cancel if it
   differs, because you may not be connected to your own server.
5. The app prepares the server: it runs the official installer with rootless
   Podman, starts the container and installs the provider's tool. When the
   server lacks something, the screen says what to ask its administrator,
   with **Retry the preparation**.
6. Sign in to the provider when the screen says it is your turn: follow the
   sign-in link, code or answer field it shows.
7. When provider, container and agents are verified, the app opens the chat
   with the Assistant. The team keeps running on the VPS after you close the
   app.

## A team or a profile that already exists

- **A team already running on a VPS.** With **VPS server** selected, the
  Environment step offers **Check VPS** under «Do you already have a team
  running on a VPS?». It connects this app to that team without reinstalling
  or restarting it, after the same fingerprint check. Host and key stay only
  on this computer.
- **A VPS that already runs the team with Docker**, for example from an
  earlier installation: the app does not move it to Podman. Nothing on the VPS
  is moved or deleted. Connect to the existing team instead, or choose
  another VPS.
- **A profile on a VPS, for a local team.** With a local profile and **This
  computer** selected, **Import profile** copies the confirmed profile from
  the VPS without linking Google. Keys, databases and settings stay where they
  are.

The desktop app does not move a team from one host to another.

## Troubleshooting

- **SSH does not connect:** check the address, the port, the SSH user and the
  key file, then the server firewall. `ssh -i <key> -p <port> <user>@<host>`
  should work from this computer.
- **The fingerprint does not match:** cancel and check with your VPS provider
  before connecting.
- **The server is missing Podman, sudo or linger:** the error screen names
  what is missing and what to ask the administrator. Press **Retry the
  preparation** once it is in place.
- **Something else fails:** the error screen gives the cause and its code.
  From a terminal, the CLI recovery path below reads the server directly.

The CLI path, and recovery from a terminal, are documented in
[`VPS-SETUP.md`](VPS-SETUP.md).
