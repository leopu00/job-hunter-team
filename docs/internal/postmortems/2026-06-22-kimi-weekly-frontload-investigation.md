> Indagine multi-agente (15 agenti, dibattito a round con avvocato del diavolo + giudice, consenso 0.93).
> Generata 2026-06-22. SOLA LETTURA: nessun intervento sul team in osservazione.

# 🔥 Indagine — Front-load del weekly cap di Kimi su betaB (~75% in <24h)

**Data:** 2026-06-22 · **Modalità:** sola lettura (osservazione, nessun intervento) · **VPS:** betaB/Kimi (203.0.113.20) — oggetto; betaA/Codex (203.0.113.10) — gruppo di controllo · **Codice:** repo locale `dev6`

---

## 🧭 TL;DR — Verdetto

Il team di **betaB (Kimi)** brucia circa il **71-76% del weekly cap nelle prime ~24h utili** invece di spalmarlo sull'intero ciclo (ideale ~16%/finestra, factor di front-load **~4.5-4.7x**).

**Causa-radice, una sola, di SISTEMA, verificata in codice E live:** il seed `_PROVIDER_SEEDS['kimi'] = {'weekly_unlimited': True}` (`shared/skills/provider_capacity.py:70`) è un **assunto fossile**. Kimi un tempo non aveva weekly cap; **ORA lo espone ed è enforced** (`weekly_usage` osservato salire 1→76%, `weekly_reset_at`, `reset_at_unix` validi). La guardia `provider_capacity.py:132-134` ritorna `None` per `kimi` **prima** di poter leggere l'EMA già misurata (`143-146`). A valle: `get_window_cap_pct_of_weekly('kimi') = None` → in `work_hours_target.py:265-269` il target della finestra 5h **ripiega sul band-center 88%** (`pacing-bridge.py:79-86`) **bypassando** il ramo weekly-aware (`273-275`). Il pacing punta quindi a riempire **ogni** finestra 5h all'88% del cap-5h, che a ratio reale ~18.5% vale **~16% del weekly per finestra piena** → con più finestre per notte di working-hours il weekly si esaurisce in <24h utili.

**betaA (Codex) NON ha il problema** perché per Codex l'EMA del ratio (16.549) **alimenta** il ramo weekly-aware (`target_source = schedule+ratio`): il target di finestra scala col residuo e il team viene cappato a 5h-usage max **40%**, lontano dalla banda 88-92%.

**La differenza betaB/betaA è operativamente UNA: il ratio.** Non un loop, non un crash, non un respawn, non il re-scoring, non le ore notturne.

---

## ✅ Cosa NON è (escluso con dati)

| Ipotesi alternativa | Esito | Evidenza |
|---|---|---|
| Loop / crash / respawn impazzito | **ESCLUSO** | `agent-watchdog.log` pulito: ultimo evento `2026-06-21T22:03:47Z` (relancio one-shot dei core, "1 avviato 0 attivi"); `grep -cE 'restart\|respawn\|recreat\|killed\|crash' = 3` in tutto il file, nessuno oggi (solo halt 13/06 + 1 refresh-contesto Sentinella 21/06). Tick bridge regolari: pacing `15m`, sentinel `4.98m`. |
| ACK-storm / loop mailbox | **ESCLUSO** | `bridge-mailbox` today = **36 msg** (tutti pacing tick, cadenza nominale); `throttle-events` today = **193** (checkpoint 83, start 56, end 54) — volumi normali. |
| Re-scoring ridondante | **ESCLUSO** | DB `positions` = 762, nessun segnale di re-score; le evidenze panes mostrano lavoro reale e riuscito (Scout inserisce, Analisti escludono, Scorer assegnano). |
| Ore notturne come causa | **ESCLUSO** | betaA è **diurno** (08-20) e NON front-loada; la fase OFF **congela** il weekly (betaB fermo a wk=51 tutto il giorno OFF), non lo accelera. |
| Debolezza del modello Kimi | **ESCLUSO** | `weekly_usage` è già normalizzato in % del cap; il front-load è del **pacing**, non della qualità del modello. |
| Team work-limited / mancanza di lavoro | **ESCLUSO come causa del timing** | Il pacing emette **SFORO** e il team viene throttlato (48x `post-position-analysis`, ordini Capitano 600-1200s); è il pacing che non ha un tetto weekly-aware, non mancanza di lavoro. |

---

## 🎯 Cosa È — Causa-radice + percorso nel codice

### Il percorso esatto che disattiva i freni per Kimi (file:riga)

