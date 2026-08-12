extends SceneTree
## Targeted contract test for WIN-DIALOGUES-MONOLINGUAL.
## Run:
##   godot --headless --path game --script res://tools/dialogue_i18n_selftest.gd

const EXPECTED_TREES := 38
const EXPECTED_NODES := 222
const EXPECTED_CHOICES := 138
const EXPECTED_DYNAMIC_SHELLS := 8

var _failures: Array[String] = []


func _init() -> void:
	var nodes := 0
	var choices := 0
	var ids := {}
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
			for locale: String in UIStrings.LANGS:
				var resolved := Dialogues.node_text(tree_id, node_id, locale)
				_check(resolved != "", "%s empty in %s" % [node_key, locale])
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
	_check(Dialogues.greeting_for_hour(9, "en") == "Good morning",
			"greeting does not pass through authored resolver")
	_check(Dialogues.positions_summary(3, "en").contains("3"),
			"position summary lost its data placeholder")

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
	_check(onboarding_source.contains('if str(clean.get("kind", "")) == "dialogue_choice"'),
			"localized narrative label can still enter model context")

	if _failures.is_empty():
		print("DIALOGUE-I18N-TEST PASS (38 trees, 360 IDs, 7 locales, residue 2208)")
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
	regex.compile("\\{[a-z_]+\\}")
	var found: Array[String] = []
	for item in regex.search_all(text):
		found.append(item.get_string())
	found.sort()
	return PackedStringArray(found)
