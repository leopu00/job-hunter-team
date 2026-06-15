# 🔥 Coordinator-burn — perché il consumo settimanale sale anche a settimana appena resettata

**Data:** 2026-06-15 · **Lane:** dev1 (osservazione read-only) · **VPS:** barto (Kimi, domanda
originale) + andras (Codex, conferma live del meccanismo).

## ❓ La domanda dell'utente

> «come mai kimi ha consumato così tanto quando ha appena ricominciato la settimana»

Kimi/barto mostrava un weekly già alto (≈36%) poco dopo il reset settimanale, **senza** un volume
di output (posizioni trovate / analizzate / scorate) che lo giustificasse.

## ❌ Cosa NON è (label respinta dall'utente)

L'ipotesi precedente — **"idle-burn"** ("sessioni LLM idle che bruciano stando ferme") — è stata
**respinta dall'utente come fake**: «idle-burn non esiste è una cazzata fake, analizza meglio i pane
o i jsonl degli agenti». Corretto: le sessioni coordinatrici **non** stanno ferme. Stanno
**lavorando** ad ogni tick — solo che il loro lavoro è ragionamento di coordinamento, non output di
job-hunting. Quindi non è "idle", è **coordinator-burn**.

## 🔬 Causa reale: COORDINATOR-BURN (costo fisso per-tick dei coordinatori)

Evidenza diretta dalle pane tmux (catturate live su andras/Codex 2026-06-15, stesso prompt e stessa
architettura bridge-tick di barto):

### Sentinella — un turno LLM completo ad OGNI bridge tick, anche "in silenzio"

Ogni `[BRIDGE TICK]` (cadenza ~15 min) innesca un turno LLM completo con ragionamento verboso,
**anche quando la decisione è non fare nulla**:

```
› [BRIDGE TICK] ts=07:19:46 usage=36% ... WEEKLY-PACE[SOPRA-PACE] ...
• Tick 07:19 gestito in silenzio.
  Motivo: weekly sopra-pace in rientro lieve e ora burst_transient=true (ratio 2.40x -> 2.38x,
  early_lockout 20.3h -> 20.1h), quindi niente ulteriore freno. Primary scende (proj=54.82%).
  HOLD stretto già attivo; nessun messaggio al Capitano.
```

Ogni `Tick … gestito in silenzio. Motivo: …` (3-5 frasi) **è una generazione LLM** spesa per
decidere di non agire. Ad ogni tick. Per sempre.

### Capitano — stesso pattern: turno per-tick anche su tick "saltato"

```
› [BRIDGE PACING] tick saltato reason=insufficient_samples.
• Tick saltato per campioni insufficienti. Dreno mailbox/risposte e non cambio stato operativo...
• Ran jht-check-user-replies --agent capitano   └ (no output)
• Ran python3 .../bridge_mailbox.py drain         └ tick saltato reason=insufficient_samples
• Ran python3 .../throttle-config.py dump         └ default = 0s ...
• Tick ignorato: insufficient_samples. Nessuna variazione operativa. Mantengo gate e throttle...
```

Anche un tick **scartato** produce: drain mailbox + check-user-replies + dump throttle + un turno
di ragionamento. Tutto a vuoto.

### Loop di ACK Sentinella ↔ Capitano — ogni round = un turno per parte

```
› [@sentinella -> @capitano] [INFO] RESET SESSIONE primary rilevato...   (turno Sentinella)
› [@capitano -> @sentinella] [ACK] RESET primary ricevuto. Mantengo COAST/HOLD...   (turno Capitano)
• ACK ricevuto. Contesto allineato: COAST/HOLD mantenuto, tutte le code a 0...   (turno Sentinella)
```

Ogni notifica genera un ACK, e l'ACK genera a sua volta un turno di "contesto aggiornato". Round-trip
di coordinamento che si moltiplica.

## 📊 Perché spiega il consumo "a settimana appena resettata"

Il costo dei coordinatori è **fisso per-tick, indipendente dall'output del team**:

- Bridge tick ~ogni 15 min → ~4/h → ~**96 tick/giorno per coordinatore**.
- 2 coordinatori sempre attivi (Sentinella + Capitano), ciascuno con un turno verboso **per tick**,
  più i round di ACK fra loro.
- Modello costoso a turno: andras = `gpt-5.5 high` (Codex), barto = Kimi.

Scout/Analista/Scorer bruciano **solo quando c'è lavoro** (posizioni da trovare/analizzare/scorare).
I coordinatori bruciano **sempre**. Quindi appena la settimana riparte, mentre la pipeline produttiva
è scarica (code a 0, "COAST", "pipeline vuota"), il weekly sale lo stesso — trainato dai turni
per-tick dei coordinatori, non dal lavoro reale. È un costo nascosto, non proporzionale al valore
prodotto.

## 🛠️ Finding per il CODICE (non intervento runtime)

Il fix è di design, lane dev2/dev3 — qui si documenta soltanto:

1. **Tick silenzioso ≠ turno LLM.** Il path "gestito in silenzio" / "tick saltato" dovrebbe essere
   un **gate deterministico in codice** PRIMA di invocare l'LLM: il coordinatore si sveglia (turno
   LLM) solo su un *edge azionabile* (cambio di stato reale), non ad ogni tick. Oggi paghiamo un
   ragionamento completo per riconfermare "nessun cambiamento".
2. **Comprimere gli ACK.** I round-trip di ACK ("contesto aggiornato: tutto invariato") raddoppiano i
   turni senza decisione. Valutare ACK deterministici / dedup / soppressione dei no-op.
3. **Cadenza adattiva.** A pipeline scarica + stato stabile, allungare l'intervallo di tick (o
   passare a un poll lento) riduce il numero di turni a vuoto senza perdere reattività sugli edge.

> ⚠️ Aggiornare la memoria `project_idle_burn_discovery.md`: la label "idle-burn" è stata respinta
> dall'utente; il fenomeno reale è il coordinator-burn descritto qui.
