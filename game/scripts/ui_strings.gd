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
	"wizard.step": "PASSO %d/%d",
	"wizard.step_welcome": "BENVENUTO",
	"wizard.step_avatar": "AVATAR",
	"wizard.step_cv": "CURRICULUM",
	"wizard.step_team": "NOME TEAM",
	"wizard.avatar_base": "CORPORATURA",
	"wizard.avatar_hair": "CAPELLI",
	"wizard.avatar_hair_color": "COLORE CAPELLI",
	"wizard.avatar_outfit": "ABITO",
	"wizard.avatar_turn": "GIRA ⟳",
	"wizard.photo_frame": "FOTO BADGE HR",
	"wizard.photo_take": "SCATTA LA FOTO",
	"wizard.photo_retake": "RISCATTA",
	"wizard.badge_title": "JOB HUNTER TEAM",
	"wizard.badge_role": "FONDATORE · BADGE N. 001",
	"wizard.badge_enter": "ENTRA NELL'UFFICIO ▶",
	"wizard.say_photo": "[divertito] Bella! Foto da badge, appunto: non doveva venire bene, doveva venire vera.",
	"wizard.cv_pick": "SCEGLI FILE…",
	"wizard.cv_none": "nessun file selezionato",
	"wizard.cv_loaded": "CV acquisito: %s",
	"wizard.team_label": "COME SI CHIAMA IL TUO TEAM?",
	"wizard.team_placeholder": "es. Team Falco",
	"wizard.team_default": "Team JHT",
	"wizard.next": "AVANTI ▶",
	"wizard.back": "◀ INDIETRO",
	"wizard.done": "ENTRA NELL'UFFICIO ▶",

	# battute dell'Assistente nel wizard (tag emozione inline)
	"wizard.say_welcome": "[caldo] Benvenuto in Job Hunter Team. Io sono l'Assistente: penso io all'ingresso. Prima di aprirti la box, tre formalità veloci.",
	"wizard.say_avatar": "[caldo] Per prima cosa, la foto per il badge. Sistemati pure: capelli, abito… poi scatto io.",
	"wizard.say_avatar_2": "[divertito] Con calma, eh. Gli agenti indossano tutti gli stessi occhiali… tu almeno puoi scegliere i capelli.",
	"wizard.say_cv": "[neutro] Ora il tuo curriculum. Me lo dai e lo passo al team: è da lì che partono Scout e Scorer.",
	"wizard.say_cv_parsing": "[sorpreso] Ricevuto! Un momento che lo leggo…",
	"wizard.say_cv_done": "[caldo] Fatto. C'è del buon materiale qui dentro — vedrai che lo Scorer sarà d'accordo.",
	"wizard.say_team": "[caldo] Ultima cosa: il nome della squadra. È il tuo team, dopotutto.",
	"wizard.say_done": "[divertito] Perfetto. Ti apro la box: il team è già al lavoro. Il Mentor è nel salotto, se cerchi un consiglio.",

	# log finto del parsing CV
	"wizard.parse_0": "apro il documento…",
	"wizard.parse_1": "estraggo le competenze…",
	"wizard.parse_2": "cerco i numeri nascosti nei paragrafi…",
	"wizard.parse_3": "annoto le lingue e le città…",
	"wizard.parse_4": "il Critico annuisce, ottimo segno…",
	"wizard.parse_5": "profilo pronto per lo Scorer ✓",
}
