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
		{"id": 7, "status": "ready", "write_requested": 1},
	]
	var got := {}
	for dept in DepartmentDefs.DEPT_ORDER:
		got[dept] = PipelineQueueDefs.positions_for(dept, rows).map(
				func(p: Dictionary) -> int: return int(p["id"]))
	var expected := {
		"scout": [1], "analisti": [2], "scorer": [3],
		"scrittori": [4, 5, 6], "critici": [7],
	}
	var ok := got == expected
	print("PIPELINE-QUEUE-TEST ", "PASS " if ok else "FAIL ", JSON.stringify(got))
	quit(0 if ok else 1)
