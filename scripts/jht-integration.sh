#!/usr/bin/env bash
# jht-integration.sh — `jht integration list|status|add|remove`: the integrations a person adds AFTER the setup.
#
# Not a program: a library the wrapper loads with `source` once its digest matches the runtime manifest (see
# runtime_helper_load in jht-wrapper.sh). It uses the wrapper's own functions (compose, read_only_service_id, ensure_up).
# JHT_RUNTIME_HELPER=1
#
# What is asked of it, and what it never does:
#   - the id is one of a CLOSED list, checked before anything else; no text of the person ever reaches a shell or an engine
#     argument (every engine command below has fixed words, or a name taken from the tables in this file);
#   - the state is read from the ENGINE (container attested by the wrapper, volumes of the compose project) and from small
#     host-owned markers in $RUNTIME_DIR/integrations, never from a file the container can write;
#   - nothing is turned on by an agent: this is the command the person types (or the button of the app).
#
# States (JSON `state`, the same word in every language; the text in parentheses is what the person reads, in English here and in
# the language chosen at the setup on their screen):
#   not_installed (not installed) | downloading (downloading) | ready (added) | running (on) | error (error),
#   always with a `reason` of one line, in that language too.
# Exit: 0 done · 1 failed · 2 wrong use · 3 not available yet.

INTEGRATION_IDS="google telegram mail linkedin-login screen media"
INTEGRATION_NOT_YET=""

# What the person reads is in the language the wrapper decided (JHT_SAY_LANG: the choice in i18n-prefs.json, then JHT_LANG), in
# the 7 languages of shared/locales: the block below is made from the catalogs (python3 tests/integration_texts.py --write), and a
# test fails when the two differ. itx <key> '<English>' says a text; a key with no text in the language says the English of the call.
# Own names (itx, not ts): this file is sourced into the wrapper, which has its own table. The words of the JSON (`state`, the
# LinkedIn `reason` codes) are never translated: only the sentence for the person is.
itx() {
  integration_text_table "${JHT_SAY_LANG:-${JHT_LANG:-en}}" "$1" || printf '%s' "$2"
}
# itxf <key> '<English with %s/%d>' values...: the same, with the values put in (in the same order in every language).
itxf() {
  local format
  format="$(itx "$1" "$2")"
  shift 2
  # shellcheck disable=SC2059
  printf -- "$format" "$@"
}

