// [JHT-TEAM-API-BOUNDARY] L'unico pezzo di questo ticket che tocca un socket.
/**
 * Il server dell'API del team: si lega a `127.0.0.1`, dà ogni richiesta al
 * handler e non decide niente da sé.
 *
 * ## Perché è così sottile, e perché è l'unica parte non provata
 *
 * Tutto ciò che si può sbagliare in una risposta — pipeline, cancelli, forma
 * del payload — vive in `handler.js`, che è puro e si prova senza rete. Qui
 * resta l'adattatore: leggere `req`, scrivere `res`, e la sequenza di avvio.
 * È la parte che su questa macchina non si può provare in modo onesto — un
 * test che si lega a una porta compete col disco con gli altri worker di
 * vitest, e quel conto è già stato pagato una volta
 * (`tests/js/vitest.config.ts:31`) — quindi la sua superficie è tenuta al
 * minimo di proposito, e il fatto che non sia coperta è **detto**, non
 * sottinteso.
 *
 * ## La sequenza di avvio, e il perché di ogni rifiuto
 *
 * Quattro condizioni vengono verificate PRIMA che esista un socket, e ognuna
 * fallisce con `exit 78` e una riga sola che la nomina. Il codice 78 è
 * `EX_CONFIG` di `sysexits`, e pid1 lo tratta come «non riprovare»: un
 * guasto di configurazione non si risolve rinascendo cinque secondi dopo, si
 * risolve leggendo la riga di log.
 *
 *   1. **deploy cloud** — se l'ambiente dice `cloud`, il local-token non esiste
 *      per definizione (`shared/auth/local-token.js`) e ogni richiesta
 *      risponderebbe 401 per sempre. Un server legato alla porta che non
 *      autentica nessuno è il guasto più costoso della famiglia: somiglia a un
 *      problema di credenziali, ed è invece un problema di ambiente. Meglio
 *      non partire e dirlo.
 *   2. **`node:sqlite` assente** — serve Node ≥ 22.5 e il digest dell'immagine
 *      è congelato dal 2026-04-27 (`Dockerfile:9`), quindi la minor version
 *      dentro il container non è verificata da nessuno. Non c'è nessun
 *      ripiego su `better-sqlite3`: è nativo, non è installato nell'immagine e
 *      la toolchain per compilarlo viene cancellata nello stesso `RUN` che la
 *      installa. Se manca, la fase è bloccata su un bump del digest — che è
 *      una modifica da misurare per conto suo.
 *   3. **token non ottenibile** — filesystem in sola lettura, `JHT_HOME` non
 *      scrivibile. Stessa ragione del punto 1.
 *   4. **sola lettura non dimostrata** — la sonda scrive su un database
 *      usa-e-getta passando dalla STESSA apertura dell'handle vero
 *      (`shared/queries/readonly-sqlite.js`). Se la scrittura passa, questo
 *      processo terrebbe un handle SCRIVIBILE sul `jobs.db` vivo mentre gli
 *      agenti Python scrivono in WAL. È la trappola da un carattere
 *      (`readOnly` contro `readonly`), e l'unica risposta accettabile è non
 *      partire.
 *
 * Il token si genera **prima** di `listen()`, non alla prima richiesta.
 * Verificato: `~/.jht/.local-token` oggi non esiste mentre `~/.jht/` ha già
 * altri cinque contenuti, perché la generazione è pigra. Con la generazione
 * pigra un client che legge il file per primo trova `ENOENT` e non sa
 * distinguere «il server non è ancora su» da «non sono autorizzato»: due
 * situazioni con due rimedi diversi.
 *
 * ## L'avviso sperimentale di `node:sqlite`, accettato a occhi aperti
 *
 * `import('node:sqlite')` stampa su stderr «ExperimentalWarning: SQLite is an
 * experimental feature and might change at any time» — misurato su node
 * v22.20.0, senza nessun flag. Dentro il container questo processo è figlio di
 * pid1, quindi quella riga finisce in `$JHT_HOME/logs/api.log` a ogni boot.
 * **Si accetta.** Silenziarla richiederebbe `NODE_NO_WARNINGS=1` (o
 * `--no-warnings`) sul punto di spawn, che sta in `cli/src/commands/pid1.js`,
 * cioè in un file di un altro gruppo — e soprattutto quella riga è l'unica
 * prova, nel log, di quale SQLite ha caricato l'immagine: il giorno che il
 * driver diventa stabile o cambia forma, l'avviso che compare o scompare è
 * l'indizio. Una riga per boot, in un file di log, non è rumore: è datazione.
 */

