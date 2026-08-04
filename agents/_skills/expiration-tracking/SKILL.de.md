<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Extrahiert Fristen aus Stellenanzeigen und gibt sachliche Fristinformationen nur auf ausdrueckliche Anfrage des Nutzers aus. Nie automatisch benachrichtigen oder draengen.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *)
---

# expiration-tracking — Fristdaten auf Anfrage

Fristen helfen dem Nutzer, Chancen zu bewerten. Bewahre sie genau auf, aber mache daraus weder eine Erinnerung noch eine Aufforderung zur Bewerbung oder ein Fortschrittsmass.

## A. Scout/Analyst: Deadline-Extraktion aus der JD

Wenn du eine neue Position einfügst (Scout) oder die JD
anreicherst (Analyst), übergib den Text an `deadline_extract`:

```bash
# Direkte CLI: extrahiert aus stdin oder --jd
echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py
# → 2026-06-15 (ISO-Datum) oder leerer String

# Inline im db_insert.py position
deadline_iso=$(echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py)
if [ -n "$deadline_iso" ]; then
  python3 /app/shared/skills/db_insert.py position \
    --title "$TITLE" --company "$COMPANY" --url "$URL" \
    --jd-text "$JD_TEXT" \
    --deadline "$deadline_iso"  # ← neu, F-4
fi
```

Der Parser ist **konservativ** (nur ISO, dd/mm/yyyy EU, Month dd[, yyyy]
EN/IT, "expires in N days"). Wenn er keinen hochkonfidenten Match findet,
gibt er leeren String zurück → besser NULL in der DB als erfundenes Datum.

## C. Fristinformation, nur auf Anfrage

Nutze diesen Abschnitt nur, wenn du die ausdrueckliche Frage des Nutzers zur Frist einer Stelle oder Bewerbung beantwortest. Plane ihn nie, sende ihn nicht proaktiv und leite seine Ausgabe nie als Benachrichtigung weiter.

Ausfuehren: python3 /app/shared/skills/expiration_alerts.py --user-requested

Die Ausgabe liefert sachliche Fristinformationen zu Stellen, die bereits in den Daten des Nutzers sind, zum Beispiel: [DEADLINE] Sisal Data Analyst (PASS 7.5) — endet am 2026-05-18 (morgen).

## B. Periodische Nachprüfung alter Positions (Analyst) — OFFEN

Zukünftige Erweiterung des Skills `liveness-check`: alle 6h, URL
der Positions mit `status IN ('scored', 'ready')` und `last_checked <
NOW() - 12h` erneut abrufen. Wenn die URL 404 / "no longer accepting" zurückgibt → auf
`status='expired'` + Notiz umstellen. Außerhalb des Scopes für das initiale F-4; die Bottom-up-
Deadlines, die aus der JD erfasst werden, decken die meisten Fälle ab.

## Anti-Patterns

- Fuehre den Fristbericht nicht ohne ausdrueckliche Anfrage des Nutzers aus.
- Mache aus Fristinformationen keine Aufforderung, Erinnerung oder Druck zur Bewerbung.

## Siehe auch

- `shared/skills/deadline_extract.py` — Parser
- shared/skills/expiration_alerts.py — Fristbericht auf Anfrage
- `agents/_skills/db-update/SKILL.md` § Positions — `--deadline`-Flag
