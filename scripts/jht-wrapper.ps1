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
# ║    - Al posto di ensure_bind_owner: Repair-MountOwnership, prima di up,  ║
# ║      un container una tantum (root, solo CAP_CHOWN, senza rete) che      ║
# ║      sistema i mount arrivati di root su Docker Desktop (WSL2).          ║
# ║    - NO host-setup.sh invocation: swap config e' Linux-only, lang/tz     ║
# ║      picker resta gestito dal wizard Node dentro al container.           ║
# ║                                                                          ║
# ║  Riferimento design: docs/internal/ops/vps.md                                ║
# ╚══════════════════════════════════════════════════════════════════════════╝

$ErrorActionPreference = 'Stop'
# Every `docker exec` that hands a command to the container runs with 'Continue': the container's CLI writes its notes on stderr, and
# when a caller merges the streams (`jht doctor 2>&1 | ...`, `*>&1`) Windows PowerShell 5.1 turns each stderr line into an error
# record; under 'Stop' the first one ended jht.ps1, which a PowerShell caller runs in its own process, so it ended the caller's script
# too. The exit code stays the container's ($LASTEXITCODE).
# PSMODULEPATH-BEGIN
# An app started from PowerShell 7 hands its module folders (the 7 ones first) down to the Windows PowerShell 5.1 it starts, and
# 5.1 then cannot load Microsoft.PowerShell.Security (Get-Acl, Get-FileHash): "could not autoload the matching module". The list
# is rebuilt from the folders Windows PowerShell itself uses, before any command that needs a module. PowerShell 7 keeps its own.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $jhtModuleFolders = New-Object System.Collections.Generic.List[string]
  $jhtModuleFolders.Add([IO.Path]::Combine([Environment]::GetFolderPath('MyDocuments'), 'WindowsPowerShell', 'Modules'))
  $jhtModuleFolders.Add([IO.Path]::Combine([Environment]::GetFolderPath('ProgramFiles'), 'WindowsPowerShell', 'Modules'))
  $jhtModuleFolders.Add([IO.Path]::Combine($PSHOME, 'Modules'))
  foreach ($jhtScope in 'Machine', 'User') {
    $jhtScoped = [Environment]::GetEnvironmentVariable('PSModulePath', $jhtScope)
    if ($jhtScoped) { $jhtModuleFolders.Add($jhtScoped) }
  }
  $env:PSModulePath = [string]::Join(';', $jhtModuleFolders.ToArray())
}
# PSMODULEPATH-END

# Capacita' letta dal client desktop prima di invocare `upgrade --check --json`.
# I wrapper storici non la espongono e richiedono il bootstrap temporaneo del
# wrapper production con WrapperPath ancorato al comando host originale.
$JHT_UPGRADE_PROTOCOL = 1
$JHT_HOST_RUNTIME_PROTOCOL = 1
$JHT_DESKTOP_CHAT_PROTOCOL = 1
$JHT_ONBOARDING_SNAPSHOT_PROTOCOL = 1
# Il pannello agenti del desktop chiama `agent-control` solo se trova questa
# riga: un wrapper che non la ha passerebbe il comando al ramo generico, che
# avvia il container.
$JHT_AGENT_CONTROL_PROTOCOL = 1
# L'app del desktop registra nel broker l'autorizzazione a una candidatura con `desktop-apply record` solo se
# trova questa riga: un wrapper che non la ha passerebbe il comando al ramo generico, che avvia il container.
$JHT_DESKTOP_APPLY_PROTOCOL = 1
# `jht integration list|status|add|remove --json` (the integrations added after the setup). The app asks for this line before it calls them.
$JHT_INTEGRATION_PROTOCOL = 1
$JHT_UNINSTALL_PROTOCOL = 1
$JhtUninstallRemovalNotice = 'Vengono cancellati anche la password della posta e i token di Telegram salvati; ~/.jht e Documenti restano, e con loro la sessione LinkedIn salvata (secrets/linkedin-profile e .cache/linkedin): si toglie con jht reset --scope creds.'

# `uninstall` deve funzionare anche quando il runtime e' gia' parzialmente
# rimosso, quindi viene gestito prima di caricare manifest, helper ACL o shim.
# I target ricevuti dal dispatcher sono cartelle standard calcolate dalle API
# Windows, mai override d'ambiente o valori letti dal runtime da cancellare.
# The words of the uninstall for a person: Italian, and English in the language the person chose (see Get-JhtTextLanguage). The desktop app reads the JHT_PHASE and JHT_LEFT
# lines from a pipe; at a console the person gets the sentences instead (JHT_MACHINE_OUTPUT=1 forces the lines, =0 forbids them).
$script:JhtUninstallReason = ''
# The machine this uninstall removes: jht-podman, or the one the runtime attests (Resolve-JhtUninstallMachineName).
$script:JhtUninstallMachine = 'jht-podman'
# With --purge the first notice must not say that ~/.jht and Documents stay: only the secrets are named, the purge notice says the rest.
$script:JhtUninstallPurgeRemovalNotice = 'Vengono cancellati anche la password della posta e i token di Telegram salvati.'
$script:JhtUninstallPurgeNotice = 'Con --purge vengono cancellati anche ~/.jht e Documents\Job Hunter Team: configurazione, database, CV e output. Non si torna indietro.'

# The language of the sentences the wrapper prints, by the rule of the CLI: the one the person chose with `jht setup --language`
# or the picker (saved in i18n-prefs.json next to host.env), then JHT_LANG as the person set it in this terminal, then the one in
# host.env (the installer writes the person's there), then the language of Windows, then English. The file is in a folder the
# container can write: it is read as DATA (not a link, a small file, the value one of the seven codes) and only chooses which text
# is printed. Italian and English are written: another language reads English. Returns 'it' or 'en'.
$script:JhtCallerLang = [string]$env:JHT_LANG
$script:JhtHostEnvLang = ''
function Get-JhtTextLanguage {
  $known = '^(en|it|hu|es|de|fr|pt)\z'
  $code = ''
  try {
    # inside the try: a text must never fail because the folder of the choice cannot be worked out
    $hostEnv = if ($env:JHT_HOST_ENV_FILE) { $env:JHT_HOST_ENV_FILE } else { Join-Path $env:USERPROFILE '.jht\host.env' }
    $prefs = Join-Path (Split-Path -Parent $hostEnv) 'i18n-prefs.json'
    $item = Get-Item -LiteralPath $prefs -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $item.Length -le 4096) {
      $match = [regex]::Match(([IO.File]::ReadAllText($prefs) -replace '[\r\n]', ''), '"locale"\s*:\s*"(en|it|hu|es|de|fr|pt)"')
      if ($match.Success) { $code = $match.Groups[1].Value }
    }
  } catch { $code = '' }
  # outside the wrapper's own start (a function loaded alone) nothing was saved aside: JHT_LANG is the person's
  $caller = if ($null -ne $script:JhtCallerLang) { $script:JhtCallerLang } else { [string]$env:JHT_LANG }
  if (-not $code -and $caller -cmatch $known) { $code = $caller }
  if (-not $code -and $script:JhtHostEnvLang -cmatch $known) { $code = $script:JhtHostEnvLang }
  if (-not $code) {
    try { $code = ([string](Get-UICulture).TwoLetterISOLanguageName).ToLowerInvariant() } catch { $code = '' }
  }
  if ($code -ceq 'it') { return 'it' }
  return 'en'
}

function Get-JhtUninstallText {
  param([Parameter(Mandatory)][string]$Key, [string[]]$Values = @())
  $english = ((Get-JhtTextLanguage) -ceq 'en')
  $texts = @{
    'phase.machine'  = @('Tolgo la macchina Podman <machine> (con i segreti e le immagini di JHT)...', 'Removing the <machine> Podman machine (with the secrets and the images of JHT)...')
    'phase.data'     = @('Cancello ~/.jht e Documents\Job Hunter Team (--purge)...', 'Deleting ~/.jht and Documents\Job Hunter Team (--purge)...')
    'phase.runtime'  = @('Tolgo il runtime di JHT...', 'Removing the JHT runtime...')
    'phase.commands' = @('Tolgo il comando jht, i file dell''installer e le righe PATH...', 'Removing the jht command, the installer files and the PATH lines...')
    'done'           = @('Fatto: la macchina <machine> (e con lei le immagini di JHT, il nucleo e quella piena), il runtime e il comando jht sono stati tolti.', 'Done: the <machine> machine (and with it the JHT images, the core and the full one), the runtime and the jht command are gone.')
    'done.kept'      = @(' ~/.jht e Documents\Job Hunter Team restano (con --purge si cancellano).', ' ~/.jht and Documents\Job Hunter Team stay (--purge deletes them).')
    'done.wsl'       = @('WSL resta in memoria: vmmem, wslservice e wslrelay sono componenti di Windows (non li ha installati Job Hunter Team) e servono anche alle altre macchine WSL di questo utente; di norma si fermano da soli dopo un po'' di inattivita''. Per fermarli subito: wsl --shutdown (ferma TUTTE le macchine WSL aperte).', 'WSL stays in memory: vmmem, wslservice and wslrelay are parts of Windows (Job Hunter Team did not install them) and the other WSL machines of this user need them too; they normally stop by themselves after a while of inactivity. To stop them now: wsl --shutdown (it stops ALL the open WSL machines).')
    'secrets'        = @('I segreti salvati non sono stati rimossi: la password della posta e i token di Telegram stanno nei volumi jht-secrets e jht-telegram-secrets della macchina <machine>, che e'' ancora qui.', 'The saved secrets were not removed: the mail password and the Telegram tokens are in the jht-secrets and jht-telegram-secrets volumes of the <machine> machine, which is still there.')
    'left.machine'   = @('Non tolta: la macchina Podman <machine>. Motivo: {0}. A mano: podman machine stop <machine>; wsl --unregister {1}; poi rilancia jht uninstall --confirm.', 'Not removed: the <machine> Podman machine. Reason: {0}. By hand: podman machine stop <machine>; wsl --unregister {1}; then run jht uninstall --confirm again.')
    'left.task'      = @('Non tolta l''attivita'' di avvio al logon ''{0}'' (motivo: {1}). Il resto e'' stato tolto. A mano: schtasks /Delete /TN "{0}" /F.', 'Not removed: the logon start task ''{0}'' (reason: {1}). Everything else was removed. By hand: schtasks /Delete /TN "{0}" /F.')
    'left.data'      = @('Non cancellati i dati di JHT ({0}). A mano: Remove-Item -Recurse -Force {1}. Il comando jht e il runtime sono rimasti: rilancia jht uninstall --confirm --purge dopo aver risolto.', 'The JHT data was not deleted ({0}). By hand: Remove-Item -Recurse -Force {1}. The jht command and the runtime are still there: run jht uninstall --confirm --purge again once it is sorted out.')
    'left.runtime'   = @('Non tolto: il runtime di JHT in {0}. A mano: Remove-Item -Recurse -Force ''{0}''.', 'Not removed: the JHT runtime in {0}. By hand: Remove-Item -Recurse -Force ''{0}''.')
    'left.commands'  = @('Non tolti il comando jht o i file dell''installer in {0} ({1}), o le variabili e le righe PATH aggiunte dall''installer. A mano: Remove-Item il file; variabili JHT_CONTAINER_RUNTIME e JHT_PODMAN_MACHINE e la cartella {0} nel PATH da Impostazioni > Variabili d''ambiente.', 'Not removed: the jht command or the installer files in {0} ({1}), or the variables and PATH lines the installer added. By hand: Remove-Item the file; the JHT_CONTAINER_RUNTIME and JHT_PODMAN_MACHINE variables and the {0} folder in the PATH from Settings > Environment variables.')
    'kept.machine'   = @('La macchina Podman {0} non risulta creata dall''installer: resta dov''e''. A mano, se e'' tua da togliere: podman machine stop {0}; podman machine rm {0}.', 'The Podman machine {0} is not marked as created by the installer: it stays where it is. By hand, if it is yours to remove: podman machine stop {0}; podman machine rm {0}.')
    'wslconfig.done' = @('Tolte da {0} le righe aggiunte dall''installer (memoria di WSL).', 'Removed from {0} the lines the installer added (WSL memory).')
    'wslconfig.kept' = @('Lasciate in {0} le righe che hai cambiato tu: sono tue.', 'Left in {0} the lines you changed: they are yours.')
    'wslconfig.left' = @('Non toccato {0} ({1}): le righe aggiunte dall''installer (memoria di WSL) restano. Toglile a mano: hanno una riga di commento sopra.', 'Not touched: {0} ({1}). The lines the installer added (WSL memory) stay. Remove them by hand: each has a comment line above it.')
    'bad.target'     = @('Rifiutato: {0} e'' un collegamento o non e'' una cartella: non lo seguo e non lo cancello.', 'Refused: {0} is a link or not a folder: it is not followed and not deleted.')
  }
  $pair = $texts[$Key]
  if (-not $pair) { return $Key }
  $format = if ($english) { $pair[1] } else { $pair[0] }
  return (($format -f $Values).Replace('<machine>', $script:JhtUninstallMachine))
}

function Test-JhtUninstallMachineOutput {
  if ($env:JHT_MACHINE_OUTPUT -ceq '1') { return $true }
  if ($env:JHT_MACHINE_OUTPUT -ceq '0') { return $false }
  return [Console]::IsOutputRedirected
}

function Write-JhtUninstallPhase {
  param([Parameter(Mandatory)][ValidateSet(
    'uninstall_machine', 'uninstall_runtime', 'uninstall_commands'
  )][string]$Id)
  if (Test-JhtUninstallMachineOutput) { [Console]::Out.WriteLine("JHT_PHASE $Id"); return }
  [Console]::Out.WriteLine((Get-JhtUninstallText ('phase.' + $Id.Substring('uninstall_'.Length))))
}

# What is left, as a line for the app and as a sentence with the exact way to remove it by hand, for the person.
function Write-JhtUninstallLeft {
  param([Parameter(Mandatory)][ValidateSet('machine', 'runtime', 'commands')][string]$Id, [string[]]$Values = @())
  if (Test-JhtUninstallMachineOutput) { [Console]::Out.WriteLine("JHT_LEFT $Id") }
  [Console]::Error.WriteLine((Get-JhtUninstallText ('left.' + $Id) $Values))
}

# The distro WSL gives a Podman machine: «podman-» in front of the name, unless the name already starts with «podman».
function Get-JhtPodmanDistroName {
  param([Parameter(Mandatory)][string]$MachineName)
  if ($MachineName.StartsWith('podman', [StringComparison]::Ordinal)) { return $MachineName }
  return "podman-$MachineName"
}

# One line of plain printable text out of what a program said: nothing a terminal could act on, at most 160 characters.
function Format-JhtUninstallReason {
  param([string]$Text)
  $clean = (([string]$Text) -replace '[^\x20-\x7E]', ' ' -replace '\s+', ' ').Trim()
  if ($clean.Length -gt 160) { $clean = $clean.Substring(0, 160) }
  if (-not $clean) { return 'nessuna risposta' }
  return $clean
}

# A program with its arguments, both streams read: the exit code and what it said.
function Invoke-JhtUninstallNative {
  param([Parameter(Mandatory)][string]$Program, [string[]]$Arguments = @())
  $lines = @(& { $ErrorActionPreference = 'Continue'; & $Program @Arguments 2>&1 } | ForEach-Object { [string]$_ })
  $code = $LASTEXITCODE
  return @{ Code = $code; Text = (Format-JhtUninstallReason ($lines -join ' ')) }
}

# podman.exe where the uninstall can find it even when the terminal's PATH does not name it (a per-user Podman, or one installed after
# the terminal was opened): the PATH as the process, the user and the machine have it, then the places Podman installs to.
function Find-JhtUninstallPodman {
  param([string]$FromPath)
  if ($FromPath) { return $FromPath }
  $folders = @()
  foreach ($scope in 'Process', 'User', 'Machine') {
    try { $folders += @(([string][Environment]::GetEnvironmentVariable('Path', $scope)) -split ';') } catch {}
  }
  foreach ($base in @($env:ProgramW6432, $env:ProgramFiles)) {
    if ($base) { $folders += [IO.Path]::Combine($base, 'RedHat', 'Podman'); $folders += [IO.Path]::Combine($base, 'Podman') }
  }
  if ($env:LOCALAPPDATA) { $folders += [IO.Path]::Combine($env:LOCALAPPDATA, 'Programs', 'Podman') }
  foreach ($folder in $folders) {
    $clean = ([string]$folder).Trim().Trim('"')
    if (-not $clean -or -not [IO.Path]::IsPathRooted($clean)) { continue }
    $candidate = [IO.Path]::Combine($clean, 'podman.exe')
    if ([IO.File]::Exists($candidate)) { return $candidate }
  }
  return ''
}

# WSLCONFIG-BEGIN
# %USERPROFILE%\.wslconfig is the settings file of WSL2 for ALL of the person's distributions, not ours: it is never replaced and a key
# the person already has is never touched. A key is added only when it is absent, with a comment line before it that says who added
# it; what was added is recorded (one record file) so that the uninstall takes out exactly those lines and nothing else. The same
# block is in podman-machine-bridge.ps1 and jht-uninstall-windows.ps1 (a test keeps them identical).
$script:JhtWslConfigComment = '# Job Hunter Team added the next line (its installer); "jht uninstall" removes it. Edit or delete it freely.'

# The file as lines, or the reason it is not read: a link, a folder, UTF-16 (Notepad's "Unicode"), or text that is not UTF-8 (WSL reads
# it in the system's code page, so a file with accented text in it is not ours to rewrite).
function Read-JhtWslConfigFile {
  param([Parameter(Mandatory)][string]$Path)
  $info = $null
  try { $info = Get-Item -LiteralPath $Path -Force -ErrorAction Stop } catch { $info = $null }
  if (-not $info) { return @{ Exists = $false; Lines = @(); NewLine = "`r`n"; Bom = $false; Reason = '' } }
  if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return @{ Exists = $true; Reason = 'it is a link or a folder' } }
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) { return @{ Exists = $true; Reason = 'it is saved as UTF-16' } }
  if ($bytes -contains 0) { return @{ Exists = $true; Reason = 'it is not plain text' } }
  $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  try { $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes, $(if ($bom) { 3 } else { 0 }), $bytes.Length - $(if ($bom) { 3 } else { 0 })) }
  catch { return @{ Exists = $true; Reason = 'it is not UTF-8 text' } }
  $newLine = if ($text.Contains("`r`n")) { "`r`n" } elseif ($text.Contains("`n")) { "`n" } else { "`r`n" }
  $lines = @()
  if ($text.Length) {
    $lines = @($text -split '\r?\n')
    if ($lines[-1] -eq '') { $lines = @($lines | Select-Object -First ($lines.Count - 1)) }
  }
  return @{ Exists = $true; Lines = $lines; NewLine = $newLine; Bom = $bom; Reason = '' }
}

# Written to a temporary file beside it and put in its place: a program reading it never meets half a file.
function Write-JhtWslConfigFile {
  param([Parameter(Mandatory)][string]$Path, [string[]]$Lines, [string]$NewLine = "`r`n", [bool]$Bom = $false)
  $body = if ($Lines.Count) { ($Lines -join $NewLine) + $NewLine } else { '' }
  $encoded = [Text.UTF8Encoding]::new($false).GetBytes($body)
  if ($Bom) { $encoded = [byte[]](@(0xEF, 0xBB, 0xBF) + $encoded) }
  $temporary = $Path + '.jht-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.tmp'
  try {
    [IO.File]::WriteAllBytes($temporary, $encoded)
    if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) } else { [IO.File]::Move($temporary, $Path) }
  } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}

# The lines of each section: name (lower case) -> first and last line index; the lines before any header are not in a section.
function Get-JhtWslConfigSections {
  param([string[]]$Lines)
  $found = [ordered]@{}
  $name = $null
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    if ($Lines[$i] -match '^\s*\[([^\]]+)\]\s*(?:[#;].*)?$') {
      $name = $Matches[1].Trim().ToLowerInvariant()
      if (-not $found.Contains($name)) { $found[$name] = @{ Header = $i; Last = $i } }
      $current = $name
    } elseif ($null -ne $name -and $found.Contains($name)) {
      $found[$name].Last = $i
    }
  }
  return $found
}

# Adds each wanted key that is absent from its section: @{ Section; Key; Value }. Answer: Status 'added' | 'unchanged' | 'skipped'
# (with Reason), Created (the file did not exist), Added (the entries written, with SectionCreated).
function Add-JhtWslConfigKeys {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object[]]$Entries)
  $file = Read-JhtWslConfigFile -Path $Path
  if ($file.Reason) { return @{ Status = 'skipped'; Reason = $file.Reason; Created = $false; Added = @() } }
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in @($file.Lines)) { $lines.Add([string]$line) }
  $added = @()
  foreach ($entry in $Entries) {
    $section = ([string]$entry.Section).ToLowerInvariant()
    $sections = Get-JhtWslConfigSections -Lines $lines.ToArray()
    if ($sections.Contains($section)) {
      $range = $sections[$section]
      $present = $false
      for ($i = $range.Header + 1; $i -le $range.Last; $i++) {
        if ($lines[$i] -match ('^\s*' + [regex]::Escape([string]$entry.Key) + '\s*=')) { $present = $true; break }
      }
      if ($present) { continue }
      # after the last line that is a setting (a comment or blank lines at the end of the section belong to what follows)
      $at = $range.Header
      for ($i = $range.Header + 1; $i -le $range.Last; $i++) { if ($lines[$i] -match '^\s*[^\s#;]') { $at = $i } }
      $lines.Insert($at + 1, "$($entry.Key)=$($entry.Value)")
      $lines.Insert($at + 1, $script:JhtWslConfigComment)
      $added += @{ Section = $section; Key = [string]$entry.Key; Value = [string]$entry.Value; SectionCreated = $false }
    } else {
      if ($lines.Count -and $lines[$lines.Count - 1].Trim() -ne '') { $lines.Add('') }
      $lines.Add("[$section]")
      $lines.Add($script:JhtWslConfigComment)
      $lines.Add("$($entry.Key)=$($entry.Value)")
      $added += @{ Section = $section; Key = [string]$entry.Key; Value = [string]$entry.Value; SectionCreated = $true }
    }
  }
  if (-not $added.Count) { return @{ Status = 'unchanged'; Reason = ''; Created = $false; Added = @() } }
  Write-JhtWslConfigFile -Path $Path -Lines $lines.ToArray() -NewLine $file.NewLine -Bom $file.Bom
  return @{ Status = 'added'; Reason = ''; Created = (-not $file.Exists); Added = $added }
}

# The record of what was added, one fact per line: file=<path>, created=0|1, add=<section>|<key>|<value>|<section created 0|1>.
function ConvertTo-JhtWslConfigRecord {
  param([Parameter(Mandatory)][string]$Path, [bool]$Created, [object[]]$Added)
  $out = @('version=1', "file=$Path", "created=$(if ($Created) { 1 } else { 0 })")
  foreach ($entry in $Added) { $out += "add=$($entry.Section)|$($entry.Key)|$($entry.Value)|$(if ($entry.SectionCreated) { 1 } else { 0 })" }
  return ($out -join "`n") + "`n"
}

# Takes out exactly the lines the record names, each only if it is still there as it was written (the comment line before it too).
# What the person changed stays. Answer: Removed, Kept (the lines left because they were changed or are gone), Path.
# The record of what the setup added, read only from a plain small file (never through a link or a folder): '' otherwise.
function Read-JhtWslConfigRecord {
  param([Parameter(Mandatory)][string]$Path)
  try {
    $info = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 4096) { return '' }
    return [IO.File]::ReadAllText($Path)
  } catch { return '' }
}

# The only file a record may name: .wslconfig in the profile of the person who runs the uninstall. A record that names any other
# file is not acted on (it sits in a folder the person can write, and created=1 would delete the file it names).
function Test-JhtWslConfigRecordTarget {
  param([string]$Path, [Parameter(Mandatory)][string]$ProfilePath)
  try {
    if (-not $Path -or -not [IO.Path]::IsPathRooted($Path) -or -not [IO.Path]::IsPathRooted($ProfilePath)) { return $false }
    $expected = [IO.Path]::GetFullPath([IO.Path]::Combine($ProfilePath, '.wslconfig'))
    return [string]::Equals([IO.Path]::GetFullPath($Path), $expected, [StringComparison]::OrdinalIgnoreCase)
  } catch { return $false }
}

function Remove-JhtWslConfigKeys {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$RecordText, [Parameter(Mandatory)][string]$ProfilePath)
  $path = ''; $created = $false; $adds = @()
  foreach ($line in ($RecordText -split '\r?\n')) {
    if ($line -match '^file=(.+)$') { $path = $Matches[1] }
    elseif ($line -match '^created=1$') { $created = $true }
    elseif ($line -match '^add=([^|]+)\|([^|]+)\|([^|]*)\|([01])$') { $adds += @{ Section = $Matches[1]; Key = $Matches[2]; Value = $Matches[3]; SectionCreated = ($Matches[4] -eq '1') } }
  }
  if (-not $path -or -not [IO.Path]::IsPathRooted($path) -or -not $adds.Count) { return @{ Removed = 0; Kept = 0; Path = $path; Reason = 'no record' } }
  if (-not (Test-JhtWslConfigRecordTarget -Path $path -ProfilePath $ProfilePath)) { return @{ Removed = 0; Kept = 0; Path = $path; Reason = 'no record' } }
  $file = Read-JhtWslConfigFile -Path $path
  if (-not $file.Exists) { return @{ Removed = 0; Kept = 0; Path = $path; Reason = '' } }
  if ($file.Reason) { return @{ Removed = 0; Kept = $adds.Count; Path = $path; Reason = $file.Reason } }
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in @($file.Lines)) { $lines.Add([string]$line) }
  $removed = 0; $kept = 0
  foreach ($entry in $adds) {
    $sections = Get-JhtWslConfigSections -Lines $lines.ToArray()
    $hit = -1
    if ($sections.Contains($entry.Section)) {
      $range = $sections[$entry.Section]
      for ($i = $range.Header + 1; $i -le $range.Last; $i++) {
        if ($lines[$i] -match ('^\s*' + [regex]::Escape($entry.Key) + '\s*=\s*(.*?)\s*$') -and $Matches[1] -eq $entry.Value -and $i -gt $range.Header + 0 -and $lines[$i - 1] -ceq $script:JhtWslConfigComment) { $hit = $i; break }
      }
    }
    if ($hit -lt 0) { $kept++; continue }
    $lines.RemoveRange($hit - 1, 2)
    $removed++
    if ($entry.SectionCreated) {
      $sections = Get-JhtWslConfigSections -Lines $lines.ToArray()
      if ($sections.Contains($entry.Section)) {
        $range = $sections[$entry.Section]
        $empty = $true
        for ($i = $range.Header + 1; $i -le $range.Last; $i++) { if ($lines[$i].Trim() -ne '') { $empty = $false; break } }
        if ($empty) {
          $lines.RemoveRange($range.Header, $range.Last - $range.Header + 1)
          if ($range.Header -gt 0 -and $lines.Count -ge $range.Header -and $lines[$range.Header - 1].Trim() -eq '') { $lines.RemoveAt($range.Header - 1) }
        }
      }
    }
  }
  if ($removed) {
    $onlyBlank = -not @($lines | Where-Object { $_.Trim() -ne '' }).Count
    if ($created -and $onlyBlank) { [IO.File]::Delete($path) }
    else { Write-JhtWslConfigFile -Path $path -Lines $lines.ToArray() -NewLine $file.NewLine -Bom $file.Bom }
  }
  return @{ Removed = $removed; Kept = $kept; Path = $path; Reason = '' }
}
# WSLCONFIG-END

# Whether the [wsl2] section of the file has a memory= of its own. A file that cannot be read counts as having one: nothing is advised
# about a file that cannot be told. (The same function is in podman-machine-bridge.ps1; a test keeps them identical.)
function Test-JhtWslConfigHasMemory {
  param([Parameter(Mandatory)][string]$Path)
  $file = Read-JhtWslConfigFile -Path $Path
  if ($file.Reason) { return $true }
  $lines = @($file.Lines)
  $sections = Get-JhtWslConfigSections -Lines $lines
  if (-not $sections.Contains('wsl2')) { return $false }
  for ($i = $sections['wsl2'].Header + 1; $i -le $sections['wsl2'].Last; $i++) { if ($lines[$i] -match '^\s*memory\s*=') { return $true } }
  return $false
}

# For jht doctor: the memory limit the setup did not write for WSL because other distributions are registered (its wslconfig-advice,
# in the runtime folder), while the person's .wslconfig still has no memory= of its own. '' otherwise; never a reason to fail.
function Get-JhtDoctorWslMemoryAdvice {
  try {
    $advicePath = Join-Path $RuntimeDir 'wslconfig-advice'
    $info = Get-Item -LiteralPath $advicePath -Force -ErrorAction Stop
    if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 64) { return '' }
    $text = [IO.File]::ReadAllText($advicePath)
    if ($text -cnotmatch '^memory=([1-9][0-9]?GB)\r?\n?$') { return '' }
    $value = $Matches[1]
    if (-not $env:USERPROFILE -or (Test-JhtWslConfigHasMemory -Path (Join-Path $env:USERPROFILE '.wslconfig'))) { return '' }
    return $value
  } catch { return '' }
}

# The lines the setup added to the person's .wslconfig, taken out (their record is in the runtime folder, which goes after): sentences
# only, never JHT_PHASE or JHT_LEFT lines, and never a reason to stop the uninstall.
function Restore-JhtWslConfigAtUninstall {
  param([Parameter(Mandatory)][string]$RuntimePath, [Parameter(Mandatory)][string]$ProfilePath)
  try {
    $record = [IO.Path]::Combine($RuntimePath, 'wslconfig-added')
    if (-not [IO.File]::Exists($record)) { return }
    $answer = Remove-JhtWslConfigKeys -RecordText (Read-JhtWslConfigRecord -Path $record) -ProfilePath $ProfilePath
    if ($answer.Reason -and $answer.Reason -ne 'no record') { [Console]::Out.WriteLine((Get-JhtUninstallText 'wslconfig.left' @($answer.Path, $answer.Reason))); return }
    if ($answer.Removed) { [Console]::Out.WriteLine((Get-JhtUninstallText 'wslconfig.done' @($answer.Path))) }
    if ($answer.Kept) { [Console]::Out.WriteLine((Get-JhtUninstallText 'wslconfig.kept' @($answer.Path))) }
  } catch {
    [Console]::Out.WriteLine((Get-JhtUninstallText 'wslconfig.left' @('.wslconfig', (Format-JhtUninstallReason $_.Exception.Message))))
  }
}

# The leftover of the machine, said with what is inside it and why it is still there.
function Write-JhtUninstallMachineLeft {
  Write-JhtUninstallLeft machine @($script:JhtUninstallReason, (Get-JhtPodmanDistroName $script:JhtUninstallMachine))
  [Console]::Error.WriteLine((Get-JhtUninstallText 'secrets'))
}

