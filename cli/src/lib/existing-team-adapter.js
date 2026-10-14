import { spawnSync } from 'node:child_process';
import { lstatSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_REPLY = 2 * 1024 * 1024;
const BIN_DIR = dirname(fileURLToPath(new URL('../../bin/jht.js', import.meta.url)));

export function adapterFailure(error, code = 69) {
  return { code, value: { ok: false, phase: 'adapter', code, error } };
}

export function resolveExistingTeamCompanion(env = process.env) {
  const configured = env.JHT_EXISTING_TEAM_COMPANION;
  const candidate = configured || join(BIN_DIR, 'jht-existing-team');
  if (configured && !isAbsolute(configured)) return null;
  try {
    const link = lstatSync(candidate);
    const target = statSync(candidate);
    if (!link.isFile() || link.isSymbolicLink() || !target.isFile() || (target.mode & 0o022) !== 0) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function validAdapterRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  if (typeof request.profileId !== 'string' || !/^[0-9a-f]{64}$/.test(request.profileId)) return false;
  if (request.op === 'connect') return typeof request.teamId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(request.teamId);
  if (request.op === 'detail') return typeof request.id === 'string' && /^\d{1,20}$/.test(request.id);
  if (request.op === 'facets') return Object.keys(request).every((key) => ['profileId', 'op'].includes(key));
  if (request.op === 'list') return !('filters' in request) || (request.filters && typeof request.filters === 'object' && !Array.isArray(request.filters));
  return false;
}

export function runExistingTeamAdapter(request, { env = process.env, spawn = spawnSync } = {}) {
  if (!validAdapterRequest(request)) return adapterFailure('adapter_request_invalid', 64);
  const companion = resolveExistingTeamCompanion(env);
  if (!companion) return adapterFailure('existing_team_adapter_unavailable', 69);
  const result = spawn(companion, ['--stdio-json'], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 20_000, maxBuffer: MAX_REPLY,
    env: { PATH: env.PATH ?? '' },
  });
  if (result.error || result.status === null || Buffer.byteLength(result.stdout || '', 'utf8') > MAX_REPLY) {
    return adapterFailure('existing_team_adapter_unavailable', 69);
  }
  try {
    const value = JSON.parse(result.stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.ok !== 'boolean' || typeof value.code !== 'number') throw new Error('invalid');
    return { code: Number.isInteger(result.status) ? result.status : 69, value };
  } catch {
    return adapterFailure('existing_team_adapter_invalid_reply', 69);
  }
}
