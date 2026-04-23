// Wizard renderer: language → welcome → setup → ready → running.
// The user never sees a scrollable dump of state; each step has one job.

const STEP_LANGUAGE = 'language'
const STEP_WELCOME = 'welcome'
const STEP_SETUP = 'setup'
const STEP_CONTAINER = 'container'
const STEP_SUBSCRIPTION_NOTICE = 'subscription-notice'
const STEP_MODEL_COMPARE = 'model-compare'
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

// Subscription tiers the user can connect through each CLI. Monthly
// price, monthly tokens delivered at full saturation, $/M = price ÷
// monthly. Shown to help users pick a plan, not as a contract.
// Monthly tokens = weekly × 4 (conservative, approximates 4 full-
// saturation weeks per month).
//
// Methodology (reworked April 2026, reconciled with real-world
// measurements from ksred.com, productcompass.pm, Faros.ai, OpenAI
// community threads and kimik2ai.com):
//   - Claude Pro / Max 5×: community benchmarks converge on ~8M / 40M
//     tok/wk (=32M / 160M /mo), matching the 5× multiplier. Max 20×
//     weekly cap (intro 2025-08) compresses nominal 20× to measured
//     ~70–110M/wk (~280–440M/mo) — we use 400M/mo.
//   - Codex Plus: post-rebalance real usage is ~15–25M/wk (~60–100M/mo),
//     not the nominal 30M/wk. We use 80M/mo. Pro 5× / Pro 20× scale by
//     the stated multiplier on the new Plus baseline (400M / 1.6B /mo).
//   - Kimi Moderato: 16M/wk = 64M/mo, verified via 2048 Kimi Code
//     req/wk × ~8k tok/req. Allegretto / Allegro / Vivace: extrapolated
//     from published credit multipliers (5× / 15× / 44× Moderato) and
//     labelled "est." — no public measurements exist yet.
//
// Tokens uncached. Kimi's 75% cache discount bumps real throughput.
const PROVIDER_PLANS = {
  claude: [
    { id: 'pro',    name: 'Claude Pro',     model: 'Sonnet 4.6 · Opus 4.7',            price: '$20/mo',  priceUsd: 20,  monthlyM: 32,   monthly: '~32M tok/mo',   estimate: '~44k tok / 5h baseline' },
    { id: 'max5',   name: 'Claude Max 5×',  model: 'Sonnet 4.6 · Opus 4.7',            price: '$100/mo', priceUsd: 100, monthlyM: 160,  monthly: '~160M tok/mo',  estimate: '~88k tok / 5h · 5× Pro' },
    { id: 'max20',  name: 'Claude Max 20×', model: 'Sonnet 4.6 · Opus 4.7',            price: '$200/mo', priceUsd: 200, monthlyM: 400,  monthly: '~400M tok/mo',  estimate: 'measured ~280–440M/mo (post weekly cap)',   recommended: true, recommendedTag: 'intelligence' },
  ],
  codex: [
    { id: 'plus',   name: 'ChatGPT Plus',    model: 'GPT-5.3-Codex',                   price: '$20/mo',  priceUsd: 20,  monthlyM: 80,   monthly: '~80M tok/mo',    estimate: 'measured ~60–100M/mo (post rebalance)' },
    { id: 'pro5',   name: 'ChatGPT Pro 5×',  model: 'GPT-5.4 · GPT-5.3-Codex',         price: '$100/mo', priceUsd: 100, monthlyM: 400,  monthly: '~400M tok/mo',   estimate: '~5× Plus',                                   recommended: true, recommendedTag: 'balanced' },
    { id: 'pro20',  name: 'ChatGPT Pro 20×', model: 'GPT-5.4 · GPT-5.3-Codex-Spark',   price: '$200/mo', priceUsd: 200, monthlyM: 1600, monthly: '~1.6B tok/mo',   estimate: '~20× Plus' },
  ],
  kimi: [
    { id: 'moderato',   name: 'Moderato',   model: 'Kimi Code',                        price: '$19/mo',  priceUsd: 19,  monthlyM: 64,   monthly: '~64M tok/mo',           estimate: '2048 Kimi Code req/wk (verified)' },
    { id: 'allegretto', name: 'Allegretto', model: 'Kimi Code',                        price: '$39/mo',  priceUsd: 39,  monthlyM: 320,  monthly: '~320M tok/mo (est.)',   estimate: '5× Moderato credits (extrapolated)',     recommended: true, recommendedTag: 'affordable' },
    { id: 'allegro',    name: 'Allegro',    model: 'Kimi Code',                        price: '$99/mo',  priceUsd: 99,  monthlyM: 960,  monthly: '~960M tok/mo (est.)',   estimate: '15× Moderato credits (extrapolated)' },
    { id: 'vivace',     name: 'Vivace',     model: 'Kimi Code',                        price: '$199/mo', priceUsd: 199, monthlyM: 2800, monthly: '~2.8B tok/mo (est.)',   estimate: '44× Moderato credits (extrapolated)' },
  ],
}

// Benchmark data for the "How the models stack up" step. Five variants
// total — two Claude tiers (Opus 4.7 ceiling, Sonnet 4.6 workhorse),
// two GPT-5.3-Codex reasoning levels (high and xhigh), and Kimi Code.
// Choices:
//   - GPT-5.3-Codex, not GPT-5.4: GPT-5.4 is the generalist reasoning
//     model on ChatGPT. Codex CLI's native model is still GPT-5.3-Codex
//     (coding-specialized, stronger on SWE-bench Verified). Users who
//     pick "Codex" get GPT-5.3-Codex by default.
//   - Hiku excluded — not deep enough for Captain / Writer / Critic
//     roles in the JHT team.
//
// Sources (April 2026): Artificial Analysis (throughput), SWE-bench
// Verified leaderboard / Vals.ai (intelligence), Anthropic/OpenAI/
// Moonshot pricing pages (API cost). Kimi Code intelligence is K2.5
// proxy — K2.6 Code Preview rolled out 2026-04-13 but official
// numbers aren't published yet. GPT-5.3 xhigh numbers extrapolated
// from its "high" default (~80% SWE-bench Verified from benchlm.ai)
// applying OpenAI's documented "xhigh gains a few points for 3-5x
// more output tokens thought".
const MODEL_VARIANTS = [
  {
    providerId: 'claude',
    modelName: 'Opus 4.7',
    color: '#d97757',
    intelligence: 87.6,
    speed: 51,
    cost: 25,
  },
  {
    providerId: 'claude',
    modelName: 'Sonnet 4.6',
    color: '#e8a283',
    intelligence: 79.6,
    speed: 53,
    cost: 15,
  },
  {
    providerId: 'codex',
    modelName: 'GPT-5.3 xhigh',
    color: '#10a37f',
    intelligence: 82,
    speed: 73,
    cost: 14,
  },
  {
    providerId: 'codex',
    modelName: 'GPT-5.3 high',
    color: '#4fc49d',
    intelligence: 80,
    speed: 90,
    cost: 14,
  },
  {
    providerId: 'kimi',
    modelName: 'Kimi Code',
    color: '#7d62e8',
    intelligence: 78,
    speed: 60,
    cost: 2.5,
  },
]

