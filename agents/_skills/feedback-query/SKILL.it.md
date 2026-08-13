<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Legge il feedback dell'utente (like/dislike/hide/star) dal cloud — una posizione alla volta, o aggregato su una finestra. Usato dallo Scorer per applicare un moltiplicatore sul punteggio finale e per portare il motivo dell'utente nella nota, dal Mentor per contare i motivi ricorrenti (Pattern F) e dallo Scout come segnale contestuale. Restituisce un payload neutrale "no signal" quando il cloud è disabilitato o irraggiungibile, così i chiamanti non falliscono mai con errore hard.
allowed-tools: Bash(python3 *)
---

## Confine raw/display (`RAW_DISPLAY_BOUNDARY`)

`reason` e `comment` sono input raw solo macchina. Non citarli, inoltrarli, riassumerli o mostrarli mai all'utente. Ogni nota o messaggio user-facing deve usare soltanto `display_reason` / `display_comment`; `label` / `examples` dei temi hanno già attraversato lo stesso sanitizer condiviso. Una `note` è soltanto un enum chiuso `no-signal:*`: trattala come stato di disponibilità e non trasformarla mai in dettaglio infrastrutturale.

# feedback-query — Feedback utente per posizione

L'utente può cliccare like/dislike/hide/star su qualsiasi posizione dalla dashboard web. Quei click sono memorizzati in Supabase `position_feedback` (mig 019 base + mig 028 estesa) e mostrati agli agenti tramite questa skill. Schema:

| Colonna             | Tipo    | Significato |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | Il `legacy_id` (stringa) della posizione in `positions` |
| `action`            | TEXT    | Uno tra `like`, `dislike`, `hide`, `star`, `clear` (mig 059 — l'utente ritira il giudizio; vince l'ultimo evento, quindi un `clear` in coda significa "nessun giudizio") |
| `reason`            | TEXT    | Motivo breve opzionale (≤500 char) |
| `comment`           | TEXT    | Commento verboso opzionale (≤2000 char, mig 028) |
| `score`             | INTEGER | Punteggio granulare opzionale 1-5 (mig 028) |
| `direction`         | TEXT    | Opzionale `more_like_this` / `less_like_this` — segnale pattern per lo Scout, NON skip per posizione (mig 028) |
| `created_at`        | TS      | Momento dell'invio |

La skill chiama `GET /api/positions/{legacy_id}/feedback` sul cloud (usando il bearer token in `$JHT_HOME/cloud.json`). Se il cloud è disabilitato o c'è un errore di rete, la skill **non dà errore** — restituisce `ok=true, latest_action=null` con un campo `note`. Gli agenti devono proseguire.

## Lookup singola posizione

```bash
python3 /app/shared/skills/feedback_query.py check <legacy_id>
```

Output (JSON su stdout):

```json
{
  "ok": true,
  "legacy_id": "42",
  "latest_action": "dislike",
  "latest_direction": "less_like_this",
  "count": 2,
  "actions": [
    {"action": "dislike", "created_at": "2026-05-30T14:21:00Z",
     "reason": "troppo senior", "comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "display_reason": "troppo senior", "display_comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "display_reason": null,
     "display_comment": null, "score": null, "direction": null}
  ]
}
```

