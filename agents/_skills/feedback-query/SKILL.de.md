<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Nutzer-Feedback (like/dislike/hide/star) aus der Cloud lesen — eine Position auf einmal, oder aggregiert über ein Zeitfenster. Vom Scorer verwendet, um einen Multiplikator auf den Endscore anzuwenden und den Grund des Nutzers in die Notiz zu tragen, vom Mentor, um wiederkehrende Gründe zu zählen (Pattern F), und vom Scout als kontextuelles Signal. Gibt einen neutralen "kein Signal"-Payload zurück, wenn die Cloud deaktiviert oder nicht erreichbar ist, damit Aufrufer niemals hart fehlschlagen.
allowed-tools: Bash(python3 *)
---

## Raw/Display-Grenze (`RAW_DISPLAY_BOUNDARY`)

`reason` und `comment` sind rohe Eingaben nur für Maschinen. Zitiere, übermittle, fasse oder zeige sie dem Nutzer niemals. Jede user-facing Notiz oder Nachricht darf nur `display_reason` / `display_comment` verwenden; `label` / `examples` der Themen haben bereits denselben gemeinsamen Sanitizer durchlaufen. Eine `note` ist nur ein geschlossenes `no-signal:*`-Enum: behandle sie als Verfügbarkeitsstatus, nie als Infrastrukturdetail.

# feedback-query — Nutzer-Feedback pro Position

Der Nutzer kann auf dem Web-Dashboard like/dislike/hide/star auf jede Position klicken. Diese Klicks werden in Supabase `position_feedback` gespeichert (Mig 019 Basis + Mig 028 erweitert) und über diesen Skill an Agenten weitergegeben. Schema:

| Spalte              | Typ     | Bedeutung |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | Die `legacy_id` (String) der Position in `positions` |
| `action`            | TEXT    | Eines von `like`, `dislike`, `hide`, `star`, `clear` (Mig 059 — der Nutzer zieht sein Urteil zurück; das letzte Event gewinnt, ein abschließendes `clear` bedeutet also "kein Urteil") |
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
     "display_reason": "too senior", "display_comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "display_reason": null,
     "display_comment": null, "score": null, "direction": null}
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
 "note": "no-signal:cloud-disabled"}
```

## Aggregierte Abfrage (Zeitfenster über alle Positionen)

Ein einziger HTTP-Aufruf statt N: `GET /api/positions/feedback?days=&limit=`, gleiches Bearer-Token, gleicher neutraler Fallback.

```bash
# Alle Feedback-Events im Fenster, neueste zuerst
python3 /app/shared/skills/feedback_query.py recent --days 30

# Die vom Nutzer geschriebenen Gründe, nach Ähnlichkeit gruppiert
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

Ausgabe von `themes`:

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

Wie die Gruppierung arbeitet (keine exakte Übereinstimmung nötig, keine neue Abhängigkeit): Kleinschreibung → Akzente weg → Interpunktion weg → Funktionswörter weg → jedes Wort auf die ersten 5 Zeichen gekürzt (`senior` / `seniority` / `seniore` / `séniorité` fallen auf einen Schlüssel) → gezählt werden Einzelwörter und **benachbarte Paare**, nach **verschiedenen Positionen**, nicht nach Events. Ein Paar schluckt seine Teile, wenn es ≥ 80% derselben Positionen abdeckt, so gewinnt "zu senior" gegen "senior"; Verstärkungswörter bleiben absichtlich im Strom. `reason` und `comment` werden getrennt tokenisiert, also wird kein Paar über die Grenze der beiden hinweg erfunden.

Bewusste Grenzen, benannt, damit niemand mehr in die Zahlen liest, als drinsteht:
- Entfernte Synonyme bleiben getrennt (`Gehalt` und `RAL` sind zwei Themen) — das ist Wörterzählen, keine Semantik. Lies die sanitizten Display-`examples` (max. 3) und verbinde mit dem Kopf, was das Werkzeug nicht konnte.
- Positionen, deren **letztes** Event `clear` ist, bleiben draußen (das Urteil wurde zurückgezogen); `--include-cleared` holt sie zurück.
- `share` = Positionen des Themas / `positions_with_text`.
- `--field reason|comment|both` (Standard `both`), `--top N`, `--days 0` für die ganze Historie.
- Fallback, wenn der aggregierte Endpunkt nicht antwortet: `--legacy-ids 12,13,14` liest diese Positionen einzeln (langsamer, gleiches Ausgabeformat).