# >>> texts in the 7 languages, made from shared/locales by `python3 tests/integration_texts.py --write`: do not edit by hand
integration_text_table() {
  case "$1:$2" in
    en:integration.add.broker_not_on) printf '%s' 'the mail broker is not on' ;;
    en:integration.add.broker_start) printf '%s' 'the mail broker does not start' ;;
    en:integration.add.closer_browser) printf '%s' 'the browser of the closer does not copy into the volume' ;;
    en:integration.add.extras_pull) printf '%s' 'downloading the tools image did not work' ;;
    en:integration.add.google_failed) printf '%s' 'installing the libraries did not work' ;;
    en:integration.add.linkedin) printf '%s' 'it is not added: it starts with jht linkedin login' ;;
    en:integration.add.marker) printf '%s' 'marker not written' ;;
    en:integration.add.media_not_on) printf '%s' 'the media container is not on' ;;
    en:integration.add.media_start) printf '%s' 'the media container does not start' ;;
    en:integration.add.screen_folder) printf '%s' 'live-screen in ~/.jht is not a plain folder (a link?): I do not use it' ;;
    en:integration.add.screen_not_on) printf '%s' 'the screen container is not on' ;;
    en:integration.add.screen_password) printf '%s' 'the folder of the screen password was not made' ;;
    en:integration.add.screen_start) printf '%s' 'the screen container does not start' ;;
    en:integration.add.team_down) printf '%s' 'the container of the team does not start: jht up' ;;
    en:integration.add.telegram_not_on) printf '%s' 'the Telegram service is not on' ;;
    en:integration.add.telegram_start) printf '%s' 'the Telegram service does not start' ;;
    en:integration.change.markers_unsafe) printf '%s' 'the folder of the markers is not safe' ;;
    en:integration.image.engine_keeps) printf '%s' 'container removed, but the engine does not remove the tools image%s: something still uses it' ;;
    en:integration.image.in_use) printf '%s' 'the tools image%s is not removed: %s still uses it' ;;
    en:integration.image.removed) printf '%s' 'tools image removed%s' ;;
    en:integration.image.size) printf '%s' 'up to %d MB' ;;
    en:integration.image.stays) printf '%s' 'the tools image%s stays on the disk to start it again without downloading it: to free the space, %s' ;;
    en:integration.label.downloading) printf '%s' 'downloading' ;;
    en:integration.label.error) printf '%s' 'error' ;;
    en:integration.label.not_installed) printf '%s' 'not installed' ;;
    en:integration.label.ready) printf '%s' 'added' ;;
    en:integration.label.running) printf '%s' 'on' ;;
    en:integration.linkedin.profile_not_plain) printf '%s' 'the LinkedIn profile in ~/.jht is not a plain folder (a link?): I do not use it' ;;
    en:integration.linkedin.seccomp) printf '%s' 'the seccomp profile of the sign-in browser is missing or does not match the attested one: not starting' ;;
    en:integration.linkedin.token_stdin) printf '%s' 'the window token comes from the app, on the standard input' ;;
    en:integration.linkedin.usage) printf '%s' 'usage: jht linkedin login [--stop] | status --json' ;;
    en:integration.purge_needs_yes) printf '%s' '--purge deletes the data of the integration: --yes is needed too' ;;
    en:integration.remove.broker_stop) printf '%s' 'the mail broker does not stop' ;;
    en:integration.remove.google) printf '%s' 'marked as not added; the libraries stay in the profile and use no resources' ;;
    en:integration.remove.kept) printf '%s' 'container removed; the data stays (to delete it: --purge --yes)' ;;
    en:integration.remove.linkedin) printf '%s' 'containers removed; the LinkedIn session in the profile stays (jht reset --scope creds removes it)' ;;
    en:integration.remove.linkedin_stop) printf '%s' 'the containers of the LinkedIn sign-in do not stop' ;;
    en:integration.remove.mail_purged) printf '%s' 'container and broker state deleted; the mail password and the credentials of the portals stay in the secrets volume (jht reset --scope creds)' ;;
    en:integration.remove.media_purged) printf '%s' 'container removed; the two exchange folders with jht stay (they belong to jht and hold none of your files)' ;;
    en:integration.remove.media_stop) printf '%s' 'the media container does not stop' ;;
    en:integration.remove.purged) printf '%s' 'container and data deleted' ;;
    en:integration.remove.screen_off) printf '%s' 'screen off and container removed' ;;
    en:integration.remove.screen_purged) printf '%s' 'container removed; the display folder shared with jht was deleted' ;;
    en:integration.remove.screen_stop) printf '%s' 'the screen container does not stop' ;;
    en:integration.remove.telegram_stop) printf '%s' 'the Telegram service does not stop' ;;
    en:integration.remove.volume) printf '%s' 'a volume cannot be deleted: %s' ;;
    en:integration.remove_image_only) printf '%s' '--remove-image is for screen and media: they are the two made with the tools image' ;;
    en:integration.state.added_off) printf '%s' 'added, container off' ;;
    en:integration.state.container_on) printf '%s' 'container on' ;;
    en:integration.state.engine_silent) printf '%s' 'the container engine does not answer' ;;
    en:integration.state.google_ready) printf '%s' 'Google libraries added to the profile; the credentials of the Google account are missing' ;;
    en:integration.state.in_progress) printf '%s' 'operation in progress' ;;
    en:integration.state.linkedin_how) printf '%s' 'it starts with: jht linkedin login' ;;
    en:integration.state.linkedin_running) printf '%s' 'LinkedIn sign-in in progress' ;;
    en:integration.state.media_off) printf '%s' 'added, container off: jht integration add media starts it again' ;;
    en:integration.state.not_added) printf '%s' 'not added yet' ;;
    en:integration.state.not_yet) printf '%s' 'not available yet' ;;
    en:integration.state.screen_asked_off) printf '%s' 'asked on but the container is off: jht screen on starts it again' ;;
    en:integration.state.screen_running) printf '%s' 'screen on, view-only stream on 127.0.0.1' ;;
    en:integration.state.telegram_no_bot) printf '%s' 'service on, no bot paired: jht telegram pair assistente' ;;
    en:integration.state.telegram_off) printf '%s' 'added, service off: jht telegram pair assistente (with a bot already paired, jht up starts it again)' ;;
    en:integration.state.unattestable) printf '%s' 'the container cannot be attested' ;;
    en:integration.unknown) printf '%s' 'unknown integration. allowed ids: %s' ;;
    en:integration.usage) printf '%s' 'usage: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' ;;
    it:integration.add.broker_not_on) printf '%s' 'il broker della posta non risulta acceso' ;;
    it:integration.add.broker_start) printf '%s' 'il broker della posta non parte' ;;
    it:integration.add.closer_browser) printf '%s' 'il browser del closer non si copia nel volume' ;;
    it:integration.add.extras_pull) printf '%s' 'download dell'\''immagine degli strumenti non riuscito' ;;
    it:integration.add.google_failed) printf '%s' 'installazione delle librerie non riuscita' ;;
    it:integration.add.linkedin) printf '%s' 'non si aggiunge: si accende con jht linkedin login' ;;
    it:integration.add.marker) printf '%s' 'marcatore non scritto' ;;
    it:integration.add.media_not_on) printf '%s' 'il container dei media non risulta acceso' ;;
    it:integration.add.media_start) printf '%s' 'il container dei media non parte' ;;
    it:integration.add.screen_folder) printf '%s' 'live-screen in ~/.jht non e'\'' una cartella normale (un collegamento?): non la uso' ;;
    it:integration.add.screen_not_on) printf '%s' 'il container dello schermo non risulta acceso' ;;
    it:integration.add.screen_password) printf '%s' 'cartella della password dello schermo non creata' ;;
    it:integration.add.screen_start) printf '%s' 'il container dello schermo non parte' ;;
    it:integration.add.team_down) printf '%s' 'il container del team non parte: jht up' ;;
    it:integration.add.telegram_not_on) printf '%s' 'il servizio Telegram non risulta acceso' ;;
    it:integration.add.telegram_start) printf '%s' 'il servizio Telegram non parte' ;;
    it:integration.change.markers_unsafe) printf '%s' 'cartella dei marcatori non sicura' ;;
    it:integration.image.engine_keeps) printf '%s' 'container tolto, ma il motore non toglie l'\''immagine degli strumenti%s: la usa ancora qualcosa' ;;
    it:integration.image.in_use) printf '%s' 'l'\''immagine degli strumenti%s non e'\'' tolta: la usa ancora %s' ;;
    it:integration.image.removed) printf '%s' 'immagine degli strumenti tolta%s' ;;
    it:integration.image.size) printf '%s' 'fino a %d MB' ;;
    it:integration.image.stays) printf '%s' 'l'\''immagine degli strumenti%s resta sul disco per riaccenderlo senza riscaricarla: per liberare lo spazio, %s' ;;
    it:integration.label.downloading) printf '%s' 'in scaricamento' ;;
    it:integration.label.error) printf '%s' 'errore' ;;
    it:integration.label.not_installed) printf '%s' 'non installato' ;;
    it:integration.label.ready) printf '%s' 'aggiunto' ;;
    it:integration.label.running) printf '%s' 'acceso' ;;
    it:integration.linkedin.profile_not_plain) printf '%s' 'il profilo di LinkedIn in ~/.jht non e'\'' una cartella normale (un collegamento?): non lo uso' ;;
    it:integration.linkedin.seccomp) printf '%s' 'il profilo seccomp del browser di accesso non c'\''e'\'' o non coincide con quello attestato: non parto' ;;
    it:integration.linkedin.token_stdin) printf '%s' 'il token della finestra arriva dall'\''app, sullo standard input' ;;
    it:integration.linkedin.usage) printf '%s' 'uso: jht linkedin login [--stop] | status --json' ;;
    it:integration.purge_needs_yes) printf '%s' '--purge cancella i dati dell'\''integrazione: serve anche --yes' ;;
    it:integration.remove.broker_stop) printf '%s' 'il broker della posta non si ferma' ;;
    it:integration.remove.google) printf '%s' 'segnato come non aggiunto; le librerie restano nel profilo e non occupano risorse' ;;
    it:integration.remove.kept) printf '%s' 'container tolto; i dati restano (per cancellarli: --purge --yes)' ;;
    it:integration.remove.linkedin) printf '%s' 'container tolti; la sessione di LinkedIn nel profilo resta (jht reset --scope creds la toglie)' ;;
    it:integration.remove.linkedin_stop) printf '%s' 'i container dell'\''accesso a LinkedIn non si fermano' ;;
    it:integration.remove.mail_purged) printf '%s' 'container e stato del broker cancellati; la password della posta e le credenziali dei portali restano nel volume dei segreti (jht reset --scope creds)' ;;
    it:integration.remove.media_purged) printf '%s' 'container tolto; le due cartelle di scambio con jht restano (sono di jht e non contengono i tuoi file)' ;;
    it:integration.remove.media_stop) printf '%s' 'il container dei media non si ferma' ;;
    it:integration.remove.purged) printf '%s' 'container e dati cancellati' ;;
    it:integration.remove.screen_off) printf '%s' 'schermo spento e container tolto' ;;
    it:integration.remove.screen_purged) printf '%s' 'container tolto; la cartella del display condivisa con jht e'\'' stata cancellata' ;;
    it:integration.remove.screen_stop) printf '%s' 'il container dello schermo non si ferma' ;;
    it:integration.remove.telegram_stop) printf '%s' 'il servizio Telegram non si ferma' ;;
    it:integration.remove.volume) printf '%s' 'un volume non si cancella: %s' ;;
    it:integration.remove_image_only) printf '%s' '--remove-image vale per screen e media: sono i due che si fanno con l'\''immagine degli strumenti' ;;
    it:integration.state.added_off) printf '%s' 'aggiunto, container spento' ;;
    it:integration.state.container_on) printf '%s' 'container acceso' ;;
    it:integration.state.engine_silent) printf '%s' 'il motore dei container non risponde' ;;
    it:integration.state.google_ready) printf '%s' 'librerie di Google aggiunte al profilo; mancano le credenziali dell'\''account Google' ;;
    it:integration.state.in_progress) printf '%s' 'operazione in corso' ;;
    it:integration.state.linkedin_how) printf '%s' 'si accende con: jht linkedin login' ;;
    it:integration.state.linkedin_running) printf '%s' 'accesso a LinkedIn in corso' ;;
    it:integration.state.media_off) printf '%s' 'aggiunto, container spento: jht integration add media lo riaccende' ;;
    it:integration.state.not_added) printf '%s' 'non ancora aggiunto' ;;
    it:integration.state.not_yet) printf '%s' 'non disponibile ancora' ;;
    it:integration.state.screen_asked_off) printf '%s' 'chiesto acceso ma il container e'\'' spento: jht screen on lo riaccende' ;;
    it:integration.state.screen_running) printf '%s' 'schermo acceso, stream in sola vista su 127.0.0.1' ;;
    it:integration.state.telegram_no_bot) printf '%s' 'servizio acceso, nessun bot abbinato: jht telegram pair assistente' ;;
    it:integration.state.telegram_off) printf '%s' 'aggiunto, servizio spento: jht telegram pair assistente (con un bot gia'\'' abbinato lo riaccende jht up)' ;;
    it:integration.state.unattestable) printf '%s' 'il container non e'\'' attestabile' ;;
    it:integration.unknown) printf '%s' 'integrazione sconosciuta. id ammessi: %s' ;;
    it:integration.usage) printf '%s' 'uso: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' ;;
    hu:integration.add.broker_not_on) printf '%s' 'a levelezési broker nincs bekapcsolva' ;;
    hu:integration.add.broker_start) printf '%s' 'a levelezési broker nem indul' ;;
    hu:integration.add.closer_browser) printf '%s' 'a closer böngészője nem másolódik át a kötetbe' ;;
    hu:integration.add.extras_pull) printf '%s' 'az eszközkép letöltése nem sikerült' ;;
    hu:integration.add.google_failed) printf '%s' 'a könyvtárak telepítése nem sikerült' ;;
    hu:integration.add.linkedin) printf '%s' 'nem adható hozzá: a jht linkedin login indítja' ;;
    hu:integration.add.marker) printf '%s' 'a jelölő nem íródott ki' ;;
    hu:integration.add.media_not_on) printf '%s' 'a média-konténer nincs bekapcsolva' ;;
    hu:integration.add.media_start) printf '%s' 'a média-konténer nem indul' ;;
    hu:integration.add.screen_folder) printf '%s' 'a live-screen a ~/.jht mappában nem sima mappa (hivatkozás?): nem használom' ;;
    hu:integration.add.screen_not_on) printf '%s' 'a képernyő-konténer nincs bekapcsolva' ;;
    hu:integration.add.screen_password) printf '%s' 'a képernyő jelszavának mappája nem jött létre' ;;
    hu:integration.add.screen_start) printf '%s' 'a képernyő-konténer nem indul' ;;
    hu:integration.add.team_down) printf '%s' 'a csapat konténere nem indul: jht up' ;;
    hu:integration.add.telegram_not_on) printf '%s' 'a Telegram-szolgáltatás nincs bekapcsolva' ;;
    hu:integration.add.telegram_start) printf '%s' 'a Telegram-szolgáltatás nem indul' ;;
    hu:integration.change.markers_unsafe) printf '%s' 'a jelölők mappája nem biztonságos' ;;
    hu:integration.image.engine_keeps) printf '%s' 'a konténer törölve, de a motor nem törli az eszközképet%s: még használja valami' ;;
    hu:integration.image.in_use) printf '%s' 'az eszközkép%s nem törlődik: még használja: %s' ;;
    hu:integration.image.removed) printf '%s' 'eszközkép törölve%s' ;;
    hu:integration.image.size) printf '%s' 'legfeljebb %d MB' ;;
    hu:integration.image.stays) printf '%s' 'az eszközkép%s a lemezen marad, hogy letöltés nélkül újraindíthasd: a hely felszabadításához: %s' ;;
    hu:integration.label.downloading) printf '%s' 'letöltés folyamatban' ;;
    hu:integration.label.error) printf '%s' 'hiba' ;;
    hu:integration.label.not_installed) printf '%s' 'nincs telepítve' ;;
    hu:integration.label.ready) printf '%s' 'hozzáadva' ;;
    hu:integration.label.running) printf '%s' 'bekapcsolva' ;;
    hu:integration.linkedin.profile_not_plain) printf '%s' 'a LinkedIn-profil a ~/.jht mappában nem sima mappa (hivatkozás?): nem használom' ;;
    hu:integration.linkedin.seccomp) printf '%s' 'a bejelentkezési böngésző seccomp-profilja hiányzik, vagy nem egyezik a hitelesítettel: nem indulok' ;;
    hu:integration.linkedin.token_stdin) printf '%s' 'az ablak tokenje az alkalmazástól érkezik, a szabványos bemeneten' ;;
    hu:integration.linkedin.usage) printf '%s' 'használat: jht linkedin login [--stop] | status --json' ;;
    hu:integration.purge_needs_yes) printf '%s' 'a --purge törli az integráció adatait: a --yes is kell' ;;
    hu:integration.remove.broker_stop) printf '%s' 'a levelezési broker nem áll le' ;;
    hu:integration.remove.google) printf '%s' 'nem hozzáadottként jelölve; a könyvtárak a profilban maradnak, és nem foglalnak erőforrást' ;;
    hu:integration.remove.kept) printf '%s' 'a konténer törölve; az adatok megmaradnak (törlésükhöz: --purge --yes)' ;;
    hu:integration.remove.linkedin) printf '%s' 'a konténerek törölve; a profilban lévő LinkedIn-munkamenet megmarad (a jht reset --scope creds törli)' ;;
    hu:integration.remove.linkedin_stop) printf '%s' 'a LinkedIn-bejelentkezés konténerei nem állnak le' ;;
    hu:integration.remove.mail_purged) printf '%s' 'a konténer és a broker állapota törölve; a levelezési jelszó és a portálok hitelesítő adatai a titkok kötetében maradnak (jht reset --scope creds)' ;;
    hu:integration.remove.media_purged) printf '%s' 'a konténer törölve; a jht-vel közös két cseremappa megmarad (a jht-é, és egyetlen fájlodat sem tartalmazzák)' ;;
    hu:integration.remove.media_stop) printf '%s' 'a média-konténer nem áll le' ;;
    hu:integration.remove.purged) printf '%s' 'a konténer és az adatok törölve' ;;
    hu:integration.remove.screen_off) printf '%s' 'a képernyő kikapcsolva, a konténer törölve' ;;
    hu:integration.remove.screen_purged) printf '%s' 'a konténer törölve; a jht-vel megosztott kijelzőmappa törölve' ;;
    hu:integration.remove.screen_stop) printf '%s' 'a képernyő-konténer nem áll le' ;;
    hu:integration.remove.telegram_stop) printf '%s' 'a Telegram-szolgáltatás nem áll le' ;;
    hu:integration.remove.volume) printf '%s' 'egy kötet nem törölhető: %s' ;;
    hu:integration.remove_image_only) printf '%s' 'a --remove-image a screen és a media integrációra vonatkozik: ez a kettő készül az eszközképből' ;;
    hu:integration.state.added_off) printf '%s' 'hozzáadva, a konténer ki van kapcsolva' ;;
    hu:integration.state.container_on) printf '%s' 'konténer bekapcsolva' ;;
    hu:integration.state.engine_silent) printf '%s' 'a konténermotor nem válaszol' ;;
    hu:integration.state.google_ready) printf '%s' 'a Google-könyvtárak hozzáadva a profilhoz; hiányoznak a Google-fiók hitelesítő adatai' ;;
    hu:integration.state.in_progress) printf '%s' 'művelet folyamatban' ;;
    hu:integration.state.linkedin_how) printf '%s' 'így indul: jht linkedin login' ;;
    hu:integration.state.linkedin_running) printf '%s' 'LinkedIn-bejelentkezés folyamatban' ;;
    hu:integration.state.media_off) printf '%s' 'hozzáadva, a konténer ki van kapcsolva: a jht integration add media újraindítja' ;;
    hu:integration.state.not_added) printf '%s' 'még nincs hozzáadva' ;;
    hu:integration.state.not_yet) printf '%s' 'még nem érhető el' ;;
    hu:integration.state.screen_asked_off) printf '%s' 'bekapcsolást kértél, de a konténer ki van kapcsolva: a jht screen on újraindítja' ;;
    hu:integration.state.screen_running) printf '%s' 'a képernyő bekapcsolva, csak megtekintésre szolgáló stream a 127.0.0.1 címen' ;;
    hu:integration.state.telegram_no_bot) printf '%s' 'a szolgáltatás bekapcsolva, nincs párosított bot: jht telegram pair assistente' ;;
    hu:integration.state.telegram_off) printf '%s' 'hozzáadva, a szolgáltatás ki van kapcsolva: jht telegram pair assistente (ha már van párosított bot, a jht up újraindítja)' ;;
    hu:integration.state.unattestable) printf '%s' 'a konténer nem hitelesíthető' ;;
    hu:integration.unknown) printf '%s' 'ismeretlen integráció. engedélyezett azonosítók: %s' ;;
    hu:integration.usage) printf '%s' 'használat: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' ;;
    es:integration.add.broker_not_on) printf '%s' 'el broker del correo no está encendido' ;;
    es:integration.add.broker_start) printf '%s' 'el broker del correo no arranca' ;;
    es:integration.add.closer_browser) printf '%s' 'el navegador del closer no se copia en el volumen' ;;
    es:integration.add.extras_pull) printf '%s' 'la descarga de la imagen de herramientas no ha funcionado' ;;
    es:integration.add.google_failed) printf '%s' 'la instalación de las bibliotecas no ha funcionado' ;;
    es:integration.add.linkedin) printf '%s' 'no se añade: se enciende con jht linkedin login' ;;
    es:integration.add.marker) printf '%s' 'marcador no escrito' ;;
    es:integration.add.media_not_on) printf '%s' 'el contenedor de media no está encendido' ;;
    es:integration.add.media_start) printf '%s' 'el contenedor de media no arranca' ;;
    es:integration.add.screen_folder) printf '%s' 'live-screen en ~/.jht no es una carpeta normal (¿un enlace?): no la uso' ;;
    es:integration.add.screen_not_on) printf '%s' 'el contenedor de la pantalla no está encendido' ;;
    es:integration.add.screen_password) printf '%s' 'no se ha creado la carpeta de la contraseña de la pantalla' ;;
    es:integration.add.screen_start) printf '%s' 'el contenedor de la pantalla no arranca' ;;
    es:integration.add.team_down) printf '%s' 'el contenedor del equipo no arranca: jht up' ;;
    es:integration.add.telegram_not_on) printf '%s' 'el servicio de Telegram no está encendido' ;;
    es:integration.add.telegram_start) printf '%s' 'el servicio de Telegram no arranca' ;;
    es:integration.change.markers_unsafe) printf '%s' 'la carpeta de los marcadores no es segura' ;;
    es:integration.image.engine_keeps) printf '%s' 'contenedor quitado, pero el motor no quita la imagen de herramientas%s: algo aún la usa' ;;
    es:integration.image.in_use) printf '%s' 'la imagen de herramientas%s no se quita: aún la usa %s' ;;
    es:integration.image.removed) printf '%s' 'imagen de herramientas quitada%s' ;;
    es:integration.image.size) printf '%s' 'hasta %d MB' ;;
    es:integration.image.stays) printf '%s' 'la imagen de herramientas%s se queda en el disco para volver a encenderlo sin descargarla otra vez: para liberar el espacio, %s' ;;
    es:integration.label.downloading) printf '%s' 'descargando' ;;
    es:integration.label.error) printf '%s' 'error' ;;
    es:integration.label.not_installed) printf '%s' 'no instalado' ;;
    es:integration.label.ready) printf '%s' 'añadido' ;;
    es:integration.label.running) printf '%s' 'encendido' ;;
    es:integration.linkedin.profile_not_plain) printf '%s' 'el perfil de LinkedIn en ~/.jht no es una carpeta normal (¿un enlace?): no lo uso' ;;
    es:integration.linkedin.seccomp) printf '%s' 'el perfil seccomp del navegador de inicio de sesión falta o no coincide con el atestado: no arranco' ;;
    es:integration.linkedin.token_stdin) printf '%s' 'el token de la ventana llega de la app, por la entrada estándar' ;;
    es:integration.linkedin.usage) printf '%s' 'uso: jht linkedin login [--stop] | status --json' ;;
    es:integration.purge_needs_yes) printf '%s' '--purge borra los datos de la integración: también hace falta --yes' ;;
    es:integration.remove.broker_stop) printf '%s' 'el broker del correo no se detiene' ;;
    es:integration.remove.google) printf '%s' 'marcado como no añadido; las bibliotecas se quedan en el perfil y no consumen recursos' ;;
    es:integration.remove.kept) printf '%s' 'contenedor quitado; los datos se quedan (para borrarlos: --purge --yes)' ;;
    es:integration.remove.linkedin) printf '%s' 'contenedores quitados; la sesión de LinkedIn en el perfil se queda (jht reset --scope creds la quita)' ;;
    es:integration.remove.linkedin_stop) printf '%s' 'los contenedores del inicio de sesión en LinkedIn no se detienen' ;;
    es:integration.remove.mail_purged) printf '%s' 'contenedor y estado del broker borrados; la contraseña del correo y las credenciales de los portales se quedan en el volumen de secretos (jht reset --scope creds)' ;;
    es:integration.remove.media_purged) printf '%s' 'contenedor quitado; las dos carpetas de intercambio con jht se quedan (son de jht y no contienen ninguno de tus archivos)' ;;
    es:integration.remove.media_stop) printf '%s' 'el contenedor de media no se detiene' ;;
    es:integration.remove.purged) printf '%s' 'contenedor y datos borrados' ;;
    es:integration.remove.screen_off) printf '%s' 'pantalla apagada y contenedor quitado' ;;
    es:integration.remove.screen_purged) printf '%s' 'contenedor quitado; se ha borrado la carpeta del display compartida con jht' ;;
    es:integration.remove.screen_stop) printf '%s' 'el contenedor de la pantalla no se detiene' ;;
    es:integration.remove.telegram_stop) printf '%s' 'el servicio de Telegram no se detiene' ;;
    es:integration.remove.volume) printf '%s' 'no se puede borrar un volumen: %s' ;;
    es:integration.remove_image_only) printf '%s' '--remove-image vale para screen y media: son las dos que se hacen con la imagen de herramientas' ;;
    es:integration.state.added_off) printf '%s' 'añadido, contenedor apagado' ;;
    es:integration.state.container_on) printf '%s' 'contenedor encendido' ;;
    es:integration.state.engine_silent) printf '%s' 'el motor de contenedores no responde' ;;
    es:integration.state.google_ready) printf '%s' 'bibliotecas de Google añadidas al perfil; faltan las credenciales de la cuenta de Google' ;;
    es:integration.state.in_progress) printf '%s' 'operación en curso' ;;
    es:integration.state.linkedin_how) printf '%s' 'se enciende con: jht linkedin login' ;;
    es:integration.state.linkedin_running) printf '%s' 'inicio de sesión en LinkedIn en curso' ;;
    es:integration.state.media_off) printf '%s' 'añadido, contenedor apagado: jht integration add media lo vuelve a encender' ;;
    es:integration.state.not_added) printf '%s' 'aún no añadido' ;;
    es:integration.state.not_yet) printf '%s' 'aún no disponible' ;;
    es:integration.state.screen_asked_off) printf '%s' 'pedido encendido pero el contenedor está apagado: jht screen on lo vuelve a encender' ;;
    es:integration.state.screen_running) printf '%s' 'pantalla encendida, stream de solo lectura en 127.0.0.1' ;;
    es:integration.state.telegram_no_bot) printf '%s' 'servicio encendido, ningún bot emparejado: jht telegram pair assistente' ;;
    es:integration.state.telegram_off) printf '%s' 'añadido, servicio apagado: jht telegram pair assistente (con un bot ya emparejado, jht up lo vuelve a encender)' ;;
    es:integration.state.unattestable) printf '%s' 'el contenedor no se puede atestar' ;;
    es:integration.unknown) printf '%s' 'integración desconocida. ids admitidos: %s' ;;
    es:integration.usage) printf '%s' 'uso: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' ;;
    de:integration.add.broker_not_on) printf '%s' 'der Mail-Broker ist nicht an' ;;
    de:integration.add.broker_start) printf '%s' 'der Mail-Broker startet nicht' ;;
    de:integration.add.closer_browser) printf '%s' 'der Browser des closer lässt sich nicht in das Volume kopieren' ;;
    de:integration.add.extras_pull) printf '%s' 'der Download des Werkzeug-Images hat nicht geklappt' ;;
    de:integration.add.google_failed) printf '%s' 'die Installation der Bibliotheken hat nicht geklappt' ;;
    de:integration.add.linkedin) printf '%s' 'wird nicht hinzugefügt: Start mit jht linkedin login' ;;
    de:integration.add.marker) printf '%s' 'Markierung nicht geschrieben' ;;
    de:integration.add.media_not_on) printf '%s' 'der Medien-Container ist nicht an' ;;
    de:integration.add.media_start) printf '%s' 'der Medien-Container startet nicht' ;;
    de:integration.add.screen_folder) printf '%s' 'live-screen in ~/.jht ist kein normaler Ordner (ein Link?): ich verwende ihn nicht' ;;
    de:integration.add.screen_not_on) printf '%s' 'der Bildschirm-Container ist nicht an' ;;
    de:integration.add.screen_password) printf '%s' 'der Ordner für das Bildschirm-Passwort wurde nicht angelegt' ;;
    de:integration.add.screen_start) printf '%s' 'der Bildschirm-Container startet nicht' ;;
    de:integration.add.team_down) printf '%s' 'der Container des Teams startet nicht: jht up' ;;
    de:integration.add.telegram_not_on) printf '%s' 'der Telegram-Dienst ist nicht an' ;;
    de:integration.add.telegram_start) printf '%s' 'der Telegram-Dienst startet nicht' ;;
    de:integration.change.markers_unsafe) printf '%s' 'der Ordner der Markierungen ist nicht sicher' ;;
    de:integration.image.engine_keeps) printf '%s' 'Container entfernt, aber die Engine entfernt das Werkzeug-Image%s nicht: etwas verwendet es noch' ;;
    de:integration.image.in_use) printf '%s' 'das Werkzeug-Image%s wird nicht entfernt: %s verwendet es noch' ;;
    de:integration.image.removed) printf '%s' 'Werkzeug-Image entfernt%s' ;;
    de:integration.image.size) printf '%s' 'bis zu %d MB' ;;
    de:integration.image.stays) printf '%s' 'das Werkzeug-Image%s bleibt auf der Festplatte, damit du ohne erneuten Download wieder starten kannst: um den Platz freizugeben, %s' ;;
    de:integration.label.downloading) printf '%s' 'wird heruntergeladen' ;;
    de:integration.label.error) printf '%s' 'Fehler' ;;
    de:integration.label.not_installed) printf '%s' 'nicht installiert' ;;
    de:integration.label.ready) printf '%s' 'hinzugefügt' ;;
    de:integration.label.running) printf '%s' 'an' ;;
    de:integration.linkedin.profile_not_plain) printf '%s' 'das LinkedIn-Profil in ~/.jht ist kein normaler Ordner (ein Link?): ich verwende es nicht' ;;
    de:integration.linkedin.seccomp) printf '%s' 'das seccomp-Profil des Anmelde-Browsers fehlt oder stimmt nicht mit dem attestierten überein: ich starte nicht' ;;
    de:integration.linkedin.token_stdin) printf '%s' 'das Fenster-Token kommt von der App, über die Standardeingabe' ;;
    de:integration.linkedin.usage) printf '%s' 'Verwendung: jht linkedin login [--stop] | status --json' ;;
    de:integration.purge_needs_yes) printf '%s' '--purge löscht die Daten der Integration: --yes ist auch nötig' ;;
    de:integration.remove.broker_stop) printf '%s' 'der Mail-Broker stoppt nicht' ;;
    de:integration.remove.google) printf '%s' 'als nicht hinzugefügt markiert; die Bibliotheken bleiben im Profil und verbrauchen keine Ressourcen' ;;
    de:integration.remove.kept) printf '%s' 'Container entfernt; die Daten bleiben (zum Löschen: --purge --yes)' ;;
    de:integration.remove.linkedin) printf '%s' 'Container entfernt; die LinkedIn-Sitzung im Profil bleibt (jht reset --scope creds entfernt sie)' ;;
    de:integration.remove.linkedin_stop) printf '%s' 'die Container der LinkedIn-Anmeldung stoppen nicht' ;;
    de:integration.remove.mail_purged) printf '%s' 'Container und Zustand des Brokers gelöscht; das Mail-Passwort und die Zugangsdaten der Portale bleiben im Secrets-Volume (jht reset --scope creds)' ;;
    de:integration.remove.media_purged) printf '%s' 'Container entfernt; die zwei Austauschordner mit jht bleiben (sie gehören jht und enthalten keine deiner Dateien)' ;;
    de:integration.remove.media_stop) printf '%s' 'der Medien-Container stoppt nicht' ;;
    de:integration.remove.purged) printf '%s' 'Container und Daten gelöscht' ;;
    de:integration.remove.screen_off) printf '%s' 'Bildschirm aus und Container entfernt' ;;
    de:integration.remove.screen_purged) printf '%s' 'Container entfernt; der mit jht geteilte Display-Ordner wurde gelöscht' ;;
    de:integration.remove.screen_stop) printf '%s' 'der Bildschirm-Container stoppt nicht' ;;
    de:integration.remove.telegram_stop) printf '%s' 'der Telegram-Dienst stoppt nicht' ;;
    de:integration.remove.volume) printf '%s' 'ein Volume lässt sich nicht löschen: %s' ;;
    de:integration.remove_image_only) printf '%s' '--remove-image gilt für screen und media: das sind die zwei, die mit dem Werkzeug-Image laufen' ;;
    de:integration.state.added_off) printf '%s' 'hinzugefügt, Container aus' ;;
    de:integration.state.container_on) printf '%s' 'Container an' ;;
    de:integration.state.engine_silent) printf '%s' 'die Container-Engine antwortet nicht' ;;
    de:integration.state.google_ready) printf '%s' 'Google-Bibliotheken zum Profil hinzugefügt; die Zugangsdaten des Google-Kontos fehlen' ;;
    de:integration.state.in_progress) printf '%s' 'Vorgang läuft' ;;
    de:integration.state.linkedin_how) printf '%s' 'Start mit: jht linkedin login' ;;
    de:integration.state.linkedin_running) printf '%s' 'Anmeldung bei LinkedIn läuft' ;;
    de:integration.state.media_off) printf '%s' 'hinzugefügt, Container aus: jht integration add media startet ihn wieder' ;;
    de:integration.state.not_added) printf '%s' 'noch nicht hinzugefügt' ;;
    de:integration.state.not_yet) printf '%s' 'noch nicht verfügbar' ;;
    de:integration.state.screen_asked_off) printf '%s' 'an angefordert, aber der Container ist aus: jht screen on startet ihn wieder' ;;
    de:integration.state.screen_running) printf '%s' 'Bildschirm an, Stream nur zum Ansehen auf 127.0.0.1' ;;
    de:integration.state.telegram_no_bot) printf '%s' 'Dienst an, kein Bot gekoppelt: jht telegram pair assistente' ;;
    de:integration.state.telegram_off) printf '%s' 'hinzugefügt, Dienst aus: jht telegram pair assistente (mit einem schon gekoppelten Bot startet ihn jht up wieder)' ;;
    de:integration.state.unattestable) printf '%s' 'der Container lässt sich nicht attestieren' ;;
    de:integration.unknown) printf '%s' 'unbekannte Integration. erlaubte IDs: %s' ;;
    de:integration.usage) printf '%s' 'Verwendung: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' ;;
    fr:integration.add.broker_not_on) printf '%s' 'le broker de messagerie n'\''est pas allumé' ;;
    fr:integration.add.broker_start) printf '%s' 'le broker de messagerie ne démarre pas' ;;
    fr:integration.add.closer_browser) printf '%s' 'le navigateur du closer ne se copie pas dans le volume' ;;
    fr:integration.add.extras_pull) printf '%s' 'le téléchargement de l'\''image des outils a échoué' ;;
    fr:integration.add.google_failed) printf '%s' 'l'\''installation des bibliothèques a échoué' ;;
    fr:integration.add.linkedin) printf '%s' 'il ne s'\''ajoute pas : il s'\''allume avec jht linkedin login' ;;
    fr:integration.add.marker) printf '%s' 'marqueur non écrit' ;;
    fr:integration.add.media_not_on) printf '%s' 'le conteneur média n'\''est pas allumé' ;;
    fr:integration.add.media_start) printf '%s' 'le conteneur média ne démarre pas' ;;
    fr:integration.add.screen_folder) printf '%s' 'live-screen dans ~/.jht n'\''est pas un dossier normal (un lien ?) : je ne l'\''utilise pas' ;;
    fr:integration.add.screen_not_on) printf '%s' 'le conteneur de l'\''écran n'\''est pas allumé' ;;
    fr:integration.add.screen_password) printf '%s' 'le dossier du mot de passe de l'\''écran n'\''a pas été créé' ;;
    fr:integration.add.screen_start) printf '%s' 'le conteneur de l'\''écran ne démarre pas' ;;
    fr:integration.add.team_down) printf '%s' 'le conteneur de l'\''équipe ne démarre pas : jht up' ;;
    fr:integration.add.telegram_not_on) printf '%s' 'le service Telegram n'\''est pas allumé' ;;
    fr:integration.add.telegram_start) printf '%s' 'le service Telegram ne démarre pas' ;;
    fr:integration.change.markers_unsafe) printf '%s' 'le dossier des marqueurs n'\''est pas sûr' ;;
    fr:integration.image.engine_keeps) printf '%s' 'conteneur supprimé, mais le moteur ne supprime pas l'\''image des outils%s : quelque chose l'\''utilise encore' ;;
    fr:integration.image.in_use) printf '%s' 'l'\''image des outils%s n'\''est pas supprimée : %s l'\''utilise encore' ;;
    fr:integration.image.removed) printf '%s' 'image des outils supprimée%s' ;;
    fr:integration.image.size) printf '%s' 'jusqu'\''à %d Mo' ;;
    fr:integration.image.stays) printf '%s' 'l'\''image des outils%s reste sur le disque pour le rallumer sans la retélécharger : pour libérer l'\''espace, %s' ;;
    fr:integration.label.downloading) printf '%s' 'téléchargement en cours' ;;
    fr:integration.label.error) printf '%s' 'erreur' ;;
    fr:integration.label.not_installed) printf '%s' 'non installé' ;;
    fr:integration.label.ready) printf '%s' 'ajouté' ;;
    fr:integration.label.running) printf '%s' 'allumé' ;;
    fr:integration.linkedin.profile_not_plain) printf '%s' 'le profil LinkedIn dans ~/.jht n'\''est pas un dossier normal (un lien ?) : je ne l'\''utilise pas' ;;
    fr:integration.linkedin.seccomp) printf '%s' 'le profil seccomp du navigateur de connexion manque ou ne correspond pas à celui attesté : je ne démarre pas' ;;
    fr:integration.linkedin.token_stdin) printf '%s' 'le jeton de la fenêtre vient de l'\''app, sur l'\''entrée standard' ;;
    fr:integration.linkedin.usage) printf '%s' 'utilisation : jht linkedin login [--stop] | status --json' ;;
    fr:integration.purge_needs_yes) printf '%s' '--purge supprime les données de l'\''intégration : il faut aussi --yes' ;;
    fr:integration.remove.broker_stop) printf '%s' 'le broker de messagerie ne s'\''arrête pas' ;;
    fr:integration.remove.google) printf '%s' 'marqué comme non ajouté ; les bibliothèques restent dans le profil et n'\''utilisent aucune ressource' ;;
    fr:integration.remove.kept) printf '%s' 'conteneur supprimé ; les données restent (pour les supprimer : --purge --yes)' ;;
    fr:integration.remove.linkedin) printf '%s' 'conteneurs supprimés ; la session LinkedIn du profil reste (jht reset --scope creds la supprime)' ;;
    fr:integration.remove.linkedin_stop) printf '%s' 'les conteneurs de la connexion à LinkedIn ne s'\''arrêtent pas' ;;
    fr:integration.remove.mail_purged) printf '%s' 'conteneur et état du broker supprimés ; le mot de passe de la messagerie et les identifiants des portails restent dans le volume des secrets (jht reset --scope creds)' ;;
    fr:integration.remove.media_purged) printf '%s' 'conteneur supprimé ; les deux dossiers d'\''échange avec jht restent (ils appartiennent à jht et ne contiennent aucun de tes fichiers)' ;;
    fr:integration.remove.media_stop) printf '%s' 'le conteneur média ne s'\''arrête pas' ;;
    fr:integration.remove.purged) printf '%s' 'conteneur et données supprimés' ;;
    fr:integration.remove.screen_off) printf '%s' 'écran éteint et conteneur supprimé' ;;
    fr:integration.remove.screen_purged) printf '%s' 'conteneur supprimé ; le dossier d'\''affichage partagé avec jht a été supprimé' ;;
    fr:integration.remove.screen_stop) printf '%s' 'le conteneur de l'\''écran ne s'\''arrête pas' ;;
    fr:integration.remove.telegram_stop) printf '%s' 'le service Telegram ne s'\''arrête pas' ;;
    fr:integration.remove.volume) printf '%s' 'un volume ne peut pas être supprimé : %s' ;;
    fr:integration.remove_image_only) printf '%s' '--remove-image vaut pour screen et media : ce sont les deux qui utilisent l'\''image des outils' ;;
    fr:integration.state.added_off) printf '%s' 'ajouté, conteneur éteint' ;;
    fr:integration.state.container_on) printf '%s' 'conteneur allumé' ;;
    fr:integration.state.engine_silent) printf '%s' 'le moteur de conteneurs ne répond pas' ;;
    fr:integration.state.google_ready) printf '%s' 'bibliothèques Google ajoutées au profil ; il manque les identifiants du compte Google' ;;
    fr:integration.state.in_progress) printf '%s' 'opération en cours' ;;
    fr:integration.state.linkedin_how) printf '%s' 'il s'\''allume avec : jht linkedin login' ;;
    fr:integration.state.linkedin_running) printf '%s' 'connexion à LinkedIn en cours' ;;
    fr:integration.state.media_off) printf '%s' 'ajouté, conteneur éteint : jht integration add media le rallume' ;;
    fr:integration.state.not_added) printf '%s' 'pas encore ajouté' ;;
    fr:integration.state.not_yet) printf '%s' 'pas encore disponible' ;;
    fr:integration.state.screen_asked_off) printf '%s' 'demandé allumé mais le conteneur est éteint : jht screen on le rallume' ;;
    fr:integration.state.screen_running) printf '%s' 'écran allumé, flux en lecture seule sur 127.0.0.1' ;;
    fr:integration.state.telegram_no_bot) printf '%s' 'service allumé, aucun bot appairé : jht telegram pair assistente' ;;
    fr:integration.state.telegram_off) printf '%s' 'ajouté, service éteint : jht telegram pair assistente (avec un bot déjà appairé, jht up le rallume)' ;;
    fr:integration.state.unattestable) printf '%s' 'le conteneur ne peut pas être attesté' ;;
    fr:integration.unknown) printf '%s' 'intégration inconnue. id autorisés : %s' ;;
    fr:integration.usage) printf '%s' 'utilisation : jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' ;;
    pt:integration.add.broker_not_on) printf '%s' 'o broker do correio não está ligado' ;;
    pt:integration.add.broker_start) printf '%s' 'o broker do correio não arranca' ;;
    pt:integration.add.closer_browser) printf '%s' 'o browser do closer não se copia para o volume' ;;
    pt:integration.add.extras_pull) printf '%s' 'o descarregamento da imagem de ferramentas falhou' ;;
    pt:integration.add.google_failed) printf '%s' 'a instalação das bibliotecas falhou' ;;
    pt:integration.add.linkedin) printf '%s' 'não se adiciona: liga-se com jht linkedin login' ;;
    pt:integration.add.marker) printf '%s' 'marcador não escrito' ;;
    pt:integration.add.media_not_on) printf '%s' 'o contentor de media não está ligado' ;;
    pt:integration.add.media_start) printf '%s' 'o contentor de media não arranca' ;;
    pt:integration.add.screen_folder) printf '%s' 'live-screen em ~/.jht não é uma pasta normal (uma ligação?): não a uso' ;;
    pt:integration.add.screen_not_on) printf '%s' 'o contentor do ecrã não está ligado' ;;
    pt:integration.add.screen_password) printf '%s' 'a pasta da palavra-passe do ecrã não foi criada' ;;
    pt:integration.add.screen_start) printf '%s' 'o contentor do ecrã não arranca' ;;
    pt:integration.add.team_down) printf '%s' 'o contentor da equipa não arranca: jht up' ;;
    pt:integration.add.telegram_not_on) printf '%s' 'o serviço Telegram não está ligado' ;;
    pt:integration.add.telegram_start) printf '%s' 'o serviço Telegram não arranca' ;;
    pt:integration.change.markers_unsafe) printf '%s' 'a pasta dos marcadores não é segura' ;;
    pt:integration.image.engine_keeps) printf '%s' 'contentor removido, mas o motor não remove a imagem de ferramentas%s: algo ainda a usa' ;;
    pt:integration.image.in_use) printf '%s' 'a imagem de ferramentas%s não é removida: %s ainda a usa' ;;
    pt:integration.image.removed) printf '%s' 'imagem de ferramentas removida%s' ;;
    pt:integration.image.size) printf '%s' 'até %d MB' ;;
    pt:integration.image.stays) printf '%s' 'a imagem de ferramentas%s fica no disco para voltar a ligá-lo sem a descarregar de novo: para libertar o espaço, %s' ;;
    pt:integration.label.downloading) printf '%s' 'a descarregar' ;;
    pt:integration.label.error) printf '%s' 'erro' ;;
    pt:integration.label.not_installed) printf '%s' 'não instalada' ;;
    pt:integration.label.ready) printf '%s' 'adicionada' ;;
    pt:integration.label.running) printf '%s' 'ligada' ;;
    pt:integration.linkedin.profile_not_plain) printf '%s' 'o perfil do LinkedIn em ~/.jht não é uma pasta normal (uma ligação?): não o uso' ;;
    pt:integration.linkedin.seccomp) printf '%s' 'o perfil seccomp do browser de início de sessão falta ou não coincide com o atestado: não arranco' ;;
    pt:integration.linkedin.token_stdin) printf '%s' 'o token da janela vem da app, pela entrada padrão' ;;
    pt:integration.linkedin.usage) printf '%s' 'utilização: jht linkedin login [--stop] | status --json' ;;
    pt:integration.purge_needs_yes) printf '%s' '--purge apaga os dados da integração: também é preciso --yes' ;;
    pt:integration.remove.broker_stop) printf '%s' 'o broker do correio não para' ;;
    pt:integration.remove.google) printf '%s' 'marcada como não adicionada; as bibliotecas ficam no perfil e não usam recursos' ;;
    pt:integration.remove.kept) printf '%s' 'contentor removido; os dados ficam (para os apagar: --purge --yes)' ;;
    pt:integration.remove.linkedin) printf '%s' 'contentores removidos; a sessão do LinkedIn no perfil fica (jht reset --scope creds remove-a)' ;;
    pt:integration.remove.linkedin_stop) printf '%s' 'os contentores do início de sessão no LinkedIn não param' ;;
    pt:integration.remove.mail_purged) printf '%s' 'contentor e estado do broker apagados; a palavra-passe do correio e as credenciais dos portais ficam no volume dos segredos (jht reset --scope creds)' ;;
    pt:integration.remove.media_purged) printf '%s' 'contentor removido; as duas pastas de troca com o jht ficam (são do jht e não contêm nenhum ficheiro teu)' ;;
    pt:integration.remove.media_stop) printf '%s' 'o contentor de media não para' ;;
    pt:integration.remove.purged) printf '%s' 'contentor e dados apagados' ;;
    pt:integration.remove.screen_off) printf '%s' 'ecrã desligado e contentor removido' ;;
    pt:integration.remove.screen_purged) printf '%s' 'contentor removido; a pasta do display partilhada com o jht foi apagada' ;;
    pt:integration.remove.screen_stop) printf '%s' 'o contentor do ecrã não para' ;;
    pt:integration.remove.telegram_stop) printf '%s' 'o serviço Telegram não para' ;;
    pt:integration.remove.volume) printf '%s' 'não é possível apagar um volume: %s' ;;
    pt:integration.remove_image_only) printf '%s' '--remove-image é para screen e media: são as duas feitas com a imagem de ferramentas' ;;
    pt:integration.state.added_off) printf '%s' 'adicionada, contentor desligado' ;;
    pt:integration.state.container_on) printf '%s' 'contentor ligado' ;;
    pt:integration.state.engine_silent) printf '%s' 'o motor de contentores não responde' ;;
    pt:integration.state.google_ready) printf '%s' 'bibliotecas do Google adicionadas ao perfil; faltam as credenciais da conta Google' ;;
    pt:integration.state.in_progress) printf '%s' 'operação em curso' ;;
    pt:integration.state.linkedin_how) printf '%s' 'liga-se com: jht linkedin login' ;;
    pt:integration.state.linkedin_running) printf '%s' 'início de sessão no LinkedIn em curso' ;;
    pt:integration.state.media_off) printf '%s' 'adicionada, contentor desligado: jht integration add media volta a ligá-lo' ;;
    pt:integration.state.not_added) printf '%s' 'ainda não adicionada' ;;
    pt:integration.state.not_yet) printf '%s' 'ainda não disponível' ;;
    pt:integration.state.screen_asked_off) printf '%s' 'pedido ligado, mas o contentor está desligado: jht screen on volta a ligá-lo' ;;
    pt:integration.state.screen_running) printf '%s' 'ecrã ligado, transmissão só de visualização em 127.0.0.1' ;;
    pt:integration.state.telegram_no_bot) printf '%s' 'serviço ligado, nenhum bot emparelhado: jht telegram pair assistente' ;;
    pt:integration.state.telegram_off) printf '%s' 'adicionada, serviço desligado: jht telegram pair assistente (com um bot já emparelhado, jht up volta a ligá-lo)' ;;
    pt:integration.state.unattestable) printf '%s' 'o contentor não pode ser atestado' ;;
    pt:integration.unknown) printf '%s' 'integração desconhecida. ids permitidos: %s' ;;
    pt:integration.usage) printf '%s' 'utilização: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]' ;;
    *) return 1 ;;
  esac
}
# <<< texts in the 7 languages

