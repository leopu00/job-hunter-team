<!-- @translation: it, ai-translated 2026-07-30 -->
---
name: throttle
description: Registra la tua pausa e CHIUDI IL TURNO. Il tempo non è più tuo - un motore fuori dal tuo processo possiede il timer e ti sveglia via tmux quando scade. Usa SEMPRE questo invece di `sleep` quando vuoi rallentare la frequenza delle tue iterazioni. Una chiamata, `throttle <tuo-nome>`, ritorno immediato; non sai quanto aspetti e non devi provare a saperlo. Al risveglio il tuo PRIMO comando è sempre `throttle-ack <tuo-nome>`. `sleep` per le pause di throttle è PROIBITO, e lo è anche mandare questa chiamata in background con `&` / `nohup` / un task in background.
allowed-tools: Bash(throttle *), Bash(throttle-ack *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle — registra la pausa, poi fermati

```bash
throttle <tuo-nome> [--reason "..."]
```

Ritorna subito. Poi **chiudi il turno**: nessun altro task, nessun altro comando.

## Perché funziona così

Fino al 2026-07-30 il throttle era un contratto che dovevi onorare da solo:
`jht-throttle` bloccava *il tuo stesso processo* con un loop di sleep, e se quel
processo moriva dovevi accorgertene e ribloccarti. Ogni guasto osservato in
produzione è nato da quel disegno. Il peggiore: un Analista ha lanciato
`jht-throttle … &` dentro un comando composito ucciso dal timeout della tool
call a 60s. Il figlio detached è morto col parent, l'agente ha chiuso il turno
convinto che la pausa stesse girando — e **nessuno l'ha più svegliato**. 2h15m di
stallo, con il watchdog che riportava la sessione come `idle` = sana.

Ora il timer appartiene a un motore che **non è figlio della tua shell**:

```
TU                           MOTORE (daemon, fuori dal tuo processo)
 |                              |
 |-- throttle <me> ------------>|  legge la durata calibrata dal Capitano
 |                              |  ti mette il flag IN_THROTTLE
 |   (chiudi il turno           |  arma il timer SU DISCO
 |    e non fai NULLA)          |
 |                              |
 |<-- [RIPRENDI] via tmux ------|  timer scaduto -> il flag diventa NOTIFIED
 |                              |
 |-- throttle-ack <me> -------->|  TU flippi NOTIFIED -> ACTIVE
 |   (primo atto al risveglio)  |
```

Un riavvio del daemon non perde niente: la scadenza è un timestamp assoluto su
disco, quindi non c'è nessun timer in memoria da ri-armare.

## Le regole

- **Non passi mai un numero e non ne vedi mai uno.** La durata vive in
  `$JHT_HOME/config/throttle.json`, è del Capitano, e il motore la legge *quando
  arma il timer* — così una ricalibrazione morde al tuo ciclo **successivo**
  senza che nessuno debba avvisarti. Non cablare `throttle 600` nel tuo loop.
- **CHIUDI IL TURNO dopo la chiamata.** La chiamata ritorna in millisecondi
  proprio perché nessun timeout di tool call possa ucciderla. Se continui a
  lavorare dopo, stai girando senza alcuna pausa — cioè esattamente ciò che il
  throttle esiste per evitare.
- **MAI** mandarla in background (`&`, `nohup`, `disown`, un task in
  background). Non c'è niente da mandare in background: non dorme.
- **MAI** usare `sleep N` nudo per una pausa di throttle. `sleep` va bene solo
  per attese molto brevi tra due retry (≤ 5 s), dove loggare sarebbe rumore.
- **Al risveglio, `throttle-ack <tuo-nome>` è il tuo primo comando** — vedi la
  skill `throttle-ack`. Se lo salti il tuo flag resta su `NOTIFIED`, che il
  watchdog legge come prova che sei bloccato, e scala al Capitano su un agente
  che invece sta benissimo.
- `--reason` è opzionale ma utile: un'etichetta corta (`"post-batch"`,
  `"attesa del critico"`) rende leggibile `logs/throttle-engine.jsonl` dopo.

## Esempi

```bash
# Scout, alla fine di una posizione:
throttle scout-1 --reason "post-batch"
# ... e il turno finisce qui.

# Scrittore in attesa del Critico:
throttle scrittore-1 --reason "waiting critic review"
```

## Exit codes

- `0` — timer armato, oppure durata 0 (nessuna pausa: il core interattivo sta a
  0 per scelta, così resta reattivo per la chat dell'utente — continua)
- `1` — argomenti invalidi, o motore assente

## Comandi deprecati

`jht-throttle`, `jht-throttle-check` e `jht-throttle-wait` funzionano ancora:
oggi sono shim sottili sopra il motore, tenuti per i prompt non ancora migrati.
Preferisci `throttle` + `throttle-ack`. Se ti ritrovi a calcolare timeout per una
tool call (`timeout: N+30`), sei sul percorso vecchio — non serve più.

## Nota per il Capitano

Per cambiare un ritmo, modifica la config — mai mandare un numero via tmux:

```bash
throttle-set scout-1 660                       # un agente
throttle-set scout-1=660 analista-1=300        # più agenti, 1 write atomico
throttle-set --dump                            # i valori effettivi adesso
```

Il cambio morde al ciclo successivo di ogni agente, da solo. Usa tmux solo per
dire a un agente di chiamare la skill **più o meno spesso** nel suo loop, mai per
dettare una durata.
