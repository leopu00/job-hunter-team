<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Felhasználói visszajelzés olvasása (like/dislike/hide/star) egy adott pozícióhoz a felhőből. A Scorer használja szorzó alkalmazásához a végső pontszámon, a Scout pedig kontextuális jelként. Semleges "nincs jel" payloadot ad vissza, ha a felhő le van tiltva vagy nem érhető el, így a hívók soha nem buknak el keményen.
allowed-tools: Bash(python3 *)
---

# feedback-query — Felhasználói visszajelzés pozíciónként

A felhasználó like/dislike/hide/star-t kattinthat bármelyik pozícióra a webes dashboardról. Ezek a kattintások a Supabase `position_feedback`-ben tárolódnak (mig 019 alap + mig 028 kiterjesztett) és ezen a skill-en keresztül érhetők el az ágensek számára. Séma:

| Oszlop              | Típus   | Jelentés |
|---------------------|---------|----------|
| `position_legacy_id`| TEXT    | A pozíció `legacy_id`-je (string) a `positions`-ben |
| `action`            | TEXT    | `like`, `dislike`, `hide`, `star` egyike |
| `reason`            | TEXT    | Opcionális rövid indok (≤500 karakter) |
| `comment`           | TEXT    | Opcionális részletes megjegyzés (≤2000 karakter, mig 028) |
| `score`             | INTEGER | Opcionális 1-5 granulált pontszám (mig 028) |
| `direction`         | TEXT    | Opcionális `more_like_this` / `less_like_this` — minta jel a Scout számára, NEM pozíciónkénti kihagyás (mig 028) |
| `created_at`        | TS      | Beküldési idő |

A skill `GET /api/positions/{legacy_id}/feedback`-et hív a felhőben (a `$JHT_HOME/cloud.json`-ban lévő bearer token használatával). Felhő letiltva vagy hálózati hiba esetén a skill **nem hibázik** — `ok=true, latest_action=null`-t ad vissza `note` mezővel. Az ágenseknek tovább kell haladniuk.

## Egyetlen pozíció lekérdezés

```bash
python3 /app/shared/skills/feedback_query.py check <legacy_id>
```

Kimenet (JSON stdout-ra):

```json
{
  "ok": true,
  "legacy_id": "42",
  "latest_action": "dislike",
  "latest_direction": "less_like_this",
  "count": 2,
  "actions": [
    {"action": "dislike", "created_at": "2026-05-30T14:21:00Z",
     "reason": "too senior", "comment": "5+ evi Java szükseges, nem erdekel a legacy stack",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "score": null, "direction": null}
  ]
}
```

A `latest_action` a legutóbbi kattintás. A `latest_direction` a `direction` legutóbbi NEM-NULL értéke az előzményekben (bárhol az actions[]-ben, nem feltétlenül a legutóbbi actionben). Az `actions[]` DESC sorrendben van `created_at` szerint. Üres, ha nincs visszajelzés:

```json
{"ok": true, "legacy_id": "99", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": []}
```

Ha a felhő letiltva van vagy a végpont nem érhető el, a skill visszaadja:

```json
{"ok": true, "legacy_id": "...", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": [],
 "note": "no-signal (cloud-disabled)"}
```

## Hogyan használják az ágensek

**Scorer** (kötelező pontozáskor):
1. Az alap pontszám kiszámítása után (súlyozott komponensek összege), hívd meg a `feedback_query check <legacy_id>`-t.
2. Alkalmazz szorzót a `latest_action` alapján:
   - `like` → final_score = round(base * 1.10), adj megjegyzést `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), adj megjegyzést `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), adj megjegyzést `feedback:dislike-15%`
   - `hide` → status=`excluded`, megjegyzés `feedback:hide`, hagyj ki pontszám írást
   - `null` → nincs változás
3. Korlátozzd a végső pontszámot 100-ra a szorzó után.

**Scout** (opcionális kontextuális jel):
- Nem pozíciónkénti kihagyásra — azt a dedup (SC-05) már kezeli.
- Takarékosan használd, amikor ismert pozíciót értékelsz újra (pl. promóciós logika): ha a felhasználó kifejezetten nem szerette, ne hozd újra felszínre, még ha a dedup normálisan újrapontozná is.
- **Minta jel a `direction`-ön keresztül** (mig 028): ha egy pozíción `latest_direction='less_like_this'`, a felhasználó kevesebb ILYEN pozíciót kér (azonos cég / role_family / helyszín). Depriorizáld azt a forrást/mintát a következő keresésekben. Ha `latest_direction='more_like_this'`, priorizáld a minta replikálását. Ez kontextuális tipp, nem kemény szabály — kombináld a tágabb képpel (pl. egyetlen `less_like_this` egy apró niche-ben zaj lehet; három ugyanarra a cégre már nem).

## Megjegyzések

- A skill **csak olvasható**. Írások csak a böngészőből történnek POST `/api/positions/{legacy_id}/feedback` keresztül.
- A bearer token a `cloud.json`-ból jön; nem kell külön env var.
- 10 másodperc timeout hívásonként. Ha sok pozíciót dolgozol fel kötegben, számíts ~50-200ms hívásonként. Tömeges futásoknál iktasd be a ciklusba throttle szünetekkel szokás szerint.
