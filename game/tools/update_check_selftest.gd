extends SceneTree
## Self-test headless dell'aggiornamento automatico.
## Esecuzione: godot --headless --path game --script res://tools/update_check_selftest.gd
##
## Qui si verifica la parte che nessuno vedrà mai fallire a schermo. Un
## aggiornamento sbagliato non disegna un pannello storto: installa il programma
## di qualcun altro, oppure declassa l'utente a una versione più vecchia, oppure
## non si fa vivo mai. Tre modi diversi di rompersi in silenzio.
##
## Quattro contratti:
##  1. si aggiorna solo IN AVANTI, e il confronto è numerico (alfabeticamente
##     "0.3.10" starebbe prima di "0.3.9" e l'avviso sparirebbe esattamente al
##     decimo rilascio della serie);
##  2. si installa da soli SOLO con una root indipendente dal canale: firma della
##     copia in uso su macOS; helper+trust root production locali su Windows;
##  3. non si va in rete quando non si deve: spento, senza finestra, in vetrina,
##     o già controllato oggi;
##  4. quello che arriva dalla rete non decide dove mandare il browser.
##
## Il tempo e l'ambiente sono passati esplicitamente: un test che legge
## l'orologio di sistema passa o fallisce a seconda di quando lo si esegue.

const ORA := 1785000000.0
const WindowsProtocol := preload("res://scripts/support/windows_update_protocol.gd")

## La forma dell'uscita di `codesign -dv --verbose=4` su un bundle firmato
## Developer ID e notarizzato — verificata sul pacchetto macOS della 0.3.1 il
## 2026-07-29. I nomi qui sono inventati: il test guarda la struttura, non
## l'identità.
const FIRMATO := """Executable=/Applications/Job Hunter Team.app/Contents/MacOS/Job Hunter Team
Identifier=ai.jobhunterteam.game
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20500 size=2048 flags=0x10000(runtime) hashes=60+7
Authority=Developer ID Application: Example Studio (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=ABCDE12345
Sealed Resources version=2 rules=13 files=42"""

## Firma ad-hoc: quello che produce `codesign -s -` — nessun team, nessuna
## autorità. È il caso di chi compila in casa, ed è il caso in cui NON si deve
## poter installare niente automaticamente.
const ADHOC := """Identifier=ai.jobhunterteam.game
Format=app bundle with Mach-O universal (x86_64 arm64)
Signature=adhoc
TeamIdentifier=not set"""

var _fails: Array[String] = []


func _init() -> void:
	_versioni()
	_release()
	_pacchetti()
	_protocollo_windows()
	_source_gate_windows()
	_ritmo()
	_firme()
	_percorsi()
	if _fails.is_empty():
		print("UPDATE-CHECK-TEST PASS")
		quit(0)
		return
	for failure in _fails:
		push_error("[update-test] " + failure)
	print("UPDATE-CHECK-TEST FAIL (%d problemi)" % _fails.size())
	quit(1)


func _check(name: String, condition: bool, detail: String = "") -> void:
	if not condition:
		_fails.append("%s — %s" % [name, detail])


# ── 1. Si aggiorna solo in avanti ────────────────────────────────────

