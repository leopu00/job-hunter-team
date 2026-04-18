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

// Install Homebrew from inside the wizard — never asks the user to open
// Terminal. macOS shows a native admin-password prompt because the
// installer needs sudo to create /opt/homebrew with the right perms.
// NONINTERACTIVE=1 skips brew's "press RETURN to continue" confirmations.
function installHomebrew({ onLog = () => {} } = {}) {
  return new Promise((resolve) => {
    onLog('Installing Homebrew (macOS will ask for your password)...')
    const shellCmd =
      'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    // AppleScript requires internal double quotes to be escaped with \\"
    const applescript = `do shell script "${shellCmd.replace(/"/g, '\\"')}" with administrator privileges`
    let child
    try {
      child = spawn('osascript', ['-e', applescript], { windowsHide: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      resolve({ ok: false, code: -1, stderr: message })
      return
    }

    let stderrTail = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    // osascript buffers brew's output, so live line-by-line streaming
    // isn't possible via `do shell script`. The step spinner in the UI
    // carries the burden of showing "we're still working".
    child.stdout.on('data', (d) => {
      for (const line of String(d).split(/\r?\n/)) if (line) onLog(line)
    })
    child.stderr.on('data', (d) => {
      stderrTail += d
      for (const line of String(d).split(/\r?\n/)) if (line) onLog(line)
    })

    child.on('error', (error) => {
      resolve({
        ok: false,
        code: -1,
        stderr: error instanceof Error ? error.message : String(error),
      })
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
        stage: 'brew-install-homebrew',
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
  const start = await run('colima', ['start'], { onLog, env })
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
