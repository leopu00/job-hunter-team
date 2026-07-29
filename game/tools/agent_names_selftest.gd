extends SceneTree
## Self-test headless della mappa dei cognomi (scripts/agent_names.gd).
## Esecuzione:
##   godot --headless --path game --script res://tools/agent_names_selftest.gd
##
## Il cognome è un pezzo di identità, e l'identità in questo ufficio è una
## promessa: `scout-2` è la stessa persona — stessa scrivania, stesso volto,
## adesso stesso nome — a ogni riavvio e su ogni macchina. Una promessa così
## non si rompe con un errore: si rompe in silenzio, e l'utente se ne accorge
## solo perché "ieri si chiamava diversamente". Sei contratti:
##
##  1. DETERMINISMO — la stessa chiamata dà sempre la stessa risposta, e non
##     dipende da niente che vari (roster vivo, ordine di spawn, disco).
##  2. NIENTE OMONIMI — dentro un ruolo nessun cognome si ripete, e nessuno
##     inizia come un altro: su una targhetta si legge la prima sillaba, e due
##     "Mar…" alla stessa scrivania sono una persona sola.
##  3. FALLBACK — oltre la lista si degrada all'uid nudo. Mai un crash, mai un
##     cognome riciclato: due Holmes sono peggio di uno `scout-11`.
##  4. COPERTURA — ogni ruolo che il gioco fa esistere davvero (CharacterDefs)
##     ha la sua lista, e i ruoli di reparto arrivano almeno a 8 (il Capitano
##     scala fino a 5-6 istanze, il margine serve).
##  5. RENDERABILITÀ — ogni carattere di ogni cognome esiste già nei dizionari
##     delle 7 lingue. Un cognome con un diacritico che il font di gioco non
##     ha si vede solo aprendo il gioco, e si vede come un rettangolo vuoto.
##  6. FORMATO — `display_name` compone davvero "cognome · uid" e l'uid
##     tecnico resta dentro, intatto: è quello che il resto del gioco cerca.
##
## Regola di stanza, pagata da due rossi solo-Windows dei vicini
## (idle_pace_selftest, headless_exit_selftest): si parte da `call_deferred` e
## non da `_init` — dentro `_init` il main loop non è ancora inizializzato e
## quanto sia venuto su cambia da piattaforma a piattaforma. Questo test non
## tocca `root`, non costruisce nodi e non sposta MAI `UIStrings.lang`: i
## dizionari li legge dal loro file, come fa i18n_parity_selftest.

## I ruoli di reparto: quelli che scalano, e per cui il margine conta.
const DEPT_ROLES := ["scout", "analista", "scorer", "scrittore", "critico"]
## Quante istanze per ruolo devono avere un nome proprio garantito.
const MIN_DEPT_SURNAMES := 8
const LANGS := ["en", "hu", "es", "de", "fr", "pt"]

var _fails: Array[String] = []


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	_check_determinism()
	_check_no_lookalikes()
	_check_fallback()
	_check_coverage()
	_check_renderable()
	_check_format()
	_check_surfaces_wired()

	if _fails.is_empty():
		print("AGENT-NAMES-TEST PASS (%d ruoli)" % AgentNames.SURNAMES.size())
		quit(0)
		return
	for fail in _fails:
		push_error("[agent-names] " + fail)
	print("AGENT-NAMES-TEST FAIL (%d problemi)" % _fails.size())
	quit(1)


func _check(name: String, condition: bool, detail: String = "") -> void:
	if not condition:
		_fails.append("%s — %s" % [name, detail])


