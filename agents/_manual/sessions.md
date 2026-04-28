# 🪟 Tmux Sessions

The JHT team runs as a set of tmux sessions inside the container. Session names are **uppercase, no emoji, no spaces**.

## 📛 Naming convention

| Pattern | Meaning | Examples |
|---|---|---|
| `<ROLE>` | Singleton — one instance only | `CAPITANO` · `CRITICO` · `SENTINELLA` · `ASSISTENTE` |
| `<ROLE>-<N>` | Pool member — N is a positive integer | `SCOUT-1` · `ANALISTA-2` · `SCRITTORE-3` |
| `<ROLE>-S<N>` | Spawned dynamically by another agent | `CRITICO-S1` (spawned by `SCRITTORE-1`), `CRITICO-S2`, … |

## 📚 Known sessions

### Pool sessions (Captain decides instance count)

| Session prefix | Role | Notes |
|---|---|---|
| `SCOUT-<N>` | Discovery | Multiple instances, peer-coordinated via `scout_coord.py` |
| `ANALISTA-<N>` | Verification | Pulls from `next-for-analista` |
| `SCORER-<N>` | Scoring | Pulls from `next-for-scorer` |
| `SCRITTORE-<N>` | Writing | Pulls from `next-for-scrittore` (score DESC) |

### Singletons

| Session | Role | Notes |
|---|---|---|
| `CAPITANO` | Team commander | Single instance — coordinates orders, status, escalations |
| `CRITICO` | Standalone Critic | Legacy — in V5 the Critic is spawned dynamically by Writers (see below) |
| `SENTINELLA` | Usage watchdog | Edge-triggered, talks to `CAPITANO` only |
| `ASSISTENTE` | User-facing copilot | Translates user requests into orders |
| `MAESTRO` | Career-coach agent | Planned, currently a placeholder |

### Dynamic sessions

| Session | Spawned by | Lifetime |
|---|---|---|
| `CRITICO-S<N>` | `SCRITTORE-<N>` (one fresh Critic per review round) | One review request → one session, killed by the Writer immediately after |

The Writer creates `CRITICO-S<N>` matching its own number (`SCRITTORE-1` → `CRITICO-S1`), runs the review, then `tmux kill-session`. A fresh Critic instance is spawned for **each** of the 3 review rounds — never reused.

## 🔗 Related

- 💬 [`communication-rules.md`](communication-rules.md) — message envelope, `jht-tmux-send`, who must send what
- 🛡️ [`anti-collision.md`](anti-collision.md) — peer coordination across pool members
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — full team composition and tier mapping
