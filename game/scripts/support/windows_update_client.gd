class_name WindowsUpdateClient
extends RefCounted
## Adapter fail-closed fra UpdateService e il helper Windows installato.
##
## Costruisce soltanto path e argv fissi, verifica la root incorporata e i byte
## staged, e interpreta frame esatti. L'autorita su ACL/reparse/journal/swap e
## floor resta sempre al helper protetto distribuito dall'installer.

const HELPER_NAME := "jht-windows-update.ps1"
const MANIFEST_NAME := "RELEASE-MANIFEST.json"
const SIGNATURE_NAME := "RELEASE-MANIFEST.json.sig"
const UpdatePolicy := preload("res://scripts/support/update_check.gd")
const UpdateProtocol := preload("res://scripts/support/windows_update_protocol.gd")
const UpdateVerifier := preload("res://scripts/support/windows_update_verifier.gd")


static func nonce() -> String:
	return Crypto.new().generate_random_bytes(16).hex_encode()


static func request_token(prefix: String) -> String:
	return "%s-%s" % [prefix, Crypto.new().generate_random_bytes(12).hex_encode()]


static func plan(executable: String, transaction_nonce: String) -> Dictionary:
	if not UpdateProtocol.valid_nonce(transaction_nonce) \
			or executable.is_empty() or not executable.is_absolute_path():
		return {}
	# Godot normalizza e compone in modo affidabile con `/` anche su Windows;
	# PowerShell/.NET accettano poi questi path assoluti senza interpretazione.
	var target := executable.replace("\\", "/")
	var install_dir := target.get_base_dir()
	var local_app_data := OS.get_environment("LOCALAPPDATA").strip_edges() \
			.replace("\\", "/")
	if local_app_data.length() < 3 or local_app_data[1] != ":" \
			or local_app_data[2] != "/" or local_app_data.split("/").has(".."):
		return {}
	var expected_install_dir := local_app_data.path_join(
			"Programs/Job Hunter Team")
	var expected_target := expected_install_dir.path_join("job-hunter-team.exe")
	# Solo l'installer manuale v0.3.6 crea questa capability host protetta.
	# Una copia portable o spostata resta intenzionalmente notify/manual-only.
	if install_dir.to_lower() != expected_install_dir.to_lower() \
			or target.to_lower() != expected_target.to_lower():
		return {}
	var state_root := local_app_data.path_join("Job Hunter Team/host-runtime")
	var transaction := state_root.path_join(transaction_nonce)
	var authority_backup := install_dir.path_join(
			".jht-update-%s.authority-backup" % transaction_nonce)
	return {
		"nonce": transaction_nonce,
		"target": target,
		"installed_helper": install_dir.path_join(HELPER_NAME),
		"installed_manifest": install_dir.path_join(MANIFEST_NAME),
		"installed_signature": install_dir.path_join(SIGNATURE_NAME),
		"state_root": state_root,
		"transaction": transaction,
		"candidate": install_dir.path_join(
				".jht-update-%s.candidate.exe" % transaction_nonce),
		"candidate_helper": transaction.path_join(HELPER_NAME),
		"candidate_manifest": transaction.path_join(MANIFEST_NAME),
		"candidate_signature": transaction.path_join(SIGNATURE_NAME),
		"ready": transaction.path_join("ready.json"),
		"result": transaction.path_join("result.json"),
		"journal": transaction.path_join("journal.json"),
		"health": transaction.path_join("health.json"),
		"old_helper_backup": authority_backup.path_join(HELPER_NAME),
		"old_manifest_backup": authority_backup.path_join(MANIFEST_NAME),
		"old_signature_backup": authority_backup.path_join(SIGNATURE_NAME),
	}


static func powershell_path() -> String:
	var root := OS.get_environment("SystemRoot").strip_edges().replace("\\", "/")
	if root.length() < 3 or root[1] != ":" or root[2] != "/":
		return ""
	var path := root.path_join("System32/WindowsPowerShell/v1.0/powershell.exe")
	return path if FileAccess.file_exists(path) else ""


