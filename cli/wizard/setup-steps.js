/**
 * JHT Setup Wizard — Step Telegram, subscription, salvataggio, riepilogo
 * I path JHT sono fissi (~/.jht, ~/Documents/Job Hunter Team), non chiesti.
 */
import {
  JHT_CONFIG_PATH,
  JHT_CONFIG_DIR,
  writeConfigFile,
  validateEmail,
} from './setup-helpers.js';
import { describeSecret } from './secret-ref.js';
import { hasBrowserSupport } from '../src/auth/browser-open.js';
import { startSubscriptionLogin } from '../src/auth/subscription-login.js';
import { t } from './i18n.js';

/**
 * Setup Telegram CONSIGLIATO ma OPZIONALE (direction shift "interaction
 * planes", 2026-06-16). Il pairing appartiene al comando host: il wizard
 * dentro jht non raccoglie token e non puo' inoltrarli al servizio isolato.
 */
export async function promptTelegramOptional(prompter) {
  const wants = await prompter.confirm({
    message:
      'Show the host commands for Telegram pairing? Recommended for ' +
      'notifications and chat away from the desktop.',
    initialValue: true,
  });
  if (!wants) {
    await prompter.note(
      'Telegram skipped. The team remains available from the desktop ' +
      '(dashboard and chat). To add Telegram later, run ' +
      '`jht telegram pair <assistente|capitano|mentor>` on the host.',
      'Optional Telegram — skipped',
    );
    return;
  }
  await prompter.note(
    'Create or rotate each bot in BotFather, then run these commands in a host terminal:\n\n' +
    '  jht telegram pair assistente\n' +
    '  jht telegram pair capitano\n' +
    '  jht telegram pair mentor\n\n' +
    'Each command reads bot_token and chat_id from JSON on stdin. If this machine had a legacy token, generate a new token first: reusing it is refused with rotation_required.\n\n' +
    'Check the result with: jht telegram status',
    'Telegram pairing runs on the host',
  );
}
/**
 * Step working-hours: chiede all'utente come distribuire il budget weekly
 * sulle ore di lavoro. 5 preset + skip ("configura dopo"). Lo step è
 * non-bloccante: skip lascia il team in 24/7 (default storico).
 *
 * Ritorna `WorkingHoursConfig | null`: null = 24/7 (campo non presente nel
 * config), oggetto = team.working_hours da salvare.
 *
 * Smart skip: se baseConfig.team.working_hours esiste già (es. l'utente
 * sta rifacendo il setup) → mostra come default il preset attuale ma
 * permette di cambiarlo. Per "keep as-is" basta scegliere lo stesso.
 */
export async function promptWorkingHours(prompter, currentWorkingHours) {
  const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const PRESETS = {
    office:  { days: ['mon','tue','wed','thu','fri'], start: '09:00', end: '18:00' },
    weekend: { days: ['sat','sun'],                   start: '09:00', end: '18:00' },
    daytime: { days: ALL_DAYS,                        start: '09:00', end: '18:00' },
    night:   { days: ALL_DAYS,                        start: '22:00', end: '07:00' },
  };
  function detectCurrentPreset() {
    // Default proposto = 9h daytime 7/7 (decisione utente 2026-06-19), non piu'
    // 24/7. Chi vuole il team sempre attivo sceglie esplicitamente 'always'.
    if (!currentWorkingHours?.windows?.length) return 'daytime';
    if (currentWorkingHours.windows.length !== 1) return 'custom_later';
    const w = currentWorkingHours.windows[0];
    for (const [key, p] of Object.entries(PRESETS)) {
      if (p.start === w.start && p.end === w.end &&
          p.days.length === w.days.length &&
          p.days.every(d => w.days.includes(d))) return key;
    }
    return 'custom_later';
  }
  function detectLocalTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  }

  const choice = await prompter.select({
    message: t('wizard.workhours.prompt'),
    initialValue: detectCurrentPreset(),
    options: [
      { value: 'office',         label: t('wizard.workhours.office'),        hint: t('wizard.workhours.hint') },
      { value: 'weekend',        label: t('wizard.workhours.weekend') },
      { value: 'daytime',        label: t('wizard.workhours.daytime') },
      { value: 'night',          label: t('wizard.workhours.night') },
      { value: 'always',         label: t('wizard.workhours.always') },
      { value: 'custom_later',   label: t('wizard.workhours.custom_later') },
    ],
  });

  if (choice === 'always') return null;
  if (choice === 'custom_later') return currentWorkingHours ?? null;  // no-op
  const preset = PRESETS[choice];
  if (!preset) return currentWorkingHours ?? null;
  return {
    timezone: currentWorkingHours?.timezone || detectLocalTz(),
    windows: [{ days: preset.days, start: preset.start, end: preset.end }],
  };
}

