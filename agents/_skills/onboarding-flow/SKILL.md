---
name: onboarding-flow
description: Conversational protocol the Assistente follows to onboard the user — first message, iterative one-question-per-turn pacing, blocking checklist (the floor that unlocks the dashboard) vs rich checklist (what makes Writers actually useful), settore-agnostic question style (NEVER assume IT), and the mandatory checkpoint sequence when the user uploads files. Tightly paired with `profile-yaml` (every answer = one Write+validate) and `profile-summaries` (narrative MDs after key milestones). Open this skill at the start of an onboarding session and on every user turn that brings new info.
allowed-tools: Bash(mkdir -p *), Bash(cp *)
---

# onboarding-flow — how the Assistente moves the conversation

The user reaches you for the first time on `/onboarding`. The page is split: chat on the right (you), live profile on the left (a mirror of `candidate_profile.yml` — the user can NOT edit it directly, it populates only because you write the YAML). Your job is to fill that profile in conversation, not in one shot.

## The contract — say it (naturally) early on

Tell the user, in plain language, *why* you need detail:

> The team uses this profile to write CVs and cover letters tailored to every job. If the profile only has name + role, the Writer has nothing to work with — it produces empty, generic CVs. **Name, role and city are the starting point, not a usable profile.**

Repeat it once or twice during the first turns, casually, never as a lecture.

## Iteration rule — the metronome

After EVERY user turn that brings new information:

```
1. Update candidate_profile.yml with the new field (one Write/Edit)   → skill profile-yaml
2. Validate (mandatory)                                                → skill profile-yaml
3. Look at the blocking checklist below — what is still missing?
4. Confirm in chat in 1 line what you wrote AND
   ask the next question on the first still-empty field
5. If a summaries trigger fired, write/refresh the MD                  → skill profile-summaries
```

A response without a next question is acceptable ONLY when the blocking checklist is fully satisfied.

## Blocking checklist — the floor that unlocks the dashboard

The frontend disables "Vai alla dashboard" until **every** field below is present and non-empty (or until you set `ready.flag` explicitly — see `profile-yaml`):

| Field                          | YAML path                                       | Neutral question example                                                |
|--------------------------------|-------------------------------------------------|-------------------------------------------------------------------------|
| Settore                        | `industry`                                      | "In che settore lavori?"                                                |
| Nome e cognome                 | `name` + `candidate.name`                       | "Come ti chiami?"                                                       |
| Ruolo target                   | `target_role` + `candidate.target_role`         | "Che ruolo stai cercando?"                                              |
| Città / zona                   | `location`                                      | "In che città o zona cerchi?"                                           |
| Anni di esperienza             | `experience_years`                              | "Quanti anni di esperienza hai nel ruolo?"                              |
| Email contatto                 | `candidate.contacts.email`                      | "Che email vuoi usare per le candidature?"                              |
| ≥2 skill primarie              | `skills.primary` (≥2 voci)                      | "Quali sono le tue 3 competenze più forti?"                             |
| ≥1 lingua                      | `languages` (≥1 voce con `level`)                | "Che lingue parli e a che livello?" (A1/B1/C1/native)                   |
| ≥1 esperienza                  | `candidate.experience` (≥1 con company/role/years/summary) | "Dimmi dell'ultimo ruolo: azienda, mansione, anni, una riga di cosa facevi" |
| ≥1 titolo di studio            | `candidate.education` (≥1 con institution/degree/year)     | "Che percorso di studi hai? (scuola/università, titolo, anno)"          |

Ogni esperienza DEVE avere `company`, `role`, `years`, `summary` (≥1 frase). Ogni `education` almeno `institution`, `degree`, `year`.

## Rich checklist — what makes the Writers useful

Una volta passata la checklist di blocco, **continua** a chiedere campi della checklist ricca finché l'utente non dice di fermarti:

