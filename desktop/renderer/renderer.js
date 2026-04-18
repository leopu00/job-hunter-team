// Wizard renderer: language → welcome → setup → ready → running.
// The user never sees a scrollable dump of state; each step has one job.

const STEP_LANGUAGE = 'language'
const STEP_WELCOME = 'welcome'
const STEP_SETUP = 'setup'
const STEP_CONTAINER = 'container'
const STEP_PROVIDER_CHOOSE = 'provider-choose'
const STEP_PROVIDER_INSTALL = 'provider-install'
const STEP_PROVIDER_LOGIN = 'provider-login'
const STEP_READY = 'ready'
const STEP_RUNNING = 'running'

const PROVIDER_OPTIONS = [
  { id: 'claude', label: 'Claude Code', vendor: 'Anthropic · Claude Pro/Max' },
  { id: 'codex', label: 'Codex', vendor: 'OpenAI · ChatGPT Plus/Pro' },
  { id: 'kimi', label: 'Kimi', vendor: 'Moonshot · Kimi paid plan' },
]

const SUPPORTED_LANGS = ['en', 'it', 'hu']
const DEFAULT_LANG = 'en'
const LANG_STORAGE_KEY = 'jht.lang'

const LANG_LABELS = { en: 'English', it: 'Italiano', hu: 'Magyar' }

const FLAGS = {
  en:
    '<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice">' +
    '<clipPath id="ukA"><path d="M0 0v30h60V0z"/></clipPath>' +
    '<clipPath id="ukB"><path d="M30 15h30v15zv15H0zM0 0h30zv-15h60z"/></clipPath>' +
    '<g clip-path="url(#ukA)">' +
    '<path d="M0 0h60v30H0z" fill="#012169"/>' +
    '<path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/>' +
    '<path d="M0 0l60 30m0-30L0 30" clip-path="url(#ukB)" stroke="#C8102E" stroke-width="4"/>' +
    '<path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/>' +
    '<path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/>' +
    '</g></svg>',
  it:
    '<svg viewBox="0 0 3 2" preserveAspectRatio="none">' +
    '<rect width="1" height="2" x="0" fill="#009246"/>' +
    '<rect width="1" height="2" x="1" fill="#ffffff"/>' +
    '<rect width="1" height="2" x="2" fill="#CE2B37"/>' +
    '</svg>',
  hu:
    '<svg viewBox="0 0 3 2" preserveAspectRatio="none">' +
    '<rect width="3" height="0.667" y="0" fill="#CE2939"/>' +
    '<rect width="3" height="0.666" y="0.667" fill="#ffffff"/>' +
    '<rect width="3" height="0.667" y="1.333" fill="#477050"/>' +
    '</svg>',
}

