class_name TeamDataSource
extends RefCounted
## Contratto unico fra il gioco e i dati del team (vedi docs/DATA-ADAPTER.md).
## Il gioco parla SOLO con questa interfaccia: oggi la implementa
## MockDataSource, domani un adapter Supabase/dashboard senza toccare le scene.

## Riepilogo per l'HUD: { positions_today: int, avg_score: int, budget_used_pct: float }
func get_team_summary() -> Dictionary:
	push_error("TeamDataSource è astratta: usa un'implementazione")
	return {}

## Posizioni trovate oggi: [{ title, company, location, score, salary, note }]
func get_positions_today() -> Array:
	return []

## Stato per agente: { <slug>: { status: String, detail: String } }
## slug ∈ coordinatore|scout|analista|scorer|mentor|assistente
func get_agent_status() -> Dictionary:
	return {}

## Spiegazione mock di uno score (per il dialogo dello Scorer):
## { title, company, score, reasons: [String] }
func get_score_explanation() -> Dictionary:
	return {}

## Consiglio di carriera del giorno (per il Mentor): String
func get_mentor_tip() -> String:
	return ""

## Candidature come quest a stadi (registro):
## [{ title, company, score, stage: 0 inviata|1 screening|2 colloquio|3 offerta }]
func get_applications() -> Array:
	return []

## Streak quotidiana con freeze alla Duolingo: { days: int, freezes: int }
func get_streak() -> Dictionary:
	return {}

## Ultime attività di un agente (per la scheda "chi è / cosa ha fatto"):
## [{ when: String, text: String }] — la più recente per prima.
func get_agent_activity(_slug: String) -> Array:
	return []

## Utilizzo del team (pagina usage): { provider, actions_today, actions_week,
## quota_week_pct: float 0..1, tokens_today, budget_used_pct: float 0..1 }
func get_usage() -> Dictionary:
	return {}

## Notifiche recenti: [{ when, level: info|warn, text }] — recente prima.
func get_notifications() -> Array:
	return []

## Chat di team recente: [{ when, from, text }] — recente per ultima.
func get_chat() -> Array:
	return []

## Impostazioni (sezioni config della sidebar, SOLA LETTURA in gioco:
## si modificano dalla desktop app). Chiave = id sezione (profile, hours,
## provider, docker, account, email, language, advanced), valore = Array
## di coppie [etichetta, valore] nell'ordine di visualizzazione.
func get_settings() -> Dictionary:
	return {}
