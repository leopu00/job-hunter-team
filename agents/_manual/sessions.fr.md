<!-- @translation: fr, ai-translated 2026-06-06 -->
# 🪟 Sessions Tmux

L'equipe JHT fonctionne comme un ensemble de sessions tmux a l'interieur du conteneur. Les noms de session sont **en majuscules, sans emoji, sans espaces**.

## 📛 Convention de nommage

| Pattern | Signification | Exemples |
|---|---|---|
| `<ROLE>` | Singleton — une seule instance | `CAPITANO` · `CRITICO` · `SENTINELLA` · `ASSISTENTE` |
| `<ROLE>-<N>` | Membre du pool — N est un entier positif | `SCOUT-1` · `ANALISTA-2` · `SCRITTORE-3` |
| `<ROLE>-S<N>` | Cree dynamiquement par un autre agent | `CRITICO-S1` (cree par `SCRITTORE-1`), `CRITICO-S2`, … |

## 📚 Sessions connues

### Sessions pool (le Capitaine decide du nombre d'instances)

| Prefixe de session | Role | Notes |
|---|---|---|
| `SCOUT-<N>` | Decouverte | Instances multiples, coordination peer via `scout_coord.py` |
| `ANALISTA-<N>` | Verification | Extrait de `next-for-analista` |
| `SCORER-<N>` | Notation | Extrait de `next-for-scorer` |
| `SCRITTORE-<N>` | Redaction | Extrait de `next-for-scrittore` (score DESC) |

### Singletons

| Session | Role | Notes |
|---|---|---|
| `CAPITANO` | Commandant de l'equipe | Instance unique — coordonne les ordres, l'etat, les escalades |
| `CRITICO` | Critique autonome | Legacy — en V5 le Critique est cree dynamiquement par les Redacteurs (voir ci-dessous) |
| `SENTINELLA` | Watchdog de consommation | Edge-triggered, communique uniquement avec `CAPITANO` |
| `ASSISTENTE` | Copilote cote utilisateur | Traduit les demandes de l'utilisateur en ordres |
| `MENTOR` | Agent career-coach | Prevu, actuellement un placeholder |

### Sessions dynamiques

| Session | Creee par | Duree de vie |
|---|---|---|
| `CRITICO-S<N>` | `SCRITTORE-<N>` (un Critique neuf par cycle de revision) | Une demande de revision → une session, supprimee par le Redacteur immediatement apres |

Le Redacteur cree `CRITICO-S<N>` avec le meme numero (`SCRITTORE-1` → `CRITICO-S1`), execute la revision, puis `tmux kill-session`. Une nouvelle instance du Critique est creee pour **chacun** des 3 cycles de revision — jamais reutilisee.

## 🔗 Liens

- 💬 [`communication-rules.md`](communication-rules.md) — enveloppe du message, `jht-tmux-send`, qui doit envoyer quoi
- 🛡️ [`anti-collision.md`](anti-collision.md) — coordination peer entre les membres du pool
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — composition complete de l'equipe et cartographie des niveaux
