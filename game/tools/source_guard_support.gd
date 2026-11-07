extends RefCounted
## Test-only acquisition and multiset comparison. Callers supply the real scanner.
## Paths and raw-byte hashes are provenance, never substitutes for semantic IDs.


static func read_tree(directory: String, suffix := ".gd") -> Dictionary:
	var result := {"sources": {}, "sha256": {}, "errors": []}
	if directory.is_empty() or suffix.is_empty():
		result.errors.append("source guard requires an explicit directory and suffix")
		return result
	_walk(directory, suffix, result, 0)
	if result.sources.is_empty() and result.errors.is_empty():
		result.errors.append("source guard acquired no files: " + directory)
	return result


static func read_paths(paths: Array) -> Dictionary:
	var result := {"sources": {}, "sha256": {}, "errors": []}
	if paths.is_empty():
		result.errors.append("source guard requires nonempty explicit paths")
	for path in paths:
		if typeof(path) != TYPE_STRING or str(path).is_empty():
			result.errors.append("source guard path must be a nonempty string")
		elif result.sources.has(path):
			result.errors.append("source guard repeated an input path: " + str(path))
		else:
			_read_file(str(path), result)
	return result


static func _walk(directory: String, suffix: String, result: Dictionary, depth: int) -> void:
	if depth > 64:
		result.errors.append("source guard directory depth exceeded: " + directory)
		return
	var dir := DirAccess.open(directory)
	if dir == null:
		result.errors.append("source guard cannot open directory: " + directory)
		return
	var entries: Array[String] = []
	var directories := {}
	var error := dir.list_dir_begin()
	if error != OK:
		result.errors.append("source guard cannot list directory: " + directory)
		return
	var entry := dir.get_next()
	while entry != "":
		entries.append(entry)
		directories[entry] = dir.current_is_dir()
		entry = dir.get_next()
	dir.list_dir_end()
	entries.sort_custom(_utf8_less)
	for name in entries:
		var path := directory.path_join(name)
		if directories[name]:
			if not name.begins_with("."):
				_walk(path, suffix, result, depth + 1)
		elif name.ends_with(suffix):
			_read_file(path, result)


static func _read_file(path: String, result: Dictionary) -> void:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty():
		result.errors.append("source guard input missing, unreadable or empty: " + path)
		return
	var text := bytes.get_string_from_utf8()
	if text.to_utf8_buffer() != bytes:
		result.errors.append("source guard input is not lossless UTF-8: " + path)
		return
	var digest := HashingContext.new()
	if digest.start(HashingContext.HASH_SHA256) != OK or digest.update(bytes) != OK:
		result.errors.append("source guard could not hash input: " + path)
		return
	result.sources[path] = text
	result.sha256[path] = digest.finish().hex_encode()


## The callback returns {inputs: [semantic IDs], matches: [result IDs]} per file.
## Repeated IDs retain multiplicity; empty matches require nonempty real inputs.
static func observe(acquisition: Dictionary, guard: String, scanner: Callable) -> Dictionary:
	var errors: Array = acquisition.get("errors", ["source acquisition is missing"]).duplicate()
	var inputs: Array = []
	var matches: Array = []
	if guard.is_empty() or not scanner.is_valid():
		errors.append("source guard requires an ID and real scanner")
	if not errors.is_empty():
		return {"errors": errors}
	var sources: Dictionary = acquisition.get("sources", {})
	if sources.is_empty():
		return {"errors": ["source guard acquisition is empty"]}
	for path in sources:
		var found: Variant = scanner.call(path, sources[path])
		if typeof(found) != TYPE_DICTIONARY:
			errors.append("source guard scanner did not return an observation: " + str(path))
			continue
		for field in ["inputs", "matches"]:
			if not found.has(field) or not _names_valid(found[field]):
				errors.append("source guard scanner returned invalid " + field + ": " + str(path))
		if not errors.is_empty():
			continue
		inputs.append_array(found.inputs)
		matches.append_array(found.matches)
	if inputs.is_empty():
		errors.append("source guard did not observe any pertinent input")
	if not errors.is_empty():
		return {"errors": errors}
	return {"errors": [], "inputs": _multiset(guard + ".inputs", inputs),
		"matches": _multiset(guard + ".matches", matches)}


