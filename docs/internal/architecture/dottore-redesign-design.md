# 🩺 Design-doc — Ridisegno ruolo DOTTORE (context-refresh)

> **Stato:** DRAFT — schema/flow da lockare prima di codare (design-doc-first).
> **Owner:** dev1 (prompt dottore + doctor-watchdog scheduling + skill orchestrazione) · dev2 (analytics-da-log + formato file-sintesi). dev3 = lead/review (in deploy fix#4+Analista in parallelo).
> **Data:** 2026-06-13. **Ordine utente:** "implementa tutto, fatti aiutare da dev2, procedi".

## 🎯 Obiettivo (dal brainstorm utente)
Oggi i Dottori **sprecano token e non servono**. Nuovo ruolo = **rigeneratori di contesto**: a inizio/metà giornata fanno la retrospettiva di ogni agente, ne sintetizzano l'attività su un file crescente, poi **rigenerano la sessione** (kill+ricrea+riavvia) passando il contesto, per ripulire il context-window accumulato. NON troppo spesso.

## 🔴 Problema attuale (evidenza, non opinione)
- `doctor-watchdog.sh` spawna 1 Dottore **ogni 2h**; il Dottore fa `liveness-check` = ping `[HEALTH]` a ogni agente.
- Pacing-log live 11/06: `dottore=2.88%/h, share 51%, cadenza 0.00/min (0 chk in 11m)` → **#1 consumatore del team (51%)** facendo 0 lavoro reale. Il Capitano gli tirava throttle. = "spreca token".
- `dottore-actions.jsonl` = 179KB di giri quasi tutti ping liveness.

## 🧱 Stato attuale — RIUSO > reinvento (da analisi codice+VPS)
ESISTE:
- `agents/dottore/dottore.md` (+6 locali) — prompt one-shot health-check.
- `.launcher/doctor-watchdog.sh` — loop ogni 2h, gate working-hours/halt.
- `.launcher/spawn-doctor.sh` — spawn idempotente (kill DOTTORE*, REPL-check, inietta prompt).
- `.launcher/start-agent.sh` — kill+ricrea+avvia sessione (multi-provider, i18n, skill, kick-off). **È il meccanismo di refresh.**
- `#{session_created}` letto in `dashboard_server.py:280-298` → età sessione.
- `agents/_skills/liveness-check` (capture-pane -S -200 + 10 pattern + respawn atomico), `daily-restart-wave` (restart 1×/giorno con capture→db-query→kill→start-agent→kick-off), `cache-prune`, `py-tools-audit`, `cv-disk-audit`.
- Log: `dottore-actions.jsonl`, dir `dottore-captures/`, `messages.jsonl`, `throttle-events.jsonl`, `sentinel-data.jsonl`, DB jobs.db.
- `working_hours.py` (gate ON/OFF, wrap-around mezzanotte).

NON ESISTE (da creare):
- Scheduling **2×/sessione** (+30min dall'inizio finestra ON, +6h = metà di 12h) — oggi è "ogni 2h" cieco.
- **Retrospettiva+intervista** per-agente (capture ampio + domande intoppi/learning).
- **Sintesi densa in APPEND** su file giornaliero crescente, con **analytics dai log** (pos inserite, intoppi, comunicazioni).
- Logica **"non riattivare parcheggiate / non toccare fresche"** basata su età sessione + stato Capitano.

## 🆕 Design nuovo

### A. Scheduling (dev1 — doctor-watchdog.sh)
- Non più "ogni 2h". Il watchdog calcola l'inizio della finestra ON corrente (da working_hours) e spawna il Dottore SOLO a:
  - **T+30min** dall'inizio finestra (calibrazione: dopo mezz'ora il Capitano ha deciso chi lavora).
  - **T+6h** (metà di una finestra 12h; in generale metà-finestra).
- Idempotenza: `doctor-schedule-state.json` conserva per ogni slot sia il claim
  pre-spawn (`claimed_t30` / `claimed_mid`) sia l'esito (`did_t30` /
  `did_mid`). Il claim usa replace atomico + fsync: senza persistenza non parte
  alcun turno LLM; un esito incerto resta claimed e non viene duplicato. Reset
  a nuova finestra. Lo stesso protocollo possiede il fallback 24/7, prima
  mantenuto soltanto in RAM dal watchdog.
- Gate invariati: OFF → niente spawn; `.team-halted.flag`/`.weekly-halt.flag` → niente.
- Generalizzazione: gli offset (+30min, +mid) derivati dalla durata finestra, non hardcoded a 12h.

### B. Flusso retrospettiva per-agente (dev1 — skill `session-refresh`)
Per ogni sessione tmux WORKER + coordinatore (ordine: worker prima, user-facing dopo, come daily-restart-wave):
1. **Età sessione**: `tmux display-message -p -t <S> '#{session_created}'`. Se **troppo fresca** (< SOGLIA, es. < 90min o < T+30 della finestra) → SKIP (niente da rigenerare).
2. **Capture-pane ampio**: `capture-pane -p -S -` (tutto lo scroll-back) + capture mirate su momenti salienti.
3. **Intervista**: `[@dottore -> @<agent>] [RETRO] Intoppi in questa sessione? Imparato qualcosa? Cosa stavi facendo ora?` → leggi risposta.
4. **Analytics dai log** (dev2 fornisce lo script): per quell'agente → pos inserite/scored (DB), throttle subiti (throttle-events), con chi ha comunicato (messages.jsonl). 
5. **Sintesi densa in APPEND** su `/jht_home/logs/session-journal.md` (o .jsonl): blocco per (data, agente, sessione, durata, analytics, intervista, intoppi). Più dottori nello stesso giorno → append (mai overwrite).
6. **Context-refresh** (solo se la sessione NON è parcheggiata, vedi C): capture già fatto → `kill-session` → `start-agent.sh <role> <N>` → kick-off lungo "[RESUME] Eri a metà di X, avevi fatto Y, continua da Z".

