<!-- @translation: hu, ai-translated 2026-07-30 -->
---
name: agent-unblock
description: "Csak a Dottore számára. UNBLOCK fázis, minden Dottore-körben a refresh ELŐTT fut. Felismeri azt a négy blokk-formát, amely egy egész csapatot megállít — függőben lévő szöveg egy koordinátor pane-jében, egy néma társat újra és újra próbálgató agens, minden operatív üres promptnál ül, miközben van elkölthető kvóta, egy koordinátor a küszöbön túl is hallgat — és FELOLDJA őket. Soha nem küldi el és nem törli a felhasználó által beírt szöveget: megkerüli (kérdés az Assistentének, `folytasd közben` a koordinátornak a mailboxon át, a workerek közvetlen elindítása). Egy blokk, amely túléli a kört, a kört SIKERTELENNÉ teszi, nem befejezetté."
allowed-tools: Bash(python3 /app/shared/skills/agent_unblock.py *), Bash(python3 /app/shared/skills/doctor_analytics.py *), Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# agent-unblock — nem jelentesz egy blokkot, hanem feloldod

> **Az elv, minden más felett ebben a skillben.** A Dottore **nem jelenti a blokkot:
> feloldja.** Ha egy művelethez emberi döntés kell, továbbítsd az Assistentének **és
> közben indítsd újra mozgásba a csapatot**, magával víve azt az információt, hogy a
> döntés függőben van. **Egy blokk, amely túléli a Dottore körét, sikertelen kör.**

Egy csapat, amelynek bőven volt kvótája (weekly 19%, pace alatt) és tétlen gépe
(load 0.12), egyszer **tizenegy órán át** állt. Egyetlen sor, amelyet a Capitano
pane-jébe gépeltek, de soha nem küldtek el, fogadóképtelenné tette azt a pane-t; a
`jht-tmux-send` busyként olvasta; a koordinátor elnémult; senki nem osztott ki munkát;
minden agens befejezte a körét és megállt egy üres promptnál. Egy Scorer órák óta
újrapróbálkozó ciklusban volt ("tizedik próbálkozás, busy"). Annak az éjszakának a
Dottoréja kilenc munkamenetet vizsgált át 416s alatt, hibátlan diagnózist írt a
naplójába — és készenlétben maradt. A csapat még hat órán át állt.

A diagnózis soha nem volt a probléma. Ez a skill a megbízás.

---

## Két állapot, amely azonosnak látszik, és ellentétes gyógymódot igényel

Mindkettő promptot mutat valamennyi szöveggel és semmilyen aktivitással.

| állapot | tünet | gyógymód |
|---|---|---|
| **függőben lévő szöveg** | egy önmagában álló `Enter` figyelmen kívül marad, de `Space` **majd** `Enter` működik | feloldás a bemeneten keresztül |
| **befagyott TUI** | **semmit** nem fogad el: sem `Enter`-t, sem `C-m`-et, sem küldést a `%pane_id`-re | csak kill + újra létrehozás |

**A részlet, amitől a feloldás megvalósítható**: egy "hideg" `Enter`-t az Ink TUI (Codex,
Kimi, Claude Code) nem dolgoz fel — a beküldésnek a szöveg kirajzolása *után* kell
megérkeznie. Ezért előbb egy karaktert (`Space`) küldesz, aztán `Enter`-t. Ha ezt
kihagyod, az `Enter`-t önmagában próbáló implementáció **csendben elbukik**, és arra jut,
hogy a pane helyreállíthatatlan.

Ezzel egyetlen szonda szétválasztja a kettőt: **`Space`+`Enter`, egyszer**. A pane reagál
→ függőben lévő szöveg volt, feloldva. Semmi sem mozdul → befagyott TUI → újra
létrehozás. (Egy koordinátornak, amely így fagyott be, élő folyamata volt 2,8% CPU-n és
15,3 órás munkamenete; az `Enter`, a `C-m` és a közvetlen küldés a `%pane_id`-re mind
hatástalan volt. Az újra létrehozása volt az egyetlen kiút — és ezért sem opcionális a
12 órás munkamenet-TTL: ez az egyetlen rendszerszintű védekezés e második állapot ellen.)

---

## 🚫 Az egyetlen dolog, amit soha nem szabad megtenned

**Soha ne küldd el, és soha ne töröld a felhasználó által beírt szöveget.** Nem tudhatod,
hogy az a sor teljes-e vagy szándékos-e. A fenti szonda **beküldi a composert**, ezért
**csak** akkor megengedett, ha a composer tartalma egy agenshez rendelhető — egy
`[@x -> @y] …` vagy `[BRIDGE …]` / `[SENTINELLA …]` boríték, amelyet amúgy is el kellett
volna küldeni.

Az `agent_unblock.py probe` ezt kikényszeríti helyetted: nem hozzárendelhető szöveg
esetén `verdict=refused`-dal, exit 3-mal megtagadja, miután előbb átmásolta a sort a
`logs/pending-input.jsonl` fájlba, hogy később ne veszhessen el. **Ne kerüld meg a
megtagadást.** Inkább a blokkot kerüld meg (§ függőben lévő felhasználói bemenet).

