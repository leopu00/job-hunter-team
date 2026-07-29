<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: pipeline-triage
description: "Decidi QUALE ruolo spawnare / mettere in pausa / killare basandoti sullo stato del backlog, non sull'istinto. Apri questa skill OGNI VOLTA che osservi — vel team < 50% target, O qualsiasi coda ruolo = 0, O fonti Scout esaurite, O [SCALA UP] dalla Sentinella, O `PIPELINE VUOTA + UNDERSHOOT`, O `MARGINE` dal bridge-pacing, O cold start, O ogni volta che sei tentato di \"spawnare un altro Scout\". NON aspettare un [SCALA UP] esplicito dalla Sentinella quando le condizioni sono già visibili nelle metriche. Il punto: leggi 4 numeri, scegli l'unico ruolo che sblocca il bottleneck, passa a `spawn-agent`."
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(tmux *)
---

# pipeline-triage — scaling basato sui dati

La pipeline è un sistema dinamico. Ogni ruolo consuma in modo molto diverso per task — aggiungere un 2° Scrittore costa molto di più che aggiungere un 2° Scout. Scalare alla testa quando il bottleneck è alla coda produce *più* backlog, non più output. Parti sempre dai dati.

## Quando aprire questa skill (bug #17)

La apri su **condizioni osservate**, non solo su ordini espliciti della Sentinella. Trigger:

- Velocità team sotto il 50% del target
- Qualsiasi coda ruolo a 0 (Scout esaurito, Scorer/Scrittore inattivo)
- Fonti Scout riportate come esaurite ("bebee, indeed, glassdoor — niente di nuovo")
- `[SCALA UP]` dalla Sentinella
- `MARGINE` / `PIPELINE VUOTA + UNDERSHOOT` dal bridge-pacing
- Cold start di una finestra

L'anti-pattern storico: il Capitano vede `SCRITTORE_QUEUE=0` +
`PROMOTABLE_40_49=6`, **descrive** la situazione perfettamente
all'utente, **non** esegue la promozione. Questa skill è *attiva*, non
*consultiva* — quando le condizioni corrispondono, esegui.

## Step 1 — leggi il backlog (sempre, prima di qualsiasi spawn)

```bash
python3 /app/shared/skills/db_query.py stats
```

Da `positions` (P), `scores` (S), `applications` (A), calcola:

| Metrica             | Formula                                                       | Cosa significa                                      |
|---------------------|---------------------------------------------------------------|-----------------------------------------------------|
| **UNSCORED**        | P − S                                                         | posizioni che lo Scorer deve ancora valutare        |
| **DRAFT_BLOCKED**   | application con `status = draft`                              | loop Scrittore ↔ Critico bloccato                   |
| **SCRITTORE_QUEUE** | posizioni con `score ≥ 50` E nessuna application              | coda Scrittore (domanda reale per nuovi CV)         |
| **PROMOTABLE_40_49**| posizioni con `score 40-49` E nessuna application              | banda parcheggio — promuovibili a richiesta         |

Utile anche: `python3 /app/shared/skills/db_query.py dashboard` per stato a colpo d'occhio + istanze attive per ruolo.

## Step 1 bis — chi produce e chi è ammutolito (2026-07-27)

