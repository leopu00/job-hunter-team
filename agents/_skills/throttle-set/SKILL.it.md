<!-- @translation: it, ai-translated 2026-07-30 -->
---
name: throttle-set
description: L'UNICO modo in cui i ritmi del team vengono scritti. Solo il Capitano. `throttle-set <agente> <secondi>` modifica la config del throttle per agente; il motore la rilegge quando arma ogni timer, quindi il cambio morde al ciclo SUCCESSIVO di quell'agente da solo - nessun messaggio tmux, nessun agente deve rileggere niente, e il ciclo già in corso non viene disturbato. Usalo invece di mandare numeri ai worker. Anche `throttle-set a=N b=M ...` per un multi-write atomico, `--dump` per i valori effettivi, `--get <agente>`, `--reset`.
allowed-tools: Bash(throttle-set *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle-set — governa i ritmi senza toccare gli agenti

```bash
throttle-set <agente> <secondi>             # un agente
throttle-set scout-1=660 analista-1=300     # più agenti, un write atomico
throttle-set --dump                         # i valori EFFETTIVI adesso
throttle-set --get <agente>                 # il valore effettivo di uno
throttle-set --reset                        # azzera tutti gli override
```

## Perché non mandi mai un numero via tmux

Il motore dei throttle legge la config **nel momento in cui arma ogni timer**.
Quindi:

- un valore che cambi qui morde al ciclo **successivo** di quell'agente, da solo;
- il ciclo **in corso** non viene toccato — la sua scadenza era già calcolata, e
  spostarla sarebbe una sorpresa che nessuno ha chiesto;
- i worker non vedono mai un numero e non sanno quanto aspettano. Chiamano
  `throttle <loro-nome>` e si fermano. La durata è solo tua.

È tutta la ragione per cui questo esiste: cinque messaggi tmux che portano un
numero sono cinque occasioni di andare in corsa con un agente a metà pausa. Un
write atomico è zero.

## Quello che ti torna indietro è l'EFFETTIVO, non quello che hai chiesto

Due correzioni automatiche si applicano in lettura, quindi il numero che l'agente
subisce può differire da quello che hai scritto:

- **Worker floor, 5 min.** I worker (Scout/Analista/Scorer/Scrittore/Critico) non
  scendono mai sotto i 300s, `0` incluso. Nasce da un incidente misurato — uno
  Scout senza pause ha bruciato ~308kT per 3 posizioni di dati sporchi. Il core
  interattivo (Capitano/Sentinella/Assistente/Mentor) **non** ha floor: deve
  restare reattivo per la chat dell'utente, quindi lì `0` resta `0`.
- **Ladder coprima.** Ogni valore > 0 si aggancia a un gradino in minuti primi
  (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60). I gradini multipli di 5
  risincronizzavano i worker *per costruzione*: 5+10 ricadevano insieme ogni 10
  minuti. I gradini coprimi rendono le collisioni rare invece che periodiche.

Quindi `throttle-set scout-1 120` si rilegge come `300`. Non è lo strumento che ti
ignora — è il valore che l'agente subirà, ed è quello che `--dump` mostra.

Entrambe cedono mentre è viva la deroga a termine dell'utente, e tornano da sole
alla sua scadenza. Non devi ricordarti di ripristinarle.

## Per CONSUMARE di più la leva è il parallelismo, non un throttle più basso

I worker non scendono sotto i 5 min, quindi «metti il throttle a 0» per loro non
esiste. Se il team è sotto il ritmo target, aggiungi worker **a stadi**; non
provare a recuperare limando la pausa. Un throttle saturo è un segnale, non una
destinazione: quando un agente è già alto sulla ladder e continua a sforare, la
leva diventa ucciderlo, non un'altra spinta.

## Exit codes

- `0` — scritto / letto
- `1` — argomenti invalidi, valore fuori range (0..3600), o config assente

## Esempio

```bash
throttle-set --dump
# default = 0s
# scout-1        = 660s
# analista-1     = 300s

throttle-set scout-1 1380
# scout-1=1380s

# scout-1 è a metà pausa: tiene i 660s che aveva, e subirà 1380s al prossimo
# ciclo. Nessuno gli ha detto niente.
```
