<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: format-time
description: Converti i timestamp UTC nel fuso orario dell'utente prima di mostrarli in chat, grafici, Telegram, o qualsiasi output rivolto all'utente. Usa questo helper ogni volta che scriveresti un `strftime("%H:%M")` grezzo di un datetime UTC in qualcosa che l'utente legge.
allowed-tools: Bash(python3 *)
---

# format-time — UTC → fuso orario utente nell'output rivolto all'utente

Bug #15: il container gira in UTC, l'utente vive in CEST/CET. Senza
conversione ogni "reset at 03:11" in chat o grafici costringe l'utente a
fare `+2` a mente — e a volte l'utente dice *"qui sono le
3:21"* e il Capitano deve affannarsi per la conversione.

## Quando usarlo

Applicalo ogni volta che produci un timestamp che l'**utente** leggerà:

- Messaggi Telegram da qualsiasi agente (Capitano, Assistente, Mentor)
- Sottotitoli grafici Matplotlib, etichette asse x, legende
- Widget dashboard che mostrano l'ora
- Righe di log o riassunti restituiti all'utente

**Salta** quando:
- Scrivi file di log interni (`messages.jsonl`, `sentinel-data.jsonl`,
  `dottore-actions.jsonl`) — restano UTC ISO per il parsing cross-agente.
- Scrivi colonne DB — mantieni UTC ISO così la dashboard può formattare
  al rendering.
- Calcoli intervalli / delta — lavora in UTC, formatta solo ai bordi.

## Come usarlo

```python
from shared.skills.format_time import fmt_user, fmt_user_with_utc
from datetime import datetime, timezone

now = datetime.now(timezone.utc)
print(fmt_user(now))            # "03:21 CEST"
print(fmt_user_with_utc(now))   # "03:21 CEST (01:21 UTC)"
```

Oppure, da bash:

```bash
python3 /app/shared/skills/format_time.py --now
python3 /app/shared/skills/format_time.py --iso 2026-05-17T01:14:00Z --with-utc
```

## Quando mostrare sia ora utente che UTC

Nei **grafici operativi** che un ingegnere di turno (o tu, debuggando)
potrebbe leggere insieme ai log UTC del team, preferisci `fmt_user_with_utc`
così entrambi sono visibili:

> *"Ora 03:21 CEST (01:21 UTC) — usage 63% — proj 92.2%"*

Nella **chat Telegram** diretta con l'utente, `fmt_user` da solo è solitamente
sufficiente:

> *"📅 Reset finestra 5h alle 05:11 CEST (~1h 50m)."*

## Da dove viene il fuso orario utente

`candidate_profile.yml::timezone` (nome IANA, es. `Europe/Rome`).
Default `Europe/Rome` se mancante — copre ~95% dei beta tester. Per
override per sessione: variabile env `JHT_USER_TZ` (letta dall'helper).

## Anti-pattern

- ❌ `datetime.now().strftime("%H:%M")` in una stringa rivolta all'utente —
  produce l'ora del **container** (UTC) senza suffisso → confusione
  dell'utente.
- ❌ Matematica `+2` fatta a mano ovunque. Usa l'helper; il DST porta
  Europe/Rome a CET (+1) a fine ottobre e te ne dimenticherai.
- ❌ Hardcodare `"CEST"` come suffisso — sbagliato per metà dell'anno e
  sbagliato per utenti non italiani.

## Vedi anche

- `shared/skills/format_time.py` — implementazione.
- `candidate_profile.yml.example` — documentazione campo `timezone:`.
