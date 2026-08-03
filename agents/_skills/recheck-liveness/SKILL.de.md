<!-- @translation: de, ai-translated 2026-08-03 -->
---
name: recheck-liveness
description: "Prüft, ob eine Stellenanzeige NOCH OFFEN ist, ohne fälschlich als offen zu melden. Ersetzt den improvisierten curl (HTTP 200 = \"offen\"), der weder das per JavaScript gerenderte Ablaufdatum (Ashby/Workday/Greenhouse) noch die LinkedIn-Authwall sieht (200 auch bei geschlossenen Anzeigen). IMMER im Recheck verwenden; is_open niemals von Hand anhand eines einzelnen HTTP 200 setzen."
allowed-tools: Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-liveness — "ist die Stelle noch offen?", richtig gemacht

## Warum es sie gibt
Der alte Recheck war ein improvisierter curl (`code=200 marker=none → offen`). curl sieht nur das
ROHE HTML: auf vielen ATS (Ashby/Workday/Greenhouse) und auf LinkedIn wird der Status
"abgelaufen/geschlossen" per JS gerendert oder liegt hinter einer Authwall → curl sieht ihn nicht →
`is_open=1` bei Anzeigen, die bereits GESCHLOSSEN sind. Schmutzige Daten flussabwärts (Score, Karte).

## Verwendung
```sh
python3 /app/shared/skills/recheck_liveness.py "<url>" "[optionaler Titel]"
```
JSON-Ausgabe + Exit-Code:
| state | exit | Bedeutung |
|---|---|---|
| `OPEN` | 0 | verifiziert offen |
| `CLOSED` | 1 | geschlossen/abgelaufen (404/410 oder Closed-Marker) |
| `OPEN_UNVERIFIED` | 2 | nicht verifizierbar (JS-/Authwall-Host + Browser nicht verfügbar) |

## Was sie tut (gestuft)
1. schneller **curl**: HTTP-Code + Suche nach Closed-Markern (EN+IT) + 404/410.
2. **ATS-JS- / LinkedIn**-Host oder mehrdeutiger Code → **Eskalation an den BROWSER**
   (Playwright-Rendering) und erneute Marker-Suche im GERENDERTEN HTML.
3. weiterhin unsicher → **`OPEN_UNVERIFIED`** — NIEMALS ein falsches "offen" (`resilience`-Muster).

## Goldene Regel
- `is_open=1` **NUR**, wenn `state == OPEN`.
- `state == CLOSED` → `status='expired'` + eine Notiz, die die `evidence` enthält.
- `state == OPEN_UNVERIFIED` → **`is_open` unverändert lassen** + eine `[OPEN_UNVERIFIED]`-Notiz;
  gib sie NICHT als offen aus.
- Der improvisierte curl nach dem Muster "200 = offen" ist als Mittel zur Liveness-Entscheidung
  **verboten**.