## Funzione pura: chiamarla due volte dà due volte lo stesso risultato, e
## chiamarla in ordine diverso non cambia niente. È il contratto che rende il
## cognome parte dell'identità invece di una decorazione.
func _check_determinism() -> void:
	var first := {}
	for role: String in AgentNames.SURNAMES:
		for n in range(1, AgentNames.roster_size(role) + 3):
			var uid := "%s-%d" % [role, n]
			first[uid] = AgentNames.surname(uid)
	# Secondo giro, ruoli e numeri in ordine inverso: se qualcosa dipendesse
	# dall'ordine di interrogazione (una cache, un contatore) qui salterebbe.
	var roles: Array = AgentNames.SURNAMES.keys()
	roles.reverse()
	for role: String in roles:
		var numbers := range(1, AgentNames.roster_size(role) + 3)
		numbers.reverse()
		for n in numbers:
			var uid := "%s-%d" % [role, n]
			_check("determinismo su %s" % uid,
					AgentNames.surname(uid) == str(first[uid]),
					"\"%s\" alla seconda chiamata, \"%s\" alla prima"
					% [AgentNames.surname(uid), first[uid]])

	# Lo slug nudo è il lead, e il lead è l'istanza 1: le due chiavi devono
	# convergere, altrimenti la stessa persona ha due nomi a seconda di quale
	# pannello la mostra.
	for role: String in AgentNames.SURNAMES:
		_check("lo slug nudo \"%s\" vale come %s-1" % [role, role],
				AgentNames.surname(role) == AgentNames.surname(role + "-1"),
				"\"%s\" contro \"%s\""
				% [AgentNames.surname(role), AgentNames.surname(role + "-1")])

	# Gli alias in circolazione portano allo stesso posto del ruolo canonico.
	for alias: String in AgentNames.ROLE_ALIASES:
		var canonical := str(AgentNames.ROLE_ALIASES[alias])
		_check("alias %s → %s" % [alias, canonical],
				AgentNames.surname(alias + "-2")
						== AgentNames.surname(canonical + "-2"),
				"\"%s\" invece di \"%s\""
				% [AgentNames.surname(alias + "-2"),
						AgentNames.surname(canonical + "-2")])


## Nessun omonimo dentro un ruolo, e nessun quasi-omonimo: due cognomi che
## iniziano allo stesso modo si leggono uguali su una targhetta di scrivania,
## che è dove questi nomi passano la vita.
func _check_no_lookalikes() -> void:
	for role: String in AgentNames.SURNAMES:
		var list: Array = AgentNames.SURNAMES[role]
		var seen := {}
		var heads := {}
		for sn: String in list:
			_check("%s: cognome non vuoto" % role, sn.strip_edges() != "",
					"lista con una casella vuota")
			_check("%s: \"%s\" senza spazi né interpunzione" % [role, sn],
					sn == sn.strip_edges() and not sn.contains(" ")
							and not sn.contains(AgentNames.SEP.strip_edges()),
					"un cognome composto rompe la composizione con l'uid")
			_check("%s: \"%s\" è già in uso" % [role, sn], not seen.has(sn),
					"due agenti dello stesso ruolo con lo stesso cognome")
			seen[sn] = true
			var head := sn.substr(0, 3).to_lower()
			_check("%s: \"%s\" somiglia a \"%s\"" % [role, sn, heads.get(head, "")],
					not heads.has(head),
					"stesse prime tre lettere: indistinguibili a colpo d'occhio")
			heads[head] = sn


## Fuori dalla lista, fuori dai ruoli noti, e senza un numero: sempre l'uid
## nudo, mai un errore. Il fallback è la parte che gira davvero il giorno in
## cui il Capitano spawna l'undicesimo Scout.
func _check_fallback() -> void:
	var casi := [
		# [uid, cognome atteso, cosa dimostra]
		["scout-99", "", "oltre la lista non si ricicla un cognome"],
		["scout-0", "", "il numero zero non esiste nel roster"],
		["scout--1", "", "un numero negativo non è un'identità"],
		["vps-1", "", "ruolo sconosciuto: nessun nome inventato"],
		["sentinella-worker", "", "suffisso non numerico: nessuna identità stabile"],
		["critico-s1", "", "uid di sessione: non è l'istanza 1"],
		["", "", "stringa vuota"],
		["   ", "", "solo spazi"],
	]
	for caso in casi:
		var uid := str(caso[0])
		_check("fallback \"%s\" (%s)" % [uid, caso[2]],
				AgentNames.surname(uid) == str(caso[1]),
				"cognome \"%s\" invece di \"%s\""
				% [AgentNames.surname(uid), caso[1]])
		# Senza cognome la UI deve mostrare esattamente quello che mostrava
		# prima: l'uid, non una riga vuota e non un separatore orfano.
		_check("senza cognome \"%s\" resta se stesso" % uid,
				AgentNames.display_name(uid) == uid,
				"display_name = \"%s\"" % AgentNames.display_name(uid))
		_check("short_name di \"%s\" resta l'uid" % uid,
				AgentNames.short_name(uid) == uid,
				"short_name = \"%s\"" % AgentNames.short_name(uid))
		_check("has_surname(\"%s\") è falso" % uid,
				not AgentNames.has_surname(uid), "dichiara un cognome che non c'è")

	# Maiuscole e spazi accidentali non devono far perdere il nome: gli uid
	# arrivano da fonti diverse (roster VPS, mock, tour) e non sempre puliti.
	_check("uid con spazi", AgentNames.surname("  scout-2  ") == "Colombo",
			"\"%s\"" % AgentNames.surname("  scout-2  "))
	_check("uid maiuscolo", AgentNames.surname("SCOUT-2") == "Colombo",
			"\"%s\"" % AgentNames.surname("SCOUT-2"))


