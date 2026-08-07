extends SceneTree
## Self-test headless della parità fra le 7 lingue dell'interfaccia.
## Esecuzione: godot --headless --path game --script res://tools/i18n_parity_selftest.gd
##
## UIStrings.t() deve fare fallback SILENZIOSO sull'inglese: una chiave mancante
## in ui_de.gd non è un errore a runtime e non deve diventare una riga italiana
## in mezzo a un pannello tedesco. È il modo peggiore di rompersi — nessun log,
## nessun crash, solo un utente che smette di fidarsi. Il drift si era già
## formato una volta
## (EN a 471 chiavi su 624, le altre cinque a 327): questo test è il gate che
## impedisce che si riformi.
##
## Sei contratti, tutti e sei necessari:
##  1. stesse chiavi in tutte e 7 le lingue (né mancanti né orfane);
##  2. nessun valore vuoto — una stringa vuota è peggio dell'italiano;
##  3. stessi segnaposto printf dell'italiano: un %d che diventa %s fa saltare
##     il format a runtime, e succede solo nella lingua tradotta male;
##  4. ogni chiave citata nei sorgenti esiste davvero in S, altrimenti t()
##     restituisce la chiave e l'utente si ritrova a leggere "vps.step_key";
##  5. i NOMI DI SCENA DEI RUOLI passano dai dizionari e sono tradotti davvero;
##  6. nelle superfici elencate in LITERAL_FREE_SURFACES nessuna frase è scritta
##     a mano dentro `.text` / `.tooltip_text` / `.placeholder_text`.
##
## Il quinto contratto è nato da un difetto vero: registrando il gioco in
## inglese, la colonna delle chat elencava "Il Coordinatore", "Il Mentor",
## "Ricercatore 02" in mezzo a un'interfaccia tutta inglese. I nomi erano
## scritti a mano dentro CharacterDefs e TourGuide e non passavano da t(),
## quindi i primi quattro contratti non potevano vederli: le chiavi c'erano
## tutte, i valori erano pieni, i segnaposto combaciavano. Un difetto che non
## rompe niente e si vede solo a schermo è quello che sopravvive più a lungo.

const LANGS := ["en", "hu", "es", "de", "fr", "pt"]
## Le cartelle in cui cercare le chiamate a t().
const SOURCE_DIRS := ["res://scripts"]

## Chi mostra i nomi di scena deve chiederli al dizionario. Una mappa di
## chiavi perfetta e nessun chiamante è indistinguibile da nessuna mappa: il
## test resterebbe verde e a schermo tornerebbe l'italiano.
const ROLE_NAME_SURFACES := {
	"res://scripts/characters/character_defs.gd": "UIStrings.t(key)",
	"res://scripts/setup/tour_guide.gd": "CharacterDefs.role_name(",
	"res://scripts/ui/chat_panel.gd": "CharacterDefs.role_name(",
}

## Sesto contratto: superfici in cui NESSUNA frase può essere scritta a mano.
##
## I primi cinque contratti vedono solo ciò che passa già da t(): un file che
## assegna la frase direttamente — `label.text = "Avvio console…"` — è invisibile
## a tutti e cinque e resta italiano in tutte e sette le lingue. È esattamente
## come l'onboarding del primo avvio è rimasto monolingue mentre il dizionario
## cresceva a 800 chiavi con un gate dedicato: nessun test poteva accorgersene.
##
## Qui si guarda l'assegnazione, non la chiave: in questi file il lato destro di
## `.text` / `.tooltip_text` / `.placeholder_text` non può essere un letterale
## che contiene parole. Simboli e separatori ("✕", "↑", "· ") restano leciti —
## non si traducono e obbligarli a passare dal dizionario sarebbe rumore.
const LITERAL_FREE_SURFACES := [
	"res://scripts/game.gd",
	"res://scripts/setup/scripted_onboarding.gd",
	"res://scripts/ui/embedded_terminal.gd",
]

