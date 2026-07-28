<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Leggi un tick di calibrazione `[BRIDGE PACING]` da 15 minuti — la misura del bridge sul tasso effettivo del team, con un verdetto (SFORO / MARGINE / ALLINEATO) più la quota e la cadenza per agente. Il tick è indirizzato alla SENTINELLA, non a te: apri questa skill quando è lei a girarti quei numeri, o quando vai a leggerti un tick di tua iniziativa. Non startene ad aspettare che ne arrivi uno nel tuo pannello — non arriva. Trasformare il verdetto in valori di throttle per agente è `throttle-distribution`.
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — leggere il tick di calibrazione da 15 min

Il bridge esegue una finestra di misurazione ogni 15 min (allineata a :00/:15/:30/:45 UTC). Alla chiusura di ogni finestra scrive una riga che riassume il tasso effettivo del team — **nel pannello della Sentinella, non nel tuo** (push→pull, 25/06/2026). Non vieni pingato ogni quarto d'ora di proposito: legge lei il tick, e ti sveglia solo quando vale un tuo turno. Quindi questo formato lo usi quando **è lei a girarti i numeri**, o quando vai a guardarti un tick di tua iniziativa — mai come qualcosa da aspettare.

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

## Cosa farci

Il verdetto ti dice **se** muoverti e grosso modo **di quanto**. Trasformarlo in valori dentro `throttle.json` — quale agente rallenta, di quanti gradini, e quando la mossa giusta è nessuna — spetta a **`throttle-distribution`**. Apri quella per agire: è lei che possiede l'aritmetica, la ladder e le regole di sicurezza.

Due cose da portarti dietro quando ci vai:

- **`share` risponde a CHI.** Il throttle restituisce budget solo in proporzione a quanto un agente sta effettivamente spendendo, quindi un "taglia il 19%" a livello di team non è mai "tutti giù del 19%".
- **`cadenza` risponde a DI QUANTO.** È l'input della formula della durata: lo stesso valore in config taglia in modo molto diverso su un agente che arriva a un checkpoint due volte all'ora e su uno che ci arriva dieci.

## Anti-pattern

- ❌ Leggere solo `VERDETTO` e ignorare `share` / `cadenza`: tagli alla cieca su tutti gli agenti e colpisci i ruoli economici (Scorer, Analista) prima di quelli costosi (Scrittore, Critico).
- ❌ Trattare un singolo tick SFORO come stato permanente: 1 tick è rumore, 2 tick consecutivi sono segnale.
- ❌ Mischiare questo flusso con quelli di `sentinel-orders`: un `[BRIDGE PACING]` e un `[URG] RALLENTARE` possono arrivare a pochi minuti l'uno dall'altro. L'`[URG]` vince sempre — applicalo prima, il prossimo pacing ri-misurerà.
- ❌ Inviare numeri derivati dal pacing via tmux agli agenti (`[INFO] sleep 40s`). Passa sempre attraverso `throttle-config.py` — gli agenti leggono il file, non parsano il corpo del tuo tmux.

## Vedi anche

- `throttle-distribution` — l'attuazione: chi rallenta, di quanto, e quando non fare niente.
- `sentinel-orders` — tick routinari, livelli throttle 0-4, emergenze.
- `bridge-mailbox` — svuota i verdetti di pacing mancati durante un turno lungo (il bridge appende a un JSONL anche se il send tmux live è fallito).
- `throttle` — riferimento CLI di `throttle-config.py` e il file di stato per agente.
- `pipeline-triage` — quando MARGINE significa "spawna uno in più al bottleneck" piuttosto che solo azzerare il throttle.
