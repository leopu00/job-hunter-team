# Guida di setup sul sito — pagina e innesto dei contenuti canonici

**7 agosto 2026 · HQ-FRONTEND · branch `frontend`**

Nota di consegna della parte web della guida a capitoli che sostituisce i
video-demo di setup: cosa c'è, cosa resta da fare, e dove si innesta ciò che
manca.

> ⛔ **Non pubblicata.** Ordine dell'operatore: la pagina è raggiungibile per
> la sua review, non dal pubblico. `noindex, nofollow`, fuori dalla sitemap,
> nessun link dal menu né dall'indice `/docs`. Nessun deploy in produzione.

## Dov'è

| | |
| --- | --- |
| Route | `/setup-guide` — lo slug raccomandato dal contratto |
| Codice | `web/app/setup-guide/` |
| Contenuti | `guide-content.ts` — **contratto di HQ-DOCS, adottato alla radice** |
| Schermate | `guide-screens.ts` — id `G00`, `S01`–`S17`, `W01`–`W04` |
| Test dati | `tests/js/i18n/setup-guide.test.ts` |
| Test pagina | `e2e/tests/87-setup-guide.spec.ts` |
| Preview telefono | `e2e/scripts/setup-guide-mobile-preview.mjs` |

## I contenuti sono quelli di HQ-DOCS, non una seconda versione

La fonte è `docs/internal/2026-08-07-setup-guide-content-contract.md`. Id,
titoli, corpi, link e id delle schermate sono i suoi, **adottati alla
radice**: non esiste una nomenclatura da mappare sull'altra. Ne seguono due
cose pratiche: i file che i collaudatori consegnano si agganciano da soli,
perché il nome contiene già l'id; e chi traduce lavora su testo definitivo.

Quattro capitoli, i quattro blocchi del contratto — indice della guida
(dal download al primo avvio), schermata di setup, schermata di avvio,
collegamento fra team locale e web — per **25 fasi**.

### Requisiti: solo numeri misurati

Il capitolo dei requisiti riporta il testo canonico basato sulla prova di
30 minuti su Windows. Due punti che il codice difende con un test, perché
sono quelli che si perdono per primi quando qualcuno accorcia:

- la frase che dice che **non si dichiara un minimo di disco** perché non è
  stato misurato deve restare visibile — è la regola dell'operatore, non un
  dettaglio editoriale;
- la baseline **VPS** resta dichiarata come separata e linka
  `/docs/guides/run-on-a-vps`, così le due pagine si sostengono invece di
  sembrare in disaccordo sui requisiti del computer di casa.

`tests/js/i18n/setup-guide.test.ts` fallisce se una delle due sparisce.

## Come è fatta la pagina

**Il selettore OS** sta in cima e resta appiccicato mentre si scorre. Rileva
il sistema dal browser, accetta `?os=macos|windows|linux` e ricorda la
scelta. Ogni fase dichiara per quali sistemi vale: il selettore le filtra e
**rinumera quelle che restano**. Anche i link possono essere ristretti a un
sistema — su Windows i download ufficiali sono due, installer e portable.

**Le schermate stanno in un registro**, indicizzate per id; le fasi le
referenziano. Da qui:

- la **stessa schermata compare in fasi diverse** senza duplicare né il file
  né la traduzione dell'alt, e una fase può sostituire solo la didascalia.
  `S02-docker-download` compare tre volte (una per sistema),
  `S06-choose-language` due;
- una fase può avere **due schermate**, che il contratto richiede per
  `W04`: l'app collegata e la dashboard sincronizzata non vanno messe nello
  stesso frame;
- una schermata può avere una **variante per sistema** e ricadere su
  `shared` dove l'immagine è la stessa ovunque.

**Il titolo della scheda segue la lingua scelta**, non quella dedotta dal
server — vedi la sezione sul difetto della pagina Download.

### Il capitolo del collegamento web sta in piedi senza immagini

Il copy aggiornato (`1ae241492`, `c6007f546`) rende le fasi `W02`–`W04`
leggibili anche senza schermate autenticate: nomina i soli scope che Google
riceve — OpenID, email, profile — dice che **la casella Gmail del team è un
consenso separato**, con app-password propria salvata in locale, e la linka;
e descrive il token di dispositivo come revocabile e distinto da qualunque
credenziale Google.

Le tre fasi usano un segnaposto proprio (`screenFallback`) invece di quello
generico: non stanno per essere rigirate, sono **bloccate** finché non esiste
un account Google di prova approvato. Dirlo con la frase generica sarebbe
falso.

## Schermate: le prime cinque sono arrivate

Linux ha consegnato `S02`, `S04`, `S05`, `S06`, `S07`. Le ho aperte una per
una prima di pubblicarle: interfaccia inglese, nessun dato personale,
cartella neutra, Docker in navigazione privata.

`S03` e `W01` sono **escluse**: la sessione E2E le ha revocate per un titolo
di scheda italiano e per etichette italiane nello sfondo dell'ufficio.

`S05` e `S06` erano lo stesso file byte per byte, e il contratto ammette il
riuso perché il selettore lingua *è* la prima schermata di un avvio pulito:
due voci del registro puntano a un file solo invece di spedire due volte lo
stesso 1,3 MB. È il caso d'uso per cui il registro esiste.

Il conteggio è per coppia **schermata × sistema**, limitato ai sistemi in
cui la fase compare davvero: **5 riprese su 63**. Contare le schermate senza
alcun file avrebbe dichiarato `S02` fatta nel momento in cui Linux ha
consegnato, mentre macOS e Windows non hanno nulla.

### Due superfici native, non due riprese

HQ-DOCS ha deciso il 7 agosto (`3864199e3`) che `G00` e `S01` **non sono
richieste di cattura**:

