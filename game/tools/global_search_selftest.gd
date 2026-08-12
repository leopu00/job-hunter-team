extends SceneTree
## Self-test headless della ricerca posizioni (Cmd+K).
## Esecuzione: godot --headless --path game --script res://tools/global_search_selftest.gd
##
## O-60 — l'operatore ha chiesto di poter cercare un'offerta scrivendo «nome
## azienda, ID, ecc.». L'ID è la parte che si sbaglia in silenzio: nella
## schermata si legge "JHT-042", nel database è il numero 42, e chi copia
## l'etichetta si porta dietro prefisso e zeri. Se il match non li capisce, la
## ricerca risponde "nessuna posizione trovata" su un'offerta che c'è — che è
## peggio di non avere la ricerca, perché sembra una risposta.
##
## Qui gira la funzione VERA di global_search.gd, non una sua copia.

const SEARCH_PATH := "res://scripts/ui/position_search.gd"

func _init() -> void:
	var script: GDScript = load(SEARCH_PATH)
	if script == null:
		printerr("[search-test] FAIL: position_search.gd non caricabile")
		quit(1)
		return

	var failures: Array[String] = []

	# ── L'ID nelle forme in cui l'utente lo scrive ────────────────────
	var id_cases := {
		"42": 42,
		"jht-042": 42,
		"jht 42": 42,
		"jht042": 42,
		"#42": 42,
		"0042": 42,
		"jht-1": 1,
		# Non sono id: una parola, il solo prefisso, il vuoto, un misto.
		"mixrank": 0,
		"jht": 0,
		"": 0,
		"4a2": 0,
	}
	for q: String in id_cases:
		var got: int = script.parse_id(q)
		var want: int = id_cases[q]
		if got != want:
			failures.append("parse_id('%s') = %d, atteso %d" % [q, got, want])

	# ── Il match sulle posizioni ──────────────────────────────────────
	# Uno snapshot finto con la stessa forma di BackendBus.positions.
	var rows: Array = [
		{"id": 42, "title": "AI Automations Product Engineer",
			"company": "MixRank", "loc_city": "Milano",
			"role_family": "Backend", "source": "linkedin"},
		{"id": 7, "title": "Junior Java Developer", "company": "Initech",
			"loc_city": "Roma", "role_family": "Backend", "source": "indeed"},
	]
	var match_cases := {
		"mixrank": [42],       # azienda
		"automations": [42],   # pezzo di titolo
		"engineer": [42],      # parola in fondo: il titolo in lista è troncato
		"roma": [7],           # città
		"indeed": [7],         # fonte
		"jht-042": [42],       # id con prefisso e zeri
		"42": [42],            # id nudo
		"backend": [42, 7],    # famiglia: entrambe
		"zzz": [],             # nessuna
	}
	for q: String in match_cases:
		var want_ids: Array = match_cases[q]
		var got_ids: Array = []
		for p: Dictionary in script.filter(rows, q, 12):
			got_ids.append(int(p.get("id", 0)))
		if got_ids != want_ids:
			failures.append("filter('%s') = %s, atteso %s"
					% [q, str(got_ids), str(want_ids)])

	if failures.is_empty():
		print("[search-test] PASS: id (JHT-042, #42, 0042), titolo, azienda, città, fonte, famiglia")
		quit(0)
	else:
		for f: String in failures:
			printerr("[search-test] FAIL: %s" % f)
		quit(1)
