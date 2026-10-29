---
name: tmux-send
description: Delivre un message a la session tmux d'un autre agent de maniere atomique. Utilise TOUJOURS ce skill pour communiquer avec SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO. N'appelle JAMAIS `tmux send-keys` manuellement — les TUI basees sur Ink (Codex, Kimi) perdent le caractere Enter.
allowed-tools: Bash(jht-tmux-send *)
---
<!-- @translation: fr, ai-translated 2026-06-06 -->

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

## Un `$` dans le texte : apostrophes simples ou stdin

Entre guillemets doubles, le shell lit `$1` et `$2` comme ses propres arguments et les remplace par rien **avant que l'outil ne démarre** : « Plus — $20/month ; Pro — $200/month » arrive chez l'utilisateur comme « Plus — 0/month ; Pro — 00/month », et personne en aval ne peut rendre les chiffres. Si le texte contient un `$` (prix, montants), écris-le entre apostrophes simples ou passe-le par stdin.

```bash
# Single quotes: the shell leaves the $ alone
jht-tmux-send SCOUT-2 '[@capitano -> @scout-2] [MSG] Budget: $120k, floor $5'

# Or from stdin: "-" reads the message, the quoted delimiter keeps every $
jht-tmux-send SCOUT-2 - <<'TXT'
[@capitano -> @scout-2] [MSG] Budget: $120k, floor $5
TXT
```

Écris le `TXT` de fermeture en première colonne, seul sur sa ligne, sans espaces devant (si tu copies le retrait, le heredoc ne se ferme jamais : un texte qui finit par une ligne `TXT` est refusé, rien n'est envoyé).

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
  - Si le destinataire utilise la boîte (`mail_receivers`), `0` signifie **en file** : le message est un fichier durable et le terminal n'a reçu qu'un court rappel. Que l'agent l'ait *pris*, c'est `jht-mail status <agent> <id>` qui le dit ; un message que personne ne prend à temps est signalé à l'expéditeur. Une fois en file, la sortie est `0` quoi qu'il arrive au rappel, sauf `3` (un terminal qui ne répond pas) ; une session qui disparaît après la mise en file ne répond plus `2`, le message attend dans la boîte. Le rappel n'est tapé que lorsque le terminal attend à son prompt ; sinon il est retenu (la sortie reste `0`) et le watchdog le répète.
- `1` — arguments manquants
- `2` — la session cible n'existe pas (verifiez le nom avec `tmux ls`)
- `3` — le texte n'est jamais apparu et le panneau n'est pas occupe → TUI non receptive. **Le seul code qui suggere morte/bloquee.**
- `4` — pair occupe sur un tour long au-dela du budget d'attente → **vivant**. Reessayez plus tard, ne jamais respawner.
- `5` — texte accepte mais jamais soumis ("vivant mais muet") → **vivant**. Reessayez plus tard, ne jamais respawner.
- `7` — le texte a quitte le composer mais rien ne prouve que la CLI l'a pris : **inconnu**. Regardez le panneau avant de reecrire ; ne jamais respawner.
- `8` — une autre livraison vers la meme session etait encore en cours : rien n'a ete tape. Reessayez.
- `130` — le composer n'est pas libre et le message n'est **PAS livre**. Ce qui s'y trouve n'est pas prouve comme etant le notre (un brouillon d'une personne, ou un marqueur de collage que personne des notres n'explique) : rien n'a ete colle ni presse, et votre message est ecrit dans `logs/pending-input.jsonl` (`unsent`). Ne bouclez pas : prevenez le Capitaine (`[BLOCKED]`). Le meme code **apres** le collage signifie que le composer n'est plus seulement notre texte : pas d'Enter, et le texte y est note (`draft`). Le panneau est vivant : ne jamais respawner. Le texte y est coupe a 64 KiB.
- Un texte PROUVE comme le notre (laisse par une livraison anterieure de notre part : identique, ou son marqueur de collage, `[Pasted Content N chars]` sur Codex / `[Pasted text #1 +N lines]` sur Claude, avec notre nombre) recoit son Enter a la livraison suivante, quel que soit son age. `jht-tmux-send --flush-ours <SESSION>` fait seulement cela (0 = libre ou pris, 130 = pas le notre, 5 = Enter avale).
- Une zone de saisie qui contient SEULEMENT du texte signe (un ou plusieurs messages non envoyes, de qui que ce soit : une enveloppe `[@x -> @y]`, les mots de la personne entre les marques `⟦UTENTE·id⟧ … ⟦/UTENTE·id⟧`, ou un jeton de collage que le registre ci-dessus explique : celui de Codex a tout age, celui de Claude dans les `JHT_TMUX_TOKEN_WINDOW` secondes, 600) est un message qui attend son Entree, pas une personne qui ecrit : ton message est colle derriere et une seule Entree emporte les deux ; l'agent peut recevoir l'ancien en retard. Un texte tape a la main, une marque non fermee ou un jeton que personne n'explique restent ce qu'ils etaient (130). N'importe qui peut taper une enveloppe valide a la main : ce n'est pas une authentification, et le cout est le meme qu'un ancien message qui arrive en retard. Une enveloppe SANS marques (un message entre agents) n'a pas de fin propre, et une personne pourrait continuer a ecrire a sa suite : elle compte comme signee seulement si le registre du transport a l'empreinte de ce texte precis (ce qu'il a colle lui-meme sans jamais le voir pris) ; sinon c'est le texte de la personne (130).

> Seul `3` peut mener a un liveness-check et a un respawn. `4` et `5` signifient tous deux que le pair est vivant : les traiter comme une mort est exactement ainsi que commencent les over-spawn.

## Regles

- **JAMAIS** utiliser `tmux send-keys` directement pour communiquer avec un autre agent. Passez toujours par `jht-tmux-send`.
- **JAMAIS** terminer la session tmux d'un autre agent (regle #0 du Capitaine).
- Si `tmux ls` montre que la session cible n'existe pas, **ne la creez pas** — demandez au Capitaine (ou utilisez `start-agent.sh` si vous *etes* le Capitaine).
- Par defaut, utilisez la **coordination via DB** pour les transferts de pipeline (Scout→Analyst→Scorer→Writer) ; utilisez ce skill uniquement pour les signaux en temps reel listes ci-dessus. Voir `agents/_manual/communication-rules.md`.
# Communication pendant un tour occupé

Le message est mis en file immédiatement. Si la livraison est invérifiable, le résultat est `queued/delivery unverified` (exit 6) avec une file durable. Ne jamais supprimer ni dupliquer lors d'un nouvel essai.