const TRANSLATIONS = {
  en: {
    'topbar.alpha': 'Beta · internal testing',
    'lang.title': 'Choose your language',
    'lang.lead': 'Interface language for the launcher.',
    'lang.continue': 'Continue',
    'welcome.title': 'Job Hunter Team',
    'welcome.lead':
      'A team of AI agents that hunt for jobs on your behalf, analyse offers and write CVs and cover letters.',
    'welcome.hint':
      'Before we start the team we check everything is ready on your computer. It takes a minute.',
    'welcome.back': 'Back',
    'welcome.continue': 'Continue',
    'setup.title': 'Setup',
    'setup.lead':
      "To run the team in isolation we need <strong>a container runtime</strong>, free. Let's check if it's already on your computer.",
    'setup.lead.win32':
      "To run the team in isolation we need <strong>Docker Desktop</strong>, free. Let's check if it's already on your computer.",
    'setup.lead.darwin':
      "To run the team in isolation we need <strong>Colima</strong>, free. Let's check if it's already on your computer.",
    'setup.lead.linux':
      "To run the team in isolation we need <strong>Docker Engine</strong>, free. Let's check if it's already on your computer.",
    'docker.name.win32': 'Docker',
    'docker.name.darwin': 'Docker',
    'docker.name.linux': 'Docker',
    'docker.subtitle.win32': 'via Docker Desktop',
    'docker.subtitle.darwin': 'via Colima (CLI, free)',
    'docker.subtitle.linux': 'via Docker Engine',
    'docker.action.installAll': 'Install everything',
    'docker.step.homebrew': 'Homebrew',
    'docker.step.colima': 'Colima + Docker CLI',
    'docker.step.daemon': 'Runtime up',
    'docker.install.brewMissingCta': 'Install from brew.sh',
    'docker.install.homebrewFailHint': 'Homebrew install failed',
    'docker.install.authCanceledHint': 'Password prompt canceled — click again',
    'docker.install.colimaFailHint': 'brew install failed',
    'docker.install.daemonFailHint': 'colima start failed',
    'setup.back': 'Back',
    'setup.continue': 'Next',
    'setup.verifying': 'checking…',
    'setup.checkingHint': 'Checking…',
    'setup.statRequired': 'Install size',
    'setup.statFree': 'Free on your PC',
    'docker.state.ok': 'Ready',
    'docker.state.notRunning': 'Not running',
    'docker.state.starting': 'Starting',
    'docker.state.needsReboot': 'Reboot required',
    'docker.state.missing': 'Not installed',
    'docker.action.install': 'Install Docker',
    'docker.action.installColima': 'Install Colima',
    'docker.action.installEverything': 'Install everything',
    'docker.action.restartNow': 'Restart now',
    'docker.action.openDesktop': 'Open Docker Desktop',
    'docker.action.startColima': 'Start Colima',
    'docker.action.check': 'Check',
    'docker.install.windowsRunning':
      'Installing WSL2 + Docker Desktop. This can take 5-10 minutes. Windows will ask for admin permission. Do not close the app.',
    'docker.install.rebootRequired':
      'Installation complete. Restart your computer to finish setting up WSL and Docker. The wizard will resume after reboot.',
    'docker.install.wslInstallFail':
      'Failed to install WSL. Try running Windows Update first and retry.',
    'docker.install.dockerDownloadFail':
      'Could not download Docker Desktop. Check your internet connection and retry.',
    'docker.install.dockerInstallFail':
      'Docker Desktop installation failed. Check the log below for details.',
    'docker.install.aborted':
      'Install was cancelled (admin permission declined). Click "Install everything" again to retry.',
    'docker.install.streamingTitle': 'Installing Colima…',
    'docker.install.brewMissing': 'Homebrew is required first:',
    'docker.install.daemonUnreachable': 'Colima installed but `docker ps` is not responding. Retry or open Terminal.',
    'docker.hint.ok': 'Ready.',
    'docker.hint.missing.win32': 'Install Docker Desktop and reboot your computer to activate it.',
    'docker.hint.missing.darwin': 'Install Colima: run `brew install colima docker` in Terminal.',
    'docker.hint.missing.linux': 'Install Docker Engine from the official guide, then reboot or start the daemon.',
    'docker.hint.notRunning.win32': 'Docker Desktop is installed but not running. Open it to start the daemon.',
    'docker.hint.notRunning.darwin': 'Colima is installed but the daemon is stopped. Start it with `colima start` or click the button below.',
    'docker.hint.starting': 'Docker Desktop is starting. Wait a few seconds and click Check.',
    'docker.hint.needsReboot.win32': 'Docker is installed. Reboot your computer to activate it.',
    'docker.hint.needsReboot.darwin': 'Colima is installed. Run `colima start` to activate the runtime.',
    'docker.hint.needsReboot.linux': 'Docker is installed. Start the daemon (systemctl start docker) or reboot.',
    'deps.wsl.name': 'WSL',
    'deps.wsl.state.ok': 'Ready',
    'deps.wsl.state.missing': 'Not installed',
    'deps.wsl.state.noDistro': 'No Linux distro',
    'deps.wsl.hint.ok': 'WSL is installed with at least one Linux distro.',
    'deps.wsl.hint.missing': 'Click "Install everything" above to set up WSL automatically.',
    'deps.wsl.hint.noDistro': 'Click "Install everything" above to add the default Ubuntu distro.',
    'deps.git.name': 'Git',
    'deps.git.state.ok': 'Ready',
    'deps.git.state.missing': 'Not installed',
    'deps.git.hint.ok': 'Git is installed and on PATH.',
    'deps.git.hint.missing': 'Click "Install everything" above to install Git automatically.',
    'container.title': 'Preparing container',
    'container.lead': 'Downloading the JHT container image (~1 GB). This runs once.',
    'container.status.pulling': 'Pulling image from the registry…',
    'container.status.building': 'Registry unavailable. Building the image locally (this takes a few minutes)…',
    'container.status.ready': 'Container ready.',
    'container.status.error': 'Error: {error}',
    'container.back': 'Back',
    'container.retry': 'Retry',
    'container.continue': 'Continue',
    'provider.title': 'Choose AI providers',
    'provider.lead': 'Pick one or more CLIs. The team runs on subscriptions, not API keys.',
    'provider.hint': 'You can pick up to 3. Login happens in the next step.',
    'provider.back': 'Back',
    'provider.continue': 'Continue',
    'provider.retry': 'Retry',
    'provider.installTitle': 'Installing CLIs',
    'provider.installLead': 'Installing selected CLIs into the container. This runs once per CLI.',
    'provider.installStatus.running': 'Installing {name}…',
    'provider.installStatus.allDone': 'All CLIs installed.',
    'provider.installStatus.error': 'Error while installing {name}: {error}',
    'login.title': 'Sign in to your providers',
    'login.lead': 'Each CLI needs your active subscription. Open Login to sign in inside the app.',
    'login.back': 'Back',
    'login.continue': 'Continue',
    'login.status.signedIn': 'Signed in',
    'login.status.notSignedIn': 'Not signed in',
    'login.action.open': 'Login',
    'login.action.recheck': 'Re-check',
    'login.action.close': 'Close',
    'login.action.done': "I'm done",
    'login.action.paste': 'Paste',
    'login.action.openUrl': 'Open URL',
    'login.action.copyUrl': 'Copy URL',
    'login.hint.codex': 'Codex uses a localhost callback that the container cannot expose. Press Esc in the terminal and choose "Sign in with Device Code".',
    'login.terminalTitle': 'Login — {name}',
    'summary.docker': 'Docker running',
    'summary.wsl': 'WSL ready',
    'summary.image': 'Container image pulled',
    'summary.provider': '{name} installed & signed in',
    'ready.title': 'All set',
    'ready.lead': 'Docker is installed and running. You can start the team.',
    'ready.hint':
      'On first launch the launcher downloads the team code (~60 MB) into your user folder.',
    'ready.start': 'Start Job Hunter Team',
    'running.title': 'Team running',
    'running.leadRunning':
      'The runtime is up. Open the dashboard in your browser to get started.',
    'running.leadStarting': 'Starting…',
    'running.leadPrep': 'Preparing the runtime…',
    'running.leadDownload': 'Downloading team code (one-off, ~60 MB)…',
    'running.leadStartRuntime': 'Starting the runtime…',
    'running.errorStart': 'Error while starting: {msg}',
    'running.errorGeneric': 'Error: {msg}',
    'running.unknownError': 'Unknown error.',
    'running.info.url': 'URL',
    'running.info.port': 'Port',
    'running.info.mode': 'Mode',
    'running.openBrowser': 'Open dashboard',
    'running.stop': 'Stop team',
    'running.advanced': 'Technical details',
    'running.startingBtn': 'Starting…',
  },
  it: {
    'topbar.alpha': 'Beta · test interno',
    'lang.title': 'Scegli la lingua',
    'lang.lead': "Lingua dell'interfaccia del launcher.",
    'lang.continue': 'Continua',
    'welcome.title': 'Job Hunter Team',
    'welcome.lead':
      'Un team di agenti AI che cercano lavoro al posto tuo, analizzano le offerte e scrivono CV e lettere di presentazione.',
    'welcome.hint':
      'Prima di avviare il team controlliamo che tutto sia pronto sul tuo computer. Dura un minuto.',
    'welcome.back': 'Indietro',
    'welcome.continue': 'Continua',
    'setup.title': 'Setup',
    'setup.lead':
      'Per far girare il team in modo isolato serve <strong>un container runtime</strong>, gratuito. Controlliamo se è già sul tuo computer.',
    'setup.lead.win32':
      'Per far girare il team in modo isolato serve <strong>Docker Desktop</strong>, gratuito. Controlliamo se è già sul tuo computer.',
    'setup.lead.darwin':
      'Per far girare il team in modo isolato serve <strong>Colima</strong>, gratuito. Controlliamo se è già sul tuo computer.',
    'setup.lead.linux':
      'Per far girare il team in modo isolato serve <strong>Docker Engine</strong>, gratuito. Controlliamo se è già sul tuo computer.',
    'docker.name.win32': 'Docker',
    'docker.name.darwin': 'Docker',
    'docker.name.linux': 'Docker',
    'docker.subtitle.win32': 'tramite Docker Desktop',
    'docker.subtitle.darwin': 'tramite Colima (CLI, gratuito)',
    'docker.subtitle.linux': 'tramite Docker Engine',
    'docker.action.installAll': 'Installa tutto',
    'docker.step.homebrew': 'Homebrew',
    'docker.step.colima': 'Colima + Docker CLI',
    'docker.step.daemon': 'Runtime attivo',
    'docker.install.brewMissingCta': 'Installa da brew.sh',
    'docker.install.homebrewFailHint': 'Installazione Homebrew fallita',
    'docker.install.authCanceledHint': 'Prompt password annullato — riprova',
    'docker.install.colimaFailHint': 'brew install fallito',
    'docker.install.daemonFailHint': 'colima start fallito',
    'setup.back': 'Indietro',
    'setup.continue': 'Avanti',
    'setup.verifying': 'verifica…',
    'setup.checkingHint': 'Controllo in corso…',
    'setup.statRequired': 'Peso installazione',
    'setup.statFree': 'Libero sul tuo PC',
    'docker.state.ok': 'Pronto',
    'docker.state.notRunning': 'Non in esecuzione',
    'docker.state.starting': 'In avvio',
    'docker.state.needsReboot': 'Riavvio necessario',
    'docker.state.missing': 'Non installato',
    'docker.action.install': 'Installa Docker',
    'docker.action.installColima': 'Installa Colima',
    'docker.action.installEverything': 'Installa tutto',
    'docker.action.restartNow': 'Riavvia ora',
    'docker.action.openDesktop': 'Apri Docker Desktop',
    'docker.action.startColima': 'Avvia Colima',
    'docker.action.check': 'Verifica',
    'docker.install.windowsRunning':
      'Installazione di WSL2 + Docker Desktop in corso. Può durare 5-10 minuti. Windows chiederà i permessi di amministratore. Non chiudere l\'app.',
    'docker.install.rebootRequired':
      'Installazione completata. Riavvia il computer per attivare WSL e Docker. Il wizard riprenderà dopo il riavvio.',
    'docker.install.wslInstallFail':
      'Installazione di WSL fallita. Prova prima con Windows Update, poi riprova.',
    'docker.install.dockerDownloadFail':
      'Impossibile scaricare Docker Desktop. Controlla la connessione e riprova.',
    'docker.install.dockerInstallFail':
      'Installazione di Docker Desktop fallita. Controlla il log sotto per i dettagli.',
    'docker.install.aborted':
      'Installazione annullata (permessi admin rifiutati). Clicca di nuovo "Installa tutto" per riprovare.',
    'docker.install.streamingTitle': 'Installazione Colima…',
    'docker.install.brewMissing': 'Serve prima Homebrew:',
    'docker.install.daemonUnreachable': 'Colima installato ma `docker ps` non risponde. Riprova o apri il Terminale.',
    'docker.hint.ok': 'Pronto.',
    'docker.hint.missing.win32': 'Installa Docker Desktop e riavvia il computer per attivarlo.',
    'docker.hint.missing.darwin': 'Installa Colima: apri il Terminale ed esegui `brew install colima docker`.',
    'docker.hint.missing.linux': 'Installa Docker Engine dalla guida ufficiale, poi riavvia o avvia il daemon.',
    'docker.hint.notRunning.win32': 'Docker Desktop è installato ma non in esecuzione. Aprilo per avviare il daemon.',
    'docker.hint.notRunning.darwin': 'Colima è installato ma il daemon è fermo. Avvialo con `colima start` oppure premi il pulsante qui sotto.',
    'docker.hint.starting': 'Docker Desktop sta partendo. Attendi qualche secondo e premi Verifica.',
    'docker.hint.needsReboot.win32': 'Docker è installato. Riavvia il computer per attivarlo.',
    'docker.hint.needsReboot.darwin': 'Colima è installato. Esegui `colima start` per attivare il runtime.',
    'docker.hint.needsReboot.linux': 'Docker è installato. Avvia il daemon (systemctl start docker) o riavvia.',
    'deps.wsl.name': 'WSL',
    'deps.wsl.state.ok': 'Pronto',
    'deps.wsl.state.missing': 'Non installato',
    'deps.wsl.state.noDistro': 'Nessuna distro Linux',
    'deps.wsl.hint.ok': 'WSL installato con almeno una distro Linux.',
    'deps.wsl.hint.missing': 'Clicca "Installa tutto" sopra per configurare WSL automaticamente.',
    'deps.wsl.hint.noDistro': 'Clicca "Installa tutto" sopra per aggiungere la distro Ubuntu.',
    'deps.git.name': 'Git',
    'deps.git.state.ok': 'Pronto',
    'deps.git.state.missing': 'Non installato',
    'deps.git.hint.ok': 'Git installato e presente nel PATH.',
    'deps.git.hint.missing': 'Clicca "Installa tutto" sopra per installare Git automaticamente.',
    'container.title': 'Preparazione container',
    'container.lead': "Scarico l'image del container JHT (~1 GB). Solo al primo avvio.",
    'container.status.pulling': 'Scarico image dal registry…',
    'container.status.building': "Registry non disponibile. Build locale dell'image (richiede qualche minuto)…",
    'container.status.ready': 'Container pronto.',
    'container.status.error': 'Errore: {error}',
    'container.back': 'Indietro',
    'container.retry': 'Riprova',
    'container.continue': 'Continua',
    'provider.title': 'Scegli i provider AI',
    'provider.lead': 'Seleziona una o più CLI. Il team gira con abbonamenti, non con API key.',
    'provider.hint': 'Puoi sceglierne fino a 3. Il login avviene nel passaggio successivo.',
    'provider.back': 'Indietro',
    'provider.continue': 'Continua',
    'provider.retry': 'Riprova',
    'provider.installTitle': 'Installazione CLI',
    'provider.installLead': 'Installo le CLI selezionate nel container. Una tantum per CLI.',
    'provider.installStatus.running': 'Installazione di {name}…',
    'provider.installStatus.allDone': 'Tutte le CLI installate.',
    'provider.installStatus.error': "Errore durante l'installazione di {name}: {error}",
    'login.title': 'Accedi ai provider',
    'login.lead': "Ogni CLI richiede il tuo abbonamento attivo. Apri Login per autenticarti nell'app.",
    'login.back': 'Indietro',
    'login.continue': 'Continua',
    'login.status.signedIn': 'Autenticato',
    'login.status.notSignedIn': 'Non autenticato',
    'login.action.open': 'Login',
    'login.action.recheck': 'Ricontrolla',
    'login.action.close': 'Chiudi',
    'login.action.done': 'Ho finito',
    'login.action.paste': 'Incolla',
    'login.action.openUrl': 'Apri URL',
    'login.action.copyUrl': 'Copia URL',
    'login.hint.codex': 'Codex usa un redirect su localhost che il container non può esporre. Premi Esc nel terminale e scegli "Sign in with Device Code".',
    'login.terminalTitle': 'Login — {name}',
    'summary.docker': 'Docker in esecuzione',
    'summary.wsl': 'WSL pronta',
    'summary.image': 'Immagine container scaricata',
    'summary.provider': '{name} installato e autenticato',
    'ready.title': 'Tutto pronto',
    'ready.lead': 'Docker è installato e attivo. Puoi avviare il team.',
    'ready.hint':
      'Al primo avvio il launcher scarica il codice del team (~60 MB) nella tua cartella utente.',
    'ready.start': 'Avvia Job Hunter Team',
    'running.title': 'Team in esecuzione',
    'running.leadRunning':
      'Il runtime è partito. Apri la dashboard nel browser per iniziare.',
    'running.leadStarting': 'Avvio in corso…',
    'running.leadPrep': 'Preparazione del runtime…',
    'running.leadDownload': 'Scarico il codice del team (una tantum, ~60 MB)…',
    'running.leadStartRuntime': 'Avvio il runtime…',
    'running.errorStart': "Errore durante l'avvio: {msg}",
    'running.errorGeneric': 'Errore: {msg}',
    'running.unknownError': 'Errore sconosciuto.',
    'running.info.url': 'URL',
    'running.info.port': 'Porta',
    'running.info.mode': 'Modalità',
    'running.openBrowser': 'Apri dashboard',
    'running.stop': 'Ferma team',
    'running.advanced': 'Dettagli tecnici',
    'running.startingBtn': 'Avvio in corso…',
  },
  hu: {
    'topbar.alpha': 'Béta · belső tesztelés',
    'lang.title': 'Válassz nyelvet',
    'lang.lead': 'A launcher felületének nyelve.',
    'lang.continue': 'Tovább',
    'welcome.title': 'Job Hunter Team',
    'welcome.lead':
      'Egy AI-ügynökökből álló csapat, amely helyetted keres állást, elemzi az ajánlatokat és megírja az önéletrajzokat és motivációs leveleket.',
    'welcome.hint':
      'Mielőtt elindítjuk a csapatot, ellenőrizzük, hogy minden készen áll-e a gépeden. Egy percet vesz igénybe.',
    'welcome.back': 'Vissza',
    'welcome.continue': 'Tovább',
    'setup.title': 'Beállítás',
    'setup.lead':
      'A csapat izolált futtatásához <strong>konténer-futtatókörnyezet</strong> szükséges, ingyenes. Ellenőrizzük, hogy már fent van-e a gépeden.',
    'setup.lead.win32':
      'A csapat izolált futtatásához <strong>Docker Desktop</strong> szükséges, ingyenes. Ellenőrizzük, hogy már fent van-e a gépeden.',
    'setup.lead.darwin':
      'A csapat izolált futtatásához <strong>Colima</strong> szükséges, ingyenes. Ellenőrizzük, hogy már fent van-e a gépeden.',
    'setup.lead.linux':
      'A csapat izolált futtatásához <strong>Docker Engine</strong> szükséges, ingyenes. Ellenőrizzük, hogy már fent van-e a gépeden.',
    'docker.name.win32': 'Docker',
    'docker.name.darwin': 'Docker',
    'docker.name.linux': 'Docker',
    'docker.subtitle.win32': 'Docker Desktop használatával',
    'docker.subtitle.darwin': 'Colimán keresztül (CLI, ingyenes)',
    'docker.subtitle.linux': 'Docker Engine használatával',
    'docker.action.installAll': 'Minden telepítése',
    'docker.step.homebrew': 'Homebrew',
    'docker.step.colima': 'Colima + Docker CLI',
    'docker.step.daemon': 'Futtatókörnyezet aktív',
    'docker.install.brewMissingCta': 'Telepítés innen: brew.sh',
    'docker.install.homebrewFailHint': 'A Homebrew telepítése nem sikerült',
    'docker.install.authCanceledHint': 'Jelszó-kérés megszakítva — kattints újra',
    'docker.install.colimaFailHint': 'brew install hiba',
    'docker.install.daemonFailHint': 'colima start hiba',
    'setup.back': 'Vissza',
    'setup.continue': 'Tovább',
    'setup.verifying': 'ellenőrzés…',
    'setup.checkingHint': 'Ellenőrzés folyamatban…',
    'setup.statRequired': 'Telepítés mérete',
    'setup.statFree': 'Szabad hely a gépeden',
    'docker.state.ok': 'Kész',
    'docker.state.notRunning': 'Nincs elindítva',
    'docker.state.starting': 'Indul',
    'docker.state.needsReboot': 'Újraindítás szükséges',
    'docker.state.missing': 'Nincs telepítve',
    'docker.action.install': 'Docker telepítése',
    'docker.action.installColima': 'Colima telepítése',
    'docker.action.installEverything': 'Minden telepítése',
    'docker.action.restartNow': 'Újraindítás',
    'docker.action.openDesktop': 'Docker Desktop megnyitása',
    'docker.action.startColima': 'Colima indítása',
    'docker.action.check': 'Ellenőrzés',
    'docker.install.windowsRunning':
      'WSL2 + Docker Desktop telepítése folyamatban. 5-10 percig tarthat. A Windows rendszergazdai engedélyt fog kérni. Ne zárd be az alkalmazást.',
    'docker.install.rebootRequired':
      'Telepítés kész. Indítsd újra a gépet a WSL és a Docker aktiválásához. A varázsló újraindítás után folytatódik.',
    'docker.install.wslInstallFail':
      'A WSL telepítése nem sikerült. Először futtasd a Windows Update-et, majd próbáld újra.',
    'docker.install.dockerDownloadFail':
      'A Docker Desktop letöltése nem sikerült. Ellenőrizd az internetkapcsolatot, és próbáld újra.',
    'docker.install.dockerInstallFail':
      'A Docker Desktop telepítése nem sikerült. A részletekért nézd meg alább a naplót.',
    'docker.install.aborted':
      'A telepítés megszakadt (rendszergazdai jog megtagadva). Kattints újra a "Minden telepítése" gombra.',
    'docker.install.streamingTitle': 'Colima telepítése…',
    'docker.install.brewMissing': 'Először Homebrew szükséges:',
    'docker.install.daemonUnreachable': 'A Colima telepítve van, de a `docker ps` nem válaszol. Próbáld újra, vagy nyisd meg a Terminált.',
    'docker.hint.ok': 'Kész.',
    'docker.hint.missing.win32': 'Telepítsd a Docker Desktopot, majd indítsd újra a gépet az aktiváláshoz.',
    'docker.hint.missing.darwin': 'Telepítsd a Colimát: nyisd meg a Terminált, és futtasd a `brew install colima docker` parancsot.',
    'docker.hint.missing.linux': 'Telepítsd a Docker Engine-t a hivatalos útmutatóból, majd indítsd újra vagy indítsd el a démont.',
    'docker.hint.notRunning.win32': 'A Docker Desktop telepítve van, de nem fut. Nyisd meg a démon indításához.',
    'docker.hint.notRunning.darwin': 'A Colima telepítve van, de a démon leállt. Indítsd el a `colima start` paranccsal, vagy kattints az alábbi gombra.',
    'docker.hint.starting': 'A Docker Desktop indul. Várj pár másodpercet, majd kattints az Ellenőrzés gombra.',
    'docker.hint.needsReboot.win32': 'A Docker telepítve van. Indítsd újra a gépet az aktiváláshoz.',
    'docker.hint.needsReboot.darwin': 'A Colima telepítve van. Futtasd a `colima start` parancsot a futtatókörnyezet aktiválásához.',
    'docker.hint.needsReboot.linux': 'A Docker telepítve van. Indítsd el a démont (systemctl start docker) vagy indítsd újra a gépet.',
    'deps.wsl.name': 'WSL',
    'deps.wsl.state.ok': 'Kész',
    'deps.wsl.state.missing': 'Nincs telepítve',
    'deps.wsl.state.noDistro': 'Nincs Linux disztró',
    'deps.wsl.hint.ok': 'A WSL telepítve van, legalább egy Linux disztróval.',
    'deps.wsl.hint.missing': 'Kattints fent a "Minden telepítése" gombra a WSL automatikus beállításához.',
    'deps.wsl.hint.noDistro': 'Kattints fent a "Minden telepítése" gombra az Ubuntu disztró hozzáadásához.',
    'deps.git.name': 'Git',
    'deps.git.state.ok': 'Kész',
    'deps.git.state.missing': 'Nincs telepítve',
    'deps.git.hint.ok': 'A Git telepítve van és elérhető a PATH-ban.',
    'deps.git.hint.missing': 'Kattints fent a "Minden telepítése" gombra a Git automatikus telepítéséhez.',
    'container.title': 'Konténer előkészítése',
    'container.lead': 'A JHT konténer image letöltése (~1 GB). Csak az első indításkor fut.',
    'container.status.pulling': 'Image letöltése a registryből…',
    'container.status.building': 'A registry nem elérhető. Image lokális építése (néhány percet vesz igénybe)…',
    'container.status.ready': 'A konténer kész.',
    'container.status.error': 'Hiba: {error}',
    'container.back': 'Vissza',
    'container.retry': 'Újra',
    'container.continue': 'Tovább',
    'provider.title': 'Válassz AI szolgáltatókat',
    'provider.lead': 'Válassz egy vagy több CLI-t. A csapat előfizetéssel fut, nem API kulccsal.',
    'provider.hint': 'Legfeljebb 3-at választhatsz. A bejelentkezés a következő lépésben történik.',
    'provider.back': 'Vissza',
    'provider.continue': 'Tovább',
    'provider.retry': 'Újra',
    'provider.installTitle': 'CLI-k telepítése',
    'provider.installLead': 'A kiválasztott CLI-ket telepítem a konténerbe. CLI-nként egyszer fut.',
    'provider.installStatus.running': '{name} telepítése…',
    'provider.installStatus.allDone': 'Minden CLI telepítve.',
    'provider.installStatus.error': 'Hiba a(z) {name} telepítésekor: {error}',
    'login.title': 'Jelentkezz be a szolgáltatókhoz',
    'login.lead': 'Minden CLI-hez aktív előfizetés kell. Nyisd meg a Belépést az alkalmazáson belül.',
    'login.back': 'Vissza',
    'login.continue': 'Tovább',
    'login.status.signedIn': 'Bejelentkezve',
    'login.status.notSignedIn': 'Nincs bejelentkezve',
    'login.action.open': 'Belépés',
    'login.action.recheck': 'Ellenőrzés',
    'login.action.close': 'Bezár',
    'login.action.done': 'Kész',
    'login.action.paste': 'Beillesztés',
    'login.action.openUrl': 'URL megnyitása',
    'login.action.copyUrl': 'URL másolása',
    'login.hint.codex': 'A Codex localhost visszahívást használ, amit a konténer nem tud elérhetővé tenni. Nyomj Esc-et a terminálban, majd válaszd a "Sign in with Device Code" opciót.',
    'login.terminalTitle': 'Belépés — {name}',
    'summary.docker': 'Docker fut',
    'summary.wsl': 'WSL kész',
    'summary.image': 'Konténer image letöltve',
    'summary.provider': '{name} telepítve és bejelentkezve',
    'ready.title': 'Minden készen áll',
    'ready.lead': 'A Docker telepítve van és fut. Elindíthatod a csapatot.',
    'ready.hint':
      'Az első indításkor a launcher letölti a csapat kódját (~60 MB) a felhasználói mappádba.',
    'ready.start': 'Job Hunter Team indítása',
    'running.title': 'Csapat fut',
    'running.leadRunning':
      'A futtatókörnyezet elindult. Nyisd meg a vezérlőpultot a böngészőben.',
    'running.leadStarting': 'Indítás…',
    'running.leadPrep': 'Futtatókörnyezet előkészítése…',
    'running.leadDownload': 'Csapatkód letöltése (egyszeri, ~60 MB)…',
    'running.leadStartRuntime': 'Futtatókörnyezet indítása…',
    'running.errorStart': 'Hiba indításkor: {msg}',
    'running.errorGeneric': 'Hiba: {msg}',
    'running.unknownError': 'Ismeretlen hiba.',
    'running.info.url': 'URL',
    'running.info.port': 'Port',
    'running.info.mode': 'Mód',
    'running.openBrowser': 'Vezérlőpult megnyitása',
    'running.stop': 'Csapat leállítása',
    'running.advanced': 'Technikai részletek',
    'running.startingBtn': 'Indítás…',
  },
}

