class_name UpdateCheck
## Le regole dell'aggiornamento: cosa è più recente, cosa si può scaricare,
## quando è lecito chiedere alla rete e — la parte che conta — con quale
## identità deve essere firmato un pacchetto perché sia lecito installarlo.
##
## Solo logica: nessun nodo, nessun autoload, nessuna chiamata di sistema. Gira
## sotto `godot --headless --script`, dove gli autoload non esistono, ed è per
## questo che il self-test può interrogare ogni singola regola — comprese
## quelle di sicurezza — senza rete, senza finestra e senza un Mac firmato.

## Il repository da cui escono i binari. Le release sono l'unico canale di
## distribuzione: il sito non serve gli eseguibili desktop.
const REPO := "leopu00/job-hunter-team"
## L'API pubblica di GitHub: nessun token, nessuna autenticazione. Restituisce
## la release più recente NON bozza e NON prerelease, con `tag_name`, `html_url`
## e l'elenco `assets` (ognuno con `name` e `browser_download_url`).
const API_LATEST := "https://api.github.com/repos/leopu00/job-hunter-team/releases/latest"
## La pagina da aprire nel browser quando l'installazione non la facciamo noi.
const RELEASES_PAGE := "https://github.com/leopu00/job-hunter-team/releases/latest"
const WINDOWS_ASSET := "job-hunter-team-windows-x64-portable.exe"
const MACOS_ASSET := "job-hunter-team.zip"
## Contratto futuro Windows: il manifest sara firmato fuori dal canale GitHub
## e verificato con una root gia incorporata nella 0.3.6. La sola presenza di
## questi asset non abilita mai l'installazione.
const WINDOWS_MANIFEST_ASSET := "RELEASE-MANIFEST.json"
const WINDOWS_SIGNATURE_ASSET := "RELEASE-MANIFEST.json.sig"
const WINDOWS_AUTO_BASELINE := "0.3.6"

## Un controllo al giorno. Non è una misura di rete — la richiesta è una sola e
## pesa qualche kilobyte: è una misura di rispetto. Un avviso che può ricomparire
## dieci volte al giorno viene chiuso senza leggerlo, ed è il modo più rapido per
## rendere invisibile proprio la versione che correggeva qualcosa di importante.
const CHECK_EVERY_S := 86400.0

## Dove vivono l'interruttore e la data dell'ultimo controllo. In `user://`, cioè
## nei dati dell'applicazione: sopravvive all'aggiornamento del bundle.
const CONFIG_PATH := "user://update.cfg"

## Perché un controllo non è partito. Sono stringhe da log, non da interfaccia:
## all'utente non si dice niente: il silenzio È la risposta giusta.
const SKIP_ENV := "spento da JHT_UPDATE_CHECK=0"
const SKIP_OFF := "spento dall'utente"
const SKIP_HEADLESS := "nessuna finestra in cui mostrarlo"
const SKIP_SHOWCASE := "modalità vetrina o banco di prova"
const SKIP_TODAY := "già controllato nelle ultime 24 ore"


## [major, minor, patch, prerelease] oppure [] se non è una versione leggibile.
## La "v" del tag è tollerata, il build metadata (+…) viene ignorato perché non
## partecipa all'ordinamento.
static func parse_version(text: String) -> Array:
	var raw := text.strip_edges()
	if raw.begins_with("v") or raw.begins_with("V"):
		raw = raw.substr(1)
	var plus := raw.find("+")
	if plus >= 0:
		raw = raw.substr(0, plus)
	var pre := ""
	var dash := raw.find("-")
	if dash >= 0:
		pre = raw.substr(dash + 1)
		raw = raw.substr(0, dash)
	var parts := raw.split(".")
	if parts.size() != 3:
		return []
	var out: Array = []
	for part in parts:
		if part == "" or not part.is_valid_int():
			return []
		out.append(int(part))
	out.append(pre)
	return out


