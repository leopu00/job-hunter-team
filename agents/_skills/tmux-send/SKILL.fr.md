<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: tmux-send
description: Delivre un message a la session tmux d'un autre agent de maniere atomique. Utilise TOUJOURS ce skill pour communiquer avec SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO. N'appelle JAMAIS `tmux send-keys` manuellement — les TUI basees sur Ink (Codex, Kimi) perdent le caractere Enter.
allowed-tools: Bash(jht-tmux-send *)
---

# tmux-send — messagerie inter-agent

Wrapper shell situe dans `/app/agents/_skills/tmux-send/jht-tmux-send` (egalement dans le `PATH` via un symlink dans `/usr/local/bin`, cree lors du build de l'image).

## Pourquoi il existe

Les TUI basees sur Ink (Codex, Kimi Code) **perdent l'Enter** s'il arrive dans le meme appel `tmux send-keys` que le corps du message. Le texte est envoye caractere par caractere ; Ink doit terminer le rendu avant d'accepter une autre frappe de touche. Si vous appelez `tmux send-keys "msg" Enter`, le message reste dans le tampon d'entree du pair sans etre soumis → deadlock silencieux entre agents.

Le wrapper gere cela de maniere atomique : `text → sleep 0.3 → Enter → sleep 0.5 → Enter` (le second Enter est idempotent par robustesse).

## Utilisation

```bash
jht-tmux-send <SESSION> "<message>"
```

## Exemples (V5)

```bash
# Captain → Scout (INFO, message operationnel generique)
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [INFO] Start the main loop. Begin from CIRCLE 1 (Remote EU); ping after each batch of 3-5 positions."

# Captain → Writer (URG, ordre en temps reel)
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [URG] FREEZE — finish the current Critic round, then sleep until throttle returns to T0/T1."

# Analyst → Scout (FEEDBACK, coaching sur les motifs de rejet)
jht-tmux-send SCOUT-2 "[@analista-1 -> @scout-2] [FEEDBACK] [SENIORITY] 4 of last 5 inserts from greenhouse.io require senior+ — switch source or query for the next batch."

# Sentinel → Captain (URG, changement d'etat)
jht-tmux-send CAPITANO "[@sentinella -> @capitano] [URG] Usage 94%, projection 102% — recommend throttle T2 + freeze Writers."

# Writer → Captain (REPORT, resultat final)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [REPORT] Position 42 — verdict PASS, score 7.5/10. PDF: /jht_user/.../CV.pdf"

# Worker → Captain (ACK, confirmation d'un URG)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [ACK] freeze applied, sleeping."
```

## Enveloppe du message

Conservez toujours le prefixe structure :

```
[@<from> -> @<to>] [<TYPE>] <text>
```

Types standards (voir `agents/_manual/communication-rules.md` pour la taxonomie complete et les attentes par role) :

- `BLOCKED` — worker → Capitano : tu as **CESSÉ de produire** et ça ne laisse aucune trace en DB (outil cassé, `403`/`LOCKED`, sources sèches, un élément que tu ne peux ni traiter ni sauter). Depuis le 2026-07-27 c'est la SEULE chose qui distingue un stall du travail silencieux
- `URG` — ordre en temps reel necessitant une action immediate (FREEZE, throttle, kill)
- `FEEDBACK` — coaching vers l'agent en amont avec un tag de rejet (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`)
- `REQ` / `RES` — requete/reponse synchrone entre agents
- `ACK` — accuse de reception d'un `URG` ou `REQ` que vous ne pouvez pas encore traiter
- ~~`INFO` / `REPORT`~~ — **retirés pour le trafic entre pairs** (2026-07-27) : ils représentaient 8 des 30 messages de pur statut qui réveillaient le Capitano en ~1,5h. L'avancement se tire de `db_query.py recent-activity`, il ne se raconte pas

> 💬 `[CHAT]` est reserve aux messages **utilisateur → agent** depuis la web UI (voir le protocole dans le prompt du Capitaine). Ne l'utilisez pas pour le trafic inter-agent.

## Codes de sortie

- `0` — message delivre
- `1` — arguments manquants
- `2` — la session cible n'existe pas (verifiez le nom avec `tmux ls`)

## Regles

- **JAMAIS** utiliser `tmux send-keys` directement pour communiquer avec un autre agent. Passez toujours par `jht-tmux-send`.
- **JAMAIS** terminer la session tmux d'un autre agent (regle #0 du Capitaine).
- Si `tmux ls` montre que la session cible n'existe pas, **ne la creez pas** — demandez au Capitaine (ou utilisez `start-agent.sh` si vous *etes* le Capitaine).
- Par defaut, utilisez la **coordination via DB** pour les transferts de pipeline (Scout→Analyst→Scorer→Writer) ; utilisez ce skill uniquement pour les signaux en temps reel listes ci-dessus. Voir `agents/_manual/communication-rules.md`.
