/**
 * Il contratto di filo dell'API del team — [JHT-TEAM-API-BOUNDARY].
 *
 * Vive in `shared/` per la stessa ragione di `shared/release/version.js`: la
 * domanda «che protocollo parla questa scatola?» se la pongono due programmi
 * diversi — il server dentro il container e il client nel CLI — e due
 * risposte che divergono sarebbero peggio di nessuna risposta. Con una sola
 * copia delle costanti un disallineamento è impossibile per costruzione: non
 * c'è un secondo posto dove sbagliarlo.
 *
 * Qui non passa un byte di trasporto: nessun `node:http`, nessun socket,
 * nessun `req`, nessuna lettura di `process.env`. **Zero import**, e non è un
 * caso: questo file lo carica anche il figlio di pid1 al boot del container,
 * e una dipendenza qui sarebbe una dipendenza dell'immagine. Il costo
 * dell'immagine è la misura su cui poggia tutta la fase 1 (roadmap §7.1): un
 * `import` di troppo la falsifica prima ancora che qualcuno la scriva.
 *
 * ## Perché un intero e non una versione semver
 *
 * `API_CONTRACT` è un contatore, non `X.Y.Z`. Semver serve a dire «questo
 * cambiamento è compatibile»: è un giudizio, e un giudizio va interpretato da
 * chi legge. Sul filo non c'è nessuno che interpreta — c'è un client che ha
 * già deciso come leggere il JSON che gli arriva. L'unica domanda utile è
 * «la forma del payload è quella che mi aspetto, sì o no?», e la risposta più
 * onesta a una domanda binaria sono due interi uguali o diversi.
 *
 * ## Perché il confronto è ESATTO, e perché NON usa `compareVersions`
 *
 * `shared/release/version.js` esiste ed è tentante, ma il suo
 * `compareVersions` restituisce `0` — «pari, non fare nulla» — quando una
 * delle due versioni è illeggibile. Per una fascia di aggiornamento è la
 * clemenza giusta (meglio tacere che avvisare a sproposito). Per un cancello
 * di protocollo è esattamente `[CHAT-LANE-SILENT-DROP-ON-OLD-CLIENT]`: due
 * lati che non si capiscono e nessuno dei due che se ne accorge. Qui
 * l'illeggibile non è mai «pari»: è un rifiuto con un nome.
 *
 * Nessun `contractMin`, nessuna fascia di tolleranza: in fase 1 si serve
 * `API_CONTRACT` e nient'altro. `API_CONTRACT_SUPPORTED` è la SEDE di una
 * futura finestra di transizione — la si apre con una modifica rivista a
 * mano, mai per default implicito — e per questo non è il cancello: se lo
 * fosse, allargare la lista servirebbe di nascosto un payload di un'altra
 * forma dichiarando nell'header il contratto di adesso. Il test
 * `tests/js/tasks/api-contract-verdict.test.ts` diventa rosso se la lista si
 * allarga, così la decisione passa da qualcuno.
 *
 * ## Regola di bump
 *
 * Qualunque cambiamento di payload alza `API_CONTRACT`, campi aggiuntivi
 * compresi: un campo in più è un campo che un client vecchio non sa di dover
 * ignorare, e «probabilmente va bene» non è una garanzia di filo.
 */

// [JHT-TEAM-API-BOUNDARY] La versione del contratto e la sede della finestra
// di transizione. Restano vicine di proposito: chi tocca una deve vedere
// l'altra.
/** Il contratto servito da questa immagine. Intero, non semver. */
export const API_CONTRACT = 1;

/**
 * I contratti che questa immagine dichiara di saper servire.
 *
 * In fase 1 è esattamente `[API_CONTRACT]`, e `contractVerdict` **non** la
 * consulta: è materiale informativo per `GET /version` e il punto in cui una
 * finestra di transizione andrà aperta a mano, elencando ogni intero uno per
 * uno. Una fascia `min..max` accetterebbe anche interi che nessuno ha
 * rivisto; un elenco no.
 */
export const API_CONTRACT_SUPPORTED = Object.freeze([1]);

// [JHT-TEAM-API-BOUNDARY] Nomi degli header, in minuscolo.
//
// Node consegna `req.headers` con le chiavi già in minuscolo e il contratto
// interno del handler (`reqLike.headers`) mantiene quella forma: la costante
// è scritta come si legge, non come si stampa. In risposta va la stessa
// stringa — sul filo il nome di un header non ha maiuscole significative —
// mentre nei messaggi per l'utente compare la forma leggibile
// `X-JHT-Api-Contract`, che il test lega a questa costante in modo
// case-insensitive perché un rename non lasci indietro le frasi.
/** Header obbligatorio su ogni rotta `/v1/*`: l'intero del contratto. */
export const CONTRACT_HEADER = "x-jht-api-contract";