function Get-JhtNormalizedWindowsPath {
  param([string]$Path)
  if (-not $Path) { return $null }
  try {
    $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
    return [IO.Path]::GetFullPath($expanded).TrimEnd('\', '/')
  } catch { return $null }
}

function Get-JhtPodmanMachineState {
  param(
    [string]$PodmanPath,
    [string]$WslPath,
    [string]$MachineName
  )
  if ($PodmanPath) {
    try {
      $raw = ((& { $ErrorActionPreference = 'Continue'; & $PodmanPath machine list --format json 2>$null }) -join '')
      if ($LASTEXITCODE -eq 0 -and $raw) {
        # Windows PowerShell 5.1 gives a JSON array to the pipeline as ONE object: with two
        # machines `[string]$_.Name` joined both names and the JHT one was «absent».
        $parsed = ConvertFrom-Json -InputObject $raw
        $machines = @(foreach ($machine in $parsed) { $machine })
        if (@($machines | Where-Object { ([string]$_.Name) -ceq $MachineName }).Count -gt 0) { return 'present' }
        return 'absent'
      }
    } catch {}
  }
  if ($WslPath) {
    try {
      $distros = @(& { $ErrorActionPreference = 'Continue'; & $WslPath --list --quiet 2>$null } | ForEach-Object { ([string]$_).Replace([string][char]0, '').Trim() })
      if ($LASTEXITCODE -eq 0) {
        # The distro is «podman-<name>» (podman-jht-podman); the older spelling «podman-machine-<name>» is looked for too.
        if ($distros -ccontains (Get-JhtPodmanDistroName $MachineName) -or $distros -ccontains "podman-machine-$MachineName") { return 'present' }
        return 'absent'
      }
    } catch {}
  }
  return 'unknown'
}

function Remove-JhtUserEnvironment {
  param(
    [string]$BinPath,
    [System.EnvironmentVariableTarget]$Target = [System.EnvironmentVariableTarget]::User
  )
  try {
    foreach ($name in @('JHT_CONTAINER_RUNTIME', 'JHT_PODMAN_MACHINE')) {
      [Environment]::SetEnvironmentVariable($name, $null, $Target)
      if ([Environment]::GetEnvironmentVariable($name, $Target)) { return $false }
    }
    $userPath = [Environment]::GetEnvironmentVariable('Path', $Target)
    if ($userPath) {
      $normalizedBin = Get-JhtNormalizedWindowsPath $BinPath; $normalizedShim = Get-JhtNormalizedWindowsPath (Join-Path $BinPath 'shim')
      $kept = @($userPath -split ';' | Where-Object {
        $candidate = Get-JhtNormalizedWindowsPath $_
        $_ -and (-not $candidate -or -not ($candidate.Equals($normalizedBin, [StringComparison]::OrdinalIgnoreCase) -or $candidate.Equals($normalizedShim, [StringComparison]::OrdinalIgnoreCase)))
      })
      [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), $Target)
      $remaining = @(([Environment]::GetEnvironmentVariable('Path', $Target)) -split ';' | Where-Object {
        $candidate = Get-JhtNormalizedWindowsPath $_
        $_ -and $candidate -and ($candidate.Equals($normalizedBin, [StringComparison]::OrdinalIgnoreCase) -or $candidate.Equals($normalizedShim, [StringComparison]::OrdinalIgnoreCase))
      })
      if ($remaining.Count -gt 0) { return $false }
    }
    return $true
  } catch { return $false }
}

function Get-JhtScopedStartupTaskName {
  try {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($sid -match '^S-1-\d+(-\d+)+$') { return "Job Hunter Team - Start runtime [$sid]" }
  } catch {}
  return ''
}

# The tasks of this exact name, found by comparing names: -TaskName takes wildcards, and the [ ] of "... [<SID>]" are one, so a call with
# the name raises "wildcard pattern not valid" for every user. Throws when the list itself cannot be read; no task is an empty list.
function Get-JhtStartupTaskExact {
  param([Parameter(Mandatory)][string]$TaskName)
  return @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -ceq $TaskName -and $_.TaskPath -ceq '\' })
}

# $true when the task is gone (it was not there, or it was removed and the list confirms it). $false only for a real failure, with what
# Windows said in $script:JhtStartupTaskReason: the caller reports it and goes on.
function Remove-JhtStartupTask {
  param([string]$TaskName = (Get-JhtScopedStartupTaskName))
  $script:JhtStartupTaskReason = ''
  if (-not $TaskName) { return $true }
  try {
    $tasks = @(Get-JhtStartupTaskExact $TaskName)
    if ($tasks.Count -eq 0) { return $true }
    foreach ($task in $tasks) { Unregister-ScheduledTask -InputObject $task -Confirm:$false -ErrorAction Stop }
    if (@(Get-JhtStartupTaskExact $TaskName).Count -eq 0) { return $true }
    $script:JhtStartupTaskReason = 'la attivita'' risulta ancora registrata'
    return $false
  } catch {
    $script:JhtStartupTaskReason = (Format-JhtUninstallReason $_.Exception.Message)
    return $false
  }
}

# Removes the machine when podman could not: the distro of OUR machine by its exact name (never another), ended and unregistered, then
# Podman's own record of it. $true when the machine is gone. The reason it could not be done goes in $script:JhtUninstallReason.
function Remove-JhtPodmanMachineThroughWsl {
  param([string]$PodmanPath, [string]$WslPath, [string]$MachineName)
  if (-not $WslPath) { return $false }
  $distro = Get-JhtPodmanDistroName $MachineName
  $listed = @(& { $ErrorActionPreference = 'Continue'; & $WslPath --list --quiet 2>$null } | ForEach-Object { ([string]$_).Replace([string][char]0, '').Trim() })
  if ($listed -cnotcontains $distro) { return $false }
  # Podman's own stop first: it closes the machine's win-sshproxy and frees its pipe, which `machine rm` can no longer do once the
  # distro is unregistered (WSL_E_DISTRO_NOT_FOUND). Its answer does not matter: the distro is ended and unregistered next.
  if ($PodmanPath) { $null = Invoke-JhtUninstallNative $PodmanPath @('machine', 'stop', $MachineName) }
  $null = Invoke-JhtUninstallNative $WslPath @('--terminate', $distro)
  $unregister = Invoke-JhtUninstallNative $WslPath @('--unregister', $distro)
  if ($unregister.Code -ne 0) {
    # What Podman said (already in the reason) and what WSL said: the person reads both.
    $said = "wsl --unregister $distro : $($unregister.Text)"
    $script:JhtUninstallReason = if ($script:JhtUninstallReason) { "$($script:JhtUninstallReason); $said" } else { $said }
    return $false
  }
  if ($PodmanPath) { $null = Invoke-JhtUninstallNative $PodmanPath @('machine', 'rm', '--force', $MachineName) }
  return (Get-JhtPodmanMachineState -PodmanPath $PodmanPath -WslPath $WslPath -MachineName $MachineName) -eq 'absent'
}

# What the installer left in %LOCALAPPDATA%\Job Hunter Team\podman-network: the units of the machine and the native connector, by their
# exact names (the connector's name ends in the digest of its source). Another file in that folder stays, and so does the folder then.
# $true when nothing of ours is left; the folder (and its parent, the one of the app) go only when they are empty, never recursively.
function Remove-JhtPodmanNetworkFiles {
  param([Parameter(Mandatory)][string]$LocalAppDataPath)
  $parent = [IO.Path]::Combine([IO.Path]::GetFullPath($LocalAppDataPath), 'Job Hunter Team')
  $folder = [IO.Path]::Combine($parent, 'podman-network')
  $ownNames = @('jht-windows-egress-proxy.service', 'jht-windows-egress-proxy-broker.service', 'jht-windows-egress-proxy-telegram.service',
    'jht-rootless-podman.service', 'jht-broker-container.service')
  $ok = $true
  try {
    $attributes = [IO.File]::GetAttributes($folder)
    if (($attributes -band [IO.FileAttributes]::Directory) -eq 0 -or ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
  } catch { return $true }
  foreach ($file in [IO.DirectoryInfo]::new($folder).GetFiles()) {
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    if ($ownNames -cnotcontains $file.Name -and $file.Name -cnotmatch '^jht-windows-connect-[0-9a-f]{12}\.exe$') { continue }
    try {
      if (($file.Attributes -band [IO.FileAttributes]::ReadOnly) -ne 0) { $file.Attributes = [IO.FileAttributes]::Normal }
      [IO.File]::Delete($file.FullName)
    } catch { $ok = $false; $script:JhtUninstallReason = (Format-JhtUninstallReason $_.Exception.Message) }
  }
  foreach ($empty in @($folder, $parent)) { try { [IO.Directory]::Delete($empty, $false) } catch {} }
  return $ok
}

# The folders `--purge` deletes: fixed, never taken from the environment; each one a real folder, never a link.
function Remove-JhtUserDataFolder {
  param([Parameter(Mandatory)][string]$Path)
  $attributes = $null
  try { $attributes = [IO.File]::GetAttributes($Path) } catch { return $true }
  if (($attributes -band [IO.FileAttributes]::Directory) -eq 0 -or ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    [Console]::Error.WriteLine((Get-JhtUninstallText 'bad.target' @($Path)))
    $script:JhtUninstallReason = 'collegamento o non cartella'
    return $false
  }
  try {
    Remove-JhtDirectoryNoFollow ([IO.DirectoryInfo]::new($Path))
  } catch {
    $script:JhtUninstallReason = (Format-JhtUninstallReason $_.Exception.Message)
    return $false
  }
  return -not (Test-Path -LiteralPath $Path)
}

# A junction or a link inside is removed as a link: Windows PowerShell 5.1's Remove-Item -Recurse can delete what one points at.
function Remove-JhtDirectoryNoFollow {
  param([Parameter(Mandatory)][IO.FileSystemInfo]$Item)
  if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    if ($Item -is [IO.DirectoryInfo]) { try { [IO.Directory]::Delete($Item.FullName, $false) } catch { [IO.File]::Delete($Item.FullName) } }
    else { [IO.File]::Delete($Item.FullName) }
    return
  }
  if ($Item -is [IO.DirectoryInfo]) {
    foreach ($child in $Item.GetFileSystemInfos()) { Remove-JhtDirectoryNoFollow $child }
    $Item.Attributes = [IO.FileAttributes]::Directory
    [IO.Directory]::Delete($Item.FullName, $false)
    return
  }
  if (($Item.Attributes -band [IO.FileAttributes]::ReadOnly) -ne 0) { $Item.Attributes = [IO.FileAttributes]::Normal }
  [IO.File]::Delete($Item.FullName)
}

# One Podman machine per Windows user (JHT-T305): install.ps1 gives a user who has none jht-podman-<8 hex of the SHA-256 of their SID>.
# The same function is in install.ps1 and in the uninstall of the app; tests/test_windows_machine_per_user.py keeps the three equal.
function Get-JhtUserMachineName {
  param([string]$Sid = '')
  if (-not $Sid) { try { $Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value } catch { $Sid = '' } }
  if ($Sid -notmatch '^S-1-\d+(-\d+)+$') { return 'jht-podman' }
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::ASCII.GetBytes($Sid))
  return 'jht-podman-' + (([BitConverter]::ToString($hash, 0, 4) -replace '-', '').ToLowerInvariant())
}

# The mark the installer leaves when IT created the machine (its `machine init` succeeded): a regular file, never a link, whose first
# line is the name of the machine.
function Test-JhtMachineCreatedMark {
  param([string]$RuntimePath, [string]$Name)
  $file = Join-Path $RuntimePath 'podman-machine-created'
  try {
    $item = Get-Item -LiteralPath $file -Force -ErrorAction Stop
    if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return $false }
    $first = @([IO.File]::ReadAllLines($file) | Select-Object -First 1)
    return ($first.Count -eq 1 -and ([string]$first[0]).Trim() -ceq $Name)
  } catch { return $false }
}

# The machine this uninstall removes. The runtime attests it (podman-machine): jht-podman, the name of this user's own, or any other
# name only with the installer's mark (another machine of the same name, adopted from the user, stays: Kept says which). Without the
# attestation (the runtime is gone or partly gone): the user's own machine when it is there, else jht-podman, as before.
function Resolve-JhtUninstallMachineName {
  param([string]$RuntimePath, [string]$PodmanPath, [string]$WslPath, [string]$Sid = '')
  $standard = 'jht-podman'
  $own = Get-JhtUserMachineName -Sid $Sid
  $attested = ''
  try { $attested = ([IO.File]::ReadAllText((Join-Path $RuntimePath 'podman-machine'))).Trim() } catch { $attested = '' }
  if ($attested) {
    if ($attested -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$') { return @{ Name = $standard; Kept = '' } }
    if ($attested -ceq $standard -or $attested -ceq $own -or (Test-JhtMachineCreatedMark -RuntimePath $RuntimePath -Name $attested)) { return @{ Name = $attested; Kept = '' } }
    return @{ Name = $standard; Kept = $attested }
  }
  if ($own -cne $standard -and (Get-JhtPodmanMachineState -PodmanPath $PodmanPath -WslPath $WslPath -MachineName $own) -eq 'present') { return @{ Name = $own; Kept = '' } }
  return @{ Name = $standard; Kept = '' }
}

function Invoke-JhtWindowsUninstall {
  param(
    [string[]]$UninstallArgs,
    [Parameter(Mandatory)][string]$ProfilePath,
    [Parameter(Mandatory)][string]$LocalAppDataPath,
    [string]$PodmanPath,
    [string]$WslPath,
    [System.EnvironmentVariableTarget]$EnvironmentTarget = [System.EnvironmentVariableTarget]::User
  )
  $purge = $false
  $argsOk = ($UninstallArgs.Count -eq 1 -and $UninstallArgs[0] -ceq '--confirm') -or
    ($UninstallArgs.Count -eq 2 -and @($UninstallArgs | Where-Object { $_ -ceq '--confirm' }).Count -eq 1 -and @($UninstallArgs | Where-Object { $_ -ceq '--purge' }).Count -eq 1)
  if (-not $argsOk) {
    [Console]::Error.WriteLine('uso: jht uninstall --confirm [--purge]')
    [Console]::Error.WriteLine($JhtUninstallRemovalNotice)
    [Console]::Error.WriteLine($script:JhtUninstallPurgeNotice)
    return 2
  }
  $purge = $UninstallArgs.Count -eq 2
  if ($purge) { [Console]::Error.WriteLine($script:JhtUninstallPurgeRemovalNotice) } else { [Console]::Error.WriteLine($JhtUninstallRemovalNotice) }
  if ($purge) { [Console]::Error.WriteLine($script:JhtUninstallPurgeNotice) }
  $script:JhtUninstallReason = ''

  $machineName = 'jht-podman'
  $runtimePath = [IO.Path]::Combine([IO.Path]::GetFullPath($LocalAppDataPath), 'Job Hunter Team', 'host-runtime')
  $binPath = [IO.Path]::Combine([IO.Path]::GetFullPath($ProfilePath), '.local', 'bin')
  $selectionPath = Join-Path $runtimePath 'container-runtime'
  # Every file install.ps1 publishes in the bin folder, and nothing else: another program's file stays (tests/test_windows_uninstall_files.py
  # keeps this list, the one of the desktop uninstall and what the installer publishes together).
  $knownCommands = @(
    (Join-Path $binPath 'jht.ps1'),
    (Join-Path $binPath 'jht.cmd'), (Join-Path $binPath 'shim\jht.cmd'), (Join-Path $binPath 'shim'),
    (Join-Path $binPath 'windows-private-acl.ps1'),
    (Join-Path $binPath 'podman-machine-bridge.ps1'),
    (Join-Path $binPath 'docker.exe')
  )
  $PodmanPath = Find-JhtUninstallPodman -FromPath $PodmanPath
  $resolved = Resolve-JhtUninstallMachineName -RuntimePath $runtimePath -PodmanPath $PodmanPath -WslPath $WslPath
  $machineName = $resolved.Name
  $script:JhtUninstallMachine = $machineName
  if ($resolved.Kept) { [Console]::Error.WriteLine((Get-JhtUninstallText 'kept.machine' @($resolved.Kept))) }
  $leftCommands = {
    $present = @($knownCommands | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Split-Path -Leaf $_ })
    return ($present -join ', ')
  }

  # Un wrapper nuovo puo' essere arrivato anche sopra una vecchia installazione
  # Docker. In quel caso non cancelliamo i file host lasciando il container
  # legacy attivo sugli stessi dati: solo il runtime Podman ha questo comando.
  if (Test-Path -LiteralPath $runtimePath) {
    $notPodman = $false
    try {
      if (-not (Test-Path -LiteralPath $selectionPath -PathType Leaf) -or
          ([IO.File]::ReadAllText($selectionPath)).Trim() -cne 'podman') { $notPodman = $true }
    } catch { $notPodman = $true }
    if ($notPodman) {
      Write-JhtUninstallLeft runtime @($runtimePath)
      Write-JhtUninstallLeft commands @($binPath, (& $leftCommands))
      return 24
    }
  }

  Write-JhtUninstallPhase uninstall_machine
  $machineState = Get-JhtPodmanMachineState -PodmanPath $PodmanPath -WslPath $WslPath -MachineName $machineName
  # Remove the logon trigger before deleting the machine, otherwise a concurrent
  # sign-in could recreate activity while uninstall is tearing the runtime down.
  # A task that cannot be removed is reported at the end and does not stop the rest: the machine, the runtime and the commands go on.
  $taskName = Get-JhtScopedStartupTaskName
  $taskLeft = $false
  $taskReason = ''
  if (-not (Remove-JhtStartupTask -TaskName $taskName)) { $taskLeft = $true; $taskReason = $script:JhtStartupTaskReason }
  $leaveForRetry = {
    param([string]$Reason)
    if ($Reason) { $script:JhtUninstallReason = $Reason }
    Write-JhtUninstallMachineLeft
    if (Test-Path -LiteralPath $runtimePath) { Write-JhtUninstallLeft runtime @($runtimePath) }
    if (@($knownCommands | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0) { Write-JhtUninstallLeft commands @($binPath, (& $leftCommands)) }
  }
  if ($machineState -eq 'present') {
    if (-not $WslPath) { & $leaveForRetry 'wsl.exe non trovato'; return 24 }
    & { $ErrorActionPreference = 'Continue'; & $WslPath --status *> $null }
    if ($LASTEXITCODE -ne 0) { & $leaveForRetry 'WSL non risponde (wsl --status)'; return 24 }
    $gone = $false
    if ($PodmanPath) {
      $removal = Invoke-JhtUninstallNative $PodmanPath @('machine', 'rm', '--force', $machineName)
      $gone = ($removal.Code -eq 0) -and
        ((Get-JhtPodmanMachineState -PodmanPath $PodmanPath -WslPath $WslPath -MachineName $machineName) -eq 'absent')
      if (-not $gone) { $script:JhtUninstallReason = "podman machine rm --force $machineName : exit $($removal.Code), $($removal.Text)" }
    } else {
      $script:JhtUninstallReason = 'podman.exe non trovato'
    }
    # Podman could not (or is not there): the distro of our machine, by its exact name, through WSL.
    if (-not $gone) { $gone = Remove-JhtPodmanMachineThroughWsl -PodmanPath $PodmanPath -WslPath $WslPath -MachineName $machineName }
    if (-not $gone) { & $leaveForRetry ''; return 24 }
  } elseif ($machineState -ne 'absent') {
    & $leaveForRetry 'lo stato della macchina non si legge (podman e wsl non rispondono)'
    return 24
  }

  # Con --purge i dati vanno PRIMA del runtime e del comando: se non si riesce, il comando jht resta e si puo' rilanciare.
  if ($purge) {
    # --purge is for a person at a console: the desktop app never asks for it and knows no phase or leftover of the data, so these
    # two are sentences only, never JHT_PHASE or JHT_LEFT lines (the app's list of the phases and the wrapper's must stay equal).
    [Console]::Out.WriteLine((Get-JhtUninstallText 'phase.data'))
    $dataFailed = @()
    foreach ($folder in @([IO.Path]::Combine([IO.Path]::GetFullPath($ProfilePath), '.jht'), [IO.Path]::Combine([IO.Path]::GetFullPath($ProfilePath), 'Documents', 'Job Hunter Team'))) {
      if (-not (Remove-JhtUserDataFolder -Path $folder)) { $dataFailed += $folder }
    }
    if ($dataFailed.Count -gt 0) {
      [Console]::Error.WriteLine((Get-JhtUninstallText 'left.data' @($script:JhtUninstallReason, ("'" + ($dataFailed -join "', '") + "'"))))
      return 24
    }
  }

  Restore-JhtWslConfigAtUninstall -RuntimePath $runtimePath -ProfilePath $ProfilePath

  Write-JhtUninstallPhase uninstall_runtime
  if (Test-Path -LiteralPath $runtimePath) {
    try { Remove-Item -LiteralPath $runtimePath -Recurse -Force -ErrorAction Stop } catch { $script:JhtUninstallReason = (Format-JhtUninstallReason $_.Exception.Message) }
  }
  $networkFolder = [IO.Path]::Combine([IO.Path]::GetFullPath($LocalAppDataPath), 'Job Hunter Team', 'podman-network')
  $networkClean = Remove-JhtPodmanNetworkFiles -LocalAppDataPath $LocalAppDataPath
  if (-not $networkClean) {
    Write-JhtUninstallLeft runtime @($networkFolder)
    if (@($knownCommands | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0) { Write-JhtUninstallLeft commands @($binPath, (& $leftCommands)) }
    return 24
  }
  if (Test-Path -LiteralPath $runtimePath) {
    Write-JhtUninstallLeft runtime @($runtimePath)
    if (@($knownCommands | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0) { Write-JhtUninstallLeft commands @($binPath, (& $leftCommands)) }
    return 24
  }

  Write-JhtUninstallPhase uninstall_commands
  $foreignCommands = @()
  if (Test-Path -LiteralPath $binPath -PathType Container) {
    $knownFullPaths = @($knownCommands | ForEach-Object { [IO.Path]::GetFullPath($_) })
    $foreignCommands = @(Get-ChildItem -LiteralPath $binPath -Force | Where-Object {
      $knownFullPaths -notcontains [IO.Path]::GetFullPath($_.FullName)
    })
  }
  $commandFailure = $false
  foreach ($path in $knownCommands | Where-Object { $_ -notlike '*\jht.ps1' }) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    try { Remove-Item -LiteralPath $path -Force -ErrorAction Stop } catch { $commandFailure = $true }
  }
  if (-not $commandFailure) {
    # Se la cartella ospita altri programmi non togliamo dal PATH la loro casa.
    # Le due variabili JHT invece appartengono sempre a questa installazione.
    if ($foreignCommands.Count -eq 0) {
      $commandFailure = -not (Remove-JhtUserEnvironment -BinPath $binPath -Target $EnvironmentTarget)
    } else {
      try {
        foreach ($name in @('JHT_CONTAINER_RUNTIME', 'JHT_PODMAN_MACHINE')) {
          [Environment]::SetEnvironmentVariable($name, $null, $EnvironmentTarget)
          if ([Environment]::GetEnvironmentVariable($name, $EnvironmentTarget)) { $commandFailure = $true }
        }
      } catch { $commandFailure = $true }
    }
  }
  $wrapperPath = Join-Path $binPath 'jht.ps1'
  if (-not $commandFailure -and (Test-Path -LiteralPath $wrapperPath)) {
    try { Remove-Item -LiteralPath $wrapperPath -Force -ErrorAction Stop } catch { $commandFailure = $true }
  }
  if ($commandFailure -or @($knownCommands | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0) {
    Write-JhtUninstallLeft commands @($binPath, (& $leftCommands))
    return 24
  }
  # The folder the installer made, once nothing is in it: never recursively, so another program's file keeps it.
  try { [IO.Directory]::Delete($binPath, $false) } catch {}
  if ($taskLeft) { [Console]::Error.WriteLine((Get-JhtUninstallText 'left.task' @($taskName, $taskReason))) }
  $done = Get-JhtUninstallText 'done'
  if (-not $purge) { $done += (Get-JhtUninstallText 'done.kept') }
  [Console]::Out.WriteLine($done)
  # What the person sees running after the uninstall and may take for ours: it is WSL's own, shared with their other machines, so it is explained, not ended.
  [Console]::Out.WriteLine((Get-JhtUninstallText 'done.wsl'))
  return 0
}

if ($args.Count -ge 1 -and $args[0] -ceq 'uninstall') {
  [string[]]$uninstallArgs = if ($args.Count -gt 1) { @($args[1..($args.Count - 1)]) } else { @() }
  $fixedProfile = [Environment]::GetFolderPath('UserProfile')
  $fixedLocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
  $podmanCommand = Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $wslCommand = Get-Command wsl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  exit (Invoke-JhtWindowsUninstall -UninstallArgs $uninstallArgs `
    -ProfilePath $fixedProfile -LocalAppDataPath $fixedLocalAppData `
    -PodmanPath $(if ($podmanCommand) { $podmanCommand.Source } else { '' }) `
    -WslPath $(if ($wslCommand) { $wslCommand.Source } else { '' }))
}

$Container   = if ($env:JHT_CONTAINER_NAME) { $env:JHT_CONTAINER_NAME } else { 'jht' }
# Broker dei segreti dei portali (P1 del 08/10): possiede l'account della posta.
$BrokerContainer = 'jht-broker'
$TelegramContainer = 'jht-telegram'
$LegacySecretNames = @('email_monitor', 'email_transport')
$BrokerVolumeNames = @('jht-secrets', 'jht-broker-state', 'jht-broker-sock')
$RuntimeMigrationVolumes = @('jht-broker-state', 'jht-secrets', 'jht-telegram-secrets', 'jht-telegram-state')
$HostResetConfirmedExit = 20
$LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
if (-not $LocalAppData) { throw 'LOCALAPPDATA non disponibile: runtime host rifiutato' }
if (-not $env:HOME) { $env:HOME = $env:USERPROFILE }
if (-not $env:HOME) { throw 'HOME/USERPROFILE non disponibile: bind mount JHT rifiutato' }
$RuntimeDir  = if ($env:JHT_RUNTIME_DIR) { $env:JHT_RUNTIME_DIR } else { Join-Path $LocalAppData 'Job Hunter Team\host-runtime' }
$ComposeFile = if ($env:JHT_COMPOSE_FILE)   { $env:JHT_COMPOSE_FILE }   else { Join-Path $RuntimeDir 'docker-compose.yml' }
$WrapperPath = if ($env:JHT_WRAPPER_PATH)   { $env:JHT_WRAPPER_PATH }   else { $PSCommandPath }
$RuntimeSelectionFile = Join-Path $RuntimeDir 'container-runtime'
$RuntimeMigrationMarker = Join-Path $RuntimeDir '.runtime-migrated-podman'
$PodmanMachineFile = Join-Path $RuntimeDir 'podman-machine'
# The engine of THIS runtime is the one its attested bundle names (the container-runtime file). No environment variable the person
# can have left behind (an older terminal's, a program's) chooses it; only a test names another one, with its own variable.
$ContainerRuntime = if ($env:JHT_TEST_CONTAINER_RUNTIME) {
  $env:JHT_TEST_CONTAINER_RUNTIME.Trim().ToLowerInvariant()
} elseif (Test-Path -LiteralPath $RuntimeSelectionFile -PathType Leaf) {
  ([IO.File]::ReadAllText($RuntimeSelectionFile)).Trim().ToLowerInvariant()
} else { 'docker' }
Remove-Item -LiteralPath Env:JHT_CONTAINER_RUNTIME -ErrorAction SilentlyContinue
if ($ContainerRuntime -notin @('docker', 'podman')) { throw "runtime container non supportato: $ContainerRuntime" }
$PodmanComposeFile = Join-Path $RuntimeDir 'docker-compose.podman.yml'
$ContainerUnitFile = Join-Path $RuntimeDir 'jht-container.service'
$RuntimeShimDir = Join-Path $RuntimeDir 'bin'
$DockerShim = Join-Path $RuntimeShimDir 'docker.exe'
$MigrationDockerCommand = if ($env:JHT_MIGRATION_DOCKER) {
  $env:JHT_MIGRATION_DOCKER
} else {
  $candidate = Get-Command docker.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($candidate) { $candidate.Source } else { '' }
}
$MigrationPodmanCommand = if ($env:JHT_MIGRATION_PODMAN) {
  $env:JHT_MIGRATION_PODMAN
} else {
  $candidate = Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($candidate) { $candidate.Source } else { '' }
}
if ($ContainerRuntime -eq 'podman') {
  # Compose otherwise derives the project from the protected runtime directory
  # ("host-runtime"), while development runs derive it from the checkout. A
  # stable project name makes an installed container manageable after migration.
  $env:COMPOSE_PROJECT_NAME = 'jht'
  # docker.exe is private to this wrapper. Only this process sees it before
  # the user's PATH; other applications keep resolving their real Docker CLI.
  $env:PATH = "$RuntimeShimDir$([IO.Path]::PathSeparator)$env:PATH"
  # The machine of THIS runtime is the one its attested bundle names (the podman-machine file). No environment variable can name
  # another: one a terminal opened before an update still carries, or that any program set, would start a machine that is not
  # the team's and leave the team's own unreachable.
  $env:CONTAINER_CONNECTION = if (Test-Path -LiteralPath $PodmanMachineFile -PathType Leaf) {
    ([IO.File]::ReadAllText($PodmanMachineFile)).Trim()
  } else { 'jht-podman' }
  if ($env:CONTAINER_CONNECTION -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$') { throw 'podman-machine does not name a Podman machine' }
  Remove-Item -LiteralPath Env:JHT_PODMAN_MACHINE -ErrorAction SilentlyContinue
  $env:JHT_PODMAN_HTTP_PROXY = if ($env:JHT_PODMAN_HTTP_PROXY) { $env:JHT_PODMAN_HTTP_PROXY } else { 'http://127.0.0.1:3128' }
  $env:JHT_PODMAN_HTTPS_PROXY = if ($env:JHT_PODMAN_HTTPS_PROXY) { $env:JHT_PODMAN_HTTPS_PROXY } else { 'http://127.0.0.1:3128' }
  # The runtime's own docker-compose.exe (5.1.2, checked by the enabler),
  # never one from PATH: Docker Desktop ships another version.
  $env:PODMAN_COMPOSE_PROVIDER = Join-Path $RuntimeShimDir 'docker-compose.exe'
  $env:PODMAN_COMPOSE_WARNING_LOGS = 'false'
}
$RuntimeManifest = Join-Path $RuntimeDir '.runtime-integrity'
$RuntimeImageFile = Join-Path $RuntimeDir 'runtime-image'
$RuntimeTierFile = Join-Path $RuntimeDir 'runtime-tier'
$RuntimeTierIntegrity = Join-Path $RuntimeDir '.runtime-tier-integrity'
# The test channel also pins the image of the tools that come on request (screen, media, playwright), which the installer does not pull:
# `jht screen on` pulls it by this digest. Its own file, attested in its own file (the app compares the exact keys of the main manifest).
$RuntimeExtrasFile = Join-Path $RuntimeDir 'runtime-extras-image'
$RuntimeExtrasIntegrity = Join-Path $RuntimeDir '.runtime-extras-integrity'
$BrokerLegacyMarker = Join-Path $RuntimeDir '.broker-legacy-migrated'
$BrokerMadeMarker = Join-Path $RuntimeDir '.broker-made'
$NodeEntry   = if ($env:JHT_NODE_ENTRY)     { $env:JHT_NODE_ENTRY }     else { '/app/cli/bin/jht.js' }
$RawBaseOverride = if ($env:JHT_RAW_BASE) { $env:JHT_RAW_BASE.TrimEnd('/') } else { '' }
$ReleaseRef = if ($env:JHT_BRANCH) { $env:JHT_BRANCH } else { 'production' }
$DefaultRuntimeImage = 'ghcr.io/leopu00/jht@sha256:8db1633af3c6e7d606b058225023988f86687d86c8eab3cbe2c47c57ff8190e7'
$CoreImageDigest = 'sha256:b962a32665e6ed8c81b378a453d596417cf03333cded7087f2ea50587126b24b'
$ExtrasImageDigest = 'sha256:f4e90cb05a03b01ce7158b0928dcf7d1d5915f4e3492c0f5ea0f440ddd7ff50a'
$DefaultRuntimeVersion = '0.4.0'
$WindowsInstanceGuardSha256 = 'bb90ae8f9f1f0cff7d41ceedc3eec380f18b78d7b4f4b07921606afda8b8054b'
$JhtHome = if ($env:JHT_HOME_HOST) { $env:JHT_HOME_HOST } else { Join-Path $env:USERPROFILE '.jht' }
$AclHelperPath = Join-Path $PSScriptRoot 'windows-private-acl.ps1'
$PodmanMachineBridgePath = Join-Path (Split-Path -Parent $WrapperPath) 'podman-machine-bridge.ps1'
. $AclHelperPath

# Carica la host env (scritta da install.ps1 / setup wizard: JHT_HOST_TYPE=local|vps).
# Formato file: VAR=value per riga, ignora # e righe vuote.
$HostEnvFile = if ($env:JHT_HOST_ENV_FILE) { $env:JHT_HOST_ENV_FILE } else { Join-Path $env:USERPROFILE '.jht\host.env' }
$AllowedHostEnvNames = @('JHT_HOST_TYPE', 'JHT_LANG', 'JHT_USER_TZ')
# host.env lo possono scrivere gli agenti: un valore finisce in `-e "JHT_HOST_TYPE=..."` di docker exec, e in Windows
# PowerShell 5.1 le virgolette dentro un argomento nativo diventano argomenti in piu'. Stesso dominio del wrapper .sh
# (jht_host_env_value_valid): tipo local|vps, le 7 lingue, il fuso con i caratteri di un nome IANA. Fuori dominio = ignorato.
function Test-HostEnvValue {
  param([string]$Name, [string]$Value)
  switch -CaseSensitive ($Name.ToUpperInvariant()) {
    'JHT_HOST_TYPE' { return ($Value -ceq 'local' -or $Value -ceq 'vps') }
    'JHT_LANG'      { return ($Value -cmatch '^(en|it|hu|es|de|fr|pt)\z') }
    'JHT_USER_TZ'   { return ($Value -cmatch '^[A-Za-z0-9_+./-]+\z') }
  }
  return $false
}
if (Test-Path $HostEnvFile) {
  Get-Content $HostEnvFile | ForEach-Object {
    if ($_ -match '^\s*#') { return }
    if ($_ -match '^\s*$') { return }
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') {
      $name  = $Matches[1]
      $value = $Matches[2].Trim('"').Trim("'")
      if ($AllowedHostEnvNames -notcontains $name) { return }
      if (-not (Test-HostEnvValue -Name $name -Value $value)) { return }
      if ($name -ceq 'JHT_LANG') { $script:JhtHostEnvLang = $value }
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

# T220: declared host bridge to move into the T214 Rust sidecar. No data logic.
# Explicit rule-2 exception: <=60 added lines, no installer/manifest dependency.
function Open-JhtMonitorWindow {
  param([string]$CommandPath, [string[]]$WindowArgs)
  if ($WindowArgs.Count -ne 1 -or $WindowArgs[0] -cne '--window') {
    Write-Err "monitor_window_invalid: use 'jht monitor --window' without other options."
    return 2
  }
  $process = $null
  try {
    if ($CommandPath -match '["\x00-\x1f]') { throw 'unsupported command path' }
    if (-not (Test-Path -LiteralPath $CommandPath -PathType Leaf)) { throw 'command is unavailable' }
    if ([Environment]::OSVersion.Platform -eq 'Win32NT' -and [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) { throw 'no interactive desktop' }
    $shell = Get-Command pwsh.exe, powershell.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $shell) { throw 'PowerShell is unavailable' }
    # Same process-only policy as the installed jht.cmd, never a policy change.
    $arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $CommandPath + '" monitor'
    $terminal = Get-Command wt.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $executable = $shell.Source
    # Avoid WT separators/environment expansion; PowerShell -File accepts these paths literally.
    if ($terminal -and ($CommandPath + $shell.Source) -notmatch '[;%]') {
      $executable = $terminal.Source
      $arguments = '-w new new-tab --title "JHT monitor" "' + $shell.Source + '" ' + $arguments
    }
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -PassThru -ErrorAction Stop
    # Bounded launch check, not a claim that the GUI or its monitor is ready.
    if ($process.WaitForExit(250) -and $process.ExitCode -ne 0) { throw 'terminal launch failed' }
    return 0
  } catch {
    Write-Err "monitor_window_unavailable: cannot open a terminal window here. Run 'jht monitor' in the current terminal."
    return 1
  } finally { if ($process) { $process.Dispose() } }
}

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

# What this wrapper (or a helper it loads) makes in the runtime and checks again with Test-ProtectedRuntimeNode must be the person's. From an
# ELEVATED process what is made is owned by the group Administrators, and the check, which is NOT relaxed, would refuse it: the folder of the
# integration markers (`jht screen on`), the helpers and their manifest, the manifest of the runtime, the files an upgrade replaces and the
# journal and the snapshots of its rollback. So the node is given to the person right after it is made, the way the installer does (Set-JhtNodeOwner).
# Only a node the person already owns is left as it is (nothing is written), and only one owned by Administrators (what an elevated run
# leaves, also from an earlier run) is taken: a node of anybody else stays what it is, and the check refuses it. A link is never touched, no
# ACL is rewritten (only the owner, through SetAccessControl: Set-Acl would write the SACL too, which only an elevated process may). $true when
# the node is the person's after the call. Off Windows there is no such owner.
function Set-ProtectedRuntimeNodeOwner {
  param([string]$Path)
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { return $true }
  try {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    $person = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    $owner = ([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier])
    if ($owner.Value -eq $person.Value) { return $true }
    if ($owner.Value -ne 'S-1-5-32-544') { return $false }
    $acl.SetOwner($person)
    if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::SetAccessControl($item, $acl) } else { $item.SetAccessControl($acl) }
    $after = ([Security.Principal.NTAccount](Get-Acl -LiteralPath $Path -ErrorAction Stop).Owner).Translate([Security.Principal.SecurityIdentifier])
    return ($after.Value -eq $person.Value)
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
      # What gives a right to CHANGE the folder (the same set as the desktop app's check): write data or add a file (0x2), append
      # or add a folder (0x4), write extended attributes (0x10), delete what is in it (0x40), write attributes (0x100), delete it
      # (0x10000), change its permissions (0x40000), take its ownership (0x80000), and the generic write (0x40000000) and all
      # (0x10000000) bits. Reading, listing and running are not.
      $changes = ([int]$rule.FileSystemRights) -band 0x500D0156
      if (-not $changes) { continue }
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

# Host helpers: scripts of the runtime (scripts/<name>) attested like the wrapper, in a manifest of their own (.runtime-helpers,
# `<name>=<sha256>`): the desktop app checks the main manifest key by key and must not meet a key it does not know. A helper is
# dot-sourced only while the file still matches its line there. A runtime that has none yet gets it from the release origin the
# first time it is needed (the `integration` command) and at the end of every upgrade.
$RuntimeHelpers = @('jht-integration.ps1', 'jht-tools.ps1', 'configure-podman-windows-network.ps1', 'wsl-interop-connect-proxy.py')
$RuntimeHelpersManifest = Join-Path $RuntimeDir '.runtime-helpers'

function Get-RuntimeHelperHash {
  param([string]$Name)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RuntimeDir $Name)).Hash.ToLowerInvariant()
}

# name -> digest, as the helpers manifest declares them; $null when there is none or it is not the person's own file.
function Read-RuntimeHelpersManifest {
  if (-not (Test-Path -LiteralPath $RuntimeHelpersManifest -PathType Leaf)) { return @{} }
  if (-not (Test-ProtectedRuntimeNode $RuntimeHelpersManifest)) { return $null }
  $values = @{}
  foreach ($line in @(Get-Content -LiteralPath $RuntimeHelpersManifest)) {
    if ($line -match '^([a-z0-9][a-z0-9.\-]*)=([0-9a-f]{64})$') { $values[$Matches[1]] = $Matches[2] } else { return $null }
  }
  return $values
}

function Write-RuntimeHelpersManifest {
  $content = ''
  foreach ($name in $RuntimeHelpers) {
    if (Test-Path -LiteralPath (Join-Path $RuntimeDir $name) -PathType Leaf) { $content += "$name=$(Get-RuntimeHelperHash $name)`n" }
  }
  Publish-JhtFile -Destination $RuntimeHelpersManifest -Bytes ([Text.UTF8Encoding]::new($false).GetBytes($content))
  if (-not (Set-ProtectedRuntimeNodeOwner $RuntimeHelpersManifest)) { throw 'the helpers manifest cannot be given to the person' }
}

# $true when every helper the helpers manifest lists is the file it was written for; one it does not list is not loaded.
function Test-RuntimeHelpersTrusted {
  $values = Read-RuntimeHelpersManifest
  if ($null -eq $values) { return $false }
  foreach ($name in $RuntimeHelpers) {
    if (-not $values.ContainsKey($name)) { continue }
    if (-not (Test-ProtectedRuntimeNode (Join-Path $RuntimeDir $name))) { return $false }
    if ($values[$name] -ne (Get-RuntimeHelperHash $name)) { return $false }
  }
  return $true
}

# The helpers manifest lists it (a file that is only there is not a helper).
function Test-RuntimeHelperDeclared {
  param([string]$Name)
  $values = Read-RuntimeHelpersManifest
  return ($null -ne $values -and $values.ContainsKey($Name))
}

# Before the helper is there (an install whose first download of the tools has not happened yet) the read-only commands that the app
# reads answer "not installed yet", in the shape the helper uses, instead of failing: `jht tools status --json` and
# `jht integration list|status [id] [--json]`. $What is tools|integration, $Words what the person typed after it. $false for anything
# else (add, remove, a wrong use): the caller goes on to the helper and its error.
$IntegrationIdsAbsent = @('google', 'telegram', 'mail', 'linkedin-login', 'screen', 'media')
function Write-RuntimeHelperAbsentAnswer {
  param([string]$What, [string[]]$Words)
  $Words = @($Words)
  $word = if ($Words.Count -gt 0) { [string]$Words[0] } else { '' }
  $json = $false; $id = ''
  foreach ($arg in @($Words | Select-Object -Skip 1)) {
    if ([string]$arg -ceq '--json') { $json = $true }
    elseif ([string]$arg -like '-*' -or $id) { return $false }
    else { $id = [string]$arg }
  }
  if ($What -ceq 'tools') {
    if ($word -cne 'status' -or -not $json -or $id) { return $false }
    [Console]::Out.WriteLine('{"ok":true,"state":"none","tier":"full","reason":"not_installed"}')
    return $true
  }
  if (@('list', 'status') -cnotcontains $word -or ($word -ceq 'list' -and $id)) { return $false }
  if ($id -and ($IntegrationIdsAbsent -cnotcontains $id)) { return $false }
  $ids = if ($id) { @($id) } else { $IntegrationIdsAbsent }
  $rows = @(foreach ($one in $ids) { '{"id":"' + $one + '","state":"not_installed","reason":"non ancora installato"}' })
  if ($json -and $id) { [Console]::Out.WriteLine($rows[0]); return $true }
  if ($json) { [Console]::Out.WriteLine('{"integrations":[' + ($rows -join ',') + ']}'); return $true }
  foreach ($one in $ids) { [Console]::Out.WriteLine(('{0,-15} {1,-16} {2}' -f $one, 'non installato', 'non ancora installato')) }
  # In words, the person is told which command installs them (the lines above stay the shape the helper gives).
  [Console]::Error.WriteLine("per installarli: 'jht upgrade' (o un 'jht integration add <id>')")
  return $true
}

function Install-RuntimeHelpers {
  try {
    Assert-TrustedRuntime
    $base = Get-AttestedRawBase
    foreach ($name in $RuntimeHelpers) {
      $temp = Join-Path $RuntimeDir (".helper-$PID-" + [guid]::NewGuid().ToString('N'))
      try {
        Invoke-WebRequest -UseBasicParsing -Uri "$base/scripts/$name" -OutFile $temp
        $text = [IO.File]::ReadAllText($temp)
        if ($name -like '*.ps1') { [scriptblock]::Create($text) | Out-Null }
        if ($text -notmatch '(?m)^# JHT_RUNTIME_HELPER=1\r?$') { throw "$name lacks the helper marker" }
        Publish-JhtFile -Destination (Join-Path $RuntimeDir $name) -Bytes ([IO.File]::ReadAllBytes($temp))
        if (-not (Set-ProtectedRuntimeNodeOwner (Join-Path $RuntimeDir $name))) { throw "$name cannot be given to the person" }
      } finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
    }
    Write-RuntimeHelpersManifest
    return $true
  } catch { return $false }
}

function Write-RuntimeManifest {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ComposeFile).Hash.ToLowerInvariant()
  $wrapperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $WrapperPath).Hash.ToLowerInvariant()
  $helperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $AclHelperPath).Hash.ToLowerInvariant()
  $temp = "$RuntimeManifest.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
  $content = "version=1`ndocker-compose.yml=$hash`njht-wrapper.ps1=$wrapperHash`nwindows-private-acl.ps1=$helperHash`n"
  if ($ContainerRuntime -eq 'podman') {
    $podmanHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PodmanComposeFile).Hash.ToLowerInvariant()
    $bridgeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PodmanMachineBridgePath).Hash.ToLowerInvariant()
    $shimHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $DockerShim).Hash.ToLowerInvariant()
    $content += "docker-compose.podman.yml=$podmanHash`ndocker.exe=$shimHash`n"
    $selectionHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RuntimeSelectionFile).Hash.ToLowerInvariant()
    $machineHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PodmanMachineFile).Hash.ToLowerInvariant()
    $containerUnitHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ContainerUnitFile).Hash.ToLowerInvariant()
    $content += "container-runtime=$selectionHash`npodman-machine=$machineHash`njht-container.service=$containerUnitHash`npodman-machine-bridge.ps1=$bridgeHash`n"
  }
  if (Test-Path -LiteralPath $RuntimeImageFile -PathType Leaf) {
    $runtimeImageHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RuntimeImageFile).Hash.ToLowerInvariant()
    $content += "runtime-image=$runtimeImageHash`n"
  }
  [IO.File]::WriteAllText($temp, $content, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temp -Destination $RuntimeManifest -Force
  if (-not (Set-ProtectedRuntimeNodeOwner $RuntimeManifest)) { throw 'the integrity manifest of the runtime cannot be given to the person' }
}

