// [JHT-TEAM-API-BOUNDARY] Il handler dell'API del team: richiesta dentro,
// risposta fuori, e niente in mezzo che assomigli a una rete.
/**
 * Questo file decide *cosa* rispondere. Non decide *come* farlo arrivare a
 * qualcuno: `node:http` qui non è importato — e non «per ora», ma perché è
 * proprio quell'assenza a rendere questo modulo provabile. Un handler che
 * costruisse il suo server si potrebbe provare solo legandosi a una porta, e
 * un test che si lega a una porta su questa macchina è un test che compete
 * col disco con gli altri worker di vitest (`tests/js/vitest.config.ts:31`
 * spiega perché la cosa è già costata quattro file morti). Con la forma
 * `reqLike -> { status, headers, body }` le trenta righe di adattatore stanno
 * in `server.js`, dichiaratamente non coperte, e tutto il resto — pipeline,
 * cancelli, payload — si prova in millisecondi senza un socket.
 *
 * Conseguenze volute di quella scelta, elencate perché non si perdano:
 *   · nessun indirizzo di peer viene letto. Non esiste `req.socket`, quindi
 *     non esiste la tentazione di trattare «viene da 127.0.0.1» come una
 *     credenziale. L'unica credenziale è il Bearer;
 *   · nessun `X-Forwarded-*` viene consultato, per la stessa ragione scritta
 *     in `web/lib/auth.ts:110-114`: un header lo scrive il client, e «non è
 *     una prova di località»;
 *   · nessun header `Access-Control-*`, nessun header che semini una
 *     credenziale nel browser (la famiglia `Set-…` che resta interamente in
 *     `web/`), nessun `WWW-Authenticate`. Non è un'API per un browser: non
 *     c'è pagina, non c'è login, e un `WWW-Authenticate` chiederebbe a un
 *     browser di aprire una finestra di password su una superficie che non ha
 *     utenti. L'elenco esatto degli header vietati, con il controllo che lo
 *     rende vero, sta in `tests/js/tasks/api-invariants-guard.test.ts`: qui
 *     nemmeno il loro NOME compare, perché la guardia cerca l'assenza del
 *     nome in tutti i file di questa cartella — un commento che li citasse
 *     spegnerebbe una prova per decorare una spiegazione.
 *
 * ## Il router si COSTRUISCE da `ROUTES`
 *
 * La tabella delle rotte vive in `shared/api/contract.js` e questo file la
 * legge, non la ricopia. «Aggiungere una rotta» è quindi una riga sola là, e
 * la rotta nuova entra automaticamente in `GET /version`, nel ciclo di guardia
 * che pretende il Bearer su ognuna (`api-invariants-guard.test.ts`) e nel
 * controllo di completezza qui sotto — che è la parte che sorprende: se una
 * voce di `ROUTES` non ha un handler, `createApiHandler` **solleva alla
 * costruzione**, cioè al boot del server, prima di qualunque `listen()`. Una
 * rotta dimenticata diventa un container che rifiuta di partire con un
 * messaggio che la nomina, invece di un 500 che qualcuno scopre in produzione.
 *
 * ## L'ordine della pipeline è normativo
 *
 * `method` → `Host` → `corpo` → `auth` → `rotta` → `contratto` → handler.
 *
 * Due punti dell'ordine sono decisioni, non caso:
 *   1. l'autenticazione viene PRIMA del riconoscimento della rotta e del
 *      controllo del contratto. Chi non ha il token non impara niente né
 *      sulla superficie (quali percorsi esistono) né sul protocollo (quale
 *      intero parliamo): riceve 401 e basta;
 *   2. il `Host` viene prima di tutto il resto tranne il metodo, ed è difesa
 *      in profondità contro il DNS rebinding — **non** autorizzazione. Un
 *      nome che risolve a 127.0.0.1 ma si chiama `evil.example` non passa; un
 *      client legittimo che arriva da `ssh -L 51234:127.0.0.1:9797` manda
 *      `Host: 127.0.0.1:51234` e passa, perché **la porta è ignorata**. Chi
 *      un giorno volesse «indurire» il controllo trasformandolo in un
 *      confronto `host:porta` romperebbe il tunnel su cui poggia la fase 2:
 *      c'è un test che lo dice a voce alta.
 */

import {
  API_CONTRACT,
  API_CONTRACT_SUPPORTED,
  CAPABILITIES,
  CONTRACT_HEADER,
  contractVerdict,
  ERROR_CODES,
  fail,
  ok,
  ROUTES,
} from '../../../../shared/api/contract.js';
import { POSITIONS_FILTERS } from '../../../../shared/queries/readonly-sqlite.js';
import {
  allTablesMissing,
  EXPECTED_USER_VERSION,
} from '../../../../shared/queries/schema-census.js';

