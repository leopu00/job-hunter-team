class_name UIStrings
## Tutte le stringhe UI del gioco, centralizzate. L'italiano (S, sotto)
## è la lingua di riferimento; le altre 6 lingue del web (en, hu, es,
## de, fr, pt) vivono in scripts/i18n/ui_<lang>.gd con le STESSE chiavi
## e fanno fallback sull'italiano se una chiave manca.

const LANGS := {
	"it": "Italiano", "en": "English", "hu": "Magyar", "es": "Español",
	"de": "Deutsch", "fr": "Français", "pt": "Português",
}
const LANG_CFG := "user://lang.cfg"

static var lang := "it"

static func _static_init() -> void:
	# TEST-AUTO: JHT_LANG forza la lingua per gli shot
	var forced := OS.get_environment("JHT_LANG")
	if LANGS.has(forced):
		lang = forced
		return
	var cfg := ConfigFile.new()
	if cfg.load(LANG_CFG) == OK:
		var saved := str(cfg.get_value("ui", "lang", "it"))
		if LANGS.has(saved):
			lang = saved

static func set_lang(l: String) -> void:
	if not LANGS.has(l):
		return
	lang = l
	var cfg := ConfigFile.new()
	cfg.set_value("ui", "lang", l)
	cfg.save(LANG_CFG)

static func t(key: String) -> String:
	if lang != "it":
		var d: Dictionary = _translations().get(lang, {})
		if d.has(key):
			return d[key]
	return S.get(key, key)

## I dizionari tradotti, caricati pigramente (i preload in const
## creerebbero un ciclo di parse se un file i18n mancasse in dev).
static var _tr_cache := {}

