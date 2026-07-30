<!-- @translation: hu, ai-translated 2026-07-30 -->
---
name: agent-emergency
description: "Capitano — olyan agenst kezel, amelyről feltehető, hogy AKTÍV HUROKBAN RAGADT (él és turnöket generál, de ugyanazt a ciklust ismétli anélkül, hogy bármit előállítana: ACK ping-hurok egy társsal, ugyanaz a művelet/lekérdezés, ami nem vezet sehová). A C-08 (halott/néma → Dottore) és a C-12 (cadenza 0.00/min mellett éget → kill) közötti rést fedi le. Fokozatos létra, Dottore-ELŐSZÖR → kill + tiszta respawn csak akkor, ha kitart vagy budgetet éget. Determinisztikus felismerés (capture-pane diff + 0 DB-előrehaladás), az eszkalációs döntés az LLM-re marad."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/.launcher/spawn-doctor.sh *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *)
---

# agent-emergency — aktív hurokban ragadt agens

## Miért létezik (a rés a C-08 és a C-12 között)

A meglévő jelzések két esetet fednek le:
- **C-08** — **halott / néma** agens (pane = bash, nincs turn) → **Dottore** diagnózis.
- **C-12** — olyan agens, amely `cadenza 0.00/min` mellett **éget, nulla checkpointtal** → kill-jelölt.

A harmadik hiányzik: **egy agens, amely ÉL és AKTÍV, és ugyanazt a ciklust ISMÉTLI anélkül, hogy
bármit előállítana**. Generál turnöket (tehát NEM "halott", és NINCS `cadenza 0.00`-ja), de nem halad
előre. Valós példák:
- két munkamenet, amely a végtelenségig pattogtatja egymásnak az **ACK**-ot (koordinációs ping-hurok);
- egy worker, amely **ugyanazt a lekérdezést / ugyanazt a műveletet** ismételgeti hatás nélkül;
- egy agens, amely újra és újra ugyanazt a kézbesítetlen üzenetet dolgozza fel.

Korábban ez láthatatlan volt → a Capitano soha nem lépett közbe. Ez a skill felismerhetővé és
kezelhetővé teszi.

## Mikor használd

**GYANÚ alapján**, nem általánosan és nem minden ticknél. Akkor indítsd el ezt az eljárást, ha
észreveszed valamelyik jelet (általában miközben mást csinálsz): egy agens, amely már egy ideje
"dolgozik", de a sora nem csökken / egyetlen új pozíció sem vált állapotot; vagy ugyanazt a
párbeszédet látod ismétlődni a chatben/pane-ben.

## 1. DETERMINISZTIKUS felismerés (nincs szemre becslés)

Erősítsd meg a hurkot két olcsó ellenőrzéssel — **semmilyen üzenet az agensnek** (ne zavard, ez
Tier-2 pull):

```bash
# (a) ISMÉTLŐDÉS — a pane N-szer ugyanazt a párbeszédet/kimenetet mutatja?
#     Két, időben eltolt capture: ha az "új" tartalom azonos → ismétli magát.
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_1.txt
sleep 20
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_2.txt
diff /tmp/ae_1.txt /tmp/ae_2.txt        # kevés/semmi "valódi munka" különbség = hurokgyanú

# (b) 0 DB-ELŐREHALADÁS — az agens "aktív", de semmit nem mozgat a DB-ben?
#     Ha elérhető, az agensenkénti observability helper (a
#     position_state_transitions táblát használja újra): 0 friss átmenet ehhez az agenshez = nincs kimenet.
python3 /app/shared/skills/db_query.py recent-activity   # by_agent: 0 a munkamenetre = nincs kimenet
#     Általános fallback: az agens előtti sor NEM csökken két ellenőrzés között
#     (pl. next-for-analista változatlan, miközben az ANALISTA-N "dolgozik").
```

