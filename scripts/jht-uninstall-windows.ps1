# Job Hunter Team - what the Windows uninstaller does about the team and its data (T72).
#
# The desktop app's uninstaller runs this from its own folder (a resource of
# the app, the same version), in NSIS_HOOK_PREUNINSTALL of
# desktop/src-tauri/windows/installer-hooks.nsi, never when it updates the app.
#
#   -Mode Keep    /S, /P and the person's NO (the default). The data stays.
#                 Only our Podman machine is stopped, normally and within a
#                 time limit, and only when this user's runtime says it is
#                 ours. Then a report: what stays and how to remove it.
#   -Mode Remove  the person's YES, after the list was shown. A closed list of
#                 absolute paths, one outcome each; a junction or a link is
#                 removed as a link, never entered.
#
# Never touched: other Windows users, Podman and Compose (nothing records that
# we installed them), machines/containers/distros that are not ours, Docker
# Desktop, `wsl --shutdown`, .ssh, the Windows credential store, the team on
# a VPS, the network, and Documents\Job Hunter Team (the person's CVs and
# output). With the v0.3.9 game installed, ~/.jht stays too: the game uses it.
#
# stdout carries stable ASCII lines for the uninstaller's log (JHT_ITEM, JHT_REPORT);
# the sentences for the person are only in the report, in the uninstaller's language.
# Exit code: 0 when every item went as planned, 24 when something is left, 2 on refusal.

[CmdletBinding()]
param(
  [ValidateSet('Keep', 'Remove')][string]$Mode = 'Keep',
  [ValidateSet('it', 'en', 'de', 'es', 'fr', 'hu', 'pt')][string]$Language = 'en',
  [switch]$Update
)

$JhtMachineName = 'jht-podman'
$JhtStartupTaskLabel = 'Job Hunter Team - Start runtime'
function Get-JhtScopedStartupTaskName {
  try {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($sid -match '^S-1-\d+(-\d+)+$') { return "$JhtStartupTaskLabel [$sid]" }
  } catch {}
  return ''
}
$JhtStartupTaskName = Get-JhtScopedStartupTaskName
$JhtAppIdentifier = 'ai.jobhunterteam.desktop'
$JhtGameUninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JobHunterTeam'
$JhtMachineStopSeconds = 90
$JhtMachineRemoveSeconds = 120
# install.ps1 writes jht.cmd with exactly this text: anything else in its place is not ours.
$JhtCmdShim = @'
@echo off
where pwsh.exe >nul 2>&1
if errorlevel 1 goto jht_windows_powershell
pwsh -NoLogo -ExecutionPolicy Bypass -File "%~dp0jht.ps1" %*
exit /b %errorlevel%
:jht_windows_powershell
powershell -NoLogo -ExecutionPolicy Bypass -File "%~dp0jht.ps1" %*
exit /b %errorlevel%
'@