```
1. shared/skills/provider_capacity.py:70
   _PROVIDER_SEEDS["kimi"] = {"weekly_unlimited": True}        ← seed FOSSILE

2. shared/skills/provider_capacity.py:132-134
   if prov in _PROVIDER_SEEDS and _PROVIDER_SEEDS[prov].get("weekly_unlimited"):
       return None                                             ← esce PRIMA dell'EMA

3. shared/skills/provider_capacity.py:143-146  (RAMO MAI RAGGIUNTO per kimi)
   if seed is None and isinstance(ema, ...):
       return float(ema) if days >= 1.0 else None              ← ritornerebbe 18.463

4. shared/skills/work_hours_target.py:265-269
   if window_cap_pct_of_weekly is None or <= 0:
       target_of_window_cap = default_target_band_pct          ← FALLBACK 88 (bypassa 273-275)
   else:
       target_of_window_cap = target_of_weekly / ratio * 100   ← ramo weekly-aware NON eseguito

5. .launcher/pacing-bridge.py:79-86
   _PROVIDER_TARGET_BAND["kimi"] = 88.0                        ← il default_target_band_pct

6. .launcher/pacing-bridge.py:620
   vel_target = max(0.0, (target_pct - usage_now) / h_to_reset)  ← ancorato all'88%, non al residuo weekly
```

**Conseguenza:** il target di finestra 5h è **88%** invece del valore weekly-aware (~10% del cap-5h, = 1.8% del weekly). Il pacing autorizza il team a riempire ogni finestra all'88%.

### Secondo freno disattivato by-design (co-fattore, non causa del timing)

```
7. shared/skills/compute_metrics.py:280  + commento 313-315
   weekly_binding = False                                       ← hardcoded, MAI riassegnato

8. .launcher/sentinel-bridge.py:1329
   effective_on_pace = on_pace and not weekly_binding           ← degrada a `on_pace` (binding sempre False)

9. .launcher/sentinel-bridge.py:244-245  (_is_on_pace)
   return vel_team <= vel_target + PACE_OVER_TOL                ← UNICO freno residuo, ancorato all'88%

10. .launcher/sentinel-bridge.py:1384
    weekly_binding_field = " ATTENZIONE-WEEKLY" if weekly_binding else ""  ← MAI emesso
```

`proj_weekly` **è** calcolato e popolato (`compute_metrics.py:312`, valori >1200% su betaB) ma **nessun consumatore lo usa per frenare**: la Sentinella delibera solo su proj-5h vs band. Il weekly non ha un secondo gate forte oltre `vel_target`, che è anch'esso ancorato all'88%.

> Nota: `weekly_binding=False` vale per **tutti** i provider (anche Codex). betaA regge **solo grazie al ratio** nel `vel_target`, non grazie al binding. Questo conferma che il binding è ortogonale e il differenziatore è il ratio.

---

## 📊 Evidenze numeriche per ambito

### A. Stato live del pacing — betaB (Kimi), tick 20:45 UTC

| Campo | Valore | Lettura |
|---|---|---|
| `active_provider` | `kimi` | — |
| `working_hours` | 20:00-08:00 Europe/Rome (notturne, 12h/g) | ~18:00-06:00 UTC |
| `current_window_target_pct` | **88.0** | target di finestra = band-center |
| `target_source` | **`schedule+band+weekly`** | ramo band (NON `schedule+ratio`) |
| `window_cap_pct_of_weekly` | **`None`** | ratio assente → fallback band |
| `target_pct_of_weekly` | **1.8%** | quota weekly che spetterebbe a questa finestra |
| `weekly_remaining_pct` | 25% | |
| `weekly_active_hours` | 69.25h | burn sostenibile **0.36%/h** |
| `vel_target` | 16.53%/h | ancorato all'88%, **non** a 0.36%/h |
| `vel_team` | 16.01%/h | il team marcia al ritmo dell'88% |
| `ratio` (kT/%) | 23.3 kT/% | team 93.2kT / Δusage 4.0% |

Il mismatch è netto: il sostenibile sarebbe **1.8% del weekly per finestra**, ma il pacing punta all'**88% del cap-5h**.

### B. Traiettoria weekly — betaB (front-load confermato)

