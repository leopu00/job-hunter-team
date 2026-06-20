# 🕳️ Tassonomia emergente — collasso a 1 categoria su betaA (finding)

> ⚠️ **AGGIORNAMENTO 2026-06-20 — leggere PRIMA `2026-06-20-taxonomy-brain-driven-redesign.md`.**
> Il fix judge-first qui descritto (Mosse 1+2) ha fermato il collasso ma le offerte finivano poi in
> massa in `Other` perché il **pass di promozione a stringhe non promuoveva mai** (rootcause vera).
> Una perlustrazione del 20/06 ha **SMENTITO il §5 di questo doc**: betaB NON aveva "legacy pulito" —
> le sue 12 categorie nascono tutte in un istante = un **bulk-recategorize MANUALE** una-tantum (stesso
> legacy frammentato di betaA). La tassonomia è stata resa **brain-driven** (analista promuove dai
> grappoli + Capitano arbitro C-17, auto-pass RIMOSSO), deployata, e betaA è stato resettato. Dettagli
> nel doc del 20/06.

**Data:** 2026-06-16 · **VPS:** betaA (`203.0.113.10`, provider codex/gpt-5.5, user_id `9996e20c`) ·
**Lane fix:** dev1 (prompt analista) + dev2 (`role_registry.py` / bootstrap). · **Modalità:** SOLA
LETTURA (nessun intervento sul team — [[feedback_no_intervention_in_simulations]]). ·
**Correlati:** `agents/_team/role-taxonomy.md` (MODELLO), `2026-06-15-taxonomy-upstream-fix-e-domain-gaps.md`
(storico), `analista.md` RULE-13 + step 8.

---

## 1. 🎯 L'evento

Dopo il deploy della **tassonomia emergente** (master `73429e3a1`, `:latest`, deploy 2026-06-15), la
verifica di ripresa (2026-06-16) trova betaA **collassato a UNA sola categoria attiva**:

```
## CATEGORIE EMERGENTI (registro attivo)   betaA
   attive=1
    192  Business & Operations
   dormant=0  Other(pos)=0
```

Su 302 posizioni: **192** in `Business & Operations` (catch-all), **18** NULL, **92** legacy
finance ancora granulari (non-attive, non-Other), **0** in `Other`, **0** proposte
(`role_family_proposed` sempre NULL). Contrasto con **betaB/Kimi** (stesso codice): 12 categorie
attive STABILI, 0 drift, `Other`=6 → lì il modello funziona come da disegno.

L'obiettivo direzionale (~5-8 famiglie significative) NON è raggiunto: betaA **non consolida verso
5-8, diverge verso 1** — e peggiora nel tempo (vedi §4.3).

## 2. 🔬 Evidenza runtime (scrollback `ANALISTA-2`)

Per ogni posizione la sequenza dell'analista (gpt-5.5) è **identica e meccanica**:

```
• Ran db_query.py active-categories
  └ Business & Operations                    # menù = 1 sola voce
• Ran db_update.py position 302 --role-family "Business & Operations" ...
  └ role_family=Business & Operations, role_family_proposed=NULL
```

Categorizza così anche ruoli di dominio palesemente diverso:
- #302 **"Pricing of Exotic Derivatives Analyst"** (quant/pricing) → `Business & Operations`
- #301 **"Sales Management Analyst, Institutional COO"** → `Business & Operations`
- #300 **"Prime Risk US Management"** (risk) → `Business & Operations`

**Nel ragionamento NON c'è una riga** del tipo *"dominio diverso → propongo una famiglia nuova"*.
Il ragionamento è tutto su liveness / degree / salary fit. **Non c'è alcuna deliberazione collettiva**:
gira un solo analista, legge l'unica attiva, esegue.

## 3. ⚠️ Chiarimento: `active-categories` NON è un classificatore

Equivoco da sfatare (è emerso a caldo): `db_query.py active-categories` **non parsa la JD, non decide
la categoria, non classifica nulla**. È una `SELECT` di una riga (`db_query.py:697-706`):

```python
elif args.cmd == 'active-categories':
    names = active_categories(conn, args.user_id)   # SELECT name FROM role_family_registry WHERE status='active' ORDER BY support_count DESC
    for n in names:
        print(n)
```

