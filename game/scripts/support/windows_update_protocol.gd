class_name WindowsUpdateProtocol
extends RefCounted
## Contratto puro fra gioco, helper Windows e processo appena aggiornato.
##
## Questo file NON verifica firme e NON applica aggiornamenti. Descrive soltanto
## frame e recovery in modo che nessun booleano proveniente dal gioco possa
## diventare un'autorizzazione. Il helper, distribuito con l'installer, resta il
## proprietario di firma, path authority, journal durable e ReplaceFileW.

const SCHEMA := 1
const NONCE_HEX_LENGTH := 32
const SHA256_HEX_LENGTH := 64

const FRAME_READY := "ready"
const FRAME_HEALTHY := "healthy"

const JOURNAL_PREPARED := "prepared"
const JOURNAL_SWAP_INTENT := "swap_intent"
const JOURNAL_CANDIDATE_INSTALLED := "candidate_installed"
const JOURNAL_HEALTH_ACKED := "health_acked"
const JOURNAL_COMMITTED := "committed"
const JOURNAL_ROLLED_BACK := "rolled_back"

const RECOVERY_DISCARD_UNAPPLIED := "discard_unapplied"
const RECOVERY_WAIT_HEALTH := "wait_health"
const RECOVERY_COMMIT := "commit"
const RECOVERY_RESTORE_OLD := "restore_old"
const RECOVERY_CLEANUP_OWNED := "cleanup_owned"
const RECOVERY_FAIL_CLOSED := "fail_closed"


static func is_lower_hex(value: String, expected_length: int) -> bool:
	if value.length() != expected_length:
		return false
	for index in value.length():
		var character := value[index]
		if not ((character >= "0" and character <= "9") \
				or (character >= "a" and character <= "f")):
			return false
	return true


static func valid_nonce(nonce: String) -> bool:
	return is_lower_hex(nonce, NONCE_HEX_LENGTH)


static func valid_sha256(digest: String) -> bool:
	return is_lower_hex(digest, SHA256_HEX_LENGTH)


static func _valid_token(value: String) -> bool:
	if value.is_empty() or value.length() > 96:
		return false
	for index in value.length():
		var character := value[index]
		if not ((character >= "a" and character <= "z") \
				or (character >= "A" and character <= "Z") \
				or (character >= "0" and character <= "9") \
				or character in ["-", "_", "."]):
			return false
	return true


static func _decimal(value: String) -> bool:
	if value.is_empty():
		return false
	for index in value.length():
		if value[index] < "0" or value[index] > "9":
			return false
	return true


static func _has_exact_keys(value: Dictionary, expected: Array[String]) -> bool:
	if value.size() != expected.size():
		return false
	for key: String in expected:
		if not value.has(key):
			return false
	return true


## Frame emesso dal helper DOPO la propria verifica indipendente, ma prima che
## il processo vecchio esca. Serve al gioco solo per sapere che puo chiudersi;
## non viene mai riusato dal helper come prova della firma.
static func ready_frame_matches(frame: Dictionary, expected: Dictionary) -> bool:
	return _has_exact_keys(frame, ["schema", "type", "ok", "nonce",
			"request_id", "instance_id", "old_pid", "old_started",
			"manifest_sha256", "candidate_sha256"]) \
			and _valid_token(str(expected.get("request_id", ""))) \
			and _valid_token(str(expected.get("instance_id", ""))) \
			and int(expected.get("old_pid", 0)) > 0 \
			and _decimal(str(expected.get("old_started", ""))) \
			and int(frame.get("schema", 0)) == SCHEMA \
			and str(frame.get("type", "")) == FRAME_READY \
			and bool(frame.get("ok", false)) \
			and valid_nonce(str(frame.get("nonce", ""))) \
			and str(frame.get("nonce", "")) == str(expected.get("nonce", "")) \
			and str(frame.get("request_id", "")) == str(expected.get("request_id", "")) \
			and str(frame.get("instance_id", "")) == str(expected.get("instance_id", "")) \
			and int(frame.get("old_pid", 0)) == int(expected.get("old_pid", -1)) \
			and str(frame.get("old_started", "")) == str(expected.get("old_started", "")) \
			and valid_sha256(str(frame.get("manifest_sha256", ""))) \
			and str(frame.get("manifest_sha256", "")) \
					== str(expected.get("manifest_sha256", "")) \
			and valid_sha256(str(frame.get("candidate_sha256", ""))) \
			and str(frame.get("candidate_sha256", "")) \
					== str(expected.get("candidate_sha256", ""))