export async function assembleAndSaveConfig(prompter, params) {
  const { providerChoice, authMethod, apiKey, subscriptionConfig, model,
          baseProviders, workingHours } = params;

  const progress = prompter.progress('Saving configuration...');

  const providerConfig = { name: providerChoice, auth_method: authMethod };
  if (authMethod === 'api_key' && apiKey) {
    // SecretRef: salva l'oggetto intero o estrai il plaintext per retrocompatibilita'
    if (typeof apiKey === 'object' && apiKey.type === 'plaintext') {
      providerConfig.api_key = apiKey.value;
    } else if (typeof apiKey === 'object') {
      providerConfig.api_key_ref = apiKey; // SecretRef nel config
    } else {
      providerConfig.api_key = apiKey;
    }
  }
  if (authMethod === 'subscription' && subscriptionConfig) {
    providerConfig.subscription = subscriptionConfig;
  }
  providerConfig.model = model;

  const config = {
    version: 1,
    active_provider: providerChoice,
    providers: { ...baseProviders, [providerChoice]: providerConfig },
    channels: {},
  };

  // Working hours: presenti solo se l'utente ha scelto un preset (no 24/7).
  // Quando assenti il team gira 24/7 (default storico).
  if (workingHours) {
    config.team = config.team || {};
    config.team.working_hours = workingHours;
  }

  writeConfigFile(config);
  progress.stop('Configuration saved!');
  return config;
}

/**
 * Mostra riepilogo finale.
 */
export async function showSummary(prompter, params) {
  const { selectedProvider } = params;

  // Riepilogo minimo: il wizard chiede solo il provider, tutto il resto
  // (modello per-agente, autenticazione tramite OAuth CLI) e' implicito.
  const summary = [
    `Provider:   ${selectedProvider.label}`,
    'Auth:       OAuth (sign-in follows later in this wizard)',
    '',
    `Config:     ${JHT_CONFIG_PATH}`,
    `JHT home:   ${JHT_CONFIG_DIR}`,
  ].join('\n');

  await prompter.note(summary, 'Summary');
  // L'outro finale viene emesso dal wizard chiamante (setup.js) DOPO gli step
  // post-config (providers update / OAuth / team start). Qui non chiudiamo il
  // flow perche' c'e' altro da chiedere.
}

/**
 * Prompt subscription.
 *
 * Storia: avevamo due path (browser OAuth jht-internal + manuale email/token).
 * Il browser path puntava a `claude.ai/authorize?client_id=jht-claude` che
 * NON esiste su claude.ai (404 Page not found). Era un OAuth abbozzato mai
 * implementato server-side. Rimosso 2026-05-10.
 *
 * Il login OAuth vero (device flow del CLI provider, es. `claude` di
 * @anthropic-ai/claude-code) viene fatto in un step separato del wizard
 * principale: l'utente apre un nuovo terminale e lancia `jht oauth-login`.
 * Qui chiediamo solo l'email del suo account, salvata nel config per
 * tracciabilita' (non usata per autenticarsi).
 */
export async function promptSubscription(prompter, selectedProvider, flow) {
  return promptManualSubscription(prompter, flow);
}

/**
 * Prompt manuale per subscription: email + session token opzionale.
 */
async function promptManualSubscription(prompter, flow) {
  await prompter.note('Enter your account\'s email.', 'Manual subscription');
  const email = await prompter.text({
    message: 'Email account', placeholder: 'user@example.com', validate: validateEmail,
  });
  const wantsToken = flow === 'advanced'
    ? await prompter.confirm({ message: 'Do you have a session token?', initialValue: false })
    : false;
  let sessionToken;
  if (wantsToken) {
    sessionToken = await prompter.text({ message: 'Session token', placeholder: 'Paste the token...' });
    sessionToken = sessionToken?.trim() || undefined;
  }
  const config = { email: email.trim() };
  if (sessionToken) config.session_token = sessionToken;
  return config;
}
