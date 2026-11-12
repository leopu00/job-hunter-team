// Whether the active provider of a config has its sign-in in the team's home: the marker file each provider's CLI
// writes only after the login (shared/runtime/agent-harness.js). glm and kimi on pi have no login: the API key of the
// config counts. Used by the boot of the container (pid1: the team starts only with a sign-in) and by `jht doctor` (a
// setup stopped at the login screen leaves a config that looks complete).
import { access, lstat, readFile } from 'node:fs/promises';
import { PI_LOGIN_MARKER, inspectPiLogin, loginMarkerOf, piApiKeyConfigured } from '../../../shared/runtime/agent-harness.js';

export async function providerSignedIn(cfg, home) {
  try {
    if (piApiKeyConfigured(cfg)) return true;
    const relative = loginMarkerOf(cfg);
    if (!relative) return false; // a provider without a marker: unknown, never signed in
    const marker = `${home}/${relative}`;
    await access(marker);
    // Pi's file has one entry per service: it is the sign-in of THIS provider only when its own entry is there (a file with only
    // Anthropic's, a Claude subscription billed per token from Pi, does not start the team). Only the entry names are looked at.
    if (relative === PI_LOGIN_MARKER) {
      // a regular file of a sane size only (as shared/skills/pi_login.py): a FIFO or a huge file must not stop the boot on a read
      const info = await lstat(marker);
      if (!info.isFile() || info.size <= 0 || info.size > 256 * 1024) return false;
      const seen = inspectPiLogin(await readFile(marker, 'utf-8'), cfg.active_provider);
      return seen.state === 'ok' || seen.state === 'no_rule';
    }
    return true;
  } catch {
    return false;
  }
}