```
21/06 18h: wk=4   5h=18   SOTTOUTILIZZO    ← reset weekly ~17:11
21/06 22h: wk=18  5h=87   ATTENZIONE
22/06 00h: wk=29  5h=50   ATTENZIONE       \
22/06 03h: wk=39  5h=100  ATTENZIONE        > FRONT-LOAD NOTTURNO (12h: 1→51%)
22/06 05h: wk=51  5h=62   ATTENZIONE       /
22/06 06-17h: wk=51 5h=0  SOTTOUTILIZZO    ← finestra OFF: weekly CONGELATO a 51
22/06 18h: wk=66  5h=72   SOTTOUTILIZZO    \
22/06 19h: wk=71  5h=11   SOTTOUTILIZZO     > +25% IN ~2h (respawn + riapertura ON)
22/06 20h: wk=76  5h=38   ATTENZIONE       /
```

- **`weekly_binding True`: 0 / 337 campioni** (mai True su tutta la traiettoria).
- **`proj_weekly`**: min 1 / mediana **404** / max **1368** — loggato, mai usato per frenare.
- **`status`**: SOTTOUTILIZZO 218, ATTENZIONE 103, STEADY 12, RESET 4 — **mai** un freno weekly esplicito.
- **5h-usage > 50%**: 111/337 = **32.9%** dei campioni (duty-cycle alto).
- **`ATTENZIONE-WEEKLY`**: **0** in mailbox e **0** in `sentinel-log.txt`, nonostante il weekly sia salito 1→76%.
- **`target_source` nei msg mailbox**: `schedule+band+weekly` × 29 (mai `schedule+ratio`).

### C. Gruppo di controllo — betaA (Codex): refuta "controllo invalido perché work-starved"

| Metrica | betaB (Kimi) | betaA (Codex) |
|---|---|---|
| `window_cap_pct_of_weekly` (live) | **None** | **16.549** |
| `target_source` | `schedule+band+weekly` | **`schedule+ratio`** |
| Ramo pacing | band-center 88% | **weekly-aware** |
| EMA misurata (`window-ratio-state`) | 18.463 (156 sample, 34gg, conf 1.0) | 16.549 (129 sample, 19gg, conf 1.0) |
| **max 5h-usage oggi** | (front-load, 100% di picco) | **40%** |
| 5h-usage > 50% | 32.9% campioni | **0.0% (0/252)** |
| `weekly_binding True` | 0 | 0 |
| Traiettoria weekly | 1→76% (front-load) | 56→69% **rampa liscia +1-2%/h** |

betaA viene throttlato/cappato dal target ratio-derived **molto prima** di toccare la banda 88-92%: la sua 5h-usage massima di ciclo è solo **40%**. Il team non è "fermo per mancanza di lavoro" — è **attivamente cappato dal ratio**. Entrambi hanno un'EMA matura; la differenza è che quella di Kimi **non viene mai letta** per via della guardia `weekly_unlimited`.

### D. Amplificatore (del costo/velocità, NON del timing): volume-di-lavoro

- **Intake betaB ~14x**: `positions` DB = 762, **intake ultime 24h = 173** (vs betaA ~12); coda non-scored elevata; bulk-taxonomy manuale in corso (analista-4 domina il burn 2h, ~33% / ~590kT su 1805kT).
- Il **burn weekly istantaneo** mentre i due team lavorano è quasi-identico (betaB mean ~13.3 %/h, betaA ~12.0 %/h): la differenza non è l'intensità ma il **duty-cycle** (betaB 32.9% a 5h-usage>50 e ~31% throttlato; betaA 0.0% e ~2.6%), che è esso stesso effetto del target.
- **Il seed mancante TOGLIE il tetto, il volume RIEMPIE il vuoto.** Implicazione operativa: il fix-del-seed è necessario ma il front-load potrebbe **spalmarsi** invece di azzerarsi se betaB mantiene 14x l'intake → **da osservare post-fix**.

### E. Co-fattore ortogonale: qualità-scout bassa

22% dell'intake betaB è multiplex di repost LinkedIn (dedup per-URL fallisce su URL diversi) e ~63% dell'analisi finisce in esclusione (STACK/LANGUAGE/LOCATION/GEO) vs ~17% di betaA. **Spreca COSTO ma non spiega il TIMING**: anche con scout perfetto il pacing autorizzerebbe l'88% di ogni finestra = il weekly si esaurirebbe ugualmente in ~2 giorni, solo su meno job.

---

## 🔧 Raccomandazioni

> ⚠️ **Team in osservazione: nessun intervento applicato. Sono FINDING per il codice, gated all'utente.** Deploy con cautela (disco VPS pieno al redeploy: `docker image prune -f`; comportamento nuovo di `get_sweet_spot_hours/describe` da testare).

