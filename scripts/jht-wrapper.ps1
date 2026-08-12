# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  jht — host-side dispatcher (PowerShell port di jht-wrapper.sh)          ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Wrapper PowerShell sottile che instrada i comandi:                      ║
# ║                                                                          ║
# ║    LIFECYCLE   → docker compose / docker logs / docker inspect           ║
# ║    OPERATIVITA → docker exec -it jht node /app/cli/bin/jht.js <args>     ║
# ║                                                                          ║
# ║  Niente Node, Python o tmux sull'host. Niente socket Docker dentro al    ║
# ║  container. Il CLI Node gira nel container long-running `jht` e ci       ║
# ║  parla via `docker exec`.                                                ║
# ║                                                                          ║
# ║  Auto-up: se il container `jht` non e' attivo quando l'utente lancia un  ║
# ║  comando di operativita', lo si avvia automaticamente via compose.       ║
# ║                                                                          ║
# ║  Override via env:                                                       ║
# ║    JHT_CONTAINER_NAME=jht                                                ║
# ║    JHT_RUNTIME_DIR=$env:LOCALAPPDATA\Job Hunter Team\host-runtime        ║
# ║    JHT_COMPOSE_FILE=$JHT_RUNTIME_DIR\docker-compose.yml                  ║
# ║                                                                          ║
# ║  Differenze vs jht-wrapper.sh (per design Windows-native):               ║
# ║    - NO ensure_bind_owner: Docker Desktop su Windows gestisce volume     ║
# ║      permissions via Hyper-V/WSL2 namespace, non c'e' chown da fare.     ║
# ║    - NO host-setup.sh invocation: swap config e' Linux-only, lang/tz     ║
# ║      picker resta gestito dal wizard Node dentro al container.           ║
# ║                                                                          ║
# ║  Riferimento design: docs/internal/ops/vps.md                                ║
# ╚══════════════════════════════════════════════════════════════════════════╝

$ErrorActionPreference = 'Stop'

# Capacita' letta dal client desktop prima di invocare `upgrade --check --json`.
# I wrapper storici non la espongono e richiedono il bootstrap temporaneo del
# wrapper production con WrapperPath ancorato al comando host originale.
$JHT_UPGRADE_PROTOCOL = 1
$JHT_HOST_RUNTIME_PROTOCOL = 1

$Container   = if ($env:JHT_CONTAINER_NAME) { $env:JHT_CONTAINER_NAME } else { 'jht' }
$LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
if (-not $LocalAppData) { throw 'LOCALAPPDATA non disponibile: runtime host rifiutato' }
$RuntimeDir  = if ($env:JHT_RUNTIME_DIR) { $env:JHT_RUNTIME_DIR } else { Join-Path $LocalAppData 'Job Hunter Team\host-runtime' }
$ComposeFile = if ($env:JHT_COMPOSE_FILE)   { $env:JHT_COMPOSE_FILE }   else { Join-Path $RuntimeDir 'docker-compose.yml' }
$RuntimeManifest = Join-Path $RuntimeDir '.runtime-integrity'
$NodeEntry   = if ($env:JHT_NODE_ENTRY)     { $env:JHT_NODE_ENTRY }     else { '/app/cli/bin/jht.js' }
$RawBaseOverride = if ($env:JHT_RAW_BASE) { $env:JHT_RAW_BASE.TrimEnd('/') } else { '' }
$ReleaseRef = if ($env:JHT_BRANCH) { $env:JHT_BRANCH } else { 'production' }
$WrapperPath = if ($env:JHT_WRAPPER_PATH)   { $env:JHT_WRAPPER_PATH }   else { $PSCommandPath }
$GameControlDir = if ($env:JHT_GAME_CONTROL_DIR) { $env:JHT_GAME_CONTROL_DIR } else { Join-Path $env:APPDATA 'Godot\app_userdata\Job Hunter Team\client' }
$GameExecutable = if ($env:JHT_GAME_EXECUTABLE) { $env:JHT_GAME_EXECUTABLE } else { Join-Path $env:LOCALAPPDATA 'Programs\Job Hunter Team\job-hunter-team.exe' }
$JhtHome = if ($env:JHT_HOME_HOST) { $env:JHT_HOME_HOST } else { Join-Path $env:USERPROFILE '.jht' }
. (Join-Path $PSScriptRoot 'windows-private-acl.ps1')

# Carica la host env (scritta da install.ps1 / setup wizard: JHT_HOST_TYPE=local|vps).
# Formato file: VAR=value per riga, ignora # e righe vuote.
$HostEnvFile = if ($env:JHT_HOST_ENV_FILE) { $env:JHT_HOST_ENV_FILE } else { Join-Path $env:USERPROFILE '.jht\host.env' }
$AllowedHostEnvNames = @('JHT_HOST_TYPE', 'JHT_LANG', 'JHT_USER_TZ')
if (Test-Path $HostEnvFile) {
  Get-Content $HostEnvFile | ForEach-Object {
    if ($_ -match '^\s*#') { return }
    if ($_ -match '^\s*$') { return }
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') {
      $name  = $Matches[1]
      $value = $Matches[2].Trim('"').Trim("'")
      if ($AllowedHostEnvNames -notcontains $name) { return }
      Set-Item -Path "env:$name" -Value $value -ErrorAction SilentlyContinue
    }
  }
}
if (-not $env:JHT_HOST_TYPE) { $env:JHT_HOST_TYPE = 'unknown' }
if (-not $env:JHT_LANG)      { $env:JHT_LANG = 'en' }
if (-not $env:JHT_USER_TZ)   { $env:JHT_USER_TZ = 'UTC' }

# Colori (PowerShell gestisce ANSI nativo dal terminale moderno).
function Write-Err  { param([string]$Msg) Write-Host "error: $Msg" -ForegroundColor Red }
function Write-Warn { param([string]$Msg) Write-Host "warn:  $Msg" -ForegroundColor Yellow }
function Write-Info { param([string]$Msg) Write-Host $Msg -ForegroundColor DarkGray }

function Get-AttestedRawBase {
  if ($RawBaseOverride) { return $RawBaseOverride }
  try {
    $metadata = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/leopu00/job-hunter-team/commits/$ReleaseRef"
    $sha = [string]$metadata.sha
    if ($sha -notmatch '^[0-9a-fA-F]{40}$') { throw 'invalid release commit' }
    return "https://raw.githubusercontent.com/leopu00/job-hunter-team/$sha"
  } catch { throw 'release ref cannot be resolved to an immutable commit' }
}

function Test-ProtectedRuntimeNode {
  param([string]$Path, [switch]$Directory)
  try {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($Directory -and -not $item.PSIsContainer) { return $false }
    if (-not $Directory -and $item.PSIsContainer) { return $false }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $owner = (Get-Acl -LiteralPath $Path).Owner
    $ownerSid = ([Security.Principal.NTAccount]$owner).Translate([Security.Principal.SecurityIdentifier]).Value
    if ($ownerSid -ne $current.User.Value) { return $false }
    return $true
  } catch { return $false }
}

function Test-RuntimeAncestorsWithoutReparsePoint {
  param([string]$Path)
  try {
    $current = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    while ($current) {
      if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
      $parent = $current.Parent
      if (-not $parent -or $parent.FullName -eq $current.FullName) { break }
      $current = $parent
    }
    return $true
  } catch { return $false }
}