/** Header informativo del client (`version=…; platform=…`), mai autorizzante. */
export const CLIENT_HEADER = "x-jht-client";

// [JHT-TEAM-API-BOUNDARY] La superficie: rotte e capacità.
/**
 * Le rotte, unica fonte di verità.
 *
 * Il router del handler si COSTRUISCE da questo elenco: «aggiungere una
 * rotta» significa «aggiungere una riga qui», e di conseguenza la rotta nuova
 * entra da sola nei guard test (il ciclo che pretende il Bearer su ognuna) e
 * in `GET /version`. Se il router avesse la sua lista, una rotta senza
 * autenticazione sarebbe una riga dimenticata invece di un test rosso.
 *
 * `path` usa la forma `:id` per il parametro; `GET /version` pubblica la
 * stessa rotta come `/v1/positions/{id}` perché è la forma che si legge in
 * una documentazione, e la conversione è affare di chi risponde — qui non si
 * tengono due grafie della stessa cosa.
 *
 * Le voci sono congelate una per una, non solo l'array: attaccare un matcher
 * compilato alla riga (`route.regex = …`) fallisce in modo rumoroso — i
 * moduli ESM sono sempre in strict mode — invece di riuscire e lasciare stato
 * mutabile in una tabella condivisa. Il matcher si costruisce ACCANTO, in una
 * struttura di chi lo usa.
 *
 * @type {ReadonlyArray<{ method: 'GET', path: string, name: string, contractRequired: boolean }>}
 */
export const ROUTES = Object.freeze([
  // `/version` è la sola rotta che un client disallineato deve poter
  // raggiungere: è quella che gli spiega il disallineamento. Pretendere
  // l'header del contratto anche qui vorrebbe dire rispondere «mi manca
  // l'header» a chi sta chiedendo quale header mandare.
  Object.freeze({
    method: "GET",
    path: "/version",
    name: "version",
    contractRequired: false,
  }),
  Object.freeze({
    method: "GET",
    path: "/v1/team/status",
    name: "teamStatus",
    contractRequired: true,
  }),
  Object.freeze({
    method: "GET",
    path: "/v1/positions",
    name: "positions",
    contractRequired: true,
  }),
  Object.freeze({
    method: "GET",
    path: "/v1/positions/:id",
    name: "position",
    contractRequired: true,
  }),
  Object.freeze({
    method: "GET",
    path: "/v1/dashboard",
    name: "dashboard",
    contractRequired: true,
  }),
]);

/**
 * Cosa questa immagine sa fare, in forma di elenco che un client può leggere
 * senza dedurlo dalle rotte.
 *
 * Sono quattro contro cinque rotte: `/version` non è una capacità, è
 * l'handshake. Tutte in lettura — la corsia di scrittura è la fase 3, e
 * l'assenza di un `write.*` qui è il modo in cui un client se ne accorge
 * senza provarci.
 */
export const CAPABILITIES = Object.freeze([
  "read.team-status",
  "read.positions",
  "read.position",
  "read.dashboard",
]);

// [JHT-TEAM-API-BOUNDARY] I modi di dire no, uno per uno.
/**
 * La tabella degli errori: codice macchina → stato HTTP + frase + rimedio.
 *
 * Il `code` è la metà leggibile da un programma, `error` quella leggibile da
 * una persona, e `error` è **sempre una stringa**: il modo di dire «errore»
 * di casa è `json.error || 'unknown'` (`cli/src/lib/team-state-reconciler.js`),
 * che con un oggetto stamperebbe `[object Object]` — cioè perderebbe il
 * motivo proprio nel momento in cui serve.
 *
 * Ogni riga porta anche un `hint`, e non è decorazione: quattro guasti
 * diversi (API muta, token assente, token rifiutato, contratti disallineati)
 * si somigliano molto dalla parte dell'utente, e ADR-0009:111-113 chiede
 * espressamente che siano distinguibili. Il testo è in inglese perché
 * `shared/` è area di censimento a zero perdite
 * (`scripts/analysis/backend_copy_census.py`) e queste stringhe finiscono in
 * un terminale.
 *
 * Chi risponde può sostituire `error` e `hint` per un singolo caso passando
 * `message`/`hint` a `fail()`; qui c'è il valore di default, che non è mai
 * `undefined`.
 *
 * @type {Readonly<Record<string, Readonly<{ status: number, error: string, hint: string }>>>}
 */
