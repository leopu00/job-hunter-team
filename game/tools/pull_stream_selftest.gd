extends SceneTree
## Self-test del parser dello stream di `docker compose pull`, sui DATI VERI.
## Esecuzione: godot --headless --path game --script res://tools/pull_stream_selftest.gd
##
## Le fixture in tools/fixtures/ sono due pull reali catturati sulla stessa
## macchina (Linux, Docker 29.6.1, Compose v5.3.0):
## - pull_plain.txt  — `docker compose pull` su pipe non-TTY: NESSUNA riga
##   "Downloading" porta il totale (0 su 6599 nel log intero). È il caso che
##   teneva la barra indeterminata per sempre: qui si verifica che il parser
##   testuale resti onesto (fraction -1, mai una percentuale inventata) ma
##   racconti comunque i byte scaricati, con un rate plausibile rispetto ai
##   timestamp veri della cattura (~105 s).
## - pull_json.txt — `docker compose --progress json pull`: i byte veri per
##   livello in `current`/`total`. Qui la percentuale ESISTE e deve crescere
##   senza mai farsi gonfiare dai byte DECOMPRESSI di "Extracting".
##
## In coda, su POSIX, si prova il RIPIEGO per davvero: un finto `docker` nel
## PATH che rifiuta `--progress json` con "unknown flag" (il messaggio reale
## di compose) deve produrre due invocazioni — prima col flag, poi senza — e
## i byte devono arrivare comunque dal parser testuale.

const FIXTURES := "res://tools/fixtures"

## Ancore misurate sulle fixture (replay di riferimento, vedi intestazioni
## dei file): pull testuale 19 livelli/14 tracciati/847.8 MB in 105.1 s;
## pull JSON 9 livelli/7 tracciati/319.3 MB totali.

var _fails: Array[String] = []
## Caricato in _run, MAI come inizializzatore di membro: lo script principale
## viene istanziato prima che gli autoload esistano, e setup_service.gd non
## compila senza (e la sua load fallita resterebbe in cache anche per loro).
var _svc_script: GDScript
## Ogni sezione si firma qui alla fine: un errore di script abortisce la
## funzione SENZA passare dai _check, e senza questo contatore il test
## finirebbe verde a asserzioni mai eseguite.
var _sections := 0


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))


func _init() -> void:
	create_timer(60.0).timeout.connect(func() -> void:
		print("PULL-STREAM-TEST FAIL [timeout]")
		quit(2))
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	_svc_script = load("res://scripts/setup/setup_service.gd")
	_check("setup_service.gd caricabile", _svc_script != null
			and _svc_script.can_instantiate())
	var expected := 3
	_json_replay()
	_text_replay()
	_legacy_text_format()
	if OS.get_name() != "Windows":
		expected += 1
		await _fallback_end_to_end()
	_check("tutte le sezioni arrivate in fondo", _sections == expected,
			"%d/%d" % [_sections, expected])
	if _fails.is_empty():
		print("PULL-STREAM-TEST PASS")
		quit(0)
	else:
		print("PULL-STREAM-TEST FAIL ", _fails)
		quit(1)


func _fixture_lines(name: String) -> PackedStringArray:
	var text := FileAccess.get_file_as_string(FIXTURES + "/" + name)
	_check("fixture %s leggibile" % name, text != "")
	return text.split("\n", false)


## Il pull JSON riga per riga: percentuale reale, contabilità mai gonfiata.
func _json_replay() -> void:
	var layers := {}
	var layer_bytes := {}
	var prev_got := 0.0
	var prev_total := 0.0
	var prev_frac := -1.0
	var saw_meter := false
	var got_monotone := true
	var total_monotone := true
	var frac_honest := true    # ogni calo di percentuale coincide con un
								# totale appena cresciuto (livello nuovo)
	var never_overflow := true # got <= total sempre: Extracting non entra
	for line in _fixture_lines("pull_json.txt"):
		if line.begins_with("#"):
			continue
		_svc_script._parse_json_pull_line(line, layers, layer_bytes)
		var info: Dictionary = _svc_script._pull_progress_info(layers, layer_bytes)
		var got := float(info["got_mb"])
		var total := float(info["total_mb"])
		var frac := float(info["fraction"])
		got_monotone = got_monotone and got >= prev_got - 0.001
		total_monotone = total_monotone and total >= prev_total - 0.001
		if frac >= 0.0:
			saw_meter = true
			never_overflow = never_overflow and got <= total + 0.001
			if frac < prev_frac - 0.000001:
				frac_honest = frac_honest and total > prev_total + 0.001
			prev_frac = frac
		prev_got = got
		prev_total = total
	_check("json: la percentuale esiste", saw_meter)
	_check("json: byte scaricati mai in calo", got_monotone)
	_check("json: totale mai in calo", total_monotone)
	_check("json: percentuale cala solo quando un livello nuovo dichiara "
			+ "il suo totale", frac_honest)
	_check("json: Extracting non gonfia i conteggi (got <= total sempre)",
			never_overflow)
	# Ancore del pull reale: 9 livelli, 7 col download tracciato, 319.3 MB.
	_check("json: 9 livelli visti", layers.size() == 9, str(layers.size()))
	_check("json: 7 livelli con byte", layer_bytes.size() == 7,
			str(layer_bytes.size()))
	_check("json: totale ~319 MB", absf(prev_total - 319.3) < 1.5,
			"%.1f MB" % prev_total)
	_check("json: alla fine tutto acquisito (frazione 1.0)", prev_frac > 0.999,
			str(prev_frac))
	_sections += 1


