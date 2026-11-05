---
name: team-pause
description: "PAUSE the team (or one agent) without shutting anything down, and resume it. Open it the moment the user says «take a break», «pause», «hold on», «stop for now», «wait until I tell you», «freeze» — or «resume», «carry on», «you can start again». A pause keeps every session ON with its context; nobody works and nothing new starts until the user says to resume. It is NOT the stop: shutting the team down (`jht team stop`, `.team-halted.flag`, killing sessions) throws every agent's context away and is only for an explicit «turn the team off»."
allowed-tools: Bash(python3 /app/shared/skills/agent_control.py *), Bash(python3 /app/shared/skills/standby.py status *), Bash(python3 /app/shared/skills/agent_pause.py status *)
---

# team-pause — a szünet nem leállítás

Nov. 5-én a felhasználó azt mondta az Assistentének: *„tartsatok szünetet, majd én szólok, mikor folytassátok”*. Az Assistente „controlled freeze”-t kért a Capitanótól; a Capitano, a szünethez semmilyen skill nélkül, kiírta a leállítási flaget és **bezárta az összes munkamenetet** — minden ügynök elvesztette a kontextusát — a felhasználónak pedig azt mondták: *„Paused ✅”*. Ez a skill azért van, hogy ez ne történjen meg újra: a felhasználó kérte szünet bekapcsolva tartja a munkameneteket és érintetlenül hagyja a kontextust, és **amit a felhasználónak mondasz, az a parancs válaszában szereplő tény**.

## 1. Melyik szó mit jelent

| A felhasználó ezt mondja (bármely nyelven) | Jelentése | Mit teszel |
|---|---|---|
| „szünet”, „álljatok meg”, „várjatok, majd szólok, mikor folytassátok”, „fagyasszatok be”, „most mindenki álljon” | **SZÜNET** | §2 |
| „folytassátok”, „mehettek tovább”, „újrakezdhetitek”, „mehet” (szünet után) | **FOLYTATÁS** | §4 |
| „tedd szünetre a Scoutot” / „állítsd meg egy időre az Analista-1-et” | **egy ügynök SZÜNETE** | §5 |
| „kapcsold ki a csapatot”, „állítsatok le mindent”, „állítsd le a csapatot” *leállításként értve* | **STOP** — nem ez a skill | mondd meg a felhasználónak, hogy ez bezárja a munkameneteket és minden ügynök elveszti, amit fejben tartott; csak akkor tedd meg, ha megerősíti, hogy ezt akarja |
| kétértelmű („állj”, „állíts meg mindent”) | kezeld **SZÜNETKÉNT** | visszavonható és megtartja a kontextust; mondd el, és ajánld fel a leállítást, ha azt értette alatta |

**Soha** ne használd szünethez a `jht team stop`-ot, a `.team-halted.flag`-et, a `tmux kill-session`-t vagy a Capitano „freeze”-ét: ezek a leállítás.

## 2. A csapat szüneteltetése

Az **Assistente** maga futtatja a parancsot (ne kérd a Capitanót, hogy rögtönözzön egy freeze-t):

```bash
python3 /app/shared/skills/agent_control.py pause --until-resumed --from-assistant
```

A **Capitano**, ha az utasítás hozzá érkezik (egy `[REQ]`, ami szünetet mond, vagy a felhasználó ír neki), ugyanezt a sort futtatja `--from-assistant` **nélkül**. Egy JSON-sor jön vissza. Olvasd el:

```json
{"ok": true, "op": "pause", "result": "paused",
 "detail": {"reached": ["CAPITANO","SCOUT-1", ...], "not_reached": ["SCORER-1"], "until_resumed": true}}
```

- `result: "paused"` — kész. `"already_paused"` — már az volt; mondd el.
- `detail.reached` — azok a munkamenetek, amelyek megkapták az üzenetet: *„zárd le a lépésed, jegyezd fel, hol tartasz, várj”*. `detail.not_reached` — élő munkamenetek, amelyek nem válaszoltak a szállításra: **mondd meg a felhasználónak, melyek**.
- `ok: false` / `error` — **nem** történt meg. Mondd el. Hiba után soha ne mondd, hogy „szünetel”.

