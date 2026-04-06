# Quickstart — Job Hunter Team

Guida per avviare il sistema in 5 minuti.

## Percorso Consigliato

Per utenti finali: scarica il launcher desktop dalla pagina `/download` o da GitHub Releases.

- macOS: `.dmg`
- Windows: `.exe`
- Linux: `.AppImage` oppure `.deb`

Il launcher avvia il runtime locale e apre automaticamente la dashboard nel browser.

## Setup da Sorgente

Questa sezione e' per sviluppo locale e uso power-user.

## Prerequisiti

- Python 3.10+
- tmux
- git
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Node.js 18+

## Setup

```bash
# 1. Clona la repo
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# 2. Copia e compila il profilo candidato
cp candidate_profile.yml.example candidate_profile.yml
# Edita candidate_profile.yml con i tuoi dati

# 3. Copia e compila le variabili d'ambiente
cp .env.example .env
# Inserisci la tua ANTHROPIC_API_KEY in .env

# 4. Installa dipendenze e inizializza il database
npm install
mkdir -p shared/data
python3 shared/skills/db_init.py
```

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
