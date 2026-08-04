class_name SidebarDefs
## Le sezioni dell'unica applicazione desktop. Questa lista è ora la fonte di
## verità per gruppi, voci e ordine della navigazione nativa.
##
## Le sezioni sono ventotto: elencarle tutte in colonna faceva una sidebar più
## alta dello schermo (a 1280×720 "Grafica" era l'ultima riga visibile e le
## quattro voci successive esistevano solo per chi scopriva di poter scrollare).
## Da qui in poi la colonna mostra quattordici righe e le altre restano raggiungibili
## dentro la finestra che le raccoglie:
##   • le cinque viste di monitoraggio (MONITOR_SECTIONS) sono schede di una
##     stessa finestra "Monitoraggio";
##   • le undici pagine di configurazione (SETTINGS_GROUPS) stanno dietro la
##     voce "Impostazioni", che le presenta a riquadri.
## Il Profilo resta una riga diretta: è parte del percorso critico di avvio e
## correzione dati, non un'impostazione rara da dover ricordare dove cercare.
## Gli id delle sezioni NON cambiano: i deep-link (`navigate.emit`, JHT_SECTION,
## l'onboarding guidato) continuano a puntare dove puntavano.

## `label` resta il fallback italiano; a schermo passa da UIStrings
## con la chiave "side.<id>" (e "side.<group_key>" per i titoli gruppo).
##
## `icon` è l'id di una forma vettoriale di SidebarIcon, MAI un'emoji: i glifi
## emoji dipendono dai font di sistema e su Linux due terzi di essi finivano in
## rettangoli vuoti (vedi sidebar_icon.gd).
##
## `nav_key` è l'etichetta della RIGA quando differisce dal titolo della
## sezione: la riga "Monitoraggio" apre la sezione `stats`, che dentro la
## finestra si chiama ancora "Statistiche" perché è una delle sue schede.
const GROUPS := [
	{
		# Prima il lavoro: sono le viste che si aprono ogni giorno, e la prima
		# riga della colonna è il posto più economico da raggiungere.
		"title": "Lavoro",
		"key": "group_work",
		"items": [
			{"id": "dashboard", "icon": "dashboard", "label": "Dashboard"},
			{"id": "positions", "icon": "target", "label": "Posizioni"},
			{"id": "apps", "icon": "inbox", "label": "Candidature"},
			{"id": "map", "icon": "map", "label": "Mappa"},
			{"id": "stats", "icon": "chart-up", "label": "Monitoraggio",
					"nav_key": "side.monitor"},
		],
	},
	{
		"title": "Team",
		"key": "group_team",
		"items": [
			{"id": "activation", "icon": "bolt", "label": "Attiva team"},
			{"id": "team", "icon": "users", "label": "Team"},
			{"id": "agents", "icon": "robot", "label": "Agenti"},
			{"id": "chat", "icon": "chat", "label": "Chat"},
			{"id": "notifs", "icon": "bell", "label": "Notifiche"},
		],
	},
	{
		# Tre righe sole: la segnalazione problemi non ha più bisogno di un
		# gruppo tutto suo per non finire sotto il bordo dello schermo.
		"title": "Sistema",
		"key": "group_system",
		"items": [
			{"id": "profile", "icon": "doc", "label": "Profilo"},
			{"id": "settings", "icon": "gear", "label": "Impostazioni"},
			{"id": "feedback", "icon": "bug", "label": "Segnala un problema"},
			# Uscire dal gioco deve essere possibile COL MOUSE. In fullscreen su
			# Wayland la finestra non ha decorazioni — niente X — e finché questa
			# voce non c'è stata l'unica via era il menu ESC: se l'input da
			# tastiera si perde (sessione remota, 25/07) l'utente resta chiuso
			# dentro. `label_key` riusa la traduzione già esistente del menu pausa.
			{"id": "quit", "icon": "power", "label": "Esci dal gioco",
					"label_key": "pause.quit"},
		],
	},
]

## Le viste che rispondono a "come sta andando": una sola voce in sidebar, e
## dentro il pannello una riga di schede. Non è un secondo meccanismo di
## navigazione — le schede emettono lo stesso segnale `navigate` che la sidebar
## instrada già, quindi ogni scheda resta una sezione con il suo id e il suo
## deep-link. La PRIMA è quella che apre la voce di sidebar.
const MONITOR_SECTIONS := ["stats", "activity", "usage_history",
		"usage_agents", "agent_metrics"]

