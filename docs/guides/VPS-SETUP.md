# ☁️ Manual VPS setup

This is the current terminal-first path for an existing Linux VPS. For the
guided path, use the native office and
[`VPS-SETUP-WIZARD.md`](VPS-SETUP-WIZARD.md).

JHT does not create, bill or delete a VPS in this flow. Choose and provision
the machine with your infrastructure provider before continuing.

## Requirements

- an x64 Linux VPS with at least 4 GB of RAM;
- root access, or an account allowed to install and run Docker;
- SSH key authentication from your computer;
- outbound HTTPS access;
- a dedicated supported provider subscription.

Use a dedicated SSH key for the server. Examples below use `192.0.2.10`, an
address reserved for documentation; replace it locally and never put the real
address in an issue, commit or shared log.

## 1. Connect and verify the host

Compare the server fingerprint with the value shown by your infrastructure
provider before accepting it, then connect with a terminal allocated:

```bash
ssh -t -i ~/.ssh/jht_vps root@192.0.2.10
```

Confirm the architecture and available memory:

```bash
uname -m
free -h
```

Continue only with `x86_64` and sufficient memory. On a VPS with less than
8 GB of RAM and less than 1 GB of active swap, the non-interactive host
preflight creates a 2 GB `/swapfile`. Treat that as an installer side effect:
inspect the helper and authorize it before running the installer, or configure
at least 1 GB of swap yourself first so the helper skips the change.

## 2. Inspect and run the installer

On the VPS:

```bash
curl -fsSL https://jobhunterteam.ai/install.sh -o install.sh
less install.sh
bash install.sh --dry-run
bash install.sh
```

The Docker path:

1. detects the Linux distribution and container runtime;
2. installs or reuses Docker and Docker Compose;
3. verifies the daemon;
4. downloads the Compose file, host wrapper and host preflight helper;
5. writes `~/.jht/host.env`, prepares the bind-mounted directories and may
   register the wrapper directory on `PATH`.

Node, Python, tmux and provider command-line interfaces run inside the
container, not on the VPS host.

The installer launches `jht setup` when the SSH terminal is interactive. If
it cannot, open a new login shell and run it manually:

```bash
exec bash -l
jht setup
```

## 3. Complete browser flows from your computer

The VPS setup wizard first offers optional cloud pairing, then provider choice
and subscription login. Skipping or failing cloud pairing does not block the
team runtime. Follow only the URLs and instructions printed by the current
CLI; do not copy codes or credentials into chat or public logs.

When setup reaches provider login, leave it open and connect with a second
terminal from your computer:

```bash
ssh -t -i ~/.ssh/jht_vps root@192.0.2.10
jht oauth-login
```

Complete the provider's browser authorization, then exit its terminal
interface. The first wizard detects the credentials and starts the team.
Telegram is optional and can be configured later.

## 4. Verify before disconnecting

```bash
jht doctor
jht status
jht team status
jht sentinella status
jht cloud status      # optional: verify cloud sync only if you enabled it
```

- `jht doctor` must not report a blocking dependency or authentication error.
- `jht status` must show the container running.
- `jht team status` must show the configured agents.
- `jht cloud status` should confirm the VPS pairing only when optional cloud
  sync was enabled.

The container uses `restart: unless-stopped`, so it returns after a normal host
reboot. Generated files remain under `~/Documents/Job Hunter Team/`; runtime,
configuration and credentials remain under `~/.jht/`.

## Lifecycle and updates

```bash
jht team stop --all   # stop agents, keep the container
jht team start        # start the configured team
jht down              # remove the container, preserve mounted data
jht up                # recreate/start it from the installed Compose file
jht upgrade           # pull the current image and recreate as needed
```

`jht upgrade` updates the container image, not the host wrapper or Compose
file. To refresh installer-managed host files, download and inspect the public
installer again, then rerun it.

Powering off or removing a VPS is controlled by its provider, not JHT. Confirm
data retention and billing behavior with that provider before taking either
action.

## Troubleshooting

### `jht` is not found

Open a new login shell. If it is still missing, use the full wrapper path
printed by the installer and apply its `PATH` fallback; the location depends
on whether installation ran as root.

### Docker does not respond

```bash
docker info
```

Start the host's Docker service using the operating-system instructions, then
retry `jht up`. JHT does not expose the Docker socket inside its container.

### The host was detected as local

Run the installed preflight with an explicit documentation-safe mode, then
recreate the container so Compose receives it:

```bash
~/.jht/runtime/host-setup.sh --host-type=vps
jht recreate
```

### Provider login is not detected

Keep `jht setup` open. In a second SSH terminal, rerun `jht oauth-login`,
finish the browser flow and exit the provider interface normally.

### The team does not start

```bash
jht doctor
jht status
jht logs --tail 200
```

Redact names, email addresses, CV/application content, machine addresses,
hostnames, account identifiers and credentials before sharing any excerpt.

## Native-office migration

The office can move a local or remote team through
**Settings → Connect VPS → Complete migration**. It stops the source, verifies
the archive and database, excludes SSH keys and runtime files, stages the
destination and keeps a verified backup. Do not run both copies after a
successful migration.

The current automated remote migration scripts use root-owned paths under
`/root`. Fresh setup supports root, passwordless `sudo`, or an account allowed
to run Docker, but automated migration to or from a non-root remote account is
not implemented. The full current contract is in
[`VPS-SETUP-WIZARD.md`](VPS-SETUP-WIZARD.md).

## Related

- [`QUICKSTART.md`](QUICKSTART.md) — choose native office or CLI
- [`AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) — safe automation
- [`CLI-INSTALL.md`](CLI-INSTALL.md) — exact installer behavior
- [`CLI-REFERENCE.md`](CLI-REFERENCE.md) — lifecycle and operational commands
