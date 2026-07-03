<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: format-time
description: UTC-Zeitstempel in die Zeitzone des Nutzers konvertieren, bevor sie im Chat, in Diagrammen, Telegram oder einer anderen nutzerorientierten Ausgabe angezeigt werden. Verwende diesen Helfer immer, wenn du sonst ein rohes `strftime("%H:%M")` eines UTC-Datetime in etwas schreiben würdest, das der Nutzer liest.
allowed-tools: Bash(python3 *)
---

# format-time — UTC → Nutzer-Zeitzone in nutzerorientierter Ausgabe

Bug #15: Der Container läuft in UTC, der Nutzer lebt in CEST/CET. Ohne
Konvertierung zwingt jedes "Reset um 03:11" in Chat oder Diagrammen den Nutzer,
`+2` im Kopf zu rechnen — und manchmal sagt der Nutzer *"bei mir sind es
3:21"* und der Capitano muss die Konvertierung hastig nachrechnen.

## Wann verwenden

Anwenden, wann immer du einen Zeitstempel produzierst, den der **Nutzer** lesen wird:

- Telegram-Nachrichten von jedem Agenten (Capitano, Assistente, Mentor)
- Matplotlib-Diagramm-Untertitel, X-Achsen-Labels, Legenden
- Dashboard-Widgets, die Zeit anzeigen
- Logzeilen oder Zusammenfassungen, die dem Nutzer zurückgegeben werden

**Überspringen** wenn:
- Interne Logdateien geschrieben werden (`messages.jsonl`, `sentinel-data.jsonl`,
  `dottore-actions.jsonl`) — bleiben UTC ISO für agentenübergreifendes Parsing.
- DB-Spalten geschrieben werden — UTC ISO beibehalten, damit das Dashboard
  beim Rendern formatieren kann.
- Intervalle / Deltas berechnet werden — in UTC arbeiten, erst an den Rändern formatieren.

## Wie verwenden

```python
from shared.skills.format_time import fmt_user, fmt_user_with_utc
from datetime import datetime, timezone

now = datetime.now(timezone.utc)
print(fmt_user(now))            # "03:21 CEST"
print(fmt_user_with_utc(now))   # "03:21 CEST (01:21 UTC)"
```

Oder, aus Bash:

```bash
python3 /app/shared/skills/format_time.py --now
python3 /app/shared/skills/format_time.py --iso 2026-05-17T01:14:00Z --with-utc
```

## Wann sowohl Nutzer-Zeit als auch UTC anzeigen

In **operativen Diagrammen**, die ein Bereitschaftsingenieur (oder du beim Debuggen)
neben den UTC-Logs des Teams lesen könnte, `fmt_user_with_utc` bevorzugen,
damit beide sichtbar sind:

> *"Jetzt 03:21 CEST (01:21 UTC) — Nutzung 63% — proj 92.2%"*

Im **normalen Telegram-Chat** an den Nutzer reicht `fmt_user` allein
normalerweise:

> *"📅 Reset Fenster 5h um 05:11 CEST (~1h 50m)."*

## Woher die Nutzer-Zeitzone kommt

`candidate_profile.yml::timezone` (IANA-Name, z.B. `Europe/Rome`).
Standard `Europe/Rome` wenn fehlend — deckt ~95% der Beta-Nutzer ab. Zum
Überschreiben pro Sitzung: `JHT_USER_TZ` Umgebungsvariable (wird vom Helfer gelesen).

## Anti-Patterns

- ❌ `datetime.now().strftime("%H:%M")` in einem nutzerorientierten String —
  produziert die **Container**-Zeit (UTC) ohne Suffix → Verwirrung beim
  Nutzer.
- ❌ Handgeschriebene `+2`-Mathematik irgendwo. Den Helfer verwenden; die Sommerzeit wechselt
  Europe/Rome Ende Oktober auf CET (+1) und du wirst es vergessen.
- ❌ `"CEST"` als Suffix hardcoden — falsch für die Hälfte des Jahres und
  falsch für nicht-italienische Nutzer.

## Siehe auch

- `shared/skills/format_time.py` — Implementierung.
- `docs/examples/candidate_profile.yml.example` — Dokumentation des `timezone:`-Felds.