## -1 se `a` viene prima di `b`, 0 se sono la stessa versione, 1 se viene dopo.
##
## Il confronto è NUMERICO campo per campo: alfabeticamente "0.3.10" starebbe
## prima di "0.3.9" e l'aggiornamento non arriverebbe mai, esattamente al
## decimo rilascio della serie. Una versione illeggibile vale meno di qualunque
## versione leggibile: nel dubbio non si aggiorna.
static func compare(a: String, b: String) -> int:
	var va := parse_version(a)
	var vb := parse_version(b)
	if va.is_empty() and vb.is_empty():
		return 0
	if va.is_empty():
		return -1
	if vb.is_empty():
		return 1
	for i in 3:
		if int(va[i]) != int(vb[i]):
			return -1 if int(va[i]) < int(vb[i]) else 1
	var pa := str(va[3])
	var pb := str(vb[3])
	if pa == pb:
		return 0
	# "0.4.0-beta.1" viene PRIMA di "0.4.0": la prerelease precede la finale.
	if pa == "":
		return 1
	if pb == "":
		return -1
	return -1 if pa < pb else 1


## L'unica domanda che conta all'avvio. Un tag più VECCHIO di quello installato
## non deve muovere niente: una release ritirata, o un orologio sbagliato da
## qualche parte, non devono poter proporre un declassamento.
static func is_newer(candidate: String, current: String) -> bool:
	return compare(candidate, current) > 0


## Il pezzo di risposta GitHub che ci serve, o {} se non è utilizzabile.
##
## Bozze e prerelease non passano: `releases/latest` non dovrebbe restituirle,
## ma la regola sta qui e non nella fiducia. E la pagina da aprire nel browser
## si accetta solo se è su github.com — è un URL che arriva dalla rete e finisce
## in `OS.shell_open`, cioè nel browser dell'utente: se un giorno qualcuno
## riuscisse a farci leggere un JSON diverso, non ci porterebbe comunque altrove.
static func release_info(payload: Dictionary) -> Dictionary:
	if bool(payload.get("draft", false)) or bool(payload.get("prerelease", false)):
		return {}
	var tag := str(payload.get("tag_name", ""))
	if parse_version(tag).is_empty():
		return {}
	var page := str(payload.get("html_url", ""))
	if not page.begins_with("https://github.com/%s/" % REPO):
		page = RELEASES_PAGE
	var raw: Variant = payload.get("assets", [])
	return {
		"version": tag.trim_prefix("v").trim_prefix("V"),
		"tag": "v" + tag.trim_prefix("v").trim_prefix("V"),
		"page": page,
		"assets": raw if raw is Array else [],
	}


## I file necessari all'installazione, accettati soltanto dalla release/tag
## attesi e con nomi fissi. Su Windows il binario da solo NON basta: manifest e
## firma detached sono inseparabili. Trovarli non li rende attendibili: il
## helper deve verificare la firma con la root locale prima dell'apply.
static func asset_bundle(assets: Array, os_name: String, version: String) -> Dictionary:
	if os_name not in ["macOS", "Windows"] or parse_version(version).is_empty():
		return {}
	var package_name := MACOS_ASSET if os_name == "macOS" else WINDOWS_ASSET
	var required := [package_name]
	if os_name == "Windows":
		required.append_array([WINDOWS_MANIFEST_ASSET, WINDOWS_SIGNATURE_ASSET])
	var found := {}
	var required_casefold := {}
	var seen_required := {}
	for required_name: String in required:
		required_casefold[required_name.to_lower()] = required_name
	for item in assets:
		if not (item is Dictionary):
			continue
		var name := str(item.get("name", ""))
		var folded := name.to_lower()
		if not required_casefold.has(folded):
			continue
		# GitHub tratta i nomi come stringhe, Windows no: una coppia che cambia
		# soltanto maiuscole/minuscole e un duplicato identico sono entrambi
		# ambigui. Non scegliamo mai "il primo" da dati remoti.
		var canonical_name := str(required_casefold[folded])
		if name != canonical_name or seen_required.has(folded):
			return {}
		seen_required[folded] = true
		var expected_url := _release_asset_url(version, name)
		if str(item.get("browser_download_url", "")) != expected_url:
			continue
		found[canonical_name] = item
	for name: String in required:
		if not found.has(name):
			return {}
	var out := {
		"package": str(found[package_name].get("browser_download_url", "")),
		"package_name": package_name,
		"package_size": int(found[package_name].get("size", 0)),
		"package_digest": str(found[package_name].get("digest", "")),
	}
	if os_name == "Windows":
		out["manifest"] = str(found[WINDOWS_MANIFEST_ASSET].get(
				"browser_download_url", ""))
		out["signature"] = str(found[WINDOWS_SIGNATURE_ASSET].get(
				"browser_download_url", ""))
	return out


