# 📋 Bacheca del team — direttive permanenti dell'utente (2026-07-11)

**Stato:** fondamenta su dev4 (tabella + skill). Incrementi successivi elencati sotto.

## Il problema
Gli ordini "di strategia" dell'utente (es. *"modalità mantenimento: stop scouting,
CV solo 90+"*) sono **decisioni del coordinatore che devono restare valide finché
l'utente non le cambia**. Oggi non c'è un posto durevole per tenerli:
- un **messaggio in chat** al Capitano sparisce al context-refresh (il Capitano è
  riavviato spesso, C-21);
- il **captain-diary** è per-giorno e serve alle lezioni di pacing, non a una policy
  permanente.

Osservato dal vivo su P03 (2026-07-11): dato l'ordine "modalità mantenimento",
al primo refresh il Capitano lo avrebbe perso. Tampone: scritto nel captain-diary.
Soluzione vera: la **bacheca**.

## Fondamenta consegnate (questo commit)
1. **Tabella `team_directives`** in `shared/skills/_db.py` (jobs.db, idempotente):
   `body`, `kind` (order|strategy|formation|note), `status` (active|archived),
   `sort_order`, `created_by` (user|capitano|assistente), `cloud_id` (round-trip
   Supabase futuro, come `position_tickets`), timestamp.
2. **Skill `shared/skills/team_directives.py`**: `active` (handoff), `add`, `edit`,
   `archive`, `show`, `list [--all]`. Single-writer del team; testata end-to-end.

## Roadmap (i "poi procedere")
1. **Integrazione Capitano/Assistente (prompt)** — il Capitano legge
   `team_directives.py active` all'handoff (C-21), accanto al captain-diary; da
   toccare in `agents/capitano/capitano*.md` (7 lingue) → gated a release.
2. **Mirror Supabase + sync** — migrazione Supabase `team_directives` (RLS per
   user_id) + rotta di push/pull come i ticket (`cloud_id`), così è **editabile
   dalla dashboard web** e non solo da chat.
3. **Formazioni/strategie** (`kind='formation'`) — set predefiniti selezionabili
   dall'utente: `MANTENIMENTO` (stop scout, CV 90+, scarto scadute a rotazione),
   `CACCIA` (scouting aggressivo), `MISTA`. Il Capitano propone le opzioni ai bivi.
4. **Metrica "nuova / già vista"** — campo `viewed_at`/`opened_by_user` su
   `positions`, badge in dashboard, evento di view sull'apertura di `/positions/[id]`.
   Dà al Capitano il segnale per la strategia su misura.
5. **Gate freschezza prima del CV** — codificare nel pipeline-triage: prima di
   spawnare lo Scrittore per una 90+, l'Analista verifica che l'offerta sia ancora
   valida (recente → salta; vecchia → rianalizza). Niente token su annunci morti.

## Note
- La bacheca è per-team (per-VPS/utente), come il resto di jobs.db.
- L'Assistente (user-facing) è il proprietario naturale dell'interazione bacheca:
  mostra le direttive attive, presenta le opzioni di formazione, conferma le
  modifiche.
