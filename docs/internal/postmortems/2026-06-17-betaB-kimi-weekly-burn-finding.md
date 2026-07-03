# 🔥 betaB/Kimi — weekly esaurito in 2 giorni: backfill storm post-deploy (finding)

**Data:** 2026-06-17 · **VPS:** betaB (`203.0.113.20`, provider kimi, user_id `22a8e78c`) ·
**Lane fix:** pacing/dev1 (bridge weekly-aware + `analista.md` RULE-12/14). · **Modalità:** SOLA
LETTURA (nessun intervento — [[feedback_no_intervention_in_simulations]]). · **Correlati:**
`project_usage_redesign_validated_betaB`, `2026-06-07-capitano-runaway-scaling-postmortem.md`,
`2026-06-13-kimi-quota-tiers-discovery.md`.

> **TL;DR.** La finestra settimanale Kimi è stata bruciata in **2.1 giorni** (vs 6.7 della settimana
> precedente). Causa: il **deploy di Lun 15/06 ~15:00** ha attivato RULE-12/13/14 (recheck giornaliero
> + metadati obbligatori) → gli analisti hanno fatto una **catch-up una-tantum dell'intero backlog**
> (196+164 posizioni ri-processate in 2 giorni), durante i turni notturni (betaB lavora 20:00→08:00,
> verificato) con roster scalato. Non è un
> bug-loop (lavoro reale, non spin); è **over-pace**. Il freno weekly ha *visto* (ATTENZIONE,
> proj_weekly 900-1110%) ma non ha *tenuto*.

---

## 1. 📊 Il fatto

Finestre settimanali Kimi (da `sentinel-data.jsonl`, 7515 record dal 19/05; provider passato a kimi il
**Sab 13/06 03:42**):

| Finestra | →100% | Durata |
|---|---|---|
| Precedente (Dom 07/06 19:11 → Dom 14/06) | Dom 14/06 12:19 | **6.7 gg / 7** → sana, spread |
| **Corrente (Dom 14/06 19:11 → Dom 21/06 19:11)** | **Mar 16/06 20:50** | **2.1 gg / 7** → ~3× over-pace |

Curva front-loaded e in accelerazione:

```
Dom 14/06:  weekly   0% →  21%   (+21 punti)
Lun 15/06:  weekly  21% →  55%   (+34 punti)
Mar 16/06:  weekly  55% → 100%   (+45 punti)
```
Milestone: 25% a +6h, 50% a +26h, **75% a +32h** (cioè 50→75% in ~6h, notte Lun→Mar), 90% a +42h,
100% a +50h. Burn medio ~33%/giorno contro un sostenibile di ~14%/giorno (100/7) = **~2.3× medio**,
con il giorno peggiore (Mar) a 45% = **3.2×**.

## 2. 🎯 La causa: backfill dell'intero backlog post-deploy

Smoking gun nel DB — mentre le posizioni **nuove** calavano, le posizioni **ri-toccate** (recheck +
backfill metadati, `positions.last_open_check`) sono esplose:

| Giorno | transizioni (funnel nuove) | recheck/backfill |
|---|---|---|
| 14/06 | 265 | 68 |
| **15/06** | 170 | **196** |
| **16/06** | 127 | **164** |

Il **deploy della nuova immagine è di Lun 15/06 ~15:00** (taxonomy emergente + RULE-12/13/14). Quella
immagine ha introdotto: **recheck giornaliero (RULE-12)** + **metadati obbligatori (RULE-13:
role_family, loc_*, salary)** + **code per-task (RULE-14)**. Effetto: gli analisti hanno macinato
l'**intero arretrato di 557 posizioni** in una catch-up una-tantum (mai backfillato prima coi nuovi
campi). Ogni recheck = **liveness via browser (Playwright) + enrichment + stima salary** = caro.

**Escluso come co-driver (verificato 2026-06-17): la scrittura CV.** I 105 CV "ready" hanno
`positions.updated_at` raggruppato all'ora del deploy (15/06 14:57) — è un **tocco di massa del
deploy**, NON CV nuovi: le 122 `applications` hanno `created_at` di **MAGGIO (19-21/05)**, scritte da
`scrittore-1/2/3`; nessuno Scrittore ha girato da allora (coerente con la policy writer-on-demand). Il
burn di giugno è recheck/backfill + sourcing, NON CV writing.

Nella notte del burst (Lun 15 22:00 → Mar 16 08:00 UTC), attività concorrente pesante:
```
scout-2    -> new       57     (sourcing nuovo IN PARALLELO al backfill)
analista-5 -> excluded  23  / -> checked 20
analista-1 -> checked   15  / -> excluded 14
scorer-5   -> scored    23  / -> excluded 9
```

