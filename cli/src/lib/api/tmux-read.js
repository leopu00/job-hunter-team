// [JHT-TEAM-API-BOUNDARY]
// Lettura del roster tmux per la rotta `GET /v1/team/status`.
//
// ## La domanda a cui questo file risponde, e perché è UNA domanda sola
//
// «Quali sessioni tmux stanno girando?» ha tre risposte possibili, non due, e
// tenerle separate è l'intero motivo per cui questo modulo esiste:
//
//   - `ok`        → tmux ha risposto: i nomi sono quelli, punto.
//   - `no-server` → tmux c'è ed è autorevole: nessuna sessione attiva. È il
//                   team spento, non un guasto.
//   - `absent`    → non lo sappiamo. tmux non c'è, non ha risposto, il
//                   trasporto è rotto o il comando è andato in timeout.
//
// ADR-0009:111-113 dice esattamente questo: «un tunnel caduto è
// indistinguibile da un team fermo se non è il client a dirlo». La lista
// vuota è la bugia più comoda del mondo — costa zero, ha la forma giusta e
// risponde «nessun agente» a chi ha chiesto «cosa sta girando?» mentre la
// verità era «non ho potuto guardare».
//
// ## Perché NON `listContainerSessions()` (cli/src/utils/container-proxy.js:167)
//
// Quella funzione è la versione comoda di questa, e sbaglia in due punti che
// insieme rendono le tre risposte una sola:
//
//   1. il suo comando finisce in `2>/dev/null || true`, quindi lo stderr di
//      tmux — l'unico posto dove è scritto se il server non gira o se il
//      binario manca — viene buttato, e il codice d'uscita è sempre 0;
//   2. `if (!r.ok) return []` — un fallimento di TRASPORTO (container non
//      raggiungibile, timeout) diventa una lista vuota, cioè si presenta come
//      un successo.
//
// Con quelle due righe «team spento» e «non ho potuto guardare» arrivano al
// chiamante come lo stesso valore. La rotta HTTP deve poter rispondere 503
// `TMUX_UNAVAILABLE` nel secondo caso e 200 con `sessions: []` nel primo:
// per farlo serve leggere codice d'uscita e stderr, cioè non passare da lì.
// `listContainerSessions()` resta al suo posto per i chiamanti storici
// (`team/agents.js` e la corsia di scrittura start/stop/chat): si ritira con
// loro in fase 3, non qui.
//
// ## Il fatto, non la sua presentazione
//
// Qui non compare nessun nome di ruolo, nessuna tabella `AGENTS`, nessun
// colore e nessuna frase da mostrare all'utente: il server riporta il fatto
// grezzo (i nomi di sessione così come tmux li scrive), il CLI decide cosa
// significano e come si vedono. È la stessa divisione che rende la rotta
// riusabile dal gioco e dal desktop senza replicarne la copy: se la tabella
// dei ruoli finisse dentro l'API, ogni client dovrebbe accettare la nostra
// (e oggi le due tabelle nel repo non sono nemmeno d'accordo fra loro —
// 7 voci in `commands/agents.js`, 9 in `commands/team/agents.js`).

import { execArgvInContainer } from '../../utils/container-proxy.js';

/**
 * L'argv, senza shell in mezzo.
 *
 * `#{session_name}` NON va fra apici: gli apici della riga di comando sono
 * sintassi di bash, e qui bash non c'è — `execArgvInContainer` passa gli
 * argomenti al processo esatti come sono (`spawnSync` in-container, `docker
 * exec` senza `-c` sull'host). Scrivere `'#{session_name}'` chiederebbe a
 * tmux un formato che contiene apici, e il risultato sarebbe una lista di
 * nomi tutti fra virgolette: parsing che passa i test e sbaglia in
 * produzione. Nessuna redirezione e nessun `|| true`, per la ragione
 * spiegata sopra: lo stderr e il codice d'uscita SONO il dato.
 */
export const TMUX_ARGV = Object.freeze(['tmux', 'list-sessions', '-F', '#{session_name}']);

/**
 * I tre esiti, in chiaro. Esportati perché siano citabili da chi scrive la
 * rotta e dal test, invece di tre stringhe copiate a mano in tre file.
 */
export const TMUX_OUTCOMES = Object.freeze(['ok', 'no-server', 'absent']);

