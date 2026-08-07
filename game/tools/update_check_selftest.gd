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
const WindowsClient := preload("res://scripts/support/windows_update_client.gd")
const WindowsVerifier := preload("res://scripts/support/windows_update_verifier.gd")

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
	_verifier_windows()
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
		{"name": UpdateCheck.WINDOWS_HELPER_ASSET,
			"browser_download_url": UpdateCheck._release_asset_url(
					"0.4.0", UpdateCheck.WINDOWS_HELPER_ASSET)},
	]
	_check("macOS: si scarica lo zip firmato",
			UpdateCheck.asset_url(assets, "macOS", "0.4.0").ends_with(
					UpdateCheck.MACOS_ASSET),
			UpdateCheck.asset_url(assets, "macOS", "0.4.0"))
	var windows := UpdateCheck.asset_bundle(assets, "Windows", "0.4.0")
	_check("Windows: pacchetto, helper, manifest e firma detached obbligatori",
			str(windows.get("package", "")).ends_with(UpdateCheck.WINDOWS_ASSET)
			and str(windows.get("manifest", "")).ends_with(
					UpdateCheck.WINDOWS_MANIFEST_ASSET)
			and str(windows.get("signature", "")).ends_with(
					UpdateCheck.WINDOWS_SIGNATURE_ASSET)
			and str(windows.get("helper", "")).ends_with(
					UpdateCheck.WINDOWS_HELPER_ASSET), str(windows))
	_check("Windows: strategia esiste ma senza root/helper resta manuale",
			UpdateCheck.can_self_install("Windows")
			and not UpdateCheck.windows_forward_allowed(
					"0.3.6", "0.3.7", "", false, false), "")
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
	var senza_firma := assets.filter(func(item: Dictionary) -> bool:
		return str(item.get("name", "")) != UpdateCheck.WINDOWS_SIGNATURE_ASSET)
	_check("Windows: firma detached mancante rifiutata",
			UpdateCheck.asset_bundle(senza_firma, "Windows", "0.4.0").is_empty(), "")
	var duplicato := assets.duplicate(true)
	duplicato.append(assets[0].duplicate(true))
	_check("Windows: asset richiesto duplicato rifiutato",
			UpdateCheck.asset_bundle(duplicato, "Windows", "0.4.0").is_empty(), "")
	var primo_ostile := assets.duplicate(true)
	var doppio_ostile: Dictionary = assets[0].duplicate(true)
	doppio_ostile["browser_download_url"] = "https://example.invalid/app.exe"
	primo_ostile.push_front(doppio_ostile)
	_check("Windows: primo duplicato ostile non viene saltato",
			UpdateCheck.asset_bundle(primo_ostile, "Windows", "0.4.0").is_empty(), "")
	var collisione_case := assets.duplicate(true)
	var quasi_firma: Dictionary = assets[-1].duplicate(true)
	quasi_firma["name"] = str(quasi_firma["name"]).to_upper()
	collisione_case.append(quasi_firma)
	_check("Windows: collisione case-insensitive rifiutata",
			UpdateCheck.asset_bundle(
					collisione_case, "Windows", "0.4.0").is_empty(), "")
	_check("nessun asset", UpdateCheck.asset_url([], "macOS", "0.4.0") == "", "")

	# Il triplo confronto same-origin non compare piu nel contratto. La policy
	# deve restare chiusa anche se API digest, SHA256SUMS e provenance concordano.
	_check("same-origin non abilita Windows",
			UpdateCheck.can_self_install("Windows") and win_sha.length() == 64
			and not UpdateCheck.windows_forward_allowed(
					"0.3.6", "0.3.7", "", false, false), "")


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
		"manifest_sha256": manifest_sha,
		"candidate_sha256": new_sha,
	}
	var ready := expected.duplicate(true)
	ready.merge({"schema": WindowsProtocol.SCHEMA,
		"type": WindowsProtocol.FRAME_READY, "ok": true,
		"old_started": "1785000000000"})
	var ready_wire: Dictionary = JSON.parse_string(JSON.stringify(ready))
	_check("ready JSON reale lega nonce/processo/manifest/candidato",
			WindowsProtocol.ready_frame_matches(ready_wire, expected), str(ready_wire))
	for field: String in ["nonce", "request_id", "instance_id", "old_started",
			"manifest_sha256", "candidate_sha256"]:
		var stale := ready_wire.duplicate(true)
		stale[field] = "fossile"
		_check("ready stale rifiutato: " + field,
				not WindowsProtocol.ready_frame_matches(stale, expected), str(stale))
	var pid_solo := ready_wire.duplicate(true)
	pid_solo["old_started"] = "non-decimale"
	_check("creation token helper malformato rifiutato",
			not WindowsProtocol.ready_frame_matches(pid_solo, expected), "")
	var ready_extra := ready_wire.duplicate(true)
	ready_extra["trusted"] = true
	_check("campo ready inatteso non crea autorita",
			not WindowsProtocol.ready_frame_matches(ready_extra, expected), "")
	var ready_coerced := ready_wire.duplicate(true)
	ready_coerced["schema"] = "1"
	ready_coerced["ok"] = "false"
	ready_coerced["old_pid"] = "1234"
	_check("tipi JSON ready non vengono coercizzati",
			not WindowsProtocol.ready_frame_matches(ready_coerced, expected), "")

	var exe_path := "C:/Program Files/Job Hunter Team/job-hunter-team.exe"
	var started := "638901234567890123"
	var health := WindowsProtocol.health_frame(
			nonce, "0.3.7", exe_path, new_sha, 5678, started)
	var health_wire: Dictionary = JSON.parse_string(JSON.stringify(health))
	_check("ACK salute lega nonce/versione/hash",
			WindowsProtocol.health_frame_matches(health_wire, nonce, "0.3.7", new_sha,
					exe_path, 5678, started),
			str(health_wire))
	_check("ACK salute di altra versione rifiutato",
			not WindowsProtocol.health_frame_matches(health_wire, nonce, "0.3.8", new_sha), "")
	var malformed_health := {"schema": 1.0, "type": WindowsProtocol.FRAME_HEALTHY,
			"nonce": "bad", "version": "latest", "exe_sha256": "bad"}
	_check("ACK coincidente ma malformato rifiutato",
			not WindowsProtocol.health_frame_matches(
					malformed_health, "bad", "latest", "bad"), "")
	_check("nonce non canonico non produce ACK",
			WindowsProtocol.health_frame(
					"../stage", "0.3.7", exe_path, new_sha, 5678, started).is_empty(), "")
	for field: String in ["exe_path", "pid", "process_started_utc_ticks"]:
		var mismatch := health_wire.duplicate(true)
		mismatch[field] = "wrong" if field != "pid" else 9999.0
		_check("ACK health mismatch rifiutato: " + field,
				not WindowsProtocol.health_frame_matches(mismatch, nonce, "0.3.7",
						new_sha, exe_path, 5678, started), "")
	var capability := "C:/Users/test/AppData/Local/Job Hunter Team/host-runtime" \
			+ "/%s/health.json" % nonce
	_check("path ACK e una capability esplicita legata al nonce",
			WindowsProtocol.health_capability_path(capability, nonce) == capability,
			capability)
	_check("capability relativa/traversal/nonce errato rifiutata",
			WindowsProtocol.health_capability_path("../Documents/health.json", nonce) == ""
			and WindowsProtocol.health_capability_path(
					"C:/runtime/updates/../%s/health.json" % nonce, nonce) == ""
			and WindowsProtocol.health_capability_path(capability, "2".repeat(32)) == "", "")

	var journal_native := {
		"schema": WindowsProtocol.SCHEMA,
		"nonce": nonce,
		"installed_version": "0.3.6",
		"target_version": "0.3.7",
		"old_sha256": old_sha,
		"candidate_sha256": new_sha,
		"state": WindowsProtocol.JOURNAL_PREPARED,
	}
	var journal: Dictionary = JSON.parse_string(JSON.stringify(journal_native))
	_check("interruzione pre-switch non applica byte staged",
			WindowsProtocol.recovery_action(journal, old_sha, "")
					== WindowsProtocol.RECOVERY_DISCARD_UNAPPLIED, "")
	journal["state"] = WindowsProtocol.JOURNAL_CANDIDATE_INSTALLED
	_check("interruzione post-switch senza ACK ripristina old",
			WindowsProtocol.recovery_action(journal, new_sha, old_sha)
					== WindowsProtocol.RECOVERY_RESTORE_OLD, "")
	_check("old->new con ACK esatto completa",
			WindowsProtocol.recovery_action(journal, new_sha, old_sha, health_wire)
					== WindowsProtocol.RECOVERY_COMMIT, "")
	var wrong_health := health_wire.duplicate(true)
	wrong_health["exe_sha256"] = "d".repeat(64)
	_check("ACK errato non impedisce rollback",
			WindowsProtocol.recovery_action(journal, new_sha, old_sha, wrong_health)
					== WindowsProtocol.RECOVERY_RESTORE_OLD, "")
	var corrotto := journal.duplicate(true)
	corrotto["target_version"] = "0.3.5"
	_check("journal downgrade/corrotto fallisce chiuso",
			WindowsProtocol.recovery_action(corrotto, new_sha, old_sha)
					== WindowsProtocol.RECOVERY_FAIL_CLOSED, "")
	var journal_coerced := journal.duplicate(true)
	journal_coerced["schema"] = "1"
	_check("tipi JSON journal non vengono coercizzati",
			WindowsProtocol.recovery_action(journal_coerced, new_sha, old_sha)
					== WindowsProtocol.RECOVERY_FAIL_CLOSED, "")
	var stesso_hash := journal.duplicate(true)
	stesso_hash["old_sha256"] = new_sha
	_check("old e candidate identici rifiutati",
			WindowsProtocol.recovery_action(stesso_hash, new_sha, new_sha)
					== WindowsProtocol.RECOVERY_FAIL_CLOSED, "")
	journal["state"] = WindowsProtocol.JOURNAL_COMMITTED
	_check("cleanup soltanto dopo commit e hash new",
			WindowsProtocol.recovery_action(journal, new_sha, old_sha, health_wire)
					== WindowsProtocol.RECOVERY_CLEANUP_OWNED, "")

	var result := {"schema": 1, "ok": true, "phase": "ready",
			"code": "verified", "nonce": nonce, "rolled_back": false}
	_check("result helper exact accettato",
			WindowsProtocol.result_frame_matches(result, nonce), str(result))
	for field: String in ["schema", "ok", "phase", "code", "nonce", "rolled_back"]:
		var invalid := result.duplicate(true)
		invalid.erase(field)
		_check("result missing rifiutato: " + field,
				not WindowsProtocol.result_frame_matches(invalid, nonce), "")
	var coerced_result := result.duplicate(true)
	coerced_result["rolled_back"] = "false"
	_check("result bool non coercizzato",
			not WindowsProtocol.result_frame_matches(coerced_result, nonce), "")
	var mismatched_result := result.duplicate(true)
	mismatched_result["phase"] = "committed"
	_check("result fase/codice incoerenti rifiutati",
			not WindowsProtocol.result_frame_matches(mismatched_result, nonce), "")

	var fake_plan := {
		"installed_helper": "C:\\Program Files\\Job Hunter Team\\jht-windows-update.ps1",
		"target": "C:\\Program Files\\Job Hunter Team\\job-hunter-team.exe",
		"candidate": "C:\\Program Files\\Job Hunter Team\\.candidate.exe",
		"candidate_helper": "C:\\runtime\\jht-windows-update.ps1",
		"installed_manifest": "C:\\Program Files\\Job Hunter Team\\RELEASE-MANIFEST.json",
		"installed_signature": "C:\\Program Files\\Job Hunter Team\\RELEASE-MANIFEST.json.sig",
		"candidate_manifest": "C:\\runtime\\RELEASE-MANIFEST.json",
		"candidate_signature": "C:\\runtime\\RELEASE-MANIFEST.json.sig",
		"state_root": "C:\\runtime", "nonce": nonce,
	}
	var argv := WindowsClient.helper_argv("Verify", fake_plan, 1234,
			"request-7", "instance-3")
	_check("helper argv usa -File e rispetta ExecutionPolicy",
			"-File" in argv and "-ExecutionPolicy" not in argv and "Bypass" not in argv,
			str(argv))
	for boundary: String in ["swap_intent", "candidate_installed",
			"metadata_installed", "floor_intent", "helper_intent"]:
		_check("reboot entra in Recover al boundary " + boundary,
				WindowsClient.pending_boot_requires_recovery(
						"0.3.7", "0.3.7", true, {}, nonce), boundary)
	_check("READY verificato senza apply si ricostruisce, non fa recovery",
			not WindowsClient.pending_boot_requires_recovery(
					"0.3.6", "0.3.7", true, result, nonce), "")
	_check("download firmato rifiuta short/oversize/zero",
			WindowsClient.download_size_valid(384, 384, 384)
			and not WindowsClient.download_size_valid(383, 384, 384)
			and not WindowsClient.download_size_valid(385, 384, 384)
			and not WindowsClient.download_size_valid(0, 65536), "")


