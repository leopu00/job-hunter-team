/**
 * Every error code that can reach the person using the desktop app, with the
 * sentence the app shows and the action to take now.
 *
 * The rule: the sentence is written HERE, by the app, from the code. Never by
 * an agent, never a native message passed through, never the raw code. A code
 * without an entry is a red test (error-catalog.test.ts walks every code the
 * Rust backend and the TS layer can produce), so a new code cannot ship
 * without its sentence and its action.
 *
 * Languages: Italian and English are the source copy here; the five other
 * product languages live in error-catalog.locales.ts, keyed by error code.
 */

import {
  ERROR_CATALOG_LOCALES,
  ERROR_TRANSLATION_LOCALES,
  type ErrorTranslationLocale,
  type ErrorTranslationPair,
} from "./error-catalog.locales";

export const ERROR_LOCALES = ["it", "en", ...ERROR_TRANSLATION_LOCALES] as const;
export type ErrorLocale = (typeof ERROR_LOCALES)[number];
type ErrorSourceLocale = "it" | "en";

export interface ErrorCopy {
  /** What happened, in plain words. */
  text: Record<ErrorSourceLocale, string>;
  /** What to do now. */
  action: Record<ErrorSourceLocale, string>;
}

export interface DescribedError {
  code: string;
  text: string;
  action: string;
  /** False when the code is not in the catalog and the generic copy is used. */
  known: boolean;
}

function copy(itText: string, itAction: string, enText: string, enAction: string): ErrorCopy {
  return { text: { it: itText, en: enText }, action: { it: itAction, en: enAction } };
}

// ── Shared entries: several codes that mean the same thing to the person ────

/** A limit of the app itself (pacing, a request limiter), never the provider's. */
const THROTTLED_LOCAL = copy(
  "La squadra sta rallentando di proposito: è un limite dell’app, non del tuo fornitore.",
  "Riprende da sola. Non devi fare niente.",
  "The team is slowing down on purpose: this is a limit of the app, not of your provider.",
  "It resumes by itself. You do not need to do anything.",
);

const RETRY = copy(
  "L’operazione non è riuscita.",
  "Riprova. Se si ripete, riavvia Job Hunter Team.",
  "The operation did not succeed.",
  "Try again. If it happens again, restart Job Hunter Team.",
);
const RESTART_APP = copy(
  "L’app non riesce a leggere il proprio stato interno.",
  "Chiudi completamente Job Hunter Team e riaprilo.",
  "The app cannot read its own internal state.",
  "Quit Job Hunter Team completely and open it again.",
);
const BUSY = copy(
  "Un’altra operazione è già in corso.",
  "Attendi che finisca, poi riprova.",
  "Another operation is already running.",
  "Wait for it to finish, then try again.",
);
const ACCOUNT_SCOPE = copy(
  "Non riesco a verificare a quale account appartiene questa operazione.",
  "Esci e rientra con il tuo account, poi riprova.",
  "I cannot verify which account this operation belongs to.",
  "Sign out and back in with your account, then try again.",
);
const ACCOUNT_CHANGED = copy(
  "L’account attivo è cambiato durante l’operazione.",
  "Controlla di essere entrato con l’account giusto e riprova.",
  "The active account changed during the operation.",
  "Check that you are signed in with the right account and try again.",
);
const LOCAL_OWNER = copy(
  "I dati locali di questo computer appartengono a un altro profilo.",
  "Entra con il profilo che li ha creati, oppure scegli una VPS.",
  "The local data on this computer belongs to another profile.",
  "Sign in with the profile that created it, or choose a VPS.",
);
const LOCAL_OWNER_UNAVAILABLE = copy(
  "Non riesco a leggere a quale profilo appartengono i dati locali.",
  "Riprova. Se si ripete, riavvia Job Hunter Team.",
  "I cannot read which profile owns the local data.",
  "Try again. If it happens again, restart Job Hunter Team.",
);
const LOCAL_UNSUPPORTED = copy(
  "Il team su questo computer non è disponibile su questo sistema.",
  "Usa una VPS per far lavorare il team.",
  "Running the team on this computer is not available on this system.",
  "Use a VPS to run the team.",
);
const RUNTIME_PREPARE = copy(
  "La preparazione dell’ambiente del team non è riuscita.",
  "Controlla la connessione a internet e riprova.",
  "Preparing the team’s environment did not succeed.",
  "Check your internet connection and try again.",
);
const RUNTIME_INTEGRITY = copy(
  "Il pacchetto dell’ambiente del team non supera la verifica di integrità.",
  "Non usarlo: aggiorna Job Hunter Team all’ultima versione e riprova.",
  "The team environment package failed its integrity check.",
  "Do not use it: update Job Hunter Team to the latest version and try again.",
);
/** The installer that arrived is not the one this build was made for. */
const RUNTIME_INTEGRITY_MISMATCH = copy(
  "Il pacchetto scaricato non è quello che questa versione dell’app si aspetta.",
  "Non usarlo: aggiorna Job Hunter Team all’ultima versione e riprova.",
  "The downloaded package is not the one this version of the app expects.",
  "Do not use it: update Job Hunter Team to the latest version and try again.",
);
/** The installer arrived empty, cut short or not an installer at all. */
const RUNTIME_PAYLOAD_INVALID = copy(
  "Il pacchetto scaricato è incompleto o danneggiato.",
  "Riprova. Se si ripete, controlla la connessione a internet o aggiorna Job Hunter Team.",
  "The downloaded package is incomplete or damaged.",
  "Try again. If it happens again, check your internet connection or update Job Hunter Team.",
);
const RUNTIME_MISSING = copy(
  "L’ambiente del team non è installato su questo computer.",
  "Riparti dalla configurazione tecnica.",
  "The team environment is not installed on this computer.",
  "Start again from the technical setup.",
);
const CONTAINER = copy(
  "Il container del team non risulta pronto.",
  "Riprova. Se si ripete, riavvia il computer e ricomincia dalla configurazione.",
  "The team container is not ready.",
  "Try again. If it happens again, restart the computer and redo the setup.",
);
const TIMEOUT = copy(
  "L’operazione ha superato il tempo massimo.",
  "Controlla la connessione e riprova.",
  "The operation took too long.",
  "Check the connection and try again.",
);
const PROVIDER_SETUP = copy(
  "La configurazione del provider non è riuscita.",
  "Controlla la connessione a internet e riprova.",
  "Setting up the provider did not succeed.",
  "Check your internet connection and try again.",
);
const PROVIDER_LOGIN_START = copy(
  "Non riesco ad avviare l’accesso al provider.",
  "Riprova l’accesso. Se si ripete, riparti dalla configurazione del provider.",
  "I cannot start the sign-in to the provider.",
  "Try signing in again. If it happens again, redo the provider setup.",
);
const PROVIDER_SESSION = copy(
  "La sessione di accesso al provider non è più aperta.",
  "Riavvia l’accesso al provider.",
  "The provider sign-in session is no longer open.",
  "Restart the provider sign-in.",
);
const TEAM_START = copy(
  "La squadra non è partita.",
  "Riprova l’avvio. Se si ripete, riparti dalla configurazione tecnica.",
  "The team did not start.",
  "Try starting again. If it happens again, redo the technical setup.",
);
const HOST_SAVED = copy(
  "La destinazione salvata non è più disponibile.",
  "Scegli di nuovo dove far lavorare il team.",
  "The saved destination is no longer available.",
  "Choose again where the team should run.",
);
const BAD_DATA = copy(
  "I dati ricevuti non sono validi.",
  "Ricarica la pagina e riprova.",
  "The data received is not valid.",
  "Reload the page and try again.",
);
const SSH_FIELD = copy(
  "Uno dei dati di accesso alla VPS non è valido.",
  "Controlla host, utente, porta e chiave SSH, poi riprova.",
  "One of the VPS access details is not valid.",
  "Check host, user, port and SSH key, then try again.",
);
const SSH_KEY_FILE = copy(
  "La chiave SSH selezionata non è utilizzabile.",
  "Scegli il file della chiave privata giusta e riprova.",
  "The selected SSH key cannot be used.",
  "Choose the right private key file and try again.",
);
const HOST_KEY_CHANGED = copy(
  "La chiave SSH del server è CAMBIATA rispetto a quella che avevi confermato: potrebbe essere un server diverso. Il collegamento è bloccato.",
  "Non procedere. Chiedi a chi gestisce la VPS se la chiave è stata cambiata davvero, e riprova solo dopo la sua conferma.",
  "The server’s SSH key has CHANGED from the one you confirmed: it may be a different server. The connection is blocked.",
  "Do not proceed. Ask whoever runs the VPS whether the key was really changed, and try again only after they confirm it.",
);
const HOST_KEY_STORE = copy(
  "Non riesco a salvare sul computer l’identità SSH confermata.",
  "Controlla lo spazio libero su disco e riprova.",
  "I cannot save the confirmed SSH identity on this computer.",
  "Check the free disk space and try again.",
);
const LOCAL_STORAGE = copy(
  "Non riesco a scrivere i dati dell’app su questo computer.",
  "Controlla lo spazio libero su disco e riprova.",
  "I cannot write the app’s data on this computer.",
  "Check the free disk space and try again.",
);
const PROCESS = copy(
  "Un programma necessario al team non è partito o non ha risposto.",
  "Riprova. Se si ripete, riavvia Job Hunter Team.",
  "A program the team needs did not start or did not answer.",
  "Try again. If it happens again, restart Job Hunter Team.",
);
const TEAM_UNREACHABLE = copy(
  "Il team non è raggiungibile.",
  "Controlla che il computer o la VPS del team sia acceso e connesso, poi riprova.",
  "The team cannot be reached.",
  "Check that the team’s computer or VPS is on and connected, then try again.",
);
const SECURE_LINK_FAILED = copy(
  "L’app non è riuscita ad aprire il collegamento sicuro con la VPS da questo computer.",
  "Riprova. Se si ripete, chiudi e riapri Job Hunter Team; se continua, segnalalo dall’app.",
  "The app could not open the secure link to the VPS from this computer.",
  "Try again. If it happens again, close and reopen Job Hunter Team; if it goes on, report it from the app.",
);
const SECURE_LINK_UNPREPARED = copy(
  "Non riesco a preparare il collegamento sicuro al team su questo computer.",
  "Chiudi e riapri Job Hunter Team e riprova. Se si ripete, segnalalo dall’app.",
  "I cannot prepare the secure link to the team on this computer.",
  "Close and reopen Job Hunter Team, then try again. If it happens again, report it from the app.",
);
const ASSISTANT_UNVERIFIED = copy(
  "Il team risponde, ma non riesco a verificare che l’Assistente sia pronto per la chat.",
  "Riprova tra poco. Se si ripete, apri il Pannello Agenti e controlla che il Capitano e l’Assistente siano accesi.",
  "The team answers, but I cannot verify that the Assistant is ready to chat.",
  "Try again in a moment. If it happens again, open the Agents panel and check that the Captain and the Assistant are on.",
);
const AGENT_NOT_READY = copy(
  "L’agente non può ricevere il messaggio adesso.",
  "Attendi qualche minuto e rimanda il messaggio.",
  "The agent cannot receive the message right now.",
  "Wait a few minutes and send the message again.",
);
const LOCAL_PROFILE = copy(
  "Non riesco ad attivare il profilo locale.",
  "Riprova. Se si ripete, crea un nuovo profilo locale.",
  "I cannot activate the local profile.",
  "Try again. If it happens again, create a new local profile.",
);
const SESSION = copy(
  "La sessione del tuo account non è più valida.",
  "Esci e rientra con il tuo account.",
  "Your account session is no longer valid.",
  "Sign out and back in with your account.",
);
/**
 * A team on a VPS pairs with the account. The error says what is missing, not that a session
 * "is no longer valid": a person on a local profile never had one to lose.
 */
const PAIRING_ACCOUNT = copy(
  "Una squadra su VPS ha bisogno del tuo account Google.",
  "Esci e continua con Google, poi riprova.",
  "A team on a VPS needs your Google account.",
  "Sign out and continue with Google, then try again.",
);
const MIGRATION_SOURCE = copy(
  "I dati del profilo locale non superano la verifica per il collegamento all’account.",
  "Nessun dato è stato spostato. Contatta l’assistenza prima di riprovare.",
  "The local profile data fails the check for linking to the account.",
  "Nothing was moved. Contact support before trying again.",
);
const MIGRATION_RETRY = copy(
  "Il collegamento del profilo locale all’account non è riuscito.",
  "Nessun dato è stato perso: riprova.",
  "Linking the local profile to the account did not succeed.",
  "No data was lost: try again.",
);
const MIGRATION_HOST = copy(
  "Il profilo locale non risulta collegato a un team su questo computer.",
  "Completa prima la configurazione del team locale, poi riprova.",
  "The local profile is not linked to a team on this computer.",
  "Finish setting up the local team first, then try again.",
);
const PLAYGROUND = copy(
  "Non riesco a ripristinare il profilo di prova.",
  "Chiudi e riapri Job Hunter Team, poi riprova.",
  "I cannot reset the trial profile.",
  "Quit and reopen Job Hunter Team, then try again.",
);
const LOGIN_FAILED = copy(
  "Accesso non riuscito.",
  "Riprova l’accesso con Google.",
  "Sign-in did not succeed.",
  "Try signing in with Google again.",
);
const SESSION_STORE = copy(
  "Non riesco a salvare la sessione del tuo account su questo computer.",
  "Chiudi completamente Job Hunter Team, riaprilo ed entra di nuovo.",
  "I cannot save your account session on this computer.",
  "Quit Job Hunter Team completely, reopen it and sign in again.",
);
const VOICE_FAILED = copy(
  "Il dettato non è partito.",
  "Riprova, oppure scrivi il messaggio.",
  "Dictation did not start.",
  "Try again, or type the message.",
);
const PODMAN_CHECK = copy(
  "Non riesco a verificare il motore dei container.",
  "Riprova. Se si ripete, riparti dalla configurazione tecnica.",
  "I cannot check the container engine.",
  "Try again. If it happens again, redo the technical setup.",
);
const PERMISSIONS = copy(
  "Non riesco a rendere privati i dati di Job Hunter Team su questo computer.",
  "Controlla di avere i permessi sulla tua cartella utente e riprova.",
  "I cannot make Job Hunter Team’s data private on this computer.",
  "Check that you have permissions on your user folder and try again.",
);
const NO_VERIFIED_CONNECTION = copy(
  "Per questa squadra non c’è un collegamento verificato da cui partire.",
  "Ricollega la squadra esistente dalla configurazione, poi riprova.",
  "There is no verified connection for this team to start from.",
  "Connect the existing team again from the setup, then try again.",
);
const BROWSER_REPLY = copy(
  "Il browser assistito sulla VPS ha risposto in un modo che l’app non accetta.",
  "Riprova. Se si ripete, chiudi il browser assistito e riaprilo.",
  "The assisted browser on the VPS answered in a way the app does not accept.",
  "Try again. If it happens again, close the assisted browser and open it again.",
);