/**
 * Tetto di attesa, e non è un numero scelto a caso: deve stare NETTAMENTE
 * sotto il `requestTimeout` del server (15 s). Se tmux si incanta più a
 * lungo della richiesta HTTP che lo ha causato, il client vede cadere la
 * connessione — il sintomo peggiore possibile, perché somiglia a «l'API non
 * risponde» quando l'API sta benissimo ed è tmux che è fermo. Con questo
 * tetto l'esito è sempre una risposta: 503 `TMUX_UNAVAILABLE`, che è una
 * frase che si può leggere.
 *
 * Il default di `execArgvInContainer` è 30 s, cioè il doppio del budget di
 * una richiesta: va sovrascritto sempre, anche quando sembra non servire.
 */
export const TMUX_READ_TIMEOUT_MS = 5_000;

/**
 * La sola forma di stderr che vale come «tmux c'è e mi sta dicendo che non
 * gira niente». tmux 3.3a (bookworm, l'immagine) scrive `no server running
 * on /tmp/tmux-0/default` ed esce 1.
 *
 * Le altre formulazioni storiche (`failed to connect to server`, `error
 * connecting to … (No such file or directory)` dei tmux 1.x/2.x) NON sono
 * qui di proposito: cadono nell'esito `absent`, che è il lato rumoroso. Un
 * riconoscitore generoso trasformerebbe un guasto in «nessun agente» — la
 * bugia che questo file esiste per impedire — mentre un riconoscitore
 * stretto, quando sbaglia, produce un 503 visibile che qualcuno viene a
 * leggere. Se l'immagine passasse a un tmux con un'altra frase, il sintomo
 * è un 503 sistematico a team spento: rumoroso, diagnosticabile, e si
 * corregge aggiungendo la frase qui.
 */
const NO_SERVER_RE = /no server running/i;

/**
 * Riconoscimento del binario mancante, usato SOLO per dare un nome alla
 * ragione nel log: l'esito è `absent` in entrambi i rami, quindi un buco in
 * questa regex non cambia mai la risposta HTTP, solo la riga di diario.
 *
 * `docker exec` restituisce 126/127 quando il comando non è eseguibile o non
 * esiste (`executable file not found in $PATH`); in-container `spawnSync`
 * fallisce con ENOENT prima di avere un codice, e `container-proxy` lo
 * traduce in `ok:false, code:-1` con stderr vuoto — per questo la mancanza
 * del binario non si riconosce dal solo stderr.
 */
const BINARY_MISSING_RE = /executable file not found|command not found|\bENOENT\b/i;

/** Quanto stderr finisce nel log: una riga di diagnosi, non un dump. */
const STDERR_LOG_CHARS = 200;

/**
 * Il diario di bordo del caso brutto — una riga, in inglese, su stderr.
 *
 * Perché di serie e non su richiesta: questo codice gira dentro il container
 * come figlio di pid1, dove l'output è prefissato `[api] ` e finisce in
 * `$JHT_HOME/logs/api.log`. Se il 503 fosse l'unica traccia, chi apre il log
 * per capire *perché* non troverebbe niente e resterebbe con «TMUX
 * UNAVAILABLE» e nessun indizio su quale dei quattro modi di non sapere sia
 * capitato. Solo l'esito `absent` scrive: `ok` e `no-server` sono esiti
 * nominali, e un diario che parla anche quando tutto va bene è un diario che
 * nessuno legge.
 *
 * Niente `picocolors` e nessun altro import a pacchetto: sotto
 * `cli/src/lib/api/` gli import ammessi sono `node:`, `.` e `/` — è la
 * premessa su cui poggia la misura del costo immagine (roadmap §7.1), e un
 * `import` di comodo qui la falsificherebbe.
 *
 * @param {string} line riga già composta, in inglese
 */
function logToStderr(line) {
  console.error(line);
}

/**
 * Nomi di sessione dallo stdout di tmux.
 *
 * `\r\n` incluso: il formato lo scrive tmux, ma il byte passa per
 * `docker exec` e per una pipe di Windows quando il CLI gira sull'host, e un
 * `\r` appiccicato in coda produrrebbe nomi che non combaciano con nessun
 * ruolo — cioè un roster vuoto senza nessun errore.
 *
 * @param {string} stdout
 * @returns {string[]}
 */