let currentLang = DEFAULT_LANG
const dropdowns = []

function t(key, vars) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS[DEFAULT_LANG]
  let str = dict[key] ?? TRANSLATIONS[DEFAULT_LANG][key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return str
}

// The docker status response carries a platform-tagged hint key
// (e.g. `docker.hint.notRunning.darwin`). Use it to pick the right
// action label without round-tripping to main just for os.platform().
function platformFromHintKey(hintKey) {
  if (typeof hintKey !== 'string') return null
  if (hintKey.endsWith('.darwin')) return 'darwin'
  if (hintKey.endsWith('.win32')) return 'win32'
  if (hintKey.endsWith('.linux')) return 'linux'
  return null
}

function applyTranslations() {
  document.documentElement.lang = currentLang
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n')
    const html = node.getAttribute('data-i18n-html') === 'true'
    const value = t(key)
    if (html) node.innerHTML = value
    else node.textContent = value
  }
  for (const dd of dropdowns) dd.refresh()
}

function setLang(lang, { persist = true } = {}) {
  if (!SUPPORTED_LANGS.includes(lang)) return
  currentLang = lang
  if (persist) {
    try { localStorage.setItem(LANG_STORAGE_KEY, lang) } catch (_) {}
  }
  applyTranslations()
  if (state.docker) renderDockerCard(state.docker)
}

