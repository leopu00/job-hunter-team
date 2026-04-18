// Auto-install Colima + docker CLI on macOS via Homebrew, then bring
// the runtime up. Mirrors the Windows "Install Docker → download page"
// click-to-finish UX, but here we drive the install end-to-end so the
// user never has to leave the wizard.
//
// Stages reported back so the renderer can show targeted hints:
//   brew-missing        → Homebrew is not on PATH; we won't install it.
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

function runStreamed(cmd, args, { onLog = () => {}, env } = {}) {
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

    const forward = (stream, isErr) => {
      stream.setEncoding('utf8')
      let buffer = ''
      stream.on('data', (chunk) => {
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

    child.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)
      resolve({ ok: false, code: -1, stderr: message })
    })
    child.on('close', (code) => {
      resolve({
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
    const doGet = (currentUrl) => {
      https
        .get(currentUrl, { headers: { 'User-Agent': 'jht-desktop' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            doGet(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            res.resume()
            reject(new Error(`Download HTTP ${res.statusCode}`))
            return
          }
          const file = fs.createWriteStream(destPath)
          res.pipe(file)
          file.on('finish', () => file.close(() => resolve()))
          file.on('error', reject)
        })
        .on('error', reject)
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
  dockerCheck = isDockerResponsive,
  brewInstaller = installHomebrew,
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
  onStage('homebrew', 'ok')

  onStage('colima', 'busy')
  const install = await run('brew', ['install', 'colima', 'docker'], { onLog, env })
  if (!install.ok) {
    onStage('colima', 'fail')
    return {
      ok: false,
      stage: 'brew-install',
      error: install.stderr || `brew install exited with code ${install.code}`,
    }
  }
  onStage('colima', 'ok')

  onStage('daemon', 'busy')
  // Try the fast default backend (VZ) first. If it fails — usually because
  // we're running inside a VM whose host doesn't expose nested Apple
  // Virtualization to the guest — fall back to QEMU emulation. QEMU is
  // slower but runs without nested virt, so the wizard doesn't dead-end
  // on developer/test machines that live inside Parallels/UTM/etc.
  let start = await run('colima', ['start'], { onLog, env })
  if (!start.ok) {
    onLog('Colima start with VZ backend failed — retrying with QEMU…')
    start = await run('colima', ['start', '--vm-type', 'qemu'], { onLog, env })
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

async function installDocker({
  platform = process.platform,
  onLog = () => {},
  onStage = () => {},
  run = runStreamed,
  brewCheck = isBrewPresent,
  dockerCheck = isDockerResponsive,
  brewInstaller = installHomebrew,
} = {}) {
  if (platform !== 'darwin') {
    return { ok: false, error: 'unsupported-platform' }
  }
  return installColimaOnDarwin({
    onLog,
    onStage,
    run,
    brewCheck,
    dockerCheck,
    brewInstaller,
  })
}

module.exports = {
  installDocker,
  inspectInstallSteps,
  _internal: {
    runStreamed,
    isBrewPresent,
    isDockerResponsive,
    isColimaInstalled,
    installHomebrew,
    brewEnv,
    brewPath,
  },
}
