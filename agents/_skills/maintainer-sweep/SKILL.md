---
name: maintainer-sweep
description: "Lo sweep di manutenzione INFRA del Mantenitore 🦺 (gemello del Dottore, scope infrastruttura non agenti). Una passata giornaliera one-shot: smoke-test dei tool mission-critical (browser/LinkedIn) via tool_health.py, audit/consolidamento deps fuori standard, GC di script e tmp orfani, de-dup di script ricorrenti, freschezza deps, trend disco/RAM. Single-writer: il Mantenitore è l'UNICO che ripara l'infra; le azioni DISTRUTTIVE (delete/archive) le PROPONE, il Capitano decide. Esito in append su mantenitore-logbook.jsonl."
allowed-tools: Bash(python3 /app/shared/skills/tool_health.py *), Bash(df *), Bash(du *), Bash(free *), Bash(tmux ls *), Bash(jht-install *), Bash(ls *), Bash(stat *), Bash(jht-tmux-send *)
---

# maintainer-sweep — tenere sana l'INFRA, in silenzio e a-prova-di-regressione

Il Mantenitore è il gemello del Dottore: **Dottore = salute degli AGENTI** (sessioni, token, context-refresh); **Mantenitore = salute dell'INFRA** (tool, deps, disco, script). One-shot: boot → sweep → logbook → self-terminate. Budget ~10 min. Confine netto, zero overlap col Dottore.

> **Perché esiste:** il bug `libatk` (browser morto, LinkedIn non verificabile) è rimasto invisibile per ore perché *nessuno smoke-testava i tool e nessuno teneva l'infra*. Lo sweep rende STRUTTURALE quella vigilanza.

## Regola d'oro — single-writer + propose-not-delete
Il Mantenitore **ripara** l'infra (installa deps mancanti, consolida, sistema). Ma ogni azione **DISTRUTTIVA** (delete/archive di file, cleanup disco) la **PROPONE** al Capitano con il comando esatto; **il Capitano decide** (come nel redesign usage-monitoring). Mai cancellare di testa propria.

## Lo sweep (6 step, in ordine)

### 1. 🩺 Smoke-test tool mission-critical (il cuore)
```bash
python3 /app/shared/skills/tool_health.py --json
```
Ritorna `tools_health` con `{status: OK|BROKEN|UNKNOWN, evidence}` per ogni tool (browser/Playwright, linkedin_check, …) + `broken[]`.
- **BROKEN** → **RIPARA** subito: `jht-install <dep>` (es. le `.so` Chromium) poi ri-esegui il check. Se riparato → log `repaired`.
- **BROKEN non riparabile** → **ESCALA al Capitano** col fix ESATTO via `jht-tmux-send` (es. "browser giù: `sudo playwright install-deps`; finché non risolto LinkedIn = OPEN_UNVERIFIED"). Mai lasciarlo silenzioso.
- Questo è lo STESSO `tool_health.py` che alimenta il gate build-time (dev1) e il `tools_health` nel tick: una sola fonte di verità sullo stato dei tool.

### 2. 📦 Audit deps fuori standard → consolida
Deps installate fuori dai prefissi standard (`/opt/jht-deps`, `PLAYWRIGHT_BROWSERS_PATH`, npm prefix, venv) → reinstalla nello standard via `jht-install`, così non sono sparpagliate. Log quali consolidate.

### 3. 🧹 GC di script/tmp orfani
Script temporanei lasciati da agenti **killati** (sessione non più in `tmux ls`) e tmp scaduti (> N ore). Lista i candidati → **PROPONI** la cancellazione al Capitano (azione distruttiva), non cancellare diretto.

### 4. 🔁 De-dup script ricorrenti
Script quasi-identici ripetuti da più agenti → **proponi** una skill canonica unica (non riscrivere al volo). Log la proposta.

### 5. 📅 Freschezza deps
Librerie/strumenti deprecati o versioni rotte / tool cruciali irraggiungibili → segnala al Capitano (no auto-upgrade rischioso).

### 6. 💾 Disco / RAM + trend
`du` sui path grossi, `free` per la RAM. Per **`disk.used_pct` usa SEMPRE `df`** — comando canonico:
```bash
df -P /jht_home | awk 'NR==2 {gsub("%","",$5); print $5}'   # es. 30  (percentuale come la riporta df)
```
**MAI** ricavarlo da `statvfs`/`os.statvfs` (`f_bavail`/`f_blocks`): i reserved-block lo gonfiano ~3× → falsi allarmi (es. 88% riportato contro 30% reale). Confronta col **trend dell'ultimo logbook**: se cresce verso una soglia → discuti col Capitano cosa archiviare/cancellare (lui decide). Log i numeri + il delta.

## Logbook (append-only)
Ogni sweep scrive UNA entry densa in `/jht_home/logs/mantenitore-logbook.jsonl` (gemello del logbook Dottore), così il prossimo Mantenitore vede il trend:
```json
{"ts":"ISO-UTC","slot":"maintainer-daily","tools_health":{...},"repaired":[...],
 "escalated":[...],"deps_consolidated":[...],"gc_proposed":[...],"dedup_proposed":[...],
 "disk":{"used_pct":N,"delta_vs_last":N},"ram":{...},"duration_sec":N,"capitano_ack":"..."}
```
Append con `>>`, mai overwrite. Sintesi densa (come le note di viaggio del Dottore/Capitano): cosa ho trovato, cosa ho riparato, cosa ho proposto.

## Anti-pattern
- ❌ Cancellare/archiviare senza OK del Capitano (single-writer: proponi).
- ❌ Auto-upgrade di librerie a versioni nuove (rischio rottura) — segnala, non aggiornare di testa.
- ❌ Lasciare un tool BROKEN senza riparare NÉ escalare (è esattamente il bug libatk silenzioso).
- ❌ Sconfinare nella salute degli AGENTI (sessioni/token/context) — quello è il Dottore.

## See also
- `shared/skills/tool_health.py` — lo smoke-test riusato allo step 1 (anche gate build-time + tick).
- `agents/mantenitore/mantenitore.md` — la persona/lifecycle del Mantenitore (dev3).
- `agents/_skills/resilience/SKILL.md` — la ladder anti-silenzio degli agenti (dev3); il suo step "classify" riusa `tool_health.py`.
- `agents/_skills/liveness-check/SKILL.md` — il gemello lato Dottore (salute agenti), per struttura.
