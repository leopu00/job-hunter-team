/**
 * The provider login step of `jht setup`.
 *
 * A login that is already there ends the step at once: the wizard asks for the same marker file the app and
 * the team's start ask for (desktop onboarding, cli/src/commands/pid1.js), not for a file that appears after
 * the wizard began. Codex keeps its login in `.codex/auth.json`; waiting for another name, or for a newer
 * modification time, made a valid login wait for ever.
 */
import fs from 'node:fs';

/** Per provider CLI, the marker that exists only after its login (the same files as the app's check). */
const LOGIN_MARKERS = {
  claude: ['.claude/.credentials.json'],
  codex: ['.codex/auth.json'],
  kimi: ['.kimi/credentials/kimi-code.json'],
};

/** Where the team's home is seen from here: the container's two, and JHT_HOME when the wizard runs on the host. */
export function loginHomes(env = process.env) {
  return ['/jht_home', '/home/jht', env.JHT_HOME].filter((home) => typeof home === 'string' && home);
}

/** The marker of a login that exists, or null. */
export function findProviderLogin(cmdName, { homes = loginHomes(), exists = fs.existsSync } = {}) {
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
 * On a VPS the person logs in from another terminal over SSH; on this computer, from another terminal here.
 */
export async function runProviderLoginStep({ cmdName, label, isVps, prompter, t, tf, find = findProviderLogin, wait = waitForProviderLogin }) {
  const already = find(cmdName);
  if (already) {
    await prompter.note(tf('wizard.oauth.detected', cmdName, already), tf('wizard.oauth.notify_title', label));
    return already;
  }
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