static func _translations() -> Dictionary:
	if _tr_cache.is_empty():
		for l in LANGS:
			if l == "it":
				continue
			var path := "res://scripts/i18n/ui_%s.gd" % l
			if ResourceLoader.exists(path):
				var script: GDScript = load(path)
				_tr_cache[l] = script.get_script_constant_map().get("S", {})
	return _tr_cache

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
	"chat.waiting": "in attesa della risposta",
	"chat.besteffort": "◐ questo agente legge i messaggi ma potrebbe non rispondere in chat",
	"chat.menu": "CHAT AGENTI",
	"chat.replies": "risponde in chat",
	"chat.maybe": "legge, risposta non garantita",
	"chat.expand": "SCHERMO INTERO",
	"chat.shrink": "RIDUCI",

	# ── Wizard onboarding (foto badge con l'Assistente) ───────────
	"wizard.title": "CONFIGURA IL TUO PROFILO",
	"wizard.subtitle": "Parla con l'Assistente: il badge a sinistra si compila da solo mentre vi confrontate. Carica il CV per fare prima.",
	"wizard.profile": "BADGE PROFILO",
	"wizard.progress": "%d/%d campi",
	"wizard.assistant": "ASSISTENTE",
	"wizard.chat_empty": "l'Assistente sta arrivando: intanto puoi scrivere tu o caricare il CV",
	"wizard.upload": "CARICA CV",
	"wizard.uploading": "carico %s…",
	"wizard.upload_fail": "upload fallito: %s",
	"wizard.attach_msg": "Ti ho caricato un documento: puoi estrarre da qui il mio profilo?",
	"wizard.connecting": "connessione al team…",
	"wizard.booting_assistant": "avvio dell'assistente in corso (può volerci un minuto)…",
	"wizard.sim_badge": "SIMULAZIONE — nessuna VPS collegata",
	"wizard.waiting_profile": "completa il badge con l'Assistente per entrare in ufficio",
	"wizard.ready_note": "badge completo: il team ti aspetta",
	"wizard.enter_office": "ENTRA IN UFFICIO →",
	"wizard.f.name": "Nome",
	"wizard.f.email": "Email",
	"wizard.f.target_role": "Ruolo target",
	"wizard.f.location": "Località",
	"wizard.f.experience_years": "Anni di esperienza",
	"wizard.f.seniority_target": "Seniority",
	"wizard.f.skills": "Competenze (≥2)",
	"wizard.f.languages": "Lingue (≥1)",

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
	"pos.open_url": "apri l'annuncio nel browser",
	"pos.open_yes": "annuncio APERTO all'ultima verifica",
	"pos.open_no": "annuncio NON PIÙ APERTO",

	# ── Candidature e Notifiche (dati reali) ──────────────────────
	"apps.ready": "CV pronto",
	"apps.applied": "inviata",
	"apps.response": "risposta ricevuta",
	"apps.empty_live": "nessuna candidatura ancora — i CV pronti compariranno qui",
	"notifs.ticket_resolved": "ticket risolto: %s",
	"notifs.ticket_assigned": "ticket in lavorazione: %s",
	"notifs.scored": "valutata dallo Scorer: %s",
	"notifs.cv_ready": "CV scritto: %s",
	"notifs.applied": "candidatura inviata: %s",
	"notifs.response": "risposta ricevuta: %s",
	"notifs.empty": "nessuna notifica recente dal team",
	"agents.comms": "COMUNICAZIONI NEL TEAM",
	"agents.no_comms": "nessuna comunicazione recente",
	"agents.chat_besteffort": "(risposta non garantita: protocollo chat non nel suo prompt)",

	# ── GlobalSearch (Cmd+K) ──────────────────────────────────────
	"search.placeholder": "cerca posizioni: titolo, azienda, città…  (ESC chiude)",
	"search.no_match": "nessuna posizione trovata",
	"search.need_vps": "collega la VPS per cercare tra le posizioni reali",

	# ── Profilo (editabile: paradigma desktop app) ────────────────
	"prof.name": "Nome",
	"prof.target_role": "Ruolo target",
	"prof.location": "Località",
	"prof.experience": "Anni di esperienza",
	"prof.seniority": "Seniority target",
	"prof.industry": "Settore",
	"prof.nationality": "Nazionalità",
	"prof.skills": "SKILL PRIMARIE (separate da virgola)",
	"prof.salary": "SALARY TARGET (min / max / valuta)",
	"prof.save": "▶ SALVA PROFILO",
	"prof.saving": "salvataggio sulla VPS…",
	"prof.saved": "✔ profilo salvato — il team lo userà dal prossimo giro",
	"prof.save_err": "✘ salvataggio fallito: %s",

	# ── Mappa OSM ─────────────────────────────────────────────────
	"map.hint": "trascina per muoverti · rotella/pinch per lo zoom · click su un pin per le sue posizioni · allontana per il globo",
	"map.globe_hint": "trascina per ruotare il mondo · click su un pin per atterrarci · avvicinati per la mappa",
	"map.filters": "FILTRI",
	"map.f_score": "SCORE",
	"map.f_city": "CITTÀ",
	"map.score_none": "senza punteggio",
	"map.overview": "PANORAMICA",
	"map.card_hint": "click su una posizione per aprire la scheda",

	# ── Orari di lavoro (editabili, con stima dinamica) ───────────
	"hours.intro": "Le finestre in cui il team lavora: modifica e salva, il pacing si adegua.",
	"hours.tz": "Timezone",
	"hours.windows": "FINESTRE (giorni · dalle → alle)",
	"hours.add": "+ AGGIUNGI FINESTRA",
	"hours.estimate": "≈ %.0f ore attive/settimana → stima ~%.1f posizioni nuove/giorno · budget riproporzionato al %d%% dell'attuale",
	"hours.invalid": "✘ finestra non valida: giorni mon…sun e orari HH:MM",
	"hours.save": "▶ SALVA ORARI",
	"hours.saved": "✔ orari salvati — il pacing del team si adegua dal prossimo tick",

	# ── Impostazioni → Lingua ─────────────────────────────────────
	"lang.intro": "Lingua dell'interfaccia — le 7 lingue del sito.",
	"lang.note": "// si applica subito ai pannelli; riapri quelli già aperti per vederli tradotti",

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

	# ── Comuni (liste troncate, note sola-lettura, attese dati) ───────
	"common.more": "… e altre %d",
	"common.readonly_desktop": "// sola lettura — si modifica dalla desktop app",
	"common.readonly_chat": "// sola lettura — si scrive dalla desktop app",
	"common.data_incoming": "// dati in arrivo dalla VPS…",
	"common.updated": "aggiornato: %s",

	# ── Badge simulazione / dati reali ────────────────────────────────
	"sim.live": "● DATI REALI — VPS",
	"sim.mock": "◐ SIMULAZIONE — dati non reali",

	# ── Ufficio (hint camera) ─────────────────────────────────────────
	"office.camera_hint": "trascina o WASD per la camera · zoom con rotella, pinch o +/- · click su agenti e reparti · TAB registro · ESC menu",

	# ── Sidebar: gruppi e voci (specchio della desktop app) ───────────
	"side.group_team": "Team",
	"side.group_work": "Lavoro",
	"side.group_settings": "Impostazioni",
	"side.team": "Team",
	"side.agents": "Agenti",
	"side.chat": "Chat",
	"side.notifs": "Notifiche",
	"side.dashboard": "Dashboard",
	"side.positions": "Posizioni",
	"side.stats": "Statistiche",
	"side.apps": "Candidature",
	"side.map": "Mappa",
	"side.activity": "Attività",
	"side.vps": "Collega VPS",
	"side.profile": "Profilo",
	"side.hours": "Orari",
	"side.provider": "Provider",
	"side.docker": "Docker",
	"side.account": "Account",
	"side.email": "Email",
	"side.language": "Lingua",
	"side.advanced": "Avanzate",

	# ── Sezioni non ancora migrate / config sola lettura ──────────────
	"section.migrating": "// sezione in migrazione dalla desktop app",
	"section.migrating_body": "I contenuti di «%s» verranno portati qui, un pezzo alla volta.",
	"config.incoming": "// config in arrivo dalla VPS…",
	"config.not_exposed": "// sezione non ancora esposta dal team",

	# ── Sezione Agenti (lista + pagina del singolo agente) ────────────
	"agents.back": "◀ AGENTI",
	"agents.not_active": "non attivo ora",
	"agents.consumption": "CONSUMO (ULTIME %s ORE)",
	"agents.registry_actions": "AZIONI NEL REGISTRO",
	"agents.no_transitions": "nessuna transizione recente a suo nome",
	"agents.active_count": "%d agenti ATTIVI sulla VPS in questo momento",
	"agents.status_default": "operativo",

	# ── Sezione Team ──────────────────────────────────────────────────
	"team.desks": "%d/%d postazioni",
	"team.core": "Core: Il Coordinatore · Il Mentor · L'Assistente",

	# ── Titoli KPI (dashboard, statistiche, utilizzo) ─────────────────
	"kpi.positions_today": "POSIZIONI OGGI",
	"kpi.avg_score": "SCORE MEDIO",
	"kpi.positions_total": "POSIZIONI TOTALI",
	"kpi.positions_list": "POSIZIONI DI OGGI",
	"kpi.budget_used": "BUDGET USATO",
	"kpi.streak": "STREAK",
	"kpi.streak_value": "%d giorni · %d freeze",
	"kpi.apps_by_stage": "CANDIDATURE PER STADIO",
	"kpi.provider": "PROVIDER",
	"kpi.actions_today": "AZIONI OGGI",
	"kpi.actions_week": "AZIONI SETTIMANA",
	"kpi.tokens_today": "TOKEN OGGI",
	"kpi.quota_week": "QUOTA SETTIMANALE",

	# ── Pagina Utilizzo ───────────────────────────────────────────────
	"usage.open": "▶ UTILIZZO",
	"usage.title": "UTILIZZO",
	"usage.title_window": "UTILIZZO — ULTIME %s ORE",
	"usage.none": "nessun consumo registrato nella finestra",
	"usage.back": "◀ STATISTICHE",

	# ── Mappa ─────────────────────────────────────────────────────────
	"map.no_coords": "SENZA COORDINATE (%d)",
	"map.none_today": "nessuna posizione geolocalizzata oggi",
}
