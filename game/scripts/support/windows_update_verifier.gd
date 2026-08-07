class_name WindowsUpdateVerifier
extends RefCounted
## Consumer crittografico del manifest Windows.
##
## L'ordine e il contratto: limita i byte, carica la root incorporata, verifica
## la firma sui byte RAW e soltanto dopo interpreta JSON. Questo modulo non
## scarica, non mette in stage e non lancia il helper; restituisce dati oppure un
## errore fail-closed. La root production verra passata esclusivamente dal
## wrapper che incorpora la SPKI approvata, mai dalla rete o dall'ambiente.

const MANIFEST_SCHEMA := 1
const MANIFEST_MAX_BYTES := 65536
const SIGNATURE_BYTES := 384 # RSA-3072
const MAX_ARTIFACTS := 64

const PRODUCT := "job-hunter-team"
const REPOSITORY := "leopu00/job-hunter-team"
const CHANNEL := "stable"
const ROLE_DESKTOP := "windows-desktop"
const ROLE_HELPER := "windows-update-helper"
const PROTOCOL_DESKTOP := "jht-windows-desktop-v1"
const PROTOCOL_HELPER := "jht-windows-update-v1"
const PRODUCTION_FINGERPRINT := \
		"3ab73bd9203a2e4f5d01a61bfecbb2bd891663164732a647af8c9164da97a0b2"
const PRODUCTION_KEYS: Array[Dictionary] = [{
	"path": "res://release-keys/production-spki.pem",
	"fingerprint": PRODUCTION_FINGERPRINT,
}]

const ERR_MANIFEST_FORMAT := "manifest_format"
const ERR_ROOT := "trust_root"
const ERR_SIGNATURE := "signature"
const ERR_SCHEMA := "schema"
const ERR_BINDING := "binding"
const ERR_DOWNGRADE := "downgrade"
const ERR_SELECTION := "selection"

const TOP_KEYS: Array[String] = ["artifacts", "channel", "commit", "key_id",
		"product", "published_at", "repository", "schema_version", "sequence",
		"tag", "version"]
const ARTIFACT_KEYS: Array[String] = ["arch", "filename", "platform",
		"protocol", "role", "sha256", "size"]
const SELECTION_KEYS: Array[String] = ["arch", "filename", "platform",
		"protocol", "role"]


## Injection disponibile soltanto nel binary editor usato dai selftest. Un
## export standalone non puo scegliere una root: il wrapper production, aggiunto
## col helper, passa esclusivamente SPKI e fingerprint incorporati.
static func verify_for_test(raw_manifest: PackedByteArray,
		raw_signature: PackedByteArray,
		public_key_pem: String, expected_fingerprint: String,
		context: Dictionary) -> Dictionary:
	if not OS.has_feature("editor"):
		return _failure(ERR_ROOT)
	return _verify_with_key(raw_manifest, raw_signature, public_key_pem,
			expected_fingerprint, context)


## Root production incorporate nel PCK. La rete non puo aggiungere chiavi: la
## rotazione ammessa e soltanto la finestra 1-2 SPKI costruita nell'export.
static func verify_production(raw_manifest: PackedByteArray,
		raw_signature: PackedByteArray, context: Dictionary) -> Dictionary:
	var keys := production_keyring()
	if keys.is_empty():
		return _failure(ERR_ROOT)
	var accepted: Array[Dictionary] = []
	for entry: Dictionary in keys:
		var result := _verify_with_key(raw_manifest, raw_signature,
				str(entry["pem"]), str(entry["fingerprint"]), context)
		if bool(result.get("ok", false)):
			accepted.append(result)
	return accepted[0] if accepted.size() == 1 else _failure(ERR_SIGNATURE)


static func production_keyring() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var seen := {}
	for configured: Dictionary in PRODUCTION_KEYS:
		var path := str(configured["path"])
		if not FileAccess.file_exists(path):
			continue
		var pem := FileAccess.get_file_as_string(path).strip_edges()
		var der := _spki_der(pem)
		if der.is_empty():
			return []
		var fingerprint := sha256(der).hex_encode()
		if fingerprint != str(configured["fingerprint"]) or seen.has(fingerprint):
			return []
		seen[fingerprint] = true
		out.append({"pem": pem, "fingerprint": fingerprint})
	return out if out.size() in [1, 2] else []


