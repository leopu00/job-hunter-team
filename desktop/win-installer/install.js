// One-click installer for the Windows runtime stack: WSL2 (with the
// default Ubuntu distro) + Docker Desktop, behind a single UAC prompt
// and a single reboot at the end.
//
// Why a single elevated PowerShell session running a generated script?
// `Start-Process -Verb RunAs` triggers exactly one UAC prompt; once the
// user accepts, the elevated process runs `wsl --install --no-launch`
// and then the silent Docker Desktop installer back-to-back. Both
// installers normally want to reboot — we suppress their auto-restart
// (Docker via `--no-restart`, WSL via `--no-launch` which defers the
// distro initialisation) and let the wizard show one explicit
// "Restart now" button afterwards.
//
// Live progress is observed by tailing a temp log file the elevated
// script appends to, since stdout from a `Start-Process -Verb RunAs`
// child cannot be piped back to the unelevated parent.

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const DOCKER_INSTALLER_URL =
  'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'

function tempPaths() {
  const dir = os.tmpdir()
  return {
    script: path.join(dir, 'jht-install-windows-stack.ps1'),
    log: path.join(dir, 'jht-install.log'),
    result: path.join(dir, 'jht-install.result'),
    dockerInstaller: path.join(dir, 'DockerDesktopInstaller.exe'),
  }
}

// Build the PowerShell script the elevated process will run. Kept as a
// pure function so tests can snapshot it without spawning anything.
function buildScript({
  dockerUrl = DOCKER_INSTALLER_URL,
  paths = tempPaths(),
} = {}) {
  // PowerShell-side single-quote escape for paths that might contain
  // spaces/quotes. The dockerUrl is hard-coded (no interpolation), so
  // it doesn't need extra quoting.
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`

  return [
    `$ErrorActionPreference = 'Continue'`,
    `$logPath = ${q(paths.log)}`,
    `$resultPath = ${q(paths.result)}`,
    `$dockerInstaller = ${q(paths.dockerInstaller)}`,
    `function Log([string]$m) {`,
    `  $line = "$([DateTime]::Now.ToString('HH:mm:ss')) $m"`,
    `  Add-Content -Path $logPath -Value $line`,
    `  Write-Host $line`,
    `}`,
    `function Fail([string]$tag, [string]$msg) {`,
    `  Log "FAIL $tag $msg"`,
    `  Set-Content -Path $resultPath -Value $tag`,
    `  exit 1`,
    `}`,
    ``,
    `Set-Content -Path $logPath -Value ""`,
    `Set-Content -Path $resultPath -Value 'RUNNING'`,
    ``,
    `Log "Step 1/4 Installing WSL (--no-launch, distro init deferred to reboot)"`,
    `try {`,
    `  & wsl.exe --install --no-launch *>&1 | ForEach-Object { Log $_ }`,
    `  if ($LASTEXITCODE -ne 0) { Fail 'WSL_INSTALL' "wsl exit $LASTEXITCODE" }`,
    `} catch { Fail 'WSL_INSTALL' $_.Exception.Message }`,
    ``,
    `Log "Step 2/4 Installing Git (winget, silent, --accept-package-agreements)"`,
    `try {`,
    `  & git --version *>$null`,
    `  if ($LASTEXITCODE -eq 0) {`,
    `    Log "Git already on PATH, skipping"`,
    `  } else {`,
    `    & winget install --id Git.Git --source winget --silent \``,
    `      --accept-package-agreements --accept-source-agreements \``,
    `      --disable-interactivity *>&1 | ForEach-Object { Log $_ }`,
    `    if ($LASTEXITCODE -ne 0) { Fail 'GIT_INSTALL' "winget exit $LASTEXITCODE" }`,
    `  }`,
    `} catch { Fail 'GIT_INSTALL' $_.Exception.Message }`,
    ``,
    `Log "Step 3/4 Downloading Docker Desktop installer"`,
    `try {`,
    `  $ProgressPreference = 'SilentlyContinue'`,
    `  Invoke-WebRequest -Uri '${dockerUrl}' -OutFile $dockerInstaller -UseBasicParsing`,
    `  Log ("Downloaded {0:N1} MB" -f ((Get-Item $dockerInstaller).Length / 1MB))`,
    `} catch { Fail 'DOCKER_DOWNLOAD' $_.Exception.Message }`,
    ``,
    `Log "Step 4/4 Installing Docker Desktop (silent, --no-restart)"`,
    `try {`,
    `  $p = Start-Process -Wait -PassThru -FilePath $dockerInstaller \``,
    `       -ArgumentList 'install','--quiet','--accept-license','--no-restart'`,
    `  if ($p.ExitCode -ne 0) { Fail 'DOCKER_INSTALL' "exit $($p.ExitCode)" }`,
    `} catch { Fail 'DOCKER_INSTALL' $_.Exception.Message }`,
    ``,
    `Log "DONE — reboot required to finish WSL kernel + Docker engine setup"`,
    `Set-Content -Path $resultPath -Value 'OK'`,
    `exit 0`,
  ].join('\n')
}

// Tail the temp log file and forward each new line to onLog. Returns
// a stop() function. Uses fs.watch + manual seek rather than a 3rd-party
// library to keep the dep tree empty.
function tailLog(logPath, onLog) {
  let position = 0
  let watcher = null
  let pollTimer = null
  let stopped = false

  const drain = () => {
    if (stopped) return
    fs.stat(logPath, (err, stat) => {
      if (stopped) return
      if (err || stat.size <= position) return
      const stream = fs.createReadStream(logPath, {
        start: position,
        end: stat.size,
        encoding: 'utf8',
      })
      let buffer = ''
      stream.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) if (line) onLog(line)
      })
      stream.on('end', () => {
        position = stat.size
        if (buffer.length > 0) onLog(buffer)
      })
    })
  }

  try {
    watcher = fs.watch(logPath, { persistent: false }, () => drain())
  } catch {
    // File may not exist yet — fallback to polling until it does.
  }
  // Even with watch, poll every 500ms as a safety net (fs.watch on
  // Windows is sometimes flaky for files written by another process).
  pollTimer = setInterval(drain, 500)
  drain()

  return () => {
    stopped = true
    if (watcher) try { watcher.close() } catch { /* ignore */ }
    if (pollTimer) clearInterval(pollTimer)
  }
}

