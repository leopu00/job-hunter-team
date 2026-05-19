// Lazy install of the AI provider CLIs into the container.
//
// The base image intentionally does NOT ship any CLI to keep it small
// and respect the user's provider choice. When the setup wizard reaches
// the provider step, the selected CLIs are installed via
// `docker compose run --rm jht npm install -g <pkg>` (or a provider-specific
// command). Installs land in /jht_home/.npm-global (see Dockerfile
// NPM_CONFIG_PREFIX) which is bind-mounted to ~/.jht on the host, so they
// persist across container recreation.

const { spawn } = require('node:child_process')
const os = require('node:os')

// Provider registry: id → { displayName, binary, install command spec }.
// Each install step is { entrypoint, args, env? } — fed to
// `docker compose run --rm --no-deps --entrypoint <e> -e K=V ... <svc> <args>`.
// We always override the Dockerfile ENTRYPOINT because it points at the JHT
// CLI dispatcher, which would otherwise treat "npm" as an unknown subcommand.
// Package identifiers are best-effort; adjust as the CLI ecosystem moves.
const NPM_PREFIX_ENV = { NPM_CONFIG_PREFIX: '/jht_home/.npm-global' }

const PROVIDERS = {
  claude: {
    displayName: 'Claude Code',
    binary: 'claude',
    // Args appended to the binary when we open the "Login" terminal
    // from the wizard. Skipping the trust-dir dialog on first launch
    // saves the approval into the CLI's config, so the background
    // agent-boot later never has to deal with it.
    loginArgs: ['--dangerously-skip-permissions'],
    install: [{
      entrypoint: 'npm',
      args: ['install', '-g', '@anthropic-ai/claude-code@latest'],
      env: NPM_PREFIX_ENV,
    }],
    loginHint: 'claude login',
  },
  codex: {
    displayName: 'Codex',
    binary: 'codex',
    // Codex 0.131+ ha separato il login dal REPL interattivo: il login
    // OAuth è un subcomando esplicito (`codex login`). `--yolo` era il
    // flag corretto per il REPL di Codex 0.6 (legacy) — su 0.131 lancia
    // il REPL che richiede di essere già loggati → schermo nero in
    // attesa di input.
    //
    // `--device-auth` usa il device-code flow (analogo a `gh auth login`
    // headless): codex stampa un URL + codice, l'utente lo incolla sul
    // browser e autorizza. Funziona identico in VPS mode (dove il
    // localhost del container non è raggiungibile dal browser host) e
    // in local mode (uniformità UX + nessun port mapping su container
    // locale).
    //
    // Nota: dopo il login, il REPL background degli agenti continua a
    // usare `codex --yolo` per skip approval prompt (vedi
    // .launcher/spawn-doctor.sh) — quel flag rimane corretto per il
    // REPL, è solo il wizard di login che richiede `codex login`.
    loginArgs: ['login', '--device-auth'],
    install: [{
      entrypoint: 'npm',
      args: ['install', '-g', '@openai/codex@latest'],
      env: NPM_PREFIX_ENV,
    }],
    loginHint: 'codex login',
  },
  kimi: {
    displayName: 'Kimi',
    binary: 'kimi',
    // --yolo at login time: the TUI writes its trust-approval for
    // the working dir into ~/.kimi so later launches skip it, and
    // the OAuth /login flow still runs normally.
    loginArgs: ['--yolo'],
    // Moonshot's official CLI is kimi-cli (github.com/MoonshotAI/kimi-cli) —
    // a Python uv tool, not an npm package. This is the real "Kimi Code"
    // TUI that supports /login OAuth (the subscription flow users pay
    // for on Moderato/Allegretto), not the @jacksontian API-key wrapper
    // we shipped originally. Kimi-cli requires Python 3.13; uv fetches
    // it automatically so the container (Debian bookworm 3.11) is fine.
    install: [
      // Remove the old @jacksontian/kimi-cli npm package if present
      // from a previous install. The sh -c swallows failures so a
      // fresh install that never had it doesn't error out.
      {
        entrypoint: 'sh',
        args: ['-c', 'npm uninstall -g @jacksontian/kimi-cli 2>/dev/null || true'],
        env: NPM_PREFIX_ENV,
      },
      // Install uv + kimi-cli in un unico step atomico.
      //
      // Perche' merged e non due step separati: ogni step del provider
      // install gira in un NUOVO container via `docker compose run --rm`.
      // Se "pip3 install --user uv" (step N) e "uv tool install" (step N+1)
      // sono separati, eventuali differenze di HOME/PATH tra le due
      // invocazioni, o un silent-fail di pip, producono "sh: uv: not found"
      // senza spiegazione. Incidente 2026-04-22: exit 127 opaco durante
      // install Kimi dalla JHT Desktop. Fonderlo qui rende l'env coerente
      // (stesso container, stesso HOME) e aggiunge diagnostica esplicita.
      //
      // uv tool install defaults to ~/.local/bin; il Dockerfile hardcoda
      // /home/jht/.local/bin in PATH, ma HOME runtime e' /jht_home, quindi
      // UV_TOOL_BIN_DIR punta i symlink in /jht_home/.npm-global/bin che
      // sta gia' su PATH (bind-mount persistente come gli npm global).
      // --break-system-packages bypassa la protezione PEP 668 di Debian.
      {
        entrypoint: 'sh',
        args: ['-c', [
          'set -e',
          'echo "[kimi-install] HOME=$HOME"',
          'pip3 install --user --break-system-packages uv',
          'export PATH="$HOME/.local/bin:$PATH"',
          'command -v uv >/dev/null || { echo "[kimi-install] uv MISSING dopo pip install"; echo "Contenuto $HOME/.local/bin/:"; ls -la "$HOME/.local/bin/" 2>&1 || true; exit 1; }',
          'echo "[kimi-install] uv at $(command -v uv)"',
          // --force: il bind-mount /jht_home/.local/share/uv/ persiste
          // tra container (bind di ~/.jht). Se l'utente ha gia' installato
          // kimi in un container precedente e ora ricrea il container, la
          // skip-probe (command -v kimi) fallisce col PATH nuovo, ma uv
          // vede i suoi file ancora li' e rifiuta con "Executables already
          // exist: kimi, kimi-cli (use --force)". --force e' idempotente
          // su install fresca, su re-install pinna l'ultima versione.
          'UV_TOOL_BIN_DIR=/jht_home/.npm-global/bin uv tool install --force --python 3.13 kimi-cli',
        ].join(' && ')],
      },
    ],
    loginHint: 'inside TUI: /login',
  },
}

