extends SceneTree
## Synthetic fixtures only. Does not import or execute production scripts.
## godot --headless --path game --script res://tools/source_guard_support_selftest.gd

const Support := preload("res://tools/source_guard_support.gd")
const GUARD := "synthetic.signals"
const CONTENT := "# synthetic.signal:beta\n# synthetic.signal:alpha\n# synthetic.signal:alpha\n"
const INPUTS := {"version": 1, "guard": GUARD + ".inputs", "total": 1,
	"elements": [{"name": "synthetic.source", "count": 1}]}
const MATCHES := {"version": 1, "guard": GUARD + ".matches", "total": 3,
	"elements": [{"name": "alpha", "count": 2}, {"name": "beta", "count": 1}]}

var _failures: Array[String] = []
var _fixture := ""
var _owned_files: Array[String] = []
var _cases: Array[String] = []
var _completed: Array[String] = []


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var temporary := OS.get_environment("TMPDIR")
	if temporary.is_empty():
		temporary = OS.get_environment("TEMP")
	if temporary.is_empty():
		temporary = OS.get_cache_dir()
	_fixture = temporary.path_join("source-guard-synthetic-%d-%d" % [
		OS.get_process_id(), Time.get_ticks_usec()])
	if DirAccess.dir_exists_absolute(_fixture) or FileAccess.file_exists(_fixture):
		_failures.append("synthetic fixture path already exists")
		_finish()
		return
	if DirAccess.make_dir_recursive_absolute(_fixture) != OK:
		_failures.append("cannot create synthetic fixture directory")
		_finish()
		return
	_test_empty_acquisitions()
	_test_original_and_nested()
	_test_loss_duplication_and_addition()
	_test_zero_matches_require_input()
	_test_scanner_failures()
	_test_schema()
	_test_same_total_snapshots()
	_test_same_total_signals()
	_test_utf8_and_json()
	_cleanup()
	_finish()


func _scan(_path: String, text: String) -> Dictionary:
	var parser := RegEx.new()
	parser.compile("synthetic\\.signal:([a-z]+)")
	var names: Array = []
	for hit in parser.search_all(text):
		names.append(hit.get_string(1))
	return {"inputs": ["synthetic.source"], "matches": names}


func _observed() -> Dictionary:
	return Support.observe(Support.read_tree(_fixture), GUARD, _scan)


func _check(name: String, condition: bool) -> void:
	_cases.append(name)
	if not condition:
		_failures.append(name)


func _write(relative: String, content: String) -> bool:
	var path := _fixture.path_join(relative)
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		_failures.append("cannot write synthetic fixture: " + relative)
		return false
	if not _owned_files.has(path):
		_owned_files.append(path)
	file.store_string(content)
	if file.get_error() != OK:
		file.close()
		_failures.append("cannot complete synthetic fixture: " + relative)
		return false
	file.close()
	return true


func _remove(relative: String) -> void:
	var path := _fixture.path_join(relative)
	if FileAccess.file_exists(path) and DirAccess.remove_absolute(path) != OK:
		_failures.append("cannot remove owned synthetic fixture: " + relative)


func _test_empty_acquisitions() -> void:
	_check("empty directory is an acquisition error",
		not Support.read_tree(_fixture).errors.is_empty())
	_check("missing directory is an acquisition error",
		not Support.read_tree(_fixture.path_join("absent")).errors.is_empty())
	_check("empty explicit paths are an acquisition error",
		not Support.read_paths([]).errors.is_empty())
	_check("missing explicit file is an acquisition error",
		not Support.read_paths([_fixture.path_join("absent.gd")]).errors.is_empty())
	if not _write("empty.gd", ""):
		return
	_check("empty file cannot become an empty successful observation",
		not Support.compare(_observed(), INPUTS, MATCHES).is_empty())
	_remove("empty.gd")
	_completed.append("empty")


