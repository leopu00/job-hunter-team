<!-- @translation: hu, ai-translated 2026-07-30 -->
---
name: throttle-ack
description: Ird ala a felebredesedet. MINDIG minden felebredes ELSO parancsa, minden mas elott, valahanyszor `[RIPRENDI]` uzenetet kapsz egy throttle szunet utan. A `throttle-ack <neved>` NOTIFIED-rol ACTIVE-ra valtja a flagedet. Csak te tudod megtenni - a motor nem - es pontosan ezert egy NOTIFIED-en maradt flag annak bizonyiteka, hogy egy agent megkapta a felkeltest es nem valaszolt, es ezert eszkalal ra a watchdog. Ha kihagyod, egy tokeletesen egeszseges agent blokkoltnak fog tunni.
allowed-tools: Bash(throttle-ack *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle-ack — ird ala a felkeltest, aztan vissza a munkahoz

```bash
throttle-ack <neved>
```

Minden felebredes elso parancsa. Utana **azonnal vissza a ciklusodba** — az ack
alairas, nem jelentes.

## Miert te es nem a motor

A throttle motor a harom allapotbol kettot irja: `IN_THROTTLE`, amikor szunetet
regisztralsz, `NOTIFIED`, amikor tmux-on elkuldte a felkeltest. Az utolso lepes,
a `NOTIFIED → ACTIVE`, **csak a tied**.

Ez az aszimmetria a lenyeg. A rendszer minden watchdogja ugyanazon vakfoltban
osztozik: egy tmux pane-t nezve az `idle` es a `blokkolt` megkulonboztethetetlen.
Az alairasoddal megszunnek annak lenni:

| flag | jelentes | anomalia, ha tart |
|---|---|---|
| `IN_THROTTLE` | jogos varakozas | nem — a motor tudja, mennyi |
| `NOTIFIED` | felkeltes elkuldve, ack varva | **igen → eszkalacio N perc utan** |
| `ACTIVE` | dolgozol | a DB-be tett munkaddal merik |

Egy `NOTIFIED`-en megallt flag nem azt jelenti, hogy «talan idle»: a felkeltes
megerkezett es senki nem valaszolt. Ez meres, nem feltetelezes, es a watchdog
eszkalalja a Kapitanyhoz.

## A szabalyok

- **Elso parancs, mindig.** A varolistad elolvasasa elott, barmely tool elott,
  mielott barkinek valaszolnal.
- **A daily halt felulirja a felkeltest.** A parancs az ack-kel egyutt ellenorzi
  a `$JHT_HOME/logs/daily-halt.flag` fajlt. `DAILY_HALT_ACTIVE` eseten ne
  dolgozz es ne irj a Kapitanynak: zard le a kort. A motor tovabbra is
  elesen tartja az idozitot, es a flag eltunese utan felkelt.
- **Utana azonnal dolgozz.** Alairni es aztan tetlenul allni hamis «ures
  varolistat» hoz letre, ami megteveszti a Kapitanyt es a pacinget. A felkeltes
  jelzes a *munkara*.
- **Ne hasznald arra, hogy korabban zard le a szunetet.** A meg futo idozito
  kozben elkuldott ack elutasitasra kerul (exit 1): ha barmikor lezarhatnad a
  flaget, a throttle ujra olyan dolog lenne, amirol te dontesz.
- Nem kell tudnod, meddig aludtal, es a parancs nem is mondja meg.

## Exit codes

- `0` — a flag `ACTIVE` (idempotens: ketszer alairni artalmatlan)
- `1` — az ack **elutasitva**, mert a szunet nem ert veget vagy daily halt aktiv:
  zard le a korodet; a motor felkelt. Vagy ervenytelen argumentumok / nincs motor.

## Pelda

```
[DA @SISTEMA A @SCOUT-1] [RIPRENDI] La tua pausa è finita. PRIMO comando: `throttle-ack scout-1`...
```

```bash
throttle-ack scout-1
# THROTTLE_ACK agent=scout-1 NOTIFIED→ACTIVE
```

...es a kozvetlenul kovetkezo dolog, amit teszel, a kovetkezo munkaegyseged.
