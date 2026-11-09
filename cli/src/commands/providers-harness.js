/**
 * `jht providers harness` and the install of Pi: the part of `jht providers` that belongs to the harness
 * (shared/runtime/agent-harness.js), kept out of providers.js.
 */
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { writePrivateJson } from '../lib/secure-config-io.js';
import { AGENT_HARNESSES, DEFAULT_HARNESS, harnessOf, harnessProblem } from '../../../shared/runtime/agent-harness.js';
import { c, DIM, RESET } from './_colors.js';
import { marks } from '../lib/ui.js';

const CONFIG_PATH = join(JHT_HOME, 'jht.config.json');
const OK = c.green(marks().ok);
const ERR = c.red(marks().fail);

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

// Pi (the `pi` harness) is not pinned in provider-versions.json: it installs from its own reviewed lock,
// shared/runtime/pi-harness, with the script that sits there (the one the launcher names when pi is missing).
// It is never in UPDATE_TARGETS: the boot update touches only the active provider's CLI.
const PI_INSTALL_SCRIPT = '/app/shared/runtime/pi-harness/install-pi.sh';

export function piUpdateSteps() {
  return [{ entrypoint: 'bash', args: [PI_INSTALL_SCRIPT] }];
}

export function announcePi() {
  console.log(`  ${DIM}pi: installed from the reviewed lock of this release (shared/runtime/pi-harness)${RESET}`);
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
  if (wanted === 'pi') {
    console.log(`  ${DIM}Install Pi and sign in to it: jht providers update pi, then jht setup (keep the configuration)${RESET}`);
  }
  console.log(`  ${DIM}Restart the team to apply: jht team stop --all && jht team start${RESET}`);
}

/** In `jht providers`: the program that drives the agents, only when it is not the default. */
export function printHarnessLine(config) {
  if (harnessOf(config) === DEFAULT_HARNESS) return;
  console.log(`  ${DIM}Harness: ${config.harness} (change it with: jht providers harness <${AGENT_HARNESSES.join('|')}>)${RESET}\n`);
}