func _test_original_and_nested() -> void:
	if not _write("original.gd", CONTENT):
		return
	var original := _observed()
	_check("original scanner names and multiplicities match",
		Support.compare(original, INPUTS, MATCHES).is_empty())
	var before := Support.read_tree(_fixture)
	var path := _fixture.path_join("original.gd")
	_check("raw-byte witness matches acquired synthetic content",
		before.sha256.get(path) == CONTENT.sha256_text())
	_check("repeated explicit input path is refused",
		not Support.read_paths([path, path]).errors.is_empty())
	var nested := _fixture.path_join("nested/deeper")
	if DirAccess.make_dir_recursive_absolute(nested) != OK:
		_failures.append("cannot create owned nested fixture directories")
		return
	var moved := nested.path_join("part.gd")
	_owned_files.append(moved)
	if DirAccess.rename_absolute(path, moved) != OK:
		_failures.append("cannot move synthetic source into a real nested directory")
		return
	var after := Support.read_tree(_fixture)
	_check("reader discovers actual relocated file", after.sources.has(moved)
		and not after.sources.has(path))
	_check("relocation preserves original bytes", after.sha256.get(moved) == before.sha256.get(path))
	_check("relocation preserves semantic IDs and multiplicities",
		Support.compare(_observed(), INPUTS, MATCHES).is_empty())
	if DirAccess.rename_absolute(moved, path) != OK:
		_failures.append("cannot restore owned synthetic fixture after nested move")
	_completed.append("nested")


func _test_loss_duplication_and_addition() -> void:
	if not _write("original.gd", "# synthetic.signal:alpha\n"):
		return
	_check("lost result is refused", not Support.compare(_observed(), INPUTS, MATCHES).is_empty())
	if not _write("original.gd", CONTENT) or not _write("duplicate.gd", CONTENT):
		return
	_check("duplicate source preserves two input occurrences",
		_observed().inputs.total == 2)
	_check("duplicate results are refused", not Support.compare(_observed(), INPUTS, MATCHES).is_empty())
	_remove("duplicate.gd")
	if not _write("original.gd", CONTENT + "# synthetic.signal:gamma\n"):
		return
	_check("added result is refused", not Support.compare(_observed(), INPUTS, MATCHES).is_empty())
	_remove("original.gd")
	_check("lost source is refused", not Support.compare(_observed(), INPUTS, MATCHES).is_empty())
	_write("original.gd", CONTENT)
	_completed.append("mutations")


func _test_zero_matches_require_input() -> void:
	if not _write("original.gd", "# synthetic source without signals\n"):
		return
	var empty_matches := {"version": 1, "guard": GUARD + ".matches", "total": 0, "elements": []}
	_check("zero matches are valid with one acquired pertinent source",
		Support.compare(_observed(), INPUTS, empty_matches).is_empty())
	_remove("original.gd")
	_check("zero matches cannot hide a lost input",
		not Support.compare(_observed(), INPUTS, empty_matches).is_empty())
	_write("original.gd", CONTENT)
	_completed.append("zero")


func _test_scanner_failures() -> void:
	var acquisition := Support.read_tree(_fixture)
	var no_inputs := func(_path: String, _text: String) -> Dictionary:
		return {"inputs": [], "matches": []}
	_check("scanner must identify pertinent inputs",
		not Support.observe(acquisition, GUARD, no_inputs).errors.is_empty())
	var malformed := func(_path: String, _text: String) -> Dictionary:
		return {"inputs": ["synthetic.source"], "matches": [1]}
	_check("scanner IDs must be strings",
		not Support.observe(acquisition, GUARD, malformed).errors.is_empty())
	_check("invalid callback is an explicit error",
		not Support.observe(acquisition, GUARD, Callable()).errors.is_empty())
	_completed.append("scanner")


func _test_schema() -> void:
	var mutations := [
		{"field": "version", "value": 2}, {"field": "total", "value": 2},
		{"field": "total", "value": 3.5}, {"field": "guard", "value": ""},
		{"field": "elements", "value": [{"name": "alpha", "count": 0}]},
		{"field": "elements", "value": [{"name": "alpha", "count": 1},
			{"name": "alpha", "count": 2}]},
		{"field": "elements", "value": [{"name": "beta", "count": 1},
			{"name": "alpha", "count": 2}]},
	]
	for index in range(mutations.size()):
		var changed: Dictionary = MATCHES.duplicate(true)
		changed[mutations[index].field] = mutations[index].value
		_check("invalid snapshot schema %d is refused" % index,
			not Support.snapshot_differences(MATCHES, changed).is_empty())
	var extra: Dictionary = MATCHES.duplicate(true)
	extra["unexpected"] = true
	_check("unknown snapshot field is refused",
		not Support.snapshot_differences(MATCHES, extra).is_empty())
	var wrong_guard: Dictionary = MATCHES.duplicate(true)
	wrong_guard.guard = "another.matches"
	_check("snapshot cannot satisfy another guard",
		not Support.snapshot_differences(MATCHES, wrong_guard).is_empty())
	_completed.append("schema")


