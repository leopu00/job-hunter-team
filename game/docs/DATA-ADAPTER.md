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

Slug agente: `coordinatore · scout · analista · scorer · mentor · assistente`.

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