func _versioni() -> void:
	var casi := [
		# [candidata, installata, è un aggiornamento?]
		["0.3.2", "0.3.1", true],
		["0.4.0", "0.3.9", true],
		["1.0.0", "0.9.9", true],
		# Il caso che il confronto alfabetico sbaglia, e lo sbaglia una volta
		# sola: al decimo rilascio della serie.
		["0.3.10", "0.3.9", true],
		["v0.3.2", "0.3.1", true],
		["0.3.1", "0.3.1", false],
		# Declassamenti: una release ritirata, o un tag rimesso indietro, non
		# devono poter riportare l'utente a una versione più vecchia.
		["0.3.0", "0.3.1", false],
		["0.3.9", "0.3.10", false],
		["0.9.9", "1.0.0", false],
		# Illeggibile da una parte o dall'altra: nel dubbio non si aggiorna.
		["latest", "0.3.1", false],
		["0.3", "0.3.1", false],
		["0.3.1.4", "0.3.1", false],
		["", "0.3.1", false],
		["0.3.2", "dev", true],
		# Prerelease: viene prima della finale con lo stesso numero, e la
		# finale è un aggiornamento rispetto alla sua prerelease.
		["0.4.0-beta.1", "0.4.0", false],
		["0.4.0", "0.4.0-beta.1", true],
		["0.4.0-beta.2", "0.4.0-beta.1", true],
		# Il build metadata non partecipa all'ordinamento.
		["0.3.1+build.7", "0.3.1", false],
	]
	for caso in casi:
		var got := UpdateCheck.is_newer(str(caso[0]), str(caso[1]))
		_check("versione", got == bool(caso[2]),
				"%s su %s → %s, atteso %s" % [caso[0], caso[1], got, caso[2]])


# ── 2. Cosa si accetta dalla risposta di GitHub ──────────────────────

func _release() -> void:
	var buona := {
		"tag_name": "v0.4.0",
		"html_url": "https://github.com/leopu00/job-hunter-team/releases/tag/v0.4.0",
		"draft": false, "prerelease": false,
		"assets": [{"name": "job-hunter-team.zip",
				"browser_download_url": "https://github.com/leopu00/job-hunter-team/releases/download/v0.4.0/job-hunter-team.zip"}],
	}
	var info := UpdateCheck.release_info(buona)
	_check("release valida", str(info.get("version", "")) == "0.4.0",
			"versione letta: %s" % info)
	_check("pagina della release", str(info.get("page", "")).contains("/releases/tag/v0.4.0"),
			str(info.get("page", "")))

	# Bozze e prerelease non passano. `releases/latest` non dovrebbe
	# restituirle, ma la regola sta qui e non nella fiducia.
	var bozza := buona.duplicate()
	bozza["draft"] = true
	_check("bozza rifiutata", UpdateCheck.release_info(bozza).is_empty(), "")
	var pre := buona.duplicate()
	pre["prerelease"] = true
	_check("prerelease rifiutata", UpdateCheck.release_info(pre).is_empty(), "")
	var senza_tag := buona.duplicate()
	senza_tag["tag_name"] = "nightly"
	_check("tag illeggibile rifiutato",
			UpdateCheck.release_info(senza_tag).is_empty(), "")
	_check("risposta vuota rifiutata", UpdateCheck.release_info({}).is_empty(), "")

	# La pagina finisce in OS.shell_open, cioè nel browser dell'utente, e
	# arriva dalla rete: se un giorno leggessimo un JSON diverso da quello che
	# crediamo, non deve poterci portare altrove.
	var altrove := buona.duplicate()
	altrove["html_url"] = "https://example.invalid/scarica-qui"
	_check("pagina fuori dal repository ignorata",
			str(UpdateCheck.release_info(altrove).get("page", "")) == UpdateCheck.RELEASES_PAGE,
			str(UpdateCheck.release_info(altrove).get("page", "")))


# ── 3. Solo i pacchetti firmati si installano da soli ────────────────