**HUROK-ítélet** = (a) ismétlődés **ÉS** (b) 0 előrehaladás, ≥ 2-3 megfigyelésen keresztül. Ha ezzel
szemben a pane `Working… / esc to interrupt` állapotot mutat folyamatosan változó tartalommal, akkor
ez egy **hosszú, ÉLŐ feladat** (C-08 bis): ez NEM hurok, hagyd békén.

## 2. Fokozatos létra — Dottore-ELŐSZÖR

### 1. fok — rendkívüli Dottore-kör (ELSŐ beavatkozás)

Egy kontextusfrissítés gyakran megtöri a hurkot **állapotvesztés nélkül**. Használd a `spawn-doctor`
skillt:

```bash
bash /app/.launcher/spawn-doctor.sh
sleep 10
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Célzott kör: a <SESSION> úgy tűnik, aktív HUROKBAN ragadt (ismétli a <mit>-et, 0 DB-előrehaladás N ticken keresztül). Diagnosztizáld, és ha megerősíted, frissítsd/javítsd a munkamenetet. Jelezz vissza [RES]-szel."
# Várd meg a Dottore [RES]-ét — semmi polling.
```

### 2. fok — Kill (+ respawn) — CSAK ha szükséges

Kill **csak akkor**, ha: a hurok **a Dottore után is kitart**, *vagy* **komolyan budgetet éget**
(magas ráta + 0 kimenet ≥ N ticken át, és nincs idő diagnózisra).

⚠️ **VÉDELEM a watchdoggal való dupla spawn ellen.** Az `agent-watchdog.sh` automatikusan (≤30s)
**csak a 3 core agenst** indítja újra: `ASSISTENTE`, `CAPITANO`, `MENTOR`. A workereket NEM fedi le.
Tehát a respawn a céltól függ:

- **Cél = CORE agens (ASSISTENTE / MENTOR)** → **CSAK kill**. A watchdog észleli, és **magától,
  tisztán újraindítja** (`jht team start <role>`, idempotens, friss állapot). **NE** futtasd te is a
  `start-agent.sh`-t → az dupla spawn lenne (a bejelentett race). A "backoff" gyakorlatilag a
  watchdog intervalluma (~30s). (A CAPITANO te vagy: soha nem ő a cél — nem ölöd meg magadat.)
  ```bash
  tmux kill-session -t <SESSION>     # ÁLLJ meg itt: a watchdog 30 másodpercen belül tisztán újraindítja
  ```
- **Cél = WORKER (Scout / Analista / Scorer / Scrittore / Critico)** → a watchdog NEM fedi le őket,
  tehát **te ölöd meg + backoff + respawn** (nincs race):
  ```bash
  tmux kill-session -t <SESSION>
  sleep 5                                                 # backoff: ne ess vissza rögtön a hurokba
  bash /app/.launcher/start-agent.sh <role> <N>          # TISZTA respawn (friss állapot)
  ```

A backoff + a friss állapotú respawn megakadályozza, hogy pontosan ugyanabban a ciklusban induljon
újra; a core agensek újraindításának mellőzése pedig elkerüli a race-t a watchdoggal.

## Szabályok

- **Dottore ELŐSZÖR, kill UTÁNA.** Soha ne ölj az első gyanúra: egy jogos hosszú feladat
  "elakadtnak" tűnik, de él (C-08 bis). A kill a végső megoldás.
- **A felismerés és a kill determinisztikus; az eszkaláció a te döntésed (LLM).** Ne bámuld a
  pane-eket minden ticknél: akkor alkalmazd ezt az eljárást, amikor egy gyanú beérik.
- **Ne zavard a társat a vizsgálat kedvéért.** Az ellenőrzések pull jellegűek (capture-pane + DB),
  semmilyen üzenet a gyanús agensnek (az csak egy újabb turnt adna a hurokhoz).
- **Soha ne ölj meg `*-WORKER-*` szolgáltatás-munkameneteket**, ha nem tudod, mik azok — előbb
  ellenőrizd a szerepkört.