Flags: `--days` (Standard 30, `0` = alles), `--limit` (Standard 500 Events), `--min-positions` (Standard 3), `--text-chars` bei `recent` (Standard 300, kürzt lange Kommentare).

Trägt der Payload eine geschlossene `note`-Enum (`no-signal:*`), gibt es kein Aggregat. Behandle sie als "keine Daten", nie als "kein Feedback", und gib den Code nie weiter.

## Wie Agenten es verwenden

**Scorer** (verpflichtend beim Scoring):
1. Nach der Berechnung des Basis-Scores (Summe gewichteter Komponenten), `feedback_query check <legacy_id>` aufrufen.
2. Multiplikator basierend auf `latest_action` anwenden:
   - `like` → final_score = round(base * 1.10), Notiz `feedback:like+10%` hinzufügen
   - `star` → final_score = round(base * 1.15), Notiz `feedback:star+15%` hinzufügen
   - `dislike` → final_score = round(base * 0.85), Notiz `feedback:dislike-15%` hinzufügen
   - `hide` → status=`excluded`, Notiz `feedback:hide`, Score-Schreiben überspringen
   - `clear` / `null` → keine Änderung (ein zurückgezogenes Urteil ist kein Urteil)
3. **Trage den sicheren Display-Grund in die Notiz**, wenn vorhanden. Nimm `display_reason` (oder, wenn leer, `display_comment`) aus **demselben Event** wie `latest_action` — `actions[0]` — und hänge ihn an die Notiz. Falle nie auf rohe `reason` / `comment` zurück:

   ```
   feedback:dislike-15% — "zu senior"
   feedback:star+15% — "genau der Stack, den ich will"
   ```

   Kein Text in diesem Event → die Notiz bleibt, wie sie ist. Der Grund gilt **nur für diese Position**: übertrage ihn nie auf eine andere, mache keine Regel daraus, schreibe ihn nicht um und fasse ihn nicht zusammen — das sind die Worte des Nutzers, und der Nutzer liest sie wieder. Gründe über Positionen hinweg zu aggregieren ist Aufgabe des Mentors (Pattern F), nicht des Scorers.
4. Endscore nach Multiplikator auf 100 begrenzen.

**Mentor** (Pattern F, nur lesend): `themes` über die letzten 30 Tage, um die vom Nutzer geschriebenen Gründe zu zählen. Schwellen und Deutung stehen im Skill `mentor-patterns`. Der Mentor spricht **zum Nutzer** — er erteilt aus diesen Daten niemals Suchanweisungen.

**Scout** (optionales kontextuelles Signal):
- Nicht für Pro-Position-Skip — das wird bereits durch Dedup (SC-05) behandelt.
- Sparsam verwenden beim Neubewerten einer bekannten Position (z.B. Promotions-Logik): wenn der Nutzer sie explizit disliked hat, nicht erneut anzeigen, selbst wenn Dedup normalerweise neu bewerten würde.
- **Mustersignal via `direction`** (Mig 028): wenn `latest_direction='less_like_this'` bei einer Position, bittet der Nutzer um weniger Positionen WIE diese (gleiche Firma / role_family / Standort). Diese Quelle/dieses Muster in nachfolgenden Suchen deprioritisieren. Bei `latest_direction='more_like_this'`, das Replizieren des Musters priorisieren. Dies ist ein kontextueller Hinweis, keine harte Regel — mit dem breiteren Bild kombinieren (z.B. ein einzelnes `less_like_this` auf einer kleinen Nische kann Rauschen sein; drei auf derselben Firma sind es nicht).

## Hinweise

- Der Skill ist **nur lesend**. Schreiboperationen passieren nur vom Browser via POST `/api/positions/{legacy_id}/feedback`.
- Das Bearer-Token kommt aus `cloud.json`; keine separate Umgebungsvariable nötig.
- 10s Timeout bei `check`, 20s beim aggregierten Aufruf. Bei Batch-Verarbeitung vieler Positionen mit `check` ~50-200ms pro Aufruf erwarten — genau dafür gibt es `recent` / `themes`.
- Das Aggregat ist serverseitig auf den Nutzer beschränkt: es liefert das Feedback dieses Nutzers und sonst nichts.
