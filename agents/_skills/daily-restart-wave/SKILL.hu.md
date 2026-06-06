<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: daily-restart-wave
description: "Az összes csapatágens megelőző tömeges újraindítása 24 óránként egyszer a kontextus frissességéért. A Dottore felelőssége. Csak egy szűk napi ablakban fut (alapértelmezés: 03:00 UTC ± 30 perc) és csak ha az utolsó 23 órában nem volt hullám. Minden ágens megölésre + újraindításra kerül a `liveness-check` 3. lépésének azonos atomic szekvenciájával, tier 3 → tier 2 → tier 1 sorrendben, így a dolgozók ciklizálnak először és a koordinátorok (Capitano/Sentinella/Mentor/Assistente) utoljára. Háttér: a Codex/Kimi hosszú élettartamú munkamenetek \"zajt\" halmoznak fel — régi döntések, elavult tények, prompt-eltolódás — és órák után mérhetően kevésbé tudatosak. Empirikus bizonyíték az 1. esettanulmányból (Codex futás 2026-05-19/21): a kézi tömeges újraindítás helyreállította a döntési minőséget. Ez a skill zárja a rést kézi beavatkozás nélkül."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *), Bash(cat *), Bash(mkdir *), Bash(date *)
---

# daily-restart-wave — kontextus frissesség megelőző újraindítás

A Dottore normális feladata (`liveness-check`) **konzervatív**: csak a csendben halottakat indítja újra. Ez a skill az ellentéte: **indítsd újra mindenkit, szándékosan, naponta egyszer**, mert a hosszú futású ágens munkamenetek még akkor is eltolódnak, ha nem halnak meg. Ugyanaz az atomic újraindítási primitív (`liveness-check` 3. lépés), más trigger és más sorrend.

## Miért létezik

Empirikus: az 1. esettanulmányban (Codex futás 2026-05-19/21, lásd `docs/about/RESULTS.md`) a karbantartó észrevette, hogy a döntési minőség romlik ~12-24 óra folyamatos ágens üzemidő után — ismétlődő hibák, elavult tényekre hivatkozás, alkalmanként explicit felhasználói parancsok figyelmen kívül hagyása. Egy kézi "indítsd újra mindenkit" utasítás a ~30. órán visibilis módon helyreállította a frissességet. A Codex nem mutat kontextus ablakot, mint a Claude/Kimi, így az eltolódás láthatatlan, amíg nem hasonlítod össze az előtte/utána állapotot.

Elméleti: minden LLM munkamenet egy hosszú beszélgetés. Ahogy a tokenek halmozódnak, a modell:
- Lehorgonyoz korai döntésekre, amelyek hibásak lehettek
- Elavult tények alapján következtet (egy pozíció, ami lezárult, egy stratégia, ami módosult)
- Lassabbá válik körönként (több KV-cache, amire figyelni kell)
- Eltolódik a rendszer promptjától felhasználói nyomás alatt ("a csapatszabályok elsöprése")

Egy friss boot újraolvassa a promptot + friss DB állapotot + átadási pillanatképeket és tiszta alapról dönt. Költség: ~2 perc/ágens "felzárkózás". Előny: órák elkerült alacsony minőségű kimenet.

## Mikor indítsd — a 3 kapufeltétel

MIND A HÁROMNAK igaznak kell lennie. Hagyd ki `status=skipped`-del és `reason` mezővel a naplóban egyébként.

1. **A napi ablakon belül**. Alapértelmezés: 03:00 UTC ± 30 perc (azaz 02:30–03:30 UTC). Indoklás: alacsony valós-felhasználói-aktivitás ablak európai/amerikai nappali felhasználóknak; ha a felhasználó alszik, a ~10 perces újraindítási parádé láthatatlan. Olvasd ki az aktuális órát:

   ```bash
   now_h=$(date -u +%H)
   now_m=$(date -u +%M)
   # 02:30 ≤ now ≤ 03:30
   in_window=$([ "$now_h" = "02" -a "$now_m" -ge "30" ] || [ "$now_h" = "03" -a "$now_m" -le "30" ] && echo yes || echo no)
   ```

2. **Nincs hullám az utolsó 23 órában** (anti-csapkodás). Olvasd a `/jht_home/logs/daily-restart-wave-state.json`-t:

   ```json
   { "last_wave_at": "2026-05-30T03:11:42Z", "agents_restarted": 9, "duration_sec": 612 }
   ```

   Ha a fájl nem létezik → kezeld "soha nem indult"-ként → a feltétel igaz.
   Ha `now - last_wave_at < 23h` → hagyd ki `reason=anti_thrash`-sel.