export const ERROR_CODES = Object.freeze({
  METHOD_NOT_ALLOWED: Object.freeze({
    status: 405,
    error: "The team API is read-only: only GET and HEAD are allowed.",
    hint: "Send the same path with GET. The write lane does not exist yet.",
  }),
  HOST_NOT_LOOPBACK: Object.freeze({
    status: 421,
    error: "The Host header of this request does not name a loopback address.",
    hint: "Reach the team API as 127.0.0.1 or localhost. The port part is ignored, so an SSH port-forward is fine.",
  }),
  PAYLOAD_TOO_LARGE: Object.freeze({
    status: 413,
    error: "The team API accepts no request body.",
    hint: "Drop the body: every route is a plain GET with query parameters.",
  }),
  UNAUTHORIZED: Object.freeze({
    status: 401,
    error: "The local token was missing, malformed or rejected.",
    hint: "Send Authorization: Bearer with the 64 hex characters of .local-token. If that file was replaced while the team was running, restart the container so the server reloads it.",
  }),
  ROUTE_UNKNOWN: Object.freeze({
    status: 404,
    error: "The team API serves no such route.",
    hint: "Ask GET /version for the routes this container serves.",
  }),
  CONTRACT_HEADER_MISSING: Object.freeze({
    status: 400,
    error: "This request did not declare which API contract it speaks.",
    hint: "Send X-JHT-Api-Contract with the integer that GET /version reports. There is no default on purpose.",
  }),
  CONTRACT_HEADER_MALFORMED: Object.freeze({
    status: 400,
    error: "The API contract declared by this request is not a plain integer.",
    hint: "Send X-JHT-Api-Contract as a decimal integer of at most 4 digits, such as 1.",
  }),
  CLIENT_TOO_OLD: Object.freeze({
    status: 426,
    error:
      "This client speaks an older API contract than the container serves.",
    hint: "Update the JHT client, then run jht api status.",
  }),
  SERVER_TOO_OLD: Object.freeze({
    status: 409,
    error:
      "This container serves an older API contract than the client speaks.",
    hint: "Update the container image with jht container up --pull, then restart the team.",
  }),
  QUERY_PARAM_UNKNOWN: Object.freeze({
    status: 400,
    error: "The request carries a query parameter this route does not read.",
    hint: "Remove it. Ignoring an unread parameter would answer a different question from the one that was asked.",
  }),
  QUERY_PARAM_MALFORMED: Object.freeze({
    status: 400,
    error:
      "A query parameter of this request holds a value the route cannot read.",
    hint: "minScore and maxScore are plain integers: send them with no decimals and no units.",
  }),
  POSITION_NOT_FOUND: Object.freeze({
    status: 404,
    error: "The team database holds no position with that id.",
    hint: "Read the ids from GET /v1/positions.",
  }),
  TMUX_UNAVAILABLE: Object.freeze({
    status: 503,
    error: "The team API could not ask tmux which agents are running.",
    hint: 'This is not the same answer as "no agents": tmux itself is unreachable inside the container. Check logs/api.log.',
  }),
  DB_UNAVAILABLE: Object.freeze({
    status: 503,
    error: "The team database is missing or cannot be read.",
    hint: "Start the team once so jobs.db is created, then retry.",
  }),
  DB_SCHEMA_INCOMPLETE: Object.freeze({
    status: 503,
    error:
      "The team database is missing a table or a column these routes read.",
    hint: "Read schema.missing from GET /version, then start the team once so the agents migrate the database.",
  }),
  UNSUPPORTED_COLUMN_TYPE: Object.freeze({
    status: 500,
    error:
      "A database column holds a value the team API cannot put on the wire.",
    hint: "Report this together with logs/api.log: serializing it anyway would return a plausible wrong answer.",
  }),
  INTERNAL: Object.freeze({
    status: 500,
    error: "The team API failed to answer this request.",
    hint: "The reason is in logs/api.log inside the container, and is never sent over the wire.",
  }),
});

