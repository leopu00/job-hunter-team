import { spawnSync } from 'node:child_process';
import { lstatSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_REPLY = 2 * 1024 * 1024;
const MAX_REQUEST = 8 * 1024;
const ADAPTER_TIMEOUT_MS = 40_000;
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

function encodeTypedRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
  try {
    const encoded = JSON.stringify(request);
    return Buffer.byteLength(encoded, 'utf8') <= MAX_REQUEST ? encoded : null;
  } catch {
    return null;
  }
}

export function validAdapterRequest(request) {
  if (!encodeTypedRequest(request)) return false;
  if (typeof request.profileId !== 'string' || !/^[0-9a-f]{64}$/.test(request.profileId)) return false;
  const own = Object.keys(request);
  const exactKeys = (keys) => own.length === keys.length && own.every((key) => keys.includes(key));
  if (request.op === 'connect') return exactKeys(['profileId', 'op', 'teamId']) && typeof request.teamId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(request.teamId);
  if (request.op === 'detail') return exactKeys(['profileId', 'op', 'id']) && typeof request.id === 'string' && /^\d{1,20}$/.test(request.id);
  if (request.op === 'facets') return exactKeys(['profileId', 'op']);
  if (request.op !== 'list' || !own.every((key) => ['profileId', 'op', 'filters'].includes(key))) return false;
  if (!('filters' in request)) return true;
  const { filters } = request;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return false;
  if ('q' in filters && typeof filters.q !== 'string') return false;
  if ('limit' in filters && (!Number.isFinite(filters.limit) || !Number.isInteger(filters.limit))) return false;
  return true;
}

export function runExistingTeamAdapter(request, { env = process.env, spawn = spawnSync, resolve = resolveExistingTeamCompanion } = {}) {
  if (!validAdapterRequest(request)) return adapterFailure('adapter_request_invalid', 64);
  const input = encodeTypedRequest(request);
  if (!input) return adapterFailure('adapter_request_invalid', 64);
  const companion = resolve(env);
  if (!companion) return adapterFailure('existing_team_adapter_unavailable', 69);
  const result = spawn(companion, ['--stdio-json'], {
    input, encoding: 'utf8', timeout: ADAPTER_TIMEOUT_MS, maxBuffer: MAX_REPLY,
    env: { PATH: env.PATH ?? '' },
  });
  if (result.error || result.status === null || Buffer.byteLength(result.stdout || '', 'utf8') > MAX_REPLY) {
    return adapterFailure('existing_team_adapter_unavailable', 69);
  }
  try {
    const value = JSON.parse(result.stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.ok !== 'boolean' || !Number.isInteger(value.code)) throw new Error('invalid');
    return { code: Number.isInteger(result.status) ? result.status : 69, value };
  } catch {
    return adapterFailure('existing_team_adapter_invalid_reply', 69);
  }
}