Stampa solo il **menù** delle categorie già nel registro. Su betaA quel menù ha **una voce**. Chi
**decide** la categoria di un'offerta è **l'LLM analista** (la cosa più intelligente del giro), non lo
script. Anche `normalize_key` (`role_taxonomy.py`) è surface-only (lowercase/trim/token-sort) e **non
classifica** — collassa solo varianti di superficie, ed è surface-only **per scelta** (una mappa di
sinonimi = hardcoding, vietato dall'utente).

→ Il bug **non** è "uno script stupido sceglie la categoria". Il bug è che **un analista intelligente
abdica al giudizio** e si infila in un menù degenere perché il **prompt** glielo ordina.

## 4. 🧩 Meccanismo-radice (3 cause che si compongono)

### 4.1 Prompt monodirezionale (lane dev1)
`analista.md` RULE-13 (riga 146) + step 8 (righe 186-187) HANNO il ramo *"if none genuinely fits →
write your own concise label → Other + proposal"*. Ma non scatta **mai**, per due istruzioni:
- *«if the offer belongs to one of them, write that exact active name»* + un seed **massimamente
  largo** (`Business & Operations` inghiotte qualunque ruolo finance) → *"none genuinely fits"* è
  **sempre falso** → ramo-proposta morto.
- tutta la pressione direzionale è *"aggrega / propend-broader / ~5-8 come tetto"* (anti-esplosione,
  nato per il problema betaB-48). **Manca la spinta opposta**: *"se sei SOTTO 5-8 e le attive sono
  poche/larghe → PROPONI più fine"*. Da uno stato mono-categoria l'analista **non sa risalire**.

### 4.2 Il bootstrap ri-semina un legacy GIÀ collassato (lane dev2)
`role_registry.py:find_clusters` clusterizza i `role_family` legacy per `normalize_key` e promuove solo
i cluster ≥ soglia (5). betaA **pre-tassonomia** aveva già un mega-bucket free-text
`Business & Operations` ×175 (l'analista vecchio collassava già lì) + ~63 etichette finance granulari
da 1-4 occorrenze. Risultato: il bootstrap promuove **solo** il mega-bucket (unico ≥5) e ignora le 63
granulari (ognuna sotto soglia). **Garbage-in/garbage-out**: ha fotografato il collasso preesistente e
l'ha reso "ufficiale" come unico seed. (Il modello `role-taxonomy.md` §cold-start(b) assumeva legacy =
valori comuni *puliti* tipo "Backend Engineering ×116"; non aveva previsto legacy = **un catch-all
pigro che aveva già inghiottito tutto**.)

### 4.3 Il self-heal guarisce VERSO il collasso
`next-for-categorize` ri-accoda il drift (le 92 legacy granulari: non-attive, non-Other) all'analista
perché le ri-categorizzi. Ma l'analista le **fonde in `Business & Operations`** (stesso §4.1). Quindi
l'auto-correzione **divora** la granularità finance: nel tempo le 92 finiranno tutte nel mega-bucket.
Le 92 surface-distinte non promuovono mai (`normalize_key` surface-only, ognuna <5) e la sorgente
sentinella del pass è vuota (`proposed` sempre NULL) → **il pass è affamato, non nasce nulla**.

## 5. 🪞 Perché betaB funziona e betaA no

| | betaB / Kimi | betaA / codex |
|---|---|---|
| Legacy al bootstrap | 12 cluster ≥5 **diversi** (Technical Writing 170, Localization 30, QA 19…) | **1** mega-bucket ≥5 (`Business & Operations` 175) + 63 granulari <5 |
| Seed risultante | menù diversificato → l'analista ha scelte reali | menù = 1 voce larghissima → attrattore |
| Esito | 12 attive stabili, 0 drift | collasso a 1, granularità divorata |

Il modello emergente **dipende dalla qualità del legacy al bootstrap**: con un legacy pulito-e-vario
emerge bene; con un legacy già-collassato si auto-perpetua il collasso.

## 6. 🛠️ Leve di fix (finding per il CODICE — non implementato, decisione utente)

Non rimuovere il registro/menù: **toglierlo = tornare ai 48 frammenti** che il sistema doveva
eliminare. La direzione è **ribaltare chi comanda** (giudizio analista *propone/decide*, registro/guard
= paletti):

1. **Prompt bi-direzionale** (dev1, `analista.md`): aggiungere la spinta opposta — *"se le attive sono
   < ~5 e larghe/generiche, NON fidarti del menù: proponi una famiglia più specifica invece di
   fondere"*. Modifica solo-prompt, nessuna migrazione dati. **Leva più economica.**
2. **Bootstrap che non re-semina un catch-all dominante** (dev2, `role_registry.py`): se l'unico
   cluster ≥soglia è un mega-bucket generico che copre la maggioranza, **non promuoverlo come seed
   unico** (o ri-aprirlo a categorizzazione fine), altrimenti riproduce il collasso del legacy.
3. **Consolidamento semantico del long-tail** (dev1+dev2): le 92 granulari finance sono famiglie
   *vere* ma surface-distinte; serve la promozione semantica LLM-assistita (citata come "v2 future" in
   `role-taxonomy.md`) oppure che l'analista, sul drift, mappi a famiglie fini **condivise** invece che
   al mega-bucket.

## 7. ✅ Implementazione (2026-06-16, branch `dev3` — merge in master = utente)

Implementate **Mossa 1** (prompt) + **Mossa 2** (codice). La Mossa 3 (riparazione) è un runbook di
deploy, non codice.

**Mossa 1 — judge-first (lane dev1).**
- `agents/analista/analista.md`: step 8 del MAIN LOOP riscritto in sequenza esplicita — (1) **NAME IT
  FIRST** (l'analista nomina la famiglia di tuo giudizio PRIMA di leggere il menù), (2) **THEN
  reconcile** con `active-categories` (match solo se è la STESSA famiglia, altrimenti proponi), (3)
  **NEVER fold a distinct role into a broad catch-all**. Paletto reso **bi-direzionale** (sotto ~5-8 e
  attive larghe → proponi più fine, non aggregare). RULE-13(a) aggiornata di conseguenza.
- `agents/_team/role-taxonomy.md`: lifecycle §2 + cold-start §(b) allineati (i due failure simmetrici:
  esplosione vs collasso; il catch-all è residuo, non una casa).

**Mossa 2 — guard anti catch-all (lane dev2).**
- `shared/skills/role_registry.py`: `_detect_catchall_seed(clusters, active_key_map, threshold)`
  (funzione PURA) + integrazione in `promote()` (nuovo esito `catchall-skip`). **Bootstrap-gated**
  (scatta solo a registro vuoto) + **auto-limitante** (con ≥2 famiglie reali non scatta). Costanti
  `CATCHALL_DOMINANCE=0.35`, `CATCHALL_TAIL_MIN=8`. **Test:** `tmp/test_catchall_guard.py` 11/11 —
  sopprime betaA-like, NON tocca betaB-like (12 famiglie) né un mono-famiglia genuino (coda <8).

## 8. 🚀 Runbook deploy + riparazione (gated all'utente — deploy/infra)

Le modifiche sono **going-forward**: il guard è bootstrap-gated, quindi su betaA LIVE (registro già
contenente il lone catch-all) **non scatta da solo**. Due livelli:

1. **Minimo (stop the bleeding):** build `:latest` + redeploy betaB + betaA. Effetto immediato: la
   Mossa 1 ferma il collasso: l'analista smette di fondere nel mega-bucket, e le **92 drift** legacy
   vengono ri-categorizzate in famiglie fini → nuove categorie emergono. Le **192** già dentro
   `Business & Operations` (categoria ATTIVA) restano lì (non sono drift → non ri-accodate).
2. **Riparazione completa (redistribuisce le 192):** dopo il deploy, **una-tantum** resettare il
   registro POLLUTO di betaA (tabella META, non dati posizioni):
   ```sql
   DELETE FROM role_family_registry WHERE user_id = '9996e20c-0223-433b-9d37-a04ccb77b299';
   ```
   → registro vuoto → al prossimo pass di promozione il **guard sopprime** il re-seed del catch-all →
   cold-start → `next-for-categorize` ri-accoda TUTTE le 302 (le 192 ex-`Business & Operations`
   diventano drift) → l'analista **judge-first** le ri-categorizza nelle ~7 famiglie reali → il pass
   promuove i cluster ≥5 (ora le etichette sono consistenti → clusterano davvero). Costo: ~300
   ri-categorizzazioni (pass economico), pagato dal team, **nessun UPDATE sui dati posizioni**.

NB betaB **non** va resettato: registro sano a 12, il guard non scatta, la Mossa 1 la rende solo più
incline a proporre (innocuo). Verificare immagine con `_detect_catchall_seed` baked PRIMA di `up -d`
([[project_vps_redeploy_disk_full_gotcha]]: `docker image prune -f` dopo il pull).

## 9. 📌 Stato

- **Nessun intervento** sui container: betaB + betaA restano UP e LAVORANO (sola lettura rispettata).
- Codice pronto su `dev3`. Deploy + reset registro betaA = **decisione/azione dell'utente**
  ([[feedback_master_merge_user_only]] + deploy gated).