// [JHT-TEAM-API-BOUNDARY] Lettura di un intero di contratto.
//
// Il valore arriva da due parti, e nessuna delle due è fidata:
//   - lato server è il testo di un header, quindi una stringa, sempre;
//   - lato client è `data.contract` di un JSON, quindi un numero, di solito.
// Per questo la lettura accetta entrambe le forme e rifiuta tutto il resto.
//
// La grafia ammessa per il testo è UNA: decimale canonico, senza zeri
// iniziali, senza segno, senza decimali, massimo quattro cifre. `'01'`,
// `'+1'`, `'1.0'`, `'0x1'` sono rifiutati non per pignoleria ma perché ogni
// grafia in più è una domanda in più su cosa sia «uguale», e questo file
// esiste per dare a quella domanda una risposta sola. Il nostro client manda
// `String(API_CONTRACT)`, cioè l'unica grafia accettata.
const CONTRACT_TEXT = /^(?:0|[1-9]\d{0,3})$/;

/** Oltre quattro cifre non è un contratto, è rumore arrivato dalla rete. */
const CONTRACT_MAX = 9999;

/**
 * Caratteri di controllo: fuori da ogni frase che finisce in un terminale o
 * in una riga di log. Si usa la categoria Unicode `Cc` invece di un intervallo
 * scritto a mano perché copre C0, DEL e C1 senza che nessuno debba ricordare
 * dove finisce ognuno — e perché un intervallo sbagliato di una posizione
 * mangerebbe testo buono in silenzio.
 */
const CONTROL_CHARS = /\p{Cc}/gu;

/**
 * @typedef {{ state: 'read', value: number } | { state: 'missing' } | { state: 'malformed' }} ContractRead
 */

/**
 * @param {unknown} raw
 * @returns {ContractRead}
 */
function readContract(raw) {
  if (raw === null || raw === undefined) return { state: "missing" };
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0 || raw > CONTRACT_MAX)
      return { state: "malformed" };
    return { state: "read", value: raw };
  }
  if (typeof raw !== "string") return { state: "malformed" };
  // Node toglie già gli spazi ai bordi del valore di un header (l'OWS non fa
  // parte del valore), quindi questo `trim` non ammorbidisce il cancello:
  // serve a chi passa la riga grezza, che non merita un 400 per uno spazio
  // che HTTP stesso ignora. Un header duplicato invece Node lo unisce con
  // `, ` — `'1, 1'` non è decimale canonico e finisce fra i malformati, che
  // è il verso giusto in cui sbagliare.
  const text = raw.trim();
  if (text === "") return { state: "missing" };
  if (!CONTRACT_TEXT.test(text)) return { state: "malformed" };
  return { state: "read", value: Number(text) };
}

/** Quanto di un valore rifiutato si può citare senza farne un canale. */
const ECHO_MAX = 32;

/**
 * Il valore offeso, reso citabile: senza questo «non è un intero» non dice a
 * chi legge QUALE cosa non era un intero, e il rimedio resta da indovinare.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function echo(raw) {
  if (raw === null) return "null";
  if (raw === undefined) return "undefined";
  let text;
  try {
    text = typeof raw === "string" ? raw : String(raw);
  } catch {
    // `String(Symbol())` e gli oggetti con un `toString` ostile sanno
    // lanciare: un'eccezione dentro il codice che formatta un errore è il
    // modo più stupido di perdere la diagnosi.
    return "(unprintable)";
  }
  text = text.replace(CONTROL_CHARS, " ");
  return text.length > ECHO_MAX ? `${text.slice(0, ECHO_MAX)}…` : text;
}

/** Tetto di una frase d'errore: oltre, è un payload travestito da messaggio. */
const SENTENCE_MAX = 400;

/**
 * Una frase utilizzabile, oppure `null`.
 *
 * Il filtro sul tipo non è paranoia: `fail(code, { message: err })` è
 * l'errore di distrazione più naturale del mondo, e un `Error` finito nel
 * campo `error` diventa `[object Object]` sul terminale dell'utente. Qui un
 * valore che non è testo utile vale come «non fornito» e si usa il default
 * della tabella, che una frase ce l'ha sempre.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function sentence(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL_CHARS, " ").trim();
  if (text === "") return null;
  return text.length > SENTENCE_MAX ? `${text.slice(0, SENTENCE_MAX)}…` : text;
}

/**
 * `meta.generatedAt` — l'ora dichiarata dalla risposta.
 *
 * L'orologio è iniettabile perché i test non devono dipendere dall'ora vera,
 * e si accetta ogni forma in cui un chiamante può averlo in mano: `Date`,
 * millisecondi, ISO già fatto, o una funzione che restituisce una di queste.
 * Chi scrive il handler e chi scrive il client sono persone diverse: la
 * tolleranza sta qui, una volta, invece di essere un'assunzione ripetuta in
 * due file.
 *
 * Un orologio illeggibile ricade sull'ora corrente e non solleva: un
 * timestamp è metadato, e trasformare una lettura riuscita in un 500 per
 * decorare una risposta sarebbe sproporzionato. L'ora vera, del resto, non è
 * mai «sbagliata» — è solo diversa da quella iniettata, e un test che
 * inietta un orologio se ne accorge subito.
 *
 * @param {unknown} now
 * @returns {string}
 */
