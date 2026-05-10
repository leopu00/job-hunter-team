/**
 * JHT Setup Wizard — Main orchestration
 *
 * Flusso: prerequisiti → provider AI → auth (SecretRef) → modello →
 *         Telegram → health check → salva config.
 *
 * I path JHT sono fissi (~/.jht, ~/Documents/Job Hunter Team) e non
 * chiesti all'utente.
 *
 * Pattern copiato da OpenClaw (openclaw/src/wizard/setup.ts).
 */
import { spawnSync } from 'node:child_process';
import {
  AI_PROVIDERS,
  readConfigFileSnapshot,
  validateApiKey,
  summarizeExistingConfig,
} from './setup-helpers.js';
import {
  promptTelegram,
  promptSubscription,
  assembleAndSaveConfig,
  showSummary,
} from './setup-steps.js';
import { formatSecretForConfig } from './secret-ref.js';
import { checkPrerequisites, runHealthCheck } from './setup-checks.js';

// Mappa provider scelto nel wizard → ID accettato da `providers update`
// (i providers.js usa "claude" / "codex" / "kimi" come keys).
const PROVIDER_UPDATE_ID = {
  claude: 'claude',
  openai: 'codex',
  kimi: 'kimi',
};

// Eseguibile del CLI provider per OAuth login. Tutti partono con un comando
// che, al primo run senza credenziali, mostra il device-flow URL.
const PROVIDER_OAUTH_CMD = {
  claude: 'claude',
  openai: 'codex',
  kimi: 'kimi',
};

/**
 * Esegue un sub-comando JHT (lo stesso CLI Node, gia' in /app/cli/bin/jht.js)
 * con stdio inherited. Ritorna true se exit code = 0.
 */
function runJhtSubcommand(args, label) {
  const entry = process.env.JHT_NODE_ENTRY || '/app/cli/bin/jht.js';
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`[setup] ${label} fallito (exit ${result.status})`);
    return false;
  }
  return true;
}

/**
 * Esegue il binario provider (es. `claude`) con stdio inherited per OAuth
 * device-flow. Resta finche' l'utente non esce (Ctrl+C o /quit).
 */
function runProviderOauth(cmdName) {
  const result = spawnSync(cmdName, [], {
    stdio: 'inherit',
    env: process.env,
  });
  // Exit code variabile: claude 2.x esce 0 su /quit, !=0 su Ctrl+C.
  // Non blocchiamo il wizard sul exit code.
  return result.error ? false : true;
}

/**
 * Esegue il setup wizard JHT.
 * @param {import('./prompts.js').WizardPrompter} prompter
 */