func _pacchetti() -> void:
	var win_sha := "b".repeat(64)
	var assets := [
		{"name": UpdateCheck.WINDOWS_ASSET, "size": 222,
			"digest": "sha256:" + win_sha,
			"browser_download_url": UpdateCheck._release_asset_url(
					"0.4.0", UpdateCheck.WINDOWS_ASSET)},
		{"name": UpdateCheck.MACOS_ASSET,
			"browser_download_url": UpdateCheck._release_asset_url(
					"0.4.0", UpdateCheck.MACOS_ASSET)},
		{"name": UpdateCheck.WINDOWS_MANIFEST_ASSET,
			"browser_download_url": UpdateCheck._release_asset_url(
					"0.4.0", UpdateCheck.WINDOWS_MANIFEST_ASSET)},
		{"name": UpdateCheck.WINDOWS_SIGNATURE_ASSET,
			"browser_download_url": UpdateCheck._release_asset_url(
					"0.4.0", UpdateCheck.WINDOWS_SIGNATURE_ASSET)},
	]
	_check("macOS: si scarica lo zip firmato",
			UpdateCheck.asset_url(assets, "macOS", "0.4.0").ends_with(
					UpdateCheck.MACOS_ASSET),
			UpdateCheck.asset_url(assets, "macOS", "0.4.0"))
	# ATTENZIONE a come si legge questo blocco: il payload qui sopra e' SINTETICO
	# e contiene manifest e firma, che nessuna release vera pubblica (#156). Cio'
	# che segue prova il contratto Windows DORMIENTE — come si comporterebbe se
	# un giorno lo si accendesse — non una funzione che oggi qualcuno usa. Il
	# comportamento di oggi e' quello provato da «release vera» piu sotto.
	var windows := UpdateCheck.asset_bundle(assets, "Windows", "0.4.0")
	_check("Windows (dormiente): pacchetto, manifest e firma sarebbero obbligatori",
			str(windows.get("package", "")).ends_with(UpdateCheck.WINDOWS_ASSET)
			and str(windows.get("manifest", "")).ends_with(
					UpdateCheck.WINDOWS_MANIFEST_ASSET)
			and str(windows.get("signature", "")).ends_with(
					UpdateCheck.WINDOWS_SIGNATURE_ASSET), str(windows))
	_check("Windows: senza root/helper production resta manuale",
			not UpdateCheck.can_self_install("Windows"), "")
	_check("0.3.5 -> 0.3.6 resta manuale anche con capability presenti",
			not UpdateCheck.windows_forward_allowed(
					"0.3.5", "0.3.6", "", true, true), "")
	_check("0.3.6 -> futura ammessa solo con helper e trust root",
			UpdateCheck.windows_forward_allowed(
					"0.3.6", "0.3.7", "0.3.6", true, true), "")
	for flags: Array in [[false, true], [true, false], [false, false]]:
		_check("Windows: capability incompleta fallisce chiusa",
				not UpdateCheck.windows_forward_allowed(
						"0.3.6", "0.3.7", "0.3.6",
						bool(flags[0]), bool(flags[1])), str(flags))
	for candidate: String in ["0.3.6", "0.3.5", "latest"]:
		_check("Windows: equal/downgrade/illeggibile rifiutato",
				not UpdateCheck.windows_forward_allowed(
						"0.3.6", candidate, "0.3.6", true, true), candidate)
	_check("Windows: high-water impedisce replay firmato",
			not UpdateCheck.windows_forward_allowed(
					"0.3.6", "0.3.7", "0.3.7", true, true), "")
	_check("Windows: soltanto una versione oltre high-water passa",
			UpdateCheck.windows_forward_allowed(
					"0.3.6", "0.3.8", "0.3.7", true, true), "")
	_check("Windows: high-water corrotto fallisce chiuso",
			not UpdateCheck.windows_forward_allowed(
					"0.3.6", "0.3.8", "latest", true, true), "")
	# Linux e i sistemi senza una strategia atomica restano manuali.
	for os_name: String in ["Linux", "Android", "Web"]:
		_check("%s: nessun pacchetto da installare" % os_name,
				UpdateCheck.asset_url(assets, os_name, "0.4.0") == "", os_name)
		_check("%s: niente installazione automatica" % os_name,
				not UpdateCheck.can_self_install(os_name), os_name)
	_check("macOS: installazione automatica ammessa",
			UpdateCheck.can_self_install("macOS"), "")
	# Host, repository, tag e nome sono tutti appuntati: HTTPS generico non basta.
	var ostile := assets.duplicate(true)
	ostile[0]["browser_download_url"] = "https://example.invalid/" \
			+ UpdateCheck.WINDOWS_ASSET
	_check("Windows: URL fuori repository rifiutato",
			UpdateCheck.asset_bundle(ostile, "Windows", "0.4.0").is_empty(), "")
	_check("Windows: tag URL diverso rifiutato",
			UpdateCheck.asset_bundle(assets, "Windows", "0.4.1").is_empty(), "")
	var senza_firma := assets.duplicate(true)
	senza_firma.pop_back()
	_check("Windows: firma detached mancante rifiutata",
			UpdateCheck.asset_bundle(senza_firma, "Windows", "0.4.0").is_empty(), "")
	# Il caso di OGGI, e non un caso di guasto: una release vera porta i binari
	# e i file di provenienza, mai il manifest firmato. Su quel payload Windows
	# non risolve alcun pacchetto, quindi `asset_url` resta vuoto e l'unica
	# strada e' la pagina della release. Se un giorno questa riga diventa rossa
	# significa che qualcuno ha acceso meta' percorso: si legge #156 prima di
	# «aggiustare» il test.
	var release_vera := [
		{"name": UpdateCheck.WINDOWS_ASSET, "size": 222,
			"digest": "sha256:" + win_sha,
			"browser_download_url": UpdateCheck._release_asset_url(
					"0.4.0", UpdateCheck.WINDOWS_ASSET)},
		{"name": UpdateCheck.MACOS_ASSET,
			"browser_download_url": UpdateCheck._release_asset_url(
					"0.4.0", UpdateCheck.MACOS_ASSET)},
		{"name": "SHA256SUMS"},
		{"name": "RELEASE-PROVENANCE.json"},
	]
	_check("Windows su una release vera: nessun pacchetto installabile",
			UpdateCheck.asset_url(release_vera, "Windows", "0.4.0") == "", "")
	_check("macOS su una release vera: lo zip firmato si risolve lo stesso",
			UpdateCheck.asset_url(release_vera, "macOS", "0.4.0").ends_with(
					UpdateCheck.MACOS_ASSET), "")
	_check("nessun asset", UpdateCheck.asset_url([], "macOS", "0.4.0") == "", "")

	# Il triplo confronto same-origin non compare piu nel contratto. La policy
	# deve restare chiusa anche se API digest, SHA256SUMS e provenance concordano.
	_check("same-origin non abilita Windows",
			not UpdateCheck.can_self_install("Windows") and win_sha.length() == 64, "")