static func production_ready() -> bool:
	return not production_keyring().is_empty()


static func _verify_with_key(raw_manifest: PackedByteArray,
		raw_signature: PackedByteArray, public_key_pem: String,
		expected_fingerprint: String, context: Dictionary) -> Dictionary:
	if not _raw_manifest_shape(raw_manifest):
		return _failure(ERR_MANIFEST_FORMAT)
	if raw_signature.size() != SIGNATURE_BYTES:
		return _failure(ERR_SIGNATURE)

	var der := _spki_der(public_key_pem)
	if der.is_empty() or not WindowsUpdateProtocol.valid_sha256(
			expected_fingerprint):
		return _failure(ERR_ROOT)
	var fingerprint := sha256(der).hex_encode()
	if fingerprint != expected_fingerprint:
		return _failure(ERR_ROOT)
	var key := CryptoKey.new()
	if key.load_from_string(public_key_pem, true) != OK:
		return _failure(ERR_ROOT)
	var digest := sha256(raw_manifest)
	if not Crypto.new().verify(HashingContext.HASH_SHA256, digest,
			raw_signature, key):
		return _failure(ERR_SIGNATURE)

	# Da qui in poi — e soltanto da qui — i byte autenticati diventano dati.
	var parser := JSON.new()
	if parser.parse(raw_manifest.get_string_from_ascii()) != OK:
		return _failure(ERR_SCHEMA)
	var parsed: Variant = parser.data
	if not (parsed is Dictionary):
		return _failure(ERR_SCHEMA)
	# JSON.parse collassa le chiavi duplicate. Ricostruire il solo encoding
	# canonico ammesso e confrontarlo byte-per-byte fa fallire chiuso sia i
	# duplicati sia ordine/escape/non-integer alternativi, senza mai usare la
	# riserializzazione come input della verifica crittografica qui sopra.
	var canonical := _canonical_json(parsed)
	if not bool(canonical.get("ok", false)) \
			or str(canonical.get("text", "")) + "\n" \
					!= raw_manifest.get_string_from_ascii():
		return _failure(ERR_MANIFEST_FORMAT)
	return _validate_authenticated_manifest(parsed, raw_manifest, fingerprint, context)


## Riattestazione dei byte staged contro l'artifact gia autenticato. Il helper
## ripete la stessa verifica subito prima dell'apply; questo check del consumer
## non lo sostituisce.
static func staged_artifact_matches(artifact: Dictionary, filename: String,
		actual_size: int, actual_sha256: String) -> bool:
	return _valid_artifact(artifact) \
			and filename == str(artifact["filename"]) \
			and actual_size == int(artifact["size"]) \
			and actual_size > 0 \
			and WindowsUpdateProtocol.valid_sha256(actual_sha256) \
			and actual_sha256 == str(artifact["sha256"])


static func _raw_manifest_shape(raw: PackedByteArray) -> bool:
	if raw.size() < 3 or raw.size() > MANIFEST_MAX_BYTES \
			or raw[-1] != 10: # LF finale obbligatorio
		return false
	if raw.size() >= 3 and raw[0] == 0xef and raw[1] == 0xbb and raw[2] == 0xbf:
		return false
	var newlines := 0
	var in_string := false
	var escaped := false
	var index := 0
	for byte: int in raw:
		# ensure_ascii=True: il formato canonico firmato e interamente ASCII.
		if byte > 0x7f or byte == 0 or byte == 13:
			return false
		if byte == 10:
			newlines += 1
	# JSON.parse_string rappresenta i numeri JSON come float. Per distinguere
	# davvero `7` da `7.0`/`7e0` si valida il token RAW autenticato: fuori dalle
	# stringhe sono ammessi soltanto interi decimali canonici e nessuno spazio.
	while index < raw.size() - 1:
		var byte := raw[index]
		if in_string:
			if escaped:
				escaped = false
			elif byte == 92: # backslash
				escaped = true
			elif byte == 34: # quote
				in_string = false
			index += 1
			continue
		if byte == 34:
			in_string = true
			index += 1
			continue
		if byte in [9, 32] or byte == 45: # whitespace o numero negativo
			return false
		if byte >= 48 and byte <= 57:
			var start := index
			while index < raw.size() - 1 and raw[index] >= 48 and raw[index] <= 57:
				index += 1
			if index - start > 1 and raw[start] == 48:
				return false
			if index < raw.size() - 1 and raw[index] not in [44, 93, 125]:
				return false
			continue
		index += 1
	return newlines == 1 and not in_string and not escaped


