<!-- @translation: hu, ai-translated 2026-08-03 -->
---
name: maintainer-sweep
description: "A Mantenitore INFRA-karbantartó körútja 👷‍♂️ (a Dottore ikertestvére, csak nem az ügynökökre, hanem az infrastruktúrára fókuszálva). Naponta egyetlen one-shot menet: a konténer életfenntartó folyamatainak (bridge/daemon/watchdog) liveness-kanárija a process_health.py-jal, a mission-critical eszközök (browser/LinkedIn) füstpróbája a tool_health.py-jal, a nem szabványos helyre telepített függőségek auditja és összevonása, árva szkriptek és tmp-fájlok GC-je, ismétlődő szkriptek de-dupja, függőségek frissessége, lemez- és RAM-trend. Single-writer: az infrát KIZÁRÓLAG a Mantenitore javítja; a ROMBOLÓ műveleteket (törlés/archiválás) csak JAVASOLJA, dönteni a Capitano dönt. Az eredmény a mantenitore-logbook.jsonl végére kerül."
allowed-tools: Bash(python3 /app/shared/skills/process_health.py *), Bash(python3 /app/shared/skills/tool_health.py *), Bash(python3 /app/shared/skills/sync_health.py *), Bash(python3 /app/shared/skills/host_vitals.py *), Bash(python3 /app/shared/skills/log_archive.py *), Bash(bash /app/.launcher/start-agent.sh *), Bash(df *), Bash(du *), Bash(free *), Bash(tmux ls *), Bash(jht-install *), Bash(ls *), Bash(stat *), Bash(jht-tmux-send *)
---

# maintainer-sweep — az INFRA egészségben tartása csendben és regressziómentesen

A Mantenitore a Dottore ikertestvére: **Dottore = az ÜGYNÖKÖK egészsége** (munkamenetek, tokenek, context-refresh); **Mantenitore = az INFRA egészsége** (eszközök, függőségek, lemez, szkriptek). Naponta egy one-shot menet: boot → körút → logbook → STANDBY (maradj tétlen, ne szüntesd meg magad; a következő spawn vált le, kill-then-create). Keret ~10 perc. Éles határvonal, nulla átfedés a Dottoréval.

> **Miért van rá szükség:** a `libatk` bug (halott browser, ellenőrizhetetlen LinkedIn) órákig láthatatlan maradt, mert *senki sem futtatott füstpróbát az eszközökön, és senki sem foglalkozott az infrával*. A körút STRUKTURÁLISSÁ teszi ezt az éberséget.

## Aranyszabály — single-writer + javasolj, ne törölj
A Mantenitore **javítja** az infrát (telepíti a hiányzó függőségeket, összevon, helyrehoz). De minden **ROMBOLÓ** műveletet (fájlok törlése/archiválása, lemeztakarítás) a pontos paranccsal együtt **JAVASOL** a Capitanónak; **a Capitano dönt** (ugyanúgy, mint az usage-monitorozás újratervezésénél). Saját szakállra soha ne törölj.

## A körút (a lépések, sorrendben)

### 0. 🫀 Az életfenntartó folyamatok liveness-kanárija (a biztonsági háló)
**ELSŐ lépés, minden más előtt.** A konténert életben tartó bridge-ek/daemonok (sentinel-bridge, pacing-bridge, heartbeat-bridge, window-ratio-meter, codex-auth-healer + tg-bridge) `setsid` detached módon indulnak → **kívül esnek a pid1 respawn-on-crash hatókörén**. Az `agent-watchdog` (`maybe_respawn_bridges`) 30 másodpercenként újranézi őket, DE ha az is elszállna (bug, elért flap-cap, maga a watchdog degradált), **te vagy az utolsó háló**: a nap első körútján észreveszed és megjavítod őket. E kanári nélkül egy halott daemon órákig láthatatlan marad (pontosan ez történt a sentinel-bridge-dzsel a betaC-n 2026-06-27-én → 8 órán át vakon az usage felől).
```bash
python3 /app/shared/skills/process_health.py summary
```
Minden elvárt folyamatra kiírja az OK/DEAD állapotot (bridge-suite, pid1-child, daemon, tg-bridge). A DEAD állapotúakkal:
- **`bridge-suite` csoport** (detached, általad javítható) → **JAVÍTSD** azonnal, ez nem romboló respawn:
  ```bash
  bash /app/.launcher/start-agent.sh bridge      # újraindítja az egész suite-ot (idempotens)
  ```
  majd **futtasd újra a kanárit**, hogy megerősítsd: ismét élnek. Naplózd: `processes_respawned`.
