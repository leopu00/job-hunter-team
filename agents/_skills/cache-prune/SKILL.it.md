<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: cache-prune
description: "Recupera spazio disco sulle cache condivise JHT (cache wheel `uv` + log SQLite `codex`) ogni ~24h. Responsabilità del Dottore — istanza singola, eseguita alla fine di un giro routinario quando il team è inattivo. Mai eseguire durante un'emergenza: il VACUUM SQLite blocca per ~30s su un DB da 200 MB e ruberebbe cicli a un recovery guidato dalla Sentinella. Migrata dal Capitano così il Capitano resta concentrato sul coordinamento, non sulla manutenzione."
allowed-tools: Bash(node /app/cli/bin/jht.js cache *), Bash(du *), Bash(df *)
---

# cache-prune — recupera le cache condivise

La directory condivisa `$JHT_HOME` accumula due cache che crescono monotonicamente finché non vengono recuperate:

| Path                                  | Cosa contiene                           | Crescita tipica (campione 2026-05-02) |
|---------------------------------------|-----------------------------------------|------------------------------------|
| `$JHT_HOME/.cache/uv/`                | cache wheel per ogni `uv pip install`   | ~364 MB                            |
| `$JHT_HOME/.codex/logs_2.sqlite`      | telemetria SQLite Codex (71% righe TRACE)| ~223 MB                           |

Nessuna delle due è necessaria su disco: uv ri-scarica se deve, Codex tronca le righe TRACE in sicurezza. I numeri sopra provengono da un run continuo; su un `$JHT_HOME` fresco partono da 0 e raggiungono centinaia di MB in pochi giorni.

## L'unico comando sicuro

```bash
node /app/cli/bin/jht.js cache prune
```

Idempotente e no-op quando non c'è nulla da recuperare. Internamente:
1. `uv cache prune` — elimina wheel obsolete (mantiene il set attivo referenziato dalle installazioni correnti).
2. `VACUUM` SQLite su `logs_2.sqlite` dopo aver cancellato le vecchie righe TRACE.
3. Pulizia dei file temporanei effimeri di Codex.

Ogni step ha un gate di sicurezza: `idle > 1h` sulle operazioni distruttive (lock VACUUM, delete TRACE) — se il team sta attivamente bruciando token lo step viene saltato.

## Quando eseguirla

- 👨‍⚕️ **Fine di un giro routinario del Dottore** (~24h di run continuo, o all'inizio di una giornata operativa inattiva).
- 📉 **A richiesta** se `du -sh $JHT_HOME/.cache $JHT_HOME/.codex` mostra crescita > 800 MB totali.
- 🚫 **MAI** a metà di un momento critico per il budget (proj > 95%) — il VACUUM da 30s blocca il SQLite Codex che la Sentinella legge attraverso il bridge.
- 🚫 **MAI** in reazione a un `[ORDINE]` della Sentinella — gli ordini richiedono azioni di pacing/scaling, non manutenzione.

## Sicurezza: cosa NON toccare

Il team ha *altre* cache che sembrano simili ma NON sono nello scope qui:

| Path                                 | Perché hands-off                                                  |
|--------------------------------------|-------------------------------------------------------------------|
| `.cache/ms-playwright/`              | binari browser bloccati per versione — ri-scaricarli è lento + instabile |
| `.cache/claude-cli-nodejs/`          | cache runtime CLI Anthropic, ricreata lazily ma più grande quando calda |
| `$JHT_HOME/logs/`                    | Lo stato della Sentinella vive qui. Cancellarli perde la finestra EMA e diversi minuti di cronologia di monitoraggio. |

Il raggio d'azione di `cache prune` è limitato ai due path nella tabella in alto.

> ⚠️ **`cache clear` è vietato.** Quel comando (cugino distruttivo di `cache prune` esposto da `jht`) cancella `logs/` insieme alle cache, distruggendo lo stato della Sentinella. Se senti mai il bisogno di `cache clear`, escala all'utente.

## Crescita anomala — escala

Se `du -sh` mostra un path *fuori* dai 2 target sopra che cresce velocemente (es. `.cache/ms-playwright/` raddoppiato, `.codex/sessions/` che si gonfia), **NON** farne il pruning da solo. Cattura:

```bash
du -sh $JHT_HOME/.cache/* $JHT_HOME/.codex/*
df -h $JHT_HOME
```

…loggalo in `dottore-actions.jsonl` con `event=disk_anomaly` + l'output di `du`, e segnalalo all'utente tramite il Capitano (`jht-tmux-send CAPITANO`). Un nuovo path che cresce potrebbe significare che è stato aggiunto un nuovo tool senza budget per la pulizia.

## Output nel log

Appendi a `/jht_home/logs/dottore-actions.jsonl`:

```json
{"ts": "ISO-UTC", "round_id": "...", "event": "cache_prune",
 "uv_freed_mb": 142, "codex_freed_mb": 87, "total_freed_mb": 229,
 "duration_sec": 31}
```

Se uno step è stato saltato dal gate di inattività, imposta il corrispondente `_freed_mb` a `null` e aggiungi `"skipped": ["vacuum"]`.

## Anti-pattern

- ❌ Eseguire `cache prune` dal Capitano — quella responsabilità è stata migrata qui. Il Capitano coordina, il Dottore mantiene.
- ❌ Eseguirla mentre uno Scrittore è a metà CV (il suo loop tocca occasionalmente la cache uv per librerie pandoc/typst).
- ❌ Aggiungere un loop cron-like nel prompt del Dottore — il Dottore è one-shot con cadenza ~30 min, inserisci cache-prune a fine giro quando ha senso, non con un calendario fisso.
- ❌ Bypassare il wrapper `jht.js cache prune` per eseguire `uv cache prune` / `sqlite vacuum` direttamente — salti il gate di inattività e il logging unificato.

## Vedi anche

- `agents/dottore/dottore.md` — quando nel ciclo di vita del Dottore inserire questa skill (solo fine giro).
- `py-tools-audit` — skill di manutenzione sorella (pacchetti Python, cadenza ~settimanale).
- `agents/_team/team-rules.md` T13 — regola uv-come-unico-installer (perché la cache uv esiste).