function parseSessionNames(stdout) {
  return String(stdout ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Legge il roster tmux e dice anche QUANTO ci si può credere.
 *
 * @param {object} [options]
 * @param {(argv: string[], opts?: object) => { ok: boolean, stdout: string, stderr: string, code: number }} [options.runner]
 *   il modo di eseguire un argv nel posto giusto. Iniettato — non perché
 *   servano due trasporti (ce n'è uno: `execArgvInContainer`, che
 *   in-container è uno `spawnSync` locale) ma perché i tre esiti si provano
 *   solo potendo dettare codice d'uscita e stderr, e nessun tmux vero li
 *   produce a comando. Stessa forma di `readLocalSignature(DatabaseSync, …)`
 *   in `cli/src/lib/bootstrap-push.js:154`.
 * @param {(line: string) => void} [options.log] dove va la riga del caso brutto.
 * @param {number} [options.timeoutMs]
 * @returns {{ tmux: 'ok' | 'no-server' | 'absent', sessions: string[] }}
 */
export function readTmuxSessions({
  runner = execArgvInContainer,
  log = logToStderr,
  timeoutMs = TMUX_READ_TIMEOUT_MS,
} = {}) {
  // `spawnSync` blocca il loop di eventi, e per una rotta HTTP è un difetto
  // dichiarato: con `maxConnections = 32` una lettura lenta ferma anche le
  // altre. Resta così di proposito — l'alternativa è una seconda versione
  // asincrona di `execArgvInContainer`, cioè due implementazioni del
  // trasporto che possono divergere, per un comando con un tetto di 5 s su
  // una superficie di loopback a un client. Debito noto, non svista.
  const r = runner(TMUX_ARGV, { timeoutMs });

  // Il runner è iniettabile, quindi la sua forma va verificata invece che
  // creduta: un `undefined` letto come `r.code` diventerebbe un `absent`
  // muto e indistinguibile da un guasto vero di tmux.
  if (!r || typeof r !== 'object') {
    return absent(log, 'runner-contract', -1, 'the tmux runner returned no result object');
  }

  const code = typeof r.code === 'number' ? r.code : -1;
  const stderr = String(r.stderr ?? '').trim();

  // 1. Esito pulito. `ok:true` da solo non basta: significa solo che il
  //    processo è partito ed è finito, non che tmux sia contento.
  if (r.ok === true && code === 0) {
    return { tmux: 'ok', sessions: parseSessionNames(r.stdout) };
  }

  // 2. L'unica non-risposta che è una risposta: tmux vivo, zero sessioni.
  //    Controllata PRIMA delle diagnosi di guasto, così uno stderr che
  //    contenesse entrambe le cose resta classificato dalla frase
  //    autorevole.
  if (code === 1 && NO_SERVER_RE.test(stderr)) {
    return { tmux: 'no-server', sessions: [] };
  }

  // 3. Tutto il resto è «non lo so», e non lo so si dice ad alta voce. I
  //    rami qui sotto cambiano solo la RAGIONE scritta nel log: l'esito è
  //    `absent` per ognuno, perché mescolare «tmux non installato» con
  //    «container irraggiungibile» costa un log meno preciso, mentre
  //    mescolare uno dei due con «nessuna sessione» costa una risposta
  //    sbagliata all'utente.
  if (code === 126 || code === 127 || BINARY_MISSING_RE.test(stderr)) {
    return absent(log, 'binary-missing', code, stderr);
  }
  if (r.ok !== true) {
    // Trasporto o spawn: container non in esecuzione, `docker exec` fallito,
    // timeout scaduto (spawnSync non lascia un codice d'uscita).
    return absent(log, 'transport-failed', code, stderr);
  }
  return absent(log, `unexpected-exit-${code}`, code, stderr);
}

/**
 * L'esito `absent` con la sua riga di diario. Tutte le stringhe visibili
 * sono in inglese: `cli/src` è area a tolleranza zero del censimento copy
 * (`scripts/analysis/backend_copy_census.py`), e `console.error` è uno dei
 * suoi punti di raccolta.
 *
 * @param {(line: string) => void} log
 * @param {string} reason
 * @param {number} code
 * @param {string} stderr
 * @returns {{ tmux: 'absent', sessions: string[] }}
 */
function absent(log, reason, code, stderr) {
  const detail = stderr ? ` stderr="${stderr.slice(0, STDERR_LOG_CHARS)}"` : '';
  // Una riga sola: chi legge `logs/api.log` con `grep tmux-read` deve
  // ottenere un elenco di eventi, non un testo a capo.
  const line = `[tmux-read] ${new Date().toISOString()} tmux could not be read `
    + `(reason=${reason} exit=${code})${detail}`;
  try {
    log(line.replace(/\s+/g, ' '));
  } catch {
    // Un log che fallisce non deve poter far fallire la lettura: l'esito
    // resta `absent`, che è già il messaggio importante.
  }
  return { tmux: 'absent', sessions: [] };
}
