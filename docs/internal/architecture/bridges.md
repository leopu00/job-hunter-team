# I tre bridge deterministici (role-map)

Mappa autorevole dei bridge Python deterministici (no-LLM) che girano `setsid`
detached nel container `jht`, lanciati da `start-agent.sh bridge` e risvegliati
dall'`agent-watchdog` (`maybe_respawn_bridges`, fonte di verità `process_health.py`).
Nascono da una domanda ricorrente — «chi notifica chi, e ogni quanto?» — a cui i
nomi storici rispondevano male. Questa è la risposta unica.

## Chi-notifica-chi-e-ogni-quanto

| Script | Cos'è | Cadenza | Notifica | Tag messaggio |
|---|---|---|---|---|
| `sentinel-bridge.py` | **sensore usage** — fetch del provider attivo (codex JSONL / kimi HTTP / claude HTTP), scrive `sentinel-data.jsonl`, campiona i vitals | **adattiva ~2–10 min** (g-spot aware, ancorata ai :00/:05…, floor 15s) | **SENTINELLA** | `[BRIDGE TICK]` / `[BRIDGE FAILURE]` |
| `pacing-bridge.py` | **report di pacing** — velocità team, kT/agente, verdetto SFORO/MARGINE/ALLINEATO. *Non è un sensore*: legge `sentinel-data.jsonl`, non lo scrive | **15 min** (:00/:15/:30/:45 UTC) | **SENTINELLA** | `[BRIDGE PACING]` |
| `heartbeat-bridge.py` | **nudge orario** — sveglia il Capitano quando la Sentinella tace, con un segnale deterministico sui dati DB (code, top-consumer, budget) | **oraria** (allo scoccare dell'ora); **off-hours tace** | **CAPITANO** | `[HEARTBEAT]` |

**Regola da tenere a mente:** *due dei tre parlano alla SENTINELLA* (sensore +
report di pacing); **solo `heartbeat-bridge` parla al CAPITANO**. La Sentinella è
l'unica analista del budget; il Capitano riceve il pacing in **pull on-demand**
(skill `rate-budget` / `agent-speed-table`), non in push.

## Perché questi nomi (e non uno swap)

- `sentinel-bridge` → **resta**: è il sensore accoppiato al data-layer
  (`sentinel-data.jsonl`, `sentinel-log.txt`, tabella `sentinel_ticks`, mig 013).
  Rinominarlo sganciato dal data-layer creerebbe una nuova incoerenza.
- `pacing-bridge` → **resta**: nome per funzione, già corretto. (Storicamente la
  sua docstring diceva «al Capitano»: residuo pre-refactor pull-model del
  2026-06-25, ora corretto — pinga la Sentinella.)
- `capitano-bridge` → **rinominato `heartbeat-bridge`** (2026-07-01): il vecchio
  nome suggeriva una simmetria con `sentinel-bridge` (come se lì vivesse la logica
  del Capitano), mentre è solo un battito orario. Il nome-per-funzione toglie
  l'ambiguità. Rinominati con lui: `heartbeat-bridge-state.json`,
  `/tmp/heartbeat-bridge.log`, env `JHT_HEARTBEAT_SESSION`.

## Ganci (dove sono cablati)

- **Spawn/kill**: `.launcher/start-agent.sh` (case `bridge` → lancia tutti e tre;
  singleton via `grep <script>.py /proc/*/cmdline`).
- **Canary/liveness**: `shared/skills/process_health.py` (tabella `EXPECTED`,
  suite `bridge-suite`) — condivisa da `agent-watchdog` (respawn) e Mantenitore
  (step 0 di `maintainer-sweep`).
- **State/log per bridge**:
  - `sentinel-bridge` → `logs/sentinel-data.jsonl`, `logs/sentinel-log.txt`, `logs/sentinel-bridge.pid`, `/tmp/sentinel-bridge.log`
  - `pacing-bridge` → `logs/pacing-bridge-state.json`, `logs/pacing-bridge.pid`, `logs/bridge-mailbox.jsonl`, `logs/agent-usage-table.json`, `/tmp/pacing-bridge.log`
  - `heartbeat-bridge` → `logs/heartbeat-bridge-state.json`, `/tmp/heartbeat-bridge.log`
- **UI web**: `api/bridge/status` legge lo stato del sensore; `api/team/pacing-bridge`
  legge `pacing-bridge-state.json`. Il `heartbeat-bridge` non ha route web.

## Note operative

- Al primo deploy con i nomi nuovi, sulle VPS resta orfano il vecchio
  `logs/capitano-bridge-state.json` (stato non critico: `last_theme`/`last_ts`,
  rigenerato). Il Mantenitore lo GC al primo sweep — nessun intervento richiesto.
- Off-hours e daily-halt: sia `heartbeat-bridge` sia `pacing-bridge` tacciono
  quando `work_phase=OFF` o esiste `daily-halt.flag` (team in standby).
- **Intento dell'utente (`.burn-intent.flag`, 2026-07-28)**: tutti e tre i bridge
  lo leggono **prima** di applicare un freno di spesa (`shared/skills/burn_intent.py`,
  `jht burn on|off|status`). Con la deroga viva il `daily-halt` non viene scritto,
  il gate orario non zittisce nessuno e `WORKER_FLOOR`/ladder smettono di agganciare
  i valori in lettura. Va letto **prima**, non rimosso dopo: fra la scrittura
  dell'halt e la sua rimozione il team è già andato in ESC. Scade da sola (default
  5h, tetto 12h); lo `sweep` della scadenza è del solo `sentinel-bridge`, che già
  possiede il ciclo di vita di `daily-halt.flag`, e la transizione ON/OFF viene
  annunciata a CAPITANO e SENTINELLA. **Non cedono mai**: `weekly-halt`,
  `host_agent_cap`, `SC-09`, `freeze_team`.
