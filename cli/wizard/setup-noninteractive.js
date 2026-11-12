/**
 * JHT Setup Wizard — Non-interactive mode
 *
 * Ogni prompt del wizard ha un flag CLI equivalente.
 * Pattern copiato da OpenClaw (openclaw/src/commands/onboard-non-interactive.ts).
 *
 * Uso:
 *   jht setup --non-interactive --provider claude --api-key sk-ant-... --model claude-sonnet-4-6
 *   jht setup --non-interactive --provider claude --secret-mode env --secret-env ANTHROPIC_API_KEY
 *   jht setup --non-interactive --provider glm --harness pi --api-key-file key.txt   (or --api-key-stdin)
 */
import { lstatSync, readFileSync } from 'node:fs';
import pc from 'picocolors';
import {
  findProviderChoice,
  JHT_CONFIG_DIR,
  readConfigFileSnapshot,
  writeConfigFile,
  validateApiKey,
  validateEmail,
} from './setup-helpers.js';
import { formatSecretForConfig, resolveSecret, describeSecret } from './secret-ref.js';
import { runHealthCheck } from './setup-checks.js';
import { checkPiApiKey, rejectedKeyMessage } from '../../shared/runtime/provider-key-check.js';
import { t, LANGUAGES, hasLanguageChoice, systemLanguage, saveLanguage } from './i18n.js';
import { summarizeRoleModels } from './setup-models.js';
import { AGENT_HARNESSES, DEFAULT_HARNESS } from '../../shared/runtime/agent-harness.js';
import { piApiProvider } from '../../shared/runtime/provider-models.js';
import { harnessRefusal } from './setup-harness.js';
import { RELEASE_PROVIDERS, RELEASE_HARNESS, offeredInRelease } from '../../shared/runtime/release-providers.js';
import { migrateToLatest } from '../src/commands/migrate.js';
import { KEY_REFUSED_EXIT_CODE } from '../src/commands/providers-key-check.js';
import { API_KEY_MAX_BYTES, firstLine, isLauncherSafePath, keyShapeProblem, keyStoreDir, readKeyFromStream, storeApiKey } from './key-store.js';

/** The most a file holding one API key can weigh. */
const API_KEY_FILE_MAX_BYTES = API_KEY_MAX_BYTES;

/**
 * Crea un prompter finto per passare a runHealthCheck (serve solo progress).
 */
function silentPrompter() {
  return {
    progress: (label) => {
      console.log(pc.dim(`  ${label}`));
      return {
        update: (msg) => console.log(pc.dim(`  ${msg}`)),
        stop: (msg) => console.log(msg ? pc.green(`  ${msg}`) : ''),
      };
    },
    note: async (msg, title) => { if (title) console.log(pc.bold(title)); console.log(msg); },
    confirm: async () => true,
  };
}

/**
 * La lingua dell'utente: `--language` se c'e' (e vale una delle sette); altrimenti, se nessuno l'ha ancora scelta
 * (niente i18n-prefs.json), quella del sistema, se e' una delle sette. Chi l'ha gia' scelta (il setup dell'host, il
 * picker, l'app) non viene toccato. Salva in i18n-prefs.json. Falso = lingua non valida, il setup si ferma.
 */
export function applyLanguage(opts, { env = process.env, log = console.log, error = console.error } = {}) {
  if (opts.language !== undefined) {
    const code = String(opts.language).trim().toLowerCase();
    if (!LANGUAGES.some((l) => l.value === code)) {
      error(pc.red(`Invalid --language "${opts.language}". Use: ${LANGUAGES.map((l) => l.value).join(', ')}`));
      return false;
    }
    saveLanguage(code);
    log(pc.dim(`  Language: ${LANGUAGES.find((l) => l.value === code).label} (${code})`));
    return true;
  }
  if (!hasLanguageChoice()) {
    const code = systemLanguage(env);
    if (code) {
      saveLanguage(code);
      log(pc.dim(`  Language: ${LANGUAGES.find((l) => l.value === code).label} (${code}), from the system`));
    }
  }
  return true;
}

/**
 * Esegue il setup in modalita' non-interattiva.
 * @param {object} opts — flag CLI da Commander
 */
