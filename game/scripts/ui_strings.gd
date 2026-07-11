class_name UIStrings
## Tutte le stringhe UI del gioco, centralizzate e in italiano.
## Il sito supporta 7 lingue: questo dizionario è il punto unico da
## tradurre quando il prototipo verrà internazionalizzato.

static func t(key: String) -> String:
	return S.get(key, key)

const S := {
	# ── Title screen ──────────────────────────────────────────────
	"title.wordmark": "JOB HUNTER TEAM",
	"title.press_enter": "▶ PREMI INVIO",
	"title.footer": "prototipo — dati mock, nessun backend",
	"title.hint_pause": "ESC menu",

	# ── Menu pausa ────────────────────────────────────────────────
	"pause.title": "PAUSA",
	"pause.resume": "RIPRENDI",
	"pause.window": "FINESTRA / SCHERMO INTERO",
	"pause.quit": "ESCI DAL GIOCO",

	# ── HUD ───────────────────────────────────────────────────────
	"hud.team": "TEAM",
	"hud.positions_today": "POSIZIONI OGGI",
	"hud.avg_score": "SCORE MEDIO",
	"hud.budget": "BUDGET",
	"hud.registry_hint": "TAB registro",
	"hud.team_default": "Team JHT",

	# ── Registro candidature ──────────────────────────────────────────
	"registry.title": "REGISTRO CANDIDATURE",
	"registry.streak": "STREAK %d giorni · %d freeze",
	"registry.empty": "nessuna candidatura ancora — parla con lo Scout",
	"registry.stage_0": "inviata",
	"registry.stage_1": "screening",
	"registry.stage_2": "colloquio",
	"registry.stage_3": "offerta",
	"registry.close": "[TAB] chiudi",
	"hud.dialogue_next": "[INVIO] continua",
	"hud.dialogue_skip": "[ESC] chiudi",

	# ── Pannello reparto ──────────────────────────────────────────
	"dept.desks": "POSTAZIONI",
	"dept.desk_free": "postazione libera",
	"dept.close": "click fuori per chiudere",
	"dept.inbox": "Inbox: %d fogli in attesa",

	# ── Scheda agente ─────────────────────────────────────────────
	"agent.activity": "ULTIME ATTIVITÀ",
	"agent.activity_none": "nessuna attività registrata",
	"agent.talk": "▶ PARLA",
	"agent.chat": "▶ CHAT COL TEAM",
	"agent.pile": "Fogli sulla scrivania: %d",

	# ── Pannello chat con l'agente ────────────────────────────────
	"chat.title": "CHAT — %s",
	"chat.placeholder": "scrivi un messaggio…",
	"chat.send": "INVIA",
	"chat.you": "TU",
	"chat.empty": "nessun messaggio ancora: scrivi tu per primo",

	# ── Impostazioni → Collega VPS ────────────────────────────────
	"vps.intro": "Collega la VPS del tuo team: IP e chiave SSH, al resto pensa il gioco.",
	"vps.ip": "IP DELLA VPS",
	"vps.key": "CHIAVE SSH (privata)",
	"vps.key_browse": "SFOGLIA…",
	"vps.connect": "▶ COLLEGA",
	"vps.disconnect": "■ SCOLLEGA",
	"vps.state_disconnected": "non collegato",
	"vps.state_connecting": "collegamento in corso…",
	"vps.state_connected": "COLLEGATO",
	"vps.state_error": "ERRORE",
	"vps.missing_fields": "inserisci IP e chiave SSH",
	"vps.agents_live": "AGENTI ATTIVI SULLA VPS",
	"vps.agents_none": "nessun agente attivo in questo momento",

	# ── Posizioni (vista web migrata) ─────────────────────────────
	"pos.need_vps": "Collega la VPS per vedere le posizioni reali del team (Impostazioni → Collega VPS).",
	"pos.count": "%d posizioni · %d visibili",
	"pos.clear": "✕ PULISCI FILTRI",
	"pos.no_match": "nessuna posizione con questi filtri",
	"pos.f_status": "STATO",
	"pos.f_family": "FAMIGLIA DI RUOLO",
	"pos.f_country": "PAESE",
	"pos.f_mode": "MODALITÀ",
	"pos.uncategorized": "senza categoria",

	# ── Dettaglio posizione ───────────────────────────────────────
	"pos.back": "◀ POSIZIONI",
	"pos.salary": "STIPENDIO",
	"pos.salary_estimated": "stima del team",
	"pos.salary_declared": "dichiarato nell'annuncio",
	"pos.summary": "RIASSUNTO DELL'ANNUNCIO",
	"pos.score_title": "SCORE — %d/100",
	"pos.score_none": "non ancora valutata dallo Scorer",
	"pos.score_rationale": "RAZIONALE DELLO SCORER",
	"pos.critic_title": "VOTO DEL CRITICO — %.1f/10",
	"pos.critic_none": "nessuna revisione del Critico (il voto arriva col CV)",
	"pos.highlights": "PUNTI CHIAVE",
	"pos.actions": "AZIONI RICHIESTE AL TEAM",
	"pos.act_write": "Scrittura CV",
	"pos.act_geocode": "Geocodifica ufficio",
	"pos.act_recheck": "Verifica annuncio ancora aperto",
	"pos.act_requested": "richiesta",
	"pos.act_not_requested": "non richiesta",
	"pos.act_note": "// le azioni le esegue il team sulla VPS — per chiedere qualcosa apri un ticket qui sotto",
	"pos.excluded_title": "ESCLUSA DALL'UTENTE",
	"pos.tickets": "TICKET APERTI COL TEAM",
	"pos.ticket_none": "nessun ticket per questa posizione",
	"pos.ticket_placeholder": "scrivi una richiesta al team su questa posizione…",
	"pos.ticket_send": "APRI TICKET",
	"pos.ticket_sending": "invio del ticket alla VPS…",
	"pos.ticket_ok": "✔ ticket aperto — il Coordinatore lo prenderà in carico",
	"pos.ticket_err": "✘ ticket non creato: %s",
	"pos.ticket_need_vps": "// collega la VPS per aprire ticket col team",
	"pos.found": "trovata da %s · %s",
	"pos.open_yes": "annuncio APERTO all'ultima verifica",
	"pos.open_no": "annuncio NON PIÙ APERTO",

	# ── GlobalSearch (Cmd+K) ──────────────────────────────────────
	"search.placeholder": "cerca posizioni: titolo, azienda, città…  (ESC chiude)",
	"search.no_match": "nessuna posizione trovata",
	"search.need_vps": "collega la VPS per cercare tra le posizioni reali",

	# ── Statistiche: grafici cross-filter (come la dashboard web) ─
	"stats.hint": "// click su una barra per filtrare: gli altri grafici si aggiornano",
	"stats.filters": "FILTRI ATTIVI: %d",
	"stats.reset": "✕ AZZERA",
	"stats.types": "TIPI DI RUOLO",
	"stats.countries": "PAESI",
	"stats.cities": "CITTÀ",
	"stats.scores": "SCORE (fasce da 5)",
	"stats.salaries": "STIPENDI (fasce da 20k €)",
	"stats.matches": "POSIZIONI CORRISPONDENTI — %d",
	"stats.no_city": "· senza città: %d",
	"stats.no_country": "(senza paese)",
	"stats.empty": "nessun dato con questi filtri",
	"stats.need_vps": "collega la VPS per i grafici sui dati reali",

	# ── Dashboard: pipeline del flusso reale ──────────────────────
	"dash.pipeline": "PIPELINE",
	"dash.pl_to_analyze": "Da analizzare",
	"dash.pl_analyzed": "Analizzate",
	"dash.pl_with_score": "Con lo score",
	"dash.pl_to_write": "Da scrivere",
	"dash.pl_written": "Scritte",
	"dash.pl_hint": "// click su un box per aprire le posizioni filtrate",
}
