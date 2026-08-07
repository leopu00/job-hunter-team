class_name PipelineQueueDefs
## Mapping puro pile→fasi. Non dipende dalla scena né dagli autoload, così
## può essere testato anche dal runner Godot --script.

const QUEUES := {
	"scout": {"consumer": "queue.consumer.analysts", "phase": "to_analyze"},
	"analisti": {"consumer": "queue.consumer.scorers", "phase": "analyzed"},
	"scorer": {"consumer": "queue.consumer.writers", "phase": "with_score"},
	"scrittori": {"consumer": "queue.consumer.critics", "phase": "written"},
	"critici": {"consumer": "queue.consumer.ready", "phase": "cv_ready"},
}

static func positions_for(dept_id: String, positions: Array) -> Array:
	var result: Array = []
	for raw in positions:
		var p: Dictionary = raw
		if matches(dept_id, p):
			result.append(p)
	return result

static func matches(dept_id: String, p: Dictionary) -> bool:
	var status := str(p.get("status", ""))
	var requested := int(p.get("write_requested", 0)
			if p.get("write_requested") != null else 0) == 1
	var verdict := str(p.get("critic_verdict", "")
			if p.get("critic_verdict") != null else "").to_upper()
	match dept_id:
		"scout":
			return status == "new"
		"analisti":
			return status == "checked"
		"scorer":
			return status == "scored" and not requested
		"scrittori":
			# Output degli Scrittori: CV terminato e lasciato ai Critici. Le
			# posizioni claimed/in scrittura sono sulla scrivania, non sulla pila.
			return status == "review" or (status == "ready" and verdict != "PASS")
		"critici":
			return status == "ready" and verdict == "PASS"
	return false
