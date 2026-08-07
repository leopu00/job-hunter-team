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
	var state_root := local_app_data.path_join("Job Hunter Team/host-runtime")
	var transaction := state_root.path_join(transaction_nonce)
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


static func remove_staged(update_plan: Dictionary) -> void:
	# Mai glob: soltanto i path derivati dal nonce di questa transazione.
	for key: String in ["candidate", "candidate_helper", "candidate_manifest",
			"candidate_signature", "ready", "result", "health"]:
		var path := str(update_plan.get(key, ""))
		if not path.is_empty() and FileAccess.file_exists(path):
			DirAccess.remove_absolute(path)