## 3. ⚠️ Due aggravanti strutturali

1. **CORREZIONE (2026-06-18): betaB NON gira 24/7 — fa un turno NOTTURNO 20:00→08:00.** Verificato il
   config reale: `jht.config.json` → `team.working_hours = {timezone: Europe/Rome, windows:
   [20:00→08:00, tutti i giorni]}` (intatto, mtime 15/06). betaA = `08:00→20:00` (giorno). **Entrambi
   12h/giorno.** Il mio "24/7" iniziale era un ERRORE: la finestra notturna 20→08 copre sera + notte
   fonda + mattino (20:00, 02:00, 06:00 Rome) e l'ho letta come round-the-clock; in più avevo cercato
   il config nella dir sbagliata (`/root/.jht/config/` invece di `jht.config.json`). Il `work_phase=ON`
   di betaB alle 23:00 Rome è CORRETTO (è dentro la sua finestra notturna), non prova di 24/7. La
   distribuzione oraria del burn è infatti concentrata nella finestra notturna + un baseline minore di
   *coordinator-burn* (Sentinella/Capitano tick ~24/7) durante le ore OFF. **→ Quindi la pausa notturna
   NON è la differenza betaB/betaA** (entrambi 12h): la differenza betaB-2gg vs betaA-7gg è lo
   **storm di backfill** (§2) + il provider (Kimi vs Codex). betaA ha chiuso il weekly al ~94-99%
   spalmato su ~7 giorni perché NON ha avuto lo storm, non perché lavori meno ore.
2. **Roster scalato.** 3 analisti + 2 scout attivi nella notte del burst (la settimana precedente,
   durata 6.7gg, aveva roster più leggero).

## 4. 🚦 Il freno ha VISTO ma non ha TENUTO

Il sistema ha rilevato l'over-pace: **169 tick `ATTENZIONE`** nella finestra, `proj_weekly` a
**900–1110%** già dalla **prima notte** (Dom 14 20:44 → proj 955%). Ma il throttle ha solo
*rallentato*, non *fermato*. Radice: il giudizio istantaneo leggeva spesso `SOTTOUTILIZZO` (la finestra
5h non è mai satura — i burst sono brevi) mentre il **weekly** schizzava; il freno weekly-aware esiste
ma non ha frenato abbastanza forte/presto da tenere la linea settimanale contro lo storm + il 24/7.
Distribuzione status nella finestra: `SOTTOUTILIZZO 560, ATTENZIONE 169, STEADY 22, RESET 7`.

✅ **Comportamento a quota esaurita = CORRETTO.** Ora che è al 100% il team **coasta** (zero burn,
niente spawn) — il runaway-scaling del 2026-06-07 **non** si ripete. Il problema è il *ritmo di
consumo* nei primi 2 giorni, non il comportamento a quota piena.

## 5. 🧭 Una-tantum o strutturale + leve

**Per lo più una-tantum:** il backfill dell'intero arretrato coi nuovi campi obbligatori capita *una
volta* dopo aver introdotto RULE-12/13/14; la prossima settimana il recheck tocca solo il sottoinsieme
stale (molto meno). MA emergono **3 leve reali** (finding per il codice/config, NON runtime):

1. **Backfill massivo weekly-budget-aware** (lane pacing/dev1): un backfill di centinaia di posizioni
   va **spalmato sul budget settimanale** (a rate, su più giorni), non eseguito il più in fretta
   possibile. Oggi `next-for-recheck`/`next-for-categorize` non hanno throttle proporzionale al weekly
   residuo.
2. **~~Pausa notturna~~ → SUPERATA dalla correzione (2026-06-18):** betaB HA già una finestra (turno
   notturno 20:00→08:00, 12h). La leva non è "aggiungere una pausa", ma un **rate-cap dentro la
   finestra** quando un'operazione massiva (lo storm di backfill) la satura: anche 12h di lavoro pieno
   a velocità da storm bruciano il weekly. La leva reale resta la #1 (backfill weekly-budget-aware).
3. **Freno weekly più aggressivo**: quando `proj_weekly` resta >100% per N tick consecutivi, throttle
   forte / scale-down roster — oggi rallenta troppo poco, troppo tardi.

## 6. 📌 Stato

- **Nessun intervento** sul container: betaB resta UP, coasta fino al reset weekly (**Dom 21/06
  19:11**). Registro categorie sano (12, zero drift).
- Le 3 leve sono **decisione dell'utente** (lane pacing/dev1, deploy gated) — non implementate.
- Metodo riusabile: `tmp/weekly_burn.py` (ricostruisce le finestre settimanali + curva + burst +
  status da `sentinel-data.jsonl`).
