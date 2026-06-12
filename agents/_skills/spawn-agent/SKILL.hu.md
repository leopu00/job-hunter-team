<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: spawn-agent
description: "Elindit egy JHT csapat-agenst (Scout, Analista, Scorer, Scrittore, Critico, Assistente, Capitano-2) a launcheren keresztul, majd elkuldi a kick-off uzenetet, ami tenylegesen elinditja a fo ciklust. Csak Capitano — a Capitano a csapat skalazodasanak egyetlen tulajdonosa. MINDIG hasznald ezt a skillt: a `start-agent.sh` megkerulese `tmux new-session` + nyers `send-keys \"kimi ...\"` segitsegevel olyan munkameneteket hoz letre, ahol a CLI soha nem indul el (`command not found`), a Capitano \"elo\" munkamenetet lat, ami valojaban halott, es a csapat csoendesen alulteljesit."
allowed-tools: Bash(bash /app/.launcher/start-agent.sh *), Bash(tmux *), Bash(jht-tmux-send *), Bash(sleep *)
---

# spawn-agent — agens online hozasa

Ketfazisu szerzodes: a CLI **inditasa**, majd a ciklus **kick-off**-ja. A kick-off kihagyasa ures promptnal hagyja az agenst — a Capitano azt hiszi, dolgozik, de nem az.

## 1. fazis — inditas a `start-agent.sh` segitsegevel

```bash
bash /app/.launcher/start-agent.sh <role> [instance_number]
```

Peldak:
```bash
bash /app/.launcher/start-agent.sh scout 2       # SCOUT-2
bash /app/.launcher/start-agent.sh analista 1    # ANALISTA-1
bash /app/.launcher/start-agent.sh critico       # CRITICO (singleton, szam nelkul)
```

A launcher atomikusan vegzi:
- letrehozza a tmux munkamenetet a kanonikus nevvel (`SCOUT-2`, `ANALISTA-1`, …)
- beallitja a `cwd`-t a `$JHT_HOME/agents/<role>[-N]/` eleresi utra
- exportalja: `JHT_HOME · JHT_DB · JHT_AGENT_DIR · PATH · JHT_USER_DIR · JHT_CONFIG`
- felismeri az aktiv providert a `jht.config.json`-bol (claude / kimi / codex)
- atmasolja az `agents/<role>/<role>.md` fajlt a workspace-be mint `CLAUDE.md` / `AGENTS.md`
- elinditja a CLI-t a megfelelo flagekkel az adott provider + szint szamara

> ⚠️ **SOHA** ne inditsd `tmux new-session ... ; tmux send-keys "kimi ..."`-vel. A CLI nincs a `PATH`-ban a launcher kornyezeten kivul → `command not found` → a munkamenet csak bash. A Capitano `jht-tmux-send` parancsa `exit 0`-t ad vissza, miközben abba az ures bashbe ir, az uzenet csendben elveszik, es a csapat lathato ok nelkul alulteljesit.

## 2. fazis — kick-off (kotelezo)

A launcher elindtja a CLI-t, de **nem kuld elso uzenetet**. Kick-off nelkul az agens orokke egy ures promptnal var.

Standard sorrend:
```bash
bash /app/.launcher/start-agent.sh scout 1
sleep 12   # CLI boot 8-15s — soha nem kevesebb mint 10
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [MSG] <kick-off tartalom>"
```

### Kick-off tartalom szerepkor szerint

| Szerepkor   | Kick-off tartalom                                                                                            |
|-------------|--------------------------------------------------------------------------------------------------------------|
| `scout`     | "Inditsd el a fo ciklust. Olvasd el a promptodat, a jelolt profilt (`$JHT_HOME/profile/candidate_profile.yml`), es kezdj a KOR 1-nel (elsodelges preferencia). Ertesitsd az Analistakat 3-5 poziciobol allo kotegek utan." |
| `analista`  | "Inditsd el a fo ciklust. Sor: `db_query.py next-for-analista`. Minden pozicional toltsd ki az 5 kotelezo mezot es lepted elo `checked` vagy `excluded` allapotra." |
| `scorer`    | "Inditsd el a fo ciklust. Sor: `db_query.py next-for-scorer`. Elobb PRE-CHECK, aztan 0-100 pontszam. Kuszobok: <40 kizarva, 40-49 parkolas, ≥50 Scrittori ertesitese." |
| `scrittore` | "Inditsd el a fo ciklust. Sor: `db_query.py next-for-scrittore`. Maximalis erofeszites, 3 kotelezo kor a Criticoval. A PDF a `$JHT_USER_DIR/cv/` ala kerul." |
| `critico`   | "A szulo Scrittore hivni fog PDF + JD-vel. Egy vak felulvizsgalat hivasankent, aztan megallas." |
| `assistente`| "Inditsd el a fo ciklust. Varj `[@utente -> @assistente] [CHAT]` uzenetre a web UI-bol." |