// [JHT-TEAM-API-BOUNDARY] I metodi, e la sola frase che li elenca.
//
// `HEAD` è ammesso insieme a `GET` perché è la stessa lettura senza corpo: un
// client che vuole sapere «risponde?» senza scaricare la dashboard intera ha
// diritto a chiederlo, e negarglielo lo spingerebbe a fare un GET e buttare il
// risultato. Tutto il resto è 405: la corsia di scrittura è la fase 3, e un
// `POST` che rispondesse 404 lascerebbe credere che il percorso sia sbagliato
// invece del verbo.
const ALLOWED_METHODS = Object.freeze(['GET', 'HEAD']);
const ALLOW_HEADER_VALUE = ALLOWED_METHODS.join(', ');

/**
 * Gli unici nomi di host che valgono «questa scatola».
 *
 * Questo elenco NON è la regex di `web/lib/auth.ts:15-19`, ed è una differenza
 * voluta: quella, verificata, ammette come quinta alternativa anche
 * l'indirizzo jolly IPv4 (quattro zeri separati da punti), che come `Host`
 * significa «un indirizzo qualunque di questa macchina» e non «il loopback».
 * Qui è 421, e c'è un test che lo pretende scrivendolo per esteso — nel test e
 * non qui, perché nessun file di questa cartella deve contenere quel letterale:
 * la guardia `api-invariants-guard.test.ts` cerca proprio la sua assenza, ed è
 * la prova meccanica che nessuno si è legato a un indirizzo di rete.
 *
 * `::1` compare in entrambe le grafie: fra parentesi quadre è la forma legale
 * in un header `Host`, nuda è quella che scrivono a mano gli strumenti da riga
 * di comando. Accettarle entrambe non allarga niente — sono lo stesso
 * indirizzo — e rifiutarne una produrrebbe un 421 incomprensibile.
 */
const LOOPBACK_HOSTS = Object.freeze(new Set(['127.0.0.1', 'localhost', '::1', '[::1]']));

/**
 * Un valore di Host utilizzabile e nientaltro: solo ASCII stampabile, spazio
 * escluso. Un nome di host legale non esce da qui — gli internazionalizzati
 * arrivano in punycode — mentre uno spazio o un carattere di controllo in un
 * header sono rumore di rete o un tentativo di spezzare una riga di log.
 * Scritto come intervallo positivo (0x21-0x7e) invece che come elenco di cose
 * vietate: un allowlist di byte non ha buchi da ricordare.
 */
const HOST_SAFE = /^[!-~]+$/;

/** Una porta plausibile: cinque cifre al massimo, niente segno, niente altro. */
const PORT_ONLY = /^:\d{1,5}$/;

/**
 * L'insieme delle chiavi di query che ogni rotta legge davvero.
 *
 * I filtri di `/v1/positions` NON sono elencati a mano: arrivano da
 * `POSITIONS_FILTERS` in `shared/queries/readonly-sqlite.js`, che è la stessa
 * mappa da cui si monta l'SQL. Così «aggiungere un filtro» resta una riga in
 * un posto solo, e non può nascere il caso peggiore — un filtro che l'SQL
 * conosce e il cancello HTTP rifiuta con 400, o viceversa un filtro accettato
 * qui e ignorato là, che risponderebbe a una domanda diversa da quella fatta.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const ROUTE_QUERY_KEYS = Object.freeze({
  version: Object.freeze([]),
  teamStatus: Object.freeze([]),
  positions: Object.freeze(Object.keys(POSITIONS_FILTERS)),
  position: Object.freeze([]),
  dashboard: Object.freeze([]),
});

/**
 * I filtri che devono essere interi, letti dalla stessa mappa.
 *
 * Il controllo si fa QUI, oltre che nel lettore: un `minScore=abc` deve
 * diventare 400 prima di aprire il database, e in più il handler si prova con
 * un backend finto — se la validazione stesse solo a valle, un test con un
 * backend finto non vedrebbe mai il 400.
 */
const INTEGER_QUERY_KEYS = Object.freeze(
  Object.entries(POSITIONS_FILTERS)
    .filter(([, spec]) => spec.integer === true)
    .map(([name]) => name)
);

/** Un intero decimale come lo scrive un client, senza fronzoli. */
const INTEGER_TEXT = /^-?\d{1,15}$/;