static func _spki_der(pem: String) -> PackedByteArray:
	var normalized := pem.trim_suffix("\n")
	var lines := normalized.split("\n")
	if lines.size() < 3 or lines[0] != "-----BEGIN PUBLIC KEY-----" \
			or lines[-1] != "-----END PUBLIC KEY-----":
		return PackedByteArray()
	var body := ""
	for index in range(1, lines.size() - 1):
		var line := str(lines[index])
		if line.is_empty() or line.length() > 76 or "\r" in line:
			return PackedByteArray()
		for character_index in line.length():
			var character := line[character_index]
			if not ((character >= "A" and character <= "Z") \
					or (character >= "a" and character <= "z") \
					or (character >= "0" and character <= "9") \
					or character in ["+", "/", "="]):
				return PackedByteArray()
		body += line
	var der := Marshalls.base64_to_raw(body)
	if der.is_empty() or Marshalls.raw_to_base64(der) != body:
		return PackedByteArray()
	return der


## Replica il writer congelato `json.dumps(ensure_ascii=True, sort_keys=True,
## separators=(",", ":"), allow_nan=False)`. Il manifest non ammette null,
## booleani o float; i numeri letti da JSON sono float soltanto per una
## limitazione del parser Godot e devono rappresentare interi esatti.
static func _canonical_json(value: Variant) -> Dictionary:
	match typeof(value):
		TYPE_DICTIONARY:
			var dictionary: Dictionary = value
			var keys: Array[String] = []
			for raw_key: Variant in dictionary.keys():
				if typeof(raw_key) != TYPE_STRING:
					return {"ok": false}
				keys.append(str(raw_key))
			keys.sort()
			var members: Array[String] = []
			for key: String in keys:
				var encoded_key := _canonical_string(key)
				var encoded_value := _canonical_json(dictionary[key])
				if not bool(encoded_key.get("ok", false)) \
						or not bool(encoded_value.get("ok", false)):
					return {"ok": false}
				members.append("%s:%s" % [encoded_key["text"], encoded_value["text"]])
			return {"ok": true, "text": "{" + ",".join(members) + "}"}
		TYPE_ARRAY:
			var items: Array[String] = []
			for item: Variant in value:
				var encoded := _canonical_json(item)
				if not bool(encoded.get("ok", false)):
					return {"ok": false}
				items.append(str(encoded["text"]))
			return {"ok": true, "text": "[" + ",".join(items) + "]"}
		TYPE_STRING:
			return _canonical_string(str(value))
		TYPE_FLOAT:
			var number := float(value)
			if not is_finite(number) or number < 0.0 \
					or number > 9007199254740991.0 or floor(number) != number:
				return {"ok": false}
			return {"ok": true, "text": str(int(number))}
	return {"ok": false}


static func _canonical_string(value: String) -> Dictionary:
	var encoded := "\""
	for index in value.length():
		var character := value[index]
		var code := character.unicode_at(0)
		match code:
			8:
				encoded += "\\b"
			9:
				encoded += "\\t"
			10:
				encoded += "\\n"
			12:
				encoded += "\\f"
			13:
				encoded += "\\r"
			34:
				encoded += "\\\""
			92:
				encoded += "\\\\"
			_:
				if code < 0x20:
					encoded += "\\u%04x" % code
				elif code <= 0x7f:
					encoded += character
				elif code <= 0xffff:
					encoded += "\\u%04x" % code
				elif code <= 0x10ffff:
					var scalar := code - 0x10000
					encoded += "\\u%04x\\u%04x" % [
							0xd800 + (scalar >> 10), 0xdc00 + (scalar & 0x3ff)]
				else:
					return {"ok": false}
	return {"ok": true, "text": encoded + "\""}


