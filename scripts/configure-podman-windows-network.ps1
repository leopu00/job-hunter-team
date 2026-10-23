# Configure a persistent, localhost-only proxy for Podman machine traffic on
# managed Windows hosts where WSL TCP egress is blocked but WSL interop works.

[CmdletBinding()]
param(
  [string]$MachineName = 'jht-podman-probe',
  [int]$Port = 3128,
  [int]$BrokerPort = 3129,
  [int]$TelegramPort = 3130
)

$ErrorActionPreference = 'Stop'
# Any failure here leaves with ONE stable code for the caller (install.ps1 →
# the app): `podman_network_unready: <what failed>` on stderr, then exit 23.
# The detail (which proxy, which answer) is in that line and in the log.
trap {
  [Console]::Error.WriteLine("podman_network_unready: $($_.Exception.Message)")
  exit 23
}
$proxyPorts = @($Port, $BrokerPort, $TelegramPort)
if (($proxyPorts | Where-Object { $_ -lt 1 -or $_ -gt 65535 }).Count -ne 0 -or
    ($proxyPorts | Sort-Object -Unique).Count -ne 3) {
  throw 'Agent, broker and Telegram proxy ports must be distinct valid TCP ports.'
}
$Podman = (Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue |
  Select-Object -First 1).Source
if (-not $Podman) {
  $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
  if (Test-Path -LiteralPath $candidate -PathType Leaf) { $Podman = $candidate }
}
if (-not $Podman) { throw 'podman.exe is unavailable.' }

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
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
  if ($Value.Contains("'")) { throw "Cannot shell-quote a value containing an apostrophe: $Value" }
  return "'" + $Value + "'"
}

function Invoke-MachineShell {
  param([Parameter(Mandatory)][string]$Command)
  & $Podman machine ssh $MachineName $Command
  if ($LASTEXITCODE -ne 0) { throw "Podman machine command failed ($LASTEXITCODE): $Command" }
}

function New-NativeConnector {
  param([Parameter(Mandatory)][string]$Destination)
  # The executable can be held open by long-lived Codex HTTPS tunnels. A
  # repeated configuration run must not try to overwrite an in-use binary.
  if (Test-Path -LiteralPath $Destination -PathType Leaf) { return }
  $source = @'
using System;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;

public static class JhtWindowsConnect
{
    private static void Copy(Stream source, Stream destination)
    {
        byte[] buffer = new byte[65536];
        int count;
        while ((count = source.Read(buffer, 0, buffer.Length)) > 0)
        {
            destination.Write(buffer, 0, count);
            destination.Flush();
        }
    }

    // The PC's own addresses are the user's home even when they are public
    // (a PC with a public IPv4 of its own): never a destination.
    private static bool IsOwnAddress(IPAddress target)
    {
        foreach (NetworkInterface card in NetworkInterface.GetAllNetworkInterfaces())
        {
            foreach (UnicastIPAddressInformation own in card.GetIPProperties().UnicastAddresses)
            {
                if (own.Address.Equals(target)) return true;
            }
        }
        return false;
    }

    public static int Main(string[] args)
    {
        Stream output = Console.OpenStandardOutput();
        if (args.Length != 2) { output.WriteByte(1); output.Flush(); return 2; }
        int port;
        if (!Int32.TryParse(args[1], out port) || port < 1 || port > 65535)
        { output.WriteByte(1); output.Flush(); return 2; }
        // Only the numeric IPv4 address the proxy verified: never a name
        // (it would be resolved again here), never IPv6 (a global IPv6 can
        // be the home /64), never one of this PC's own addresses.
        IPAddress target;
        if (!IPAddress.TryParse(args[0], out target) || target.AddressFamily != AddressFamily.InterNetwork)
        { output.WriteByte(1); output.Flush(); return 3; }
        try
        {
            if (IsOwnAddress(target)) { output.WriteByte(1); output.Flush(); return 3; }
        }
        catch { output.WriteByte(1); output.Flush(); return 3; }

        TcpClient client = new TcpClient();
        try
        {
            IAsyncResult pending = client.BeginConnect(target, port, null, null);
            if (!pending.AsyncWaitHandle.WaitOne(TimeSpan.FromSeconds(60)))
                throw new TimeoutException("connect timeout");
            client.EndConnect(pending);
            NetworkStream network = client.GetStream();
            output.WriteByte(0);
            output.Flush();

            Thread upload = new Thread(delegate()
            {
                try { Copy(Console.OpenStandardInput(), network); }
                catch { }
                try { client.Client.Shutdown(SocketShutdown.Send); }
                catch { }
            });
            upload.IsBackground = true;
            upload.Start();
            Copy(network, output);
            return 0;
        }
        catch
        {
            try { output.WriteByte(1); output.Flush(); } catch { }
            return 1;
        }
        finally { client.Close(); }
    }
}
'@
  $sourcePath = [IO.Path]::ChangeExtension($Destination, '.cs')
  try {
    [IO.File]::WriteAllText($sourcePath, $source, [Text.UTF8Encoding]::new($false))
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $quotedSource = $sourcePath.Replace("'", "''")
    $quotedDestination = $Destination.Replace("'", "''")
    $compile = "Add-Type -Path '$quotedSource' -OutputAssembly '$quotedDestination' -OutputType ConsoleApplication"
    & $windowsPowerShell -NoProfile -NonInteractive -Command $compile
    if ($LASTEXITCODE -ne 0) { throw "Native connector compiler exited with $LASTEXITCODE." }
  } finally {
    Remove-Item -LiteralPath $sourcePath -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
    throw "Native connector was not created: $Destination"
  }
}