// -------- Language dropdown component --------

function initLangDropdown(root, { onPick }) {
  if (!root) return null
  const toggle = root.querySelector('.lang-select__toggle')
  const menu = root.querySelector('.lang-select__menu')
  const flagSlot = root.querySelector('[data-lang-flag]')
  const labelSlot = root.querySelector('[data-lang-label]')
  const codeSlot = root.querySelector('[data-lang-code]')

  menu.innerHTML = SUPPORTED_LANGS.map((lang) => (
    `<li role="option" data-lang="${lang}">` +
      `<button type="button" class="lang-select__item" data-lang="${lang}">` +
        `<span class="flag">${FLAGS[lang]}</span>` +
        `<span>${LANG_LABELS[lang]}</span>` +
      `</button>` +
    `</li>`
  )).join('')

  function close() {
    menu.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
  }

  function open() {
    menu.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation()
    if (menu.hidden) open()
    else close()
  })

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-lang]')
    if (!item) return
    const lang = item.dataset.lang
    close()
    onPick(lang)
  })

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) close()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })

  function refresh() {
    if (flagSlot) flagSlot.innerHTML = FLAGS[currentLang]
    if (labelSlot) labelSlot.textContent = LANG_LABELS[currentLang]
    if (codeSlot) codeSlot.textContent = currentLang.toUpperCase()
    for (const item of menu.querySelectorAll('.lang-select__item')) {
      item.classList.toggle('is-active', item.dataset.lang === currentLang)
    }
  }

  const api = { refresh, close }
  return api
}

// -------- State + DOM refs --------

const state = {
  step: STEP_WELCOME,
  docker: null,
  extraDeps: null,
  payloadBusy: false,
  starting: false,
  containerBusy: false,
  containerReady: false,
  selectedProviders: new Set(),
  providerInstallBusy: false,
  providerInstallDone: false,
  authStates: [],
  lastStatus: null,
}

const dom = {
  steps: document.querySelectorAll('.step'),
  btnWelcomeBack: document.getElementById('btn-welcome-back'),
  btnWelcomeContinue: document.getElementById('btn-welcome-continue'),
  btnSetupBack: document.getElementById('btn-setup-back'),
  btnSetupContinue: document.getElementById('btn-setup-continue'),
  btnStartTeam: document.getElementById('btn-start-team'),
  btnOpenBrowser: document.getElementById('btn-open-browser'),
  btnStopTeam: document.getElementById('btn-stop-team'),
  dockerBadge: document.getElementById('docker-badge'),
  dockerActions: document.getElementById('docker-actions'),
  dockerCard: document.getElementById('docker-card'),
  dockerName: document.getElementById('docker-name'),
  dockerSubtitle: document.getElementById('docker-subtitle'),
  setupLead: document.getElementById('setup-lead'),
  dockerSteps: document.getElementById('docker-steps'),
  stepHomebrew: document.getElementById('step-homebrew'),
  stepColima: document.getElementById('step-colima'),
  stepDaemon: document.getElementById('step-daemon'),
  stepHomebrewHint: document.getElementById('step-homebrew-hint'),
  stepColimaHint: document.getElementById('step-colima-hint'),
  stepDaemonHint: document.getElementById('step-daemon-hint'),
  dockerInstallLog: document.getElementById('docker-install-log'),
  extraDeps: document.getElementById('extra-deps'),
  containerMessage: document.getElementById('container-message'),
  containerBar: document.getElementById('container-bar'),
  containerIcon: document.getElementById('container-icon'),
  containerLog: document.getElementById('container-log'),
  btnContainerBack: document.getElementById('btn-container-back'),
  btnContainerRetry: document.getElementById('btn-container-retry'),
  btnContainerContinue: document.getElementById('btn-container-continue'),
  providerOptions: document.getElementById('provider-options'),
  btnProviderBack: document.getElementById('btn-provider-back'),
  btnProviderContinue: document.getElementById('btn-provider-continue'),
  providerMessage: document.getElementById('provider-message'),
  providerBar: document.getElementById('provider-bar'),
  providerIcon: document.getElementById('provider-icon'),
  providerLog: document.getElementById('provider-log'),
  btnProviderInstallBack: document.getElementById('btn-provider-install-back'),
  btnProviderInstallRetry: document.getElementById('btn-provider-install-retry'),
  btnProviderInstallContinue: document.getElementById('btn-provider-install-continue'),
  authList: document.getElementById('auth-list'),
  btnLoginBack: document.getElementById('btn-login-back'),
  btnLoginContinue: document.getElementById('btn-login-continue'),
  summaryList: document.getElementById('summary-list'),
  terminalModal: document.getElementById('terminal-modal'),
  terminalModalTitle: document.getElementById('terminal-modal-title'),
  terminalModalBody: document.getElementById('terminal-modal-body'),
  btnTerminalClose: document.getElementById('terminal-modal-close'),
  btnTerminalDone: document.getElementById('terminal-modal-done'),
  btnTerminalPaste: document.getElementById('terminal-modal-paste'),
  btnTerminalOpenUrl: document.getElementById('terminal-modal-open-url'),
  btnTerminalCopyUrl: document.getElementById('terminal-modal-copy-url'),
  runningTitle: document.getElementById('running-title'),
  runningLead: document.getElementById('running-lead'),
  runningInfo: document.getElementById('running-info'),
  advancedLog: document.getElementById('advanced-log'),
  readyHint: document.getElementById('ready-hint'),
}

function showStep(name) {
  state.step = name
  for (const section of dom.steps) {
    section.hidden = section.dataset.step !== name
  }
}

function appendLog(line) {
  if (!line) return
  dom.advancedLog.textContent += `${line}\n`
}

// -------- Docker card --------

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

