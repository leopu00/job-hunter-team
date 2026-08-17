/**
 * Il local-token del box, in ESM puro e INIETTABILE — [JHT-TEAM-API-BOUNDARY].
 *
 * È la stessa credenziale che il web usa da sempre — 32 byte random in
 * `<JHT_HOME>/.local-token`, presentati come `Authorization: Bearer <hex>` —
 * ri-espressa qui perché l'API del team gira DENTRO il container, dove
 * `web/` non è nemmeno installato (`Dockerfile:132`) e quindi
 * `web/lib/local-token.ts` non è importabile nemmeno volendo. Non è una
 * riscrittura per gusto: è l'unico modo di avere quella credenziale in un
 * processo che non ha TypeScript, né bundler, né `node_modules` del web.
 *
 * ## Il file su disco è il contratto, non questo modulo
 *
 * Due programmi scritti in due linguaggi leggono lo STESSO file, e il giorno
 * che uno dei due cambia formato l'altro smette di autenticare senza dire
 * perché. Per questo il formato è fissato qui in modo esplicito e identico:
 * 64 caratteri esadecimali, `trim()` alla lettura, confronto
 * case-insensitive ma valore normalizzato in minuscolo, file `0o600` dentro
 * una directory `0o700`. La parità con `web/lib/local-token.ts:40-136` non è
 * affidata a questo commento: la misura
 * `tests/js/tasks/api-local-token-parity.test.ts`, che fa girare la stessa
 * tabella di vettori sui due moduli e pretende gli stessi verdetti. Se
 * qualcuno tocca un lato, quel test è il posto dove lo scopre.
 *
 * ⚠️ `0o600` è RICHIESTO, non garantito: attraverso il bind mount di Docker
 * Desktop su Windows i file di `C:\Users\<utente>\.jht\` si leggono
 * `-rw-r--r--`, quindi «leggibile solo da chi è su quel filesystem»
 * (`web/lib/auth.ts:214-218`) degrada a «leggibile da qualunque processo del
 * box». Era già vero prima; da questa fase quel file è la credenziale di una
 * superficie HTTP VIVA, e il modello di minaccia lo dice a voce alta.
 *
 * ## Perché una factory e non un modulo con lo stato dentro
 *
 * Il gemello nel web è un singleton legato a `@/lib/jht-paths` e
 * `@/lib/deploy-mode`: legge l'ambiente al caricamento e tiene il token in
 * una variabile di modulo. Va bene per un server Next, non qui, per tre
 * ragioni misurate:
 *
 *   1. il predicato cloud deve essere una FUNZIONE, così da poter essere
 *      rivalutato a ogni chiamata invece di essere congelato all'import;
 *   2. i consumatori sono due nello stesso albero di processi (il server
 *      supervisionato da pid1 e il client del CLI) e devono poter avere
 *      politiche diverse senza barare con la cache dell'ESM;
 *   3. un test che vuole tre `JHT_HOME` diversi non deve dipendere da
 *      `vi.resetModules()` per ottenerli. Uno stato che si azzera solo
 *      ricaricando il modulo è uno stato che i test non controllano.
 *
 * ## La sola corsia viva è l'header
 *
 * `authenticateHeader()` guarda `Authorization` e nient'altro. La corsia
 * riservata al browser del desktop nativo — descritta in
 * `web/lib/local-token.ts:10-23`, insieme al nome del test che la tiene
 * onesta (righe 20-21) — resta INTERAMENTE di là: non è replicata qui,
 * nemmeno inerte. Motivo di forma, che è anche di
 * sostanza: se un giorno servirà, dovrà comparire un PARAMETRO NUOVO in una
 * firma, cioè una modifica che si vede in diff e che qualcuno deve rivedere.
 * Un secondo argomento già presente e passato `null` sarebbe invece una
 * corsia che si apre cambiando un valore, e un valore lo cambia chiunque.
 *
 * E non c'è, e non deve esserci, l'equivalente del pass-through di
 * `web/lib/auth.ts:150` («cliente cloud non configurato → passa»): là è un
 * ramo morto solo perché il modulo di configurazione del web inchioda un
 * fallback, quindi la condizione non si verifica mai. Ricopiato qui, dove
 * nessun fallback del genere esiste, sarebbe una porta aperta con la forma
 * di una riga innocua.
 */