# The pin of the image of the tools on request (test channel): both files regular and of the owner, attested, canonical, and only next
# to the pin of the test channel. Anything else is not trusted (never a fall back to the constant of the release). A good pin becomes
# the digest the integration helper uses.
function Test-RuntimeExtrasPin {
  param([bool]$PinPresent)
  if (-not ((Test-Path -LiteralPath $RuntimeExtrasFile) -or (Test-Path -LiteralPath $RuntimeExtrasIntegrity))) { return $true }
  if (-not $PinPresent) { return $false }
  # both there: the integrity of a pin that is gone (or a pin without its integrity) is a runtime somebody changed
  if (-not ((Test-Path -LiteralPath $RuntimeExtrasFile -PathType Leaf) -and (Test-Path -LiteralPath $RuntimeExtrasIntegrity -PathType Leaf))) { return $false }
  if (-not (Test-ProtectedRuntimeNode $RuntimeExtrasFile)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $RuntimeExtrasIntegrity)) { return $false }
  $extrasBytes = [IO.File]::ReadAllText($RuntimeExtrasFile)
  $extrasRef = $extrasBytes.TrimEnd("`n")
  if (([IO.File]::ReadAllText($RuntimeExtrasIntegrity).Trim()) -ne "runtime-extras-image=$((Get-FileHash -Algorithm SHA256 -LiteralPath $RuntimeExtrasFile).Hash.ToLowerInvariant())") { return $false }
  $extrasMatch = [regex]::Match($extrasRef, '^ghcr\.io/leopu00/jht@(sha256:[0-9a-f]{64})\z')
  if (-not $extrasMatch.Success -or $extrasBytes -cne "$extrasRef`n") { return $false }
  $script:ExtrasImageDigest = $extrasMatch.Groups[1].Value
  return $true
}

function Test-RuntimeBundleTrusted {
  $script:TrustedRuntimeImage = $null
  if (-not (Test-RuntimePathAuthority)) { return $false }
  if (-not (Test-RuntimeAncestorsWithoutReparsePoint $RuntimeDir)) { return $false }
  if (-not (Test-RuntimeAncestorsWithoutReparsePoint $WrapperPath)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $RuntimeDir -Directory)) { return $false }
  if (-not (Test-RuntimeDirectoryAcl)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $ComposeFile)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $RuntimeManifest)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $WrapperPath)) { return $false }
  if (-not (Test-ProtectedRuntimeNode $AclHelperPath)) { return $false }
  try {
    $values = ConvertFrom-StringData (Get-Content -LiteralPath $RuntimeManifest -Raw)
    if ($values.version -ne '1') { return $false }
    $expectedKeys = @('version', 'docker-compose.yml', 'jht-wrapper.ps1', 'windows-private-acl.ps1')
    if ($ContainerRuntime -eq 'podman') {
      $expectedKeys += @('docker-compose.podman.yml', 'docker.exe', 'container-runtime', 'podman-machine', 'jht-container.service', 'podman-machine-bridge.ps1')
    }
    $pinPresent = Test-Path -LiteralPath $RuntimeImageFile -PathType Leaf
    if ($pinPresent) { $expectedKeys += 'runtime-image' }
    # runtime-tier: written by the installer when the release has a core image, and attested in a file of its own
    # (.runtime-tier-integrity), not here: the app compares the exact set of keys of this manifest. An integrity file without a tier
    # file is a `tools switch` cut in half: the runtime is the whole image.
    $tierPresent = Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf
    if ($values.Count -ne $expectedKeys.Count -or @($values.Keys | Where-Object { $_ -notin $expectedKeys }).Count -ne 0) { return $false }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $ComposeFile).Hash.ToLowerInvariant()
    $wrapperActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $WrapperPath).Hash.ToLowerInvariant()
    $helperActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $AclHelperPath).Hash.ToLowerInvariant()
    if ($values.'docker-compose.yml' -ne $actual -or $values.'jht-wrapper.ps1' -ne $wrapperActual -or $values.'windows-private-acl.ps1' -ne $helperActual) { return $false }
    $pinDeclared = $values.ContainsKey('runtime-image')
    if ($pinDeclared -ne $pinPresent) { return $false }
    if (-not (Test-RuntimeHelpersTrusted)) { return $false }
    if ($pinDeclared) {
      if (-not (Test-ProtectedRuntimeNode $RuntimeImageFile)) { return $false }
      $pinHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RuntimeImageFile).Hash.ToLowerInvariant()
      $pinBytes = [IO.File]::ReadAllText($RuntimeImageFile)
      $pin = $pinBytes.TrimEnd("`n")
      if ($values.'runtime-image' -ne $pinHash -or $pin -notmatch '^ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}$' -or $pinBytes -ne "$pin`n") { return $false }
      $script:TrustedRuntimeImage = $pin
    }
    if ($tierPresent) {
      if (-not (Test-ProtectedRuntimeNode $RuntimeTierFile)) { return $false }
      if ($pinPresent -or -not $CoreImageDigest) { return $false }
      if (-not (Test-ProtectedRuntimeNode $RuntimeTierIntegrity)) { return $false }
      if (([IO.File]::ReadAllText($RuntimeTierIntegrity).Trim()) -ne "runtime-tier=$((Get-FileHash -Algorithm SHA256 -LiteralPath $RuntimeTierFile).Hash.ToLowerInvariant())") { return $false }
      if ([IO.File]::ReadAllText($RuntimeTierFile).TrimEnd("`r", "`n") -ne 'core') { return $false }
      $script:TrustedRuntimeImage = "ghcr.io/leopu00/jht@$CoreImageDigest"
    }
    if (-not (Test-RuntimeExtrasPin -PinPresent $pinPresent)) { return $false }
    if ($ContainerRuntime -eq 'podman') {
      if (-not (Test-ProtectedRuntimeNode $PodmanMachineBridgePath)) { return $false }
      if (-not (Test-ProtectedRuntimeNode $RuntimeSelectionFile)) { return $false }
      if (-not (Test-ProtectedRuntimeNode $PodmanMachineFile)) { return $false }
      if (-not (Test-ProtectedRuntimeNode $PodmanComposeFile)) { return $false }
      if (-not (Test-ProtectedRuntimeNode $ContainerUnitFile)) { return $false }
      if (-not (Test-ProtectedRuntimeNode $DockerShim)) { return $false }
      $podmanActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $PodmanComposeFile).Hash.ToLowerInvariant()
      $shimActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $DockerShim).Hash.ToLowerInvariant()
      $selectionActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $RuntimeSelectionFile).Hash.ToLowerInvariant()
      $machineActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $PodmanMachineFile).Hash.ToLowerInvariant()
      $containerUnitActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $ContainerUnitFile).Hash.ToLowerInvariant()
      if ($values.'podman-machine-bridge.ps1' -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $PodmanMachineBridgePath).Hash.ToLowerInvariant()) { return $false }
      if ($values.'docker-compose.podman.yml' -ne $podmanActual -or $values.'docker.exe' -ne $shimActual -or $values.'container-runtime' -ne $selectionActual -or $values.'podman-machine' -ne $machineActual -or $values.'jht-container.service' -ne $containerUnitActual) { return $false }
      if (-not (Select-String -LiteralPath $PodmanComposeFile -SimpleMatch 'network_mode: "pasta:--no-udp,--no-icmp,--no-map-gw,-4,-o,127.0.0.1,-T,3128"' -Quiet)) { return $false }
      if (-not (Select-String -LiteralPath $PodmanComposeFile -SimpleMatch 'network_mode: "pasta:--no-udp,--no-icmp,--no-map-gw,-4,-o,127.0.0.1,-T,3129"' -Quiet)) { return $false }
      if (-not (Select-String -LiteralPath $PodmanComposeFile -SimpleMatch 'network_mode: "pasta:--no-udp,--no-icmp,--no-map-gw,-4,-o,127.0.0.1,-T,3130"' -Quiet)) { return $false }
      if (-not (Select-String -LiteralPath $PodmanComposeFile -SimpleMatch 'keep-id:uid=1001,gid=1001' -Quiet)) { return $false }
    }
    if (-not (Select-String -LiteralPath $WrapperPath -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) { return $false }
    if (-not (Select-String -LiteralPath $ComposeFile -Pattern '^\s*-\s*jht-runtime-mask:/jht_home/runtime(?:\s|$)' -Quiet)) { return $false }
    if ($script:TrustedRuntimeImage) { $env:JHT_IMAGE = $script:TrustedRuntimeImage }
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
    if (-not (Set-ProtectedRuntimeNodeOwner $RuntimeDir)) { throw 'the runtime folder cannot be given to the person' }
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
    if (-not (Set-ProtectedRuntimeNodeOwner $ComposeFile)) { throw 'the compose file cannot be given to the person' }
    if (-not (Select-String -LiteralPath $WrapperPath -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) {
      if ($env:JHT_ALLOW_LEGACY_WRAPPER_MIGRATION -ne '1') { throw 'legacy wrapper migration is not authorized' }
      $wrapperTemp = Join-Path (Split-Path -LiteralPath $WrapperPath -Parent) ('.jht-wrapper-' + [guid]::NewGuid().ToString('N') + '.ps1')
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/scripts/jht-wrapper.ps1" -OutFile $wrapperTemp
      [scriptblock]::Create((Get-Content -LiteralPath $wrapperTemp -Raw)) | Out-Null
      if (-not (Select-String -LiteralPath $wrapperTemp -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) { throw 'release wrapper lacks protected runtime protocol' }
      Move-Item -LiteralPath $wrapperTemp -Destination $WrapperPath -Force
      if (-not (Set-ProtectedRuntimeNodeOwner $WrapperPath)) { throw 'the wrapper cannot be given to the person' }
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
  if (-not (Test-RuntimeBundleTrusted)) {
    # A manifest that is not there at all is an install that never finished, not a file somebody changed: said as what it is.
    if (-not (Test-Path -LiteralPath $RuntimeManifest)) {
      throw "Job Hunter Team non e' installato del tutto: nella cartella del runtime manca il file di integrita (un'installazione interrotta?). Rilancia l'installer."
    }
    throw 'untrusted host runtime path, owner, reparse point or SHA-256'
  }
}

# Deterministic, side-effect-free seam for the Windows security regression.
# It exits before Docker, network, manifests or filesystem mutation.
if ($env:JHT_RUNTIME_AUTHORITY_SELFTEST -eq '1') {
  if (Test-RuntimePathAuthority) { exit 0 }
  exit 1
}

# ── Verifiche pre-flight ──────────────────────────────────────────────────
# Why the private home is refused: a folder that is not there yet is a team that was never installed (the ACL of a folder that does not
# exist cannot be read, and «ACL is not owner-only» sent the person to look at permissions); only a folder that is there is an ACL.
function Get-JhtHomeAclFailure {
  if (-not (Test-Path -LiteralPath $JhtHome)) {
    return "Job Hunter Team non e' ancora installato: la cartella $JhtHome non esiste. Lancia l'installer, poi 'jht setup'."
  }
  return "JHT_HOME ACL is not owner-only: $JhtHome"
}

function Require-PrivateJhtHomeAcl {
  if (-not (Test-PrivateJhtHomeAcl -Path $JhtHome)) {
    throw (Get-JhtHomeAclFailure)
  }
}

function Require-Docker {
  Require-PrivateJhtHomeAcl
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err "client Podman JHT non trovato nel PATH. Reinstalla il runtime locale."
    exit 127
  }
  $null = & { $ErrorActionPreference = 'Continue'; & docker info 2>&1 }
  if ($LASTEXITCODE -ne 0) {
    Write-Err "La macchina Podman JHT non risponde. Esegui 'jht up'."
    exit 1
  }
}

# Solo l'azione esplicita `up` può risvegliare la machine. Status, snapshot e
# desktop-chat restano osservativi e non tengono in vita WSL quando l'utente
# non ha chiesto di avviare il team.
function Start-PodmanMachineForUp {
  if ($ContainerRuntime -ne 'podman') { return }
  Assert-TrustedRuntime
  . $PodmanMachineBridgePath
  Start-JhtPodmanMachineForUp -Runtime $ContainerRuntime -Connection $env:CONTAINER_CONNECTION
}

function Require-ComposeFile {
  Require-PrivateJhtHomeAcl
  try { Assert-TrustedRuntime } catch { Write-Err $_.Exception.Message; exit 1 }
}

# Runs a pipeline whose input goes to a native command, with the stdin of that command free of a byte order mark.
# Windows PowerShell 5.1 can put EF BB BF in front of what it pipes to a native program: with a console in UTF-8 (code page 65001: a console
# inherited from pwsh 7, a UTF-8 system code page) it does so whatever $OutputEncoding is, because it writes the preamble of the console's
# input encoding (measured on windows-2022); with a $OutputEncoding that carries a BOM (a profile that sets it) it writes that one too.
# A password, a token or a key with a BOM in front is a wrong secret. Both encodings are set to UTF-8 WITHOUT a BOM for the call and put
# back after it (the console one only if it could be read: with no console, the $OutputEncoding half still holds). What the pipeline
# writes goes out as it does, and $LASTEXITCODE is the one of its native command. The pipeline is a script block; it sees the variables
# of its caller.
function Invoke-NativeWithStdin {
  param([Parameter(Mandatory)][scriptblock]$Pipeline)
  $nativeStdinOutputEncoding = $OutputEncoding
  $nativeStdinConsoleEncoding = $null
  $OutputEncoding = [Text.UTF8Encoding]::new($false)
  try { $nativeStdinConsoleEncoding = [Console]::InputEncoding; [Console]::InputEncoding = [Text.UTF8Encoding]::new($false) } catch { $nativeStdinConsoleEncoding = $null }
  try {
    & $Pipeline
  } finally {
    $OutputEncoding = $nativeStdinOutputEncoding
    if ($nativeStdinConsoleEncoding) { try { [Console]::InputEncoding = $nativeStdinConsoleEncoding } catch { $null = $_ } }
  }
}

function Invoke-Compose {
  [CmdletBinding(PositionalBinding=$false)]
  param([switch]$NoInput, [string]$InputText, [Parameter(ValueFromRemainingArguments)] $Args)
  if (-not (Test-PrivateJhtHomeAcl -Path $JhtHome)) { throw (Get-JhtHomeAclFailure) }
  Assert-TrustedRuntime
  # Docker Desktop Windows accetta forward-slash o backslash. project-directory
  # punta al runtime dir per bind-mount relativi (anche se compose qui e'
  # image-only, lasciamo per simmetria col bash wrapper).
  $files = @('-f', $ComposeFile)
  if ($ContainerRuntime -eq 'podman') { $files += @('-f', $PodmanComposeFile) }
  # $Args is the script block's own inside Invoke-NativeWithStdin: the arguments go in a variable of theirs.
  $composeArgs = @($Args)
  if ($PSBoundParameters.ContainsKey('InputText')) { Invoke-NativeWithStdin { $InputText | & docker compose @files --project-directory $RuntimeDir @composeArgs } }
  elseif ($NoInput) { Invoke-NativeWithStdin { $null | & docker compose @files --project-directory $RuntimeDir @composeArgs } }
  else { & docker compose @files --project-directory $RuntimeDir @Args }
}

# `jht up` and `jht down` say the phase and the result: compose's own lines (Network, Volume, Container Creating, Created, Started...) are
# kept out of sight when all went well, and shown, whole, when it did not. With --verbose (or JHT_VERBOSE=1) they come as they are.
# Returns the exit code of compose.
function Invoke-ComposeQuiet {
  [CmdletBinding(PositionalBinding=$false)]
  param([Parameter(ValueFromRemainingArguments)] $ComposeArgs)
  if ($script:JhtComposeVerbose) {
    Invoke-Compose @ComposeArgs | Out-Host
    return $LASTEXITCODE
  }
  $lines = & { $ErrorActionPreference = 'Continue'; Invoke-Compose @ComposeArgs 2>&1 | ForEach-Object { [string]$_ } }
  $code = $LASTEXITCODE
  if ($code -ne 0) { foreach ($line in @($lines)) { [Console]::Error.WriteLine($line) } }
  return $code
}

# A compose `run` whose stdout is an answer (the Telegram lifecycle's plan, its check): the answer comes back as it is, and compose's
# own lines on stderr (Volume, Container ...-run-... Creating, Created) stay out of sight when it went well and are shown, whole, on
# stderr when it did not. $LASTEXITCODE is compose's. With --verbose (or JHT_VERBOSE=1) they come as they are.
function Invoke-ComposeAnswer {
  [CmdletBinding(PositionalBinding=$false)]
  param([string]$InputText, [Parameter(ValueFromRemainingArguments)] $ComposeArgs)
  $withInput = $PSBoundParameters.ContainsKey('InputText')
  if ($script:JhtComposeVerbose) {
    if ($withInput) { Invoke-Compose -InputText $InputText @ComposeArgs } else { Invoke-Compose -NoInput @ComposeArgs }
    return
  }
  $lines = @(& {
    $ErrorActionPreference = 'Continue'
    if ($withInput) { Invoke-Compose -InputText $InputText @ComposeArgs 2>&1 } else { Invoke-Compose -NoInput @ComposeArgs 2>&1 }
  })
  $code = $LASTEXITCODE
  $said = @($lines | Where-Object { $_ -is [Management.Automation.ErrorRecord] } | ForEach-Object { [string]$_ })
  if ($code -ne 0) { foreach ($line in $said) { [Console]::Error.WriteLine($line) } }
  $lines | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] } | ForEach-Object { [string]$_ }
  $global:LASTEXITCODE = $code
}

function Write-JhtLifecycleDone {
  param([Parameter(Mandatory)][ValidateSet('up', 'down', 'restart')][string]$What)
  $english = ((Get-JhtTextLanguage) -ceq 'en')
  $text = if ($What -ceq 'up') { if ($english) { 'Job Hunter Team started.' } else { 'Job Hunter Team avviato.' } }
          elseif ($What -ceq 'restart') { if ($english) { 'Job Hunter Team restarted.' } else { 'Job Hunter Team riavviato.' } }
          else { if ($english) { 'Job Hunter Team stopped.' } else { 'Job Hunter Team fermato.' } }
  [Console]::Out.WriteLine($text)
}