const STEP_DOM = {
  homebrew: { li: 'stepHomebrew', hint: 'stepHomebrewHint' },
  colima: { li: 'stepColima', hint: 'stepColimaHint' },
  daemon: { li: 'stepDaemon', hint: 'stepDaemonHint' },
}

function setStepState(name, state, hintHtml) {
  const entry = STEP_DOM[name]
  if (!entry) return
  const li = dom[entry.li]
  const hint = dom[entry.hint]
  if (li) li.setAttribute('data-state', state)
  if (hint) hint.innerHTML = hintHtml || ''
}

function paintStepsFromStatus(status) {
  const platform = status.platform || platformFromHintKey(status.check && status.check.hintKey)
  // Only darwin uses the sequential-install checklist UX for now.
  // We set BOTH the `hidden` attribute and an inline `display:none`
  // because the .install-steps stylesheet rule has `display: flex`
  // which overrides the user-agent default for `[hidden]` (no
  // `.install-steps[hidden]` rule in the CSS to pull it back).
  if (platform !== 'darwin') {
    if (dom.dockerSteps) {
      dom.dockerSteps.hidden = true
      dom.dockerSteps.style.display = 'none'
    }
    return
  }
  if (dom.dockerSteps) {
    dom.dockerSteps.hidden = false
    dom.dockerSteps.style.display = ''
  }

  const steps = status.steps || { homebrew: 'missing', colima: 'missing', daemon: 'missing' }
  setStepState('homebrew', steps.homebrew === 'ok' ? 'ok' : 'pending', '')
  setStepState('colima', steps.colima === 'ok' ? 'ok' : 'pending')
  setStepState('daemon', steps.daemon === 'ok' ? 'ok' : 'pending')
}

// Paint platform-specific text and visibility on the docker card before
// any IPC round-trip. Called at boot from the synchronous
// window.platformInfo.platform so the wizard never flashes the
// wrong-platform skeleton (e.g. macOS Homebrew/Colima checklist on
// Windows) while waiting for setup:get-docker-status to reply.
function applyPlatformSkeleton(platform) {
  if (!platform) return
  if (dom.dockerName) {
    dom.dockerName.textContent = t(`docker.name.${platform}`)
  }
  if (dom.dockerSubtitle) {
    const subtitleKey = `docker.subtitle.${platform}`
    const value = t(subtitleKey)
    dom.dockerSubtitle.textContent = value === subtitleKey ? '' : value
  }
  if (dom.setupLead) {
    const leadKey = `setup.lead.${platform}`
    const value = t(leadKey)
    if (value !== leadKey) dom.setupLead.innerHTML = value
  }
  // The macOS install-steps checklist only belongs on darwin. Force
  // both the hidden attribute and the inline display so neither the
  // CSS specificity nor a stripped rule can leak it back in.
  if (dom.dockerSteps) {
    const hide = platform !== 'darwin'
    dom.dockerSteps.hidden = hide
    dom.dockerSteps.style.display = hide ? 'none' : ''
  }
}

function renderDockerCard(status) {
  const check = status.check
  const card = dom.dockerCard
  card.classList.remove('dep-card--ok', 'dep-card--warn', 'dep-card--missing')

  const platform = status.platform || platformFromHintKey(check.hintKey)
  if (platform && dom.dockerName) {
    dom.dockerName.textContent = t(`docker.name.${platform}`)
  }
  if (platform && dom.dockerSubtitle) {
    const subtitleKey = `docker.subtitle.${platform}`
    dom.dockerSubtitle.textContent = t(subtitleKey) === subtitleKey ? '' : t(subtitleKey)
  }
  if (platform && dom.setupLead) {
    dom.setupLead.innerHTML = t(`setup.lead.${platform}`)
  }

  if (check.state === 'ok') {
    dom.dockerBadge.textContent = t('docker.state.ok')
    card.classList.add('dep-card--ok')
  } else if (check.state === 'not-running') {
    dom.dockerBadge.textContent = t('docker.state.notRunning')
    card.classList.add('dep-card--warn')
  } else if (check.state === 'starting') {
    dom.dockerBadge.textContent = t('docker.state.starting')
    card.classList.add('dep-card--warn')
  } else if (check.state === 'needs-reboot') {
    dom.dockerBadge.textContent = t('docker.state.needsReboot')
    card.classList.add('dep-card--warn')
  } else {
    dom.dockerBadge.textContent = t('docker.state.missing')
    card.classList.add('dep-card--missing')
  }

  paintStepsFromStatus(status)

  clearChildren(dom.dockerActions)

  // On Windows the "Install everything" button must surface even when
  // Docker is already ready, because we also need to install WSL/Git
  // for any non-ok extra dep. We treat those as a unified install
  // because the user experience must be one click → reboot → done.
  const extraDeps = state.extraDeps && Array.isArray(state.extraDeps.deps)
    ? state.extraDeps.deps : []
  const anyExtraMissing = extraDeps.some((d) => d.required && !d.ok)

  if (platform === 'win32' && (check.state !== 'ok' || anyExtraMissing)) {
    const installAll = document.createElement('button')
    installAll.className = 'btn btn--primary'
    installAll.textContent = t('docker.action.installEverything')
    installAll.addEventListener('click', onInstallWindowsStack)
    dom.dockerActions.appendChild(installAll)

    if (check.state === 'not-running') {
      const openDesktop = document.createElement('button')
      openDesktop.className = 'btn btn--ghost'
      openDesktop.textContent = t('docker.action.openDesktop')
      openDesktop.addEventListener('click', onOpenDockerDesktop)
      dom.dockerActions.appendChild(openDesktop)
    }
    return
  }

  if (check.state === 'ok') return

  if (platform === 'darwin') {
    const install = document.createElement('button')
    install.className = 'btn btn--primary'
    install.textContent = t('docker.action.installAll')
    install.addEventListener('click', onInstallDocker)
    dom.dockerActions.appendChild(install)
    return
  }

  // linux fallback: the "open download page" flow.
  if (check.state === 'missing') {
    const install = document.createElement('button')
    install.className = 'btn btn--primary'
    install.textContent = t('docker.action.install')
    install.addEventListener('click', onOpenDownloadPage)
    dom.dockerActions.appendChild(install)
    return
  }

  if (check.state === 'not-running') {
    const openDesktop = document.createElement('button')
    openDesktop.className = 'btn btn--primary'
    openDesktop.textContent = t('docker.action.openDesktop')
    openDesktop.addEventListener('click', onOpenDockerDesktop)
    dom.dockerActions.appendChild(openDesktop)
  }
}

async function refreshDockerStatus() {
  setBusy(true)
  try {
    const [status, extra] = await Promise.all([
      window.setupApi.getDockerStatus(),
      window.setupApi.getExtraDeps(),
    ])
    state.docker = status
    state.extraDeps = extra
    renderDockerCard(status)
    renderExtraDeps(extra)
    const dockerOk = status.check.state === 'ok'
    const depsOk = extra && extra.allRequiredOk !== false
    dom.btnSetupContinue.disabled = !(dockerOk && depsOk)
  } finally {
    setBusy(false)
  }
}

function renderExtraDeps(extra) {
  const list = dom.extraDeps
  list.innerHTML = ''
  if (!extra || !Array.isArray(extra.deps)) return
  for (const dep of extra.deps) {
    list.appendChild(buildDepCard(dep))
  }
}

function depStateClass(dep) {
  if (dep.ok) return 'dep-card--ok'
  if (dep.required) return 'dep-card--missing'
  return 'dep-card--warn'
}

function buildDepCard(dep) {
  const card = document.createElement('div')
  card.className = `dep-card dep-card--compact ${depStateClass(dep)}`

  const header = document.createElement('div')
  header.className = 'dep-card__header'

  const name = document.createElement('span')
  name.className = 'dep-card__name'
  name.textContent = t(`deps.${camelId(dep.id)}.name`)
  header.appendChild(name)

  const badge = document.createElement('span')
  badge.className = 'dep-card__badge'
  badge.textContent = t(`deps.${camelId(dep.id)}.state.${camelState(dep.state)}`)
  header.appendChild(badge)
  card.appendChild(header)

  const hint = document.createElement('p')
  hint.className = 'dep-card__hint'
  const hintVars = dep.id === 'ai-cli' && Array.isArray(dep.found)
    ? { found: dep.found.join(', ') }
    : undefined
  hint.textContent = dep.hintKey ? t(dep.hintKey, hintVars) : ''
  card.appendChild(hint)

  return card
}

