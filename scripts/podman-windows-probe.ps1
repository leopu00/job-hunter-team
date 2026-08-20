# Job Hunter Team - Windows Podman compatibility probe
#
# This is deliberately an evaluation harness, not an installer path. It creates
# a temporary native docker.exe shim which forwards every argument to podman.exe,
# then exercises the production compose file without changing its docker call
# sites. System installation and Podman machine creation are opt-in.

[CmdletBinding()]
param(
  [switch]$InstallDependencies,
  [switch]$InitializeMachine,
  [switch]$Keep,
  [switch]$PreflightOnly,
  [string]$MachineName = 'jht-podman-probe',
  [string]$ComposeFile = (Join-Path (Split-Path -Parent $PSScriptRoot) 'docker-compose.yml'),
  [string]$PodmanComposeFile = (Join-Path (Split-Path -Parent $PSScriptRoot) 'docker-compose.podman.yml')
)

$ErrorActionPreference = 'Stop'
$script:ProbeRoot = $null
$script:ProbeStartedContainer = $false
$script:OriginalPath = $env:PATH
$script:OriginalHome = $env:HOME
$script:OriginalJhtUserDir = $env:JHT_USER_DIR_HOST
$script:OriginalComposeProvider = $env:PODMAN_COMPOSE_PROVIDER
$script:OriginalComposeWarnings = $env:PODMAN_COMPOSE_WARNING_LOGS
$script:OriginalContainerConnection = $env:CONTAINER_CONNECTION
$script:OriginalComposeProjectName = $env:COMPOSE_PROJECT_NAME
$script:OriginalPodmanHttpProxy = $env:JHT_PODMAN_HTTP_PROXY
$script:OriginalPodmanHttpsProxy = $env:JHT_PODMAN_HTTPS_PROXY

function Write-ProbeStep {
  param([Parameter(Mandatory)][string]$Message)
  Write-Host "[podman-probe] $Message" -ForegroundColor Cyan
}

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
  }
}

function Update-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:PATH = @($machinePath, $userPath, $script:OriginalPath) -join [IO.Path]::PathSeparator
}

function Install-ProbeDependencies {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget is required for -InstallDependencies.'
  }

  Write-ProbeStep 'Installing Podman CLI and the standalone Compose provider'
  $common = @(
    'install', '--exact', '--silent', '--disable-interactivity',
    '--accept-package-agreements', '--accept-source-agreements'
  )
  Invoke-NativeChecked 'winget' @common '--id' 'Podman.CLI'
  Invoke-NativeChecked 'winget' @common '--id' 'Docker.DockerCompose'
  Update-ProcessPath
}

function Get-RequiredCommandPath {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Hint)
  $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $command) { throw "$Name is unavailable. $Hint" }
  return $command.Source
}

function New-DockerShim {
  param(
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$PodmanPath
  )

  $escapedPodmanPath = $PodmanPath.Replace('\', '\\').Replace('"', '\"')
  $source = @"
using System;
using System.Diagnostics;
using System.Text;

public static class DockerShim
{
    private const string PodmanPath = "$escapedPodmanPath";

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            return value;

        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var ch in value)
        {
            if (ch == '\\')
            {
                slashes++;
                continue;
            }
            if (ch == '"')
            {
                result.Append('\\', slashes * 2 + 1);
                result.Append('"');
                slashes = 0;
                continue;
            }
            result.Append('\\', slashes);
            slashes = 0;
            result.Append(ch);
        }
        result.Append('\\', slashes * 2);
        result.Append('"');
        return result.ToString();
    }

    public static int Main(string[] args)
    {
        var joined = new StringBuilder();
        foreach (var arg in args)
        {
            if (joined.Length > 0) joined.Append(' ');
            joined.Append(Quote(arg));
        }

        var start = new ProcessStartInfo
        {
            FileName = PodmanPath,
            Arguments = joined.ToString(),
            UseShellExecute = false
        };
        using (var process = Process.Start(start))
        {
            process.WaitForExit();
            return process.ExitCode;
        }
    }
}
"@

  $sourcePath = [IO.Path]::ChangeExtension($Destination, '.cs')
  try {
    [IO.File]::WriteAllText($sourcePath, $source, [Text.UTF8Encoding]::new($false))
    if ($PSVersionTable.PSEdition -eq 'Core') {
      $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) {
        throw 'Windows PowerShell 5.1 is required to compile the native docker shim.'
      }
      $quotedSource = $sourcePath.Replace("'", "''")
      $quotedDestination = $Destination.Replace("'", "''")
      $compile = "Add-Type -Path '$quotedSource' -OutputAssembly '$quotedDestination' -OutputType ConsoleApplication"
      & $windowsPowerShell -NoProfile -NonInteractive -Command $compile
      if ($LASTEXITCODE -ne 0) { throw "Native shim compiler exited with $LASTEXITCODE." }
    } else {
      Add-Type -Path $sourcePath -OutputAssembly $Destination -OutputType ConsoleApplication
    }
  } finally {
    Remove-Item -LiteralPath $sourcePath -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
    throw "Failed to create native docker shim: $Destination"
  }
}

