# 🧠 Tassonomia `role_family` resa BRAIN-DRIVEN — recon, redesign, deploy

**Data:** 2026-06-20 · **Stato:** ✅ **IMPLEMENTATO + DEPLOYATO + betaA RESETTATO** ·
**Branch:** dev3 → master `8f863fe57` · **Immagine:** `ghcr.io/leopu00/jht@sha256:e53f382ba71a…` ·
**VPS:** betaA (`203.0.113.10`, codex) + betaB (`203.0.113.20`, kimi) ·
**Correlati:** corregge `2026-06-16-betaA-taxonomy-collapse-finding.md` (§5 sbagliato, vedi sotto),
`agents/_team/role-taxonomy.md` (MODELLO).

> **In una frase:** prima un pass automatico decideva le categorie **contando stringhe identiche** e non
> promuoveva mai nulla → tutto fermo in `Other`. Ora le categorie le decidono gli **analisti col
> giudizio** (promuovono dai grappoli in `Other`) con il **Capitano come arbitro** (split/merge). Lo
> string-pass è stato rimosso.

---

## 1. 🎯 Da dove si parte

Il deploy del 15/06 (tassonomia emergente) aveva fatto **collassare** betaA a 1 sola categoria
(`Business & Operations`). Il fix judge-first (16/06, `2026-06-16-betaA-taxonomy-collapse-finding.md`)
ha **fermato l'emorragia** (l'analista non dumpa più nel catch-all), ma l'utente il 20/06 ha mostrato
che le offerte nuove finivano in massa in **`Other`** (es. "M&A Mid-Market Analyst" → `Other`,
"Credit Risk Analyst" → `Other`). Domanda dell'utente: *perché ruoli ovvi non vengono categorizzati?*

**Vincolo dell'utente (ribadito):** gli analisti hanno un cervello, non devono affidarsi a "script di
merda che funzionano male"; la decisione su quali categorie esistono e dove va un'offerta deve essere
**giudizio degli agenti**, e il **Capitano deve arbitrare** (split di categorie troppo grandi, merge di
duplicati), **bounded** (un giro, decidi, avanti — niente loop). Zero liste hardcoded.

---

## 2. 🔬 Perlustrazione (3 subagenti, SOLA LETTURA, su entrambe le VPS)

Prima di toccare codice: 3 subagenti hanno letto le trascrizioni reali (scrollback tmux, `messages.jsonl`,
`position_state_transitions`, `dottore-captures/`, DB). Esiti **dirimenti**:

### 2.1 L'analista LLM NON è il problema
ANALISTA-6 (gpt-5.5) segue il judge-first alla lettera. Catture live #376/#377: nomina la famiglia →
legge `active-categories` (menù a 2 voci) → nessuna combacia → `Other` + proposta corretta, **evitando**
il catch-all. DB: **dal deploy 18/06 20:56 → ZERO** scritture in `Business & Operations`. Le 18 in
`Other` hanno **tutte e 18** una proposta corretta ("M&A Analyst" → "Investment Banking / M&A Advisory",
"Credit Risk" → "Credit Risk / Credit Analytics", "VC Analyst" → "Venture Capital Investing"). **Il
cervello categorizza bene.**

### 2.2 Il collo di bottiglia era il PASS DI PROMOZIONE a stringhe
`role_registry.run_pass` (hook ~1h in `sentinel-bridge.py`, `PROMOTION_PASS_EVERY_N_TICKS=12`)
raggruppava le proposte per `normalize_key` (stringa identica) e promuoveva a **soglia 5**. Le proposte
sono **micro-varianti di superficie** ("VC Investing" vs "VC / Growth Investing"; "IB / M&A Advisory"
vs "Transaction Advisory / M&A") → `normalize_key` le tiene separate → **cluster max = 4**, sotto soglia
→ **0 promozioni a ogni giro** (dry-run live: `promosse: nessuna`). Quindi: l'analista propone giusto,
ma **niente diventa mai una categoria** → tutto resta in `Other` per sempre. `Corporate Finance / FP&A`
si è promossa solo **per fortuna** (abbastanza offerte hanno scritto quella stringa identica → 12 ≥ 5).