// Where to send the user to buy a subscription if they don't have one
// yet. Opened in the default system browser via shell.openExternal.
const PROVIDER_SUBSCRIBE_URL = {
  claude: 'https://claude.com/pricing',
  codex: 'https://chatgpt.com/pricing',
  kimi: 'https://www.kimi.com/membership/pricing',
}

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
      'AI agents that help you land a job: match offers to your profile, tailor CVs and mentor your next move.',
    'welcome.hint':
      'First we check your computer is ready.',
    'welcome.hint.win32':
      'First we check your computer is ready. A restart may be needed to finish the WSL install.',
    'welcome.back': 'Back',
    'welcome.continue': 'Continue',
    'setup.title': 'Setup',
    'setup.lead':
      "To run the team in isolation we need <strong>a container runtime</strong>, free. Let's check if it's already on your computer.",
    'setup.lead.win32':
      "To run the team in isolation we need <strong>Docker Desktop</strong>, free. Let's check if it's already on your computer.",
    'setup.lead.darwin':
      'The team runs in an isolated container. <strong>Docker</strong> builds it, on macOS via <strong>Colima</strong>: free and active in the background.',
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
    'docker.install.gitInstallFail':
      'Git install failed. Check the log below, then try again.',
    'winReq.title': 'Required tools',
    'winReq.docker': 'Docker Desktop',
    'winReq.wsl': 'WSL2 + Ubuntu',
    'winReq.git': 'Git',
    'winSuccess.title': 'Installation complete',
    'winSuccess.body':
      'Restart your computer now to activate WSL and Git. The wizard will pick up where it left off.',
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
    'subscription.title': 'Subscriptions, not API keys',
    'subscription.lead':
      'The team keeps many AI agents running in parallel, around the clock. API keys bill per token and would cost hundreds per day. A flat subscription keeps your spend predictable.',
    'subscription.dedicatedHint':
      '<strong>Strongly recommended:</strong> use a subscription dedicated to the team, not the one you already use for work or personal tasks. A shared account drains the same weekly quota twice.',
    'subscription.compare.api': 'Pay-per-token (API)',
    'subscription.compare.apiHint': '~200–400M tokens/mo (Sonnet 4.6 mix)',
    'subscription.compare.sub': 'Claude Max 20× subscription',
    'subscription.compare.subHint': 'same usage, fixed cost',
    'subscription.compare.footnote':
      "Estimate from Anthropic's public API pricing ($3/M input · $15/M output for Sonnet 4.6) and fully-saturated 5-hour windows against the Max 20× weekly cap. Actual savings depend on your input/output mix.",
    'subscription.back': 'Back',
    'subscription.continue': 'Continue',
    'modelCompare.title': 'How the models compare',
    'modelCompare.lead':
      "Five variants that matter: Claude in two tiers (Opus 4.7 ceiling vs Sonnet 4.6 workhorse), Codex at two reasoning efforts (GPT-5.3 high vs xhigh), and Kimi Code — which has no thinking mode, so it's shown as a single bar.",
    'modelCompare.intelligence': 'Intelligence',
    'modelCompare.intelligenceUnit': 'SWE-bench Verified',
    'modelCompare.speed': 'Speed',
    'modelCompare.speedUnit': 'tokens / second',
    'modelCompare.cost': 'Affordability',
    'modelCompare.costUnit': '$ / M output tok · lower is better',
    'modelCompare.footnote':
      "Sources: SWE-bench Verified leaderboard, Artificial Analysis throughput data, vendor API pricing (April 2026). Kimi Code intelligence is estimated from K2.5 — K2.6 Preview numbers aren't published yet.",
    'modelCompare.back': 'Back',
    'modelCompare.continue': 'Continue',
    'provider.title': 'Choose your AI provider',
    'provider.lead': 'Pick one provider and mark which subscription tier you own. The team uses your active subscription, not an API key.',
    'provider.hint': 'You can pick up to 3. Login happens in the next step.',
    'provider.back': 'Back',
    'provider.continue': 'Continue',
    'provider.retry': 'Retry',
    'provider.installTitle': 'Installing CLI',
    'provider.installLead': 'Installing the selected CLI into the container. Runs once.',
    'provider.installStatus.running': 'Installing {name}…',
    'provider.installStatus.allDone': 'CLI installed.',
    'provider.installStatus.error': 'Error while installing {name}: {error}',
    'provider.recommended': 'Recommended',
    'provider.recommendedTag.intelligence': 'Most intelligent',
    'provider.recommendedTag.balanced': 'Best value',
    'provider.recommendedTag.affordable': 'Most affordable',
    'provider.noSubscription': "Don't have a subscription yet?",
    'provider.subscribeCta': 'Subscribe →',
    'login.title': 'Sign in to your providers',
    'login.lead': 'Each CLI needs your active subscription. Open Login to sign in inside the app.',
    'login.back': 'Back',
    'login.continue': 'Continue',
    'login.status.signedIn': 'Signed in',
    'login.status.notSignedIn': 'Not signed in',
    'login.action.open': 'Login',
    'login.action.openWhenAuthed': 'Open terminal',
    'login.action.recheck': 'Re-check',
    'login.action.logout': 'Log out',
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
    'ready.manageLogin': 'Manage login',
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
      'Agenti AI che ti aiutano a trovare lavoro: confrontano le offerte col tuo profilo, preparano CV su misura e ti guidano nelle scelte.',
    'welcome.hint':
      'Prima controlliamo che il tuo computer sia pronto.',
    'welcome.hint.win32':
      'Prima controlliamo che il tuo computer sia pronto. Potrebbe servire un riavvio per completare l\u2019installazione di WSL.',
    'welcome.back': 'Indietro',
    'welcome.continue': 'Continua',
    'setup.title': 'Setup',
    'setup.lead':
      'Per far girare il team in modo isolato serve <strong>un container runtime</strong>, gratuito. Controlliamo se è già sul tuo computer.',
    'setup.lead.win32':
      'Per far girare il team in modo isolato serve <strong>Docker Desktop</strong>, gratuito. Controlliamo se è già sul tuo computer.',
    'setup.lead.darwin':
      'Il team gira in un contenitore isolato. <strong>Docker</strong> lo crea, su macOS tramite <strong>Colima</strong>: gratuito e attivo in background.',
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
    'docker.install.gitInstallFail':
      'Installazione Git fallita. Controlla il log sotto e riprova.',
    'winReq.title': 'Strumenti richiesti',
    'winReq.docker': 'Docker Desktop',
    'winReq.wsl': 'WSL2 + Ubuntu',
    'winReq.git': 'Git',
    'winSuccess.title': 'Installazione completata',
    'winSuccess.body':
      'Riavvia il computer ora per attivare WSL e Git. Il wizard riprenderà da dove hai interrotto.',
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
    'subscription.title': 'Abbonamenti, non API key',
    'subscription.lead':
      'Il team fa girare molti agenti AI in parallelo, in modo continuo. Le API key si pagano a token e costerebbero centinaia di euro al giorno. Un abbonamento forfettario mantiene la spesa prevedibile.',
    'subscription.dedicatedHint':
      '<strong>Fortemente consigliato:</strong> usa un abbonamento dedicato al team, non quello che utilizzi per lavoro o uso personale. Un account condiviso consuma due volte la stessa quota settimanale.',
    'subscription.compare.api': 'Pay-per-token (API)',
    'subscription.compare.apiHint': '~200–400M token/mese (mix Sonnet 4.6)',
    'subscription.compare.sub': 'Abbonamento Claude Max 20×',
    'subscription.compare.subHint': 'stesso uso, costo fisso',
    'subscription.compare.footnote':
      'Stima dal listino API pubblico di Anthropic ($3/M input · $15/M output per Sonnet 4.6) e finestre 5 ore sature sul cap settimanale di Max 20×. Il risparmio reale dipende dal mix input/output.',
    'subscription.back': 'Indietro',
    'subscription.continue': 'Continua',
    'modelCompare.title': 'Come si comportano i modelli',
    'modelCompare.lead':
      'Cinque varianti che contano: Claude in due livelli (Opus 4.7 ceiling vs Sonnet 4.6 workhorse), Codex a due livelli di reasoning (GPT-5.3 high vs xhigh), e Kimi Code — che non ha modalità thinking, quindi una singola barra.',
    'modelCompare.intelligence': 'Intelligenza',
    'modelCompare.intelligenceUnit': 'SWE-bench Verified',
    'modelCompare.speed': 'Velocità',
    'modelCompare.speedUnit': 'token / secondo',
    'modelCompare.cost': 'Convenienza',
    'modelCompare.costUnit': '$ / M token output · più basso è meglio',
    'modelCompare.footnote':
      'Fonti: SWE-bench Verified, dati throughput di Artificial Analysis, listini API ufficiali (aprile 2026). L\'intelligenza di Kimi Code è stimata da K2.5 — i numeri di K2.6 Preview non sono ancora pubblicati.',
    'modelCompare.back': 'Indietro',
    'modelCompare.continue': 'Continua',
    'provider.title': 'Scegli il provider AI',
    'provider.lead': 'Seleziona un provider e indica il tipo di abbonamento che possiedi. Il team usa il tuo abbonamento attivo, non una API key.',
    'provider.hint': 'Puoi sceglierne fino a 3. Il login avviene nel passaggio successivo.',
    'provider.back': 'Indietro',
    'provider.continue': 'Continua',
    'provider.retry': 'Riprova',
    'provider.installTitle': 'Installazione CLI',
    'provider.installLead': 'Installo il CLI selezionato nel container. Una tantum.',
    'provider.installStatus.running': 'Installazione di {name}…',
    'provider.installStatus.allDone': 'CLI installato.',
    'provider.installStatus.error': "Errore durante l'installazione di {name}: {error}",
    'provider.recommended': 'Consigliato',
    'provider.recommendedTag.intelligence': 'Più intelligente',
    'provider.recommendedTag.balanced': 'Miglior compromesso',
    'provider.recommendedTag.affordable': 'Più economico',
    'provider.noSubscription': 'Non hai ancora un abbonamento?',
    'provider.subscribeCta': 'Abbonati →',
    'login.title': 'Accedi ai provider',
    'login.lead': "Ogni CLI richiede il tuo abbonamento attivo. Apri Login per autenticarti nell'app.",
    'login.back': 'Indietro',
    'login.continue': 'Continua',
    'login.status.signedIn': 'Autenticato',
    'login.status.notSignedIn': 'Non autenticato',
    'login.action.open': 'Login',
    'login.action.openWhenAuthed': 'Apri terminale',
    'login.action.recheck': 'Ricontrolla',
    'login.action.logout': 'Esci',
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
    'ready.manageLogin': 'Gestisci login',
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
      'AI-ügynökök segítenek állást találni: az ajánlatokat a profilodhoz illesztik, személyre szabják a CV-ket és támogatnak a döntéseidben.',
    'welcome.hint':
      'Először ellenőrizzük, hogy a gép készen áll.',
    'welcome.hint.win32':
      'Először ellenőrizzük, hogy a gép készen áll. A WSL telepítés befejezéséhez lehet, hogy újraindításra lesz szükség.',
    'welcome.back': 'Vissza',
    'welcome.continue': 'Tovább',
    'setup.title': 'Beállítás',
    'setup.lead':
      'A csapat izolált futtatásához <strong>konténer-futtatókörnyezet</strong> szükséges, ingyenes. Ellenőrizzük, hogy már fent van-e a gépeden.',
    'setup.lead.win32':
      'A csapat izolált futtatásához <strong>Docker Desktop</strong> szükséges, ingyenes. Ellenőrizzük, hogy már fent van-e a gépeden.',
    'setup.lead.darwin':
      'A csapat izolált konténerben fut. A <strong>Docker</strong> hozza létre, macOS-en <strong>Colima</strong> segítségével: ingyenes, a háttérben aktív.',
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
    'docker.install.gitInstallFail':
      'A Git telepítése nem sikerült. Nézd meg a naplót, majd próbáld újra.',
    'winReq.title': 'Szükséges eszközök',
    'winReq.docker': 'Docker Desktop',
    'winReq.wsl': 'WSL2 + Ubuntu',
    'winReq.git': 'Git',
    'winSuccess.title': 'A telepítés befejeződött',
    'winSuccess.body':
      'Indítsd újra a gépet a WSL és a Git aktiválásához. A varázsló ott folytatódik, ahol abbahagytad.',
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
    'subscription.title': 'Előfizetés, nem API kulcs',
    'subscription.lead':
      'A csapat sok AI-ügynököt futtat párhuzamosan, folyamatosan. Az API kulcsok tokenenként számláznak, ami naponta több száz eurót jelentene. Egy átalánydíjas előfizetés kiszámíthatóan tartja a költségeidet.',
    'subscription.dedicatedHint':
      '<strong>Erősen ajánlott:</strong> használj a csapatnak dedikált előfizetést, ne azt, amit munkára vagy saját célra használsz. A közös fiók kétszer fogyasztja ugyanazt a heti kvótát.',
    'subscription.compare.api': 'Tokenenkénti számlázás (API)',
    'subscription.compare.apiHint': '~200–400M token/hó (Sonnet 4.6 mix)',
    'subscription.compare.sub': 'Claude Max 20× előfizetés',
    'subscription.compare.subHint': 'ugyanaz a használat, fix költség',
    'subscription.compare.footnote':
      'Becslés az Anthropic nyilvános API-árlistája alapján ($3/M input · $15/M output Sonnet 4.6) és a Max 20× heti limitje szerint maximálisan kihasznált 5 órás ablakokkal. A tényleges megtakarítás az input/output aránytól függ.',
    'subscription.back': 'Vissza',
    'subscription.continue': 'Tovább',
    'modelCompare.title': 'Hogyan teljesítenek a modellek',
    'modelCompare.lead':
      'Öt fontos variáns: Claude két szinten (Opus 4.7 plafon vs Sonnet 4.6 munkaerő), Codex két reasoning szinten (GPT-5.3 high vs xhigh), és Kimi Code — amelynek nincs thinking módja, ezért egyetlen oszlop.',
    'modelCompare.intelligence': 'Intelligencia',
    'modelCompare.intelligenceUnit': 'SWE-bench Verified',
    'modelCompare.speed': 'Sebesség',
    'modelCompare.speedUnit': 'token / másodperc',
    'modelCompare.cost': 'Kedvező ár',
    'modelCompare.costUnit': '$ / M output token · alacsonyabb a jobb',
    'modelCompare.footnote':
      'Források: SWE-bench Verified ranglista, Artificial Analysis throughput adatok, hivatalos API-árlisták (2026. április). A Kimi Code intelligenciája K2.5 alapján becsült — a K2.6 Preview értékeit még nem publikálták.',
    'modelCompare.back': 'Vissza',
    'modelCompare.continue': 'Tovább',
    'provider.title': 'Válassz AI szolgáltatót',
    'provider.lead': 'Válassz egy szolgáltatót, és jelöld meg az előfizetésed szintjét. A csapat az aktív előfizetésedet használja, nem API kulcsot.',
    'provider.hint': 'Legfeljebb 3-at választhatsz. A bejelentkezés a következő lépésben történik.',
    'provider.back': 'Vissza',
    'provider.continue': 'Tovább',
    'provider.retry': 'Újra',
    'provider.installTitle': 'CLI telepítése',
    'provider.installLead': 'A kiválasztott CLI-t telepítem a konténerbe. Egyszeri futás.',
    'provider.installStatus.running': '{name} telepítése…',
    'provider.installStatus.allDone': 'CLI telepítve.',
    'provider.installStatus.error': 'Hiba a(z) {name} telepítésekor: {error}',
    'provider.recommended': 'Ajánlott',
    'provider.recommendedTag.intelligence': 'Legintelligensebb',
    'provider.recommendedTag.balanced': 'Legjobb ár-érték arány',
    'provider.recommendedTag.affordable': 'Leggazdaságosabb',
    'provider.noSubscription': 'Még nincs előfizetésed?',
    'provider.subscribeCta': 'Előfizetés →',
    'login.title': 'Jelentkezz be a szolgáltatókhoz',
    'login.lead': 'Minden CLI-hez aktív előfizetés kell. Nyisd meg a Belépést az alkalmazáson belül.',
    'login.back': 'Vissza',
    'login.continue': 'Tovább',
    'login.status.signedIn': 'Bejelentkezve',
    'login.status.notSignedIn': 'Nincs bejelentkezve',
    'login.action.open': 'Belépés',
    'login.action.openWhenAuthed': 'Terminál megnyitása',
    'login.action.recheck': 'Ellenőrzés',
    'login.action.logout': 'Kijelentkezés',
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
    'ready.manageLogin': 'Bejelentkezés kezelése',
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
  const platform = (window.platformInfo && window.platformInfo.platform) || null
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n')
    const html = node.getAttribute('data-i18n-html') === 'true'
    const platformAware = node.getAttribute('data-i18n-platform') === 'true'
    // If the node is marked platform-aware, prefer `<key>.<platform>`
    // and fall back to the base key. Used e.g. for welcome.hint to
    // mention the Windows-only reboot without showing it on macOS.
    let value = null
    if (platformAware && platform) {
      const specific = t(`${key}.${platform}`)
      if (specific && specific !== `${key}.${platform}`) value = specific
    }
    if (value === null) value = t(key)
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
  selectedProvider: null,
  selectedPlan: null,
  providerInstallBusy: false,
  providerInstallDone: false,
  authStates: [],
  // When the user opens provider-login from the ready screen's "Manage
  // login" button, we set this to STEP_READY so back/continue bounce
  // them back to ready instead of walking them through the wizard.
  loginOrigin: null,
  lastStatus: null,
  // Windows-only: true while we're polling docker status after the user
  // clicked "Open Docker Desktop". Drives the Docker row to a spinner
  // state and hides the "Install everything" button to avoid confusion.
  winDockerStarting: false,
}

