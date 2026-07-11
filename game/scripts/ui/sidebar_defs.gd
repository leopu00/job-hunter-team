class_name SidebarDefs
## Le sezioni della sidebar di gioco: SPECCHIO 1:1 della desktop app.
## Fonte di verità: desktop/renderer/index.html (data-section, gruppi e
## ordine) — non inventare voci, la migrazione porta qui quelle vere.

const GROUPS := [
	{
		"title": "Team",
		"items": [
			{"id": "team", "icon": "🚀", "label": "Team"},
			{"id": "agents", "icon": "🤖", "label": "Agenti"},
			{"id": "chat", "icon": "💬", "label": "Chat"},
			{"id": "notifs", "icon": "🔔", "label": "Notifiche"},
		],
	},
	{
		"title": "Lavoro",
		"items": [
			{"id": "dashboard", "icon": "📊", "label": "Dashboard"},
			{"id": "stats", "icon": "📈", "label": "Statistiche"},
			{"id": "apps", "icon": "📨", "label": "Candidature"},
			{"id": "map", "icon": "🗺", "label": "Mappa"},
			{"id": "activity", "icon": "📜", "label": "Attività"},
		],
	},
	{
		"title": "Impostazioni",
		"items": [
			{"id": "profile", "icon": "📝", "label": "Profilo"},
			{"id": "hours", "icon": "⏰", "label": "Orari"},
			{"id": "provider", "icon": "🧠", "label": "Provider"},
			{"id": "docker", "icon": "🐳", "label": "Docker"},
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
				return item["label"]
	return section
