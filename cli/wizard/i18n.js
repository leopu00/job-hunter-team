/**
 * cli/wizard/i18n.js — Node-side i18n helper
 *
 * Reads shared/locales/<lang>.json — same catalog used by bash i18n.sh.
 * Resolves canonical i18n-prefs.json, then bootstrap env → host.env → 'en'.
 * Missing key: returns the key (visible in dev, doesn't break UI).
 *
 * Designed for CLI wizards / Node scripts that need the same strings
 * as the bash launcher (welcome messages, errors, common prompts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path strategy: cli/wizard/i18n.js → ../../shared/locales/
// In container: /app/cli/wizard/i18n.js → /app/shared/locales/
const LOCALES_DIR = path.resolve(__dirname, '..', '..', 'shared', 'locales');

let _cache = null;
let _cacheLang = null;
const VALID_LANGS = new Set(['en', 'it', 'hu', 'es', 'de', 'fr', 'pt']);

function readKvFile(filePath, key) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      if (trimmed.slice(0, eq) !== key) continue;
      return trimmed.slice(eq + 1).replace(/^["']|["']$/g, '');
    }
  } catch { /* ENOENT */ }
  return null;
}

function resolveLang() {
  const home = process.env.JHT_HOME || '/jht_home';
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(home, 'i18n-prefs.json'), 'utf8'));
    if (VALID_LANGS.has(prefs?.locale)) return prefs.locale;
  } catch { /* preference absent/malformed: continue with bootstrap inputs */ }
  const fromEnv = process.env.JHT_LANG?.trim();
  if (VALID_LANGS.has(fromEnv)) return fromEnv;
  const candidates = [
    process.env.JHT_HOST_ENV_FILE,
    path.join(home, 'host.env'),
    path.join(process.env.HOME || '/root', '.jht', 'host.env'),
  ].filter(Boolean);
  for (const p of candidates) {
    const v = readKvFile(p, 'JHT_LANG');
    if (VALID_LANGS.has(v)) return v;
  }
  return 'en';
}

function loadCatalog(lang) {
  if (_cache && _cacheLang === lang) return _cache;
  const target = path.join(LOCALES_DIR, `${lang}.json`);
  const fallback = path.join(LOCALES_DIR, 'en.json');
  let merged = {};
  try {
    merged = JSON.parse(fs.readFileSync(fallback, 'utf8'));
  } catch { /* missing fallback is bad but recoverable */ }
  if (lang !== 'en' && fs.existsSync(target)) {
    try {
      const overlay = JSON.parse(fs.readFileSync(target, 'utf8'));
      merged = { ...merged, ...overlay };
    } catch { /* malformed JSON, stick to en */ }
  }
  _cache = merged;
  _cacheLang = lang;
  return merged;
}

// Phase 1 of the launch tutorial is English-only. Existing hosts may still
// carry JHT_LANG=it; keep that choice for later copy, but source the approved
// T0-T1 onboarding keys from the English catalog.
function phase1English(key) {
  return /^(host_setup\.|welcome\.|wizard\.welcome_subtitle$|wizard\.aborted_prereqs$|wizard\.checks\.|wizard\.cloud\.|wizard\.step\.|wizard\.profile\.intro$|wizard\.provider\.|wizard\.oauth\.|wizard\.team\.(starting|start_failed)$|wizard\.cli\.|wizard\.(outro_done|outro_aborted|start\.ready|start\.done)$)/.test(key);
}

/**
 * Lookup a translated string by key. Falls back to en, then to the key itself.
 * @param {string} key — e.g. 'wizard.welcome_title'
 * @returns {string}
 */
export function t(key) {
  const lang = resolveLang();
  const cat = phase1English(key) ? loadCatalog('en') : loadCatalog(lang);
  const v = cat[key];
  if (typeof v === 'string') return v;
  return key;
}

/**
 * Lookup with printf-style %s substitution.
 * @param {string} key
 * @param  {...any} args
 * @returns {string}
 */
export function tf(key, ...args) {
  let template = t(key);
  for (const a of args) {
    template = template.replace(/%[ds]/, String(a));
  }
  return template;
}

/** Current resolved language (useful for downstream decisions). */
export function currentLang() {
  return resolveLang();
}

/** The seven languages of the product, in the order the picker shows them. */
export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'it', label: 'Italiano' },
  { value: 'hu', label: 'Magyar' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'pt', label: 'Português' },
];

function prefsFile(home) {
  return path.join(home || process.env.JHT_HOME || '/jht_home', 'i18n-prefs.json');
}

/** True when the user (or the host setup) already chose a language: i18n-prefs.json has a valid `locale`. */
export function hasLanguageChoice(home) {
  try {
    return VALID_LANGS.has(JSON.parse(fs.readFileSync(prefsFile(home), 'utf8'))?.locale);
  } catch { return false; }
}

/** The language of the system (`LC_ALL`, `LC_MESSAGES`, `LANG`: `it_IT.UTF-8` -> `it`), or null if it is none of the seven. */
export function systemLanguage(env = process.env) {
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const code = String(env[name] || '').trim().slice(0, 2).toLowerCase();
    if (VALID_LANGS.has(code)) return code;
    if (env[name] && !/^(c|posix)([._].*)?$/i.test(String(env[name]).trim())) return null; // a locale that is set and is not ours
  }
  return null;
}

/**
 * Save the user's language in i18n-prefs.json (the place every reader looks first). The other keys of the file stay,
 * the file is replaced whole. Throws for a code that is not one of the seven.
 */
export function saveLanguage(code, home) {
  if (!VALID_LANGS.has(code)) throw new Error(`Unknown language "${code}". Use: ${[...VALID_LANGS].join(', ')}`);
  const file = prefsFile(home);
  let prefs = {};
  try {
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) prefs = loaded;
  } catch { /* no file or unreadable: start from an empty one */ }
  prefs.locale = code;
  fs.mkdirSync(path.dirname(file), { recursive: true }); // a setup on a home that has no such folder yet
  const tmp = path.join(path.dirname(file), `.i18n-prefs.${process.pid}.${os.hostname()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(prefs, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(tmp, file);
  _cache = null;
  _cacheLang = null;
  return code;
}
