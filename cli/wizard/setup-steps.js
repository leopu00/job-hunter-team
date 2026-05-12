/**
 * JHT Setup Wizard — Step Telegram, subscription, salvataggio, riepilogo
 * I path JHT sono fissi (~/.jht, ~/Documents/Job Hunter Team), non chiesti.
 */
import https from 'node:https';
import {
  JHT_CONFIG_PATH,
  JHT_CONFIG_DIR,
  writeConfigFile,
  validateTelegramToken,
  validateChatId,
  validateEmail,
} from './setup-helpers.js';
import { describeSecret } from './secret-ref.js';
import { hasBrowserSupport } from '../src/auth/browser-open.js';
import { startSubscriptionLogin } from '../src/auth/subscription-login.js';

// ─── Telegram Bot API helpers ──────────────────────────────────────────
// In-line fetch wrapper: niente dipendenze extra (axios/grammy), niente
// global fetch nei vecchi Node. Tutto urllib-equivalente con https + Promise.

function tgFetchJson(token, method, params = {}, timeoutMs = 30000) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `https://api.telegram.org/bot${token}/${method}${qs ? `?${qs}` : ''}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function tgGetBotUsername(token) {
  const r = await tgFetchJson(token, 'getMe', {}, 10000);
  if (!r.ok) throw new Error(r.description || 'getMe failed');
  return r.result.username; // senza @
}

/**
 * Poll getUpdates finche' un utente scrive al bot, restituendo il suo
 * chat_id (numero). Skippa il backlog: parte dall'update_id corrente +1.
 * Timeout: 15 min totali. Long-poll Telegram con timeout=20s per round.
 */
async function tgWaitForFirstChat(token, deadlineMs) {
  // Reset offset al massimo update_id esistente, cosi' un backlog di
  // messaggi vecchi (es. utente curioso che ha gia' scritto al bot in
  // sviluppo) non ci da' un chat_id stantio.
  let offset = 0;
  try {
    const init = await tgFetchJson(token, 'getUpdates', { offset: -1, timeout: 0 }, 8000);
    if (init.ok && init.result.length > 0) {
      offset = init.result[init.result.length - 1].update_id;
    }
  } catch { /* fallback: parti da 0 */ }

  while (Date.now() < deadlineMs) {
    try {
      const r = await tgFetchJson(
        token, 'getUpdates',
        { offset: offset + 1, timeout: 20 },
        30000,
      );
      if (r.ok && r.result.length > 0) {
        for (const u of r.result) {
          const chat = u.message?.chat || u.edited_message?.chat;
          if (chat?.id) return chat.id;
        }
        offset = r.result[r.result.length - 1].update_id;
      }
    } catch { /* network glitch: ritenta */ }
  }
  return null;
}

/**
 * Step Telegram OBBLIGATORIO (per VPS).
 *
 * Niente prompt "vuoi configurarlo?": chiediamo direttamente token + chat_id.
 * L'utente DEVE fornire entrambi per uscire dal wizard. Per VPS, Telegram e'
 * l'unica via di interazione mobile col team senza SSH.
 */
export async function promptTelegramRequired(prompter, baseChannels) {
  const existing = baseChannels?.telegram || undefined;

  await prompter.note(
    'Telegram e\' obbligatorio: e\' la tua via di interazione col team\n' +
    'dal telefono (senza SSH).\n\n' +
    'Come ottenere il token:\n' +
    '  1. Apri Telegram → cerca @BotFather → scrivi /newbot\n' +
    '  2. Segui le istruzioni (nome + username che finisce in "bot")\n' +
    '  3. BotFather risponde con un token tipo "123456789:ABC..."',
    'Setup Telegram (obbligatorio)',
  );

  const botToken = await prompter.text({
    message: 'Token del bot Telegram',
    placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    initialValue: existing?.bot_token,
    validate: (v) => {
      if (!v || v.trim().length === 0) return 'Token obbligatorio';
      return validateTelegramToken(v);
    },
  });
  const token = botToken.trim();

  // ── Risoluzione username + cattura chat_id automatica ────────────────
  // Sostituiamo lo step manuale "@userinfobot" con un flow attivo:
  //   1. getMe → ricaviamo l'@username del bot
  //   2. mostriamo deep-link `https://t.me/<username>?start=ok`
  //   3. polling getUpdates → cattura il primo chat_id in inbound
  //
  // Bonus: l'utente DEVE aver fatto /start prima di proseguire, quindi
  // il primo `jht-telegram-send` post-wizard non sbattera' contro l'errore
  // "Bad Request: chat not found" (vedi root cause 2026-05-12).
  let botUsername = null;
  const probe = prompter.progress('Verifico il bot...');
  try {
    botUsername = await tgGetBotUsername(token);
    probe.stop(`Bot riconosciuto: @${botUsername}`);
  } catch (e) {
    probe.stop(`Errore: ${e.message}`);
    throw new Error(`Token Telegram non valido o rete irraggiungibile: ${e.message}`);
  }

  const deepLink = `https://t.me/${botUsername}?start=jht`;
  await prompter.note(
    'Adesso apri il tuo bot e premi Start:\n\n' +
    `  ${deepLink}\n\n` +
    '(Tap sul link dal telefono, o cerca @' + botUsername + ' su Telegram\n' +
    'e premi "Start" / scrivi /start.)\n\n' +
    'Sto monitorando il bot: appena ti vedo arrivare proseguo da solo.',
    'Avvia la chat col bot',
  );

  const waitSpinner = prompter.progress('In attesa del tuo /start...');
  const deadline = Date.now() + 15 * 60 * 1000; // 15 min
  const chatId = await tgWaitForFirstChat(token, deadline);
  if (!chatId) {
    waitSpinner.stop('Timeout (15 min): nessun messaggio dal bot.');
    throw new Error(
      'Non ho ricevuto un /start dal tuo bot. Rilancia: jht setup',
    );
  }
  waitSpinner.stop(`Chat rilevata: ${chatId}`);

  return { bot_token: token, chat_id: String(chatId) };
}