$JhtUninstallText = @{
  it = @{
    Title = 'Job Hunter Team: disinstallazione'
    Removed = 'tolto'; Left = 'NON tolto'; Kept = 'resta'; Stopped = 'fermata'; NotStopped = 'NON fermata'
    Task = 'Avvio automatico della squadra (attività pianificata)'
    Machine = 'Macchina Podman di Job Hunter Team (jht-podman, con i suoi volumi)'
    MachineStop = 'Macchina Podman di Job Hunter Team (jht-podman)'
    Runtime = 'Runtime locale di Job Hunter Team'
    Commands = 'Comandi jht'
    Path = 'Voce di Job Hunter Team nel PATH'
    AppData = 'Impostazioni e credenziali salvate dall''app'
    JhtHome = 'Cartella dei dati della squadra'
    Documents = 'I tuoi documenti (CV, allegati, output)'
    NotOurs = 'una macchina con questo nome c''è, ma questo utente non l''ha installata con Job Hunter Team: non è stata toccata'
    Podman = 'Podman e Compose restano: non risulta che li abbia installati Job Hunter Team. Si tolgono da Impostazioni › App, se non servono ad altro.'
    Vps = 'La squadra su una VPS resta: toglila dall''app o dal pannello del server.'
    Game = 'la cartella dei dati resta perché la usa anche il gioco: per toglierla disinstalla anche il gioco'
    Later = 'Per togliere anche la squadra e i dati: reinstalla Job Hunter Team e disinstallalo di nuovo rispondendo Sì alla domanda sui dati.'
    Failed = 'Qualcosa non è stato tolto: le voci «NON tolto» sopra restano sul computer.'
  }
  en = @{
    Title = 'Job Hunter Team: uninstall'
    Removed = 'removed'; Left = 'NOT removed'; Kept = 'stays'; Stopped = 'stopped'; NotStopped = 'NOT stopped'
    Task = 'Automatic start of the team (scheduled task)'
    Machine = 'Job Hunter Team Podman machine (jht-podman, with its volumes)'
    MachineStop = 'Job Hunter Team Podman machine (jht-podman)'
    Runtime = 'Job Hunter Team local runtime'
    Commands = 'jht commands'
    Path = 'Job Hunter Team entry in the PATH'
    AppData = 'Settings and credentials saved by the app'
    JhtHome = 'The team''s data folder'
    Documents = 'Your documents (CVs, attachments, output)'
    NotOurs = 'a machine with this name exists, but this user did not install it with Job Hunter Team: it was not touched'
    Podman = 'Podman and Compose stay: nothing shows that Job Hunter Team installed them. Remove them from Settings › Apps if nothing else uses them.'
    Vps = 'A team on a VPS stays: remove it from the app or from the server''s panel.'
    Game = 'the data folder stays because the game uses it too: to remove it, uninstall the game as well'
    Later = 'To remove the team and the data too: reinstall Job Hunter Team and uninstall it again, answering Yes to the question about the data.'
    Failed = 'Something was not removed: the items marked NOT removed above stay on the computer.'
  }
  de = @{
    Title = 'Job Hunter Team: Deinstallation'
    Removed = 'entfernt'; Left = 'NICHT entfernt'; Kept = 'bleibt'; Stopped = 'angehalten'; NotStopped = 'NICHT angehalten'
    Task = 'Automatischer Start des Teams (geplante Aufgabe)'
    Machine = 'Podman-Maschine von Job Hunter Team (jht-podman, mit ihren Volumes)'
    MachineStop = 'Podman-Maschine von Job Hunter Team (jht-podman)'
    Runtime = 'Lokale Laufzeit von Job Hunter Team'
    Commands = 'jht-Befehle'
    Path = 'Eintrag von Job Hunter Team im PATH'
    AppData = 'Von der App gespeicherte Einstellungen und Zugangsdaten'
    JhtHome = 'Datenordner des Teams'
    Documents = 'Deine Dokumente (Lebensläufe, Anhänge, Ergebnisse)'
    NotOurs = 'eine Maschine mit diesem Namen gibt es, aber dieser Benutzer hat sie nicht mit Job Hunter Team installiert: sie wurde nicht angerührt'
    Podman = 'Podman und Compose bleiben: Nichts zeigt, dass Job Hunter Team sie installiert hat. Entferne sie unter Einstellungen › Apps, wenn nichts anderes sie braucht.'
    Vps = 'Ein Team auf einem VPS bleibt: Entferne es in der App oder im Panel des Servers.'
    Game = 'der Datenordner bleibt, weil ihn auch das Spiel verwendet: Um ihn zu entfernen, deinstalliere auch das Spiel'
    Later = 'Um auch das Team und die Daten zu entfernen: Installiere Job Hunter Team erneut und deinstalliere es wieder, mit Ja bei der Frage nach den Daten.'
    Failed = 'Etwas wurde nicht entfernt: Die oben mit NICHT entfernt markierten Einträge bleiben auf dem Computer.'
  }
  es = @{
    Title = 'Job Hunter Team: desinstalación'
    Removed = 'eliminado'; Left = 'NO eliminado'; Kept = 'se queda'; Stopped = 'detenida'; NotStopped = 'NO detenida'
    Task = 'Inicio automático del equipo (tarea programada)'
    Machine = 'Máquina Podman de Job Hunter Team (jht-podman, con sus volúmenes)'
    MachineStop = 'Máquina Podman de Job Hunter Team (jht-podman)'
    Runtime = 'Entorno local de Job Hunter Team'
    Commands = 'Comandos jht'
    Path = 'Entrada de Job Hunter Team en el PATH'
    AppData = 'Ajustes y credenciales guardados por la aplicación'
    JhtHome = 'Carpeta de datos del equipo'
    Documents = 'Tus documentos (CV, adjuntos, resultados)'
    NotOurs = 'hay una máquina con este nombre, pero este usuario no la instaló con Job Hunter Team: no se ha tocado'
    Podman = 'Podman y Compose se quedan: nada indica que los instalara Job Hunter Team. Quítalos desde Configuración › Aplicaciones si nada más los usa.'
    Vps = 'Un equipo en un VPS se queda: quítalo desde la aplicación o desde el panel del servidor.'
    Game = 'la carpeta de datos se queda porque también la usa el juego: para quitarla, desinstala también el juego'
    Later = 'Para quitar también el equipo y los datos: vuelve a instalar Job Hunter Team y desinstálalo otra vez respondiendo Sí a la pregunta sobre los datos.'
    Failed = 'Algo no se ha eliminado: las entradas marcadas NO eliminado arriba se quedan en el ordenador.'
  }
  fr = @{
    Title = 'Job Hunter Team : désinstallation'
    Removed = 'supprimé'; Left = 'NON supprimé'; Kept = 'reste'; Stopped = 'arrêtée'; NotStopped = 'NON arrêtée'
    Task = 'Démarrage automatique de l''équipe (tâche planifiée)'
    Machine = 'Machine Podman de Job Hunter Team (jht-podman, avec ses volumes)'
    MachineStop = 'Machine Podman de Job Hunter Team (jht-podman)'
    Runtime = 'Environnement local de Job Hunter Team'
    Commands = 'Commandes jht'
    Path = 'Entrée de Job Hunter Team dans le PATH'
    AppData = 'Réglages et identifiants enregistrés par l''application'
    JhtHome = 'Dossier de données de l''équipe'
    Documents = 'Tes documents (CV, pièces jointes, résultats)'
    NotOurs = 'une machine de ce nom existe, mais cet utilisateur ne l''a pas installée avec Job Hunter Team : elle n''a pas été touchée'
    Podman = 'Podman et Compose restent : rien n''indique que Job Hunter Team les ait installés. Retire-les depuis Paramètres › Applications si rien d''autre ne les utilise.'
    Vps = 'Une équipe sur un VPS reste : retire-la depuis l''application ou le panneau du serveur.'
    Game = 'le dossier de données reste car le jeu l''utilise aussi : pour le retirer, désinstalle aussi le jeu'
    Later = 'Pour retirer aussi l''équipe et les données : réinstalle Job Hunter Team et désinstalle-le de nouveau en répondant Oui à la question sur les données.'
    Failed = 'Quelque chose n''a pas été supprimé : les entrées marquées NON supprimé ci-dessus restent sur l''ordinateur.'
  }
  hu = @{
    Title = 'Job Hunter Team: eltávolítás'
    Removed = 'eltávolítva'; Left = 'NINCS eltávolítva'; Kept = 'marad'; Stopped = 'leállítva'; NotStopped = 'NINCS leállítva'
    Task = 'A csapat automatikus indítása (ütemezett feladat)'
    Machine = 'A Job Hunter Team Podman-gépe (jht-podman, a köteteivel)'
    MachineStop = 'A Job Hunter Team Podman-gépe (jht-podman)'
    Runtime = 'A Job Hunter Team helyi futtatókörnyezete'
    Commands = 'jht parancsok'
    Path = 'A Job Hunter Team bejegyzése a PATH-ban'
    AppData = 'Az alkalmazás által mentett beállítások és hitelesítő adatok'
    JhtHome = 'A csapat adatmappája'
    Documents = 'A dokumentumaid (önéletrajzok, mellékletek, eredmények)'
    NotOurs = 'van ilyen nevű gép, de ez a felhasználó nem a Job Hunter Teammel telepítette: nem nyúltunk hozzá'
    Podman = 'A Podman és a Compose marad: semmi sem mutatja, hogy a Job Hunter Team telepítette őket. A Gépház › Alkalmazások menüben távolíthatod el őket, ha semmi más nem használja.'
    Vps = 'A VPS-en futó csapat marad: távolítsd el az alkalmazásból vagy a szerver paneljéről.'
    Game = 'az adatmappa marad, mert a játék is használja: az eltávolításához a játékot is távolítsd el'
    Later = 'A csapat és az adatok eltávolításához is: telepítsd újra a Job Hunter Teamet, és távolítsd el ismét, Igennel válaszolva az adatokra vonatkozó kérdésre.'
    Failed = 'Valami nem lett eltávolítva: a fent NINCS eltávolítva jelölésű tételek a számítógépen maradnak.'
  }
  pt = @{
    Title = 'Job Hunter Team: desinstalação'
    Removed = 'removido'; Left = 'NÃO removido'; Kept = 'fica'; Stopped = 'parada'; NotStopped = 'NÃO parada'
    Task = 'Arranque automático da equipa (tarefa agendada)'
    Machine = 'Máquina Podman do Job Hunter Team (jht-podman, com os seus volumes)'
    MachineStop = 'Máquina Podman do Job Hunter Team (jht-podman)'
    Runtime = 'Ambiente local do Job Hunter Team'
    Commands = 'Comandos jht'
    Path = 'Entrada do Job Hunter Team no PATH'
    AppData = 'Definições e credenciais guardadas pela aplicação'
    JhtHome = 'Pasta de dados da equipa'
    Documents = 'Os teus documentos (CV, anexos, resultados)'
    NotOurs = 'existe uma máquina com este nome, mas este utilizador não a instalou com o Job Hunter Team: não foi tocada'
    Podman = 'O Podman e o Compose ficam: nada indica que o Job Hunter Team os tenha instalado. Remove-os em Definições › Aplicações se nada mais os usar.'
    Vps = 'Uma equipa numa VPS fica: remove-a na aplicação ou no painel do servidor.'
    Game = 'a pasta de dados fica porque o jogo também a usa: para a remover, desinstala também o jogo'
    Later = 'Para remover também a equipa e os dados: reinstala o Job Hunter Team e desinstala-o de novo, respondendo Sim à pergunta sobre os dados.'
    Failed = 'Algo não foi removido: as entradas marcadas NÃO removido acima ficam no computador.'
  }
}

