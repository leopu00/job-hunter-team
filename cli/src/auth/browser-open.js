/**
 * Apertura URL nel browser di sistema.
 *
 * Supporta macOS (open), Linux (xdg-open), Windows (cmd start),
 * WSL (wslview). Rileva ambienti SSH dove il browser non è disponibile.
 */

import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { isContainer } from '../../../shared/runtime/container.js';

/**
 * Rileva se siamo in un ambiente remoto (SSH) dove non c'è browser.
 * @returns {boolean}
 */
export function isRemoteEnvironment() {
  return !!(process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION);
}

/**
 * Rileva se siamo in WSL (Windows Subsystem for Linux).
 * @returns {boolean}
 */
function isWSL() {
  try {
    const release = execSync('uname -r 2>/dev/null', { encoding: 'utf-8' });
    return /microsoft/i.test(release);
  } catch {
    return false;
  }
}

/**
 * Determina il comando per aprire un URL nel browser.
 * @returns {string | null} comando, o null se non disponibile
 */
function resolveBrowserCommand() {
  if (isContainer()) return null;
  if (isRemoteEnvironment()) return null;

  const os = platform();
  if (os === 'darwin') return 'open';
  if (os === 'win32') return 'cmd /c start ""';
  // Linux
  if (isWSL()) {
    try {
      execSync('command -v wslview', { stdio: 'ignore' });
      return 'wslview';
    } catch { /* fallthrough */ }
  }
  try {
    execSync('command -v xdg-open', { stdio: 'ignore' });
    return 'xdg-open';
  } catch {
    return null;
  }
}

/**
 * Apre un URL nel browser di sistema.
 * @param {string} url
 * @returns {{ ok: boolean, manual: boolean }} ok=true se aperto, manual=true se serve fallback manuale
 */
export function openInBrowser(url) {
  const command = resolveBrowserCommand();
  if (!command) {
    return { ok: false, manual: true };
  }
  try {
    execSync(`${command} "${url}"`, { stdio: 'ignore' });
    return { ok: true, manual: false };
  } catch {
    return { ok: false, manual: true };
  }
}

/**
 * Verifica se il browser è disponibile nell'ambiente corrente.
 * @returns {boolean}
 */
export function hasBrowserSupport() {
  return resolveBrowserCommand() !== null;
}
