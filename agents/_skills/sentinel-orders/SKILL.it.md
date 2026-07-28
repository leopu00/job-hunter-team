<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: sentinel-orders
description: Traduci ogni ordine `[SENTINELLA] ...` ricevuto nel tmux del Capitano nell'azione corretta (livello di throttle, spawn/kill, freeze, soft-pause, resume). La Sentinella è il battito cardiaco del team — i suoi ordini sono comandi, non suggerimenti. Il comportamento predefinito è eseguire senza ricontrollare; mettere in discussione la Sentinella lanciando un `rate_budget live` immediato gonfia il velocity_smoothing nel suo JSONL e induce ordini successivi sbagliati. Apri questa skill OGNI VOLTA che arriva una busta `[SENTINELLA]`.
allowed-tools: Bash(jht-tmux-send *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(python3 /app/shared/skills/freeze_team.py *), Bash(python3 /app/shared/skills/soft_pause_team.py *), Bash(tmux *)
---

# sentinel-orders — reagire al watchdog

La Sentinella emette un tick ogni ~5 min e converte utilizzo + velocità (`vel_team` vs `vel_target`) + settimanale in uno degli ordini sotto. Ogni ordine corrisponde a un'azione precisa. Attieniti alla mappatura; non improvvisare. **NB: `proj` nel tick è INFO volatile (oscilla ±400pt) — NON è il trigger; usa `vel_team` vs `vel_target` + `usage` vs `target` + `weekly`.**

## Tabella throttle (config-driven)

La Sentinella invia un livello `Throttle: N`. Tu lo traduci in durate per-agente in `$JHT_HOME/config/throttle.json`. Gli agenti leggono quel file tramite `jht-throttle --agent <name>` — una singola scrittura atomica si propaga a tutto il team.

| Livello | Pausa | Azioni extra                                                           |
|---------|-------|-------------------------------------------------------------------------|
| **0** velocità piena | 0s    | nessuna restrizione; spawn consentito se il backlog lo richiede     |
| **1** leggero       | 30s   | niente spawn                                                        |
| **2** moderato      | 120s  | + ferma un'istanza extra (es. SCRITTORE-2)                          |
| **3** pesante       | 300s  | + mantieni una sola istanza per ruolo                               |
| **4** quasi-freeze  | 600s  | + ESC azioni correnti, niente spawn                                 |

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 60
python3 /app/shared/skills/throttle-config.py bulk-set \
    scout-1=300 scrittore-1=60 analista-1=0 scorer-1=0 critico=0
python3 /app/shared/skills/throttle-config.py dump          # stato completo
python3 /app/shared/skills/throttle-config.py reset         # tutti a 0
```

Usa **`bulk-set`** quando vuoi valori differenziati per agente in base al consumo individuale (incrocia con `token-rate-now` se vuoi vedere chi sta dominando in questo momento).

> 🎯 **Il livello della tabella non è il valore che scrivi.** `Throttle: N` è un numero solo per tutto il team; in `throttle.json` c'è un valore per agente, e scegliere la ripartizione spetta solo a te — nessuno script muove più il throttle dei worker. L'aritmetica vive in **`throttle-distribution`**: **da chi** viene il taglio (paga il top-burn; l'Analista e lo Scorer, i due ruoli che trasformano un backlog in una posizione **con uno score**, sono gli ultimi che tocchi), **quanti secondi** sono sulla ladder, e **quando la mossa giusta è non fare nulla**. Dare a tutti lo stesso numero è esattamente il fallimento che quella skill esiste per evitare — spende il freno dove non c'era nulla da guadagnare e toglie throughput dove costa di più.

> ⚠️ **Cadenza vs durata.** "Quanto spesso" un agente chiama `jht-throttle` nel suo ciclo si cambia via `tmux` (invii un messaggio all'agente e gli dici di chiamare dopo ogni round del Critico, ecc.). "Quanti secondi" dura la pausa si cambia nel file di configurazione. Non inviare mai numeri di throttle via tmux.

## Quando ordini un freeze esplicito — avviso timeout `N+30` (CRITICO)

Quando invii un `[URG]` a un agente con `jht-throttle <N>`, **DEVI istruirlo nel messaggio stesso di passare `timeout: N+30` come parametro alla chiamata shell tool**. Senza, il bash padre viene ucciso dal timeout predefinito della CLI (Kimi 60s) — l'agente si sblocca dopo 60s invece di N. Il freeze viene eseguito **male**.

Corpo del messaggio corretto:
```
[URG] FREEZE — call jht-throttle 600 --agent scrittore-1 --reason "freeze".
IMPORTANT: pass timeout: 630 to the shell tool call, otherwise the parent dies at 60s and the throttle is executed BADLY.
```

Se il `tmux capture-pane` dell'agente target mostra `Killed by timeout (60s)`, l'agente NON ha rispettato l'istruzione — è un **errore di esecuzione** (loro, o tuo se hai dimenticato di includerlo). Diagnostica con `jht-throttle-check <agent>` (restituisce i secondi rimanenti nel file di stato). Non accettare mai il rilancio del comando o `nohup &` come "fix": l'unica cura è passare il timeout. Vedi `agents/_skills/throttle/DESIGN-NOTES.md` per il design completo.

## Tipi di ordine

### Pacing di routine

| Ordine                                         | Significato / trigger                                              | Azione                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[URG] RALLENTARE` `Throttle: N`               | velocità sopra il target                                           | applica il livello N immediatamente — ma **il livello è deciso, la ripartizione no**: `throttle-distribution` lo traduce in valori per agente |
| `ACCELERARE` `Throttle: 0`                     | primo via libera dopo un rallentamento                             | spawn di **un solo** agente, aspetta il tick successivo prima del secondo (mai 5 di fila)                         |
| `SCALA UP`                                     | `vel_team` ben sotto `vel_target` (under-pace) per 2+ tick, backlog non vuoto | usa `pipeline-triage` per individuare il ruolo collo di bottiglia, spawn 1, aspetta il tick successivo            |
| `PUSH G-SPOT`                                  | `vel_team` lievemente sotto `vel_target`, stagnante                | un agente leggero (Writer se coda score ≥50, altrimenti il collo di bottiglia) per tornare on-pace                |
| `MANTIENI`                                     | on-pace (`vel_team` ≈ `vel_target`, verdetto ALLINEATO) per ≥3 tick | non fare nulla — niente spawn, nessun cambio di throttle. Solo ACK.                                              |
| `RIENTRO`                                      | ritorno al passo nominale                                          | riprendi il piano normale                                                                                         |
| `RESET SESSIONE`                               | finestra di utilizzo scesa da alta → ~0%                           | ricomincia da SCOUT-1, aspetta ordini prima di scalare                                                            |

### Pipeline vuota

| Ordine                                         | Significato                                                        | Azione                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `PIPELINE VUOTA + UNDERSHOOT`                  | under-pace (`vel_team` sotto `vel_target`) E coda writer vuota (scored ≥ 50) | **Non aspettare nuovi ordini.** Apri la skill `pipeline-triage` — ti dice quale ruolo spawnare (raramente Scout). |

### Emergenze

| Ordine                                         | Significato                                                        | Azione                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[EMERGENZA] FREEZATO`                         | la Sentinella ha già premuto ESC sul team                          | decidi se riprendere dopo il reset della finestra di rate; non opporti al freeze                                  |
| `[RECOVERY TRACKING]`                          | INFO durante il recupero, nessuna azione di default                | se il Δ di recupero è troppo lento, lancia una diagnosi autonoma (`db_query`, `rate_budget live` on-demand) e decidi i tagli |
| `[URG] STAGNAZIONE CRITICA`                    | il recupero sta fallendo, burn severo sostenuto (`vel_team` ≫ `vel_target`) per 5+ tick + usage che sale verso 100% | uccidi gli operatori pesanti (anche Sonnet) — scegli quelli nelle tool call (`tmux capture-pane`). Usage > 100% imminente → `freeze_team.py` |
| `[URG] PEGGIORAMENTO POST-FREEZE`              | `vel`/usage risaliti dopo il calo                                  | drastico: `freeze_team.py` + `tmux kill-session` su ogni Sonnet. Tieni vivi solo CAPITANO / SENTINELLA / SENTINELLA-WORKER / ASSISTENTE |

### Messaggi di source-failure (rari, critici)

Arrivano quando il monitoraggio fallisce completamente (L1 + L2 + L3 down).

| Ordine             | Significato                                                     | Azione                                                                                                                  |
|--------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `[PAUSA TEAM]`     | la Sentinella ha già inviato `[PAUSA]` agli operatori via `soft_pause_team.py` | **Fermati anche tu**: niente spawn, niente ordini, niente controlli (la sorgente è rotta). Chiudi il turno e aspetta in silenzio. |
| `[HARD FREEZE]`    | secondo FATAL: ESC×2 via `freeze_team.py`                       | come `[PAUSA TEAM]`, più eventuali task interrotti da gestire al resume                                                 |
| `[RIPRENDI]`       | sorgente di nuovo live                                          | leggi il throttle suggerito; **redistribuisci a tutti gli operatori**; recupera eventuali task interrotti               |

Snippet di resume (usa così com'è):
```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -vE '^(CAPITANO|SENTINELLA|SENTINELLA-WORKER|ASSISTENTE)$'); do
  /app/agents/_skills/tmux-send/jht-tmux-send "$s" "[CAPITANO] [RIPRENDI] source usage live. Resume work. Throttle: N (sleep Xs between operations). Verify the state of any task you had left and proceed."
