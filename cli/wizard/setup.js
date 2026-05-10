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
  minimax: 'kimi',
};

// Eseguibile del CLI provider per OAuth login. Tutti partono con un comando
// che, al primo run senza credenziali, mostra il device-flow URL.
const PROVIDER_OAUTH_CMD = {
  claude: 'claude',
  openai: 'codex',
  minimax: 'kimi',
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

  // --- Setup mode ---
  const flow = await prompter.select({
    message: 'Modalita\' di setup',
    options: [
      { value: 'quickstart', label: 'QuickStart', hint: 'configurazione rapida — consigliato' },
      { value: 'advanced', label: 'Avanzato', hint: 'configura ogni dettaglio' },
    ],
    initialValue: 'quickstart',
  });

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

  // --- Step 2: Provider AI ---
  const providerChoice = await prompter.select({
    message: 'Provider AI',
    options: AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label, hint: p.hint })),
    initialValue: baseConfig.active_provider || 'claude',
  });
  const selectedProvider = AI_PROVIDERS.find((p) => p.value === providerChoice);

  // --- Auth method ---
  const authMethod = await prompter.select({
    message: 'Metodo di autenticazione',
    options: [
      { value: 'api_key', label: 'API Key', hint: 'inserisci la tua chiave API — consigliato' },
      { value: 'subscription', label: 'Subscription', hint: 'login con email e sessione' },
    ],
    initialValue: baseConfig.providers?.[providerChoice]?.auth_method || 'api_key',
  });

  // --- Step 3: Credenziali con SecretRef ---
  let apiKeySecret;
  let subscriptionConfig;

  if (authMethod === 'api_key') {
    // Chiedi come salvare la key (SecretRef pattern)
    const secretMode = flow === 'advanced'
      ? await prompter.select({
          message: 'Come salvare la API key?',
          options: [
            { value: 'env', label: 'Variabile d\'ambiente', hint: 'consigliato — niente plaintext nel config' },
            { value: 'plaintext', label: 'Nel file config', hint: 'piu\' semplice ma meno sicuro' },
            { value: 'file', label: 'File esterno', hint: 'per Docker/secrets manager' },
          ],
          initialValue: 'env',
        })
      : 'plaintext'; // quickstart usa plaintext per semplicita'

    if (secretMode === 'env') {
      const envName = await prompter.text({
        message: 'Nome variabile d\'ambiente',
        initialValue: providerChoice === 'claude' ? 'ANTHROPIC_API_KEY' : `${providerChoice.toUpperCase()}_API_KEY`,
        placeholder: 'ANTHROPIC_API_KEY',
      });
      apiKeySecret = formatSecretForConfig('env', envName.trim());
      await prompter.note(`Assicurati che ${envName.trim()} sia impostata nel tuo shell profile.`, 'Nota');
    } else if (secretMode === 'file') {
      const filePath = await prompter.text({
        message: 'Path del file con la API key',
        placeholder: '/run/secrets/anthropic-key',
      });
      apiKeySecret = formatSecretForConfig('file', filePath.trim());
    } else {
      await prompter.note(
        `Per ottenere una API key per ${selectedProvider.label}:\n${selectedProvider.docsUrl}`,
        'API Key',
      );
      const rawKey = await prompter.text({
        message: `${selectedProvider.label} API key`,
        placeholder: selectedProvider.keyPlaceholder,
        validate: (value) => validateApiKey(selectedProvider, value),
      });
      apiKeySecret = formatSecretForConfig('plaintext', rawKey.trim());
    }
  }

  if (authMethod === 'subscription') {
    subscriptionConfig = await promptSubscription(prompter, selectedProvider, flow);
  }

  // --- Modello AI ---
  const model = await prompter.select({
    message: 'Modello AI default',
    options: selectedProvider.models,
    initialValue: baseConfig.providers?.[providerChoice]?.model || selectedProvider.models[0].value,
  });

  // --- Telegram (workspace e' path fisso, non chiesto) ---
  const telegramChannel = await promptTelegram(prompter, baseConfig.channels);

  // --- Step 5: Health check ---
  if (authMethod === 'api_key') {
    const healthy = await runHealthCheck(prompter, selectedProvider, apiKeySecret);
    if (!healthy) {
      const cont = await prompter.confirm({
        message: 'API key non verificata. Continuare e salvare comunque?',
        initialValue: true,
      });
      if (!cont) {
        await prompter.outro('Setup annullato.');
        return;
      }
    }
  }

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

  // --- Step 7: OAuth login provider (subscription path) ---
  const oauthCmd = PROVIDER_OAUTH_CMD[providerChoice];
  if (authMethod === 'subscription' && oauthCmd) {
    await prompter.note(
      `Ora apriro' ${oauthCmd} per il login.\n\n` +
      `Cosa fare:\n` +
      `  1. Quando appare il menu di scelta tema/login, premi Invio sui default\n` +
      `  2. Verra' stampato un URL — aprilo nel browser sul tuo computer\n` +
      `  3. Fai login con il tuo account ${selectedProvider.label}\n` +
      `  4. Copia il codice e incollalo qui nel terminale\n` +
      `  5. Quando vedi "authenticated", esci con /quit (o Ctrl+C due volte)\n\n` +
      `Quando ${oauthCmd} si chiude, il setup riprende da solo.`,
      `Login ${selectedProvider.label}`,
    );
    const ready = await prompter.confirm({
      message: `Pronto ad avviare ${oauthCmd} per il login?`,
      initialValue: true,
    });
    if (ready) {
      console.log('');
      runProviderOauth(oauthCmd);
      console.log('');
      await prompter.note(
        `${oauthCmd} chiuso. Il login OAuth e' salvato in ~/.jht/.${oauthCmd}/ (persistente).`,
        'Login completato',
      );
    } else {
      await prompter.note(
        `Per fare il login dopo: jht shell, poi ${oauthCmd}`,
        `Login ${selectedProvider.label} piu' tardi`,
      );
    }
  }

  // --- Step 8: avvia il team adesso? ---
  const wantStart = await prompter.confirm({
    message: 'Avviare il team adesso (Sentinella + Bridge + Capitano)?',
    initialValue: true,
  });
  if (wantStart) {
    console.log('');
    runJhtSubcommand(['team', 'start'], 'team start');
    console.log('');
    await prompter.outro(
      'Tutto pronto! Il team sta lavorando.\n' +
      '  Status:  jht team status\n' +
      '  Logs:    jht logs --tail 30\n' +
      '  Stop:    jht team stop --all',
    );
  } else {
    await prompter.outro(
      'Setup completato. Per avviare il team: jht team start',
    );
  }
}
