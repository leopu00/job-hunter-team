import { STEP_WELCOME } from './constants.js'

// Mutable global state. Shared across modules via the live ESM binding
// of the `state` object (mutations are visible everywhere).
export const state = {
  step: STEP_WELCOME,
  docker: null,
  extraDeps: null,
  // macOS container-runtime choice from setup:get-container-runtime:
  // { choice: 'auto'|'colima'|'docker-desktop', choices, detected }. null until loaded.
  containerRuntime: null,
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
  // Entry point picked on the welcome-intro screen: 'start' (new user) or
  // 'signin' (returning user). 'signin' turns the Supabase step into
  // required-login mode (skip hidden, "welcome back" copy); the rest of
  // the flow is identical, so no screen reordering / no risk of a double
  // Supabase step.
  onboardingIntent: 'start',
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
  btnIntroStart: document.getElementById('btn-intro-start'),
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
  // Telegram intro step
  tgIntroLink: document.getElementById('tg-intro-link'),
  btnTgIntroBack: document.getElementById('btn-tg-intro-back'),
  btnTgIntroContinue: document.getElementById('btn-tg-intro-continue'),
  btnTgIntroSkip: document.getElementById('btn-tg-intro-skip'),
  // Telegram tokens step (unified — used to be split create+tokens).
  // Meta rows ("Insert this name / username") are injected by
  // wizard-flow.js into the per-role #tg-meta-<role> slot inside the
  // existing token rows.
  tgCreateUsertag: document.getElementById('tg-create-usertag'),
  tgCreateOpenBotfather: document.getElementById('tg-create-open-botfather'),
  btnVpsGenerateKey: document.getElementById('btn-vps-generate-key'),
  vpsStep2: document.getElementById('vps-step2'),
  vpsStep3: document.getElementById('vps-step3'),
  vpsPubkey: document.getElementById('vps-pubkey'),
  btnVpsCopyPubkey: document.getElementById('btn-vps-copy-pubkey'),
  btnVpsOpenKeyFolder: document.getElementById('btn-vps-open-key-folder'),
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
  dockerBadge: document.getElementById('docker-badge'),
  dockerActions: document.getElementById('docker-actions'),
  dockerCard: document.getElementById('docker-card'),
  runtimeChooser: document.getElementById('runtime-chooser'),
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
  // Onboarding tail (local): working hours + profile upload.
  hoursModeWindow: document.getElementById('hours-mode-window'),
  hoursModeAlways: document.getElementById('hours-mode-always'),
  hoursWindowFields: document.getElementById('hours-window-fields'),
  hoursDays: document.getElementById('hours-days'),
  hoursStart: document.getElementById('hours-start'),
  hoursEnd: document.getElementById('hours-end'),
  hoursTz: document.getElementById('hours-tz'),
  hoursStatus: document.getElementById('hours-status'),
  btnHoursBack: document.getElementById('btn-hours-back'),
  btnHoursContinue: document.getElementById('btn-hours-continue'),
  btnUploadPick: document.getElementById('btn-upload-pick'),
  uploadList: document.getElementById('upload-list'),
  uploadEmpty: document.getElementById('upload-empty'),
  btnUploadBack: document.getElementById('btn-upload-back'),
  btnUploadContinue: document.getElementById('btn-upload-continue'),
  emailAddressInput: document.getElementById('email-address'),
  emailPasswordInput: document.getElementById('email-password'),
  emailDedicatedConfirm: document.getElementById('email-dedicated-confirm'),
  btnEmailVerify: document.getElementById('btn-email-verify'),
  btnEmail2fa: document.getElementById('btn-email-2fa'),
  btnEmailAppPw: document.getElementById('btn-email-app-pw'),
  btnEmailDocs: document.getElementById('btn-email-docs'),
  emailSetupStatus: document.getElementById('email-status'),
  btnEmailBack: document.getElementById('btn-email-back'),
  btnEmailSkip: document.getElementById('btn-email-skip'),
  btnEmailContinue: document.getElementById('btn-email-continue'),
  summaryList: document.getElementById('summary-list'),
  terminalModal: document.getElementById('terminal-modal'),
  terminalModalTitle: document.getElementById('terminal-modal-title'),
  terminalModalBody: document.getElementById('terminal-modal-body'),
  btnTerminalClose: document.getElementById('terminal-modal-close'),
  btnTerminalDone: document.getElementById('terminal-modal-done'),
  btnTerminalPaste: document.getElementById('terminal-modal-paste'),
  btnTerminalOpenUrl: document.getElementById('terminal-modal-open-url'),
  btnTerminalCopyUrl: document.getElementById('terminal-modal-copy-url'),
  readyHint: document.getElementById('ready-hint'),
}

export function showStep(name) {
  // Guard against navigating to a step that doesn't exist in the DOM (typo,
  // renamed data-step, refactor). Without this the loop below would hide
  // EVERY section → a blank white screen with no way out. Log and bail so
  // the current screen stays put instead.
  const target = [...dom.steps].find((s) => s.dataset.step === name)
  if (!target) {
    try {
      window.jhtLog?.scope?.('renderer')?.error?.('showStep.unknown', { name, current: state.step })
    } catch { /* logger assente */ }
    return
  }
  state.step = name
  for (const section of dom.steps) {
    section.hidden = section.dataset.step !== name
  }
}

// Sink di log legacy. Storicamente scriveva nel <pre> "Technical details"
// dello step running (rimosso col dashboard-split). Il <pre> non esiste più,
// quindi instradiamo SEMPRE anche su window.jhtLog: senza, gli errori che
// passavano da appendLog (es. il probe di boot che fa cadere sul wizard)
// sparivano silenziosamente. Resta null-safe sul <pre> per compatibilità.
export function appendLog(line) {
  if (!line) return
  if (dom.advancedLog) dom.advancedLog.textContent += `${line}\n`
  try {
    window.jhtLog?.scope?.('renderer')?.info?.('appendLog', { line: String(line) })
  } catch { /* logger assente: no-op */ }
}
