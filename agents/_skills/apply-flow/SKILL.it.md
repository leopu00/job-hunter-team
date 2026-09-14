<!-- @translation: it, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Come il CLOSER esegue una candidatura autorizzata con `apply_flow.py` — la macchina a stati con checkpoint (detect, fill, upload_cv, screening, review, submit), la ricevuta obbligatoria senza la quale `applied` non si scrive mai, e cosa fare per ogni esito, `blocked_human` prima di tutto. Usala per ogni posizione presa dalla coda. Del CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/closer_notices.py *)
---

# apply-flow — una candidatura, una ricevuta, nessun tentativo cieco

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

Dai a questo comando un timeout di almeno **10 minuti**: un accesso a LinkedIn può aspettare nel browser fino a 5 minuti il codice di verifica che l'utente manda su Telegram, e un comando ucciso mentre aspetta lascia scadere la richiesta del codice.

`PID`, `URL` e `CV` vengono dall'ultima lettura di `apply_gate.py queue` (skill
`apply-authorization`), mai dalla memoria.

## La macchina a stati

```
detect → fill → upload_cv → screening → review → submit → applied
                                                        ↘ blocked_human
```

- Ogni step completato si salva in un checkpoint (`$JHT_HOME/.cache/apply-flow/<id>.json`).
  Dopo un crash il flusso riprende dov'era: la compilazione si ripete, il click no.
- `submit_started` si salva **prima** del click. Se un processo muore dopo quella
  riga, l'esito è ignoto, e un esito ignoto non si clicca mai di nuovo: il flusso
  cerca una conferma sulla pagina e, senza, si blocca con `submit_outcome_unknown`.
- Il cancello si controlla all'avvio **e** subito prima del click. Un flag revocato
  mentre il form si compilava ferma l'invio.
- Oggi tre ricette complete: **Ashby**, **Greenhouse** (solo i suoi tre host pubblici, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, in HTTPS; la pagina si ricontrolla dopo ogni step) e **Lever** (solo `jobs.lever.co` e `jobs.eu.lever.co`, in HTTPS, ricontrollati allo stesso modo). LinkedIn: «candidati sul sito dell'azienda» prosegue su quel sito con la sua ricetta; Easy Apply accede con l'account dell'utente (sessione conservata, codice di verifica su Telegram) e compila la finestra. Ogni altra piattaforma si blocca per una persona.

## La ricevuta

`applied` si scrive solo quando il flusso ha **entrambe**:

1. uno screenshot della pagina di conferma, e
2. un URL o un testo di conferma.

Poi è il flusso stesso a registrare la candidatura con `applied_via = agent_closer`,
e a rileggere la riga per verificare che la scrittura sia avvenuta. Nessun altro
scrive quello stato: né tu, né il Capitano.

## Leggere l'esito

Una riga JSON su stdout: `status`, `state`, `reason`, `receipt`.

| `status` | Exit | Significato | Cosa fai |
|---|---|---|---|
| `applied` | 0 | inviata, ricevuta salvata, stato registrato | posizione successiva |
| `dry_run` | 0 | `mode: dry_run`: compilata, fermata prima del bottone, niente inviato | posizione successiva |
| `denied` | 1 | il cancello ha rifiutato (consenso spento, flag revocato, già inviata) | posizione successiva; mai ritentare |
| `retry_later` | 5 | la pagina dell'offerta per ora non risponde (5xx, timeout); non è uno stop, nessun avviso; il checkpoint ha `retry_after` | posizione successiva; la coda la ridà da sola dopo `retry_after` — mai rilanciarla prima |
| `blocked_human` | 3 | serve una persona; lo stop è nel riepilogo del giro | posizione successiva; mai ritentare |
| `blocked_human` risposte mancanti (`essential_facts_missing` con `missing`, `required_answer_missing` con `pending_question`) | 3 | non è uno stop e nulla è stato chiesto: al flusso servono risposte che non ha | ricava ciascuna da profilo, CV e annuncio e salvala (`application_answers.py save … --basis …`), poi rilancia il flusso; solo senza nessuna base `application_answers.py ask --position-id $PID --key K` (prompt del CLOSER, CL-08). Una domanda che hai fatto tiene la posizione finché l'utente risponde, al massimo un giorno per domanda |
| `email_channel` | 4 | il controllo di candidatura è un link `mailto:`, non un form; il checkpoint contiene `channel: email` e il `mailto_href` grezzo | esegui `email_application.py send` per questa posizione come dice la skill `email-application-flow`: legge questo checkpoint; non compilare mai un form web e non scrivere l'email a mano |
| `error` | 2 | profilo o CV illeggibile, argomenti sbagliati | fermati: `[BLOCKED]` al Capitano |

## `blocked_human` — cosa significa e cosa fai

