# 🗓️ Reset sempre con DATA completa — mai un orario orfano

**Data:** 2026-06-30 · **Branch:** dev2 · **Stato:** committato, NON deployato
**Commit:** `09e833d92`, `6baf31f47`, `ce2574b0b`, `52b1b805b`

---

## 🔎 Il problema (come è emerso)

Controllando il team betaC ho riportato all'utente *"reset alle 03:00"*. Il dato
che avevo letto era, alla lettera, il campo del tick:

```json
"weekly_reset_at": "03:00"
```

Una stringa `HH:MM` **senza giorno e senza fuso**. Il reset vero era **martedì 7
luglio 05:00 Roma** (`weekly_reset_at_unix: 1783393215`, ~160 ore dopo), non "tra
poche ore". Mi sono fidato del campo già formattato invece dell'epoch che stava
lì di fianco.

Il punto critico dell'utente: **gli agenti sulla VPS leggono lo stesso campo** e
cadono nella stessa trappola. Infatti il pane Sentinella mostrava *"weekly reset
03:00"* senza data.

### La classe di bug

`HH:MM` nudo costringe **ogni** consumatore a **ricostruire la data indovinando**
"oggi o domani". Trovato identico in **tre linguaggi**:

| Dove | Codice incriminato |
|---|---|
| `rate_budget.py` | `local_reset_display`: `replace(hour=h)` su *oggi*, `+1 giorno se passato` |
| `auto_report.py` (Telegram) | `_fmt_hhmm_user`: stessa euristica oggi/domani |
| `token-meter.py` | `_parse_reset_hhmm`: idem (fallback) |
| Web `UsageChart` / `UsageTokensChart` | `reset_at.split(":")` + `setUTCDate(+1)` |

Tutti **inventano** il giorno. È esattamente lo slittamento che aveva già causato
l'oscillazione reale del reset 7giu↔11giu al rinnovo ciclo.

---

## 🎯 Il principio della soluzione

> La **fonte di verità** è l'epoch (`*_unix`), già presente accanto a OGNI campo.
> La stringa human (`reset_at` / `weekly_reset_at`) porta **sempre** la DATA di
> calendario completa, derivata dall'epoch. Nessun consumatore ricostruisce mai
> una data da un'ora.

Formato canonico: **`2026-07-07 05:00 CEST`** (data + ora + fuso utente).

### Il choke point unico

Tutti e tre i provider del bridge (Codex / Claude / Kimi) convergono in
`compute_metrics.build_sample`. Lì — **un solo punto** — `reset_at` e
`weekly_reset_at` vengono derivati dall'epoch con `fmt_reset()`. Idempotente:
i producer ora emettono già full-date, ma anche se arrivasse un HH:MM grezzo (es.
worker TUI) il choke point lo riscrive dalla `*_unix`.

```
producer (HTTP: epoch nativo / TUI: HH:MM)
   └─ _ensure_reset_unix  ← UNICO punto dove "indovinare" è inevitabile
        (la TUI Claude mostra solo "Resets 18:00", senza data)
   └─ compute_metrics.build_sample  ← CHOKE POINT: reset_at = fmt_reset(epoch)
        └─ tick JSONL / Supabase / messaggi Sentinella / UI  → tutto full-date
```

---

## 🛠️ Cosa è cambiato

**`shared/skills/format_time.py`**
- Nuovo `fmt_reset(unix|datetime, with_utc=False) → "YYYY-MM-DD HH:MM TZ"`.
  Accetta epoch/datetime/None; `None` se non interpretabile (il chiamante tiene
  il fallback).

**`shared/skills/compute_metrics.py`** — il choke point
- `build_sample` deriva `reset_at`/`weekly_reset_at` dall'epoch via `_fmt_reset`.
- Back-compat: senza epoch tiene il valore grezzo.

**`.launcher/sentinel-bridge.py`**
- Producer Codex/Claude/Kimi: full-date alla sorgente (no più `strftime("%H:%M")`)
  → la weekly-reset-cache non memorizza più un HH:MM orfano.
- Messaggi tick 5h/weekly verso la Sentinella via `_fmt_reset` (prima `%d/%m
  %H:%M`, senza anno né fuso).

**`shared/skills/rate_budget.py`**
- `hours_minutes_until` / `local_reset_display` ancorati all'epoch (niente più
  guess oggi/domani). `once()` propaga gli `*_unix` all'auto-record.

**`.launcher/pacing-bridge.py`**
- Rimosso il suffisso `UTC` ora errato (la stringa porta già il fuso) + header
  `ts` con data completa.

**`shared/skills/token-meter.py`**
- L'epoch (`last_reset_at_unix`) resta il path autoritativo; `_parse_reset_hhmm`
  marcato legacy-only (degrada a `None` su stringa data-completa, senza crash).

**`shared/skills/auto_report.py`** (report Telegram, user-facing)
- `_fmt_hhmm_user` (che indovinava il giorno) sostituito da `_fmt_reset_user`
  ancorato all'epoch del tick.

**Web** (`UsageChart.tsx`, `UsageTokensChart.tsx`, push/select route, mig 050)
- `resetEpochMs()`: epoch da `reset_at_unix`, mai da un HH:MM.
- `formatResetDisplay`: countdown dall'epoch + mostra la stringa data-completa.
- `sentinel_ticks` += `reset_at_unix`, `weekly_reset_at`, `weekly_reset_at_unix`
  (il path cloud prima aveva solo `reset_at TEXT`).

---

## 🧪 Verifica

Unit + integrazione su dati live (TZ Europe/Rome):

```
fmt_reset(1783393215)                → 2026-07-07 05:00 CEST
compute_metrics (parsed con epoch)   → reset_at = 2026-06-30 15:00 CEST
                                       weekly_reset_at = 2026-07-07 05:00 CEST
rate_budget.status_line              → ... reset_in=1h 48m (at 2026-06-30 15:00 CEST)
auto_report._fmt_reset_user          → 2026-06-30 15:00 CEST
token-meter (full-date → None, usa unix path)
```
`tsc --noEmit` web pulito. Tutti i `.py` toccati compilano.

---

## ⚠️ Confine lasciato intatto (di proposito)

`check_usage` / `_ensure_reset_unix` vedono **solo** l'`HH:MM` della modal `/usage`
della TUI Claude — lì la data **non esiste**. È l'unico punto dove ancorare un
epoch richiede una stima (prossima occorrenza dell'orario). La stima è isolata
in quel singolo confine; tutto ciò che esce è full-date.

---

## 📋 Residui prima del deploy

1. **Non deployato.** Le VPS girano ancora l'immagine vecchia → merge→master +
   rebuild immagine + redeploy (+ `git push` web→production e migration 050 sul
   cloud per il path Supabase).
2. **Backfill cloud:** i tick già su `sentinel_ticks` restano con `reset_at` nel
   vecchio formato finché non arrivano nuovi tick post-deploy (nullable, nessun
   crash).
