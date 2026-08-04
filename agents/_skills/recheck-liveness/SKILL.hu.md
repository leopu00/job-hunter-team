<!-- @translation: hu, ai-translated 2026-08-03 -->
---
name: recheck-liveness
description: "Ellenőrzi, hogy egy álláshirdetés MÉG NYITVA VAN-E, hamis nyitottak nélkül. Kiváltja a rögtönzött curl-t (HTTP 200 = \"nyitva\"), amely NEM látja a JavaScriptben renderelt lejáratot (Ashby/Workday/Greenhouse), sem a LinkedIn authwallját (200-at ad a lezártakra is). MINDIG ezt használd a recheck során; soha ne állítsd be az is_open értékét kézzel egyetlen HTTP 200 alapján."
allowed-tools: Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-liveness — "nyitva van még a hirdetés?", rendesen megcsinálva

## Miért létezik
A régi recheck egy rögtönzött curl volt (`code=200 marker=none → nyitva`). A curl csak a NYERS
HTML-t látja, így sok ATS-en (Ashby/Workday/Greenhouse) és a LinkedInen a "lejárt/lezárt" állapot
JS-ben renderelődik, vagy authwall mögött van → a curl nem látja → `is_open=1` olyan hirdetéseken,
amelyek már LE VANNAK ZÁRVA. Szennyezett adat a lánc további részén (score, térkép).

## Hogyan használd
```sh
python3 /app/shared/skills/recheck_liveness.py "<url>" "[opcionális cím]"
```
JSON-kimenet + exit kód:
| state | exit | jelentés |
|---|---|---|
| `OPEN` | 0 | igazoltan nyitva |
| `CLOSED` | 1 | lezárt/lejárt (404/410 vagy lezárás-marker) |
| `OPEN_UNVERIFIED` | 2 | nem ellenőrizhető (JS/authwall host + a böngésző nem elérhető) |

## Mit csinál (szintenként)
1. gyors **curl**: HTTP-kód + a lezárás-markerek keresése (EN+IT) + 404/410.
2. **ATS-JS / LinkedIn** host vagy kétértelmű kód → **eszkaláció a BÖNGÉSZŐRE**
   (Playwright-renderelés), és a markerek újbóli keresése a RENDERELT HTML-en.
3. továbbra is bizonytalan → **`OPEN_UNVERIFIED`** — SOHA nem hamis nyitott (`resilience` minta).

## Aranyszabály
- `is_open=1` **CSAK** akkor, ha `state == OPEN`.
- `state == CLOSED` → `status='expired'` + egy jegyzet, amely tartalmazza az `evidence` mezőt.
- `state == OPEN_UNVERIFIED` → **hagyd az `is_open` értékét változatlanul** + egy
  `[OPEN_UNVERIFIED]` jegyzet; ne add el nyitottként.
- A rögtönzött "200 = nyitva" curl a liveness eldöntésére **tilos**.
