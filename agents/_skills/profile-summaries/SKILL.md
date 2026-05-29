---
name: profile-summaries
description: Write the 4 narrative Markdown summaries under `$JHT_HOME/profile/summaries/` that complement the structured YAML. The Writers downstream NEED these — a YAML alone produces sterile CVs because it has no voice, no narrative, no positioning. Owned by the Assistente. Filenames are FIXED (the frontend ignores anything else); always written in the user's first person ("sono uno sviluppatore…"); always rewritten in full (Write, not Edit append) — these are snapshots of the present, not append-only logs.
allowed-tools: Bash(mkdir -p *)
---

# profile-summaries — the candidate's voice on disk

The structured YAML is great for filters and matches but says nothing about *who* the candidate is. The 4 MD files in `summaries/` carry the narrative the Writers need to produce CVs that read like a person, not a checkbox list.

## The 4 files (filenames are FIXED)

| File             | UI title shown to the user  | What it contains                                                            | Length cap |
|------------------|----------------------------|-----------------------------------------------------------------------------|-----------|
| `about.md`       | **Chi sei**                 | Persona summary: ruolo attuale/target, anni, settore, tratto distintivo     | ~400 char |
| `preferences.md` | **Preferenze raccontate**   | Modalità di lavoro, trasferimento, retribuzione, orari, ambiente            | ~400 char |
| `goals.md`       | **Obiettivi e dream job**   | Cosa cerca nei prossimi 1-3 anni, contesto/azienda dei sogni                | ~500 char |
| `strengths.md`   | **Punti di forza**          | 2-4 qualità concrete con esempio breve per ciascuna                          | ~500 char |

Path: `$JHT_HOME/profile/summaries/<file>.md`. Crea la dir se manca:
```bash
mkdir -p "$JHT_HOME/profile/summaries"
```

Filenames diversi (es. `about-mario.md`, `goals_v2.md`) sono **silenziosamente ignorati** dal frontend.

## Style constraints (binding)

- **Markdown semplice**: paragrafi separati da riga vuota, `**grassetto**` per sottolineare, liste solo se aiutano la leggibilità.
- **Nessuna tabella, nessun header `#`** — questi MD vivono in card UI già titolate.
- **Lunghezza**: rispetta il cap. Niente muri di testo.
- **Prima persona dell'utente**: `"sono uno sviluppatore…"`, `"preferisco lavorare da remoto…"`. Mai terza persona (`"Mario è…"`).
- **Tono**: naturale, come se l'utente parlasse di sé a un amico esperto del settore.
- **Mai path / nomi file / jargon** nel testo — l'utente legge "il riassunto", non "about.md".

## Update rule — rewrite in full, never append

Quando arriva un'informazione che cambia il senso di un MD esistente, **riscrivi il file da capo** (`Write` tool, NOT `Edit` append). Sono snapshot del presente, non log cronologici. Un append rischia di lasciare paragrafi obsoleti accanto al nuovo.

## Trigger — quando scrivere ciascun file

| File              | Quando scrivilo per la prima volta / aggiornalo                                                                                                                                                       |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `about.md`        | Hai ruolo + anni + ≥1 esperienza. Riscrivilo ogni volta che cambia qualcosa di sostanziale (ruolo, seniority, settore).                                                                                |
| `preferences.md`  | Hai discusso con l'utente almeno una di: modalità di lavoro, trasferimento, retribuzione. Aggiorna ogni volta che una di queste cambia.                                                                |
| `goals.md`        | L'utente ha raccontato aspirazioni / contesto ideale / dream job (anche parziale). Non forzare la mano: se non emerge spontaneamente, **chiedi una sola volta** "c'è un tipo di contesto o azienda in cui ti vedresti particolarmente bene?". |
| `strengths.md`    | Hai raccolto **2+ esperienze o progetti rilevanti**. Estrai 2-4 qualità ricorrenti dal pattern.                                                                                                       |

## Boot rule — primo CV caricato

Quando l'utente carica un CV, dopo aver popolato il YAML scrivi MINIMO **`about.md` + `strengths.md`** nello stesso turno. Hai abbastanza dati (ruolo, anni, esperienze, competenze, tono) per farlo subito; non rimandare. Saltare questo step significa che lo Scrittore CV a valle non avrà mai il contesto narrativo del candidato → produrrà CV sterili. Tu sei l'unico punto in cui quella narrativa viene catturata.

`preferences.md` e `goals.md` arriveranno nei turni successivi (dopo la discussione specifica).

## Examples

### `about.md` (settore tech)
```markdown
Sono uno sviluppatore backend con 4 anni di esperienza in **Python** e
sistemi distribuiti, ultimamente concentrato su pipeline ETL e API
ad alto throughput. Vengo da un percorso ibrido tra **data engineering**
e backend "classico", e mi muovo bene quando il problema sta nel mezzo:
modellazione del dato + servizio che lo espone.

Cerco un ruolo backend o data senior in cui poter portare ownership
end-to-end del servizio, non solo "ticket".
```

### `strengths.md` (settore non-tech, esempio cucina)
```markdown
**Resistenza nei picchi.** Ho gestito brigata di 12 persone in un
ristorante con 200 coperti la sera: ho imparato a tenere ritmo e
qualità anche quando si fa caldo davvero.

**Costo materia prima.** Negli ultimi 3 anni ho ridotto il food cost
di partita salata dal 34% al 28% lavorando sul menu e sul rapporto
con i fornitori, senza toccare la qualità.

**Team mentoring.** Ho formato 2 sous-chef che ora gestiscono
autonomamente le loro brigate.
```

## Anti-patterns

- ❌ Scrivere terza persona ("Mario è uno sviluppatore…") — il frontend rende il testo come voce diretta del candidato, terza persona suona alienante.
- ❌ Append a `Edit` invece di `Write` — finisce con due intro contraddittorie nello stesso file.
- ❌ Tabelle / header `#` / liste numerate verbose — la card UI ha già il proprio chrome.
- ❌ Saltare `about.md` / `strengths.md` dopo upload CV "perché tanto è scritto nel YAML" — il YAML non ha tono, gli scrittori producono CV sterili.
- ❌ Inserire path o nomi di file (`/jht_home/profile/summaries/about.md`) nel testo — l'utente non sa cosa siano.
- ❌ Scrivere oltre il cap di lunghezza — la card UI tronca / scrolla orizzontalmente, il messaggio si perde.

## See also

- `profile-yaml` — sister skill: dato strutturato che si aggiorna in parallelo a questi MD.
- `onboarding-flow` — quando in conversazione raccogliere i dati che alimentano questi MD.
- `agents/scrittore/scrittore.md` — l'agente downstream che legge questi MD per scrivere CV con voce.