export async function runNonInteractiveSetup(opts) {
  console.log(pc.bold('\n  JHT Setup — Non-interactive mode\n'));

  if (!applyLanguage(opts)) { process.exitCode = 1; return; }

  // --- Validazione flag obbligatori ---
  const selectedProvider = findProviderChoice(opts.provider || RELEASE_PROVIDERS[0]);
  if (!selectedProvider || !offeredInRelease(selectedProvider.value)) {
    // the services of this release are one list (shared/runtime/release-providers.js); the others come in a later release
    console.error(pc.red(`This release offers only ${RELEASE_PROVIDERS.join(', ')} with an API key, on the ${RELEASE_HARNESS} harness ("${opts.provider}" is not offered). Example: jht setup --non-interactive --provider ${RELEASE_PROVIDERS[0]} --api-key-stdin`));
    process.exitCode = 1;
    return;
  }
  const providerName = selectedProvider.value; // moonshot is kimi

  const harness = opts.harness || RELEASE_HARNESS;
  if (harness !== RELEASE_HARNESS) {
    console.error(pc.red(`This release runs the agents only on ${RELEASE_HARNESS}: drop --harness or use --harness ${RELEASE_HARNESS}.`));
    process.exitCode = 1;
    return;
  }
  if (!AGENT_HARNESSES.includes(harness)) {
    console.error(pc.red(`Invalid harness "${harness}". Use: ${AGENT_HARNESSES.join(', ')}`));
    process.exitCode = 1;
    return;
  }
  if (selectedProvider.piOnly && harness !== 'pi') {
    console.error(pc.red(`${selectedProvider.label} runs only on the pi harness: add --harness pi.`));
    process.exitCode = 1;
    return;
  }

  const authMethod = opts.authMethod || 'api_key';
  const secretMode = opts.secretMode || 'plaintext';
  const model = opts.model || selectedProvider.models[0].value;

  // --- Assembla API key (SecretRef) o subscription ---
  let apiKeySecret;
  let pendingKey = null; // the key of a glm/kimi setup, in memory until the provider has accepted it
  let keptByTheSetup = false; // ... and, once stored, the summary says so instead of naming the folder
  let subscriptionConfig;
  if (authMethod === 'api_key') {
    if (secretMode === 'env') {
      const envName = opts.secretEnv || selectedProvider.keyVariable || (providerName === 'claude' ? 'ANTHROPIC_API_KEY' : `${providerName.toUpperCase()}_API_KEY`);
      apiKeySecret = formatSecretForConfig('env', envName);
    } else if (secretMode === 'file') {
      if (!opts.secretFile) {
        console.error(pc.red('--secret-file is required with --secret-mode file'));
        process.exitCode = 1;
        return;
      }
      // The launcher types this path into the pane of every agent: only an absolute path of the container, of letters,
      // digits and _ . / - . A path of the host (C:\\...) would be saved here and refused at the first start.
      // (The CLI runs in the container; a Windows node only gets here in tests.)
      if (process.platform !== 'win32' && !isLauncherSafePath(opts.secretFile)) {
        console.error(pc.red('--secret-file must be an absolute path inside the container, of letters, digits and _ . / - only, without "..".'));
        console.error(pc.dim('  A key file on your computer: give it to --api-key-file (glm, kimi) and the setup keeps it for you.'));
        process.exitCode = 1;
        return;
      }
      apiKeySecret = formatSecretForConfig('file', opts.secretFile);
    } else if (selectedProvider.piOnly && !opts.apiKeyFile && !opts.apiKeyStdin) {
      // Kimi and GLM put a plaintext key in the config and, for Kimi, in the command of the pane: only a reference
      console.error(pc.red(`${selectedProvider.label} takes its key by reference: use --api-key-file or --api-key-stdin (the setup keeps the key for you), or --secret-mode env or --secret-mode file.`));
      process.exitCode = 1;
      return;
    } else {
      // the key comes from a file or the standard input (never on the command line, where other programs and the
      // history see it) or, as before, from --api-key
      if (opts.apiKeyFile && opts.apiKeyStdin) {
        console.error(pc.red('Use --api-key-file or --api-key-stdin, not both.'));
        process.exitCode = 1;
        return;
      }
      let key = opts.apiKey;
      if (opts.apiKeyFile) {
        key = readApiKeyFile(opts.apiKeyFile);
        if (key === null) return;
      } else if (opts.apiKeyStdin) {
        key = await readStdinKey(opts.stdin ?? process.stdin);
        if (key === null) return;
      }
      if (!key || !key.trim()) {
        console.error(pc.red(opts.apiKeyStdin ? 'Nothing came on the standard input: pipe the key in (one line).' : opts.apiKeyFile ? 'The file given to --api-key-file is empty.' : '--api-key-file (or --api-key) is required, or use --secret-mode env/file'));
        process.exitCode = 1;
        return;
      }
      key = key.trim();
      const err = validateApiKey(selectedProvider, key);
      if (err) { console.error(pc.red(err)); process.exitCode = 1; return; }
      if (selectedProvider.piOnly) {
        // Kept in the container's key store AFTER the provider has accepted it (below): a refused key leaves nothing.
        const shape = keyShapeProblem(key);
        if (shape) { console.error(pc.red(shape)); process.exitCode = 1; return; }
        if (process.platform !== 'win32' && !isLauncherSafePath(keyStoreDir())) {
          console.error(pc.red(`The key store ${keyStoreDir()} has characters the launcher cannot use (letters, digits and _ . / - only).`));
          process.exitCode = 1;
          return;
        }
        pendingKey = key;
      } else {
        apiKeySecret = formatSecretForConfig('plaintext', key);
      }
    }
  } else if (authMethod === 'subscription') {
    if (!opts.subscriptionEmail) {
      console.error(pc.red('--subscription-email is required with --auth-method subscription'));
      console.error(pc.dim('  Example: jht setup --non-interactive --provider claude \\'));
      console.error(pc.dim('             --auth-method subscription --subscription-email you@example.com'));
      process.exitCode = 1;
      return;
    }
    const emailErr = validateEmail(opts.subscriptionEmail);
    if (emailErr) { console.error(pc.red(emailErr)); process.exitCode = 1; return; }
    subscriptionConfig = { email: opts.subscriptionEmail.trim() };
    if (opts.subscriptionToken) {
      subscriptionConfig.session_token = opts.subscriptionToken.trim();
    }
  } else {
    console.error(pc.red(`Invalid --auth-method "${authMethod}". Use: api_key, subscription`));
    process.exitCode = 1;
    return;
  }

  const harnessIssue = harnessRefusal(harness, providerName, authMethod);
  if (harnessIssue) { console.error(pc.red(`${harnessIssue}.`)); process.exitCode = 1; return; }

  // --- Health check ---
  if (selectedProvider.piOnly && !opts.skipHealth && authMethod === 'api_key') {
    // glm/kimi: a light call (the list of models, no tokens) says whether the provider accepts the key. Only a refusal
    // (401) stops the setup, and nothing is saved: a key it refused would only fail inside the Pi session of the agents.
    const verdict = await checkPiApiKey(providerName, pendingKey ?? resolveSecret(apiKeySecret));
    if (verdict.state === 'rejected') {
      console.error(pc.red(`${rejectedKeyMessage(verdict.label)}`));
      console.error(pc.dim('  Nothing was saved. To save it anyway (no network, or a key you will fix later): --skip-health'));
      // 3, like `jht providers check-key`: the desktop app tells a key the provider refused from any other failure of the setup
      process.exitCode = KEY_REFUSED_EXIT_CODE;
      return;
    }
    if (verdict.state === 'valid') console.log(pc.dim(`  ${verdict.label}: the API key is accepted.`));
    else console.log(pc.yellow(`  Could not check the API key with ${verdict.label} (${verdict.reason}): the first call of an agent will tell.`));
  } else if (!opts.skipHealth && authMethod === 'api_key') {
    const prompter = silentPrompter();
    const ok = await runHealthCheck(prompter, selectedProvider, apiKeySecret);
    if (!ok) console.log(pc.yellow(`  ${t('wizard.checks.health.failed_save_anyway')}`));
  }

  if (pendingKey !== null) {
    try {
      apiKeySecret = formatSecretForConfig('file', storeApiKey(providerName, pendingKey));
      keptByTheSetup = true;
    } catch (err) {
      console.error(pc.red(`Nothing was saved: ${err.message}.`));
      process.exitCode = 1;
      return;
    } finally {
      pendingKey = null;
    }
  }

  saveNonInteractiveConfig({ providerName, selectedProvider, authMethod, model, modelGiven: Boolean(opts.model), apiKeySecret, subscriptionConfig, harness, keptByTheSetup });
}