static func _validate_authenticated_manifest(manifest: Dictionary,
		raw_manifest: PackedByteArray, fingerprint: String,
		context: Dictionary) -> Dictionary:
	if not _exact_keys(manifest, TOP_KEYS) \
			or not _json_uint(manifest, "schema_version", 1) \
			or not _type(manifest, "key_id", TYPE_STRING) \
			or not _type(manifest, "product", TYPE_STRING) \
			or not _type(manifest, "repository", TYPE_STRING) \
			or not _type(manifest, "channel", TYPE_STRING) \
			or not _json_uint(manifest, "sequence", 1) \
			or not _type(manifest, "version", TYPE_STRING) \
			or not _type(manifest, "tag", TYPE_STRING) \
			or not _type(manifest, "commit", TYPE_STRING) \
			or not _type(manifest, "published_at", TYPE_STRING) \
			or not _type(manifest, "artifacts", TYPE_ARRAY):
		return _failure(ERR_SCHEMA)
	if int(manifest["schema_version"]) != MANIFEST_SCHEMA \
			or str(manifest["key_id"]) != fingerprint \
			or str(manifest["product"]) != PRODUCT \
			or str(manifest["repository"]) != REPOSITORY \
			or str(manifest["channel"]) != CHANNEL:
		return _failure(ERR_BINDING)

	var sequence := int(manifest["sequence"])
	var version := str(manifest["version"])
	if sequence <= 0 or not _stable_version(version) \
			or sequence != version_sequence(version) \
			or str(manifest["tag"]) != "v" + version \
			or not WindowsUpdateProtocol.is_lower_hex(str(manifest["commit"]), 40) \
			or not _utc_timestamp(str(manifest["published_at"])):
		return _failure(ERR_BINDING)
	if not _valid_context(context):
		return _failure(ERR_BINDING)
	var floor_version := str(context["installed_version"])
	var highest_version := str(context["highest_committed_version"])
	if UpdateCheck.compare(highest_version, floor_version) > 0:
		floor_version = highest_version
	if not UpdateCheck.is_newer(version, floor_version) \
			or sequence <= int(context["highest_committed_sequence"]):
		return _failure(ERR_DOWNGRADE)

	var artifacts: Array = manifest["artifacts"]
	if artifacts.size() != 2 or artifacts.size() > MAX_ARTIFACTS:
		return _failure(ERR_SCHEMA)
	var by_tuple := {}
	var last_order := ""
	for raw_artifact: Variant in artifacts:
		if not (raw_artifact is Dictionary):
			return _failure(ERR_SCHEMA)
		var artifact: Dictionary = raw_artifact
		if not _valid_artifact(artifact):
			return _failure(ERR_SCHEMA)
		var tuple := _artifact_tuple(artifact)
		var order := _artifact_order(artifact)
		if by_tuple.has(tuple) or (last_order != "" and order <= last_order):
			return _failure(ERR_SELECTION)
		last_order = order
		by_tuple[tuple] = artifact.duplicate(true)

	var selected := {}
	for raw_selection: Variant in context["required_artifacts"]:
		var selection: Dictionary = raw_selection
		var tuple := _artifact_tuple(selection)
		if not by_tuple.has(tuple):
			return _failure(ERR_SELECTION)
		selected[str(selection["role"])] = by_tuple[tuple]
	if selected.size() != context["required_artifacts"].size():
		return _failure(ERR_SELECTION)
	return {
		"ok": true,
		"error": "",
		"version": version,
		"sequence": sequence,
		"key_id": fingerprint,
		"manifest_sha256": sha256(raw_manifest).hex_encode(),
		"artifacts": selected,
	}


