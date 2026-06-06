<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Legge il feedback dell'utente (like/dislike/hide/star) per una data posizione dal cloud. Usato dallo Scorer per applicare un moltiplicatore sul punteggio finale e dallo Scout come segnale contestuale. Restituisce un payload neutrale "no signal" quando il cloud è disabilitato o irraggiungibile, così i chiamanti non falliscono mai con errore hard.
allowed-tools: Bash(python3 *)
---

# feedback-query — Feedback utente per posizione

L'utente può cliccare like/dislike/hide/star su qualsiasi posizione dalla dashboard web. Quei click sono memorizzati in Supabase `position_feedback` (mig 019 base + mig 028 estesa) e mostrati agli agenti tramite questa skill. Schema:

| Colonna             | Tipo    | Significato |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | Il `legacy_id` (stringa) della posizione in `positions` |
| `action`            | TEXT    | Uno tra `like`, `dislike`, `hide`, `star` |
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
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "score": null, "direction": null}
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
 "note": "no-signal (cloud-disabled)"}
```

## Come lo usano gli agenti

**Scorer** (obbligatorio al momento dello scoring):
1. Dopo aver calcolato il punteggio base (somma delle componenti pesate), chiama `feedback_query check <legacy_id>`.
2. Applica il moltiplicatore basato su `latest_action`:
   - `like` → final_score = round(base * 1.10), aggiungi nota `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), aggiungi nota `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), aggiungi nota `feedback:dislike-15%`
   - `hide` → status=`excluded`, nota `feedback:hide`, salta la scrittura del punteggio
   - `null` → nessuna modifica
3. Cap del punteggio finale a 100 dopo il moltiplicatore.

**Scout** (segnale contestuale opzionale):
- Non per skip per-posizione — quello è già gestito dal dedup (SC-05).
- Usalo con parsimonia quando ri-valuti una posizione nota (es. logica di promozione): se l'utente l'ha esplicitamente dislikata, non ripresentarla anche se il dedup normalmente la ri-scorerebbe.
- **Segnale pattern via `direction`** (mig 028): quando `latest_direction='less_like_this'` su una posizione, l'utente chiede meno posizioni COME quella (stessa azienda / role_family / location). Deprioritizza quella fonte/pattern nelle ricerche successive. Quando `latest_direction='more_like_this'`, prioritizza la replica del pattern. Questo è un hint contestuale, non una regola rigida — combinalo col quadro più ampio (es. un singolo `less_like_this` su una nicchia piccola può essere rumore; tre sulla stessa azienda no).

## Note

- La skill è **read-only**. Le scritture avvengono solo dal browser via POST `/api/positions/{legacy_id}/feedback`.
- Il bearer token viene da `cloud.json`; nessuna variabile env separata necessaria.
- Timeout 10s per chiamata. Se processi molte posizioni in batch, aspettati ~50–200ms per chiamata. Per i run in bulk, includi nel loop con pause di throttle come al solito.
