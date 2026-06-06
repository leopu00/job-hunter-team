<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: liveness-check
description: "Diagnosztizáld, hogy egy csapatágens tmux munkamenete él-e, hosszú körben van-e, vagy csendben halott — és indítsd újra kontextussal, ha halott. A Dottore felelőssége (a csapat roving egészségügyi ellenőrző ágense), nem a Capitano-é. Az alapvető hibamód, amit ez a skill elkap: a `jht-tmux-send` `exit 0`-t ad vissza, amikor a cél CLI összeomlott (az üzenet egy üres bash-ba íródik, majd elveszik). Periodikus liveness ellenőrzések nélkül a csapat tovább \"beszél egy hullához\" és a Capitano olyan műveletekre számít, amelyek soha nem fognak megtörténni."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *)
---

# liveness-check — tartsd a csapatot őszintén

Egy tmux munkamenet túlélheti a CLI-jét. Amikor a Codex / Kimi TUI összeomlik, a tmux visszaesik egy üres bash promptra; az üzenetek továbbra is íródnak bele (`exit 0` a `jht-tmux-send`-ből), senki nem olvassa őket, az ágens zombi. Ez a skill felismeri az állapotot és helyreáll.

## Mikor futtass ellenőrzést

- 👨‍⚕️ **Rutin kör** — minden Dottore ébredéskor (~30 perc) végigmegy minden csapatmunkameneten sorban (lásd `agents/dottore/dottore.md` a teljes one-shot életciklushoz).
- 🚨 **Capitano átadás** — amikor a Capitano jelent egy ágenst, ami > 10 perce csendes, miközben dolgoznia kellene (nincs Scout REPORT, nincs Író ACK a Critic-nek).
- 🔁 **Post-URG** — 10-30 másodperccel egy Capitano `[URG]` / `[MSG]` után az ACK + CLI élő mivoltának megerősítéséhez.
- ⚖️ **Pre-skálázás** — mielőtt egy spawn/kill-t végrehajtanál, ami egy meglévő ágens állapotától függ (ne indítsd az Analyst-ot, ha a Scout, amire épít, halott).

## Prioritási sorrend — felhasználóval szemben álló ELŐSZÖR

Bármilyen bejárás előtt rendezd a célokat úgy, hogy a felhasználóval szemben álló hosszú élettartamú ágensek legyenek először ellenőrizve. Ők a lánc tetején vannak — ha meghalnak, **senki nem indítja újra őket** (a Capitano dolgozókat indít, nem saját magát / az Assistente-t / a Mentor-t / a Sentinella-t). A 2026-05-18 zombi éjszaka post-mortemjében 6-8 óra halott Capitano volt, mert a Dottore-k először a dolgozókat járták be, soha nem érték el a Capitano-t, és önmegsemmisítettek.

```
PRIORITÁS 1 (mindig ellenőrizd először):
  ASSISTENTE, CAPITANO, MENTOR, SENTINELLA
PRIORITÁS 2 (dolgozók, a Capitano újraindíthatja őket):
  SCOUT-N, SCRITTORE-N, CRITICO-S*, ANALISTA-N, SCORER-N
```

Ha csak 10 perced van a körre, **mindig fejezd be a PRIORITÁS 1-et a PRIORITÁS 2 érintése ELŐTT**. Egy 30 perce halott dolgozó helyreállítható; egy 30 perce halott Capitano azt jelenti, hogy az egész pipeline csendes.

## 0. lépés — `pane_current_command` (olcsó előellenőrzés)

A capture-pane előtt végezd el az olcsó ellenőrzést:

```bash
cmd=$(tmux list-panes -t <SESSION> -F '#{pane_current_command}' | head -1)
```

Ha a `$cmd` nem `Kimi` / `kimi` / `claude` / `codex` / `node` / `python*`
→ az LLM CLI **már halott**, a panel üres bash maradvány.
Hagyd ki a ping-et (elveszne a bash-ban és a `jht-tmux-send`
megtévesztően `exit 0`-t adna), menj egyenesen a 3. lépéshez RESPAWN.

