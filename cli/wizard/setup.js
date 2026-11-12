/**
 * JHT Setup Wizard — Main orchestration
 *
 * Flusso: prerequisiti → provider AI → auth (SecretRef) → modello →
 *         Telegram → health check → salva config.
 *
 * Provider: Codex (abbonamento ChatGPT, il consigliato) e, con la chiave API, GLM (Z.ai) e Kimi (Moonshot): questi due girano
 * solo su Pi, la chiave si scrive nascosta e resta nel key store del container (setup-api-key.js), non c'e' un accesso da fare.
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
  PI_API_CHOICES,
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
import { askLanguage } from './setup-language.js';
import { runProviderLoginStep, findProviderLogin } from './provider-login.js';
import { promptHarness, updateIdFor, loginCmdFor } from './setup-harness.js';
import { askPiApiKey, askCodexApiKey, runCodexApiKeyLogin } from './setup-api-key.js';
import { WizardCancelledError } from './prompts.js';
import { lstatSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { keyStoreDir } from './key-store.js';
import { JHT_CONFIG_PATH } from './setup-helpers.js';
import { piApiProvider } from '../../shared/runtime/provider-models.js';
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
  glm: 'key_glm',
  kimi: 'key_kimi',
};

/** What the wizard offers: Codex with the subscription, then the providers that take an API key (they run only on Pi). */
export const WIZARD_PROVIDERS = [...AI_PROVIDERS, ...PI_API_CHOICES];

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
  // a setup that is cancelled leaves things as they were: the config as it was (or none), and the key it just stored
  const before = readConfigBytes();
  // keyPath: the file of the key this setup may write; keyBefore: what it held when the setup began (null = there was no file)
  const state = { keyPath: null, keyBefore: null };
  try {
    return await runSetupSteps(prompter, state);
  } catch (err) {
    if (err instanceof WizardCancelledError) undoCancelledSetup(before, state);
    throw err;
  }
}

/** The key file of a provider in the key store as it is now: `{ keyPath, keyBefore }` (keyBefore null when there is none); nothing to touch when it cannot be read. */
export function rememberKeyFile(provider, dir = keyStoreDir()) {
  const keyPath = join(dir, `${provider}.key`);
  try {
    if (!lstatSync(keyPath).isFile()) return { keyPath: null, keyBefore: null };
    return { keyPath, keyBefore: readFileSync(keyPath) };
  } catch (err) {
    return err && err.code === 'ENOENT' ? { keyPath, keyBefore: null } : { keyPath: null, keyBefore: null };
  }
}

function readConfigBytes(path = JHT_CONFIG_PATH) {
  try { return readFileSync(path); } catch { return null; }
}

/** The config back to what it was (removed when there was none) and the key the cancelled setup stored taken away. */
export function undoCancelledSetup(before, state, { path = JHT_CONFIG_PATH } = {}) {
  try {
    const now = readConfigBytes(path);
    if (before === null) rmSync(path, { force: true });
    else if (now === null || !now.equals(before)) writeFileSync(path, before, { mode: 0o600 });
  } catch { /* the setup says nothing more: it was cancelled */ }
  if (state.keyPath) {
    // a key the setup wrote is taken away; a key that was there before it began is put back (the same provider's file is replaced
    // by a new setup, and a cancel must not cost the key that worked)
    try {
      if (state.keyBefore === null) rmSync(state.keyPath, { force: true });
      else writeFileSync(state.keyPath, state.keyBefore, { mode: 0o600 });
    } catch { /* nothing more to do: the setup was cancelled */ }
  }
}