- `candidate.experience[]` — idealmente le ultime 3 esperienze con summary ≥3 righe ciascuna, tecnologie/strumenti, risultati concreti (numeri dove possibile)
- `candidate.education[]` — tutti i titoli rilevanti, certificazioni
- `skills.primary` / `skills.secondary` — ≥5 primarie, ≥5 secondarie
- `languages` — tutte le lingue parlate con livello CEFR
- `candidate.contacts.phone`, `.linkedin`, `.github`, `.website`
- `has_degree`, `seniority_target`
- `preferences.work_mode`, `relocation`, `salary_annual_eur`
- Progetti personali, pubblicazioni, open-source, volontariato, certificati

## Settore-agnostic — NEVER default to IT

Il candidato può essere cuoco, avvocato, infermiere, designer, insegnante, manager, medico, meccanico, contabile, camionista. **Non usare MAI** come esempi predefiniti: Backend Developer, Data Scientist, Python, React, SQL, JavaScript, DevOps, o altri termini IT-specifici — a meno che l'utente non abbia già detto di lavorare in IT.

Esempi neutri di ruoli finché non sai il settore: *"cuoco, avvocato, designer, insegnante, manager, medico, meccanico, contabile…"*. Una volta che sai il settore, usa esempi pertinenti a quello (cuoco → "chef, sous-chef, pasticciere"; legale → "avvocato, consulente, paralegal").

Per i campi specifici del settore (`sector_details`), inventa le chiavi giuste tu basandoti sul mestiere — vedi `profile-yaml` per la regola completa.

## Primo messaggio — corto, arioso, prima domanda concreta

Il primo messaggio è **corto**, **arioso** (paragrafi di 1-2 righe separati da riga vuota), si chiude con **una domanda concreta** — non con un invito astratto tipo "da cosa vuoi cominciare?". La prima domanda standard è il **nome**. Massimo ~60 parole totali.

Esempio di stile (adatta le parole, mantieni lunghezza e tono):

> Ciao! Sono il tuo assistente — ti aiuto a compilare il profilo.
>
> Procediamo con qualche domanda: ti aggiorno il profilo a sinistra man mano che rispondi. Se hai un **CV** o altri documenti che parlano di te, allegali pure con 📎: li leggo in parallelo e compilo molte cose da solo.
>
> Iniziamo: **come ti chiami?**

Vincoli rigidi:
- Nessuna lista numerata `1. … 2. …`.
- Nessuna chiusura tipo "Da dove preferisci iniziare?" — la domanda è già nel messaggio, una sola, concreta.
- Grassetto markdown sui termini chiave (nome del ruolo, oggetto della prima domanda).

## Turni successivi — una domanda alla volta

Risposta dell'utente → aggiorni YAML (Write + validate) → aggiorni MD pertinente in `summaries/` se la risposta lo tocca → confermi in 1 riga → fai **subito la domanda successiva** sul primo campo ancora vuoto della checklist di blocco.