# ── 5. Firma e binding manifest Windows ──────────────────────────────

func _verifier_windows() -> void:
	# Chiave effimera generata dal selftest: nessun PEM/fingerprint di test viene
	# scritto nel repository o incorporato nel prodotto.
	var crypto := Crypto.new()
	var private_key := crypto.generate_rsa(3072)
	_check("selftest: RSA-3072 generata", private_key != null, "")
	if private_key == null:
		return
	var public_pem := private_key.save_to_string(true)
	var public_der := _test_spki_der(public_pem)
	var fingerprint := WindowsVerifier.sha256(public_der).hex_encode()
	var manifest := _test_manifest(fingerprint)
	var raw := _canonical_manifest_bytes(manifest)
	var signature := _test_sign(raw, private_key)
	var context := _test_manifest_context()

	var verified := WindowsVerifier.verify_for_test(
			raw, signature, public_pem, fingerprint, context)
	_check("manifest RSA-3072 raw verificato prima del parse",
			bool(verified.get("ok", false))
			and str(verified.get("version", "")) == "0.3.7"
			and int(verified.get("sequence", 0)) \
					== WindowsVerifier.version_sequence("0.3.7"),
			"%s raw=%s" % [verified, raw.get_string_from_ascii()])
	var signed_artifacts: Dictionary = verified.get("artifacts", {})
	var signed_app: Dictionary = signed_artifacts.get(WindowsVerifier.ROLE_DESKTOP, {})
	_check("byte staged coincidono solo con size+SHA firmati",
			WindowsVerifier.staged_artifact_matches(signed_app,
					UpdateCheck.WINDOWS_ASSET, 222, "b".repeat(64))
			and not WindowsVerifier.staged_artifact_matches(signed_app,
					UpdateCheck.WINDOWS_ASSET, 221, "b".repeat(64))
			and not WindowsVerifier.staged_artifact_matches(signed_app,
					UpdateCheck.WINDOWS_ASSET, 222, "e".repeat(64)), "")

	_check("manifest unsigned rifiutato",
			str(WindowsVerifier.verify_for_test(raw, PackedByteArray(), public_pem,
					fingerprint, context).get("error", "")) == WindowsVerifier.ERR_SIGNATURE,
			"")
	for length: int in [383, 385]:
		_check("firma raw di lunghezza errata rifiutata",
				str(WindowsVerifier.verify_for_test(raw, _bytes(length, 1), public_pem,
						fingerprint, context).get("error", "")) \
						== WindowsVerifier.ERR_SIGNATURE, str(length))

	var wrong_key := crypto.generate_rsa(3072)
	var wrong_pem := wrong_key.save_to_string(true)
	var wrong_fingerprint := WindowsVerifier.sha256(
			_test_spki_der(wrong_pem)).hex_encode()
	_check("firma wrong-key rifiutata",
			str(WindowsVerifier.verify_for_test(raw, signature, wrong_pem, wrong_fingerprint,
					context).get("error", "")) == WindowsVerifier.ERR_SIGNATURE, "")
	_check("fingerprint SPKI hard-pinned",
			str(WindowsVerifier.verify_for_test(raw, signature, public_pem,
					"f".repeat(64), context).get("error", "")) == WindowsVerifier.ERR_ROOT, "")

	var tampered := raw.get_string_from_ascii().replace(
			'"channel":"stable"', '"channel":"steble"').to_ascii_buffer()
	_check("tamper manifest rifiutato dalla firma",
			str(WindowsVerifier.verify_for_test(tampered, signature, public_pem, fingerprint,
					context).get("error", "")) == WindowsVerifier.ERR_SIGNATURE, "")
	var malformed := "{bad}\n".to_ascii_buffer()
	var malformed_signed := _test_sign(malformed, private_key)
	_check("JSON viene interpretato soltanto dopo firma valida",
			str(WindowsVerifier.verify_for_test(malformed, malformed_signed, public_pem,
					fingerprint, context).get("error", "")) == WindowsVerifier.ERR_SCHEMA, "")
	var duplicate_top := raw.get_string_from_ascii().replace(
			'{"artifacts":', '{"channel":"stable","artifacts":').to_ascii_buffer()
	_check("chiave top-level duplicata rifiutata anche se firmata",
			str(WindowsVerifier.verify_for_test(duplicate_top,
					_test_sign(duplicate_top, private_key), public_pem, fingerprint,
					context).get("error", "")) == WindowsVerifier.ERR_MANIFEST_FORMAT, "")
	var duplicate_artifact := raw.get_string_from_ascii().replace(
			'{"arch":"x86_64"',
			'{"arch":"x86_64","arch":"x86_64"').to_ascii_buffer()
	_check("chiave artifact duplicata rifiutata anche se firmata",
			str(WindowsVerifier.verify_for_test(duplicate_artifact,
					_test_sign(duplicate_artifact, private_key), public_pem, fingerprint,
					context).get("error", "")) == WindowsVerifier.ERR_MANIFEST_FORMAT, "")
	var unordered := raw.get_string_from_ascii().replace(
			'"channel":"stable","commit":"%s"' % "d".repeat(40),
			'"commit":"%s","channel":"stable"' % "d".repeat(40)).to_ascii_buffer()
	_check("ordine chiavi non canonico rifiutato anche se firmato",
			str(WindowsVerifier.verify_for_test(unordered, _test_sign(unordered, private_key),
					public_pem, fingerprint, context).get("error", "")) \
					== WindowsVerifier.ERR_MANIFEST_FORMAT, "")
	var escaped_ascii := raw.get_string_from_ascii().replace(
			'"channel":"stable"', '"channel":"st\\u0061ble"').to_ascii_buffer()
	_check("escape ASCII non canonico rifiutato anche se firmato",
			str(WindowsVerifier.verify_for_test(escaped_ascii,
					_test_sign(escaped_ascii, private_key), public_pem, fingerprint,
					context).get("error", "")) == WindowsVerifier.ERR_MANIFEST_FORMAT, "")

	var unknown := manifest.duplicate(true)
	unknown["trusted"] = true
	_check("campo manifest sconosciuto rifiutato",
			_verified_error(unknown, private_key, public_pem, fingerprint, context) \
					!= "", "")
	var wrong_binding := manifest.duplicate(true)
	wrong_binding["repository"] = "altro/repository"
	_check("repository firmato ma diverso rifiutato",
			_verified_error(wrong_binding, private_key, public_pem, fingerprint, context) \
					== WindowsVerifier.ERR_BINDING, "")
	wrong_binding = manifest.duplicate(true)
	wrong_binding["tag"] = "v0.3.8"
	_check("tag/version mismatch rifiutato",
			_verified_error(wrong_binding, private_key, public_pem, fingerprint, context) \
					== WindowsVerifier.ERR_BINDING, "")
	wrong_binding = manifest.duplicate(true)
	wrong_binding["commit"] = "A".repeat(40)
	_check("commit non canonico rifiutato",
			_verified_error(wrong_binding, private_key, public_pem, fingerprint, context) \
					== WindowsVerifier.ERR_BINDING, "")
	for binding_case: Array in [
			["product", "altro-prodotto"],
			["channel", "beta"],
			["published_at", "2026-08-07"],
			["schema_version", 2],
			["key_id", "e".repeat(64)],
	]:
		wrong_binding = manifest.duplicate(true)
		wrong_binding[binding_case[0]] = binding_case[1]
		_check("binding manifest diverso rifiutato: " + str(binding_case[0]),
				_verified_error(wrong_binding, private_key, public_pem, fingerprint,
						context) != "", str(binding_case))

	var wrong_selection := manifest.duplicate(true)
	wrong_selection["artifacts"][0]["platform"] = "linux"
	_check("platform artifact mismatch rifiutato",
			_verified_error(wrong_selection, private_key, public_pem, fingerprint,
					context) != "", "")
	var duplicate := manifest.duplicate(true)
	duplicate["artifacts"].append(duplicate["artifacts"][0].duplicate(true))
	_check("artifact/selection duplicata rifiutata",
			_verified_error(duplicate, private_key, public_pem, fingerprint,
					context) != "", "")
	var protocol_number := manifest.duplicate(true)
	protocol_number["artifacts"][0]["protocol"] = 1
	_check("protocol numero/coercizzato rifiutato",
			_verified_error(protocol_number, private_key, public_pem, fingerprint,
					context) == WindowsVerifier.ERR_SCHEMA, "")
	var wrong_role := manifest.duplicate(true)
	wrong_role["artifacts"][0]["role"] = "desktop"
	_check("ruolo artifact sconosciuto rifiutato",
			_verified_error(wrong_role, private_key, public_pem, fingerprint,
					context) != "", "")
	var missing_role := manifest.duplicate(true)
	missing_role["artifacts"].pop_back()
	_check("ruolo helper mancante rifiutato",
			_verified_error(missing_role, private_key, public_pem, fingerprint,
					context) != "", "")
	var wrong_filename := manifest.duplicate(true)
	wrong_filename["artifacts"][0]["filename"] = "altro.exe"
	_check("filename non allowlisted rifiutato",
			_verified_error(wrong_filename, private_key, public_pem, fingerprint,
					context) == WindowsVerifier.ERR_SELECTION, "")
	var unsorted := manifest.duplicate(true)
	unsorted["artifacts"].reverse()
	_check("artifact non ordinati rifiutati",
			_verified_error(unsorted, private_key, public_pem, fingerprint,
					context) == WindowsVerifier.ERR_SELECTION, "")

	var replay_context := context.duplicate(true)
	replay_context["installed_version"] = "0.3.7"
	replay_context["highest_committed_version"] = "0.3.7"
	replay_context["highest_committed_sequence"] = WindowsVerifier.version_sequence("0.3.7")
	_check("replay versione+sequence committed rifiutato",
			str(WindowsVerifier.verify_for_test(raw, signature, public_pem, fingerprint,
					replay_context).get("error", "")) == WindowsVerifier.ERR_DOWNGRADE, "")
	var sequence_replay := context.duplicate(true)
	sequence_replay["highest_committed_sequence"] = WindowsVerifier.version_sequence("0.3.7")
	_check("floor sequence senza semver corrispondente rifiutato",
			str(WindowsVerifier.verify_for_test(raw, signature, public_pem, fingerprint,
					sequence_replay).get("error", "")) == WindowsVerifier.ERR_BINDING, "")
	var semver_replay := context.duplicate(true)
	semver_replay["highest_committed_version"] = "0.3.7"
	_check("floor semver senza sequence corrispondente rifiutato",
			str(WindowsVerifier.verify_for_test(raw, signature, public_pem, fingerprint,
					semver_replay).get("error", "")) == WindowsVerifier.ERR_BINDING, "")
	var downgrade := manifest.duplicate(true)
	downgrade["version"] = "0.3.5"
	downgrade["tag"] = "v0.3.5"
	downgrade["sequence"] = WindowsVerifier.version_sequence("0.3.5")
	_check("downgrade firmato rifiutato",
			_verified_error(downgrade, private_key, public_pem, fingerprint, context) \
					== WindowsVerifier.ERR_DOWNGRADE, "")
	var impossible_time := manifest.duplicate(true)
	impossible_time["published_at"] = "2026-02-30T19:00:00Z"
	_check("timestamp canonico ma non reale rifiutato",
			_verified_error(impossible_time, private_key, public_pem, fingerprint,
					context) == WindowsVerifier.ERR_BINDING, "")
	var mismatched_floor := context.duplicate(true)
	mismatched_floor["highest_committed_version"] = "0.3.6"
	mismatched_floor["highest_committed_sequence"] = \
			WindowsVerifier.version_sequence("0.3.5")
	_check("floor versione/sequence incoerente rifiutato",
			str(WindowsVerifier.verify_for_test(raw, signature, public_pem, fingerprint,
					mismatched_floor).get("error", "")) == WindowsVerifier.ERR_BINDING, "")
	var below_floor := context.duplicate(true)
	below_floor["highest_committed_version"] = "0.3.7"
	below_floor["highest_committed_sequence"] = \
			WindowsVerifier.version_sequence("0.3.7")
	_check("installed sotto il floor committed rifiutato",
			str(WindowsVerifier.verify_for_test(raw, signature, public_pem, fingerprint,
					below_floor).get("error", "")) == WindowsVerifier.ERR_BINDING, "")

	var float_raw := raw.get_string_from_ascii().replace(
			'"sequence":%d' % WindowsVerifier.version_sequence("0.3.7"),
			'"sequence":%d.0' % WindowsVerifier.version_sequence("0.3.7")).to_ascii_buffer()
	_check("numero JSON float rifiutato anche se firmato",
			str(WindowsVerifier.verify_for_test(float_raw, _test_sign(float_raw, private_key),
					public_pem, fingerprint, context).get("error", "")) \
					== WindowsVerifier.ERR_MANIFEST_FORMAT, "")
	var oversized := _bytes(WindowsVerifier.MANIFEST_MAX_BYTES + 1, 65)
	_check("manifest oltre 64KiB rifiutato prima della firma",
			str(WindowsVerifier.verify_for_test(oversized, signature, public_pem, fingerprint,
					context).get("error", "")) == WindowsVerifier.ERR_MANIFEST_FORMAT, "")