static func asset_url(assets: Array, os_name: String, version: String = "") -> String:
	return str(asset_bundle(assets, os_name, version).get("package", ""))


## Stato effettivo, non roadmap. macOS ha gia un'ancora Developer ID. Windows
## resta manuale finche root production e helper non sono entrambi distribuiti.
static func can_self_install(os_name: String) -> bool:
	return os_name == "macOS"


## La 0.3.5 e precedenti non contengono il verifier: il salto alla 0.3.6 resta
## manuale una tantum. Questa policy governa soltanto 0.3.6 -> versioni future.
## Il helper riverifica sempre la firma in proprio e non si fida di questi flag.
static func windows_forward_allowed(installed: String, candidate: String,
		highest_committed: String, helper_ready: bool, trust_ready: bool) -> bool:
	if compare(installed, WINDOWS_AUTO_BASELINE) < 0 or not helper_ready \
			or not trust_ready:
		return false
	if highest_committed != "" and parse_version(highest_committed).is_empty():
		return false
	var floor_version := installed
	if highest_committed != "" and compare(highest_committed, floor_version) > 0:
		floor_version = highest_committed
	return is_newer(candidate, floor_version)


static func _release_asset_url(version: String, name: String) -> String:
	return "https://github.com/%s/releases/download/v%s/%s" % [REPO, version, name]


## "Piu tardi" sopravvive al riavvio, ma non nasconde una versione diversa e
## non diventa un rifiuto permanente. Dopo un giorno la stessa release torna
## visibile al successivo controllo.
static func defer_active(candidate: String, deferred_version: String,
		defer_until: float, now: float) -> bool:
	return not parse_version(candidate).is_empty() and candidate == deferred_version \
			and defer_until > now


## Perché NON si contatta la rete adesso, o "" se si può procedere.
##
## `ctx` arriva già letto dal servizio (env, config, DisplayServer, orologio):
## così ogni ramo di questa decisione è verificabile senza nulla di tutto ciò.
static func skip_reason(ctx: Dictionary) -> String:
	if str(ctx.get("env", "")) == "0":
		return SKIP_ENV
	if not bool(ctx.get("enabled", true)):
		return SKIP_OFF
	# Senza finestra non c'è nessuno a cui mostrare l'avviso: la prova di avvio
	# di un pacchetto appena scaricato gira proprio così, e non deve andare in
	# rete a sua volta.
	if bool(ctx.get("headless", false)):
		return SKIP_HEADLESS
	# Vetrina, scatto di verifica, banco di prova: il gioco è a schermo per
	# mostrare altro, e una fascia "c'è una versione nuova" nel mezzo è rumore.
	if bool(ctx.get("showcase", false)):
		return SKIP_SHOWCASE
	var now := float(ctx.get("now", 0.0))
	var last := float(ctx.get("last_check", 0.0))
	# `last > now` = l'orologio è andato indietro (fuso, batteria, ripristino):
	# si controlla, altrimenti quella data nel futuro spegnerebbe l'avviso per
	# tutto il tempo che manca a raggiungerla.
	if last > 0.0 and last <= now and now - last < CHECK_EVERY_S:
		return SKIP_TODAY
	return ""