$stateDir = Join-Path $env:LOCALAPPDATA 'Job Hunter Team\podman-network'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
# The name carries the source's digest (tests/test_podman_windows_probe.py
# checks it): New-NativeConnector never overwrites an existing binary, so a
# changed connector must get a new name to reach installs that have the old.
$connector = Join-Path $stateDir 'jht-windows-connect-1d6ba098a310.exe'
New-NativeConnector -Destination $connector

$proxySource = Join-Path $PSScriptRoot 'wsl-interop-connect-proxy.py'
if (-not (Test-Path -LiteralPath $proxySource -PathType Leaf)) { throw "Proxy source missing: $proxySource" }
$proxySourceWsl = ConvertTo-WslPath $proxySource
$connectorWsl = ConvertTo-WslPath $connector
$proxyUrl = "http://127.0.0.1:$Port"

function New-JhtProxyUnit {
  param(
    [Parameter(Mandatory)][string]$Description,
    [Parameter(Mandatory)][ValidateSet('agent', 'broker', 'telegram')][string]$Policy,
    [Parameter(Mandatory)][int]$ListenPort
  )
  return @"
[Unit]
Description=$Description
Before=jht-rootless-podman.service

[Service]
Type=simple
User=user
Group=user
Environment="HOME=/home/user"
ExecStart=/usr/bin/python3 /home/user/.local/share/jht-podman/wsl-interop-connect-proxy.py --bind 127.0.0.1 --port $ListenPort --policy $Policy --connector "$connectorWsl"
Restart=always
RestartSec=1s

[Install]
WantedBy=multi-user.target
"@
}

$unit = New-JhtProxyUnit -Description 'JHT Windows agent egress proxy' -Policy agent -ListenPort $Port
$brokerUnit = New-JhtProxyUnit -Description 'JHT Windows broker egress proxy' -Policy broker -ListenPort $BrokerPort
$telegramUnit = New-JhtProxyUnit -Description 'JHT Windows Telegram egress proxy' -Policy telegram -ListenPort $TelegramPort
# The containers are created by this service under the cgroupfs manager, given as Podman's own flag.
# In Podman's WSL machine every cgroup systemd holds sits under /non-systemd with no controller at
# all (the root of the WSL VM, shared with the user's other distributions, enables none), and
# under the systemd manager rootless Podman gives each container a pids limit of 2048: crun then
# refuses to start it, "controller pids is not available" (T87). Under cgroupfs rootless Podman
# sets no pids limit. The variable CONTAINERS_CGROUP_MANAGER, used here before, is not a Podman
# setting: the service ran under systemd all along.
$apiService = @"
[Unit]
Requires=jht-windows-egress-proxy.service
After=jht-windows-egress-proxy.service
Requires=jht-windows-egress-proxy-broker.service
After=jht-windows-egress-proxy-broker.service
Requires=jht-windows-egress-proxy-telegram.service
After=jht-windows-egress-proxy-telegram.service
Requires=user-runtime-dir@1000.service
After=user-runtime-dir@1000.service