function camelId(id) {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function camelState(stateStr) {
  if (!stateStr) return 'missing'
  return stateStr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function setBusy(isBusy) {
  dom.dockerCard.classList.toggle('dep-card--busy', isBusy)
  for (const btn of dom.dockerActions.querySelectorAll('button')) {
    btn.disabled = isBusy
  }
}

async function onOpenDownloadPage() {
  setBusy(true)
  try {
    await window.setupApi.openDockerDownloadPage()
  } finally {
    setBusy(false)
  }
}

function showInstallLog() {
  if (dom.dockerInstallLog) {
    dom.dockerInstallLog.textContent = ''
    dom.dockerInstallLog.hidden = false
  }
}

function hideInstallLog() {
  if (dom.dockerInstallLog) dom.dockerInstallLog.hidden = true
}

async function onInstallDocker() {
  setBusy(true)
  showInstallLog()
  // Mark all three steps as pending → the live stage listener will promote
  // each to 'busy'/'ok'/'fail' as the backend progresses through them.
  setStepState('homebrew', 'pending', '')
  setStepState('colima', 'pending', '')
  setStepState('daemon', 'pending', '')
  try {
    const result = await window.setupApi.installDocker()
    if (result?.ok) {
      hideInstallLog()
      await refreshDockerStatus()
      return
    }
    if (result?.stage === 'brew-auth-canceled') {
      setStepState('homebrew', 'fail', t('docker.install.authCanceledHint'))
      return
    }
    if (result?.stage === 'brew-install-homebrew' || result?.stage === 'brew-missing') {
      setStepState('homebrew', 'fail', t('docker.install.homebrewFailHint'))
      return
    }
    if (result?.stage === 'brew-install') {
      setStepState('colima', 'fail', t('docker.install.colimaFailHint'))
      return
    }
    if (result?.stage === 'colima-start' || result?.stage === 'daemon-unreachable') {
      setStepState('daemon', 'fail', t('docker.install.daemonFailHint'))
      return
    }
  } catch (error) {
    setStepState('colima', 'fail', error instanceof Error ? error.message : String(error))
  } finally {
    setBusy(false)
  }
}

async function onInstallWindowsStack() {
  setBusy(true)
  showInstallLog()
  dom.dockerInstallLog.textContent = t('docker.install.windowsRunning')
  try {
    const result = await window.setupApi.installWindowsStack()
    if (result?.ok && result.rebootRequired) {
      // Swap the action row with a prominent "Restart now" button. The
      // rest of the wizard stays locked until the user reboots.
      clearChildren(dom.dockerActions)
      const reboot = document.createElement('button')
      reboot.className = 'btn btn--primary'
      reboot.textContent = t('docker.action.restartNow')
      reboot.addEventListener('click', onRebootNow)
      dom.dockerActions.appendChild(reboot)
      dom.dockerInstallLog.textContent = t('docker.install.rebootRequired')
      dom.dockerInstallLog.hidden = false
      return
    }
    const stage = result?.stage || 'unknown'
    const errMsg = result?.error || 'installer failed'
    const hintKey =
      stage === 'wsl-install' ? 'docker.install.wslInstallFail' :
      stage === 'docker-download' ? 'docker.install.dockerDownloadFail' :
      stage === 'docker-install' ? 'docker.install.dockerInstallFail' :
      stage === 'aborted' ? 'docker.install.aborted' :
      null
    dom.dockerInstallLog.textContent = hintKey
      ? `${t(hintKey)}\n\n${errMsg}`
      : errMsg
    dom.dockerInstallLog.hidden = false
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    dom.dockerInstallLog.textContent = msg
    dom.dockerInstallLog.hidden = false
  } finally {
    setBusy(false)
  }
}

async function onRebootNow() {
  try {
    await window.setupApi.reboot()
  } catch (_) {
    // If reboot couldn't be triggered programmatically, the label
    // message already tells the user to restart manually.
  }
}

async function onOpenDockerDesktop() {
  setBusy(true)
  try {
    const result = await window.setupApi.openDockerDesktop()
    if (!result?.ok) {
      appendLog(`openDockerDesktop: ${result?.error || 'failed'}`)
    }
  } finally {
    setBusy(false)
  }
}

// -------- Running step --------

function updateRunningUI(status) {
  if (!status) return
  dom.runningInfo.innerHTML = ''
  const row = (label, value) => {
    const el = document.createElement('div')
    el.className = 'info-row'
    const l = document.createElement('span')
    l.className = 'info-row__label'
    l.textContent = label
    const v = document.createElement('span')
    v.className = 'info-row__value'
    v.textContent = value
    el.appendChild(l)
    el.appendChild(v)
    return el
  }
  if (status.url) dom.runningInfo.appendChild(row(t('running.info.url'), status.url))
  if (status.port) dom.runningInfo.appendChild(row(t('running.info.port'), String(status.port)))
  if (status.mode) dom.runningInfo.appendChild(row(t('running.info.mode'), status.mode))
  if (status.running) {
    dom.runningLead.textContent = t('running.leadRunning')
  } else if (status.mode === 'starting') {
    dom.runningLead.textContent = t('running.leadStarting')
  } else if (status.mode === 'error') {
    const msg = status.lastError || t('running.unknownError')
    dom.runningLead.textContent = t('running.errorGeneric', { msg })
  }
}

async function refreshRunningStatus() {
  try {
    const status = await window.launcherApi.getStatus()
    updateRunningUI(status)
  } catch (error) {
    appendLog(`refreshRunningStatus: ${error.message || error}`)
  }
}

async function startTeam() {
  if (state.starting) return
  state.starting = true
  dom.btnStartTeam.disabled = true
  dom.btnStartTeam.textContent = t('running.startingBtn')
  showStep(STEP_RUNNING)
  dom.runningLead.textContent = t('running.leadPrep')
  try {
    const payloadInfo = await window.launcherApi.getPayloadDir()
    if (!payloadInfo?.present) {
      dom.runningLead.textContent = t('running.leadDownload')
      const result = await window.launcherApi.ensurePayload({ update: false })
      if (!result.ok) throw new Error(result.error || 'download failed')
    }
    dom.runningLead.textContent = t('running.leadStartRuntime')
    const status = await window.launcherApi.start({})
    updateRunningUI(status)
    if (status.running && status.url) {
      await window.launcherApi.openBrowser().catch(() => {})
    }
  } catch (error) {
    appendLog(`startTeam error: ${error.message || error}`)
    dom.runningLead.textContent = t('running.errorStart', { msg: error.message || error })
  } finally {
    state.starting = false
    dom.btnStartTeam.disabled = false
    dom.btnStartTeam.textContent = t('ready.start')
  }
}

async function stopTeam() {
  dom.btnStopTeam.disabled = true
  try {
    await window.launcherApi.stop()
    showStep(STEP_READY)
  } finally {
    dom.btnStopTeam.disabled = false
  }
}

// -------- Wiring --------

const stepDropdown = initLangDropdown(document.getElementById('lang-select'), {
  onPick: (lang) => {
    setLang(lang)
  },
})
if (stepDropdown) dropdowns.push(stepDropdown)

document.getElementById('btn-language-continue').addEventListener('click', () => {
  showStep(STEP_WELCOME)
})

dom.btnWelcomeBack.addEventListener('click', () => showStep(STEP_LANGUAGE))

dom.btnWelcomeContinue.addEventListener('click', async () => {
  await smartAdvanceFromWelcome()
})

// Decide which step the user actually needs to see, based on what is
// already set up on their machine. Jumps past steps whose prerequisite
// is already satisfied so a re-launch doesn't force them through the
// whole wizard again.
async function smartAdvanceFromWelcome() {
  // Walk the wizard in order — each step self-reports its status with
  // a checkmark and lets the user click Continue. No steps are hidden
  // from view just because they're already resolved; the user wants
  // to see the state of everything, not jump past it.
  try {
    const status = await window.setupApi.getStatus()
    state.lastStatus = status
    const saved = Array.isArray(status?.providers?.saved) ? status.providers.saved : []
    state.selectedProviders = new Set(saved)
    state.authStates = Array.isArray(status?.providers?.auth) ? status.providers.auth : []
  } catch {
    // Probe failed; walk the wizard anyway.
  }
  await enterSetup()
}

dom.btnSetupBack.addEventListener('click', () => showStep(STEP_WELCOME))

dom.btnSetupContinue.addEventListener('click', () => {
  const dockerOk = state.docker?.check.state === 'ok'
  const depsOk = !state.extraDeps || state.extraDeps.allRequiredOk !== false
  if (!dockerOk || !depsOk) return
  showStep(STEP_CONTAINER)
  startContainerPrep()
})

dom.btnContainerBack.addEventListener('click', async () => {
  if (state.containerBusy) return
  await enterSetup()
})

async function enterSetup() {
  showStep(STEP_SETUP)
  await refreshDockerStatus()
}

dom.btnContainerRetry.addEventListener('click', () => {
  if (state.containerBusy) return
  startContainerPrep()
})

dom.btnContainerContinue.addEventListener('click', () => {
  if (state.containerReady) {
    enterProviderChoose()
  }
})

async function enterProviderChoose() {
  showStep(STEP_PROVIDER_CHOOSE)
  renderProviderOptions()
  try {
    const res = await window.setupApi.getProviders()
    const saved = Array.isArray(res?.providers) ? res.providers : []
    state.selectedProviders = new Set(saved)
    renderProviderOptions()
  } catch {
    // no-op: missing selection is fine
  }
}

function renderProviderOptions() {
  const container = dom.providerOptions
  container.innerHTML = ''
  for (const opt of PROVIDER_OPTIONS) {
    const id = `prov-${opt.id}`
    const row = document.createElement('label')
    row.className = 'provider-option'
    row.htmlFor = id

    const check = document.createElement('input')
    check.type = 'checkbox'
    check.id = id
    check.value = opt.id
    check.checked = state.selectedProviders.has(opt.id)
    check.addEventListener('change', () => {
      if (check.checked) state.selectedProviders.add(opt.id)
      else state.selectedProviders.delete(opt.id)
      row.classList.toggle('provider-option--active', check.checked)
      dom.btnProviderContinue.disabled = state.selectedProviders.size === 0
    })

    const body = document.createElement('div')
    body.className = 'provider-option__body'

    const name = document.createElement('div')
    name.className = 'provider-option__name'
    name.textContent = opt.label

    const vendor = document.createElement('div')
    vendor.className = 'provider-option__vendor'
    vendor.textContent = opt.vendor

    body.appendChild(name)
    body.appendChild(vendor)

    row.appendChild(check)
    row.appendChild(body)
    if (check.checked) row.classList.add('provider-option--active')
    container.appendChild(row)
  }
  dom.btnProviderContinue.disabled = state.selectedProviders.size === 0
}

dom.btnProviderBack.addEventListener('click', () => {
  showStep(STEP_CONTAINER)
})

dom.btnProviderContinue.addEventListener('click', () => {
  if (state.selectedProviders.size === 0) return
  showStep(STEP_PROVIDER_INSTALL)
  startProviderInstall()
})

dom.btnProviderInstallBack.addEventListener('click', () => {
  if (state.providerInstallBusy) return
  showStep(STEP_PROVIDER_CHOOSE)
})

dom.btnProviderInstallRetry.addEventListener('click', () => {
  if (state.providerInstallBusy) return
  startProviderInstall()
})

dom.btnProviderInstallContinue.addEventListener('click', () => {
  if (state.providerInstallDone) enterProviderLogin()
})

async function startProviderInstall() {
  if (state.providerInstallBusy) return
  state.providerInstallBusy = true
  state.providerInstallDone = false
  dom.providerLog.textContent = ''
  dom.btnProviderInstallRetry.hidden = true
  dom.btnProviderInstallContinue.disabled = true
  setProgressState(dom.providerBar, dom.providerIcon, 'busy')

  const ids = Array.from(state.selectedProviders)
  const firstName = providerLabel(ids[0]) || ids[0]
  dom.providerMessage.textContent = t('provider.installStatus.running', { name: firstName })

  try {
    const result = await window.setupApi.installProviders(ids)
    if (result?.ok) {
      state.providerInstallDone = true
      setProgressState(dom.providerBar, dom.providerIcon, 'ok')
      dom.providerMessage.textContent = t('provider.installStatus.allDone')
      dom.btnProviderInstallContinue.disabled = false
    } else {
      setProgressState(dom.providerBar, dom.providerIcon, 'error')
      const name = providerLabel(result?.failedAt) || result?.failedAt || '?'
      const err = result?.error || 'unknown'
      dom.providerMessage.textContent = t('provider.installStatus.error', { name, error: err })
      dom.btnProviderInstallRetry.hidden = false
    }
  } catch (error) {
    setProgressState(dom.providerBar, dom.providerIcon, 'error')
    const err = error instanceof Error ? error.message : String(error)
    dom.providerMessage.textContent = t('provider.installStatus.error', { name: '?', error: err })
    dom.btnProviderInstallRetry.hidden = false
  } finally {
    state.providerInstallBusy = false
  }
}

function providerLabel(id) {
  const opt = PROVIDER_OPTIONS.find((p) => p.id === id)
  return opt ? opt.label : null
}

window.setupApi.onProviderLog((line) => {
  dom.providerLog.textContent = line
  const match = /── Installing (.+) ──/.exec(line)
  if (match) {
    dom.providerMessage.textContent = t('provider.installStatus.running', { name: match[1] })
  }
})

// -------- Step: provider login (tmux/subscription auth) --------

dom.btnLoginBack.addEventListener('click', () => showStep(STEP_PROVIDER_CHOOSE))
dom.btnLoginContinue.addEventListener('click', () => {
  if (!dom.btnLoginContinue.disabled) enterReady()
})

function providerNeedsLoginContinue() {
  const anyUnauthed = state.authStates.some((a) => !a.authed)
  dom.btnLoginContinue.disabled = anyUnauthed
}

async function enterProviderLogin() {
  showStep(STEP_PROVIDER_LOGIN)
  await refreshAuthList()
}

async function refreshAuthList() {
  try {
    const res = await window.setupApi.getAuthStates()
    state.authStates = Array.isArray(res?.auth) ? res.auth : []
  } catch {
    state.authStates = []
  }
  renderAuthList()
  providerNeedsLoginContinue()
}

function renderAuthList() {
  const list = dom.authList
  list.innerHTML = ''
  for (const entry of state.authStates) {
    const opt = PROVIDER_OPTIONS.find((p) => p.id === entry.id)
    if (!opt) continue

    const card = document.createElement('div')
    card.className = `dep-card dep-card--compact ${entry.authed ? 'dep-card--ok' : 'dep-card--warn'}`

    const header = document.createElement('div')
    header.className = 'dep-card__header'

    const name = document.createElement('span')
    name.className = 'dep-card__name'
    name.textContent = opt.label

    const badge = document.createElement('span')
    badge.className = 'dep-card__badge'
    badge.textContent = entry.authed ? t('login.status.signedIn') : t('login.status.notSignedIn')

    header.appendChild(name)
    header.appendChild(badge)
    card.appendChild(header)

    if (!entry.authed) {
      // Provider-specific hint: Codex's loopback OAuth doesn't work
      // through the container, steer the user to the device-code flow.
      const hintKey = `login.hint.${camelId(entry.id)}`
      const hintText = t(hintKey)
      if (hintText && hintText !== hintKey) {
        const hint = document.createElement('p')
        hint.className = 'dep-card__hint'
        hint.textContent = hintText
        card.appendChild(hint)
      }

      const actions = document.createElement('div')
      actions.className = 'dep-card__actions'

      const btnOpen = document.createElement('button')
      btnOpen.className = 'btn btn--primary'
      btnOpen.textContent = t('login.action.open')
      btnOpen.addEventListener('click', () => openLoginTerminal(entry.id, opt.label))
      actions.appendChild(btnOpen)

      const btnRecheck = document.createElement('button')
      btnRecheck.className = 'btn btn--ghost'
      btnRecheck.textContent = t('login.action.recheck')
      btnRecheck.addEventListener('click', refreshAuthList)
      actions.appendChild(btnRecheck)

      card.appendChild(actions)
    }
    list.appendChild(card)
  }
}

// -------- Terminal modal (xterm + node-pty via IPC) --------

let activeTerminal = null
let activeFit = null
let activeSessionId = null
let activeUnsubData = null
let activeUnsubExit = null
let activeResizeObserver = null
let activeLastUrl = null
let activeAutoOpenedUrl = null
let activeUrlDebounceTimer = null
const URL_STABILIZE_MS = 700

const TERMINAL_URL_RE = /https?:\/\/[^\s"'<>`]+/g

function updateUrlButtons() {
  const visible = !!activeLastUrl
  dom.btnTerminalOpenUrl.hidden = !visible
  dom.btnTerminalCopyUrl.hidden = !visible
}

// Walk xterm's active buffer joining wrapped continuations seamlessly,
// so a URL that spans multiple rendered rows is a single string.
function collectBufferText(term) {
  const buf = term.buffer.active
  const parts = []
  let current = ''
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped) {
      current += text
    } else {
      if (current) parts.push(current)
      current = text
    }
  }
  if (current) parts.push(current)
  return parts.join('\n')
}

function extractLongestUrl(text) {
  const matches = text.match(TERMINAL_URL_RE)
  if (!matches || matches.length === 0) return null
  let best = matches[0]
  for (const m of matches) if (m.length > best.length) best = m
  return best.replace(/[.,:;)\]}>]+$/, '')
}