# `jht down` asked by the person: while this file is there, no command but `jht up`, `jht start-container` and `jht setup` makes or
# starts the team's container (a command forwarded to it used to start it again right after the down, with no agent in it, and the
# installer then found the team running, exit 84). In the runtime folder, which no container mounts. A link there is not the mark.
function Get-JhtTeamStoppedPath { return (Join-Path $RuntimeDir 'team-stopped') }
function Test-JhtTeamStoppedByPerson {
  try {
    $item = Get-Item -LiteralPath (Get-JhtTeamStoppedPath) -Force -ErrorAction Stop
    return (-not $item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint))
  } catch { return $false }
}
# Whatever stands at the mark's path goes first, a link too, even one that points nowhere (Test-Path does not see a broken link, and
# WriteAllText would follow it): the mark is always a new plain file.
function Remove-JhtTeamStoppedEntry {
  $path = Get-JhtTeamStoppedPath
  $item = $null
  try { $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop } catch { $item = $null }
  if ($null -ne $item) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $item.Delete() } else { Remove-Item -LiteralPath $path -Force -ErrorAction Stop }
  }
  return $path
}
function Set-JhtTeamStopped {
  try {
    $path = Remove-JhtTeamStoppedEntry
    [IO.File]::WriteAllText($path, "jht down`n", [Text.UTF8Encoding]::new($false))
  } catch { }
}
function Clear-JhtTeamStopped {
  try { [void](Remove-JhtTeamStoppedEntry) } catch { }
}
function Get-JhtTeamStoppedText {
  if ((Get-JhtTextLanguage) -ceq 'en') { return "Job Hunter Team is stopped: 'jht up' starts it again." }
  return "Job Hunter Team e' fermato: jht up per riaccenderlo."
}

# `jht doctor` with the team off: what this computer can check without starting anything (the engine, the runtime, the configuration,
# the memory limit of WSL), and the team said off. The same shape as the CLI's doctor; with --json the same keys. 1 with a problem.
function Invoke-JhtHostDoctor {
  param([string]$Team = 'off', [string[]]$DoctorArgs = @())
  $en = ((Get-JhtTextLanguage) -ceq 'en')
  $t = { param($english, $italian) if ($en) { $english } else { $italian } }
  $rows = [System.Collections.Generic.List[object]]::new()
  $engine = $false; try { $engine = [bool](Test-DockerReachable) } catch { $engine = $false }
  if ($engine) { $rows.Add(@('ok', (& $t 'container engine reachable' 'motore dei container raggiungibile'))) }
  else { $rows.Add(@('fail', (& $t 'container engine not reachable' 'motore dei container non raggiungibile'))) }
  $runtime = $false; try { $runtime = [bool](Test-RuntimeBundleTrusted) } catch { $runtime = $false }
  if ($runtime) { $rows.Add(@('ok', (& $t 'JHT runtime intact' 'runtime JHT integro'))) }
  else { $rows.Add(@('fail', (& $t "JHT runtime missing or changed: 'jht upgrade' installs it again" "runtime JHT mancante o cambiato: 'jht upgrade' lo reinstalla"))) }
  $profileDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath('UserProfile') }
  $configPath = Join-Path (Join-Path $profileDir '.jht') 'jht.config.json'
  if ($profileDir -and (Test-Path -LiteralPath $configPath -PathType Leaf)) { $rows.Add(@('ok', (& $t 'configuration present' 'configurazione presente'))) }
  else { $rows.Add(@('warn', (& $t "no configuration yet: 'jht setup'" "ancora nessuna configurazione: 'jht setup'"))) }
  $wslAdvice = Get-JhtDoctorWslMemoryAdvice
  if ($wslAdvice) {
    $rows.Add(@('warn', (& $t "WSL has no memory limit (other WSL distributions are registered): in %USERPROFILE%\.wslconfig, under [wsl2], add memory=$wslAdvice" "WSL non ha un limite di memoria (sono registrate altre distribuzioni WSL): in %USERPROFILE%\.wslconfig, sotto [wsl2], aggiungi memory=$wslAdvice")))
  }
  if ($Team -ceq 'unattestable') {
    $rows.Add(@('fail', (& $t "a container of the team is there but cannot be verified as ours: nothing was touched ('jht status' says more)" "c'e' un container della squadra ma non si puo' verificare che sia nostro: non ho toccato niente ('jht status' dice di piu')")))
  } else {
    $rows.Add(@('warn', (& $t "team off: 'jht up' starts it" "squadra spenta: 'jht up' la accende")))
  }
  $count = @{ ok = 0; warn = 0; fail = 0 }
  foreach ($row in $rows) { $count[$row[0]] += 1 }
  if ($DoctorArgs -ccontains '--json') {
    $checks = @(foreach ($row in $rows) { [ordered]@{ section = 'host'; status = $row[0]; message = $row[1]; hint = $null } })
    $answer = [ordered]@{ ok = ($count.fail -eq 0); teamRunning = $false; summary = [ordered]@{ ok = $count.ok; warnings = $count.warn; problems = $count.fail }; checks = $checks }
    [Console]::Out.WriteLine(($answer | ConvertTo-Json -Depth 5))
  } else {
    [Console]::Out.WriteLine((& $t 'Job Hunter Team: the team is off (its container is not running). Checks made from this computer:' 'Job Hunter Team: squadra spenta (il suo container non gira). Controlli fatti da questo computer:'))
    foreach ($row in $rows) {
      $mark = switch ($row[0]) { 'ok' { '+' } 'warn' { '!' } default { 'x' } }
      [Console]::Out.WriteLine("  $mark $($row[1])")
    }
    [Console]::Out.WriteLine((& $t "For the full checks (configuration, provider, database, agents): 'jht up', then 'jht doctor'." "Per i controlli completi (configurazione, provider, database, agenti): 'jht up', poi 'jht doctor'."))
  }
  if ($count.fail -gt 0) { return 1 }
  return 0
}

# A failed `docker compose up` is the failure of the command that asked for it. What runs after it
# (the broker's migration) calls native programs too, and $LASTEXITCODE would then say the start
# went well: the setup went on to systemctl after "statfs ... no such file or directory" (T83).
function Stop-OnFailedComposeUp {
  param([int]$Code)
  if ($Code -eq 0) { return }
  Write-Err "compose_up_failed: il team non si e' avviato (docker compose up, codice $Code). Controlla 'jht logs'."
  exit $Code
}

# Podman only: the broker and the Telegram service get a compose up each, one after the other, before
# the whole one. Compose creates the services in parallel (COMPOSE_PARALLEL_LIMIT and --parallel do not
# change that), and Podman's API service, 6.0.2 included, reads the subordinate ranges through
# libsubid, which is not thread safe: of two creates at once one finds no range, Podman ignores the
# error, and that container's keep-id map is the user alone. The Telegram service was created so, 0.4
# ms after the broker, and never started: "doesn't map UID 1003" (T85; podman #29848, fixed in
# containers/storage on 02/10/2026). A service already there and unchanged is left as it is.
# The exit code of the first up that fails, 0 otherwise.
function Invoke-PodmanServicesUpInTurn {
  if ($ContainerRuntime -ne 'podman') { return 0 }
  $definition = Get-Content -LiteralPath $ComposeFile -Raw
  # The broker only if it was made before (see Ensure-Broker): `up` never makes it.
  foreach ($service in @($BrokerContainer)) {
    if ($definition -notmatch "(?m)^  $([regex]::Escape($service)):" -or -not (Test-Path -LiteralPath $BrokerMadeMarker)) { continue }
    $code = Invoke-ComposeQuiet '--profile' 'broker' 'up' '-d' '--no-deps' $service
    if ($code -ne 0) { return $code }
  }
  return 0
}

function Test-DockerReachable {
  # Docker c'e' ED e' raggiungibile? A differenza di Require-Docker NON esce:
  # serve a DECIDERE, non a pretendere.
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  $null = & { $ErrorActionPreference = 'Continue'; & docker info 2>&1 }
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
                           (con --verbose si vedono anche le righe del motore)
    jht restart            lo riavvia
    jht status             stato di container e team
    jht logs [-f]          log del container
    jht upgrade            aggiorna all'immagine piu' recente
    jht setup              installazione guidata
    jht download --os X    scarica l'app desktop per un sistema
    jht shell              shell dentro il container
    jht mail setup         salva la casella di posta nel broker dei segreti
    jht mail drafts        email scritte dagli agenti in attesa del tuo ok
    jht mail approve <id>  le manda; jht mail discard <id> le scarta
    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]
                           le integrazioni che si aggiungono dopo il setup
                           (google, telegram, mail): stato letto dal motore
    jht telegram status    stato del servizio Telegram isolato
    jht telegram pair ROLE chiede il token senza eco sul computer host, poi
                           mostra un codice da mandare al bot dal tuo Telegram
                           Per automazioni: JSON su stdin. Non salvare il token
                           in ~/.jht; cancella subito file usati fuori da li'.
    jht telegram pair --all abbina in una seduta tutti i ruoli legacy
    jht telegram chat-id ROLE sposta il bot su un'altra chat, con lo stesso codice
    jht reset              cancella configurazione e volumi del broker
    jht migrate-runtime podman
                           copia/verifica i volumi Docker in Podman senza
                           selezionare il nuovo runtime o cancellare Docker
    jht uninstall --confirm rimuove il runtime locale Windows, ma conserva dati,
                            documenti, Podman e Compose

  Tutti gli altri comandi (positions, stats, team, providers, cron,
  working-hours, cloud...) girano DENTRO il container: per il loro aiuto
  serve il container attivo.

      jht up ; jht --help

'@ | Write-Host
}

function Invoke-HelpWithoutDocker {
  param([Parameter(ValueFromRemainingArguments)] $HelpArgs)
  if ((Test-DockerReachable) -and (Test-ContainerUp)) {
    & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry @HelpArgs }
    return $LASTEXITCODE
  }
  Write-LocalHelp
  return 0
}

