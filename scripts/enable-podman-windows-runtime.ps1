# Convert an existing Windows JHT installation to the Podman backend. The
# Docker-compatible host wrapper remains the product boundary; docker.exe is a
# native, attested shim that forwards argv and exit codes to podman.exe.

[CmdletBinding()]
param(
  [string]$MachineName = 'jht-podman',
  [switch]$InstallDependencies,
  [switch]$InitializeMachine,
  [string]$RuntimeImage = 'ghcr.io/leopu00/jht@sha256:fa78c975c04dd5f95d6225a35c8c3bb9646f8ef14b32c8ca558d5332de0cce00',
  [string]$ExpectedImageDigest = '',
  [switch]$PersistImagePin,
  [ValidateSet('', 'core')][string]$RuntimeTier = ''
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
$PodmanRegistryPaths = @('HKCU:\SOFTWARE\Podman', 'HKLM:\SOFTWARE\Podman')
$PodmanCliVersion = '6.0.2'
# Podman for THIS Windows user without winget, the Windows Installer or an administrator (JHT-T184, JHT-T144): the official
# release's zip, pinned like docker-compose below. The SHA-256 is that of the asset of the release named by $PodmanCliVersion;
# changing the version means changing it (tests/test_podman_windows_setup_retry.py reads both from here). Nothing is
# extracted before the digest matches, and only the three programs named here are taken out, by their exact names.
$PodmanZipUrl = "https://github.com/podman-container-tools/podman/releases/download/v$PodmanCliVersion/podman-remote-release-windows_amd64.zip"
$PodmanZipSha256 = '2c055d363de03de917f79568a78b7d5902fc40453bbcc141ca18cf0a1fa1b78e'
$PodmanZipPrograms = @('podman.exe', 'gvproxy.exe', 'win-sshproxy.exe')
$ComposeProviderVersion = '5.1.2'
# JHT's own docker-compose.exe, private to the runtime: never one found in
# PATH (Docker Desktop ships its own, of another version). The release asset
# and SHA-256 are those of winget's Docker.DockerCompose 5.1.2 manifest; the
# CI parity gate (.github/workflows/test.yml) reads both from here.
$ComposeProviderUrl = 'https://github.com/docker/compose/releases/download/v5.1.2/docker-compose-windows-x86_64.exe'
$ComposeProviderSha256 = '00e839301ca18ee5109b3ef086788f3a281c317c0b77ba42a06fc6f806401255'
$ComposeProvider = Join-Path $RuntimeShimDir 'docker-compose.exe'

# JHT_PHASE lines are for the desktop app, which reads this script's output
# through a pipe; at a terminal they are noise. The installer that runs this
# script passes its own answer in JHT_MACHINE_OUTPUT (1 or 0); started alone,
# they follow whether the output is redirected.
function Write-JhtPhase {
  param([Parameter(Mandatory)][ValidateSet(
    'wsl_check', 'podman_install', 'podman_machine_init',
    'podman_machine_start', 'runtime_download', 'image_pull', 'team_restart'
  )][string]$Id)
  # JHT_MACHINE_OUTPUT=1 asks for the line, =0 refuses it; unset, it follows whether the output is redirected.
  $machine = if ($env:JHT_MACHINE_OUTPUT -eq '1') { $true } elseif ($env:JHT_MACHINE_OUTPUT -eq '0') { $false } else { [Console]::IsOutputRedirected }
  if ($machine) { [Console]::Out.WriteLine("JHT_PHASE $Id"); if ($env:JHT_PHASE_TIMES -eq '1') { [Console]::Out.WriteLine("JHT_TIME $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')) $Id") } }
}

# Podman's pull progress for the app: the layers it says it copies, one JHT_PULL line each (a redrawn
# bar is its last drawing), with anything private taken out. With -AnyLine every other line of podman's
# comes back too, cleaned the same way: it is what a failed pull leaves on stderr, never on JHT_PULL.
function ConvertTo-JhtPullLine {
  param([AllowNull()][string]$Text, [switch]$AnyLine)
  if ($null -eq $Text) { return $null }
  $last = ($Text -split "`r")[-1]
  $last = [regex]::Replace($last, '[\x00-\x1f\x7f]', ' ').Trim()
  if (-not $last) { return $null }
  if (-not $AnyLine -and $last -notmatch '^Copying (blob|config) ') { return $null }
  $last = [regex]::Replace($last, '[A-Za-z]:\\\S*', '<path>')
  # a name of one or two characters would damage any line it appears in: only the longer ones are taken out
  foreach ($private in @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:USERNAME)) {
    if ($private -and $private.Length -ge 3) { $last = $last.Replace($private, '<private>') }
  }
  if ($last.Length -gt 160) { $last = $last.Substring(0, 160) }
  return $last
}

