/**
 * L'autenticazione dell'API del team, montata sul box — [JHT-TEAM-API-BOUNDARY].
 *
 * `shared/auth/local-token.js` sa COME funziona il local-token e non sa DOVE
 * vive né QUANDO non deve funzionare: è una factory, e quelle due risposte
 * gliele dà questo file. Un posto solo in tutto il prodotto risponde «la
 * credenziale sta in `<JHT_HOME>/.local-token` e su un deploy cloud non
 * esiste», e da quel posto passano sia il server (che confronta) sia il
 * client del CLI (che presenta).
 *
 * ## Una sola funzione guarda una richiesta
 *
 * `authenticate(req)` è l'UNICA funzione rivolta a una richiesta, e la sua
 * firma ha un parametro solo. Non è una semplificazione: è il modo di rendere
 * VISIBILE un cambiamento futuro. La corsia riservata al browser del desktop
 * nativo (descritta in `web/lib/local-token.ts:10-23`, che alle righe 20-21
 * nomina anche il test che la tiene onesta) resta interamente nel
 * web: il giorno che qualcuno la accenderà qui, dovrà comparire un PARAMETRO
 * NUOVO in questa firma — cioè una riga che si vede in diff e che qualcuno
 * deve rivedere — invece di un secondo argomento già presente che passa da
 * `null` a un valore. Un valore lo cambia chiunque; una firma no.
 *
 * Le altre esportazioni NON guardano richieste: sono il ciclo di vita del
 * token, e stanno qui perché l'alternativa era peggiore. Il server ha bisogno
 * di `getOrCreate()` al boot (genera il file PRIMA di mettersi in ascolto, così
 * un client che legge per primo non trova ENOENT e non deve indovinare se il
 * server non è su o se non è autorizzato), il client ha bisogno di `read()`, e
 * il boot ha bisogno di `isCloudDeployFromEnv()` per poter NOMINARE la
 * variabile d'ambiente nel messaggio di rifiuto. Se ognuno se le costruisse da
 * sé nascerebbero due factory nello stesso processo, cioè DUE CACHE in RAM
 * dello stesso token: la seconda a leggere vedrebbe un file già cambiato e i
 * due verdetti divergerebbero senza che nessuno se ne accorga.
 *
 * Uso lato server (`cli/src/lib/api/handler.js`, `server.js`):
 *   import * as auth from './auth.js';
 *   createApiHandler({ auth, … });   // il handler chiama auth.authenticate
 *
 * ## Perché il predicato cloud è riscritto e non importato
 *
 * `web/lib/deploy-mode.ts:34-46` è l'originale e resta la definizione
 * canonica; qui è ri-espresso perché `web/` non è installato nell'immagine
 * (`Dockerfile:132`) e un import di TypeScript in un figlio di pid1 non
 * esiste. Le regole sono le stesse, nell'ordine: `NEXT_PUBLIC_JHT_DEPLOY`
 * esplicito vince, poi `VERCEL` presente significa cloud, e in mancanza di
 * tutto si è locali — che è il caso del container. La parità con l'originale
 * non è affidata a questo commento: la misura
 * `tests/js/tasks/api-local-token-parity.test.ts`, che confronta i verdetti
 * dei due moduli sulle stesse combinazioni di ambiente.
 *
 * Nel container queste variabili non sono impostate, quindi il verdetto è
 * «locale» e la corsia è viva. Se un giorno lo fossero — un compose modificato
 * a mano, un `docker run -e` di troppo — il server RIFIUTA DI PARTIRE
 * (`server.js`, exit 78) invece di legarsi alla porta e rispondere 401 per
 * sempre: un server che ascolta e non autentica nessuno è il guasto più
 * costoso da diagnosticare fra quelli possibili qui.
 */

// [JHT-TEAM-API-BOUNDARY] `JHT_HOME` arriva da `shared/paths.js`, che è la
// definizione canonica (`shared/paths.js:15`) ed è già override-abile via
// ambiente per i test. Deliberatamente NON si aggiunge una costante a
// `cli/src/jht-paths.js`: quel file è uno dei tre specchi a mano dei percorsi
// (l'altro è `web/lib/jht-paths.ts`) e un percorso di AUTENTICAZIONE
// duplicato una quarta volta è la specie di disallineamento che si scopre
// come un 401 inspiegabile.
import { JHT_HOME } from '../../../../shared/paths.js';
import { createLocalTokenAuth } from '../../../../shared/auth/local-token.js';

