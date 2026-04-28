# Regole di Comunicazione Tmux

## Checkpoint obbligatori

Ogni agente DEVE comunicare ai colleghi in questi momenti:

### Scout
- Quando inserisce una nuova posizione nel DB → comunica all'altro Scout e agli Analisti
- Quando finisce un giro di ricerca → comunica al Capitano

### Analista
- Quando prende una posizione per analisi → comunica all'altro Analista (anti-collisione)
- Quando finisce un batch di 5 posizioni → comunica ai Scorer ("ho checkato ID X, Y, Z")
- Quando esclude una posizione (link morto) → comunica al Capitano

### Scorer
- Quando prende una posizione per scoring → comunica all'altro Scorer (anti-collisione)
- Quando trova una posizione score >= 50 → comunica agli Scrittori ("nuova posizione ID X score Y")
- Quando esclude una posizione (PRE-CHECK fallito) → log nel DB

### Scrittore
- Quando prende una posizione (claim status=writing) → comunica all'altro Scrittore
- Quando finisce CV+CL → comunica al Capitano
- Quando avvia/killa il Critico → log nel DB

## Come comunicare

```bash
# Testo (SENZA Enter)
tmux send-keys -t "SESSIONE" "[@me -> @dest] [INFO] messaggio"
# Enter SEPARATO
tmux send-keys -t "SESSIONE" Enter
```

## Come leggere messaggi dei colleghi

Prima di iniziare qualsiasi lavoro, controlla se ci sono messaggi:
```bash
tmux capture-pane -t "LA_MIA_SESSIONE" -p -S -20
```
Se ci sono messaggi non letti, LEGGILI prima di procedere.