/** The key from the standard input, or null (and the reason said, exit code 1) when none came or it is too big for a key. */
async function readStdinKey(stream) {
  if (stream.isTTY) {
    console.error(pc.red('--api-key-stdin reads the key from a pipe: nothing is typed here (example: "type key.txt | jht setup ... --api-key-stdin").'));
    process.exitCode = 1;
    return null;
  }
  const key = await readKeyFromStream(stream);
  if (key === null) {
    console.error(pc.red(`The standard input is empty or too big for a key (over ${API_KEY_FILE_MAX_BYTES} bytes).`));
    process.exitCode = 1;
  }
  return key;
}

function readApiKeyFile(file) {
  let key;
  // a regular file, not a link (and so not a pipe or a device that never ends), of a size a key can have
  let stat = null;
  try { stat = lstatSync(file); } catch { /* said below */ }
  if (!stat || !stat.isFile()) {
    console.error(pc.red(stat
      ? `The file given to --api-key-file must be a regular file, not a link or a device: ${file}`
      : `The file given to --api-key-file cannot be read: ${file}`));
    process.exitCode = 1;
    return null;
  }
  if (stat.size > API_KEY_FILE_MAX_BYTES) {
    console.error(pc.red(`The file given to --api-key-file is too big for a key (over ${API_KEY_FILE_MAX_BYTES} bytes): ${file}`));
    process.exitCode = 1;
    return null;
  }
  // like ssh: a key that others can read is said, not refused
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    console.error(pc.yellow(`The file ${file} can be read by other users: chmod 600 it.`));
  }
  try {
    key = readFileSync(file, 'utf8').split(/\r?\n/)[0];
  } catch {
    console.error(pc.red(`The file given to --api-key-file cannot be read: ${file}`));
    process.exitCode = 1;
    return null;
  }

  return key;
}