## Ogni ruolo che il gioco mette in scena ha la sua lista. Il giorno in cui
## nasce un ruolo nuovo questo test è l'unico posto che se ne accorge: senza,
## il ruolo nuovo resterebbe senza nome e nessuno lo noterebbe fino a vederlo
## a schermo.
func _check_coverage() -> void:
	for slug: String in CharacterDefs.AGENTS:
		_check("il ruolo in scena \"%s\" ha un cognome" % slug,
				AgentNames.has_surname(slug),
				"CharacterDefs.AGENTS lo mette in ufficio ma AgentNames non lo conosce")
	for dept_id: String in CharacterDefs.DEPT_ROLES:
		var slug := str(CharacterDefs.DEPT_ROLES[dept_id]["slug"])
		_check("il reparto \"%s\" ha una lista" % dept_id,
				AgentNames.roster_size(slug) > 0,
				"nessun cognome per lo slug \"%s\"" % slug)
		# L'id di reparto (plurale) deve funzionare quanto lo slug.
		_check("l'id di reparto \"%s\" è un alias valido" % dept_id,
				AgentNames.roster_size(dept_id) == AgentNames.roster_size(slug),
				"\"%s\" non risolve a \"%s\"" % [dept_id, slug])

	for role in DEPT_ROLES:
		_check("il ruolo %s scala" % role,
				AgentNames.roster_size(role) >= MIN_DEPT_SURNAMES,
				"solo %d cognomi: il Capitano ne spawna di più"
				% AgentNames.roster_size(role))
		# Tutte le posizioni della lista sono raggiungibili da un uid vero.
		for n in range(1, AgentNames.roster_size(role) + 1):
			_check("%s-%d ha un cognome" % [role, n],
					AgentNames.surname("%s-%d" % [role, n]) != "",
					"buco nella lista alla posizione %d" % n)


## Ogni carattere di ogni cognome deve già esistere nei dizionari delle 7
## lingue. Non è pedanteria: il font di gioco è quello, e un carattere che
## nessuna delle sette lingue usa è un carattere che nessuno ha mai visto
## disegnato. Un cognome con un diacritico esotico si scopre rotto solo
## aprendo il gioco, e si scopre come un rettangolo vuoto su una targhetta.
func _check_renderable() -> void:
	var allowed := _charset_of_dictionaries()
	_check("set di caratteri raccolto", allowed.size() > 60,
			"solo %d caratteri dai dizionari: il test non sta leggendo niente"
			% allowed.size())
	if allowed.size() <= 60:
		return
	for role: String in AgentNames.SURNAMES:
		for sn: String in AgentNames.SURNAMES[role]:
			for i in sn.length():
				var c := sn[i]
				_check("%s: \"%s\" usa un carattere fuori dizionario" % [role, sn],
						allowed.has(c),
						"il carattere U+%04X non compare in nessuna delle 7 lingue"
						% c.unicode_at(0))
	# Anche il separatore: se un domani diventasse un carattere esotico, la
	# riga composta si romperebbe ovunque in una volta sola.
	for i in AgentNames.SEP.length():
		var c := AgentNames.SEP[i]
		_check("il separatore usa un carattere fuori dizionario", allowed.has(c),
				"U+%04X" % c.unicode_at(0))


## Tutti i caratteri che compaiono nei valori dei 7 dizionari UI. I dizionari
## si leggono dal loro file e finiscono in una variabile locale: mai
## `UIStrings.lang`, mai `UIStrings.t()` — svegliare quella cache statica è
## costato un ACCESS_VIOLATION su Windows a headless_exit_selftest.
func _charset_of_dictionaries() -> Dictionary:
	var out := {}
	_collect_chars(UIStrings.S, out)
	for lang in LANGS:
		var path := "res://scripts/i18n/ui_%s.gd" % lang
		if not ResourceLoader.exists(path):
			_fails.append("dizionario mancante: %s" % path)
			continue
		var script: GDScript = load(path)
		var d: Dictionary = script.get_script_constant_map().get("S", {})
		if d.is_empty():
			_fails.append("dizionario %s vuoto" % lang)
			continue
		_collect_chars(d, out)
	return out