integration_label() {
  case "$1" in
    not_installed) itx integration.label.not_installed 'not installed' ;;
    downloading) itx integration.label.downloading 'downloading' ;;
    ready) itx integration.label.ready 'added' ;;
    running) itx integration.label.running 'on' ;;
    *) itx integration.label.error 'error' ;;
  esac
}

integration_id_valid() {
  case " $INTEGRATION_IDS " in *" $1 "*) return 0 ;; esac
  return 1
}

integration_not_yet() {
  case " $INTEGRATION_NOT_YET " in *" $1 "*) return 0 ;; esac
  return 1
}

# Text of the person's language (ours: the constants below) goes through; text from a command goes through
# integration_foreign first, which keeps printable ASCII only.
integration_foreign() { printf '%s' "$1" | LC_ALL=C tr -cd '\40-\176' | cut -c1-200; }
# The error marker holds a sentence of ours, in the language of the run (with its letters: é, ő, ç…), or a command's line that
# integration_foreign already made ASCII: only the control characters go, and at most 600 bytes are read back.
integration_marker_text() { printf '%s' "$1" | LC_ALL=C tr -d '\000-\037\177' | head -c 600; }
integration_json_str() { printf '%s' "$1" | tr -d '\000-\037\177' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# ── Host markers ──────────────────────────────────────────────────────────
# $RUNTIME_DIR/integrations/<id>.pending (pid of the run in progress), <id>.error (one line), google.ok.
# The folder is the host's: outside every mount of the container, checked like the runtime itself.
integration_dir() { printf '%s/integrations\n' "$RUNTIME_DIR"; }

integration_dir_ready() {
  local dir
  dir="$(integration_dir)"
  if [ ! -e "$dir" ] && [ ! -L "$dir" ]; then
    (umask 077 && mkdir "$dir") || return 1
  fi
  runtime_node_safe "$dir" dir
}

integration_marker_read() {
  local file
  file="$(integration_dir)/$1.$2"
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  runtime_node_safe "$file" file || return 1
  head -n 1 "$file" 2>/dev/null
}

integration_marker_write() {
  local dir tmp
  integration_dir_ready || return 1
  dir="$(integration_dir)"
  tmp="$(mktemp "$dir/.$1.$2.XXXXXX")" || return 1
  printf '%s\n' "$3" > "$tmp" && mv -f "$tmp" "$dir/$1.$2" || { rm -f "$tmp"; return 1; }
}

integration_marker_clear() { rm -f "$(integration_dir)/$1.$2" 2>/dev/null || true; }

# A run in progress leaves its pid; a pid that is not alive (Ctrl-C, closed terminal) is no run.
integration_pending() {
  local pid
  pid="$(integration_marker_read "$1" pending)" || return 1
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null
}

# ── What the engine says ──────────────────────────────────────────────────
# 0 = the volume is among those of the compose project, 1 = it is not, 2 = the engine did not answer.
integration_volume_present() {
  local ids
  ids="$(docker volume ls -q --filter "label=com.docker.compose.project=$(compose_project_name)" 2>/dev/null)" || return 2
  [ -n "$(printf '%s\n' "$ids" | awk -v expected="$(compose_project_name)_$1" '$0 == expected')" ]
}

# service → "<service> <volume that exists once it has been made>"
integration_service_of() {
  case "$1" in
    telegram) printf '%s jht-telegram-state' "$TELEGRAM_SERVICE" ;;
    mail) printf '%s jht-broker-state' "$BROKER_SERVICE" ;;
    *) return 1 ;;
  esac
}