### 2.3 Comunicazione tassonomia tra agenti = ZERO; arbitrato Capitano = ZERO
Grep su `messages.jsonl` + `bridge-mailbox.jsonl` + scrollback CAPITANO: **nessun** analista↔analista,
**nessun** analista↔capitano sulle categorie; il Capitano non emette **mai** un verdetto su
split/merge. Mancava completamente l'attore che consolida/arbitra.

### 2.4 🔑 CORREZIONE: betaB NON aveva "legacy pulito"
Il finding del 16/06 (§5) diceva "betaB funziona perché aveva legacy pulito e diversificato". **I dati
lo smentiscono:**
- Le **12 categorie pulite di betaB nascono TUTTE nello stesso istante `2026-06-15 14:57:19`** — non
  emerse nel tempo. È un **evento di ri-categorizzazione di massa MANUALE**: un singolo analista
  (`analista-4`) ha lavorato un backlog di 113 posizioni e allineato ~360 offerte a ~12 nomi canonici
  in poche ore (chat: *"Normalized role_family to canonical…"*, *"role_family backlog completato: 0
  uncategorized"*).
- Il legacy di betaB era **frammentato come betaA** (30 etichette, 0 cluster ≥5). Stesso punto di
  partenza.
- Kimi **non** è più consistente di Codex (continua a coniare 15 varianti dopo il cleanup).

→ **betaB è pulito perché un agente ha fatto il lavoro a mano** — comportamentale, **fragile** (foto
congelata), stesso codice e stesso rischio latente. Esattamente ciò che il redesign rende
**sistematico, a cervello e arbitrato**.

---

## 3. 🛠️ Il redesign (codice su dev3, commit `89abcd4ac` + `db4bb4143` + `f37bf0311` + `59a9610ce`)

### Nuovo ciclo di vita
```
offerta → [analista] giudica la famiglia, riconcilia col registro PER SIGNIFICATO:
            match attiva → role_family = nome attivo
            nessuna      → role_family = 'Other' + role_family_proposed = etichetta
                              ↓
          [analista, GIUDIZIO] ~3+ simili in 'Other' (anche varianti di superficie) →
            promuove lui la famiglia (role_registry.py promote --ids) → categoria ATTIVA, ri-tagga
                              ↓
          [Capitano, ARBITRO C-17] categoria >~25 che nasconde sottofamiglie → SPLIT;
            due attive = stessa famiglia → MERGE (role_registry.py merge). Un giro, bounded.
```

### File toccati
| File | Modifica |
|---|---|
| `shared/skills/role_registry.py` | **+ `promote_family(name, ids)` / `merge_families(sources, into)`** (l'agente dà nome+membri a giudizio, il codice esegue; niente soglia/normalize_key nel percorso decisionale). CLI a sottocomandi `promote`/`merge`/`pass`. Il vecchio `run_pass`/`promote` (string-clustering) **demoto a `pass`** = sola diagnostica (default dry-run). |
| `shared/skills/db_query.py` | **+ `other-pile`** (le `Other`+proposta da raggruppare) **+ `category-sizes`** (dimensione live → trigger split). |
| `agents/analista/analista.md` (step 8) | scout = solo indizio (re-deriva dalla JD); match per **significato**; se `Other` → `other-pile`, ~3+ simili → **`promote` lui**; categoria >~25 → **consulto al Capitano**. |
| `agents/capitano/capitano.md` | **+ C-17 — Arbitro della tassonomia**: verdetto split/merge su consulto dell'analista o di sua iniziativa (`category-sizes`); merge lo esegue lui; bounded (anti-loop C-14). + riga skill-index. |
| `agents/_team/role-taxonomy.md` | Modello riscritto: `Other` = parcheggio → grappolo→famiglia a giudizio → troppo grande→split arbitrato; il **merge è ora IMPLEMENTATO** (non più "future LLM"); auto-bootstrap/guard segnati come legacy. |
| `.launcher/sentinel-bridge.py` | **RIMOSSO** l'auto-pass periodico (`_run_promotion_pass` + boot-bootstrap + `PROMOTION_PASS_EVERY_N_TICKS`). |

NB **C-17** (non C-16): la C-16 è stata presa da `email-monitor` di dev1.
NB **i18n**: le varianti `.it/.de/.es/.fr/.hu/.pt` di analista/capitano sono **da allineare**
(follow-up); betaA+betaB girano `locale=en` → caricano il base EN modificato (non blocca).

### Test
Primitive + helper testati end-to-end su DB sintetico: l'analista fonde a giudizio "M&A Advisory" +
"Transaction Advisory / M&A" in una famiglia, il Capitano fonde near-duplicate, tutti i guardrail
rifiutano (nome vuoto / no membri / "Other"). `py_compile` OK su bridge + skills.

---

## 4. 🚀 Deploy + reset betaA (runbook eseguito 2026-06-20 ~20:50 UTC)

L'utente ha mergiato dev3→master (`8f863fe57`); CI verde incluso **Docker — Build & push** → nuovo
`:latest = sha256:e53f382ba71a…`.

**Ordine corretto:** prima il **codice nuovo** (che NON ha più l'auto-pass), poi il **reset** — altrimenti
il vecchio auto-pass avrebbe ri-seminato il catch-all dal legacy.

**Per ogni VPS** (gotcha disco-pieno [[project_vps_redeploy_disk_full_gotcha]] → `docker image prune -f`):
1. `docker image prune -f` (pre-pull) → `cd /root/.jht/runtime && docker compose pull`.
2. **Verifica codice baked nella nuova immagine PRIMA di ricreare**:
   `promote_family=3`, `merge_families=1`, `other-pile=4`, `_run_promotion_pass=0`, `C-17=2`.
3. `docker compose up -d` → verifica digest live `e53f382b` + `working_hours` intatte → `docker image prune -f` (rimuove la vecchia `028e64`, −1.15 GB).

**betaA — reset chirurgico** (team OFF/idle, DB quiescente, 0 worker tmux):
- Backup reversibile: `/jht_home/logs/taxonomy-reset-betaA-backup.json` (240 ids B&O + registro completo).
- `DELETE FROM role_family_registry WHERE name='Business & Operations' AND user_id='local';`
- `UPDATE positions SET role_family=NULL, role_family_proposed=NULL WHERE role_family='Business & Operations';` (240 righe).
- **Esito:** registro = solo `Corporate Finance / FP&A` 12; `B&O` = 0; **259 "da categorizzare"**; 88
  granulari TENUTI (drift, si auto-fondono col codice nuovo, conservano l'indizio); coda
  `next-for-categorize` ≈ 224.
- **Reversibile:** ri-creare la riga registro + ri-taggare i 240 ids dal backup.

**betaB — NON toccato** (sano: 12 categorie, support 510 INTATTO). Deploy del solo codice. È il **banco
di prova** del nuovo arbitro.

---

## 5. 🔭 Cosa osservare (dai cicli di domani)

- **betaA** (riparte 08:00 Rome, turno giorno): le ~224 da ri-categorizzare convergono verso le **~7-9
  famiglie reali** che i dati già contengono (IB/M&A ≥11, Credit ≥18, Infra ≥8, VC ≥7, PE ≥6,
  Corp Finance 12, Public Markets)? L'analista promuove dai grappoli?
- **betaB** (riparte 20:00 Rome, turno notte): il **C-17 splitta da solo `Engineering (Other)` 104**?
  È un semi-catch-all che mescola **Document Control** (rilevante: Document Controller, "Ufficio/Segreteria
  Tecnica", scattered anche nel drift) + **ingegneria off-profile** (CNC, CAD, Manufacturing, Civil, BIM).
  Se il Capitano lo splitta → **prova che l'arbitro funziona** su un team sano senza intervento; se non
  lo fa entro un giorno → nudge / reset di quel **solo** bucket. `Technical Writing` 220 invece è una
  famiglia vera sola (multilingue) → "keep".
- **i18n**: allineare le 6 traduzioni di analista/capitano allo step 8 + C-17.

**Principio:** betaB si **osserva**, non si tocca ([[feedback_no_intervention_in_simulations]]);
betaA è stato riparato perché aveva un catch-all rotto (azione richiesta dall'utente).
