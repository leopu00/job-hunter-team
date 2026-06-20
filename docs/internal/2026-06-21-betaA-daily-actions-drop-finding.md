# 📉 betaA/Codex — perché le azioni medie/giorno sono scese (finding)

**Data:** 2026-06-21 · **VPS:** Codex `203.0.113.10` (utente betaA, beta-1) ·
**Metodo:** indagine **read-only** sul VPS (jobs.db in `mode=ro`, capture-pane
tmux, log `sentinel-data.jsonl`/`throttle-events.jsonl`/scout). Nessun intervento
sul team (regola: simulazioni in sola osservazione).

## Domanda
Dalla pagina case-study beta-1 si vede che le azioni totali/giorno sono crollate:
~70/giorno il 13–14 giu → ~30/giorno il 19–20 giu. I giorni di reset settimanale
combaciano (11 giu = 53, 18 giu = 52), ma il mezzo-settimana è molto più basso.
Il budget dovrebbe essere lo stesso: cosa sta succedendo?

## TL;DR
Il budget **è lo stesso** e viene **quasi tutto consumato ogni settimana (~99%)**.
Sono cambiate due cose:
1. **Il pacing ha imparato a "spalmare" il budget settimanale** invece di
   bruciarlo a inizio settimana → picchi mezzo-settimana più bassi.
2. **Gli scout sono in rendimenti decrescenti**: il mercato indirizzabile per
   questo profilo si sta saturando → meno lavoro nuovo + costo/azione più alto.

Non è un calo di budget e non è un team rotto: il pacing fa esattamente quello
per cui è progettato (vedi [milestone weekly 99%](2026-06-18-betaA-weekly-99pct-milestone.md)).

---

## Causa 1 — Il budget settimanale è il vincolo, e ora viene spalmato

Serie storica da `logs/sentinel-data.jsonl` (colonna `weekly_usage`), aggregata per
settimana ancorata al giovedì (reset Gio ~06:00 UTC):

| Settimana (Gio→Mer) | Picco weekly budget | Azioni totali | Media/giorno | Nuove posizioni |
|---|---|---|---|---|
| **4–10 giu**  | **100% già il 7–8 giu** 💥 | 549 (in 4 gg) | **137/g** | 172 |
| **11–17 giu** | ~94–99% al reset | 402 (in 7 gg) | 57/g | 139 |
| **18–24 giu** | ~30% al giorno 3 | 117 (in 3 gg) | **39/g** | 41 |

- **Settimana 1**: partenza a manetta (137 azioni/g) → **esaurito il weekly al
  100% in 4 giorni** (7–8 giu) → **stop forzato 8–10 giu** (compreso, ma non
  causato solo, dagli aggiornamenti). Reset Gio 11.
- **Settimana 2**: più ordinata, ancora un po' sbilanciata a inizio settimana
  (13–14 giu ~70/g), arriva comunque a ~99% al reset.
- **Settimana 3**: parte bassa e piatta (35→30/g) **apposta**, per non ripetere
  l'esaurimento precoce della settimana 1.

I giorni di reset che combaciano (11 giu = 53, 18 giu = 52) = il pacer **converge
su un burn sostenibile** (~1,27%/h attivo). Il `vel_target` nei tick del Capitano
("chiudere a ~15% al reset della finestra 5h") è la rata che spalma il settimanale
sull'intera settimana.

### Il `SOTTOUTILIZZO` non è un bug
La Sentinella segnala `SOTTOUTILIZZO` sulla **finestra 5h** (usage 10–20%), non sul
settimanale. È **voluto**: spingere la 5h al g-spot 80–105% esaurirebbe il weekly
in ~2 giorni (settimana 1 docet). Stato live al 20/06 21:40 UTC:
`last_status=SOTTOUTILIZZO`, `last_projection=14.0`, `g_spot=80–105`, ma in
parallelo l'ordine al Capitano era `RALLENTARE` perché *"usage=10% già sopra
target=7% … Vincolo attivo: primary/work-hours target, non weekly"*.

---

## Causa 2 — Saturazione scout (rendimenti decrescenti reali)

**Nuove posizioni trovate** in calo: 172 → 139 → 41 (in 3 gg, ~14/g vs ~25/g della
settimana 1). Dai log scout del 20/06:

- **16 duplicati** (`duplicate:level1/2/3` — ri-trovano roba già in DB) vs **solo
  10 nuove tenute**;
- **16 skip**: 10 per **lingua** (tedesco/spagnolo/mandarino/olandese richiesti),
  poi geo/work-auth, `fetch-blocked` (Cloudflare/403/404), link morti/scaduti.

