# Convert an existing Windows JHT installation to the Podman backend. The
# Docker-compatible host wrapper remains the product boundary; docker.exe is a
# native, attested shim that forwards argv and exit codes to podman.exe.

[CmdletBinding()]
param(
  [string]$MachineName = 'jht-podman',
  [switch]$InstallDependencies,
  [switch]$InitializeMachine,
  [string]$RuntimeImage = 'ghcr.io/leopu00/jht@sha256:07b154bee43f32d2e6313c54f28e389836556e2b5cbe1b76d03398684c38b598',
  [string]$ExpectedImageDigest = '',
  [switch]$PersistImagePin
)

$ErrorActionPreference = 'Stop'
# Under 'Stop', Windows PowerShell 5.1 (the shell the app runs) turns ANY line a native program writes on
# stderr into an error that stops the script, even with 2>$null: `podman inspect jht` saying "no such
# object" stopped every first installation (T82). So a native call whose stderr is dropped runs in its
# own block with 'Continue', and where its failure must stop the setup, $LASTEXITCODE says so.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
$RuntimeDir = if ($env:JHT_RUNTIME_DIR) { $env:JHT_RUNTIME_DIR } else { Join-Path $LocalAppData 'Job Hunter Team\host-runtime' }
$BinDir = if ($env:JHT_BIN_DIR) { $env:JHT_BIN_DIR } else { Join-Path $env:USERPROFILE '.local\bin' }
$RuntimeShimDir = Join-Path $RuntimeDir 'bin'
$JhtHome = Join-Path $env:USERPROFILE '.jht'
$PodmanCliVersion = '6.0.2'
$ComposeProviderVersion = '5.1.2'
# JHT's own docker-compose.exe, private to the runtime: never one found in
# PATH (Docker Desktop ships its own, of another version). The release asset
# and SHA-256 are those of winget's Docker.DockerCompose 5.1.2 manifest; the
# CI parity gate (.github/workflows/test.yml) reads both from here.
$ComposeProviderUrl = 'https://github.com/docker/compose/releases/download/v5.1.2/docker-compose-windows-x86_64.exe'
$ComposeProviderSha256 = '00e839301ca18ee5109b3ef086788f3a281c317c0b77ba42a06fc6f806401255'
$ComposeProvider = Join-Path $RuntimeShimDir 'docker-compose.exe'

function Write-JhtPhase {
  param([Parameter(Mandatory)][ValidateSet(
    'wsl_check', 'podman_install', 'podman_machine_init',
    'podman_machine_start', 'runtime_download', 'image_pull'
  )][string]$Id)
  [Console]::Out.WriteLine("JHT_PHASE $Id")
}