const dom = {
  steps: document.querySelectorAll('.step'),
  btnWelcomeBack: document.getElementById('btn-welcome-back'),
  btnWelcomeContinue: document.getElementById('btn-welcome-continue'),
  devModeActions: document.getElementById('dev-mode-actions'),
  btnDevMode: document.getElementById('btn-dev-mode'),
  btnSetupBack: document.getElementById('btn-setup-back'),
  btnSetupContinue: document.getElementById('btn-setup-continue'),
  btnStartTeam: document.getElementById('btn-start-team'),
  btnOpenBrowser: document.getElementById('btn-open-browser'),
  btnStopTeam: document.getElementById('btn-stop-team'),
  dockerBadge: document.getElementById('docker-badge'),
  dockerActions: document.getElementById('docker-actions'),
  dockerCard: document.getElementById('docker-card'),
  winRequirements: document.getElementById('win-requirements'),
  winStepDocker: document.getElementById('win-step-docker'),
  winStepDockerAction: document.getElementById('win-step-docker-action'),
  winStepWsl: document.getElementById('win-step-wsl'),
  winStepGit: document.getElementById('win-step-git'),
  winInstallActions: document.getElementById('win-install-actions'),
  btnWinInstallEverything: document.getElementById('btn-win-install-everything'),
  winInstallLog: document.getElementById('win-install-log'),
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
  btnSubscriptionBack: document.getElementById('btn-subscription-back'),
  btnSubscriptionContinue: document.getElementById('btn-subscription-continue'),
  modelCharts: document.getElementById('model-charts'),
  btnModelCompareBack: document.getElementById('btn-model-compare-back'),
  btnModelCompareContinue: document.getElementById('btn-model-compare-continue'),
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
  btnReadyManageLogin: document.getElementById('btn-ready-manage-login'),
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
function showIf(el, visible) {
  if (!el) return
  el.hidden = !visible
  el.style.display = visible ? '' : 'none'
}

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
    showIf(dom.dockerSteps, platform === 'darwin')
  }
  // Windows gets a unified Docker/WSL/Git checklist that REPLACES the
  // docker card + extra-deps cards above it. Swap them now so the first
  // paint already has the right layout — avoids an FOUC of the darwin
  // shape being visible while we wait for the setup:get-docker-status
  // IPC reply.
  const isWin = platform === 'win32'
  showIf(dom.dockerCard, !isWin)
  showIf(dom.extraDeps, !isWin)
  showIf(dom.winRequirements, isWin)
  showIf(dom.winInstallActions, isWin)
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
    // "Not-running" = Homebrew + Colima are already installed, the
    // daemon is just stopped. Labelling this "Installa tutto" (Install
    // everything) is misleading — nothing is actually being installed,
    // we just need to fire `colima start`. Use "Avvia runtime" instead.
    // The handler is the same install.js pipeline, which is idempotent
    // and turns into a pure `colima start` when the binaries are there.
    const install = document.createElement('button')
    install.className = 'btn btn--primary'
    install.textContent = check.state === 'not-running'
      ? t('docker.action.startColima')
      : t('docker.action.installAll')
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