# ── 4. Helper/ACK/recovery Windows ───────────────────────────────────

func _protocollo_windows() -> void:
	var nonce := "1".repeat(WindowsProtocol.NONCE_HEX_LENGTH)
	var old_sha := "a".repeat(WindowsProtocol.SHA256_HEX_LENGTH)
	var new_sha := "b".repeat(WindowsProtocol.SHA256_HEX_LENGTH)
	var manifest_sha := "c".repeat(WindowsProtocol.SHA256_HEX_LENGTH)
	var expected := {
		"nonce": nonce,
		"request_id": "request-7",
		"instance_id": "instance-3",
		"old_pid": 1234,
		"old_started": "1785000000000",
		"manifest_sha256": manifest_sha,
		"candidate_sha256": new_sha,
	}
	var ready := expected.duplicate(true)
	ready.merge({"schema": WindowsProtocol.SCHEMA,
		"type": WindowsProtocol.FRAME_READY, "ok": true})
	_check("ready helper lega nonce/processo/manifest/candidato",
			WindowsProtocol.ready_frame_matches(ready, expected), str(ready))
	for field: String in ["nonce", "request_id", "instance_id", "old_started",
			"manifest_sha256", "candidate_sha256"]:
		var stale := ready.duplicate(true)
		stale[field] = "fossile"
		_check("ready stale rifiutato: " + field,
				not WindowsProtocol.ready_frame_matches(stale, expected), str(stale))
	var pid_solo := ready.duplicate(true)
	pid_solo["old_started"] = "1784999999999"
	_check("PID riusato senza creation token rifiutato",
			not WindowsProtocol.ready_frame_matches(pid_solo, expected), "")
	var ready_extra := ready.duplicate(true)
	ready_extra["trusted"] = true
	_check("campo ready inatteso non crea autorita",
			not WindowsProtocol.ready_frame_matches(ready_extra, expected), "")

	var health := WindowsProtocol.health_frame(nonce, "0.3.7", new_sha)
	_check("ACK salute lega nonce/versione/hash",
			WindowsProtocol.health_frame_matches(health, nonce, "0.3.7", new_sha),
			str(health))
	_check("ACK salute di altra versione rifiutato",
			not WindowsProtocol.health_frame_matches(health, nonce, "0.3.8", new_sha), "")
	_check("nonce non canonico non produce ACK",
			WindowsProtocol.health_frame("../stage", "0.3.7", new_sha).is_empty(), "")
	_check("path ACK deriva solo da LOCALAPPDATA+nonce",
			WindowsProtocol.health_path("C:/Users/test/AppData/Local", nonce).ends_with(
					"Job Hunter Team/host-runtime/updates/%s/health.json" % nonce),
			WindowsProtocol.health_path("C:/Users/test/AppData/Local", nonce))
	_check("LOCALAPPDATA relativo/traversal rifiutato",
			WindowsProtocol.health_path("../Documents", nonce) == ""
			and WindowsProtocol.health_path("C:/Users/test/../Documents", nonce) == "", "")

	var journal := {
		"schema": WindowsProtocol.SCHEMA,
		"nonce": nonce,
		"installed_version": "0.3.6",
		"target_version": "0.3.7",
		"old_sha256": old_sha,
		"candidate_sha256": new_sha,
		"state": WindowsProtocol.JOURNAL_PREPARED,
	}
	_check("interruzione pre-switch non applica byte staged",
			WindowsProtocol.recovery_action(journal, old_sha, "")
					== WindowsProtocol.RECOVERY_DISCARD_UNAPPLIED, "")
	journal["state"] = WindowsProtocol.JOURNAL_CANDIDATE_INSTALLED
	_check("interruzione post-switch senza ACK ripristina old",
			WindowsProtocol.recovery_action(journal, new_sha, old_sha)
					== WindowsProtocol.RECOVERY_RESTORE_OLD, "")
	_check("old->new con ACK esatto completa",
			WindowsProtocol.recovery_action(journal, new_sha, old_sha, health)
					== WindowsProtocol.RECOVERY_COMMIT, "")
	var wrong_health := health.duplicate(true)
	wrong_health["exe_sha256"] = "d".repeat(64)
	_check("ACK errato non impedisce rollback",
			WindowsProtocol.recovery_action(journal, new_sha, old_sha, wrong_health)
					== WindowsProtocol.RECOVERY_RESTORE_OLD, "")
	var corrotto := journal.duplicate(true)
	corrotto["target_version"] = "0.3.5"
	_check("journal downgrade/corrotto fallisce chiuso",
			WindowsProtocol.recovery_action(corrotto, new_sha, old_sha)
					== WindowsProtocol.RECOVERY_FAIL_CLOSED, "")
	journal["state"] = WindowsProtocol.JOURNAL_COMMITTED
	_check("cleanup soltanto dopo commit e hash new",
			WindowsProtocol.recovery_action(journal, new_sha, old_sha, health)
					== WindowsProtocol.RECOVERY_CLEANUP_OWNED, "")


