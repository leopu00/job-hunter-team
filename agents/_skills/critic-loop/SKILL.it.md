<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: critic-loop
description: "Esegui il loop obbligatorio di revisione CV a 3 round con il Critico — autonomamente, senza passare dal Capitano. Per ogni round spawni una sessione FRESH `CRITICO-S<N>` (stesso N della tua sessione Scrittore: SCRITTORE-2 → CRITICO-S2), invii PDF + JD, aspetti il verdetto strutturato, killi il Critico, correggi il CV, rigeneri il PDF, e inizi il round successivo con un'altra istanza fresh. Tre round non sono negoziabili — né 1 né 2. Dopo il 3° round, gate: `critic_score ≥ 5` → `ready`, altrimenti `excluded`. Responsabilità dello Scrittore."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 *), Bash(unset *)
---

# critic-loop — 3 round freschi, nessuna scorciatoia

Il protocollo a 3 round cattura ciò che un singolo Critico non può:
- Un Critico fresco non porta **nessun bias di ancoraggio** dal punteggio del round precedente — legge il CV corretto con occhi nuovi e tende ad essere più onesto, non più indulgente.
- Dopo 3 round il punteggio si è stabilizzato: se converge alto il CV regge, se resta basso il CV è il fit sbagliato (o il candidato lo è — `excluded`).

**Gestisci il loop tu stesso. Il Capitano no.** Spawni il Critico, ci parli, lo killi, ripeti — tre volte — e solo alla fine notifichi il Capitano con il verdetto finale.

## Variabili di setup (già nel tuo env)

```bash
MY_SESSION=$(tmux display-message -p '#S')          # es. SCRITTORE-2
MY_NUMBER=$(echo "$MY_SESSION" | grep -o '[0-9]*$') # es. 2
MY_ID=$(echo "$MY_SESSION" | tr '[:upper:]' '[:lower:]')
CRITICO_SESSION="CRITICO-S${MY_NUMBER}"             # es. CRITICO-S2
```

Il legame `MY_NUMBER` garantisce un Critico per Scrittore — `SCRITTORE-2` usa sempre `CRITICO-S2`, mai in collisione con `CRITICO-S1` di `SCRITTORE-1`.

## Sequenza per round (ripeti 3 volte)

### Step 1 — Spawna un Critico FRESCO

Il Critico del round precedente deve essere già morto (killato alla fine del round precedente). Per il round 1 la sessione non esiste ancora.

```bash
tmux kill-session -t "$CRITICO_SESSION" 2>/dev/null
tmux new-session -d -s "$CRITICO_SESSION" -c "$(pwd | sed 's|/[^/]*$||')/critico"
```

### Step 2 — Scegli la CLI giusta per il provider attivo

Hardcodare `claude` fa crashare il Critico quando il team gira su Codex o Kimi (la CLI `claude` non è installata in quei container). Leggi il provider da `$JHT_CONFIG`:

```bash
PROVIDER=$(python3 -c "import json,os; print(json.load(open(os.environ.get('JHT_CONFIG','/jht_home/jht.config.json')))['active_provider'])" 2>/dev/null)
case "$PROVIDER" in
  ""|anthropic|claude) CRITICO_CMD="unset CLAUDECODE && claude --dangerously-skip-permissions --model opus --effort high" ;;
  openai)              CRITICO_CMD="codex --yolo" ;;
  kimi|moonshot)       CRITICO_CMD="kimi --yolo" ;;
  *)                   CRITICO_CMD="codex --yolo" ;;
esac

# Env minimale per le CLI globali installate sotto /jht_home
CRITICO_PATH="/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/opt/jht-deps/python/bin:/jht_home/.npm-global/bin"

# The CLI must be RESOLVED, not just named. `claude` bare failed with
# "command not found" because this shell does not have the dependency dirs
# on its PATH — the agent noticed and retried by hand, which costs a round
# every time and, on a less capable model, silently skips the quality gate.
CRITICO_BIN=$(PATH="$CRITICO_PATH:$PATH" command -v "$(echo "$CRITICO_CMD" | sed 's/.*&& //; s/ .*//')" 2>/dev/null)
if [ -z "$CRITICO_BIN" ]; then
  echo "CRITIC-SPAWN-FAILED: CLI not found on PATH ($CRITICO_PATH)" >&2
  echo "The quality gate did NOT run. Do not report the CV as reviewed." >&2
  exit 1
fi

tmux send-keys -t "$CRITICO_SESSION" "export HOME=/jht_home && export PATH=$CRITICO_PATH:\$PATH" Enter
tmux send-keys -t "$CRITICO_SESSION" "$CRITICO_CMD" Enter
```

