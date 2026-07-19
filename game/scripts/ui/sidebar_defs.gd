class_name SidebarDefs
## Le sezioni dell'unica applicazione desktop. Questa lista è ora la fonte di
## verità per gruppi, voci e ordine della navigazione nativa.

## `label` resta il fallback italiano; a schermo passa da UIStrings
## con la chiave "side.<id>" (e "side.<group_key>" per i titoli gruppo).
const GROUPS := [
	{
		"title": "Team",
		"key": "group_team",
		"items": [
			{"id": "activation", "icon": "⚡", "label": "Attiva team"},
			{"id": "team", "icon": "🚀", "label": "Team"},
			{"id": "agents", "icon": "🤖", "label": "Agenti"},
			{"id": "agent_metrics", "icon": "📉", "label": "Risorse agenti"},
			{"id": "usage_history", "icon": "📈", "label": "Usage"},
			{"id": "usage_agents", "icon": "🔥", "label": "Consumi agenti"},
			{"id": "chat", "icon": "💬", "label": "Chat"},
			{"id": "notifs", "icon": "🔔", "label": "Notifiche"},
		],
	},
	{
		"title": "Lavoro",
		"key": "group_work",
		"items": [
			{"id": "dashboard", "icon": "📊", "label": "Dashboard"},
			{"id": "positions", "icon": "🎯", "label": "Posizioni"},
			{"id": "stats", "icon": "📈", "label": "Statistiche"},
			{"id": "apps", "icon": "📨", "label": "Candidature"},
			{"id": "map", "icon": "🗺", "label": "Mappa"},
			{"id": "activity", "icon": "📜", "label": "Attività"},
		],
	},
	{
		"title": "Impostazioni",
		"key": "group_settings",
		"items": [
			{"id": "vps", "icon": "🔌", "label": "Collega VPS"},
			{"id": "profile", "icon": "📝", "label": "Profilo"},
			{"id": "hours", "icon": "⏰", "label": "Orari"},
			{"id": "provider", "icon": "🧠", "label": "Provider"},
			{"id": "docker", "icon": "🐳", "label": "Docker"},
			{"id": "telegram", "icon": "✈", "label": "Telegram"},
			{"id": "account", "icon": "👤", "label": "Account"},
			{"id": "email", "icon": "📧", "label": "Email"},
			{"id": "language", "icon": "🌐", "label": "Lingua"},
			{"id": "advanced", "icon": "⚙", "label": "Avanzate"},
		],
	},
]

static func label_for(section: String) -> String:
	for group in GROUPS:
		for item in group["items"]:
			if item["id"] == section:
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
