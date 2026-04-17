// Wizard renderer: language → welcome → setup → ready → running.
// The user never sees a scrollable dump of state; each step has one job.

const STEP_LANGUAGE = 'language'
const STEP_WELCOME = 'welcome'
const STEP_SETUP = 'setup'
const STEP_CONTAINER = 'container'
const STEP_PROVIDER_CHOOSE = 'provider-choose'
const STEP_PROVIDER_INSTALL = 'provider-install'
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
      "To run the team in isolation we need <strong>Docker</strong>, free. Let's check if it's already on your computer.",
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
    'docker.action.openDesktop': 'Open Docker Desktop',
    'docker.action.check': 'Check',
    'docker.hint.ok': 'Ready.',
    'docker.hint.missing.win32': 'Install Docker Desktop and reboot your computer to activate it.',
    'docker.hint.missing.darwin': 'Install Docker Desktop, then open it once to start the runtime.',
    'docker.hint.missing.linux': 'Install Docker Engine from the official guide, then reboot or start the daemon.',
    'docker.hint.notRunning.win32': 'Docker Desktop is installed but not running. Open it to start the daemon.',
    'docker.hint.notRunning.darwin': 'Docker Desktop is installed but not running. Open it to start the daemon.',
    'docker.hint.starting': 'Docker Desktop is starting. Wait a few seconds and click Check.',
    'docker.hint.needsReboot.win32': 'Docker is installed. Reboot your computer to activate it.',
    'docker.hint.needsReboot.darwin': 'Docker is installed. Open Docker once to start the runtime.',
    'docker.hint.needsReboot.linux': 'Docker is installed. Start the daemon (systemctl start docker) or reboot.',
    'deps.wsl.name': 'WSL',
    'deps.wsl.state.ok': 'Ready',
    'deps.wsl.state.missing': 'Not installed',
    'deps.wsl.state.noDistro': 'No Linux distro',
    'deps.wsl.hint.ok': 'WSL is installed with at least one Linux distro.',
    'deps.wsl.hint.missing': 'Install WSL: open PowerShell as admin and run "wsl --install".',
    'deps.wsl.hint.noDistro': 'Install a distro: run "wsl --install -d Ubuntu" in PowerShell.',
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
      'Per far girare il team in modo isolato serve <strong>Docker</strong>, gratuito. Controlliamo se è già sul tuo computer.',
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
    'docker.action.openDesktop': 'Apri Docker Desktop',
    'docker.action.check': 'Verifica',
    'docker.hint.ok': 'Pronto.',
    'docker.hint.missing.win32': 'Installa Docker Desktop e riavvia il computer per attivarlo.',
    'docker.hint.missing.darwin': 'Installa Docker Desktop, poi aprilo una volta per avviare il runtime.',
    'docker.hint.missing.linux': 'Installa Docker Engine dalla guida ufficiale, poi riavvia o avvia il daemon.',
    'docker.hint.notRunning.win32': 'Docker Desktop è installato ma non in esecuzione. Aprilo per avviare il daemon.',
    'docker.hint.notRunning.darwin': 'Docker Desktop è installato ma non in esecuzione. Aprilo per avviare il daemon.',
    'docker.hint.starting': 'Docker Desktop sta partendo. Attendi qualche secondo e premi Verifica.',
    'docker.hint.needsReboot.win32': 'Docker è installato. Riavvia il computer per attivarlo.',
    'docker.hint.needsReboot.darwin': 'Docker è installato. Apri Docker una volta per avviare il runtime.',
    'docker.hint.needsReboot.linux': 'Docker è installato. Avvia il daemon (systemctl start docker) o riavvia.',
    'deps.wsl.name': 'WSL',
    'deps.wsl.state.ok': 'Pronto',
    'deps.wsl.state.missing': 'Non installato',
    'deps.wsl.state.noDistro': 'Nessuna distro Linux',
    'deps.wsl.hint.ok': 'WSL installato con almeno una distro Linux.',
    'deps.wsl.hint.missing': 'Installa WSL: apri PowerShell come admin ed esegui "wsl --install".',
    'deps.wsl.hint.noDistro': 'Installa una distro: esegui "wsl --install -d Ubuntu" in PowerShell.',
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
      'A csapat izolált futtatásához <strong>Docker</strong> szükséges, ingyenes. Ellenőrizzük, hogy már fent van-e a gépeden.',
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
    'docker.action.openDesktop': 'Docker Desktop megnyitása',
    'docker.action.check': 'Ellenőrzés',
    'docker.hint.ok': 'Kész.',
    'docker.hint.missing.win32': 'Telepítsd a Docker Desktopot, majd indítsd újra a gépet az aktiváláshoz.',
    'docker.hint.missing.darwin': 'Telepítsd a Docker Desktopot, majd nyisd meg egyszer a futtatókörnyezet indításához.',
    'docker.hint.missing.linux': 'Telepítsd a Docker Engine-t a hivatalos útmutatóból, majd indítsd újra vagy indítsd el a démont.',
    'docker.hint.notRunning.win32': 'A Docker Desktop telepítve van, de nem fut. Nyisd meg a démon indításához.',
    'docker.hint.notRunning.darwin': 'A Docker Desktop telepítve van, de nem fut. Nyisd meg a démon indításához.',
    'docker.hint.starting': 'A Docker Desktop indul. Várj pár másodpercet, majd kattints az Ellenőrzés gombra.',
    'docker.hint.needsReboot.win32': 'A Docker telepítve van. Indítsd újra a gépet az aktiváláshoz.',
    'docker.hint.needsReboot.darwin': 'A Docker telepítve van. Nyisd meg egyszer a Dockert a futtatókörnyezet indításához.',
    'docker.hint.needsReboot.linux': 'A Docker telepítve van. Indítsd el a démont (systemctl start docker) vagy indítsd újra a gépet.',
    'deps.wsl.name': 'WSL',
    'deps.wsl.state.ok': 'Kész',
    'deps.wsl.state.missing': 'Nincs telepítve',
    'deps.wsl.state.noDistro': 'Nincs Linux disztró',
    'deps.wsl.hint.ok': 'A WSL telepítve van, legalább egy Linux disztróval.',
    'deps.wsl.hint.missing': 'Telepítsd a WSL-t: nyiss PowerShellt rendszergazdaként és futtasd: "wsl --install".',
    'deps.wsl.hint.noDistro': 'Telepíts egy disztrót: futtasd a PowerShellben: "wsl --install -d Ubuntu".',
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
  dockerHint: document.getElementById('docker-hint'),
  dockerStats: document.getElementById('docker-stats'),
  dockerRequired: document.getElementById('docker-required'),
  dockerFree: document.getElementById('docker-free'),
  dockerActions: document.getElementById('docker-actions'),
  dockerCard: document.getElementById('docker-card'),
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

