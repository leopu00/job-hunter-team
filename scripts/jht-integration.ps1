# jht-integration.ps1 - `jht integration list|status|add|remove`: the integrations a person adds AFTER the setup.
#
# Not a program: a library the wrapper dot-sources once its digest matches the runtime manifest (Import-RuntimeHelper in
# jht-wrapper.ps1). It uses the wrapper's own functions (Invoke-Compose, Get-RunningComposeServiceId, Ensure-Up).
# JHT_RUNTIME_HELPER=1
#
# Same contract as scripts/jht-integration.sh, which is the reference:
#   - the id is one of a CLOSED list, checked before anything else; no text of the person ever reaches a native command;
#   - the state is read from the ENGINE (container found by the wrapper, volumes of the compose project) and from small
#     host-owned markers in $RuntimeDir\integrations, never from a file the container can write;
#   - nothing is turned on by an agent: this is the command the person types (or the button of the app).
# States (JSON `state`): not_installed | downloading | ready | running | error, always with a `reason` of one line.
# Exit: 0 done - 1 failed - 2 wrong use - 3 not available yet.

$IntegrationIds = @('google', 'telegram', 'mail', 'linkedin-login', 'screen', 'media')
$IntegrationNotYet = @()
# Fixed text, run inside the team's container: the libraries of Google go to the person's own store (jht-install).
# Single quotes only: Windows PowerShell 5.1 drops a double quote inside a native argument.
$IntegrationGoogleCode = "import sys; sys.path.insert(0, '/app/shared/skills'); from optional_libs import ensure, GOOGLE_DRIVE, GOOGLE_SHEETS; ensure(*GOOGLE_DRIVE, 'Google Drive'); ensure(*GOOGLE_SHEETS, 'Google Sheets')"

function Get-IntegrationLabel {
  param([string]$State)
  switch -CaseSensitive ($State) {
    'not_installed' { return (Get-IntegrationText 'integration.label.not_installed' 'not installed') }
    'downloading' { return (Get-IntegrationText 'integration.label.downloading' 'downloading') }
    'ready' { return (Get-IntegrationText 'integration.label.ready' 'added') }
    'running' { return (Get-IntegrationText 'integration.label.running' 'on') }
    default { return (Get-IntegrationText 'integration.label.error' 'error') }
  }
}

# Text from a command goes through here: printable ASCII only, one line, short.
# What the person reads is in the language the wrapper decided (Get-JhtTextLanguage: the choice in i18n-prefs.json, JHT_LANG,
# host.env, the language of Windows), in the 7 languages of shared/locales, with the same keys as scripts/jht-integration.sh: the
# block below is made from the catalogs (python3 tests/integration_ps1_texts.py --write), and a test fails when the two differ. A key
# a language lacks says the English of the call. Own names (Get-IntegrationText, not a generic one): this file is dot-sourced into
# the wrapper. The words of the JSON (`state`, the LinkedIn `reason` codes) are never translated: only the sentence for the person.
function Get-IntegrationText {
  param([string]$Key, [string]$English)
  $lang = 'en'
  if (Get-Command Get-JhtTextLanguage -CommandType Function -ErrorAction SilentlyContinue) { $lang = [string](Get-JhtTextLanguage) }
  $text = Get-IntegrationTextTable $lang $Key
  if ($null -eq $text) { return $English }
  return $text
}

# The same, with the values put in for %s/%d in order (never -f: the catalog is the one of bash too, and a { in a text breaks nothing).
function Format-IntegrationText {
  param([string]$Key, [string]$English, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Values)
  $text = Get-IntegrationText $Key $English
  $out = New-Object System.Text.StringBuilder
  $at = 0
  $next = 0
  foreach ($match in [regex]::Matches($text, '%[sd]')) {
    [void]$out.Append($text.Substring($at, $match.Index - $at))
    if ($null -ne $Values -and $next -lt $Values.Count) { [void]$out.Append([string]$Values[$next]) }
    $next++
    $at = $match.Index + $match.Length
  }
  [void]$out.Append($text.Substring($at))
  return $out.ToString()
}