## Il bundle .app che contiene l'eseguibile in esecuzione, o "" se non siamo
## dentro un bundle — avvio dall'editor, export Windows o Linux, binario estratto
## a mano da qualche parte. Senza bundle non c'è niente da sostituire.
static func bundle_path(executable_path: String) -> String:
	var path := executable_path.strip_edges()
	# .../Contents/MacOS/<bin> → tre risalite, più il caso in cui ci venga già
	# passato il bundle.
	for _step in 4:
		if path == "" or path == "/":
			return ""
		if path.ends_with(".app"):
			return path
		path = path.get_base_dir()
	return ""


## Chi ha firmato un bundle, letto dall'uscita di `codesign -dv --verbose=4`.
##
## `authority` è la PRIMA riga `Authority=`, cioè il certificato foglia — quello
## che identifica lo sviluppatore. Le due successive sono l'intermedio Apple e la
## root, identiche per chiunque abbia un Developer ID, e confrontarle non
## direbbe niente.
static func signing_anchor(codesign_output: String) -> Dictionary:
	var out := {"team": "", "authority": ""}
	for raw_line in codesign_output.split("\n"):
		var line := raw_line.strip_edges()
		if line.begins_with("TeamIdentifier=") and str(out["team"]) == "":
			var team := line.substr("TeamIdentifier=".length()).strip_edges()
			# codesign scrive letteralmente "not set" per le firme ad-hoc.
			out["team"] = "" if team == "not set" else team
		elif line.begins_with("Authority=") and str(out["authority"]) == "":
			out["authority"] = line.substr("Authority=".length()).strip_edges()
	return out


## Un'ancora utilizzabile: firma Developer ID con un team identifier vero.
##
## Una copia firmata ad-hoc, o non firmata affatto — compilata in casa, avviata
## dall'editor, o già manomessa — non è un'ancora. E senza ancora l'installazione
## automatica NON parte: si apre la pagina della release e decide l'utente.
static func is_developer_id(anchor: Dictionary) -> bool:
	return _valid_team(str(anchor.get("team", ""))) \
			and str(anchor.get("authority", "")).begins_with("Developer ID Application:")


## Dieci caratteri alfanumerici maiuscoli: il formato dei team identifier Apple.
static func _valid_team(team: String) -> bool:
	if team.length() != 10:
		return false
	for i in team.length():
		var c := team[i]
		if not ((c >= "A" and c <= "Z") or (c >= "0" and c <= "9")):
			return false
	return true


## L'aggiornamento deve essere firmato da CHI HA FIRMATO la copia che stai già
## usando.
##
## La notarizzazione da sola non basta e non è pignoleria: `spctl` dice "Apple ha
## esaminato questo programma e non ci ha trovato malware", non "questo è il tuo
## programma". Apple notarizza centinaia di migliaia di applicazioni ogni anno;
## un pacchetto notarizzato da qualcun altro passerebbe Gatekeeper senza una
## piega e resterebbe il programma di qualcun altro, installato al posto di
## questo. Il confronto è sul team E sul certificato foglia.
static func anchors_match(current: Dictionary, candidate: Dictionary) -> bool:
	if not is_developer_id(current) or not is_developer_id(candidate):
		return false
	return str(current["team"]) == str(candidate["team"]) \
			and str(current["authority"]) == str(candidate["authority"])


## Lo stesso vincolo di `anchors_match`, ma scritto nella lingua che `codesign
## -R` sa verificare: catena Apple e certificato foglia dello stesso team. La
## differenza è dove viene applicato — sul certificato dentro la firma, non sul
## testo che codesign stampa per descriverlo. Le due prove si fanno entrambe.
static func team_requirement(team: String) -> String:
	return 'anchor apple generic and certificate leaf[subject.OU] = "%s"' % team