static func _collect_chars(dict: Dictionary, out: Dictionary) -> void:
	for key in dict:
		var value := str(dict[key])
		for i in value.length():
			out[value[i]] = true


## La composizione: il cognome davanti, l'uid dietro, l'interpunto in mezzo.
## L'uid tecnico deve restare dentro INTATTO — è la chiave con cui il resto
## del gioco ritrova l'agente, e mostrarne una versione mutilata è il modo
## più veloce di far parlare l'utente di "scout uno" mentre il log parla di
## "scout-1".
func _check_format() -> void:
	_check("display_name compone cognome e uid",
			AgentNames.display_name("scout-1") == "Holmes · scout-1",
			"\"%s\"" % AgentNames.display_name("scout-1"))
	_check("short_name dà il solo cognome",
			AgentNames.short_name("analista-3") == "Curie",
			"\"%s\"" % AgentNames.short_name("analista-3"))

	for role: String in AgentNames.SURNAMES:
		for n in range(1, AgentNames.roster_size(role) + 1):
			var uid := "%s-%d" % [role, n]
			var full := AgentNames.display_name(uid)
			var sn := AgentNames.surname(uid)
			_check("%s: l'uid resta nella riga" % uid, full.contains(uid),
					"\"%s\" non contiene l'uid tecnico" % full)
			_check("%s: il cognome apre la riga" % uid, full.begins_with(sn),
					"\"%s\" non inizia con \"%s\"" % [full, sn])
			_check("%s: c'è il separatore" % uid, full.contains(AgentNames.SEP),
					"\"%s\" senza separatore" % full)

	# with_label mette il cognome davanti al nome di scena senza duplicarlo.
	_check("with_label antepone il cognome",
			AgentNames.with_label("scout-1", "Il Ricercatore")
					== "Holmes · Il Ricercatore",
			"\"%s\"" % AgentNames.with_label("scout-1", "Il Ricercatore"))
	_check("with_label non raddoppia un cognome già presente",
			AgentNames.with_label("scout-1", "Holmes") == "Holmes",
			"\"%s\"" % AgentNames.with_label("scout-1", "Holmes"))
	_check("with_label senza cognome lascia l'etichetta",
			AgentNames.with_label("vps-1", "Il Server") == "Il Server",
			"\"%s\"" % AgentNames.with_label("vps-1", "Il Server"))
	_check("with_label senza etichetta ripiega sull'uid",
			AgentNames.with_label("vps-1", "") == "vps-1",
			"\"%s\"" % AgentNames.with_label("vps-1", ""))


## Le superfici che mostrano i cognomi li chiedono ancora ad AgentNames.
##
## Contratto sul SORGENTE, non sul comportamento: questi pannelli vivono di
## autoload (BackendBus, TeamData, Sfx) che sotto `godot --script` non
## esistono, quindi costruirli qui non compilerebbe nemmeno — è la stessa
## ragione per cui headless_exit_selftest controlla shutdown_dialog.gd come
## testo. Serve perché una mappa perfetta e nessun chiamante è indistinguibile
## da nessuna mappa: il test resterebbe verde e a schermo tornerebbe `scout-1`
## nudo, senza che nulla si rompa.
func _check_surfaces_wired() -> void:
	var surfaces := {
		# il nome nel roster: da qui i cognomi raggiungono ogni pannello che
		# mostra `name` (scheda agente, elenco agenti, targa dei dialoghi)
		"res://scripts/backend/vps_backend.gd": "AgentNames.display_name(uid, name)",
		"res://scripts/backend/mock_backend.gd": "AgentNames.display_name(",
		# le superfici che stampano l'uid grezzo
		"res://scripts/ui/shutdown_dialog.gd": "AgentNames.display_name(",
		"res://scripts/ui/section_panel.gd": "AgentNames.display_name(",
		"res://scripts/ui/agent_usage_view.gd": "AgentNames.display_name(",
		# gli spazi stretti: solo cognome
		"res://scripts/ui/department_panel.gd": "AgentNames.short_name(",
		"res://scripts/office/office.gd": "AgentNames.short_name(",
		"res://scripts/characters/agent_npc.gd": "AgentNames.short_name(",
	}
	for path: String in surfaces:
		var src := FileAccess.get_file_as_string(path)
		_check("%s leggibile" % path.get_file(), src != "",
				"file vuoto o assente")
		if src == "":
			continue
		_check("%s mostra ancora i cognomi" % path.get_file(),
				src.contains(str(surfaces[path])),
				"non chiama più %s: la superficie è tornata all'uid nudo"
				% surfaces[path])
