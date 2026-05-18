# 🚨 Sentinella — analisi "troppo severa?" (post Bug #24)

**Data**: 2026-05-18 16:50 CEST
**Trigger**: Leone chiede "mi sembra che Sentinella è ancora troppo severa — forse mi sbaglio?"
**Verdetto**: confermato, è troppo severa nel caso osservato. Fix Quick win proposto, attesa OK per apply.
**Riferimenti precedenti**: Bug #24 (Sentinella 3 fasi) closed nello sprint del 17 maggio.

---

## 📊 Caso osservato (live sul VPS, finestra 14:58 → 15:40 UTC)

### Trend usage + projection nei 14 tick consecutivi

```
   tempo   usage  Δ   velocity     proj    status        commento
   ─────────────────────────────────────────────────────────────────
   14:58    26   3   59.83%/h    170.9%   ATTENZIONE    ramp-up
   15:01    28   2   39.53%/h    172.6%   ATTENZIONE
   15:04    30   2   39.87%/h    174.0%   ATTENZIONE
   15:07    32   2   39.87%/h    175.4%   ATTENZIONE
   15:10    33   1   19.94%/h    171.3%   ATTENZIONE    velocity ↓
   15:13    35   2   39.88%/h    172.7%   ATTENZIONE
   15:16    38   3   59.29%/h    178.5%   ATTENZIONE    burst Critico
   15:19    40   2   39.87%/h    179.4%   ATTENZIONE
   15:22    43   3   59.83%/h    184.4%   ATTENZIONE    PEAK proj
   15:25    43   0    0.00%/h    176.8%   ATTENZIONE    ⏸ delta=0
   ┌──────────────────────────────────────────────────────────────┐
   │ 15:28 ─ Sentinella (LLM agent) DICHIARA EMERGENZA → freeze  │
   └──────────────────────────────────────────────────────────────┘
   15:28    44   1   19.94%/h    173.7%   ATTENZIONE    ← freeze
   15:31    45   1   19.76%/h    170.7%   ATTENZIONE
   15:34    45   0    0.00%/h    164.4%   ATTENZIONE    ⏸
   15:37    45   0    0.00%/h    158.6%   ATTENZIONE    ⏸
   15:40    46   1   19.95%/h    156.5%   ATTENZIONE    slow ramp
```

### Configurazione attuale (sentinel-bridge-state.json)

```json
{
  "tick_phase": "DEFAULT",
  "tick_interval_min": 3.0,
  "g_spot": { "lower": 80.0, "upper": 105.0 },
  "sentinella_cooldown_min": 15.0,
  "last_status": "ATTENZIONE",
  "last_projection": 156.51,
  "last_usage": 46
}
```

---

## 🤔 Discrepanza bridge vs LLM agent

```
   📊 BRIDGE (algoritmo Python, oggettivo)
      Per TUTTI i 14 tick: phase=2 (ATTENZIONE), status=ATTENZIONE
      MAI dichiarato EMERGENZA — proj alta ma non oltre soglia

      ↓ Sentinella LLM legge i tick ↓

   🤖 SENTINELLA AGENT (Kimi LLM, soggettivo)
      Legge "proj >150% per 3 tick consecutivi"
      DECIDE: "EMERGENZA, freeze totale" — throttle=-1
      Notifica al Capitano

      ↓ Capitano riceve due segnali ↓

   🌉 BRIDGE PACING (consigliere algoritmico)
      "critico=13.43%/h share 49% (1 agente brucia metà budget)"
      "CMD: jht-throttle.py set critico +10
       NO global reset, NO throttle a tutti"
      ← Soluzione CHIRURGICA suggerita

   👨‍✈️ CAPITANO esegue freeze TOTALE (segue Sentinella, non bridge pacing)
      Risultato: velocity scende ma TUTTI gli 13 agenti fermi
```

---

## 🎯 3 punti di severità eccessiva

### 1. EMERGENZA scatena su PROJECTION, ignora USAGE basso

```
usage attuale:          46%        ← MOLTO basso
g_spot range (config):  80-105%    ← zona "sana"
proj forecast:          156-184%   ← qui scatta EMERGENZA
```

**Il forecast è aggressivo**: estrapola la velocity recente fino al
reset (3.68h). Un burst del Critico (60%/h × 4h = +240%) gonfia la
proj anche se l'usage reale è basso.

**Realtà**: il consumo non è lineare, ha burst e pause. Una proj alta
con usage basso = falso positivo probabile.

### 2. Freeze TOTALE invece di chirurgico

Il bridge pacing identifica precisamente il colpevole:

```
critico=13.43%/h, share 49%
critico-s3=4.39%/h
altri=11.5%/h cumulato
```

Bridge suggerisce: throttle solo critico +10s.

Sentinella sceglie: `throttle = -1` (freeze tutti).

**Conseguenza**: 13 agenti in pausa, pipeline applications ferma per
15+ minuti, anche se 12 di loro erano innocui (Scrittori, Scout,
Analista, Scorer, Dottore stavano consumando il 50% restante = poco
ognuno).

### 3. Cooldown 15 min — penalty lunga per falso positivo

```
sentinella_cooldown_min: 15.0
```

Dopo EMERGENZA, la Sentinella non può rivedere la decisione per 15
minuti. Negli ultimi 4 tick post-EMERGENZA (15:25 → 15:40):

- delta = 0 / 1 (velocity quasi zero, freeze efficace)
- proj scende: 184% → 156% (-30 punti)
- velocity_decreasing = true

**Avrebbe potuto sbloccare prima** se il cooldown fosse adattivo.

---

