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

/** What the person sees for the provider of the setup, in the words of the product. */
export const PI_PROVIDER_LABEL = { openai: 'OpenAI (ChatGPT)', codex: 'OpenAI (ChatGPT)', glm: 'GLM (Z.ai)', kimi: 'Kimi', moonshot: 'Kimi' };
const labelOf = (provider) => PI_PROVIDER_LABEL[String(provider || '').toLowerCase()] ?? String(provider || 'the provider of the setup');

/** After a sign-in that is there and is the right one: the provider it is for and the model the team will use. */
export async function announcePiLogin({ prompter, tf, provider, model, path, read }) {
  const seen = typeof read === 'function' ? read(provider) : null;
  const names = seen && seen.found.length > 0 ? seen.found.join(', ') : '-';
  await prompter.note(tf('wizard.oauth.pi_found', labelOf(provider), names, model || '-', path), tf('wizard.oauth.inline_title', 'Pi'));
}

/**
 * The marker found, or null when the login did not come (the wizard stops there). A file that is there counts only when it holds the
 * provider of the setup: a file with only Anthropic's entry (the Claude subscription, billed per token from Pi) is said and refused.
 */
export async function runPiLoginStep({
  prompter, t, tf, find, login = runPiLogin, report = recordLoginFailure, provider, model, read = null,
}) {
  const before = typeof read === 'function' ? read(provider) : null;
  if (before && before.state !== 'ok' && before.state !== 'no_rule') {
    await prompter.note(tf('wizard.oauth.pi_wrong_provider', labelOf(provider), before.found.join(', ') || '-', labelOf(provider)), tf('wizard.oauth.inline_title', 'Pi'));
  }
  await prompter.note(tf('wizard.oauth.pi_inline_body', labelOf(provider)), tf('wizard.oauth.inline_title', 'Pi'));
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
    const seen = typeof read === 'function' ? read(provider) : null;
    if (seen && seen.state !== 'ok' && seen.state !== 'no_rule') {
      // the file is there but it is not the login of the provider of the setup: said with what it holds, and the setup stops
      const names = seen.found.join(', ') || '-';
      try {
        report('pi_login_wrong_provider', t('wizard.oauth.pi_failed'));
      } catch {
        // the failure is told below anyway
      }
      await prompter.note(`pi_login_wrong_provider: ${tf('wizard.oauth.pi_wrong_provider', labelOf(provider), names, labelOf(provider))}`);
      return null;
    }
    return failed(result.error || result.signal || result.status !== 0 ? 'wizard.oauth.pi_failed' : 'wizard.oauth.pi_missing',
      result.error || result.signal || result.status !== 0 ? 'pi_login_failed' : 'pi_login_missing', { prompter, t, report });
  }
  await announcePiLogin({ prompter, tf, provider, model, path: found, read });
  return found;
}
