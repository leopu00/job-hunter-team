class_name MacUpdater
extends RefCounted
## L'installazione vera, su macOS: si scarica, si DIMOSTRA la provenienza, si
## prova che il binario nuovo parte davvero, e solo allora si sostituisce — con
## la copia precedente tenuta da parte finché la nuova non ha dato prova di sé.
##
## L'ordine dei passi è la funzione di sicurezza. Verificare dopo aver
## sostituito non serve a niente: a quel punto il programma di qualcun altro è
## già installato al posto di questo.
##
## Gli strumenti si chiamano per PERCORSO ASSOLUTO. `codesign` e `spctl` sono il
## cardine della verifica, e cercarli nel PATH significherebbe lasciar decidere
## a una variabile d'ambiente chi controlla il controllore.

const DITTO := "/usr/bin/ditto"
const CODESIGN := "/usr/bin/codesign"
const SPCTL := "/usr/sbin/spctl"
const ENV := "/usr/bin/env"
const MV := "/bin/mv"
const RM := "/bin/rm"
const OPEN := "/usr/bin/open"
const XCODE_SELECT := "/usr/bin/xcode-select"
const XCRUN := "/usr/bin/xcrun"

## Dove si apre l'archivio prima di guardarlo. Fuori dal bundle e fuori da
## `/Applications`: finché non ha superato le prove, quel .app non deve stare
## da nessuna parte dove qualcuno possa aprirlo per sbaglio.
const STAGING_DIR := "user://updates/staging"

## Le chiavi UI dei fallimenti. Sono chiavi e non frasi perché l'errore lo legge
## l'utente, nella sua lingua, dentro la fascia.
const ERR_EXTRACT := "update.err_extract"
const ERR_SIGNATURE := "update.err_signature"
const ERR_IDENTITY := "update.err_identity"
const ERR_START := "update.err_start"
const ERR_SWAP := "update.err_swap"
const ERR_WRITE := "update.err_write"

## Il diario dell'ultima installazione, che `UpdateService` versa nel log del
## gioco quando il thread ha finito.
##
## Questo modulo NON parla con l'autoload del log di sua iniziativa, e non è una
## preferenza di stile: sotto `godot --headless --script` gli autoload non
## esistono nemmeno come identificatori, e una sola riga di log qui dentro
## renderebbe questo file — cioè la verifica della firma — impossibile da
## caricare in un self-test. La diagnostica esce di qui come dati.
static var notes: Array[String] = []


static func _note(line: String) -> void:
	notes.append(line)


## Un comando e il suo esito. `read_stderr` è acceso perché `codesign` scrive
## proprio lì tutto quello che ci interessa leggere.
static func run(path: String, args: PackedStringArray) -> Dictionary:
	var lines: Array = []
	var code := OS.execute(path, args, lines, true)
	var text := ""
	for chunk in lines:
		text += str(chunk)
	return {"code": code, "out": text.strip_edges()}


## L'ancora di firma di un bundle, secondo codesign. {} di fatto se non è
## firmato: `signing_anchor` restituisce campi vuoti e `is_developer_id` li
## rifiuta.
static func anchor_of(bundle: String) -> Dictionary:
	var res := run(CODESIGN, PackedStringArray(["-dv", "--verbose=4", bundle]))
	if int(res["code"]) != 0:
		return {"team": "", "authority": ""}
	return UpdateCheck.signing_anchor(str(res["out"]))


## Il bundle in esecuzione, ma solo se ha senso aggiornarlo da qui.
##
## Tre condizioni, e ne basta una a far cadere tutto sulla strada onesta (aprire
## la pagina della release):
##  • siamo dentro un .app — dall'editor non c'è niente da sostituire;
##  • la cartella che lo contiene è scrivibile SENZA chiedere la password.
##    `/Applications` lo è per gli amministratori e non lo è per gli altri, e la
##    differenza si scopre solo provando: un aggiornamento che a metà strada
##    chiede la password di sistema è il momento peggiore per scoprirlo;
##  • la copia in esecuzione è firmata Developer ID. È lei l'ancora a cui viene
##    appuntato il pacchetto nuovo: senza, non c'è niente a cui confrontarsi.
##
## Restituisce {"bundle":…, "anchor":…} oppure {}.
static func installable_bundle() -> Dictionary:
	if OS.get_name() != "macOS":
		return {}
	var bundle := UpdateCheck.bundle_path(OS.get_executable_path())
	if bundle == "":
		return {}
	if not _dir_writable(bundle.get_base_dir()):
		return {}
	var anchor := anchor_of(bundle)
	if not UpdateCheck.is_developer_id(anchor):
		return {}
	return {"bundle": bundle, "anchor": anchor}


static func _dir_writable(dir: String) -> bool:
	var probe := dir.path_join(".jht-update-probe")
	var file := FileAccess.open(probe, FileAccess.WRITE)
	if file == null:
		return false
	file.close()
	DirAccess.remove_absolute(probe)
	return true