## ✅ Cosa ha funzionato

- ✅ Velocity scesa da 59%/h → 0-19%/h
- ✅ Projection in calo (-30 punti)
- ✅ Reset budget protetto: arriveremo a fine finestra OK
- ✅ Nessun crash, nessun rate-limit hit reale

## 🟡 Cosa NON ha funzionato

- 🟡 Freeze totale invece di throttle mirato sul Critico
- 🟡 Pipeline produttiva ferma per ~15 min wasted
- 🟡 4 tick consecutivi delta=0 (poteva ripartire prima)
- 🟡 Ignorato il bridge pacing che aveva la soluzione chirurgica corretta

---

## 🛠 Fix proposti (in ordine di effort)

### 🟢 Quick win — soglia AND `usage >= 70%` per EMERGENZA

**File**: `agents/sentinella/sentinella.md` (regola decisionale nel prompt)
**Effort**: 1-2 paragrafi
**Deploy**: rebuild image :buster + container restart

```markdown
### Soglia EMERGENZA — nuova regola decisionale

Dichiara EMERGENZA solo se ENTRAMBE le condizioni sono vere:
1. proj > 150% per 3 tick consecutivi
2. AND usage >= 70% (i.e. siamo già oltre la zona sana)

Se proj > 150% ma usage < 70%:
- È un forecast aggressivo basato su burst transitorio
- Preferisci THROTTLE CHIRURGICO: usa l'ordine del bridge pacing
  (es. "jht-throttle.py set critico +10")
- Solo se 2+ agenti out-of-control simultaneamente → escalate a freeze
```

**Vantaggi**:
- Risolve il caso visto oggi (proj alta + usage basso = decisione meno severa)
- Mantiene il safety net per i veri casi (usage alto + proj alta)
- Reversibile in 5 min (modifica prompt + restart)

**Rischi**:
- Se in futuro un burst sostenuto porta a usage 70% rapido → freeze
  comunque scatta ma "in ritardo". Il margine usage 70%→100% = 30%
  → con velocity 60%/h sono 30 min di buffer. Sufficiente per
  intervento manuale o second-tick re-evaluation.

### 🟡 Medio — riscrittura logica "chirurgico vs totale"

**File**: `agents/sentinella/sentinella.md` + `agents/_skills/rate-budget/SKILL.md`
**Effort**: 2-3h di prompt engineering + test runtime
**Deploy**: rebuild image

Aggiungere matrix decisionale alla Sentinella:

| Condizione | Throttle |
|---|---|
| usage <50% AND proj >150% | Throttle CHIRURGICO sul top consumatore |
| usage 50-70% AND proj >150% | Throttle TOP 2 consumatori |
| usage 70-95% AND proj >150% | Throttle a tutti (default 600s) |
| usage >=95% OR vero rate-limit | FREEZE totale |

Segue il pattern del bridge pacing già implementato, ma con regole
formalizzate per la Sentinella LLM.

### 🔴 Refactor — soglia algoritmica nel bridge (non LLM)

**File**: `.launcher/sentinel-bridge.py`
**Effort**: 1 giorno
**Deploy**: rebuild image + test con burst reali

Sposta la decisione "EMERGENZA vs ATTENZIONE" dall'LLM al bridge:
calcolo deterministico, niente interpretazione del prompt. Sentinella
diventa l'esecutore (formatta il messaggio per il Capitano), non il
giudice.

**Vantaggio**: zero variabilità da run a run.
**Rischio**: cambio non-trivial, va testato con burst reali pre-deploy.

---

## 🎯 Raccomandazione

**Quick win** (`AND usage >= 70%`) per ora:

- Risolve il caso osservato senza rifare l'architettura
- 1 modifica prompt (`agents/sentinella/sentinella.md` + `.it.md` + `.hu.md`)
- Deploy via rebuild :buster
- Effort < 30 min totale
- Reversibile facilmente

Lasciare Medio e Refactor come backlog se Quick win non risolve dopo
qualche giorno di osservazione.

---

## 📋 Checklist apply (quando Leone darà OK)

```
□ Modifica agents/sentinella/sentinella.md (master EN):
  □ Aggiungere sezione "Soglia EMERGENZA — regola decisionale"
  □ Esplicitare AND usage >= 70% per freeze totale
  □ Esplicitare preferenza per ordini chirurgici quando usage < 70%

□ Modifica agents/sentinella/sentinella.it.md (override IT)
□ Modifica agents/sentinella/sentinella.hu.md (override HU)

□ Test runtime:
  □ Smoke su VPS: simulazione proj 160% + usage 40% → no EMERGENZA
  □ Smoke su VPS: simulazione proj 160% + usage 75% → SÌ EMERGENZA

□ Deploy:
  □ rebuild Docker image :buster
  □ docker exec jht jht team restart (ricarica prompt)
  □ monitorare 2-3 finestre Kimi (10-15h reali)

□ Confirm/rollback:
  □ Se Sentinella scatta correttamente solo a usage>=70% → keep
  □ Se Sentinella troppo permissiva (rate-limit hit) → revert + Medio
```

---

## 🔗 Riferimenti

- Bug #24 originale (Sentinella 3 fasi closed): nello sprint 17 maggio
- Sentinel bridge state attuale: `/jht_home/logs/sentinel-bridge-state.json`
- Tick history JSONL: `/jht_home/logs/sentinel-data.jsonl`
- Bridge pacing logic: `.launcher/sentinel-bridge.py`
- Prompt Sentinella: `agents/sentinella/sentinella.md` (master EN)
- Conversazione che ha generato l'analisi: 2026-05-18 16:50 CEST
