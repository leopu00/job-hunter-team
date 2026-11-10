/**
 * `jht providers harness [name] --json`: the same read and change as `jht providers harness`, as ONE JSON line
 * the desktop app reads (desktop/src-tauri/src/harness_choice.rs). A refusal is a closed `error` code, never the
 * sentence of the text form, and the exit code is 1.
 *
 *   {"ok":true,"harness":"pi","changed":true,"provider":"openai","pi_allowed":true,"login":"signed_out"}
 *
 * `login` is whether the marker of the program that drives the agents is there (Pi: `.pi/agent/auth.json`, Codex:
 * `.codex/auth.json`, ...): looked at with lstat, a regular file and nothing else, and not read, except Pi's: its file has one entry per
 * service, so only the NAMES of the entries are read, to see that the provider of the setup has its own (never a value). `not_needed` is a
 * provider used with an API key; `unknown` is a provider this release has no marker for, or a marker that cannot
 * be looked at.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writePrivateJson } from '../lib/secure-config-io.js';
import { AGENT_HARNESSES, DEFAULT_HARNESS, PI_LOGIN_MARKER, harnessOf, harnessProblem, inspectPiLogin, loginMarkerOf } from '../../../shared/runtime/agent-harness.js';

/** The state of the login that counts for this config, under `home`. */
export function loginState(config, home) {
  const method = config?.providers?.[config?.active_provider]?.auth_method;
  if (method === 'api_key') return 'not_needed';
  const marker = loginMarkerOf(config);
  if (!marker) return 'unknown';
  try {
    const info = lstatSync(join(home, marker));
    if (!info.isFile()) return 'unknown';
    // Pi keeps one entry per service in its file: it is the sign-in of THIS provider only when its own entry is there (a file with
    // only Anthropic's is a Claude subscription, billed per token from Pi, and not the sign-in of the OpenAI account).
    if (marker === PI_LOGIN_MARKER && info.size > 0 && info.size <= 256 * 1024) {
      const seen = inspectPiLogin(readFileSync(join(home, marker), 'utf8'), config.active_provider);
      return seen.state === 'ok' || seen.state === 'no_rule' ? 'signed_in' : 'signed_out';
    }
    return 'signed_in';
  } catch (error) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'signed_out' : 'unknown';
  }
}

/**
 * The entry NAMES of Pi's sign-in file when it is there but is not the sign-in of the provider of the setup (a file with only Anthropic's
 * entry, say), so the app can say what it holds: lowercase words only, at most eight, never a value. Empty in every other case.
 */
export function loginFound(config, home) {
  if (loginMarkerOf(config) !== PI_LOGIN_MARKER) return [];
  try {
    const info = lstatSync(join(home, PI_LOGIN_MARKER));
    if (!info.isFile() || info.size <= 0 || info.size > 256 * 1024) return [];
    const seen = inspectPiLogin(readFileSync(join(home, PI_LOGIN_MARKER), 'utf8'), config.active_provider);
    // an entry that carries the provider's own name but is empty is a broken login, not «another provider»: no names to say
    const others = seen.found.filter((name) => !seen.needs.includes(name));
    return seen.state === 'other_provider' ? others.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function report(config, home, changed) {
  const provider = typeof config.active_provider === 'string' ? config.active_provider.trim().toLowerCase() : '';
  const method = config.providers?.[config.active_provider]?.auth_method;
  return {
    ok: true,
    harness: harnessOf(config),
    changed,
    provider: /^[a-z]{1,16}$/.test(provider) ? provider : '',
    pi_allowed: provider !== '' && harnessProblem('pi', config.active_provider, method) === null,
    login: loginState(config, home),
    ...(loginFound(config, home).length > 0 ? { login_found: loginFound(config, home) } : {}),
  };
}

/** Reads (no name) or changes (a name) the harness and prints the one JSON line. */
export async function handleHarnessJson(name, { configPath, home, out = console.log }) {
  const fail = (code) => {
    out(JSON.stringify({ ok: false, error: code }));
    process.exitCode = 1;
  };
  let config = {};
  try {
    config = JSON.parse(await readFile(configPath, 'utf-8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') return fail('harness_config_unreadable');
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return fail('harness_config_unreadable');
  if (!name) {
    if (harnessOf(config) === null) return fail('harness_value_invalid');
    return out(JSON.stringify(report(config, home, false)));
  }
  const wanted = name.trim().toLowerCase();
  if (!AGENT_HARNESSES.includes(wanted)) return fail('harness_unrecognized');
  if (!config.active_provider) return fail('harness_no_provider');
  if (harnessProblem(wanted, config.active_provider, config.providers?.[config.active_provider]?.auth_method)) return fail('harness_refused');
  const previous = harnessOf(config) ?? DEFAULT_HARNESS;
  if (previous !== wanted) {
    config.harness = wanted;
    try {
      writePrivateJson(configPath, config);
    } catch {
      return fail('harness_write_failed');
    }
  }
  return out(JSON.stringify(report(config, home, previous !== wanted)));
}
