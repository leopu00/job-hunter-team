class_name SidebarDefs
## Le sezioni dell'unica applicazione desktop. Questa lista è ora la fonte di
## verità per gruppi, voci e ordine della navigazione nativa.

## `label` resta il fallback italiano; a schermo passa da UIStrings
## con la chiave "side.<id>" (e "side.<group_key>" per i titoli gruppo).
##
## `icon` è l'id di una forma vettoriale di SidebarIcon, MAI un'emoji: i glifi
## emoji dipendono dai font di sistema e su Linux due terzi di essi finivano in
## rettangoli vuoti (vedi sidebar_icon.gd).
const GROUPS := [
	{
		"title": "Team",
		"key": "group_team",
		"items": [
			{"id": "activation", "icon": "bolt", "label": "Attiva team"},
			{"id": "team", "icon": "users", "label": "Team"},
			{"id": "agents", "icon": "robot", "label": "Agenti"},
			{"id": "agent_metrics", "icon": "chart-down", "label": "Risorse agenti"},
			{"id": "usage_history", "icon": "chart-up", "label": "Usage"},
			{"id": "usage_agents", "icon": "flame", "label": "Consumi agenti"},
			{"id": "chat", "icon": "chat", "label": "Chat"},
			{"id": "notifs", "icon": "bell", "label": "Notifiche"},
		],
	},
	{
		"title": "Lavoro",
		"key": "group_work",
		"items": [
			{"id": "dashboard", "icon": "dashboard", "label": "Dashboard"},
			{"id": "positions", "icon": "target", "label": "Posizioni"},
			{"id": "stats", "icon": "bars", "label": "Statistiche"},
			{"id": "apps", "icon": "inbox", "label": "Candidature"},
			{"id": "map", "icon": "map", "label": "Mappa"},
			{"id": "activity", "icon": "activity", "label": "Attività"},
		],
	},
	{
		"title": "Impostazioni",
		"key": "group_settings",
		"items": [
			{"id": "vps", "icon": "server", "label": "Collega VPS"},
			{"id": "profile", "icon": "doc", "label": "Profilo"},
			{"id": "hours", "icon": "clock", "label": "Orari"},
			{"id": "provider", "icon": "chip", "label": "Provider"},
			{"id": "docker", "icon": "container", "label": "Docker"},
			{"id": "telegram", "icon": "plane", "label": "Telegram"},
			{"id": "account", "icon": "user", "label": "Account"},
			{"id": "email", "icon": "envelope", "label": "Email"},
			{"id": "appearance", "icon": "contrast", "label": "Aspetto"},
			{"id": "graphics", "icon": "display", "label": "Grafica"},
			{"id": "language", "icon": "globe", "label": "Lingua"},
			{"id": "advanced", "icon": "gear", "label": "Avanzate"},
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

static func label_for(section: String) -> String:
	for group in GROUPS:
		for item in group["items"]:
			if item["id"] == section:
				if item.has("label_key"):
					var reused: String = UIStrings.t(str(item["label_key"]))
					return reused.capitalize() if reused == reused.to_upper() \
							else reused
				var translated: String = UIStrings.t("side." + section)
				# fallback: se la chiave non esiste t() la restituisce tale
				# e quale — in quel caso vale la label italiana della def
				return translated if translated != "side." + section \
						else item["label"]
	return section

static func group_title(group: Dictionary) -> String:
	var key: String = "side." + str(group.get("key", ""))
	var translated: String = UIStrings.t(key)
	return translated if translated != key else str(group["title"])
