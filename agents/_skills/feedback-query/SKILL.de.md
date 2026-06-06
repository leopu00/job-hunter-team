<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Nutzer-Feedback (like/dislike/hide/star) für eine gegebene Position aus der Cloud lesen. Vom Scorer verwendet, um einen Multiplikator auf den Endscore anzuwenden, und vom Scout als kontextuelles Signal. Gibt einen neutralen "kein Signal"-Payload zurück, wenn die Cloud deaktiviert oder nicht erreichbar ist, damit Aufrufer niemals hart fehlschlagen.
allowed-tools: Bash(python3 *)
---

# feedback-query — Nutzer-Feedback pro Position

Der Nutzer kann auf dem Web-Dashboard like/dislike/hide/star auf jede Position klicken. Diese Klicks werden in Supabase `position_feedback` gespeichert (Mig 019 Basis + Mig 028 erweitert) und über diesen Skill an Agenten weitergegeben. Schema:

| Spalte              | Typ     | Bedeutung |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | Die `legacy_id` (String) der Position in `positions` |
| `action`            | TEXT    | Eines von `like`, `dislike`, `hide`, `star` |
| `reason`            | TEXT    | Optionaler kurzer Grund (≤500 Zeichen) |
| `comment`           | TEXT    | Optionaler ausführlicher Kommentar (≤2000 Zeichen, Mig 028) |
| `score`             | INTEGER | Optionaler granularer Score 1-5 (Mig 028) |
| `direction`         | TEXT    | Optionales `more_like_this` / `less_like_this` — Mustersignal für den Scout, NICHT Pro-Position-Skip (Mig 028) |
| `created_at`        | TS      | Zeitpunkt der Einreichung |

Der Skill ruft `GET /api/positions/{legacy_id}/feedback` in der Cloud auf (mit dem Bearer-Token in `$JHT_HOME/cloud.json`). Bei Cloud-deaktiviert oder Netzwerkfehler gibt der Skill **keinen Fehler** — er gibt `ok=true, latest_action=null` mit einem `note`-Feld zurück. Agenten müssen weitermachen.

## Einzelne Position nachschlagen

```bash
python3 /app/shared/skills/feedback_query.py check <legacy_id>
```

Ausgabe (JSON auf stdout):

```json
{
  "ok": true,
  "legacy_id": "42",
  "latest_action": "dislike",
  "latest_direction": "less_like_this",
  "count": 2,
  "actions": [
    {"action": "dislike", "created_at": "2026-05-30T14:21:00Z",
     "reason": "too senior", "comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "score": null, "direction": null}
  ]
}
```

`latest_action` ist der neueste Klick. `latest_direction` ist der neueste NICHT-NULL-Wert von `direction` in der Historie (irgendwo in actions[], nicht notwendig die neueste Aktion). `actions[]` ist absteigend nach `created_at` sortiert. Leer wenn kein Feedback existiert:

```json
{"ok": true, "legacy_id": "99", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": []}
```

Wenn die Cloud deaktiviert oder der Endpunkt nicht erreichbar ist, gibt der Skill zurück:

```json
{"ok": true, "legacy_id": "...", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": [],
 "note": "no-signal (cloud-disabled)"}
```

## Wie Agenten es verwenden

**Scorer** (verpflichtend beim Scoring):
1. Nach der Berechnung des Basis-Scores (Summe gewichteter Komponenten), `feedback_query check <legacy_id>` aufrufen.
2. Multiplikator basierend auf `latest_action` anwenden:
   - `like` → final_score = round(base * 1.10), Notiz `feedback:like+10%` hinzufügen
   - `star` → final_score = round(base * 1.15), Notiz `feedback:star+15%` hinzufügen
   - `dislike` → final_score = round(base * 0.85), Notiz `feedback:dislike-15%` hinzufügen
   - `hide` → status=`excluded`, Notiz `feedback:hide`, Score-Schreiben überspringen
   - `null` → keine Änderung
3. Endscore nach Multiplikator auf 100 begrenzen.

**Scout** (optionales kontextuelles Signal):
- Nicht für Pro-Position-Skip — das wird bereits durch Dedup (SC-05) behandelt.
- Sparsam verwenden beim Neubewerten einer bekannten Position (z.B. Promotions-Logik): wenn der Nutzer sie explizit disliked hat, nicht erneut anzeigen, selbst wenn Dedup normalerweise neu bewerten würde.
- **Mustersignal via `direction`** (Mig 028): wenn `latest_direction='less_like_this'` bei einer Position, bittet der Nutzer um weniger Positionen WIE diese (gleiche Firma / role_family / Standort). Diese Quelle/dieses Muster in nachfolgenden Suchen deprioritisieren. Bei `latest_direction='more_like_this'`, das Replizieren des Musters priorisieren. Dies ist ein kontextueller Hinweis, keine harte Regel — mit dem breiteren Bild kombinieren (z.B. ein einzelnes `less_like_this` auf einer kleinen Nische kann Rauschen sein; drei auf derselben Firma sind es nicht).

## Hinweise

- Der Skill ist **nur lesend**. Schreiboperationen passieren nur vom Browser via POST `/api/positions/{legacy_id}/feedback`.
- Das Bearer-Token kommt aus `cloud.json`; keine separate Umgebungsvariable nötig.
- 10s Timeout pro Aufruf. Bei Batch-Verarbeitung vieler Positionen, ~50-200ms pro Aufruf erwarten. Für Massenläufe, im Loop mit Throttle-Pausen wie üblich einbatchen.