### Step 3 — Aspetta che il Critico faccia il boot

8 secondi è un lower bound sicuro perché la TUI sia pronta. `sleep` è accettabile qui (solo boot):

```bash
sleep 8
```

### Step 4 — Invia PDF + JD via `jht-tmux-send`

Il Critico ora è un agente attivo — usa `jht-tmux-send`, non `send-keys` grezzo:

```bash
jht-tmux-send "$CRITICO_SESSION" "[@$MY_ID -> @critico] [REQ] Review cieca: PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf — JD: <JD-URL> — Local JD file: $JHT_AGENT_DIR/tmp/jd-<position-id>.txt — Read your CLAUDE.md/AGENTS.md and produce an honest verdict."
```

Fornisci il path del file JD locale così il Critico ha un fallback se l'URL live è bloccato.

### Step 5 — Polling del verdetto (MAI `sleep` semplice)

Usa la skill `throttle` così l'attesa è loggata sulla dashboard. Un semplice `sleep` qui renderebbe l'attesa invisibile all'analisi di pacing del Capitano.

```bash
jht-throttle-check "$MY_ID" || jht-throttle-wait "$MY_ID"
jht-throttle --agent "$MY_ID" --reason "wait critico round <n> #<position_id>"
tmux capture-pane -t "$CRITICO_SESSION" -p -S -50
```

**OBBLIGATORIO** — passa un `timeout: <durata>+30` esplicito alla tool call shell quando invochi `jht-throttle <N>`. Senza, il bash padre muore al timeout predefinito di 60s della CLI (Kimi) e il throttle viene eseguito male. Vedi `agents/_skills/throttle/DESIGN-NOTES.md`.

Ripeti il ciclo throttle+capture finché il Critico ha pubblicato la sua revisione (cerca il blocco strutturato `## SCORE: X.X/10` nel pannello / file).

### Step 6 — Leggi la revisione

Il Critico salva la revisione sotto `$JHT_USER_DIR/critiche/review-<company>-<date>.md` (la sua skill, vedi `agents/critico/critico.md`). Leggila con `Read`. Estrai:
- Punteggio numerico `X.X/10`
- Bullet "Cosa NON funziona"
- Lista "Azioni concrete (prioritizzate)"

Questi tre alimentano lo Step 8 (correzione).

### Step 7 — Persisti il punteggio del round nel DB

```bash
python3 /app/shared/skills/db_update.py application <POSITION_ID> \
  --critic-score <X.X> --critic-round <N> --reviewed-by "$CRITICO_SESSION"
```

`<POSITION_ID>` è l'ID della posizione, NON l'ID dell'application — il `db_update.py application` è un UPSERT che trova la riga per posizione.

