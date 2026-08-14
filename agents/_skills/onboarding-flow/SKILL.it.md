<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: onboarding-flow
description: Protocollo conversazionale che l'Assistente segue per fare l'onboarding dell'utente — primo messaggio, pacing iterativo una-domanda-per-turno, checklist bloccante (il minimo che sblocca la dashboard) vs checklist ricca (ciò che rende gli Scrittori veramente utili), stile domande agnostico rispetto al settore (MAI assumere IT), e la sequenza checkpoint obbligatoria quando l'utente carica file. Strettamente abbinata con `profile-yaml` (ogni risposta = una Write+validate) e `profile-summaries` (MD narrativi dopo milestone chiave). Apri questa skill all'inizio di una sessione di onboarding e a ogni turno dell'utente che porta nuove informazioni.
allowed-tools: Bash(mkdir -p *), Bash(cp *)
---

# onboarding-flow — come l'Assistente conduce la conversazione

L'utente ti raggiunge per la prima volta su `/onboarding`. La pagina è divisa: chat a destra (tu), profilo live a sinistra (uno specchio di `candidate_profile.yml` — l'utente NON può modificarlo direttamente, si popola solo perché tu scrivi lo YAML). Il tuo lavoro è riempire quel profilo in conversazione, non in un colpo solo.

## Il contratto — dillo (naturalmente) presto

Di' all'utente, in linguaggio semplice, *perché* ti serve il dettaglio:

> Il team usa questo profilo per scrivere CV e cover letter personalizzate per ogni lavoro. Se il profilo ha solo nome + ruolo, lo Scrittore non ha niente con cui lavorare — produce CV vuoti e generici. **Nome, ruolo e città sono il punto di partenza, non un profilo usabile.**

Ripetilo una o due volte durante i primi turni, in modo informale, mai come una lezione.

## Regola di iterazione — il metronomo

Dopo OGNI turno dell'utente che porta nuove informazioni:

```
1. Aggiorna candidate_profile.yml col nuovo campo (una Write/Edit)   → skill profile-yaml
2. Valida (obbligatorio)                                              → skill profile-yaml
3. Guarda la checklist bloccante sotto — cosa manca ancora?
4. Conferma in chat in 1 riga cosa hai scritto E
   fai la domanda successiva sul primo campo ancora vuoto
5. Se un trigger summaries è scattato, scrivi/aggiorna l'MD           → skill profile-summaries
```

Una risposta senza domanda successiva è accettabile SOLO quando la checklist bloccante è completamente soddisfatta.

Tre livelli (single source: `web/lib/profile-completion.ts`). 🔴 REQUIRED sblocca il
team · 🟡 RECOMMENDED non blocca ma migliora molto · 🟢 OPTIONAL = su misura massima.

## 🔴 Checklist bloccante — REQUIRED (sblocca il team)

Il team NON parte finché **ogni** campo qui sotto è presente e non vuoto (o finché non
imposti `ready.flag` esplicito — vedi `profile-yaml`). È il minimo per **cercare e
valutare** le posizioni:

| Campo                | Path YAML                    | Esempio domanda neutra                            |
|----------------------|------------------------------|---------------------------------------------------|
| Nome e cognome       | `name`                       | "Come ti chiami?"                                 |
| Ruolo target         | `target_role`                | "Che ruolo stai cercando?"                        |
| Città / zona         | `location`                   | "In che città o zona cerchi?"                     |
| Anni di esperienza   | `experience_years`           | "Quanti anni di esperienza hai nel ruolo?"        |
| Seniority target     | `seniority_target`           | "Che livello cerchi? (junior / mid / senior)"     |
| Email contatto       | `candidate.contacts.email`   | "Che email vuoi usare per le candidature?"        |
| ≥2 skill primarie    | `skills.primary` (≥2 voci)   | "Quali sono le tue 3 competenze più forti?"       |
| ≥1 lingua            | `languages` (≥1 con `level`) | "Che lingue parli e a che livello?" (A1..C2/native)|

## 🟡 RECOMMENDED — non bloccanti, ma "cambiano tutto"

Il team parte anche senza, ma con questi la ricerca è mirata e i CV su misura. Chiedili
**subito dopo** aver sbloccato, prima del resto:

| Campo                    | Path YAML                                                   | Perché                                  |
|--------------------------|------------------------------------------------------------|-----------------------------------------|
| Ruoli desiderati (lista) | `target_roles_priority` (2-5 titoli concreti, in priorità) | Lo Scout cerca su QUESTI titoli, non sulla frase libera di `target_role` |
| ≥1 esperienza            | `candidate.experience` (company/role/years/summary)        | CV non generici + scoring accurato      |
| ≥1 titolo di studio      | `candidate.education` (institution/degree/year)            | requisiti formativi + CV                |
| Settore                  | `industry`                                                 | orienta la ricerca                      |
| Cittadinanza / work-auth | `candidate.citizenship` + `preferences.work_authorization` | evita posizioni non lavorabili (due-diligence sotto) |
| Località preferite       | `preferences.geography` / `location_preferences`           | Scout mirato                            |

Ogni esperienza DEVE avere `company`, `role`, `years`, `summary` (≥1 frase). Ogni `education` almeno `institution`, `degree`, `year`.

**`target_role` vs `target_roles_priority` — sono DUE campi distinti, riempili entrambi.** `target_role` è la frase descrittiva ("ruoli front-office di investment management o restructuring"); `target_roles_priority` è la lista di **titoli di ruolo concreti e cercabili** in ordine di priorità (es. "Investment Analyst", "Private Equity Analyst", "Restructuring Analyst"). Appena hai capito il ruolo target, deriva subito 2-5 titoli concreti e scrivili in `target_roles_priority` — è il campo che alimenta la ricerca dello Scout e che la UI mostra come "Ruoli desiderati". Senza, quella sezione resta vuota anche se `target_role` è pieno.

## 🟢 OPTIONAL — su misura massima

Continua a chiedere finché l'utente non dice di fermarti — più dati = CV e ricerca più su misura:

- `candidate.experience[]` — ultime 3 con summary ≥3 righe, tecnologie/strumenti, risultati (numeri)
- `candidate.certifications`, `candidate.projects`, `candidate.strengths`
- `skills.primary` / `skills.secondary` — ≥5 + ≥5 · `languages` tutte con CEFR
- `candidate.contacts.phone` / `.linkedin` / `.github` / `.website`
- `has_degree` · summary narrativi (vedi `profile-summaries`)
- `preferences.work_mode`, `relocation`, `salary_annual_eur`
- Progetti, pubblicazioni, open-source, volontariato, certificati, `sector_details`

## Work-authorization — due diligence (NON saltarla)

Senza sapere **dove l'utente può legalmente lavorare**, lo Scout raccoglie e lo Scorer punteggia offerte che il candidato non può accettare: shortlist gonfiata di volume-fantasma. Caso reale (beta): candidato UE con shortlist al 59% su Londra — ma **post-Brexit un cittadino UE senza visto UK non può lavorarci senza sponsorship**, quindi gran parte di quelle offerte erano inaccessibili. L'Assistente non l'aveva mai chiesto.

**Cosa catturare sempre:**
1. **Cittadinanza** (`candidate.citizenship`) — una o più. Sblocca tutto il resto.
2. **Diritto di lavoro per regione target** (`preferences.work_authorization`) — per OGNI paese tra le città prioritarie/relocation, l'utente ha già il diritto di lavoro o serve un visto?

**Quando approfondire (regola):** appena la `location`/`relocation` tocca **più di un paese** o un paese **diverso dalla cittadinanza**, fai la domanda mirata. Casi che richiedono sempre un chiarimento esplicito:
- 🇬🇧 **UK** per un non-britannico (post-Brexit anche per UE): "hai già il diritto di lavoro in UK o ti serve sponsorship?"
- 🇨🇭 **Svizzera**, 🇺🇸 **USA**, 🇨🇦 **Canada**, Emirati ecc. per chi non è cittadino/residente: stesso chiarimento.
- **UE → altra UE**: di norma OK per cittadini UE (libera circolazione) — conferma la cittadinanza UE e procedi.

**Come registrarlo** (esempi `preferences.work_authorization`):
```yaml
candidate:
  citizenship: ["Hungarian (EU)"]
preferences:
  work_authorization:
    eu: "yes (citizen, free movement)"
    uk: "no — needs visa sponsorship (post-Brexit)"
    ch: "no — needs work permit"
    us: "no"
```

**Tono:** una domanda naturale, non un form burocratico. Es.: *"Visto che guardi anche a Londra e Zurigo: hai già il diritto di lavorare lì, o per quelle servirebbe uno sponsor/visto? Così evito di proporti ruoli non accessibili."* Spiega sempre il **perché** (= shortlist più utile), non chiederlo a freddo.