## Frasi che erano visibili solo per pochi frame o in una vignetta live e non
## passavano da `.text =`, quindi lo scanner generico non poteva intercettarle.
## Restano qui come regressione negativa: nei sorgenti runtime non devono più
## ricomparire, nemmeno come fallback del tour.
const P0_FORBIDDEN_ITALIAN := {
	"res://scripts/backend/local_backend.gd": ["collegamento al container locale"],
	"res://scripts/backend/backend_bus.gd": ["container locale non disponibile"],
	"res://scripts/backend/vps_backend.gd": ["container jht non in esecuzione"],
	"res://scripts/characters/agent_npc.gd": ["MESSAGGIO DA "],
	"res://scripts/office/office.gd": [
		"MESSAGGIO PER TE", "Nuova posizione:", "CV in scrittura:",
		"posizione #%s", "Per domande libere e personali collega un provider",
	],
	"res://scripts/setup/tour_guide.gd": [
		"Questo è il reparto", "Il Ricercatore", "L'Analista", "Il Coordinatore",
	],
	"res://scripts/setup/setup_service.gd": [
		"Account e cloud", "Apri il link, scegli ACCEDI CON GOOGLE",
		"Apri il link, accedi all'account", "Provider selezionato: ",
		"Abbonamento registrato", '_progress("container", "Avvio di Docker in corso',
		"Controllo aggiornamenti del team", "Scarico l'immagine del team",
		"MB scaricati", "Container JHT attivo",
		"Docker Desktop avviato: attendo il motore",
		"Colima avviato: attendo il motore",
		"Console di login aperta dentro Job Hunter Team",
		"Apri il link mostrato, accedi a ChatGPT",
		"Nel prompt Kimi digita /login", "Nel menu Claude scegli",
		"Team avviato: gli agenti arriveranno in ufficio",
		"operazione in corso…",
	],
}

var _failures: Array[String] = []
## I dizionari tradotti già caricati da _check_lang, per non rileggerli.
var _dicts := {}


func _init() -> void:
	var it: Dictionary = UIStrings.S
	_check("dizionario italiano non vuoto", not it.is_empty(), "UIStrings.S è vuoto")
	for lang in LANGS:
		_check_lang(lang, it)
	_check_english_fallback()
	_check_keys_used_in_sources(it)
	_check_role_names(it)
	_check_no_hardcoded_labels()
	_check_p0_english_surfaces()
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
	_dicts[lang] = d
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


## Il gate di parità rende rara una chiave mancante, ma il fallback è una rete
## di sicurezza runtime. Le costanti dei cataloghi sono read-only, quindi il
## lookup puro viene provato con un catalogo DE sintetico privo della chiave.
func _check_english_fallback() -> void:
	var key := "common.loading"
	_check("fallback runtime inglese",
			UIStrings._translated(key, "de", {
				"de": {}, "en": {key: "LOADING…"}}) == "LOADING…")


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


## I nomi di scena dei ruoli: "Il Ricercatore", "Ricercatore 02", "Il Mentor".
##
## Sono l'unica famiglia di etichette la cui chiave si compone a RUNTIME
## ("role." + slug), quindi il controllo (4) — che cerca i letterali
## UIStrings.t("…") nei sorgenti — non le vede. Qui la copertura arriva
## dall'altra parte: si parte dal roster vero (CharacterDefs) e si pretende
## che ogni ruolo che il gioco mette in scena abbia la sua chiave. È il pezzo
## che si accorge del ruolo nuovo aggiunto senza traduzione, che altrimenti
## comparirebbe in italiano dentro le altre sei lingue senza rompere nulla.
func _check_role_names(it: Dictionary) -> void:
	var expected := {}
	for slug: String in CharacterDefs.AGENTS:
		expected["role." + slug] = str(CharacterDefs.AGENTS[slug]["name"])
	for dept_id: String in CharacterDefs.DEPT_ROLES:
		var role: Dictionary = CharacterDefs.DEPT_ROLES[dept_id]
		expected["role_short." + str(role["slug"])] = str(role["label"])
	_check("roster dei ruoli non vuoto", expected.size() >= 11,
			"solo %d ruoli da CharacterDefs: il test non sta leggendo il roster"
			% expected.size())

	var missing: Array[String] = []
	var drifted: Array[String] = []
	for key: String in expected:
		if not it.has(key):
			missing.append(key)
			continue
		# La costante in CharacterDefs resta il fallback quando la chiave
		# manca: se le due si allontanano, la rete di sicurezza mostrerebbe
		# un nome diverso da quello di tutti i giorni.
		if str(it[key]) != str(expected[key]):
			drifted.append('%s: dizionario "%s" ≠ CharacterDefs "%s"'
					% [key, it[key], expected[key]])
	_check("nomi di ruolo con una chiave", missing.is_empty(),
			"%d ruoli senza chiave in UIStrings.S: %s"
			% [missing.size(), _head(missing)])
	_check("nomi di ruolo allineati alle costanti", drifted.is_empty(),
			"%d disallineati: %s" % [drifted.size(), _head(drifted)])

	# Tradotti DAVVERO, non ricopiati dall'italiano. Vale solo per i nomi
	# lunghi: l'articolo davanti ("Il"/"The"/"Der"/"A") rende la copia
	# impossibile da confondere con una traduzione legittima. La forma breve
	# è esclusa apposta — "Analista" è la parola giusta in italiano, spagnolo
	# e portoghese insieme, e pretenderla diversa sarebbe un falso allarme.
	var copied: Array[String] = []
	for lang in LANGS:
		var d: Dictionary = _dicts.get(lang, {})
		if d.is_empty():
			continue
		for key: String in expected:
			if not key.begins_with("role."):
				continue
			if d.has(key) and str(d[key]) == str(it[key]):
				copied.append("%s/%s (\"%s\")" % [lang, key, it[key]])
	_check("nomi di ruolo tradotti", copied.is_empty(),
			"%d ancora in italiano: %s" % [copied.size(), _head(copied)])

	for path: String in ROLE_NAME_SURFACES:
		var src := FileAccess.get_file_as_string(path)
		_check("%s leggibile" % path.get_file(), src != "", "file vuoto o assente")
		if src == "":
			continue
		_check("%s prende i nomi dal dizionario" % path.get_file(),
				src.contains(str(ROLE_NAME_SURFACES[path])),
				"non chiama più %s: i nomi sono tornati scritti a mano"
				% ROLE_NAME_SURFACES[path])


