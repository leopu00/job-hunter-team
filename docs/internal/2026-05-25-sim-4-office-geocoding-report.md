# Simulazione 4 — office geocoding precise + 6 analisti

Data: 2026-05-25 (avvio 22:45 del 2026-05-24, chiusura ~01:50 del 2026-05-25)
Container: `jht-sim-d2` (reset totale via `sim-reset.sh`)
Profilo: Leone Emanuel Puglisi (`leopu00@gmail.com`) — Python Developer
junior, Roma, 1 anno esperienza.
Dataset: 272 record (273 - 1 skip CHECK constraint).

## Novità rispetto a sim 3

- **Nuova skill `office-geocoding`** (`agents/_skills/office-geocoding/SKILL.md`):
  workflow Nominatim → web search HQ company → Photon fallback, almeno
  3 tentativi prima di skippare.
- **REGOLA-16** aggiunta al prompt analista: office geocoding obbligatorio
  dopo location enrichment, sforzo aggressivo, skip OK solo dopo 3
  tentativi reali.
- **SQLite container schema**: 5 colonne `office_*` aggiunte via migration
  `_migrate_positions_office_geocoding` (mirror Supabase).
- **`db_update.py`**: nuovi flag `--office-lat/lon/address/geocoded/verified`.
- **6 analisti** (vs 3 nelle sim precedenti): A1/A2/A3 spawnati all'inizio,
  A4/A5/A6 aggiunti a mid-sim su richiesta utente. Range ridistribuiti dal
  Capitano via `jht-tmux-send` con [@capitano -> @analista-N] [MSG].

## Risultati

- **272/272 processati**: 227 `checked` + 45 `excluded`
- Anti-collision: perfetta (range disgiunti, zero overlap)
- Tempo totale: ~3 ore (con ~2 ore di stallo iniziale per token Claude 401
  scaduto e respawn dopo refresh credenziali dal Mac Keychain).

### Per analista

| analista | record | range id |
|---|---:|---|
| A1 | 46 | 456-501 |
| A2 | 52 | 546-597 |
| A3 | 48 | 637-684 |
| A4 (rinforzo) | 44 | 502-545 |
| A5 (rinforzo) | 39 | 598-636 |
| A6 (rinforzo) | 43 | 685-727 |

Anti-collision tenuta anche con 6 analisti grazie alle riassegnazioni
esplicite del Capitano via tmux-send dopo l'arrivo dei rinforzi.

### Copertura colonne (su 272)

```
LOCATION ENRICHMENT (R12-R15)
   role_family           231/272   (41 NULL = excluded senza enrichment)
   work_mode             232/272
   work_country          232/272
   loc_continent         229/272
   loc_country           203/272
   loc_city              144/272   (gli altri sono full-remote / multi)
   location_notes        175/272
   is_multi_location      22/272

OFFICE GEOCODING (R16) — nuovo in sim 4
   office_geocoded=true  114/272  →  verified=true:  66  (street-level)
                                 →  verified=false: 48  (city-level fallback)
   office_geocoded=false 113/272  (skip dopo 3+ tentativi falliti)
   excluded                45/272  (no enrichment)
```

### Tassonomia finale (9 famiglie consolidate)

```
115  Backend Engineering
 33  AI / ML Engineering
 27  Full Stack
 22  Data Engineering
 19  Data Science / Analytics
 11  Cloud / DevOps
  2  Frontend
  1  Salesforce Development
  1  QA
```