const SUPPORTED_IDS = Object.keys(PROVIDERS)

function resolveHome() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}

function dockerEnv(extra = {}) {
  // `docker compose` substitutes ${HOME} in the compose file; on Windows
  // the variable is not present unless we inject it ourselves.
  const base = { ...process.env, HOME: resolveHome() }
  // macOS GUI apps start with a sanitized PATH that excludes Homebrew
  // prefixes, so `spawn('docker', ...)` throws ENOENT.
  if (process.platform === 'darwin') {
    const extraPath = ['/opt/homebrew/bin', '/usr/local/bin']
    base.PATH = [...extraPath, base.PATH || ''].filter(Boolean).join(':')
  }
  return { ...base, ...extra }
}

function runStreamed(cmd, args, { cwd, onLog = () => {}, env }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, env: env || dockerEnv(), windowsHide: true })
    } catch (error) {
      resolve({ ok: false, code: -1, error: error instanceof Error ? error.message : String(error) })
      return
    }

    const forward = (stream) => {
      stream.setEncoding('utf8')
      let buffer = ''
      stream.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) if (line.length > 0) onLog(line)
      })
      stream.on('end', () => {
        if (buffer.length > 0) onLog(buffer)
      })
    }
    forward(child.stdout)
    forward(child.stderr)

    child.on('error', (error) => {
      resolve({ ok: false, code: -1, error: error instanceof Error ? error.message : String(error) })
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: typeof code === 'number' ? code : -1 })
    })
  })
}

async function installProvider({
  providerId,
  payloadDir,
  service = 'jht',
  onLog = () => {},
  run = runStreamed,
} = {}) {
  const provider = PROVIDERS[providerId]
  if (!provider) return { ok: false, providerId, error: `unknown provider: ${providerId}` }
  if (!payloadDir) return { ok: false, providerId, error: 'payloadDir required' }

  // Skip install se il binario è già raggiungibile nel container running.
  // I CLI vivono su un bind-mount persistente (/jht_home/.npm-global),
  // quindi sopravvivono al ricreare del container. Su NTFS/WSL2 il
  // reinstall via npm fallisce con EACCES durante rename() atomico, ed è
  // comunque inutile se l'utente ha già il binario. Check best-effort:
  // se il container non è up o docker non risponde, proseguiamo normalmente.
  const probe = await run(
    'docker',
    ['exec', service, 'sh', '-c', `command -v ${provider.binary}`],
    { cwd: payloadDir, onLog: () => {} },
  )
  if (probe.ok) {
    onLog(`[skip] ${provider.displayName} already installed in container`)
    return { ok: true, providerId, skipped: true }
  }

  for (const step of provider.install) {
    const composeArgs = ['compose', 'run', '--rm', '--no-deps', '--entrypoint', step.entrypoint]
    for (const [k, v] of Object.entries(step.env || {})) {
      composeArgs.push('-e', `${k}=${v}`)
    }
    composeArgs.push(service, ...step.args)
    onLog(`$ docker ${composeArgs.join(' ')}`)
    const result = await run('docker', composeArgs, { cwd: payloadDir, onLog })
    if (!result.ok) {
      return {
        ok: false,
        providerId,
        error: result.error || `install command exited with code ${result.code}`,
      }
    }
  }
  return { ok: true, providerId }
}

