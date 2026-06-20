<!-- @translation: it, ai-translated 2026-06-06 -->
# 🪟 Sessioni Tmux

Il team JHT gira come un insieme di sessioni tmux all'interno del container. I nomi delle sessioni sono **maiuscoli, senza emoji, senza spazi**.

## 📛 Convenzione di denominazione

| Pattern | Significato | Esempi |
|---|---|---|
| `<ROLE>` | Singleton — una sola istanza | `CAPITANO` · `CRITICO` · `SENTINELLA` · `ASSISTENTE` |
| `<ROLE>-<N>` | Membro del pool — N è un intero positivo | `SCOUT-1` · `ANALISTA-2` · `SCRITTORE-3` |
| `<ROLE>-S<N>` | Creato dinamicamente da un altro agente | `CRITICO-S1` (creato da `SCRITTORE-1`), `CRITICO-S2`, … |

## 📚 Sessioni note

### Sessioni pool (il Capitano decide il numero di istanze)

| Prefisso sessione | Ruolo | Note |
|---|---|---|
| `SCOUT-<N>` | Scoperta | Istanze multiple, coordinamento peer tramite `scout_coord.py` |
| `ANALISTA-<N>` | Verifica | Preleva da `next-for-analista` |
| `SCORER-<N>` | Valutazione | Preleva da `next-for-scorer` |
| `SCRITTORE-<N>` | Scrittura | Preleva da `next-for-scrittore` (score DESC) |

### Singleton

| Sessione | Ruolo | Note |
|---|---|---|
| `CAPITANO` | Comandante del team | Istanza singola — coordina ordini, stato, escalation |
| `CRITICO` | Critico standalone | Legacy — in V5 il Critico viene creato dinamicamente dagli Scrittori (vedi sotto) |
| `SENTINELLA` | Watchdog dei consumi | Edge-triggered, comunica solo con `CAPITANO` |
| `ASSISTENTE` | Copilota lato utente | Traduce le richieste dell'utente in ordini |
| `MENTOR` | Agente career-coach | Attivo — user-facing always-on, spawnato al boot (basi implementate, ottimizzazione in corso) |

### Sessioni dinamiche

| Sessione | Creata da | Durata |
|---|---|---|
| `CRITICO-S<N>` | `SCRITTORE-<N>` (un Critico nuovo per ogni ciclo di revisione) | Una richiesta di revisione → una sessione, terminata dallo Scrittore subito dopo |
| `DOTTORE` | watchdog (slot giornaliero) | One-shot — sweep salute-agenti, riporta al `CAPITANO`, poi si auto-distrugge |
| `MANTENITORE` | watchdog (slot giornaliero) | One-shot — sweep salute-infrastruttura, riporta al `CAPITANO`, poi si auto-distrugge |

Lo Scrittore crea `CRITICO-S<N>` con lo stesso numero (`SCRITTORE-1` → `CRITICO-S1`), esegue la revisione, poi `tmux kill-session`. Un'istanza nuova del Critico viene creata per **ciascuno** dei 3 cicli di revisione — mai riutilizzata.

## 🔗 Correlati

- 💬 [`communication-rules.md`](communication-rules.md) — busta del messaggio, `jht-tmux-send`, chi deve inviare cosa
- 🛡️ [`anti-collision.md`](anti-collision.md) — coordinamento peer tra i membri del pool
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — composizione completa del team e mappatura dei livelli
