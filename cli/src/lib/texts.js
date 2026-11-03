/**
 * The words of the screens, in the language of the person.
 *
 * The language is the one the person already chose, looked for in this order: `JHT_LANG`, the app's own choice
 * (`i18n-prefs.json` in the team's home), the `language` of the configuration, the system's (`LC_ALL`,
 * `LC_MESSAGES`, `LANG`), and English. A language whose texts are not written yet answers in English, never in
 * a mix: a text missing from a language falls back to the English one.
 *
 * Machine output (`--json`, the markers) is never translated.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import en from './texts/en.js';
import it from './texts/it.js';

const CATALOGS = { en, it };
const KNOWN = new Set(['en', 'it', 'de', 'fr', 'es', 'hu', 'pt']);

function fromTag(tag) {
  const code = String(tag ?? '').toLowerCase().replace(/[-_.@].*$/, '');
  return KNOWN.has(code) ? code : null;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** The language of the person: one of the seven, whether or not its texts are written yet. */
export function resolveLanguage(env = process.env, home = JHT_HOME) {
  const asked = fromTag(env.JHT_LANG);
  if (asked) return asked;
  const app = fromTag(readJson(join(home, 'i18n-prefs.json'))?.locale);
  if (app) return app;
  const configured = fromTag(readJson(join(home, 'jht.config.json'))?.language);
  if (configured) return configured;
  // like the system's own rule: the first of these that is set decides, and «C» / «POSIX» / a language we do not
  // have mean English, not «look at the next one»
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    if (env[name]) return fromTag(env[name]) ?? 'en';
  }
  return 'en';
}

/** The language the texts are shown in: the person's, or English where theirs is not written yet. */
export function textLanguage(env = process.env, home = JHT_HOME) {
  const language = resolveLanguage(env, home);
  return CATALOGS[language] ? language : 'en';
}

/** A text by its key, with `{name}` replaced from `vars`. A key no catalog has is returned as it is (and a test fails on it). */
export function say(key, vars = {}, language = textLanguage()) {
  const catalog = CATALOGS[language] ?? en;
  const template = catalog[key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/**
 * A text to be written later, in the language it is shown in: a screen shows it in the person's, a `--json`
 * in English, so the machine output does not change with the language. A plain string passes through.
 */
export function later(key, vars = {}) {
  return { key, vars };
}

/** A `later(...)` (or a plain string) written in `language`. */
export function show(value, language = textLanguage()) {
  if (value && typeof value === 'object' && 'key' in value) return say(value.key, value.vars, language);
  return value;
}

export { CATALOGS };
