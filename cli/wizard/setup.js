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

  // --- Auth: solo subscription ---
  // ADR-0004: niente API key path. Tutti i beta tester usano subscription
  // (Claude Max, Codex Plus/Pro, Kimi). Il wizard non chiede piu' "api_key vs
  // subscription" perche' confonde e non e' supportato.
  const authMethod = 'subscription';
  const apiKeySecret = undefined;
  const subscriptionConfig = await promptSubscription(prompter, selectedProvider, flow);

  // --- Modello AI ---
  const model = await prompter.select({
    message: 'Modello AI default',
    options: selectedProvider.models,
    initialValue: baseConfig.providers?.[providerChoice]?.model || selectedProvider.models[0].value,
  });

  // --- Telegram (workspace e' path fisso, non chiesto) ---
  const telegramChannel = await promptTelegram(prompter, baseConfig.channels);

  // Niente health check: con subscription la verifica avviene al login OAuth
  // del CLI provider (step successivo).

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

  // --- Step 7: OAuth login provider ---
  // Il CLI provider (claude/codex/kimi) ha la sua TUI interattiva per il
  // device-flow OAuth. Non puo' essere spawnato inline qui dentro al wizard
  // perche' clack non rilascia bene il TTY al child. La soluzione semplice:
  // dire all'utente di aprire un secondo terminale, fare ssh, e lanciare
  // `jht oauth-login`. Quando ha finito, torna qui e premiamo Enter.
  const oauthCmd = PROVIDER_OAUTH_CMD[providerChoice];
  if (oauthCmd) {
    await prompter.note(
      `Per autenticare il tuo account ${selectedProvider.label}:\n\n` +
      `  1. Apri un NUOVO terminale sul tuo computer\n` +
      `  2. Fai SSH al VPS (stesso comando che hai usato all'inizio)\n` +
      `  3. Esegui:  jht oauth-login\n` +
      `  4. Segui le istruzioni: apri l'URL nel browser, fai login,\n` +
      `     incolla il codice, esci con /quit quando vedi "authenticated"\n` +
      `  5. Torna qui (in questo terminale) e premi Invio per continuare\n\n` +
      `Il login viene salvato in modo persistente — lo fai solo una volta.`,
      `Login ${selectedProvider.label} (in altro terminale)`,
    );
    await prompter.confirm({
      message: 'Login completato? Premi Invio per continuare con l\'avvio del team',
      initialValue: true,
    });
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