# `jht integration --help`: its usage line, not the generic help of the host. Fixed text: the command lives in a helper that
# is fetched only when it is needed, and a help never fetches anything.
function Write-IntegrationHelp {
  [Console]::Out.WriteLine(@'
Uso: jht integration <comando>

  list [--json]                   le integrazioni e il loro stato
  status [ID] [--json]            lo stato di una, o di tutte
  add ID [--json]                 aggiunge un'integrazione
  remove ID [--purge --yes] [--remove-image] [--json]
                                  la toglie; --purge cancella anche i suoi dati (serve --yes);
                                  --remove-image (solo screen e media) toglie anche l'immagine degli strumenti

Gli ID ammessi sono quelli che mostra `jht integration list`. Niente si scarica o si accende
finche' non lo chiedi con `add`.
'@)
}

# `jht setup --help`: its options, not the generic help of the host. Fixed text: the setup itself runs in the container and a help
# never starts it. Keep it in step with the options of cli/src/commands/setup.js (a test compares them).
function Write-SetupHelp {
  [Console]::Out.WriteLine(@'
Uso: jht setup [opzioni]

Senza opzioni parte l'installazione guidata. Con --non-interactive non chiede niente:
tutto si da' con le opzioni.

  --non-interactive            nessuna domanda
  --provider <nome>            openai (predefinito), glm (Z.ai) o kimi (Moonshot)
  --harness <nome>             codex (predefinito) o pi; glm e kimi vanno solo con pi
  --auth-method <metodo>       api_key (predefinito) o subscription
  --api-key-file <percorso>    file che contiene la chiave API (una riga, leggibile solo da te).
                               Un file del tuo computer lo legge jht e lo passa al setup: con glm e kimi
                               il setup tiene la chiave per conto suo, mai nella configurazione
  --api-key-stdin              legge la chiave API dallo standard input (una riga): mai sulla riga di comando
  --api-key <chiave>           la chiave scritta qui, in chiaro (non ammessa per glm e kimi)
  --secret-mode <modo>         come si salva la chiave: plaintext (predefinito), env o file
  --secret-env <nome>          con --secret-mode env: la variabile d'ambiente che la contiene
  --secret-file <percorso>     con --secret-mode file: il file che la contiene
  --subscription-email <email> con --auth-method subscription: l'email dell'account
  --subscription-token <token> con --auth-method subscription: il token
  --model <modello>            il modello da usare
  --language <codice>          la lingua (per esempio it o en)
  --skip-health                salta il controllo finale
  --reset                      riparte da una configurazione pulita

Esempio, con una chiave GLM in un file:
  jht setup --non-interactive --provider glm --harness pi --api-key-file chiave.txt
'@)
}

# `jht screen --help`: its line of use, fixed text like the one of `jht integration`: a help downloads nothing.
function Write-ScreenHelp {
  [Console]::Out.WriteLine(@'
Uso: jht screen <comando>

  on [--json]       accende lo schermo dal vivo del closer: un container a parte, con lo stream solo su 127.0.0.1
  off [--remove-image] [--json]
                    lo spegne e toglie il container; l'immagine degli strumenti resta sul disco, per riaccenderlo
                    senza riscaricarla: --remove-image la toglie e libera lo spazio
  status [--json]   dice se e' acceso

Niente si scarica o si accende finche' non lo chiedi con `on`. Lo stream e' in sola visione.
'@)
}

# `jht linkedin --help`: its line of use, fixed text: a help downloads nothing.
function Write-LinkedinHelp {
  [Console]::Out.WriteLine(@'
Uso: jht linkedin <comando>

  login [--stop]    l'accesso a mano a LinkedIn (con Google): un browser in un container a parte, senza rete, di cui vedi
                    e usi la finestra dall'app; --stop chiude tutto
  status --json     dice se l'accesso e' in corso e se la sessione di LinkedIn e' salvata

Niente si scarica o si accende finche' non lo chiedi con `login`.
'@)
}

function Test-HostCommandUsesLocalHelp {
  param([string]$Command)
  return $Command -in @(
    'up', 'start-container', 'down', 'stop-container', 'restart', 'recreate',
    'upgrade', 'logs', 'status', 'shell', 'oauth-login', 'claude-login',
    'setup', 'download', 'mail', 'telegram', 'integration', 'screen', 'linkedin', 'tools', 'reset', 'migrate-runtime'
  )
}

function Test-ContainerUp {
  $running = & { $ErrorActionPreference = 'Continue'; & docker ps --format '{{.Names}}' 2>$null }
  return ($running -split "`n") -contains $Container
}

# Docker Desktop per Windows (WSL2): i bind mount di ~/.jht e della cartella
# dei documenti possono arrivare di root, e l'utente jht (1001) del container
# non ci scrive. Il container non ha piu' sudo (P1 del 08/10): la riparazione
# la fa l'host PRIMA di `up`, con un container una tantum della STESSA
# immagine — root, solo CAP_CHOWN, senza rete, con montate soltanto le due
# cartelle — che esegue /app/.launcher/repair-mounts.sh. Stesso contratto
# dell'app desktop (setup_service.gd, _repair_mount_ownership): stessi
# argomenti, stesso dispatch, stessi codici sullo stdout.
$MountRepairDispatch = 'if [ -x /app/.launcher/repair-mounts.sh ]; then exec /app/.launcher/repair-mounts.sh; else echo mount_repair_unsupported; fi'

function Get-ComposeImage {
  param([string]$File)
  $files = @('-f', $File)
  if ($ContainerRuntime -eq 'podman') { $files += @('-f', $PodmanComposeFile) }
  $ref = ((& { $ErrorActionPreference = 'Continue'; & docker compose @files --project-directory $RuntimeDir config --images 2>$null } | Select-Object -First 1) -as [string])
  if ($ref) { $ref = $ref.Trim() }
  if (-not $ref) { $ref = if ($env:JHT_IMAGE) { $env:JHT_IMAGE } else { $DefaultRuntimeImage } }
  return $ref
}

function Repair-MountOwnership {
  param([string]$Image)
  # Le stesse cartelle del compose (${HOME}/.jht e ${HOME}/Documents/...), create qui prima di ogni
  # up e con ogni motore, senza toccarle se ci sono: Docker le creerebbe da solo (e di root), Podman
  # no, e il container non si crea ("statfs ... no such file or directory", T83).
  $homeMount = Join-Path $env:HOME '.jht'
  $userMount = Join-Path $env:HOME 'Documents\Job Hunter Team'
  foreach ($dir in @($homeMount, $userMount)) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
      try { New-Item -ItemType Directory -Path $dir -Force -ErrorAction Stop | Out-Null }
      catch {
        Write-Err "user_dir_unavailable: non riesco a creare la cartella $dir, che il team usa."
        return $false
      }
    }
  }
  # Podman con keep-id mappa gia' i mount sull'utente: niente da riparare.
  if ($ContainerRuntime -ne 'docker') { return $true }
  if (-not $Image) { $Image = Get-ComposeImage $ComposeFile }
  $out = @(& { $ErrorActionPreference = 'Continue'; & docker run --rm --user '0:0' --cap-drop ALL --cap-add CHOWN --network none `
      --security-opt no-new-privileges `
      -v "${homeMount}:/jht_home" -v "${userMount}:/jht_user" `
      --entrypoint /bin/sh $Image -c $MountRepairDispatch 2>$null })
  $code = $LASTEXITCODE
  $receipts = @($out | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ })
  $expected = @('/jht_home', '/jht_user')
  $confirmed = @{}
  $invalid = $false
  foreach ($receipt in $receipts) {
    if ($receipt -notmatch '^mount_(?:ok|repaired) (/jht_home|/jht_user)$') {
      $invalid = $true
      continue
    }
    $confirmed[$Matches[1]] = $true
  }
  if ($code -eq 0 -and -not $invalid -and $receipts.Count -eq $expected.Count -and
      @($expected | Where-Object { -not $confirmed.ContainsKey($_) }).Count -eq 0) {
    return $true
  }
  # Codice, frase, azione: mai un avvio che si ferma in silenzio.
  Write-Err "mount_repair_failed: le cartelle di Job Hunter Team ($homeMount, $userMount) non sono scrivibili dal container e non si sono potute sistemare."
  Write-Info "  Cosa fare: apri Docker Desktop > Settings > Resources > File sharing, controlla che la cartella dell'utente sia condivisa, poi rilancia 'jht up'."
  return $false
}

function Get-ComposeProjectName {
  if ($ContainerRuntime -eq 'podman') { return 'jht' }
  $json = ((& { $ErrorActionPreference = 'Continue'; & docker compose -f $ComposeFile --project-directory $RuntimeDir config --format json 2>$null }) -join "`n")
  if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
  try {
    $name = [string](($json | ConvertFrom-Json -ErrorAction Stop).name)
    if ($name -notmatch '^[a-z0-9][a-z0-9_-]*$') { return $null }
    return $name
  } catch { return $null }
}

# One label of a container's Config.Labels JSON, '' when it is not there. ConvertFrom-Json first; when
# it cannot read the labels (Windows PowerShell 5.1 refuses two keys that differ only in case), the
# label is read from the text: only its own key and its string value.
function Get-ComposeLabel {
  param([string]$Json, [string]$Key)
  try {
    $labels = ConvertFrom-Json -InputObject $Json -ErrorAction Stop
    if ($labels) { return [string]$labels.$Key }
    return ''
  } catch {
    $match = [regex]::Match($Json, '"' + [regex]::Escape($Key) + '"\s*:\s*"((?:[^"\\]|\\.)*)"')
    if ($match.Success) { return $match.Groups[1].Value }
    return ''
  }
}

# The id of the one running container of a service of this compose project, or $null. Why the last
# lookup found none is in $script:ServiceLookupReason, for whoever has to say it (T79: the desktop's
# onboarding snapshot said containerRunning=0 with jht running, and nothing said why). A container of
# another project or service is skipped, not a reason to give up; a line that is not an id, or two
# running containers of the service, still are.
function Get-RunningComposeServiceId {
  param([string]$Service)
  $script:ServiceLookupReason = ''
  $expectedProject = Get-ComposeProjectName
  if (-not $expectedProject) { $script:ServiceLookupReason = 'the compose project name could not be read'; return $null }
  $files = @('-f', $ComposeFile)
  if ($ContainerRuntime -eq 'podman') { $files += @('-f', $PodmanComposeFile) }
  $composeArgs = @('compose') + $files + @('--project-directory', $RuntimeDir, '--profile', 'telegram', '--profile', 'broker', '--profile', 'media', '--profile', 'playwright', '--profile', 'screen', '--profile', 'login', 'ps', '-q')
  if ($ContainerRuntime -ne 'podman') { $composeArgs += $Service }
  $ids = @(& { $ErrorActionPreference = 'Continue'; & docker @composeArgs 2>$null } | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ })
  $psCode = $LASTEXITCODE
  if ($ids.Count -eq 0) {
    $script:ServiceLookupReason = "compose ps listed no running container of project $expectedProject (exit $psCode)"
    return $null
  }
  $found = $null
  $notes = @()
  foreach ($id in $ids) {
    if ($id -notmatch '^[0-9a-fA-F]{12,64}$') {
      $shown = if ($id.Length -gt 60) { $id.Substring(0, 60) + '...' } else { $id }
      $script:ServiceLookupReason = "compose ps printed a line that is not a container id: $shown"
      return $null
    }
    $short = $id.Substring(0, 12)
    # No double quote inside a native argument: Windows PowerShell 5.1 drops it, and
    # `{{index .Config.Labels "com.docker.compose.project"}}` reached docker as `... com.docker...`
    # (T71). The labels come whole as JSON, read here.
    # All the lines, then the first: Select-Object -First 1 stops the native command, and then
    # $LASTEXITCODE is still the one of the native command before it (T79).
    $detailLines = @(& { $ErrorActionPreference = 'Continue'; & docker inspect --type container $id --format '{{.State.Running}}|{{json .Config.Labels}}' 2>$null })
    $inspectCode = $LASTEXITCODE
    $details = if ($detailLines.Count) { [string]$detailLines[0] } else { '' }
    $cut = if ($details) { $details.IndexOf('|') } else { -1 }
    if ($cut -lt 0) { $notes += "inspect of $short gave nothing readable (exit $inspectCode)"; continue }
    $running = $details.Substring(0, $cut).Trim()
    $labelsJson = $details.Substring($cut + 1)
    $project = Get-ComposeLabel $labelsJson 'com.docker.compose.project'
    $serviceName = Get-ComposeLabel $labelsJson 'com.docker.compose.service'
    if ($project -ne $expectedProject) { $notes += "$short is of project '$project', not $expectedProject"; continue }
    if ($serviceName -ne $Service) { continue }
    if ($running -ne 'true') { $notes += "$short of $Service is not running ($running)"; continue }
    if ($found) {
      $script:ServiceLookupReason = "two running containers of $Service ($($found.Substring(0, 12)), $short)"
      return $null
    }
    $found = $id
  }
  if (-not $found) {
    $script:ServiceLookupReason = "no running container of $Service among $($ids.Count) listed by compose ps"
    if ($notes.Count) { $script:ServiceLookupReason += ': ' + ($notes -join '; ') }
  }
  return $found
}

# The tools' containers (the live screen, media, the sign-in) are stopped and removed first, each by the id the attestation gives (a
# running container of this project and that service): with the screen running podman-compose's `down` could not remove what it
# stood on, and the team's container came back up seconds later (measured on a Mac; the same podman-compose runs here). Nothing
# unattested is touched, and it is never an error. Then the team's own services, the same way but only stopped (telegram, the team,
# the broker last): the same raw lines came once without the screen, on a down ~35 s after the first up, and a container stopped by
# `stop` is one its restart policy (unless-stopped) never brings back; compose down then removes them.
function Stop-JhtToolContainersFirst {
  $names = @(& { $ErrorActionPreference = 'Continue'; & docker ps --format '{{.Names}}' 2>$null } | ForEach-Object { "$($_)".Trim() })
  foreach ($service in @('jht-screen', 'jht-media', 'jht-login-view', 'jht-login-proxy', 'jht-login', 'jht-playwright-populate', 'jht-telegram', 'jht', 'jht-broker')) {
    if ($names -cnotcontains $service) { continue }
    $id = Get-RunningComposeServiceId $service
    if (-not $id -or $id -notmatch '^[0-9a-fA-F]{12,64}$') { continue }
    & { $ErrorActionPreference = 'Continue'; & docker stop -t 10 $id *> $null }
    if ($service -in @('jht-telegram', 'jht', 'jht-broker')) { continue }   # the team's: compose down removes them
    & { $ErrorActionPreference = 'Continue'; & docker rm -f $id *> $null }
  }
}

function Write-InactiveOnboardingSnapshot {
  param([ValidateSet(0, 1)][int]$RuntimeInstalled)
  foreach ($line in @(
    "runtimeInstalled=$RuntimeInstalled",
    'containerRunning=0',
    'providerConfigured=0',
    'providerAuthenticated=0',
    'assistantWelcomed=0',
    'assistantRunning=0',
    'captainRunning=0',
    'profileReady=0'
  )) { [Console]::Out.WriteLine($line) }
}

# Read-only bridge used by the desktop onboarding state machine. It never
# starts Docker, Compose, the container or the team, and always emits exactly
# the eight protocol lines so a strict parser cannot inherit incidental host
# output.
# Why a snapshot says the container is not running, on stderr: stdout stays the eight lines a strict
# parser reads, and the desktop puts stderr in its runtime log (T79: containerRunning=0 with jht
# running, and nothing anywhere said why).
function Write-OnboardingSnapshotReason {
  param([string]$Reason)
  [Console]::Error.WriteLine("onboarding_snapshot: $Reason")
}

function Write-OnboardingSnapshot {
  $runtimeInstalled = 0
  try {
    if (-not (Test-RuntimeBundleTrusted)) {
      Write-OnboardingSnapshotReason 'runtime_untrusted: the host runtime did not pass its path, owner, reparse point and SHA-256 checks'
      Write-InactiveOnboardingSnapshot 0
      return
    }
    $runtimeInstalled = 1
    $containerId = Get-RunningComposeServiceId $Container
    if (-not $containerId) {
      Write-OnboardingSnapshotReason "container_not_found: $script:ServiceLookupReason"
      Write-InactiveOnboardingSnapshot 1
      return
    }

  $metadataScript = @'
const fs=require("fs"); let config={};
try { config=JSON.parse(fs.readFileSync("/jht_home/jht.config.json","utf8")); } catch {}
const provider=String(config.active_provider||"").toLowerCase();
const providers=config.providers||{}; const entry=providers[provider]||{};
const piApi=config.harness==="pi"&&["glm","kimi","moonshot"].includes(provider);
const keyThere=(()=>{const ref=entry.api_key_ref;if(ref&&typeof ref==="object"&&ref.source==="file"){try{const p=String(ref.path||"");const s=fs.lstatSync(p);return p.startsWith("/")&&s.isFile()&&s.size>0&&s.size<=4096}catch{return false}}return !!ref||!!entry.api_key})();
const configured=piApi?entry.auth_method==="api_key":(["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider)
  && (entry.auth_method||"subscription")==="subscription");
const markers={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"};
process.stdout.write(`${configured?1:0} ${(piApi?keyThere:config.harness==="pi"&&(provider==="openai"||provider==="codex")?((p)=>{try{const s=fs.lstatSync(p);if(!(s.isFile()&&s.size>0&&s.size<=262144&&(s.uid===process.getuid()||s.uid===0)))return false;const d=JSON.parse(fs.readFileSync(p,"utf8"));return!!d&&typeof d==="object"&&!Array.isArray(d)&&["openai"].some((n)=>!!d[n]&&typeof d[n]==="object"&&Object.keys(d[n]).length>0)}catch{return false}})("/jht_home/.pi/agent/auth.json"):markers[provider]&&fs.existsSync(markers[provider]))?1:0} ${fs.existsSync("/jht_home/profile/welcomed.flag")?1:0}`);
'@
    # Every native output here is read whole and then cut: see Get-RunningComposeServiceId (T79).
    # The script goes on stdin, never as an argument: Windows PowerShell 5.1 drops the double quotes
    # inside a native argument, and node then fails on it (T106).
    # No byte order mark in front of the script whatever the console and the session encode (Invoke-NativeWithStdin).
    $metadataLines = @(Invoke-NativeWithStdin { & { $ErrorActionPreference = 'Continue'; $metadataScript | & docker exec -i $containerId node - 2>$null } })
    $metadataCode = $LASTEXITCODE
    $metadata = if ($metadataLines.Count) { [string]$metadataLines[0] } else { '' }
    $values = if ($metadata) { @($metadata.Trim() -split '\s+') } else { @() }
    if ($metadataCode -ne 0 -or $values.Count -ne 3 -or @($values | Where-Object { $_ -notin @('0', '1') }).Count -gt 0) {
      Write-OnboardingSnapshotReason "provider_unreadable: the provider check in the container exited $metadataCode"
      $values = @('0', '0', '0')
    }

    $null = & { $ErrorActionPreference = 'Continue'; & docker exec $containerId tmux has-session -t ASSISTENTE 2>$null }
    $assistantRunning = if ($LASTEXITCODE -eq 0) { 1 } else { 0 }
    $null = & { $ErrorActionPreference = 'Continue'; & docker exec $containerId tmux has-session -t CAPITANO 2>$null }
    $captainRunning = if ($LASTEXITCODE -eq 0) { 1 } else { 0 }
    $null = & { $ErrorActionPreference = 'Continue'; & docker exec $containerId test -f /jht_home/profile/ready.flag 2>$null }
    $profileReady = if ($LASTEXITCODE -eq 0) { 1 } else {
      $null = & { $ErrorActionPreference = 'Continue'; & docker exec $containerId node $NodeEntry profile validate --strict --json 2>$null }
      if ($LASTEXITCODE -eq 0) { 1 } else { 0 }
    }
    $finalLines = @(& { $ErrorActionPreference = 'Continue'; & docker inspect $containerId --format '{{.State.Running}}' 2>$null })
    $finalInspectCode = $LASTEXITCODE
    $finalRunning = if ($finalLines.Count) { [string]$finalLines[0] } else { '' }
    if ($finalInspectCode -ne 0 -or -not $finalRunning -or $finalRunning.Trim() -ne 'true') {
      Write-OnboardingSnapshotReason "container_stopped: inspect of $($containerId.Substring(0, 12)) at the end said '$finalRunning' (exit $finalInspectCode)"
      Write-InactiveOnboardingSnapshot 1
      return
    }

    foreach ($line in @(
      'runtimeInstalled=1',
      'containerRunning=1',
      "providerConfigured=$($values[0])",
      "providerAuthenticated=$($values[1])",
      "assistantWelcomed=$($values[2])",
      "assistantRunning=$assistantRunning",
      "captainRunning=$captainRunning",
      "profileReady=$profileReady"
    )) { [Console]::Out.WriteLine($line) }
  } catch {
    Write-OnboardingSnapshotReason "error: $($_.Exception.Message)"
    Write-InactiveOnboardingSnapshot $runtimeInstalled
  }
}

$script:DesktopChatExitCode = 1
function Invoke-DesktopChat {
  param([string[]]$ChatArgs)
  $script:DesktopChatExitCode = 1
  if (-not (Test-RuntimeBundleTrusted)) {
    Write-Err 'runtime o container JHT non disponibile'
    return
  }
  $containerId = Get-RunningComposeServiceId $Container
  if (-not $containerId) {
    Write-Err 'runtime o container JHT non disponibile'
    return
  }
  $action = if ($ChatArgs.Count -gt 0) { $ChatArgs[0] } else { '' }
  switch ($action) {
    'probe' {
      if ($ChatArgs.Count -ne 1) { $script:DesktopChatExitCode = 2; return }
      [Console]::Out.WriteLine('true')
      $script:DesktopChatExitCode = 0
    }
    'python' {
      if ($ChatArgs.Count -ne 1) { $script:DesktopChatExitCode = 2; return }
      & docker exec -i $containerId python3 -c 'import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())'
      $script:DesktopChatExitCode = $LASTEXITCODE
    }
    'send' {
      # the eight fixed sessions, or an instance of a numbered role (SCOUT-2.. up to four digits, no zero in front;
      # -cmatch: case counts, as it does in the bash wrapper's case)
      $fixedSessions = @('CAPITANO', 'ASSISTENTE', 'MENTOR', 'SCOUT-1', 'ANALISTA-1', 'SCORER-1', 'SCRITTORE-1', 'CRITICO')
      if ($ChatArgs.Count -ne 2 -or -not ($ChatArgs[1] -in $fixedSessions -or $ChatArgs[1] -cmatch '\A(SCOUT|ANALISTA|SCORER|SCRITTORE)-[1-9][0-9]{0,3}\z')) {
        $script:DesktopChatExitCode = 2; return
      }
      # No double quote inside a native argument (5.1 drops it, T71): an empty IFS keeps the message
      # one word without quotes, and set -f keeps its * and ? from matching file names.
      & docker exec -i $containerId sh -c 'IFS=; set -f; msg=$(cat); exec jht-tmux-send $1 $msg' sh $ChatArgs[1]
      $script:DesktopChatExitCode = $LASTEXITCODE
    }
    default { $script:DesktopChatExitCode = 2 }
  }
}

# Pannello agenti del desktop (`jht agent-control ...`). Non avvia mai niente:
# niente Ensure-Up, niente compose up, niente machine. Con il container spento
# o non attestato risponde con il codice chiuso agent_control_no_team (113) e
# basta. Altrimenti passa gli argomenti, senza TTY, al CLI nel container, che
# controlla la forma e li passa allo script del pannello; stdout e codice
# d'uscita tornano invariati.
# Come Invoke-DesktopChat, il codice sta in $script:AgentControlExitCode: la
# risposta del CLI esce sullo stdout dello script, non nel valore della funzione.
$script:AgentControlExitCode = 113
function Invoke-AgentControl {
  param([string[]]$ControlArgs)
  $script:AgentControlExitCode = 113
  $containerId = $null
  if (Test-RuntimeBundleTrusted) { $containerId = Get-RunningComposeServiceId $Container }
  if (-not $containerId) {
    [Console]::Out.WriteLine('{"ok":false,"error":"agent_control_no_team"}')
    return
  }
  & docker exec -i -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $containerId node $NodeEntry agent-control @ControlArgs
  $script:AgentControlExitCode = $LASTEXITCODE
}

# Autorizzazione a una candidatura, dal desktop (`jht desktop-apply record ID INSTANT DESTINATION`). Il CLOSER
# invia solo cio' che il broker ha registrato, e il broker registra solo da canali che gli agenti non hanno:
# l'host e' uno. Come Invoke-AgentControl NON avvia mai niente, salvo il primo clic di una persona (se il broker non c'e' ancora lo crea
# Ensure-Broker, solo il suo container): col broker non attestato risponde col codice chiuso apply_record_no_broker (113). Ogni campo e' chiuso QUI (confronto che distingue le maiuscole,
# cifre ASCII; fine stringa con \z: in .NET `$` accetta anche un a capo finale) prima di finire in una riga di comando; la risposta e' una riga sola, mai il testo del broker.
# Il codice sta in $script:DesktopApplyExitCode, come per Invoke-AgentControl.
$script:DesktopApplyExitCode = 2
function Invoke-DesktopApply {
  param([string[]]$ApplyArgs)
  $script:DesktopApplyExitCode = 2
  if (
    $ApplyArgs.Count -ne 4 -or $ApplyArgs[0] -cne 'record' -or
    $ApplyArgs[1] -cnotmatch '^[1-9][0-9]{0,9}\z' -or
    $ApplyArgs[2] -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z\z' -or
    $ApplyArgs[3] -cnotmatch '^((web|email):[a-z0-9.-]{3,253}|portal:[a-z]{2,20})\z'
  ) {
    [Console]::Out.WriteLine('{"ok":false,"error":"apply_record_invalid"}')
    return
  }
  $brokerId = $null
  if (Test-RuntimeBundleTrusted) {
    $brokerId = Get-RunningComposeServiceId $BrokerContainer
    # The first click of a person is the one thing that makes the broker here (Ensure-Broker): only its container, and only if the engine answers.
    if (-not $brokerId -and (Test-DockerReachable) -and (Ensure-Broker -Quiet 6>$null) -eq 0) { $brokerId = Get-RunningComposeServiceId $BrokerContainer }
  }
  if (-not $brokerId) {
    [Console]::Out.WriteLine('{"ok":false,"error":"apply_record_no_broker"}')
    $script:DesktopApplyExitCode = 113
    return
  }
  # stdin aperto e vuoto, come `apply record`; l'errore nativo non diventa un'eccezione (5.1)
  $answer = (Invoke-NativeWithStdin { '' | & { $ErrorActionPreference = 'Continue'; $input | & docker exec -i $brokerId jht-broker-admin apply record $ApplyArgs[1] $ApplyArgs[2] $ApplyArgs[3] 2>$null } }) -join ''
  $code = $LASTEXITCODE
  if ($code -ne 0 -or $answer -cnotmatch '"status": ?"(recorded|already_recorded)"') {
    [Console]::Out.WriteLine('{"ok":false,"error":"apply_record_refused"}')
    $script:DesktopApplyExitCode = 1
    return
  }
  [Console]::Out.WriteLine('{"ok":true}')
  $script:DesktopApplyExitCode = 0
}

function Test-BrokerUp {
  return [bool](Get-RunningComposeServiceId $BrokerContainer)
}

# The broker (the mail password, the notary of the authorisations to apply) is made at the first thing that needs it (`jht mail setup`, the
# first record of an authorisation, the link of the site, Telegram) and by nothing else: `jht up` leaves it out unless a marker says it was
# made before. `jht` has mounted the empty socket volume since it was made, so making the broker never recreates the team.
# On Podman its proxy (3129) and its start at boot are made first, by the network script of the setup, which is a host script like the others
# (attested in .runtime-helpers, fetched here the first time).
# What the steps of Ensure-Broker print goes to the console, or nowhere for the app (-Quiet: its answer is one JSON line).
function Write-EnsureLine {
  param([Parameter(ValueFromPipeline)]$Line, [switch]$Quiet)
  process { if (-not $Quiet) { $Line | Out-Host } }
}

function Invoke-BrokerNetwork {
  param([switch]$Quiet)
  if ($ContainerRuntime -ne 'podman') { return $true }
  foreach ($name in @('configure-podman-windows-network.ps1', 'wsl-interop-connect-proxy.py')) {
    if (-not (Test-RuntimeHelperDeclared $name)) {
      if (-not (Install-RuntimeHelpers)) { Write-Err 'broker_network_unavailable: non riesco a scaricare gli script del proxy della posta. Cosa fare: jht upgrade'; return $false }
      break
    }
  }
  if (-not (Test-RuntimeHelpersTrusted) -or -not (Test-RuntimeHelperDeclared 'configure-podman-windows-network.ps1')) {
    Write-Err 'broker_network_unavailable: gli script del proxy della posta non sono attestati. Cosa fare: jht upgrade'
    return $false
  }
  $shell = (Get-Process -Id $PID).Path
  & $shell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $RuntimeDir 'configure-podman-windows-network.ps1') `
    -MachineName $env:CONTAINER_CONNECTION -BridgeScript $PodmanMachineBridgePath -WithBroker | Write-EnsureLine -Quiet:$Quiet
  if ($LASTEXITCODE -ne 0) { Write-Err "broker_network_unavailable: il proxy della posta non e' pronto (codice $LASTEXITCODE)."; return $false }
  return $true
}

# What stands under the broker's name: 'running' | 'stopped' (a container of this project and service that is not running) | 'absent' |
# 'foreign' (a container of that name that is not this project's broker, or more than one, or one that cannot be read: not touched,
# neither adopted nor replaced). The same three-way answer as the POSIX wrapper (attested / absent / present and not attestable).
function Get-BrokerContainerState {
  $expectedProject = Get-ComposeProjectName
  if (-not $expectedProject) { return 'foreign' }
  $ids = @(& { $ErrorActionPreference = 'Continue'; & docker ps -aq --filter "name=^$BrokerContainer$" 2>$null } | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ })
  if ($ids.Count -eq 0) { return 'absent' }
  if ($ids.Count -ne 1 -or $ids[0] -notmatch '^[0-9a-fA-F]{12,64}$') { return 'foreign' }
  $detailLines = @(& { $ErrorActionPreference = 'Continue'; & docker inspect --type container $ids[0] --format '{{.State.Running}}|{{json .Config.Labels}}' 2>$null })
  $details = if ($detailLines.Count) { [string]$detailLines[0] } else { '' }
  $cut = if ($details) { $details.IndexOf('|') } else { -1 }
  if ($cut -lt 0) { return 'foreign' }
  $labelsJson = $details.Substring($cut + 1)
  if ((Get-ComposeLabel $labelsJson 'com.docker.compose.project') -ne $expectedProject) { return 'foreign' }
  if ((Get-ComposeLabel $labelsJson 'com.docker.compose.service') -ne $BrokerContainer) { return 'foreign' }
  if ($details.Substring(0, $cut).Trim() -eq 'true') { return 'running' }
  return 'stopped'
}

# 0 when the broker runs and answers.
function Ensure-Broker {
  param([switch]$Quiet)
  if (Get-RunningComposeServiceId $BrokerContainer) { return 0 }
  $brokerState = Get-BrokerContainerState
  if ($brokerState -eq 'foreign') {
    Write-Err 'broker_unavailable: il broker dei segreti esiste ma non e'' attestabile come nostro: non lo tocco.'
    return 1
  }
  if ((Get-Content -LiteralPath $ComposeFile -Raw) -notmatch "(?m)^  $([regex]::Escape($BrokerContainer)):") {
    Write-Err 'broker_unavailable: il runtime installato e'' piu'' vecchio e non ha il broker dei segreti.'
    Write-Err 'Cosa fare: jht upgrade'
    return 1
  }
  Write-Info 'Preparo il servizio della posta (si crea solo la prima volta che serve)...'
  if (-not (Invoke-BrokerNetwork -Quiet:$Quiet)) { return 1 }
  Invoke-Compose '--profile' 'broker' 'up' '-d' '--no-deps' $BrokerContainer | Write-EnsureLine -Quiet:$Quiet
  if ($LASTEXITCODE -ne 0) { Write-Err 'broker_start_failed: il servizio della posta non e'' partito.'; Write-Err 'Cosa fare: riprova il comando'; return 1 }
  $ready = $false
  for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
    $brokerId = Get-RunningComposeServiceId $BrokerContainer
    if ($brokerId) {
      $null = & { $ErrorActionPreference = 'Continue'; & docker exec $brokerId jht-broker-admin secrets status 2>&1 }
      $ready = ($LASTEXITCODE -eq 0)
    }
    if (-not $ready) { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { Write-Err 'broker_start_failed: il servizio della posta non risponde dopo 30 secondi.'; Write-Err 'Cosa fare: riprova il comando'; return 1 }
  New-Item -ItemType File -Path $BrokerMadeMarker -Force -ErrorAction SilentlyContinue | Out-Null
  $null = Invoke-BrokerMigrateLegacyOnce
  $null = Initialize-BrokerWebAuthorisations
  return 0
}

# After `up`: a broker made before comes back with the team (`down` removes its container); one that an older install made is adopted.
function Resume-Broker {
  $brokerState = Get-BrokerContainerState
  if ($brokerState -eq 'foreign') {
    # a container of that name that is not this project's broker is neither adopted nor started over
    if (Test-Path -LiteralPath $BrokerMadeMarker) { Write-Warn "broker_restart_failed: il broker dei segreti non e' attestabile come nostro: non lo tocco. Cosa fare: jht mail status" }
    return
  }
  if (-not (Test-Path -LiteralPath $BrokerMadeMarker)) {
    if ($brokerState -eq 'absent') { return }
    New-Item -ItemType File -Path $BrokerMadeMarker -Force -ErrorAction SilentlyContinue | Out-Null
  }
  if ($brokerState -ne 'running') {
    $brokerCode = Invoke-ComposeQuiet '--profile' 'broker' 'up' '-d' '--no-deps' $BrokerContainer
    if ($brokerCode -ne 0) { Write-Warn "broker_restart_failed: il servizio della posta non e' ripartito. Cosa fare: jht mail status" }
  }
  $null = Invoke-BrokerMigrateLegacyOnce
  Initialize-BrokerWebAuthorisations
}

# L'host amministra il broker con exec di jht-broker-admin; un segreto passa
# solo su stdin ($InputText), mai negli argomenti.
# I chiamanti passano SEMPRE -AdminArgs per nome (come Invoke-TelegramAdmin): InputText e' il primo
# parametro posizionale, e `Invoke-BrokerAdmin secrets status` gli darebbe 'secrets' lasciando al
# broker il solo 'status'.
function Invoke-BrokerAdmin {
  param([string]$InputText = $null, [Parameter(ValueFromRemainingArguments)] [string[]]$AdminArgs)
  $brokerId = Get-RunningComposeServiceId $BrokerContainer
  if (-not $brokerId) {
    if (Test-Path -LiteralPath $BrokerMadeMarker) {
      Write-Err 'broker_unavailable: il broker dei segreti non e'' attivo.'
      Write-Err 'Cosa fare: jht up'
    } else {
      Write-Err 'broker_unavailable: il servizio della posta non c''e'' ancora: si crea la prima volta che serve.'
      Write-Err 'Cosa fare: jht mail setup'
    }
    return 1
  }
  # Out-Host: la risposta JSON va a chi ha lanciato jht, non nel valore di
  # ritorno della funzione (che e' solo il codice d'uscita).
  # [string] trasforma $null in "": senza ContainsKey ogni chiamata, anche `apply account` o
  # `secrets status`, aprirebbe lo stdin con una riga vuota. Solo un -InputText passato davvero
  # (anche vuoto, come in `apply record`) lo apre.
  if ($PSBoundParameters.ContainsKey('InputText')) {
    # Una password con caratteri non ASCII arriverebbe come '?' con la
    # codifica di default di Windows PowerShell 5.1.
    # Nor a byte order mark in front of it: a password with a BOM is another password (Invoke-NativeWithStdin).
    Invoke-NativeWithStdin { $InputText | & docker exec -i $brokerId jht-broker-admin @AdminArgs | Out-Host }
  } else {
    & docker exec -i $brokerId jht-broker-admin @AdminArgs | Out-Host
  }
  return $LASTEXITCODE
}

# Autorizzare una candidatura dall'host (T68). Il CLOSER invia solo cio' che il
# broker ha registrato, e il broker registra solo da canali che gli agenti non
# hanno: questo terminale dell'host e' uno. Il container mostra l'anteprima
# («titolo @ azienda · host») con il suo digest, la persona conferma qui, il
# container scrive il flag solo se la posizione e' ancora quella vista, e
# l'host registra nel broker istante e destinazione. Ogni campo del container
# e' chiuso e ricontrollato qui prima di finire in una riga di comando.
function Read-ApplyFields {
  param([AllowNull()] [string]$Line)
  if ([string]::IsNullOrEmpty($Line)) { return $null }
  $fields = $Line -split "`t"
  if ($fields.Count -ne 6) { return $null }
  return ,$fields
}

function Invoke-ApplySkill {
  param([string]$ContainerId, [string[]]$SkillArgs)
  $previous = [Console]::OutputEncoding
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  try {
    # Tutte le righe, poi l'ultima: con `| Select-Object -First 1` $LASTEXITCODE
    # non e' piu' quello di docker.
    # Under 'Stop' Windows PowerShell 5.1 turns the first line of a redirected stderr into an error:
    # the redirection lives inside a scope where the preference is 'Continue'.
    $lines = @(& { $ErrorActionPreference = 'Continue'; & docker exec $ContainerId python3 /app/shared/skills/apply_request.py @SkillArgs --host 2>$null })
  } finally {
    [Console]::OutputEncoding = $previous
  }
  if ($lines.Count -eq 0) { return $null }
  return Read-ApplyFields ([string]$lines[$lines.Count - 1])
}

function Get-ApplyReason {
  param($Fields)
  if ($null -eq $Fields) { return 'nessuna risposta dal container' }
  return [string]$Fields[1]
}

function Invoke-ApplyHostCommand {
  param([string[]]$ApplyArgs)
  $action = [string]$ApplyArgs[0]
  $id = ''
  if ($ApplyArgs.Count -ge 2) { $id = [string]$ApplyArgs[1] }
  if ($id -cnotmatch '^[1-9][0-9]{0,9}$') { Write-Err 'uso: jht apply request|cancel <id>'; return 2 }
  $containerId = Get-RunningComposeServiceId $Container
  if (-not $containerId) { Write-Err 'Container JHT non attestabile.'; return 1 }

  if ($action -ceq 'cancel') {
    $withdrawn = Invoke-ApplySkill $containerId @('cancel', $id)
    if ($null -eq $withdrawn -or $withdrawn[0] -cne '1') {
      Write-Err "Ritiro non riuscito: $(Get-ApplyReason $withdrawn)."
      return 1
    }
    Write-Info "Ritirata #${id}: non verra' inviata."
    return 0
  }

  $shown = Invoke-ApplySkill $containerId @('show', $id)
  if ($null -eq $shown -or $shown[0] -cne '1') {
    Write-Err "Non autorizzabile: $(Get-ApplyReason $shown)."
    return 1
  }
  $confirm = [string]$shown[2]
  $shownDestination = [string]$shown[3]
  if ($confirm -cnotmatch '^[0-9a-f]{64}$' -or $shownDestination -cnotmatch '^((web|email):[a-z0-9.-]{3,253}|portal:[a-z]{2,20})$') {
    Write-Err 'Anteprima non valida: niente autorizzato.'
    return 1
  }
  if ([Console]::IsInputRedirected -or -not [Environment]::UserInteractive) {
    Write-Err "Serve un terminale: l'autorizzazione si conferma a mano."
    return 1
  }
  Write-Host ''
  Write-Host "  #${id}  $([string]$shown[5])"
  Write-Host ''
  Write-Host "  Con l'invio automatico acceso il team compila e INVIA la candidatura,"
  Write-Host "  senza un'altra conferma. Una volta partita non si richiama."
  $answer = Read-Host '  Autorizzi questa candidatura? [s/N]'
  if (@('s', 'si', 'sì', 'y', 'yes') -notcontains ([string]$answer).Trim().ToLowerInvariant()) {
    Write-Info 'Annullato: niente autorizzato.'
    return 1
  }

  $written = Invoke-ApplySkill $containerId @('request', $id, '--expect', $confirm)
  if ($null -eq $written -or $written[0] -cne '1') {
    Write-Err "Non autorizzata: $(Get-ApplyReason $written)."
    return 1
  }
  $destination = [string]$written[3]
  $instant = [string]$written[4]
  if ($destination -cne $shownDestination -or $instant -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$') {
    $null = Invoke-ApplySkill $containerId @('cancel', $id)
    Write-Err "Risposta del container non valida: autorizzazione ritirata, niente partira'."
    return 1
  }
  $recorded = Invoke-BrokerAdmin -InputText '' -AdminArgs @('apply', 'record', $id, $instant, $destination)
  if ($recorded -ne 0) {
    $null = Invoke-ApplySkill $containerId @('cancel', $id)
    Write-Err "Il broker non ha registrato l'autorizzazione: ritirata, niente partira'."
    return 1
  }
  Write-Info "Autorizzata #${id}, verso ${destination}: il CLOSER la prendera' al prossimo giro."
  return 0
}

function Invoke-TelegramAdmin {
  param([string]$InputText = $null, [Parameter(ValueFromRemainingArguments)] [string[]]$AdminArgs)
  $telegramId = Get-RunningComposeServiceId $TelegramContainer
  if (-not $telegramId) {
    Write-Err 'telegram_unavailable: il servizio Telegram isolato non e'' attivo.'
    Write-Err 'Cosa fare: jht up'
    return 1
  }
  # [string] trasforma $null in "": solo un -InputText passato davvero (anche
  # vuoto, come le impronte di un inventario senza token) apre lo stdin.
  if ($PSBoundParameters.ContainsKey('InputText')) {
    Invoke-NativeWithStdin { $InputText | & docker exec -i $telegramId jht-telegram-admin @AdminArgs | Out-Host }
  } else {
    & docker exec $telegramId jht-telegram-admin @AdminArgs | Out-Host
  }
  return $LASTEXITCODE
}

function Invoke-TelegramLegacy {
  param([string]$Command, [string]$Role = '')
  if ($Command -notin @('inventory', 'remove', 'remaining')) { return 2 }
  $image = Get-ComposeImage $ComposeFile
  if (-not $image) { return 1 }
  $mode = if ($Command -eq 'remove') { 'rw' } else { 'ro' }
  $runArgs = @('run', '--rm')
  if ($ContainerRuntime -eq 'podman') { $runArgs += @('--userns', 'keep-id:uid=1001,gid=1001') }
  $runArgs += @(
    '--user', '1001:1001', '--read-only', '--tmpfs', '/tmp:size=4m,mode=1777',
    '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--volume', "${JhtHome}:/jht_home:$mode", '--entrypoint', '/usr/bin/python3',
    $image, '-I', '/app/shared/telegram_service/bin/jht-telegram-legacy.py', $Command
  )
  if ($Role) { $runArgs += $Role }
  & docker @runArgs
}

# Come telegram_legacy_sources_present nel wrapper Bash: senza file legacy
# l'avvio non passa dal servizio isolato. In JSON la chiave «telegram» compare
# solo scritta così o con un escape \u; nel dubbio l'inventario parte.
function Test-TelegramLegacySource {
  if (-not (Test-Path -LiteralPath $JhtHome)) { return $false }
  try {
    $credentials = Get-Item -LiteralPath (Join-Path $JhtHome 'credentials') -Force -ErrorAction SilentlyContinue
    if ($credentials) {
      if (-not $credentials.PSIsContainer -or $credentials.LinkType) { return $true }
      if (@(Get-ChildItem -LiteralPath $credentials.FullName -Filter 'telegram*' -Force -ErrorAction Stop).Count) { return $true }
    }
    $paths = @(Join-Path $JhtHome 'jht.config.json')
    $paths += @(Get-ChildItem -LiteralPath $JhtHome -Filter 'jht.config.json.bak-model-pin-*' -Force -ErrorAction Stop | ForEach-Object { $_.FullName })
    foreach ($path in $paths) {
      $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
      if (-not $item) { continue }
      if ($item.PSIsContainer -or $item.LinkType) { return $true }
      # UTF-16 e UTF-32 li legge anche json.load: un BOM o un byte NUL fanno
      # partire l'inventario.
      $bytes = [IO.File]::ReadAllBytes($path)
      if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) { return $true }
      if ([Array]::IndexOf($bytes, [byte]0) -ge 0) { return $true }
      $raw = [Text.Encoding]::UTF8.GetString($bytes)
      if ($raw.Contains('telegram') -or $raw.Contains('\u')) { return $true }
    }
  } catch { return $true }
  return $false
}

function Initialize-TelegramLegacyInventory {
  if (-not (Test-TelegramLegacySource)) { return $true }
  Invoke-Compose '--profile' 'telegram' up '-d' $TelegramContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { return $false }
  if ((Invoke-TelegramAdmin -AdminArgs @('legacy', 'complete')) -eq 0) { return $true }
  if (Test-ContainerUp) {
    Invoke-Compose stop $Container | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
  }
  foreach ($role in @('assistente', 'capitano', 'mentor')) {
    $digests = @(& { $ErrorActionPreference = 'Continue'; Invoke-TelegramLegacy inventory $role 2>$null })
    if ($LASTEXITCODE -ne 0 -or @($digests | Where-Object { $_ -notmatch '^[0-9a-f]{64}$' }).Count -gt 0) {
      return $false
    }
    if ((Invoke-TelegramAdmin -InputText ($digests -join "`n") -AdminArgs @('legacy', 'remember', $role)) -ne 0) {
      return $false
    }
  }
  return $true
}

# Inventario host di un ruolo, conservato dal servizio isolato. Restituisce
# @{ Ok; Digests } per il successivo `bots pair`; gli agenti li ferma il chiamante.
function Get-TelegramPairInventory {
  param([string]$Role)
  $digests = @(& { $ErrorActionPreference = 'Continue'; Invoke-TelegramLegacy inventory $Role 2>$null })
  if ($LASTEXITCODE -ne 0 -or @($digests | Where-Object { $_ -notmatch '^[0-9a-f]{64}$' }).Count -gt 0) {
    Write-Err 'legacy_inventory_failed: migrazione Telegram interrotta.'
    return @{ Ok = $false; Digests = @() }
  }
  if ((Invoke-TelegramAdmin -InputText ($digests -join "`n") -AdminArgs @('legacy', 'remember', $Role)) -ne 0) {
    Write-Err 'legacy_inventory_failed: le impronte non sono state conservate dal servizio isolato.'
    return @{ Ok = $false; Digests = @() }
  }
  return @{ Ok = $true; Digests = $digests }
}

# Il token nuovo va al servizio isolato e basta. Il chat id non si scrive: il
# servizio mostra un codice monouso e lo prende dal messaggio con cui la
# persona lo manda al bot nuovo dal suo Telegram.
function Send-TelegramPairToken {
  param([string]$Role, [string[]]$Digests)
  $adminArgs = @('bots', 'pair', $Role)
  foreach ($digest in $Digests) { if ($digest) { $adminArgs += @('--legacy-digest', $digest) } }
  $token = $null
  if ([Console]::IsInputRedirected) {
    $payload = [Console]::In.ReadToEnd()
  } else {
    $secureToken = Read-Host "Token del bot $Role (input nascosto)" -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
    $secureToken = $null
    if ($token -notmatch '^[0-9]{5,12}:[A-Za-z0-9_-]{20,}$') {
      $token = $null
      Write-Err 'bot_token_invalid: controlla il token generato da BotFather.'
      return 1
    }
    $payload = @{ bot_token = $token } | ConvertTo-Json -Compress
    $token = $null
  }
  if (-not $payload) { Write-Err 'input_not_json: passa bot_token come JSON su stdin.'; return 2 }
  $code = Invoke-TelegramAdmin -InputText $payload -AdminArgs $adminArgs
  $payload = $null
  if ($code -ne 0) {
    Write-Err 'Abbinamento rifiutato: genera un token nuovo in BotFather (/revoke) e riprova.'
    return $code
  }
  return 0
}

# Dopo l'ultima copia legacy tolta il servizio isolato si accende (una volta
# sola, irreversibile) e il team riparte senza il bridge legacy.
function Complete-TelegramPair {
  param([bool]$WasEnabled, [bool]$AgentWasRunning)
  $null = Invoke-TelegramLegacy remaining
  $remainingCode = $LASTEXITCODE
  if ($remainingCode -eq 0) {
    if ((Invoke-TelegramAdmin -AdminArgs @('cutover', 'enable')) -ne 0) { return 1 }
    Invoke-Compose '--profile' 'telegram' restart $TelegramContainer
    if (-not $WasEnabled -and $AgentWasRunning) { Invoke-Compose restart $Container }
    Write-Info 'Telegram isolato attivo; il bridge legacy non puo'' essere riabilitato dagli agenti.'
    return 0
  }
  if ($remainingCode -eq 1) {
    Write-Warn 'Bot abbinato e copia legacy rimossa. Restano altri token legacy o un token nell''ambiente del container: rimuovili e completa la rotazione prima del cutover.'
    return 0
  }
  Write-Err 'legacy_inventory_failed: non posso provare che ~/.jht sia privo di token Telegram.'
  return 1
}

function Invoke-TelegramPair {
  param([string]$Role)
  if ($Role -eq '--all') { return Invoke-TelegramPairAll }
  if ($Role -notin @('assistente', 'capitano', 'mentor')) {
    Write-Err 'uso: jht telegram pair <assistente|capitano|mentor>|--all'
    Write-Err 'Interattivo: il token viene chiesto senza eco, poi il bot nuovo riceve un codice monouso dal tuo Telegram. Automazioni: {"bot_token": ...} come JSON su stdin; non salvare il token in ~/.jht e cancella subito qualunque file usato fuori da li''.'
    return 2
  }
  $telegramId = Get-RunningComposeServiceId $TelegramContainer
  if (-not $telegramId) { Write-Err 'telegram_unavailable: esegui jht up'; return 1 }
  # Gli altri ruoli con un token legacy: finche' ne resta uno il servizio non si
  # accende e il ruolo appena abbinato resta muto. Serve solo ad avvisare.
  $remainingOut = @(& { $ErrorActionPreference = 'Continue'; Invoke-TelegramLegacy remaining 2>$null })
  if ($LASTEXITCODE -eq 1) {
    $others = @(($remainingOut -join ' ') -split '\s+' | Where-Object { $_ -in @('assistente', 'capitano', 'mentor') -and $_ -ne $Role })
    if ($others.Count -gt 0) {
      Write-Warn "Restano token legacy per: $($others -join ' '). Finche' non abbini anche questi ruoli, $Role resta muto su Telegram: abbinali tutti in questa seduta (jht telegram pair --all)."
      if (-not [Console]::IsInputRedirected) {
        $answer = Read-Host "Abbinare $Role adesso? [s/N]"
        if ($answer -notmatch '^(s|si)$') { Write-Info 'Abbinamento annullato: nessuna modifica.'; return 1 }
      }
    }
  }
  $agentWasRunning = Test-ContainerUp
  if ($agentWasRunning) {
    Invoke-Compose stop $Container | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Err 'legacy_inventory_failed: non riesco a fermare gli agenti prima dell''inventario host.'
      return 1
    }
  }
  $inventory = Get-TelegramPairInventory $Role
  if ($agentWasRunning) {
    Invoke-Compose start $Container | Out-Null
    if ($inventory.Ok -and $LASTEXITCODE -ne 0) {
      Write-Err 'agent_restart_failed: inventario conservato, ma il team non e'' ripartito. Cosa fare: jht up'
      return 1
    }
  }
  if (-not $inventory.Ok) { return 1 }
  $status = ((& { $ErrorActionPreference = 'Continue'; & docker exec $telegramId jht-telegram-admin cutover status 2>$null }) -join "`n")
  $wasEnabled = $status -match '"enabled"\s*:\s*true'
  # Anche quando l'inventario non trova niente: un agente di una versione
  # precedente puo' aver tolto il token dalla config prima dell'aggiornamento.
  Write-Info 'Usa sempre un token appena generato in BotFather (/revoke sul bot, oppure un bot nuovo): un token gia'' esistente puo'' essere stato letto dagli agenti anche se oggi non compare in ~/.jht.'
  $code = Send-TelegramPairToken $Role $inventory.Digests
  if ($code -ne 0) { return $code }
  Invoke-TelegramLegacy remove $Role | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Err 'legacy_cleanup_failed: il token vecchio e'' ancora in ~/.jht; cutover negato.'
    return 1
  }
  return Complete-TelegramPair -WasEnabled $wasEnabled -AgentWasRunning $agentWasRunning
}

# Tutti i ruoli con un token legacy, in una seduta. Le copie legacy si tolgono
# solo quando tutti gli abbinamenti sono riusciti: nessun ruolo resta muto a
# meta' strada, e la storia delle impronte rifiuta comunque quei token.
function Invoke-TelegramPairAll {
  if ([Console]::IsInputRedirected) {
    Write-Err 'jht telegram pair --all e'' interattivo: per le automazioni abbina un ruolo alla volta.'
    return 2
  }
  $telegramId = Get-RunningComposeServiceId $TelegramContainer
  if (-not $telegramId) { Write-Err 'telegram_unavailable: esegui jht up'; return 1 }
  $remainingOut = @(& { $ErrorActionPreference = 'Continue'; Invoke-TelegramLegacy remaining 2>$null })
  $remainingCode = $LASTEXITCODE
  if ($remainingCode -eq 0) { Write-Info 'Nessun ruolo ha un token legacy: per un bot nuovo usa jht telegram pair <ruolo>.'; return 0 }
  if ($remainingCode -ne 1) { Write-Err 'legacy_inventory_failed: non riesco a leggere i token legacy in ~/.jht.'; return 1 }
  $roles = @(($remainingOut -join ' ') -split '\s+' | Where-Object { $_ -in @('assistente', 'capitano', 'mentor') })
  if ($roles.Count -eq 0) { Write-Err 'legacy_inventory_failed: ruoli legacy non riconosciuti.'; return 1 }
  Write-Info "Ruoli da abbinare in questa seduta: $($roles -join ' ')"
  $agentWasRunning = Test-ContainerUp
  if ($agentWasRunning) {
    Invoke-Compose stop $Container | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Err 'legacy_inventory_failed: non riesco a fermare gli agenti prima dell''inventario host.'
      return 1
    }
  }
  $digestsByRole = @{}
  foreach ($role in $roles) {
    $inventory = Get-TelegramPairInventory $role
    if (-not $inventory.Ok) {
      if ($agentWasRunning) { Invoke-Compose start $Container | Out-Null }
      return 1
    }
    $digestsByRole[$role] = $inventory.Digests
  }
  if ($agentWasRunning) {
    Invoke-Compose start $Container | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Err 'agent_restart_failed: inventario conservato, ma il team non e'' ripartito. Cosa fare: jht up'
      return 1
    }
  }
  $status = ((& { $ErrorActionPreference = 'Continue'; & docker exec $telegramId jht-telegram-admin cutover status 2>$null }) -join "`n")
  $wasEnabled = $status -match '"enabled"\s*:\s*true'
  $bots = ((& { $ErrorActionPreference = 'Continue'; & docker exec $telegramId jht-telegram-admin bots status 2>$null }) -join "`n")
  Write-Info 'Usa sempre un token appena generato in BotFather (/revoke sul bot, oppure un bot nuovo): un token gia'' esistente puo'' essere stato letto dagli agenti anche se oggi non compare in ~/.jht.'
  foreach ($role in $roles) {
    if ($bots -match ('"' + $role + '"\s*:\s*"present"')) {
      Write-Info "$role ha gia' un bot abbinato: tolgo solo la sua copia legacy."
      continue
    }
    $code = Send-TelegramPairToken $role $digestsByRole[$role]
    if ($code -ne 0) {
      Write-Err "Abbinamento di $role non riuscito: le copie legacy restano tutte. Rilancia jht telegram pair --all: i ruoli gia' abbinati non chiedono un altro token."
      return $code
    }
  }
  foreach ($role in $roles) {
    Invoke-TelegramLegacy remove $role | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Err "legacy_cleanup_failed: i token nuovi sono al sicuro, ma la copia legacy di $role e' ancora in ~/.jht; cutover negato."
      return 1
    }
  }
  return Complete-TelegramPair -WasEnabled $wasEnabled -AgentWasRunning $agentWasRunning
}