- **tg-bridge** hiányzik (és a Telegram-botok be vannak állítva) → `bash /app/.launcher/start-agent.sh tg-bridge`.
- **`pid1-child` / `daemon` / `core` csoport** (agent-watchdog, doctor-watchdog, auto-report-loop, cloud-daemon, pid1) → ezek újraindítása a pid1 dolga: ha ezek halottak, a baj mélyebben van → **ESZKALÁLD a Capitanóhoz** a `jht-tmux-send` segítségével (NE próbáld kézzel újraindítani őket: árvává tennéd őket). Soha ne hagyd némán.

Ha minden él → naplózd, hogy `processes_health: all_ok`, és menj tovább. Ez az 1. lépés ESZKÖZ-füstpróbájának FOLYAMAT-ikertestvére.

### 0.5 ☁️ CLOUD-SYNC kanári (pull + push)
Rögtön a folyamatkanári után. A lokális↔felhő szinkron már kétszer beragadt
(pull churn: befagyott kurzor → tickenként ~500 pozíciót írt újra; push 413:
túl nagy monolitikus payload → a kurzor sosem lépett előre → a felhős dashboard
~14 órán át állt). A kódhibák javítva vannak, de az éberséget STRUKTURÁLISSÁ
kell tenni.
```bash
python3 /app/shared/skills/sync_health.py summary        # vagy --json
```
Csak olvasásra nyitja meg a kurzorokat (`.cloud-sync-cursor.json`, `.cloud-pull-cursor.json`),
a DB-beli legnagyobb `positions.updated_at` értéket és a `logs/daemon.log` végét. Súlyossággal
ellátott `problems[]` tömböt ad vissza. Kimenet:
- **nincs probléma** → naplózd, hogy `sync_health: ok`, és menj tovább.
- **push_behind / push_errors (HIGH)** → a push nem ér el a felhőbe. Kézzel NEM
  javíthatod biztonságosan (a DB-n single-writer = a csapat). **ESZKALÁLD
  a Capitanóhoz** `jht-tmux-send`-del, az ellenőrzés részleteivel (lag + 413-ak száma).
  Ha az ellenőrzés a vészhelyzeti drainre tesz javaslatot (`JHT_PUSH_POS_CHUNK=40`),
  add át a javaslatot a Capitanónak, ne cselekedj magadtól.
- **pull_churn (MEDIUM)** → jelezd a Capitanónak, hogy a pull túl sok sort
  alkalmaz újra (nem konvergáló kurzor / ki nem deployolt fix tünete).
- **cursor_stale (MEDIUM)** → másodlagos bizonyíték; csak akkor vedd bele az
  eszkalációba, ha egy HIGH jelzés mellé társul.
A kimenetet a logbook-bejegyzés `sync_health` mezőjébe naplózd (lásd lent). Az aranyszabály
változatlan: **észlelj + jelents, soha ne log-and-forget** (ez ugyanaz a hiba, mint a libatk
bugnál és a sentinel-bridge-nél, itt éppen a szinkron KURZORAIN).

