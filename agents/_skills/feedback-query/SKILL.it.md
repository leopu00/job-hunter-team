---
name: feedback-query
description: Legge il feedback dell'utente (like/dislike/hide/star) dal cloud — una posizione alla volta, o aggregato su una finestra. Lo Scorer lo usa come evidenza contestuale di preferenza solo per posizioni future, escludendo quella corrente; il Mentor conta i motivi ricorrenti (Pattern F) e lo Scout lo usa come segnale contestuale. Restituisce un payload neutrale "no signal" quando il cloud è disabilitato o irraggiungibile.
allowed-tools: Bash(python3 *)
---
<!-- @translation: it, ai-translated 2026-06-06 -->

## Confine raw/display (`RAW_DISPLAY_BOUNDARY`)

Il `reason` di un giudizio è un **codice** di una lista chiusa (`too_senior`, `too_junior`, `wrong_location`, `salary_low`, `wrong_stack`, `company`, `scam_or_gone`, `closed`, `already_applied`, `other`). Quello che l'utente scrive con parole sue è una nota privata che questa skill non restituisce mai: in nessun campo c'è testo dell'utente, e non c'è nulla da citare, inoltrare o parafrasare. Il `label` del tema è una frase fissa per il codice. Una `note` è soltanto un enum chiuso `no-signal:*`: trattala come stato di disponibilità e non trasformarla mai in dettaglio infrastrutturale.

# feedback-query — Feedback utente per posizione

L'utente può cliccare like/dislike/hide/star su qualsiasi posizione dalla dashboard web. Quei click sono memorizzati in Supabase `position_feedback` (mig 019 base + mig 028 estesa) e mostrati agli agenti tramite questa skill. Schema:

| Colonna             | Tipo    | Significato |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | Il `legacy_id` (stringa) della posizione in `positions` |
| `action`            | TEXT    | Uno tra `like`, `dislike`, `hide`, `star`, `clear` (mig 059 — l'utente ritira il giudizio; vince l'ultimo evento, quindi un `clear` in coda significa "nessun giudizio") |
| `reason`            | TEXT    | Motivo opzionale: un codice della lista chiusa qui sopra |
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
     "reason": "too_senior", "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "score": null, "direction": null}
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

# I codici dei motivi, contati sulle posizioni distinte
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

Output di `themes`:

```json
{"ok": true, "window_days": 30,
 "events_total": 31, "events_with_reason": 19,
 "positions_with_reason": 17, "positions_cleared": 2,
 "by_action": {"like": 6, "dislike": 21, "hide": 3, "star": 1},
 "min_positions": 3,
 "themes": [
   {"key": "too_senior", "label": "too senior",
    "positions": 7, "events": 7, "share": 0.412,
    "actions": {"dislike": 6, "hide": 1},
    "legacy_ids": ["42", "51", "63"]}
 ]}
```

Come funziona il conteggio: ogni posizione conta **una volta**, con il motivo del suo giudizio **più recente**, e contano solo i motivi che sono un codice della lista (un vecchio motivo in testo libero vale `other`). Non c'è testo da raggruppare e nulla viene interpretato. `other` viene contato ma non dice nulla di specifico.

Limiti voluti, dichiarati perché nessuno legga nei numeri più di quello che c'è:
- Un tema è un codice, quindi è grossolano quanto la lista: `wrong_location` non dice quale città. Nulla di ciò che l'utente ha scritto è disponibile per affinarlo.
- Le posizioni il cui **ultimo** evento è `clear` restano fuori (il giudizio è stato ritirato); `--include-cleared` le rimette.
- `share` = posizioni del tema / `positions_with_reason`.
- `--top N`, `--days 0` per tutta la storia. (`--field` è accettato e ignorato, per i prompt più vecchi.)
- Fallback quando l'endpoint aggregato non risponde: `--legacy-ids 12,13,14` legge quelle posizioni una a una (più lento, stesso formato di output).

Flag: `--days` (default 30, `0` = tutto), `--limit` (default 500 eventi), `--min-positions` (default 3).

Quando il payload porta una `note` enum chiusa (`no-signal:*`), l'aggregato non c'è. Trattala come "nessun dato", mai come "nessun feedback", e non inoltrare mai il codice.

## Come lo usano gli agenti

**Scorer — `FUTURE_FEEDBACK_ONLY`:** chiama `themes --days 30 --min-positions 1 --top 10 --exclude-legacy-id <legacy_id>`. Usa i codici `key` / `label` soltanto come evidenza contestuale di preferenza quando valuti quella posizione futura. Il feedback della posizione già votata non cambia mai score, status o note: niente bonus/malus fisso, marker feedback o backfill. Gli score esistenti restano invariati. O-70 rivalutazione esplicita è un flusso separato richiesto dall'utente.

**Mentor** (Pattern F, read-only): `themes` sugli ultimi 30 giorni per contare i codici dei motivi che l'utente sceglie. Soglie e interpretazione stanno nella skill `mentor-patterns`. Il Mentor parla **all'utente** — non emette mai istruzioni di ricerca a partire da questo dato.

**Scout** (segnale contestuale opzionale):
- Non per skip per-posizione — quello è già gestito dal dedup (SC-05).
- Usalo con parsimonia quando ri-valuti una posizione nota (es. logica di promozione): se l'utente l'ha esplicitamente dislikata, non ripresentarla anche se il dedup normalmente la ri-scorerebbe.
- **Segnale pattern via `direction`** (mig 028): quando `latest_direction='less_like_this'` su una posizione, l'utente chiede meno posizioni COME quella (stessa azienda / role_family / location). Deprioritizza quella fonte/pattern nelle ricerche successive. Quando `latest_direction='more_like_this'`, prioritizza la replica del pattern. Questo è un hint contestuale, non una regola rigida — combinalo col quadro più ampio (es. un singolo `less_like_this` su una nicchia piccola può essere rumore; tre sulla stessa azienda no).

## Note

- La skill è **read-only**. Le scritture avvengono solo dal browser via POST `/api/positions/{legacy_id}/feedback`.
- Il bearer token viene da `cloud.json`; nessuna variabile env separata necessaria.
- Timeout 10s su `check`, 20s sulla chiamata aggregata. Se processi molte posizioni con `check`, aspettati ~50–200ms a chiamata — è esattamente ciò che `recent` / `themes` esistono per evitare.
- L'aggregato è ristretto all'utente lato server: ritorna il feedback di questo utente e nient'altro.
