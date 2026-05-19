import { STEP_WELCOME } from './constants.js'

// Mutable global state. Shared across modules via the live ESM binding
// of the `state` object (mutations are visible everywhere).
export const state = {
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
  // Where the team will run: 'local' (Docker on this PC) or 'vps'
  // (remote Hetzner host). Set at the location step, persisted via
  // prefsApi so a relaunch resumes on the right branch.
  location: null,
  // Supabase OAuth session for cloud sync + VPS pairing. Mirrored
  // here for the renderer to read synchronously after each authApi
  // call. null = not signed in.
  supabaseUser: null,
  // VPS provisioning state. null = key not generated yet; otherwise
  // pubkey is the OpenSSH single-line public key shown to the user.
  // installed = true after the remote install.sh run succeeds.
  vps: {
    pubkey: null,
    ip: null,
    installed: false,
    busy: false,
  },
  // Telegram bot tokens collected in the VPS path. The actual per-role
  // shape is populated lazily by telegram-tokens.js (one entry per
  // assistente/capitano/mentor, each with token/botUsername/chatId/
  // status/error). Kept null at boot so a stray Local-PC run doesn't
  // hold a wide object that never gets used.
  telegram: null,
  telegramSaveBusy: false,
  telegramSaveError: null,
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
  // Which top-level screen is showing: 'wizard' (first-run flow) or
  // 'home' (post-setup dashboard with sidebar). Set by showWizard /
  // showHome; drives which UI the polling timers refresh.
  view: 'wizard',
  homeSection: 'team',
}

// DOM references resolved once at module load. The renderer.js entry
// point imports this module after DOMContentLoaded-equivalent (the
// <script type="module"> tag is deferred by default, so the document
// body is fully parsed before this runs).
export const dom = {
  steps: document.querySelectorAll('.step'),
  btnWelcomeBack: document.getElementById('btn-welcome-back'),
  btnWelcomeContinue: document.getElementById('btn-welcome-continue'),
  locationCardLocal: document.getElementById('location-card-local'),
  locationCardVps: document.getElementById('location-card-vps'),
  btnLocationBack: document.getElementById('btn-location-back'),
  btnLocationContinue: document.getElementById('btn-location-continue'),
  supabaseStatus: document.getElementById('supabase-status'),
  supabaseHint: document.getElementById('supabase-hint'),
  btnSupabaseGoogle: document.getElementById('btn-supabase-google'),
  btnSupabaseGithub: document.getElementById('btn-supabase-github'),
  btnSupabaseSignout: document.getElementById('btn-supabase-signout'),
  btnSupabaseBack: document.getElementById('btn-supabase-back'),
  btnSupabaseContinue: document.getElementById('btn-supabase-continue'),
  btnSupabaseSkip: document.getElementById('btn-supabase-skip'),
  supabaseSigninProgress: document.getElementById('supabase-signin-progress'),
  supabaseSigninHint: document.getElementById('supabase-signin-hint'),
  supabaseSigninUrlRow: document.getElementById('supabase-signin-url-row'),
  supabaseSigninUrl: document.getElementById('supabase-signin-url'),
  btnSupabaseCopyUrl: document.getElementById('btn-supabase-copy-url'),
  btnSupabaseCancel: document.getElementById('btn-supabase-cancel'),
  // Telegram intro / create steps
  tgIntroLink: document.getElementById('tg-intro-link'),
  btnTgIntroBack: document.getElementById('btn-tg-intro-back'),
  btnTgIntroContinue: document.getElementById('btn-tg-intro-continue'),
  tgCreateUsertag: document.getElementById('tg-create-usertag'),
  tgCreateRows: document.getElementById('tg-create-rows'),
  tgCreateOpenBotfather: document.getElementById('tg-create-open-botfather'),
  btnTgCreateBack: document.getElementById('btn-tg-create-back'),
  btnTgCreateContinue: document.getElementById('btn-tg-create-continue'),
  btnVpsGenerateKey: document.getElementById('btn-vps-generate-key'),
  vpsStep2: document.getElementById('vps-step2'),
  vpsStep3: document.getElementById('vps-step3'),
  vpsPubkey: document.getElementById('vps-pubkey'),
  btnVpsCopyPubkey: document.getElementById('btn-vps-copy-pubkey'),
  btnVpsOpenHetzner: document.getElementById('btn-vps-open-hetzner'),
  vpsIp: document.getElementById('vps-ip'),
  btnVpsConnect: document.getElementById('btn-vps-connect'),
  vpsStatus: document.getElementById('vps-status'),
  vpsInstallLog: document.getElementById('vps-install-log'),
  btnVpsBack: document.getElementById('btn-vps-back'),
  btnVpsContinue: document.getElementById('btn-vps-continue'),
  btnTelegramBack: document.getElementById('btn-tg-back'),
  btnTelegramContinue: document.getElementById('btn-tg-continue'),
  telegramSaveStatus: document.getElementById('tg-save-status'),
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

export function showStep(name) {
  state.step = name
  for (const section of dom.steps) {
    section.hidden = section.dataset.step !== name
  }
}

export function appendLog(line) {
  if (!line) return
  dom.advancedLog.textContent += `${line}\n`
}
