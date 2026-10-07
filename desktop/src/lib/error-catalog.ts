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
  podman_machine_mounts_home: copy(
    "La macchina Podman di JHT vede più cartelle del Mac di quelle che servono a Job Hunter Team.",
    "Ricrea la macchina Podman: i tuoi dati in ~/.jht e in Documenti › Job Hunter Team restano dove sono.",
    "The JHT Podman machine sees more of the Mac’s folders than Job Hunter Team needs.",
    "Recreate the Podman machine: your data in ~/.jht and in Documents › Job Hunter Team stays where it is.",
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
  installer_digest_mismatch: RUNTIME_INTEGRITY,
  installer_payload_invalid: RUNTIME_INTEGRITY,
  // check_podman issues: the command is compiled but no screen calls it today.
  check_failed: PODMAN_CHECK,
  not_found: PODMAN_CHECK,
  version_failed: PODMAN_CHECK,
  version_timeout: PODMAN_CHECK,
  engine_timeout: PODMAN_CHECK,
  engine_unavailable: PODMAN_CHECK,

  // ── VPS pairing and container ────────────────────────────────────────────
  pairing_token_missing: SESSION,
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
    "Il team registrato non risulta attivo sulla VPS.",
    "Accendi il team sulla VPS e riprova.",
    "The registered team is not running on the VPS.",
    "Start the team on the VPS and try again.",
  ),
  existing_team_unavailable: TEAM_UNREACHABLE,
  ssh_unavailable: copy(
    "La VPS non è raggiungibile tramite SSH.",
    "Controlla che la VPS sia accesa e connessa, poi riprova.",
    "The VPS cannot be reached over SSH.",
    "Check that the VPS is on and connected, then try again.",
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
  tunnel_start_failed: TEAM_UNREACHABLE,
  tunnel_verify_failed: TEAM_UNREACHABLE,
  tunnel_unavailable: TEAM_UNREACHABLE,
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
  agent_unavailable: AGENT_NOT_READY,
  agent_busy: AGENT_NOT_READY,
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
};

/**
 * Codes with a sentence that nothing emits today. They stay, so the copy is
 * ready the day one starts, but they do not count as covered:
 * error-catalog.test.ts fails if one of them shows up at an emission site,
 * and then it leaves this list on purpose.
 */
export const NOT_EMITTED: ReadonlySet<string> = new Set([
  // Rust: only in the message table of onboarding::failure().
  "podman_start_failed",
  "runtime_wrapper_install_failed",
  "command_timeout",
  // TS: handled by the UI, produced by no backend.
  "container_version_incompatible",
  "account_team_mismatch",
  "ssh_unavailable",
  "ssh_auth_failed",
]);

function localeOf(locale: string | null | undefined): ErrorLocale {
  if (!locale) return "it";
  return (ERROR_LOCALES as readonly string[]).includes(locale) ? locale as ErrorLocale : "en";
}

function formatTime(resetsAt: number, locale: ErrorLocale, now: number): string {
  const date = new Date(resetsAt * 1000);
  const tags: Record<ErrorLocale, string> = {
    it: "it-IT", en: "en-GB", de: "de-DE", es: "es-ES", fr: "fr-FR", hu: "hu-HU", pt: "pt-PT",
  };
  const tag = tags[locale];
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
  } = {},
): DescribedError {
  const locale = localeOf(options.locale);
  const key = typeof code === "string" ? code : "unknown";
  const has = (value: string) => Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
  const entry = key !== "unknown" && has(key) ? ERROR_CATALOG[key] : undefined;
  const fallbackCode = options.fallback && has(options.fallback) ? options.fallback : "unknown";
  const fallback = ERROR_CATALOG[fallbackCode];
  let chosen = entry ?? fallback;
  let chosenCode = entry ? key : fallbackCode;
  let known = entry !== undefined;
  let [text, action] = localizedCopy(chosenCode, chosen, locale);
  const needsTime = text.includes("{time}") || action.includes("{time}");
  const resetsAt = options.resetsAt;
  const hasTime = typeof resetsAt === "number" && Number.isFinite(resetsAt) && resetsAt > 0;
  if (needsTime && !hasTime) {
    chosen = UNKNOWN_ERROR;
    chosenCode = "unknown";
    [text, action] = localizedCopy(chosenCode, chosen, locale);
    known = false;
  }
  const time = hasTime ? formatTime(resetsAt as number, locale, options.now ?? Date.now()) : "";
  return {
    code: key,
    text: text.replaceAll("{time}", time),
    action: action.replaceAll("{time}", time),
    known,
  };
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
