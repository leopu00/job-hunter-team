/**
 * The folders the person sees on their computer, under ~/Documents/Job Hunter Team, named in their language (JHT-T360).
 *
 * Inside the container the paths never change (/jht_user/allegati, critiche, cv, output: the internal names every agent and
 * skill uses). On the person's disk each one has the name of their language, from ONE place: the catalog
 * shared/i18n/role-names.json («folders», the same catalog as the names of the roles), for the language the person chose
 * (resolveLanguage), unless jht.config.json has its own «folders» for a folder. Nothing else writes a name by hand.
 *
 * `onDisk` says which name is really there: the localized one when that folder exists, else the internal one (a folder made
 * before the names were translated, until the wrapper renames it). Whoever names a folder to the person uses that, so it never
 * names a folder that does not exist.
 */
import { existsSync, renameSync, writeFileSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readRegularFileText } from './secure-config-io.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JHT_HOME, JHT_USER_DIR } from '../jht-paths.js';
import { resolveLanguage } from './texts.js';

export const INTERNAL = Object.freeze(['allegati', 'critiche', 'cv', 'output']);
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

export function safeFolderName(name) {
  return typeof name === 'string' && name.trim() === name && SAFE.test(name) && !name.endsWith('.') && !RESERVED.test(name);
}

function readJson(path) {
  try { return JSON.parse(readRegularFileText(path, { maxBytes: 512 * 1024 })); } catch { return null; }
}

export function catalogPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const path of [join(here, '../../../shared/i18n/role-names.json'), '/app/shared/i18n/role-names.json']) {
    if (existsSync(path)) return path;
  }
  return null;
}

/** The names for a language, from the catalog; a name that is not a safe single folder name keeps the internal one. */
export function catalogFolders(language, catalog = readJson(catalogPath() ?? '')) {
  const names = catalog?.folders?.[language] ?? catalog?.folders?.en ?? {};
  return Object.fromEntries(INTERNAL.map((key) => [key, safeFolderName(names[key]) ? names[key] : key]));
}

/** The names the person's folders should have: their language's, with the overrides of jht.config.json «folders». */
export function userFolders({ env = process.env, home = JHT_HOME, catalog, language } = {}) {
  const lang = language ?? resolveLanguage(env, home);
  const names = catalogFolders(lang, catalog === undefined ? readJson(catalogPath() ?? '') : catalog);
  const own = readJson(join(home, 'jht.config.json'))?.folders ?? {};
  for (const key of INTERNAL) {
    if (safeFolderName(own[key]) && !INTERNAL.some((other) => other !== key &&
      (own[key].toLowerCase() === names[other].toLowerCase() || own[key].toLowerCase() === other))) names[key] = own[key];
  }
  return names;
}

/** The name each folder really has in the person's folder (`userDir`): the localized one if it exists, else the internal one. */
export function onDisk(folders, userDir, exists = existsSync) {
  return Object.fromEntries(INTERNAL.map((key) => {
    const wanted = folders[key] ?? key;
    return [key, wanted !== key && !exists(join(userDir, wanted)) && exists(join(userDir, key)) ? key : wanted];
  }));
}

/**
 * The names the wrapper really mounted (it writes «mounted» in user-folders.json after it bound each folder of the person's disk
 * on its internal path): inside the container the disk names cannot be seen, so this is what they are.
 */
export function mountedFolders(home = JHT_HOME) {
  const mounted = readJson(join(home, 'user-folders.json'))?.mounted ?? {};
  return Object.fromEntries(INTERNAL.filter((key) => safeFolderName(mounted[key])).map((key) => [key, mounted[key]]));
}

/**
 * The command that makes the folder if it is missing and opens it in the file manager of the person's computer (Finder,
 * Explorer): for a person new to terminals the file manager comes first (JHT-T360). Null on a server, which has no window.
 */
export function openCommand(name, hostOs, hostType = 'local') {
  if (hostType === 'vps' || !safeFolderName(name)) return null;
  if (hostOs === 'macos') return `mkdir -p "$HOME/Documents/Job Hunter Team/${name}" && open "$HOME/Documents/Job Hunter Team/${name}"`;
  if (hostOs === 'windows') {
    const path = `$env:USERPROFILE\\Documents\\Job Hunter Team\\${name}`;
    return `mkdir -Force "${path}" | Out-Null; explorer "${path}"`;
  }
  if (hostOs === 'linux') return `mkdir -p "$HOME/Documents/Job Hunter Team/${name}" && xdg-open "$HOME/Documents/Job Hunter Team/${name}"`;
  return null;
}

/** The path of a folder on the person's computer, written as they would type it on their system. */
export function hostPath(name, hostOs) {
  return hostOs === 'windows' ? `%USERPROFILE%\\Documents\\Job Hunter Team\\${name}` : `~/Documents/Job Hunter Team/${name}`;
}

/**
 * For `jht team status --json` (where.folders): each folder with the name it really has and its path on the person's system.
 * The Assistente names the folders only from here.
 */
export function whereFolders(hostOs, { hostType = 'local', env = process.env, home = JHT_HOME, userDir = JHT_USER_DIR, exists = existsSync, catalog } = {}) {
  const names = { ...onDisk(userFolders({ env, home, catalog }), userDir, exists), ...mountedFolders(home) };
  return Object.fromEntries(INTERNAL.map((key) => [key, { name: names[key], path: hostPath(names[key], hostOs), open: openCommand(names[key], hostOs, hostType) }]));
}

/**
 * The resolved names, written in $JHT_HOME/user-folders.json at every start of the team: the host side (the desktop app, the
 * wrapper) reads this one small file instead of a second copy of the catalog. The same file, the same rule, everywhere.
 */
export function writeUserFolders({ env = process.env, home = JHT_HOME, catalog } = {}) {
  const language = resolveLanguage(env, home);
  const mounted = mountedFolders(home);
  const body = JSON.stringify({ language, folders: userFolders({ env, home, catalog, language }),
    ...(Object.keys(mounted).length ? { mounted } : {}) }, null, 2) + '\n';
  const path = join(home, 'user-folders.json');
  const tmp = join(home, `.user-folders.${randomUUID()}.tmp`);
  let fd;
  let created = false;
  try {
    fd = openSync(tmp, 'wx', 0o644);
    created = true;
    writeFileSync(fd, body);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, path);
    created = false;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (created) { try { unlinkSync(tmp); } catch { /* the temporary name was already removed */ } }
  }
  return path;
}
