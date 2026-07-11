class_name UIStrings
## Tutte le stringhe UI del gioco, centralizzate e in italiano.
## Il sito supporta 7 lingue: questo dizionario è il punto unico da
## tradurre quando il prototipo verrà internazionalizzato.

static func t(key: String) -> String:
	return S.get(key, key)

const S := {
	# ── Title screen ──────────────────────────────────────────────
	"title.wordmark": "JOB HUNTER TEAM",
	"title.subtitle": "// THE OFFICE",
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
}