function Get-MachineState {
  param([Parameter(Mandatory)][string]$Name)
  $json = & podman machine list --format json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
  $machines = @($json | ConvertFrom-Json)
  return $machines | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
}

function Ensure-ProbeMachine {
  param([Parameter(Mandatory)][string]$Name)
  $machine = Get-MachineState -Name $Name
  if (-not $machine) {
    if (-not $InitializeMachine) {
      throw "Podman machine '$Name' does not exist. Re-run with -InitializeMachine to create it."
    }
    Write-ProbeStep "Creating rootless WSL Podman machine '$Name'"
    Invoke-NativeChecked 'podman' 'machine' 'init' '--now' '--provider' 'wsl' $Name
    return
  }

  $running = $false
  if ($machine.PSObject.Properties.Name -contains 'Running') {
    $running = [bool]$machine.Running
  } elseif ($machine.PSObject.Properties.Name -contains 'LastUp') {
    $running = ([string]$machine.LastUp -ne 'Never')
  }
  if (-not $running) {
    Write-ProbeStep "Starting Podman machine '$Name'"
    Invoke-NativeChecked 'podman' 'machine' 'start' $Name
  }
}

function Assert-FileContains {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Expected
  )
  $actual = [IO.File]::ReadAllText($Path).Trim()
  if ($actual -ne $Expected) {
    throw "Unexpected content in ${Path}: '$actual' (expected '$Expected')"
  }
}

function Invoke-ProbeCompose {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  Invoke-NativeChecked 'docker' 'compose' '-f' $ComposeFile '-f' $PodmanComposeFile `
    '--project-directory' (Split-Path -Parent $ComposeFile) @Arguments
}

function Remove-ProbeResources {
  if ($script:ProbeStartedContainer -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-ProbeStep 'Removing probe container and named volumes'
    & docker compose -f $ComposeFile -f $PodmanComposeFile `
      --project-directory (Split-Path -Parent $ComposeFile) down --volumes *> $null
  }
  if (-not $Keep -and $script:ProbeRoot -and (Test-Path -LiteralPath $script:ProbeRoot)) {
    Remove-Item -LiteralPath $script:ProbeRoot -Recurse -Force
  }
  $env:PATH = $script:OriginalPath
  $env:HOME = $script:OriginalHome
  $env:JHT_USER_DIR_HOST = $script:OriginalJhtUserDir
  $env:PODMAN_COMPOSE_PROVIDER = $script:OriginalComposeProvider
  $env:PODMAN_COMPOSE_WARNING_LOGS = $script:OriginalComposeWarnings
  $env:CONTAINER_CONNECTION = $script:OriginalContainerConnection
  $env:COMPOSE_PROJECT_NAME = $script:OriginalComposeProjectName
  $env:JHT_PODMAN_HTTP_PROXY = $script:OriginalPodmanHttpProxy
  $env:JHT_PODMAN_HTTPS_PROXY = $script:OriginalPodmanHttpsProxy
}

