# Run Kimi vs Run Codex — confronto fra due beta test

Confronto fra il primo beta test con provider **Kimi K2** (run più documentato attorno al 2026-05-17) e il beta test con provider **Codex ProLite gpt-5.5 high** (run sulla VPS1, 2026-05-19 → 2026-05-21, fermato in HALT-WEEKLY).

Sorgenti dati:
- Run Kimi: `docs/internal/2026-05-17-team-strategy-bugs.md`, `docs/internal/2026-05-03-rate-kimi-weights.md`, conversazioni utente passate.
- Run Codex: `docs/internal/2026-05-21-team-output-analysis.md` (stats DB live), `docs/internal/2026-05-21-halt-weekly-incident.md`.

## Avvertenza preliminare — i due test non sono "stesso candidato"

I due beta test sono stati fatti con **due profili candidato diversi**, non con la stessa persona. Differenze nei filoni di ricerca (tech/SWE vs falegname/translator/technical writer) sono spiegate dal **profilo input** a `candidate_profile.yml`, non da una traiettoria evolutiva del progetto né da una scelta diversa di Leone.

Le inferenze su trend, evoluzione strategica del candidato, espansione di filoni — sono **non valide** in questo confronto. Vedi memory `project_beta_test_users` per la regola generale.

## Numeri base

| Metrica | Run Kimi (≈ 17/05) | Run Codex VPS1 (35h, 21/05) |
|---|---|---|
| Provider | Kimi K2 | Codex ProLite gpt-5.5 high |
| Position trovate (totali in pipeline visibile) | ~22-28 | **206** |
| `status=ready` | 19 (post fix bug #21) | **105** |
| `applied=1` via JHT | 0 | 0 |
| Critic score medio | ~6.0 (range 5.0-7.5) | 6.30 (range 4.0-8.4) |
| Companies analizzate | ~11 PASS visibili | 179 (120 GO + 59 CAUTIOUS) |
| Profilo candidato | tech (Python/SWE/Data) | non-tech multi-dominio (IT+HU, falegname, tech writer, translator) |
| Capitano context/turn | 83.7k token ("bloated") | 168 M tokens cumulati (24× più alti) |

## Cosa si può dedurre — solo i punti che reggono al confronto

### 1. Velocità del sistema ~10× superiore con Codex

Codex ha prodotto ~10× più position e ~5× più CV ready in tempo confrontabile. Le cause sono **due, non isolabili** dal confronto:

- **Maturazione del team**: fix bug #14 (state log), #21 (Scrittore→ready), #25 (dedup), più skill aggiunte, tracking migliorato. Il team-as-system è cresciuto tra 03/05 e 21/05 indipendentemente dal LLM.
- **Codex più veloce di Kimi** sul singolo turn (gpt-5.5 high + reasoning intensivo + Codex CLI exec asincrono).

Non si può attribuire il 10× a un solo fattore.

### 2. Qualità output stabile attraverso il cambio LLM

Critic medio passato da ~6.0 → 6.30 (+0.3 punti). Non statisticamente significativo (sample piccolo Kimi). Il loop Critico 3-round è il **meccanismo di qualità**, non il provider sottostante.

**Implicazione**: la qualità dei CV ready è guidata dal protocollo team, non dalla capacità intrinseca del LLM. Cambiare provider non migliora la qualità degli output finali.

### 3. Sostenibilità weekly cap radicalmente diversa

| Provider | Cap principale | Burn rate run | Esaurimento |
|---|---|---|---|
| Kimi K2 | Token (~40k token = 1% rate) | lineare e basso | reggeva per giorni |
| Codex ProLite | Minuti compute (primary 300/5h + weekly 10080/168h) | 2.7 %/h weekly sostenuto | **2-3 giorni** invece dei 7 nominali |

Il vincolo Codex weekly è **il vero collo di bottiglia** del run attuale. Da qui l'incidente HALT-WEEKLY e l'entry [PACING-WEEKLY-EXHAUSTION] in `BACKLOG.md`.

Il modello mentale "1% primary ≈ 3 min ≈ 0.03% weekly, 1 primary saturata = 3% weekly" è il dato chiave estratto da questo run, non disponibile con Kimi (modello token-based).

### 4. `applied=0` in entrambi i run — NON è un gap

In entrambi i test `applications.applied=1` è zero. **Non è un problema di sistema**. Il flow JHT è by-design:

1. Team trova → scora → scrive CV → marca ready
2. Utente clicca "applied" **quando vuole, nei suoi tempi**

Un beta test di 35h con 0 click è normale: il beta tester può non aver avuto tempo o non aver voluto applicare. Allargare l'inferenza a "funnel rotto" / "conversione bloccata" / "gap operativo" è **scorretto** — è semplicemente un dato di stato non un sintomo.

### 5. Profilo bug evolve con la maturità

| Run | Bug noti |
|---|---|
| Kimi (17/05) | dedup CV, photo allucinatoria, context bloat 83.7k, Critic→Scout loop assente |
| Codex (21/05) | tracking `written_by`/`reviewed_by` null al 95%, glassdoor 0/179, 7 (title,company) duplicati, 27 esclusioni tardive in `writing`, NO_GO mai assegnato, scaling Scorer non fatto |

Bug della generazione precedente chiusi, ne sono emersi di nuova generazione. Pattern atteso, non regressione.

## Cosa NON si può dedurre dal confronto

- ❌ "Il candidato sta esplorando più filoni" → falso, sono due candidati diversi.
- ❌ "Il sistema ha un gap di conversione ready→applied" → falso, è scelta utente.
- ❌ "Codex produce CV migliori di Kimi" → equivalenti, il protocollo è il driver.
- ❌ "Switching da Kimi a Codex è la causa del 10× throughput" → solo in parte, il sistema è maturato in parallelo.

## Implicazioni strategiche

1. **Per produzione H24×7gg sostenibile**: serve fix [PACING-WEEKLY-EXHAUSTION] (dial Sentinella sul weekly secondary). Senza, il sistema è insostenibile su Codex ProLite.

2. **Per qualità output**: investire nel protocollo (Critico, prompt Scrittore, profile-summaries) — il provider è secondario.

3. **Per scelta provider**: Codex ProLite vince in velocità ma perde in sostenibilità. Kimi K2 era più lento ma stabile. Decisione = caso d'uso: produzione intensiva breve (Codex) vs continuo lungo (Kimi o tier superiore Codex).

4. **Per il loop apply**: l'`applied=0` non richiede fix sistemico. Eventuali nudge UI/Telegram per ricordare i ready esistenti sono UX migliorabili, non bug.

## Riferimenti

- `docs/internal/2026-05-21-team-output-analysis.md` — stats completa run Codex.
- `docs/internal/2026-05-21-halt-weekly-incident.md` — incidente weekly saturazione.
- `docs/internal/2026-05-17-team-strategy-bugs.md` — strategy session run Kimi.
- `docs/internal/2026-05-03-rate-kimi-weights.md` — calibrazione rate budget Kimi.
- `BACKLOG.md` — entry `[PACING-WEEKLY-EXHAUSTION]` P0.
- Memory: `project_beta_test_users`, `project_jht_goal_and_state`.
