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
	"agent.pile": "Fogli sulla scrivania: %d",

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
}
