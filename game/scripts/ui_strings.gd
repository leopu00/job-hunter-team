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
	"hud.interact": "[E] Parla con %s",
	"hud.dialogue_next": "[INVIO] continua",
	"hud.dialogue_skip": "[ESC] chiudi",

	# ── Wizard ────────────────────────────────────────────────────
	"wizard.title": "CONFIGURAZIONE INIZIALE",
	"wizard.step_avatar": "AVATAR",
	"wizard.step_cv": "CURRICULUM",
	"wizard.step_team": "NOME TEAM",
	"wizard.avatar_base": "CORPORATURA",
	"wizard.avatar_hair": "CAPELLI",
	"wizard.avatar_hair_color": "COLORE CAPELLI",
	"wizard.avatar_outfit": "ABITO",
	"wizard.cv_pick": "SCEGLI FILE…",
	"wizard.cv_none": "nessun file selezionato",
	"wizard.team_placeholder": "es. Team Falco",
	"wizard.next": "AVANTI ▶",
	"wizard.back": "◀ INDIETRO",
	"wizard.done": "ENTRA NELL'UFFICIO ▶",
}