function renderDockerCard(status) {
  const check = status.check
  const card = dom.dockerCard
  card.classList.remove('dep-card--ok', 'dep-card--warn', 'dep-card--missing')

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

  dom.dockerHint.textContent = check.hintKey ? t(check.hintKey) : ''

  if (status.disk && status.disk.freeHuman) {
    dom.dockerStats.hidden = false
    dom.dockerRequired.textContent = status.disk.requiredHuman || '—'
    dom.dockerFree.textContent = status.disk.freeHuman
    if (status.disk.meetsRequirement === false) {
      dom.dockerFree.classList.add('stat__value--warn')
    } else {
      dom.dockerFree.classList.remove('stat__value--warn')
    }
  } else {
    dom.dockerStats.hidden = true
  }

  clearChildren(dom.dockerActions)

  if (check.state === 'ok') return

  if (check.state === 'missing') {
    const install = document.createElement('button')
    install.className = 'btn btn--primary'
    install.textContent = t('docker.action.install')
    install.addEventListener('click', onOpenDownloadPage)
    dom.dockerActions.appendChild(install)

    const recheck = document.createElement('button')
    recheck.className = 'btn btn--ghost'
    recheck.textContent = t('docker.action.check')
    recheck.addEventListener('click', refreshDockerStatus)
    dom.dockerActions.appendChild(recheck)
    return
  }

  if (check.state === 'not-running') {
    const openDesktop = document.createElement('button')
    openDesktop.className = 'btn btn--primary'
    openDesktop.textContent = t('docker.action.openDesktop')
    openDesktop.addEventListener('click', onOpenDockerDesktop)
    dom.dockerActions.appendChild(openDesktop)

    const recheck = document.createElement('button')
    recheck.className = 'btn btn--ghost'
    recheck.textContent = t('docker.action.check')
    recheck.addEventListener('click', refreshDockerStatus)
    dom.dockerActions.appendChild(recheck)
    return
  }

  if (check.state === 'starting' || check.state === 'needs-reboot') {
    const recheck = document.createElement('button')
    recheck.className = 'btn btn--primary'
    recheck.textContent = t('docker.action.check')
    recheck.addEventListener('click', refreshDockerStatus)
    dom.dockerActions.appendChild(recheck)
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
  showStep(STEP_SETUP)
  await refreshDockerStatus()
})

dom.btnSetupBack.addEventListener('click', () => showStep(STEP_WELCOME))

dom.btnSetupContinue.addEventListener('click', () => {
  const dockerOk = state.docker?.check.state === 'ok'
  const depsOk = !state.extraDeps || state.extraDeps.allRequiredOk !== false
  if (!dockerOk || !depsOk) return
  showStep(STEP_CONTAINER)
  startContainerPrep()
})

dom.btnContainerBack.addEventListener('click', () => {
  if (state.containerBusy) return
  showStep(STEP_SETUP)
})

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
  if (state.providerInstallDone) showStep(STEP_READY)
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