function Update-ProcessPath {
  $env:PATH = @(
    [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [Environment]::GetEnvironmentVariable('Path', 'User'),
    $env:PATH
  ) -join [IO.Path]::PathSeparator
}

function Invoke-Checked {
  param([Parameter(Mandatory)][string]$FilePath, [Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')" }
}

function Install-PrivateComposeProvider {
  param([Parameter(Mandatory)][string]$Destination)
  if ((Test-Path -LiteralPath $Destination -PathType Leaf) -and
      (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash -eq $ComposeProviderSha256) { return }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  $temp = "$Destination.download-$PID"
  # Windows PowerShell's progress bar slows a large download by minutes.
  $previousProgress = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $ComposeProviderUrl -OutFile $temp -ErrorAction Stop
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $temp).Hash
    if ($actual -ne $ComposeProviderSha256) { throw "docker-compose.exe $ComposeProviderVersion has SHA-256 $actual, expected $ComposeProviderSha256" }
    Move-Item -LiteralPath $temp -Destination $Destination -Force
  } finally {
    $ProgressPreference = $previousProgress
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Get-Application {
  param([Parameter(Mandatory)][string]$Name)
  return (Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
}

function Report-LegacyDockerVolumes {
  param([string]$DockerPath)
  $visible = @()
  if ($DockerPath) {
    try {
      $visible = @(& { $ErrorActionPreference = 'Continue'; & $DockerPath volume ls --format '{{.Name}}' `
        --filter 'label=com.docker.compose.project=host-runtime' 2>$null } |
        ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
      if ($LASTEXITCODE -ne 0) { $visible = @() }
    } catch { $visible = @() }
  }

  # v0.3.9/docker-compose.yml mounts all durable user state from Windows.
  # Its only named volumes are a reinstallable provider CLI/cache and an
  # empty mask over the protected host runtime directory.
  [Console]::Out.WriteLine('JHT v0.3.9 Docker volumes contain only reinstallable provider CLI/cache (jht-deps) and an empty runtime mask; config, profile, provider login and documents are in ~/.jht and Documents.')
  [Console]::Out.WriteLine('Those Docker volumes are not copied to Podman and remain in Docker Desktop for manual removal after the upgrade is verified.')
  if ($visible.Count -eq 0) {
    [Console]::Out.WriteLine('Docker Desktop was not started; no legacy volume was enumerated.')
    return
  }
  $expected = @($visible | Where-Object {
    $_ -in @('host-runtime_jht-deps', 'host-runtime_jht-runtime-mask')
  })
  $unexpected = @($visible | Where-Object {
    $_ -notin @('host-runtime_jht-deps', 'host-runtime_jht-runtime-mask')
  })
  if ($expected.Count -gt 0) {
    [Console]::Out.WriteLine("Legacy v0.3.9 volumes left in Docker Desktop: $($expected -join ', ').")
  }
  if ($unexpected.Count -gt 0) {
    [Console]::Error.WriteLine("Additional JHT Docker volumes were left untouched and were not migrated: $($unexpected -join ', ').")
  }
}

function ConvertTo-WslPath {
  param([Parameter(Mandatory)][string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -notmatch '^([A-Za-z]):\\(.*)$') { throw "Cannot map path into WSL: $full" }
  return '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\', '/')
}

function Quote-Sh {
  param([Parameter(Mandatory)][string]$Value)
  if ($Value.Contains("'")) { throw "Cannot shell-quote a path containing an apostrophe: $Value" }
  return "'$Value'"
}

# $true when $Id falls in one of the "container:host:size" ranges of a Podman ID map. An empty map
# is the host's own IDs, and a form not known here is not judged: both count as mapped.
function Test-IdInMap {
  param($Entries, $Id)
  if ($null -eq $Id) { return $true }
  $list = @(foreach ($entry in @($Entries)) { if ($entry) { [string]$entry } })
  if ($list.Count -eq 0) { return $true }
  foreach ($entry in $list) {
    if ($entry -notmatch '^(\d+):(\d+):(\d+)$') { return $true }
    $start = [long]$Matches[1]
    if ($Id -ge $start -and $Id -lt ($start + [long]$Matches[3])) { return $true }
  }
  return $false
}

# $Details is "<Config.User>|<json HostConfig.IDMappings>" of a container. $false only when the user
# is numeric and its user namespace leaves out its uid or its gid: such a container never starts.
function Test-ContainerMapsItsUser {
  param([Parameter(Mandatory)][string]$Details)
  $cut = $Details.IndexOf('|')
  if ($cut -lt 0) { return $true }
  if ($Details.Substring(0, $cut).Trim() -notmatch '^(\d+)(?::(\d+))?$') { return $true }
  $uid = [long]$Matches[1]
  $gid = if ($Matches[2]) { [long]$Matches[2] } else { $null }
  $mappings = $null
  try { $mappings = ConvertFrom-Json -InputObject $Details.Substring($cut + 1) } catch { return $true }
  if (-not $mappings) { return $true }
  return (Test-IdInMap -Entries $mappings.UidMap -Id $uid) -and (Test-IdInMap -Entries $mappings.GidMap -Id $gid)
}

function New-DockerShim {
  param(
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$PodmanPath,
    # The connection the shim falls back to when CONTAINER_CONNECTION is unset:
    # jht-wrapper.ps1 sets it, but a call that reaches docker.exe without the
    # wrapper would get Podman's DEFAULT connection, which on a computer with
    # two machines is not ours.
    [string]$MachineName = 'jht-podman'
  )
  if ($MachineName -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$') { throw "Invalid Podman machine name for the docker shim: $MachineName" }
  $escaped = $PodmanPath.Replace('\', '\\').Replace('"', '\"')
  $source = @"
using System;
using System.Diagnostics;
using System.Text;
public static class JhtPodmanDockerShim {
  private const string PodmanPath = "$escaped";
  private const string MachineConnection = "$MachineName";
  private static string Quote(string value) {
    if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (var ch in value) {
      if (ch == '\\') { slashes++; continue; }
      if (ch == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); slashes = 0; continue; }
      result.Append('\\', slashes); slashes = 0; result.Append(ch);
    }
    result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
  }
  public static int Main(string[] args) {
    var joined = new StringBuilder();
    foreach (var arg in args) { if (joined.Length > 0) joined.Append(' '); joined.Append(Quote(arg)); }
    // Set on the shim's own process, which podman inherits: an exe compiled by
    // pwsh fails on the environment dictionary of ProcessStartInfo.
    if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("CONTAINER_CONNECTION")))
      Environment.SetEnvironmentVariable("CONTAINER_CONNECTION", MachineConnection);
    var start = new ProcessStartInfo { FileName = PodmanPath, Arguments = joined.ToString(), UseShellExecute = false };
    using (var process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
  }
}

"@
  $sourcePath = [IO.Path]::ChangeExtension($Destination, '.cs')
  try {
    [IO.File]::WriteAllText($sourcePath, $source, [Text.UTF8Encoding]::new($false))
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $quotedSource = $sourcePath.Replace("'", "''")
    $quotedDestination = $Destination.Replace("'", "''")
    & $windowsPowerShell -NoProfile -NonInteractive -Command "Add-Type -Path '$quotedSource' -OutputAssembly '$quotedDestination' -OutputType ConsoleApplication"
    if ($LASTEXITCODE -ne 0) { throw "Native docker shim compiler exited with $LASTEXITCODE." }
  } finally { Remove-Item -LiteralPath $sourcePath -Force -ErrorAction SilentlyContinue }
  if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) { throw "docker.exe shim was not created: $Destination" }
}

function Test-AttestedLegacyDockerShim {
  param(
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$LegacyShimPath
  )
  try {
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $LegacyShimPath -PathType Leaf)) { return $false }
    $item = Get-Item -LiteralPath $LegacyShimPath -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    $values = ConvertFrom-StringData (Get-Content -LiteralPath $ManifestPath -Raw)
    if ($values.version -ne '1' -or -not $values.ContainsKey('docker.exe')) { return $false }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $LegacyShimPath).Hash.ToLowerInvariant()
    return $values.'docker.exe' -eq $actual
  } catch { return $false }
}

function Copy-NodeWithoutWslMetadata {
  param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
  $item = Get-Item -LiteralPath $Source -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing metadata repair through a reparse point: $Source" }
  if ($item.PSIsContainer) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($child in Get-ChildItem -LiteralPath $Source -Force) {
      Copy-NodeWithoutWslMetadata -Source $child.FullName -Destination (Join-Path $Destination $child.Name)
    }
  } else {
    $input = [IO.File]::OpenRead($Source)
    try {
      $output = [IO.File]::Create($Destination)
      try { $input.CopyTo($output) } finally { $output.Dispose() }
    } finally { $input.Dispose() }
  }
}

function Protect-OwnerOnlyDirectory {
  param([Parameter(Mandatory)][string]$Path)
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $acl = Get-Acl -LiteralPath $Path
  $ownerSid = ([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier])
  $unsafeWriter = $false
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    $writes = $rights -band ([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Modify -bor [Security.AccessControl.FileSystemRights]::FullControl)
    if (-not $writes) { continue }
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')) { $unsafeWriter = $true }
  }
  if ($acl.AreAccessRulesProtected -and $ownerSid.Value -eq $identity.User.Value -and -not $unsafeWriter) { return }
  $acl.SetOwner($identity.User)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }
  $acl.SetAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    $identity.User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  Set-JhtAccessControl -Path $Path -Acl $acl
  if (-not (Get-Acl -LiteralPath $Path).AreAccessRulesProtected) { throw "ACL inheritance remains enabled: $Path" }
}

function Test-LegacyWslOwner {
  param([Parameter(Mandatory)][string]$WindowsPath, [Parameter(Mandatory)][string]$PodmanPath)
  if (-not (Test-Path -LiteralPath $WindowsPath)) { return $false }
  $wslPath = ConvertTo-WslPath $WindowsPath
  $owner = (& { $ErrorActionPreference = 'Continue'; & $PodmanPath machine ssh $MachineName "stat -c '%u' $(Quote-Sh $wslPath)" 2>$null } | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0) { throw "Cannot read the owner of '$WindowsPath' in the Podman machine." }
  return ([string]$owner).Trim() -ne '1000'
}

function Repair-LegacyBindMetadata {
  param([Parameter(Mandatory)][string]$PodmanPath)
  $targets = @('jobs.db', 'logs', 'state', '.team-halted.flag') |
    ForEach-Object { Join-Path $JhtHome $_ } |
    Where-Object { Test-LegacyWslOwner -WindowsPath $_ -PodmanPath $PodmanPath }
  if (-not $targets) { return $false }

  $running = (& { $ErrorActionPreference = 'Continue'; & $PodmanPath --connection $MachineName inspect jht --format '{{.State.Running}}' 2>$null } | Select-Object -First 1)
  if (([string]$running).Trim() -eq 'true') { Invoke-Checked $PodmanPath '--connection' $MachineName 'stop' 'jht' | Out-Null }

  $backup = Join-Path $JhtHome ('podman-metadata-backup-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  foreach ($target in $targets) {
    $name = Split-Path -Leaf $target
    $fresh = Join-Path $JhtHome ('.podman-fresh-' + [guid]::NewGuid().ToString('N'))
    Copy-NodeWithoutWslMetadata -Source $target -Destination $fresh
    Move-Item -LiteralPath $target -Destination (Join-Path $backup $name)
    Move-Item -LiteralPath $fresh -Destination $target
  }
  Write-Host "  Legacy Docker WSL metadata repaired; backup retained at $backup" -ForegroundColor Yellow
  return $true
}

function Install-JhtContainerService {
  param(
    [Parameter(Mandatory)][string]$PodmanPath,
    [Parameter(Mandatory)][string]$UnitPath
  )
  $unitWsl = ConvertTo-WslPath $UnitPath
  # Never `systemctl daemon-reload` here (configure-podman-windows-network.ps1
  # says why): a unit seen for the first time is read from disk when started,
  # and a changed unit that is already loaded takes effect at the machine's
  # next start (after a Windows restart at the latest).
  $install = "sudo rm -f /home/user/.config/systemd/user/default.target.wants/jht-container.service /home/user/.config/systemd/user/jht-container.service && " +
    "sudo install -m 0644 $(Quote-Sh $unitWsl) /etc/systemd/system/jht-container.service && " +
    'sudo timeout 60 systemctl enable --no-reload jht-container.service && ' +
    '(sudo timeout 30 systemctl is-active --quiet jht-container.service || sudo timeout 120 systemctl start jht-container.service)'
  Invoke-Checked $PodmanPath 'machine' 'ssh' $MachineName $install
}

function Install-JhtStartupTask {
  param(
    [Parameter(Mandatory)][string]$PodmanPath,
    [Parameter(Mandatory)][string]$MachineName,
    [Parameter(Mandatory)][string]$UserId
  )
  $taskName = 'Job Hunter Team - Start runtime'
  $description = 'Starts the dedicated Job Hunter Team Podman machine at sign-in so the local team can resume after Windows restarts. It never starts or stops other Podman machines.'
  $arguments = "machine start --update-connection=false $MachineName"
  $action = New-ScheduledTaskAction -Execute $PodmanPath -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserId
  $principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
  # Keep the task visible in Task Scheduler: hiding a persistent logon action
  # makes inspection and manual removal needlessly difficult. Visibility is
  # unrelated to whether the command opens a console window.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::FromMinutes(10))
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Description $description -Force | Out-Null

  # Registration is part of the reboot contract, not a best-effort hint. Check
  # the exact executable, machine and user before publishing a successful install.
  $registered = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $registeredActions = @($registered.Actions)
  $registeredTriggers = @($registered.Triggers)
  $sameExecutable = $registeredActions.Count -eq 1 -and
    ([IO.Path]::GetFullPath([string]$registeredActions[0].Execute)).Equals(
      [IO.Path]::GetFullPath($PodmanPath), [StringComparison]::OrdinalIgnoreCase)
  if (-not $sameExecutable -or
      ([string]$registeredActions[0].Arguments) -cne $arguments -or
      $registeredTriggers.Count -ne 1 -or
      ([string]$registeredTriggers[0].UserId) -cne $UserId -or
      ([string]$registered.Principal.UserId) -cne $UserId -or
      ([string]$registered.Principal.LogonType) -notmatch '^Interactive' -or
      ([string]$registered.Principal.RunLevel) -cne 'Limited' -or
      [bool]$registered.Settings.Hidden -or
      ([string]$registered.Description) -cne $description) {
    throw "JHT startup task verification failed: $taskName"
  }
}

# Where Podman is: PATH as the system and the user have it NOW (a winget install
# of an earlier run is not in this process's PATH), then the folders of Podman's
# MSI, which installs for this user (%LocalAppData%\Programs\Podman) or for the
# computer (%ProgramFiles%\Podman) and writes the folder it chose under
# HKCU or HKLM\SOFTWARE\Podman, InstallDir. A podman.exe in another Windows
# user's profile is not readable from here, so it is never «found».
function Find-Podman {
  Update-ProcessPath
  $found = Get-Application 'podman.exe'
  if ($found) { return $found }
  $candidates = @(Join-Path $LocalAppData 'Programs\Podman\podman.exe')
  foreach ($key in 'HKCU:\SOFTWARE\Podman', 'HKLM:\SOFTWARE\Podman') {
    $dir = (Get-ItemProperty -LiteralPath $key -Name 'InstallDir' -ErrorAction SilentlyContinue).InstallDir
    if ($dir) { $candidates += Join-Path ([string]$dir) 'podman.exe' }
  }
  if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'Podman\podman.exe' }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf -ErrorAction SilentlyContinue) { return $candidate }
  }
  return $null
}

function Get-PodmanVersion {
  param([string]$Path)
  if (-not $Path) { return $null }
  $line = @(& { $ErrorActionPreference = 'Continue'; & $Path --version 2>$null }) | Select-Object -First 1
  if ([string]$line -match '^podman(?:\.exe)? version (\S+)$') { return $Matches[1] }
  return $null
}

# WSL opens its «Welcome to WSL» window (wslsettings) when one of the user's
# distributions gets registered, unless the user's Lxss key says the welcome was
# already shown: the DWORD OOBEComplete under HKCU\Software\Microsoft\Windows\
# CurrentVersion\Lxss (WSL's LxssUserSession::_LaunchOOBEIfNeeded). `podman machine
# init` registers one, so the window opened over the app in the middle of the setup.
# Written only when absent or 0, never anything else; a failure here only costs the
# window, never the setup.
function Skip-WslWelcome {
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
  try {
    $current = (Get-ItemProperty -LiteralPath $key -Name 'OOBEComplete' -ErrorAction SilentlyContinue).OOBEComplete
    if ($current) { return }
    if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
    New-ItemProperty -LiteralPath $key -Name 'OOBEComplete' -PropertyType DWord -Value 1 -Force | Out-Null
  } catch {
    Write-Warning "Could not mark the WSL welcome as shown: $($_.Exception.Message)"
  }
}

# winget's «already installed, no applicable update» (0x8A15002B): on a Try
# again after a later step failed, Podman is there already. It is a success
# only when the version installed is the one JHT pins; the check after the
# install decides, never the exit code alone.
$WingetUpdateNotApplicable = -1978335189

# Which Podman the team runs on. The pin is what the app installs, and what the
# setup screen names. A Podman of the same major, as new as the pin or newer, is
# used as it is, with a warning in the log: 6.1 changed nothing the team relies on
# (its new port-forwarding option is for published ports, and the team publishes
# none). An older 6 is brought to the pin by winget, as a missing one is. Another
# major is left alone: 6.0 dropped BoltDB, CNI and slirp4netns, so moving the
# person's Podman 5 to 6 could break what it already runs, and 7 is untested.
# Both are podman_version_mismatch, 24, and nothing is installed.
$PodmanSupportedMajor = 6

function Get-PodmanFit {
  param([string]$Version)
  if (-not $Version) { return 'absent' }
  if ($Version -eq $PodmanCliVersion) { return 'pinned' }
  if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)') { return 'other' }
  $have = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
  if ($PodmanCliVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') { return 'other' }
  $pin = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
  if ($have.Major -ne $PodmanSupportedMajor) { return 'other' }
  if ($have -ge $pin) { return 'newer' }
  return 'older'
}

function Write-PodmanMismatch {
  param([string]$Version)
  [Console]::Error.WriteLine("podman_version_mismatch: Podman $Version is installed on this computer, and JHT runs on Podman $PodmanSupportedMajor, from $PodmanCliVersion on; the app does not change another Podman.")
}

if ($InstallDependencies) {
  Write-JhtPhase podman_install
  $otherUser = $false
  $foundVersion = Get-PodmanVersion (Find-Podman)
  if ((Get-PodmanFit $foundVersion) -eq 'other') {
    Write-PodmanMismatch $foundVersion
    exit 24
  }
  try {
    if ((Get-PodmanFit $foundVersion) -in 'absent', 'older') {
      if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is required to install Podman dependencies.' }
      # «Already installed» while this user reaches no podman.exe: on a computer
      # with two Windows users the package is registered for the computer and
      # podman.exe sits in the other user's profile. Then once more, for this
      # user (--force: winget would stop at «already installed» again); what
      # the second pass leaves decides, never its exit code alone.
      # Not `--scope user`: the manifest's one installer is Podman's dual-scope
      # MSI with no scope declared, so winget finds «no applicable installer»
      # (-1978335216). The MSI itself is asked for this user, the Windows way for
      # a dual-scope package (ALLUSERS=2 MSIINSTALLPERUSER=1, into
      # %LocalAppData%\Programs\Podman); winget still checks the manifest's hash.
      # --override replaces winget's own switches, so the quiet ones are here too.
      foreach ($forThisUser in $false, $true) {
        $scope = if ($forThisUser) { @('--force', '--override', '/qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1') } else { @() }
        & winget install --exact --source winget --version $PodmanCliVersion --silent --disable-interactivity --accept-package-agreements --accept-source-agreements --id Podman.CLI @scope
        $wingetCode = $LASTEXITCODE
        if ($forThisUser) { $otherUser = -not (Find-Podman); break }
        if ($wingetCode -ne 0 -and $wingetCode -ne $WingetUpdateNotApplicable) {
          throw "winget install Podman.CLI $PodmanCliVersion exited with $wingetCode."
        }
        if ($wingetCode -ne $WingetUpdateNotApplicable -or (Find-Podman)) { break }
      }
    }
  } catch {
    [Console]::Error.WriteLine("podman_not_installable: $($_.Exception.Message)")
    exit 21
  }
  # Not a download that failed: the network is not the cause, and Try again
  # alone changes nothing.
  if ($otherUser) {
    [Console]::Error.WriteLine("podman_other_user: winget reports Podman CLI as installed on this computer, but this Windows user reaches no podman.exe (it is in another user's profile), and installing it for this user did not succeed (winget exited with $wingetCode).")
    exit 25
  }
  $installedVersion = Get-PodmanVersion (Find-Podman)
  $fit = Get-PodmanFit $installedVersion
  if ($installedVersion -and $fit -notin 'pinned', 'newer') {
    Write-PodmanMismatch $installedVersion
    exit 24
  }
  if ($fit -eq 'newer') {
    [Console]::Out.WriteLine("JHT_WARNING podman_version_newer: Podman $installedVersion is installed on this computer; JHT installs $PodmanCliVersion and uses this one as it is.")
  }
}
$Podman = Find-Podman
if (-not $Podman) { [Console]::Error.WriteLine('podman_not_installable: podman.exe is unavailable after installation.'); exit 21 }
try { Install-PrivateComposeProvider -Destination $ComposeProvider } catch {
  [Console]::Error.WriteLine("podman_not_installable: $($_.Exception.Message)")
  exit 21
}

try {
  # Windows PowerShell 5.1 gives a JSON array to the pipeline as ONE object: with a
  # second machine of this user, `$machine` was the whole list. Parse with -InputObject
  # and enumerate with foreach, the same in 5.1 and in PowerShell 7.
  $machinesJson = ((& $Podman machine list --format json) -join "`n")
  $parsedMachines = if ($machinesJson) { ConvertFrom-Json -InputObject $machinesJson } else { $null }
  $machines = @(foreach ($listed in $parsedMachines) { $listed })
  $machine = $machines | Where-Object Name -eq $MachineName | Select-Object -First 1
  if (-not $machine) {
    if (-not $InitializeMachine) { throw "Podman machine '$MachineName' is absent; re-run with -InitializeMachine." }
    Write-JhtPhase podman_machine_init
    Skip-WslWelcome
    Invoke-Checked $Podman 'machine' 'init' '--update-connection=false' '--provider' 'wsl' '--cpus' '2' '--memory' '3072' '--disk-size' '30' $MachineName
    Write-JhtPhase podman_machine_start
    Invoke-Checked $Podman 'machine' 'start' '--update-connection=false' $MachineName
  } elseif (-not [bool]$machine.Running) {
    Write-JhtPhase podman_machine_start
    Invoke-Checked $Podman 'machine' 'start' '--update-connection=false' $MachineName
  }
  Invoke-Checked $Podman '--connection' $MachineName 'info' | Out-Null
} catch {
  [Console]::Error.WriteLine("podman_machine_unavailable: $($_.Exception.Message)")
  exit 22
}

# The network script leaves with its own code (23, podman_network_unready, the
# reason on stderr): passed on as it is, never turned into a generic failure.
& (Join-Path $PSScriptRoot 'configure-podman-windows-network.ps1') -MachineName $MachineName
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($RuntimeImage -notmatch '^ghcr\.io/leopu00/jht(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[0-9a-f]{64})$') {
  throw 'Runtime image reference is not canonical.'
}
if (-not $ExpectedImageDigest -and $RuntimeImage -match '@(sha256:[0-9a-f]{64})$') {
  $ExpectedImageDigest = $Matches[1]
}
if ($ExpectedImageDigest -and $ExpectedImageDigest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'Expected runtime image digest is invalid.' }
if ($RuntimeImage -match '@(sha256:[0-9a-f]{64})$' -and $Matches[1] -ne $ExpectedImageDigest) {
  throw 'Runtime image reference and expected digest disagree.'
}
Write-JhtPhase image_pull
Invoke-Checked $Podman '--connection' $MachineName 'pull' $RuntimeImage | Out-Null
$repoDigestsJson = ((& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName image inspect $RuntimeImage --format '{{json .RepoDigests}}' 2>$null }) -join '')
if ($LASTEXITCODE -ne 0 -or -not $repoDigestsJson) { throw 'Cannot inspect the pulled runtime image digest.' }
# Windows PowerShell 5.1, the shell the app runs, does not enumerate a JSON
# array through the pipeline: `@($json | ConvertFrom-Json)` was ONE element, the
# whole array, so no digest ever equalled the expected one and every pull was
# refused (Podman 6 lists two, the index and the platform manifest). foreach
# enumerates the parsed array in 5.1 and in PowerShell 7 alike.
$parsedRepoDigests = ConvertFrom-Json -InputObject $repoDigestsJson
$repoDigests = @(foreach ($digest in $parsedRepoDigests) { [string]$digest })
$matchingRepoDigests = @($repoDigests | Where-Object { $_ -match '^ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}$' })
if ($ExpectedImageDigest) {
  $canonicalImage = "ghcr.io/leopu00/jht@$ExpectedImageDigest"
  if ($matchingRepoDigests -notcontains $canonicalImage) { throw 'Pulled runtime image does not expose the expected repository digest.' }
} else {
  # Preserve the production JHT_IMAGE tag override. It is resolved once to
  # the immutable identity reported by Podman; only the build test channel
  # requires that identity to match an independently supplied digest.
  $canonicalImage = $matchingRepoDigests | Select-Object -First 1
  if (-not $canonicalImage) { throw 'Pulled runtime image has no canonical repository digest.' }
}
$env:JHT_IMAGE = $canonicalImage

$legacyInstallDetected = (Test-Path -LiteralPath (Join-Path $JhtHome 'jht.config.json')) -or
  (Test-Path -LiteralPath (Join-Path $JhtHome 'profile')) -or
  (Test-Path -LiteralPath (Join-Path $JhtHome '.codex'))
if ($legacyInstallDetected) {
  Write-Host 'Existing JHT config, profile and Codex login will be reused in Podman; Documents stay in their current folder.' -ForegroundColor Yellow
  Write-Host 'If the old game stored a mail password, rotate that app password after startup; the broker migration will keep warning until setup is renewed.' -ForegroundColor Yellow
  $legacyDocker = ''
  if ($env:ProgramFiles) {
    $dockerDesktopCli = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
    if (Test-Path -LiteralPath $dockerDesktopCli -PathType Leaf) { $legacyDocker = $dockerDesktopCli }
  }
  Report-LegacyDockerVolumes -DockerPath $legacyDocker
}

$metadataRepaired = Repair-LegacyBindMetadata -PodmanPath $Podman

New-Item -ItemType Directory -Path $RuntimeDir, $RuntimeShimDir, $BinDir, $JhtHome -Force | Out-Null
# Set-JhtAccessControl and the ~/.jht ACL functions.
$helperSource = Join-Path $PSScriptRoot 'windows-private-acl.ps1'
. $helperSource
Protect-OwnerOnlyDirectory -Path $RuntimeDir
$legacyShim = Join-Path $BinDir 'docker.exe'
$legacyShimOwned = Test-AttestedLegacyDockerShim `
  -ManifestPath (Join-Path $RuntimeDir '.runtime-integrity') -LegacyShimPath $legacyShim
if (-not (Test-PrivateJhtHomeAcl -Path $JhtHome)) { Protect-JhtHomeAcl -Path $JhtHome }

$files = @{
  (Join-Path $RepoRoot 'docker-compose.yml') = (Join-Path $RuntimeDir 'docker-compose.yml')
  (Join-Path $RepoRoot 'docker-compose.podman.yml') = (Join-Path $RuntimeDir 'docker-compose.podman.yml')
  (Join-Path $PSScriptRoot 'jht-wrapper.ps1') = (Join-Path $BinDir 'jht.ps1')
  $helperSource = (Join-Path $BinDir 'windows-private-acl.ps1')
}
foreach ($entry in $files.GetEnumerator()) { Copy-Item -LiteralPath $entry.Key -Destination $entry.Value -Force }
$selectionFile = Join-Path $RuntimeDir 'container-runtime'
[IO.File]::WriteAllText($selectionFile, "podman`n", [Text.UTF8Encoding]::new($false))
$machineFile = Join-Path $RuntimeDir 'podman-machine'
[IO.File]::WriteAllText($machineFile, "$MachineName`n", [Text.UTF8Encoding]::new($false))
$containerUnitFile = Join-Path $RuntimeDir 'jht-container.service'
$containerUnit = @'
[Unit]
Description=Job Hunter Team container
Requires=jht-windows-egress-proxy.service
After=jht-windows-egress-proxy.service
Requires=jht-rootless-podman.service
After=jht-rootless-podman.service
Requires=user-runtime-dir@1000.service
After=user-runtime-dir@1000.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=user
Group=user
Environment=HOME=/home/user
Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=CONTAINERS_CGROUP_MANAGER=cgroupfs
ExecStart=/usr/bin/podman --remote --url unix:///run/user/1000/podman/podman.sock start --sig-proxy=false jht-broker jht-telegram jht
ExecStop=-/usr/bin/podman --remote --url unix:///run/user/1000/podman/podman.sock stop --time 30 jht jht-telegram jht-broker
TimeoutStartSec=90
TimeoutStopSec=45

[Install]
WantedBy=multi-user.target
'@
[IO.File]::WriteAllText($containerUnitFile, ($containerUnit.Trim() + "`n"), [Text.UTF8Encoding]::new($false))
$shim = Join-Path $RuntimeShimDir 'docker.exe'
New-DockerShim -Destination $shim -PodmanPath $Podman -MachineName $MachineName

$composeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RuntimeDir 'docker-compose.yml')).Hash.ToLowerInvariant()
$podmanHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RuntimeDir 'docker-compose.podman.yml')).Hash.ToLowerInvariant()
$wrapperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $BinDir 'jht.ps1')).Hash.ToLowerInvariant()
$shimHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $shim).Hash.ToLowerInvariant()
$helperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $BinDir 'windows-private-acl.ps1')).Hash.ToLowerInvariant()
$selectionHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $selectionFile).Hash.ToLowerInvariant()
$machineHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $machineFile).Hash.ToLowerInvariant()
$containerUnitHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $containerUnitFile).Hash.ToLowerInvariant()
$runtimeImageFile = Join-Path $RuntimeDir 'runtime-image'
$runtimeImageManifest = ''
if ($PersistImagePin) {
  [IO.File]::WriteAllText($runtimeImageFile, "$canonicalImage`n", [Text.UTF8Encoding]::new($false))
  $runtimeImageHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $runtimeImageFile).Hash.ToLowerInvariant()
  $runtimeImageManifest = "runtime-image=$runtimeImageHash`n"
} else {
  Remove-Item -LiteralPath $runtimeImageFile -Force -ErrorAction SilentlyContinue
}
$manifest = "version=1`ndocker-compose.yml=$composeHash`njht-wrapper.ps1=$wrapperHash`ndocker-compose.podman.yml=$podmanHash`ndocker.exe=$shimHash`ncontainer-runtime=$selectionHash`npodman-machine=$machineHash`njht-container.service=$containerUnitHash`nwindows-private-acl.ps1=$helperHash`n$runtimeImageManifest"
[IO.File]::WriteAllText((Join-Path $RuntimeDir '.runtime-integrity'), $manifest, [Text.UTF8Encoding]::new($false))
if ($legacyShimOwned) {
  Remove-Item -LiteralPath $legacyShim -Force -ErrorAction Stop
}