try {
  if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
    throw 'This probe must run from native Windows PowerShell or pwsh.'
  }
  if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
    throw "Compose file not found: $ComposeFile"
  }
  if (-not (Test-Path -LiteralPath $PodmanComposeFile -PathType Leaf)) {
    throw "Podman Compose override not found: $PodmanComposeFile"
  }

  if ($InstallDependencies) { Install-ProbeDependencies }
  Update-ProcessPath
  $podmanPath = Get-RequiredCommandPath -Name 'podman' `
    -Hint 'Install Podman.CLI, or re-run with -InstallDependencies.'
  $composeProvider = Get-RequiredCommandPath -Name 'docker-compose' `
    -Hint 'Install Docker.DockerCompose, or re-run with -InstallDependencies.'

  Ensure-ProbeMachine -Name $MachineName
  Invoke-NativeChecked $podmanPath '--connection' $MachineName 'info'

  $script:ProbeRoot = Join-Path ([IO.Path]::GetTempPath()) ("jht-podman-probe-" + [guid]::NewGuid().ToString('N'))
  $shimDir = Join-Path $script:ProbeRoot 'bin'
  $probeHome = Join-Path $script:ProbeRoot 'home'
  $probeJhtHome = Join-Path $probeHome '.jht'
  $probeUserDir = Join-Path $probeHome 'Documents\Job Hunter Team'
  New-Item -ItemType Directory -Path $shimDir, $probeJhtHome, $probeUserDir -Force | Out-Null
  New-DockerShim -Destination (Join-Path $shimDir 'docker.exe') -PodmanPath $podmanPath

  $env:PATH = "$shimDir$([IO.Path]::PathSeparator)$script:OriginalPath"
  $env:HOME = $probeHome
  $env:JHT_USER_DIR_HOST = $probeUserDir
  $env:PODMAN_COMPOSE_PROVIDER = $composeProvider
  $env:PODMAN_COMPOSE_WARNING_LOGS = 'false'
  $env:CONTAINER_CONNECTION = $MachineName
  $env:COMPOSE_PROJECT_NAME = 'jht-podman-probe-' + ([IO.Path]::GetFileName($script:ProbeRoot) -replace '^jht-podman-probe-', '').Substring(0, 12)
  $env:JHT_PODMAN_HTTP_PROXY = 'http://127.0.0.1:3128'
  $env:JHT_PODMAN_HTTPS_PROXY = 'http://127.0.0.1:3128'

  $resolvedDocker = (Get-Command docker -CommandType Application -ErrorAction Stop |
    Select-Object -First 1).Source
  if ([IO.Path]::GetFullPath($resolvedDocker) -ne [IO.Path]::GetFullPath((Join-Path $shimDir 'docker.exe'))) {
    throw "Probe shim is not first in PATH: $resolvedDocker"
  }

  Write-ProbeStep "docker resolves to temporary shim; backend is $podmanPath"
  Invoke-NativeChecked 'docker' '--version'
  Invoke-NativeChecked 'docker' 'info'
  Invoke-NativeChecked 'docker' 'compose' 'version'
  Invoke-ProbeCompose 'config' '--quiet'

  if ($PreflightOnly) {
    Write-Host 'PODMAN PROBE PREFLIGHT PASS' -ForegroundColor Green
    exit 0
  }

  $existing = & docker inspect jht 2>$null
  if ($LASTEXITCODE -eq 0 -and $existing) {
    throw "The selected Podman machine already contains a container named 'jht'; refusing to replace it."
  }

  Write-ProbeStep 'Starting the production JHT compose workload through the docker shim'
  $script:ProbeStartedContainer = $true
  Invoke-ProbeCompose 'up' '-d'

  $containerInspect = @(& docker inspect jht 2>$null | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0 -or $containerInspect.Count -ne 1) {
    throw "Cannot inspect the JHT probe container after compose up."
  }
  Invoke-NativeChecked 'docker' 'exec' 'jht' 'sh' '-lc' 'test -d /jht_home/runtime && test -d /jht_user'

  $hostSentinel = Join-Path $probeUserDir 'host-to-container.txt'
  [IO.File]::WriteAllText($hostSentinel, 'host-to-container')
  Invoke-NativeChecked 'docker' 'exec' 'jht' 'sh' '-lc' 'test "$(cat /jht_user/host-to-container.txt)" = host-to-container'
  Invoke-NativeChecked 'docker' 'exec' 'jht' 'sh' '-lc' 'printf container-to-host > /jht_user/container-to-host.txt'
  Assert-FileContains -Path (Join-Path $probeUserDir 'container-to-host.txt') -Expected 'container-to-host'

  Invoke-NativeChecked 'docker' 'exec' 'jht' 'sh' '-lc' 'getent hosts host.docker.internal >/dev/null'
  Invoke-NativeChecked 'docker' 'exec' 'jht' 'sh' '-lc' `
    'test "$(curl --silent --show-error --output /dev/null --write-out ''%{http_code}'' https://ghcr.io/v2/)" = 401'
  foreach ($destination in @('/opt/jht-deps', '/jht_home/runtime')) {
    $mount = @($containerInspect[0].Mounts) |
      Where-Object { $_.Destination -eq $destination -and $_.Type -eq 'volume' } |
      Select-Object -First 1
    if (-not $mount -or -not $mount.Name) {
      throw "Named volume missing at $destination."
    }
    Invoke-NativeChecked 'docker' 'volume' 'inspect' ([string]$mount.Name)
  }

  Write-ProbeStep 'Restarting the workload and checking that it returns running'
  Invoke-ProbeCompose 'restart'
  $running = (& docker inspect jht --format '{{.State.Running}}' 2>$null | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
    throw "Container did not return running after compose restart (state: '$running')."
  }

  Write-Host 'PODMAN WINDOWS LIFECYCLE PROBE PASS' -ForegroundColor Green
} finally {
  Remove-ProbeResources
}
