# Audit compliance — web

**7 agosto 2026 · HQ-FRONTEND**

> ⚠️ Questo è un audit **tecnico**: dice cosa il codice fa e cosa non fa.
> Non è un parere legale e non dichiara il prodotto conforme. I testi dei
> documenti sono di HQ-DOCS e l'approvazione è dell'operatore.

## Riepilogo

| # | Punto | Stato |
| --- | --- | --- |
| 1 | Privacy e termini raggiungibili | ⚠️ pubbliche sì, area riservata no → **corretto** |
| 2 | Consenso cookie rispettato | ❌ la scelta non aveva effetto → **corretto** |
| 3 | Accettazione al login Google | ❌ assente → **aperto**, serve testo |
| 4 | Export e cancellazione (GDPR) | ❌ **il buco più grave** → aperto |
| 5 | Feedback: dove finisce | ⚠️ dice cosa manda, non dove → aperto |
| 6 | Minori / età | ❌ assente → aperto, è testo |
| 7 | Titolare del trattamento | ❌ assente → aperto, è testo |

## Corretto in questo giro

### 2 · Il consenso non governava la misurazione

`Analytics` e `SpeedInsights` erano montati in `app/layout.tsx` **senza
condizioni**: partivano al primo render, prima ancora che il banner fosse
visibile. Il banner offriva «Solo necessari», ma `respond()` scriveva solo
in `localStorage` e nascondeva il riquadro — rifiutare non cambiava nulla.

Ora montano solo dietro un `"accepted"` esplicito
(`app/components/ConsentedAnalytics.tsx`). Chi non ha ancora risposto non
viene misurato. Il banner emette un evento perché la scelta valga subito:
conta soprattutto in negativo, dove un ritardo continuerebbe a misurare
qualcuno che ha appena detto di no.

`tests/js/i18n/consent-gate.test.ts` asserisce sul **sorgente**:
reimportare `Analytics` nel layout compila benissimo e nessun test di
rendering se ne accorgerebbe. Verificato reintroducendo il difetto.

### 1 · Nessun percorso ai documenti dall'area riservata

Il footer con Privacy e Termini è su tutte le pagine pubbliche, ma l'area
riservata non ha footer: da dentro non esisteva alcun percorso. Aggiunta la
voce nel menu utente, in tutte e sette le lingue.

## Aperto — richiede testo di HQ-DOCS

### 3 · Nessuna accettazione al login

Il pulsante dice «Login with Google» sotto «Sign in to save your progress».
Nessun riferimento a Termini e Privacy, nessuna spunta, nessuna formula.
Serve almeno la formula con i due link. Chiesta a DOCS in inglese; le sette
lingue le monto io.

### 5 · Il feedback non dice dove finisce

`SupportDialog` dichiara bene **cosa** invia — testo, pagina, lingua, e
dichiara di non inviare email, nome, CV, contatti, file o log. Non dice
**dove finisce**: `app/api/feedback/route.ts` apre una **issue pubblica su
GitHub**, visibile a chiunque.

Il modulo `/contact` invece non apre issue e va a posta: sono due canali
diversi, la formula serve solo sul primo.

### 6 · Minori ed età · 7 · Titolare del trattamento

Nessuna soglia d'età né clausola in privacy e termini. Il contatto esiste
(`support@jobhunterteam.ai`) ma **l'identità del titolare** — chi tratta i
dati, con quale forma giuridica e indirizzo — non è scritta da nessuna
parte.

### Documenti fermi ad aprile 2026

Entrambi riportano «Ultimo aggiornamento: Aprile 2026», quattro mesi fa. Da
allora è cambiato il collegamento cloud con Google: vanno riletti, non solo
ridatati.

## 4 · Il buco più grave: cancellazione assente, ed export solo in locale

**Non esiste alcun modo di chiedere la cancellazione** di account e dati:
nessuna pagina, nessuna API, nessuna menzione nei documenti. Ricerca fatta
su tutto `app/` e `lib/`.

C'è di più, e peggiora il quadro: `/export` **è nascosto sul cloud**
(`isCloud !== true` in `UserMenu.tsx`), perché legge i file locali di
`JHT_HOME`. Quindi proprio dove i dati dell'utente stanno su Supabase —
posizioni, profilo, token di dispositivo — **non c'è né export né
cancellazione**.

Non l'ho implementata da solo di proposito: cancellare dati di produzione è
irreversibile e la decisione su *cosa* si cancella, *in quanto tempo* e
*chi* la esegue non è una scelta di frontend. Vedi le domande.

## Domande per l'operatore

1. **Cancellazione account** — la implemento come *richiesta* tracciabile
   (l'utente chiede, qualcuno esegue) o come *cancellazione immediata*
   dell'account Supabase e dei dati sincronizzati? La seconda è più
   rispettosa dell'utente e più rischiosa da scrivere stanotte: va decisa
   da te, non da me.
2. **Cosa comprende la cancellazione** — solo i dati cloud sincronizzati, o
   anche le issue GitHub eventualmente aperte dall'utente col feedback?
   Quelle sono pubbliche e non si cancellano da sole.
3. **Export sul cloud** — va aggiunto un export dei dati Supabase per
   l'utente loggato? Oggi l'export esiste solo per l'installazione locale.
4. **Titolare del trattamento** — chi è, con quale forma giuridica e
   indirizzo? È l'unico dato che né io né DOCS possiamo dedurre.
5. **Età minima** — dichiariamo una soglia? Se sì quale, e la verifichiamo
   in qualche modo o resta una clausola?
6. **Vercel Analytics** — ora è dietro consenso. Confermi che è la
   posizione che vuoi, o preferisci considerarlo essenziale e cambiare
   invece il testo del banner? Le due strade sono entrambe coerenti, ma
   vanno scelte: oggi il banner prometteva una cosa e il codice ne faceva
   un'altra.

## Non verificato

- Il **gioco** ha i suoi flussi di consenso: coordinamento aperto con
  HQ-GAME-2, perché web e gioco devono dire la stessa cosa.
- Non ho verificato i contenuti legali nel merito: non è il mio ruolo.
