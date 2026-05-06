# 🧩 Prompt decomposition — CLAUDE.md vs Skill vs Manual

> 📅 **2026-05-06** — analisi originata dal refactor di [`agents/capitano/capitano.md`](../../agents/capitano/capitano.md) (564 righe, ~14k token).
> Documento di riferimento per le prossime sessioni di refactor degli altri 8 agent prompt.

## 🎯 TL;DR

- 🏠 **CLAUDE.md** = identità + regole sempre-on. Target Anthropic: **≤ 200 righe**, oltre attention decay → regole ignorate.
- 🛠️ **Skill** = operativo, auto-invocabile via `description` match. Costo `description` sempre in context (~200-500 char), body solo on-demand. Re-attaccato automaticamente dopo compaction.
- 📚 **Manuale** = info estese/storiche/reference. Zero costo startup. Caricato solo via `Read` esplicito → fragile (devi citarlo dal CLAUDE.md o l'agente non sa che esiste).
- 💰 **Risparmio token reale** dal refactoring: ~30-40% per sessione su CAPITANO. Ma il guadagno principale è **qualitativo** (regole obbedite, modularità, cache-friendly).

---

## 🔥 Il problema scatenante

`capitano.md` è cresciuto a **564 righe** = ~14k token. Ogni sessione di Capitano paga questo costo full nel context window. Anthropic documenta che oltre ~200 righe il modello inizia a **ignorare istruzioni** (attention decay): regole critiche sepolte a riga 500 hanno chance reale di non essere applicate.

I sintomi che potremmo già vedere:
- Capitano dimentica la cadenza throttle nonostante sia documentata
- Regole anti-pattern violate (es. `tmux send-keys` raw invece di `jht-tmux-send`)
- Decisioni di scaling che ignorano la tabella consumo per ruolo

---

## 🧠 I 3 layer: tassonomia

| Layer | Quando entra in context | Costo | Best fit |
|---|---|---|---|
| 🏠 **CLAUDE.md** | Sempre, full, allo start | Pieno (tutto il file) | Identità, missione, regole inviolabili, tabelle compatte iperfrequenti |
| 🛠️ **Skill** | `description` allo start; body su invocation | Description ~200-500 char + body on-demand | Workflow operativi, tabelle critiche auto-invocabili, procedure ricorrenti |
| 📚 **Manuale** | Mai automaticamente; solo via `Read` | 0 token finché non letto | Info estese, post-mortem, war stories, reference esaustivo, schemi |

### 📐 Modello mentale

```
┌────────────────────────────────────────────────┐
│  🏠 CLAUDE.md (~150-200 righe)                 │  ← sempre caricato, full
│  Identità + missione + regole + pointer        │
└──────────────┬─────────────────────────────────┘
               │
               ├──► 🛠️ Skill description (sempre on, ~300 char)
               │       ↓ auto-invoke su match
               │       └─► body skill (in context fino a compaction)
               │
               └──► 📚 Manual (`see _manual/X.md`)
                       ↓ Read esplicito
                       └─► file in context (effimero)
```

---

## 💰 Token math: quando si risparmia davvero?

**Setup:** sezione con body ~500 token.

| Caso | Costo CLAUDE.md (always-on) | Costo Skill (descr ~200 + body on-demand) |
|---|---|---|
| Skill invocata **100%** delle sessioni | 500 | 200 + 500 = **700** ⚠️ peggio! |
| Skill invocata **60%** | 500 | 200 + 0.6×500 = **500** (pareggio) |
| Skill invocata **30%** | 500 | 200 + 0.3×500 = **350** ✅ |
| Skill invocata **10%** (rara ma critica) | 500 | 200 + 0.1×500 = **250** ✅ |

→ **Break-even ≈ 60% delle sessioni.**

### Implicazioni pratiche

- 📊 Skill **iperfrequente** (es. Tabella throttle, ogni 5min) → leggera **perdita** vs CLAUDE.md (~200 token/sessione)
- 📊 Skill **sporadica** (es. procedura zombie) → **risparmio reale**
- 📊 Skill **rara** (es. py-tools-audit weekly) → **grande risparmio**

### Macro-bilancio CAPITANO (proiezione)

Sessione tipica 5h, ~80 ORDINI Sentinella:

| Architettura | Token startup | Token on-demand | Totale/sessione |
|---|---|---|---|
| **Oggi: monolitico 564 righe** | ~14.000 | 0 | **14.000** |
| **Slim 180 + 4 skill (1.5k each) + 3 manuali** | ~4.500 (core 3k + 4×descr 1.5k) | ~4-6k (skill invocate + manuali letti) | **8.500-10.500** |

→ **~30-40% risparmio token per sessione** + qualità interpretativa decisamente superiore.

---

## 🎁 I guadagni qualitativi (più importanti del risparmio)

Anche per skill iperfrequenti (dove "perdi" 200 token vs CLAUDE.md), il refactoring vince per:

| Dimensione | CLAUDE.md monolitico | CLAUDE.md slim + Skill |
|---|---|---|
| **🎯 Attention decay** | Regole sepolte a riga 500 ignorate | CLAUDE.md ~180 righe → ogni regola "rispettata" |
| **🔄 Compaction-safety** | Re-iniettato ma frammenti del context persi | Skill re-attaccate auto in budget 25k |
| **🧱 Modularità** | Diff su file 564 righe → conflitti merge | Diff isolato per skill → niente conflitti |
| **💾 Cache hit (prompt caching)** | Modifica CLAUDE.md → invalida tutta la cache | Modifica body skill → invalida solo quella |
| **♻️ Riuso tra agenti** | Copiare sezioni tra prompt | Skill globali (es. `agents/_skills/throttle/`) condivise out-of-the-box |
| **🧠 Onboarding cognitivo** | Leggere 564 righe per capire l'agente | Leggere 180 righe + indice skill |

---

## 📊 Decision matrix: dove va una sezione?

### Per criticità × frequenza

| Criticità | Frequenza | → Dove |
|---|---|---|
| 🔴 Alta | 🔁 Frequente (ogni sessione) | **CLAUDE.md** se compatta, altrimenti **Skill** |
| 🔴 Alta | ⏳ Rara (1 su 10 sessioni) | **Skill** (paghi description per safety, vale) |
| 🟡 Media | 🔁 Frequente | **Skill** (auto-invoke + persistenza compaction) |
| 🟡 Media | ⏳ Rara | **Manuale** |
| 🟢 Bassa | qualsiasi | **Manuale** (zero startup cost) |

### Per natura del contenuto

| Tipo contenuto | Esempi | → Dove |
|---|---|---|
| Identità, missione, ruolo | "Sei Capitano, coordini il team" | 🏠 CLAUDE.md |
| Regole inviolabili | "Mai killare sessioni che non hai creato" | 🏠 CLAUDE.md |
| Tabella reference compatta + iperfrequente | Throttle 0-4 (~30 righe) | 🏠 CLAUDE.md o 🛠️ Skill |
| Tabella reference grossa | Tipi ORDINE (lista 11 con esempi) | 🛠️ Skill |
| Formula / calcolo | BRIDGE PACING `durata_sec=(f/100)×60/c` | 🛠️ Skill |
| Procedura step-by-step ricorrente | Spawn agent + kick-off + verifica | 🛠️ Skill |
| Procedura step-by-step rara ma critica | Freeze recovery con `timeout: N+30` | 🛠️ Skill |
| Workflow lungo multi-tool | Py-tools-audit (audit → broadcast 1h → uninstall → re-audit) | 🛠️ Skill |
| Tabella sintomi diagnostici | Sintomi morte CLI ("agente zombie") | 🛠️ Skill (criticità alta on-demand) |
| Schema database | Schema `jobs.db`, FK, CHECK constraints | 📚 Manuale |
| Post-mortem / war story | "Bridge V5 self-loop incident 2026-04-22" | 📚 Manuale |
| Architettura long-form | Architettura V5 4-tier, design rationale | 📚 Manuale |
| Glossario / convenzioni | Acronimi, formati, naming session tmux | 📚 Manuale |

---

## ⚠️ Trappole

### 📚 Manuali

- 🪤 **Invisibilità per omissione** — se aggiungi un manuale ma dimentichi di citarlo dal CLAUDE.md, è invisibile. Per sempre.
- 🪤 **Pigrizia del modello** — anche citato, l'agente potrebbe non pensare di leggerlo se la situazione non è esplicitamente "guardami dentro".
- 🪤 **Compaction lo perde** — se il workflow è lungo e ricco di compaction, lo rileggi N volte.

### 🛠️ Skill

- 🪤 **Description scritta male** → mai invocata. Il modello la "vede" allo start ma non matcha mai sul context. La tua skill diventa zombie.
- 🪤 **Description troppo larga** → invocata sempre, anche fuori scope. Spreco context.
- 🪤 **Costo cumulativo** — 10 skill ben fatte = ~3-5k token di description SEMPRE in context. Stai zitto-zitto pagando un sub-CLAUDE.md.
- 🪤 **Body grosso ed eterno** — una volta invocata, una skill resta in sessione. Body da 5000 token che non ti serve più "occupa" il budget compaction-aware (25k totali) per altre skill che potrebbero servire dopo.

### 🏠 CLAUDE.md

- 🪤 **Crescita silenziosa** — ogni "aggiungo solo questa cosa importante" lo gonfia di 10-20 righe. Dopo 6 mesi sei a 564 righe.
- 🪤 **Attention decay** oltre ~200 righe — il modello inizia a "perdersi": regole verso il fondo file ignorate.
- 🪤 **Cache invalidation** — qualsiasi modifica invalida la cache prompt → costa più cara la prossima chiamata.

---

## 🪝 Test pratico per ogni sezione

Quando refattori, applica questi due test secchi a ogni sezione del prompt monolitico:

### Test 1 — "Se rimuovo questa sezione, in quale frazione delle sessioni l'agente sbaglierebbe?"

| Risposta | → Layer |
|---|---|
| **>70%** | 🏠 CLAUDE.md (è core identity, deve esserci sempre) |
| **20-70%** | 🛠️ Skill (vuoi auto-invoke, costo description giustificato) |
| **<20%** | 📚 Manuale (consultata raramente, costo zero) |

### Test 2 — "Quanti danni fa l'agente se sbaglia QUI?"

| Risposta | → Layer |
|---|---|
| **Danno serio** (team down, sforo budget, dati persi) | 🏠 CLAUDE.md o 🛠️ Skill — mai manuale (troppo fragile) |
| **Danno medio** (rifa il task, perde tempo) | 🛠️ Skill |
| **Danno trascurabile** (output meno bello) | 📚 Manuale |

### Test 3 — Test del singolo comando

> *"Posso esprimere questa sezione come UNA azione che il modello deve eseguire quando matcha un trigger?"*

- ✅ Sì → 🛠️ Skill (è una procedura)
- ❌ No, è solo conoscenza → 📚 Manuale (a meno che non sia critica + frequente → Skill knowledge)

---

## 📋 Mappa applicata a CAPITANO

Mappatura proposta delle 564 righe attuali:

### 🏠 CLAUDE.md slim (~180 righe)

- Identità & sessione (1-7)
- Eredità team-rules (9-14)
- Chat web → `jht-send` (16-29) — **critico, frequente**
- TMUX protocol summary (31-42) — **critico, frequente**
- Missione (44-54)
- Performance non negoziabili — G-spot 90-95% (56-71) — **identità del ruolo**
- Rate budget — quando usare autonomamente (73-97)
- ORDINI Sentinella overview — **senza tabelle dettagliate**, solo "PRIORITÀ ASSOLUTA"
- Regole inviolabili (221-226)
- Flusso 7 fasi overview (375-400)
- Comunicazione tmux formato (527-531)
- Profilo candidato compatto (535-546)
- Regole net-new (550-564)
- 📚 **Indice riferimenti** ← elenca skill+manuali esistenti con quando invocarli

### 🛠️ Skill da creare

| Path | Trigger description | Body content |
|---|---|---|
| `_skills/throttle-table/SKILL.md` | "Tabella throttle Sentinella, livelli 0-4, RALLENTARE, FREEZE, ORDINI" | Tabella livelli + tipi ORDINE (100-156) |
| `_skills/bridge-pacing/SKILL.md` | "Calibrazione throttle data-driven, BRIDGE PACING, formula durata, vel_team, share, cadenza" | Sezione 176-218 + esempi |
| `_skills/spawn-agent/SKILL.md` | "Spawn nuovo agente, start-agent.sh, kick-off, verifica capture-pane" | 280-314 |
| `_skills/liveness-check/SKILL.md` | "Liveness check, agente zombie, sintomi morte CLI, kill-session respawn" | 317-358 |
| `_skills/scaling-decisions/SKILL.md` | "Scaling graduale, tabelle trigger, consumo per ruolo, bottleneck adattivo" | 403-509 |
| `_skills/cache-prune/SKILL.md` | "Manutenzione cache 24h, jht cache prune, uv cache, codex sqlite" | 229-241 |
| `_skills/py-tools-audit/SKILL.md` | "Pulizia pacchetti Python weekly, broadcast consenso, uninstall" | 244-277 |
| `_skills/freeze-recovery/SKILL.md` | "Freeze recovery, URG FREEZE, timeout N+30 pitfall, throttle-check" | 132-141 ⚠️ critica |

### 📚 Manuali da creare/usare

| Path | Cosa contiene |
|---|---|
| `_manual/db-schema.md` | ✅ già esiste — schema V2 |
| `agents/_team/architettura.md` | ✅ già esiste — architettura V5 4-tier |
| `_manual/incidents.md` | 🆕 post-mortem + war stories (es. bridge V5 self-loop) |

---

## 🚦 Workflow di refactoring (per applicarlo agli altri agenti)

Per ogni agent prompt da refattorare:

1. **Conta le righe.** Sopra 250 → candidato. Sopra 400 → urgente.
2. **Identifica le sezioni** (header `##` come delimiter).
3. **Per ogni sezione** applica i 3 test:
   - Test 1: % sessioni dove serve
   - Test 2: criticità del danno
   - Test 3: è una procedura singola?
4. **Decidi destinazione** consultando le matrici sopra.
5. **Scrivi prima le skill** (con `description` testabile — chiediti: "il modello matcherebbe su un input tipo X?").
6. **Riscrivi CLAUDE.md slim** con sezione "📚 Riferimenti" che lista cosa esiste e quando invocarlo.
7. **Verifica** in un dry-run: "il modello, leggendo solo CLAUDE.md slim, capisce dove trovare quello che gli serve?".

---

## 🎓 Principio guida

> 🏠 **CLAUDE.md** = "voglio che il modello CI VIVA dentro"
> 🛠️ **Skill** = "voglio che il modello LO FACCIA spesso, anche senza pensarci"
> 📚 **Manuale** = "voglio che il modello CONOSCA un fatto, quando lo cerca"

Il manuale è il **museo**: lo apri quando c'è un mistero da capire.
La skill è la **cassetta degli attrezzi**: la apri quando devi fare qualcosa.
Il CLAUDE.md è la **costituzione**: la conosci a memoria.

---

## 📚 Fonti

- [Claude Code — Memory (CLAUDE.md best practices)](https://code.claude.com/docs/en/memory.md)
- [Claude Code — Skills](https://code.claude.com/docs/en/skills.md)
- [Claude Code — How Claude Code works (context management)](https://code.claude.com/docs/en/how-claude-code-works.md)
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Designing CLAUDE.md correctly: The 2026 architecture](https://www.obviousworks.ch/en/designing-claude-md-right-the-2026-architecture-that-finally-makes-claude-code-work/)
- [awattar/claude-code-best-practices](https://github.com/awattar/claude-code-best-practices)
- [MuhammadUsmanGM/claude-code-best-practices](https://github.com/MuhammadUsmanGM/claude-code-best-practices)

---

## 🔗 Linked tasks

- [JHT-AGENT-PROMPTS-V2] in [`BACKLOG.md`](../../BACKLOG.md) — deep validation 9 agent prompts. Questo doc è la guida architetturale per quel refactor.
- [JHT-CAPITANO-DECOMPOSE] (da aprire) — primo refactor di applicazione, capitano.md 564 → ~180 righe + 8 skill.
