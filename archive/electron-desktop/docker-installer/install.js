// Auto-install Colima + docker CLI on macOS via Homebrew, then bring
// the runtime up. Mirrors the Windows "Install Docker → download page"
// click-to-finish UX, but here we drive the install end-to-end so the
// user never has to leave the wizard.
//
// Stages reported back so the renderer can show targeted hints:
//   brew-missing        → Homebrew is not on PATH; we won't install it.
//   brew-not-writable   → Homebrew belongs to another user (multi-account Mac);
//                         the current user can't `brew install` into it.
//   brew-install        → `brew install colima docker` failed.
//   colima-start        → install ok but `colima start` failed.
//   daemon-unreachable  → start exited 0 but `docker ps` still doesn't respond.
//   ok                  → end-to-end install + daemon up.
//
// stdout/stderr from brew/colima get streamed line-by-line via onLog so
// the renderer can keep the user company during a multi-minute install.

const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const https = require('node:https')
const fs = require('node:fs')
const fsPromises = require('node:fs').promises
const os = require('node:os')
const path = require('node:path')

const execFileAsync = promisify(execFile)

// On Apple Silicon Macs brew lives under /opt/homebrew/bin which is NOT
// in Electron's default PATH (Electron inherits a sanitized PATH on
// launch). Prepending the standard brew locations means we find it
// even when the user hasn't tweaked their shell profile from inside
// the GUI session.
function brewPath() {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin']
  return [...extra, process.env.PATH || ''].filter(Boolean).join(':')
}

function brewEnv() {
  return { ...process.env, PATH: brewPath() }
}

// A `brew install` that streams bottle-download progress can legitimately
// run for many minutes, so a hard total-timeout would kill healthy installs.
// Instead we use an IDLE timeout: the clock resets on every line of output,
// and only fires if the child goes completely silent (hung on a stalled TCP
// socket, DNS, or a lock it will never get). Default 6 min of dead air.
const DEFAULT_IDLE_TIMEOUT_MS = 6 * 60 * 1000

function runStreamed(cmd, args, { onLog = () => {}, env, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    onLog(`$ ${cmd} ${args.join(' ')}`)
    let child
    try {
      child = spawn(cmd, args, { env: env || brewEnv(), windowsHide: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      resolve({ ok: false, code: -1, stderr: message })
      return
    }

    let stderrTail = ''
    let settled = false
    let timedOut = false
    let idleTimer = null

    const finish = (result) => {
      if (settled) return
      settled = true
      if (idleTimer) clearTimeout(idleTimer)
      resolve(result)
    }

    const bumpIdle = () => {
      if (!idleTimeoutMs || idleTimeoutMs <= 0) return
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        timedOut = true
        onLog(`⏱️ Nessun output per ${Math.round(idleTimeoutMs / 60000)} min — interrompo "${cmd}" (probabile blocco).`)
        try { child.kill('SIGTERM') } catch (_) { /* già morto */ }
        // Se SIGTERM non basta entro 5s, forza.
        setTimeout(() => { try { child.kill('SIGKILL') } catch (_) {} }, 5000)
      }, idleTimeoutMs)
    }

    const forward = (stream, isErr) => {
      stream.setEncoding('utf8')
      let buffer = ''
      stream.on('data', (chunk) => {
        bumpIdle()
        if (isErr) stderrTail += chunk
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.length > 0) onLog(line)
        }
      })
      stream.on('end', () => {
        if (buffer.length > 0) onLog(buffer)
      })
    }

    forward(child.stdout, false)
    forward(child.stderr, true)
    bumpIdle()

    child.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)
      finish({ ok: false, code: -1, stderr: message })
    })
    child.on('close', (code) => {
      if (timedOut) {
        finish({
          ok: false,
          code: -1,
          stderr: `timed out (no output for ${Math.round(idleTimeoutMs / 60000)} min)\n${stderrTail.trim().slice(-900)}`,
          timedOut: true,
        })
        return
      }
      finish({
        ok: code === 0,
        code: typeof code === 'number' ? code : -1,
        stderr: stderrTail.trim().slice(-1000),
      })
    })
  })
}