/**
 * La tabella del router, costruita una volta sola all'import.
 *
 * I segmenti NON sono filtrati dai vuoti: `'/v1/positions'.split('/')` è
 * `['', 'v1', 'positions']` e `'/v1/positions/'` è `['', 'v1', 'positions', '']`,
 * quindi una barra in più è un 404 con il suo suggerimento invece di un
 * secondo modo di scrivere la stessa rotta. Per un'API di macchine una grafia
 * sola è una proprietà, non una scortesia: due grafie sono due cose da
 * ricordare per chi scrive un client e due percorsi da provare per chi scrive
 * un test.
 */
const ROUTE_TABLE = Object.freeze(
  ROUTES.map((route) =>
    Object.freeze({
      route,
      segments: Object.freeze(route.path.split('/')),
    })
  )
);

/**
 * La rotta come si scrive in una documentazione: `:id` → `{id}`.
 *
 * `GET /version` pubblica questa forma, `ROUTES` tiene quella del matcher. Due
 * grafie della stessa cosa esistono, ma una sola è scritta a mano — l'altra si
 * calcola, e quindi non può divergere.
 *
 * @param {string} path
 * @returns {string}
 */
function publicPath(path) {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

/**
 * La parte HOST di un header `Host`, in minuscolo, o `null` se illeggibile.
 *
 * ⚠️ La porta viene tolta e **buttata**. È il cuore della compatibilità col
 * port-forward: attraverso `ssh -L 51234:127.0.0.1:9797` il client scrive
 * `Host: 127.0.0.1:51234` e non ha modo di sapere quale porta ascolta il
 * server dall'altra parte del tunnel. Un allowlist `host:porta` funzionerebbe
 * solo in locale e romperebbe la fase 2 — con un 421 su una richiesta
 * perfettamente legittima, cioè il guasto meno diagnosticabile della famiglia.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
function hostPartOf(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '' || !HOST_SAFE.test(value)) return null;

  // Forma con parentesi quadre: `[::1]` oppure `[::1]:9797`. Le parentesi
  // restano nel risultato perché sono parte della grafia ammessa dall'elenco.
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) return null;
    const rest = value.slice(close + 1);
    if (rest !== '' && !PORT_ONLY.test(rest)) return null;
    return value.slice(0, close + 1).toLowerCase();
  }

  const colons = (value.match(/:/g) ?? []).length;
  // Più di un due punti senza parentesi è un IPv6 nudo: non può portare una
  // porta (sarebbe ambiguo), quindi si confronta tutto intero.
  if (colons > 1) return value.toLowerCase();
  if (colons === 1) {
    const cut = value.indexOf(':');
    const port = value.slice(cut);
    if (!PORT_ONLY.test(port)) return null;
    return value.slice(0, cut).toLowerCase();
  }
  return value.toLowerCase();
}

/**
 * Il valore di un header, tollerante sulla forma e mai eccezionale.
 *
 * Il contratto del `reqLike` dice «chiavi in minuscolo», e nel server è vero
 * per costruzione (Node consegna `req.headers` così). Questa funzione esiste
 * per i chiamanti sintetici — i test, un futuro adattatore — e per il caso in
 * cui Node consegni un ARRAY di valori duplicati: unirli con virgola è quello
 * che Node stesso fa per la maggior parte degli header, e produce una stringa
 * che i cancelli ancorati rifiutano. È il verso giusto in cui sbagliare.
 *
 * @param {Record<string, unknown> | null | undefined} headers
 * @param {string} name nome in minuscolo
 * @returns {string | null}
 */
function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  let raw = /** @type {Record<string, unknown>} */ (headers)[name];
  if (raw === undefined) {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    if (key !== undefined) raw = /** @type {Record<string, unknown>} */ (headers)[key];
  }
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(', ');
  return typeof raw === 'string' ? raw : null;
}

/**
 * C'è un corpo in questa richiesta?
 *
 * Tre segnali, in OR, perché nessuno dei tre da solo copre tutto: il server
 * dice quello che ha letto dal socket (`hasBody`), `transfer-encoding` è la
 * forma di un corpo di lunghezza ignota (chunked), `content-length` maggiore
 * di zero è quella dichiarata. `content-length: 0` non è un corpo: è un client
 * che dice «niente», e rispondere 413 a chi non ha mandato nulla sarebbe una
 * bugia con un numero dentro.
 *
 * @param {{ hasBody?: unknown, headers?: Record<string, unknown> }} reqLike
 * @returns {boolean}
 */
