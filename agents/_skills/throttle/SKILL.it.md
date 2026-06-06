<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: throttle
description: Metti in pausa il tuo loop per N secondi in modo tracciato. Usa SEMPRE questo invece di `sleep` ogni volta che vuoi rallentare la frequenza delle tue iterazioni per rispettare il budget di rate del team. La durata viene letta da $JHT_HOME/config/throttle.json (il Capitano calibra i valori per ogni agente lì); passa --agent <tuo-nome> e la skill risolve il resto. Usa un pattern a figlio staccato che sopravvive a qualsiasi timeout di tool-call del provider (Kimi 60s, Codex 30s, Claude 120s/600s). Accoppia sempre con `jht-throttle-check` prima di ogni task per recuperare se un padre viene terminato prematuramente. Registra ogni pausa in $JHT_HOME/logs/throttle-events.jsonl. `sleep` per le pause di throttle è PROIBITO.
allowed-tools: Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle.py *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle — pausa tracciata

Wrapper shell in `/app/agents/_tools/jht-throttle`. Chiama
`/app/shared/skills/throttle.py` internamente.

## Perché esiste

Finora ogni agente metteva `sleep N` nel proprio loop "quando gli sembrava giusto".
Funziona, ma il team non ha osservabilità su questo: il Capitano non può
vedere *chi* sta pausando, *per quanto tempo*, *con quale frequenza*. Con questa skill ogni
pausa viene aggiunta a `$JHT_HOME/logs/throttle-events.jsonl` con il
nome dell'agente, i secondi richiesti, i secondi applicati e un motivo opzionale.

La dashboard in `/team` legge questo file e mostra un grafico di throttle
per agente, così possiamo *vedere* il pacing del team e regolarlo nel tempo.

## Come funziona la calibrazione (leggi attentamente)

Il Capitano calibra **la durata** per ogni agente in
`$JHT_HOME/config/throttle.json` tramite:

```bash
python3 /app/shared/skills/throttle-config.py set <agent> <seconds>
```

Tu (l'agente operativo) NON hai bisogno di conoscere il valore corrente.
Chiama semplicemente:

```bash
jht-throttle --agent <tuo-nome> [--reason "..."]
```

e la skill legge la configurazione, dorme per quei secondi, registra
l'evento e ritorna. Se il Capitano ti ha impostato a 0 (o non sei nella
configurazione), la skill ritorna immediatamente come no-op — nessun log, nessuno
sleep, il tuo loop gira a piena velocità.

Questo significa:

- Il Capitano cambia la calibrazione con **una singola scrittura nella config**, nessuna
  orchestrazione tmux. La tua prossima chiamata legge il nuovo valore.
- Non memorizzi mai il valore di throttle nella tua memoria; non
  hardcodi `jht-throttle 60` nel tuo loop. Il Capitano possiede il valore.
