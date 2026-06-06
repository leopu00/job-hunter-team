<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Traduci un tick di calibrazione `[BRIDGE PACING]` a 15 minuti in aggiustamenti di throttle per agente. Il bridge misura il tasso effettivo di consumo del team e ti dà un verdetto (SFORO / MARGINE / ALLINEATO) più la quota per agente + cadenza necessaria per scegliere CHI rallentare e DI QUANTO. Apri questa skill SOLO quando arriva una riga `[BRIDGE PACING]`; i tick routinari `[SENTINELLA]` usano un flusso diverso (`sentinel-orders`).
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — calibrazione throttle basata sui dati

Il bridge esegue una finestra di misurazione ogni 15 min (allineata a :00/:15/:30/:45 UTC). Alla chiusura di ogni finestra scrive una riga nel pannello del Capitano che riassume il tasso effettivo del team e indica in che direzione bilanciare il throttle. Questo **non** è un ordine della Sentinella — è un segnale di calibrazione su cui agisci con `throttle-config.py`.

## Forma del messaggio

```
[BRIDGE PACING] HH:MM UTC window=15m (effettivi Xm) samples=N |
  usage=U% reset_in=Rh reset_at=THH:MM UTC (proj=P% — INFO, secondario non-driver) |
  vel_team=V%/h | vel_target=T%/h (per chiudere a TGT% al reset) [schedule+ratio phase=ON] |
  ratio=K kT/% (team Σ kT / Δusage) |
  agenti: name=p%/h [kT/Xm → kT/h ÷ K = p%/h, share s%, cadenza c/min (n chk in Xm)] ; ... |
  VERDETTO: SFORO|MARGINE|ALLINEATO ...
```

`TGT` è il **target dinamico** scelto dal bridge:
- Config 24/7 o nessun orario → `TGT=92` (centro banda, default storico)
- Config orari lavorativi + provider con cap settimanale (Codex/Claude) → `TGT` è la % necessaria al reset perché il budget settimanale sia distribuito esattamente sulle ore attive dell'utente. Esempio: orario ufficio 9-18 su Codex Pro → `TGT≈76`.
- Config orari lavorativi + Kimi (nessun cap settimanale) → `TGT=92` (fallback centro banda).

Il tag `[schedule+ratio phase=ON]` tra parentesi è la **sorgente** del target — `band_center` (niente orari), `schedule+ratio` (orari lavorativi completo), `schedule+band` (orari lavorativi + fallback Kimi). Usalo per debuggare target inaspettati.

## Campi che usi effettivamente

| Campo             | Cosa ti dice                                                                                       |
|-------------------|------------------------------------------------------------------------------------------------------------|
| **`vel_team`**    | tasso misurato del team, in punti % di budget per ora                                                     |
| **`vel_target`**  | tasso che porterebbe a `TGT%` al reset (centro della banda ±10pt intorno a `TGT`)                         |
| **`share s%`**    | peso per agente sul tasso totale (Σ share ≈ 100%) — ti dice **CHI** rallentare                             |
| **`cadenza c/min`** | chiamate `jht-throttle` per minuto nella finestra per agente — ti dice **DI QUANTO** aggiungere alla config |
| **`VERDETTO`**    | sintesi azionabile; mappa direttamente alla tabella sotto                                                  |

> ⚠️ **`proj` è solo INFO — NON agire su di esso.** È un'estrapolazione volatile della
> velocità nella finestra breve (es. ha stampato `proj=-8.66%` mentre il team era solo un
> filo sotto target). Il loop di controllo è **`vel_team` vs `vel_target`** (entrambi
> weekly-aware) + `weekly_remaining`. Ignora `proj` per decisioni di throttle/spawn.

## Verdetto → azione

| Verdetto                         | Significato                                                    | Azione                                                                                |
|----------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `SFORO +X%/h → riduci Y%`        | `vel_team` supera il target di X punti/h. Taglia Y% del tasso. | **Aumenta** `throttle-config` per gli agenti con **share alto** (top 1-2)              |
| `MARGINE −X%/h → puoi salire Y%` | `vel_team` sotto target. Hai margine.                          | **Azzera o riduci** il throttle sugli agenti throttlati (priorità: ruolo bottleneck)   |
| `ALLINEATO Δ ±0.2%/h`            | dentro la tolleranza.                                          | non fare nulla, aspetta il prossimo tick                                               |

