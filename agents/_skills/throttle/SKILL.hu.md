<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: throttle
description: Szuneteltesse a loopod N masodpercig nyomon kovetett modon. MINDIG ezt hasznald `sleep` helyett, valahanyszor le akarod lassitani az iteracios ratadat, hogy betartsd a csapat rate-budgetjet. Az idotartamot a $JHT_HOME/config/throttle.json-bol olvassa (a Kapitany kalbralja az ugynokenkhenti ertekeket ott); add meg --agent <neved> es a skill megoldja a tobbit. Levalasztott gyermekfolyamat-mintat hasznal, ami tuleli barmely provider tool-call timeoutjat (Kimi 60s, Codex 30s, Claude 120s/600s). Mindig parositsd `jht-throttle-check`-kel minden feladat elott, hogy helyrealljon, ha egy szulofolyamat idoelott leall. Minden szunetet naploz a $JHT_HOME/logs/throttle-events.jsonl-be. `sleep` throttle szunetekhez TILOS.
allowed-tools: Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle.py *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle — nyomon kovetett szunet

Shell wrapper a `/app/agents/_tools/jht-throttle` helyen. Belsoleg a
`/app/shared/skills/throttle.py`-t hivja.

## Miert letezik

Eddig minden ugynok `sleep N`-t tett a loopjaba "amikor joesonek erezte".
Ez mukodik, de a csapatnak nincs ralaatasa ra: a Kapitany nem latja,
*ki* szunetel, *mennyi ideig*, *milyen gyakran*. Ezzel a skill-lel minden
szunet hozzairodoak a `$JHT_HOME/logs/throttle-events.jsonl`-hez az
ugynok nevevel, a kert masodpercekkel, az alkalmazott masodpercekkel es egy opcionalis indoklassal.

A dashboard a `/team`-ben olvassa ezt a fajlt es ugynokenkhenti throttle
diagramot mutat, igy *lathatjuk* a csapat tempojat es idovel hangolhatjuk.

## Hogyan mukodik a kalbralas (olvasd el figyelmesen)

A Kapitany kalibralja **az idotartamot** minden ugynokhoz a
`$JHT_HOME/config/throttle.json`-ban az alabbin keresztul:

```bash
python3 /app/shared/skills/throttle-config.py set <agent> <seconds>
```

Neked (az operalo ugynoknek) NEM kell ismerned az aktualis erteket.
Egyszeruen hivd meg:

```bash
jht-throttle --agent <neved> [--reason "..."]
```

es a skill olvassa a konfigot, alszik annyi masodpercet, naplozza az
esemenyt es visszater. Ha a Kapitany 0-ra allitott (vagy nem szerepelsz a
konfigban), a skill azonnal visszater no-op-kent — nincs naplo, nincs
sleep, a loopod teljes sebesseggel fut.

Ez azt jelenti:

- A Kapitany **egyetlen konfigirasal** valtoztatja a kalibraciot, nincs
  tmux-orkesztralcio. A kovetkezo hivasod felveszi az uj erteket.
- Soha nem tarolod a throttle erteket a sajat memoriodban; nem
  ired be kemenyem a `jht-throttle 60`-at a loopodba. A Kapitany birtokolja az erteket.