done
```

## Messaggi prefissati Bridge (non sono ordini, ma li vedi nel tuo pannello)

| Messaggio            | Azione                                                                                                |
|----------------------|-------------------------------------------------------------------------------------------------------|
| `[BRIDGE ALERT] sorgente degraded da N tick` | opera con prudenza, niente spawn aggressivo                                                           |
| `[BRIDGE INFO]`      | recupero / heartbeat — nessuna azione                                                                 |
| `[BRIDGE PACING]`    | tick di pacing a 15 min — `bridge-pacing` decodifica i numeri, `throttle-distribution` decide chi paga. Dal 2026-06-25 questo tick arriva nel pane della **Sentinella** (push→pull): se ne arriva uno a te è l'eccezione, non la regola |

## Comportamento predefinito — esegui senza mettere in discussione

La Sentinella vede velocità + trend nel tempo (`vel_team` vs `vel_target`); tu vedi solo il momento presente. **Applica gli ordini senza ricontrollare.** Un `rate_budget live` ravvicinato dopo un ordine della Sentinella scrive un campione taggato `source=capitano` nel JSONL, gonfia `velocity_smooth`, e induce il *prossimo* ordine della Sentinella a essere sbagliato.

Quando la verifica È giustificata:
- prima di applicare un throttle pesante (3 o 4) su un `[URG]` / `[EMERGENZA]` — controllo a due fonti via `rate_budget live`
- silenzio dalla Sentinella più lungo del solito, verifica che il bridge sia vivo
- dopo un cambiamento significativo del team (3 spawn di fila, kill di un'istanza, `bulk-set`) — osserva l'effetto prima del tick successivo

Quando la verifica NON è giustificata:
- ordini `OK` / `SOTTOUTILIZZO` / `RIENTRO` — niente da verificare, esegui e basta
- entro 2 minuti dall'ultimo campione JSONL — l'EMA anti-spike lo scarta ma resta come rumore

## Regole inviolabili

- Aspetta l'effetto di un throttle (3-5 min) prima di un altro intervento.
- Sotto l'85% senza ordine della Sentinella → aggiungi capacità al collo di bottiglia (usa `pipeline-triage`), NON spawnare a caso.
- Non discutere un throttle perché "il team sta lavorando bene": la Sentinella vede velocità + trend (`vel_team` vs `vel_target`), tu vedi solo il presente.

## Vedi anche

- `bridge-pacing` — la formula di calibrazione a 15 min (flusso separato).
- `throttle-distribution` — *chi* rallenta e di quanto, una volta deciso il livello: la ripartizione per agente, la ladder, il rilascio del freno e i casi in cui non si fa nulla. **Questa skill decodifica l'ordine; quella sceglie i valori.** È anche la casa dell'avviso `[PACE-GUARD]`, che non applica più il throttle da sé.
- `bridge-mailbox` — svuota i verdetti pendenti all'inizio del turno (obbligatorio prima di reagire al tick odierno).
- `pipeline-triage` — *quale* ruolo spawnare sotto `SCALA UP` / `PIPELINE VUOTA`.
- `spawn-agent` — *come* spawnare una volta deciso quale ruolo.
- `throttle` (e `agents/_skills/throttle/DESIGN-NOTES.md`) — interni del sistema di throttle, il design del timeout `N+30`.
