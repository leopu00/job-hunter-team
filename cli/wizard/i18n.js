/**
 * cli/wizard/i18n.js — Node-side i18n helper
 *
 * Reads shared/locales/<lang>.json — same catalog used by bash i18n.sh.
 * Resolves $JHT_LANG with cascade: env → host.env → default 'en'.
 * Missing key: returns the key (visible in dev, doesn't break UI).
 *
 * Designed for CLI wizards / Node scripts that need the same strings
 * as the bash launcher (welcome messages, errors, common prompts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path strategy: cli/wizard/i18n.js → ../../shared/locales/
// In container: /app/cli/wizard/i18n.js → /app/shared/locales/
const LOCALES_DIR = path.resolve(__dirname, '..', '..', 'shared', 'locales');

let _cache = null;
let _cacheLang = null;

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
  if (process.env.JHT_LANG && process.env.JHT_LANG.trim()) {
    return process.env.JHT_LANG.trim();
  }
  const home = process.env.JHT_HOME || '/jht_home';
  const candidates = [
    process.env.JHT_HOST_ENV_FILE,
    path.join(home, 'host.env'),
    path.join(process.env.HOME || '/root', '.jht', 'host.env'),
  ].filter(Boolean);
  for (const p of candidates) {
    const v = readKvFile(p, 'JHT_LANG');
    if (v) return v;
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
  return /^(host_setup\.|welcome\.|wizard\.welcome_subtitle$|wizard\.aborted_prereqs$|wizard\.cloud\.|wizard\.step\.|wizard\.profile\.intro$|wizard\.provider\.|wizard\.oauth\.|wizard\.team\.(starting|start_failed)$|wizard\.cli\.|wizard\.(outro_done|outro_aborted|start\.ready|start\.done)$)/.test(key);
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