function requestHasBody(reqLike) {
  if (reqLike.hasBody === true) return true;
  const headers = reqLike.headers;
  const encoding = headerValue(headers, 'transfer-encoding');
  if (typeof encoding === 'string' && encoding.trim() !== '') return true;
  const length = headerValue(headers, 'content-length');
  if (typeof length === 'string' && /^\d+$/.test(length.trim())) {
    return Number(length.trim()) > 0;
  }
  return false;
}

/**
 * La query in forma normale, con i duplicati DICHIARATI.
 *
 * `?status=new&status=ready` è una domanda a cui non esiste una risposta
 * giusta: prendere il primo, l'ultimo o unire sono tre modi diversi di
 * rispondere a qualcosa che nessuno ha chiesto. Diventa quindi un 400, e il
 * riconoscimento della chiave ripetuta deve avvenire qui — a valle, in un
 * oggetto JavaScript, la ripetizione è già stata perduta.
 *
 * Accetta `URLSearchParams` (quello che costruisce `server.js`), una `Map` e
 * un oggetto semplice (quello che scrivono i test), perché il handler non
 * deve poter essere provato solo attraverso un pezzo di `node:http`.
 *
 * @param {unknown} query
 * @returns {{ values: Record<string, string>, duplicated: string[] }}
 */
function normalizeQuery(query) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string[]} */
  const duplicated = [];
  if (query === null || query === undefined) return { values, duplicated };

  /** @type {Array<[string, unknown]>} */
  let entries = [];
  if (typeof (/** @type {{ entries?: unknown }} */ (query).entries) === 'function') {
    entries = [...(/** @type {Iterable<[string, unknown]>} */ (
      /** @type {{ entries: () => Iterable<[string, unknown]> }} */ (query).entries()
    ))];
  } else if (typeof query === 'object') {
    entries = Object.entries(/** @type {Record<string, unknown>} */ (query));
  }

  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey);
    if (Array.isArray(rawValue)) {
      if (rawValue.length > 1) {
        if (!duplicated.includes(key)) duplicated.push(key);
        continue;
      }
      values[key] = rawValue.length === 0 ? '' : String(rawValue[0]);
      continue;
    }
    if (Object.hasOwn(values, key)) {
      if (!duplicated.includes(key)) duplicated.push(key);
      continue;
    }
    values[key] = rawValue === undefined || rawValue === null ? '' : String(rawValue);
  }
  return { values, duplicated };
}

/**
 * Il percorso di una richiesta, in segmenti, o `null` se non è utilizzabile.
 *
 * @param {unknown} raw
 * @returns {string[] | null}
 */
function pathSegments(raw) {
  if (typeof raw !== 'string' || raw === '' || !raw.startsWith('/')) return null;
  return raw.split('/');
}

/**
 * Riconoscimento della rotta sui segmenti, con il parametro decodificato.
 *
 * Un parametro VUOTO non combacia: `'/v1/positions/'` ha lo stesso numero di
 * segmenti di `'/v1/positions/:id'` e senza questo controllo verrebbe letto
 * come «la posizione con id stringa vuota», cioè un 400 su quello che è in
 * realtà un percorso scritto male.
 *
 * Le percentuali si sciolgono SOLO nel parametro. I segmenti fissi si
 * confrontano come sono scritti: `/v1/%70ositions` è un 404, non un secondo
 * modo di scrivere `/v1/positions`. Un solo nome per una rotta, come per la
 * barra finale.
 *
 * @param {string[]} segments
 * @returns {{ route: typeof ROUTES[number], params: Record<string, string> } | null | 'bad-escape'}
 */
function matchRoute(segments) {
  for (const entry of ROUTE_TABLE) {
    if (entry.segments.length !== segments.length) continue;
    /** @type {Record<string, string>} */
    const params = {};
    let matched = true;
    for (let i = 0; i < entry.segments.length; i += 1) {
      const expected = entry.segments[i];
      const actual = segments[i];
      if (expected.startsWith(':')) {
        if (actual === '') {
          matched = false;
          break;
        }
        let value;
        try {
          value = decodeURIComponent(actual);
        } catch {
          // `%zz` non è un percorso: è testo rotto. Si distingue dal 404
          // perché il rimedio è diverso — riscrivere la richiesta, non
          // cercare un'altra rotta.
          return 'bad-escape';
        }
        params[expected.slice(1)] = value;
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: entry.route, params };
  }
  return null;
}

/**
 * Il testo di un errore qualunque, senza fidarsi della sua forma. Serve alle
 * righe di log, mai al filo.
 *
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(/** @type {{ message: unknown }} */ (error).message);
  }
  return String(error);
}