async function isBrewPresent({ env } = {}) {
  try {
    await execFileAsync('brew', ['--version'], { env: env || brewEnv(), timeout: 5000 })
    return true
  } catch {
    return false
  }
}

// Homebrew installs into a single prefix (/opt/homebrew on Apple Silicon,
// /usr/local on Intel) owned by whoever installed it first. On a Mac with
// more than one account a second user can't write there, so `brew install`
// fails halfway with permission errors ("change the ownership of these
// directories to your user"). Probe the prefix and the dirs brew must write
// to during an install, up front, so we can surface a clear message instead
// of a mid-install crash. Non-blocking on uncertainty: if we can't determine
// the prefix, assume writable and let the install proceed.
async function isBrewWritable({ env } = {}) {
  try {
    const { stdout } = await execFileAsync('brew', ['--prefix'], {
      env: env || brewEnv(),
      timeout: 5000,
    })
    const prefix = stdout.trim()
    if (!prefix) return { ok: true }
    const candidates = [
      prefix,
      path.join(prefix, 'Cellar'),
      path.join(prefix, 'var', 'homebrew', 'locks'),
    ]
    for (const dir of candidates) {
      if (!fs.existsSync(dir)) continue
      try {
        fs.accessSync(dir, fs.constants.W_OK)
      } catch {
        return { ok: false, prefix, dir }
      }
    }
    return { ok: true, prefix }
  } catch {
    return { ok: true }
  }
}

// Install Homebrew from inside the wizard without a Terminal window.
//
// The canonical `install.sh` script REFUSES to run as root ("Don't run
// this as root!") because brew itself must live under an unprivileged
// user — it only needs sudo for a few directory-permission steps. That
// makes `osascript ... with administrator privileges` (which runs the
// whole child as root) useless.
//
// Homebrew ships an official `.pkg` installer in every GitHub release,
// designed exactly for this case: it runs as root via `installer(8)`,
// sets up /opt/homebrew with the correct ownership (the invoking user),
// and registers PATH helpers. We fetch the latest .pkg, install it with
// a single admin-password prompt, and delete the temp file.
// Xcode Command Line Tools (CLT) are a hard prerequisite for the
// Homebrew .pkg installer — it refuses to run without them. We install
// them via `xcode-select --install` which pops a native macOS dialog
// ("Do you want to install the command line developer tools?") that the
// user clicks through. No Terminal. Then we poll until the tools are
// actually on disk, because the dialog returns to us before the
// download finishes.
async function ensureXcodeCLT({ onLog = () => {}, pollMs = 5000, timeoutMs = 900000 } = {}) {
  const env = brewEnv()
  const cltPresent = async () => {
    try {
      await execFileAsync('xcode-select', ['-p'], { env, timeout: 3000 })
      await execFileAsync('xcrun', ['clang', '--version'], { env, timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  if (await cltPresent()) return { ok: true, alreadyPresent: true }

  onLog('Command Line Tools missing — asking macOS to install them…')
  try {
    await execFileAsync('xcode-select', ['--install'], { env, timeout: 10000 })
  } catch (error) {
    const msg = String((error && error.stderr) || (error && error.message) || '')
    // "already requested" / "already installed" from a previous canceled run
    // is not a real error — we just fall through to the polling loop.
    if (!/already/i.test(msg)) {
      onLog(msg)
    }
  }

  onLog('Waiting for Command Line Tools to finish installing…')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))
    if (await cltPresent()) {
      onLog('Command Line Tools installed.')
      return { ok: true, alreadyPresent: false }
    }
  }
  return { ok: false, error: 'Command Line Tools install timeout (15 min)' }
}

async function installHomebrew({ onLog = () => {} } = {}) {
  try {
    const clt = await ensureXcodeCLT({ onLog })
    if (!clt.ok) {
      return {
        ok: false,
        code: -1,
        stderr: clt.error || 'Command Line Tools not available',
      }
    }
    onLog('Fetching latest Homebrew installer…')
    const pkgUrl = await fetchLatestHomebrewPkgUrl()
    const pkgPath = path.join(os.tmpdir(), `jht-homebrew-${Date.now()}.pkg`)
    onLog(`Downloading ${pkgUrl.split('/').pop()}…`)
    await downloadFile(pkgUrl, pkgPath, onLog)
    onLog('Installing (macOS will ask for your password)…')
    const result = await runPkgInstaller(pkgPath, onLog)
    // Best-effort cleanup of the downloaded pkg.
    try { await fsPromises.unlink(pkgPath) } catch { /* ignore */ }
    return result
  } catch (error) {
    return {
      ok: false,
      code: -1,
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

async function fetchLatestHomebrewPkgUrl() {
  const release = await fetchJson(
    'https://api.github.com/repos/Homebrew/brew/releases/latest',
  )
  const pkg = (release.assets || []).find(
    (a) => a && typeof a.name === 'string' && a.name.endsWith('.pkg'),
  )
  if (!pkg || !pkg.browser_download_url) {
    throw new Error('No .pkg asset in latest Homebrew release')
  }
  return pkg.browser_download_url
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'jht-desktop',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        // GitHub API redirects should already be resolved, but handle just in case.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          fetchJson(res.headers.location).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`GitHub API HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(15000, () => {
      req.destroy(new Error('GitHub API request timed out'))
    })
  })
}

