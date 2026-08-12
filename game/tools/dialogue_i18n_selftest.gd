extends SceneTree
## Targeted contract test for WIN-DIALOGUES-MONOLINGUAL.
## Run:
##   godot --headless --path game --script res://tools/dialogue_i18n_selftest.gd

const EXPECTED_TREES := 38
const EXPECTED_NODES := 221
const EXPECTED_CHOICES := 138
const EXPECTED_DYNAMIC_SHELLS := 8
const EXPECTED_TRANSLATED_CELLS := 2202
const FORBIDDEN_ENGLISH_FRAGMENTS := [
	"Research", "Analysis", "Quality Check", "Office Home", "escritório home",
	"Applications", "Operations", "Setup", "setup", "READY CVS", "READY CVs",
]
## Common English narrative/UI words that are not product names in any locale.
## Unlike the incident list above, this is an open lexical net: it catches new
## untranslated copy even when review has never seen that exact phrase.
const FORBIDDEN_ENGLISH_WORDS := [
	"Hello", "Welcome", "Please", "Thanks", "Sorry", "Ready", "Later",
	"Working", "Update", "Start", "Stop", "Open", "Close", "Click",
	"Writer", "Critic", "Maintainer", "Scout", "Coordinator",
]
const LOCALE_FORBIDDEN_ROLE_NAMES := {
	"de": ["Sentinel", "Doctor"],
	"es": ["Sentinel"],
	"fr": ["Sentinel"],
	"hu": ["Sentinel"],
	"pt": ["Sentinel"],
}
const LOCALE_FORBIDDEN_COPY := {
	"de": ["Guide", "Updates", "Check-in", "Check-up"],
	"es": ["Check-in", "Check-up"],
	"fr": ["Check-in", "Check-up"],
	"hu": ["Check-in", "Check-up"],
	"it": ["Check-in", "Check-up"],
	"pt": ["Check-in", "Check-up"],
}

var _failures: Array[String] = []


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var nodes := 0
	var choices := 0
	var ids := {}
	var sources := {}
	for tree_id: String in Dialogues.TREES:
		var tree: Dictionary = Dialogues.TREES[tree_id]
		for node_id: String in tree:
			nodes += 1
			var node: Dictionary = tree[node_id]
			var node_key := Dialogues.node_text_id(tree_id, node_id)
			_check(node_key == "dialogue.%s.%s.line" % [tree_id, node_id],
					"node ID unstable: " + node_key)
			_check(not ids.has(node_key), "duplicate ID: " + node_key)
			ids[node_key] = true
			var source_line := str(node.get("text", ""))
			var source_emotion := str(Dialogues.parse_emotion(source_line)[0])
			sources[node_key] = str(Dialogues.parse_emotion(source_line)[1])
			for locale: String in UIStrings.LANGS:
				var resolved := Dialogues.node_text(tree_id, node_id, locale)
				_check(resolved != "", "%s empty in %s" % [node_key, locale])
				_check(str(Dialogues.parse_emotion(resolved)[0]) == source_emotion,
						"%s structural emotion drift in %s" % [node_key, locale])
				_check(_placeholders(resolved) == _placeholders(source_line),
						"%s placeholder drift in %s" % [node_key, locale])
				if locale == UIStrings.DEFAULT_LANG:
					_check(resolved == source_line, node_key + " changed in EN")
			var targets := {}
			for choice: Dictionary in node.get("choices", []):
				choices += 1
				var target := str(choice.get("next", ""))
				_check(target != "", "%s has a choice without next_id" % node_key)
				_check(not targets.has(target),
						"%s has duplicate choice target %s" % [node_key, target])
				targets[target] = true
				var choice_key := Dialogues.choice_text_id(tree_id, node_id, target)
				_check(choice_key == "dialogue.%s.%s.choice.%s" % [
						tree_id, node_id, target], "choice ID unstable: " + choice_key)
				_check(not ids.has(choice_key), "duplicate ID: " + choice_key)
				ids[choice_key] = true
				var source_choice := str(choice.get("text", ""))
				sources[choice_key] = source_choice
				for locale: String in UIStrings.LANGS:
					var resolved_choice := Dialogues.choice_text(
							tree_id, node_id, choice, locale)
					_check(resolved_choice != "",
							"%s empty in %s" % [choice_key, locale])
					_check(_placeholders(resolved_choice) == _placeholders(source_choice),
							"%s placeholder drift in %s" % [choice_key, locale])

	_check(Dialogues.TREES.size() == EXPECTED_TREES,
			"tree census %d != %d" % [Dialogues.TREES.size(), EXPECTED_TREES])
	_check(nodes == EXPECTED_NODES, "node census %d != %d" % [nodes, EXPECTED_NODES])
	_check(choices == EXPECTED_CHOICES,
			"choice census %d != %d" % [choices, EXPECTED_CHOICES])
	_check(ids.size() == EXPECTED_NODES + EXPECTED_CHOICES,
			"canonical ID census mismatch: %d" % ids.size())
	_check(UIStrings.LANGS.size() == 7, "language contract is not seven locales")
	_check(Dialogues.dynamic_shell_ids().size() == EXPECTED_DYNAMIC_SHELLS,
			"dynamic shell census drift")
	for dynamic_key: String in Dialogues.DYNAMIC_SHELLS:
		sources[dynamic_key] = str(Dialogues.DYNAMIC_SHELLS[dynamic_key])
	_check(sources.size() == EXPECTED_NODES + EXPECTED_CHOICES \
			+ EXPECTED_DYNAMIC_SHELLS, "authored source census mismatch")
	_check_locale_catalogs(sources)
	_check(Dialogues.greeting_for_hour(9, "en") == "Good morning",
			"greeting does not pass through authored resolver")
	_check(Dialogues.positions_summary(3, "en").contains("3"),
			"position summary lost its data placeholder")
	var activation_source := str(Dialogues.DYNAMIC_SHELLS[
			"dialogue.dynamic.runtime.docker_running"])
	var activation_actor_contract := {
		"de": ["Bestätigen Sie", "bestätige ich"],
		"es": ["confirma la activación", "confirmo la activación"],
		"pt": ["confirme a ativação", "confirmo a ativação"],
	}
	for locale: String in activation_actor_contract:
		var activation := UIStrings.authored(
				"dialogue.dynamic.runtime.docker_running", activation_source, locale)
		var actor_terms: Array = activation_actor_contract[locale]
		_check(activation.contains(str(actor_terms[0])) \
				and not activation.contains(str(actor_terms[1])),
				"%s activation instruction changes the actor" % locale)

	var ui_source := FileAccess.get_file_as_string(
			"res://scripts/dialogue/dialogue_ui.gd")
	_check(ui_source.contains("Dialogues.node_text(_tree_id, _node_id"),
			"DialogueUI still reads node literal directly")
	_check(ui_source.contains("Dialogues.choice_text(_tree_id, _node_id"),
			"DialogueUI still reads choice literal directly")
	_check(ui_source.contains("Dialogues.choice_text_id(_tree_id, _node_id"),
			"recorded choice has no canonical narrative ID")

	var onboarding_source := FileAccess.get_file_as_string(
			"res://scripts/setup/scripted_onboarding.gd")
	_check(onboarding_source.contains('"kind": "dialogue_choice"'),
			"new dialogue choices are not distinguished from narrative labels")
	_check(onboarding_source.contains('str(clean.get("kind", "")) == "dialogue_choice"'),
			"localized narrative label can still enter model context")

	if _failures.is_empty():
		print("DIALOGUE-I18N-TEST PASS " \
				+ "(38 trees, 367 IDs, 7 locales, 2202 translated cells)")
		quit(0)
		return
	for failure in _failures:
		push_error("[dialogue-i18n] " + failure)
	print("DIALOGUE-I18N-TEST FAIL (%d problems)" % _failures.size())
	quit(1)