### C. Regola PARCHEGGIATE / FRESCHE (dev1 — la più delicata)
- **Parcheggiata** = sessione viva ma che il Capitano ha deciso di NON far lavorare (es. Scout acceso dalla sessione precedente, non assegnato stamattina). Segnali: nessuna attività token recente + nessuna coda assegnata + il Capitano non la elenca tra gli attivi. → Il Dottore **NON la ricrea per farla ripartire**. Fa la sintesi, e se la rigenera le da' contesto "[RESUME] eri FERMO/in standby, resta in standby finché il Capitano non ti assegna". Mai trasformare un parcheggio in lavoro.
- **Fresca** = `session_created` recente (< soglia) → SKIP totale (niente retro, niente refresh).
- Come distinguere "attiva" da "parcheggiata" — RISOLTO data-driven (contratto dev2): `doctor_analytics.py` espone `produced` (count nella finestra) + `last_captain_msg` (ultimo ordine del Capitano a quella sessione, da messages.jsonl). Regola: sessione **vecchia** (non fresca) + `produced==0` nella finestra + nessun `last_captain_msg` recente ⇒ **PARCHEGGIATA** → NON ricreare-per-far-ripartire; sintetizza e (se rigeneri) da' contesto "[RESUME] eri in standby, resta finché il Capitano non ti assegna". Niente intervista-al-Capitano fragile.

### D. Deprecazione del vecchio comportamento
- Il ping `[HEALTH]` liveness ogni 2h → rimosso/ridotto. La liveness (zombie) resta come check rapido SOLO se serve, non come attività principale. Il nuovo Dottore non "pinga per pingare".

## 🔀 Split per-file (anti-collisione)
- **dev1**: `agents/dottore/dottore.md`, `.launcher/doctor-watchdog.sh`, nuova skill `agents/_skills/session-refresh/` (orchestrazione + regole parcheggiate/fresche + scheduling helper).
- **dev2**: `shared/skills/doctor_analytics.py` + writer del file-sintesi. Vedi CONTRATTO sotto (lockato).
- dev3 in deploy fix#4+Analista: file disgiunti (lui pacing/sentinel-bridge, noi doctor-watchdog/dottore/doctor_analytics).

## 📑 CONTRATTO (lockato — proposto da dev2 + concordato dev1)
**Script analytics (dev2):** `python3 shared/skills/doctor_analytics.py <SESSION> <since_iso>` → JSON per-agente:
```
{session, role, instance, session_created, session_age_h, window:{since,until},
 produced:{found,analyzed,scored,written},   // jobs.db, count by-<role>+timestamp nella finestra
 communications:{sent,received,top_peers[]}, // messages.jsonl (from/to)
 throttles:{events,max_sleep_s},             // throttle log = "intoppi"
 last_captain_msg,                           // ultimo ordine Capitano a quella sessione (skip-parked)
 notes:[...]}
```
La skill `session-refresh` (dev1) lo chiama e versa i numeri nella sintesi + decide skip-parked/fresh.

**File sintesi (writer dev2):** `/jht_home/logs/doctor-retrospective.jsonl` (append-only, 1 entry per agente-per-round, cresce ogni giorno). Schema:
```
{ts, round_id, day, timing:"start+30"|"mid+6h", session, role, session_age_h,
 analytics:{...da script...},
 interview:{intoppi, imparato, summary_denso},   // riempito da dev1 dall'intervista
 action:"recreated"|"skipped_parked"|"skipped_fresh", resume_msg_sent:bool}
```
(Opzionale: render `.md` umano giornaliero, dev2 lo aggiunge se l'utente lo vuole.)

**Soglie:** fresca = `session_age` < **40min** (skip totale); parcheggiata = vecchia + `produced==0` nella finestra + nessun `last_captain_msg` recente (skip-recreate-per-ripartire).

## ✅ Aperti / da confermare
- [x] dev2: analisi indipendente + split → CONVERGE, accettato; contratto sopra lockato.
- [x] Formato file-sintesi → `doctor-retrospective.jsonl` append-only (+ render .md opzionale).
- [x] Soglia "fresca" → 40min (poco oltre il +30).
- [x] Parcheggiate → data-driven via `produced==0` + `last_captain_msg` (no intervista-Capitano fragile).
- [ ] Un solo Dottore fa tutto (ordine utente); la skill gestisce N sessioni/giro con capture MIRATE (non tutto-in-memoria) per non esaurire il context.
- [ ] dev1: dettaglio "capture saliente" — euristica per i momenti salienti (es. ultime righe + righe con [ERROR]/[RETRO]/throttle/spawn).
