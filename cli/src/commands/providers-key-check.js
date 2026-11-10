/**
 * `jht providers check-key` and the check that `jht team start` makes before it lights anything: does the provider
 * accept the API key of the active provider? Only for the providers that run on pi with a key (glm, kimi): the
 * ones of the first call that used to say a wrong key only inside the Pi session (shared/runtime/provider-key-check.js).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { harnessOf } from '../../../shared/runtime/agent-harness.js';
import { piApiProvider } from '../../../shared/runtime/provider-models.js';
import { checkPiApiKey, rejectedKeyMessage } from '../../../shared/runtime/provider-key-check.js';
import { resolveSecret } from '../../wizard/secret-ref.js';
import { c } from './_colors.js';

const CONFIG_PATH = join(JHT_HOME, 'jht.config.json');

/**
 * What `check-key` exits with when the provider refuses the key. Not 1: a CLI that does not know the command (an older image),
 * a missing file or a crash all exit 1, and none of them is a verdict on the key.
 */
export const KEY_REFUSED_EXIT_CODE = 3;

/** The key the config points to for the active provider: a reference or the key itself. Empty when there is none to find. */
export function activeKeyOf(config) {
  const entry = config?.providers?.[config?.active_provider] ?? {};
  let secret = entry.api_key_ref ?? entry.api_key;
  if (secret && typeof secret === 'object' && !secret.type && secret.source) secret = { ...secret, type: 'ref' };
  return resolveSecret(secret);
}

/**
 * The verdict on the key of a config. `not_applicable` for any config that is not glm/kimi on pi with an API key.
 * Never throws and never prints.
 */
export async function checkConfiguredKey(config, options = {}) {
  const provider = piApiProvider(config?.active_provider);
  const method = config?.providers?.[config?.active_provider]?.auth_method;
  if (!provider || harnessOf(config) !== 'pi' || method !== 'api_key') return { state: 'not_applicable' };
  return checkPiApiKey(provider, activeKeyOf(config), options);
}

/** The sentence that refuses a start, or null when the start may go on (also when the key could not be tried). */
export async function keyRefusal(config, options = {}) {
  const verdict = await checkConfiguredKey(config, options);
  return verdict.state === 'rejected' ? rejectedKeyMessage(verdict.label) : null;
}

export function registerProvidersKeyCheck(program) {
  const providers = program.commands.find((cmd) => cmd.name() === 'providers');
  providers
    .command('check-key', { hidden: true })
    .description('Ask the provider whether it accepts the API key (glm and kimi on pi). Exit 3 only when the key is refused.')
    .option('--quiet', 'Print only when the key is refused')
    .action(async (opts) => {
      let config = {};
      try { config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8')); } catch { /* no readable config: nothing to check */ }
      const verdict = await checkConfiguredKey(config);
      if (verdict.state === 'rejected') {
        console.error(c.red(rejectedKeyMessage(verdict.label)));
        process.exitCode = KEY_REFUSED_EXIT_CODE;
      } else if (!opts.quiet && verdict.state === 'valid') {
        console.log(`${verdict.label}: the API key is accepted.`);
      } else if (!opts.quiet && verdict.state === 'unverified') {
        console.log(c.dim(`${verdict.label}: could not check the API key (${verdict.reason}); the first call of an agent will tell.`));
      }
    });
}
