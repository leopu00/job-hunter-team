# 🛰️🧭 Rapporto Sentinella ↔ Capitano — osservazione dal vivo (2026-06-26)

**VPS:** betaA/Codex (203.0.113.10) · **Finestra:** mattina, ciclo pulito (apertura 06:00 UTC)
**Contesto:** primo ciclo intero dopo il redesign push→pull + gerarchia ribaltata
(`8971ffb34`) + heartbeat-bridge (`3bab28fb5`). Lettura diretta dei pane tmux di
SENTINELLA e CAPITANO. Modalità: osservazione (no intervento sul team).

**Verdetto:** il rapporto funziona **esattamente come ridisegnato**. La Sentinella
*consiglia*, il Capitano *interpreta, verifica con le skill e decide* — a volte
raffinando o **scavalcando** il consiglio letterale quando ha ragione lui.

---

## Il dialogo, episodio per episodio

### ① 06:30–06:45 — WEEKLY-BIND/COAST
- 🛰️ **Sentinella** → *"Suggerisco COAST, NON spawnare worker per riempire la coda…
  lascia scorrere la coda residua, tieni i throttle. Decidi tu."*
- 🧭 **Capitano** → tiene, niente spawn. ✅ Consiglio accolto.

### ② 08:00 — bordo reset (l'unico punto critico)
- 🛰️ **Sentinella** rileva `proj=308.8%` (>200 = trigger emergenza skill) → **freeza
  7 operativi** con `freeze_team.py`, POI avvisa: *"FREEZATO… Nota: reset_in=0.00h
  può amplificare il proj; suggerisco attendi tick post-reset prima di riaprire."*
- 🧭 **Capitano** → **verifica** (usage 1%, reset confermato, code vuote, throttle a 0)
  e **decide di NON spawnare** ("SCOUT-3 e SCOUT-4 erano già vivi"). I due Scout erano
  bloccati in una **schermata di scroll** del TUI ("q to quit") → invece di clonarli
  (sarebbe stato l'overspawn C-08) legge la skill spawn-doctor, manda `q` per uscire
  dal pager e ri-consegna il kick-off. Verifica che tornino *Working*.

> ⚠️ Il freeze è un **falso positivo da bordo-reset** (denominatore →0 gonfia `proj`).
> Fix tracciato in `BACKLOG.md` → `[PACING-RESET-EDGE-FREEZE]`.

### ③ 08:30 — PACING-SFORO MIRATO
- 🛰️ **Sentinella** → *"scout-4 brucia 65% share. Suggerisco: NO global reset, NO
  throttle a tutto il team; throttle MIRATO scout-4. Decidi tu."*
- 🧭 **Capitano** → **non esegue alla cieca**:
  1. fa `bridge_mailbox.py drain` e **rilegge i dati grezzi** dello stesso tick 08:30
     (cross-check indipendente);
  2. legge le skill `sentinel-orders / throttle / bridge-pacing`;
  3. **verifica** che scout-3 sia vivo prima di toccare nulla;
  4. applica il throttle a scout-4 (nota da solo che la ladder arrotonda al gradino);
  5. **va oltre il consiglio**: vede che il batch ha prodotto 10 righe → controlla
     `next-for-analista` → riattiva ANALISTA-6 a drenare. *La Sentinella non glielo
     aveva detto.*
  - Chiusura: *"Applied targeted throttle to scout-4. No global reset… Reused
    ANALISTA-6… No new Scout spawned."*

---

## Il pattern del Capitano (il cuore del fix)

Ogni ordine Sentinella → il Capitano fa
**drain mailbox (cross-check) → legge la skill → cattura il pane del worker (verifica) → decide**.
E decide *davvero*: nell'episodio ② ha **scavalcato** lo "SCALA UP / spawn" perché gli
Scout erano vivi (solo incagliati nel pager). **Niente più "aspetto il prossimo pacing
tick"** → l'incaglio di betaB è sparito.

Sul lato Sentinella: ogni messaggio è `[@sentinella -> @capitano]`, sempre formulato
*"Suggerisco… Decidi tu"*, mai un ordine globale cieco. Throttle sempre **mirati** (un
worker, mai tutto il team). Daily sano per tutta la mattina: `oggi=4-5%` vs `cap=17%`.

**In sintesi: l'aggiornamento del rapporto è promosso a pieni voti.** La Sentinella
consiglia mirato, il Capitano verifica e decide (anche contro il consiglio quando ha
ragione lui), e il team resta nel budget.

---

## 🔧 Bug scoperto leggendo i pane: il throttle non scalava (FIXATO 2026-06-26)

Nell'episodio ③ il bridge suggeriva `throttle scout-4 +120` (120s). Ma il **floor del
throttle è 5min (300s)** (`THROTTLE_LADDER`, 2026-06-21). Indagando:

- `_throttle_delta_for_sforo()` in `pacing-bridge.py` tornava increment **15/30/60/120s**
  — **tutti sotto il floor 300s** → `quantize()` li collassava TUTTI a 300s. Risultato:
  il throttle **non scalava mai** (un drift 2%/h e un runaway 18%/h prendevano lo stesso
  5min). Lo "scaling con lo sforo" era una finzione.
- Il `+` era cosmetico: `set` è assoluto (`int('+120')==120`), il modello "increment
  per-tick" non ha mai funzionato post-ladder.
- Il comando citava `jht-throttle.py set …` (script inesistente / sintassi sbagliata):
  il vero comando per settare il config di un altro agente è `throttle-config.py set`.

**Fix** (`pacing-bridge.py`): `_throttle_target_for_sforo()` torna ora valori **ASSOLUTI
agganciati alla ladder**, scalati con lo sforo — `300/600/900/1200/1800s` (5/10/15/20/30
min). Comando corretto `throttle-config.py set <agent> <sec>`. Ramo MARGINE: il `-{thr}`
(negativo, che `set` rifiutava) → `set <agent> 0` (togli il freno). Verifica:

```
sforo  1.5%/h → 300s  (5min)
sforo    4%/h → 600s  (10min)
sforo    8%/h → 900s  (15min)
sforo 18.66%/h → 1200s (20min)   ← scout-4 dell'episodio ③: 20min, non l'inutile 5min
sforo   40%/h → 1800s (30min)
```

> Residuo: le skill `throttle / sentinel-orders / bridge-pacing` (×7 lingue) citano
> ancora `jht-throttle.py` e gli increment vecchi — da riallineare nel giro i18n.
