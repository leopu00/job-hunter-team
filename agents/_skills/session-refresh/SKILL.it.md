---
name: session-refresh
description: "Solo Dottore. Round di refresh del contesto: per ogni sessione agente esegui una retrospettiva (eta' + cattura ampia + intervista + analytics), accoda una sintesi densa al giornale giornaliero che cresce, poi KILL + ricrea + riprendi la sessione con il contesto di continuazione — cosi' la finestra di contesto dell'agente viene azzerata senza perdere il punto in cui si trovava. Gira 2 volte per finestra di lavoro (a +30min e a meta'). Salta le sessioni fresche e non riavvia mai una sessione che il Capitano ha deliberatamente parcheggiato."
allowed-tools: Bash(tmux *), Bash(python3 *), Bash(bash /app/.launcher/start-agent.sh *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# session-refresh — azzera il contesto dell'agente, mantieni la continuita'

Tu (il Dottore) vieni avviato in uno slot pianificato (`+30min` dall'inizio della finestra di lavoro, oppure a `mid` finestra). In questo round il tuo compito **non** e' il ping di liveness — e' **rinfrescare il contesto** delle sessioni agente attive: ogni sessione long-running accumula una finestra di contesto gonfia; tu riassumi cosa ha fatto, la rendi persistente, poi ricrei la sessione da zero e le restituisci la continuazione.

> Perche' esiste: il vecchio Dottore bruciava ~51% del budget del team facendo ping `[HEALTH]` ogni 2h con zero controlli utili. Questo round e' raro (2 volte/finestra) e produce un giornale denso e durevole del lavoro del team.

## Step 0 — inizio finestra (la finestra di analytics)
```bash
WIN_START=$(python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import current_window_bounds as b; w=b(); print(w[0].isoformat() if w else '')")
# 24/7 (nessuna finestra): ricadi sulle ultime 6h
[ -z "$WIN_START" ] && WIN_START=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=6)).isoformat())")
ROUND_ID=$(date -u +%Y%m%dT%H%M%SZ)
DAY=$(date -u +%F)
JOURNAL=/jht_home/logs/doctor-retrospective.jsonl
```

## Step 1 — elenca le sessioni + eta', decidi l'ordine
```bash
tmux list-sessions -F '#{session_name}|#{session_created}'
```
- **Ordine**: PRIMA le sessioni worker (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), per ULTIME e con cura quelle rivolte all'utente (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). Non rinfrescare mai `DOTTORE` / `DOCTOR-WATCHDOG` (te stesso / lo scheduler).
- **Salto FRESH**: `age = now - session_created`. Se `age < 40 min` → SALTA del tutto (non c'e' ancora nulla da riassumere, e rinfrescarla butterebbe via una sessione appena partita). Logga `action=skipped_fresh`.

## Step 2 — per sessione: cattura (ampia + saliente)
Cattura UNA volta l'intero scrollback, poi le righe salienti — NON caricare migliaia di righe nel tuo contesto, fai il grep degli highlight:
```bash
tmux capture-pane -p -S - -t "$S" > /tmp/cap_$S.txt          # scrollback completo su file
tail -n 60 /tmp/cap_$S.txt                                    # stato recente
grep -nE '\[ERROR\]|Traceback|throttle|EXCLUDED|inserted|\[FEEDBACK\]|\[RETRO\]|spawn|Killed' /tmp/cap_$S.txt | tail -40   # momenti salienti
```

## Step 3 — analytics (numeri oggettivi, non solo il racconto dell'agente)
```bash
python3 /app/shared/skills/doctor_analytics.py "$S" "$WIN_START"
```
Restituisce JSON: `produced{found,analyzed,scored,written,reviewed}`, `communications{sent,received,top_peers}`, `throttles{events,max_sleep_s}`, `last_captain_msg`, `session_age_h`, `role`, `instance`.

## Step 4 — controllo PARKED (basato sui dati, NON tirare a indovinare)
Una sessione e' **PARKED** (il Capitano l'ha deliberatamente lasciata accesa ma non la sta usando — es. uno Scout rimasto dalla finestra precedente che il Capitano non ha assegnato oggi) quando valgono **tutte** queste condizioni:
- age ≥ 40min (non fresca), E
- `produced` e' tutto-zero nella finestra, E
- `last_captain_msg` e' null o piu' vecchio dell'inizio della finestra.

Se PARKED → **NON** ricrearla per riavviarla. Scrivi la sintesi (Step 6) con `action=skipped_parked` e prosegui. (Ricrearla trasformerebbe un parcheggio deliberato in lavoro che il Capitano non voleva.) Se la ricrei comunque per igiene, il messaggio di resume DEVE dire che era idle: `[RESUME] eri in STANDBY — resta idle finche' il Capitano non ti assegna una coda.`

## Step 5 — intervista l'agente
```bash
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RETRO] Inizio-giornata: 1) intoppi in questa sessione? 2) imparato qualcosa di utile? 3) cosa stavi facendo proprio ora (per il resume)? Rispondi denso, 3-4 righe."
sleep 45
tmux capture-pane -p -S -40 -t "$S" | tail -25   # leggi la risposta
```
(Salta l'intervista per le sessioni PARKED/fresche — non c'e' nulla in volo su cui chiedere.)

## Step 6 — accoda la sintesi DENSA (append-only, cresce ogni giorno)
Una voce JSONL per agente per round. Combina analytics + intervista in un riepilogo serrato. NON sovrascrivere MAI — piu' Dottori nell'arco della giornata accodano tutti.
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

## Step 7 — ricrea + riprendi (solo se NON fresca e NON parcheggiata)
Refresh atomico — hai gia' catturato il contesto nello Step 2, quindi il kill e' sicuro:
```bash
ROLE=<role>; N=<instance>      # from analytics; recreate the SAME number (no dice — the die is for NEW spawns only)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>."
```
Imposta `resume_msg_sent=True` nella voce del giornale. Poi passa alla sessione successiva (ritmo ~15-20s tra un agente e l'altro).

## Regole
- **Un solo Dottore fa tutte le sessioni in questo round** (ordine dell'utente: per ora un solo Dottore). Usa la cattura su file + grep cosi' da non far mai esplodere la tua finestra di contesto.
- **Mai** ricreare `CAPITANO`/`SENTINELLA` alla leggera — sono l'orchestrazione/heartbeat; rinfrescali solo se il loro contesto e' chiaramente gonfio e dopo un preavviso, per ultimi nell'ordine.
- **Mai** `tmux new-session` a mano — sempre `start-agent.sh` (vedi `spawn-agent`).
- Logga ogni azione nel giornale (`recreated`/`skipped_parked`/`skipped_fresh`) — il giornale e' la traccia d'audit e cresce ogni giorno.