# >>> texts in the 7 languages, made from shared/locales by `python3 tests/integration_ps1_texts.py --write`: do not edit by hand
function Get-IntegrationTextTable {
  param([string]$Lang, [string]$Key)
  switch -CaseSensitive ("$Lang`:$Key") {
    'en:integration.add.broker_not_on' { return 'the mail broker is not on' }
    'en:integration.add.broker_start' { return 'the mail broker does not start' }
    'en:integration.add.closer_browser' { return 'the browser of the closer does not copy into the volume' }
    'en:integration.add.extras_pull' { return 'downloading the tools image did not work' }
    'en:integration.add.google_failed' { return 'installing the libraries did not work' }
    'en:integration.add.linkedin' { return 'it is not added: it starts with jht linkedin login' }
    'en:integration.add.marker' { return 'marker not written' }
    'en:integration.add.media_not_on' { return 'the media container is not on' }
    'en:integration.add.media_start' { return 'the media container does not start' }
    'en:integration.add.screen_folder' { return 'live-screen in ~/.jht is not a plain folder (a link?): I do not use it' }
    'en:integration.add.screen_not_on' { return 'the screen container is not on' }
    'en:integration.add.screen_password' { return 'the folder of the screen password was not made' }
    'en:integration.add.screen_start' { return 'the screen container does not start' }
    'en:integration.add.telegram_not_on' { return 'the Telegram service is not on' }
    'en:integration.add.telegram_start' { return 'the Telegram service does not start' }
    'en:integration.change.markers_unsafe' { return 'the folder of the markers is not safe' }
    'en:integration.engine_log_written' { return 'state of the Podman engine written to %s' }
    'en:integration.image.engine_keeps' { return 'container removed, but the engine does not remove the tools image%s: something still uses it' }
    'en:integration.image.in_use' { return 'the tools image%s is not removed: %s still uses it' }
    'en:integration.image.removed' { return 'tools image removed%s' }
    'en:integration.image.size' { return 'up to %d MB' }
    'en:integration.image.stays' { return 'the tools image%s stays on the disk to start it again without downloading it: to free the space, %s' }
    'en:integration.label.downloading' { return 'downloading' }
    'en:integration.label.error' { return 'error' }
    'en:integration.label.not_installed' { return 'not installed' }
    'en:integration.label.ready' { return 'added' }
    'en:integration.label.running' { return 'on' }
    'en:integration.linkedin.profile_not_plain' { return 'the LinkedIn profile in ~/.jht is not a plain folder (a link?): I do not use it' }
    'en:integration.linkedin.token_stdin' { return 'the window token comes from the app, on the standard input' }
    'en:integration.linkedin.usage' { return 'usage: jht linkedin login [--stop] | status --json' }
    'en:integration.purge_needs_yes' { return '--purge deletes the data of the integration: --yes is needed too' }
    'en:integration.remove.broker_stop' { return 'the mail broker does not stop' }
    'en:integration.remove.google' { return 'marked as not added; the libraries stay in the profile and use no resources' }
    'en:integration.remove.kept' { return 'container removed; the data stays (to delete it: --purge --yes)' }
    'en:integration.remove.linkedin' { return 'containers removed; the LinkedIn session in the profile stays (jht reset --scope creds removes it)' }
    'en:integration.remove.linkedin_stop' { return 'the containers of the LinkedIn sign-in do not stop' }
    'en:integration.remove.mail_purged' { return 'container and broker state deleted; the mail password and the credentials of the portals stay in the secrets volume (jht reset --scope creds)' }
    'en:integration.remove.media_purged' { return 'container removed; the two exchange folders with jht stay (they belong to jht and hold none of your files)' }
    'en:integration.remove.media_stop' { return 'the media container does not stop' }
    'en:integration.remove.purged' { return 'container and data deleted' }
    'en:integration.remove.screen_off' { return 'screen off and container removed' }
    'en:integration.remove.screen_purged' { return 'container removed; the display folder shared with jht was deleted' }
    'en:integration.remove.screen_stop' { return 'the screen container does not stop' }
    'en:integration.remove.telegram_stop' { return 'the Telegram service does not stop' }
    'en:integration.remove.volume' { return 'a volume cannot be deleted: %s' }
    'en:integration.remove_image_only' { return '--remove-image is for screen and media: they are the two made with the tools image' }
    'en:integration.state.added_off' { return 'added, container off' }
    'en:integration.state.container_on' { return 'container on' }
    'en:integration.state.engine_silent' { return 'the container engine does not answer' }
    'en:integration.state.google_ready' { return 'Google libraries added to the profile; the credentials of the Google account are missing' }
    'en:integration.state.in_progress' { return 'operation in progress' }
    'en:integration.state.linkedin_how' { return 'it starts with: jht linkedin login' }
    'en:integration.state.linkedin_running' { return 'LinkedIn sign-in in progress' }
    'en:integration.state.media_off' { return 'added, container off: jht integration add media starts it again' }
    'en:integration.state.not_added' { return 'not added yet' }
    'en:integration.state.not_yet' { return 'not available yet' }
    'en:integration.state.screen_asked_off' { return 'asked on but the container is off: jht screen on starts it again' }
    'en:integration.state.screen_running' { return 'screen on, view-only stream on 127.0.0.1' }
    'en:integration.state.telegram_no_bot' { return 'service on, no bot paired: jht telegram pair assistente' }
    'en:integration.state.telegram_off' { return 'added, service off: jht telegram pair assistente (with a bot already paired, jht up starts it again)' }
    'en:integration.state.unattestable' { return 'the container cannot be attested' }
    'en:integration.unknown' { return 'unknown integration. allowed ids: %s' }
    'en:integration.usage' { return 'usage: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' }
    'it:integration.add.broker_not_on' { return 'il broker della posta non risulta acceso' }
    'it:integration.add.broker_start' { return 'il broker della posta non parte' }
    'it:integration.add.closer_browser' { return 'il browser del closer non si copia nel volume' }
    'it:integration.add.extras_pull' { return 'download dell''immagine degli strumenti non riuscito' }
    'it:integration.add.google_failed' { return 'installazione delle librerie non riuscita' }
    'it:integration.add.linkedin' { return 'non si aggiunge: si accende con jht linkedin login' }
    'it:integration.add.marker' { return 'marcatore non scritto' }
    'it:integration.add.media_not_on' { return 'il container dei media non risulta acceso' }
    'it:integration.add.media_start' { return 'il container dei media non parte' }
    'it:integration.add.screen_folder' { return 'live-screen in ~/.jht non e'' una cartella normale (un collegamento?): non la uso' }
    'it:integration.add.screen_not_on' { return 'il container dello schermo non risulta acceso' }
    'it:integration.add.screen_password' { return 'cartella della password dello schermo non creata' }
    'it:integration.add.screen_start' { return 'il container dello schermo non parte' }
    'it:integration.add.telegram_not_on' { return 'il servizio Telegram non risulta acceso' }
    'it:integration.add.telegram_start' { return 'il servizio Telegram non parte' }
    'it:integration.change.markers_unsafe' { return 'cartella dei marcatori non sicura' }
    'it:integration.engine_log_written' { return 'stato del motore Podman scritto in %s' }
    'it:integration.image.engine_keeps' { return 'container tolto, ma il motore non toglie l''immagine degli strumenti%s: la usa ancora qualcosa' }
    'it:integration.image.in_use' { return 'l''immagine degli strumenti%s non e'' tolta: la usa ancora %s' }
    'it:integration.image.removed' { return 'immagine degli strumenti tolta%s' }
    'it:integration.image.size' { return 'fino a %d MB' }
    'it:integration.image.stays' { return 'l''immagine degli strumenti%s resta sul disco per riaccenderlo senza riscaricarla: per liberare lo spazio, %s' }
    'it:integration.label.downloading' { return 'in scaricamento' }
    'it:integration.label.error' { return 'errore' }
    'it:integration.label.not_installed' { return 'non installato' }
    'it:integration.label.ready' { return 'aggiunto' }
    'it:integration.label.running' { return 'acceso' }
    'it:integration.linkedin.profile_not_plain' { return 'il profilo di LinkedIn in ~/.jht non e'' una cartella normale (un collegamento?): non lo uso' }
    'it:integration.linkedin.token_stdin' { return 'il token della finestra arriva dall''app, sullo standard input' }
    'it:integration.linkedin.usage' { return 'uso: jht linkedin login [--stop] | status --json' }
    'it:integration.purge_needs_yes' { return '--purge cancella i dati dell''integrazione: serve anche --yes' }
    'it:integration.remove.broker_stop' { return 'il broker della posta non si ferma' }
    'it:integration.remove.google' { return 'segnato come non aggiunto; le librerie restano nel profilo e non occupano risorse' }
    'it:integration.remove.kept' { return 'container tolto; i dati restano (per cancellarli: --purge --yes)' }
    'it:integration.remove.linkedin' { return 'container tolti; la sessione di LinkedIn nel profilo resta (jht reset --scope creds la toglie)' }
    'it:integration.remove.linkedin_stop' { return 'i container dell''accesso a LinkedIn non si fermano' }
    'it:integration.remove.mail_purged' { return 'container e stato del broker cancellati; la password della posta e le credenziali dei portali restano nel volume dei segreti (jht reset --scope creds)' }
    'it:integration.remove.media_purged' { return 'container tolto; le due cartelle di scambio con jht restano (sono di jht e non contengono i tuoi file)' }
    'it:integration.remove.media_stop' { return 'il container dei media non si ferma' }
    'it:integration.remove.purged' { return 'container e dati cancellati' }
    'it:integration.remove.screen_off' { return 'schermo spento e container tolto' }
    'it:integration.remove.screen_purged' { return 'container tolto; la cartella del display condivisa con jht e'' stata cancellata' }
    'it:integration.remove.screen_stop' { return 'il container dello schermo non si ferma' }
    'it:integration.remove.telegram_stop' { return 'il servizio Telegram non si ferma' }
    'it:integration.remove.volume' { return 'un volume non si cancella: %s' }
    'it:integration.remove_image_only' { return '--remove-image vale per screen e media: sono i due che si fanno con l''immagine degli strumenti' }
    'it:integration.state.added_off' { return 'aggiunto, container spento' }
    'it:integration.state.container_on' { return 'container acceso' }
    'it:integration.state.engine_silent' { return 'il motore dei container non risponde' }
    'it:integration.state.google_ready' { return 'librerie di Google aggiunte al profilo; mancano le credenziali dell''account Google' }
    'it:integration.state.in_progress' { return 'operazione in corso' }
    'it:integration.state.linkedin_how' { return 'si accende con: jht linkedin login' }
    'it:integration.state.linkedin_running' { return 'accesso a LinkedIn in corso' }
    'it:integration.state.media_off' { return 'aggiunto, container spento: jht integration add media lo riaccende' }
    'it:integration.state.not_added' { return 'non ancora aggiunto' }
    'it:integration.state.not_yet' { return 'non disponibile ancora' }
    'it:integration.state.screen_asked_off' { return 'chiesto acceso ma il container e'' spento: jht screen on lo riaccende' }
    'it:integration.state.screen_running' { return 'schermo acceso, stream in sola vista su 127.0.0.1' }
    'it:integration.state.telegram_no_bot' { return 'servizio acceso, nessun bot abbinato: jht telegram pair assistente' }
    'it:integration.state.telegram_off' { return 'aggiunto, servizio spento: jht telegram pair assistente (con un bot gia'' abbinato lo riaccende jht up)' }
    'it:integration.state.unattestable' { return 'il container non e'' attestabile' }
    'it:integration.unknown' { return 'integrazione sconosciuta. id ammessi: %s' }
    'it:integration.usage' { return 'uso: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' }
    'hu:integration.add.broker_not_on' { return ('a levelez' + [char]0x00E9 + 'si broker nincs bekapcsolva') }
    'hu:integration.add.broker_start' { return ('a levelez' + [char]0x00E9 + 'si broker nem indul') }
    'hu:integration.add.closer_browser' { return ('a closer b' + [char]0x00F6 + 'ng' + [char]0x00E9 + 'sz' + [char]0x0151 + 'je nem m' + [char]0x00E1 + 'sol' + [char]0x00F3 + 'dik ' + [char]0x00E1 + 't a k' + [char]0x00F6 + 'tetbe') }
    'hu:integration.add.extras_pull' { return ('az eszk' + [char]0x00F6 + 'zk' + [char]0x00E9 + 'p let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 'se nem siker' + [char]0x00FC + 'lt') }
    'hu:integration.add.google_failed' { return ('a k' + [char]0x00F6 + 'nyvt' + [char]0x00E1 + 'rak telep' + [char]0x00ED + 't' + [char]0x00E9 + 'se nem siker' + [char]0x00FC + 'lt') }
    'hu:integration.add.linkedin' { return ('nem adhat' + [char]0x00F3 + ' hozz' + [char]0x00E1 + ': a jht linkedin login ind' + [char]0x00ED + 'tja') }
    'hu:integration.add.marker' { return ('a jel' + [char]0x00F6 + 'l' + [char]0x0151 + ' nem ' + [char]0x00ED + 'r' + [char]0x00F3 + 'dott ki') }
    'hu:integration.add.media_not_on' { return ('a m' + [char]0x00E9 + 'dia-kont' + [char]0x00E9 + 'ner nincs bekapcsolva') }
    'hu:integration.add.media_start' { return ('a m' + [char]0x00E9 + 'dia-kont' + [char]0x00E9 + 'ner nem indul') }
    'hu:integration.add.screen_folder' { return ('a live-screen a ~/.jht mapp' + [char]0x00E1 + 'ban nem sima mappa (hivatkoz' + [char]0x00E1 + 's?): nem haszn' + [char]0x00E1 + 'lom') }
    'hu:integration.add.screen_not_on' { return ('a k' + [char]0x00E9 + 'perny' + [char]0x0151 + '-kont' + [char]0x00E9 + 'ner nincs bekapcsolva') }
    'hu:integration.add.screen_password' { return ('a k' + [char]0x00E9 + 'perny' + [char]0x0151 + ' jelszav' + [char]0x00E1 + 'nak mapp' + [char]0x00E1 + 'ja nem j' + [char]0x00F6 + 'tt l' + [char]0x00E9 + 'tre') }
    'hu:integration.add.screen_start' { return ('a k' + [char]0x00E9 + 'perny' + [char]0x0151 + '-kont' + [char]0x00E9 + 'ner nem indul') }
    'hu:integration.add.telegram_not_on' { return ('a Telegram-szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's nincs bekapcsolva') }
    'hu:integration.add.telegram_start' { return ('a Telegram-szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's nem indul') }
    'hu:integration.change.markers_unsafe' { return ('a jel' + [char]0x00F6 + 'l' + [char]0x0151 + 'k mapp' + [char]0x00E1 + 'ja nem biztons' + [char]0x00E1 + 'gos') }
    'hu:integration.engine_log_written' { return ('a Podman motor ' + [char]0x00E1 + 'llapota ide ' + [char]0x00ED + 'r' + [char]0x00F3 + 'dott: %s') }
    'hu:integration.image.engine_keeps' { return ('a kont' + [char]0x00E9 + 'ner t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve, de a motor nem t' + [char]0x00F6 + 'rli az eszk' + [char]0x00F6 + 'zk' + [char]0x00E9 + 'pet%s: m' + [char]0x00E9 + 'g haszn' + [char]0x00E1 + 'lja valami') }
    'hu:integration.image.in_use' { return ('az eszk' + [char]0x00F6 + 'zk' + [char]0x00E9 + 'p%s nem t' + [char]0x00F6 + 'rl' + [char]0x0151 + 'dik: m' + [char]0x00E9 + 'g haszn' + [char]0x00E1 + 'lja: %s') }
    'hu:integration.image.removed' { return ('eszk' + [char]0x00F6 + 'zk' + [char]0x00E9 + 'p t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve%s') }
    'hu:integration.image.size' { return 'legfeljebb %d MB' }
    'hu:integration.image.stays' { return ('az eszk' + [char]0x00F6 + 'zk' + [char]0x00E9 + 'p%s a lemezen marad, hogy let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l ' + [char]0x00FA + 'jraind' + [char]0x00ED + 'thasd: a hely felszabad' + [char]0x00ED + 't' + [char]0x00E1 + 's' + [char]0x00E1 + 'hoz: %s') }
    'hu:integration.label.downloading' { return ('let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's folyamatban') }
    'hu:integration.label.error' { return 'hiba' }
    'hu:integration.label.not_installed' { return ('nincs telep' + [char]0x00ED + 'tve') }
    'hu:integration.label.ready' { return ('hozz' + [char]0x00E1 + 'adva') }
    'hu:integration.label.running' { return 'bekapcsolva' }
    'hu:integration.linkedin.profile_not_plain' { return ('a LinkedIn-profil a ~/.jht mapp' + [char]0x00E1 + 'ban nem sima mappa (hivatkoz' + [char]0x00E1 + 's?): nem haszn' + [char]0x00E1 + 'lom') }
    'hu:integration.linkedin.token_stdin' { return ('az ablak tokenje az alkalmaz' + [char]0x00E1 + 'st' + [char]0x00F3 + 'l ' + [char]0x00E9 + 'rkezik, a szabv' + [char]0x00E1 + 'nyos bemeneten') }
    'hu:integration.linkedin.usage' { return ('haszn' + [char]0x00E1 + 'lat: jht linkedin login [--stop] | status --json') }
    'hu:integration.purge_needs_yes' { return ('a --purge t' + [char]0x00F6 + 'rli az integr' + [char]0x00E1 + 'ci' + [char]0x00F3 + ' adatait: a --yes is kell') }
    'hu:integration.remove.broker_stop' { return ('a levelez' + [char]0x00E9 + 'si broker nem ' + [char]0x00E1 + 'll le') }
    'hu:integration.remove.google' { return ('nem hozz' + [char]0x00E1 + 'adottk' + [char]0x00E9 + 'nt jel' + [char]0x00F6 + 'lve; a k' + [char]0x00F6 + 'nyvt' + [char]0x00E1 + 'rak a profilban maradnak, ' + [char]0x00E9 + 's nem foglalnak er' + [char]0x0151 + 'forr' + [char]0x00E1 + 'st') }
    'hu:integration.remove.kept' { return ('a kont' + [char]0x00E9 + 'ner t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve; az adatok megmaradnak (t' + [char]0x00F6 + 'rl' + [char]0x00E9 + 's' + [char]0x00FC + 'kh' + [char]0x00F6 + 'z: --purge --yes)') }
    'hu:integration.remove.linkedin' { return ('a kont' + [char]0x00E9 + 'nerek t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve; a profilban l' + [char]0x00E9 + 'v' + [char]0x0151 + ' LinkedIn-munkamenet megmarad (a jht reset --scope creds t' + [char]0x00F6 + 'rli)') }
    'hu:integration.remove.linkedin_stop' { return ('a LinkedIn-bejelentkez' + [char]0x00E9 + 's kont' + [char]0x00E9 + 'nerei nem ' + [char]0x00E1 + 'llnak le') }
    'hu:integration.remove.mail_purged' { return ('a kont' + [char]0x00E9 + 'ner ' + [char]0x00E9 + 's a broker ' + [char]0x00E1 + 'llapota t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve; a levelez' + [char]0x00E9 + 'si jelsz' + [char]0x00F3 + ' ' + [char]0x00E9 + 's a port' + [char]0x00E1 + 'lok hiteles' + [char]0x00ED + 't' + [char]0x0151 + ' adatai a titkok k' + [char]0x00F6 + 'tet' + [char]0x00E9 + 'ben maradnak (jht reset --scope creds)') }
    'hu:integration.remove.media_purged' { return ('a kont' + [char]0x00E9 + 'ner t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve; a jht-vel k' + [char]0x00F6 + 'z' + [char]0x00F6 + 's k' + [char]0x00E9 + 't cseremappa megmarad (a jht-' + [char]0x00E9 + ', ' + [char]0x00E9 + 's egyetlen f' + [char]0x00E1 + 'jlodat sem tartalmazz' + [char]0x00E1 + 'k)') }
    'hu:integration.remove.media_stop' { return ('a m' + [char]0x00E9 + 'dia-kont' + [char]0x00E9 + 'ner nem ' + [char]0x00E1 + 'll le') }
    'hu:integration.remove.purged' { return ('a kont' + [char]0x00E9 + 'ner ' + [char]0x00E9 + 's az adatok t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve') }
    'hu:integration.remove.screen_off' { return ('a k' + [char]0x00E9 + 'perny' + [char]0x0151 + ' kikapcsolva, a kont' + [char]0x00E9 + 'ner t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve') }
    'hu:integration.remove.screen_purged' { return ('a kont' + [char]0x00E9 + 'ner t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve; a jht-vel megosztott kijelz' + [char]0x0151 + 'mappa t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lve') }
    'hu:integration.remove.screen_stop' { return ('a k' + [char]0x00E9 + 'perny' + [char]0x0151 + '-kont' + [char]0x00E9 + 'ner nem ' + [char]0x00E1 + 'll le') }
    'hu:integration.remove.telegram_stop' { return ('a Telegram-szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's nem ' + [char]0x00E1 + 'll le') }
    'hu:integration.remove.volume' { return ('egy k' + [char]0x00F6 + 'tet nem t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lhet' + [char]0x0151 + ': %s') }
    'hu:integration.remove_image_only' { return ('a --remove-image a screen ' + [char]0x00E9 + 's a media integr' + [char]0x00E1 + 'ci' + [char]0x00F3 + 'ra vonatkozik: ez a kett' + [char]0x0151 + ' k' + [char]0x00E9 + 'sz' + [char]0x00FC + 'l az eszk' + [char]0x00F6 + 'zk' + [char]0x00E9 + 'pb' + [char]0x0151 + 'l') }
    'hu:integration.state.added_off' { return ('hozz' + [char]0x00E1 + 'adva, a kont' + [char]0x00E9 + 'ner ki van kapcsolva') }
    'hu:integration.state.container_on' { return ('kont' + [char]0x00E9 + 'ner bekapcsolva') }
    'hu:integration.state.engine_silent' { return ('a kont' + [char]0x00E9 + 'nermotor nem v' + [char]0x00E1 + 'laszol') }
    'hu:integration.state.google_ready' { return ('a Google-k' + [char]0x00F6 + 'nyvt' + [char]0x00E1 + 'rak hozz' + [char]0x00E1 + 'adva a profilhoz; hi' + [char]0x00E1 + 'nyoznak a Google-fi' + [char]0x00F3 + 'k hiteles' + [char]0x00ED + 't' + [char]0x0151 + ' adatai') }
    'hu:integration.state.in_progress' { return ('m' + [char]0x0171 + 'velet folyamatban') }
    'hu:integration.state.linkedin_how' { return ('' + [char]0x00ED + 'gy indul: jht linkedin login') }
    'hu:integration.state.linkedin_running' { return ('LinkedIn-bejelentkez' + [char]0x00E9 + 's folyamatban') }
    'hu:integration.state.media_off' { return ('hozz' + [char]0x00E1 + 'adva, a kont' + [char]0x00E9 + 'ner ki van kapcsolva: a jht integration add media ' + [char]0x00FA + 'jraind' + [char]0x00ED + 'tja') }
    'hu:integration.state.not_added' { return ('m' + [char]0x00E9 + 'g nincs hozz' + [char]0x00E1 + 'adva') }
    'hu:integration.state.not_yet' { return ('m' + [char]0x00E9 + 'g nem ' + [char]0x00E9 + 'rhet' + [char]0x0151 + ' el') }
    'hu:integration.state.screen_asked_off' { return ('bekapcsol' + [char]0x00E1 + 'st k' + [char]0x00E9 + 'rt' + [char]0x00E9 + 'l, de a kont' + [char]0x00E9 + 'ner ki van kapcsolva: a jht screen on ' + [char]0x00FA + 'jraind' + [char]0x00ED + 'tja') }
    'hu:integration.state.screen_running' { return ('a k' + [char]0x00E9 + 'perny' + [char]0x0151 + ' bekapcsolva, csak megtekint' + [char]0x00E9 + 'sre szolg' + [char]0x00E1 + 'l' + [char]0x00F3 + ' stream a 127.0.0.1 c' + [char]0x00ED + 'men') }
    'hu:integration.state.telegram_no_bot' { return ('a szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's bekapcsolva, nincs p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tott bot: jht telegram pair assistente') }
    'hu:integration.state.telegram_off' { return ('hozz' + [char]0x00E1 + 'adva, a szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 's ki van kapcsolva: jht telegram pair assistente (ha m' + [char]0x00E1 + 'r van p' + [char]0x00E1 + 'ros' + [char]0x00ED + 'tott bot, a jht up ' + [char]0x00FA + 'jraind' + [char]0x00ED + 'tja)') }
    'hu:integration.state.unattestable' { return ('a kont' + [char]0x00E9 + 'ner nem hiteles' + [char]0x00ED + 'thet' + [char]0x0151) }
    'hu:integration.unknown' { return ('ismeretlen integr' + [char]0x00E1 + 'ci' + [char]0x00F3 + '. enged' + [char]0x00E9 + 'lyezett azonos' + [char]0x00ED + 't' + [char]0x00F3 + 'k: %s') }
    'hu:integration.usage' { return ('haszn' + [char]0x00E1 + 'lat: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]') }
    'es:integration.add.broker_not_on' { return ('el broker del correo no est' + [char]0x00E1 + ' encendido') }
    'es:integration.add.broker_start' { return 'el broker del correo no arranca' }
    'es:integration.add.closer_browser' { return 'el navegador del closer no se copia en el volumen' }
    'es:integration.add.extras_pull' { return 'la descarga de la imagen de herramientas no ha funcionado' }
    'es:integration.add.google_failed' { return ('la instalaci' + [char]0x00F3 + 'n de las bibliotecas no ha funcionado') }
    'es:integration.add.linkedin' { return ('no se a' + [char]0x00F1 + 'ade: se enciende con jht linkedin login') }
    'es:integration.add.marker' { return 'marcador no escrito' }
    'es:integration.add.media_not_on' { return ('el contenedor de media no est' + [char]0x00E1 + ' encendido') }
    'es:integration.add.media_start' { return 'el contenedor de media no arranca' }
    'es:integration.add.screen_folder' { return ('live-screen en ~/.jht no es una carpeta normal (' + [char]0x00BF + 'un enlace?): no la uso') }
    'es:integration.add.screen_not_on' { return ('el contenedor de la pantalla no est' + [char]0x00E1 + ' encendido') }
    'es:integration.add.screen_password' { return ('no se ha creado la carpeta de la contrase' + [char]0x00F1 + 'a de la pantalla') }
    'es:integration.add.screen_start' { return 'el contenedor de la pantalla no arranca' }
    'es:integration.add.telegram_not_on' { return ('el servicio de Telegram no est' + [char]0x00E1 + ' encendido') }
    'es:integration.add.telegram_start' { return 'el servicio de Telegram no arranca' }
    'es:integration.change.markers_unsafe' { return 'la carpeta de los marcadores no es segura' }
    'es:integration.engine_log_written' { return 'estado del motor de Podman escrito en %s' }
    'es:integration.image.engine_keeps' { return ('contenedor quitado, pero el motor no quita la imagen de herramientas%s: algo a' + [char]0x00FA + 'n la usa') }
    'es:integration.image.in_use' { return ('la imagen de herramientas%s no se quita: a' + [char]0x00FA + 'n la usa %s') }
    'es:integration.image.removed' { return 'imagen de herramientas quitada%s' }
    'es:integration.image.size' { return 'hasta %d MB' }
    'es:integration.image.stays' { return 'la imagen de herramientas%s se queda en el disco para volver a encenderlo sin descargarla otra vez: para liberar el espacio, %s' }
    'es:integration.label.downloading' { return 'descargando' }
    'es:integration.label.error' { return 'error' }
    'es:integration.label.not_installed' { return 'no instalado' }
    'es:integration.label.ready' { return ('a' + [char]0x00F1 + 'adido') }
    'es:integration.label.running' { return 'encendido' }
    'es:integration.linkedin.profile_not_plain' { return ('el perfil de LinkedIn en ~/.jht no es una carpeta normal (' + [char]0x00BF + 'un enlace?): no lo uso') }
    'es:integration.linkedin.token_stdin' { return ('el token de la ventana llega de la app, por la entrada est' + [char]0x00E1 + 'ndar') }
    'es:integration.linkedin.usage' { return 'uso: jht linkedin login [--stop] | status --json' }
    'es:integration.purge_needs_yes' { return ('--purge borra los datos de la integraci' + [char]0x00F3 + 'n: tambi' + [char]0x00E9 + 'n hace falta --yes') }
    'es:integration.remove.broker_stop' { return 'el broker del correo no se detiene' }
    'es:integration.remove.google' { return ('marcado como no a' + [char]0x00F1 + 'adido; las bibliotecas se quedan en el perfil y no consumen recursos') }
    'es:integration.remove.kept' { return 'contenedor quitado; los datos se quedan (para borrarlos: --purge --yes)' }
    'es:integration.remove.linkedin' { return ('contenedores quitados; la sesi' + [char]0x00F3 + 'n de LinkedIn en el perfil se queda (jht reset --scope creds la quita)') }
    'es:integration.remove.linkedin_stop' { return ('los contenedores del inicio de sesi' + [char]0x00F3 + 'n en LinkedIn no se detienen') }
    'es:integration.remove.mail_purged' { return ('contenedor y estado del broker borrados; la contrase' + [char]0x00F1 + 'a del correo y las credenciales de los portales se quedan en el volumen de secretos (jht reset --scope creds)') }
    'es:integration.remove.media_purged' { return 'contenedor quitado; las dos carpetas de intercambio con jht se quedan (son de jht y no contienen ninguno de tus archivos)' }
    'es:integration.remove.media_stop' { return 'el contenedor de media no se detiene' }
    'es:integration.remove.purged' { return 'contenedor y datos borrados' }
    'es:integration.remove.screen_off' { return 'pantalla apagada y contenedor quitado' }
    'es:integration.remove.screen_purged' { return 'contenedor quitado; se ha borrado la carpeta del display compartida con jht' }
    'es:integration.remove.screen_stop' { return 'el contenedor de la pantalla no se detiene' }
    'es:integration.remove.telegram_stop' { return 'el servicio de Telegram no se detiene' }
    'es:integration.remove.volume' { return 'no se puede borrar un volumen: %s' }
    'es:integration.remove_image_only' { return '--remove-image vale para screen y media: son las dos que se hacen con la imagen de herramientas' }
    'es:integration.state.added_off' { return ('a' + [char]0x00F1 + 'adido, contenedor apagado') }
    'es:integration.state.container_on' { return 'contenedor encendido' }
    'es:integration.state.engine_silent' { return 'el motor de contenedores no responde' }
    'es:integration.state.google_ready' { return ('bibliotecas de Google a' + [char]0x00F1 + 'adidas al perfil; faltan las credenciales de la cuenta de Google') }
    'es:integration.state.in_progress' { return ('operaci' + [char]0x00F3 + 'n en curso') }
    'es:integration.state.linkedin_how' { return 'se enciende con: jht linkedin login' }
    'es:integration.state.linkedin_running' { return ('inicio de sesi' + [char]0x00F3 + 'n en LinkedIn en curso') }
    'es:integration.state.media_off' { return ('a' + [char]0x00F1 + 'adido, contenedor apagado: jht integration add media lo vuelve a encender') }
    'es:integration.state.not_added' { return ('a' + [char]0x00FA + 'n no a' + [char]0x00F1 + 'adido') }
    'es:integration.state.not_yet' { return ('a' + [char]0x00FA + 'n no disponible') }
    'es:integration.state.screen_asked_off' { return ('pedido encendido pero el contenedor est' + [char]0x00E1 + ' apagado: jht screen on lo vuelve a encender') }
    'es:integration.state.screen_running' { return 'pantalla encendida, stream de solo lectura en 127.0.0.1' }
    'es:integration.state.telegram_no_bot' { return ('servicio encendido, ning' + [char]0x00FA + 'n bot emparejado: jht telegram pair assistente') }
    'es:integration.state.telegram_off' { return ('a' + [char]0x00F1 + 'adido, servicio apagado: jht telegram pair assistente (con un bot ya emparejado, jht up lo vuelve a encender)') }
    'es:integration.state.unattestable' { return 'el contenedor no se puede atestar' }
    'es:integration.unknown' { return ('integraci' + [char]0x00F3 + 'n desconocida. ids admitidos: %s') }
    'es:integration.usage' { return 'uso: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' }
    'de:integration.add.broker_not_on' { return 'der Mail-Broker ist nicht an' }
    'de:integration.add.broker_start' { return 'der Mail-Broker startet nicht' }
    'de:integration.add.closer_browser' { return ('der Browser des closer l' + [char]0x00E4 + 'sst sich nicht in das Volume kopieren') }
    'de:integration.add.extras_pull' { return 'der Download des Werkzeug-Images hat nicht geklappt' }
    'de:integration.add.google_failed' { return 'die Installation der Bibliotheken hat nicht geklappt' }
    'de:integration.add.linkedin' { return ('wird nicht hinzugef' + [char]0x00FC + 'gt: Start mit jht linkedin login') }
    'de:integration.add.marker' { return 'Markierung nicht geschrieben' }
    'de:integration.add.media_not_on' { return 'der Medien-Container ist nicht an' }
    'de:integration.add.media_start' { return 'der Medien-Container startet nicht' }
    'de:integration.add.screen_folder' { return 'live-screen in ~/.jht ist kein normaler Ordner (ein Link?): ich verwende ihn nicht' }
    'de:integration.add.screen_not_on' { return 'der Bildschirm-Container ist nicht an' }
    'de:integration.add.screen_password' { return ('der Ordner f' + [char]0x00FC + 'r das Bildschirm-Passwort wurde nicht angelegt') }
    'de:integration.add.screen_start' { return 'der Bildschirm-Container startet nicht' }
    'de:integration.add.telegram_not_on' { return 'der Telegram-Dienst ist nicht an' }
    'de:integration.add.telegram_start' { return 'der Telegram-Dienst startet nicht' }
    'de:integration.change.markers_unsafe' { return 'der Ordner der Markierungen ist nicht sicher' }
    'de:integration.engine_log_written' { return 'Zustand der Podman-Engine nach %s geschrieben' }
    'de:integration.image.engine_keeps' { return 'Container entfernt, aber die Engine entfernt das Werkzeug-Image%s nicht: etwas verwendet es noch' }
    'de:integration.image.in_use' { return 'das Werkzeug-Image%s wird nicht entfernt: %s verwendet es noch' }
    'de:integration.image.removed' { return 'Werkzeug-Image entfernt%s' }
    'de:integration.image.size' { return 'bis zu %d MB' }
    'de:integration.image.stays' { return 'das Werkzeug-Image%s bleibt auf der Festplatte, damit du ohne erneuten Download wieder starten kannst: um den Platz freizugeben, %s' }
    'de:integration.label.downloading' { return 'wird heruntergeladen' }
    'de:integration.label.error' { return 'Fehler' }
    'de:integration.label.not_installed' { return 'nicht installiert' }
    'de:integration.label.ready' { return ('hinzugef' + [char]0x00FC + 'gt') }
    'de:integration.label.running' { return 'an' }
    'de:integration.linkedin.profile_not_plain' { return 'das LinkedIn-Profil in ~/.jht ist kein normaler Ordner (ein Link?): ich verwende es nicht' }
    'de:integration.linkedin.token_stdin' { return ('das Fenster-Token kommt von der App, ' + [char]0x00FC + 'ber die Standardeingabe') }
    'de:integration.linkedin.usage' { return 'Verwendung: jht linkedin login [--stop] | status --json' }
    'de:integration.purge_needs_yes' { return ('--purge l' + [char]0x00F6 + 'scht die Daten der Integration: --yes ist auch n' + [char]0x00F6 + 'tig') }
    'de:integration.remove.broker_stop' { return 'der Mail-Broker stoppt nicht' }
    'de:integration.remove.google' { return ('als nicht hinzugef' + [char]0x00FC + 'gt markiert; die Bibliotheken bleiben im Profil und verbrauchen keine Ressourcen') }
    'de:integration.remove.kept' { return ('Container entfernt; die Daten bleiben (zum L' + [char]0x00F6 + 'schen: --purge --yes)') }
    'de:integration.remove.linkedin' { return 'Container entfernt; die LinkedIn-Sitzung im Profil bleibt (jht reset --scope creds entfernt sie)' }
    'de:integration.remove.linkedin_stop' { return 'die Container der LinkedIn-Anmeldung stoppen nicht' }
    'de:integration.remove.mail_purged' { return ('Container und Zustand des Brokers gel' + [char]0x00F6 + 'scht; das Mail-Passwort und die Zugangsdaten der Portale bleiben im Secrets-Volume (jht reset --scope creds)') }
    'de:integration.remove.media_purged' { return ('Container entfernt; die zwei Austauschordner mit jht bleiben (sie geh' + [char]0x00F6 + 'ren jht und enthalten keine deiner Dateien)') }
    'de:integration.remove.media_stop' { return 'der Medien-Container stoppt nicht' }
    'de:integration.remove.purged' { return ('Container und Daten gel' + [char]0x00F6 + 'scht') }
    'de:integration.remove.screen_off' { return 'Bildschirm aus und Container entfernt' }
    'de:integration.remove.screen_purged' { return ('Container entfernt; der mit jht geteilte Display-Ordner wurde gel' + [char]0x00F6 + 'scht') }
    'de:integration.remove.screen_stop' { return 'der Bildschirm-Container stoppt nicht' }
    'de:integration.remove.telegram_stop' { return 'der Telegram-Dienst stoppt nicht' }
    'de:integration.remove.volume' { return ('ein Volume l' + [char]0x00E4 + 'sst sich nicht l' + [char]0x00F6 + 'schen: %s') }
    'de:integration.remove_image_only' { return ('--remove-image gilt f' + [char]0x00FC + 'r screen und media: das sind die zwei, die mit dem Werkzeug-Image laufen') }
    'de:integration.state.added_off' { return ('hinzugef' + [char]0x00FC + 'gt, Container aus') }
    'de:integration.state.container_on' { return 'Container an' }
    'de:integration.state.engine_silent' { return 'die Container-Engine antwortet nicht' }
    'de:integration.state.google_ready' { return ('Google-Bibliotheken zum Profil hinzugef' + [char]0x00FC + 'gt; die Zugangsdaten des Google-Kontos fehlen') }
    'de:integration.state.in_progress' { return ('Vorgang l' + [char]0x00E4 + 'uft') }
    'de:integration.state.linkedin_how' { return 'Start mit: jht linkedin login' }
    'de:integration.state.linkedin_running' { return ('Anmeldung bei LinkedIn l' + [char]0x00E4 + 'uft') }
    'de:integration.state.media_off' { return ('hinzugef' + [char]0x00FC + 'gt, Container aus: jht integration add media startet ihn wieder') }
    'de:integration.state.not_added' { return ('noch nicht hinzugef' + [char]0x00FC + 'gt') }
    'de:integration.state.not_yet' { return ('noch nicht verf' + [char]0x00FC + 'gbar') }
    'de:integration.state.screen_asked_off' { return 'an angefordert, aber der Container ist aus: jht screen on startet ihn wieder' }
    'de:integration.state.screen_running' { return 'Bildschirm an, Stream nur zum Ansehen auf 127.0.0.1' }
    'de:integration.state.telegram_no_bot' { return 'Dienst an, kein Bot gekoppelt: jht telegram pair assistente' }
    'de:integration.state.telegram_off' { return ('hinzugef' + [char]0x00FC + 'gt, Dienst aus: jht telegram pair assistente (mit einem schon gekoppelten Bot startet ihn jht up wieder)') }
    'de:integration.state.unattestable' { return ('der Container l' + [char]0x00E4 + 'sst sich nicht attestieren') }
    'de:integration.unknown' { return 'unbekannte Integration. erlaubte IDs: %s' }
    'de:integration.usage' { return 'Verwendung: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' }
    'fr:integration.add.broker_not_on' { return ('le broker de messagerie n''est pas allum' + [char]0x00E9) }
    'fr:integration.add.broker_start' { return ('le broker de messagerie ne d' + [char]0x00E9 + 'marre pas') }
    'fr:integration.add.closer_browser' { return 'le navigateur du closer ne se copie pas dans le volume' }
    'fr:integration.add.extras_pull' { return ('le t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement de l''image des outils a ' + [char]0x00E9 + 'chou' + [char]0x00E9) }
    'fr:integration.add.google_failed' { return ('l''installation des biblioth' + [char]0x00E8 + 'ques a ' + [char]0x00E9 + 'chou' + [char]0x00E9) }
    'fr:integration.add.linkedin' { return 'il ne s''ajoute pas : il s''allume avec jht linkedin login' }
    'fr:integration.add.marker' { return ('marqueur non ' + [char]0x00E9 + 'crit') }
    'fr:integration.add.media_not_on' { return ('le conteneur m' + [char]0x00E9 + 'dia n''est pas allum' + [char]0x00E9) }
    'fr:integration.add.media_start' { return ('le conteneur m' + [char]0x00E9 + 'dia ne d' + [char]0x00E9 + 'marre pas') }
    'fr:integration.add.screen_folder' { return 'live-screen dans ~/.jht n''est pas un dossier normal (un lien ?) : je ne l''utilise pas' }
    'fr:integration.add.screen_not_on' { return ('le conteneur de l''' + [char]0x00E9 + 'cran n''est pas allum' + [char]0x00E9) }
    'fr:integration.add.screen_password' { return ('le dossier du mot de passe de l''' + [char]0x00E9 + 'cran n''a pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' cr' + [char]0x00E9 + [char]0x00E9) }
    'fr:integration.add.screen_start' { return ('le conteneur de l''' + [char]0x00E9 + 'cran ne d' + [char]0x00E9 + 'marre pas') }
    'fr:integration.add.telegram_not_on' { return ('le service Telegram n''est pas allum' + [char]0x00E9) }
    'fr:integration.add.telegram_start' { return ('le service Telegram ne d' + [char]0x00E9 + 'marre pas') }
    'fr:integration.change.markers_unsafe' { return ('le dossier des marqueurs n''est pas s' + [char]0x00FB + 'r') }
    'fr:integration.engine_log_written' { return ('' + [char]0x00E9 + 'tat du moteur Podman ' + [char]0x00E9 + 'crit dans %s') }
    'fr:integration.image.engine_keeps' { return ('conteneur supprim' + [char]0x00E9 + ', mais le moteur ne supprime pas l''image des outils%s : quelque chose l''utilise encore') }
    'fr:integration.image.in_use' { return ('l''image des outils%s n''est pas supprim' + [char]0x00E9 + 'e : %s l''utilise encore') }
    'fr:integration.image.removed' { return ('image des outils supprim' + [char]0x00E9 + 'e%s') }
    'fr:integration.image.size' { return ('jusqu''' + [char]0x00E0 + ' %d Mo') }
    'fr:integration.image.stays' { return ('l''image des outils%s reste sur le disque pour le rallumer sans la ret' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charger : pour lib' + [char]0x00E9 + 'rer l''espace, %s') }
    'fr:integration.label.downloading' { return ('t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement en cours') }
    'fr:integration.label.error' { return 'erreur' }
    'fr:integration.label.not_installed' { return ('non install' + [char]0x00E9) }
    'fr:integration.label.ready' { return ('ajout' + [char]0x00E9) }
    'fr:integration.label.running' { return ('allum' + [char]0x00E9) }
    'fr:integration.linkedin.profile_not_plain' { return 'le profil LinkedIn dans ~/.jht n''est pas un dossier normal (un lien ?) : je ne l''utilise pas' }
    'fr:integration.linkedin.token_stdin' { return ('le jeton de la fen' + [char]0x00EA + 'tre vient de l''app, sur l''entr' + [char]0x00E9 + 'e standard') }
    'fr:integration.linkedin.usage' { return 'utilisation : jht linkedin login [--stop] | status --json' }
    'fr:integration.purge_needs_yes' { return ('--purge supprime les donn' + [char]0x00E9 + 'es de l''int' + [char]0x00E9 + 'gration : il faut aussi --yes') }
    'fr:integration.remove.broker_stop' { return ('le broker de messagerie ne s''arr' + [char]0x00EA + 'te pas') }
    'fr:integration.remove.google' { return ('marqu' + [char]0x00E9 + ' comme non ajout' + [char]0x00E9 + ' ; les biblioth' + [char]0x00E8 + 'ques restent dans le profil et n''utilisent aucune ressource') }
    'fr:integration.remove.kept' { return ('conteneur supprim' + [char]0x00E9 + ' ; les donn' + [char]0x00E9 + 'es restent (pour les supprimer : --purge --yes)') }
    'fr:integration.remove.linkedin' { return ('conteneurs supprim' + [char]0x00E9 + 's ; la session LinkedIn du profil reste (jht reset --scope creds la supprime)') }
    'fr:integration.remove.linkedin_stop' { return ('les conteneurs de la connexion ' + [char]0x00E0 + ' LinkedIn ne s''arr' + [char]0x00EA + 'tent pas') }
    'fr:integration.remove.mail_purged' { return ('conteneur et ' + [char]0x00E9 + 'tat du broker supprim' + [char]0x00E9 + 's ; le mot de passe de la messagerie et les identifiants des portails restent dans le volume des secrets (jht reset --scope creds)') }
    'fr:integration.remove.media_purged' { return ('conteneur supprim' + [char]0x00E9 + ' ; les deux dossiers d''' + [char]0x00E9 + 'change avec jht restent (ils appartiennent ' + [char]0x00E0 + ' jht et ne contiennent aucun de tes fichiers)') }
    'fr:integration.remove.media_stop' { return ('le conteneur m' + [char]0x00E9 + 'dia ne s''arr' + [char]0x00EA + 'te pas') }
    'fr:integration.remove.purged' { return ('conteneur et donn' + [char]0x00E9 + 'es supprim' + [char]0x00E9 + 's') }
    'fr:integration.remove.screen_off' { return ('' + [char]0x00E9 + 'cran ' + [char]0x00E9 + 'teint et conteneur supprim' + [char]0x00E9) }
    'fr:integration.remove.screen_purged' { return ('conteneur supprim' + [char]0x00E9 + ' ; le dossier d''affichage partag' + [char]0x00E9 + ' avec jht a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' supprim' + [char]0x00E9) }
    'fr:integration.remove.screen_stop' { return ('le conteneur de l''' + [char]0x00E9 + 'cran ne s''arr' + [char]0x00EA + 'te pas') }
    'fr:integration.remove.telegram_stop' { return ('le service Telegram ne s''arr' + [char]0x00EA + 'te pas') }
    'fr:integration.remove.volume' { return ('un volume ne peut pas ' + [char]0x00EA + 'tre supprim' + [char]0x00E9 + ' : %s') }
    'fr:integration.remove_image_only' { return '--remove-image vaut pour screen et media : ce sont les deux qui utilisent l''image des outils' }
    'fr:integration.state.added_off' { return ('ajout' + [char]0x00E9 + ', conteneur ' + [char]0x00E9 + 'teint') }
    'fr:integration.state.container_on' { return ('conteneur allum' + [char]0x00E9) }
    'fr:integration.state.engine_silent' { return ('le moteur de conteneurs ne r' + [char]0x00E9 + 'pond pas') }
    'fr:integration.state.google_ready' { return ('biblioth' + [char]0x00E8 + 'ques Google ajout' + [char]0x00E9 + 'es au profil ; il manque les identifiants du compte Google') }
    'fr:integration.state.in_progress' { return ('op' + [char]0x00E9 + 'ration en cours') }
    'fr:integration.state.linkedin_how' { return 'il s''allume avec : jht linkedin login' }
    'fr:integration.state.linkedin_running' { return ('connexion ' + [char]0x00E0 + ' LinkedIn en cours') }
    'fr:integration.state.media_off' { return ('ajout' + [char]0x00E9 + ', conteneur ' + [char]0x00E9 + 'teint : jht integration add media le rallume') }
    'fr:integration.state.not_added' { return ('pas encore ajout' + [char]0x00E9) }
    'fr:integration.state.not_yet' { return 'pas encore disponible' }
    'fr:integration.state.screen_asked_off' { return ('demand' + [char]0x00E9 + ' allum' + [char]0x00E9 + ' mais le conteneur est ' + [char]0x00E9 + 'teint : jht screen on le rallume') }
    'fr:integration.state.screen_running' { return ('' + [char]0x00E9 + 'cran allum' + [char]0x00E9 + ', flux en lecture seule sur 127.0.0.1') }
    'fr:integration.state.telegram_no_bot' { return ('service allum' + [char]0x00E9 + ', aucun bot appair' + [char]0x00E9 + ' : jht telegram pair assistente') }
    'fr:integration.state.telegram_off' { return ('ajout' + [char]0x00E9 + ', service ' + [char]0x00E9 + 'teint : jht telegram pair assistente (avec un bot d' + [char]0x00E9 + 'j' + [char]0x00E0 + ' appair' + [char]0x00E9 + ', jht up le rallume)') }
    'fr:integration.state.unattestable' { return ('le conteneur ne peut pas ' + [char]0x00EA + 'tre attest' + [char]0x00E9) }
    'fr:integration.unknown' { return ('int' + [char]0x00E9 + 'gration inconnue. id autoris' + [char]0x00E9 + 's : %s') }
    'fr:integration.usage' { return 'utilisation : jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' }
    'pt:integration.add.broker_not_on' { return ('o broker do correio n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' ligado') }
    'pt:integration.add.broker_start' { return ('o broker do correio n' + [char]0x00E3 + 'o arranca') }
    'pt:integration.add.closer_browser' { return ('o browser do closer n' + [char]0x00E3 + 'o se copia para o volume') }
    'pt:integration.add.extras_pull' { return 'o descarregamento da imagem de ferramentas falhou' }
    'pt:integration.add.google_failed' { return ('a instala' + [char]0x00E7 + [char]0x00E3 + 'o das bibliotecas falhou') }
    'pt:integration.add.linkedin' { return ('n' + [char]0x00E3 + 'o se adiciona: liga-se com jht linkedin login') }
    'pt:integration.add.marker' { return ('marcador n' + [char]0x00E3 + 'o escrito') }
    'pt:integration.add.media_not_on' { return ('o contentor de media n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' ligado') }
    'pt:integration.add.media_start' { return ('o contentor de media n' + [char]0x00E3 + 'o arranca') }
    'pt:integration.add.screen_folder' { return ('live-screen em ~/.jht n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' uma pasta normal (uma liga' + [char]0x00E7 + [char]0x00E3 + 'o?): n' + [char]0x00E3 + 'o a uso') }
    'pt:integration.add.screen_not_on' { return ('o contentor do ecr' + [char]0x00E3 + ' n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' ligado') }
    'pt:integration.add.screen_password' { return ('a pasta da palavra-passe do ecr' + [char]0x00E3 + ' n' + [char]0x00E3 + 'o foi criada') }
    'pt:integration.add.screen_start' { return ('o contentor do ecr' + [char]0x00E3 + ' n' + [char]0x00E3 + 'o arranca') }
    'pt:integration.add.telegram_not_on' { return ('o servi' + [char]0x00E7 + 'o Telegram n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' ligado') }
    'pt:integration.add.telegram_start' { return ('o servi' + [char]0x00E7 + 'o Telegram n' + [char]0x00E3 + 'o arranca') }
    'pt:integration.change.markers_unsafe' { return ('a pasta dos marcadores n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' segura') }
    'pt:integration.engine_log_written' { return 'estado do motor Podman escrito em %s' }
    'pt:integration.image.engine_keeps' { return ('contentor removido, mas o motor n' + [char]0x00E3 + 'o remove a imagem de ferramentas%s: algo ainda a usa') }
    'pt:integration.image.in_use' { return ('a imagem de ferramentas%s n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' removida: %s ainda a usa') }
    'pt:integration.image.removed' { return 'imagem de ferramentas removida%s' }
    'pt:integration.image.size' { return ('at' + [char]0x00E9 + ' %d MB') }
    'pt:integration.image.stays' { return ('a imagem de ferramentas%s fica no disco para voltar a lig' + [char]0x00E1 + '-lo sem a descarregar de novo: para libertar o espa' + [char]0x00E7 + 'o, %s') }
    'pt:integration.label.downloading' { return 'a descarregar' }
    'pt:integration.label.error' { return 'erro' }
    'pt:integration.label.not_installed' { return ('n' + [char]0x00E3 + 'o instalada') }
    'pt:integration.label.ready' { return 'adicionada' }
    'pt:integration.label.running' { return 'ligada' }
    'pt:integration.linkedin.profile_not_plain' { return ('o perfil do LinkedIn em ~/.jht n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' uma pasta normal (uma liga' + [char]0x00E7 + [char]0x00E3 + 'o?): n' + [char]0x00E3 + 'o o uso') }
    'pt:integration.linkedin.token_stdin' { return ('o token da janela vem da app, pela entrada padr' + [char]0x00E3 + 'o') }
    'pt:integration.linkedin.usage' { return ('utiliza' + [char]0x00E7 + [char]0x00E3 + 'o: jht linkedin login [--stop] | status --json') }
    'pt:integration.purge_needs_yes' { return ('--purge apaga os dados da integra' + [char]0x00E7 + [char]0x00E3 + 'o: tamb' + [char]0x00E9 + 'm ' + [char]0x00E9 + ' preciso --yes') }
    'pt:integration.remove.broker_stop' { return ('o broker do correio n' + [char]0x00E3 + 'o para') }
    'pt:integration.remove.google' { return ('marcada como n' + [char]0x00E3 + 'o adicionada; as bibliotecas ficam no perfil e n' + [char]0x00E3 + 'o usam recursos') }
    'pt:integration.remove.kept' { return 'contentor removido; os dados ficam (para os apagar: --purge --yes)' }
    'pt:integration.remove.linkedin' { return ('contentores removidos; a sess' + [char]0x00E3 + 'o do LinkedIn no perfil fica (jht reset --scope creds remove-a)') }
    'pt:integration.remove.linkedin_stop' { return ('os contentores do in' + [char]0x00ED + 'cio de sess' + [char]0x00E3 + 'o no LinkedIn n' + [char]0x00E3 + 'o param') }
    'pt:integration.remove.mail_purged' { return 'contentor e estado do broker apagados; a palavra-passe do correio e as credenciais dos portais ficam no volume dos segredos (jht reset --scope creds)' }
    'pt:integration.remove.media_purged' { return ('contentor removido; as duas pastas de troca com o jht ficam (s' + [char]0x00E3 + 'o do jht e n' + [char]0x00E3 + 'o cont' + [char]0x00EA + 'm nenhum ficheiro teu)') }
    'pt:integration.remove.media_stop' { return ('o contentor de media n' + [char]0x00E3 + 'o para') }
    'pt:integration.remove.purged' { return 'contentor e dados apagados' }
    'pt:integration.remove.screen_off' { return ('ecr' + [char]0x00E3 + ' desligado e contentor removido') }
    'pt:integration.remove.screen_purged' { return 'contentor removido; a pasta do display partilhada com o jht foi apagada' }
    'pt:integration.remove.screen_stop' { return ('o contentor do ecr' + [char]0x00E3 + ' n' + [char]0x00E3 + 'o para') }
    'pt:integration.remove.telegram_stop' { return ('o servi' + [char]0x00E7 + 'o Telegram n' + [char]0x00E3 + 'o para') }
    'pt:integration.remove.volume' { return ('n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel apagar um volume: %s') }
    'pt:integration.remove_image_only' { return ('--remove-image ' + [char]0x00E9 + ' para screen e media: s' + [char]0x00E3 + 'o as duas feitas com a imagem de ferramentas') }
    'pt:integration.state.added_off' { return 'adicionada, contentor desligado' }
    'pt:integration.state.container_on' { return 'contentor ligado' }
    'pt:integration.state.engine_silent' { return ('o motor de contentores n' + [char]0x00E3 + 'o responde') }
    'pt:integration.state.google_ready' { return 'bibliotecas do Google adicionadas ao perfil; faltam as credenciais da conta Google' }
    'pt:integration.state.in_progress' { return ('opera' + [char]0x00E7 + [char]0x00E3 + 'o em curso') }
    'pt:integration.state.linkedin_how' { return 'liga-se com: jht linkedin login' }
    'pt:integration.state.linkedin_running' { return ('in' + [char]0x00ED + 'cio de sess' + [char]0x00E3 + 'o no LinkedIn em curso') }
    'pt:integration.state.media_off' { return ('adicionada, contentor desligado: jht integration add media volta a lig' + [char]0x00E1 + '-lo') }
    'pt:integration.state.not_added' { return ('ainda n' + [char]0x00E3 + 'o adicionada') }
    'pt:integration.state.not_yet' { return ('ainda n' + [char]0x00E3 + 'o dispon' + [char]0x00ED + 'vel') }
    'pt:integration.state.screen_asked_off' { return ('pedido ligado, mas o contentor est' + [char]0x00E1 + ' desligado: jht screen on volta a lig' + [char]0x00E1 + '-lo') }
    'pt:integration.state.screen_running' { return ('ecr' + [char]0x00E3 + ' ligado, transmiss' + [char]0x00E3 + 'o s' + [char]0x00F3 + ' de visualiza' + [char]0x00E7 + [char]0x00E3 + 'o em 127.0.0.1') }
    'pt:integration.state.telegram_no_bot' { return ('servi' + [char]0x00E7 + 'o ligado, nenhum bot emparelhado: jht telegram pair assistente') }
    'pt:integration.state.telegram_off' { return ('adicionada, servi' + [char]0x00E7 + 'o desligado: jht telegram pair assistente (com um bot j' + [char]0x00E1 + ' emparelhado, jht up volta a lig' + [char]0x00E1 + '-lo)') }
    'pt:integration.state.unattestable' { return ('o contentor n' + [char]0x00E3 + 'o pode ser atestado') }
    'pt:integration.unknown' { return ('integra' + [char]0x00E7 + [char]0x00E3 + 'o desconhecida. ids permitidos: %s') }
    'pt:integration.usage' { return ('utiliza' + [char]0x00E7 + [char]0x00E3 + 'o: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]') }
  }
  return $null
}
# <<< texts in the 7 languages

# The error marker holds a sentence of ours, in the language of the run (with its letters: é, ő, ç…), or a command's line that
# Get-IntegrationForeign already made ASCII: only the control characters go, and at most 600 characters are read back.
function Get-IntegrationMarkerText {
  param([string]$Text)
  $clean = -join ($Text.ToCharArray() | Where-Object { [int]$_ -ge 32 -and [int]$_ -ne 127 })
  if ($clean.Length -gt 600) { return $clean.Substring(0, 600) }
  return $clean
}

function Get-IntegrationForeign {
  param([string]$Text)
  $clean = -join ($Text.ToCharArray() | Where-Object { [int]$_ -ge 32 -and [int]$_ -le 126 })
  if ($clean.Length -gt 200) { return $clean.Substring(0, 200) }
  return $clean
}

# ---- Host markers: <id>.pending (pid of the run in progress), <id>.error (one line), google.ok ----
function Get-IntegrationDir { return (Join-Path $RuntimeDir 'integrations') }

# Run from an ELEVATED process, what is made here is owned by the group Administrators, not by the person, and the check of the wrapper
# (Test-ProtectedRuntimeNode, NOT relaxed: it still wants the person as the owner) would refuse the folder of the markers and every marker in it.
# The node is given to the person right after it is made by the one function the wrapper has for it (Set-ProtectedRuntimeNodeOwner: only a
# node of Administrators is taken, a node of anybody else or a link is not). A wrapper that does not have it yet (an older install that gets this
# helper from the release) leaves the node as it is, as this helper did before.
function Set-IntegrationNodeOwner {
  param([string]$Path)
  if (-not (Get-Command Set-ProtectedRuntimeNodeOwner -CommandType Function -ErrorAction SilentlyContinue)) { return $true }
  return (Set-ProtectedRuntimeNodeOwner $Path)
}

function Test-IntegrationDirReady {
  $dir = Get-IntegrationDir
  if (-not (Test-Path -LiteralPath $dir)) {
    try { New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null } catch { return $false }
  }
  if (-not (Set-IntegrationNodeOwner $dir)) { return $false }
  return (Test-ProtectedRuntimeNode $dir -Directory)
}

function Read-IntegrationMarker {
  param([string]$Id, [string]$Kind)
  $file = Join-Path (Get-IntegrationDir) "$Id.$Kind"
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
  if (-not (Test-ProtectedRuntimeNode $file)) { return $null }
  # written as UTF-8 (Write-IntegrationMarker): read as UTF-8, or Windows PowerShell 5.1 reads it as ANSI and breaks its letters
  $line = @(Get-Content -LiteralPath $file -TotalCount 1 -Encoding UTF8 -ErrorAction SilentlyContinue)
  if ($line.Count -eq 0) { return '' }
  return [string]$line[0]
}

function Write-IntegrationMarker {
  param([string]$Id, [string]$Kind, [string]$Text)
  if (-not (Test-IntegrationDirReady)) { return $false }
  try {
    $file = Join-Path (Get-IntegrationDir) "$Id.$Kind"
    Publish-JhtFile -Destination $file -Bytes ([Text.UTF8Encoding]::new($false).GetBytes("$Text`n"))
    # a marker that is not the person's is one Read-IntegrationMarker would not read
    return (Set-IntegrationNodeOwner $file)
  } catch { return $false }
}

function Clear-IntegrationMarker {
  param([string]$Id, [string]$Kind)
  Remove-Item -LiteralPath (Join-Path (Get-IntegrationDir) "$Id.$Kind") -Force -ErrorAction SilentlyContinue
}

# A run in progress leaves its pid; a pid that is not alive (Ctrl-C, closed terminal) is no run.
function Test-IntegrationPending {
  param([string]$Id)
  $text = Read-IntegrationMarker $Id 'pending'
  if (-not $text -or $text -notmatch '^[0-9]+$') { return $false }
  return [bool](Get-Process -Id ([int]$text) -ErrorAction SilentlyContinue)
}

# ---- What the engine says ----
# $true: the volume is among those of the compose project; $false: it is not; $null: the engine did not answer.
function Test-IntegrationVolumePresent {
  param([string]$Volume)
  $project = Get-ComposeProjectName
  if (-not $project) { return $null }
  $ids = @(& { $ErrorActionPreference = 'Continue'; & docker volume ls -q --filter "label=com.docker.compose.project=$project" 2>$null })
  if ($LASTEXITCODE -ne 0) { return $null }
  return (@($ids | ForEach-Object { "$($_)".Trim() }) -contains "${project}_$Volume")
}

# id -> @(service, volume that exists once it has been made)
function Get-IntegrationService {
  param([string]$Id)
  switch -CaseSensitive ($Id) {
    'telegram' { return @($TelegramContainer, 'jht-telegram-state') }
    'mail' { return @($BrokerContainer, 'jht-broker-state') }
  }
  return $null
}

# @(state, reason). The engine is only asked, never started.
function Get-IntegrationState {
  param([string]$Id)
  if ($IntegrationNotYet -ccontains $Id) { return @('not_installed', (Get-IntegrationText 'integration.state.not_yet' 'not available yet')) }
  if (Test-IntegrationPending $Id) { return @('downloading', (Get-IntegrationText 'integration.state.in_progress' 'operation in progress')) }
  if ($Id -ceq 'google') {
    if ($null -ne (Read-IntegrationMarker 'google' 'ok')) { return @('ready', (Get-IntegrationText 'integration.state.google_ready' 'Google libraries added to the profile; the credentials of the Google account are missing')) }
  } elseif ($Id -ceq 'linkedin-login') {
    if (-not (Test-DockerReachable)) { return @('error', (Get-IntegrationText 'integration.state.engine_silent' 'the container engine does not answer')) }
    if (Test-LinkedinAnyRunning) { return @('running', (Get-IntegrationText 'integration.state.linkedin_running' 'LinkedIn sign-in in progress')) }
    return @('not_installed', (Get-IntegrationText 'integration.state.linkedin_how' 'it starts with: jht linkedin login'))
  } elseif ($Id -ceq 'screen') {
    if (-not (Test-DockerReachable)) { return @('error', (Get-IntegrationText 'integration.state.engine_silent' 'the container engine does not answer')) }
    if (Get-RunningComposeServiceId $ScreenContainer) { return @('running', (Get-IntegrationText 'integration.state.screen_running' 'screen on, view-only stream on 127.0.0.1')) }
    if ($script:ServiceLookupReason -notmatch '^(compose ps listed no running container|no running container of)') {
      return @('error', (Get-IntegrationText 'integration.state.unattestable' 'the container cannot be attested'))
    }
    if ($null -ne (Read-IntegrationMarker 'screen' 'ok')) { return @('ready', (Get-IntegrationText 'integration.state.screen_asked_off' 'asked on but the container is off: jht screen on starts it again')) }
  } elseif ($Id -ceq 'media') {
    # The two folders it shares with jht are made by `jht up` whether it is added or not: its own marker says "added".
    if (-not (Test-DockerReachable)) { return @('error', (Get-IntegrationText 'integration.state.engine_silent' 'the container engine does not answer')) }
    if (Get-RunningComposeServiceId $MediaContainer) { return @('running', (Get-IntegrationText 'integration.state.container_on' 'container on')) }
    if ($script:ServiceLookupReason -notmatch '^(compose ps listed no running container|no running container of)') {
      return @('error', (Get-IntegrationText 'integration.state.unattestable' 'the container cannot be attested'))
    }
    if ($null -ne (Read-IntegrationMarker 'media' 'ok')) { return @('ready', (Get-IntegrationText 'integration.state.media_off' 'added, container off: jht integration add media starts it again')) }
  } else {
    $service = Get-IntegrationService $Id
    if (-not (Test-DockerReachable)) { return @('error', (Get-IntegrationText 'integration.state.engine_silent' 'the container engine does not answer')) }
    $running = Get-RunningComposeServiceId $service[0]
    if ($running) {
      # One true state: a Telegram service that is up but holds no bot is not «acceso» for the person, it waits for a token
      # (the same question `jht status` asks). Any answer but a clear «none» keeps what the engine says.
      if ($Id -ceq 'telegram' -and (Get-Command Get-TelegramBotsConfigured -ErrorAction SilentlyContinue)) {
        $configured = Get-TelegramBotsConfigured
        if ($configured -is [bool] -and -not $configured) { return @('ready', (Get-IntegrationText 'integration.state.telegram_no_bot' 'service on, no bot paired: jht telegram pair assistente')) }
      }
      return @('running', (Get-IntegrationText 'integration.state.container_on' 'container on'))
    }
    if ($script:ServiceLookupReason -notmatch '^(compose ps listed no running container|no running container of)') {
      return @('error', (Get-IntegrationText 'integration.state.unattestable' 'the container cannot be attested'))
    }
    $present = Test-IntegrationVolumePresent $service[1]
    if ($null -eq $present) { return @('error', (Get-IntegrationText 'integration.state.engine_silent' 'the container engine does not answer')) }
    if ($present) {
      # The volume says it was added; the container is not there (after a down it is removed). Telegram is started again by a
      # pairing, or by jht up once a bot is paired (the same words as scripts/jht-integration.sh).
      if ($Id -ceq 'telegram') {
        return @('ready', (Get-IntegrationText 'integration.state.telegram_off' 'added, service off: jht telegram pair assistente (with a bot already paired, jht up starts it again)'))
      }
      return @('ready', (Get-IntegrationText 'integration.state.added_off' 'added, container off'))
    }
  }
  $failed = Read-IntegrationMarker $Id 'error'
  if ($failed) { return @('error', (Get-IntegrationMarkerText $failed)) }
  return @('not_installed', (Get-IntegrationText 'integration.state.not_added' 'not added yet'))
}

# ---- Output ----
function Write-IntegrationJson {
  param($Value)
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Value -Compress -Depth 5))
}

function Get-IntegrationRow {
  param([string]$Id)
  $state = Get-IntegrationState $Id
  return [ordered]@{ id = $Id; state = $state[0]; reason = $state[1] }
}

function Write-IntegrationStatus {
  param([string]$Id, [bool]$Json)
  $row = Get-IntegrationRow $Id
  if ($Json) { Write-IntegrationJson $row; return }
  [Console]::Out.WriteLine(('{0,-15} {1,-16} {2}' -f $Id, (Get-IntegrationLabel $row.state), $row.reason))
}

function Write-IntegrationList {
  param([bool]$Json)
  if ($Json) {
    $rows = @(foreach ($id in $IntegrationIds) { Get-IntegrationRow $id })
    Write-IntegrationJson ([ordered]@{ integrations = $rows })
    return
  }
  foreach ($id in $IntegrationIds) { Write-IntegrationStatus $id $false }
}

# `compose stop` and `compose rm -f` of a service that is not there write «No stopped containers» (Podman) to stderr and succeed: in PowerShell
# that is a red error record for something that is not one. Their stderr is dropped here (the reason shown is ours) and the exit code is the answer.
function Invoke-IntegrationComposeQuiet {
  $words = @($args)  # inside the script block below `$args` would be the block's own, empty
  $code = & { $ErrorActionPreference = 'Continue'; Invoke-Compose @words *> $null; $LASTEXITCODE }
  return [int]$code
}

# ---- the engine, when `up` of a tool fails ----
# On Windows the engine is a Podman machine reached through a connection. A first `up` of a tool that failed with «get machine connection URI:
# could not find a matching machine for connection ssh://…» (the next tries worked) left nothing to understand it by. The state is written
# to the runtime log of the desktop (the same file the machine start writes to): the connection this run uses, the connections and the
# machines Podman lists (names, ports and running state only: no identity file, no key), and which variables name a host. The `up` is
# idempotent, so it is tried once more after a few seconds; a second failure says where the state is.
$IntegrationRetryWaitSeconds = 5
# Podman's `compose` finds the machine of a connection by asking the engine of the machine for its state (WSL, on Windows), and WHEN THAT
# QUESTION FAILS IT SAYS «could not find a matching machine» (podman 6.0.2, internal/localapi FindMachineByPort: the error of the state is
# dropped, the loop goes on and ends with that sentence). The question fails while the machine is busy: the first start of a tool copies
# a browser of hundreds of MB into a volume and pulls an image of about 1 GB at the same time, on a machine of 2 CPUs. One more try after 5 s
# is not always enough then, so the steps are tried up to this many times, the wait growing ×3 each time (5 s, 15 s).
$IntegrationEngineTries = 3
# A start of a tool that takes longer than this writes where the time went (pull, copy of the browser, start) to the same log.
$IntegrationSlowSeconds = 60

function Get-IntegrationRuntimeLogPath {
  if ($script:IntegrationRuntimeLogPath) { return [string]$script:IntegrationRuntimeLogPath }
  return (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ai.jobhunterteam.desktop\logs\runtime.log')
}

function Get-IntegrationEngineState {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("connection_used=$($env:CONTAINER_CONNECTION)")
  $lines.Add("host_variables=CONTAINER_HOST:$([bool]$env:CONTAINER_HOST) DOCKER_HOST:$([bool]$env:DOCKER_HOST)")
  # The program itself, never an alias or a function of the person's profile (the wrapper runs with it loaded): found as an application,
  # and called by the name with its extension, which no alias or function of a profile takes.
  $podman = Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $podman) { $lines.Add('podman=not found'); return $lines.ToArray() }
  $queries = @(
    @('connections', @('system', 'connection', 'list', '--format', '{{.Name}} {{.URI}} default={{.Default}}')),
    @('machines', @('machine', 'list', '--format', '{{.Name}} running={{.Running}} starting={{.Starting}} port={{.Port}} lastup={{.LastUp}}'))
  )
  foreach ($query in $queries) {
    $lines.Add("$($query[0]):")
    $podmanArguments = [string[]]$query[1]
    $out = @(& { $ErrorActionPreference = 'Continue'; & podman.exe @podmanArguments 2>&1 })
    $lines.Add("  exit=$LASTEXITCODE")
    $rows = @($out | ForEach-Object { ([string]$_).Trim() })
    # The connections of the person to other hosts are not ours to write down: this runtime's own, and the ones on this computer.
    if ($query[0] -ceq 'connections') { $rows = @($rows | Where-Object { $_.StartsWith("$($env:CONTAINER_CONNECTION) ") -or $_ -match '@(127\.0\.0\.1|localhost)[:/]' }) }
    foreach ($row in @($rows | Select-Object -First 20)) { $lines.Add('  ' + $row.Substring(0, [Math]::Min(300, $row.Length))) }
  }
  return $lines.ToArray()
}

function Write-IntegrationEngineLog {
  param([string]$Tool, [string]$Code, [int]$ExitCode, [string[]]$Lines = @())
  try {
    $path = Get-IntegrationRuntimeLogPath
    $directory = Split-Path -LiteralPath $path
    [void][IO.Directory]::CreateDirectory($directory)
    foreach ($node in @($directory, $path)) {
      if ((Test-Path -LiteralPath $node) -and (((Get-Item -LiteralPath $node -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return }
    }
    $text = "=== $([DateTime]::UtcNow.ToString('o')) integration_engine_${Code}: tool=$Tool exit=$ExitCode`n"
    foreach ($line in $Lines) { $text += "    $line`n" }
    [IO.File]::AppendAllText($path, $text, [Text.UTF8Encoding]::new($false))
  } catch { }
}

# One compose step of a tool (the copy of the browser, the `up`), tried again after a failure when the engine is a Podman machine: the
# steps are idempotent (the copy ends with a marker, the `up` leaves a container that is there and unchanged as it is). Returns the exit code
# of the last try. The state of the engine is written once, at the first failure, while it is still what made it fail.
# Compose's own lines (Container … Creating, Created, Starting, Started: on stderr, which `| Out-Null` let through) stay out of sight when
# the step works and are shown, whole, when it does not (Invoke-ComposeQuiet of the wrapper, as on `jht up` and `jht down`).
function Invoke-IntegrationEngineStep {
  param([string]$Tool, [string[]]$ComposeArguments)
  $code = Invoke-ComposeQuiet @ComposeArguments
  if ($code -eq 0 -or $ContainerRuntime -ne 'podman') { return [int]$code }
  Write-IntegrationEngineLog -Tool $Tool -Code 'failed' -ExitCode $code -Lines (Get-IntegrationEngineState)
  $wait = $IntegrationRetryWaitSeconds
  $tries = 1
  while ($code -ne 0 -and $tries -lt $IntegrationEngineTries) {
    Start-Sleep -Seconds $wait
    $wait = $wait * 3
    $code = Invoke-ComposeQuiet @ComposeArguments
    $tries++
  }
  Write-IntegrationEngineLog -Tool $Tool -Code 'retried' -ExitCode $code -Lines @("tries=$tries")
  if ($code -ne 0) { [Console]::Error.WriteLine((Format-IntegrationText 'integration.engine_log_written' 'state of the Podman engine written to %s' (Get-IntegrationRuntimeLogPath))) }
  return [int]$code
}

# Where the time of a start goes: seconds of each phase, written to the runtime log only when the whole took longer than a minute (a good
# quick start writes nothing). On Windows 11 and 10 the first start has taken from 2 to 6 minutes with nothing on the screen to tell the
# pull of the image from the copy of the browser from the start of the container.
function Start-IntegrationPhases {
  $script:IntegrationPhaseWatch = [Diagnostics.Stopwatch]::StartNew()
  $script:IntegrationPhaseSeconds = [ordered]@{}
  $script:IntegrationPhaseMark = 0
}
function Complete-IntegrationPhase {
  param([string]$Name)
  if (-not $script:IntegrationPhaseWatch) { return }
  $now = [int][Math]::Round($script:IntegrationPhaseWatch.Elapsed.TotalSeconds)
  $script:IntegrationPhaseSeconds[$Name] = $now - $script:IntegrationPhaseMark
  $script:IntegrationPhaseMark = $now
}
function Write-IntegrationPhasesLog {
  param([string]$Tool)
  if (-not $script:IntegrationPhaseWatch -or $ContainerRuntime -ne 'podman') { return }
  $total = [int][Math]::Round($script:IntegrationPhaseWatch.Elapsed.TotalSeconds)
  if ($total -lt $IntegrationSlowSeconds) { return }
  $lines = @("total=${total}s")
  foreach ($name in $script:IntegrationPhaseSeconds.Keys) { $lines += "$name=$($script:IntegrationPhaseSeconds[$name])s" }
  Write-IntegrationEngineLog -Tool $Tool -Code 'slow' -ExitCode 0 -Lines $lines
}

# The result of add/remove, in the form the person asked for.
function Write-IntegrationResult {
  param([string]$Id, [bool]$Json, [int]$Code, [string]$Reason)
  $state = Get-IntegrationState $Id
  $text = $state[1]
  $name = $state[0]
  if ($Code -ne 0) { if ($Code -ne 3) { $name = 'error' }; $text = $Reason }
  # what the run said about itself (the data that stayed, the volume left) is worth more than the state's own line
  if ($Code -eq 0 -and $Reason) { $text = $Reason }
  if ($Json) {
    Write-IntegrationJson ([ordered]@{ id = $Id; ok = ($Code -eq 0); state = $name; reason = $text })
  } elseif ($Code -eq 0) {
    Write-Info "${Id}: $(Get-IntegrationLabel $name) ($text)"
  } else {
    Write-Err "${Id}: $text"
  }
  return $Code
}

# The media container (voice notes and photos): the extras image by the digest this wrapper carries, then the profile of the compose.
$MediaContainer = 'jht-media'
# The live screen of the closer, and the one-shot that copies its browser into a volume (see jht-integration.sh).
$ScreenContainer = 'jht-screen'
$PlaywrightPopulateContainer = 'jht-playwright-populate'

# The reference of the extras image, or '' while the release has none (the digest is checked in its exact shape first).
function Get-IntegrationExtrasRef {
  if ($ExtrasImageDigest -cmatch '^sha256:[0-9a-f]{64}$') { return "ghcr.io/leopu00/jht@$ExtrasImageDigest" }
  return ''
}

# The folder of the viewer password of the live screen, and whether what is there is fit to be mounted: nothing, or a plain folder,
# never a link (a symlink, a junction: anything with a reparse point).
function Get-IntegrationScreenFolder { return (Join-Path $JhtHome 'live-screen') }
function Test-IntegrationScreenFolder {
  $item = Get-Item -LiteralPath (Get-IntegrationScreenFolder) -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $true }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType) { return $false }
  return [bool]$item.PSIsContainer
}

# ---- add ----
function Invoke-IntegrationAdd {
  param([string]$Id)
  $script:IntegrationWhy = ''
  Start-IntegrationPhases
  try { return (Invoke-IntegrationAddStep $Id) } finally { Write-IntegrationPhasesLog $Id }
}

function Invoke-IntegrationAddStep {
  param([string]$Id)
  switch -CaseSensitive ($Id) {
    'google' {
      Ensure-Up
      $out = @(& { $ErrorActionPreference = 'Continue'; & docker exec -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container python3 -c $IntegrationGoogleCode 2>&1 })
      if ($LASTEXITCODE -ne 0) {
        $last = if ($out.Count) { [string]$out[$out.Count - 1] } else { '' }
        $script:IntegrationWhy = Get-IntegrationForeign $last
        if (-not $script:IntegrationWhy) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.google_failed' 'installing the libraries did not work') }
        return 1
      }
      if (-not (Write-IntegrationMarker 'google' 'ok' 'ok')) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.marker' 'marker not written'); return 1 }
    }
    'telegram' {
      if ((Invoke-ComposeQuiet '--profile' 'telegram' 'up' '-d' $TelegramContainer) -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.telegram_start' 'the Telegram service does not start'); return 1 }
      if ((Confirm-TelegramLifecycle 'start') -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.telegram_not_on' 'the Telegram service is not on'); return 1 }
    }
    'media' {
      $ref = Get-IntegrationExtrasRef
      if (-not $ref) { $script:IntegrationWhy = (Get-IntegrationText 'integration.state.not_yet' 'not available yet'); return 3 }
      & { $ErrorActionPreference = 'Continue'; & docker pull $ref *> $null }
      $pullCode = $LASTEXITCODE
      Complete-IntegrationPhase 'pull'
      if ($pullCode -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.extras_pull' 'downloading the tools image did not work'); return 1 }
      $before = $env:JHT_EXTRAS_IMAGE
      try {
        $env:JHT_EXTRAS_IMAGE = $ref
        $code = Invoke-IntegrationEngineStep 'media' @('--profile', 'media', 'up', '-d', $MediaContainer)
        Complete-IntegrationPhase 'up'
      } finally { if ($null -eq $before) { Remove-Item Env:\JHT_EXTRAS_IMAGE -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_IMAGE = $before } }
      if ($code -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.media_start' 'the media container does not start'); return 1 }
      if (-not (Get-RunningComposeServiceId $MediaContainer)) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.media_not_on' 'the media container is not on'); return 1 }
      if (-not (Write-IntegrationMarker 'media' 'ok' 'ok')) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.marker' 'marker not written'); return 1 }
    }
    'linkedin-login' {
      $script:IntegrationWhy = (Get-IntegrationText 'integration.add.linkedin' 'it is not added: it starts with jht linkedin login')
      return 3
    }
    'screen' {
      $ref = Get-IntegrationExtrasRef
      if (-not $ref) { $script:IntegrationWhy = (Get-IntegrationText 'integration.state.not_yet' 'not available yet'); return 3 }
      & { $ErrorActionPreference = 'Continue'; & docker pull $ref *> $null }
      $pullCode = $LASTEXITCODE
      Complete-IntegrationPhase 'pull'
      if ($pullCode -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.extras_pull' 'downloading the tools image did not work'); return 1 }
      # The folder the desktop app reads the viewer password from is made here, by the person: a bind mount of a folder that is not there
      # would be made by the engine, with its own owner.
      # It is mounted writable in the screen container, and the agents write in this folder: a link (a reparse point) in its place would
      # have the engine mount what it points to. A plain folder or the run stops.
      if (-not (Test-IntegrationScreenFolder)) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.screen_folder' 'live-screen in ~/.jht is not a plain folder (a link?): I do not use it'); return 1 }
      if (-not (Test-Path -LiteralPath (Get-IntegrationScreenFolder))) {
        try { New-Item -ItemType Directory -Path (Get-IntegrationScreenFolder) -ErrorAction Stop | Out-Null }
        catch { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.screen_password' 'the folder of the screen password was not made'); return 1 }
      }
      $beforeImage = $env:JHT_EXTRAS_IMAGE; $beforeDigest = $env:JHT_EXTRAS_DIGEST
      try {
        $env:JHT_EXTRAS_IMAGE = $ref
        # The closer's browser with a window comes from the volume the one-shot fills: ready before the screen is.
        $env:JHT_EXTRAS_DIGEST = $ExtrasImageDigest
        $code = Invoke-IntegrationEngineStep 'screen-browser' @('--profile', 'playwright', 'run', '--rm', '--no-deps', '-T', $PlaywrightPopulateContainer)
        Complete-IntegrationPhase 'browser'
        if ($code -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.closer_browser' 'the browser of the closer does not copy into the volume'); return 1 }
        Remove-Item Env:\JHT_EXTRAS_DIGEST -ErrorAction SilentlyContinue
        # Checked again right before the up (the copy above took time): what is left is the instant between this test and the engine's
        # mount, which an agent that wins the race can use; the folder holds nothing but a viewer password.
        if (-not ((Test-IntegrationScreenFolder) -and (Test-Path -LiteralPath (Get-IntegrationScreenFolder) -PathType Container))) {
          $script:IntegrationWhy = (Get-IntegrationText 'integration.add.screen_folder' 'live-screen in ~/.jht is not a plain folder (a link?): I do not use it'); return 1
        }
        $code = Invoke-IntegrationEngineStep 'screen' @('--profile', 'screen', 'up', '-d', $ScreenContainer)
        Complete-IntegrationPhase 'up'
      } finally {
        if ($null -eq $beforeImage) { Remove-Item Env:\JHT_EXTRAS_IMAGE -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_IMAGE = $beforeImage }
        if ($null -eq $beforeDigest) { Remove-Item Env:\JHT_EXTRAS_DIGEST -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_DIGEST = $beforeDigest }
      }
      if ($code -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.screen_start' 'the screen container does not start'); return 1 }
      if (-not (Get-RunningComposeServiceId $ScreenContainer)) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.screen_not_on' 'the screen container is not on'); return 1 }
      if (-not (Write-IntegrationMarker 'screen' 'ok' 'ok')) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.marker' 'marker not written'); return 1 }
    }
    'mail' {
      if ((Ensure-Broker -Quiet 6>$null) -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.broker_start' 'the mail broker does not start'); return 1 }
      if (-not (Get-RunningComposeServiceId $BrokerContainer)) { $script:IntegrationWhy = (Get-IntegrationText 'integration.add.broker_not_on' 'the mail broker is not on'); return 1 }
    }
  }
  return 0
}

# ---- remove ----
# Volumes that belong to one integration only. The ones shared with `jht` (sockets) are never listed, and neither is jht-secrets:
# it holds the credentials of every portal besides the mailbox (jht reset --scope creds is the way to empty it).
function Get-IntegrationVolumes {
  param([string]$Id)
  switch -CaseSensitive ($Id) {
    'telegram' { return @('jht-telegram-secrets', 'jht-telegram-state', 'jht-telegram-inbox') }
    'mail' { return @('jht-broker-state') }
    'screen' { return @('jht-x11') }
    'linkedin-login' { return @('jht-login-vnc', 'jht-login-egress') }
  }
  return @()
}

# An older compose still starts the broker with `jht up`: removing it now would only be undone by the next start.
function Test-IntegrationBrokerOnRequest {
  $inService = $false
  foreach ($line in @(Get-Content -LiteralPath $ComposeFile)) {
    if ($line -ceq "  ${BrokerContainer}:") { $inService = $true; continue }
    if ($inService -and $line -match '^  \S') { return $false }
    if ($inService -and $line -match '^    profiles:') { return $true }
  }
  return $false
}

# The extras image (the browser, the screen, the media tools) stays on the disk when a tool made of it is switched off: it was downloaded when the
# person asked for the tool, and the next `on` finds it instead of downloading it again. It goes with `--remove-image`, or with the uninstall (the
# Podman machine goes with everything in it). What the engine reports as the size of the image is the whole of it, and a part is shared with the
# core image: «fino a». Returns 0 done, 1 when the engine does not take the image away.
function Set-IntegrationExtrasAfterOff {
  param([string]$Tool, [bool]$RemoveImage)
  $ref = Get-IntegrationExtrasRef
  if (-not $ref) { return 0 }
  $lines = @(& { $ErrorActionPreference = 'Continue'; & docker image inspect --format '{{.Size}}' $ref 2>$null })
  if ($LASTEXITCODE -ne 0) { return 0 }   # the image is not there: nothing to say
  $mb = ''
  $bytes = if ($lines.Count) { ([string]$lines[0]).Trim() } else { '' }
  if ($bytes -cmatch '^[0-9]+$') { $mb = ' (' + (Format-IntegrationText 'integration.image.size' 'up to %d MB' ([long][Math]::Floor([double]$bytes / 1000000))) + ')' }
  if ($RemoveImage) {
    $other = ''
    foreach ($candidate in @('linkedin-login', 'media', 'screen')) {
      if ($candidate -ceq $Tool) { continue }
      if ($null -ne (Read-IntegrationMarker $candidate 'ok')) { $other = $candidate; break }
    }
    if ($other) {
      $script:IntegrationWhy = "$($script:IntegrationWhy); " + (Format-IntegrationText 'integration.image.in_use' 'the tools image%s is not removed: %s still uses it' $mb $other)
      return 0
    }
    $null = & { $ErrorActionPreference = 'Continue'; & docker rmi $ref 2>&1 }
    if ($LASTEXITCODE -ne 0) {
      $script:IntegrationWhy = (Format-IntegrationText 'integration.image.engine_keeps' 'container removed, but the engine does not remove the tools image%s: something still uses it' $mb)
      return 1
    }
    $script:IntegrationWhy = "$($script:IntegrationWhy); " + (Format-IntegrationText 'integration.image.removed' 'tools image removed%s' $mb)
    return 0
  }
  $command = if ($Tool -ceq 'screen') { 'jht screen off --remove-image' } else { "jht integration remove $Tool --remove-image" }
  $script:IntegrationWhy = "$($script:IntegrationWhy); " + (Format-IntegrationText 'integration.image.stays' 'the tools image%s stays on the disk to start it again without downloading it: to free the space, %s' $mb $command)
  return 0
}

function Invoke-IntegrationRemove {
  param([string]$Id, [bool]$Purge, [bool]$RemoveImage = $false)
  $script:IntegrationWhy = ''
  switch -CaseSensitive ($Id) {
    'google' {
      Clear-IntegrationMarker 'google' 'ok'
      $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.google' 'marked as not added; the libraries stay in the profile and use no resources')
      return 0
    }
    'telegram' {
      $code = Invoke-IntegrationComposeQuiet '--profile' 'telegram' stop $TelegramContainer
      if ($code -eq 0) { $code = Invoke-IntegrationComposeQuiet '--profile' 'telegram' rm '-f' $TelegramContainer }
      if ($code -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.telegram_stop' 'the Telegram service does not stop'); return 1 }
    }
    'media' {
      $code = Invoke-IntegrationComposeQuiet '--profile' 'media' stop $MediaContainer
      if ($code -eq 0) { $code = Invoke-IntegrationComposeQuiet '--profile' 'media' rm '-f' $MediaContainer }
      if ($code -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.media_stop' 'the media container does not stop'); return 1 }
      Clear-IntegrationMarker 'media' 'ok'
    }
    'linkedin-login' {
      if (-not (Remove-LinkedinContainers)) { $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.linkedin_stop' 'the containers of the LinkedIn sign-in do not stop'); return 1 }
    }
    'screen' {
      $code = Invoke-IntegrationComposeQuiet '--profile' 'screen' stop $ScreenContainer
      if ($code -eq 0) { $code = Invoke-IntegrationComposeQuiet '--profile' 'screen' rm '-f' $ScreenContainer }
      if ($code -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.screen_stop' 'the screen container does not stop'); return 1 }
      Clear-IntegrationMarker 'screen' 'ok'
    }
    'mail' {
      if (-not (Test-IntegrationBrokerOnRequest)) { $script:IntegrationWhy = (Get-IntegrationText 'integration.state.not_yet' 'not available yet'); return 3 }
      $code = Invoke-IntegrationComposeQuiet '--profile' 'broker' stop $BrokerContainer
      if ($code -eq 0) { $code = Invoke-IntegrationComposeQuiet '--profile' 'broker' rm '-f' $BrokerContainer }
      if ($code -ne 0) { $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.broker_stop' 'the mail broker does not stop'); return 1 }
      Remove-Item -LiteralPath $BrokerMadeMarker -Force -ErrorAction SilentlyContinue
    }
  }
  if ($Purge) {
    foreach ($volume in (Get-IntegrationVolumes $Id)) {
      if ((Test-IntegrationVolumePresent $volume) -eq $true) {
        $null = & { $ErrorActionPreference = 'Continue'; & docker volume rm "$(Get-ComposeProjectName)_$volume" 2>&1 }
        if ($LASTEXITCODE -ne 0) { $script:IntegrationWhy = (Format-IntegrationText 'integration.remove.volume' 'a volume cannot be deleted: %s' $volume); return 1 }
      }
    }
    $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.purged' 'container and data deleted')
    if ($Id -ceq 'linkedin-login') { $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.linkedin' 'containers removed; the LinkedIn session in the profile stays (jht reset --scope creds removes it)') }
    if ($Id -ceq 'screen') { $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.screen_purged' 'container removed; the display folder shared with jht was deleted') }
    if ($Id -ceq 'media') { $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.media_purged' 'container removed; the two exchange folders with jht stay (they belong to jht and hold none of your files)') }
    if ($Id -ceq 'mail') { $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.mail_purged' 'container and broker state deleted; the mail password and the credentials of the portals stay in the secrets volume (jht reset --scope creds)') }
  } elseif ($Id -ceq 'screen') {
    $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.screen_off' 'screen off and container removed')
  } elseif ($Id -ceq 'linkedin-login') {
    $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.linkedin' 'containers removed; the LinkedIn session in the profile stays (jht reset --scope creds removes it)')
  } else {
    $script:IntegrationWhy = (Get-IntegrationText 'integration.remove.kept' 'container removed; the data stays (to delete it: --purge --yes)')
  }
  if ($Id -ceq 'screen' -or $Id -ceq 'media') { return (Set-IntegrationExtrasAfterOff $Id $RemoveImage) }
  return 0
}

# add|remove, with the run marked as in progress and the outcome left for the next status.
function Invoke-IntegrationChange {
  param([string]$Action, [string]$Id, [bool]$Json, [bool]$Purge, [bool]$RemoveImage = $false)
  if ($IntegrationNotYet -ccontains $Id) { return (Write-IntegrationResult $Id $Json 3 (Get-IntegrationText 'integration.state.not_yet' 'not available yet')) }
  if (-not (Test-IntegrationDirReady)) { return (Write-IntegrationResult $Id $Json 1 (Get-IntegrationText 'integration.change.markers_unsafe' 'the folder of the markers is not safe')) }
  if (-not (Write-IntegrationMarker $Id 'pending' ([string]$PID))) { return (Write-IntegrationResult $Id $Json 1 (Get-IntegrationText 'integration.add.marker' 'marker not written')) }
  Clear-IntegrationMarker $Id 'error'
  $code = 1
  try {
    # what the steps print (compose, Ensure-Up) must not become part of the code: the code is the LAST thing returned
    if ($Action -ceq 'add') { $done = @(Invoke-IntegrationAdd $Id) } else { $done = @(Invoke-IntegrationRemove $Id $Purge $RemoveImage) }
    $code = [int]$done[$done.Count - 1]
  } catch {
    $script:IntegrationWhy = Get-IntegrationForeign ([string]$_.Exception.Message)
    $code = 1
  } finally {
    Clear-IntegrationMarker $Id 'pending'
  }
  if ($code -ne 0 -and $code -ne 3) { $null = Write-IntegrationMarker $Id 'error' $script:IntegrationWhy }
  return (Write-IntegrationResult $Id $Json $code $script:IntegrationWhy)
}

# ---- Entry point ----
function Write-IntegrationUsage {
  Write-Err (Get-IntegrationText 'integration.usage' 'usage: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]')
  Write-Err ('id: ' + ($IntegrationIds -join ' '))
  return 2
}

# The sentences have the letters of their language (é, ő, ç…): what is written to stdout and stderr goes out as UTF-8 while the command
# runs (the JSON the app reads, a person at a terminal, a pipe), and the console gets back its own encoding after it (it belongs to
# the window, and would stay changed after the command). Windows PowerShell 5.1 writes in the legacy code page otherwise.
# Returns the encoding to give back ($null when the console's could not be read or set).
function Set-IntegrationUtf8Output {
  try { $previous = [Console]::OutputEncoding; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); return $previous } catch { return $null }
}

function Restore-IntegrationOutput {
  param($Previous)
  if ($null -ne $Previous) { try { [Console]::OutputEncoding = $Previous } catch { $null = $_ } }
}

function Invoke-IntegrationCommand {
  param([string[]]$IntegrationArgs)
  $previous = Set-IntegrationUtf8Output
  try { return (Invoke-IntegrationCommandSaid $IntegrationArgs) } finally { Restore-IntegrationOutput $previous }
}

function Invoke-IntegrationCommandSaid {
  param([string[]]$IntegrationArgs)
  $action = if ($IntegrationArgs.Count -gt 0) { [string]$IntegrationArgs[0] } else { '' }
  if (@('list', 'status', 'add', 'remove') -cnotcontains $action) { return (Write-IntegrationUsage) }
  $id = ''
  $json = $false; $purge = $false; $yes = $false; $removeImage = $false
  foreach ($arg in @($IntegrationArgs | Select-Object -Skip 1)) {
    switch -CaseSensitive ([string]$arg) {
      '--json' { $json = $true }
      '--purge' { if ($action -cne 'remove') { return (Write-IntegrationUsage) }; $purge = $true }
      '--yes' { if ($action -cne 'remove') { return (Write-IntegrationUsage) }; $yes = $true }
      '--remove-image' { if ($action -cne 'remove') { return (Write-IntegrationUsage) }; $removeImage = $true }
      default {
        if ([string]$arg -like '-*' -or $id) { return (Write-IntegrationUsage) }
        $id = [string]$arg
      }
    }
  }
  if ($action -ceq 'list' -and $id) { return (Write-IntegrationUsage) }
  if ($action -cne 'list' -and $action -cne 'status' -and -not $id) { return (Write-IntegrationUsage) }
  if ($id -and ($IntegrationIds -cnotcontains $id)) {
    Write-Err (Format-IntegrationText 'integration.unknown' 'unknown integration. allowed ids: %s' ($IntegrationIds -join ' '))
    return 2
  }
  if ($removeImage -and $id -cne 'screen' -and $id -cne 'media') { Write-Err (Get-IntegrationText 'integration.remove_image_only' '--remove-image is for screen and media: they are the two made with the tools image'); return 2 }
  if ($purge -and -not $yes) { Write-Err (Get-IntegrationText 'integration.purge_needs_yes' '--purge deletes the data of the integration: --yes is needed too'); return 2 }
  if ($yes -and -not $purge) { return (Write-IntegrationUsage) }
  switch -CaseSensitive ($action) {
    'list' { Write-IntegrationList $json; return 0 }
    'status' {
      if ($id) { Write-IntegrationStatus $id $json } else { Write-IntegrationList $json }
      return 0
    }
    default {
      if ($IntegrationNotYet -cnotcontains $id) { Require-Docker }
      return (Invoke-IntegrationChange $action $id $json $purge $removeImage)
    }
  }
}


# ---- `jht linkedin login|status` ----
# The manual sign-in to LinkedIn: three containers of the profile `login` (shared/login/). The line the desktop app reads is the one the view
# prints (login_view.py grant); here it is only checked in its exact shape, so nothing else ever reaches the app as a token.
$LoginServices = @('jht-login-proxy', 'jht-login-view', 'jht-login')
$LoginViewContainer = 'jht-login-view'
$LoginBrowserContainer = 'jht-login'
$LinkedinReasons = @('view_busy', 'view_unavailable', 'login_timeout', 'token_expired', 'chromium_sandbox_unavailable', 'token_required')
$LinkedinPollSeconds = 1

function Get-LinkedinProfileDir { return (Join-Path (Join-Path $JhtHome 'secrets') 'linkedin-profile') }

# Nothing, or a plain folder: never a link (a symbolic link, a junction: anything with a reparse point).
function Test-LinkedinPlain {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $true }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType) { return $false }
  return [bool]$item.PSIsContainer
}

# At every step under ~/.jht down to the profile: the folder is mounted writable in the browser container and the agents of the team
# container write under ~/.jht.
function Test-LinkedinProfileOk {
  foreach ($path in @($JhtHome, (Join-Path $JhtHome 'secrets'), (Get-LinkedinProfileDir))) {
    if (-not (Test-LinkedinPlain $path)) { return $false }
  }
  return $true
}

function New-LinkedinProfile {
  if (-not (Test-LinkedinProfileOk)) { return $false }
  try {
    foreach ($path in @($JhtHome, (Join-Path $JhtHome 'secrets'), (Get-LinkedinProfileDir))) {
      if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null }
    }
  } catch { return $false }
  return (Test-LinkedinProfileOk)
}

function Write-LinkedinFail {
  param([string]$Reason)
  [Console]::Out.WriteLine('{"ok": false, "reason": "' + $Reason + '"}')
}

function Test-LinkedinGrantLine {
  param([string]$Line)
  return ($Line -cmatch '^\{"ok": true, "port": 6081, "path": "/websockify", "expires_at": "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", "session": "[0-9a-f]{1,32}"\}\z')
}

# The reason of a failure line of the view, from the closed list, or nothing.
function Get-LinkedinReasonOf {
  param([string]$Line)
  if ($Line -cmatch '^\{"ok": false, "reason": "([a-z_]+)"\}\z' -and ($LinkedinReasons -ccontains $Matches[1])) { return $Matches[1] }
  return ''
}

function Test-LinkedinAnyRunning {
  foreach ($service in $LoginServices) { if (Get-RunningComposeServiceId $service) { return $true } }
  return $false
}

function Remove-LinkedinContainers {
  $ok = $true
  foreach ($service in $LoginServices) {
    if ((Invoke-IntegrationComposeQuiet '--profile' 'login' stop $service) -ne 0) { $ok = $false }
    if ((Invoke-IntegrationComposeQuiet '--profile' 'login' rm '-f' $service) -ne 0) { $ok = $false }
  }
  return $ok
}

# The token of the window is made by whoever opens it (the desktop app) and comes on the standard input, one line of 43 characters of
# base64url; it goes on, the same way, to the view, and no output of this command ever holds it. A terminal (nobody to pipe it) or a
# line that is not a token is `token_required`, before anything else is touched. Returns the token, or '' when there is none.
function Read-LinkedinToken {
  if (-not [Console]::IsInputRedirected) { return '' }
  $line = ''
  try { $line = [string][Console]::In.ReadLine() } catch { return '' }
  if ($line.Length -gt 200) { return '' }
  $line = $line.TrimEnd("`r", "`n")
  if ($line -cmatch '^[A-Za-z0-9_-]{43}\z') { return $line }
  return ''
}

# Asks the view for the grant, with the token of the window on the stdin of `docker exec -i`: without a byte order mark in front of it (a token
# with a BOM is another token: the view would answer `token_required` for good), through the wrapper's Invoke-NativeWithStdin; a wrapper from
# before that function is plain.
function Invoke-LinkedinGrant {
  param([string]$Id, [string]$Token)
  $ask = { & { $ErrorActionPreference = 'Continue'; $Token | & docker exec -i $Id python3 /app/shared/login/login_view.py grant 2>$null } }
  if (Get-Command Invoke-NativeWithStdin -CommandType Function -ErrorAction SilentlyContinue) { return @(Invoke-NativeWithStdin $ask) }
  return @($ask.Invoke())
}

function Invoke-LinkedinLogin {
  $token = Read-LinkedinToken
  if (-not $token) { [Console]::Error.WriteLine((Get-IntegrationText 'integration.linkedin.token_stdin' 'the window token comes from the app, on the standard input')); Write-LinkedinFail 'token_required'; return 1 }
  $plainMessage = (Get-IntegrationText 'integration.linkedin.profile_not_plain' 'the LinkedIn profile in ~/.jht is not a plain folder (a link?): I do not use it')
  if (-not (Test-DockerReachable)) { [Console]::Error.WriteLine((Get-IntegrationText 'integration.state.engine_silent' 'the container engine does not answer')); Write-LinkedinFail 'view_unavailable'; return 1 }
  $ref = Get-IntegrationExtrasRef
  if (-not $ref) { [Console]::Error.WriteLine((Get-IntegrationText 'integration.state.not_yet' 'not available yet')); Write-LinkedinFail 'view_unavailable'; return 1 }
  if (Test-LinkedinAnyRunning) { Write-LinkedinFail 'view_busy'; return 1 }
  $null = Remove-LinkedinContainers   # what an ended session left, stopped
  if (-not (New-LinkedinProfile)) { [Console]::Error.WriteLine($plainMessage); Write-LinkedinFail 'view_unavailable'; return 1 }
  & { $ErrorActionPreference = 'Continue'; & docker pull $ref *> $null }
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine((Get-IntegrationText 'integration.add.extras_pull' 'downloading the tools image did not work')); Write-LinkedinFail 'view_unavailable'; return 1 }
  # Checked again right before the up (the pull took time): what is left is the instant between this test and the mount of the engine.
  if (-not ((Test-LinkedinProfileOk) -and (Test-Path -LiteralPath (Get-LinkedinProfileDir) -PathType Container))) {
    [Console]::Error.WriteLine($plainMessage); Write-LinkedinFail 'view_unavailable'; return 1
  }
  $before = $env:JHT_EXTRAS_IMAGE
  try {
    $env:JHT_EXTRAS_IMAGE = $ref
    $code = Invoke-ComposeQuiet '--profile' 'login' 'up' '-d' @LoginServices
  } finally { if ($null -eq $before) { Remove-Item Env:\JHT_EXTRAS_IMAGE -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_IMAGE = $before } }
  if ($code -ne 0) { $null = Remove-LinkedinContainers; Write-LinkedinFail 'view_unavailable'; return 1 }
  for ($tries = 1; $tries -le 40; $tries++) {
    $id = Get-RunningComposeServiceId $LoginViewContainer
    $line = ''
    if ($id) {
      $out = @(Invoke-LinkedinGrant $id $token)
      if ($out.Count) { $line = [string]$out[$out.Count - 1] }
    }
    if (Test-LinkedinGrantLine $line) { [Console]::Out.WriteLine($line); return 0 }
    $reason = Get-LinkedinReasonOf $line
    if ($reason -and $reason -cne 'view_unavailable') { $null = Remove-LinkedinContainers; Write-LinkedinFail $reason; return 1 }
    # the browser is not ready yet (the token is not used up): ask again, unless the containers are gone
    if ($tries -gt 3 -and -not (Test-LinkedinAnyRunning)) { break }
    if ($LinkedinPollSeconds -gt 0) { Start-Sleep -Seconds $LinkedinPollSeconds }
  }
  $null = Remove-LinkedinContainers
  Write-LinkedinFail 'view_unavailable'
  return 1
}

function Invoke-LinkedinStop {
  if (-not (Remove-LinkedinContainers)) { Write-LinkedinFail 'view_unavailable'; return 1 }
  [Console]::Out.WriteLine('{"ok": true}')
  return 0
}

# How the last session ended, from the exit code the engine keeps of the stopped view.
function Get-LinkedinLastReason {
  $code = @(& { $ErrorActionPreference = 'Continue'; & docker inspect -f '{{.State.ExitCode}}' $LoginViewContainer 2>$null })
  if ($LASTEXITCODE -ne 0 -or -not $code.Count) { return '' }
  switch -CaseSensitive (([string]$code[0]).Trim()) {
    '10' { return 'logged_in' }
    '11' { return 'login_timeout' }
    '12' { return 'token_expired' }
    '13' { return 'stopped' }
  }
  return ''
}

# `jht linkedin status --json` is asked every time the window of the app is looked at, so it must cost nothing: no container is started to read the
# profile. No cookie file in the profile means nobody is signed in, and nothing else is asked; the cookie files as they are (size and time of each) and
# the image make a key, and the answer of the one-shot is kept for that key for $LinkedinStatusTtl seconds (5 minutes: the longest a cookie that ran
# out is still shown as a sign-in); the one-shot runs again only when the key changes or the time is up. The cache is a file of the runtime folder,
# which the containers do not mount, and the answers it can hold are the two words of the closed list.
$LinkedinStatusTtl = 300
function Get-LinkedinStatusCachePath { return (Join-Path $RuntimeDir 'linkedin-status.cache') }

# The cookie files of the profile as the host sees them, one `name=size:ticks;` each; '' when there is no cookie database at all.
function Get-LinkedinCookieStamp {
  $dir = Get-LinkedinProfileDir
  $out = ''; $database = $false
  foreach ($file in @('Default/Network/Cookies', 'Default/Network/Cookies-journal', 'Default/Network/Cookies-wal', 'Default/Cookies', 'Default/Cookies-journal')) {
    $item = Get-Item -LiteralPath (Join-Path $dir $file) -Force -ErrorAction SilentlyContinue
    if ($item -and -not $item.PSIsContainer -and -not (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -and -not $item.LinkType) {
      $out += ('{0}={1}:{2};' -f $file, $item.Length, $item.LastWriteTimeUtc.Ticks)
      if ($file -like '*Cookies') { $database = $true }
    } else {
      $out += ('{0}=-;' -f $file)
    }
  }
  if ($database) { return $out }
  return ''
}

# The word kept for this key when it is younger than the time allowed; '' otherwise.
function Read-LinkedinStatusCache {
  param([string]$Key)
  $path = Get-LinkedinStatusCachePath
  $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if (-not $item -or $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or $item.LinkType) { return '' }
  $line = ''
  try { $line = [string](Get-Content -LiteralPath $path -TotalCount 1 -ErrorAction Stop) } catch { return '' }
  $parts = $line.Split('|')
  if ($parts.Count -ne 3 -or $parts[0] -notmatch '^[0-9]{1,12}$' -or $parts[1] -cne $Key) { return '' }
  $age = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64]$parts[0]
  if ($age -lt 0 -or $age -ge $LinkedinStatusTtl) { return '' }
  if ($parts[2] -ceq 'logged_in' -or $parts[2] -ceq 'login_required') { return $parts[2] }
  return ''
}

function Write-LinkedinStatusCache {
  param([string]$Key, [string]$Word)
  $path = Get-LinkedinStatusCachePath
  $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if ($item -and ((($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or $item.LinkType)) { return }
  $temp = '{0}.{1}' -f $path, [guid]::NewGuid().ToString('N')
  try {
    [IO.File]::WriteAllText($temp, ('{0}|{1}|{2}' -f [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(), $Key, $Word) + "`n")
    Move-Item -LiteralPath $temp -Destination $path -Force -ErrorAction Stop
  } catch { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}

function Invoke-LinkedinStatus {
  if (-not (Test-DockerReachable)) { Write-LinkedinFail 'view_unavailable'; return 1 }
  $view = 'idle'; $last = ''; $linkedin = 'login_required'
  $id = Get-RunningComposeServiceId $LoginViewContainer
  if ($id) {
    $out = @(& { $ErrorActionPreference = 'Continue'; & docker exec $id python3 /app/shared/login/login_view.py status 2>$null })
    $text = if ($out.Count) { [string]$out[$out.Count - 1] } else { '' }
    if ($text -clike '*"view": "waiting"*') { $view = 'waiting' } elseif ($text -clike '*"view": "connected"*') { $view = 'connected' }
  } else {
    $last = Get-LinkedinLastReason
  }
  $ref = Get-IntegrationExtrasRef
  $profile = Get-LinkedinProfileDir
  $stamp = ''
  if ($ref -and (Test-LinkedinProfileOk) -and (Test-Path -LiteralPath $profile -PathType Container)) { $stamp = Get-LinkedinCookieStamp }
  if ($ref -and $stamp) {
    $key = '{0};{1}' -f $ref, $stamp
    $word = Read-LinkedinStatusCache $key
    if (-not $word) {
      & { $ErrorActionPreference = 'Continue'; & docker image inspect $ref *> $null }
      if ($LASTEXITCODE -eq 0) {
        $before = $env:JHT_EXTRAS_IMAGE
        try {
          $env:JHT_EXTRAS_IMAGE = $ref
          $answer = @(Invoke-ComposeAnswer '--profile' 'login' run '--rm' '--no-deps' '-T' '--entrypoint' 'python3' $LoginBrowserContainer '/app/shared/login/login_session.py' 'check' '/linkedin-profile')
        } finally { if ($null -eq $before) { Remove-Item Env:\JHT_EXTRAS_IMAGE -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_IMAGE = $before } }
        $said = if ($answer.Count) { ([string]$answer[$answer.Count - 1]).Trim() } else { '' }
        if ($said -ceq 'logged_in' -or $said -ceq 'login_required') { $word = $said; Write-LinkedinStatusCache $key $word }
      }
    }
    if ($word -ceq 'logged_in') { $linkedin = 'logged_in' }
  }
  if ($last) {
    [Console]::Out.WriteLine(('{{"ok": true, "view": "{0}", "linkedin": "{1}", "last_session": {{"reason": "{2}"}}}}' -f $view, $linkedin, $last))
  } else {
    [Console]::Out.WriteLine(('{{"ok": true, "view": "{0}", "linkedin": "{1}"}}' -f $view, $linkedin))
  }
  return 0
}

function Invoke-LinkedinCommand {
  param([string[]]$LinkedinArgs)
  $previous = Set-IntegrationUtf8Output
  try { return (Invoke-LinkedinCommandSaid $LinkedinArgs) } finally { Restore-IntegrationOutput $previous }
}

function Invoke-LinkedinCommandSaid {
  param([string[]]$LinkedinArgs)
  $joined = (@($LinkedinArgs) -join ' ')
  if ($joined -ceq 'login') { Require-Docker; return (Invoke-LinkedinLogin) }
  if ($joined -ceq 'login --stop') { Require-Docker; return (Invoke-LinkedinStop) }
  if ($joined -ceq 'status --json') { return (Invoke-LinkedinStatus) }
  Write-Err (Get-IntegrationText 'integration.linkedin.usage' 'usage: jht linkedin login [--stop] | status --json')
  return 2
}
