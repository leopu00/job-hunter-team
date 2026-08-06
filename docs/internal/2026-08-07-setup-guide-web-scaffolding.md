# Guida di setup sul sito — impalcatura web

**7 agosto 2026 · HQ-FRONTEND · branch `frontend`**
Commit: `d18d12648` (pagina) · `2e123b800` (test e preview)

Nota di consegna della parte web della guida a capitoli che sostituisce i
video-demo di setup. Contiene: cosa c'è, come si innestano i contenuti che
mancano, la proposta di naming e l'elenco onesto di ciò che non c'è ancora.

> ⛔ **Non pubblicata.** Ordine dell'operatore: la pagina è raggiungibile per
> la sua review, non dal pubblico. `noindex, nofollow`, fuori dalla sitemap,
> nessun link dal menu né dall'indice `/docs`. Nessun deploy in produzione.

## Dov'è

| | |
| --- | --- |
| Route | `/setup-guide` (slug provvisorio, vedi *Naming*) |
| Codice | `web/app/setup-guide/` |
| Test dati | `tests/js/i18n/setup-guide.test.ts` |
| Test pagina | `e2e/tests/87-setup-guide.spec.ts` |
| Preview telefono | `e2e/scripts/setup-guide-mobile-preview.mjs` |

## Com'è fatta

Sei capitoli, sedici fasi. Ogni fase ha titolo, testo, la sua schermata e i
suoi link operativi; il capitolo dichiara in una riga cosa avrà ottenuto chi
lo finisce.

**Il selettore OS** sta in cima e resta appiccicato mentre si scorre. Rileva
il sistema dal browser, accetta `?os=macos|windows|linux` nell'URL e ricorda
la scelta. Ogni fase dichiara per quali sistemi vale: il selettore le filtra
e **rinumera quelle che restano**, così chi sta su Windows non vede «passo 4»
subito dopo il 2.

**Le schermate stanno in un registro** (`guide-screens.ts`), indicizzate per
id; le fasi le referenziano. Da qui vengono due proprietà richieste:

- la **stessa schermata può comparire in fasi diverse** senza duplicare né il
  file né la traduzione dell'alt text — e una fase può sostituire solo la
  didascalia. Succede già tre volte: `docker-check` fra «Installa Docker» e
  «Porta la riga Docker sul verde», `setup-checklist` fra «Apri la checklist»
  e «Ricontrolla la lista»;
- una schermata può avere una **variante per sistema** (`assets.windows`…) e
  ricadere su `assets.shared` dove l'immagine è la stessa ovunque.

**I link di download non stanno nelle fasi**: li risolve `guide-config.ts`
dal sistema selezionato. Quando cambiano i nomi degli asset di release si
tocca un file solo — e il selettore in cima cambia anche i download.

**Le sette lingue sono obbligatorie per costruzione**: ogni testo visibile è
`Record<Lang, string>`, quindi una fase senza tedesco non compila. Nessun
testo è hardcoded nel JSX.

## Come si innestano i contenuti che mancano

- **Copy definitivo (HQ-DOCS)**: sostituire i testi in `guide-content.ts`. Gli
  `id` di capitoli e fasi sono stabili; aggiungere una fase è una voce in più
  in un array. Il layout non si tocca.
- **Schermate (HQ-E2E-\*)**: mettere il file sotto `web/public/setup-guide/`
  e aggiungerlo alla voce già presente nel registro. Finché manca, la fase
  mostra uno slot con le stesse proporzioni e una frase onesta: la pagina non
  salta quando la schermata arriva.
- **Link download (HQ-BACKEND)**: `guide-config.ts`, un punto solo.

## Naming — proposta

Il brief chiede una scelta coerente: la pagina non si chiama «tutorial» e
l'artefatto non si chiama «videogioco». Decisione di HQ-DOCS; questa è la
proposta dal lato web, in ordine di preferenza.

**La pagina**

1. **Setup guide** → `/setup-guide` *(raccomandata)*. Dice cosa è senza
   promettere altro, si traduce pulito in tutte e sette le lingue, e sta
   accanto a `/docs/guides/getting-started` senza confondersi con essa:
   quella spiega in dieci minuti, questa accompagna passo per passo.
2. **Get started** → `/get-started`. Più caldo, ma collide di significato con
   `getting-started` nei docs — due nomi quasi identici per due pagine
   diverse è il modo migliore per farle sbagliare entrambe.
3. **Install** → `/install`. Corto, ma copre solo il primo terzo del
   percorso: la guida arriva fino al team avviato e sincronizzato.

**L'artefatto che l'utente installa**

1. **L'app desktop** *(raccomandata)*. È quello che è, è già il termine della
   pagina `/download`, e non promette un gioco.
2. **L'ufficio** — buono come nome del *luogo dentro* l'app («entra
   nell'ufficio»), che il prodotto usa già; meno adatto a indicare il file
   che si scarica.
3. **Il workspace** — neutro ma anonimo, e in italiano resta un anglicismo.

Applicare la scelta è un rename della cartella della route più la costante
`GUIDE_PATH` in `guide-config.ts`.

## Schermate: riusate, da rigirare

**Riusate dal materiale già in repo (2)**
`office-overview` e `departments` — già in `web/public/tutorials/game/`,
1600×900, senza dati personali. Non vanno rifatte.

**Da riprendere (11)** — l'elenco vive nel codice, in `pending` di ogni voce
del registro, così non può divergere da una lista scritta a parte:
`download-page` · `language-choice` · `setup-checklist` · `docker-check` ·
`provider-auth` · `cv-upload` · `team-running` · `google-sign-in` ·
`sync-authorizations` · `web-dashboard`.

Vincolo su tutte: **zero dati personali**. Una schermata che li contiene si
rifà in ambiente pulito — mai sfocature, mai ricostruzioni.

## Cosa manca, senza abbellimenti

- Il **copy definitivo**: i testi attuali sono veri (tratti dai percorsi già
  verificati in `tutorial-content.ts` e dalle prove end-to-end), ma sono
  provvisori e vanno riletti da DOCS.
- **Undici schermate su tredici.**
- La **scelta di naming**, e quindi lo slug definitivo.
- I **link di download definitivi**, se cambiano con i comandi CLI in corso.
- La **vecchia pagina `/tutorials`**: ancora al suo posto, ancora nel menu.
  Non si può sostituire prima di sapere come si chiama quella nuova; va
  spostata sotto `docs` o rimpiazzata, non lasciata doppia.
- Il capitolo **collegamento locale ↔ web** descrive il flusso (login Google,
  autorizzazioni, dashboard) ma non è stato ancora percorso davvero con un
  account di prova: le sue tre schermate sono fra quelle da riprendere.

## Verifiche fatte

`tsc` pulito · `npm run lint` zero errori sulla guida · `npm run build` con
`/setup-guide` compilata · vitest 82/82 su `tests/js/i18n/` · Playwright 3/3
su `87-setup-guide.spec.ts` a 390 px (nessuno scorrimento laterale, bersagli
≥ 40 px, il selettore OS scambia davvero le fasi).

**Preview telefono**: 21 screenshot a 390 px — pagina intera più un
inquadratura per capitolo, per tutti e tre i sistemi — in
`docs/previews/setup-guide-mobile/`. Fuori da git per peso (14 MB): le
immagini di `docs/previews/` ricadono nella regola `*.png` di `.gitignore`.
