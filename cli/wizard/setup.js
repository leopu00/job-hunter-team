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
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  AI_PROVIDERS,
  readConfigFileSnapshot,
  validateApiKey,
  summarizeExistingConfig,
} from './setup-helpers.js';
import {
  promptTelegramRequired,
  promptSubscription,
  assembleAndSaveConfig,
  showSummary,
} from './setup-steps.js';
import { formatSecretForConfig } from './secret-ref.js';
import { checkPrerequisites, runHealthCheck } from './setup-checks.js';
import { t, tf } from './i18n.js';

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
 * Path dove i CLI provider salvano le credenziali OAuth dentro al
 * container. Il polling controlla esistenza + mtime per detectare un
 * login completato dopo l'inizio dell'attesa.
 */
const PROVIDER_CRED_PATHS = {
  claude: ['/jht_home/.claude/.credentials.json', '/home/jht/.claude/.credentials.json'],
  codex:  ['/jht_home/.codex/.credentials.json',  '/home/jht/.codex/.credentials.json'],
  kimi:   ['/jht_home/.config/kimi-cli/credentials.json', '/home/jht/.config/kimi-cli/credentials.json'],
};

/**
 * Polling: aspetta che il file credentials di `cmdName` venga creato o
 * aggiornato dopo `startEpochSec`. Ritorna il path trovato o null in
 * timeout. Sleep 3s tra check, max `timeoutMs`.
 */
async function waitForOauthCredentials(cmdName, startEpochSec, timeoutMs) {
  const candidates = PROVIDER_CRED_PATHS[cmdName] || [];
  if (candidates.length === 0) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const p of candidates) {
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs / 1000 >= startEpochSec - 1) return p;
      } catch { /* ENOENT */ }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

/**
 * Esegue il setup wizard JHT.
 * @param {import('./prompts.js').WizardPrompter} prompter
 */
export async function runSetupWizard(prompter) {
  await prompter.intro(t('wizard.intro_title'));

  // --- Step 1: Prerequisiti ---
  const prereqOk = await checkPrerequisites(prompter);
  if (!prereqOk) {
    await prompter.outro(t('wizard.aborted_prereqs'));
    return;
  }

  // --- Config snapshot ---
  const snapshot = readConfigFileSnapshot();
  let baseConfig = snapshot.exists && snapshot.config ? snapshot.config : {};

  if (snapshot.exists && !snapshot.config) {
    await prompter.note(
      t('wizard.config_corrupt_body'),
      t('wizard.config_corrupt_title'),
    );
    baseConfig = {};
  }

  // Modalita' di setup: sempre "quickstart". Il path "advanced" chiedeva
  // dettagli (secret-mode, session token) che non servono per la beta.
  const flow = 'quickstart';

  // --- Config esistente ---
  if (snapshot.exists && snapshot.config) {
    await prompter.note(summarizeExistingConfig(baseConfig), t('wizard.config_existing_title'));
    const action = await prompter.select({
      message: t('wizard.config_action_prompt'),
      options: [
        { value: 'keep', label: t('wizard.config_action_keep') },
        { value: 'modify', label: t('wizard.config_action_modify') },
        { value: 'reset', label: t('wizard.config_action_reset') },
      ],
    });
    if (action === 'keep') {
      await prompter.outro(t('wizard.config_kept'));
      return;
    }
    if (action === 'reset') baseConfig = {};
  }

  // ────────────────────────────────────────────────────────────────────────
  // STEP VPS-FIRST: prima di QUALSIASI scelta tecnica, blocca finche' non
  // c'e' un account web + pairing. Senza account web il tester non puo'
  // monitorare nulla dal browser, quindi il setup non ha senso.
  // ────────────────────────────────────────────────────────────────────────
  const isVps = (process.env.JHT_HOST_TYPE || '').toLowerCase() === 'vps';
  if (isVps) {
    await prompter.note(
      t('wizard.cloud.login_body'),
      t('wizard.cloud.login_title'),
    );
    await prompter.note(
      t('wizard.cloud.pairing_body'),
      t('wizard.cloud.pairing_title'),
    );
    const cloudOk = runJhtSubcommand(['cloud', 'login'], 'cloud login');
    if (!cloudOk) {
      await prompter.outro(t('wizard.cloud.pairing_failed'));
      return;
    }
  }

  // --- Step 2: Provider AI (l'unica scelta tecnica vera del wizard) ---
  const providerChoice = await prompter.select({
    message: t('wizard.provider.prompt'),
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

  // Telegram: chiesto inline solo se VPS (vedi step post-config).
  // Su locale, la dashboard del browser e' raggiungibile e Telegram
  // diventa opzionale → si configura dopo con `jht config`.
  let telegramChannel = baseConfig.channels?.telegram || undefined;

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

  // --- Step 6: install/update CLI provider (sempre, senza chiedere) ---
  const updateProviderId = PROVIDER_UPDATE_ID[providerChoice];
  if (updateProviderId) {
    console.log('');
    console.log(tf('wizard.provider.install_cli', selectedProvider.label));
    const ok = runJhtSubcommand(['providers', 'update', updateProviderId], 'providers update');
    if (!ok) {
      const cont = await prompter.confirm({
        message: t('wizard.provider.install_failed_continue'),
        initialValue: false,
      });
      if (!cont) {
        await prompter.outro(t('wizard.outro_aborted'));
        return;
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // STEP VPS-ONLY: Telegram bot OBBLIGATORIO
  // Cloud pairing e' gia' stato fatto all'inizio del wizard (VPS-FIRST).
  // Telegram va dopo providers update perche' richiede solo input utente,
  // non risorse del container.
  // ────────────────────────────────────────────────────────────────────────
  if (isVps) {
    telegramChannel = await promptTelegramRequired(prompter, baseConfig.channels);
    // Aggiorno config sul disco con il telegram appena configurato.
    await assembleAndSaveConfig(prompter, {
      providerChoice, authMethod, apiKey: apiKeySecret, subscriptionConfig, model,
      telegramChannel, baseProviders: baseConfig.providers || {},
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // STEP 7: OAuth login (BLOCCANTE — wizard polla finche' rileva il login)
  // ────────────────────────────────────────────────────────────────────────
  const oauthCmd = PROVIDER_OAUTH_CMD[providerChoice];
  const startTs = Date.now() / 1000;
  await prompter.note(
    // wizard.oauth.notify_body uses %s × 2 (cli name + account label)
    tf('wizard.oauth.notify_body', oauthCmd, selectedProvider.label),
    tf('wizard.oauth.notify_title', selectedProvider.label),
  );

  const credSpinner = prompter.progress(tf('wizard.oauth.waiting', oauthCmd));
  const credPath = await waitForOauthCredentials(oauthCmd, startTs, 30 * 60 * 1000);
  if (!credPath) {
    credSpinner.stop(t('wizard.oauth.timeout'));
    await prompter.outro(t('wizard.oauth.aborted'));
    return;
  }
  credSpinner.stop(tf('wizard.oauth.detected', oauthCmd, credPath));

  // ────────────────────────────────────────────────────────────────────────
  // STEP 8: avvia il team automatically (no prompt)
  // ────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(t('wizard.team.starting'));
  const startOk = runJhtSubcommand(['team', 'start'], 'team start');
  if (!startOk) {
    await prompter.outro(t('wizard.team.start_failed'));
    return;
  }

  await prompter.outro(t('wizard.outro_done'));
}