# The runtime owns the policy; the host only transports closed operations.
function Get-TelegramLifecyclePlan {
  param([string]$Phase, [string]$Action, [string]$Role)
  $steps = @(Invoke-ComposeAnswer '--profile' 'telegram' run '--rm' '--no-deps' '-T' '--entrypoint' '/usr/bin/python3' $TelegramContainer '-I' '/app/shared/telegram_service/lifecycle.py' $Phase $Action '--' $Role)
  if ($LASTEXITCODE -ne 0) { throw 'telegram_lifecycle_plan_failed' }
  return $steps
}

function Confirm-TelegramLifecycle {
  param([string]$Operation)
  $observed = @(& { $ErrorActionPreference = 'Continue'; & docker inspect --type container $TelegramContainer --format '{{.State.Running}}' 2>&1 })
  $code = $LASTEXITCODE
  $payload = [string]$code + "`n" + ($observed -join "`n")
  Invoke-ComposeAnswer -InputText $payload '--profile' 'telegram' run '--rm' '--no-deps' '-T' '--entrypoint' '/usr/bin/python3' $TelegramContainer '-I' '/app/shared/telegram_service/lifecycle.py' 'verify' $Operation | Out-Host
  return $LASTEXITCODE
}

function Invoke-TelegramLifecycleSteps {
  param([string[]]$Steps, [string]$Role)
  if (@($Steps | Where-Object { $_ -cnotin @('', 'start', 'stop', 'pair', 'remove', 'chat-id', 'status', 'not-configured') }).Count) { throw 'telegram_lifecycle_plan_invalid' }
  foreach ($step in $Steps) {
    switch -CaseSensitive ($step) {
      '' { continue }
      'start' {
        $brokerCode = Ensure-Broker
        if ($brokerCode -ne 0) { return $brokerCode }
        $startCode = Invoke-ComposeQuiet '--profile' 'telegram' 'up' '-d' $TelegramContainer
        if ($startCode -ne 0) { return $startCode }
        if ((Confirm-TelegramLifecycle 'start') -ne 0) { return 1 }
      }
      'stop' {
        # compose's own lines (Container jht-telegram Stopping, Stopped) stay out of sight; a stop that fails shows them, whole, on stderr
        $stopCode = Invoke-ComposeQuiet '--profile' 'telegram' 'stop' $TelegramContainer
        if ($stopCode -ne 0) { return $stopCode }
        if ((Confirm-TelegramLifecycle 'stop') -ne 0) { return 1 }
      }
      'pair' { $code = Invoke-TelegramPair $Role; if ($code -ne 0) { return $code } }
      'remove' { $code = Invoke-TelegramAdmin -AdminArgs @('bots', 'delete', $Role); if ($code -ne 0) { return $code } }
      'chat-id' { $code = Invoke-TelegramAdmin -AdminArgs @('bots', 'chat-id', $Role); if ($code -ne 0) { return $code } }
      'status' { $code = Invoke-TelegramAdmin -AdminArgs @('bots', 'status'); if ($code -ne 0) { return $code } }
      'not-configured' { Write-Host 'Telegram non attivo: Telegram non configurato.' }
      default { throw 'telegram_lifecycle_plan_invalid' }
    }
  }
  return 0
}

# Telegram keeps its whole state in the jht-telegram-state volume, which only the Telegram service (profile telegram)
# ever mounts: no volume, never configured. True only when the engine LISTED the project's volumes and that one is
# not among them; a listing that fails says nothing, and then the lifecycle runs as it always did.
function Test-TelegramStateVolumeAbsent {
  $project = Get-ComposeProjectName
  if (-not $project) { return $false }
  $ids = @(& { $ErrorActionPreference = 'Continue'; & docker volume ls -q --filter "label=com.docker.compose.project=$project" 2>$null })
  if ($LASTEXITCODE -ne 0) { return $false }
  return -not (@($ids | ForEach-Object { "$($_)".Trim() }) -contains "${project}_jht-telegram-state")
}

# Transport capability only; private configuration is interpreted in the runtime. `resume` (install, up, upgrade)
# leaves a never-configured Telegram alone: no run container, no volume.
function Invoke-AvailableTelegramLifecycle {
  param([string]$Action)
  if ((Get-Content -LiteralPath $ComposeFile -Raw) -notmatch '(?m)^  jht-telegram:') { return 0 }
  if ($Action -eq 'resume' -and (Test-TelegramStateVolumeAbsent)) { return 0 }
  return Invoke-TelegramLifecycle @($Action)
}

# Does the Telegram service hold a bot? Asked of the RUNNING service, read-only (an exec: no run container, no volume):
# $true = at least one bot, $false = none, $null = it cannot be told (the service is off, not attestable, another answer).
# The one place that says whether Telegram is configured: `jht status` and `jht integration` both ask it.
function Get-TelegramBotsConfigured {
  $id = Get-RunningComposeServiceId $TelegramContainer
  if (-not $id) { return $null }
  $out = ((& { $ErrorActionPreference = 'Continue'; & docker exec $id jht-telegram-admin bots status 2>$null }) -join "`n")
  if ($LASTEXITCODE -ne 0 -or $out -notmatch '"ok":\s*true') { return $null }
  return [bool]($out -match '"present"')
}

# The line `jht status` says about Telegram. A status command creates nothing and prints nothing of compose: no volume,
# no run container, only questions to the engine. «Never configured» (no state volume) and «no bot» are said in one line.
function Write-TelegramStatusLine {
  if ((Get-Content -LiteralPath $ComposeFile -Raw) -notmatch '(?m)^  jht-telegram:') { return 0 }
  if (Test-TelegramStateVolumeAbsent) { Write-Host 'Telegram non attivo: Telegram non configurato.'; return 0 }
  $configured = Get-TelegramBotsConfigured
  if ($null -eq $configured) {
    Write-Host 'Telegram: stato non verificabile adesso (servizio spento o non raggiungibile). Dettagli: jht telegram status'
    return 0
  }
  if (-not $configured) { Write-Host 'Telegram non attivo: Telegram non configurato.'; return 0 }
  return (Invoke-TelegramAdmin -AdminArgs @('bots', 'status'))
}

function Invoke-TelegramLifecycle {
  param([string[]]$TelegramArgs)
  $action = if ($TelegramArgs.Count -gt 0) { $TelegramArgs[0] } else { 'status' }
  $role = if ($TelegramArgs.Count -gt 1) { $TelegramArgs[1] } elseif ($action -eq 'setup') { 'assistente' } else { '' }
  try {
    $steps = @(Get-TelegramLifecyclePlan 'prepare' $action $role)
    $code = Invoke-TelegramLifecycleSteps $steps $role
    $cleanup = @(Get-TelegramLifecyclePlan 'complete' $action $role)
    $cleanupCode = Invoke-TelegramLifecycleSteps $cleanup $role
    if ($cleanupCode -ne 0) { return $cleanupCode }
    return $code
  } catch { Write-Err 'telegram_lifecycle_failed'; return 1 }
}

function Invoke-TelegramCommand {
  param([string[]]$TelegramArgs)
  $action = if ($TelegramArgs.Count -gt 0) { $TelegramArgs[0] } else { 'status' }
  $role = if ($TelegramArgs.Count -gt 1) { $TelegramArgs[1] } else { '' }
  switch ($action) {
    'status' { return Invoke-TelegramAdmin -AdminArgs @('bots', 'status') }
    'pair' { return Invoke-TelegramPair $role }
    'chat-id' {
      if ($role -notin @('assistente', 'capitano', 'mentor')) {
        Write-Err 'uso: jht telegram chat-id <assistente|capitano|mentor>'; return 2
      }
      return Invoke-TelegramAdmin -AdminArgs @('bots', 'chat-id', $role)
    }
    'remove' {
      if ($role -notin @('assistente', 'capitano', 'mentor')) {
        Write-Err 'uso: jht telegram remove <assistente|capitano|mentor>'; return 2
      }
      return Invoke-TelegramAdmin -AdminArgs @('bots', 'delete', $role)
    }
    default { Write-Err 'uso: jht telegram status|pair <ruolo>|pair --all|chat-id <ruolo>|remove <ruolo>'; return 2 }
  }
}

# I file vecchi in ~/.jht/credentials li legge legacy.py nel container jht e
# li passa al broker in una busta (sha256 + base64). Il broker li importa una
# volta sola; solo dopo il suo "ok" l'originale si cancella.
function Invoke-BrokerMigrateLegacy {
  $agentId = Get-RunningComposeServiceId 'jht'
  if (-not $agentId) { return 1 }
  $brokerId = Get-RunningComposeServiceId $BrokerContainer
  if (-not $brokerId) { return 1 }
  $migrated = $false
  $failed = $false
  foreach ($name in $LegacySecretNames) {
    & { $ErrorActionPreference = 'Continue'; & docker exec -u 1001 $agentId /usr/bin/python3 -I /app/shared/broker/legacy.py exists $name *> $null }
    if ($LASTEXITCODE -ne 0) { continue }
    $envelope = (& { $ErrorActionPreference = 'Continue'; & docker exec -u 1001 $agentId /usr/bin/python3 -I /app/shared/broker/legacy.py read $name 2>$null } | Select-Object -First 1)
    $answer = ''
    if ($envelope) { $answer = (Invoke-NativeWithStdin { $envelope | & { $ErrorActionPreference = 'Continue'; $input | & docker exec -i $brokerId jht-broker-admin secrets import-legacy $name 2>$null } }) -join '' }
    if ($answer -match '"ok": true' -and $answer -match '"state": "imported"') {
      & { $ErrorActionPreference = 'Continue'; & docker exec -u 1001 $agentId /usr/bin/python3 -I /app/shared/broker/legacy.py remove $name *> $null }
      if ($LASTEXITCODE -ne 0) { Write-Warn "legacy_remove_failed: $name e' nel broker ma la copia in ~/.jht/credentials e' rimasta." }
      $migrated = $true
    } elseif ($answer -match '"ok": true' -and $answer -match '"state": "already_migrated"') {
      & { $ErrorActionPreference = 'Continue'; & docker exec -u 1001 $agentId /usr/bin/python3 -I /app/shared/broker/legacy.py remove $name *> $null }
      Write-Warn "legacy_secret_reappeared: ~/.jht/credentials/$name.json e' ricomparso dopo la migrazione; rimosso senza importarlo."
    } else {
      Write-Warn "legacy_migration_failed: $name resta in ~/.jht/credentials."
      $failed = $true
    }
  }
  if ($migrated) {
    Write-Warn 'La casella di posta ora sta nel broker dei segreti. La sua password era leggibile dagli agenti:'
    Write-Warn 'genera una nuova password per app dal tuo provider e salvala con: jht mail setup'
    Write-Warn "Fino ad allora la posta si legge e si invia con la password di oggi; l'avviso resta in jht mail status."
  }
  if ($failed) { return 1 }
  return 0
}

function Invoke-BrokerMigrateLegacyOnce {
  if (-not ((Get-Content -LiteralPath $ComposeFile -Raw) -match "(?m)^  $([regex]::Escape($BrokerContainer)):")) { return 0 }
  if (Test-Path -LiteralPath $BrokerLegacyMarker) { return 0 }
  $code = Invoke-BrokerMigrateLegacy
  if ($code -eq 0) {
    New-Item -ItemType File -Path $BrokerLegacyMarker -Force -ErrorAction SilentlyContinue | Out-Null
  }
  # Come nel wrapper sh, un errore della migrazione non fa fallire `up`: il
  # marker resta assente e il tentativo verra' ripetuto al prossimo avvio.
  # Nemmeno il codice dei suoi comandi: `legacy.py exists` esce 1 quando un
  # segreto vecchio non c'e', il caso di ogni installazione nuova, e
  # $LASTEXITCODE resterebbe 1 per chi viene dopo (T89).
  $global:LASTEXITCODE = 0
  return 0
}

# One field of the box's cloud.json, read by node inside the container. The script goes on stdin
# (`node -`): Windows PowerShell 5.1 strips the double quotes of an argument handed to a native
# program, so `node -e '...require("fs")...'` reached node as `require(fs)`, a syntax error, and
# its stderr stopped the script (T106). The native call runs in a block of its own with 'Continue'
# because, under 'Stop', 5.1 turns any stderr line into an error even with 2>$null.
function Get-AgentCloudField {
  param([Parameter(Mandatory)][string]$AgentId, [Parameter(Mandatory)][ValidateSet('token', 'user_id')][string]$Field)
  $script = if ($Field -eq 'token') {
    @'
const fs=require('fs');try{const c=JSON.parse(fs.readFileSync('/jht_home/cloud.json','utf8'));if(typeof c.token==='string')process.stdout.write(c.token)}catch{}
'@
  } else {
    @'
const fs=require('fs');try{const c=JSON.parse(fs.readFileSync('/jht_home/cloud.json','utf8'));if(typeof c.user_id==='string'&&/^[0-9a-f-]{36}$/i.test(c.user_id))process.stdout.write(c.user_id)}catch{}
'@
  }
  # The script goes to node's stdin without a BOM (Invoke-NativeWithStdin).
  return ((Invoke-NativeWithStdin { & { $ErrorActionPreference = 'Continue'; $script | & docker exec -i -u 1001 $AgentId node - 2>$null } }) -join '')
}

# First pairing may take user_id from cloud.json in the box, a box-writable
# file.  This is a bootstrap residual only: once the broker has an account,
# normal starts refresh its token but never replace that account automatically;
# replacement requires the explicit host command `jht apply relink-account`.
function Initialize-BrokerWebAuthorisations {
  $agentId = Get-RunningComposeServiceId 'jht'
  $brokerId = Get-RunningComposeServiceId $BrokerContainer
  if (-not $agentId -or -not $brokerId) { return }
  # Under 'Stop' Windows PowerShell 5.1 turns a native program's stderr line into an error that stops
  # the script even with 2>$null (T106: the first `jht up` of a standard-user install ended there),
  # so each of these native calls runs in a block of its own with 'Continue'.
  $state = ((& { $ErrorActionPreference = 'Continue'; & docker exec $brokerId jht-broker-admin apply web-status 2>$null }) -join "`n")
  $token = Get-AgentCloudField -AgentId $agentId -Field 'token'
  if ($token) { $null = Invoke-BrokerAdmin -InputText $token -AdminArgs @('apply', 'web-token') }
  if ($state -match '"account_id": null') {
    $account = Get-AgentCloudField -AgentId $agentId -Field 'user_id'
    # -AdminArgs by name: the first positional word would bind to InputText and be piped as stdin
    if ($account) { $null = Invoke-BrokerAdmin -AdminArgs @('apply', 'account', $account) }
  }
}

function Reset-BrokerWebAccount {
  $agentId = Get-RunningComposeServiceId 'jht'
  if (-not $agentId) { Write-Err 'apply relink-account: container non attivo.'; return 1 }
  $account = Get-AgentCloudField -AgentId $agentId -Field 'user_id'
  if (-not $account) { Write-Err 'apply relink-account: cloud account non disponibile. Esegui prima jht cloud pair.'; return 1 }
  return Invoke-BrokerAdmin -AdminArgs @('apply', 'account', $account)
}