- `S01` è la `RequirementsCard` costruita nella pagina;
- `G00` è l'indice dei capitoli con il selettore OS dal vivo, in cima — una
  foto della pagina dentro sé stessa non aggiungerebbe nulla, e il duplicato
  mobile nemmeno.

I due id restano nel registro marcati `nativeSurface` per l'audit, ma fuori
dagli asset in attesa: E2E non deve catturarli. Il guard sta dentro
`missingCaptures()`, non solo nei chiamanti, così il conto resta giusto anche
se un domani una fase tornasse a referenziarli.

## Traduzioni: cosa è tradotto e cosa no

| Cosa | Stato |
| --- | --- |
| Microcopy della pagina (`guide-ui.i18n.ts`) | tradotto, 7 lingue |
| Alt text e didascalie delle schermate | tradotti, 7 lingue |
| Titoli e corpi delle fasi, dal contratto | **inglese**, in attesa di HQ-FULLSTACK-1 |

I testi del contratto passano da `untranslated()`: la lacuna è esplicita e
cercabile invece di sembrare già fatta, e chi traduce cerca `untranslated(`
e sostituisce la voce con le sette lingue vere. A schermo il comportamento è
il fallback all'inglese che il sito usa già ovunque. Il conteggio esatto lo
stampa il test: **33 testi su 85** al momento. Indice, G00–S05, la scheda
requisiti nativa e W02–W04 sono tradotti; il totale include i sette valori
misurati della scheda e titolo e corpo del segnaposto privacy-safe visibile
di W02–W04, che prima sfuggivano al censimento.

## Il difetto del titolo, e perché la guida non lo eredita

La pagina Download mostra titolo e contenuto in due lingue diverse alla
prima visita. La causa **non è l'header del browser**: `getRequestLocale()`
(`lib/request-locale.ts`) legge il cookie `NEXT_LOCALE` e, quando manca,
ricade su `defaultLocale`, che vale `it`. Il contenuto invece nasce da
`LandingI18n`, che senza scelta salvata parte da `en`. Due default diversi
per la stessa pagina: succede su qualunque macchina, non solo su una
italiana. In più il cookie viene scritto dal selettore con una POST a
`/api/i18n`, quindi il titolo si riallinea solo alla navigazione successiva.

La guida evita entrambe le cose: metadata statico inglese per crawler e
lettori senza JavaScript, e `document.title` riallineato al selettore. Un
test e2e lo verifica in tedesco.

**Stima del fix su Download** (per il backlog):

- causa: una funzione nuova in `lib/request-locale.ts`, `getPublicLocale()`
  = cookie oppure `en`, usata al posto di `getRequestLocale()` nelle pagine
  **pubbliche**. Sostituzione meccanica: 22 file la usano oggi, di cui due
  sono dell'area protetta e vanno lasciati com'erano. **~30–45 minuti** con
  verifica;
- allineamento **senza ricaricare** dopo il cambio lingua: serve in più un
  piccolo componente client che aggiorni `document.title`, come quello della
  guida. **~30 minuti**, riusabile su tutte le pagine pubbliche;
- da dire prima di farlo: il titolo predefinito delle pagine pubbliche senza
  cookie diventa inglese. È l'intento — il contenuto di default è già
  inglese — ma cambia i title indicizzati.

## Cosa manca, senza abbellimenti

- **58 riprese su 63.** Linux ha consegnato le prime cinque; macOS e
  Windows non hanno ancora nulla. Le due immagini già in repo
  (`office-overview`, `departments`) restano **fuori** dalla guida: il
  contratto stabilisce che non provano né il setup né un team vivo.
- **Le traduzioni** dei testi del contratto (HQ-FULLSTACK-1).
- **`W02`–`W04` restano senza immagine**: servono un account Google di prova
  isolato e approvato. La localizzazione inglese del terminale è entrata in
  `master` (`13c9e7902`), ma un merge non è una release pubblicata: finché
  non esce, non si descrive il terminale localizzato come comportamento
  dell'artefatto pubblico.
- **La vecchia `/tutorials`**: ancora al suo posto, ancora nel menu. Il
  contratto chiede di ritirarla come porta d'ingresso al setup, con redirect
  permanente a `/setup-guide`, e di spostare il solo contenuto esplorativo
  sotto `/docs` come *Product Tour*. Non fatto: è un lavoro a sé e tocca
  navigazione e sitemap.
- **I link di download** sono quelli del contratto e coincidono con la
  pagina `/download` attuale; restano da confermare con HQ-BACKEND se i
  comandi CLI in corso li cambiano.

## Verifiche fatte

`tsc` pulito · `npm run lint` zero errori sulla guida · `npm run build` con
`/setup-guide` compilata · vitest 13/13 sul file della guida, 82/82 su
`tests/js/i18n/` · Playwright 5/5 su `87-setup-guide.spec.ts` a 390 px:
nessuno scorrimento laterale, bersagli ≥ 40 px, il selettore OS che scambia
davvero le fasi, il tedesco che non sfonda, il titolo che segue la lingua.

Un difetto trovato e corretto durante le prove: prima dell'idratazione il
tocco sul selettore si perdeva in silenzio. La pagina ora dichiara
`data-guide-ready` e il test aspetta lo stato vero invece di un tempo.

**Preview telefono**: 30 screenshot a 390 px — pagina intera più
un'inquadratura per ciascuno dei quattro capitoli, per i tre sistemi, in
inglese chiaro e in tedesco scuro, senza il banner dei cookie che copriva le
inquadrature — in `docs/previews/setup-guide-mobile/`.
Fuori da git per peso: le immagini di `docs/previews/` ricadono nella regola
`*.png` di `.gitignore`.