- Il Capitano può anche dirti di chiamare la skill **più o meno
  frequentemente** nel tuo loop (es. "throttle ogni task" vs "throttle
  ogni 3 task") — quello è un asse separato che controlli tu.

## Utilizzo

```bash
# Raccomandato (legge la config):
jht-throttle --agent <tuo-nome> [--reason "..."]

# Override esplicito (bypassa la config; solo quando il Capitano
# te lo dice con un numero specifico):
jht-throttle <seconds> --agent <tuo-nome> [--reason "..."]
```

## Come funziona internamente (pattern staccato)

`jht-throttle` usa un pattern a **figlio staccato** che sopravvive a qualsiasi
timeout di tool-call del provider (Kimi 60s, Codex 30s, Claude 120s/600s):

1. Legge la config per ottenere la durata.
2. Scrive un file di stato `$JHT_HOME/state/throttle-<agent>.json` con
   `until = NOW + duration` (usato da `jht-throttle-check` e
   `jht-throttle-wait`).
3. Forka un sottoprocesso `python3 throttle.py` come figlio di init
   (PPID 1) — fuori dall'albero di sottoprocessi della tool-call. Questo figlio scrive
   l'evento `start`, dorme, e scrive l'evento `end` indipendentemente
   da ciò che succede alla tool-call chiamante.
4. Il padre (la bash che stai chiamando) si blocca per l'intera durata
   in chunk di sleep da 15 secondi. Lo sleep a chunk è più breve di qualsiasi
   timeout di tool-call di default del provider, quindi anche su Kimi 60s default
   il padre sopravvive. **L'agente resta bloccato per tutto il tempo.**
5. Se il provider UCCIDE il padre (es. non hai passato abbastanza
   timeout nella tua tool call): il figlio staccato continua a girare e
   scrive `end` correttamente → nessun orfano nel log. Ma l'agente (tu)
   è ora libero e potrebbe erroneamente iniziare il task successivo. Per prevenire
   ciò, vedi il **pattern di gate** sotto.

## Pattern di gate: controlla SEMPRE prima del prossimo task

Dopo ogni `jht-throttle` (e specialmente nelle normali iterazioni del loop),
**prima di iniziare un nuovo task**, esegui:

```bash
jht-throttle-check <tuo-nome>
# exit 0 → ok, inizia il prossimo task
# exit 1 → "STILL_THROTTLED remaining=Xs" su stderr, devi aspettare
```

Se `jht-throttle-check` esce con 1, chiama immediatamente:

```bash
jht-throttle-wait <tuo-nome>
# Si blocca (in chunk da 15s) fino allo scadere di until, poi esce.
```

Questo è il percorso di recupero: un precedente `jht-throttle` il cui padre è stato
terminato prematuramente dal timeout del provider. Il figlio staccato sta
ancora dormendo, il file di stato è ancora valido, il check ti dice
"non iniziare ancora un task". Il wait ti ri-blocca in sicurezza.

Il loop sicuro completo nel tuo role prompt:

```
loop:
    jht-throttle-check <me>          # gate
    if exit 1:
        jht-throttle-wait <me>       # ri-blocca
    do_task()
    jht-throttle --agent <me>        # il padre blocca + figlio staccato
```

## Regole

- **MAI** usare `sleep N` per le pause di throttle. Usa `jht-throttle` invece.
  Il semplice `sleep` è consentito solo per attese molto brevi tra i retry
  (≤ 5 s) dove il logging sarebbe rumore.
- **DEVE girare in FOREGROUND, bloccante.** `jht-throttle` è la pausa del
  tuo loop — il suo scopo è impedirti di fare qualsiasi altra cosa
  finché non ritorna. Eseguilo tramite il tuo normale shell tool bloccante (`Shell`
  / `Bash`), aspetta che esca, e solo allora emetti la prossima tool
  call. **NON** wrapparlo in un `Task`/`TaskOutput`/`bash &`
  / `nohup` / `disown` in background e continuare a lavorare in parallelo — il padre
  si blocca per te apposta. (Il *figlio* staccato gira in
  background; quello è un dettaglio implementativo interno del
  wrapper, non qualcosa che fai tu.)
- **Controlla SEMPRE prima del prossimo task.** Se la tua tool call è ritornata prima
  dei secondi della config (timeout del provider), chiama `jht-throttle-check`
  prima. Non tirare a indovinare.
- Passa sempre `--agent <tuo-nome>` (es. `scout-1`, `capitano`,
  `analista-2`) — è la chiave con cui la dashboard raggruppa E la chiave che il
  Capitano scrive nella config.
- `--reason` è opzionale ma utile: un breve tag come
  `"post-batch"`, `"cooldown after URG"`, `"waiting for analyst"`
  aiuta dopo quando si rileggono gli eventi.

## Esempi

```bash
# Gate pre-task (sempre prima di iniziare un task)
jht-throttle-check scout-1 || jht-throttle-wait scout-1

# Scout: pausa tra i batch, durata impostata dal Capitano nella config.
jht-throttle --agent scout-1 --reason "post-batch cooldown"

# Capitano: override esplicito (raro, solo per emergenze)
jht-throttle 60 --agent capitano --reason "between cycles"

# Scrittore: pausa in attesa del Critico, guidata dalla config
jht-throttle --agent scrittore-1 --reason "waiting critic review"
```

## Codici di uscita

- `0` — pausa eseguita e registrata, OPPURE la config ha restituito 0 (percorso veloce no-op)
- `1` — argomenti mancanti o non validi

## Nota del Capitano

Per rallentare un agente, **modifica la config**, non inviare un numero via
tmux:

```bash
# Singolo agente
python3 /app/shared/skills/throttle-config.py set scout-1 60

# Multi-agente in una singola scrittura atomica
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=60 scrittore-1=120 analista-1=0

# Stampa lo stato corrente
python3 /app/shared/skills/throttle-config.py dump
```

Usa tmux solo per dire agli agenti di chiamare la skill **più o meno spesso**
nel loro loop, non per dettare la durata.