## Nessuna frase scritta a mano nelle superfici dichiarate sopra.
##
## Si legge la riga intera dopo `.text =` (o `+=`), non solo il primo letterale:
## `x.text = "SÌ" if cond else "NO"` ne nasconde due, e il secondo è quello che
## si dimentica di tradurre. Un letterale è "una frase" se contiene almeno due
## lettere di fila — così "✕", "↑" e " · " non fanno rumore, mentre "OK" sì.
func _check_no_hardcoded_labels() -> void:
	var assign := RegEx.new()
	assign.compile('\\.(text|tooltip_text|placeholder_text)\\s*\\+?=(.*)$')
	var literal := RegEx.new()
	literal.compile('"([^"]*)"')
	# Le chiavi passate al dizionario sono letterali legittimi: si tolgono prima
	# di guardare cosa resta, altrimenti ogni riga corretta sembrerebbe un errore.
	var lookup := RegEx.new()
	lookup.compile('UIStrings\\.t\\("[^"]*"\\)')
	var words := RegEx.new()
	words.compile('\\p{L}{2,}')
	for path: String in LITERAL_FREE_SURFACES:
		var src := FileAccess.get_file_as_string(path)
		_check("%s leggibile" % path.get_file(), src != "", "file vuoto o assente")
		if src == "":
			continue
		var found: Array[String] = []
		var line_no := 0
		for line in src.split("\n"):
			line_no += 1
			if line.strip_edges().begins_with("#"):
				continue
			var hit := assign.search(line)
			if hit == null:
				continue
			var rhs := lookup.sub(hit.get_string(2), "", true)
			for m in literal.search_all(rhs):
				if words.search(m.get_string(1)) != null:
					found.append('%s:%d "%s"' % [path.get_file(), line_no,
							m.get_string(1)])
		_check("%s senza etichette scritte a mano" % path.get_file(), found.is_empty(),
				"%d letterali assegnati a .text/.tooltip_text/.placeholder_text: %s"
				% [found.size(), _head(found)])


func _check_p0_english_surfaces() -> void:
	for path: String in P0_FORBIDDEN_ITALIAN:
		var src := FileAccess.get_file_as_string(path)
		_check("%s leggibile per audit P0" % path.get_file(), src != "")
		var runtime_lines: PackedStringArray = []
		for line in src.split("\n"):
			if not line.strip_edges().begins_with("#"):
				runtime_lines.append(line)
		var runtime_src := "\n".join(runtime_lines)
		for forbidden: String in P0_FORBIDDEN_ITALIAN[path]:
			_check("%s senza fallback italiano P0" % path.get_file(),
					not runtime_src.contains(forbidden), forbidden)


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
