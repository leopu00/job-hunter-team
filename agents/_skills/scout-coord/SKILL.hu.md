<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: scout-coord
description: Indulaskori koordinacios protokoll tobb Scout kozott. E kepesseg nelkul ket scout ugyanazt a kort (Remote EU) jarja ugyanazon a szinten (LinkedIn), es 100%-ban duplikatumokat allit elo, amelyeket a dedup gate-nek kell eldobnia — pazarolt koltsegvetes es lassabb csapat. Hasznald ELSO tevekenysegkent a ciklusodban, minden mas elott. A Scout szerephez tartozik; a SCOUT-1 altalaban dont, ha tobb scout egyszerre indul.
allowed-tools: Bash(python3 /app/shared/skills/scout_coord.py *), Bash(tmux *), Bash(jht-tmux-send *)
---

# scout-coord — a terulet felosztasa

Tobb Scout fut parhuzamosan (csapatszabalyzat szerint maximum 2 peldany). A csapat csak akkor mukodik, ha megegyeznek egy **atfedes nelkuli felosztasban**:
- melyik **koroket** birtokolja mindegyik (1 = elsdleges preferencia, 2 = foldrajzi szomszedok, 3 = koltozes, 4 = szatellit, 5 = hatar)
- melyik **forras-szinteket** birtokolja mindegyik (LinkedIn / ATS aggregatorok / resforgalom / WebSearch)

Az allapot a `scout_coord.py` altal kezelt **kozos SQLite adatbazisban** el; a scoutok inditaskor tmux-on keresztul targyalnak es ott rogzitik a megallapodast.

**Egy adatbazis, vagy semmilyen koordinacio.** Minden Scoutnak ugyanazon a fajlon kell dolgoznia — ket Scout ket fajlon nem koordinal, csak hiszi. A `scout_coord.py` a kornyezetbol oldja fel az utvonalat (`JHT_SCOUT_COORD_DB`, ha az operator deklaralt egyet, kulonben `$JHT_HOME/data/`), es letrehozza, ha hianyzik. Ha **3**-mal lep ki, az adatbazis hasznalhatatlan: jelentsd a kiirt uzenetet es ALLJ MEG. Soha ne hozz letre sajat adatbazist, es soha ne iranyitsd az eszkozt mas utvonalra.

```bash
# Melyik adatbazison dolgozom valojaban?
python3 /app/shared/skills/scout_coord.py doctor
```

## 1. lepes — Tarsak felderitese

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}' | grep -E '^SCOUT-[0-9]+$'
```

Ha te vagy az egyetlen felsorolt scout → nincs szukseg targyalasra, igenyelj mindent, amit kezelni tudsz. Ugorj a 4. lepesre.

Ha masok is fel vannak sorolva → targyalnod kell (2-3. lepes), mielott barmit scrapelnel.

## 2. lepes — Elavult allapot torlese

Ha az elozo scout-csapat a ciklus kozbeni osszeomlas utan, a `scout_coord.py` elavult hozzarendeleseket tartalmazhat, amelyek halott munkamenetekre hivatkoznak. Torold oket:

```bash
python3 /app/shared/skills/scout_coord.py reset
```

Ez egy koordinalt lepes: a **legalacsonyabb szamu elo SCOUT** (altalaban `SCOUT-1`) vegzi a resetelest, a tobbiek varnak. Jelentsd be tmux-on:

```bash
jht-tmux-send SCOUT-2 "[@$MY_ID -> @scout-2] [INFO] resetto scout_coord, attendi 5s prima di assign"
```

## 3. lepes — Targyalas tmux-on keresztul

Nyiss egy rovid beszelgetest (maximum 3-5 uzenet) minden tarssal. Javasolj egy felosztast:

```
[@scout-1 -> @scout-2] [REQ] proposta: io prendo cerchi 1+2 + tier 1-2 (LinkedIn, ATS).
Tu cerchi 3+4 + tier 3-4 (niche board + WebSearch). OK?
```

A tars `[ACK]`-kal (elfogadas) vagy `[COUNTER]`-rel (ellenajanlat) valaszol. Tartsd rovidre — ha 3 fordulo alatt nem tudtok megegyezni, eszkalald a Capitano-hoz.

**Heurisztikak a jo felosztashoz**:

| Helyzet                                         | Javasolt felosztas                                                 |
|-------------------------------------------------|--------------------------------------------------------------------|
| 2 Scout, profil `work_mode = remote`           | S1: cerchi 1-2 + LinkedIn/ATS · S2: cerchi 1 + resteruleti nis board (RemoteOK, WeWorkRemotely) — mindketto cerchio 1-ben, komplementer forrasok |
| 2 Scout, profil `work_mode = on-site`          | S1: bazisvaros + cerchio 2 regionalis · S2: koltozes (cerchio 3) |
| 2 Scout, vegyes `work_mode = flessibile`       | S1: cerchi 1-2 (teljes mod) · S2: cerchi 3-5 (koltozes + szatellit + hatar) |

Barmelyik felosztast is valasztod, a szabaly: **ket scout nem lehet ugyanazon (kor, szint-keszlet) kombinacion egyidoben.**

**Mennyiseg vs. kuralt felosztas — empirikus adat a VPS1 2026-05-21-es futasbol (vps1-run-postmortem #14):**

> Scout-1 130 poziciot talalt atlagos score-ral 63,1 (40% high-score)
> Scout-2 76 poziciot talalt atlagos score-ral 68,4 (54% high-score)
>
> → Scout-2 1,4×-szer minosegiesebb volt, mint Scout-1 ugyanannal a jeloltnel.

Ajanlott minta, amikor szabadon valaszthato a szint a 2 scoutnak:

| Scout    | Kijelolt szint                                          | Indoklas                                       |
|----------|---------------------------------------------------------|------------------------------------------------|
| SCOUT-1  | LinkedIn (nagy volumen, zajos)                          | Befogja az aramlast, elfogadja az alacsonyabb score-t |
| SCOUT-2  | Ashby / Greenhouse / Lever / company-careers (kuralt)   | Keves de talalo, magasabb atlag score          |

A `next-for-analista` ezutan egy kiegyensulyozott kevereket kap volumen + minoseg, es az Analiszt hard-requirements szuroje (RULE-06) a Scout-1 streamre osszpontosit (ahol tobb a zaj). Ez nem merev szabaly — igazitsd a `work_mode`-hoz a fenti tabla szerint.

## 4. lepes — Hozzarendeles veglegesitese

Miutan te es a tarsaid megegyeztetek, rogzitsd a felosztast:

```bash
python3 /app/shared/skills/scout_coord.py assign $MY_ID \
    --cerchi "<hozzad rendelt korok, pl. 1,2>" \
    --fonti "<hozzarendelt forras slug-ok, vesszivel elvalasztva, pl. linkedin,greenhouse,lever>"