[Environment]::SetEnvironmentVariable('JHT_CONTAINER_RUNTIME', 'podman', 'User')
[Environment]::SetEnvironmentVariable('JHT_PODMAN_MACHINE', $MachineName, 'User')
$env:JHT_CONTAINER_RUNTIME = 'podman'
$env:JHT_PODMAN_MACHINE = $MachineName
$env:PATH = "$RuntimeShimDir$([IO.Path]::PathSeparator)$env:PATH"

# No double quote inside a native argument: Windows PowerShell 5.1, the shell the app runs, drops it,
# and `{{index .Config.Labels "com.docker.compose.project"}}` reached Podman as
# `index .Config.Labels com.docker...` (function "com" not defined: the setup stopped, T71). The
# labels come whole as JSON and the project is read here.
# On a new machine there is no container jht yet: Podman says "no such object" on stderr and the output is empty.
[string]$existingLabelsJson = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect jht --format '{{json .Config.Labels}}' 2>$null } | Select-Object -First 1)
$existingProject = ''
if ($existingLabelsJson.Trim()) {
  $existingLabels = $null
  try { $existingLabels = ConvertFrom-Json -InputObject $existingLabelsJson } catch { $existingLabels = $null }
  if ($existingLabels) { $existingProject = ([string]$existingLabels.'com.docker.compose.project').Trim() }
}
[string]$existingCgroupManager = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect jht --format '{{.HostConfig.CgroupManager}}' 2>$null } | Select-Object -First 1)
$existingCgroupManager = $existingCgroupManager.Trim()
$containerNeedsMigration = $existingProject -and ($existingProject -ne 'jht' -or $existingCgroupManager -ne 'cgroupfs')
if ($containerNeedsMigration) {
  [string]$existingRunning = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect jht --format '{{.State.Running}}' 2>$null } | Select-Object -First 1)
  $existingRunning = $existingRunning.Trim()
  if ($existingRunning -eq 'true') { Invoke-Checked $Podman '--connection' $MachineName 'stop' '--time' '30' 'jht' | Out-Null }
  # The container has only bind mounts and named volumes. Removing the stopped
  # metadata object keeps both kinds of data intact and lets the installed
  # Compose project take ownership under the stable name above.
  Invoke-Checked $Podman '--connection' $MachineName 'rm' 'jht' | Out-Null
  Write-Host "  Migrated existing JHT container (project='$existingProject', cgroups='$existingCgroupManager'); volumes retained." -ForegroundColor Yellow
}