function downloadFile(url, destPath, onLog) {
  return new Promise((resolve, reject) => {
    let settled = false
    // A half-written .pkg/.dmg is worse than none: the installer could run on
    // a truncated package. On any failure/timeout we unlink the partial file
    // so a retry starts clean and nothing downstream sees corrupt bytes.
    const fail = (err) => {
      if (settled) return
      settled = true
      fs.unlink(destPath, () => reject(err))
    }
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const doGet = (currentUrl) => {
      const req = https.get(currentUrl, { headers: { 'User-Agent': 'jht-desktop' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          doGet(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          fail(new Error(`Download HTTP ${res.statusCode}`))
          return
        }
        const file = fs.createWriteStream(destPath)
        res.pipe(file)
        file.on('finish', () => file.close(() => done()))
        file.on('error', fail)
        res.on('error', fail)
      })
      req.on('error', fail)
      // Stalled transfer (handshake ok, bytes frozen): bail after 60s of
      // no socket activity so we don't hang the whole Docker install.
      req.setTimeout(60000, () => {
        req.destroy(new Error('Download timed out (stalled transfer)'))
      })
    }
    doGet(url)
  })
}

function runPkgInstaller(pkgPath, onLog = () => {}) {
  return new Promise((resolve) => {
    // `installer -pkg <pkg> -target /` needs root. `with administrator
    // privileges` gives it root via a single native GUI password prompt.
    const applescript =
      `do shell script "/usr/sbin/installer -pkg ${JSON.stringify(pkgPath).slice(1, -1)} -target /" with administrator privileges`
    let child
    try {
      child = spawn('osascript', ['-e', applescript], { windowsHide: true })
    } catch (error) {
      resolve({
        ok: false,
        code: -1,
        stderr: error instanceof Error ? error.message : String(error),
      })
      return
    }
    let stderrTail = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    const forward = (stream) => {
      let buf = ''
      stream.on('data', (d) => {
        stderrTail += d
        buf += d
        const lines = buf.split(/\r?\n/)
        buf = lines.pop() || ''
        for (const line of lines) if (line.length > 0) onLog(line)
      })
      stream.on('end', () => {
        if (buf.length > 0) onLog(buf)
      })
    }
    forward(child.stdout)
    forward(child.stderr)
    child.on('error', (error) => {
      resolve({
        ok: false,
        code: -1,
        stderr: error instanceof Error ? error.message : String(error),
      })
    })
    child.on('close', (code) => {
      // osascript returns code 1 with stderr "User canceled. (-128)" when
      // the user dismisses the native password prompt; surface that as a
      // distinct reason so the UI can tell the user to retry and approve.
      const tail = stderrTail.trim().slice(-1000)
      const canceled = /-128/.test(tail) || /User canceled/i.test(tail)
      resolve({
        ok: code === 0,
        code: typeof code === 'number' ? code : -1,
        stderr: tail,
        canceled,
      })
    })
  })
}

async function isDockerResponsive({ env } = {}) {
  try {
    await execFileAsync('docker', ['ps', '--format', '{{.ID}}'], {
      env: env || brewEnv(),
      timeout: 6000,
    })
    return true
  } catch {
    return false
  }
}

async function isColimaInstalled({ env } = {}) {
  try {
    await execFileAsync('colima', ['version'], { env: env || brewEnv(), timeout: 5000 })
    return true
  } catch {
    return false
  }
}

async function isQemuImgPresent({ env } = {}) {
  try {
    await execFileAsync('qemu-img', ['--version'], { env: env || brewEnv(), timeout: 3000 })
    return true
  } catch {
    return false
  }
}

// Snapshot of the three install steps shown in the UI. Used by the renderer
// to paint the checklist on open without running any install yet.
async function inspectInstallSteps({ platform = process.platform } = {}) {
  if (platform !== 'darwin') return null
  const env = brewEnv()
  const [homebrew, colima, daemon] = await Promise.all([
    isBrewPresent({ env }),
    isColimaInstalled({ env }),
    isDockerResponsive({ env }),
  ])
  return {
    homebrew: homebrew ? 'ok' : 'missing',
    colima: colima ? 'ok' : 'missing',
    daemon: daemon ? 'ok' : 'missing',
  }
}

async function installColimaOnDarwin({
  onLog = () => {},
  onStage = () => {},
  run = runStreamed,
  brewCheck = isBrewPresent,
  brewWritable = isBrewWritable,
  dockerCheck = isDockerResponsive,
  brewInstaller = installHomebrew,
  qemuImgCheck = isQemuImgPresent,
} = {}) {
  const env = brewEnv()

  onStage('homebrew', 'busy')
  if (!(await brewCheck({ env }))) {
    // brew is missing: install it ourselves via osascript (GUI password
    // prompt, no Terminal for the user). Requires network + admin.
    const brewInstall = await brewInstaller({ onLog })
    if (!brewInstall.ok) {
      onStage('homebrew', 'fail')
      return {
        ok: false,
        stage: brewInstall.canceled ? 'brew-auth-canceled' : 'brew-install-homebrew',
        error:
          brewInstall.stderr ||
          `Homebrew install exited with code ${brewInstall.code}`,
      }
    }
    // Some installers exit 0 but leave brew not on PATH of the current
    // process (shell init hasn't been re-sourced). Re-verify from the
    // augmented PATH; if still missing, report failure.
    if (!(await brewCheck({ env }))) {
      onStage('homebrew', 'fail')
      return {
        ok: false,
        stage: 'brew-install-homebrew',
        error: 'Homebrew installer finished but brew not found on PATH',
      }
    }
  }
  // brew is now present (pre-existing or freshly installed). If the prefix
  // belongs to a DIFFERENT user (multi-account Mac) the upcoming
  // `brew install` would die with permission errors — catch it here with a
  // clear, actionable message instead of a cryptic mid-install failure.
  const writable = await brewWritable({ env })
  if (!writable.ok) {
    onStage('homebrew', 'fail')
    return {
      ok: false,
      stage: 'brew-not-writable',
      error:
        `Homebrew (${writable.prefix || '/opt/homebrew'}) appartiene a un altro ` +
        `utente del Mac e non è scrivibile dal tuo account. Homebrew funziona per ` +
        `un solo utente: usa l'account che l'ha installato, oppure scegli Docker Desktop.`,
    }
  }
  onStage('homebrew', 'ok')

  onStage('colima', 'busy')
  // `docker-compose` is a separate Homebrew formula — without it the
  // `docker compose ...` subcommand reports "unknown command" because
  // Colima's docker CLI ships without the Compose plugin bundled (unlike
  // Docker Desktop, which includes it).
  const install = await run(
    'brew',
    ['install', 'colima', 'docker', 'docker-compose'],
    { onLog, env },
  )
  if (!install.ok) {
    onStage('colima', 'fail')
    return {
      ok: false,
      stage: 'brew-install',
      error: install.stderr || `brew install exited with code ${install.code}`,
    }
  }

  // `brew install` exits 0 even when it silently SKIPS linking the `docker`
  // formula — either because a prior partial run already installed it (brew
  // won't relink an existing keg) or because another keg owns a conflicting
  // path (e.g. `docker.lima` from the `lima` formula that Colima pulls in).
  // Without the link, /opt/homebrew/bin/docker never appears, so the next
  // `colima start` dies with "dependency check failed for docker: docker not
  // found". Force the link here so the binary is guaranteed on PATH.
  // Best-effort: if it still fails, the daemon check below surfaces it.
  await run('brew', ['link', '--overwrite', 'docker'], { onLog, env })

  // Homebrew's docker-compose formula doesn't wire the plugin into
  // ~/.docker/cli-plugins on its own (brew just prints a caveat), so
  // `docker compose` still fails after install. Do the symlink now.
  // Resolve the keg prefix with `brew --prefix` instead of hardcoding it:
  // it lives under /opt/homebrew on Apple Silicon but /usr/local on Intel
  // Macs — a hardcoded /opt/homebrew path left `docker compose` unavailable
  // on Intel, so the container step dead-ended one step after a green
  // `docker ps`. Best-effort: only link when the resolved binary exists.
  await run(
    'bash',
    [
      '-c',
      'mkdir -p "$HOME/.docker/cli-plugins" && cbin="$(brew --prefix docker-compose 2>/dev/null)/bin/docker-compose" && [ -x "$cbin" ] && ln -sfn "$cbin" "$HOME/.docker/cli-plugins/docker-compose" || true',
    ],
    { onLog, env },
  )
  onStage('colima', 'ok')

  onStage('daemon', 'busy')
  // Size the VM for the team: Colima's default is 2 GiB / 2 CPU, too tight
  // for the 7-agent team plus the in-container Next.js server — `docker ps`
  // reports green but the team can OOM at boot. Default to 4 GiB / 4 CPU
  // (override via JHT_COLIMA_MEMORY / JHT_COLIMA_CPU on smaller hosts). The
  // sizing applies when the VM is first created; a pre-existing Colima VM
  // keeps whatever it was made with.
  const vmMem = process.env.JHT_COLIMA_MEMORY || '4'
  const vmCpu = process.env.JHT_COLIMA_CPU || '4'
  const colimaStartArgs = ['start', '--cpu', vmCpu, '--memory', vmMem]
  // Try the fast default backend (VZ) first. If it fails — usually because
  // we're running inside a VM whose host doesn't expose nested Apple
  // Virtualization to the guest — fall back to QEMU emulation. QEMU is
  // slower but runs without nested virt, so the wizard doesn't dead-end
  // on developer/test machines that live inside Parallels/UTM/etc.
  let start = await run('colima', colimaStartArgs, { onLog, env })
  if (!start.ok) {
    onLog('Colima start with VZ backend failed — falling back to QEMU…')
    // QEMU backend needs the qemu-img binary; install it lazily so real
    // Mac hosts that never hit the fallback don't pay the ~200MB download.
    const qemuOk = await qemuImgCheck({ env })
    if (!qemuOk) {
      onLog('Installing qemu (required by QEMU backend)…')
      const qemu = await run('brew', ['install', 'qemu'], { onLog, env })
      if (!qemu.ok) {
        onStage('daemon', 'fail')
        return {
          ok: false,
          stage: 'colima-start',
          error: qemu.stderr || `qemu install exited with code ${qemu.code}`,
        }
      }
    }
    start = await run('colima', [...colimaStartArgs, '--vm-type', 'qemu'], { onLog, env })
  }
  if (!start.ok) {
    onStage('daemon', 'fail')
    return {
      ok: false,
      stage: 'colima-start',
      error: start.stderr || `colima start exited with code ${start.code}`,
    }
  }

  if (!(await dockerCheck({ env }))) {
    onStage('daemon', 'fail')
    return {
      ok: false,
      stage: 'daemon-unreachable',
      error: 'docker ps non risponde dopo colima start',
      hintKey: 'docker.install.daemonUnreachable',
    }
  }
  onStage('daemon', 'ok')

  return { ok: true, stage: 'ok' }
}

// ───────────────────────────────────────────────────────────────────────────
// Linux: install Docker Engine (CE) via Docker's official convenience script
// (https://get.docker.com). No Docker Desktop, no VM — on Linux the daemon
// runs natively as a systemd service, which is the lightest option. Colima is
// deliberately NOT used here: Colima exists to give macOS/Windows a Linux VM;
// on Linux we're already on Linux. Mirrors the darwin pipeline (streamed logs,
// staged progress) so the wizard drives the whole install without the user
// leaving the app.
//
// Stages reported back:
//   downloading-script     → fetching get.docker.com (unprivileged).
//   installing             → running the script as root (installs docker-ce).
//   configuring-user-group → usermod -aG docker <user>.
//   starting-daemon        → systemctl enable --now docker + verify it's up.
//   ok                     → installed + daemon active. `needsRelogin` is true
//                            when the current session can't reach the socket
//                            yet: docker-group membership only applies to NEW
//                            login sessions, so checkDocker() reports
//                            needs-reboot until the user logs out/in or reboots.
const GET_DOCKER_SCRIPT_URL = 'https://get.docker.com'
// Sentinel the root script echoes so we can advance the wizard's stage from
// inside a single pkexec elevation (one password prompt for everything).
const STAGE_MARKER = '@@JHTSTAGE:'

// Fetch the official install script to a temp file, following redirects.
// Unprivileged on purpose: only the fetch happens here; the script itself runs
// as root via pkexec below.
function downloadDockerScript(
  url,
  destPath,
  { onLog = () => {}, redirectsLeft = 5 } = {},
) {
  return new Promise((resolve, reject) => {
    onLog(`Scarico lo script ufficiale Docker da ${url}…`)
    let req
    try {
      req = https.get(url, (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) {
            reject(new Error('Troppi redirect scaricando lo script Docker'))
            return
          }
          const next = new URL(res.headers.location, url).toString()
          resolve(
            downloadDockerScript(next, destPath, {
              onLog,
              redirectsLeft: redirectsLeft - 1,
            }),
          )
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error(`Download script Docker fallito: HTTP ${status}`))
          return
        }
        const file = fs.createWriteStream(destPath, { mode: 0o600 })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve(destPath)))
        file.on('error', (error) => reject(error))
      })
    } catch (error) {
      reject(error)
      return
    }
    req.on('error', (error) => reject(error))
    req.setTimeout(30000, () => {
      req.destroy(new Error('Timeout scaricando lo script Docker'))
    })
  })
}

