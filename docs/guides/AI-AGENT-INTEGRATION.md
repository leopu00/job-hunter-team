# 🤖 AI agent integration

This guide is for a personal AI assistant driving the supported `jht` CLI on
the user's behalf. The native office is a separate guided path; start from the
[`QUICKSTART`](QUICKSTART.md) if the user wants the visual setup.

## Safety contract

An assistant may inspect the repository, explain commands and run read-only
checks without additional permission. It must stop and ask before it:

- installs a container runtime or changes system packages;
- creates, changes or deletes a paid VPS;
- starts or stops the team;
- excludes a position, requests a document or changes search policy;
- enables cloud sync or another external integration;
- runs a destructive recovery command.

Provider authentication belongs to the user. Never ask them to paste an OAuth
code, credential, account identifier or session token into chat. Never copy a
CV, application, raw database, configuration file, private machine address or
unredacted log into an issue or command transcript. JHT prepares documents; it
does not submit applications automatically.

## Before installing

Confirm all of the following with the user:

- target: this computer, a dedicated computer, or an existing VPS;
- operating system: Windows x64, Linux x64, or supported macOS;
- a Docker-compatible runtime, or permission to install one where the
  installer supports it;
- a dedicated supported provider subscription (see
  [`PROVIDERS.md`](../about/PROVIDERS.md));
- about 8 GB of RAM available before starting a local team for comfortable
  use. This is a measured recommendation, not a universal minimum.

Use [Choose where to run Job Hunter Team](CHOOSE-WHERE-TO-RUN.md) with the user
before selecting the target. In particular, the dedicated-PC SSH topology is
an advanced path, not a separate guided wizard.

For a new VPS, use the [manual VPS guide](VPS-SETUP.md) or let the user
provision it through the native office. This guide does not authorize an agent
to create billable infrastructure.

## Install the CLI

On macOS, Linux or Windows Subsystem for Linux, download and inspect the
installer before executing it:

```bash
curl -fsSL https://jobhunterteam.ai/install.sh -o install.sh
less install.sh
bash install.sh --dry-run
bash install.sh
```

On native Windows PowerShell:

```powershell
iwr -useb https://jobhunterteam.ai/install.ps1 -OutFile install.ps1
Get-Content .\install.ps1
.\install.ps1
```

Windows requires Docker Desktop to be installed, running and through its own
first-run consent. On macOS and Linux, the installer can prepare a supported
runtime after user confirmation.

The container path downloads the Compose file, host wrapper and, on
macOS/Linux, the host preflight helper. It creates `~/.jht/host.env` and may
register the wrapper directory on `PATH`. It does not install the native
office. See [`CLI-INSTALL.md`](CLI-INSTALL.md) for the exact file layout and
flags.

## Complete first setup

The installer starts the setup wizard when it has an interactive terminal. If
it did not, run:

```bash
jht setup
```

The assistant may narrate the choices, but the user operates subscription
login. When the wizard displays the provider-login step:

1. leave the wizard open;
2. open a second terminal on the same host;
3. run `jht oauth-login`;
4. let the user complete the provider's browser flow and exit the provider
   terminal interface.

The wizard detects the saved credentials and starts the team. On a VPS, the
wizard first requires cloud pairing; the user follows the displayed browser
flow. Telegram remains optional.

## Verification gate

Do not report setup complete until these checks succeed:

```bash
jht doctor
jht status
jht team status
jht sentinella status
```

`jht status` describes the container. `jht team status` describes the agent
processes. If cloud sync was enabled, also run `jht cloud status`.

## Machine-readable inspection

Prefer supported JSON output instead of scraping formatted tables:

```bash
jht positions list --json
jht positions show 42 --json
```

Not every command has a JSON mode. If a command does not advertise `--json`
in its help, show its output to the user instead of inventing a parser.

## User decisions remain user decisions

Explain the effect and ask before running commands such as:

```bash
jht positions exclude 42 --reason not_interested
jht positions restore 42
jht positions request-cv 42
jht team stop --all
```

Starting, stopping and inspecting the container use the host wrapper:

```bash
jht status
jht logs --tail 200
jht down
jht up
```

Never paste these logs directly into a public issue. Follow the redaction
rules in [`BETA.md`](BETA.md) and use the office diagnostics preview when it is
available.

## Recovery

- If the wrapper is missing from `PATH`, open a new login shell or follow the
  fallback printed by the installer.
- If setup was interrupted, run `jht setup` again and follow the current
  prompts.
- If provider authentication is missing, keep setup open and repeat
  `jht oauth-login` in a second terminal.
- If the container does not start, use `jht status`, then
  `jht logs --tail 200`.
- If installation files may be stale, download and inspect the installer
  again before rerunning it.

## Related

- [`QUICKSTART.md`](QUICKSTART.md) — all supported entry paths
- [`CLI-INSTALL.md`](CLI-INSTALL.md) — installer behavior and limitations
- [`CLI-REFERENCE.md`](CLI-REFERENCE.md) — command reference
- [`VPS-SETUP.md`](VPS-SETUP.md) — current manual VPS path
- [`SECURITY.md`](../../SECURITY.md) — private vulnerability reporting
