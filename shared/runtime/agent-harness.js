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

export const AGENT_HARNESSES = Object.freeze(['codex', 'pi']);
export const DEFAULT_HARNESS = 'codex';

/** Providers (the names jht.config.json uses, with the CLI aliases) on which pi may start. */
export const PI_PROVIDERS = Object.freeze(['openai', 'codex']);

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
  if (harness !== 'pi' || PI_PROVIDERS.includes(provider)) return null;
  if ((provider === 'claude' || provider === 'anthropic') && authMethod !== 'api_key') {
    return 'the pi harness is refused with a Claude subscription: Anthropic bills a subscription used from pi as extra usage, per token';
  }
  return `the pi harness supports only active_provider=openai for now (configured: '${provider ?? ''}')`;
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
