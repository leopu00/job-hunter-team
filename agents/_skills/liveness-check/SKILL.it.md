<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: liveness-check
description: "Diagnostica se la sessione tmux di un agente del team è viva, in un turno lungo, o silenziosamente morta — e la respawna preservando il contesto se morta. Responsabilità del Dottore (l'agente di health-check itinerante del team), non del Capitano. La modalità di fallimento core che questa skill cattura: `jht-tmux-send` restituisce `exit 0` anche quando la CLI del target è crashata (il messaggio viene scritto in una bash nuda, poi perso). Senza check di liveness periodici il team continua a \"parlare a un cadavere\" e il Capitano conta su azioni che non avverranno mai."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *)
---

# liveness-check — mantieni il team onesto

Una sessione tmux può sopravvivere alla sua CLI. Quando la TUI Codex / Kimi crasha, tmux cade su un prompt bash nudo; i messaggi continuano a essere scritti lì (`exit 0` da `jht-tmux-send`), nessuno li legge, l'agente è uno zombie. Questa skill rileva lo stato e recupera.

## Quando eseguire un check

- 👨‍⚕️ **Giro routinario** — ogni risveglio del Dottore (~30 min) percorre ogni sessione del team in sequenza (vedi `agents/dottore/dottore.md` per il ciclo di vita one-shot completo).
- 🚨 **Handoff Capitano** — quando il Capitano segnala un agente silenzioso > 10 min mentre dovrebbe star lavorando (nessun REPORT Scout, nessun ACK dello Scrittore al Critico).
- 🔁 **Post-URG** — 10-30s dopo un `[URG]` / `[MSG]` del Capitano per confermare ACK + la CLI è ancora viva.
- ⚖️ **Pre-scaling** — prima di uno spawn/kill che dipende dallo stato di un agente esistente (non spawnare l'Analista se lo Scout da cui dipende è morto).

## Ordine di priorità — user-facing PER PRIMI

Prima di qualsiasi percorrimento, ordina i target così gli agenti user-facing
long-lived vengono controllati per primi. Sono in cima alla catena — se muoiono,
**nessuno li respawna** (il Capitano spawna worker, non se stesso /
l'Assistente / il Mentor / la Sentinella). Il post-mortem della
notte zombie 2026-05-18 ha avuto 6-8h di Capitano morto perché i Dottori
percorrevano i worker per primi, mai raggiungendo il Capitano, e si auto-distruggevano.

```
PRIORITÀ 1 (controlla sempre per primi):
  ASSISTENTE, CAPITANO, MENTOR, SENTINELLA
PRIORITÀ 2 (worker, il Capitano può respawnarli):
  SCOUT-N, SCRITTORE-N, CRITICO-S*, ANALISTA-N, SCORER-N
```

Se hai solo 10 min di budget per il giro, **finisci sempre la PRIORITÀ 1
prima di toccare la PRIORITÀ 2**. Un worker morto 30 min è recuperabile; un
Capitano morto 30 min significa che l'intera pipeline è silenziosa.

## Step 0 — `pane_current_command` (pre-check economico)

Prima del capture-pane, fai il check economico:

```bash
cmd=$(tmux list-panes -t <SESSION> -F '#{pane_current_command}' | head -1)
```

Se `$cmd` non è `Kimi` / `kimi` / `claude` / `codex` / `node` / `python*`
→ la CLI LLM è **già morta**, il pannello è bash residua.
Salta il ping (finirebbe nella bash e `jht-tmux-send` restituirebbe
`exit 0` ingannevolmente), vai direttamente allo Step 3 RESPAWN.

Questo singolo check avrebbe catturato il Capitano zombie del 2026-05-18 —
il pannello era bash (PID 663, `/proc/663/exe → /usr/bin/bash`) con kimi
crashato. `tmux has-session` restituiva True, mentendo al watchdog per
11 ore.

## Step 1 — cattura, non fidarti

Leggi sempre il pannello prima; non agire alla cieca:

```bash
tmux capture-pane -t <SESSION> -p -S -200
```

Il scroll-back di 200 righe dà contesto sufficiente per (a) giudicare lo stato, (b) ricostruire cosa stava facendo l'agente per il kick-off del resume se deve essere respawnato.

## Step 2 — tabella di diagnosi

Confronta le **ultime 20 righe** con:

| Pattern in `tmux capture-pane -t <SESSION> -p \| tail -20`           | Diagnosi            | Azione              |
|----------------------------------------------------------------------|---------------------|---------------------|
| Risposta concreta a un ping recente (es. "scrivo CV su #281")        | ✅ vivo, lavora     | log `status=alive`, agente successivo |
| `Working...` per > 5 min sullo stesso turno, ma output token visibile | 🟡 turno lungo      | log `status=long_turn`, NON respawnare |
| Pannello invariato dal ping precedente                               | 🔴 bloccato / inerte | RESPAWN (Step 3)    |
| Spinner `Whirlpooling...` > 10 min, zero output                     | 🔴 stallo silenzioso | RESPAWN             |
| Ultima riga = `jht@<host>:~/agents/<role>$` (prompt shell nudo)      | 💀 CLI uscita       | RESPAWN             |
| `Permission denied: …/.kimi/sessions/.../context.jsonl`              | 💀 kimi crashato su IO contesto | RESPAWN  |
| `Run kimi export and send the exported data to support`              | 💀 banner crash kimi | RESPAWN            |
| `To resume this session: kimi -r <id>`                               | 💀 sessione orfana  | RESPAWN             |
| `Killed by timeout (60s)` (Kimi)                                     | 🟡 tool call killata, CLI viva | NON è un caso di respawn — l'agente ha dimenticato di passare `timeout: N+30` alla sua tool call shell (vedi `agents/_skills/throttle/DESIGN-NOTES.md`). Diagnostica con `jht-throttle-check <agent>`. |
| `command not found` per `kimi` / `claude` / `codex`                  | 💀 launcher bypassato | RESPAWN            |
| Pannello fermo > 5 min, niente spinner, niente input                 | 🟡 inattività ambigua | cattura estesa (`-S -100`) per contesto completo |

Se in dubbio: **non respawnare**. Log `status=ambiguous`. Un falso positivo (respawn non necessario) costa 1-2 min di reboot + contesto perso. Un falso negativo (zombie mancato) costa al massimo 30 min fino al prossimo giro Dottore.

## Step 3 — respawn con contesto (solo su 🔴 / 💀)

Sequenza atomica:

a) **Usa il pannello già catturato** allo Step 1 come "memoria" dell'agente. Estrai:
   - ultimo task in corso (es. "scrivo CV sulla posizione #281")
   - ultimo messaggio del Capitano (cerca marker `[@capitano -> @<role>]`)
   - eventuali errori recenti

b) **Identifica ruolo + workdir**.
   - Singleton (`capitano | critico | sentinella | assistente | mentor | dottore`) → `/jht_home/agents/<role>/`
   - Multi-istanza (`scout | scrittore | scorer | analista`) → `/jht_home/agents/<role>-<N>/` dove `<N>` è il numero finale nella sessione tmux (es. `SCRITTORE-2` → `/jht_home/agents/scrittore-2/`).

