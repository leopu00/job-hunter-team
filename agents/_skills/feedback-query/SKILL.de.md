---
name: feedback-query
description: Liest Nutzer-Feedback (like/dislike/hide/star) aus der Cloud — pro Position oder aggregiert über ein Zeitfenster. Der Scorer nutzt es nur als kontextuellen Präferenzhinweis für künftige Positionen und schließt die aktuelle aus; der Mentor zählt wiederkehrende Gründe (Pattern F), der Scout nutzt es als Kontextsignal. Bei nicht erreichbarer Cloud wird ein neutraler "kein Signal"-Payload zurückgegeben.
allowed-tools: Bash(python3 *)
---
<!-- @translation: de, ai-translated 2026-06-06 -->

## Raw/Display-Grenze (`RAW_DISPLAY_BOUNDARY`)

Der `reason` eines Urteils ist ein **Code** aus einer geschlossenen Liste (`too_senior`, `too_junior`, `wrong_location`, `salary_low`, `wrong_stack`, `company`, `scam_or_gone`, `closed`, `already_applied`, `other`). Was der Nutzer mit eigenen Worten schreibt, ist eine private Notiz, die dieser Skill nie zurückgibt: In keinem Feld steht Text des Nutzers, und es gibt nichts zu zitieren, weiterzugeben oder zu paraphrasieren. Das `label` des Themas ist eine feste Formulierung für den Code. Eine `note` ist nur ein geschlossenes `no-signal:*`-Enum: behandle sie als Verfügbarkeitsstatus, nie als Infrastrukturdetail.

# feedback-query — Nutzer-Feedback pro Position

Der Nutzer kann auf dem Web-Dashboard like/dislike/hide/star auf jede Position klicken. Diese Klicks werden in Supabase `position_feedback` gespeichert (Mig 019 Basis + Mig 028 erweitert) und über diesen Skill an Agenten weitergegeben. Schema:

| Spalte              | Typ     | Bedeutung |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | Die `legacy_id` (String) der Position in `positions` |
| `action`            | TEXT    | Eines von `like`, `dislike`, `hide`, `star`, `clear` (Mig 059 — der Nutzer zieht sein Urteil zurück; das letzte Event gewinnt, ein abschließendes `clear` bedeutet also "kein Urteil") |
| `reason`            | TEXT    | Optionaler Grund: ein Code der obigen geschlossenen Liste |
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
     "reason": "too_senior", "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "score": null, "direction": null}
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

# Die Grund-Codes, über verschiedene Positionen gezählt
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

Ausgabe von `themes`:

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

So funktioniert das Zählen: Jede Position zählt **einmal**, mit dem Grund ihres **letzten** Urteils, und es zählen nur Gründe, die ein Code der Liste sind (ein alter Freitext-Grund liest sich als `other`). Es gibt keinen Text zu gruppieren, und nichts wird interpretiert. `other` wird gezählt, sagt aber nichts Konkretes.

Bewusste Grenzen, benannt, damit niemand mehr in die Zahlen liest, als drinsteht:
- Ein Thema ist ein Code, also so grob wie die Liste: `wrong_location` sagt nicht, welche Stadt. Nichts, was der Nutzer geschrieben hat, steht zur Verfeinerung zur Verfügung.
- Positionen, deren **letztes** Event `clear` ist, bleiben draußen (das Urteil wurde zurückgezogen); `--include-cleared` holt sie zurück.
- `share` = Positionen des Themas / `positions_with_reason`.
- `--top N`, `--days 0` für die ganze Historie. (`--field` wird akzeptiert und ignoriert, wegen älterer Prompts.)
- Fallback, wenn der aggregierte Endpunkt nicht antwortet: `--legacy-ids 12,13,14` liest diese Positionen einzeln (langsamer, gleiches Ausgabeformat).

Flags: `--days` (Standard 30, `0` = alles), `--limit` (Standard 500 Events), `--min-positions` (Standard 3).

Trägt der Payload eine geschlossene `note`-Enum (`no-signal:*`), gibt es kein Aggregat. Behandle sie als "keine Daten", nie als "kein Feedback", und gib den Code nie weiter.

## Wie Agenten es verwenden

**Scorer — `FUTURE_FEEDBACK_ONLY`:** rufe `themes --days 30 --min-positions 1 --top 10 --exclude-legacy-id <legacy_id>` auf. Nutze die Codes `key` / `label` nur als kontextuellen Präferenzhinweis, wenn du diese künftige Position bewertest. Feedback einer bereits beurteilten Position ändert nie Score, Status oder Notizen: keine festen Boni/Mali, Feedback-Marker oder Backfills. Bestehende Scores bleiben unverändert. O-70 explizite Neubewertung ist ein separater, vom Nutzer angeforderter Ablauf.

**Mentor** (Pattern F, nur lesend): `themes` über die letzten 30 Tage, um die vom Nutzer gewählten Grund-Codes zu zählen. Schwellen und Deutung stehen im Skill `mentor-patterns`. Der Mentor spricht **zum Nutzer** — er erteilt aus diesen Daten niemals Suchanweisungen.

**Scout** (optionales kontextuelles Signal):
- Nicht für Pro-Position-Skip — das wird bereits durch Dedup (SC-05) behandelt.
- Sparsam verwenden beim Neubewerten einer bekannten Position (z.B. Promotions-Logik): wenn der Nutzer sie explizit disliked hat, nicht erneut anzeigen, selbst wenn Dedup normalerweise neu bewerten würde.
- **Mustersignal via `direction`** (Mig 028): wenn `latest_direction='less_like_this'` bei einer Position, bittet der Nutzer um weniger Positionen WIE diese (gleiche Firma / role_family / Standort). Diese Quelle/dieses Muster in nachfolgenden Suchen deprioritisieren. Bei `latest_direction='more_like_this'`, das Replizieren des Musters priorisieren. Dies ist ein kontextueller Hinweis, keine harte Regel — mit dem breiteren Bild kombinieren (z.B. ein einzelnes `less_like_this` auf einer kleinen Nische kann Rauschen sein; drei auf derselben Firma sind es nicht).

## Hinweise

- Der Skill ist **nur lesend**. Schreiboperationen passieren nur vom Browser via POST `/api/positions/{legacy_id}/feedback`.
- Das Bearer-Token kommt aus `cloud.json`; keine separate Umgebungsvariable nötig.
- 10s Timeout bei `check`, 20s beim aggregierten Aufruf. Bei Batch-Verarbeitung vieler Positionen mit `check` ~50-200ms pro Aufruf erwarten — genau dafür gibt es `recent` / `themes`.
- Das Aggregat ist serverseitig auf den Nutzer beschränkt: es liefert das Feedback dieses Nutzers und sonst nichts.