3. **A csapat nincs `.team-halted.flag` vagy `.weekly-halt.flag` állapotban**. Ha bármelyik jelző létezik, a felhasználó kifejezetten szüneteltette a csapatot — az újraindítás most ellenséges lenne.

   ```bash
   [ -f /jht_home/.jht/.team-halted.flag ] && skip
   [ -f /jht_home/.jht/.weekly-halt.flag ] && skip
   ```

Ha mind a 3 átmegy → folytasd. A teljes 3 ellenőrzési blokk `<2 másodperc`, minden Dottore ébredéskor fut, semmibe nem kerül az ablakon kívül.

## Újraindítási sorrend — tier 3 → tier 2 → tier 1

A `liveness-check` fordítottja (amely felhasználóval szemben lévőket ellenőrzi ELŐSZÖR, hogy ne haljanak meg észrevétlenül). Megelőző hullámhoz az ellentétet akarjuk: **dolgozók először, koordinátorok utoljára**, így a Capitano az utolsó, aki elveszti a szálát, és megfigyelheti (a panelján), hogy minden dolgozója frissen visszajött, majd ő maga is újraindul és tiszta lappal kezdi az új napot.

```
TIER 3 (dolgozók, indítsd újra ELŐSZÖR):
  SCOUT-*, SCRITTORE-*, CRITICO-*, ANALISTA-*, SCORER-*

TIER 2 (fél-koordinátorok):
  (ma nincs — fenntartva jövőbeli "alárendelt koordinátoroknak")

TIER 1 (felhasználóval szemben lévő hosszú élettartamúak, indítsd újra UTOLJÁRA):
  ASSISTENTE, MENTOR, SENTINELLA, CAPITANO   (Capitano utolsónak az utolsók közül)
```

A tier 3 üres munkamenetei (pl. `SCRITTORE-*`, amikor nincs CV folyamatban Writer-on-demand V6 esetén) → csendben kihagyás, nincs kill, nincs respawn. A következő igény szerinti spawn a Capitano-tól amúgy is friss lesz.

## Értesítés a Capitano-nak — 10 perccel előtte

A Capitano koordinálja a spawn/skálázást. Ha éppen egy Scrittore burst-öt indít és 30 másodperccel később megöljük, a spawn félúton meghal. Tehát:

1. **A hullám t=0 időpontjában** (a döntés meghozva), MIELŐTT bármely ágenst érintenéd, küldj a Capitano-nak előzetes figyelmeztetést `tmux-send`-del:

   ```
   [HEADS-UP DOTTORE → CAPITANO] Daily restart wave parte fra 10 min.
   Non spawnare nuovi worker fino a NEW DAY. Termina task <5min in corso.
   Quando arriva il tuo turno (ultimo), ti riavvio io.
   ```

2. **Várakozás 10 percet**. Adj a Capitano-nak időt a rövid élettartamú állapot leürítésére.

3. **Ezután indítsd a parádét** a tier 3 → tier 1 sorrendben.

Ha a Capitano már zombi (üres bash), hagyd ki az előzetes figyelmeztetést és menj egyenesen a parádéra — nincs mit koordinálni.

## Az újraindítási primitív — a liveness-check 3. lépésének újrafelhasználása

Minden cél munkamenethez, az életben lévőség állapotától függetlenül:

```
a. tmux capture-pane -t <SESSION> -S -200 -p > /tmp/$session-pre-restart.log
b. python3 /app/shared/skills/db_query.py <agent-role> --recent-context   (opcionális)
c. tmux kill-session -t <SESSION>
d. bash /app/.launcher/start-agent.sh <agent-role> [<instance-num>]
e. sleep 8s   (hagyd a CLI-t bootolni)
f. tmux send-keys -t <SESSION> "RESUME: daily restart wave. Riprendi dai recenti log DB (db-query) + tuo prompt di identità. Nessuna task short-lived persa: il Capitano ha dranato la coda 10 min fa." Enter
g. naplózd event=agent_restarted, agent=<role-N>, duration_ms=<X>
```

Megjegyzések:
- A panel rögzítés `/tmp/`-be kerül, hogy az új példány olvashassa, ha meg akarja vizsgálni "mit csináltam".
- NEM írunk `~/.jht/<agent>-pre-respawn-snapshot.txt`-t itt (ez egy strukturált átadás, amelyet a BACKLOG követő igényelt, de minden ágens promptjának tudnia kellene, hogyan írja+olvassa — az MVP hatókörén kívül, külön nyomon követve).
- A `RESUME:` indító üzenet általános; azt mondja az ágensnek, hogy nézze meg a saját DB nyomait, ahelyett, hogy belső pillanatképre támaszkodna.

