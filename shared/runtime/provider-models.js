import { readFileSync } from 'node:fs';

// Also read by .launcher/role-models.sh; the providers that run only on pi with an API key, and their models by class.
const text = readFileSync(new URL('./provider-models.list', import.meta.url), 'utf8');
// a test that replaces the file system answers with no text: no table, and the tests that do not need it go on
const rows = typeof text === 'string' ? text.split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => line.split('|')) : [];

/** `{ glm: { piProvider: 'zai', keyVariable: 'ZAI_API_KEY', label }, kimi: ... }` */
export const PI_API_PROVIDERS = Object.freeze(Object.fromEntries(rows.filter(([kind]) => kind === 'provider')
  .map(([, name, piProvider, keyVariable, label]) => [name, Object.freeze({ piProvider, keyVariable, label })])));

/** `{ glm: { sol: 'glm-5.3', ... } }` */
export const PI_API_MODELS = Object.freeze(Object.fromEntries(Object.keys(PI_API_PROVIDERS).map((name) => [name,
  Object.freeze(Object.fromEntries(rows.filter(([kind, provider]) => kind === 'model' && provider === name)
    .map(([, , modelClass, model]) => [modelClass, model])))])));

/** The names the config and the people use for these providers (moonshot is Moonshot's own name for kimi). */
export const PI_API_ALIASES = Object.freeze({ moonshot: 'kimi' });

export function piApiProvider(name) {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const canonical = PI_API_ALIASES[key] ?? key;
  return PI_API_PROVIDERS[canonical] ? canonical : null;
}