import http from 'node:http';

import pkg from '../../../package.json' with { type: 'json' };
import { API_CONTRACT } from '../../../../shared/api/contract.js';
import { JHT_DB_PATH } from '../../../../shared/paths.js';
import { createReadonlyBackend } from '../../../../shared/queries/readonly-sqlite.js';
import { userVersionWarning } from '../../../../shared/queries/schema-census.js';
import * as auth from './auth.js';
import { createApiHandler } from './handler.js';
import { readTmuxSessions } from './tmux-read.js';

/**
 * La porta, e il suo unico interruttore.
 *
 * Vive in una costante di modulo e **non** in `docker-compose.yml`: il compose
 * installato è inchiodato per sha256 nel manifest di runtime e verificato prima
 * di ogni chiamata a docker (`scripts/jht-wrapper.sh:246`), quindi un `ports:`
 * lì significherebbe che la porta non si può più cambiare senza rigenerare il
 * manifest. Qui invece `JHT_API_PORT` la sposta dentro il container, che è
 * l'unico posto da cui questa API è raggiungibile in fase 1.
 *
 * `Number(...) || 9797` scarta anche lo `0`, e per fortuna: `listen(0)`
 * prenderebbe una porta a caso, cioè un server acceso che nessun client sa
 * dove trovare.
 */
export const API_PORT = Number(process.env.JHT_API_PORT) || 9797;

/**
 * L'indirizzo di ascolto, come costante e non come default di argomento.
 *
 * `server.listen(port)` senza indirizzo ascolta su **tutte** le interfacce:
 * dentro il container vorrebbe dire che chiunque sia sulla rete di quel
 * container può parlarci. L'indirizzo è quindi il secondo argomento POSIZIONALE
 * ed esplicito — stesso precedente di `cli/src/auth/subscription-login.js:97` —
 * e c'è un test di guardia che pretende di trovarlo scritto in questo file.
 */
const BIND_ADDRESS = '127.0.0.1';

/** `EX_CONFIG` di sysexits: pid1 non fa rinascere un figlio uscito così. */
const EXIT_CONFIG = 78;

/**
 * I tetti della superficie HTTP, tutti espliciti.
 *
 * Non sono difesa da un attacco di volume — dietro un bind di loopback e un
 * bearer da 32 byte non c'è traffico anonimo — ma da un client rotto: una
 * connessione che apre e non parla, un `keep-alive` mai chiuso, mille socket
 * lasciati aperti da un ciclo di retry. Con questi numeri il caso peggiore è
 * una richiesta che scade, non un processo che cresce.
 */
const REQUEST_TIMEOUT_MS = 15_000;
const HEADERS_TIMEOUT_MS = 5_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const MAX_HEADERS_COUNT = 32;
const MAX_CONNECTIONS = 32;

/**
 * `EADDRINUSE`: tre ritentativi con attesa crescente, poi si rinuncia.
 *
 * Un tetto e non un ciclo infinito, e la differenza è tutta in chi supervisiona:
 * ogni altro figlio di pid1 rinasce dopo 5000 ms senza limite, che per un
 * processo che si lega a una PORTA con una causa permanente (qualcun altro la
 * tiene) è un ciclo che non finisce mai e riempie il log. Tre tentativi
 * coprono il caso vero — il figlio precedente sta ancora chiudendo il socket —
 * e il quarto esito è `exit 78`, che pid1 non fa rinascere.
 */
const LISTEN_BACKOFF_MS = Object.freeze([250, 750, 1500]);

/** Quanto si aspetta una chiusura ordinata prima di uscire comunque. */
const HARD_EXIT_MS = 3_000;

/** Il percorso del database, con l'override che il resto del CLI già usa. */
const DEFAULT_DB_PATH = process.env.JHT_DB || JHT_DB_PATH;

/**
 * Il diario di bordo, nella convenzione della cartella
 * (`cli/src/lib/team-state-reconciler.js:52-58`): tag, ora ISO, messaggio.
 *
 * Nessun `picocolors` e nessun altro import a pacchetto: sotto
 * `cli/src/lib/api/` gli specificatori ammessi sono `node:`, `.` e `/`, ed è
 * la premessa su cui poggia la misura del costo immagine (roadmap §7.1). Il
 * colore, in un file di log, non lo legge nessuno.
 *
 * Il tag è `[api-server]` e non `[api]` perché pid1 prefissa già l'output del
 * figlio con `[api] `: due tag identici renderebbero `grep` inutile proprio
 * sul file in cui serve.
 */