// [JHT-TEAM-API-BOUNDARY] Solo builtin: questo modulo lo carica il figlio di
// pid1 al boot del container, e una dipendenza qui sarebbe una dipendenza
// dell'immagine — cioè la misura di costo su cui poggia la fase 1.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// [JHT-TEAM-API-BOUNDARY] Il formato, in un posto solo.
//
// `TOKEN_HEX_RE` e `BEARER_RE` sono ANCORATE (`^…$`) di proposito: senza
// ancoraggio `Bearer <64 hex> ; extra` passerebbe, e un header è testo che
// scrive il client. La `/i` c'è per leggere anche un file scritto in
// maiuscolo — accettare non è normalizzare, il valore viene sempre riportato
// in minuscolo prima di qualunque confronto.

/** Nome del file che porta il token dentro `JHT_HOME`. */
export const LOCAL_TOKEN_FILE_NAME = '.local-token';

/** Byte di entropia del token: 32 → 64 caratteri esadecimali. */
const TOKEN_BYTES = 32;

/** Un token ben formato, letto da file. */
const TOKEN_HEX_RE = /^[a-f0-9]{64}$/i;

/** L'unica forma di `Authorization` che questa API accetta. */
const BEARER_RE = /^Bearer\s+([a-f0-9]{64})$/i;

/** Permessi richiesti per `JHT_HOME` e per il file del token. */
const HOME_MODE = 0o700;
const TOKEN_MODE = 0o600;

/**
 * @typedef {object} LocalTokenAuth
 * @property {string} tokenPath Percorso assoluto del file del token.
 * @property {() => string | null} getOrCreate Token corrente, creandolo se manca.
 * @property {() => string | null} read Token su disco, senza mai crearlo.
 * @property {(headerValue: unknown) => string | null} extractBearer
 * @property {(candidate: unknown, expected: unknown) => boolean} matches
 * @property {(headerValue: unknown) => boolean} authenticateHeader
 */

/**
 * Costruisce la corsia local-token per una `JHT_HOME` e una politica cloud.
 *
 * @param {object} options
 * @param {string} options.jhtHome Directory che contiene `.local-token`.
 * @param {() => boolean} options.isCloudDeploy Predicato cloud, **callable**:
 *   viene invocato a ogni `getOrCreate()` / `read()`, non memorizzato.
 * @returns {LocalTokenAuth}
 */
