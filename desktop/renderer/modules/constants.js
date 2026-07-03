// Wizard step IDs (kept as strings so they match data-step attributes
// in renderer/index.html).
// Very first screen on a fresh install: big-title welcome + pitch, with
// two entry points ("Start" for new users, "Sign in" for returning ones).
export const STEP_WELCOME_INTRO = 'welcome-intro'
export const STEP_WELCOME = 'welcome'
export const STEP_LOCATION = 'location'
export const STEP_SUPABASE_LOGIN = 'supabase-login'
export const STEP_TELEGRAM_INTRO = 'telegram-intro'
// telegram-create + telegram-tokens were merged into a single step
// 2026-05-19. The unified page lives at STEP_TELEGRAM_TOKENS — name
// suggestions + username suggestions + token paste in one column.
export const STEP_TELEGRAM_TOKENS = 'telegram-tokens'
export const STEP_VPS_PROVISION = 'vps-provision'
export const STEP_SETUP = 'setup'
export const STEP_CONTAINER = 'container'
export const STEP_PROVIDER_CHOOSE = 'provider-choose'
export const STEP_PROVIDER_INSTALL = 'provider-install'
export const STEP_PROVIDER_LOGIN = 'provider-login'
// Onboarding tail (local path): pick working hours, upload the profile
// documents (CV + goals) the Assistant ingests at team start, then connect
// the dedicated team email inbox (validated round-trip before proceeding).
export const STEP_WORKING_HOURS = 'working-hours'
export const STEP_PROFILE_UPLOAD = 'profile-upload'
export const STEP_EMAIL_SETUP = 'email-setup'
export const STEP_READY = 'ready'

// User-chosen host where the team will live. Picked at onboarding,
// drives wizard branching: 'vps' surfaces the remote-server provisioning
// step (generic VPS — not tied to any specific hosting provider);
// 'local' keeps the Docker-on-this-PC path.
export const LOCATION_LOCAL = 'local'
export const LOCATION_VPS = 'vps'

export const PROVIDER_OPTIONS = [
  { id: 'claude', label: 'Claude Code', vendor: 'Anthropic · Claude Pro/Max' },
  { id: 'codex', label: 'Codex', vendor: 'OpenAI · ChatGPT Plus/Pro' },
  { id: 'kimi', label: 'Kimi', vendor: 'Moonshot · Kimi paid plan' },
]

// NB: la tabella dei piani per provider (PROVIDER_PLANS) e i benchmark dei
// modelli (MODEL_VARIANTS) sono stati rimossi dal wizard il 2026-06-23 con lo
// snellimento dell'onboarding: ora si sceglie solo il NOME del provider, il
// team distribuisce il budget su qualsiasi abbonamento. I dati storici sono
// archiviati in docs/archive/onboarding-model-comparison.md.

// Where to send the user to buy a subscription if they don't have one
// yet. Opened in the default system browser via shell.openExternal.
export const PROVIDER_SUBSCRIBE_URL = {
  claude: 'https://claude.com/pricing',
  codex: 'https://chatgpt.com/pricing',
  kimi: 'https://www.kimi.com/membership/pricing',
}