# The image pull, with its progress on stdout for the app. Under 'Stop' Windows PowerShell 5.1 turns the
# first byte of a redirected stderr into an error: the redirection lives in a 'Continue' scope, and the
# exit code is read right after the pipeline that consumed all of it. What podman says that is not
# progress is not lost: when the pull fails, its last five lines (cleaned) go to stderr before the throw,
# where the app keeps the cause of a failed setup.
function Invoke-PodmanPull {
  param([Parameter(Mandatory)][string]$PodmanPath, [Parameter(Mandatory)][string]$Machine, [Parameter(Mandatory)][string]$Image)
  $others = New-Object System.Collections.Generic.List[string]
  & { $ErrorActionPreference = 'Continue'
    & $PodmanPath '--connection' $Machine 'pull' $Image 2>&1 | ForEach-Object {
      $line = ConvertTo-JhtPullLine ([string]$_)
      if ($line) { [Console]::Out.WriteLine("JHT_PULL $line"); return }
      $other = ConvertTo-JhtPullLine ([string]$_) -AnyLine
      if ($other) { $others.Add($other); if ($others.Count -gt 5) { $others.RemoveAt(0) } }
    }
  }
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    foreach ($other in $others) { [Console]::Error.WriteLine("podman pull: $other") }
    throw "Command failed ($code): $PodmanPath --connection $Machine pull $Image"
  }
}

. (Join-Path $PSScriptRoot 'podman-machine-bridge.ps1')

# `jht up` says the containers were created, not that they stay up: with a runtime image that lacks the
# broker's or the Telegram service's binary, the broker restarts in a loop and the Telegram service exits
# 127, and the setup still went on to "Installation complete!" with exit 0. A container is up when it has
# been running, under one single start, for $SettleSeconds. What is not so at the deadline comes back, one
# line per container with its state and exit code (the logs stay in `jht logs`); nothing comes back when
# every container is up.
function Get-UnsettledJhtContainers {
  param(
    [Parameter(Mandatory)][string]$Podman,
    [Parameter(Mandatory)][string]$MachineName,
    [Parameter(Mandatory)][string[]]$Names,
    [int]$TimeoutSeconds = 60,
    [int]$SettleSeconds = 4,
    [int]$SampleSeconds = 1
  )
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $runningSince = @{}
  while ($true) {
    $unsettled = @()
    foreach ($name in $Names) {
      # No double quote inside a native argument, and the stderr of a container that is not there is dropped (T71, T82).
      $out = @(& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect --type container $name --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.StartedAt}}' 2>$null })
      $line = if ($out.Count -gt 0) { ([string]$out[0]).Trim() } else { '' }
      $parts = $line.Split('|')
      if ($parts.Count -lt 3) { $runningSince.Remove($name); $unsettled += "$name is not there"; continue }
      if ($parts[0] -ne 'running') {
        $runningSince.Remove($name)
        $unsettled += "$name is $($parts[0]) (exit $($parts[1]))"
        continue
      }
      if (-not $runningSince.ContainsKey($name) -or $runningSince[$name].Start -ne $parts[2]) {
        $runningSince[$name] = @{ Start = $parts[2]; Clock = $watch.Elapsed.TotalSeconds }
      }
      if (($watch.Elapsed.TotalSeconds - $runningSince[$name].Clock) -lt $SettleSeconds) { $unsettled += "$name keeps restarting" }
    }
    if ($unsettled.Count -eq 0) { return @() }
    if ($watch.Elapsed.TotalSeconds -ge $TimeoutSeconds) { return $unsettled }
    Start-Sleep -Seconds $SampleSeconds
  }
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

