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

  return [
    `$ErrorActionPreference = 'Continue'`,
    `$logPath = ${q(paths.log)}`,
    `$resultPath = ${q(paths.result)}`,
    `$dockerInstaller = ${q(paths.dockerInstaller)}`,
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
    `Log "Step 1/2 Installing WSL (--no-launch, distro init deferred to reboot)"`,
    `try {`,
    `  & wsl.exe --install --no-launch *>&1 | ForEach-Object { Log $_ }`,
    `  if ($LASTEXITCODE -ne 0) { Fail 'WSL_INSTALL' "wsl exit $LASTEXITCODE" }`,
    `} catch { Fail 'WSL_INSTALL' $_.Exception.Message }`,
    ``,
    `Log "Step 2/2 Installing Git (winget, silent, --accept-package-agreements)"`,
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
    `Log "DONE — Docker Desktop is installed manually from https://docker.com; reboot required to finish WSL kernel setup"`,
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

// The outer (unelevated) PowerShell. It's generated with its own file
// logger (`jht-install-outer.log` in TEMP) so we can see every step of
// the elevation dance — the call to Start-Process, its return / exit
// code, any native exception.
//
// Elevation strategy: we launch `cmd.exe /c powershell.exe
// -EncodedCommand <b64> > childStdout 2> childStderr` elevated.
// Rationale for two design choices:
//  1. `-EncodedCommand` (instead of `-File script.ps1`): PowerShell's
//     Execution Policy applies to script FILES, not to commands passed
//     inline. Encoded inline commands run even under Restricted/
//     AllSigned policies set by Group Policy. AppLocker's "Script
//     Rules" also target files on disk; encoded commands sidestep them.
//  2. `cmd.exe /c ... > path 2> path`: Start-Process -Verb RunAs opens
//     the elevated child in a detached console with no pipe back to us,
//     so any stderr from the elevated PowerShell dies on screen close.
//     cmd.exe's native redirection captures BOTH streams to files we
//     can read, no matter whether the script loaded, parsed, or ran.
function buildOuterScript({
  scriptContent,
  scriptPath,
  childStdoutPath,
  childStderrPath,
  outerLogPath,
}) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`
  // PowerShell -EncodedCommand requires UTF-16LE Base64. Produce it on
  // the Node side so the outer shell only has to hand it off.
  const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64')
  return [
    `$outerLog = ${q(outerLogPath)}`,
    `function OLog([string]$m) {`,
    `  $line = "$([DateTime]::Now.ToString('HH:mm:ss')) outer: $m"`,
    `  try { Add-Content -Path $outerLog -Value $line -Encoding UTF8 } catch { }`,
    `  Write-Host $line`,
    `}`,
    `try { Set-Content -Path $outerLog -Value "" -Force } catch { }`,
    `OLog "starting; script path = ${scriptPath.replace(/'/g, "''").replace(/\\/g, '\\\\')}"`,
    `OLog "host PS version = $($PSVersionTable.PSVersion) edition = $($PSVersionTable.PSEdition)"`,
    `OLog "encoded command length = ${encoded.length} chars (UTF-16LE Base64)"`,
    // Wipe previous child logs so a stale run doesn't confuse the read.
    `try { Remove-Item -LiteralPath ${q(childStdoutPath)} -Force -ErrorAction SilentlyContinue } catch { }`,
    `try { Remove-Item -LiteralPath ${q(childStderrPath)} -Force -ErrorAction SilentlyContinue } catch { }`,
    // Build the cmd /c command line. Note: cmd's redirection sees the
    // > and 2> as a single string, so we quote the target paths.
    `$childStdout = ${q(childStdoutPath)}`,
    `$childStderr = ${q(childStderrPath)}`,
    `$encoded = '${encoded}'`,
    `$cmdLine = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + $encoded + ' > "' + $childStdout + '" 2> "' + $childStderr + '"'`,
    `OLog "cmd line assembled ($($cmdLine.Length) chars)"`,
    `try {`,
    `  OLog "calling Start-Process -Verb RunAs -Wait -PassThru cmd.exe /c ..."`,
    `  $proc = Start-Process -Verb RunAs -Wait -PassThru -FilePath 'cmd.exe' -ArgumentList '/c', $cmdLine`,
    `  OLog "Start-Process returned, exit code = $($proc.ExitCode)"`,
    `} catch [System.ComponentModel.Win32Exception] {`,
    `  OLog "Start-Process Win32Exception native=$($_.Exception.NativeErrorCode) msg=$($_.Exception.Message)"`,
    `} catch {`,
    `  OLog "Start-Process threw $($_.Exception.GetType().FullName): $($_.Exception.Message)"`,
    `}`,
    // Surface a sample of the child's stderr into our outer log too, so
    // if the user only reads outer.log we still get the root cause.
    `try {`,
    `  if (Test-Path -LiteralPath $childStderr) {`,
    `    $tail = (Get-Content -LiteralPath $childStderr -TotalCount 20 -ErrorAction SilentlyContinue) -join " | "`,
    `    if ($tail) { OLog "child stderr head: $tail" }`,
    `  }`,
    `} catch { }`,
    `OLog "done"`,
  ].join('\n')
}

function spawnElevatedScript({
  scriptContent,
  scriptPath,
  childStdoutPath,
  childStderrPath,
  outerLogPath,
  spawnFn = spawn,
}) {
  const outerScript = buildOuterScript({
    scriptContent, scriptPath, childStdoutPath, childStderrPath, outerLogPath,
  })
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
  fsApi.writeFileSync(paths.script, script, 'utf8')
  wrappedLog(`installWindowsStack: wrote ${paths.script}`)

  const stopTail = tailLog(paths.log, wrappedLog)

  const child = spawnElevatedScript({
    scriptContent: script,
    scriptPath: paths.script,
    childStdoutPath: paths.childStdout,
    childStderrPath: paths.childStderr,
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
