# Convert an existing Windows JHT installation to the Podman backend. The
# Docker-compatible host wrapper remains the product boundary; docker.exe is a
# native, attested shim that forwards argv and exit codes to podman.exe.

[CmdletBinding()]
param(
  [string]$MachineName = 'jht-podman',
  [switch]$InstallDependencies,
  [switch]$InitializeMachine
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
$RuntimeDir = if ($env:JHT_RUNTIME_DIR) { $env:JHT_RUNTIME_DIR } else { Join-Path $LocalAppData 'Job Hunter Team\host-runtime' }
$BinDir = if ($env:JHT_BIN_DIR) { $env:JHT_BIN_DIR } else { Join-Path $env:USERPROFILE '.local\bin' }
$JhtHome = Join-Path $env:USERPROFILE '.jht'

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

function Get-Application {
  param([Parameter(Mandatory)][string]$Name)
  return (Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
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

function New-DockerShim {
  param([Parameter(Mandatory)][string]$Destination, [Parameter(Mandatory)][string]$PodmanPath)
  $escaped = $PodmanPath.Replace('\', '\\').Replace('"', '\"')
  $source = @"
using System;
using System.Diagnostics;
using System.Text;
public static class JhtPodmanDockerShim {
  private const string PodmanPath = "$escaped";
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
  Set-Acl -LiteralPath $Path -AclObject $acl
  if (-not (Get-Acl -LiteralPath $Path).AreAccessRulesProtected) { throw "ACL inheritance remains enabled: $Path" }
}

function Test-LegacyWslOwner {
  param([Parameter(Mandatory)][string]$WindowsPath, [Parameter(Mandatory)][string]$PodmanPath)
  if (-not (Test-Path -LiteralPath $WindowsPath)) { return $false }
  $wslPath = ConvertTo-WslPath $WindowsPath
  $owner = (& $PodmanPath machine ssh $MachineName "stat -c '%u' $(Quote-Sh $wslPath)" 2>$null | Select-Object -Last 1)
  return ([string]$owner).Trim() -ne '1000'
}

function Repair-LegacyBindMetadata {
  param([Parameter(Mandatory)][string]$PodmanPath)
  $targets = @('jobs.db', 'logs', 'state', '.team-halted.flag') |
    ForEach-Object { Join-Path $JhtHome $_ } |
    Where-Object { Test-LegacyWslOwner -WindowsPath $_ -PodmanPath $PodmanPath }
  if (-not $targets) { return $false }

  $running = (& $PodmanPath --connection $MachineName inspect jht --format '{{.State.Running}}' 2>$null | Select-Object -First 1)
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
  $install = "sudo rm -f /home/user/.config/systemd/user/default.target.wants/jht-container.service /home/user/.config/systemd/user/jht-container.service && " +
    "sudo install -m 0644 $(Quote-Sh $unitWsl) /etc/systemd/system/jht-container.service && " +
    'sudo systemctl daemon-reload && sudo systemctl enable jht-container.service && ' +
    '(sudo systemctl is-active --quiet jht-container.service || sudo systemctl start jht-container.service)'
  Invoke-Checked $PodmanPath 'machine' 'ssh' $MachineName $install
}

if ($InstallDependencies) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is required to install Podman dependencies.' }
  if (-not (Get-Application 'podman.exe')) { Invoke-Checked 'winget' 'install' '--exact' '--silent' '--disable-interactivity' '--accept-package-agreements' '--accept-source-agreements' '--id' 'Podman.CLI' }
  if (-not (Get-Application 'docker-compose.exe')) { Invoke-Checked 'winget' 'install' '--exact' '--silent' '--disable-interactivity' '--accept-package-agreements' '--accept-source-agreements' '--id' 'Docker.DockerCompose' }
}
Update-ProcessPath
$Podman = Get-Application 'podman.exe'
if (-not $Podman) {
  $candidate = Join-Path $LocalAppData 'Programs\Podman\podman.exe'
  if (Test-Path -LiteralPath $candidate -PathType Leaf) { $Podman = $candidate }
}
if (-not $Podman) { throw 'podman.exe is unavailable; re-run with -InstallDependencies.' }
if (-not (Get-Application 'docker-compose.exe')) { throw 'docker-compose.exe is unavailable; re-run with -InstallDependencies.' }

$machines = @((& $Podman machine list --format json | ConvertFrom-Json))
$machine = $machines | Where-Object Name -eq $MachineName | Select-Object -First 1
if (-not $machine) {
  if (-not $InitializeMachine) { throw "Podman machine '$MachineName' is absent; re-run with -InitializeMachine." }
  Invoke-Checked $Podman 'machine' 'init' '--now' '--provider' 'wsl' $MachineName
} elseif (-not [bool]$machine.Running) {
  Invoke-Checked $Podman 'machine' 'start' $MachineName
}

& (Join-Path $PSScriptRoot 'configure-podman-windows-network.ps1') -MachineName $MachineName
if ($LASTEXITCODE -ne 0) { throw 'Podman network configuration failed.' }
$metadataRepaired = Repair-LegacyBindMetadata -PodmanPath $Podman

New-Item -ItemType Directory -Path $RuntimeDir, $BinDir, $JhtHome -Force | Out-Null
Protect-OwnerOnlyDirectory -Path $RuntimeDir
$helperSource = Join-Path $PSScriptRoot 'windows-private-acl.ps1'
. $helperSource
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
ExecStart=/usr/bin/podman --remote --url unix:///run/user/1000/podman/podman.sock start jht
ExecStop=-/usr/bin/podman --remote --url unix:///run/user/1000/podman/podman.sock stop --time 30 jht
TimeoutStartSec=90
TimeoutStopSec=45

[Install]
WantedBy=multi-user.target
'@
[IO.File]::WriteAllText($containerUnitFile, ($containerUnit.Trim() + "`n"), [Text.UTF8Encoding]::new($false))
$shim = Join-Path $BinDir 'docker.exe'
New-DockerShim -Destination $shim -PodmanPath $Podman

$composeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RuntimeDir 'docker-compose.yml')).Hash.ToLowerInvariant()
$podmanHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RuntimeDir 'docker-compose.podman.yml')).Hash.ToLowerInvariant()
$wrapperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $BinDir 'jht.ps1')).Hash.ToLowerInvariant()
$shimHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $shim).Hash.ToLowerInvariant()
$helperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $BinDir 'windows-private-acl.ps1')).Hash.ToLowerInvariant()
$selectionHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $selectionFile).Hash.ToLowerInvariant()
$machineHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $machineFile).Hash.ToLowerInvariant()
$containerUnitHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $containerUnitFile).Hash.ToLowerInvariant()
$manifest = "version=1`ndocker-compose.yml=$composeHash`njht-wrapper.ps1=$wrapperHash`ndocker-compose.podman.yml=$podmanHash`ndocker.exe=$shimHash`ncontainer-runtime=$selectionHash`npodman-machine=$machineHash`njht-container.service=$containerUnitHash`nwindows-private-acl.ps1=$helperHash`n"
[IO.File]::WriteAllText((Join-Path $RuntimeDir '.runtime-integrity'), $manifest, [Text.UTF8Encoding]::new($false))

