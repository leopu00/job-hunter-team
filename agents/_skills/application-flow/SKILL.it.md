<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: application-flow
description: Contratto DB + filesystem che ogni Scrittore segue per portare una posizione da `scored` (≥50) a `ready`/`excluded`. Tre gate PRIMA di scrivere una singola riga di CV (anti-riscrittura, anti-collisione, verifica link), un percorso canonico per i deliverable, un gate finale dopo il 3° round del Critico. Saltare uno qualsiasi di questi produce lavoro duplicato, sovrascrive il claim di un altro Scrittore, o — peggio — propone all'utente un CV di grado `excluded` come `ready`. Responsabilità dello Scrittore.
allowed-tools: Bash(python3 *), Bash(mkdir -p *), Bash(find *), Bash(test *)
---

# application-flow — claim, scrivi, gate

Lo Scrittore tocca solo due aree del DB:
- `positions.status` (writing → ready | excluded)
- `applications` (INSERT + UPDATE via UPSERT)

Tutto il resto è off-limits: mai `scores`, `companies`, `position_highlights`, `positions.notes` (territorio dell'Analista), `positions.applied` (solo Capitano/utente). T09 + confine di ruolo scrittore.

## Step 1 — Prendi la prossima posizione

```bash
python3 /app/shared/skills/db_query.py next-for-scrittore
```

Priorità: `score ≥ 70` prima, poi `50-69` in ordine decrescente. Lo script gestisce già l'ordinamento.

## Step 2 — Gate anti-riscrittura (DEVE essere eseguito prima del claim)

Una posizione il cui verdetto del Critico è già stato impostato è FINALE — mai ri-revisionare.

```bash
if python3 /app/shared/skills/db_query.py application "$ID" >/dev/null; then
  : # exit 0 → application mancante, OPPURE application senza verdetto → procedi
else
  : # exit 1 → critic_verdict già valorizzato → SKIP ASSOLUTO
  continue
fi
```

Codici di uscita:
- `0` → nessuna application ancora, o application senza verdetto → procedi allo Step 3.
- `1` → `critic_verdict` già impostato → **SKIP ASSOLUTO**, il voto del Critico è finale.

> ⚠️ `sqlite3` CLI NON è installato nel container. Usa sempre `db_query.py`. Mai workaround con `python3 -c "import sqlite3 ..."` — bypassano gli invarianti dello script.

## Step 3 — Claim anti-collisione

Verifica che la posizione non sia già stata reclamata da un altro Scrittore, poi reclamala atomicamente cambiando lo status.

```bash
# Controlla lo stato corrente
python3 /app/shared/skills/db_query.py position "$ID"

# Se lo status è già `writing` → un altro Scrittore l'ha presa, SKIP
# Altrimenti reclama:
python3 /app/shared/skills/db_update.py position "$ID" --status writing
```

Opzionale ma raccomandato: annuncia il claim ai colleghi via tmux così non iniziano nemmeno la sequenza di gate sullo stesso ID.

```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -E '^SCRITTORE-[0-9]+$' | grep -v "^${MY_SESSION}$"); do
  jht-tmux-send "$s" "[@$MY_ID -> @${s,,}] [INFO] Sto prendendo position #$ID"
done
```

Dettagli del contratto anti-collisione: `agents/_manual/anti-collision.md`.

## Step 4 — Verifica link

Un JD morto tra la Fase 2 (Analista) e adesso NON deve consumare budget del Critico. Controllo a due livelli:

```bash
# Livello 1 — fetch controllato con browser UA
python3 /app/shared/skills/safe_fetch.py "<JD-URL>" \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

Se c'è match → segna come esclusa ed esci:
```bash
python3 /app/shared/skills/db_update.py position "$ID" --status excluded \
  --notes "ESCLUSA: [LINK_MORTO] verificato dallo Scrittore prima di scrivere"
```

Livello 2 (solo se il Livello 1 è inconcludente) — fetch MCP, cerca "No longer accepting" / "applications closed" nel DOM renderizzato.

## Step 5 — INSERT della riga application + scrivi il CV

Dopo che il link è valido, crea la riga application. **Sempre via `db_update.py application` (UPSERT)** — mai `python3 -c "import sqlite3 ... INSERT INTO applications ..."` grezzo.

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id "$ID" \
  --cv-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md" \
  --cv-pdf-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf" \
  --written-by "$MY_ID" --written-at now
```

> ⚠️ Mai passare la stringa letterale `'now'` come valore timestamp in un SQL scritto a mano — viene salvata come la stringa `"now"` invece di un timestamp ISO. Il wrapper gestisce `--written-at now` correttamente; il wrapper è l'unico percorso sicuro.

Poi scrivi il CV (skill `cv-structure`) → genera il PDF → esegui `critic-loop`.

## Step 6 — Disciplina dei path (T11) + naming univoco (bug #25)

I deliverable finali DEVONO trovarsi sotto `$JHT_USER_DIR`, MAI sotto `$JHT_AGENT_DIR`. **Il nome file deve includere `position_id`** così 2+ aperture nella stessa azienda non si sovrascrivono:

| Artefatto                      | Path                                                                                |
|--------------------------------|--------------------------------------------------------------------------------------|
| CV markdown                    | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.md`         |
| CV PDF                         | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.pdf`        |
| Cover Letter (solo se richiesta)| `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<position_id>_<CompanySlug>.{md,pdf}` |

- `<Candidato>` = `Nome_Cognome` dal profilo.
- `<position_id>` = `positions.id` (intero, monotonico, univoco).
- `<CompanySlug>` = azienda in minuscolo, non-alfanumerico → `-`. Es. `canonical`, `bending-spoons`.
- `<TitleSlug>` = titolo in minuscolo + troncato a ~30 caratteri. Es. `observability`, `junior-ubuntu`.

Esempio per 2 aperture Canonical (caso bug #25):
```
CV_MarioRossi_28_canonical_observability.pdf
CV_MarioRossi_62_canonical_junior-ubuntu.pdf
```

Prima del fix del bug #25 entrambi venivano salvati come `CV_MarioRossi_Canonical.pdf` → il secondo sovrascriveva il primo → il DB aveva 2 righe application che puntavano allo stesso file → corruzione dati silenziosa visibile solo quando l'utente apriva il PDF e leggeva il contenuto dell'*altra* application.

Quando registri il path nel DB (`--cv-path`, `--cv-pdf-path`), registra il path `$JHT_USER_DIR/...`. Mai un path sotto `$JHT_AGENT_DIR` (quello è scratch — vedi workspace sotto).

## Step 7 — Gate finale (dopo che `critic-loop` raggiunge il round 3)

La skill `critic-loop` registra il punteggio di ogni round; qui persisti il verdetto, cambi lo status dell'application e allinei lo status della posizione.

> ⚠️ **Regola single-writer (bug #21).** `applications.status='ready'` viene impostato **solo qui, da te, dopo il PASS del Critico**. Il Critico non scrive mai `applications.status` direttamente — il suo unico output è `critic_verdict` + `critic_score`. Tu gestisci la transizione finale.

**`--critic-notes` è RIVOLTO ALL'UTENTE** — viene mostrato sotto la card Candidatura con lo **stesso markdown del razionale dello Scorer**, quindi scrivilo così (scorer RULE-09), mai la riga telegrafica qui sotto:
- **Nella lingua dell'utente** (RULE-T14 elenca "critic feedback" tra i contenuti user-locale). Il file di review è in inglese — riformulalo per il candidato; non lasciarlo in inglese quando la lingua del team non lo è.
- **Markdown che parla AL candidato**: apri con il verdetto e come il punteggio si è mosso nei 3 round *a parole*, poi `**grassetto**` sui punti decisivi, un paio di bullet pro/contro, un'emoji con parsimonia. Due paragrafi brevi — niente muro di testo, niente elenco di parole chiave.
- **Nessun gergo interno** — mai sigle di regole (`T10`, `RULE-*`), nomi di tool (`WeasyPrint`/`pandoc`/`typst`) o id di sessione.
- Newline reali con `$'...\n...'` (un `\n` letterale viene stampato come testo). Costruiscilo una volta prima del gate:

```bash
CRITIC_NOTES=$'**PASS · 7.5/10** — stabile in tutti e tre i round, un fit onesto e solido.\n\n**Punti di forza**\n- ✅ <forza concreta: CV vs questo ruolo>\n- ✅ <altra forza reale>\n\n**Da tenere presente**\n- ⚠️ <un gap reale, detto con chiarezza>\n\n<una frase di chiusura>'
# NEEDS_WORK/REJECT: stessa forma, ma indica cosa manca e cosa lo alzerebbe.
```

```bash
# UPSERT finale sull'application — verdetto + punteggio + promozione ready/draft
# `--reviewed-by` deve essere impostato all'id sessione dell'ULTIMO Critico spawnato
# (es. CRITICO-S3 se il round 3 era l'ultimo). Senza, `reviewed_by`
# resta NULL — osservato 95% null pre-2026-05-22 (vps1-run-postmortem #1).
LAST_CRITIC="${LAST_CRITIC:-CRITICO-S3}"   # impostato da critic-loop allo spawn del round

if [[ <final_verdict> == "PASS" ]]; then
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict PASS \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC" \
    --status ready
else
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict <NEEDS_WORK|REJECT> \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC"
  # lo status resta 'draft' — l'application non è pronta per l'utente.
fi

# Status posizione — automatico dal punteggio finale
if [[ <final_score>_int >= 5 ]]; then
  python3 /app/shared/skills/db_update.py position "$ID" --status ready
else
  python3 /app/shared/skills/db_update.py position "$ID" --status excluded
fi
```

La promozione `applications.status='ready'` è ciò che rende il CV visibile sulla dashboard `/ready` dell'utente. Saltarla lascia la riga in `'draft'` per sempre — il Capitano riporta un conteggio ready con cui il DB e la dashboard non concordano.

Poi notifica il Capitano con un `[REPORT]` (skill `tmux-send`).

## Workspace — `tools/` + `tmp/`, pulizia al boot (T12)

Il tuo `$JHT_AGENT_DIR` ha 2 sottodirectory canoniche create dal launcher:

| Subdir                       | Contenuto                                                         | Durata                                  |
|------------------------------|-------------------------------------------------------------------|------------------------------------------|
| `$JHT_AGENT_DIR/tools/`      | script helper che hai scritto per te stesso (parser JD una tantum, ecc.)  | finché utile; audit ad ogni boot       |
| `$JHT_AGENT_DIR/tmp/`        | scratch: JD scaricate, bozze CV tra i round                       | cancellato al boot se più vecchio di 7 giorni |

**Pulizia al boot (PRIMO step nel tuo loop, prima dello Step 1):**

```bash
mkdir -p "$JHT_AGENT_DIR/tools" "$JHT_AGENT_DIR/tmp"
find "$JHT_AGENT_DIR/tmp" -type f -mtime +7 -delete 2>/dev/null || true
```

Ripeti ogni ~6h di esecuzione continua o ogni ~50 iterazioni del loop principale. NON dentro un loop stretto — costa chiamate FS.

> 🚫 **Fuori perimetro:** mai `find -delete` fuori da `$JHT_AGENT_DIR/tmp/`. Mai cancellare `$JHT_USER_DIR` (deliverable), mai cancellare i workspace degli agenti fratelli. T12.

## Regole ferree

- **Anti-riscrittura prima del claim, sempre.** Saltare lo Step 2 significa rieseguire il Critico su un'application finalizzata = token Opus sprecati e possibile sovrascrittura di un verdetto finale.
- **Claim prima di scrivere.** Un CV scritto senza claim rischia che due Scrittori producano CV paralleli per la stessa posizione.
- **Path sotto `$JHT_USER_DIR/cv/`, mai `$JHT_AGENT_DIR/`.** L'utente cerca sotto `$JHT_USER_DIR`; CV sparsi nei workspace degli agenti sono invisibili per lui. T11.
- **Niente SQL grezzo.** Sempre `db_query.py` / `db_update.py` / `db_insert.py`. I wrapper impongono invarianti su cui il team fa affidamento.
- **Niente git.** Niente `git add`, niente `git commit`, niente `git push` (T02).

## Anti-pattern

- ❌ Saltare lo Step 2 (anti-riscrittura) "perché la posizione sembra fresca" — exit 1 significa che il Critico ha già votato, mai invisibile.
- ❌ Reclamare una posizione e poi scrivere il CV sotto `$JHT_AGENT_DIR/cv/` — l'utente non può vederlo; il path nel DB è sbagliato; violazione T11.
- ❌ `python3 -c "import sqlite3; INSERT INTO applications ..."` — bypassa la logica UPSERT, dati spazzatura nel DB.
- ❌ Passare `'now'` come stringa letterale senza usare il wrapper — viene salvata come stringa invece di timestamp ISO.
- ❌ Toccare `positions.notes` (colonna dell'Analista) — violazione del confine di ruolo, rompe i campi strutturati dell'Analista.
- ❌ Impostare `positions.applied` da qui — solo il Capitano o l'utente possono cambiare quel flag.

## Vedi anche

- `cv-structure` — cosa scrivere tra lo Step 5 e `critic-loop`.
- `critic-loop` — la revisione a 3 round che produce il punteggio finale per lo Step 7.
- `agents/_manual/anti-collision.md` — contratto completo di coordinamento multi-Scrittore.
- `agents/_manual/db-schema.md` — colonne `applications` + confini di ruolo.
- `agents/_team/team-rules.md` T11 (path dei deliverable) + T12 (pulizia workspace).