Ez az egyetlen ellenőrzés elkapta volna a 2026-05-18 zombi Capitano-t —
a panel bash volt (PID 663, `/proc/663/exe → /usr/bin/bash`) amiben a kimi
összeomlott. A `tmux has-session` True-t adott vissza, 11 órán át hazudva a watchdog-nak.

## 1. lépés — rögzíts, ne bízz meg

Mindig olvasd el a panelt először; ne cselekedj vakon:

```bash
tmux capture-pane -t <SESSION> -p -S -200
```

A 200 soros scroll-back elég kontextust ad (a) az állapot megítéléséhez, (b) a resume kick-off rekonstruálásához, ha újra kell indítani.

## 2. lépés — diagnózis táblázat

Egyeztesd az **utolsó 20 sort** a következőkkel:

| Minta a `tmux capture-pane -t <SESSION> -p \| tail -20`-ban          | Diagnózis           | Cselekvés           |
|----------------------------------------------------------------------|---------------------|---------------------|
| Konkrét válasz egy friss ping-re (pl. "writing CV on #281")          | ✅ él, dolgozik     | naplózd `status=alive`, következő ágens |
| `Working...` > 5 perce ugyanazon a körön, de token kimenet látható   | 🟡 hosszú kör       | naplózd `status=long_turn`, NE indítsd újra |
| Panel változatlan a ping óta                                         | 🔴 elakadt / inert  | RESPAWN (3. lépés)  |
| `Whirlpooling...` spinner > 10 perc, nulla kimenet                   | 🔴 csendes leállás  | RESPAWN             |
| Utolsó sor = `jht@<host>:~/agents/<role>$` (üres shell prompt)      | 💀 CLI kilépett     | RESPAWN             |
| `Permission denied: …/.kimi/sessions/.../context.jsonl`              | 💀 kimi összeomlott kontextus IO-n | RESPAWN  |
| `Run kimi export and send the exported data to support`              | 💀 kimi összeomlás banner | RESPAWN       |
| `To resume this session: kimi -r <id>`                               | 💀 árva munkamenet  | RESPAWN             |
| `Killed by timeout (60s)` (Kimi)                                     | 🟡 tool call timeout, CLI él | NEM respawn eset — az ágens elfelejtette a `timeout: N+30` megadását a shell tool híváshoz (lásd `agents/_skills/throttle/DESIGN-NOTES.md`). Diagnosztizáld `jht-throttle-check <agent>`-tel. |
| `command not found` a `kimi` / `claude` / `codex`-hez               | 💀 launcher megkerülve | RESPAWN           |
| Panel > 5 perc mozdulatlan, nincs spinner, nincs bemenet              | 🟡 kétértelmű üresjárat | kiterjesztett rögzítés (`-S -100`) teljes kontextushoz |

Ha bizonytalan vagy: **ne indítsd újra**. Naplózd `status=ambiguous`. Egy hamis pozitív (felesleges újraindítás) 1-2 perc reboot + elveszett kontextusba kerül. Egy hamis negatív (kihagyott zombi) legfeljebb 30 percbe kerül a következő Dottore körig.

## 3. lépés — újraindítás kontextussal (csak 🔴 / 💀 esetén)

Atomic szekvencia:

a) **Használd az 1. lépésben már rögzített panelt** az ágens "memóriájaként". Vond ki:
   - utolsó folyamatban lévő feladat (pl. "writing CV on position #281")
   - utolsó Capitano üzenet (keress `[@capitano -> @<role>]` jelölőket)
   - bármilyen friss hiba

b) **Azonosítsd a szerepkört + munkakönyvtárat**.
   - Egyedüli (`capitano | critico | sentinella | assistente | mentor | dottore`) → `/jht_home/agents/<role>/`
   - Több példány (`scout | scrittore | scorer | analista`) → `/jht_home/agents/<role>-<N>/` ahol `<N>` a tmux munkamenet záró száma (pl. `SCRITTORE-2` → `/jht_home/agents/scrittore-2/`).

c) **Öld meg a hibás munkamenetet, indítsd újra a launcheren keresztül** (használd a `spawn-agent` skill szemantikáját — soha ne nyers `tmux new-session` + `send-keys "kimi ..."`):