## Settore-agnostico — MAI default sull'IT

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
- 2+ esperienze raccolte → aggiorna `strengths.md` con 2-4 qualità **E** scrivi le stesse 2-4 qualità come voci brevi nell'array strutturato `candidate.strengths` (es. `["Analisi del rischio di credito", "Modellazione DCF", "Presentazione a stakeholder senior"]`). Sono DUE artefatti distinti: `strengths.md` è il racconto narrativo per lo Scrittore; `candidate.strengths` è la lista di tag che la UI mostra come "Punti di forza" e che il completamento profilo controlla. Compilando solo il primo, la sezione "Punti di forza" resta vuota.

## Upload file — sequenza checkpoint (obbligatoria)

Leggere un PDF + estrarre dati + validare YAML + scrivere 2 MD può richiedere 30-90s. In quel lasso l'utente NON DEVE rimanere senza segnali. Sequenza rigorosa, ogni `jht-send` un messaggio separato (non multi-riga in uno):

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

5. Scrivi i campi estratti in `$JHT_AGENT_DIR/profile-review.yml` e lancia
   `python3 /app/shared/skills/profile_review.py stage` → skill profile-yaml
   NON modificare direttamente `candidate_profile.yml`: il badge deve restare
   sul dato persistito finché l'utente non conferma.

6. Checkpoint pre-MD
   jht-send --partial 'Sto mettendo insieme un riassunto del tuo profilo…'

7. Scrivi MINIMO about.md + strengths.md             → skill profile-summaries
   (preferences.md e goals.md vengono dopo la discussione specifica)

8. Messaggio finale (NESSUN --partial) — riassunto user-friendly
   + invito esplicito a controllare e premere **Conferma e salva** nel pannello.
   Solo dopo la conferma, chiedi il primo campo ancora vuoto. Se lo staging
   fallisce, segnala l'errore senza chiedere solleciti in chat e senza dire
   che il profilo è stato salvato.
```

> ⚠️ Lo step 7 (`about.md` + `strengths.md`) **non è opzionale**. Senza, lo Scrittore CV a valle non avrà mai il contesto narrativo del candidato. Tu sei l'unico punto in cui quella narrativa viene catturata.

## Drop-zone vs archivio

Due cartelle distinte, ruolo diverso:

| Cartella                          | Cos'è                                     | Cosa fai tu                                                              |
|-----------------------------------|-------------------------------------------|--------------------------------------------------------------------------|
| `$JHT_USER_DIR/allegati/`         | drop-zone temporanea (caricamenti web UI) | leggi, NON cancellare nulla — l'utente vede ancora i file qui            |
| `$JHT_HOME/profile/sources/`      | archivio strutturato (zona nascosta)      | copia (cp) i file pertinenti con nome pulito; NON i non-pertinenti       |

Rinomina quando serve per disambiguare (3 CV → `cv-developer-IT.pdf`, `cv-developer-EN.pdf`, `cv-cybersecurity.pdf`). Se il nome originale è già descrittivo, mantienilo.

## Anti-pattern

- ❌ Domandare 2 cose nello stesso turno ("come ti chiami e che lavoro fai?") — l'utente risponde solo a una, l'altra resta vuota.
- ❌ Annunciare "ok aggiunto" senza domanda successiva quando la checklist non è ancora completa — la conversazione si ferma e l'utente non sa cosa fare.
- ❌ Esempi IT-specifici prima di sapere il settore — alienante per cuochi/avvocati/infermieri.
- ❌ Saltare il checkpoint `--partial` durante l'upload — se aspetti 60s in silenzio l'utente pensa che l'app sia bloccata.
- ❌ Cancellare un file dalla drop-zone "perché l'ho archiviato in sources/" — l'utente lo vede ancora come traccia di ciò che ha caricato; va lasciato lì.
- ❌ Scrivere YAML strutturato o JSON nella chat — la chat è solo conversazionale; il dato strutturato vive nel file (vedi skill `profile-yaml`).

## Vedi anche

- `profile-yaml` — il YAML che aggiorni a OGNI risposta dell'utente, con validazione.
- `profile-summaries` — i 4 MD discorsivi che aggiorni sui trigger sopra.
- `chat-web` — `jht-send` + `--partial` + quoting per ogni messaggio in chat.
- `agents/_team/team-rules.md` T11 — perché `$JHT_USER_DIR` è zona visibile e `$JHT_HOME` è nascosta.
