class_name MockDataSource
extends TeamDataSource
## Dati finti ma verosimili per il vertical slice. Nessuna chiamata esterna.

## Esempi UNIVERSALI (feedback Leone 21/07): una famiglia professionale
## coerente e capibile da chiunque, non solo profili da ingegnere.
const POSITIONS := [
	{
		"title": "Responsabile Comunicazione",
		"company": "Bottega Aurora",
		"location": "Milano · ibrido",
		"score": 82,
		"salary": "~42k EUR",
		"note": "esperienze molto vicine al tuo CV",
	},
	{
		"title": "Specialista Marketing Digitale",
		"company": "Ferrovia Digitale",
		"location": "Roma · remoto",
		"score": 74,
		"salary": "~38k EUR",
		"note": "ottimo team, trasferte da chiarire",
	},
	{
		"title": "Account Manager",
		"company": "Chiaroscuro Media",
		"location": "Berlino · in sede",
		"score": 61,
		"salary": "~45k EUR",
		"note": "richiede tedesco B2",
	},
]

func get_team_summary() -> Dictionary:
	return {
		"positions_today": POSITIONS.size(),
		"avg_score": 72,
		"budget_used_pct": 0.38,
	}

func get_positions_today() -> Array:
	return _localized_positions()

func get_agent_status() -> Dictionary:
	return {
		"coordinatore": {"status": _t("dept.mock.status.coordinatore.status", "attivo"), "detail": _t("dept.mock.status.coordinatore.detail", "pacing regolare, weekly al 64%")},
		"scout": {"status": _t("dept.mock.status.scout.status", "in scansione"), "detail": _t("dept.mock.status.scout.detail", "3 board visitate nell'ultima ora")},
		"analista": {"status": _t("dept.mock.status.analista.status", "al lavoro"), "detail": _t("dept.mock.status.analista.detail", "2 posizioni in verifica")},
		"scorer": {"status": _t("dept.mock.status.scorer.status", "in valutazione"), "detail": _t("dept.mock.status.scorer.detail", "coda: 1 posizione")},
		"mentor": {"status": _t("dept.mock.status.mentor.status", "disponibile"), "detail": _t("dept.mock.status.mentor.detail", "pronto a consigliarti")},
		"assistente": {"status": _t("dept.mock.status.assistente.status", "disponibile"), "detail": _t("dept.mock.status.assistente.detail", "onboarding completato")},
	}

func get_score_explanation() -> Dictionary:
	return {
		"title": _localized_positions()[0]["title"],
		"company": POSITIONS[0]["company"],
		"score": POSITIONS[0]["score"],
		# Motivazioni CONCRETE e quotidiane (feedback Leone 21/07): meno
		# percentuali astratte, più vita reale.
		"reasons": [
			_t("dept.mock.reason.1", "l'annuncio ricalca due esperienze già nel tuo CV"),
			_t("dept.mock.reason.2", "la sede è in centro, vicino a una delle tue città prioritarie"),
			_t("dept.mock.reason.3", "stipendio sopra la soglia che hai indicato"),
			_t("dept.mock.reason.4", "-8 punti: chiedono disponibilità anche nel weekend"),
		],
	}

func get_mentor_tip() -> String:
	return _t("dept.mock.mentor_tip", "Nei colloqui, racconta i risultati con i numeri: non «ho migliorato le cose», ma «ho ridotto i tempi di attesa del 40%».")

const APPLICATIONS := [
	{"title": "Responsabile Punto Vendita", "company": "Vetriera Retail", "score": 84, "stage": 3},
	{"title": "Responsabile Comunicazione", "company": "Bottega Aurora", "score": 82, "stage": 2},
	{"title": "Addetto/a Amministrazione", "company": "Brumaio & Soci", "score": 77, "stage": 1},
	{"title": "Account Manager", "company": "Chiaroscuro Media", "score": 61, "stage": 0},
]

const APPLICATION_TITLE_KEYS := [
	"dept.mock.application.1.title", "dept.mock.application.2.title",
	"dept.mock.application.3.title", "dept.mock.application.4.title",
]

func get_applications() -> Array:
	var out: Array = []
	for i in APPLICATIONS.size():
		var row: Dictionary = APPLICATIONS[i].duplicate(true)
		row["title"] = _t(APPLICATION_TITLE_KEYS[i], str(row["title"]))
		out.append(row)
	return out

func get_streak() -> Dictionary:
	return {"days": 5, "freezes": 1}

