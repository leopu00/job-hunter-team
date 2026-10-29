/**
 * provider-logout — takes a provider's sign-in off the team's home (`jht agent-control provider ...`).
 *
 * The desktop app's «Disconnect the account» goes through this: the app asks (`status` or `logout`), the
 * box answers one closed JSON line. What it does is `rm` of the provider's own credential files, which any
 * agent of the team can already do for itself; the app's confirmation is in the app, not here.
 *
 * - The provider is never an argument: it is the team's active provider (`jht.config.json`), and only a
 *   subscription sign-in counts. The files are a CLOSED list per provider, written here. The config only
 *   chooses among the three lists, it never names a path (an agent can write that file).
 * - Each file is removed with `unlink`, only if EVERY component of its path under the home is a plain
 *   directory and the last one a regular file: a link anywhere on the way, or a directory in place of the
 *   file, is left alone and counted. Never recursive, never following a link.
 * - It answers `authenticated:false` only if nothing of the list is left afterwards (checked again AFTER the
 *   unlinks, since an agent that was running may write the file back when it renews its token). Anything left
 *   is `provider_logout_incomplete`, never a «disconnected» that is not true.
 * - It only removes. The paths that mark a sign-in are read, never written, by the boot check (pid1.js
 *   `hasProviderCredentials`) and by the onboarding snapshot of the host wrapper; nothing copies them back.
 *   (The provider's own CLI rewrites its file when an agent that is still running renews its token.)
 */
import { lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** The credential files of each provider, relative to the home; the first one is the marker of a sign-in. */
export const CREDENTIAL_FILES = Object.freeze({
  claude: Object.freeze(['.claude/.credentials.json', '.claude/credentials.json', '.config/claude/credentials.json', '.config/claude/auth.json']),
  codex: Object.freeze(['.codex/auth.json', '.codex/credentials.json', '.config/codex/credentials.json']),
  kimi: Object.freeze([
    '.kimi/credentials/kimi-code.json', '.config/kimi-cli/credentials.json', '.kimi/kimi.json',
    '.kimi/config.json', '.kimi/credentials.json', '.config/kimi/config.json',
  ]),
});

/** The names the config may hold for each (the vendor's and the CLI's), the same ones the boot check accepts. */
const PROVIDER_OF = Object.freeze({
  claude: 'claude', anthropic: 'claude', codex: 'codex', openai: 'codex', kimi: 'kimi', moonshot: 'kimi',
});

/** 'absent' (not there), 'file' (a regular file, every directory on the way plain), or 'unsafe' (anything else). */
export function classify(home, relative) {
  const parts = relative.split('/');
  let current = home;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    let info;
    try {
      info = lstatSync(current);
    } catch (error) {
      return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'absent' : 'unsafe';
    }
    if (info.isSymbolicLink()) return 'unsafe';
    if (index === parts.length - 1) return info.isFile() ? 'file' : 'unsafe';
    if (!info.isDirectory()) return 'unsafe';
  }
  return 'unsafe';
}

function fail(code) {
  return { ok: false, error: code };
}

/** The team's active provider among the closed lists, or the reason it is none. */
function activeProvider(home) {
  let config;
  try {
    config = JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf-8'));
  } catch {
    return { error: 'provider_unknown' };
  }
  const name = String(config?.active_provider ?? '').toLowerCase();
  const provider = Object.hasOwn(PROVIDER_OF, name) ? PROVIDER_OF[name] : null;
  if (!provider) return { error: 'provider_unknown' };
  const entry = config?.providers?.[name];
  const method = entry && typeof entry === 'object' ? entry.auth_method : undefined;
  if ((method ?? 'subscription') !== 'subscription') return { error: 'provider_not_subscription' };
  return { provider };
}

const present = (home, provider) => CREDENTIAL_FILES[provider].filter((relative) => classify(home, relative) !== 'absent');

/** `{ok:true, provider, authenticated}`: signed in = the marker of the provider is there, in any form. */
export function providerStatus(home) {
  const { provider, error } = activeProvider(home);
  if (!provider) return fail(error);
  return { ok: true, provider, authenticated: classify(home, CREDENTIAL_FILES[provider][0]) !== 'absent' };
}

/** Removes the provider's files and answers the truth: `authenticated:false` only if none of them is left. */
/** `unlink` is for the tests (an agent writing its file back the moment it is gone). */
export function providerLogout(home, { unlink = unlinkSync } = {}) {
  const { provider, error } = activeProvider(home);
  if (!provider) return fail(error);
  let removed = 0;
  for (const relative of CREDENTIAL_FILES[provider]) {
    if (classify(home, relative) !== 'file') continue;
    try {
      unlink(join(home, relative));
      removed += 1;
    } catch (failure) {
      if (failure?.code !== 'ENOENT') return fail('provider_logout_failed');
    }
  }
  // After, not before: a running agent may have written its file back.
  if (present(home, provider).length > 0) return fail('provider_logout_incomplete');
  return { ok: true, provider, authenticated: false, removed };
}

/** The door: `provider status|logout`, nothing else, no more words. */
export function runProvider(args, { write, home }) {
  const op = Array.isArray(args) && args.length === 1 ? args[0] : null;
  if (op !== 'status' && op !== 'logout') {
    write(`${JSON.stringify(fail('agent_control_invalid'))}\n`);
    return 100;
  }
  const out = op === 'status' ? providerStatus(home) : providerLogout(home);
  write(`${JSON.stringify(out)}\n`);
  return out.ok ? 0 : 1;
}