## Il processo nuovo emette questo frame soltanto dopo due frame del motore.
## Versione e hash vengono misurati dal processo nuovo, non copiati dal journal.
static func health_frame(nonce: String, version: String, exe_sha256: String) -> Dictionary:
	if not valid_nonce(nonce) or UpdateCheck.parse_version(version).is_empty() \
			or not valid_sha256(exe_sha256):
		return {}
	return {
		"schema": SCHEMA,
		"type": FRAME_HEALTHY,
		"nonce": nonce,
		"version": version,
		"exe_sha256": exe_sha256,
	}


static func health_frame_matches(frame: Dictionary, nonce: String,
		version: String, exe_sha256: String) -> bool:
	return frame == health_frame(nonce, version, exe_sha256)


## Cartella ACK deterministica: nessun path arriva dal manifest o da argv. Il
## helper crea e protegge la directory e, dopo la lettura, ne riverifica owner,
## ACL e assenza di reparse point. Il gioco scrive soltanto il frame di salute.
static func health_dir(local_app_data: String, nonce: String) -> String:
	var root := local_app_data.replace("\\", "/").trim_suffix("/")
	var drive := root[0].to_upper() if not root.is_empty() else ""
	if root.length() < 3 or root[1] != ":" or root[2] != "/" \
			or drive not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" \
			or "\n" in root or "\r" in root \
			or root.split("/").has("..") or not valid_nonce(nonce):
		return ""
	return root.path_join("Job Hunter Team").path_join(
			"host-runtime").path_join("updates").path_join(nonce)


static func health_path(local_app_data: String, nonce: String) -> String:
	var directory := health_dir(local_app_data, nonce)
	return "" if directory == "" else directory.path_join("health.json")


## Recovery conservativa e idempotente. Non restituisce mai "apply": dopo un
## crash un candidato ancora non applicato viene scartato e dovra essere
## ri-verificato con un nuovo consenso. Dopo lo switch, senza ACK valido, si
## torna alla copia vecchia. Cleanup significa sempre e soltanto file del nonce.
static func recovery_action(journal: Dictionary, target_sha256: String,
		backup_sha256: String, health: Dictionary = {}) -> String:
	if not _valid_journal(journal):
		return RECOVERY_FAIL_CLOSED
	var state := str(journal["state"])
	var old_sha := str(journal["old_sha256"])
	var new_sha := str(journal["candidate_sha256"])
	var target_is_old := target_sha256 == old_sha
	var target_is_new := target_sha256 == new_sha
	var backup_is_old := backup_sha256 == old_sha
	var healthy := health_frame_matches(health, str(journal["nonce"]),
			str(journal["target_version"]), new_sha)

	match state:
		JOURNAL_PREPARED:
			return RECOVERY_DISCARD_UNAPPLIED if target_is_old \
					else RECOVERY_FAIL_CLOSED
		JOURNAL_SWAP_INTENT, JOURNAL_CANDIDATE_INSTALLED:
			if target_is_new and healthy:
				return RECOVERY_COMMIT
			if target_is_new and backup_is_old:
				return RECOVERY_RESTORE_OLD
			if target_is_new:
				return RECOVERY_WAIT_HEALTH
			return RECOVERY_RESTORE_OLD if backup_is_old else RECOVERY_FAIL_CLOSED
		JOURNAL_HEALTH_ACKED:
			if target_is_new and healthy:
				return RECOVERY_COMMIT
			return RECOVERY_RESTORE_OLD if backup_is_old else RECOVERY_FAIL_CLOSED
		JOURNAL_COMMITTED:
			return RECOVERY_CLEANUP_OWNED if target_is_new else RECOVERY_FAIL_CLOSED
		JOURNAL_ROLLED_BACK:
			return RECOVERY_CLEANUP_OWNED if target_is_old else RECOVERY_FAIL_CLOSED
	return RECOVERY_FAIL_CLOSED


static func _valid_journal(journal: Dictionary) -> bool:
	if not _has_exact_keys(journal, ["schema", "nonce", "installed_version",
			"target_version", "old_sha256", "candidate_sha256", "state"]) \
			or int(journal.get("schema", 0)) != SCHEMA \
			or not valid_nonce(str(journal.get("nonce", ""))) \
			or UpdateCheck.parse_version(str(journal.get("installed_version", ""))).is_empty() \
			or UpdateCheck.parse_version(str(journal.get("target_version", ""))).is_empty() \
			or not UpdateCheck.is_newer(str(journal.get("target_version", "")),
					str(journal.get("installed_version", ""))) \
			or not valid_sha256(str(journal.get("old_sha256", ""))) \
			or not valid_sha256(str(journal.get("candidate_sha256", ""))):
		return false
	return str(journal.get("state", "")) in [JOURNAL_PREPARED,
			JOURNAL_SWAP_INTENT, JOURNAL_CANDIDATE_INSTALLED,
			JOURNAL_HEALTH_ACKED, JOURNAL_COMMITTED, JOURNAL_ROLLED_BACK]