async function isPkexecPresent({ env } = {}) {
  try {
    await execFileAsync('sh', ['-c', 'command -v pkexec'], {
      env: env || process.env,
      timeout: 3000,
    })
    return true
  } catch {
    return false
  }
}

// The freshly added docker-group membership doesn't apply to the current
// session, so `docker ps` as the user would fail even with the daemon up.
// Check the systemd unit instead — readable without root and the real signal
// that Engine is running.
async function isDockerDaemonActive({ env } = {}) {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', 'docker'], {
      env: env || process.env,
      timeout: 4000,
    })
    return stdout.trim() === 'active'
  } catch {
    return false
  }
}

async function installDockerEngineOnLinux({
  onLog = () => {},
  onStage = () => {},
  run = runStreamed,
  download = downloadDockerScript,
  pkexecCheck = isPkexecPresent,
  daemonCheck = isDockerDaemonActive,
  dockerCheck = isDockerResponsive,
  username = os.userInfo().username,
  env = process.env,
} = {}) {
  // 1) Fetch the official convenience script (unprivileged).
  onStage('downloading-script', 'busy')
  const scriptPath = path.join(os.tmpdir(), 'jht-get-docker.sh')
  try {
    await download(GET_DOCKER_SCRIPT_URL, scriptPath, { onLog })
  } catch (error) {
    onStage('downloading-script', 'fail')
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, stage: 'downloading-script', error: message }
  }
  onStage('downloading-script', 'ok')

  // 2) We need a GRAPHICAL privilege prompt. pkexec (PolicyKit) gives one;
  //    sudo would need a TTY the GUI session doesn't have.
  if (!(await pkexecCheck({ env }))) {
    return {
      ok: false,
      stage: 'no-pkexec',
      error:
        'pkexec (PolicyKit) non disponibile: impossibile chiedere i privilegi di ' +
        'amministratore in modalità grafica. Installa "policykit-1" oppure segui ' +
        'la guida ufficiale di Docker.',
    }
  }

  // 3) Whole privileged sequence in ONE elevation (single password prompt):
  //    install Engine → add user to docker group → enable+start the daemon.
  //    The root script echoes STAGE markers so we advance the wizard without
  //    splitting this into several pkexec calls (= several prompts).
  onStage('installing', 'busy')
  const rootScript = [
    'set -e',
    `sh "${scriptPath}"`,
    `echo "${STAGE_MARKER}configuring-user-group"`,
    'groupadd -f docker',
    `usermod -aG docker "${username}"`,
    `echo "${STAGE_MARKER}starting-daemon"`,
    'systemctl enable --now docker',
  ].join('\n')

  const result = await run('pkexec', ['/bin/sh', '-c', rootScript], {
    env,
    onLog: (line) => {
      if (typeof line === 'string' && line.startsWith(STAGE_MARKER)) {
        const stage = line.slice(STAGE_MARKER.length).trim()
        onStage(stage, 'busy')
        if (stage === 'configuring-user-group') {
          onLog(`Aggiungo l'utente ${username} al gruppo docker…`)
        } else if (stage === 'starting-daemon') {
          onLog('Abilito e avvio il daemon Docker…')
        }
        return
      }
      onLog(line)
    },
  })

  if (!result.ok) {
    // pkexec exit codes: 126 = auth dialog dismissed, 127 = not authorized.
    const canceled = result.code === 126 || result.code === 127
    onStage('installing', 'fail')
    return {
      ok: false,
      stage: canceled ? 'auth-canceled' : 'install',
      error: canceled
        ? 'Autenticazione annullata: servono i privilegi di amministratore per installare Docker Engine.'
        : result.stderr || `Installazione Docker terminata con codice ${result.code}`,
    }
  }

  // 4) Confirm the daemon is up (systemd unit, not `docker ps` — see above).
  onStage('starting-daemon', 'busy')
  if (!(await daemonCheck({ env }))) {
    onStage('starting-daemon', 'fail')
    return {
      ok: false,
      stage: 'daemon-inactive',
      error:
        'Docker installato ma il daemon non risulta attivo (systemctl is-active docker ≠ active).',
    }
  }
  onStage('starting-daemon', 'ok')

  // If the current process can already reach docker (app relaunched, or the
  // user was already a docker-group member) we're fully done; otherwise flag
  // that a re-login is needed for the group membership to take effect.
  const responsiveNow = await Promise.resolve(dockerCheck({ env })).catch(() => false)
  return { ok: true, stage: 'ok', needsRelogin: !responsiveNow }
}

async function installDocker(opts = {}) {
  const platform = opts.platform || process.platform
  if (platform === 'linux') {
    return installDockerEngineOnLinux(opts)
  }
  if (platform !== 'darwin') {
    return { ok: false, error: 'unsupported-platform' }
  }
  // installColimaOnDarwin applies its own defaults for any dep not injected,
  // so forwarding opts verbatim preserves the previous behaviour.
  return installColimaOnDarwin(opts)
}

module.exports = {
  installDocker,
  inspectInstallSteps,
  _internal: {
    runStreamed,
    isBrewPresent,
    isBrewWritable,
    isDockerResponsive,
    isColimaInstalled,
    isQemuImgPresent,
    installHomebrew,
    brewEnv,
    brewPath,
    // Linux (Docker Engine via get.docker.com)
    installDockerEngineOnLinux,
    downloadDockerScript,
    isPkexecPresent,
    isDockerDaemonActive,
  },
}
