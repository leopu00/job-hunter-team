# 2026-05-17 — Health audit VPS + container (snapshot 14:09 UTC)

Audit operativo richiesto durante la sessione test e2e Path 2. Verifica:
ordine agenti, aderenza istruzioni, gestione dipendenze, salute VPS,
riempimento disk, posizionamento file. Snapshot puntuale 14:09 UTC del
17 maggio 2026 (finestra Kimi 5 in corso, post-RESET 13:11).

## 🏥 Salute infrastruttura

| Livello | Indicatore | Valore | Stato |
|---|---|---|---|
| 🖥️ **VPS Host** | uptime | 21h 36m | 🟢 |
| | load avg (1/5/15 min) | 2.05 / 2.14 / 1.68 | 🟡 ~50% (4 core) |
| | RAM | 2.1G/3.7G (56%) | 🟢 |
| | swap | 305M/2.0G (15%) | 🟢 leggero |
| | disk `/` | **10G/75G (14%)** | 🟢 spazio abbondante |
| 🐳 **Container `jht`** | CPU | 128% (≈ 1.3 core) | 🟢 normale per 10 agenti |
| | RAM | 1.8G/3.7G (48%) | 🟢 |
| | disk visibile | 10G/75G (14%) | 🟢 |

## 🧑‍🤝‍🧑 Agenti attivi (tmux sessions)