```

Minden scout a sajat sorat irja. A script kikenyszeriti az atfedes-mentesseget a forras-slug-oknal, igy ha ket scout egyszerre probalja igenyeli a `linkedin`-t, a masodik sikertelenul jar — a vesztes ujra kell targyaljon.

## 5. lepes — Ellenorzes

```bash
python3 /app/shared/skills/scout_coord.py show
```

Vart kimenet: soronkent egy elo scout a `cerchi` es `fonti` ertekeivel. Ha a te sorod hianyzik, az `assign` csendben sikertelen volt — ismeteld meg a 4. lepest.

Keresztellenorzes: az osszes `fonti` uniojanak le kell fednie azokat a szinteket, amelyeket a csapat tenylegesen scrapelni akar ma. Ha egy szinten nulla scout van (pl. senki sincs `niche-remote`-on), ertesitsd a Capitano-t:

```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [INFO] scout-coord: tier 'niche-remote' senza scout, considera spawn aggiuntivo o riassegnamento."
```

## Anti-mintak

- ❌ Az 1. lepes kiagyasa ("csak en vagyok") ellenorzes nelkul — egy tars eppen most lehetett ujraindiva a Dottore altal.
- ❌ Resetelest minden scout parhuzamosan vegez — versenyhelyzet, az adatbazis serult lesz. Csak a legalacsonyabb szamu scout.
- ❌ Targyalas, majd a 4. lepes elfelejtese — az adatbazis ures, a tarsak nem latjak az igenyedet, ket scout ugyanarra a forrasra megy.
- ❌ `linkedin` ES `greenhouse` ES `lever` ES `remoteok` ES `weworkremotely` ES `webresearch` igenyeles "biztonsag kedveert" — semmi marad a tarsnak, annak nincs dolga.
- ❌ Ujratargyalas a ciklus kozepen kivaito ok nelkul — a felosztas inditaskori. Ha egy tars meghal, a Dottore ugyanazzal a szereppel ujrainditja; csak maga a SCOUT olvassa ujra a `cerchi`/`fonti` erteket inditaskor.

## Mikor kell ujratargyalni

Csak ezeknel a kivaltoknal:
- Egy uj SCOUT eppen elindult (latsz egy `SCOUT-N+1`-et a `tmux list-sessions`-ben, ami nem volt ott az inditasodkor)
- Egy SCOUT meghalt es NEM lett ujrainditva (kapacitas csokkent, oszd ujra a szintjet)
- A Capitano kifejezetten ujrafelosztast rendel (ritka, pl. az Analiszt `[FEEDBACK]`-je utan, miszerint egy szint kovetkezetesen halott linkeket general)

Mindharom esetben: rovid tmux-csere, majd ujra `assign` uj parameterekkel. Nincs szukseg `reset`-re, hacsak a JSON nem lathatolag serult.

## Lasd meg

- `circles-and-sources` — az 5 cerchi + 4 fonti szint tenyleges definicioja (ez a skill irja le HOGYAN kell felosztani; az irja le MIT kell felosztani).
- `position-insert` — mit csinal minden Scout, miutan megvan a hozzarendelese.
- `agents/_manual/anti-collision.md` — a szeles korben alkalmazott anti-utkozes szerzodes, amelyet ez a skill a Scout szerepre implemental.
- `tmux-send` — uzenetformat a targyalashoz.