## Il percorso completo, da eseguire su un Thread: ogni passo qui dentro blocca.
## Restituisce {"ok": bool, "error": <chiave UI>, "detail": String}.
static func install(zip_path: String, target: Dictionary) -> Dictionary:
	notes.clear()
	var bundle := str(target.get("bundle", ""))
	var anchor: Dictionary = target.get("anchor", {})
	if bundle == "" or not UpdateCheck.is_developer_id(anchor):
		return _fail(ERR_IDENTITY, "nessuna ancora di firma sulla copia in uso")

	# 1. Estrazione con `ditto`, non con un lettore di zip qualunque: un .app
	#    contiene link simbolici e bit di esecuzione, e un estrattore che non li
	#    conserva rompe la firma prima ancora che si possa verificarla — poi il
	#    pacchetto risulta "non valido" e la colpa sembra di chi lo ha prodotto.
	var staging := ProjectSettings.globalize_path(STAGING_DIR)
	run(RM, PackedStringArray(["-rf", staging]))
	DirAccess.make_dir_recursive_absolute(staging)
	var extracted := run(DITTO, PackedStringArray(["-x", "-k", zip_path, staging]))
	if int(extracted["code"]) != 0:
		return _fail(ERR_EXTRACT, str(extracted["out"]))
	var fresh := _find_app(staging)
	if fresh == "":
		return _fail(ERR_EXTRACT, "nessun .app dentro l'archivio")

	# 2. La verifica, PRIMA di toccare qualsiasi cosa.
	var verdict := verify(fresh, anchor)
	if not bool(verdict["ok"]):
		run(RM, PackedStringArray(["-rf", staging]))
		return verdict

	# 3. Il binario nuovo deve partire.
	if not starts(fresh):
		run(RM, PackedStringArray(["-rf", staging]))
		return _fail(ERR_START, fresh)

	# 4. Solo adesso si sostituisce.
	var outcome := _swap(fresh, bundle, anchor)
	run(RM, PackedStringArray(["-rf", staging]))
	return outcome


## Le quattro domande a cui un pacchetto deve rispondere prima di poter
## sostituire il gioco. Nessuna è ridondante:
##
##  1. `codesign --verify --deep --strict` — la firma copre ogni file del bundle
##     e nessuno è stato aggiunto, tolto o modificato dopo che è stata apposta.
##  2. `spctl --assess --type execute` — il verdetto di Gatekeeper, lo stesso che
##     macOS darebbe al primo avvio: Developer ID e notarizzato da Apple. È il
##     comando con cui la 0.3.1 è stata verificata a mano il 2026-07-28.
##  3. `codesign -R` col team della copia in esecuzione — vedi
##     `UpdateCheck.anchors_match`: la notarizzazione dice che Apple lo ha
##     esaminato, non che è il NOSTRO. Senza questo passo, un pacchetto firmato e
##     notarizzato da chiunque altro passerebbe i primi due controlli.
##  4. L'ancora letta dal pacchetto deve coincidere con quella della copia in
##     esecuzione, certificato foglia compreso. È la stessa regola del punto 3
##     applicata da noi invece che da codesign: se un giorno l'espressione del
##     requisito venisse scritta male, questo confronto resta in piedi.
static func verify(app: String, anchor: Dictionary) -> Dictionary:
	var sealed := run(CODESIGN, PackedStringArray(
			["--verify", "--deep", "--strict", "--verbose=2", app]))
	if int(sealed["code"]) != 0:
		return _fail(ERR_SIGNATURE, str(sealed["out"]))
	var gate := run(SPCTL, PackedStringArray(
			["--assess", "--type", "execute", "--verbose=2", app]))
	if int(gate["code"]) != 0:
		return _fail(ERR_SIGNATURE, str(gate["out"]))
	var pinned := run(CODESIGN, PackedStringArray(["--verify",
			"-R=" + UpdateCheck.team_requirement(str(anchor["team"])), app]))
	if int(pinned["code"]) != 0:
		return _fail(ERR_IDENTITY, str(pinned["out"]))
	if not UpdateCheck.anchors_match(anchor, anchor_of(app)):
		return _fail(ERR_IDENTITY, "firmato da uno sviluppatore diverso")
	_note_staple(app)
	return {"ok": true, "error": "", "detail": ""}


## Il biglietto di notarizzazione allegato al bundle. `spctl` qui sopra ha già
## preteso la notarizzazione; questo aggiunge che il biglietto viaggia DENTRO il
## pacchetto, quindi il gioco si apre anche su una macchina senza rete.
##
## È l'unico controllo che può mancare, e per una ragione precisa: `stapler` vive
## nei Command Line Tools di Apple, e su un Mac senza strumenti di sviluppo
## invocare `xcrun` apre una finestra di sistema che propone di installarli —
## dentro un aggiornamento sarebbe incomprensibile. Si chiede prima a
## `xcode-select` se un developer dir esiste; se non esiste si tace, e l'esito
## resta affidato ai tre controlli obbligatori. L'esito NON è un gate: `spctl`
## copre già la notarizzazione, questo ne racconta la forma.
static func _note_staple(app: String) -> void:
	if int(run(XCODE_SELECT, PackedStringArray(["-p"]))["code"]) != 0:
		return
	var res := run(XCRUN, PackedStringArray(["stapler", "validate", app]))
	_note("biglietto di notarizzazione: %s"
			% ("allegato al pacchetto" if int(res["code"]) == 0 else str(res["out"])))


