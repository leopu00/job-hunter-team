# 🔍 Kimi Code — i tre tier di quota e il buco `totalQuota` (scoperta 2026-06-13)

**Contesto:** deploy del team su VPS betaB (Kimi, `203.0.113.20`) con l'immagine
del redesign usage-monitoring. Indagando perché il driver WEEKLY-PACE non sembrava
attivo su Kimi, ho tracciato a terra la catena di raccolta usage e chiamato l'API
reale. Risultato: il parsing è corretto, ma **un terzo tier di quota non è
monitorato**.

## La risposta reale dell'API Kimi

Endpoint: `GET https://api.kimi.com/coding/v1/usages` (Bearer = access_token da
`~/.kimi/credentials/kimi-code.json`). Risposta reale catturata su betaB:

```json
{
  "user": { "membership": { "level": "LEVEL_INTERMEDIATE" } },
  "usage":      { "limit": "100", "used": "2", "remaining": "98",
                  "resetTime": "2026-06-14T17:11:53Z" },
  "limits": [ { "window": { "duration": 300, "timeUnit": "TIME_UNIT_MINUTE" },
               "detail": { "limit": "100", "used": "8", "remaining": "92",
                           "resetTime": "2026-06-13T05:11:53Z" } } ],
  "totalQuota": { "limit": "100", "remaining": "99" },
  "subType": "TYPE_PURCHASE"
}
```

## I tre tier (confermati dai doc ufficiali Kimi Code)

| Campo API | Significato | Reset | Monitorato dal bridge? |
|---|---|---|---|
| `limits[0]` (duration 300 min) | **Finestra 5h rolling** (~300-1200 req, 30 concorrenti) | rolling 5h | ✅ → `usage` (5h) |
| `usage` | **Weekly — 7 giorni veri** dalla data di sottoscrizione, no carryover | ogni 7 giorni | ✅ → `weekly_usage` |
| `totalQuota` | **Quota mensile totale condivisa con la membership Kimi** | mensile / upgrade | ❌ **NO** |

Fonte ufficiale (kimi.com/code/docs/en):
> "Kimi Code quota refreshes automatically **every 7 days** from the subscription
> date; unused quota does not carry over."
> "If the Kimi membership's **monthly total quota** reaches its limit, the Kimi
> Code quota will be **frozen** until the monthly quota resets or the subscription
> is upgraded."

## Due chiarimenti importanti

1. **Il weekly di Kimi È un weekly vero di 7 giorni.** Il `resetTime` di `usage`
   (es. `2026-06-14T17:11Z`) NON è la lunghezza della finestra: è solo il prossimo
   confine del ciclo di 7 giorni (al momento della scoperta eravamo a ~38h dal
   reset). Semanticamente equivalente al weekly di Anthropic. `fetch_kimi_api`
   (sentinel-bridge.py) lo legge da `data.usage.used` → `weekly_usage`, con reset
   propagato come data+ora (`weekly_reset=14/06 17:11` nel `[BRIDGE TICK]`, formato
   `%d/%m %H:%M`).

2. **Tutti i timestamp sono UTC.** Il container betaB gira con `TZ=Etc/UTC`
   (`JHT_USER_TZ=Etc/UTC` in host.env). `_iso_to_hhmm` fa `.astimezone()` ma in un
   container UTC resta UTC. Quindi `17:11` è **17:11 UTC = 19:11 Europe/Rome**
   (CEST, UTC+2). Gli agenti ragionano e riportano in UTC: se il team comunica il
   reset all'utente italiano, va o convertito in ora locale o etichettato come UTC.

## Il buco: `totalQuota` non monitorato

Il bridge legge `limits[0]` (5h) e `usage` (weekly) ma **ignora `totalQuota`**, che
è il **tetto mensile della membership**. È l'unico meter che, una volta esaurito,
**congela Kimi Code** a prescindere dal fatto che 5h e weekly siano verdi — e non
si resetta in giornata (mensile / upgrade). Il driver WEEKLY-PACE sorveglia la
finestra weekly che si ricarica ogni 7 giorni, NON il saldo mensile che cala verso
zero. In una settimana di uso intenso il pacchetto mensile può svuotarsi senza che
il team lo veda arrivare.

Al momento della scoperta: `totalQuota.remaining = 99/100` → nessun rischio
immediato, ma copertura assente.

### Contesto billing
Kimi ha annunciato il passaggio a **Token-Based Billing** ("we are permanently
switching to a Token-Based Billing system. All usage quotas have been reset"),
coerente col fatto che i tre meter arrivano ora tutti normalizzati come
`limit: 100` (percentuali 0-100).

## Estensione proposta (non ancora implementata)

Aggiungere in `fetch_kimi_api` la lettura di `totalQuota.remaining` → propagarlo nel
sample / `[BRIDGE TICK]` → allerta quando scende sotto soglia (es. <15%), così la
Sentinella può avvisare il Capitano del freeze mensile imminente. Solo-Kimi
(Anthropic/Codex non hanno questo tier); guard `None` se il campo è assente.

## Riferimenti
- API: `https://api.kimi.com/coding/v1/usages`
- Doc ufficiale: https://www.kimi.com/code/docs/en/
- Annuncio token-based billing: https://x.com/Kimi_Moonshot/status/2016918447951925300
- Codice: `.launcher/sentinel-bridge.py::fetch_kimi_api`, `KIMI_USAGES_URL`
- Correlato: `docs/internal/2026-05-03-rate-kimi-weights.md`
