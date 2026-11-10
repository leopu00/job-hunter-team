/**
 * The provider login step of `jht setup`.
 *
 * A login that is already there ends the step at once: the wizard asks for the same marker file the app and
 * the team's start ask for (desktop onboarding, cli/src/commands/pid1.js), not for a file that appears after
 * the wizard began. Codex keeps its login in `.codex/auth.json`; waiting for another name, or for a newer
 * modification time, made a valid login wait for ever.
 */
import fs from 'node:fs';
import { runCodexLoginStep } from './codex-device-login.js';
import { runPiLoginStep, announcePiLogin } from './pi-login.js';
import { PI_LOGIN_MARKER, inspectPiLogin } from '../../shared/runtime/agent-harness.js';

/** Per provider CLI, the marker that exists only after its login (the same files as the app's check). */
const LOGIN_MARKERS = {
  claude: ['.claude/.credentials.json'],
  codex: ['.codex/auth.json'],
  kimi: ['.kimi/credentials/kimi-code.json'],
  pi: [PI_LOGIN_MARKER],
};

/** Where the team's home is seen from here: the container's two, and JHT_HOME when the wizard runs on the host. */
export function loginHomes(env = process.env) {
  return ['/jht_home', '/home/jht', env.JHT_HOME].filter((home) => typeof home === 'string' && home);
}

/** What Pi's auth.json says: at most this many bytes are read, and only the names of its entries are used. */
const PI_LOGIN_MAX_BYTES = 256 * 1024;
const readPiLoginFile = (path) => {
  const info = fs.lstatSync(path);
  if (!info.isFile() || info.size === 0 || info.size > PI_LOGIN_MAX_BYTES) return '';
  return fs.readFileSync(path, 'utf8');
};

/**
 * Pi's login for `provider` as it stands: `{ path, state, found, needs }`, or null when there is no auth.json. A file that is there is
 * not a login of the provider of the setup: Pi keeps one entry per service, and a file with only Anthropic's (a Claude subscription,
 * billed per token when used from Pi) is `other_provider`. `state` is the one of inspectPiLogin; nothing but the entry names is kept.
 */
export function readPiLogin(provider, { homes = loginHomes(), exists = fs.existsSync, read = readPiLoginFile } = {}) {
  for (const home of homes) {
    const path = `${home.replace(/\/+$/, '')}/${PI_LOGIN_MARKER}`;
    if (!exists(path)) continue;
    let text = '';
    try {
      text = read(path);
    } catch {
      text = '';
    }
    return { path, ...inspectPiLogin(text, provider) };
  }
  return null;
}

/**
 * The marker of a login that exists, or null. For Pi with a `provider` the file must hold that provider's own entry (a provider this
 * release has no entry name for keeps the old rule: the file is there).
 */
export function findProviderLogin(cmdName, { homes = loginHomes(), exists = fs.existsSync, provider, read } = {}) {
  if (cmdName === 'pi' && provider) {
    const seen = readPiLogin(provider, { homes, exists, ...(read ? { read } : {}) });
    return seen && (seen.state === 'ok' || seen.state === 'no_rule') ? seen.path : null;
  }
  for (const home of homes) {
    for (const marker of LOGIN_MARKERS[cmdName] || []) {
      const path = `${home.replace(/\/+$/, '')}/${marker}`;
      if (exists(path)) return path;
    }
  }
  return null;
}

/** Polls for the marker; the path found, or null at the deadline. */
export async function waitForProviderLogin(cmdName, timeoutMs, { find = findProviderLogin, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const found = find(cmdName);
    if (found) return found;
    if (now() >= deadline) return null;
    await sleep(3000);
  }
}

/**
 * The step. Returns the marker found, or null when the login did not come (the wizard stops there).
 * Codex and Pi log in here; the other providers retain their separate-terminal flow.
 */
export async function runProviderLoginStep({
  cmdName, label, isVps, prompter, t, tf, provider, model, read = readPiLogin,
  find = (name) => findProviderLogin(name, { provider }), wait = waitForProviderLogin, login, report,
}) {
  const already = find(cmdName);
  if (already) {
    if (cmdName === 'pi') await announcePiLogin({ prompter, tf, provider, model, read, path: already });
    else await prompter.note(tf('wizard.oauth.detected', cmdName, already), tf('wizard.oauth.inline_title', label));
    return already;
  }
  if (cmdName === 'codex') return runCodexLoginStep({ prompter, t, tf, find, login, report });
  if (cmdName === 'pi') return runPiLoginStep({ prompter, t, tf, find, login, report, provider, model, read });
  await prompter.note(
    tf(isVps ? 'wizard.oauth.notify_body' : 'wizard.oauth.notify_body_local', cmdName, label),
    tf('wizard.oauth.notify_title', label),
  );
  const spinner = prompter.progress(tf('wizard.oauth.waiting', cmdName));
  const found = await wait(cmdName, 30 * 60 * 1000);
  if (!found) {
    spinner.stop(t('wizard.oauth.timeout'));
    return null;
  }
  spinner.stop(tf('wizard.oauth.detected', cmdName, found));
  return found;
}
