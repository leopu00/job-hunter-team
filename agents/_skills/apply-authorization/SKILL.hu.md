<!-- @translation: hu, ai-translated 2026-09-13 -->
---
name: apply-authorization
description: A két kapu a csapat és egy recruiter postafiókja között, és hogyan olvasd az elutasításaikat. Egy jelentkezés CSAK akkor megy ki, ha a felhasználó általános hozzájárulást adott (`applications.auto_apply` a felhasználói configban) ÉS megjelölte éppen azt a pozíciót. Mindkettő fail-closed, és a kódban az `apply_gate.py` ellenőrzi. Használd bootoláskor és minden pozíció előtt a CLOSER queue-jának olvasásához, és valahányszor meg kell magyaráznod, miért nem ment ki egy pozíció. A CLOSER-é; a Capitano ugyanezt a queue-t olvassa, hogy eldöntse, elindítja-e.
allowed-tools: Bash(python3 /app/shared/skills/apply_gate.py *)
---

# apply-authorization — mi mehet ki, és a többi miért nem

Egy jelentkezés csak akkor hagyja el a boxot, ha **két** feltétel teljesül. Hiányzó,
hibás vagy fel nem ismert érték mindig **nem**-et jelent.

| # | Feltétel | Hol van | Ki állítja be |
|---|---|---|---|
| 1 | általános hozzájárulás | `applications.auto_apply.enabled = true` a `$JHT_HOME/jht.config.json`-ban | a felhasználó, aktiváláskor |
| 2 | pozíciónkénti engedély | `positions.apply_requested = 1`, `apply_requested_at`-tel és `apply_requested_by` = `user_web` / `user_local` értékkel | a felhasználó, azon a pozíción |

A felhasználó flagje **maga** az engedély a küldésre. Nincs második kérdés.

## A queue — egy parancs, két szerep olvassa

```bash
python3 /app/shared/skills/apply_gate.py queue --json
```

Exit `0` csak akkor, ha most kimehet valami; különben exit `1`. A JSON:

| Mező | Jelentés |
|---|---|
| `ready` | `true` = legalább egy pozíció most felvehető |
| `reason` | stabil token, lásd lent |
| `mode` | `authorised` (küld) vagy `dry_run` (diagnosztika, kitölt és a gomb előtt megáll) |
| `max_per_day` / `sent_today` / `remaining_today` | a CLOSER által ma küldöttek, és a napi limit, ha a felhasználó beállított egyet (null = nincs limit, szám miatt semmit nem utasítunk el) |
| `positions` | amit felvehetsz, engedélyezési sorrendben: `position_id`, `url`, `cv_pdf_path` |
| `held` | engedélyezett pozíciók, amelyeket most NEM szabad felvenni, mindegyik a saját `reason`-jével |

A CLOSER a `positions` első elemét veszi. A Capitano csak akkor indítja a
CLOSER-t, ha a parancs `0`-val lép ki.

## Miért zárt a queue (`reason`)

| Token | Jelentés | Teendő |
|---|---|---|
| `config_missing` / `config_unreadable` / `config_malformed` | a felhasználói config nem olvasható | semmi: hozzájárulás nem állapítható meg |
| `consent_absent` / `consent_disabled` | a felhasználó nem járult hozzá | semmi. Soha ne javasold a bekapcsolását (RULE-T18) |
| `consent_mode_unknown` / `consent_cap_invalid` | a blokk létezik, de egy értéket nem ismer fel | semmi: a kapu elutasít, nem találgat |
| `db_unavailable` / `queue_unreadable` | a helyi adatbázis nem olvasható | `[BLOCKED]` a Capitanónak |
| `queue_empty` | egyetlen engedélyezett pozíció sem vehető fel | lépj ki |
| `daily_cap_reached` | a felhasználó beállította a `max_per_day`-t, és a CLOSER ma már ennyit elküldött (limit nélkül soha) | lépj ki; a queue holnap újranyílik |

## Miért van visszatartva egy pozíció (`held[].reason`)

| Token | Jelentés |
|---|---|
| `already_submitted` | a jelentkezés már kiment (`applied`/`response` státusz, vagy az application sor szerint applied). A flag küldés után is bekapcsolva marad: nem új kérés |
| `position_not_authorised` | a flag ki van kapcsolva (a felhasználó visszavonta) |
| `authorisation_undated` | a flagnek nincs időbélyege |
| `authorisation_not_from_user` | a flaget nem felhasználói csatorna állította be. Egy folyamat által bekapcsolt flag nem engedély |
| `url_missing` / `cv_pdf_missing` | nincs mivel kitölteni az űrlapot |
| `checkpoint_blocked_human` | a folyamat már megállt ezen a pozíción és megkérdezte a felhasználót. Csak akkor tér vissza, ha a felhasználó újra engedélyezi |
| `checkpoint_dry_run` | diagnosztikai módban már kitöltve |
| `checkpoint_unreadable` | a folyamat checkpointja nem olvasható: bizonytalanság, tehát nem |

## Egy pozíció, egy ítélet

```bash
python3 /app/shared/skills/apply_gate.py position <ID> --json
```

`allowed: true` csak `reason: apply_allowed` mellett. Ez ugyanaz az ellenőrzés,
amit az `apply_flow.py` induláskor és közvetlenül a kattintás előtt újra lefuttat.
Nem kell a folyamat előtt futtatnod; egy elutasítás magyarázatára használd.

## Szabályok

- **Soha ne írd az engedélyt.** Az `apply_requested*` a felhasználóé.
- **Soha ne kerülj meg egy elutasítást.** A zárt kapu a válasz, nem akadály.
- **Soha ne kérd a felhasználót, hogy többet engedélyezzen.** A csapat egyetlen
  jelentkezés nélkül is teljes (RULE-T18).
