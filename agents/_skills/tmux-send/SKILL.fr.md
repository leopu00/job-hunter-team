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

Le wrapper gere cela de maniere atomique : il tape le texte, **relit le panneau pour confirmer qu'il est apparu**, envoie Enter, puis **relit a nouveau le panneau pour confirmer que le tour a vraiment demarre**. La livraison n'est pas "avoir tape" : c'est "avoir vu le tour demarrer".

> ⚠️ Il existe un second etat, plus insidieux : la TUI **accepte le texte et ignore l'Enter**, laissant la ligne suspendue dans le composer pendant que l'agent reste immobile des heures. Vu 4 fois en 3 jours sur un seul VPS, Capitaine inclus, quand un message arrive pendant que le pair termine un tour long. Le wrapper reessaie desormais l'Enter et, si le tour ne demarre toujours pas, retourne **`5`** au lieu de declarer faussement un succes.

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

- `0` — message delivre **et soumis** (verifie : le tour a demarre)
- `1` — arguments manquants
- `2` — la session cible n'existe pas (verifiez le nom avec `tmux ls`)
- `3` — le texte n'est jamais apparu et le panneau n'est pas occupe → TUI non receptive. **Le seul code qui suggere morte/bloquee.**
- `4` — pair occupe sur un tour long au-dela du budget d'attente → **vivant**. Reessayez plus tard, ne jamais respawner.
- `5` — texte accepte mais jamais soumis ("vivant mais muet") → **vivant**. Reessayez plus tard, ne jamais respawner.

> Seul `3` peut mener a un liveness-check et a un respawn. `4` et `5` signifient tous deux que le pair est vivant : les traiter comme une mort est exactement ainsi que commencent les over-spawn.

## Regles

- **JAMAIS** utiliser `tmux send-keys` directement pour communiquer avec un autre agent. Passez toujours par `jht-tmux-send`.
- **JAMAIS** terminer la session tmux d'un autre agent (regle #0 du Capitaine).
- Si `tmux ls` montre que la session cible n'existe pas, **ne la creez pas** — demandez au Capitaine (ou utilisez `start-agent.sh` si vous *etes* le Capitaine).
- Par defaut, utilisez la **coordination via DB** pour les transferts de pipeline (Scout→Analyst→Scorer→Writer) ; utilisez ce skill uniquement pour les signaux en temps reel listes ci-dessus. Voir `agents/_manual/communication-rules.md`.
# Communication pendant un tour occupé

Le message est mis en file immédiatement. Si la livraison est invérifiable, le résultat est `queued/delivery unverified` (exit 6) avec une file durable. Ne jamais supprimer ni dupliquer lors d'un nouvel essai.