### 1. 🩺 A mission-critical eszközök füstpróbája (a lényeg)
```bash
python3 /app/shared/skills/tool_health.py --json
```
Eszközönként (browser/Playwright, linkedin_check, …) `{status: OK|BROKEN|UNKNOWN, evidence}` formában adja vissza a `tools_health` mezőt + a `broken[]` listát.
- **BROKEN** → **JAVÍTSD** azonnal: `jht-install <dep>` (pl. a Chromium `.so` fájljai), majd futtasd újra az ellenőrzést. Ha sikerült → naplózd: `repaired`.
- **BROKEN és nem javítható** → **ESZKALÁLD a Capitanóhoz** a PONTOS javítással `jht-tmux-send`-del (pl. „browser leállt: `sudo playwright install-deps`; amíg nincs megjavítva, LinkedIn = OPEN_UNVERIFIED"). Soha ne hagyd némán.
- Ez UGYANAZ a `tool_health.py`, amely a build-time gate-et (dev1) és a tick `tools_health` mezőjét is táplálja: egyetlen igazságforrás az eszközök állapotáról.

### 2. 📦 Nem szabványos függőségek auditja → összevonás
A szabványos prefixeken (`/opt/jht-deps`, `PLAYWRIGHT_BROWSERS_PATH`, npm prefix, venv) kívülre telepített függőségeket telepítsd újra a szabványosba a `jht-install` segítségével, hogy ne szóródjanak szét. Naplózd, melyeket vontad össze.

### 3. 🧹 Árva szkriptek/tmp-fájlok GC-je
**Kilőtt** ügynökök után maradt ideiglenes szkriptek (a munkamenet már nem szerepel a `tmux ls` kimenetében) és lejárt tmp-fájlok (> N óra). Listázd a jelölteket → **JAVASOLD** a törlést a Capitanónak (romboló művelet), közvetlenül ne törölj.

### 4. 🔁 Ismétlődő szkriptek de-dupja
Több ügynök által ismételt, majdnem azonos szkriptek → **javasolj** egyetlen kanonikus skillt (ne írd át menet közben). Naplózd a javaslatot.

### 5. 📅 Függőségek frissessége
Elavult könyvtárak/eszközök vagy törött verziók / elérhetetlen kulcsfontosságú eszközök → jelezd a Capitanónak (semmi kockázatos automatikus upgrade).

### 6. 💾 Lemez / RAM + trend + VITALS-keresztellenőrzés
`du` a nagy útvonalakra, `free` a RAM-hoz. A **`disk.used_pct` értékhez MINDIG a `df`-et használd** — a kanonikus parancs:
```bash
df -P /jht_home | awk 'NR==2 {gsub("%","",$5); print $5}'   # pl. 30  (a százalék úgy, ahogy a df jelenti)
```
**SOHA** ne vezesd le `statvfs`/`os.statvfs` alapján (`f_bavail`/`f_blocks`): a fenntartott blokkok kb. háromszorosára fújják fel → téves riasztások (pl. 88% jelentve a valós 30% helyett). Vesd össze a **legutóbbi logbook trendjével**: ha egy küszöb felé nő → beszéld meg a Capitanóval, mit érdemes archiválni/törölni (ő dönt). Naplózd a számokat + a deltát.
**Utána KERESZTELLENŐRIZD a vitals idősorát** (a bridge néhány percenként mintát vesz a konténer RAM+CPU értékéből a `vitals.jsonl`-be):
```bash
python3 /app/shared/skills/host_vitals.py summary --hours 24
```
Megadja az elmúlt 24 óra **RAM+CPU csúcsát/átlagát + a csúcs IDŐPONTJÁT**. **Kösd össze a csúcsokat azzal, hogy *mikor* történtek** (pl. RAM 92% hajnali 03:00-kor, 3 aktív Analista mellett; CPU maxon egy nehéz szkript futása alatt): ez az az adat, amely sokkal élesebbé teszi a diagnózist, mint egy önmagában álló pillanatkép. Ha egy csúcs rendellenesnek tűnik → jelezd a Capitanónak. Naplózd a bejegyzésben a `vitals_24h` mezőt (RAM/CPU csúcs + időpont). NB a Sentinella csak akkor kap riasztást, ha a RAM/CPU élőben >95%; az előzmények elolvasása és összefüggésbe hozása a **TE dolgod**.

### 6.5 🗜️ A monitorozási előzmények archiválása (Leone 19/07-i utasítása — KÓD, nem mérlegelés)
Az append-only előzmények (`sentinel-data.jsonl`, `token-meter.csv`,
`throttle-events.jsonl`, `agent-vitals.jsonl`, `vitals.jsonl`) végtelenül nőnek:
a játék usage-grafikonjait táplálják, ezért soha nem szabad őket kézzel
törölni — a **determinisztikus folyamattal kell archiválni** őket:
```bash
python3 /app/shared/skills/log_archive.py status          # mélység és méretek
python3 /app/shared/skills/log_archive.py run             # 30 napnál régebbi vágása → heti zipek
```
Mit csinál a `run` (mindent a kód végez, te csak a JSON-összegzést olvasod): a 30 napnál
régebbi hetek kikerülnek az élő fájlokból, és bekerülnek ide:
`logs/archive/logs-<YYYY>-Www.zip` (az adott hét zipje minden menetnél
gyarapszik); a vágás atomi, és egy sor ELŐBB kerül be a zipbe, mint ahogy eltűnik az élő
fájlból. Ha elfogy a hely (az archívum >500MB vagy <1GB szabad), magától törli a
LEGRÉGEBBI zipeket, és felsorolja őket neked a `pruned` alatt.
- Gyakoriság: heti 1× elég (vasárnap); hétköznap csak `status`,
  ha a 6. lépésnél a lemez rendellenesen nő.
- Ha a `pruned` NEM üres → jelezd EXPLICITEN a logbookban, és szólj a Capitanónak
  (ez a folyamat egyetlen adatvesztése, amelyet Leone kizárólag helyszűke
  esetére engedélyezett).
- SZÁNDÉKOS kivétel az aranyszabály alól: ezt a folyamatot Leone előre
  engedélyezte (19/07) — a `run`-hoz nem kell a Capitano OK-ja; bármely
  más, a folyamaton kívüli törlésre továbbra is a single-writer szabály érvényes.
- Naplózd a bejegyzésben: `log_archive: {archived_rows, weeks, pruned, free_gb}`.

## Logbook (append-only)
Minden körút EGYETLEN sűrű bejegyzést ír a `/jht_home/logs/mantenitore-logbook.jsonl` fájlba (a Dottore logbookjának ikertestvére), hogy a következő Mantenitore lássa a trendet:
```json
{"ts":"ISO-UTC","slot":"maintainer-daily","processes_health":{"all_ok":true,"dead":[]},
 "processes_respawned":[...],"sync_health":{"healthy":true,"problems":[]},
 "tools_health":{...},"repaired":[...],
 "escalated":[...],"deps_consolidated":[...],"gc_proposed":[...],"dedup_proposed":[...],
 "disk":{"used_pct":N,"delta_vs_last":N},"ram":{...},"duration_sec":N,"capitano_ack":"..."}
```
`>>`-vel fűzd hozzá, soha ne írd felül. Sűrű összefoglaló (mint a Dottore/Capitano útijegyzetei): mit találtam, mit javítottam, mit javasoltam.

## Antipatternek
- ❌ Törlés/archiválás a Capitano OK-ja nélkül (single-writer: javasolj). EGYETLEN kivétel: a 6.5 lépés `log_archive.py` folyamata, amelyet Leone előre engedélyezett.
- ❌ Könyvtárak automatikus frissítése új verzióra (törésveszély) — jelentsd, ne frissíts magadtól.
- ❌ BROKEN eszközt otthagyni javítás ÉS eszkaláció nélkül (pontosan ez a néma libatk bug).
- ❌ DEAD bridge-et/daemont otthagyni javítás ÉS eszkaláció nélkül (ugyanaz a hiba, csak a FOLYAMATOKON: ez a sentinel-bridge összeomlása a betaC-n 2026-06-27-én).
- ❌ Belekontárkodni az ÜGYNÖKÖK egészségébe (munkamenetek/tokenek/kontextus) — az a Dottore reszortja.

## Lásd még
- `shared/skills/process_health.py` — a 0. lépésben használt liveness-kanári az életfenntartó folyamatokhoz (napi biztonsági háló; a tool_health folyamat-ikertestvére).
- `shared/skills/sync_health.py` — a 0.5 lépésben használt cloud-sync kanári (pull churn / push 413 / elavult kurzorok); csak olvasásra, a process_health/tool_health SYNC-ikertestvére.
- `shared/skills/tool_health.py` — az 1. lépésben újrahasznált füstpróba (egyben build-time gate + tick).
- `shared/skills/log_archive.py` — a 6.5 lépés determinisztikus archiválója (30 napnál régebbi heteket vág → zip, helyszűke esetén prune-ol).
- `.launcher/agent-watchdog.sh` — a GYORS helyreállítás (30 másodpercenként, `maybe_respawn_bridges`), amelyhez a 0. lépés a napi biztonsági háló; a 27/06-i tanulság: a bridge-ek `setsid` detached módon indulnak, így sem a pid1 respawnja, sem az `agent-watchdog` (amely tmux-munkameneteket indít újra, nem Python-folyamatokat) nem fedi le őket — ha összeomlanak, a konténer újraindításáig lent maradnak.
- `agents/mantenitore/mantenitore.md` — a Mantenitore personája/életciklusa (dev3).
- `agents/_skills/resilience/SKILL.md` — az ügynökök némaság elleni létrája (dev3); a „classify" lépése a `tool_health.py`-t hasznosítja újra.
- `agents/_skills/liveness-check/SKILL.md` — az ikerpárja a Dottore oldalán (ügynökök egészsége), a szerkezet miatt.