export function createLocalTokenAuth({ jhtHome, isCloudDeploy } = {}) {
  // [JHT-TEAM-API-BOUNDARY] Due controlli d'uso, e sono rumorosi entrambi.
  //
  // Un `jhtHome` vuoto costruirebbe il percorso `.local-token` relativo alla
  // cwd del processo: un file plausibile nel posto sbagliato, cioè il guasto
  // più difficile da vedere. E un `isCloudDeploy` che sia un BOOLEANO invece
  // di una funzione sarebbe letto come `truthy` una volta sola e mai più
  // rivalutato: esattamente il guasto che l'iniezione serve a rendere
  // impossibile. Meglio esplodere alla costruzione che autenticare male.
  if (typeof jhtHome !== 'string' || jhtHome.trim() === '') {
    throw new TypeError('createLocalTokenAuth requires a non-empty jhtHome path');
  }
  if (typeof isCloudDeploy !== 'function') {
    throw new TypeError('createLocalTokenAuth requires isCloudDeploy to be a function, so the cloud guard is re-evaluated on every call');
  }

  const tokenPath = path.join(jhtHome, LOCAL_TOKEN_FILE_NAME);

  // [JHT-TEAM-API-BOUNDARY] Cache in RAM, con la conseguenza dichiarata.
  //
  // Come nel web (`web/lib/local-token.ts:47-51`): la prima lettura vince e
  // le successive tornano dal valore in memoria. Quindi una rotazione a mano
  // (`rm ~/.jht/.local-token`) NON è vista dal server finché il figlio non
  // riparte, e il sintomo è un 401 su un token che sul disco sembra giusto.
  // È il motivo per cui esiste `read()` senza cache: il client legge il
  // disco, il server confronta con la RAM, e i due divergono in modo
  // LEGGIBILE (un 401 con un messaggio che dice «riavvia il container»)
  // invece di silenziosamente.
  let cached = null;

  /** Legge il file e ne valida la forma. Nessuna scrittura, mai. */
  function readFromDisk() {
    try {
      const value = fs.readFileSync(tokenPath, 'utf-8').trim();
      return TOKEN_HEX_RE.test(value) ? value.toLowerCase() : null;
    } catch {
      // ENOENT è il caso normale al primo avvio; EACCES e un file illeggibile
      // finiscono qui insieme, e vanno trattati allo stesso modo: «non ho un
      // token», non «il token è vuoto».
      return null;
    }
  }

  /** Genera il token e lo scrive. `null` se il filesystem non collabora. */
  function create() {
    try {
      fs.mkdirSync(jhtHome, { recursive: true, mode: HOME_MODE });
      const value = randomBytes(TOKEN_BYTES).toString('hex');
      fs.writeFileSync(tokenPath, value, { encoding: 'utf-8', mode: TOKEN_MODE });
      return value;
    } catch {
      return null;
    }
  }

  /**
   * Il token corrente, creandolo se manca. `null` su deploy cloud (dove un
   * box co-locato non esiste) o se il filesystem è in sola lettura.
   *
   * Il guard cloud sta PRIMA della cache, e non è un dettaglio di stile: un
   * processo che avesse già letto un token non deve poterlo servire dopo che
   * l'ambiente è diventato cloud. È la stessa scelta di
   * `web/lib/local-token.ts:81-84`, inchiodata là da
   * `tests/js/tasks/local-first-db-path-census.test.ts:209-216` e qui dal
   * test di parità.
   *
   * @returns {string | null}
   */
  function getOrCreate() {
    if (isCloudDeploy()) return null;
    if (cached) return cached;
    cached = readFromDisk() ?? create();
    return cached;
  }

  /**
   * Il token che sta sul disco ADESSO, senza crearlo e senza cache.
   *
   * È la funzione dei CLIENT, e la differenza con `getOrCreate()` è un
   * messaggio d'errore: un client che creasse il file trasformerebbe «il
   * server non è ancora partito su questa scatola» in «ho un token che il
   * server non conosce», cioè un 401 al posto di una diagnosi. Le due
   * situazioni vanno dette all'utente in due modi diversi.
   *
   * @returns {string | null}
   */
  function read() {
    if (isCloudDeploy()) return null;
    return readFromDisk();
  }

  /**
   * Estrae il token da un header `Authorization`, o `null`.
   *
   * Non lancia mai: un header è un dato che arriva da fuori, e qualunque
   * forma inattesa (array di valori duplicati che Node ha unito con virgola,
   * `undefined`, un numero) deve produrre un rifiuto, non un'eccezione che
   * risalga fino al handler.
   *
   * @param {unknown} headerValue
   * @returns {string | null}
   */
  function extractBearer(headerValue) {
    if (typeof headerValue !== 'string') return null;
    const match = BEARER_RE.exec(headerValue);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Confronto a tempo costante fra due token esadecimali.
   *
   * Il confronto avviene sui 32 byte DECODIFICATI, non sulle stringhe: su
   * stringhe `timingSafeEqual` funzionerebbe comunque, ma i buffer sono la
   * forma in cui i due valori sono davvero la stessa cosa (`AB…` e `ab…` lo
   * sono). La validazione della forma viene prima, così una stringa non-hex
   * non arriva mai a `Buffer.from(…, 'hex')`, che troncherebbe in silenzio.
   *
   * @param {unknown} candidate
   * @param {unknown} expected
   * @returns {boolean}
   */
  function matches(candidate, expected) {
    if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
    if (!TOKEN_HEX_RE.test(candidate) || !TOKEN_HEX_RE.test(expected)) return false;
    try {
      return timingSafeEqual(
        Buffer.from(candidate.toLowerCase(), 'hex'),
        Buffer.from(expected.toLowerCase(), 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Il verdetto: questo header porta il token di questo box?
   *
   * `false` anche quando un token atteso non esiste (cloud, filesystem in
   * sola lettura): senza un valore da confrontare non c'è confronto che
   * possa riuscire, e «non lo so» sul filo si scrive 401.
   *
   * @param {unknown} headerValue
   * @returns {boolean}
   */
  function authenticateHeader(headerValue) {
    const expected = getOrCreate();
    if (!expected) return false;
    const supplied = extractBearer(headerValue);
    if (!supplied) return false;
    return matches(supplied, expected);
  }

  return { tokenPath, getOrCreate, read, extractBearer, matches, authenticateHeader };
}