| Agente | Pane creato | CPU | RAM | Stato |
|---|---|---|---|---|
| 🕵️ SCOUT-1 | 10:28 | 4.2% | 185M | 🟢 ACTIVE |
| 🕵️ SCOUT-2 | 04:30 | 8.5% | 181M | 🟢 ACTIVE |
| 🔬 ANALISTA-1 | 03:30 | 8.1% | 180M | 🟢 ACTIVE |
| 🎯 SCORER-1 | 03:44 | 1.6% | 170M | 🟡 standby |
| ✍️ SCRITTORE-1 | 02:47 | **15.2%** | 184M | 🟢 lavora! |
| ⚖️ CRITICO-S1 | 14:03 | 5.0% | 150M | 🟢 just spawn |
| 💂 SENTINELLA | 16/05 | 0.9% | 153M | 🟢 monitor |
| 👨‍✈️ CAPITANO | 16/05 | 0.9% | 172M | 🟢 coordina |
| 💬 ASSISTENTE | 16/05 | 3.8% | 192M | 🟢 |
| 🧙‍♂️ MENTOR | 16/05 | 2.2% | 161M | 🟢 |
| 🩺 **DOTTORE** | — | — | — | **❌ MAI SPAWNATO** ([bug #18](../../internal/2026-05-17-team-strategy-bugs.md#-18-dottore-mai-spawnato--watchdog-non-lo-include-bridge-mancante)) |

→ **10/11 agenti attivi**. Tutti i ruoli operativi presenti. Solo Dottore assente.

## 🌉 Bridge attivi

| Bridge | PID | Cadenza | Stato |
|---|---|---|---|
| 📡 sentinel-bridge | 23401 | 3 min | 🟢 ATTENZIONE proj=161% usage=31% |
| ⏱️ pacing-bridge | 23417 | 15 min | 🟢 |
| 📲 tg-bridge × 3 | (3 PID) | long-poll | 🟢 assistente, capitano, mentor |

## 📁 File structure — quanto sono ordinati

| Posto | Size | Stato | Note |
|---|---|---|---|
| `/jht_user/` | **1.4M** | 🟢 ordinato | 4 subdir corrette: `cv/`, `critiche/`, `allegati/`, `output/` |
| `/jht_user/critiche/` | (md) | 🟢 | 30+ review-* in formato corretto |
| `/jht_user/cv/` | (pdf) | 🟢 | 27 PDF/docx/tex deliverable |
| `/jht_home/agents/` | (12 worktrees) | 🟢 | una per agente attivo + critico/scorer-2 |
| `/jht_home/.cache/uv` | **270M** | 🟡 cresce | cache pip/uv normale, ma tendenza ↑ |
| `/jht_home/.kimi/sessions` | 71M | 🟢 | 13 dir sessions kimi |
| `/tmp/` | **24M, 221 file** | 🟡 affollato | PNG grafici (20+) + HTML scraping + tar maps |
| `/jht_home/logs/` | (vario) | 🟢 | sentinel-data.jsonl, pacing, watchdog |
| File mal-piazzati in `/jht_home/agents/` | 0 | 🟢 ✅ | nessun PNG/PDF errante negli worktrees |

→ **Ordine generale**: 🟢 BUONO. Critiche-CV ben separati. Worktrees
puliti. Solo `/tmp` accumula PNG (problema collegato a
[bug #16](../../internal/2026-05-17-team-strategy-bugs.md#-16-auto-report-periodici--auto-grafici-via-bridge-orders-feature-mancante)
— i grafici dovrebbero migrare in `/jht_user/output/charts/`).

## 📦 Dipendenze Python

| Cache | Size | Stato |
|---|---|---|
| `/jht_home/.cache/uv` | 270M | 🟢 gestita da `uv pip install --user` (regola T13) |
| `/jht_home/.cache/fontconfig` | piccola | 🟢 |

→ **Pattern corretto**: gli agenti usano `uv pip install --user`,
niente pollution sistema. Eccezione: niente `pyproject.toml` né
`requirements.txt` in `/jht_home/` (deps ad-hoc per agente — è ok per
ruoli con dipendenze diverse).

## 📊 Skill compliance (ultime 100 messaggi inter-agente)

```
ACK         29  ████████████████████████████████   buon ratio risposta
PACING      23  █████████████████████████          tick regolari ✅
INFO        23  █████████████████████████
REQ         21  ███████████████████████
TG          20  ██████████████████████             interazione utente
RES         19  █████████████████████
REPORT      19  █████████████████████
TICK        15  ████████████████
MSG         14  ███████████████
URG          7  ████████                           ⚠️ 7% stress moments
EMERGENZA    2  ███                                ⚠️ 2 freeze ordinati
```

→ Mix di tipi rispetta envelope `[@from -> @to] [TIPO]`. 🟢
compliance buona, ma 9 episodi URG+EMERGENZA = sintomo Sentinella
aggressiva ([bug #2](../../internal/2026-05-17-team-strategy-bugs.md#-2-sentinella-ipersensibile-freeze-totale--kill-invece-di-throttle-progressivo)).

## ⚠️ Anomalie rilevate

| # | Cosa | Severità | Bug doc |
|---|---|---|---|
| 1 | DOTTORE mai spawnato | 🟠 | [#18](../../internal/2026-05-17-team-strategy-bugs.md#-18-dottore-mai-spawnato--watchdog-non-lo-include-bridge-mancante) |
| 2 | `/tmp/` 24M con 221 PNG/HTML | 🟡 | da migrare a `/jht_user/output/` |
| 3 | Proj 161% (ATTENZIONE) ma usage 31% | 🟡 | finestra giovane (10 min), bias cold-start [#5](../../internal/2026-05-17-team-strategy-bugs.md#-5-bridge-latency-al-boot-non-ha-ancora-emesso-il-primo-campione) |
| 4 | 1 errore agent-watchdog | 🟡 | "0 avviati, 0 già attivi, 1 errori" — investigare |
| 5 | Cache uv 270M crescente | 🟡 | nessuna auto-prune (compito sarebbe del Dottore [#18](../../internal/2026-05-17-team-strategy-bugs.md#-18-dottore-mai-spawnato--watchdog-non-lo-include-bridge-mancante)) |

## 🎯 Verdict generale: 🟢 **8/10**

| Dimensione | Voto | Nota |
|---|---|---|
| 🏥 Salute infra | 9/10 | tanto spazio, RAM ok, load gestibile |
| 🧑‍🤝‍🧑 Agenti ordinati | 8/10 | 10/11 attivi, file in workdir corretti, Dottore assente |
| 📜 Aderenza istruzioni | 7/10 | envelope corretto ma 7 URG + 2 EMERGENZA |
| 📦 Dipendenze | 9/10 | `uv pip --user` ovunque, niente leak |
| 💾 Riempimento | 9/10 | 14% disk, ma cache 270M crescente |
| 📂 Posizionamento file | 8/10 | `/jht_user/{cv,critiche,allegati,output}` ✅, ma 24M PNG su `/tmp/` |

**TL;DR**: 🚀 Team funzionante e operativo, struttura ordinata, infra
serena. **3 micro-debiti tecnici**: spawn Dottore (#18), prune
cache+`/tmp` (servirebbe il Dottore), bias cold-start projection (#5).
Niente di urgente.

## 🔬 Comandi usati per l'audit

Per ripetere l'audit (esegui da workstation con SSH key VPS):

```bash
ssh -i "$SSH_KEY" root@<VPS_IP> '
  uptime; free -h; df -h /                                   # host
  docker stats jht --no-stream                              # container
  docker exec jht tmux list-sessions                        # agenti
  docker exec jht ps aux --sort=-%cpu | head -15            # CPU
  docker exec jht du -sh /jht_user /jht_home/.cache /tmp    # disk
  docker exec jht find /jht_user -type f \( -name "*.pdf" -o -name "*.md" \) | wc -l  # deliverables
  docker exec jht tail -200 /jht_home/logs/messages.jsonl | grep -oE "\"type\": \"[A-Z]*\"" | sort | uniq -c | sort -rn  # compliance
  docker exec jht cat /jht_home/logs/sentinel-bridge-state.json
'
```

Tempo totale: ~30 secondi (2 round paralleli).

## 🔗 Connessioni con altri documenti

- [`docs/internal/2026-05-17-team-strategy-bugs.md`](../../internal/2026-05-17-team-strategy-bugs.md)
  — 19 bug strategici documentati. Questo audit conferma empiricamente
  #18 (Dottore assente), #16 (PNG su /tmp non migrati), #5 (cold-start
  proj), #2 (Sentinella aggressiva con 9 URG+EMERGENZA).
- [`docs/sessions/2026-05-17-team-dashboard/`](../2026-05-17-team-dashboard/)
  — `pipeline_overview.png` è il template visivo di questa stessa
  ispezione, ma generato dal Capitano on-demand. Se il Capitano avesse
  la regola C-04 ([bug #16](../../internal/2026-05-17-team-strategy-bugs.md#-16-auto-report-periodici--auto-grafici-via-bridge-orders-feature-mancante))
  questo audit potrebbe essere automatico ogni 2h.
- [`docs/sessions/2026-05-17-budget-windows/`](../2026-05-17-budget-windows/),
  [`docs/sessions/2026-05-17-pipeline-snapshot/`](../2026-05-17-pipeline-snapshot/)
  — altre sessioni grafiche del 17 mag.