/**
 * Costruisce il handler dell'API del team.
 *
 * @param {object} deps
 * @param {{
 *   dbPath?: string,
 *   describeDb: () => { present: boolean, readable: boolean, readOnlyEnforced: boolean | null, path: string },
 *   census: () => { present: boolean, readable: boolean, userVersion: number | null, expected: number, missing: string[], reason: string | null },
 *   listPositions: (filters?: Record<string, unknown>) => unknown[],
 *   getPosition: (id: unknown) => unknown,
 *   getDashboard: () => Record<string, unknown>,
 * }} deps.backend il lettore di `shared/queries/readonly-sqlite.js`
 * @param {{ authenticate: (req: { headers?: Record<string, unknown> }) => boolean }} deps.auth
 *   `cli/src/lib/api/auth.js`. Una funzione sola, un parametro solo: la corsia
 *   riservata al browser del desktop nativo — quella descritta in
 *   `web/lib/local-token.ts:10-23` — non è raggiungibile da qui nemmeno per
 *   distrazione, e accenderla richiederebbe un PARAMETRO NUOVO in questa firma.
 * @param {() => ({ tmux: 'ok' | 'no-server' | 'absent', sessions: string[] } | Promise<{ tmux: string, sessions: string[] }>)} deps.tmux
 *   la lettura del roster (`cli/src/lib/api/tmux-read.js`), iniettata: il
 *   handler non conosce nessun trasporto, nemmeno `spawnSync`.
 * @param {{ product?: string, node?: string, pid?: number, startedAt?: string }} [deps.meta]
 * @param {unknown} [deps.now] orologio iniettabile, passato alle buste
 * @returns {(reqLike: { method?: string, path?: string, query?: unknown, headers?: Record<string, unknown>, hasBody?: unknown }) => Promise<{ status: number, headers: Record<string, string>, body: string, logLine?: string }>}
 */
