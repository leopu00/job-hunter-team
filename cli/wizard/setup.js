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
import { existsSync } from 'node:fs';
import {
  AI_PROVIDERS,
  RECOMMENDED_PROVIDER,
  readConfigFileSnapshot,
  validateApiKey,
  summarizeExistingConfig,
} from './setup-helpers.js';
import {
  promptTelegramOptional,
  promptSubscription,
  promptWorkingHours,
  assembleAndSaveConfig,
  showSummary,
} from './setup-steps.js';
import { formatSecretForConfig } from './secret-ref.js';
import { checkPrerequisites, runHealthCheck } from './setup-checks.js';
import { t, tf } from './i18n.js';
import { runProviderLoginStep } from './provider-login.js';
import pc from 'picocolors';

/** «[2/3] text»: the slow steps after the choices, numbered the same way as the installer's. */
export function stepLine(n, total, text) {
  return `${pc.dim(`[${n}/${total}]`)} ${text}`;
}

// Mappa provider scelto nel wizard → ID accettato da `providers update`
// (i providers.js usa "claude" / "codex" / "kimi" come keys).
const PROVIDER_UPDATE_ID = {
  claude: 'claude',
  openai: 'codex',
  kimi: 'kimi',
};

// Etichetta mostrata nel wizard (shared/locales, wizard.provider.*): Codex
// porta la parola «consigliato» nella lingua dell'utente.
const PROVIDER_LABEL_KEY = {
  openai: 'codex',
};

// Eseguibile del CLI provider per OAuth login. Tutti partono con un comando
// che, al primo run senza credenziali, mostra il device-flow URL.
const PROVIDER_OAUTH_CMD = {
  claude: 'claude',
  openai: 'codex',
  kimi: 'kimi',
};

/** The one sentence for a step that did not complete, for the cases where the child could not even say it itself. */
export function describeStepFailure(label, { missing = false, status = null } = {}) {
  const why = missing ? 'the JHT program was not found here' : status === null ? 'it could not be started' : `it ended with code ${status}`;
  return `  ${label} did not complete: ${why}. More details: JHT_DEBUG=1 jht setup`;
}

/**
 * Esegue un sub-comando JHT (lo stesso CLI Node, gia' in /app/cli/bin/jht.js)
 * con stdio inherited: le sue domande e i suoi messaggi arrivano mentre li scrive, senza tetti di buffer.
 * Ritorna true se exit code = 0. Il caso che mostrava una traccia di Node in mezzo al wizard (il programma non
 * c'e') si controlla prima, e diventa una frase.
 */
