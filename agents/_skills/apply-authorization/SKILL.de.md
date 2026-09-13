<!-- @translation: de, ai-translated 2026-09-13 -->
---
name: apply-authorization
description: Die zwei Tore zwischen dem Team und dem Postfach eines Recruiters, und wie man ihre Ablehnungen liest. Eine Bewerbung geht NUR raus, wenn der User allgemein zugestimmt hat (`applications.auto_apply` in der User-Config) UND genau diese Position markiert hat. Beide fail-closed und im Code von `apply_gate.py` geprüft. Nutze sie beim Boot und vor jeder Position, um die Queue des CLOSER zu lesen, und immer wenn du erklären musst, warum eine Position nicht rausging. Gehört dem CLOSER; der Capitano liest dieselbe Queue, um zu entscheiden, ob er ihn spawnt.
allowed-tools: Bash(python3 /app/shared/skills/apply_gate.py *)
---

# apply-authorization — was rausgehen darf, und warum der Rest nicht

Eine Bewerbung verlässt die Box nur, wenn **zwei** Bedingungen gelten. Fehlend,
kaputt oder nicht erkannt zählt als **nein**, jedes Mal.

| # | Bedingung | Wo sie lebt | Wer sie setzt |
|---|---|---|---|
| 1 | allgemeine Zustimmung | `applications.auto_apply.enabled = true` in `$JHT_HOME/jht.config.json` | der User, bei der Aktivierung |
| 2 | Autorisierung pro Position | `positions.apply_requested = 1` mit `apply_requested_at` und `apply_requested_by` = `user_web` / `user_local` | der User, auf dieser Position |

Das Flag des Users **ist** die Autorisierung zum Senden. Es gibt keine zweite Frage.

## Die Queue — ein Befehl, gelesen von zwei Rollen

```bash
python3 /app/shared/skills/apply_gate.py queue --json
```

Exit `0` nur, wenn jetzt etwas rausgehen kann; sonst Exit `1`. Das JSON:

| Feld | Bedeutung |
|---|---|
| `ready` | `true` = mindestens eine Position kann jetzt genommen werden |
| `reason` | stabiles Token, siehe unten |
| `mode` | `authorised` (sendet) oder `dry_run` (Diagnose, füllt aus und stoppt vor dem Button) |
| `max_per_day` / `sent_today` / `remaining_today` | das Tageslimit der vom CLOSER gesendeten Bewerbungen |
| `positions` | was du nehmen darfst, in Autorisierungsreihenfolge: `position_id`, `url`, `cv_pdf_path` |
| `held` | autorisierte Positionen, die jetzt NICHT genommen werden dürfen, jede mit ihrem `reason` |

Der CLOSER nimmt den ersten Eintrag von `positions`. Der Capitano spawnt den
CLOSER nur, wenn der Befehl mit `0` endet.

## Warum die Queue geschlossen ist (`reason`)

| Token | Bedeutung | Was tun |
|---|---|---|
| `config_missing` / `config_unreadable` / `config_malformed` | die User-Config ist nicht lesbar | nichts: keine Zustimmung feststellbar |
| `consent_absent` / `consent_disabled` | der User hat nicht zugestimmt | nichts. Nie vorschlagen, es einzuschalten (RULE-T18) |
| `consent_mode_unknown` / `consent_cap_invalid` | der Block existiert, aber ein Wert wird nicht erkannt | nichts: das Tor lehnt ab, statt zu raten |
| `db_unavailable` / `queue_unreadable` | die lokale Datenbank ist nicht lesbar | `[BLOCKED]` an den Capitano |
| `queue_empty` | keine autorisierte Position kann genommen werden | beenden |
| `daily_cap_reached` | der CLOSER hat heute schon `max_per_day` gesendet | beenden; die Queue öffnet morgen wieder |

## Warum eine Position zurückgehalten wird (`held[].reason`)

| Token | Bedeutung |
|---|---|
| `already_submitted` | die Bewerbung ist schon raus (Status `applied`/`response`, oder die Application-Zeile sagt applied). Das Flag bleibt nach dem Senden an: es ist keine neue Anfrage |
| `position_not_authorised` | das Flag ist aus (der User hat es widerrufen) |
| `authorisation_undated` | das Flag hat keinen Zeitstempel |
| `authorisation_not_from_user` | das Flag wurde nicht von einem User-Kanal gesetzt. Ein von einem Prozess gesetztes Flag ist keine Autorisierung |
| `url_missing` / `cv_pdf_missing` | es gibt nichts, womit das Formular ausgefüllt werden kann |
| `checkpoint_blocked_human` | der Flow hat auf dieser Position schon gestoppt und den User gefragt. Sie kommt erst zurück, wenn der User sie erneut autorisiert |
| `checkpoint_dry_run` | schon im Diagnosemodus ausgefüllt |
| `checkpoint_unreadable` | der Checkpoint des Flows ist nicht lesbar: Unsicherheit, also nein |

## Eine Position, ein Urteil

```bash
python3 /app/shared/skills/apply_gate.py position <ID> --json
```

`allowed: true` nur mit `reason: apply_allowed`. Das ist dieselbe Prüfung, die
`apply_flow.py` beim Start und noch einmal direkt vor dem Klick macht. Du musst
sie nicht vor dem Flow ausführen; nutze sie, um eine Ablehnung zu erklären.

## Regeln

- **Nie die Autorisierung schreiben.** `apply_requested*` gehört dem User.
- **Nie eine Ablehnung umgehen.** Ein geschlossenes Tor ist die Antwort, kein Hindernis.
- **Nie den User bitten, mehr zu autorisieren.** Das Team ist auch ohne eine
  einzige Bewerbung vollständig (RULE-T18).