I worker non mandano più `[START]` / `[DONE]` (quei bookend erano 30 dei 37 messaggi ricevuti dal
Capitano in ~1,5h su un team di primo avvio). Il loro avanzamento si tira giù da qui:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 30
```

⚠️ **Elenca chi PRODUCE, quindi un agente in stallo sparisce dalla lista invece di risaltare.** Un
backlog che non si svuota non è automaticamente un worker che manca: può essere un worker vivo e
incagliato, e spawnarne un secondo lascia il primo a bruciare. Prima di decidere, incrocia tre fonti:

| Vivo (`tmux list-sessions`) | Coda (`next-for-*`) | Transizioni (`recent-activity`) | Verdetto |
|---|---|---|---|
| sì | non vuota | 0 | **STALLO** — conferma con `capture-pane`, poi `agent-emergency` (Dottore-first → kill). **Non** spawnarne un secondo sopra |
| sì | non vuota | > 0 | sta lavorando — è un problema di capacità, vai allo Step 2 |
| sì | vuota | 0 | idle legittimo — lascialo stare (dopo uno `[SCOUT-ESAUSTO]` la quiescenza è voluta) |
| no | non vuota | 0 | manca davvero — spawnalo (Step 2) |

## Step 2 — scegli la priorità (bottleneck per primo, mai lavoro nuovo)

Applica la tabella dall'alto in basso. Fermati alla prima condizione che corrisponde.

| Condizione                                                 | Azione (in quest'ordine)                                                                                                             |
|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `DRAFT_BLOCKED ≥ 50`                                      | **Prima**: sblocca il loop del Critico. Spawna `CRITICO-S2/S3/S4` se non vivi (3 in parallelo). Ogni `CRITICO-S` processa 1 draft alla volta. |
| `UNSCORED ≥ 20`                                           | **Poi**: spawna `SCORER-2` (e `SCORER-3` se `UNSCORED ≥ 50`). Un solo Scorer è insufficiente con 20+ in coda.                       |
| `SCRITTORE_QUEUE ≥ 5`                                     | spawna 1 `SCRITTORE-N` se non ne hai già 3 vivi (max).                                                                               |
| `PROMOTABLE_40_49 ≥ 5`                                    | promuovi i migliori 5 alzando il punteggio (`db_query.py` + `UPDATE` diretto), poi tratta come `SCRITTORE_QUEUE`.                    |
| `SCRITTORE_QUEUE < 5 AND PROMOTABLE_40_49 < 5`            | **Solo ora** spawna 1 `SCOUT-N` per nuove posizioni.                                                                                 |

Una volta scelto il ruolo, passa a `spawn-agent` per il lancio effettivo + kick-off.

## Step 3 — anti-pattern da evitare

- ❌ Spawnare uno Scout come prima azione quando `UNSCORED > 20` — produce più backlog senza output extra.
- ❌ Resettare il throttle globalmente (`throttle-config.py reset`) quando si scala — applica il throttle solo al ruolo che hai spawnato.
- ❌ Spawnare più ruoli nello stesso tick "per sicurezza" — aspetta il prossimo tick della Sentinella (~5 min) e rileggi i numeri.
- ❌ Killare agenti inattivi per "mettere in ordine" — l'inattività costa quasi zero. Killa solo se esplicitamente richiesto dall'utente, o se un agente sta bruciando token in un loop confuso.

## Razionale empirico (perché quest'ordine, non un altro)

Osservato nelle finestre W3-W6 (picco proj mediano 57-61%): gli Scout producono ~3 posizioni/h consistentemente, ma Scorer/Critico NON drenano il backlog → 88 non-scored e 217 draft accumulati = 12+ punti rate-budget inutilizzati. **La cura è a valle, non a monte.** Ogni volta che sei sotto-passo (`vel_team` sotto `vel_target`) con backlog non vuoto, la causa è quasi sempre Scorer o Critico, mai Scout. *(Ignora `proj`: è INFO volatile, non un trigger.)*

## Consumo per ruolo — scegli con il costo in mente

| Ruolo         | Consumo per task          | Note                                                                                                  |
|---------------|--------------------------|--------------------------------------------------------------------------------------------------------|
| **Scout**     | basso-medio, lungo+cumulativo | scraping + filtraggio su fonti multiple; 2 scout a piena velocità possono saturare da soli          |
| **Analista**  | medio, burst brevi       | 1 task = leggi 1 JD + scrivi valutazione. Si rinfresca ~ogni 2 min quando c'è coda                    |
| **Scorer**    | basso, burst brevi       | punteggio di match sul profilo, quasi deterministico. Il ruolo più economico.                          |
| **Scrittore** | **ALTO**                 | loop interno con Critico 3-4 round, ogni round scrive un CV/cover completo. Un singolo Scrittore attivo può superare tutti gli altri combinati. |
| **Critico**   | medio                    | si attiva solo su chiamata dello Scrittore; il costo si aggiunge a quello dello Scrittore.             |
| **Assistente**| basso, su richiesta      | parla con l'utente; non è nella pipeline dati.                                                         |

**Corollario**: il costo marginale del 2° Scrittore è molto più alto del 2° Scout. Scalare dalla testa ("più lavoro → più di tutto") supera il target.

## Bottleneck → azione (qualitativo, fallback quando le statistiche sono ambigue)

| Stato pipeline                                          | Bottleneck                  | Azione                                                                                       |
|---------------------------------------------------------|-----------------------------|----------------------------------------------------------------------------------------------|
| `0 nuove, 0 verificate, 0 con punteggio` (vuota)       | testa: niente materiale     | avvia **solo Scout**, anche 2 in parallelo. Niente Analista/Scorer/Scrittore (niente input).  |
| molte `new`, poche `checked`                            | Analista sottodimensionato  | spawna `analista 2`. **Non** aggiungere Scout (materiale c'è già; rallentali se serve).      |
| molte `checked`, poche `scored`                         | Scorer lento                | spawna `scorer 1` se mancante; se già attivo + coda `checked` > 20 per ≥2 tick → spawna `scorer 2` (1 bastava ma il run vps1 2026-05-21 ha avuto 180 scoring su scorer singolo = bottleneck) |
| molte `scored ≥ 50`                                     | serve capacità di scrittura | Scrittore. Caveat: 1 Scrittore attivo + Critico possono saturare il budget da soli. Spawna 1, osserva 2-3 tick, poi decidi. |
| Scrittori saturi, coda `score ≥ 50` non si drena        | limite capacità piano       | NON spawnare extra Scrittori — rischio di `RALLENTA` istantaneo. Rallenta gli Scout per smettere di alimentare la coda. |
| poca coda `scored` MA molti `writing` in corso           | Scrittori occupati e producono | non fare nulla. Aspetta `writing → ready`.                                                  |

**Principio guida**: accendi agenti **a monte** quando manca l'input, **a valle** quando manca l'output. Mai "a tutti i livelli" senza pensare.

## Gate di scaling (regole di pacing)

- **1 spawn per tick della Sentinella (~5 min).** Spawn → kick-off → aspetta prossimo `[BRIDGE TICK]` → prossima decisione. Mai 5 di fila.
- **Max per ruolo**: 2 Scout, 2 Analista, **2 Scorer** (alzato da 1 dopo che il run vps1 2026-05-21 ha mostrato scorer singolo = bottleneck 180 scoring — vps1-postmortem anomalia #6), 3 Scrittore, 1 Critico (il Critico è spawnato dallo Scrittore, tu non lo tocchi).
- **Check pre-spawn**: `tmux has-session -t <SESSION> 2>/dev/null && echo ATTIVO` — mai spawn alla cieca sopra una sessione esistente.
- **Ordine di boot**: Scout + Analista *prima*, Scorer + Scrittori *dopo*. Mai in parallelo.

## Checklist pre-spawn (eseguila mentalmente prima di ogni spawn)

1. `db_query.py stats` — dov'è il backlog?
2. `db_query.py dashboard` — quante istanze per ruolo già vive?
3. Il ruolo che stai per spawnare — dissolve il **vero** bottleneck, o stai "completando il team"? Se il secondo: **non spawnare** (budget inutilizzato batte l'overshoot).

## Triage sessioni pre-esistenti

Prima di qualsiasi `start-agent.sh`, elenca cosa c'è già:

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}'
tmux capture-pane -t <SESSION> -p -S -40 2>/dev/null | tail -20
```

| Stato in capture-pane                                                        | Azione                                          |
|------------------------------------------------------------------------------|-------------------------------------------------|
| 🟢 CLI attiva, contesto < 40%, loop recente                                  | mantieni, non respawnare                        |
| 🟡 CLI attiva, contesto > 80% o inattivo > 10 min                            | giudica: lavoro prezioso → lascia; loop confuso → kill + respawn |
| 🔴 `command not found` / shell nuda / pannello vuoto > 5 min                 | `tmux kill-session` + respawn (usa `spawn-agent`) |

Per diagnosi di liveness più profonda (procedure zombie, sintomi morte CLI), quello è il lavoro del **Dottore** via la skill `liveness-check` — non duplicarlo qui.

## Vedi anche

- `spawn-agent` — lancio effettivo + kick-off dopo la decisione del ruolo.
- `sentinel-orders` — cosa ha triggerato questo triage (`SCALA UP`, `PIPELINE VUOTA + UNDERSHOOT`).
- `bridge-pacing` — quando MARGINE significa "spawna uno in più al bottleneck".
- `liveness-check` (Dottore) — diagnostica salute agente più profonda.
- `agents/_team/architettura.md` — diagramma completo della pipeline e note di coordinamento per fase.