# ── Roots and paths ───────────────────────────────────────────────────────
# Every target is built from these roots, which come from the Windows API
# (never an environment override), and must lie strictly under its root.

function Get-JhtUninstallRoots {
  return @{
    Profile = [Environment]::GetFolderPath('UserProfile')
    LocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
    AppData = [Environment]::GetFolderPath('ApplicationData')
    Temp = [IO.Path]::GetTempPath()
  }
}

function Test-JhtUsableRoot {
  param([string]$Root)
  if (-not $Root -or -not $Root.Trim()) { return $false }
  if (-not [IO.Path]::IsPathRooted($Root)) { return $false }
  try { $full = [IO.Path]::GetFullPath($Root) } catch { return $false }
  # A drive or filesystem root is never a user's folder.
  if ($full.TrimEnd('\', '/') -eq [IO.Path]::GetPathRoot($full).TrimEnd('\', '/')) { return $false }
  return [IO.Directory]::Exists($full)
}

function Test-JhtStrictlyUnder {
  param([string]$Path, [string]$Root)
  if (-not $Path -or -not $Root) { return $false }
  try {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  } catch { return $false }
  $separator = [IO.Path]::DirectorySeparatorChar
  return $full.StartsWith($base + $separator, [StringComparison]::OrdinalIgnoreCase)
}

function Get-JhtUninstallPlan {
  param([Parameter(Mandatory)][hashtable]$Roots, [bool]$GameInstalled)
  $runtimeRoot = [IO.Path]::Combine($Roots.LocalAppData, 'Job Hunter Team')
  $runtime = [IO.Path]::Combine($runtimeRoot, 'host-runtime')
  $bin = [IO.Path]::Combine($Roots.Profile, '.local', 'bin')
  return [ordered]@{
    RuntimeRoot = $runtimeRoot
    Runtime = $runtime
    Bin = $bin
    JhtHome = [IO.Path]::Combine($Roots.Profile, '.jht')
    # Where the team keeps the person's files: %USERPROFILE%\Documents\Job Hunter Team, as
    # install.ps1 and the wrapper name it (not the Documents known folder, which can be elsewhere).
    Documents = [IO.Path]::Combine($Roots.Profile, 'Documents', 'Job Hunter Team')
    AppData = @(
      [IO.Path]::Combine($Roots.AppData, $JhtAppIdentifier),
      [IO.Path]::Combine($Roots.LocalAppData, $JhtAppIdentifier)
    )
    KeepReport = [IO.Path]::Combine($runtimeRoot, 'disinstallazione.txt')
    RemoveReport = [IO.Path]::Combine($Roots.Temp, 'Job Hunter Team - disinstallazione.txt')
    GameInstalled = $GameInstalled
  }
}

# ── Removing without following a reparse point ────────────────────────────
# Windows PowerShell 5.1's Remove-Item -Recurse can delete what a junction
# inside the tree points at. Here a junction or a link is removed as a link,
# and only real folders are entered.

# The item at a path without following it: $null when nothing is there.
function Get-JhtItem {
  param([string]$Path)
  try { $attributes = [IO.File]::GetAttributes($Path) } catch { return $null }
  if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) { return [IO.DirectoryInfo]::new($Path) }
  return [IO.FileInfo]::new($Path)
}

function Test-JhtPathPresent {
  param([string]$Path)
  return $null -ne (Get-JhtItem $Path)
}

function Remove-JhtItemNoFollow {
  param([Parameter(Mandatory)][IO.FileSystemInfo]$Item)
  if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    # The link itself, never what it points at.
    if ($Item -is [IO.DirectoryInfo]) {
      try { [IO.Directory]::Delete($Item.FullName, $false) } catch { [IO.File]::Delete($Item.FullName) }
    } else { [IO.File]::Delete($Item.FullName) }
    return
  }
  if ($Item -is [IO.DirectoryInfo]) {
    foreach ($child in $Item.GetFileSystemInfos()) { Remove-JhtItemNoFollow $child }
    $Item.Attributes = [IO.FileAttributes]::Directory
    [IO.Directory]::Delete($Item.FullName, $false)
    return
  }
  if (($Item.Attributes -band [IO.FileAttributes]::ReadOnly) -ne 0) { $Item.Attributes = [IO.FileAttributes]::Normal }
  [IO.File]::Delete($Item.FullName)
}