static func installed_authority(update_plan: Dictionary,
		installed_version: String) -> Dictionary:
	if not UpdateVerifier.production_ready() or powershell_path().is_empty():
		return {}
	var manifest_path := str(update_plan.get("installed_manifest", ""))
	var signature_path := str(update_plan.get("installed_signature", ""))
	if not FileAccess.file_exists(manifest_path) \
			or not FileAccess.file_exists(signature_path):
		return {}
	# Il verifier forward-only viene riusato contro un floor neutro e il
	# risultato deve poi coincidere ESATTAMENTE con la copia in esecuzione.
	# Questo attesta il helper prima di eseguirlo: non può verificare se stesso.
	var verified := UpdateVerifier.verify_production(
			FileAccess.get_file_as_bytes(manifest_path),
			FileAccess.get_file_as_bytes(signature_path),
			manifest_context("0.0.0", "", 0))
	if not bool(verified.get("ok", false)) \
			or str(verified.get("version", "")) != installed_version:
		return {}
	var artifacts: Dictionary = verified.get("artifacts", {})
	if not _file_matches(str(update_plan.get("target", "")),
			artifacts.get(UpdateVerifier.ROLE_DESKTOP, {}), UpdatePolicy.WINDOWS_ASSET) \
			or not _file_matches(str(update_plan.get("installed_helper", "")),
					artifacts.get(UpdateVerifier.ROLE_HELPER, {}), HELPER_NAME):
		return {}
	return verified


static func installed_authority_ready(update_plan: Dictionary,
		installed_version: String) -> bool:
	return not installed_authority(update_plan, installed_version).is_empty()


## Recovery attraversa deliberatamente stati in cui EXE, metadata e helper non
## appartengono ancora tutti alla stessa release. Prima di eseguire l'UNICO
## helper ammesso (quello installato), lo attesta insieme all'EXE corrente
## contro autorita firmate production: candidata, attiva oppure snapshot old.
## Il journal non autorizza nulla e il helper staged non viene mai eseguito.
static func recovery_authority_ready(update_plan: Dictionary,
		pending_version: String) -> bool:
	if not UpdateVerifier.production_ready() or powershell_path().is_empty() \
			or UpdateCheck.parse_version(pending_version).is_empty() \
			or not FileAccess.file_exists(str(update_plan.get("journal", ""))):
		return false
	var candidate := recovery_candidate_authority(update_plan, pending_version)
	if candidate.is_empty():
		return false
	var authorities: Array[Dictionary] = [candidate]
	for pair: Array in [
			[str(update_plan.get("installed_manifest", "")),
					str(update_plan.get("installed_signature", ""))],
			[str(update_plan.get("old_manifest_backup", "")),
					str(update_plan.get("old_signature_backup", ""))],
	]:
		var verified := _verified_authority(pair[0], pair[1])
		if bool(verified.get("ok", false)):
			authorities.append(verified)
	var helper_ok := false
	var target_ok := false
	for authority: Dictionary in authorities:
		var artifacts: Dictionary = authority.get("artifacts", {})
		helper_ok = helper_ok or _file_matches(
				str(update_plan.get("installed_helper", "")),
				artifacts.get(UpdateVerifier.ROLE_HELPER, {}), HELPER_NAME)
		target_ok = target_ok or _file_matches(str(update_plan.get("target", "")),
				artifacts.get(UpdateVerifier.ROLE_DESKTOP, {}),
				UpdatePolicy.WINDOWS_ASSET)
	return helper_ok and target_ok


static func recovery_candidate_authority(update_plan: Dictionary,
		pending_version: String) -> Dictionary:
	if UpdateCheck.parse_version(pending_version).is_empty():
		return {}
	var candidate := _verified_authority(
			str(update_plan.get("candidate_manifest", "")),
			str(update_plan.get("candidate_signature", "")))
	return candidate if bool(candidate.get("ok", false)) \
			and str(candidate.get("version", "")) == pending_version else {}


static func _verified_authority(manifest_path: String,
		signature_path: String) -> Dictionary:
	if manifest_path.is_empty() or signature_path.is_empty() \
			or not FileAccess.file_exists(manifest_path) \
			or not FileAccess.file_exists(signature_path):
		return {}
	return UpdateVerifier.verify_production(
			FileAccess.get_file_as_bytes(manifest_path),
			FileAccess.get_file_as_bytes(signature_path),
			manifest_context("0.0.0", "", 0))