async function installProviders({
  providerIds,
  payloadDir,
  service = 'jht',
  onLog = () => {},
  run = runStreamed,
} = {}) {
  if (!Array.isArray(providerIds) || providerIds.length === 0) {
    return { ok: false, error: 'no providers selected' }
  }

  const results = []
  for (const providerId of providerIds) {
    onLog(`── Installing ${PROVIDERS[providerId]?.displayName || providerId} ──`)
    const res = await installProvider({ providerId, payloadDir, service, onLog, run })
    results.push(res)
    if (!res.ok) {
      return { ok: false, results, failedAt: providerId, error: res.error }
    }
  }
  return { ok: true, results }
}

// Probe the bind-mounted npm-global bin dir on the host to see which
// provider CLIs are already installed. No Docker call — we just check
// for the symlink that `npm install -g` creates.
function inspectInstalledProviders({ bindHomeDir } = {}) {
  const fs = require('node:fs')
  const path = require('node:path')
  const home = bindHomeDir || path.join(resolveHome(), '.jht')
  const binDir = path.join(home, '.npm-global', 'bin')
  // lstatSync (not existsSync) so dead-from-the-host symlinks still
  // count as "present". Kimi's uv install uses an absolute symlink
  // pointing inside the container (/jht_home/.local/share/uv/…),
  // which the host sees as a broken link — but from inside the
  // container it resolves fine, and that's the only place the binary
  // ever actually runs.
  const exists = (p) => {
    try {
      fs.lstatSync(p)
      return true
    } catch {
      return false
    }
  }
  const installed = []
  for (const [id, meta] of Object.entries(PROVIDERS)) {
    const binary = meta.binary
    if (!binary) continue
    if (exists(path.join(binDir, binary)) || exists(path.join(binDir, `${binary}.cmd`))) {
      installed.push(id)
    }
  }
  return { bindHomeDir: home, installed }
}

// ── VPS mode: install via SSH sul container remoto ─────────────────
//
// Quando state.location === 'vps' i CLI provider vanno installati DENTRO
// il container `jht` che gira sulla VPS, non in quello locale. Il
// comando equivalente di `docker compose run --rm ... jht <e> <args>`
// per un container gia' up sulla VPS e' `docker exec [-e K=V]* jht <e>
// <args>` (riusa il PID 1, niente container effimero).
//
// Lo step T1 implementa il routing minimal: itera providerIds, per ogni
// step costruisce la command line bash-quoted e la manda via
// SshExec.runStream. T2/T3 raffineranno (skip-probe pre-install,
// retry, gestione kimi multi-step con cleanup intermedio, ecc).

