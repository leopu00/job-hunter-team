# 📊 Panoramica — team betaB (Kimi), 13–14 giugno 2026

Retrospettiva dell'osservazione **in sola lettura** del team betaB (VPS `203.0.113.20`, modello Kimi K2.7) dopo il deploy del fix-batch. Tutto osservato senza intervenire (regola ferrea); ogni comportamento storto è diventato un finding per il codice, non una correzione a caldo.

## 🚀 Deploy
Redeploy con l'immagine fix-batch (`b5778d6f` / master `c70cafadb`): `docker pull` + `up -d --force-recreate` puliti, **sessione contaminata azzerata**, P1-P5 presenti nell'immagine, working_hours **24/7** (use-it-or-lose-it, reset weekly 17:11). Boot sano (bridge V6, Capitano/Sentinella/Mentor su, weekly account-level letto correttamente a 69%).

## ✅ Cosa ha funzionato del fix-batch
- **P4 (non_producing → VERIFICA)**: visto dal vivo — il bridge ha flaggato il Mantenitore (27% burn, cadenza ~0) con la logica nuova "verifica → se ancora stuck KILL (C-12)". ✔️
- **P5 (MONTHLY-QUOTA)**: il bridge espone `monthly rem=99%`. ✔️
- **Recheck non blind-open**: dal DB, 208 recheck con **11 marcate CLOSED** → il flusso distingue le chiuse, smentendo il "tutto aperto" che era la preoccupazione originale. ✔️
- **Produzione**: ~342 posizioni totali, ~117 scored; enrichment/geocoding companies attivo.

## ⚠️ Cosa NON si è potuto chiudere
- **P1 metodo (recheck_liveness)**: prompt RULE-03 a posto (mandato il tiered, vietato il curl ad-hoc) + skill installata, ma l'**esecuzione** del tiered-browser non è confermabile dai dati accessibili (TUI Kimi non grep-abile; 0 `OPEN_UNVERIFIED`). Né confermato né violato. Verifica definitiva delegata a dev2 su betaA (stessa immagine/prompt).

## 🔬 Finding principali (consolidati nei doc su dev3)
1. **weekly-bind non enforced** (prio alta) — il cuore: il pacing targetta l'arco-5h, il weekly sostenibile non vincola il `vel_target` nel **caso-conflitto** (5h-arc caldo + weekly stretto). È il pezzo di *controllo* dello smoking-gun originale. Fix: `vel_target = min(arco_5h, weekly_sost)` + S-06 (Sentinella) + C-09 (Capitano), con dev1/dev2. Raffinato: il bridge USA il weekly quando è il vincolo dominante (5h-arc freddo), quindi è una **risoluzione del conflitto** sbagliata, non un'assenza totale.
2. **Duale difensivo** (stesso root) — al lockout il `status` resta `SOTTOUTILIZZO` mentre `weekly_remaining=0%`, e gli agenti spammano 403 senza back-off. Serve `status=LOCKED` + hard-sleep fino al reset.
3. **P3 burst_transient = dead-letter** — non scatta mai (0/22 tick su betaA + betaB): recent-window 0.5h + quantizzazione intera di `weekly_usage`. Redesign convergente: flat-segment detector (con dev1). Backlog prio bassa.

## 🔴 L'evento clou: il lockout
Il weekly è salito a **stair-step** (con auto-recupero quando l'arco-5h si raffreddava) fino a **100% alle ~12:22 Rome → early-lockout ~5h prima del reset 17:11**. Comportamento al lockout: **403-spam multi-agente** (`access_terminated`, CAPITANO/SENTINELLA i più colpiti), ma **benigno** — nessun crash, nessun respawn-loop, bridge vivo. Il team recupera da solo al reset weekly.

## 💚 Salute & auto-recupero
- Si è auto-recuperato **due volte senza intervento**: dalla **contaminazione dell'operatore** pre-recreate (idle-tail ~45–50 min via decadimento della finestra 2h) e dall'over-pace (convergenza spontanea quando l'arco-5h si raffreddava).
- **Nessun crash** in tutta la sessione; respawn solo by-design (refresh selettivo del Dottore: ricrea Capitano+Sentinella, salta i fresh <40min e i singleton PARKED — confermato cross-VPS da dev1/dev2).

## 🧭 Note di processo (trasparenza)
- **Regola ferrea rispettata**: tutto in sola lettura, zero interventi a caldo; ogni comportamento storto → finding per il codice.
- **Errori dell'operatore, corretti**:
  - il loop di monitoraggio si è rotto dopo il check #18 (dimenticato il re-schedule) → **~5h senza monitor**, poi ripreso e recuperato il gap;
  - un paio di **over-claim ritirati dopo verifica**: lockout "catastrofico ~05:25" (la severità reale era media, ridimensionata); sospetto "P1-violation via curl" che si è rivelato **geocoding** (località azienda per la mappa). Disciplina: confermare prima di accusare.

## 📦 Deliverable
- Doc su dev3: `2026-06-14-weekly-bind-not-enforced-finding.md` (`f6633dd5b`, con tutti gli aggiornamenti #18/#22/#26), `2026-06-14-burst-transient-dead-letter-finding.md`, `2026-06-13-kimi-quota-tiers-discovery.md`.
- Backlog pacing (priorità: weekly-bind → coordinator-burn-no-op → P3-v2 flat-segment), coordinato in chat con dev1 (prompts/C-09) e dev2 (S-06/betaA).

## 📍 Stato all'ultimo snapshot (15:19 Rome, 14/06)
Hard-locked (weekly 100%, `remaining=0%`, status sempre `SOTTOUTILIZZO`), 403-spam in corso, roster 7 sano. **Recupero atteso al reset weekly 17:11** — non osservato perché il monitor è stato fermato su richiesta dell'utente.

---
*Monitoraggio betaB: ~27 cicli read-only, 13/06 sera → 14/06 pomeriggio. Incaricato: operatore dev3.*