## Újraindítások közötti ütemezés

Várj **15-20 másodpercet az ágensek között** ugyanazon a tier-en. Miért:
- Gyors egymás utáni `start-agent.sh` hívások versenyezhetnek a megosztott `~/.jht/.local/` írásain (RULE-T13 magazzino python).
- Adj minden új ágens CLI-jének ~10 másodpercet a stabilitásra (handshake, tool listing, system prompt kiértékelés) mielőtt a következő elárasztaná a tmux szervert.

Teljes idő egészséges csapattal (8-10 munkamenet):
- 1 perc előzetes figyelmeztetés + 10 perc Capitano várakozás
- 7 tier-3 ágens × ~20 másodperc = ~2.5 perc (a legtöbb hiányzik stabil állapotban)
- 4 tier-1 ágens × ~30 másodperc (nehezebb promptok) = ~2 perc
- **Teljes költségvetés: ~15 perc**, kényelmesen a legrosszabb eset 30 perc alatt, ameddig a Dottore életben lehet a hullámhoz.

## Hullám végi naplózás

Fűzd hozzá a `/jht_home/logs/dottore-actions.jsonl`-hez:

```json
{"ts":"2026-05-31T03:08:11Z","event":"daily_restart_wave_done","agents_restarted":9,"agents_skipped_empty":3,"duration_sec":612,"capitano_ack":"yes"}
```

Frissítsd az állapotfájlt `/jht_home/logs/daily-restart-wave-state.json`:

```json
{ "last_wave_at": "2026-05-31T03:08:11Z", "agents_restarted": 9, "duration_sec": 612 }
```

Értesítsd a Capitano-t (most friss) egy sorban:

```
[DA DOTTORE A CAPITANO] Daily restart wave completed at 03:08 UTC.
9 agents restarted, 0 errors. Team back online — riprendi la pipeline.
```

## Hibamódok — mit tegyél

| Hiba | Cselekvés |
|---|---|
| `start-agent.sh` kilépés ≠ 0 valamelyik ágensnél | Naplózd `event=agent_restart_failed`, ugorj a következőre, NE szakítsd meg a hullámot. A következő rutin `liveness-check` kör észreveszi a hiányt és újrapróbálja. |
| `tmux server` nem válaszol (ritka) | Szakítsd meg a hullámot, naplózd `event=tmux_dead`, NE frissítsd a `last_wave_at`-t (hogy a következő Dottore újrapróbálja). |
| Hullám félbeszakadt (Dottore 10 perces költségvetés időtúllépés) | Naplózd `event=daily_restart_wave_partial`, NE frissítsd a `last_wave_at`-t. A következő Dottore az ablakon belül folytatja (az anti-csapkodás újraellenőrzés 23 óráig sikertelen, de ez ugyanaz a hullám — fogadd el a ritka dupla érintést). |
| Capitano soha nem ACK-olja az előzetes figyelmeztetést | Várd meg a 10 percet mindenképpen. Ha hallgat t=10-nél, a parádé őt is megöli — az új Capitano tisztán veszi át. |

## Amit ez a skill NEM csinál

- ❌ **Igény szerinti újraindítás** a napi ablakon kívül. Ha a felhasználó azt akarja, hogy "indítsd újra mindenkit most", az Assistente / Capitano-nak ír, és egyikük meghívja a `spawn-agent`-et célpontonként, vagy megkéri a Dottore-t, hogy hagyja ki a kaput (egy jövőbeli explicit paraméter, nem az MVP-ben).
- ❌ **Az egyes ágensek folyamatban lévő feladatának pillanatképe**. Ma az újraindítás arra épít, hogy az ágens újraolvassa a DB-t + a capture-pane-t a `/tmp/`-ben. Egy megfelelő átadás (minden ágens kiírja "mit csináltam + következő lépés" kilépés előtt) prompt-változásokat igényel mind a 10 ágensnél — külön BACKLOG követésként nyomon követve.
- ❌ **`~/.jht/preferences.json` olvasás** felhasználónkénti óra/ablak hangoláshoz. Az MVP keményen kódolja a 03:00 UTC ± 30 percet, 23 órás anti-csapkodást. Ha a felhasználó nem-EU időzónában van és más ablakot akar, szerkeszti ezt a skill fájlt (vagy megvárja a preferences.json hook követését).
- ❌ **A `.team-halted.flag` felülírása**. Ha a felhasználó leállította a csapatot, nincs hullám. Pont.