function Remove-JhtTreeNoFollow {
  param([Parameter(Mandatory)][string]$Path)
  $item = Get-JhtItem $Path
  if ($item) { Remove-JhtItemNoFollow $item }
}

# ── Ownership ─────────────────────────────────────────────────────────────

# The machine is ours only when this user's runtime says so, as install.ps1 wrote it.
function Test-JhtOwnedMachine {
  param([Parameter(Mandatory)][string]$Runtime)
  try {
    $machine = [IO.File]::ReadAllText([IO.Path]::Combine($Runtime, 'podman-machine')).Trim()
    $engine = [IO.File]::ReadAllText([IO.Path]::Combine($Runtime, 'container-runtime')).Trim()
  } catch { return $false }
  return ($machine -ceq $JhtMachineName) -and ($engine -ceq 'podman')
}

function Read-JhtRuntimeManifest {
  param([Parameter(Mandatory)][string]$Runtime)
  $entries = @{}
  try {
    foreach ($line in [IO.File]::ReadAllLines([IO.Path]::Combine($Runtime, '.runtime-integrity'))) {
      $cut = $line.IndexOf('=')
      if ($cut -gt 0) { $entries[$line.Substring(0, $cut)] = $line.Substring($cut + 1).Trim().ToLowerInvariant() }
    }
  } catch {}
  return $entries
}