# Prints "<state>|<reason>". The engine is only asked, never started.
integration_state() {
  local id="$1" service volume rc=0 line bots_rc=0
  if integration_not_yet "$id"; then printf 'not_installed|%s\n' "$(itx integration.state.not_yet 'not available yet')"; return 0; fi
  if integration_pending "$id"; then printf 'downloading|%s\n' "$(itx integration.state.in_progress 'operation in progress')"; return 0; fi
  if [ "$id" = google ]; then
    if integration_marker_read google ok >/dev/null; then printf 'ready|%s\n' "$(itx integration.state.google_ready 'Google libraries added to the profile; the credentials of the Google account are missing')"; return 0; fi
  elif [ "$id" = linkedin-login ]; then
    docker_reachable || { printf 'error|%s\n' "$(itx integration.state.engine_silent 'the container engine does not answer')"; return 0; }
    if linkedin_any_running; then printf 'running|%s\n' "$(itx integration.state.linkedin_running 'LinkedIn sign-in in progress')"; return 0; fi
    printf 'not_installed|%s\n' "$(itx integration.state.linkedin_how 'it starts with: jht linkedin login')"; return 0
  elif [ "$id" = screen ]; then
    docker_reachable || { printf 'error|%s\n' "$(itx integration.state.engine_silent 'the container engine does not answer')"; return 0; }
    read_only_service_id "$SCREEN_SERVICE" >/dev/null 2>&1 || rc=$?
    case "$rc" in
      0) printf 'running|%s\n' "$(itx integration.state.screen_running 'screen on, view-only stream on 127.0.0.1')"; return 0 ;;
      3) ;;
      *) printf 'error|%s\n' "$(itx integration.state.unattestable 'the container cannot be attested')"; return 0 ;;
    esac
    if integration_marker_read screen ok >/dev/null; then printf 'ready|%s\n' "$(itx integration.state.screen_asked_off 'asked on but the container is off: jht screen on starts it again')"; return 0; fi
  elif [ "$id" = media ]; then
    # The two folders it shares with jht are made by `jht up` whether it is added or not: its own marker says "added".
    docker_reachable || { printf 'error|%s\n' "$(itx integration.state.engine_silent 'the container engine does not answer')"; return 0; }
    read_only_service_id "$MEDIA_SERVICE" >/dev/null 2>&1 || rc=$?
    case "$rc" in
      0) printf 'running|%s\n' "$(itx integration.state.container_on 'container on')"; return 0 ;;
      3) ;;
      *) printf 'error|%s\n' "$(itx integration.state.unattestable 'the container cannot be attested')"; return 0 ;;
    esac
    if integration_marker_read media ok >/dev/null; then printf 'ready|%s\n' "$(itx integration.state.media_off 'added, container off: jht integration add media starts it again')"; return 0; fi
  else
    read -r service volume <<< "$(integration_service_of "$id")"
    docker_reachable || { printf 'error|%s\n' "$(itx integration.state.engine_silent 'the container engine does not answer')"; return 0; }
    read_only_service_id "$service" >/dev/null 2>&1 || rc=$?
    case "$rc" in
      0)
        # One true state: a Telegram service that is up but holds no bot is not «acceso» for the person, it is waiting for a token
        # (the same question `jht status` asks). Any answer but a clear «none» keeps what the engine says.
        if [ "$id" = telegram ]; then
          telegram_bots_configured || bots_rc=$?
          if [ "$bots_rc" -eq 1 ]; then
            printf 'ready|%s\n' "$(itx integration.state.telegram_no_bot 'service on, no bot paired: jht telegram pair assistente')"
            return 0
          fi
        fi
        printf 'running|%s\n' "$(itx integration.state.container_on 'container on')"; return 0 ;;
      3) ;;
      *) printf 'error|%s\n' "$(itx integration.state.unattestable 'the container cannot be attested')"; return 0 ;;
    esac
    rc=0
    integration_volume_present "$volume" || rc=$?
    case "$rc" in
      0)
        # The volume says it was added; the container is not there (after a down it is removed). Telegram is started again by a
        # pairing, or by jht up once a bot is paired.
        if [ "$id" = telegram ]; then
          printf 'ready|%s\n' "$(itx integration.state.telegram_off 'added, service off: jht telegram pair assistente (with a bot already paired, jht up starts it again)')"
        else
          printf 'ready|%s\n' "$(itx integration.state.added_off 'added, container off')"
        fi
        return 0 ;;
      2) printf 'error|%s\n' "$(itx integration.state.engine_silent 'the container engine does not answer')"; return 0 ;;
    esac
  fi
  if line="$(integration_marker_read "$id" error)" && [ -n "$line" ]; then
    printf 'error|%s\n' "$(integration_marker_text "$line")"
    return 0
  fi
  printf 'not_installed|%s\n' "$(itx integration.state.not_added 'not added yet')"
}

