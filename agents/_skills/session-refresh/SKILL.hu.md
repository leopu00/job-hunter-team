---
name: session-refresh
description: "Csak a Dottore számára. Kontextus-frissítési kör: minden agent-munkamenethez végezz egy retrospektívet (kor + széles capture + interjú + analitika), fűzz egy sűrű szintézist a folyamatosan bővülő napi naplóhoz, majd KILL + újra létrehozás + a munkamenet folytatása a folytatási kontextussal — így az agent kontextusablaka kitisztul anélkül, hogy elveszne, hol tartott. Munkaablakonként 2× fut le (+30 percnél és a felezőpontnál). Kihagyja a friss munkameneteket, és soha nem indít újra olyan munkamenetet, amelyet a Capitano szándékosan félretett."
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
- **Sorrend**: a worker-munkamenetek ELŐSZÖR (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), a felhasználó felé néző munkamenetek UTOLJÁRA és óvatosan (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). Soha ne frissítsd a `DOTTORE` / `DOCTOR-WATCHDOG` munkamenetet (saját magadat / az ütemezőt).
- **FRESH kihagyás**: `age = now - session_created`. Ha `age < 40 min` → teljesen KIHAGYNI (még nincs mit összefoglalni, és a frissítés eldobna egy épp elindult munkamenetet). Naplózd: `action=skipped_fresh`.

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
  "action": "recreated",         # recreated | skipped_parked | skipped_fresh
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Step 7 — újra létrehozás + folytatás (csak ha NEM friss és NEM parkolt)
Atomi frissítés — a kontextust már befogtad a Step 2-ben, így a kill biztonságos:
```bash
ROLE=<role>; N=<instance>      # from analytics; recreate the SAME number (no dice — the die is for NEW spawns only)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>."
```
Állítsd be a naplóbejegyzésben: `resume_msg_sent=True`. Aztán lépj a következő munkamenetre (tempó: ~15-20s az agentek között).

## Szabályok
- **Egy Dottore intézi az összes munkamenetet ebben a körben** (felhasználói sorrend: egyelőre egyetlen Dottore). Használd a fájlalapú capture + grep megoldást, hogy soha ne robbantsd fel a saját kontextusablakodat.
- **Soha** ne hozd újra létre könnyelműen a `CAPITANO`/`SENTINELLA` munkameneteket — ezek az orkesztráció/szívverés; csak akkor frissítsd őket, ha a kontextusuk egyértelműen felduzzadt, előzetes figyelmeztetés után, a sorrendben utolsóként.
- **Soha** ne `tmux new-session` kézzel — mindig `start-agent.sh` (lásd `spawn-agent`).
- Naplózz minden műveletet a naplóban (`recreated`/`skipped_parked`/`skipped_fresh`) — a napló az audit-nyom, és minden nap bővül.