const TAG = '[api-server]';

/** @param {string} message */
function log(message) {
  console.log(`${TAG} ${new Date().toISOString()} ${message}`);
}

/** @param {string} message */
function logError(message) {
  console.error(`${TAG} ${new Date().toISOString()} ${message}`);
}

/**
 * Il rifiuto di partire: UNA riga con un nome, poi `exit 78`.
 *
 * `REFUSING TO LISTEN` è il token da cercare in `logs/api.log`, ed è scritto
 * in maiuscolo per la stessa ragione per cui è una riga sola: chi apre quel
 * file lo apre perché qualcosa non risponde, e deve trovare la causa senza
 * leggere il resto.
 *
 * @param {string} reason frase inglese che nomina la causa e il rimedio
 * @returns {never}
 */
function refuseToListen(reason) {
  logError(`REFUSING TO LISTEN — ${reason}`);
  process.exit(EXIT_CONFIG);
  // `process.exit` non ritorna, ma il throw rende la cosa vera anche per chi
  // legge il tipo di questa funzione (e per un test che rimpiazzasse `exit`).
  throw new Error(reason);
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Percorso e query di una richiesta, senza fidarsi del request-target.
 *
 * Si usano SOLO `pathname` e `searchParams`. Un client può legittimamente
 * mandare la forma assoluta (`GET http://qualcosa/v1/positions HTTP/1.1`) e
 * quell'autorità viene **ignorata**: l'unico posto da cui si decide se la
 * richiesta è per noi è l'header `Host`, che il handler controlla per conto
 * suo. Leggere l'autorità del request-target vorrebbe dire avere due fonti
 * per la stessa domanda, cioè due risposte possibili.
 *
 * @param {string | undefined} rawUrl
 * @returns {{ path: string, query: URLSearchParams }}
 */
function requestTarget(rawUrl) {
  try {
    const url = new URL(String(rawUrl ?? ''), `http://${BIND_ADDRESS}`);
    return { path: url.pathname, query: url.searchParams };
  } catch {
    // Un request-target che non si legge non è una rotta: `/` non combacia con
    // nessuna voce di `ROUTES` e diventa un 404 col suo suggerimento.
    return { path: '/', query: new URLSearchParams() };
  }
}

/**
 * Un tentativo di `listen`, come promessa che si risolve o rifiuta una volta
 * sola.
 *
 * I due ascoltatori si smontano a vicenda: senza, un `error` dopo un
 * `listening` (succede: un socket che muore subito) rifiuterebbe una promessa
 * già risolta, che è un no-op silenzioso, e lascerebbe un ascoltatore
 * appeso a ogni ritentativo.
 *
 * @param {import('node:http').Server} server
 * @param {number} port
 * @returns {Promise<void>}
 */
function listenOnce(server, port) {
  return new Promise((resolve, reject) => {
    /** @param {Error} error */
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    // [JHT-TEAM-API-BOUNDARY] L'indirizzo è scritto QUI per esteso, e non come
    // `BIND_ADDRESS`, perché la guardia (`api-invariants-guard.test.ts`) legge
    // il TESTO di questo file: passare una costante nasconderebbe l'indirizzo
    // al controllo, e il controllo esiste proprio per rendere impossibile un
    // ascolto su tutte le interfacce. Il punto di verità è questa riga; la
    // costante decora solo i messaggi.
    server.listen(port, '127.0.0.1');
  });
}

/**
 * `listen` con i ritentativi previsti, oppure `exit 78`.
 *
 * @param {import('node:http').Server} server
 * @param {number} port
 */
async function listenWithRetry(server, port) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await listenOnce(server, port);
      return;
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error)?.code;
      if (code !== 'EADDRINUSE') {
        // `EACCES`, `ERR_SOCKET_BAD_PORT`, un indirizzo che non esiste: cause
        // che un'attesa non cambia. Si esce subito, con il codice del driver
        // nella riga, invece di provare tre volte la stessa cosa.
        refuseToListen(
          `the team API could not bind ${BIND_ADDRESS}:${port} (${code ?? 'unknown error'}: ` +
            `${/** @type {Error} */ (error).message}).`
        );
      }
      if (attempt >= LISTEN_BACKOFF_MS.length) {
        refuseToListen(
          `port ${port} on ${BIND_ADDRESS} is still in use inside the container after ` +
            `${LISTEN_BACKOFF_MS.length} retries. Check it with: docker exec jht ss -ltn, ` +
            'or move this server with JHT_API_PORT.'
        );
      }
      const wait = LISTEN_BACKOFF_MS[attempt];
      logError(
        `port ${port} is in use (EADDRINUSE): retrying in ${wait} ms ` +
          `(attempt ${attempt + 1} of ${LISTEN_BACKOFF_MS.length})`
      );
      await delay(wait);
    }
  }
}