async function runSetupSteps(prompter, state) {
  await prompter.intro(t('wizard.intro_title'));
  await askLanguage(prompter);

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
      const keptCmd = keptProvider && loginCmdFor(baseConfig.harness, keptProvider.value, PROVIDER_OAUTH_CMD);
      if (keptCmd) {
        const keptLogin = await runProviderLoginStep({
          cmdName: keptCmd, label: keptCmd === 'pi' ? 'Pi' : keptProvider.label, isVps: (process.env.JHT_HOST_TYPE || '').toLowerCase() === 'vps', prompter, t, tf,
          provider: baseConfig.active_provider, model: baseConfig.providers?.[baseConfig.active_provider]?.model,
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
  // the provider of a config already there, under the name the wizard offers it (moonshot is kimi)
  const offeredNow = piApiProvider(baseConfig.active_provider) ?? baseConfig.active_provider;
  let providerChoice;
  if (WIZARD_PROVIDERS.length === 1) {
    providerChoice = WIZARD_PROVIDERS[0].value;
    await prompter.note(providerLabel(WIZARD_PROVIDERS[0]), t('wizard.provider.prompt'));
  } else {
    providerChoice = await prompter.select({
      message: t('wizard.provider.prompt'),
      options: WIZARD_PROVIDERS.map((p) => ({ value: p.value, label: providerLabel(p) })),
      initialValue: WIZARD_PROVIDERS.some((p) => p.value === offeredNow) ? offeredNow : RECOMMENDED_PROVIDER,
    });
  }
  const selectedProvider = WIZARD_PROVIDERS.find((p) => p.value === providerChoice);
  const takesApiKey = selectedProvider.piOnly === true;

  // --- Harness: il programma che guida gli agenti (codex | pi), subito dopo il provider ---
  // GLM and Kimi run only on Pi, with an API key: nothing to ask, it is said.
  let harness;
  if (takesApiKey) {
    harness = 'pi';
    await prompter.note(tf('wizard.provider.harness_pi_key_note', selectedProvider.label), t('wizard.provider.harness_prompt'));
  } else {
    harness = await promptHarness(prompter, {
      t, provider: providerChoice, authMethod: 'subscription', current: baseConfig.harness,
    });
  }

  // --- Auth ---
  // Codex: solo subscription (ADR-0004), nessun input: l'OAuth device flow lo fa il CLI provider in uno step successivo.
  // GLM / Kimi: la chiave API, scritta nascosta, controllata dal provider e tenuta nel key store del container; il config
  // ne ha solo il percorso (api_key_ref). Una chiave che il provider rifiuta non lascia niente di salvato.
  let authMethod = 'subscription';
  let apiKeySecret;
  let codexKey = null; // the OpenAI key of a Codex setup with a key, in memory until Codex has taken it
  const subscriptionConfig = undefined;
  if (!takesApiKey && harness === 'codex') {
    // Codex: the ChatGPT subscription (the recommended way) or an OpenAI API key, which is billed by the token
    const access = await prompter.select({
      message: t('wizard.access.prompt'),
      options: [
        { value: 'subscription', label: t('wizard.access.subscription') },
        { value: 'api_key', label: t('wizard.access.api_key') },
      ],
      initialValue: 'subscription',
    });
    if (access === 'api_key') {
      codexKey = await askCodexApiKey(prompter, { t, tf });
      if (!codexKey) {
        await prompter.outro(t('wizard.key.aborted'));
        return false;
      }
      // Codex keeps the key itself (codex login --with-api-key): the config says the CLI holds the credential, and holds no key
      authMethod = 'cli';
    }
  }
  if (takesApiKey) {
    authMethod = 'api_key';
    // known before the key is asked: a cancel at any point from here on leaves this file as it was
    Object.assign(state, rememberKeyFile(selectedProvider.value));
    const keyPath = await askPiApiKey(prompter, { t, tf, choice: selectedProvider });
    if (!keyPath) {
      await prompter.outro(t('wizard.key.aborted'));
      return false;
    }
    apiKeySecret = formatSecretForConfig('file', keyPath);
  }

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
    baseProviders: baseConfig.providers || {}, workingHours, harness,
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST-CONFIG: providers update + OAuth login + team start
  // Tutti opzionali (l'utente puo' rispondere "no" e farli a mano dopo) ma
  // proposti di default per arrivare a "team che gira" in un solo wizard.
  // ────────────────────────────────────────────────────────────────────────

  // --- Step 6: install/update CLI provider (sempre, senza chiedere) ---
  const updateProviderId = updateIdFor(harness, providerChoice, PROVIDER_UPDATE_ID);
  if (updateProviderId) {
    console.log('');
    console.log(stepLine(1, 3, tf('wizard.provider.install_cli', harness === 'pi' ? 'Pi' : selectedProvider.label)));
    const ok = runJhtSubcommand(['providers', 'update', updateProviderId], 'providers update');
    if (!ok) {
      const cont = await prompter.confirm({
        message: t(harness === 'pi' ? 'wizard.provider.install_failed_continue_pi' : 'wizard.provider.install_failed_continue'),
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
  const oauthCmd = loginCmdFor(harness, providerChoice, PROVIDER_OAUTH_CMD);
  // a login that is already there ends the step; otherwise the person is told where to log in
  console.log('');
  console.log(stepLine(2, 3, t(takesApiKey || codexKey !== null ? 'wizard.step.key' : 'wizard.step.login')));
  // with an API key there is no sign-in: the key the provider accepted is the whole of it
  let loggedIn;
  if (codexKey !== null) {
    // the key goes to Codex on its standard input; what is there afterwards is Codex's own sign-in marker
    const done = runCodexApiKeyLogin(codexKey);
    codexKey = null;
    loggedIn = !done.error && done.status === 0 ? findProviderLogin('codex', {}) : null;
    if (!loggedIn) await prompter.note(t('wizard.key.codex_not_taken'), t('wizard.key.title'));
  } else loggedIn = takesApiKey ? true : await runProviderLoginStep({
    cmdName: oauthCmd, label: harness === 'pi' ? 'Pi' : selectedProvider.label, isVps, prompter, t, tf,
    provider: providerChoice, model,
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