## Il binario si avvia? È la stessa prova che la CI fa su ogni export
## (`--headless --quit-after 3`, vedi `.github/workflows/release.yml`), fatta qui
## prima della sostituzione: un pacchetto che non parte non deve mai diventare
## l'applicazione installata.
##
## L'ambiente si passa con `env` e non con `OS.set_environment`: quest'ultimo
## cambierebbe l'ambiente di QUESTO processo, cioè del gioco che sta girando, e
## `JHT_NOVPS=1` addosso alla sessione dell'utente scollegherebbe il suo team.
static func starts(app: String) -> bool:
	var bin := _executable_in(app)
	if bin == "":
		return false
	var lines: Array = []
	# JHT_NOVPS: la prova non si collega a niente e non tocca il team.
	# JHT_UPDATE_CHECK=0: e non si mette a cercare aggiornamenti a sua volta.
	var code := OS.execute(ENV, PackedStringArray(["JHT_NOVPS=1",
			"JHT_UPDATE_CHECK=0", bin, "--headless", "--quit-after", "3"]),
			lines, true)
	if code != 0:
		_note("il pacchetto in %s non si avvia (uscita %d)" % [app, code])
	return code == 0


## La sostituzione. Due rinomine sullo stesso volume, con la copia precedente
## tenuta da parte fino all'ultimo: se la seconda rinomina fallisce si rimette
## dov'era, e se il gioco appena installato non parte si torna indietro.
##
## Il processo in esecuzione sopravvive alla propria sostituzione: macOS tiene
## vivo l'inode finché qualcuno lo ha aperto. Chi sta giocando non se ne accorge,
## e la versione nuova la vedrà al riavvio.
static func _swap(fresh: String, bundle: String, anchor: Dictionary) -> Dictionary:
	var parent := bundle.get_base_dir()
	var staged := parent.path_join(".jht-update.app")
	var kept := parent.path_join(".jht-previous.app")
	run(RM, PackedStringArray(["-rf", staged, kept]))
	# `ditto` e non `mv`: la cartella di lavoro e `/Applications` possono stare
	# su volumi diversi, e la copia deve arrivare NELLA cartella di destinazione
	# perché la rinomina che segue sia atomica.
	var copied := run(DITTO, PackedStringArray([fresh, staged]))
	if int(copied["code"]) != 0:
		run(RM, PackedStringArray(["-rf", staged]))
		return _fail(ERR_WRITE, str(copied["out"]))
	# Si verifica di nuovo QUI: quella appena scritta è la copia che verrà
	# eseguita, e fra la verifica di prima e adesso ci è passato sopra un ditto.
	var verdict := verify(staged, anchor)
	if not bool(verdict["ok"]):
		run(RM, PackedStringArray(["-rf", staged]))
		return verdict
	if int(run(MV, PackedStringArray([bundle, kept]))["code"]) != 0:
		run(RM, PackedStringArray(["-rf", staged]))
		return _fail(ERR_SWAP, "la copia in uso non si è potuta spostare")
	if int(run(MV, PackedStringArray([staged, bundle]))["code"]) != 0:
		run(MV, PackedStringArray([kept, bundle]))
		run(RM, PackedStringArray(["-rf", staged]))
		return _fail(ERR_SWAP, "il pacchetto nuovo non si è potuto mettere al suo posto")
	# L'ultima prova la fa il gioco INSTALLATO, non quello in lavorazione: se non
	# parte da qui — permessi, quarantena, volume — torna quello di prima, e
	# l'utente si ritrova con l'applicazione che aveva, non senza applicazione.
	if not starts(bundle):
		run(RM, PackedStringArray(["-rf", bundle]))
		if int(run(MV, PackedStringArray([kept, bundle]))["code"]) != 0:
			_note("RIPRISTINO FALLITO: la copia precedente è rimasta in %s" % kept)
		return _fail(ERR_START, bundle)
	run(RM, PackedStringArray(["-rf", kept]))
	_note("installato in %s" % bundle)
	return {"ok": true, "error": "", "detail": ""}


## Riavvio: una seconda istanza parte dal bundle appena installato, poi il gioco
## in corso si chiude dalla porta normale (`Game.quit_game`), che è anche l'unica
## che chiede cosa fare del team.
static func relaunch(bundle: String) -> void:
	OS.create_process(OPEN, PackedStringArray(["-n", bundle]))


static func _find_app(dir: String) -> String:
	for name in DirAccess.get_directories_at(dir):
		if name.ends_with(".app"):
			return dir.path_join(name)
	return ""


static func _executable_in(app: String) -> String:
	var dir := app.path_join("Contents/MacOS")
	var names := DirAccess.get_files_at(dir)
	return dir.path_join(names[0]) if names.size() > 0 else ""


static func _fail(key: String, detail: String) -> Dictionary:
	_note("%s — %s" % [key, detail])
	return {"ok": false, "error": key, "detail": detail}
