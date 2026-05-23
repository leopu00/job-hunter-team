# Simulazione 3 — location enrichment su profilo Python Developer

Data: 2026-05-23
Container: `jht-sim-d2` (reset totale via `sim-reset.sh`)
Profilo: Leone Emanuel Puglisi (`info@jobhunterteam.ai`) — Python Developer
junior, Roma, 1 anno esperienza, skills Python/SQL/ML/Git.
Dataset: 249 record (251 - 2 skip per CHECK constraint company > 300 char).

Differenze setup vs sim 2:
- Profilo **completamente diverso** (dev junior vs technical writer senior)
- Dataset **diverso** (251 record di leopu00 vs 206 di leone.puglisi)
- Container ricreato da zero via `sim-reset.sh --total`
- Prompt analista **refactored** A+B (skill location-enrichment lazy-load,
  4 regole comportamentali R12-R15 in cima al prompt)

## Risultati

- **249/249 processati**: 224 `checked` + 25 `excluded`
- Tempo: ~45 min (più lento delle precedenti, batch più grandi)
- Anti-collision: perfetta (range 1-83 / 84-166 / 167-249, zero overlap)
- **226/251 sincronizzati su Supabase prod** (i 25 excluded non hanno role_family)

## Confronto qualità sim 1 vs sim 2 vs sim 3

| Metrica | sim 1 | sim 2 | sim 3 |
|---|---:|---:|---:|
| `role_family` NULL su checked | 0 | 0 | **0** |
| `work_mode` NULL | 0 | 0 | **0** |
| `work_country` NULL | 3 | 0 | **0** |
| `loc_continent` NULL | 2 | 0 | **3** |
| **`role_family` unici** | **24** | **9** | **12** |
| Profilo candidato | Tech Writer | Tech Writer | Python Dev |

R15 (mai NULL work_country) ha tenuto, R14 (peer lookup) ancora efficace
ma "Backend" vs "Backend Engineering" è ricomparso brevemente prima di
consolidarsi. Sim 3 ha avuto 12 famiglie finali vs 9 di sim 2 perché il
profilo dev ha più sotto-domini (DevOps, Cloud, Security, QA, Frontend)
che il profilo Tech Writer non aveva.

## Tassonomia finale (12 famiglie, profilo Python Dev)

```
 80  Backend                  ← dominante (Python backend è target_role)
 29  Software Engineering     ← generalisti
 27  Company Learning
 26  Full Stack
 21  Data Engineering
 12  Data Company
  8  Data Analytics
  6  DevOps
  6  Cloud
  5  Security
  4  QA
  2  Frontend
```

Tassonomia **completamente diversa da sim 2** (Tech Writing, CAD/CNC,
Manufacturing, Localization). La skill `location-enrichment` non
hardcoda categorie — emergono dai dati e dal target_role del candidato.

## Standardizzazione paesi (ISO English)

```
149  Italy             ← dominante (candidato Roma)
 20  United Kingdom    ← Company 033, Treasury Spring, ecc.
 12  Poland            ← justjoin.it Polonia
  7  Spain
  5  United States     ← contractor remote
  3  Portugal, Company
  2  Netherlands
  + altri singoli: Switzerland, Romania, Lithuania, Israel, Ukraine,
    South Africa, Estonia, France
```

## work_country = US per remote in EU da aziende US (R15 funziona)

```
 7  record con work_country=United States
    (Company 033 UK, Gr4vy, Rinse, SerpApi, MixRank, Fliff, Axle, ...)
```

L'analista ha distinto correttamente il paese fisico del candidato
(Italia, da cui lavora) dal paese contrattuale dell'entity che firma
(es. Gr4vy US, Fliff US, Axle US → contractor pagato USD).

## Casi edge gestiti

- "Junior Python Developer Company in London, London, City Of" (company 392
  char): skippato al seed import per CHECK constraint, **escluso dalla
  simulazione** (input grezzo malformato)
- ION Group, Bending Spoons, Sisal: multi-sede italiane → 1 pin Roma
  + is_multi_location=true + location_notes con città disponibili
- Company 033 (HQ UK): tutti i loro 8+ remote postings → work_country=UK
- Twilio Estonia "Estonia-based candidates only": esclusione corretta
  (GEO), JD da non considerare
- Affirm Spain/Poland-only: work_country=Spain/Poland (entity locale)

## Sync verso Supabase prod (leopu00)

| metrica | valore |
|---|---:|
| Record total leopu00 in Supabase | 251 |
| Wipati pre-sim (office_*, role_family, loc_*, work_*) | 251 |
| Sincronizzati post-sim | 226 |
| Non sincronizzati (excluded senza role_family) | 25 |

Sync limitato a `info@jobhunterteam.ai` via filtro `user_id`. Verificato
post-sync che `leone.puglisi` (206/206 da sim 2) e `beta-user2` (0)
sono intatti.

Campi sovrascritti: solo `role_family`, `loc_*` (5 colonne), `work_*`
(3 colonne), `is_multi_location`, `location_notes`. NON toccati:
`status`, `notes` (stato applicativo reale dell'utente), `office_*`
(da geocodare in un eventuale step successivo).

## Conclusioni

La pipeline `scout → sim container → analyst team → sync prod`
funziona end-to-end per profili diversi. La skill
`location-enrichment` mantiene la qualità tra profili eterogenei
(tech writer ↔ python dev) senza modifiche al codice.

Prossimo step opzionale: geocoding office-precise per leopu00 (al
momento sono solo NULL — non è critico per la dashboard se basta il
centroide loc_country).