static func _valid_context(context: Dictionary) -> bool:
	if not _exact_keys(context, ["highest_committed_sequence",
			"highest_committed_version", "installed_version", "required_artifacts"]) \
			or not _type(context, "highest_committed_sequence", TYPE_INT) \
			or not _type(context, "highest_committed_version", TYPE_STRING) \
			or not _type(context, "installed_version", TYPE_STRING) \
			or not _type(context, "required_artifacts", TYPE_ARRAY) \
			or int(context["highest_committed_sequence"]) < 0 \
			or not _stable_version(str(context["installed_version"])):
		return false
	var highest := str(context["highest_committed_version"])
	if highest != "" and not _stable_version(highest):
		return false
	var installed := str(context["installed_version"])
	var installed_sequence := 0 if installed == "0.0.0" \
			else version_sequence(installed)
	var highest_sequence := int(context["highest_committed_sequence"])
	if installed_sequence < 0 \
			or (highest == "" and highest_sequence != 0) \
			or (highest != "" and highest_sequence != version_sequence(highest)) \
			or highest_sequence > installed_sequence \
			or (highest != "" and UpdateCheck.compare(installed, highest) < 0):
		return false
	var tuples := {}
	for raw_selection: Variant in context["required_artifacts"]:
		if not (raw_selection is Dictionary):
			return false
		var selection: Dictionary = raw_selection
		if not _exact_keys(selection, SELECTION_KEYS) \
				or not _type(selection, "role", TYPE_STRING) \
				or not _type(selection, "platform", TYPE_STRING) \
				or not _type(selection, "arch", TYPE_STRING) \
				or not _type(selection, "filename", TYPE_STRING) \
				or not _type(selection, "protocol", TYPE_STRING) \
				or not _token(str(selection["role"])) \
				or not _token(str(selection["platform"])) \
				or not _token(str(selection["arch"])) \
				or not _filename(str(selection["filename"])) \
				or not _allowed_role_protocol(str(selection["role"]),
						str(selection["protocol"])) \
				or str(selection["platform"]) != "windows" \
				or str(selection["arch"]) != "x86_64":
			return false
		var tuple := _artifact_tuple(selection)
		if tuples.has(tuple):
			return false
		tuples[tuple] = true
	return tuples.size() == 2 \
			and _selection_has_role(context["required_artifacts"], ROLE_DESKTOP) \
			and _selection_has_role(context["required_artifacts"], ROLE_HELPER)


static func _valid_artifact(artifact: Dictionary) -> bool:
	return _exact_keys(artifact, ARTIFACT_KEYS) \
			and _type(artifact, "role", TYPE_STRING) \
			and _type(artifact, "platform", TYPE_STRING) \
			and _type(artifact, "arch", TYPE_STRING) \
			and _type(artifact, "filename", TYPE_STRING) \
			and _json_uint(artifact, "size", 1) \
			and _type(artifact, "sha256", TYPE_STRING) \
			and _type(artifact, "protocol", TYPE_STRING) \
			and _token(str(artifact["role"])) \
			and _token(str(artifact["platform"])) \
			and _token(str(artifact["arch"])) \
			and _filename(str(artifact["filename"])) \
			and int(artifact["size"]) > 0 \
			and WindowsUpdateProtocol.valid_sha256(str(artifact["sha256"])) \
			and str(artifact["platform"]) == "windows" \
			and str(artifact["arch"]) == "x86_64" \
			and _allowed_role_protocol(str(artifact["role"]),
					str(artifact["protocol"]))


static func _artifact_tuple(value: Dictionary) -> String:
	return "%s|%s|%s|%s|%s" % [str(value.get("role", "")),
			str(value.get("platform", "")), str(value.get("arch", "")),
			str(value.get("filename", "")), str(value.get("protocol", ""))]


static func _artifact_order(value: Dictionary) -> String:
	return "%s|%s|%s|%s" % [str(value.get("role", "")),
			str(value.get("platform", "")), str(value.get("arch", "")),
			str(value.get("filename", ""))]