# A file of the bundle belongs to the user who installs it (T103). An elevated process of an
# administrator creates files owned by BUILTIN\Administrators, and the wrapper trusts only files of
# the current user (Test-ProtectedRuntimeNode): the first `jht up` of this script refused the whole
# bundle, "untrusted host runtime path, owner, reparse point or SHA-256". install.ps1 gives the files
# to the user too, but only after this script has returned. The owner changes only where it is not the
# user already, so an install that is not elevated writes nothing; and only the owner section is
# written (Set-JhtAccessControl), never the SACL that Set-Acl would need SeSecurityPrivilege for.
function Set-JhtOwnerToCurrentUser {
  param([Parameter(Mandatory)][string]$Path)
  # Elevated, on paths in the user's own folders: a file, or a folder above it, replaced by a link
  # would carry the change of owner outside the bundle. Refused before anything is read or written,
  # as install.ps1 refuses a reparse-point ancestor of the runtime folder.
  $node = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  while ($node) {
    if (($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "A runtime file or a folder above it is a reparse point: $Path" }
    $parent = if ($node.PSIsContainer) { $node.Parent } else { $node.Directory }
    if (-not $parent -or $parent.FullName -eq $node.FullName) { break }
    $node = $parent
  }
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  # Not only a write saved: a user who is not elevated may not write an owner at all, not even itself
  # ("unauthorized operation", measured under 5.1 and 7), so this return is what lets a normal setup go on.
  $owner = $acl.Owner
  if (([Security.Principal.NTAccount]$owner).Translate([Security.Principal.SecurityIdentifier]).Value -eq $user.Value) { return }
  $acl.SetOwner($user)
  try {
    Set-JhtAccessControl -Path $Path -Acl $acl
  } catch {
    throw "Cannot make a runtime file owned by the current user (it is owned by $owner): $Path. $($_.Exception.Message)"
  }
  $after = (Get-Acl -LiteralPath $Path -ErrorAction Stop).Owner
  if (([Security.Principal.NTAccount]$after).Translate([Security.Principal.SecurityIdentifier]).Value -ne $user.Value) {
    throw "The owner is not the current user: $Path"
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
  $owner = (& { $ErrorActionPreference = 'Continue'; Invoke-JhtPodmanMachine -FilePath $PodmanPath -Arguments @('machine', 'ssh', $MachineName, "stat -c '%u' $(Quote-Sh $wslPath)") 2>$null } | Select-Object -Last 1)
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

  # The folder of the backup is made new and under a name nobody can guess (a time was a name the agents, who write in this
  # folder, could foresee and take with a link): `New-Item` without -Force refuses a name that exists, a link included, and a
  # folder that is a reparse point once made is refused as well, so the data of the team never goes through one.
  $backup = Join-Path $JhtHome ('podman-metadata-backup-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + '-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $backup -ErrorAction Stop | Out-Null
  if (((Get-Item -LiteralPath $backup -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "The backup folder is a reparse point: $backup"
  }
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

# Where Podman is: PATH as the system and the user have it NOW (a winget install
# of an earlier run is not in this process's PATH), then the folders of Podman's
# MSI, which installs for this user (%LocalAppData%\Programs\Podman) or for the
# computer (%ProgramFiles%\Podman) and writes the folder it chose under
# HKCU or HKLM\SOFTWARE\Podman, InstallDir. A podman.exe in another Windows
# user's profile is not readable from here, so it is never «found».
function Find-Podman {
  param(
    # These are parameters, rather than ambient reads throughout the function,
    # so the lookup can be exercised on a Windows runner without seeing that
    # runner's installed Podman. The defaults are the production sources.
    [string]$MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [string]$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User'),
    [string]$ProcessPath = $env:PATH,
    [string]$LocalAppDataPath = $LocalAppData,
    [string[]]$RegistryPaths = $PodmanRegistryPaths,
    [string]$ProgramFilesPath = $env:ProgramFiles
  )
  Update-ProcessPath -MachinePath $MachinePath -UserPath $UserPath -ProcessPath $ProcessPath
  $found = Get-Application 'podman.exe'
  if ($found) { return $found }
  $candidates = @(Join-Path $LocalAppDataPath 'Programs\Podman\podman.exe')
  foreach ($key in $RegistryPaths) {
    $dir = (Get-ItemProperty -LiteralPath $key -Name 'InstallDir' -ErrorAction SilentlyContinue).InstallDir
    if ($dir) { $candidates += Join-Path ([string]$dir) 'podman.exe' }
  }
  if ($ProgramFilesPath) { $candidates += Join-Path $ProgramFilesPath 'Podman\podman.exe' }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf -ErrorAction SilentlyContinue) { return $candidate }
  }
  return $null
}

# Where winget is (JHT-T184): the PATH as the system and the user have it NOW, then the alias folder of THIS user.
# App Installer registers winget.exe as an app-execution alias in %LOCALAPPDATA%\Microsoft\WindowsApps of the user it
# was installed for; an account whose PATH names another user's WindowsApps (made from an administrator's profile)
# never finds it by its name, although it is there.
function Find-Winget {
  param(
    # Parameters, as in Find-Podman, so the lookup can be exercised without the PATH of the machine that runs it.
    [string]$MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [string]$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User'),
    [string]$ProcessPath = $env:PATH,
    [string]$LocalAppDataPath = $LocalAppData
  )
  Update-ProcessPath -MachinePath $MachinePath -UserPath $UserPath -ProcessPath $ProcessPath
  # The program on the PATH, or else a function or alias of the session by that name (as a bare `winget` always found).
  $command = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) { $command = Get-Command winget -CommandType Function, Alias -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if ($command) { return $(if ($command.Source) { $command.Source } else { 'winget' }) }
  if ($LocalAppDataPath) {
    $alias = Join-Path $LocalAppDataPath 'Microsoft\WindowsApps\winget.exe'
    if (Test-Path -LiteralPath $alias -ErrorAction SilentlyContinue) { return $alias }
  }
  return $null
}

# winget found and reachable by its name for the commands that follow: its folder goes to this process's PATH only.
function Use-Winget {
  $found = Find-Winget
  if (-not $found) { return $false }
  $folder = Split-Path -Parent $found
  if ($folder -and -not (($env:PATH -split [IO.Path]::PathSeparator) -contains $folder)) {
    $env:PATH = $folder + [IO.Path]::PathSeparator + $env:PATH
  }
  return $true
}

function Get-PodmanVersion {
  param([string]$Path)
  if (-not $Path) { return $null }
  $line = @(& { $ErrorActionPreference = 'Continue'; & $Path --version 2>$null }) | Select-Object -First 1
  if ([string]$line -match '^podman(?:\.exe)? version (\S+)$') { return $Matches[1] }
  return $null
}

# The folder of Podman for this user is added to this user's PATH (as Podman's own per-user MSI does), once, where the
# user's PATH lives (HKCU\Environment, kept as the expandable string it is), and to this process's PATH. The system is told
# the environment changed, so the programs started after this one see it.
function Add-UserPathEntry {
  param(
    [Parameter(Mandatory)][string]$Folder,
    [string]$EnvironmentKey = 'HKCU:\Environment',
    [switch]$NoBroadcast
  )
  $key = Get-Item -LiteralPath $EnvironmentKey
  $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $parts = @($current -split ';' | Where-Object { $_ })
  $wanted = $Folder.TrimEnd('\')
  if (-not @($parts | Where-Object { $_.TrimEnd('\') -ieq $wanted })) {
    Set-ItemProperty -LiteralPath $EnvironmentKey -Name 'Path' -Value ((@($parts) + $Folder) -join ';') -Type ExpandString
    if (-not $NoBroadcast) {
      # setting a variable of the user broadcasts «the environment changed»; a throw-away one, put and taken away
      [Environment]::SetEnvironmentVariable('JHT_ENV_REFRESH', '1', 'User')
      [Environment]::SetEnvironmentVariable('JHT_ENV_REFRESH', $null, 'User')
    }
  }
  if (-not (($env:PATH -split [IO.Path]::PathSeparator) -contains $Folder)) {
    $env:PATH = $Folder + [IO.Path]::PathSeparator + $env:PATH
  }
}

# Podman for this Windows user from the official release's zip (the way out when winget is missing, its list of programs is
# empty, or Podman is registered for another Windows user): downloaded into the user's own folder, its SHA-256 checked BEFORE
# anything is read out of it, then the three programs taken out by their exact names (no name comes from the zip, so no entry
# can lead outside the folder), written beside the final names and moved over them, the version asked of the result.
# $Url may be a file of this computer (the tests); a real address is never one.
function Install-PodmanForThisUser {
  param(
    [string]$Destination = (Join-Path $LocalAppData 'Programs\Podman'),
    [string]$Url = $PodmanZipUrl,
    [string]$Sha256 = $PodmanZipSha256,
    [string]$Version = $PodmanCliVersion,
    [switch]$NoPath
  )
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  if ((Get-Item -LiteralPath $Destination -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "the folder $Destination is a link: Podman is not put there"
  }
  $zipFile = Join-Path $Destination ".podman-$PID.zip"
  $staged = New-Object System.Collections.Generic.List[string]
  # Windows PowerShell's progress bar slows a large download by minutes.
  $previousProgress = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    if ([IO.File]::Exists($Url)) { Copy-Item -LiteralPath $Url -Destination $zipFile -Force }
    else { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $zipFile -ErrorAction Stop }
    # The file is opened ONCE, for reading, with a share mode that lets nobody write to it or delete it while it is open: the
    # digest is taken of that open file and the archive is read from the same stream, so what is checked is what is read
    # (a file put in its place between the check and the reading is not read).
    $stream = [IO.File]::Open($zipFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      $hasher = [System.Security.Cryptography.SHA256]::Create()
      try { $actual = ([BitConverter]::ToString($hasher.ComputeHash($stream)) -replace '-', '') } finally { $hasher.Dispose() }
      if ($actual -ne $Sha256) { throw "the Podman $Version download has SHA-256 $actual, expected $Sha256" }
      $stream.Position = 0
      Add-Type -AssemblyName System.IO.Compression
      $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Read, $true)
      try {
        foreach ($name in $PodmanZipPrograms) {
          $entry = $archive.GetEntry("podman-$Version/usr/bin/$name")
          if (-not $entry -or $entry.Length -le 0 -or $entry.Length -gt 200MB) { throw "the Podman $Version download has no usable $name" }
          $target = Join-Path $Destination "$name.new-$PID"
          $staged.Add($target)
          $from = $entry.Open()
          try {
            $to = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
            try { $from.CopyTo($to) } finally { $to.Dispose() }
          } finally { $from.Dispose() }
        }
      } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
    for ($i = 0; $i -lt $PodmanZipPrograms.Count; $i++) {
      Move-Item -LiteralPath $staged[$i] -Destination (Join-Path $Destination $PodmanZipPrograms[$i]) -Force
    }
  } finally {
    $ProgressPreference = $previousProgress
    Remove-Item -LiteralPath $zipFile -Force -ErrorAction SilentlyContinue
    foreach ($left in $staged) { Remove-Item -LiteralPath $left -Force -ErrorAction SilentlyContinue }
  }
  $got = Get-PodmanVersion (Join-Path $Destination 'podman.exe')
  if ($got -ne $Version) { throw "the podman.exe taken out of the download says version '$got', not $Version" }
  if (-not $NoPath) { Add-UserPathEntry -Folder $Destination }
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

# winget's «the data the source needs is missing» (0x8A15000F): an App Installer that was just installed for this user has
# an EMPTY list of programs, and every search or install answers this (JHT-T184). `winget source update` fills it, so it
# is run once and the install is asked again; if the list is still empty the person is told what to do about it.
$WingetSourceDataMissing = -1978335217

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
  $viaZip = $false
  $wingetFailure = ''
  $foundVersion = Get-PodmanVersion (Find-Podman)
  if ((Get-PodmanFit $foundVersion) -eq 'other') {
    Write-PodmanMismatch $foundVersion
    exit 24
  }
  try {
    if ((Get-PodmanFit $foundVersion) -in 'absent', 'older') {
      # No winget to use (it is not there, or its list of programs stays empty): Podman for this user from the official
      # release (below), not a stop. winget is asked first because it is the way a person with winget expects.
      $viaZip = -not (Use-Winget)
      if (-not $viaZip) {
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
          foreach ($attempt in 1, 2) {
            & winget install --exact --source winget --version $PodmanCliVersion --silent --disable-interactivity --accept-package-agreements --accept-source-agreements --id Podman.CLI @scope
            $wingetCode = $LASTEXITCODE
            if ($wingetCode -ne $WingetSourceDataMissing -or $attempt -eq 2) { break }
            & winget source update --disable-interactivity
          }
          if ($wingetCode -eq $WingetSourceDataMissing) { $viaZip = $true; break }
          if ($forThisUser) { $otherUser = -not (Find-Podman); break }
          if ($wingetCode -ne 0 -and $wingetCode -ne $WingetUpdateNotApplicable) {
            # Whatever else winget fails with (1601: the Windows Installer it runs is unreachable from a session without a
            # desktop; a package refused; a network error) is no stop: Podman for this user from the official release, below.
            $wingetFailure = "winget exited with $wingetCode"
            $viaZip = $true
            break
          }
          if ($wingetCode -ne $WingetUpdateNotApplicable -or (Find-Podman)) { break }
        }
      }
    }
  } catch {
    # winget itself could not be run: the same way out as when it fails
    $wingetFailure = $_.Exception.Message
    $viaZip = $true
  }
  # winget reported success and left this user no podman.exe: the files decide, not the exit code
  if (-not $viaZip -and -not $otherUser -and ((Get-PodmanFit $foundVersion) -in 'absent', 'older') -and -not (Find-Podman)) {
    $wingetFailure = 'winget reported success but left no podman.exe for this user'
    $viaZip = $true
  }
  # Podman for this user from the official release: when winget is missing, fails (whatever the code), or its list stays
  # empty, and when Podman is registered for another Windows user and winget could not put one in this user's folder. A zip
  # that fails is its own reason (the download, the digest), with winget's beside it; for the other user's case the code
  # stays the one the app tells that from.
  if ($viaZip -or $otherUser) {
    if ($wingetFailure) {
      [Console]::Out.WriteLine("winget could not install Podman ($wingetFailure): installing it for this Windows user from the official release instead.")
    }
    try {
      Install-PodmanForThisUser
      $otherUser = $false
      [Console]::Out.WriteLine("Podman $PodmanCliVersion was installed for this Windows user from the official release, without winget.")
    } catch {
      $reason = $_.Exception.Message
      if ($wingetFailure) { $reason = "$reason (winget: $wingetFailure)" }
      if (-not $otherUser) {
        [Console]::Error.WriteLine("podman_not_installable: $reason")
        exit 21
      }
      [Console]::Error.WriteLine("podman zip: $reason")
    }
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
  $machinesJson = ((Invoke-JhtPodmanMachine -FilePath $Podman -Arguments @('machine', 'list', '--format', 'json')) -join "`n")
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
Invoke-PodmanPull -PodmanPath $Podman -Machine $MachineName -Image $RuntimeImage
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
$bridgeSource = Join-Path $PSScriptRoot 'podman-machine-bridge.ps1'
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
  $bridgeSource = (Join-Path $BinDir 'podman-machine-bridge.ps1')
  (Join-Path $PSScriptRoot 'jht-integration.ps1') = (Join-Path $RuntimeDir 'jht-integration.ps1')
}
# Each one takes its place by a temporary file beside it (Publish-JhtFile): a program that holds a file of the bin folder open for a
# moment must not leave it truncated, and a file that is already these bytes is not touched.
foreach ($entry in $files.GetEnumerator()) { Publish-JhtFile -Destination $entry.Value -Bytes ([IO.File]::ReadAllBytes($entry.Key)) }
$selectionFile = Join-Path $RuntimeDir 'container-runtime'
[IO.File]::WriteAllText($selectionFile, "podman`n", [Text.UTF8Encoding]::new($false))
$machineFile = Join-Path $RuntimeDir 'podman-machine'
[IO.File]::WriteAllText($machineFile, "$MachineName`n", [Text.UTF8Encoding]::new($false))
$containerUnitFile = Join-Path $RuntimeDir 'jht-container.service'
# Environment=CONTAINERS_CGROUP_MANAGER in this unit sets nothing: it is not a Podman setting, and
# these are `podman --remote` calls, where the cgroup manager is the service's. The service gets it
# as its own flag, --cgroup-manager=cgroupfs (configure-podman-windows-network.ps1, T87). The line
# stays so the installed unit does not change.
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
ExecStart=/usr/bin/podman --remote --url unix:///run/user/1000/podman/podman.sock start --sig-proxy=false jht-broker jht
ExecStartPost=/bin/sh -ec 'p() { /usr/bin/podman --remote --url unix:///run/user/1000/podman/podman.sock "$$@"; }; probe() { rc=0; out=$$(p inspect --type container jht-telegram --format "{{.State.Running}}" 2>&1) || rc=$$?; printf "%%s\n%%s" "$$rc" "$$out"; }; op=$$(probe | p exec -i jht /usr/bin/python3 -I /app/shared/telegram_service/lifecycle.py boot); case "$$op" in start) p start --sig-proxy=false jht-telegram ;; stop) p stop --time 30 jht-telegram ;; noop) exit 0 ;; *) exit 1 ;; esac; probe | p exec -i jht /usr/bin/python3 -I /app/shared/telegram_service/lifecycle.py verify "$$op"'
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
$bridgeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $BinDir 'podman-machine-bridge.ps1')).Hash.ToLowerInvariant()
$integrationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RuntimeDir 'jht-integration.ps1')).Hash.ToLowerInvariant()
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
$runtimeTierFile = Join-Path $RuntimeDir 'runtime-tier'
$runtimeTierManifest = ''
if ($RuntimeTier -eq 'core') {
  [IO.File]::WriteAllText($runtimeTierFile, "core`n", [Text.UTF8Encoding]::new($false))
  $runtimeTierManifest = "runtime-tier=$((Get-FileHash -Algorithm SHA256 -LiteralPath $runtimeTierFile).Hash.ToLowerInvariant())`n"
} else {
  Remove-Item -LiteralPath $runtimeTierFile -Force -ErrorAction SilentlyContinue
}
$manifest = "version=1`ndocker-compose.yml=$composeHash`njht-wrapper.ps1=$wrapperHash`ndocker-compose.podman.yml=$podmanHash`ndocker.exe=$shimHash`ncontainer-runtime=$selectionHash`npodman-machine=$machineHash`njht-container.service=$containerUnitHash`nwindows-private-acl.ps1=$helperHash`npodman-machine-bridge.ps1=$bridgeHash`n$runtimeImageManifest$runtimeTierManifest"
[IO.File]::WriteAllText((Join-Path $RuntimeDir '.runtime-integrity'), $manifest, [Text.UTF8Encoding]::new($false))
# The host scripts that came after the main manifest have one of their own (the app checks that one key by key).
[IO.File]::WriteAllText((Join-Path $RuntimeDir '.runtime-helpers'), "jht-integration.ps1=$integrationHash`n", [Text.UTF8Encoding]::new($false))
# Every file the wrapper checks the owner of (Test-RuntimeBundleTrusted), before the wrapper runs (T103).
$bundleFiles = @(
  (Join-Path $RuntimeDir 'docker-compose.yml'),
  (Join-Path $RuntimeDir 'docker-compose.podman.yml'),
  $selectionFile,
  $machineFile,
  $containerUnitFile,
  (Join-Path $RuntimeDir '.runtime-integrity'),
  (Join-Path $BinDir 'jht.ps1'),
  (Join-Path $BinDir 'windows-private-acl.ps1'),
  (Join-Path $BinDir 'podman-machine-bridge.ps1'),
  (Join-Path $RuntimeDir 'jht-integration.ps1'),
  (Join-Path $RuntimeDir '.runtime-helpers'),
  $shim
)
if (Test-Path -LiteralPath $runtimeImageFile -PathType Leaf) { $bundleFiles += $runtimeImageFile }
if (Test-Path -LiteralPath $runtimeTierFile -PathType Leaf) { $bundleFiles += $runtimeTierFile }
foreach ($bundleFile in $bundleFiles) { Set-JhtOwnerToCurrentUser -Path $bundleFile }
if ($legacyShimOwned) {
  Remove-Item -LiteralPath $legacyShim -Force -ErrorAction Stop
}

# The engine and the machine are named by the runtime's own container-runtime and podman-machine files (attested with the rest of
# the bundle), never by a variable of the person's environment: a persistent one outlives an update in every terminal opened
# before it and in every program started from them, and a program that obeyed it would use the wrong engine or start the wrong
# machine. Older installs wrote them: they are taken away.
if ([Environment]::GetEnvironmentVariable('JHT_CONTAINER_RUNTIME', 'User')) { [Environment]::SetEnvironmentVariable('JHT_CONTAINER_RUNTIME', $null, 'User') }
if ([Environment]::GetEnvironmentVariable('JHT_PODMAN_MACHINE', 'User')) { [Environment]::SetEnvironmentVariable('JHT_PODMAN_MACHINE', $null, 'User') }
Remove-Item -LiteralPath Env:JHT_CONTAINER_RUNTIME -ErrorAction SilentlyContinue
Remove-Item -LiteralPath Env:JHT_PODMAN_MACHINE -ErrorAction SilentlyContinue
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
# container created so stayed so at every setup. The same for one created under another cgroup
# manager than cgroupfs: under systemd it has a pids limit, and in Podman's WSL machine no cgroup has
# the pids controller, so it never starts either (T87; the service runs under cgroupfs, see
# configure-podman-windows-network.ps1). As jht above: it is removed, its volumes stay, and
# `jht up` creates it again.
$sidecarRemoved = $false
foreach ($sidecar in @('jht-broker', 'jht-telegram')) {
  # No double quote inside a native argument (T71). A container that is not there: empty, and skipped.
  [string]$sidecarDetails = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect --type container $sidecar --format '{{.Config.User}}|{{json .HostConfig.IDMappings}}' 2>$null } | Select-Object -First 1)
  if (-not $sidecarDetails.Trim()) { continue }
  [string]$sidecarCgroups = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect --type container $sidecar --format '{{.HostConfig.CgroupManager}}' 2>$null } | Select-Object -First 1)
  $sidecarCgroups = $sidecarCgroups.Trim()
  $sidecarReason = ''
  if (-not (Test-ContainerMapsItsUser -Details $sidecarDetails)) {
    $sidecarReason = 'its user namespace did not map its own user'
  } elseif ($sidecarCgroups -and $sidecarCgroups -ne 'cgroupfs') {
    $sidecarReason = "it was created under the $sidecarCgroups cgroup manager, not cgroupfs"
  }
  if (-not $sidecarReason) { continue }
  # Only a container of our compose project: one with the same name made by something else is not ours
  # to remove. The labels come whole as JSON, read here (T71).
  [string]$sidecarLabelsJson = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect --type container $sidecar --format '{{json .Config.Labels}}' 2>$null } | Select-Object -First 1)
  $sidecarProject = ''
  try { $sidecarProject = [string](ConvertFrom-Json -InputObject $sidecarLabelsJson).'com.docker.compose.project' } catch { $sidecarProject = '' }
  if ($sidecarProject.Trim() -ne 'jht') {
    Write-Host "  ${sidecar}: $sidecarReason, but it is not of the jht project: left as it is." -ForegroundColor Yellow
    continue
  }
  [string]$sidecarRunning = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect --type container $sidecar --format '{{.State.Running}}' 2>$null } | Select-Object -First 1)
  if ($sidecarRunning.Trim() -eq 'true') { Invoke-Checked $Podman '--connection' $MachineName 'stop' '--time' '30' $sidecar | Out-Null }
  Invoke-Checked $Podman '--connection' $MachineName 'rm' $sidecar | Out-Null
  $sidecarRemoved = $true
  Write-Host "  Recreating ${sidecar}: $sidecarReason; volumes retained." -ForegroundColor Yellow
}

