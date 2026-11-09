/**
 * Pi's login in `jht setup`: Pi owns the sign-in (its /login), the wizard lends it the same terminal, as
 * it does for Codex (codex-device-login.js). Pi keeps the login in `<team home>/.pi/agent/auth.json`: the
 * folder the launcher gives every Pi agent through PI_CODING_AGENT_DIR, so the login is made once.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_CONFIG_DIR } from './setup-helpers.js';
import { recordLoginFailure } from './codex-device-login.js';
import { PI_IMAGE_BIN } from '../../shared/runtime/agent-harness.js';

/** Pi's arguments for a sign-in only: no identity files, no skills, no extensions, no MCP around it. */
export const PI_LOGIN_ARGS = ['-nc', '-na', '-ns', '-ne', '--no-mcp'];

/** The Pi of the image by its own path (the PATH has a folder the agents can write before it), else `pi`. */
export const piProgram = (exists = existsSync) => (exists(PI_IMAGE_BIN) ? PI_IMAGE_BIN : 'pi');

export function runPiLogin({ spawn = spawnSync, stdin = process.stdin, env = process.env, exists = existsSync } = {}) {
  const wasRaw = stdin.isRaw === true;
  const wasPaused = stdin.isPaused();
  stdin.pause();
  try {
    if (stdin.isTTY) stdin.setRawMode(false);
    return spawn(piProgram(exists), PI_LOGIN_ARGS, {
      stdio: 'inherit',
      env: {
        ...env,
        PI_CODING_AGENT_DIR: join(JHT_CONFIG_DIR, '.pi', 'agent'),
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
      },
      timeout: 30 * 60 * 1000,
    });
  } finally {
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
    if (!wasPaused) stdin.resume();
  }
}

async function failed(key, code, { prompter, t, report }) {
  try {
    report(code, t(key));
  } catch {
    await prompter.note(`pi_login_log_unavailable: ${t('wizard.oauth.log_unavailable')}`);
  }
  await prompter.note(`${code}: ${t(key)}`);
  return null;
}

/** The marker found, or null when the login did not come (the wizard stops there). */
export async function runPiLoginStep({
  prompter, t, tf, find, login = runPiLogin, report = recordLoginFailure,
}) {
  await prompter.note(t('wizard.oauth.pi_inline_body'), tf('wizard.oauth.inline_title', 'Pi'));
  let result;
  try {
    result = login();
  } catch {
    return failed('wizard.oauth.pi_failed', 'pi_login_failed', { prompter, t, report });
  }
  // A person who types /quit leaves Pi with a plain exit; what counts is the login that is there after it.
  if (result.error && result.error.code === 'ENOENT') {
    return failed('wizard.oauth.pi_failed', 'pi_login_missing_program', { prompter, t, report });
  }
  const found = find('pi');
  if (!found) {
    return failed(result.error || result.signal || result.status !== 0 ? 'wizard.oauth.pi_failed' : 'wizard.oauth.pi_missing',
      result.error || result.signal || result.status !== 0 ? 'pi_login_failed' : 'pi_login_missing', { prompter, t, report });
  }
  await prompter.note(tf('wizard.oauth.detected', 'pi', found), tf('wizard.oauth.inline_title', 'Pi'));
  return found;
}
