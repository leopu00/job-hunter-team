---
name: session-refresh
description: "Solo Dottore. Round di refresh del contesto: per ogni sessione agente leggi l'occupazione reale del contesto (comando client-side del provider, zero token) e rinfresca SOLO le sessioni con finestra di contesto piena oltre il 50% — esegui una retrospettiva (cattura + intervista + analytics), accoda una sintesi densa al giornale giornaliero che cresce, poi KILL + ricrea + riprendi la sessione con il contesto di continuazione, cosi' la finestra di contesto viene azzerata senza perdere il punto in cui si trovava. Gira 2 volte per finestra di lavoro (a +30min e a meta'). Salta le sessioni fresche, a basso contesto (≤50%) e quelle parcheggiate dal Capitano — TRANNE oltre il TTL di 12h della sessione (JHT_AGENT_MAX_SESSION_AGE_H), che ha la precedenza su ogni salto: decide solo l'eta', senza eccezioni."
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
ROUND_HEADS_UP_SENT=0
```

## Step 1 — elenca le sessioni + eta', decidi l'ordine
```bash
tmux list-sessions -F '#{session_name}|#{session_created}'
```
- **Ordine**: PRIMA le sessioni worker (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), i coordinatori per ULTIMI e con cura (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). "Con cura" significa **catturane bene lo stato e compattali — NON saltarli** (sono i top consumer; vedi Regole). Non rinfrescare mai `DOTTORE` / `DOCTOR-WATCHDOG` (te stesso / lo scheduler).
- **Salto FRESH** (pre-filtro economico prima del controllo contesto): `age = now - session_created`. Se `age < 40 min` → SALTA del tutto (non c'e' ancora nulla da riassumere, e rinfrescarla butterebbe via una sessione appena partita). Logga `action=skipped_fresh`. Tutto cio' che supera questo pre-filtro passa per lo **Step 1.4 (TTL)** e poi per lo **Step 1.5 (controllo contesto)** — e' quella misura `>50%`, non l'eta', a decidere il refresh *ordinario*.

## Step 1.4 — TTL: **ogni sessione agente vive al massimo 12 ore**
```bash
TTL_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"
AGE_H=$(( ( $(date -u +%s) - $(tmux display-message -p -t "$S" '#{session_created}') ) / 3600 ))
[ "$AGE_H" -ge "$TTL_H" ] && echo "TTL SCADUTO ($AGE_H h) → refresh OBBLIGATORIO"
```
**Se `AGE_H ≥ TTL_H` la sessione va rinfrescata. Punto.** Il TTL si controlla **prima** di tutto il resto e **annulla ogni salto previsto in questa skill** — nessuna eccezione, nessuna deroga, nessun «pero'»:

| salto normale | oltre il TTL |
|---|---|
| `skipped_fresh` (age < 40min) | impossibile oltre le 12h, ma il TTL vince comunque |
| `skipped_lowctx` (contesto ≤ 50%) | **ignorato** — una sessione al 4% dopo 30h si ricrea lo stesso |
| `skipped_parked` (PARKED, Step 4) | **ignorato** — parcheggiata o no, il TTL si applica |
| «l'agente sta lavorando» | **ignorato** — cattura il suo stato nel seed e ricrea |
| fuori dalla finestra di lavoro | **ignorato** — il TTL non si sospende mai (vedi Regole) |

Logga `action=recreated` con `reason=ttl` e il `session_age_h` misurato. Poi vai dritto agli Step 2 → 7 (cattura, analytics, sintesi, ricrea + riprendi): **salta del tutto lo Step 1.5 e lo Step 4**, possono solo produrre un salto e qui il salto non e' disponibile.

Perche' solo l'eta', senza euristiche di salute sopra: nell'incidente del 2026-07-28/29 le sessioni avevano **38,5 · 29,5 · 27,0 · 14,5 · 14,2 ore**, ogni euristica diceva «sano» e il team era paralizzato da undici ore. I contesti erano sotto il 50%, quindi nessuna regola le ha toccate. Un TTL non ha euristiche da sbagliare.

## Step 1.5 — CONTROLLO CONTESTO (il trigger del refresh *ordinario*: **>50%**)
Solo per le sessioni che **non** hanno fatto scattare il TTL allo Step 1.4.
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
- **`PCT` ≤ 50** → SALTA **a meno che il TTL non sia scattato allo Step 1.4**. NON ricreare una sessione sotto il TTL, anche se e' vecchiotta. Logga `action=skipped_lowctx` con la `%` misurata. Passa alla successiva.
- **`PCT` > 50** → procedi al refresh (Step 2–7).
- **comando non renderizzato / parse fallito** → ricadi sull'euristica dell'eta' (`age ≥ 40min` → refresh) e logga `ctx=unparsed`.

## Step 1.6 — avvisa il Capitano una volta, prima del primo refresh
Solo quando questo giro ha selezionato il primo vero target di refresh (TTL o
contesto), manda un heads-up al Capitano **prima dello Step 2**. Non ripeterlo
per ogni agente e non mandarlo se il giro produrra' soltanto skip:
```bash
if [ "$ROUND_HEADS_UP_SENT" -eq 0 ]; then
  if /app/agents/_skills/tmux-send/jht-tmux-send CAPITANO "[@dottore -> @capitano] [HEADS-UP] Inizia il context refresh: worker prima, coordinatori ultimi, tu per ultimo. Non avviare incarichi brevi fino al report di completamento."; then
    ROUND_HEADS_UP_SENT=1
  else
    echo "Consegna HEADS-UP fallita — interrompi il rich refresh prima di ogni recreate"
    exit 1
  fi
