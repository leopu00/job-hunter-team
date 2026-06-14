# Fix-batch 2026-06-13 — recheck quality · scout-resume · pacing · non_producing · totalQuota

**Stato:** approvato dall'utente ("implementa tutto"), distribuito a 3. Design-doc condiviso;
ognuno implementa la propria fetta sul proprio branch, si cross-mergia, l'utente fa il merge in
master. Gemello per struttura di `2026-06-13-maintainer-toolhealth-resilience-design.md`.

Trigger: findings emersi monitorando betaB/betaA oggi (sola lettura). Regola ferrea: si fixa nel
CODICE, mai a runtime sulla sim.

## 🔴 P1 — Qualità recheck (falsi "aperti")  [massimo impatto: sporca i dati veri]
Il recheck è uno **script curl ad-hoc** dell'analista (`code=200 marker=none title_signal=present`)
→ NON vede l'expiry **JS-rendered** (Ashby/Workday/Greenhouse renderizzano lo status lato client)
né l'**authwall LinkedIn** → `is_open=1` su job CHIUSI. La skill `expiration-tracking` ha l'expiry
detection segnata "out of scope, initial".
- **dev3**: nuova skill condivisa `recheck-liveness` — TIERED: curl-marker veloce → se ambiguo o
  ATS-JS/LinkedIn → escala al BROWSER (Playwright ora c'è); marker-list ricca per-ATS;
  inconcludente → `OPEN_UNVERIFIED` (mai falso-aperto, pattern `resilience`).
- **dev2**: `agents/analista/analista.md` — l'analista USA `recheck-liveness`, vietato il curl ad-hoc.

## 🟠 P2 — Scout si pianta dopo il resume
Dopo freeze/RIPRENDI lo Scout fa ACK e aspetta invece di ricercare → `new=0` finto.
- **dev1**: `agents/scout/scout.md` — su resume RIENTRA nel loop di ricerca (1 batch), mai idle;
  aggancia `resilience` (no-silent-stop).

## 🟠 P3 — Pacing: over-brake + recovery lento
Freeze troppo aggressivo con runway alto + ~2h di lag (il `vel_weekly` a 2h trascina il burst).
- **dev3**: `shared/skills/weekly_pace.py` — **burst-detector**: campo che distingue picco
  transiente (rate recente ≪ media 2h) da over-pace sostenuto → consente recovery rapido.
- **dev3**: `.launcher/agent-watchdog.sh`/`doctor-watchdog.sh` — auto-scadenza del freeze weekly.
- **dev1**: `agents/capitano/capitano.md` C-07/C-09 — scala il FRENO al runway (no freeze con
  weekly basso/mensile alto), usa il burst-flag per rientrare prima.
- **dev2**: `agents/sentinella/sentinella.md` S-06/S-07 — non emettere freeze duro su picco
  transiente; usa il burst-flag.

## 🟡 P4 — non_producing falsi positivi (task lunghi)
Il KILL+respawn (C-12) scatta su agenti impegnati in 1 task lungo (enrichment) scambiati per idle.
- **dev3**: `.launcher/pacing-bridge.py` — il gate non_producing distingue "spinning a vuoto" da
  "su 1 task pesante" (position-id in lavorazione / finestra più lunga) prima del verdetto KILL.

## 🟡 P5 — totalQuota Kimi (tetto MENSILE) non monitorato
Vediamo solo 5h + weekly, non il pacchetto mensile che CONGELA Kimi Code a esaurimento.
- **dev3**: `fetch_kimi_api` — legge `totalQuota.remaining`, lo propaga nel sample.
- **dev2**: `tool_health`/tick — espone `MONTHLY-QUOTA rem=X%` + alert sotto soglia.

## ⚪ Minori
- **dev3**: sample `weekly_active_hours=None` → popolarlo o documentarlo (check web-UI).
- skill `expiration-tracking` "out of scope" → completare (confluisce in P1).

## Spartizione (sintesi)
| Owner | Fette |
|---|---|
| **dev3** | P1 skill `recheck-liveness` · P3 burst-detector weekly_pace + freeze-expire watchdog · P4 non_producing · P5 fetch_kimi_api totalQuota · minori |
| **dev1** | P2 scout.md · P3 capitano.md (scale-brake-to-runway) |
| **dev2** | P1 analista.md (usa recheck-liveness) · P3 sentinella.md · P5 tool_health/tick totalQuota |

Metodo: implementa → py_compile/test → cross-review a 3 → consolida in 1 branch → utente merge → redeploy → osservazione read-only.