```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
sleep 12
```

d) **Injektálj resume kontextust** a kick-off törzsként (ne csak annyit mondj "resume" — mondd el *mit* és *hol*):

```bash
jht-tmux-send <SESSION> "[@dottore -> @<role>] [MSG] Resume: <feladat ami folyamatban volt az összeomlás előtt>. Last Captain order: <idézet a panelről>. Pick up from there, do NOT restart from scratch. Acknowledge with [@<role> -> @capitano] [RESUME] <egysoros leírás>."
```

Ha a panel azt mutatja, hogy az ágensnek volt foglalt DB sora (pl. `status=writing` egy pozíción), foglald bele a resume kontextusba, hogy ne duplikálja a munkát. **Soha ne indítsd újra vakon**: olvasd el a `db_query.py`-t előbb, ha szükséges.

## Kemény "ne indítsd újra" kivételek

SOHA ne indítsd újra:
- Munkamenetet **token kimeneti aktivitással az utolsó 60 másodpercben** — az ágens dolgozik, még ha lassúnak is tűnik.
- A `CAPITANO`-t Codex ablak-rotáció közben (session_id változik a sentinelben) — várd meg a stabilizálódást.
- Hosszú köröket ( > 5 perc) LÁTHATÓ token kimenettel (parse-olás, fájl szerkesztések) — a hosszú ≠ halott.
- Saját magadat (`DOTTORE*`) vagy `DOCTOR-WATCHDOG`-ot.

## Idempotencia

Ha a rögzített panel már mutat egy friss `[RESUME]` jelölőt (~5 percen belül), egy másik Dottore kör épp most indította újra az ágenst. Naplózd `status=alive` és haladj tovább — ne indítsd újra ismét.

## Naplózás

Minden cselekvés a `/jht_home/logs/dottore-actions.jsonl`-be kerül (append-only, egy JSON soronként):

```json
{"ts": "ISO-UTC", "round_id": "uuid-or-epoch", "session": "SCRITTORE-1",
 "role": "scrittore-1", "event": "diagnosis",
 "status": "alive|long_turn|stallo|cli_dead|ambiguous",
 "evidence": "utolso 1-2 panel sor"}
{"ts": "ISO-UTC", "round_id": "...", "session": "SCRITTORE-1", "role": "scrittore-1",
 "event": "respawn", "context_recovered": "...", "new_pid": null}
```

Generáld a `round_id`-t egyszer Dottore körenként (pl. epoch másodpercek a kör elején). Fűzd hozzá `>>`-vel, soha ne írd felül.

## Anti-minták

- ❌ Megbízni a `jht-tmux-send` exit kód 0-ban mint a kézbesítés bizonyítékában. Kézbesítés ≠ végrehajtás. Mindig párosítsd capture-pane-nel kritikus üzenetekre.
- ❌ Munkamenet megölése capture-pane nélkül előbb — lehet, hogy hosszú tool call-ban van, nem halott.
- ❌ Vak újraindítás (resume kontextus nélkül) — az új ágens a nulláról indul, duplikálja a munkát, elveszíti a foglalt DB sorokat.
- ❌ Munkamenetek párhuzamos bejárása — csak szekvenciálisan, egy ping egyszerre. A párhuzamos pingek túlterhelik a tmux-ot nagy csapatoknál.
- ❌ > 10 perc eltöltése egyetlen körön — ha a kör hosszú, rövidítsd; a következő Dottore ~30 perc múlva jön.

## Lásd még

- `agents/dottore/dottore.md` — a Dottore teljes one-shot életciklusa (boot → kör → önmegsemmisítés).
- `spawn-agent` (Captain) — a launcher + kick-off szerződés, amelyet ez a skill újra felhasznál az újraindításokhoz.
- `agents/_skills/throttle/DESIGN-NOTES.md` — a `Killed by timeout (60s)` eset (NEM respawn).
- `agents/_team/team-rules.md` T01 — soha ne öld meg egy másik ágens munkamenetét **kivéve** a fenti explicit respawn folyamatban.
