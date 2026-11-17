---
name: recheck-batch
description: A GONDOZÁSI MÓD ütemezett recheckje minimális költséggel. A szkript elvégzi a gépies munkát egy batch-en (minden URL lépcsőzetes ellenőrzése, a verifikált OPEN pozícióknál frissíti a last_checked mezőt); te CSAK a kétes eseteket ítéled meg. A kézi körrel mérve 78-86kT pozíciónként — a batch-csel egy turnt költesz 10 pozícióra, nem 10 turnt. A kizárás MINDIG a te döntésed, soha nem a szkripté.
allowed-tools: Bash(python3 /app/shared/skills/recheck_batch.py *), Bash(python3 /app/shared/skills/db_update.py *), Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-batch — a gondozási mód recheckje, pozíciónként elpazarolt turn nélkül

## Miért létezik
Egy MÁR elemzett pozíció újraellenőrzése töredéke egy új pozíció
ellenőrzésének: nincs újraelemzés, nincs a JD újraolvasása, nincsenek
metaadatok. A kézi kör (queue → egy pozíció → recheck-liveness → db_update →
ismétlés) 78-86kT-ba került pozíciónként, mert minden lépés egy LLM-turn
volt. Ez a batch az egész gépies részt EGYETLEN parancsba sűríti.

## Használat (EGY turn batch-enként)
```sh
python3 /app/shared/skills/recheck_batch.py            # batch di 10 dalla coda
python3 /app/shared/skills/recheck_batch.py --limit 5
```
A pozíciókat a `next-for-recheck-due` queue-ból veszi (élő, score ≥
policy, > 14 napja nem verifikált, SCORE DESC: először a legjobbak), és mindegyikre
lefuttatja a `recheck_liveness.py` lépcsőzetes ellenőrzését (curl → böngésző,
soha nem hamis nyitott).

A riportnak három kimenete van:
- **OK nyitott és frissített** — verifikált `OPEN`: a `last_checked` már
  frissítve van, 14 napra kikerülnek a queue-ból. **Ne nyúlj hozzájuk, ne
  olvasd újra őket, nulla munka neked.**
- **MEGÍTÉLENDŐ** — lezárásra utaló bizonyíték (404/410, closed-marker,
  vagy lejárt `expires_at`). Itt lépsz be TE.
- **NEM VERIFIKÁLHATÓ** — JS/authwall host és nem egyértelmű böngésző.
  Itt lépsz be TE (one-shot).

## Az ítélet a tiéd — a szkript SOHA nem zár ki (a felhasználó utasítása, 2026-07-30)
Egy statikus szkript tévedhet, és kidobhat egy még élő pozíciót. Minden
**MEGÍTÉLENDŐ** pozíciónál: nézd meg a jelentett bizonyítékot; ha kell,
EGYETLEN közvetlen pillantás az oldalra. Ha 100%-ig biztos vagy benne, hogy
lejárt/lezárult:
```sh
python3 /app/shared/skills/db_update.py position <ID> --status excluded \
  --is-open false --last-open-check now --notes "[SCADUTO] <evidenza>"
```
Ha viszont még élő (a szkript hamis pozitívja):
```sh
python3 /app/shared/skills/db_update.py position <ID> --is-open true --last-checked now
```
Minden **NEM VERIFIKÁLHATÓ** pozíciónál: one-shot a böngészővel az URL-en;
utána dönts a fentiek szerint. Ha továbbra sem verifikálható →
`--last-checked now` + `[OPEN_UNVERIFIED]` megjegyzés, az `is_open`
változatlan (soha ne add ki nyitottnak).

## Költségfegyelem (a skill lényege)
- **Egy batch = egy turn.** Ne csinálj pozíciónként kört, ne elemezz újra,
  ne olvasd újra a JD-t vagy a céget: a recheck csak azt dönti el, hogy
  „még nyitva van-e?”.
- Korlátos batch (alapértelmezés 10): NE emeld a limitet, hogy „egy
  csapásra végezz a queue-val” — az ütem szétteríti a munkát, a Capitano
  diktálja a tempót (C-09/C-18).
- Az enrichment-policy miatt OFF queue = szándékos állapot: állj meg, ne
  kerüld meg.