function Remove-BrokerResetData {
  $project = Get-ComposeProjectName
  if (-not $project) {
    Write-Err 'reset: non riesco a determinare il progetto Compose; i volumi del broker non sono stati toccati.'
    return 1
  }
  Invoke-Compose '--profile' 'telegram' '--profile' 'broker' '--profile' 'media' '--profile' 'playwright' '--profile' 'screen' '--profile' 'login' down
  if ($LASTEXITCODE -ne 0) {
    Write-Err 'reset: non riesco a fermare il runtime; i volumi del broker non sono stati toccati.'
    return 1
  }
  $failed = $false
  foreach ($logical in $BrokerVolumeNames) {
    if ($ContainerRuntime -eq 'podman') {
      # podman-compose 1.6 omette la label col nome logico del volume. La
      # label progetto piu' il nome esatto prodotto da Compose confinano la
      # cancellazione al solo volume richiesto.
      $ids = @(& { $ErrorActionPreference = 'Continue'; & docker volume ls -q `
        --filter "label=com.docker.compose.project=$project" 2>$null } |
        ForEach-Object { "$($_)".Trim() } |
        Where-Object { $_ -eq "${project}_${logical}" })
    } else {
      $ids = @(& { $ErrorActionPreference = 'Continue'; & docker volume ls -q `
        --filter "label=com.docker.compose.project=$project" `
        --filter "label=com.docker.compose.volume=$logical" 2>$null } |
        ForEach-Object { "$($_)".Trim() } | Where-Object { $_ })
    }
    if ($LASTEXITCODE -ne 0) {
      Write-Err "reset: ricerca del volume $logical non riuscita."
      $failed = $true
      continue
    }
    if ($ids.Count -eq 0) {
      Write-Info "Saltato (non trovato): volume broker $logical"
      continue
    }
    foreach ($id in $ids) {
      if ($id -notmatch '^[A-Za-z0-9_.-]+$') {
        Write-Err "reset: nome volume non valido per $logical; rimozione negata."
        $failed = $true
        continue
      }
      & { $ErrorActionPreference = 'Continue'; & docker volume rm $id *> $null }
      if ($LASTEXITCODE -eq 0) {
        Write-Info "Cancellato: volume broker $logical ($id)"
      } else {
        Write-Err "reset: impossibile cancellare il volume broker $logical ($id)."
        $failed = $true
      }
    }
  }
  if (Test-Path -LiteralPath $BrokerLegacyMarker) {
    try {
      Remove-Item -LiteralPath $BrokerLegacyMarker -Force -ErrorAction Stop
      Write-Info "Cancellato: marcatore migrazione broker $BrokerLegacyMarker"
    } catch {
      Write-Err "reset: impossibile cancellare il marcatore migrazione broker $BrokerLegacyMarker."
      $failed = $true
    }
  }
  if (Test-Path -LiteralPath $BrokerMadeMarker) {
    try { Remove-Item -LiteralPath $BrokerMadeMarker -Force -ErrorAction Stop } catch {
      Write-Err "reset: impossibile cancellare il marcatore del broker $BrokerMadeMarker."
      $failed = $true
    }
  }
  if (-not $failed) {
    Write-Warn 'I segreti e lo stato del broker sono stati cancellati: rifai i login dei portali e configura di nuovo la posta.'
    return 0
  }
  return 1
}

function Invoke-ResetCommand {
  param([string[]]$ResetArgs)
  Ensure-Up
  & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags `
    -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" `
    -e 'JHT_HOST_RESET_PROTOCOL=1' `
    $Container node $NodeEntry reset @ResetArgs }
  $code = $LASTEXITCODE
  if ($code -ne $HostResetConfirmedExit) { return $code }
  return (Remove-BrokerResetData)
}

$script:RuntimeVolumeManifestPython = @'
import hashlib,os,stat,sys
root=sys.argv[1]
root_stat=os.lstat(root)
entries=[("D",".",str(root_stat.st_uid)+":"+str(root_stat.st_gid)+":"+format(stat.S_IMODE(root_stat.st_mode),"o"),"")]
count=0
for base,dirs,files in os.walk(root,topdown=True,followlinks=False):
    dirs.sort(); files.sort()
    for name in list(dirs):
        path=os.path.join(base,name); mode=os.lstat(path).st_mode
        if not stat.S_ISDIR(mode): raise SystemExit(41)
        metadata=os.lstat(path)
        owner=str(metadata.st_uid)+":"+str(metadata.st_gid)+":"+format(stat.S_IMODE(mode),"o")
        entries.append(("D",os.path.relpath(path,root),owner,""))
    for name in files:
        path=os.path.join(base,name); mode=os.lstat(path).st_mode
        if not stat.S_ISREG(mode): raise SystemExit(42)
        digest=hashlib.sha256()
        with open(path,"rb") as stream:
            for block in iter(lambda:stream.read(1024*1024),b""): digest.update(block)
        metadata=os.lstat(path)
        owner=str(metadata.st_uid)+":"+str(metadata.st_gid)+":"+format(stat.S_IMODE(mode),"o")
        entries.append(("F",os.path.relpath(path,root),owner,digest.hexdigest())); count+=1
aggregate=hashlib.sha256()
for kind,path,owner,digest in entries:
    aggregate.update(kind.encode()+b"\0"+path.encode("utf-8")+b"\0"+owner.encode()+b"\0"+digest.encode()+b"\0")
print(str(count)+" "+aggregate.hexdigest())
'@

function Write-RuntimeMigrationLeft {
  param([Collections.Generic.HashSet[string]]$Verified)
  foreach ($logical in $RuntimeMigrationVolumes) {
    if (-not $Verified.Contains($logical)) { [Console]::Out.WriteLine("JHT_LEFT $logical") }
  }
}

function Get-RuntimeMigrationPodmanArgs {
  param([string]$Machine, [object[]]$Arguments)
  return @('--connection', $Machine) + @($Arguments)
}

function Get-RuntimeMigrationVolumeId {
  param(
    [ValidateSet('docker', 'podman')][string]$Engine,
    [string]$DockerPath,
    [string]$PodmanPath,
    [string]$Machine,
    [string]$Project,
    [string]$Logical
  )
  $arguments = @('volume', 'ls', '-q', '--filter', "label=com.docker.compose.project=$Project", '--filter', "label=com.docker.compose.volume=$Logical")
  if ($Engine -eq 'docker') {
    $ids = @(& { $ErrorActionPreference = 'Continue'; & $DockerPath @arguments 2>$null })
  } else {
    $ids = @(& { $ErrorActionPreference = 'Continue'; & $PodmanPath @(Get-RuntimeMigrationPodmanArgs $Machine $arguments) 2>$null })
  }
  if ($LASTEXITCODE -ne 0) { throw "volume_list_failed:${Engine}:$Logical" }
  $ids = @($ids | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  if ($ids.Count -gt 1) { throw "volume_ambiguous:${Engine}:$Logical" }
  if ($ids.Count -eq 1) { return $ids[0] }
  return $null
}

function Get-RuntimeMigrationVolumeManifest {
  param(
    [ValidateSet('docker', 'podman')][string]$Engine,
    [string]$DockerPath,
    [string]$PodmanPath,
    [string]$Machine,
    [string]$Image,
    [string]$Volume
  )
  $arguments = @(
    'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--volume', "${Volume}:/volume:ro",
    '--interactive', '--entrypoint', '/usr/bin/python3', $Image, '-I', '-', '/volume'
  )
  # The script goes on stdin, never as an argument: Windows PowerShell 5.1 drops the double quotes
  # inside a native argument, and python then fails on it (T106).
  if ($Engine -eq 'docker') {
    $result = ((& { $ErrorActionPreference = 'Continue'; $script:RuntimeVolumeManifestPython | & $DockerPath @arguments 2>$null }) -join '').Trim()
  } else {
    $result = ((& { $ErrorActionPreference = 'Continue'; $script:RuntimeVolumeManifestPython | & $PodmanPath @(Get-RuntimeMigrationPodmanArgs $Machine $arguments) 2>$null }) -join '').Trim()
  }
  if ($LASTEXITCODE -ne 0 -or $result -notmatch '^\d+ [0-9a-f]{64}$') {
    throw "volume_manifest_failed:${Engine}:$Volume"
  }
  return $result
}

function Start-RuntimeMigrationProcess {
  param([string]$Path, [string[]]$Arguments, [bool]$Input, [bool]$Output)
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Path
  # Migration arguments are fixed tokens, canonical image references and
  # engine-generated volume ids; none may contain whitespace or quotes.
  foreach ($argument in $Arguments) {
    if ($argument -match '[\s"]') { throw 'unsafe_binary_pipe_argument' }
  }
  $start.Arguments = ($Arguments -join ' ')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $Input
  $start.RedirectStandardOutput = $Output
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  if (-not $process.Start()) { throw 'migration_process_start_failed' }
  return $process
}

function Copy-RuntimeMigrationVolume {
  param(
    [string]$DockerPath,
    [string]$PodmanPath,
    [string]$Machine,
    [string]$Image,
    [string]$Source,
    [string]$Target
  )
  $sourceArgs = @(
    'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--volume', "${Source}:/volume:ro",
    '--entrypoint', '/bin/tar', $Image, '-C', '/volume', '-cf', '-', '.'
  )
  $targetArgs = Get-RuntimeMigrationPodmanArgs $Machine @(
    'run', '--rm', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--volume', "${Target}:/volume",
    '--entrypoint', '/bin/tar', $Image, '-C', '/volume', '-xf', '-'
  )
  $targetProcess = $null
  $sourceProcess = $null
  try {
    $targetProcess = Start-RuntimeMigrationProcess $PodmanPath $targetArgs $true $false
    $sourceProcess = Start-RuntimeMigrationProcess $DockerPath $sourceArgs $false $true
    $sourceProcess.StandardOutput.BaseStream.CopyTo($targetProcess.StandardInput.BaseStream)
    $targetProcess.StandardInput.Close()
    $sourceProcess.WaitForExit()
    $targetProcess.WaitForExit()
    return ($sourceProcess.ExitCode -eq 0 -and $targetProcess.ExitCode -eq 0)
  } catch {
    return $false
  } finally {
    if ($targetProcess) { $targetProcess.Dispose() }
    if ($sourceProcess) { $sourceProcess.Dispose() }
  }
}

function Invoke-RuntimeMigrationPodman {
  param(
    [string]$DockerPath,
    [string]$PodmanPath,
    [string]$Machine,
    [string]$Image,
    [string]$MarkerPath = $RuntimeMigrationMarker
  )
  $verified = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  if (-not $DockerPath -or -not (Test-Path -LiteralPath $DockerPath -PathType Leaf)) {
    Write-Err 'runtime_migration_docker_missing: il client Docker originale non e'' disponibile.'
    Write-RuntimeMigrationLeft $verified; return 24
  }
  if (-not $PodmanPath -or -not (Test-Path -LiteralPath $PodmanPath -PathType Leaf)) {
    Write-Err 'runtime_migration_podman_missing: Podman non e'' disponibile.'
    Write-RuntimeMigrationLeft $verified; return 24
  }
  if ($Image -notmatch '^ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}$') {
    Write-Err 'runtime_migration_image_invalid: serve l''immagine JHT fissata per digest.'
    Write-RuntimeMigrationLeft $verified; return 24
  }
  & { $ErrorActionPreference = 'Continue'; & $DockerPath image inspect $Image *> $null }
  if ($LASTEXITCODE -ne 0) { Write-RuntimeMigrationLeft $verified; return 24 }
  & { $ErrorActionPreference = 'Continue'; & $PodmanPath @(Get-RuntimeMigrationPodmanArgs $Machine @('image', 'inspect', $Image)) *> $null }
  if ($LASTEXITCODE -ne 0) { Write-RuntimeMigrationLeft $verified; return 24 }
  $running = @(& { $ErrorActionPreference = 'Continue'; & $DockerPath ps -q --filter 'label=com.docker.compose.project=host-runtime' 2>$null })
  if ($LASTEXITCODE -ne 0 -or @($running | Where-Object { $_ }).Count -gt 0) {
    Write-Err 'runtime_migration_team_running: ferma prima il team Docker.'
    Write-RuntimeMigrationLeft $verified; return 24
  }
  $running = @(& { $ErrorActionPreference = 'Continue'; & $PodmanPath @(Get-RuntimeMigrationPodmanArgs $Machine @('ps', '-q', '--filter', 'label=com.docker.compose.project=jht')) 2>$null })
  if ($LASTEXITCODE -ne 0 -or @($running | Where-Object { $_ }).Count -gt 0) {
    Write-Err 'runtime_migration_team_running: ferma prima il team Podman.'
    Write-RuntimeMigrationLeft $verified; return 24
  }

  $completed = Test-Path -LiteralPath $MarkerPath -PathType Leaf
  $markerLines = if ($completed) { @(Get-Content -LiteralPath $MarkerPath) } else { @() }
  $records = [Collections.Generic.List[string]]::new()
  foreach ($logical in $RuntimeMigrationVolumes) {
    try {
      $source = Get-RuntimeMigrationVolumeId docker $DockerPath $PodmanPath $Machine host-runtime $logical
      $target = Get-RuntimeMigrationVolumeId podman $DockerPath $PodmanPath $Machine jht $logical
      if (-not $source) {
        if ($target) { throw "runtime_migration_source_missing:$logical" }
        if ($completed -and $markerLines -notcontains "$logical=absent") { throw "runtime_migration_changed:$logical" }
        $records.Add("$logical=absent")
        $null = $verified.Add($logical)
        continue
      }
      $sourceManifest = Get-RuntimeMigrationVolumeManifest docker $DockerPath $PodmanPath $Machine $Image $source
      if ($completed) {
        if (-not $target) { throw "runtime_migration_changed:$logical" }
        $targetManifest = Get-RuntimeMigrationVolumeManifest podman $DockerPath $PodmanPath $Machine $Image $target
        if ($sourceManifest -cne $targetManifest -or $markerLines -notcontains "$logical=$sourceManifest") {
          throw "runtime_migration_changed:$logical"
        }
        $null = $verified.Add($logical)
        continue
      }
      if ($target) {
        & { $ErrorActionPreference = 'Continue'; & $PodmanPath @(Get-RuntimeMigrationPodmanArgs $Machine @('volume', 'rm', '-f', $target)) *> $null }
        if ($LASTEXITCODE -ne 0) { throw "volume_remove_failed:$logical" }
      }
      $target = "jht_$logical"
      & { $ErrorActionPreference = 'Continue'; & $PodmanPath @(Get-RuntimeMigrationPodmanArgs $Machine @(
        'volume', 'create', '--label', 'com.docker.compose.project=jht',
        '--label', "com.docker.compose.volume=$logical", '--label',
        'io.podman.compose.project=jht', '--label',
        "io.podman.compose.volume=$logical", $target
      )) *> $null }
      if ($LASTEXITCODE -ne 0) { throw "volume_create_failed:$logical" }
      if (-not (Copy-RuntimeMigrationVolume $DockerPath $PodmanPath $Machine $Image $source $target)) {
        throw "runtime_migration_interrupted:$logical"
      }
      $targetManifest = Get-RuntimeMigrationVolumeManifest podman $DockerPath $PodmanPath $Machine $Image $target
      if ($sourceManifest -cne $targetManifest) { throw "runtime_migration_checksum_mismatch:$logical" }
      $records.Add("$logical=$sourceManifest")
      $null = $verified.Add($logical)
    } catch {
      Write-Err $_.Exception.Message
      Write-RuntimeMigrationLeft $verified
      return 24
    }
  }
  if (-not $completed) {
    $temp = "$MarkerPath.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
    try {
      $content = @('version=1', 'source=docker:host-runtime', 'target=podman:jht') + @($records)
      [IO.File]::WriteAllText($temp, (($content -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
      Move-Item -LiteralPath $temp -Destination $MarkerPath -Force
    } catch {
      Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
      Write-RuntimeMigrationLeft $verified
      return 24
    }
  }
  Write-Info 'Migrazione Docker -> Podman verificata. I volumi Docker restano intatti e contengono ancora le password della posta, gli accessi ai portali e i token di Telegram: richiedono una futura conferma esplicita per la rimozione.'
  return 0
}

# `jht mail setup --password-stdin --user U --dedicated|--not-dedicated`: the
# desktop's channel. No prompt; the password is the first line of stdin (never
# argv, a file or a log); stdout is one JSON line, the broker's or a fixed
# error (setup_argument_missing, secret_password_missing).
function Invoke-MailSetup {
  param([string[]]$MailArgs)
  $user = ''; $imapHost = ''; $smtpHost = ''; $dedicated = ''; $fromStdin = $false; $password = ''
  for ($i = 0; $i -lt $MailArgs.Count; $i++) {
    switch ($MailArgs[$i]) {
      '--user' { $user = $MailArgs[++$i] }
      '--imap-host' { $imapHost = $MailArgs[++$i] }
      '--smtp-host' { $smtpHost = $MailArgs[++$i] }
      '--dedicated' { $dedicated = 'yes' }
      '--not-dedicated' { $dedicated = 'no' }
      '--password-stdin' { $fromStdin = $true }
      default { Write-Err "mail setup: opzione sconosciuta $($MailArgs[$i])"; return 2 }
    }
  }
  if ($fromStdin) {
    if (-not $user -or -not $dedicated) {
      [Console]::Out.WriteLine('{"ok": false, "reason": "setup_argument_missing"}')
      return 2
    }
    $line = [Console]::In.ReadLine()
    $password = if ($null -eq $line) { '' } else { $line.TrimEnd("`r") }
    if (-not $password) {
      [Console]::Out.WriteLine('{"ok": false, "reason": "secret_password_missing"}')
      return 1
    }
  }
  if (-not $user) { $user = Read-Host 'Indirizzo della casella' }
  if (-not $dedicated) {
    $answer = Read-Host "E' una casella DEDICATA agli avvisi di lavoro inoltrati? [s/N]"
    $dedicated = if ($answer -match '^(s|si|y|yes)$') { 'yes' } else { 'no' }
  }
  $admission = if ($dedicated -eq 'yes') { 'whole_mailbox' } else { 'allowlist' }
  if (-not $fromStdin) {
    $secure = Read-Host 'Password per app (non viene mostrata)' -AsSecureString
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if (-not $password) { Write-Err 'mail setup: password vuota'; return 1 }
  }
  $adminArgs = @('mailbox', 'setup', '--user', $user, '--admission', $admission)
  if ($imapHost) { $adminArgs += @('--imap-host', $imapHost) }
  if ($smtpHost) { $adminArgs += @('--smtp-host', $smtpHost) }
  $made = Ensure-Broker
  if ($made -ne 0) { $password = $null; return $made }
  $code = Invoke-BrokerAdmin -InputText $password -AdminArgs $adminArgs
  $password = $null
  return $code
}

function Invoke-MailCommand {
  param([string[]]$MailArgs)
  $action = if ($MailArgs.Count -gt 0) { $MailArgs[0] } else { 'status' }
  $rest = if ($MailArgs.Count -gt 1) { $MailArgs[1..($MailArgs.Count - 1)] } else { @() }
  switch ($action) {
    'setup' { return Invoke-MailSetup $rest }
    'status' { $c = Invoke-BrokerAdmin -AdminArgs @('secrets', 'status'); if ($c -ne 0) { return $c }; return Invoke-BrokerAdmin -AdminArgs @('mailbox', 'show') }
    'admission' { return Invoke-BrokerAdmin -AdminArgs (@('mailbox', 'admission') + @($rest)) }
    'allow' { return Invoke-BrokerAdmin -AdminArgs (@('mailbox', 'allow') + @($rest)) }
    'drafts' { return Invoke-BrokerAdmin -AdminArgs @('mail', 'drafts') }
    { $_ -in @('approve', 'discard') } { return Invoke-BrokerAdmin -AdminArgs (@('mail', $action) + @($rest)) }
    'journal' { return Invoke-BrokerAdmin -AdminArgs (@('mail', 'journal') + @($rest)) }
    'delete' { return Invoke-BrokerAdmin -AdminArgs @('secrets', 'delete', 'email_monitor') }
    'migrate' {
      $code = Invoke-BrokerMigrateLegacy
      if ($code -eq 0) { New-Item -ItemType File -Path $BrokerLegacyMarker -Force -ErrorAction SilentlyContinue | Out-Null }
      return $code
    }
    default {
      Write-Err 'uso: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <indirizzo|@dominio>|drafts|approve <id>|discard <id>|journal|delete|migrate'
      return 2
    }
  }
}

function Ensure-Up {
  if (-not (Test-ContainerUp)) {
    if (Test-JhtTeamStoppedByPerson) { Write-Err (Get-JhtTeamStoppedText); exit 1 }
    Write-Info "Container '$Container' non attivo, lo avvio..."
    if (-not (Repair-MountOwnership)) { exit 1 }
    if (-not (Initialize-TelegramLegacyInventory)) {
      Write-Err 'legacy_inventory_failed: il team resta fermo perché l''inventario Telegram host non è stato conservato.'
      exit 1
    }
    # compose's own lines out of sight when it works, whole when it does not (as on `jht up`): the setup starts the team through here
    Stop-OnFailedComposeUp (Invoke-PodmanServicesUpInTurn)
    Stop-OnFailedComposeUp (Invoke-ComposeQuiet 'up' '-d')
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
    $telegramCode = Invoke-AvailableTelegramLifecycle 'resume'
    if ($telegramCode -ne 0) { exit $telegramCode }
  }
}

# `jht download`: scarica l'app desktop e la verifica SULL'HOST. Prima il download e lo SHA-256 stavano dentro il container, e i
# byte verificati venivano poi copiati sull'host con docker cp senza altra verifica (o lasciati in /jht_user/downloads, che gli
# agenti scrivono): un agente poteva far arrivare alla persona un installer diverso da quello verificato. Ora l'host prende da
# solo SHA256SUMS e l'installer dalla release (HTTPS), li tiene in una cartella privata fuori dai mount, confronta l'hash e
# pubblica il file solo dopo, verso una cartella che gli agenti non scrivono. Il container non entra piu' nel comando.
# JHT_RELEASE_BASE_URL e' la seam per mirror e test: viene dall'ambiente di chi lancia il comando, mai da host.env.
function Test-DownloadInsideShared {
  param([string]$Directory, [string[]]$Shared)
  # Una cartella e' "dentro" se lei o un suo antenato e' una cartella condivisa; un antenato che e' un link (giunzione o
  # collegamento simbolico) vale per quello che indica.
  $current = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
  for ($depth = 0; $current -and $depth -lt 64; $depth++) {
    foreach ($folder in $Shared) {
      $root = [IO.Path]::GetFullPath($folder).TrimEnd('\')
      if ($current -ieq $root) { return $true }
    }
    $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
    if ($item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -and $item.Target) {
      $target = @($item.Target)[0]
      if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path (Split-Path -Parent $current) $target }
      if (($depth -lt 8) -and (Test-DownloadInsideShared -Directory $target -Shared $Shared)) { return $true }
    }
    $parent = Split-Path -Parent $current
    if (-not $parent -or $parent -eq $current) { break }
    $current = $parent
  }
  return $false
}

# L'hash con .NET e non con Get-FileHash: il cmdlet viene dal modulo Microsoft.PowerShell.Utility, che un ambiente ridotto o un
# PSModulePath rotto puo' non far trovare, e la verifica non deve dipendere da un modulo.
function Get-DownloadSha256 {
  param([string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '') }
    finally { $sha.Dispose() }
  } finally { $stream.Dispose() }
}

function Invoke-HostDownload {
  param([string[]]$DownloadArgs)

  # Un numero restituito da una funzione PowerShell viaggia sullo stesso success stream di stdout: il codice di uscita vive in
  # un canale scalare dedicato e parte fail-closed; stdout/stderr restano liberi di arrivare al terminale.
  $script:HostDownloadExitCode = 1
  $usage = "usage: jht download --os windows|macos --version X.Y.Z [--output FILE]"
  $os = ''; $version = ''; $output = ''; $deb = $false
  for ($i = 0; $i -lt $DownloadArgs.Count; $i++) {
    $arg = $DownloadArgs[$i]
    if ($arg -eq '--help' -or $arg -eq '-h') { Write-Host $usage; $script:HostDownloadExitCode = 0; return }
    elseif ($arg -eq '--deb') { $deb = $true }
    elseif ($arg -in @('--os', '--version', '--output', '-o')) {
      if ($i + 1 -ge $DownloadArgs.Count -or -not $DownloadArgs[$i + 1]) { Write-Err "$arg needs a value"; $script:HostDownloadExitCode = 2; return }
      $i += 1
      if ($arg -eq '--os') { $os = $DownloadArgs[$i] } elseif ($arg -eq '--version') { $version = $DownloadArgs[$i] } else { $output = $DownloadArgs[$i] }
    }
    elseif ($arg.StartsWith('--os=')) { $os = $arg.Substring(5) }
    elseif ($arg.StartsWith('--version=')) { $version = $arg.Substring(10) }
    elseif ($arg.StartsWith('--output=')) { $output = $arg.Substring(9) }
    else { Write-Err "unknown argument: $arg"; Write-Host $usage; $script:HostDownloadExitCode = 2; return }
  }
  if (-not $os -or -not $version) { Write-Err '--os and --version are required'; Write-Host $usage; $script:HostDownloadExitCode = 2; return }

  $platform = switch ($os.ToLowerInvariant()) {
    { $_ -in @('win', 'win32', 'windows') } { 'windows' }
    { $_ -in @('darwin', 'mac', 'macos', 'osx') } { 'macos' }
    'linux' { 'linux' }
    default { $null }
  }
  if (-not $platform) { Write-Err "sistema non supportato: $os. Usa windows o macos."; $script:HostDownloadExitCode = 2; return }
  $version = $version -replace '^v', ''
  if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { Write-Err "versione non valida: $version. Esempio: 0.3.5."; $script:HostDownloadExitCode = 2; return }
  if ($deb -and $platform -ne 'linux') { Write-Err '--deb vale solo per Linux.'; $script:HostDownloadExitCode = 2; return }
  if ($platform -eq 'linux') {
    Write-Err 'In questa versione non c''e'' l''app desktop per Linux: usa install.sh. Non e'' stato scaricato niente.'
    $script:HostDownloadExitCode = 1
    return
  }
  $parts = $version.Split('-')[0].Split('.')
  if ($platform -eq 'windows' -and (([int]$parts[0] -gt 0) -or ([int]$parts[1] -ge 4))) {
    Write-Err 'Windows non fa parte della 0.4.0: la release non ha un installer per Windows. Non e'' stato scaricato niente.'
    $script:HostDownloadExitCode = 1
    return
  }
  # Le release 0.3.x hanno altri file (tar.gz, setup.exe, zip): l'app per macOS e' dalla 0.4.0.
  if ($platform -ne 'windows' -and [int]$parts[0] -eq 0 -and [int]$parts[1] -lt 4) {
    Write-Err "Questa release (v$version) non ha l'app per macOS: usa la 0.4.0 o successive. Non e' stato scaricato niente."
    $script:HostDownloadExitCode = 1
    return
  }
  if ($platform -eq 'macos' -and $env:JHT_DOWNLOAD_HOST -eq 'darwin-x64') {
    Write-Err 'L''app per macOS della 0.4 gira solo su Mac con Apple silicon (M1 e successivi); questo e'' un Mac Intel, non supportato nella 0.4. Non e'' stato scaricato niente.'
    $script:HostDownloadExitCode = 1
    return
  }
  $asset = if ($platform -eq 'windows') { 'job-hunter-team-windows-x64-setup.exe' }
           else { 'job-hunter-team-macos-universal.dmg' }

  # Destinazione: di base Downloads del profilo, mai una cartella condivisa con il team; un --output li' dentro si rifiuta.
  $destination = if ($output) { [IO.Path]::GetFullPath($output) } else { Join-Path (Join-Path $env:USERPROFILE 'Downloads') $asset }
  $parent = Split-Path -Parent $destination
  try { New-Item -ItemType Directory -Force -Path $parent -ErrorAction Stop | Out-Null }
  catch { Write-Err "impossibile creare la directory di destinazione: $parent"; return }
  $userData = if ($env:JHT_USER_DIR_HOST) { $env:JHT_USER_DIR_HOST } else { Join-Path $env:USERPROFILE 'Documents\Job Hunter Team' }
  $jhtHome = if ($env:JHT_HOME_HOST) { $env:JHT_HOME_HOST } else { Join-Path $env:USERPROFILE '.jht' }
  if (Test-DownloadInsideShared -Directory $parent -Shared @($jhtHome, $userData)) {
    Write-Err "la destinazione sta in una cartella condivisa con il team: scegline una fuori, come Downloads."
    return
  }
  $existing = Get-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
  if ($existing) {
    if (($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-Err "la destinazione e' un link: $destination"; return }
    if ($existing.PSIsContainer) { Write-Err "la destinazione esiste e non e' un file: $destination"; return }
  }

  $base = if ($env:JHT_RELEASE_BASE_URL) { $env:JHT_RELEASE_BASE_URL } else { 'https://github.com/leopu00/job-hunter-team/releases/download' }
  $base = $base.TrimEnd('/') + "/v$version"
  $seam = [bool]$env:JHT_RELEASE_BASE_URL
  $work = Join-Path ([IO.Path]::GetTempPath()) ('jht-download-' + [guid]::NewGuid().ToString('N'))
  $part = Join-Path $parent ('.' + (Split-Path -Leaf $destination) + '.part-' + [guid]::NewGuid().ToString('N'))
  $previousProgress = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
    New-Item -ItemType Directory -Path $work -ErrorAction Stop | Out-Null
    $fetch = {
      param($url, $file)
      $response = Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file -PassThru -UserAgent 'job-hunter-team-cli' -ErrorAction Stop
      # L'indirizzo finale dopo i reindirizzamenti: ResponseUri in Windows PowerShell 5.1, RequestMessage.RequestUri in PowerShell 7.
      $final = if ($response.BaseResponse.ResponseUri) { $response.BaseResponse.ResponseUri }
               elseif ($response.BaseResponse.RequestMessage) { $response.BaseResponse.RequestMessage.RequestUri }
               else { $null }
      if (-not $seam -and $final -and $final.Scheme -ne 'https') { throw "la release e' arrivata senza HTTPS: $url" }
    }
    try { & $fetch "$base/SHA256SUMS" (Join-Path $work 'SHA256SUMS') }
    catch { Write-Err "download non riuscito: SHA256SUMS di v$version ($($_.Exception.Message))"; return }
    $expected = ''
    foreach ($line in (Get-Content -LiteralPath (Join-Path $work 'SHA256SUMS'))) {
      if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$' -and $Matches[2] -ceq $asset) { $expected = $Matches[1].ToLowerInvariant(); break }
    }
    if (-not $expected) { Write-Err "SHA-256 dichiarato non trovato per $asset."; return }

    if ($existing) {
      if ((Get-DownloadSha256 -Path $destination) -eq $expected) {
        Write-Host ''
        Write-Host "  File gia' presente e verificato: $destination"
        Write-Host "  SHA-256 verificato: $expected"
        $script:HostDownloadExitCode = 0
        return
      }
      Write-Err "il file $destination esiste ma il suo SHA-256 non corrisponde: non e' stato sovrascritto."
      return
    }

    Write-Host "  Scarico $asset..."
    try { & $fetch "$base/$asset" (Join-Path $work 'asset') }
    catch { Write-Err "download non riuscito: $asset ($($_.Exception.Message))"; return }
    $actual = (Get-DownloadSha256 -Path (Join-Path $work 'asset'))
    if ($actual -ne $expected) { Write-Err "SHA-256 non valido per ${asset}: atteso $expected, ottenuto $actual."; return }

    # Pubblicazione: copia in un nome nuovo accanto alla destinazione e rinomina senza sostituire (File.Move a due
    # argomenti e' no-clobber anche su Windows PowerShell 5.1: se il target compare durante il download fallisce).
    [IO.File]::Copy((Join-Path $work 'asset'), $part, $false)
    [IO.File]::Move($part, $destination)
    Write-Host "  SHA-256 verificato: $actual"
    Write-Host "  Salvato in: $destination"
    $script:HostDownloadExitCode = 0
  } catch {
    Write-Err "download sull'host non riuscito: $($_.Exception.Message)"
  } finally {
    $ProgressPreference = $previousProgress
    if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }
    foreach ($name in 'SHA256SUMS', 'asset') { Remove-Item -LiteralPath (Join-Path $work $name) -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Force -ErrorAction SilentlyContinue }
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
  # imagePrune c'e' solo dopo un upgrade riuscito che ha provato a pulire.
  if ($script:UpgradePrune) { $result['imagePrune'] = $script:UpgradePrune }
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

# ── Disco quasi pieno: nessun upgrade ──────────────────────────────────────
# Come in jht-wrapper.sh (stessi numeri, stesso codice chiuso `disk_low`, stesso
# motivo): un upgrade scarica un'immagine e riscrive il runtime, e su un disco al
# limite muore a meta'. Si rifiuta PRIMA di scaricare qualunque cosa, anche per
# `--check` (che scarica l'immagine), quando lo spazio libero e' sotto il 3% E
# sotto 8 GiB: la percentuale da sola rifiutava un disco da 500 GiB con 14 GiB
# ancora liberi. La soglia di avviso (10% E 20 GiB) c'e' per parita' e qui non
# rifiuta niente. Sono le soglie di host_vitals.py, disk-guard.js e
# jht-wrapper.sh (tests/test_disk_guard.py le confronta come testo), qui in per
# mille e in KiB (come nel .sh).
#
# I confronti sono stretti ed esatti, in interi: «libero*1000 < permille*totale»
# e «libero < KiB*1024», senza dividere in virgola mobile.
#
# NON E' MAI STATO ESEGUITO: sul Mac che l'ha scritto non c'e' PowerShell, e il
# bundle NSIS verde non lo prova. I test lo leggono come testo. Il .sh ha in piu'
# `jht clean-images` (il recupero di spazio a disco pieno); qui non c'e' ancora.
#
# Si misura il volume della cartella dati. Il disco del motore (WSL/macchina
# Podman) sta dentro una VM che da qui non si legge: resta «sconosciuto» e non
# rifiuta niente. JHT_ENGINE_DISK_PATH forza un percorso da misurare.
$DiskWarnFreePermille = 100
$DiskWarnFreeKib = 20971520
$DiskBlockFreePermille = 30
$DiskBlockFreeKib = 8388608
$script:DiskLowFreeKib = 0

# KiB -> «GiB» a un decimale con la virgola italiana («8», «5,2»). Per DIFETTO: non si
# promette piu' spazio di quello che c'e'.
function Get-DiskGibText {
  param([long]$Kib)
  $tenths = [long][Math]::Floor([double]$Kib * 10 / 1048576)
  if (($tenths % 10) -eq 0) { return [string]($tenths / 10) }
  return ('{0},{1}' -f [long][Math]::Floor($tenths / 10), ($tenths % 10))
}

# Byte liberi e totali del volume che contiene $Path, oppure $null.
function Get-DiskFreeMeasure {
  param([string]$Path)
  try {
    if (-not $Path) { return $null }
    $root = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($Path))
    $drive = New-Object System.IO.DriveInfo($root)
    if (-not $drive.IsReady -or $drive.TotalSize -le 0) { return $null }
    return @{ Free = [long]$drive.AvailableFreeSpace; Total = [long]$drive.TotalSize }
  } catch { return $null }
}

# 'low' | 'warn' | 'ok': serve la percentuale E i byte.
function Get-DiskLevelOf {
  param([long]$Free, [long]$Total)
  if (($Free * 1000) -lt ([long]$DiskBlockFreePermille * $Total) -and $Free -lt ([long]$DiskBlockFreeKib * 1024)) { return 'low' }
  if (($Free * 1000) -lt ([long]$DiskWarnFreePermille * $Total) -and $Free -lt ([long]$DiskWarnFreeKib * 1024)) { return 'warn' }
  return 'ok'
}

# Il valore (per mille, per il messaggio) del primo volume misurato sotto la
# soglia (percentuale E byte), altrimenti $null.
function Get-DiskLowPermille {
  $volumes = @($JhtHome)
  if ($env:JHT_ENGINE_DISK_PATH) { $volumes += $env:JHT_ENGINE_DISK_PATH }
  foreach ($volume in $volumes) {
    $measure = Get-DiskFreeMeasure $volume
    if ($null -ne $measure -and (Get-DiskLevelOf $measure.Free $measure.Total) -eq 'low') {
      $script:DiskLowFreeKib = [long][Math]::Floor([double]$measure.Free / 1024)
      return [int][Math]::Floor([double]$measure.Free * 1000 / [double]$measure.Total)
    }
  }
  return $null
}

# ── Pulizia delle immagini JHT vecchie dopo un upgrade riuscito ────────────
# Come in jht-wrapper.sh (stesse regole, stessi motivi): si tiene SOLO la
# corrente e la precedente (l'ancora del rollback); solo repository JHT per
# nome esatto; mai un'immagine di un container, anche fermo; per ID, senza -f,
# mai prune; il rifiuto del motore si conta; JHT_KEEP_OLD_IMAGES=1 tiene tutto.
# Chiamata solo a upgrade riuscito, mai su check, fallimento o rollback.
$script:UpgradePrune = $null
$JhtImageRepositories = @('ghcr.io/leopu00/jht', 'jht', 'localhost/jht')

function Get-PlainImageId { param([string]$Id) return (([string]$Id).Trim() -replace '^sha256:', '') }

function New-UpgradePrune {
  param([string]$Skipped, [int]$Removed = 0, [long]$Freed = 0, [int]$Refused = 0, [int]$InUse = 0)
  return [ordered]@{ removed = $Removed; freedBytes = $Freed; refused = $Refused; inUse = $InUse; kept = @('current', 'previous'); skipped = $Skipped }
}

# ── Nucleo e immagine piena nell'upgrade (P7) ─────────────────────────────
# Come nel wrapper POSIX: un'installazione a livello `core` (file runtime-tier) gira sul nucleo, e l'immagine piena puo' essere gia'
# scaricata da `jht tools`. L'upgrade porta avanti il nucleo (il digest lo dice il wrapper candidato, non quello in uso) e, solo se
# la piena di oggi e' gia' qui, anche la piena; la pulizia delle vecchie le tiene tutte e due.
$script:UpgradeCoreRef = ''
$script:UpgradeFullRef = ''
$script:UpgradeFullKeep = ''

function Get-UpgradeCandidateConstant {
  param([string]$File, [string]$Name)
  $line = Select-String -LiteralPath $File -Pattern ('^\$' + $Name + " = '([^']*)'\s*$") | Select-Object -First 1
  if ($line) { return $line.Matches[0].Groups[1].Value }
  return $null
}

# $false se il rilascio non porta un nucleo leggibile o non lo porta piu': un'installazione a livello core non si trasforma a meta'
# di un upgrade (si reinstalla), e un digest malformato non si usa.
function Initialize-UpgradeTierPlan {
  param([string]$Wrapper)
  $script:UpgradeCoreRef = ''; $script:UpgradeFullRef = ''; $script:UpgradeFullKeep = ''
  if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return $true }
  $core = Get-UpgradeCandidateConstant $Wrapper 'CoreImageDigest'
  $full = Get-UpgradeCandidateConstant $Wrapper 'DefaultRuntimeImage'
  if ($core -cnotmatch '^sha256:[0-9a-f]{64}$' -or $full -cnotmatch '^ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}$') { return $false }
  $script:UpgradeCoreRef = "ghcr.io/leopu00/jht@$core"
  & { $ErrorActionPreference = 'Continue'; & docker image inspect $DefaultRuntimeImage *> $null }
  if ($LASTEXITCODE -eq 0) { $script:UpgradeFullRef = $full }
  return $true
}

# Dopo il commit: la piena nuova, se la vecchia era gia' qui. Non decide l'esito dell'upgrade: se non arriva, resta la vecchia e
# `jht tools` la riscarica da solo.
function Invoke-UpgradeFullPull {
  $script:UpgradeFullKeep = ''
  if (-not $script:UpgradeFullRef) { return }
  if ($script:UpgradeFullRef -eq $DefaultRuntimeImage) { $script:UpgradeFullKeep = $script:UpgradeFullRef; return }
  Write-UpgradeNote "Scarico l'immagine piena aggiornata..."
  & { $ErrorActionPreference = 'Continue'; & docker pull $script:UpgradeFullRef *> $null }
  if ($LASTEXITCODE -eq 0) { $script:UpgradeFullKeep = $script:UpgradeFullRef }
  else { Write-UpgradeNote "full_pull_failed: l'immagine piena nuova non e' arrivata, resta la vecchia. Cosa fare: jht tools pull" }
}

# L'ID (senza prefisso) della piena che un'installazione a livello core tiene; niente se non e' qui.
function Get-UpgradeTierKeepIds {
  if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return @() }
  $ref = if ($script:UpgradeFullKeep) { $script:UpgradeFullKeep } else { $DefaultRuntimeImage }
  $id = ((& { $ErrorActionPreference = 'Continue'; & docker image inspect --format '{{.Id}}' $ref 2>$null } | Select-Object -First 1) -as [string])
  if ($id -and $id.Trim()) { return @(Get-PlainImageId $id) }
  return @()
}

function Remove-OldJhtImages {
  param([string]$Current, [string]$Previous)
  $script:UpgradePrune = $null
  if ($env:JHT_KEEP_OLD_IMAGES -eq '1') {
    $script:UpgradePrune = New-UpgradePrune 'opt-out'
    Write-UpgradeNote 'Immagini JHT vecchie: tenute tutte (JHT_KEEP_OLD_IMAGES=1).'
    return
  }
  $currentId = Get-PlainImageId $Current
  $previousId = Get-PlainImageId $Previous
  $unknown = @('', 'none', 'sconosciuta', 'unknown')
  if ($unknown -contains $currentId) { $script:UpgradePrune = New-UpgradePrune 'current-unidentified'; return }
  if ($unknown -contains $previousId) { $script:UpgradePrune = New-UpgradePrune 'previous-unidentified'; return }
  # A livello core la piena gia' scaricata aspetta il passaggio: non e' una vecchia versione, si tiene.
  $keepIds = @($previousId) + @(Get-UpgradeTierKeepIds)
  # La corrente deve essere davvero quella del container che gira adesso.
  if ((Get-PlainImageId (Get-UpgradeImage)) -ne $currentId) { $script:UpgradePrune = New-UpgradePrune 'current-not-running'; return }
  # Immagini di TUTTI i container, anche fermi. Se non si leggono: niente.
  $containers = @(& { $ErrorActionPreference = 'Continue'; & docker container ls -a -q --no-trunc 2>$null })
  if ($LASTEXITCODE -ne 0) { $script:UpgradePrune = New-UpgradePrune 'containers-unreadable'; return }
  $inUse = @()
  if ($containers.Count -gt 0) {
    $used = @(& { $ErrorActionPreference = 'Continue'; & docker inspect --format '{{.Image}}' @containers 2>$null })
    if ($LASTEXITCODE -ne 0) { $script:UpgradePrune = New-UpgradePrune 'containers-unreadable'; return }
    $inUse = @($used | ForEach-Object { Get-PlainImageId $_ })
  }
  $listing = @(& { $ErrorActionPreference = 'Continue'; & docker image ls --no-trunc --format '{{.ID}} {{.Repository}}' 2>$null })
  if ($LASTEXITCODE -ne 0) { $script:UpgradePrune = New-UpgradePrune 'images-unreadable'; return }
  $removed = 0; $freed = [long]0; $refused = 0; $busy = 0; $seen = @{}
  foreach ($line in $listing) {
    $parts = ([string]$line).Trim() -split '\s+', 2
    if ($parts.Count -ne 2 -or $JhtImageRepositories -cnotcontains $parts[1]) { continue }
    $plain = Get-PlainImageId $parts[0]
    if ($plain -eq $currentId -or $keepIds -contains $plain -or $seen.ContainsKey($plain)) { continue }
    $seen[$plain] = $true
    if ($inUse -contains $plain) { $busy++; continue }
    $size = [long]0
    $sizeText = ((& { $ErrorActionPreference = 'Continue'; & docker image inspect --format '{{.Size}}' $parts[0] 2>$null } | Select-Object -First 1) -as [string])
    if ($sizeText -and $sizeText.Trim() -match '^\d+$') { $size = [long]$sizeText.Trim() }
    & { $ErrorActionPreference = 'Continue'; & docker image rm $parts[0] *> $null }
    if ($LASTEXITCODE -eq 0) { $removed++; $freed += $size } else { $refused++ }
  }
  $script:UpgradePrune = New-UpgradePrune '' $removed $freed $refused $busy
  $note = "Immagini JHT vecchie: rimosse $removed, liberati circa $([long]($freed / 1MB)) MB (dimensione nominale: i layer condivisi si liberano solo in parte), tenute: corrente, precedente."
  if ($busy -gt 0) { $note += " In uso da un container (tenute): $busy." }
  if ($refused -gt 0) { $note += " Rifiutate dal motore (tenute): $refused." }
  Write-UpgradeNote $note
}

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
  $all = @('compose', '-f', $File)
  if ($ContainerRuntime -eq 'podman') { $all += @('-f', $PodmanComposeFile) }
  $all += @('--project-directory', $RuntimeDir) + $ComposeArgs
  if ($script:UpgradeJson) { & { $ErrorActionPreference = 'Continue'; & docker @all *> $null } } else { & docker @all }
  return $LASTEXITCODE -eq 0
}

function Test-UpgradeDockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  & { $ErrorActionPreference = 'Continue'; & docker info *> $null }
  return $LASTEXITCODE -eq 0
}

# All the lines, then the first: after Select-Object -First 1 the exit code is not the native
# command's (-1 in Windows PowerShell 5.1, the previous command's in 7), see Get-RunningComposeServiceId.
function Get-UpgradeImage {
  $lines = @(& { $ErrorActionPreference = 'Continue'; & docker inspect $Container --format '{{.Image}}' 2>$null })
  if ($LASTEXITCODE -ne 0 -or -not $lines.Count) { return '' }
  return ([string]$lines[0]).Trim()
}