func _test_manifest(fingerprint: String) -> Dictionary:
	return {
		"artifacts": [
			{"arch": "x86_64", "filename": UpdateCheck.WINDOWS_ASSET,
				"platform": "windows",
				"protocol": WindowsVerifier.PROTOCOL_DESKTOP,
				"role": WindowsVerifier.ROLE_DESKTOP,
				"sha256": "b".repeat(64), "size": 222},
			{"arch": "x86_64", "filename": UpdateCheck.WINDOWS_HELPER_ASSET,
				"platform": "windows", "protocol": WindowsVerifier.PROTOCOL_HELPER,
				"role": WindowsVerifier.ROLE_HELPER,
				"sha256": "c".repeat(64), "size": 333},
		],
		"channel": "stable",
		"commit": "d".repeat(40),
		"key_id": fingerprint,
		"product": WindowsVerifier.PRODUCT,
		"published_at": "2026-08-07T19:00:00Z",
		"repository": WindowsVerifier.REPOSITORY,
		"schema_version": WindowsVerifier.MANIFEST_SCHEMA,
		"sequence": WindowsVerifier.version_sequence("0.3.7"),
		"tag": "v0.3.7",
		"version": "0.3.7",
	}


func _test_manifest_context() -> Dictionary:
	return {
		"highest_committed_sequence": WindowsVerifier.version_sequence("0.3.6"),
		"highest_committed_version": "0.3.6",
		"installed_version": "0.3.6",
		"required_artifacts": [
			{"arch": "x86_64", "filename": UpdateCheck.WINDOWS_ASSET,
				"platform": "windows",
				"protocol": WindowsVerifier.PROTOCOL_DESKTOP,
				"role": WindowsVerifier.ROLE_DESKTOP},
			{"arch": "x86_64", "filename": UpdateCheck.WINDOWS_HELPER_ASSET,
				"platform": "windows", "protocol": WindowsVerifier.PROTOCOL_HELPER,
				"role": WindowsVerifier.ROLE_HELPER},
		],
	}