const BROWSER_RUNTIME_CHANGED = copy(
  "Il browser assistito sulla VPS non è più quello preparato per questa squadra, quindi non lo uso.",
  "Chiedi a chi gestisce la VPS di prepararlo di nuovo, poi riapri il browser assistito.",
  "The assisted browser on the VPS is no longer the one set up for this team, so I do not use it.",
  "Ask whoever manages the VPS to set it up again, then open the assisted browser again.",
);

export const UNKNOWN_ERROR: ErrorCopy = RETRY;

export const ERROR_CATALOG: Readonly<Record<string, ErrorCopy>> = {
  // ── Generic and app state ────────────────────────────────────────────────
  unknown: RETRY,
  desktop_only: copy(
    "Questa funzione è disponibile solo nell’app desktop.",
    "Apri Job Hunter Team sul computer per usarla.",
    "This feature is only available in the desktop app.",
    "Open Job Hunter Team on your computer to use it.",
  ),
  state_failed: RESTART_APP,
  state_unavailable: RESTART_APP,
  operation_in_progress: BUSY,
  storage_failed: LOCAL_STORAGE,
  storage_unavailable: LOCAL_STORAGE,
  permissions_failed: PERMISSIONS,
  permissions_unreadable: PERMISSIONS,
  permissions_unexpected: PERMISSIONS,
  invalid_input: BAD_DATA,
  invalid_request: BAD_DATA,
  request_invalid: BAD_DATA,
  timeout: TIMEOUT,
  command_timeout: TIMEOUT,

  // ── Account scope and local owner ────────────────────────────────────────
  account_scope_state_failed: ACCOUNT_SCOPE,
  account_scope_required: ACCOUNT_SCOPE,
  account_scope_unavailable: ACCOUNT_SCOPE,
  account_scope_changed: ACCOUNT_CHANGED,
  account_scope_mismatch: ACCOUNT_CHANGED,
  local_runtime_unsupported: LOCAL_UNSUPPORTED,
  local_account_owner_unavailable: LOCAL_OWNER_UNAVAILABLE,
  local_account_owner_missing: copy(
    "I dati locali di questo computer non sono intestati a nessun profilo.",
    "Riparti dalla configurazione tecnica del team locale.",
    "The local data on this computer is not assigned to any profile.",
    "Start again from the local team’s technical setup.",
  ),
  local_account_owner_invalid: LOCAL_OWNER,
  local_account_owner_mismatch: LOCAL_OWNER,

  // ── Runtime installation (local) ─────────────────────────────────────────
  podman_missing: copy(
    "Il motore dei container (Podman) non è stato installato.",
    "Riprova: l’app lo installa da sola. Se si ripete, controlla la connessione a internet.",
    "The container engine (Podman) was not installed.",
    "Try again: the app installs it by itself. If it happens again, check your internet connection.",
  ),
  podman_network_unready: copy(
    "La rete del team dentro la macchina Podman non si è preparata.",
    "Riprova. Se si ripete, riavvia il computer e riprova: il registro della preparazione dice quale controllo non è passato.",
    "The team’s network inside the Podman machine did not get ready.",
    "Try again. If it happens again, restart the computer and try again: the setup log says which check did not pass.",
  ),
  podman_version_mismatch: copy(
    "Su questo computer c’è Podman di una versione su cui il team non gira: serve Podman 6, dalla 6.0.2 in su.",
    "Disinstalla Podman dalle app di Windows, poi premi Riprova: l’app installa la versione giusta. Un Podman 6 dalla 6.0.2 in su va bene così com’è.",
    "This computer has a Podman version the team does not run on: it needs Podman 6, from 6.0.2 on.",
    "Uninstall Podman from Windows’ apps, then press Try again: the app installs the right version. A Podman 6 from 6.0.2 on is fine as it is.",
  ),
  // Not a download that failed: the network is not the cause, and Try again
  // alone changes nothing while the other user's Podman holds the registration.
  podman_other_user: copy(
    "Podman risulta installato su questo computer, ma per un altro utente di Windows: questo utente non lo raggiunge, e installarlo anche per lui non è riuscito.",
    "Dall’account di Windows che ha installato Podman, disinstalla «Podman CLI» dalle app di Windows, poi torna su questo account e premi Riprova: l’app lo installa per te.",
    "Podman is installed on this computer, but for another Windows user: this user cannot reach it, and installing it for this user too did not succeed.",
    "From the Windows account that installed Podman, uninstall “Podman CLI” from Windows’ apps, then come back to this account and press Try again: the app installs it for you.",
  ),
  homebrew_missing: copy(
    "Su questo Mac manca Homebrew: l’app lo usa per installare Podman.",
    "Scarica il pacchetto di installazione di Homebrew (il file .pkg) dalla pagina ufficiale brew.sh, aprilo e completa l’installazione di macOS, poi torna qui e premi Riprova.",
    "Homebrew is missing on this Mac: the app uses it to install Podman.",
    "Download Homebrew’s installer package (the .pkg file) from its official page brew.sh, open it and complete the macOS installation, then come back here and press Try again.",
  ),
  wsl_not_ready: copy(
    "WSL non è pronto: su Windows è lui a far girare la macchina Podman del team.",
    "Apri il Microsoft Store, installa o aggiorna «Sottosistema Windows per Linux», riavvia il computer e premi Riprova.",
    "WSL is not ready: on Windows it runs the team’s Podman machine.",
    "Open the Microsoft Store, install or update “Windows Subsystem for Linux”, restart the computer and press Try again.",
  ),
  // Not an error: why Kimi cannot be chosen at the setup on Windows (its CLI
  // ignores the Windows proxy for login, usage, web and updates).
  kimi_unavailable_windows: copy(
    "Kimi non è ancora disponibile su Windows.",
    "Scegli Codex o Claude.",
    "Kimi is not available on Windows yet.",
    "Choose Codex or Claude.",
  ),
  // ── «Remove JHT from this computer» (Windows) ─────────────────────────────
  uninstall_unavailable: copy(
    "La rimozione da questo computer non è disponibile con il runtime installato.",
    "Aggiorna l’app all’ultima versione, riapri questa pagina e riprova.",
    "Removing JHT from this computer is not available with the installed runtime.",
    "Update the app to the latest version, open this page again and try again.",
  ),
  uninstall_unsupported: copy(
    "Per ora la rimozione dall’app c’è solo su Windows.",
    "Su questo sistema il pulsante non è ancora disponibile.",
    "For now, removing JHT from the app is only available on Windows.",
    "On this system the button is not available yet.",
  ),
  uninstall_failed: copy(
    "La rimozione da questo computer non è riuscita.",
    "Riprova. Se si ripete, riavvia il computer e riprova: i tuoi dati in ~/.jht e nei documenti non sono stati toccati.",
    "Removing JHT from this computer did not succeed.",
    "Try again. If it happens again, restart the computer and try again: your data in ~/.jht and in the documents was not touched.",
  ),
  podman_not_ready: copy(
    "Il motore dei container è installato ma non risponde.",
    "Riprova. Se si ripete, riavvia il computer.",
    "The container engine is installed but does not answer.",
    "Try again. If it happens again, restart the computer.",
  ),
  podman_start_failed: copy(
    "Il motore dei container non si è avviato.",
    "Riprova. Se si ripete, riavvia il computer.",
    "The container engine did not start.",
    "Try again. If it happens again, restart the computer.",
  ),
  podman_other_machine_running: copy(
    "Un’altra macchina Podman è già accesa: sul Mac ne può girare una sola alla volta.",
    "Spegni l’altra macchina dall’app con cui la usi (per esempio Podman Desktop), poi premi Riprova. Job Hunter Team non la spegne mai al posto tuo, e dopo potrai riaccenderla.",
    "Another Podman machine is already running: on a Mac only one can run at a time.",
    "Stop the other machine from the app you use it with (for example Podman Desktop), then press Try again. Job Hunter Team never stops it for you, and you can start it again afterwards.",
  ),
  // The same, when the wrapper named the machine (describeError's `machine`).
  podman_other_machine_running_named: copy(
    "La macchina Podman «{machine}» è già accesa: sul Mac ne può girare una sola alla volta.",
    "Spegni «{machine}» dall’app con cui la usi (per esempio Podman Desktop), poi premi Riprova. Job Hunter Team non la spegne mai al posto tuo, e dopo potrai riaccenderla.",
    "The Podman machine “{machine}” is already running: on a Mac only one can run at a time.",
    "Stop “{machine}” from the app you use it with (for example Podman Desktop), then press Try again. Job Hunter Team never stops it for you, and you can start it again afterwards.",
  ),
  podman_machine_mounts_home: copy(
    "La macchina Podman di JHT vede più cartelle del Mac di quelle che servono a Job Hunter Team.",
    "Ricrea la macchina Podman: i tuoi dati in ~/.jht e in Documenti › Job Hunter Team restano dove sono.",
    "The JHT Podman machine sees more of the Mac’s folders than Job Hunter Team needs.",
    "Recreate the Podman machine: your data in ~/.jht and in Documents › Job Hunter Team stays where it is.",
  ),
  // A Mac installed from the command line with Colima: Podman would start the
  // team on empty volumes, and nothing moves them yet.
  runtime_change_requires_migration: copy(
    "Su questo Mac Job Hunter Team è già installato con un altro motore dei container (Docker con Colima). Se l’app passasse a Podman, le CLI dei provider, i segreti del broker (la password della posta e gli accessi ai portali, LinkedIn compreso) e il collegamento a Telegram resterebbero nel motore di prima.",
    "Per ora l’app non può spostarli: continua a usare il team come l’hai installato, oppure scegli una VPS. Il profilo, i CV e i dati in ~/.jht e in Documenti › Job Hunter Team restano dove sono.",
    "On this Mac Job Hunter Team is already installed with another container engine (Docker with Colima). If the app switched to Podman, the provider CLIs, the broker's secrets (the mail password and the portal logins, LinkedIn included) and the Telegram connection would stay behind in the previous engine.",
    "For now the app cannot move them: keep using the team the way you installed it, or choose a VPS. Your profile, CVs and the data in ~/.jht and in Documents › Job Hunter Team stay where they are.",
  ),
  // Not an error: the confirmation before the machine is deleted.
  podman_machine_recreate_confirm: copy(
    "Ricreare la macchina Podman di JHT cancella ciò che vive solo al suo interno e non si conserva: le CLI dei provider installate (volume jht-deps) e i segreti del broker, cioè la password della posta e i login dei portali (LinkedIn compreso).",
    "Dopo, la preparazione riscarica da sola le CLI dei provider (qualche minuto, serve la connessione); tu reinserisci la password della posta e rifai l’accesso a LinkedIn. Restano la configurazione della posta con diario, bozze e autorizzazioni, il profilo, i CV, i dati in ~/.jht e in Documenti › Job Hunter Team e l’accesso al provider.",
    "Recreating the JHT Podman machine deletes what lives only inside it and is not kept: the installed provider CLIs (the jht-deps volume) and the broker's secrets, that is the mail password and the portal logins (LinkedIn included).",
    "Afterwards the setup downloads the provider CLIs again by itself (a few minutes, online); you enter the mail password again and log in to LinkedIn again. The mail configuration with its journal, drafts and authorisations stays, and so do your profile, CVs, the data in ~/.jht and Documents › Job Hunter Team and the provider login.",
  ),
  podman_machine_recreate_failed: copy(
    "La macchina Podman di JHT non è stata ricreata.",
    "Riprova. Se si ripete, riavvia il computer.",
    "The JHT Podman machine was not recreated.",
    "Try again. If it happens again, restart the computer.",
  ),
  runtime_download_failed: RUNTIME_PREPARE,
  runtime_install_failed: RUNTIME_PREPARE,
  runtime_failed: RUNTIME_PREPARE,
  runtime_wrapper_publish_failed: RUNTIME_PREPARE,
  runtime_wrapper_probe_failed: RUNTIME_PREPARE,
  runtime_wrapper_install_failed: RUNTIME_PREPARE,
  runtime_install_unsupported: LOCAL_UNSUPPORTED,
  runtime_missing: RUNTIME_MISSING,
  installer_digest_missing: RUNTIME_INTEGRITY,
  installer_digest_invalid: RUNTIME_INTEGRITY,
  installer_digest_mismatch: RUNTIME_INTEGRITY_MISMATCH,
  installer_payload_invalid: RUNTIME_PAYLOAD_INVALID,
  // check_podman issues: the command is compiled but no screen calls it today.
  check_failed: PODMAN_CHECK,
  not_found: PODMAN_CHECK,
  version_failed: PODMAN_CHECK,
  version_timeout: PODMAN_CHECK,
  engine_timeout: PODMAN_CHECK,
  engine_unavailable: PODMAN_CHECK,

  // ── VPS pairing and container ────────────────────────────────────────────
  pairing_token_missing: PAIRING_ACCOUNT,
  pairing_token_invalid: SESSION,
  container_start_failed: CONTAINER,
  container_not_ready: CONTAINER,
  container_timeout: CONTAINER,
  container_unavailable: TEAM_UNREACHABLE,
  container_version_incompatible: copy(
    "La versione del team installata non coincide con quella richiesta da questa app.",
    "Aggiorna Job Hunter Team all’ultima versione e riparti dalla configurazione.",
    "The installed team version does not match the one this app needs.",
    "Update Job Hunter Team to the latest version and redo the setup.",
  ),
  snapshot_failed: copy(
    "Il team risponde, ma non riesco a leggere il suo stato.",
    "Attendi qualche secondo e riprova.",
    "The team answers, but I cannot read its state.",
    "Wait a few seconds and try again.",
  ),

  // ── Provider and provider sign-in ────────────────────────────────────────
  provider_config_failed: PROVIDER_SETUP,
  provider_install_failed: PROVIDER_SETUP,
  provider_timeout: TIMEOUT,
  provider_login_start_failed: PROVIDER_LOGIN_START,
  provider_login_pipe_failed: PROVIDER_LOGIN_START,
  provider_login_failed: copy(
    "L’accesso al provider non è stato completato.",
    "Riavvia l’accesso e completalo nella finestra del provider.",
    "The provider sign-in was not completed.",
    "Restart the sign-in and complete it in the provider’s window.",
  ),
  provider_input_not_requested: copy(
    "Il provider non sta aspettando questa risposta.",
    "Segui l’ultima richiesta mostrata dal provider.",
    "The provider is not waiting for this answer.",
    "Follow the latest request shown by the provider.",
  ),
  provider_input_failed: copy(
    "La risposta non è arrivata al provider.",
    "La sessione resta aperta: rimanda la risposta.",
    "The answer did not reach the provider.",
    "The session is still open: send the answer again.",
  ),
  provider_action_invalid: copy(
    "La richiesta del provider non è valida.",
    "Riavvia l’accesso al provider.",
    "The provider’s request is not valid.",
    "Restart the provider sign-in.",
  ),
  session_not_found: PROVIDER_SESSION,
  session_closed: PROVIDER_SESSION,
  provider_limits_exhausted: copy(
    "I limiti del tuo abbonamento sono esauriti fino alle {time}: se la squadra partisse adesso si fermerebbe subito.",
    "Riprova dopo le {time}. Non è stato avviato niente e nessun dato è andato perso.",
    "Your subscription limits are used up until {time}: if the team started now it would stop right away.",
    "Try again after {time}. Nothing was started and no data was lost.",
  ),
  provider_limits_unverified: copy(
    "Limiti del provider non verificati: la squadra è partita senza sapere quanto resta del tuo abbonamento.",
    "Se il team si ferma presto, controlla i limiti nella pagina del provider.",
    "Provider limits not verified: the team started without knowing how much of your subscription is left.",
    "If the team stops early, check the limits on the provider’s page.",
  ),

  // ── What a limit is, said apart (T10). One sentence per fact: a limit of the
  // app, a wait the provider asked for, a spent plan, a program that never
  // came up, a provider that did not answer. The names are the runtime's; the
  // reasons of a `quota` are the agent-state vocabulary's (limite_5h,
  // limite_settimanale, limite_spesa_org) and do not change the sentence.
  throttled_local: THROTTLED_LOCAL,
  rate_limited: THROTTLED_LOCAL,
  rate_limited_burst: THROTTLED_LOCAL,
  rate_limited_daily: THROTTLED_LOCAL,
  rate_limit_429: copy(
    "Il fornitore ha chiesto di aspettare un momento (errore 429): il tuo abbonamento non è esaurito.",
    "Riprova dopo l’attesa indicata. Nessun dato è andato perso.",
    "The provider asked us to wait a moment (error 429): your subscription is not used up.",
    "Try again after the wait it asked for. No data was lost.",
  ),
  quota: copy(
    "I limiti del tuo abbonamento sono esauriti fino alle {time}.",
    "Riprova dopo le {time}. Niente è andato perso.",
    "Your subscription limits are used up until {time}.",
    "Try again after {time}. Nothing was lost.",
  ),
  runtime_not_started: copy(
    "L’agente è stato avviato ma il suo programma non è mai partito.",
    "Riavvia la squadra. Se succede ancora, invia una segnalazione dalle impostazioni.",
    "The agent was started but its program never came up.",
    "Restart the team. If it happens again, send a report from the settings.",
  ),
  provider_failed: copy(
    "Il fornitore non ha risposto in modo utilizzabile: non è un limite del tuo abbonamento.",
    "Riprovo da solo. Se continua, controlla lo stato del fornitore.",
    "The provider did not give a usable answer: this is not a limit of your subscription.",
    "I will try again by myself. If it keeps happening, check the provider’s status page.",
  ),

  // ── Team start and resume ────────────────────────────────────────────────
  team_start_failed: TEAM_START,
  team_verify_failed: copy(
    "Assistente e Capitano non risultano entrambi attivi.",
    "Riprova l’avvio: l’app riaccende solo le sessioni mancanti.",
    "The Assistant and the Captain are not both running.",
    "Try starting again: the app only restarts the missing sessions.",
  ),
  assistant_start_failed: copy(
    "L’Assistente non si è avviato.",
    "Riprova ad aprire la chat con l’Assistente.",
    "The Assistant did not start.",
    "Try opening the chat with the Assistant again.",
  ),
  assistant_verify_timeout: copy(
    "L’Assistente è partito ma non risulta ancora pronto.",
    "Attendi un minuto e riprova.",
    "The Assistant started but is not ready yet.",
    "Wait a minute and try again.",
  ),
  host_not_configured: HOST_SAVED,
  host_config_invalid: HOST_SAVED,
  resume_runtime_not_ready: copy(
    "L’ambiente del team salvato non risulta più pronto.",
    "Riparti dalla configurazione tecnica.",
    "The saved team environment is no longer ready.",
    "Start again from the technical setup.",
  ),
  resume_container_not_ready: copy(
    "Il container salvato non risulta più attivo.",
    "Riparti dalla configurazione tecnica.",
    "The saved container is no longer running.",
    "Start again from the technical setup.",
  ),
  resume_provider_not_configured: copy(
    "Il provider salvato non risulta più configurato.",
    "Riparti dalla configurazione del provider.",
    "The saved provider is no longer set up.",
    "Start again from the provider setup.",
  ),
  resume_provider_not_authenticated: copy(
    "L’accesso al provider non risulta più valido.",
    "Accedi di nuovo al provider.",
    "The provider sign-in is no longer valid.",
    "Sign in to the provider again.",
  ),

  // ── Existing team on a VPS ───────────────────────────────────────────────
  existing_team_vps_required: copy(
    "Per collegare il team esistente serve una VPS.",
    "Inserisci i dati di accesso della VPS su cui gira il team.",
    "Connecting the existing team needs a VPS.",
    "Enter the access details of the VPS where the team runs.",
  ),
  invalid_team_id: BAD_DATA,
  existing_team_identity_mismatch: copy(
    "Il team trovato sulla VPS appartiene a un altro team o account.",
    "Controlla di aver indicato la VPS giusta.",
    "The team found on the VPS belongs to another team or account.",
    "Check that you entered the right VPS.",
  ),
  account_team_mismatch: copy(
    "Il team trovato non appartiene a questo account Google.",
    "Entra con l’account che ha creato il team, oppure indica un’altra VPS.",
    "The team found does not belong to this Google account.",
    "Sign in with the account that created the team, or enter another VPS.",
  ),
  existing_team_not_active: copy(
    "Nel team registrato non sono attive tutte le sessioni sulla VPS.",
    "Servono sia il capitano sia l’assistente: avviali sulla VPS e riprova. Gli annunci si possono comunque leggere in sola lettura.",
    "Not every session of the registered team is running on the VPS.",
    "Both the captain and the assistant must be running: start them on the VPS and try again. The positions can still be read in read-only mode.",
  ),
  positions_unavailable: copy(
    "La VPS non ha restituito gli annunci.",
    "Premi Aggiorna. Se si ripete, segnala il codice che vedi accanto.",
    "The VPS did not return the positions.",
    "Press Refresh. If it keeps happening, report the code shown next to it.",
  ),
  agents_unavailable: copy(
    "La VPS non ha restituito l’elenco degli agenti.",
    "Premi Aggiorna. Se si ripete, segnala il codice che vedi accanto.",
    "The VPS did not return the list of agents.",
    "Press Refresh. If it keeps happening, report the code shown next to it.",
  ),
  agent_screen_unfiltered: copy(
    "Il terminale di questo agente non si può mostrare: sulla VPS manca il filtro che toglie chiavi e codici dal testo.",
    "Aggiorna la squadra sulla VPS, poi riapri il terminale.",
    "This agent's terminal cannot be shown: the VPS lacks the filter that removes keys and codes from the text.",
    "Update the team on the VPS, then open the terminal again.",
  ),
  agent_control_not_confirmed: copy(
    "L’azione non è stata confermata.",
    "Ripeti l’azione e confermala nella finestra che si apre.",
    "The action was not confirmed.",
    "Repeat the action and confirm it in the dialog that opens.",
  ),
  window_not_allowed: copy(
    "Questa azione si può fare solo dalla finestra principale dell’app.",
    "Torna alla finestra principale e riprova.",
    "This can be done only from the app’s main window.",
    "Go back to the main window and try again.",
  ),
  // «Save as» of a small text the page made (text_file_export.rs: a personal theme).
  save_text_too_large: copy(
    "Il file è troppo grande per essere salvato da qui.",
    "Togli qualcosa e riprova, oppure usa «Copia».",
    "The file is too large to be saved from here.",
    "Remove something and try again, or use «Copy».",
  ),
  save_text_invalid: copy(
    "Il nome proposto per il file non è valido.",
    "Scegli un altro nome nella finestra di salvataggio, oppure usa «Copia».",
    "The suggested file name is not valid.",
    "Choose another name in the save window, or use «Copy».",
  ),
  save_text_failed: copy(
    "Il file non è stato salvato.",
    "Scegli un'altra cartella e riprova, oppure usa «Copia».",
    "The file was not saved.",
    "Choose another folder and try again, or use «Copy».",
  ),
  existing_team_reconfirm_setup: copy(
    "Il collegamento salvato non corrisponde più a questa squadra.",
    "Rifai il collegamento dal setup: ti chiederà di nuovo di confermare la VPS.",
    "The saved connection no longer matches this team.",
    "Connect the team again from the setup: it will ask you to confirm the VPS again.",
  ),
  agent_control_read_only: copy(
    "La squadra è aperta in sola lettura: da qui non si comandano gli agenti.",
    "Per comandarli collega la squadra con «Conferma e collega».",
    "The team is open in read-only view: agents cannot be controlled from here.",
    "To control them, connect the team with «Confirm and connect».",
  ),
  agent_control_no_team: copy(
    "Qui non c’è una squadra accesa da comandare.",
    "Avvia prima la squadra, poi riprova.",
    "There is no running team to control here.",
    "Start the team first, then try again.",
  ),
  agent_control_unsupported: copy(
    "La squadra usa una versione senza il pannello di controllo degli agenti.",
    "Aggiorna la squadra, poi riprova.",
    "The team runs a version without the agent control panel.",
    "Update the team, then try again.",
  ),
  agent_control_invalid: copy(
    "La richiesta dell’app non era valida.",
    "Riprova. Se si ripete, aggiorna l’app e segnala il codice che vedi accanto.",
    "The app's request was not valid.",
    "Try again. If it keeps happening, update the app and report the code shown next to it.",
  ),
  agent_control_refused: copy(
    "Questo agente non si comanda dall’app: lo gestisce la squadra da sola.",
    "Non serve fare nulla: la squadra lo avvia e lo ferma quando serve.",
    "This agent is not controlled from the app: the team manages it on its own.",
    "Nothing to do: the team starts and stops it when needed.",
  ),
  agent_control_busy: copy(
    "C’è già un’altra azione in corso sulla squadra.",
    "Aspetta qualche secondo e riprova.",
    "Another action on the team is already in progress.",
    "Wait a few seconds and try again.",
  ),
  agent_control_window: copy(
    "Questa azione si può fare solo dalla finestra principale dell’app.",
    "Torna alla finestra principale di Job Hunter Team e riprova da lì.",
    "This action can only be made from the app's main window.",
    "Go back to the main Job Hunter Team window and try again from there.",
  ),
  agent_control_unanswered: copy(
    "La squadra non ha risposto in tempo: non si sa se l’azione è andata a buon fine.",
    "Premi Aggiorna per vedere lo stato vero prima di riprovare.",
    "The team did not answer in time: it is not known whether the action went through.",
    "Press Refresh to see the actual state before trying again.",
  ),
  agent_start_failed: copy(
    "L’agente non si è avviato.",
    "Riprova. Se si ripete, guarda il suo terminale e segnala il codice che vedi accanto.",
    "The agent did not start.",
    "Try again. If it keeps happening, look at its terminal and report the code shown next to it.",
  ),
  provider_not_configured: copy(
    "Sulla squadra non è configurato nessun provider (Claude, Codex o Kimi): gli agenti non possono partire.",
    "Scegli il provider sulla VPS con «jht setup», poi riprova.",
    "No provider (Claude, Codex or Kimi) is set up on the team: its agents cannot start.",
    "Choose the provider on the VPS with «jht setup», then try again.",
  ),
  provider_not_configured_local: copy(
    "Sulla squadra di questo computer non è configurato nessun provider (Claude, Codex o Kimi): gli agenti non possono partire.",
    "Apri Impostazioni › Provider, scegli il provider e riprova.",
    "No provider (Claude, Codex or Kimi) is set up on this computer's team: its agents cannot start.",
    "Open Settings › Provider, choose the provider, then try again.",
  ),
  agent_stop_failed: copy(
    "L’agente è ancora acceso dopo lo spegnimento.",
    "Riprova tra qualche secondo.",
    "The agent is still running after the stop.",
    "Try again in a few seconds.",
  ),
  exclusion_no_evidence: copy(
    "Per questa esclusione mancano le posizioni scartate con questo motivo: la squadra non può ancora farne una regola.",
    "Scarta altre posizioni con questo motivo e riprova.",
    "There are no positions turned down with this reason to build the rule from.",
    "Turn down more positions with this reason, then try again.",
  ),
  exclusion_failed: copy(
    "L’esclusione non è stata salvata sulla squadra.",
    "Riprova. Se si ripete, segnala il codice che vedi accanto.",
    "The exclusion was not saved on the team.",
    "Try again. If it keeps happening, report the code shown next to it.",
  ),
  question_unknown: copy(
    "La domanda non c’è più sulla squadra: forse ha già avuto risposta o è scaduta.",
    "Premi Aggiorna per vedere le domande aperte.",
    "The question is no longer on the team: it may have been answered or have expired.",
    "Press Refresh to see the open questions.",
  ),
  answer_refused: copy(
    "La squadra non accetta questa risposta per questa domanda.",
    "Premi Aggiorna e rispondi con una delle scelte mostrate.",
    "The team does not accept this answer to this question.",
    "Press Refresh and answer with one of the choices shown.",
  ),
  answer_failed: copy(
    "La risposta non è stata salvata sulla squadra.",
    "Riprova. Se si ripete, rispondi dai Messaggi.",
    "The answer was not saved on the team.",
    "Try again. If it keeps happening, answer from Messages.",
  ),
  questions_unsupported: copy(
    "La squadra ha una versione che non riceve risposte dall’app.",
    "Aggiorna la squadra, oppure rispondi dai Messaggi.",
    "The team runs a version that does not take answers from the app.",
    "Update the team, or answer from Messages.",
  ),
  exclusions_unavailable: copy(
    "La squadra non risponde sulle esclusioni del profilo: ha una versione più vecchia.",
    "Aggiorna la squadra e riprova.",
    "The team cannot answer about the profile exclusions: it runs an older version.",
    "Update the team and try again.",
  ),
  agent_contained: copy(
    "La squadra ha messo questo agente in sicurezza (per esempio la sentinella o il dottore): dall’app non si riaccende.",
    "Aspetta che la squadra lo rilasci; il motivo è nel registro della squadra.",
    "The team put this agent in safety containment (for example the sentinel or the doctor): it cannot be restarted from the app.",
    "Wait for the team to release it; the reason is in the team's log.",
  ),
  closer_not_consented: copy(
    "L’agente delle candidature non parte senza il tuo consenso alle candidature automatiche.",
    "Dai il consenso alle candidature automatiche nelle impostazioni, poi riprova.",
    "The applications agent does not start without your consent to automatic applications.",
    "Give your consent to automatic applications in the settings, then try again.",
  ),
  team_halted: copy(
    "La squadra è stata fermata da te: riprendere non la riavvia.",
    "Avvia la squadra per farla ripartire.",
    "You stopped the team: resuming does not start it again.",
    "Start the team to get it running again.",
  ),
  team_paused: copy(
    "La squadra è in pausa.",
    "Riprendi prima la squadra, poi accendi o riavvia l’agente.",
    "The team is paused.",
    "Resume the team first, then start or restart the agent.",
  ),
  team_pause_failed: copy(
    "Non è stato possibile mettere in pausa la squadra.",
    "Riprova. Se si ripete, segnala il codice che vedi accanto.",
    "The team could not be paused.",
    "Try again. If it keeps happening, report the code shown next to it.",
  ),
  team_resume_failed: copy(
    "Non è stato possibile far riprendere la squadra.",
    "Riprova. Se si ripete, segnala il codice che vedi accanto.",
    "The team could not be resumed.",
    "Try again. If it keeps happening, report the code shown next to it.",
  ),
  team_stop_unsupported: copy(
    "La squadra ha una versione che non si ferma dal pannello.",
    "Aggiorna la squadra, poi riprova. Intanto puoi spegnere gli agenti uno per uno con «Spegni».",
    "The team runs a version that cannot be stopped from the panel.",
    "Update the team, then try again. Meanwhile you can stop the agents one by one with «Stop».",
  ),
  team_stop_failed: copy(
    "Non è stato possibile fermare la squadra: lo stop non si è scritto, o un agente non si è spento.",
    "Riprova. Se si ripete, segnala il codice che vedi accanto.",
    "The team could not be stopped: the stop could not be written, or an agent did not shut down.",
    "Try again. If it keeps happening, report the code shown next to it.",
  ),
  desktop_transport_unavailable: copy(
    "L’app non è riuscita a parlare con il suo nucleo nativo.",
    "Riprova con Aggiorna. Se si ripete, chiudi Job Hunter Team del tutto e riaprilo.",
    "The app could not talk to its native core.",
    "Try Refresh. If it keeps happening, quit Job Hunter Team completely and open it again.",
  ),
  desktop_bad_reply: copy(
    "Il nucleo nativo ha risposto in una forma che l’app non riconosce.",
    "Riprova con Aggiorna. Se si ripete, segnala il codice che vedi accanto.",
    "The native core answered in a form the app does not recognise.",
    "Try Refresh. If it keeps happening, report the code shown next to it.",
  ),
  positions_request_invalid: copy(
    "L’app ha chiesto gli annunci in un modo che il core non accetta.",
    "Segnala il codice che vedi accanto: non dipende dalla VPS.",
    "The app asked for the positions in a way the core does not accept.",
    "Report the code shown next to it: it does not depend on the VPS.",
  ),
  // The assisted browser (closer_desktop.rs) and the registration of its VPS.
  browser_busy: BUSY,
  browser_request_invalid: RETRY,
  browser_transport_unavailable: RETRY,
  browser_response_invalid: BROWSER_REPLY,
  browser_response_too_large: BROWSER_REPLY,
  browser_response_binding_mismatch: BROWSER_REPLY,
  // The bridge on the VPS (closer_desktop_bridge.py) and its bounded transport.
  browser_transport_timeout: TIMEOUT,
  // The bridge says it also when the team's container is only stopped (State.Running).
  browser_container_mismatch: copy(
    "Il browser assistito non è disponibile: la squadra sulla VPS è spenta oppure il suo ambiente è cambiato.",
    "Avvia la squadra sulla VPS e riapri il browser assistito. Se il problema resta, chiedi a chi gestisce la VPS di prepararlo di nuovo.",
    "The assisted browser is not available: the team on the VPS is off or its environment has changed.",
    "Start the team on the VPS and open the assisted browser again. If the problem stays, ask whoever manages the VPS to set it up again.",
  ),
  browser_image_mismatch: BROWSER_RUNTIME_CHANGED,
  // The assisted browser panel itself (closer-desktop/session.ts, lib/closer-desktop.ts).
  desktop_request_denied: BROWSER_REPLY,
  desktop_descriptor_unavailable: BROWSER_REPLY,
  desktop_frame_invalid: BROWSER_REPLY,
  desktop_snapshot_invalid: BROWSER_REPLY,
  desktop_image_invalid: BROWSER_REPLY,
  browser_runtime_binding_required: copy(
    "Il browser assistito non è ancora pronto per questa squadra.",
    "Funziona con una squadra su VPS: chiedi a chi gestisce la VPS di prepararlo, poi riapri il browser assistito.",
    "The assisted browser is not ready for this team yet.",
    "It works with a team on a VPS: ask whoever manages the VPS to set it up, then open the assisted browser again.",
  ),
  browser_binding_invalid: copy(
    "La configurazione salvata del browser assistito non è valida, quindi non la uso.",
    "Chiedi a chi gestisce la VPS di prepararlo di nuovo, poi riapri il browser assistito.",
    "The saved setup of the assisted browser is not valid, so I do not use it.",
    "Ask whoever manages the VPS to set it up again, then open the assisted browser again.",
  ),
  browser_connection_changed: copy(
    "La VPS collegata al browser assistito non corrisponde a quella scelta.",
    "Controlla quale VPS hai scelto, poi riprova.",
    "The VPS linked to the assisted browser does not match the one chosen.",
    "Check which VPS you chose, then try again.",
  ),
  existing_team_runtime_candidate_required: copy(
    "Manca la configurazione verificata della squadra esistente.",
    "Chiedi a chi gestisce la VPS di completare il collegamento, poi riprova.",
    "The verified configuration for the existing team is missing.",
    "Ask whoever manages the VPS to complete the connection, then try again.",
  ),
  existing_team_runtime_candidate_invalid: copy(
    "La configurazione verificata della squadra esistente non è valida.",
    "Chiedi a chi gestisce la VPS di verificare il collegamento, poi riprova.",
    "The verified configuration for the existing team is not valid.",
    "Ask whoever manages the VPS to check the connection, then try again.",
  ),
  existing_team_runtime_candidate_mismatch: copy(
    "La configurazione verificata non corrisponde alla VPS o alla squadra scelta.",
    "Controlla la VPS e l’identificativo della squadra, poi riprova.",
    "The verified configuration does not match the selected VPS or team.",
    "Check the VPS and team identifier, then try again.",
  ),
  existing_team_runtime_candidate_exists: copy(
    "Questo profilo ha già un collegamento salvato per una squadra.",
    "Apri la squadra con il collegamento già salvato: non ne creo un altro.",
    "This profile already has a saved connection for a team.",
    "Open the team with the saved connection; no second one is created.",
  ),
  existing_team_runtime_candidate_conflict: copy(
    "Mentre confermavi, per questo profilo è stato salvato un altro collegamento.",
    "Il collegamento già presente non è stato toccato. Apri la squadra con quello.",
    "Another connection was saved for this profile while you were confirming.",
    "The connection that was already there was not touched. Open the team with it.",
  ),
  existing_team_runtime_already_selected: copy(
    "Per questo profilo c’è già una squadra selezionata.",
    "Aprila dal collegamento esistente invece di cercarne un’altra.",
    "This profile already has a team selected.",
    "Open it from the existing connection instead of looking for another.",
  ),
  existing_team_container_not_found: copy(
    "Su questa VPS non c’è nessun container di Job Hunter Team in esecuzione.",
    "Controlla l’indirizzo della VPS e che la squadra sia accesa, poi riprova.",
    "No Job Hunter Team container is running on this VPS.",
    "Check the VPS address and that the team is on, then try again.",
  ),
  existing_team_not_found: copy(
    "Su questa VPS ci sono squadre Job Hunter Team, ma nessuna con questo identificativo.",
    "Controlla l’identificativo della squadra, poi riprova.",
    "This VPS runs Job Hunter Team teams, but none with this identifier.",
    "Check the team identifier, then try again.",
  ),
  existing_team_ambiguous: copy(
    "Su questa VPS non riesco a individuare un solo container per questa squadra.",
    "Non ne scelgo uno al posto tuo. Chiedi a chi gestisce la VPS di lasciare un solo container per la squadra.",
    "I cannot tell which single container on this VPS belongs to this team.",
    "I will not pick one for you. Ask whoever manages the VPS to leave only one container for the team.",
  ),
  existing_team_choice_gone: copy(
    "Il container che hai scelto non risponde più come questa squadra.",
    "Non è stato salvato nulla. Rileggi la VPS e scegli di nuovo.",
    "The container you picked no longer answers as this team.",
    "Nothing was saved. Read the VPS again and pick again.",
  ),
  invalid_container_choice: copy(
    "Il container scelto non è valido.",
    "Non è stato salvato nulla. Rileggi la VPS e scegli di nuovo.",
    "The container picked is not valid.",
    "Nothing was saved. Read the VPS again and pick again.",
  ),
  existing_team_image_unattested: copy(
    "Un container di Job Hunter Team su questa VPS non ha un’immagine ufficiale ben identificata.",
    "Chiedi a chi gestisce la VPS di aggiornare la squadra con l’immagine ufficiale, poi riprova.",
    "A Job Hunter Team container on this VPS has no clearly identified official image.",
    "Ask whoever manages the VPS to update the team with the official image, then try again.",
  ),
  existing_team_too_many_containers: copy(
    "Questa VPS esegue più container di quanti l’app ne esamini.",
    "Usa una VPS dedicata a Job Hunter Team, oppure chiedi a chi la gestisce di ridurne il numero.",
    "This VPS runs more containers than the app will inspect.",
    "Use a VPS dedicated to Job Hunter Team, or ask whoever manages it to reduce the number.",
  ),
  existing_team_discovery_timeout: copy(
    "La VPS ci ha messo troppo a rispondere.",
    "Riprova tra poco. Se si ripete, controlla che la VPS sia raggiungibile.",
    "The VPS took too long to answer.",
    "Try again shortly. If it happens again, check that the VPS is reachable.",
  ),
  existing_team_target_changed: copy(
    "La squadra sulla VPS è cambiata mentre confermavi.",
    "Non è stato salvato nulla. Rileggi ciò che dichiara il server e conferma di nuovo.",
    "The team on the VPS changed while you were confirming.",
    "Nothing was saved. Read what the server declares again and confirm again.",
  ),
  existing_team_receipt_required: copy(
    "I dati che hai confermato non sono più disponibili.",
    "Non è stato salvato nulla. Leggi di nuovo ciò che dichiara il server.",
    "The details you confirmed are no longer available.",
    "Nothing was saved. Read what the server declares again.",
  ),
  existing_team_register_not_confirmed: copy(
    "L’azione non è stata confermata: non è stato salvato nulla.",
    "Conferma dalla schermata di lettura per salvare il collegamento.",
    "The action was not confirmed: nothing was saved.",
    "Confirm from the review screen to save the connection.",
  ),
  // The link to an existing team's VPS (vps_link.rs, lib/vps-link.ts): the pinned team is not
  // the one running (exit 70, a stopped container too), and the header while it retries.
  existing_team_runtime_outdated: copy(
    "La squadra sulla VPS ha una versione che non sa ancora ricevere questo dall’app.",
    "Aggiorna la squadra sulla VPS, poi riprova.",
    "The team on the VPS has a version that cannot take this from the app yet.",
    "Update the team on the VPS, then try again.",
  ),
  note_too_long: copy(
    "La nota è troppo lunga.",
    "Accorciala e salva di nuovo.",
    "The note is too long.",
    "Shorten it and save again.",
  ),
  position_write_not_confirmed: copy(
    "Per chiedere alla squadra di candidarti serve la tua conferma.",
    "Conferma la richiesta di candidatura e riprova.",
    "Asking the team to apply for you needs your confirmation.",
    "Confirm the application request and try again.",
  ),
  position_write_read_only: copy(
    "Questa squadra è collegata in sola lettura: da qui non si scrive niente.",
    "Per giudicare gli annunci dall’app, collega la squadra con «Conferma e collega».",
    "This team is connected read only: nothing is written from here.",
    "To judge positions from the app, connect the team with “Confirm and connect”.",
  ),
  position_write_request_invalid: copy(
    "La richiesta non è valida e non è stata mandata alla squadra.",
    "Ricarica la pagina e riprova.",
    "The request is not valid and was not sent to the team.",
    "Reload the page and try again.",
  ),
  position_write_window_refused: copy(
    "Questa azione si può fare solo dalla finestra principale dell’app.",
    "Torna alla finestra principale e riprova.",
    "This can be done only from the app’s main window.",
    "Go back to the main window and try again.",
  ),
  cloud_token_read_only: copy(
    "Per rinnovare il token la squadra deve essere collegata in modo completo.",
    "Collega la squadra con «Conferma e collega» e riprova.",
    "To renew the token the team must be connected in full.",
    "Connect the team with “Confirm and connect” and try again.",
  ),
  cloud_token_request_invalid: copy(
    "La richiesta non è valida e non è stata mandata alla squadra.",
    "Ricarica la pagina e riprova.",
    "The request is not valid and was not sent to the team.",
    "Reload the page and try again.",
  ),
  cloud_token_window_refused: copy(
    "Questa azione si può fare solo dalla finestra principale dell’app.",
    "Torna alla finestra principale e riprova.",
    "This can be done only from the app’s main window.",
    "Go back to the main window and try again.",
  ),
  token_malformed: copy(
    "Questo non è un token di sincronizzazione.",
    "Copia il token intero dal sito, senza spazi.",
    "That is not a sync token.",
    "Copy the whole token from the website, with no spaces.",
  ),
  reason_invalid: copy(
    "Il motivo scelto non è tra quelli previsti.",
    "Scegli un motivo dall’elenco e riprova.",
    "The reason chosen is not one of the listed ones.",
    "Pick a reason from the list and try again.",
  ),
  existing_team_runtime_changed: copy(
    "La squadra sulla VPS è spenta oppure non è più la versione collegata.",
    "Avviala sulla VPS e premi Riprova; se il problema resta, ricollega la squadra dalla configurazione.",
    "The team on the VPS is off or is no longer the version that was connected.",
    "Start it on the VPS and press Retry; if the problem stays, connect the team again from the setup.",
  ),
  vps_reconnecting: copy(
    "Collegamento alla VPS perso: riprovo da solo alle {time}.",
    "Non serve fare niente: le azioni sulla squadra restano ferme finché il collegamento non torna.",
    "The link to the VPS was lost: I try again by myself at {time}.",
    "There is nothing to do: actions on the team stay on hold until the link is back.",
  ),
  existing_team_runtime_target_changed: copy(
    "La squadra salvata non corrisponde più al collegamento selezionato.",
    "Controlla la VPS e l’identificativo della squadra, poi riprova.",
    "The saved team no longer matches the selected connection.",
    "Check the VPS and team identifier, then try again.",
  ),
  existing_team_runtime_selection_invalid: copy(
    "La selezione salvata per questa squadra non è valida.",
    "Chiedi a chi gestisce la VPS di verificare il collegamento, poi riprova.",
    "The saved selection for this team is not valid.",
    "Ask whoever manages the VPS to check the connection, then try again.",
  ),
  existing_team_runtime_unavailable: copy(
    "L’app non riesce a leggere i dati salvati della squadra su questo computer.",
    "Chiudi completamente Job Hunter Team e riaprilo.",
    "The app cannot read the team's saved data on this computer.",
    "Quit Job Hunter Team completely and open it again.",
  ),
  existing_team_saved_incomplete: copy(
    "Il collegamento salvato per la squadra esistente è incompleto.",
    "Torna alla configurazione e collega di nuovo la squadra; se non basta, chiedi a chi gestisce la VPS di completare il collegamento.",
    "The saved connection for the existing team is incomplete.",
    "Go back to the setup and connect the team again; if that is not enough, ask whoever manages the VPS to complete the connection.",
  ),
  existing_team_saved_selection_mismatch: copy(
    "La squadra trovata sulla VPS non è più quella salvata per questo profilo.",
    "Non è stato salvato nulla e il collegamento salvato non è stato toccato. Chiedi a chi gestisce la VPS di completare il collegamento.",
    "The team found on the VPS is no longer the one saved for this profile.",
    "Nothing was saved and the saved connection was not touched. Ask whoever manages the VPS to complete the connection.",
  ),
  existing_team_unavailable: TEAM_UNREACHABLE,
  existing_team_runtime_required: NO_VERIFIED_CONNECTION,
  existing_team_runtime_selection_required: NO_VERIFIED_CONNECTION,
  assistant_start_not_confirmed: copy(
    "L’azione non è stata confermata: non è partito nessun comando.",
    "Conferma l’azione dopo aver letto cosa comporta, poi riprova.",
    "The action was not confirmed: no command was sent.",
    "Confirm the action after reading what it involves, then try again.",
  ),
  ssh_unavailable: copy(
    "La VPS non è raggiungibile tramite SSH. Cause probabili: una chiave con passphrase o con permessi troppo aperti, un utente sbagliato, una chiave che la VPS non accetta, una porta chiusa o un tempo scaduto.",
    "Controlla che la VPS sia accesa e la porta SSH aperta, che l’utente sia quello giusto e che la chiave non abbia passphrase, sia leggibile solo da te e sia autorizzata sulla VPS; poi riprova.",
    "The VPS cannot be reached over SSH. Likely causes: a key with a passphrase or with permissions that are too open, the wrong user, a key the VPS does not accept, a closed port, or a timeout.",
    "Check that the VPS is on and the SSH port is open, that the user is the right one and that the key has no passphrase, is readable only by you and is authorized on the VPS; then try again.",
  ),
  ssh_rate_limited: copy(
    "Il server sta rifiutando i collegamenti da questo computer per qualche minuto, dopo troppi tentativi.",
    "Aspetta circa dieci minuti senza riprovare e poi riprova una volta sola: ogni tentativo prolunga l’attesa.",
    "The server is refusing connections from this computer for a few minutes after too many attempts.",
    "Wait about ten minutes without trying again, then try once: every attempt makes the wait longer.",
  ),
  ssh_client_missing: copy(
    "Su questo computer manca il client SSH (OpenSSH), che serve per collegarsi alla VPS.",
    "Installa OpenSSH (su Windows: Impostazioni › App › Funzionalità facoltative › Client OpenSSH; su Mac e Linux è già incluso), riavvia l’app e riprova.",
    "This computer has no SSH client (OpenSSH), which is needed to connect to the VPS.",
    "Install OpenSSH (on Windows: Settings › Apps › Optional features › OpenSSH Client; Mac and Linux include it), restart the app and try again.",
  ),
  ssh_auth_failed: copy(
    "L’accesso SSH alla VPS non è riuscito.",
    "Controlla utente e chiave SSH, poi riprova.",
    "SSH access to the VPS did not succeed.",
    "Check the user and SSH key, then try again.",
  ),

  // ── VPS access details and SSH identity ──────────────────────────────────
  invalid_host: SSH_FIELD,
  invalid_user: SSH_FIELD,
  invalid_port: SSH_FIELD,
  not_vps: copy(
    "Per questa operazione serve una VPS.",
    "Scegli una VPS come destinazione e riprova.",
    "This operation needs a VPS.",
    "Choose a VPS as destination and try again.",
  ),
  invalid_key_path: SSH_KEY_FILE,
  invalid_key: SSH_KEY_FILE,
  key_unavailable: SSH_KEY_FILE,
  host_key_unavailable: copy(
    "Non riesco a leggere l’identità SSH della VPS.",
    "Controlla host e porta, poi riprova.",
    "I cannot read the VPS SSH identity.",
    "Check host and port, then try again.",
  ),
  // The VPS registration of the assisted browser: a probe whose key is not ed25519 or whose
  // fingerprint is not a SHA-256: host and port are right, the key type is not.
  ssh_host_key_invalid: copy(
    "La VPS non ha presentato una chiave SSH ed25519 valida, quindi non posso confermarne l’identità.",
    "Chiedi a chi gestisce la VPS di abilitare una chiave SSH ed25519, poi riprova.",
    "The VPS did not present a valid ed25519 SSH key, so I cannot confirm its identity.",
    "Ask whoever manages the VPS to enable an ed25519 SSH key, then try again.",
  ),
  // install.sh on a VPS, with its own exit: what stops rootless Podman there, for the administrator.
  podman_install_failed: copy(
    "Sulla VPS non sono riuscito a installare Podman.",
    "Chiedi a chi gestisce la VPS di installare a mano podman, podman-compose e uidmap, poi riprova.",
    "I could not install Podman on the VPS.",
    "Ask whoever manages the VPS to install podman, podman-compose and uidmap by hand, then try again.",
  ),
  podman_sudo_required: copy(
    "Sulla VPS il tuo utente non può completare la preparazione di Podman: sudo chiede una password o non c’è.",
    "Chiedi a chi gestisce la VPS sudo senza password, oppure di installare podman, podman-compose e uidmap e di abilitare il linger per il tuo utente, poi riprova.",
    "On the VPS your user cannot finish preparing Podman: sudo asks for a password or is not there.",
    "Ask whoever manages the VPS for sudo without a password, or to install podman, podman-compose and uidmap and enable lingering for your user, then try again.",
  ),
  vps_podman_missing: copy(
    "Sulla VPS manca Podman, che serve per far girare il team.",
    "Chiedi a chi gestisce la VPS di installare Podman, poi riprova.",
    "Podman is not installed on the VPS, and the team needs it to run.",
    "Ask whoever manages the VPS to install Podman, then try again.",
  ),
  podman_rootful_refused: copy(
    "Sulla VPS l’installazione girerebbe come amministratore (root), ma il team si installa solo con Podman senza privilegi.",
    "Chiedi a chi gestisce la VPS un utente normale, non root, e collegati con quello.",
    "On the VPS the install would run as the administrator (root), but the team only installs with Podman without privileges.",
    "Ask whoever manages the VPS for a regular user, not root, and connect with that one.",
  ),
  podman_compose_missing: copy(
    "Sulla VPS c’è Podman, ma manca podman compose.",
    "Chiedi a chi gestisce la VPS di installare podman-compose, poi riprova.",
    "Podman is on the VPS, but podman compose is missing.",
    "Ask whoever manages the VPS to install podman-compose, then try again.",
  ),
  podman_version_unsupported: copy(
    "Sulla VPS la versione di Podman o di podman-compose è troppo vecchia.",
    "Chiedi a chi gestisce la VPS di aggiornare Podman e podman-compose, poi riprova.",
    "On the VPS the version of Podman or podman-compose is too old.",
    "Ask whoever manages the VPS to update Podman and podman-compose, then try again.",
  ),
  podman_runtime_dir_missing: copy(
    "Sulla VPS la tua sessione non ha la cartella di lavoro che serve a Podman senza privilegi.",
    "Chiedi a chi gestisce la VPS di attivare il linger per il tuo utente (loginctl enable-linger), poi riprova.",
    "On the VPS your session has no runtime folder, which Podman without privileges needs.",
    "Ask whoever manages the VPS to enable lingering for your user (loginctl enable-linger), then try again.",
  ),
  podman_rootless_unavailable: copy(
    "Sulla VPS Podman non riesce a partire con il tuo utente.",
    "Chiedi a chi gestisce la VPS di controllare che il comando podman info funzioni con il tuo utente, poi riprova.",
    "On the VPS Podman cannot start for your user.",
    "Ask whoever manages the VPS to check that the podman info command works for your user, then try again.",
  ),
  podman_linger_missing: copy(
    "Sulla VPS il tuo utente non può tenere acceso il team quando ti disconnetti.",
    "Chiedi a chi gestisce la VPS di attivare il linger per il tuo utente (loginctl enable-linger), poi riprova.",
    "On the VPS your user cannot keep the team running after you disconnect.",
    "Ask whoever manages the VPS to enable lingering for your user (loginctl enable-linger), then try again.",
  ),
  podman_subuid_missing: copy(
    "Sulla VPS il tuo utente non ha gli ID subordinati che servono a Podman senza privilegi.",
    "Chiedi a chi gestisce la VPS di aggiungere il tuo utente a /etc/subuid e /etc/subgid, poi riprova.",
    "On the VPS your user has no subordinate IDs, which Podman without privileges needs.",
    "Ask whoever manages the VPS to add your user to /etc/subuid and /etc/subgid, then try again.",
  ),
  // install.sh on a VPS whose team already runs on Docker (exit 85): Podman would start it on
  // empty volumes, and nothing moves them yet. The install stopped before changing anything.
  vps_runtime_change_requires_migration: copy(
    "Su questa VPS Job Hunter Team gira già con Docker. Passarlo a Podman richiede una migrazione, che oggi l’app non sa ancora fare da sola.",
    "I dati del team restano dove sono, sulla VPS: non è stato spostato né cancellato nulla. Collegati al team che c’è già, senza reinstallarlo, oppure scegli un’altra VPS.",
    "This VPS already runs Job Hunter Team with Docker. Moving it to Podman needs a migration, which the app cannot do by itself yet.",
    "The team’s data stays where it is, on the VPS: nothing was moved or deleted. Connect to the team that is already there, without reinstalling it, or choose another VPS.",
  ),
  // install.sh on a VPS whose team is running (exit 84): installing over it would change its
  // configuration under it. The install stopped before changing anything.
  vps_team_running: copy(
    "Su questa VPS Job Hunter Team è acceso: installarlo di nuovo ora cambierebbe la sua configurazione mentre gira.",
    "Non è stato cambiato nulla. Collegati al team che c’è già, senza reinstallarlo; oppure fermalo sulla VPS con «jht down» e riprova.",
    "Job Hunter Team is running on this VPS: installing it again now would change its configuration while it runs.",
    "Nothing was changed. Connect to the team that is already there, without reinstalling it; or stop it on the VPS with «jht down» and try again.",
  ),
  host_key_missing: copy(
    "L’identità SSH della VPS non è ancora stata confermata.",
    "Conferma l’impronta della VPS prima di continuare.",
    "The VPS SSH identity has not been confirmed yet.",
    "Confirm the VPS fingerprint before going on.",
  ),
  host_key_mismatch: HOST_KEY_CHANGED,
  host_key_changed: HOST_KEY_CHANGED,
  host_key_confirmation_invalid: copy(
    "La conferma dell’identità SSH non è valida.",
    "Torna ai dati della VPS e ripeti la verifica.",
    "The SSH identity confirmation is not valid.",
    "Go back to the VPS details and repeat the check.",
  ),
  host_key_unwritable: HOST_KEY_STORE,

  // ── Processes the app runs ───────────────────────────────────────────────
  process_start_failed: PROCESS,
  process_pipe_failed: PROCESS,
  process_input_failed: PROCESS,
  process_wait_failed: PROCESS,
  process_timeout: TIMEOUT,

  // ── Direct chat with the team ────────────────────────────────────────────
  tunnel_start_failed: SECURE_LINK_FAILED,
  tunnel_verify_failed: SECURE_LINK_FAILED,
  tunnel_unavailable: SECURE_LINK_FAILED,
  tunnel_path_unavailable: SECURE_LINK_UNPREPARED,
  existing_team_assistant_unverified: ASSISTANT_UNVERIFIED,
  connect_failed: TEAM_UNREACHABLE,
  reconnect_failed: TEAM_UNREACHABLE,
  status_failed: TEAM_UNREACHABLE,
  subscribe_failed: TEAM_UNREACHABLE,
  disconnected: copy(
    "La chat non è collegata al team.",
    "Ricollega la chat e riprova.",
    "The chat is not connected to the team.",
    "Reconnect the chat and try again.",
  ),
  read_failed: copy(
    "Non riesco a leggere i messaggi.",
    "Attendi qualche secondo: l’app riprova da sola.",
    "I cannot read the messages.",
    "Wait a few seconds: the app tries again by itself.",
  ),
  send_failed: copy(
    "Il messaggio non è stato consegnato.",
    "Rimanda il messaggio.",
    "The message was not delivered.",
    "Send the message again.",
  ),
  send_verify_failed: copy(
    "Non riesco a confermare che il messaggio sia arrivato.",
    "Controlla nella conversazione se c’è, altrimenti rimandalo.",
    "I cannot confirm that the message arrived.",
    "Check the conversation for it, otherwise send it again.",
  ),
  persist_failed: copy(
    "Il messaggio non è stato salvato nella conversazione.",
    "Rimanda il messaggio.",
    "The message was not saved in the conversation.",
    "Send the message again.",
  ),
  invalid_agent: copy(
    "Questo agente non esiste nel team.",
    "Scegli un agente dall’elenco.",
    "This agent does not exist in the team.",
    "Choose an agent from the list.",
  ),
  agent_not_running: copy(
    "L’agente non è acceso.",
    "Accendi il team, poi rimanda il messaggio.",
    "The agent is not running.",
    "Start the team, then send the message again.",
  ),
  team_not_running: copy(
    "Il team non è acceso.",
    "Accendi il team, poi rimanda il messaggio.",
    "The team is not running.",
    "Start the team, then send the message again.",
  ),
  read_only_link: copy(
    "Questa vista è in sola lettura: il messaggio non è stato inviato.",
    "Collega il team con «Conferma e collega» per scrivere.",
    "This view is read only: the message was not sent.",
    "Connect the team with “Confirm and connect” to write.",
  ),
  own_vps_claim_required: copy(
    "Questa VPS è stata creata prima che l’app la segnasse come tua: da qui si legge, ma non si scrive.",
    "Conferma che è la tua con «È la mia VPS», poi riprova.",
    "This VPS was set up before the app marked it as yours: you can read it from here, but not write to it.",
    "Confirm that it is yours with “This is my VPS”, then try again.",
  ),
  own_vps_key_changed: copy(
    "La chiave di questa VPS è cambiata dall’ultima volta che l’hai confermata come tua.",
    "Se l’hai reinstallata tu, confermala di nuovo con «È la mia VPS»; altrimenti non fidarti e controlla.",
    "The key of this VPS has changed since you last confirmed it as yours.",
    "If you reinstalled it yourself, confirm it again with “This is my VPS”; otherwise do not trust it and check it.",
  ),
  own_vps_claim_refused: copy(
    "Questa VPS non può essere confermata come tua.",
    "Controlla di aver aperto la squadra giusta, poi riprova.",
    "This VPS cannot be confirmed as yours.",
    "Check that you opened the right team, then try again.",
  ),
  own_vps_claim_unreachable: copy(
    "La VPS non ha risposto alla verifica.",
    "Controlla che sia accesa e raggiungibile, poi riprova.",
    "The VPS did not answer the check.",
    "Check that it is on and reachable, then try again.",
  ),
  own_vps_claim_not_confirmed: copy(
    "La conferma non è stata data.",
    "Ripeti l’operazione e confermala nella finestra che si apre.",
    "The confirmation was not given.",
    "Repeat the operation and confirm it in the dialog that opens.",
  ),
  chat_runtime_outdated: copy(
    "Il team non ha ancora questa chat.",
    "Aggiorna il team all’ultima versione, poi riprova.",
    "The team does not have this chat yet.",
    "Update the team to the latest version, then try again.",
  ),
  local_chat_wrapper_outdated: copy(
    "Il runtime dell’app su questo computer è più vecchio della chat.",
    "Aggiorna l’app e rifai il passo del runtime: la squadra non va toccata.",
    "The app runtime on this computer is older than the chat.",
    "Update the app and repeat the runtime step: leave the team untouched.",
  ),
  composer_has_text: copy(
    "Nella casella dell’agente c’è un testo non inviato.",
    "Invialo o cancellalo nel terminale dell’agente, poi rimanda il messaggio.",
    "There is unsent text in the agent’s composer.",
    "Send or clear it in the agent’s terminal, then send your message again.",
  ),
  agent_unavailable: AGENT_NOT_READY,
  // The chat never types over a running turn and keeps no queue: the person sends again.
  agent_busy: copy(
    "L’agente sta lavorando: il messaggio non è partito.",
    "Rimandalo quando ha finito il turno; lo vedi dal suo terminale nella pagina Agenti.",
    "The agent is working: the message was not sent.",
    "Send it again once its turn is over; you can see that in its terminal on the Agents page.",
  ),
  agent_not_at_prompt: copy(
    "L’agente non è al prompt: sul suo terminale c’è un menu, un accesso, una domanda di permesso o del testo già scritto.",
    "Guarda il suo terminale nella pagina Agenti; quando è tornato al prompt, rimanda il messaggio.",
    "The agent is not at its prompt: its terminal shows a menu, a sign-in, a permission question or text already typed.",
    "Look at its terminal on the Agents page; when it is back at the prompt, send the message again.",
  ),
  composer_has_text: copy(
    "Nella casella dell’agente c’è un testo non inviato.",
    "Decidi prima se inviarlo o cancellarlo nel terminale dell’agente; il tuo messaggio non è stato inviato.",
    "There is unsent text in the agent’s composer.",
    "First decide whether to send or clear it in the agent’s terminal; your message was not sent.",
  ),
  agent_stuck: copy(
    "L’agente non risponde.",
    "Attendi qualche minuto: il team lo riavvia da solo. Poi rimanda il messaggio.",
    "The agent is not responding.",
    "Wait a few minutes: the team restarts it by itself. Then send the message again.",
  ),

  // ── Live screen of the CLOSER ────────────────────────────────────────────
  window_failed: copy(
    "La finestra dello schermo non si è aperta.",
    "Riprova ad aprirla.",
    "The screen window did not open.",
    "Try opening it again.",
  ),
  home_missing: RUNTIME_MISSING,
  invalid_password: copy(
    "La chiave dello schermo è danneggiata.",
    "Riavvia il team: la chiave viene rigenerata.",
    "The screen key is damaged.",
    "Restart the team: the key is generated again.",
  ),
  live_screen_invalid_port: copy(
    "La porta configurata per lo schermo del CLOSER non è valida.",
    "Riavvia Job Hunter Team. Se si ripete, contatta l’assistenza.",
    "The port set for the CLOSER’s screen is not valid.",
    "Restart Job Hunter Team. If it happens again, contact support.",
  ),
  live_screen_failed: copy(
    "Non riesco a collegarmi allo schermo del CLOSER.",
    "Controlla che il team sia acceso, poi riapri la finestra.",
    "I cannot connect to the CLOSER’s screen.",
    "Check that the team is running, then reopen the window.",
  ),
  screen_not_running: copy(
    "Lo schermo del CLOSER non è acceso.",
    "Accendi il team: la finestra si collega da sola.",
    "The CLOSER’s screen is not on.",
    "Start the team: the window connects by itself.",
  ),

  // ── LinkedIn login in the broker (broker_view.rs) ──────────────────────
  tunnel_port_busy: copy(
    "La porta di questo computer scelta per lo schermo di accesso è occupata da un altro programma.",
    "Riprova: l’app sceglie un’altra porta.",
    "The port of this computer chosen for the login screen is taken by another program.",
    "Try again: the app picks another port.",
  ),
  view_busy: copy(
    "È già aperta una sessione di accesso a LinkedIn.",
    "Chiudi l’altra finestra di accesso, poi riprova.",
    "A LinkedIn login session is already open.",
    "Close the other login window, then try again.",
  ),
  view_unavailable: copy(
    "Lo schermo di accesso a LinkedIn non è disponibile.",
    "Controlla che il team sia acceso e riprova.",
    "The LinkedIn login screen is not available.",
    "Check that the team is running and try again.",
  ),
  login_timeout: copy(
    "La sessione di accesso a LinkedIn è scaduta: dura al massimo 15 minuti.",
    "Riapri l’accesso a LinkedIn e completalo.",
    "The LinkedIn login session expired: it lasts at most 15 minutes.",
    "Start the LinkedIn login again and complete it.",
  ),
  token_expired: copy(
    "Lo schermo di accesso non si è collegato in tempo.",
    "Riapri l’accesso a LinkedIn: la chiave dello schermo vale una volta sola, per due minuti.",
    "The login screen did not connect in time.",
    "Start the LinkedIn login again: the screen key is valid once, for two minutes.",
  ),
  chromium_sandbox_unavailable: copy(
    "Il browser protetto per l’accesso non può partire isolato su questa installazione.",
    "Segnalalo dall’app: l’accesso resta bloccato finché il browser non può girare isolato.",
    "The protected login browser cannot run isolated on this installation.",
    "Report it from the app: the login stays blocked until the browser can run isolated.",
  ),

  // ── The team's mailbox (mail.rs) ─────────────────────────────────────────
  mail_rotation_pending: copy(
    "La password della casella email era leggibile dagli agenti. L’invio continua a funzionare.",
    "Crea una nuova password per app dal tuo provider di posta e salvala in Posta.",
    "The mailbox password was readable by the agents. Sending keeps working.",
    "Create a new app password with your mail provider and save it in Mail.",
  ),
  password_not_rotated: copy(
    "Questa password era leggibile dagli agenti: non si può riusare.",
    "Creane una nuova dal tuo provider di posta (password per app) e salvala qui.",
    "This password was readable by the agents: it cannot be used again.",
    "Create a new one with your mail provider (an app password) and save it here.",
  ),
  mail_unavailable: copy(
    "Il servizio della posta non è raggiungibile.",
    "Controlla che il team sia acceso e riprova.",
    "The mail service cannot be reached.",
    "Check that the team is running and try again.",
  ),
  mail_address_invalid: copy(
    "L’indirizzo della casella non è valido.",
    "Scrivilo per intero, con la @ (per esempio nome@example.com).",
    "The mailbox address is not valid.",
    "Write it in full, with the @ (for example name@example.com).",
  ),
  mail_password_missing: copy(
    "Manca la password per app.",
    "Incollala nel campo della password e salva.",
    "The app password is missing.",
    "Paste it into the password field and save.",
  ),
  mail_password_invalid: copy(
    "La password contiene caratteri che non si possono salvare.",
    "Incolla la password per app così come te la dà il provider, su una riga sola.",
    "The password contains characters that cannot be saved.",
    "Paste the app password exactly as your provider gives it, on a single line.",
  ),
  mail_host_invalid: copy(
    "Il server di posta indicato non è valido.",
    "Scrivi solo il nome del server (per esempio imap.gmail.com) o lascia il campo vuoto.",
    "The mail server given is not valid.",
    "Write only the server name (for example imap.gmail.com) or leave the field empty.",
  ),
  mail_save_failed: copy(
    "La password non è stata salvata.",
    "Riprova. Se si ripete, riavvia Job Hunter Team.",
    "The password was not saved.",
    "Try again. If it happens again, restart Job Hunter Team.",
  ),

  // ── Profile import from a VPS ────────────────────────────────────────────
  local_profile_required: copy(
    "Questa funzione è disponibile solo nel profilo locale.",
    "Entra con il profilo locale e riprova.",
    "This feature is only available in the local profile.",
    "Sign in with the local profile and try again.",
  ),
  target_profile_exists: copy(
    "Su questo computer c’è già un profilo: non è stato sovrascritto.",
    "Se vuoi sostituirlo, elimina prima quello presente.",
    "This computer already has a profile: it was not overwritten.",
    "If you want to replace it, delete the existing one first.",
  ),
  source_profile_missing: copy(
    "Sulla VPS non c’è un profilo da importare.",
    "Completa il profilo sulla VPS, poi riprova.",
    "There is no profile to import on the VPS.",
    "Complete the profile on the VPS, then try again.",
  ),
  source_profile_invalid: copy(
    "Il profilo sulla VPS non supera la verifica.",
    "Correggi il profilo sulla VPS con l’Assistente, poi riprova.",
    "The profile on the VPS fails the check.",
    "Fix the profile on the VPS with the Assistant, then try again.",
  ),
  source_review_pending: copy(
    "Sulla VPS c’è una revisione del profilo ancora da confermare.",
    "Conferma la revisione con l’Assistente, poi riprova.",
    "There is a profile review on the VPS still to be confirmed.",
    "Confirm the review with the Assistant, then try again.",
  ),
  source_review_unavailable: TEAM_UNREACHABLE,
  source_unavailable: TEAM_UNREACHABLE,
  profile_import_timeout: TIMEOUT,
  profile_import_recovery_required: copy(
    "Un’importazione precedente si è interrotta e va controllata.",
    "Riapri Job Hunter Team: l’app completa o annulla l’importazione da sola.",
    "A previous import was interrupted and needs checking.",
    "Reopen Job Hunter Team: the app completes or cancels the import by itself.",
  ),
  profile_import_storage_failed: LOCAL_STORAGE,
  profile_import_unsupported: LOCAL_UNSUPPORTED,
  profile_import_failed: copy(
    "Non è stato possibile importare il profilo. Nessun dato esistente è stato modificato.",
    "Riprova l’importazione.",
    "The profile could not be imported. No existing data was changed.",
    "Try the import again.",
  ),
  existing_team_connect_failed: copy(
    "Il collegamento al team non è riuscito. Nessun dato sensibile è stato salvato.",
    "Controlla i dati della VPS e riprova.",
    "Connecting to the team did not succeed. No sensitive data was saved.",
    "Check the VPS details and try again.",
  ),
  receipt_unverified: copy(
    "Non riesco a confermare che l’importazione sia completa.",
    "Riapri Job Hunter Team e controlla il profilo.",
    "I cannot confirm that the import is complete.",
    "Reopen Job Hunter Team and check the profile.",
  ),

  // ── Local profile, account session, local-to-account migration ───────────
  local_profile_storage_unavailable: LOCAL_STORAGE,
  local_profile_exists: LOCAL_PROFILE,
  local_profile_invalid: LOCAL_PROFILE,
  local_profile_not_found: LOCAL_PROFILE,
  local_profile_unavailable: LOCAL_PROFILE,
  account_session_unavailable: SESSION,
  account_session_required: SESSION,
  account_session_invalid: SESSION,
  account_session_verification_unavailable: copy(
    "Non riesco a verificare la sessione del tuo account.",
    "Controlla la connessione a internet e riprova.",
    "I cannot verify your account session.",
    "Check your internet connection and try again.",
  ),
  local_migration_in_progress: BUSY,
  local_migration_recovery_required: copy(
    "Un collegamento precedente del profilo locale si è interrotto.",
    "Riapri Job Hunter Team: l’app lo completa o lo annulla da sola.",
    "A previous linking of the local profile was interrupted.",
    "Reopen Job Hunter Team: the app completes or cancels it by itself.",
  ),
  local_migration_source_invalid: MIGRATION_SOURCE,
  local_migration_source_mismatch: MIGRATION_SOURCE,
  local_migration_owner_invalid: MIGRATION_SOURCE,
  local_migration_owner_mismatch: MIGRATION_SOURCE,
  local_migration_owner_missing: MIGRATION_SOURCE,
  local_migration_scope_invalid: MIGRATION_SOURCE,
  local_migration_profile_invalid: MIGRATION_SOURCE,
  local_migration_receipt_invalid: MIGRATION_SOURCE,
  local_migration_review_pending: copy(
    "Nel profilo locale c’è una revisione ancora da confermare.",
    "Conferma la revisione con l’Assistente, poi riprova.",
    "The local profile has a review still to be confirmed.",
    "Confirm the review with the Assistant, then try again.",
  ),
  local_migration_profile_changed: copy(
    "Il profilo locale è cambiato mentre lo collegavo all’account.",
    "Riprova: l’app riparte dalla versione attuale.",
    "The local profile changed while I was linking it to the account.",
    "Try again: the app starts from the current version.",
  ),
  local_migration_target_exists: copy(
    "Questo account ha già un profilo: quello locale non è stato spostato.",
    "Continua con il profilo dell’account, oppure entra con un altro account.",
    "This account already has a profile: the local one was not moved.",
    "Go on with the account’s profile, or sign in with another account.",
  ),
  local_migration_storage_failed: MIGRATION_RETRY,
  local_migration_owner_unavailable: MIGRATION_RETRY,
  local_migration_host_missing: MIGRATION_HOST,
  local_migration_host_invalid: MIGRATION_HOST,
  local_migration_host_not_local: MIGRATION_HOST,
  playground_reset_unavailable: PLAYGROUND,
  playground_reset_owner_not_found: PLAYGROUND,
  playground_reset_owner_invalid: PLAYGROUND,
  playground_reset_owner_unavailable: PLAYGROUND,
  playground_reset_owner_unattested: PLAYGROUND,
  playground_reset_scope_active: PLAYGROUND,
  playground_reset_host_unavailable: PLAYGROUND,
  playground_reset_host_invalid: PLAYGROUND,
  playground_reset_host_not_local: PLAYGROUND,

  // ── Google sign-in and the session store ─────────────────────────────────
  auth_not_configured: copy(
    "Questa versione dell’app non sa a quale account collegarsi.",
    "Scarica Job Hunter Team dal sito ufficiale e reinstallalo.",
    "This version of the app does not know which account to connect to.",
    "Download Job Hunter Team from the official site and reinstall it.",
  ),
  browser_not_found: copy(
    "Il browser scelto non è più installato.",
    "Scegli un altro browser.",
    "The chosen browser is no longer installed.",
    "Choose another browser.",
  ),
  browser_failed: copy(
    "Non riesco ad aprire il browser scelto.",
    "Scegline un altro, oppure copia il link di accesso.",
    "I cannot open the chosen browser.",
    "Choose another one, or copy the sign-in link.",
  ),
  login_in_progress: copy(
    "Un accesso è già in corso nel browser.",
    "Completalo nel browser, oppure annullalo e riprova.",
    "A sign-in is already in progress in the browser.",
    "Complete it in the browser, or cancel it and try again.",
  ),
  port_busy: copy(
    "Un altro programma occupa la porta usata per il ritorno dal browser.",
    "Chiudi l’altro accesso in corso e riprova.",
    "Another program is using the port for the return from the browser.",
    "Close the other sign-in in progress and try again.",
  ),
  denied: copy(
    "L’accesso non è stato concesso.",
    "Riprova e conferma l’accesso quando te lo chiede.",
    "Access was not granted.",
    "Try again and confirm access when asked.",
  ),
  cancelled: copy(
    "Hai annullato l’accesso.",
    "Riprova quando vuoi.",
    "You cancelled the sign-in.",
    "Try again whenever you like.",
  ),
  timed_out: copy(
    "Il browser non ha risposto entro cinque minuti.",
    "Riprova l’accesso.",
    "The browser did not answer within five minutes.",
    "Try signing in again.",
  ),
  login_failed: LOGIN_FAILED,
  login_exchange_failed: copy(
    "Google ha risposto, ma la sessione non si è aperta.",
    "Riprova l’accesso con Google.",
    "Google answered, but the session did not open.",
    "Try signing in with Google again.",
  ),
  listener_failed: LOGIN_FAILED,
  invalid_authorize_url: LOGIN_FAILED,
  invalid_supabase_origin: LOGIN_FAILED,
  keychain_unavailable: copy(
    "Il Portachiavi non ha concesso la chiave della sessione.",
    "Chiudi completamente Job Hunter Team, riaprilo e consenti l’accesso al Portachiavi.",
    "The keychain did not grant the session key.",
    "Quit Job Hunter Team completely, reopen it and allow keychain access.",
  ),
  invalid_name: SESSION_STORE,
  value_too_large: SESSION_STORE,
  auth_store_locked: SESSION_STORE,
  data_dir_missing: SESSION_STORE,
  encrypt_failed: SESSION_STORE,
  write_failed: SESSION_STORE,
  remove_failed: SESSION_STORE,

  // ── Voice dictation ──────────────────────────────────────────────────────
  unsupported: copy(
    "Il dettato non è disponibile su questo sistema.",
    "Scrivi il messaggio.",
    "Dictation is not available on this system.",
    "Type the message.",
  ),
  on_device_unsupported: copy(
    "Il dettato sul dispositivo non è disponibile per questa lingua.",
    "Scrivi il messaggio, oppure cambia lingua del sistema.",
    "On-device dictation is not available for this language.",
    "Type the message, or change the system language.",
  ),
  busy: copy(
    "È già in corso una registrazione.",
    "Fermala prima di iniziarne un’altra.",
    "A recording is already in progress.",
    "Stop it before starting another one.",
  ),
  microphone_permission_denied: copy(
    "Job Hunter Team non ha il permesso di usare il microfono.",
    "Concedilo in Impostazioni di Sistema → Privacy e sicurezza → Microfono.",
    "Job Hunter Team is not allowed to use the microphone.",
    "Allow it in System Settings → Privacy & Security → Microphone.",
  ),
  speech_permission_denied: copy(
    "Job Hunter Team non ha il permesso di usare il riconoscimento vocale.",
    "Concedilo in Impostazioni di Sistema → Privacy e sicurezza → Riconoscimento vocale.",
    "Job Hunter Team is not allowed to use speech recognition.",
    "Allow it in System Settings → Privacy & Security → Speech Recognition.",
  ),
  microphone_unavailable: copy(
    "Nessun microfono disponibile.",
    "Collega un microfono e riprova.",
    "No microphone is available.",
    "Connect a microphone and try again.",
  ),
  recognition_failed: copy(
    "Il riconoscimento vocale non ha capito la registrazione.",
    "Riprova parlando più vicino al microfono.",
    "Speech recognition did not understand the recording.",
    "Try again speaking closer to the microphone.",
  ),
  not_recording: VOICE_FAILED,
  invalid_locale: VOICE_FAILED,
  native_failed: VOICE_FAILED,

  // ── Disk space (host_vitals.py, the launcher, `jht team start`, `jht upgrade`) ──
  disk_warning: copy(
    "Lo spazio sul disco sta finendo.",
    "Libera un po’ di spazio, altrimenti il team smetterà di avviare nuovi agenti e aggiornamenti.",
    "Disk space is running low.",
    "Free some space, or the team will stop starting new agents and updates.",
  ),
  disk_low: copy(
    "Il disco è quasi pieno, quindi non parte nessun nuovo agente né aggiornamento.",
    "Svuota il Cestino ed elimina i file grandi che non ti servono, come vecchi download o immagini Docker/Podman inutilizzate, poi riprova. Gli agenti già avviati continuano a lavorare.",
    "The disk is almost full, so no new agent or update will start.",
    "Empty the Trash and delete large files you no longer need, such as old downloads or unused Docker/Podman images, then try again. Agents already running keep working.",
  ),

  // ── «Free up space» on disk_low: `jht clean-images --json` (onboarding_clean_images) ──
  // The confirmation and each outcome; {size} is the freed space (describeError's `bytes`).
  clean_images_confirm: copy(
    "Tolgo solo le vecchie versioni di Job Hunter Team che non servono più: restano quella in uso, la precedente, quelle usate da un container e le immagini di altri programmi. Dati e volumi non vengono toccati.",
    "Conferma per liberare spazio. Se il motore dei container è spento non lo accendo e non tolgo niente.",
    "I remove only the old versions of Job Hunter Team that are no longer needed: the one in use, the previous one, those used by a container and other programs’ images stay. Data and volumes are not touched.",
    "Confirm to free up space. If the container engine is off I do not start it and remove nothing.",
  ),
  clean_images_confirm_vm: copy(
    "Tolgo solo le vecchie versioni di Job Hunter Team che non servono più, dentro la macchina virtuale del motore dei container: restano quella in uso, la precedente, quelle usate da un container e le immagini di altri programmi. Dati e volumi non vengono toccati.",
    "Conferma per liberare spazio. Lo spazio si libera nella macchina virtuale, quindi il disco del Mac potrebbe non guadagnarne.",
    "I remove only the old versions of Job Hunter Team that are no longer needed, inside the container engine’s virtual machine: the one in use, the previous one, those used by a container and other programs’ images stay. Data and volumes are not touched.",
    "Confirm to free up space. The space is freed in the virtual machine, so the Mac’s disk may not gain any.",
  ),
  clean_images_freed: copy(
    "Ho tolto le vecchie versioni di Job Hunter Team e liberato fino a circa {size}.",
    "Riprova ad avviare la squadra. Se il disco è ancora quasi pieno, svuota il Cestino ed elimina i file grandi che non ti servono.",
    "I removed the old versions of Job Hunter Team and freed up to about {size}.",
    "Try starting the team again. If the disk is still almost full, empty the Trash and delete large files you no longer need.",
  ),
  clean_images_freed_vm: copy(
    "Ho tolto le vecchie versioni di Job Hunter Team e liberato fino a circa {size} nella macchina virtuale del motore dei container.",
    "Riprova ad avviare la squadra. Lo spazio sul disco del Mac può restare lo stesso: se non basta, svuota il Cestino ed elimina i file grandi che non ti servono.",
    "I removed the old versions of Job Hunter Team and freed up to about {size} in the container engine’s virtual machine.",
    "Try starting the team again. The space on the Mac’s disk may stay the same: if it is not enough, empty the Trash and delete large files you no longer need.",
  ),
  clean_images_nothing: copy(
    "Non c’erano vecchie versioni di Job Hunter Team da togliere.",
    "Per liberare spazio svuota il Cestino ed elimina i file grandi che non ti servono, poi riprova.",
    "There were no old versions of Job Hunter Team to remove.",
    "To free up space, empty the Trash and delete large files you no longer need, then try again.",
  ),
  clean_images_in_use: copy(
    "Le vecchie versioni rimaste sono usate da un container, quindi le ho tenute.",
    "Per liberare spazio svuota il Cestino ed elimina i file grandi che non ti servono, poi riprova.",
    "The old versions left are used by a container, so I kept them.",
    "To free up space, empty the Trash and delete large files you no longer need, then try again.",
  ),
  clean_images_refused: copy(
    "Il motore dei container non ha tolto le vecchie versioni, quindi sono rimaste.",
    "Per liberare spazio svuota il Cestino ed elimina i file grandi che non ti servono, poi riprova.",
    "The container engine did not remove the old versions, so they stayed.",
    "To free up space, empty the Trash and delete large files you no longer need, then try again.",
  ),
  clean_images_kept_by_choice: copy(
    "Questo computer è impostato per tenere tutte le vecchie versioni di Job Hunter Team, quindi non ho tolto niente.",
    "Per liberare spazio svuota il Cestino ed elimina i file grandi che non ti servono, poi riprova.",
    "This computer is set to keep every old version of Job Hunter Team, so I removed nothing.",
    "To free up space, empty the Trash and delete large files you no longer need, then try again.",
  ),
  clean_images_upgrade: copy(
    "Un aggiornamento di Job Hunter Team è in corso o è rimasto a metà, e gli serve la versione precedente: non ho tolto niente.",
    "Riprova più tardi. Intanto, per liberare spazio, svuota il Cestino ed elimina i file grandi che non ti servono.",
    "An update of Job Hunter Team is running or was left halfway, and it needs the previous version: I removed nothing.",
    "Try again later. Meanwhile, to free up space, empty the Trash and delete large files you no longer need.",
  ),
  clean_images_container_off: copy(
    "Il container di Job Hunter Team non è acceso, quindi non so quale versione è in uso e non ho tolto niente.",
    "Riprova più tardi. Intanto, per liberare spazio, svuota il Cestino ed elimina i file grandi che non ti servono.",
    "The Job Hunter Team container is not running, so I do not know which version is in use and I removed nothing.",
    "Try again later. Meanwhile, to free up space, empty the Trash and delete large files you no longer need.",
  ),
  clean_images_dates_unreadable: copy(
    "Non riesco a leggere la data delle versioni di Job Hunter Team, quindi non ho tolto niente.",
    "Riprova più tardi. Intanto, per liberare spazio, svuota il Cestino ed elimina i file grandi che non ti servono.",
    "I cannot read the dates of the Job Hunter Team versions, so I removed nothing.",
    "Try again later. Meanwhile, to free up space, empty the Trash and delete large files you no longer need.",
  ),
  clean_images_engine_unreadable: copy(
    "Il motore dei container non risponde come dovrebbe, quindi non ho tolto niente.",
    "Riavvia il computer e riprova.",
    "The container engine does not answer as it should, so I removed nothing.",
    "Restart the computer and try again.",
  ),
  clean_images_kept: copy(
    "La pulizia non ha tolto niente.",
    "Per liberare spazio svuota il Cestino ed elimina i file grandi che non ti servono, poi riprova.",
    "The cleaning removed nothing.",
    "To free up space, empty the Trash and delete large files you no longer need, then try again.",
  ),
  clean_images_engine_off: copy(
    "Il motore dei container è spento: non l’ho acceso e non ho tolto niente.",
    "Per liberare spazio svuota il Cestino ed elimina i file grandi che non ti servono, poi riprova.",
    "The container engine is off: I did not start it and removed nothing.",
    "To free up space, empty the Trash and delete large files you no longer need, then try again.",
  ),
  clean_images_failed: copy(
    "La pulizia delle vecchie versioni di Job Hunter Team non è riuscita.",
    "Riprova. Se si ripete, svuota il Cestino ed elimina i file grandi che non ti servono.",
    "Cleaning the old versions of Job Hunter Team did not succeed.",
    "Try again. If it happens again, empty the Trash and delete large files you no longer need.",
  ),
  clean_images_unsupported: copy(
    "Su questo sistema la pulizia dall’app non c’è ancora.",
    "Per liberare spazio svuota il Cestino ed elimina i file grandi che non ti servono, poi riprova.",
    "Cleaning from the app is not available on this system yet.",
    "To free up space, empty the Trash and delete large files you no longer need, then try again.",
  ),
};

