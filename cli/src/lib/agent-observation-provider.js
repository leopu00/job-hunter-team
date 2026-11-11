/**
 * The provider the team runs on, as far as the words about a blocked agent need it: its name, how a person calls it,
 * and whether it works with an API key (glm and kimi on pi) or with a login. Read from the configuration, never from the
 * key; a configuration that cannot be read gives null, and the words then say «the provider».
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { harnessOf } from '../../../shared/runtime/agent-harness.js';
import { PI_API_PROVIDERS, piApiProvider } from '../../../shared/runtime/provider-models.js';

/** @returns {{ name: string, label: string, apiKey: boolean } | null} */
export function activeProviderOf(config) {
  const active = typeof config?.active_provider === 'string' ? config.active_provider.trim() : '';
  if (!active) return null;
  const pi = piApiProvider(active);
  if (pi) {
    const apiKey = harnessOf(config) === 'pi' && config?.providers?.[active]?.auth_method === 'api_key';
    return { name: pi, label: PI_API_PROVIDERS[pi].label, apiKey };
  }
  return { name: active, label: active, apiKey: false };
}

export function readActiveProvider(home = JHT_HOME) {
  try { return activeProviderOf(JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf8'))); } catch { return null; }
}
