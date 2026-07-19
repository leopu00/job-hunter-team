extends SceneTree
## Verifica che le cinque pile e pipeline_counts condividano esattamente
## gli stessi predicati status/write_requested.

func _init() -> void:
	var rows: Array = [
		{"id": 1, "status": "new", "write_requested": 0},
		{"id": 2, "status": "checked", "write_requested": 0},
		{"id": 3, "status": "scored", "write_requested": 0},
		{"id": 4, "status": "scored", "write_requested": 1},
		{"id": 5, "status": "writing", "write_requested": 1},
		{"id": 6, "status": "review", "write_requested": 1},
		{"id": 7, "status": "ready", "write_requested": 1,
				"critic_verdict": "PASS"},
	]
	var got := {}
	for dept in DepartmentDefs.DEPT_ORDER:
		got[dept] = PipelineQueueDefs.positions_for(dept, rows).map(
				func(p: Dictionary) -> int: return int(p["id"]))
	var expected := {
		"scout": [1], "analisti": [2], "scorer": [3],
		"scrittori": [6], "critici": [7],
	}
	var pile := PaperPile.new(Vector2.ZERO)
	pile.set_target(10, true)
	var exact_count := pile.count == 10 \
			and int(pile.debug_snapshot()["visual_sheets"]) == 10
	pile.take_sheet()
	pile.add_sheets(2)
	exact_count = exact_count and pile.count == 11 \
			and int(pile.debug_snapshot()["visual_sheets"]) == 11
	pile.set_target(472, true)
	var distributed := int(pile.debug_snapshot()["visual_sheets"]) == 472 \
			and int(pile.debug_snapshot()["visual_stacks"]) == 12
	pile.free()
	var escaped_emoji := "\\" + "U0001F310"
	var markdown := TerminalTheme._markdown_to_bbcode("**forte** [test] " + escaped_emoji)
	var ok := got == expected and exact_count and distributed \
			and markdown == "[b]forte[/b] [lb]test[rb] 🌐"
	print("PIPELINE-QUEUE-TEST ", "PASS " if ok else "FAIL ", JSON.stringify(got))
	quit(0 if ok else 1)
