/** Codex owns the device flow; the wizard lends it the same terminal. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import { JHT_LOGS_DIR } from '../src/jht-paths.js';

export function runCodexDeviceLogin({ spawn = spawnSync, stdin = process.stdin, env = process.env } = {}) {
  const wasRaw = stdin.isRaw === true;
  const wasPaused = stdin.isPaused();
  stdin.pause();
  try {
    if (stdin.isTTY) stdin.setRawMode(false);
    return spawn('codex', ['login', '--device-auth'], {
      stdio: 'inherit', env, timeout: 30 * 60 * 1000,
    });
  } finally {
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
    if (!wasPaused) stdin.resume();
  }
}

/** Only the closed error catalog goes to the log, never device codes or child output. */
export function recordLoginFailure(code, message, { dir = JHT_LOGS_DIR } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error('codex_login_log_unavailable');
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT
    | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  const fd = fs.openSync(join(dir, 'runtime.log'), flags, 0o600);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('codex_login_log_unavailable');
    fs.writeFileSync(fd, `${new Date().toISOString()} ${code}: ${message}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

async function failedLogin(key, { prompter, t, report }) {
  const code = key === 'wizard.oauth.codex_missing' ? 'codex_login_missing' : 'codex_login_failed';
  const message = `${code}: ${t(key)}`;
  try {
    report(code, t(key));
  } catch {
    await prompter.note(`codex_login_log_unavailable: ${t('wizard.oauth.log_unavailable')}`);
  }
  await prompter.note(message);
  return null;
}

export async function runCodexLoginStep({
  prompter, t, tf, find, login = runCodexDeviceLogin, report = recordLoginFailure,
}) {
  await prompter.note(t('wizard.oauth.inline_body'), tf('wizard.oauth.inline_title', 'Codex'));
  let result;
  try {
    result = login();
  } catch {
    return failedLogin('wizard.oauth.codex_failed', { prompter, t, report });
  }
  if (result.error || result.signal || result.status !== 0) {
    return failedLogin('wizard.oauth.codex_failed', { prompter, t, report });
  }
  const found = find('codex');
  if (!found) return failedLogin('wizard.oauth.codex_missing', { prompter, t, report });
  await prompter.note(tf('wizard.oauth.detected', 'codex', found), tf('wizard.oauth.inline_title', 'Codex'));
  return found;
}
