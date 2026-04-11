# Quickstart — Job Hunter Team

Guida per avviare il sistema in 5 minuti.

## Percorso consigliato: installer one-liner

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

Lo script:

1. Rileva il tuo OS (macOS, Linux apt/dnf/pacman, WSL)
2. Installa Node 20+, tmux, git, Claude CLI se mancano
3. Clona la repo in `~/.jht/src`
4. Compila TUI + CLI
5. Crea simlink `jht` in `~/.local/bin`
6. Lancia il setup wizard interattivo

Al termine avrai due cartelle:

| Cartella | Scopo | Chi la tocca |
|----------|-------|--------------|
| `~/.jht/` | Config, database `jobs.db`, agenti, credenziali | Solo gli agenti e il CLI |
| `~/Documents/Job Hunter Team/` | CV da analizzare, output generati (PDF/MD) | Tu + gli agenti |

## Percorso alternativo: launcher desktop (non-tech)

Scarica il launcher dalla pagina `/download` o da GitHub Releases:

- macOS: `.dmg`
- Windows: `.exe`
- Linux: `.AppImage` oppure `.deb`

Il launcher installa tutto con interfaccia grafica, senza aprire il terminale.

## Setup da sorgente (per contribuire)

Questa sezione e' per sviluppo locale, hacking del repo e PR.

### Prerequisiti

- **Node.js 20+** e npm
- **tmux**
- **git**
- **Claude CLI** (`npm install -g @anthropic-ai/claude-cli`)

### Setup

```bash
# 1. Clona la repo
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# 2. Build TUI e CLI
npm --prefix tui install && npm --prefix tui run build
npm --prefix cli install

# 3. Avvia il wizard (crea ~/.jht e ~/Documents/Job Hunter Team)
node cli/bin/jht.js
```

Il wizard ti chiede provider AI e API key. Il profilo candidato si compila poi dalla TUI (vista Profilo) o dalla dashboard web.

## Struttura del Team

Il sistema usa agenti AI paralleli, ognuno con un ruolo preciso:

| Agente | Ruolo | Sessione tmux |
|--------|-------|--------------|
| Scout | Cerca posizioni sui job board | `SCOUT-1`, `SCOUT-2` |
| Analista | Verifica JD e aziende | `ANALISTA-1`, `ANALISTA-2` |
| Scorer | Punteggio 0-100 | `SCORER-1` |
| Scrittore | Scrive CV e Cover Letter | `SCRITTORE-1` |
| Critico | Review CV | `CRITICO` |
| Capitano | Coordinatore | `ALFA` |

## Flusso Operativo

```
Scout → trova posizioni → DB (status: new)
Analista → verifica JD → DB (status: checked / excluded)
Scorer → punteggio 0-100 → DB (status: scored)
  └─ score < 40 → excluded
  └─ score >= 50 → notifica Scrittore
Scrittore → CV + CL → 3 round con Critico
  └─ critic_score >= 5 → status: ready (pronto per l'invio)
  └─ critic_score < 5  → status: excluded
Utente → review finale → invia candidatura
```

## Avvio Manuale degli Agenti

Ogni agente gira in una sessione tmux separata:

```bash
# Avvia Scout-1
tmux new-session -d -s SCOUT-1 -c scout/
tmux send-keys -t SCOUT-1 "claude --dangerously-skip-permissions" Enter

# Avvia Analista-1
tmux new-session -d -s ANALISTA-1 -c analista/
tmux send-keys -t ANALISTA-1 "claude --dangerously-skip-permissions" Enter
```

## Comandi DB Utili

```bash
# Dashboard generale
python3 shared/skills/db_query.py dashboard

# Posizioni per status
python3 shared/skills/db_query.py positions --status new
python3 shared/skills/db_query.py positions --min-score 50

# Dettaglio posizione
python3 shared/skills/db_query.py position 42

# Statistiche
python3 shared/skills/db_query.py stats
```

## Documentazione Completa

- [Schema DB](../shared/docs/db-schema.md)
- [Anti-collisione agenti](../shared/docs/anti-collisione.md)
- [Regole comunicazione](../shared/docs/regole-comunicazione.md)
- [Aggiungere un agente](../shared/docs/add-agent.md)