function isoTimestamp(now) {
  let value = now;
  if (typeof value === "function") {
    try {
      value = value();
    } catch {
      value = undefined;
    }
  }
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const asDate = new Date(value);
    if (Number.isFinite(asDate.getTime())) return asDate.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const asDate = new Date(value.trim());
    if (Number.isFinite(asDate.getTime())) return asDate.toISOString();
  }
  return new Date().toISOString();
}

/**
 * La busta `meta`, identica in successo e in errore: un client che sbaglia a
 * leggere il resto trova comunque il contratto con cui è stata scritta la
 * risposta che ha in mano.
 *
 * @param {unknown} now
 * @returns {{ contract: number, generatedAt: string }}
 */
function envelopeMeta(now) {
  return { contract: API_CONTRACT, generatedAt: isoTimestamp(now) };
}

/**
 * Come nominare in una frase un intero letto male: il valore se c'è, la
 * citazione del grezzo se no. Vive accanto a `contractVerdict` perché serve
 * solo alle sue frasi.
 *
 * @param {unknown} raw
 * @param {ContractRead} read
 * @returns {string}
 */
function readableOrEcho(raw, read) {
  return read.state === "read" ? String(read.value) : `"${echo(raw)}"`;
}

// [JHT-TEAM-API-BOUNDARY] Il verdetto sul contratto: l'unico cancello.
/**
 * Confronta il contratto dichiarato dal client con quello servito.
 *
 * Due direzioni, una sola funzione:
 *   - lato server `contractVerdict({ clientContract: headers[CONTRACT_HEADER] })`,
 *     dove il valore non fidato è quello del client;
 *   - lato client `contractVerdict({ clientContract: API_CONTRACT, serverContract: data.contract })`,
 *     dove il valore non fidato è quello che arriva dal filo.
 *
 * Per questo `serverContract` viene validato per primo, e per questo il
 * default vale solo quando la CHIAVE È ASSENTE: in JavaScript un default di
 * parametro non scatta su `null`, e scatta su `undefined` — cioè proprio nei
 * due casi in cui un `data.contract` che il server non ha dichiarato
 * diventerebbe «il server serve 1». Sarebbe un'invenzione, e sarebbe la
 * versione a due lati di `[CHAT-LANE-SILENT-DROP-ON-OLD-CLIENT]`: il client
 * proseguirebbe contro un server che non ha detto niente.
 *
 * `CONTRACT_UNKNOWN` non ha una riga in `ERROR_CODES` perché non è un esito
 * HTTP: è il verdetto che il CLIENT usa per rifiutarsi di indovinare (la
 * risposta HTTP, in quella direzione, è un 200 pieno di niente). Dal lato
 * server può nascere solo da un difetto di questo file, da cui lo stato 500 —
 * che in direzione client nessuno legge.
 *
 * Entrambi gli interi compaiono nel testo di ogni messaggio di
 * disallineamento, e non è cortesia: `cli/bin/jht.js` stampa solo
 * `err.message`, quindi un numero che non sta nella frase è un numero che
 * l'utente non vede mai.
 *
 * @param {{ clientContract?: unknown, serverContract?: unknown }} [input]
 * @returns {{ ok: true } | { ok: false, code: string, status: number, message: string }}
 */
