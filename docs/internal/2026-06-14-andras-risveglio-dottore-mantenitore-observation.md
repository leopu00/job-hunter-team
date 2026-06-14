# Osservazione — Risveglio Andras 2026-06-14 (Dottore + Mantenitore in azione)

**Tipo:** osservazione read-only (regola ferrea: si annota, non si corregge a caldo).
**Contesto:** primo risveglio mattutino di Andras (VPS Codex `jht-vps`) DOPO il redeploy del fix-batch
(immagine `b5778d6f` / master `c70cafadb`) e DOPO la pausa notturna. Working hours appena cambiate a
**08:00–20:00** (da 12:00–00:00). Scopo: verificare come si comportano al boot i due ruoli infra
(Dottore = salute AGENTI, Mantenitore = salute INFRA) e i fix-batch in azione coi worker freschi.

## ☀️ Sequenza boot (orari CEST)

| Ora | Evento |
|---|---|
| 08:02 | **MANTENITORE** parte per primo (sweep infra) |
| 08:08 | ANALISTA-6 (worker fresco) |
| 08:33 | **DOTTORE** round `start+30`: analytics + interview + context-refresh |
| 08:35 | SENTINELLA ricreata dal Dottore |
| 08:41 | CAPITANO ricreato dal Dottore |
| 08:43 / 09:15 | SCORER-4 / SCOUT-2 spawnati dal Capitano |
| (ieri 23:32) | **ASSISTENTE / MENTOR** — NON riavviati, ancora dalla sessione del redeploy |

Sessioni: 7–8, **1 per ruolo, 0 duplicati** (busy-aware regge, nessun overspawn).

## 🩺 DOTTORE — archivista + context-refresh SELETTIVO

L'agenda esiste e funziona: `/jht_home/logs/doctor-retrospective.jsonl` (31 record; round odierno
`20260614T063337Z`, timing `start+30`). Il Dottore ha fatto analytics+capture su **tutte** le sessioni,
ma ha agito in modo **selettivo** (NON "riavvia tutte"):

| Sessione | Azione | Interview (domande) |
|---|---|---|
| CAPITANO, SENTINELLA | `recreated` (context-refresh) | ✅ sì |
| ANALISTA-6, MANTENITORE | `skipped_fresh` (<40min, niente da rinfrescare) | no |
| ASSISTENTE, MENTOR | `skipped_parked` (singleton idle, 0 produzione, no msg Capitano) | no |

Criterio osservato: **recreate solo i long-running con context accumulato** (i coordinatori Capitano +
Sentinella); **salta i fresh**; **parcheggia i singleton idle**. L'interview (domande) è fatta SOLO sui
`recreated`.

### Intoppi raccolti dall'agenda (il valore dell'archivista)

- **SENTINELLA** — *intoppi:* path relativo `../_team/team-rules.md` mancante al boot → corretto a
  `/app/agents/_team/team-rules.md`. Nessun bridge failure/FATAL/freeze. *imparato:* tenere primary e
  weekly separati; Phase 1 nessun ordine operativo; SOTTO-PACE senza BURN-MODE = silenzio;
  `burst_transient=true` = non frenare un burst già recuperato (= S-07 interiorizzata).
- **CAPITANO** — *intoppi:* molti ACK verso ANALISTA-6 con **exit 4** perché il TUI era busy (agente
  vivo/produttivo, nessun respawn); pacing SFORO su analista-6 gestito con throttle 60s→120s, nessuno
  Scorer durante lo SFORO. *imparato:* C-13 funziona con 1 Analista e batch piccoli; check non
  verificabili → `OPEN_UNVERIFIED` con nota, non forzare (= P1 recheck-liveness interiorizzata);
  `db_query.py` non ha comando raw, usare sqlite3 per SQL ad-hoc.

## 🦺 MANTENITORE — l'agenda c'è e funziona