function winStepState(ok) { return ok ? 'ok' : 'pending' }

// On Windows we render one unified checklist (Docker / WSL / Git)
// instead of the darwin docker-card + extra-deps split. Each row's icon
// flips to the ok state as soon as the matching dep reports ready; the
// Docker row is the only one with an inline per-item action (Download),
// because Docker Desktop install stays a manual step. WSL and Git ride
// the shared "Install everything" button below.
function renderWindowsRequirements(status, extra) {
  const check = status && status.check
  const dockerOk = check && check.state === 'ok'
  const dockerMissing = !check || check.state === 'missing'
  const deps = (extra && Array.isArray(extra.deps)) ? extra.deps : []
  const wslDep = deps.find((d) => d.id === 'wsl')
  const gitDep = deps.find((d) => d.id === 'git')
  const wslOk = !!(wslDep && wslDep.ok)
  const gitOk = !!(gitDep && gitDep.ok)

  // Docker row visual state has 3 possibilities:
  //   'ok'      — daemon responsive
  //   'busy'    — user just clicked "Open Docker Desktop"; we're polling
  //   'pending' — not ok and not currently starting
  let dockerVisualState = 'pending'
  if (dockerOk) dockerVisualState = 'ok'
  else if (state.winDockerStarting) dockerVisualState = 'busy'
  if (dom.winStepDocker) dom.winStepDocker.setAttribute('data-state', dockerVisualState)
  if (dom.winStepWsl) dom.winStepWsl.setAttribute('data-state', winStepState(wslOk))
  if (dom.winStepGit) dom.winStepGit.setAttribute('data-state', winStepState(gitOk))

  // Docker row action depends on the precise state:
  //   missing          → "Install Docker" (opens the download page)
  //   not-running (idle) → "Start Docker Desktop"
  //   starting (polling) → nothing — the spinner icon tells the story,
  //                        a button here would make the user think they
  //                        need to click something again
  clearChildren(dom.winStepDockerAction)
  if (dockerMissing) {
    const download = document.createElement('button')
    download.className = 'btn btn--ghost btn--compact'
    download.textContent = t('docker.action.install')
    download.addEventListener('click', onOpenDownloadPage)
    dom.winStepDockerAction.appendChild(download)
  } else if (!dockerOk && !state.winDockerStarting) {
    const start = document.createElement('button')
    start.className = 'btn btn--ghost btn--compact'
    start.textContent = t('docker.action.openDesktop')
    start.addEventListener('click', onOpenDockerDesktopAndPoll)
    dom.winStepDockerAction.appendChild(start)
  }

  // "Install everything" only when at least one automatable item (WSL
  // or Git) is actually missing AND we are not currently in the middle
  // of the Docker-starting flow. Otherwise the button appearing while
  // Docker boots is pure noise: the user is waiting on Docker, not on
  // a new WSL/Git run.
  const automatablePending = (!wslOk || !gitOk) && !state.winDockerStarting
  showIf(dom.winInstallActions, automatablePending)
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
    const platform = (status && status.platform)
      || (window.platformInfo && window.platformInfo.platform)
    if (platform === 'win32') {
      renderWindowsRequirements(status, extra)
    } else {
      renderDockerCard(status)
      renderExtraDeps(extra)
    }
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

function winShowLog(text) {
  if (!dom.winInstallLog) return
  dom.winInstallLog.textContent = text
  showIf(dom.winInstallLog, true)
}

function markWinStepsAllOk() {
  // Force the checklist rows to the 'ok' visual state. Necessary because
  // the Electron process cached its PATH at startup — even though Git
  // was just installed successfully, `git --version` from Node would
  // still fail until the process is restarted (which happens at reboot).
  // We trust the installer's exit code here; the post-reboot `getExtraDeps`
  // re-check will either confirm or correct each row.
  for (const id of ['win-step-docker', 'win-step-wsl', 'win-step-git']) {
    const el = document.getElementById(id)
    if (el) el.setAttribute('data-state', 'ok')
  }
  if (dom.winStepDockerAction) clearChildren(dom.winStepDockerAction)
}

function showWinSuccessBanner() {
  if (!dom.winInstallActions) return
  clearChildren(dom.winInstallActions)
  // Big prominent green card instead of a small "Restart now" button
  // tucked under a log. The user explicitly asked for this — "avvisarlo
  // meglio che deve riavviare il computer".
  const banner = document.createElement('div')
  banner.className = 'win-success'
  banner.innerHTML =
    '<div class="win-success__title">' +
    t('winSuccess.title') + '</div>' +
    '<div class="win-success__body">' +
    t('winSuccess.body') + '</div>'
  const btn = document.createElement('button')
  btn.className = 'btn btn--primary btn--large'
  btn.textContent = t('docker.action.restartNow')
  btn.addEventListener('click', onRebootNow)
  banner.appendChild(btn)
  dom.winInstallActions.appendChild(banner)
  showIf(dom.winInstallActions, true)
  showIf(dom.winInstallLog, false)
}

async function onInstallWindowsStack() {
  setBusy(true)
  winShowLog(t('docker.install.windowsRunning'))
  try {
    const result = await window.setupApi.installWindowsStack()
    if (result?.ok && result.rebootRequired) {
      markWinStepsAllOk()
      showWinSuccessBanner()
      return
    }
    const stage = result?.stage || 'unknown'
    const errMsg = result?.error || 'installer failed'
    const hintKey =
      stage === 'wsl-install' ? 'docker.install.wslInstallFail' :
      stage === 'git-install' ? 'docker.install.gitInstallFail' :
      stage === 'aborted' ? 'docker.install.aborted' :
      null
    winShowLog(hintKey ? `${t(hintKey)}\n\n${errMsg}` : errMsg)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    winShowLog(msg)
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

// Dedicated handler for the Windows checklist: open Docker Desktop
// (launches the installed app that wasn't running yet), then poll the
// docker status every 3s for up to 90s. The engine typically needs
// 20-60s to come up on a cold boot; auto-polling means the Docker row
// flips to green without the user having to click anything else.
let winDockerPollTimer = null
async function onOpenDockerDesktopAndPoll() {
  if (state.winDockerStarting) return // already starting
  state.winDockerStarting = true
  // Re-render immediately so the Docker row flips to the busy spinner
  // and the "Install everything" button hides — before we wait on the
  // openDockerDesktop IPC.
  if (state.docker) renderWindowsRequirements(state.docker, state.extraDeps)
  await onOpenDockerDesktop()
  if (winDockerPollTimer) return
  let tries = 0
  const MAX_TRIES = 30 // 30 × 3s = 90s
  const finish = () => {
    clearInterval(winDockerPollTimer)
    winDockerPollTimer = null
    state.winDockerStarting = false
    if (state.docker) renderWindowsRequirements(state.docker, state.extraDeps)
  }
  winDockerPollTimer = setInterval(async () => {
    tries += 1
    try {
      await refreshDockerStatus()
      const ok = state.docker && state.docker.check && state.docker.check.state === 'ok'
      if (ok || tries >= MAX_TRIES) finish()
    } catch (_) { /* keep polling */ }
  }, 3000)
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

// Dev-mode shortcut: visibile solo quando Electron gira da sorgente.
// Probe async all'avvio; se disponibile, mostra il pulsante accanto al
// "Continue" della welcome. Click → dev:launch (compose + host Next :3001
// + open browser). Vedi main.js IPC 'dev:launch' e scripts/dev-up.sh.
;(async () => {
  try {
    if (!window.launcherApi?.devIsAvailable) return
    const probe = await window.launcherApi.devIsAvailable()
    if (!probe?.available || !dom.devModeActions || !dom.btnDevMode) return
    dom.devModeActions.hidden = false
    dom.btnDevMode.addEventListener('click', async () => {
      const original = dom.btnDevMode.textContent
      dom.btnDevMode.disabled = true
      dom.btnDevMode.textContent = '⏳ Avvio in corso…'
      // Reset del bottone (testo + disabled) dopo `ms`. Serve perche'
      // senza reset il bottone resta bloccato sul messaggio di stato
      // e l'utente non puo' ri-cliccare per fare restart (scenario
      // tipico: cambio a una branch di dev, voglio re-spawnare container).
      const resetAfter = (ms) => setTimeout(() => {
        dom.btnDevMode.textContent = original
        dom.btnDevMode.disabled = false
      }, ms)
      try {
        const res = await window.launcherApi.devLaunch()
        if (!res?.ok) {
          dom.btnDevMode.textContent = `✗ ${res?.error || 'errore sconosciuto'}`
          resetAfter(5000)
          return
        }
        dom.btnDevMode.textContent = res.ready
          ? '✓ Pronto — browser aperto su :3001 (click per restart)'
          : '⚠ Partito ma non ancora pronto (apri :3001 manualmente)'
        resetAfter(6000)
      } catch (err) {
        dom.btnDevMode.textContent = `✗ ${err?.message || err}`
        resetAfter(5000)
      }
    })
  } catch {
    // probe fallito → prod o Electron vecchio senza l'IPC: lascia nascosto
  }
})()

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

if (dom.btnWinInstallEverything) {
  dom.btnWinInstallEverything.addEventListener('click', onInstallWindowsStack)
}

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
    showStep(STEP_SUBSCRIPTION_NOTICE)
  }
})

dom.btnSubscriptionBack.addEventListener('click', () => {
  showStep(STEP_CONTAINER)
})

dom.btnSubscriptionContinue.addEventListener('click', () => {
  enterModelCompare()
})

function enterModelCompare() {
  renderModelCharts()
  showStep(STEP_MODEL_COMPARE)
}

dom.btnModelCompareBack.addEventListener('click', () => {
  showStep(STEP_SUBSCRIPTION_NOTICE)
})

dom.btnModelCompareContinue.addEventListener('click', () => {
  enterProviderChoose()
})

// Render 3 bar charts (intelligence / speed / cost), each with one
// bar per model variant in MODEL_VARIANTS. Bar height is normalized
// to the chart's max; for cost we invert so lower $ becomes the
// taller "affordability" bar.
function renderModelCharts() {
  const root = dom.modelCharts
  if (!root) return
  clearChildren(root)

  const metrics = [
    { key: 'intelligence', titleKey: 'modelCompare.intelligence', unitKey: 'modelCompare.intelligenceUnit', higherIsBetter: true,  format: (v) => `${v.toFixed(1)}%` },
    { key: 'speed',        titleKey: 'modelCompare.speed',        unitKey: 'modelCompare.speedUnit',        higherIsBetter: true,  format: (v) => `${v} t/s` },
    { key: 'cost',         titleKey: 'modelCompare.cost',         unitKey: 'modelCompare.costUnit',         higherIsBetter: false, format: (v) => `$${v}` },
  ]

  for (const metric of metrics) {
    const values = MODEL_VARIANTS.map((m) => m[metric.key])
    const max = Math.max(...values)
    const min = Math.min(...values)

    const chart = document.createElement('div')
    chart.className = 'model-chart'

    const header = document.createElement('div')
    header.className = 'model-chart__header'
    const title = document.createElement('span')
    title.className = 'model-chart__title'
    title.setAttribute('data-i18n', metric.titleKey)
    title.textContent = t(metric.titleKey)
    const unit = document.createElement('span')
    unit.className = 'model-chart__unit'
    unit.setAttribute('data-i18n', metric.unitKey)
    unit.textContent = t(metric.unitKey)
    header.appendChild(title)
    header.appendChild(unit)
    chart.appendChild(header)

    const barsRow = document.createElement('div')
    barsRow.className = 'model-chart__bars'
    barsRow.style.gridTemplateColumns = `repeat(${MODEL_VARIANTS.length}, 1fr)`

    let previousProviderId = null
    for (const model of MODEL_VARIANTS) {
      const value = model[metric.key]
      // Normalize to 8–100% so the smallest bar isn't invisible.
      let pct
      if (metric.higherIsBetter) {
        pct = max > 0 ? Math.max(8, Math.round((value / max) * 100)) : 8
      } else {
        pct = max > 0 ? Math.max(8, Math.round((min / value) * 100)) : 8
      }
      const isWinner = metric.higherIsBetter ? value === max : value === min

      const bar = document.createElement('div')
      bar.className = 'model-bar'
      if (isWinner) bar.classList.add('model-bar--winner')
      // Visual separator between providers so the user reads Claude /
      // Codex / Kimi as distinct groups inside a single chart.
      if (previousProviderId && previousProviderId !== model.providerId) {
        bar.classList.add('model-bar--group-start')
      }
      previousProviderId = model.providerId

      const valueLabel = document.createElement('div')
      valueLabel.className = 'model-bar__value'
      valueLabel.textContent = metric.format(value)

      const track = document.createElement('div')
      track.className = 'model-bar__track'
      const fill = document.createElement('div')
      fill.className = 'model-bar__fill'
      fill.style.height = `${pct}%`
      fill.style.background = model.color
      track.appendChild(fill)

      // Split name into a primary line + sub line so "GPT-5.3 xhigh"
      // renders as two tidy lines instead of breaking mid-token.
      const nameLabel = document.createElement('div')
      nameLabel.className = 'model-bar__name'
      const firstSpace = model.modelName.indexOf(' ')
      if (firstSpace > 0) {
        const primary = document.createElement('span')
        primary.textContent = model.modelName.slice(0, firstSpace)
        const sub = document.createElement('span')
        sub.className = 'model-bar__name-sub'
        sub.textContent = model.modelName.slice(firstSpace + 1)
        nameLabel.appendChild(primary)
        nameLabel.appendChild(sub)
      } else {
        nameLabel.textContent = model.modelName
      }

      bar.appendChild(valueLabel)
      bar.appendChild(track)
      bar.appendChild(nameLabel)
      barsRow.appendChild(bar)
    }

    chart.appendChild(barsRow)
    root.appendChild(chart)
  }
}

async function enterProviderChoose() {
  showStep(STEP_PROVIDER_CHOOSE)
  // Restore any previously saved single-provider selection (with plan
  // tier). Legacy multi-select state is still populated from getProviders
  // for the rest of the wizard's logic that expects an array.
  try {
    const sel = window.setupApi.getSelection
      ? await window.setupApi.getSelection()
      : { provider: null, plan: null }
    state.selectedProvider = sel && sel.provider ? sel.provider : null
    state.selectedPlan = sel && sel.plan ? sel.plan : null
    state.selectedProviders = new Set(state.selectedProvider ? [state.selectedProvider] : [])
  } catch {
    // no-op: missing selection is fine
  }
  renderProviderOptions()
}

function updateProviderContinueState() {
  dom.btnProviderContinue.disabled = !(state.selectedProvider && state.selectedPlan)
}

function renderProviderOptions() {
  const container = dom.providerOptions
  container.innerHTML = ''
  for (const opt of PROVIDER_OPTIONS) {
    const providerRadioId = `prov-${opt.id}`
    const row = document.createElement('label')
    row.className = 'provider-option'
    row.htmlFor = providerRadioId

    // Single-select: only one provider active at a time.
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'provider-select'
    radio.id = providerRadioId
    radio.value = opt.id
    radio.checked = state.selectedProvider === opt.id
    radio.addEventListener('change', () => {
      if (!radio.checked) return
      state.selectedProvider = opt.id
      // Clear the plan when the provider changes — the tier options
      // are provider-specific and re-rendering will repaint them.
      state.selectedPlan = null
      state.selectedProviders = new Set([opt.id])
      renderProviderOptions()
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

    const plans = PROVIDER_PLANS[opt.id] || []
    const isProviderSelected = state.selectedProvider === opt.id

    if (plans.length > 0) {
      // Subscription plan table: one COLUMN per tier. Header row holds
      // the radio that lets the user mark which subscription they own
      // — only enabled once this provider is selected. The selected
      // tier is saved so the runtime sentinel can size context windows
      // against the user's actual quota later on.
      const table = document.createElement('table')
      table.className = 'plans-table'

      // Helper: stamp the same `plans-table__col--recommended` class on
      // every cell in the recommended tier's column so we can highlight
      // it vertically.
      const colClass = (p) => (p.recommended ? ' plans-table__col--recommended' : '')

      const thead = document.createElement('thead')
      const trHead = document.createElement('tr')
      for (const p of plans) {
        const th = document.createElement('th')
        th.className = `plans-table__header${colClass(p)}`
        const planRadio = document.createElement('input')
        planRadio.type = 'radio'
        planRadio.name = `plan-select-${opt.id}`
        planRadio.className = 'plans-table__radio'
        planRadio.value = p.id
        planRadio.checked = isProviderSelected && state.selectedPlan === p.id
        planRadio.disabled = !isProviderSelected
        planRadio.addEventListener('change', () => {
          if (!planRadio.checked) return
          state.selectedProvider = opt.id
          state.selectedPlan = p.id
          state.selectedProviders = new Set([opt.id])
          renderProviderOptions()
        })
        const label = document.createElement('label')
        label.className = 'plans-table__header-label'
        label.appendChild(planRadio)
        const nameSpan = document.createElement('span')
        nameSpan.textContent = p.name
        label.appendChild(nameSpan)
        th.appendChild(label)
        if (p.recommended) {
          const badge = document.createElement('span')
          badge.className = 'plans-table__badge'
          badge.textContent = t('provider.recommended')
          th.appendChild(badge)
          if (p.recommendedTag) {
            const tag = document.createElement('span')
            tag.className = 'plans-table__badge-tag'
            tag.textContent = t(`provider.recommendedTag.${p.recommendedTag}`)
            th.appendChild(tag)
          }
        }
        trHead.appendChild(th)
      }
      thead.appendChild(trHead)
      table.appendChild(thead)

      const cell = (plan, text, extraClass) => {
        const td = document.createElement('td')
        td.className = `${extraClass || ''}${colClass(plan)}`.trim()
        td.textContent = text
        return td
      }

      const tbody = document.createElement('tbody')
      const trModel = document.createElement('tr')
      trModel.className = 'plans-table__model-row'
      for (const p of plans) trModel.appendChild(cell(p, p.model || '—'))

      const trPrice = document.createElement('tr')
      trPrice.className = 'plans-table__price-row'
      for (const p of plans) trPrice.appendChild(cell(p, p.price))

      const trWeekly = document.createElement('tr')
      trWeekly.className = 'plans-table__weekly-row'
      for (const p of plans) trWeekly.appendChild(cell(p, p.monthly || '—'))

      // "$/M" row: monthly price ÷ monthly token allowance. Simple
      // rule of thumb — "$100/mo buys you 400M tokens ≈ $0.25/M".
      const trUnit = document.createElement('tr')
      trUnit.className = 'plans-table__unit-row'
      for (const p of plans) {
        let text = '—'
        if (typeof p.priceUsd === 'number' && typeof p.monthlyM === 'number' && p.monthlyM > 0) {
          const per = p.priceUsd / p.monthlyM
          text = `~$${per.toFixed(2)}/M tok`
        }
        trUnit.appendChild(cell(p, text))
      }

      const trEst = document.createElement('tr')
      trEst.className = 'plans-table__estimate-row'
      for (const p of plans) trEst.appendChild(cell(p, p.estimate))

      tbody.appendChild(trModel)
      tbody.appendChild(trPrice)
      tbody.appendChild(trWeekly)
      tbody.appendChild(trUnit)
      tbody.appendChild(trEst)
      table.appendChild(tbody)
      body.appendChild(table)
    }

    // "Don't have a subscription yet?" link — opens the provider's
    // pricing page in the default browser. Always visible, so users
    // can subscribe on the spot before coming back to mark the tier.
    const subscribeUrl = PROVIDER_SUBSCRIBE_URL[opt.id]
    if (subscribeUrl) {
      const hint = document.createElement('p')
      hint.className = 'provider-option__subscribe-hint'
      const text = document.createElement('span')
      text.textContent = t('provider.noSubscription') + ' '
      const link = document.createElement('a')
      link.href = '#'
      link.className = 'provider-option__subscribe-link'
      link.textContent = t('provider.subscribeCta')
      link.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        window.launcherApi.openExternal(subscribeUrl).catch(() => {})
      })
      hint.appendChild(text)
      hint.appendChild(link)
      body.appendChild(hint)
    }

    row.appendChild(radio)
    row.appendChild(body)
    if (isProviderSelected) row.classList.add('provider-option--active')
    container.appendChild(row)
  }
  updateProviderContinueState()
}

dom.btnProviderBack.addEventListener('click', () => {
  enterModelCompare()
})

dom.btnProviderContinue.addEventListener('click', async () => {
  if (!state.selectedProvider || !state.selectedPlan) return
  // Persist the single-provider + plan selection. The plan value is
  // informational; the CLI picks up the actual account entitlements
  // from its own login. We save regardless of install success so the
  // sentinel can still read the intended plan later.
  try {
    await window.setupApi.saveSelection({
      provider: state.selectedProvider,
      plan: state.selectedPlan,
    })
  } catch { /* best-effort, not critical for the install flow */ }
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

dom.btnLoginBack.addEventListener('click', () => {
  // If the user opened provider-login from the "Manage login" button
  // on the ready screen, back should bounce them to ready, not send
  // them back through the wizard.
  if (state.loginOrigin === STEP_READY) {
    state.loginOrigin = null
    enterReady()
  } else {
    showStep(STEP_PROVIDER_CHOOSE)
  }
})
dom.btnLoginContinue.addEventListener('click', () => {
  if (dom.btnLoginContinue.disabled) return
  state.loginOrigin = null
  enterReady()
})

if (dom.btnReadyManageLogin) {
  dom.btnReadyManageLogin.addEventListener('click', () => {
    state.loginOrigin = STEP_READY
    enterProviderLogin()
  })
}

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
    } else {
      // Signed-in state: let the user log out / switch account. Wipes
      // the CLI's credential files on the host bind-mount; the next
      // login flow re-populates them from scratch.
      const actions = document.createElement('div')
      actions.className = 'dep-card__actions'

      // Even when we detect the user as authenticated, keep the
      // terminal door open — Kimi needs /login inside the TUI even
      // after the auth file exists (partial session), and users
      // may want to re-run /login to switch account or troubleshoot.
      const btnOpen = document.createElement('button')
      btnOpen.className = 'btn btn--ghost'
      btnOpen.textContent = t('login.action.openWhenAuthed')
      btnOpen.addEventListener('click', () => openLoginTerminal(entry.id, opt.label))
      actions.appendChild(btnOpen)

      const btnLogout = document.createElement('button')
      btnLogout.className = 'btn btn--ghost'
      btnLogout.textContent = t('login.action.logout')
      btnLogout.addEventListener('click', async () => {
        btnLogout.disabled = true
        try {
          await window.setupApi.logoutProvider(entry.id)
        } finally {
          btnLogout.disabled = false
          await refreshAuthList()
        }
      })
      actions.appendChild(btnLogout)

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
let activeUrlDebounceTimer = null
// Raw unfiltered pty stream (ANSI stripped) — ground truth for URL
// detection. xterm's rendered buffer sometimes chops long URLs when the
// TUI uses cursor-positioning escape sequences; the raw stream has
// whatever the CLI actually wrote, wrap-free.
let activeRawStream = ''
const URL_STABILIZE_MS = 700
const RAW_STREAM_MAX = 80 * 1024

const TERMINAL_URL_RE = /https?:\/\/[^\s"'<>`]+/g
// Strip ANSI CSI (color/cursor) sequences before URL extraction.
const ANSI_CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

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

// Pane-capture style URL extraction, mirroring what a user would do
// reading the terminal screen: dump every visible row as flat text,
// find the row that contains "https://", scan forward until the row
// that starts the CLI's prompt ("Paste code here if prompted"), then
// glue all those rows together dropping every whitespace character.
// Works regardless of xterm soft-wrap flags, cursor repositioning,
// or ANSI frames — whatever is on the screen is what we capture.
const URL_END_MARKER_RE = /paste\s+(the\s+)?code\s+(here|below)|paste\s+code\b|^\s*>\s*$/i

function extractUrlViaPaneCapture(term) {
  if (!term || !term.buffer || !term.buffer.active) return null
  const buf = term.buffer.active
  const rows = []
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (!line) continue
    rows.push(line.translateToString(true))
  }
  let startIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (/https?:\/\//i.test(rows[i])) { startIdx = i; break }
  }
  if (startIdx < 0) return null

  let endIdx = rows.length
  for (let i = startIdx; i < rows.length; i++) {
    // Skip the very first row — it carries the scheme itself and
    // would false-match if the CLI wrote hints on the same line.
    if (i === startIdx) continue
    if (URL_END_MARKER_RE.test(rows[i])) { endIdx = i; break }
  }

  // Join without separators and strip every whitespace run. URLs never
  // contain whitespace, so collapsing is safe; soft-wrap artefacts
  // (padding spaces, leading indents) disappear.
  const joined = rows.slice(startIdx, endIdx).join('').replace(/\s+/g, '')
  const m = joined.match(/https?:\/\/[^\s"'<>`]+/i)
  if (!m) return null
  return m[0].replace(/[.,:;)\]}>]+$/, '')
}

async function openLoginTerminal(providerId, displayName) {
  const Terminal = window.Terminal
  const FitAddon = window.FitAddon && window.FitAddon.FitAddon
  if (!Terminal || !FitAddon) {
    console.error('xterm not loaded')
    return
  }
  activeLastUrl = null
  activeRawStream = ''
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
    // Accumulate the raw pty stream too, independent of xterm rendering.
    // URL detection on the raw stream is bulletproof against wrap/chop
    // issues caused by cursor-positioning escape sequences.
    activeRawStream += data
    if (activeRawStream.length > RAW_STREAM_MAX) {
      activeRawStream = activeRawStream.slice(-RAW_STREAM_MAX / 2)
    }
    term.write(data, () => {
      // Prefer the raw stream (ANSI stripped) — falls back to xterm's
      // reassembled buffer only if the raw scan misses.
      const rawText = activeRawStream.replace(ANSI_CSI_RE, '')
      const url =
        extractLongestUrl(rawText) ||
        extractLongestUrl(collectBufferText(term))
      if (url && url.length >= 12 && url !== activeLastUrl) {
        activeLastUrl = url
        updateUrlButtons()
      }
      // Debounced refresh of the cached URL (keeps the Open URL button
      // enabled with the latest detection). We deliberately do NOT
      // auto-open the browser here: Ink-based TUIs render the URL
      // progressively, and an early catch can open a truncated URL.
      // The Open URL button re-extracts from the pane on click, which
      // is the only reliable path — let the user drive it.
      if (activeUrlDebounceTimer) clearTimeout(activeUrlDebounceTimer)
      activeUrlDebounceTimer = setTimeout(() => {
        const latest =
          (activeTerminal && extractUrlViaPaneCapture(activeTerminal)) ||
          extractLongestUrl(activeRawStream.replace(ANSI_CSI_RE, '')) ||
          extractLongestUrl(collectBufferText(term))
        if (latest && latest.length >= 12 && latest !== activeLastUrl) {
          activeLastUrl = latest
          updateUrlButtons()
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
  activeRawStream = ''
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
  // 1) Pane-capture of the visible terminal screen — the authoritative
  //    source because it is exactly what the user sees. Glues rows
  //    together dropping whitespace; uses the "Paste code here"-style
  //    row as the end marker, so nothing past the URL leaks in.
  if (activeTerminal) {
    const fromPane = extractUrlViaPaneCapture(activeTerminal)
    if (fromPane) return fromPane
  }
  // 2) Raw pty stream (ANSI stripped) — helps when the URL has scrolled
  //    off-screen.
  const rawUrl = activeRawStream
    ? extractLongestUrl(activeRawStream.replace(ANSI_CSI_RE, ''))
    : null
  if (rawUrl) return rawUrl
  // 3) Fall back to the cached value if nothing is live.
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

function appendSummaryRow(list, text, { logoutProviderId } = {}) {
  const li = document.createElement('li')
  li.className = 'summary-list__item'
  const icon = document.createElement('span')
  icon.className = 'summary-list__check'
  icon.textContent = '✓'
  const label = document.createElement('span')
  label.className = 'summary-list__label'
  label.textContent = text
  li.appendChild(icon)
  li.appendChild(label)
  if (logoutProviderId) {
    // Provider rows on the "All set" screen need a logout escape hatch
    // so the user can switch accounts without re-entering the wizard
    // from scratch. The button wipes the CLI's credential files on the
    // host bind-mount and re-renders the summary.
    const btn = document.createElement('button')
    btn.className = 'btn btn--ghost btn--small summary-list__action'
    btn.textContent = t('login.action.logout')
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        await window.setupApi.logoutProvider(logoutProviderId)
      } finally {
        btn.disabled = false
        const status = await safeGetStatus()
        renderSummary(status)
      }
    })
    li.appendChild(btn)
  }
  list.appendChild(li)
}

function renderSummary(status) {
  const list = dom.summaryList
  list.innerHTML = ''
  if (status?.docker?.state === 'ok') appendSummaryRow(list, t('summary.docker'))
  const wsl = status?.extra?.deps?.find((d) => d.id === 'wsl')
  if (wsl && wsl.ok) appendSummaryRow(list, t('summary.wsl'))
  if (status?.image?.present) appendSummaryRow(list, t('summary.image'))
  const authed = Array.isArray(status?.providers?.authed) ? status.providers.authed : []
  for (const id of authed) {
    const opt = PROVIDER_OPTIONS.find((p) => p.id === id)
    appendSummaryRow(
      list,
      t('summary.provider', { name: opt ? opt.label : id }),
      { logoutProviderId: id },
    )
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
  // Route the stream to whichever log panel is actually mounted for the
  // current platform (darwin → dockerInstallLog inside the docker card,
  // win32 → winInstallLog below the unified checklist).
  const target = (window.platformInfo && window.platformInfo.platform === 'win32')
    ? dom.winInstallLog : dom.dockerInstallLog
  if (!target) return
  const prev = target.textContent || ''
  const combined = `${prev}${line}\n`
  // Cap at ~4000 chars to avoid runaway memory during long installs.
  target.textContent =
    combined.length > 4000 ? combined.slice(combined.length - 4000) : combined
  target.scrollTop = target.scrollHeight
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