export function contractVerdict(input) {
  const args = input && typeof input === "object" ? input : {};
  const rawClient = args.clientContract;
  const rawServer =
    "serverContract" in args ? args.serverContract : API_CONTRACT;

  const client = readContract(rawClient);
  const server = readContract(rawServer);

  const clientText = readableOrEcho(rawClient, client);

  if (server.state !== "read") {
    return {
      ok: false,
      code: "CONTRACT_UNKNOWN",
      status: ERROR_CODES.INTERNAL.status,
      message:
        `the team API did not declare a usable API contract (it stated ${readableOrEcho(rawServer, server)}); ` +
        `refusing to guess — this client speaks API contract ${clientText}`,
    };
  }

  const serverText = String(server.value);

  if (client.state === "missing") {
    return {
      ok: false,
      code: "CONTRACT_HEADER_MISSING",
      status: ERROR_CODES.CONTRACT_HEADER_MISSING.status,
      message:
        "this request carries no X-JHT-Api-Contract header, or carries it empty; this container " +
        `serves API contract ${serverText} — resend the request with X-JHT-Api-Contract: ${serverText}`,
    };
  }

  if (client.state === "malformed") {
    return {
      ok: false,
      code: "CONTRACT_HEADER_MALFORMED",
      status: ERROR_CODES.CONTRACT_HEADER_MALFORMED.status,
      message:
        "X-JHT-Api-Contract must be a decimal integer of at most 4 digits, but this request sent " +
        `${clientText}; this container serves API contract ${serverText} — resend the request with ` +
        `X-JHT-Api-Contract: ${serverText}`,
    };
  }

  if (client.value === server.value) return { ok: true };

  // Le due frasi di disallineamento sono scritte per essere lette da sole,
  // fuori da qualunque contesto: dicono chi parla cosa e quale lato va
  // aggiornato. Chi le legge ha in mano un terminale e nient'altro.
  if (client.value < server.value) {
    return {
      ok: false,
      code: "CLIENT_TOO_OLD",
      status: ERROR_CODES.CLIENT_TOO_OLD.status,
      message:
        `client speaks API contract ${client.value} but this container serves ${serverText} — ` +
        "update the JHT client",
    };
  }

  return {
    ok: false,
    code: "SERVER_TOO_OLD",
    status: ERROR_CODES.SERVER_TOO_OLD.status,
    message:
      `client speaks API contract ${client.value} but this container serves ${serverText} — ` +
      "update the container image (jht container up --pull), then restart the team",
  };
}

// [JHT-TEAM-API-BOUNDARY] Le due buste.
//
// `ok()` restituisce il solo corpo, `fail()` restituisce `{ status, body }`:
// l'asimmetria è voluta. In caso di successo lo stato è sempre 200 e la scelta
// è di chi risponde; in caso di errore lo stato è parte del contratto ed è la
// tabella a deciderlo — se lo scegliesse chi chiama, la tabella diventerebbe
// un suggerimento.
/**
 * La busta di successo.
 *
 * `data` assente diventa `null` e non una chiave mancante: `JSON.stringify`
 * cancella `undefined`, e un client che non trova la chiave non sa
 * distinguere «nessun payload» da «protocollo diverso da quello che credo».
 *
 * @param {unknown} data
 * @param {unknown} [now] orologio iniettabile — `Date`, ms, ISO o funzione
 * @returns {{ ok: true, data: unknown, meta: { contract: number, generatedAt: string } }}
 */
export function ok(data, now) {
  return {
    ok: true,
    data: data === undefined ? null : data,
    meta: envelopeMeta(now),
  };
}

/**
 * La busta d'errore, con lo stato HTTP che le spetta.
 *
 * Un `code` che non sta nella tabella non viene servito come se ci fosse: la
 * risposta diventa un 500 `INTERNAL` il cui `hint` NOMINA il codice ignoto e
 * questo file. È l'unico esito che non mente e non fa danni — sollevare
 * un'eccezione dentro il ramo che formatta gli errori vorrebbe dire far
 * cadere una richiesta a metà, e un socket che si chiude senza risposta è
 * meno leggibile di un 500.
 *
 * @param {string} code una chiave di `ERROR_CODES`
 * @param {{ message?: unknown, hint?: unknown, now?: unknown }} [options]
 * @returns {{ status: number, body: { ok: false, error: string, code: string, hint: string, meta: { contract: number, generatedAt: string } } }}
 */
export function fail(code, options) {
  const opts = options && typeof options === "object" ? options : {};
  const key = typeof code === "string" ? code : "";
  const row = Object.prototype.hasOwnProperty.call(ERROR_CODES, key)
    ? ERROR_CODES[key]
    : null;

  if (!row) {
    const internal = ERROR_CODES.INTERNAL;
    return {
      status: internal.status,
      body: {
        ok: false,
        error: internal.error,
        code: "INTERNAL",
        hint:
          `The team API asked for the error code "${echo(code)}", which shared/api/contract.js ` +
          "does not define. Report this together with logs/api.log.",
        meta: envelopeMeta(opts.now),
      },
    };
  }

  return {
    status: row.status,
    body: {
      ok: false,
      error: sentence(opts.message) ?? row.error,
      code: key,
      hint: sentence(opts.hint) ?? row.hint,
      meta: envelopeMeta(opts.now),
    },
  };
}