# ── Output ────────────────────────────────────────────────────────────────
integration_status_json() { # id state reason
  printf '{"id":"%s","state":"%s","reason":"%s"}' "$1" "$2" "$(integration_json_str "$3")"
}

integration_print_status() { # json id
  local state reason
  IFS='|' read -r state reason <<< "$(integration_state "$2")"
  if [ "$1" = 1 ]; then integration_status_json "$2" "$state" "$reason"; printf '\n'; return 0; fi
  printf '%-15s %-16s %s\n' "$2" "$(integration_label "$state")" "$reason"
}

integration_list() { # json
  local id first=1
  if [ "$1" = 1 ]; then
    printf '{"integrations":['
    for id in $INTEGRATION_IDS; do
      [ "$first" = 1 ] || printf ','
      first=0
      integration_print_status 1 "$id" | tr -d '\n'
    done
    printf ']}\n'
    return 0
  fi
  for id in $INTEGRATION_IDS; do integration_print_status 0 "$id"; done
}

# The result of add/remove, in the form the person asked for. $1 json, $2 id, $3 exit code, $4 reason when it did not work.
integration_result() {
  local state reason
  IFS='|' read -r state reason <<< "$(integration_state "$2")"
  [ "$3" -eq 0 ] || { [ "$3" -eq 3 ] || state=error; reason="$4"; }
  # what the run said about itself (the data that stayed, the volume left) is worth more than the state's own line
  if [ "$3" -eq 0 ] && [ -n "$4" ]; then reason="$4"; fi
  if [ "$1" = 1 ]; then
    printf '{"id":"%s","ok":%s,"state":"%s","reason":"%s"}\n' "$2" "$([ "$3" -eq 0 ] && echo true || echo false)" "$state" "$(integration_json_str "$reason")"
  elif [ "$3" -eq 0 ]; then
    info "$2: $(integration_label "$state") ($reason)"
  else
    err "$2: $reason"
  fi
  return "$3"
}

