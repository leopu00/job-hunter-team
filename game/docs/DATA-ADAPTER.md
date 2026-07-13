# Data adapter — contratto fra gioco e dati del team

Il gioco non conosce Supabase né la dashboard: parla solo con l'autoload
`TeamData` (`scripts/data/team_data.gd`), che espone la sorgente attiva.
La sorgente implementa il contratto `TeamDataSource`
(`scripts/data/team_data_source.gd`). Oggi l'unica implementazione è
`MockDataSource`: dati finti, nessuna chiamata di rete, nessuna API key.

## Contratto

| Metodo | Ritorno | Usato da |
|---|---|---|
| `get_team_summary()` | `{ positions_today: int, avg_score: int, budget_used_pct: float 0..1 }` | HUD |
| `get_positions_today()` | `[{ title, company, location, score, salary, note }]` | dialogo Scout, segnaposto `{positions}` |
| `get_agent_status()` | `{ <slug>: { status: String, detail: String } }` | status bubble degli agenti |
| `get_score_explanation()` | `{ title, company, score, reasons: [String] }` | dialogo Scorer |
| `get_mentor_tip()` | `String` | dialogo Mentor, segnaposto `{mentor_tip}` |
| `get_applications()` | `[{ title, company, score, stage: 0..3 }]` | registro TAB, sezione Candidature |
| `get_streak()` | `{ days: int, freezes: int }` | registro TAB, Statistiche |
| `get_agent_activity(slug)` | `[{ when, text }]` | scheda agente, pannello reparto, sezione Attività |
| `get_usage()` | `{ provider, actions_today, actions_week, quota_week_pct, tokens_today, budget_used_pct }` | pagina Utilizzo (Statistiche) |
| `get_notifications()` | `[{ when, level: info\|warn, text }]` | sezione Notifiche |
| `get_chat()` | `[{ when, from, text }]` | sezione Chat (sola lettura) |
| `get_settings()` | `{ <sezione>: [[etichetta, valore], …] }` | le 8 sezioni config (sola lettura) |

Slug agente: `coordinatore · scout · analista · scorer · scrittore · critico · mentor · assistente`.

## Agganciare il backend reale (futuro)

1. Nuova classe `SupabaseDataSource extends TeamDataSource` che riempie gli
   stessi metodi leggendo dalle API della dashboard / Supabase (vedi
   `web/` e `cli/src/lib/supabase-direct.js` per gli endpoint esistenti).
2. In `team_data.gd`: `var source: TeamDataSource = SupabaseDataSource.new()`
   (eventualmente scelto da una variabile d'ambiente / config).
3. Nessuna scena va toccata: HUD, bubble e dialoghi consumano già solo il
   contratto. I segnaposto dinamici nei dialoghi (`{mentor_tip}`,
   `{positions}`, `{score_*}`) sono risolti da
   `Dialogues.resolve_placeholders()` passando per `TeamData`.

Nota: i metodi oggi sono sincroni. Con un backend reale conviene
mantenerli sincroni su una cache aggiornata da un poller (pattern già
usato dalla dashboard), così il gioco non si blocca mai sul network.