# The setup always runs jht up (T102). Compose leaves what did not change as it is (same image, same
# containers: a second setup on a Windows computer kept the very same jht) and recreates what did, a
# new image above all, and the team restarts on it: what running the setup asks for. Before, jht up
# ran only when jht was not running, so the image the setup had just pulled waited, unused, for a
# later setup that found jht stopped (the desktop app never runs `jht upgrade`).
# A team running on another image is told it restarts, in the log and in the app (JHT_PHASE).
[string]$runningImage = (& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect --type container jht --format '{{.ImageName}}' 2>$null } | Select-Object -First 1)
$runningImage = $runningImage.Trim()
if ($runningImage -and $runningImage -ne $canonicalImage) {
  Write-JhtPhase team_restart
  Write-Host "  The team restarts on the new runtime image: $canonicalImage (it ran on $runningImage)." -ForegroundColor Yellow
}
& (Join-Path $BinDir 'jht.ps1') up
if ($LASTEXITCODE -ne 0) { throw 'The migrated JHT container did not start.' }
# The team is up when each container of the compose file is running and stays so (a crash loop or an exit is the failure).
$composeDefinition = Get-Content -LiteralPath (Join-Path $RuntimeDir 'docker-compose.yml') -Raw
$expectedContainers = @(& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName exec jht /usr/bin/python3 -I /app/shared/telegram_service/lifecycle.py expected-services })
$expectedCode = $LASTEXITCODE
$invalidNames = @($expectedContainers | Where-Object { $_ -cnotin @('jht', 'jht-broker', 'jht-telegram') -or $composeDefinition -notmatch "(?m)^  $([regex]::Escape($_)):" })
if ($expectedCode -ne 0 -or $invalidNames.Count -or @($expectedContainers | Select-Object -Unique).Count -ne $expectedContainers.Count -or $expectedContainers -cnotcontains 'jht' -or $expectedContainers -cnotcontains 'jht-broker') { throw 'runtime_containers_plan_invalid' }
$unsettledContainers = @(Get-UnsettledJhtContainers -Podman $Podman -MachineName $MachineName -Names $expectedContainers)
if ($unsettledContainers.Count -gt 0) { throw "runtime_containers_unhealthy: $($unsettledContainers -join '; '). Run 'jht logs' to see why." }

Install-JhtContainerService -PodmanPath $Podman -UnitPath $containerUnitFile

Write-Host "PODMAN JHT RUNTIME ENABLED (machine=$MachineName, wrapper=$(Join-Path $BinDir 'jht.ps1'))" -ForegroundColor Green
