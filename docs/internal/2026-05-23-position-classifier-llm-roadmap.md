# Roadmap: classificatore posizioni → LLM-driven (no hardcoded taxonomy)

Data: 2026-05-23
Owner: team backend / data
Stato: parcheggiato, da pianificare con il team

## Problema

`web/lib/position-classifier.ts` contiene una tassonomia regex hardcoded
progettata per profili **software dev** (ai_ml, devops_cloud, frontend, …).
Il sistema serve invece candidati con `target_role` arbitrari (technical
writer, CAD/CNC, translator, QA, content, customer support, …): per questi
profili la tassonomia software è inadatta e 80 %+ dei titoli cadono in
"Other".

Caso reale `leone.puglisi@gmail.com` (143 posizioni non-excluded):

| Famiglia data-driven                | n  | %      |
| ----------------------------------- | -- | ------ |
| Technical Writing / Documentation   | 72 | 50.3 % |
| CAD / CNC / Manufacturing           | 33 | 23.1 % |
| Other technical / Specialist        | 13 |  9.1 % |
| Translation / Localization          |  9 |  6.3 % |
| Quality / QA / Testing              |  6 |  4.2 % |
| Unclassified                        |  4 |  2.8 % |
| Content / Marketing                 |  3 |  2.1 % |
| Customer Support                    |  2 |  1.4 % |
| Software / Tech (dev side)          |  1 |  0.7 % |

Con tassonomia attuale software-dev: 81 % Other, 15 % Software Eng.

## Stato 2026-05-23 — schema DB pronto, classifier rimosso

Migrazione applicata al progetto Supabase `smittwvohsnwwwisqdrh`:

```sql
ALTER TABLE positions ADD COLUMN role_family text;
CREATE INDEX idx_positions_role_family ON positions(role_family)
  WHERE role_family IS NOT NULL;
```

`web/lib/position-classifier.ts` è stato **svuotato delle regex e dei
PositionType enum**: ora espone solo `aggregateRoleFamilies()` e
`colorForFamily()` (HSL deterministico dal nome). `web/lib/queries.ts` e
`web/lib/local-queries.ts` leggono `positions.role_family` direttamente,
senza dedurre dal title. `web/lib/dashboard-i18n.ts` non ha più chiavi
`pt_*`: l'etichetta dello slice è il valore di `role_family` (già
leggibile, scritto dall'analista).

**Backfill simulato** dell'output del team analyst eseguito una volta via
SQL solo sull'utente `leone.puglisi@gmail.com` (143 posizioni). Le regex
del classifier vecchio sono confluite *nella query SQL di backfill*, non
sono più nel codice runtime. Tutti gli altri utenti (`leopu00`,
`bartoscar97`) hanno `role_family = NULL` → la dashboard li raggruppa
sotto "Da categorizzare" finché il team non li classifica.

Quello che manca (questa nota): **come si popola `role_family` in modo
sostenibile**, cioè il workflow del team.

## Soluzione target: niente categorie hardcoded

La tassonomia deve essere **derivata dai dati / dal profilo del
candidato**, non scritta nel codice. Tre approcci proposti, da valutare e
sceglierne uno.

### Opzione A — Tassonomia generata dal `target_role` del candidato

Un LLM (Kimi è già nel team) legge `candidate_profiles.target_role` e
restituisce 5-8 categorie semantiche per quel candidato. Il classifier
applica le categorie al volo (o batch) sui titoli.

- **Pro**: zero codice da mantenere; scala su qualunque profilo; coerente
  con il "target_role" dichiarato.
- **Contro**: serve cache della tassonomia (`candidate_profiles.taxonomy
  jsonb`) e fallback se LLM è down; ricalcolare a ogni cambio di
  target_role.
- **Sforzo**: M. Migration + 1 endpoint LLM + 1 worker che invalida cache
  quando cambia `target_role`.

### Opzione B — Classificazione per-title via LLM all'ingestion

Quando una position viene creata, un LLM (Kimi/scout) assegna
`positions.role_family` (nuova colonna text) UNA volta. La dashboard
legge solo aggregate, niente classificazione runtime.

- **Pro**: deterministico, query rapidissime, niente regex nel codice.
- **Contro**: serve migration + backfill (~143 righe per utente, fattibile);
  cambiare lo schema delle famiglie significa reclassify batch.
- **Sforzo**: M-L. Migration + scout patch + backfill script.

### Opzione C — Clustering data-driven su embeddings

Embedding dei title (via Kimi o provider esterno), poi clustering
(k-means / HDBSCAN); LLM genera label per ogni cluster dal centroide.

- **Pro**: nessuna lista di categorie a priori, vere "categorie
  emergenti".
- **Contro**: i cluster cambiano ad ogni nuova posizione → UX instabile;
  più complesso da debuggare; serve infra embedding.
- **Sforzo**: L. Embeddings + clustering job + recompute periodico.

## Raccomandazione

Iniziare con **Opzione A** (tassonomia per candidato). È quella che
sfrutta meglio l'unico segnale forte già nel DB (`target_role`), è
incrementale, e non richiede backfill: applichi la classificazione al
volo, e cachi solo l'output della tassonomia (non i singoli match).
Opzione B come step 2 quando la dashboard cresce e l'overhead runtime
diventa misurabile.

## Materiale di partenza

- Tabella `candidate_profiles` ha già `target_role` (text) e `skills`
  (jsonb, attualmente NULL per i candidati testati).
- Tabella `position_highlights.type` esiste come colonna ma è vuota — può
  essere riusata come destinazione per Opzione B senza migration.
- Kimi è il writer principale del team (`docs/adr/0003-single-writer-team.md`).
  Aggiungere un "classifier" come ruolo del team (scout/critic spawn-on-demand
  vs writer dedicato) è una scelta del team.

## Out of scope di questa nota

- Refactoring di `dashboard-i18n.ts` per supportare label dinamiche
  (servirà per Opzione A; oggi le label sono statiche IT/EN/HU).
- UI: il `PositionTypesPie` accetta già `labels` come prop record; basta
  iniettare le label dalla tassonomia per-candidato senza modifiche al
  componente.