## Il pull testuale riga per riga: byte veri, percentuale MAI inventata.
func _text_replay() -> void:
	var layers := {}
	var layer_bytes := {}
	var first_ts := 0.0
	var last_ts := 0.0
	var prev_got := 0.0
	var got_monotone := true
	var stays_blind := true
	var total := 0.0
	for raw in _fixture_lines("pull_plain.txt"):
		# Il primo campo è il timestamp epoch della cattura: si toglie prima
		# di dare la riga al parser, e si usa per la plausibilità del rate.
		var cut := raw.find(" ")
		if cut <= 0:
			continue
		var ts := raw.left(cut).to_float()
		if ts <= 0.0:
			continue  # intestazioni "# …"
		if first_ts == 0.0:
			first_ts = ts
		last_ts = ts
		_svc_script._parse_text_pull_line(raw.substr(cut).strip_edges(),
				layers, layer_bytes)
		var info: Dictionary = _svc_script._pull_progress_info(layers, layer_bytes)
		stays_blind = stays_blind and float(info["fraction"]) == -1.0
		var got := float(info["got_mb"])
		got_monotone = got_monotone and got >= prev_got - 0.001
		prev_got = got
		total = float(info["total_mb"])
	_check("testo: fraction resta -1 (docker non dichiara MAI il totale)",
			stays_blind)
	_check("testo: nessun totale accumulato", total == 0.0, "%.1f MB" % total)
	_check("testo: i byte scaricati crescono e basta", got_monotone)
	# Ancore del pull reale: 19 livelli, 14 col download tracciato, ~848 MB.
	_check("testo: 19 livelli visti", layers.size() == 19, str(layers.size()))
	_check("testo: 14 livelli con byte", layer_bytes.size() == 14,
			str(layer_bytes.size()))
	_check("testo: ~848 MB scaricati", absf(prev_got - 847.8) < 5.0,
			"%.1f MB" % prev_got)
	var duration := last_ts - first_ts
	_check("testo: la cattura dura ~105 s", duration > 95.0 and duration < 115.0,
			"%.1f s" % duration)
	var rate := prev_got / duration if duration > 0.0 else 0.0
	_check("testo: rate plausibile (~8 MB/s misurati)",
			rate > 5.0 and rate < 12.0, "%.2f MB/s" % rate)
	_sections += 1


## Il formato "x/y" dei docker meno recenti resta capito, e un livello senza
## totale accanto a uno col totale NON produce una percentuale gonfiata.
func _legacy_text_format() -> void:
	var layers := {}
	var layer_bytes := {}
	_svc_script._parse_text_pull_line("aa Downloading 512kB/2.048MB",
			layers, layer_bytes)
	var info: Dictionary = _svc_script._pull_progress_info(layers, layer_bytes)
	_check("legacy: frazione dal formato x/y",
			absf(float(info["fraction"]) - 0.5 / 2.048) < 0.001, str(info))
	_svc_script._parse_text_pull_line("aa Download complete 0B",
			layers, layer_bytes)
	info = _svc_script._pull_progress_info(layers, layer_bytes)
	_check("legacy: complete blocca il livello sul totale",
			absf(float(info["got_mb"]) - 2.048) < 0.001, str(info))
	# Arriva un livello SENZA totale: la percentuale sparisce invece di
	# fingersi calcolabile su un totale parziale.
	_svc_script._parse_text_pull_line("bb Downloading 1.049MB",
			layers, layer_bytes)
	info = _svc_script._pull_progress_info(layers, layer_bytes)
	_check("misto: senza tutti i totali la frazione torna -1",
			float(info["fraction"]) == -1.0, str(info))
	_check("misto: i byte veri restano", absf(float(info["got_mb"]) - 3.097) < 0.001,
			str(info))
	# "Download complete 0B" non deve azzerare byte realmente scaricati.
	_svc_script._parse_text_pull_line("bb Download complete 0B",
			layers, layer_bytes)
	info = _svc_script._pull_progress_info(layers, layer_bytes)
	_check("misto: complete senza totale conserva l'ultimo conteggio",
			absf(float(info["got_mb"]) - 3.097) < 0.001, str(info))
	_sections += 1


