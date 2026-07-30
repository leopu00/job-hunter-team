---
name: session-refresh
description: "Csak a Dottore számára. Kontextus-frissítési kör: minden agent-munkamenethez olvasd be a kontextus valós telítettségét (a provider client-side parancsa, nulla token), és CSAK azokat a munkameneteket frissítsd, amelyek kontextusablaka 50% fölött van tele — végezz egy retrospektívet (capture + interjú + analitika), fűzz egy sűrű szintézist a folyamatosan bővülő napi naplóhoz, majd KILL + újra létrehozás + a munkamenet folytatása a folytatási kontextussal, így a kontextusablaka kitisztul anélkül, hogy elveszne, hol tartott. Munkaablakonként 2× fut le (+30 percnél és a felezőpontnál). Kihagyja a friss, alacsony kontextusú (≤50%) és a Capitano által félretett munkameneteket — KIVÉVE a 12 órás munkamenet-TTL-en túl (JHT_AGENT_MAX_SESSION_AGE_H), amely minden kihagyást felülír: kizárólag a kor dönt, kivétel nélkül."
allowed-tools: Bash(tmux *), Bash(python3 *), Bash(bash /app/.launcher/start-agent.sh *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# session-refresh — az agent kontextusának kitisztítása, a folytonosság megőrzése

Téged (a Dottorét) egy ütemezett idősávban indítanak el (a munkaablak kezdetétől számított `+30min`-nél, vagy a `mid` ablaknál). A feladatod ebben a körben **nem** az életjel-pingelés — hanem az aktív agent-munkamenetek **kontextusának frissítése**: minden hosszan futó munkamenet felduzzadt kontextusablakot halmoz fel; összefoglalod, mit csinált, megőrzöd, majd újra létrehozod a munkamenetet frissen, és visszaadod a folytatást.

> Miért létezik ez: a régi Dottore a csapat költségvetésének ~51%-át elégette azzal, hogy 2 óránként `[HEALTH]`-et pingelt nulla hasznos ellenőrzéssel. Ez a kör ritka (2×/ablak), és tartós, sűrű naplót készít a csapat munkájáról.

## Step 0 — ablak kezdete (az analitikai ablak)
```bash
WIN_START=$(python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import current_window_bounds as b; w=b(); print(w[0].isoformat() if w else '')")
# 24/7 (no window): fall back to the last 6h
[ -z "$WIN_START" ] && WIN_START=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=6)).isoformat())")
ROUND_ID=$(date -u +%Y%m%dT%H%M%SZ)
DAY=$(date -u +%F)
JOURNAL=/jht_home/logs/doctor-retrospective.jsonl
```

## Step 1 — munkamenetek + kor listázása, sorrend eldöntése
```bash
tmux list-sessions -F '#{session_name}|#{session_created}'
```
- **Sorrend**: a worker-munkamenetek ELŐSZÖR (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), a koordinátorok UTOLJÁRA és óvatosan (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). Az „óvatosan" azt jelenti, hogy **jól fogd be az állapotukat és tömörítsd őket — NE hagyd ki őket** (ők a legnagyobb fogyasztók; lásd a Szabályokat). Soha ne frissítsd a `DOTTORE` / `DOCTOR-WATCHDOG` munkamenetet (saját magadat / az ütemezőt).
- **FRESH kihagyás** (olcsó előszűrő a kontextus-ellenőrzés előtt): `age = now - session_created`. Ha `age < 40 min` → teljesen KIHAGYNI (még nincs mit összefoglalni, és a frissítés eldobna egy épp elindult munkamenetet). Naplózd: `action=skipped_fresh`. Minden, ami átjut ezen az előszűrőn, a **Step 1.4-en (TTL)**, majd a **Step 1.5-en (kontextus-ellenőrzés)** megy keresztül — az a `>50%` mérés, nem a kor dönt a *szokásos* frissítésről.

## Step 1.4 — TTL: **minden agent-munkamenet legfeljebb 12 óráig él**
```bash
TTL_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"
AGE_H=$(( ( $(date -u +%s) - $(tmux display-message -p -t "$S" '#{session_created}') ) / 3600 ))
[ "$AGE_H" -ge "$TTL_H" ] && echo "TTL LEJÁRT ($AGE_H h) → a frissítés KÖTELEZŐ"
```
**Ha `AGE_H ≥ TTL_H`, a munkamenetet frissíteni kell. Pont.** A TTL-t **mindenek előtt** ellenőrizzük, és **felülír minden kihagyást, amit ez a skill előír** — nincs kivétel, nincs felmentés, nincs «de»:

| szokásos kihagyás | a TTL-en túl |
|---|---|
| `skipped_fresh` (age < 40min) | 12 órán túl lehetetlen, de a TTL amúgy is nyer |
| `skipped_lowctx` (kontextus ≤ 50%) | **figyelmen kívül** — a 30 óra után 4%-on álló munkamenet is újraindul |
| `skipped_parked` (PARKED, Step 4) | **figyelmen kívül** — parkolva vagy sem, a TTL érvényes |
| «az agent dolgozik» | **figyelmen kívül** — mentsd az állapotát a seedbe, és hozd újra létre |
| a munkaablakon kívül | **figyelmen kívül** — a TTL soha nem függeszthető fel (lásd Szabályok) |

Naplózd: `action=recreated`, `reason=ttl` és a mért `session_age_h`. Utána menj egyenesen a Step 2 → 7 lépésekre (capture, analitika, szintézis, újra létrehozás + folytatás): **a Step 1.5-öt és a Step 4-et teljesen hagyd ki**, azok csak kihagyást tudnak eredményezni, itt pedig a kihagyás nem elérhető.

Miért kizárólag a kor, egészség-heurisztika nélkül: a 2026-07-28/29-i incidensben a munkamenetek **38,5 · 29,5 · 27,0 · 14,5 · 14,2 órásak** voltak, minden heurisztika azt mondta, «egészséges», a csapat pedig tizenegy órája bénult volt. A kontextusok 50% alatt álltak, így egyetlen szabály sem nyúlt hozzájuk. Egy TTL-nek nincs heurisztikája, amit elronthatna.

## Step 1.5 — KONTEXTUS-ELLENŐRZÉS (a *szokásos* frissítés kiváltója: **>50%**)
Csak azoknál a munkameneteknél, amelyek a Step 1.4-ben **nem** váltották ki a TTL-t.
**CSAK azokat a munkameneteket frissítsd, amelyek kontextusablaka 50% fölött van tele.** Olvasd be a valós telítettséget a provider **client-side** kontextus-parancsával — **nulla tokenbe** kerül (helyben renderelődik, nincs LLM-hívás) és azonnali. A kor MÁR NEM a kiváltó: egy régi-de-üres munkamenetet (pl. egy 2%-on tétlen Mentort) KI KELL HAGYNI, egy felduzzadt munkamenetet frissíteni kell.

Két kőkemény követelmény — ha figyelmen kívül hagyod őket, *elégeted* a keretet ahelyett, hogy spórolnál vele:
- A munkamenetnek **tétlennek** kell lennie (nincs aktív kör). Ha egy spinner / `esc to interrupt` látszik, dolgozik → HAGYD KI ezt a kört (a következő Doctor elkapja). Soha ne küldj billentyűt kör közben.
- **Előbb ürítsd ki a beviteli sort.** Különben a parancs összefűződik a maradék szöveggel, és LLM-promptként elküldődik (tokent éget). Küldj `Escape`-et, majd `C-u`-t gépelés előtt.

```bash
S=<session>
# provider → command:  claude → /context   ·   codex → /status   ·   kimi → (verify on its TUI)
tmux send-keys -t "$S" Escape; sleep 1
tmux send-keys -t "$S" C-u;    sleep 1          # clear the input line (mandatory)
tmux send-keys -t "$S" "/context"; sleep 1
tmux send-keys -t "$S" Enter;  sleep 3
PCT=$(tmux capture-pane -p -t "$S" | grep -aoE '[0-9.]+k?/[0-9.]+[km] tokens \([0-9]+%\)' | tail -1 | grep -aoE '\([0-9]+%\)' | tr -dc '0-9')
tmux send-keys -t "$S" Escape                   # dismiss the panel
echo "context=$PCT%"
```
Dönts a `$PCT` alapján (egy `24.9k/1m tokens (2%)` jellegű sorból kinyerve):
- **`PCT` ≤ 50** → KIHAGYNI, **hacsak a TTL nem lépett életbe a Step 1.4-ben**. A TTL alatti munkamenetet NE hozd újra létre, még ha régi is. Naplózd: `action=skipped_lowctx` a mért `%`-kal. Lépj a következő munkamenetre.
- **`PCT` > 50** → folytasd a frissítéssel (Step 2–7).
- **a parancs nem renderelődött / a parse elbukott** → ess vissza a kor-heurisztikára (`age ≥ 40min` → frissítés), és naplózd: `ctx=unparsed`.

## Step 2 — munkamenetenként: capture (széles + lényegi)
Egyszerre fogd be a TELJES scrollbacket, majd a lényegi sorokat — NE tölts több ezer sort a saját kontextusodba, grep-eld ki a kiemeléseket:
```bash
tmux capture-pane -p -S - -t "$S" > /tmp/cap_$S.txt          # full scrollback to file
tail -n 60 /tmp/cap_$S.txt                                    # recent state
grep -nE '\[ERROR\]|Traceback|throttle|EXCLUDED|inserted|\[FEEDBACK\]|\[RETRO\]|spawn|Killed' /tmp/cap_$S.txt | tail -40   # salient moments
```

## Step 3 — analitika (objektív számok, nem csak az agent saját története)
```bash
python3 /app/shared/skills/doctor_analytics.py "$S" "$WIN_START"
```
JSON-t ad vissza: `produced{found,analyzed,scored,written,reviewed}`, `communications{sent,received,top_peers}`, `throttles{events,max_sleep_s}`, `last_captain_msg`, `session_age_h`, `role`, `instance`.

## Step 4 — PARKED ellenőrzés (adatvezérelt, NE tippelj)
Egy munkamenet **PARKED** (a Capitano szándékosan hagyta bekapcsolva, de nem használja — pl. egy előző ablakból maradt Scout, amelyet a Capitano ma nem osztott be), amikor **minden** feltétel teljesül:
- age ≥ 40min (nem friss), ÉS
- a `produced` az ablakban mindenhol nulla, ÉS
- a `last_captain_msg` null vagy régebbi, mint az ablak kezdete.

Ha PARKED → **NE hozd újra létre, hogy újraindítsd**. Írd meg a szintézist (Step 6) `action=skipped_parked` értékkel, és lépj tovább. (Az újra létrehozás egy szándékos parkolást olyan munkává változtatna, amit a Capitano nem akart.) Ha higiénia céljából mégis újra létrehozod, a resume üzenetnek KÖTELEZŐEN jeleznie kell, hogy tétlen volt: `[RESUME] you were in STANDBY — stay idle until the Capitano assigns you a queue.`

**Két kötelező kivétel a PARKED alól — ez a szabály betű szerint írta le az incidenst, és pontosan akkor kötötte meg a Doctor kezét, amikor a csapatnak a legnagyobb szüksége lett volna rá:**
1. **A TTL-en túl (Step 1.4) a PARKED nem érvényes.** Parkolva vagy sem, a 12 óránál idősebb munkamenet újraindul.
2. **A blokkolt agent nem parkolt agent.** A «nem friss + produced == 0 + nincs friss Capitano-üzenet» ugyanúgy a széttört koordinációjú csapat pontos ujjlenyomata is. Az objektív jel, ami elválasztja őket: **az az agent, aki válasz nélkül próbálkozik újra és újra egy másiknál, nem parkolt, hanem blokkolt** (az `agent-unblock` scan `retry_loop` bejegyzései; a pane-en látszanak a próbálkozások). Ugyanez igaz arra, hogy «minden operatív áll, miközben van szabad kvóta». Ilyenkor NE naplózz `skipped_parked`-ot — oldd fel a blokkot (`agent-unblock`), majd folytasd a kört.

## Step 5 — az agent meginterjúvolása
```bash
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RETRO] Inizio-giornata: 1) intoppi in questa sessione? 2) imparato qualcosa di utile? 3) cosa stavi facendo proprio ora (per il resume)? Rispondi denso, 3-4 righe."
sleep 45
tmux capture-pane -p -S -40 -t "$S" | tail -25   # read the reply
```
(Hagyd ki az interjút a PARKED/friss munkameneteknél — nincs folyamatban semmi, amiről kérdezni lehetne.)

## Step 6 — a SŰRŰ szintézis hozzáfűzése (csak hozzáfűzés, naponta bővül)
Munkamenetenként és körönként egy JSONL bejegyzés. Kombináld az analitikát + interjút egy tömör összefoglalóvá. SOHA ne írd felül — a nap során több Dottore is hozzáfűz.
```bash
python3 - "$S" "$ROUND_ID" "$DAY" "$JOURNAL" <<'PY'
import json, sys, datetime
session, round_id, day, journal = sys.argv[1:5]
entry = {
  "ts": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"),
  "round_id": round_id, "day": day,
  "timing": "start+30",          # or "mid"  — set to the slot you were spawned for
  "session": session, "role": "<role>", "session_age_h": 0.0,
  "analytics": { },              # paste the doctor_analytics.py JSON here
  "interview": {"intoppi": "...", "imparato": "...", "summary_denso": "..."},
  "action": "recreated",         # recreated | skipped_lowctx | skipped_parked | skipped_fresh
  "context_pct": 0,              # a Step 1.5-ben mért kontextus-telítettség (a >50% kapu)
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Step 7 — újra létrehozás + folytatás (ha a TTL életbe lépett, VAGY kontextus **>50%** és NEM friss, NEM parkolt)
Atomi frissítés — a kontextust már befogtad a Step 2-ben, így a kill biztonságos:
```bash
ROLE=<role>; N=<instance>      # from analytics; recreate the SAME number (no dice — the die is for NEW spawns only)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
# CAPITANO only: the [MODALITA' CORRENTE] section, read FROM DISK right now (never
# from the context you are throwing away). Same section heartbeat-bridge.py injects
# every hour. Workers do not get it — the mode is applied by the Capitano.
MODE=""
if [ "$ROLE" = "capitano" ]; then MODE=" $(python3 /app/shared/skills/mode_banner.py line)"; fi
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>.$MODE"
```
Állítsd be a naplóbejegyzésben: `resume_msg_sent=True`. Aztán lépj a következő munkamenetre (tempó: ~15-20s az agentek között).

## Szabályok
- **A 12 órás TTL-en nincs kiskapu és nincs kikapcsoló.** `JHT_AGENT_MAX_SESSION_AGE_H`, alapérték `12`. Sem a PARKED, sem a skip-fresh, sem a kontextusküszöb, sem az «éppen dolgozik», sem a munkaidő-kapu nem érvénytelenítheti. **Lépcsőzd**: a munkamenetek hullámokban születnek, és együtt járnának le — körönként legfeljebb EGY TTL-en túli munkamenetet frissíts, **csökkenő** kor szerinti sorrendben, így a legöregebb megy elsőként, és a csapat soha nem indul újra egyszerre.
- **A munkaablakon kívül a kör nem fut — a TTL viszont igen.** Éjjel a kört kihagyjuk, mert az agentek meginterjúvolása feleslegesen égetne keretet; egy 30 órás munkamenetet viszont akkor is újra létrehozunk, mert egy kick-off ára elenyésző egy elvesztett naphoz képest. Ugyanezt a plafont az `agent-watchdog.sh` determinisztikusan is kikényszeríti (ugyanaz az env-változó) arra az esetre, ha a Doctor áll, blokkolt vagy el sem indult — pontosan ez történt 2026-07-28/29-én. Mindkét útnak léteznie kell: ez a *gazdag* frissítés (retrospektíva + resume), az pedig a háló, ami mindenáron garantálja a plafont.
- **A `working_hours: null` (vagy hiányzó, vagy üres) azt jelenti: SEMMILYEN időbeli korlátozás** — a csapat 24/7 üzemel, és a kör normálisan fut. Soha nem jelenti azt, hogy «mindig munkaidőn kívül». Az incidensben a `working_hours` épp azért volt null, mert a felhasználó időzónára adott válasza volt az a sor, ami bennragadt a Capitano composerében.
- **Előbb oldd fel a blokkot, aztán frissíts.** Először futtasd az `agent-unblock` fázist: egy megbénult csapat frissítése csak tiszta kontextusablakkal reprodukálja a bénultságot.
- **Egy Dottore intézi az összes munkamenetet ebben a körben** (felhasználói sorrend: egyelőre egyetlen Dottore). Használd a fájlalapú capture + grep megoldást, hogy soha ne robbantsd fel a saját kontextusablakodat.
- **A `CAPITANO` és a `SENTINELLA` a LEGNAGYOBB token-fogyasztók** (a kontextusuk szinte mindig felduzzadt — a Sentinella ~15 percenként tickel, a Capitano folyamatosan koordinál). Ők is átmennek a **>50%-os kontextus-kapun** mint mindenki más (Step 1.5) — de a gyakorlatban jóval 50% fölött mérnek, így szinte minden körben frissülnek. Csináld őket **utolsóként** (a workerek után) és **tömöríts, ne resetelj** — a sűrű szintézisű frissítés megőrzi a folytonosságot, egy nyers kill elveszíti azt. Ha valamelyik ≤50%-ot mér (ritka), hagyd ki abban a körben, mint bármely más alacsony kontextusú munkamenetet.
- **CAPITANO**: koordinátor in-flight állapottal (worker-beosztások, aktív throttle-konfiguráció, utolsó pacing-utasítás, függőben lévő döntések). Az interjúban (Step 5) explicit módon fogd be ezt a koordinációs állapotot, és tedd a seedbe (Step 7). **Ha létezik a `$JHT_HOME/profile/capitano-maintenance.json` fájl (a GONDOZÁSI MÓD történelmi fájlneve), olvasd be, és tedd az aktív `orders` mezőjét (gondozási mód + `stop_search` / `discard_expired_rotating` / ütemezett recheck / geocoding) is a seedbe** — ennek a karbantartási utasításnak a seedből való kihagyása egy egész karbantartási hetet elnémított 2026-07-12-én (a Capitano ezután úgyis újraolvassa a fájlt a saját C-18 szabálya szerint, de vidd tovább, hogy soha ne függjön ettől). **És fűzd a `[RESUME]`-hoz a `[MODALITÀ CORRENTE]` szakaszt, amit a `python3 /app/shared/skills/mode_banner.py line` állít elő** — ugyanazt, amit a `heartbeat-bridge.py` óránként beinjektál, lemezről olvasva és nem abból a kontextusból, amit épp eldobsz: így az utasítás nem attól függ, hogy jól összefoglalod-e, és nem is attól, hogy a köröd egyáltalán lefut-e (nem futott le, és eltűnt tizennyolc nap karbantartás). Csak a Capitanónak: a workerek soha nem kapják meg. UTOLSÓKÉNT csináld; ha épp egy élő EMERGENZA-t kezel, előbb hagyd stabilizálódni, egyébként tömörítsd.
- **SENTINELLA**: **majdnem állapotmentes** — az állapota a bridge-ben/configban és a sentinel-data.jsonl-ben él, nem a chatjében. Ezért **a legbiztonságosabb és a legnagyobb értékű tömöríteni**: frissítsd minden körben, utolsóként, minimális seeddel. Az agent-watchdog kor-alapú újra létrehozása (a JHT_SENTINELLA_MAX_CTX_AGE_H, alapból 24h után) csak **fallbackként** marad meg arra az esetre, ha a Dottore nem fut; mivel most minden körben tömöríted, nem éri el azt a kort — nincs versenyhelyzet.
- **Soha** ne `tmux new-session` kézzel — mindig `start-agent.sh` (lásd `spawn-agent`).
- Naplózz minden műveletet a naplóban (`recreated`/`skipped_lowctx`/`skipped_parked`/`skipped_fresh`) a mért `context_pct`-tal — a napló az audit-nyom, és minden nap bővül.