function runJhtSubcommand(args, label) {
  const entry = process.env.JHT_NODE_ENTRY || '/app/cli/bin/jht.js';
  if (!existsSync(entry)) {
    console.error(describeStepFailure(label, { missing: true }));
    if (process.env.JHT_DEBUG) console.error(`  (looked for ${entry})`);
    return false;
  }
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(describeStepFailure(label, { status: result.status }));
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
  await prompter.intro(t('wizard.intro_title'));

  // --- Step 1: Prerequisiti ---
  const prereqOk = await checkPrerequisites(prompter);
  if (!prereqOk) {
    await prompter.outro(t('wizard.aborted_prereqs'));
    return false;
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
      // Kept values do not say there is a login: the wait for it may have run out before (30 minutes) and the setup
      // be run again. The kept provider is asked for its login the same way, and a login that is there ends it at once.
      const keptProvider = AI_PROVIDERS.find((p) => p.value === baseConfig.active_provider);
      const keptCmd = keptProvider && PROVIDER_OAUTH_CMD[keptProvider.value];
      if (keptCmd) {
        const keptLogin = await runProviderLoginStep({
          cmdName: keptCmd, label: keptProvider.label, isVps: (process.env.JHT_HOST_TYPE || '').toLowerCase() === 'vps', prompter, t, tf,
        });
        if (!keptLogin) {
          await prompter.outro(t('wizard.oauth.aborted'));
          return false;
        }
      }
      await prompter.outro(t('wizard.config_kept'));
      return true;
    }
    if (action === 'reset') baseConfig = {};
  }

  // ────────────────────────────────────────────────────────────────────────
  // STEP VPS-FIRST: presenta subito la sincronizzazione web, ma non la usa
  // come gate del runtime. Il team vive sul VPS e l'app lo controlla via SSH;
  // account e dashboard copiano soltanto le superfici cloud supportate.
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
    const pairCloud = await prompter.confirm({
      message: t('wizard.cloud.enable_prompt'),
      initialValue: true,
    });
    if (pairCloud) {
      const cloudOk = runJhtSubcommand(['cloud', 'login'], 'cloud login');
      if (!cloudOk) {
        await prompter.note(
          t('wizard.cloud.pairing_failed'),
          t('wizard.cloud.pairing_title'),
        );
      }
    }
  }

  // --- Step 2: Provider AI (l'unica scelta tecnica vera del wizard) ---
  // With one provider offered there is nothing to choose: it is said, not asked.
  const providerLabel = (p) => t(`wizard.provider.${PROVIDER_LABEL_KEY[p.value]}`);
  let providerChoice;
  if (AI_PROVIDERS.length === 1) {
    providerChoice = AI_PROVIDERS[0].value;
    await prompter.note(providerLabel(AI_PROVIDERS[0]), t('wizard.provider.prompt'));
  } else {
    providerChoice = await prompter.select({
      message: t('wizard.provider.prompt'),
      options: AI_PROVIDERS.map((p) => ({ value: p.value, label: providerLabel(p) })),
      initialValue: baseConfig.active_provider || RECOMMENDED_PROVIDER,
    });
  }
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

  // --- Working hours: orari di lavoro del team (distribuzione weekly) ---
  // Step non-bloccante: skip = 24/7 (default storico). Lo facciamo PRIMA
  // di salvare il config così atterra in jht.config.json al primo write,
  // e il bridge li raccoglie immediatamente al boot del team.
  const workingHours = await promptWorkingHours(
    prompter,
    baseConfig.team?.working_hours,
  );

  // --- Salva e riepilogo ---
  await assembleAndSaveConfig(prompter, {
    providerChoice, authMethod, apiKey: apiKeySecret, subscriptionConfig, model,
    baseProviders: baseConfig.providers || {}, workingHours,
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
    console.log(stepLine(1, 3, tf('wizard.provider.install_cli', selectedProvider.label)));
    const ok = runJhtSubcommand(['providers', 'update', updateProviderId], 'providers update');
    if (!ok) {
      const cont = await prompter.confirm({
        message: t('wizard.provider.install_failed_continue'),
        active: t('wizard.provider.install_failed_yes'),
        inactive: t('wizard.provider.install_failed_no'),
        initialValue: false,
      });
      if (!cont) {
        await prompter.outro(t('wizard.outro_aborted'));
        return false;
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // STEP VPS-ONLY: Telegram bot — CONSIGLIATO ma OPZIONALE (2026-06-16)
  // Direction shift "interaction planes": l'interazione primaria passa al
  // desktop; Telegram diventa il canale async OPZIONALE. Niente piu' gate —
  // l'utente puo' saltare e configurarlo dopo con `jht config`. Anche il cloud
  // pairing proposto a inizio wizard resta facoltativo e separato dal runtime.
  // Il wizard gira dentro jht: mostra i comandi host, ma non raccoglie ne'
  // conserva token che il container degli agenti non deve poter leggere.
  // ────────────────────────────────────────────────────────────────────────
  if (isVps) {
    await promptTelegramOptional(prompter);
  }

  // ────────────────────────────────────────────────────────────────────────
  // STEP 7: OAuth login (BLOCCANTE — wizard polla finche' rileva il login)
  // ────────────────────────────────────────────────────────────────────────
  const oauthCmd = PROVIDER_OAUTH_CMD[providerChoice];
  // a login that is already there ends the step; otherwise the person is told where to log in
  console.log('');
  console.log(stepLine(2, 3, t('wizard.step.login')));
  const loggedIn = await runProviderLoginStep({
    cmdName: oauthCmd, label: selectedProvider.label, isVps, prompter, t, tf,
  });
  if (!loggedIn) {
    await prompter.outro(t('wizard.oauth.aborted'));
    return false;
  }

  // ────────────────────────────────────────────────────────────────────────
  // STEP 8: avvia il team automatically (no prompt)
  // ────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(stepLine(3, 3, t('wizard.team.starting')));
  const startOk = runJhtSubcommand(['team', 'start'], 'team start');
  if (!startOk) {
    await prompter.outro(t('wizard.team.start_failed'));
    return false;
  }

  // The configuration is said to be saved here, at the end, once everything it was for has been done.
  await showSummary(prompter, { selectedProvider });
  await prompter.outro(t('wizard.outro_done'));
  return true;
}
