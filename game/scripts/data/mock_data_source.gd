class_name MockDataSource
extends TeamDataSource
## Dati finti ma verosimili per il vertical slice. Nessuna chiamata esterna.

const POSITIONS := [
	{
		"title": "Backend Engineer (Python)",
		"company": "Nordwind Logistics",
		"location": "Amburgo · ibrido",
		"score": 82,
		"salary": "~68k EUR",
		"note": "stack allineato, seniority giusta",
	},
	{
		"title": "Platform Engineer",
		"company": "Ferrovia Digitale",
		"location": "Milano · remoto",
		"score": 74,
		"salary": "~55k EUR",
		"note": "ottimo team, on-call da chiarire",
	},
	{
		"title": "Site Reliability Engineer",
		"company": "Chiaroscuro Cloud",
		"location": "Berlino · in sede",
		"score": 61,
		"salary": "~72k EUR",
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
		"reasons": [
			"competenze richieste coperte all'85%",
			"range salariale sopra la tua soglia",
			"sede compatibile con le tue città prioritarie",
			"-8 punti: l'annuncio chiede reperibilità notturna",
		],
	}

func get_mentor_tip() -> String:
	return "Nei colloqui, racconta i risultati con i numeri: non «ho migliorato il sistema», ma «ho dimezzato i tempi di deploy»."

const APPLICATIONS := [
	{"title": "DevOps Engineer", "company": "Vetriera Systems", "score": 84, "stage": 3},
	{"title": "Backend Engineer (Python)", "company": "Nordwind Logistics", "score": 82, "stage": 2},
	{"title": "Data Platform Engineer", "company": "Brumaio Analytics", "score": 77, "stage": 1},
	{"title": "Site Reliability Engineer", "company": "Chiaroscuro Cloud", "score": 61, "stage": 0},
]

func get_applications() -> Array:
	return APPLICATIONS

func get_streak() -> Dictionary:
	return {"days": 5, "freezes": 1}
