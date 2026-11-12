/**
 * The key step of `jht setup` for the providers that run on Pi with an API key (GLM of Z.ai, Kimi of Moonshot).
 *
 * The key is typed hidden (nothing is echoed, and it is not in the history or on a command line), checked with the provider
 * (the list of its models, no tokens) and, once the provider has not refused it, kept in the key store of the container
 * (key-store.js): the config holds only the path. The same rules as `jht setup --non-interactive --api-key-stdin`.
 */
import { spawnSync } from 'node:child_process';
import { checkPiApiKey } from '../../shared/runtime/provider-key-check.js';
import { isLauncherSafePath, keyShapeProblem, keyStoreDir, storeApiKey } from './key-store.js';

/** How many times a key the provider refuses is asked again before the setup stops. */
export const KEY_ATTEMPTS = 3;

/**
 * Asks for the key and keeps it. Returns the path of the file in the key store, or null when no key was kept (the setup stops, with
 * nothing saved): the words said to the person are in `prompter.note`, and none of them holds the key.
 * @param {import('./prompts.js').WizardPrompter} prompter
 * @param {{ t: Function, tf: Function, choice: { value: string, label: string, keyVariable: string }, check?: Function, store?: Function, storeDir?: string, platform?: string }} params
 */
export async function askPiApiKey(prompter, { t, tf, choice, check = checkPiApiKey, store = storeApiKey, storeDir = keyStoreDir(), platform = process.platform, onVerdict = () => {} }) {
  if (platform !== 'win32' && !isLauncherSafePath(storeDir)) {
    await prompter.note(tf('wizard.key.store_unusable', storeDir), t('wizard.key.title'));
    return null;
  }
  return askKey(prompter, { t, tf, choice, check, keep: store, intro: 'wizard.key.intro', onVerdict });
}

async function askKey(prompter, { t, tf, choice, check, keep, intro, onVerdict = () => {} }) {
  // the intro of glm/kimi names the provider in the command without questions (the one chosen, never a list)
  const args = intro === 'wizard.key.intro' ? [choice.label, choice.value, choice.keyVariable] : [choice.label, choice.keyVariable];
  await prompter.note(tf(intro, ...args), t('wizard.key.title'));
  for (let attempt = 1; attempt <= KEY_ATTEMPTS; attempt += 1) {
    const typed = await prompter.password({
      message: tf('wizard.key.prompt', choice.label),
      validate: (value) => {
        const key = String(value ?? '').trim();
        if (key === '') return t('wizard.key.empty');
        return keyShapeProblem(key) ? t('wizard.key.shape') : undefined;
      },
    });
    const key = String(typed ?? '').trim();
    // the prompt refuses these too; a prompter that does not run `validate` gets the same answer here
    if (key === '' || keyShapeProblem(key)) {
      await prompter.note(`${t('wizard.key.shape')}\n${attempt < KEY_ATTEMPTS ? t('wizard.key.try_again') : t('wizard.key.gave_up')}`, t('wizard.key.title'));
      continue;
    }
    const verdict = await check(choice.value, key);
    if (verdict.state === 'rejected') {
      await prompter.note(`${tf('wizard.key.rejected', verdict.label)}\n${attempt < KEY_ATTEMPTS ? t('wizard.key.try_again') : t('wizard.key.gave_up')}`, t('wizard.key.title'));
      continue;
    }
    // the verdict of the key it keeps, for the end of the setup: «all set» is not true on an empty account
    onVerdict(verdict);
    if (verdict.state === 'valid') await prompter.note(tf('wizard.key.accepted', verdict.label), t('wizard.key.title'));
    else if (verdict.state === 'no_credit') await prompter.note(tf('wizard.key.no_credit', verdict.label), t('wizard.key.title'));
    else await prompter.note(tf('wizard.key.unchecked', verdict.label, verdict.reason), t('wizard.key.title'));
    try {
      return keep(choice.value, key);
    } catch (err) {
      await prompter.note(tf('wizard.key.not_kept', err.message), t('wizard.key.title'));
      return null;
    }
  }
  return null;
}

/** OpenAI's own light call (the list of models, no tokens): the same verdict shape as checkPiApiKey. */
export async function checkOpenAiKey(key, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const label = 'OpenAI';
  if (typeof fetchImpl !== 'function') return { state: 'unverified', label, reason: 'no network client' };
  try {
    const res = await fetchImpl('https://api.openai.com/v1/models', {
      method: 'GET', headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) return { state: 'rejected', label, httpStatus: 401 };
    if (res.ok) return { state: 'valid', label, httpStatus: res.status };
    return { state: 'unverified', label, httpStatus: res.status, reason: `HTTP ${res.status}` };
  } catch (err) {
    const name = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : String(err?.cause?.code ?? err?.code ?? 'connection error');
    return { state: 'unverified', label, reason: name };
  }
}

/**
 * The OpenAI key for Codex: typed hidden and checked like the others, but held in memory only. It is not written by this setup: it is
 * handed to Codex's own `codex login --with-api-key` on the standard input (runCodexApiKeyLogin), and Codex keeps it where it keeps
 * every sign-in (auth.json of the team's home), which is what the rest of the product already looks for.
 * Returns the key, or null when none was accepted (the setup stops with nothing saved).
 */
export async function askCodexApiKey(prompter, { t, tf, check = checkOpenAiKey }) {
  const choice = { value: 'openai', label: 'OpenAI', keyVariable: 'OPENAI_API_KEY' };
  return askKey(prompter, { t, tf, choice, check: (_name, key) => check(key), keep: (_name, key) => key, intro: 'wizard.key.intro_codex' });
}

/** `codex login --with-api-key`: the key on the standard input of Codex, never in an argument. The result is Codex's own. */
export function runCodexApiKeyLogin(key, { spawn = spawnSync, env = process.env } = {}) {
  return spawn('codex', ['login', '--with-api-key'], { input: `${key}\n`, stdio: ['pipe', 'ignore', 'ignore'], env, timeout: 60 * 1000 });
}