# ── add ───────────────────────────────────────────────────────────────────
# Fixed text, run inside the team's container: the libraries of Google go to the person's own store (jht-install).
# Single quotes inside, like the .ps1 one: Windows PowerShell 5.1 drops a double quote in a native argument.
INTEGRATION_GOOGLE_CODE="import sys; sys.path.insert(0, '/app/shared/skills'); from optional_libs import ensure, GOOGLE_DRIVE, GOOGLE_SHEETS; ensure(*GOOGLE_DRIVE, 'Google Drive'); ensure(*GOOGLE_SHEETS, 'Google Sheets')"

# The media container (voice notes and photos): the extras image by the digest this wrapper carries, then the profile of the compose.
MEDIA_SERVICE="jht-media"
SCREEN_SERVICE="jht-screen"
PLAYWRIGHT_POPULATE_SERVICE="jht-playwright-populate"

integration_extras_ref() { # prints the reference of the extras image, or nothing while the release has none
  [[ "${EXTRAS_IMAGE_DIGEST:-}" =~ ^sha256:[0-9a-f]{64}$ ]] && printf 'ghcr.io/leopu00/jht@%s\n' "$EXTRAS_IMAGE_DIGEST"
  return 0
}

# The folder of the viewer password of the live screen, and whether what is there is fit to be mounted: nothing, or a plain folder,
# never a link.
integration_screen_folder() { printf '%s/live-screen' "${JHT_HOME_HOST:-$HOME/.jht}"; }
integration_screen_folder_ok() {
  local dir
  dir="$(integration_screen_folder)"
  [ ! -L "$dir" ] && { [ ! -e "$dir" ] || [ -d "$dir" ]; }
}

integration_do_add() { # id → 0 done · 1 failed (reason in INTEGRATION_WHY)
  local out ref
  INTEGRATION_WHY=""
  case "$1" in
    google)
      ensure_up >/dev/null 2>&1 || { INTEGRATION_WHY="$(itx integration.add.team_down 'the container of the team does not start: jht up')"; return 1; }
      out="$(docker exec -e JHT_HOST_TYPE="${JHT_HOST_TYPE:-}" "$ATTESTED_CONTAINER_ID" python3 -c "$INTEGRATION_GOOGLE_CODE" 2>&1)" || {
        INTEGRATION_WHY="$(integration_foreign "$(printf '%s\n' "$out" | tail -n 1)")"
        [ -n "$INTEGRATION_WHY" ] || INTEGRATION_WHY="$(itx integration.add.google_failed 'installing the libraries did not work')"
        return 1
      }
      integration_marker_write google ok ok || { INTEGRATION_WHY="$(itx integration.add.marker 'marker not written')"; return 1; }
      ;;
    telegram)
      COMPOSE_PROFILES=telegram compose up -d "$TELEGRAM_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="$(itx integration.add.telegram_start 'the Telegram service does not start')"; return 1; }
      telegram_lifecycle_verify start >/dev/null 2>&1 || { INTEGRATION_WHY="$(itx integration.add.telegram_not_on 'the Telegram service is not on')"; return 1; }
      ;;
    media)
      ref="$(integration_extras_ref)"
      [ -n "$ref" ] || { INTEGRATION_WHY="$(itx integration.state.not_yet 'not available yet')"; return 3; }
      docker pull "$ref" >/dev/null 2>&1 || { INTEGRATION_WHY="$(itx integration.add.extras_pull 'downloading the tools image did not work')"; return 1; }
      JHT_EXTRAS_IMAGE="$ref" COMPOSE_PROFILES=media compose up -d "$MEDIA_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="$(itx integration.add.media_start 'the media container does not start')"; return 1; }
      read_only_service_id "$MEDIA_SERVICE" >/dev/null 2>&1 || { INTEGRATION_WHY="$(itx integration.add.media_not_on 'the media container is not on')"; return 1; }
      integration_marker_write media ok ok || { INTEGRATION_WHY="$(itx integration.add.marker 'marker not written')"; return 1; }
      ;;
    linkedin-login)
      INTEGRATION_WHY="$(itx integration.add.linkedin 'it is not added: it starts with jht linkedin login')"
      return 3
      ;;
    screen)
      ref="$(integration_extras_ref)"
      [ -n "$ref" ] || { INTEGRATION_WHY="$(itx integration.state.not_yet 'not available yet')"; return 3; }
      docker pull "$ref" >/dev/null 2>&1 || { INTEGRATION_WHY="$(itx integration.add.extras_pull 'downloading the tools image did not work')"; return 1; }
      # The folder the desktop app reads the viewer password from is made here, by the person: a bind mount of a folder that is not
      # there would be made by the engine, with its own owner. It is mounted writable in the screen container, and ~/.jht is written by
      # the agents: a link in its place would have the engine mount what the link points to. It is a plain folder or the run stops.
      integration_screen_folder_ok || { INTEGRATION_WHY="$(itx integration.add.screen_folder 'live-screen in ~/.jht is not a plain folder (a link?): I do not use it')"; return 1; }
      [ -d "$(integration_screen_folder)" ] || (umask 077 && mkdir -p -- "${JHT_HOME_HOST:-$HOME/.jht}" && mkdir -- "$(integration_screen_folder)") 2>/dev/null \
        || { INTEGRATION_WHY="$(itx integration.add.screen_password 'the folder of the screen password was not made')"; return 1; }
      # The closer's browser with a window comes from the volume the one-shot fills: ready before the screen is.
      JHT_EXTRAS_IMAGE="$ref" JHT_EXTRAS_DIGEST="$EXTRAS_IMAGE_DIGEST" COMPOSE_PROFILES=playwright compose run --rm --no-deps -T "$PLAYWRIGHT_POPULATE_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="$(itx integration.add.closer_browser 'the browser of the closer does not copy into the volume')"; return 1; }
      # Checked again right before the up (the copy above took time): what is left is the instant between this test and the engine's
      # mount, which an agent that wins the race can use; the folder holds nothing but a viewer password.
      integration_screen_folder_ok && [ -d "$(integration_screen_folder)" ] \
        || { INTEGRATION_WHY="$(itx integration.add.screen_folder 'live-screen in ~/.jht is not a plain folder (a link?): I do not use it')"; return 1; }
      JHT_EXTRAS_IMAGE="$ref" COMPOSE_PROFILES=screen compose up -d "$SCREEN_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="$(itx integration.add.screen_start 'the screen container does not start')"; return 1; }
      read_only_service_id "$SCREEN_SERVICE" >/dev/null 2>&1 || { INTEGRATION_WHY="$(itx integration.add.screen_not_on 'the screen container is not on')"; return 1; }
      integration_marker_write screen ok ok || { INTEGRATION_WHY="$(itx integration.add.marker 'marker not written')"; return 1; }
      ;;
    mail)
      ensure_broker >/dev/null 2>&1 || { INTEGRATION_WHY="$(itx integration.add.broker_start 'the mail broker does not start')"; return 1; }
      read_only_service_id "$BROKER_SERVICE" >/dev/null 2>&1 || { INTEGRATION_WHY="$(itx integration.add.broker_not_on 'the mail broker is not on')"; return 1; }
      ;;
  esac
}

# ── remove ────────────────────────────────────────────────────────────────
# Volumes that belong to one integration only. The ones shared with `jht` (sockets) are never listed, and neither is jht-secrets:
# it holds the credentials of every portal besides the mailbox (jht reset --scope creds is the way to empty it).
integration_volumes_of() {
  case "$1" in
    telegram) printf 'jht-telegram-secrets jht-telegram-state jht-telegram-inbox' ;;
    mail) printf 'jht-broker-state' ;;
    screen) printf 'jht-x11' ;;
    linkedin-login) printf 'jht-login-vnc jht-login-egress' ;;
  esac
}

# The extras image (the browser, the screen, the media tools) stays on the disk when a tool made of it is switched off: it was downloaded when the
# person asked for the tool, and the next `on` finds it instead of downloading it again. It goes with `--remove-image`, or with the uninstall.
# What the engine reports as the size of the image is the whole of it, and a part is shared with the core image: «fino a».
integration_extras_after_off() { # tool remove_image → appends to INTEGRATION_WHY · 0 done · 1 the engine does not take the image away
  local tool="$1" remove_image="$2" ref bytes mb="" other="" command
  ref="$(integration_extras_ref)"
  [ -n "$ref" ] || return 0
  bytes="$(docker image inspect --format '{{.Size}}' "$ref" 2>/dev/null)" || return 0   # the image is not there: nothing to say
  [[ "$bytes" =~ ^[0-9]+$ ]] && mb=" ($(itxf integration.image.size 'up to %d MB' "$((bytes / 1000000))"))"
  if [ "$remove_image" = 1 ]; then
    for command in linkedin-login media screen; do
      [ "$command" != "$tool" ] || continue
      if integration_marker_read "$command" ok >/dev/null; then other="$command"; break; fi
    done
    if [ -n "$other" ]; then
      INTEGRATION_WHY="$INTEGRATION_WHY; $(itxf integration.image.in_use 'the tools image%s is not removed: %s still uses it' "$mb" "$other")"
    elif docker rmi "$ref" >/dev/null 2>&1; then
      INTEGRATION_WHY="$INTEGRATION_WHY; $(itxf integration.image.removed 'tools image removed%s' "$mb")"
    else
      INTEGRATION_WHY="$(itxf integration.image.engine_keeps 'container removed, but the engine does not remove the tools image%s: something still uses it' "$mb")"
      return 1
    fi
    return 0
  fi
  if [ "$tool" = screen ]; then command="jht screen off --remove-image"; else command="jht integration remove $tool --remove-image"; fi
  INTEGRATION_WHY="$INTEGRATION_WHY; $(itxf integration.image.stays 'the tools image%s stays on the disk to start it again without downloading it: to free the space, %s' "$mb" "$command")"
}