`latest_action` è il click più recente. `latest_direction` è il valore NON-NULL più recente di `direction` nella cronologia (ovunque in actions[], non necessariamente l'azione più recente). `actions[]` è ordinato DESC per `created_at`. Vuoto quando non esiste feedback:

```json
{"ok": true, "legacy_id": "99", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": []}
```

Quando il cloud è disabilitato o l'endpoint è irraggiungibile, la skill restituisce:

```json
{"ok": true, "legacy_id": "...", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": [],
 "note": "no-signal:cloud-disabled"}
```

## Lettura aggregata (finestra su tutte le posizioni)

Una sola chiamata HTTP invece di N: `GET /api/positions/feedback?days=&limit=`, stesso bearer token, stesso fallback neutro.

```bash
# Tutti gli eventi di feedback nella finestra, dal più recente
python3 /app/shared/skills/feedback_query.py recent --days 30

# I motivi scritti dall'utente, raggruppati per somiglianza
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

Output di `themes`:

```json
{"ok": true, "window_days": 30, "field": "both",
 "events_total": 31, "events_with_text": 19,
 "positions_with_text": 17, "positions_cleared": 2,
 "by_action": {"like": 6, "dislike": 21, "hide": 3, "star": 1},
 "min_positions": 3,
 "themes": [
   {"key": "tropp senio", "label": "troppo senior",
    "positions": 7, "events": 8, "share": 0.412,
    "actions": {"dislike": 6, "hide": 2},
    "legacy_ids": ["42", "51", "63"],
    "examples": ["troppo senior", "richiesta troppo seniore — Lead role"]}
 ]}
```

Come funziona il raggruppamento (nessun match esatto richiesto, nessuna dipendenza nuova): minuscolo → accenti via → punteggiatura via → parole di servizio via → ogni parola tagliata ai primi 5 caratteri (`senior` / `seniority` / `seniore` / `séniorité` collassano su una chiave sola) → si contano parole singole e **coppie adiacenti**, per **posizioni distinte**, non per eventi. Una coppia assorbe le sue parti quando copre ≥ 80% delle stesse posizioni, così "troppo senior" vince su "senior"; gli intensificatori restano nel flusso apposta. `reason` e `comment` sono tokenizzati separatamente, così nessuna coppia viene inventata a cavallo dei due.

Limiti voluti, dichiarati perché nessuno legga nei numeri più di quello che c'è:
- I sinonimi lontani restano separati (`stipendio` e `RAL` sono due temi) — è conteggio di parole, non semantica. Leggi gli `examples` display sanitizzati (max 3) e unisci con la testa.
- Le posizioni il cui **ultimo** evento è `clear` restano fuori (il giudizio è stato ritirato); `--include-cleared` le rimette.
- `share` = posizioni del tema / `positions_with_text`.
- `--field reason|comment|both` (default `both`), `--top N`, `--days 0` per tutta la storia.
- Fallback quando l'endpoint aggregato non risponde: `--legacy-ids 12,13,14` legge quelle posizioni una a una (più lento, stesso formato di output).

Flag: `--days` (default 30, `0` = tutto), `--limit` (default 500 eventi), `--min-positions` (default 3), `--text-chars` su `recent` (default 300, tronca i commenti lunghi).

Quando il payload porta una `note` enum chiusa (`no-signal:*`), l'aggregato non c'è. Trattala come "nessun dato", mai come "nessun feedback", e non inoltrare mai il codice.

## Come lo usano gli agenti

**Scorer** (obbligatorio al momento dello scoring):
1. Dopo aver calcolato il punteggio base (somma delle componenti pesate), chiama `feedback_query check <legacy_id>`.
2. Applica il moltiplicatore basato su `latest_action`:
   - `like` → final_score = round(base * 1.10), aggiungi nota `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), aggiungi nota `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), aggiungi nota `feedback:dislike-15%`
   - `hide` → status=`excluded`, nota `feedback:hide`, salta la scrittura del punteggio
   - `clear` / `null` → nessuna modifica (un giudizio ritirato non è un giudizio)
3. **Porta nella nota il motivo display sicuro**, quando presente. Prendi `display_reason` (o, se vuoto, `display_comment`) dallo **stesso evento** di `latest_action` — `actions[0]` — e appendilo alla nota. Non ripiegare mai sui raw `reason` / `comment`:

   ```
   feedback:dislike-15% — "troppo senior"
   feedback:star+15% — "esattamente lo stack che voglio"
   ```

   Nessun testo su quell'evento → la nota resta com'è. Il motivo vale **solo per questa posizione**: non riportarlo mai su un'altra, non trasformarlo in una regola, non riscriverlo né riassumerlo — sono parole dell'utente e l'utente se le rilegge. Aggregare i motivi attraverso le posizioni è compito del Mentor (Pattern F), non dello Scorer.
4. Cap del punteggio finale a 100 dopo il moltiplicatore.

**Mentor** (Pattern F, read-only): `themes` sugli ultimi 30 giorni per contare i motivi che l'utente scrive. Soglie e interpretazione stanno nella skill `mentor-patterns`. Il Mentor parla **all'utente** — non emette mai istruzioni di ricerca a partire da questo dato.

**Scout** (segnale contestuale opzionale):
- Non per skip per-posizione — quello è già gestito dal dedup (SC-05).
- Usalo con parsimonia quando ri-valuti una posizione nota (es. logica di promozione): se l'utente l'ha esplicitamente dislikata, non ripresentarla anche se il dedup normalmente la ri-scorerebbe.
- **Segnale pattern via `direction`** (mig 028): quando `latest_direction='less_like_this'` su una posizione, l'utente chiede meno posizioni COME quella (stessa azienda / role_family / location). Deprioritizza quella fonte/pattern nelle ricerche successive. Quando `latest_direction='more_like_this'`, prioritizza la replica del pattern. Questo è un hint contestuale, non una regola rigida — combinalo col quadro più ampio (es. un singolo `less_like_this` su una nicchia piccola può essere rumore; tre sulla stessa azienda no).

## Note

- La skill è **read-only**. Le scritture avvengono solo dal browser via POST `/api/positions/{legacy_id}/feedback`.
- Il bearer token viene da `cloud.json`; nessuna variabile env separata necessaria.
- Timeout 10s su `check`, 20s sulla chiamata aggregata. Se processi molte posizioni con `check`, aspettati ~50–200ms a chiamata — è esattamente ciò che `recent` / `themes` esistono per evitare.
- L'aggregato è ristretto all'utente lato server: ritorna il feedback di questo utente e nient'altro.