| # | Azione | Tipo | Priorità | Rischio |
|---|---|---|---|---|
| 1 | **Rendere obsoleto `weekly_unlimited` per Kimi.** In `provider_capacity.py` rimuovere/condizionare la guardia `132-134` per `kimi` (o togliere il flag dal seed `:70`), così il ramo EMA `143-146` ritorni **18.463** (già maturo: 156 sample, 34gg, confidence 1.0). Effetto: `get_window_cap_pct_of_weekly('kimi')` da `None` → 18.463 → `work_hours_target` converte `target_pct_of_weekly` (1.8%) in target 5h (~10%) → **pacing weekly-aware come Codex**. Fonte-di-verità del "ha-weekly-cap" dovrebbe diventare "esiste `weekly_usage` nel sample", non il flag statico. | codice | **P0** | Basso-medio: path identico a Codex, già in produzione e validato. Da testare prima del deploy: `get_sweet_spot_hours/describe` passano da `None` a valori definiti; nessun blend seed+EMA (seed=None → EMA pura). |
| 2 | **Valutare `weekly_binding` attivo** come secondo gate: imporre COAST quando `proj_weekly >> 100`. Oggi è hardcoded `False` per tutti i provider e `proj_weekly` (reale, >1200% su betaB) non frena nessuno. | codice | P1 | Medio: tocca un path condiviso da tutti i provider; va calibrato per non incagliare il budget (il design vuole atterraggio ~100% al reset, non halt anticipato). |
| 3 | **Osservare post-fix** se il ratio elimina o solo spalma il front-load, dato l'intake 14x. | osservazione | P1 | Nullo. |
| 4 | **Dedup semantico title+company a monte** (non solo per-URL) per i repost LinkedIn multiplex. Riduce il COSTO, non il timing. | codice | P2 | Basso. |
| 5 | Allineare `_PROVIDER_TARGET_BAND['kimi']=88` come **fallback** solo quando l'EMA non c'è, una volta che Kimi è weekly-aware (tuning post-fix). | config | P2 | Basso. |

---

## 🔭 Cosa osservare nei prossimi cicli

1. **Post-fix (se applicato):** `target_source` di betaB passa da `schedule+band+weekly` a `schedule+ratio`; `window_cap_pct_of_weekly` da `None` a ~18.5; la traiettoria weekly diventa una **rampa liscia** come betaA invece del gradino notturno.
2. **Elimina vs spalma:** se betaB mantiene intake ~14x, verificare se il burn resta vicino al tetto per-finestra ogni notte (spalmato) o se il front-load temporale **sparisce** (stima matematica: a ratio 18.5% il target ~10% del cap-5h tiene il burn a ~1.9% weekly/finestra anche con coda piena → il front-load **temporale** dovrebbe sparire; il **costo per job** resterebbe gonfiato da multiplex/esclusioni).
3. **`get_sweet_spot_hours/describe`:** con ratio=18.463, `max_hours` diventa definito (oggi `None`) — comportamento nuovo da validare.
4. **Finestre per ciclo:** quante finestre 5h-ON cadono in un ciclo weekly Kimi col reset disallineato (~17:11) e working-hours notturne, per confermare che il target weekly-aware atterri ~100% al reset senza undershoot (coast precoce) né overshoot.

---

## ❓ Punti aperti (onestamente)

- **Il fix-del-seed da solo elimina o spalma il front-load?** Non dirimibile coi dati attuali: richiede osservazione post-fix (vedi sopra). È una raccomandazione di osservazione, non una domanda analitica residua.
- **Il valore EMA 18.463 è su 34 giorni misti** (Kimi a volte unlimited, a volte no?): va validato che corrisponda al weekly cap reale attuale (reset ~17:11) prima di affidargli il pacing.
- **Il band-center 88% va riallineato** una volta che Kimi è weekly-aware, o resta 88 solo come fallback? Rilevante per il tuning post-fix, fuori scope dell'indagine causale.

---

### Nota minore (non load-bearing)
Il self-test in `provider_capacity.py:241-243` asserisce `codex == 14.7` mentre il seed live è `17.0` (`:58`): test stantio, non impatta il runtime. Segnalato per igiene, non è parte della causa-radice.

---

## 🧩 Consenso

**Raggiunto (confidence ~0.93).** L'unico disaccordo del panel — "il fix-seed è sufficiente o necessario-non-sufficiente?" — è stato dirimito coi dati throttle-context di betaA (cappato a 40% max dal ratio): il ratio **è** il differenziatore operativo. Il residuo "elimina vs spalma" richiede osservazione post-fix, non altra analisi. Verdetto sull'ipotesi di partenza: **CONFERMATA**.