# Stops and removes one tool's container: what counts is what is left. podman-compose's stop/rm answered non-zero on a Mac with Podman
# while the screen's container had stopped (`jht screen off` said «non si ferma» and the screen stayed «chiesto acceso ma spento»).
# So after them the service is looked up again: none left is done; one left that is attested ours (running or stopped) is removed by
# its id; one that cannot be attested is never touched.
integration_stop_remove() { # service profile → 0 none left · 1 failed
  local service="$1" profile="$2" id status=0
  COMPOSE_PROFILES="$profile" compose stop "$service" >/dev/null 2>&1 || true
  COMPOSE_PROFILES="$profile" compose rm -f "$service" >/dev/null 2>&1 || true
  id="$(read_only_service_id "$service" any-config 2>/dev/null)" || status=$?
  [ "$status" -ne 3 ] || return 0
  [ "$status" -eq 0 ] && [ -n "$id" ] || return 1
  docker rm -f "$id" >/dev/null 2>&1 || return 1
  status=0
  read_only_service_id "$service" any-config >/dev/null 2>&1 || status=$?
  [ "$status" -eq 3 ]
}

integration_do_remove() { # id purge remove_image → 0 done · 1 failed
  local volume rc id ref
  INTEGRATION_WHY=""
  case "$1" in
    google)
      integration_marker_clear google ok
      INTEGRATION_WHY="$(itx integration.remove.google 'marked as not added; the libraries stay in the profile and use no resources')"
      return 0
      ;;
    telegram)
      COMPOSE_PROFILES=telegram compose stop "$TELEGRAM_SERVICE" >/dev/null 2>&1 \
        && COMPOSE_PROFILES=telegram compose rm -f "$TELEGRAM_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="$(itx integration.remove.telegram_stop 'the Telegram service does not stop')"; return 1; }
      ;;
    media)
      integration_stop_remove "$MEDIA_SERVICE" media || { INTEGRATION_WHY="$(itx integration.remove.media_stop 'the media container does not stop')"; return 1; }
      integration_marker_clear media ok
      ;;
    linkedin-login)
      linkedin_remove_all || { INTEGRATION_WHY="$(itx integration.remove.linkedin_stop 'the containers of the LinkedIn sign-in do not stop')"; return 1; }
      ;;
    screen)
      integration_stop_remove "$SCREEN_SERVICE" screen || { INTEGRATION_WHY="$(itx integration.remove.screen_stop 'the screen container does not stop')"; return 1; }
      integration_marker_clear screen ok
      ;;
    mail)
      # An older compose still starts the broker with `jht up`: removing it there would only be undone by the next start.
      awk -v head="  $BROKER_SERVICE:" '$0 == head { in_service = 1; next } in_service && /^  [^ ]/ { exit } in_service && /^    profiles:/ { found = 1 } END { exit !found }' \
        "$COMPOSE_FILE" 2>/dev/null || { INTEGRATION_WHY="$(itx integration.state.not_yet 'not available yet')"; return 3; }
      COMPOSE_PROFILES=broker compose stop "$BROKER_SERVICE" >/dev/null 2>&1 \
        && COMPOSE_PROFILES=broker compose rm -f "$BROKER_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="$(itx integration.remove.broker_stop 'the mail broker does not stop')"; return 1; }
      rm -f -- "$BROKER_WANTED_MARKER"
      ;;
  esac
  if [ "$2" = 1 ]; then
    for volume in $(integration_volumes_of "$1"); do
      rc=0
      integration_volume_present "$volume" || rc=$?
      [ "$rc" -ne 0 ] || {
        id="$(compose_project_name)_$volume"
        docker volume rm "$id" >/dev/null 2>&1 || { INTEGRATION_WHY="$(itxf integration.remove.volume 'a volume cannot be deleted: %s' "$volume")"; return 1; }
      }
    done
    if [ "$1" = screen ]; then
      INTEGRATION_WHY="$(itx integration.remove.screen_purged 'container removed; the display folder shared with jht was deleted')"
    elif [ "$1" = media ]; then
      INTEGRATION_WHY="$(itx integration.remove.media_purged 'container removed; the two exchange folders with jht stay (they belong to jht and hold none of your files)')"
    elif [ "$1" = mail ]; then
      INTEGRATION_WHY="$(itx integration.remove.mail_purged 'container and broker state deleted; the mail password and the credentials of the portals stay in the secrets volume (jht reset --scope creds)')"
    else
      INTEGRATION_WHY="$(itx integration.remove.purged 'container and data deleted')"
    fi
  elif [ "$1" = screen ]; then
    INTEGRATION_WHY="$(itx integration.remove.screen_off 'screen off and container removed')"
  elif [ "$1" = linkedin-login ]; then
    INTEGRATION_WHY="$(itx integration.remove.linkedin 'containers removed; the LinkedIn session in the profile stays (jht reset --scope creds removes it)')"
  else
    INTEGRATION_WHY="$(itx integration.remove.kept 'container removed; the data stays (to delete it: --purge --yes)')"
  fi
  case "$1" in screen|media) integration_extras_after_off "$1" "${3:-0}" || return $? ;; esac
  return 0
}

# add|remove, with the run marked as in progress and the outcome left for the next status.
integration_change() { # action id json purge remove_image
  local action="$1" id="$2" json="$3" purge="$4" remove_image="${5:-0}" rc=0
  if integration_not_yet "$id"; then integration_result "$json" "$id" 3 "$(itx integration.state.not_yet 'not available yet')"; return $?; fi
  integration_dir_ready || { integration_result "$json" "$id" 1 "$(itx integration.change.markers_unsafe 'the folder of the markers is not safe')"; return $?; }
  integration_marker_write "$id" pending "$$" || { integration_result "$json" "$id" 1 "$(itx integration.add.marker 'marker not written')"; return $?; }
  integration_marker_clear "$id" error
  if [ "$action" = add ]; then integration_do_add "$id" || rc=$?; else integration_do_remove "$id" "$purge" "$remove_image" || rc=$?; fi
  integration_marker_clear "$id" pending
  [ "$rc" -eq 0 ] || { [ "$rc" -eq 3 ] || integration_marker_write "$id" error "$INTEGRATION_WHY" || true; }
  integration_result "$json" "$id" "$rc" "$INTEGRATION_WHY"
}

# ── Entry point ───────────────────────────────────────────────────────────
integration_usage() {
  err "$(itx integration.usage 'usage: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]')"
  err "id: $INTEGRATION_IDS"
  return 2
}

integration_main() {
  local action="${1:-}" id="" json=0 purge=0 yes=0 remove_image=0 arg
  [ "$#" -gt 0 ] && shift
  case "$action" in list|status|add|remove) ;; *) integration_usage; return $? ;; esac
  for arg in "$@"; do
    case "$arg" in
      --json) json=1 ;;
      --purge) [ "$action" = remove ] || { integration_usage; return $?; }; purge=1 ;;
      --yes) [ "$action" = remove ] || { integration_usage; return $?; }; yes=1 ;;
      --remove-image) [ "$action" = remove ] || { integration_usage; return $?; }; remove_image=1 ;;
      -*) integration_usage; return $? ;;
      *) [ -z "$id" ] || { integration_usage; return $?; }; id="$arg" ;;
    esac
  done
  if [ "$action" = list ] && [ -n "$id" ]; then integration_usage; return $?; fi
  if [ "$action" != list ] && [ "$action" != status ] && [ -z "$id" ]; then integration_usage; return $?; fi
  if [ -n "$id" ] && ! integration_id_valid "$id"; then err "$(itxf integration.unknown 'unknown integration. allowed ids: %s' "$INTEGRATION_IDS")"; return 2; fi
  if [ "$remove_image" = 1 ] && [ "$id" != screen ] && [ "$id" != media ]; then err "$(itx integration.remove_image_only '--remove-image is for screen and media: they are the two made with the tools image')"; return 2; fi
  if [ "$purge" = 1 ] && [ "$yes" = 0 ]; then err "$(itx integration.purge_needs_yes '--purge deletes the data of the integration: --yes is needed too')"; return 2; fi
  [ "$yes" = 0 ] || [ "$purge" = 1 ] || { integration_usage; return $?; }

  case "$action" in
    list) integration_list "$json" ;;
    status)
      if [ -n "$id" ]; then integration_print_status "$json" "$id"; else integration_list "$json"; fi
      ;;
    add|remove)
      integration_not_yet "$id" || require_docker
      integration_change "$action" "$id" "$json" "$purge" "$remove_image"
      ;;
  esac
}


# ── `jht linkedin login|status` ───────────────────────────────────────────
# The manual sign-in to LinkedIn: three containers of the profile `login` (shared/login/). The line the desktop app reads is the one the
# view prints (login_view.py grant); here it is only checked in its exact shape, so nothing else ever reaches the app as a token.
LOGIN_SERVICE="jht-login"
LOGIN_PROXY_SERVICE="jht-login-proxy"
LOGIN_VIEW_SERVICE="jht-login-view"
LOGIN_SERVICES="$LOGIN_PROXY_SERVICE $LOGIN_VIEW_SERVICE $LOGIN_SERVICE"
LINKEDIN_REASONS="view_busy view_unavailable login_timeout token_expired chromium_sandbox_unavailable token_required"

# On Docker (Linux, Colima, Docker Desktop) the browser of the sign-in runs under a seccomp profile of ours: the default profile of Docker plus
# the user, pid and net namespaces the sandbox of Chromium makes (shared/login/seccomp/, tests/test_login_seccomp_profile.py). The default
# one refuses them, and the browser would not start. The profile ships in the extras image, which is pinned by digest, and its digest is here,
# in the helper the wrapper attests: the copy kept in the runtime folder next to the compose file is checked against it at every start and
# taken again from the image when it differs, and with no matching copy the sign-in does not start (it reports chromium_sandbox_unavailable).
# Podman keeps its own default profile, which lets the sandbox through: nothing changes there. Never `seccomp=unconfined`.
LOGIN_SECCOMP_SHA256="5f5ac5bbb2f97aa4b866ba5fa83a2dc9f8b7ddfd725cc1d2949f2c6e245a68c7"
LOGIN_SECCOMP_IN_IMAGE="/app/shared/login/seccomp/jht-login.json"
login_seccomp_path() { printf '%s\n' "$RUNTIME_DIR/jht-login-seccomp.json"; }
login_seccomp_overlay_path() { printf '%s\n' "$RUNTIME_DIR/docker-compose.login-seccomp.yml"; }