function _bashQuote(s) {
  // Wrappa s in single-quote bash; escapa eventuali ' interni con la
  // sequenza standard '\''. Niente $/backtick/etc da preoccuparsi
  // perche' single-quote bash li tratta letterali.
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

function _stepToRemoteCmd(step, { container = 'jht' } = {}) {
  // docker exec [-e K=V]* <container> <entrypoint> <args...>
  // Ogni token quotato per resistere al passaggio ssh→bash.
  const parts = ['docker', 'exec']
  // -i per accettare stdin (non serve qui ma evita warning su tty).
  parts.push('-i')
  for (const [k, v] of Object.entries(step.env || {})) {
    parts.push('-e', _bashQuote(`${k}=${v}`))
  }
  parts.push(_bashQuote(container))
  parts.push(_bashQuote(step.entrypoint))
  for (const arg of step.args || []) {
    parts.push(_bashQuote(arg))
  }
  return parts.join(' ')
}

// Pre-flight: assicura che il container `jht` sulla VPS sia in stato
// "running" prima di provare a fare `docker exec`. install.sh scarica il
// docker-compose.yml in /root/.jht/runtime/ ma NON lo avvia (l'utente
// dovrebbe fare `jht up`); senza questo check il primo `docker exec` su
// container assente fallisce con exit 1 e messaggio criptico
// "Error response from daemon: No such container: jht", che il flow
// install.sh→provider-install rende invisibile lato UI.
//
// Strategia:
//   1. `docker ps -q -f name=^jht$` → se non vuoto, container gia' up, ok.
//   2. Sennò `cd /root/.jht/runtime && docker compose up -d jht` (path
//      hardcoded coerente con install.sh), poi `docker exec jht true` per
//      confermare che parta davvero.
//
// Ritorna { ok, error? }. Loggato sul canale provider per visibilita' UI.
async function _ensureContainerUpRemote(ssh, { container = 'jht', onLog = () => {} } = {}) {
  const probe = await ssh.run(`docker ps -q -f name=^${container}$`)
  if (probe.ok && probe.stdout.trim().length > 0) {
    return { ok: true, alreadyUp: true }
  }
  onLog(`[preflight] container '${container}' non running su VPS, avvio via docker compose…`)
  // -d background; jht e' il nome del servizio nel docker-compose.yml.
  // Path /root/.jht/runtime/ e' hardcoded in install.sh download_runtime_files.
  const upCmd = `cd /root/.jht/runtime && docker compose up -d ${_bashQuote(container)}`
  const upRes = await ssh.runStream(upCmd, (line) => onLog(line))
  if (!upRes.ok) {
    return { ok: false, error: `docker compose up exited ${upRes.code}` }
  }
  // Conferma exec funzioni: il `up -d` ritorna prima che PID 1 abbia avuto
  // tempo di stabilizzarsi; un retry secco con piccolo back-off copre il
  // caso "container Created ma non Running" che dura tipicamente <2s.
  let started = false
  for (let attempt = 1; attempt <= 5; attempt++) {
    const check = await ssh.run(`docker exec -i ${_bashQuote(container)} true`)
    if (check.ok) { started = true; break }
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (!started) {
    return { ok: false, error: `container '${container}' avviato ma docker exec fallisce dopo 5 retry` }
  }
  return { ok: true, alreadyUp: false }
}

// Pre-flight permessi npm: `~/.jht` lato VPS e' creato da install.sh come
// root, ma il container `jht` runna come uid 1001 (user 'jht' nel
// Dockerfile). Senza chown, `npm install -g` falla con EACCES su mkdir
// /jht_home/.npm-global. Lo eseguiamo prima di OGNI install (idempotente,
// chown e mkdir -p sono no-op sui path gia' giusti). docker exec --user
// root e' necessario perche' il default user del container NON puo'
// chown-are file owned da root.
async function _ensureNpmDirsWritable(ssh, { container = 'jht', user = 'jht', onLog = () => {} } = {}) {
  // Dirs che npm/uv/claude/codex/kimi creano nella home utente al primo
  // install/launch. Tutte sotto /jht_home (bind-mount ~/.jht dell'host).
  // - .npm-global: NPM_CONFIG_PREFIX per `npm install -g`
  // - .npm: cache npm
  // - .local: pip --user + uv tool dir (storage Python tools)
  // - .cache: uv usa /jht_home/.cache/uv come download cache (kimi-cli)
  // - .config: claude/codex storano qui session token + config
  // - .kimi / .claude / .codex: CLI-specific data dirs (potrebbero gia' esistere
  //   come root da uno run precedente fallito a meta')
  const dirs = [
    '/jht_home/.npm-global',
    '/jht_home/.npm',
    '/jht_home/.local',
    '/jht_home/.cache',
    '/jht_home/.config',
    '/jht_home/.kimi',
    '/jht_home/.claude',
    '/jht_home/.codex',
  ]
  const dirsArg = dirs.join(' ')
  const remoteCmd = [
    'docker', 'exec', '-i', '--user', 'root', _bashQuote(container),
    'sh', '-c',
    _bashQuote(
      `mkdir -p ${dirsArg} && chown -R ${user}:${user} ${dirsArg}`,
    ),
  ].join(' ')
  const r = await ssh.run(remoteCmd)
  if (!r.ok) {
    onLog(`[preflight-npm-perms] ${(r.stderr || '').trim() || `exit ${r.code}`}`)
    return { ok: false, error: `chown npm dirs fallito: exit ${r.code}` }
  }
  return { ok: true }
}

async function installViaSsh({
  vpsIp,
  providerIds,
  container = 'jht',
  onLog = () => {},
} = {}) {
  if (!vpsIp || typeof vpsIp !== 'string') {
    return { ok: false, error: 'vpsIp required' }
  }
  if (!Array.isArray(providerIds) || providerIds.length === 0) {
    return { ok: false, error: 'no providers selected' }
  }
  // require lazy: ssh-exec carica logger che assume electron app, va
  // bene perche' siamo nel main process quando questa viene chiamata.
  const SshExec = require('./vps/ssh-exec')
  const ssh = SshExec.forIp(vpsIp)

  // Pre-flight container running: vedi commento _ensureContainerUpRemote.
  const ensure = await _ensureContainerUpRemote(ssh, { container, onLog })
  if (!ensure.ok) {
    onLog(`[preflight-error] ${ensure.error}`)
    return { ok: false, stage: 'preflight', error: ensure.error }
  }
  // Pre-flight permessi npm: chown delle cache dirs all'user del
  // container. Vedi _ensureNpmDirsWritable per il rationale (EACCES su
  // bind-mount root-owned). Idempotente: no-op se gia' OK.
  const perms = await _ensureNpmDirsWritable(ssh, { container, onLog })
  if (!perms.ok) {
    return { ok: false, stage: 'preflight', error: perms.error }
  }

  const results = []
  for (const providerId of providerIds) {
    const provider = PROVIDERS[providerId]
    if (!provider) {
      results.push({ ok: false, providerId, error: `unknown provider: ${providerId}` })
      return { ok: false, results, failedAt: providerId, error: `unknown provider: ${providerId}` }
    }
    onLog(`── Installing ${provider.displayName || providerId} (VPS ${vpsIp}) ──`)
    // Skip se gia' installato. La probe gira nello stesso container, basta:
    //   docker exec jht sh -c 'command -v <binary>'
    const probeCmd =
      `docker exec -i ${_bashQuote(container)} sh -c ${_bashQuote(`command -v ${provider.binary}`)}`
    const probe = await ssh.runStream(probeCmd, () => {})
    if (probe.ok) {
      onLog(`[skip] ${provider.displayName} already installed in remote container`)
      results.push({ ok: true, providerId, skipped: true })
      continue
    }
    for (const step of provider.install) {
      const remoteCmd = _stepToRemoteCmd(step, { container })
      onLog(`$ ssh root@${vpsIp} ${remoteCmd}`)
      const r = await ssh.runStream(remoteCmd, (line) => onLog(line))
      if (!r.ok) {
        results.push({ ok: false, providerId, error: `step exited ${r.code}` })
        return { ok: false, results, failedAt: providerId, error: `step exited ${r.code}` }
      }
    }
    results.push({ ok: true, providerId })
  }
  return { ok: true, results }
}

// Alias esplicito al nome usato nel brief T2 protocol-vps-refactor (dev1
// ha ribattezzato `installViaSsh` per brevita' nel suo stub T1; teniamo
// entrambi i nomi cosi' chi cerca la signature del brief la trova).
const installProvidersViaSsh = installViaSsh

// PTY remoto per il login OAuth del provider sulla VPS. Stessi loginArgs
// (--dangerously-skip-permissions / --yolo) della modalita' locale, ma
// invece di `docker compose run -it ... <binary>` apriamo
// `ssh -tt root@ip docker exec -it jht <binary> <loginArgs>`.
//
// Ritorna il ChildProcess wrappabile da xterm.js sul renderer (T3
// completera' il routing terminal:start).
function openLoginViaSsh({ vpsIp, providerId, container = 'jht' } = {}) {
  if (!vpsIp || typeof vpsIp !== 'string') {
    return { ok: false, error: 'vpsIp required' }
  }
  const provider = PROVIDERS[providerId]
  if (!provider) return { ok: false, error: `unknown provider: ${providerId}` }
  const SshExec = require('./vps/ssh-exec')

  const loginArgs = Array.isArray(provider.loginArgs) ? provider.loginArgs : []
  // docker exec -it (NB: -t serve per il TUI, non solo per echoing)
  const remoteCmd = [
    'docker', 'exec', '-it',
    _bashQuote(container),
    _bashQuote(provider.binary),
    ...loginArgs.map(_bashQuote),
  ].join(' ')

  const child = SshExec.openPty(vpsIp, remoteCmd)
  return { ok: true, child }
}

module.exports = {
  PROVIDERS,
  SUPPORTED_IDS,
  installProvider,
  installProviders,
  inspectInstalledProviders,
  resolveHome,
  dockerEnv,
  // VPS mode (T1 base, T2 ha aggiunto pre-flight container up)
  installViaSsh,
  installProvidersViaSsh,
  openLoginViaSsh,
  _internal: { runStreamed, _bashQuote, _stepToRemoteCmd, _ensureContainerUpRemote, _ensureNpmDirsWritable },
}