async function openLoginTerminal(providerId, displayName) {
  const Terminal = window.Terminal
  const FitAddon = window.FitAddon && window.FitAddon.FitAddon
  if (!Terminal || !FitAddon) {
    console.error('xterm not loaded')
    return
  }
  activeLastUrl = null
  updateUrlButtons()

  dom.terminalModalTitle.textContent = t('login.terminalTitle', { name: displayName })
  dom.terminalModal.hidden = false

  // Reset any previous instance.
  dom.terminalModalBody.innerHTML = ''

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    theme: {
      background: '#0e0e10',
      foreground: '#f5f5f7',
    },
    convertEol: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(dom.terminalModalBody)
  fit.fit()

  // Custom link provider: xterm's stock web-links addon only matches
  // URLs within a single rendered row, so long wrapped URLs become
  // unusable fragments. This provider uses the raw-stream URL we've
  // already tracked (activeLastUrl) and registers every line that
  // contains any part of it — click anywhere in the visible URL and
  // shell.openExternal is called with the full, intact URL.
  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const links = []
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) return callback(links)
      const text = line.translateToString(true)

      const openFull = (url) => () => {
        window.launcherApi.openExternal(url).catch(() => {})
      }

      // URL begins on this line — take the intra-line match, but if we
      // have a tracked URL that starts with it, prefer the tracked one.
      const startRe = /https?:\/\/\S+/g
      let m
      while ((m = startRe.exec(text)) !== null) {
        const hit = m[0].replace(/[.,:;)\]}>]+$/, '')
        const full = activeLastUrl && activeLastUrl.startsWith(hit) ? activeLastUrl : hit
        links.push({
          range: {
            start: { x: m.index + 1, y: bufferLineNumber },
            end: { x: m.index + m[0].length, y: bufferLineNumber },
          },
          text: full,
          activate: openFull(full),
        })
      }

      // Wrapped continuation: no scheme on this line, but it holds a
      // substring of the tracked URL. Make the whole non-whitespace
      // run on the line clickable, pointing at the full URL.
      if (links.length === 0 && activeLastUrl) {
        const stride = 20
        for (let i = 0; i + stride <= activeLastUrl.length; i += 10) {
          const seg = activeLastUrl.slice(i, i + stride)
          const idx = text.indexOf(seg)
          if (idx < 0) continue
          let sx = idx
          let ex = idx + seg.length
          while (sx > 0 && /\S/.test(text[sx - 1])) sx--
          while (ex < text.length && /\S/.test(text[ex])) ex++
          links.push({
            range: {
              start: { x: sx + 1, y: bufferLineNumber },
              end: { x: ex, y: bufferLineNumber },
            },
            text: activeLastUrl,
            activate: openFull(activeLastUrl),
          })
          break
        }
      }
      callback(links)
    },
  })

  // Intercept bare 'c' before it reaches the pty: the CLI inside the
  // container has no access to the Windows clipboard, so its "link
  // copied" message is a lie. We do the real copy on the host side
  // and still forward the key so the CLI's UI feedback stays.
  term.attachCustomKeyEventHandler((event) => {
    if (
      event.type === 'keydown' &&
      event.key === 'c' &&
      !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
      activeLastUrl
    ) {
      window.clipboardApi.write(activeLastUrl).catch(() => {})
    }
    return true
  })

  // Right-click: copy the current xterm selection to the host clipboard
  // (reliable manual fallback if auto-open / click-to-open misbehaves);
  // if nothing is selected, paste from the clipboard into the pty.
  dom.terminalModalBody.addEventListener('contextmenu', async (event) => {
    event.preventDefault()
    const selection = term.getSelection()
    if (selection && selection.length > 0) {
      try { await window.clipboardApi.write(selection) } catch { /* ignore */ }
      term.clearSelection()
      return
    }
    try {
      const text = await window.clipboardApi.read()
      if (text && activeSessionId) window.terminalApi.write(activeSessionId, text)
    } catch { /* ignore */ }
  })

  let result
  try {
    result = await window.terminalApi.start({ providerId })
  } catch (error) {
    term.writeln(`\r\n[error] ${error && error.message ? error.message : error}`)
    return
  }
  if (!result?.ok) {
    term.writeln(`\r\n[error] ${result?.error || 'failed to start'}`)
    return
  }

  activeTerminal = term
  activeFit = fit
  activeSessionId = result.sessionId

  activeUnsubData = window.terminalApi.onData(activeSessionId, (data) => {
    term.write(data, () => {
      // Scan xterm's rendered buffer on every render tick. getLine()+
      // isWrapped joins soft-wrapped URL continuations into one string.
      const text = collectBufferText(term)
      const url = extractLongestUrl(text)
      if (url && url.length >= 12 && url !== activeLastUrl) {
        activeLastUrl = url
        updateUrlButtons()
      }
      // Debounce auto-open: Ink-based TUIs (Claude Code) render URLs
      // progressively across several frames, so an early detection
      // often catches a partial URL. Reset the timer on every render
      // and only open in the browser after the buffer has been quiet
      // for a short window — by then Ink has finished its last frame
      // and the URL is complete.
      if (activeUrlDebounceTimer) clearTimeout(activeUrlDebounceTimer)
      activeUrlDebounceTimer = setTimeout(() => {
        const latest = extractLongestUrl(collectBufferText(term))
        if (latest && latest.length >= 12 && latest !== activeAutoOpenedUrl) {
          activeLastUrl = latest
          activeAutoOpenedUrl = latest
          updateUrlButtons()
          window.launcherApi.openExternal(latest).catch(() => {})
        }
      }, URL_STABILIZE_MS)
    })
  })
  activeUnsubExit = window.terminalApi.onExit(activeSessionId, (exit) => {
    const code = exit && typeof exit.exitCode === 'number' ? exit.exitCode : '?'
    term.writeln(`\r\n\x1b[90m[session closed — exit ${code}]\x1b[0m`)
    // Don't auto-close on non-zero exit so the user can read any error;
    // they must press the ✕ button. Re-check auth in the background.
    activeSessionId = null
    refreshAuthList()
  })

  term.onData((data) => window.terminalApi.write(activeSessionId, data))
  term.onResize(({ cols, rows }) => {
    if (activeSessionId) window.terminalApi.resize(activeSessionId, cols, rows)
  })

  activeResizeObserver = new ResizeObserver(() => {
    try { fit.fit() } catch { /* noop */ }
  })
  activeResizeObserver.observe(dom.terminalModalBody)
}