/**
 * Step Telegram: chiede bot token e chat ID (opzionale).
 */
export async function promptTelegram(prompter, baseChannels) {
  let telegramChannel = baseChannels?.telegram || undefined;

  const setupTelegram = await prompter.confirm({
    message: 'Configurare bot Telegram per le notifiche?',
    initialValue: Boolean(telegramChannel?.bot_token),
  });

  if (!setupTelegram) return undefined;

  await prompter.note(
    'Crea un bot con @BotFather su Telegram e copia il token.\nFormato: 123456789:ABCdefGHI...',
    'Telegram Bot',
  );

  const botToken = await prompter.text({
    message: 'Token del bot Telegram',
    placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    initialValue: telegramChannel?.bot_token,
    validate: validateTelegramToken,
  });

  const chatId = await prompter.text({
    message: 'Chat ID (opzionale)',
    placeholder: '123456789',
    initialValue: telegramChannel?.chat_id,
    validate: validateChatId,
  });

  telegramChannel = { bot_token: botToken.trim() };
  if (chatId && chatId.trim().length > 0) {
    telegramChannel.chat_id = chatId.trim();
  }
  return telegramChannel;
}

/**
 * Assembla e salva la config finale conforme a shared/config/ schema.
 * apiKey puo' essere un SecretInput (oggetto) o una stringa plaintext legacy.
 */
export async function assembleAndSaveConfig(prompter, params) {
  const { providerChoice, authMethod, apiKey, subscriptionConfig, model,
          telegramChannel, baseProviders } = params;

  const progress = prompter.progress('Salvataggio configurazione...');

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

  if (telegramChannel) config.channels.telegram = telegramChannel;

  writeConfigFile(config);
  progress.stop('Configurazione salvata!');
  return config;
}

/**
 * Mostra riepilogo finale.
 */
export async function showSummary(prompter, params) {
  const { selectedProvider, authMethod, apiKeySecret, subscriptionConfig,
          model, telegramChannel } = params;

  // Riepilogo minimo: il wizard chiede solo il provider, tutto il resto
  // (modello per-agente, autenticazione tramite OAuth CLI) e' implicito.
  const summary = [
    `Provider:   ${selectedProvider.label}`,
    `Auth:       OAuth (lo fai nel prossimo step)`,
    '',
    `Config:     ${JHT_CONFIG_PATH}`,
    `JHT home:   ${JHT_CONFIG_DIR}`,
  ].join('\n');

  await prompter.note(summary, 'Riepilogo');
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
  await prompter.note('Inserisci l\'email del tuo account.', 'Subscription manuale');
  const email = await prompter.text({
    message: 'Email account', placeholder: 'utente@esempio.com', validate: validateEmail,
  });
  const wantsToken = flow === 'advanced'
    ? await prompter.confirm({ message: 'Hai un session token?', initialValue: false })
    : false;
  let sessionToken;
  if (wantsToken) {
    sessionToken = await prompter.text({ message: 'Session token', placeholder: 'incolla il token...' });
    sessionToken = sessionToken?.trim() || undefined;
  }
  const config = { email: email.trim() };
  if (sessionToken) config.session_token = sessionToken;
  return config;
}
