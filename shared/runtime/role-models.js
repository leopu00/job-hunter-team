import { readFileSync } from 'node:fs';

// Also read by .launcher/role-models.sh; no model/default table lives in an adapter.
const rows = readFileSync(new URL('./role-models.list', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => line.split('|'));
const models = rows.filter(([kind]) => kind === 'model');
const roles = rows.filter(([kind]) => kind === 'role');

export const CODEX_MODEL = Object.freeze(Object.fromEntries(models.map(([, name, model]) => [name, model])));
export const CLAUDE_ALIAS = Object.freeze(Object.fromEntries(models.filter((row) => row[3]).map(([, name, , alias]) => [name, alias])));
export const ROLES = Object.freeze(roles.map(([, name]) => name));
export const MODEL_CLASSES = Object.freeze(models.map(([, name]) => name));
export const ROLE_DEFAULT_CLASS = Object.freeze(Object.fromEntries(roles.map(([, name, model]) => [name, model])));
export const ROLE_DEFAULT_EFFORT = Object.freeze(Object.fromEntries(roles.map(([, name, , effort]) => [name, effort])));
export const DEFAULT_EFFORT = ROLE_DEFAULT_EFFORT[ROLES[0]];