export function createApiHandler({ backend, auth, tmux, meta = {}, now } = {}) {
  if (!backend || typeof backend !== 'object') {
    throw new TypeError('createApiHandler needs a read-only backend as backend.');
  }
  if (!auth || typeof auth.authenticate !== 'function') {
    throw new TypeError('createApiHandler needs an auth module exposing authenticate(req).');
  }
  if (typeof tmux !== 'function') {
    throw new TypeError('createApiHandler needs the tmux roster reader as a function.');
  }

  // ── I payload delle rotte ────────────────────────────────────────────────
  //
  // [JHT-TEAM-API-BOUNDARY] Un handler per NOME di rotta, e i nomi sono quelli
  // di `ROUTES`. Ognuno restituisce `{ status, body }`: chi vince decide anche
  // il suo stato, così un 503 non deve passare da un canale laterale.

  /**
   * `GET /version` — la sola rotta che non deve poter fallire.
   *
   * È la rotta che si interroga quando qualcos'altro non va: se rispondesse
   * 500 perché il database non c'è, il client perderebbe l'unico posto dove è
   * scritto che il database non c'è. Per questo il blocco `db`/`schema` è
   * avvolto: un backend che solleva produce un `/version` che DICE di non
   * sapere, mai un `/version` che tace.
   *
   * Il `missing` del caso disperato è `allTablesMissing()` e non `[]`: un
   * elenco vuoto significa «schema completo», e dirlo di un database che non
   * si riesce nemmeno a interrogare è la bugia più comoda del repertorio.
   */
  function versionRoute() {
    let db;
    let schema;
    try {
      db = backend.describeDb();
    } catch {
      db = {
        present: false,
        readable: false,
        readOnlyEnforced: null,
        path: typeof backend.dbPath === 'string' ? backend.dbPath : null,
      };
    }
    try {
      const result = backend.census();
      schema = {
        userVersion: result.userVersion,
        expected: typeof result.expected === 'number' ? result.expected : EXPECTED_USER_VERSION,
        missing: result.missing,
      };
    } catch {
      schema = {
        userVersion: null,
        expected: EXPECTED_USER_VERSION,
        missing: allTablesMissing(),
      };
    }

    return {
      status: 200,
      body: ok(
        {
          contract: API_CONTRACT,
          supported: [...API_CONTRACT_SUPPORTED],
          product: typeof meta.product === 'string' ? meta.product : null,
          node: typeof meta.node === 'string' ? meta.node : process.version,
          pid: typeof meta.pid === 'number' ? meta.pid : process.pid,
          startedAt: typeof meta.startedAt === 'string' ? meta.startedAt : null,
          // `/version` non compare fra le rotte pubblicate: non è una
          // capacità, è l'handshake che permette di scoprire le altre.
          routes: ROUTES.filter((r) => r.name !== 'version').map((r) => publicPath(r.path)),
          capabilities: [...CAPABILITIES],
          db,
          schema,
        },
        now
      ),
    };
  }

  /**
   * `GET /v1/team/status` — l'unica rotta che non tocca il database, e quella
   * con cui la fase 2 misurerà il tunnel.
   *
   * `absent` è un 503 e non una lista vuota: sono le due risposte che
   * ADR-0009:111-113 chiede espressamente di non confondere. `no-server` è
   * invece un 200 con `sessions: []`, perché lì tmux ha risposto ed è
   * autorevole — il team è spento, non irraggiungibile.
   *
   * Nomi di sessione grezzi: nessun ruolo, nessuna descrizione, nessun colore.
   * La presentazione è del CLI, e le due tabelle dei ruoli nel repo non sono
   * nemmeno d'accordo fra loro (7 voci contro 9): imporne una dall'API
   * costringerebbe ogni client ad accettare la nostra.
   */
  async function teamStatusRoute() {
    const roster = await tmux();
    const state = roster && typeof roster === 'object' ? roster.tmux : undefined;
    if (state !== 'ok' && state !== 'no-server') {
      return fail('TMUX_UNAVAILABLE', { now });
    }
    const sessions = Array.isArray(roster.sessions) ? roster.sessions.map((s) => String(s)) : [];
    return {
      status: 200,
      body: ok(
        {
          tmux: state,
          sessions,
          readAt: new Date().toISOString(),
          source: 'tmux',
        },
        now
      ),
    };
  }

  /**
   * Il cancello del database, prima di ogni rotta dati.
   *
   * Il censimento gira a OGNI richiesta, e non è una svista: metterlo in cache
   * significherebbe servire 503 dopo che gli agenti hanno migrato lo schema,
   * finché qualcuno non riavvia il container. Cinque `prepare` su un file
   * locale, per un'API di loopback con un client, sono un prezzo che si paga
   * volentieri per non avere uno stato che invecchia.
   *
   * I due 503 dicono due cose diverse da fare, e per questo l'ordine conta:
   * `DB_UNAVAILABLE` è «avvia il team una volta, il database non c'è ancora»,
   * `DB_SCHEMA_INCOMPLETE` è «il database c'è ma gli manca una colonna che
   * queste rotte leggono».
   *
   * @returns {{ status: number, body: object } | null} `null` se si può leggere
   */
  function databaseGate() {
    const state = backend.census();
    if (!state.present || !state.readable) {
      return fail('DB_UNAVAILABLE', { message: state.reason ?? undefined, now });
    }
    if (Array.isArray(state.missing) && state.missing.length > 0) {
      return fail('DB_SCHEMA_INCOMPLETE', {
        message:
          'The team database is missing something these routes read: ' +
          `${state.missing.join(', ')}.`,
        now,
      });
    }
    return null;
  }

  /** `GET /v1/positions` — array NUDO, come `db_query.py positions --json`. */
  function positionsRoute(query) {
    const blocked = databaseGate();
    if (blocked) return blocked;
    return { status: 200, body: ok(backend.listPositions(query), now) };
  }

  /**
   * `GET /v1/positions/{id}` — la riga, oppure 404.
   *
   * Il lettore restituisce `null` per «non c'è» (è il contratto di
   * `db_query.py:212`, che la corsia `--json` del CLI stampa così); sul filo
   * quel `null` diventa 404 `POSITION_NOT_FOUND`, perché un 200 con `null`
   * dentro obbligherebbe ogni client a distinguere «non trovata» da «trovata e
   * vuota» guardando il corpo.
   */
  function positionRoute(params) {
    const blocked = databaseGate();
    if (blocked) return blocked;
    const row = backend.getPosition(params.id);
    if (row === null || row === undefined) return fail('POSITION_NOT_FOUND', { now });
    return { status: 200, body: ok(row, now) };
  }

  /** `GET /v1/dashboard` — esattamente le sei chiavi di `DASHBOARD_KEYS`. */
  function dashboardRoute() {
    const blocked = databaseGate();
    if (blocked) return blocked;
    return { status: 200, body: ok(backend.getDashboard(), now) };
  }

  /** @type {Record<string, (query: Record<string, string>, params: Record<string, string>) => any>} */
  const HANDLERS = {
    version: () => versionRoute(),
    teamStatus: () => teamStatusRoute(),
    positions: (query) => positionsRoute(query),
    position: (_query, params) => positionRoute(params),
    dashboard: () => dashboardRoute(),
  };

  // [JHT-TEAM-API-BOUNDARY] Completezza, verificata alla COSTRUZIONE.
  //
  // Il boot del server costruisce il handler prima di qualunque `listen()`
  // (`server.js`), quindi una rotta aggiunta a `ROUTES` senza handler — o una
  // rotta senza elenco di chiavi di query — fa rifiutare l'avvio con un
  // messaggio che la nomina. L'alternativa sarebbe un 500 su una rotta che
  // esiste in `/version`, cioè un guasto che si scopre da un utente.
  const missingPieces = [];
  for (const route of ROUTES) {
    if (typeof HANDLERS[route.name] !== 'function') {
      missingPieces.push(`handler for route "${route.name}" (${route.path})`);
    }
    if (!Object.hasOwn(ROUTE_QUERY_KEYS, route.name)) {
      missingPieces.push(`query whitelist for route "${route.name}" (${route.path})`);
    }
  }
  for (const name of Object.keys(HANDLERS)) {
    if (!ROUTES.some((route) => route.name === name)) {
      missingPieces.push(`route entry in shared/api/contract.js for handler "${name}"`);
    }
  }
  if (missingPieces.length > 0) {
    throw new TypeError(
      `cli/src/lib/api/handler.js is out of step with ROUTES — missing: ${missingPieces.join('; ')}`
    );
  }

  // ── La busta HTTP ────────────────────────────────────────────────────────

  /**
   * Gli header di OGNI risposta, errori compresi.
   *
   * `x-jht-api-contract` sta anche in risposta perché il client lo confronta
   * prima di leggere il corpo: è così che si scopre un container vecchio che
   * risponde a un client nuovo sulla stessa porta. `no-store` perché non
   * esiste una risposta di questa API che valga la pena rileggere: sono tutte
   * lo stato di adesso.
   *
   * @param {number} length byte del corpo
   * @param {Record<string, string>} [extra]
   * @returns {Record<string, string>}
   */
  function responseHeaders(length, extra) {
    return {
      'content-type': 'application/json; charset=utf-8',
      [CONTRACT_HEADER]: String(API_CONTRACT),
      'cache-control': 'no-store',
      'content-length': String(length),
      ...(extra ?? {}),
    };
  }

  /**
   * Serializza e impacchetta.
   *
   * Il corpo esce SEMPRE serializzato, anche su `HEAD`, con un
   * `content-length` che dice la verità sull'entità: è quello che `HEAD`
   * serve a sapere. Buttare i byte è compito dell'adattatore in `server.js`,
   * che è l'unico posto che sa se sta parlando con un socket.
   *
   * @param {number} status
   * @param {unknown} body
   * @param {Record<string, string>} [extraHeaders]
   * @param {string} [logLine]
   */
  function respond(status, body, extraHeaders, logLine) {
    let text;
    try {
      text = JSON.stringify(body);
    } catch (error) {
      // Un corpo che non si serializza è un difetto nostro, e va detto in
      // una riga di log — non con un socket che si chiude a metà risposta.
      const fallback = fail('INTERNAL', { now });
      const fallbackText = JSON.stringify(fallback.body);
      return {
        status: fallback.status,
        headers: responseHeaders(Buffer.byteLength(fallbackText)),
        body: fallbackText,
        logLine: `response body could not be serialized: ${messageOf(error)}`,
      };
    }
    const out = {
      status,
      headers: responseHeaders(Buffer.byteLength(text), extraHeaders),
      body: text,
    };
    if (logLine) out.logLine = logLine;
    return out;
  }

  /** Un rifiuto della tabella, impacchettato. */
  function respondFail(code, options) {
    const verdict = fail(code, { ...(options ?? {}), now });
    const extra = code === 'METHOD_NOT_ALLOWED' ? { allow: ALLOW_HEADER_VALUE } : undefined;
    return respond(verdict.status, verdict.body, extra, options?.logLine);
  }

  /**
   * Traduce un errore sollevato da un lettore nel vocabolario del contratto.
   *
   * Un `code` che sta in `ERROR_CODES` viaggia col suo messaggio: quei
   * messaggi li scrive `readonly-sqlite.js` in inglese e sicuri da mostrare
   * (nominano una colonna o un percorso, mai una traccia). Tutto il resto è un
   * 500 il cui MOTIVO finisce nel log e non sul filo — l'`hint` della tabella
   * dice già dove guardare.
   */
  function failFromError(error, where) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    if (typeof code === 'string' && Object.hasOwn(ERROR_CODES, code)) {
      return respondFail(code, { message: messageOf(error) });
    }
    const cause = /** @type {{ cause?: unknown }} */ (error)?.cause;
    const detail = cause ? ` cause="${messageOf(cause)}"` : '';
    return respondFail('INTERNAL', {
      logLine: `unhandled failure on ${where}: ${messageOf(error)}${detail}`,
    });
  }

  // ── La pipeline ──────────────────────────────────────────────────────────

  return async function apiHandler(reqLike) {
    const req = reqLike && typeof reqLike === 'object' ? reqLike : {};
    const method = typeof req.method === 'string' ? req.method.toUpperCase() : '';
    const headers = req.headers && typeof req.headers === 'object' ? req.headers : {};

    try {
      // 1. Il metodo. Prima di tutto, perché un verbo che non serviamo non
      //    merita nemmeno che si guardi dove voleva andare.
      if (!ALLOWED_METHODS.includes(method)) {
        return respondFail('METHOD_NOT_ALLOWED');
      }

      // 2. Il `Host`, parte host soltanto. Assente → 421: un client che non
      //    dichiara chi crede di avere davanti non ha superato il controllo,
      //    ha solo evitato di sottoporsi.
      const host = hostPartOf(headerValue(headers, 'host'));
      if (host === null || !LOOPBACK_HOSTS.has(host)) {
        return respondFail('HOST_NOT_LOOPBACK');
      }

      // 3. Il corpo. Nessuna rotta ne legge uno, quindi riceverne uno
      //    significa che il client sta parlando di un'altra API.
      if (requestHasBody(req)) {
        return respondFail('PAYLOAD_TOO_LARGE');
      }

      // 4. L'autenticazione, PRIMA della rotta e del contratto. Un errore
      //    dentro `authenticate` è un 401 e non un 500: qualunque strada che
      //    non finisca in un confronto riuscito è un rifiuto, e la diagnosi
      //    va nel log.
      let authorized = false;
      let authFailure = null;
      try {
        authorized = auth.authenticate({ headers }) === true;
      } catch (error) {
        authFailure = messageOf(error);
      }
      if (!authorized) {
        // Il valore fornito NON viene ripetuto nella risposta: sarebbe un
        // modo di far scrivere al server, in un log altrui o in un terminale
        // condiviso, un segreto che il client ha già.
        return respondFail('UNAUTHORIZED', {
          logLine: authFailure ? `auth check raised: ${authFailure}` : undefined,
        });
      }

      // 5. La rotta.
      const segments = pathSegments(req.path);
      if (segments === null) {
        return respondFail('ROUTE_UNKNOWN');
      }
      const matched = matchRoute(segments);
      if (matched === 'bad-escape') {
        return respondFail('QUERY_PARAM_MALFORMED', {
          message: 'The path of this request contains an invalid percent-escape.',
        });
      }
      if (matched === null) {
        return respondFail('ROUTE_UNKNOWN');
      }
      const { route, params } = matched;

      // 6. Il contratto, solo dove è richiesto. `/version` è esente per
      //    costruzione: è la rotta che spiega quale intero mandare.
      if (route.contractRequired) {
        const verdict = contractVerdict({ clientContract: headerValue(headers, CONTRACT_HEADER) });
        if (!verdict.ok) {
          return respondFail(verdict.code, { message: verdict.message });
        }
      }

      // 7. La query, contro l'elenco della rotta.
      const { values, duplicated } = normalizeQuery(req.query);
      if (duplicated.length > 0) {
        return respondFail('QUERY_PARAM_MALFORMED', {
          message:
            `The query repeats ${duplicated.join(', ')}: this route reads one value per ` +
            'parameter, and picking one of two would answer a different question.',
        });
      }
      const allowed = ROUTE_QUERY_KEYS[route.name];
      for (const key of Object.keys(values)) {
        if (!allowed.includes(key)) {
          return respondFail('QUERY_PARAM_UNKNOWN', {
            message: `${route.path} does not read the query parameter ${key}.`,
          });
        }
      }
      for (const key of INTEGER_QUERY_KEYS) {
        if (!Object.hasOwn(values, key)) continue;
        const raw = values[key].trim();
        if (raw !== '' && !INTEGER_TEXT.test(raw)) {
          return respondFail('QUERY_PARAM_MALFORMED', {
            message: `The ${key} query parameter must be a plain integer.`,
          });
        }
      }

      // 8. Il payload.
      const result = await HANDLERS[route.name](values, params);
      if (typeof result?.status === 'number' && result.body !== undefined) {
        return respond(result.status, result.body);
      }
      return respondFail('INTERNAL', {
        logLine: `route "${route.name}" returned no usable result`,
      });
    } catch (error) {
      return failFromError(error, `${method} ${typeof req.path === 'string' ? req.path : '?'}`);
    }
  };
}
