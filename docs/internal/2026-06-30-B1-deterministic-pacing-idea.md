# 🅱️ B1 — Pacing deterministico nel bridge (IDEA futura, NON decisa)

**Data:** 2026-06-30 · **Stato:** 💭 **parcheggiata** — possibile implementazione futura, **non schedulata**, **non validata**. Nasce dall'analisi della notte betaB/Kimi 29/06 (vedi `2026-06-29` finding + i grafici thrash). **Da NON fare finché non si decide che è la direzione giusta.**

---

## 🔴 Il problema osservato (motiva l'idea)

Sul team **Kimi** (betaB), la pacing decisa dal coordinatore-LLM **ad ogni tick** degenera:
- **Bang-bang / thrash:** in una notte ~**20 transizioni** di status (SOPRA-PACE↔STEADY) e **~198 frenate** sui worker, senza mai stabilizzarsi al ritmo sostenibile.
- **Coordinator self-burn:** il *decidere stesso* è costoso — il Capitano va in turni lunghi (audit pipeline) e diventa la voce dominante del consumo proprio quando dovrebbe frenare.
- Risultato: budget bruciato dall'oscillazione, non dal lavoro (notte: +22% weekly, 13 trovate / 7 scored).

> ⚠️ **NOTA 2026-07-02 (correzione):** il "coordinator self-burn / il Capitano diventa la voce dominante del consumo" è stato ridimensionato dalla misura pulita full-history: i coordinatori pesano ~20% del budget, **~uguale su Kimi e Codex** (Capitano ~13,6%); il "70%" è coast su ENTRAMBI. Restano validi il thrash/bang-bang e il coast-burn; il vero limite di Kimi è il **budget piccolo** (~17× costo-per-azione in %). Vedi [`2026-06-29-coordinator-burn-kimi-vs-codex.md`](./2026-06-29-coordinator-burn-kimi-vs-codex.md).

## 💡 L'idea B1 (in breve)

Spostare la **pacing di routine** da giudizio-LLM a **codice deterministico** nel `pacing-bridge`:
```
v*  = budget_residuo / ore_lavoro_residue        (forward, auto-correttivo, già calcolato)
thr = ladder(v_team − v*)                          ← lo SETTA il bridge, non l'LLM
ISTERESI: cambia thr solo se fuori banda-morta per ≥N tick (no flip a ogni tick)
```
Il coordinatore-LLM **esce dal loop di routine** → meno consumo, niente thrash.

## ⚖️ La tensione APERTA (riserva utente — il punto vero)

Non è ovvio che "tutto a uno script" sia meglio:

| Pro (script deterministico) | Contro / dubbio |
|---|---|
| Cheap (zero turni LLM di routine) | Uno script è "stupido": non si adatta a casi non previsti |
| Stabile, niente thrash | Perdi l'intelligenza/giudizio dell'LLM sui casi anomali |
| Ripetibile, prevedibile | Se la formula sbaglia, sbaglia in silenzio |

**Il vero obiettivo NON è "togliere l'LLM", è togliere il suo CONSUMO dal bridge.** Quindi la direzione promettente è un **ibrido**, non un puro script:

> **Deterministico ATTUA + LLM SUPERVISIONA.**
> Lo script fa il pacing di routine (cheap, stabile). L'LLM **non decide ogni tick** ma **monitora e analizza i risultati** dello script — interviene **solo** quando lo script sta sbagliando, su un caso anomalo, o per ri-tarare. Da *decisore-continuo* a *revisore-a-campione*.

Così si abbatte il consumo (il problema) **senza** buttare via l'intelligenza (il rischio).

## 🧪 Come si validerebbe (SE mai si fa)

1. **Shadow-log prima** (come il Passo B già in produzione): il bridge calcola il `thr` deterministico ma **logga soltanto** "avrei messo X invece di Y", per N giorni, su VPS live.
2. Si confronta **deterministico vs LLM** sui dati reali: il deterministico avrebbe davvero appiattito il thrash? Avrebbe sbagliato casi che l'LLM prendeva?
3. Solo con i dati in mano si decide se **flippare** (e con quale ruolo residuo per l'LLM).

## 📌 Decisione attuale
- **NON si implementa ora.** Parcheggiata come possibile-futuro.
- Se si riprende: partire dallo **shadow-log** + disegnare bene il **ruolo supervisore** dell'LLM (non un puro script).
- Collegata a: `2026-06-28-pace-imperative-and-token-slim.md` (Passo B shadow, la base tecnica già esiste), analisi thrash notte betaB.