## Attività recenti per ruolo: righe verosimili, coerenti con lo status.
const ACTIVITY := {
	"scout": [
		{"when": "12 min fa", "text": "trovata posizione: Frontend Engineer @ Lumon"},
		{"when": "41 min fa", "text": "scansione board: 2 annunci nuovi, 1 duplicato"},
		{"when": "1 h fa", "text": "pagina careers nuova messa in osservazione"},
	],
	"analista": [
		{"when": "8 min fa", "text": "verificato range salariale (fonte incrociata)"},
		{"when": "35 min fa", "text": "arricchiti i dati sede: ufficio ibrido, 2 gg"},
		{"when": "2 h fa", "text": "scartato annuncio: requisiti incoerenti"},
	],
	"scorer": [
		{"when": "5 min fa", "text": "score 85: competenze coperte all'85%"},
		{"when": "1 h fa", "text": "score 61: salario sotto soglia, segnalato"},
	],
	"scrittore": [
		{"when": "20 min fa", "text": "bozza CV su misura per Frontend Engineer"},
		{"when": "1 h fa", "text": "lettera rivista dopo le note del Critico"},
	],
	"critico": [
		{"when": "15 min fa", "text": "revisione CV: 3 note, 1 refuso fermato"},
		{"when": "2 h fa", "text": "approvata lettera per Data Analyst"},
	],
	"coordinatore": [
		{"when": "3 min fa", "text": "giro dei reparti completato, ritmo ok"},
		{"when": "30 min fa", "text": "pacing ricalibrato sul weekly (64%)"},
	],
	"mentor": [
		{"when": "1 h fa", "text": "preparato il consiglio del giorno"},
	],
	"assistente": [
		{"when": "10 min fa", "text": "registro candidature aggiornato"},
	],
}

func get_agent_activity(slug: String) -> Array:
	var source: Array = ACTIVITY.get(slug, [])
	var out: Array = []
	for i in source.size():
		var row: Dictionary = source[i].duplicate(true)
		row["text"] = _t("dept.mock.activity.%s.%d.text" % [slug, i + 1],
				str(row["text"]))
		row["when"] = _localized_relative_time(str(row["when"]))
		out.append(row)
	return out

func get_usage() -> Dictionary:
	return {
		"provider": "Kimi K2.7",
		"actions_today": 41,
		"actions_week": 212,
		"quota_week_pct": 0.64,
		"tokens_today": "1.2M",
		"budget_used_pct": 0.35,
	}

const NOTIFICATIONS := [
	{"when": "5 min fa", "level": "info", "text": "Nuova posizione sopra soglia: Frontend Engineer @ Lumon (85)"},
	{"when": "1 h fa", "level": "warn", "text": "Quota settimanale al 64%: pacing regolare"},
	{"when": "2 h fa", "level": "info", "text": "CV approvato dal Critico per Data Analyst"},
	{"when": "ieri", "level": "info", "text": "Candidatura passata allo stadio colloquio"},
]

const CHAT := [
	{"when": "09:12", "from": "coordinatore", "text": "buongiorno team, weekly al 64%: ritmo buono"},
	{"when": "09:31", "from": "scout", "text": "2 annunci nuovi da Berlino, li passo agli analisti"},
	{"when": "10:02", "from": "analista", "text": "range salariale verificato su fonte doppia"},
	{"when": "10:15", "from": "scorer", "text": "score 85 su Lumon: sopra soglia, notifica inviata"},
	{"when": "10:40", "from": "critico", "text": "CV ok dopo due giri: si spedisce"},
]

func get_notifications() -> Array:
	return _localized_rows(NOTIFICATIONS, "notification")

func get_chat() -> Array:
	return _localized_rows(CHAT, "chat")


func _localized_positions() -> Array:
	var out: Array = []
	for i in POSITIONS.size():
		var source: Dictionary = POSITIONS[i]
		var row := source.duplicate()
		var n := i + 1
		row["title"] = _t("dept.mock.position.%d.title" % n, str(source["title"]))
		row["location"] = _t("dept.mock.position.%d.location" % n, str(source["location"]))
		row["note"] = _t("dept.mock.position.%d.note" % n, str(source["note"]))
		out.append(row)
	return out


func _localized_rows(source: Array, kind: String) -> Array:
	var out: Array = []
	for i in source.size():
		var row: Dictionary = source[i].duplicate()
		row["text"] = _t("dept.mock.%s.%d" % [kind, i + 1], str(row["text"]))
		out.append(row)
	return out


func _t(key: String, fallback: String) -> String:
	var translated := UIStrings.t(key)
	return fallback if translated == key else translated


func _localized_relative_time(raw: String) -> String:
	var parts := raw.split(" ", false)
	if parts.size() == 3 and parts[0].is_valid_int() and parts[2] == "fa":
		var key := "time.minutes_ago" if parts[1] == "min" else \
				"time.hours_ago" if parts[1] == "h" else ""
		if key != "":
			return _t(key, raw) % int(parts[0])
	return raw