c) **Killa la sessione rotta, respawna via launcher** (usa la semantica della skill `spawn-agent` — mai `tmux new-session` + `send-keys "kimi ..."` grezzo):

```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
sleep 12
```

d) **Inietta il contesto di resume** come corpo del kick-off (non dire solo "resume" — dì *cosa* e *dove*):

```bash
jht-tmux-send <SESSION> "[@dottore -> @<role>] [MSG] Resume: <task in corso prima del crash>. Ultimo ordine del Capitano: <citato dal pannello>. Riprendi da lì, NON ripartire da zero. Conferma con [@<role> -> @capitano] [RESUME] <descrizione di una riga>."
```

Se il pannello mostra che l'agente aveva una riga DB reclamata (es. `status=writing` su una posizione), includilo nel contesto di resume così non duplica il lavoro. **Mai respawnare alla cieca**: leggi `db_query.py` prima se necessario.

## Eccezioni ferree "non respawnare"

MAI respawnare:
- Una sessione con **attività output token negli ultimi 60 secondi** — l'agente sta lavorando, anche se sembra lento.
- Il `CAPITANO` durante una rotazione finestra Codex (session_id che cambia nella sentinella) — aspetta la stabilizzazione.
- Turni lunghi (> 5 min) CON output token visibile (parsing, edit file) — lungo ≠ morto.
- Te stesso (`DOTTORE*`) o `DOCTOR-WATCHDOG`.

## Idempotenza

Se il pannello catturato mostra già un marker `[RESUME]` recente (entro ~5 min), un altro giro Dottore ha appena respawnato l'agente. Log `status=alive` e vai avanti — non respawnarlo di nuovo.

## Logging

Ogni azione finisce in `/jht_home/logs/dottore-actions.jsonl` (append-only, un JSON per riga):

```json
{"ts": "ISO-UTC", "round_id": "uuid-or-epoch", "session": "SCRITTORE-1",
 "role": "scrittore-1", "event": "diagnosis",
 "status": "alive|long_turn|stallo|cli_dead|ambiguous",
 "evidence": "ultime 1-2 righe pannello"}
{"ts": "ISO-UTC", "round_id": "...", "session": "SCRITTORE-1", "role": "scrittore-1",
 "event": "respawn", "context_recovered": "...", "new_pid": null}
```

Genera `round_id` una volta per giro Dottore (es. epoch seconds all'inizio del giro). Appendi con `>>`, mai sovrascrivere.

## Anti-pattern

- ❌ Fidarsi del codice di uscita 0 di `jht-tmux-send` come prova di consegna. Consegna ≠ esecuzione. Accoppia sempre con capture-pane su un messaggio critico.
- ❌ Killare una sessione senza capture-pane prima — potrebbe essere in una lunga tool call, non morta.
- ❌ Respawnare alla cieca (senza contesto di resume) — il nuovo agente riparte da zero, duplica lavoro, perde righe DB reclamate.
- ❌ Percorrere le sessioni in parallelo — solo in sequenza, un ping alla volta. Ping paralleli sovraccaricano tmux su team grandi.
- ❌ Spendere > 10 min totali in un singolo giro — se un giro si allunga, abbrevia; il prossimo Dottore arriva tra ~30 min.

## Vedi anche

- `agents/dottore/dottore.md` — il ciclo di vita completo one-shot del Dottore (boot → giro → auto-distruzione).
- `spawn-agent` (Capitano) — il launcher + contratto kick-off che questa skill riusa per i respawn.
- `agents/_skills/throttle/DESIGN-NOTES.md` — il caso `Killed by timeout (60s)` (NON è un respawn).
- `agents/_team/team-rules.md` T01 — mai killare la sessione di un altro agente **eccetto** nel flusso esplicito di respawn sopra.
