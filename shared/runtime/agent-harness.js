/**
 * agent-harness — the CLI that drives the agents: `codex` or `pi`.
 *
 * The provider (`active_provider`) says which account pays; the harness
 * (`harness` in jht.config.json, chosen in `jht setup`, changed with
 * `jht providers harness`) says which program talks to it. `codex` is the
 * default and the program of the provider (Codex with openai); `pi` is the
 * Pi coding agent in its TUI, inside tmux, like Codex and Kimi.
 *
 * The launcher (.launcher/spawn-lib.sh: JHT_AGENT_HARNESSES, jht_config_harness,
 * jht_agent_harness, jht_pi_provider_check) reads the same key and enforces the
 * same rules at the start of every agent; tests/test_agent_harness_catalog.py
 * keeps the two lists together. This module is what the CLI (setup,
 * `jht providers`) and the schema check against, so a refusal comes at setup
 * time and not when the team starts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { PI_API_ALIASES, PI_API_PROVIDERS } from './provider-models.js';

export const AGENT_HARNESSES = Object.freeze(['codex', 'pi']);
export const DEFAULT_HARNESS = 'codex';

/** Providers (the names jht.config.json uses, with the CLI aliases) on which pi may start. */
export const PI_PROVIDERS = Object.freeze(['openai', 'codex', ...Object.keys(PI_API_PROVIDERS), ...Object.keys(PI_API_ALIASES)]);

// Pi's own names for the sign-in of each provider, in <team home>/.pi/agent/auth.json (shared with shared/skills/pi_login.py).
const loginText = readFileSync(new URL('./pi-login-keys.list', import.meta.url), 'utf8');
const loginRows = typeof loginText === 'string' ? loginText.split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => line.split('|')) : [];
export const PI_LOGIN_KEYS = Object.freeze(Object.fromEntries(loginRows.map(([provider, keys]) => [provider, Object.freeze(keys.split(','))])));

/**
 * What the text of Pi's auth.json says about the sign-in of `provider`, never its values: only the NAMES of the entries are looked at.
 *   ok              an entry of Pi for this provider is there and is not empty;
 *   other_provider  the file has entries, none of them this provider's (a file with only Anthropic, say);
 *   empty           no entry at all;  unreadable  not a JSON object;  no_rule  a provider this release has no entry name for.
 * `found` is the names of the entries (lowercase words only, so nothing odd reaches a message), `needs` the names that would do.
 */
export function inspectPiLogin(text, provider) {
  const key = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  const needs = PI_LOGIN_KEYS[key] ?? [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { state: 'unreadable', found: [], needs };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { state: 'unreadable', found: [], needs };
  const found = Object.keys(data).filter((name) => /^[a-z0-9._-]{1,40}$/.test(name));
  const filled = (name) => data[name] !== null && typeof data[name] === 'object' && Object.keys(data[name]).length > 0;
  if (needs.length === 0) return { state: 'no_rule', found, needs };
  if (needs.some(filled)) return { state: 'ok', found, needs };
  return { state: found.length > 0 ? 'other_provider' : 'empty', found, needs };
}

/** The harness of a config: the key, or the default when it is absent. Anything else is not a harness. */
export function harnessOf(config) {
  const value = config?.harness;
  if (value === undefined || value === null) return DEFAULT_HARNESS;
  return AGENT_HARNESSES.includes(value) ? value : null;
}

/**
 * Why `harness` cannot run with this provider, or null when it can. The words are the launcher's:
 * a subscription to Claude used from pi is billed by Anthropic per token, as extra usage.
 */
export function harnessProblem(harness, provider, authMethod) {
  if (!AGENT_HARNESSES.includes(harness)) {
    return `harness must be one of: ${AGENT_HARNESSES.join(', ')}`;
  }
  if (harness === 'pi' && (provider in PI_API_PROVIDERS || provider in PI_API_ALIASES)) {
    // Z.ai and Moonshot charge by the token and pi has no subscription login for them: the API key only
    return authMethod === 'api_key' ? null : `the pi harness runs on ${provider} only with an API key (auth_method api_key)`;
  }
  if (harness !== 'pi' || PI_PROVIDERS.includes(provider)) return null;
  if ((provider === 'claude' || provider === 'anthropic') && authMethod !== 'api_key') {
    return 'the pi harness is refused with a Claude subscription: Anthropic bills a subscription used from pi as extra usage, per token';
  }
  return `the pi harness supports only active_provider=openai, glm or kimi for now (configured: '${provider ?? ''}')`;
}

/**
 * The Pi of the image: root's, in /opt/jht-pi, which the agents run and cannot change. The agents' PATH puts
 * /opt/jht-deps/bin (writable by them) first, so Pi is run by this path whenever it exists
 * (.launcher/spawn-harness.sh: jht_pi_bin).
 */
export const PI_IMAGE_BIN = '/opt/jht-pi/bin/pi';

/** Where each program keeps the marker that exists only after its login, under the team's home. */
export const PI_LOGIN_MARKER = '.pi/agent/auth.json';

/** True when the config puts the agents on pi AND the provider lets pi start (anything else is refused elsewhere). */
export function usesPi(config) {
  const provider = typeof config?.active_provider === 'string' ? config.active_provider.trim().toLowerCase() : '';
  return harnessOf(config) === 'pi' && PI_PROVIDERS.includes(provider);
}

/**
 * True when the config of a provider that runs on pi with an API key (glm, kimi) holds the key: a reference to a file that is there,
 * another kind of reference, or the key itself. Pi has no login for them, so this is their «signed in». Mirrored by config_ready()
 * in .launcher/agent-watchdog.sh.
 */
export function piApiKeyConfigured(config) {
  const provider = typeof config?.active_provider === 'string' ? config.active_provider.trim().toLowerCase() : '';
  if (!usesPi(config) || !(provider in PI_API_PROVIDERS || provider in PI_API_ALIASES)) return false;
  const entry = config.providers?.[config.active_provider] ?? {};
  const ref = entry.api_key_ref;
  if (ref && typeof ref === 'object' && ref.source === 'file') return typeof ref.path === 'string' && existsSync(ref.path);
  return Boolean(ref) || Boolean(entry.api_key);
}

const PROVIDER_LOGIN_MARKERS = Object.freeze({
  // kimi-cli 1.47+ keeps the OAuth credentials in .kimi/credentials/<plan>.json
  kimi: '.kimi/credentials/kimi-code.json',
  claude: '.claude/.credentials.json',
  anthropic: '.claude/.credentials.json',
  codex: '.codex/auth.json',
  openai: '.codex/auth.json',
});

/**
 * The file, under the team's home, that exists only after the login of the program that drives the agents:
 * the provider's CLI, or Pi's when the config puts the agents on Pi. Null for a provider this release does
 * not know. Mirrored by config_ready() in .launcher/agent-watchdog.sh.
 */
export function loginMarkerOf(config) {
  const provider = typeof config?.active_provider === 'string' ? config.active_provider.trim().toLowerCase() : '';
  const marker = PROVIDER_LOGIN_MARKERS[provider] ?? null;
  return marker && usesPi(config) ? PI_LOGIN_MARKER : marker;
}