## Le pagine che si toccano una volta sola, raccolte dietro "Impostazioni".
## Ognuna resta una sezione a sé (l'onboarding guidato ci salta dentro
## direttamente): il gruppo serve solo a disegnarle a riquadri e a dare a
## ciascuna la briciola di ritorno.
const SETTINGS_GROUPS := [
	{
		"key": "settings.grp_setup",
		"items": [
			{"id": "vps", "icon": "server"},
			{"id": "docker", "icon": "container"},
			{"id": "provider", "icon": "chip"},
			{"id": "hours", "icon": "clock"},
			{"id": "advanced", "icon": "gear"},
		],
	},
	{
		"key": "settings.grp_channels",
		"items": [
			{"id": "account", "icon": "user"},
			{"id": "email", "icon": "envelope"},
			{"id": "telegram", "icon": "plane"},
		],
	},
	{
		"key": "settings.grp_interface",
		"items": [
			{"id": "appearance", "icon": "contrast"},
			{"id": "graphics", "icon": "display"},
			{"id": "language", "icon": "globe"},
		],
	},
]

## L'id della sezione "contenitore" di `settings`: la voce di sidebar e il
## pannello a riquadri.
const SETTINGS_HUB := "settings"


static func is_settings_section(section: String) -> bool:
	for group in SETTINGS_GROUPS:
		for item in group["items"]:
			if item["id"] == section:
				return true
	return false


## Le schede da disegnare in cima al pannello di `section`, vuoto se la
## sezione non fa parte di una famiglia.
static func tabs_for(section: String) -> Array:
	return MONITOR_SECTIONS.duplicate() if MONITOR_SECTIONS.has(section) else []


## La voce di sidebar che "possiede" una sezione: serve a tenere accesa la
## riga giusta anche quando il pannello aperto è una scheda o una pagina di
## configurazione, che in colonna non hanno più una riga propria.
static func nav_host(section: String) -> String:
	if MONITOR_SECTIONS.has(section):
		return MONITOR_SECTIONS[0]
	if is_settings_section(section):
		return SETTINGS_HUB
	return section


## Il titolo della finestra. Per le sezioni-scheda è il nome della famiglia
## ("Monitoraggio"), non quello della scheda: il nome della scheda è già
## acceso nella riga sotto al titolo.
static func title_for(section: String) -> String:
	if MONITOR_SECTIONS.has(section):
		return _key_label("side.monitor", "Monitoraggio")
	return label_for(section)


static func label_for(section: String) -> String:
	for group in GROUPS:
		for item in group["items"]:
			if item["id"] == section:
				return _item_label(item)
	return _key_label("side." + section, section)


## Etichetta della riga in sidebar: coincide col nome della sezione tranne
## quando la voce apre una famiglia di schede (vedi `nav_key`).
static func nav_label(item: Dictionary) -> String:
	if item.has("nav_key"):
		return _key_label(str(item["nav_key"]), str(item["label"]))
	return _item_label(item)


static func icon_for(section: String) -> String:
	for group in GROUPS:
		for item in group["items"]:
			if item["id"] == section:
				return str(item["icon"])
	for group in SETTINGS_GROUPS:
		for item in group["items"]:
			if item["id"] == section:
				return str(item["icon"])
	return "gear"


static func _item_label(item: Dictionary) -> String:
	if item.has("label_key"):
		# la chiave riusata viene da un menu tutto maiuscolo: qui serve la
		# stessa forma delle altre righe, cioè maiuscola SOLO all'inizio.
		# (`capitalize()` metterebbe l'iniziale a ogni parola — "Esci Dal
		# Gioco" — e la riga stonerebbe accanto a "Segnala un problema".)
		var reused: String = UIStrings.t(str(item["label_key"]))
		if reused != "" and reused == reused.to_upper():
			return reused.left(1) + reused.substr(1).to_lower()
		return reused
	return _key_label("side." + str(item["id"]), str(item["label"]))


## fallback: se la chiave non esiste t() la restituisce tale e quale — in
## quel caso vale l'etichetta italiana scritta nella def.
static func _key_label(key: String, fallback: String) -> String:
	var translated: String = UIStrings.t(key)
	return translated if translated != key else fallback


static func group_title(group: Dictionary) -> String:
	var key: String = "side." + str(group.get("key", ""))
	var translated: String = UIStrings.t(key)
	return translated if translated != key else str(group["title"])