/**
 * Avvia il server dell'API del team. Ritorna quando è in ascolto.
 *
 * @param {{ port?: number, dbPath?: string }} [options]
 * @returns {Promise<{ server: import('node:http').Server, port: number, dbPath: string }>}
 */
export async function startApiServer(options = {}) {
  const startedAt = new Date().toISOString();
  const port = typeof options.port === 'number' ? options.port : API_PORT;
  const dbPath = typeof options.dbPath === 'string' ? options.dbPath : DEFAULT_DB_PATH;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    refuseToListen(
      `JHT_API_PORT must be an integer between 1 and 65535, but this container resolved ${port}.`
    );
  }

  // ── 1. Il deploy è cloud? Allora questa scatola non esiste ───────────────
  if (auth.isCloudDeployFromEnv()) {
    refuseToListen(
      'this process is running with a cloud deploy environment ' +
        '(NEXT_PUBLIC_JHT_DEPLOY=cloud, or VERCEL set), where the local token does not exist: ' +
        'every request would answer 401 forever. Unset those variables inside the container.'
    );
  }

  // ── 2. Il driver SQLite ─────────────────────────────────────────────────
  //
  // Import DINAMICO e non statico: un `import` in cima farebbe fallire il
  // caricamento del modulo, e il messaggio sarebbe una traccia di stack di
  // Node invece della frase qui sotto. La differenza la legge chi apre
  // `logs/api.log` alle due di notte.
  //
  // Qui nasce l'ExperimentalWarning descritto in testa al file: una riga su
  // stderr, per boot, accettata.
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (error) {
    refuseToListen(
      'this container has no node:sqlite module, which needs Node 22.5 or newer ' +
        `(this process runs ${process.version}). The team API cannot read the database ` +
        `without it: ${/** @type {Error} */ (error).message}`
    );
  }
  if (typeof DatabaseSync !== 'function') {
    refuseToListen(
      `node:sqlite in this container does not export DatabaseSync (Node ${process.version}).`
    );
  }

  // ── 3. Il token, generato ORA ───────────────────────────────────────────
  const token = auth.getOrCreate();
  if (!token) {
    refuseToListen(
      `the local token could not be created at ${auth.tokenPath}: the team API would then ` +
        'reject every request. Check that JHT_HOME is writable inside the container.'
    );
  }
  // Il PERCORSO, mai il valore: questo log finisce in un file che l'utente
  // apre e incolla nelle segnalazioni.
  log(`local token ready at ${auth.tokenPath}`);

  // ── 4. La sola lettura, dimostrata e non dichiarata ─────────────────────
  const backend = createReadonlyBackend({ DatabaseSync, dbPath });
  const probe = backend.assertReadOnly();
  if (!probe.blocked) {
    refuseToListen(
      'the read-only probe was NOT blocked, so this build would hold a writable handle on ' +
        `the team database at ${dbPath} while the Python agents write to it: ${probe.detail}`
    );
  }
  log(`read-only enforcement verified (${probe.detail})`);

  // ── 5. Censimento dello schema: si avvisa, non si nega ──────────────────
  //
  // Nessuno di questi casi impedisce l'avvio. `GET /version` risponde 200
  // comunque — è la rotta che serve proprio a scoprirli — e le rotte dati
  // rispondono 503 con un codice che dice quale dei due problemi è.
  const census = backend.census();
  if (!census.present) {
    logError(
      `the team database is not there yet (${dbPath}): data routes will answer 503 ` +
        'until the team has run once. GET /version answers anyway.'
    );
  } else if (!census.readable) {
    logError(`the team database at ${dbPath} exists but cannot be read.`);
  } else {
    if (census.missing.length > 0) {
      logError(
        `the team database is missing something the routes read: ${census.missing.join(', ')}. ` +
          'Data routes will answer 503 DB_SCHEMA_INCOMPLETE.'
      );
    }
    const warning = userVersionWarning(census.userVersion);
    if (warning) logError(warning);
  }

  // ── 6. Il handler ───────────────────────────────────────────────────────
  //
  // Costruito PRIMA del socket di proposito: `createApiHandler` solleva se una
  // voce di `ROUTES` non ha un handler, e quel difetto deve fermare il boot,
  // non produrre un 500 su una rotta che `GET /version` pubblica.
  const handler = createApiHandler({
    backend,
    auth,
    tmux: () => readTmuxSessions(),
    meta: {
      product: pkg.version,
      node: process.version,
      pid: process.pid,
      startedAt,
    },
  });

  // ── 7. L'adattatore ─────────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    const began = Date.now();
    // Nessuna rotta legge un corpo, e il handler risponde 413 se ne trova uno:
    // i byte già arrivati si buttano subito. Senza `resume()` restano nel
    // buffer del socket e il client aspetta che qualcuno li legga, cioè un
    // 413 che arriva dopo un timeout invece che subito.
    req.resume();

    const { path, query } = requestTarget(req.url);
    handler({
      method: req.method,
      path,
      query,
      // Node consegna le chiavi già in minuscolo: è la forma che il contratto
      // del `reqLike` dichiara.
      headers: req.headers,
      // `hasBody` non viene dedotto dai byte letti ma dagli header, ed è il
      // handler a farlo: in HTTP/1.1 un corpo esiste solo se lo annuncia
      // `content-length` o `transfer-encoding`, e senza uno dei due quei byte
      // non sono un corpo — sono la richiesta successiva.
    })
      .then((out) => {
        try {
          res.writeHead(out.status, out.headers);
          // Su `HEAD` il corpo NON si scrive: `content-length` resta quello
          // dell'entità, che è esattamente ciò che un HEAD serve a sapere.
          res.end(req.method === 'HEAD' ? undefined : out.body);
        } catch {
          // Il client ha chiuso mentre rispondevamo: non c'è niente da
          // salvare e non è un difetto nostro.
          res.destroy();
        }
        // Una riga per richiesta: percorso SENZA query (i filtri non sono
        // segreti, ma un log che cresce con l'input è un log che nessuno
        // legge) e MAI l'header `Authorization`.
        log(`${req.method} ${path} ${out.status} ${Date.now() - began}ms`);
        // La diagnosi di un 500 non viaggia mai sul filo: se il handler ne ha
        // una, è qui che si trova. Riga in più solo quando c'è un'anomalia.
        if (out.logLine) logError(`${req.method} ${path} — ${out.logLine}`);
      })
      .catch((error) => {
        // Il handler cattura già tutto: arrivare qui è un difetto suo, e
        // l'unica cosa peggiore di un 500 sarebbe un socket che si chiude
        // muto.
        logError(`${req.method} ${path} — handler rejected: ${error?.message ?? error}`);
        try {
          res.writeHead(500, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end('{"ok":false,"error":"The team API failed to answer this request.","code":"INTERNAL"}');
        } catch {
          res.destroy();
        }
      });
  });

  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.maxHeadersCount = MAX_HEADERS_COUNT;
  server.maxConnections = MAX_CONNECTIONS;

  // ── 8. La chiusura ordinata ─────────────────────────────────────────────
  //
  // docker concede 10 s fra `SIGTERM` e `SIGKILL`, e pid1 inoltra il segnale a
  // ogni figlio elencato a mano in `forwardSignal`. Un server HTTP che non
  // chiude su richiesta muore col `SIGKILL` e le richieste in volo cadono a
  // metà: chi le aveva fatte vede un socket chiuso, che assomiglia a «l'API
  // non risponde» invece che a «il container si sta fermando».
  let shuttingDown = false;
  /** @param {string} signal */
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received: closing the listener and the database handle`);
    const hard = setTimeout(() => {
      logError(`shutdown did not finish within ${HARD_EXIT_MS} ms: exiting anyway`);
      backend.close();
      process.exit(0);
    }, HARD_EXIT_MS);
    server.close(() => {
      clearTimeout(hard);
      backend.close();
      log('listener closed, database handle released');
      process.exit(0);
    });
    // Le connessioni `keep-alive` inattive tengono aperto `close()` per tutto
    // il `keepAliveTimeout`: questa riga è la differenza fra una chiusura
    // immediata e cinque secondi di attesa per niente. Opzionale perché il
    // metodo è recente e la minor version di Node nell'immagine non è
    // verificata — se manca, si aspetta, e il timer duro copre il caso.
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await listenWithRetry(server, port);
  log(
    `listening on http://${BIND_ADDRESS}:${port} — api contract ${API_CONTRACT}, ` +
      `product ${pkg.version}, database ${dbPath}`
  );
  return { server, port, dbPath };
}