Il flusso si ferma su qualunque cosa non possa fare con certezza:

| `reason` (esempi) | Causa tipica |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | un campo obbligatorio non ha risposta salvata; `pending_question` lo nomina (chiave, etichetta, tipo, opzioni, scope). All'utente non parte nulla finché non lanci `ask`; una risposta salvata fa ripartire il flusso dal checkpoint |
| `essential_facts_missing` / `essential_facts_unavailable` | prima del primo run di una posizione manca un dato che quasi ogni form chiede (data di inizio, preavviso, autorizzazione al lavoro, sponsorship, RAL, trasferimento, telefono); `missing` elenca le chiavi. Nulla è stato chiesto e nulla resta trattenuto |
| `captcha` / `two_factor` | il sito vuole verificare che ci sia una persona |
| `vacancy_closed` | l'annuncio non è più aperto: una pagina senza form, pulsante Apply e canale email lo dice, oppure l'URL ha rediretto alla lista delle posizioni, alle careers o alla home; nulla è stato compilato né inviato. Stop definitivo: un nuovo run non riapre la pagina finché l'utente non autorizza di nuovo la posizione. Uno screenshot della pagina è salvato accanto al checkpoint (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | un campo che la ricetta non sa compilare con una risposta salvata |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | il CV non si riesce ad allegare |
| `cv_pdf_layout_bad` | il PDF del CV non ha passato il controllo visivo (`pdf_layout_check.py`: testo schiacciato in una colonna stretta, una pagina quasi vuota, più di 2 pagine, font non incorporati, corpo del testo troppo piccolo): nulla è stato allegato né inviato. Lo Scrittore deve rigenerarlo; mai allegarlo a mano. L'anteprima di pagina 1 è salvata accanto al checkpoint: guardala |
| `cv_pdf_check_unavailable` | il PDF del CV non si è potuto misurare (poppler assente nel container, file illeggibile): nulla è stato allegato né inviato — un CV non misurato non è un pass. Il rimedio sta nel container, non nello Scrittore: segnalalo al Capitano |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` / `lever_dom_unrecognised` / `lever_form_missing` / `lever_apply_ambiguous` / `lever_form_ambiguous` / `generic_dom_unrecognised` | ancora nessuna ricetta per questa pagina, o il form non è quello che la ricetta conosce |
| `greenhouse_redirect_untrusted` | durante il flusso la pagina Greenhouse è uscita dai suoi tre host fidati |
| `lever_redirect_untrusted` | durante il flusso la pagina Lever è uscita da `jobs.lever.co` / `jobs.eu.lever.co` |
| `linkedin_dom_unrecognised` / `linkedin_form_missing` / `linkedin_form_ambiguous` / `linkedin_step_unrecognised` / `linkedin_apply_control_missing` / `linkedin_apply_ambiguous` / `linkedin_session_unavailable` / `linkedin_login_unrecognised` | la vacancy LinkedIn o la sua finestra Easy Apply non è quella che la ricetta conosce |
| `linkedin_credentials_missing` | `$JHT_HOME/credentials/linkedin.json` (`email`, `password`) manca, non è un file regolare 0600 di questo utente, o è vuoto: lo crea l'utente con lo script delle credenziali. Mai chiedere la password in chat |
| `linkedin_login_failed` | LinkedIn ha rifiutato l'accesso due volte: nessun nuovo tentativo finché l'utente non scrive credenziali nuove |
| `linkedin_login_code_missing` / `linkedin_login_code_undelivered` | il codice di verifica LinkedIn chiesto su Telegram non è arrivato in tempo (o la richiesta non è arrivata su Telegram, o LinkedIn non ha accettato il codice — non conta mai come accesso fallito): un nuovo giro chiede un codice nuovo |
| `linkedin_challenge` | LinkedIn mostra un captcha o un controllo di sicurezza: l'utente lo risolve sullo schermo live, poi riautorizza la posizione |
| `linkedin_redirect_untrusted` / `application_redirect_untrusted` | la pagina LinkedIn è uscita da LinkedIn (`www.linkedin.com` o una pagina di paese come `es.linkedin.com`), oppure l'indirizzo aziendale che dà non è una pagina HTTPS fuori da LinkedIn (o è un secondo passaggio) |
| `linkedin_follow_not_cleared` | la casella «segui l'azienda» non si è potuta togliere prima di Submit: non parte niente |
| `linkedin_throttled` / `linkedin_login_retry` / `linkedin_interval_invalid` / `linkedin_dry_run_signed_out` | **negato, non bloccato**: le candidature LinkedIn sono distanziate (`linkedin_min_interval_minutes`, predefinito 20), l'accesso è fallito una volta e il prossimo giro riprova una volta, oppure quell'impostazione non è un numero intero di minuti. La coda riprova da sola Un dry run non fa mai l'accesso: senza una sessione LinkedIn salvata è negato come `linkedin_dry_run_signed_out`. |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | due indirizzi mailto di candidatura diversi, oppure il form di candidatura, i suoi campi o il suo bottone di invio non stanno in un unico form (newsletter, footer e form demo non ne fanno mai parte) |
| `form_error` / `field_invalid` / `submit_unavailable` | il form segnala un errore, il formato di un campo è rifiutato, o il bottone di invio manca o è disabilitato |
| `url_refused` / `checkpoint_invalid` | l'URL della candidatura non ha passato il controllo sugli indirizzi pubblici, o il checkpoint salvato non si legge |
| `page_unavailable` / `browser_uncertainty` | la pagina o il browser hanno ceduto a metà flusso |
| `page_not_found` / `bot_protection` / `page_temporarily_unavailable` | la pagina dell'offerta non c'è più (404/410 senza prove di offerta chiusa), un controllo anti-bot ha fermato il browser (dopo un tentativo in un browser visibile), o il sito non ha risposto tre volte in un giorno. Un singolo 5xx o timeout NON è uno stop: il checkpoint dice `retry_later`, la coda ridà la posizione più tardi da sola e nessuno viene avvisato. Il checkpoint tiene `http_status` e `final_url` |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | l'invio è stato cliccato ma la conferma non è certa |
| `receipt_screenshot_failed` | la conferma era visibile ma il suo screenshot non si è potuto salvare |
| `submit_outcome_unknown` | un giro precedente ha avviato l'invio e non ha lasciato ricevuta |
| `applied_record_failed` | la ricevuta c'è ma lo stato non si è potuto registrare — la candidatura quasi certamente è partita |
| `login_required` / `account_creation` | il sito vuole un accesso o un account nuovo prima della candidatura: il CLOSER non accede mai e non crea mai account |
| `generic_form_missing` / `generic_form_unrecognised` / `application_form_embedded` / `application_redirect_untrusted` | un sito aziendale: nessun modulo di candidatura, un modulo che la ricetta generica non riesce a individuare, un modulo incorporato da un altro host (il detail lo nomina), o un pulsante Candidati che porta a un sito senza ricetta |
| `cover_letter_required` / `pre_submit_screenshot_failed` | il modulo richiede il file di una lettera di presentazione · il modulo compilato non si è potuto fotografare prima del click |

Cosa fai per ogni altro motivo (le risposte mancanti sono sopra):

1. **Niente su quella posizione.** Il flusso ha già scritto il checkpoint e
   messo lo stop nel riepilogo del giro. Non avvisare l'utente tu.
2. **Non ritentarla.** Né adesso, né «un'altra volta fra qualche minuto». La coda
   la tiene ferma (`checkpoint_blocked_human`) finché l'utente non la autorizza di nuovo.
3. **Passa alla posizione successiva** della coda.

Ritentare una posizione bloccata è il tentativo cieco che questo design esiste
per impedire: su un captcha brucia l'account dell'utente, su un esito ignoto
manda una seconda lettera allo stesso recruiter.

## Siti aziendali — la ricetta generica

Quando nessun ATS è riconosciuto e la pagina non è un canale `mailto:`, il flusso
usa `apply_generic.py` sul sito dell'azienda: trova l'UNICO modulo di candidatura
(un caricamento del CV, oppure nome ed email con un pulsante Candidati — anche
dietro un pulsante Candidati o su una pagina collegata dello stesso sito),
compila i campi dalle loro etichette (profilo per nome, email, telefono, link;
risposte salvate per le domande) e non tocca mai un modulo di newsletter,
contatti, ricerca o accesso. Il modulo compilato viene fotografato prima del
click; senza una conferma riconoscibile (testo o URL) l'esito è
`submit_outcome_unknown`, mai un secondo click. Un pulsante Candidati che porta a
un ATS noto passa la posizione a quella ricetta.

**Un riepilogo per giro.** Nessuno stop viene avvisato da solo: ogni `blocked_human`
che non è una domanda del modulo (siti come `ats_unsupported`, `ats_conflict`, `linkedin_easy_apply`, `application_form_embedded`, `page_not_found`, `bot_protection`, `page_temporarily_unavailable`; LinkedIn, CV, offerte chiuse, esiti
incerti, stop del canale email) aspetta l'UNICO messaggio che mandi allo STEP 6 con
`python3 /app/shared/skills/closer_notices.py flush`. Partono subito solo una domanda
che chiedi esplicitamente, i fatti essenziali e un codice di verifica LinkedIn.
Ogni avviso arriva all'utente nella lingua del suo profilo.

## Verificare una candidatura dopo

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` e un `applied_at` non vuoto = il flusso l'ha registrata.