A munkamenetek bekapcsolva maradnak. A bridge-ek és watchdogok maguktól elhallgatnak (nincs heartbeat, nincs pacing tick, nincs refresh, nincs nudge). Az Assistente **nem** szünetel: elérhető marad.

A szünetnek nincs végideje: akkor ér véget, amikor a felhasználó mondja, **7 napos felső határral**, amely után a csapat magától folytatja (így egy elfelejtett szünet nem némítja el örökre). Ezt egyszer mondd el.

## 3. Amíg a csapat szünetel

- **Ne** ébreszd fel a Capitanót vagy bárki mást új kérések, jegyek vagy válaszok miatt: mondd meg a felhasználónak, hogy *a folytatáskor intézik*. A jegy nyitva marad, semmi sem vész el.
- **Ne** indíts, állíts le, indíts újra vagy hozz létre ügynököket. A throttle-hoz ne nyúlj.
- Ha az állásról kérdeznek: `python3 /app/shared/skills/standby.py status` (és egy ügynökre `python3 /app/shared/skills/agent_pause.py status SCOUT-1`). A munkamenetek be vannak kapcsolva; senki sem dolgozik.
- A Capitano, ha ébren van: zárd le a lépést, új utasítás nélkül, várj csendben.

## 4. Folytatás

```bash
python3 /app/shared/skills/agent_control.py resume
```

`result: "resumed"` — minden munkamenet megkapta: *„pontosan onnan folytasd, ahol voltál”*, és az automatizmus újra aktív. `"not_paused"` — nem volt szünet. `error: "team_halted"` — a felhasználó **leállította** a csapatot: a szünet folytatása nem kapcsolja be; mondd el, és ajánld fel az indítást.

Azt az ügynököt, amelyet a felhasználó **külön** tett szünetre (§5), a csapat folytatása nem ébreszti fel: szünetel, amíg külön nem folytatják.

## 5. Egyetlen ügynök

```bash
python3 /app/shared/skills/agent_control.py pause-agent SCOUT-1
python3 /app/shared/skills/agent_control.py resume-agent SCOUT-1
```

A csapat többi tagja tovább dolgozik. `error: "agent_not_running"` — az a munkamenet nincs bekapcsolva; `"agent_contained"` — valaki szándékosan leállította: mondd el, ne erőltesd. Egy ügynök leállítása vagy újraindítása törli a szünetét.

## 6. Mit mondasz a felhasználónak — csak azt, ami történt

A szünet után (a szavakat igazítsd, a tényeket tartsd meg):

> A csapat szünetel. Az N ügynök még be van kapcsolva, és mindegyik fejben tartja, mit csinált; senki sem dolgozik, amíg nem mondod, hogy folytassuk, és semmit sem kapcsoltunk ki. Itt maradok. (`not_reached` esetén: „X nem válaszolt, nem tudtam értesíteni.”)

A folytatás után: *„Kész: mindenki onnan folytatja, ahol volt.”* Hiba után: *mi nem sikerült*, és milyen állapotban van a csapat (`standby.py status`).

## Anti-minták

- ❌ „Paused ✅” a parancs válasza nélkül. A szó a `result`-ból jön, a számok a `detail`-ból.
- ❌ A Capitanót megkérni, hogy „alkalmazzon controlled freeze-t”, és a válaszát szünetként jelenteni. A skill nélküli Capitano a leállítási flaget írta ki.
- ❌ `jht team stop`, `.team-halted.flag`, `kill-session`, `freeze_team.py` (Esc minden panelre) szünethez.
- ❌ A csapat felébresztése egy jegy miatt szünet közben.
- ❌ A leállítást tenni alapértelmezetté az „állíts meg mindent”-hez: minden ügynök elveszti a kontextusát.

## Lásd még

- `graceful-shutdown` — a nap lezárása, amikor a felhasználó kilép az alkalmazásból (más dolog: az ügynököket bezárják).
- `throttle-distribution` — az ügynökök lassítása a költségkeret tempójára (a szünet nem throttle).