## Regressione sul wiring: la vecchia pseudo-attestazione same-origin non deve
## poter rientrare sotto un altro test verde, e finche manca una root production
## il servizio non deve avere alcun launcher Windows/apply raggiungibile.
func _source_gate_windows() -> void:
	var check_source := FileAccess.get_file_as_string(
			"res://scripts/support/update_check.gd")
	var service_source := FileAccess.get_file_as_string(
			"res://scripts/support/update_service.gd")
	var protocol_source := FileAccess.get_file_as_string(
			"res://scripts/support/windows_update_protocol.gd")
	_check("nessun claim attestazione dal triplo same-origin",
			"attest_windows_metadata" not in check_source
			and "PROVENANCE_SCHEMA" not in check_source
			and "tre fonti indipendenti" not in check_source, "")
	_check("asset URL vincolato alla versione candidata",
			"OS.get_name(), latest_version" in service_source, "")
	_check("defer service-owned viene persistito",
			"deferred_version" in service_source and "defer_until" in service_source
			and "UpdateService.defer()" in FileAccess.get_file_as_string(
					"res://scripts/ui/update_notice.gd"), "")
	_check("protocollo puro non puo lanciare apply",
			"OS.execute" not in protocol_source
			and "OS.create_process" not in protocol_source
			and "shell_open" not in protocol_source, "")
	_check("servizio Windows emette soltanto health ACK",
			"WindowsProtocol.health_frame" in service_source
			and "windows_update_helper" not in service_source, "")