/**
 * Codes with a sentence that nothing emits today. They stay, so the copy is
 * ready the day one starts, but they do not count as covered:
 * error-catalog.test.ts fails if one of them shows up at an emission site,
 * and then it leaves this list on purpose.
 */
export const NOT_EMITTED: ReadonlySet<string> = new Set([
  // Rust: only in the message table of onboarding::failure().
  "runtime_wrapper_install_failed",
  "command_timeout",
  // TS: handled by the UI, produced by no backend.
  "podman_other_machine_running_named",
  "container_version_incompatible",
  "account_team_mismatch",
  "ssh_auth_failed",
  // The runtime, the hub and the web say them; the app reads them in the 2nd cut (T10).
  "throttled_local",
  "rate_limited",
  "rate_limited_burst",
  "rate_limited_daily",
  "rate_limit_429",
  "quota",
  "runtime_not_started",
  "provider_failed",
  // Shell layers: the launcher, `jht team start` and the host wrapper's upgrade
  // print them. The app has no Rust or TS emission site for them yet.
  "disk_warning",
]);

function localeOf(locale: string | null | undefined): ErrorLocale {
  if (!locale) return "it";
  return (ERROR_LOCALES as readonly string[]).includes(locale) ? locale as ErrorLocale : "en";
}

const LOCALE_TAGS: Record<ErrorLocale, string> = {
  it: "it-IT", en: "en-GB", de: "de-DE", es: "es-ES", fr: "fr-FR", hu: "hu-HU", pt: "pt-PT",
};

