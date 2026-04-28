# Come aggiungere un nuovo agente

Guida per aggiungere un agente al team (es. SCOUT-3).

## 1. Creare branch e worktree

```bash
# Sostituisci $REPO_ROOT con il path della tua repo (es. ~/Repos/job-hunter-team)
cd $REPO_ROOT/alfa
git branch scout-3 main
git worktree add $REPO_ROOT/scout-3 scout-3
```

## 2. Copiare CLAUDE.md dal collega

```bash
cd $REPO_ROOT
sed 's/Scout-1/Scout-3/g; s/scout-1/scout-3/g; s/SCOUT-1/SCOUT-3/g' scout-1/CLAUDE.md > scout-3/CLAUDE.md
```

## 3. Aggiungere MCP config in ~/.claude.json

Aggiungere sotto `projects`:

```json
"$REPO_ROOT/scout-3": {
  "allowedTools": [],
  "mcpServers": {
    "fetch": {"command": "uvx", "args": ["mcp-server-fetch"]},
    "jobspy": {"command": "/opt/anaconda3/bin/python3", "args": [".../alfa/tools/jobspy-mcp/job_server.py"]},
    "linkedin": {"command": "uvx", "args": ["linkedin-scraper-mcp"]},
    "playwright": {"command": "npx", "args": ["@playwright/mcp@latest", "--headless", "--browser", "chromium"]}
  },
  "hasTrustDialogAccepted": true,
  "hasCompletedProjectOnboarding": true
}
```

MCP per ruolo:
- Scout: fetch, jobspy, linkedin, playwright
- Analista: fetch, playwright
- Scorer: fetch
- Scrittore: fetch, pandoc
- Critico: fetch

## 4. Aggiungere a start-all.sh

In `alfa/scripts/scripts/start-all.sh`, aggiungere all'array AGENTS:

```bash
"🔍|scout-3|scout-3|sonnet"
```

## 5. Aggiungere a start-agent.sh

In `alfa/scripts/scripts/start-agent.sh`, aggiungere alla mappa:

```bash
scout-3) echo "🔍|scout-3|sonnet" ;;  # aggiungere nel case di get_agent_info()
```

## 6. Aggiornare status.sh e stop-all.sh

Aggiungere `"🔍|SCOUT-3"` all'array AGENTS.

## 7. Aggiornare send-msg.sh

Aggiungere `scout-3) echo "🔍" ;;  # aggiungere nel case di get_emoji()` alla mappa.

## 8. Aggiornare tabella sessioni in TUTTI i CLAUDE.md

Aggiungere la nuova sessione alla tabella in ogni CLAUDE.md degli altri agenti.

## Note

- Agenti dello stesso ruolo hanno CLAUDE.md identici (tranne il numero)
- Si coordinano automaticamente via tmux all'avvio
- Modello: Sonnet per tutti tranne Critico (Opus)
