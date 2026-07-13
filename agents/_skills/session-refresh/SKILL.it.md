---
name: session-refresh
description: "Solo Dottore. Round di refresh del contesto: per ogni sessione agente leggi l'occupazione reale del contesto (comando client-side del provider, zero token) e rinfresca SOLO le sessioni con finestra di contesto piena oltre il 50% — esegui una retrospettiva (cattura + intervista + analytics), accoda una sintesi densa al giornale giornaliero che cresce, poi KILL + ricrea + riprendi la sessione con il contesto di continuazione, cosi' la finestra di contesto viene azzerata senza perdere il punto in cui si trovava. Gira 2 volte per finestra di lavoro (a +30min e a meta'). Salta le sessioni fresche, a basso contesto (≤50%) e quelle parcheggiate dal Capitano."
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
- **Ordine**: PRIMA le sessioni worker (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), i coordinatori per ULTIMI e con cura (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). "Con cura" significa **catturane bene lo stato e compattali — NON saltarli** (sono i top consumer; vedi Regole). Non rinfrescare mai `DOTTORE` / `DOCTOR-WATCHDOG` (te stesso / lo scheduler).
- **Salto FRESH** (pre-filtro economico prima del controllo contesto): `age = now - session_created`. Se `age < 40 min` → SALTA del tutto (non c'e' ancora nulla da riassumere, e rinfrescarla butterebbe via una sessione appena partita). Logga `action=skipped_fresh`. Tutto cio' che supera questo pre-filtro passa per lo **Step 1.5 (controllo contesto)** — e' quella misura `>50%`, non l'eta', a decidere il refresh.

## Step 1.5 — CONTROLLO CONTESTO (il trigger del refresh: **>50%**)
**Rinfresca SOLO le sessioni con finestra di contesto piena oltre il 50%.** Leggi l'occupazione reale con il comando di contesto **client-side** del provider — costa **zero token** (reso in locale, nessuna chiamata all'LLM) ed e' istantaneo. L'eta' NON e' piu' il trigger: una sessione vecchia-ma-vuota (es. un Mentor idle al 2%) va SALTATA, una sessione gonfia va rinfrescata.

Due requisiti tassativi — ignorarli fa *bruciare* budget invece di risparmiarlo:
- La sessione DEVE essere **idle** (nessun turno attivo). Se c'e' uno spinner / `esc to interrupt`, sta lavorando → SALTA questo giro (la prende il prossimo Dottore). Mai inviare tasti a turno in corso.
- **Svuota prima la riga di input.** Altrimenti il comando si concatena col testo residuo e viene inviato come prompt all'LLM (brucia token). Manda `Escape` poi `C-u` prima di digitare.

```bash
S=<session>
# provider → comando:  claude → /context   ·   codex → /status   ·   kimi → (verifica sul suo TUI)
tmux send-keys -t "$S" Escape; sleep 1
tmux send-keys -t "$S" C-u;    sleep 1          # svuota la riga di input (obbligatorio)
tmux send-keys -t "$S" "/context"; sleep 1
tmux send-keys -t "$S" Enter;  sleep 3
PCT=$(tmux capture-pane -p -t "$S" | grep -aoE '[0-9.]+k?/[0-9.]+[km] tokens \([0-9]+%\)' | tail -1 | grep -aoE '\([0-9]+%\)' | tr -dc '0-9')
tmux send-keys -t "$S" Escape                   # chiudi il pannello
echo "context=$PCT%"
```
Decidi da `$PCT` (estratto da una riga tipo `24.9k/1m tokens (2%)`):
- **`PCT` ≤ 50** → SALTA. NON ricreare, anche se la sessione e' vecchia. Logga `action=skipped_lowctx` con la `%` misurata. Passa alla successiva.
- **`PCT` > 50** → procedi al refresh (Step 2–7).
- **comando non renderizzato / parse fallito** → ricadi sull'euristica dell'eta' (`age ≥ 40min` → refresh) e logga `ctx=unparsed`.

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
  "action": "recreated",         # recreated | skipped_lowctx | skipped_parked | skipped_fresh
  "context_pct": 0,              # occupazione contesto misurata nello Step 1.5 (il gate >50%)
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Step 7 — ricrea + riprendi (solo se contesto **>50%**, NON fresca, NON parcheggiata)
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
- **CAPITANO e SENTINELLA sono i TOP consumer di token** (il loro contesto è quasi sempre gonfio — la Sentinella ticchetta ogni ~15min, il Capitano coordina in continuazione). Passano comunque per il **gate del contesto >50%** come tutti gli altri (Step 1.5) — ma in pratica misurano ben oltre il 50%, quindi vengono rinfrescati quasi ogni giro. Falli per **ultimi** (dopo i worker) e **compatta, non resettare** — il refresh con sintesi densa preserva la continuità, un kill secco la perde. Se uno misura ≤50% (raro), saltalo quel giro come qualsiasi altra sessione a basso contesto.
- **CAPITANO**: è il coordinatore con stato in-flight (assegnazioni worker, throttle attivo, ultimo ordine di pacing, decisioni pendenti). Nell'intervista (Step 5) cattura esplicitamente quello stato di coordinamento e mettilo nel seed (Step 7) così non perde il filo. Fallo per ULTIMO; se sta gestendo un'EMERGENZA dal vivo (orchestrazione visibile nel pane proprio ora), lascia che si stabilizzi prima, altrimenti compattalo.
- **SENTINELLA**: è **near-stateless** — il suo stato operativo vive nel bridge/config e in `sentinel-data.jsonl`, non nella sua chat. Questo la rende la **più sicura e di maggior valore da compattare**: rinfrescala ogni giro, per ultima, con un seed minimo: `[RESUME] sei la Sentinella; il tuo stato vive nel bridge + sentinel-data.jsonl — riprendi il monitoraggio del pacing dal prossimo tick.` Il recreate per-età dell'`agent-watchdog` (oltre `JHT_SENTINELLA_MAX_CTX_AGE_H`, default 24h) resta solo come **fallback** per quando il Dottore non gira; dato che ora la compatti ogni giro non raggiungerà quell'età, quindi nessun race.
- **Mai** `tmux new-session` a mano — sempre `start-agent.sh` (vedi `spawn-agent`).
- Logga ogni azione nel giornale (`recreated`/`skipped_lowctx`/`skipped_parked`/`skipped_fresh`) con la `context_pct` misurata — il giornale e' la traccia d'audit e cresce ogni giorno.