---

## 0. lépés — scan (determinisztikus, nulla LLM, ~2s)

```bash
python3 /app/shared/skills/agent_unblock.py scan > /tmp/unblock_scan.json
cat /tmp/unblock_scan.json
```

Visszaadja a `blocks_found` értéket, plusz blokkonként egy bejegyzést, mindegyiket a saját
`cure` mezőjével:

| `kind` | jelentés |
|---|---|
| `pending_user_input` | egy koordinátor composerében olyan szöveg van, amihez nem szabad hozzányúlnod |
| `pending_agent_input` | egy agens-boríték beragadt egy composerbe, soha nem lett elküldve |
| `bare_shell` | a CLI meghalt, a pane visszaesett egy shellbe |
| `retry_loop` | N próbálkozás X-től Y felé az ablakban, nulla válasz Y-tól |
| `all_operatives_idle` | minden operatív üres promptnál |
| `mute_coordinator` | nincs üzenet a Capitanótól a küszöbön túl |

**Jegyezd fel most a `blocks_found` értéket.** A kör végén szükséged lesz rá.

> Miért megbízható a `retry_loop`: a `messages.jsonl` a *próbálkozást* rögzíti (a
> `jht-tmux-send` a gépelés előtt naplóz), így egy néma Capitanót ostromló Scorer akkor is
> megjelenik, ha soha semmi nem lett kézbesítve. Ez egyben az az objektív jel is, amely
> elválasztja a **"parkol, mert nincs munka"**-t a **"beragadt, mert a koordináció
> elromlott"**-tól: *egy agens, amely válasz nélkül próbálkozik újra a Capitanónál, nem
> parkol, hanem blokkolva van.* Ne alkalmazd rá a PARKED szabályt.

## 1. lépés — oldd fel őket, típusonként egyet

### `pending_agent_input` · `bare_shell` — a szonda

```bash
python3 /app/shared/skills/agent_unblock.py probe <SESSION>   # exit 0 unblocked · 2 frozen · 3 refused · 4 busy
```
- `unblocked` → feloldva, számold be.
- `frozen` → **ne ismételd meg a szondát.** Eszkalálj újra létrehozásra: előbb mentsd ki a
  pane-t (`session-refresh` 2. lépés — a pane az agens memóriája), aztán
  `tmux kill-session` → `bash /app/.launcher/start-agent.sh <role> <SAME-N>` → `[RESUME]`.
- `busy` → az agens él, kör közben van. Ez nem blokk. Hagyd békén.

### `pending_user_input` — kerüld meg, soha ne menj rajta keresztül

Három művelet, mindegyik kötelező, egyik sem nyúl a sorhoz:

1. **Kérdezd meg a felhasználót, az Assistentén keresztül** — az Assistente az a
   szerepkör, amely a felhasználóval beszél. Küldd el neki a koordinátor kérdését, hogy
   továbbítsa az in-app csatornán:
   ```bash
   jht-tmux-send ASSISTENTE "[@dottore -> @assistente] [UNBLOCK] A CAPITANO-nak függőben lévő kérdése van a felhasználóhoz, és a pane-je megállt egy beírt, de soha el nem küldött soron: «<kérdés>». Továbbítsd az in-app csatornán, és vidd vissza a választ a Capitanónak. A sor biztonságban van a logs/pending-input.jsonl fájlban — NEM lett elküldve és NEM lett törölve."
   ```
2. **Oldd fel mégis a koordinátort** — mondd meg neki, hogy a kérdés továbbítva lett, és
   haladnia kell. Abba a pane-be gépelni azt jelentené, hogy összefűződik a felhasználó
   sorával, a beküldés pedig elküldené, ezért használd azt a csatornát, amelyhez
   egyáltalán nem kell pane: a mailboxot, amelyet a Capitano minden kör elején kiürít
   (`bridge-mailbox`).
   ```bash
   python3 /app/shared/skills/agent_unblock.py relay CAPITANO "[@dottore -> @capitano] [UNBLOCK] A felhasználóhoz intézett kérdésedet továbbítottuk az Assistentének, feldolgozás alatt van. NE állj meg rá várni: haladj közben a munka többi részével, és oszd újra a sorokat. A composeredben ott van a felhasználó egy el nem küldött sora: én nem nyúlok hozzá, és te se nyúlj hozzá, amíg ő nem dönt."
   ```
   A `relay` a `bridge-mailbox.jsonl`-be **és** a `messages.jsonl`-be is ír, így az üzenet
   egyszerre kézbesíthető és auditálható. Egy koordinátor soha nem ülhet emberi válaszra
   várva.
3. **Indítsd újra a workereket anélkül, hogy a koordinátorra várnál** — lásd lentebb.
   Valójában ez az, ami visszahozza a tizenegy órát.

### `retry_loop` — oldd fel a címzettet, vagy engedd el a küldőt