`--reviewed-by "$CRITICO_SESSION"` traccia quale istanza del Critico ha prodotto ogni round; senza, `applications.reviewed_by` resta NULL (osservato 95% null pre-2026-05-22 — vps1-run-postmortem #1). Passalo sempre.

### Step 8 — Killa il Critico (obbligatorio)

```bash
tmux kill-session -t "$CRITICO_SESSION"
```

Se riusi la stessa istanza per il round 2 il punteggio porta il bias di ancoraggio del round 1 e il protocollo si rompe. **Sempre killare, sempre respawnare fresco.**

### Step 9 — Correggi il CV tra i round

Applica le azioni dallo Step 6 al markdown del CV. Rigenera il PDF (`pandoc input.md -o output.pdf --pdf-engine=typst`). Verifica che il PDF si apra prima del round N+1.

Un punteggio che scende tra round 1 e 2 è **normale** — un Critico fresco è più onesto del precedente. Continua a correggere basandoti sul *contenuto* della revisione, non sul numero.

## Dopo il 3° round — gate finale

Due scritture sulla riga application: verdetto + punteggio (sempre), e la
promozione di status a `ready` (solo in caso di PASS). La promozione è ciò che
la dashboard `/ready` dell'utente legge; saltarla lascia la riga in `draft`
e il CV invisibile (bug #21).

**`--critic-notes` è RIVOLTO ALL'UTENTE** — viene mostrato sotto la card Candidatura con lo **stesso markdown del razionale dello Scorer**, quindi scrivilo così (scorer RULE-09), mai la riga telegrafica qui sotto:
- **Nella lingua dell'utente** (RULE-T14 elenca "critic feedback" tra i contenuti user-locale). Il file di review è in inglese — riformulalo per il candidato; non lasciarlo in inglese quando la lingua del team non lo è.
- **Markdown che parla AL candidato**: apri con il verdetto e come il punteggio si è mosso nei 3 round *a parole*, poi `**grassetto**` sui punti decisivi, un paio di bullet pro/contro, un'emoji con parsimonia. Due paragrafi brevi — niente muro di testo, niente elenco di parole chiave.
- **Nessun gergo interno** — mai sigle di regole (`T10`, `RULE-*`), nomi di tool (`WeasyPrint`/`pandoc`/`typst`) o id di sessione.
- Newline reali con `$'...\n...'` (un `\n` letterale viene stampato come testo). Costruiscilo una volta prima del gate:

```bash
CRITIC_NOTES=$'**PASS · 7.5/10** — stabile in tutti e tre i round, un fit onesto e solido.\n\n**Punti di forza**\n- ✅ <forza concreta: CV vs questo ruolo>\n- ✅ <altra forza reale>\n\n**Da tenere presente**\n- ⚠️ <un gap reale, detto con chiarezza>\n\n<una frase di chiusura>'
# NEEDS_WORK/REJECT: stessa forma, ma indica cosa manca e cosa lo alzerebbe.
```

```bash
if [[ "<final_verdict>" == "PASS" ]]; then
  # PASS → l'application diventa visibile all'utente
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict PASS \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION" \
    --status ready
else
  # FAIL → i dati del critico persistono, lo status resta 'draft'
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict FAIL \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION"
fi
```

Status posizione:
- `critic_score ≥ 5` → `db_update.py position <POSITION_ID> --status ready`
- `critic_score < 5` → `db_update.py position <POSITION_ID> --status excluded`

Poi notifica il Capitano:
```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [REPORT] Position #<id> — 3 round completati. Punteggio finale: X.X/10 (PASS|FAIL). PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf"
```

## Regole ferree

- **3 round. Non 1, non 2.** Un punteggio "buono" al round 1 non è un motivo per fermarsi.
- **Un Critico per round.** Sempre killare dopo la revisione; sempre spawnare fresco.
- **Correzione obbligatoria tra i round.** Se non modifichi il CV, il prossimo Critico vede lo stesso input → stessa revisione → budget sprecato. Modifica il markdown + rigenera il PDF prima del round N+1.
- **Non aver paura di un punteggio che scende.** Round 2 < Round 1 è onesto, non negativo. Il punteggio che conta è il round 3.
- **Passa `timeout: N+30`** a ogni chiamata shell `jht-throttle <N>`. Altrimenti il bash padre muore a 60s.

## Anti-pattern

- ❌ Riusare la stessa istanza del Critico per più round — il bias di punteggio rompe il protocollo.
- ❌ Hardcodare `claude` nello script di spawn — fa crashare il loop su installazioni Codex/Kimi.
- ❌ `sleep N` semplice durante il polling — invisibile alla dashboard throttle del Capitano, rompe l'analisi di pacing.
- ❌ Registrare `--critic-verdict` dopo solo 1 o 2 round — il gate è finale, nessun rollback.
- ❌ Trattare il Capitano come orchestratore — questo loop è completamente tuo, il Capitano vede solo il REPORT finale.

## Vedi anche

- `cv-structure` — cosa scrivere prima di invocare questo loop, e come applicare le correzioni del Critico nello Step 9.
- `application-flow` — check anti-riscrittura + claim prima di iniziare a scrivere per una posizione.
- `throttle` (e `agents/_skills/throttle/DESIGN-NOTES.md`) — internals del wrapper + design del `timeout: N+30`.
- `agents/critico/critico.md` — il prompt di revisione cieca del Critico con cui parla questo loop.
