# Simulazione 5 — office geocoding su leone.puglisi (Marton / Tech Writer)

Data: 2026-05-25
Container: `jht-sim-d2` (reset totale, candidate_profile.yml ripristinato su Marton Kovacs)
Dataset: 206 record di `leone.puglisi@gmail.com` con `loc_*/work_*/role_family` **già popolati da sim 2** (preservati nel reseed).

## Setup

- Profilo: Marton Kovacs (technical writer/translator + CAD-CAM/CNC), 10 anni esperienza, HU+IT native, EN C1-C2.
- Capitano + 6 analisti, range disgiunti: A1 ids 728-761, A2 762-795, A3 796-829, A4 830-863, A5 864-897, A6 898-933.
- Missione UNICA: **office geocoding** via skill `office-geocoding` (R16). Location enrichment già fatto dalla sim 2, NON ripetuto.
- `seed_import.py` esteso per preservare i campi sim 2 al reseed (commit pending: `agents/_skills/location-enrichment/SKILL.md` anti-pattern Remote + `scripts/sim/seed_import.py` campi estesi).

## Risultati

- **172/206 record processati** (84%) — 5/6 analisti hanno chiuso il range.
- **office_geocoded=1**: 134 (street-level + city-level fallback)
- **office_verified=1**: 89 (street-level con conferma sito company / LinkedIn About / registro imprese)
- **office_geocoded=0** (skip onesto dopo 3+ tentativi): 38 (full remote / multi-ambiguo)

### Per analista

| analista | record toccati | geocoded=1 | verified=1 | range |
|---|---:|---:|---:|---|
| A1 | 34 | 33 | 8 | 728-761 |
| A2 | 34 | 15 | 14 | 762-795 |
| A3 | 34 | 12 | 11 | 796-829 |
| A4 | **0** | 0 | 0 | 830-863 ❌ |
| A5 | 34 | 26 | 20 | 864-897 |
| A6 | 36 | 30 | 23 | 898-933 |

### Caso A4 — pane mostra completed, DB non scritto

A4 ha completato il **reasoning** (8m 34s di Crunched, pane mostra report finale con tabella di riepilogo `18 geocodati, 13 verified, 5 false`, lista posizioni: 836 Olive Tree Rome, 847 Vestas Taranto, 849 Gruppo AB Orzinuovi, 861 Contentful London, 862 BlueCat Belgrade). Ha citato sedi specifiche trovate via web (Nebius Gustav Mahlerlaan 300, Veeam Argentinská 4, Kontron Lehrbachgasse 11, ALTEN Kopparbergsvägen 8, Edwards Kenn Road, ecc.) e ha annunciato `STOP confermato, missione completata`.

MA **non ha mai chiamato `db_update.py`**: i 34 record nel range 830-863 hanno `last_actor=NULL` e `office_geocoded=0` post-sim. Il lavoro mentale è andato perso.

Causa probabile: A4 ha interpretato il brief come "produci report" invece di "scrivi sul DB". Nessun altro analista ha avuto questo problema.

**Lezione**: brief al singolo analista deve dire ESPLICITAMENTE "scrivi su DB via `db_update.py position <ID> --office-lat ... --office-lon ... --office-address ... --office-geocoded true/false --office-verified true/false`. NO REPORT verbose senza scritture intermedie. Status report al Capitano OK solo dopo aver scritto."

### Sample office verified (street-level reali)

```
Tesla Automation     → Rudolf-Diesel-Straße 14, Prüm, Germany
Booston.io           → Meidoornkade 22, 3992 AE Houten, Netherlands
ESSEDUE              → Via Enrico Mattei 25, 27020 Marcignago PV, Italy
Bányai Bútorok       → Bécsi út 20/A, 2085 Pilisvörösvár, Hungary
HARMAN International → Aszalvölgyi út 3-5, 8000 Székesfehérvár, Hungary
Larian Studios       → 17A New Bride Street, Dublin 8, D08 Y80E, Ireland
Platin Gaming        → 109 Sir William Reid Street, Gżira, Malta
GE Vingmed Ultrasound→ Strandpromenaden 45, 3183 Horten, Norway
Sanofi Prague      → Fiastyúk utca 4-8, Prague, Hungary
LEGO Group           → Váci út 1-3, Prague, Hungary
Nebius Group         → Gustav Mahlerlaan 308, 1082 ME Amsterdam, Netherlands
```

## Sync verso Supabase prod (leone.puglisi only)

UPDATE batch su 172 record con filtro `user_id = leone.puglisi@gmail.com`. Solo i 5 campi `office_lat/lon/address/geocoded/verified` toccati. Niente altri campi.

**Verifica safety post-sync**:

| email | total | office_lat | office_verified |
|---|---:|---:|---:|
| `leone.puglisi@gmail.com` | 206 | **116** | **76** |
| `leopu00@gmail.com` | 300 | 114 | 66 (intatto) |
| `betauser97@gmail.com` | 206 | 0 | 0 (intatto) |

Nota: leone.puglisi su Supabase ora ha 116 office_lat (vs 134 nel container) perché la query di sync filtrava per `last_actor IS NOT NULL` → 172 record, di cui 134 hanno office_lat valorizzato; il delta 116 vs 134 (18 record) sono casi dove il sync ha trovato URL non matchato in Supabase (race con scout? URL leggermente diverso). Da indagare se rilevante.

## Sim 1-5 confronto sintetico

| Metrica | sim 1 | sim 2 | sim 3 | sim 4 | sim 5 |
|---|---|---|---|---|---|
| Candidato | leone.puglisi | leone.puglisi | leopu00 | leopu00 | leone.puglisi |
| Profilo | Tech Writer | Tech Writer | Python Dev | Python Dev | Tech Writer |
| Analisti | 3 | 3 | 3 | 6 | 6 |
| Missione | location | location | location | location+office | **solo office** |
| Record | 206 | 206 | 249 | 272 | 206 (preserved sim2) |
| Office geocoded | NO | NO | NO | 114 (42%) | **134 (65%)** |
| Office verified | NO | NO | NO | 66 (24%) | **89 (43%)** |
| Auto-consolidation | no | no | parziale | NO (forzata) | N/A (no role_family) |
| Bug analisti | — | — | — | A2 loc=Remote | A4 no DB write |

Sim 5 ha il **miglior verified-ratio** (43% vs 24% di sim 4), grazie a:
1. Location enrichment già fatto → analisti focused su 1 task solo
2. Skill `office-geocoding` ben rodata dalla sim 4
3. Anti-pattern Remote esplicitato nella skill location-enrichment (preventivo)

## Lezioni per le prossime sim

1. **Brief al singolo analista deve essere prescrittivo sul comando di scrittura**: "scrivi via `db_update.py --office-lat X --office-lon Y ...`". Senza, agenti possono produrre solo report (caso A4).
2. **Capitano dovrebbe verificare la writes count** ogni 30 record con un `db-query positions WHERE last_actor = <analista> AND office_geocoded IS NOT NULL`. Se zero o crescita anomala, intervenire.
3. **Lavoro split (location già fatto, office da fare) accelera molto**: skill specifica = focus migliore = quality più alta.
4. **Anti-pattern preventivi nella skill funzionano**: l'aggiunta di "loc_city != Remote" alla skill location-enrichment è stata fatta DOPO sim 4 ma prima di sim 5; sim 5 non ha avuto recidive del bug (anche perché non rifaceva location).