function Get-JhtFileSha256 {
  param([string]$Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $stream = [IO.File]::OpenRead($Path)
      try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
      finally { $stream.Dispose() }
    } finally { $sha.Dispose() }
  } catch { return $null }
}

# The jht commands in .local\bin that are ours: the hashes the runtime's manifest
# wrote, and jht.cmd by its exact text. A jht of anyone else stays.
function Get-JhtOwnCommands {
  param([Parameter(Mandatory)][string]$Bin, [Parameter(Mandatory)][hashtable]$Manifest)
  $own = @()
  foreach ($pair in @(@('jht.ps1', 'jht-wrapper.ps1'), @('windows-private-acl.ps1', 'windows-private-acl.ps1'), @('docker.exe', 'docker.exe'))) {
    $path = [IO.Path]::Combine($Bin, $pair[0])
    $expected = $Manifest[$pair[1]]
    if ($expected -and [IO.File]::Exists($path) -and (Get-JhtFileSha256 $path) -ceq $expected) { $own += $path }
  }
  $cmd = [IO.Path]::Combine($Bin, 'jht.cmd')
  if ([IO.File]::Exists($cmd)) {
    $text = ([IO.File]::ReadAllText($cmd)).Replace("`r`n", "`n").TrimEnd()
    if ($text -ceq $JhtCmdShim.Replace("`r`n", "`n").TrimEnd()) { $own += $cmd }
  }
  return $own
}

function Test-JhtGameInstalled {
  try { return [bool](Get-ItemProperty -LiteralPath $JhtGameUninstallKey -Name UninstallString -ErrorAction Stop).UninstallString }
  catch { return $false }
}

# ── Podman, only the named machine ────────────────────────────────────────

# The uninstaller may have started before Podman entered the PATH: the user's
# and the machine's PATH are read again, then Podman's own folder.
function Find-JhtPodman {
  $folders = @()
  foreach ($scope in 'Process', 'User', 'Machine') {
    try { $folders += @(([string][Environment]::GetEnvironmentVariable('Path', $scope)) -split ';') } catch {}
  }
  foreach ($base in @($env:ProgramW6432, $env:ProgramFiles)) {
    if ($base) { $folders += [IO.Path]::Combine($base, 'RedHat', 'Podman') }
  }
  foreach ($folder in $folders) {
    $clean = ([string]$folder).Trim().Trim('"')
    if (-not $clean -or -not [IO.Path]::IsPathRooted($clean)) { continue }
    $candidate = [IO.Path]::Combine($clean, 'podman.exe')
    if ([IO.File]::Exists($candidate)) { return $candidate }
  }
  return $null
}

# absent, running, stopped, or unknown (no Podman, or its list cannot be read).
function Get-JhtMachineState {
  param([string]$Podman, [string]$Name)
  if (-not $Podman) { return 'unknown' }
  try {
    $raw = ((& { $ErrorActionPreference = 'Continue'; & $Podman machine list --format json 2>$null }) -join '')
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return 'unknown' }
    $parsed = ConvertFrom-Json -InputObject $raw
    # Windows PowerShell 5.1 hands a JSON array over as one object: enumerate it.
    foreach ($machine in @(foreach ($entry in $parsed) { $entry })) {
      if (([string]$machine.Name) -ceq $Name) {
        if ([bool]$machine.Running) { return 'running' }
        return 'stopped'
      }
    }
    return 'absent'
  } catch { return 'unknown' }
}

# One Podman command with a time limit. On time out the machine is left as it
# is (no kill, no `wsl --terminate`): the report says so.
function Invoke-JhtPodmanWithin {
  param([string]$Podman, [string]$Arguments, [int]$Seconds)
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $Podman
  $info.Arguments = $Arguments
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  try { $process = [Diagnostics.Process]::Start($info) } catch { return $false }
  if (-not $process.WaitForExit($Seconds * 1000)) { return $false }
  return $process.ExitCode -eq 0
}

# ── Scheduled task and the user's environment ─────────────────────────────

function Test-JhtStartupTaskPresent {
  if (-not $JhtStartupTaskName) { return $false }
  try { return [bool](Get-ScheduledTask -TaskName $JhtStartupTaskName -ErrorAction SilentlyContinue) } catch { return $false }
}

