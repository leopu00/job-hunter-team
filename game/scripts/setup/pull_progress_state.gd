class_name PullProgressState
extends RefCounted
## Stato puro del progresso `docker compose pull`.
##
## Lo stream ripete spesso la stessa riga per uno stesso livello. Ricevere
## output non significa quindi aver fatto progresso: il chiamante deve
## confrontare `material_fingerprint()` e aggiornare il proprio heartbeat solo
## quando cambia. Il fingerprint include anche la fase del livello, perché il
## passaggio da download a verifica/estrazione è progresso reale pur lasciando
## invariati i byte scaricati.

const PHASE_UNKNOWN := "unknown"
const PHASE_QUEUED := "queued"
const PHASE_WAITING := "waiting"
const PHASE_DOWNLOADING := "downloading"
const PHASE_DOWNLOADED := "downloaded"
const PHASE_VERIFYING := "verifying"
const PHASE_EXTRACTING := "extracting"
const PHASE_COMPLETE := "complete"
const PHASE_OTHER := "other"

## Se più livelli lavorano insieme, raccontiamo la fase attiva più avanzata.
## In particolare 17 completi + 1 in estrazione deve restare "extracting",
## non diventare un ambiguo 17/18 né sembrare già concluso.
const PHASE_PRIORITY := {
	PHASE_COMPLETE: 0,
	PHASE_QUEUED: 10,
	PHASE_WAITING: 20,
	PHASE_DOWNLOADED: 30,
	PHASE_DOWNLOADING: 40,
	PHASE_VERIFYING: 50,
	PHASE_EXTRACTING: 60,
	PHASE_OTHER: 5,
}

static var WHITESPACE_RE := RegEx.create_from_string("\\s+")
static var SIZE_RE := RegEx.create_from_string(
		"([0-9.]+)\\s*([kKmMgGtT]?i?[bB])")


## Traduce le frasi Docker in un vocabolario chiuso. "Download complete" non
## è completamento del livello: verifica ed estrazione devono ancora avvenire.
static func classify_status(status: String) -> String:
	var value := _normalized_status(status)
	if value == "":
		return PHASE_UNKNOWN
	if value.begins_with("pull complete") or value.contains("already exists"):
		return PHASE_COMPLETE
	if value.begins_with("extracting"):
		return PHASE_EXTRACTING
	if value.begins_with("verifying"):
		return PHASE_VERIFYING
	if value.begins_with("download complete"):
		return PHASE_DOWNLOADED
	if value.begins_with("downloading"):
		return PHASE_DOWNLOADING
	if value.begins_with("waiting"):
		return PHASE_WAITING
	if value.begins_with("pulling fs layer"):
		return PHASE_QUEUED
	return PHASE_OTHER


## Riassunto deterministico dello stato corrente. `done` conta soltanto i
## livelli realmente conclusi, mai quelli che hanno finito il solo download.
static func classify(layers: Dictionary) -> Dictionary:
	var counts := {}
	var active_phase := PHASE_UNKNOWN
	var active_priority := -1
	var done := 0
	for id: Variant in layers:
		var phase := classify_status(str(layers[id]))
		counts[phase] = int(counts.get(phase, 0)) + 1
		if phase == PHASE_COMPLETE:
			done += 1
			continue
		var priority := int(PHASE_PRIORITY.get(phase, 0))
		if priority > active_priority:
			active_priority = priority
			active_phase = phase
	if layers.is_empty():
		active_phase = PHASE_UNKNOWN
	elif done == layers.size():
		active_phase = PHASE_COMPLETE
	return {
		"phase": active_phase,
		"done": done,
		"total": layers.size(),
		"counts": counts,
	}


## Firma soltanto lo stato materiale: ordine dei dizionari e spaziatura dello
## stream non la cambiano; fase, testo normalizzato o byte sì. La firma non
## viene mostrata né persistita: serve solo come confronto fail-closed nel
## processo che legge compose.
static func material_fingerprint(layers: Dictionary,
		layer_bytes: Dictionary) -> String:
	var ids: Array[String] = []
	for raw_id: Variant in layers:
		var id := str(raw_id)
		if not ids.has(id):
			ids.append(id)
	for raw_id: Variant in layer_bytes:
		var id := str(raw_id)
		if not ids.has(id):
			ids.append(id)
	ids.sort()
	var rows: Array = []
	for id: String in ids:
		var status := _normalized_status(str(layers.get(id, "")))
		var phase := classify_status(status)
		var byte_state: Dictionary = layer_bytes.get(id, {})
		rows.append([
			id,
			phase,
			_progress_token(status, phase, byte_state),
		])
	return JSON.stringify(rows, "", false).sha256_text()


static func _normalized_status(status: String) -> String:
	return WHITESPACE_RE.sub(status.strip_edges().to_lower(), " ", true)


## Il testo Docker arrotonda e cambia spaziatura; dove il parser possiede i
## byte strutturati usa quelli. In estrazione quei byte descrivono ancora il
## download già concluso, quindi si canonicalizzano invece le unità presenti
## nello stato. Fasi senza unità avanzano una volta all'ingresso, non a ogni
## ristampa della stessa parola.
static func _progress_token(status: String, phase: String,
		byte_state: Dictionary) -> Variant:
	if phase == PHASE_DOWNLOADING or phase == PHASE_DOWNLOADED:
		return [
			_mb_to_bytes(float(byte_state.get("got", 0.0))),
			_mb_to_bytes(float(byte_state.get("total", 0.0))),
		]
	if phase == PHASE_EXTRACTING:
		var sizes: Array[int] = []
		for found: RegExMatch in SIZE_RE.search_all(status):
			sizes.append(_size_to_bytes(found.get_string(1), found.get_string(2)))
		return sizes
	if phase == PHASE_OTHER:
		return status
	return null


## I parser esistenti conservano MB come float. Riportarli a byte interi evita
## che differenze di rappresentazione producano heartbeat fittizi.
static func _mb_to_bytes(value: float) -> int:
	return int(round(maxf(value, 0.0) * 1048576.0))


static func _size_to_bytes(value: String, unit: String) -> int:
	var multiplier := 1.0
	match unit.to_lower().left(1):
		"t": multiplier = 1099511627776.0
		"g": multiplier = 1073741824.0
		"m": multiplier = 1048576.0
		"k": multiplier = 1024.0
	return int(round(maxf(value.to_float(), 0.0) * multiplier))