function Test-RuntimeDirectoryAcl {
  try {
    $acl = Get-Acl -LiteralPath $RuntimeDir -ErrorAction Stop
    if (-not $acl.AreAccessRulesProtected) { return $false }
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach ($rule in $acl.Access) {
      if ($rule.AccessControlType -ne 'Allow') { continue }
      $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
      $writes = $rights -band ([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Modify -bor [Security.AccessControl.FileSystemRights]::FullControl)
      if (-not $writes) { continue }
      $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if ($sid -notin @($currentSid, 'S-1-5-18', 'S-1-5-32-544')) { return $false }
    }
    return $true
  } catch { return $false }
}


function Test-RuntimePathAuthority {
  try {
    $runtime = [IO.Path]::GetFullPath($RuntimeDir).TrimEnd('\', '/')
    $compose = [IO.Path]::GetFullPath($ComposeFile)
    $legacy = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.jht')).TrimEnd('\', '/')
    $userData = if ($env:JHT_USER_DIR_HOST) { $env:JHT_USER_DIR_HOST } else { Join-Path $env:USERPROFILE 'Documents\Job Hunter Team' }
    $userData = [IO.Path]::GetFullPath($userData).TrimEnd('\', '/')
    if ($runtime.Equals($legacy, [StringComparison]::OrdinalIgnoreCase) -or $runtime.StartsWith($legacy + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    if ($runtime.Equals($userData, [StringComparison]::OrdinalIgnoreCase) -or $runtime.StartsWith($userData + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    if ($compose -ne [IO.Path]::Combine($runtime, 'docker-compose.yml')) { return $false }
    $wrapper = [IO.Path]::GetFullPath($WrapperPath)
    if ($wrapper.Equals($legacy, [StringComparison]::OrdinalIgnoreCase) -or $wrapper.StartsWith($legacy + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    if ($wrapper.Equals($userData, [StringComparison]::OrdinalIgnoreCase) -or $wrapper.StartsWith($userData + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    return $true
  } catch { return $false }
}

function Write-RuntimeManifest {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ComposeFile).Hash.ToLowerInvariant()
  $wrapperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $WrapperPath).Hash.ToLowerInvariant()
  $temp = "$RuntimeManifest.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
  [IO.File]::WriteAllText($temp, "version=1`ndocker-compose.yml=$hash`njht-wrapper.ps1=$wrapperHash`n", [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temp -Destination $RuntimeManifest -Force
}

function Test-RuntimeBundleTrusted {
  if (-not (Test-RuntimePathAuthority)) { return $false }
  if (-not (Test-RuntimeAncestorsWithoutReparsePoint $RuntimeDir)) { return $false }
  if (-not (Test-RuntimeAncestorsWithoutReparsePoint $WrapperPath)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $RuntimeDir -Directory)) { return $false }
  if (-not (Test-RuntimeDirectoryAcl)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $ComposeFile)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $RuntimeManifest)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $WrapperPath)) { return $false }
  try {
    $values = ConvertFrom-StringData (Get-Content -LiteralPath $RuntimeManifest -Raw)
    if ($values.version -ne '1') { return $false }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $ComposeFile).Hash.ToLowerInvariant()
    $wrapperActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $WrapperPath).Hash.ToLowerInvariant()
    if ($values.'docker-compose.yml' -ne $actual -or $values.'jht-wrapper.ps1' -ne $wrapperActual) { return $false }
    if (-not (Select-String -LiteralPath $WrapperPath -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) { return $false }
    if (-not (Select-String -LiteralPath $ComposeFile -Pattern '^\s*-\s*jht-runtime-mask:/jht_home/runtime(?:\s|$)' -Quiet)) { return $false }
    return $true
  } catch { return $false }
}

function Install-ProtectedRuntimeFromRelease {
  if (Test-Path -LiteralPath $RuntimeDir) { return $false }
  if (-not (Test-RuntimePathAuthority)) { return $false }
  $temp = $null
  $wrapperTemp = $null
  try {
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    $acl = Get-Acl -LiteralPath $RuntimeDir
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      [Security.Principal.WindowsIdentity]::GetCurrent().User,
      'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $RuntimeDir -AclObject $acl
    $releaseBase = Get-AttestedRawBase
    $temp = Join-Path $RuntimeDir ('.compose-' + [guid]::NewGuid().ToString('N'))
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/docker-compose.yml" -OutFile $temp
    if (-not (Select-String -LiteralPath $temp -Pattern '^\s*-\s*jht-runtime-mask:/jht_home/runtime(?:\s|$)' -Quiet)) { throw 'release compose lacks protected runtime mask' }
    Move-Item -LiteralPath $temp -Destination $ComposeFile
    if (-not (Select-String -LiteralPath $WrapperPath -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) {
      if ($env:JHT_ALLOW_LEGACY_WRAPPER_MIGRATION -ne '1') { throw 'legacy wrapper migration is not authorized' }
      $wrapperTemp = Join-Path (Split-Path -LiteralPath $WrapperPath -Parent) ('.jht-wrapper-' + [guid]::NewGuid().ToString('N') + '.ps1')
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/scripts/jht-wrapper.ps1" -OutFile $wrapperTemp
      [scriptblock]::Create((Get-Content -LiteralPath $wrapperTemp -Raw)) | Out-Null
      if (-not (Select-String -LiteralPath $wrapperTemp -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) { throw 'release wrapper lacks protected runtime protocol' }
      Move-Item -LiteralPath $wrapperTemp -Destination $WrapperPath -Force
    }
    Write-RuntimeManifest
    return (Test-RuntimeBundleTrusted)
  } catch {
    if ($temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
    if ($wrapperTemp) { Remove-Item -LiteralPath $wrapperTemp -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $ComposeFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $RuntimeManifest -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $RuntimeDir -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Assert-TrustedRuntime {
  if (-not (Test-Path -LiteralPath $RuntimeDir)) {
    if (-not (Install-ProtectedRuntimeFromRelease)) { throw 'protected host runtime bootstrap failed' }
  }
  if (-not (Test-RuntimeBundleTrusted)) { throw 'untrusted host runtime path, owner, reparse point or SHA-256' }
}

# Deterministic, side-effect-free seam for the Windows security regression.
# It exits before Docker, network, manifests or filesystem mutation.
if ($env:JHT_RUNTIME_AUTHORITY_SELFTEST -eq '1') {
  if (Test-RuntimePathAuthority) { exit 0 }
  exit 1
}

# ── Verifiche pre-flight ──────────────────────────────────────────────────
function Require-PrivateJhtHomeAcl {
  if (-not (Test-PrivateJhtHomeAcl -Path $JhtHome)) {
    throw "JHT_HOME ACL is not owner-only: $JhtHome"
  }
}

function Require-Docker {
  Require-PrivateJhtHomeAcl
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err "docker non trovato nel PATH. Installa Docker Desktop per Windows."
    exit 127
  }
  $null = docker info 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Err "Docker daemon non risponde. Avvia Docker Desktop."
    exit 1
  }
}

function Require-ComposeFile {
  Require-PrivateJhtHomeAcl
  try { Assert-TrustedRuntime } catch { Write-Err $_.Exception.Message; exit 1 }
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments)] $Args)
  if (-not (Test-PrivateJhtHomeAcl -Path $JhtHome)) { throw "JHT_HOME ACL is not owner-only: $JhtHome" }
  Assert-TrustedRuntime
  # Docker Desktop Windows accetta forward-slash o backslash. project-directory
  # punta al runtime dir per bind-mount relativi (anche se compose qui e'
  # image-only, lasciamo per simmetria col bash wrapper).
  & docker compose -f $ComposeFile --project-directory $RuntimeDir @Args
}

function Test-DockerReachable {
  # Docker c'e' ED e' raggiungibile? A differenza di Require-Docker NON esce:
  # serve a DECIDERE, non a pretendere.
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  $null = docker info 2>&1
  return ($LASTEXITCODE -eq 0)
}

function Write-LocalHelp {
  # L'aiuto completo vive nel CLI DENTRO il container: senza container si
  # stampa questo, che elenca cio' che il wrapper sa fare da se' sull'host.
  @'
jht - Job Hunter Team

  Comandi dell'host (funzionano da qui):
    jht up                 avvia il container del team
    jht down               lo ferma
    jht restart            lo riavvia
    jht status             stato di container e team
    jht logs [-f]          log del container
    jht upgrade            aggiorna all'immagine piu' recente
    jht setup              installazione guidata
    jht download --os X    scarica l'app desktop per un sistema
    jht game start|stop    avvia o ferma il videogioco
    jht gui open           apre l'interfaccia grafica
    jht shell              shell dentro il container

  Tutti gli altri comandi (positions, stats, team, providers, cron,
  working-hours, cloud...) girano DENTRO il container: per il loro aiuto
  serve il container attivo.

      jht up ; jht --help

'@ | Write-Host
}

function Invoke-HelpWithoutDocker {
  param([Parameter(ValueFromRemainingArguments)] $HelpArgs)
  if ((Test-DockerReachable) -and (Test-ContainerUp)) {
    & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry @HelpArgs
    return $LASTEXITCODE
  }
  Write-LocalHelp
  return 0
}

function Test-ContainerUp {
  $running = & docker ps --format '{{.Names}}' 2>$null
  return ($running -split "`n") -contains $Container
}

function Ensure-Up {
  if (-not (Test-ContainerUp)) {
    Write-Info "Container '$Container' non attivo, lo avvio..."
    Invoke-Compose up -d
    # Attendi che il container sia in stato running.
    $tries = 20
    while (-not (Test-ContainerUp)) {
      $tries -= 1
      if ($tries -le 0) {
        Write-Err "Container '$Container' non e' partito entro 10s. Controlla 'jht logs'."
        exit 1
      }
      Start-Sleep -Milliseconds 500
    }
  }
}

# ── Client desktop nativo (mai Docker) ───────────────────────────────────
function Read-GameJson {
  param([string]$Path)
  try {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
  } catch { return $null }
}

function Write-GameJsonAtomic {
  param([string]$Path, [hashtable]$Value)
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $temp = Join-Path $parent ('.' + (Split-Path -Leaf $Path) + '.tmp-' + [guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($temp, (($Value | ConvertTo-Json -Compress) + "`n"), [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $Path) {
      [IO.File]::Replace($temp, $Path, $null)
    } else {
      [IO.File]::Move($temp, $Path)
    }
    return $true
  } catch {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Get-LiveGameState {
  $statePath = Join-Path $GameControlDir 'state.json'
  $state = Read-GameJson $statePath
  $statePid = 0
  if (-not $state -or -not $state.instance_id -or
      -not [int]::TryParse([string]$state.pid, [ref]$statePid) -or $statePid -le 0) {
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue }
    return $null
  }
  try {
    $process = Get-Process -Id $statePid -ErrorAction Stop
    if ($process.HasExited) { throw 'stale state' }
    $stateExecutable = [IO.Path]::GetFullPath([string]$state.executable)
    $processExecutable = [string]$process.Path
    if (-not $processExecutable) { $processExecutable = [string]$process.MainModule.FileName }
    if (-not $processExecutable -or
        [IO.Path]::GetFullPath($processExecutable) -ine $stateExecutable) {
      throw 'stale state or recycled pid'
    }
    $processStarted = [DateTimeOffset]::new($process.StartTime.ToUniversalTime()).ToUnixTimeSeconds()
    # L'EXE embedded e grande e su hardware vecchio puo impiegare diversi
    # secondi prima che l'autoload pubblichi state.json. Trenta secondi resta
    # molto sotto qualunque riuso credibile dello stesso PID+stesso binario.
    if ([Math]::Abs($processStarted - [double]$state.started_at) -gt 30) {
      throw 'stale state or recycled pid'
    }
    return $state
  } catch {
    # Rimuove soltanto lo snapshot appena letto. Le request sono targettizzate
    # al nonce e non possono colpire un eventuale nuovo processo.
    $current = Read-GameJson $statePath
    if ($current -and $current.instance_id -eq $state.instance_id) {
      Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }
    return $null
  }
}

function Remove-GameRequestIfOwned {
  param([string]$Path, [string]$RequestId, [string]$InstanceId)
  $request = Read-GameJson $Path
  if ($request -and $request.request_id -eq $RequestId -and
      $request.target_instance_id -eq $InstanceId) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

function Resolve-GameExecutable {
  if ($env:JHT_GAME_EXECUTABLE) { return $env:JHT_GAME_EXECUTABLE }
  $launcher = Read-GameJson (Join-Path $GameControlDir 'launcher.json')
  if ($launcher -and $launcher.executable -and
      (Test-Path -LiteralPath ([string]$launcher.executable) -PathType Leaf)) {
    return [string]$launcher.executable
  }
  $installDir = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Job Hunter Team' -Name InstallDir -ErrorAction SilentlyContinue).InstallDir
  if ($installDir) {
    $installed = Join-Path $installDir 'job-hunter-team.exe'
    if (Test-Path -LiteralPath $installed -PathType Leaf) { return $installed }
  }
  return $GameExecutable
}

function Remove-GameLaunchTask {
  param([string]$TaskName)
  if (-not $TaskName) { return }
  try {
    $service = New-Object -ComObject 'Schedule.Service'
    $service.Connect()
    $service.GetFolder('\').DeleteTask($TaskName, 0)
  } catch { }
}

function Start-GameProcess {
  param([string]$Executable, [string]$Nonce)
  $controlArg = $GameControlDir.Replace('"', '')
  $arguments = "-- --jht-instance-id=$Nonce --jht-control-dir=`"$controlArg`""
  if ([Diagnostics.Process]::GetCurrentProcess().SessionId -gt 0) {
    $process = Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru -ErrorAction Stop
    return @{ Pid = $process.Id; TaskName = '' }
  }

  # OpenSSH/WinRM girano in Session 0: Start-Process li' crea un processo
  # invisibile. Un task InteractiveToken usa invece la sessione desktop gia'
  # autenticata dello stesso utente, senza password e senza elevazione.
  $interactive = Get-Process explorer -ErrorAction SilentlyContinue |
    Where-Object { $_.SessionId -gt 0 } | Select-Object -First 1
  if (-not $interactive) { throw 'nessuna sessione desktop interattiva disponibile' }
  $taskName = 'Job Hunter Team CLI Launch ' + $Nonce
  $service = New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $root = $service.GetFolder('\')
  $definition = $service.NewTask(0)
  $definition.RegistrationInfo.Description = 'One-shot launch bridge for jht game start'
  $definition.Principal.UserId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $definition.Principal.LogonType = 3 # TASK_LOGON_INTERACTIVE_TOKEN
  $definition.Principal.RunLevel = 0  # TASK_RUNLEVEL_LUA
  $definition.Settings.Enabled = $true
  $definition.Settings.AllowDemandStart = $true
  $definition.Settings.DisallowStartIfOnBatteries = $false
  $definition.Settings.StopIfGoingOnBatteries = $false
  $definition.Settings.ExecutionTimeLimit = 'PT0S'
  $action = $definition.Actions.Create(0) # TASK_ACTION_EXEC
  $action.Path = $Executable
  $action.Arguments = $arguments
  $action.WorkingDirectory = Split-Path -Parent $Executable
  try {
    $registered = $root.RegisterTaskDefinition(
      $taskName, $definition, 6, $definition.Principal.UserId, $null, 3, $null)
    $null = $registered.Run($null)
  } catch {
    Remove-GameLaunchTask $taskName
    throw
  }
  # EnginePID non e' un contratto sul PID dell'action in tutte le versioni
  # di Task Scheduler. Il PID autorevole arrivera' da state.json col nonce.
  return @{ Pid = 0; TaskName = $taskName }
}

function Remove-GameStartLockIfOwned {
  param([string]$LockPath, [int]$OwnerPid)
  $ownerPath = Join-Path $LockPath 'owner.pid'
  $current = (Get-Content -LiteralPath $ownerPath -Raw -ErrorAction SilentlyContinue)
  if ($current -and $current.Trim() -eq [string]$OwnerPid) {
    Remove-Item -LiteralPath $LockPath -Force -Recurse -ErrorAction SilentlyContinue
  }
}

function Stop-NewGameProcessCooperatively {
  param([int]$ProcessId, [string]$Nonce)
  $state = Get-LiveGameState
  if ($state -and $state.instance_id -eq $Nonce) {
    $null = Invoke-GameRequest 'stop'
    return
  }
  if ($ProcessId -le 0) { return }
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($process) {
    $null = $process.CloseMainWindow()
    try { $process.WaitForExit(5000) } catch { }
  }
}

function Show-GameHelp {
  Write-Host 'Usage: jht game <start|stop|status|restart|background>'
  Write-Host ''
  Write-Host '  start    Avvia il client; se e gia attivo conserva lo stesso PID'
  Write-Host '  stop     Chiude il client in modo cooperativo; il team continua'
  Write-Host '  status   Mostra running/stopped, PID e instance_id'
  Write-Host '  restart  Riavvia il client in modo cooperativo; il team continua'
  Write-Host '  background  Minimizza un client attivo senza fermarlo'
}

function Show-GuiHelp {
  Write-Host 'Usage: jht gui open'
  Write-Host ''
  Write-Host '  open     Avvia il client se necessario e porta la finestra in primo piano'
}

function Invoke-GameStart {
  $state = Get-LiveGameState
  if ($state) {
    Write-Host "game running pid=$($state.pid) instance=$($state.instance_id)"
    return 0
  }
  $executable = Resolve-GameExecutable
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    Write-Err "client non trovato: $executable (override: JHT_GAME_EXECUTABLE)"
    return 1
  }

  New-Item -ItemType Directory -Force -Path $GameControlDir | Out-Null
  $lock = Join-Path $GameControlDir 'start.lock'
  $acquired = $false
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline) {
    $state = Get-LiveGameState
    if ($state) {
      Write-Host "game running pid=$($state.pid) instance=$($state.instance_id)"
      return 0
    }
    try {
      New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null
      [IO.File]::WriteAllText((Join-Path $lock 'owner.pid'), [string]$PID)
      $acquired = $true
      break
    } catch {
      $item = Get-Item -LiteralPath $lock -ErrorAction SilentlyContinue
      $ownerPath = Join-Path $lock 'owner.pid'
      $ownerText = Get-Content -LiteralPath $ownerPath -Raw -ErrorAction SilentlyContinue
      $ownerPid = 0
      if ($ownerText -and [int]::TryParse($ownerText.Trim(), [ref]$ownerPid)) {
        if (-not (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)) {
          Remove-GameStartLockIfOwned $lock $ownerPid
          continue
        }
      } elseif ($item -and $item.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddSeconds(-2)) {
        # Crash fra mkdir e scrittura owner.pid: directory senza proprietario.
        Remove-Item -LiteralPath $lock -Force -Recurse -ErrorAction SilentlyContinue
        continue
      }
      Start-Sleep -Milliseconds 200
    }
  }
  if (-not $acquired) { Write-Err 'timeout acquisizione lock di avvio del client'; return 1 }

  $launchTaskName = ''
  $launchedProcessId = 0
  $launchStartedUtc = [DateTime]::UtcNow
  $nonce = ''
  try {
    $state = Get-LiveGameState
    if ($state) { Write-Host "game running pid=$($state.pid) instance=$($state.instance_id)"; return 0 }
    $nonce = [guid]::NewGuid().ToString('N')
    $previousNonce = $env:JHT_GAME_INSTANCE_ID
    $env:JHT_GAME_INSTANCE_ID = $nonce
    try {
      $launch = Start-GameProcess $executable $nonce
      $processId = [int]$launch.Pid
      $launchedProcessId = $processId
      $launchTaskName = [string]$launch.TaskName
    } finally {
      if ($null -eq $previousNonce) { Remove-Item Env:JHT_GAME_INSTANCE_ID -ErrorAction SilentlyContinue }
      else { $env:JHT_GAME_INSTANCE_ID = $previousNonce }
    }
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 200
      $state = Get-LiveGameState
      if ($state -and $state.instance_id -eq $nonce -and
          ($processId -le 0 -or [int]$state.pid -eq $processId)) {
        $launchedProcessId = [int]$state.pid
        $readyProcess = Get-Process -Id $launchedProcessId -ErrorAction SilentlyContinue
        if (-not $readyProcess -or $readyProcess.SessionId -le 0) {
          Write-Err 'client avviato fuori dalla sessione desktop interattiva'
          Stop-NewGameProcessCooperatively $launchedProcessId $nonce
          return 1
        }
        Write-Host "game started pid=$($state.pid) instance=$nonce session=$($readyProcess.SessionId)"
        return 0
      }
      if ($processId -gt 0 -and -not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
        Write-Err 'client terminato durante l avvio'
        return 1
      }
    } while ([DateTime]::UtcNow -lt $readyDeadline)
    Write-Err 'client avviato ma non pronto entro 15 secondi'
    if ($launchedProcessId -le 0) {
      # Il task non espone un PID affidabile: limita la ricerca al binario,
      # alla sessione interattiva e alla finestra temporale di questo claim.
      $candidateName = [IO.Path]::GetFileNameWithoutExtension($executable)
      $candidate = Get-Process -Name $candidateName -ErrorAction SilentlyContinue |
        Where-Object {
          $_.SessionId -gt 0 -and $_.StartTime.ToUniversalTime() -ge $launchStartedUtc.AddSeconds(-1) -and
          $_.Path -and [IO.Path]::GetFullPath($_.Path) -ieq [IO.Path]::GetFullPath($executable)
        } | Sort-Object StartTime -Descending | Select-Object -First 1
      if ($candidate) { $launchedProcessId = $candidate.Id }
    }
    Stop-NewGameProcessCooperatively $launchedProcessId $nonce
    return 1
  } catch {
    Write-Err "avvio del client non riuscito: $($_.Exception.Message)"
    return 1
  } finally {
    Remove-GameLaunchTask $launchTaskName
    Remove-GameStartLockIfOwned $lock $PID
  }
}

function Invoke-GameRequest {
  param([ValidateSet('stop','foreground','background')] [string]$Action)
  $state = Get-LiveGameState
  if (-not $state) {
    if ($Action -eq 'stop') { Write-Host 'game already stopped'; return 0 }
    if ($Action -eq 'background') { Write-Err "client non attivo; usa 'jht game start'"; return 1 }
    $startCode = Invoke-GameStart
    if ($startCode -ne 0) { return $startCode }
    $state = Get-LiveGameState
    if (-not $state) { Write-Err 'client avviato senza stato controllabile'; return 1 }
  }
  $requestId = [guid]::NewGuid().ToString('N')
  $requestPath = Join-Path $GameControlDir 'request.json'
  $ackPath = Join-Path $GameControlDir ("ack-$requestId.json")
  Remove-Item -LiteralPath $ackPath -Force -ErrorAction SilentlyContinue
  if (-not (Write-GameJsonAtomic $requestPath @{
    schema = 1; action = $Action; request_id = $requestId
    target_instance_id = [string]$state.instance_id
  })) { Write-Err 'impossibile pubblicare la richiesta al client'; return 1 }

  $deadline = [DateTime]::UtcNow.AddSeconds($(if ($Action -eq 'stop') { 15 } else { 10 }))
  try {
    do {
      Start-Sleep -Milliseconds 200
      if ($Action -eq 'stop') {
        if (-not (Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue)) {
          Write-Host "game stopped pid=$($state.pid); team still running"
          return 0
        }
      } else {
        $ack = Read-GameJson $ackPath
        if ($ack -and $ack.request_id -eq $requestId -and $ack.instance_id -eq $state.instance_id) {
          if ($ack.ok -eq $true) {
            if ($Action -eq 'background') {
              Write-Host "game background pid=$($state.pid); client and team still running"
            } else {
              Write-Host "gui opened pid=$($state.pid)"
            }
            return 0
          }
          if ($Action -eq 'background') {
            Write-Err 'il sistema operativo ha rifiutato la minimizzazione della finestra'
          } else {
            Write-Err 'il sistema operativo ha rifiutato il foreground della finestra'
          }
          return 1
        }
      }
    } while ([DateTime]::UtcNow -lt $deadline)
    Write-Err "timeout richiesta $Action al client"
    return 1
  } finally {
    Remove-GameRequestIfOwned $requestPath $requestId ([string]$state.instance_id)
    Remove-Item -LiteralPath $ackPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-GameRestart {
  $previous = Get-LiveGameState
  $stopCode = Invoke-GameRequest 'stop'
  if ($stopCode -ne 0) { return $stopCode }
  $startCode = Invoke-GameStart
  if ($startCode -ne 0) { return $startCode }
  $current = Get-LiveGameState
  if (-not $current) { Write-Err 'client riavviato senza stato controllabile'; return 1 }
  if ($previous -and $current.instance_id -eq $previous.instance_id) {
    Write-Err 'il riavvio non ha sostituito l istanza precedente'
    return 1
  }
  $oldPid = if ($previous) { [string]$previous.pid } else { 'none' }
  Write-Host "game restarted old_pid=$oldPid pid=$($current.pid) instance=$($current.instance_id); team still running"
  return 0
}

function Invoke-GameCommand {
  param([string[]]$GameArgs)
  if ($GameArgs.Count -eq 0 -or ($GameArgs.Count -eq 1 -and $GameArgs[0] -in @('--help','-h'))) { Show-GameHelp; return 0 }
  if ($GameArgs.Count -eq 2 -and $GameArgs[1] -in @('--help','-h')) {
    switch ($GameArgs[0]) {
      'start' { Write-Host 'Usage: jht game start'; Write-Host 'Avvia il client in modo idempotente.'; return 0 }
      'stop' { Write-Host 'Usage: jht game stop'; Write-Host 'Chiude il client e lascia il team al lavoro.'; return 0 }
      'status' { Write-Host 'Usage: jht game status'; Write-Host 'Mostra lo stato del client desktop.'; return 0 }
      'restart' { Write-Host 'Usage: jht game restart'; Write-Host 'Riavvia il client in modo cooperativo; il team continua.'; return 0 }
      'background' { Write-Host 'Usage: jht game background'; Write-Host 'Minimizza un client attivo senza fermarlo.'; return 0 }
    }
  }
  if ($GameArgs.Count -ne 1) { Write-Err 'opzioni game non riconosciute'; return 2 }
  switch ($GameArgs[0]) {
    'start' { return Invoke-GameStart }
    'stop' { return Invoke-GameRequest 'stop' }
    'restart' { return Invoke-GameRestart }
    'background' { return Invoke-GameRequest 'background' }
    'status' {
      $state = Get-LiveGameState
      if ($state) { Write-Host "game running pid=$($state.pid) instance=$($state.instance_id)" }
      else { Write-Host 'game stopped' }
      return 0
    }
    default { Write-Err "azione game non riconosciuta: $($GameArgs[0])"; return 2 }
  }
}

function Invoke-GuiCommand {
  param([string[]]$GuiArgs)
  if ($GuiArgs.Count -eq 0 -or ($GuiArgs.Count -eq 1 -and $GuiArgs[0] -in @('--help','-h'))) { Show-GuiHelp; return 0 }
  if ($GuiArgs.Count -eq 2 -and $GuiArgs[0] -eq 'open' -and $GuiArgs[1] -in @('--help','-h')) {
    Write-Host 'Usage: jht gui open'
    Write-Host 'Avvia il client se necessario e porta la finestra in primo piano.'
    return 0
  }
  if ($GuiArgs.Count -ne 1 -or $GuiArgs[0] -ne 'open') { Write-Err 'uso: jht gui open'; return 2 }
  return Invoke-GameRequest 'foreground'
}

# Il CLI Node vive nel container, ma `--output` e' un path del computer host.
# Il core continua a possedere download e verifica SHA-256: qui assegniamo un
# path temporaneo Linux e pubblichiamo i byte verificati con docker cp + move
# atomico sullo stesso filesystem della destinazione Windows.
function Invoke-HostDownload {
  param([string[]]$DownloadArgs)

  # Un numero restituito da una funzione PowerShell viaggia sullo stesso
  # success stream di stdout. Se `docker exec` ha gia stampato progresso, una
  # assegnazione come `$code = Invoke-HostDownload` produce quindi un array e
  # `exit $code` puo degradare a 0. Il codice vive in un canale scalare dedicato
  # e parte fail-closed; stdout/stderr restano liberi di arrivare al terminale.
  $script:HostDownloadExitCode = 1
  $hostOutput = ''
  $downloadEnv = @()
  if ($env:JHT_RELEASE_BASE_URL) {
    $downloadEnv = @('-e', "JHT_RELEASE_BASE_URL=$env:JHT_RELEASE_BASE_URL")
  }
  $rewritten = [System.Collections.Generic.List[string]]::new()
  for ($i = 0; $i -lt $DownloadArgs.Count; $i++) {
    $arg = $DownloadArgs[$i]
    if ($arg -eq '--output') {
      if ($hostOutput) { Write-Err '--output specificato piu di una volta'; $script:HostDownloadExitCode = 2; return }
      if ($i + 1 -ge $DownloadArgs.Count -or -not $DownloadArgs[$i + 1]) {
        Write-Err '--output richiede un path'
        $script:HostDownloadExitCode = 2
        return
      }
      $i += 1
      $hostOutput = $DownloadArgs[$i]
    } elseif ($arg.StartsWith('--output=')) {
      if ($hostOutput) { Write-Err '--output specificato piu di una volta'; $script:HostDownloadExitCode = 2; return }
      $hostOutput = $arg.Substring('--output='.Length)
      if (-not $hostOutput) { Write-Err '--output richiede un path'; $script:HostDownloadExitCode = 2; return }
    } else {
      $rewritten.Add($arg)
    }
  }

  # Il default `/jht_user/downloads` e' gia bind-mountato sul Documents host.
  if (-not $hostOutput) {
    # Windows PowerShell 5.1 converte lo stderr dei processi nativi in record
    # Error. Con la preference globale Stop, la normale riga di progresso del
    # downloader diventava una terminating exception prima della copia host.
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" @downloadEnv $Container node $NodeEntry download @rewritten
      $script:HostDownloadExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    return
  }

  $hostOutput = [IO.Path]::GetFullPath($hostOutput)
  if (Test-Path -LiteralPath $hostOutput) {
    Write-Err "il file di destinazione esiste gia: $hostOutput"
    return
  }

  $containerTemp = '/tmp/jht-download-' + $PID + '-' + [guid]::NewGuid().ToString('N')
  $parent = Split-Path -Parent $hostOutput
  $hostTemp = Join-Path $parent ('.' + (Split-Path -Leaf $hostOutput) + '.part-' + [guid]::NewGuid().ToString('N'))
  $rewritten.Add('--output')
  $rewritten.Add($containerTemp)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" @downloadEnv $Container node $NodeEntry download @rewritten
    $innerCode = $LASTEXITCODE
    if ($innerCode -ne 0) { $script:HostDownloadExitCode = $innerCode; return }

    New-Item -ItemType Directory -Force -Path $parent -ErrorAction Stop | Out-Null
    & docker cp "${Container}:$containerTemp" $hostTemp
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostTemp -PathType Leaf)) {
      Write-Err 'copia del download verificato verso l host non riuscita'
      return
    }
    # File.Move a due argomenti e' no-clobber anche su Windows PowerShell 5.1:
    # se il target compare durante il download l'operazione fallisce.
    [IO.File]::Move($hostTemp, $hostOutput)
    Write-Host "  Salvato sul computer host in: $hostOutput"
    $script:HostDownloadExitCode = 0
    return
  } catch {
    Write-Err "pubblicazione del download sull host non riuscita: $($_.Exception.Message)"
  } finally {
    & docker exec $Container rm -f $containerTemp *> $null
    if (Test-Path -LiteralPath $hostTemp) {
      Remove-Item -LiteralPath $hostTemp -Force -ErrorAction SilentlyContinue
    }
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

# ── Upgrade runtime, transazionale e host-side ────────────────────────────
# L'installazione utente e' image-only. Git/NPM nel container non puo'
# aggiornare il prodotto e lascerebbe meta' deploy; il wrapper host prepara il
# candidato, conserva l'ultima immagine buona in un journal e fa rollback se
# il nuovo container non riesce a eseguire il suo CLI.
$script:UpgradeJson = $false
$script:UpgradeStage = ''
$script:UpgradeLock = ''
$script:UpgradeJournal = ''
$script:UpgradeRollbackDir = ''

function ConvertTo-UpgradeField {
  param([object]$Value)
  return ([regex]::Replace([string]$Value, '[^A-Za-z0-9._,:+@/\-]', '')).Substring(0, [Math]::Min(220, ([regex]::Replace([string]$Value, '[^A-Za-z0-9._,:+@/\-]', '')).Length))
}

function Write-UpgradeResult {
  param(
    [bool]$Ok, [bool]$Changed, [string]$Phase,
    [string]$PreviousVersion, [string]$PreviousImage,
    [string]$CurrentVersion, [string]$CurrentImage,
    [bool]$RestartRequired, [string]$Message, [bool]$RolledBack
  )
  $result = [ordered]@{
    ok = $Ok; changed = $Changed; phase = $Phase
    previous = [ordered]@{ version = ConvertTo-UpgradeField $PreviousVersion; image = ConvertTo-UpgradeField $PreviousImage }
    current = [ordered]@{ version = ConvertTo-UpgradeField $CurrentVersion; image = ConvertTo-UpgradeField $CurrentImage }
    restartRequired = $RestartRequired; message = $Message; rolledBack = $RolledBack
  }
  if ($script:UpgradeJson) {
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 4))
  } elseif ($Ok) {
    Write-Host "Aggiornamento completato: $PreviousVersion ($PreviousImage) -> $CurrentVersion ($CurrentImage). $Message" -ForegroundColor Green
  } else {
    Write-Err "Aggiornamento non completato ($Phase): $Message"
    if ($RolledBack) { Write-Info 'Runtime precedente ripristinato.' }
  }
}

function Write-UpgradeNote { param([string]$Message) if (-not $script:UpgradeJson) { Write-Info $Message } }

function Invoke-UpgradeCompose {
  param([string]$File, [Parameter(ValueFromRemainingArguments)] [string[]]$ComposeArgs)
  # Active metadata must always be attested. Candidate files are accepted
  # only inside the protected, freshly-created upgrade stage.
  if ([IO.Path]::GetFullPath($File) -eq [IO.Path]::GetFullPath($ComposeFile)) {
    Assert-TrustedRuntime
  } else {
    $stageRoot = if ($script:UpgradeStage) { [IO.Path]::GetFullPath($script:UpgradeStage).TrimEnd('\', '/') } else { '' }
    $candidate = [IO.Path]::GetFullPath($File)
    if (-not $stageRoot -or -not $candidate.StartsWith($stageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
  }
  $all = @('compose', '-f', $File, '--project-directory', $RuntimeDir) + $ComposeArgs
  if ($script:UpgradeJson) { & docker @all *> $null } else { & docker @all }
  return $LASTEXITCODE -eq 0
}

function Test-UpgradeDockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  & docker info *> $null
  return $LASTEXITCODE -eq 0
}

function Get-UpgradeImage {
  $value = (& docker inspect $Container --format '{{.Image}}' 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) { return '' }
  return ([string]$value).Trim()
}

function Get-UpgradeVersion {
  $value = (& docker exec $Container node $NodeEntry --version 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) { return '' }
  return ([string]$value).Trim()
}

function Test-UpgradeRunning {
  for ($i = 0; $i -lt 20; $i++) {
    if ((Test-ContainerUp) -and (Get-UpgradeVersion)) {
      Start-Sleep -Seconds 1
      if ((Test-ContainerUp) -and (Get-UpgradeVersion)) { return $true }
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Replace-UpgradeFile {
  param([string]$Source, [string]$Target, [bool]$Executable = $false)
  $parent = Split-Path -Parent $Target
  $temp = Join-Path $parent ('.' + (Split-Path -Leaf $Target) + '.upgrade.' + [guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::Copy($Source, $temp, $true)
    if (Test-Path $Target) { [IO.File]::Replace($temp, $Target, $null) } else { [IO.File]::Move($temp, $Target) }
    return $true
  } catch {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Write-UpgradeJournal {
  param([string]$Phase, [string]$OldImage, [bool]$WasRunning)
  $value = [ordered]@{ version = 1; phase = $Phase; rollback_dir = $script:UpgradeRollbackDir; old_image = $OldImage; was_running = $WasRunning }
  $temp = "$script:UpgradeJournal.tmp.$PID"
  try {
    [IO.File]::WriteAllText($temp, ($value | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    if (Test-Path $script:UpgradeJournal) { [IO.File]::Replace($temp, $script:UpgradeJournal, $null) } else { [IO.File]::Move($temp, $script:UpgradeJournal) }
    return $true
  } catch {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Remove-UpgradeTransaction {
  Remove-Item -LiteralPath $script:UpgradeJournal -Force -ErrorAction SilentlyContinue
  if ($script:UpgradeRollbackDir -and (Test-Path $script:UpgradeRollbackDir)) {
    Remove-Item -LiteralPath (Join-Path $script:UpgradeRollbackDir 'docker-compose.yml') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $script:UpgradeRollbackDir 'jht-wrapper.ps1') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $script:UpgradeRollbackDir '.runtime-integrity') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:UpgradeRollbackDir -Force -ErrorAction SilentlyContinue
  }
}

function Restore-UpgradePrevious {
  if (-not (Test-Path $script:UpgradeJournal)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $script:UpgradeJournal)) { return $false }
  try { $journal = Get-Content -LiteralPath $script:UpgradeJournal -Raw | ConvertFrom-Json } catch { return $false }
  if ([string]$journal.version -ne '1') { return $false }
  if ([string]$journal.phase -notin @('prepared', 'pulled', 'candidate_started', 'metadata_committed')) { return $false }
  if ($journal.was_running -isnot [bool]) { return $false }
  $rollback = [string]$journal.rollback_dir
  try {
    $runtimeRoot = ([IO.Path]::GetFullPath($RuntimeDir)).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $fullRollback = if ($rollback) { [IO.Path]::GetFullPath($rollback) } else { '' }
    $rollbackInfo = Get-Item -LiteralPath $fullRollback -Force -ErrorAction Stop
  } catch { return $false }
  # Il journal non puo' scegliere una directory arbitraria: accettiamo solo
  # una directory reale creata direttamente sotto il runtime. `GetFullPath`
  # rende innocuo anche un prefisso seguito da ../, mentre il rifiuto dei link
  # evita che un journal corrotto porti fuori dal runtime fisico.
  if (-not $rollbackInfo.PSIsContainer -or $rollbackInfo.LinkType) { return $false }
  if (-not (Test-ProtectedRuntimeNode $fullRollback -Directory)) { return $false }
  $rollbackParent = ([IO.Path]::GetFullPath((Split-Path -LiteralPath $fullRollback -Parent))).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $rollbackLeaf = Split-Path -LiteralPath $fullRollback -Leaf
  if ($rollbackParent -ne $runtimeRoot -or $rollbackLeaf -notmatch '^\.upgrade-rollback-[A-Za-z0-9_-]+$') { return $false }
  try {
    $composeSnapshot = Get-Item -LiteralPath (Join-Path $fullRollback 'docker-compose.yml') -Force -ErrorAction Stop
    $wrapperSnapshot = Get-Item -LiteralPath (Join-Path $fullRollback 'jht-wrapper.ps1') -Force -ErrorAction Stop
    $manifestSnapshot = Get-Item -LiteralPath (Join-Path $fullRollback '.runtime-integrity') -Force -ErrorAction Stop
  } catch { return $false }
  if ($composeSnapshot.PSIsContainer -or $wrapperSnapshot.PSIsContainer -or $manifestSnapshot.PSIsContainer -or $composeSnapshot.LinkType -or $wrapperSnapshot.LinkType -or $manifestSnapshot.LinkType) { return $false }
  if (-not (Test-ProtectedRuntimeNode $composeSnapshot.FullName) -or -not (Test-ProtectedRuntimeNode $wrapperSnapshot.FullName) -or -not (Test-ProtectedRuntimeNode $manifestSnapshot.FullName)) { return $false }
  try {
    $snapshotValues = ConvertFrom-StringData (Get-Content -LiteralPath $manifestSnapshot.FullName -Raw)
    $snapshotHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $composeSnapshot.FullName).Hash.ToLowerInvariant()
    $snapshotWrapperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $wrapperSnapshot.FullName).Hash.ToLowerInvariant()
    if ($snapshotValues.'docker-compose.yml' -ne $snapshotHash) { return $false }
    if ($snapshotValues.'jht-wrapper.ps1' -ne $snapshotWrapperHash) { return $false }
  } catch { return $false }
  if ([bool]$journal.was_running) {
    if ([string]$journal.old_image -notmatch '^sha256:[A-Za-z0-9]+$') { return $false }
    # Verifica l'immagine immutabile prima della prima sostituzione metadata:
    # un digest solo formalmente valido non deve lasciare compose/wrapper in
    # uno stato diverso se il rollback non puo' ricreare il container.
    & docker image inspect ([string]$journal.old_image) *> $null
    if ($LASTEXITCODE -ne 0) { return $false }
  } elseif ([string]$journal.old_image -ne 'none') { return $false }
  if (-not (Replace-UpgradeFile $composeSnapshot.FullName $ComposeFile)) { return $false }
  if (-not (Replace-UpgradeFile $wrapperSnapshot.FullName $WrapperPath)) { return $false }
  if (-not (Replace-UpgradeFile $manifestSnapshot.FullName $RuntimeManifest)) { return $false }
  if ([bool]$journal.was_running) {
    $before = $env:JHT_IMAGE
    $env:JHT_IMAGE = [string]$journal.old_image
    $ok = Invoke-UpgradeCompose $ComposeFile 'up' '-d' '--force-recreate' $Container
    $env:JHT_IMAGE = $before
    if (-not $ok -or -not (Test-UpgradeRunning)) { return $false }
  } else {
    if (-not (Invoke-UpgradeCompose $ComposeFile 'rm' '-s' '-f' $Container)) { return $false }
  }
  $script:UpgradeRollbackDir = $fullRollback
  Remove-UpgradeTransaction
  return $true
}

function Enter-UpgradeLock {
  $script:UpgradeLock = Join-Path $RuntimeDir '.upgrade.lock'
  try {
    New-Item -ItemType Directory -Path $script:UpgradeLock -ErrorAction Stop | Out-Null
    Set-Content -LiteralPath (Join-Path $script:UpgradeLock 'pid') -Value $PID -NoNewline
    return $true
  } catch {
    $pidFile = Join-Path $script:UpgradeLock 'pid'
    $holder = if (Test-Path $pidFile) { Get-Content -LiteralPath $pidFile -Raw } else { '' }
    if ($holder -and (Get-Process -Id ([int]$holder) -ErrorAction SilentlyContinue)) { return $false }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:UpgradeLock -Force -ErrorAction SilentlyContinue
    try {
      New-Item -ItemType Directory -Path $script:UpgradeLock -ErrorAction Stop | Out-Null
      Set-Content -LiteralPath (Join-Path $script:UpgradeLock 'pid') -Value $PID -NoNewline
      return $true
    } catch { return $false }
  }
}

function Clear-UpgradeEphemeral {
  if ($script:UpgradeStage -and (Test-Path $script:UpgradeStage)) { Remove-Item -LiteralPath $script:UpgradeStage -Recurse -Force -ErrorAction SilentlyContinue }
  if ($script:UpgradeLock -and (Test-Path $script:UpgradeLock)) {
    Remove-Item -LiteralPath (Join-Path $script:UpgradeLock 'pid') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:UpgradeLock -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-RuntimeUpgrade {
  param([string[]]$UpgradeArgs)
  $checkOnly = $false
  foreach ($arg in $UpgradeArgs) {
    if ($arg -eq '--json') { $script:UpgradeJson = $true }
    elseif ($arg -eq '--check') { $checkOnly = $true }
    elseif ($arg -ne '--apply') { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Opzione upgrade non supportata' $false; return 2 }
  }
  if (-not (Test-Path -LiteralPath $RuntimeDir)) {
    if (-not (Install-ProtectedRuntimeFromRelease)) { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Runtime host protetto non installabile' $false; return 1 }
  }
  if (-not (Test-RuntimePathAuthority) -or -not (Test-RuntimeAncestorsWithoutReparsePoint $RuntimeDir) -or -not (Test-ProtectedRuntimeNode $RuntimeDir -Directory) -or -not (Test-RuntimeDirectoryAcl)) {
    Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Runtime host fuori authority' $false
    return 1
  }
  if (-not (Enter-UpgradeLock)) { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Un aggiornamento e gia in corso' $false; return 1 }
  $script:UpgradeJournal = Join-Path $RuntimeDir '.upgrade-journal'
  try {
    if ((Test-Path $script:UpgradeJournal) -and -not (Restore-UpgradePrevious)) { Write-UpgradeResult $false $false 'recovery' 'unknown' 'none' 'unknown' 'none' $false 'Recovery dell upgrade precedente non riuscita' $false; return 1 }
    try { Assert-TrustedRuntime } catch { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Runtime host non attendibile' $false; return 1 }
    if (-not (Test-UpgradeDockerReady) -or -not (Test-Path $ComposeFile) -or -not (Test-Path $WrapperPath)) { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Docker o runtime host non disponibile' $false; return 1 }
    $wasRunning = Test-ContainerUp
    $oldImage = if ($wasRunning) { Get-UpgradeImage } else { 'none' }
    $oldVersion = if ($wasRunning) { Get-UpgradeVersion } else { 'non-installata' }
    if (-not $oldImage) { $oldImage = 'none' }; if (-not $oldVersion) { $oldVersion = 'sconosciuta' }
    $script:UpgradeStage = Join-Path $RuntimeDir ('.upgrade-stage-' + $PID + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:UpgradeStage -ErrorAction Stop | Out-Null
    $newCompose = Join-Path $script:UpgradeStage 'docker-compose.yml'; $newWrapper = Join-Path $script:UpgradeStage 'jht-wrapper.ps1'
    Write-UpgradeNote 'Scarico runtime aggiornato...'
    try {
      $releaseBase = Get-AttestedRawBase
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/docker-compose.yml" -OutFile $newCompose
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/scripts/jht-wrapper.ps1" -OutFile $newWrapper
      [scriptblock]::Create((Get-Content -LiteralPath $newWrapper -Raw)) | Out-Null
      if (-not (Select-String -LiteralPath $newWrapper -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) { throw 'wrapper runtime protocol missing' }
      if (-not (Select-String -LiteralPath $newCompose -Pattern '^\s*-\s*jht-runtime-mask:/jht_home/runtime(?:\s|$)' -Quiet)) { throw 'compose runtime mask missing' }
    } catch { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Runtime remoto non valido o non raggiungibile' $false; return 1 }
    if (-not (Invoke-UpgradeCompose $newCompose 'config' '-q')) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Compose remoto non valido' $false; return 1 }
    $metadataChanged = -not ((Get-FileHash $newCompose).Hash -eq (Get-FileHash $ComposeFile).Hash) -or -not ((Get-FileHash $newWrapper).Hash -eq (Get-FileHash $WrapperPath).Hash)
    $script:UpgradeRollbackDir = Join-Path $RuntimeDir ('.upgrade-rollback-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + '-' + $PID)
    New-Item -ItemType Directory -Path $script:UpgradeRollbackDir -ErrorAction Stop | Out-Null
    Copy-Item -LiteralPath $ComposeFile -Destination (Join-Path $script:UpgradeRollbackDir 'docker-compose.yml')
    Copy-Item -LiteralPath $WrapperPath -Destination (Join-Path $script:UpgradeRollbackDir 'jht-wrapper.ps1')
    Copy-Item -LiteralPath $RuntimeManifest -Destination (Join-Path $script:UpgradeRollbackDir '.runtime-integrity')
    if (-not (Write-UpgradeJournal 'prepared' $oldImage $wasRunning)) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Impossibile preparare il rollback' $false; return 1 }
    Write-UpgradeNote 'Scarico l immagine piu recente...'
    if (-not (Invoke-UpgradeCompose $newCompose 'pull' $Container)) { Remove-UpgradeTransaction; Write-UpgradeResult $false $false 'pull' $oldVersion $oldImage $oldVersion $oldImage $false 'Download immagine non riuscito' $false; return 1 }
    $candidateRef = ((& docker compose -f $newCompose --project-directory $RuntimeDir config --images 2>$null | Select-Object -First 1) -as [string]).Trim()
    if (-not $candidateRef) { $candidateRef = if ($env:JHT_IMAGE) { $env:JHT_IMAGE } else { 'ghcr.io/leopu00/jht:0.3.8' } }
    $candidateImage = ((& docker image inspect $candidateRef --format '{{.Id}}' 2>$null | Select-Object -First 1) -as [string]).Trim()
    if (-not $candidateImage) { $candidateImage = 'sconosciuta' }
    if (-not (Write-UpgradeJournal 'pulled' $oldImage $wasRunning)) { Write-UpgradeResult $false $false 'pull' $oldVersion $oldImage $oldVersion $oldImage $false 'Impossibile aggiornare il journal' $false; return 1 }
    if ($checkOnly) { Remove-UpgradeTransaction; $changed = ($candidateImage -ne $oldImage) -or $metadataChanged; Write-UpgradeResult $true $changed 'check' $oldVersion $oldImage $oldVersion $candidateImage $changed 'Controllo completato; nessuna modifica al runtime' $false; return 0 }
    Write-UpgradeNote 'Attivo il nuovo runtime...'
    if (-not (Invoke-UpgradeCompose $newCompose 'up' '-d' '--force-recreate' $Container) -or -not (Write-UpgradeJournal 'candidate_started' $oldImage $wasRunning) -or -not (Test-UpgradeRunning)) {
      $rolledBack = Restore-UpgradePrevious; Write-UpgradeResult $false $false 'verify' $oldVersion $oldImage $oldVersion $oldImage $false 'Il nuovo runtime non ha superato la verifica' $rolledBack; return 1
    }
    $newVersion = Get-UpgradeVersion; if (-not $newVersion) { $newVersion = 'sconosciuta' }
    if (-not (Replace-UpgradeFile $newCompose $ComposeFile) -or -not (Replace-UpgradeFile $newWrapper $WrapperPath)) {
      $rolledBack = Restore-UpgradePrevious; Write-UpgradeResult $false $false 'commit' $oldVersion $oldImage $oldVersion $oldImage $false 'Metadata runtime non persistiti' $rolledBack; return 1
    }
    Write-RuntimeManifest
    if (-not (Write-UpgradeJournal 'metadata_committed' $oldImage $wasRunning)) {
      $rolledBack = Restore-UpgradePrevious; Write-UpgradeResult $false $false 'commit' $oldVersion $oldImage $oldVersion $oldImage $false 'Metadata runtime non persistiti' $rolledBack; return 1
    }
    Remove-UpgradeTransaction
    $changed = ($candidateImage -ne $oldImage) -or $metadataChanged
    Write-UpgradeResult $true $changed 'complete' $oldVersion $oldImage $newVersion $candidateImage $false 'Nuova versione attiva e verificata' $false
    return 0
  } catch {
    if (Test-Path $script:UpgradeJournal) {
      $rolledBack = Restore-UpgradePrevious
    } else {
      Remove-UpgradeTransaction
      $rolledBack = $false
    }
    Write-UpgradeResult $false $false 'unexpected' 'unknown' 'none' 'unknown' 'none' $false 'Errore inatteso durante l aggiornamento' $rolledBack
    return 1
  } finally { Clear-UpgradeEphemeral }
}

# Decide se passare -it a docker exec: serve solo se stdin/stdout sono terminali.
# Su Windows pwsh, [Console]::IsInputRedirected restituisce true quando lo
# script gira sotto pipe / redirect — in quel caso usiamo -i (no TTY).
if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) {
  $ExecFlags = @('-i')
} else {
  $ExecFlags = @('-it')
}

# ── Dispatcher ────────────────────────────────────────────────────────────
$Sub = if ($args.Count -ge 1) { $args[0] } else { '' }
# BUG FIX 2026-05-22: `$args[1..1]` collapses to a scalar string (PowerShell
# unwraps single-element arrays). When that scalar is splatted via @Rest,
# docker exec iterates char-by-char and the inner CLI sees `cloud l o g i n`
# instead of `cloud login`. Forziamo array via @() per garantire splat
# corretto anche con 1 solo arg di coda.
$Rest = if ($args.Count -gt 1) { @($args[1..($args.Count - 1)]) } else { @() }

# ORDINE: si guarda COSA e' stato chiesto PRIMA di decidere se serve Docker.
# Il contrario - Ensure-Up in cima al default - faceva si' che un semplice
# `jht --help` scaricasse l'immagine (~300 MB) e creasse container e volumi,
# cioe' il primo comando di chi non ha ancora deciso se installare (P-07).
switch ($Sub) {
  { $_ -in @('-h', '--help', 'help', '') } {
    exit (Invoke-HelpWithoutDocker '--help')
  }

  { $_ -in @('-V', '--version', 'version') } {
    if ((Test-DockerReachable) -and (Test-ContainerUp)) {
      & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry --version
    } else {
      Write-Info "Per la versione del CLI in esecuzione serve il container attivo: 'jht up'."
    }
    exit 0
  }

  'game' {
    $code = Invoke-GameCommand $Rest
    exit $code
  }

  'gui' {
    $code = Invoke-GuiCommand $Rest
    exit $code
  }

  { $_ -in @('up', 'start-container') } {
    Require-ComposeFile
    Require-Docker
    Invoke-Compose up -d
    break
  }

  { $_ -in @('down', 'stop-container') } {
    Require-ComposeFile
    Require-Docker
    Invoke-Compose down
    break
  }

  'restart' {
    Require-ComposeFile
    Require-Docker
    Invoke-Compose restart $Container
    break
  }

  'recreate' {
    Require-ComposeFile
    Require-Docker
    Invoke-Compose down
    Invoke-Compose up -d
    break
  }

  'upgrade' {
    $code = Invoke-RuntimeUpgrade $Rest
    exit $code
  }

  'logs' {
    Require-Docker
    & docker logs @Rest $Container
    break
  }

  'status' {
    Require-Docker
    if (Test-ContainerUp) {
      & docker inspect $Container --format 'name={{.Name}} status={{.State.Status}} started={{.State.StartedAt}} image={{.Config.Image}}'
    } else {
      Write-Host "container '$Container' non attivo"
      exit 1
    }
    break
  }

  'shell' {
    Require-Docker
    Ensure-Up
    & docker exec @ExecFlags $Container bash
    break
  }

  # OAuth login: legge il provider attivo e avvia il suo flusso reale.
  { $_ -in @('oauth-login', 'claude-login') } {
    Require-ComposeFile
    Require-Docker
    Ensure-Up
    $Provider = (& docker exec $Container node -e "try{const c=require('/jht_home/jht.config.json');process.stdout.write(String(c.active_provider||''))}catch{}" 2>$null)
    switch (($Provider | Out-String).Trim().ToLowerInvariant()) {
      { $_ -in @('openai', 'codex') } { & docker exec @ExecFlags $Container codex login --device-auth; break }
      { $_ -in @('kimi', 'moonshot') } { & docker exec @ExecFlags $Container kimi --yolo; break }
      { $_ -in @('', 'claude', 'anthropic') } { & docker exec @ExecFlags $Container claude --dangerously-skip-permissions; break }
      default { throw "provider attivo non riconosciuto: $Provider" }
    }
    break
  }

  # Setup: skip host-setup (non esiste su Windows), delega tutto al wizard
  # Node nel container che leggera' JHT_HOST_TYPE dall'env passato.
  'setup' {
    Require-ComposeFile
    Require-Docker
    Ensure-Up
    & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry @Rest
    break
  }

  'download' {
    Require-ComposeFile
    Require-Docker
    Ensure-Up
    Invoke-HostDownload $Rest
    exit $script:HostDownloadExitCode
  }

  # Tutto il resto: delegato al CLI Node nel container.
  default {
    # Anche qui: se l'utente sta solo chiedendo aiuto su un sottocomando, non
    # si accende nulla per rispondergli.
    if ($Rest | Where-Object { $_ -in @('-h', '--help') }) {
      exit (Invoke-HelpWithoutDocker $Sub @Rest)
    }
    Require-ComposeFile
    Require-Docker
    Ensure-Up
    & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry $Sub @Rest
    break
  }
}

exit $LASTEXITCODE
