# 🔀 Pacing: bridge → Sentinella unica, Capitano pull-on-demand

**Data:** 2026-06-25 · **Branch:** dev2 · **Stato:** progettato + implementato (gated: merge utente → redeploy)
**Movente:** il Capitano è top-consumer **perché viene pingato**, non perché il suo lavoro è difficile.

## 🩻 Il problema (misurato su betaB)

Sull'inbox del Capitano (ultimi 500 messaggi), **234 = 47%** sono `[BRIDGE PACING]`: il
pacing-bridge gli spinge **ogni 15 min** la tabella per-agente + verdetto + comando throttle,
**anche quando l'andamento è stabile e non c'è niente da fare**. Ogni ping = un turno LLM
(lettura + ACK + eventuale throttle) → il Capitano risulta top-consumer per **rumore di
routine**, mentre il suo compito vero (coordinare) non è caro.

Asimmetria storica del protocollo:
- **WEEKLY-PACE** (analisi, giudizio) → va alla **Sentinella**, che filtra e consiglia il Capitano. ✅
- **5h per-agente** (stessa natura: analisi di pacing) → andava **diretto al Capitano**. ❌

## 🎯 Il principio (visione utente)

> Il **bridge notifica SOLO la Sentinella** (l'analista). Il **Capitano NON viene pingato dal
> bridge**: di default **ascolta gli ordini già filtrati** della Sentinella e decide. Ma **non si
> fida ciecamente** — ha le **skill per verificare coi suoi occhi** (tirare il tick grezzo, lo
> storico dei top-consumer) e le usa **solo quando è confuso** e deve capire cosa succede.
> La Sentinella, di conseguenza, **non disturba il Capitano ogni 15 min**: se l'usage è stabile
> **tace**; lo notifica **solo** su sforo / anomalia / cambio di regime.

È un **push → pull**: un solo consumatore del feed grezzo (Sentinella, analista lean che dà
un'occhiata e tace), il Capitano riceve solo eventi azionabili e **tira** i dati on-demand.

## 🧩 La buona notizia: le skill di pull ESISTONO GIÀ

Niente nuove skill da scrivere — il Capitano può già vedere da sé:

| Skill | Cosa fa | Costo |
|---|---|---|
| **`rate-budget`** | legge l'ultimo snapshot del bridge (usage/vel/proj/throttle consigliato) | **zero** provider call, legge il file |
| **`agent-speed-table`** | per-agente: chi brucia, share, tabella throttle pre-calcolata (storico top-consumer) | zero, legge `agent-usage-table.json` |
| **`bridge-pacing`** | interpreta un `[BRIDGE PACING]` in aggiustamenti throttle | — |

E il prompt del Capitano è **già "pull-default"** (riga 107) + **C-07** lo rende autonomo in
Phase 1 ("la Sentinella manda solo INFO, TU moduli il throttle"). Il pull-first c'è già; manca
solo **smettere di pingarlo**.

## 🔧 I cambiamenti (3 file + questo doc)

1. **`.launcher/pacing-bridge.py`** — `TARGET_SESSION` default `CAPITANO` → **`SENTINELLA`**.
   Il pacing per-agente + verdetto va all'analista (che già ha `[BRIDGE TICK]` +
   `agent-usage-table.json`). La **mailbox** `bridge-mailbox.jsonl` (rete di sicurezza per i
   verdetti persi via tmux) è **esclusiva del pacing-bridge** (il sentinel-bridge NON la usa) →
   da ora la **drena la Sentinella**, non il Capitano (altrimenti il Capitano riprenderebbe il
   pacing dalla mailbox, vanificando il taglio).

2. **`agents/sentinella/sentinella.md`** — diventa l'**unica destinataria** del bridge:
   riceve `[BRIDGE PACING]` (oltre al suo tick), **drena la `bridge-mailbox`** a inizio turno,
   eredita la skill `bridge-pacing`. **Notifica il Capitano SOLO su evento azionabile** (sforo /
   anomalia / daily `⛔` / cambio di regime); **se stabile, TACE** (estende S-07 a *tutto* il
   pacing, non solo al weekly). Emette gli ordini throttle/coast/kill.

3. **`agents/capitano/capitano.md`** — **non più pushato dal bridge**:
   - tolto `bridge-mailbox` + `[BRIDGE PACING]→bridge-pacing` dalla routine di turno;
   - default: **agisce sugli ordini filtrati** della Sentinella;
   - on-demand: quando è confuso o vuole verificare, **tira** `rate-budget` + `agent-speed-table`
     (zero-cost) e **vede coi suoi occhi** — esplicito che **non si fida ciecamente**;
   - resta **C-07** (in Phase 1 si auto-modula dai propri pull se serve).

## ⚖️ Perché è efficiente

La Sentinella è **costruita per dare un'occhiata e tacere** (turno economico); il Capitano,
quando pingato, **agisce** (throttle + ACK + coordina = turno caro). Assorbire il pacing
nell'analista lean e pingare il Capitano **solo sugli eventi** taglia il suo ~47% di ping di
routine → smette di essere top-consumer **perché-pingato**. Il costo si sposta su un turno
Sentinella (glance, spesso silenzioso), non su un turno Capitano (azione).

## ⚠️ Rischio + coperture

Siccome **niente altro** pinga il Capitano, la Sentinella **deve** beccare ogni sforo vero
(niente falso-silenzio). Coperture:
- **trigger deterministici** nel tick: daily `⛔` (S-09), weekly `SOPRA-PACE` (S-07),
  rilevamento agente-anomalo (cadenza~0 + share alto);
- la **mailbox** (ora sua) come rete di sicurezza sui verdetti persi via tmux;
- il Capitano che può **pullare on-demand** in qualsiasi momento (rete di sicurezza lato suo);
- **C-07** invariato: in Phase 1 il Capitano può auto-modularsi dai propri pull.

## 🔗 Coerenza col guardrail giornaliero (stessa sessione)

Il daily (C-19/S-09) è già stato messo nel `[BRIDGE TICK]` della Sentinella (non dal Capitano):
**stesso modello** — il bridge calcola, la Sentinella analizza e ordina, il Capitano esegue.
Questo cambiamento estende lo stesso principio a **tutto** il pacing per-agente.