/** A freed size for `{size}`: GB with one decimal from 1 GB, MB below. */
function formatSize(bytes: number, locale: ErrorLocale): string {
  const gb = bytes / 1024 ** 3;
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(LOCALE_TAGS[locale], { maximumFractionDigits: digits }).format(value);
  return gb >= 1 ? `${number(gb, 1)} GB` : `${number(Math.round(bytes / 1024 ** 2), 0)} MB`;
}

function formatTime(resetsAt: number, locale: ErrorLocale, now: number): string {
  const date = new Date(resetsAt * 1000);
  const tag = LOCALE_TAGS[locale];
  const time = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (new Date(now).toDateString() === date.toDateString()) return time;
  const day = new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long" }).format(date);
  const joined: Record<ErrorLocale, string> = {
    it: `${time} di ${day}`,
    en: `${time} on ${day}`,
    de: `${time} am ${day}`,
    es: `${time} del ${day}`,
    fr: `${time} le ${day}`,
    hu: `${day}, ${time}`,
    pt: `${time} de ${day}`,
  };
  return joined[locale];
}

function localizedCopy(code: string, copy: ErrorCopy, locale: ErrorLocale): ErrorTranslationPair {
  if (locale === "it" || locale === "en") return [copy.text[locale], copy.action[locale]];
  return ERROR_CATALOG_LOCALES[code]?.[locale as ErrorTranslationLocale]
    ?? ERROR_CATALOG_LOCALES.unknown[locale as ErrorTranslationLocale];
}

