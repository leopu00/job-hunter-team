<!-- @translation: it, ai-translated 2026-07-18 -->
---
name: logo-extraction
description: Estrai il logo aziendale per un'azienda della tabella companies e salvalo come piccolo data-URI base64 (max ~35KB, min 32px). Il percorso primario è completamente automatizzato via logo_fetch.py sul sito ufficiale (apple-touch-icon → icon → og:image → favicon); quando il sito blocca i bot o non ha icone usabili, trova l'URL diretto di un'immagine logo via web search e passalo con --from-url. Verifica che il sito appartenga DAVVERO all'azienda PRIMA del fetch. Imposta companies.logo, logo_source, logo_fetched.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# logo-extraction — logo aziendale per la pagina posizione

Il web mostra il logo dell'azienda sulla pagina di dettaglio posizione.
Il logo vive sulla riga `companies` (UNA per azienda: 1000 posizioni
Wizz Air = 1 logo) come data-URI base64 piccolo, e viaggia col sync
companies esistente. Nessun upload, nessuno storage esterno.

## 3 colonne da popolare (le scrive `logo_fetch.py`, MAI a mano)

```
logo          text  data-URI base64 (png/jpeg/webp/ico), <= ~35KB raw
logo_source   text  URL da cui il logo è stato estratto (audit/refresh)
logo_fetched  bool  true = estrazione TENTATA (anche se fallita) —
                    pattern office_geocoded: l'azienda esce dalla coda
                    next-for-logo-missing e non si riprova a ogni giro
```

## REGOLA d'oro: azienda giusta, sito giusto

**Il logo sbagliato è peggio di nessun logo.** Prima di lanciare il
fetch verifica che `companies.website` appartenga DAVVERO all'azienda
della posizione (non un omonimo, non l'aggregatore che ha pubblicato
l'annuncio, non il gruppo madre sbagliato). In dubbio: web search
`"<Company> official site"` e confronta col settore/paese della riga.

- Annuncio pubblicato da agenzia/recruiter (Manpower, Randstad, ...) MA
  per conto di un hotel/azienda nominata → il logo è dell'azienda della
  riga `companies` collegata alla posizione, qualunque essa sia.
- Catena vs proprietà (es. "CARDO ROMA, Autograph Collection"): usa il
  logo del brand che compare come `companies.name`.

## Workflow

### Step 0 — La coda

```bash
python3 /app/shared/skills/db_query.py next-for-logo-missing
```

Elenca le aziende con posizioni vive e logo mai tentato, ordinate per
numero di posizioni (prima le più visibili). `NO WEBSITE (cercalo
prima)` = fai prima Step 1.

### Step 1 — Website mancante? Trovalo e salvalo

```bash
# dopo web search "<Company> official website":
python3 /app/shared/skills/db_update.py company "<Company>" \
  --website https://www.wizzair.com
```

### Step 2 — Fetch automatico (il percorso normale)

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>"
```

Lo script: scarica la homepage, prova `apple-touch-icon` → `icon`
grandi → `og:image` → `/favicon.*`, valida formato (png/jpeg/webp/ico,
MAI svg), peso (200B–35KB) e lato minimo (>=32px), salva il data-URI e
marca `logo_fetched=1`. Output JSON su stdout. `--dry-run` per provare
senza scrivere, `--force` per sostituire un logo esistente.

### Step 3 — Sito anti-bot o senza icona usabile → `--from-url`

Se Step 2 dà `NO_CANDIDATE` (siti come marriott.com bloccano i bot):

1. Web search `"<Company> logo png"` / `"<Company> press kit logo"` /
   pagina Wikipedia dell'azienda (i file Wikimedia hanno URL diretti).
2. Trova l'**URL diretto dell'immagine** (deve finire in .png/.jpg/
   .webp/.ico o comunque servire l'immagine raw, non una pagina HTML).
3. ```bash
   python3 /app/shared/skills/logo_fetch.py "<Company>" \
     --from-url "https://upload.wikimedia.org/.../Wizz_Air_logo.png"
   ```
   La stessa validazione (peso/formato/dimensioni) si applica: se
   l'immagine è troppo pesante cerca una variante più piccola
   (thumbnail Wikimedia: sostituisci nel path `/1200px-` con `/240px-`).

### Step 4 — Niente di usabile dopo 3 tentativi → marca e passa oltre

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>" --mark-attempted
```

`logo_fetched=1` con logo NULL: la pagina web mostra il fallback a
iniziali, l'azienda esce dalla coda. NON insistere oltre 3 tentativi.

## Policy di risparmio (enrichment-policy)

Il fetch autonomo rispetta `$JHT_HOME/profile/enrichment-policy.json`
(controlla con `python3 /app/shared/skills/enrichment_policy.py show`).
Risposte possibili di `logo_fetch.py`:

- `POLICY_DISABLED` — risparmio attivo (`economy=true`) o
  `logo.enabled=false`: NON estrarre, non è un errore. Vai avanti.
- `POLICY_SCORE_GATE` — l'azienda non ha ancora posizioni vive con
  score ≥ `logo.min_score`: NON insistere. Non marca `logo_fetched`:
  quando lo Scorer supera la soglia, l'azienda rientra in coda da sola.

`--force` scavalca la policy: usalo SOLO su richiesta esplicita
dell'utente, mai in autonomia.

## Qualità attesa

- **Preferisci** icone quadrate 96–256px (apple-touch-icon è l'ideale).
- 32–48px (favicon) è accettabile come ripiego: il riquadro web è
  piccolo. Sotto 32px lo script rifiuta da solo.
- Il cap 35KB è **rigido** (protegge DB e sync): non aggirarlo, cerca
  una variante più leggera.

## Vietati

- ❌ Logo di un'azienda OMONIMA o del gruppo sbagliato (verifica web!)
- ❌ Logo dell'aggregatore/job-board (LinkedIn, Indeed) al posto
  dell'azienda
- ❌ Scrivere `logo`/`logo_source`/`logo_fetched` a mano con db_update:
  passa SEMPRE da `logo_fetch.py` (è l'unico che valida)
- ❌ SVG, immagini >35KB, icone <32px (lo script li rifiuta: non
  cercare di aggirarlo)
- ❌ Screenshot della homepage o ritagli: solo file-logo reali
- ❌ Più di 3 tentativi per azienda: marca `--mark-attempted` e avanti