# The profile and the overlay file that gives it to jht-login (and to nothing else), both in the runtime folder, which the agents do not
# mount. The folder is an absolute path, and a name that would not stay one string in YAML is refused (see below).
linkedin_seccomp_ensure() {
  local ref="$1" target overlay tmp content
  target="$(login_seccomp_path)"; overlay="$(login_seccomp_overlay_path)"
  # The folder name goes into a double-quoted YAML string and is read back by Compose: a space is fine (the default folder on a Mac has two),
  # what would end the string or be read as something else is not: a quote, a backslash, a dollar, a colon, a hash, any control character.
  case "$RUNTIME_DIR" in
    ''|/|*[[:cntrl:]]*|*'"'*|*\\*|*'$'*|*:*|*'#'*) return 1 ;;
    /*) ;;
    *) return 1 ;;
  esac
  [ ! -L "$target" ] && [ ! -L "$overlay" ] || return 1
  if ! { [ -f "$target" ] && [ "$(runtime_sha256 "$target")" = "$LOGIN_SECCOMP_SHA256" ]; }; then
    tmp="$(mktemp "$target.XXXXXX")" || return 1
    if docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 1001:1001 \
         --entrypoint cat "$ref" "$LOGIN_SECCOMP_IN_IMAGE" > "$tmp" 2>/dev/null \
       && [ "$(runtime_sha256 "$tmp")" = "$LOGIN_SECCOMP_SHA256" ]; then
      chmod 0644 "$tmp" && mv -f "$tmp" "$target" || { rm -f "$tmp"; return 1; }
    else
      rm -f "$tmp"
      return 1
    fi
  fi
  content="services:
  $LOGIN_SERVICE:
    security_opt:
      - \"seccomp:$target\""
  if ! { [ -f "$overlay" ] && [ "$(cat "$overlay" 2>/dev/null)" = "$content" ]; }; then
    tmp="$(mktemp "$overlay.XXXXXX")" || return 1
    { printf '%s\n' "$content" > "$tmp" && mv -f "$tmp" "$overlay"; } || { rm -f "$tmp"; return 1; }
  fi
  printf '%s\n' "$overlay"
}

linkedin_base() { printf '%s' "${JHT_HOME_HOST:-$HOME/.jht}"; }
linkedin_profile_dir() { printf '%s/secrets/linkedin-profile' "$(linkedin_base)"; }

# Nothing, or a plain folder, at every step under ~/.jht down to the profile: never a link (the folder is mounted writable in the browser
# container, and the agents of the team container write under ~/.jht).
linkedin_profile_ok() {
  local path
  for path in "$(linkedin_base)" "$(linkedin_base)/secrets" "$(linkedin_profile_dir)"; do
    [ ! -L "$path" ] && { [ ! -e "$path" ] || [ -d "$path" ]; } || return 1
  done
}

linkedin_profile_make() {
  linkedin_profile_ok || return 1
  (
    umask 077
    [ -d "$(linkedin_base)" ] || mkdir -p -- "$(linkedin_base)"
    [ -d "$(linkedin_base)/secrets" ] || mkdir -- "$(linkedin_base)/secrets"
    [ -d "$(linkedin_profile_dir)" ] || mkdir -- "$(linkedin_profile_dir)"
  ) 2>/dev/null && linkedin_profile_ok
}

linkedin_fail() { printf '{"ok": false, "reason": "%s"}\n' "$1"; }

linkedin_grant_line_ok() {
  printf '%s' "$1" | grep -Eq '^\{"ok": true, "port": 6081, "path": "/websockify", "expires_at": "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", "session": "[0-9a-f]{1,32}"\}$'
}

# The reason of a failure line of the view, from the closed list, or nothing.
linkedin_reason_of() {
  local reason
  reason="$(printf '%s' "$1" | sed -n 's/^{"ok": false, "reason": "\([a-z_]*\)"}$/\1/p')"
  case " $LINKEDIN_REASONS " in *" $reason "*) printf '%s' "$reason" ;; esac
}

linkedin_any_running() {
  local svc
  for svc in $LOGIN_SERVICES; do
    read_only_service_id "$svc" >/dev/null 2>&1 && return 0
  done
  return 1
}

linkedin_remove_all() {
  local svc rc=0
  for svc in $LOGIN_SERVICES; do
    COMPOSE_PROFILES=login compose stop "$svc" >/dev/null 2>&1 || rc=1
    COMPOSE_PROFILES=login compose rm -f "$svc" >/dev/null 2>&1 || rc=1
  done
  return $rc
}

# The token of the window is made by whoever opens it (the desktop app) and comes on the standard input, one line of 43 characters of
# base64url; it goes on, the same way, to the view, and no output of this command ever holds it. A terminal (nobody to pipe it) or a
# line that is not a token is `token_required`, before anything else is touched.
LINKEDIN_TOKEN_PATTERN='^[A-Za-z0-9_-]{43}$'
linkedin_read_token() {
  local token=""
  [ ! -t 0 ] || return 1
  token="$(head -c 200 2>/dev/null | head -n 1 | tr -d '\r')" || return 1
  printf '%s' "$token" | grep -Eq "$LINKEDIN_TOKEN_PATTERN" || return 1
  printf '%s' "$token"
}

linkedin_login() {
  local ref line reason id tries token
  token="$(linkedin_read_token)" || { err "$(itx integration.linkedin.token_stdin 'the window token comes from the app, on the standard input')"; linkedin_fail token_required; return 1; }
  docker_reachable || { err "$(itx integration.state.engine_silent 'the container engine does not answer')"; linkedin_fail view_unavailable; return 1; }
  ref="$(integration_extras_ref)"
  [ -n "$ref" ] || { err "$(itx integration.state.not_yet 'not available yet')"; linkedin_fail view_unavailable; return 1; }
  if linkedin_any_running; then linkedin_fail view_busy; return 1; fi
  linkedin_remove_all   # what an ended session left, stopped
  linkedin_profile_make || { err "$(itx integration.linkedin.profile_not_plain 'the LinkedIn profile in ~/.jht is not a plain folder (a link?): I do not use it')"; linkedin_fail view_unavailable; return 1; }
  docker pull "$ref" >/dev/null 2>&1 || { err "$(itx integration.add.extras_pull 'downloading the tools image did not work')"; linkedin_fail view_unavailable; return 1; }
  # Checked again right before the up (the pull took time): what is left is the instant between this test and the mount of the engine.
  linkedin_profile_ok && [ -d "$(linkedin_profile_dir)" ] \
    || { err "$(itx integration.linkedin.profile_not_plain 'the LinkedIn profile in ~/.jht is not a plain folder (a link?): I do not use it')"; linkedin_fail view_unavailable; return 1; }
  local overlay=""
  if [ "${CONTAINER_RUNTIME:-docker}" != "podman" ]; then
    overlay="$(linkedin_seccomp_ensure "$ref")" \
      || { err "$(itx integration.linkedin.seccomp 'the seccomp profile of the sign-in browser is missing or does not match the attested one: not starting')"; linkedin_fail chromium_sandbox_unavailable; return 1; }
  fi
  JHT_EXTRAS_IMAGE="$ref" COMPOSE_PROFILES=login COMPOSE_EXTRA_FILE="$overlay" compose up -d $LOGIN_SERVICES >/dev/null 2>&1 \
    || { linkedin_remove_all; linkedin_fail view_unavailable; return 1; }
  for tries in $(seq 1 40); do
    id="$(read_only_service_id "$LOGIN_VIEW_SERVICE" 2>/dev/null)" || id=""
    line=""
    if [ -n "$id" ]; then
      line="$(printf '%s\n' "$token" | docker exec -i "$id" python3 /app/shared/login/login_view.py grant 2>/dev/null | tail -n 1)" || line=""
    fi
    if linkedin_grant_line_ok "$line"; then printf '%s\n' "$line"; return 0; fi
    reason="$(linkedin_reason_of "$line")"
    case "$reason" in
      ""|view_unavailable)
        # the browser is not ready yet (the token is not used up): ask again, unless the containers are gone
        if [ "$tries" -gt 3 ] && ! linkedin_any_running; then break; fi
        sleep "${LINKEDIN_POLL_SECONDS:-1}" ;;
      *) linkedin_remove_all; linkedin_fail "$reason"; return 1 ;;
    esac
  done
  linkedin_remove_all
  linkedin_fail view_unavailable
  return 1
}

linkedin_stop() {
  linkedin_remove_all || { linkedin_fail view_unavailable; return 1; }
  printf '{"ok": true}\n'
}

# How the last session ended, from the exit code the engine keeps of the stopped view.
linkedin_last_reason() {
  local code
  code="$(docker inspect -f '{{.State.ExitCode}}' "$LOGIN_VIEW_SERVICE" 2>/dev/null)" || return 0
  case "$code" in
    10) printf 'logged_in' ;;
    11) printf 'login_timeout' ;;
    12) printf 'token_expired' ;;
    13) printf 'stopped' ;;
  esac
}

# `jht linkedin status --json` is asked every time the window of the app is looked at, so it must cost nothing: no container is started to read
# the profile. Three layers: no cookie file in the profile means nobody is signed in, and nothing else is asked; the cookie files as they are
# (size and time of each, read by the host) and the image make a key, and the answer of the one-shot that reads the profile is kept for that key
# for LINKEDIN_STATUS_TTL seconds (5 minutes: the longest a cookie that ran out is still shown as a sign-in); only when the key changes (the
# person signed in, the browser wrote its cookies, the image moved) or the time is up is the one-shot run again. The cache is a file of the runtime
# folder, which the containers do not mount; the answers it can hold are the two words of the closed list and nothing else.
LINKEDIN_STATUS_TTL="${LINKEDIN_STATUS_TTL:-300}"
linkedin_status_cache_path() { printf '%s/linkedin-status.cache' "$RUNTIME_DIR"; }

# The cookie files of the profile as the host sees them, one `name=size:seconds;` each; nothing when there is no cookie database at all.
linkedin_cookie_stamp() {
  local dir file out="" database="" meta
  dir="$(linkedin_profile_dir)"
  for file in Default/Network/Cookies Default/Network/Cookies-journal Default/Network/Cookies-wal Default/Cookies Default/Cookies-journal; do
    if [ -f "$dir/$file" ] && [ ! -L "$dir/$file" ]; then
      if [ "$HOST_KERNEL" = Darwin ]; then meta="$(stat -f '%z:%m' "$dir/$file" 2>/dev/null)"; else meta="$(stat -c '%s:%Y' "$dir/$file" 2>/dev/null)"; fi
      out="$out$file=$meta;"
      case "$file" in *Cookies) database=1 ;; esac
    else
      out="$out$file=-;"
    fi
  done
  [ -n "$database" ] || return 1
  printf '%s' "$out"
}

# The word kept for this key, when it is younger than the time allowed; nothing (status 1) otherwise.
linkedin_status_cache_read() {
  local file epoch key word now
  file="$(linkedin_status_cache_path)"
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  IFS='|' read -r epoch key word < "$file" || [ -n "$word" ] || return 1
  case "$epoch" in ''|*[!0-9]*) return 1 ;; esac
  case "$LINKEDIN_STATUS_TTL" in ''|*[!0-9]*) return 1 ;; esac
  now="$(date +%s)"
  [ "$key" = "$1" ] && [ "$now" -ge "$epoch" ] && [ $((now - epoch)) -lt "$LINKEDIN_STATUS_TTL" ] || return 1
  case "$word" in logged_in|login_required) printf '%s' "$word" ;; *) return 1 ;; esac
}

linkedin_status_cache_write() {
  local file tmp
  file="$(linkedin_status_cache_path)"
  [ ! -L "$file" ] || return 0
  tmp="$(mktemp "$file.XXXXXX" 2>/dev/null)" || return 0
  { printf '%s|%s|%s\n' "$(date +%s)" "$1" "$2" > "$tmp" && mv -f "$tmp" "$file"; } 2>/dev/null || rm -f "$tmp"
  return 0
}

linkedin_status() {
  local id view="idle" out last="" word ref stamp key linkedin="login_required"
  docker_reachable || { linkedin_fail view_unavailable; return 1; }
  if id="$(read_only_service_id "$LOGIN_VIEW_SERVICE" 2>/dev/null)"; then
    out="$(docker exec "$id" python3 /app/shared/login/login_view.py status 2>/dev/null | tail -n 1)" || out=""
    case "$out" in
      *'"view": "waiting"'*) view=waiting ;;
      *'"view": "connected"'*) view=connected ;;
    esac
  else
    last="$(linkedin_last_reason)"
  fi
  ref="$(integration_extras_ref)"
  if [ -n "$ref" ] && [ ! -L "$(linkedin_profile_dir)" ] && [ -d "$(linkedin_profile_dir)" ] && linkedin_profile_ok && stamp="$(linkedin_cookie_stamp)"; then
    key="$ref;$stamp"
    if word="$(linkedin_status_cache_read "$key")"; then
      :
    elif docker image inspect "$ref" >/dev/null 2>&1; then
      word="$(JHT_EXTRAS_IMAGE="$ref" COMPOSE_PROFILES=login compose run --rm --no-deps -T --entrypoint python3 "$LOGIN_SERVICE" /app/shared/login/login_session.py check /linkedin-profile 2>/dev/null | tail -n 1)" || word=""
      case "$word" in logged_in|login_required) linkedin_status_cache_write "$key" "$word" ;; esac
    else
      word=""
    fi
    [ "$word" != logged_in ] || linkedin=logged_in
  fi
  if [ -n "$last" ]; then
    printf '{"ok": true, "view": "%s", "linkedin": "%s", "last_session": {"reason": "%s"}}\n' "$view" "$linkedin" "$last"
  else
    printf '{"ok": true, "view": "%s", "linkedin": "%s"}\n' "$view" "$linkedin"
  fi
}

linkedin_main() {
  case "$*" in
    "login") require_docker; linkedin_login ;;
    "login --stop") require_docker; linkedin_stop ;;
    "status --json") linkedin_status ;;
    *) err "$(itx integration.linkedin.usage 'usage: jht linkedin login [--stop] | status --json')"; return 2 ;;
  esac
}
