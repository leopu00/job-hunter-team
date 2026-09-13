<!-- @translation: it, ai-translated 2026-09-13 -->
---
name: apply-authorization
description: I due cancelli fra il team e la casella di un recruiter, e come leggerne i rifiuti. Una candidatura parte SOLO se l'utente ha dato il consenso generale (`applications.auto_apply` nel config utente) E ha flaggato proprio quella posizione. Entrambi fail-closed e verificati nel codice da `apply_gate.py`. Usala al boot e prima di ogni posizione per leggere la coda del CLOSER, e ogni volta che devi spiegare perché una posizione non è partita. Del CLOSER; il Capitano legge la stessa coda per decidere se spawnarlo.
allowed-tools: Bash(python3 /app/shared/skills/apply_gate.py *)
---

# apply-authorization — cosa può partire, e perché il resto no

Una candidatura esce dal box solo quando valgono **due** condizioni. Assente,
rotto o non riconosciuto vale **no**, sempre.

| # | Condizione | Dove vive | Chi la imposta |
|---|---|---|---|
| 1 | consenso generale | `applications.auto_apply.enabled = true` in `$JHT_HOME/jht.config.json` | l'utente, all'attivazione |
| 2 | autorizzazione per-posizione | `positions.apply_requested = 1` con `apply_requested_at` e `apply_requested_by` = `user_web` / `user_local` | l'utente, su quella posizione |

Il flag dell'utente **è** l'autorizzazione a inviare. Non c'è una seconda domanda.

## La coda — un comando, letto da due ruoli

```bash
python3 /app/shared/skills/apply_gate.py queue --json
```

Exit `0` solo quando qualcosa può partire adesso; exit `1` altrimenti. Il JSON:

| Campo | Significato |
|---|---|
| `ready` | `true` = almeno una posizione si può prendere adesso |
| `reason` | token stabile, vedi sotto |
| `mode` | `authorised` (invia) o `dry_run` (diagnostica, compila e si ferma prima del bottone) |
| `max_per_day` / `sent_today` / `remaining_today` | il tetto giornaliero delle candidature inviate dal CLOSER |
| `positions` | cosa puoi prendere, in ordine di autorizzazione: `position_id`, `url`, `cv_pdf_path` |
| `held` | posizioni autorizzate che NON vanno prese adesso, ognuna col suo `reason` |

Il CLOSER prende la prima voce di `positions`. Il Capitano spawna il CLOSER
solo quando il comando esce con `0`.

## Perché la coda è chiusa (`reason`)

| Token | Significato | Cosa fare |
|---|---|---|
| `config_missing` / `config_unreadable` / `config_malformed` | il config utente non si legge | niente: nessun consenso si può stabilire |
| `consent_absent` / `consent_disabled` | l'utente non ha dato il consenso | niente. Mai suggerire di accenderlo (RULE-T18) |
| `consent_mode_unknown` / `consent_cap_invalid` | il blocco c'è ma un valore non è riconosciuto | niente: il cancello rifiuta invece di indovinare |
| `db_unavailable` / `queue_unreadable` | il database locale non si legge | `[BLOCKED]` al Capitano |
| `queue_empty` | nessuna posizione autorizzata si può prendere | esci |
| `daily_cap_reached` | il CLOSER ha già inviato `max_per_day` oggi | esci; la coda riapre domani |

## Perché una posizione è ferma (`held[].reason`)

| Token | Significato |
|---|---|
| `already_submitted` | la candidatura è già partita (stato `applied`/`response`, o la riga application dice applied). Il flag resta acceso dopo l'invio: non è una nuova richiesta |
| `position_not_authorised` | il flag è spento (l'utente l'ha revocato) |
| `authorisation_undated` | il flag non ha timestamp |
| `authorisation_not_from_user` | il flag non l'ha impostato un canale utente. Un flag acceso da un processo non è un'autorizzazione |
| `url_missing` / `cv_pdf_missing` | non c'è con cosa compilare il form |
| `checkpoint_blocked_human` | il flusso si è già fermato su questa posizione e ha chiesto all'utente. Torna solo quando l'utente la autorizza di nuovo |
| `checkpoint_dry_run` | già compilata in modalità diagnostica |
| `checkpoint_unreadable` | il checkpoint del flusso non si legge: incertezza, quindi no |

## Una posizione, un verdetto

```bash
python3 /app/shared/skills/apply_gate.py position <ID> --json
```

`allowed: true` solo con `reason: apply_allowed`. È lo stesso controllo che
`apply_flow.py` fa all'avvio e di nuovo subito prima del click. Non serve
lanciarlo prima del flusso; usalo per spiegare un rifiuto.

## Regole

- **Mai scrivere l'autorizzazione.** `apply_requested*` appartiene all'utente.
- **Mai aggirare un rifiuto.** Un cancello chiuso è la risposta, non un ostacolo.
- **Mai chiedere all'utente di autorizzare di più.** Il team è completo anche
  senza una sola candidatura (RULE-T18).