static func _names_valid(names: Variant) -> bool:
	if typeof(names) != TYPE_ARRAY:
		return false
	for name in names:
		if typeof(name) != TYPE_STRING or str(name).is_empty():
			return false
	return true


static func _multiset(guard: String, names: Array) -> Dictionary:
	var counts := {}
	for name in names:
		counts[name] = int(counts.get(name, 0)) + 1
	var ordered: Array = counts.keys()
	ordered.sort_custom(_utf8_less)
	var elements: Array = []
	for name in ordered:
		elements.append({"name": name, "count": counts[name]})
	return {"version": 1, "guard": guard, "total": names.size(), "elements": elements}


static func compare(observed: Dictionary, expected_inputs: Dictionary,
		expected_matches: Dictionary) -> Array[String]:
	var errors: Array[String] = []
	if not observed.has("errors") or not observed.errors.is_empty():
		errors.append("source guard acquisition/scanner failed: " + str(observed.get("errors")))
		return errors
	if not observed.has("inputs") or not observed.has("matches"):
		return ["source guard observation lacks input or match snapshot"]
	errors.append_array(snapshot_differences(observed.inputs, expected_inputs))
	errors.append_array(snapshot_differences(observed.matches, expected_matches))
	if not _integer(observed.inputs.get("total"), 1):
		errors.append("source guard input snapshot must be nonempty")
	return errors


static func snapshot_differences(actual: Dictionary, expected: Dictionary) -> Array[String]:
	var errors := _schema_errors(actual)
	errors.append_array(_schema_errors(expected))
	if not errors.is_empty():
		return errors
	if actual.guard != expected.guard:
		errors.append("source guard identity changed: " + str(actual.guard))
	if actual.total != expected.total:
		errors.append("source guard total changed: " + str(actual.guard))
	if not _elements_equal(actual.elements, expected.elements):
		errors.append("source guard names or multiplicities changed: " + str(actual.guard))
	return errors


static func _elements_equal(actual: Array, expected: Array) -> bool:
	if actual.size() != expected.size():
		return false
	for index in range(actual.size()):
		if actual[index].name != expected[index].name \
				or int(actual[index].count) != int(expected[index].count):
			return false
	return true


static func _schema_errors(snapshot: Dictionary) -> Array[String]:
	var errors: Array[String] = []
	for key in ["version", "guard", "total", "elements"]:
		if not snapshot.has(key):
			errors.append("source guard snapshot missing field: " + key)
	if not errors.is_empty():
		return errors
	if snapshot.size() != 4 or not _integer(snapshot.version, 1) or snapshot.version != 1:
		errors.append("source guard snapshot has unknown fields or version")
	if typeof(snapshot.guard) != TYPE_STRING or str(snapshot.guard).is_empty():
		errors.append("source guard snapshot has no identity")
	if not _integer(snapshot.total, 0) or typeof(snapshot.elements) != TYPE_ARRAY:
		errors.append("source guard snapshot has invalid total or elements")
		return errors
	var total := 0
	var previous := ""
	for element in snapshot.elements:
		if typeof(element) != TYPE_DICTIONARY or element.size() != 2:
			errors.append("source guard element has invalid fields")
			continue
		if typeof(element.get("name")) != TYPE_STRING or str(element.get("name")).is_empty():
			errors.append("source guard element has no name")
			continue
		if not _integer(element.get("count"), 1):
			errors.append("source guard element count must be a positive safe integer")
			continue
		var name: String = element.name
		if not previous.is_empty() and not _utf8_less(previous, name):
			errors.append("source guard names must be unique and ordered by UTF-8 bytes")
		previous = name
		if int(element.count) > 9007199254740991 - total:
			errors.append("source guard sum exceeds safe integer range")
			return errors
		total += int(element.count)
	if total != snapshot.total:
		errors.append("source guard total differs from sum of multiplicities")
	return errors


static func _integer(value: Variant, minimum: int) -> bool:
	if typeof(value) != TYPE_INT and typeof(value) != TYPE_FLOAT:
		return false
	return is_finite(float(value)) and value >= minimum and value <= 9007199254740991 \
		and value == int(value)


static func _utf8_less(a: String, b: String) -> bool:
	var left := a.to_utf8_buffer()
	var right := b.to_utf8_buffer()
	for index in range(mini(left.size(), right.size())):
		if left[index] != right[index]:
			return left[index] < right[index]
	return left.size() < right.size()