function spawnElevatedScript({ scriptPath, spawnFn = spawn }) {
  // Outer (unelevated) PowerShell launches an elevated child via
  // Start-Process -Verb RunAs and waits for it. This gives us a single
  // process to await, while the elevated child does the real work.
  const inner = `Start-Process -Verb RunAs -Wait -FilePath powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}'`
  return spawnFn('powershell.exe', ['-NoProfile', '-Command', inner], {
    windowsHide: true,
  })
}

async function installWindowsStack({
  platform = process.platform,
  onLog = () => {},
  paths = tempPaths(),
  spawnFn = spawn,
  fsApi = fs,
} = {}) {
  if (platform !== 'win32') {
    return { ok: false, error: 'unsupported-platform' }
  }

  // Reset previous state so a re-run starts clean.
  for (const p of [paths.log, paths.result]) {
    try { fsApi.unlinkSync(p) } catch { /* ok if missing */ }
  }

  const script = buildScript({ paths })
  fsApi.writeFileSync(paths.script, script, 'utf8')

  const stopTail = tailLog(paths.log, onLog)

  const child = spawnElevatedScript({ scriptPath: paths.script, spawnFn })

  const exitCode = await new Promise((resolve) => {
    child.on('error', (err) => {
      onLog(`spawn error: ${err.message}`)
      resolve(-1)
    })
    child.on('close', (code) => resolve(typeof code === 'number' ? code : -1))
  })

  // Give the tail a moment to drain final lines after the child exits.
  await new Promise((r) => setTimeout(r, 600))
  stopTail()

  let result = 'UNKNOWN'
  try { result = fsApi.readFileSync(paths.result, 'utf8').trim() } catch { /* missing */ }

  if (result === 'OK' && exitCode === 0) {
    return { ok: true, rebootRequired: true }
  }

  // Map known result tags to actionable error stages.
  const stageByTag = {
    WSL_INSTALL: 'wsl-install',
    GIT_INSTALL: 'git-install',
    DOCKER_DOWNLOAD: 'docker-download',
    DOCKER_INSTALL: 'docker-install',
    RUNNING: 'aborted',
    UNKNOWN: 'aborted',
  }
  return {
    ok: false,
    stage: stageByTag[result] || 'unknown',
    error: result === 'RUNNING' || result === 'UNKNOWN'
      ? `installer exited (code ${exitCode}) before reporting a result — likely UAC declined or PowerShell blocked`
      : `installer reported ${result} (exit ${exitCode})`,
  }
}

module.exports = {
  installWindowsStack,
  buildScript,
  DOCKER_INSTALLER_URL,
  _internal: { tempPaths, tailLog, spawnElevatedScript },
}
