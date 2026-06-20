<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Deadlines aus der JD extrahieren (Helfer deadline_extract) und Nutzer-Alerts generieren, wenn eine READY-Bewerbung bald abläuft (Helfer expiration_alerts, idempotent). F-4 Task #50. Scout/Analyst befüllen positions.deadline, Mentor/Capitano benachrichtigen den Nutzer wenn deadline-now ≤ 3 Tage.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *), Bash(jht-telegram-send *)
---

# expiration-tracking — Top-PASS nicht durch Ablauf verlieren

Latenter Bug F-4: Nutzer sammelt 50 CVs mit `ready`, vergisst sich 2 Tage lang
zu bewerben, Top-Gelegenheit (z.B. Sisal PASS 7.5) läuft still ab.
Die Pipeline ist user-curated apply (Bug #9 herabgestuft) → ohne proaktiven Alert
wird der Eifer des Teams beim Training von Top-CVs durch das
Schweigen des Nutzers zunichtegemacht.

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

## C. Mentor/Capitano: proaktiver Nutzer-Alert

Empfohlener Trigger: nach jedem `[BRIDGE TICK]` (Capitano) oder am Ende eines
Mentor-Durchlaufs. Idempotenz bewirkt, dass häufige Aufrufe nur Alerts
für NEUE Paare (app_id, deadline_iso) produzieren.

```bash
alerts=$(python3 /app/shared/skills/expiration_alerts.py)
if [ -n "$alerts" ]; then
  # An den Nutzer via Telegram senden
  echo "$alerts" | jht-telegram-send --from capitano --keyboard capitano
fi
```

Ausgabe 1 Zeile pro gefährdete Application:
```
⏳ [ALERT Ablauf] Sisal Data Analyst (PASS 7.5) — läuft ab 2026-05-18 (MORGEN). Bewerbung absenden oder Gelegenheit verlieren.
```

Der Idempotenz-State liegt in `$JHT_HOME/state/expiration_alerts_sent.json`
(Set von `(app_id, deadline_iso)`, die bereits benachrichtigt wurden). Um einen
bereits gesendeten Alert erneut zu senden: `expiration_alerts.py --reset` (nur Dev).

## B. Periodische Nachprüfung alter Positions (Analyst) — OFFEN

Zukünftige Erweiterung des Skills `liveness-check`: alle 6h, URL
der Positions mit `status IN ('scored', 'ready')` und `last_checked <
NOW() - 12h` erneut abrufen. Wenn die URL 404 / "no longer accepting" zurückgibt → auf
`status='expired'` + Notiz umstellen. Außerhalb des Scopes für das initiale F-4; die Bottom-up-
Deadlines, die aus der JD erfasst werden, decken die meisten Fälle ab.

## Anti-Patterns

- ❌ Deadline von Hand mit Inline-Regex parsen — verwende den Helfer, er hat
  Fallback EN/IT + Plausibilitätsprüfung auf vergangene Daten.
- ❌ Deadline erfinden, wenn die JD sie nicht explizit angibt —
  besser `NULL` als `+30d willkürlich`.
- ❌ Den Nutzer alle 6h mit demselben Alert spammen — der Idempotenz-
  State existiert genau dafür.
- ❌ Den Alert von einem anderen Bot als dem Capitano senden (z.B. generischer Assistente)
  — verliert operativen Kontext; der Capitano begleitet den Nutzer
  zur Pipeline.

## Siehe auch

- `shared/skills/deadline_extract.py` — Parser
- `shared/skills/expiration_alerts.py` — Emitter + Idempotenz-State
- `agents/_skills/db-update/SKILL.md` § Positions — `--deadline`-Flag
