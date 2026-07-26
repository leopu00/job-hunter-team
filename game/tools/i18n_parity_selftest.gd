extends SceneTree
## Self-test headless della parità fra le 7 lingue dell'interfaccia.
## Esecuzione: godot --headless --path game --script res://tools/i18n_parity_selftest.gd
##
## UIStrings.t() fa fallback SILENZIOSO sull'italiano: una chiave mancante in
## ui_de.gd non è un errore a runtime, è una riga italiana in mezzo a un
## pannello tedesco. È il modo peggiore di rompersi — nessun log, nessun crash,
## solo un utente che smette di fidarsi. Il drift si era già formato una volta
## (EN a 471 chiavi su 624, le altre cinque a 327): questo test è il gate che
## impedisce che si riformi.
##
## Quattro contratti, tutti e quattro necessari:
##  1. stesse chiavi in tutte e 7 le lingue (né mancanti né orfane);
##  2. nessun valore vuoto — una stringa vuota è peggio dell'italiano;
##  3. stessi segnaposto printf dell'italiano: un %d che diventa %s fa saltare
##     il format a runtime, e succede solo nella lingua tradotta male;
##  4. ogni chiave citata nei sorgenti esiste davvero in S, altrimenti t()
##     restituisce la chiave e l'utente si ritrova a leggere "vps.step_key".

const LANGS := ["en", "hu", "es", "de", "fr", "pt"]
## Le cartelle in cui cercare le chiamate a t().
const SOURCE_DIRS := ["res://scripts"]

var _failures: Array[String] = []


func _init() -> void:
	var it: Dictionary = UIStrings.S
	_check("dizionario italiano non vuoto", not it.is_empty(), "UIStrings.S è vuoto")
	for lang in LANGS:
		_check_lang(lang, it)
	_check_keys_used_in_sources(it)
	if _failures.is_empty():
		print("I18N-PARITY-TEST PASS (%d chiavi × %d lingue)" % [it.size(), LANGS.size() + 1])
		quit(0)
		return
	for failure in _failures:
		push_error("[i18n-test] " + failure)
	print("I18N-PARITY-TEST FAIL (%d problemi)" % _failures.size())
	quit(1)


func _check(name: String, condition: bool, detail: String = "") -> void:
	if not condition:
		_failures.append("%s — %s" % [name, detail])


func _check_lang(lang: String, it: Dictionary) -> void:
	var path := "res://scripts/i18n/ui_%s.gd" % lang
	if not ResourceLoader.exists(path):
		_failures.append("%s — file mancante: %s" % [lang, path])
		return
	var script: GDScript = load(path)
	var d: Dictionary = script.get_script_constant_map().get("S", {})
	_check("%s: dizionario presente" % lang, not d.is_empty(), "S vuoto o assente in " + path)

	var missing: Array[String] = []
	var bad_format: Array[String] = []
	var empty: Array[String] = []
	for key in it:
		if not d.has(key):
			missing.append(str(key))
			continue
		var value := str(d[key])
		if value.strip_edges() == "":
			empty.append(str(key))
		var want := _placeholders(str(it[key]))
		var got := _placeholders(value)
		if want != got:
			bad_format.append("%s (it %s ≠ %s %s)" % [key, want, lang, got])
	var extra: Array[String] = []
	for key in d:
		if not it.has(key):
			extra.append(str(key))

	_check("%s: chiavi mancanti" % lang, missing.is_empty(),
			"%d assenti, prime: %s" % [missing.size(), _head(missing)])
	_check("%s: chiavi orfane" % lang, extra.is_empty(),
			"%d non esistono in italiano: %s" % [extra.size(), _head(extra)])
	_check("%s: valori vuoti" % lang, empty.is_empty(),
			"%d vuoti: %s" % [empty.size(), _head(empty)])
	_check("%s: segnaposto printf" % lang, bad_format.is_empty(),
			"%d incompatibili: %s" % [bad_format.size(), _head(bad_format)])


## La sequenza dei segnaposto printf, nell'ordine in cui compaiono: "%s" e "%d"
## non sono intercambiabili e l'ordine conta perché gli argomenti sono
## posizionali. "%%" è un percento letterale e non entra nella firma.
##
## Il riconoscimento è volutamente stretto — solo %d, %s e %f con le loro
## larghezze — perché nelle stringhe UI il carattere % compare soprattutto come
## unità di misura in mezzo alla prosa ("Mondo all'85%: la grana si nota"), e
## una regola larga trasformerebbe ogni frase con una percentuale in un falso
## allarme. Se un giorno servisse %x, va aggiunto qui.
static func _placeholders(text: String) -> PackedStringArray:
	const CONVERSIONS := "dsf"
	# larghezza e precisione fanno parte della firma: "%.1f", "%02d"
	const MODIFIERS := "0123456789."
	var out: PackedStringArray = []
	var i := 0
	while i < text.length():
		if text[i] != "%":
			i += 1
			continue
		i += 1
		if i >= text.length():
			break
		if text[i] == "%":
			i += 1
			continue
		var spec := "%"
		while i < text.length() and MODIFIERS.contains(text[i]):
			spec += text[i]
			i += 1
		if i >= text.length():
			break
		if CONVERSIONS.contains(text[i]):
			out.append(spec + text[i])
		i += 1
	return out


## Ogni chiave citata nei sorgenti deve esistere: t() su una chiave sconosciuta
## non fallisce, restituisce la chiave stessa e la stampa a schermo.
func _check_keys_used_in_sources(it: Dictionary) -> void:
	var regex := RegEx.new()
	regex.compile('UIStrings\\.t\\("([^"]+)"\\)')
	var unknown: Array[String] = []
	var seen := 0
	for dir in SOURCE_DIRS:
		for path in _gd_files(dir):
			var text := FileAccess.get_file_as_string(path)
			if text == "":
				continue
			for m in regex.search_all(text):
				seen += 1
				var key := m.get_string(1)
				if not it.has(key) and not unknown.has(key):
					unknown.append("%s (%s)" % [key, path.get_file()])
	_check("chiavi usate nei sorgenti", unknown.is_empty(),
			"%d sconosciute a UIStrings.S: %s" % [unknown.size(), _head(unknown)])
	_check("chiamate a UIStrings.t trovate", seen > 0,
			"nessuna chiamata trovata: il test non sta guardando i sorgenti giusti")


func _gd_files(dir_path: String) -> PackedStringArray:
	var out: PackedStringArray = []
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return out
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		var full := dir_path.path_join(entry)
		if dir.current_is_dir():
			if not entry.begins_with("."):
				out.append_array(_gd_files(full))
		elif entry.ends_with(".gd"):
			out.append(full)
		entry = dir.get_next()
	dir.list_dir_end()
	return out


static func _head(items: Array) -> String:
	var slice := items.slice(0, 6)
	return ", ".join(PackedStringArray(slice))