func _test_same_total_snapshots() -> void:
	var changes := [
		{"label": "names", "elements": [{"name": "beta", "count": 1},
			{"name": "gamma", "count": 2}]},
		{"label": "multiplicities", "elements": [{"name": "alpha", "count": 1},
			{"name": "beta", "count": 2}]},
	]
	var observed := {"errors": [], "inputs": INPUTS, "matches": MATCHES}
	for change in changes:
		var changed: Dictionary = MATCHES.duplicate(true)
		changed.elements = change.elements
		_check("same-total %s snapshot has valid schema" % change.label,
			Support.snapshot_differences(changed, changed).is_empty())
		_check("same-total %s keeps guard and total" % change.label,
			changed.guard == MATCHES.guard and changed.total == MATCHES.total)
		_check("snapshot comparator rejects same-total " + str(change.label),
			not Support.snapshot_differences(MATCHES, changed).is_empty())
		_check("observation comparator rejects same-total " + str(change.label),
			not Support.compare(observed, INPUTS, changed).is_empty())
	_completed.append("same-total-snapshots")


func _test_same_total_signals() -> void:
	var changes := [
		{"label": "names", "content": "# synthetic.signal:beta\n"
			+ "# synthetic.signal:gamma\n# synthetic.signal:gamma\n"},
		{"label": "multiplicities", "content": "# synthetic.signal:alpha\n"
			+ "# synthetic.signal:beta\n# synthetic.signal:beta\n"},
	]
	for change in changes:
		if not _write("original.gd", change.content):
			return
		var observed := _observed()
		_check("same-total signal %s acquired successfully" % change.label,
			observed.errors.is_empty())
		if not observed.errors.is_empty():
			return
		_check("same-total signal %s keeps inputs and match identity" % change.label,
			Support.snapshot_differences(observed.inputs, INPUTS).is_empty()
			and observed.matches.guard == MATCHES.guard and observed.matches.total == 3)
		_check("real reader and scanner reject same-total signal " + str(change.label),
			not Support.compare(observed, INPUTS, MATCHES).is_empty())
	_write("original.gd", CONTENT)
	_completed.append("same-total-signals")


func _test_utf8_and_json() -> void:
	var unicode := func(_path: String, _text: String) -> Dictionary:
		return {"inputs": ["synthetic.source"], "matches": ["Ω", "é", "a", "é"]}
	var observation := Support.observe(Support.read_tree(_fixture), "synthetic.utf8", unicode)
	var expected := {"version": 1, "guard": "synthetic.utf8.matches", "total": 4,
		"elements": [{"name": "a", "count": 1}, {"name": "é", "count": 2},
			{"name": "Ω", "count": 1}]}
	_check("snapshot order uses UTF-8 bytes and keeps repetitions",
		Support.snapshot_differences(observation.matches, expected).is_empty())
	var decoded: Variant = JSON.parse_string(JSON.stringify(MATCHES))
	_check("JSON numeric representation preserves snapshot equivalence",
		Support.snapshot_differences(MATCHES, decoded).is_empty())
	_completed.append("encoding")


func _cleanup() -> void:
	for path in _owned_files:
		if FileAccess.file_exists(path) and DirAccess.remove_absolute(path) != OK:
			_failures.append("cannot remove owned synthetic file")
	for relative in ["nested/deeper", "nested", ""]:
		var path := _fixture if relative == "" else _fixture.path_join(relative)
		if DirAccess.dir_exists_absolute(path) and DirAccess.remove_absolute(path) != OK:
			_failures.append("cannot remove owned synthetic directory")


func _finish() -> void:
	if _completed != ["empty", "nested", "mutations", "zero", "scanner", "schema",
			"same-total-snapshots", "same-total-signals", "encoding"]:
		_failures.append("synthetic selftest did not finish every section: " + str(_completed))
	if _failures.is_empty():
		print("SOURCE-GUARD-SUPPORT-TEST PASS (%d synthetic checks)" % _cases.size())
		quit(0)
	else:
		for failure in _failures:
			push_error("[source-guard-support] " + failure)
		print("SOURCE-GUARD-SUPPORT-TEST FAIL")
		quit(1)
