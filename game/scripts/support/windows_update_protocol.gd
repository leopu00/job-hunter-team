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


static func _has_type(value: Dictionary, key: String, expected_type: int) -> bool:
	return value.has(key) and typeof(value[key]) == expected_type


## JSON non distingue integer e float e il parser Godot materializza ogni
## numero come TYPE_FLOAT. Accettiamo quindi soltanto un numero JSON finito,
## integrale e nel range esatto IEEE-754 (oppure l'int nativo prodotto in
## memoria); stringhe e booleani non vengono mai coercizzati.
static func _json_integer(value: Dictionary, key: String, minimum: int) -> bool:
	if not value.has(key) or typeof(value[key]) not in [TYPE_INT, TYPE_FLOAT]:
		return false
	var number := float(value[key])
	return is_finite(number) and number >= float(minimum) \
			and number <= 9007199254740991.0 and floor(number) == number


## Frame emesso dal helper DOPO la propria verifica indipendente, ma prima che
## il processo vecchio esca. Serve al gioco solo per sapere che puo chiudersi;
## non viene mai riusato dal helper come prova della firma.
static func ready_frame_matches(frame: Dictionary, expected: Dictionary) -> bool:
	return _has_exact_keys(frame, ["schema", "type", "ok", "nonce",
			"request_id", "instance_id", "old_pid", "old_started",
			"manifest_sha256", "candidate_sha256"]) \
			and _json_integer(frame, "schema", 1) \
			and _has_type(frame, "type", TYPE_STRING) \
			and _has_type(frame, "ok", TYPE_BOOL) \
			and _has_type(frame, "nonce", TYPE_STRING) \
			and _has_type(frame, "request_id", TYPE_STRING) \
			and _has_type(frame, "instance_id", TYPE_STRING) \
			and _json_integer(frame, "old_pid", 1) \
			and _has_type(frame, "old_started", TYPE_STRING) \
			and _has_type(frame, "manifest_sha256", TYPE_STRING) \
			and _has_type(frame, "candidate_sha256", TYPE_STRING) \
			and _has_type(expected, "nonce", TYPE_STRING) \
			and _has_type(expected, "request_id", TYPE_STRING) \
			and _has_type(expected, "instance_id", TYPE_STRING) \
			and _has_type(expected, "old_pid", TYPE_INT) \
			and _has_type(expected, "old_started", TYPE_STRING) \
			and _has_type(expected, "manifest_sha256", TYPE_STRING) \
			and _has_type(expected, "candidate_sha256", TYPE_STRING) \
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
	return _has_exact_keys(frame, ["schema", "type", "nonce", "version",
			"exe_sha256"]) \
			and _json_integer(frame, "schema", 1) \
			and _has_type(frame, "type", TYPE_STRING) \
			and _has_type(frame, "nonce", TYPE_STRING) \
			and _has_type(frame, "version", TYPE_STRING) \
			and _has_type(frame, "exe_sha256", TYPE_STRING) \
			and valid_nonce(nonce) \
			and not UpdateCheck.parse_version(version).is_empty() \
			and valid_sha256(exe_sha256) \
			and int(frame.get("schema", 0)) == SCHEMA \
			and str(frame.get("type", "")) == FRAME_HEALTHY \
			and str(frame.get("nonce", "")) == nonce \
			and str(frame.get("version", "")) == version \
			and str(frame.get("exe_sha256", "")) == exe_sha256


## Il helper consegna al processo nuovo una capability esplicita gia creata e
## protetta. Qui si rifiutano soltanto forme palesemente ambigue/traversal: NON
## e path authority. Dopo la scrittura il helper deve ancora verificare percorso
## canonico, owner, ACL e assenza di reparse point prima di fidarsi dell'ACK.
static func health_capability_path(capability: String, nonce: String) -> String:
	var path := capability.replace("\\", "/")
	var drive := path[0].to_upper() if not path.is_empty() else ""
	if path.length() < 3 or path[1] != ":" or path[2] != "/" \
			or drive not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" \
			or "\n" in path or "\r" in path or path.split("/").has("..") \
			or not valid_nonce(nonce):
		return ""
	var expected_suffix := "/updates/%s/health.json" % nonce
	return path if path.ends_with(expected_suffix) else ""


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
			or not _json_integer(journal, "schema", 1) \
			or not _has_type(journal, "nonce", TYPE_STRING) \
			or not _has_type(journal, "installed_version", TYPE_STRING) \
			or not _has_type(journal, "target_version", TYPE_STRING) \
			or not _has_type(journal, "old_sha256", TYPE_STRING) \
			or not _has_type(journal, "candidate_sha256", TYPE_STRING) \
			or not _has_type(journal, "state", TYPE_STRING) \
			or int(journal.get("schema", 0)) != SCHEMA \
			or not valid_nonce(str(journal.get("nonce", ""))) \
			or UpdateCheck.parse_version(str(journal.get("installed_version", ""))).is_empty() \
			or UpdateCheck.parse_version(str(journal.get("target_version", ""))).is_empty() \
			or not UpdateCheck.is_newer(str(journal.get("target_version", "")),
					str(journal.get("installed_version", ""))) \
			or not valid_sha256(str(journal.get("old_sha256", ""))) \
			or not valid_sha256(str(journal.get("candidate_sha256", ""))) \
			or str(journal.get("old_sha256", "")) \
					== str(journal.get("candidate_sha256", "")):
		return false
	return str(journal.get("state", "")) in [JOURNAL_PREPARED,
			JOURNAL_SWAP_INTENT, JOURNAL_CANDIDATE_INSTALLED,
			JOURNAL_HEALTH_ACKED, JOURNAL_COMMITTED, JOURNAL_ROLLED_BACK]