/**
 * The sentence and the action for an error code. An unknown or missing code
 * gets the generic copy, never the code itself. `resetsAt` (unix seconds)
 * fills `{time}`: without it an entry that needs a time falls back to the
 * generic copy instead of showing a placeholder.
 */
export function describeError(
  code: string | null | undefined,
  options: {
    locale?: string | null;
    resetsAt?: number | null;
    now?: number;
    /** Catalog code whose copy replaces the generic one for an unknown code. */
    fallback?: string;
    /** The Podman machine an error names (errorMachineOf), when it has one. */
    machine?: string | null;
    /** The size an outcome names (`{size}`, the space «Free up space» freed), in bytes. */
    bytes?: number | null;
  } = {},
): DescribedError {
  const locale = localeOf(options.locale);
  const key = typeof code === "string" ? code : "unknown";
  const has = (value: string) => Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
  const machine = validMachine(options.machine);
  const named = machine && key in NAMED_VARIANTS ? NAMED_VARIANTS[key] : null;
  const entry = named ? ERROR_CATALOG[named] : key !== "unknown" && has(key) ? ERROR_CATALOG[key] : undefined;
  const fallbackCode = options.fallback && has(options.fallback) ? options.fallback : "unknown";
  const fallback = ERROR_CATALOG[fallbackCode];
  let chosen = entry ?? fallback;
  let chosenCode = entry ? named ?? key : fallbackCode;
  let known = entry !== undefined;
  let [text, action] = localizedCopy(chosenCode, chosen, locale);
  const needsTime = text.includes("{time}") || action.includes("{time}");
  const resetsAt = options.resetsAt;
  const hasTime = typeof resetsAt === "number" && Number.isFinite(resetsAt) && resetsAt > 0;
  const needsSize = text.includes("{size}") || action.includes("{size}");
  const bytes = options.bytes;
  const hasSize = typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0;
  if ((needsTime && !hasTime) || (needsSize && !hasSize)) {
    chosen = UNKNOWN_ERROR;
    chosenCode = "unknown";
    [text, action] = localizedCopy(chosenCode, chosen, locale);
    known = false;
  }
  const time = hasTime ? formatTime(resetsAt as number, locale, options.now ?? Date.now()) : "";
  const size = hasSize ? formatSize(bytes as number, locale) : "";
  const fill = (value: string) =>
    value.replaceAll("{time}", time).replaceAll("{machine}", machine ?? "").replaceAll("{size}", size);
  return { code: key, text: fill(text), action: fill(action), known };
}

/** Codes with a variant that names the machine, picked when one is given. */
const NAMED_VARIANTS: Readonly<Record<string, string>> = {
  podman_other_machine_running: "podman_other_machine_running_named",
};

/** A Podman machine name as the wrapper prints it, or nothing. */
function validMachine(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : null;
}

/** The Podman machine a native error names (`machine`), when it is a valid name. */
export function errorMachineOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  return validMachine((error as { machine?: unknown }).machine);
}

/** The code of a native or TS error: `{ code }` objects and bare strings. */
export function errorCodeOf(error: unknown): string | null {
  if (typeof error === "string") return /^[a-z][a-z0-9_]{0,63}$/.test(error) ? error : null;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : null;
}

/** `resetsAt` carried by `provider_limits_exhausted`, in unix seconds. */
export function errorResetsAt(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { resetsAt?: unknown }).resetsAt;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
