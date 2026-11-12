/**
 * `jht providers harness` and the install of Pi: the part of `jht providers` that belongs to the harness
 * (shared/runtime/agent-harness.js), kept out of providers.js.
 */
import { readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { writePrivateJson } from '../lib/secure-config-io.js';
import { AGENT_HARNESSES, DEFAULT_HARNESS, PI_IMAGE_BIN, PI_LOGIN_MARKER, harnessOf, harnessProblem, piApiKeyConfigured } from '../../../shared/runtime/agent-harness.js';
import { c, DIM, RESET } from './_colors.js';
import { handleHarnessJson } from './providers-harness-json.js';
import { RELEASE_HARNESS } from '../../../shared/runtime/release-providers.js';
import { marks } from '../lib/ui.js';

const CONFIG_PATH = join(JHT_HOME, 'jht.config.json');
const OK = c.green(marks().ok);
const ERR = c.red(marks().fail);

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

// Pi (the `pi` harness) is not installed by `jht providers update`: it comes with the image, from the
// reviewed lock of shared/runtime/pi-harness, in /opt/jht-pi (root's, which the agents run and cannot change).
// `jht providers update pi` is the check that it is there and answers: installing one under /opt/jht-deps
// would only leave a Pi that the agents can write. It is never in UPDATE_TARGETS (the boot update).
export function checkPi({ run = spawnSync, log = console } = {}) {
  console.log(`\n  ${DIM}── Checking pi ──${RESET}`);
  console.log(`  ${DIM}pi comes with the image, from the reviewed lock of this release (${PI_IMAGE_BIN})${RESET}`);
  const r = run(PI_IMAGE_BIN, ['--version'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' } });
  if (r.error || r.status !== 0) {
    log.error(`  ${ERR}  pi does not answer from ${PI_IMAGE_BIN}: this image has no pi of its own (an older image?). Update the image.`);
    process.exitCode = 1;
    return;
  }
  log.log(`  ${OK}  pi ${String(r.stdout).trim()}`);
}

/** True when Pi needs nothing more for this config: the API key of glm/kimi, or the login of Pi under the team's home. */
export function piReady(config, home = JHT_HOME) {
  return piApiKeyConfigured({ ...config, harness: 'pi' }) || existsSync(join(home, PI_LOGIN_MARKER));
}

/** `jht providers harness`: added to the providers command, so providers.js does not grow. */
export function registerProvidersHarness(program) {
  const providers = program.commands.find((cmd) => cmd.name() === 'providers');
  providers
    .command('harness [name]')
    .description('Which program drives the agents: codex (default) or pi. Without a name, print the current one.')
    .option('--json', 'One JSON line for the desktop app: the harness, whether pi is allowed, the state of the login')
    .action((name, opts) => (opts.json ? handleHarnessJson(name, { configPath: CONFIG_PATH, home: JHT_HOME }) : handleHarness(name)));
}

// jht providers harness [codex|pi]: which program drives the agents. Without a name it says the current one.
// The launcher reads the same key (`harness`) at every agent start and refuses what this refuses.
export async function handleHarness(name) {
  let config = {};
  if (await fileExists(CONFIG_PATH)) {
    try { config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8')); } catch {
      console.error(`${ERR}  ${CONFIG_PATH} cannot be read: fix it, or run: jht setup`);
      process.exitCode = 1;
      return;
    }
  }
  if (!name) {
    const current = harnessOf(config);
    if (current === null) {
      console.error(`${ERR}  harness '${config.harness}' is not one of: ${AGENT_HARNESSES.join(', ')}. Fix it with: jht providers harness codex`);
      process.exitCode = 1;
      return;
    }
    console.log(current);
    return;
  }
  const wanted = name.trim().toLowerCase();
  if (!AGENT_HARNESSES.includes(wanted)) {
    console.error(`${ERR}  harness '${name}' unrecognized. Supported: ${AGENT_HARNESSES.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  // this release runs the agents only on its harness (shared/runtime/release-providers.js); the code of the others stays
  if (wanted !== RELEASE_HARNESS) {
    console.error(`${ERR}  harness '${wanted}' is not offered in this release: the agents run on ${RELEASE_HARNESS}. Set it up with: jht setup`);
    process.exitCode = 1;
    return;
  }
  if (!config.active_provider) {
    console.error(`${ERR}  no active provider yet. Run: jht setup`);
    process.exitCode = 1;
    return;
  }
  const issue = harnessProblem(wanted, config.active_provider, config.providers?.[config.active_provider]?.auth_method);
  if (issue) {
    console.error(`${ERR}  ${issue}`);
    process.exitCode = 1;
    return;
  }
  const previous = harnessOf(config) ?? DEFAULT_HARNESS;
  config.harness = wanted;
  writePrivateJson(CONFIG_PATH, config);
  if (previous === wanted) {
    console.log(`  ${OK} harness already active: ${wanted}`);
    return;
  }
  console.log(`  ${OK} harness: ${previous} → ${wanted}`);
  // Said only when Pi is not ready for this provider: a key already in the config (glm, kimi) or a login of Pi already
  // there is everything it needs, and telling the person to install and sign in again is wrong.
  if (wanted === 'pi' && !piReady(config)) {
    console.log(`  ${DIM}Install Pi and sign in to it: jht providers update pi, then jht setup (keep the configuration)${RESET}`);
  }
  console.log(`  ${DIM}Restart the team to apply: jht team stop --all && jht team start${RESET}`);
}
