# Piano di migrazione pacing — completare il passaggio al modello weekly-aware

> Stato: **PIANO (da approvare)** · 2026-06-05 · nessuna modifica ancora eseguita.
> Contesto: il pacing è migrato dal modello "riempi ogni finestra 5h fino al ~92%"
> al modello **weekly-aware** (budget weekly ÷ ore attive → target per-finestra
> ~20%, controllo `vel_team vs vel_target`, auto-calibrazione sul residuo).
> La migrazione è **a metà**: i segnali del vecchio modello convivono ancora con
> quelli nuovi e generano rumore/decisioni mal-framed. Questo piano li rimuove o
> li ri-ancora, lasciando **una sola fonte di verità**.

---

## 🎯 Principio guida
**Fonte unica di verità del pacing** = `vel_team vs vel_target` (entrambi già
ancorati a `current_window_target_pct`) + i guardrail `weekly_remaining_pct` e
`current_window_target_pct`. Tutto il resto: o alimenta questi, o è **INFO**.
Niente più framing concorrenti (92%, proj-verso-riempimento-finestra).

## ✅ Cosa NON toccare (nuovo modello, già solido)
- `vel_target = (current_window_target_pct − usage) / h_to_reset` — `pacing-bridge.py:551`. Già weekly-anchored.
- `provider_capacity` ratio **17%** (era 14.7%/3%) — `shared/skills/provider_capacity.py:55-61`. Finding #15 chiuso.
- Modello `residual_to_reset` + `work_hours_target.py` (campi residual appena integrati).
- Banda g-spot **dinamica** ri-centrata sul target (#8) — `sentinel-bridge.py:_gspot_bounds`.
- Gate working-hours + doctor-watchdog (P6).

---

## 🗂️ Inventario residui vecchio modello (file:riga → azione)

### A. `.launcher/pacing-bridge.py`
| Artefatto | Dove | Azione |
|---|---|---|
| `_PROVIDER_TARGET_BAND` = 92 per tutti + `TARGET_BAND_CENTER` | righe 76-115 | **Tenere solo come fallback** per setup senza working-hours. |
| `target_band_center: 92.0` emesso in OGNI tick | report (riga ~230 + last_report) | **Phase 1** (NON zero-risk): ha consumer web (`web/app/api/team/pacing-bridge/route.ts:57`, `TeamOrgChart.tsx:436/869`) tipizzati `number` non-nullable. Prima renderli nullable, POI emetterlo a None quando weekly-aware. Per ora resta emesso (INFO, non è il driver). |
| `proj` letto dal sample e propagato | righe 472/520/649-684 | **Declassare a INFO**: resta nel log/tick ma etichettato come segnale secondario; verificare che nessuna decisione a valle ci si appoggi (le decisioni usano già `vel_target`). |

### B. `.launcher/sentinel-bridge.py`
| Artefatto | Dove | Azione |
|---|---|---|
| Cadenza tick guidata da `_is_in_gspot(proj)` (DEFAULT 3m → CALM 10m) | righe 78-91, 169-208 | **Ri-ancorare**: trigger della cadenza su "usage vicino a `target_pct`" (on-target) invece di "proj in banda". |
| `GSPOT_LOWER/UPPER` static 80/105 | righe 89-90 | Tenere **solo** come fallback non-weekly. |
| Logica ATTENZIONE/throttle | da verificare | Confermare che throttle/S-06 derivino da `vel`/`target`/`weekly`, non da `proj`-band. Ri-ancorare dove ancora proj-based. |

### C. `agents/capitano/capitano.md`
| Artefatto | Dove | Azione |
|---|---|---|
| Regola 10 "se no target → usa 92, termostato 85-95" | riga 227 | **Declassare a fallback esplicito**: il target dinamico è il primario; il 92 solo per setup non configurati. Togliere il framing "termostato a 92" come modello mentale primario. |
| C-07 "Phase 1 = proj < 100%" | riga 137 | **Ri-chiavare** la definizione di Phase su condizione weekly-aware (`vel_team ≤ vel_target` + headroom weekly), non su `proj`. |
| `proj_primary` vs `proj_weekly` | riga 163 | Tenere `proj_weekly` (S-06, ore attive); rimuovere il framing `proj_primary` (finestra). |
| Riferimenti a proj come driver di spawn (85-95%) | righe 144, 182 | Sostituire la condizione "proj on target 85-95" con "usage vs target weekly + code". |

### D. `agents/_skills/*` (consumatori di proj)
`bridge-pacing`, `sentinel-orders`, `pipeline-triage`, `rate-budget`, `bridge-mailbox`, `format-time`: rivedere ognuno e sostituire `proj` con `vel_team/vel_target/weekly_remaining/target_pct` dove guida decisioni. (Audit puntuale per-skill.)

### E. Payload `[BRIDGE TICK]`
Riordinare il tick che il Capitano legge: **primari** `target`, `vel_team`, `vel_target`, `weekly_remaining_pct`, `work_phase`; **secondari/INFO** `proj`, `band_center`.

---

## 📋 Fasi (per rischio crescente)

**Fase 0 — chiarezza, rischio ZERO** (display + prompt, nessun cambio logica)
- pacing-bridge: non emettere `target_band_center:92` quando weekly attivo.
- capitano.md: rimuovere il "usa 92 / termostato" come framing primario.
- Etichettare `proj` come INFO nel tick.
→ Effetto: il BRIDGE TICK mostra un solo framing coerente. Reversibile.

**Fase 1 — ri-ancoraggio decisioni, rischio MEDIO**
- Phase 1/2/3 e cadenza tick Sentinel ri-chiavate su `vel/target/weekly` invece di `proj`-band.
- Skill aggiornate (D).

**Fase 2 — pulizia, rischio BASSO post-Fase1**
- Rimuovere i path g-spot/proj ormai morti, lasciando solo il fallback per setup non configurati.

---

## ✅ Verifica (ad ogni fase)
1. `python3 shared/skills/work_hours_target.py --self-test` verde.
2. Self-test pacing-bridge/sentinel se presenti (altrimenti aggiungerne uno per il nuovo path).
3. **VPS betaC (beta live)**: confronto A/B di 3-4 tick prima/dopo — `vel_team vs vel_target`, `weekly_remaining`, e che NON compaiano più falsi allarmi "sottoutilizzo" da proj volatile (il caso `proj=-8.66` con target=23 che ha fatto nascere questo piano).
4. Pacing sostenibile confermato: atterraggio ~100% al reset weekly, nessun HALT anticipato.

## ⚠️ Note
- È il cuore del pacing del **beta live (betaC)** → ogni fase via PR + CI + verifica VPS, mai push diretto.
- Le Fasi 0 sono già le "due a rischio-zero" proposte: si possono fare subito e indipendentemente.
- Lega con: DIAGNOSI-pacing-weekly-2026-06-03, finding #8 (banda dinamica), #10 (standalone), #15 (ratio).