Il bacino per un profilo **finance · early-career · inglese · work-auth UE** in
Europa è finito e ormai in gran parte già scandagliato. Conseguenze:

- meno lavoro **nuovo** a valle → la pipeline (analista/scorer seguono i `new`
  ~1:1) si restringe;
- gli scout **bruciano budget** su fetch che finiscono in duplicato/blocco senza
  produrre un'azione in DB → **il costo per azione sale** → spiega perché le azioni
  settimanali calano (549→402→~270) pur usando ~99% del budget.

In settimana 3 il weekly è addirittura **sotto-pace (0,82x)**: non manca budget,
**manca lavoro nuovo eleggibile** da consumarlo. Transizione da
"limitato-dal-budget" a "limitato-dal-lavoro-disponibile".

---

## Fattori amplificanti (minori)

- **Meno istanze attive.** Ora 1 scout / 1 analista / 1 scorer (prima fino a 6 per
  ruolo). Con code spesso vuote e tick in "SFORO" sulla finestra 5h, il Capitano
  **tiene gli spawn fermi** ("Hold nuovi spawn", "non apro Scout mentre il tick è
  in SFORO"). Fuori dalle working hours (08–20 Europe/Rome) i worker sono
  **terminati**: restano solo i 4 core (Capitano/Sentinella/Assistente/Mentor).
- **Overhead del Capitano.** In diversi tick il Capitano è il **36–100% del
  consumo** (legge SKILL.md, drena mailbox, 4–5 query DB ad ogni tick) → una fetta
  del weekly va in coordinamento, non in azioni produttive → alza il costo/azione.
  Conferma del [coordinator-burn](2026-06-15-coordinator-burn-consumo-finding.md).

---

## Evidenze a supporto (dati grezzi)

Azioni/giorno per ruolo + istanze attive (da `position_state_transitions`):

```
day         tot  scout  anal  scor | #i  istanze
2026-06-04  162     55    57    50 |  5
2026-06-05  199     51    50    98 |  5
2026-06-13   67     21    25    21 |  5
2026-06-14   76     25    28    23 |  6   <- picco mezzo-settimana
2026-06-18   52     18    19    15 |  6   <- reset (≈ 53 di una sett. prima)
2026-06-19   35     14    12     9 |  3
2026-06-20   30     10    10    10 |  3   <- 1 istanza per ruolo
```

Weekly budget vs finestra 5h (da `sentinel-data.jsonl`, medie giornaliere):

```
day        usg_5h_av  weekly_av  weekly_mx  status prevalente
2026-06-07   18.8       90.3       100      SOTTOUTILIZZO (weekly quasi pieno)
2026-06-08   24.0      100.0       100      SOTTOUTILIZZO (weekly ESAURITO -> stop)
2026-06-17   13.4       94.4        99      SOTTOUTILIZZO (fine sett. 2)
2026-06-20   16.7       30.6        39      SOTTOUTILIZZO (sett. 3, sotto-pace)
```

---

## Cosa NON è la causa
- Non è un calo di budget: il settimanale è **identico** e speso al ~99% ogni
  settimana.
- Non è il team "rotto": il pacing fa esattamente quello per cui è progettato.

## Finding per il codice (osservati, non toccati)

1. **Tensione doppio-segnale weekly vs primary 5h.** weekly `SOTTOUTILIZZO`
   (62% libero a metà settimana) vs primary `SFORO→RALLENTARE`, con il primary che
   vince. Per lo più corretto (preserva il weekly), ma a inizio settimana — quando
   il mercato è più fresco — un **front-load leggermente maggiore** catturerebbe
   più posizioni nuove prima della saturazione. Tuning, non bug. Collegato a
   [proj volatile nel pacing](2026-06-20-proj-volatile-pacing-todo.md).
2. **Saturazione scout come segnale di prima classe.** Quando
   `duplicati+skip » nuove`, ha senso che il team **riallochi il budget**
   (recheck/approfondimento, o allargare lingua/geo del profilo) invece di
   insistere su fonti esaurite.
3. **Coordinator-burn del Capitano** confermato di nuovo (overhead fisso alto per
   tick) — vedi finding dedicato.

## Riproducibilità
- DB: `sqlite3 file:/root/.jht/jobs.db?mode=ro` su `203.0.113.10` (via `ssh jht-vps`).
- Serie storica pacing: `~/.jht/logs/sentinel-data.jsonl` (per-tick usage/weekly/
  status/throttle), `throttle-events.jsonl` (campo `requested_sec`).
- Ragionamento agenti: `docker exec jht tmux capture-pane -t CAPITANO -p -S -2200`.
- Saturazione scout: `~/.jht/logs/scout-dedup.log`, `scout-skip.log`.