static func manifest_context(installed_version: String,
		highest_version: String, highest_sequence: int) -> Dictionary:
	return {
		"installed_version": installed_version,
		"highest_committed_version": highest_version,
		"highest_committed_sequence": highest_sequence,
		"required_artifacts": [
			{"arch": "x86_64", "filename": UpdatePolicy.WINDOWS_ASSET,
				"platform": "windows",
				"protocol": UpdateVerifier.PROTOCOL_DESKTOP,
				"role": UpdateVerifier.ROLE_DESKTOP},
			{"arch": "x86_64", "filename": HELPER_NAME,
				"platform": "windows",
				"protocol": UpdateVerifier.PROTOCOL_HELPER,
				"role": UpdateVerifier.ROLE_HELPER},
		],
	}


static func verify_staged(update_plan: Dictionary, verified: Dictionary) -> bool:
	var artifacts: Dictionary = verified.get("artifacts", {})
	return _file_matches(str(update_plan.get("candidate", "")),
			artifacts.get(UpdateVerifier.ROLE_DESKTOP, {}), UpdatePolicy.WINDOWS_ASSET) \
			and _file_matches(str(update_plan.get("candidate_helper", "")),
					artifacts.get(UpdateVerifier.ROLE_HELPER, {}), HELPER_NAME)


static func _file_matches(path: String, artifact: Dictionary, signed_name: String) -> bool:
	if path.is_empty() or not FileAccess.file_exists(path):
		return false
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return false
	var size := file.get_length()
	file.close()
	return UpdateVerifier.staged_artifact_matches(artifact, signed_name,
			size, FileAccess.get_sha256(path))


static func helper_argv(mode: String, update_plan: Dictionary, old_pid: int,
		request_id: String, instance_id: String) -> PackedStringArray:
	if mode not in ["Verify", "Apply", "Recover"] \
			or update_plan.is_empty() or old_pid <= 0:
		return PackedStringArray()
	return PackedStringArray([
		"-NoLogo", "-NoProfile", "-NonInteractive",
		"-File", str(update_plan["installed_helper"]),
		"-Mode", mode,
		"-TargetPath", str(update_plan["target"]),
		"-CandidatePath", str(update_plan["candidate"]),
		"-CandidateHelperPath", str(update_plan["candidate_helper"]),
		"-InstalledManifestPath", str(update_plan["installed_manifest"]),
		"-InstalledSignaturePath", str(update_plan["installed_signature"]),
		"-CandidateManifestPath", str(update_plan["candidate_manifest"]),
		"-CandidateSignaturePath", str(update_plan["candidate_signature"]),
		"-StateRoot", str(update_plan["state_root"]),
		"-Nonce", str(update_plan["nonce"]),
		"-OldPid", str(old_pid),
		"-RequestId", request_id,
		"-InstanceId", instance_id,
	])


static func read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed if parsed is Dictionary else {}


## Decide soltanto se un pending al boot appartiene alla recovery. Il result
## `ready/verified` consente di ricostruire READY dopo una chiusura volontaria;
## qualunque altro journal, compreso target==pending, richiede il helper Recover.
static func pending_boot_requires_recovery(current_version: String,
		pending_version: String, journal_exists: bool, result: Dictionary,
		nonce_value: String) -> bool:
	if not journal_exists:
		return false
	if current_version == pending_version:
		return true
	return not (UpdateProtocol.result_frame_matches(result, nonce_value) \
			and str(result.get("phase", "")) == "ready" \
			and str(result.get("code", "")) == "verified")


static func download_size_valid(actual_bytes: int, max_bytes: int,
		expected_bytes := 0) -> bool:
	return actual_bytes > 0 and max_bytes > 0 and actual_bytes <= max_bytes \
			and expected_bytes >= 0 and expected_bytes <= max_bytes \
			and (expected_bytes == 0 or actual_bytes == expected_bytes)


static func remove_staged(update_plan: Dictionary) -> void:
	# Mai glob: soltanto i path derivati dal nonce di questa transazione.
	for key: String in ["candidate", "candidate_helper", "candidate_manifest",
			"candidate_signature", "ready", "result", "health"]:
		var path := str(update_plan.get(key, ""))
		if not path.is_empty() and FileAccess.file_exists(path):
			DirAccess.remove_absolute(path)