> 💡 `X%/h` vs `Y%` sono la stessa cosa in due unità. `Y = X / vel_team × 100`.

## Formula di calibrazione (la novità qui)

Per ottenere una riduzione del tasso di `f%` su un agente con cadenza `c` checkpoint/min, la durata da inserire in `throttle-config` è:

```
durata_sec = (f / 100) × 60 / c
```

L'intuizione: ogni chiamata `jht-throttle` aggiunge `durata_sec` di pausa. In 60s l'agente la chiama `c` volte → aggiunge `c · durata` secondi di pausa per minuto → taglio frazionale del tasso `= c · durata / 60`. Risolvi per `durata`.

### Esempio pratico — concentra il taglio su un agente

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
```

Scarica quasi tutto il taglio su `analista-1`:
- frazione su analista-1 ≈ 19% / 47% ≈ 40%
- `durata_sec = 0.40 × 60 / 0.6 = 40s`
- → `throttle-config.py set analista-1 40`

### Esempio pratico — distribuisci il taglio su due agenti

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
scout-1:    share 26%, cadenza c_scout
```

Peso combinato 47 + 26 = 73%. Distribuisci il 19% proporzionalmente:
- frazione per agente ≈ 19% / 73% ≈ 26%
- analista-1: `0.26 × 60 / 0.6 = 26s`
- scout-1:    `0.26 × 60 / c_scout`
- → un `bulk-set` scritto atomicamente:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set \
    analista-1=26 scout-1=<derivato da c_scout>
```

## Quando rilasci il throttle (MARGINE)

Se il verdetto è `MARGINE −X%/h → puoi salire Y%`:
1. Scegli il ruolo che vuoi accelerare (priorità: il bottleneck corrente — `pipeline-triage` se in dubbio).
2. Riduci il suo throttle attuale di circa `Y%` (o azzeralo se era un valore piccolo).
3. **Non** azzerare tutti in una volta — oscilleresti in uno SFORO al tick successivo.

## Cadenza dopo un cambio di config

- Dopo qualsiasi modifica, aspetta **2-3 tick** (≈30-45 min) prima di intervenire di nuovo.
- Il pacing è già la tua sintesi — **non** aggiungere ulteriori chiamate `rate_budget live` nel frattempo (inflazionano la `velocity_smooth` della Sentinella).
- Se dopo 3 tick il verdetto è ancora SFORO, raddoppia le durate sugli stessi agenti (lineare → geometrico); se ancora MARGINE, dimezza.

## Anti-pattern

- ❌ Leggere solo `VERDETTO` e ignorare `share` / `cadenza`: tagli alla cieca su tutti gli agenti e colpisci i ruoli economici (Scorer, Analista) prima di quelli costosi (Scrittore, Critico).
- ❌ Trattare un singolo tick SFORO come stato permanente: 1 tick è rumore, 2 tick consecutivi sono segnale.
- ❌ Mischiare questo flusso con quelli di `sentinel-orders`: un `[BRIDGE PACING]` e un `[URG] RALLENTARE` possono arrivare a pochi minuti l'uno dall'altro. L'`[URG]` vince sempre — applicalo prima, il prossimo pacing ri-misurerà.
- ❌ Inviare numeri derivati dal pacing via tmux agli agenti (`[INFO] sleep 40s`). Passa sempre attraverso `throttle-config.py` — gli agenti leggono il file, non parsano il corpo del tuo tmux.

## Vedi anche

- `sentinel-orders` — tick routinari, livelli throttle 0-4, emergenze.
- `bridge-mailbox` — svuota i verdetti di pacing mancati durante un turno lungo (il bridge appende a un JSONL anche se il send tmux live è fallito).
- `throttle` — riferimento CLI di `throttle-config.py` e il file di stato per agente.
- `pipeline-triage` — quando MARGINE significa "spawna uno in più al bottleneck" piuttosto che solo azzerare il throttle.
