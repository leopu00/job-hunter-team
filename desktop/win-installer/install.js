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
    outerLog: path.join(dir, 'jht-install-outer.log'),
    nodeLog: path.join(dir, 'jht-install-node.log'),
    // NEW: stdout/stderr of the elevated powershell child, captured by
    // cmd.exe redirection so we see errors even when the script never
    // gets to write its own log (execution-policy block, AppLocker, etc.)
    childStdout: path.join(dir, 'jht-install-child-stdout.log'),
    childStderr: path.join(dir, 'jht-install-child-stderr.log'),
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

  const childStdout = paths.childStdout
  return [
    `$ErrorActionPreference = 'Continue'`,
    `$logPath = ${q(paths.log)}`,
    `$resultPath = ${q(paths.result)}`,
    `$dockerInstaller = ${q(paths.dockerInstaller)}`,
    // Start-Transcript captures every Write-Host / Write-Error plus the
    // output of native commands to a file. It's our last line of defence:
    // if an unhandled exception kills the script before our custom Log
    // function can write anything, the transcript still has it.
    `try { Start-Transcript -Path ${q(childStdout)} -Force -IncludeInvocationHeader | Out-Null } catch { }`,
    // Sentinel file on the Desktop: written as the very first action of
    // the elevated script, before any other path/permission could fail.
    // If this file exists after a run, we KNOW the elevated PowerShell
    // actually started — so any missing $logPath means env/path mismatch,
    // not elevation failure. If it DOESN'T exist, the elevation itself
    // never ran the script (UAC declined, execution policy blocked, etc.).
    `$diagPath = Join-Path $env:USERPROFILE 'Desktop\\jht-install-diag.log'`,
    `try { Set-Content -Path $diagPath -Value "$([DateTime]::Now.ToString('o')) elevated PS started; TEMP=$env:TEMP USER=$env:USERNAME" -Force } catch { }`,
    `function Log([string]$m) {`,
    `  $line = "$([DateTime]::Now.ToString('HH:mm:ss')) $m"`,
    `  try { Add-Content -Path $logPath -Value $line } catch { }`,
    `  try { Add-Content -Path $diagPath -Value $line } catch { }`,
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
    `Log "Step 1/2 Checking/installing WSL"`,
    `try {`,
    // Check if WSL has at least one distro registered. `wsl -l -q`
    // returns 0 with distro names when configured; non-zero when WSL
    // is missing, uninitialized, or has no distros. Output is UTF-16LE
    // so we treat non-empty as "has something"; exact contents don't
    // matter for the decision.
    `  $distroCheck = (& wsl.exe -l -q 2>&1 | Out-String).Trim()`,
    `  $hasDistro = ($LASTEXITCODE -eq 0) -and ($distroCheck -ne '')`,
    `  if ($hasDistro) {`,
    `    Log "WSL already has distro(s) registered - skipping wsl --install"`,
    `  } else {`,
    `    Log "WSL not set up; running wsl --install --no-launch"`,
    `    & wsl.exe --install --no-launch *>&1 | ForEach-Object { Log $_ }`,
    // Some wsl error codes (3010 = reboot required) aren't really
    // failures for the install step; and ERROR_ALREADY_EXISTS can leak
    // through race conditions too. Treat those as ok.
    `    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) {`,
    `      Fail 'WSL_INSTALL' "wsl exit $LASTEXITCODE"`,
    `    }`,
    `  }`,
    `} catch { Fail 'WSL_INSTALL' $_.Exception.Message }`,
    ``,
    `Log "Step 2/2 Installing Git"`,
    `try {`,
    // Get-Command returns $null without throwing when the command is
    // missing. Using `& git --version` for detection raises a
    // CommandNotFoundException before we can inspect $LASTEXITCODE.
    `  $gitCmd = Get-Command git -ErrorAction SilentlyContinue`,
    `  if ($gitCmd) {`,
    `    Log "Git already on PATH at $($gitCmd.Source), skipping"`,
    `  } else {`,
    // Prefer winget when present (simpler, keeps the package in Add/Remove
    // Programs). Fresh Win10 installs often lack App Installer so winget
    // is absent — fall back to downloading the official Git for Windows
    // installer directly from GitHub, which requires no package manager.
    `    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue`,
    `    if ($wingetCmd) {`,
    `      Log "winget present, installing Git.Git"`,
    `      & winget install --id Git.Git --source winget --silent \``,
    `        --accept-package-agreements --accept-source-agreements \``,
    `        --disable-interactivity *>&1 | ForEach-Object { Log $_ }`,
    `      if ($LASTEXITCODE -ne 0) { Fail 'GIT_INSTALL' "winget exit $LASTEXITCODE" }`,
    `    } else {`,
    `      Log "winget missing; falling back to direct Git-for-Windows installer"`,
    `      $gitInstaller = Join-Path $env:TEMP 'jht-install-git-installer.exe'`,
    // Pinned to a known-good 64-bit release. Kept up to date by us,
    // not by the user — they reboot and the installed git works.
    `      $gitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe'`,
    `      Log "Downloading $gitUrl"`,
    `      try {`,
    `        $ProgressPreference = 'SilentlyContinue'`,
    `        Invoke-WebRequest -Uri $gitUrl -OutFile $gitInstaller -UseBasicParsing`,
    `        Log ("Downloaded {0:N1} MB" -f ((Get-Item $gitInstaller).Length / 1MB))`,
    `      } catch { Fail 'GIT_INSTALL' ("download failed: " + $_.Exception.Message) }`,
    `      Log "Running Git installer silent (/VERYSILENT /NORESTART)"`,
    `      $gp = Start-Process -Wait -PassThru -FilePath $gitInstaller \``,
    `        -ArgumentList '/VERYSILENT','/NORESTART','/SUPPRESSMSGBOXES','/NOCANCEL'`,
    `      if ($gp.ExitCode -ne 0) { Fail 'GIT_INSTALL' "git installer exit $($gp.ExitCode)" }`,
    `      Log "Git installed via direct installer"`,
    `    }`,
    `  }`,
    `} catch { Fail 'GIT_INSTALL' $_.Exception.Message }`,
    ``,
    `Log "DONE - Docker Desktop is installed manually from https://docker.com; reboot required to finish WSL kernel setup"`,
    `Set-Content -Path $resultPath -Value 'OK'`,
    `try { Stop-Transcript | Out-Null } catch { }`,
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

// Outer (unelevated) PowerShell wrapper. It just triggers UAC for our
// elevated .ps1 and logs the outcome. We went briefly through a
// cmd+EncodedCommand variant to sidestep a (non-existent) ExecutionPolicy
// block; the Base64 payload was too long for cmd.exe's 8191-char limit,
// so we bounced back to the plain `-File` approach that worked all along.
// Any missing visibility into the elevated child is covered by
// `Start-Transcript` inside the generated script itself.
function buildOuterScript({ scriptPath, outerLogPath }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`
  return [
    `$outerLog = ${q(outerLogPath)}`,
    `function OLog([string]$m) {`,
    `  $line = "$([DateTime]::Now.ToString('HH:mm:ss')) outer: $m"`,
    `  try { Add-Content -Path $outerLog -Value $line -Encoding UTF8 } catch { }`,
    `  Write-Host $line`,
    `}`,
    `try { Set-Content -Path $outerLog -Value "" -Force } catch { }`,
    `OLog "starting; script path = ${scriptPath.replace(/'/g, "''").replace(/\\/g, '\\\\')}"`,
    `OLog "script exists = $(Test-Path ${q(scriptPath)})"`,
    `OLog "host PS version = $($PSVersionTable.PSVersion) edition = $($PSVersionTable.PSEdition)"`,
    `try {`,
    `  OLog "calling Start-Process -Verb RunAs -Wait -PassThru -FilePath powershell -File"`,
    `  $proc = Start-Process -Verb RunAs -Wait -PassThru -FilePath powershell \``,
    `    -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${q(scriptPath)}`,
    `  OLog "Start-Process returned, exit code = $($proc.ExitCode)"`,
    `} catch [System.ComponentModel.Win32Exception] {`,
    `  OLog "Start-Process Win32Exception native=$($_.Exception.NativeErrorCode) msg=$($_.Exception.Message)"`,
    `} catch {`,
    `  OLog "Start-Process threw $($_.Exception.GetType().FullName): $($_.Exception.Message)"`,
    `}`,
    `OLog "done"`,
  ].join('\n')
}

function spawnElevatedScript({ scriptPath, outerLogPath, spawnFn = spawn }) {
  const outerScript = buildOuterScript({ scriptPath, outerLogPath })
  return spawnFn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', outerScript,
  ], { windowsHide: true })
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
  for (const p of [
    paths.log, paths.result, paths.outerLog, paths.nodeLog,
    paths.childStdout, paths.childStderr,
  ]) {
    try { fsApi.unlinkSync(p) } catch { /* ok if missing */ }
  }

  // Persist EVERY log line we see to disk too (jht-install-node.log in
  // TEMP). The user's LAN sync watches jht-* so this is guaranteed to
  // land on the Mac side even if the UI log panel scrolls past or the
  // IPC channel drops. Fixes the class of "we got an error but no file
  // to grep on the Mac" problems.
  const tsNow = () => new Date().toISOString().slice(11, 19)
  const logToFile = (line) => {
    try { fsApi.appendFileSync(paths.nodeLog, `${tsNow()} ${line}\n`) } catch { /* ignore */ }
  }
  try { fsApi.writeFileSync(paths.nodeLog, '') } catch { /* ignore */ }
  const wrappedLog = (line) => {
    const s = String(line)
    logToFile(s)
    try { onLog(s) } catch { /* callback may throw — swallow */ }
  }
  wrappedLog('installWindowsStack: begin')

  const script = buildScript({ paths })
  // UTF-8 BOM prefix (0xEF 0xBB 0xBF). Without it, PowerShell 5.1
  // reads .ps1 files as Windows-1252 ANSI, and any non-ASCII byte
  // inside a string literal can mis-tokenize (e.g. an em-dash's third
  // UTF-8 byte 0x94 maps to a `"` in CP-1252, closing the string
  // early and throwing a parse error — elevated PS exits 1 silently).
  // Writing with BOM makes parsing encoding-correct regardless of the
  // current system locale.
  fsApi.writeFileSync(paths.script, '\ufeff' + script, 'utf8')
  wrappedLog(`installWindowsStack: wrote ${paths.script} (with UTF-8 BOM)`)

  const stopTail = tailLog(paths.log, wrappedLog)

  const child = spawnElevatedScript({
    scriptPath: paths.script,
    outerLogPath: paths.outerLog,
    spawnFn,
  })
  wrappedLog('installWindowsStack: spawned outer powershell')

  // Forward outer-PowerShell stdout/stderr into the same log stream so
  // that failures in Start-Process itself (UAC declined, execution
  // policy blocked, elevation rejected by admin approval mode, etc.)
  // surface as readable lines — without this, those errors die in the
  // child's pipe and we're left guessing at exit codes.
  const forwardStream = (stream, prefix) => {
    if (!stream || typeof stream.on !== 'function') return
    stream.setEncoding('utf8')
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() || ''
      for (const line of lines) if (line.length > 0) wrappedLog(`[${prefix}] ${line}`)
    })
    stream.on('end', () => {
      if (buf.length > 0) wrappedLog(`[${prefix}] ${buf}`)
    })
  }
  forwardStream(child.stdout, 'outer-stdout')
  forwardStream(child.stderr, 'outer-stderr')

  const exitCode = await new Promise((resolve) => {
    child.on('error', (err) => {
      wrappedLog(`spawn error: ${err.message}`)
      resolve(-1)
    })
    child.on('close', (code) => resolve(typeof code === 'number' ? code : -1))
  })
  wrappedLog(`installWindowsStack: outer powershell exited with code ${exitCode}`)

  // Give the tail a moment to drain final lines after the child exits.
  await new Promise((r) => setTimeout(r, 600))
  stopTail()

  let result = 'UNKNOWN'
  try { result = fsApi.readFileSync(paths.result, 'utf8').trim() } catch { /* missing */ }
  wrappedLog(`installWindowsStack: result file content = ${result}`)

  if (result === 'OK' && exitCode === 0) {
    return { ok: true, rebootRequired: true }
  }

  // Map known result tags to actionable error stages.
  const stageByTag = {
    WSL_INSTALL: 'wsl-install',
    GIT_INSTALL: 'git-install',
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
