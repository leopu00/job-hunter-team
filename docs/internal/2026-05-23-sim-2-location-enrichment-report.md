# Simulazione 2 — location enrichment con i fix applicati

Data: 2026-05-23
Container: `jht-sim-d2` (resettato dopo sim 1, stesso dataset 206 record vergini)
Profilo: Marton Kovacs (technical writer/translator, CAD-CAM/CNC)
Fix applicati prima di sim 2 vs sim 1:

- REGOLA-09b: una posizione alla volta (no batch)
- REGOLA-09c: peer DB lookup periodico su `role_family`
- REGOLA-09d: fallback `work_country` se "unverifiable", mai NULL su `checked`

## Risultati

- **206/206 processati**: 193 `checked` + 13 `excluded`
- Tempo: ~30 min (vs ~7 min sim 1 — più lenta ma qualità superiore)
- Anti-collision: perfetta (range disgiunti 1-69, 70-138, 139-206, zero overlap)

## Confronto sim 1 vs sim 2

| Metrica | sim 1 | sim 2 | trend |
|---|---:|---:|---|
| `role_family` NULL su checked | 0 | **0** | = |
| `work_mode` NULL | 0 | **0** | = |
| `work_country` NULL | 3 | **0** | ✓ R09d |
| `loc_continent` NULL | 2 | **0** | ✓ |
| **`role_family` unici** | **24** | **9** | ✓✓ R09c |
| Tempo totale | ~7 min | ~30 min | tradeoff qualità |
| Casi multi-location marcati | 16 | 9 | più conservativo |

## Tassonomia finale (9 famiglie consolidate)

```
107  Technical Writing
 49  CAD / CNC
 12  Manufacturing
 12  Developer Relations
  8  Localization / Language
  4  Acoustic Engineering
  3  Content Writing
  1  UX Writing
  1  QA Testing
```

Zero collisioni semantiche tra analisti (peer lookup ha funzionato):
- Tutti hanno convergente "Technical Writing", "CAD / CNC", "Developer Relations".
- Niente più "Customer Success / Technical" vs "Customer Support" vs
  "Technical Support" — un unico "Customer Support" non emerso
  (probabilmente perché nessuna posizione era nel range).

## Standardizzazione paesi (ISO English)

```
65 Italy           23 Hungary       12 Netherlands     12 Ireland
11 Germany          8 Spain          7 United Kingdom   5 Poland
```

Niente "UK", "Italia", abbreviazioni. Diacritici preservati e normalizzati
(`Szekesfehervar` → `Székesfehérvár`, `Pilisvorosvar` → `Pilisvörösvár`,
`Tatabanya` → `Tatabánya`, `Zsambek` → `Zsámbék`).

## Casi edge — gestiti perfettamente

```
"Europe Remote"  → loc_country=NULL, continent=Europe, work_country=US/UK
                   (HQ via web search)
"Remote" puro    → loc_country=NULL, continent dedotto, work_country da HQ
"Italy" + remote → loc_country=Italy, work_country=United States
                   (DataAnnotation, iMerit, Lilt, Crossing Hurdles riconosciuti
                    come US company che assumono contractor IT)
"Spain" + remote → loc/work=Spain (azienda spagnola, entity locale)
"EMEA - Flexible"→ continent=Europe, work_country=Ireland (ServiceNow EU HQ)
"Greater Bologna"→ promosso a city=Bologna
"Barcelona/Malaga"→ multi_location=true, country=Spain (un solo pin)
Diacritici scout→ normalizzati per uniformità (vedi sopra)
```

## Sync verso Supabase prod

Dopo la fine della simulazione, i 206 record arricchiti del SQLite locale
sono stati importati su Supabase project `smittwvohsnwwwisqdrh` per
l'utente `beta-user@example.com` tramite UPDATE batch (6 chunk SQL).

Sync limitato esclusivamente a `leone.puglisi`:

| email | role_family popolato dopo sync |
|---|---:|
| `beta-user@example.com` | 206/206 |
| `beta-user2@example.com` | 0 (intatto) |
| `info@jobhunterteam.ai` | 0 (intatto) |

Campi sovrascritti: solo i 11 `loc_*/work_*/role_family/is_multi_location/
location_notes`. NON toccati: `status`, `notes`, `office_*` (preservato
stato applicativo dell'utente).

## Refactor del prompt analista dopo sim 2

Per migliorare l'aderenza alle regole comportamentali, il prompt
analista è stato refactored (A+B):

- **A**: tutto il playbook location estratto in
  `agents/_skills/location-enrichment/SKILL.md` (240 righe, lazy-load via
  description punchy che Claude legge per decidere quando aprire). Una
  fonte di verità sola, riusabile da altri ruoli.
- **B**: 4 nuove regole comportamentali compatte (R12 location enrichment
  obbligatorio, R13 no batch, R14 peer DB lookup, R15 work_country mai
  NULL) spostate nella sezione `## REGOLE` al top del prompt, in
  posizione di alta salienza.
- Risultato: `analista.it.md` da 307 → 195 righe (-37% compressione).
  `skills.list` di analista aggiunge `location-enrichment` al boot.

Sim 3 non è stata necessaria: i numeri di sim 2 sono già accettabili per
servire come ground truth alla dashboard / globo / componenti grafici
che l'utente svilupperà sopra.
