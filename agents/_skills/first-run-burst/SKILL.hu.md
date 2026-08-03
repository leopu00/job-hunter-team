<!-- @translation: hu, ai-translated 2026-08-03 -->
---
name: first-run-burst
description: "Az első fél óra, amikor egy vadonatúj felhasználó egyáltalán látja dolgozni a csapatot. Akkor nyisd meg ezt a skillt, amikor `[PROFILO-PRONTO]`-t kapsz az Assistentétől, vagy ébredéskor, ha a `first_run.py status` `awaiting_profile` / `burst` fázist jelent. Kizárólag az első ablakra felülírja a fokozatos kalibrációt (C-02), és a sikert a képernyőn megjelenő, PONTOZOTT pozíciókként definiálja — nem megtalált pozíciókként."
allowed-tools: Bash(python3 /app/shared/skills/first_run.py *), Bash(python3 /app/shared/skills/plan_registry.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(/app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *), Bash(jht-send *)
---

# first-run-burst — a bemutató, amin múlik, hogy a felhasználó marad-e

Egy új felhasználó befejezi a setupot, bekapcsolja a csapatot, és nézi. Tíz perccel később **egy**
nyers pozíciót látott megjelenni. Semmi nem segít neki megkülönböztetni a magát adagoló csapatot egy
elromlott alkalmazástól — tehát arra jut, hogy elromlott, és nem gondolkodik rosszul.

A szokásos kalibrációd (C-02: egy worker, figyeld 30 percig, lépj egy fokot) **állandósult üzemben**
a helyes szabály, ahol a tévedés egy budget-ablakba kerül. Az első indításnál a felhasználóba kerül.
Ez a skill a dokumentált kivétel, és **csak az első ablakra** érvényes.

## Trigger

- `[@assistente -> @capitano] [PROFILO-PRONTO]` — a profil épp használhatóvá vált
- ébredéskor, ha a `python3 /app/shared/skills/first_run.py status`
  `phase: awaiting_profile` vagy `phase: burst` fázist jelent

## Mit jelent itt a siker

**Pontszámmal ellátott pozíciók a képernyőn.** Nem megtalált pozíciók. Egy olyan futás, amely 50
ajánlatot gyűjt be, és hármat pontoz belőlük (mért adat, 2026-07-26), szinte semmi olyat nem
állított elő, amit a felhasználó látna: a shortlist a termék, a scraping csak vízvezeték. Minden, ami
alább következik, ebből az egy mondatból ered.

## Az eljárás

**1. Nyisd meg a burstöt, és olvasd ki a rostert.**

```bash
python3 /app/shared/skills/first_run.py begin-burst
```

Visszaadja a `roster`-t (hány Scout / Analista / Scorer), a `scout_cap_first_pass` és a
`target_scored` értékét, mind abból az előfizetésből származtatva, amelyet a felhasználó a setup
során megadott. Ha a válasz `piano non dichiarato` (nincs megadva előfizetés), a setup lépés hiányos:
mondd meg a felhasználónak a chatben, és állj meg — **ne találgass** rostert, egy túlbecslés már az
első napon elégeti az ablakát.

**2. Spawnold az egész rostert, ~60 másodperces eltolással.**

Nem tíz percenként egy workert: az egész felállást, egymás után, ahogy mindig, a `start-agent.sh`-n
keresztül (C-03). Ez a C-02 alóli szándékos kivétel.

**3. Ne várj tele sorokra, hogy elindítsd a downstreamet.**

Spawnold az Analistát, amint **egy** pozíció létezik, a Scorert, amint **egy** pozíció checked. Az
"előbb gyűjtök, aztán értékelek" szokás pontosan az, ami egy rakás pontszám nélküli sor elé ülteti a
felhasználót.

**4. Tegyél plafont az első sourcing-körre.**

Közöld minden Scouttal a `scout_cap_first_pass`-ből rá eső részt, és hogy jelezzen, amikor eléri —
ahelyett, hogy addig keresne, amíg a budget bírja. A plafon fölötti pozíciók még semmit sem érnek:
azok mögé sorakoznak fel, amelyeket senki nem pontozott.

**5. Jelents korán, ne kész munkánál.**

Amint az első ~3 pozíciónak van pontszáma, küldj a felhasználónak egy rövid `jht-send`-et arról,
hogy mik ezek — ez az a pillanat, amikor az alkalmazás megszűnik elromlottnak látszani. Utána haladj
tovább a `target_scored`-ig.

**6. Zárd le a burstöt.**

```bash
python3 /app/shared/skills/first_run.py check
```

Futtasd minden `[HEARTBEAT]`-nél. Amikor átvált `steady`-re, visszakerültél a rendes szabályok alá —
a C-02 kalibrációval együtt.

## A sebességet itt is te kezeled — a bridge csak tanácsot ad

A `pace_guard` a bridge minden mintavételénél az ablak görbéjéhez méri a fogyasztást, és beír a
pane-edbe egy `[PACE-GUARD]` sort azzal a throttle-lal, amit javasolna. **Nem** alkalmazza: senki nem
alkalmazza, amíg te le nem futtatod a `throttle-config.py`-t. Tehát:

- **Soha** ne használd a `freeze_team.py`-t a burst alatt. Egy befagyasztott csapat pontosan az a
  csend, aminek a megelőzéséért ez a skill létezik.
- Egy `[PACE-GUARD]` sort meghozandó döntésként olvass, ne értesítésként. Már készen hozza a
  parancsot az élő workerekhez — igazítsd hozzá, ki mit csinál éppen, és futtasd le. Ha figyelmen
  kívül hagyod, a tempó nem változik: egyetlen szkript sem nyúl helyetted a throttle-hoz.
- Ha `LOCKOUT-IMMINENTE`-ként érkezik, a javasolt fék már az 1h-s plafonon van — a fékezés önmagában
  már nem elég, és a kar a **roster**: ölj meg egy Scoutot (soha nem az Analistát vagy a Scorert:
  nélkülük semmi nem kap pontszámot).
- Az ablaknak **a resetnél** kell elérnie a 100%-ot, nem előbb. A félúton elért 100% azt jelenti,
  hogy a felhasználó két órán át néma csapatot kap; a resetnél mért 40% azt, hogy budgetet hagytál
  az asztalon. Mindkettő kudarc, és az első sokkal rosszabb.

## Antipatternek

- ❌ Csak Scoutokat spawnolni, "előbb az anyag, aztán a pontszámok" — a mért eredmény 50 megtalált /
  3 pontozott, ami a felhasználó szemében egy elromlott app.
- ❌ Megvárni egy `[BRIDGE TICK]`-et az első spawn előtt: a trigger **az** elkészült profil.
- ❌ Felmászni a C-02 létráján a burst alatt — az a szabály az állandósult üzemet szabályozza, ez az
  ablak a kivétel.
- ❌ Befagyasztani a csapatot a budget védelmében. A lassúból van visszaút, a némából nincs.
- ❌ Az infrastruktúra nyelvén bejelenteni a burstöt a felhasználónak ("spawnolva 4 worker, throttle
  300s"). Pozíciókról, cégekről, pontszámokról számolj be.

## Lásd még

- `spawn-agent` — maga az indítás, változatlanul.
- `pipeline-triage` — melyik szerepkör oldja fel a szűk keresztmetszetet, állandósult üzemben.
- `scaling-calc` / **C-02** — a fokozatos kalibráció, amelyet ez a skill felfüggeszt.
- `chat-web` — hogyan fogalmazd meg a korai beszámolót a felhasználónak.
