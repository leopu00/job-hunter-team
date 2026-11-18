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

# `uninstall` deve funzionare anche quando il runtime e' gia' parzialmente
# rimosso, quindi viene gestito prima di caricare manifest, helper ACL o shim.
# I target ricevuti dal dispatcher sono cartelle standard calcolate dalle API
# Windows, mai override d'ambiente o valori letti dal runtime da cancellare.
# The words of the uninstall for a person: Italian, and English in the language the person chose (see Get-JhtTextLanguage). The desktop app reads the JHT_PHASE and JHT_LEFT
# lines from a pipe; at a console the person gets the sentences instead (JHT_MACHINE_OUTPUT=1 forces the lines, =0 forbids them).
$script:JhtUninstallReason = ''
# The machine this uninstall removes: jht-podman, or the one the runtime attests (Resolve-JhtUninstallMachineName).
$script:JhtUninstallMachine = 'jht-podman'

# The language of the sentences the wrapper prints, by the rule of the CLI: the one the person chose with `jht setup --language`
# or the picker (saved in i18n-prefs.json next to host.env), then JHT_LANG as the person set it in this terminal, then the one in
# host.env (the installer writes the person's there), then the language of Windows, then English. The file is in a folder the
# container can write: it is read as DATA (not a link, a small file, the value one of the seven codes) and only chooses which text
# is printed. The seven languages of the product are written (en it hu es de fr pt): another one, or none, reads English. Returns one of the seven codes.
$script:JhtCallerLang = [string]$env:JHT_LANG
$script:JhtHostEnvLang = ''
function Get-JhtTextLanguage {
  $known = '^(en|it|hu|es|de|fr|pt)\z'
  # The first choice the person made decides: the saved one, then JHT_LANG of the terminal, then host.env. A choice of a language
  # the product does not have reads English; the language of Windows counts only when nothing was chosen at all.
  $chosen = ''
  try {
    # inside the try: a text must never fail because the folder of the choice cannot be worked out
    $hostEnv = if ($env:JHT_HOST_ENV_FILE) { $env:JHT_HOST_ENV_FILE } else { Join-Path $env:USERPROFILE '.jht\host.env' }
    $prefs = Join-Path (Split-Path -Parent $hostEnv) 'i18n-prefs.json'
    $item = Get-Item -LiteralPath $prefs -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $item.Length -le 4096) {
      $match = [regex]::Match(([IO.File]::ReadAllText($prefs) -replace '[\r\n]', ''), '"locale"\s*:\s*"([^"]{1,20})"')
      if ($match.Success) { $chosen = $match.Groups[1].Value }
    }
  } catch { $chosen = '' }
  # outside the wrapper's own start (a function loaded alone) nothing was saved aside: JHT_LANG is the person's
  $caller = if ($null -ne $script:JhtCallerLang) { $script:JhtCallerLang } else { [string]$env:JHT_LANG }
  if (-not $chosen) { $chosen = [string]$caller }
  if (-not $chosen) { $chosen = [string]$script:JhtHostEnvLang }
  if ($chosen) {
    if ($chosen -cmatch $known) { return $chosen }
    return 'en'
  }
  $code = ''
  try { $code = ([string][Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName).ToLowerInvariant() } catch { $code = '' }
  if ($code -cmatch $known) { return $code }
  return 'en'
}

# The sentences the wrapper says to a person, in the language the person chose (Get-JhtTextLanguage): `(Get-JhtText '<key>')`, or
# `(Format-JhtText '<key>' value...)` when the text has %s/%d (the values go in IN ORDER). The key is the catalog's (shared/locales,
# keys wrapper.*) without the prefix. The texts are a block made from the catalogs by tests/wrapper_ps_texts.py, written here because
# the wrapper runs on the host, where the catalogs are not, and reads no file the container can write. A language the block lacks
# reads English; a key it lacks says the key.
function Get-JhtText {
  param([Parameter(Mandatory)][string]$Key)
  $text = Get-JhtTextTable (Get-JhtTextLanguage) $Key
  if ($null -eq $text) { $text = Get-JhtTextTable 'en' $Key }
  if ($null -eq $text) { return $Key }
  return $text
}
function Format-JhtText {
  param([Parameter(Mandatory)][string]$Key, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Values)
  $text = Get-JhtText $Key
  $out = New-Object System.Text.StringBuilder
  $position = 0
  $index = 0
  foreach ($match in [regex]::Matches($text, '%[sd]')) {
    [void]$out.Append($text.Substring($position, $match.Index - $position))
    if ($index -lt @($Values).Count) { [void]$out.Append([string]@($Values)[$index]) }
    $index++
    $position = $match.Index + 2
  }
  [void]$out.Append($text.Substring($position))
  return $out.ToString()
}
# >>> texts in the 7 languages, made from shared/locales by `python3 tests/wrapper_ps_texts.py --write`: do not edit by hand
function Get-JhtTextTable {
  param([string]$Lang, [string]$Key)
  switch -CaseSensitive ("$Lang`:$Key") {
    'en:container.starting' { return 'Container ''%s'' is not running, starting it...' }
    'en:doctor.host_config_none' { return 'no configuration yet: ''jht setup''' }
    'en:doctor.host_config_ok' { return 'configuration present' }
    'en:doctor.host_engine_fail' { return 'container engine not reachable' }
    'en:doctor.host_engine_ok' { return 'container engine reachable' }
    'en:doctor.host_more' { return 'For the full checks (configuration, provider, database, agents): ''jht up'', then ''jht doctor''.' }
    'en:doctor.host_runtime_fail' { return 'JHT runtime missing or changed: ''jht upgrade'' installs it again' }
    'en:doctor.host_runtime_ok' { return 'JHT runtime intact' }
    'en:doctor.host_team_off' { return 'team off: ''jht up'' starts it' }
    'en:doctor.host_team_unattestable' { return 'a container of the team is there but cannot be verified as ours: nothing was touched (''jht status'' says more)' }
    'en:doctor.host_title' { return 'Job Hunter Team: the team is off (its container is not running). Checks made from this computer:' }
    'en:down.done' { return 'Job Hunter Team stopped.' }
    'en:download.bad_version' { return 'invalid version: %s. Example: 0.3.5.' }
    'en:download.deb_only_linux' { return '--deb is only for Linux.' }
    'en:download.dest_is_link' { return 'the destination is a link: %s' }
    'en:download.dest_not_file' { return 'the destination exists and is not a file: %s' }
    'en:download.fetching' { return 'Downloading %s...' }
    'en:download.hash_invalid' { return 'invalid SHA-256 for %s: expected %s, got %s.' }
    'en:download.intel_mac' { return 'The 0.4 macOS app only runs on Macs with Apple silicon (M1 and later); this is an Intel Mac, which 0.4 does not support. Nothing was downloaded.' }
    'en:download.linux_no_app' { return 'In this version there is no desktop app for Linux: use install.sh. Nothing was downloaded.' }
    'en:download.mismatch_existing' { return 'the file %s exists but its SHA-256 does not match: it was not overwritten.' }
    'en:download.mkdir_failed' { return 'cannot create the destination folder: %s' }
    'en:download.present_verified' { return 'File already present and verified: %s' }
    'en:download.release_no_app' { return 'This release (v%s) has no app for macOS: use 0.4.0 or later. Nothing was downloaded.' }
    'en:download.saved_in' { return 'Saved in: %s' }
    'en:download.sha_verified' { return 'SHA-256 verified: %s' }
    'en:download.sum_missing' { return 'no SHA-256 declared for %s.' }
    'en:download.unsupported_os' { return 'unsupported system: %s. Use windows or macos.' }
    'en:download.windows_missing' { return 'Windows is not part of 0.4.0: the release has no installer for Windows. Nothing was downloaded.' }
    'en:help.integration' { return (('Usage: jht integration <command>', '', '  list [--json]                   the integrations and their status', '  status [ID] [--json]            the status of one, or of all', '  add ID [--json]                 adds an integration', '  remove ID [--purge --yes] [--remove-image] [--json]', '                                  removes it; --purge also deletes its data (needs --yes);', '                                  --remove-image (screen and media only) also removes the tools image', '', 'The allowed IDs are the ones `jht integration list` shows. Nothing is downloaded or turned on', 'until you ask for it with `add`.') -join [char]10) }
    'en:help.linkedin' { return (('Usage: jht linkedin <command>', '', '  login [--stop]    the manual sign-in to LinkedIn (with Google): a browser in a separate container, with no network,', '                    whose window you see and use from the app; --stop closes everything', '  status --json     says whether the sign-in is in progress and whether the LinkedIn session is saved', '', 'Nothing is downloaded or turned on until you ask for it with `login`.') -join [char]10) }
    'en:help.screen' { return (('Usage: jht screen <command>', '', '  on [--json]       turns on the closer''s live screen: a separate container, with the stream only on 127.0.0.1', '  off [--remove-image] [--json]', '                    turns it off and removes the container; the tools image stays on disk, to turn it on again', '                    without downloading it again: --remove-image removes it and frees the space', '  status [--json]   says whether it is on', '', 'Nothing is downloaded or turned on until you ask for it with `on`. The stream is view-only.') -join [char]10) }
    'en:help.setup' { return (('Usage: jht setup [options]', '', 'Without options the guided installation starts. With --non-interactive it asks nothing:', 'you give everything with the options.', '', '  --non-interactive            no questions', '  --provider <name>            glm (Z.ai, default), kimi (Moonshot), openai or claude (Anthropic)', '  --harness <name>             pi (default)', '  --api-key-file <path>        file that contains the API key (one line, readable only by you).', '                               jht reads a file of your computer and passes it to setup: with glm and kimi', '                               setup keeps the key on its own, never in the configuration', '  --api-key-stdin              reads the API key from standard input (one line): never on the command line', '  --api-key <key>              the key written here, in clear text (not allowed for glm and kimi)', '  --secret-mode <mode>         how the key is saved: plaintext (default), env or file', '  --secret-env <name>          with --secret-mode env: the environment variable that contains it', '  --secret-file <path>         with --secret-mode file: the file that contains it', '  --model <model>              the model to use', '  --language <code>            the language (for example it or en)', '  --budget-usd <dollars>       the most the team may spend, in dollars (with one of --budget-minutes, --budget-days, --budget-until)', '  --budget-minutes <n>         the budget lasts this many minutes from now', '  --budget-days <n>            the budget lasts this many days from now', '  --budget-until <hour>        the budget lasts until this hour of the day, 0-23 (the next one)', '  --no-budget                  no spending limit (the team stops only at the credit of the provider)', '  --skip-health                skips the final check', '  --reset                      starts again from a clean configuration', '', 'Examples:', '  with a GLM key in a file:', '    jht setup --non-interactive --provider glm --harness pi --api-key-file key.txt', '  OpenAI with an API key, on Pi (for Claude: --provider claude):', '    jht setup --non-interactive --provider openai --harness pi --api-key-stdin') -join [char]10) }
    'en:help.tools' { return (('Usage: jht tools <command>', '', '  status --json   whether the Scouts'' tools (the full image) are here, on their way or failed', '  pull            downloads them in the background (jht up and jht setup start it by themselves)', '  switch          moves the team onto them once the onboarding is closed (the download does it by itself)', '', 'This help starts nothing and downloads nothing.') -join [char]10) }
    'en:host_setup.timezone_explain' { return 'The Captain uses it to convert times in Telegram messages and charts.' }
    'en:host_setup.timezone_header' { return 'User timezone' }
    'en:host_setup.timezone_label' { return 'Timezone' }
    'en:host_setup.timezone_vps_utc' { return 'Timezone was not detected: the team will use UTC. Set yours with jht wh --tz Europe/Rome (or in the dashboard), otherwise Telegram times and working hours will be in UTC.' }
    'en:host_setup.tz.bad_number' { return 'Choose a number between 1 and %d.' }
    'en:host_setup.tz.how' { return 'Type a country, a city or a timezone (for example Italy, Rome, Europe/Rome).' }
    'en:host_setup.tz.how_default' { return 'Press Enter to keep %s, or type a country, a city or a timezone to look for another one.' }
    'en:host_setup.tz.none' { return ('No timezone found for ' + [char]0x00AB + '%s' + [char]0x00BB + ': type the country (for example Italy) or a big city nearby.') }
    'en:host_setup.tz.not_detected' { return 'Your timezone was not detected.' }
    'en:host_setup.tz.pick' { return 'Number (1-%d), or a new search:' }
    'en:host_setup.tz.proposed' { return 'Proposed: %s (now %s).' }
    'en:host_setup.tz.saved_and_detected' { return ('Saved: %s (now %s) ' + [char]0x00B7 + ' Detected now: %s (now %s)') }
    'en:host_setup.tz.too_many' { return ('%d timezones match ' + [char]0x00AB + '%s' + [char]0x00BB + ': type something more precise (a city, for example).') }
    'en:keyfile.both' { return 'use --api-key-file or --api-key-stdin, not both' }
    'en:keyfile.not_file' { return 'the file given to --api-key-file must be a regular file, not a folder or a link: %s' }
    'en:keyfile.shape' { return 'the content of the file given to --api-key-file is not one line of 16 to 512 printable characters without spaces: %s' }
    'en:keyfile.size' { return 'the file given to --api-key-file is empty or too big for a key (1 to 4096 bytes): %s' }
    'en:keyfile.twice' { return '--api-key-file was given twice' }
    'en:keyfile.unreadable' { return 'the file given to --api-key-file cannot be read: %s' }
    'en:line.abbinamento_annullato_nessuna_modifica' { return 'Pairing cancelled: nothing changed.' }
    'en:line.abbinamento_di_s_non_riuscito' { return 'Pairing of %s failed: all the legacy copies stay. Run jht telegram pair --all again: the roles already paired do not ask for another token.' }
    'en:line.abbinamento_rifiutato_genera_un_token' { return 'Pairing refused: generate a new token in BotFather (/revoke) and try again.' }
    'en:line.agent_restart_failed.inventario_conservato_ma_il_team' { return 'inventory kept, but the team did not restart. What to do: jht up' }
    'en:line.annullato_niente_autorizzato' { return 'Cancelled: nothing authorized.' }
    'en:line.anteprima_non_valida_niente_autorizzato' { return 'Invalid preview: nothing authorized.' }
    'en:line.apply.authorize' { return 'Do you authorize this application?' }
    'en:line.apply_relink_account_cloud_account' { return 'apply relink-account: cloud account not available. Run jht cloud pair first.' }
    'en:line.autorizzata_s_verso_s_il' { return 'Authorized #%s, to %s: the CLOSER will pick it up on its next round.' }
    'en:line.bot_abbinato_e_copia_legacy' { return 'Bot paired and legacy copy removed. Other legacy tokens, or a token in the container environment, are still there: remove them and finish the rotation before the cutover.' }
    'en:line.bot_token_invalid.controlla_il_token_generato_da' { return 'check the token BotFather generated.' }
    'en:line.broker_restart_failed.il_servizio_della_posta_non_4' { return 'the mail service did not restart. What to do: jht mail status' }
    'en:line.broker_start_failed.il_servizio_della_posta_non_2' { return 'the mail service did not start.' }
    'en:line.broker_start_failed.il_servizio_della_posta_non_3' { return 'the mail service does not answer after 30 seconds.' }
    'en:line.broker_unavailable.il_broker_dei_segreti_esiste' { return 'the secrets broker exists but cannot be verified as ours: not touching it.' }
    'en:line.broker_unavailable.il_runtime_installato_pi_vecchio_2' { return 'the installed runtime is older and has no secrets broker.' }
    'en:line.broker_unavailable.il_servizio_della_posta_non' { return 'the mail service is not there yet: it is created the first time it is needed.' }
    'en:line.cancellato_marcatore_migrazione_broker_s' { return 'Deleted: broker migration marker %s' }
    'en:line.cancellato_volume_broker_s_s' { return 'Deleted: broker volume %s (%s)' }
    'en:line.container_s_non_e_partito' { return 'Container ''%s'' did not start within 10s. Check ''jht logs''.' }
    'en:line.cosa_fare_jht_mail_setup' { return 'What to do: jht mail setup' }
    'en:line.cosa_fare_jht_up_3' { return 'What to do: jht up' }
    'en:line.cosa_fare_jht_upgrade_4' { return 'What to do: jht upgrade' }
    'en:line.cosa_fare_riprova_il_comando_2' { return 'What to do: try the command again' }
    'en:line.fino_ad_allora_la_posta' { return 'Until then mail is read and sent with today''s password; the warning stays in jht mail status.' }
    'en:line.genera_una_nuova_password_per' { return 'generate a new app password from your provider and save it with: jht mail setup' }
    'en:line.i_segreti_e_lo_stato' { return 'The secrets and the broker state were deleted: log in to the portals again and set up mail again.' }
    'en:line.il_broker_non_ha_registrato' { return 'The broker did not record the authorization: withdrawn, nothing will be sent.' }
    'en:line.integration.install_hint' { return 'to install them: ''jht upgrade'' (or a ''jht integration add <id>'')' }
    'en:line.interattivo_il_token_viene_chiesto' { return 'Interactive: the token is asked without echo, then the new bot gets a one-time code from your Telegram. Automations: {"bot_token": ...} as JSON on stdin; do not save the token in ~/.jht, and delete right away any file used outside it.' }
    'en:line.jht_telegram_pair_all_interattivo' { return 'jht telegram pair --all is interactive: for automations, pair one role at a time.' }
    'en:line.job_hunter_team_non_installato' { return 'Job Hunter Team is not fully installed: the integrity file is missing from the runtime folder (an interrupted install?). Run the installer again.' }
    'en:line.la_casella_di_posta_ora' { return 'The mailbox is now in the secrets broker. Its password could be read by the agents:' }
    'en:line.legacy_cleanup_failed.i_token_nuovi_sono_al' { return 'the new tokens are safe, but the legacy copy of %s is still in ~/.jht; cutover refused.' }
    'en:line.legacy_inventory_failed.il_team_resta_fermo_perch_4' { return 'the team stays stopped because the host Telegram inventory was not kept.' }
    'en:line.legacy_inventory_failed.le_impronte_non_sono_state' { return 'the fingerprints were not kept by the isolated service.' }
    'en:line.legacy_inventory_failed.migrazione_telegram_interrotta' { return 'Telegram migration stopped.' }
    'en:line.legacy_inventory_failed.non_posso_provare_che_jht' { return 'cannot prove that ~/.jht has no Telegram tokens.' }
    'en:line.legacy_inventory_failed.non_riesco_a_fermare_gli' { return 'cannot stop the agents before the host inventory.' }
    'en:line.legacy_inventory_failed.non_riesco_a_leggere_i' { return 'cannot read the legacy tokens in ~/.jht.' }
    'en:line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti' { return 'legacy roles not recognized.' }
    'en:line.legacy_remove_failed.s_nel_broker_ma_la' { return '%s is in the broker but the copy in ~/.jht/credentials is still there.' }
    'en:line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso' { return '~/.jht/credentials/%s.json came back after the migration; removed without importing it.' }
    'en:line.mail.address_prompt' { return 'Mailbox address:' }
    'en:line.mail.app_password_prompt' { return 'App password (it is not shown):' }
    'en:line.mail.dedicated_prompt' { return 'Is it a mailbox DEDICATED to forwarded job alerts?' }
    'en:line.mail_setup_opzione_sconosciuta_s' { return 'mail setup: unknown option %s' }
    'en:line.mail_setup_password_vuota' { return 'mail setup: empty password' }
    'en:line.nessun_provider_attivo_scegline_uno' { return 'no active provider: choose one with ''jht providers use glm''' }
    'en:line.nessun_ruolo_ha_un_token' { return 'No role has a legacy token: for a new bot use jht telegram pair <role>.' }
    'en:line.non_autorizzabile_s' { return 'Cannot be authorized: %s.' }
    'en:line.non_autorizzata_s' { return 'Not authorized: %s.' }
    'en:line.os_and_version_are_required' { return '--os and --version are required' }
    'en:line.podman_non_trovato_reinstalla_il' { return 'Podman not found: reinstall the JHT runtime.' }
    'en:line.preparo_il_servizio_della_posta' { return ('Preparing the mail service (it is created only the first time it is needed)' + [char]0x2026) }
    'en:line.provider_attivo_non_riconosciuto_s' { return 'active provider not recognized: %s' }
    'en:line.reset_impossibile_cancellare_il_marcatore' { return 'reset: cannot delete the broker migration marker %s.' }
    'en:line.reset_impossibile_cancellare_il_marcatore_2' { return 'reset: cannot delete the broker marker %s.' }
    'en:line.reset_impossibile_cancellare_il_volume' { return 'reset: cannot delete the broker volume %s (%s).' }
    'en:line.reset_nome_volume_non_valido' { return 'reset: invalid volume name for %s; removal refused.' }
    'en:line.reset_non_riesco_a_determinare' { return 'reset: cannot find the Compose project; the broker volumes were not touched.' }
    'en:line.reset_non_riesco_a_fermare' { return 'reset: cannot stop the runtime; the broker volumes were not touched.' }
    'en:line.reset_ricerca_del_volume_s_2' { return 'reset: search for the volume %s failed.' }
    'en:line.restano_token_legacy_per_s' { return 'Legacy tokens are left for: %s. Until you pair these roles too, %s stays silent on Telegram: pair them all in this session (jht telegram pair --all).' }
    'en:line.risposta_del_container_non_valida' { return 'Invalid answer from the container: authorization withdrawn, nothing will be sent.' }
    'en:line.ritirata_s_non_verra_inviata' { return 'Withdrawn #%s: it will not be sent.' }
    'en:line.ritiro_non_riuscito_s' { return 'Withdrawal failed: %s.' }
    'en:line.runtime_migration_docker_missing.il_client_docker_originale_non' { return 'the original Docker client is not available.' }
    'en:line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata' { return 'the JHT image pinned by digest is needed.' }
    'en:line.runtime_migration_podman_missing.podman_non_e_disponibile' { return 'Podman is not available.' }
    'en:line.runtime_migration_team_running.ferma_prima_il_team_docker' { return 'stop the Docker team first.' }
    'en:line.runtime_migration_team_running.ferma_prima_il_team_podman' { return 'stop the Podman team first.' }
    'en:line.runtime_o_container_jht_non' { return 'JHT runtime or container not available' }
    'en:line.ruoli_da_abbinare_in_questa' { return 'Roles to pair in this session: %s' }
    'en:line.s_ha_gi_un_bot' { return '%s already has a paired bot: removing only its legacy copy.' }
    'en:line.s_needs_a_value' { return '%s needs a value' }
    'en:line.saltato_non_trovato_volume_broker' { return 'Skipped (not found): broker volume %s' }
    'en:line.serve_un_terminale_l_autorizzazione' { return 'A terminal is needed: the authorization is confirmed by hand.' }
    'en:line.telegram_isolato_attivo_il_bridge' { return 'Isolated Telegram is active; the agents can no longer turn the legacy bridge back on.' }
    'en:line.the_setup_keeps_the_key' { return 'The setup keeps the key: you can delete the file on this computer now (%s).' }
    'en:line.upgrade.done' { return 'Update completed: %s (%s) -> %s (%s). %s' }
    'en:line.upgrade.restored' { return 'Previous runtime restored.' }
    'en:line.uso_jht_apply_relink_account' { return 'usage: jht apply relink-account' }
    'en:line.uso_jht_apply_request_cancel_2' { return 'usage: jht apply request|cancel <id>' }
    'en:line.uso_jht_mail_setup_status' { return 'usage: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <indirizzo|@dominio>|drafts|approve <id>|discard <id>|journal|delete|migrate' }
    'en:line.uso_jht_migrate_runtime_podman' { return 'usage: jht migrate-runtime podman' }
    'en:line.uso_jht_screen_on_off' { return 'usage: jht screen on | off | status [--json]' }
    'en:line.uso_jht_telegram_chat_id' { return 'usage: jht telegram chat-id <assistente|capitano|mentor>' }
    'en:line.uso_jht_telegram_pair_assistente' { return 'usage: jht telegram pair <assistente|capitano|mentor>|--all' }
    'en:line.uso_jht_telegram_remove_assistente' { return 'usage: jht telegram remove <assistente|capitano|mentor>' }
    'en:line.uso_jht_telegram_status_pair' { return 'usage: jht telegram status|pair <ruolo>|pair --all|chat-id <ruolo>|remove <ruolo>' }
    'en:monitor.window_invalid' { return 'monitor_window_invalid: use ''jht monitor --window'' without other options.' }
    'en:ps.apply_auto_send_warning_1' { return '  With automatic sending on, the team fills in and SENDS the application,' }
    'en:ps.apply_auto_send_warning_2' { return '  without another confirmation. Once it has gone out it cannot be recalled.' }
    'en:ps.artifact_copied' { return 'Copied %s into %s so the team can read it.' }
    'en:ps.artifact_copy_failed' { return 'cannot copy %s into the shared folder: %s' }
    'en:ps.artifact_copy_refused' { return 'cannot copy %s: %s is a link, or is not inside the shared folder' }
    'en:ps.bot_token_prompt_hidden' { return 'Bot token for %s (hidden input)' }
    'en:ps.botfather_fresh_token' { return 'Always use a freshly generated token in BotFather (/revoke on the bot, or a new bot): an existing token may have been read by the agents even if it no longer appears in ~/.jht.' }
    'en:ps.broker_network_proxy_not_ready' { return 'broker_network_unavailable: the mail proxy is not ready (code %s).' }
    'en:ps.broker_network_scripts_not_downloadable' { return 'broker_network_unavailable: cannot download the mail proxy scripts. What to do: jht upgrade' }
    'en:ps.broker_network_scripts_not_verified' { return 'broker_network_unavailable: the mail proxy scripts cannot be verified. What to do: jht upgrade' }
    'en:ps.broker_restart_failed_secrets_broker_not_ours' { return 'broker_restart_failed: the secrets broker cannot be verified as ours: not touching it. What to do: jht mail status' }
    'en:ps.broker_unavailable_secrets_broker_not_running' { return 'broker_unavailable: the secrets broker is not running.' }
    'en:ps.cli_version_needs_container' { return 'The version of the running CLI needs the container running: ''jht up''.' }
    'en:ps.compose_up_failed_team_not_started' { return 'compose_up_failed: the team did not start (docker compose up, code %s). Check ''jht logs''.' }
    'en:ps.container_not_running' { return 'container ''%s'' is not running' }
    'en:ps.container_runtime_unsupported' { return 'unsupported container runtime: %s' }
    'en:ps.docker_desktop_file_sharing_hint' { return '  What to do: open Docker Desktop > Settings > Resources > File sharing, check that the user''s folder is shared, then run ''jht up'' again.' }
    'en:ps.docker_podman_verified_future_removal' { return 'Docker -> Podman migration verified. The Docker volumes stay intact and still hold the mail passwords, the portal logins and the Telegram tokens: removing them will require an explicit confirmation in the future.' }
    'en:ps.doctor.wsl_memory' { return 'WSL has no memory limit (other WSL distributions are registered): in %s, under [wsl2], add memory=%s' }
    'en:ps.download_asset_failed_detail' { return 'download failed: %s (%s)' }
    'en:ps.download_shared_folder_no_path' { return 'the destination is inside a folder shared with the team: choose one outside it, like Downloads.' }
    'en:ps.download_sums_failed_detail' { return 'download failed: SHA256SUMS of v%s (%s)' }
    'en:ps.full_pull_failed_keep_old' { return 'full_pull_failed: the new full image did not arrive, the old one stays. What to do: jht tools pull' }
    'en:ps.help.main' { return (('jht - Job Hunter Team', '', '  Host commands (they work from here):', '    jht up                 starts the team''s container', '    jht down               stops it', '                           (with --verbose you also see the engine''s lines)', '    jht restart            restarts it', '    jht status             status of the container and the team', '    jht logs [-f]          container log', '    jht upgrade            updates to the latest image', '    jht setup              guided installation', '    jht shell              shell inside the container', '    jht mail setup         saves the mailbox in the secrets broker', '    jht mail drafts        emails written by the agents, waiting for your ok', '    jht mail approve <id>  sends them; jht mail discard <id> discards them', '    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]', '                           the integrations you add after setup', '                           (google, telegram, mail): status read from the engine', '    jht telegram status    status of the isolated Telegram service', '    jht telegram pair ROLE asks for the token without echo on the host computer, then', '                           shows a code to send to the bot from your Telegram.', '                           For automation: JSON on stdin. Do not save the token', '                           in ~/.jht; delete right away any file used outside it.', '    jht telegram pair --all pairs all the legacy roles in one session', '    jht telegram chat-id ROLE moves the bot to another chat, with the same code', '    jht reset              deletes the broker''s configuration and volumes', '    jht migrate-runtime podman', '                           copies and checks the Docker volumes into Podman;', '                           it does not select the new runtime and does not delete Docker', '    jht uninstall --confirm removes the local Windows runtime, but keeps data,', '                           documents, Podman and Compose', '', '  All the other commands (positions, stats, team, providers, cron,', '  working-hours, cloud...) run INSIDE the container: for their help', '  the container must be running.', '', '      jht up ; jht --help') -join [char]10) }
    'en:ps.home_unavailable_bind_mount' { return 'HOME/USERPROFILE is not available: JHT bind mount refused' }
    'en:ps.host_download_failed' { return 'download on the host failed: %s' }
    'en:ps.input_not_json_bot_token_stdin' { return 'input_not_json: pass bot_token as JSON on stdin.' }
    'en:ps.integration_not_installed' { return 'not installed' }
    'en:ps.integration_not_installed_yet' { return 'not installed yet' }
    'en:ps.jht_container_not_verifiable' { return 'JHT container cannot be verified.' }
    'en:ps.jht_home_missing' { return 'Job Hunter Team is not installed yet: the folder %s does not exist. Run the installer, then ''jht setup''.' }
    'en:ps.legacy_cleanup_failed_old_token_still_there' { return 'legacy_cleanup_failed: the old token is still in ~/.jht; cutover refused.' }
    'en:ps.legacy_migration_failed_stays' { return 'legacy_migration_failed: %s stays in ~/.jht/credentials.' }
    'en:ps.lifecycle.restarted' { return 'Job Hunter Team restarted.' }
    'en:ps.link_or_not_folder' { return 'a link or not a folder' }
    'en:ps.localappdata_unavailable' { return 'LOCALAPPDATA is not available: host runtime refused' }
    'en:ps.machine_space_back_on_stop' { return 'About %s GB freed in the JHT machine come back to Windows when the machine stops: after jht down, with podman machine stop %s, or when the computer restarts.' }
    'en:ps.machine_space_not_returned' { return 'JHT takes about %s GB in its virtual disk; they are freed completely with jht uninstall.' }
    'en:ps.machine_state_unreadable' { return 'the state of the machine cannot be read (podman and wsl do not answer)' }
    'en:ps.monitor_window_unavailable' { return 'monitor_window_unavailable: cannot open a terminal window here. Run ''jht monitor'' in the current terminal.' }
    'en:ps.mount_repair_failed_folders_not_writable' { return 'mount_repair_failed: the Job Hunter Team folders (%s, %s) are not writable by the container and could not be fixed.' }
    'en:ps.old_images_busy' { return ' In use by a container (kept): %s.' }
    'en:ps.old_images_kept_all' { return 'Old JHT images: all kept (JHT_KEEP_OLD_IMAGES=1).' }
    'en:ps.old_images_refused' { return ' Rejected by the engine (kept): %s.' }
    'en:ps.old_images_removed' { return 'Old JHT images: removed %s, about %s MB freed (nominal size: shared layers are only partly freed), kept: current, previous.' }
    'en:ps.pair_role_now_prompt' { return 'Pair %s now? [s/N]' }
    'en:ps.podman_exe_not_found' { return 'podman.exe not found' }
    'en:ps.podman_machine_not_responding' { return 'The JHT Podman machine is not responding. Run ''jht up''.' }
    'en:ps.release_arrived_without_https' { return 'the release arrived without HTTPS: %s' }
    'en:ps.relink_account_container_not_running' { return 'apply relink-account: container not running.' }
    'en:ps.script_integration_not_installed' { return 'script jht-integration.ps1 is not installed yet: run ''jht upgrade'' (or a ''jht integration add/remove'') and try again' }
    'en:ps.script_tools_not_installed' { return 'script jht-tools.ps1 is not installed yet: run ''jht upgrade'' and try again' }
    'en:ps.startup_task_still_registered' { return 'the task is still registered' }
    'en:ps.team_container_unavailable' { return 'team_container_unavailable: start the team with jht up and try again.' }
    'en:ps.telegram_not_configured' { return 'Telegram not active: Telegram is not configured.' }
    'en:ps.telegram_status_unverifiable' { return 'Telegram: status cannot be verified right now (service stopped or unreachable). Details: jht telegram status' }
    'en:ps.telegram_unavailable_isolated_not_running' { return 'telegram_unavailable: the isolated Telegram service is not running.' }
    'en:ps.telegram_unavailable_run_jht_up' { return 'telegram_unavailable: run jht up' }
    'en:ps.uninstall.bad.target' { return 'Refused: {0} is a link or not a folder: it is not followed and not deleted.' }
    'en:ps.uninstall.done' { return 'Done: the <machine> machine (and with it the JHT images, the core and the full one), the runtime and the jht command are gone.' }
    'en:ps.uninstall.done.kept' { return ' ~/.jht and Documents\Job Hunter Team stay (--purge deletes them).' }
    'en:ps.uninstall.done.wsl' { return 'WSL stays in memory: vmmem, wslservice and wslrelay are parts of Windows (Job Hunter Team did not install them) and the other WSL machines of this user need them too; they normally stop by themselves after a while of inactivity. To stop them now: wsl --shutdown (it stops ALL the open WSL machines).' }
    'en:ps.uninstall.kept.machine' { return 'The Podman machine {0} is not marked as created by the installer: it stays where it is. By hand, if it is yours to remove: podman machine stop {0}; podman machine rm {0}.' }
    'en:ps.uninstall.left.commands' { return 'Not removed: the jht command or the installer files in {0} ({1}), or the variables and PATH lines the installer added. By hand: Remove-Item the file; the JHT_CONTAINER_RUNTIME and JHT_PODMAN_MACHINE variables and the {0} folder in the PATH from Settings > Environment variables.' }
    'en:ps.uninstall.left.data' { return 'The JHT data was not deleted ({0}). By hand: Remove-Item -Recurse -Force {1}. The jht command and the runtime are still there: run jht uninstall --confirm --purge again once it is sorted out.' }
    'en:ps.uninstall.left.machine' { return 'Not removed: the <machine> Podman machine. Reason: {0}. By hand: podman machine stop <machine>; wsl --unregister {1}; then run jht uninstall --confirm again.' }
    'en:ps.uninstall.left.runtime' { return 'Not removed: the JHT runtime in {0}. By hand: Remove-Item -Recurse -Force ''{0}''.' }
    'en:ps.uninstall.left.task' { return 'Not removed: the logon start task ''{0}'' (reason: {1}). Everything else was removed. By hand: schtasks /Delete /TN "{0}" /F.' }
    'en:ps.uninstall.phase.commands' { return 'Removing the jht command, the installer files and the PATH lines...' }
    'en:ps.uninstall.phase.data' { return 'Deleting ~/.jht and Documents\Job Hunter Team (--purge)...' }
    'en:ps.uninstall.phase.machine' { return 'Removing the <machine> Podman machine (with the secrets and the images of JHT)...' }
    'en:ps.uninstall.phase.runtime' { return 'Removing the JHT runtime...' }
    'en:ps.uninstall.purge_notice' { return 'With --purge ~/.jht and Documents\Job Hunter Team are deleted too: configuration, database, CVs and output. There is no way back.' }
    'en:ps.uninstall.purge_removal_notice' { return 'The saved mail password and Telegram tokens are deleted too.' }
    'en:ps.uninstall.removal_notice' { return 'The saved mail password and Telegram tokens are deleted too; ~/.jht and Documents stay, and with them the saved LinkedIn session (secrets/linkedin-profile and .cache/linkedin): remove it with jht reset --scope creds.' }
    'en:ps.uninstall.secrets' { return 'The saved secrets were not removed: the mail password and the Telegram tokens are in the jht-secrets and jht-telegram-secrets volumes of the <machine> machine, which is still there.' }
    'en:ps.uninstall.wslconfig.done' { return 'Removed from {0} the lines the installer added (WSL memory).' }
    'en:ps.uninstall.wslconfig.kept' { return 'Left in {0} the lines you changed: they are yours.' }
    'en:ps.uninstall.wslconfig.left' { return 'Not touched: {0} ({1}). The lines the installer added (WSL memory) stay. Remove them by hand: each has a comment line above it.' }
    'en:ps.unknown_argument' { return 'unknown argument: %s' }
    'en:ps.upgrade_already_running' { return 'An update is already in progress' }
    'en:ps.upgrade_broker_restart_failed' { return 'broker_restart_failed: the secrets broker did not restart. What to do: jht up' }
    'en:ps.upgrade_disk_low' { return ('disk_low: The agents need at least %s GiB of disk ' + [char]0x2014 + ' available: %s GiB. To free space, empty the Trash, delete the large files you do not need and the unused Docker images, then try again: nothing was downloaded or changed.') }
    'en:ps.upgrade_docker_unavailable' { return 'Docker or host runtime not available' }
    'en:ps.upgrade_helper_install_failed' { return 'helper_install_failed: the new host scripts are fetched on the first request or with another ''jht upgrade''' }
    'en:ps.upgrade_host_runtime_not_installable' { return 'Protected host runtime cannot be installed' }
    'en:ps.upgrade_host_runtime_untrusted' { return 'Host runtime cannot be trusted' }
    'en:ps.upgrade_image_download_failed' { return 'Image download failed' }
    'en:ps.upgrade_journal_not_updated' { return 'Cannot update the journal' }
    'en:ps.upgrade_metadata_not_persisted' { return 'Runtime metadata not persisted' }
    'en:ps.upgrade_mounts_not_writable' { return 'Job Hunter Team folders not writable from the container (mount_repair_failed)' }
    'en:ps.upgrade_not_completed' { return 'Update not completed (%s): %s' }
    'en:ps.upgrade_note_activate_runtime' { return 'Activating the new runtime...' }
    'en:ps.upgrade_note_download_image' { return 'Downloading the latest image...' }
    'en:ps.upgrade_note_download_runtime' { return 'Downloading the updated runtime...' }
    'en:ps.upgrade_option_unsupported' { return 'Unsupported upgrade option' }
    'en:ps.upgrade_pulling_full_image' { return 'Downloading the updated full image...' }
    'en:ps.upgrade_recovery_failed' { return 'Recovery of the previous upgrade failed' }
    'en:ps.upgrade_release_core_invalid' { return 'The release does not carry a valid core for this installation: reinstall' }
    'en:ps.upgrade_remote_compose_invalid' { return 'Remote compose invalid' }
    'en:ps.upgrade_remote_runtime_invalid' { return 'Remote runtime invalid or unreachable' }
    'en:ps.upgrade_rollback_not_prepared' { return 'Cannot prepare the rollback' }
    'en:ps.upgrade_telegram_restart_failed' { return 'telegram_restart_failed: the isolated Telegram service did not restart. What to do: jht up' }
    'en:ps.upgrade_test_channel' { return 'Test channel: update by reinstalling from the test build' }
    'en:ps.upgrade_unexpected_error' { return 'Unexpected error during the update' }
    'en:ps.upgrade_verify_failed' { return 'The new runtime did not pass verification' }
    'en:ps.use_fresh_botfather_token' { return 'Always use a token freshly generated in BotFather (/revoke on the bot, or a new bot): an existing token may have been read by the agents even if it does not show up in ~/.jht today.' }
    'en:ps.user_dir_unavailable_cannot_create' { return 'user_dir_unavailable: cannot create the folder %s, which the team uses.' }
    'en:ps.wsl_exe_not_found' { return 'wsl.exe not found' }
    'en:ps.wsl_not_answering' { return 'WSL does not answer (wsl --status)' }
    'en:removed.office' { return '''jht %s'' was removed in 0.4.0 with the Godot office: use the jht commands (jht help).' }
    'en:status.no_options' { return '''jht status'' takes no options (%s): run it as ''jht status''.' }
    'en:status.not_running' { return 'The team''s container is not running.' }
    'en:status.not_running_next' { return 'Start it with: jht up' }
    'en:team.stopped' { return 'Job Hunter Team is stopped: ''jht up'' starts it again.' }
    'en:tools.arriving' { return 'The Scouts'' tools are on their way: the full image is downloading in the background (about 3 GB). The search for positions starts by itself once they are here; there is nothing to do.' }
    'en:tools.chat_reconnecting' { return 'The team is moving onto the Scouts'' full tools, so the chat stops for a moment: it comes back by itself once the team is running again (a couple of minutes).' }
    'en:tools.chat_resumed' { return 'The team has moved onto the full tools: let''s pick up again.' }
    'en:tools.chat_switched' { return 'The team is moving onto the Scouts'' full tools, so this chat has closed. Open it again in a couple of minutes with jht team chat.' }
    'en:tools.chat_update_closed' { return 'JHT is updating, so this chat has closed. Open it again in a couple of minutes with jht team chat.' }
    'en:tools.chat_update_resumed' { return 'JHT is up to date: let''s pick up again.' }
    'en:tools.chat_updating' { return 'JHT is updating, so the chat stops for a moment: it comes back by itself in a minute or two.' }
    'en:tools.disk_low' { return 'The Scouts'' tools were not downloaded: they need about %s GiB free on the disk and there are %s GiB, so the team cannot search for positions yet. Free some space (empty the Trash, delete large files you do not need), then run jht up: the download starts again by itself.' }
    'en:tools.engine_down' { return 'The state of the Scouts'' tools cannot be read: the container engine does not answer. Start it with jht up.' }
    'en:tools.failed' { return 'The download of the Scouts'' tools failed, so the team cannot search for positions yet. Run jht tools pull to try again (jht up tries again too).' }
    'en:tools.ready' { return 'The Scouts'' tools are here: the team searches with the full image.' }
    'en:tools.switch_failed' { return 'The Scouts'' tools are here, but the team could not be restarted on them: run jht down, then jht up.' }
    'en:tools.switch_wait' { return 'The team is moving onto the Scouts'' full tools: waiting for it to start again (a couple of minutes at most).' }
    'en:tools.waiting' { return 'The Scouts'' tools are here: the team moves onto them by itself once the onboarding is closed.' }
    'en:uninstall.usage' { return 'usage: jht uninstall --confirm [--purge]' }
    'en:up.done' { return 'Job Hunter Team started.' }
    'it:container.starting' { return 'Container ''%s'' non attivo, lo avvio...' }
    'it:doctor.host_config_none' { return 'ancora nessuna configurazione: ''jht setup''' }
    'it:doctor.host_config_ok' { return 'configurazione presente' }
    'it:doctor.host_engine_fail' { return 'motore dei container non raggiungibile' }
    'it:doctor.host_engine_ok' { return 'motore dei container raggiungibile' }
    'it:doctor.host_more' { return 'Per i controlli completi (configurazione, provider, database, agenti): ''jht up'', poi ''jht doctor''.' }
    'it:doctor.host_runtime_fail' { return 'runtime JHT mancante o cambiato: ''jht upgrade'' lo reinstalla' }
    'it:doctor.host_runtime_ok' { return 'runtime JHT integro' }
    'it:doctor.host_team_off' { return 'squadra spenta: ''jht up'' la accende' }
    'it:doctor.host_team_unattestable' { return 'c''e'' un container della squadra ma non si puo'' verificare che sia nostro: non ho toccato niente (''jht status'' dice di piu'')' }
    'it:doctor.host_title' { return 'Job Hunter Team: squadra spenta (il suo container non gira). Controlli fatti da questo computer:' }
    'it:down.done' { return 'Job Hunter Team fermato.' }
    'it:download.bad_version' { return 'versione non valida: %s. Esempio: 0.3.5.' }
    'it:download.deb_only_linux' { return '--deb vale solo per Linux.' }
    'it:download.dest_is_link' { return 'la destinazione e'' un link: %s' }
    'it:download.dest_not_file' { return 'la destinazione esiste e non e'' un file: %s' }
    'it:download.fetching' { return 'Scarico %s...' }
    'it:download.hash_invalid' { return 'SHA-256 non valido per %s: atteso %s, ottenuto %s.' }
    'it:download.intel_mac' { return 'L''app per macOS della 0.4 gira solo su Mac con Apple silicon (M1 e successivi); questo e'' un Mac Intel, non supportato nella 0.4. Non e'' stato scaricato niente.' }
    'it:download.linux_no_app' { return 'In questa versione non c''e'' l''app desktop per Linux: usa install.sh. Non e'' stato scaricato niente.' }
    'it:download.mismatch_existing' { return 'il file %s esiste ma il suo SHA-256 non corrisponde: non e'' stato sovrascritto.' }
    'it:download.mkdir_failed' { return 'impossibile creare la directory di destinazione: %s' }
    'it:download.present_verified' { return 'File gia'' presente e verificato: %s' }
    'it:download.release_no_app' { return 'Questa release (v%s) non ha l''app per macOS: usa la 0.4.0 o successive. Non e'' stato scaricato niente.' }
    'it:download.saved_in' { return 'Salvato in: %s' }
    'it:download.sha_verified' { return 'SHA-256 verificato: %s' }
    'it:download.sum_missing' { return 'SHA-256 dichiarato non trovato per %s.' }
    'it:download.unsupported_os' { return 'sistema non supportato: %s. Usa windows o macos.' }
    'it:download.windows_missing' { return 'Windows non fa parte della 0.4.0: la release non ha un installer per Windows. Non e'' stato scaricato niente.' }
    'it:help.integration' { return (('Uso: jht integration <comando>', '', '  list [--json]                   le integrazioni e il loro stato', '  status [ID] [--json]            lo stato di una, o di tutte', '  add ID [--json]                 aggiunge un''integrazione', '  remove ID [--purge --yes] [--remove-image] [--json]', '                                  la toglie; --purge cancella anche i suoi dati (serve --yes);', '                                  --remove-image (solo screen e media) toglie anche l''immagine degli strumenti', '', 'Gli ID ammessi sono quelli che mostra `jht integration list`. Niente si scarica o si accende', 'finche'' non lo chiedi con `add`.') -join [char]10) }
    'it:help.linkedin' { return (('Uso: jht linkedin <comando>', '', '  login [--stop]    l''accesso a mano a LinkedIn (con Google): un browser in un container a parte, senza rete, di cui vedi', '                    e usi la finestra dall''app; --stop chiude tutto', '  status --json     dice se l''accesso e'' in corso e se la sessione di LinkedIn e'' salvata', '', 'Niente si scarica o si accende finche'' non lo chiedi con `login`.') -join [char]10) }
    'it:help.screen' { return (('Uso: jht screen <comando>', '', '  on [--json]       accende lo schermo dal vivo del closer: un container a parte, con lo stream solo su 127.0.0.1', '  off [--remove-image] [--json]', '                    lo spegne e toglie il container; l''immagine degli strumenti resta sul disco, per riaccenderlo', '                    senza riscaricarla: --remove-image la toglie e libera lo spazio', '  status [--json]   dice se e'' acceso', '', 'Niente si scarica o si accende finche'' non lo chiedi con `on`. Lo stream e'' in sola visione.') -join [char]10) }
    'it:help.setup' { return (('Uso: jht setup [opzioni]', '', 'Senza opzioni parte l''installazione guidata. Con --non-interactive non chiede niente:', 'tutto si da'' con le opzioni.', '', '  --non-interactive            nessuna domanda', '  --provider <nome>            glm (Z.ai, predefinito), kimi (Moonshot), openai o claude (Anthropic)', '  --harness <nome>             pi (predefinito)', '  --api-key-file <percorso>    file che contiene la chiave API (una riga, leggibile solo da te).', '                               Un file del tuo computer lo legge jht e lo passa al setup: con glm e kimi', '                               il setup tiene la chiave per conto suo, mai nella configurazione', '  --api-key-stdin              legge la chiave API dallo standard input (una riga): mai sulla riga di comando', '  --api-key <chiave>           la chiave scritta qui, in chiaro (non ammessa per glm e kimi)', '  --secret-mode <modo>         come si salva la chiave: plaintext (predefinito), env o file', '  --secret-env <nome>          con --secret-mode env: la variabile d''ambiente che la contiene', '  --secret-file <percorso>     con --secret-mode file: il file che la contiene', '  --model <modello>            il modello da usare', '  --language <codice>          la lingua (per esempio it o en)', '  --budget-usd <dollari>       quanto puo'' spendere il team, in dollari (con una fra --budget-minutes, --budget-days, --budget-until)', '  --budget-minutes <n>         il budget dura questi minuti da ora', '  --budget-days <n>            il budget dura questi giorni da ora', '  --budget-until <ora>         il budget dura fino a questa ora del giorno, 0-23 (la prossima)', '  --no-budget                  nessun limite di spesa (il team si ferma solo al credito del provider)', '  --skip-health                salta il controllo finale', '  --reset                      riparte da una configurazione pulita', '', 'Esempi:', '  con una chiave GLM in un file:', '    jht setup --non-interactive --provider glm --harness pi --api-key-file chiave.txt', '  OpenAI con una chiave API, su Pi (per Claude: --provider claude):', '    jht setup --non-interactive --provider openai --harness pi --api-key-stdin') -join [char]10) }
    'it:help.tools' { return (('Uso: jht tools <comando>', '', '  status --json   se gli strumenti degli Scout (l''immagine piena) sono arrivati, in arrivo o falliti', '  pull            li scarica in background (jht up e jht setup lo avviano da soli)', '  switch          ci porta la squadra quando l''onboarding e'' chiuso (il download lo fa da solo)', '', 'Questo aiuto non avvia niente e non scarica niente.') -join [char]10) }
    'it:host_setup.timezone_explain' { return 'Il Capitano lo usa per convertire gli orari nei messaggi Telegram e nei grafici.' }
    'it:host_setup.timezone_header' { return 'Fuso orario' }
    'it:host_setup.timezone_label' { return 'Fuso orario' }
    'it:host_setup.timezone_vps_utc' { return 'Il fuso orario non e'' stato rilevato: la squadra usera'' UTC. Imposta il tuo con jht wh --tz Europe/Rome (o nella dashboard), altrimenti gli orari di Telegram e di lavoro saranno in UTC.' }
    'it:host_setup.tz.bad_number' { return 'Scegli un numero fra 1 e %d.' }
    'it:host_setup.tz.how' { return ('Scrivi un paese, una citt' + [char]0x00E0 + ' o un fuso orario (per esempio Italia, Roma, Europe/Rome).') }
    'it:host_setup.tz.how_default' { return ('Premi Invio per tenere %s, oppure scrivi un paese, una citt' + [char]0x00E0 + ' o un fuso orario per cercarne un altro.') }
    'it:host_setup.tz.none' { return ('Nessun fuso orario per ' + [char]0x00AB + '%s' + [char]0x00BB + ': scrivi il paese (per esempio Italia) o una grande citt' + [char]0x00E0 + ' vicina.') }
    'it:host_setup.tz.not_detected' { return ('Il tuo fuso orario non ' + [char]0x00E8 + ' stato rilevato.') }
    'it:host_setup.tz.pick' { return 'Numero (1-%d), oppure una nuova ricerca:' }
    'it:host_setup.tz.proposed' { return 'Proposto: %s (ora %s).' }
    'it:host_setup.tz.saved_and_detected' { return ('Salvato: %s (ora %s) ' + [char]0x00B7 + ' Rilevato ora: %s (ora %s)') }
    'it:host_setup.tz.too_many' { return ('%d fusi orari corrispondono a ' + [char]0x00AB + '%s' + [char]0x00BB + ': scrivi qualcosa di pi' + [char]0x00F9 + ' preciso (una citt' + [char]0x00E0 + ', per esempio).') }
    'it:keyfile.both' { return 'usa --api-key-file o --api-key-stdin, non tutti e due' }
    'it:keyfile.not_file' { return 'il file dato a --api-key-file deve essere un file normale, non una cartella o un collegamento: %s' }
    'it:keyfile.shape' { return 'il contenuto del file dato a --api-key-file non e'' una riga da 16 a 512 caratteri stampabili senza spazi: %s' }
    'it:keyfile.size' { return 'il file dato a --api-key-file e'' vuoto o troppo grande per una chiave (da 1 a 4096 byte): %s' }
    'it:keyfile.twice' { return '--api-key-file e'' stato dato due volte' }
    'it:keyfile.unreadable' { return 'il file dato a --api-key-file non si puo'' leggere: %s' }
    'it:line.abbinamento_annullato_nessuna_modifica' { return 'Abbinamento annullato: nessuna modifica.' }
    'it:line.abbinamento_di_s_non_riuscito' { return ('Abbinamento di %s non riuscito: le copie legacy restano tutte. Rilancia jht telegram pair --all: i ruoli gi' + [char]0x00E0 + ' abbinati non chiedono un altro token.') }
    'it:line.abbinamento_rifiutato_genera_un_token' { return 'Abbinamento rifiutato: genera un token nuovo in BotFather (/revoke) e riprova.' }
    'it:line.agent_restart_failed.inventario_conservato_ma_il_team' { return ('inventario conservato, ma il team non ' + [char]0x00E8 + ' ripartito. Cosa fare: jht up') }
    'it:line.annullato_niente_autorizzato' { return 'Annullato: niente autorizzato.' }
    'it:line.anteprima_non_valida_niente_autorizzato' { return 'Anteprima non valida: niente autorizzato.' }
    'it:line.apply.authorize' { return 'Autorizzi questa candidatura?' }
    'it:line.apply_relink_account_cloud_account' { return 'apply relink-account: cloud account non disponibile. Esegui prima jht cloud pair.' }
    'it:line.autorizzata_s_verso_s_il' { return 'Autorizzata #%s, verso %s: il CLOSER la prendera'' al prossimo giro.' }
    'it:line.bot_abbinato_e_copia_legacy' { return 'Bot abbinato e copia legacy rimossa. Restano altri token legacy o un token nell''ambiente del container: rimuovili e completa la rotazione prima del cutover.' }
    'it:line.bot_token_invalid.controlla_il_token_generato_da' { return 'controlla il token generato da BotFather.' }
    'it:line.broker_restart_failed.il_servizio_della_posta_non_4' { return ('il servizio della posta non ' + [char]0x00E8 + ' ripartito. Cosa fare: jht mail status') }
    'it:line.broker_start_failed.il_servizio_della_posta_non_2' { return ('il servizio della posta non ' + [char]0x00E8 + ' partito.') }
    'it:line.broker_start_failed.il_servizio_della_posta_non_3' { return 'il servizio della posta non risponde dopo 30 secondi.' }
    'it:line.broker_unavailable.il_broker_dei_segreti_esiste' { return ('il broker dei segreti esiste ma non ' + [char]0x00E8 + ' attestabile come nostro: non lo tocco.') }
    'it:line.broker_unavailable.il_runtime_installato_pi_vecchio_2' { return ('il runtime installato ' + [char]0x00E8 + ' pi' + [char]0x00F9 + ' vecchio e non ha il broker dei segreti.') }
    'it:line.broker_unavailable.il_servizio_della_posta_non' { return ('il servizio della posta non c''' + [char]0x00E8 + ' ancora: si crea la prima volta che serve.') }
    'it:line.cancellato_marcatore_migrazione_broker_s' { return 'Cancellato: marcatore migrazione broker %s' }
    'it:line.cancellato_volume_broker_s_s' { return 'Cancellato: volume broker %s (%s)' }
    'it:line.container_s_non_e_partito' { return 'Container ''%s'' non e'' partito entro 10s. Controlla ''jht logs''.' }
    'it:line.cosa_fare_jht_mail_setup' { return 'Cosa fare: jht mail setup' }
    'it:line.cosa_fare_jht_up_3' { return 'Cosa fare: jht up' }
    'it:line.cosa_fare_jht_upgrade_4' { return 'Cosa fare: jht upgrade' }
    'it:line.cosa_fare_riprova_il_comando_2' { return 'Cosa fare: riprova il comando' }
    'it:line.fino_ad_allora_la_posta' { return 'Fino ad allora la posta si legge e si invia con la password di oggi; l''avviso resta in jht mail status.' }
    'it:line.genera_una_nuova_password_per' { return 'genera una nuova password per app dal tuo provider e salvala con: jht mail setup' }
    'it:line.i_segreti_e_lo_stato' { return 'I segreti e lo stato del broker sono stati cancellati: rifai i login dei portali e configura di nuovo la posta.' }
    'it:line.il_broker_non_ha_registrato' { return 'Il broker non ha registrato l''autorizzazione: ritirata, niente partira''.' }
    'it:line.integration.install_hint' { return 'per installarli: ''jht upgrade'' (o un ''jht integration add <id>'')' }
    'it:line.interattivo_il_token_viene_chiesto' { return ('Interattivo: il token viene chiesto senza eco, poi il bot nuovo riceve un codice monouso dal tuo Telegram. Automazioni: {"bot_token": ...} come JSON su stdin; non salvare il token in ~/.jht e cancella subito qualunque file usato fuori da l' + [char]0x00EC + '.') }
    'it:line.jht_telegram_pair_all_interattivo' { return ('jht telegram pair --all ' + [char]0x00E8 + ' interattivo: per le automazioni abbina un ruolo alla volta.') }
    'it:line.job_hunter_team_non_installato' { return ('Job Hunter Team non ' + [char]0x00E8 + ' installato del tutto: nella cartella del runtime manca il file di integrit' + [char]0x00E0 + ' (un''installazione interrotta?). Rilancia l''installer.') }
    'it:line.la_casella_di_posta_ora' { return 'La casella di posta ora sta nel broker dei segreti. La sua password era leggibile dagli agenti:' }
    'it:line.legacy_cleanup_failed.i_token_nuovi_sono_al' { return ('i token nuovi sono al sicuro, ma la copia legacy di %s ' + [char]0x00E8 + ' ancora in ~/.jht; cutover negato.') }
    'it:line.legacy_inventory_failed.il_team_resta_fermo_perch_4' { return ('il team resta fermo perch' + [char]0x00E9 + ' l''inventario Telegram host non ' + [char]0x00E8 + ' stato conservato.') }
    'it:line.legacy_inventory_failed.le_impronte_non_sono_state' { return 'le impronte non sono state conservate dal servizio isolato.' }
    'it:line.legacy_inventory_failed.migrazione_telegram_interrotta' { return 'migrazione Telegram interrotta.' }
    'it:line.legacy_inventory_failed.non_posso_provare_che_jht' { return 'non posso provare che ~/.jht sia privo di token Telegram.' }
    'it:line.legacy_inventory_failed.non_riesco_a_fermare_gli' { return 'non riesco a fermare gli agenti prima dell''inventario host.' }
    'it:line.legacy_inventory_failed.non_riesco_a_leggere_i' { return 'non riesco a leggere i token legacy in ~/.jht.' }
    'it:line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti' { return 'ruoli legacy non riconosciuti.' }
    'it:line.legacy_remove_failed.s_nel_broker_ma_la' { return ('%s ' + [char]0x00E8 + ' nel broker ma la copia in ~/.jht/credentials ' + [char]0x00E8 + ' rimasta.') }
    'it:line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso' { return ('~/.jht/credentials/%s.json ' + [char]0x00E8 + ' ricomparso dopo la migrazione; rimosso senza importarlo.') }
    'it:line.mail.address_prompt' { return 'Indirizzo della casella:' }
    'it:line.mail.app_password_prompt' { return 'Password per app (non viene mostrata):' }
    'it:line.mail.dedicated_prompt' { return ('' + [char]0x00C8 + ' una casella DEDICATA agli avvisi di lavoro inoltrati?') }
    'it:line.mail_setup_opzione_sconosciuta_s' { return 'mail setup: opzione sconosciuta %s' }
    'it:line.mail_setup_password_vuota' { return 'mail setup: password vuota' }
    'it:line.nessun_provider_attivo_scegline_uno' { return 'nessun provider attivo: scegline uno con ''jht providers use glm''' }
    'it:line.nessun_ruolo_ha_un_token' { return 'Nessun ruolo ha un token legacy: per un bot nuovo usa jht telegram pair <ruolo>.' }
    'it:line.non_autorizzabile_s' { return 'Non autorizzabile: %s.' }
    'it:line.non_autorizzata_s' { return 'Non autorizzata: %s.' }
    'it:line.os_and_version_are_required' { return '--os e --version sono obbligatori' }
    'it:line.podman_non_trovato_reinstalla_il' { return 'Podman non trovato: reinstalla il runtime JHT.' }
    'it:line.preparo_il_servizio_della_posta' { return ('Preparo il servizio della posta (si crea solo la prima volta che serve)' + [char]0x2026) }
    'it:line.provider_attivo_non_riconosciuto_s' { return 'provider attivo non riconosciuto: %s' }
    'it:line.reset_impossibile_cancellare_il_marcatore' { return 'reset: impossibile cancellare il marcatore migrazione broker %s.' }
    'it:line.reset_impossibile_cancellare_il_marcatore_2' { return 'reset: impossibile cancellare il marcatore del broker %s.' }
    'it:line.reset_impossibile_cancellare_il_volume' { return 'reset: impossibile cancellare il volume broker %s (%s).' }
    'it:line.reset_nome_volume_non_valido' { return 'reset: nome volume non valido per %s; rimozione negata.' }
    'it:line.reset_non_riesco_a_determinare' { return 'reset: non riesco a determinare il progetto Compose; i volumi del broker non sono stati toccati.' }
    'it:line.reset_non_riesco_a_fermare' { return 'reset: non riesco a fermare il runtime; i volumi del broker non sono stati toccati.' }
    'it:line.reset_ricerca_del_volume_s_2' { return 'reset: ricerca del volume %s non riuscita.' }
    'it:line.restano_token_legacy_per_s' { return ('Restano token legacy per: %s. Finch' + [char]0x00E9 + ' non abbini anche questi ruoli, %s resta muto su Telegram: abbinali tutti in questa seduta (jht telegram pair --all).') }
    'it:line.risposta_del_container_non_valida' { return 'Risposta del container non valida: autorizzazione ritirata, niente partira''.' }
    'it:line.ritirata_s_non_verra_inviata' { return 'Ritirata #%s: non verra'' inviata.' }
    'it:line.ritiro_non_riuscito_s' { return 'Ritiro non riuscito: %s.' }
    'it:line.runtime_migration_docker_missing.il_client_docker_originale_non' { return 'il client Docker originale non e'' disponibile.' }
    'it:line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata' { return 'serve l''immagine JHT fissata per digest.' }
    'it:line.runtime_migration_podman_missing.podman_non_e_disponibile' { return 'Podman non e'' disponibile.' }
    'it:line.runtime_migration_team_running.ferma_prima_il_team_docker' { return 'ferma prima il team Docker.' }
    'it:line.runtime_migration_team_running.ferma_prima_il_team_podman' { return 'ferma prima il team Podman.' }
    'it:line.runtime_o_container_jht_non' { return 'runtime o container JHT non disponibile' }
    'it:line.ruoli_da_abbinare_in_questa' { return 'Ruoli da abbinare in questa seduta: %s' }
    'it:line.s_ha_gi_un_bot' { return ('%s ha gi' + [char]0x00E0 + ' un bot abbinato: tolgo solo la sua copia legacy.') }
    'it:line.s_needs_a_value' { return '%s richiede un valore' }
    'it:line.saltato_non_trovato_volume_broker' { return 'Saltato (non trovato): volume broker %s' }
    'it:line.serve_un_terminale_l_autorizzazione' { return 'Serve un terminale: l''autorizzazione si conferma a mano.' }
    'it:line.telegram_isolato_attivo_il_bridge' { return ('Telegram isolato attivo; il bridge legacy non pu' + [char]0x00F2 + ' pi' + [char]0x00F9 + ' essere riabilitato dagli agenti.') }
    'it:line.the_setup_keeps_the_key' { return 'Il setup tiene la chiave: ora puoi cancellare il file su questo computer (%s).' }
    'it:line.upgrade.done' { return 'Aggiornamento completato: %s (%s) -> %s (%s). %s' }
    'it:line.upgrade.restored' { return 'Runtime precedente ripristinato.' }
    'it:line.uso_jht_apply_relink_account' { return 'uso: jht apply relink-account' }
    'it:line.uso_jht_apply_request_cancel_2' { return 'uso: jht apply request|cancel <id>' }
    'it:line.uso_jht_mail_setup_status' { return 'uso: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <indirizzo|@dominio>|drafts|approve <id>|discard <id>|journal|delete|migrate' }
    'it:line.uso_jht_migrate_runtime_podman' { return 'uso: jht migrate-runtime podman' }
    'it:line.uso_jht_screen_on_off' { return 'uso: jht screen on | off | status [--json]' }
    'it:line.uso_jht_telegram_chat_id' { return 'uso: jht telegram chat-id <assistente|capitano|mentor>' }
    'it:line.uso_jht_telegram_pair_assistente' { return 'uso: jht telegram pair <assistente|capitano|mentor>|--all' }
    'it:line.uso_jht_telegram_remove_assistente' { return 'uso: jht telegram remove <assistente|capitano|mentor>' }
    'it:line.uso_jht_telegram_status_pair' { return 'uso: jht telegram status|pair <ruolo>|pair --all|chat-id <ruolo>|remove <ruolo>' }
    'it:monitor.window_invalid' { return 'monitor_window_invalid: usa ''jht monitor --window'' senza altre opzioni.' }
    'it:ps.apply_auto_send_warning_1' { return '  Con l''invio automatico acceso il team compila e INVIA la candidatura,' }
    'it:ps.apply_auto_send_warning_2' { return '  senza un''altra conferma. Una volta partita non si richiama.' }
    'it:ps.artifact_copied' { return ('Ho copiato %s in %s perch' + [char]0x00E9 + ' il team possa leggerlo.') }
    'it:ps.artifact_copy_failed' { return 'non riesco a copiare %s nella cartella condivisa: %s' }
    'it:ps.artifact_copy_refused' { return ('non copio %s: %s ' + [char]0x00E8 + ' un collegamento o non sta dentro la cartella condivisa') }
    'it:ps.bot_token_prompt_hidden' { return 'Token del bot %s (input nascosto)' }
    'it:ps.botfather_fresh_token' { return ('Usa sempre un token appena generato in BotFather (/revoke sul bot, oppure un bot nuovo): un token gi' + [char]0x00E0 + ' esistente pu' + [char]0x00F2 + ' essere stato letto dagli agenti anche se oggi non compare in ~/.jht.') }
    'it:ps.broker_network_proxy_not_ready' { return ('broker_network_unavailable: il proxy della posta non ' + [char]0x00E8 + ' pronto (codice %s).') }
    'it:ps.broker_network_scripts_not_downloadable' { return 'broker_network_unavailable: non riesco a scaricare gli script del proxy della posta. Cosa fare: jht upgrade' }
    'it:ps.broker_network_scripts_not_verified' { return 'broker_network_unavailable: gli script del proxy della posta non sono attestati. Cosa fare: jht upgrade' }
    'it:ps.broker_restart_failed_secrets_broker_not_ours' { return ('broker_restart_failed: il broker dei segreti non ' + [char]0x00E8 + ' attestabile come nostro: non lo tocco. Cosa fare: jht mail status') }
    'it:ps.broker_unavailable_secrets_broker_not_running' { return ('broker_unavailable: il broker dei segreti non ' + [char]0x00E8 + ' attivo.') }
    'it:ps.cli_version_needs_container' { return 'Per la versione del CLI in esecuzione serve il container attivo: ''jht up''.' }
    'it:ps.compose_up_failed_team_not_started' { return ('compose_up_failed: il team non si ' + [char]0x00E8 + ' avviato (docker compose up, codice %s). Controlla ''jht logs''.') }
    'it:ps.container_not_running' { return 'container ''%s'' non attivo' }
    'it:ps.container_runtime_unsupported' { return 'runtime container non supportato: %s' }
    'it:ps.docker_desktop_file_sharing_hint' { return '  Cosa fare: apri Docker Desktop > Settings > Resources > File sharing, controlla che la cartella dell''utente sia condivisa, poi rilancia ''jht up''.' }
    'it:ps.docker_podman_verified_future_removal' { return 'Migrazione Docker -> Podman verificata. I volumi Docker restano intatti e contengono ancora le password della posta, gli accessi ai portali e i token di Telegram: richiedono una futura conferma esplicita per la rimozione.' }
    'it:ps.doctor.wsl_memory' { return 'WSL non ha un limite di memoria (sono registrate altre distribuzioni WSL): in %s, sotto [wsl2], aggiungi memory=%s' }
    'it:ps.download_asset_failed_detail' { return 'download non riuscito: %s (%s)' }
    'it:ps.download_shared_folder_no_path' { return 'la destinazione sta in una cartella condivisa con il team: scegline una fuori, come Downloads.' }
    'it:ps.download_sums_failed_detail' { return 'download non riuscito: SHA256SUMS di v%s (%s)' }
    'it:ps.full_pull_failed_keep_old' { return ('full_pull_failed: l''immagine piena nuova non ' + [char]0x00E8 + ' arrivata, resta la vecchia. Cosa fare: jht tools pull') }
    'it:ps.help.main' { return (('jht - Job Hunter Team', '', '  Comandi dell''host (funzionano da qui):', '    jht up                 avvia il container del team', '    jht down               lo ferma', '                           (con --verbose si vedono anche le righe del motore)', '    jht restart            lo riavvia', '    jht status             stato di container e team', '    jht logs [-f]          log del container', ('    jht upgrade            aggiorna all''immagine pi' + [char]0x00F9 + ' recente'), '    jht setup              installazione guidata', '    jht shell              shell dentro il container', '    jht mail setup         salva la casella di posta nel broker dei segreti', '    jht mail drafts        email scritte dagli agenti in attesa del tuo ok', '    jht mail approve <id>  le manda; jht mail discard <id> le scarta', '    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]', '                           le integrazioni che si aggiungono dopo il setup', '                           (google, telegram, mail): stato letto dal motore', '    jht telegram status    stato del servizio Telegram isolato', '    jht telegram pair ROLE chiede il token senza eco sul computer host, poi', '                           mostra un codice da mandare al bot dal tuo Telegram', '                           Per automazioni: JSON su stdin. Non salvare il token', ('                           in ~/.jht; cancella subito file usati fuori da l' + [char]0x00EC + '.'), '    jht telegram pair --all abbina in una seduta tutti i ruoli legacy', '    jht telegram chat-id ROLE sposta il bot su un''altra chat, con lo stesso codice', '    jht reset              cancella configurazione e volumi del broker', '    jht migrate-runtime podman', '                           copia e verifica i volumi Docker in Podman;', '                           non seleziona il nuovo runtime e non cancella Docker', '    jht uninstall --confirm rimuove il runtime locale Windows, ma conserva dati,', '                           documenti, Podman e Compose', '', '  Tutti gli altri comandi (positions, stats, team, providers, cron,', '  working-hours, cloud...) girano DENTRO il container: per il loro aiuto', '  serve il container attivo.', '', '      jht up ; jht --help') -join [char]10) }
    'it:ps.home_unavailable_bind_mount' { return 'HOME/USERPROFILE non disponibile: bind mount JHT rifiutato' }
    'it:ps.host_download_failed' { return 'download sull''host non riuscito: %s' }
    'it:ps.input_not_json_bot_token_stdin' { return 'input_not_json: passa bot_token come JSON su stdin.' }
    'it:ps.integration_not_installed' { return 'non installato' }
    'it:ps.integration_not_installed_yet' { return 'non ancora installato' }
    'it:ps.jht_container_not_verifiable' { return 'Container JHT non attestabile.' }
    'it:ps.jht_home_missing' { return ('Job Hunter Team non ' + [char]0x00E8 + ' ancora installato: la cartella %s non esiste. Lancia l''installer, poi ''jht setup''.') }
    'it:ps.legacy_cleanup_failed_old_token_still_there' { return ('legacy_cleanup_failed: il token vecchio ' + [char]0x00E8 + ' ancora in ~/.jht; cutover negato.') }
    'it:ps.legacy_migration_failed_stays' { return 'legacy_migration_failed: %s resta in ~/.jht/credentials.' }
    'it:ps.lifecycle.restarted' { return 'Job Hunter Team riavviato.' }
    'it:ps.link_or_not_folder' { return 'collegamento o non cartella' }
    'it:ps.localappdata_unavailable' { return 'LOCALAPPDATA non disponibile: runtime host rifiutato' }
    'it:ps.machine_space_back_on_stop' { return 'Circa %s GB liberati nella macchina di JHT tornano a Windows quando la macchina si ferma: dopo jht down, con podman machine stop %s, o al riavvio del computer.' }
    'it:ps.machine_space_not_returned' { return 'JHT occupa circa %s GB nel suo disco virtuale; si liberano del tutto con jht uninstall.' }
    'it:ps.machine_state_unreadable' { return 'lo stato della macchina non si legge (podman e wsl non rispondono)' }
    'it:ps.monitor_window_unavailable' { return 'monitor_window_unavailable: impossibile aprire una finestra qui. Esegui ''jht monitor'' nel terminale corrente.' }
    'it:ps.mount_repair_failed_folders_not_writable' { return 'mount_repair_failed: le cartelle di Job Hunter Team (%s, %s) non sono scrivibili dal container e non si sono potute sistemare.' }
    'it:ps.old_images_busy' { return ' In uso da un container (tenute): %s.' }
    'it:ps.old_images_kept_all' { return 'Immagini JHT vecchie: tenute tutte (JHT_KEEP_OLD_IMAGES=1).' }
    'it:ps.old_images_refused' { return ' Rifiutate dal motore (tenute): %s.' }
    'it:ps.old_images_removed' { return 'Immagini JHT vecchie: rimosse %s, liberati circa %s MB (dimensione nominale: i layer condivisi si liberano solo in parte), tenute: corrente, precedente.' }
    'it:ps.pair_role_now_prompt' { return 'Abbinare %s adesso? [s/N]' }
    'it:ps.podman_exe_not_found' { return 'podman.exe non trovato' }
    'it:ps.podman_machine_not_responding' { return 'La macchina Podman JHT non risponde. Esegui ''jht up''.' }
    'it:ps.release_arrived_without_https' { return ('la release ' + [char]0x00E8 + ' arrivata senza HTTPS: %s') }
    'it:ps.relink_account_container_not_running' { return 'apply relink-account: container non attivo.' }
    'it:ps.script_integration_not_installed' { return 'script jht-integration.ps1 non ancora installato: ''jht upgrade'' (o un ''jht integration add/remove'') e riprova' }
    'it:ps.script_tools_not_installed' { return 'script jht-tools.ps1 non ancora installato: ''jht upgrade'' e riprova' }
    'it:ps.startup_task_still_registered' { return ('l''attivit' + [char]0x00E0 + ' risulta ancora registrata') }
    'it:ps.team_container_unavailable' { return 'team_container_unavailable: avvia la squadra con jht up e riprova.' }
    'it:ps.telegram_not_configured' { return 'Telegram non attivo: Telegram non configurato.' }
    'it:ps.telegram_status_unverifiable' { return 'Telegram: stato non verificabile adesso (servizio spento o non raggiungibile). Dettagli: jht telegram status' }
    'it:ps.telegram_unavailable_isolated_not_running' { return ('telegram_unavailable: il servizio Telegram isolato non ' + [char]0x00E8 + ' attivo.') }
    'it:ps.telegram_unavailable_run_jht_up' { return 'telegram_unavailable: esegui jht up' }
    'it:ps.uninstall.bad.target' { return ('Rifiutato: {0} ' + [char]0x00E8 + ' un collegamento o non ' + [char]0x00E8 + ' una cartella: non lo seguo e non lo cancello.') }
    'it:ps.uninstall.done' { return 'Fatto: la macchina <machine> (e con lei le immagini di JHT, il nucleo e quella piena), il runtime e il comando jht sono stati tolti.' }
    'it:ps.uninstall.done.kept' { return ' ~/.jht e Documents\Job Hunter Team restano (con --purge si cancellano).' }
    'it:ps.uninstall.done.wsl' { return ('WSL resta in memoria: vmmem, wslservice e wslrelay sono componenti di Windows (non li ha installati Job Hunter Team) e servono anche alle altre macchine WSL di questo utente; di norma si fermano da soli dopo un po'' di inattivit' + [char]0x00E0 + '. Per fermarli subito: wsl --shutdown (ferma TUTTE le macchine WSL aperte).') }
    'it:ps.uninstall.kept.machine' { return ('La macchina Podman {0} non risulta creata dall''installer: resta dov''' + [char]0x00E8 + '. A mano, se ' + [char]0x00E8 + ' tua da togliere: podman machine stop {0}; podman machine rm {0}.') }
    'it:ps.uninstall.left.commands' { return 'Non tolti il comando jht o i file dell''installer in {0} ({1}), o le variabili e le righe PATH aggiunte dall''installer. A mano: Remove-Item il file; variabili JHT_CONTAINER_RUNTIME e JHT_PODMAN_MACHINE e la cartella {0} nel PATH da Impostazioni > Variabili d''ambiente.' }
    'it:ps.uninstall.left.data' { return 'Non cancellati i dati di JHT ({0}). A mano: Remove-Item -Recurse -Force {1}. Il comando jht e il runtime sono rimasti: rilancia jht uninstall --confirm --purge dopo aver risolto.' }
    'it:ps.uninstall.left.machine' { return 'Non tolta: la macchina Podman <machine>. Motivo: {0}. A mano: podman machine stop <machine>; wsl --unregister {1}; poi rilancia jht uninstall --confirm.' }
    'it:ps.uninstall.left.runtime' { return 'Non tolto: il runtime di JHT in {0}. A mano: Remove-Item -Recurse -Force ''{0}''.' }
    'it:ps.uninstall.left.task' { return ('Non tolta l''attivit' + [char]0x00E0 + ' di avvio al logon ''{0}'' (motivo: {1}). Il resto ' + [char]0x00E8 + ' stato tolto. A mano: schtasks /Delete /TN "{0}" /F.') }
    'it:ps.uninstall.phase.commands' { return 'Tolgo il comando jht, i file dell''installer e le righe PATH...' }
    'it:ps.uninstall.phase.data' { return 'Cancello ~/.jht e Documents\Job Hunter Team (--purge)...' }
    'it:ps.uninstall.phase.machine' { return 'Tolgo la macchina Podman <machine> (con i segreti e le immagini di JHT)...' }
    'it:ps.uninstall.phase.runtime' { return 'Tolgo il runtime di JHT...' }
    'it:ps.uninstall.purge_notice' { return 'Con --purge vengono cancellati anche ~/.jht e Documents\Job Hunter Team: configurazione, database, CV e output. Non si torna indietro.' }
    'it:ps.uninstall.purge_removal_notice' { return 'Vengono cancellati anche la password della posta e i token di Telegram salvati.' }
    'it:ps.uninstall.removal_notice' { return 'Vengono cancellati anche la password della posta e i token di Telegram salvati; ~/.jht e Documenti restano, e con loro la sessione LinkedIn salvata (secrets/linkedin-profile e .cache/linkedin): si toglie con jht reset --scope creds.' }
    'it:ps.uninstall.secrets' { return ('I segreti salvati non sono stati rimossi: la password della posta e i token di Telegram stanno nei volumi jht-secrets e jht-telegram-secrets della macchina <machine>, che ' + [char]0x00E8 + ' ancora qui.') }
    'it:ps.uninstall.wslconfig.done' { return 'Tolte da {0} le righe aggiunte dall''installer (memoria di WSL).' }
    'it:ps.uninstall.wslconfig.kept' { return 'Lasciate in {0} le righe che hai cambiato tu: sono tue.' }
    'it:ps.uninstall.wslconfig.left' { return 'Non toccato {0} ({1}): le righe aggiunte dall''installer (memoria di WSL) restano. Toglile a mano: hanno una riga di commento sopra.' }
    'it:ps.unknown_argument' { return 'argomento sconosciuto: %s' }
    'it:ps.upgrade_already_running' { return ('Un aggiornamento ' + [char]0x00E8 + ' gi' + [char]0x00E0 + ' in corso') }
    'it:ps.upgrade_broker_restart_failed' { return ('broker_restart_failed: il broker dei segreti non ' + [char]0x00E8 + ' ripartito. Cosa fare: jht up') }
    'it:ps.upgrade_disk_low' { return ('disk_low: Gli agenti richiedono almeno %s GiB di disco ' + [char]0x2014 + ' disponibili: %s GiB. Per liberare spazio svuota il Cestino ed elimina i file grandi che non ti servono e le immagini Docker inutilizzate, poi riprova: non ' + [char]0x00E8 + ' stato scaricato n' + [char]0x00E9 + ' modificato niente.') }
    'it:ps.upgrade_docker_unavailable' { return 'Docker o runtime host non disponibile' }
    'it:ps.upgrade_helper_install_failed' { return 'helper_install_failed: gli script host nuovi si prendono alla prima richiesta o con un altro ''jht upgrade''' }
    'it:ps.upgrade_host_runtime_not_installable' { return 'Runtime host protetto non installabile' }
    'it:ps.upgrade_host_runtime_untrusted' { return 'Runtime host non attendibile' }
    'it:ps.upgrade_image_download_failed' { return 'Download immagine non riuscito' }
    'it:ps.upgrade_journal_not_updated' { return 'Impossibile aggiornare il journal' }
    'it:ps.upgrade_metadata_not_persisted' { return 'Metadata runtime non persistiti' }
    'it:ps.upgrade_mounts_not_writable' { return 'Cartelle di Job Hunter Team non scrivibili dal container (mount_repair_failed)' }
    'it:ps.upgrade_not_completed' { return 'Aggiornamento non completato (%s): %s' }
    'it:ps.upgrade_note_activate_runtime' { return 'Attivo il nuovo runtime...' }
    'it:ps.upgrade_note_download_image' { return ('Scarico l''immagine pi' + [char]0x00F9 + ' recente...') }
    'it:ps.upgrade_note_download_runtime' { return 'Scarico il runtime aggiornato...' }
    'it:ps.upgrade_option_unsupported' { return 'Opzione upgrade non supportata' }
    'it:ps.upgrade_pulling_full_image' { return 'Scarico l''immagine piena aggiornata...' }
    'it:ps.upgrade_recovery_failed' { return 'Recovery dell''upgrade precedente non riuscita' }
    'it:ps.upgrade_release_core_invalid' { return 'Il rilascio non porta un nucleo valido per questa installazione: reinstalla' }
    'it:ps.upgrade_remote_compose_invalid' { return 'Compose remoto non valido' }
    'it:ps.upgrade_remote_runtime_invalid' { return 'Runtime remoto non valido o non raggiungibile' }
    'it:ps.upgrade_rollback_not_prepared' { return 'Impossibile preparare il rollback' }
    'it:ps.upgrade_telegram_restart_failed' { return ('telegram_restart_failed: il servizio Telegram isolato non ' + [char]0x00E8 + ' ripartito. Cosa fare: jht up') }
    'it:ps.upgrade_test_channel' { return 'Canale di test: si aggiorna reinstallando dalla build di test' }
    'it:ps.upgrade_unexpected_error' { return 'Errore inatteso durante l''aggiornamento' }
    'it:ps.upgrade_verify_failed' { return 'Il nuovo runtime non ha superato la verifica' }
    'it:ps.use_fresh_botfather_token' { return ('Usa sempre un token appena generato in BotFather (/revoke sul bot, oppure un bot nuovo): un token gi' + [char]0x00E0 + ' esistente pu' + [char]0x00F2 + ' essere stato letto dagli agenti anche se oggi non compare in ~/.jht.') }
    'it:ps.user_dir_unavailable_cannot_create' { return 'user_dir_unavailable: non riesco a creare la cartella %s, che il team usa.' }
    'it:ps.wsl_exe_not_found' { return 'wsl.exe non trovato' }
    'it:ps.wsl_not_answering' { return 'WSL non risponde (wsl --status)' }
    'it:removed.office' { return '''jht %s'' e'' stato tolto nella 0.4.0 insieme all''ufficio Godot: usa i comandi jht (jht help).' }
    'it:status.no_options' { return '''jht status'' non ha opzioni (%s): si lancia come ''jht status''.' }
    'it:status.not_running' { return 'Il container della squadra non e'' acceso.' }
    'it:status.not_running_next' { return 'Accendilo con: jht up' }
    'it:team.stopped' { return 'Job Hunter Team e'' fermato: jht up per riaccenderlo.' }
    'it:tools.arriving' { return 'Gli strumenti degli Scout stanno arrivando: l''immagine piena si scarica in background (circa 3 GB). La ricerca delle posizioni parte da sola quando sono arrivati; non devi fare niente.' }
    'it:tools.chat_reconnecting' { return 'La squadra passa agli strumenti completi degli Scout, quindi la chat si ferma un momento: riprende da sola appena la squadra e'' ripartita (un paio di minuti).' }
    'it:tools.chat_resumed' { return 'La squadra e'' passata agli strumenti completi: riprendiamo.' }
    'it:tools.chat_switched' { return 'La squadra passa agli strumenti completi degli Scout, quindi questa chat si e'' chiusa. Riaprila fra un paio di minuti con jht team chat.' }
    'it:tools.chat_update_closed' { return ('JHT si sta aggiornando, quindi questa chat si ' + [char]0x00E8 + ' chiusa. Riaprila fra un paio di minuti con jht team chat.') }
    'it:tools.chat_update_resumed' { return ('JHT ' + [char]0x00E8 + ' aggiornato: riprendiamo.') }
    'it:tools.chat_updating' { return 'JHT si sta aggiornando, quindi la chat si ferma un momento: riparte da sola fra poco.' }
    'it:tools.disk_low' { return 'Gli strumenti degli Scout non sono stati scaricati: servono circa %s GiB liberi sul disco e ce ne sono %s, quindi la squadra non puo'' ancora cercare posizioni. Libera spazio (svuota il Cestino, elimina i file grandi che non ti servono), poi esegui jht up: il download riparte da solo.' }
    'it:tools.engine_down' { return 'Lo stato degli strumenti degli Scout non si legge: il motore dei container non risponde. Avvialo con jht up.' }
    'it:tools.failed' { return 'Il download degli strumenti degli Scout non e'' riuscito: la squadra non puo'' ancora cercare posizioni. Esegui jht tools pull per riprovare (anche jht up riprova).' }
    'it:tools.ready' { return 'Gli strumenti degli Scout sono arrivati: la squadra cerca con l''immagine piena.' }
    'it:tools.switch_failed' { return 'Gli strumenti degli Scout sono arrivati, ma la squadra non si e'' potuta riavviare con loro: esegui jht down, poi jht up.' }
    'it:tools.switch_wait' { return 'La squadra sta passando agli strumenti completi degli Scout: aspetto che riparta (al massimo un paio di minuti).' }
    'it:tools.waiting' { return 'Gli strumenti degli Scout sono arrivati: la squadra ci passa da sola quando l''onboarding e'' chiuso.' }
    'it:uninstall.usage' { return 'uso: jht uninstall --confirm [--purge]' }
    'it:up.done' { return 'Job Hunter Team avviato.' }
    'hu:container.starting' { return ('A(z) ''%s'' kont' + [char]0x00E9 + 'ner nem fut, elind' + [char]0x00ED + 'tom...') }
    'hu:doctor.host_config_none' { return ('m' + [char]0x00E9 + 'g nincs be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's: ''jht setup''') }
    'hu:doctor.host_config_ok' { return ('a be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's megvan') }
    'hu:doctor.host_engine_fail' { return ('a kont' + [char]0x00E9 + 'nermotor nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el') }
    'hu:doctor.host_engine_ok' { return ('a kont' + [char]0x00E9 + 'nermotor el' + [char]0x00E9 + 'rhet' + [char]0x0151) }
    'hu:doctor.host_more' { return ('A teljes ellen' + [char]0x0151 + 'rz' + [char]0x00E9 + 'sekhez (be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's, szolg' + [char]0x00E1 + 'ltat' + [char]0x00F3 + ', adatb' + [char]0x00E1 + 'zis, ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'k): ''jht up'', majd ''jht doctor''.') }
    'hu:doctor.host_runtime_fail' { return ('a JHT futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezete hi' + [char]0x00E1 + 'nyzik vagy megv' + [char]0x00E1 + 'ltozott: a ''jht upgrade'' ' + [char]0x00FA + 'jratelep' + [char]0x00ED + 'ti') }
    'hu:doctor.host_runtime_ok' { return ('a JHT futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezete ' + [char]0x00E9 + 'p') }
    'hu:doctor.host_team_off' { return ('a csapat le van ' + [char]0x00E1 + 'll' + [char]0x00ED + 'tva: a ''jht up'' elind' + [char]0x00ED + 'tja') }
    'hu:doctor.host_team_unattestable' { return ('van egy kont' + [char]0x00E9 + 'ner a csapatb' + [char]0x00F3 + 'l, de nem ellen' + [char]0x0151 + 'rizhet' + [char]0x0151 + ', hogy a mi' + [char]0x00E9 + 'nk-e: semmihez nem ny' + [char]0x00FA + 'ltam (a ''jht status'' t' + [char]0x00F6 + 'bbet mond)') }
    'hu:doctor.host_title' { return ('Job Hunter Team: a csapat le van ' + [char]0x00E1 + 'll' + [char]0x00ED + 'tva (a kont' + [char]0x00E9 + 'nere nem fut). Err' + [char]0x0151 + 'l a g' + [char]0x00E9 + 'pr' + [char]0x0151 + 'l v' + [char]0x00E9 + 'gzett ellen' + [char]0x0151 + 'rz' + [char]0x00E9 + 'sek:') }
    'hu:down.done' { return ('A Job Hunter Team le' + [char]0x00E1 + 'llt.') }
    'hu:download.bad_version' { return ('' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nytelen verzi' + [char]0x00F3 + ': %s. P' + [char]0x00E9 + 'lda: 0.3.5.') }
    'hu:download.deb_only_linux' { return ('a --deb csak Linuxra val' + [char]0x00F3 + '.') }
    'hu:download.dest_is_link' { return ('a c' + [char]0x00E9 + 'lhely egy link: %s') }
    'hu:download.dest_not_file' { return ('a c' + [char]0x00E9 + 'lhely l' + [char]0x00E9 + 'tezik, ' + [char]0x00E9 + 's nem f' + [char]0x00E1 + 'jl: %s') }
    'hu:download.fetching' { return ('Let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's: %s...') }
    'hu:download.hash_invalid' { return ('' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nytelen SHA-256 ehhez: %s: v' + [char]0x00E1 + 'rt %s, kapott %s.') }
    'hu:download.intel_mac' { return ('A 0.4-es macOS-alkalmaz' + [char]0x00E1 + 's csak Apple siliconos Maceken fut (M1 ' + [char]0x00E9 + 's ' + [char]0x00FA + 'jabb); ez egy Intel Mac, amelyet a 0.4 nem t' + [char]0x00E1 + 'mogat. Semmi sem lett let' + [char]0x00F6 + 'ltve.') }
    'hu:download.linux_no_app' { return ('Ebben a verzi' + [char]0x00F3 + 'ban nincs asztali alkalmaz' + [char]0x00E1 + 's Linuxra: haszn' + [char]0x00E1 + 'ld az install.sh-t. Semmi sem lett let' + [char]0x00F6 + 'ltve.') }
    'hu:download.mismatch_existing' { return ('a(z) %s f' + [char]0x00E1 + 'jl l' + [char]0x00E9 + 'tezik, de az SHA-256-ja nem egyezik: nem ' + [char]0x00ED + 'rtam fel' + [char]0x00FC + 'l.') }
    'hu:download.mkdir_failed' { return ('nem tudom l' + [char]0x00E9 + 'trehozni a c' + [char]0x00E9 + 'lmapp' + [char]0x00E1 + 't: %s') }
    'hu:download.present_verified' { return ('A f' + [char]0x00E1 + 'jl m' + [char]0x00E1 + 'r megvan ' + [char]0x00E9 + 's ellen' + [char]0x0151 + 'rizve: %s') }
    'hu:download.release_no_app' { return ('Ehhez a kiad' + [char]0x00E1 + 'shoz (v%s) nincs macOS-alkalmaz' + [char]0x00E1 + 's: haszn' + [char]0x00E1 + 'ld a 0.4.0-s vagy ' + [char]0x00FA + 'jabb verzi' + [char]0x00F3 + 't. Semmi sem lett let' + [char]0x00F6 + 'ltve.') }
    'hu:download.saved_in' { return 'Mentve ide: %s' }
    'hu:download.sha_verified' { return ('SHA-256 ellen' + [char]0x0151 + 'rizve: %s') }
    'hu:download.sum_missing' { return 'nincs megadott SHA-256 ehhez: %s.' }
    'hu:download.unsupported_os' { return ('nem t' + [char]0x00E1 + 'mogatott rendszer: %s. Haszn' + [char]0x00E1 + 'ld a windows vagy a macos ' + [char]0x00E9 + 'rt' + [char]0x00E9 + 'ket.') }
    'hu:download.windows_missing' { return ('A Windows nem r' + [char]0x00E9 + 'sze a 0.4.0-nak: a kiad' + [char]0x00E1 + 'sban nincs Windows-telep' + [char]0x00ED + 't' + [char]0x0151 + '. Semmi sem lett let' + [char]0x00F6 + 'ltve.') }
    'hu:help.integration' { return ((('Haszn' + [char]0x00E1 + 'lat: jht integration <parancs>'), '', ('  list [--json]                   az integr' + [char]0x00E1 + 'ci' + [char]0x00F3 + 'k ' + [char]0x00E9 + 's az ' + [char]0x00E1 + 'llapotuk'), ('  status [ID] [--json]            egynek vagy mindnek az ' + [char]0x00E1 + 'llapota'), ('  add ID [--json]                 hozz' + [char]0x00E1 + 'ad egy integr' + [char]0x00E1 + 'ci' + [char]0x00F3 + 't'), '  remove ID [--purge --yes] [--remove-image] [--json]', ('                                  elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tja; a --purge az adatait is t' + [char]0x00F6 + 'rli (--yes kell hozz' + [char]0x00E1 + ');'), ('                                  a --remove-image (csak screen ' + [char]0x00E9 + 's media) az eszk' + [char]0x00F6 + 'z' + [char]0x00F6 + 'k k' + [char]0x00E9 + 'p' + [char]0x00E9 + 't is elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tja'), '', ('Az enged' + [char]0x00E9 + 'lyezett ID-k azok, amelyeket a `jht integration list` mutat. Semmi sem t' + [char]0x00F6 + 'lt' + [char]0x0151 + 'dik le ' + [char]0x00E9 + 's nem'), ('kapcsol be, am' + [char]0x00ED + 'g az `add` paranccsal nem k' + [char]0x00E9 + 'red.')) -join [char]10) }
    'hu:help.linkedin' { return ((('Haszn' + [char]0x00E1 + 'lat: jht linkedin <parancs>'), '', ('  login [--stop]    k' + [char]0x00E9 + 'zi bejelentkez' + [char]0x00E9 + 's a LinkedInre (Google-lel): b' + [char]0x00F6 + 'ng' + [char]0x00E9 + 'sz' + [char]0x0151 + ' egy k' + [char]0x00FC + 'l' + [char]0x00F6 + 'n, h' + [char]0x00E1 + 'l' + [char]0x00F3 + 'zat n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'li'), ('                    kont' + [char]0x00E9 + 'nerben, amelynek ablak' + [char]0x00E1 + 't az alkalmaz' + [char]0x00E1 + 'sb' + [char]0x00F3 + 'l l' + [char]0x00E1 + 'tod ' + [char]0x00E9 + 's haszn' + [char]0x00E1 + 'lod; a --stop mindent bez' + [char]0x00E1 + 'r'), ('  status --json     megmondja, folyamatban van-e a bejelentkez' + [char]0x00E9 + 's, ' + [char]0x00E9 + 's el van-e mentve'), '                    a LinkedIn-munkamenet', '', ('Semmi sem t' + [char]0x00F6 + 'lt' + [char]0x0151 + 'dik le ' + [char]0x00E9 + 's nem kapcsol be, am' + [char]0x00ED + 'g a `login` paranccsal nem k' + [char]0x00E9 + 'red.')) -join [char]10) }
    'hu:help.screen' { return ((('Haszn' + [char]0x00E1 + 'lat: jht screen <parancs>'), '', ('  on [--json]       bekapcsolja a closer ' + [char]0x00E9 + 'l' + [char]0x0151 + ' k' + [char]0x00E9 + 'perny' + [char]0x0151 + 'j' + [char]0x00E9 + 't: k' + [char]0x00FC + 'l' + [char]0x00F6 + 'n kont' + [char]0x00E9 + 'ner, a stream csak a 127.0.0.1-en'), '  off [--remove-image] [--json]', ('                    kikapcsolja ' + [char]0x00E9 + 's elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tja a kont' + [char]0x00E9 + 'nert; az eszk' + [char]0x00F6 + 'z' + [char]0x00F6 + 'k k' + [char]0x00E9 + 'pe a lemezen marad, hogy ' + [char]0x00FA + 'jralet' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's'), ('                    n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l kapcsolhasd vissza: a --remove-image elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tja, ' + [char]0x00E9 + 's felszabad' + [char]0x00ED + 'tja a helyet'), '  status [--json]   megmondja, be van-e kapcsolva', '', ('Semmi sem t' + [char]0x00F6 + 'lt' + [char]0x0151 + 'dik le ' + [char]0x00E9 + 's nem kapcsol be, am' + [char]0x00ED + 'g az `on` paranccsal nem k' + [char]0x00E9 + 'red. A stream csak megtekinthet' + [char]0x0151 + '.')) -join [char]10) }
    'hu:help.setup' { return ((('Haszn' + [char]0x00E1 + 'lat: jht setup [kapcsol' + [char]0x00F3 + 'k]'), '', ('Kapcsol' + [char]0x00F3 + 'k n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l az ir' + [char]0x00E1 + 'ny' + [char]0x00ED + 'tott telep' + [char]0x00ED + 't' + [char]0x00E9 + 's indul. A --non-interactive kapcsol' + [char]0x00F3 + 'val semmit sem k' + [char]0x00E9 + 'rdez:'), ('mindent kapcsol' + [char]0x00F3 + 'kkal adsz meg.'), '', ('  --non-interactive            nincs k' + [char]0x00E9 + 'rd' + [char]0x00E9 + 's'), ('  --provider <name>            glm (Z.ai, alap' + [char]0x00E9 + 'rtelmezett), kimi (Moonshot), openai vagy claude (Anthropic)'), ('  --harness <name>             pi (alap' + [char]0x00E9 + 'rtelmezett)'), ('  --api-key-file <path>        az API-kulcsot tartalmaz' + [char]0x00F3 + ' f' + [char]0x00E1 + 'jl (egy sor, csak te olvashatod).'), ('                               A g' + [char]0x00E9 + 'peden l' + [char]0x00E9 + 'v' + [char]0x0151 + ' f' + [char]0x00E1 + 'jlt a jht olvassa be ' + [char]0x00E9 + 's adja ' + [char]0x00E1 + 't a be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'snak: glm ' + [char]0x00E9 + 's kimi'), ('                               eset' + [char]0x00E9 + 'n a be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's mag' + [char]0x00E1 + 'n' + [char]0x00E1 + 'l tartja a kulcsot, sosem a konfigur' + [char]0x00E1 + 'ci' + [char]0x00F3 + 'ban'), ('  --api-key-stdin              a standard bemenetr' + [char]0x0151 + 'l olvassa az API-kulcsot (egy sor): sosem a parancssorban'), ('  --api-key <key>              az itt be' + [char]0x00ED + 'rt kulcs, ny' + [char]0x00ED + 'lt sz' + [char]0x00F6 + 'vegk' + [char]0x00E9 + 'nt (glm ' + [char]0x00E9 + 's kimi eset' + [char]0x00E9 + 'n nem enged' + [char]0x00E9 + 'lyezett)'), ('  --secret-mode <mode>         hogyan ment' + [char]0x0151 + 'dik a kulcs: plaintext (alap' + [char]0x00E9 + 'rtelmezett), env vagy file'), ('  --secret-env <name>          --secret-mode env eset' + [char]0x00E9 + 'n: a kulcsot tartalmaz' + [char]0x00F3 + ' k' + [char]0x00F6 + 'rnyezeti v' + [char]0x00E1 + 'ltoz' + [char]0x00F3), ('  --secret-file <path>         --secret-mode file eset' + [char]0x00E9 + 'n: a kulcsot tartalmaz' + [char]0x00F3 + ' f' + [char]0x00E1 + 'jl'), ('  --model <model>              a haszn' + [char]0x00E1 + 'land' + [char]0x00F3 + ' modell'), ('  --language <code>            a nyelv (p' + [char]0x00E9 + 'ld' + [char]0x00E1 + 'ul it vagy en)'), ('  --budget-usd <doll' + [char]0x00E1 + 'r>        mennyit k' + [char]0x00F6 + 'lthet a csapat, doll' + [char]0x00E1 + 'rban (a --budget-minutes, --budget-days, --budget-until egyik' + [char]0x00E9 + 'vel)'), ('  --budget-minutes <n>         a keret ennyi percig tart mostant' + [char]0x00F3 + 'l'), ('  --budget-days <n>            a keret ennyi napig tart mostant' + [char]0x00F3 + 'l'), ('  --budget-until <' + [char]0x00F3 + 'ra>         a keret a nap eddig az ' + [char]0x00F3 + 'r' + [char]0x00E1 + 'ig tart, 0-23 (a k' + [char]0x00F6 + 'vetkez' + [char]0x0151 + ')'), ('  --no-budget                  nincs k' + [char]0x00F6 + 'lt' + [char]0x00E9 + 'si korl' + [char]0x00E1 + 't (a csapat csak a szolg' + [char]0x00E1 + 'ltat' + [char]0x00F3 + ' egyenleg' + [char]0x00E9 + 'n' + [char]0x00E9 + 'l ' + [char]0x00E1 + 'll meg)'), ('  --skip-health                kihagyja a v' + [char]0x00E9 + 'gs' + [char]0x0151 + ' ellen' + [char]0x0151 + 'rz' + [char]0x00E9 + 'st'), ('  --reset                      tiszta be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'sb' + [char]0x00F3 + 'l indul ' + [char]0x00FA + 'jra'), '', ('P' + [char]0x00E9 + 'ld' + [char]0x00E1 + 'k:'), ('  egy f' + [char]0x00E1 + 'jlban l' + [char]0x00E9 + 'v' + [char]0x0151 + ' GLM-kulccsal:'), '    jht setup --non-interactive --provider glm --harness pi --api-key-file kulcs.txt', '  OpenAI API-kulccsal, Pi-n (Claude-hoz: --provider claude):', '    jht setup --non-interactive --provider openai --harness pi --api-key-stdin') -join [char]10) }
    'hu:help.tools' { return ((('Haszn' + [char]0x00E1 + 'lat: jht tools <parancs>'), '', ('  status --json   megvannak-e a felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) eszk' + [char]0x00F6 + 'zei (a teljes k' + [char]0x00E9 + 'p), ' + [char]0x00FA + 'ton vannak-e, vagy sikertelen volt a let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's'), ('  pull            let' + [char]0x00F6 + 'lti ' + [char]0x0151 + 'ket a h' + [char]0x00E1 + 'tt' + [char]0x00E9 + 'rben (a jht up ' + [char]0x00E9 + 's a jht setup mag' + [char]0x00E1 + 't' + [char]0x00F3 + 'l elind' + [char]0x00ED + 'tja)'), ('  switch          ' + [char]0x00E1 + 'tviszi r' + [char]0x00E1 + 'juk a csapatot, amint a bevezet' + [char]0x00E9 + 's lez' + [char]0x00E1 + 'rult (a let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's mag' + [char]0x00E1 + 't' + [char]0x00F3 + 'l megteszi)'), '', ('Ez a s' + [char]0x00FA + 'g' + [char]0x00F3 + ' semmit nem ind' + [char]0x00ED + 't el ' + [char]0x00E9 + 's semmit nem t' + [char]0x00F6 + 'lt le.')) -join [char]10) }
    'hu:host_setup.timezone_explain' { return ('A Kapit' + [char]0x00E1 + 'ny ezt haszn' + [char]0x00E1 + 'lja az id' + [char]0x0151 + 'pontok ' + [char]0x00E1 + 'tv' + [char]0x00E1 + 'lt' + [char]0x00E1 + 's' + [char]0x00E1 + 'ra Telegram ' + [char]0x00FC + 'zenetekben ' + [char]0x00E9 + 's grafikonokon.') }
    'hu:host_setup.timezone_header' { return ('Id' + [char]0x0151 + 'z' + [char]0x00F3 + 'na') }
    'hu:host_setup.timezone_label' { return ('Id' + [char]0x0151 + 'z' + [char]0x00F3 + 'na') }
    'hu:host_setup.timezone_vps_utc' { return ('Az id' + [char]0x0151 + 'z' + [char]0x00F3 + 'n' + [char]0x00E1 + 't nem siker' + [char]0x00FC + 'lt felismerni: a csapat UTC-t fog haszn' + [char]0x00E1 + 'lni. ' + [char]0x00C1 + 'll' + [char]0x00ED + 'tsd be a saj' + [char]0x00E1 + 'todat a jht wh --tz Europe/Budapest paranccsal (vagy a vez' + [char]0x00E9 + 'rl' + [char]0x0151 + 'pulton), k' + [char]0x00FC + 'l' + [char]0x00F6 + 'nben a Telegram ' + [char]0x00E9 + 's a munkaid' + [char]0x0151 + ' id' + [char]0x0151 + 'pontjai UTC-ben lesznek.') }
    'hu:host_setup.tz.bad_number' { return ('V' + [char]0x00E1 + 'lassz egy sz' + [char]0x00E1 + 'mot 1 ' + [char]0x00E9 + 's %d k' + [char]0x00F6 + 'z' + [char]0x00F6 + 'tt.') }
    'hu:host_setup.tz.how' { return ('' + [char]0x00CD + 'rj be egy orsz' + [char]0x00E1 + 'got, egy v' + [char]0x00E1 + 'rost vagy egy id' + [char]0x0151 + 'z' + [char]0x00F3 + 'n' + [char]0x00E1 + 't (p' + [char]0x00E9 + 'ld' + [char]0x00E1 + 'ul Magyarorsz' + [char]0x00E1 + 'g, Budapest, Europe/Budapest).') }
    'hu:host_setup.tz.how_default' { return ('Nyomj Entert, ha megtartod ezt: %s, vagy ' + [char]0x00ED + 'rj be egy orsz' + [char]0x00E1 + 'got, egy v' + [char]0x00E1 + 'rost vagy egy id' + [char]0x0151 + 'z' + [char]0x00F3 + 'n' + [char]0x00E1 + 't, hogy m' + [char]0x00E1 + 'sikat keress.') }
    'hu:host_setup.tz.none' { return ('Nincs id' + [char]0x0151 + 'z' + [char]0x00F3 + 'na ehhez: ' + [char]0x00AB + '%s' + [char]0x00BB + '. ' + [char]0x00CD + 'rd be az orsz' + [char]0x00E1 + 'got (p' + [char]0x00E9 + 'ld' + [char]0x00E1 + 'ul Magyarorsz' + [char]0x00E1 + 'g) vagy egy k' + [char]0x00F6 + 'zeli nagyv' + [char]0x00E1 + 'rost.') }
    'hu:host_setup.tz.not_detected' { return ('Az id' + [char]0x0151 + 'z' + [char]0x00F3 + 'n' + [char]0x00E1 + 'dat nem siker' + [char]0x00FC + 'lt felismerni.') }
    'hu:host_setup.tz.pick' { return ('Sz' + [char]0x00E1 + 'm (1-%d), vagy ' + [char]0x00FA + 'j keres' + [char]0x00E9 + 's:') }
    'hu:host_setup.tz.proposed' { return 'Javasolt: %s (most %s).' }
    'hu:host_setup.tz.saved_and_detected' { return ('Mentve: %s (most %s) ' + [char]0x00B7 + ' Most felismerve: %s (most %s)') }
    'hu:host_setup.tz.too_many' { return ('%d id' + [char]0x0151 + 'z' + [char]0x00F3 + 'na illik erre: ' + [char]0x00AB + '%s' + [char]0x00BB + '. ' + [char]0x00CD + 'rj be valami pontosabbat (p' + [char]0x00E9 + 'ld' + [char]0x00E1 + 'ul egy v' + [char]0x00E1 + 'rost).') }
    'hu:keyfile.both' { return ('a --api-key-file vagy a --api-key-stdin kapcsol' + [char]0x00F3 + 't haszn' + [char]0x00E1 + 'ld, ne mindkett' + [char]0x0151 + 't') }
    'hu:keyfile.not_file' { return ('a --api-key-file kapcsol' + [char]0x00F3 + 'nak megadott f' + [char]0x00E1 + 'jlnak k' + [char]0x00F6 + 'z' + [char]0x00F6 + 'ns' + [char]0x00E9 + 'ges f' + [char]0x00E1 + 'jlnak kell lennie, nem mapp' + [char]0x00E1 + 'nak vagy linknek: %s') }
    'hu:keyfile.shape' { return ('a --api-key-file kapcsol' + [char]0x00F3 + 'nak megadott f' + [char]0x00E1 + 'jl tartalma nem egyetlen, 16' + [char]0x2013 + '512 nyomtathat' + [char]0x00F3 + ' karakterb' + [char]0x0151 + 'l ' + [char]0x00E1 + 'll' + [char]0x00F3 + ', sz' + [char]0x00F3 + 'k' + [char]0x00F6 + 'z n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'li sor: %s') }
    'hu:keyfile.size' { return ('a --api-key-file kapcsol' + [char]0x00F3 + 'nak megadott f' + [char]0x00E1 + 'jl ' + [char]0x00FC + 'res, vagy t' + [char]0x00FA + 'l nagy egy kulcshoz (1' + [char]0x2013 + '4096 b' + [char]0x00E1 + 'jt): %s') }
    'hu:keyfile.twice' { return ('a --api-key-file kapcsol' + [char]0x00F3 + 't k' + [char]0x00E9 + 'tszer adtad meg') }
    'hu:keyfile.unreadable' { return ('a --api-key-file kapcsol' + [char]0x00F3 + 'nak megadott f' + [char]0x00E1 + 'jl nem olvashat' + [char]0x00F3 + ': %s') }
    'hu:line.abbinamento_annullato_nessuna_modifica' { return ('P' + [char]0x00E1 + 'ros' + [char]0x00ED + 't' + [char]0x00E1 + 's megszak' + [char]0x00ED + 'tva: nincs v' + [char]0x00E1 + 'ltoz' + [char]0x00E1 + 's.') }
    'hu:line.abbinamento_di_s_non_riuscito' { return ('%s p' + [char]0x00E1 + 'ros' + [char]0x00ED + 't' + [char]0x00E1 + 'sa nem siker' + [char]0x00FC + 'lt: a r' + [char]0x00E9 + 'gi m' + [char]0x00E1 + 'solatok mind megmaradnak. Futtasd ' + [char]0x00FA + 'jra a jht telegram pair --all parancsot: a m' + [char]0x00E1 + 'r p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tott szerepek nem k' + [char]0x00E9 + 'rnek ' + [char]0x00FA + 'j tokent.') }
    'hu:line.abbinamento_rifiutato_genera_un_token' { return ('P' + [char]0x00E1 + 'ros' + [char]0x00ED + 't' + [char]0x00E1 + 's elutas' + [char]0x00ED + 'tva: gener' + [char]0x00E1 + 'lj ' + [char]0x00FA + 'j tokent a BotFatherben (/revoke), ' + [char]0x00E9 + 's pr' + [char]0x00F3 + 'b' + [char]0x00E1 + 'ld ' + [char]0x00FA + 'jra.') }
    'hu:line.agent_restart_failed.inventario_conservato_ma_il_team' { return ('a lelt' + [char]0x00E1 + 'r megmaradt, de a csapat nem indult ' + [char]0x00FA + 'jra. Teend' + [char]0x0151 + ': jht up') }
    'hu:line.annullato_niente_autorizzato' { return ('Megszak' + [char]0x00ED + 'tva: semmi sincs enged' + [char]0x00E9 + 'lyezve.') }
    'hu:line.anteprima_non_valida_niente_autorizzato' { return ('' + [char]0x00C9 + 'rv' + [char]0x00E9 + 'nytelen el' + [char]0x0151 + 'n' + [char]0x00E9 + 'zet: semmi sincs enged' + [char]0x00E9 + 'lyezve.') }
    'hu:line.apply.authorize' { return ('Enged' + [char]0x00E9 + 'lyezed ezt a jelentkez' + [char]0x00E9 + 'st?') }
    'hu:line.apply_relink_account_cloud_account' { return ('apply relink-account: a felh' + [char]0x0151 + 'fi' + [char]0x00F3 + 'k nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el. El' + [char]0x0151 + 'bb futtasd a jht cloud pair parancsot.') }
    'hu:line.autorizzata_s_verso_s_il' { return ('#%s enged' + [char]0x00E9 + 'lyezve, c' + [char]0x00ED + 'm: %s: a CLOSER a k' + [char]0x00F6 + 'vetkez' + [char]0x0151 + ' k' + [char]0x00F6 + 'rben veszi ' + [char]0x00E1 + 't.') }
    'hu:line.bot_abbinato_e_copia_legacy' { return ('A bot p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tva, a r' + [char]0x00E9 + 'gi m' + [char]0x00E1 + 'solat elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva. Maradtak m' + [char]0x00E9 + 'g r' + [char]0x00E9 + 'gi tokenek, vagy van egy token a kont' + [char]0x00E9 + 'ner k' + [char]0x00F6 + 'rnyezet' + [char]0x00E9 + 'ben: t' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tsd el ' + [char]0x0151 + 'ket, ' + [char]0x00E9 + 's fejezd be a cser' + [char]0x00E9 + 't az ' + [char]0x00E1 + 't' + [char]0x00E1 + 'll' + [char]0x00E1 + 's el' + [char]0x0151 + 'tt.') }
    'hu:line.bot_token_invalid.controlla_il_token_generato_da' { return ('ellen' + [char]0x0151 + 'rizd a BotFather ' + [char]0x00E1 + 'ltal gener' + [char]0x00E1 + 'lt tokent.') }
    'hu:line.broker_restart_failed.il_servizio_della_posta_non_4' { return ('a levelez' + [char]0x00E9 + 'si szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's nem indult ' + [char]0x00FA + 'jra. Teend' + [char]0x0151 + ': jht mail status') }
    'hu:line.broker_start_failed.il_servizio_della_posta_non_2' { return ('a levelez' + [char]0x00E9 + 'si szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's nem indult el.') }
    'hu:line.broker_start_failed.il_servizio_della_posta_non_3' { return ('a levelez' + [char]0x00E9 + 'si szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's 30 m' + [char]0x00E1 + 'sodperc ut' + [char]0x00E1 + 'n sem v' + [char]0x00E1 + 'laszol.') }
    'hu:line.broker_unavailable.il_broker_dei_segreti_esiste' { return ('a titokbroker l' + [char]0x00E9 + 'tezik, de nem igazolhat' + [char]0x00F3 + ', hogy a mi' + [char]0x00E9 + 'nk: nem ny' + [char]0x00FA + 'lok hozz' + [char]0x00E1 + '.') }
    'hu:line.broker_unavailable.il_runtime_installato_pi_vecchio_2' { return ('a telep' + [char]0x00ED + 'tett futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet r' + [char]0x00E9 + 'gebbi, ' + [char]0x00E9 + 's nincs benne titokbroker.') }
    'hu:line.broker_unavailable.il_servizio_della_posta_non' { return ('a levelez' + [char]0x00E9 + 'si szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's m' + [char]0x00E9 + 'g nem l' + [char]0x00E9 + 'tezik: az els' + [char]0x0151 + ' alkalommal j' + [char]0x00F6 + 'n l' + [char]0x00E9 + 'tre, amikor sz' + [char]0x00FC + 'ks' + [char]0x00E9 + 'g van r' + [char]0x00E1 + '.') }
    'hu:line.cancellato_marcatore_migrazione_broker_s' { return ('T' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve: a broker migr' + [char]0x00E1 + 'ci' + [char]0x00F3 + 's jel' + [char]0x00F6 + 'l' + [char]0x0151 + 'je, %s') }
    'hu:line.cancellato_volume_broker_s_s' { return ('T' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve: %s brokerk' + [char]0x00F6 + 'tet (%s)') }
    'hu:line.container_s_non_e_partito' { return ('A(z) ''%s'' kont' + [char]0x00E9 + 'ner nem indult el 10 m' + [char]0x00E1 + 'sodpercen bel' + [char]0x00FC + 'l. N' + [char]0x00E9 + 'zd meg: ''jht logs''.') }
    'hu:line.cosa_fare_jht_mail_setup' { return ('Teend' + [char]0x0151 + ': jht mail setup') }
    'hu:line.cosa_fare_jht_up_3' { return ('Teend' + [char]0x0151 + ': jht up') }
    'hu:line.cosa_fare_jht_upgrade_4' { return ('Teend' + [char]0x0151 + ': jht upgrade') }
    'hu:line.cosa_fare_riprova_il_comando_2' { return ('Teend' + [char]0x0151 + ': pr' + [char]0x00F3 + 'b' + [char]0x00E1 + 'ld ' + [char]0x00FA + 'jra a parancsot') }
    'hu:line.fino_ad_allora_la_posta' { return ('Addig a leveleket a mostani jelsz' + [char]0x00F3 + 'val lehet olvasni ' + [char]0x00E9 + 's k' + [char]0x00FC + 'ldeni; a figyelmeztet' + [char]0x00E9 + 's a jht mail status kimenet' + [char]0x00E9 + 'ben marad.') }
    'hu:line.genera_una_nuova_password_per' { return ('gener' + [char]0x00E1 + 'lj ' + [char]0x00FA + 'j alkalmaz' + [char]0x00E1 + 'sjelsz' + [char]0x00F3 + 't a szolg' + [char]0x00E1 + 'ltat' + [char]0x00F3 + 'dn' + [char]0x00E1 + 'l, ' + [char]0x00E9 + 's mentsd el ezzel: jht mail setup') }
    'hu:line.i_segreti_e_lo_stato' { return ('A titkok ' + [char]0x00E9 + 's a broker ' + [char]0x00E1 + 'llapota t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve: jelentkezz be ' + [char]0x00FA + 'jra a port' + [char]0x00E1 + 'lokra, ' + [char]0x00E9 + 's ' + [char]0x00E1 + 'll' + [char]0x00ED + 'tsd be ' + [char]0x00FA + 'jra a levelez' + [char]0x00E9 + 'st.') }
    'hu:line.il_broker_non_ha_registrato' { return ('A broker nem r' + [char]0x00F6 + 'gz' + [char]0x00ED + 'tette az enged' + [char]0x00E9 + 'lyt: visszavonva, semmi sem indul el.') }
    'hu:line.integration.install_hint' { return ('a telep' + [char]0x00ED + 't' + [char]0x00E9 + 's' + [char]0x00FC + 'kh' + [char]0x00F6 + 'z: ''jht upgrade'' (vagy egy ''jht integration add <id>'')') }
    'hu:line.interattivo_il_token_viene_chiesto' { return ('Interakt' + [char]0x00ED + 'v: a tokent kijelz' + [char]0x00E9 + 's n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l k' + [char]0x00E9 + 'ri, majd az ' + [char]0x00FA + 'j bot egyszer haszn' + [char]0x00E1 + 'latos k' + [char]0x00F3 + 'dot kap a Telegramodr' + [char]0x00F3 + 'l. Automatiz' + [char]0x00E1 + 'l' + [char]0x00E1 + 'shoz: {"bot_token": ...} JSON-k' + [char]0x00E9 + 'nt a stdin-en; ne mentsd a tokent a ~/.jht mapp' + [char]0x00E1 + 'ba, ' + [char]0x00E9 + 's azonnal t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'ld az azon k' + [char]0x00ED + 'v' + [char]0x00FC + 'l haszn' + [char]0x00E1 + 'lt f' + [char]0x00E1 + 'jlokat.') }
    'hu:line.jht_telegram_pair_all_interattivo' { return ('a jht telegram pair --all interakt' + [char]0x00ED + 'v: automatiz' + [char]0x00E1 + 'l' + [char]0x00E1 + 'shoz egyszerre egy szerepet p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'ts.') }
    'hu:line.job_hunter_team_non_installato' { return ('A Job Hunter Team nincs teljesen telep' + [char]0x00ED + 'tve: a futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet mapp' + [char]0x00E1 + 'j' + [char]0x00E1 + 'b' + [char]0x00F3 + 'l hi' + [char]0x00E1 + 'nyzik az integrit' + [char]0x00E1 + 'sf' + [char]0x00E1 + 'jl (megszakadt telep' + [char]0x00ED + 't' + [char]0x00E9 + 's?). Futtasd ' + [char]0x00FA + 'jra a telep' + [char]0x00ED + 't' + [char]0x0151 + 't.') }
    'hu:line.la_casella_di_posta_ora' { return ('A postafi' + [char]0x00F3 + 'k most a titokbrokerben van. A jelszav' + [char]0x00E1 + 't az ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'k olvasni tudt' + [char]0x00E1 + 'k:') }
    'hu:line.legacy_cleanup_failed.i_token_nuovi_sono_al' { return ('az ' + [char]0x00FA + 'j tokenek biztons' + [char]0x00E1 + 'gban vannak, de %s r' + [char]0x00E9 + 'gi m' + [char]0x00E1 + 'solata m' + [char]0x00E9 + 'g a ~/.jht mapp' + [char]0x00E1 + 'ban van; az ' + [char]0x00E1 + 't' + [char]0x00E1 + 'll' + [char]0x00E1 + 's megtagadva.') }
    'hu:line.legacy_inventory_failed.il_team_resta_fermo_perch_4' { return ('a csapat le' + [char]0x00E1 + 'll' + [char]0x00ED + 'tva marad, mert a g' + [char]0x00E9 + 'pen l' + [char]0x00E9 + 'v' + [char]0x0151 + ' Telegram-lelt' + [char]0x00E1 + 'r nem maradt meg.') }
    'hu:line.legacy_inventory_failed.le_impronte_non_sono_state' { return ('az ujjlenyomatokat az elk' + [char]0x00FC + 'l' + [char]0x00F6 + 'n' + [char]0x00ED + 'tett szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's nem ' + [char]0x0151 + 'rizte meg.') }
    'hu:line.legacy_inventory_failed.migrazione_telegram_interrotta' { return ('a Telegram-migr' + [char]0x00E1 + 'ci' + [char]0x00F3 + ' megszakadt.') }
    'hu:line.legacy_inventory_failed.non_posso_provare_che_jht' { return ('nem tudom bizony' + [char]0x00ED + 'tani, hogy a ~/.jht nem tartalmaz Telegram-tokent.') }
    'hu:line.legacy_inventory_failed.non_riesco_a_fermare_gli' { return ('nem tudom le' + [char]0x00E1 + 'll' + [char]0x00ED + 'tani az ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'ket a g' + [char]0x00E9 + 'pen l' + [char]0x00E9 + 'v' + [char]0x0151 + ' lelt' + [char]0x00E1 + 'r el' + [char]0x0151 + 'tt.') }
    'hu:line.legacy_inventory_failed.non_riesco_a_leggere_i' { return ('nem tudom beolvasni a r' + [char]0x00E9 + 'gi tokeneket a ~/.jht mapp' + [char]0x00E1 + 'ban.') }
    'hu:line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti' { return ('ismeretlen r' + [char]0x00E9 + 'gi szerepek.') }
    'hu:line.legacy_remove_failed.s_nel_broker_ma_la' { return ('%s a brokerben van, de a ~/.jht/credentials mapp' + [char]0x00E1 + 'ban l' + [char]0x00E9 + 'v' + [char]0x0151 + ' m' + [char]0x00E1 + 'solat megmaradt.') }
    'hu:line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso' { return ('a ~/.jht/credentials/%s.json a migr' + [char]0x00E1 + 'ci' + [char]0x00F3 + ' ut' + [char]0x00E1 + 'n ' + [char]0x00FA + 'jra megjelent; import' + [char]0x00E1 + 'l' + [char]0x00E1 + 's n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tottam.') }
    'hu:line.mail.address_prompt' { return ('A postafi' + [char]0x00F3 + 'k c' + [char]0x00ED + 'me:') }
    'hu:line.mail.app_password_prompt' { return ('Alkalmaz' + [char]0x00E1 + 'sjelsz' + [char]0x00F3 + ' (nem jelenik meg):') }
    'hu:line.mail.dedicated_prompt' { return ('Ez a postafi' + [char]0x00F3 + 'k KIZ' + [char]0x00C1 + 'R' + [char]0x00D3 + 'LAG a tov' + [char]0x00E1 + 'bb' + [char]0x00ED + 'tott ' + [char]0x00E1 + 'll' + [char]0x00E1 + 's' + [char]0x00E9 + 'rtes' + [char]0x00ED + 't' + [char]0x0151 + 'knek sz' + [char]0x00F3 + 'l?') }
    'hu:line.mail_setup_opzione_sconosciuta_s' { return ('mail setup: ismeretlen kapcsol' + [char]0x00F3 + ': %s') }
    'hu:line.mail_setup_password_vuota' { return ('mail setup: ' + [char]0x00FC + 'res jelsz' + [char]0x00F3) }
    'hu:line.nessun_provider_attivo_scegline_uno' { return ('nincs akt' + [char]0x00ED + 'v szolg' + [char]0x00E1 + 'ltat' + [char]0x00F3 + ': v' + [char]0x00E1 + 'lassz egyet a ''jht providers use glm'' paranccsal') }
    'hu:line.nessun_ruolo_ha_un_token' { return ('Egyik szerepnek sincs r' + [char]0x00E9 + 'gi tokenje: ' + [char]0x00FA + 'j bothoz haszn' + [char]0x00E1 + 'ld a jht telegram pair <szerep> parancsot.') }
    'hu:line.non_autorizzabile_s' { return ('Nem enged' + [char]0x00E9 + 'lyezhet' + [char]0x0151 + ': %s.') }
    'hu:line.non_autorizzata_s' { return ('Nincs enged' + [char]0x00E9 + 'lyezve: %s.') }
    'hu:line.os_and_version_are_required' { return ('a --os ' + [char]0x00E9 + 's a --version k' + [char]0x00F6 + 'telez' + [char]0x0151) }
    'hu:line.podman_non_trovato_reinstalla_il' { return ('A Podman nem tal' + [char]0x00E1 + 'lhat' + [char]0x00F3 + ': telep' + [char]0x00ED + 'tsd ' + [char]0x00FA + 'jra a JHT futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet' + [char]0x00E9 + 't.') }
    'hu:line.preparo_il_servizio_della_posta' { return ('El' + [char]0x0151 + 'k' + [char]0x00E9 + 'sz' + [char]0x00ED + 'tem a levelez' + [char]0x00E9 + 'si szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 'st (csak az els' + [char]0x0151 + ' alkalommal j' + [char]0x00F6 + 'n l' + [char]0x00E9 + 'tre, amikor sz' + [char]0x00FC + 'ks' + [char]0x00E9 + 'g van r' + [char]0x00E1 + ')' + [char]0x2026) }
    'hu:line.provider_attivo_non_riconosciuto_s' { return ('ismeretlen akt' + [char]0x00ED + 'v szolg' + [char]0x00E1 + 'ltat' + [char]0x00F3 + ': %s') }
    'hu:line.reset_impossibile_cancellare_il_marcatore' { return ('reset: nem lehet t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lni a broker migr' + [char]0x00E1 + 'ci' + [char]0x00F3 + 's jel' + [char]0x00F6 + 'l' + [char]0x0151 + 'j' + [char]0x00E9 + 't: %s.') }
    'hu:line.reset_impossibile_cancellare_il_marcatore_2' { return ('reset: nem lehet t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lni a broker jel' + [char]0x00F6 + 'l' + [char]0x0151 + 'j' + [char]0x00E9 + 't: %s.') }
    'hu:line.reset_impossibile_cancellare_il_volume' { return ('reset: nem lehet t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lni a(z) %s brokerk' + [char]0x00F6 + 'tetet (%s).') }
    'hu:line.reset_nome_volume_non_valido' { return ('reset: ' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nytelen k' + [char]0x00F6 + 'tetn' + [char]0x00E9 + 'v ehhez: %s; az elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 't' + [char]0x00E1 + 's megtagadva.') }
    'hu:line.reset_non_riesco_a_determinare' { return ('reset: nem tudom meghat' + [char]0x00E1 + 'rozni a Compose-projektet; a broker k' + [char]0x00F6 + 'teteihez nem ny' + [char]0x00FA + 'ltam.') }
    'hu:line.reset_non_riesco_a_fermare' { return ('reset: nem tudom le' + [char]0x00E1 + 'll' + [char]0x00ED + 'tani a futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezetet; a broker k' + [char]0x00F6 + 'teteihez nem ny' + [char]0x00FA + 'ltam.') }
    'hu:line.reset_ricerca_del_volume_s_2' { return ('reset: a(z) %s k' + [char]0x00F6 + 'tet keres' + [char]0x00E9 + 'se nem siker' + [char]0x00FC + 'lt.') }
    'hu:line.restano_token_legacy_per_s' { return ('R' + [char]0x00E9 + 'gi tokenek maradtak ezekhez: %s. Am' + [char]0x00ED + 'g ezeket a szerepeket is nem p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tod, %s n' + [char]0x00E9 + 'ma marad a Telegramon: p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tsd mindet ebben a menetben (jht telegram pair --all).') }
    'hu:line.risposta_del_container_non_valida' { return ('' + [char]0x00C9 + 'rv' + [char]0x00E9 + 'nytelen v' + [char]0x00E1 + 'lasz a kont' + [char]0x00E9 + 'nert' + [char]0x0151 + 'l: az enged' + [char]0x00E9 + 'ly visszavonva, semmi sem indul el.') }
    'hu:line.ritirata_s_non_verra_inviata' { return ('#%s visszavonva: nem lesz elk' + [char]0x00FC + 'ldve.') }
    'hu:line.ritiro_non_riuscito_s' { return ('A visszavon' + [char]0x00E1 + 's nem siker' + [char]0x00FC + 'lt: %s.') }
    'hu:line.runtime_migration_docker_missing.il_client_docker_originale_non' { return ('az eredeti Docker-kliens nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el.') }
    'hu:line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata' { return ('digest alapj' + [char]0x00E1 + 'n r' + [char]0x00F6 + 'gz' + [char]0x00ED + 'tett JHT-k' + [char]0x00E9 + 'p kell.') }
    'hu:line.runtime_migration_podman_missing.podman_non_e_disponibile' { return ('a Podman nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el.') }
    'hu:line.runtime_migration_team_running.ferma_prima_il_team_docker' { return ('el' + [char]0x0151 + 'bb ' + [char]0x00E1 + 'll' + [char]0x00ED + 'tsd le a Docker-csapatot.') }
    'hu:line.runtime_migration_team_running.ferma_prima_il_team_podman' { return ('el' + [char]0x0151 + 'bb ' + [char]0x00E1 + 'll' + [char]0x00ED + 'tsd le a Podman-csapatot.') }
    'hu:line.runtime_o_container_jht_non' { return ('a JHT futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezete vagy kont' + [char]0x00E9 + 'nere nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el') }
    'hu:line.ruoli_da_abbinare_in_questa' { return ('Ebben a menetben p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tand' + [char]0x00F3 + ' szerepek: %s') }
    'hu:line.s_ha_gi_un_bot' { return ('%s: m' + [char]0x00E1 + 'r van p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tott bot: csak a r' + [char]0x00E9 + 'gi m' + [char]0x00E1 + 'solat' + [char]0x00E1 + 't t' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tom el.') }
    'hu:line.s_needs_a_value' { return ('%s: ' + [char]0x00E9 + 'rt' + [char]0x00E9 + 'k kell hozz' + [char]0x00E1) }
    'hu:line.saltato_non_trovato_volume_broker' { return ('Kihagyva (nem tal' + [char]0x00E1 + 'lhat' + [char]0x00F3 + '): %s brokerk' + [char]0x00F6 + 'tet') }
    'hu:line.serve_un_terminale_l_autorizzazione' { return ('Termin' + [char]0x00E1 + 'l kell: az enged' + [char]0x00E9 + 'lyt k' + [char]0x00E9 + 'zzel kell meger' + [char]0x0151 + 's' + [char]0x00ED + 'teni.') }
    'hu:line.telegram_isolato_attivo_il_bridge' { return ('Az elk' + [char]0x00FC + 'l' + [char]0x00F6 + 'n' + [char]0x00ED + 'tett Telegram akt' + [char]0x00ED + 'v; a r' + [char]0x00E9 + 'gi bridge-et az ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'k m' + [char]0x00E1 + 'r nem kapcsolhatj' + [char]0x00E1 + 'k vissza.') }
    'hu:line.the_setup_keeps_the_key' { return ('A be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's meg' + [char]0x0151 + 'rzi a kulcsot: most m' + [char]0x00E1 + 'r t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lheted a f' + [char]0x00E1 + 'jlt err' + [char]0x0151 + 'l a g' + [char]0x00E9 + 'pr' + [char]0x0151 + 'l (%s).') }
    'hu:line.upgrade.done' { return ('A friss' + [char]0x00ED + 't' + [char]0x00E9 + 's k' + [char]0x00E9 + 'sz: %s (%s) -> %s (%s). %s') }
    'hu:line.upgrade.restored' { return ('Az el' + [char]0x0151 + 'z' + [char]0x0151 + ' futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet vissza' + [char]0x00E1 + 'll' + [char]0x00ED + 'tva.') }
    'hu:line.uso_jht_apply_relink_account' { return ('haszn' + [char]0x00E1 + 'lat: jht apply relink-account') }
    'hu:line.uso_jht_apply_request_cancel_2' { return ('haszn' + [char]0x00E1 + 'lat: jht apply request|cancel <id>') }
    'hu:line.uso_jht_mail_setup_status' { return ('haszn' + [char]0x00E1 + 'lat: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <c' + [char]0x00ED + 'm|@domain>|drafts|approve <id>|discard <id>|journal|delete|migrate') }
    'hu:line.uso_jht_migrate_runtime_podman' { return ('haszn' + [char]0x00E1 + 'lat: jht migrate-runtime podman') }
    'hu:line.uso_jht_screen_on_off' { return ('haszn' + [char]0x00E1 + 'lat: jht screen on | off | status [--json]') }
    'hu:line.uso_jht_telegram_chat_id' { return ('haszn' + [char]0x00E1 + 'lat: jht telegram chat-id <assistente|capitano|mentor>') }
    'hu:line.uso_jht_telegram_pair_assistente' { return ('haszn' + [char]0x00E1 + 'lat: jht telegram pair <assistente|capitano|mentor>|--all') }
    'hu:line.uso_jht_telegram_remove_assistente' { return ('haszn' + [char]0x00E1 + 'lat: jht telegram remove <assistente|capitano|mentor>') }
    'hu:line.uso_jht_telegram_status_pair' { return ('haszn' + [char]0x00E1 + 'lat: jht telegram status|pair <szerep>|pair --all|chat-id <szerep>|remove <szerep>') }
    'hu:monitor.window_invalid' { return ('monitor_window_invalid: a ''jht monitor --window'' parancsot m' + [char]0x00E1 + 's kapcsol' + [char]0x00F3 + 'k n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l haszn' + [char]0x00E1 + 'ld.') }
    'hu:ps.apply_auto_send_warning_1' { return ('  Bekapcsolt automatikus k' + [char]0x00FC + 'ld' + [char]0x00E9 + 'sn' + [char]0x00E9 + 'l a csapat kit' + [char]0x00F6 + 'lti ' + [char]0x00C9 + 'S ELK' + [char]0x00DC + 'LDI a jelentkez' + [char]0x00E9 + 'st,') }
    'hu:ps.apply_auto_send_warning_2' { return ('  ' + [char]0x00FA + 'jabb meger' + [char]0x0151 + 's' + [char]0x00ED + 't' + [char]0x00E9 + 's n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l. Ha egyszer elment, nem h' + [char]0x00ED + 'vhat' + [char]0x00F3 + ' vissza.') }
    'hu:ps.artifact_copied' { return ('A(z) %s f' + [char]0x00E1 + 'jlt ' + [char]0x00E1 + 'tm' + [char]0x00E1 + 'soltam ide: %s, hogy a csapat el tudja olvasni.') }
    'hu:ps.artifact_copy_failed' { return ('nem tudom a(z) %s f' + [char]0x00E1 + 'jlt a megosztott mapp' + [char]0x00E1 + 'ba m' + [char]0x00E1 + 'solni: %s') }
    'hu:ps.artifact_copy_refused' { return ('%s nem m' + [char]0x00E1 + 'solhat' + [char]0x00F3 + ': a(z) %s hivatkoz' + [char]0x00E1 + 's, vagy nincs a megosztott mapp' + [char]0x00E1 + 'n bel' + [char]0x00FC + 'l') }
    'hu:ps.bot_token_prompt_hidden' { return 'A(z) %s bot tokenje (rejtett bevitel)' }
    'hu:ps.botfather_fresh_token' { return ('Mindig a BotFatherben frissen gener' + [char]0x00E1 + 'lt tokent haszn' + [char]0x00E1 + 'lj (/revoke a boton, vagy egy ' + [char]0x00FA + 'j bot): egy m' + [char]0x00E1 + 'r l' + [char]0x00E9 + 'tez' + [char]0x0151 + ' tokent az ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'k elolvashattak, akkor is, ha ma m' + [char]0x00E1 + 'r nem szerepel a ~/.jht mapp' + [char]0x00E1 + 'ban.') }
    'hu:ps.broker_network_proxy_not_ready' { return ('broker_network_unavailable: a levelez' + [char]0x00E9 + 'si proxy nem ' + [char]0x00E1 + 'll k' + [char]0x00E9 + 'szen (k' + [char]0x00F3 + 'd: %s).') }
    'hu:ps.broker_network_scripts_not_downloadable' { return ('broker_network_unavailable: nem tudom let' + [char]0x00F6 + 'lteni a levelez' + [char]0x00E9 + 'si proxy szkriptjeit. Teend' + [char]0x0151 + ': jht upgrade') }
    'hu:ps.broker_network_scripts_not_verified' { return ('broker_network_unavailable: a levelez' + [char]0x00E9 + 'si proxy szkriptjei nem igazolhat' + [char]0x00F3 + 'k. Teend' + [char]0x0151 + ': jht upgrade') }
    'hu:ps.broker_restart_failed_secrets_broker_not_ours' { return ('broker_restart_failed: a titokbroker nem igazolhat' + [char]0x00F3 + ' a saj' + [char]0x00E1 + 'tunkk' + [char]0x00E9 + 'nt: nem ny' + [char]0x00FA + 'lok hozz' + [char]0x00E1 + '. Teend' + [char]0x0151 + ': jht mail status') }
    'hu:ps.broker_unavailable_secrets_broker_not_running' { return 'broker_unavailable: a titokbroker nem fut.' }
    'hu:ps.cli_version_needs_container' { return ('A fut' + [char]0x00F3 + ' CLI verzi' + [char]0x00F3 + 'j' + [char]0x00E1 + 'hoz fut' + [char]0x00F3 + ' kont' + [char]0x00E9 + 'ner kell: ''jht up''.') }
    'hu:ps.compose_up_failed_team_not_started' { return ('compose_up_failed: a csapat nem indult el (docker compose up, k' + [char]0x00F3 + 'd: %s). N' + [char]0x00E9 + 'zd meg: ''jht logs''.') }
    'hu:ps.container_not_running' { return ('a(z) ''%s'' kont' + [char]0x00E9 + 'ner nem fut') }
    'hu:ps.container_runtime_unsupported' { return ('nem t' + [char]0x00E1 + 'mogatott kont' + [char]0x00E9 + 'ner-futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet: %s') }
    'hu:ps.docker_desktop_file_sharing_hint' { return ('  Teend' + [char]0x0151 + ': nyisd meg a Docker Desktop > Settings > Resources > File sharing r' + [char]0x00E9 + 'szt, ellen' + [char]0x0151 + 'rizd, hogy a felhaszn' + [char]0x00E1 + 'l' + [char]0x00F3 + ' mapp' + [char]0x00E1 + 'ja meg van osztva, majd futtasd ' + [char]0x00FA + 'jra a ''jht up'' parancsot.') }
    'hu:ps.docker_podman_verified_future_removal' { return ('A Docker -> Podman migr' + [char]0x00E1 + 'ci' + [char]0x00F3 + ' ellen' + [char]0x0151 + 'rizve. A Docker-k' + [char]0x00F6 + 'tetek ' + [char]0x00E9 + 'rintetlenek maradnak, ' + [char]0x00E9 + 's m' + [char]0x00E9 + 'g tartalmazz' + [char]0x00E1 + 'k a levelez' + [char]0x00E9 + 'si jelszavakat, a port' + [char]0x00E1 + 'lok hozz' + [char]0x00E1 + 'f' + [char]0x00E9 + 'r' + [char]0x00E9 + 'seit ' + [char]0x00E9 + 's a Telegram-tokeneket: az elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 't' + [char]0x00E1 + 'sukhoz a j' + [char]0x00F6 + 'v' + [char]0x0151 + 'ben kifejezett meger' + [char]0x0151 + 's' + [char]0x00ED + 't' + [char]0x00E9 + 's kell.') }
    'hu:ps.doctor.wsl_memory' { return ('A WSL-nek nincs mem' + [char]0x00F3 + 'riakorl' + [char]0x00E1 + 'tja (m' + [char]0x00E1 + 's WSL-disztrib' + [char]0x00FA + 'ci' + [char]0x00F3 + 'k is regisztr' + [char]0x00E1 + 'lva vannak): add hozz' + [char]0x00E1 + ' a(z) %s f' + [char]0x00E1 + 'jlban a [wsl2] alatt: memory=%s') }
    'hu:ps.download_asset_failed_detail' { return ('sikertelen let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's: %s (%s)') }
    'hu:ps.download_shared_folder_no_path' { return ('a c' + [char]0x00E9 + 'lhely egy, a csapattal megosztott mapp' + [char]0x00E1 + 'ban van: v' + [char]0x00E1 + 'lassz azon k' + [char]0x00ED + 'v' + [char]0x00FC + 'li helyet, p' + [char]0x00E9 + 'ld' + [char]0x00E1 + 'ul a Downloads mapp' + [char]0x00E1 + 't.') }
    'hu:ps.download_sums_failed_detail' { return ('sikertelen let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's: a v%s SHA256SUMS f' + [char]0x00E1 + 'jlja (%s)') }
    'hu:ps.full_pull_failed_keep_old' { return ('full_pull_failed: az ' + [char]0x00FA + 'j teljes k' + [char]0x00E9 + 'p nem ' + [char]0x00E9 + 'rkezett meg, a r' + [char]0x00E9 + 'gi marad. Teend' + [char]0x0151 + ': jht tools pull') }
    'hu:ps.help.main' { return (('jht - Job Hunter Team', '', ('  Gazdag' + [char]0x00E9 + 'p-parancsok (innen m' + [char]0x0171 + 'k' + [char]0x00F6 + 'dnek):'), ('    jht up                 elind' + [char]0x00ED + 'tja a csapat kont' + [char]0x00E9 + 'ner' + [char]0x00E9 + 't'), ('    jht down               le' + [char]0x00E1 + 'll' + [char]0x00ED + 'tja'), ('                           (a --verbose kapcsol' + [char]0x00F3 + 'val a motor sorai is l' + [char]0x00E1 + 'tszanak)'), ('    jht restart            ' + [char]0x00FA + 'jraind' + [char]0x00ED + 'tja'), ('    jht status             a kont' + [char]0x00E9 + 'ner ' + [char]0x00E9 + 's a csapat ' + [char]0x00E1 + 'llapota'), ('    jht logs [-f]          a kont' + [char]0x00E9 + 'ner napl' + [char]0x00F3 + 'ja'), ('    jht upgrade            friss' + [char]0x00ED + 't a leg' + [char]0x00FA + 'jabb k' + [char]0x00E9 + 'pre'), ('    jht setup              ir' + [char]0x00E1 + 'ny' + [char]0x00ED + 'tott telep' + [char]0x00ED + 't' + [char]0x00E9 + 's'), ('    jht shell              shell a kont' + [char]0x00E9 + 'neren bel' + [char]0x00FC + 'l'), ('    jht mail setup         elmenti a postafi' + [char]0x00F3 + 'kot a titokbrokerbe'), ('    jht mail drafts        az ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'k ' + [char]0x00E1 + 'ltal ' + [char]0x00ED + 'rt e-mailek, amelyek a j' + [char]0x00F3 + 'v' + [char]0x00E1 + 'hagy' + [char]0x00E1 + 'sodra v' + [char]0x00E1 + 'rnak'), ('    jht mail approve <id>  elk' + [char]0x00FC + 'ldi ' + [char]0x0151 + 'ket; a jht mail discard <id> elveti ' + [char]0x0151 + 'ket'), '    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]', ('                           a be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's ut' + [char]0x00E1 + 'n hozz' + [char]0x00E1 + 'adhat' + [char]0x00F3 + ' integr' + [char]0x00E1 + 'ci' + [char]0x00F3 + 'k'), ('                           (google, telegram, mail): az ' + [char]0x00E1 + 'llapotot a motorb' + [char]0x00F3 + 'l olvassa'), ('    jht telegram status    az elk' + [char]0x00FC + 'l' + [char]0x00F6 + 'n' + [char]0x00ED + 'tett Telegram-szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's ' + [char]0x00E1 + 'llapota'), ('    jht telegram pair ROLE kijelz' + [char]0x00E9 + 's n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l k' + [char]0x00E9 + 'ri a tokent a gazdag' + [char]0x00E9 + 'pen, majd'), ('                           mutat egy k' + [char]0x00F3 + 'dot, amelyet a Telegramodr' + [char]0x00F3 + 'l k' + [char]0x00FC + 'ldj el a botnak'), ('                           Automatiz' + [char]0x00E1 + 'l' + [char]0x00E1 + 'shoz: JSON a stdin-en. Ne mentsd a tokent'), ('                           a ~/.jht-be; az onnan k' + [char]0x00ED + 'v' + [char]0x00FC + 'l haszn' + [char]0x00E1 + 'lt f' + [char]0x00E1 + 'jlokat azonnal t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'ld.'), ('    jht telegram pair --all egy menetben p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tja az ' + [char]0x00F6 + 'sszes r' + [char]0x00E9 + 'gi szerepet'), ('    jht telegram chat-id ROLE ugyanazzal a k' + [char]0x00F3 + 'ddal m' + [char]0x00E1 + 'sik chatre k' + [char]0x00F6 + 'lt' + [char]0x00F6 + 'zteti a botot'), ('    jht reset              t' + [char]0x00F6 + 'rli a be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'st ' + [char]0x00E9 + 's a broker k' + [char]0x00F6 + 'teteit'), '    jht migrate-runtime podman', ('                           ' + [char]0x00E1 + 'tm' + [char]0x00E1 + 'solja ' + [char]0x00E9 + 's ellen' + [char]0x0151 + 'rzi a Docker-k' + [char]0x00F6 + 'teteket a Podmanbe; nem'), ('                           v' + [char]0x00E1 + 'lasztja ki az ' + [char]0x00FA + 'j futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezetet, ' + [char]0x00E9 + 's nem t' + [char]0x00F6 + 'rli a Dockert'), ('    jht uninstall --confirm elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tja a helyi Windows-futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezetet, de megtartja az'), ('                           adatokat, a dokumentumokat, a Podmant ' + [char]0x00E9 + 's a Composet'), '', ('  Az ' + [char]0x00F6 + 'sszes t' + [char]0x00F6 + 'bbi parancs (positions, stats, team, providers, cron,'), ('  working-hours, cloud...) a kont' + [char]0x00E9 + 'neren BEL' + [char]0x00DC + 'L fut: a s' + [char]0x00FA + 'g' + [char]0x00F3 + 'jukhoz'), ('  fut' + [char]0x00F3 + ' kont' + [char]0x00E9 + 'ner kell.'), '', '      jht up ; jht --help') -join [char]10) }
    'hu:ps.home_unavailable_bind_mount' { return ('a HOME/USERPROFILE nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el: a JHT bind mount elutas' + [char]0x00ED + 'tva') }
    'hu:ps.host_download_failed' { return ('a g' + [char]0x00E9 + 'pen v' + [char]0x00E9 + 'gzett let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's sikertelen: %s') }
    'hu:ps.input_not_json_bot_token_stdin' { return ('input_not_json: add meg a bot_token ' + [char]0x00E9 + 'rt' + [char]0x00E9 + 'k' + [char]0x00E9 + 't JSON-k' + [char]0x00E9 + 'nt a stdin-en.') }
    'hu:ps.integration_not_installed' { return ('nincs telep' + [char]0x00ED + 'tve') }
    'hu:ps.integration_not_installed_yet' { return ('m' + [char]0x00E9 + 'g nincs telep' + [char]0x00ED + 'tve') }
    'hu:ps.jht_container_not_verifiable' { return ('A JHT kont' + [char]0x00E9 + 'nere nem igazolhat' + [char]0x00F3 + '.') }
    'hu:ps.jht_home_missing' { return ('A Job Hunter Team m' + [char]0x00E9 + 'g nincs telep' + [char]0x00ED + 'tve: a(z) %s mappa nem l' + [char]0x00E9 + 'tezik. Futtasd a telep' + [char]0x00ED + 't' + [char]0x0151 + 't, majd a ''jht setup'' parancsot.') }
    'hu:ps.legacy_cleanup_failed_old_token_still_there' { return ('legacy_cleanup_failed: a r' + [char]0x00E9 + 'gi token m' + [char]0x00E9 + 'g a ~/.jht mapp' + [char]0x00E1 + 'ban van; az ' + [char]0x00E1 + 't' + [char]0x00E1 + 'll' + [char]0x00E1 + 's megtagadva.') }
    'hu:ps.legacy_migration_failed_stays' { return ('legacy_migration_failed: %s a ~/.jht/credentials mapp' + [char]0x00E1 + 'ban marad.') }
    'hu:ps.lifecycle.restarted' { return ('A Job Hunter Team ' + [char]0x00FA + 'jraindult.') }
    'hu:ps.link_or_not_folder' { return 'link vagy nem mappa' }
    'hu:ps.localappdata_unavailable' { return ('a LOCALAPPDATA nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el: a g' + [char]0x00E9 + 'pen fut' + [char]0x00F3 + ' futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet elutas' + [char]0x00ED + 'tva') }
    'hu:ps.machine_space_back_on_stop' { return ('A JHT g' + [char]0x00E9 + 'p' + [char]0x00E9 + 'n felszabad' + [char]0x00ED + 'tott kb. %s GB akkor ker' + [char]0x00FC + 'l vissza a Windowshoz, amikor a g' + [char]0x00E9 + 'p le' + [char]0x00E1 + 'll: a jht down ut' + [char]0x00E1 + 'n a podman machine stop %s paranccsal, vagy a sz' + [char]0x00E1 + 'm' + [char]0x00ED + 't' + [char]0x00F3 + 'g' + [char]0x00E9 + 'p ' + [char]0x00FA + 'jraind' + [char]0x00ED + 't' + [char]0x00E1 + 'sakor.') }
    'hu:ps.machine_space_not_returned' { return ('A JHT kb. %s GB-ot foglal a virtu' + [char]0x00E1 + 'lis lemez' + [char]0x00E9 + 'n; ez a jht uninstall paranccsal teljesen felszabadul.') }
    'hu:ps.machine_state_unreadable' { return ('a g' + [char]0x00E9 + 'p ' + [char]0x00E1 + 'llapota nem olvashat' + [char]0x00F3 + ' (a podman ' + [char]0x00E9 + 's a wsl nem v' + [char]0x00E1 + 'laszol)') }
    'hu:ps.monitor_window_unavailable' { return ('monitor_window_unavailable: itt nem tudok termin' + [char]0x00E1 + 'lablakot nyitni. Futtasd a ''jht monitor'' parancsot a jelenlegi termin' + [char]0x00E1 + 'lban.') }
    'hu:ps.mount_repair_failed_folders_not_writable' { return ('mount_repair_failed: a Job Hunter Team mapp' + [char]0x00E1 + 'i (%s, %s) nem ' + [char]0x00ED + 'rhat' + [char]0x00F3 + 'k a kont' + [char]0x00E9 + 'ner sz' + [char]0x00E1 + 'm' + [char]0x00E1 + 'ra, ' + [char]0x00E9 + 's nem siker' + [char]0x00FC + 'lt rendbe hozni ' + [char]0x0151 + 'ket.') }
    'hu:ps.old_images_busy' { return (' Kont' + [char]0x00E9 + 'ner haszn' + [char]0x00E1 + 'lja (megtartva): %s.') }
    'hu:ps.old_images_kept_all' { return ('R' + [char]0x00E9 + 'gi JHT-k' + [char]0x00E9 + 'pek: mind megtartva (JHT_KEEP_OLD_IMAGES=1).') }
    'hu:ps.old_images_refused' { return (' A motor elutas' + [char]0x00ED + 'totta (megtartva): %s.') }
    'hu:ps.old_images_removed' { return ('R' + [char]0x00E9 + 'gi JHT-k' + [char]0x00E9 + 'pek: %s elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva, kb. %s MB felszabad' + [char]0x00ED + 'tva (n' + [char]0x00E9 + 'vleges m' + [char]0x00E9 + 'ret: a megosztott r' + [char]0x00E9 + 'tegek csak r' + [char]0x00E9 + 'szben szabadulnak fel), megtartva: a jelenlegi ' + [char]0x00E9 + 's az el' + [char]0x0151 + 'z' + [char]0x0151 + '.') }
    'hu:ps.pair_role_now_prompt' { return ('P' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tod most a(z) %s szerepk' + [char]0x00F6 + 'rt? [s/N]') }
    'hu:ps.podman_exe_not_found' { return ('a podman.exe nem tal' + [char]0x00E1 + 'lhat' + [char]0x00F3) }
    'hu:ps.podman_machine_not_responding' { return ('A JHT Podman-g' + [char]0x00E9 + 'pe nem v' + [char]0x00E1 + 'laszol. Futtasd a ''jht up'' parancsot.') }
    'hu:ps.release_arrived_without_https' { return ('a kiad' + [char]0x00E1 + 's HTTPS n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l ' + [char]0x00E9 + 'rkezett: %s') }
    'hu:ps.relink_account_container_not_running' { return ('apply relink-account: a kont' + [char]0x00E9 + 'ner nem fut.') }
    'hu:ps.script_integration_not_installed' { return ('a(z) jht-integration.ps1 szkript m' + [char]0x00E9 + 'g nincs telep' + [char]0x00ED + 'tve: ''jht upgrade'' (vagy egy ''jht integration add/remove''), majd pr' + [char]0x00F3 + 'b' + [char]0x00E1 + 'ld ' + [char]0x00FA + 'jra') }
    'hu:ps.script_tools_not_installed' { return ('a(z) jht-tools.ps1 szkript m' + [char]0x00E9 + 'g nincs telep' + [char]0x00ED + 'tve: ''jht upgrade'', majd pr' + [char]0x00F3 + 'b' + [char]0x00E1 + 'ld ' + [char]0x00FA + 'jra') }
    'hu:ps.startup_task_still_registered' { return ('a feladat m' + [char]0x00E9 + 'g mindig regisztr' + [char]0x00E1 + 'lva van') }
    'hu:ps.team_container_unavailable' { return ('team_container_unavailable: ind' + [char]0x00ED + 'tsd el a csapatot a jht up paranccsal, ' + [char]0x00E9 + 's pr' + [char]0x00F3 + 'b' + [char]0x00E1 + 'ld ' + [char]0x00FA + 'jra.') }
    'hu:ps.telegram_not_configured' { return ('A Telegram nem akt' + [char]0x00ED + 'v: a Telegram nincs be' + [char]0x00E1 + 'll' + [char]0x00ED + 'tva.') }
    'hu:ps.telegram_status_unverifiable' { return ('Telegram: az ' + [char]0x00E1 + 'llapot most nem ellen' + [char]0x0151 + 'rizhet' + [char]0x0151 + ' (a szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's le van ' + [char]0x00E1 + 'll' + [char]0x00ED + 'tva, vagy nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el). R' + [char]0x00E9 + 'szletek: jht telegram status') }
    'hu:ps.telegram_unavailable_isolated_not_running' { return ('telegram_unavailable: az elk' + [char]0x00FC + 'l' + [char]0x00F6 + 'n' + [char]0x00ED + 'tett Telegram-szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's nem fut.') }
    'hu:ps.telegram_unavailable_run_jht_up' { return 'telegram_unavailable: futtasd: jht up' }
    'hu:ps.uninstall.bad.target' { return ('Megtagadva: a(z) {0} hivatkoz' + [char]0x00E1 + 's vagy nem mappa: nem k' + [char]0x00F6 + 'vetem, ' + [char]0x00E9 + 's nem t' + [char]0x00F6 + 'rl' + [char]0x00F6 + 'm.') }
    'hu:ps.uninstall.done' { return ('K' + [char]0x00E9 + 'sz: a <machine> g' + [char]0x00E9 + 'p (' + [char]0x00E9 + 's vele egy' + [char]0x00FC + 'tt a JHT k' + [char]0x00E9 + 'pei, az alap ' + [char]0x00E9 + 's a teljes), a futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet ' + [char]0x00E9 + 's a jht parancs elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva.') }
    'hu:ps.uninstall.done.kept' { return (' A ~/.jht ' + [char]0x00E9 + 's a Documents\Job Hunter Team megmarad (a --purge t' + [char]0x00F6 + 'rli ' + [char]0x0151 + 'ket).') }
    'hu:ps.uninstall.done.wsl' { return ('A WSL a mem' + [char]0x00F3 + 'ri' + [char]0x00E1 + 'ban marad: a vmmem, a wslservice ' + [char]0x00E9 + 's a wslrelay a Windows ' + [char]0x00F6 + 'sszetev' + [char]0x0151 + 'i (nem a Job Hunter Team telep' + [char]0x00ED + 'tette ' + [char]0x0151 + 'ket), ' + [char]0x00E9 + 's ennek a felhaszn' + [char]0x00E1 + 'l' + [char]0x00F3 + 'nak a t' + [char]0x00F6 + 'bbi WSL-g' + [char]0x00E9 + 'p' + [char]0x00E9 + 'hez is kellenek; ' + [char]0x00E1 + 'ltal' + [char]0x00E1 + 'ban egy id' + [char]0x0151 + ' ut' + [char]0x00E1 + 'n, ha nincs rajtuk tev' + [char]0x00E9 + 'kenys' + [char]0x00E9 + 'g, magukt' + [char]0x00F3 + 'l le' + [char]0x00E1 + 'llnak. Azonnali le' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'sukhoz: wsl --shutdown (ez az ' + [char]0x00D6 + 'SSZES megnyitott WSL-g' + [char]0x00E9 + 'pet le' + [char]0x00E1 + 'll' + [char]0x00ED + 'tja).') }
    'hu:ps.uninstall.kept.machine' { return ('A(z) {0} Podman-g' + [char]0x00E9 + 'pr' + [char]0x0151 + 'l nem l' + [char]0x00E1 + 'tszik, hogy a telep' + [char]0x00ED + 't' + [char]0x0151 + ' hozta volna l' + [char]0x00E9 + 'tre: ott marad, ahol van. K' + [char]0x00E9 + 'zzel, ha a ti' + [char]0x00E9 + 'd, ' + [char]0x00E9 + 's el akarod t' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tani: podman machine stop {0}; podman machine rm {0}.') }
    'hu:ps.uninstall.left.commands' { return ('Nincs elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva a jht parancs vagy a telep' + [char]0x00ED + 't' + [char]0x0151 + ' f' + [char]0x00E1 + 'jljai itt: {0} ({1}), vagy a telep' + [char]0x00ED + 't' + [char]0x0151 + ' ' + [char]0x00E1 + 'ltal hozz' + [char]0x00E1 + 'adott v' + [char]0x00E1 + 'ltoz' + [char]0x00F3 + 'k ' + [char]0x00E9 + 's PATH-sorok. K' + [char]0x00E9 + 'zzel: Remove-Item a f' + [char]0x00E1 + 'jlra; a JHT_CONTAINER_RUNTIME ' + [char]0x00E9 + 's JHT_PODMAN_MACHINE v' + [char]0x00E1 + 'ltoz' + [char]0x00F3 + 'k, ' + [char]0x00E9 + 's a {0} mappa a PATH-b' + [char]0x00F3 + 'l a Be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'sok > K' + [char]0x00F6 + 'rnyezeti v' + [char]0x00E1 + 'ltoz' + [char]0x00F3 + 'k alatt.') }
    'hu:ps.uninstall.left.data' { return ('A JHT adatai nem lettek t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve ({0}). K' + [char]0x00E9 + 'zzel: Remove-Item -Recurse -Force {1}. A jht parancs ' + [char]0x00E9 + 's a futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet megmaradt: ha rendezted, futtasd ' + [char]0x00FA + 'jra a jht uninstall --confirm --purge parancsot.') }
    'hu:ps.uninstall.left.machine' { return ('Nincs elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva: a <machine> Podman-g' + [char]0x00E9 + 'p. Ok: {0}. K' + [char]0x00E9 + 'zzel: podman machine stop <machine>; wsl --unregister {1}; majd futtasd ' + [char]0x00FA + 'jra a jht uninstall --confirm parancsot.') }
    'hu:ps.uninstall.left.runtime' { return ('Nincs elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva: a JHT futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezete itt: {0}. K' + [char]0x00E9 + 'zzel: Remove-Item -Recurse -Force ''{0}''.') }
    'hu:ps.uninstall.left.task' { return ('Nincs elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva a bejelentkez' + [char]0x00E9 + 'skor indul' + [char]0x00F3 + ' feladat: ''{0}'' (ok: {1}). A t' + [char]0x00F6 + 'bbi el lett t' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva. K' + [char]0x00E9 + 'zzel: schtasks /Delete /TN "{0}" /F.') }
    'hu:ps.uninstall.phase.commands' { return ('Elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tom a jht parancsot, a telep' + [char]0x00ED + 't' + [char]0x0151 + ' f' + [char]0x00E1 + 'jljait ' + [char]0x00E9 + 's a PATH-sorokat...') }
    'hu:ps.uninstall.phase.data' { return ('T' + [char]0x00F6 + 'rl' + [char]0x00F6 + 'm a ~/.jht ' + [char]0x00E9 + 's a Documents\Job Hunter Team mapp' + [char]0x00E1 + 't (--purge)...') }
    'hu:ps.uninstall.phase.machine' { return ('Elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tom a(z) <machine> Podman-g' + [char]0x00E9 + 'pet (a JHT titkaival ' + [char]0x00E9 + 's k' + [char]0x00E9 + 'peivel egy' + [char]0x00FC + 'tt)...') }
    'hu:ps.uninstall.phase.runtime' { return ('Elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tom a JHT futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet' + [char]0x00E9 + 't...') }
    'hu:ps.uninstall.purge_notice' { return ('A --purge kapcsol' + [char]0x00F3 + 'val a ~/.jht ' + [char]0x00E9 + 's a Documents\Job Hunter Team is t' + [char]0x00F6 + 'rl' + [char]0x0151 + 'dik: be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'sok, adatb' + [char]0x00E1 + 'zis, ' + [char]0x00F6 + 'n' + [char]0x00E9 + 'letrajzok ' + [char]0x00E9 + 's kimenetek. Nincs vissza' + [char]0x00FA + 't.') }
    'hu:ps.uninstall.purge_removal_notice' { return ('A mentett levelez' + [char]0x00E9 + 'si jelsz' + [char]0x00F3 + ' ' + [char]0x00E9 + 's a Telegram-tokenek is t' + [char]0x00F6 + 'rl' + [char]0x0151 + 'dnek.') }
    'hu:ps.uninstall.removal_notice' { return ('A mentett levelez' + [char]0x00E9 + 'si jelsz' + [char]0x00F3 + ' ' + [char]0x00E9 + 's a Telegram-tokenek is t' + [char]0x00F6 + 'rl' + [char]0x0151 + 'dnek; a ~/.jht ' + [char]0x00E9 + 's a Dokumentumok megmarad, ' + [char]0x00E9 + 's vel' + [char]0x00FC + 'k a mentett LinkedIn-munkamenet is (secrets/linkedin-profile ' + [char]0x00E9 + 's .cache/linkedin): ezt a jht reset --scope creds paranccsal t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lheted.') }
    'hu:ps.uninstall.secrets' { return ('A mentett titkok nem lettek elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva: a levelez' + [char]0x00E9 + 'si jelsz' + [char]0x00F3 + ' ' + [char]0x00E9 + 's a Telegram-tokenek a <machine> g' + [char]0x00E9 + 'p jht-secrets ' + [char]0x00E9 + 's jht-telegram-secrets k' + [char]0x00F6 + 'tet' + [char]0x00E9 + 'ben vannak, amely m' + [char]0x00E9 + 'g megvan.') }
    'hu:ps.uninstall.wslconfig.done' { return ('Elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva a(z) {0} f' + [char]0x00E1 + 'jlb' + [char]0x00F3 + 'l a telep' + [char]0x00ED + 't' + [char]0x0151 + ' ' + [char]0x00E1 + 'ltal hozz' + [char]0x00E1 + 'adott sorok (WSL-mem' + [char]0x00F3 + 'ria).') }
    'hu:ps.uninstall.wslconfig.kept' { return ('A(z) {0} f' + [char]0x00E1 + 'jlban meghagytam a te ' + [char]0x00E1 + 'ltalad m' + [char]0x00F3 + 'dos' + [char]0x00ED + 'tott sorokat: azok a tieid.') }
    'hu:ps.uninstall.wslconfig.left' { return ('Nem m' + [char]0x00F3 + 'dos' + [char]0x00ED + 'tottam: {0} ({1}). A telep' + [char]0x00ED + 't' + [char]0x0151 + ' ' + [char]0x00E1 + 'ltal hozz' + [char]0x00E1 + 'adott sorok (WSL-mem' + [char]0x00F3 + 'ria) megmaradnak. T' + [char]0x00F6 + 'r' + [char]0x00F6 + 'ld ' + [char]0x0151 + 'ket k' + [char]0x00E9 + 'zzel: mindegyik felett van egy megjegyz' + [char]0x00E9 + 'ssor.') }
    'hu:ps.unknown_argument' { return 'ismeretlen argumentum: %s' }
    'hu:ps.upgrade_already_running' { return ('M' + [char]0x00E1 + 'r folyamatban van egy friss' + [char]0x00ED + 't' + [char]0x00E9 + 's') }
    'hu:ps.upgrade_broker_restart_failed' { return ('broker_restart_failed: a titokbroker nem indult ' + [char]0x00FA + 'jra. Teend' + [char]0x0151 + ': jht up') }
    'hu:ps.upgrade_disk_low' { return ('disk_low: Az ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'knek legal' + [char]0x00E1 + 'bb %s GiB lemezter' + [char]0x00FC + 'let kell ' + [char]0x2014 + ' szabad: %s GiB. Hely felszabad' + [char]0x00ED + 't' + [char]0x00E1 + 's' + [char]0x00E1 + 'hoz ' + [char]0x00FC + 'r' + [char]0x00ED + 'tsd ki a Kuk' + [char]0x00E1 + 't, t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'ld a nagy f' + [char]0x00E1 + 'jlokat, amelyekre nincs sz' + [char]0x00FC + 'ks' + [char]0x00E9 + 'ged, ' + [char]0x00E9 + 's a nem haszn' + [char]0x00E1 + 'lt Docker-k' + [char]0x00E9 + 'peket, majd pr' + [char]0x00F3 + 'b' + [char]0x00E1 + 'ld ' + [char]0x00FA + 'jra: semmi nem lett let' + [char]0x00F6 + 'ltve vagy m' + [char]0x00F3 + 'dos' + [char]0x00ED + 'tva.') }
    'hu:ps.upgrade_docker_unavailable' { return ('A Docker vagy a g' + [char]0x00E9 + 'pen fut' + [char]0x00F3 + ' futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el') }
    'hu:ps.upgrade_helper_install_failed' { return ('helper_install_failed: a g' + [char]0x00E9 + 'pen fut' + [char]0x00F3 + ' ' + [char]0x00FA + 'j szkriptek az els' + [char]0x0151 + ' k' + [char]0x00E9 + 'r' + [char]0x00E9 + 'skor vagy egy ' + [char]0x00FA + 'jabb ''jht upgrade'' futtat' + [char]0x00E1 + 'sakor t' + [char]0x00F6 + 'lt' + [char]0x0151 + 'dnek le') }
    'hu:ps.upgrade_host_runtime_not_installable' { return ('A v' + [char]0x00E9 + 'dett, g' + [char]0x00E9 + 'pen fut' + [char]0x00F3 + ' futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet nem telep' + [char]0x00ED + 'thet' + [char]0x0151) }
    'hu:ps.upgrade_host_runtime_untrusted' { return ('A g' + [char]0x00E9 + 'pen fut' + [char]0x00F3 + ' futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet nem megb' + [char]0x00ED + 'zhat' + [char]0x00F3) }
    'hu:ps.upgrade_image_download_failed' { return ('A k' + [char]0x00E9 + 'p let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 'se nem siker' + [char]0x00FC + 'lt') }
    'hu:ps.upgrade_journal_not_updated' { return ('A napl' + [char]0x00F3 + ' friss' + [char]0x00ED + 't' + [char]0x00E9 + 'se nem siker' + [char]0x00FC + 'lt') }
    'hu:ps.upgrade_metadata_not_persisted' { return ('A futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet metaadatai nem lettek elmentve') }
    'hu:ps.upgrade_mounts_not_writable' { return ('A Job Hunter Team mapp' + [char]0x00E1 + 'i nem ' + [char]0x00ED + 'rhat' + [char]0x00F3 + 'k a kont' + [char]0x00E9 + 'nerb' + [char]0x0151 + 'l (mount_repair_failed)') }
    'hu:ps.upgrade_not_completed' { return ('A friss' + [char]0x00ED + 't' + [char]0x00E9 + 's nem fejez' + [char]0x0151 + 'd' + [char]0x00F6 + 'tt be (%s): %s') }
    'hu:ps.upgrade_note_activate_runtime' { return ('Aktiv' + [char]0x00E1 + 'lom az ' + [char]0x00FA + 'j futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezetet...') }
    'hu:ps.upgrade_note_download_image' { return ('Let' + [char]0x00F6 + 'lt' + [char]0x00F6 + 'm a legfrissebb k' + [char]0x00E9 + 'pet...') }
    'hu:ps.upgrade_note_download_runtime' { return ('Let' + [char]0x00F6 + 'lt' + [char]0x00F6 + 'm a friss' + [char]0x00ED + 'tett futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezetet...') }
    'hu:ps.upgrade_option_unsupported' { return ('Nem t' + [char]0x00E1 + 'mogatott upgrade-kapcsol' + [char]0x00F3) }
    'hu:ps.upgrade_pulling_full_image' { return ('Let' + [char]0x00F6 + 'lt' + [char]0x00F6 + 'm a friss' + [char]0x00ED + 'tett teljes k' + [char]0x00E9 + 'pet...') }
    'hu:ps.upgrade_recovery_failed' { return ('Az el' + [char]0x0151 + 'z' + [char]0x0151 + ' upgrade helyre' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'sa nem siker' + [char]0x00FC + 'lt') }
    'hu:ps.upgrade_release_core_invalid' { return ('A kiad' + [char]0x00E1 + 's nem tartalmaz ' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nyes magot ehhez a telep' + [char]0x00ED + 't' + [char]0x00E9 + 'shez: telep' + [char]0x00ED + 'tsd ' + [char]0x00FA + 'jra') }
    'hu:ps.upgrade_remote_compose_invalid' { return ('A t' + [char]0x00E1 + 'voli compose ' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nytelen') }
    'hu:ps.upgrade_remote_runtime_invalid' { return ('A t' + [char]0x00E1 + 'voli futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet ' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nytelen vagy nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el') }
    'hu:ps.upgrade_rollback_not_prepared' { return ('A vissza' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's el' + [char]0x0151 + 'k' + [char]0x00E9 + 'sz' + [char]0x00ED + 't' + [char]0x00E9 + 'se nem siker' + [char]0x00FC + 'lt') }
    'hu:ps.upgrade_telegram_restart_failed' { return ('telegram_restart_failed: az elk' + [char]0x00FC + 'l' + [char]0x00F6 + 'n' + [char]0x00ED + 'tett Telegram-szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's nem indult ' + [char]0x00FA + 'jra. Teend' + [char]0x0151 + ': jht up') }
    'hu:ps.upgrade_test_channel' { return ('Tesztcsatorna: friss' + [char]0x00ED + 't' + [char]0x00E9 + 'shez ' + [char]0x00FA + 'jra kell telep' + [char]0x00ED + 'teni a teszt-buildb' + [char]0x0151 + 'l') }
    'hu:ps.upgrade_unexpected_error' { return ('V' + [char]0x00E1 + 'ratlan hiba a friss' + [char]0x00ED + 't' + [char]0x00E9 + 's k' + [char]0x00F6 + 'zben') }
    'hu:ps.upgrade_verify_failed' { return ('Az ' + [char]0x00FA + 'j futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet nem ment ' + [char]0x00E1 + 't az ellen' + [char]0x0151 + 'rz' + [char]0x00E9 + 'sen') }
    'hu:ps.use_fresh_botfather_token' { return ('Mindig a BotFatherben frissen gener' + [char]0x00E1 + 'lt tokent haszn' + [char]0x00E1 + 'lj (/revoke a boton, vagy egy ' + [char]0x00FA + 'j bot): egy m' + [char]0x00E1 + 'r megl' + [char]0x00E9 + 'v' + [char]0x0151 + ' tokent az ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'k elolvashattak, m' + [char]0x00E9 + 'g ha ma nem is szerepel a ~/.jht mapp' + [char]0x00E1 + 'ban.') }
    'hu:ps.user_dir_unavailable_cannot_create' { return ('user_dir_unavailable: nem tudom l' + [char]0x00E9 + 'trehozni a(z) %s mapp' + [char]0x00E1 + 't, amelyet a csapat haszn' + [char]0x00E1 + 'l.') }
    'hu:ps.wsl_exe_not_found' { return ('a wsl.exe nem tal' + [char]0x00E1 + 'lhat' + [char]0x00F3) }
    'hu:ps.wsl_not_answering' { return ('a WSL nem v' + [char]0x00E1 + 'laszol (wsl --status)') }
    'hu:removed.office' { return ('A ''jht %s'' a 0.4.0-ban a Godot-irod' + [char]0x00E1 + 'val egy' + [char]0x00FC + 'tt megsz' + [char]0x0171 + 'nt: haszn' + [char]0x00E1 + 'ld a jht parancsokat (jht help).') }
    'hu:status.no_options' { return ('A ''jht status'' nem fogad kapcsol' + [char]0x00F3 + 'kat (%s): egyszer' + [char]0x0171 + 'en ''jht status''-k' + [char]0x00E9 + 'nt futtasd.') }
    'hu:status.not_running' { return ('A csapat kont' + [char]0x00E9 + 'nere nem fut.') }
    'hu:status.not_running_next' { return ('Ind' + [char]0x00ED + 'tsd el: jht up') }
    'hu:team.stopped' { return ('A Job Hunter Team le van ' + [char]0x00E1 + 'll' + [char]0x00ED + 'tva: a ''jht up'' ' + [char]0x00FA + 'jraind' + [char]0x00ED + 'tja.') }
    'hu:tools.arriving' { return ('A felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) eszk' + [char]0x00F6 + 'zei ' + [char]0x00FA + 'ton vannak: a teljes k' + [char]0x00E9 + 'p a h' + [char]0x00E1 + 'tt' + [char]0x00E9 + 'rben t' + [char]0x00F6 + 'lt' + [char]0x0151 + 'dik le (kb. 3 GB). Az ' + [char]0x00E1 + 'll' + [char]0x00E1 + 'sok keres' + [char]0x00E9 + 'se mag' + [char]0x00E1 + 't' + [char]0x00F3 + 'l elindul, amint meg' + [char]0x00E9 + 'rkeztek; nincs teend' + [char]0x0151 + 'd.') }
    'hu:tools.chat_reconnecting' { return ('A csapat ' + [char]0x00E1 + 't' + [char]0x00E1 + 'll a felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) teljes eszk' + [char]0x00F6 + 'zeire, ez' + [char]0x00E9 + 'rt a cseveg' + [char]0x00E9 + 's egy pillanatra meg' + [char]0x00E1 + 'll: mag' + [char]0x00E1 + 't' + [char]0x00F3 + 'l folytat' + [char]0x00F3 + 'dik, amint a csapat ' + [char]0x00FA + 'jra fut (p' + [char]0x00E1 + 'r perc).') }
    'hu:tools.chat_resumed' { return ('A csapat ' + [char]0x00E1 + 't' + [char]0x00E1 + 'llt a teljes eszk' + [char]0x00F6 + 'z' + [char]0x00F6 + 'kre: folytassuk.') }
    'hu:tools.chat_switched' { return ('A csapat ' + [char]0x00E1 + 't' + [char]0x00E1 + 'll a felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) teljes eszk' + [char]0x00F6 + 'zeire, ez' + [char]0x00E9 + 'rt ez a cseveg' + [char]0x00E9 + 's bez' + [char]0x00E1 + 'rult. P' + [char]0x00E1 + 'r perc m' + [char]0x00FA + 'lva nyisd meg ' + [char]0x00FA + 'jra a jht team chat paranccsal.') }
    'hu:tools.chat_update_closed' { return ('A JHT friss' + [char]0x00FC + 'l, ez' + [char]0x00E9 + 'rt ez a cseveg' + [char]0x00E9 + 's bez' + [char]0x00E1 + 'rult. P' + [char]0x00E1 + 'r perc m' + [char]0x00FA + 'lva nyisd meg ' + [char]0x00FA + 'jra a jht team chat paranccsal.') }
    'hu:tools.chat_update_resumed' { return ('A JHT friss' + [char]0x00FC + 'lt: folytassuk.') }
    'hu:tools.chat_updating' { return ('A JHT friss' + [char]0x00FC + 'l, ez' + [char]0x00E9 + 'rt a cseveg' + [char]0x00E9 + 's egy pillanatra meg' + [char]0x00E1 + 'll: mag' + [char]0x00E1 + 't' + [char]0x00F3 + 'l ' + [char]0x00FA + 'jraindul egy-k' + [char]0x00E9 + 't percen bel' + [char]0x00FC + 'l.') }
    'hu:tools.disk_low' { return ('A felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) eszk' + [char]0x00F6 + 'zei nem t' + [char]0x00F6 + 'lt' + [char]0x0151 + 'dtek le: kb. %s GiB szabad lemezter' + [char]0x00FC + 'let kell hozz' + [char]0x00E1 + 'juk, ' + [char]0x00E9 + 's %s GiB van, ' + [char]0x00ED + 'gy a csapat m' + [char]0x00E9 + 'g nem tud ' + [char]0x00E1 + 'll' + [char]0x00E1 + 'sokat keresni. Szabad' + [char]0x00ED + 'ts fel helyet (' + [char]0x00FC + 'r' + [char]0x00ED + 'tsd ki a Kuk' + [char]0x00E1 + 't, t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'ld a nagy f' + [char]0x00E1 + 'jlokat, amelyekre nincs sz' + [char]0x00FC + 'ks' + [char]0x00E9 + 'ged), majd futtasd a jht up parancsot: a let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's mag' + [char]0x00E1 + 't' + [char]0x00F3 + 'l ' + [char]0x00FA + 'jraindul.') }
    'hu:tools.engine_down' { return ('A felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) eszk' + [char]0x00F6 + 'zeinek ' + [char]0x00E1 + 'llapota nem olvashat' + [char]0x00F3 + ': a kont' + [char]0x00E9 + 'nermotor nem v' + [char]0x00E1 + 'laszol. Ind' + [char]0x00ED + 'tsd el a jht up paranccsal.') }
    'hu:tools.failed' { return ('A felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) eszk' + [char]0x00F6 + 'zeinek let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 'se nem siker' + [char]0x00FC + 'lt, ' + [char]0x00ED + 'gy a csapat m' + [char]0x00E9 + 'g nem tud ' + [char]0x00E1 + 'll' + [char]0x00E1 + 'sokat keresni. Futtasd a jht tools pull parancsot az ' + [char]0x00FA + 'jrapr' + [char]0x00F3 + 'b' + [char]0x00E1 + 'l' + [char]0x00E1 + 'shoz (a jht up is ' + [char]0x00FA + 'jrapr' + [char]0x00F3 + 'b' + [char]0x00E1 + 'lja).') }
    'hu:tools.ready' { return ('A felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) eszk' + [char]0x00F6 + 'zei meg' + [char]0x00E9 + 'rkeztek: a csapat a teljes k' + [char]0x00E9 + 'ppel keres.') }
    'hu:tools.switch_failed' { return ('A felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) eszk' + [char]0x00F6 + 'zei meg' + [char]0x00E9 + 'rkeztek, de a csapatot nem siker' + [char]0x00FC + 'lt vel' + [char]0x00FC + 'k ' + [char]0x00FA + 'jraind' + [char]0x00ED + 'tani: futtasd a jht down, majd a jht up parancsot.') }
    'hu:tools.switch_wait' { return ('A csapat ' + [char]0x00E1 + 't' + [char]0x00E1 + 'll a felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) teljes eszk' + [char]0x00F6 + 'zeire: megv' + [char]0x00E1 + 'rom, am' + [char]0x00ED + 'g ' + [char]0x00FA + 'jraindul (legfeljebb p' + [char]0x00E1 + 'r perc).') }
    'hu:tools.waiting' { return ('A felder' + [char]0x00ED + 't' + [char]0x0151 + 'k (Scout) eszk' + [char]0x00F6 + 'zei meg' + [char]0x00E9 + 'rkeztek: a csapat mag' + [char]0x00E1 + 't' + [char]0x00F3 + 'l ' + [char]0x00E1 + 'tv' + [char]0x00E1 + 'lt r' + [char]0x00E1 + 'juk, amint a bevezet' + [char]0x00E9 + 's lez' + [char]0x00E1 + 'rult.') }
    'hu:uninstall.usage' { return ('haszn' + [char]0x00E1 + 'lat: jht uninstall --confirm [--purge]') }
    'hu:up.done' { return 'A Job Hunter Team elindult.' }
    'es:container.starting' { return ('El contenedor ''%s'' no est' + [char]0x00E1 + ' en marcha, lo arranco...') }
    'es:doctor.host_config_none' { return ('todav' + [char]0x00ED + 'a no hay configuraci' + [char]0x00F3 + 'n: ''jht setup''') }
    'es:doctor.host_config_ok' { return ('configuraci' + [char]0x00F3 + 'n presente') }
    'es:doctor.host_engine_fail' { return 'motor de contenedores no accesible' }
    'es:doctor.host_engine_ok' { return 'motor de contenedores accesible' }
    'es:doctor.host_more' { return ('Para las comprobaciones completas (configuraci' + [char]0x00F3 + 'n, proveedor, base de datos, agentes): ''jht up'' y luego ''jht doctor''.') }
    'es:doctor.host_runtime_fail' { return 'runtime de JHT ausente o cambiado: ''jht upgrade'' lo vuelve a instalar' }
    'es:doctor.host_runtime_ok' { return 'runtime de JHT intacto' }
    'es:doctor.host_team_off' { return 'equipo apagado: ''jht up'' lo enciende' }
    'es:doctor.host_team_unattestable' { return ('hay un contenedor del equipo, pero no se puede verificar que sea nuestro: no he tocado nada (''jht status'' te dice m' + [char]0x00E1 + 's)') }
    'es:doctor.host_title' { return ('Job Hunter Team: el equipo est' + [char]0x00E1 + ' apagado (su contenedor no est' + [char]0x00E1 + ' en marcha). Comprobaciones hechas desde este ordenador:') }
    'es:down.done' { return 'Job Hunter Team detenido.' }
    'es:download.bad_version' { return ('versi' + [char]0x00F3 + 'n no v' + [char]0x00E1 + 'lida: %s. Ejemplo: 0.3.5.') }
    'es:download.deb_only_linux' { return '--deb solo es para Linux.' }
    'es:download.dest_is_link' { return 'el destino es un enlace: %s' }
    'es:download.dest_not_file' { return 'el destino existe y no es un archivo: %s' }
    'es:download.fetching' { return 'Descargando %s...' }
    'es:download.hash_invalid' { return ('SHA-256 no v' + [char]0x00E1 + 'lido para %s: se esperaba %s, se ha obtenido %s.') }
    'es:download.intel_mac' { return 'La app de macOS de la 0.4 solo funciona en Mac con Apple silicon (M1 y posteriores); este es un Mac Intel, que la 0.4 no admite. No se ha descargado nada.' }
    'es:download.linux_no_app' { return ('En esta versi' + [char]0x00F3 + 'n no hay app de escritorio para Linux: usa install.sh. No se ha descargado nada.') }
    'es:download.mismatch_existing' { return 'el archivo %s existe, pero su SHA-256 no coincide: no se ha sobrescrito.' }
    'es:download.mkdir_failed' { return 'no se puede crear la carpeta de destino: %s' }
    'es:download.present_verified' { return 'Archivo ya presente y verificado: %s' }
    'es:download.release_no_app' { return ('Esta versi' + [char]0x00F3 + 'n (v%s) no tiene app para macOS: usa la 0.4.0 o posterior. No se ha descargado nada.') }
    'es:download.saved_in' { return 'Guardado en: %s' }
    'es:download.sha_verified' { return 'SHA-256 verificado: %s' }
    'es:download.sum_missing' { return 'no hay SHA-256 declarado para %s.' }
    'es:download.unsupported_os' { return 'sistema no compatible: %s. Usa windows o macos.' }
    'es:download.windows_missing' { return ('Windows no forma parte de la 0.4.0: la versi' + [char]0x00F3 + 'n no tiene instalador para Windows. No se ha descargado nada.') }
    'es:help.integration' { return (('Uso: jht integration <command>', '', '  list [--json]                   las integraciones y su estado', '  status [ID] [--json]            el estado de una, o de todas', ('  add ID [--json]                 a' + [char]0x00F1 + 'ade una integraci' + [char]0x00F3 + 'n'), '  remove ID [--purge --yes] [--remove-image] [--json]', ('                                  la quita; --purge borra tambi' + [char]0x00E9 + 'n sus datos (hace falta --yes);'), ('                                  --remove-image (solo screen y media) quita tambi' + [char]0x00E9 + 'n la imagen de las'), '                                  herramientas', '', 'Los ID admitidos son los que muestra `jht integration list`. No se descarga ni se enciende nada', 'hasta que lo pidas con `add`.') -join [char]10) }
    'es:help.linkedin' { return (('Uso: jht linkedin <command>', '', '  login [--stop]    el acceso a mano a LinkedIn (con Google): un navegador en un contenedor aparte,', '                    sin red, cuya ventana ves y usas desde la app; --stop lo cierra todo', ('  status --json     dice si el acceso est' + [char]0x00E1 + ' en curso y si la sesi' + [char]0x00F3 + 'n de LinkedIn est' + [char]0x00E1 + ' guardada'), '', 'No se descarga ni se enciende nada hasta que lo pidas con `login`.') -join [char]10) }
    'es:help.screen' { return (('Uso: jht screen <command>', '', '  on [--json]       enciende la pantalla en directo del closer: un contenedor aparte,', '                    con el stream solo en 127.0.0.1', '  off [--remove-image] [--json]', '                    la apaga y quita el contenedor; la imagen de las herramientas se queda en el disco,', '                    para volver a encenderla sin descargarla otra vez: --remove-image la quita y libera', '                    el espacio', ('  status [--json]   dice si est' + [char]0x00E1 + ' encendida'), '', 'No se descarga ni se enciende nada hasta que lo pidas con `on`. El stream es solo para ver.') -join [char]10) }
    'es:help.setup' { return (('Uso: jht setup [options]', '', ('Sin opciones arranca la instalaci' + [char]0x00F3 + 'n guiada. Con --non-interactive no pregunta nada:'), 'todo se da con las opciones.', '', '  --non-interactive            ninguna pregunta', '  --provider <name>            glm (Z.ai, predeterminado), kimi (Moonshot), openai o claude (Anthropic)', '  --harness <name>             pi (predeterminado)', ('  --api-key-file <path>        archivo que contiene la clave API (una l' + [char]0x00ED + 'nea, que solo puedas leer t' + [char]0x00FA + ').'), '                               Un archivo de tu ordenador lo lee jht y se lo pasa al setup: con glm y kimi', ('                               el setup guarda la clave por su cuenta, nunca en la configuraci' + [char]0x00F3 + 'n'), ('  --api-key-stdin              lee la clave API de la entrada est' + [char]0x00E1 + 'ndar (una l' + [char]0x00ED + 'nea):'), ('                               nunca en la l' + [char]0x00ED + 'nea de comandos'), ('  --api-key <key>              la clave escrita aqu' + [char]0x00ED + ', en claro (no admitida para glm y kimi)'), ('  --secret-mode <mode>         c' + [char]0x00F3 + 'mo se guarda la clave: plaintext (predeterminado), env o file'), '  --secret-env <name>          con --secret-mode env: la variable de entorno que la contiene', '  --secret-file <path>         con --secret-mode file: el archivo que la contiene', '  --model <model>              el modelo que usar', '  --language <code>            el idioma (por ejemplo es o en)', ('  --budget-usd <d' + [char]0x00F3 + 'lares>       cu' + [char]0x00E1 + 'nto puede gastar el equipo, en d' + [char]0x00F3 + 'lares (con una de --budget-minutes, --budget-days, --budget-until)'), '  --budget-minutes <n>         el presupuesto dura estos minutos desde ahora', ('  --budget-days <n>            el presupuesto dura estos d' + [char]0x00ED + 'as desde ahora'), ('  --budget-until <hora>        el presupuesto dura hasta esta hora del d' + [char]0x00ED + 'a, 0-23 (la siguiente)'), ('  --no-budget                  sin l' + [char]0x00ED + 'mite de gasto (el equipo se detiene solo con el cr' + [char]0x00E9 + 'dito del proveedor)'), ('  --skip-health                se salta la comprobaci' + [char]0x00F3 + 'n final'), ('  --reset                      vuelve a empezar desde una configuraci' + [char]0x00F3 + 'n limpia'), '', 'Ejemplos:', '  con una clave GLM en un archivo:', '    jht setup --non-interactive --provider glm --harness pi --api-key-file clave.txt', '  OpenAI con una clave API, en Pi (para Claude: --provider claude):', '    jht setup --non-interactive --provider openai --harness pi --api-key-stdin') -join [char]10) }
    'es:help.tools' { return (('Uso: jht tools <comando>', '', ('  status --json   si las herramientas de los Scout (la imagen completa) ya est' + [char]0x00E1 + 'n, est' + [char]0x00E1 + 'n en camino o han fallado'), '  pull            las descarga en segundo plano (jht up y jht setup lo inician solos)', ('  switch          pasa el equipo a ellas cuando el onboarding est' + [char]0x00E1 + ' cerrado (la descarga lo hace sola)'), '', 'Esta ayuda no arranca nada ni descarga nada.') -join [char]10) }
    'es:host_setup.timezone_explain' { return ('El Capit' + [char]0x00E1 + 'n la usa para convertir las horas en los mensajes de Telegram y en los gr' + [char]0x00E1 + 'ficos.') }
    'es:host_setup.timezone_header' { return 'Zona horaria' }
    'es:host_setup.timezone_label' { return 'Zona horaria' }
    'es:host_setup.timezone_vps_utc' { return ('No se ha detectado la zona horaria: el equipo usar' + [char]0x00E1 + ' UTC. Configura la tuya con jht wh --tz Europe/Madrid (o en el panel); si no, las horas de Telegram y del horario de trabajo estar' + [char]0x00E1 + 'n en UTC.') }
    'es:host_setup.tz.bad_number' { return ('Elige un n' + [char]0x00FA + 'mero entre 1 y %d.') }
    'es:host_setup.tz.how' { return ('Escribe un pa' + [char]0x00ED + 's, una ciudad o una zona horaria (por ejemplo Espa' + [char]0x00F1 + 'a, Madrid, Europe/Madrid).') }
    'es:host_setup.tz.how_default' { return ('Pulsa Intro para mantener %s, o escribe un pa' + [char]0x00ED + 's, una ciudad o una zona horaria para buscar otra.') }
    'es:host_setup.tz.none' { return ('No hay ninguna zona horaria para ' + [char]0x00AB + '%s' + [char]0x00BB + ': escribe el pa' + [char]0x00ED + 's (por ejemplo Espa' + [char]0x00F1 + 'a) o una ciudad grande cercana.') }
    'es:host_setup.tz.not_detected' { return 'No se ha detectado tu zona horaria.' }
    'es:host_setup.tz.pick' { return ('N' + [char]0x00FA + 'mero (1-%d), o una nueva b' + [char]0x00FA + 'squeda:') }
    'es:host_setup.tz.proposed' { return 'Propuesta: %s (ahora %s).' }
    'es:host_setup.tz.saved_and_detected' { return ('Guardada: %s (ahora %s) ' + [char]0x00B7 + ' Detectada ahora: %s (ahora %s)') }
    'es:host_setup.tz.too_many' { return ('%d zonas horarias coinciden con ' + [char]0x00AB + '%s' + [char]0x00BB + ': escribe algo m' + [char]0x00E1 + 's preciso (una ciudad, por ejemplo).') }
    'es:keyfile.both' { return 'usa --api-key-file o --api-key-stdin, no los dos' }
    'es:keyfile.not_file' { return 'el archivo dado a --api-key-file tiene que ser un archivo normal, no una carpeta ni un enlace: %s' }
    'es:keyfile.shape' { return ('el contenido del archivo dado a --api-key-file no es una l' + [char]0x00ED + 'nea de 16 a 512 caracteres imprimibles sin espacios: %s') }
    'es:keyfile.size' { return ('el archivo dado a --api-key-file est' + [char]0x00E1 + ' vac' + [char]0x00ED + 'o o es demasiado grande para una clave (de 1 a 4096 bytes): %s') }
    'es:keyfile.twice' { return '--api-key-file se ha dado dos veces' }
    'es:keyfile.unreadable' { return 'no se puede leer el archivo dado a --api-key-file: %s' }
    'es:line.abbinamento_annullato_nessuna_modifica' { return ('Vinculaci' + [char]0x00F3 + 'n cancelada: no se ha cambiado nada.') }
    'es:line.abbinamento_di_s_non_riuscito' { return ('La vinculaci' + [char]0x00F3 + 'n de %s no ha salido bien: todas las copias antiguas se quedan. Vuelve a ejecutar jht telegram pair --all: los roles ya vinculados no piden otro token.') }
    'es:line.abbinamento_rifiutato_genera_un_token' { return ('Vinculaci' + [char]0x00F3 + 'n rechazada: genera un token nuevo en BotFather (/revoke) y vuelve a intentarlo.') }
    'es:line.agent_restart_failed.inventario_conservato_ma_il_team' { return ('inventario conservado, pero el equipo no ha vuelto a arrancar. Qu' + [char]0x00E9 + ' hacer: jht up') }
    'es:line.annullato_niente_autorizzato' { return 'Cancelado: no se ha autorizado nada.' }
    'es:line.anteprima_non_valida_niente_autorizzato' { return ('Vista previa no v' + [char]0x00E1 + 'lida: no se ha autorizado nada.') }
    'es:line.apply.authorize' { return ('' + [char]0x00BF + 'Autorizas esta candidatura?') }
    'es:line.apply_relink_account_cloud_account' { return ('apply relink-account: la cuenta cloud no est' + [char]0x00E1 + ' disponible. Ejecuta antes jht cloud pair.') }
    'es:line.autorizzata_s_verso_s_il' { return ('Autorizada la #%s, hacia %s: el CLOSER la recoger' + [char]0x00E1 + ' en la pr' + [char]0x00F3 + 'xima ronda.') }
    'es:line.bot_abbinato_e_copia_legacy' { return ('Bot vinculado y copia antigua eliminada. Quedan otros tokens antiguos o un token en el entorno del contenedor: qu' + [char]0x00ED + 'talos y completa la rotaci' + [char]0x00F3 + 'n antes del cambio definitivo.') }
    'es:line.bot_token_invalid.controlla_il_token_generato_da' { return 'revisa el token que te ha generado BotFather.' }
    'es:line.broker_restart_failed.il_servizio_della_posta_non_4' { return ('el servicio de correo no se ha reiniciado. Qu' + [char]0x00E9 + ' hacer: jht mail status') }
    'es:line.broker_start_failed.il_servizio_della_posta_non_2' { return 'el servicio de correo no ha arrancado.' }
    'es:line.broker_start_failed.il_servizio_della_posta_non_3' { return ('el servicio de correo no responde despu' + [char]0x00E9 + 's de 30 segundos.') }
    'es:line.broker_unavailable.il_broker_dei_segreti_esiste' { return 'el broker de secretos existe, pero no se puede verificar que sea nuestro: no lo toco.' }
    'es:line.broker_unavailable.il_runtime_installato_pi_vecchio_2' { return ('el runtime instalado es m' + [char]0x00E1 + 's antiguo y no tiene el broker de secretos.') }
    'es:line.broker_unavailable.il_servizio_della_posta_non' { return ('el servicio de correo a' + [char]0x00FA + 'n no existe: se crea la primera vez que hace falta.') }
    'es:line.cancellato_marcatore_migrazione_broker_s' { return ('Borrado: marcador de migraci' + [char]0x00F3 + 'n del broker %s') }
    'es:line.cancellato_volume_broker_s_s' { return 'Borrado: volumen del broker %s (%s)' }
    'es:line.container_s_non_e_partito' { return 'El contenedor ''%s'' no ha arrancado en 10 s. Revisa ''jht logs''.' }
    'es:line.cosa_fare_jht_mail_setup' { return ('Qu' + [char]0x00E9 + ' hacer: jht mail setup') }
    'es:line.cosa_fare_jht_up_3' { return ('Qu' + [char]0x00E9 + ' hacer: jht up') }
    'es:line.cosa_fare_jht_upgrade_4' { return ('Qu' + [char]0x00E9 + ' hacer: jht upgrade') }
    'es:line.cosa_fare_riprova_il_comando_2' { return ('Qu' + [char]0x00E9 + ' hacer: vuelve a intentar el comando') }
    'es:line.fino_ad_allora_la_posta' { return ('Hasta entonces el correo se lee y se env' + [char]0x00ED + 'a con la contrase' + [char]0x00F1 + 'a actual; el aviso sigue en jht mail status.') }
    'es:line.genera_una_nuova_password_per' { return ('genera una nueva contrase' + [char]0x00F1 + 'a de aplicaci' + [char]0x00F3 + 'n en tu proveedor y gu' + [char]0x00E1 + 'rdala con: jht mail setup') }
    'es:line.i_segreti_e_lo_stato' { return ('Se han borrado los secretos y el estado del broker: vuelve a iniciar sesi' + [char]0x00F3 + 'n en los portales y configura otra vez el correo.') }
    'es:line.il_broker_non_ha_registrato' { return ('El broker no ha registrado la autorizaci' + [char]0x00F3 + 'n: retirada, no saldr' + [char]0x00E1 + ' nada.') }
    'es:line.integration.install_hint' { return 'para instalarlas: ''jht upgrade'' (o un ''jht integration add <id>'')' }
    'es:line.interattivo_il_token_viene_chiesto' { return ('Interactivo: el token se pide sin eco y luego el bot nuevo recibe un c' + [char]0x00F3 + 'digo de un solo uso desde tu Telegram. Automatizaciones: {"bot_token": ...} como JSON por stdin; no guardes el token en ~/.jht y borra enseguida cualquier archivo usado fuera de ah' + [char]0x00ED + '.') }
    'es:line.jht_telegram_pair_all_interattivo' { return 'jht telegram pair --all es interactivo: para las automatizaciones vincula un rol cada vez.' }
    'es:line.job_hunter_team_non_installato' { return ('Job Hunter Team no est' + [char]0x00E1 + ' instalado del todo: en la carpeta del runtime falta el archivo de integridad (' + [char]0x00BF + 'una instalaci' + [char]0x00F3 + 'n interrumpida?). Vuelve a ejecutar el instalador.') }
    'es:line.la_casella_di_posta_ora' { return ('El buz' + [char]0x00F3 + 'n de correo ahora est' + [char]0x00E1 + ' en el broker de secretos. Su contrase' + [char]0x00F1 + 'a la pod' + [char]0x00ED + 'an leer los agentes:') }
    'es:line.legacy_cleanup_failed.i_token_nuovi_sono_al' { return ('los tokens nuevos est' + [char]0x00E1 + 'n a salvo, pero la copia antigua de %s sigue en ~/.jht; cambio definitivo rechazado.') }
    'es:line.legacy_inventory_failed.il_team_resta_fermo_perch_4' { return 'el equipo sigue detenido porque no se ha conservado el inventario de Telegram del host.' }
    'es:line.legacy_inventory_failed.le_impronte_non_sono_state' { return 'el servicio aislado no ha conservado las huellas.' }
    'es:line.legacy_inventory_failed.migrazione_telegram_interrotta' { return ('migraci' + [char]0x00F3 + 'n de Telegram interrumpida.') }
    'es:line.legacy_inventory_failed.non_posso_provare_che_jht' { return 'no puedo demostrar que ~/.jht no tenga tokens de Telegram.' }
    'es:line.legacy_inventory_failed.non_riesco_a_fermare_gli' { return 'no puedo detener a los agentes antes del inventario del host.' }
    'es:line.legacy_inventory_failed.non_riesco_a_leggere_i' { return 'no puedo leer los tokens antiguos en ~/.jht.' }
    'es:line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti' { return 'roles antiguos no reconocidos.' }
    'es:line.legacy_remove_failed.s_nel_broker_ma_la' { return ('%s est' + [char]0x00E1 + ' en el broker, pero la copia en ~/.jht/credentials se ha quedado.') }
    'es:line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso' { return ('~/.jht/credentials/%s.json ha vuelto a aparecer despu' + [char]0x00E9 + 's de la migraci' + [char]0x00F3 + 'n; eliminado sin importarlo.') }
    'es:line.mail.address_prompt' { return ('Direcci' + [char]0x00F3 + 'n del buz' + [char]0x00F3 + 'n:') }
    'es:line.mail.app_password_prompt' { return ('Contrase' + [char]0x00F1 + 'a de aplicaci' + [char]0x00F3 + 'n (no se muestra):') }
    'es:line.mail.dedicated_prompt' { return ('' + [char]0x00BF + 'Es un buz' + [char]0x00F3 + 'n DEDICADO a los avisos de empleo reenviados?') }
    'es:line.mail_setup_opzione_sconosciuta_s' { return ('mail setup: opci' + [char]0x00F3 + 'n desconocida %s') }
    'es:line.mail_setup_password_vuota' { return ('mail setup: contrase' + [char]0x00F1 + 'a vac' + [char]0x00ED + 'a') }
    'es:line.nessun_provider_attivo_scegline_uno' { return ('no hay ning' + [char]0x00FA + 'n proveedor activo: elige uno con ''jht providers use glm''') }
    'es:line.nessun_ruolo_ha_un_token' { return ('Ning' + [char]0x00FA + 'n rol tiene un token antiguo: para un bot nuevo usa jht telegram pair <rol>.') }
    'es:line.non_autorizzabile_s' { return 'No se puede autorizar: %s.' }
    'es:line.non_autorizzata_s' { return 'No autorizada: %s.' }
    'es:line.os_and_version_are_required' { return '--os y --version son obligatorios' }
    'es:line.podman_non_trovato_reinstalla_il' { return 'No se encuentra Podman: vuelve a instalar el runtime de JHT.' }
    'es:line.preparo_il_servizio_della_posta' { return ('Preparando el servicio de correo (solo se crea la primera vez que hace falta)' + [char]0x2026) }
    'es:line.provider_attivo_non_riconosciuto_s' { return 'proveedor activo no reconocido: %s' }
    'es:line.reset_impossibile_cancellare_il_marcatore' { return ('reset: no se puede borrar el marcador de migraci' + [char]0x00F3 + 'n del broker %s.') }
    'es:line.reset_impossibile_cancellare_il_marcatore_2' { return 'reset: no se puede borrar el marcador del broker %s.' }
    'es:line.reset_impossibile_cancellare_il_volume' { return 'reset: no se puede borrar el volumen del broker %s (%s).' }
    'es:line.reset_nome_volume_non_valido' { return ('reset: nombre de volumen no v' + [char]0x00E1 + 'lido para %s; eliminaci' + [char]0x00F3 + 'n rechazada.') }
    'es:line.reset_non_riesco_a_determinare' { return ('reset: no puedo determinar el proyecto Compose; no se han tocado los vol' + [char]0x00FA + 'menes del broker.') }
    'es:line.reset_non_riesco_a_fermare' { return ('reset: no puedo detener el runtime; no se han tocado los vol' + [char]0x00FA + 'menes del broker.') }
    'es:line.reset_ricerca_del_volume_s_2' { return 'reset: no se ha podido buscar el volumen %s.' }
    'es:line.restano_token_legacy_per_s' { return ('Quedan tokens antiguos para: %s. Hasta que vincules tambi' + [char]0x00E9 + 'n estos roles, %s se queda mudo en Telegram: vinc' + [char]0x00FA + 'lalos todos en esta sesi' + [char]0x00F3 + 'n (jht telegram pair --all).') }
    'es:line.risposta_del_container_non_valida' { return ('Respuesta del contenedor no v' + [char]0x00E1 + 'lida: autorizaci' + [char]0x00F3 + 'n retirada, no saldr' + [char]0x00E1 + ' nada.') }
    'es:line.ritirata_s_non_verra_inviata' { return ('Retirada la #%s: no se enviar' + [char]0x00E1 + '.') }
    'es:line.ritiro_non_riuscito_s' { return 'No se ha podido retirar: %s.' }
    'es:line.runtime_migration_docker_missing.il_client_docker_originale_non' { return ('el cliente Docker original no est' + [char]0x00E1 + ' disponible.') }
    'es:line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata' { return 'hace falta la imagen de JHT fijada por digest.' }
    'es:line.runtime_migration_podman_missing.podman_non_e_disponibile' { return ('Podman no est' + [char]0x00E1 + ' disponible.') }
    'es:line.runtime_migration_team_running.ferma_prima_il_team_docker' { return ('det' + [char]0x00E9 + 'n antes el equipo de Docker.') }
    'es:line.runtime_migration_team_running.ferma_prima_il_team_podman' { return ('det' + [char]0x00E9 + 'n antes el equipo de Podman.') }
    'es:line.runtime_o_container_jht_non' { return 'runtime o contenedor de JHT no disponible' }
    'es:line.ruoli_da_abbinare_in_questa' { return ('Roles que vincular en esta sesi' + [char]0x00F3 + 'n: %s') }
    'es:line.s_ha_gi_un_bot' { return '%s ya tiene un bot vinculado: solo quito su copia antigua.' }
    'es:line.s_needs_a_value' { return '%s necesita un valor' }
    'es:line.saltato_non_trovato_volume_broker' { return 'Omitido (no encontrado): volumen del broker %s' }
    'es:line.serve_un_terminale_l_autorizzazione' { return ('Hace falta un terminal: la autorizaci' + [char]0x00F3 + 'n se confirma a mano.') }
    'es:line.telegram_isolato_attivo_il_bridge' { return 'Telegram aislado activo; los agentes ya no pueden volver a activar el bridge antiguo.' }
    'es:line.the_setup_keeps_the_key' { return ('La configuraci' + [char]0x00F3 + 'n guarda la clave: ya puedes borrar el archivo de este ordenador (%s).') }
    'es:line.upgrade.done' { return ('Actualizaci' + [char]0x00F3 + 'n completada: %s (%s) -> %s (%s). %s') }
    'es:line.upgrade.restored' { return 'Runtime anterior restaurado.' }
    'es:line.uso_jht_apply_relink_account' { return 'uso: jht apply relink-account' }
    'es:line.uso_jht_apply_request_cancel_2' { return 'uso: jht apply request|cancel <id>' }
    'es:line.uso_jht_mail_setup_status' { return ('uso: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <direcci' + [char]0x00F3 + 'n|@dominio>|drafts|approve <id>|discard <id>|journal|delete|migrate') }
    'es:line.uso_jht_migrate_runtime_podman' { return 'uso: jht migrate-runtime podman' }
    'es:line.uso_jht_screen_on_off' { return 'uso: jht screen on | off | status [--json]' }
    'es:line.uso_jht_telegram_chat_id' { return 'uso: jht telegram chat-id <assistente|capitano|mentor>' }
    'es:line.uso_jht_telegram_pair_assistente' { return 'uso: jht telegram pair <assistente|capitano|mentor>|--all' }
    'es:line.uso_jht_telegram_remove_assistente' { return 'uso: jht telegram remove <assistente|capitano|mentor>' }
    'es:line.uso_jht_telegram_status_pair' { return 'uso: jht telegram status|pair <rol>|pair --all|chat-id <rol>|remove <rol>' }
    'es:monitor.window_invalid' { return 'monitor_window_invalid: usa ''jht monitor --window'' sin otras opciones.' }
    'es:ps.apply_auto_send_warning_1' { return ('  Con el env' + [char]0x00ED + 'o autom' + [char]0x00E1 + 'tico activado, el equipo rellena y ENV' + [char]0x00CD + 'A la candidatura,') }
    'es:ps.apply_auto_send_warning_2' { return ('  sin otra confirmaci' + [char]0x00F3 + 'n. Una vez enviada, no se puede retirar.') }
    'es:ps.artifact_copied' { return 'He copiado %s en %s para que el equipo pueda leerlo.' }
    'es:ps.artifact_copy_failed' { return 'no puedo copiar %s en la carpeta compartida: %s' }
    'es:ps.artifact_copy_refused' { return ('no copio %s: %s es un enlace o no est' + [char]0x00E1 + ' dentro de la carpeta compartida') }
    'es:ps.bot_token_prompt_hidden' { return 'Token del bot %s (entrada oculta)' }
    'es:ps.botfather_fresh_token' { return ('Usa siempre un token reci' + [char]0x00E9 + 'n generado en BotFather (/revoke en el bot, o un bot nuevo): un token ya existente pueden haberlo le' + [char]0x00ED + 'do los agentes aunque hoy no aparezca en ~/.jht.') }
    'es:ps.broker_network_proxy_not_ready' { return ('broker_network_unavailable: el proxy de correo no est' + [char]0x00E1 + ' listo (c' + [char]0x00F3 + 'digo %s).') }
    'es:ps.broker_network_scripts_not_downloadable' { return ('broker_network_unavailable: no puedo descargar los scripts del proxy de correo. Qu' + [char]0x00E9 + ' hacer: jht upgrade') }
    'es:ps.broker_network_scripts_not_verified' { return ('broker_network_unavailable: los scripts del proxy de correo no se pueden verificar. Qu' + [char]0x00E9 + ' hacer: jht upgrade') }
    'es:ps.broker_restart_failed_secrets_broker_not_ours' { return ('broker_restart_failed: el broker de secretos no se puede verificar como nuestro: no lo toco. Qu' + [char]0x00E9 + ' hacer: jht mail status') }
    'es:ps.broker_unavailable_secrets_broker_not_running' { return ('broker_unavailable: el broker de secretos no est' + [char]0x00E1 + ' activo.') }
    'es:ps.cli_version_needs_container' { return ('Para la versi' + [char]0x00F3 + 'n del CLI en ejecuci' + [char]0x00F3 + 'n hace falta el contenedor en marcha: ''jht up''.') }
    'es:ps.compose_up_failed_team_not_started' { return ('compose_up_failed: el equipo no ha arrancado (docker compose up, c' + [char]0x00F3 + 'digo %s). Revisa ''jht logs''.') }
    'es:ps.container_not_running' { return ('el contenedor ''%s'' no est' + [char]0x00E1 + ' en marcha') }
    'es:ps.container_runtime_unsupported' { return 'runtime de contenedores no compatible: %s' }
    'es:ps.docker_desktop_file_sharing_hint' { return ('  Qu' + [char]0x00E9 + ' hacer: abre Docker Desktop > Settings > Resources > File sharing, comprueba que la carpeta del usuario est' + [char]0x00E9 + ' compartida y vuelve a ejecutar ''jht up''.') }
    'es:ps.docker_podman_verified_future_removal' { return ('Migraci' + [char]0x00F3 + 'n Docker -> Podman verificada. Los vol' + [char]0x00FA + 'menes de Docker siguen intactos y a' + [char]0x00FA + 'n contienen las contrase' + [char]0x00F1 + 'as del correo, los accesos a los portales y los tokens de Telegram: para eliminarlos har' + [char]0x00E1 + ' falta en el futuro una confirmaci' + [char]0x00F3 + 'n expl' + [char]0x00ED + 'cita.') }
    'es:ps.doctor.wsl_memory' { return ('WSL no tiene l' + [char]0x00ED + 'mite de memoria (hay otras distribuciones de WSL registradas): en %s, bajo [wsl2], a' + [char]0x00F1 + 'ade memory=%s') }
    'es:ps.download_asset_failed_detail' { return 'la descarga ha fallado: %s (%s)' }
    'es:ps.download_shared_folder_no_path' { return ('el destino est' + [char]0x00E1 + ' dentro de una carpeta compartida con el equipo: elige una fuera de ella, como Downloads.') }
    'es:ps.download_sums_failed_detail' { return 'la descarga ha fallado: SHA256SUMS de v%s (%s)' }
    'es:ps.full_pull_failed_keep_old' { return ('full_pull_failed: no ha llegado la imagen completa nueva, se queda la anterior. Qu' + [char]0x00E9 + ' hacer: jht tools pull') }
    'es:ps.help.main' { return (('jht - Job Hunter Team', '', ('  Comandos del host (funcionan desde aqu' + [char]0x00ED + '):'), '    jht up                 arranca el contenedor del equipo', '    jht down               lo detiene', ('                           (con --verbose se ven tambi' + [char]0x00E9 + 'n las l' + [char]0x00ED + 'neas del motor)'), '    jht restart            lo reinicia', '    jht status             estado del contenedor y del equipo', '    jht logs [-f]          logs del contenedor', ('    jht upgrade            actualiza a la imagen m' + [char]0x00E1 + 's reciente'), ('    jht setup              instalaci' + [char]0x00F3 + 'n guiada'), '    jht shell              shell dentro del contenedor', ('    jht mail setup         guarda el buz' + [char]0x00F3 + 'n de correo en el broker de secretos'), '    jht mail drafts        correos escritos por los agentes que esperan tu ok', ('    jht mail approve <id>  los env' + [char]0x00ED + 'a; jht mail discard <id> los descarta'), '    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]', ('                           las integraciones que se a' + [char]0x00F1 + 'aden despu' + [char]0x00E9 + 's del setup'), ('                           (google, telegram, mail): estado le' + [char]0x00ED + 'do del motor'), '    jht telegram status    estado del servicio de Telegram aislado', '    jht telegram pair ROLE pide el token sin eco en el ordenador host, luego', ('                           muestra un c' + [char]0x00F3 + 'digo que mandar al bot desde tu Telegram'), '                           Para automatizaciones: JSON por stdin. No guardes el token', ('                           en ~/.jht; borra enseguida los archivos usados fuera de ah' + [char]0x00ED + '.'), ('    jht telegram pair --all empareja en una sola sesi' + [char]0x00F3 + 'n todos los roles legacy'), ('    jht telegram chat-id ROLE mueve el bot a otro chat, con el mismo c' + [char]0x00F3 + 'digo'), ('    jht reset              borra la configuraci' + [char]0x00F3 + 'n y los vol' + [char]0x00FA + 'menes del broker'), '    jht migrate-runtime podman', ('                           copia y verifica los vol' + [char]0x00FA + 'menes de Docker en Podman;'), '                           no selecciona el nuevo runtime y no borra Docker', '    jht uninstall --confirm elimina el runtime local de Windows, pero conserva datos,', '                           documentos, Podman y Compose', '', ('  Todos los dem' + [char]0x00E1 + 's comandos (positions, stats, team, providers, cron,'), '  working-hours, cloud...) se ejecutan DENTRO del contenedor: para su ayuda', '  hace falta el contenedor en marcha.', '', '      jht up ; jht --help') -join [char]10) }
    'es:ps.home_unavailable_bind_mount' { return 'HOME/USERPROFILE no disponible: bind mount de JHT rechazado' }
    'es:ps.host_download_failed' { return 'la descarga en el host ha fallado: %s' }
    'es:ps.input_not_json_bot_token_stdin' { return 'input_not_json: pasa bot_token como JSON por stdin.' }
    'es:ps.integration_not_installed' { return 'no instalado' }
    'es:ps.integration_not_installed_yet' { return ('a' + [char]0x00FA + 'n no instalado') }
    'es:ps.jht_container_not_verifiable' { return 'El contenedor de JHT no se puede verificar.' }
    'es:ps.jht_home_missing' { return ('Job Hunter Team a' + [char]0x00FA + 'n no est' + [char]0x00E1 + ' instalado: la carpeta %s no existe. Ejecuta el instalador y despu' + [char]0x00E9 + 's ''jht setup''.') }
    'es:ps.legacy_cleanup_failed_old_token_still_there' { return 'legacy_cleanup_failed: el token antiguo sigue en ~/.jht; cambio definitivo rechazado.' }
    'es:ps.legacy_migration_failed_stays' { return 'legacy_migration_failed: %s se queda en ~/.jht/credentials.' }
    'es:ps.lifecycle.restarted' { return 'Job Hunter Team reiniciado.' }
    'es:ps.link_or_not_folder' { return 'enlace o no es una carpeta' }
    'es:ps.localappdata_unavailable' { return 'LOCALAPPDATA no disponible: runtime del host rechazado' }
    'es:ps.machine_space_back_on_stop' { return ('Unos %s GB liberados en la m' + [char]0x00E1 + 'quina de JHT vuelven a Windows cuando la m' + [char]0x00E1 + 'quina se detiene: tras jht down, con podman machine stop %s, o al reiniciar el ordenador.') }
    'es:ps.machine_space_not_returned' { return 'JHT ocupa unos %s GB en su disco virtual; se liberan del todo con jht uninstall.' }
    'es:ps.machine_state_unreadable' { return ('el estado de la m' + [char]0x00E1 + 'quina no se puede leer (podman y wsl no responden)') }
    'es:ps.monitor_window_unavailable' { return ('monitor_window_unavailable: aqu' + [char]0x00ED + ' no se puede abrir una ventana de terminal. Ejecuta ''jht monitor'' en el terminal actual.') }
    'es:ps.mount_repair_failed_folders_not_writable' { return 'mount_repair_failed: las carpetas de Job Hunter Team (%s, %s) no son escribibles para el contenedor y no se han podido arreglar.' }
    'es:ps.old_images_busy' { return ' En uso por un contenedor (conservadas): %s.' }
    'es:ps.old_images_kept_all' { return ('Im' + [char]0x00E1 + 'genes de JHT antiguas: se conservan todas (JHT_KEEP_OLD_IMAGES=1).') }
    'es:ps.old_images_refused' { return ' Rechazadas por el motor (conservadas): %s.' }
    'es:ps.old_images_removed' { return ('Im' + [char]0x00E1 + 'genes de JHT antiguas: eliminadas %s, liberados unos %s MB (tama' + [char]0x00F1 + 'o nominal: las capas compartidas se liberan solo en parte), conservadas: la actual y la anterior.') }
    'es:ps.pair_role_now_prompt' { return ('' + [char]0x00BF + 'Emparejar %s ahora? [s/N]') }
    'es:ps.podman_exe_not_found' { return 'no se encuentra podman.exe' }
    'es:ps.podman_machine_not_responding' { return ('La m' + [char]0x00E1 + 'quina Podman de JHT no responde. Ejecuta ''jht up''.') }
    'es:ps.release_arrived_without_https' { return 'la release ha llegado sin HTTPS: %s' }
    'es:ps.relink_account_container_not_running' { return ('apply relink-account: el contenedor no est' + [char]0x00E1 + ' en marcha.') }
    'es:ps.script_integration_not_installed' { return ('el script jht-integration.ps1 a' + [char]0x00FA + 'n no est' + [char]0x00E1 + ' instalado: ''jht upgrade'' (o un ''jht integration add/remove'') y vuelve a intentarlo') }
    'es:ps.script_tools_not_installed' { return ('el script jht-tools.ps1 a' + [char]0x00FA + 'n no est' + [char]0x00E1 + ' instalado: ''jht upgrade'' y vuelve a intentarlo') }
    'es:ps.startup_task_still_registered' { return 'la tarea sigue registrada' }
    'es:ps.team_container_unavailable' { return 'team_container_unavailable: arranca el equipo con jht up y vuelve a intentarlo.' }
    'es:ps.telegram_not_configured' { return ('Telegram no activo: Telegram no est' + [char]0x00E1 + ' configurado.') }
    'es:ps.telegram_status_unverifiable' { return 'Telegram: estado no verificable ahora (servicio apagado o inalcanzable). Detalles: jht telegram status' }
    'es:ps.telegram_unavailable_isolated_not_running' { return ('telegram_unavailable: el servicio de Telegram aislado no est' + [char]0x00E1 + ' activo.') }
    'es:ps.telegram_unavailable_run_jht_up' { return 'telegram_unavailable: ejecuta jht up' }
    'es:ps.uninstall.bad.target' { return 'Rechazado: {0} es un enlace o no es una carpeta: no lo sigo ni lo borro.' }
    'es:ps.uninstall.done' { return ('Hecho: la m' + [char]0x00E1 + 'quina <machine> (y con ella las im' + [char]0x00E1 + 'genes de JHT, la b' + [char]0x00E1 + 'sica y la completa), el runtime y el comando jht se han eliminado.') }
    'es:ps.uninstall.done.kept' { return ' ~/.jht y Documents\Job Hunter Team se quedan (con --purge se borran).' }
    'es:ps.uninstall.done.wsl' { return ('WSL se queda en memoria: vmmem, wslservice y wslrelay son componentes de Windows (no los instal' + [char]0x00F3 + ' Job Hunter Team) y las otras m' + [char]0x00E1 + 'quinas WSL de este usuario tambi' + [char]0x00E9 + 'n los necesitan; normalmente se detienen solos al cabo de un rato de inactividad. Para detenerlos ahora: wsl --shutdown (detiene TODAS las m' + [char]0x00E1 + 'quinas WSL abiertas).') }
    'es:ps.uninstall.kept.machine' { return ('La m' + [char]0x00E1 + 'quina Podman {0} no figura como creada por el instalador: se queda donde est' + [char]0x00E1 + '. A mano, si es tuya y quieres eliminarla: podman machine stop {0}; podman machine rm {0}.') }
    'es:ps.uninstall.left.commands' { return ('No se han eliminado el comando jht o los archivos del instalador en {0} ({1}), ni las variables y las l' + [char]0x00ED + 'neas del PATH que a' + [char]0x00F1 + 'adi' + [char]0x00F3 + ' el instalador. A mano: Remove-Item del archivo; las variables JHT_CONTAINER_RUNTIME y JHT_PODMAN_MACHINE y la carpeta {0} del PATH desde Configuraci' + [char]0x00F3 + 'n > Variables de entorno.') }
    'es:ps.uninstall.left.data' { return ('No se han borrado los datos de JHT ({0}). A mano: Remove-Item -Recurse -Force {1}. El comando jht y el runtime siguen ah' + [char]0x00ED + ': vuelve a ejecutar jht uninstall --confirm --purge cuando lo hayas resuelto.') }
    'es:ps.uninstall.left.machine' { return ('No eliminada: la m' + [char]0x00E1 + 'quina Podman <machine>. Motivo: {0}. A mano: podman machine stop <machine>; wsl --unregister {1}; luego vuelve a ejecutar jht uninstall --confirm.') }
    'es:ps.uninstall.left.runtime' { return 'No eliminado: el runtime de JHT en {0}. A mano: Remove-Item -Recurse -Force ''{0}''.' }
    'es:ps.uninstall.left.task' { return ('No se ha eliminado la tarea de inicio al iniciar sesi' + [char]0x00F3 + 'n ''{0}'' (motivo: {1}). Lo dem' + [char]0x00E1 + 's se ha eliminado. A mano: schtasks /Delete /TN "{0}" /F.') }
    'es:ps.uninstall.phase.commands' { return ('Eliminando el comando jht, los archivos del instalador y las l' + [char]0x00ED + 'neas del PATH...') }
    'es:ps.uninstall.phase.data' { return 'Borrando ~/.jht y Documents\Job Hunter Team (--purge)...' }
    'es:ps.uninstall.phase.machine' { return ('Eliminando la m' + [char]0x00E1 + 'quina Podman <machine> (con los secretos y las im' + [char]0x00E1 + 'genes de JHT)...') }
    'es:ps.uninstall.phase.runtime' { return 'Eliminando el runtime de JHT...' }
    'es:ps.uninstall.purge_notice' { return ('Con --purge tambi' + [char]0x00E9 + 'n se borran ~/.jht y Documents\Job Hunter Team: configuraci' + [char]0x00F3 + 'n, base de datos, CV y resultados. No hay vuelta atr' + [char]0x00E1 + 's.') }
    'es:ps.uninstall.purge_removal_notice' { return ('Tambi' + [char]0x00E9 + 'n se borran la contrase' + [char]0x00F1 + 'a del correo y los tokens de Telegram guardados.') }
    'es:ps.uninstall.removal_notice' { return ('Tambi' + [char]0x00E9 + 'n se borran la contrase' + [char]0x00F1 + 'a del correo y los tokens de Telegram guardados; ~/.jht y Documentos se quedan, y con ellos la sesi' + [char]0x00F3 + 'n de LinkedIn guardada (secrets/linkedin-profile y .cache/linkedin): b' + [char]0x00F3 + 'rrala con jht reset --scope creds.') }
    'es:ps.uninstall.secrets' { return ('No se han eliminado los secretos guardados: la contrase' + [char]0x00F1 + 'a del correo y los tokens de Telegram est' + [char]0x00E1 + 'n en los vol' + [char]0x00FA + 'menes jht-secrets y jht-telegram-secrets de la m' + [char]0x00E1 + 'quina <machine>, que sigue ah' + [char]0x00ED + '.') }
    'es:ps.uninstall.wslconfig.done' { return ('Se han quitado de {0} las l' + [char]0x00ED + 'neas que a' + [char]0x00F1 + 'adi' + [char]0x00F3 + ' el instalador (memoria de WSL).') }
    'es:ps.uninstall.wslconfig.kept' { return ('Se han dejado en {0} las l' + [char]0x00ED + 'neas que cambiaste t' + [char]0x00FA + ': son tuyas.') }
    'es:ps.uninstall.wslconfig.left' { return ('No se ha tocado {0} ({1}): las l' + [char]0x00ED + 'neas que a' + [char]0x00F1 + 'adi' + [char]0x00F3 + ' el instalador (memoria de WSL) se quedan. Qu' + [char]0x00ED + 'talas a mano: cada una tiene una l' + [char]0x00ED + 'nea de comentario encima.') }
    'es:ps.unknown_argument' { return 'argumento desconocido: %s' }
    'es:ps.upgrade_already_running' { return ('Ya hay una actualizaci' + [char]0x00F3 + 'n en curso') }
    'es:ps.upgrade_broker_restart_failed' { return ('broker_restart_failed: el broker de secretos no se ha reiniciado. Qu' + [char]0x00E9 + ' hacer: jht up') }
    'es:ps.upgrade_disk_low' { return ('disk_low: Los agentes necesitan al menos %s GiB de disco ' + [char]0x2014 + ' disponibles: %s GiB. Para liberar espacio vac' + [char]0x00ED + 'a la Papelera y borra los archivos grandes que no necesites y las im' + [char]0x00E1 + 'genes de Docker sin usar; luego vuelve a intentarlo: no se ha descargado ni cambiado nada.') }
    'es:ps.upgrade_docker_unavailable' { return 'Docker o runtime del host no disponible' }
    'es:ps.upgrade_helper_install_failed' { return ('helper_install_failed: los scripts nuevos del host se descargan en la primera petici' + [char]0x00F3 + 'n o con otro ''jht upgrade''') }
    'es:ps.upgrade_host_runtime_not_installable' { return 'No se puede instalar el runtime protegido del host' }
    'es:ps.upgrade_host_runtime_untrusted' { return 'Runtime del host no fiable' }
    'es:ps.upgrade_image_download_failed' { return 'La descarga de la imagen ha fallado' }
    'es:ps.upgrade_journal_not_updated' { return 'No se puede actualizar el journal' }
    'es:ps.upgrade_metadata_not_persisted' { return 'Metadatos del runtime no guardados' }
    'es:ps.upgrade_mounts_not_writable' { return 'Las carpetas de Job Hunter Team no se pueden escribir desde el contenedor (mount_repair_failed)' }
    'es:ps.upgrade_not_completed' { return ('Actualizaci' + [char]0x00F3 + 'n no completada (%s): %s') }
    'es:ps.upgrade_note_activate_runtime' { return 'Activando el nuevo runtime...' }
    'es:ps.upgrade_note_download_image' { return ('Descargando la imagen m' + [char]0x00E1 + 's reciente...') }
    'es:ps.upgrade_note_download_runtime' { return 'Descargando el runtime actualizado...' }
    'es:ps.upgrade_option_unsupported' { return ('Opci' + [char]0x00F3 + 'n de upgrade no admitida') }
    'es:ps.upgrade_pulling_full_image' { return 'Descargo la imagen completa actualizada...' }
    'es:ps.upgrade_recovery_failed' { return ('La recuperaci' + [char]0x00F3 + 'n del upgrade anterior ha fallado') }
    'es:ps.upgrade_release_core_invalid' { return ('La versi' + [char]0x00F3 + 'n no incluye un n' + [char]0x00FA + 'cleo v' + [char]0x00E1 + 'lido para esta instalaci' + [char]0x00F3 + 'n: reinstala') }
    'es:ps.upgrade_remote_compose_invalid' { return ('Compose remoto no v' + [char]0x00E1 + 'lido') }
    'es:ps.upgrade_remote_runtime_invalid' { return ('Runtime remoto no v' + [char]0x00E1 + 'lido o inaccesible') }
    'es:ps.upgrade_rollback_not_prepared' { return 'No se puede preparar el rollback' }
    'es:ps.upgrade_telegram_restart_failed' { return ('telegram_restart_failed: el servicio de Telegram aislado no se ha reiniciado. Qu' + [char]0x00E9 + ' hacer: jht up') }
    'es:ps.upgrade_test_channel' { return 'Canal de pruebas: se actualiza reinstalando desde la build de pruebas' }
    'es:ps.upgrade_unexpected_error' { return ('Error inesperado durante la actualizaci' + [char]0x00F3 + 'n') }
    'es:ps.upgrade_verify_failed' { return ('El nuevo runtime no ha superado la verificaci' + [char]0x00F3 + 'n') }
    'es:ps.use_fresh_botfather_token' { return ('Usa siempre un token reci' + [char]0x00E9 + 'n generado en BotFather (/revoke en el bot, o un bot nuevo): un token que ya exist' + [char]0x00ED + 'a puede haber sido le' + [char]0x00ED + 'do por los agentes aunque hoy no aparezca en ~/.jht.') }
    'es:ps.user_dir_unavailable_cannot_create' { return 'user_dir_unavailable: no puedo crear la carpeta %s, que usa el equipo.' }
    'es:ps.wsl_exe_not_found' { return 'no se encuentra wsl.exe' }
    'es:ps.wsl_not_answering' { return 'WSL no responde (wsl --status)' }
    'es:removed.office' { return ('''jht %s'' se elimin' + [char]0x00F3 + ' en la 0.4.0 junto con la oficina de Godot: usa los comandos jht (jht help).') }
    'es:status.no_options' { return ('''jht status'' no admite opciones (%s): ejec' + [char]0x00FA + 'talo como ''jht status''.') }
    'es:status.not_running' { return ('El contenedor del equipo no est' + [char]0x00E1 + ' en marcha.') }
    'es:status.not_running_next' { return ('Arr' + [char]0x00E1 + 'ncalo con: jht up') }
    'es:team.stopped' { return ('Job Hunter Team est' + [char]0x00E1 + ' detenido: ''jht up'' lo vuelve a arrancar.') }
    'es:tools.arriving' { return ('Las herramientas de los Scout est' + [char]0x00E1 + 'n en camino: la imagen completa se descarga en segundo plano (unos 3 GB). La b' + [char]0x00FA + 'squeda de puestos empieza sola cuando lleguen; no tienes que hacer nada.') }
    'es:tools.chat_reconnecting' { return ('El equipo pasa a las herramientas completas de los Scout, as' + [char]0x00ED + ' que el chat se detiene un momento: vuelve solo en cuanto el equipo est' + [char]0x00E9 + ' en marcha de nuevo (un par de minutos).') }
    'es:tools.chat_resumed' { return 'El equipo ya usa las herramientas completas: sigamos.' }
    'es:tools.chat_switched' { return ('El equipo pasa a las herramientas completas de los Scout, as' + [char]0x00ED + ' que este chat se ha cerrado. Vuelve a abrirlo en un par de minutos con jht team chat.') }
    'es:tools.chat_update_closed' { return ('JHT se est' + [char]0x00E1 + ' actualizando, as' + [char]0x00ED + ' que este chat se ha cerrado. Vuelve a abrirlo en un par de minutos con jht team chat.') }
    'es:tools.chat_update_resumed' { return ('JHT ya est' + [char]0x00E1 + ' actualizado: sigamos.') }
    'es:tools.chat_updating' { return ('JHT se est' + [char]0x00E1 + ' actualizando, as' + [char]0x00ED + ' que el chat se detiene un momento: vuelve solo en un minuto o dos.') }
    'es:tools.disk_low' { return ('Las herramientas de los Scout no se han descargado: necesitan unos %s GiB libres en el disco y hay %s GiB, as' + [char]0x00ED + ' que el equipo a' + [char]0x00FA + 'n no puede buscar puestos. Libera espacio (vac' + [char]0x00ED + 'a la Papelera, borra los archivos grandes que no necesites) y luego ejecuta jht up: la descarga vuelve a empezar sola.') }
    'es:tools.engine_down' { return ('No se puede leer el estado de las herramientas de los Scout: el motor de contenedores no responde. Arr' + [char]0x00E1 + 'ncalo con jht up.') }
    'es:tools.failed' { return ('La descarga de las herramientas de los Scout ha fallado, as' + [char]0x00ED + ' que el equipo a' + [char]0x00FA + 'n no puede buscar puestos. Ejecuta jht tools pull para reintentarlo (jht up tambi' + [char]0x00E9 + 'n lo reintenta).') }
    'es:tools.ready' { return ('Las herramientas de los Scout ya est' + [char]0x00E1 + 'n aqu' + [char]0x00ED + ': el equipo busca con la imagen completa.') }
    'es:tools.switch_failed' { return ('Las herramientas de los Scout ya est' + [char]0x00E1 + 'n aqu' + [char]0x00ED + ', pero el equipo no se ha podido reiniciar con ellas: ejecuta jht down y luego jht up.') }
    'es:tools.switch_wait' { return ('El equipo est' + [char]0x00E1 + ' pasando a las herramientas completas de los Scout: espero a que vuelva a arrancar (un par de minutos como mucho).') }
    'es:tools.waiting' { return ('Las herramientas de los Scout ya est' + [char]0x00E1 + 'n aqu' + [char]0x00ED + ': el equipo pasa a ellas solo cuando el onboarding est' + [char]0x00E9 + ' cerrado.') }
    'es:uninstall.usage' { return 'uso: jht uninstall --confirm [--purge]' }
    'es:up.done' { return 'Job Hunter Team arrancado.' }
    'de:container.starting' { return ('Container ''%s'' l' + [char]0x00E4 + 'uft nicht, starte ihn...') }
    'de:doctor.host_config_none' { return 'noch keine Konfiguration: ''jht setup''' }
    'de:doctor.host_config_ok' { return 'Konfiguration vorhanden' }
    'de:doctor.host_engine_fail' { return 'Container-Engine nicht erreichbar' }
    'de:doctor.host_engine_ok' { return 'Container-Engine erreichbar' }
    'de:doctor.host_more' { return ('F' + [char]0x00FC + 'r die vollst' + [char]0x00E4 + 'ndigen Pr' + [char]0x00FC + 'fungen (Konfiguration, Anbieter, Datenbank, Agenten): ''jht up'', dann ''jht doctor''.') }
    'de:doctor.host_runtime_fail' { return ('JHT-Runtime fehlt oder wurde ver' + [char]0x00E4 + 'ndert: ''jht upgrade'' installiert sie neu') }
    'de:doctor.host_runtime_ok' { return 'JHT-Runtime intakt' }
    'de:doctor.host_team_off' { return 'Team aus: ''jht up'' startet es' }
    'de:doctor.host_team_unattestable' { return ('Ein Container des Teams ist da, l' + [char]0x00E4 + 'sst sich aber nicht als unserer best' + [char]0x00E4 + 'tigen: Nichts wurde angefasst (''jht status'' sagt mehr)') }
    'de:doctor.host_title' { return ('Job Hunter Team: Das Team ist aus (sein Container l' + [char]0x00E4 + 'uft nicht). Pr' + [char]0x00FC + 'fungen von diesem Computer aus:') }
    'de:down.done' { return 'Job Hunter Team gestoppt.' }
    'de:download.bad_version' { return ('Ung' + [char]0x00FC + 'ltige Version: %s. Beispiel: 0.3.5.') }
    'de:download.deb_only_linux' { return ('--deb gibt es nur f' + [char]0x00FC + 'r Linux.') }
    'de:download.dest_is_link' { return 'Das Ziel ist ein Link: %s' }
    'de:download.dest_not_file' { return 'Das Ziel existiert und ist keine Datei: %s' }
    'de:download.fetching' { return 'Lade %s herunter...' }
    'de:download.hash_invalid' { return ('Ung' + [char]0x00FC + 'ltige SHA-256 f' + [char]0x00FC + 'r %s: erwartet %s, erhalten %s.') }
    'de:download.intel_mac' { return ('Die macOS-App von 0.4 l' + [char]0x00E4 + 'uft nur auf Macs mit Apple silicon (M1 und neuer); das hier ist ein Intel-Mac, den 0.4 nicht unterst' + [char]0x00FC + 'tzt. Nichts wurde heruntergeladen.') }
    'de:download.linux_no_app' { return ('In dieser Version gibt es keine Desktop-App f' + [char]0x00FC + 'r Linux: Nutze install.sh. Nichts wurde heruntergeladen.') }
    'de:download.mismatch_existing' { return ('Die Datei %s existiert, aber ihre SHA-256 stimmt nicht: Sie wurde nicht ' + [char]0x00FC + 'berschrieben.') }
    'de:download.mkdir_failed' { return ('Der Zielordner l' + [char]0x00E4 + 'sst sich nicht erstellen: %s') }
    'de:download.present_verified' { return ('Datei schon vorhanden und gepr' + [char]0x00FC + 'ft: %s') }
    'de:download.release_no_app' { return ('Dieses Release (v%s) hat keine App f' + [char]0x00FC + 'r macOS: Nutze 0.4.0 oder neuer. Nichts wurde heruntergeladen.') }
    'de:download.saved_in' { return 'Gespeichert in: %s' }
    'de:download.sha_verified' { return ('SHA-256 gepr' + [char]0x00FC + 'ft: %s') }
    'de:download.sum_missing' { return ('Keine SHA-256 angegeben f' + [char]0x00FC + 'r %s.') }
    'de:download.unsupported_os' { return ('Nicht unterst' + [char]0x00FC + 'tztes System: %s. Nutze windows oder macos.') }
    'de:download.windows_missing' { return ('Windows ist nicht Teil von 0.4.0: Das Release hat keinen Installer f' + [char]0x00FC + 'r Windows. Nichts wurde heruntergeladen.') }
    'de:help.integration' { return (('Verwendung: jht integration <command>', '', '  list [--json]                   die Integrationen und ihr Zustand', '  status [ID] [--json]            der Zustand einer oder aller', ('  add ID [--json]                 f' + [char]0x00FC + 'gt eine Integration hinzu'), '  remove ID [--purge --yes] [--remove-image] [--json]', ('                                  entfernt sie; --purge l' + [char]0x00F6 + 'scht auch ihre Daten (braucht --yes);'), '                                  --remove-image (nur screen und media) entfernt auch das Tool-Image', '', 'Erlaubt sind die IDs, die `jht integration list` zeigt. Nichts wird heruntergeladen oder gestartet,', 'bevor du es mit `add` verlangst.') -join [char]10) }
    'de:help.linkedin' { return (('Verwendung: jht linkedin <command>', '', '  login [--stop]    die Anmeldung von Hand bei LinkedIn (mit Google): ein Browser in einem eigenen Container, ohne', ('                    Netzwerk, dessen Fenster du in der App siehst und bedienst; --stop schlie' + [char]0x00DF + 't alles'), ('  status --json     sagt, ob die Anmeldung l' + [char]0x00E4 + 'uft und ob die LinkedIn-Sitzung gespeichert ist'), '', 'Nichts wird heruntergeladen oder gestartet, bevor du es mit `login` verlangst.') -join [char]10) }
    'de:help.screen' { return (('Verwendung: jht screen <command>', '', '  on [--json]       startet den Live-Bildschirm des Closers: ein eigener Container, mit dem Stream nur auf 127.0.0.1', '  off [--remove-image] [--json]', '                    stoppt ihn und entfernt den Container; das Tool-Image bleibt auf der Festplatte, damit du ihn', '                    ohne neuen Download wieder starten kannst: --remove-image entfernt es und gibt den Platz frei', ('  status [--json]   sagt, ob er l' + [char]0x00E4 + 'uft'), '', 'Nichts wird heruntergeladen oder gestartet, bevor du es mit `on` verlangst. Der Stream ist nur zum Ansehen.') -join [char]10) }
    'de:help.setup' { return (('Verwendung: jht setup [options]', '', ('Ohne Optionen startet die gef' + [char]0x00FC + 'hrte Installation. Mit --non-interactive wird nichts gefragt:'), ('Alles wird ' + [char]0x00FC + 'ber die Optionen angegeben.'), '', '  --non-interactive            keine Fragen', '  --provider <name>            glm (Z.ai, Standard), kimi (Moonshot), openai oder claude (Anthropic)', '  --harness <name>             pi (Standard)', ('  --api-key-file <path>        Datei mit dem API-Schl' + [char]0x00FC + 'ssel (eine Zeile, nur f' + [char]0x00FC + 'r dich lesbar).'), '                               jht liest die Datei auf deinem Computer und gibt sie ans Setup weiter; bei glm', ('                               und kimi beh' + [char]0x00E4 + 'lt das Setup den Schl' + [char]0x00FC + 'ssel f' + [char]0x00FC + 'r sich, nie in der Konfiguration'), ('  --api-key-stdin              liest den API-Schl' + [char]0x00FC + 'ssel von stdin (eine Zeile): nie auf der Befehlszeile'), ('  --api-key <key>              der Schl' + [char]0x00FC + 'ssel direkt hier, im Klartext (nicht erlaubt f' + [char]0x00FC + 'r glm und kimi)'), ('  --secret-mode <mode>         wie der Schl' + [char]0x00FC + 'ssel gespeichert wird: plaintext (Standard), env oder file'), ('  --secret-env <name>          mit --secret-mode env: die Umgebungsvariable, die ihn enth' + [char]0x00E4 + 'lt'), ('  --secret-file <path>         mit --secret-mode file: die Datei, die ihn enth' + [char]0x00E4 + 'lt'), '  --model <model>              das zu verwendende Modell', '  --language <code>            die Sprache (zum Beispiel it oder en)', '  --budget-usd <dollar>        wie viel das Team ausgeben darf, in Dollar (mit einer von --budget-minutes, --budget-days, --budget-until)', '  --budget-minutes <n>         das Budget gilt so viele Minuten ab jetzt', '  --budget-days <n>            das Budget gilt so viele Tage ab jetzt', ('  --budget-until <stunde>      das Budget gilt bis zu dieser Uhrzeit, 0-23 (der n' + [char]0x00E4 + 'chsten)'), ('  --no-budget                  kein Ausgabenlimit (das Team h' + [char]0x00E4 + 'lt nur beim Guthaben des Anbieters an)'), ('  --skip-health                ' + [char]0x00FC + 'berspringt die abschlie' + [char]0x00DF + 'ende Pr' + [char]0x00FC + 'fung'), '  --reset                      beginnt mit einer sauberen Konfiguration neu', '', 'Beispiele:', ('  mit einem GLM-Schl' + [char]0x00FC + 'ssel in einer Datei:'), '    jht setup --non-interactive --provider glm --harness pi --api-key-file schluessel.txt', ('  OpenAI mit einem API-Schl' + [char]0x00FC + 'ssel, auf Pi (f' + [char]0x00FC + 'r Claude: --provider claude):'), '    jht setup --non-interactive --provider openai --harness pi --api-key-stdin') -join [char]10) }
    'de:help.tools' { return (('Verwendung: jht tools <Befehl>', '', ('  status --json   ob die Werkzeuge der Scouts (das vollst' + [char]0x00E4 + 'ndige Image) da, unterwegs oder fehlgeschlagen sind'), ('  pull            l' + [char]0x00E4 + 'dt sie im Hintergrund herunter (jht up und jht setup starten das von selbst)'), '  switch          bringt das Team darauf, sobald das Onboarding abgeschlossen ist (der Download macht das von selbst)', '', ('Diese Hilfe startet nichts und l' + [char]0x00E4 + 'dt nichts herunter.')) -join [char]10) }
    'de:host_setup.timezone_explain' { return ('Der Kapit' + [char]0x00E4 + 'n verwendet sie, um die Zeiten in Telegram-Nachrichten und Diagrammen umzurechnen.') }
    'de:host_setup.timezone_header' { return 'Zeitzone' }
    'de:host_setup.timezone_label' { return 'Zeitzone' }
    'de:host_setup.timezone_vps_utc' { return 'Die Zeitzone wurde nicht erkannt: Das Team verwendet UTC. Stelle deine mit jht wh --tz Europe/Berlin ein (oder im Dashboard), sonst stehen die Telegram-Zeiten und die Arbeitszeiten in UTC.' }
    'de:host_setup.tz.bad_number' { return ('W' + [char]0x00E4 + 'hle eine Zahl zwischen 1 und %d.') }
    'de:host_setup.tz.how' { return 'Gib ein Land, eine Stadt oder eine Zeitzone ein (zum Beispiel Deutschland, Berlin, Europe/Berlin).' }
    'de:host_setup.tz.how_default' { return ('Dr' + [char]0x00FC + 'cke Enter, um %s zu behalten, oder gib ein Land, eine Stadt oder eine Zeitzone ein, um eine andere zu suchen.') }
    'de:host_setup.tz.none' { return ('Keine Zeitzone f' + [char]0x00FC + 'r ' + [char]0x00AB + '%s' + [char]0x00BB + ': Gib das Land ein (zum Beispiel Deutschland) oder eine gro' + [char]0x00DF + 'e Stadt in der N' + [char]0x00E4 + 'he.') }
    'de:host_setup.tz.not_detected' { return 'Deine Zeitzone wurde nicht erkannt.' }
    'de:host_setup.tz.pick' { return 'Nummer (1-%d) oder eine neue Suche:' }
    'de:host_setup.tz.proposed' { return 'Vorgeschlagen: %s (jetzt %s).' }
    'de:host_setup.tz.saved_and_detected' { return ('Gespeichert: %s (jetzt %s) ' + [char]0x00B7 + ' Jetzt erkannt: %s (jetzt %s)') }
    'de:host_setup.tz.too_many' { return ('%d Zeitzonen passen zu ' + [char]0x00AB + '%s' + [char]0x00BB + ': Gib etwas Genaueres ein (zum Beispiel eine Stadt).') }
    'de:keyfile.both' { return 'Nutze --api-key-file oder --api-key-stdin, nicht beides' }
    'de:keyfile.not_file' { return ('Die an --api-key-file ' + [char]0x00FC + 'bergebene Datei muss eine normale Datei sein, kein Ordner und kein Link: %s') }
    'de:keyfile.shape' { return ('Der Inhalt der an --api-key-file ' + [char]0x00FC + 'bergebenen Datei ist keine einzelne Zeile mit 16 bis 512 druckbaren Zeichen ohne Leerzeichen: %s') }
    'de:keyfile.size' { return ('Die an --api-key-file ' + [char]0x00FC + 'bergebene Datei ist leer oder zu gro' + [char]0x00DF + ' f' + [char]0x00FC + 'r einen Schl' + [char]0x00FC + 'ssel (1 bis 4096 Bytes): %s') }
    'de:keyfile.twice' { return '--api-key-file wurde zweimal angegeben' }
    'de:keyfile.unreadable' { return ('Die an --api-key-file ' + [char]0x00FC + 'bergebene Datei l' + [char]0x00E4 + 'sst sich nicht lesen: %s') }
    'de:line.abbinamento_annullato_nessuna_modifica' { return ('Kopplung abgebrochen: keine ' + [char]0x00C4 + 'nderung.') }
    'de:line.abbinamento_di_s_non_riuscito' { return 'Kopplung von %s fehlgeschlagen: Die alten Kopien bleiben alle. Starte jht telegram pair --all erneut: Bereits gekoppelte Rollen fragen nicht nach einem weiteren Token.' }
    'de:line.abbinamento_rifiutato_genera_un_token' { return 'Kopplung abgelehnt: Erzeuge einen neuen Token in BotFather (/revoke) und versuch es erneut.' }
    'de:line.agent_restart_failed.inventario_conservato_ma_il_team' { return 'Inventur gesichert, aber das Team ist nicht neu gestartet. Was tun: jht up' }
    'de:line.annullato_niente_autorizzato' { return 'Abgebrochen: nichts autorisiert.' }
    'de:line.anteprima_non_valida_niente_autorizzato' { return ('Vorschau ung' + [char]0x00FC + 'ltig: nichts autorisiert.') }
    'de:line.apply.authorize' { return 'Autorisierst du diese Bewerbung?' }
    'de:line.apply_relink_account_cloud_account' { return ('apply relink-account: Cloud-Konto nicht verf' + [char]0x00FC + 'gbar. F' + [char]0x00FC + 'hre zuerst jht cloud pair aus.') }
    'de:line.autorizzata_s_verso_s_il' { return ('#%s autorisiert, an %s: Der CLOSER nimmt sie in der n' + [char]0x00E4 + 'chsten Runde.') }
    'de:line.bot_abbinato_e_copia_legacy' { return ('Bot gekoppelt und alte Kopie entfernt. Es bleiben andere alte Tokens oder ein Token in der Umgebung des Containers: Entferne sie und schlie' + [char]0x00DF + ' die Rotation vor dem Cutover ab.') }
    'de:line.bot_token_invalid.controlla_il_token_generato_da' { return ('Pr' + [char]0x00FC + 'fe den von BotFather erzeugten Token.') }
    'de:line.broker_restart_failed.il_servizio_della_posta_non_4' { return 'Der Mail-Dienst ist nicht neu gestartet. Was tun: jht mail status' }
    'de:line.broker_start_failed.il_servizio_della_posta_non_2' { return 'Der Mail-Dienst ist nicht gestartet.' }
    'de:line.broker_start_failed.il_servizio_della_posta_non_3' { return 'Der Mail-Dienst antwortet nach 30 Sekunden nicht.' }
    'de:line.broker_unavailable.il_broker_dei_segreti_esiste' { return ('Der Secrets-Broker existiert, l' + [char]0x00E4 + 'sst sich aber nicht als unserer best' + [char]0x00E4 + 'tigen: Ich fasse ihn nicht an.') }
    'de:line.broker_unavailable.il_runtime_installato_pi_vecchio_2' { return ('Die installierte Runtime ist ' + [char]0x00E4 + 'lter und hat keinen Secrets-Broker.') }
    'de:line.broker_unavailable.il_servizio_della_posta_non' { return 'Der Mail-Dienst existiert noch nicht: Er wird beim ersten Bedarf erstellt.' }
    'de:line.cancellato_marcatore_migrazione_broker_s' { return ('Gel' + [char]0x00F6 + 'scht: Migrationsmarker des Brokers %s') }
    'de:line.cancellato_volume_broker_s_s' { return ('Gel' + [char]0x00F6 + 'scht: Broker-Volume %s (%s)') }
    'de:line.container_s_non_e_partito' { return ('Container ''%s'' ist nicht innerhalb von 10s gestartet. Pr' + [char]0x00FC + 'fe ''jht logs''.') }
    'de:line.cosa_fare_jht_mail_setup' { return 'Was tun: jht mail setup' }
    'de:line.cosa_fare_jht_up_3' { return 'Was tun: jht up' }
    'de:line.cosa_fare_jht_upgrade_4' { return 'Was tun: jht upgrade' }
    'de:line.cosa_fare_riprova_il_comando_2' { return 'Was tun: Versuch den Befehl erneut' }
    'de:line.fino_ad_allora_la_posta' { return 'Bis dahin wird die Mail mit dem heutigen Passwort gelesen und gesendet; der Hinweis bleibt in jht mail status.' }
    'de:line.genera_una_nuova_password_per' { return 'Erzeuge ein neues App-Passwort bei deinem Anbieter und speichere es mit: jht mail setup' }
    'de:line.i_segreti_e_lo_stato' { return ('Die Geheimnisse und der Zustand des Brokers wurden gel' + [char]0x00F6 + 'scht: Melde dich erneut bei den Portalen an und richte die Mail neu ein.') }
    'de:line.il_broker_non_ha_registrato' { return ('Der Broker hat die Autorisierung nicht registriert: zur' + [char]0x00FC + 'ckgezogen, nichts wird gesendet.') }
    'de:line.integration.install_hint' { return 'zum Installieren: ''jht upgrade'' (oder ein ''jht integration add <id>'')' }
    'de:line.interattivo_il_token_viene_chiesto' { return ('Interaktiv: Der Token wird ohne Echo abgefragt, dann bekommt der neue Bot einen Einmalcode von deinem Telegram. Automatisierungen: {"bot_token": ...} als JSON auf stdin; speichere den Token nicht in ~/.jht und l' + [char]0x00F6 + 'sche jede au' + [char]0x00DF + 'erhalb davon verwendete Datei sofort.') }
    'de:line.jht_telegram_pair_all_interattivo' { return ('jht telegram pair --all ist interaktiv: F' + [char]0x00FC + 'r Automatisierungen kopple eine Rolle nach der anderen.') }
    'de:line.job_hunter_team_non_installato' { return ('Job Hunter Team ist nicht vollst' + [char]0x00E4 + 'ndig installiert: Im Runtime-Ordner fehlt die Integrit' + [char]0x00E4 + 'tsdatei (eine abgebrochene Installation?). Starte den Installer erneut.') }
    'de:line.la_casella_di_posta_ora' { return ('Das Postfach liegt jetzt im Secrets-Broker. Sein Passwort war f' + [char]0x00FC + 'r die Agenten lesbar:') }
    'de:line.legacy_cleanup_failed.i_token_nuovi_sono_al' { return 'Die neuen Tokens sind sicher, aber die alte Kopie von %s ist noch in ~/.jht; Cutover verweigert.' }
    'de:line.legacy_inventory_failed.il_team_resta_fermo_perch_4' { return 'Das Team bleibt gestoppt, weil die Telegram-Inventur des Hosts nicht gesichert wurde.' }
    'de:line.legacy_inventory_failed.le_impronte_non_sono_state' { return ('Die Fingerabdr' + [char]0x00FC + 'cke wurden vom isolierten Dienst nicht gesichert.') }
    'de:line.legacy_inventory_failed.migrazione_telegram_interrotta' { return 'Telegram-Migration abgebrochen.' }
    'de:line.legacy_inventory_failed.non_posso_provare_che_jht' { return 'Ich kann nicht beweisen, dass ~/.jht frei von Telegram-Tokens ist.' }
    'de:line.legacy_inventory_failed.non_riesco_a_fermare_gli' { return 'Ich kann die Agenten vor der Host-Inventur nicht stoppen.' }
    'de:line.legacy_inventory_failed.non_riesco_a_leggere_i' { return 'Ich kann die alten Tokens in ~/.jht nicht lesen.' }
    'de:line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti' { return 'Alte Rollen nicht erkannt.' }
    'de:line.legacy_remove_failed.s_nel_broker_ma_la' { return '%s ist im Broker, aber die Kopie in ~/.jht/credentials ist geblieben.' }
    'de:line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso' { return '~/.jht/credentials/%s.json ist nach der Migration wieder aufgetaucht; ohne Import entfernt.' }
    'de:line.mail.address_prompt' { return 'Adresse des Postfachs:' }
    'de:line.mail.app_password_prompt' { return 'App-Passwort (wird nicht angezeigt):' }
    'de:line.mail.dedicated_prompt' { return ('Ist das ein EIGENES Postfach f' + [char]0x00FC + 'r weitergeleitete Jobbenachrichtigungen?') }
    'de:line.mail_setup_opzione_sconosciuta_s' { return 'mail setup: unbekannte Option %s' }
    'de:line.mail_setup_password_vuota' { return 'mail setup: leeres Passwort' }
    'de:line.nessun_provider_attivo_scegline_uno' { return ('Kein Anbieter aktiv: W' + [char]0x00E4 + 'hle einen mit ''jht providers use glm''') }
    'de:line.nessun_ruolo_ha_un_token' { return ('Keine Rolle hat einen alten Token: F' + [char]0x00FC + 'r einen neuen Bot nutze jht telegram pair <Rolle>.') }
    'de:line.non_autorizzabile_s' { return 'Nicht autorisierbar: %s.' }
    'de:line.non_autorizzata_s' { return 'Nicht autorisiert: %s.' }
    'de:line.os_and_version_are_required' { return '--os und --version sind erforderlich' }
    'de:line.podman_non_trovato_reinstalla_il' { return 'Podman nicht gefunden: Installiere die JHT-Runtime neu.' }
    'de:line.preparo_il_servizio_della_posta' { return ('Bereite den Mail-Dienst vor (er wird nur beim ersten Bedarf erstellt)' + [char]0x2026) }
    'de:line.provider_attivo_non_riconosciuto_s' { return 'Aktiver Anbieter nicht erkannt: %s' }
    'de:line.reset_impossibile_cancellare_il_marcatore' { return ('reset: Der Migrationsmarker des Brokers %s l' + [char]0x00E4 + 'sst sich nicht l' + [char]0x00F6 + 'schen.') }
    'de:line.reset_impossibile_cancellare_il_marcatore_2' { return ('reset: Der Marker des Brokers %s l' + [char]0x00E4 + 'sst sich nicht l' + [char]0x00F6 + 'schen.') }
    'de:line.reset_impossibile_cancellare_il_volume' { return ('reset: Das Broker-Volume %s (%s) l' + [char]0x00E4 + 'sst sich nicht l' + [char]0x00F6 + 'schen.') }
    'de:line.reset_nome_volume_non_valido' { return ('reset: Ung' + [char]0x00FC + 'ltiger Volume-Name f' + [char]0x00FC + 'r %s; Entfernen verweigert.') }
    'de:line.reset_non_riesco_a_determinare' { return 'reset: Ich kann das Compose-Projekt nicht bestimmen; die Volumes des Brokers wurden nicht angefasst.' }
    'de:line.reset_non_riesco_a_fermare' { return 'reset: Ich kann die Runtime nicht stoppen; die Volumes des Brokers wurden nicht angefasst.' }
    'de:line.reset_ricerca_del_volume_s_2' { return 'reset: Suche nach dem Volume %s fehlgeschlagen.' }
    'de:line.restano_token_legacy_per_s' { return ('Es bleiben alte Tokens f' + [char]0x00FC + 'r: %s. Solange du nicht auch diese Rollen koppelst, bleibt %s auf Telegram stumm: Kopple sie alle in dieser Sitzung (jht telegram pair --all).') }
    'de:line.risposta_del_container_non_valida' { return ('Ung' + [char]0x00FC + 'ltige Antwort des Containers: Autorisierung zur' + [char]0x00FC + 'ckgezogen, nichts wird gesendet.') }
    'de:line.ritirata_s_non_verra_inviata' { return ('#%s zur' + [char]0x00FC + 'ckgezogen: Sie wird nicht gesendet.') }
    'de:line.ritiro_non_riuscito_s' { return ('Zur' + [char]0x00FC + 'ckziehen fehlgeschlagen: %s.') }
    'de:line.runtime_migration_docker_missing.il_client_docker_originale_non' { return ('Der urspr' + [char]0x00FC + 'ngliche Docker-Client ist nicht verf' + [char]0x00FC + 'gbar.') }
    'de:line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata' { return ('Das per Digest fixierte JHT-Image ist n' + [char]0x00F6 + 'tig.') }
    'de:line.runtime_migration_podman_missing.podman_non_e_disponibile' { return ('Podman ist nicht verf' + [char]0x00FC + 'gbar.') }
    'de:line.runtime_migration_team_running.ferma_prima_il_team_docker' { return 'Stoppe zuerst das Docker-Team.' }
    'de:line.runtime_migration_team_running.ferma_prima_il_team_podman' { return 'Stoppe zuerst das Podman-Team.' }
    'de:line.runtime_o_container_jht_non' { return ('JHT-Runtime oder -Container nicht verf' + [char]0x00FC + 'gbar') }
    'de:line.ruoli_da_abbinare_in_questa' { return 'Zu koppelnde Rollen in dieser Sitzung: %s' }
    'de:line.s_ha_gi_un_bot' { return '%s hat schon einen gekoppelten Bot: Ich entferne nur seine alte Kopie.' }
    'de:line.s_needs_a_value' { return '%s braucht einen Wert' }
    'de:line.saltato_non_trovato_volume_broker' { return ('' + [char]0x00DC + 'bersprungen (nicht gefunden): Broker-Volume %s') }
    'de:line.serve_un_terminale_l_autorizzazione' { return ('Ein Terminal ist n' + [char]0x00F6 + 'tig: Die Autorisierung wird von Hand best' + [char]0x00E4 + 'tigt.') }
    'de:line.telegram_isolato_attivo_il_bridge' { return 'Isoliertes Telegram aktiv; die alte Bridge kann von den Agenten nicht mehr reaktiviert werden.' }
    'de:line.the_setup_keeps_the_key' { return ('Das Setup beh' + [char]0x00E4 + 'lt den Schl' + [char]0x00FC + 'ssel: Du kannst die Datei auf diesem Computer jetzt l' + [char]0x00F6 + 'schen (%s).') }
    'de:line.upgrade.done' { return 'Update abgeschlossen: %s (%s) -> %s (%s). %s' }
    'de:line.upgrade.restored' { return 'Vorherige Runtime wiederhergestellt.' }
    'de:line.uso_jht_apply_relink_account' { return 'Verwendung: jht apply relink-account' }
    'de:line.uso_jht_apply_request_cancel_2' { return 'Verwendung: jht apply request|cancel <id>' }
    'de:line.uso_jht_mail_setup_status' { return 'Verwendung: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <Adresse|@Domain>|drafts|approve <id>|discard <id>|journal|delete|migrate' }
    'de:line.uso_jht_migrate_runtime_podman' { return 'Verwendung: jht migrate-runtime podman' }
    'de:line.uso_jht_screen_on_off' { return 'Verwendung: jht screen on | off | status [--json]' }
    'de:line.uso_jht_telegram_chat_id' { return 'Verwendung: jht telegram chat-id <assistente|capitano|mentor>' }
    'de:line.uso_jht_telegram_pair_assistente' { return 'Verwendung: jht telegram pair <assistente|capitano|mentor>|--all' }
    'de:line.uso_jht_telegram_remove_assistente' { return 'Verwendung: jht telegram remove <assistente|capitano|mentor>' }
    'de:line.uso_jht_telegram_status_pair' { return 'Verwendung: jht telegram status|pair <Rolle>|pair --all|chat-id <Rolle>|remove <Rolle>' }
    'de:monitor.window_invalid' { return 'monitor_window_invalid: Nutze ''jht monitor --window'' ohne weitere Optionen.' }
    'de:ps.apply_auto_send_warning_1' { return ('  Bei eingeschaltetem automatischem Versand f' + [char]0x00FC + 'llt das Team die Bewerbung aus und SENDET sie,') }
    'de:ps.apply_auto_send_warning_2' { return ('  ohne weitere Best' + [char]0x00E4 + 'tigung. Einmal abgeschickt, l' + [char]0x00E4 + 'sst sie sich nicht zur' + [char]0x00FC + 'ckrufen.') }
    'de:ps.artifact_copied' { return '%s wurde nach %s kopiert, damit das Team es lesen kann.' }
    'de:ps.artifact_copy_failed' { return '%s kann nicht in den gemeinsamen Ordner kopiert werden: %s' }
    'de:ps.artifact_copy_refused' { return ('%s wird nicht kopiert: %s ist eine Verkn' + [char]0x00FC + 'pfung oder liegt nicht im gemeinsamen Ordner') }
    'de:ps.bot_token_prompt_hidden' { return 'Token des Bots %s (verdeckte Eingabe)' }
    'de:ps.botfather_fresh_token' { return 'Verwende immer ein frisch in BotFather erzeugtes Token (/revoke beim Bot, oder ein neuer Bot): Ein bereits vorhandenes Token kann von den Agenten gelesen worden sein, auch wenn es heute nicht mehr in ~/.jht auftaucht.' }
    'de:ps.broker_network_proxy_not_ready' { return 'broker_network_unavailable: Der Mail-Proxy ist nicht bereit (Code %s).' }
    'de:ps.broker_network_scripts_not_downloadable' { return 'broker_network_unavailable: Ich kann die Skripte des Mail-Proxys nicht herunterladen. Was tun: jht upgrade' }
    'de:ps.broker_network_scripts_not_verified' { return ('broker_network_unavailable: Die Skripte des Mail-Proxys lassen sich nicht best' + [char]0x00E4 + 'tigen. Was tun: jht upgrade') }
    'de:ps.broker_restart_failed_secrets_broker_not_ours' { return ('broker_restart_failed: Der Secrets-Broker l' + [char]0x00E4 + 'sst sich nicht als unserer best' + [char]0x00E4 + 'tigen: Ich r' + [char]0x00FC + 'hre ihn nicht an. Was tun: jht mail status') }
    'de:ps.broker_unavailable_secrets_broker_not_running' { return 'broker_unavailable: Der Secrets-Broker ist nicht aktiv.' }
    'de:ps.cli_version_needs_container' { return ('F' + [char]0x00FC + 'r die Version der laufenden CLI muss der Container laufen: ''jht up''.') }
    'de:ps.compose_up_failed_team_not_started' { return ('compose_up_failed: Das Team ist nicht gestartet (docker compose up, Code %s). Pr' + [char]0x00FC + 'fe ''jht logs''.') }
    'de:ps.container_not_running' { return 'Container ''%s'' nicht aktiv' }
    'de:ps.container_runtime_unsupported' { return ('nicht unterst' + [char]0x00FC + 'tzte Container-Runtime: %s') }
    'de:ps.docker_desktop_file_sharing_hint' { return ('  Was tun: ' + [char]0x00D6 + 'ffne Docker Desktop > Settings > Resources > File sharing, pr' + [char]0x00FC + 'fe, ob der Ordner des Benutzers freigegeben ist, und f' + [char]0x00FC + 'hre dann ''jht up'' erneut aus.') }
    'de:ps.docker_podman_verified_future_removal' { return ('Migration Docker -> Podman gepr' + [char]0x00FC + 'ft. Die Docker-Volumes bleiben unver' + [char]0x00E4 + 'ndert und enthalten noch die Mail-Passw' + [char]0x00F6 + 'rter, die Portal-Zug' + [char]0x00E4 + 'nge und die Telegram-Tokens: Zum Entfernen ist k' + [char]0x00FC + 'nftig eine ausdr' + [char]0x00FC + 'ckliche Best' + [char]0x00E4 + 'tigung n' + [char]0x00F6 + 'tig.') }
    'de:ps.doctor.wsl_memory' { return 'WSL hat kein Speicherlimit (andere WSL-Distributionen sind registriert): trage in %s unter [wsl2] memory=%s ein' }
    'de:ps.download_asset_failed_detail' { return 'Download fehlgeschlagen: %s (%s)' }
    'de:ps.download_shared_folder_no_path' { return ('Das Ziel liegt in einem Ordner, den du mit dem Team teilst: W' + [char]0x00E4 + 'hle einen au' + [char]0x00DF + 'erhalb, z. B. Downloads.') }
    'de:ps.download_sums_failed_detail' { return 'Download fehlgeschlagen: SHA256SUMS von v%s (%s)' }
    'de:ps.full_pull_failed_keep_old' { return ('full_pull_failed: Das neue vollst' + [char]0x00E4 + 'ndige Image ist nicht angekommen, das alte bleibt. Was tun: jht tools pull') }
    'de:ps.help.main' { return (('jht - Job Hunter Team', '', '  Host-Befehle (funktionieren von hier aus):', '    jht up                 startet den Container des Teams', '    jht down               stoppt ihn', '                           (mit --verbose siehst du auch die Zeilen der Engine)', '    jht restart            startet ihn neu', '    jht status             Zustand von Container und Team', '    jht logs [-f]          Logs des Containers', '    jht upgrade            aktualisiert auf das neueste Image', ('    jht setup              gef' + [char]0x00FC + 'hrte Installation'), '    jht shell              Shell im Container', '    jht mail setup         speichert das Postfach im Secrets-Broker', '    jht mail drafts        von den Agenten geschriebene Mails, die auf dein Okay warten', '    jht mail approve <id>  sendet sie; jht mail discard <id> verwirft sie', '    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]', '                           die Integrationen, die nach dem Setup dazukommen', '                           (google, telegram, mail): Zustand von der Engine gelesen', '    jht telegram status    Zustand des isolierten Telegram-Dienstes', '    jht telegram pair ROLE fragt den Token ohne Echo auf dem Host-Computer ab, dann', '                           zeigt es einen Code, den du dem Bot von deinem Telegram schickst', ('                           F' + [char]0x00FC + 'r Automatisierungen: JSON auf stdin. Speichere den Token nicht'), ('                           in ~/.jht; l' + [char]0x00F6 + 'sche au' + [char]0x00DF + 'erhalb davon verwendete Dateien sofort.'), '    jht telegram pair --all koppelt alle alten Rollen in einer Sitzung', '    jht telegram chat-id ROLE verlegt den Bot in einen anderen Chat, mit demselben Code', ('    jht reset              l' + [char]0x00F6 + 'scht Konfiguration und Volumes des Brokers'), '    jht migrate-runtime podman', ('                           kopiert und pr' + [char]0x00FC + 'ft die Docker-Volumes in Podman;'), ('                           w' + [char]0x00E4 + 'hlt die neue Runtime nicht und l' + [char]0x00F6 + 'scht Docker nicht'), ('    jht uninstall --confirm entfernt die lokale Windows-Runtime, beh' + [char]0x00E4 + 'lt aber Daten,'), '                           Dokumente, Podman und Compose', '', '  Alle anderen Befehle (positions, stats, team, providers, cron,', ('  working-hours, cloud...) laufen IM Container: F' + [char]0x00FC + 'r ihre Hilfe'), '  muss der Container laufen.', '', '      jht up ; jht --help') -join [char]10) }
    'de:ps.home_unavailable_bind_mount' { return ('HOME/USERPROFILE nicht verf' + [char]0x00FC + 'gbar: JHT-Bind-Mount abgelehnt') }
    'de:ps.host_download_failed' { return 'Download auf dem Host fehlgeschlagen: %s' }
    'de:ps.input_not_json_bot_token_stdin' { return ('input_not_json: ' + [char]0x00DC + 'bergib bot_token als JSON ' + [char]0x00FC + 'ber stdin.') }
    'de:ps.integration_not_installed' { return 'nicht installiert' }
    'de:ps.integration_not_installed_yet' { return 'noch nicht installiert' }
    'de:ps.jht_container_not_verifiable' { return ('Der JHT-Container l' + [char]0x00E4 + 'sst sich nicht best' + [char]0x00E4 + 'tigen.') }
    'de:ps.jht_home_missing' { return ('Job Hunter Team ist noch nicht installiert: Der Ordner %s existiert nicht. F' + [char]0x00FC + 'hre den Installer aus, dann ''jht setup''.') }
    'de:ps.legacy_cleanup_failed_old_token_still_there' { return 'legacy_cleanup_failed: Der alte Token ist noch in ~/.jht; Cutover verweigert.' }
    'de:ps.legacy_migration_failed_stays' { return 'legacy_migration_failed: %s bleibt in ~/.jht/credentials.' }
    'de:ps.lifecycle.restarted' { return 'Job Hunter Team neu gestartet.' }
    'de:ps.link_or_not_folder' { return ('Verkn' + [char]0x00FC + 'pfung oder kein Ordner') }
    'de:ps.localappdata_unavailable' { return ('LOCALAPPDATA nicht verf' + [char]0x00FC + 'gbar: Host-Runtime abgelehnt') }
    'de:ps.machine_space_back_on_stop' { return ('Etwa %s GB, die in der JHT-Maschine frei wurden, kommen zu Windows zur' + [char]0x00FC + 'ck, wenn die Maschine anh' + [char]0x00E4 + 'lt: nach jht down mit podman machine stop %s oder beim Neustart des Computers.') }
    'de:ps.machine_space_not_returned' { return ('JHT belegt etwa %s GB in seinem virtuellen Datentr' + [char]0x00E4 + 'ger; sie werden mit jht uninstall vollst' + [char]0x00E4 + 'ndig freigegeben.') }
    'de:ps.machine_state_unreadable' { return ('der Zustand der Maschine l' + [char]0x00E4 + 'sst sich nicht lesen (podman und wsl antworten nicht)') }
    'de:ps.monitor_window_unavailable' { return ('monitor_window_unavailable: Hier l' + [char]0x00E4 + 'sst sich kein Terminalfenster ' + [char]0x00F6 + 'ffnen. F' + [char]0x00FC + 'hre ''jht monitor'' im aktuellen Terminal aus.') }
    'de:ps.mount_repair_failed_folders_not_writable' { return ('mount_repair_failed: Die Ordner von Job Hunter Team (%s, %s) sind f' + [char]0x00FC + 'r den Container nicht beschreibbar und lie' + [char]0x00DF + 'en sich nicht reparieren.') }
    'de:ps.old_images_busy' { return ' Von einem Container verwendet (behalten): %s.' }
    'de:ps.old_images_kept_all' { return 'Alte JHT-Images: alle behalten (JHT_KEEP_OLD_IMAGES=1).' }
    'de:ps.old_images_refused' { return ' Von der Engine abgelehnt (behalten): %s.' }
    'de:ps.old_images_removed' { return ('Alte JHT-Images: %s entfernt, etwa %s MB freigegeben (Nenngr' + [char]0x00F6 + [char]0x00DF + 'e: geteilte Layer werden nur teilweise freigegeben), behalten: aktuelles und vorheriges.') }
    'de:ps.pair_role_now_prompt' { return '%s jetzt koppeln? [s/N]' }
    'de:ps.podman_exe_not_found' { return 'podman.exe nicht gefunden' }
    'de:ps.podman_machine_not_responding' { return ('Die JHT-Podman-Maschine antwortet nicht. F' + [char]0x00FC + 'hre ''jht up'' aus.') }
    'de:ps.release_arrived_without_https' { return 'Das Release kam ohne HTTPS an: %s' }
    'de:ps.relink_account_container_not_running' { return ('apply relink-account: Container l' + [char]0x00E4 + 'uft nicht.') }
    'de:ps.script_integration_not_installed' { return 'Skript jht-integration.ps1 noch nicht installiert: ''jht upgrade'' (oder ein ''jht integration add/remove'') und versuch es erneut' }
    'de:ps.script_tools_not_installed' { return 'Skript jht-tools.ps1 noch nicht installiert: ''jht upgrade'' und versuch es erneut' }
    'de:ps.startup_task_still_registered' { return 'die Aufgabe ist weiterhin registriert' }
    'de:ps.team_container_unavailable' { return 'team_container_unavailable: Starte das Team mit jht up und versuch es erneut.' }
    'de:ps.telegram_not_configured' { return 'Telegram nicht aktiv: Telegram ist nicht eingerichtet.' }
    'de:ps.telegram_status_unverifiable' { return ('Telegram: Status derzeit nicht pr' + [char]0x00FC + 'fbar (Dienst gestoppt oder nicht erreichbar). Details: jht telegram status') }
    'de:ps.telegram_unavailable_isolated_not_running' { return 'telegram_unavailable: Der isolierte Telegram-Dienst ist nicht aktiv.' }
    'de:ps.telegram_unavailable_run_jht_up' { return ('telegram_unavailable: F' + [char]0x00FC + 'hre jht up aus') }
    'de:ps.uninstall.bad.target' { return ('Verweigert: {0} ist ein Link oder kein Ordner: Ich folge dem Eintrag nicht und l' + [char]0x00F6 + 'sche ihn nicht.') }
    'de:ps.uninstall.done' { return ('Fertig: Die Maschine <machine> (und mit ihr die Images von JHT, das Core-Image und das vollst' + [char]0x00E4 + 'ndige), die Runtime und der Befehl jht sind entfernt.') }
    'de:ps.uninstall.done.kept' { return (' ~/.jht und Documents\Job Hunter Team bleiben (mit --purge werden sie gel' + [char]0x00F6 + 'scht).') }
    'de:ps.uninstall.done.wsl' { return ('WSL bleibt im Speicher: vmmem, wslservice und wslrelay sind Komponenten von Windows (Job Hunter Team hat sie nicht installiert) und werden auch von den anderen WSL-Maschinen dieses Benutzers gebraucht; normalerweise beenden sie sich nach einer Weile Inaktivit' + [char]0x00E4 + 't von selbst. Um sie sofort zu stoppen: wsl --shutdown (das stoppt ALLE ge' + [char]0x00F6 + 'ffneten WSL-Maschinen).') }
    'de:ps.uninstall.kept.machine' { return 'Die Podman-Maschine {0} ist nicht als vom Installer erstellt vermerkt: Sie bleibt, wo sie ist. Von Hand, falls sie deine ist und weg soll: podman machine stop {0}; podman machine rm {0}.' }
    'de:ps.uninstall.left.commands' { return ('Nicht entfernt: der Befehl jht oder die Dateien des Installers in {0} ({1}) oder die vom Installer hinzugef' + [char]0x00FC + 'gten Variablen und PATH-Zeilen. Von Hand: Remove-Item f' + [char]0x00FC + 'r die Datei; die Variablen JHT_CONTAINER_RUNTIME und JHT_PODMAN_MACHINE und der Ordner {0} im PATH unter Einstellungen > Umgebungsvariablen.') }
    'de:ps.uninstall.left.data' { return ('Die JHT-Daten wurden nicht gel' + [char]0x00F6 + 'scht ({0}). Von Hand: Remove-Item -Recurse -Force {1}. Der Befehl jht und die Runtime sind noch da: F' + [char]0x00FC + 'hre jht uninstall --confirm --purge erneut aus, sobald das gekl' + [char]0x00E4 + 'rt ist.') }
    'de:ps.uninstall.left.machine' { return ('Nicht entfernt: die Podman-Maschine <machine>. Grund: {0}. Von Hand: podman machine stop <machine>; wsl --unregister {1}; f' + [char]0x00FC + 'hre danach jht uninstall --confirm erneut aus.') }
    'de:ps.uninstall.left.runtime' { return 'Nicht entfernt: die JHT-Runtime in {0}. Von Hand: Remove-Item -Recurse -Force ''{0}''.' }
    'de:ps.uninstall.left.task' { return 'Nicht entfernt: die Startaufgabe bei der Anmeldung ''{0}'' (Grund: {1}). Alles andere wurde entfernt. Von Hand: schtasks /Delete /TN "{0}" /F.' }
    'de:ps.uninstall.phase.commands' { return 'Entferne den Befehl jht, die Dateien des Installers und die PATH-Zeilen...' }
    'de:ps.uninstall.phase.data' { return ('L' + [char]0x00F6 + 'sche ~/.jht und Documents\Job Hunter Team (--purge)...') }
    'de:ps.uninstall.phase.machine' { return 'Entferne die Podman-Maschine <machine> (mit den Geheimnissen und Images von JHT)...' }
    'de:ps.uninstall.phase.runtime' { return 'Entferne die JHT-Runtime...' }
    'de:ps.uninstall.purge_notice' { return ('Mit --purge werden auch ~/.jht und Documents\Job Hunter Team gel' + [char]0x00F6 + 'scht: Konfiguration, Datenbank, Lebensl' + [char]0x00E4 + 'ufe und Ergebnisse. Das l' + [char]0x00E4 + 'sst sich nicht r' + [char]0x00FC + 'ckg' + [char]0x00E4 + 'ngig machen.') }
    'de:ps.uninstall.purge_removal_notice' { return ('Das gespeicherte Mail-Passwort und die Telegram-Tokens werden ebenfalls gel' + [char]0x00F6 + 'scht.') }
    'de:ps.uninstall.removal_notice' { return ('Das gespeicherte Mail-Passwort und die Telegram-Tokens werden ebenfalls gel' + [char]0x00F6 + 'scht; ~/.jht und Documents bleiben, und mit ihnen die gespeicherte LinkedIn-Sitzung (secrets/linkedin-profile und .cache/linkedin): Entferne sie mit jht reset --scope creds.') }
    'de:ps.uninstall.secrets' { return 'Die gespeicherten Geheimnisse wurden nicht entfernt: Das Mail-Passwort und die Telegram-Tokens liegen in den Volumes jht-secrets und jht-telegram-secrets der Maschine <machine>, die noch da ist.' }
    'de:ps.uninstall.wslconfig.done' { return ('Aus {0} wurden die vom Installer hinzugef' + [char]0x00FC + 'gten Zeilen entfernt (WSL-Speicher).') }
    'de:ps.uninstall.wslconfig.kept' { return ('In {0} wurden die Zeilen belassen, die du ge' + [char]0x00E4 + 'ndert hast: Sie sind deine.') }
    'de:ps.uninstall.wslconfig.left' { return ('Nicht angefasst: {0} ({1}). Die vom Installer hinzugef' + [char]0x00FC + 'gten Zeilen (WSL-Speicher) bleiben. Entferne sie von Hand: ' + [char]0x00DC + 'ber jeder steht eine Kommentarzeile.') }
    'de:ps.unknown_argument' { return 'Unbekanntes Argument: %s' }
    'de:ps.upgrade_already_running' { return ('Ein Update l' + [char]0x00E4 + 'uft bereits') }
    'de:ps.upgrade_broker_restart_failed' { return 'broker_restart_failed: Der Secrets-Broker ist nicht neu gestartet. Was tun: jht up' }
    'de:ps.upgrade_disk_low' { return ('disk_low: Die Agenten brauchen mindestens %s GiB Speicherplatz ' + [char]0x2014 + ' verf' + [char]0x00FC + 'gbar: %s GiB. Um Platz freizugeben, leere den Papierkorb und l' + [char]0x00F6 + 'sche gro' + [char]0x00DF + 'e Dateien, die du nicht brauchst, sowie nicht genutzte Docker-Images, dann versuch es erneut: Es wurde nichts heruntergeladen oder ge' + [char]0x00E4 + 'ndert.') }
    'de:ps.upgrade_docker_unavailable' { return ('Docker oder Host-Runtime nicht verf' + [char]0x00FC + 'gbar') }
    'de:ps.upgrade_helper_install_failed' { return 'helper_install_failed: Die neuen Host-Skripte werden bei der ersten Anforderung oder mit einem weiteren ''jht upgrade'' geholt' }
    'de:ps.upgrade_host_runtime_not_installable' { return ('Gesch' + [char]0x00FC + 'tzte Host-Runtime nicht installierbar') }
    'de:ps.upgrade_host_runtime_untrusted' { return ('Host-Runtime nicht vertrauensw' + [char]0x00FC + 'rdig') }
    'de:ps.upgrade_image_download_failed' { return 'Image-Download fehlgeschlagen' }
    'de:ps.upgrade_journal_not_updated' { return 'Journal konnte nicht aktualisiert werden' }
    'de:ps.upgrade_metadata_not_persisted' { return 'Runtime-Metadaten nicht gespeichert' }
    'de:ps.upgrade_mounts_not_writable' { return 'Job-Hunter-Team-Ordner sind aus dem Container nicht beschreibbar (mount_repair_failed)' }
    'de:ps.upgrade_not_completed' { return 'Update nicht abgeschlossen (%s): %s' }
    'de:ps.upgrade_note_activate_runtime' { return 'Aktiviere die neue Runtime...' }
    'de:ps.upgrade_note_download_image' { return 'Lade das neueste Image herunter...' }
    'de:ps.upgrade_note_download_runtime' { return 'Lade die aktualisierte Runtime herunter...' }
    'de:ps.upgrade_option_unsupported' { return ('Nicht unterst' + [char]0x00FC + 'tzte Upgrade-Option') }
    'de:ps.upgrade_pulling_full_image' { return ('Lade das aktualisierte vollst' + [char]0x00E4 + 'ndige Image herunter...') }
    'de:ps.upgrade_recovery_failed' { return 'Wiederherstellung des vorherigen Upgrades fehlgeschlagen' }
    'de:ps.upgrade_release_core_invalid' { return ('Das Release enth' + [char]0x00E4 + 'lt keinen g' + [char]0x00FC + 'ltigen Kern f' + [char]0x00FC + 'r diese Installation: Installiere neu') }
    'de:ps.upgrade_remote_compose_invalid' { return ('Remote-Compose ung' + [char]0x00FC + 'ltig') }
    'de:ps.upgrade_remote_runtime_invalid' { return ('Remote-Runtime ung' + [char]0x00FC + 'ltig oder nicht erreichbar') }
    'de:ps.upgrade_rollback_not_prepared' { return 'Rollback konnte nicht vorbereitet werden' }
    'de:ps.upgrade_telegram_restart_failed' { return 'telegram_restart_failed: Der isolierte Telegram-Dienst ist nicht neu gestartet. Was tun: jht up' }
    'de:ps.upgrade_test_channel' { return 'Testkanal: Das Update erfolgt durch Neuinstallation aus dem Test-Build' }
    'de:ps.upgrade_unexpected_error' { return 'Unerwarteter Fehler beim Update' }
    'de:ps.upgrade_verify_failed' { return ('Die neue Runtime hat die Pr' + [char]0x00FC + 'fung nicht bestanden') }
    'de:ps.use_fresh_botfather_token' { return 'Verwende immer einen frisch in BotFather erzeugten Token (/revoke auf dem Bot oder ein neuer Bot): Ein bereits vorhandener Token kann von den Agenten gelesen worden sein, auch wenn er heute nicht in ~/.jht auftaucht.' }
    'de:ps.user_dir_unavailable_cannot_create' { return 'user_dir_unavailable: Ich kann den Ordner %s, den das Team verwendet, nicht anlegen.' }
    'de:ps.wsl_exe_not_found' { return 'wsl.exe nicht gefunden' }
    'de:ps.wsl_not_answering' { return 'WSL antwortet nicht (wsl --status)' }
    'de:removed.office' { return ('''jht %s'' wurde in 0.4.0 zusammen mit dem Godot-B' + [char]0x00FC + 'ro entfernt: Nutze die jht-Befehle (jht help).') }
    'de:status.no_options' { return ('''jht status'' nimmt keine Optionen (%s): F' + [char]0x00FC + 'hre es als ''jht status'' aus.') }
    'de:status.not_running' { return ('Der Container des Teams l' + [char]0x00E4 + 'uft nicht.') }
    'de:status.not_running_next' { return 'Starte ihn mit: jht up' }
    'de:team.stopped' { return 'Job Hunter Team ist gestoppt: ''jht up'' startet es wieder.' }
    'de:tools.arriving' { return ('Die Werkzeuge der Scouts sind unterwegs: Das vollst' + [char]0x00E4 + 'ndige Image wird im Hintergrund heruntergeladen (etwa 3 GB). Die Stellensuche startet von selbst, sobald sie da sind; du musst nichts tun.') }
    'de:tools.chat_reconnecting' { return ('Das Team wechselt auf die vollst' + [char]0x00E4 + 'ndigen Werkzeuge der Scouts, deshalb h' + [char]0x00E4 + 'lt der Chat kurz an: Er kommt von selbst zur' + [char]0x00FC + 'ck, sobald das Team wieder l' + [char]0x00E4 + 'uft (ein paar Minuten).') }
    'de:tools.chat_resumed' { return ('Das Team nutzt jetzt die vollst' + [char]0x00E4 + 'ndigen Werkzeuge: Machen wir weiter.') }
    'de:tools.chat_switched' { return ('Das Team wechselt auf die vollst' + [char]0x00E4 + 'ndigen Werkzeuge der Scouts, deshalb wurde dieser Chat geschlossen. ' + [char]0x00D6 + 'ffne ihn in ein paar Minuten wieder mit jht team chat.') }
    'de:tools.chat_update_closed' { return ('JHT wird gerade aktualisiert, deshalb wurde dieser Chat geschlossen. ' + [char]0x00D6 + 'ffne ihn in ein paar Minuten wieder mit jht team chat.') }
    'de:tools.chat_update_resumed' { return 'JHT ist aktualisiert: Machen wir weiter.' }
    'de:tools.chat_updating' { return ('JHT wird gerade aktualisiert, deshalb h' + [char]0x00E4 + 'lt der Chat kurz an: Er startet in ein bis zwei Minuten von selbst neu.') }
    'de:tools.disk_low' { return ('Die Werkzeuge der Scouts wurden nicht heruntergeladen: Sie brauchen etwa %s GiB freien Speicherplatz, verf' + [char]0x00FC + 'gbar sind %s GiB, daher kann das Team noch keine Stellen suchen. Gib Platz frei (leere den Papierkorb, l' + [char]0x00F6 + 'sche gro' + [char]0x00DF + 'e Dateien, die du nicht brauchst), dann f' + [char]0x00FC + 'hre jht up aus: Der Download startet von selbst neu.') }
    'de:tools.engine_down' { return ('Der Stand der Werkzeuge der Scouts l' + [char]0x00E4 + 'sst sich nicht lesen: Die Container-Engine antwortet nicht. Starte sie mit jht up.') }
    'de:tools.failed' { return ('Der Download der Werkzeuge der Scouts ist fehlgeschlagen, daher kann das Team noch keine Stellen suchen. F' + [char]0x00FC + 'hre jht tools pull aus, um es erneut zu versuchen (jht up versucht es auch).') }
    'de:tools.ready' { return ('Die Werkzeuge der Scouts sind da: Das Team sucht mit dem vollst' + [char]0x00E4 + 'ndigen Image.') }
    'de:tools.switch_failed' { return ('Die Werkzeuge der Scouts sind da, aber das Team konnte damit nicht neu gestartet werden: F' + [char]0x00FC + 'hre jht down und dann jht up aus.') }
    'de:tools.switch_wait' { return ('Das Team wechselt gerade auf die vollst' + [char]0x00E4 + 'ndigen Werkzeuge der Scouts: Ich warte, bis es wieder l' + [char]0x00E4 + 'uft (h' + [char]0x00F6 + 'chstens ein paar Minuten).') }
    'de:tools.waiting' { return 'Die Werkzeuge der Scouts sind da: Das Team wechselt von selbst darauf, sobald das Onboarding abgeschlossen ist.' }
    'de:uninstall.usage' { return 'Verwendung: jht uninstall --confirm [--purge]' }
    'de:up.done' { return 'Job Hunter Team gestartet.' }
    'fr:container.starting' { return ('Le conteneur ''%s'' n''est pas actif, je le d' + [char]0x00E9 + 'marre...') }
    'fr:doctor.host_config_none' { return 'pas encore de configuration : ''jht setup''' }
    'fr:doctor.host_config_ok' { return ('configuration pr' + [char]0x00E9 + 'sente') }
    'fr:doctor.host_engine_fail' { return 'moteur de conteneurs injoignable' }
    'fr:doctor.host_engine_ok' { return 'moteur de conteneurs joignable' }
    'fr:doctor.host_more' { return ('Pour les v' + [char]0x00E9 + 'rifications compl' + [char]0x00E8 + 'tes (configuration, fournisseur, base de donn' + [char]0x00E9 + 'es, agents) : ''jht up'', puis ''jht doctor''.') }
    'fr:doctor.host_runtime_fail' { return ('runtime JHT manquant ou modifi' + [char]0x00E9 + ' : ''jht upgrade'' le r' + [char]0x00E9 + 'installe') }
    'fr:doctor.host_runtime_ok' { return 'runtime JHT intact' }
    'fr:doctor.host_team_off' { return ('' + [char]0x00E9 + 'quipe ' + [char]0x00E9 + 'teinte : ''jht up'' la d' + [char]0x00E9 + 'marre') }
    'fr:doctor.host_team_unattestable' { return ('un conteneur de l''' + [char]0x00E9 + 'quipe est l' + [char]0x00E0 + ' mais on ne peut pas v' + [char]0x00E9 + 'rifier qu''il est le n' + [char]0x00F4 + 'tre : rien n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' touch' + [char]0x00E9 + ' (''jht status'' en dit plus)') }
    'fr:doctor.host_title' { return ('Job Hunter Team : l''' + [char]0x00E9 + 'quipe est ' + [char]0x00E9 + 'teinte (son conteneur ne tourne pas). V' + [char]0x00E9 + 'rifications faites depuis cet ordinateur :') }
    'fr:down.done' { return ('Job Hunter Team arr' + [char]0x00EA + 't' + [char]0x00E9 + '.') }
    'fr:download.bad_version' { return 'version non valide : %s. Exemple : 0.3.5.' }
    'fr:download.deb_only_linux' { return '--deb est seulement pour Linux.' }
    'fr:download.dest_is_link' { return 'la destination est un lien : %s' }
    'fr:download.dest_not_file' { return 'la destination existe et n''est pas un fichier : %s' }
    'fr:download.fetching' { return ('T' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement de %s...') }
    'fr:download.hash_invalid' { return 'SHA-256 non valide pour %s : attendu %s, obtenu %s.' }
    'fr:download.intel_mac' { return ('L''app macOS 0.4 ne tourne que sur les Mac avec puce Apple (M1 et suivants) ; ce Mac est un Mac Intel, que la 0.4 ne prend pas en charge. Rien n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charg' + [char]0x00E9 + '.') }
    'fr:download.linux_no_app' { return ('Dans cette version il n''y a pas d''app de bureau pour Linux : utilise install.sh. Rien n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charg' + [char]0x00E9 + '.') }
    'fr:download.mismatch_existing' { return ('le fichier %s existe mais son SHA-256 ne correspond pas : il n''a pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' ' + [char]0x00E9 + 'cras' + [char]0x00E9 + '.') }
    'fr:download.mkdir_failed' { return ('impossible de cr' + [char]0x00E9 + 'er le dossier de destination : %s') }
    'fr:download.present_verified' { return ('Fichier d' + [char]0x00E9 + 'j' + [char]0x00E0 + ' pr' + [char]0x00E9 + 'sent et v' + [char]0x00E9 + 'rifi' + [char]0x00E9 + ' : %s') }
    'fr:download.release_no_app' { return ('Cette version (v%s) n''a pas d''app pour macOS : utilise la 0.4.0 ou une plus r' + [char]0x00E9 + 'cente. Rien n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charg' + [char]0x00E9 + '.') }
    'fr:download.saved_in' { return ('Enregistr' + [char]0x00E9 + ' dans : %s') }
    'fr:download.sha_verified' { return ('SHA-256 v' + [char]0x00E9 + 'rifi' + [char]0x00E9 + ' : %s') }
    'fr:download.sum_missing' { return ('aucun SHA-256 d' + [char]0x00E9 + 'clar' + [char]0x00E9 + ' pour %s.') }
    'fr:download.unsupported_os' { return ('syst' + [char]0x00E8 + 'me non pris en charge : %s. Utilise windows ou macos.') }
    'fr:download.windows_missing' { return ('Windows ne fait pas partie de la 0.4.0 : la version n''a pas d''installeur pour Windows. Rien n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charg' + [char]0x00E9 + '.') }
    'fr:help.integration' { return (('Usage : jht integration <commande>', '', ('  list [--json]                   les int' + [char]0x00E9 + 'grations et leur ' + [char]0x00E9 + 'tat'), ('  status [ID] [--json]            l''' + [char]0x00E9 + 'tat d''une seule, ou de toutes'), ('  add ID [--json]                 ajoute une int' + [char]0x00E9 + 'gration'), '  remove ID [--purge --yes] [--remove-image] [--json]', ('                                  la retire ; --purge efface aussi ses donn' + [char]0x00E9 + 'es (il faut --yes) ;'), '                                  --remove-image (seulement screen et media) retire aussi l''image des outils', '', ('Les ID admis sont ceux qu''affiche `jht integration list`. Rien ne se t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge ni ne s''allume'), 'tant que tu ne le demandes pas avec `add`.') -join [char]10) }
    'fr:help.linkedin' { return (('Usage : jht linkedin <commande>', '', ('  login [--stop]    la connexion manuelle ' + [char]0x00E0 + ' LinkedIn (avec Google) : un navigateur dans un conteneur ' + [char]0x00E0 + ' part, sans r' + [char]0x00E9 + 'seau,'), ('                    dont tu vois et utilises la fen' + [char]0x00EA + 'tre depuis l''app ; --stop ferme tout'), ('  status --json     dit si la connexion est en cours et si la session LinkedIn est enregistr' + [char]0x00E9 + 'e'), '', ('Rien ne se t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge ni ne s''allume tant que tu ne le demandes pas avec `login`.')) -join [char]10) }
    'fr:help.screen' { return (('Usage : jht screen <commande>', '', ('  on [--json]       allume l''' + [char]0x00E9 + 'cran en direct du closer : un conteneur ' + [char]0x00E0 + ' part, avec le stream seulement sur 127.0.0.1'), '  off [--remove-image] [--json]', ('                    l''' + [char]0x00E9 + 'teint et retire le conteneur ; l''image des outils reste sur le disque, pour le rallumer'), ('                    sans la ret' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charger : --remove-image la retire et lib' + [char]0x00E8 + 're l''espace'), ('  status [--json]   dit s''il est allum' + [char]0x00E9), '', ('Rien ne se t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge ni ne s''allume tant que tu ne le demandes pas avec `on`. Le stream se regarde seulement.')) -join [char]10) }
    'fr:help.setup' { return (('Usage : jht setup [options]', '', ('Sans options, l''installation guid' + [char]0x00E9 + 'e d' + [char]0x00E9 + 'marre. Avec --non-interactive, rien n''est demand' + [char]0x00E9 + ' :'), 'tout se donne avec les options.', '', '  --non-interactive            aucune question', ('  --provider <name>            glm (Z.ai, par d' + [char]0x00E9 + 'faut), kimi (Moonshot), openai ou claude (Anthropic)'), ('  --harness <name>             pi (par d' + [char]0x00E9 + 'faut)'), ('  --api-key-file <path>        fichier qui contient la cl' + [char]0x00E9 + ' API (une ligne, lisible seulement par toi).'), '                               jht lit ce fichier sur ton ordinateur et le passe au setup :', ('                               avec glm et kimi, le setup garde la cl' + [char]0x00E9 + ' ' + [char]0x00E0 + ' part, jamais dans la configuration'), ('  --api-key-stdin              lit la cl' + [char]0x00E9 + ' API sur l''entr' + [char]0x00E9 + 'e standard (une ligne) : jamais sur la ligne de commande'), ('  --api-key <key>              la cl' + [char]0x00E9 + ' ' + [char]0x00E9 + 'crite ici, en clair (refus' + [char]0x00E9 + 'e pour glm et kimi)'), ('  --secret-mode <mode>         comment la cl' + [char]0x00E9 + ' est enregistr' + [char]0x00E9 + 'e : plaintext (par d' + [char]0x00E9 + 'faut), env ou file'), '  --secret-env <name>          avec --secret-mode env : la variable d''environnement qui la contient', '  --secret-file <path>         avec --secret-mode file : le fichier qui la contient', ('  --model <model>              le mod' + [char]0x00E8 + 'le ' + [char]0x00E0 + ' utiliser'), '  --language <code>            la langue (par exemple it ou en)', ('  --budget-usd <dollars>       combien l''' + [char]0x00E9 + 'quipe peut d' + [char]0x00E9 + 'penser, en dollars (avec l''une de --budget-minutes, --budget-days, --budget-until)'), ('  --budget-minutes <n>         le budget dure ce nombre de minutes ' + [char]0x00E0 + ' partir de maintenant'), ('  --budget-days <n>            le budget dure ce nombre de jours ' + [char]0x00E0 + ' partir de maintenant'), ('  --budget-until <heure>       le budget dure jusqu''' + [char]0x00E0 + ' cette heure de la journ' + [char]0x00E9 + 'e, 0-23 (la prochaine)'), ('  --no-budget                  aucune limite de d' + [char]0x00E9 + 'penses (l''' + [char]0x00E9 + 'quipe ne s''arr' + [char]0x00EA + 'te qu''au cr' + [char]0x00E9 + 'dit du fournisseur)'), ('  --skip-health                saute la v' + [char]0x00E9 + 'rification finale'), '  --reset                      repart d''une configuration propre', '', 'Exemples :', ('  avec une cl' + [char]0x00E9 + ' GLM dans un fichier :'), '    jht setup --non-interactive --provider glm --harness pi --api-key-file cle.txt', ('  OpenAI avec une cl' + [char]0x00E9 + ' API, sur Pi (pour Claude : --provider claude) :'), '    jht setup --non-interactive --provider openai --harness pi --api-key-stdin') -join [char]10) }
    'fr:help.tools' { return (('Utilisation : jht tools <commande>', '', ('  status --json   si les outils des Scout (l''image compl' + [char]0x00E8 + 'te) sont l' + [char]0x00E0 + ', en route ou en ' + [char]0x00E9 + 'chec'), ('  pull            les t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge en arri' + [char]0x00E8 + 're-plan (jht up et jht setup le lancent tout seuls)'), ('  switch          fait passer l''' + [char]0x00E9 + 'quipe dessus une fois l''onboarding termin' + [char]0x00E9 + ' (le t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement le fait tout seul)'), '', ('Cette aide ne d' + [char]0x00E9 + 'marre rien et ne t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge rien.')) -join [char]10) }
    'fr:host_setup.timezone_explain' { return 'Le Capitaine l''utilise pour convertir les heures dans les messages Telegram et les graphiques.' }
    'fr:host_setup.timezone_header' { return 'Fuseau horaire' }
    'fr:host_setup.timezone_label' { return 'Fuseau horaire' }
    'fr:host_setup.timezone_vps_utc' { return ('Le fuseau horaire n''a pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' d' + [char]0x00E9 + 'tect' + [char]0x00E9 + ' : l''' + [char]0x00E9 + 'quipe utilisera UTC. R' + [char]0x00E8 + 'gle le tien avec jht wh --tz Europe/Paris (ou dans le tableau de bord), sinon les heures de Telegram et les horaires de travail seront en UTC.') }
    'fr:host_setup.tz.bad_number' { return 'Choisis un nombre entre 1 et %d.' }
    'fr:host_setup.tz.how' { return 'Tape un pays, une ville ou un fuseau horaire (par exemple France, Paris, Europe/Paris).' }
    'fr:host_setup.tz.how_default' { return ('Appuie sur Entr' + [char]0x00E9 + 'e pour garder %s, ou tape un pays, une ville ou un fuseau horaire pour en chercher un autre.') }
    'fr:host_setup.tz.none' { return ('Aucun fuseau horaire pour ' + [char]0x00AB + ' %s ' + [char]0x00BB + ' : tape le pays (par exemple France) ou une grande ville proche.') }
    'fr:host_setup.tz.not_detected' { return ('Ton fuseau horaire n''a pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' d' + [char]0x00E9 + 'tect' + [char]0x00E9 + '.') }
    'fr:host_setup.tz.pick' { return ('Num' + [char]0x00E9 + 'ro (1-%d), ou une nouvelle recherche :') }
    'fr:host_setup.tz.proposed' { return ('Propos' + [char]0x00E9 + ' : %s (il est %s).') }
    'fr:host_setup.tz.saved_and_detected' { return ('Enregistr' + [char]0x00E9 + ' : %s (il est %s) ' + [char]0x00B7 + ' D' + [char]0x00E9 + 'tect' + [char]0x00E9 + ' maintenant : %s (il est %s)') }
    'fr:host_setup.tz.too_many' { return ('%d fuseaux horaires correspondent ' + [char]0x00E0 + ' ' + [char]0x00AB + ' %s ' + [char]0x00BB + ' : tape quelque chose de plus pr' + [char]0x00E9 + 'cis (une ville, par exemple).') }
    'fr:keyfile.both' { return 'utilise --api-key-file ou --api-key-stdin, pas les deux' }
    'fr:keyfile.not_file' { return ('le fichier pass' + [char]0x00E9 + ' ' + [char]0x00E0 + ' --api-key-file doit ' + [char]0x00EA + 'tre un fichier normal, pas un dossier ni un lien : %s') }
    'fr:keyfile.shape' { return ('le contenu du fichier pass' + [char]0x00E9 + ' ' + [char]0x00E0 + ' --api-key-file n''est pas une ligne de 16 ' + [char]0x00E0 + ' 512 caract' + [char]0x00E8 + 'res imprimables sans espaces : %s') }
    'fr:keyfile.size' { return ('le fichier pass' + [char]0x00E9 + ' ' + [char]0x00E0 + ' --api-key-file est vide ou trop gros pour une cl' + [char]0x00E9 + ' (1 ' + [char]0x00E0 + ' 4096 octets) : %s') }
    'fr:keyfile.twice' { return ('--api-key-file a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' pass' + [char]0x00E9 + ' deux fois') }
    'fr:keyfile.unreadable' { return ('le fichier pass' + [char]0x00E9 + ' ' + [char]0x00E0 + ' --api-key-file est illisible : %s') }
    'fr:line.abbinamento_annullato_nessuna_modifica' { return ('Association annul' + [char]0x00E9 + 'e : aucune modification.') }
    'fr:line.abbinamento_di_s_non_riuscito' { return ('L''association de %s a ' + [char]0x00E9 + 'chou' + [char]0x00E9 + ' : toutes les anciennes copies restent. Relance jht telegram pair --all : les r' + [char]0x00F4 + 'les d' + [char]0x00E9 + 'j' + [char]0x00E0 + ' associ' + [char]0x00E9 + 's ne redemandent pas de token.') }
    'fr:line.abbinamento_rifiutato_genera_un_token' { return ('Association refus' + [char]0x00E9 + 'e : g' + [char]0x00E9 + 'n' + [char]0x00E8 + 're un nouveau token dans BotFather (/revoke) et r' + [char]0x00E9 + 'essaie.') }
    'fr:line.agent_restart_failed.inventario_conservato_ma_il_team' { return ('inventaire conserv' + [char]0x00E9 + ', mais l''' + [char]0x00E9 + 'quipe n''a pas red' + [char]0x00E9 + 'marr' + [char]0x00E9 + '. Que faire : jht up') }
    'fr:line.annullato_niente_autorizzato' { return ('Annul' + [char]0x00E9 + ' : rien d''autoris' + [char]0x00E9 + '.') }
    'fr:line.anteprima_non_valida_niente_autorizzato' { return ('Aper' + [char]0x00E7 + 'u non valide : rien d''autoris' + [char]0x00E9 + '.') }
    'fr:line.apply.authorize' { return 'Tu autorises cette candidature ?' }
    'fr:line.apply_relink_account_cloud_account' { return 'apply relink-account : compte cloud non disponible. Lance d''abord jht cloud pair.' }
    'fr:line.autorizzata_s_verso_s_il' { return ('#%s autoris' + [char]0x00E9 + 'e, vers %s : le CLOSER la prendra au prochain tour.') }
    'fr:line.bot_abbinato_e_copia_legacy' { return ('Bot associ' + [char]0x00E9 + ' et ancienne copie supprim' + [char]0x00E9 + 'e. Il reste d''autres anciens tokens ou un token dans l''environnement du conteneur : supprime-les et termine la rotation avant le basculement.') }
    'fr:line.bot_token_invalid.controlla_il_token_generato_da' { return ('v' + [char]0x00E9 + 'rifie le token g' + [char]0x00E9 + 'n' + [char]0x00E9 + 'r' + [char]0x00E9 + ' par BotFather.') }
    'fr:line.broker_restart_failed.il_servizio_della_posta_non_4' { return ('le service mail n''a pas red' + [char]0x00E9 + 'marr' + [char]0x00E9 + '. Que faire : jht mail status') }
    'fr:line.broker_start_failed.il_servizio_della_posta_non_2' { return ('le service mail n''a pas d' + [char]0x00E9 + 'marr' + [char]0x00E9 + '.') }
    'fr:line.broker_start_failed.il_servizio_della_posta_non_3' { return ('le service mail ne r' + [char]0x00E9 + 'pond pas apr' + [char]0x00E8 + 's 30 secondes.') }
    'fr:line.broker_unavailable.il_broker_dei_segreti_esiste' { return ('le broker des secrets existe mais on ne peut pas attester qu''il est le n' + [char]0x00F4 + 'tre : je n''y touche pas.') }
    'fr:line.broker_unavailable.il_runtime_installato_pi_vecchio_2' { return ('le runtime install' + [char]0x00E9 + ' est plus ancien et n''a pas le broker des secrets.') }
    'fr:line.broker_unavailable.il_servizio_della_posta_non' { return ('le service mail n''existe pas encore : il est cr' + [char]0x00E9 + [char]0x00E9 + ' la premi' + [char]0x00E8 + 're fois qu''on en a besoin.') }
    'fr:line.cancellato_marcatore_migrazione_broker_s' { return ('Effac' + [char]0x00E9 + ' : marqueur de migration du broker %s') }
    'fr:line.cancellato_volume_broker_s_s' { return ('Effac' + [char]0x00E9 + ' : volume broker %s (%s)') }
    'fr:line.container_s_non_e_partito' { return ('Le conteneur ''%s'' n''a pas d' + [char]0x00E9 + 'marr' + [char]0x00E9 + ' en 10 s. Regarde ''jht logs''.') }
    'fr:line.cosa_fare_jht_mail_setup' { return 'Que faire : jht mail setup' }
    'fr:line.cosa_fare_jht_up_3' { return 'Que faire : jht up' }
    'fr:line.cosa_fare_jht_upgrade_4' { return 'Que faire : jht upgrade' }
    'fr:line.cosa_fare_riprova_il_comando_2' { return 'Que faire : relance la commande' }
    'fr:line.fino_ad_allora_la_posta' { return ('D''ici l' + [char]0x00E0 + ', le mail se lit et s''envoie avec le mot de passe actuel ; l''avertissement reste dans jht mail status.') }
    'fr:line.genera_una_nuova_password_per' { return ('g' + [char]0x00E9 + 'n' + [char]0x00E8 + 're un nouveau mot de passe d''application chez ton fournisseur et enregistre-le avec : jht mail setup') }
    'fr:line.i_segreti_e_lo_stato' { return ('Les secrets et l''' + [char]0x00E9 + 'tat du broker ont ' + [char]0x00E9 + 't' + [char]0x00E9 + ' effac' + [char]0x00E9 + 's : refais les connexions aux portails et reconfigure le mail.') }
    'fr:line.il_broker_non_ha_registrato' { return ('Le broker n''a pas enregistr' + [char]0x00E9 + ' l''autorisation : retir' + [char]0x00E9 + 'e, rien ne partira.') }
    'fr:line.integration.install_hint' { return 'pour les installer : ''jht upgrade'' (ou un ''jht integration add <id>'')' }
    'fr:line.interattivo_il_token_viene_chiesto' { return ('Interactif : le token est demand' + [char]0x00E9 + ' sans ' + [char]0x00E9 + 'cho, puis le nouveau bot re' + [char]0x00E7 + 'oit un code ' + [char]0x00E0 + ' usage unique depuis ton Telegram. Automatisations : {"bot_token": ...} en JSON sur stdin ; n''enregistre pas le token dans ~/.jht et efface tout de suite tout fichier utilis' + [char]0x00E9 + ' en dehors.') }
    'fr:line.jht_telegram_pair_all_interattivo' { return ('jht telegram pair --all est interactif : pour les automatisations, associe un r' + [char]0x00F4 + 'le ' + [char]0x00E0 + ' la fois.') }
    'fr:line.job_hunter_team_non_installato' { return ('Job Hunter Team n''est pas compl' + [char]0x00E8 + 'tement install' + [char]0x00E9 + ' : le fichier d''int' + [char]0x00E9 + 'grit' + [char]0x00E9 + ' manque dans le dossier du runtime (une installation interrompue ?). Relance l''installeur.') }
    'fr:line.la_casella_di_posta_ora' { return ('La bo' + [char]0x00EE + 'te mail est maintenant dans le broker des secrets. Son mot de passe ' + [char]0x00E9 + 'tait lisible par les agents :') }
    'fr:line.legacy_cleanup_failed.i_token_nuovi_sono_al' { return ('les nouveaux tokens sont en s' + [char]0x00E9 + 'curit' + [char]0x00E9 + ', mais l''ancienne copie de %s est encore dans ~/.jht ; basculement refus' + [char]0x00E9 + '.') }
    'fr:line.legacy_inventory_failed.il_team_resta_fermo_perch_4' { return ('l''' + [char]0x00E9 + 'quipe reste arr' + [char]0x00EA + 't' + [char]0x00E9 + 'e parce que l''inventaire Telegram de l''h' + [char]0x00F4 + 'te n''a pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' conserv' + [char]0x00E9 + '.') }
    'fr:line.legacy_inventory_failed.le_impronte_non_sono_state' { return ('les empreintes n''ont pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' conserv' + [char]0x00E9 + 'es par le service isol' + [char]0x00E9 + '.') }
    'fr:line.legacy_inventory_failed.migrazione_telegram_interrotta' { return 'migration Telegram interrompue.' }
    'fr:line.legacy_inventory_failed.non_posso_provare_che_jht' { return 'impossible de prouver que ~/.jht ne contient aucun token Telegram.' }
    'fr:line.legacy_inventory_failed.non_riesco_a_fermare_gli' { return ('impossible d''arr' + [char]0x00EA + 'ter les agents avant l''inventaire de l''h' + [char]0x00F4 + 'te.') }
    'fr:line.legacy_inventory_failed.non_riesco_a_leggere_i' { return 'impossible de lire les anciens tokens dans ~/.jht.' }
    'fr:line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti' { return ('anciens r' + [char]0x00F4 + 'les non reconnus.') }
    'fr:line.legacy_remove_failed.s_nel_broker_ma_la' { return ('%s est dans le broker mais la copie dans ~/.jht/credentials est rest' + [char]0x00E9 + 'e.') }
    'fr:line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso' { return ('~/.jht/credentials/%s.json est r' + [char]0x00E9 + 'apparu apr' + [char]0x00E8 + 's la migration ; supprim' + [char]0x00E9 + ' sans ' + [char]0x00EA + 'tre import' + [char]0x00E9 + '.') }
    'fr:line.mail.address_prompt' { return ('Adresse de la bo' + [char]0x00EE + 'te :') }
    'fr:line.mail.app_password_prompt' { return 'Mot de passe d''application (il ne s''affiche pas) :' }
    'fr:line.mail.dedicated_prompt' { return ('C''est une bo' + [char]0x00EE + 'te D' + [char]0x00C9 + 'DI' + [char]0x00C9 + 'E aux alertes d''emploi transf' + [char]0x00E9 + 'r' + [char]0x00E9 + 'es ?') }
    'fr:line.mail_setup_opzione_sconosciuta_s' { return 'mail setup : option inconnue %s' }
    'fr:line.mail_setup_password_vuota' { return 'mail setup : mot de passe vide' }
    'fr:line.nessun_provider_attivo_scegline_uno' { return 'aucun fournisseur actif : choisis-en un avec ''jht providers use glm''' }
    'fr:line.nessun_ruolo_ha_un_token' { return ('Aucun r' + [char]0x00F4 + 'le n''a d''ancien token : pour un nouveau bot, utilise jht telegram pair <r' + [char]0x00F4 + 'le>.') }
    'fr:line.non_autorizzabile_s' { return ('Impossible ' + [char]0x00E0 + ' autoriser : %s.') }
    'fr:line.non_autorizzata_s' { return ('Non autoris' + [char]0x00E9 + 'e : %s.') }
    'fr:line.os_and_version_are_required' { return '--os et --version sont obligatoires' }
    'fr:line.podman_non_trovato_reinstalla_il' { return ('Podman introuvable : r' + [char]0x00E9 + 'installe le runtime JHT.') }
    'fr:line.preparo_il_servizio_della_posta' { return ('Je pr' + [char]0x00E9 + 'pare le service mail (il n''est cr' + [char]0x00E9 + [char]0x00E9 + ' que la premi' + [char]0x00E8 + 're fois qu''on en a besoin)' + [char]0x2026) }
    'fr:line.provider_attivo_non_riconosciuto_s' { return 'fournisseur actif non reconnu : %s' }
    'fr:line.reset_impossibile_cancellare_il_marcatore' { return 'reset : impossible d''effacer le marqueur de migration du broker %s.' }
    'fr:line.reset_impossibile_cancellare_il_marcatore_2' { return 'reset : impossible d''effacer le marqueur du broker %s.' }
    'fr:line.reset_impossibile_cancellare_il_volume' { return 'reset : impossible d''effacer le volume broker %s (%s).' }
    'fr:line.reset_nome_volume_non_valido' { return ('reset : nom de volume non valide pour %s ; suppression refus' + [char]0x00E9 + 'e.') }
    'fr:line.reset_non_riesco_a_determinare' { return ('reset : impossible de d' + [char]0x00E9 + 'terminer le projet Compose ; les volumes du broker n''ont pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' touch' + [char]0x00E9 + 's.') }
    'fr:line.reset_non_riesco_a_fermare' { return ('reset : impossible d''arr' + [char]0x00EA + 'ter le runtime ; les volumes du broker n''ont pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' touch' + [char]0x00E9 + 's.') }
    'fr:line.reset_ricerca_del_volume_s_2' { return ('reset : la recherche du volume %s a ' + [char]0x00E9 + 'chou' + [char]0x00E9 + '.') }
    'fr:line.restano_token_legacy_per_s' { return ('Il reste d''anciens tokens pour : %s. Tant que tu n''associes pas aussi ces r' + [char]0x00F4 + 'les, %s reste muet sur Telegram : associe-les tous dans cette session (jht telegram pair --all).') }
    'fr:line.risposta_del_container_non_valida' { return ('R' + [char]0x00E9 + 'ponse du conteneur non valide : autorisation retir' + [char]0x00E9 + 'e, rien ne partira.') }
    'fr:line.ritirata_s_non_verra_inviata' { return ('#%s retir' + [char]0x00E9 + 'e : elle ne sera pas envoy' + [char]0x00E9 + 'e.') }
    'fr:line.ritiro_non_riuscito_s' { return ('Retrait ' + [char]0x00E9 + 'chou' + [char]0x00E9 + ' : %s.') }
    'fr:line.runtime_migration_docker_missing.il_client_docker_originale_non' { return 'le client Docker d''origine n''est pas disponible.' }
    'fr:line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata' { return ('il faut l''image JHT fix' + [char]0x00E9 + 'e par digest.') }
    'fr:line.runtime_migration_podman_missing.podman_non_e_disponibile' { return 'Podman n''est pas disponible.' }
    'fr:line.runtime_migration_team_running.ferma_prima_il_team_docker' { return ('arr' + [char]0x00EA + 'te d''abord l''' + [char]0x00E9 + 'quipe Docker.') }
    'fr:line.runtime_migration_team_running.ferma_prima_il_team_podman' { return ('arr' + [char]0x00EA + 'te d''abord l''' + [char]0x00E9 + 'quipe Podman.') }
    'fr:line.runtime_o_container_jht_non' { return 'runtime ou conteneur JHT non disponible' }
    'fr:line.ruoli_da_abbinare_in_questa' { return ('R' + [char]0x00F4 + 'les ' + [char]0x00E0 + ' associer dans cette session : %s') }
    'fr:line.s_ha_gi_un_bot' { return ('%s a d' + [char]0x00E9 + 'j' + [char]0x00E0 + ' un bot associ' + [char]0x00E9 + ' : je supprime seulement son ancienne copie.') }
    'fr:line.s_needs_a_value' { return '%s demande une valeur' }
    'fr:line.saltato_non_trovato_volume_broker' { return ('Ignor' + [char]0x00E9 + ' (introuvable) : volume broker %s') }
    'fr:line.serve_un_terminale_l_autorizzazione' { return ('Il faut un terminal : l''autorisation se confirme ' + [char]0x00E0 + ' la main.') }
    'fr:line.telegram_isolato_attivo_il_bridge' { return ('Telegram isol' + [char]0x00E9 + ' actif ; les agents ne peuvent plus r' + [char]0x00E9 + 'activer l''ancien bridge.') }
    'fr:line.the_setup_keeps_the_key' { return ('La configuration garde la cl' + [char]0x00E9 + ' : tu peux effacer le fichier sur cet ordinateur maintenant (%s).') }
    'fr:line.upgrade.done' { return ('Mise ' + [char]0x00E0 + ' jour termin' + [char]0x00E9 + 'e : %s (%s) -> %s (%s). %s') }
    'fr:line.upgrade.restored' { return ('Runtime pr' + [char]0x00E9 + 'c' + [char]0x00E9 + 'dent restaur' + [char]0x00E9 + '.') }
    'fr:line.uso_jht_apply_relink_account' { return 'usage : jht apply relink-account' }
    'fr:line.uso_jht_apply_request_cancel_2' { return 'usage : jht apply request|cancel <id>' }
    'fr:line.uso_jht_mail_setup_status' { return 'usage : jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <adresse|@domaine>|drafts|approve <id>|discard <id>|journal|delete|migrate' }
    'fr:line.uso_jht_migrate_runtime_podman' { return 'usage : jht migrate-runtime podman' }
    'fr:line.uso_jht_screen_on_off' { return 'usage : jht screen on | off | status [--json]' }
    'fr:line.uso_jht_telegram_chat_id' { return 'usage : jht telegram chat-id <assistente|capitano|mentor>' }
    'fr:line.uso_jht_telegram_pair_assistente' { return 'usage : jht telegram pair <assistente|capitano|mentor>|--all' }
    'fr:line.uso_jht_telegram_remove_assistente' { return 'usage : jht telegram remove <assistente|capitano|mentor>' }
    'fr:line.uso_jht_telegram_status_pair' { return ('usage : jht telegram status|pair <r' + [char]0x00F4 + 'le>|pair --all|chat-id <r' + [char]0x00F4 + 'le>|remove <r' + [char]0x00F4 + 'le>') }
    'fr:monitor.window_invalid' { return 'monitor_window_invalid : utilise ''jht monitor --window'' sans autres options.' }
    'fr:ps.apply_auto_send_warning_1' { return ('  Quand l''envoi automatique est activ' + [char]0x00E9 + ', l''' + [char]0x00E9 + 'quipe remplit et ENVOIE la candidature,') }
    'fr:ps.apply_auto_send_warning_2' { return ('  sans autre confirmation. Une fois partie, elle ne peut plus ' + [char]0x00EA + 'tre rappel' + [char]0x00E9 + 'e.') }
    'fr:ps.artifact_copied' { return ('%s a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' copi' + [char]0x00E9 + ' dans %s pour que l' + [char]0x2019 + [char]0x00E9 + 'quipe puisse le lire.') }
    'fr:ps.artifact_copy_failed' { return ('impossible de copier %s dans le dossier partag' + [char]0x00E9 + ' : %s') }
    'fr:ps.artifact_copy_refused' { return ('%s n' + [char]0x2019 + 'est pas copi' + [char]0x00E9 + ' : %s est un lien ou n' + [char]0x2019 + 'est pas dans le dossier partag' + [char]0x00E9) }
    'fr:ps.bot_token_prompt_hidden' { return ('Token du bot %s (saisie masqu' + [char]0x00E9 + 'e)') }
    'fr:ps.botfather_fresh_token' { return ('Utilise toujours un token tout juste g' + [char]0x00E9 + 'n' + [char]0x00E9 + 'r' + [char]0x00E9 + ' dans BotFather (/revoke sur le bot, ou un nouveau bot) : un token d' + [char]0x00E9 + 'j' + [char]0x00E0 + ' existant a pu ' + [char]0x00EA + 'tre lu par les agents m' + [char]0x00EA + 'me s''il n''appara' + [char]0x00EE + 't plus aujourd''hui dans ~/.jht.') }
    'fr:ps.broker_network_proxy_not_ready' { return ('broker_network_unavailable: le proxy mail n''est pas pr' + [char]0x00EA + 't (code %s).') }
    'fr:ps.broker_network_scripts_not_downloadable' { return ('broker_network_unavailable: impossible de t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charger les scripts du proxy mail. Que faire : jht upgrade') }
    'fr:ps.broker_network_scripts_not_verified' { return 'broker_network_unavailable: les scripts du proxy mail ne sont pas attestables. Que faire : jht upgrade' }
    'fr:ps.broker_restart_failed_secrets_broker_not_ours' { return ('broker_restart_failed: le broker des secrets n''est pas attestable comme le n' + [char]0x00F4 + 'tre : je n''y touche pas. Que faire : jht mail status') }
    'fr:ps.broker_unavailable_secrets_broker_not_running' { return 'broker_unavailable: le broker des secrets n''est pas actif.' }
    'fr:ps.cli_version_needs_container' { return ('La version du CLI en cours d''ex' + [char]0x00E9 + 'cution demande le conteneur actif : ''jht up''.') }
    'fr:ps.compose_up_failed_team_not_started' { return ('compose_up_failed: l''' + [char]0x00E9 + 'quipe n''a pas d' + [char]0x00E9 + 'marr' + [char]0x00E9 + ' (docker compose up, code %s). Regarde ''jht logs''.') }
    'fr:ps.container_not_running' { return 'conteneur ''%s'' inactif' }
    'fr:ps.container_runtime_unsupported' { return 'runtime de conteneurs non pris en charge : %s' }
    'fr:ps.docker_desktop_file_sharing_hint' { return ('  Que faire : ouvre Docker Desktop > Settings > Resources > File sharing, v' + [char]0x00E9 + 'rifie que le dossier de l''utilisateur est partag' + [char]0x00E9 + ', puis relance ''jht up''.') }
    'fr:ps.docker_podman_verified_future_removal' { return ('Migration Docker -> Podman v' + [char]0x00E9 + 'rifi' + [char]0x00E9 + 'e. Les volumes Docker restent intacts et contiennent encore les mots de passe mail, les acc' + [char]0x00E8 + 's aux portails et les tokens Telegram : leur suppression demandera ' + [char]0x00E0 + ' l''avenir une confirmation explicite.') }
    'fr:ps.doctor.wsl_memory' { return ('WSL n''a pas de limite de m' + [char]0x00E9 + 'moire (d''autres distributions WSL sont enregistr' + [char]0x00E9 + 'es) : dans %s, sous [wsl2], ajoute memory=%s') }
    'fr:ps.download_asset_failed_detail' { return ('' + [char]0x00E9 + 'chec du t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement : %s (%s)') }
    'fr:ps.download_shared_folder_no_path' { return ('la destination est dans un dossier partag' + [char]0x00E9 + ' avec l''' + [char]0x00E9 + 'quipe : choisis-en un en dehors, comme Downloads.') }
    'fr:ps.download_sums_failed_detail' { return ('' + [char]0x00E9 + 'chec du t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement : SHA256SUMS de v%s (%s)') }
    'fr:ps.full_pull_failed_keep_old' { return ('full_pull_failed: la nouvelle image compl' + [char]0x00E8 + 'te n''est pas arriv' + [char]0x00E9 + 'e, l''ancienne reste. Que faire : jht tools pull') }
    'fr:ps.help.main' { return (('jht - Job Hunter Team', '', ('  Commandes de l''h' + [char]0x00F4 + 'te (elles marchent d''ici) :'), ('    jht up                 d' + [char]0x00E9 + 'marre le conteneur de l''' + [char]0x00E9 + 'quipe'), ('    jht down               l''arr' + [char]0x00EA + 'te'), '                           (avec --verbose on voit aussi les lignes du moteur)', ('    jht restart            le red' + [char]0x00E9 + 'marre'), ('    jht status             ' + [char]0x00E9 + 'tat du conteneur et de l''' + [char]0x00E9 + 'quipe'), '    jht logs [-f]          logs du conteneur', ('    jht upgrade            met ' + [char]0x00E0 + ' jour vers l''image la plus r' + [char]0x00E9 + 'cente'), ('    jht setup              installation guid' + [char]0x00E9 + 'e'), '    jht shell              shell dans le conteneur', ('    jht mail setup         enregistre la bo' + [char]0x00EE + 'te mail dans le broker des secrets'), ('    jht mail drafts        mails ' + [char]0x00E9 + 'crits par les agents qui attendent ton accord'), ('    jht mail approve <id>  les envoie ; jht mail discard <id> les ' + [char]0x00E9 + 'carte'), '    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]', ('                           les int' + [char]0x00E9 + 'grations qu''on ajoute apr' + [char]0x00E8 + 's le setup'), ('                           (google, telegram, mail) : ' + [char]0x00E9 + 'tat lu par le moteur'), ('    jht telegram status    ' + [char]0x00E9 + 'tat du service Telegram isol' + [char]0x00E9), ('    jht telegram pair ROLE demande le token sans ' + [char]0x00E9 + 'cho sur l''ordinateur h' + [char]0x00F4 + 'te, puis'), ('                           affiche un code ' + [char]0x00E0 + ' envoyer au bot depuis ton Telegram'), '                           Pour les automatisations : JSON sur stdin. N''enregistre pas le token', ('                           dans ~/.jht ; efface tout de suite les fichiers utilis' + [char]0x00E9 + 's hors de l' + [char]0x00E0 + '.'), ('    jht telegram pair --all associe en une session tous les r' + [char]0x00F4 + 'les aux anciens tokens'), ('    jht telegram chat-id ROLE d' + [char]0x00E9 + 'place le bot vers un autre chat, avec le m' + [char]0x00EA + 'me code'), '    jht reset              efface la configuration et les volumes du broker', '    jht migrate-runtime podman', ('                           copie et v' + [char]0x00E9 + 'rifie les volumes Docker dans Podman ;'), ('                           ne s' + [char]0x00E9 + 'lectionne pas le nouveau runtime et n''efface pas Docker'), ('    jht uninstall --confirm supprime le runtime local Windows, mais conserve les donn' + [char]0x00E9 + 'es,'), '                           les documents, Podman et Compose', '', '  Toutes les autres commandes (positions, stats, team, providers, cron,', '  working-hours, cloud...) tournent DANS le conteneur : pour leur aide', '  il faut le conteneur actif.', '', '      jht up ; jht --help') -join [char]10) }
    'fr:ps.home_unavailable_bind_mount' { return ('HOME/USERPROFILE indisponible : bind mount JHT refus' + [char]0x00E9) }
    'fr:ps.host_download_failed' { return ('' + [char]0x00E9 + 'chec du t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement sur l''h' + [char]0x00F4 + 'te : %s') }
    'fr:ps.input_not_json_bot_token_stdin' { return 'input_not_json: passe bot_token en JSON sur stdin.' }
    'fr:ps.integration_not_installed' { return ('non install' + [char]0x00E9) }
    'fr:ps.integration_not_installed_yet' { return ('pas encore install' + [char]0x00E9) }
    'fr:ps.jht_container_not_verifiable' { return 'Le conteneur JHT n''est pas attestable.' }
    'fr:ps.jht_home_missing' { return ('Job Hunter Team n''est pas encore install' + [char]0x00E9 + ' : le dossier %s n''existe pas. Lance l''installeur, puis ''jht setup''.') }
    'fr:ps.legacy_cleanup_failed_old_token_still_there' { return ('legacy_cleanup_failed: l''ancien token est encore dans ~/.jht ; basculement refus' + [char]0x00E9 + '.') }
    'fr:ps.legacy_migration_failed_stays' { return 'legacy_migration_failed: %s reste dans ~/.jht/credentials.' }
    'fr:ps.lifecycle.restarted' { return ('Job Hunter Team red' + [char]0x00E9 + 'marr' + [char]0x00E9 + '.') }
    'fr:ps.link_or_not_folder' { return 'lien ou pas un dossier' }
    'fr:ps.localappdata_unavailable' { return ('LOCALAPPDATA indisponible : runtime h' + [char]0x00F4 + 'te refus' + [char]0x00E9) }
    'fr:ps.machine_space_back_on_stop' { return ('Environ %s Go lib' + [char]0x00E9 + 'r' + [char]0x00E9 + 's dans la machine de JHT reviennent ' + [char]0x00E0 + ' Windows quand la machine s''arr' + [char]0x00EA + 'te : apr' + [char]0x00E8 + 's jht down, avec podman machine stop %s, ou au red' + [char]0x00E9 + 'marrage de l''ordinateur.') }
    'fr:ps.machine_space_not_returned' { return ('JHT occupe environ %s Go dans son disque virtuel ; ils sont enti' + [char]0x00E8 + 'rement lib' + [char]0x00E9 + 'r' + [char]0x00E9 + 's avec jht uninstall.') }
    'fr:ps.machine_state_unreadable' { return ('l''' + [char]0x00E9 + 'tat de la machine ne se lit pas (podman et wsl ne r' + [char]0x00E9 + 'pondent pas)') }
    'fr:ps.monitor_window_unavailable' { return ('monitor_window_unavailable : impossible d''ouvrir une fen' + [char]0x00EA + 'tre de terminal ici. Lance ''jht monitor'' dans le terminal actuel.') }
    'fr:ps.mount_repair_failed_folders_not_writable' { return ('mount_repair_failed: les dossiers de Job Hunter Team (%s, %s) ne sont pas accessibles en ' + [char]0x00E9 + 'criture au conteneur et n''ont pas pu ' + [char]0x00EA + 'tre r' + [char]0x00E9 + 'par' + [char]0x00E9 + 's.') }
    'fr:ps.old_images_busy' { return (' Utilis' + [char]0x00E9 + 'es par un conteneur (conserv' + [char]0x00E9 + 'es) : %s.') }
    'fr:ps.old_images_kept_all' { return ('Anciennes images JHT : toutes conserv' + [char]0x00E9 + 'es (JHT_KEEP_OLD_IMAGES=1).') }
    'fr:ps.old_images_refused' { return (' Refus' + [char]0x00E9 + 'es par le moteur (conserv' + [char]0x00E9 + 'es) : %s.') }
    'fr:ps.old_images_removed' { return ('Anciennes images JHT : %s supprim' + [char]0x00E9 + 'es, environ %s Mo lib' + [char]0x00E9 + 'r' + [char]0x00E9 + 's (taille nominale : les couches partag' + [char]0x00E9 + 'es ne se lib' + [char]0x00E8 + 'rent qu''en partie), conserv' + [char]0x00E9 + 'es : l''actuelle et la pr' + [char]0x00E9 + 'c' + [char]0x00E9 + 'dente.') }
    'fr:ps.pair_role_now_prompt' { return 'Associer %s maintenant ? [s/N]' }
    'fr:ps.podman_exe_not_found' { return 'podman.exe introuvable' }
    'fr:ps.podman_machine_not_responding' { return ('La machine Podman JHT ne r' + [char]0x00E9 + 'pond pas. Lance ''jht up''.') }
    'fr:ps.release_arrived_without_https' { return ('la release est arriv' + [char]0x00E9 + 'e sans HTTPS : %s') }
    'fr:ps.relink_account_container_not_running' { return 'apply relink-account: le conteneur n''est pas actif.' }
    'fr:ps.script_integration_not_installed' { return ('script jht-integration.ps1 pas encore install' + [char]0x00E9 + ' : ''jht upgrade'' (ou un ''jht integration add/remove'') et r' + [char]0x00E9 + 'essaie') }
    'fr:ps.script_tools_not_installed' { return ('script jht-tools.ps1 pas encore install' + [char]0x00E9 + ' : ''jht upgrade'' et r' + [char]0x00E9 + 'essaie') }
    'fr:ps.startup_task_still_registered' { return ('la t' + [char]0x00E2 + 'che est toujours enregistr' + [char]0x00E9 + 'e') }
    'fr:ps.team_container_unavailable' { return ('team_container_unavailable: d' + [char]0x00E9 + 'marre l''' + [char]0x00E9 + 'quipe avec jht up et r' + [char]0x00E9 + 'essaie.') }
    'fr:ps.telegram_not_configured' { return ('Telegram non actif : Telegram n''est pas configur' + [char]0x00E9 + '.') }
    'fr:ps.telegram_status_unverifiable' { return ('Telegram : ' + [char]0x00E9 + 'tat non v' + [char]0x00E9 + 'rifiable pour le moment (service arr' + [char]0x00EA + 't' + [char]0x00E9 + ' ou injoignable). D' + [char]0x00E9 + 'tails : jht telegram status') }
    'fr:ps.telegram_unavailable_isolated_not_running' { return ('telegram_unavailable: le service Telegram isol' + [char]0x00E9 + ' n''est pas actif.') }
    'fr:ps.telegram_unavailable_run_jht_up' { return ('telegram_unavailable: ex' + [char]0x00E9 + 'cute jht up') }
    'fr:ps.uninstall.bad.target' { return ('Refus' + [char]0x00E9 + ' : {0} est un lien ou n''est pas un dossier : je ne le suis pas et je ne l''efface pas.') }
    'fr:ps.uninstall.done' { return ('Termin' + [char]0x00E9 + ' : la machine <machine> (et avec elle les images JHT, celle de base et la compl' + [char]0x00E8 + 'te), le runtime et la commande jht ont ' + [char]0x00E9 + 't' + [char]0x00E9 + ' supprim' + [char]0x00E9 + 's.') }
    'fr:ps.uninstall.done.kept' { return (' ~/.jht et Documents\Job Hunter Team restent (avec --purge ils sont effac' + [char]0x00E9 + 's).') }
    'fr:ps.uninstall.done.wsl' { return ('WSL reste en m' + [char]0x00E9 + 'moire : vmmem, wslservice et wslrelay sont des composants de Windows (Job Hunter Team ne les a pas install' + [char]0x00E9 + 's) et les autres machines WSL de cet utilisateur en ont aussi besoin ; en g' + [char]0x00E9 + 'n' + [char]0x00E9 + 'ral ils s''arr' + [char]0x00EA + 'tent d''eux-m' + [char]0x00EA + 'mes apr' + [char]0x00E8 + 's un moment d''inactivit' + [char]0x00E9 + '. Pour les arr' + [char]0x00EA + 'ter tout de suite : wsl --shutdown (il arr' + [char]0x00EA + 'te TOUTES les machines WSL ouvertes).') }
    'fr:ps.uninstall.kept.machine' { return ('La machine Podman {0} n''est pas marqu' + [char]0x00E9 + 'e comme cr' + [char]0x00E9 + [char]0x00E9 + 'e par l''installeur : elle reste o' + [char]0x00F9 + ' elle est. ' + [char]0x00C0 + ' la main, si elle est ' + [char]0x00E0 + ' toi et que tu veux la supprimer : podman machine stop {0}; podman machine rm {0}.') }
    'fr:ps.uninstall.left.commands' { return ('Non supprim' + [char]0x00E9 + 's : la commande jht ou les fichiers de l''installeur dans {0} ({1}), ou les variables et les lignes PATH ajout' + [char]0x00E9 + 'es par l''installeur. ' + [char]0x00C0 + ' la main : Remove-Item sur le fichier ; les variables JHT_CONTAINER_RUNTIME et JHT_PODMAN_MACHINE et le dossier {0} dans le PATH depuis Param' + [char]0x00E8 + 'tres > Variables d''environnement.') }
    'fr:ps.uninstall.left.data' { return ('Les donn' + [char]0x00E9 + 'es JHT n''ont pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' effac' + [char]0x00E9 + 'es ({0}). ' + [char]0x00C0 + ' la main : Remove-Item -Recurse -Force {1}. La commande jht et le runtime sont toujours l' + [char]0x00E0 + ' : relance jht uninstall --confirm --purge une fois le probl' + [char]0x00E8 + 'me r' + [char]0x00E9 + 'gl' + [char]0x00E9 + '.') }
    'fr:ps.uninstall.left.machine' { return ('Non supprim' + [char]0x00E9 + 'e : la machine Podman <machine>. Motif : {0}. ' + [char]0x00C0 + ' la main : podman machine stop <machine>; wsl --unregister {1}; puis relance jht uninstall --confirm.') }
    'fr:ps.uninstall.left.runtime' { return ('Non supprim' + [char]0x00E9 + ' : le runtime JHT dans {0}. ' + [char]0x00C0 + ' la main : Remove-Item -Recurse -Force ''{0}''.') }
    'fr:ps.uninstall.left.task' { return ('Non supprim' + [char]0x00E9 + 'e : la t' + [char]0x00E2 + 'che de d' + [char]0x00E9 + 'marrage ' + [char]0x00E0 + ' l''ouverture de session ''{0}'' (motif : {1}). Tout le reste a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' supprim' + [char]0x00E9 + '. ' + [char]0x00C0 + ' la main : schtasks /Delete /TN "{0}" /F.') }
    'fr:ps.uninstall.phase.commands' { return 'Suppression de la commande jht, des fichiers de l''installeur et des lignes PATH...' }
    'fr:ps.uninstall.phase.data' { return 'Effacement de ~/.jht et de Documents\Job Hunter Team (--purge)...' }
    'fr:ps.uninstall.phase.machine' { return 'Suppression de la machine Podman <machine> (avec les secrets et les images de JHT)...' }
    'fr:ps.uninstall.phase.runtime' { return 'Suppression du runtime JHT...' }
    'fr:ps.uninstall.purge_notice' { return ('Avec --purge, ~/.jht et Documents\Job Hunter Team sont aussi effac' + [char]0x00E9 + 's : configuration, base de donn' + [char]0x00E9 + 'es, CV et r' + [char]0x00E9 + 'sultats. Pas de retour en arri' + [char]0x00E8 + 're.') }
    'fr:ps.uninstall.purge_removal_notice' { return ('Le mot de passe mail et les tokens Telegram enregistr' + [char]0x00E9 + 's sont aussi effac' + [char]0x00E9 + 's.') }
    'fr:ps.uninstall.removal_notice' { return ('Le mot de passe mail et les tokens Telegram enregistr' + [char]0x00E9 + 's sont aussi effac' + [char]0x00E9 + 's ; ~/.jht et Documents restent, et avec eux la session LinkedIn enregistr' + [char]0x00E9 + 'e (secrets/linkedin-profile et .cache/linkedin) : supprime-la avec jht reset --scope creds.') }
    'fr:ps.uninstall.secrets' { return ('Les secrets enregistr' + [char]0x00E9 + 's n''ont pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' supprim' + [char]0x00E9 + 's : le mot de passe mail et les tokens Telegram sont dans les volumes jht-secrets et jht-telegram-secrets de la machine <machine>, qui est toujours l' + [char]0x00E0 + '.') }
    'fr:ps.uninstall.wslconfig.done' { return ('Retir' + [char]0x00E9 + 'es de {0} : les lignes ajout' + [char]0x00E9 + 'es par l''installeur (m' + [char]0x00E9 + 'moire de WSL).') }
    'fr:ps.uninstall.wslconfig.kept' { return ('Laiss' + [char]0x00E9 + 'es dans {0} : les lignes que tu as modifi' + [char]0x00E9 + 'es, elles sont ' + [char]0x00E0 + ' toi.') }
    'fr:ps.uninstall.wslconfig.left' { return ('Non touch' + [char]0x00E9 + ' : {0} ({1}). Les lignes ajout' + [char]0x00E9 + 'es par l''installeur (m' + [char]0x00E9 + 'moire de WSL) restent. Retire-les ' + [char]0x00E0 + ' la main : chacune a une ligne de commentaire au-dessus.') }
    'fr:ps.unknown_argument' { return 'argument inconnu : %s' }
    'fr:ps.upgrade_already_running' { return ('Une mise ' + [char]0x00E0 + ' jour est d' + [char]0x00E9 + 'j' + [char]0x00E0 + ' en cours') }
    'fr:ps.upgrade_broker_restart_failed' { return ('broker_restart_failed: le broker des secrets n''a pas red' + [char]0x00E9 + 'marr' + [char]0x00E9 + '. Que faire : jht up') }
    'fr:ps.upgrade_disk_low' { return ('disk_low: Les agents ont besoin d''au moins %s Gio de disque ' + [char]0x2014 + ' disponibles : %s Gio. Pour lib' + [char]0x00E9 + 'rer de l''espace, vide la Corbeille et supprime les gros fichiers dont tu n''as pas besoin ainsi que les images Docker inutilis' + [char]0x00E9 + 'es, puis r' + [char]0x00E9 + 'essaie : rien n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charg' + [char]0x00E9 + ' ni modifi' + [char]0x00E9 + '.') }
    'fr:ps.upgrade_docker_unavailable' { return ('Docker ou runtime h' + [char]0x00F4 + 'te indisponible') }
    'fr:ps.upgrade_helper_install_failed' { return ('helper_install_failed: les nouveaux scripts de l''h' + [char]0x00F4 + 'te sont r' + [char]0x00E9 + 'cup' + [char]0x00E9 + 'r' + [char]0x00E9 + 's ' + [char]0x00E0 + ' la premi' + [char]0x00E8 + 're demande ou avec un autre ''jht upgrade''') }
    'fr:ps.upgrade_host_runtime_not_installable' { return ('Runtime h' + [char]0x00F4 + 'te prot' + [char]0x00E9 + 'g' + [char]0x00E9 + ' impossible ' + [char]0x00E0 + ' installer') }
    'fr:ps.upgrade_host_runtime_untrusted' { return ('Runtime h' + [char]0x00F4 + 'te non fiable') }
    'fr:ps.upgrade_image_download_failed' { return ('Le t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement de l''image a ' + [char]0x00E9 + 'chou' + [char]0x00E9) }
    'fr:ps.upgrade_journal_not_updated' { return ('Impossible de mettre ' + [char]0x00E0 + ' jour le journal') }
    'fr:ps.upgrade_metadata_not_persisted' { return ('M' + [char]0x00E9 + 'tadonn' + [char]0x00E9 + 'es du runtime non enregistr' + [char]0x00E9 + 'es') }
    'fr:ps.upgrade_mounts_not_writable' { return ('Les dossiers de Job Hunter Team ne sont pas accessibles en ' + [char]0x00E9 + 'criture depuis le conteneur (mount_repair_failed)') }
    'fr:ps.upgrade_not_completed' { return ('Mise ' + [char]0x00E0 + ' jour non termin' + [char]0x00E9 + 'e (%s) : %s') }
    'fr:ps.upgrade_note_activate_runtime' { return 'Activation du nouveau runtime...' }
    'fr:ps.upgrade_note_download_image' { return ('T' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement de l''image la plus r' + [char]0x00E9 + 'cente...') }
    'fr:ps.upgrade_note_download_runtime' { return ('T' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement du runtime mis ' + [char]0x00E0 + ' jour...') }
    'fr:ps.upgrade_option_unsupported' { return 'Option d''upgrade non prise en charge' }
    'fr:ps.upgrade_pulling_full_image' { return ('Je t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge l''image compl' + [char]0x00E8 + 'te mise ' + [char]0x00E0 + ' jour...') }
    'fr:ps.upgrade_recovery_failed' { return ('La r' + [char]0x00E9 + 'cup' + [char]0x00E9 + 'ration de l''upgrade pr' + [char]0x00E9 + 'c' + [char]0x00E9 + 'dent a ' + [char]0x00E9 + 'chou' + [char]0x00E9) }
    'fr:ps.upgrade_release_core_invalid' { return ('La version ne contient pas de noyau valide pour cette installation : r' + [char]0x00E9 + 'installe') }
    'fr:ps.upgrade_remote_compose_invalid' { return 'Compose distant invalide' }
    'fr:ps.upgrade_remote_runtime_invalid' { return 'Runtime distant invalide ou injoignable' }
    'fr:ps.upgrade_rollback_not_prepared' { return ('Impossible de pr' + [char]0x00E9 + 'parer le rollback') }
    'fr:ps.upgrade_telegram_restart_failed' { return ('telegram_restart_failed: le service Telegram isol' + [char]0x00E9 + ' n''a pas red' + [char]0x00E9 + 'marr' + [char]0x00E9 + '. Que faire : jht up') }
    'fr:ps.upgrade_test_channel' { return ('Canal de test : la mise ' + [char]0x00E0 + ' jour se fait en r' + [char]0x00E9 + 'installant depuis la build de test') }
    'fr:ps.upgrade_unexpected_error' { return ('Erreur inattendue pendant la mise ' + [char]0x00E0 + ' jour') }
    'fr:ps.upgrade_verify_failed' { return ('Le nouveau runtime n''a pas r' + [char]0x00E9 + 'ussi la v' + [char]0x00E9 + 'rification') }
    'fr:ps.use_fresh_botfather_token' { return ('Utilise toujours un token tout juste g' + [char]0x00E9 + 'n' + [char]0x00E9 + 'r' + [char]0x00E9 + ' dans BotFather (/revoke sur le bot, ou un nouveau bot) : un token d' + [char]0x00E9 + 'j' + [char]0x00E0 + ' existant a pu ' + [char]0x00EA + 'tre lu par les agents m' + [char]0x00EA + 'me s''il n''appara' + [char]0x00EE + 't pas aujourd''hui dans ~/.jht.') }
    'fr:ps.user_dir_unavailable_cannot_create' { return ('user_dir_unavailable: impossible de cr' + [char]0x00E9 + 'er le dossier %s, que l''' + [char]0x00E9 + 'quipe utilise.') }
    'fr:ps.wsl_exe_not_found' { return 'wsl.exe introuvable' }
    'fr:ps.wsl_not_answering' { return ('WSL ne r' + [char]0x00E9 + 'pond pas (wsl --status)') }
    'fr:removed.office' { return ('''jht %s'' a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' retir' + [char]0x00E9 + ' dans la 0.4.0 avec le bureau Godot : utilise les commandes jht (jht help).') }
    'fr:status.no_options' { return '''jht status'' ne prend pas d''options (%s) : lance-le simplement ''jht status''.' }
    'fr:status.not_running' { return ('Le conteneur de l''' + [char]0x00E9 + 'quipe ne tourne pas.') }
    'fr:status.not_running_next' { return ('D' + [char]0x00E9 + 'marre-le avec : jht up') }
    'fr:team.stopped' { return ('Job Hunter Team est arr' + [char]0x00EA + 't' + [char]0x00E9 + ' : ''jht up'' le red' + [char]0x00E9 + 'marre.') }
    'fr:tools.arriving' { return ('Les outils des Scout arrivent : l''image compl' + [char]0x00E8 + 'te se t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge en arri' + [char]0x00E8 + 're-plan (environ 3 Go). La recherche d''offres d' + [char]0x00E9 + 'marre toute seule d' + [char]0x00E8 + 's qu''ils sont l' + [char]0x00E0 + ' ; tu n''as rien ' + [char]0x00E0 + ' faire.') }
    'fr:tools.chat_reconnecting' { return ('L''' + [char]0x00E9 + 'quipe passe aux outils complets des Scout, donc le chat s''arr' + [char]0x00EA + 'te un instant : il revient tout seul d' + [char]0x00E8 + 's que l''' + [char]0x00E9 + 'quipe tourne ' + [char]0x00E0 + ' nouveau (quelques minutes).') }
    'fr:tools.chat_resumed' { return ('L''' + [char]0x00E9 + 'quipe est pass' + [char]0x00E9 + 'e aux outils complets : reprenons.') }
    'fr:tools.chat_switched' { return ('L''' + [char]0x00E9 + 'quipe passe aux outils complets des Scout, donc ce chat s''est ferm' + [char]0x00E9 + '. Rouvre-le dans quelques minutes avec jht team chat.') }
    'fr:tools.chat_update_closed' { return ('JHT se met ' + [char]0x00E0 + ' jour, donc ce chat s''est ferm' + [char]0x00E9 + '. Rouvre-le dans quelques minutes avec jht team chat.') }
    'fr:tools.chat_update_resumed' { return ('JHT est ' + [char]0x00E0 + ' jour : reprenons.') }
    'fr:tools.chat_updating' { return ('JHT se met ' + [char]0x00E0 + ' jour, donc le chat s''arr' + [char]0x00EA + 'te un instant : il repart tout seul dans une minute ou deux.') }
    'fr:tools.disk_low' { return ('Les outils des Scout n''ont pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charg' + [char]0x00E9 + 's : il leur faut environ %s Gio libres sur le disque et il y en a %s, l''' + [char]0x00E9 + 'quipe ne peut donc pas encore chercher d''offres. Lib' + [char]0x00E8 + 're de l''espace (vide la Corbeille, supprime les gros fichiers dont tu n''as pas besoin), puis lance jht up : le t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement repart tout seul.') }
    'fr:tools.engine_down' { return ('L''' + [char]0x00E9 + 'tat des outils des Scout ne peut pas ' + [char]0x00EA + 'tre lu : le moteur de conteneurs ne r' + [char]0x00E9 + 'pond pas. D' + [char]0x00E9 + 'marre-le avec jht up.') }
    'fr:tools.failed' { return ('Le t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement des outils des Scout a ' + [char]0x00E9 + 'chou' + [char]0x00E9 + ' : l''' + [char]0x00E9 + 'quipe ne peut pas encore chercher d''offres. Lance jht tools pull pour r' + [char]0x00E9 + 'essayer (jht up r' + [char]0x00E9 + 'essaie aussi).') }
    'fr:tools.ready' { return ('Les outils des Scout sont l' + [char]0x00E0 + ' : l''' + [char]0x00E9 + 'quipe cherche avec l''image compl' + [char]0x00E8 + 'te.') }
    'fr:tools.switch_failed' { return ('Les outils des Scout sont l' + [char]0x00E0 + ', mais l''' + [char]0x00E9 + 'quipe n''a pas pu red' + [char]0x00E9 + 'marrer avec eux : lance jht down, puis jht up.') }
    'fr:tools.switch_wait' { return ('L''' + [char]0x00E9 + 'quipe passe aux outils complets des Scout : j''attends qu''elle red' + [char]0x00E9 + 'marre (quelques minutes au plus).') }
    'fr:tools.waiting' { return ('Les outils des Scout sont l' + [char]0x00E0 + ' : l''' + [char]0x00E9 + 'quipe passe dessus toute seule d' + [char]0x00E8 + 's que l''onboarding est termin' + [char]0x00E9 + '.') }
    'fr:uninstall.usage' { return 'usage : jht uninstall --confirm [--purge]' }
    'fr:up.done' { return ('Job Hunter Team d' + [char]0x00E9 + 'marr' + [char]0x00E9 + '.') }
    'pt:container.starting' { return ('O contentor ''%s'' n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' a correr, vou inici' + [char]0x00E1 + '-lo...') }
    'pt:doctor.host_config_none' { return ('ainda sem configura' + [char]0x00E7 + [char]0x00E3 + 'o: ''jht setup''') }
    'pt:doctor.host_config_ok' { return ('configura' + [char]0x00E7 + [char]0x00E3 + 'o presente') }
    'pt:doctor.host_engine_fail' { return ('motor de contentores inacess' + [char]0x00ED + 'vel') }
    'pt:doctor.host_engine_ok' { return ('motor de contentores acess' + [char]0x00ED + 'vel') }
    'pt:doctor.host_more' { return ('Para as verifica' + [char]0x00E7 + [char]0x00F5 + 'es completas (configura' + [char]0x00E7 + [char]0x00E3 + 'o, fornecedor, base de dados, agentes): ''jht up'' e depois ''jht doctor''.') }
    'pt:doctor.host_runtime_fail' { return ('runtime do JHT em falta ou alterado: ''jht upgrade'' volta a instal' + [char]0x00E1 + '-lo') }
    'pt:doctor.host_runtime_ok' { return 'runtime do JHT intacto' }
    'pt:doctor.host_team_off' { return 'equipa desligada: ''jht up'' liga-a' }
    'pt:doctor.host_team_unattestable' { return ('h' + [char]0x00E1 + ' um contentor da equipa, mas n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel verificar que ' + [char]0x00E9 + ' nosso: n' + [char]0x00E3 + 'o toquei em nada (''jht status'' diz mais)') }
    'pt:doctor.host_title' { return ('Job Hunter Team: a equipa est' + [char]0x00E1 + ' desligada (o seu contentor n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' a correr). Verifica' + [char]0x00E7 + [char]0x00F5 + 'es feitas a partir deste computador:') }
    'pt:down.done' { return 'Job Hunter Team parado.' }
    'pt:download.bad_version' { return ('vers' + [char]0x00E3 + 'o inv' + [char]0x00E1 + 'lida: %s. Exemplo: 0.3.5.') }
    'pt:download.deb_only_linux' { return ('--deb ' + [char]0x00E9 + ' s' + [char]0x00F3 + ' para Linux.') }
    'pt:download.dest_is_link' { return ('o destino ' + [char]0x00E9 + ' uma liga' + [char]0x00E7 + [char]0x00E3 + 'o: %s') }
    'pt:download.dest_not_file' { return ('o destino existe e n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' um ficheiro: %s') }
    'pt:download.fetching' { return 'A descarregar %s...' }
    'pt:download.hash_invalid' { return ('SHA-256 inv' + [char]0x00E1 + 'lido para %s: esperado %s, obtido %s.') }
    'pt:download.intel_mac' { return ('A app para macOS da 0.4 s' + [char]0x00F3 + ' corre em Macs com Apple silicon (M1 e posteriores); este ' + [char]0x00E9 + ' um Mac Intel, que a 0.4 n' + [char]0x00E3 + 'o suporta. N' + [char]0x00E3 + 'o foi descarregado nada.') }
    'pt:download.linux_no_app' { return ('Nesta vers' + [char]0x00E3 + 'o n' + [char]0x00E3 + 'o h' + [char]0x00E1 + ' app de ambiente de trabalho para Linux: usa install.sh. N' + [char]0x00E3 + 'o foi descarregado nada.') }
    'pt:download.mismatch_existing' { return ('o ficheiro %s existe, mas o seu SHA-256 n' + [char]0x00E3 + 'o corresponde: n' + [char]0x00E3 + 'o foi substitu' + [char]0x00ED + 'do.') }
    'pt:download.mkdir_failed' { return ('n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel criar a pasta de destino: %s') }
    'pt:download.present_verified' { return ('Ficheiro j' + [char]0x00E1 + ' presente e verificado: %s') }
    'pt:download.release_no_app' { return ('Esta vers' + [char]0x00E3 + 'o (v%s) n' + [char]0x00E3 + 'o tem app para macOS: usa a 0.4.0 ou posterior. N' + [char]0x00E3 + 'o foi descarregado nada.') }
    'pt:download.saved_in' { return 'Guardado em: %s' }
    'pt:download.sha_verified' { return 'SHA-256 verificado: %s' }
    'pt:download.sum_missing' { return 'nenhum SHA-256 declarado para %s.' }
    'pt:download.unsupported_os' { return ('sistema n' + [char]0x00E3 + 'o suportado: %s. Usa windows ou macos.') }
    'pt:download.windows_missing' { return ('O Windows n' + [char]0x00E3 + 'o faz parte da 0.4.0: a vers' + [char]0x00E3 + 'o n' + [char]0x00E3 + 'o tem instalador para Windows. N' + [char]0x00E3 + 'o foi descarregado nada.') }
    'pt:help.integration' { return (('Uso: jht integration <command>', '', ('  list [--json]                   as integra' + [char]0x00E7 + [char]0x00F5 + 'es e o seu estado'), '  status [ID] [--json]            o estado de uma, ou de todas', ('  add ID [--json]                 acrescenta uma integra' + [char]0x00E7 + [char]0x00E3 + 'o'), '  remove ID [--purge --yes] [--remove-image] [--json]', ('                                  remove-a; --purge apaga tamb' + [char]0x00E9 + 'm os seus dados (precisa de --yes);'), ('                                  --remove-image (s' + [char]0x00F3 + ' screen e media) remove tamb' + [char]0x00E9 + 'm a imagem das ferramentas'), '', ('Os ID admitidos s' + [char]0x00E3 + 'o os que `jht integration list` mostra. Nada ' + [char]0x00E9 + ' descarregado nem ligado'), ('at' + [char]0x00E9 + ' o pedires com `add`.')) -join [char]10) }
    'pt:help.linkedin' { return (('Uso: jht linkedin <command>', '', ('  login [--stop]    o acesso manual ao LinkedIn (com o Google): um browser num contentor ' + [char]0x00E0 + ' parte, sem rede, cuja'), ('                    janela v' + [char]0x00EA + 's e usas a partir da app; --stop fecha tudo'), ('  status --json     diz se o acesso est' + [char]0x00E1 + ' em curso e se a sess' + [char]0x00E3 + 'o do LinkedIn est' + [char]0x00E1 + ' guardada'), '', ('Nada ' + [char]0x00E9 + ' descarregado nem ligado at' + [char]0x00E9 + ' o pedires com `login`.')) -join [char]10) }
    'pt:help.screen' { return (('Uso: jht screen <command>', '', ('  on [--json]       liga o ecr' + [char]0x00E3 + ' ao vivo do closer: um contentor ' + [char]0x00E0 + ' parte, com o stream s' + [char]0x00F3 + ' em 127.0.0.1'), '  off [--remove-image] [--json]', '                    desliga-o e remove o contentor; a imagem das ferramentas fica no disco, para o voltares', ('                    a ligar sem a descarregar de novo: --remove-image remove-a e liberta o espa' + [char]0x00E7 + 'o'), ('  status [--json]   diz se est' + [char]0x00E1 + ' ligado'), '', ('Nada ' + [char]0x00E9 + ' descarregado nem ligado at' + [char]0x00E9 + ' o pedires com `on`. O stream ' + [char]0x00E9 + ' s' + [char]0x00F3 + ' de visualiza' + [char]0x00E7 + [char]0x00E3 + 'o.')) -join [char]10) }
    'pt:help.setup' { return ((('Uso: jht setup [op' + [char]0x00E7 + [char]0x00F5 + 'es]'), '', ('Sem op' + [char]0x00E7 + [char]0x00F5 + 'es arranca a instala' + [char]0x00E7 + [char]0x00E3 + 'o guiada. Com --non-interactive n' + [char]0x00E3 + 'o pergunta nada:'), ('tudo se d' + [char]0x00E1 + ' com as op' + [char]0x00E7 + [char]0x00F5 + 'es.'), '', '  --non-interactive            nenhuma pergunta', '  --provider <name>            glm (Z.ai, predefinido), kimi (Moonshot), openai ou claude (Anthropic)', '  --harness <name>             pi (predefinido)', ('  --api-key-file <path>        ficheiro que cont' + [char]0x00E9 + 'm a chave API (uma linha, leg' + [char]0x00ED + 'vel s' + [char]0x00F3 + ' por ti).'), ('                               O jht l' + [char]0x00EA + ' um ficheiro do teu computador e passa-o ao setup: com glm e kimi'), ('                               o setup guarda a chave por conta pr' + [char]0x00F3 + 'pria, nunca na configura' + [char]0x00E7 + [char]0x00E3 + 'o'), ('  --api-key-stdin              l' + [char]0x00EA + ' a chave API da entrada padr' + [char]0x00E3 + 'o (uma linha): nunca na linha de comandos'), ('  --api-key <key>              a chave escrita aqui, em claro (n' + [char]0x00E3 + 'o admitida para glm e kimi)'), '  --secret-mode <mode>         como se guarda a chave: plaintext (predefinido), env ou file', ('  --secret-env <name>          com --secret-mode env: a vari' + [char]0x00E1 + 'vel de ambiente que a cont' + [char]0x00E9 + 'm'), ('  --secret-file <path>         com --secret-mode file: o ficheiro que a cont' + [char]0x00E9 + 'm'), '  --model <model>              o modelo a usar', ('  --language <code>            a l' + [char]0x00ED + 'ngua (por exemplo pt ou en)'), ('  --budget-usd <d' + [char]0x00F3 + 'lares>       quanto a equipa pode gastar, em d' + [char]0x00F3 + 'lares (com uma de --budget-minutes, --budget-days, --budget-until)'), ('  --budget-minutes <n>         o or' + [char]0x00E7 + 'amento dura este n' + [char]0x00FA + 'mero de minutos a partir de agora'), ('  --budget-days <n>            o or' + [char]0x00E7 + 'amento dura este n' + [char]0x00FA + 'mero de dias a partir de agora'), ('  --budget-until <hora>        o or' + [char]0x00E7 + 'amento dura at' + [char]0x00E9 + ' esta hora do dia, 0-23 (a pr' + [char]0x00F3 + 'xima)'), ('  --no-budget                  sem limite de gasto (a equipa s' + [char]0x00F3 + ' para no cr' + [char]0x00E9 + 'dito do fornecedor)'), ('  --skip-health                salta a verifica' + [char]0x00E7 + [char]0x00E3 + 'o final'), ('  --reset                      recome' + [char]0x00E7 + 'a de uma configura' + [char]0x00E7 + [char]0x00E3 + 'o limpa'), '', 'Exemplos:', '  com uma chave GLM num ficheiro:', '    jht setup --non-interactive --provider glm --harness pi --api-key-file chave.txt', '  OpenAI com uma chave API, no Pi (para Claude: --provider claude):', '    jht setup --non-interactive --provider openai --harness pi --api-key-stdin') -join [char]10) }
    'pt:help.tools' { return (('Uso: jht tools <comando>', '', ('  status --json   se as ferramentas dos Scout (a imagem completa) j' + [char]0x00E1 + ' chegaram, est' + [char]0x00E3 + 'o a caminho ou falharam'), '  pull            descarrega-as em segundo plano (jht up e jht setup iniciam-no sozinhos)', ('  switch          passa a equipa para elas quando o onboarding estiver conclu' + [char]0x00ED + 'do (o descarregamento f' + [char]0x00E1 + '-lo sozinho)'), '', ('Esta ajuda n' + [char]0x00E3 + 'o inicia nada nem descarrega nada.')) -join [char]10) }
    'pt:host_setup.timezone_explain' { return ('O Capit' + [char]0x00E3 + 'o usa para converter hor' + [char]0x00E1 + 'rios nas mensagens do Telegram e nos gr' + [char]0x00E1 + 'ficos.') }
    'pt:host_setup.timezone_header' { return ('Fuso hor' + [char]0x00E1 + 'rio') }
    'pt:host_setup.timezone_label' { return ('Fuso hor' + [char]0x00E1 + 'rio') }
    'pt:host_setup.timezone_vps_utc' { return ('O fuso hor' + [char]0x00E1 + 'rio n' + [char]0x00E3 + 'o foi detetado: a equipa vai usar UTC. Define o teu com jht wh --tz Europe/Lisbon (ou no painel); caso contr' + [char]0x00E1 + 'rio, as horas do Telegram e o hor' + [char]0x00E1 + 'rio de trabalho ficam em UTC.') }
    'pt:host_setup.tz.bad_number' { return ('Escolhe um n' + [char]0x00FA + 'mero entre 1 e %d.') }
    'pt:host_setup.tz.how' { return ('Escreve um pa' + [char]0x00ED + 's, uma cidade ou um fuso hor' + [char]0x00E1 + 'rio (por exemplo Portugal, Lisboa, Europe/Lisbon).') }
    'pt:host_setup.tz.how_default' { return ('Prime Enter para manter %s, ou escreve um pa' + [char]0x00ED + 's, uma cidade ou um fuso hor' + [char]0x00E1 + 'rio para procurar outro.') }
    'pt:host_setup.tz.none' { return ('Nenhum fuso hor' + [char]0x00E1 + 'rio para ' + [char]0x00AB + '%s' + [char]0x00BB + ': escreve o pa' + [char]0x00ED + 's (por exemplo Portugal) ou uma cidade grande perto.') }
    'pt:host_setup.tz.not_detected' { return ('O teu fuso hor' + [char]0x00E1 + 'rio n' + [char]0x00E3 + 'o foi detetado.') }
    'pt:host_setup.tz.pick' { return ('N' + [char]0x00FA + 'mero (1-%d), ou uma nova pesquisa:') }
    'pt:host_setup.tz.proposed' { return 'Proposto: %s (agora %s).' }
    'pt:host_setup.tz.saved_and_detected' { return ('Guardado: %s (agora %s) ' + [char]0x00B7 + ' Detetado agora: %s (agora %s)') }
    'pt:host_setup.tz.too_many' { return ('%d fusos hor' + [char]0x00E1 + 'rios correspondem a ' + [char]0x00AB + '%s' + [char]0x00BB + ': escreve algo mais preciso (uma cidade, por exemplo).') }
    'pt:keyfile.both' { return ('usa --api-key-file ou --api-key-stdin, n' + [char]0x00E3 + 'o os dois') }
    'pt:keyfile.not_file' { return ('o ficheiro dado a --api-key-file tem de ser um ficheiro normal, n' + [char]0x00E3 + 'o uma pasta nem uma liga' + [char]0x00E7 + [char]0x00E3 + 'o: %s') }
    'pt:keyfile.shape' { return ('o conte' + [char]0x00FA + 'do do ficheiro dado a --api-key-file n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' uma linha de 16 a 512 caracteres imprim' + [char]0x00ED + 'veis sem espa' + [char]0x00E7 + 'os: %s') }
    'pt:keyfile.size' { return ('o ficheiro dado a --api-key-file est' + [char]0x00E1 + ' vazio ou ' + [char]0x00E9 + ' grande demais para uma chave (1 a 4096 bytes): %s') }
    'pt:keyfile.twice' { return '--api-key-file foi dado duas vezes' }
    'pt:keyfile.unreadable' { return ('o ficheiro dado a --api-key-file n' + [char]0x00E3 + 'o pode ser lido: %s') }
    'pt:line.abbinamento_annullato_nessuna_modifica' { return ('Emparelhamento cancelado: nenhuma altera' + [char]0x00E7 + [char]0x00E3 + 'o.') }
    'pt:line.abbinamento_di_s_non_riuscito' { return ('O emparelhamento de %s falhou: as c' + [char]0x00F3 + 'pias antigas ficam todas. Corre jht telegram pair --all de novo: as fun' + [char]0x00E7 + [char]0x00F5 + 'es j' + [char]0x00E1 + ' emparelhadas n' + [char]0x00E3 + 'o pedem outro token.') }
    'pt:line.abbinamento_rifiutato_genera_un_token' { return 'Emparelhamento recusado: gera um token novo no BotFather (/revoke) e tenta de novo.' }
    'pt:line.agent_restart_failed.inventario_conservato_ma_il_team' { return ('invent' + [char]0x00E1 + 'rio guardado, mas a equipa n' + [char]0x00E3 + 'o voltou a arrancar. O que fazer: jht up') }
    'pt:line.annullato_niente_autorizzato' { return 'Cancelado: nada autorizado.' }
    'pt:line.anteprima_non_valida_niente_autorizzato' { return ('Pr' + [char]0x00E9 + '-visualiza' + [char]0x00E7 + [char]0x00E3 + 'o inv' + [char]0x00E1 + 'lida: nada autorizado.') }
    'pt:line.apply.authorize' { return 'Autorizas esta candidatura?' }
    'pt:line.apply_relink_account_cloud_account' { return ('apply relink-account: conta cloud n' + [char]0x00E3 + 'o dispon' + [char]0x00ED + 'vel. Corre primeiro jht cloud pair.') }
    'pt:line.autorizzata_s_verso_s_il' { return ('Autorizada #%s, para %s: o CLOSER vai trat' + [char]0x00E1 + '-la na pr' + [char]0x00F3 + 'xima ronda.') }
    'pt:line.bot_abbinato_e_copia_legacy' { return ('Bot emparelhado e c' + [char]0x00F3 + 'pia antiga removida. Restam outros tokens antigos ou um token no ambiente do contentor: remove-os e conclui a rota' + [char]0x00E7 + [char]0x00E3 + 'o antes da transi' + [char]0x00E7 + [char]0x00E3 + 'o.') }
    'pt:line.bot_token_invalid.controlla_il_token_generato_da' { return 'verifica o token gerado pelo BotFather.' }
    'pt:line.broker_restart_failed.il_servizio_della_posta_non_4' { return ('o servi' + [char]0x00E7 + 'o de correio n' + [char]0x00E3 + 'o voltou a arrancar. O que fazer: jht mail status') }
    'pt:line.broker_start_failed.il_servizio_della_posta_non_2' { return ('o servi' + [char]0x00E7 + 'o de correio n' + [char]0x00E3 + 'o arrancou.') }
    'pt:line.broker_start_failed.il_servizio_della_posta_non_3' { return ('o servi' + [char]0x00E7 + 'o de correio n' + [char]0x00E3 + 'o responde ap' + [char]0x00F3 + 's 30 segundos.') }
    'pt:line.broker_unavailable.il_broker_dei_segreti_esiste' { return ('o broker dos segredos existe, mas n' + [char]0x00E3 + 'o pode ser atestado como nosso: n' + [char]0x00E3 + 'o lhe toco.') }
    'pt:line.broker_unavailable.il_runtime_installato_pi_vecchio_2' { return ('o runtime instalado ' + [char]0x00E9 + ' mais antigo e n' + [char]0x00E3 + 'o tem o broker dos segredos.') }
    'pt:line.broker_unavailable.il_servizio_della_posta_non' { return ('o servi' + [char]0x00E7 + 'o de correio ainda n' + [char]0x00E3 + 'o existe: ' + [char]0x00E9 + ' criado na primeira vez que for preciso.') }
    'pt:line.cancellato_marcatore_migrazione_broker_s' { return ('Apagado: marcador de migra' + [char]0x00E7 + [char]0x00E3 + 'o do broker %s') }
    'pt:line.cancellato_volume_broker_s_s' { return 'Apagado: volume do broker %s (%s)' }
    'pt:line.container_s_non_e_partito' { return ('O contentor ''%s'' n' + [char]0x00E3 + 'o arrancou em 10s. V' + [char]0x00EA + ' ''jht logs''.') }
    'pt:line.cosa_fare_jht_mail_setup' { return 'O que fazer: jht mail setup' }
    'pt:line.cosa_fare_jht_up_3' { return 'O que fazer: jht up' }
    'pt:line.cosa_fare_jht_upgrade_4' { return 'O que fazer: jht upgrade' }
    'pt:line.cosa_fare_riprova_il_comando_2' { return 'O que fazer: tenta o comando de novo' }
    'pt:line.fino_ad_allora_la_posta' { return ('At' + [char]0x00E9 + ' l' + [char]0x00E1 + ', o correio l' + [char]0x00EA + '-se e envia-se com a palavra-passe atual; o aviso fica em jht mail status.') }
    'pt:line.genera_una_nuova_password_per' { return ('gera uma nova palavra-passe de aplica' + [char]0x00E7 + [char]0x00E3 + 'o no teu fornecedor e guarda-a com: jht mail setup') }
    'pt:line.i_segreti_e_lo_stato' { return ('Os segredos e o estado do broker foram apagados: volta a iniciar sess' + [char]0x00E3 + 'o nos portais e configura o correio de novo.') }
    'pt:line.il_broker_non_ha_registrato' { return ('O broker n' + [char]0x00E3 + 'o registou a autoriza' + [char]0x00E7 + [char]0x00E3 + 'o: retirada, nada vai partir.') }
    'pt:line.integration.install_hint' { return 'para os instalar: ''jht upgrade'' (ou um ''jht integration add <id>'')' }
    'pt:line.interattivo_il_token_viene_chiesto' { return ('Interativo: o token ' + [char]0x00E9 + ' pedido sem eco e depois o bot novo recebe um c' + [char]0x00F3 + 'digo de utiliza' + [char]0x00E7 + [char]0x00E3 + 'o ' + [char]0x00FA + 'nica do teu Telegram. Automatiza' + [char]0x00E7 + [char]0x00F5 + 'es: {"bot_token": ...} como JSON no stdin; n' + [char]0x00E3 + 'o guardes o token em ~/.jht e apaga logo qualquer ficheiro usado fora dali.') }
    'pt:line.jht_telegram_pair_all_interattivo' { return ('jht telegram pair --all ' + [char]0x00E9 + ' interativo: para as automatiza' + [char]0x00E7 + [char]0x00F5 + 'es emparelha uma fun' + [char]0x00E7 + [char]0x00E3 + 'o de cada vez.') }
    'pt:line.job_hunter_team_non_installato' { return ('O Job Hunter Team n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' totalmente instalado: na pasta do runtime falta o ficheiro de integridade (uma instala' + [char]0x00E7 + [char]0x00E3 + 'o interrompida?). Corre o instalador de novo.') }
    'pt:line.la_casella_di_posta_ora' { return ('A caixa de correio est' + [char]0x00E1 + ' agora no broker dos segredos. A palavra-passe dela podia ser lida pelos agentes:') }
    'pt:line.legacy_cleanup_failed.i_token_nuovi_sono_al' { return ('os tokens novos est' + [char]0x00E3 + 'o seguros, mas a c' + [char]0x00F3 + 'pia antiga de %s ainda est' + [char]0x00E1 + ' em ~/.jht; transi' + [char]0x00E7 + [char]0x00E3 + 'o recusada.') }
    'pt:line.legacy_inventory_failed.il_team_resta_fermo_perch_4' { return ('a equipa fica parada porque o invent' + [char]0x00E1 + 'rio do Telegram do anfitri' + [char]0x00E3 + 'o n' + [char]0x00E3 + 'o foi guardado.') }
    'pt:line.legacy_inventory_failed.le_impronte_non_sono_state' { return ('as impress' + [char]0x00F5 + 'es digitais n' + [char]0x00E3 + 'o foram guardadas pelo servi' + [char]0x00E7 + 'o isolado.') }
    'pt:line.legacy_inventory_failed.migrazione_telegram_interrotta' { return ('migra' + [char]0x00E7 + [char]0x00E3 + 'o do Telegram interrompida.') }
    'pt:line.legacy_inventory_failed.non_posso_provare_che_jht' { return ('n' + [char]0x00E3 + 'o posso provar que ~/.jht n' + [char]0x00E3 + 'o tem tokens do Telegram.') }
    'pt:line.legacy_inventory_failed.non_riesco_a_fermare_gli' { return ('n' + [char]0x00E3 + 'o consigo parar os agentes antes do invent' + [char]0x00E1 + 'rio do anfitri' + [char]0x00E3 + 'o.') }
    'pt:line.legacy_inventory_failed.non_riesco_a_leggere_i' { return ('n' + [char]0x00E3 + 'o consigo ler os tokens antigos em ~/.jht.') }
    'pt:line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti' { return ('fun' + [char]0x00E7 + [char]0x00F5 + 'es antigas n' + [char]0x00E3 + 'o reconhecidas.') }
    'pt:line.legacy_remove_failed.s_nel_broker_ma_la' { return ('%s est' + [char]0x00E1 + ' no broker, mas a c' + [char]0x00F3 + 'pia em ~/.jht/credentials ficou.') }
    'pt:line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso' { return ('~/.jht/credentials/%s.json reapareceu depois da migra' + [char]0x00E7 + [char]0x00E3 + 'o; removido sem o importar.') }
    'pt:line.mail.address_prompt' { return ('Endere' + [char]0x00E7 + 'o da caixa de correio:') }
    'pt:line.mail.app_password_prompt' { return ('Palavra-passe de aplica' + [char]0x00E7 + [char]0x00E3 + 'o (n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' mostrada):') }
    'pt:line.mail.dedicated_prompt' { return ('' + [char]0x00C9 + ' uma caixa DEDICADA aos alertas de emprego reencaminhados?') }
    'pt:line.mail_setup_opzione_sconosciuta_s' { return ('mail setup: op' + [char]0x00E7 + [char]0x00E3 + 'o desconhecida %s') }
    'pt:line.mail_setup_password_vuota' { return 'mail setup: palavra-passe vazia' }
    'pt:line.nessun_provider_attivo_scegline_uno' { return 'nenhum fornecedor ativo: escolhe um com ''jht providers use glm''' }
    'pt:line.nessun_ruolo_ha_un_token' { return ('Nenhuma fun' + [char]0x00E7 + [char]0x00E3 + 'o tem um token antigo: para um bot novo usa jht telegram pair <fun' + [char]0x00E7 + [char]0x00E3 + 'o>.') }
    'pt:line.non_autorizzabile_s' { return ('N' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel autorizar: %s.') }
    'pt:line.non_autorizzata_s' { return ('N' + [char]0x00E3 + 'o autorizada: %s.') }
    'pt:line.os_and_version_are_required' { return ('--os e --version s' + [char]0x00E3 + 'o obrigat' + [char]0x00F3 + 'rios') }
    'pt:line.podman_non_trovato_reinstalla_il' { return ('Podman n' + [char]0x00E3 + 'o encontrado: reinstala o runtime do JHT.') }
    'pt:line.preparo_il_servizio_della_posta' { return ('A preparar o servi' + [char]0x00E7 + 'o de correio (s' + [char]0x00F3 + ' ' + [char]0x00E9 + ' criado na primeira vez que for preciso)' + [char]0x2026) }
    'pt:line.provider_attivo_non_riconosciuto_s' { return ('fornecedor ativo n' + [char]0x00E3 + 'o reconhecido: %s') }
    'pt:line.reset_impossibile_cancellare_il_marcatore' { return ('reset: n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel apagar o marcador de migra' + [char]0x00E7 + [char]0x00E3 + 'o do broker %s.') }
    'pt:line.reset_impossibile_cancellare_il_marcatore_2' { return ('reset: n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel apagar o marcador do broker %s.') }
    'pt:line.reset_impossibile_cancellare_il_volume' { return ('reset: n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel apagar o volume do broker %s (%s).') }
    'pt:line.reset_nome_volume_non_valido' { return ('reset: nome de volume inv' + [char]0x00E1 + 'lido para %s; remo' + [char]0x00E7 + [char]0x00E3 + 'o recusada.') }
    'pt:line.reset_non_riesco_a_determinare' { return ('reset: n' + [char]0x00E3 + 'o consigo determinar o projeto Compose; os volumes do broker n' + [char]0x00E3 + 'o foram tocados.') }
    'pt:line.reset_non_riesco_a_fermare' { return ('reset: n' + [char]0x00E3 + 'o consigo parar o runtime; os volumes do broker n' + [char]0x00E3 + 'o foram tocados.') }
    'pt:line.reset_ricerca_del_volume_s_2' { return 'reset: a procura do volume %s falhou.' }
    'pt:line.restano_token_legacy_per_s' { return ('Restam tokens antigos para: %s. Enquanto n' + [char]0x00E3 + 'o emparelhares tamb' + [char]0x00E9 + 'm estas fun' + [char]0x00E7 + [char]0x00F5 + 'es, %s fica calado no Telegram: emparelha-as todas nesta sess' + [char]0x00E3 + 'o (jht telegram pair --all).') }
    'pt:line.risposta_del_container_non_valida' { return ('Resposta do contentor inv' + [char]0x00E1 + 'lida: autoriza' + [char]0x00E7 + [char]0x00E3 + 'o retirada, nada vai partir.') }
    'pt:line.ritirata_s_non_verra_inviata' { return ('Retirada #%s: n' + [char]0x00E3 + 'o vai ser enviada.') }
    'pt:line.ritiro_non_riuscito_s' { return 'A retirada falhou: %s.' }
    'pt:line.runtime_migration_docker_missing.il_client_docker_originale_non' { return ('o cliente Docker original n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' dispon' + [char]0x00ED + 'vel.') }
    'pt:line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata' { return ('' + [char]0x00E9 + ' precisa a imagem do JHT fixada por digest.') }
    'pt:line.runtime_migration_podman_missing.podman_non_e_disponibile' { return ('O Podman n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' dispon' + [char]0x00ED + 'vel.') }
    'pt:line.runtime_migration_team_running.ferma_prima_il_team_docker' { return 'para primeiro a equipa no Docker.' }
    'pt:line.runtime_migration_team_running.ferma_prima_il_team_podman' { return 'para primeiro a equipa no Podman.' }
    'pt:line.runtime_o_container_jht_non' { return ('runtime ou contentor do JHT n' + [char]0x00E3 + 'o dispon' + [char]0x00ED + 'vel') }
    'pt:line.ruoli_da_abbinare_in_questa' { return ('Fun' + [char]0x00E7 + [char]0x00F5 + 'es a emparelhar nesta sess' + [char]0x00E3 + 'o: %s') }
    'pt:line.s_ha_gi_un_bot' { return ('%s j' + [char]0x00E1 + ' tem um bot emparelhado: s' + [char]0x00F3 + ' removo a sua c' + [char]0x00F3 + 'pia antiga.') }
    'pt:line.s_needs_a_value' { return '%s precisa de um valor' }
    'pt:line.saltato_non_trovato_volume_broker' { return ('Saltado (n' + [char]0x00E3 + 'o encontrado): volume do broker %s') }
    'pt:line.serve_un_terminale_l_autorizzazione' { return ('' + [char]0x00C9 + ' preciso um terminal: a autoriza' + [char]0x00E7 + [char]0x00E3 + 'o confirma-se ' + [char]0x00E0 + ' m' + [char]0x00E3 + 'o.') }
    'pt:line.telegram_isolato_attivo_il_bridge' { return ('Telegram isolado ativo; a bridge antiga j' + [char]0x00E1 + ' n' + [char]0x00E3 + 'o pode ser reativada pelos agentes.') }
    'pt:line.the_setup_keeps_the_key' { return ('A configura' + [char]0x00E7 + [char]0x00E3 + 'o guarda a chave: podes apagar j' + [char]0x00E1 + ' o ficheiro neste computador (%s).') }
    'pt:line.upgrade.done' { return ('Atualiza' + [char]0x00E7 + [char]0x00E3 + 'o conclu' + [char]0x00ED + 'da: %s (%s) -> %s (%s). %s') }
    'pt:line.upgrade.restored' { return 'Runtime anterior reposto.' }
    'pt:line.uso_jht_apply_relink_account' { return 'uso: jht apply relink-account' }
    'pt:line.uso_jht_apply_request_cancel_2' { return 'uso: jht apply request|cancel <id>' }
    'pt:line.uso_jht_mail_setup_status' { return ('uso: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <endere' + [char]0x00E7 + 'o|@dom' + [char]0x00ED + 'nio>|drafts|approve <id>|discard <id>|journal|delete|migrate') }
    'pt:line.uso_jht_migrate_runtime_podman' { return 'uso: jht migrate-runtime podman' }
    'pt:line.uso_jht_screen_on_off' { return 'uso: jht screen on | off | status [--json]' }
    'pt:line.uso_jht_telegram_chat_id' { return 'uso: jht telegram chat-id <assistente|capitano|mentor>' }
    'pt:line.uso_jht_telegram_pair_assistente' { return 'uso: jht telegram pair <assistente|capitano|mentor>|--all' }
    'pt:line.uso_jht_telegram_remove_assistente' { return 'uso: jht telegram remove <assistente|capitano|mentor>' }
    'pt:line.uso_jht_telegram_status_pair' { return ('uso: jht telegram status|pair <fun' + [char]0x00E7 + [char]0x00E3 + 'o>|pair --all|chat-id <fun' + [char]0x00E7 + [char]0x00E3 + 'o>|remove <fun' + [char]0x00E7 + [char]0x00E3 + 'o>') }
    'pt:monitor.window_invalid' { return ('monitor_window_invalid: usa ''jht monitor --window'' sem outras op' + [char]0x00E7 + [char]0x00F5 + 'es.') }
    'pt:ps.apply_auto_send_warning_1' { return ('  Com o envio autom' + [char]0x00E1 + 'tico ligado, a equipa preenche e ENVIA a candidatura,') }
    'pt:ps.apply_auto_send_warning_2' { return ('  sem outra confirma' + [char]0x00E7 + [char]0x00E3 + 'o. Depois de enviada, n' + [char]0x00E3 + 'o se pode retirar.') }
    'pt:ps.artifact_copied' { return ('Copiei %s para %s para que a equipa possa l' + [char]0x00EA + '-lo.') }
    'pt:ps.artifact_copy_failed' { return ('n' + [char]0x00E3 + 'o consigo copiar %s para a pasta partilhada: %s') }
    'pt:ps.artifact_copy_refused' { return ('n' + [char]0x00E3 + 'o copio %s: %s ' + [char]0x00E9 + ' uma liga' + [char]0x00E7 + [char]0x00E3 + 'o ou n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' dentro da pasta partilhada') }
    'pt:ps.bot_token_prompt_hidden' { return 'Token do bot %s (entrada oculta)' }
    'pt:ps.botfather_fresh_token' { return ('Usa sempre um token acabado de gerar no BotFather (/revoke no bot, ou um bot novo): um token j' + [char]0x00E1 + ' existente pode ter sido lido pelos agentes, mesmo que hoje j' + [char]0x00E1 + ' n' + [char]0x00E3 + 'o apare' + [char]0x00E7 + 'a em ~/.jht.') }
    'pt:ps.broker_network_proxy_not_ready' { return ('broker_network_unavailable: o proxy de correio n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' pronto (c' + [char]0x00F3 + 'digo %s).') }
    'pt:ps.broker_network_scripts_not_downloadable' { return ('broker_network_unavailable: n' + [char]0x00E3 + 'o consigo descarregar os scripts do proxy de correio. O que fazer: jht upgrade') }
    'pt:ps.broker_network_scripts_not_verified' { return ('broker_network_unavailable: os scripts do proxy de correio n' + [char]0x00E3 + 'o podem ser atestados. O que fazer: jht upgrade') }
    'pt:ps.broker_restart_failed_secrets_broker_not_ours' { return ('broker_restart_failed: o broker dos segredos n' + [char]0x00E3 + 'o pode ser atestado como nosso: n' + [char]0x00E3 + 'o lhe toco. O que fazer: jht mail status') }
    'pt:ps.broker_unavailable_secrets_broker_not_running' { return ('broker_unavailable: o broker dos segredos n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' ativo.') }
    'pt:ps.cli_version_needs_container' { return ('Para a vers' + [char]0x00E3 + 'o do CLI em execu' + [char]0x00E7 + [char]0x00E3 + 'o ' + [char]0x00E9 + ' preciso o contentor ativo: ''jht up''.') }
    'pt:ps.compose_up_failed_team_not_started' { return ('compose_up_failed: a equipa n' + [char]0x00E3 + 'o arrancou (docker compose up, c' + [char]0x00F3 + 'digo %s). V' + [char]0x00EA + ' ''jht logs''.') }
    'pt:ps.container_not_running' { return ('o contentor ''%s'' n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' ativo') }
    'pt:ps.container_runtime_unsupported' { return ('runtime de contentores n' + [char]0x00E3 + 'o suportado: %s') }
    'pt:ps.docker_desktop_file_sharing_hint' { return ('  O que fazer: abre o Docker Desktop > Settings > Resources > File sharing, verifica se a pasta do utilizador est' + [char]0x00E1 + ' partilhada e corre ''jht up'' de novo.') }
    'pt:ps.docker_podman_verified_future_removal' { return ('Migra' + [char]0x00E7 + [char]0x00E3 + 'o Docker -> Podman verificada. Os volumes do Docker ficam intactos e ainda cont' + [char]0x00EA + 'm as palavras-passe do correio, os acessos aos portais e os tokens do Telegram: a remo' + [char]0x00E7 + [char]0x00E3 + 'o exigir' + [char]0x00E1 + ' no futuro uma confirma' + [char]0x00E7 + [char]0x00E3 + 'o expl' + [char]0x00ED + 'cita.') }
    'pt:ps.doctor.wsl_memory' { return ('O WSL n' + [char]0x00E3 + 'o tem limite de mem' + [char]0x00F3 + 'ria (h' + [char]0x00E1 + ' outras distribui' + [char]0x00E7 + [char]0x00F5 + 'es WSL registadas): em %s, em [wsl2], acrescenta memory=%s') }
    'pt:ps.download_asset_failed_detail' { return 'o descarregamento falhou: %s (%s)' }
    'pt:ps.download_shared_folder_no_path' { return ('o destino est' + [char]0x00E1 + ' dentro de uma pasta partilhada com a equipa: escolhe uma fora dela, como Downloads.') }
    'pt:ps.download_sums_failed_detail' { return 'o descarregamento falhou: SHA256SUMS de v%s (%s)' }
    'pt:ps.full_pull_failed_keep_old' { return ('full_pull_failed: a imagem completa nova n' + [char]0x00E3 + 'o chegou, fica a antiga. O que fazer: jht tools pull') }
    'pt:ps.help.main' { return (('jht - Job Hunter Team', '', ('  Comandos do anfitri' + [char]0x00E3 + 'o (funcionam a partir daqui):'), '    jht up                 inicia o contentor da equipa', '    jht down               para-o', ('                           (com --verbose v' + [char]0x00EA + 's tamb' + [char]0x00E9 + 'm as linhas do motor)'), '    jht restart            reinicia-o', '    jht status             estado do contentor e da equipa', '    jht logs [-f]          registos do contentor', '    jht upgrade            atualiza para a imagem mais recente', ('    jht setup              instala' + [char]0x00E7 + [char]0x00E3 + 'o guiada'), '    jht shell              shell dentro do contentor', '    jht mail setup         guarda a caixa de correio no broker dos segredos', ('    jht mail drafts        emails escritos pelos agentes ' + [char]0x00E0 + ' espera do teu ok'), '    jht mail approve <id>  envia-os; jht mail discard <id> descarta-os', '    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]', ('                           as integra' + [char]0x00E7 + [char]0x00F5 + 'es que se acrescentam depois do setup'), '                           (google, telegram, mail): estado lido no motor', ('    jht telegram status    estado do servi' + [char]0x00E7 + 'o Telegram isolado'), ('    jht telegram pair ROLE pede o token sem eco no computador anfitri' + [char]0x00E3 + 'o, depois'), ('                           mostra um c' + [char]0x00F3 + 'digo para enviares ao bot a partir do teu Telegram'), ('                           Para automa' + [char]0x00E7 + [char]0x00F5 + 'es: JSON no stdin. N' + [char]0x00E3 + 'o guardes o token'), ('                           em ~/.jht; apaga logo os ficheiros usados fora de l' + [char]0x00E1 + '.'), ('    jht telegram pair --all associa numa s' + [char]0x00F3 + ' sess' + [char]0x00E3 + 'o todas as fun' + [char]0x00E7 + [char]0x00F5 + 'es legacy'), ('    jht telegram chat-id ROLE muda o bot para outro chat, com o mesmo c' + [char]0x00F3 + 'digo'), ('    jht reset              apaga a configura' + [char]0x00E7 + [char]0x00E3 + 'o e os volumes do broker'), '    jht migrate-runtime podman', '                           copia e verifica os volumes do Docker no Podman;', ('                           n' + [char]0x00E3 + 'o seleciona o novo runtime e n' + [char]0x00E3 + 'o apaga o Docker'), ('    jht uninstall --confirm remove o runtime local do Windows, mas mant' + [char]0x00E9 + 'm dados,'), '                           documentos, Podman e Compose', '', '  Todos os outros comandos (positions, stats, team, providers, cron,', '  working-hours, cloud...) correm DENTRO do contentor: para a sua ajuda', ('  ' + [char]0x00E9 + ' preciso o contentor ativo.'), '', '      jht up ; jht --help') -join [char]10) }
    'pt:ps.home_unavailable_bind_mount' { return ('HOME/USERPROFILE n' + [char]0x00E3 + 'o dispon' + [char]0x00ED + 'vel: bind mount do JHT recusado') }
    'pt:ps.host_download_failed' { return ('o descarregamento no anfitri' + [char]0x00E3 + 'o falhou: %s') }
    'pt:ps.input_not_json_bot_token_stdin' { return 'input_not_json: passa bot_token como JSON no stdin.' }
    'pt:ps.integration_not_installed' { return ('n' + [char]0x00E3 + 'o instalado') }
    'pt:ps.integration_not_installed_yet' { return ('ainda n' + [char]0x00E3 + 'o instalado') }
    'pt:ps.jht_container_not_verifiable' { return ('O contentor do JHT n' + [char]0x00E3 + 'o pode ser atestado.') }
    'pt:ps.jht_home_missing' { return ('O Job Hunter Team ainda n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' instalado: a pasta %s n' + [char]0x00E3 + 'o existe. Corre o instalador e depois ''jht setup''.') }
    'pt:ps.legacy_cleanup_failed_old_token_still_there' { return ('legacy_cleanup_failed: o token antigo ainda est' + [char]0x00E1 + ' em ~/.jht; transi' + [char]0x00E7 + [char]0x00E3 + 'o recusada.') }
    'pt:ps.legacy_migration_failed_stays' { return 'legacy_migration_failed: %s fica em ~/.jht/credentials.' }
    'pt:ps.lifecycle.restarted' { return 'Job Hunter Team reiniciado.' }
    'pt:ps.link_or_not_folder' { return ('liga' + [char]0x00E7 + [char]0x00E3 + 'o ou n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' uma pasta') }
    'pt:ps.localappdata_unavailable' { return ('LOCALAPPDATA n' + [char]0x00E3 + 'o dispon' + [char]0x00ED + 'vel: runtime do anfitri' + [char]0x00E3 + 'o recusado') }
    'pt:ps.machine_space_back_on_stop' { return ('Cerca de %s GB libertados na m' + [char]0x00E1 + 'quina do JHT voltam ao Windows quando a m' + [char]0x00E1 + 'quina para: depois de jht down, com podman machine stop %s, ou ao reiniciar o computador.') }
    'pt:ps.machine_space_not_returned' { return ('O JHT ocupa cerca de %s GB no seu disco virtual; s' + [char]0x00E3 + 'o libertados por completo com jht uninstall.') }
    'pt:ps.machine_state_unreadable' { return ('o estado da m' + [char]0x00E1 + 'quina n' + [char]0x00E3 + 'o se consegue ler (o podman e o wsl n' + [char]0x00E3 + 'o respondem)') }
    'pt:ps.monitor_window_unavailable' { return ('monitor_window_unavailable: n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel abrir uma janela de terminal aqui. Corre ''jht monitor'' no terminal atual.') }
    'pt:ps.mount_repair_failed_folders_not_writable' { return ('mount_repair_failed: as pastas do Job Hunter Team (%s, %s) n' + [char]0x00E3 + 'o s' + [char]0x00E3 + 'o grav' + [char]0x00E1 + 'veis pelo contentor e n' + [char]0x00E3 + 'o foi poss' + [char]0x00ED + 'vel arranj' + [char]0x00E1 + '-las.') }
    'pt:ps.old_images_busy' { return ' Em uso por um contentor (mantidas): %s.' }
    'pt:ps.old_images_kept_all' { return 'Imagens do JHT antigas: mantidas todas (JHT_KEEP_OLD_IMAGES=1).' }
    'pt:ps.old_images_refused' { return ' Recusadas pelo motor (mantidas): %s.' }
    'pt:ps.old_images_removed' { return ('Imagens do JHT antigas: removidas %s, libertados cerca de %s MB (tamanho nominal: as camadas partilhadas s' + [char]0x00F3 + ' s' + [char]0x00E3 + 'o libertadas em parte), mantidas: a atual e a anterior.') }
    'pt:ps.pair_role_now_prompt' { return 'Emparelhar %s agora? [s/N]' }
    'pt:ps.podman_exe_not_found' { return ('podman.exe n' + [char]0x00E3 + 'o encontrado') }
    'pt:ps.podman_machine_not_responding' { return ('A m' + [char]0x00E1 + 'quina Podman do JHT n' + [char]0x00E3 + 'o responde. Corre ''jht up''.') }
    'pt:ps.release_arrived_without_https' { return 'a release chegou sem HTTPS: %s' }
    'pt:ps.relink_account_container_not_running' { return ('apply relink-account: o contentor n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' a correr.') }
    'pt:ps.script_integration_not_installed' { return ('o script jht-integration.ps1 ainda n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' instalado: ''jht upgrade'' (ou um ''jht integration add/remove'') e tenta de novo') }
    'pt:ps.script_tools_not_installed' { return ('o script jht-tools.ps1 ainda n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' instalado: ''jht upgrade'' e tenta de novo') }
    'pt:ps.startup_task_still_registered' { return 'a tarefa continua registada' }
    'pt:ps.team_container_unavailable' { return 'team_container_unavailable: inicia a equipa com jht up e tenta de novo.' }
    'pt:ps.telegram_not_configured' { return ('Telegram n' + [char]0x00E3 + 'o ativo: o Telegram n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' configurado.') }
    'pt:ps.telegram_status_unverifiable' { return ('Telegram: estado n' + [char]0x00E3 + 'o verific' + [char]0x00E1 + 'vel neste momento (servi' + [char]0x00E7 + 'o parado ou inacess' + [char]0x00ED + 'vel). Detalhes: jht telegram status') }
    'pt:ps.telegram_unavailable_isolated_not_running' { return ('telegram_unavailable: o servi' + [char]0x00E7 + 'o Telegram isolado n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' ativo.') }
    'pt:ps.telegram_unavailable_run_jht_up' { return 'telegram_unavailable: executa jht up' }
    'pt:ps.uninstall.bad.target' { return ('Recusado: {0} ' + [char]0x00E9 + ' uma liga' + [char]0x00E7 + [char]0x00E3 + 'o ou n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' uma pasta: n' + [char]0x00E3 + 'o o sigo nem o apago.') }
    'pt:ps.uninstall.done' { return ('Feito: a m' + [char]0x00E1 + 'quina <machine> (e com ela as imagens do JHT, o n' + [char]0x00FA + 'cleo e a completa), o runtime e o comando jht foram removidos.') }
    'pt:ps.uninstall.done.kept' { return (' ~/.jht e Documents\Job Hunter Team ficam (com --purge s' + [char]0x00E3 + 'o apagados).') }
    'pt:ps.uninstall.done.wsl' { return ('O WSL fica na mem' + [char]0x00F3 + 'ria: vmmem, wslservice e wslrelay s' + [char]0x00E3 + 'o componentes do Windows (n' + [char]0x00E3 + 'o foi o Job Hunter Team que os instalou) e as outras m' + [char]0x00E1 + 'quinas WSL deste utilizador tamb' + [char]0x00E9 + 'm precisam deles; normalmente param sozinhos ao fim de algum tempo de inatividade. Para os parar j' + [char]0x00E1 + ': wsl --shutdown (para TODAS as m' + [char]0x00E1 + 'quinas WSL abertas).') }
    'pt:ps.uninstall.kept.machine' { return ('A m' + [char]0x00E1 + 'quina Podman {0} n' + [char]0x00E3 + 'o consta como criada pelo instalador: fica onde est' + [char]0x00E1 + '. ' + [char]0x00C0 + ' m' + [char]0x00E3 + 'o, se ' + [char]0x00E9 + ' tua e a queres remover: podman machine stop {0}; podman machine rm {0}.') }
    'pt:ps.uninstall.left.commands' { return ('N' + [char]0x00E3 + 'o removidos: o comando jht ou os ficheiros do instalador em {0} ({1}), ou as vari' + [char]0x00E1 + 'veis e as linhas do PATH adicionadas pelo instalador. ' + [char]0x00C0 + ' m' + [char]0x00E3 + 'o: Remove-Item no ficheiro; as vari' + [char]0x00E1 + 'veis JHT_CONTAINER_RUNTIME e JHT_PODMAN_MACHINE e a pasta {0} no PATH em Defini' + [char]0x00E7 + [char]0x00F5 + 'es > Vari' + [char]0x00E1 + 'veis de ambiente.') }
    'pt:ps.uninstall.left.data' { return ('Os dados do JHT n' + [char]0x00E3 + 'o foram apagados ({0}). ' + [char]0x00C0 + ' m' + [char]0x00E3 + 'o: Remove-Item -Recurse -Force {1}. O comando jht e o runtime continuam l' + [char]0x00E1 + ': corre jht uninstall --confirm --purge de novo depois de resolveres isso.') }
    'pt:ps.uninstall.left.machine' { return ('N' + [char]0x00E3 + 'o removida: a m' + [char]0x00E1 + 'quina Podman <machine>. Motivo: {0}. ' + [char]0x00C0 + ' m' + [char]0x00E3 + 'o: podman machine stop <machine>; wsl --unregister {1}; depois corre jht uninstall --confirm de novo.') }
    'pt:ps.uninstall.left.runtime' { return ('N' + [char]0x00E3 + 'o removido: o runtime do JHT em {0}. ' + [char]0x00C0 + ' m' + [char]0x00E3 + 'o: Remove-Item -Recurse -Force ''{0}''.') }
    'pt:ps.uninstall.left.task' { return ('N' + [char]0x00E3 + 'o removida: a tarefa de arranque no in' + [char]0x00ED + 'cio de sess' + [char]0x00E3 + 'o ''{0}'' (motivo: {1}). O resto foi removido. ' + [char]0x00C0 + ' m' + [char]0x00E3 + 'o: schtasks /Delete /TN "{0}" /F.') }
    'pt:ps.uninstall.phase.commands' { return 'A remover o comando jht, os ficheiros do instalador e as linhas do PATH...' }
    'pt:ps.uninstall.phase.data' { return 'A apagar ~/.jht e Documents\Job Hunter Team (--purge)...' }
    'pt:ps.uninstall.phase.machine' { return ('A remover a m' + [char]0x00E1 + 'quina Podman <machine> (com os segredos e as imagens do JHT)...') }
    'pt:ps.uninstall.phase.runtime' { return 'A remover o runtime do JHT...' }
    'pt:ps.uninstall.purge_notice' { return ('Com --purge tamb' + [char]0x00E9 + 'm s' + [char]0x00E3 + 'o apagados ~/.jht e Documents\Job Hunter Team: configura' + [char]0x00E7 + [char]0x00E3 + 'o, base de dados, curr' + [char]0x00ED + 'culos e resultados. N' + [char]0x00E3 + 'o h' + [char]0x00E1 + ' volta atr' + [char]0x00E1 + 's.') }
    'pt:ps.uninstall.purge_removal_notice' { return ('A palavra-passe do correio e os tokens do Telegram guardados tamb' + [char]0x00E9 + 'm s' + [char]0x00E3 + 'o apagados.') }
    'pt:ps.uninstall.removal_notice' { return ('A palavra-passe do correio e os tokens do Telegram guardados tamb' + [char]0x00E9 + 'm s' + [char]0x00E3 + 'o apagados; ~/.jht e Documentos ficam, e com eles a sess' + [char]0x00E3 + 'o do LinkedIn guardada (secrets/linkedin-profile e .cache/linkedin): remove-a com jht reset --scope creds.') }
    'pt:ps.uninstall.secrets' { return ('Os segredos guardados n' + [char]0x00E3 + 'o foram removidos: a palavra-passe do correio e os tokens do Telegram est' + [char]0x00E3 + 'o nos volumes jht-secrets e jht-telegram-secrets da m' + [char]0x00E1 + 'quina <machine>, que continua c' + [char]0x00E1 + '.') }
    'pt:ps.uninstall.wslconfig.done' { return ('Removidas de {0} as linhas adicionadas pelo instalador (mem' + [char]0x00F3 + 'ria do WSL).') }
    'pt:ps.uninstall.wslconfig.kept' { return ('Deixadas em {0} as linhas que alteraste tu: s' + [char]0x00E3 + 'o tuas.') }
    'pt:ps.uninstall.wslconfig.left' { return ('N' + [char]0x00E3 + 'o tocado: {0} ({1}). As linhas adicionadas pelo instalador (mem' + [char]0x00F3 + 'ria do WSL) ficam. Remove-as ' + [char]0x00E0 + ' m' + [char]0x00E3 + 'o: cada uma tem uma linha de coment' + [char]0x00E1 + 'rio por cima.') }
    'pt:ps.unknown_argument' { return 'argumento desconhecido: %s' }
    'pt:ps.upgrade_already_running' { return ('J' + [char]0x00E1 + ' h' + [char]0x00E1 + ' uma atualiza' + [char]0x00E7 + [char]0x00E3 + 'o em curso') }
    'pt:ps.upgrade_broker_restart_failed' { return ('broker_restart_failed: o broker dos segredos n' + [char]0x00E3 + 'o voltou a arrancar. O que fazer: jht up') }
    'pt:ps.upgrade_disk_low' { return ('disk_low: Os agentes precisam de pelo menos %s GiB de disco ' + [char]0x2014 + ' dispon' + [char]0x00ED + 'veis: %s GiB. Para libertar espa' + [char]0x00E7 + 'o esvazia o Lixo e apaga os ficheiros grandes de que n' + [char]0x00E3 + 'o precisas e as imagens Docker n' + [char]0x00E3 + 'o utilizadas; depois tenta de novo: nada foi descarregado nem alterado.') }
    'pt:ps.upgrade_docker_unavailable' { return ('Docker ou runtime do anfitri' + [char]0x00E3 + 'o indispon' + [char]0x00ED + 'vel') }
    'pt:ps.upgrade_helper_install_failed' { return ('helper_install_failed: os novos scripts do anfitri' + [char]0x00E3 + 'o s' + [char]0x00E3 + 'o obtidos no primeiro pedido ou com outro ''jht upgrade''') }
    'pt:ps.upgrade_host_runtime_not_installable' { return ('N' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel instalar o runtime protegido do anfitri' + [char]0x00E3 + 'o') }
    'pt:ps.upgrade_host_runtime_untrusted' { return ('Runtime do anfitri' + [char]0x00E3 + 'o n' + [char]0x00E3 + 'o fi' + [char]0x00E1 + 'vel') }
    'pt:ps.upgrade_image_download_failed' { return 'A descarga da imagem falhou' }
    'pt:ps.upgrade_journal_not_updated' { return ('N' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel atualizar o journal') }
    'pt:ps.upgrade_metadata_not_persisted' { return ('Metadados do runtime n' + [char]0x00E3 + 'o guardados') }
    'pt:ps.upgrade_mounts_not_writable' { return ('As pastas do Job Hunter Team n' + [char]0x00E3 + 'o s' + [char]0x00E3 + 'o grav' + [char]0x00E1 + 'veis a partir do contentor (mount_repair_failed)') }
    'pt:ps.upgrade_not_completed' { return ('Atualiza' + [char]0x00E7 + [char]0x00E3 + 'o n' + [char]0x00E3 + 'o conclu' + [char]0x00ED + 'da (%s): %s') }
    'pt:ps.upgrade_note_activate_runtime' { return 'A ativar o novo runtime...' }
    'pt:ps.upgrade_note_download_image' { return 'A descarregar a imagem mais recente...' }
    'pt:ps.upgrade_note_download_runtime' { return 'A descarregar o runtime atualizado...' }
    'pt:ps.upgrade_option_unsupported' { return ('Op' + [char]0x00E7 + [char]0x00E3 + 'o de upgrade n' + [char]0x00E3 + 'o suportada') }
    'pt:ps.upgrade_pulling_full_image' { return 'Estou a descarregar a imagem completa atualizada...' }
    'pt:ps.upgrade_recovery_failed' { return ('A recupera' + [char]0x00E7 + [char]0x00E3 + 'o do upgrade anterior falhou') }
    'pt:ps.upgrade_release_core_invalid' { return ('A vers' + [char]0x00E3 + 'o n' + [char]0x00E3 + 'o inclui um n' + [char]0x00FA + 'cleo v' + [char]0x00E1 + 'lido para esta instala' + [char]0x00E7 + [char]0x00E3 + 'o: reinstala') }
    'pt:ps.upgrade_remote_compose_invalid' { return ('Compose remoto inv' + [char]0x00E1 + 'lido') }
    'pt:ps.upgrade_remote_runtime_invalid' { return ('Runtime remoto inv' + [char]0x00E1 + 'lido ou inacess' + [char]0x00ED + 'vel') }
    'pt:ps.upgrade_rollback_not_prepared' { return ('N' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel preparar o rollback') }
    'pt:ps.upgrade_telegram_restart_failed' { return ('telegram_restart_failed: o servi' + [char]0x00E7 + 'o Telegram isolado n' + [char]0x00E3 + 'o voltou a arrancar. O que fazer: jht up') }
    'pt:ps.upgrade_test_channel' { return 'Canal de testes: atualiza-se reinstalando a partir da build de testes' }
    'pt:ps.upgrade_unexpected_error' { return ('Erro inesperado durante a atualiza' + [char]0x00E7 + [char]0x00E3 + 'o') }
    'pt:ps.upgrade_verify_failed' { return ('O novo runtime n' + [char]0x00E3 + 'o passou na verifica' + [char]0x00E7 + [char]0x00E3 + 'o') }
    'pt:ps.use_fresh_botfather_token' { return ('Usa sempre um token acabado de gerar no BotFather (/revoke no bot, ou um bot novo): um token que j' + [char]0x00E1 + ' existia pode ter sido lido pelos agentes, mesmo que hoje n' + [char]0x00E3 + 'o apare' + [char]0x00E7 + 'a em ~/.jht.') }
    'pt:ps.user_dir_unavailable_cannot_create' { return ('user_dir_unavailable: n' + [char]0x00E3 + 'o consigo criar a pasta %s, que a equipa usa.') }
    'pt:ps.wsl_exe_not_found' { return ('wsl.exe n' + [char]0x00E3 + 'o encontrado') }
    'pt:ps.wsl_not_answering' { return ('o WSL n' + [char]0x00E3 + 'o responde (wsl --status)') }
    'pt:removed.office' { return ('''jht %s'' foi removido na 0.4.0 juntamente com o escrit' + [char]0x00F3 + 'rio Godot: usa os comandos jht (jht help).') }
    'pt:status.no_options' { return ('''jht status'' n' + [char]0x00E3 + 'o aceita op' + [char]0x00E7 + [char]0x00F5 + 'es (%s): corre-o como ''jht status''.') }
    'pt:status.not_running' { return ('O contentor da equipa n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' a correr.') }
    'pt:status.not_running_next' { return 'Liga-o com: jht up' }
    'pt:team.stopped' { return ('O Job Hunter Team est' + [char]0x00E1 + ' parado: ''jht up'' volta a lig' + [char]0x00E1 + '-lo.') }
    'pt:tools.arriving' { return ('As ferramentas dos Scout est' + [char]0x00E3 + 'o a caminho: a imagem completa est' + [char]0x00E1 + ' a ser descarregada em segundo plano (cerca de 3 GB). A procura de vagas come' + [char]0x00E7 + 'a sozinha quando chegarem; n' + [char]0x00E3 + 'o tens de fazer nada.') }
    'pt:tools.chat_reconnecting' { return 'A equipa passa para as ferramentas completas dos Scout, por isso o chat para por um momento: volta sozinho assim que a equipa estiver a funcionar outra vez (alguns minutos).' }
    'pt:tools.chat_resumed' { return 'A equipa passou para as ferramentas completas: vamos continuar.' }
    'pt:tools.chat_switched' { return 'A equipa passa para as ferramentas completas dos Scout, por isso este chat fechou-se. Volta a abri-lo dentro de alguns minutos com jht team chat.' }
    'pt:tools.chat_update_closed' { return ('O JHT est' + [char]0x00E1 + ' a atualizar-se, por isso este chat fechou-se. Volta a abri-lo dentro de alguns minutos com jht team chat.') }
    'pt:tools.chat_update_resumed' { return ('O JHT est' + [char]0x00E1 + ' atualizado: vamos continuar.') }
    'pt:tools.chat_updating' { return ('O JHT est' + [char]0x00E1 + ' a atualizar-se, por isso o chat para por um momento: volta sozinho dentro de um ou dois minutos.') }
    'pt:tools.disk_low' { return ('As ferramentas dos Scout n' + [char]0x00E3 + 'o foram descarregadas: precisam de cerca de %s GiB livres no disco e h' + [char]0x00E1 + ' %s GiB, por isso a equipa ainda n' + [char]0x00E3 + 'o pode procurar vagas. Liberta espa' + [char]0x00E7 + 'o (esvazia o Lixo, apaga os ficheiros grandes de que n' + [char]0x00E3 + 'o precisas) e depois corre jht up: o descarregamento recome' + [char]0x00E7 + 'a sozinho.') }
    'pt:tools.engine_down' { return ('N' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel ler o estado das ferramentas dos Scout: o motor de contentores n' + [char]0x00E3 + 'o responde. Inicia-o com jht up.') }
    'pt:tools.failed' { return ('O descarregamento das ferramentas dos Scout falhou, por isso a equipa ainda n' + [char]0x00E3 + 'o pode procurar vagas. Corre jht tools pull para tentar de novo (jht up tamb' + [char]0x00E9 + 'm tenta de novo).') }
    'pt:tools.ready' { return ('As ferramentas dos Scout j' + [char]0x00E1 + ' chegaram: a equipa procura com a imagem completa.') }
    'pt:tools.switch_failed' { return ('As ferramentas dos Scout j' + [char]0x00E1 + ' chegaram, mas n' + [char]0x00E3 + 'o foi poss' + [char]0x00ED + 'vel reiniciar a equipa com elas: corre jht down e depois jht up.') }
    'pt:tools.switch_wait' { return ('A equipa est' + [char]0x00E1 + ' a passar para as ferramentas completas dos Scout: espero que volte a arrancar (no m' + [char]0x00E1 + 'ximo alguns minutos).') }
    'pt:tools.waiting' { return ('As ferramentas dos Scout j' + [char]0x00E1 + ' chegaram: a equipa passa para elas sozinha quando o onboarding estiver conclu' + [char]0x00ED + 'do.') }
    'pt:uninstall.usage' { return ('utiliza' + [char]0x00E7 + [char]0x00E3 + 'o: jht uninstall --confirm [--purge]') }
    'pt:up.done' { return 'Job Hunter Team iniciado.' }
  }
  return $null
}
# <<< texts in the 7 languages

# The tools of a core install (P4), as in jht-wrapper.sh (tools_tell_person). The installer leaves the core image; the full one,
# with the Scouts' tools, comes after, pulled in the background, and the team moves onto it once the onboarding has closed. The
# desktop app kept that moving; with the CLI only it is `jht up` and `jht setup` that start it (Invoke-ToolsKick in jht-tools.ps1:
# one detached job, idempotent) and `jht up`, `jht setup` and `jht status` that say where it stands. A helper that is missing or
# not trusted says nothing here, and never fails the command it rides on.
function Get-JhtToolsText {
  param([Parameter(Mandatory)][string]$Key)
  # texts said through a variable: tools.arriving tools.waiting tools.failed tools.switch_failed tools.ready tools.engine_down
  return (Get-JhtText ('tools.' + $Key))
}

# `jht tools status`: one line for the person, the same words `jht up` says (`--json` is for programs), as tools_say_status in
# jht-wrapper.sh. With no tier file the tools are here; with one and nothing to say, the engine did not answer.
function Write-JhtToolsStatus {
  $state = Get-ToolsPersonState
  if (-not $state) { $state = if (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf) { 'engine_down' } else { 'ready' } }
  if ($state -ceq 'disk_low') { [Console]::Out.WriteLine((Get-JhtToolsDiskLowText)); return }
  [Console]::Out.WriteLine((Get-JhtToolsText $state))
}

# No room on the disk for the full image (Test-ToolsDiskRoom in jht-tools.ps1): how much it asks for and how much there is now.
function Get-JhtToolsDiskLowText {
  $free = Get-ToolsDiskFreeKib
  if ($null -eq $free) { $free = 0 }
  return (Format-JhtText 'tools.disk_low' (Get-DiskGibText (Get-ToolsPullNeedKib)) (Get-DiskGibText $free))
}

function Write-JhtToolsNotice {
  param([switch]$Kick)
  try {
    Write-JhtMachineSpaceNote
    if (-not ((Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf) -or (Test-Path -LiteralPath (Join-Path $RuntimeDir '.tools-switch-failed') -PathType Leaf))) { return }
    if (-not (Test-RuntimeHelperDeclared 'jht-tools.ps1')) { return }
    Assert-TrustedRuntime
    . (Join-Path $RuntimeDir 'jht-tools.ps1')
    if ($Kick) { $null = Invoke-ToolsKick }
    switch (Get-ToolsPersonState) {
      'arriving'      { Write-Info (Get-JhtToolsText 'arriving') }
      'waiting'       { Write-Info (Get-JhtToolsText 'waiting') }
      'failed'        { Write-Warn (Get-JhtToolsText 'failed') }
      'disk_low'      { Write-Warn (Get-JhtToolsDiskLowText) }
      'switch_failed' { Write-Warn (Get-JhtToolsText 'switch_failed') }
    }
  } catch { }
}

# `jht team chat` whose REPL the switch of the tools ended: the down of the core team stops the container the REPL runs in, and the
# REPL ends with nothing said. The job of the switch writes its pid in .tools-switching while it stops the core team and starts the
# full one; a file whose process is gone is an old one and says nothing.
function Test-JhtTeamChatEndedBySwitch {
  try {
    $item = Get-Item -LiteralPath (Join-Path $RuntimeDir '.tools-switching') -Force -ErrorAction Stop
    if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return $false }
    $text = [IO.File]::ReadAllText($item.FullName).Trim()
    if ($text -notmatch '^[0-9]{1,10}$') { return $false }
    return [bool](Get-Process -Id ([int]$text) -ErrorAction SilentlyContinue)
  } catch { return $false }
}

# A command that starts the team (Ensure-Up) while the switch of the tools is between its down and its up: it waits for the switch
# to end instead of starting a second `compose up` next to the job's (two creates at once lose the keep-id map on Podman <= 6.0.2,
# and an up before the tier goes starts the core image again). A tetto: JHT_TOOLS_SWITCH_WAIT_MAX seconds, 300 by default.
function Wait-JhtToolsSwitch {
  param([switch]$Quiet)
  $left = 300
  if ($env:JHT_TOOLS_SWITCH_WAIT_MAX -match '^[0-9]{1,6}$') { $left = [int]$env:JHT_TOOLS_SWITCH_WAIT_MAX }
  if (-not (Test-JhtTeamChatEndedBySwitch)) { return }
  if (-not $Quiet) { Write-Info (Get-JhtText 'tools.switch_wait') }
  while ((Test-JhtTeamChatEndedBySwitch) -and $left -gt 0) { Start-Sleep -Seconds 2; $left -= 2 }
}

# The agent a `jht team chat <agent>` talks to is there again (its tmux session in the container): after the switch the container
# starts the agents the person talks to by itself. <agent> as the CLI takes it: assistente, capitano, scout:1 / scout-1. An agent
# the name does not say is waited for as any session at all. A tetto: JHT_TOOLS_CHAT_RECONNECT_MAX seconds, 180 by default.
function Test-JhtTeamChatAgentBack {
  param([string]$Agent)
  $left = 180
  if ($env:JHT_TOOLS_CHAT_RECONNECT_MAX -match '^[0-9]{1,6}$') { $left = [int]$env:JHT_TOOLS_CHAT_RECONNECT_MAX }
  $name = $Agent.ToUpperInvariant().Replace(':', '-')
  if ($name -cnotmatch '^[A-Z0-9-]+$') { $name = '' }
  while ($true) {
    if ($name) { $null = & { $ErrorActionPreference = 'Continue'; & docker exec $Container tmux has-session -t "=$name" 2>&1 } }
    else { $null = & { $ErrorActionPreference = 'Continue'; & docker exec $Container tmux list-sessions 2>&1 } }
    if ($LASTEXITCODE -eq 0) { return $true }
    if ($left -le 0) { return $false }
    Start-Sleep -Seconds 2
    $left -= 2
  }
}

# `jht team chat` whose REPL the switch ended: it comes back by itself, on the same agent, once the team runs on the full image.
# This wrapper read the runtime before the switch (the core image, the core container) and would refuse the full container as not
# ours: a fresh wrapper reads it as it is now. It is told it resumes a chat (JHT_TEAM_CHAT_RESUME, the round), so it never starts
# or replaces the container: it waits for the agent and attaches (Invoke-JhtTeamChatResume). At most three switches in a row.
# Called as a statement; the exit code is in $script:JhtTeamChatCode.
function Invoke-JhtTeamChatThroughSwitch {
  param([string[]]$ChatArgs)
  $round = 0
  if ($env:JHT_TEAM_CHAT_RESUME -match '^[0-9]{1,2}$') { $round = [int]$env:JHT_TEAM_CHAT_RESUME }
  if ($round -ge 3) { Write-Info (Get-JhtText 'tools.chat_switched'); $script:JhtTeamChatCode = 0; return }
  Write-Info (Get-JhtText 'tools.chat_reconnecting')
  Wait-JhtToolsSwitch -Quiet
  $env:JHT_TEAM_CHAT_RESUME = [string]($round + 1)
  $env:JHT_TEAM_CHAT_RESUME_AFTER = 'switch'
  & (Get-Process -Id $PID).Path -NoProfile -ExecutionPolicy Bypass -File $WrapperPath 'team' @ChatArgs
  $script:JhtTeamChatCode = $LASTEXITCODE
}

# `jht team chat` whose REPL the container engine ended from under it: an update changes the units of the Podman machine and restarts
# it, and the client of the REPL then says its raw line on stderr («Error: Get "http://d/v6.0.2/libpod/exec/.../json": EOF», «Cannot
# connect to Podman», a connection refused or reset; or, when the container is created again under the REPL, «Error: retrieving exec
# session … no such container»). That line is not for the person: the chat says it is updating and comes back.
# Only the stderr kept aside by Invoke-JhtTeamChatOnConsole is read, never the REPL's own lines.
function Test-JhtTeamChatEngineGone {
  param($Code)
  $file = $script:JhtTeamChatErrFile
  if ($null -eq $Code -or [int]$Code -eq 0 -or -not $file) { return $false }
  try { $text = [IO.File]::ReadAllText($file) } catch { return $false }
  return [bool]($text -match '(?i)libpod/.*(EOF|connection (refused|reset))|Cannot connect to Podman|unable to connect to Podman|error during connect|connection reset by peer|unexpected EOF|retrieving exec session')
}

# The chat the engine ended comes back by itself: wait (JHT_CHAT_UPDATE_WAIT_MAX seconds, 300 by default) for the engine to answer and
# the container to run again, then a fresh wrapper resumes it as after the switch of the tools (it never starts a container: it waits
# for the agent and attaches). Past the wait, or after three rounds, the person is told to open the chat again.
# Called as a statement; the exit code is in $script:JhtTeamChatCode.
function Invoke-JhtTeamChatThroughUpdate {
  param([string[]]$ChatArgs)
  $round = 0
  if ($env:JHT_TEAM_CHAT_RESUME -match '^[0-9]{1,2}$') { $round = [int]$env:JHT_TEAM_CHAT_RESUME }
  $left = 300
  if ($env:JHT_CHAT_UPDATE_WAIT_MAX -match '^[0-9]{1,6}$') { $left = [int]$env:JHT_CHAT_UPDATE_WAIT_MAX }
  if ($round -ge 3) { Write-Info (Get-JhtText 'tools.chat_update_closed'); $script:JhtTeamChatCode = 0; return }
  Write-Info (Get-JhtText 'tools.chat_updating')
  $back = $false
  while ($true) {
    if ((Test-DockerReachable) -and (Test-ContainerUp)) { $back = $true; break }
    if ($left -le 0) { break }
    Start-Sleep -Seconds 2
    $left -= 2
  }
  if (-not $back) { Write-Info (Get-JhtText 'tools.chat_update_closed'); $script:JhtTeamChatCode = 0; return }
  $env:JHT_TEAM_CHAT_RESUME = [string]($round + 1)
  $env:JHT_TEAM_CHAT_RESUME_AFTER = 'update'
  & (Get-Process -Id $PID).Path -NoProfile -ExecutionPolicy Bypass -File $WrapperPath 'team' @ChatArgs
  $script:JhtTeamChatCode = $LASTEXITCODE
}

# `jht team chat` on a console: the REPL in the container, with what the container client says on its own stderr kept aside until
# the REPL ends (on a console the REPL's lines all come through the tty, on stdout; stdin and stdout stay the console). The switch
# of the tools removes the container under the REPL, and Podman then says «Error: no container with name or ID "jht" found»: that
# line is not for the person, the chat says why it stops and comes back (Complete-JhtTeamChatErrors -Drop); any other end shows it.
# Not on a console, or with a word a command line cannot carry as it is: nothing here ($null), the chat runs as any command.
function Invoke-JhtTeamChatOnConsole {
  param([string[]]$HostFlags)
  $script:JhtTeamChatErrFile = $null
  if (($ExecFlags -join ' ') -cne '-it') { return $null }
  $words = @(@('exec') + $ExecFlags + $HostFlags + @($Container, 'node', $NodeEntry, $Sub) + @($Rest))
  if (@($words | Where-Object { [string]$_ -cnotmatch '^[A-Za-z0-9_./:=@+-]+$' }).Count -gt 0) { return $null }
  $client = Get-Command docker -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $client) { return $null }
  try {
    $script:JhtTeamChatErrFile = [IO.Path]::GetTempFileName()
    $process = Start-Process -FilePath $client.Source -ArgumentList ($words -join ' ') -NoNewWindow -Wait -PassThru `
      -RedirectStandardError $script:JhtTeamChatErrFile -ErrorAction Stop
    return [int]$process.ExitCode
  } catch {
    Complete-JhtTeamChatErrors -Drop
    return $null
  }
}

# What the container client said on its stderr during the chat: shown (or, -Drop, left out), and its file taken away.
function Complete-JhtTeamChatErrors {
  param([switch]$Drop)
  $file = $script:JhtTeamChatErrFile
  $script:JhtTeamChatErrFile = $null
  if (-not $file) { return }
  if (-not $Drop) {
    try { $text = [IO.File]::ReadAllText($file); if ($text) { [Console]::Error.Write($text) } } catch { }
  }
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}

# The fresh wrapper of a chat that the switch ended: the container the switch started must be running and ours, and the agent
# back in it. Nothing is started here: if they are not there, the person is told to open the chat again. The container is
# waited for as the agent is (JHT_TOOLS_CHAT_RECONNECT_MAX): the switch has just started it, and it is not ours yet for a few
# seconds; asked once, the chat said «it comes back by itself» and at once «this chat has closed» (giro Linux build11).
function Test-JhtTeamChatContainerBack {
  $left = 180
  if ($env:JHT_TOOLS_CHAT_RECONNECT_MAX -match '^[0-9]{1,6}$') { $left = [int]$env:JHT_TOOLS_CHAT_RECONNECT_MAX }
  while (-not (Test-ContainerUp)) {
    if ($left -le 0) { return $false }
    Start-Sleep -Seconds 2
    $left -= 2
  }
  return $true
}

# After an update (a restart of the machine too) it says the update, not the switch of the tools: it said «the team has moved onto
# the full tools» after a restart (retest Windows build13).
function Invoke-JhtTeamChatResume {
  param([string]$Agent)
  $afterUpdate = ($env:JHT_TEAM_CHAT_RESUME_AFTER -ceq 'update')
  if (-not (Test-JhtTeamChatContainerBack) -or -not (Test-JhtTeamChatAgentBack $Agent)) {
    if ($afterUpdate) { Write-Info (Get-JhtText 'tools.chat_update_closed') } else { Write-Info (Get-JhtText 'tools.chat_switched') }
    exit 0
  }
  if ($afterUpdate) { Write-Info (Get-JhtText 'tools.chat_update_resumed') } else { Write-Info (Get-JhtText 'tools.chat_resumed') }
}

# Every `jht` command says it is running, in a file of the runtime folder named by its PID: "<pid> <start ticks> <command>
# <first argument>". The switch of the tools (Test-ToolsRegisteredCommandRunning in jht-tools.ps1) reads them to wait for a
# command that changes the runtime. The command line of another process is not enough: Windows PowerShell 5.1 has no
# Get-Process .CommandLine, and Win32_Process can be refused (an ssh session of a standard user). A file whose process is gone,
# or is another process with the same PID, says nothing, and the files of the gone ones are taken away.
function Register-JhtRunningCommand {
  param([string]$Command, [string[]]$Arguments = @())
  try {
    if (-not (Test-Path -LiteralPath $RuntimeDir -PathType Container)) { return }
    $dir = Join-Path $RuntimeDir '.commands'
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -ErrorAction Stop }
    $item = Get-Item -LiteralPath $dir -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return }
    $old = @(Get-ChildItem -LiteralPath $dir -File -Force -ErrorAction SilentlyContinue)
    if ($old.Count -gt 20) {
      foreach ($file in $old) {
        if ($file.Name -notmatch '^[0-9]{1,10}$' -or -not (Get-Process -Id ([int]$file.Name) -ErrorAction SilentlyContinue)) {
          Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
        }
      }
    }
    # only a word: never a value (`jht setup --api-key=...` must not leave the key in a file)
    $words = @($Command, $(if ($Arguments.Count -gt 0) { [string]$Arguments[0] } else { '' })) | ForEach-Object {
      if ([string]$_ -cmatch '^[a-z][a-z0-9-]{0,40}$') { [string]$_ } else { '-' }
    }
    $ticks = (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks
    [IO.File]::WriteAllText((Join-Path $dir "$PID"), ("$PID $ticks " + ($words -join ' ') + "`n"), [Text.UTF8Encoding]::new($false))
  } catch { }
}

function Get-JhtUninstallText {
  param([Parameter(Mandatory)][string]$Key, [string[]]$Values = @())
  # texts said through a variable: ps.uninstall.phase.machine ps.uninstall.phase.data ps.uninstall.phase.runtime ps.uninstall.phase.commands ps.uninstall.done ps.uninstall.done.kept ps.uninstall.done.wsl ps.uninstall.secrets ps.uninstall.left.machine ps.uninstall.left.task ps.uninstall.left.data ps.uninstall.left.runtime ps.uninstall.left.commands ps.uninstall.kept.machine ps.uninstall.wslconfig.done ps.uninstall.wslconfig.kept ps.uninstall.wslconfig.left ps.uninstall.bad.target ps.uninstall.removal_notice ps.uninstall.purge_removal_notice ps.uninstall.purge_notice
  $format = Get-JhtText ('ps.uninstall.' + $Key)
  if ($format -ceq ('ps.uninstall.' + $Key)) { return $Key }
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
    $script:JhtStartupTaskReason = (Get-JhtText 'ps.startup_task_still_registered')
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
    $script:JhtUninstallReason = (Get-JhtText 'ps.link_or_not_folder')
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
    [Console]::Error.WriteLine((Get-JhtText 'uninstall.usage'))
    [Console]::Error.WriteLine((Get-JhtUninstallText 'removal_notice'))
    [Console]::Error.WriteLine((Get-JhtUninstallText 'purge_notice'))
    return 2
  }
  $purge = $UninstallArgs.Count -eq 2
  if ($purge) { [Console]::Error.WriteLine((Get-JhtUninstallText 'purge_removal_notice')) } else { [Console]::Error.WriteLine((Get-JhtUninstallText 'removal_notice')) }
  if ($purge) { [Console]::Error.WriteLine((Get-JhtUninstallText 'purge_notice')) }
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
    if (-not $WslPath) { & $leaveForRetry (Get-JhtText 'ps.wsl_exe_not_found'); return 24 }
    & { $ErrorActionPreference = 'Continue'; & $WslPath --status *> $null }
    if ($LASTEXITCODE -ne 0) { & $leaveForRetry (Get-JhtText 'ps.wsl_not_answering'); return 24 }
    $gone = $false
    if ($PodmanPath) {
      $removal = Invoke-JhtUninstallNative $PodmanPath @('machine', 'rm', '--force', $machineName)
      $gone = ($removal.Code -eq 0) -and
        ((Get-JhtPodmanMachineState -PodmanPath $PodmanPath -WslPath $WslPath -MachineName $machineName) -eq 'absent')
      if (-not $gone) { $script:JhtUninstallReason = "podman machine rm --force $machineName : exit $($removal.Code), $($removal.Text)" }
    } else {
      $script:JhtUninstallReason = (Get-JhtText 'ps.podman_exe_not_found')
    }
    # Podman could not (or is not there): the distro of our machine, by its exact name, through WSL.
    if (-not $gone) { $gone = Remove-JhtPodmanMachineThroughWsl -PodmanPath $PodmanPath -WslPath $WslPath -MachineName $machineName }
    if (-not $gone) { & $leaveForRetry ''; return 24 }
  } elseif ($machineState -ne 'absent') {
    & $leaveForRetry (Get-JhtText 'ps.machine_state_unreadable')
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
if (-not $LocalAppData) { throw (Get-JhtText 'ps.localappdata_unavailable') }
if (-not $env:HOME) { $env:HOME = $env:USERPROFILE }
if (-not $env:HOME) { throw (Get-JhtText 'ps.home_unavailable_bind_mount') }
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
if ($ContainerRuntime -notin @('docker', 'podman')) { throw (Format-JhtText 'ps.container_runtime_unsupported' $ContainerRuntime) }
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
$DefaultRuntimeImage = 'ghcr.io/leopu00/jht@sha256:dd723873b6898717f94ac20fdb6fb049f52b4bb1d5d18cd13541878d78e4575d'
$CoreImageDigest = 'sha256:2bb7ff3ca65b6e8afc9c9929d5de6bcd0f481384edcf4f4d782fb8e91665cea1'
$ExtrasImageDigest = 'sha256:df4f95329b7c43727a9c2ad35bafc87c49ec3360b092a439ff0a33e16f873e59'
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

# The timezone of the person, chosen in `jht setup`: detected from Windows (the CLDR table of the Windows ids), or looked for by a country, a
# city or a timezone, in the 7 languages. Its texts are the keys host_setup.tz.* of the catalogs (the same the .sh says). It never falls back
# to UTC in silence: UTC is chosen by writing it. The data (countries, cities, zones, Windows ids) are the lines of Get-JhtTimezoneLines.
$script:JhtTzIndex = $null
$script:JhtTzFold = $null

function ConvertFrom-JhtTzEscape {
  param([string]$Text)
  if ($Text.IndexOf('\') -lt 0) { return $Text }
  return [regex]::Replace($Text, '\\u([0-9a-fA-F]{4})', { param($m) [string][char][Convert]::ToInt32($m.Groups[1].Value, 16) })
}

# The letters with an accent and the letter they are without it, from the F line of the data: String.Normalize is not counted on (a PowerShell
# with the invariant globalization leaves the accents), so the same table is used on Windows, Linux and macOS.
function Get-JhtTzFold {
  if ($script:JhtTzFold) { return $script:JhtTzFold }
  $fold = @{}
  foreach ($raw in [regex]::Split((Get-JhtTimezoneLines), '\r?\n')) {
    if ($raw.StartsWith('F|')) {
      $parts = (ConvertFrom-JhtTzEscape $raw).Split('|')
      for ($i = 0; $i -lt $parts[1].Length -and $i -lt $parts[2].Length; $i++) { $fold[$parts[1][$i]] = [string]$parts[2][$i] }
      break
    }
  }
  $script:JhtTzFold = $fold
  return $fold
}

# What two spellings of a name share: lower case, no accents, _ - . , ' as a space, one space between words (tests/timezone_data.py key()).
function ConvertTo-JhtTzKey {
  param([string]$Text)
  $t = $Text
  if ($t -cmatch '^[\x20-\x7E]*\z') {
    # plain ASCII: nothing to take the accents from
    foreach ($mark in @('_', '-', '.', ',', "'")) { $t = $t.Replace($mark, ' ') }
    return ((($t.ToLowerInvariant()) -split '\s+' | Where-Object { $_ }) -join ' ')
  }
  $t = $t.Replace([string][char]0x00DF, 'ss').Replace([string][char]0x00F8, 'o').Replace([string][char]0x00D8, 'O').Replace([string][char]0x0142, 'l').Replace([string][char]0x0141, 'L')
  $t = $t.Replace([string][char]0x0111, 'd').Replace([string][char]0x00E6, 'ae').Replace([string][char]0x00C6, 'AE')
  [void](Get-JhtTzFold)
  # only the characters that are not ASCII go through the table (a loop over every character of every name is slow in PowerShell)
  $t = [regex]::Replace($t, '[^\x00-\x7F]+', {
    param($m)
    $out = New-Object System.Text.StringBuilder
    foreach ($c in $m.Value.ToCharArray()) {
      if ($script:JhtTzFold.ContainsKey($c)) { [void]$out.Append($script:JhtTzFold[$c]) }
      elseif ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$out.Append($c) }
    }
    $out.ToString()
  })
  foreach ($mark in @('_', '-', '.', ',', "'", [string][char]0x2019)) { $t = $t.Replace($mark, ' ') }
  return ((($t.ToLowerInvariant()) -split '\s+' | Where-Object { $_ }) -join ' ')
}

function Add-JhtTzName {
  param($Index, [string]$Name, [string[]]$Zones)
  $key = ConvertTo-JhtTzKey $Name
  if ($key -and $Zones.Count -gt 0) { [void]$Index.Names.Add([pscustomobject]@{ Key = $key; Zones = $Zones }) }
}

function Get-JhtTzIndex {
  if ($script:JhtTzIndex) { return $script:JhtTzIndex }
  $index = @{
    Names = New-Object 'System.Collections.Generic.List[object]'
    Zones = New-Object 'System.Collections.Generic.HashSet[string]'
    ZonesOf = @{}
    WinOf = @{}
    Primary = @{}
  }
  $lines = New-Object 'System.Collections.Generic.List[string[]]'
  foreach ($raw in [regex]::Split((Get-JhtTimezoneLines), '\r?\n')) {
    if ($raw -and -not $raw.StartsWith('#')) { $lines.Add(([string[]](ConvertFrom-JhtTzEscape $raw).Split('|'))) }
  }
  foreach ($f in $lines) {
    switch -CaseSensitive ($f[0]) {
      'Z' {
        if (-not $index.ZonesOf.ContainsKey($f[1])) { $index.ZonesOf[$f[1]] = New-Object 'System.Collections.Generic.List[string]' }
        $index.ZonesOf[$f[1]].Add($f[2]); [void]$index.Zones.Add($f[2])
      }
      'W' { $index.WinOf[$f[1]] = $f[2] }
      'P' { $index.Primary[$f[1]] = $f[2] }
    }
  }
  [void]$index.Zones.Add('UTC')
  foreach ($f in $lines) {
    switch -CaseSensitive ($f[0]) {
      'C' {
        $zones = [string[]]@($index.ZonesOf[$f[1]])
        Add-JhtTzName $index $f[1] $zones
        foreach ($name in $f[2..($f.Count - 1)]) { Add-JhtTzName $index $name $zones }
      }
      'A' { foreach ($name in $f[2..($f.Count - 1)]) { Add-JhtTzName $index $name ([string[]]@($index.ZonesOf[$f[1]])) } }
      'N' { foreach ($name in $f[2..($f.Count - 1)]) { if ($name) { Add-JhtTzName $index $name ([string[]]@($f[1])) } } }
      'X' { foreach ($name in $f[2..($f.Count - 1)]) { Add-JhtTzName $index $name ([string[]]@($f[1])) } }
    }
  }
  foreach ($zone in $index.Zones) {
    Add-JhtTzName $index $zone ([string[]]@($zone))
    Add-JhtTzName $index ($zone.Substring($zone.LastIndexOf('/') + 1)) ([string[]]@($zone))
  }
  Add-JhtTzName $index 'Etc/UTC' ([string[]]@('UTC'))
  $script:JhtTzIndex = $index
  return $index
}

# The zones that fit what was written: the ones named exactly, else the ones with a word that starts with it (3 letters or more). Exact says
# which: a single zone from a name that only starts like what was written (American -> American Samoa) is never proposed as the answer.
function Find-JhtTimezone {
  param([string]$Query)
  $q = ConvertTo-JhtTzKey $Query
  if ($q.Length -lt 2) { return [pscustomobject]@{ Zones = @(); Exact = $false } }
  $index = Get-JhtTzIndex
  $found = New-Object 'System.Collections.Generic.List[string]'
  $seen = @{}
  foreach ($entry in $index.Names) {
    if ($entry.Key -ceq $q) { foreach ($zone in $entry.Zones) { if (-not $seen.ContainsKey($zone)) { $seen[$zone] = $true; $found.Add($zone) } } }
  }
  $exact = ($found.Count -gt 0)
  if ($found.Count -eq 0 -and $q.Length -ge 3) {
    foreach ($entry in $index.Names) {
      if ($entry.Key.StartsWith($q, [StringComparison]::Ordinal) -or $entry.Key.Contains(' ' + $q)) {
        foreach ($zone in $entry.Zones) { if (-not $seen.ContainsKey($zone)) { $seen[$zone] = $true; $found.Add($zone) } }
      }
    }
  }
  return [pscustomobject]@{ Zones = $found.ToArray(); Exact = $exact }
}

# The time now in a zone, "22:10", or '' where this computer cannot tell it (PowerShell 5.1 takes the Windows id of the zone).
function Get-JhtTzNow {
  param([string]$Zone)
  $index = Get-JhtTzIndex
  $ids = @($Zone)
  if ($index.WinOf.ContainsKey($Zone)) { $ids += $index.WinOf[$Zone] }
  foreach ($id in $ids) {
    try {
      $tz = [TimeZoneInfo]::FindSystemTimeZoneById($id)
      return [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).ToString('HH:mm', [Globalization.CultureInfo]::InvariantCulture)
    } catch { }
  }
  return ''
}

# The country of this computer, two capital letters, or $null: the one of the region settings of Windows (HKCU\Control Panel\International\Geo,
# Name), else the one of the culture of the user (it-IT: IT).
function Get-JhtComputerCountry {
  $country = $null
  try { $country = [string](Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\International\Geo' -Name 'Name' -ErrorAction Stop).Name } catch { }
  if (-not $country) {
    try { $country = [Globalization.RegionInfo]::CurrentRegion.TwoLetterISORegionName } catch { }
  }
  if ($country -cmatch '^[a-zA-Z]{2}\z') { return $country.ToUpperInvariant() }
  return $null
}

# The IANA name of the zone of this computer, or $null. A Windows id covers many zones: the country of the computer picks among them as the CLDR
# does (W. Europe Standard Time in IT: Europe/Rome; the first of the country's zones with the id, or the id's own 001 zone when the country has
# it), else the 001 zone (Europe/Berlin). install.ps1 writes the same zone in host.env (tests/installer_ps1_zones.py). JHT_TZ_LOCAL_ID names the
# id to take for the computer's, and then the country is JHT_TZ_COUNTRY alone (a test seam: it only changes what the person is shown).
function Get-JhtDetectedTimezone {
  $id = $env:JHT_TZ_LOCAL_ID
  if ($id) { $country = $env:JHT_TZ_COUNTRY } else {
    try { $id = [TimeZoneInfo]::Local.Id } catch { $id = '' }
    $country = Get-JhtComputerCountry
  }
  if (-not $id) { return $null }
  $index = Get-JhtTzIndex
  if ($index.Primary.ContainsKey($id)) {
    $primary = $index.Primary[$id]
    if ($country -and $index.ZonesOf.ContainsKey($country)) {
      $ofId = @($index.ZonesOf[$country] | Where-Object { $index.WinOf.ContainsKey($_) -and $index.WinOf[$_] -ceq $id })
      if ($ofId.Count -gt 0 -and -not ($ofId -ccontains $primary)) { return $ofId[0] }
    }
    return $primary
  }
  if ($id -ceq 'Etc/UTC') { return 'UTC' }
  if ($index.Zones.Contains($id)) { return $id }
  return $null
}

# The zone the person chose before (in host.env), or $null.
function Get-JhtHostEnvTimezone {
  if (-not (Test-Path -LiteralPath $HostEnvFile)) { return $null }
  $value = $null
  foreach ($line in (Get-Content -LiteralPath $HostEnvFile)) {
    if ($line -match '^\s*JHT_USER_TZ=(.*)$') {
      $candidate = $Matches[1].Trim().Trim('"').Trim("'")
      if (Test-HostEnvValue -Name 'JHT_USER_TZ' -Value $candidate) { $value = $candidate }
    }
  }
  return $value
}

# Writes JHT_USER_TZ in host.env, keeping the other lines. As install.ps1 writes it: the temporary lives outside the mounted folder (an agent
# could swap it for a link there), and a host.env that is a link or a folder is not followed. Returns $false where it did not write.
function Set-JhtHostEnvTimezone {
  param([string]$Zone)
  if (-not (Test-HostEnvValue -Name 'JHT_USER_TZ' -Value $Zone)) { return $false }
  if (-not (Test-Path -LiteralPath $HostEnvFile)) { return $false }
  $tmp = $null
  try {
    $attributes = [IO.File]::GetAttributes($HostEnvFile)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($attributes -band [IO.FileAttributes]::Directory) -ne 0) { return $false }
    $out = New-Object 'System.Collections.Generic.List[string]'
    $done = $false
    foreach ($line in [IO.File]::ReadAllLines($HostEnvFile)) {
      if ($line -match '^\s*JHT_USER_TZ=') {
        if (-not $done) { $out.Add("JHT_USER_TZ=$Zone"); $done = $true }
      } else { $out.Add($line) }
    }
    if (-not $done) { $out.Add("JHT_USER_TZ=$Zone") }
    $dir = Split-Path -Parent (Split-Path -Parent $HostEnvFile)
    $tmp = Join-Path $dir ('.jht-host-file.{0}.tmp' -f [guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($tmp, (($out -join [Environment]::NewLine) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tmp -Destination $HostEnvFile -Force
    return $true
  } catch {
    return $false
  } finally {
    if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
}

function Read-JhtTzLine {
  param([string]$Prompt)
  [Console]::Out.Write($Prompt)
  return [Console]::In.ReadLine()
}

function Format-JhtTzZone {
  param([string]$Zone)
  $now = Get-JhtTzNow $Zone
  if ($now) { return "$Zone  ($now)" }
  return $Zone
}

# jht setup, on a terminal: asks the timezone unless the person has one that is the computer's, writes it in host.env and puts it in this run's
# environment, so the team is started with it. Not asked with --non-interactive, or with the input redirected (JHT_TZ_PROMPT_STDIN=1 reads it, for tests).
function Resolve-JhtUserTimezone {
  param([string[]]$SetupArgs)
  if ($SetupArgs -ccontains '--non-interactive') { return }
  if ([Console]::IsInputRedirected -and $env:JHT_TZ_PROMPT_STDIN -cne '1') { return }
  $saved = Get-JhtHostEnvTimezone
  $detected = Get-JhtDetectedTimezone
  $default = $null
  $status = $null
  if ($saved -and $detected -and $saved -ceq $detected) { return }
  if ($saved -and $detected) {
    if ($saved -ceq 'UTC') {
      # the UTC the installer writes where it could not tell: the zone of the computer is proposed instead
      $default = $detected
      $status = Format-JhtText 'host_setup.tz.proposed' $detected (Get-JhtTzNow $detected)
    } else {
      $default = $saved
      $status = Format-JhtText 'host_setup.tz.saved_and_detected' $saved (Get-JhtTzNow $saved) $detected (Get-JhtTzNow $detected)
    }
  } elseif ($saved) {
    if ($saved -cne 'UTC') { return }
    $status = Get-JhtText 'host_setup.tz.not_detected'
  } elseif ($detected) {
    $default = $detected
    $status = Format-JhtText 'host_setup.tz.proposed' $detected (Get-JhtTzNow $detected)
  } else {
    $status = Get-JhtText 'host_setup.tz.not_detected'
  }
  Write-Host ''
  Write-Host (Get-JhtText 'host_setup.timezone_header')
  Write-Host (Get-JhtText 'host_setup.timezone_explain')
  Write-Host $status
  if ($default) { Write-Host (Format-JhtText 'host_setup.tz.how_default' $default) } else { Write-Host (Get-JhtText 'host_setup.tz.how') }
  $label = Get-JhtText 'host_setup.timezone_label'
  $chosen = $null
  $pending = $null
  $ended = $false
  while (-not $chosen -and -not $ended) {
    if ($null -ne $pending) { $typed = $pending; $pending = $null }
    else {
      $typed = Read-JhtTzLine $(if ($default) { "$label [$default]: " } else { "${label}: " })
      if ($null -eq $typed) { $ended = $true; break }
    }
    $typed = $typed.Trim()
    if (-not $typed) {
      if ($default) { $chosen = $default; break }
      Write-Host (Get-JhtText 'host_setup.tz.how')
      continue
    }
    $found = Find-JhtTimezone $typed
    $hits = @($found.Zones)
    if ($hits.Count -eq 0) { Write-Host (Format-JhtText 'host_setup.tz.none' $typed); continue }
    if ($hits.Count -gt 9) { Write-Host (Format-JhtText 'host_setup.tz.too_many' $hits.Count $typed); continue }
    if ($hits.Count -eq 1 -and $found.Exact) {
      if ($hits[0] -ieq $typed) { $chosen = $hits[0]; break }
      $default = $hits[0]
      Write-Host (Format-JhtText 'host_setup.tz.proposed' $hits[0] (Get-JhtTzNow $hits[0]))
      continue
    }
    for ($i = 0; $i -lt $hits.Count; $i++) { Write-Host ('  {0}) {1}' -f ($i + 1), (Format-JhtTzZone $hits[$i])) }
    while ($true) {
      $pick = Read-JhtTzLine ((Format-JhtText 'host_setup.tz.pick' $hits.Count) + ' ')
      if ($null -eq $pick) { $ended = $true; break }
      $pick = $pick.Trim()
      if (-not $pick) { continue }
      if ($pick -cmatch '^[0-9]{1,6}\z') {
        $number = [int]$pick
        if ($number -ge 1 -and $number -le $hits.Count) { $chosen = $hits[$number - 1]; break }
        Write-Host (Format-JhtText 'host_setup.tz.bad_number' $hits.Count)
        continue
      }
      $pending = $pick
      break
    }
  }
  if (-not $chosen -and $ended -and $default) { $chosen = $default }
  if (-not $chosen) {
    Write-Warn (Get-JhtText 'host_setup.timezone_vps_utc')
    return
  }
  if ($chosen -cne $saved) { [void](Set-JhtHostEnvTimezone $chosen) }
  $env:JHT_USER_TZ = $chosen
  Write-Host "${label}: $chosen"
}

# >>> timezone data, made from shared/data/timezones.txt by `python3 tests/wrapper_ps_texts.py --write`: do not edit by hand
function Get-JhtTimezoneLines {
  return @'
C|AD|andorra|andorre
C|AE|united arab emirates|emirati arabi uniti|egyesult arab emirsegek|emiratos arabes unidos|vereinigte arabische emirate|emirats arabes unis|emirados arabes unidos
C|AF|afghanistan|afganisztan|afganistan|afeganistao
C|AG|antigua & barbuda|antigua e barbuda|antigua es barbuda|antigua y barbuda|antigua und barbuda|antigua et barbuda
C|AI|anguilla|anguila
C|AL|albania|albanien|albanie
C|AM|armenia|ormenyorszag|armenien|armenie
C|AO|angola
C|AQ|antarctica|antartide|antarktisz|antartida|antarktis|antarctique
C|AR|argentina|argentinien|argentine
C|AS|american samoa|samoa americane|amerikai szamoa|samoa americana|amerikanisch samoa|samoa americaines
C|AT|austria|ausztria|osterreich|autriche
C|AU|australia|ausztralia|australien|australie
C|AW|aruba
C|AX|aland islands|isole aland|aland szigetek|islas aland|alandinseln|iles aland|ilhas aland
C|AZ|azerbaijan|azerbaigian|azerbajdzsan|azerbaiyan|aserbaidschan|azerbaidjan|azerbaijao
C|BA|bosnia & herzegovina|bosnia ed erzegovina|bosznia hercegovina|bosnia y herzegovina|bosnien und herzegowina|bosnie herzegovine|bosnia e herzegovina
C|BB|barbados|barbade
C|BD|bangladesh|banglades|bangladesch
C|BE|belgium|belgio|belgica|belgien|belgique
C|BF|burkina faso|burquina faso
C|BG|bulgaria|bulgarien|bulgarie
C|BH|bahrain|bahrein|barein
C|BI|burundi
C|BJ|benin
C|BL|st barthelemy|saint barthelemy|san bartolome|sao bartolomeu
C|BM|bermuda|bermudas|bermudes
C|BN|brunei|brunei darussalam
C|BO|bolivia|bolivien|bolivie
C|BQ|caribbean netherlands|caraibi olandesi|holland karib terseg|caribe neerlandes|karibische niederlande|pays bas caribeens|paises baixos caribenhos
C|BR|brazil|brasile|brazilia|brasil|brasilien|bresil
C|BS|bahamas|bahama szigetek
C|BT|bhutan|butan|bhoutan|butao
C|BW|botswana|botsuana
C|BY|belarus|bielorussia|belarusz|bielorrusia|bielorussie|bielorrussia
C|BZ|belize|belice
C|CA|canada|kanada
C|CC|cocos (keeling) islands|isole cocos (keeling)|kokusz (keeling) szigetek|islas cocos|kokosinseln|iles cocos|ilhas cocos (keeling)
C|CD|congo kinshasa|kongo \u2013 kinshasa|republica democratica del congo|kongo kinshasa
C|CF|central african republic|repubblica centrafricana|kozep afrikai koztarsasag|republica centroafricana|zentralafrikanische republik|republique centrafricaine|republica centro africana
C|CG|congo brazzaville|kongo \u2013 brazzaville|congo|kongo brazzaville|republica do congo
C|CH|switzerland|svizzera|svajc|suiza|schweiz|suisse|suica
C|CI|cote d ivoire|costa d avorio|elefantcsontpart|costa do marfim
C|CK|cook islands|isole cook|cook szigetek|islas cook|cookinseln|iles cook|ilhas cook
C|CL|chile|cile|chili
C|CM|cameroon|camerun|kamerun|cameroun|camaroes
C|CN|china|cina|kina|chine
C|CO|colombia|kolumbia|kolumbien|colombie
C|CR|costa rica
C|CU|cuba|kuba
C|CV|cape verde|capo verde|zold foki koztarsasag|cabo verde|cap vert
C|CW|curacao|curazao
C|CX|christmas island|isola christmas|karacsony sziget|isla de navidad|weihnachtsinsel|ile christmas|ilha christmas
C|CY|cyprus|cipro|ciprus|chipre|zypern|chypre
C|CZ|czechia|cechia|csehorszag|chequia|tschechien|tchequie|tchequia
C|DE|germany|germania|nemetorszag|alemania|deutschland|allemagne|alemanha
C|DJ|djibouti|gibuti|dzsibuti|yibuti|dschibuti|djibuti
C|DK|denmark|danimarca|dania|dinamarca|danemark
C|DM|dominica|dominika|dominique
C|DO|dominican republic|repubblica dominicana|dominikai koztarsasag|republica dominicana|dominikanische republik|republique dominicaine
C|DZ|algeria|argelia|algerien|algerie
C|EC|ecuador|equateur|equador
C|EE|estonia|esztorszag|estland|estonie
C|EG|egypt|egitto|egyiptom|egipto|agypten|egypte|egito
C|EH|western sahara|sahara occidentale|nyugat szahara|sahara occidental|westsahara|saara ocidental
C|ER|eritrea|erythree|eritreia
C|ES|spain|spagna|spanyolorszag|espana|spanien|espagne|espanha
C|ET|ethiopia|etiopia|athiopien|ethiopie
C|FI|finland|finlandia|finnorszag|finnland|finlande
C|FJ|fiji|figi|fidzsi|fiyi|fidschi|fidji
C|FK|falkland islands|isole falkland|falkland szigetek|islas malvinas|falklandinseln|iles malouines|ilhas malvinas
C|FM|micronesia|mikronezia|mikronesien|micronesie
C|FO|faroe islands|isole faer oer|feroer szigetek|islas feroe|faroer|iles feroe|ilhas faroe
C|FR|france|francia|franciaorszag|frankreich|franca
C|GA|gabon|gabun|gabao
C|GB|united kingdom|regno unito|egyesult kiralysag|reino unido|vereinigtes konigreich|royaume uni
C|GD|grenada|granada|grenade
C|GE|georgia|gruzia|georgien|georgie
C|GF|french guiana|guyana francese|francia guyana|guayana francesa|franzosisch guayana|guyane francaise|guiana francesa
C|GG|guernsey|guernesey
C|GH|ghana|gana
C|GI|gibraltar|gibilterra
C|GL|greenland|groenlandia|gronland|groenland
C|GM|gambia|gambie
C|GN|guinea|guinee|guine
C|GP|guadeloupe|guadalupa|guadalupe
C|GQ|equatorial guinea|guinea equatoriale|egyenlitoi guinea|guinea ecuatorial|aquatorialguinea|guinee equatoriale|guine equatorial
C|GR|greece|grecia|gorogorszag|griechenland|grece
C|GS|south georgia & south sandwich islands|georgia del sud e sandwich australi|deli georgia es deli sandwich szigetek|islas georgia del sur y sandwich del sur|sudgeorgien und die sudlichen sandwichinseln|georgie du sud et les iles sandwich du sud|ilhas georgia do sul e sandwich do sul
C|GT|guatemala
C|GU|guam
C|GW|guinea bissau|bissau guinea|guinea bisau|guinee bissau|guine bissau
C|GY|guyana|guiana
C|HK|hong kong sar china|ras di hong kong|hongkong kkt|rae de hong kong (china)|sonderverwaltungsregion hongkong|r a s chinoise de hong kong|hong kong rae da china
C|HN|honduras
C|HR|croatia|croazia|horvatorszag|croacia|kroatien|croatie
C|HT|haiti
C|HU|hungary|ungheria|magyarorszag|hungria|ungarn|hongrie
C|ID|indonesia|indonezia|indonesien|indonesie
C|IE|ireland|irlanda|irorszag|irland|irlande
C|IL|israel|israele|izrael
C|IM|isle of man|isola di man|man sziget|isla de man|ile de man|ilha de man
C|IN|india|indien|inde
C|IO|british indian ocean territory|territorio britannico dell oceano indiano|brit indiai oceani terulet|territorio britanico del oceano indico|britisches territorium im indischen ozean|territoire britannique de l ocean indien|territorio britanico do oceano indico
C|IQ|iraq|irak|iraque
C|IR|iran|ira
C|IS|iceland|islanda|izland|islandia|island|islande
C|IT|italy|italia|olaszorszag|italien|italie
C|JE|jersey
C|JM|jamaica|giamaica|jamaika|jamaique
C|JO|jordan|giordania|jordania|jordanien|jordanie
C|JP|japan|giappone|japon|japao
C|KE|kenya|kenia|quenia
C|KG|kyrgyzstan|kirghizistan|kirgizisztan|kirguistan|kirgisistan|kirghizstan|quirguistao
C|KH|cambodia|cambogia|kambodzsa|camboya|kambodscha|cambodge|camboja
C|KI|kiribati|quiribati
C|KM|comoros|comore|comore szigetek|comoras|komoren|comores
C|KN|st kitts & nevis|saint kitts e nevis|saint kitts es nevis|san cristobal y nieves|st kitts und nevis|saint christophe et nieves|sao cristovao e nevis
C|KP|north korea|corea del nord|eszak korea|corea del norte|nordkorea|coree du nord|coreia do norte
C|KR|south korea|corea del sud|del korea|corea del sur|sudkorea|coree du sud|coreia do sul
C|KW|kuwait|kuvait|koweit
C|KY|cayman islands|isole cayman|kajman szigetek|islas caiman|kaimaninseln|iles caimans|ilhas cayman
C|KZ|kazakhstan|kazakistan|kazahsztan|kazajistan|kasachstan|cazaquistao
C|LA|laos|laosz
C|LB|lebanon|libano|libanon|liban
C|LC|st lucia|saint lucia|santa lucia|sainte lucie
C|LI|liechtenstein
C|LK|sri lanka
C|LR|liberia
C|LS|lesotho|lesoto
C|LT|lithuania|lituania|litvania|litauen|lituanie
C|LU|luxembourg|lussemburgo|luxemburg|luxemburgo
C|LV|latvia|lettonia|lettorszag|letonia|lettland|lettonie
C|LY|libya|libia|libyen|libye
C|MA|morocco|marocco|marokko|marruecos|maroc|marrocos
C|MC|monaco
C|MD|moldova|moldavia|republik moldau|moldavie
C|ME|montenegro
C|MF|st martin|saint martin|san martin|sao martinho
C|MG|madagascar|madagaszkar|madagaskar
C|MH|marshall islands|isole marshall|marshall szigetek|islas marshall|marshallinseln|iles marshall|ilhas marshall
C|MK|north macedonia|macedonia del nord|eszak macedonia|macedonia del norte|nordmazedonien|macedoine du nord|macedonia do norte
C|ML|mali
C|MM|myanmar (burma)|myanmar (birmania)|mianmar|myanmar|myanmar (birmanie)|mianmar (birmania)
C|MN|mongolia|mongolei|mongolie
C|MO|macao sar china|ras di macao|makao kkt|rae de macao (china)|sonderverwaltungsregion macau|r a s chinoise de macao|macau rae da china
C|MP|northern mariana islands|isole marianne settentrionali|eszaki mariana szigetek|islas marianas del norte|nordliche marianen|iles mariannes du nord|ilhas marianas do norte
C|MQ|martinique|martinica
C|MR|mauritania|mauretanien|mauritanie
C|MS|montserrat
C|MT|malta|malte
C|MU|mauritius|mauricio|maurice
C|MV|maldives|maldive|maldiv szigetek|maldivas|malediven
C|MW|malawi|malaui
C|MX|mexico|messico|mexiko|mexique
C|MY|malaysia|malajzia|malasia|malaisie
C|MZ|mozambique|mozambico|mozambik|mosambik|mocambique
C|NA|namibia|namibie
C|NC|new caledonia|nuova caledonia|uj kaledonia|nueva caledonia|neukaledonien|nouvelle caledonie|nova caledonia
C|NE|niger
C|NF|norfolk island|isola norfolk|norfolk sziget|isla norfolk|norfolkinsel|ile norfolk|ilha norfolk
C|NG|nigeria
C|NI|nicaragua
C|NL|netherlands|paesi bassi|hollandia|paises bajos|niederlande|pays bas|paises baixos
C|NO|norway|norvegia|noruega|norwegen|norvege
C|NP|nepal
C|NR|nauru
C|NU|niue
C|NZ|new zealand|nuova zelanda|uj zeland|nueva zelanda|neuseeland|nouvelle zelande|nova zelandia
C|OM|oman|oma
C|PA|panama
C|PE|peru|perou
C|PF|french polynesia|polinesia francese|francia polinezia|polinesia francesa|franzosisch polynesien|polynesie francaise
C|PG|papua new guinea|papua nuova guinea|papua uj guinea|papua nueva guinea|papua neuguinea|papouasie nouvelle guinee|papua nova guine
C|PH|philippines|filippine|fulop szigetek|filipinas|philippinen
C|PK|pakistan|pakisztan|paquistao
C|PL|poland|polonia|lengyelorszag|polen|pologne
C|PM|st pierre & miquelon|saint pierre e miquelon|saint pierre es miquelon|san pedro y miquelon|st pierre und miquelon|saint pierre et miquelon|sao pedro e miquelao
C|PN|pitcairn islands|isole pitcairn|pitcairn szigetek|islas pitcairn|pitcairninseln|iles pitcairn|ilhas pitcairn
C|PR|puerto rico|portorico|porto rico
C|PS|palestinian territories|territori palestinesi|palesztin autonomia|territorios palestinos|palastinensische autonomiegebiete|territoires palestiniens
C|PT|portugal|portogallo|portugalia
C|PW|palau|palaos
C|PY|paraguay|paraguai
C|QA|qatar|katar|catar
C|RE|reunion|riunione|la reunion|reuniao
C|RO|romania|rumania|rumanien|roumanie|romenia
C|RS|serbia|szerbia|serbien|serbie|servia
C|RU|russia|oroszorszag|rusia|russland|russie
C|RW|rwanda|ruanda
C|SA|saudi arabia|arabia saudita|szaud arabia|arabia saudi|saudi arabien|arabie saoudite
C|SB|solomon islands|isole salomone|salamon szigetek|islas salomon|salomonen|iles salomon|ilhas salomao
C|SC|seychelles|seychelle szigetek|seychellen|seicheles
C|SD|sudan|szudan|soudan|sudao
C|SE|sweden|svezia|svedorszag|suecia|schweden|suede
C|SG|singapore|szingapur|singapur|singapour|singapura
C|SH|st helena|sant elena|szent ilona|santa elena|sainte helene|santa helena
C|SI|slovenia|szlovenia|eslovenia|slowenien|slovenie
C|SJ|svalbard & jan mayen|svalbard e jan mayen|svalbard es jan mayen|svalbard y jan mayen|spitzbergen und jan mayen|svalbard et jan mayen
C|SK|slovakia|slovacchia|szlovakia|eslovaquia|slowakei|slovaquie
C|SL|sierra leone|sierra leona|serra leoa
C|SM|san marino|saint marin
C|SN|senegal|szenegal
C|SO|somalia|szomalia|somalie
C|SR|suriname|surinam
C|SS|south sudan|sud sudan|del szudan|sudan del sur|sudsudan|soudan du sud|sudao do sul
C|ST|sao tome & principe|sao tome e principe|sao tome es principe|santo tome y principe|sao tome und principe|sao tome et principe
C|SV|el salvador|salvador
C|SX|sint maarten|saint martin (partie neerlandaise)
C|SY|syria|siria|sziria|syrien|syrie
C|SZ|eswatini|szvazifold|esuatini|essuatini
C|TC|turks & caicos islands|isole turks e caicos|turks es caicos szigetek|islas turcas y caicos|turks und caicosinseln|iles turques et caiques|ilhas turcas e caicos
C|TD|chad|ciad|csad|tschad|tchad|chade
C|TF|french southern territories|terre australi francesi|francia deli teruletek|territorios australes franceses|franzosische sud und antarktisgebiete|terres australes francaises|territorios franceses do sul
C|TG|togo
C|TH|thailand|thailandia|thaifold|tailandia|thailande
C|TJ|tajikistan|tagikistan|tadzsikisztan|tayikistan|tadschikistan|tadjikistan|tadjiquistao
C|TK|tokelau
C|TL|timor leste|timor est|kelet timor|timor oriental
C|TM|turkmenistan|turkmenisztan|turcomenistao
C|TN|tunisia|tunezia|tunez|tunesien|tunisie
C|TO|tonga
C|TR|turkiye|turchia|torokorszag|turquia|turkei|turquie
C|TT|trinidad & tobago|trinidad e tobago|trinidad es tobago|trinidad y tobago|trinidad und tobago|trinite et tobago
C|TV|tuvalu
C|TW|taiwan|tajvan
C|TZ|tanzania|tansania|tanzanie
C|UA|ukraine|ucraina|ukrajna|ucrania
C|UG|uganda|ouganda
C|UM|u s outlying islands|isole minori esterne degli stati uniti|az usa lakatlan kulbirtokai|islas menores alejadas de ee uu|amerikanische uberseeinseln|iles mineures eloignees des etats unis|ilhas menores distantes dos eua
C|US|united states|stati uniti|egyesult allamok|estados unidos|vereinigte staaten|etats unis
C|UY|uruguay|uruguai
C|UZ|uzbekistan|uzbegisztan|usbekistan|ouzbekistan|uzbequistao
C|VA|vatican city|citta del vaticano|vatikan|ciudad del vaticano|vatikanstadt|etat de la cite du vatican|cidade do vaticano
C|VC|st vincent & grenadines|saint vincent e grenadine|saint vincent es a grenadine szigetek|san vicente y las granadinas|st vincent und die grenadinen|saint vincent et les grenadines|sao vicente e granadinas
C|VE|venezuela
C|VG|british virgin islands|isole vergini britanniche|brit virgin szigetek|islas virgenes britanicas|britische jungferninseln|iles vierges britanniques|ilhas virgens britanicas
C|VI|u s virgin islands|isole vergini americane|amerikai virgin szigetek|islas virgenes de ee uu|amerikanische jungferninseln|iles vierges des etats unis|ilhas virgens americanas
C|VN|vietnam|viet nam|vietna
C|VU|vanuatu
C|WF|wallis & futuna|wallis e futuna|wallis es futuna|wallis y futuna|wallis und futuna|wallis et futuna
C|WS|samoa|szamoa
C|YE|yemen|jemen|iemen
C|YT|mayotte
C|ZA|south africa|sudafrica|del afrikai koztarsasag|sudafrika|afrique du sud|africa do sul
C|ZM|zambia|sambia|zambie
C|ZW|zimbabwe|zimbabue|simbabwe
A|AE|uae|emirati|emirates
A|CI|ivory coast|costa d avorio|cote d ivoire|elefantenkuste
A|CZ|czech republic|czechia|repubblica ceca|tschechische republik|republique tcheque
A|GB|uk|u k|great britain|britain|england|scotland|wales|inghilterra|scozia|angleterre|inglaterra|anglia
A|KR|korea|south korea|corea del sud
A|MM|burma
A|NL|holland|olanda|holanda|hollande|hollandia
A|RU|russian federation|russland
A|TR|turkey|turkiye|turchia
A|US|usa|u s a|united states of america|america|stati uniti d america|etats unis|eeuu|estados unidos de america
A|VA|vatican|vaticano
Z|AD|Europe/Andorra
Z|AE|Asia/Dubai
Z|AF|Asia/Kabul
Z|AG|America/Antigua
Z|AI|America/Anguilla
Z|AL|Europe/Tirane
Z|AM|Asia/Yerevan
Z|AO|Africa/Luanda
Z|AQ|Antarctica/McMurdo
Z|AQ|Antarctica/Casey
Z|AQ|Antarctica/Davis
Z|AQ|Antarctica/DumontDUrville
Z|AQ|Antarctica/Mawson
Z|AQ|Antarctica/Palmer
Z|AQ|Antarctica/Rothera
Z|AQ|Antarctica/Syowa
Z|AQ|Antarctica/Troll
Z|AQ|Antarctica/Vostok
Z|AR|America/Argentina/Buenos_Aires
Z|AR|America/Argentina/Cordoba
Z|AR|America/Argentina/Salta
Z|AR|America/Argentina/Jujuy
Z|AR|America/Argentina/Tucuman
Z|AR|America/Argentina/Catamarca
Z|AR|America/Argentina/La_Rioja
Z|AR|America/Argentina/San_Juan
Z|AR|America/Argentina/Mendoza
Z|AR|America/Argentina/San_Luis
Z|AR|America/Argentina/Rio_Gallegos
Z|AR|America/Argentina/Ushuaia
Z|AS|Pacific/Pago_Pago
Z|AT|Europe/Vienna
Z|AU|Australia/Lord_Howe
Z|AU|Antarctica/Macquarie
Z|AU|Australia/Hobart
Z|AU|Australia/Melbourne
Z|AU|Australia/Sydney
Z|AU|Australia/Broken_Hill
Z|AU|Australia/Brisbane
Z|AU|Australia/Lindeman
Z|AU|Australia/Adelaide
Z|AU|Australia/Darwin
Z|AU|Australia/Perth
Z|AU|Australia/Eucla
Z|AW|America/Aruba
Z|AX|Europe/Mariehamn
Z|AZ|Asia/Baku
Z|BA|Europe/Sarajevo
Z|BB|America/Barbados
Z|BD|Asia/Dhaka
Z|BE|Europe/Brussels
Z|BF|Africa/Ouagadougou
Z|BG|Europe/Sofia
Z|BH|Asia/Bahrain
Z|BI|Africa/Bujumbura
Z|BJ|Africa/Porto-Novo
Z|BL|America/St_Barthelemy
Z|BM|Atlantic/Bermuda
Z|BN|Asia/Brunei
Z|BO|America/La_Paz
Z|BQ|America/Kralendijk
Z|BR|America/Noronha
Z|BR|America/Belem
Z|BR|America/Fortaleza
Z|BR|America/Recife
Z|BR|America/Araguaina
Z|BR|America/Maceio
Z|BR|America/Bahia
Z|BR|America/Sao_Paulo
Z|BR|America/Campo_Grande
Z|BR|America/Cuiaba
Z|BR|America/Santarem
Z|BR|America/Porto_Velho
Z|BR|America/Boa_Vista
Z|BR|America/Manaus
Z|BR|America/Eirunepe
Z|BR|America/Rio_Branco
Z|BS|America/Nassau
Z|BT|Asia/Thimphu
Z|BW|Africa/Gaborone
Z|BY|Europe/Minsk
Z|BZ|America/Belize
Z|CA|America/St_Johns
Z|CA|America/Halifax
Z|CA|America/Glace_Bay
Z|CA|America/Moncton
Z|CA|America/Goose_Bay
Z|CA|America/Blanc-Sablon
Z|CA|America/Toronto
Z|CA|America/Iqaluit
Z|CA|America/Atikokan
Z|CA|America/Winnipeg
Z|CA|America/Resolute
Z|CA|America/Rankin_Inlet
Z|CA|America/Regina
Z|CA|America/Swift_Current
Z|CA|America/Edmonton
Z|CA|America/Cambridge_Bay
Z|CA|America/Inuvik
Z|CA|America/Vancouver
Z|CA|America/Creston
Z|CA|America/Dawson_Creek
Z|CA|America/Fort_Nelson
Z|CA|America/Whitehorse
Z|CA|America/Dawson
Z|CC|Indian/Cocos
Z|CD|Africa/Kinshasa
Z|CD|Africa/Lubumbashi
Z|CF|Africa/Bangui
Z|CG|Africa/Brazzaville
Z|CH|Europe/Zurich
Z|CI|Africa/Abidjan
Z|CK|Pacific/Rarotonga
Z|CL|America/Santiago
Z|CL|America/Coyhaique
Z|CL|America/Punta_Arenas
Z|CL|Pacific/Easter
Z|CM|Africa/Douala
Z|CN|Asia/Shanghai
Z|CN|Asia/Urumqi
Z|CO|America/Bogota
Z|CR|America/Costa_Rica
Z|CU|America/Havana
Z|CV|Atlantic/Cape_Verde
Z|CW|America/Curacao
Z|CX|Indian/Christmas
Z|CY|Asia/Nicosia
Z|CY|Asia/Famagusta
Z|CZ|Europe/Prague
Z|DE|Europe/Berlin
Z|DE|Europe/Busingen
Z|DJ|Africa/Djibouti
Z|DK|Europe/Copenhagen
Z|DM|America/Dominica
Z|DO|America/Santo_Domingo
Z|DZ|Africa/Algiers
Z|EC|America/Guayaquil
Z|EC|Pacific/Galapagos
Z|EE|Europe/Tallinn
Z|EG|Africa/Cairo
Z|EH|Africa/El_Aaiun
Z|ER|Africa/Asmara
Z|ES|Europe/Madrid
Z|ES|Africa/Ceuta
Z|ES|Atlantic/Canary
Z|ET|Africa/Addis_Ababa
Z|FI|Europe/Helsinki
Z|FJ|Pacific/Fiji
Z|FK|Atlantic/Stanley
Z|FM|Pacific/Chuuk
Z|FM|Pacific/Pohnpei
Z|FM|Pacific/Kosrae
Z|FO|Atlantic/Faroe
Z|FR|Europe/Paris
Z|GA|Africa/Libreville
Z|GB|Europe/London
Z|GD|America/Grenada
Z|GE|Asia/Tbilisi
Z|GF|America/Cayenne
Z|GG|Europe/Guernsey
Z|GH|Africa/Accra
Z|GI|Europe/Gibraltar
Z|GL|America/Nuuk
Z|GL|America/Danmarkshavn
Z|GL|America/Scoresbysund
Z|GL|America/Thule
Z|GM|Africa/Banjul
Z|GN|Africa/Conakry
Z|GP|America/Guadeloupe
Z|GQ|Africa/Malabo
Z|GR|Europe/Athens
Z|GS|Atlantic/South_Georgia
Z|GT|America/Guatemala
Z|GU|Pacific/Guam
Z|GW|Africa/Bissau
Z|GY|America/Guyana
Z|HK|Asia/Hong_Kong
Z|HN|America/Tegucigalpa
Z|HR|Europe/Zagreb
Z|HT|America/Port-au-Prince
Z|HU|Europe/Budapest
Z|ID|Asia/Jakarta
Z|ID|Asia/Pontianak
Z|ID|Asia/Makassar
Z|ID|Asia/Jayapura
Z|IE|Europe/Dublin
Z|IL|Asia/Jerusalem
Z|IM|Europe/Isle_of_Man
Z|IN|Asia/Kolkata
Z|IO|Indian/Chagos
Z|IQ|Asia/Baghdad
Z|IR|Asia/Tehran
Z|IS|Atlantic/Reykjavik
Z|IT|Europe/Rome
Z|JE|Europe/Jersey
Z|JM|America/Jamaica
Z|JO|Asia/Amman
Z|JP|Asia/Tokyo
Z|KE|Africa/Nairobi
Z|KG|Asia/Bishkek
Z|KH|Asia/Phnom_Penh
Z|KI|Pacific/Tarawa
Z|KI|Pacific/Kanton
Z|KI|Pacific/Kiritimati
Z|KM|Indian/Comoro
Z|KN|America/St_Kitts
Z|KP|Asia/Pyongyang
Z|KR|Asia/Seoul
Z|KW|Asia/Kuwait
Z|KY|America/Cayman
Z|KZ|Asia/Almaty
Z|KZ|Asia/Qyzylorda
Z|KZ|Asia/Qostanay
Z|KZ|Asia/Aqtobe
Z|KZ|Asia/Aqtau
Z|KZ|Asia/Atyrau
Z|KZ|Asia/Oral
Z|LA|Asia/Vientiane
Z|LB|Asia/Beirut
Z|LC|America/St_Lucia
Z|LI|Europe/Vaduz
Z|LK|Asia/Colombo
Z|LR|Africa/Monrovia
Z|LS|Africa/Maseru
Z|LT|Europe/Vilnius
Z|LU|Europe/Luxembourg
Z|LV|Europe/Riga
Z|LY|Africa/Tripoli
Z|MA|Africa/Casablanca
Z|MC|Europe/Monaco
Z|MD|Europe/Chisinau
Z|ME|Europe/Podgorica
Z|MF|America/Marigot
Z|MG|Indian/Antananarivo
Z|MH|Pacific/Majuro
Z|MH|Pacific/Kwajalein
Z|MK|Europe/Skopje
Z|ML|Africa/Bamako
Z|MM|Asia/Yangon
Z|MN|Asia/Ulaanbaatar
Z|MN|Asia/Hovd
Z|MO|Asia/Macau
Z|MP|Pacific/Saipan
Z|MQ|America/Martinique
Z|MR|Africa/Nouakchott
Z|MS|America/Montserrat
Z|MT|Europe/Malta
Z|MU|Indian/Mauritius
Z|MV|Indian/Maldives
Z|MW|Africa/Blantyre
Z|MX|America/Mexico_City
Z|MX|America/Cancun
Z|MX|America/Merida
Z|MX|America/Monterrey
Z|MX|America/Matamoros
Z|MX|America/Chihuahua
Z|MX|America/Ciudad_Juarez
Z|MX|America/Ojinaga
Z|MX|America/Mazatlan
Z|MX|America/Bahia_Banderas
Z|MX|America/Hermosillo
Z|MX|America/Tijuana
Z|MY|Asia/Kuala_Lumpur
Z|MY|Asia/Kuching
Z|MZ|Africa/Maputo
Z|NA|Africa/Windhoek
Z|NC|Pacific/Noumea
Z|NE|Africa/Niamey
Z|NF|Pacific/Norfolk
Z|NG|Africa/Lagos
Z|NI|America/Managua
Z|NL|Europe/Amsterdam
Z|NO|Europe/Oslo
Z|NP|Asia/Kathmandu
Z|NR|Pacific/Nauru
Z|NU|Pacific/Niue
Z|NZ|Pacific/Auckland
Z|NZ|Pacific/Chatham
Z|OM|Asia/Muscat
Z|PA|America/Panama
Z|PE|America/Lima
Z|PF|Pacific/Tahiti
Z|PF|Pacific/Marquesas
Z|PF|Pacific/Gambier
Z|PG|Pacific/Port_Moresby
Z|PG|Pacific/Bougainville
Z|PH|Asia/Manila
Z|PK|Asia/Karachi
Z|PL|Europe/Warsaw
Z|PM|America/Miquelon
Z|PN|Pacific/Pitcairn
Z|PR|America/Puerto_Rico
Z|PS|Asia/Gaza
Z|PS|Asia/Hebron
Z|PT|Europe/Lisbon
Z|PT|Atlantic/Madeira
Z|PT|Atlantic/Azores
Z|PW|Pacific/Palau
Z|PY|America/Asuncion
Z|QA|Asia/Qatar
Z|RE|Indian/Reunion
Z|RO|Europe/Bucharest
Z|RS|Europe/Belgrade
Z|RU|Europe/Kaliningrad
Z|RU|Europe/Moscow
Z|UA|Europe/Simferopol
Z|RU|Europe/Kirov
Z|RU|Europe/Volgograd
Z|RU|Europe/Astrakhan
Z|RU|Europe/Saratov
Z|RU|Europe/Ulyanovsk
Z|RU|Europe/Samara
Z|RU|Asia/Yekaterinburg
Z|RU|Asia/Omsk
Z|RU|Asia/Novosibirsk
Z|RU|Asia/Barnaul
Z|RU|Asia/Tomsk
Z|RU|Asia/Novokuznetsk
Z|RU|Asia/Krasnoyarsk
Z|RU|Asia/Irkutsk
Z|RU|Asia/Chita
Z|RU|Asia/Yakutsk
Z|RU|Asia/Khandyga
Z|RU|Asia/Vladivostok
Z|RU|Asia/Ust-Nera
Z|RU|Asia/Magadan
Z|RU|Asia/Sakhalin
Z|RU|Asia/Srednekolymsk
Z|RU|Asia/Kamchatka
Z|RU|Asia/Anadyr
Z|RW|Africa/Kigali
Z|SA|Asia/Riyadh
Z|SB|Pacific/Guadalcanal
Z|SC|Indian/Mahe
Z|SD|Africa/Khartoum
Z|SE|Europe/Stockholm
Z|SG|Asia/Singapore
Z|SH|Atlantic/St_Helena
Z|SI|Europe/Ljubljana
Z|SJ|Arctic/Longyearbyen
Z|SK|Europe/Bratislava
Z|SL|Africa/Freetown
Z|SM|Europe/San_Marino
Z|SN|Africa/Dakar
Z|SO|Africa/Mogadishu
Z|SR|America/Paramaribo
Z|SS|Africa/Juba
Z|ST|Africa/Sao_Tome
Z|SV|America/El_Salvador
Z|SX|America/Lower_Princes
Z|SY|Asia/Damascus
Z|SZ|Africa/Mbabane
Z|TC|America/Grand_Turk
Z|TD|Africa/Ndjamena
Z|TF|Indian/Kerguelen
Z|TG|Africa/Lome
Z|TH|Asia/Bangkok
Z|TJ|Asia/Dushanbe
Z|TK|Pacific/Fakaofo
Z|TL|Asia/Dili
Z|TM|Asia/Ashgabat
Z|TN|Africa/Tunis
Z|TO|Pacific/Tongatapu
Z|TR|Europe/Istanbul
Z|TT|America/Port_of_Spain
Z|TV|Pacific/Funafuti
Z|TW|Asia/Taipei
Z|TZ|Africa/Dar_es_Salaam
Z|UA|Europe/Kyiv
Z|UG|Africa/Kampala
Z|UM|Pacific/Midway
Z|UM|Pacific/Wake
Z|US|America/New_York
Z|US|America/Detroit
Z|US|America/Kentucky/Louisville
Z|US|America/Kentucky/Monticello
Z|US|America/Indiana/Indianapolis
Z|US|America/Indiana/Vincennes
Z|US|America/Indiana/Winamac
Z|US|America/Indiana/Marengo
Z|US|America/Indiana/Petersburg
Z|US|America/Indiana/Vevay
Z|US|America/Chicago
Z|US|America/Indiana/Tell_City
Z|US|America/Indiana/Knox
Z|US|America/Menominee
Z|US|America/North_Dakota/Center
Z|US|America/North_Dakota/New_Salem
Z|US|America/North_Dakota/Beulah
Z|US|America/Denver
Z|US|America/Boise
Z|US|America/Phoenix
Z|US|America/Los_Angeles
Z|US|America/Anchorage
Z|US|America/Juneau
Z|US|America/Sitka
Z|US|America/Metlakatla
Z|US|America/Yakutat
Z|US|America/Nome
Z|US|America/Adak
Z|US|Pacific/Honolulu
Z|UY|America/Montevideo
Z|UZ|Asia/Samarkand
Z|UZ|Asia/Tashkent
Z|VA|Europe/Vatican
Z|VC|America/St_Vincent
Z|VE|America/Caracas
Z|VG|America/Tortola
Z|VI|America/St_Thomas
Z|VN|Asia/Ho_Chi_Minh
Z|VU|Pacific/Efate
Z|WF|Pacific/Wallis
Z|WS|Pacific/Apia
Z|YE|Asia/Aden
Z|YT|Indian/Mayotte
Z|ZA|Africa/Johannesburg
Z|ZM|Africa/Lusaka
Z|ZW|Africa/Harare
N|Europe/Andorra|andorre
N|Asia/Dubai|dubaj
N|Asia/Kabul|kaboul|cabul
N|America/Anguilla|anguila
N|Europe/Tirane|tirana
N|Asia/Yerevan|jerevan|erevan|eriwan
N|Antarctica/DumontDUrville|dumont d urville
N|Antarctica/Syowa|showa
N|Antarctica/Vostok|vosztok|wostok
N|America/Argentina/Tucuman|tucuma
N|Europe/Vienna|becs|viena|wien|vienne
N|Australia/Sydney|sidney
N|Australia/Adelaide|adelaida
N|Asia/Baku|bakou
N|Europe/Sarajevo|szarajevo
N|America/Barbados|la barbade
N|Asia/Dhaka|dacca|dakka|daca
N|Europe/Brussels|bruxelles|brusszel|bruselas|brussel|bruxelas
N|Africa/Ouagadougou|uagadugu
N|Europe/Sofia|szofia
N|Asia/Bahrain|bahrein|barein
N|Africa/Porto-Novo|portonovo
N|America/St_Barthelemy|saint barthelemy|san bartolome|sao bartolomeu
N|Atlantic/Bermuda|bermudas|bermudes
N|Asia/Brunei|brunei darussalam
N|America/Noronha|fernando de noronha
N|America/Belem|belen
N|America/Sao_Paulo|san paolo
N|America/Manaus|manaos
N|Asia/Thimphu|timpu|timbu
N|Europe/Minsk|minszk
N|America/Belize|belice
N|America/St_Johns|san juan de terranova|saint jean de terre neuve
N|Indian/Cocos|kokusz sziget
N|Europe/Zurich|zurigo|zurique
N|Africa/Abidjan|abiyan
N|America/Santiago|santiago de chile
N|Pacific/Easter|pasqua|husvet szigetek|isla de pascua|osterinsel|ile de paques|ilha de pascoa
N|Africa/Douala|duala
N|Asia/Shanghai|sanghaj|xangai
N|Asia/Urumqi|urumcsi
N|America/Havana|l avana|havanna|la habana|la havane
N|Atlantic/Cape_Verde|capo verde|zold foki szigetek|cabo verde|cap vert
N|America/Curacao|curazao
N|Indian/Christmas|karacsony sziget|navidad|weihnachtsinsel
N|Asia/Nicosia|nikosia|nicosie
N|Asia/Famagusta|famagosta|famagouste
N|Europe/Prague|praga|prag
N|Europe/Berlin|berlino|berlim
N|Africa/Djibouti|gibuti|dzsibuti|yibuti|dschibuti|djibuti
N|Europe/Copenhagen|copenaghen|koppenhaga|copenhague|kopenhagen
N|America/Dominica|dominika|dominique
N|America/Santo_Domingo|saint domingue
N|Africa/Algiers|algeri|algir|argel|algier|alger
N|America/Guayaquil|guaiaquil
N|Pacific/Galapagos|galapagos szigetek
N|Europe/Tallinn|tallin
N|Africa/Cairo|il cairo|kairo|el cairo|le caire
N|Africa/El_Aaiun|el ayun|el ajun|laayoune
N|Europe/Madrid|madri
N|Atlantic/Canary|canarie|kanari szigetek|canarias|kanaren|iles canaries
N|Africa/Addis_Ababa|addis abeba|addisz abeba|adis abeba
N|Europe/Helsinki|helsinque
N|Pacific/Fiji|figi|fidzsi|fiyi|fidschi|fidji
N|Pacific/Kosrae|kosrae szigetek
N|Europe/Paris|parigi|parizs
N|Europe/London|londra|londres
N|America/Grenada|granada|grenade
N|Asia/Tbilisi|tbiliszi|tiflis|tbilissi
N|America/Cayenne|caienna|cayena|caiena
N|Europe/Guernsey|guernesey
N|Africa/Accra|acra
N|Europe/Gibraltar|gibilterra
N|America/Scoresbysund|ittoqqortoormiit
N|Africa/Conakry|conakri|conacri
N|America/Guadeloupe|guadalupa|guadalupe
N|Europe/Athens|atene|athen|atenas|athenes
N|Atlantic/South_Georgia|georgia del sud|deli georgia|georgia del sur|sudgeorgien|georgie du sud|georgia do sul
N|Africa/Bissau|bisau
N|America/Guyana|guiana
N|Asia/Hong_Kong|hongkong
N|Europe/Zagreb|zagabria|zagrab
N|America/Port-au-Prince|puerto principe|porto principe
N|Europe/Budapest|budapeste
N|Asia/Jakarta|giacarta|yakarta|jacarta
N|Asia/Makassar|makasar|macassar
N|Europe/Dublin|dublino
N|Asia/Jerusalem|gerusalemme|jeruzsalem|jerusalen
N|Europe/Isle_of_Man|isola di man|man sziget|isla de man|ile de man|ilha de man
N|Asia/Baghdad|bagdad|bagda
N|Asia/Tehran|teheran|teera
N|Atlantic/Reykjavik|reikiavik|reyk\u00adja\u00advik
N|Europe/Rome|roma|rom
N|America/Jamaica|giamaica|jamaika|jamaique
N|Asia/Amman|ama
N|Asia/Tokyo|tokio|toquio
N|Asia/Bishkek|biskek|bischkek|bichkek
N|Pacific/Tarawa|taraua
N|Pacific/Kanton|canton
N|Pacific/Kiritimati|kiritimati sziget
N|Indian/Comoro|comore|komoro|comoras|komoren|comores
N|America/St_Kitts|san cristobal|saint christophe|sao cristovao
N|Asia/Pyongyang|phenjan|pjongjang
N|Asia/Seoul|seul|szoul
N|Asia/Kuwait|kuvait|koweit
N|America/Cayman|kajman szigetek|caiman|kaimaninseln|caimans
N|Asia/Almaty|alma ata
N|Asia/Qyzylorda|kizilorda|kyzylorda|qysylorda|kzyl orda
N|Asia/Qostanay|kosztanaj|kostanai|qostanai
N|Asia/Aqtobe|aktobe|aktioubinsk
N|Asia/Aqtau|aktau|aktaou
N|Asia/Atyrau|atirau|atyraou
N|Asia/Oral|ouralsk
N|Asia/Vientiane|vientian
N|Asia/Beirut|bejrut|beyrouth|beirute
N|America/St_Lucia|santa lucia|sainte lucie
N|Europe/Vilnius|vilna
N|Europe/Luxembourg|lussemburgo|luxemburg|luxemburgo
N|Africa/Tripoli|tripolis|tripoli (libye)
N|Pacific/Majuro|majuro zatony
N|Pacific/Kwajalein|kwajalein zatony
N|Europe/Skopje|szkopje|skopie
N|Asia/Ulaanbaatar|ulan bator|ulanbator|oulan bator
N|Asia/Hovd|chowd
N|Asia/Macau|macao|makao
N|America/Martinique|martinica
N|Africa/Nouakchott|nuakchot
N|Europe/Malta|malte
N|Indian/Mauritius|mauricio|maurice
N|Indian/Maldives|maldive|maldiv szigetek|maldivas|malediven
N|America/Mexico_City|citta del messico|mexikovaros|ciudad de mexico|mexiko stadt|mexico|cidade do mexico
N|America/Bahia_Banderas|bahia de banderas
N|Asia/Kuching|kucseng
N|Pacific/Noumea|numea
N|Europe/Amsterdam|amszterdam|amsterda
N|Pacific/Chatham|chatham szigetek|chatnam
N|Asia/Muscat|mascate|maszkat|maskat
N|Pacific/Tahiti|taiti
N|Pacific/Marquesas|marchesi|marquesas szigetek|marquises
N|Pacific/Gambier|gambier szigetek
N|Asia/Manila|manille
N|Asia/Karachi|karacsi|karatschi
N|Europe/Warsaw|varsavia|varso|varsovia|warschau|varsovie
N|Pacific/Pitcairn|pitcairn szigetek
N|America/Puerto_Rico|portorico|porto rico
N|Europe/Lisbon|lisbona|lisszabon|lisboa|lissabon|lisbonne
N|Atlantic/Madeira|madere
N|Atlantic/Azores|azzorre|azori szigetek|azoren|acores
N|Pacific/Palau|palaos
N|America/Asuncion|assuncao
N|Asia/Qatar|katar|catar
N|Indian/Reunion|la riunione|la reunion|reuniao
N|Europe/Bucharest|bucarest|bukarest|bucareste
N|Europe/Belgrade|belgrado|belgrad
N|Europe/Kaliningrad|kalinyingrad|kaliningrado
N|Europe/Moscow|mosca|moszkva|moscu|moskau|moscou
N|Europe/Simferopol|sinferopoli|szimferopol
N|Europe/Kirov|kirow
N|Europe/Volgograd|volgogrado|wolgograd
N|Europe/Astrakhan|asztrahan|astracan|astrachan|astraca
N|Europe/Saratov|szaratov|saratow
N|Europe/Ulyanovsk|uljanovszk|ulianovsk|uljanowsk|oulianovsk
N|Europe/Samara|szamara
N|Asia/Yekaterinburg|ekaterinburg|jekatyerinburg|ekaterimburgo|jekaterinburg|ekaterinbourg|ecaterimburgo
N|Asia/Omsk|omszk
N|Asia/Novosibirsk|novoszibirszk|nowosibirsk|novossibirsk
N|Asia/Tomsk|tomszk
N|Asia/Novokuznetsk|novokuzneck|novokuznyeck|nowokuznetsk
N|Asia/Krasnoyarsk|krasnojarsk|krasznojarszk|krasnoiarsk
N|Asia/Irkutsk|irkutszk|irkoutsk
N|Asia/Chita|cita|csita|tschita|tchita
N|Asia/Yakutsk|jakutsk|jakutszk|iakoutsk
N|Asia/Khandyga|chandyga|handiga|khandiga
N|Asia/Vladivostok|vlagyivosztok|wladiwostok
N|Asia/Ust-Nera|uszty nyera
N|Asia/Sakhalin|sachalin|szahalin|sajalin|sakhaline|sacalina
N|Asia/Srednekolymsk|szrednekolimszk|srednekolimsk
N|Asia/Kamchatka|kamcsatka|kamtschatka|kamtchatka
N|Asia/Anadyr|anadir
N|Asia/Riyadh|riyad|rijad|riad|riade
N|Africa/Khartoum|khartum|kartum|jartum|cartum
N|Europe/Stockholm|stoccolma|estocolmo
N|Asia/Singapore|szingapur|singapur|singapour|singapura
N|Atlantic/St_Helena|sant elena|szent ilona|santa elena|sainte helene|santa helena
N|Europe/Ljubljana|lubiana|liubliana
N|Europe/Bratislava|pozsony
N|Europe/San_Marino|saint marin
N|Africa/Mogadishu|mogadiscio|mogadischu
N|Africa/Juba|giuba
N|Africa/Sao_Tome|santo tome
N|America/El_Salvador|salvador
N|America/Lower_Princes|lower prince s quarter
N|Asia/Damascus|damasco|damaszkusz|damaskus|damas
N|America/Grand_Turk|gran turca
N|Africa/Ndjamena|n djamena|yamena
N|Asia/Dushanbe|dusanbe|dusambe|duschanbe|douchanbe|duchambe
N|Asia/Ashgabat|asgabat|asjabad|achgabat|asgabate
N|Africa/Tunis|tunisi|tunisz|tunez
N|Europe/Istanbul|isztanbul|estambul|istambul
N|America/Port_of_Spain|puerto espana|port d espagne
N|Asia/Taipei|tajpej|taipeh
N|Africa/Dar_es_Salaam|dar es salam|daressalam
N|Pacific/Midway|midway szigetek
N|Pacific/Wake|wake sziget
N|America/New_York|nueva york|nova york
N|America/Kentucky/Monticello|monticello kentucky|monticello [kentucky]
N|America/Indiana/Vincennes|vincennes indiana|vincennes [indiana]
N|America/Indiana/Winamac|winamac indiana|winamac [indiana]
N|America/Indiana/Marengo|marengo indiana|marengo [indiana]
N|America/Indiana/Petersburg|petersburg indiana|petersburg [indiana]
N|America/Indiana/Vevay|vevay indiana|vevay [indiana]
N|America/Indiana/Tell_City|tell city indiana|tell city [indiana]
N|America/Indiana/Knox|knox indiana|knox [indiana]
N|America/North_Dakota/Center|center dakota del nord|center eszak dakota|center dakota del norte|center north dakota|center (dakota du nord)|center dakota do norte
N|America/North_Dakota/New_Salem|new salem dakota del nord|new salem eszak dakota|new salem dakota del norte|new salem north dakota|new salem (dakota du nord)|new salen dakota do norte
N|America/North_Dakota/Beulah|beulah dakota del nord|beulah eszak dakota|beulah dakota del norte|beulah north dakota|beulah (dakota du nord)|beulah dakota do norte
N|America/Montevideo|montevideu
N|Asia/Samarkand|samarcanda|szamarkand|samarcande
N|Asia/Tashkent|taskent|taschkent|tachkent
N|Europe/Vatican|citta del vaticano|vatikan|el vaticano|le vatican|vaticano
N|America/St_Vincent|saint vincent|san vicente|sao vicente
N|America/St_Thomas|saint thomas
N|Africa/Johannesburg|johannesburgo|joanesburgo
X|Europe/Rome|milano|milan|mailand|napoli|naples|neapel|torino|turin|firenze|florence|venezia|venice|bologna|genova|palermo|bari|catania
X|Europe/Berlin|munchen|munich|monaco di baviera|muenchen|hamburg|amburgo|frankfurt|francoforte|koln|cologne|colonia|koeln|stuttgart|dusseldorf|leipzig|dresden|dresda|nurnberg|norimberga
X|Europe/Paris|lyon|lione|marseille|marsiglia|nice|nizza|toulouse|bordeaux|strasbourg|strasburgo|lille|nantes
X|Europe/Madrid|barcelona|barcellona|valencia|sevilla|siviglia|bilbao|malaga|zaragoza|saragozza
X|Europe/Lisbon|porto|oporto|faro|coimbra
X|Europe/Budapest|debrecen|szeged|pecs|gyor|miskolc
X|Europe/London|manchester|birmingham|liverpool|edinburgh|edimburgo|glasgow|leeds|bristol|cardiff|londra|londres|londen
X|Europe/Zurich|geneva|ginevra|geneve|genf|basel|basilea|bern|berna|lausanne|losanna
X|Europe/Amsterdam|rotterdam|den haag|the hague|l aia|utrecht|eindhoven
X|Europe/Warsaw|krakow|cracovia|gdansk|danzica|wroclaw|breslavia|poznan|lodz
X|Europe/Brussels|antwerp|anversa|anvers|gent|ghent|bruges|liege
X|Europe/Athens|thessaloniki|salonicco|salonique|patras
X|Europe/Prague|brno|ostrava|praha
X|Europe/Vienna|salzburg|graz|linz|innsbruck
X|Europe/Moscow|saint petersburg|san pietroburgo|st petersburg|sankt petersburg|kazan
X|America/New_York|boston|washington|washington dc|philadelphia|miami|atlanta|nyc|orlando|pittsburgh|charlotte
X|America/Chicago|houston|dallas|austin|san antonio|minneapolis|new orleans|nashville
X|America/Denver|salt lake city|albuquerque|boulder
X|America/Los_Angeles|san francisco|san diego|seattle|las vegas|portland|san jose|sacramento|la
X|America/Toronto|montreal|ottawa|quebec|hamilton
X|America/Sao_Paulo|rio de janeiro|rio|brasilia|belo horizonte|salvador|curitiba|porto alegre|recife|fortaleza
X|America/Argentina/Buenos_Aires|buenos aires|rosario|mendoza
X|America/Mexico_City|guadalajara|monterrey|puebla|ciudad de mexico|citta del messico
X|Asia/Kolkata|mumbai|bombay|delhi|new delhi|bangalore|bengaluru|chennai|madras|hyderabad|calcutta|pune
X|Asia/Shanghai|beijing|peking|pechino|pekin|guangzhou|canton|shenzhen|chengdu|wuhan
X|Asia/Tokyo|osaka|kyoto|nagoya|yokohama|sapporo|fukuoka
X|Asia/Seoul|busan|incheon|daegu
X|Asia/Dubai|abu dhabi|sharjah
X|Asia/Jerusalem|tel aviv|haifa|gerusalemme|jerusalen|jerusalem
X|Australia/Sydney|canberra|newcastle|wollongong
X|Australia/Melbourne|geelong
X|Pacific/Auckland|wellington|christchurch|nuova zelanda
X|Africa/Johannesburg|pretoria|durban|soweto
X|America/St_Johns|newfoundland|terranova|terre neuve|neufundland
X|Africa/Cairo|il cairo|alexandria|alessandria d egitto|giza
W|Africa/Abidjan|Greenwich Standard Time
W|Africa/Accra|Greenwich Standard Time
W|Africa/Addis_Ababa|E. Africa Standard Time
W|Africa/Algiers|W. Central Africa Standard Time
W|Africa/Asmara|E. Africa Standard Time
W|Africa/Bamako|Greenwich Standard Time
W|Africa/Bangui|W. Central Africa Standard Time
W|Africa/Banjul|Greenwich Standard Time
W|Africa/Bissau|Greenwich Standard Time
W|Africa/Blantyre|South Africa Standard Time
W|Africa/Brazzaville|W. Central Africa Standard Time
W|Africa/Bujumbura|South Africa Standard Time
W|Africa/Cairo|Egypt Standard Time
W|Africa/Casablanca|Morocco Standard Time
W|Africa/Ceuta|Romance Standard Time
W|Africa/Conakry|Greenwich Standard Time
W|Africa/Dakar|Greenwich Standard Time
W|Africa/Dar_es_Salaam|E. Africa Standard Time
W|Africa/Djibouti|E. Africa Standard Time
W|Africa/Douala|W. Central Africa Standard Time
W|Africa/El_Aaiun|Morocco Standard Time
W|Africa/Freetown|Greenwich Standard Time
W|Africa/Gaborone|South Africa Standard Time
W|Africa/Harare|South Africa Standard Time
W|Africa/Johannesburg|South Africa Standard Time
W|Africa/Juba|South Sudan Standard Time
W|Africa/Kampala|E. Africa Standard Time
W|Africa/Khartoum|Sudan Standard Time
W|Africa/Kigali|South Africa Standard Time
W|Africa/Kinshasa|W. Central Africa Standard Time
W|Africa/Lagos|W. Central Africa Standard Time
W|Africa/Libreville|W. Central Africa Standard Time
W|Africa/Lome|Greenwich Standard Time
W|Africa/Luanda|W. Central Africa Standard Time
W|Africa/Lubumbashi|South Africa Standard Time
W|Africa/Lusaka|South Africa Standard Time
W|Africa/Malabo|W. Central Africa Standard Time
W|Africa/Maputo|South Africa Standard Time
W|Africa/Maseru|South Africa Standard Time
W|Africa/Mbabane|South Africa Standard Time
W|Africa/Mogadishu|E. Africa Standard Time
W|Africa/Monrovia|Greenwich Standard Time
W|Africa/Nairobi|E. Africa Standard Time
W|Africa/Ndjamena|W. Central Africa Standard Time
W|Africa/Niamey|W. Central Africa Standard Time
W|Africa/Nouakchott|Greenwich Standard Time
W|Africa/Ouagadougou|Greenwich Standard Time
W|Africa/Porto-Novo|W. Central Africa Standard Time
W|Africa/Sao_Tome|Sao Tome Standard Time
W|Africa/Tripoli|Libya Standard Time
W|Africa/Tunis|W. Central Africa Standard Time
W|Africa/Windhoek|Namibia Standard Time
W|America/Adak|Aleutian Standard Time
W|America/Anchorage|Alaskan Standard Time
W|America/Anguilla|SA Western Standard Time
W|America/Antigua|SA Western Standard Time
W|America/Araguaina|Tocantins Standard Time
W|America/Argentina/Buenos_Aires|Argentina Standard Time
W|America/Argentina/Catamarca|Argentina Standard Time
W|America/Argentina/Cordoba|Argentina Standard Time
W|America/Argentina/Jujuy|Argentina Standard Time
W|America/Argentina/La_Rioja|Argentina Standard Time
W|America/Argentina/Mendoza|Argentina Standard Time
W|America/Argentina/Rio_Gallegos|Argentina Standard Time
W|America/Argentina/Salta|Argentina Standard Time
W|America/Argentina/San_Juan|Argentina Standard Time
W|America/Argentina/San_Luis|Argentina Standard Time
W|America/Argentina/Tucuman|Argentina Standard Time
W|America/Argentina/Ushuaia|Argentina Standard Time
W|America/Aruba|SA Western Standard Time
W|America/Asuncion|Paraguay Standard Time
W|America/Atikokan|SA Pacific Standard Time
W|America/Bahia|Bahia Standard Time
W|America/Bahia_Banderas|Central Standard Time (Mexico)
W|America/Barbados|SA Western Standard Time
W|America/Belem|SA Eastern Standard Time
W|America/Belize|Central America Standard Time
W|America/Blanc-Sablon|SA Western Standard Time
W|America/Boa_Vista|SA Western Standard Time
W|America/Bogota|SA Pacific Standard Time
W|America/Boise|Mountain Standard Time
W|America/Cambridge_Bay|Mountain Standard Time
W|America/Campo_Grande|Central Brazilian Standard Time
W|America/Cancun|Eastern Standard Time (Mexico)
W|America/Caracas|Venezuela Standard Time
W|America/Cayenne|SA Eastern Standard Time
W|America/Cayman|SA Pacific Standard Time
W|America/Chicago|Central Standard Time
W|America/Chihuahua|Central Standard Time (Mexico)
W|America/Ciudad_Juarez|Mountain Standard Time
W|America/Costa_Rica|Central America Standard Time
W|America/Creston|US Mountain Standard Time
W|America/Cuiaba|Central Brazilian Standard Time
W|America/Curacao|SA Western Standard Time
W|America/Danmarkshavn|Greenwich Standard Time
W|America/Dawson|Yukon Standard Time
W|America/Dawson_Creek|US Mountain Standard Time
W|America/Denver|Mountain Standard Time
W|America/Detroit|Eastern Standard Time
W|America/Dominica|SA Western Standard Time
W|America/Edmonton|Mountain Standard Time
W|America/Eirunepe|SA Pacific Standard Time
W|America/El_Salvador|Central America Standard Time
W|America/Fort_Nelson|US Mountain Standard Time
W|America/Fortaleza|SA Eastern Standard Time
W|America/Glace_Bay|Atlantic Standard Time
W|America/Goose_Bay|Atlantic Standard Time
W|America/Grand_Turk|Turks And Caicos Standard Time
W|America/Grenada|SA Western Standard Time
W|America/Guadeloupe|SA Western Standard Time
W|America/Guatemala|Central America Standard Time
W|America/Guayaquil|SA Pacific Standard Time
W|America/Guyana|SA Western Standard Time
W|America/Halifax|Atlantic Standard Time
W|America/Havana|Cuba Standard Time
W|America/Hermosillo|US Mountain Standard Time
W|America/Indiana/Indianapolis|US Eastern Standard Time
W|America/Indiana/Knox|Central Standard Time
W|America/Indiana/Marengo|US Eastern Standard Time
W|America/Indiana/Petersburg|Eastern Standard Time
W|America/Indiana/Tell_City|Central Standard Time
W|America/Indiana/Vevay|US Eastern Standard Time
W|America/Indiana/Vincennes|Eastern Standard Time
W|America/Indiana/Winamac|Eastern Standard Time
W|America/Inuvik|Mountain Standard Time
W|America/Iqaluit|Eastern Standard Time
W|America/Jamaica|SA Pacific Standard Time
W|America/Juneau|Alaskan Standard Time
W|America/Kentucky/Louisville|Eastern Standard Time
W|America/Kentucky/Monticello|Eastern Standard Time
W|America/Kralendijk|SA Western Standard Time
W|America/La_Paz|SA Western Standard Time
W|America/Lima|SA Pacific Standard Time
W|America/Los_Angeles|Pacific Standard Time
W|America/Lower_Princes|SA Western Standard Time
W|America/Maceio|SA Eastern Standard Time
W|America/Managua|Central America Standard Time
W|America/Manaus|SA Western Standard Time
W|America/Marigot|SA Western Standard Time
W|America/Martinique|SA Western Standard Time
W|America/Matamoros|Central Standard Time
W|America/Mazatlan|Mountain Standard Time (Mexico)
W|America/Menominee|Central Standard Time
W|America/Merida|Central Standard Time (Mexico)
W|America/Metlakatla|Alaskan Standard Time
W|America/Mexico_City|Central Standard Time (Mexico)
W|America/Miquelon|Saint Pierre Standard Time
W|America/Moncton|Atlantic Standard Time
W|America/Monterrey|Central Standard Time (Mexico)
W|America/Montevideo|Montevideo Standard Time
W|America/Montserrat|SA Western Standard Time
W|America/Nassau|Eastern Standard Time
W|America/New_York|Eastern Standard Time
W|America/Nome|Alaskan Standard Time
W|America/Noronha|UTC-02
W|America/North_Dakota/Beulah|Central Standard Time
W|America/North_Dakota/Center|Central Standard Time
W|America/North_Dakota/New_Salem|Central Standard Time
W|America/Nuuk|Greenland Standard Time
W|America/Ojinaga|Central Standard Time
W|America/Panama|SA Pacific Standard Time
W|America/Paramaribo|SA Eastern Standard Time
W|America/Phoenix|US Mountain Standard Time
W|America/Port-au-Prince|Haiti Standard Time
W|America/Port_of_Spain|SA Western Standard Time
W|America/Porto_Velho|SA Western Standard Time
W|America/Puerto_Rico|SA Western Standard Time
W|America/Punta_Arenas|Magallanes Standard Time
W|America/Rankin_Inlet|Central Standard Time
W|America/Recife|SA Eastern Standard Time
W|America/Regina|Canada Central Standard Time
W|America/Resolute|Central Standard Time
W|America/Rio_Branco|SA Pacific Standard Time
W|America/Santarem|SA Eastern Standard Time
W|America/Santiago|Pacific SA Standard Time
W|America/Santo_Domingo|SA Western Standard Time
W|America/Sao_Paulo|E. South America Standard Time
W|America/Scoresbysund|Azores Standard Time
W|America/Sitka|Alaskan Standard Time
W|America/St_Barthelemy|SA Western Standard Time
W|America/St_Johns|Newfoundland Standard Time
W|America/St_Kitts|SA Western Standard Time
W|America/St_Lucia|SA Western Standard Time
W|America/St_Thomas|SA Western Standard Time
W|America/St_Vincent|SA Western Standard Time
W|America/Swift_Current|Canada Central Standard Time
W|America/Tegucigalpa|Central America Standard Time
W|America/Thule|Atlantic Standard Time
W|America/Tijuana|Pacific Standard Time (Mexico)
W|America/Toronto|Eastern Standard Time
W|America/Tortola|SA Western Standard Time
W|America/Vancouver|Pacific Standard Time
W|America/Whitehorse|Yukon Standard Time
W|America/Winnipeg|Central Standard Time
W|America/Yakutat|Alaskan Standard Time
W|Antarctica/Casey|Central Pacific Standard Time
W|Antarctica/Davis|SE Asia Standard Time
W|Antarctica/DumontDUrville|West Pacific Standard Time
W|Antarctica/Macquarie|Tasmania Standard Time
W|Antarctica/Mawson|West Asia Standard Time
W|Antarctica/McMurdo|New Zealand Standard Time
W|Antarctica/Palmer|SA Eastern Standard Time
W|Antarctica/Rothera|SA Eastern Standard Time
W|Antarctica/Syowa|E. Africa Standard Time
W|Antarctica/Vostok|Central Asia Standard Time
W|Arctic/Longyearbyen|W. Europe Standard Time
W|Asia/Aden|Arab Standard Time
W|Asia/Almaty|Central Asia Standard Time
W|Asia/Amman|Jordan Standard Time
W|Asia/Anadyr|Russia Time Zone 11
W|Asia/Aqtau|West Asia Standard Time
W|Asia/Aqtobe|West Asia Standard Time
W|Asia/Ashgabat|West Asia Standard Time
W|Asia/Atyrau|West Asia Standard Time
W|Asia/Baghdad|Arabic Standard Time
W|Asia/Bahrain|Arab Standard Time
W|Asia/Baku|Azerbaijan Standard Time
W|Asia/Bangkok|SE Asia Standard Time
W|Asia/Barnaul|Altai Standard Time
W|Asia/Beirut|Middle East Standard Time
W|Asia/Bishkek|Central Asia Standard Time
W|Asia/Brunei|Singapore Standard Time
W|Asia/Chita|Transbaikal Standard Time
W|Asia/Colombo|Sri Lanka Standard Time
W|Asia/Damascus|Syria Standard Time
W|Asia/Dhaka|Bangladesh Standard Time
W|Asia/Dili|Tokyo Standard Time
W|Asia/Dubai|Arabian Standard Time
W|Asia/Dushanbe|West Asia Standard Time
W|Asia/Famagusta|GTB Standard Time
W|Asia/Gaza|West Bank Standard Time
W|Asia/Hebron|West Bank Standard Time
W|Asia/Ho_Chi_Minh|SE Asia Standard Time
W|Asia/Hong_Kong|China Standard Time
W|Asia/Hovd|W. Mongolia Standard Time
W|Asia/Irkutsk|North Asia East Standard Time
W|Asia/Jakarta|SE Asia Standard Time
W|Asia/Jayapura|Tokyo Standard Time
W|Asia/Jerusalem|Israel Standard Time
W|Asia/Kabul|Afghanistan Standard Time
W|Asia/Kamchatka|Russia Time Zone 11
W|Asia/Karachi|Pakistan Standard Time
W|Asia/Kathmandu|Nepal Standard Time
W|Asia/Khandyga|Yakutsk Standard Time
W|Asia/Kolkata|India Standard Time
W|Asia/Krasnoyarsk|North Asia Standard Time
W|Asia/Kuala_Lumpur|Singapore Standard Time
W|Asia/Kuching|Singapore Standard Time
W|Asia/Kuwait|Arab Standard Time
W|Asia/Macau|China Standard Time
W|Asia/Magadan|Magadan Standard Time
W|Asia/Makassar|Singapore Standard Time
W|Asia/Manila|Singapore Standard Time
W|Asia/Muscat|Arabian Standard Time
W|Asia/Nicosia|GTB Standard Time
W|Asia/Novokuznetsk|North Asia Standard Time
W|Asia/Novosibirsk|N. Central Asia Standard Time
W|Asia/Omsk|Omsk Standard Time
W|Asia/Oral|West Asia Standard Time
W|Asia/Phnom_Penh|SE Asia Standard Time
W|Asia/Pontianak|SE Asia Standard Time
W|Asia/Pyongyang|North Korea Standard Time
W|Asia/Qatar|Arab Standard Time
W|Asia/Qostanay|Central Asia Standard Time
W|Asia/Qyzylorda|Qyzylorda Standard Time
W|Asia/Riyadh|Arab Standard Time
W|Asia/Sakhalin|Sakhalin Standard Time
W|Asia/Samarkand|West Asia Standard Time
W|Asia/Seoul|Korea Standard Time
W|Asia/Shanghai|China Standard Time
W|Asia/Singapore|Singapore Standard Time
W|Asia/Srednekolymsk|Russia Time Zone 10
W|Asia/Taipei|Taipei Standard Time
W|Asia/Tashkent|West Asia Standard Time
W|Asia/Tbilisi|Georgian Standard Time
W|Asia/Tehran|Iran Standard Time
W|Asia/Thimphu|Bangladesh Standard Time
W|Asia/Tokyo|Tokyo Standard Time
W|Asia/Tomsk|Tomsk Standard Time
W|Asia/Ulaanbaatar|Ulaanbaatar Standard Time
W|Asia/Urumqi|Central Asia Standard Time
W|Asia/Ust-Nera|Vladivostok Standard Time
W|Asia/Vientiane|SE Asia Standard Time
W|Asia/Vladivostok|Vladivostok Standard Time
W|Asia/Yakutsk|Yakutsk Standard Time
W|Asia/Yangon|Myanmar Standard Time
W|Asia/Yekaterinburg|Ekaterinburg Standard Time
W|Asia/Yerevan|Caucasus Standard Time
W|Atlantic/Azores|Azores Standard Time
W|Atlantic/Bermuda|Atlantic Standard Time
W|Atlantic/Canary|GMT Standard Time
W|Atlantic/Cape_Verde|Cape Verde Standard Time
W|Atlantic/Faroe|GMT Standard Time
W|Atlantic/Madeira|GMT Standard Time
W|Atlantic/Reykjavik|Greenwich Standard Time
W|Atlantic/South_Georgia|UTC-02
W|Atlantic/St_Helena|Greenwich Standard Time
W|Atlantic/Stanley|SA Eastern Standard Time
W|Australia/Adelaide|Cen. Australia Standard Time
W|Australia/Brisbane|E. Australia Standard Time
W|Australia/Broken_Hill|Cen. Australia Standard Time
W|Australia/Darwin|AUS Central Standard Time
W|Australia/Eucla|Aus Central W. Standard Time
W|Australia/Hobart|Tasmania Standard Time
W|Australia/Lindeman|E. Australia Standard Time
W|Australia/Lord_Howe|Lord Howe Standard Time
W|Australia/Melbourne|AUS Eastern Standard Time
W|Australia/Perth|W. Australia Standard Time
W|Australia/Sydney|AUS Eastern Standard Time
W|Europe/Amsterdam|W. Europe Standard Time
W|Europe/Andorra|W. Europe Standard Time
W|Europe/Astrakhan|Astrakhan Standard Time
W|Europe/Athens|GTB Standard Time
W|Europe/Belgrade|Central Europe Standard Time
W|Europe/Berlin|W. Europe Standard Time
W|Europe/Bratislava|Central Europe Standard Time
W|Europe/Brussels|Romance Standard Time
W|Europe/Bucharest|GTB Standard Time
W|Europe/Budapest|Central Europe Standard Time
W|Europe/Busingen|W. Europe Standard Time
W|Europe/Chisinau|E. Europe Standard Time
W|Europe/Copenhagen|Romance Standard Time
W|Europe/Dublin|GMT Standard Time
W|Europe/Gibraltar|W. Europe Standard Time
W|Europe/Guernsey|GMT Standard Time
W|Europe/Helsinki|FLE Standard Time
W|Europe/Isle_of_Man|GMT Standard Time
W|Europe/Istanbul|Turkey Standard Time
W|Europe/Jersey|GMT Standard Time
W|Europe/Kaliningrad|Kaliningrad Standard Time
W|Europe/Kirov|Russian Standard Time
W|Europe/Kyiv|FLE Standard Time
W|Europe/Lisbon|GMT Standard Time
W|Europe/Ljubljana|Central Europe Standard Time
W|Europe/London|GMT Standard Time
W|Europe/Luxembourg|W. Europe Standard Time
W|Europe/Madrid|Romance Standard Time
W|Europe/Malta|W. Europe Standard Time
W|Europe/Mariehamn|FLE Standard Time
W|Europe/Minsk|Belarus Standard Time
W|Europe/Monaco|W. Europe Standard Time
W|Europe/Moscow|Russian Standard Time
W|Europe/Oslo|W. Europe Standard Time
W|Europe/Paris|Romance Standard Time
W|Europe/Podgorica|Central Europe Standard Time
W|Europe/Prague|Central Europe Standard Time
W|Europe/Riga|FLE Standard Time
W|Europe/Rome|W. Europe Standard Time
W|Europe/Samara|Russia Time Zone 3
W|Europe/San_Marino|W. Europe Standard Time
W|Europe/Sarajevo|Central European Standard Time
W|Europe/Saratov|Saratov Standard Time
W|Europe/Simferopol|Russian Standard Time
W|Europe/Skopje|Central European Standard Time
W|Europe/Sofia|FLE Standard Time
W|Europe/Stockholm|W. Europe Standard Time
W|Europe/Tallinn|FLE Standard Time
W|Europe/Tirane|Central Europe Standard Time
W|Europe/Ulyanovsk|Astrakhan Standard Time
W|Europe/Vaduz|W. Europe Standard Time
W|Europe/Vatican|W. Europe Standard Time
W|Europe/Vienna|W. Europe Standard Time
W|Europe/Vilnius|FLE Standard Time
W|Europe/Volgograd|Volgograd Standard Time
W|Europe/Warsaw|Central European Standard Time
W|Europe/Zagreb|Central European Standard Time
W|Europe/Zurich|W. Europe Standard Time
W|Indian/Antananarivo|E. Africa Standard Time
W|Indian/Chagos|Central Asia Standard Time
W|Indian/Christmas|SE Asia Standard Time
W|Indian/Cocos|Myanmar Standard Time
W|Indian/Comoro|E. Africa Standard Time
W|Indian/Kerguelen|West Asia Standard Time
W|Indian/Mahe|Mauritius Standard Time
W|Indian/Maldives|West Asia Standard Time
W|Indian/Mauritius|Mauritius Standard Time
W|Indian/Mayotte|E. Africa Standard Time
W|Indian/Reunion|Mauritius Standard Time
W|Pacific/Apia|Samoa Standard Time
W|Pacific/Auckland|New Zealand Standard Time
W|Pacific/Bougainville|Bougainville Standard Time
W|Pacific/Chatham|Chatham Islands Standard Time
W|Pacific/Chuuk|West Pacific Standard Time
W|Pacific/Easter|Easter Island Standard Time
W|Pacific/Efate|Central Pacific Standard Time
W|Pacific/Fakaofo|UTC+13
W|Pacific/Fiji|Fiji Standard Time
W|Pacific/Funafuti|UTC+12
W|Pacific/Galapagos|Central America Standard Time
W|Pacific/Gambier|UTC-09
W|Pacific/Guadalcanal|Central Pacific Standard Time
W|Pacific/Guam|West Pacific Standard Time
W|Pacific/Honolulu|Hawaiian Standard Time
W|Pacific/Kanton|UTC+13
W|Pacific/Kiritimati|Line Islands Standard Time
W|Pacific/Kosrae|Central Pacific Standard Time
W|Pacific/Kwajalein|UTC+12
W|Pacific/Majuro|UTC+12
W|Pacific/Marquesas|Marquesas Standard Time
W|Pacific/Midway|UTC-11
W|Pacific/Nauru|UTC+12
W|Pacific/Niue|UTC-11
W|Pacific/Norfolk|Norfolk Standard Time
W|Pacific/Noumea|Central Pacific Standard Time
W|Pacific/Pago_Pago|UTC-11
W|Pacific/Palau|Tokyo Standard Time
W|Pacific/Pitcairn|UTC-08
W|Pacific/Pohnpei|Central Pacific Standard Time
W|Pacific/Port_Moresby|West Pacific Standard Time
W|Pacific/Rarotonga|Hawaiian Standard Time
W|Pacific/Saipan|West Pacific Standard Time
W|Pacific/Tahiti|Hawaiian Standard Time
W|Pacific/Tarawa|UTC+12
W|Pacific/Tongatapu|Tonga Standard Time
W|Pacific/Wake|UTC+12
W|Pacific/Wallis|UTC+12
P|AUS Central Standard Time|Australia/Darwin
P|AUS Eastern Standard Time|Australia/Sydney
P|Afghanistan Standard Time|Asia/Kabul
P|Alaskan Standard Time|America/Anchorage
P|Aleutian Standard Time|America/Adak
P|Altai Standard Time|Asia/Barnaul
P|Arab Standard Time|Asia/Riyadh
P|Arabian Standard Time|Asia/Dubai
P|Arabic Standard Time|Asia/Baghdad
P|Argentina Standard Time|America/Argentina/Buenos_Aires
P|Astrakhan Standard Time|Europe/Astrakhan
P|Atlantic Standard Time|America/Halifax
P|Aus Central W. Standard Time|Australia/Eucla
P|Azerbaijan Standard Time|Asia/Baku
P|Azores Standard Time|Atlantic/Azores
P|Bahia Standard Time|America/Bahia
P|Bangladesh Standard Time|Asia/Dhaka
P|Belarus Standard Time|Europe/Minsk
P|Bougainville Standard Time|Pacific/Bougainville
P|Canada Central Standard Time|America/Regina
P|Cape Verde Standard Time|Atlantic/Cape_Verde
P|Caucasus Standard Time|Asia/Yerevan
P|Cen. Australia Standard Time|Australia/Adelaide
P|Central America Standard Time|America/Guatemala
P|Central Asia Standard Time|Asia/Almaty
P|Central Brazilian Standard Time|America/Cuiaba
P|Central Europe Standard Time|Europe/Budapest
P|Central European Standard Time|Europe/Warsaw
P|Central Pacific Standard Time|Pacific/Guadalcanal
P|Central Standard Time|America/Chicago
P|Central Standard Time (Mexico)|America/Mexico_City
P|Chatham Islands Standard Time|Pacific/Chatham
P|China Standard Time|Asia/Shanghai
P|Cuba Standard Time|America/Havana
P|E. Africa Standard Time|Africa/Nairobi
P|E. Australia Standard Time|Australia/Brisbane
P|E. Europe Standard Time|Europe/Chisinau
P|E. South America Standard Time|America/Sao_Paulo
P|Easter Island Standard Time|Pacific/Easter
P|Eastern Standard Time|America/New_York
P|Eastern Standard Time (Mexico)|America/Cancun
P|Egypt Standard Time|Africa/Cairo
P|Ekaterinburg Standard Time|Asia/Yekaterinburg
P|FLE Standard Time|Europe/Helsinki
P|Fiji Standard Time|Pacific/Fiji
P|GMT Standard Time|Europe/London
P|GTB Standard Time|Europe/Bucharest
P|Georgian Standard Time|Asia/Tbilisi
P|Greenland Standard Time|America/Nuuk
P|Greenwich Standard Time|Atlantic/Reykjavik
P|Haiti Standard Time|America/Port-au-Prince
P|Hawaiian Standard Time|Pacific/Honolulu
P|India Standard Time|Asia/Kolkata
P|Iran Standard Time|Asia/Tehran
P|Israel Standard Time|Asia/Jerusalem
P|Jordan Standard Time|Asia/Amman
P|Kaliningrad Standard Time|Europe/Kaliningrad
P|Korea Standard Time|Asia/Seoul
P|Libya Standard Time|Africa/Tripoli
P|Line Islands Standard Time|Pacific/Kiritimati
P|Lord Howe Standard Time|Australia/Lord_Howe
P|Magadan Standard Time|Asia/Magadan
P|Magallanes Standard Time|America/Punta_Arenas
P|Marquesas Standard Time|Pacific/Marquesas
P|Mauritius Standard Time|Indian/Mauritius
P|Middle East Standard Time|Asia/Beirut
P|Montevideo Standard Time|America/Montevideo
P|Morocco Standard Time|Africa/Casablanca
P|Mountain Standard Time|America/Denver
P|Mountain Standard Time (Mexico)|America/Mazatlan
P|Myanmar Standard Time|Asia/Yangon
P|N. Central Asia Standard Time|Asia/Novosibirsk
P|Namibia Standard Time|Africa/Windhoek
P|Nepal Standard Time|Asia/Kathmandu
P|New Zealand Standard Time|Pacific/Auckland
P|Newfoundland Standard Time|America/St_Johns
P|Norfolk Standard Time|Pacific/Norfolk
P|North Asia East Standard Time|Asia/Irkutsk
P|North Asia Standard Time|Asia/Krasnoyarsk
P|North Korea Standard Time|Asia/Pyongyang
P|Omsk Standard Time|Asia/Omsk
P|Pacific SA Standard Time|America/Santiago
P|Pacific Standard Time|America/Los_Angeles
P|Pacific Standard Time (Mexico)|America/Tijuana
P|Pakistan Standard Time|Asia/Karachi
P|Paraguay Standard Time|America/Asuncion
P|Qyzylorda Standard Time|Asia/Qyzylorda
P|Romance Standard Time|Europe/Paris
P|Russia Time Zone 10|Asia/Srednekolymsk
P|Russia Time Zone 11|Asia/Kamchatka
P|Russia Time Zone 3|Europe/Samara
P|Russian Standard Time|Europe/Moscow
P|SA Eastern Standard Time|America/Cayenne
P|SA Pacific Standard Time|America/Bogota
P|SA Western Standard Time|America/La_Paz
P|SE Asia Standard Time|Asia/Bangkok
P|Saint Pierre Standard Time|America/Miquelon
P|Sakhalin Standard Time|Asia/Sakhalin
P|Samoa Standard Time|Pacific/Apia
P|Sao Tome Standard Time|Africa/Sao_Tome
P|Saratov Standard Time|Europe/Saratov
P|Singapore Standard Time|Asia/Singapore
P|South Africa Standard Time|Africa/Johannesburg
P|South Sudan Standard Time|Africa/Juba
P|Sri Lanka Standard Time|Asia/Colombo
P|Sudan Standard Time|Africa/Khartoum
P|Syria Standard Time|Asia/Damascus
P|Taipei Standard Time|Asia/Taipei
P|Tasmania Standard Time|Australia/Hobart
P|Tocantins Standard Time|America/Araguaina
P|Tokyo Standard Time|Asia/Tokyo
P|Tomsk Standard Time|Asia/Tomsk
P|Tonga Standard Time|Pacific/Tongatapu
P|Transbaikal Standard Time|Asia/Chita
P|Turkey Standard Time|Europe/Istanbul
P|Turks And Caicos Standard Time|America/Grand_Turk
P|US Eastern Standard Time|America/Indiana/Indianapolis
P|US Mountain Standard Time|America/Phoenix
P|UTC|UTC
P|UTC+12|Pacific/Funafuti
P|UTC+13|Pacific/Fakaofo
P|UTC-02|America/Noronha
P|UTC-08|Pacific/Pitcairn
P|UTC-09|Pacific/Gambier
P|UTC-11|Pacific/Midway
P|Ulaanbaatar Standard Time|Asia/Ulaanbaatar
P|Venezuela Standard Time|America/Caracas
P|Vladivostok Standard Time|Asia/Vladivostok
P|Volgograd Standard Time|Europe/Volgograd
P|W. Australia Standard Time|Australia/Perth
P|W. Central Africa Standard Time|Africa/Lagos
P|W. Europe Standard Time|Europe/Berlin
P|W. Mongolia Standard Time|Asia/Hovd
P|West Asia Standard Time|Asia/Tashkent
P|West Bank Standard Time|Asia/Hebron
P|West Pacific Standard Time|Pacific/Port_Moresby
P|Yakutsk Standard Time|Asia/Yakutsk
P|Yukon Standard Time|America/Whitehorse
F|\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d9\u00da\u00db\u00dc\u00dd\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f9\u00fa\u00fb\u00fc\u00fd\u00ff\u0100\u0101\u0102\u0103\u0104\u0105\u0106\u0107\u0108\u0109\u010a\u010b\u010c\u010d\u010e\u010f\u0112\u0113\u0114\u0115\u0116\u0117\u0118\u0119\u011a\u011b\u011c\u011d\u011e\u011f\u0120\u0121\u0122\u0123\u0124\u0125\u0128\u0129\u012a\u012b\u012c\u012d\u012e\u012f\u0130\u0134\u0135\u0136\u0137\u0139\u013a\u013b\u013c\u013d\u013e\u0143\u0144\u0145\u0146\u0147\u0148\u014c\u014d\u014e\u014f\u0150\u0151\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161\u0162\u0163\u0164\u0165\u0168\u0169\u016a\u016b\u016c\u016d\u016e\u016f\u0170\u0171\u0172\u0173\u0174\u0175\u0176\u0177\u0178\u0179\u017a\u017b\u017c\u017d\u017e\u01a0\u01a1\u01af\u01b0\u01cd\u01ce\u01cf\u01d0\u01d1\u01d2\u01d3\u01d4\u01d5\u01d6\u01d7\u01d8\u01d9\u01da\u01db\u01dc\u01de\u01df\u01e0\u01e1\u01e6\u01e7\u01e8\u01e9\u01ea\u01eb\u01ec\u01ed\u01f0\u01f4\u01f5\u01f8\u01f9\u01fa\u01fb\u0200\u0201\u0202\u0203\u0204\u0205\u0206\u0207\u0208\u0209\u020a\u020b\u020c\u020d\u020e\u020f\u0210\u0211\u0212\u0213\u0214\u0215\u0216\u0217\u0218\u0219\u021a\u021b\u021e\u021f\u0226\u0227\u0228\u0229\u022a\u022b\u022c\u022d\u022e\u022f\u0230\u0231\u0232\u0233\u1e00\u1e01\u1e02\u1e03\u1e04\u1e05\u1e06\u1e07\u1e08\u1e09\u1e0a\u1e0b\u1e0c\u1e0d\u1e0e\u1e0f\u1e10\u1e11\u1e12\u1e13\u1e14\u1e15\u1e16\u1e17\u1e18\u1e19\u1e1a\u1e1b\u1e1c\u1e1d\u1e1e\u1e1f\u1e20\u1e21\u1e22\u1e23\u1e24\u1e25\u1e26\u1e27\u1e28\u1e29\u1e2a\u1e2b\u1e2c\u1e2d\u1e2e\u1e2f\u1e30\u1e31\u1e32\u1e33\u1e34\u1e35\u1e36\u1e37\u1e38\u1e39\u1e3a\u1e3b\u1e3c\u1e3d\u1e3e\u1e3f\u1e40\u1e41\u1e42\u1e43\u1e44\u1e45\u1e46\u1e47\u1e48\u1e49\u1e4a\u1e4b\u1e4c\u1e4d\u1e4e\u1e4f\u1e50\u1e51\u1e52\u1e53\u1e54\u1e55\u1e56\u1e57\u1e58\u1e59\u1e5a\u1e5b\u1e5c\u1e5d\u1e5e\u1e5f\u1e60\u1e61\u1e62\u1e63\u1e64\u1e65\u1e66\u1e67\u1e68\u1e69\u1e6a\u1e6b\u1e6c\u1e6d\u1e6e\u1e6f\u1e70\u1e71\u1e72\u1e73\u1e74\u1e75\u1e76\u1e77\u1e78\u1e79\u1e7a\u1e7b\u1e7c\u1e7d\u1e7e\u1e7f\u1e80\u1e81\u1e82\u1e83\u1e84\u1e85\u1e86\u1e87\u1e88\u1e89\u1e8a\u1e8b\u1e8c\u1e8d\u1e8e\u1e8f\u1e90\u1e91\u1e92\u1e93\u1e94\u1e95\u1e96\u1e97\u1e98\u1e99\u1ea0\u1ea1\u1ea2\u1ea3\u1ea4\u1ea5\u1ea6\u1ea7\u1ea8\u1ea9\u1eaa\u1eab\u1eac\u1ead\u1eae\u1eaf\u1eb0\u1eb1\u1eb2\u1eb3\u1eb4\u1eb5\u1eb6\u1eb7\u1eb8\u1eb9\u1eba\u1ebb\u1ebc\u1ebd\u1ebe\u1ebf\u1ec0\u1ec1\u1ec2\u1ec3\u1ec4\u1ec5\u1ec6\u1ec7\u1ec8\u1ec9\u1eca\u1ecb\u1ecc\u1ecd\u1ece\u1ecf\u1ed0\u1ed1\u1ed2\u1ed3\u1ed4\u1ed5\u1ed6\u1ed7\u1ed8\u1ed9\u1eda\u1edb\u1edc\u1edd\u1ede\u1edf\u1ee0\u1ee1\u1ee2\u1ee3\u1ee4\u1ee5\u1ee6\u1ee7\u1ee8\u1ee9\u1eea\u1eeb\u1eec\u1eed\u1eee\u1eef\u1ef0\u1ef1\u1ef2\u1ef3\u1ef4\u1ef5\u1ef6\u1ef7\u1ef8\u1ef9|AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzOoUuAaIiOoUuUuUuUuUuAaAaGgKkOoOojGgNnAaAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyAaBbBbBbCcDdDdDdDdDdEeEeEeEeEeFfGgHhHhHhHhHhIiIiKkKkKkLlLlLlLlMmMmMmNnNnNnNnOoOoOoOoPpPpRrRrRrRrSsSsSsSsSsTtTtTtTtUuUuUuUuUuVvVvWwWwWwWwWwXxXxYyZzZzZzhtwyAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeEeEeIiIiOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYy
'@
}
# <<< timezone data

# Colori (PowerShell gestisce ANSI nativo dal terminale moderno).
function Write-Err  { param([string]$Msg) Write-Host "error: $Msg" -ForegroundColor Red }
function Write-Warn { param([string]$Msg) Write-Host "warn:  $Msg" -ForegroundColor Yellow }
function Write-Info { param([string]$Msg) Write-Host $Msg -ForegroundColor DarkGray }

# jht artifact upload <file> with the CLI only: the container reads the shared folder (Documents\Job Hunter Team of the person) and nothing else of this
# computer, so a file that lies elsewhere is copied into its allegati folder and the team is given the copy. The folder is the one the team is
# started with (JHT_USER_DIR_HOST, or Documents of the profile; the folder Windows has for Documents where the profile has none by that name).
function Get-JhtSharedFolderPath {
  if ($env:JHT_USER_DIR_HOST) { return $env:JHT_USER_DIR_HOST }
  $documents = Join-Path $env:USERPROFILE 'Documents'
  if (-not (Test-Path -LiteralPath $documents -PathType Container)) {
    $known = [Environment]::GetFolderPath('MyDocuments')
    if ($known) { $documents = $known }
  }
  return (Join-Path $documents 'Job Hunter Team')
}

# The arguments of `artifact upload` (without the word upload) with the first file outside the shared folder replaced by its copy in allegati.
# Returns the arguments as they are where there is nothing to copy (stdin, a path of the container, a file that is not there, a link, a file already inside).
function Copy-JhtArtifactIntoShared {
  param([string[]]$UploadArgs)
  $out = @($UploadArgs)
  if ($out -ccontains '--stdin') { return ,$out }
  $index = -1
  for ($i = 0; $i -lt $out.Count; $i++) { if (-not $out[$i].StartsWith('-')) { $index = $i; break } }
  if ($index -lt 0) { return ,$out }
  $given = $out[$index]
  # a path with a / in front is the container's, unless it is a file of this computer (on Windows it never is: C:\...)
  if ($given.StartsWith('/') -and -not $given.StartsWith('//') -and -not (Test-Path -LiteralPath $given -PathType Leaf)) { return ,$out }
  try {
    $full = if ([IO.Path]::IsPathRooted($given)) { [IO.Path]::GetFullPath($given) } else { [IO.Path]::GetFullPath((Join-Path $PWD.Path $given)) }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return ,$out }
    if (([IO.File]::GetAttributes($full) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return ,$out }
    $shared = [IO.Path]::GetFullPath((Get-JhtSharedFolderPath)).TrimEnd('\', '/')
    $separator = [string][IO.Path]::DirectorySeparatorChar
    if ($full.StartsWith($shared + $separator, [StringComparison]::OrdinalIgnoreCase)) { return ,$out }
    # The shared folder is one the container can write: a link put where allegati or the copy goes would take the file of the person to the
    # place it names. Neither is followed: allegati has to be a folder of its own and the copy a file of its own, and both inside the shared folder.
    $folder = Join-Path $shared 'allegati'
    if (-not (Test-JhtInsideShared $folder $shared) -or (Test-JhtLinkOrWrongKind $folder $true)) { Write-Err (Format-JhtText 'ps.artifact_copy_refused' $given $folder); return $null }
    [void](New-Item -ItemType Directory -Force -Path $folder)
    if (Test-JhtLinkOrWrongKind $folder $true) { Write-Err (Format-JhtText 'ps.artifact_copy_refused' $given $folder); return $null }
    $name = [IO.Path]::GetFileName($full)
    $destination = Join-Path $folder $name
    $number = 1
    while ($true) {
      if (-not (Test-JhtInsideShared $destination $shared) -or (Test-JhtLinkOrWrongKind $destination $false)) { Write-Err (Format-JhtText 'ps.artifact_copy_refused' $given $destination); return $null }
      if (-not (Test-Path -LiteralPath $destination) -or (Get-JhtFileSha256 $destination) -ceq (Get-JhtFileSha256 $full)) { break }
      $number++
      $destination = Join-Path $folder ('{0}-{1}{2}' -f [IO.Path]::GetFileNameWithoutExtension($name), $number, [IO.Path]::GetExtension($name))
    }
    if (-not (Test-Path -LiteralPath $destination)) { Copy-Item -LiteralPath $full -Destination $destination }
    Write-Host (Format-JhtText 'ps.artifact_copied' $full $destination)
    $out[$index] = $destination
    return ,$out
  } catch {
    Write-Err (Format-JhtText 'ps.artifact_copy_failed' $given ($_.Exception.Message))
    return $null
  }
}

# Whether a path, taken whole, lies inside the shared folder (no .. or other name that takes it out).
function Test-JhtInsideShared {
  param([string]$Path, [string]$Shared)
  $whole = [IO.Path]::GetFullPath($Path)
  return $whole.StartsWith($Shared.TrimEnd('\', '/') + [string][IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

# Whether what is at a path is a link (a reparse point), or a file where a folder has to be, or a folder where a file has to be. Nothing there is fine.
function Test-JhtLinkOrWrongKind {
  param([string]$Path, [bool]$WantFolder)
  try { $attributes = [IO.File]::GetAttributes($Path) } catch [IO.FileNotFoundException] { return $false } catch [IO.DirectoryNotFoundException] { return $false }
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
  $isFolder = (($attributes -band [IO.FileAttributes]::Directory) -ne 0)
  return ($isFolder -ne $WantFolder)
}

function Get-JhtFileSha256 {
  param([string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()) } finally { $sha.Dispose() }
  } finally { $stream.Dispose() }
}

# T220: declared host bridge to move into the T214 Rust sidecar. No data logic.
# Explicit rule-2 exception: <=60 added lines, no installer/manifest dependency.
function Open-JhtMonitorWindow {
  param([string]$CommandPath, [string[]]$WindowArgs)
  if ($WindowArgs.Count -ne 1 -or $WindowArgs[0] -cne '--window') {
    Write-Err (Get-JhtText 'monitor.window_invalid')
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
    Write-Err (Get-JhtText 'ps.monitor_window_unavailable')
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
  foreach ($one in $ids) { [Console]::Out.WriteLine(('{0,-15} {1,-16} {2}' -f $one, (Get-JhtText 'ps.integration_not_installed'), (Get-JhtText 'ps.integration_not_installed_yet'))) }
  # In words, the person is told which command installs them (the lines above stay the shape the helper gives).
  [Console]::Error.WriteLine((Get-JhtText 'line.integration.install_hint'))
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
      throw (Get-JhtText 'line.job_hunter_team_non_installato')
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
    return (Format-JhtText 'ps.jht_home_missing' $JhtHome)
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
    Write-Err (Get-JhtText 'line.podman_non_trovato_reinstalla_il')
    exit 127
  }
  $null = & { $ErrorActionPreference = 'Continue'; & docker info 2>&1 }
  if ($LASTEXITCODE -ne 0) {
    Write-Err (Get-JhtText 'ps.podman_machine_not_responding')
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
  $text = if ($What -ceq 'up') { (Get-JhtText 'up.done') }
          elseif ($What -ceq 'restart') { (Get-JhtText 'ps.lifecycle.restarted') }
          else { (Get-JhtText 'down.done') }
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
# The setup that is about to open says so on the HOST, before the container starts (see setup_open_flag_write in the sh wrapper):
# the watchdog of the container wakes the Assistant and the Mentor as soon as it is up, before the wizard writes its own flag.
# Only for the wizard (no sub-command, no --non-interactive); never through a link; any failure is ignored (the wizard writes it too).
function Test-JhtSetupWizardArgs([string[]]$Rest) {
  if ($Rest -and $Rest.Count -gt 0 -and -not ([string]$Rest[0]).StartsWith('-')) { return $false }
  return -not ($Rest -contains '--non-interactive')
}
function Get-JhtSetupOpenFlagPath {
  $home_ = if ($env:JHT_HOME_HOST) { $env:JHT_HOME_HOST } else { Join-Path $env:USERPROFILE '.jht' }
  return (Join-Path $home_ '.setup-open.flag')
}
function Write-JhtSetupOpenFlag {
  try {
    $flag = Get-JhtSetupOpenFlagPath
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $flag) -PathType Container)) { return }
    if (Test-Path -LiteralPath $flag) { Remove-Item -LiteralPath $flag -Force -ErrorAction SilentlyContinue }
    $stream = [IO.File]::Open($flag, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try { $bytes = [Text.Encoding]::ASCII.GetBytes([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ') + "`n"); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  } catch { }
}
function Remove-JhtSetupOpenFlag {
  try { Remove-Item -LiteralPath (Get-JhtSetupOpenFlagPath) -Force -ErrorAction SilentlyContinue } catch { }
}
function Get-JhtTeamStoppedText {
  return (Get-JhtText 'team.stopped')
}

# `jht doctor` with the team off: what this computer can check without starting anything (the engine, the runtime, the configuration,
# the memory limit of WSL), and the team said off. The same shape as the CLI's doctor; with --json the same keys. 1 with a problem.
function Invoke-JhtHostDoctor {
  param([string]$Team = 'off', [string[]]$DoctorArgs = @())
  $rows = [System.Collections.Generic.List[object]]::new()
  $engine = $false; try { $engine = [bool](Test-DockerReachable) } catch { $engine = $false }
  if ($engine) { $rows.Add(@('ok', (Get-JhtText 'doctor.host_engine_ok'))) }
  else { $rows.Add(@('fail', (Get-JhtText 'doctor.host_engine_fail'))) }
  $runtime = $false; try { $runtime = [bool](Test-RuntimeBundleTrusted) } catch { $runtime = $false }
  if ($runtime) { $rows.Add(@('ok', (Get-JhtText 'doctor.host_runtime_ok'))) }
  else { $rows.Add(@('fail', (Get-JhtText 'doctor.host_runtime_fail'))) }
  $profileDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath('UserProfile') }
  $configPath = Join-Path (Join-Path $profileDir '.jht') 'jht.config.json'
  if ($profileDir -and (Test-Path -LiteralPath $configPath -PathType Leaf)) { $rows.Add(@('ok', (Get-JhtText 'doctor.host_config_ok'))) }
  else { $rows.Add(@('warn', (Get-JhtText 'doctor.host_config_none'))) }
  $wslAdvice = Get-JhtDoctorWslMemoryAdvice
  if ($wslAdvice) {
    $rows.Add(@('warn', (Format-JhtText 'ps.doctor.wsl_memory' '%USERPROFILE%\.wslconfig' $wslAdvice)))
  }
  if ($Team -ceq 'unattestable') {
    $rows.Add(@('fail', (Get-JhtText 'doctor.host_team_unattestable')))
  } else {
    $rows.Add(@('warn', (Get-JhtText 'doctor.host_team_off')))
  }
  $count = @{ ok = 0; warn = 0; fail = 0 }
  foreach ($row in $rows) { $count[$row[0]] += 1 }
  if ($DoctorArgs -ccontains '--json') {
    $checks = @(foreach ($row in $rows) { [ordered]@{ section = 'host'; status = $row[0]; message = $row[1]; hint = $null } })
    $answer = [ordered]@{ ok = ($count.fail -eq 0); teamRunning = $false; summary = [ordered]@{ ok = $count.ok; warnings = $count.warn; problems = $count.fail }; checks = $checks }
    [Console]::Out.WriteLine((ConvertTo-JhtAsciiJson ($answer | ConvertTo-Json -Depth 5)))
  } else {
    [Console]::Out.WriteLine((Get-JhtText 'doctor.host_title'))
    foreach ($row in $rows) {
      $mark = switch ($row[0]) { 'ok' { '+' } 'warn' { '!' } default { 'x' } }
      [Console]::Out.WriteLine("  $mark $($row[1])")
    }
    [Console]::Out.WriteLine((Get-JhtText 'doctor.host_more'))
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
  Write-Err (Format-JhtText 'ps.compose_up_failed_team_not_started' $Code)
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
  # The full help lives in the CLI INSIDE the container: with no container this one is printed, with what the wrapper does by itself on the host.
  Write-Host (Get-JhtText 'ps.help.main')
}

# A help asks nothing and needs no terminal: the container's CLI is run without -i/-t. With -t Podman on Windows tried to size a
# terminal of a help already over: two «Failed to obtain TTY size» and no help at all (`jht enrichment --help`, retest build13).
function Invoke-HelpWithoutDocker {
  param([Parameter(ValueFromRemainingArguments)] $HelpArgs)
  if ((Test-DockerReachable) -and (Test-ContainerUp)) {
    & { $ErrorActionPreference = 'Continue'; & docker exec -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry @HelpArgs }
    return $LASTEXITCODE
  }
  Write-LocalHelp
  return 0
}

# `jht tools --help`: its subcommands, as in jht-wrapper.sh (tools_help): a help never starts the container nor loads the helper.
function Write-ToolsHelp {
  [Console]::Out.WriteLine((Get-JhtText 'help.tools'))
}

# `jht integration --help`: its usage line, not the generic help of the host. Fixed text: the command lives in a helper that
# is fetched only when it is needed, and a help never fetches anything.
function Write-IntegrationHelp {
  [Console]::Out.WriteLine((Get-JhtText 'help.integration'))
}

# `jht setup --help`: its options, not the generic help of the host. Fixed text: the setup itself runs in the container and a help
# never starts it. Keep it in step with the options of cli/src/commands/setup.js (a test compares them).
function Write-SetupHelp {
  [Console]::Out.WriteLine((Get-JhtText 'help.setup'))
}

# `jht screen --help`: its line of use, fixed text like the one of `jht integration`: a help downloads nothing.
function Write-ScreenHelp {
  [Console]::Out.WriteLine((Get-JhtText 'help.screen'))
}

# `jht linkedin --help`: its line of use, fixed text: a help downloads nothing.
function Write-LinkedinHelp {
  [Console]::Out.WriteLine((Get-JhtText 'help.linkedin'))
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
        Write-Err (Format-JhtText 'ps.user_dir_unavailable_cannot_create' $dir)
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
  Write-Err (Format-JhtText 'ps.mount_repair_failed_folders_not_writable' $homeMount $userMount)
  Write-Info (Get-JhtText 'ps.docker_desktop_file_sharing_hint')
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
    Write-Err (Get-JhtText 'line.runtime_o_container_jht_non')
    return
  }
  $containerId = Get-RunningComposeServiceId $Container
  if (-not $containerId) {
    Write-Err (Get-JhtText 'line.runtime_o_container_jht_non')
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
      if (-not (Install-RuntimeHelpers)) { Write-Err (Get-JhtText 'ps.broker_network_scripts_not_downloadable'); return $false }
      break
    }
  }
  if (-not (Test-RuntimeHelpersTrusted) -or -not (Test-RuntimeHelperDeclared 'configure-podman-windows-network.ps1')) {
    Write-Err (Get-JhtText 'ps.broker_network_scripts_not_verified')
    return $false
  }
  $shell = (Get-Process -Id $PID).Path
  & $shell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $RuntimeDir 'configure-podman-windows-network.ps1') `
    -MachineName $env:CONTAINER_CONNECTION -BridgeScript $PodmanMachineBridgePath -WithBroker | Write-EnsureLine -Quiet:$Quiet
  if ($LASTEXITCODE -ne 0) { Write-Err (Format-JhtText 'ps.broker_network_proxy_not_ready' $LASTEXITCODE); return $false }
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
    Write-Err ('broker_unavailable: ' + (Get-JhtText 'line.broker_unavailable.il_broker_dei_segreti_esiste'))
    return 1
  }
  if ((Get-Content -LiteralPath $ComposeFile -Raw) -notmatch "(?m)^  $([regex]::Escape($BrokerContainer)):") {
    Write-Err ('broker_unavailable: ' + (Get-JhtText 'line.broker_unavailable.il_runtime_installato_pi_vecchio_2'))
    Write-Err (Get-JhtText 'line.cosa_fare_jht_upgrade_4')
    return 1
  }
  Write-Info (Get-JhtText 'line.preparo_il_servizio_della_posta')
  if (-not (Invoke-BrokerNetwork -Quiet:$Quiet)) { return 1 }
  Invoke-Compose '--profile' 'broker' 'up' '-d' '--no-deps' $BrokerContainer | Write-EnsureLine -Quiet:$Quiet
  if ($LASTEXITCODE -ne 0) { Write-Err ('broker_start_failed: ' + (Get-JhtText 'line.broker_start_failed.il_servizio_della_posta_non_2')); Write-Err (Get-JhtText 'line.cosa_fare_riprova_il_comando_2'); return 1 }
  $ready = $false
  for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
    $brokerId = Get-RunningComposeServiceId $BrokerContainer
    if ($brokerId) {
      $null = & { $ErrorActionPreference = 'Continue'; & docker exec $brokerId jht-broker-admin secrets status 2>&1 }
      $ready = ($LASTEXITCODE -eq 0)
    }
    if (-not $ready) { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { Write-Err ('broker_start_failed: ' + (Get-JhtText 'line.broker_start_failed.il_servizio_della_posta_non_3')); Write-Err (Get-JhtText 'line.cosa_fare_riprova_il_comando_2'); return 1 }
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
    if (Test-Path -LiteralPath $BrokerMadeMarker) { Write-Warn (Get-JhtText 'ps.broker_restart_failed_secrets_broker_not_ours') }
    return
  }
  if (-not (Test-Path -LiteralPath $BrokerMadeMarker)) {
    if ($brokerState -eq 'absent') { return }
    New-Item -ItemType File -Path $BrokerMadeMarker -Force -ErrorAction SilentlyContinue | Out-Null
  }
  if ($brokerState -ne 'running') {
    $brokerCode = Invoke-ComposeQuiet '--profile' 'broker' 'up' '-d' '--no-deps' $BrokerContainer
    if ($brokerCode -ne 0) { Write-Warn ('broker_restart_failed: ' + (Get-JhtText 'line.broker_restart_failed.il_servizio_della_posta_non_4')) }
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
      Write-Err (Get-JhtText 'ps.broker_unavailable_secrets_broker_not_running')
      Write-Err (Get-JhtText 'line.cosa_fare_jht_up_3')
    } else {
      Write-Err ('broker_unavailable: ' + (Get-JhtText 'line.broker_unavailable.il_servizio_della_posta_non'))
      Write-Err (Get-JhtText 'line.cosa_fare_jht_mail_setup')
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
  if ($id -cnotmatch '^[1-9][0-9]{0,9}$') { Write-Err (Get-JhtText 'line.uso_jht_apply_request_cancel_2'); return 2 }
  $containerId = Get-RunningComposeServiceId $Container
  if (-not $containerId) { Write-Err (Get-JhtText 'ps.jht_container_not_verifiable'); return 1 }

  if ($action -ceq 'cancel') {
    $withdrawn = Invoke-ApplySkill $containerId @('cancel', $id)
    if ($null -eq $withdrawn -or $withdrawn[0] -cne '1') {
      Write-Err (Format-JhtText 'line.ritiro_non_riuscito_s' (Get-ApplyReason $withdrawn))
      return 1
    }
    Write-Info (Format-JhtText 'line.ritirata_s_non_verra_inviata' $id)
    return 0
  }

  $shown = Invoke-ApplySkill $containerId @('show', $id)
  if ($null -eq $shown -or $shown[0] -cne '1') {
    Write-Err (Format-JhtText 'line.non_autorizzabile_s' (Get-ApplyReason $shown))
    return 1
  }
  $confirm = [string]$shown[2]
  $shownDestination = [string]$shown[3]
  if ($confirm -cnotmatch '^[0-9a-f]{64}$' -or $shownDestination -cnotmatch '^((web|email):[a-z0-9.-]{3,253}|portal:[a-z]{2,20})$') {
    Write-Err (Get-JhtText 'line.anteprima_non_valida_niente_autorizzato')
    return 1
  }
  if ([Console]::IsInputRedirected -or -not [Environment]::UserInteractive) {
    Write-Err (Get-JhtText 'line.serve_un_terminale_l_autorizzazione')
    return 1
  }
  Write-Host ''
  Write-Host "  #${id}  $([string]$shown[5])"
  Write-Host ''
  Write-Host (Get-JhtText 'ps.apply_auto_send_warning_1')
  Write-Host (Get-JhtText 'ps.apply_auto_send_warning_2')
  $answer = Read-Host ('  ' + (Get-JhtText 'line.apply.authorize') + ' [s/N]')
  if (@('s', 'si', ('s' + [char]0x00EC), 'y', 'yes') -notcontains ([string]$answer).Trim().ToLowerInvariant()) {
    Write-Info (Get-JhtText 'line.annullato_niente_autorizzato')
    return 1
  }

  $written = Invoke-ApplySkill $containerId @('request', $id, '--expect', $confirm)
  if ($null -eq $written -or $written[0] -cne '1') {
    Write-Err (Format-JhtText 'line.non_autorizzata_s' (Get-ApplyReason $written))
    return 1
  }
  $destination = [string]$written[3]
  $instant = [string]$written[4]
  if ($destination -cne $shownDestination -or $instant -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$') {
    $null = Invoke-ApplySkill $containerId @('cancel', $id)
    Write-Err (Get-JhtText 'line.risposta_del_container_non_valida')
    return 1
  }
  $recorded = Invoke-BrokerAdmin -InputText '' -AdminArgs @('apply', 'record', $id, $instant, $destination)
  if ($recorded -ne 0) {
    $null = Invoke-ApplySkill $containerId @('cancel', $id)
    Write-Err (Get-JhtText 'line.il_broker_non_ha_registrato')
    return 1
  }
  Write-Info (Format-JhtText 'line.autorizzata_s_verso_s_il' $id $destination)
  return 0
}

function Invoke-TelegramAdmin {
  param([string]$InputText = $null, [Parameter(ValueFromRemainingArguments)] [string[]]$AdminArgs)
  $telegramId = Get-RunningComposeServiceId $TelegramContainer
  if (-not $telegramId) {
    Write-Err (Get-JhtText 'ps.telegram_unavailable_isolated_not_running')
    Write-Err (Get-JhtText 'line.cosa_fare_jht_up_3')
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
    Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.migrazione_telegram_interrotta'))
    return @{ Ok = $false; Digests = @() }
  }
  if ((Invoke-TelegramAdmin -InputText ($digests -join "`n") -AdminArgs @('legacy', 'remember', $Role)) -ne 0) {
    Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.le_impronte_non_sono_state'))
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
    $secureToken = Read-Host (Format-JhtText 'ps.bot_token_prompt_hidden' $Role) -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
    $secureToken = $null
    if ($token -notmatch '^[0-9]{5,12}:[A-Za-z0-9_-]{20,}$') {
      $token = $null
      Write-Err ('bot_token_invalid: ' + (Get-JhtText 'line.bot_token_invalid.controlla_il_token_generato_da'))
      return 1
    }
    $payload = @{ bot_token = $token } | ConvertTo-Json -Compress
    $token = $null
  }
  if (-not $payload) { Write-Err (Get-JhtText 'ps.input_not_json_bot_token_stdin'); return 2 }
  $code = Invoke-TelegramAdmin -InputText $payload -AdminArgs $adminArgs
  $payload = $null
  if ($code -ne 0) {
    Write-Err (Get-JhtText 'line.abbinamento_rifiutato_genera_un_token')
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
    Write-Info (Get-JhtText 'line.telegram_isolato_attivo_il_bridge')
    return 0
  }
  if ($remainingCode -eq 1) {
    Write-Warn (Get-JhtText 'line.bot_abbinato_e_copia_legacy')
    return 0
  }
  Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.non_posso_provare_che_jht'))
  return 1
}

function Invoke-TelegramPair {
  param([string]$Role)
  if ($Role -eq '--all') { return Invoke-TelegramPairAll }
  if ($Role -notin @('assistente', 'capitano', 'mentor')) {
    Write-Err (Get-JhtText 'line.uso_jht_telegram_pair_assistente')
    Write-Err (Get-JhtText 'line.interattivo_il_token_viene_chiesto')
    return 2
  }
  $telegramId = Get-RunningComposeServiceId $TelegramContainer
  if (-not $telegramId) { Write-Err (Get-JhtText 'ps.telegram_unavailable_run_jht_up'); return 1 }
  # Gli altri ruoli con un token legacy: finche' ne resta uno il servizio non si
  # accende e il ruolo appena abbinato resta muto. Serve solo ad avvisare.
  $remainingOut = @(& { $ErrorActionPreference = 'Continue'; Invoke-TelegramLegacy remaining 2>$null })
  if ($LASTEXITCODE -eq 1) {
    $others = @(($remainingOut -join ' ') -split '\s+' | Where-Object { $_ -in @('assistente', 'capitano', 'mentor') -and $_ -ne $Role })
    if ($others.Count -gt 0) {
      Write-Warn (Format-JhtText 'line.restano_token_legacy_per_s' ($others -join ' ') $Role)
      if (-not [Console]::IsInputRedirected) {
        $answer = Read-Host (Format-JhtText 'ps.pair_role_now_prompt' $Role)
        if ($answer -notmatch '^(s|si)$') { Write-Info (Get-JhtText 'line.abbinamento_annullato_nessuna_modifica'); return 1 }
      }
    }
  }
  $agentWasRunning = Test-ContainerUp
  if ($agentWasRunning) {
    Invoke-Compose stop $Container | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.non_riesco_a_fermare_gli'))
      return 1
    }
  }
  $inventory = Get-TelegramPairInventory $Role
  if ($agentWasRunning) {
    Invoke-Compose start $Container | Out-Null
    if ($inventory.Ok -and $LASTEXITCODE -ne 0) {
      Write-Err ('agent_restart_failed: ' + (Get-JhtText 'line.agent_restart_failed.inventario_conservato_ma_il_team'))
      return 1
    }
  }
  if (-not $inventory.Ok) { return 1 }
  $status = ((& { $ErrorActionPreference = 'Continue'; & docker exec $telegramId jht-telegram-admin cutover status 2>$null }) -join "`n")
  $wasEnabled = $status -match '"enabled"\s*:\s*true'
  # Anche quando l'inventario non trova niente: un agente di una versione
  # precedente puo' aver tolto il token dalla config prima dell'aggiornamento.
  Write-Info (Get-JhtText 'ps.use_fresh_botfather_token')
  $code = Send-TelegramPairToken $Role $inventory.Digests
  if ($code -ne 0) { return $code }
  Invoke-TelegramLegacy remove $Role | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Err (Get-JhtText 'ps.legacy_cleanup_failed_old_token_still_there')
    return 1
  }
  return Complete-TelegramPair -WasEnabled $wasEnabled -AgentWasRunning $agentWasRunning
}

# Tutti i ruoli con un token legacy, in una seduta. Le copie legacy si tolgono
# solo quando tutti gli abbinamenti sono riusciti: nessun ruolo resta muto a
# meta' strada, e la storia delle impronte rifiuta comunque quei token.
function Invoke-TelegramPairAll {
  if ([Console]::IsInputRedirected) {
    Write-Err (Get-JhtText 'line.jht_telegram_pair_all_interattivo')
    return 2
  }
  $telegramId = Get-RunningComposeServiceId $TelegramContainer
  if (-not $telegramId) { Write-Err (Get-JhtText 'ps.telegram_unavailable_run_jht_up'); return 1 }
  $remainingOut = @(& { $ErrorActionPreference = 'Continue'; Invoke-TelegramLegacy remaining 2>$null })
  $remainingCode = $LASTEXITCODE
  if ($remainingCode -eq 0) { Write-Info (Get-JhtText 'line.nessun_ruolo_ha_un_token'); return 0 }
  if ($remainingCode -ne 1) { Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.non_riesco_a_leggere_i')); return 1 }
  $roles = @(($remainingOut -join ' ') -split '\s+' | Where-Object { $_ -in @('assistente', 'capitano', 'mentor') })
  if ($roles.Count -eq 0) { Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti')); return 1 }
  Write-Info (Format-JhtText 'line.ruoli_da_abbinare_in_questa' ($roles -join ' '))
  $agentWasRunning = Test-ContainerUp
  if ($agentWasRunning) {
    Invoke-Compose stop $Container | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.non_riesco_a_fermare_gli'))
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
      Write-Err ('agent_restart_failed: ' + (Get-JhtText 'line.agent_restart_failed.inventario_conservato_ma_il_team'))
      return 1
    }
  }
  $status = ((& { $ErrorActionPreference = 'Continue'; & docker exec $telegramId jht-telegram-admin cutover status 2>$null }) -join "`n")
  $wasEnabled = $status -match '"enabled"\s*:\s*true'
  $bots = ((& { $ErrorActionPreference = 'Continue'; & docker exec $telegramId jht-telegram-admin bots status 2>$null }) -join "`n")
  Write-Info (Get-JhtText 'ps.botfather_fresh_token')
  foreach ($role in $roles) {
    if ($bots -match ('"' + $role + '"\s*:\s*"present"')) {
      Write-Info (Format-JhtText 'line.s_ha_gi_un_bot' $role)
      continue
    }
    $code = Send-TelegramPairToken $role $digestsByRole[$role]
    if ($code -ne 0) {
      Write-Err (Format-JhtText 'line.abbinamento_di_s_non_riuscito' $role)
      return $code
    }
  }
  foreach ($role in $roles) {
    Invoke-TelegramLegacy remove $role | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Err ('legacy_cleanup_failed: ' + (Format-JhtText 'line.legacy_cleanup_failed.i_token_nuovi_sono_al' $role))
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
      'not-configured' { Write-Host (Get-JhtText 'ps.telegram_not_configured') }
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
  if (Test-TelegramStateVolumeAbsent) { Write-Host (Get-JhtText 'ps.telegram_not_configured'); return 0 }
  $configured = Get-TelegramBotsConfigured
  if ($null -eq $configured) {
    Write-Host (Get-JhtText 'ps.telegram_status_unverifiable')
    return 0
  }
  if (-not $configured) { Write-Host (Get-JhtText 'ps.telegram_not_configured'); return 0 }
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
        Write-Err (Get-JhtText 'line.uso_jht_telegram_chat_id'); return 2
      }
      return Invoke-TelegramAdmin -AdminArgs @('bots', 'chat-id', $role)
    }
    'remove' {
      if ($role -notin @('assistente', 'capitano', 'mentor')) {
        Write-Err (Get-JhtText 'line.uso_jht_telegram_remove_assistente'); return 2
      }
      return Invoke-TelegramAdmin -AdminArgs @('bots', 'delete', $role)
    }
    default { Write-Err (Get-JhtText 'line.uso_jht_telegram_status_pair'); return 2 }
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
      if ($LASTEXITCODE -ne 0) { Write-Warn ('legacy_remove_failed: ' + (Format-JhtText 'line.legacy_remove_failed.s_nel_broker_ma_la' $name)) }
      $migrated = $true
    } elseif ($answer -match '"ok": true' -and $answer -match '"state": "already_migrated"') {
      & { $ErrorActionPreference = 'Continue'; & docker exec -u 1001 $agentId /usr/bin/python3 -I /app/shared/broker/legacy.py remove $name *> $null }
      Write-Warn ('legacy_secret_reappeared: ' + (Format-JhtText 'line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso' $name))
    } else {
      Write-Warn (Format-JhtText 'ps.legacy_migration_failed_stays' $name)
      $failed = $true
    }
  }
  if ($migrated) {
    Write-Warn (Get-JhtText 'line.la_casella_di_posta_ora')
    Write-Warn (Get-JhtText 'line.genera_una_nuova_password_per')
    Write-Warn (Get-JhtText 'line.fino_ad_allora_la_posta')
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
  if (-not $agentId) { Write-Err (Get-JhtText 'ps.relink_account_container_not_running'); return 1 }
  $account = Get-AgentCloudField -AgentId $agentId -Field 'user_id'
  if (-not $account) { Write-Err (Get-JhtText 'line.apply_relink_account_cloud_account'); return 1 }
  return Invoke-BrokerAdmin -AdminArgs @('apply', 'account', $account)
}

function Remove-BrokerResetData {
  $project = Get-ComposeProjectName
  if (-not $project) {
    Write-Err (Get-JhtText 'line.reset_non_riesco_a_determinare')
    return 1
  }
  Invoke-Compose '--profile' 'telegram' '--profile' 'broker' '--profile' 'media' '--profile' 'playwright' '--profile' 'screen' '--profile' 'login' down
  if ($LASTEXITCODE -ne 0) {
    Write-Err (Get-JhtText 'line.reset_non_riesco_a_fermare')
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
      Write-Err (Format-JhtText 'line.reset_ricerca_del_volume_s_2' $logical)
      $failed = $true
      continue
    }
    if ($ids.Count -eq 0) {
      Write-Info (Format-JhtText 'line.saltato_non_trovato_volume_broker' $logical)
      continue
    }
    foreach ($id in $ids) {
      if ($id -notmatch '^[A-Za-z0-9_.-]+$') {
        Write-Err (Format-JhtText 'line.reset_nome_volume_non_valido' $logical)
        $failed = $true
        continue
      }
      & { $ErrorActionPreference = 'Continue'; & docker volume rm $id *> $null }
      if ($LASTEXITCODE -eq 0) {
        Write-Info (Format-JhtText 'line.cancellato_volume_broker_s_s' $logical $id)
      } else {
        Write-Err (Format-JhtText 'line.reset_impossibile_cancellare_il_volume' $logical $id)
        $failed = $true
      }
    }
  }
  if (Test-Path -LiteralPath $BrokerLegacyMarker) {
    try {
      Remove-Item -LiteralPath $BrokerLegacyMarker -Force -ErrorAction Stop
      Write-Info (Format-JhtText 'line.cancellato_marcatore_migrazione_broker_s' $BrokerLegacyMarker)
    } catch {
      Write-Err (Format-JhtText 'line.reset_impossibile_cancellare_il_marcatore' $BrokerLegacyMarker)
      $failed = $true
    }
  }
  if (Test-Path -LiteralPath $BrokerMadeMarker) {
    try { Remove-Item -LiteralPath $BrokerMadeMarker -Force -ErrorAction Stop } catch {
      Write-Err (Format-JhtText 'line.reset_impossibile_cancellare_il_marcatore_2' $BrokerMadeMarker)
      $failed = $true
    }
  }
  if (-not $failed) {
    Write-Warn (Get-JhtText 'line.i_segreti_e_lo_stato')
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
    Write-Err ('runtime_migration_docker_missing: ' + (Get-JhtText 'line.runtime_migration_docker_missing.il_client_docker_originale_non'))
    Write-RuntimeMigrationLeft $verified; return 24
  }
  if (-not $PodmanPath -or -not (Test-Path -LiteralPath $PodmanPath -PathType Leaf)) {
    Write-Err ('runtime_migration_podman_missing: ' + (Get-JhtText 'line.runtime_migration_podman_missing.podman_non_e_disponibile'))
    Write-RuntimeMigrationLeft $verified; return 24
  }
  if ($Image -notmatch '^ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}$') {
    Write-Err ('runtime_migration_image_invalid: ' + (Get-JhtText 'line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata'))
    Write-RuntimeMigrationLeft $verified; return 24
  }
  & { $ErrorActionPreference = 'Continue'; & $DockerPath image inspect $Image *> $null }
  if ($LASTEXITCODE -ne 0) { Write-RuntimeMigrationLeft $verified; return 24 }
  & { $ErrorActionPreference = 'Continue'; & $PodmanPath @(Get-RuntimeMigrationPodmanArgs $Machine @('image', 'inspect', $Image)) *> $null }
  if ($LASTEXITCODE -ne 0) { Write-RuntimeMigrationLeft $verified; return 24 }
  $running = @(& { $ErrorActionPreference = 'Continue'; & $DockerPath ps -q --filter 'label=com.docker.compose.project=host-runtime' 2>$null })
  if ($LASTEXITCODE -ne 0 -or @($running | Where-Object { $_ }).Count -gt 0) {
    Write-Err ('runtime_migration_team_running: ' + (Get-JhtText 'line.runtime_migration_team_running.ferma_prima_il_team_docker'))
    Write-RuntimeMigrationLeft $verified; return 24
  }
  $running = @(& { $ErrorActionPreference = 'Continue'; & $PodmanPath @(Get-RuntimeMigrationPodmanArgs $Machine @('ps', '-q', '--filter', 'label=com.docker.compose.project=jht')) 2>$null })
  if ($LASTEXITCODE -ne 0 -or @($running | Where-Object { $_ }).Count -gt 0) {
    Write-Err ('runtime_migration_team_running: ' + (Get-JhtText 'line.runtime_migration_team_running.ferma_prima_il_team_podman'))
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
  Write-Info (Get-JhtText 'ps.docker_podman_verified_future_removal')
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
      default { Write-Err (Format-JhtText 'line.mail_setup_opzione_sconosciuta_s' ($MailArgs[$i])); return 2 }
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
  if (-not $user) { $user = Read-Host ((Get-JhtText 'line.mail.address_prompt').TrimEnd(':', ' ')) }
  if (-not $dedicated) {
    $answer = Read-Host ((Get-JhtText 'line.mail.dedicated_prompt') + ' [s/N]')
    $dedicated = if ($answer -match '^(s|si|y|yes)$') { 'yes' } else { 'no' }
  }
  $admission = if ($dedicated -eq 'yes') { 'whole_mailbox' } else { 'allowlist' }
  if (-not $fromStdin) {
    $secure = Read-Host ((Get-JhtText 'line.mail.app_password_prompt').TrimEnd(':', ' ')) -AsSecureString
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if (-not $password) { Write-Err (Get-JhtText 'line.mail_setup_password_vuota'); return 1 }
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
      Write-Err (Get-JhtText 'line.uso_jht_mail_setup_status')
      return 2
    }
  }
}

function Ensure-Up {
  Wait-JhtToolsSwitch
  if (-not (Test-ContainerUp)) {
    if (Test-JhtTeamStoppedByPerson) { Write-Err (Get-JhtTeamStoppedText); exit 1 }
    Write-Info (Format-JhtText 'container.starting' $Container)
    if (-not (Repair-MountOwnership)) { exit 1 }
    if (-not (Initialize-TelegramLegacyInventory)) {
      Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.il_team_resta_fermo_perch_4'))
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
        Write-Err (Format-JhtText 'line.container_s_non_e_partito' $Container)
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
      if ($i + 1 -ge $DownloadArgs.Count -or -not $DownloadArgs[$i + 1]) { Write-Err (Format-JhtText 'line.s_needs_a_value' $arg); $script:HostDownloadExitCode = 2; return }
      $i += 1
      if ($arg -eq '--os') { $os = $DownloadArgs[$i] } elseif ($arg -eq '--version') { $version = $DownloadArgs[$i] } else { $output = $DownloadArgs[$i] }
    }
    elseif ($arg.StartsWith('--os=')) { $os = $arg.Substring(5) }
    elseif ($arg.StartsWith('--version=')) { $version = $arg.Substring(10) }
    elseif ($arg.StartsWith('--output=')) { $output = $arg.Substring(9) }
    else { Write-Err (Format-JhtText 'ps.unknown_argument' $arg); Write-Host $usage; $script:HostDownloadExitCode = 2; return }
  }
  if (-not $os -or -not $version) { Write-Err (Get-JhtText 'line.os_and_version_are_required'); Write-Host $usage; $script:HostDownloadExitCode = 2; return }

  $platform = switch ($os.ToLowerInvariant()) {
    { $_ -in @('win', 'win32', 'windows') } { 'windows' }
    { $_ -in @('darwin', 'mac', 'macos', 'osx') } { 'macos' }
    'linux' { 'linux' }
    default { $null }
  }
  if (-not $platform) { Write-Err (Format-JhtText 'download.unsupported_os' $os); $script:HostDownloadExitCode = 2; return }
  $version = $version -replace '^v', ''
  if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { Write-Err (Format-JhtText 'download.bad_version' $version); $script:HostDownloadExitCode = 2; return }
  if ($deb -and $platform -ne 'linux') { Write-Err (Get-JhtText 'download.deb_only_linux'); $script:HostDownloadExitCode = 2; return }
  if ($platform -eq 'linux') {
    Write-Err (Get-JhtText 'download.linux_no_app')
    $script:HostDownloadExitCode = 1
    return
  }
  $parts = $version.Split('-')[0].Split('.')
  if ($platform -eq 'windows' -and (([int]$parts[0] -gt 0) -or ([int]$parts[1] -ge 4))) {
    Write-Err (Get-JhtText 'download.windows_missing')
    $script:HostDownloadExitCode = 1
    return
  }
  # Le release 0.3.x hanno altri file (tar.gz, setup.exe, zip): l'app per macOS e' dalla 0.4.0.
  if ($platform -ne 'windows' -and [int]$parts[0] -eq 0 -and [int]$parts[1] -lt 4) {
    Write-Err (Format-JhtText 'download.release_no_app' $version)
    $script:HostDownloadExitCode = 1
    return
  }
  if ($platform -eq 'macos' -and $env:JHT_DOWNLOAD_HOST -eq 'darwin-x64') {
    Write-Err (Get-JhtText 'download.intel_mac')
    $script:HostDownloadExitCode = 1
    return
  }
  $asset = if ($platform -eq 'windows') { 'job-hunter-team-windows-x64-setup.exe' }
           else { 'job-hunter-team-macos-universal.dmg' }

  # Destinazione: di base Downloads del profilo, mai una cartella condivisa con il team; un --output li' dentro si rifiuta.
  $destination = if ($output) { [IO.Path]::GetFullPath($output) } else { Join-Path (Join-Path $env:USERPROFILE 'Downloads') $asset }
  $parent = Split-Path -Parent $destination
  try { New-Item -ItemType Directory -Force -Path $parent -ErrorAction Stop | Out-Null }
  catch { Write-Err (Format-JhtText 'download.mkdir_failed' $parent); return }
  $userData = if ($env:JHT_USER_DIR_HOST) { $env:JHT_USER_DIR_HOST } else { Join-Path $env:USERPROFILE 'Documents\Job Hunter Team' }
  $jhtHome = if ($env:JHT_HOME_HOST) { $env:JHT_HOME_HOST } else { Join-Path $env:USERPROFILE '.jht' }
  if (Test-DownloadInsideShared -Directory $parent -Shared @($jhtHome, $userData)) {
    Write-Err (Get-JhtText 'ps.download_shared_folder_no_path')
    return
  }
  $existing = Get-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
  if ($existing) {
    if (($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-Err (Format-JhtText 'download.dest_is_link' $destination); return }
    if ($existing.PSIsContainer) { Write-Err (Format-JhtText 'download.dest_not_file' $destination); return }
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
      if (-not $seam -and $final -and $final.Scheme -ne 'https') { throw (Format-JhtText 'ps.release_arrived_without_https' $url) }
    }
    try { & $fetch "$base/SHA256SUMS" (Join-Path $work 'SHA256SUMS') }
    catch { Write-Err (Format-JhtText 'ps.download_sums_failed_detail' $version ($_.Exception.Message)); return }
    $expected = ''
    foreach ($line in (Get-Content -LiteralPath (Join-Path $work 'SHA256SUMS'))) {
      if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$' -and $Matches[2] -ceq $asset) { $expected = $Matches[1].ToLowerInvariant(); break }
    }
    if (-not $expected) { Write-Err (Format-JhtText 'download.sum_missing' $asset); return }

    if ($existing) {
      if ((Get-DownloadSha256 -Path $destination) -eq $expected) {
        Write-Host ''
        Write-Host (Format-JhtText 'download.present_verified' $destination)
        Write-Host (Format-JhtText 'download.sha_verified' $expected)
        $script:HostDownloadExitCode = 0
        return
      }
      Write-Err (Format-JhtText 'download.mismatch_existing' $destination)
      return
    }

    Write-Host (Format-JhtText 'download.fetching' $asset)
    try { & $fetch "$base/$asset" (Join-Path $work 'asset') }
    catch { Write-Err (Format-JhtText 'ps.download_asset_failed_detail' $asset ($_.Exception.Message)); return }
    $actual = (Get-DownloadSha256 -Path (Join-Path $work 'asset'))
    if ($actual -ne $expected) { Write-Err (Format-JhtText 'download.hash_invalid' $asset $expected $actual); return }

    # Pubblicazione: copia in un nome nuovo accanto alla destinazione e rinomina senza sostituire (File.Move a due
    # argomenti e' no-clobber anche su Windows PowerShell 5.1: se il target compare durante il download fallisce).
    [IO.File]::Copy((Join-Path $work 'asset'), $part, $false)
    [IO.File]::Move($part, $destination)
    Write-Host (Format-JhtText 'download.sha_verified' $actual)
    Write-Host (Format-JhtText 'download.saved_in' $destination)
    $script:HostDownloadExitCode = 0
  } catch {
    Write-Err (Format-JhtText 'ps.host_download_failed' ($_.Exception.Message))
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

# Un JSON per chi legge l'output di jht (l'app): ASCII puro, ogni accento come \uXXXX. Un testo nella lingua della persona ha accenti, e
# Windows PowerShell 5.1 scrive su una pipe nella codepage OEM, non in UTF-8: l'app leggerebbe caratteri sbagliati. Con \u l'JSON resta lo stesso.
function ConvertTo-JhtAsciiJson {
  param([string]$Json)
  return [regex]::Replace($Json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
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
    [Console]::Out.WriteLine((ConvertTo-JhtAsciiJson ($result | ConvertTo-Json -Compress -Depth 4)))
  } elseif ($Ok) {
    Write-Host (Format-JhtText 'line.upgrade.done' $PreviousVersion $PreviousImage $CurrentVersion $CurrentImage $Message) -ForegroundColor Green
  } else {
    Write-Err (Format-JhtText 'ps.upgrade_not_completed' $Phase $Message)
    if ($RolledBack) { Write-Info (Get-JhtText 'line.upgrade.restored') }
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
# The line of the space of the machine the last cleaning gave (Invoke-MachineSpaceReturn), or $null.
$script:MachineSpaceNote = $null
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
  Write-UpgradeNote (Get-JhtText 'ps.upgrade_pulling_full_image')
  & { $ErrorActionPreference = 'Continue'; & docker pull $script:UpgradeFullRef *> $null }
  if ($LASTEXITCODE -eq 0) { $script:UpgradeFullKeep = $script:UpgradeFullRef }
  else { Write-UpgradeNote (Get-JhtText 'ps.full_pull_failed_keep_old') }
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
  $script:MachineSpaceNote = $null
  if ($env:JHT_KEEP_OLD_IMAGES -eq '1') {
    $script:UpgradePrune = New-UpgradePrune 'opt-out'
    Write-UpgradeNote (Get-JhtText 'ps.old_images_kept_all')
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
  $note = (Format-JhtText 'ps.old_images_removed' $removed ([long]($freed / 1MB)))
  if ($busy -gt 0) { $note += (Format-JhtText 'ps.old_images_busy' $busy) }
  if ($refused -gt 0) { $note += (Format-JhtText 'ps.old_images_refused' $refused) }
  Write-UpgradeNote $note
  if ($removed -gt 0) { try { Invoke-MachineSpaceReturn } catch {} }
}

# -- The space of the old images, back to Windows --------------------------
# With Podman the images live in the machine of JHT, a WSL distro whose disk is one .vhdx file on the Windows disk. A removed
# image frees its space INSIDE that disk; the file does not shrink by itself (collaudo of build 9 to 10: the old images went,
# the .vhdx went from 9.89 to 16.48 GiB and C: lost 6.6 GiB). Measured with WSL 3.0.5 and Podman 6.0.2, which makes the .vhdx NOT
# sparse: there fstrim gives back nothing. On a sparse .vhdx fstrim marks the free blocks, and WSL gives them back to Windows when it
# lets the disk go, that is when the machine stops (3 GiB written, removed and trimmed came back only then, all of them). So: fstrim,
# then one line. Sparse: how much comes back, and when. Not sparse: how much JHT takes in its disk, and that jht uninstall frees it
# all. Making the disk sparse (wsl --manage <distro> --set-sparse true, with the machine and WSL stopped) is experimental in WSL:
# it is never done here and never advised to the person; it is in docs for whoever knows how to undo it.
# Nothing here needs an administrator, stops anything or changes the distro.

# The .vhdx of a WSL distro of this user, from the user's own registry (where WSL itself keeps it), or ''.
function Get-JhtMachineVhdx {
  param([Parameter(Mandatory)][string]$Distro)
  try {
    foreach ($key in @(Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction Stop)) {
      $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
      if ([string]$props.DistributionName -cne $Distro) { continue }
      $base = ([string]$props.BasePath) -replace '^\\\\\?\\', ''
      $file = if ($props.VhdFileName) { [string]$props.VhdFileName } else { 'ext4.vhdx' }
      if (-not $base) { return '' }
      $path = Join-Path $base $file
      if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
      return ''
    }
  } catch {}
  return ''
}

# The file is sparse: what it takes on the disk follows what it holds, and a trim inside gives the space back.
function Test-JhtSparseFile {
  param([Parameter(Mandatory)][string]$Path)
  try { return ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::SparseFile) -ne 0 } catch { return $false }
}

# What the file takes on the disk (for a sparse file, less than its size), or its size when that cannot be read.
function Get-JhtFileSizeOnDisk {
  param([Parameter(Mandatory)][string]$Path)
  $size = [long](Get-Item -LiteralPath $Path -Force).Length
  try {
    if (-not ('JhtDisk.Native' -as [type])) {
      Add-Type -Namespace JhtDisk -Name Native -MemberDefinition '[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint GetCompressedFileSizeW(string name, out uint high);'
    }
    $high = [uint32]0
    $low = [JhtDisk.Native]::GetCompressedFileSizeW($Path, [ref]$high)
    if ($low -ne [uint32]::MaxValue -or [Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 0) { return [long](([uint64]$high -shl 32) + [uint64]$low) }
  } catch {}
  return $size
}

# A command run as root in the distro: what it printed, or $null when it did not answer.
function Invoke-JhtMachineRoot {
  param([Parameter(Mandatory)][string]$Wsl, [Parameter(Mandatory)][string]$Distro, [Parameter(ValueFromRemainingArguments)][string[]]$Command)
  $out = @(& { $ErrorActionPreference = 'Continue'; & $Wsl -d $Distro -u root -- @Command 2>$null })
  if ($LASTEXITCODE -ne 0) { return $null }
  return (($out | ForEach-Object { ([string]$_).Replace([string][char]0, '') }) -join [char]10)
}

function Invoke-MachineSpaceReturn {
  if ($ContainerRuntime -ne 'podman' -or -not $script:UpgradePrune) { return }
  $wsl = Get-Command wsl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $wsl -or -not $env:CONTAINER_CONNECTION) { return }
  $distro = Get-JhtPodmanDistroName $env:CONTAINER_CONNECTION
  $vhdx = Get-JhtMachineVhdx $distro
  if (-not $vhdx) { return }
  $trimmed = $null -ne (Invoke-JhtMachineRoot $wsl.Source $distro 'fstrim' '-a')
  $sparse = Test-JhtSparseFile $vhdx
  # What the file can give back: what it takes on the disk less what the distro uses.
  $onDisk = Get-JhtFileSizeOnDisk $vhdx
  $used = Invoke-JhtMachineRoot $wsl.Source $distro 'df' '-B1' '--output=used' '/'
  $usedBytes = if ($used) { ((@($used -split '\s+') | Where-Object { $_ -match '^\d+$' }) | Select-Object -Last 1) } else { $null }
  $recoverable = if ($usedBytes) { [math]::Max([long]0, [long]$onDisk - [long]$usedBytes) } else { [long]0 }
  $script:UpgradePrune['machineDisk'] = [ordered]@{ sparse = $sparse; trimmed = $trimmed; onDiskBytes = [long]$onDisk; recoverableBytes = [long]$recoverable }
  Write-JhtMachineSpaceLog ('fstrim trimmed=' + ([string]$trimmed).ToLowerInvariant() + ' sparse=' + ([string]$sparse).ToLowerInvariant() +
    ' on_disk_bytes=' + [long]$onDisk + ' used_bytes=' + $(if ($usedBytes) { [long]$usedBytes } else { 'unknown' }) + ' recoverable_bytes=' + [long]$recoverable)
  if ($recoverable -lt 1GB) { return }
  # No steps for the person (a sparse disk is experimental in WSL, and the switch wants the machine off): for a disk that is not
  # sparse only how much JHT takes, and the one command that frees all of it.
  $script:MachineSpaceNote = if ($sparse) { 'back_on_stop ' + [long][math]::Floor($recoverable / 1GB) } else { 'not_returned ' + [long][math]::Round($onDisk / 1GB) }
  Write-UpgradeNote (Get-JhtMachineSpaceText $script:MachineSpaceNote)
}

# The line of the space, from its note: 'back_on_stop <GB>' or 'not_returned <GB>', in the language of the person; '' for a note
# that is not one of the two.
function Get-JhtMachineSpaceText {
  param([string]$Note)
  if ($Note -cmatch '^back_on_stop ([0-9]{1,6})$') { return (Format-JhtText 'ps.machine_space_back_on_stop' ([long]$Matches[1]) $env:CONTAINER_CONNECTION) }
  if ($Note -cmatch '^not_returned ([0-9]{1,6})$') { return (Format-JhtText 'ps.machine_space_not_returned' ([long]$Matches[1])) }
  return ''
}

# One line in logs\machine-space.log of the JHT home at every trim, with the numbers, whether the person is told or not (collaudo
# of build 11 to 12c: nothing in the logs said if the trim had run). Never through a link, never failing the command it rides on.
function Write-JhtMachineSpaceLog {
  param([string]$Line)
  try {
    $dir = Get-Item -LiteralPath (Join-Path $JhtHome 'logs') -Force -ErrorAction Stop
    if (-not $dir.PSIsContainer -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return }
    $file = Join-Path $dir.FullName 'machine-space.log'
    $there = Get-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    if ($there -and ($there.PSIsContainer -or ($there.Attributes -band [IO.FileAttributes]::ReparsePoint))) { return }
    $at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture)
    [IO.File]::AppendAllText($file, "$at $Line`n", [Text.UTF8Encoding]::new($false))
  } catch {}
}

# The line the cleaning of `jht tools` could not say: that cleaning runs in a detached job after the switch to the full image, with
# nobody reading it, and it leaves the note in .machine-space-note of the host runtime (Save-ToolsMachineSpaceNote in
# jht-tools.ps1). The next `jht up`, `jht setup` or `jht status` says it, once: the file goes before the line is written.
function Write-JhtMachineSpaceNote {
  try {
    $file = Join-Path $RuntimeDir '.machine-space-note'
    $item = Get-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    # a folder in its place is not a note: left as it is, and nothing asks the person to confirm its removal
    if (-not $item -or $item.PSIsContainer) { return }
    $note = ''
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $item.Length -le 64) {
      $note = ([IO.File]::ReadAllText($item.FullName)).Trim()
    }
    Remove-Item -LiteralPath $file -Force -ErrorAction Stop
    $text = Get-JhtMachineSpaceText $note
    if ($text) { Write-Info $text }
  } catch {}
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
    elseif ($arg -ne '--apply') { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false (Get-JhtText 'ps.upgrade_option_unsupported') $false; return 2 }
  }
  if (Test-Path -LiteralPath $RuntimeImageFile -PathType Leaf) {
    Write-UpgradeResult $false $false 'preflight' 'pinned' 'none' 'pinned' 'none' $false (Get-JhtText 'ps.upgrade_test_channel') $false
    return 1
  }
  if (-not (Test-Path -LiteralPath $RuntimeDir)) {
    if (-not (Install-ProtectedRuntimeFromRelease)) { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false (Get-JhtText 'ps.upgrade_host_runtime_not_installable') $false; return 1 }
  }
  if (-not (Test-RuntimePathAuthority) -or -not (Test-RuntimeAncestorsWithoutReparsePoint $RuntimeDir) -or -not (Test-ProtectedRuntimeNode $RuntimeDir -Directory) -or -not (Test-RuntimeDirectoryAcl)) {
    Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Runtime host fuori authority' $false
    return 1
  }
  if (-not (Enter-UpgradeLock)) { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false (Get-JhtText 'ps.upgrade_already_running') $false; return 1 }
  $script:UpgradeJournal = Join-Path $RuntimeDir '.upgrade-journal'
  try {
    if ((Test-Path $script:UpgradeJournal) -and -not (Restore-UpgradePrevious)) { Write-UpgradeResult $false $false 'recovery' 'unknown' 'none' 'unknown' 'none' $false (Get-JhtText 'ps.upgrade_recovery_failed') $false; return 1 }
    try { Assert-TrustedRuntime } catch { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false (Get-JhtText 'ps.upgrade_host_runtime_untrusted') $false; return 1 }
    if (-not (Test-UpgradeDockerReady) -or -not (Test-Path $ComposeFile) -or -not (Test-Path $WrapperPath)) { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false (Get-JhtText 'ps.upgrade_docker_unavailable') $false; return 1 }
    $wasRunning = Test-ContainerUp
    $oldImage = if ($wasRunning) { Get-UpgradeImage } else { 'none' }
    $oldVersion = if ($wasRunning) { Get-UpgradeVersion } else { 'non-installata' }
    if (-not $oldImage) { $oldImage = 'none' }; if (-not $oldVersion) { $oldVersion = 'sconosciuta' }
    # Disco quasi pieno (< 3% E < 8 GiB liberi): nessun upgrade, nemmeno `--check`. PRIMA di
    # creare la stage o scaricare: il runtime in corso resta intatto. Codice chiuso
    # `disk_low`; la frase la mostra l'app dalla sua tabella codice->frase.
    $diskLow = Get-DiskLowPermille
    if ($null -ne $diskLow) {
      if (-not $script:UpgradeJson) { Write-Err (Format-JhtText 'ps.upgrade_disk_low' (Get-DiskGibText $DiskBlockFreeKib) (Get-DiskGibText $script:DiskLowFreeKib)) }
      Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'disk_low' $false
      return 1
    }
    $script:UpgradeStage = Join-Path $RuntimeDir ('.upgrade-stage-' + $PID + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:UpgradeStage -ErrorAction Stop | Out-Null
    $newCompose = Join-Path $script:UpgradeStage 'docker-compose.yml'; $newWrapper = Join-Path $script:UpgradeStage 'jht-wrapper.ps1'
    Write-UpgradeNote (Get-JhtText 'ps.upgrade_note_download_runtime')
    try {
      $releaseBase = Get-AttestedRawBase
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/docker-compose.yml" -OutFile $newCompose
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/scripts/jht-wrapper.ps1" -OutFile $newWrapper
      [scriptblock]::Create((Get-Content -LiteralPath $newWrapper -Raw)) | Out-Null
      if (-not (Select-String -LiteralPath $newWrapper -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) { throw 'wrapper runtime protocol missing' }
      if (-not (Select-String -LiteralPath $newCompose -Pattern '^\s*-\s*jht-runtime-mask:/jht_home/runtime(?:\s|$)' -Quiet)) { throw 'compose runtime mask missing' }
    } catch { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_remote_runtime_invalid') $false; return 1 }
    if (-not (Invoke-UpgradeCompose $newCompose 'config' '-q')) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_remote_compose_invalid') $false; return 1 }
    $metadataChanged = -not ((Get-FileHash $newCompose).Hash -eq (Get-FileHash $ComposeFile).Hash) -or -not ((Get-FileHash $newWrapper).Hash -eq (Get-FileHash $WrapperPath).Hash)
    if (-not (Initialize-UpgradeTierPlan $newWrapper)) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_release_core_invalid') $false; return 1 }
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
    if (-not $rollbackOwned -or -not (Write-UpgradeJournal 'prepared' $oldImage $wasRunning)) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_rollback_not_prepared') $false; return 1 }
    Write-UpgradeNote (Get-JhtText 'ps.upgrade_note_download_image')
    if (-not (Invoke-UpgradeCompose $newCompose 'pull' $Container)) { Remove-UpgradeTransaction; Write-UpgradeResult $false $false 'pull' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_image_download_failed') $false; return 1 }
    $candidateFiles = @('-f', $newCompose)
    if ($ContainerRuntime -eq 'podman') { $candidateFiles += @('-f', $PodmanComposeFile) }
    $candidateRef = ((& { $ErrorActionPreference = 'Continue'; & docker compose @candidateFiles --project-directory $RuntimeDir config --images 2>$null } | Select-Object -First 1) -as [string]).Trim()
    if (-not $candidateRef) { $candidateRef = if ($env:JHT_IMAGE) { $env:JHT_IMAGE } else { $DefaultRuntimeImage } }
    $candidateImage = ((& { $ErrorActionPreference = 'Continue'; & docker image inspect $candidateRef --format '{{.Id}}' 2>$null } | Select-Object -First 1) -as [string]).Trim()
    if (-not $candidateImage) { $candidateImage = 'sconosciuta' }
    if (-not (Write-UpgradeJournal 'pulled' $oldImage $wasRunning)) { Write-UpgradeResult $false $false 'pull' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_journal_not_updated') $false; return 1 }
    if ($checkOnly) { Remove-UpgradeTransaction; $changed = ($candidateImage -ne $oldImage) -or $metadataChanged; Write-UpgradeResult $true $changed 'check' $oldVersion $oldImage $oldVersion $candidateImage $changed 'Controllo completato; nessuna modifica al runtime' $false; return 0 }
    Write-UpgradeNote (Get-JhtText 'ps.upgrade_note_activate_runtime')
    if (-not (Repair-MountOwnership $candidateRef)) { Remove-UpgradeTransaction; Write-UpgradeResult $false $false 'mounts' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_mounts_not_writable') $false; return 1 }
    if (-not (Invoke-UpgradeCompose $newCompose 'up' '-d' '--force-recreate' $Container) -or -not (Write-UpgradeJournal 'candidate_started' $oldImage $wasRunning) -or -not (Test-UpgradeRunning)) {
      $rolledBack = Restore-UpgradePrevious; Write-UpgradeResult $false $false 'verify' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_verify_failed') $rolledBack; return 1
    }
    $newVersion = Get-UpgradeVersion; if (-not $newVersion) { $newVersion = 'sconosciuta' }
    if (-not (Replace-UpgradeFile $newCompose $ComposeFile) -or -not (Replace-UpgradeFile $newWrapper $WrapperPath)) {
      $rolledBack = Restore-UpgradePrevious; Write-UpgradeResult $false $false 'commit' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_metadata_not_persisted') $rolledBack; return 1
    }
    Write-RuntimeManifest
    if (-not (Write-UpgradeJournal 'metadata_committed' $oldImage $wasRunning)) {
      $rolledBack = Restore-UpgradePrevious; Write-UpgradeResult $false $false 'commit' $oldVersion $oldImage $oldVersion $oldImage $false (Get-JhtText 'ps.upgrade_metadata_not_persisted') $rolledBack; return 1
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
        Write-UpgradeNote (Get-JhtText 'ps.upgrade_broker_restart_failed')
      }
      $null = Invoke-BrokerMigrateLegacyOnce
    }
    if (-not (Install-RuntimeHelpers)) { Write-UpgradeNote (Get-JhtText 'ps.upgrade_helper_install_failed') }
    if ((Invoke-AvailableTelegramLifecycle 'resume') -ne 0) {
      Write-UpgradeNote (Get-JhtText 'ps.upgrade_telegram_restart_failed')
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
    Write-UpgradeResult $false $false 'unexpected' 'unknown' 'none' 'unknown' 'none' $false (Get-JhtText 'ps.upgrade_unexpected_error') $rolledBack
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
    if ($null -ne $hostFile) { $plan.Error = (Get-JhtText 'keyfile.twice'); return $plan }
    $hostFile = $value
    if ($takesNext) { $i++ }
    $out.Add('--api-key-stdin')
  }
  if ($null -eq $hostFile) { return $plan }
  if (@($SetupArgs | Where-Object { $_ -ceq '--api-key-stdin' }).Count -gt 0) { $plan.Error = (Get-JhtText 'keyfile.both'); return $plan }
  $item = $null
  try { $item = Get-Item -LiteralPath $hostFile -Force -ErrorAction Stop } catch { $plan.Error = (Format-JhtText 'keyfile.unreadable' $hostFile); return $plan }
  if ($item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { $plan.Error = (Format-JhtText 'keyfile.not_file' $hostFile); return $plan }
  if (($item.Length -lt 1) -or ($item.Length -gt 4096)) { $plan.Error = (Format-JhtText 'keyfile.size' $hostFile); return $plan }
  $bytes = $null
  try { $bytes = [System.IO.File]::ReadAllBytes($item.FullName) } catch { $plan.Error = (Format-JhtText 'keyfile.unreadable' $hostFile); return $plan }
  # A file written by `echo key > file` in Windows PowerShell 5.1 is UTF-16; Notepad may add a UTF-8 mark: both are read.
  if (($bytes.Length -ge 2) -and ($bytes[0] -eq 0xFF) -and ($bytes[1] -eq 0xFE)) { $text = [System.Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2) }
  elseif (($bytes.Length -ge 2) -and ($bytes[0] -eq 0xFE) -and ($bytes[1] -eq 0xFF)) { $text = [System.Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2) }
  elseif (($bytes.Length -ge 3) -and ($bytes[0] -eq 0xEF) -and ($bytes[1] -eq 0xBB) -and ($bytes[2] -eq 0xBF)) { $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3) }
  else { $text = [System.Text.Encoding]::UTF8.GetString($bytes) }
  $line = ([string](($text -split "\r?\n")[0])).Trim()
  if ($line -cnotmatch '^[\x21-\x7E]{16,512}$') { $plan.Error = (Format-JhtText 'keyfile.shape' $hostFile); return $plan }
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
  if ($Sub -ceq 'tools') {
    Write-ToolsHelp
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

# the switch of the tools waits for a command that changes the runtime: this one says it is running
Register-JhtRunningCommand $Sub $Rest

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
      Write-Info (Get-JhtText 'ps.cli_version_needs_container')
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
      $uploadSource = if ($Rest.Count -gt 1) { @($Rest[1..($Rest.Count - 1)]) } else { @() }
      $uploadRest = Copy-JhtArtifactIntoShared $uploadSource
      if ($null -eq $uploadRest) { exit 1 }
      $Rest = @('upload') + @($uploadRest)
      Require-ComposeFile; Require-Docker; Ensure-Up
      $target = Get-RunningComposeServiceId $Container
      if (-not $target) { Write-Err (Get-JhtText 'ps.team_container_unavailable'); exit 1 }
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
    Write-Err (Format-JhtText 'removed.office' $Sub)
    exit 2
  }

  { $_ -in @('up', 'start-container') } {
    Require-ComposeFile
    Start-PodmanMachineForUp
    Require-Docker
    Clear-JhtTeamStopped
    if (-not (Repair-MountOwnership)) { exit 1 }
    if (-not (Initialize-TelegramLegacyInventory)) {
      Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.il_team_resta_fermo_perch_4'))
      exit 1
    }
    Stop-OnFailedComposeUp (Invoke-PodmanServicesUpInTurn)
    Stop-OnFailedComposeUp (Invoke-ComposeQuiet 'up' '-d')
    Write-JhtLifecycleDone 'up'
    $telegramCode = Invoke-AvailableTelegramLifecycle 'resume'
    if ($telegramCode -ne 0) { exit $telegramCode }
    Resume-Broker
    Write-JhtToolsNotice -Kick
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
      Write-Err ('legacy_inventory_failed: ' + (Get-JhtText 'line.legacy_inventory_failed.il_team_resta_fermo_perch_4'))
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
      if ($Rest.Count -ne 1) { Write-Err (Get-JhtText 'line.uso_jht_apply_relink_account'); exit 2 }
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
        Write-Err (Get-JhtText 'ps.script_integration_not_installed')
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
    if (-not $screenVerb) { Write-Err (Get-JhtText 'line.uso_jht_screen_on_off'); exit 2 }
    $screenArgs = @($screenVerb, 'screen') + @($Rest | Select-Object -Skip 1)
    if (-not (Test-RuntimeHelperDeclared 'jht-integration.ps1') -and $screenVerb -ceq 'status' -and (Write-RuntimeHelperAbsentAnswer 'integration' $screenArgs)) { exit 0 }
    $helperPath = Join-Path $RuntimeDir 'jht-integration.ps1'
    # Same as `integration`: a helper that is missing is fetched only for `on` and `off`, never from a read-only command.
    if (-not (Test-RuntimeHelperDeclared 'jht-integration.ps1')) {
      if (@('add', 'remove') -cnotcontains $screenVerb -or -not (Install-RuntimeHelpers)) {
        Write-Err (Get-JhtText 'ps.script_integration_not_installed')
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
        Write-Err (Get-JhtText 'ps.script_integration_not_installed')
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
      Write-Err (Get-JhtText 'ps.script_tools_not_installed')
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
      Write-Err (Get-JhtText 'line.uso_jht_migrate_runtime_podman')
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
      Write-Err (Format-JhtText 'status.no_options' $given)
      exit 2
    }
    Require-Docker
    if (Test-ContainerUp) {
      & docker inspect $Container --format 'name={{.Name}} status={{.State.Status}} started={{.State.StartedAt}} image={{.Config.Image}}'
      if (-not [Console]::IsOutputRedirected) {
        $telegramCode = Write-TelegramStatusLine
        if ($telegramCode -ne 0) { exit $telegramCode }
        Write-JhtToolsNotice
      }
    } else {
      Write-Host (Format-JhtText 'ps.container_not_running' $Container)
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
      '' { throw (Get-JhtText 'line.nessun_provider_attivo_scegline_uno') }
      default { throw (Format-JhtText 'line.provider_attivo_non_riconosciuto_s' $Provider) }
    }
    break
  }

  # Setup: skip host-setup (non esiste su Windows), delega tutto al wizard
  # Node nel container che leggera' JHT_HOST_TYPE dall'env passato.
  'setup' {
    # --api-key-file of a file on this computer: the key goes to the setup on its standard input (Convert-SetupKeyFileArgs).
    $keyPlan = Convert-SetupKeyFileArgs $Rest
    if ($keyPlan.Error) { [Console]::Error.WriteLine("error: $($keyPlan.Error)"); exit 1 }
    Resolve-JhtUserTimezone $Rest
    Require-ComposeFile
    Require-Docker
    Clear-JhtTeamStopped
    if (Test-JhtSetupWizardArgs $Rest) { Write-JhtSetupOpenFlag }
    Ensure-Up
    Write-JhtToolsNotice -Kick
    # The language and the timezone of host.env go to the setup with the run: a container made before host.env existed (the
    # installer starts the team before it writes host.env) keeps JHT_LANG=en and JHT_USER_TZ=UTC in its environment until it is
    # made again, and the setup then proposed English and wrote the hours in UTC (giro Windows 16/11). Only values the host.env
    # check accepts go on the command line (none, where that check is not loaded).
    [string[]]$setupEnv = @('-e', "JHT_HOST_TYPE=$env:JHT_HOST_TYPE")
    $canCheck = [bool](Get-Command Test-HostEnvValue -CommandType Function -ErrorAction SilentlyContinue)
    foreach ($name in @('JHT_LANG', 'JHT_USER_TZ')) {
      $value = [string][Environment]::GetEnvironmentVariable($name)
      if ($canCheck -and $value -and (Test-HostEnvValue -Name $name -Value $value)) { $setupEnv += @('-e', "$name=$value") }
    }
    if ($null -ne $keyPlan.Key) {
      # -i only: a pipe is not a terminal. No byte-order mark goes in front of the key (Invoke-NativeWithStdin).
      try {
        [string[]]$setupArgs = $keyPlan.Args
        Invoke-NativeWithStdin { $keyPlan.Key | & docker exec -i @setupEnv $Container node $NodeEntry 'setup' @setupArgs }
        if ($LASTEXITCODE -eq 0) { Write-Host (Format-JhtText 'line.the_setup_keeps_the_key' ($keyPlan.File)) }
      } finally {
        $keyPlan.Key = $null
      }
    } else {
      & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags @setupEnv $Container node $NodeEntry 'setup' @Rest }
    }
    if (Test-JhtSetupWizardArgs $Rest) { Remove-JhtSetupOpenFlag }
    break
  }

  # Download e verifica SHA-256 sull'host (il container non c'entra): vedi Invoke-HostDownload.
  'download' {
    Invoke-HostDownload $Rest
    exit $script:HostDownloadExitCode
  }

  # Commands that only read the team (agents, stats, health, team list, team status): with the container running they are the CLI's
  # in the container; with it off they say so and start nothing, as jht status does (it is never started from here): a sampler or a person looking
  # at the team must not undo their own jht down.
  { $_ -cin @('agents', 'stats', 'health') -or ($_ -ceq 'team' -and $Rest.Count -gt 0 -and @('list', 'status') -ccontains [string]$Rest[0]) } {
    Require-ComposeFile
    if ((Test-DockerReachable) -and (Test-ContainerUp)) {
      $hostFlags = @('-e', "JHT_HOST_TYPE=$env:JHT_HOST_TYPE")
      & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags @hostFlags $Container node $NodeEntry $Sub @Rest }
      exit $LASTEXITCODE
    }
    # A team that is simply off is not an error for a person (rc 0); a program reading the output keeps the line and rc 1.
    if ([Console]::IsOutputRedirected -and $env:JHT_MACHINE_OUTPUT -ne '0') {
      Write-Host (Format-JhtText 'ps.container_not_running' $Container)
      exit 1
    }
    Write-Host ('  ' + (Get-JhtText 'status.not_running'))
    Write-Host ('  -> ' + (Get-JhtText 'status.not_running_next'))
    exit 0
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
    if ($Sub -ceq 'team' -and $Rest.Count -gt 1 -and $Rest[0] -ceq 'chat' -and $env:JHT_TEAM_CHAT_RESUME) { Invoke-JhtTeamChatResume $Rest[1] }
    else { Ensure-Up }
    $hostFlags = @('-e', "JHT_HOST_TYPE=$env:JHT_HOST_TYPE")
    # a chat that comes back after an update or a switch is told so (the container side asks again the question that got no answer)
    if ($Sub -ceq 'team' -and $Rest.Count -gt 0 -and $Rest[0] -ceq 'chat' -and $env:JHT_TEAM_CHAT_RESUME) { $hostFlags += @('-e', 'JHT_TEAM_CHAT_RESUMED=1') }
    $code = $null
    if ($Sub -ceq 'team' -and $Rest.Count -gt 0 -and $Rest[0] -ceq 'chat') { $code = Invoke-JhtTeamChatOnConsole $hostFlags }
    if ($null -eq $code) {
      & { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags @hostFlags $Container node $NodeEntry $Sub @Rest }
      $code = $LASTEXITCODE
    }
    # the REPL ended because the team is moving onto the full image: it comes back by itself once the team runs again
    if ($Sub -ceq 'team' -and $Rest.Count -gt 0 -and $Rest[0] -ceq 'chat' -and (Test-JhtTeamChatEndedBySwitch)) {
      Complete-JhtTeamChatErrors -Drop
      Invoke-JhtTeamChatThroughSwitch $Rest
      exit $script:JhtTeamChatCode
    }
    # the engine went away under the REPL (an update restarts the Podman machine): no raw line, the chat comes back by itself
    if ($Sub -ceq 'team' -and $Rest.Count -gt 0 -and $Rest[0] -ceq 'chat' -and (Test-JhtTeamChatEngineGone $code)) {
      Complete-JhtTeamChatErrors -Drop
      Invoke-JhtTeamChatThroughUpdate $Rest
      exit $script:JhtTeamChatCode
    }
    Complete-JhtTeamChatErrors
    if ($Sub -eq 'cloud' -and $Rest.Count -gt 0 -and $Rest[0] -eq 'pair' -and $code -eq 0) { if ((Ensure-Broker) -eq 0) { Initialize-BrokerWebAuthorisations } }
    exit $code
    break
  }
}

exit $LASTEXITCODE