function Remove-JhtStartupTaskExact {
  try {
    if (-not (Test-JhtStartupTaskPresent)) { return 'absent' }
    Unregister-ScheduledTask -TaskName $JhtStartupTaskName -Confirm:$false -ErrorAction Stop
    if (Test-JhtStartupTaskPresent) { return 'left' }
    return 'removed'
  } catch { return 'left' }
}

# HKCU\Environment, read and written raw: the person's %VAR% entries stay
# unexpanded and the value keeps its type (no setx, which cuts at 1024, and no
# [Environment]::SetEnvironmentVariable, which rewrites it as REG_SZ).
function Get-JhtUserEnvironmentValue {
  param([Parameter(Mandatory)][string]$Name)
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $false)
  if (-not $key) { return $null }
  try {
    if ($key.GetValueNames() -notcontains $Name) { return $null }
    return @{
      Value = [string]$key.GetValue($Name, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      Kind = $key.GetValueKind($Name)
    }
  } finally { $key.Dispose() }
}

function Set-JhtUserEnvironmentValue {
  param([Parameter(Mandatory)][string]$Name, [string]$Value, [Microsoft.Win32.RegistryValueKind]$Kind)
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try { $key.SetValue($Name, $Value, $Kind) } finally { $key.Dispose() }
}

function Remove-JhtUserEnvironmentValue {
  param([Parameter(Mandatory)][string]$Name)
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try { if ($key.GetValueNames() -contains $Name) { $key.DeleteValue($Name) } } finally { $key.Dispose() }
}

