<!-- @translation: it, ai-translated 2026-09-13 -->
---
name: email-application-flow
description: Come il CLOSER invia via email una candidatura autorizzata con `email_application.py` quando `apply_flow.py` risponde `email_channel` (il controllo Apply è un link `mailto:`) — inspect, preflight, draft, send, status; il gate ricontrollato subito prima del trasporto; `send_started` prima del comando irreversibile; la ricevuta senza la quale `applied` non si scrive mai. Usala per ogni posizione il cui flusso finisce in `email_channel`. Del CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/email_application.py *)
---

# email-application-flow — una email, una ricevuta, nessun tentativo alla cieca

Usala **solo** per una posizione dell'ultima coda il cui `apply_flow.py` ha
risposto `email_channel` (exit 4). Il flusso browser ha lasciato il
`mailto_href` grezzo nel suo checkpoint; questa skill lo legge. Non apri mai un
client di posta, non scrivi mai un'email a mano, non copi l'indirizzo altrove.

```bash
python3 /app/shared/skills/email_application.py send --position-id "$PID" --json
```

`send` esegue tutto in ordine e si ferma al primo problema. Gli altri comandi
servono a leggere, non ad aggirare uno stop:

| Comando | Cosa fa |
|---|---|
| `inspect` | legge e interpreta il link mailto (To, CC, oggetto, corpo) |
| `preflight` | inspect + gate + tetto giornaliero + trasporto + CV + cover letter + fatti obbligatori |
| `draft` | preflight + la bozza deterministica; non parte niente |
| `send` | draft + di nuovo il gate + `send_started` + trasporto + ricevuta + `applied` |
| `status` | l'ultimo tentativo e il suo stato, in sola lettura |

`--dry-run` si ferma prima del trasporto e non cambia niente sulla candidatura.

## Cosa garantisce il comando

- **Il flag è l'autorizzazione.** Il gate decide in preflight e di nuovo subito
  prima del trasporto. Un flag revocato o un tetto raggiunto nel frattempo
  significa che non parte niente (`denied`).
- **Niente è inventato.** I destinatari vengono solo dal link. Nome, email di
  contatto e ogni fatto che l'annuncio chiede (disponibilità, aspettative
  economiche) vengono solo dal profilo del candidato; se ne manca uno è
  `required_fact_missing`.
- **Il CV è sempre allegato**, dopo i controlli su dimensione, PDF e hash. La
  cover letter si allega solo se l'annuncio la chiede; se non esiste, la si
  chiede allo Scrittore con la normale richiesta di scrittura e il flusso si ferma.
- **Al massimo una lettera.** `send_started` si registra prima che il server
  riceva il messaggio. Dopo, un timeout o una risposta poco chiara è
  `send_outcome_unknown`: mai ritentato, nemmeno da un nuovo giro.
- **`applied` solo dopo l'accettazione**, con `applied_via = agent_closer_email`,
  scritto dal comando stesso dopo aver salvato la ricevuta.

## Leggere l'esito

Una riga JSON: `state`, `reason`, `detail`, più i dati.

| `state` | Exit | Significato | Cosa fai |
|---|---|---|---|
| `sent` | 0 | accettata dal server, ricevuta salvata, candidatura registrata | posizione successiva |
| `draft_ready` | 0 | dry run: bozza e allegati validi, non è partito niente | posizione successiva |
| `denied` | 1 | il gate ha rifiutato (`flag_revoked`, `gate_mode_changed`, `daily_cap_reached`, `duplicate_attempt`) | posizione successiva; mai ritentare |
| `blocked_human` | 1 | serve una persona; lo stop è nel riepilogo del giro | posizione successiva; mai ritentare |
| `send_outcome_unknown` | 3 | l'email potrebbe essere partita | posizione successiva; mai ritentare |
| `receipt_incomplete` | 3 | accettata, ma la ricevuta o la registrazione è incompleta; con alcuni destinatari rifiutati la lettera è probabilmente arrivata | posizione successiva; mai ritentare |
| `error` | 2 | database, profilo o checkpoint illeggibili | stop: `[BLOCKED]` al Capitano |

⚠️ Questi exit code **non** sono quelli di `apply_flow.py` (lì `denied` è 1 e
`blocked_human` è 3). Decidi su `state`, mai sul numero.

## Motivi di `blocked_human`

| `reason` | Causa tipica |
|---|---|
| `transport_missing` | nessun trasporto email configurato, o il file del segreto manca o non è 0600 |
| `auth_failed` | il server di posta ha rifiutato le credenziali |
| `sender_unverified` | l'indirizzo mittente non è l'account autenticato né un mittente verificato |
| `mailto_missing` | nessun checkpoint del browser in `email_channel` per questa posizione: esegui prima `apply_flow.py`; la pagina non viene mai letta per cercare un indirizzo |
| `recipient_ambiguous` / `mailto_invalid` | zero o più destinatari, un header vietato, CR/LF in un header; anche local part quotate e indirizzi internazionali (IDN), non supportati |
| `recipient_refused` | il server ha rifiutato i destinatari prima che partisse qualcosa: un nuovo tentativo, dopo che l'utente agisce, non è un doppione |
| `required_fact_missing` | l'annuncio chiede un fatto che il profilo non riporta |
| `cv_missing` | nessun CV PDF leggibile per questa candidatura |
| `cover_letter_required` | l'annuncio chiede una cover letter; è stata chiesta allo Scrittore |

Cosa fai, sempre uguale:

1. **Niente su quella posizione.** Il comando ha messo lo stop nel riepilogo del giro (`closer_notices.py flush` allo STEP 6).
2. **Non ritentarla.** La coda la trattiene (`email_blocked_human`,
   `email_send_outcome_unknown`, ...) finché l'utente non agisce.
3. **Passa alla posizione successiva** della coda.

## Mai

- inviare un'email in un modo diverso da questo comando;
- eseguire `send` su una posizione che non è nell'ultima lettura della coda;
- ritentare dopo `send_started`, `send_outcome_unknown` o `receipt_incomplete`;
- scrivere tu `applied`, `applied_via` o `apply_requested`;
- incollare la password SMTP, o chiederla all'utente in chat.

## Verificare dopo

```bash
python3 /app/shared/skills/email_application.py status --position-id "$PID" --json
```

`state: sent` con un `message_id` = il comando ha registrato l'invio email.
