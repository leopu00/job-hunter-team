/**
 * The names of the team's roles as the person reads them (JHT-T358): the reader of shared/i18n/role-names.json for the CLI, the
 * wizard, the app and the site. The ids (sessions CAPITANO, SCOUT-2, folders agents/<role>, the database) never change.
 *
 *   roleName('capitano', 'hu')       -> 'Kapitány'
 *   agentTitle('SCOUT-2', 'hu')      -> 'Felderítő 2'
 *   fillRoles('Ask the {role:capitano}.', 'fr') -> 'Ask the Capitaine.'
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANGUAGES = new Set(['en', 'it', 'de', 'es', 'fr', 'pt', 'hu']);
const PLACEHOLDER = /\{role:([a-z]+)\}/g;

let roles = null;
/** The catalog's roles: { id: { lang: name } }. Empty when the file cannot be read (the ids are shown, capitalised). */
export function roleCatalog() {
  if (roles) return roles;
  try { roles = JSON.parse(readFileSync(join(HERE, 'role-names.json'), 'utf8')).roles ?? {}; } catch { roles = {}; }
  return roles;
}

function lang(code) {
  const two = String(code ?? '').toLowerCase().slice(0, 2);
  return LANGUAGES.has(two) ? two : 'en';
}

/** The role's name in `language`; an unknown role, capitalised. */
export function roleName(role, language) {
  const id = String(role ?? '').toLowerCase();
  const names = roleCatalog()[id];
  if (!names) return id.charAt(0).toUpperCase() + id.slice(1);
  return names[lang(language)] ?? names.en ?? id;
}

/** A session as the person reads it: the role's name, then the instance ('SCOUT-2' -> 'Felderítő 2'). */
export function agentTitle(session, language) {
  const [role, ...rest] = String(session ?? '').trim().toLowerCase().replace(/^jht-/, '').split('-');
  return [roleName(role, language), ...rest.filter(Boolean).map((part) => part.toUpperCase())].join(' ');
}

/** Every {role:<id>} of a text replaced with the name in `language`. */
export function fillRoles(text, language) {
  if (typeof text !== 'string' || !text.includes('{role:')) return text;
  return text.replace(PLACEHOLDER, (_whole, id) => roleName(id, language));
}