# ── 5. Quando NON si va in rete ──────────────────────────────────────

func _ritmo() -> void:
	var base := {"env": "", "enabled": true, "headless": false,
			"showcase": false, "now": ORA, "last_check": 0.0}
	_check("primo avvio: si controlla",
			UpdateCheck.skip_reason(base) == "", UpdateCheck.skip_reason(base))

	var casi := [
		# [descrizione, campo cambiato, valore, motivo atteso]
		["spento dall'ambiente", "env", "0", UpdateCheck.SKIP_ENV],
		["spento dall'utente", "enabled", false, UpdateCheck.SKIP_OFF],
		["senza finestra", "headless", true, UpdateCheck.SKIP_HEADLESS],
		["in vetrina", "showcase", true, UpdateCheck.SKIP_SHOWCASE],
		["controllato un'ora fa", "last_check", ORA - 3600.0, UpdateCheck.SKIP_TODAY],
	]
	for caso in casi:
		var ctx := base.duplicate()
		ctx[caso[1]] = caso[2]
		_check(str(caso[0]), UpdateCheck.skip_reason(ctx) == str(caso[3]),
				"motivo: '%s'" % UpdateCheck.skip_reason(ctx))

	var ieri := base.duplicate()
	ieri["last_check"] = ORA - UpdateCheck.CHECK_EVERY_S - 1.0
	_check("passate 24 ore: si ricontrolla",
			UpdateCheck.skip_reason(ieri) == "", UpdateCheck.skip_reason(ieri))
	# Orologio andato indietro (fuso, batteria, ripristino): una data nel
	# futuro spegnerebbe l'avviso per tutto il tempo che manca a raggiungerla.
	var futuro := base.duplicate()
	futuro["last_check"] = ORA + 86400.0 * 30.0
	_check("data nel futuro: si controlla lo stesso",
			UpdateCheck.skip_reason(futuro) == "", UpdateCheck.skip_reason(futuro))
	# L'interruttore dell'ambiente vince su tutto, anche su un utente che ha
	# acceso il controllo: è la leva di chi distribuisce il gioco.
	var forzato := base.duplicate()
	forzato["env"] = "0"
	forzato["enabled"] = true
	_check("JHT_UPDATE_CHECK=0 vince",
			UpdateCheck.skip_reason(forzato) == UpdateCheck.SKIP_ENV, "")

	_check("defer persiste per la stessa versione",
			UpdateCheck.defer_active("0.3.7", "0.3.7", ORA + 3600.0, ORA), "")
	_check("versione nuova supera il defer",
			not UpdateCheck.defer_active("0.3.8", "0.3.7", ORA + 3600.0, ORA), "")
	_check("defer scaduto non diventa rifiuto permanente",
			not UpdateCheck.defer_active("0.3.7", "0.3.7", ORA, ORA), "")
	_check("versione defer malformata ignorata",
			not UpdateCheck.defer_active("latest", "latest", ORA + 3600.0, ORA), "")