function closeTerminalModal({ skipKill = false } = {}) {
  if (activeResizeObserver) {
    activeResizeObserver.disconnect()
    activeResizeObserver = null
  }
  if (activeUnsubData) { activeUnsubData(); activeUnsubData = null }
  if (activeUnsubExit) { activeUnsubExit(); activeUnsubExit = null }
  if (activeSessionId && !skipKill) {
    window.terminalApi.kill(activeSessionId).catch(() => {})
  }
  activeSessionId = null
  if (activeTerminal) {
    try { activeTerminal.dispose() } catch { /* noop */ }
    activeTerminal = null
  }
  activeFit = null
  activeLastUrl = null
  activeAutoOpenedUrl = null
  if (activeUrlDebounceTimer) {
    clearTimeout(activeUrlDebounceTimer)
    activeUrlDebounceTimer = null
  }
  updateUrlButtons()
  dom.terminalModalBody.innerHTML = ''
  dom.terminalModal.hidden = true
}

dom.btnTerminalClose.addEventListener('click', () => {
  closeTerminalModal()
  refreshAuthList()
})

dom.btnTerminalDone.addEventListener('click', () => {
  closeTerminalModal()
  refreshAuthList()
})

dom.btnTerminalPaste.addEventListener('click', async () => {
  if (!activeSessionId) return
  try {
    const text = await window.clipboardApi.read()
    if (text) window.terminalApi.write(activeSessionId, text)
  } catch { /* ignore */ }
})

function freshUrlFromBuffer() {
  // Re-scan the current xterm buffer (not the cached activeLastUrl) so
  // the button always acts on the latest fully-rendered URL, even if
  // Ink emitted more frames after the debounce opened a partial one.
  if (!activeTerminal) return activeLastUrl
  return extractLongestUrl(collectBufferText(activeTerminal)) || activeLastUrl
}

dom.btnTerminalOpenUrl.addEventListener('click', () => {
  const url = freshUrlFromBuffer()
  if (url) window.launcherApi.openExternal(url).catch(() => {})
})

dom.btnTerminalCopyUrl.addEventListener('click', () => {
  const url = freshUrlFromBuffer()
  if (url) window.clipboardApi.write(url).catch(() => {})
})

// -------- Step: ready (summary) --------

async function enterReady() {
  const status = state.lastStatus || (await safeGetStatus())
  renderSummary(status)
  showStep(STEP_READY)
}

async function safeGetStatus() {
  try { return await window.setupApi.getStatus() } catch { return null }
}

function renderSummary(status) {
  const list = dom.summaryList
  list.innerHTML = ''
  const rows = []
  if (status?.docker?.state === 'ok') rows.push(t('summary.docker'))
  const wsl = status?.extra?.deps?.find((d) => d.id === 'wsl')
  if (wsl && wsl.ok) rows.push(t('summary.wsl'))
  if (status?.image?.present) rows.push(t('summary.image'))
  const authed = Array.isArray(status?.providers?.authed) ? status.providers.authed : []
  for (const id of authed) {
    const opt = PROVIDER_OPTIONS.find((p) => p.id === id)
    rows.push(t('summary.provider', { name: opt ? opt.label : id }))
  }
  for (const text of rows) {
    const li = document.createElement('li')
    li.className = 'summary-list__item'
    const icon = document.createElement('span')
    icon.className = 'summary-list__check'
    icon.textContent = '✓'
    const label = document.createElement('span')
    label.textContent = text
    li.appendChild(icon)
    li.appendChild(label)
    list.appendChild(li)
  }
}

function setProgressState(barEl, iconEl, stateName) {
  if (barEl) barEl.dataset.state = stateName
  if (iconEl) iconEl.dataset.state = stateName
}

async function startContainerPrep() {
  if (state.containerBusy) return
  state.containerBusy = true
  state.containerReady = false
  dom.containerLog.textContent = ''
  dom.btnContainerRetry.hidden = true
  dom.btnContainerContinue.disabled = true
  setProgressState(dom.containerBar, dom.containerIcon, 'busy')
  dom.containerMessage.textContent = t('container.status.pulling')

  try {
    const result = await window.setupApi.ensureContainer()
    if (result?.ok) {
      state.containerReady = true
      setProgressState(dom.containerBar, dom.containerIcon, 'ok')
      dom.containerMessage.textContent = t('container.status.ready')
      dom.btnContainerContinue.disabled = false
    } else {
      setProgressState(dom.containerBar, dom.containerIcon, 'error')
      const msg = result?.error || 'unknown'
      dom.containerMessage.textContent = t('container.status.error', { error: msg })
      dom.btnContainerRetry.hidden = false
    }
  } catch (error) {
    setProgressState(dom.containerBar, dom.containerIcon, 'error')
    const msg = error instanceof Error ? error.message : String(error)
    dom.containerMessage.textContent = t('container.status.error', { error: msg })
    dom.btnContainerRetry.hidden = false
  } finally {
    state.containerBusy = false
  }
}

window.setupApi.onInstallLog((line) => {
  if (!dom.dockerInstallLog) return
  // Append so the user sees the whole stream, not just the last line.
  // Cap at ~4000 chars to avoid runaway memory during long brew installs.
  const prev = dom.dockerInstallLog.textContent || ''
  const combined = `${prev}${line}\n`
  dom.dockerInstallLog.textContent =
    combined.length > 4000 ? combined.slice(combined.length - 4000) : combined
  dom.dockerInstallLog.scrollTop = dom.dockerInstallLog.scrollHeight
})

if (window.setupApi.onInstallStage) {
  window.setupApi.onInstallStage(({ stage, status }) => {
    setStepState(stage, status, '')
  })
}

window.setupApi.onContainerLog((line) => {
  dom.containerLog.textContent = line
  // Switch the status label heuristically when compose falls back to build.
  if (/falling back to local build/i.test(line) || /compose build/i.test(line)) {
    dom.containerMessage.textContent = t('container.status.building')
  }
})

dom.btnStartTeam.addEventListener('click', startTeam)
dom.btnOpenBrowser.addEventListener('click', () => window.launcherApi.openBrowser())
dom.btnStopTeam.addEventListener('click', stopTeam)

window.launcherApi.onPayloadLog(appendLog)

setInterval(() => {
  if (state.step === STEP_RUNNING) refreshRunningStatus()
}, 3000)

// -------- Boot --------

const stored = (() => {
  try { return localStorage.getItem(LANG_STORAGE_KEY) } catch (_) { return null }
})()

if (stored && SUPPORTED_LANGS.includes(stored)) {
  setLang(stored, { persist: false })
  showStep(STEP_WELCOME)
} else {
  setLang(DEFAULT_LANG, { persist: false })
  showStep(STEP_LANGUAGE)
}

// Paint platform-specific docker-card shape synchronously — before the
// first `setup:get-docker-status` IPC reply — so the user never sees a
// flash of the wrong-platform skeleton on boot.
if (window.platformInfo && window.platformInfo.platform) {
  applyPlatformSkeleton(window.platformInfo.platform)
}
