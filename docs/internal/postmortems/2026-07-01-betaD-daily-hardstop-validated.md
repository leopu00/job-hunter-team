# Daily hard-stop (#2) — validato end-to-end sul team di betaD (beta-3)

**Data:** 2026-07-01 · **VPS:** beta-3 `host.invalid` (203.0.113.40, betaD — luxury
hospitality, provider Kimi) · **Immagine:** `13057f2a` (deploy del 2026-07-01 ~15:32 UTC).

## TL;DR

Il **daily hard-stop** (remediation coordinator-burn #2: stop automatico quando il consumo
di *oggi* supera il cap giornaliero) è scattato per la **prima volta osservato dal vivo** e ha
funzionato su tutta la catena: rilevamento sforo → preavviso ai coordinatori → **ESC fisico a
tutte le sessioni** (nessun kill) → flag persistito → **budget congelato** → coordinatori
silenziati → ripresa automatica prevista. Su `betaB` non era mai scattato (budget mai abbastanza
caldo), quindi finora era codice non provato in produzione. Ora lo è.

## Contesto

Il team di betaD aveva bruciato il grosso del budget la mattina (31 CV+CL prodotti entro le
~10:21 UTC). Weekly Kimi all'**89%** con reset venerdì 2026-07-04 16:03 UTC → il budget
giornaliero adattivo (residuo settimanale ÷ giorni-lavoro rimasti) era strettissimo. Working
hours beta-3: **09:00–19:00 Europe/Rome**.

Alle **15:32 UTC** il container è stato riavviato (deploy immagine nuova). Il team è ripartito
fresco e **14 secondi dopo** il sentinel-bridge ha ri-valutato il consumo di oggi e fermato tutto.

## Catena di prove

### 1. Scatto al momento e alla soglia giuste
`daily-halt.flag` (creato una sola volta, mtime 15:34:48, mai riscritto):

```json
{"halted_at": "2026-07-01T15:34:48Z", "consumed_pct": 15, "cap_pct": 8.6,
 "budget_pct": 3.6, "sessions": ["ASSISTENTE","CAPITANO","MENTOR","SENTINELLA"]}
```

- **cap = budget + 5pp di tolleranza** (`_hcap = _hb + 5.0`): budget-giorno 3.6% → cap 8.6%.
- Consumato oggi **15% > 8.6%** → sforo → halt.
- **Timing:** scattato alle 15:34:14, ~14s dopo il reboot. Un riavvio a metà giornata **non
  azzera il budget del giorno**: il bridge ricalcola `consumato_oggi` (già 15% dai CV) e ferma
  il team fresco prima che ricominci a lavorare. Comportamento chiave, corretto.

### 2. Stop fisico eseguito (ESC, no kill)
Log `sentinel-bridge` (`/tmp/sentinel-bridge.log`):

```
15:34:14 DAILY-CAP HIT oggi=15.0% cap=8.6% → ESC a tutto il team tra 30s
15:34:14 DAILY-HALT attivo: ESC a 4 sessioni; bridge in silenzio fino al giorno dopo
```

Sequenza (sentinel-bridge.py ~1852-1874): `[BRIDGE ALERT]` di preavviso ai coordinatori →
`sleep 30s` → `_esc_all_sessions()` (ESC a ogni tmux, **NO kill**) → scrittura flag. Sentinella
ferma dalle 15:34:32 ("silenzio operativo, attesa del primo tick"); roster = **solo core, 0 worker**.

### 3. Budget davvero congelato
Traiettoria `weekly_usage` di oggi (da `sentinel-data.jsonl`):

```
mattina (CV):  75% → 89%   (+14pp, burst dei 31 CV; 5h fino a 39%)
15:03          89%  · 5h azzerato (reset finestra 5h)
15:34          ⛔ HALT
15:03 → 17:00  weekly FERMO a 89%,  5h FERMO a 0%   (nessun movimento in ~2h)
```

Da quando è scattato il team **non brucia un token**: weekly inchiodato all'89%, 5h a 0%. Freeze
reale, non solo un avviso.

### 4. Coordinatori zitti (niente coordinator-burn)
- `heartbeat-bridge`: `16:00 daily-halt: heartbeat soppresso (team in standby)`
- `pacing-bridge`: `pacing-bridge-state.last_message = "daily-halt (cap giornaliero sforato)"`,
  nessun tick alla Sentinella
- `sentinel-bridge`: "bridge in silenzio fino al giorno dopo"

Entrambi i bridge leggono `daily-halt.flag` (sola lettura) e tacciono, come da design.

### 5. Ripresa automatica e corretta
sentinel-bridge.py ~1836-1851: se già in standby, esce **solo** quando `not _over_cap`
(consumato-oggi rientra sotto il cap) → `DAILY_HALT_FLAG.unlink()` + messaggio
`[BRIDGE INFO] ▶️ Budget giornaliero rientrato`. Accade da sé:

- **domani alle 09:00 Roma** (inizio finestra → baseline del consumo azzerata), oppure
- al **reset settimanale** (ven 2026-07-04 16:03 UTC).

> Nota timing: alle 19:00 Roma la finestra di beta-3 si chiude comunque → da lì subentra
> l'off-hours; il daily-halt ha coperto la fascia 15:34→19:00. Domani riparte alle 09:00, ma
> col weekly ancora all'89% il cap sarà di nuovo ~9% → farà un po' di lavoro e probabilmente
> **si ri-fermerà** fino al reset di venerdì. È la protezione del settimanale che lavora.

## Riferimenti codice (`.launcher/sentinel-bridge.py`)

- `_daily_halt_active()` (≈483) — halt attivo = flag esiste.
- `_esc_all_sessions()` (≈489) — ESC a ogni sessione tmux, no kill.
- Enforcement daily hard-stop (≈1825-1874) — calcolo cap (`_hb + 5.0`), primo sforo (ESC +
  scrittura flag), condizione di uscita (`not _over_cap` → unlink).
- `not daily_halted` (≈1940-1943) — a team in standby non si notifica la Sentinella.
- Off-hours reassert `OFFHOURS_REASSERT_SEC=1800` — ri-asserisce OFF se il team brucia ancora.

## Verdetto

Implementazione **andata a buon fine, validata su tutta la catena**. L'unico effetto "duro" è
che betaD resta ferma fino a domani avendo fatto solo i CV del mattino — ma è il design: con
l'89% di settimanale e 3 giorni al reset, il sistema la mette a riposo per non finire in lockout.

Vedi anche: `2026-06-28-betaD-vps-budget-burn-investigation.md` (indagine a monte),
`architecture/kimi-vs-codex-economics.md` (economia provider, living doc).
