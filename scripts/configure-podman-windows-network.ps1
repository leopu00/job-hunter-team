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
Environment="CONTAINERS_CGROUP_MANAGER=cgroupfs"
Environment="HTTP_PROXY=$proxyUrl"
Environment="HTTPS_PROXY=$proxyUrl"
Environment="NO_PROXY=localhost,127.0.0.1,::1,host.containers.internal"
Environment="http_proxy=$proxyUrl"
Environment="https_proxy=$proxyUrl"
Environment="no_proxy=localhost,127.0.0.1,::1,host.containers.internal"
ExecStartPre=+/usr/bin/install -d -o user -g user -m 0755 /run/user/1000/podman
ExecStartPre=+/usr/bin/rm -f /run/user/1000/podman/podman.sock
ExecStart=/usr/bin/podman --log-level=info system service --time=0 unix:///run/user/1000/podman/podman.sock

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

Invoke-MachineShell ("sudo mkdir -p /home/user/.local/share/jht-podman /home/user/.config/systemd/user && " +
  "sudo install -o user -g user -m 0644 $(Quote-Sh $proxySourceWsl) /home/user/.local/share/jht-podman/wsl-interop-connect-proxy.py && " +
  "sudo rm -f /home/user/.config/systemd/user/default.target.wants/jht-windows-egress-proxy.service /home/user/.config/systemd/user/jht-windows-egress-proxy.service /home/user/.config/systemd/user/jht-windows-interop-proxy.service /home/user/.config/systemd/user/podman.service.d/jht-proxy.conf && " +
  "sudo ln -sfn /dev/null /home/user/.config/systemd/user/podman.socket && " +
  "sudo ln -sfn /dev/null /home/user/.config/systemd/user/podman.service && " +
  "sudo install -m 0644 $(Quote-Sh $unitWsl) /etc/systemd/system/jht-windows-egress-proxy.service && " +
  "sudo install -m 0644 $(Quote-Sh $brokerUnitWsl) /etc/systemd/system/jht-windows-egress-proxy-broker.service && " +
  "sudo install -m 0644 $(Quote-Sh $telegramUnitWsl) /etc/systemd/system/jht-windows-egress-proxy-telegram.service && " +
  "sudo install -m 0644 $(Quote-Sh $apiServiceWsl) /etc/systemd/system/jht-rootless-podman.service && " +
  "sudo systemctl disable --now jht-rootless-podman.socket 2>/dev/null || true; " +
  "sudo rm -f /etc/systemd/system/jht-rootless-podman.socket /etc/systemd/system/sockets.target.wants/jht-rootless-podman.socket /etc/systemd/system/multi-user.target.wants/jht-rootless-podman.socket")
Invoke-MachineShell 'sudo systemctl daemon-reload && sudo systemctl enable jht-windows-egress-proxy.service jht-windows-egress-proxy-broker.service jht-windows-egress-proxy-telegram.service jht-rootless-podman.service && sudo systemctl restart jht-windows-egress-proxy.service jht-windows-egress-proxy-broker.service jht-windows-egress-proxy-telegram.service jht-rootless-podman.service'
$validation = "agent=`$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --proxy http://127.0.0.1:$Port https://ghcr.io/v2/) && test `"`$agent`" = 401 && " +
  "broker=`$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --proxy http://127.0.0.1:$BrokerPort https://ghcr.io/v2/) && test `"`$broker`" = 401 && " +
  "curl --silent --show-error --output /dev/null --proxy http://127.0.0.1:$TelegramPort https://api.telegram.org/ && " +
  "test `"`$(curl --silent --output /dev/null --write-out '%{http_code}' --proxy http://127.0.0.1:$Port https://example.com:993/)`" = 403 && " +
  "test `"`$(curl --silent --output /dev/null --write-out '%{http_code}' --proxy http://127.0.0.1:$BrokerPort http://example.com/)`" = 403 && " +
  "test `"`$(curl --silent --output /dev/null --write-out '%{http_code}' --proxy http://127.0.0.1:$TelegramPort https://example.com/)`" = 403"
Invoke-MachineShell $validation
Invoke-Checked $Podman '--connection' $MachineName 'info' '--format' 'rootless={{.Host.Security.Rootless}} cgroups={{.Host.CgroupManager}}' | Out-Null

Write-Host "PODMAN WINDOWS NETWORK READY ($MachineName via agent=$Port broker=$BrokerPort telegram=$TelegramPort)" -ForegroundColor Green