# A service whose user namespace does not map its own user never starts: Podman refuses it at every
# start, "container uses ID mappings ... but doesn't map UID 1003" (T85, jht-telegram with the map
# 1001:0:1 alone). Compose does not recreate a service whose configuration did not change, so a
# container created so stayed so at every setup. As jht above: it is removed, its volumes stay, and
# `jht up` creates it again.
$sidecarRemoved = $false
foreach ($sidecar in @('jht-broker', 'jht-telegram')) {
  # No double quote inside a native argument (T71). A container that is not there: empty, and skipped.
  [string]$sidecarDetails = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect --type container $sidecar --format '{{.Config.User}}|{{json .HostConfig.IDMappings}}' 2>$null } | Select-Object -First 1)
  if (-not $sidecarDetails.Trim() -or (Test-ContainerMapsItsUser -Details $sidecarDetails)) { continue }
  [string]$sidecarRunning = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect --type container $sidecar --format '{{.State.Running}}' 2>$null } | Select-Object -First 1)
  if ($sidecarRunning.Trim() -eq 'true') { Invoke-Checked $Podman '--connection' $MachineName 'stop' '--time' '30' $sidecar | Out-Null }
  Invoke-Checked $Podman '--connection' $MachineName 'rm' $sidecar | Out-Null
  $sidecarRemoved = $true
  Write-Host "  Recreating ${sidecar}: its user namespace did not map its own user; volumes retained." -ForegroundColor Yellow
}

if ($metadataRepaired -or $sidecarRemoved -or -not (& $Podman --connection $MachineName ps --format '{{.Names}}' | Where-Object { $_ -eq 'jht' })) {
  & (Join-Path $BinDir 'jht.ps1') up
  if ($LASTEXITCODE -ne 0) { throw 'The migrated JHT container did not start.' }
}

Install-JhtContainerService -PodmanPath $Podman -UnitPath $containerUnitFile
$currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if (-not $currentUserSid) { throw 'Cannot identify the Windows user for runtime startup.' }
Install-JhtStartupTask -PodmanPath $Podman -MachineName $MachineName -UserId $currentUserSid

Write-Host "PODMAN JHT RUNTIME ENABLED (machine=$MachineName, wrapper=$(Join-Path $BinDir 'jht.ps1'))" -ForegroundColor Green