# WM_SETTINGCHANGE "Environment": Explorer and the programs started afterwards
# read the new PATH.
function Send-JhtEnvironmentChanged {
  try {
    if (-not ('JhtEnvironmentBroadcast' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JhtEnvironmentBroadcast {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
  public static void Send() {
    UIntPtr result;
    SendMessageTimeout(new IntPtr(0xffff), 0x001A, UIntPtr.Zero, "Environment", 0x0002, 5000, out result);
  }
}
'@
    }
    [JhtEnvironmentBroadcast]::Send()
  } catch {}
}

function Test-JhtPathEntryIsOurs {
  param([string]$Entry, [string]$Bin)
  return ([string]$Entry).Trim().TrimEnd('\', '/') -ieq $Bin.TrimEnd('\', '/')
}

# Only our exact entry leaves the PATH, and without it nothing is written.
function Remove-JhtPathEntry {
  param([Parameter(Mandatory)][string]$Bin, [string]$Name = 'Path')
  $current = Get-JhtUserEnvironmentValue -Name $Name
  if (-not $current) { return 'absent' }
  $entries = @($current.Value -split ';')
  $kept = @($entries | Where-Object { -not (Test-JhtPathEntryIsOurs $_ $Bin) })
  if ($kept.Count -eq $entries.Count) { return 'absent' }
  Set-JhtUserEnvironmentValue -Name $Name -Value ($kept -join ';') -Kind $current.Kind
  Send-JhtEnvironmentChanged
  $after = Get-JhtUserEnvironmentValue -Name $Name
  if ($after -and @($after.Value -split ';' | Where-Object { Test-JhtPathEntryIsOurs $_ $Bin }).Count -gt 0) { return 'left' }
  return 'removed'
}

# ── The two modes ─────────────────────────────────────────────────────────

function Add-JhtReportLine {
  param([System.Collections.Generic.List[string]]$Report, [string]$Label, [string]$State, [string]$Path)
  $line = "- ${Label}: $State"
  if ($Path) { $line += " ($Path)" }
  $Report.Add($line)
}

function Write-JhtReport {
  param([Parameter(Mandatory)][string]$Path, [System.Collections.Generic.List[string]]$Lines)
  try {
    [IO.File]::WriteAllText($Path, (($Lines -join "`r`n") + "`r`n"), [Text.UTF8Encoding]::new($true))
    [Console]::Out.WriteLine("JHT_REPORT $Path")
    return $true
  } catch {
    [Console]::Out.WriteLine('JHT_REPORT none')
    return $false
  }
}

function Invoke-JhtAppUninstall {
  param(
    [Parameter(Mandatory)][ValidateSet('Keep', 'Remove')][string]$Mode,
    [Parameter(Mandatory)][string]$Language,
    [Parameter(Mandatory)][hashtable]$Roots,
    [bool]$GameInstalled,
    [string]$Podman,
    [bool]$Update
  )
  # The updater runs the uninstaller too: then nothing here happens.
  if ($Update) { [Console]::Out.WriteLine('JHT_SKIPPED update'); return 0 }
  foreach ($name in 'Profile', 'LocalAppData', 'AppData', 'Temp') {
    if (-not (Test-JhtUsableRoot $Roots[$name])) { [Console]::Error.WriteLine("unusable folder: $name"); return 2 }
  }
  $t = $JhtUninstallText[$Language]
  if (-not $t) { $t = $JhtUninstallText['en'] }
  $plan = Get-JhtUninstallPlan -Roots $Roots -GameInstalled $GameInstalled
  foreach ($check in @(
    @($plan.RuntimeRoot, $Roots.LocalAppData), @($plan.JhtHome, $Roots.Profile), @($plan.Bin, $Roots.Profile),
    @($plan.AppData[0], $Roots.AppData), @($plan.AppData[1], $Roots.LocalAppData)
  )) {
    if (-not (Test-JhtStrictlyUnder $check[0] $check[1])) { [Console]::Error.WriteLine("target outside its root: $($check[0])"); return 2 }
  }

  $report = [System.Collections.Generic.List[string]]::new()
  $report.Add($t.Title)
  $report.Add('')
  $failed = $false
  $owned = Test-JhtOwnedMachine -Runtime $plan.Runtime
  $state = Get-JhtMachineState -Podman $Podman -Name $JhtMachineName

  if ($Mode -eq 'Keep') {
    if ($owned -and $state -eq 'running') {
      $stopped = (Invoke-JhtPodmanWithin -Podman $Podman -Arguments "machine stop $JhtMachineName" -Seconds $JhtMachineStopSeconds) -and
        ((Get-JhtMachineState -Podman $Podman -Name $JhtMachineName) -eq 'stopped')
      [Console]::Out.WriteLine("JHT_ITEM machine $(if ($stopped) { 'stopped' } else { 'left' })")
      Add-JhtReportLine $report $t.MachineStop $(if ($stopped) { $t.Stopped } else { $t.NotStopped }) ''
      if (-not $stopped) { $failed = $true }
    } elseif ($owned -and $state -eq 'unknown') {
      [Console]::Out.WriteLine('JHT_ITEM machine unknown')
      Add-JhtReportLine $report $t.MachineStop $t.NotStopped ''
      $failed = $true
    } elseif ($owned -and $state -eq 'stopped') {
      Add-JhtReportLine $report $t.MachineStop $t.Kept ''
    } elseif (-not $owned -and ($state -eq 'running' -or $state -eq 'stopped')) {
      [Console]::Out.WriteLine('JHT_ITEM machine not_ours')
      Add-JhtReportLine $report $t.MachineStop $t.NotOurs ''
    }
    if (Test-JhtStartupTaskPresent) { Add-JhtReportLine $report $t.Task $t.Kept '' }
    foreach ($kept in @(
      @($t.Runtime, $plan.Runtime), @($t.Commands, $plan.Bin), @($t.AppData, $plan.AppData[0]),
      @($t.AppData, $plan.AppData[1]), @($t.JhtHome, $plan.JhtHome), @($t.Documents, $plan.Documents)
    )) {
      if (Test-JhtPathPresent $kept[1]) { Add-JhtReportLine $report $kept[0] $t.Kept $kept[1] }
    }
    $report.Add('')
    $report.Add($t.Podman)
    $report.Add($t.Vps)
    $report.Add($t.Later)
    # Next to the runtime that stays. %LOCALAPPDATA%\Job Hunter Team is also where the app
    # itself is installed (Tauri's $INSTDIR for one user): without a runtime there, a report
    # in it would keep that folder alive after the app is gone, so it goes to %TEMP%.
    $where = $plan.KeepReport
    if (-not [IO.Directory]::Exists($plan.Runtime)) { $where = $plan.RemoveReport }
    [void](Write-JhtReport -Path $where -Lines $report)
    if ($failed) { return 24 }
    return 0
  }

  # Remove. The commands that are ours are read before the runtime (and its manifest) go.
  $ownCommands = @(Get-JhtOwnCommands -Bin $plan.Bin -Manifest (Read-JhtRuntimeManifest -Runtime $plan.Runtime))
  $retry = $false
  if (-not $owned -and [IO.Directory]::Exists($plan.Runtime)) {
    # A runtime that is not this user's Podman one (an older Docker install, another
    # machine name): it is what a later uninstall reads, so nothing is removed.
    [Console]::Out.WriteLine('JHT_ITEM runtime not_podman')
    $failed = $true; $retry = $true
  }

  if ($retry) { $task = if (Test-JhtStartupTaskPresent) { 'left' } else { 'absent' } }
  else { $task = Remove-JhtStartupTaskExact }
  [Console]::Out.WriteLine("JHT_ITEM task $task")
  if ($task -eq 'removed') { Add-JhtReportLine $report $t.Task $t.Removed '' }
  elseif ($task -eq 'left') { Add-JhtReportLine $report $t.Task $t.Left ''; $failed = $true; $retry = $true }

  if ($owned -and -not $retry -and ($state -eq 'running' -or $state -eq 'stopped')) {
    $gone = (Invoke-JhtPodmanWithin -Podman $Podman -Arguments "machine rm --force $JhtMachineName" -Seconds $JhtMachineRemoveSeconds) -and
      ((Get-JhtMachineState -Podman $Podman -Name $JhtMachineName) -eq 'absent')
    [Console]::Out.WriteLine("JHT_ITEM machine $(if ($gone) { 'removed' } else { 'left' })")
    Add-JhtReportLine $report $t.Machine $(if ($gone) { $t.Removed } else { $t.Left }) ''
    if (-not $gone) { $failed = $true; $retry = $true }
  } elseif ($owned -and ($retry -or $state -eq 'unknown')) {
    [Console]::Out.WriteLine('JHT_ITEM machine left')
    Add-JhtReportLine $report $t.Machine $t.Left ''
    $failed = $true; $retry = $true
  } elseif (-not $owned -and ($state -eq 'running' -or $state -eq 'stopped')) {
    [Console]::Out.WriteLine('JHT_ITEM machine not_ours')
    Add-JhtReportLine $report $t.MachineStop $t.NotOurs ''
  }

  # While the start task or our machine is left, everything else stays too: the
  # runtime proves the machine is ours, and a later uninstall retries from there.
  # host-runtime, never its parent: %LOCALAPPDATA%\Job Hunter Team holds the app's own files
  # too, which the uninstaller removes right after this, and then the empty folder.
  $items = @(, @('runtime', $t.Runtime, $plan.Runtime))
  foreach ($command in $ownCommands) { $items += , @('command', $t.Commands, $command) }
  $items += , @('appdata', $t.AppData, $plan.AppData[0])
  $items += , @('appdata', $t.AppData, $plan.AppData[1])
  if (-not $plan.GameInstalled) { $items += , @('jht_home', $t.JhtHome, $plan.JhtHome) }
  foreach ($item in $items) {
    if (-not (Test-JhtPathPresent $item[2])) { continue }
    if (-not $retry) {
      try { Remove-JhtTreeNoFollow -Path $item[2] } catch {}
    }
    $left = Test-JhtPathPresent $item[2]
    [Console]::Out.WriteLine("JHT_ITEM $($item[0]) $(if ($left) { 'left' } else { 'removed' })")
    Add-JhtReportLine $report $item[1] $(if ($left) { $t.Left } else { $t.Removed }) $item[2]
    if ($left) { $failed = $true }
  }

  # The PATH entry and the two JHT variables go once no command is left in
  # .local\bin: while other programs live there, the entry stays.
  if (-not $retry) {
    $others = @()
    if ([IO.Directory]::Exists($plan.Bin)) { $others = @([IO.DirectoryInfo]::new($plan.Bin).GetFileSystemInfos()) }
    if ($others.Count -eq 0) {
      $path = Remove-JhtPathEntry -Bin $plan.Bin
      [Console]::Out.WriteLine("JHT_ITEM path $path")
      if ($path -eq 'removed') { Add-JhtReportLine $report $t.Path $t.Removed $plan.Bin }
      elseif ($path -eq 'left') { Add-JhtReportLine $report $t.Path $t.Left $plan.Bin; $failed = $true }
    } else {
      [Console]::Out.WriteLine('JHT_ITEM path kept_for_others')
      Add-JhtReportLine $report $t.Path $t.Kept $plan.Bin
    }
    foreach ($name in 'JHT_CONTAINER_RUNTIME', 'JHT_PODMAN_MACHINE') {
      if (Get-JhtUserEnvironmentValue -Name $name) {
        try { Remove-JhtUserEnvironmentValue -Name $name } catch {}
        $variableLeft = [bool](Get-JhtUserEnvironmentValue -Name $name)
        [Console]::Out.WriteLine("JHT_ITEM variable $(if ($variableLeft) { 'left' } else { 'removed' })")
        if ($variableLeft) { $failed = $true }
      }
    }
  }

  if ($plan.GameInstalled -and (Test-JhtPathPresent $plan.JhtHome)) {
    [Console]::Out.WriteLine('JHT_ITEM jht_home kept_for_game')
    Add-JhtReportLine $report $t.JhtHome "$($t.Kept): $($t.Game)" $plan.JhtHome
  }
  if (Test-JhtPathPresent $plan.Documents) { Add-JhtReportLine $report $t.Documents $t.Kept $plan.Documents }
  $report.Add('')
  $report.Add($t.Podman)
  $report.Add($t.Vps)
  if ($failed) { $report.Add($t.Failed) }
  [void](Write-JhtReport -Path $plan.RemoveReport -Lines $report)
  if ($failed) { return 24 }
  return 0
}

# Run as a script by the uninstaller; dot-sourced (the tests), it only defines.
if ($MyInvocation.InvocationName -ne '.') {
  $code = Invoke-JhtAppUninstall -Mode $Mode -Language $Language -Roots (Get-JhtUninstallRoots) `
    -GameInstalled (Test-JhtGameInstalled) -Podman (Find-JhtPodman) -Update $Update.IsPresent
  exit $code
}
