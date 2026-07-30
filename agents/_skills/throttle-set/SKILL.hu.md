<!-- @translation: hu, ai-translated 2026-07-30 -->
---
name: throttle-set
description: Az EGYETLEN mod, ahogy a csapat ritmusai leirodnak. Csak a Kapitany. A `throttle-set <agent> <masodperc>` szerkeszti az agentenkenti throttle configot; a motor ujraolvassa, valahanyszor idozitot armaz, igy a valtozas magatol harap az adott agent KOVETKEZO ciklusaban - nincs tmux uzenet, egyetlen agentnek sem kell semmit ujraolvasnia, es a mar futo ciklus nem serul. Ezt hasznald ahelyett, hogy szamokat kuldenel a workereknek. Tovabba `throttle-set a=N b=M ...` egy atomi tobbszoros irashoz, `--dump` az ervenyes ertekekhez, `--get <agent>`, `--reset`.
allowed-tools: Bash(throttle-set *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle-set — a ritmusok iranyitasa az agentek megzavarasa nelkul

```bash
throttle-set <agent> <masodperc>            # egy agent
throttle-set scout-1=660 analista-1=300     # tobb, egy atomi iras
throttle-set --dump                         # a most ERVENYES ertekek
throttle-set --get <agent>                  # egy agent ervenyes erteke
throttle-set --reset                        # minden override torlese
```

## Miert nem kuldesz soha szamot tmux-on

A throttle motor **abban a pillanatban** olvassa a configot, **amikor armazza az
idozitot**. Tehat:

- egy ertek, amit itt megvaltoztatsz, magatol harap az adott agent **kovetkezo**
  ciklusaban;
- a **futo** ciklust nem erinti — a lejarata mar ki volt szamolva, es elmozditani
  olyan meglepetes lenne, amit senki nem kert;
- a workerek soha nem latnak szamot es nem tudjak, meddig varnak. Meghivjak a
  `throttle <nevuk>`-et es megallnak. Az idotartam csak a tied.

Ez az egesz letezesenek oka: ot tmux uzenet egy szammal ot alkalom arra, hogy
versenyhelyzetbe kerulj egy szunet kozepen levo agenttel. Egy atomi iras nulla.

## Amit visszakapsz, az az ERVENYES ertek, nem amit kertel

Ket automatikus korrekcio ervenyesul olvasaskor, tehat az agentre valojaban hato
szam elterhet attol, amit beirtal:

- **Worker floor, 5 perc.** A workerek (Scout/Elemzo/Scorer/Iro/Kritikus) soha nem
  mennek 300s ala, a `0`-t is beleertve. Egy mert incidensbol szuletett — egy szunet
  nelkuli Scout ~308kT-t egetett el 3 pozicio szennyezett adatert. Az interaktiv mag
  (Kapitany/Sentinella/Asszisztens/Mentor) **nem** kap floort: reaktivnak kell
  maradnia a felhasznalo chatjehez, ott tehat `0` marad `0`.
- **Koprim letra.** Minden 0-nal nagyobb ertek egy prim-perces fokra pattan
  (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60). Az 5 szorosai szerinti fokok
  *szerkezetileg* ujraszinkronizaltak a workereket: 5+10 minden 10 percben
  egybeesett. A koprim fokok a utkozeseket ritkava teszik, nem periodikussa.

Tehat a `throttle-set scout-1 120` `300`-kent olvasodik vissza. Nem az eszkoz
figyelmen kivul hagy — ez az az ertek, amit az agent el fog szenvedni, es ezt
mutatja a `--dump`.

Mindketto hattralep, amig a felhasznalo idohoz kotott derogacioja el, es a
lejaratakor maguktol visszaternek. Nem kell emlekeznek a visszaallitasukra.

## A tobb FOGYASZTAS eszkoze a parhuzamossag, nem a kisebb throttle

A workerek nem mennek 5 perc ala, tehat a «tedd a throttle-t 0-ra» szamukra nem
letezik. Ha a csapat a celritmus alatt van, adj hozza workereket **fokozatosan**;
ne probald a szunet lecsiszolasaval behozni. A telitett throttle jelzes, nem cel:
amikor egy agent mar magasan van a letran es tovabb tullep, az eszkoz a
leallitasa lesz, nem egy ujabb lokes.

## Exit codes

- `0` — megirva / beolvasva
- `1` — ervenytelen argumentumok, hatarokon kivuli ertek (0..3600), vagy nincs config

## Pelda

```bash
throttle-set --dump
# default = 0s
# scout-1        = 660s
# analista-1     = 300s

throttle-set scout-1 1380
# scout-1=1380s

# scout-1 szunet kozepen van: megtartja a 660s-et, es 1380s-et kap a kovetkezo
# ciklusban. Senki nem szolt neki semmit.
```
