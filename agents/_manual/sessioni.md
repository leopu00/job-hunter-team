# Sessioni Tmux — Team Job Hunter

**IMPORTANTE**: Le sessioni tmux NON hanno emoji nel nome. Solo il nome in maiuscolo.

| Sessione | Ruolo | Modello Default |
|----------|-------|-----------------|
| `SCOUT-1` | Cerca posizioni | Sonnet |
| `SCOUT-2` | Cerca posizioni | Sonnet |
| `ANALISTA-1` | Verifica JD e aziende | Sonnet |
| `ANALISTA-2` | Verifica JD e aziende | Sonnet |
| `SCORER-1` | Punteggio 0-100 | Sonnet |
| `SCORER-2` | Punteggio 0-100 | Sonnet |
| `SCORER-3` | Punteggio 0-100 | Sonnet |
| `SCRITTORE-1` | Scrive CV e CL | Opus |
| `SCRITTORE-2` | Scrive CV e CL | Opus |
| `SCRITTORE-3` | Scrive CV e CL | Opus |
| `CRITICO` | Review CV (base) | Sonnet (effort high) |
| `CRITICO-S1` | Review per Scrittore-1 | Sonnet (effort high) |
| `CRITICO-S2` | Review per Scrittore-2 | Sonnet (effort high) |
| `CRITICO-S3` | Review per Scrittore-3 | Sonnet (effort high) |
| `ALFA` | Capitano primario (coordinatore) | Opus |
| `ALFA-2` | Capitano supporto (brainstorming, fix) | Opus |

**NOTA DUAL ALFA**: Possono esserci 2 Capitani attivi (`ALFA` e `ALFA-2`). `ALFA` è il riferimento primario. Se `ALFA` non risponde, contattare `ALFA-2`.

## Emoji per report (NON per sessioni tmux)

| Emoji | Ruolo |
|-------|-------|
| 🕵️‍♂️ | Scout |
| 👨‍🔬 | Analista |
| 👨‍💻 | Scorer |
| 👨‍🏫 | Scrittore |
| 👨‍⚖️ | Critico |
| 👨‍✈️ | Capitano |

## Protocollo messaggi tmux

**Formato**: `[@mittente -> @destinatario] [TIPO] contenuto`

**Tipi**: `[MSG]` generico, `[INFO]` informativo, `[REQ]` richiesta, `[RES]` risposta, `[URG]` urgente, `[ACK]` conferma

**REGOLA TECNICA**: SEMPRE 2 comandi Bash separati:
```bash
# Comando 1: testo SENZA Enter
tmux send-keys -t "SESSIONE" "[@me -> @dest] [INFO] messaggio"
# Comando 2: Enter SEPARATO
tmux send-keys -t "SESSIONE" Enter
```
MAI mettere `Enter` o `C-m` nella stessa riga del messaggio.