func _canonical_manifest_bytes(manifest: Dictionary) -> PackedByteArray:
	return (JSON.stringify(manifest, "", true, false) + "\n").to_ascii_buffer()


func _test_sign(raw: PackedByteArray, private_key: CryptoKey) -> PackedByteArray:
	return Crypto.new().sign(HashingContext.HASH_SHA256,
			WindowsVerifier.sha256(raw), private_key)


func _test_spki_der(public_pem: String) -> PackedByteArray:
	var body := public_pem.replace("-----BEGIN PUBLIC KEY-----", "") \
			.replace("-----END PUBLIC KEY-----", "").replace("\n", "")
	return Marshalls.base64_to_raw(body)


func _verified_error(manifest: Dictionary, private_key: CryptoKey,
		public_pem: String, fingerprint: String, context: Dictionary) -> String:
	var raw := _canonical_manifest_bytes(manifest)
	return str(WindowsVerifier.verify_for_test(raw, _test_sign(raw, private_key), public_pem,
			fingerprint, context).get("error", ""))


func _bytes(length: int, value: int) -> PackedByteArray:
	var out := PackedByteArray()
	out.resize(length)
	out.fill(value)
	return out


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
	var verifier_source := FileAccess.get_file_as_string(
			"res://scripts/support/windows_update_verifier.gd")
	var client_source := FileAccess.get_file_as_string(
			"res://scripts/support/windows_update_client.gd")
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
	_check("defer fallisce chiuso se la persistenza atomica fallisce",
			"func _save_cfg() -> bool" in service_source
			and "deferred_version = old_version" in service_source
			and "UpdateCheck.CONFIG_PATH + \".tmp\"" in service_source, "")
	_check("protocollo puro non puo lanciare apply",
			"OS.execute" not in protocol_source
			and "OS.create_process" not in protocol_source
			and "shell_open" not in protocol_source, "")
	_check("apply Windows passa soltanto dal helper locale verificato",
			"WindowsClient.verify_staged" in service_source
			and "WindowsVerifier.verify_production" in service_source
			and "OS.create_process(WindowsClient.powershell_path(), argv, false)" \
					in service_source
			and "shell_open" not in client_source, "")
	_check("recovery boot raggiungibile anche quando target e pending coincidono",
			"await _recover_windows(plan)" in service_source
			and "WindowsClient.recovery_authority_ready(plan, pending_version)" \
					in service_source
			and "pending_boot_requires_recovery" in service_source, "")
	_check("download Windows e limitato durante e dopo il trasferimento",
			"request.body_size_limit = max_bytes" in service_source
			and "WINDOWS_MANIFEST_MAX_BYTES := 65536" in service_source
			and "WINDOWS_SIGNATURE_BYTES := 384" in service_source
			and "WindowsClient.download_size_valid(" in service_source
			and "DirAccess.remove_absolute(destination)" in service_source, "")
	_check("helper riattestato immediatamente prima di ogni -File",
			service_source.count("WindowsClient.installed_authority(") >= 3
			and service_source.count("WindowsClient.recovery_authority_ready(") >= 2,
			"")
	_check("portable o path bind non acquisiscono capability updater",
			'"Programs/Job Hunter Team"' in client_source
			and '"job-hunter-team.exe"' in client_source
			and "target.to_lower() != expected_target.to_lower()" in client_source,
			"")
	_check("argv helper rispetta la policy PowerShell",
			'"-File"' in client_source and "ExecutionPolicy" not in client_source
			and "Bypass" not in client_source, "")
	_check("schema UNIQUE freeze letterale",
			UpdateCheck.WINDOWS_MANIFEST_ASSET == "RELEASE-MANIFEST.json"
			and UpdateCheck.WINDOWS_SIGNATURE_ASSET == "RELEASE-MANIFEST.json.sig"
			and WindowsVerifier.MANIFEST_SCHEMA == 1
			and WindowsVerifier.SIGNATURE_BYTES == 384
			and WindowsVerifier.PROTOCOL_DESKTOP == "jht-windows-desktop-v1"
			and WindowsVerifier.PROTOCOL_HELPER == "jht-windows-update-v1", "")
	_check("fingerprint production hard-pinned",
			WindowsVerifier.PRODUCTION_FINGERPRINT \
					== "3ab73bd9203a2e4f5d01a61bfecbb2bd891663164732a647af8c9164da97a0b2",
			WindowsVerifier.PRODUCTION_FINGERPRINT)
	var game_source := FileAccess.get_file_as_string("res://scripts/game.gd")
	_check("artifact gate legge davvero il keyring esportato",
			"JHT_WINDOWS_UPDATE_TRUST_TEST" in game_source
			and "WindowsVerifier.production_keyring()" in game_source
			and '"editor-checkout" if OS.has_feature("editor") else "exported-pck"' \
					in game_source
			and "WINDOWS-UPDATE-TRUST-BYTES" in game_source
			and "WINDOWS-UPDATE-TRUST-KEYRING size=" in game_source
			and "WINDOWS-UPDATE-TRUST-FINGERPRINT" in game_source
			and "WINDOWS-UPDATE-TRUST-TEST PASS" in game_source
			and "WINDOWS-UPDATE-TRUST-TEST FAIL" in game_source
			and "return []" not in verifier_source
			and "out.clear()" in verifier_source, "")
	_check("firma raw verificata prima del JSON parse",
			verifier_source.find("Crypto.new().verify") >= 0
			and verifier_source.find("parser.parse") \
					> verifier_source.find("Crypto.new().verify"), "")
	_check("manifest autenticato deve coincidere col JSON canonico",
			"_canonical_json(parsed)" in verifier_source
			and "raw_manifest.get_string_from_ascii()" in verifier_source, "")
	_check("nessuna chiave privata/test nel verifier production",
			"BEGIN PRIVATE KEY" not in verifier_source
			and "generate_rsa" not in verifier_source
			and "OS.get_environment" not in verifier_source
			and 'if not OS.has_feature("editor")' in verifier_source
			and "verify_for_test" not in service_source, "")


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