`/jht_home/logs/mantenitore-logbook.jsonl` (record odierno 08:06, `slot: maintainer-daily`,
`event: sweep_complete`). Lo sweep ha prodotto:
- **tool-health OK**: `playwright_browser` OK + `linkedin_check` OK (`batch vuoto ok` = canary P5/fix-batch).
- **Riparazione reale**: `apt:procps installato via jht-install per ripristinare free(1)` (snapshot RAM).
  È il Mantenitore che ripara l'infra da solo via `jht-install`, come da design.
- `deps_audit`, `escalated: []`, `deps_consolidated: []`.

Esiste anche `mantenitore-actions.jsonl` (log azioni, gemello di `dottore-actions.jsonl`).

## ✅ Fix-batch in azione (prima prova reale coi worker freschi)

- **P1 recheck-liveness**: 41 recheck stamattina via il nuovo flusso; il Capitano ha interiorizzato
  `OPEN_UNVERIFIED` (non forzare i check non verificabili).
- **P2 scout-resume**: scan su tutte le sessioni → **zero "Conversation interrupted"** (ieri #11 SCOUT-2
  era piantato).
- **P3 burst_transient**: la Sentinella lo cita nel suo "imparato"; NB il flag scatta raramente per la
  finestra 0.5h troppo larga → resta il backlog **P3 v2** (finestra ancorata al segmento flat).
- **busy-aware (fix overspawn)**: exit 4 sugli ACK al TUI busy SENZA respawn — confermato dal Capitano.
- **pacing**: SOTTO-PACE che sale liscio 0.39x→0.79x verso il sostenibile, **senza l'over-brake estremo**
  osservato ieri (#4/#11). `BURN-MODE` flag reale = 0 (caso-controllo Codex tenuto). weekly 37%/63%,
  reset 18/06 (intatto dopo la notte di pausa).

## ⚠️ Finding — esiti (verdetti dev1, verificati a terra)

1. **Dottore: refresh selettivo → CHIUSO, working as designed.** La skill `session-refresh` lo specifica:
   skip `<40min` (`skipped_fresh`), skip PARKED, user-facing per ultimi e con cura, mai gestito da
   Dottore/watchdog. Quanto osservato (Capitano+Sentinella refreshati con interview, Assistente/Mentor
   idle `skipped_parked`, nuovi `skipped_fresh`) **combacia con la spec** → NON è un gap, è il
   comportamento corretto. Il refresh è SELETTIVO (rinfresca solo i long-running che accumulano context),
   non "tutte le sessioni".
2. **Path relativo fragile → BACKLOG (è uno sweep, non solo Sentinella).** La riga
   `[..](../_team/team-rules.md)` è in TUTTI i prompt agente (eredità team-rules), non solo nella
   Sentinella. Fix: `relative → assoluto` `/app/agents/_team/team-rules.md` in tutti i `.md`. Minore, non
   a caldo.
3. **exit-4 sugli ACK al TUI busy → BACKLOG (tuning).** Il busy-aware funziona (no respawn); resta da
   valutare un retry/backoff sulla consegna verso un worker busy.

### Backlog tuning consolidato (da dev1, schedulazione all'utente — niente a runtime, regola ferrea)

| Prio | Voce |
|---|---|
| **ALTA** | weekly-bind preventiva `min(5h, weekly)` + difensiva LOCKED-status / hard-sleep |
| — | P3-v2: `burst_transient` ancorato al flat-segment (finestra 0.5h troppo larga) |
| — | coordinator-burn no-op (top-burn = Capitano → throttle inerte) |
| — | sweep path-assoluto `team-rules.md` in tutti i prompt (finding #2) |
| — | exit-4 retry/backoff consegna ACK (finding #3) |

## Fonti (sulla VPS, read-only)

- `/jht_home/logs/doctor-retrospective.jsonl` — agenda/retrospettiva Dottore (interview, intoppi, imparato, summary_denso, action).
- `/jht_home/logs/dottore-actions.jsonl` + `dottore-captures/` — azioni e capture-pane.
- `/jht_home/logs/mantenitore-logbook.jsonl` + `mantenitore-actions.jsonl` — agenda/sweep Mantenitore.
- `tmux ls` timestamp creazione sessioni; `messages.jsonl` per i `[BRIDGE TICK]`.
