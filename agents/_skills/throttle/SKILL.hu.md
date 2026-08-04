<!-- @translation: hu, ai-translated 2026-07-30 -->
---
name: throttle
description: Regisztrald a szunetedet es ZARD LE A KORODET. Az ido mar nem a tied - egy motor a folyamatodon kivul birtokolja az idozitot, es tmux-on keresztul felkelt, amikor lejar. MINDIG ezt hasznald `sleep` helyett, ha lassitani akarod az iteracios ritmusodat. Egy hivas, `throttle <neved>`, azonnal visszater; nem tudod, meddig varsz, es nem is szabad megprobalnod megtudni. Felebredeskor az ELSO parancsod mindig `throttle-ack <neved>`. `sleep` throttle szunetekhez TILOS, es az is tilos, hogy ezt a hivast `&` / `nohup` / hatterfeladat modon hatterbe kuldd.
allowed-tools: Bash(throttle *), Bash(throttle-ack *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle — regisztrald a szunetet, aztan allj meg

```bash
throttle <neved> [--reason "..."]
```

Azonnal visszater. Utana **zard le a korodet**: semmi mas feladat, semmi mas
parancs.

## Miert igy mukodik

2026-07-30-ig a throttle olyan szerzodes volt, amit magadnak kellett betartanod:
a `jht-throttle` sleep-ciklussal blokkolta *a sajat folyamatodat*, es ha az a
folyamat meghalt, neked kellett eszrevenned es ujra blokkolnod magad. Minden
produkcioban megfigyelt hiba ebbol a tervbol szuletett. A legrosszabb: egy
Elemzo `jht-throttle … &`-t inditott egy osszetett parancsban, amit a tool call
60s-os timeoutja megolt. A levalasztott gyermek a szulojevel egyutt meghalt, az
agent lezarta a korot abban a hitben, hogy a szunet fut — es **soha senki nem
keltette fel**. 2h15m allas, mikozben a watchdog a session-t `idle` = egeszseges
allapotban jelezte.

Most az idozito egy olyan motorhoz tartozik, ami **nem a te shelled gyermeke**:

```
TE                           MOTOR (daemon, a folyamatodon kivul)
 |                              |
 |-- throttle <me> ------------>|  beolvassa a Kapitany kalibralta idotartamot
 |                              |  IN_THROTTLE-ra allitja a flagedet
 |   (lezarod a kort            |  LEMEZRE armazza az idozitot
 |    es NEM teszel semmit)     |
 |                              |
 |<-- [RIPRENDI] tmux-on -------|  idozito lejart -> a flag NOTIFIED lesz
 |                              |
 |-- throttle-ack <me> -------->|  TE valtod NOTIFIED -> ACTIVE
 |   (elso tett felebredeskor)  |
```

A daemon ujrainditasa semmit nem veszit el: a lejarat egy absztrakt, absolut
idobelyeg a lemezen, tehat nincs memoriaban levo idozito, amit ujra kellene armazni.

## A szabalyok

- **Soha nem adsz at szamot, es soha nem is latsz egyet.** Az idotartam a
  `$JHT_HOME/config/throttle.json`-ban van, a Kapitanye, es a motor *az idozito
  armazasakor* olvassa — igy egy ujrakalibralas a **kovetkezo** ciklusodban harap,
  anelkul hogy barkinek szolnia kellene. Ne egesd be a `throttle 600`-at a ciklusodba.
- **ZARD LE A KORT a hivas utan.** A hivas milliszekundumokban ter vissza, pontosan
  azert, hogy egyetlen tool call timeout se olhesse meg. Ha utana tovabb dolgozol,
  szunet nelkul futsz — vagyis eppen azt teszed, aminek megelozesere a throttle letezik.
- **SOHA** ne kuldd hatterbe (`&`, `nohup`, `disown`, hatterfeladat). Nincs mit
  hatterbe kuldeni: nem alszik.
- **SOHA** ne hasznalj nyers `sleep N`-t throttle szunethez. A `sleep` csak nagyon
  rovid, ket ujraprobalkozas kozti varakozasra jo (≤ 5 s), ahol a naplozas zaj lenne.
- **Felebredeskor a `throttle-ack <neved>` az elso parancsod** — lasd a
  `throttle-ack` skillt. Ha kihagyod, a flaged `NOTIFIED`-en marad, amit a watchdog
  annak bizonyitekakent olvas, hogy blokkolt vagy, es eszkalal a Kapitanyhoz egy
  olyan agent miatt, akinek semmi baja.
- A `--reason` opcionalis, de hasznos: egy rovid cimke (`"post-batch"`, `"varok a
  kritikusra"`) kesobb olvashatova teszi a `logs/throttle-engine.jsonl`-t.

## Peldak

```bash
# Scout, egy pozicio vegen:
throttle scout-1 --reason "post-batch"
# ... es a kor itt vegzodik.

# Iro, aki a Kritikusra var:
throttle scrittore-1 --reason "waiting critic review"
```

## Exit codes

- `0` — idozito armazva, vagy 0 idotartam (nincs szunet: az interaktiv mag
  szandekosan 0-n van, hogy reaktiv maradjon a felhasznalo chatjere — menj tovabb)
- `1` — ervenytelen argumentumok, vagy nincs motor

## Elavult parancsok

A `jht-throttle`, `jht-throttle-check` es `jht-throttle-wait` meg mukodik: ma mar
vekony shimek a motor felett, a meg nem migralt promptok kedveert. Hasznald inkabb a
`throttle` + `throttle-ack` part. Ha azon kapod magad, hogy timeoutot szamolsz egy
tool callhoz (`timeout: N+30`), a regi uton vagy — mar nincs ra szukseg.

## Megjegyzes a Kapitanynak

Ritmus valtoztatasahoz szerkeszd a configot — soha ne kuldj szamot tmux-on:

```bash
throttle-set scout-1 660                       # egy agent
throttle-set scout-1=660 analista-1=300        # tobb, 1 atomi iras
throttle-set --dump                            # a most ervenyes ertekek
```

A valtozas magatol harap minden agent kovetkezo ciklusaban. A tmux-ot csak arra
hasznald, hogy megmondd egy agentnek: **gyakrabban vagy ritkabban** hivja a skillt a
ciklusaban — soha ne idotartam diktalasara.