const SETTINGS := {
	"profile": [
		["Candidato", "Il Candidato"],
		["Ruolo target", "Data Analyst / BI"],
		["Città prioritaria", "Berlino"],
		["Seniority", "mid"],
		["Lingue", "IT · EN · DE"],
		["Permesso di lavoro", "UE"],
	],
	"hours": [
		["Attività team", "08:00 – 20:00"],
		["Giorni", "lun – ven"],
		["Pacing", "adattivo sul weekly"],
		["Hard-stop giornaliero", "attivo"],
	],
	"provider": [
		["Provider", "Kimi K2.7"],
		["Chiave API", "configurata ✓"],
		["Tier", "standard"],
		["Fallback", "—"],
	],
	"docker": [
		["Container", "jht"],
		["Immagine", "jht:latest"],
		["Stato", "in esecuzione"],
		["Uptime", "3 h"],
		["Salute", "verde ✓"],
	],
	"account": [
		["Email", "c•••@esempio.dev"],
		["Piano", "beta"],
		["Sync cloud", "attivo"],
		["Ultimo sync", "2 min fa"],
	],
	"email": [
		["Casella team", "team-c4nd@jht.dev"],
		["Monitor", "attivo"],
		["Processate oggi", "6"],
		["Ultima email", "1 h fa"],
	],
	"language": [
		["Lingua interfaccia", "Italiano"],
		["Lingua CV", "segue l'annuncio"],
		["Disponibili", "IT · EN · DE · FR · ES · PT · NL"],
	],
	"advanced": [
		["Livello log", "info"],
		["Telemetria", "off"],
		["Flag sperimentali", "—"],
		["Cartella dati", "~/.jht"],
	],
}

const SETTINGS_LABEL_KEYS := {
	"profile": ["dept.mock.setting.profile.candidate", "prof.target_role",
		"dept.mock.setting.profile.priority_city", "dept.mock.setting.profile.seniority",
		"dept.mock.setting.profile.languages", "dept.mock.setting.profile.work_authorization"],
	"hours": ["dept.mock.setting.hours.activity", "dept.mock.setting.hours.days",
		"dept.mock.setting.hours.pacing", "dept.mock.setting.hours.hard_stop"],
	"provider": ["side.provider", "dept.mock.setting.provider.api_key",
		"dept.mock.setting.provider.tier", "dept.mock.setting.provider.fallback"],
	"docker": ["setup.container", "dept.mock.setting.docker.image", "account.status",
		"dept.mock.setting.docker.uptime", "dept.mock.setting.docker.health"],
	"account": ["prof.email", "dept.mock.setting.account.plan",
		"dept.mock.setting.account.cloud_sync", "dept.mock.setting.account.last_sync"],
	"email": ["dept.mock.setting.email.team_inbox", "dept.mock.setting.email.monitor",
		"dept.mock.setting.email.processed_today", "dept.mock.setting.email.last_email"],
	"language": ["dept.mock.setting.language.interface", "dept.mock.setting.language.cv",
		"dept.mock.setting.language.available"],
	"advanced": ["dept.mock.setting.advanced.log_level",
		"dept.mock.setting.advanced.telemetry",
		"dept.mock.setting.advanced.experimental_flags",
		"dept.mock.setting.advanced.data_folder"],
}

const SETTINGS_VALUE_KEYS := {
	"profile": {0: "dept.mock.setting.profile.candidate_value",
		2: "dept.mock.setting.profile.priority_city_value",
		3: "dept.mock.setting.profile.seniority_value",
		5: "dept.mock.setting.profile.work_authorization_value"},
	"hours": {1: "dept.mock.setting.hours.days_value",
		2: "dept.mock.setting.hours.pacing_value", 3: "common.enabled"},
	"provider": {1: "common.configured", 2: "common.standard"},
	"docker": {2: "common.running", 3: "dept.mock.setting.docker.uptime_value",
		4: "common.healthy"},
	"account": {2: "common.enabled"},
	"email": {1: "common.enabled"},
	"language": {0: "dept.mock.setting.language.interface_value",
		1: "dept.mock.setting.language.cv_value"},
	"advanced": {1: "common.off"},
}

func get_settings() -> Dictionary:
	var out := {}
	for section: String in SETTINGS:
		var source: Array = SETTINGS[section]
		var labels: Array = SETTINGS_LABEL_KEYS[section]
		var value_keys: Dictionary = SETTINGS_VALUE_KEYS.get(section, {})
		var rows: Array = []
		for i in source.size():
			var pair: Array = source[i].duplicate()
			pair[0] = _t(str(labels[i]), str(pair[0]))
			var raw_value := str(pair[1])
			if value_keys.has(i):
				pair[1] = _t(str(value_keys[i]), raw_value)
			else:
				pair[1] = _localized_relative_time(raw_value)
			rows.append(pair)
		out[section] = rows
	return out