function Get-UpgradeVersion {
  $lines = @(& { $ErrorActionPreference = 'Continue'; & docker exec $Container node $NodeEntry --version 2>$null })
  if ($LASTEXITCODE -ne 0 -or -not $lines.Count) { return '' }
  return ([string]$lines[0]).Trim()
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
    if (Test-Path $Target) { [IO.File]::Replace($temp, $Target, [NullString]::Value) } else { [IO.File]::Move($temp, $Target) }
    return (Set-ProtectedRuntimeNodeOwner $Target)
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
    if (Test-Path $script:UpgradeJournal) { [IO.File]::Replace($temp, $script:UpgradeJournal, [NullString]::Value) } else { [IO.File]::Move($temp, $script:UpgradeJournal) }
    return (Set-ProtectedRuntimeNodeOwner $script:UpgradeJournal)
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
    & { $ErrorActionPreference = 'Continue'; & docker image inspect ([string]$journal.old_image) *> $null }
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
  if (Test-Path -LiteralPath $RuntimeImageFile -PathType Leaf) {
    Write-UpgradeResult $false $false 'preflight' 'pinned' 'none' 'pinned' 'none' $false 'Canale di test: si aggiorna reinstallando dalla build di test' $false
    return 1
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
    # Disco quasi pieno (< 3% E < 8 GiB liberi): nessun upgrade, nemmeno `--check`. PRIMA di
    # creare la stage o scaricare: il runtime in corso resta intatto. Codice chiuso
    # `disk_low`; la frase la mostra l'app dalla sua tabella codice->frase.
    $diskLow = Get-DiskLowPermille
    if ($null -ne $diskLow) {
      if (-not $script:UpgradeJson) { Write-Err "disk_low: Gli agenti richiedono almeno $(Get-DiskGibText $DiskBlockFreeKib) GiB di disco - disponibili: $(Get-DiskGibText $script:DiskLowFreeKib) GiB. Per liberare spazio svuota il Cestino ed elimina i file grandi che non ti servono e le immagini Docker inutilizzate, poi riprova: non e' stato scaricato ne' modificato niente." }
      Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'disk_low' $false
      return 1
    }
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
    if (-not (Initialize-UpgradeTierPlan $newWrapper)) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Il rilascio non porta un nucleo valido per questa installazione: reinstalla' $false; return 1 }
    # A livello core il nucleo candidato e' l'immagine di tutto l'upgrade (pull, avvio, verifica, broker), come per `up`.
    if ($script:UpgradeCoreRef) { $env:JHT_IMAGE = $script:UpgradeCoreRef }
    $script:UpgradeRollbackDir = Join-Path $RuntimeDir ('.upgrade-rollback-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + '-' + $PID)
    New-Item -ItemType Directory -Path $script:UpgradeRollbackDir -ErrorAction Stop | Out-Null
    Copy-Item -LiteralPath $ComposeFile -Destination (Join-Path $script:UpgradeRollbackDir 'docker-compose.yml')
    Copy-Item -LiteralPath $WrapperPath -Destination (Join-Path $script:UpgradeRollbackDir 'jht-wrapper.ps1')
    Copy-Item -LiteralPath $RuntimeManifest -Destination (Join-Path $script:UpgradeRollbackDir '.runtime-integrity')
    # the rollback is trusted only when the folder and its three files are the person's (Restore-UpgradePrevious): from an elevated process they are given to the person
    $rollbackOwned = Set-ProtectedRuntimeNodeOwner $script:UpgradeRollbackDir
    foreach ($snapshot in @('docker-compose.yml', 'jht-wrapper.ps1', '.runtime-integrity')) {
      if (-not (Set-ProtectedRuntimeNodeOwner (Join-Path $script:UpgradeRollbackDir $snapshot))) { $rollbackOwned = $false }
    }
    if (-not $rollbackOwned -or -not (Write-UpgradeJournal 'prepared' $oldImage $wasRunning)) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Impossibile preparare il rollback' $false; return 1 }
    Write-UpgradeNote 'Scarico l immagine piu recente...'
    if (-not (Invoke-UpgradeCompose $newCompose 'pull' $Container)) { Remove-UpgradeTransaction; Write-UpgradeResult $false $false 'pull' $oldVersion $oldImage $oldVersion $oldImage $false 'Download immagine non riuscito' $false; return 1 }
    $candidateFiles = @('-f', $newCompose)
    if ($ContainerRuntime -eq 'podman') { $candidateFiles += @('-f', $PodmanComposeFile) }
    $candidateRef = ((& { $ErrorActionPreference = 'Continue'; & docker compose @candidateFiles --project-directory $RuntimeDir config --images 2>$null } | Select-Object -First 1) -as [string]).Trim()
    if (-not $candidateRef) { $candidateRef = if ($env:JHT_IMAGE) { $env:JHT_IMAGE } else { $DefaultRuntimeImage } }
    $candidateImage = ((& { $ErrorActionPreference = 'Continue'; & docker image inspect $candidateRef --format '{{.Id}}' 2>$null } | Select-Object -First 1) -as [string]).Trim()
    if (-not $candidateImage) { $candidateImage = 'sconosciuta' }
    if (-not (Write-UpgradeJournal 'pulled' $oldImage $wasRunning)) { Write-UpgradeResult $false $false 'pull' $oldVersion $oldImage $oldVersion $oldImage $false 'Impossibile aggiornare il journal' $false; return 1 }
    if ($checkOnly) { Remove-UpgradeTransaction; $changed = ($candidateImage -ne $oldImage) -or $metadataChanged; Write-UpgradeResult $true $changed 'check' $oldVersion $oldImage $oldVersion $candidateImage $changed 'Controllo completato; nessuna modifica al runtime' $false; return 0 }
    Write-UpgradeNote 'Attivo il nuovo runtime...'
    if (-not (Repair-MountOwnership $candidateRef)) { Remove-UpgradeTransaction; Write-UpgradeResult $false $false 'mounts' $oldVersion $oldImage $oldVersion $oldImage $false 'Cartelle di Job Hunter Team non scrivibili dal container (mount_repair_failed)' $false; return 1 }
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
    # Il broker dei segreti (P1 del 08/10) usa la stessa immagine del team:
    # dopo il commit riparte con quella nuova. Non decide l'esito
    # dell'upgrade; se non parte, la posta resta chiusa finche' `jht up`.
    # Only if it is there (or was made once): an install that never used the mail does not get it from the upgrade.
    $brokerThere = (Test-Path -LiteralPath $BrokerMadeMarker) -or [bool](@(& { $ErrorActionPreference = 'Continue'; & docker ps -aq --filter "name=^$BrokerContainer$" 2>$null }) | Where-Object { $_ })
    if ($brokerThere -and (Get-Content -LiteralPath $ComposeFile -Raw) -match "(?m)^  $([regex]::Escape($BrokerContainer)):") {
      New-Item -ItemType File -Path $BrokerMadeMarker -Force -ErrorAction SilentlyContinue | Out-Null
      if (-not (Invoke-UpgradeCompose $ComposeFile '--profile' 'broker' 'up' '-d' '--force-recreate' '--no-deps' $BrokerContainer)) {
        Write-UpgradeNote "broker_restart_failed: il broker dei segreti non e' ripartito. Cosa fare: jht up"
      }
      $null = Invoke-BrokerMigrateLegacyOnce
    }
    if (-not (Install-RuntimeHelpers)) { Write-UpgradeNote "helper_install_failed: gli script host nuovi si prendono alla prima richiesta o con un altro 'jht upgrade'" }
    if ((Invoke-AvailableTelegramLifecycle 'resume') -ne 0) {
      Write-UpgradeNote "telegram_restart_failed: il servizio Telegram isolato non e' ripartito. Cosa fare: jht up"
    }
    # Solo qui: upgrade riuscito, container nuovo verificato e commit fatto.
    # Un errore della pulizia non deve mai far ripristinare un upgrade riuscito.
    try { Invoke-UpgradeFullPull } catch { $script:UpgradeFullKeep = '' }
    try { Remove-OldJhtImages $candidateImage $oldImage } catch { $script:UpgradePrune = $null }
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

# `jht setup --api-key-file <file on THIS computer>` (glm, kimi): the setup runs in the container, which cannot see a file of
# the host: a Windows path is not a path there, and ~/.jht (the one folder it sees) shows no file modes, so a key put there is
# refused at the first start. The wrapper reads the file HERE and hands the key to the setup on its standard input
# (--api-key-stdin), which keeps it in the container's own key store with the right modes: the key is never in an argument,
# in a log or in the config. A path that starts with «/» and is not a file of this computer is the container's own and goes
# through untouched.
# Returns @{ Args = the arguments to pass; Key = the key or $null; File = the host file it came from; Error = a sentence (never the key) or $null }.
function Convert-SetupKeyFileArgs {
  param([string[]]$SetupArgs)
  $plan = @{ Args = @($SetupArgs); Key = $null; Error = $null; File = $null }
  $out = New-Object 'System.Collections.Generic.List[string]'
  $hostFile = $null
  for ($i = 0; $i -lt $SetupArgs.Count; $i++) {
    $arg = $SetupArgs[$i]
    $value = $null
    $takesNext = $false
    if (($arg -ceq '--api-key-file') -and (($i + 1) -lt $SetupArgs.Count)) { $value = $SetupArgs[$i + 1]; $takesNext = $true }
    elseif ($arg.StartsWith('--api-key-file=', [System.StringComparison]::Ordinal)) { $value = $arg.Substring(15) }
    if (($null -eq $value) -or ($value.StartsWith('/') -and -not (Test-Path -LiteralPath $value))) { $out.Add($arg); continue }
    if ($null -ne $hostFile) { $plan.Error = '--api-key-file was given twice'; return $plan }
    $hostFile = $value
    if ($takesNext) { $i++ }
    $out.Add('--api-key-stdin')
  }
  if ($null -eq $hostFile) { return $plan }
  if (@($SetupArgs | Where-Object { $_ -ceq '--api-key-stdin' }).Count -gt 0) { $plan.Error = 'use --api-key-file or --api-key-stdin, not both'; return $plan }
  $item = $null
  try { $item = Get-Item -LiteralPath $hostFile -Force -ErrorAction Stop } catch { $plan.Error = "the file given to --api-key-file cannot be read: $hostFile"; return $plan }
  if ($item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { $plan.Error = "the file given to --api-key-file must be a regular file, not a folder or a link: $hostFile"; return $plan }
  if (($item.Length -lt 1) -or ($item.Length -gt 4096)) { $plan.Error = "the file given to --api-key-file is empty or too big for a key (1 to 4096 bytes): $hostFile"; return $plan }
  $bytes = $null
  try { $bytes = [System.IO.File]::ReadAllBytes($item.FullName) } catch { $plan.Error = "the file given to --api-key-file cannot be read: $hostFile"; return $plan }
  # A file written by `echo key > file` in Windows PowerShell 5.1 is UTF-16; Notepad may add a UTF-8 mark: both are read.
  if (($bytes.Length -ge 2) -and ($bytes[0] -eq 0xFF) -and ($bytes[1] -eq 0xFE)) { $text = [System.Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2) }
  elseif (($bytes.Length -ge 2) -and ($bytes[0] -eq 0xFE) -and ($bytes[1] -eq 0xFF)) { $text = [System.Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2) }
  elseif (($bytes.Length -ge 3) -and ($bytes[0] -eq 0xEF) -and ($bytes[1] -eq 0xBB) -and ($bytes[2] -eq 0xBF)) { $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3) }
  else { $text = [System.Text.Encoding]::UTF8.GetString($bytes) }
  $line = ([string](($text -split "\r?\n")[0])).Trim()
  if ($line -cnotmatch '^[\x21-\x7E]{16,512}$') { $plan.Error = "the content of the file given to --api-key-file is not one line of 16 to 512 printable characters without spaces: $hostFile"; return $plan }
  $plan.Args = $out.ToArray()
  $plan.Key = $line
  $plan.File = $item.FullName
  return $plan
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
[string[]]$Rest = if ($args.Count -gt 1) { @($args[1..($args.Count - 1)]) } else { @() }
# `--verbose` on `jht up` / `jht down` / `jht recreate` (or JHT_VERBOSE=1): compose's own lines as they come (see Invoke-ComposeQuiet).
$script:JhtComposeVerbose = (($Rest -ccontains '--verbose') -or ($env:JHT_VERBOSE -ceq '1'))

if ($Sub -ceq 'monitor' -and $Rest -ccontains '--window') {
  exit (Open-JhtMonitorWindow -CommandPath $PSCommandPath -WindowArgs $Rest)
}

# Questo gate deve precedere tutti i rami host-side: nel solo default non vede
# `up --help`, `setup --help`, ecc. e quei comandi toccherebbero Docker prima
# di accorgersi che l'utente ha chiesto soltanto aiuto.
$HelpRequested = @($Rest | Where-Object { $_ -in @('-h', '--help') }).Count -gt 0
# `agent-control` ne resta fuori: le sue forme sono chiuse e un `--help` fra i
# suoi argomenti e' una richiesta da rifiutare con il suo codice, non aiuto.
if ($HelpRequested -and $Sub -notin @('game', 'gui', 'agent-control', 'desktop-apply')) {
  if ($Sub -ceq 'integration' -and $Rest.Count -eq 1) {
    Write-IntegrationHelp
    exit 0
  }
  if ($Sub -ceq 'screen' -and $Rest.Count -eq 1) {
    Write-ScreenHelp
    exit 0
  }
  if ($Sub -ceq 'linkedin' -and $Rest.Count -eq 1) {
    Write-LinkedinHelp
    exit 0
  }
  if ($Sub -ceq 'setup') {
    Write-SetupHelp
    exit 0
  }
  if (Test-HostCommandUsesLocalHelp $Sub) {
    Write-LocalHelp
    exit 0
  }
  exit (Invoke-HelpWithoutDocker $Sub @Rest)
}

# ORDINE: si guarda COSA e' stato chiesto PRIMA di decidere se serve Docker.
# Il contrario - Ensure-Up in cima al default - faceva si' che un semplice
# `jht --help` scaricasse l'immagine (~300 MB) e creasse container e volumi,
# cioe' il primo comando di chi non ha ancora deciso se installare (P-07).
switch ($Sub) {
  { $_ -in @('-h', '--help', '') } {
    exit (Invoke-HelpWithoutDocker '--help')
  }

  # `jht help` is the LONG list: the short help sends the person to it, so it must not answer with the short one.
  'help' {
    # `jht help setup` is `jht setup --help`: the same text, not the long list (the setup runs in the container and a help starts nothing).
    if ($Rest.Count -eq 1 -and $Rest[0] -ceq 'setup') {
      Write-SetupHelp
      exit 0
    }
    exit (Invoke-HelpWithoutDocker 'help')
  }

  { $_ -in @('-V', '--version', 'version') } {
    if ((Test-DockerReachable) -and (Test-ContainerUp)) {
      & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry --version }
    } else {
      $ConfiguredVersion = if ($env:JHT_IMAGE_TAG) {
        $env:JHT_IMAGE_TAG
      } elseif ($env:JHT_IMAGE -and $env:JHT_IMAGE -match ':([^/:]+)$') {
        $Matches[1]
      } else {
        $DefaultRuntimeVersion
      }
      Write-Output $ConfiguredVersion
      Write-Info "Per la versione del CLI in esecuzione serve il container attivo: 'jht up'."
    }
    exit 0
  }
  'onboarding-snapshot' {
    Write-OnboardingSnapshot
    exit 0
  }
  'desktop-chat' {
    Invoke-DesktopChat $Rest
    exit $script:DesktopChatExitCode
  }
  'agent-control' {
    Invoke-AgentControl $Rest
    exit $script:AgentControlExitCode
  }
  # T217 bridge: the CLI decides which mounted file the host context names; the app remains the native reader when installed.
  { $_ -eq 'artifact' -and $Rest.Count -gt 0 -and $Rest[0] -eq 'upload' } {
    $uploader = Join-Path $LocalAppData 'Job Hunter Team\jht-desktop.exe'
    if (-not (Test-Path -LiteralPath $uploader -PathType Leaf)) {
      Require-ComposeFile; Require-Docker; Ensure-Up
      $target = Get-RunningComposeServiceId $Container
      if (-not $target) { Write-Err 'team_container_unavailable: avvia la squadra con jht up e riprova.'; exit 1 }
      $mounts = & docker inspect --type container $target --format '{{json .Mounts}}'
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      $context = @{ mounts = ($mounts -join "`n"); cwd = $PWD.Path } | ConvertTo-Json -Compress
      $context = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($context))
      & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags -e "JHT_ARTIFACT_HOST_CONTEXT=$context" $target node $NodeEntry $Sub @Rest }
      exit $LASTEXITCODE
    }
    $uploadArgs = if ($Rest.Count -gt 1) { @($Rest[1..($Rest.Count - 1)]) } else { @() }
    & $uploader '--artifact-upload' @uploadArgs | Out-Host
    exit $LASTEXITCODE
  }
  'desktop-apply' {
    Invoke-DesktopApply $Rest
    exit $script:DesktopApplyExitCode
  }
  # The Godot office and its commands are gone (0.4.0): said here, on the host, before anything would start the team for them.
  { $_ -in @('game', 'gui') } {
    if ((Get-JhtTextLanguage) -ceq 'en') { Write-Err "'jht $Sub' was removed in 0.4.0 with the Godot office: use the jht commands (jht help)." }
    else { Write-Err "'jht $Sub' e' stato tolto nella 0.4.0 insieme all'ufficio Godot: usa i comandi jht (jht help)." }
    exit 2
  }

  { $_ -in @('up', 'start-container') } {
    Require-ComposeFile
    Start-PodmanMachineForUp
    Require-Docker
    Clear-JhtTeamStopped
    if (-not (Repair-MountOwnership)) { exit 1 }
    if (-not (Initialize-TelegramLegacyInventory)) {
      Write-Err 'legacy_inventory_failed: il team resta fermo perché l''inventario Telegram host non è stato conservato.'
      exit 1
    }
    Stop-OnFailedComposeUp (Invoke-PodmanServicesUpInTurn)
    Stop-OnFailedComposeUp (Invoke-ComposeQuiet 'up' '-d')
    Write-JhtLifecycleDone 'up'
    $telegramCode = Invoke-AvailableTelegramLifecycle 'resume'
    if ($telegramCode -ne 0) { exit $telegramCode }
    Resume-Broker
    # The up went well (a failed one has already stopped jht with its code): 0, not the code of
    # whichever native ran last. The setup reads it (enable-podman-windows-runtime.ps1, T89).
    exit 0
  }

  { $_ -in @('down', 'stop-container') } {
    Require-ComposeFile
    Require-Docker
    Stop-JhtToolContainersFirst
    $downCode = Invoke-ComposeQuiet '--profile' 'telegram' '--profile' 'broker' '--profile' 'media' '--profile' 'playwright' '--profile' 'screen' '--profile' 'login' 'down'
    if ($downCode -eq 0) { Set-JhtTeamStopped; Write-JhtLifecycleDone 'down' }
    exit $downCode
  }

  'restart' {
    Require-ComposeFile
    Require-Docker
    # compose's lines (Container jht Restarting, Started) out of sight when it works, whole on stderr when it does not
    $restartCode = Invoke-ComposeQuiet 'restart' $Container
    if ($restartCode -ne 0) { exit $restartCode }
    Write-JhtLifecycleDone 'restart'
    break
  }

  'recreate' {
    Require-ComposeFile
    Require-Docker
    $null = Invoke-ComposeQuiet '--profile' 'telegram' '--profile' 'broker' '--profile' 'media' '--profile' 'playwright' '--profile' 'screen' '--profile' 'login' 'down'
    if (-not (Repair-MountOwnership)) { exit 1 }
    if (-not (Initialize-TelegramLegacyInventory)) {
      Write-Err 'legacy_inventory_failed: il team resta fermo perché l''inventario Telegram host non è stato conservato.'
      exit 1
    }
    Stop-OnFailedComposeUp (Invoke-PodmanServicesUpInTurn)
    Stop-OnFailedComposeUp (Invoke-ComposeQuiet 'up' '-d')
    Write-JhtLifecycleDone 'up'
    $telegramCode = Invoke-AvailableTelegramLifecycle 'resume'
    if ($telegramCode -ne 0) { exit $telegramCode }
    Resume-Broker
    # The up went well (a failed one has already stopped jht with its code): 0, not the code of
    # whichever native ran last. The setup reads it (enable-podman-windows-runtime.ps1, T89).
    exit 0
  }

  'upgrade' {
    $code = Invoke-RuntimeUpgrade $Rest
    exit $code
  }

  'mail' {
    Require-ComposeFile
    Require-Docker
    exit (Invoke-MailCommand $Rest)
  }

  'apply' {
    Require-ComposeFile
    Require-Docker
    Ensure-Up
    if ($Rest.Count -gt 0 -and $Rest[0] -eq 'relink-account') {
      if ($Rest.Count -ne 1) { Write-Err 'uso: jht apply relink-account'; exit 2 }
      exit (Reset-BrokerWebAccount)
    }
    if ($Rest.Count -ge 1 -and @('request', 'cancel') -ccontains [string]$Rest[0]) {
      exit (Invoke-ApplyHostCommand $Rest)
    }
    & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry $Sub @Rest }
    exit $LASTEXITCODE
  }

  'integration' {
    Require-ComposeFile
    if (-not (Test-RuntimeHelperDeclared 'jht-integration.ps1') -and (Write-RuntimeHelperAbsentAnswer 'integration' $Rest)) { exit 0 }
    # Dot-sourced here, at script level, so that its functions outlive this block. Older runtime: the helper is fetched once.
    $helperPath = Join-Path $RuntimeDir 'jht-integration.ps1'
    # A helper that is missing is fetched only when the person runs `add` or `remove`, never from a read-only command.
    if (-not (Test-RuntimeHelperDeclared 'jht-integration.ps1')) {
      $mayFetch = $Rest.Count -gt 0 -and (@('add', 'remove') -ccontains [string]$Rest[0])
      if (-not $mayFetch -or -not (Install-RuntimeHelpers)) {
        Write-Err "script jht-integration.ps1 non ancora installato: 'jht upgrade' (o un 'jht integration add/remove') e riprova"
        exit 1
      }
    }
    Assert-TrustedRuntime
    . $helperPath
    exit (Invoke-IntegrationCommand $Rest)
  }

  'screen' {
    # The live screen of the closer is the integration `screen`: on = add, off = remove, status = status.
    Require-ComposeFile
    $screenWord = if ($Rest.Count -gt 0) { [string]$Rest[0] } else { '' }
    $screenVerb = switch -CaseSensitive ($screenWord) { 'on' { 'add' } 'off' { 'remove' } 'status' { 'status' } default { '' } }
    if (-not $screenVerb) { Write-Err 'uso: jht screen on | off | status [--json]'; exit 2 }
    $screenArgs = @($screenVerb, 'screen') + @($Rest | Select-Object -Skip 1)
    if (-not (Test-RuntimeHelperDeclared 'jht-integration.ps1') -and $screenVerb -ceq 'status' -and (Write-RuntimeHelperAbsentAnswer 'integration' $screenArgs)) { exit 0 }
    $helperPath = Join-Path $RuntimeDir 'jht-integration.ps1'
    # Same as `integration`: a helper that is missing is fetched only for `on` and `off`, never from a read-only command.
    if (-not (Test-RuntimeHelperDeclared 'jht-integration.ps1')) {
      if (@('add', 'remove') -cnotcontains $screenVerb -or -not (Install-RuntimeHelpers)) {
        Write-Err "script jht-integration.ps1 non ancora installato: 'jht upgrade' (o un 'jht integration add/remove') e riprova"
        exit 1
      }
    }
    Assert-TrustedRuntime
    . $helperPath
    exit (Invoke-IntegrationCommand $screenArgs)
  }

  'linkedin' {
    # The manual sign-in to LinkedIn. The lines the app reads are the same with or without the helper: a read-only question or a stop
    # needs nothing to be installed, and only `login` fetches the helper if it is not there.
    Require-ComposeFile
    $linkedinWords = (@($Rest) -join ' ')
    if (-not (Test-RuntimeHelperDeclared 'jht-integration.ps1')) {
      if ($linkedinWords -ceq 'status --json') { [Console]::Out.WriteLine('{"ok": true, "view": "idle", "linkedin": "login_required"}'); exit 0 }
      if ($linkedinWords -ceq 'login --stop') { [Console]::Out.WriteLine('{"ok": true}'); exit 0 }
    }
    $helperPath = Join-Path $RuntimeDir 'jht-integration.ps1'
    if (-not (Test-RuntimeHelperDeclared 'jht-integration.ps1')) {
      if (-not (Install-RuntimeHelpers)) {
        Write-Err "script jht-integration.ps1 non ancora installato: 'jht upgrade' (o un 'jht integration add/remove') e riprova"
        exit 1
      }
    }
    Assert-TrustedRuntime
    . $helperPath
    exit (Invoke-LinkedinCommand @($Rest))
  }

  'tools' {
    Require-ComposeFile
    if (-not (Test-RuntimeHelperDeclared 'jht-tools.ps1') -and (Write-RuntimeHelperAbsentAnswer 'tools' $Rest)) { exit 0 }
    # Same as `integration`: dot-sourced at script level. A helper that is missing is never fetched from here: these commands run by
    # themselves after the install, and a download at the tip of the branch is not something to start without the person asking.
    if (-not (Test-RuntimeHelperDeclared 'jht-tools.ps1')) {
      Write-Err "script jht-tools.ps1 non ancora installato: 'jht upgrade' e riprova"
      exit 1
    }
    Assert-TrustedRuntime
    . (Join-Path $RuntimeDir 'jht-tools.ps1')
    exit (Invoke-ToolsCommand $Rest)
  }

  'telegram' {
    Require-ComposeFile
    Require-Docker
    exit (Invoke-TelegramLifecycle $Rest)
  }

  'reset' {
    Require-ComposeFile
    Require-Docker
    exit (Invoke-ResetCommand $Rest)
  }

  'migrate-runtime' {
    Require-ComposeFile
    if ($Rest.Count -ne 1 -or $Rest[0] -cne 'podman') {
      Write-Err 'uso: jht migrate-runtime podman'
      exit 2
    }
    $migrationImage = if ($env:JHT_MIGRATION_IMAGE) {
      $env:JHT_MIGRATION_IMAGE
    } elseif ($env:JHT_IMAGE) {
      $env:JHT_IMAGE
    } else {
      $DefaultRuntimeImage
    }
    exit (Invoke-RuntimeMigrationPodman `
      -DockerPath $MigrationDockerCommand -PodmanPath $MigrationPodmanCommand `
      -Machine $env:CONTAINER_CONNECTION -Image $migrationImage)
  }

  'logs' {
    Require-Docker
    & docker logs @Rest $Container
    break
  }

  'status' {
    # No options here (--json lives in the jht of the container): refused out loud, never ignored.
    if ($Rest.Count -gt 0) {
      $given = $Rest -join ' '
      if ((Get-JhtTextLanguage) -ceq 'en') { Write-Err "'jht status' takes no options ($given): run it as 'jht status'." }
      else { Write-Err "'jht status' non ha opzioni ($given): si lancia come 'jht status'." }
      exit 2
    }
    Require-Docker
    if (Test-ContainerUp) {
      & docker inspect $Container --format 'name={{.Name}} status={{.State.Status}} started={{.State.StartedAt}} image={{.Config.Image}}'
      if (-not [Console]::IsOutputRedirected) {
        $telegramCode = Write-TelegramStatusLine
        if ($telegramCode -ne 0) { exit $telegramCode }
      }
    } else {
      Write-Host "container '$Container' non attivo"
      exit 1
    }
    break
  }

  'shell' {
    Require-Docker
    Ensure-Up
    & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags $Container bash }
    break
  }

  # OAuth login: legge il provider attivo e avvia il suo flusso reale.
  { $_ -in @('oauth-login', 'claude-login') } {
    Require-ComposeFile
    Require-Docker
    Ensure-Up
    # `oauth-login --stop`: the app's «Cancel» of the sign-in. See jht-wrapper.sh: it ends the device login of Codex in the container, found by its command line, never the team's agents.
    if ($Rest.Count -gt 0 -and $Rest[0] -eq '--stop') {
      $StopScript = "const fs=require('fs');for(const d of fs.readdirSync('/proc')){if(!/^[0-9]+`$/.test(d)||Number(d)===process.pid)continue;try{const a=fs.readFileSync('/proc/'+d+'/cmdline','utf8').split('\0');if(a.includes('login')&&a.includes('--device-auth')&&a.some(function(x){return /codex/.test(x)}))process.kill(Number(d),'SIGTERM')}catch(e){}}"
      & { $ErrorActionPreference = 'Continue'; & docker exec $Container node -e $StopScript 2>$null | Out-Null }
      exit 0
    }
    $Provider = (& { $ErrorActionPreference = 'Continue'; & docker exec $Container node -e "try{const c=require('/jht_home/jht.config.json');process.stdout.write(String(c.active_provider||''))}catch{}" 2>$null })
    switch (($Provider | Out-String).Trim().ToLowerInvariant()) {
      { $_ -in @('openai', 'codex') } { & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags $Container bash -c '[ -f /app/.launcher/oauth-login-openai.sh ] && exec bash /app/.launcher/oauth-login-openai.sh; exec codex login --device-auth' }; break }
      { $_ -in @('kimi', 'moonshot') } { & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags $Container kimi --yolo }; break }
      { $_ -in @('claude', 'anthropic') } { & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags $Container claude --dangerously-skip-permissions }; break }
      '' { throw "nessun provider attivo: scegline uno con 'jht providers use openai'" }
      default { throw "provider attivo non riconosciuto: $Provider" }
    }
    break
  }

  # Setup: skip host-setup (non esiste su Windows), delega tutto al wizard
  # Node nel container che leggera' JHT_HOST_TYPE dall'env passato.
  'setup' {
    # --api-key-file of a file on this computer: the key goes to the setup on its standard input (Convert-SetupKeyFileArgs).
    $keyPlan = Convert-SetupKeyFileArgs $Rest
    if ($keyPlan.Error) { [Console]::Error.WriteLine("error: $($keyPlan.Error)"); exit 1 }
    Require-ComposeFile
    Require-Docker
    Clear-JhtTeamStopped
    Ensure-Up
    if ($null -ne $keyPlan.Key) {
      # -i only: a pipe is not a terminal. No byte-order mark goes in front of the key (Invoke-NativeWithStdin).
      try {
        [string[]]$setupArgs = $keyPlan.Args
        Invoke-NativeWithStdin { $keyPlan.Key | & docker exec -i -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry 'setup' @setupArgs }
        if ($LASTEXITCODE -eq 0) { Write-Host "The setup keeps the key: you can delete the file on this computer now ($($keyPlan.File))." }
      } finally {
        $keyPlan.Key = $null
      }
    } else {
      & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry 'setup' @Rest }
    }
    break
  }

  # Download e verifica SHA-256 sull'host (il container non c'entra): vedi Invoke-HostDownload.
  'download' {
    Invoke-HostDownload $Rest
    exit $script:HostDownloadExitCode
  }

  # Tutto il resto: delegato al CLI Node nel container.
  'doctor' {
    # A doctor never starts the team: with the container running it is the CLI's own; with it off, the checks this computer can make.
    Require-ComposeFile
    if ((Test-DockerReachable) -and (Test-ContainerUp)) {
      $hostFlags = @('-e', "JHT_HOST_TYPE=$env:JHT_HOST_TYPE")
      $wslAdvice = Get-JhtDoctorWslMemoryAdvice
      if ($wslAdvice) { $hostFlags += @('-e', "JHT_HOST_WSL_MEMORY_ADVICE=$wslAdvice") }
      & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags @hostFlags $Container node $NodeEntry $Sub @Rest }
      exit $LASTEXITCODE
    }
    exit (Invoke-JhtHostDoctor -Team 'off' -DoctorArgs $Rest)
  }

  default {
    Require-ComposeFile
    Require-Docker
    Ensure-Up
    $hostFlags = @('-e', "JHT_HOST_TYPE=$env:JHT_HOST_TYPE")
    & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags @hostFlags $Container node $NodeEntry $Sub @Rest }
    $code = $LASTEXITCODE
    if ($Sub -eq 'cloud' -and $Rest.Count -gt 0 -and $Rest[0] -eq 'pair' -and $code -eq 0) { if ((Ensure-Broker) -eq 0) { Initialize-BrokerWebAuthorisations } }
    exit $code
    break
  }
}

exit $LASTEXITCODE
