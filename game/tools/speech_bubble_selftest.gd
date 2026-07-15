extends SceneTree
## Self-test headless del contratto delle vignette reali:
## - una raffica superiore alla vecchia coda da quattro non perde messaggi;
## - ogni messaggio resta attivo per almeno 60 secondi simulati.

const SpeechBubbleScript = preload("res://scripts/characters/speech_bubble.gd")

var _failures: Array[String] = []

func _init() -> void:
	call_deferred("_run")

func _run() -> void:
	_test_burst_queue()
	_test_minimum_hold()
	if _failures.is_empty():
		print("[speech-bubble-test] PASS: burst queue + 60s minimum hold")
		quit(0)
		return
	for failure in _failures:
		push_error("[speech-bubble-test] " + failure)
	quit(1)

func _bubble():
	var bubble = SpeechBubbleScript.new()
	root.add_child(bubble)
	return bubble

func _test_burst_queue() -> void:
	var bubble = _bubble()
	var expected: Array[String] = []
	# Dodici messaggi nello stesso frame: tre volte il vecchio limite.
	for i in 12:
		var text := "messaggio-%02d" % i
		expected.append(text)
		bubble.say(text, "destinatario")
	var queued: Dictionary = bubble.debug_snapshot()
	_assert(int(queued["queue_depth"]) == expected.size(),
			"burst queued %d/%d messages" % [queued["queue_depth"], expected.size()])
	_assert(int(queued["dropped"]) == 0, "burst dropped messages before playback")

	var observed: Array[String] = []
	for i in expected.size():
		if i == 0:
			bubble._process(0.001) # avvia il primo messaggio
		else:
			bubble._process(60.1) # termina il precedente e completa il fade
			bubble._process(0.31) # supera il gap e avvia il successivo
		observed.append(str(bubble.debug_snapshot()["current_text"]))
	_assert(observed == expected, "burst playback order/content mismatch")
	bubble.queue_free()

func _test_minimum_hold() -> void:
	var bubble = _bubble()
	bubble.say("durata verificabile")
	bubble._process(0.001)
	var started: Dictionary = bubble.debug_snapshot()
	_assert(float(started["hold_sec"]) >= 60.0,
			"initial hold is below 60 seconds: %s" % started["hold_sec"])
	bubble._process(59.99)
	var before_deadline: Dictionary = bubble.debug_snapshot()
	_assert(float(before_deadline["hold_sec"]) > 0.0,
			"bubble expired before the 60-second deadline")
	_assert(float(before_deadline["target_alpha"]) > 0.0,
			"bubble started fading before the 60-second deadline")
	bubble._process(0.02)
	var after_deadline: Dictionary = bubble.debug_snapshot()
	_assert(float(after_deadline["hold_sec"]) <= 0.0,
			"bubble did not expire after the 60-second deadline")
	bubble.queue_free()

func _assert(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)