func _check(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)


static func _placeholders(text: String) -> PackedStringArray:
	var regex := RegEx.new()
	regex.compile("\\{[a-z_]+\\}|%[a-z]")
	var found: Array[String] = []
	for item in regex.search_all(text):
		found.append(item.get_string())
	found.sort()
	return PackedStringArray(found)


static func _contains_word(text: String, word: String) -> bool:
	var regex := RegEx.new()
	regex.compile("(^|[^A-Za-z])%s([^A-Za-z]|$)" % word)
	return regex.search(text) != null


func _check_locale_catalogs(sources: Dictionary) -> void:
	var translated_cells := 0
	for locale: String in UIStrings.LANGS:
		if locale == UIStrings.DEFAULT_LANG:
			continue
		var path := "res://scripts/i18n/dialogue_%s.gd" % locale
		_check(ResourceLoader.exists(path), "missing locale catalog: " + path)
		if not ResourceLoader.exists(path):
			continue
		var script: GDScript = load(path)
		var catalog: Dictionary = script.get_script_constant_map().get("S", {})
		_check(catalog.size() == sources.size(),
				"%s catalog has %d/%d keys" % [
						locale, catalog.size(), sources.size()])
		for key: String in sources:
			_check(catalog.has(key), "%s missing %s" % [locale, key])
			if not catalog.has(key):
				continue
			translated_cells += 1
			var translated := str(catalog[key])
			_check(translated.strip_edges() != "", "%s empty in %s" % [key, locale])
			for fragment: String in FORBIDDEN_ENGLISH_FRAGMENTS:
				_check(not translated.contains(fragment),
						"%s retains English fragment '%s' in %s" % [
								key, fragment, locale])
			for word: String in FORBIDDEN_ENGLISH_WORDS:
				_check(not _contains_word(translated, word),
						"%s retains common English word '%s' in %s" % [
								key, word, locale])
			for role_name: String in LOCALE_FORBIDDEN_ROLE_NAMES.get(locale, []):
				_check(not _contains_word(translated, role_name),
						"%s retains English role '%s' in %s" % [
								key, role_name, locale])
			for fragment: String in LOCALE_FORBIDDEN_COPY.get(locale, []):
				_check(not _contains_word(translated, fragment),
						"%s retains English copy '%s' in %s" % [
								key, fragment, locale])
			_check(translated != str(sources[key]) \
					or _placeholders(translated).size() > 0 \
					and translated.strip_edges().begins_with("{"),
					"%s still uses English copy in %s" % [key, locale])
			_check(_placeholders(translated) == _placeholders(str(sources[key])),
					"%s placeholder drift in %s" % [key, locale])
			_check(UIStrings.authored(key, str(sources[key]), locale) == translated,
					"%s catalog is not wired in %s" % [key, locale])
		for key: String in catalog:
			_check(sources.has(key), "%s orphan key %s" % [locale, key])
	_check(translated_cells == EXPECTED_TRANSLATED_CELLS,
			"translated cell census %d != %d" % [
					translated_cells, EXPECTED_TRANSLATED_CELLS])
