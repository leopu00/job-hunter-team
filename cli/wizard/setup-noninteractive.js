/**
 * JHT Setup Wizard — Non-interactive mode
 *
 * Ogni prompt del wizard ha un flag CLI equivalente.
 * Pattern copiato da OpenClaw (openclaw/src/commands/onboard-non-interactive.ts).
 *
 * Uso:
 *   jht setup --non-interactive --provider claude --api-key sk-ant-... --model claude-sonnet-4-6
 *   jht setup --non-interactive --provider claude --secret-mode env --secret-env ANTHROPIC_API_KEY
 */
import { lstatSync, readFileSync } from 'node:fs';
import pc from 'picocolors';
import {
  AI_PROVIDERS,
  RECOMMENDED_PROVIDER,
  JHT_CONFIG_DIR,
  writeConfigFile,
  validateApiKey,
  validateEmail,
} from './setup-helpers.js';
import { formatSecretForConfig, resolveSecret, describeSecret } from './secret-ref.js';
import { runHealthCheck } from './setup-checks.js';
import { t, LANGUAGES, hasLanguageChoice, systemLanguage, saveLanguage } from './i18n.js';
import { summarizeRoleModels } from './setup-models.js';
import { AGENT_HARNESSES, DEFAULT_HARNESS } from '../../shared/runtime/agent-harness.js';
import { harnessRefusal } from './setup-harness.js';

/** The most a file holding one API key can weigh. */
const API_KEY_FILE_MAX_BYTES = 4096;

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
  const providerName = opts.provider || RECOMMENDED_PROVIDER;
  const selectedProvider = AI_PROVIDERS.find((p) => p.value === providerName);
  if (!selectedProvider) {
    console.error(pc.red(`Invalid provider "${providerName}". Use: openai (Codex)`));
    process.exitCode = 1;
    return;
  }

  const harness = opts.harness || DEFAULT_HARNESS;
  if (!AGENT_HARNESSES.includes(harness)) {
    console.error(pc.red(`Invalid harness "${harness}". Use: ${AGENT_HARNESSES.join(', ')}`));
    process.exitCode = 1;
    return;
  }

  const authMethod = opts.authMethod || 'api_key';
  const secretMode = opts.secretMode || 'plaintext';
  const model = opts.model || selectedProvider.models[0].value;

  // --- Assembla API key (SecretRef) o subscription ---
  let apiKeySecret;
  let subscriptionConfig;
  if (authMethod === 'api_key') {
    if (secretMode === 'env') {
      const envName = opts.secretEnv || (providerName === 'claude' ? 'ANTHROPIC_API_KEY' : `${providerName.toUpperCase()}_API_KEY`);
      apiKeySecret = formatSecretForConfig('env', envName);
    } else if (secretMode === 'file') {
      if (!opts.secretFile) {
        console.error(pc.red('--secret-file is required with --secret-mode file'));
        process.exitCode = 1;
        return;
      }
      apiKeySecret = formatSecretForConfig('file', opts.secretFile);
    } else {
      // the key comes from a file (never on the command line, where other programs and the history see it) or, as
      // before, from --api-key
      let key = opts.apiKey;
      if (opts.apiKeyFile) {
        key = readApiKeyFile(opts.apiKeyFile);
        if (key === null) return;
      }
      if (!key || !key.trim()) {
        console.error(pc.red(opts.apiKeyFile ? 'The file given to --api-key-file is empty.' : '--api-key-file (or --api-key) is required, or use --secret-mode env/file'));
        process.exitCode = 1;
        return;
      }
      const err = validateApiKey(selectedProvider, key);
      if (err) { console.error(pc.red(err)); process.exitCode = 1; return; }
      apiKeySecret = formatSecretForConfig('plaintext', key.trim());
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
  if (!opts.skipHealth && authMethod === 'api_key') {
    const prompter = silentPrompter();
    const ok = await runHealthCheck(prompter, selectedProvider, apiKeySecret);
    if (!ok) console.log(pc.yellow(`  ${t('wizard.checks.health.failed_save_anyway')}`));
  }

  saveNonInteractiveConfig({ providerName, selectedProvider, authMethod, model, apiKeySecret, subscriptionConfig, harness });
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

function saveNonInteractiveConfig({ providerName, selectedProvider, authMethod, model, apiKeySecret, subscriptionConfig, harness }) {
  // --- Assembla e salva config ---
  const providerConfig = { name: providerName, auth_method: authMethod, model };
  if (apiKeySecret) {
    if (apiKeySecret.type === 'plaintext') providerConfig.api_key = apiKeySecret.value;
    else providerConfig.api_key_ref = apiKeySecret;
  }
  if (subscriptionConfig) {
    providerConfig.subscription = subscriptionConfig;
  }

  const config = {
    version: 1,
    active_provider: providerName,
    providers: { [providerName]: providerConfig },
    channels: {},
    harness,
  };

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
    console.log(`  Auth:       ${describeSecret(apiKeySecret)}`);
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
