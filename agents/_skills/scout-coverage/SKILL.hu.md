---
name: scout-coverage
description: "A profil nyelveinek core nemzeti portáljait keresd MINDEN kisebb forrás ELŐTT, és tudd, a terv mekkora része kész. A `next` megmondja a portált, a naplózandó országot és a lekérdezés fajtáját; egy portál 3 menettel és 3 különböző lekérdezéssel lefedett, a «kimerült» pedig lefedett core portálokat kíván. Minden keresés elején futtasd a `next`-et."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *)
---

# scout-coverage — hol keress előbb, és mennyi van meg

Előbb ott keress, ahol a profil saját piacai vannak, és tudd, mennyi van meg belőle. Egy valós futás 105 forrást kérdezett meg egyszer-egyszer, és a felhasználó nyelvének legnagyobb nemzeti portáljait soha nem nyitotta meg: a «kimerült» minősítést érintetlen hazai piaccal mondták ki. Ez a skill adja a listát (a profil minden beszélt nyelvének nemzeti portáljai, előbb a core, aztán az English-first és a remote) és a számlálót a saját menetnaplód fölött.

## 1. Kérdezd meg, mi jön ezután, minden keresésnél

A `next` egy JSON-sort ír ki: a portált (`source`, `country`, `tier`), a lekérdezés FAJTÁJÁT (`query_kind`: `role_language` = a cím a portál nyelvén, `role` = a cím angolul, `synonym` = egy rokon cím, `level` = a cím a nyelv egy szintjelölő szavával, a `level_terms`-ben felsorolva, `city` = a cím egy hellyel, a `cities`-ben felsorolva), mid van (`have`) a szükségeshez (`need`) képest, és a utána használandó `log` sort. Pontosan azt keresd, majd naplózd a menetet ugyanazzal a `--query-kind`-dal. A `plan_done: true` azt jelenti: a terv kész, mehetsz a többi forráshoz.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Szabályok

- Előbb a core, aztán a kisebbek: nincs kisebb forrás, amíg a `next` core portált nevez meg.
- Egy portál LEFEDETT 3 menettel és 3 KÜLÖNBÖZŐ lekérdezéssel (egy a portál nyelvén, ha az nem angol). Ugyanaz a lekérdezés háromszor egynek számít: a fajtát válts, ne a szavakat.
- Az a portál, amelyik 403-at, 410-et, belépési falat vagy challenge-et ad, EGY `--status closed` (410-nél `gone`) menettel LEZÁRT: mondd ki, és menj tovább, ne erőltesd.
- Az `exhausted` (`scout_exhaustion.py check`) a források, lekérdezések és percek mellett lefedett core portálokat is kíván: a `core_missing` megmondja, hová kell még menned.
- A profilból soha nem írunk semmit: a napló slugokat, országkódokat, fajtákat és számokat tartalmaz.
