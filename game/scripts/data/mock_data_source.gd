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
	return POSITIONS

func get_agent_status() -> Dictionary:
	return {
		"coordinatore": {"status": "attivo", "detail": "pacing regolare, weekly al 64%"},
		"scout": {"status": "in scansione", "detail": "3 board visitate nell'ultima ora"},
		"analista": {"status": "al lavoro", "detail": "2 posizioni in verifica"},
		"scorer": {"status": "in valutazione", "detail": "coda: 1 posizione"},
		"mentor": {"status": "disponibile", "detail": "pronto a consigliarti"},
		"assistente": {"status": "disponibile", "detail": "onboarding completato"},
	}

func get_score_explanation() -> Dictionary:
	return {
		"title": POSITIONS[0]["title"],
		"company": POSITIONS[0]["company"],
		"score": POSITIONS[0]["score"],
		# Motivazioni CONCRETE e quotidiane (feedback Leone 21/07): meno
		# percentuali astratte, più vita reale.
		"reasons": [
			"l'annuncio ricalca due esperienze già nel tuo CV",
			"la sede è in centro, vicino a una delle tue città prioritarie",
			"stipendio sopra la soglia che hai indicato",
			"-8 punti: chiedono disponibilità anche nel weekend",
		],
	}

func get_mentor_tip() -> String:
	return "Nei colloqui, racconta i risultati con i numeri: non «ho migliorato le cose», ma «ho ridotto i tempi di attesa del 40%»."

const APPLICATIONS := [
	{"title": "Responsabile Punto Vendita", "company": "Vetriera Retail", "score": 84, "stage": 3},
	{"title": "Responsabile Comunicazione", "company": "Bottega Aurora", "score": 82, "stage": 2},
	{"title": "Addetto/a Amministrazione", "company": "Brumaio & Soci", "score": 77, "stage": 1},
	{"title": "Account Manager", "company": "Chiaroscuro Media", "score": 61, "stage": 0},
]

func get_applications() -> Array:
	return APPLICATIONS

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
	return ACTIVITY.get(slug, [])

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
	return NOTIFICATIONS

func get_chat() -> Array:
	return CHAT

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

func get_settings() -> Dictionary:
	return SETTINGS