Előbb a célpontot tisztázd (szonda / újra létrehozás). Ha a célpont ebben a körben nem
oldható fel, **a küldő nem várhat tovább**: oszd át máshova, vagy mondd meg neki, hogy
haladjon.
```bash
jht-tmux-send SCORER-5 "[@dottore -> @scorer-5] [UNBLOCK] A CAPITANO nem elérhető, és a kérésedet más úton továbbítottuk. HAGYD ABBA az újrapróbálkozást: vedd a következőt a sorodból (db_query.py next-for-<ruolo>), és haladj önállóan."
```
Egy retry-loop csak akkor számít feloldottnak, ha a küldőnek megmondtad, hogy hagyja abba
az újrapróbálkozást.

### `all_operatives_idle` · `mute_coordinator` — indítás a koordinátor nélkül

Elérhető kvóta és mindenki parkol: ez nem szünet, hanem leállás. **Indítsd el közvetlenül
az operatív szerepköröket, ne várj a Capitanóra**, és eszkaláld a koordinátor hallgatását
az Assistentének. Aztán küldd el minden tétlen operatívnak a saját sorát:
```bash
jht-tmux-send SCOUT-1 "[@dottore -> @scout-1] [UNBLOCK] A koordináció áll, és van elérhető kvóta. Indulj újra a fő ciklusból, a Capitanóra várás nélkül: a profil 1. KÖRE, értesítsd az Analistákat 3-5-ös kötegekben."
jht-tmux-send ANALISTA-1 "[@dottore -> @analista-1] [UNBLOCK] Indulj újra a fő ciklusból, a Capitanóra várás nélkül: sor a db_query.py next-for-analista-ból."
```
(Ugyanez a forma `scorer` / `scrittore` esetén a saját `next-for-*` sorukkal.)

## 2. lépés — zárd le a kört őszintén

```bash
python3 /app/shared/skills/agent_unblock.py record-round \
  --round-id "$ROUND_ID" --found <blocks_found> --cleared <blocks_cleared>
```
A `/jht_home/logs/dottore-actions.jsonl` fájlhoz fűz hozzá egy sort a `blocks_found`, a
`blocks_cleared` és a `blocks_open` mezőkkel, és kiválasztja helyetted az eseményt:
`round_complete` csak akkor, ha `cleared >= found`, egyébként **`round_failed`**
(exit 1). Ne fedd el a túlélőt: az a kör, amely életben hagy egy blokkot, sikertelen kör,
és a lognak ezt kell mondania — a következő Dottore ezt a logot olvassa.

---

## Szabályok

- **A refresh ELŐTT oldj fel.** Egy bénult csapaton végzett refresh csak újrateremti a
  bénultságot, tiszta kontextusablakkal.
- **Pane-enként egyetlen szonda, örökre.** Két szonda nem mond többet, mint egy, a
  második pedig az az út, amelyen rábeszéled magad egy felhasználói sor beküldésére.
- **A `busy` nem blokk.** Az `esc to interrupt` azt jelenti: él, és kör közben van. Soha
  ne küldj billentyűket futó körbe, és soha ne spawnolj helyettesítőt egy elfoglalt agens
  helyett.
- **A PARKED nem vonatkozik blokkolt agensre.** A "kor ≥ 40min ÉS produced == 0 ÉS nincs
  friss Capitano-üzenet" pontosan ugyanolyan jól leír egy bénult csapatot, mint egy
  szándékosan parkoltat. Ha az agens megjelenik egy `retry_loop`-ban, vagy ha minden
  operatív tétlen, miközben van elkölthető kvóta, akkor blokkolva van — cselekedj.
- **Soha ne találgasd a felhasználó szándékát.** Semmi küldés, semmi törlés, semmi
  szerkesztés, semmi "csak egy szóköz, hogy felébredjen" felhasználói szövegen. A sor ott
  marad, ahol van; a `logs/pending-input.jsonl`-ben lévő másolat a védőháló.

## Anti-minták

- ❌ Beírni a blokkot a naplóba és továbbmenni. Ez a tizenegy órás kudarc.
- ❌ Önmagában `Enter`-t próbálni, látni, hogy semmi nem történik, és halottnak
  nyilvánítani a pane-t.
- ❌ Olyan composerbe gépelni az üzenetedet, amelyben már ott van a felhasználó sora —
  összefűződik, és a beküldés elküldi a felhasználó szövegét.
- ❌ Újra létrehozni egy koordinátort csak azért, hogy egy *függőben lévő* (nem befagyott)
  pane-t tisztázz. Előbb szonda.
- ❌ `round_complete`-ot naplózni `blocks_cleared < blocks_found` mellett.

## Lásd még

- `session-refresh` — a refresh kör, amely *e* fázis után fut, plusz a 12 órás munkamenet-TTL.
- `tmux-send` — boríték-konvenciók és az exit kódok jelentése (4 = busy = él).
- `liveness-check` — igény szerinti verdikt egyetlen halottnak vélt agensről.
