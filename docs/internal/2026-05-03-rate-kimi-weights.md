# 2026-05-03 — Pesi rate-limit Kimi K2: analisi empirica e calibrazione

## TL;DR

Il rate budget Kimi K2 e' guidato da `input_tokens + output_tokens`,
NON dai cache_read (anche se la doc piattaforma suggerisce diverso).

Pesi adottati ovunque nel codice (UI + skill + tabella throttle):

```
W_INPUT       = 1.0
W_OUTPUT      = 1.0
CACHE_R_W     = 0.0   # ignora cache_read
CACHE_C_W     = 0.0   # cache_creation e' sempre 0 nei nostri dati
```

Conversione utile per i calcoli del Capitano:

> 1 % di rate budget Kimi ≈ **40k token (input+output)**, ±15 %.

Stabile per tutta la sessione.

## Origine: cosa diceva la doc piattaforma

Da `platform.kimi.ai/docs/introduction`:

> "rate limit is determined based on the number of tokens in your request
> plus the number of max_completion_tokens in your parameter, REGARDLESS
> OF THE ACTUAL number of tokens generated"

Letta letteralmente questa stringa significa: rate = input_tokens (incluso
cache) + max_completion_tokens. Per qualche tempo abbiamo seguito
questa lettura, dando ai 4 tipi di token pesi 1.0 uniformi.

## Verifica empirica (perche' la doc non basta)

Sessione team Kimi K2 del 2026-05-03, 6h, 710 chiamate API, 29 step bridge
(eventi `Δusage>=1`). Per ogni segmento tra step consecutivi abbiamo
calcolato `cumul_token / Δusage` con vari modelli. Misura di stabilita':
CoV (deviazione standard / media). Modello migliore = CoV piu' basso.

| modello | CoV (Δu>=1) | CoV (Δu>=10) | drift macro |
|---|---:|---:|---:|
| **input + output** | **52 %** | **15 %** | **0.96×** |
| input_other | 57 % | 15 % | 1.9× |
| output da solo | 46 % | 19 % | 0.84× |
| call count | 81 % | 30 % | 1.42× |
| ALL tokens (1.0 uniformi) | 124 % | 39 % | **1.73×** |
| cache_read incluso | 127 % | 46 % | diverge |

**Drift macro** = ratio cumulativa al primo quarto della sessione vs alla
fine. 1.0× = nessun drift. >1 = il modello sottostima all'inizio (la
ratio cresce nel tempo). <1 = sovrastima all'inizio.

`input + output` vince in tutte e tre le metriche:
- CoV piu' basso a tutti i livelli di aggregazione
- drift praticamente nullo (0.96×) → la conversione "1% = X token" e'
  stabile per tutta la sessione
- contro: include `output` reale (che e' minore di `max_completion_tokens`),
  quindi i numeri assoluti sono leggermente sotto la verita', ma la
  PROPORZIONE e quindi tutti i calcoli percentuali sono giusti

`all tokens` e' tra i peggiori (CoV 39%, drift 1.7×) perche' cache_read
si gonfia con la lunghezza del context — accumula, ma il rate Kimi non
lo conta in modo proporzionale. Da qui la conclusione operativa:
**ignora cache_read**.

## Perche' hardcoded e non calibrato live

Avevamo provato una calibrazione least-squares live (Δusage = somma pesata
dei 4 tipi). Risultato: R² intorno a 0.49 e pesi instabili (cR convergeva
a 0, ma con alti e bassi). La radice del problema e' la
**multicollinearita'**: cache_read cresce praticamente sempre insieme a
input+output, quindi il sistema non riesce a separarli con i nostri dati.

Pesi fissi sono piu' stabili e prevedibili. Trade-off: se Kimi cambia il
rate model (nuovo tier, nuovo modello), o se cambia molto la composizione
del team, i pesi vanno rivisti a mano.

## Watchdog: warning automatico se la ratio deriva

Per intercettare il caso "Kimi ha cambiato qualcosa" senza cambiare i
pesi automaticamente, controlliamo che la ratio macro cumulativa stia
nel range atteso.

**Range accettabile**: `25 ≤ ratio_kT/% ≤ 60`

Logica:
- 25 = limite inferiore. Sotto significa "stiamo consumando meno token
  per ogni % di rate" — bridge potrebbe essere off, o un agente sta
  facendo solo retry vuoti.
- 60 = limite superiore. Sopra significa "consumiamo piu' token per %",
  potrebbe essere indizio che cache_read sta tornando a contare (Kimi
  cambiato modello?), o che il bridge sta misurando qualcosa di diverso.

**Dove appare il warning**:
- UI: badge nel header del chart "ratio fuori range, ricontrolla pesi"
- skill `agent-speed-table.py`: campo `warnings: [...]` nell'output JSON

Quando vedi il warning **NON cambiare i pesi automaticamente**. Apri
questo doc, rifai l'analisi su una sessione fresca (lo script che produce
la tabella sopra e' nel commit `e7021165`), e aggiorna i pesi se
necessario.

## File toccati

Pesi devono restare allineati in entrambi i posti:
- `shared/skills/token-by-agent-series.py` (backend skill, fonte di
  verita' per agenti+API)
- `web/app/(protected)/team/_components/UsageTokensChart.tsx` (UI chart)

Watchdog implementato in:
- `shared/skills/agent-speed-table.py` (campo `warnings`)
- `web/app/(protected)/team/_components/UsageTokensChart.tsx` (badge
  nell'header)

## Storico decisione

- 2026-05-03 — Discussione con Leone, analisi empirica condotta sui log
  della sessione 13:07 → 18:09 (710 events), pesi scelti `(1, 1, 0, 0)`,
  watchdog implementato.
- Commit di riferimento:
  - `e7021165` skill backend pesi
  - `5f34e92c` UI pesi
  - (questo doc + watchdog)
