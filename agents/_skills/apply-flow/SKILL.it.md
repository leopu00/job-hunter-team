<!-- @translation: it, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Come il CLOSER esegue una candidatura autorizzata con `apply_flow.py` — la macchina a stati con checkpoint (detect, fill, upload_cv, screening, review, submit), la ricevuta obbligatoria senza la quale `applied` non si scrive mai, e cosa fare per ogni esito, `blocked_human` prima di tutto. Usala per ogni posizione presa dalla coda. Del CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# apply-flow — una candidatura, una ricevuta, nessun tentativo cieco

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

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
- Oggi due ricette complete: **Ashby** e **Greenhouse** (solo i suoi tre host pubblici, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, in HTTPS; la pagina si ricontrolla dopo ogni step). Ogni altra piattaforma si blocca per una persona.

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
| `blocked_human` | 3 | serve una persona; l'utente è già stato avvisato | posizione successiva; mai ritentare |
| `blocked_human` in attesa di risposte (`essential_facts_missing`, `required_answer_missing`, `required_profile_field_missing`, `required_field_unanswered`) | 3 | non è uno stop definitivo: all'utente è stato chiesto una volta, la coda tiene la posizione (`essential_answers_pending` / `checkpoint_blocked_human`) finché le risposte sono in `jobs.db`, al massimo un giorno per domanda (chiesta al massimo due volte, poi il flusso prosegue) | posizione successiva; al `[BRIDGE INFO]` che dice che l'utente ha risposto, rileggi la coda: la posizione è di nuovo in `positions` |
| `email_channel` | 4 | il controllo di candidatura è un link `mailto:`, non un form; il checkpoint contiene `channel: email` e il `mailto_href` grezzo | esegui `email_application.py send` per questa posizione come dice la skill `email-application-flow`: legge questo checkpoint; non compilare mai un form web e non scrivere l'email a mano |
| `error` | 2 | profilo o CV illeggibile, argomenti sbagliati | fermati: `[BLOCKED]` al Capitano |

## `blocked_human` — cosa significa e cosa fai

Il flusso si ferma su qualunque cosa non possa fare con certezza:

| `reason` (esempi) | Causa tipica |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | un campo obbligatorio non ha risposta salvata — all'utente è stato chiesto una volta (prima su Telegram, anche in dashboard); la risposta si salva in `jobs.db` e il flusso riparte dal checkpoint |
| `essential_facts_missing` / `essential_facts_unavailable` | prima del primo run di una posizione manca un dato che quasi ogni form chiede (data di inizio, preavviso, autorizzazione al lavoro, sponsorship, RAL, trasferimento, telefono); ognuno è stato chiesto una volta e nulla resta trattenuto: la posizione riparte quando le risposte esistono |
| `captcha` / `two_factor` | il sito vuole verificare che ci sia una persona |
| `vacancy_closed` | l'annuncio non è più aperto: una pagina senza form, pulsante Apply e canale email lo dice, oppure l'URL ha rediretto alla lista delle posizioni, alle careers o alla home; nulla è stato compilato né inviato. Stop definitivo: un nuovo run non riapre la pagina finché l'utente non autorizza di nuovo la posizione. Uno screenshot della pagina è salvato accanto al checkpoint (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | un campo che la ricetta non sa compilare con una risposta salvata |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | il CV non si riesce ad allegare |
| `cv_pdf_layout_bad` | il PDF del CV non ha passato il controllo visivo (`pdf_layout_check.py`: testo schiacciato in una colonna stretta, una pagina quasi vuota, più di 2 pagine, font non incorporati): nulla è stato allegato né inviato. Lo Scrittore deve rigenerarlo; mai allegarlo a mano. L'anteprima di pagina 1 è salvata accanto al checkpoint: guardala |
| `cv_pdf_check_unavailable` | il PDF del CV non si è potuto misurare (poppler assente nel container, file illeggibile): nulla è stato allegato né inviato — un CV non misurato non è un pass. Il rimedio sta nel container, non nello Scrittore: segnalalo al Capitano |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` | ancora nessuna ricetta per questa pagina, o il form non è quello che la ricetta conosce |
| `greenhouse_redirect_untrusted` | durante il flusso la pagina Greenhouse è uscita dai suoi tre host fidati |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | due indirizzi mailto di candidatura diversi, oppure il form di candidatura, i suoi campi o il suo bottone di invio non stanno in un unico form (newsletter, footer e form demo non ne fanno mai parte) |
| `form_error` / `field_invalid` / `submit_unavailable` | il form segnala un errore, il formato di un campo è rifiutato, o il bottone di invio manca o è disabilitato |
| `url_refused` / `checkpoint_invalid` | l'URL della candidatura non ha passato il controllo sugli indirizzi pubblici, o il checkpoint salvato non si legge |
| `page_unavailable` / `browser_uncertainty` | la pagina o il browser hanno ceduto a metà flusso |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | l'invio è stato cliccato ma la conferma non è certa |
| `receipt_screenshot_failed` | la conferma era visibile ma il suo screenshot non si è potuto salvare |
| `submit_outcome_unknown` | un giro precedente ha avviato l'invio e non ha lasciato ricevuta |
| `applied_record_failed` | la ricevuta c'è ma lo stato non si è potuto registrare — la candidatura quasi certamente è partita |

Cosa fai, sempre uguale:

1. **Niente su quella posizione.** Il flusso ha già scritto il checkpoint e
   avvisato l'utente con `jht-notify-user`. Non avvisarlo di nuovo.
2. **Non ritentarla.** Né adesso, né «un'altra volta fra qualche minuto». La coda
   la tiene ferma (`checkpoint_blocked_human`) finché l'utente non la autorizza di nuovo.
3. **Passa alla posizione successiva** della coda.

Ritentare una posizione bloccata è il tentativo cieco che questo design esiste
per impedire: su un captcha brucia l'account dell'utente, su un esito ignoto
manda una seconda lettera allo stesso recruiter.

## Verificare una candidatura dopo

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` e un `applied_at` non vuoto = il flusso l'ha registrata.
