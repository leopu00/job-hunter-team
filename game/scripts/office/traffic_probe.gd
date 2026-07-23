class_name TrafficProbe
extends Node2D
## Diagnostica visuale attivata soltanto con JHT_TRAFFIC_DEMO=1.
## Campiona i piedi degli agenti in viaggio e lascia una scia: le zone più
## percorse diventano più luminose e indicano dove aprire i vetri.

const SAMPLE_EVERY := 0.10
const MAX_SAMPLES := 9000

var agents: Array = []
var _samples: Array = []
var _clock := 0.0

func setup(p_agents: Array) -> void:
	agents = p_agents
	z_index = 40
	process_mode = Node.PROCESS_MODE_ALWAYS

func _process(delta: float) -> void:
	_clock += delta
	if _clock < SAMPLE_EVERY:
		return
	_clock = 0.0
	for agent in agents:
		if not is_instance_valid(agent) or not agent.has_method("debug_snapshot"):
			continue
		var snap: Dictionary = agent.debug_snapshot()
		if int(snap.get("state", -1)) != AgentNPC.S.TRIP:
			continue
		var dept := str(agent.get("dept"))
		var col: Color = DepartmentDefs.DEPARTMENTS.get(dept, {}).get(
				"color", Color.WHITE)
		_samples.append([agent.global_position, col])
	if _samples.size() > MAX_SAMPLES:
		_samples = _samples.slice(_samples.size() - MAX_SAMPLES)
	queue_redraw()

func _draw() -> void:
	for sample in _samples:
		var col: Color = sample[1]
		draw_circle(sample[0], 7.0, Color(col.r, col.g, col.b, 0.075))
