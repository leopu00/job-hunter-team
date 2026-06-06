<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: profile-summaries
description: Scrivi i 4 riassunti narrativi Markdown sotto `$JHT_HOME/profile/summaries/` che complementano lo YAML strutturato. Gli Scrittori a valle NE HANNO BISOGNO — uno YAML da solo produce CV sterili perché non ha voce, né narrativa, né posizionamento. Responsabilità dell'Assistente. I nomi file sono FISSI (il frontend ignora qualsiasi altro); sempre scritti in prima persona dell'utente ("sono uno sviluppatore…"); sempre riscritti per intero (Write, non Edit append) — sono snapshot del presente, non log append-only.
allowed-tools: Bash(mkdir -p *)
---

# profile-summaries — la voce del candidato su disco

Lo YAML strutturato è ottimo per filtri e match ma non dice nulla su *chi* è il candidato. I 4 file MD in `summaries/` portano la narrativa di cui gli Scrittori hanno bisogno per produrre CV che suonano come una persona, non una lista di checkbox.

## I 4 file (nomi file FISSI)

| File             | Titolo UI mostrato all'utente | Cosa contiene                                                            | Limite lunghezza |
|------------------|----------------------------|-----------------------------------------------------------------------------|-----------|
| `about.md`       | **Chi sei**                 | Riassunto persona: ruolo attuale/target, anni, settore, tratto distintivo   | ~400 char |
| `preferences.md` | **Preferenze raccontate**   | Modalità di lavoro, trasferimento, retribuzione, orari, ambiente            | ~400 char |
| `goals.md`       | **Obiettivi e dream job**   | Cosa cerca nei prossimi 1-3 anni, contesto/azienda dei sogni                | ~500 char |
| `strengths.md`   | **Punti di forza**          | 2-4 qualità concrete con esempio breve per ciascuna                          | ~500 char |

Path: `$JHT_HOME/profile/summaries/<file>.md`. Crea la dir se manca:
```bash
mkdir -p "$JHT_HOME/profile/summaries"
```

Nomi file diversi (es. `about-mario.md`, `goals_v2.md`) sono **silenziosamente ignorati** dal frontend.

## Vincoli di stile (vincolanti)

- **Markdown semplice**: paragrafi separati da riga vuota, `**grassetto**` per sottolineare, liste solo se aiutano la leggibilità.
- **Nessuna tabella, nessun header `#`** — questi MD vivono in card UI già titolate.
- **Lunghezza**: rispetta il limite. Niente muri di testo.
- **Prima persona dell'utente**: `"sono uno sviluppatore…"`, `"preferisco lavorare da remoto…"`. Mai terza persona (`"Mario è…"`).
- **Tono**: naturale, come se l'utente parlasse di sé a un amico esperto del settore.
- **Mai path / nomi file / jargon** nel testo — l'utente legge "il riassunto", non "about.md".

## Regola di aggiornamento — riscrivi per intero, mai append

Quando arriva un'informazione che cambia il senso di un MD esistente, **riscrivi il file da capo** (tool `Write`, NON `Edit` append). Sono snapshot del presente, non log cronologici. Un append rischia di lasciare paragrafi obsoleti accanto al nuovo.

## Trigger — quando scrivere ciascun file

| File              | Quando scrivilo per la prima volta / aggiornalo                                                                                                                                                       |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `about.md`        | Hai ruolo + anni + ≥1 esperienza. Riscrivilo ogni volta che cambia qualcosa di sostanziale (ruolo, seniority, settore).                                                                                |
| `preferences.md`  | Hai discusso con l'utente almeno una di: modalità di lavoro, trasferimento, retribuzione. Aggiorna ogni volta che una di queste cambia.                                                                |
| `goals.md`        | L'utente ha raccontato aspirazioni / contesto ideale / dream job (anche parziale). Non forzare la mano: se non emerge spontaneamente, **chiedi una sola volta** "c'è un tipo di contesto o azienda in cui ti vedresti particolarmente bene?". |
| `strengths.md`    | Hai raccolto **2+ esperienze o progetti rilevanti**. Estrai 2-4 qualità ricorrenti dal pattern.                                                                                                       |

## Regola al boot — primo CV caricato

Quando l'utente carica un CV, dopo aver popolato lo YAML scrivi MINIMO **`about.md` + `strengths.md`** nello stesso turno. Hai abbastanza dati (ruolo, anni, esperienze, competenze, tono) per farlo subito; non rimandare. Saltare questo step significa che lo Scrittore CV a valle non avrà mai il contesto narrativo del candidato → produrrà CV sterili. Tu sei l'unico punto in cui quella narrativa viene catturata.

`preferences.md` e `goals.md` arriveranno nei turni successivi (dopo la discussione specifica).

## Esempi

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

## Anti-pattern

- ❌ Scrivere in terza persona ("Mario è uno sviluppatore…") — il frontend rende il testo come voce diretta del candidato, la terza persona suona alienante.
- ❌ Append con `Edit` invece di `Write` — finisce con due intro contraddittorie nello stesso file.
- ❌ Tabelle / header `#` / liste numerate verbose — la card UI ha già il proprio chrome.
- ❌ Saltare `about.md` / `strengths.md` dopo upload CV "perché tanto è scritto nello YAML" — lo YAML non ha tono, gli scrittori producono CV sterili.
- ❌ Inserire path o nomi di file (`/jht_home/profile/summaries/about.md`) nel testo — l'utente non sa cosa siano.
- ❌ Scrivere oltre il limite di lunghezza — la card UI tronca / scrolla orizzontalmente, il messaggio si perde.

## Vedi anche

- `profile-yaml` — skill sorella: dato strutturato che si aggiorna in parallelo a questi MD.
- `onboarding-flow` — quando in conversazione raccogliere i dati che alimentano questi MD.
- `agents/scrittore/scrittore.md` — l'agente a valle che legge questi MD per scrivere CV con voce.