[Service]
Type=exec
User=user
Group=user
Delegate=true
KillMode=process
Environment="HOME=/home/user"
Environment="XDG_RUNTIME_DIR=/run/user/1000"
Environment="HTTP_PROXY=$proxyUrl"
Environment="HTTPS_PROXY=$proxyUrl"
Environment="NO_PROXY=localhost,127.0.0.1,::1,host.containers.internal"
Environment="http_proxy=$proxyUrl"
Environment="https_proxy=$proxyUrl"
Environment="no_proxy=localhost,127.0.0.1,::1,host.containers.internal"
ExecStartPre=+/usr/bin/install -d -o user -g user -m 0755 /run/user/1000/podman
ExecStartPre=+/usr/bin/rm -f /run/user/1000/podman/podman.sock
ExecStart=/usr/bin/podman --cgroup-manager=cgroupfs --log-level=info system service --time=0 unix:///run/user/1000/podman/podman.sock

[Install]
WantedBy=multi-user.target
"@
$unitFile = Join-Path $stateDir 'jht-windows-egress-proxy.service'
$brokerUnitFile = Join-Path $stateDir 'jht-windows-egress-proxy-broker.service'
$telegramUnitFile = Join-Path $stateDir 'jht-windows-egress-proxy-telegram.service'
$apiServiceFile = Join-Path $stateDir 'jht-rootless-podman.service'
[IO.File]::WriteAllText($unitFile, $unit, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($brokerUnitFile, $brokerUnit, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($telegramUnitFile, $telegramUnit, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($apiServiceFile, $apiService, [Text.UTF8Encoding]::new($false))
$unitWsl = ConvertTo-WslPath $unitFile
$brokerUnitWsl = ConvertTo-WslPath $brokerUnitFile
$telegramUnitWsl = ConvertTo-WslPath $telegramUnitFile
$apiServiceWsl = ConvertTo-WslPath $apiServiceFile

# No systemd reload while the machine runs. In Podman's WSL machine systemd
# runs in its own PID namespace, and on a Windows 10 test PC (09/10/2026)
# the reload implied by `systemctl enable` never finished: systemd stopped
# answering, `podman machine ssh` hung with it, and so did the installer.
# Units seen for the first time are loaded from disk when started; a unit
# that systemd already holds and that changed is picked up by restarting the
# machine instead. Every systemctl runs under a timeout, so a stuck systemd
# becomes an error instead of an endless wait.
# «Changed on disk» is not only a rewritten unit: on a new machine systemd can
# already hold a unit it was asked about before its file existed, and then it
# starts the stale copy ("Run 'systemctl daemon-reload'" on every command).
# systemd says so itself (NeedDaemonReload=yes): that unit takes the restart too.
$egressServices = 'jht-windows-egress-proxy.service jht-windows-egress-proxy-broker.service jht-windows-egress-proxy-telegram.service'
$runtimeServices = "$egressServices jht-rootless-podman.service"
$unitInstall = ''
foreach ($unitEntry in @(
  @($unitWsl, 'jht-windows-egress-proxy.service'),
  @($brokerUnitWsl, 'jht-windows-egress-proxy-broker.service'),
  @($telegramUnitWsl, 'jht-windows-egress-proxy-telegram.service'),
  @($apiServiceWsl, 'jht-rootless-podman.service')
)) {
  $unitSource = Quote-Sh $unitEntry[0]
  $unitTarget = '/etc/systemd/system/' + $unitEntry[1]
  $unitInstall += "if [ -e $unitTarget ] && ! sudo cmp -s $unitSource $unitTarget; then units_changed=1; fi; " +
    "sudo install -m 0644 $unitSource $unitTarget; "
}
$proxyTarget = '/home/user/.local/share/jht-podman/wsl-interop-connect-proxy.py'
$machineOutput = @(Invoke-MachineShell ("set -e; units_changed=0; proxy_changed=0; " +
  "sudo mkdir -p /home/user/.local/share/jht-podman /home/user/.config/systemd/user; " +
  "sudo cmp -s $(Quote-Sh $proxySourceWsl) $proxyTarget || proxy_changed=1; " +
  "sudo install -o user -g user -m 0644 $(Quote-Sh $proxySourceWsl) $proxyTarget; " +
  "sudo rm -f /home/user/.config/systemd/user/default.target.wants/jht-windows-egress-proxy.service /home/user/.config/systemd/user/jht-windows-egress-proxy.service /home/user/.config/systemd/user/jht-windows-interop-proxy.service /home/user/.config/systemd/user/podman.service.d/jht-proxy.conf; " +
  "sudo ln -sfn /dev/null /home/user/.config/systemd/user/podman.socket; " +
  "sudo ln -sfn /dev/null /home/user/.config/systemd/user/podman.service; " +
  $unitInstall +
  "sudo timeout 60 systemctl disable --no-reload --now jht-rootless-podman.socket 2>/dev/null || true; " +
  "sudo rm -f /etc/systemd/system/jht-rootless-podman.socket /etc/systemd/system/sockets.target.wants/jht-rootless-podman.socket /etc/systemd/system/multi-user.target.wants/jht-rootless-podman.socket; " +
  "sudo timeout 60 systemctl enable --no-reload $runtimeServices; " +
  "for unit in $runtimeServices; do case `$(sudo timeout 20 systemctl show -p NeedDaemonReload --value `$unit 2>/dev/null) in yes) units_changed=1;; esac; done; " +
  "if [ `$units_changed = 1 ]; then echo JHT_MACHINE_RESTART; exit 0; fi; " +
  "if [ `$proxy_changed = 1 ]; then sudo timeout 90 systemctl restart $egressServices; fi; " +
  "sudo timeout 90 systemctl start $runtimeServices"))
$machineOutput | ForEach-Object { Write-Host $_ }
if (@($machineOutput | Where-Object { ([string]$_).Trim() -eq 'JHT_MACHINE_RESTART' }).Count -gt 0) {
  Invoke-Checked $Podman 'machine' 'stop' $MachineName
  Invoke-Checked $Podman 'machine' 'start' '--update-connection=false' $MachineName
  # `podman machine start` does not wait for systemd: the enabled units
  # come up with it at boot.
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  $servicesActive = $false
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    while (-not $servicesActive -and [DateTime]::UtcNow -lt $deadline) {
      & $Podman machine ssh $MachineName "timeout 20 systemctl is-active --quiet $runtimeServices" 2>$null | Out-Null
      $servicesActive = ($LASTEXITCODE -eq 0)
      if (-not $servicesActive) { Start-Sleep -Seconds 2 }
    }
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if (-not $servicesActive) { throw "JHT egress services did not start after restarting Podman machine '$MachineName'." }
}
# The proxies are checked only once they listen: `systemctl start` returns as
# soon as a Type=simple service is forked, before python binds its port. Then
# each check says what it asked and what came back, so a failure names the
# proxy and the answer instead of a silent `&&` chain. Pure shell, run inside
# the machine with the three ports as its arguments (tests run it with a fake
# curl).
$proxyCheck = @'
set -u
agent=$1 broker=$2 telegram=$3
deadline=$(( $(date +%s) + ${JHT_PROXY_READY_SECONDS:-60} ))
for port in "$agent" "$broker" "$telegram"; do
  until (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "JHT_PROXY_UNREADY $port"
      exit 3
    fi
    sleep 1
  done
done
failed=0
# A target the proxy refuses (403): for http:// the proxy answers the request
# itself, so curl's http_code is the proxy's 403. For https:// curl first asks
# the proxy for a tunnel (CONNECT): the proxy refuses THAT with 403, curl never
# reaches the target and prints http_code 000 with http_connect 403. So a
# refusal over https is read from http_connect; anything else there (000: no
# answer to the CONNECT, 200: the tunnel was opened) is a wrong answer.
check() {
  name=$1 port=$2 url=$3 expected=$4
  out=$(curl --silent --output /dev/null --max-time 30 --write-out '%{http_code} %{http_connect}' --proxy "http://127.0.0.1:$port" "$url" 2>/dev/null)
  status=$?
  got=${out%% *}
  connect=${out#* }
  [ "$connect" != "$out" ] || connect=""
  [ -n "$got" ] || got=000
  [ -n "$connect" ] || connect=000
  if [ "$expected" = reachable ]; then
    if [ "$status" -eq 0 ]; then result=$got; else result="curl-$status"; failed=1; fi
  else
    result=$got
    case "$expected $url" in "403 https://"*) result=$connect ;; esac
    [ "$result" = "$expected" ] || failed=1
  fi
  echo "JHT_PROXY_CHECK $name $port $url $expected $result"
}
check agent "$agent" https://ghcr.io/v2/ 401
check broker "$broker" https://ghcr.io/v2/ 401
check telegram "$telegram" https://api.telegram.org/ reachable
check agent "$agent" https://example.com:993/ 403
check broker "$broker" http://example.com/ 403
check telegram "$telegram" https://example.com/ 403
exit $failed
'@
$proxyCheckEncoded = [Convert]::ToBase64String([Text.UTF8Encoding]::new($false).GetBytes($proxyCheck.Replace("`r`n", "`n")))
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $checkOutput = @(& $Podman machine ssh $MachineName "echo $proxyCheckEncoded | base64 -d | bash -s -- $Port $BrokerPort $TelegramPort" 2>&1 | ForEach-Object { [string]$_ })
  $checkCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousPreference
}
$checkOutput | ForEach-Object { Write-Host $_ }
if ($checkCode -ne 0) {
  $unready = $null
  $wrong = @()
  foreach ($line in $checkOutput) {
    if ($line -match '^JHT_PROXY_UNREADY (\d+)$') {
      $unready = $Matches[1]
    } elseif ($line -match '^JHT_PROXY_CHECK (\S+) (\d+) (\S+) (\S+) (\S+)$') {
      $name, $checkPort, $url, $expected, $got = $Matches[1], $Matches[2], $Matches[3], $Matches[4], $Matches[5]
      if ($expected -eq 'reachable') {
        if ($got -like 'curl-*') { $wrong += "the $name proxy on 127.0.0.1:$checkPort could not reach $url ($got)" }
      } elseif ($got -ne $expected) {
        $wrong += "the $name proxy on 127.0.0.1:$checkPort answered $got for $url, expected $expected"
      }
    }
  }
  if ($unready) { throw "the proxy on 127.0.0.1:$unready did not start listening within 60 seconds." }
  if ($wrong.Count -gt 0) { throw ($wrong -join '; ') }
  throw "the proxy check exited with $checkCode."
}
# The service must answer under cgroupfs (see $apiService): under systemd no container would start,
# and the setup would recreate jht at every run (enable-podman-windows-runtime.ps1).
$hostInfo = ((Invoke-Checked $Podman '--connection' $MachineName 'info' '--format' 'rootless={{.Host.Security.Rootless}} cgroups={{.Host.CgroupManager}}') -join ' ').Trim()
if ($hostInfo -notmatch '(^|\s)cgroups=cgroupfs(\s|$)') {
  throw "podman_cgroup_manager: the JHT Podman service does not run under cgroupfs ($hostInfo); its containers would not start."
}

Write-Host "PODMAN WINDOWS NETWORK READY ($MachineName via agent=$Port broker=$BrokerPort telegram=$TelegramPort)" -ForegroundColor Green
exit 0