- A Kapitany azt is mondhatja, hogy **tobbszor vagy kevesebbszer** hivd meg
  a skill-t a loopodban (pl. "throttle minden feladatnal" vs "throttle
  minden 3. feladatnal") — ez egy kulon tengely, amit te iranyitasz.

## Hasznalat

```bash
# Ajanlott (olvassa a konfigot):
jht-throttle --agent <neved> [--reason "..."]

# Explicit feluliras (megkerueli a konfigot; csak amikor a Kapitany
# egy konkret szammal mondja neked):
jht-throttle <seconds> --agent <neved> [--reason "..."]
```

## Hogyan mukodik belsoleq (levalasztott minta)

A `jht-throttle` egy **levalasztott gyermekfolyamat** mintat hasznal, ami tuleli barmely
provider tool-call timeoutjat (Kimi 60s, Codex 30s, Claude 120s/600s):

1. Olvassa a konfigot az idotartam megszerzsehez.
2. Ir egy allapotfajlt `$JHT_HOME/state/throttle-<agent>.json` neven
   `until = NOW + duration` ertekkel (a `jht-throttle-check` es
   `jht-throttle-wait` hasznlja).
3. Fork-ol egy `python3 throttle.py` alfolyamatot az init gyermekekent
   (PPID 1) — a tool-call alfolyamat-fan kivul. Ez a gyermek irja
   a `start` esemenyt, alszik, es irja az `end` esemenyt fuggetlenul
   attol, mi tortenik a hivo tool-call-lal.
4. A szulo (a bash, amit hivsz) blokkolja magat a teljes idotartamra
   15 masodperces sleep-darabokban. A darabolt sleep rovidebb, mint barmely
   provider alapertelmezett tool-call timeoutja, igy meg Kimi 60s alapertelmezes
   mellett is tuleli a szulo. **Az ugynok vegig blokkolt marad.**
5. Ha a provider MEGOLI a szulot (pl. nem adtal eleg timeoutot
   a tool call-odban): a levalasztott gyermek tovabb fut es
   helyesen irja az `end`-et → nincs arva a naloban. De az ugynok (te)
   most szabad vagy es tevedisbol elindithatnad a kovetkezo feladatot. Ennek
   megakadalyozasara lasd a **gate minta**t lent.

## Gate minta: MINDIG ellenorizd a kovetkezo feladat elott

Minden `jht-throttle` utan (es kulonosen normalis loop iteraciokben),
**mielott uj feladatot inditanal**, futtasd:

```bash
jht-throttle-check <neved>
# exit 0 → ok, inditsd a kovetkezo feladatot
# exit 1 → "STILL_THROTTLED remaining=Xs" az stderr-en, varnod kell
```

Ha a `jht-throttle-check` 1-gyel lep ki, azonnal hivd meg:

```bash
jht-throttle-wait <neved>
# Blokkol (15s darabokban) amig az until el nem telik, aztan kilep.
```

Ez a helyreallitasi utvonal: egy elozo `jht-throttle`, amelynek szulojot
idoelott olte meg a provider timeout. A levalasztott gyermek meg
alszik, az allapotfajl meg ervenyes, a check azt mondja neked
"meg ne indits feladatot". A wait biztonsagosan ujrablokol teged.

A teljes biztonsagos loop a role promptodban:

```
loop:
    jht-throttle-check <me>          # gate
    if exit 1:
        jht-throttle-wait <me>       # ujrablokkolaas
    do_task()
    jht-throttle --agent <me>        # szulo blokkol + gyermek levalasztva
```

## Szabalyok

- **SOHA** ne hasznalj `sleep N`-t throttle szunetekhez. Hasznald helyette a `jht-throttle`-t.
  Az egyszeru `sleep` csak nagyon rovid varakozasokhoz engedelyezett ujraprobalasok kozott
  (≤ 5 s), ahol a naplozas zaj lenne.
- **ELOTERBEN KELL futnia, blokkoloan.** A `jht-throttle` a loopod
  szunete — az egesz lenyege, hogy megakadalyozzon *teged* barmiben,
  amig vissza nem ter. Futtasd a szoksos blokkolo shell eszkozon keresztul (`Shell`
  / `Bash`), vard meg amig kilep, es csak azutan add ki a kovetkezo tool
  call-t. **NE** csomagold hatter `Task`/`TaskOutput`/`bash &`
  / `nohup` / `disown`-ba es dolgozz tovabb parhuzamosan — a szulo
  szandekosan blokkol ertetted. (A levalasztott *gyermek* fut a
  hatterben; az a wrapper belso implementacios reszlete,
  nem olyasmi amit te teszel.)
- **MINDIG ellenorizd a kovetkezo feladat elott.** Ha a tool call-od hamarabb
  tert vissza, mint a konfig masodpercei (provider timeout), hivd eloszor
  a `jht-throttle-check`-et. Ne talalgass.
- Mindig add meg az `--agent <neved>`-et (pl. `scout-1`, `capitano`,
  `analista-2`) — ez a kulcs, ami szerint a dashboard csoportosit ES a kulcs, amit a
  Kapitany ir a konfigba.
- A `--reason` opcionalis de hasznos: egy rovid cimke mint
  `"post-batch"`, `"cooldown after URG"`, `"waiting for analyst"`
  segit kesobb az esemenyek visszaolvasasakor.

## Peldak

```bash
# Feladat elotti gate (mindig feladat inditasa elott)
jht-throttle-check scout-1 || jht-throttle-wait scout-1

# Scout: szunet a kotegek kozott, idotartamot a Kapitany allitja a konfigban.
jht-throttle --agent scout-1 --reason "post-batch cooldown"

# Kapitany: explicit feluliras (ritka, csak veszelyhelyzetekre)
jht-throttle 60 --agent capitano --reason "between cycles"

# Iro: szunet a Kritikus varaasa kozben, konfig-vezerelt
jht-throttle --agent scrittore-1 --reason "waiting critic review"
```

## Kilpesi kodok

- `0` — szunet vegrehajtva es naplozva, VAGY a konfig 0-t adott vissza (no-op gyorsut)
- `1` — hianyzo vagy ervenytelen argumentumok

## Kapitany megjegyzese

Egy ugynok lelassitasahoz **szerkeszd a konfigot**, ne kuldj szamot
tmux-on keresztul:

```bash
# Egyetlen ugynok
python3 /app/shared/skills/throttle-config.py set scout-1 60

# Tobb ugynok egyetlen atomi irasban
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=60 scrittore-1=120 analista-1=0

# Jelenlegi allapot kiratasa
python3 /app/shared/skills/throttle-config.py dump
```

Hasznald a tmux-ot csak arra, hogy megmond az ugynokoknek, **tobbszor vagy kevesebbszer** hivjak
a skill-t a loopjukban, ne az idotartam diktalsara.