/**
 * Il deploy è cloud? Solo ambiente, nessun filesystem, nessun header.
 *
 * Specchio di `web/lib/deploy-mode.ts:34-46`. Prende l'ambiente come
 * parametro (default `process.env`) perché un predicato che legge una
 * variabile globale non è testabile in tabella, e questo predicato è un
 * cancello: viene invocato a OGNI `getOrCreate()`, non una volta all'avvio.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isCloudDeployFromEnv(env = process.env) {
  const explicit = String(env?.NEXT_PUBLIC_JHT_DEPLOY ?? '').trim().toLowerCase();
  if (explicit === 'cloud') return true;
  if (explicit === 'local') return false;
  // `VERCEL` è presente a build e a runtime su Vercel: è il fallback
  // lato-server dell'originale, e vale solo se il flag esplicito non c'è.
  if (env?.VERCEL) return true;
  return false;
}

// [JHT-TEAM-API-BOUNDARY] L'unica istanza del box.
//
// Costruirla non tocca il disco (né legge, né crea): la prima lettura avviene
// alla prima `getOrCreate()`, cioè al boot del server, che è dove vogliamo che
// avvenga. Il predicato è passato come funzione — `() => isCloudDeployFromEnv()`
// e non `isCloudDeployFromEnv` direttamente — così l'ambiente viene riletto a
// ogni chiamata e nessun default di argomento resta congelato.
const localToken = createLocalTokenAuth({
  jhtHome: JHT_HOME,
  isCloudDeploy: () => isCloudDeployFromEnv(process.env),
});

/** Percorso del file che porta la credenziale: per i log e i messaggi. */
export const tokenPath = localToken.tokenPath;

/**
 * Il token del box, creandolo se manca. La usa SOLO il boot del server.
 *
 * @returns {string | null} `null` su deploy cloud o filesystem in sola lettura.
 */
export function getOrCreate() {
  return localToken.getOrCreate();
}

/**
 * Il token che sta sul disco adesso, senza crearlo. La usano i CLIENT.
 *
 * `null` significa «il server dell'API non è ancora partito su questa
 * scatola», che è un messaggio diverso da un 401 e va detto diversamente.
 *
 * @returns {string | null}
 */
export function read() {
  return localToken.read();
}

/**
 * La richiesta presenta il token di questo box?
 *
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 *   La richiesta nella forma neutra del handler: `headers` con le chiavi in
 *   minuscolo, nessun socket, nessun corpo. Volutamente NON è un
 *   `http.IncomingMessage`: questa funzione non deve poter guardare un
 *   indirizzo di peer né un header di proxy.
 * @returns {boolean} `true` solo con un `Authorization: Bearer <64 hex>` che
 *   corrisponde. Qualunque altra cosa — assente, malformato, di un altro
 *   token — è `false`, e non c'è nessun altro modo di entrare.
 */
export function authenticate(req) {
  const headers = req && typeof req === 'object' ? req.headers : null;
  return localToken.authenticateHeader(pickAuthorization(headers));
}

/**
 * Il valore di `Authorization`, normalizzato a stringa o `null`.
 *
 * Il contratto del handler dice «chiavi in minuscolo» e la lettura diretta è
 * quella che conta; la scansione case-insensitive che segue è una tolleranza
 * verso un chiamante scritto da un'altra mano, e non allarga niente — il
 * token deve comunque corrispondere. Un array (valori duplicati che un
 * chiamante sintetico non ha unito) viene unito con virgola come farebbe Node
 * da sé: la regex ancorata lo rifiuta, che è l'esito giusto, invece di
 * lanciare `.match is not a function` dentro il handler.
 *
 * @param {Record<string, string | string[] | undefined> | null} headers
 * @returns {string | null}
 */
function pickAuthorization(headers) {
  if (!headers || typeof headers !== 'object') return null;
  let raw = headers.authorization;
  if (raw === undefined) {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
    if (key !== undefined) raw = headers[key];
  }
  if (Array.isArray(raw)) return raw.join(', ');
  return typeof raw === 'string' ? raw : null;
}