static func _allowed_role_protocol(role: String, protocol: String) -> bool:
	return (role == ROLE_DESKTOP and protocol == PROTOCOL_DESKTOP) \
			or (role == ROLE_HELPER and protocol == PROTOCOL_HELPER)


static func _selection_has_role(selections: Array, role: String) -> bool:
	var count := 0
	for raw: Variant in selections:
		if raw is Dictionary and str(raw.get("role", "")) == role:
			count += 1
	return count == 1


static func _stable_version(version: String) -> bool:
	var parsed := UpdateCheck.parse_version(version)
	if parsed.is_empty() or str(parsed[3]) != "":
		return false
	var parts := version.split(".")
	if parts.size() != 3:
		return false
	for part: String in parts:
		if part.is_empty() or not part.is_valid_int() or str(int(part)) != part:
			return false
	return true


static func version_sequence(version: String) -> int:
	if not _stable_version(version):
		return -1
	var parts := version.split(".")
	var major := int(parts[0])
	var minor := int(parts[1])
	var patch := int(parts[2])
	if major > 2097151 or minor > 2097151 or patch > 2097151:
		return -1
	var sequence := (major << 42) | (minor << 21) | patch
	return sequence if sequence > 0 else -1


static func _utc_timestamp(value: String) -> bool:
	var regex := RegEx.new()
	if regex.compile("^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$") \
			!= OK:
		return false
	var matched := regex.search(value)
	if matched == null:
		return false
	var year := int(matched.get_string(1))
	var month := int(matched.get_string(2))
	var day := int(matched.get_string(3))
	var hour := int(matched.get_string(4))
	var minute := int(matched.get_string(5))
	var second := int(matched.get_string(6))
	if year < 1 or month < 1 or month > 12 or hour > 23 \
			or minute > 59 or second > 59:
		return false
	var days := [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	if month == 2 and (year % 400 == 0 or (year % 4 == 0 and year % 100 != 0)):
		days[1] = 29
	return day >= 1 and day <= int(days[month - 1])


static func _token(value: String) -> bool:
	if value.is_empty() or value.length() > 32:
		return false
	for index in value.length():
		var character := value[index]
		if not ((character >= "a" and character <= "z") \
				or (character >= "0" and character <= "9") \
				or character in ["-", "_"]):
			return false
	return true


static func _filename(value: String) -> bool:
	if value.is_empty() or value.length() > 128 or value.get_file() != value \
			or "/" in value or "\\" in value:
		return false
	for index in value.length():
		var character := value[index]
		if not ((character >= "a" and character <= "z") \
				or (character >= "A" and character <= "Z") \
				or (character >= "0" and character <= "9") \
				or character in ["-", "_", "."]):
			return false
	return true


static func _exact_keys(value: Dictionary, expected: Array[String]) -> bool:
	if value.size() != expected.size():
		return false
	for key: String in expected:
		if not value.has(key):
			return false
	return true


static func _type(value: Dictionary, key: String, expected_type: int) -> bool:
	return value.has(key) and typeof(value[key]) == expected_type


## Godot converte i numeri JSON in float: il lexer RAW qui sopra ha gia provato
## che il token era un intero decimale canonico. Qui si limita il valore al
## dominio rappresentabile esattamente da IEEE-754, sufficiente per size/sequence.
static func _json_uint(value: Dictionary, key: String, minimum: int) -> bool:
	if not value.has(key) or typeof(value[key]) != TYPE_FLOAT:
		return false
	var number := float(value[key])
	return is_finite(number) and number >= float(minimum) \
			and number <= 9007199254740991.0 and floor(number) == number


static func _failure(error: String) -> Dictionary:
	return {"ok": false, "error": error}


static func sha256(bytes: PackedByteArray) -> PackedByteArray:
	var hashing := HashingContext.new()
	if hashing.start(HashingContext.HASH_SHA256) != OK:
		return PackedByteArray()
	if hashing.update(bytes) != OK:
		return PackedByteArray()
	return hashing.finish()