## Il ripiego provato PER DAVVERO: un finto `docker` nel PATH. La variante
## "moderna" accetta `--progress json` e riproduce il pull JSON reale; quella
## "vecchia" lo rifiuta con l'errore vero di compose ("unknown flag") e in
## modalità testo riproduce il pull plain reale. Ogni invocazione lascia una
## riga di log: così si vede che il ripiego rilancia senza il flag.
func _fallback_end_to_end() -> void:
	var root_dir := OS.get_cache_dir().path_join(
			"jht-pull-selftest-%d" % int(Time.get_ticks_usec()))
	var modern := root_dir.path_join("modern")
	var legacy := root_dir.path_join("legacy")
	DirAccess.make_dir_recursive_absolute(modern)
	DirAccess.make_dir_recursive_absolute(legacy)
	var json_fix := ProjectSettings.globalize_path(FIXTURES + "/pull_json.txt")
	var plain_fix := ProjectSettings.globalize_path(FIXTURES + "/pull_plain.txt")
	# Lo stub scrive l'argv ricevuto in <script>.calls.log, poi si comporta
	# come compose: la fixture plain va ripulita di intestazioni e timestamp
	# (righe come le stamperebbe compose su pipe).
	var plain_cat := "grep -v '^#' '%s' | sed -E 's/^[0-9]+\\.[0-9]+ +//'" % plain_fix
	_write_stub(modern.path_join("docker"), "\n".join([
		"#!/bin/sh",
		"echo \"$@\" >> \"$0.calls.log\"",
		"case \"$*\" in",
		"*--progress\\ json*) grep -v '^#' '%s' ;;" % json_fix,
		"*) %s ;;" % plain_cat,
		"esac",
	]) + "\n")
	_write_stub(legacy.path_join("docker"), "\n".join([
		"#!/bin/sh",
		"echo \"$@\" >> \"$0.calls.log\"",
		"case \"$*\" in",
		"*--progress*) echo 'unknown flag: --progress' >&2; exit 16 ;;",
		"*) %s ;;" % plain_cat,
		"esac",
	]) + "\n")
	var compose := root_dir.path_join("docker-compose.yml")
	var f := FileAccess.open(compose, FileAccess.WRITE)
	f.store_string("services: {}\n")
	f.close()
	var old_path := OS.get_environment("PATH")
	var svc: Node = _svc_script.new()

	OS.set_environment("PATH", modern + ":" + old_path)
	var res: Dictionary = svc._compose_stream(compose,
			PackedStringArray(["pull", "jht"]), "test")
	await process_frame  # flusha i call_deferred(_apply_pull_progress)
	var modern_calls := _calls(modern.path_join("docker"))
	_check("moderno: stream concluso bene", bool(res.get("ok", false)),
			str(res.get("tail", "")).right(160))
	_check("moderno: UNA sola invocazione (flag accettato)",
			modern_calls.size() == 1, str(modern_calls))
	_check("moderno: invocato con --progress json prima del sottocomando",
			modern_calls.size() == 1
			and modern_calls[0].begins_with("compose --progress json"),
			str(modern_calls))
	_check("moderno: percentuale reale dal JSON, stato finale consegnato",
			float(svc.last_pull.get("fraction", -1.0)) > 0.999
			and absf(float(svc.last_pull.get("got_mb", 0.0)) - 319.3) < 1.5,
			str(svc.last_pull))

	svc.last_pull = {}
	OS.set_environment("PATH", legacy + ":" + old_path)
	res = svc._compose_stream(compose, PackedStringArray(["pull", "jht"]), "test")
	await process_frame
	var legacy_calls := _calls(legacy.path_join("docker"))
	_check("ripiego: stream concluso bene in modalità testo",
			bool(res.get("ok", false)), str(res.get("tail", "")).right(160))
	_check("ripiego: DUE invocazioni (flag rifiutato, rilancio senza)",
			legacy_calls.size() == 2, str(legacy_calls))
	_check("ripiego: la prima invocazione portava il flag",
			legacy_calls.size() == 2
			and legacy_calls[0].contains("--progress json"), str(legacy_calls))
	_check("ripiego: la seconda non lo porta più",
			legacy_calls.size() == 2
			and not legacy_calls[1].contains("--progress"), str(legacy_calls))
	_check("ripiego: byte scaricati SENZA percentuale inventata",
			absf(float(svc.last_pull.get("got_mb", 0.0)) - 847.8) < 5.0
			and float(svc.last_pull.get("fraction", 0.0)) == -1.0,
			str(svc.last_pull))

	OS.set_environment("PATH", old_path)
	svc.free()
	_sections += 1


func _write_stub(path: String, body: String) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(body)
	f.close()
	OS.execute("chmod", PackedStringArray(["+x", path]))


func _calls(stub_path: String) -> PackedStringArray:
	var text := FileAccess.get_file_as_string(stub_path + ".calls.log")
	return text.strip_edges().split("\n", false)