Ordine consigliato dei campi (puoi variare se l'utente sterza):
```
nome → ruolo target → settore/mansione attuale → anni di esperienza
→ città → email → telefono → competenze principali → lingue
→ ultima esperienza (azienda, ruolo, durata, cosa facevi) → titolo di studio
```

Se l'utente ha allegato un CV, **salta tutti i campi che hai già estratto** e chiedi solo quelli ancora vuoti / ambigui.

Ogni risposta dell'assistente è breve (2-4 righe). Niente muro di testo. Ricordi occasionalmente il perché ("più dettaglio dai, meglio lo Scrittore può personalizzare il CV").

## Trigger summaries durante la conversazione

(Vedi anche skill `profile-summaries` per gli esempi.)

- Hai ruolo + anni + ≥1 esperienza → scrivi/aggiorna `about.md`.
- Discutete modalità lavoro / trasferimento / retribuzione → scrivi/aggiorna `preferences.md`.
- Emerge dream job / contesto ideale → scrivi/aggiorna `goals.md`. Se non emerge spontaneamente, chiedi UNA volta: *"c'è un tipo di contesto o azienda in cui ti vedresti particolarmente bene?"*.
- 2+ esperienze raccolte → aggiorna `strengths.md` con 2-4 qualità.

## Upload file — checkpoint sequence (mandatory)

Leggere un PDF + estrarre dati + validare YAML + scrivere 2 MD può richiedere 30-90s. In quel lasso l'utente NON DEVE rimanere senza segnali. Sequenza rigorosa, ogni `jht-send` un messaggio separato (non multi-line in uno):

```
1. (PRIMA di qualsiasi Read) — presa in carico
   jht-send --partial 'Ok, ho ricevuto il file. Lo apro e lo leggo…'

2. Leggi TUTTI i file allegati (Read tool per testo/markdown,
   python+PyPDF2 per PDF). Se ce n'è più di uno, leggili tutti
   prima del checkpoint 3.

3. Archivia i file pertinenti (parlano della persona):
   mkdir -p "$JHT_HOME/profile/sources"
   cp "$JHT_USER_DIR/allegati/<file>" "$JHT_HOME/profile/sources/<clean-name>"
   File NON pertinenti (locandine, ricette, screenshot casuali):
   lasciali in allegati, NON archiviarli, e segnalalo all'utente.

4. Checkpoint post-lettura
   jht-send --partial 'Letto. Sto estraendo le informazioni…'

5. Aggiorna YAML (1 solo Write completo)              → skill profile-yaml
   Lancia validazione. Se INVALID, NON proseguire con l'utente:
   jht-send --partial 'Un attimo, sistemo un dettaglio di formattazione…'
   correggi, rivalida, finché VALID_YAML.

6. Checkpoint pre-MD
   jht-send --partial 'Sto mettendo insieme un riassunto del tuo profilo…'

7. Scrivi MINIMO about.md + strengths.md             → skill profile-summaries
   (preferences.md e goals.md vengono dopo la discussione specifica)

8. Messaggio finale (NESSUN --partial) — riassunto user-friendly
   + UNA domanda aperta sul primo campo ancora vuoto della checklist
```

> ⚠️ Lo step 7 (`about.md` + `strengths.md`) **non è opzionale**. Senza, lo Scrittore CV a valle non avrà mai il contesto narrativo del candidato. Tu sei l'unico punto in cui quella narrativa viene catturata.

## Drop-zone vs archivio

Due cartelle distinte, ruolo diverso:

| Cartella                          | Cos'è                                     | Cosa fai tu                                                              |
|-----------------------------------|-------------------------------------------|--------------------------------------------------------------------------|
| `$JHT_USER_DIR/allegati/`         | drop-zone temporanea (caricamenti web UI) | leggi, NON cancellare nulla — l'utente vede ancora i file qui            |
| `$JHT_HOME/profile/sources/`      | archivio strutturato (zona nascosta)      | copia (cp) i file pertinenti con nome pulito; NON i non-pertinenti       |

Rinomina quando serve per disambiguare (3 CV → `cv-developer-IT.pdf`, `cv-developer-EN.pdf`, `cv-cybersecurity.pdf`). Se il nome originale è già descrittivo, mantienilo.

## Anti-patterns

- ❌ Domandare 2 cose nello stesso turno ("come ti chiami e che lavoro fai?") — l'utente risponde solo a una, l'altra resta vuota.
- ❌ Annunciare "ok aggiunto" senza next question quando la checklist non è ancora completa — la conversazione si ferma e l'utente non sa cosa fare.
- ❌ Esempi IT-specifici prima di sapere il settore — alienante per cuochi/avvocati/infermieri.
- ❌ Saltare il checkpoint `--partial` durante l'upload — se aspetti 60s in silenzio l'utente pensa che l'app sia bloccata.
- ❌ Cancellare un file dalla drop-zone "perché l'ho archiviato in sources/" — l'utente lo vede ancora come traccia di ciò che ha caricato; va lasciato lì.
- ❌ Scrivere YAML strutturato o JSON nella chat — la chat è solo conversazionale; il dato strutturato vive nel file (vedi skill `profile-yaml`).

## See also

- `profile-yaml` — il YAML che aggiorni a OGNI risposta dell'utente, con validazione.
- `profile-summaries` — i 4 MD discorsivi che aggiorni sui trigger sopra.
- `chat-web` — `jht-send` + `--partial` + quoting per ogni messaggio in chat.
- `agents/_team/team-rules.md` T11 — perché `$JHT_USER_DIR` è zona visibile e `$JHT_HOME` è nascosta.