# ── 5. Chi ha firmato il pacchetto ───────────────────────────────────

func _firme() -> void:
	var mio := UpdateCheck.signing_anchor(FIRMATO)
	_check("team letto", str(mio["team"]) == "ABCDE12345", str(mio))
	_check("certificato foglia letto",
			str(mio["authority"]) == "Developer ID Application: Example Studio (ABCDE12345)",
			str(mio))
	_check("firma Developer ID riconosciuta", UpdateCheck.is_developer_id(mio), str(mio))

	var adhoc := UpdateCheck.signing_anchor(ADHOC)
	_check("'not set' non è un team", str(adhoc["team"]) == "", str(adhoc))
	_check("firma ad-hoc rifiutata", not UpdateCheck.is_developer_id(adhoc), str(adhoc))
	_check("bundle non firmato rifiutato",
			not UpdateCheck.is_developer_id(UpdateCheck.signing_anchor("")), "")

	# Il cuore della cosa: un pacchetto notarizzato da qualcun altro passa
	# Gatekeeper senza una piega e resta il programma di qualcun altro.
	var altro := FIRMATO.replace("ABCDE12345", "ZZZZZ99999")
	_check("altro sviluppatore rifiutato",
			not UpdateCheck.anchors_match(mio, UpdateCheck.signing_anchor(altro)),
			altro)
	# Stesso team, certificato diverso (un secondo Developer ID dello stesso
	# account): non è la stessa firma e non passa.
	var stesso_team := FIRMATO.replace("Example Studio", "Example Studio 2")
	_check("certificato diverso rifiutato",
			not UpdateCheck.anchors_match(mio, UpdateCheck.signing_anchor(stesso_team)),
			stesso_team)
	_check("stessa firma accettata",
			UpdateCheck.anchors_match(mio, UpdateCheck.signing_anchor(FIRMATO)), "")
	# Senza ancora non si installa: se la copia in esecuzione non è firmata
	# (compilata in casa, avviata dall'editor) non c'è niente a cui appuntare
	# il pacchetto nuovo, e anche un pacchetto perfetto non deve passare.
	_check("copia in uso non firmata: nessuna installazione",
			not UpdateCheck.anchors_match(adhoc, mio), "")
	# Team dalla forma sbagliata: dieci caratteri alfanumerici maiuscoli.
	for finto: String in ["", "ABCDE", "ABCDE123456", "abcde12345", "ABCDE-1234"]:
		_check("team malformato rifiutato",
				not UpdateCheck.is_developer_id(
						{"team": finto, "authority": "Developer ID Application: X (X)"}),
				finto)

	_check("requisito per codesign",
			UpdateCheck.team_requirement("ABCDE12345")
					== 'anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345"',
			UpdateCheck.team_requirement("ABCDE12345"))


# ── 6. Dove si trova il bundle da sostituire ─────────────────────────

func _percorsi() -> void:
	_check("bundle installato",
			UpdateCheck.bundle_path(
					"/Applications/Job Hunter Team.app/Contents/MacOS/Job Hunter Team")
					== "/Applications/Job Hunter Team.app", "")
	_check("bundle fuori da Applications",
			UpdateCheck.bundle_path(
					"/Users/x/Downloads/Job Hunter Team.app/Contents/MacOS/gioco")
					== "/Users/x/Downloads/Job Hunter Team.app", "")
	_check("percorso già bundle",
			UpdateCheck.bundle_path("/Applications/Job Hunter Team.app")
					== "/Applications/Job Hunter Team.app", "")
	# Dall'editor, o da un export Windows/Linux, non c'è nessun bundle da
	# sostituire e l'installazione automatica non deve nemmeno essere offerta.
	for fuori: String in ["/usr/local/bin/godot", "C:/Programmi/jht/job-hunter-team.exe",
			"/home/x/jht/job-hunter-team.x86_64", "", "/"]:
		_check("nessun bundle", UpdateCheck.bundle_path(fuori) == "", fuori)
