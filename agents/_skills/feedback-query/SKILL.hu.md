<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Felhasználói visszajelzést olvas (like/dislike/hide/star) a felhőből — pozíciónként vagy időablakra összesítve. A Scorer csak jövőbeli pozíciók kontextuális preferenciajeleként használja, az aktuálisat kizárva; a Mentor visszatérő indokokat számol (F minta), a Scout kontextuális jelként használja. Elérhetetlen felhőnél semleges "nincs jel" payloadot ad.
allowed-tools: Bash(python3 *)
---

## Raw/display határ (`RAW_DISPLAY_BOUNDARY`)

A `reason` és `comment` nyers, csak gépi bemenet. Soha ne idézd, továbbítsd, foglald össze vagy mutasd meg őket a felhasználónak. Minden user-facing jegyzet vagy üzenet kizárólag a `display_reason` / `display_comment` mezőket használhatja; a témák `label` / `examples` mezői már ugyanazon közös sanitizeren mentek át. A `note` csak zárt `no-signal:*` enum: elérhetőségi állapotként kezeld, soha ne infrastruktúra-részletként.

# feedback-query — Felhasználói visszajelzés pozíciónként

A felhasználó like/dislike/hide/star-t kattinthat bármelyik pozícióra a webes dashboardról. Ezek a kattintások a Supabase `position_feedback`-ben tárolódnak (mig 019 alap + mig 028 kiterjesztett) és ezen a skill-en keresztül érhetők el az ágensek számára. Séma:

| Oszlop              | Típus   | Jelentés |
|---------------------|---------|----------|
| `position_legacy_id`| TEXT    | A pozíció `legacy_id`-je (string) a `positions`-ben |
| `action`            | TEXT    | `like`, `dislike`, `hide`, `star`, `clear` egyike (mig 059 — a felhasználó visszavonja az ítéletet; az utolsó esemény nyer, tehát egy záró `clear` azt jelenti: "nincs ítélet") |
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
     "display_reason": "too senior", "display_comment": "5+ evi Java szükseges, nem erdekel a legacy stack",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "display_reason": null,
     "display_comment": null, "score": null, "direction": null}
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
 "note": "no-signal:cloud-disabled"}
```

## Összesített olvasás (időablak az összes pozícióra)

Egyetlen HTTP-hívás N helyett: `GET /api/positions/feedback?days=&limit=`, ugyanaz a bearer token, ugyanaz a semleges tartalék.

```bash
# Az ablak összes visszajelzés-eseménye, a legfrissebbtől
python3 /app/shared/skills/feedback_query.py recent --days 30

# A felhasználó írta indokok, hasonlóság szerint csoportosítva
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

A `themes` kimenete:

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

Hogyan működik a csoportosítás (nem kell pontos egyezés, nincs új függőség): kisbetűsítés → ékezetek le → írásjelek ki → funkciószavak ki → minden szó az első 5 karakterére vágva (`senior` / `seniority` / `seniore` / `séniorité` egyetlen kulcsra esik) → egyedülálló szavakat és **szomszédos párokat** számolunk, **külön pozíciónként**, nem események szerint. Egy pár elnyeli a részeit, ha ugyanazon pozíciók ≥ 80%-át lefedi, így a "túl senior" nyer a "senior" ellen; az erősítő szavak szándékosan bennmaradnak a folyamban. A `reason` és a `comment` külön tokenizálódik, így nem születik pár a kettő határán.

Szándékos korlátok, kimondva, hogy senki ne olvasson többet a számokba, mint ami bennük van:
- A távoli szinonimák külön maradnak (a `fizetés` és a `RAL` két téma) — ez szószámolás, nem szemantika. A sanitizált display `examples` mezőket olvasd (max. 3), és fejjel kösd össze.
- Azok a pozíciók, amelyek **utolsó** eseménye `clear`, kimaradnak (az ítéletet visszavonták); az `--include-cleared` visszahozza őket.
- `share` = a téma pozíciói / `positions_with_text`.
- `--field reason|comment|both` (alapértelmezés `both`), `--top N`, `--days 0` a teljes történetre.
- Tartalék, ha az összesített végpont nem válaszol: `--legacy-ids 12,13,14` egyesével olvassa azokat a pozíciókat (lassabb, azonos kimeneti formátum).

Kapcsolók: `--days` (alap 30, `0` = minden), `--limit` (alap 500 esemény), `--min-positions` (alap 3), `--text-chars` a `recent`-en (alap 300, vágja a hosszú megjegyzéseket).

Ha a payload zárt `note` enumot hoz (`no-signal:*`), nincs összesítés. Kezeld úgy, hogy "nincs adat", soha ne úgy, hogy "nincs visszajelzés", és a kódot ne továbbítsd.

## Hogyan használják az ágensek

**Scorer — `FUTURE_FEEDBACK_ONLY`:** hívd a `themes --days 30 --min-positions 1 --top 10 --exclude-legacy-id <legacy_id>` parancsot. Csak a sanitizált `label` / `examples` mezőket használd kontextuális preferenciajelként ehhez a jövőbeli pozícióhoz. A már értékelt pozíció feedbackje soha nem módosít score-t, statust vagy jegyzetet: nincs fix bónusz/malusz, feedback marker vagy backfill. A meglévő score-ok változatlanok. Az O-70 explicit újraértékelés külön, felhasználó által kért folyamat.

**Mentor** (F minta, csak olvasás): `themes` az elmúlt 30 napra, hogy megszámolja a felhasználó által írt indokokat. A küszöbök és az értelmezés a `mentor-patterns` skillben élnek. A Mentor **a felhasználóhoz** beszél — ebből az adatból soha nem ad keresési utasítást.

**Scout** (opcionális kontextuális jel):
- Nem pozíciónkénti kihagyásra — azt a dedup (SC-05) már kezeli.
- Takarékosan használd, amikor ismert pozíciót értékelsz újra (pl. promóciós logika): ha a felhasználó kifejezetten nem szerette, ne hozd újra felszínre, még ha a dedup normálisan újrapontozná is.
- **Minta jel a `direction`-ön keresztül** (mig 028): ha egy pozíción `latest_direction='less_like_this'`, a felhasználó kevesebb ILYEN pozíciót kér (azonos cég / role_family / helyszín). Depriorizáld azt a forrást/mintát a következő keresésekben. Ha `latest_direction='more_like_this'`, priorizáld a minta replikálását. Ez kontextuális tipp, nem kemény szabály — kombináld a tágabb képpel (pl. egyetlen `less_like_this` egy apró niche-ben zaj lehet; három ugyanarra a cégre már nem).

## Megjegyzések

- A skill **csak olvasható**. Írások csak a böngészőből történnek POST `/api/positions/{legacy_id}/feedback` keresztül.
- A bearer token a `cloud.json`-ból jön; nem kell külön env var.
- 10 másodperc timeout a `check`-en, 20 az összesített híváson. Ha sok pozíciót dolgozol fel `check`-kel, számíts ~50-200ms-ra hívásonként — pontosan ezt hivatott elkerülni a `recent` / `themes`.
- Az összesítés szerveroldalon a felhasználóra szűkített: ennek a felhasználónak a visszajelzését adja vissza és semmi mást.