[Environment]::SetEnvironmentVariable('JHT_CONTAINER_RUNTIME', 'podman', 'User')
[Environment]::SetEnvironmentVariable('JHT_PODMAN_MACHINE', $MachineName, 'User')
$env:JHT_CONTAINER_RUNTIME = 'podman'
$env:JHT_PODMAN_MACHINE = $MachineName
$env:PATH = "$BinDir$([IO.Path]::PathSeparator)$env:PATH"

[string]$existingProject = (& $Podman --connection $MachineName inspect jht --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>$null | Select-Object -First 1)
$existingProject = $existingProject.Trim()
[string]$existingCgroupManager = (& $Podman --connection $MachineName inspect jht --format '{{.HostConfig.CgroupManager}}' 2>$null | Select-Object -First 1)
$existingCgroupManager = $existingCgroupManager.Trim()
$containerNeedsMigration = $existingProject -and ($existingProject -ne 'jht' -or $existingCgroupManager -ne 'cgroupfs')
if ($containerNeedsMigration) {
  [string]$existingRunning = (& $Podman --connection $MachineName inspect jht --format '{{.State.Running}}' 2>$null | Select-Object -First 1)
  $existingRunning = $existingRunning.Trim()
  if ($existingRunning -eq 'true') { Invoke-Checked $Podman '--connection' $MachineName 'stop' '--time' '30' 'jht' | Out-Null }
  # The container has only bind mounts and named volumes. Removing the stopped
  # metadata object keeps both kinds of data intact and lets the installed
  # Compose project take ownership under the stable name above.
  Invoke-Checked $Podman '--connection' $MachineName 'rm' 'jht' | Out-Null
  Write-Host "  Migrated existing JHT container (project='$existingProject', cgroups='$existingCgroupManager'); volumes retained." -ForegroundColor Yellow
}

if ($metadataRepaired -or -not (& $Podman --connection $MachineName ps --format '{{.Names}}' | Where-Object { $_ -eq 'jht' })) {
  & (Join-Path $BinDir 'jht.ps1') up
  if ($LASTEXITCODE -ne 0) { throw 'The migrated JHT container did not start.' }
}

Install-JhtContainerService -PodmanPath $Podman -UnitPath $containerUnitFile

Write-Host "PODMAN JHT RUNTIME ENABLED (machine=$MachineName, wrapper=$(Join-Path $BinDir 'jht.ps1'))" -ForegroundColor Green