fi
```
E' coordinamento, non un secondo scheduler ne' una richiesta di permesso. Il
giro resta sequenziale e il Capitano rimane vivo fino alla fine. La consegna e'
una precondizione: un exit nonzero del sender interrompe il giro prima di
capture/kill; non marcare mai come inviato un heads-up fallito.

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

**Due eccezioni tassative al PARKED — questa regola descriveva l'incidente alla lettera e ha tenuto ferme le mani del Dottore proprio quando al team serviva di piu':**
1. **Oltre il TTL (Step 1.4) il PARKED non si applica.** Parcheggiata o no, una sessione da 12h+ si ricrea.
2. **Un agente bloccato non e' un agente parcheggiato.** «non fresca + produced == 0 + nessun messaggio recente del Capitano» e' anche l'impronta esatta di un team con il coordinamento rotto. Il segnale oggettivo che li separa: **un agente che ritenta verso un altro agente senza risposta non e' parcheggiato, e' bloccato** (le voci `retry_loop` dello scan di `agent-unblock`, e nel pane si vedono i tentativi). Idem per «tutti gli operativi fermi con quota disponibile». In quei casi NON loggare `skipped_parked` — sciogli il blocco (`agent-unblock`), poi prosegui il giro.

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

## Step 7 — ricrea + riprendi (se e' scattato il TTL, OPPURE contesto **>50%** e NON fresca, NON parcheggiata)
Refresh atomico — hai gia' catturato il contesto nello Step 2, quindi il kill e' sicuro:
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
Imposta `resume_msg_sent=True` nella voce del giornale. Poi passa alla sessione successiva (ritmo ~15-20s tra un agente e l'altro).

## Regole
- **Il TTL di 12h non ha scappatoie ne' interruttore.** `JHT_AGENT_MAX_SESSION_AGE_H`, default `12`. Ne' PARKED, ne' skip-fresh, ne' la soglia di contesto, ne' «sta lavorando», ne' il gate orario possono annullarlo. **Scaglionalo**: le sessioni nascono a ondate e scadrebbero insieme — rinfresca al massimo UNA sessione oltre il TTL per passata, ordinando per eta' **decrescente**, cosi' la piu' vecchia va per prima e il team non viene ricreato tutto in un colpo.
- **Fuori dalla finestra di lavoro il giro non gira — ma il TTL si'.** Di notte il giro si salta perche' intervistare gli agenti brucerebbe budget per nulla; una sessione di 30 ore si ricrea comunque, perche' un kick-off non costa nulla rispetto a una giornata persa. `agent-watchdog.sh` applica lo stesso tetto in modo deterministico (stessa env var) per quando il Dottore e' fermo, bloccato o mai spawnato — che e' esattamente quel che e' successo il 2026-07-28/29. I due percorsi devono esistere entrambi: questo e' il refresh *ricco* (retrospettiva + resume), quello e' la rete che garantisce il tetto a qualsiasi costo.
- **`working_hours: null` (o assente, o vuoto) significa NESSUNA restrizione oraria** — il team e' 24/7 e il giro gira normalmente. Non significa mai «sempre fuori orario». Nell'incidente `working_hours` era null proprio perche' la risposta dell'utente sul fuso orario era la riga rimasta appesa nel composer del Capitano.
- **Sblocca prima di rinfrescare.** Esegui prima la fase `agent-unblock`: rinfrescare un team paralizzato ne ricrea la paralisi con una finestra di contesto pulita.
- **Un solo Dottore fa tutte le sessioni in questo round** (ordine dell'utente: per ora un solo Dottore). Usa la cattura su file + grep cosi' da non far mai esplodere la tua finestra di contesto.
- **CAPITANO e SENTINELLA sono i TOP consumer di token** (il loro contesto è quasi sempre gonfio — la Sentinella ticchetta ogni ~15min, il Capitano coordina in continuazione). Passano comunque per il **gate del contesto >50%** come tutti gli altri (Step 1.5) — ma in pratica misurano ben oltre il 50%, quindi vengono rinfrescati quasi ogni giro. Falli per **ultimi** (dopo i worker) e **compatta, non resettare** — il refresh con sintesi densa preserva la continuità, un kill secco la perde. Se uno misura ≤50% (raro), saltalo quel giro come qualsiasi altra sessione a basso contesto.
- **CAPITANO**: è il coordinatore con stato in-flight (assegnazioni worker, throttle attivo, ultimo ordine di pacing, decisioni pendenti). Nell'intervista (Step 5) cattura esplicitamente quello stato di coordinamento e mettilo nel seed (Step 7) così non perde il filo. **Se `$JHT_HOME/profile/capitano-maintenance.json` esiste (nome file storico della MODALITÀ CURA), leggilo e metti nel seed anche i suoi `orders` attivi (modalità cura + `stop_search` / `discard_expired_rotating` / recheck cadenzato / geocoding)** — togliere quell'ordine di modalità cura dal seed ha silenziato un'intera settimana di cura il 2026-07-12 (il Capitano poi rilegge comunque il file per la sua regola C-18, ma portalo avanti così da non dipendere mai da quello). **E accoda al `[RESUME]` la sezione `[MODALITÀ CORRENTE]` prodotta da `python3 /app/shared/skills/mode_banner.py line`** — la stessa che `heartbeat-bridge.py` inietta ogni ora, letta da disco e non dal contesto che stai buttando: così l'ordine non dipende né dal fatto che tu lo riassuma bene né dal fatto che il tuo giro parta (non è partito, e sono spariti diciotto giorni di manutenzione). Solo al Capitano: i worker non la ricevono mai. Fallo per ULTIMO; se sta gestendo un'EMERGENZA dal vivo (orchestrazione visibile nel pane proprio ora), lascia che si stabilizzi prima, altrimenti compattalo.
- **SENTINELLA**: è **near-stateless** — il suo stato operativo vive nel bridge/config e in `sentinel-data.jsonl`, non nella sua chat. Questo la rende la **più sicura e di maggior valore da compattare**: rinfrescala ogni giro, per ultima, con un seed minimo: `[RESUME] sei la Sentinella; il tuo stato vive nel bridge + sentinel-data.jsonl — riprendi il monitoraggio del pacing dal prossimo tick.` Il recreate per-età dell'`agent-watchdog` (oltre `JHT_SENTINELLA_MAX_CTX_AGE_H`, default 24h) resta solo come **fallback** per quando il Dottore non gira; dato che ora la compatti ogni giro non raggiungerà quell'età, quindi nessun race.
- **Mai** `tmux new-session` a mano — sempre `start-agent.sh` (vedi `spawn-agent`).
- Logga ogni azione nel giornale (`recreated`/`skipped_lowctx`/`skipped_parked`/`skipped_fresh`) con la `context_pct` misurata — il giornale e' la traccia d'audit e cresce ogni giorno.
