# 📐 `proj` volatile nel pacing — da rifinire (TODO, NON ancora toccato)

**Data:** 2026-06-20 · **Stato:** 🟡 **DEFERRED di proposito** (sistema delicato, esperimenti live in
corso, sta funzionando). · **Tag BACKLOG:** `[PACING-PROJ-VOLATILE]`. · **Lane:** pacing/dev1
(`sentinel-bridge.py` + `pacing-bridge.py` + `compute_metrics.py` + prompt Sentinella/Capitano).

> **Decisione utente (2026-06-20):** «non mi piace basare azioni su un dato volatile, ma sta
> funzionando e il team Codex va bene; non voglio metterci mano ora rischiando di rompere una parte
> delicata su cui si basa tutto. Appuntiamocelo e lo faremo prossimamente. Intanto osserviamo come se
> la cava il team **Kimi da domenica** (più soggetto a sbagliare: budget più basso + intelligenza
> inferiore).»

## 1. 🎯 Il problema concettuale

Alcune decisioni del **bridge** sono gatate su `proj` (proiezione), che è un **dato volatile** (naive
extrapolation: oscilla ±400pt tick-to-tick). I prompt dicono già al team di **ignorare proj** e usare
`vel_team` vs `vel_target`, ma il **bridge stesso** continua a gatear su proj. Basare azioni su un dato
volatile non è ideale → da rifinire verso segnali velocity-based (più stabili).

## 2. 🔍 Distinzione cruciale (verificata nel codice)

Ci sono **DUE** proiezioni, da non confondere:

**(a) `proj_weekly`** (il **168%** che si vede su betaA in finestra di lavoro) — `compute_metrics.py:312`
= `weekly_usage + velocità_attuale × ore_al_reset`. È **INFO-only** (commento esplicito `:307` «NON
guida lo status»), scritto **solo nel log `sentinel-data.jsonl`**, **NON** in nessun messaggio al team
(grep confermato: 0 occorrenze in f-string/tmux verso gli agenti). → **Il team NON lo vede.** Il 168%
appariva solo nei report perché lo estraevo io dal log per diagnosi. **Non disturba nessuno** = campo
diagnostico (utile per analisi tipo il weekly-burn). **Nessuna azione necessaria** su questo.

**(b) `proj` (finestra 5h)** = `entry["projection"]`. **QUESTO** è team-facing **e** usato dal bridge:
- **Messaggi**: `[BRIDGE TICK]` (`sentinel-bridge.py:1474` → Sentinella) e `[BRIDGE PACING]`
  (`pacing-bridge.py:746/757/788` → Capitano) lo mostrano come `proj=X%` con l'annotazione lunga «INFO,
  segnale secondario volatile: NON guida le decisioni, usa vel». → **rumore "ti mostro un numero ma
  ignoralo" nel contesto LLM** ad ogni tick.
- **Gate INTERNI del bridge (Python, non LLM)** che ci si basano:
  - **g-spot wake** (`sentinel-bridge.py:117-118` GSPOT_LOWER 80 / GSPOT_UPPER 105, `_is_in_gspot` :209)
    → decide **SE** svegliare la Sentinella.
  - **scala di throttle suggerito** (`compute_metrics.py:319-334`: proj>100 → 120-600s).
  - **coast/stall** (`pacing-bridge.py:505` `proj < STALL_PROJ_THRESHOLD` 70 → spreco/coast).
  Togliere proj dal calcolo **romperebbe questi gate** (usano `entry["projection"]`, non la stringa).

## 3. 🛠️ Opzioni (analizzate, NON implementate)

- **A (più semplice):** togliere `proj=X%` + l'annotazione "ignoralo" dai **messaggi** TICK/PACING e
  dai prompt; **tenere** proj nel gate interno + nel log. Declutter del contesto LLM, **zero cambi di
  comportamento** (i gate leggono il dict, non la stringa). NB resta il problema concettuale: il bridge
  gatea ancora su un dato volatile, solo non lo *mostra* più.
- **B:** mostrare proj nel messaggio **solo quando actionable** (fuori dal g-spot, cioè quando è proprio
  il motivo del wake). "Show-on-demand", più logica condizionale.
- **C (il vero fix concettuale, più ambizioso):** spostare i **gate** del bridge da `proj` (volatile) a
  segnali **velocity-based** (`vel_team`/`vel_target`, già preferiti dai prompt) → il g-spot wake, il
  coast e la scala throttle diventano funzione di velocità smussata invece della proiezione che oscilla.
  È il fix che chiude davvero "non basarsi su un dato volatile", ma tocca il cuore del pacing.

## 4. ⏸️ Perché DEFERRED + cosa osservare

- **NON toccare ora:** parte delicatissima su cui si basa tutto il controllo; esperimenti live (Codex
  in pace, Kimi in osservazione). Un errore qui rompe il pacing dell'intera flotta.
- **Osservazione collegata — Kimi/betaB da DOMENICA:** reset weekly **Dom 21/06 19:11 Rome** → primo
  ciclo **intero** sull'immagine col recheck-on-demand (no più storm). Kimi è il caso peggiore (budget
  più basso, modello meno intelligente) → è lì che un pacing basato su dato volatile fa più danni.
  **VERIFICARE dal 21/06:** betaB NON riesaurisce presto come prima? Il gate g-spot/throttle si
  comporta bene col budget Kimi? Se Kimi va male, è il segnale per prioritizzare l'opzione C.

**Riferimenti:** [[project_usage_redesign_validated_betaB]] (weekly burn), `2026-06-17-betaB-kimi-weekly-burn-finding.md`.