/**
 * The config of the team as it is now, when this setup is for the SAME team: the same provider on the same harness. Giving a new key (the
 * command the CLI and the app both use when a provider refuses the old one) must not lose what the setup does not ask: the channels
 * (the Telegram bots), the model already chosen, the other fields of the config. A setup for another provider or harness starts a new
 * config, as it always did.
 */
export function sameTeamConfig(previous, providerName, harness) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return null;
  // «moonshot» is Moonshot's own name for kimi: an old or hand-written config may carry it, and it is the same team
  const name = typeof previous.active_provider === 'string' ? (piApiProvider(previous.active_provider) ?? previous.active_provider) : null;
  if (name !== providerName) return null;
  if ((previous.harness ?? DEFAULT_HARNESS) !== harness) return null;
  const entry = previous.providers?.[previous.active_provider];
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? previous : null;
}

function saveNonInteractiveConfig({ providerName, selectedProvider, authMethod, model, modelGiven = true, apiKeySecret, subscriptionConfig, harness, keptByTheSetup = false }) {
  // --- Assembla e salva config ---
  const providerConfig = { name: providerName, auth_method: authMethod, model };
  if (apiKeySecret) {
    if (apiKeySecret.type === 'plaintext') providerConfig.api_key = apiKeySecret.value;
    else providerConfig.api_key_ref = apiKeySecret;
  }
  if (subscriptionConfig) {
    providerConfig.subscription = subscriptionConfig;
  }

  const previous = sameTeamConfig(readConfigFileSnapshot().config, providerName, harness);
  let config;
  if (previous) {
    // the entry of the provider keeps its fields (the model chosen before, when none is given now) except how it signs in, which is what this setup sets
    const { api_key: _key, api_key_ref: _ref, subscription: _subscription, ...kept } = previous.providers[previous.active_provider];
    // the entry under its old name (moonshot) moves to the name the setup writes (kimi); the other providers' entries stay as they are
    const { [previous.active_provider]: _old, ...others } = previous.providers;
    config = {
      ...previous,
      active_provider: providerName,
      providers: { ...others, [providerName]: { ...kept, ...providerConfig, ...(modelGiven || !kept.model ? {} : { model: kept.model }) } },
      channels: previous.channels ?? {},
      harness,
    };
  } else {
    config = {
      version: 1,
      active_provider: providerName,
      providers: { [providerName]: providerConfig },
      channels: {},
      harness,
    };
  }
  // a setup writes a config at the latest version, like the wizard: `jht doctor` right after it must not offer a migration
  // (a team config of the same team keeps the version it has: migrations are idempotent and only raise it)
  config = migrateToLatest(config);

  try {
    writeConfigFile(config);
  } catch (err) {
    console.error(pc.red(`Save Error: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  // --- Riepilogo ---
  console.log(pc.green('\n  Config saved!\n'));
  console.log(`  Provider:   ${selectedProvider.label}`);
  if (harness === 'pi') console.log('  Harness:    Pi');
  if (authMethod === 'api_key') {
    console.log(`  Auth:       ${keptByTheSetup ? 'API key kept by the setup (not in the config)' : describeSecret(apiKeySecret)}`);
  } else {
    console.log(`  Auth:       subscription (${subscriptionConfig.email}${subscriptionConfig.session_token ? ' · token preset' : ''})`);
  }
  console.log(summarizeRoleModels(config));
  console.log(`  JHT home:   ${JHT_CONFIG_DIR}`);
  console.log('');
  if (authMethod === 'subscription') {
    const updateId = harness === 'pi' ? 'pi' : providerName === 'openai' ? 'codex' : providerName; // claude/kimi mantengono il nome
    console.log(pc.dim(`  Next step: jht providers update ${updateId}`));
    console.log(pc.dim('  Then start the CLI OAuth login provider (device flow).\n'));
  }
}