export async function runSetupWizard(prompter) {
  await prompter.intro('Job Hunter Team — Setup');

  // --- Step 1: Prerequisiti ---
  const prereqOk = await checkPrerequisites(prompter);
  if (!prereqOk) {
    await prompter.outro('Setup annullato — prerequisiti mancanti.');
    return;
  }

  // --- Config snapshot ---
  const snapshot = readConfigFileSnapshot();
  let baseConfig = snapshot.exists && snapshot.config ? snapshot.config : {};

  if (snapshot.exists && !snapshot.config) {
    await prompter.note(
      'Il file config esiste ma non e\' valido JSON.\nVerra\' ricreato da zero.',
      'Config corrotta',
    );
    baseConfig = {};
  }

  // Modalita' di setup: sempre "quickstart". Il path "advanced" chiedeva
  // dettagli (secret-mode, session token) che non servono per la beta.
  const flow = 'quickstart';

  // --- Config esistente ---
  if (snapshot.exists && snapshot.config) {
    await prompter.note(summarizeExistingConfig(baseConfig), 'Config esistente');
    const action = await prompter.select({
      message: 'Gestione config',
      options: [
        { value: 'keep', label: 'Mantieni valori esistenti' },
        { value: 'modify', label: 'Aggiorna valori' },
        { value: 'reset', label: 'Ricomincia da zero' },
      ],
    });
    if (action === 'keep') {
      await prompter.outro('Configurazione mantenuta. Nessuna modifica.');
      return;
    }
    if (action === 'reset') baseConfig = {};
  }

  // --- Step 2: Provider AI (l'unica scelta tecnica vera del wizard) ---
  const providerChoice = await prompter.select({
    message: 'Provider AI',
    options: AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label, hint: p.hint })),
    initialValue: baseConfig.active_provider || 'claude',
  });
  const selectedProvider = AI_PROVIDERS.find((p) => p.value === providerChoice);

  // --- Auth: solo subscription, nessun input richiesto ---
  // ADR-0004: solo subscription. L'autenticazione VERA (OAuth device flow)
  // viene fatta dal CLI provider (claude/codex/kimi) in uno step successivo
  // del wizard. Qui non chiediamo niente: niente email, niente token, niente
  // browser.
  const authMethod = 'subscription';
  const apiKeySecret = undefined;
  const subscriptionConfig = undefined;

  // Modello: hardcoded al primo della lista del provider scelto. Il valore
  // serve come "default globale" del config ma OGNI agente usa il suo
  // modello (definito nel prompt agente). L'utente non deve scegliere qui.
  const model = baseConfig.providers?.[providerChoice]?.model
    || selectedProvider.models[0].value;

  // Telegram: skip nel wizard base. Si configura dopo con `jht config` se
  // serve. Per la beta vogliamo zero domande non strettamente necessarie.
  const telegramChannel = baseConfig.channels?.telegram || undefined;

  // --- Salva e riepilogo ---
  await assembleAndSaveConfig(prompter, {
    providerChoice, authMethod, apiKey: apiKeySecret, subscriptionConfig, model,
    telegramChannel, baseProviders: baseConfig.providers || {},
  });

  await showSummary(prompter, {
    selectedProvider, authMethod, apiKeySecret, subscriptionConfig,
    model, telegramChannel,
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST-CONFIG: providers update + OAuth login + team start
  // Tutti opzionali (l'utente puo' rispondere "no" e farli a mano dopo) ma
  // proposti di default per arrivare a "team che gira" in un solo wizard.
  // ────────────────────────────────────────────────────────────────────────

  // --- Step 6: install/update CLI provider nel container ---
  const updateProviderId = PROVIDER_UPDATE_ID[providerChoice];
  if (updateProviderId) {
    const wantInstall = await prompter.confirm({
      message: `Installare/aggiornare il CLI di ${selectedProvider.label} ora?`,
      initialValue: true,
    });
    if (wantInstall) {
      console.log('');
      const ok = runJhtSubcommand(['providers', 'update', updateProviderId], 'providers update');
      if (!ok) {
        const cont = await prompter.confirm({
          message: 'Installazione CLI fallita. Continuare comunque?',
          initialValue: false,
        });
        if (!cont) {
          await prompter.outro('Setup interrotto.');
          return;
        }
      }
    } else {
      await prompter.note(
        `Per installarlo dopo: jht providers update ${updateProviderId}`,
        'Installa CLI piu\' tardi',
      );
    }
  }

  // --- Step 7: istruzioni finali ---
  // Niente prompt fasulli "completato?" / "avvio?" — il wizard NON puo'
  // sapere se l'utente ha davvero fatto login OAuth in un altro terminale.
  // Diamo istruzioni chiare e usciamo. Login + team start sono 2 comandi
  // che l'utente lancia consecutivamente in un terminale dedicato.
  const oauthCmd = PROVIDER_OAUTH_CMD[providerChoice];
  await prompter.note(
    `Mancano 2 comandi, da lanciare in un altro terminale.\n\n` +
    `1. Apri un altro terminale sul tuo computer e fai SSH al VPS\n` +
    `   (stesso comando ssh che hai usato all'inizio)\n\n` +
    `2. Login al tuo account ${selectedProvider.label}:\n\n` +
    `      jht oauth-login\n\n` +
    `   Si apre la TUI di ${oauthCmd}. Apri l'URL stampato nel browser,\n` +
    `   fai login, incolla il codice, e quando vedi "authenticated"\n` +
    `   esci con /quit (o Ctrl+C due volte).\n\n` +
    `3. Avvia il team:\n\n` +
    `      jht team start\n\n` +
    `Per monitorare:\n` +
    `   jht team status\n` +
    `   jht logs --tail 30\n` +
    `Per fermare:\n` +
    `   jht team stop --all`,
    'Ultimi 2 passi (in un altro terminale)',
  );
  await prompter.outro('Setup completato.');
}