**Importante**: il numero "9 famiglie" è il risultato di un
**consolidation pass forzato** dal Capitano a fine sim, NON il risultato
naturale del peer DB lookup. Pre-consolidation la tassonomia era a
**15 famiglie con duplicati semantici** (vedi sotto, sezione "Quality
issues + interventi esterni").

### Distribuzione paesi (coerente con candidato Roma)

```
136  Italy            ← dominante
 11  United States    ← contractor remote / US-only
 11  Poland
 10  United Kingdom, Spain (10 ciascuno)
  7  Portugal
  4  Austria
  3  Netherlands
  2  Germany
  1  Ukraine
```

### Office geocoding — esempi verified street-level

```
SIAE                  →  Viale della Letteratura 30, Roma EUR     (41.83, 12.48)
IT Partner Italia     →  Via Jacopo Dal Verme 7, Milano           (45.49,  9.19)
KPMG Italy            →  Via Ettore Petrolini 2, Parioli Roma     (41.93, 12.49)
Knowmad Mood          →  Calle de Jacinto Benavente 2, Las Rozas  (40.52, -3.89)
Sentry                →  Jakov-Lind-Straße 5/4 OG, Wien           (48.22, 16.39)
```

L'analista ha riconosciuto sedi reali via web search del sito company /
LinkedIn About, geocodate via Nominatim/Photon.

## Quality issues + interventi esterni (onestà piena)

### Issue 1 — Bug A2: `loc_city='Remote'` su 8 record

Identificato a mid-sim (~150/272, 55%). A2 ha scritto `loc_city='Remote'`
per 8 posizioni full-remote (id 556, 563, 565, 569, 570, 571, 575, 587).
La skill `location-enrichment` caso A dice esplicitamente
`loc_city=NULL` per remote senza city specifica.

**Non auto-corretto dal team**: gli altri analisti non hanno notato il
bug nelle loro peer query, il Capitano non ha intercettato l'errore
durante i [REPORT] di A2.

**Intervento esterno** (`@system -> @capitano`): notifica del bug con
richiesta di fix via `jht-tmux-send` ad A2. A2 ha corretto i 8 record con
`db_update --loc-city ""` (stringa vuota = SET NULL).

### Issue 2 — Tassonomia frammentata: 15 famiglie con duplicati semantici

Identificato a mid-sim. Vocabolari paralleli per analista:

| Analista | famiglia dominante | famiglie distinte |
|---|---|---:|
| A1 | "Python Backend" (13) | 7 |
| A2 | "Software Engineering" (23) | 5 |
| A3 | mix (Full Stack 9, Python Backend 6, Backend Engineering 4, ...) | 9 |
| A4 | "Python Backend" (6) + "Backend Engineering" (4) | 5 |
| A5 | "AI Engineering" (7) | 4 |
| A6 | mix | 9 |

Stessi concetti, nomi diversi: "Python Backend" ≠ "Backend Engineering"
≠ "Software Engineering" (Python-related); "AI Engineering" ≠
"AI / ML Engineering". Peer DB lookup (R14) ha ridotto la divergenza ma
non è bastato con 6 analisti in parallelo.

**Non auto-consolidato dal team**: il Capitano non ha proposto
spontaneamente un consolidation pass.

**Intervento esterno**: richiesta al Capitano di fare CONSOLIDATION PASS
a fine sim, mappando i sinonimi a 8-10 famiglie canoniche.
Risultato: 9 famiglie consolidate (vedi sezione precedente).

### Quality issues residui dopo intervento

```
loc_city='Remote' residui:        0  ✓ (8 → 0 dopo fix A2)
work_country NULL su checked:     0  ✓
role_family NULL su checked:      0  ✓
```

### Bug accessorio — token Claude OAuth scaduto

Quando ho fatto restart Capitano dopo 2 giorni (sim 4 lanciata 22:45
di domenica, ma sim era partita giovedì), Claude TUI ha dato `401
Invalid authentication credentials`. Refresh credentials dal Mac
Keychain via `security find-generic-password` + restart Capitano +
respawn rinforzi A4/A5/A6 ha sbloccato il flusso.

## Sim 1-4 confronto sintetico

| Metrica | sim 1 | sim 2 | sim 3 | sim 4 |
|---|---|---|---|---|
| Candidato | leone.puglisi | leone.puglisi | leopu00 | leopu00 |
| Profilo | Tech Writer | Tech Writer | Python Dev | Python Dev |
| N record | 206 | 206 | 249 | 272 |
| Analisti | 3 | 3 | 3 | 6 |
| role_family unici | 24 | 9 | 12 | 15 → 9 (forzato) |
| work_country NULL | 3 | 0 | 0 | 0 |
| office geocoding | NO | NO | NO | SÌ (114/272 = 42%) |
| Auto-consolidation? | no | no | parziale | NO (forzata) |

## Lezioni apprese (per i prossimi giri)

1. **Peer DB lookup (R14) non scala oltre 3-4 analisti**. Con 6 agenti
   in parallelo, ogni analista guarda lo stato condiviso ma poi inventa
   comunque il proprio nome. Servirebbe vocabolario centralizzato dal
   Capitano al boot (lista canonica role_family per il candidato), OPPURE
   un consolidation pass automatico ricorrente del Capitano (non a
   richiesta esterna).

2. **Il Capitano non auto-controlla la qualità**. Ha eseguito gli ACK e
   i [REPORT] degli analisti ma non ha mai notato il bug A2
   `loc_city='Remote'` né le 15 famiglie duplicate. Servirebbe una
   regola tipo "ogni 30 record check anomalie nel DB (loc_city con
   valori non-città, role_family count > 10 → consolidation)".

3. **Token OAuth scade**. Per simulazioni multi-day serve refresh
   programmato delle credenziali Claude — al momento è manuale (copia
   da Keychain).

4. **6 analisti = produttività non lineare**. Sim 4 con 6 analisti ha
   processato 272 record in ~1 ora effettiva (escluso stallo token);
   sim 3 con 3 analisti ha processato 249 in ~30 min. Throughput simile
   per agente, più overhead di coordinamento.

5. **Onestà nella documentazione**: la sim 4 NON è un test puro del
   sistema autonomo. Da ~55% (150/272) in poi è guidata da messaggi
   esterni del system al Capitano. Per validare il sistema senza
   intervento serve una sim 5 con monitoring puramente osservativo
   (niente fix mid-sim).

## Sync verso Supabase prod (leopu00) — pendente

I 114 `office_lat/lon/address` + i campi enrichment finali (post-
consolidation) sono nel SQLite del container ma **non ancora
sincronizzati su Supabase prod**. Pending decisione utente.

Quando sync: filtro su `user_id = leopu00`, campi da sincronizzare solo
`role_family + loc_* + work_* + is_multi_location + location_notes +
office_*`. NON toccare `status`, `notes`. Verificare zero contaminazione
su `leone.puglisi` e `bartoscar97` con count post-sync.