Ha a pozicio-oneletrajz kontextus nem trivialis (az agens crash elott folyamatban levo munkaval rendelkezett), fuggeszd a kick-offhoz, hogy onnan folytassa, ahol abbahagyta — soha ne mondd csak azt, hogy "folytasd", mondd meg *mit* es *hol*:

```bash
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [MSG] Folytatas: pozicio #281 (Qargo TMS), a 2. kor a Criticoval eppen elkezdodott volna. Folytasd onnan, NE kezdd elolrol."
```

## 3. fazis — ellenorizd, hogy a boot sikeres volt

Korulbelul 5 masodperccel a kick-off utan:
```bash
tmux capture-pane -t <SESSION> -p | tail -10
```

Olvasd el a kimenetet:
- ✅ CLI banner + spinner + kick-off tartalom lathato a beviteli teruleten → boot OK
- 🟡 `context: 0.0%` es ures beviteli terulet → a kick-off nem erkezett meg, probald ujra egyszer
- 🔴 Shell prompt `jht@host:~/agents/<role>$` (nincs CLI) → launcher hiba, lasd a fallbacket lentebb

> Megjegyzes: a folyamatos egeszsegugyi ellenorzesek (zombi-felismeres, csendes agensek > 10 perc) NEM ennek a skillnek a feladata — a **Dottore** hataskorehez tartoznak a `liveness-check` skillen keresztul. Ez a skill akkor er veget, amikor a 3. fazis megerositi a bootot.

## Fallback — launcher hiba

Ha a 3. fazis csupasz shell promptot mutat (nincs CLI elindtva), elobb ellenorizd:

```bash
tmux capture-pane -t <SESSION> -p -S -50 | grep -iE "command not found|permission denied|no such file"
```

Valoszinu okok:
1. A provider CLI nincs a launcher kornyezetenek `PATH`-jaban → ellenorizd, hogy a `jht.config.json`-ban levo provider megegyezik-e a telepitett CLI-vel
2. A szerepkor-sablon `agents/<role>/<role>.md` hianyzik → a launcher ures fajlt masol → a CLI elindul, de nincsenek utasitasai
3. A `$JHT_HOME` nincs beallitva / nincs exportalva a szuloben → eszkalalj a felhasznalohoz, NE probalj manualis beallitast

Old meg a hibas munkamenetet az ujraprobalas elott:
```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
```

## Anti-mintak

- ❌ Tobb agens inditasa szoros ciklusban 1-tick pacing nelkul — lasd a `pipeline-triage`-t a skalazasi szabalyokhoz (1 spawn Sentinel-tikkenent, ~5 perc kulonbseggel).
- ❌ Crash utan vakon ujrainditani anelkul, hogy `db_query.py`-t olvasnad az utolso task allapotanak visszaallitasahoz — az uj agens elolrol kezdi es duplikalja a munkat.
- ❌ Ennek a skillnek hasznalata egy mukodo agens "ujrainditasara", mert lassunk tunik. Lassu ≠ halott. Hosszu korok lathato token kimenettel nem spawn-eset — hanem `liveness-check`-eset (Dottore).
- ❌ Helyettesítő spawnolása, mert a `jht-tmux-send` nem tudott kézbesíteni. **`exit 4` = a cél TUI turn közben van (`Working … esc to interrupt`) → az ügynök ÉL, csak elfoglalt.** Az üzenet NEM lett szinkron módon kézbesítve: próbáld újra a küldést később, soha ne spawnolj klónt. Csak az `exit 3` (a szöveg soha nem jelent meg ÉS a pane nem elfoglalt → csupasz shell / beragadt modal) lehetséges-halott jel, és még akkor is a verdikt a **Dottore**-é (`liveness-check`), nem egy reflex spawn. Egy elfoglalt ügynökre spawnolni pontosan a 2026-06-07-es overspawn bug (`docs/internal/2026-06-11-overspawn-rootcause.md`): a klón átveszi az irányítást, miközben az eredeti zombie-ként tovább égeti a budgetet.
- ❌ Critico inditasa. A Scrittore onalloan inditja a sajat `CRITICO-S<N>`-jet — a Capitano soha nem nyul kozvetlenul a Criticohoz.

## Lasd meg

- `liveness-check` (Dottore) — amikor egy letezo agens halottnak tunik.
- `pipeline-triage` (Capitano) — *melyik* szerepkort inditsd a backlog alapjan.
- `tmux-send` — uzenet-borítek konvenciok.
- `agents/_team/team-rules.md` T01 — soha ne zarj be masik agens munkamenetet.
