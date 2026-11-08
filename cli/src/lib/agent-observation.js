import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../../shared/skills/agent_observer.py', import.meta.url));
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const number = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
const reason = (v) => v == null || (typeof v === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(v));

function validAgent(row) {
  if (!object(row) || typeof row.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(row.id)
      || typeof row.session !== 'string' || !/^[A-Z][A-Z0-9-]{0,43}$/.test(row.session)
      || ![true, false, null].includes(row.running) || !object(row.usage)
      || !number(row.usage.tokens) || !reason(row.usage.reason)) return false;
  if (row.identity !== null && (!object(row.identity)
      || !(row.identity.model === null || typeof row.identity.model === 'string')
      || !(row.identity.effort === null || typeof row.identity.effort === 'string'))) return false;
  if (row.process !== null && (!object(row.process) || !Array.isArray(row.process.pids)
      || !row.process.pids.every((p) => Number.isSafeInteger(p) && p > 0)
      || ![true, false, null].includes(row.process.alive)
      || !['cpu_pct', 'rss_bytes', 'rss_pct'].every((key) => number(row.process[key])))) return false;
  return typeof row.state === 'string';
}

// Installed jht runs inside the attested container via the wrapper. From
// source, observe this host; never start a runtime or send keys to a pane.
export function observationCommand(stream = false) {
  return ['python3', [SCRIPT, ...(stream ? ['--stream'] : [])]];
}

export function validObservation(value) {
  return object(value) && typeof value.ok === 'boolean' && Array.isArray(value.agents)
    && typeof value.at === 'number' && Number.isFinite(value.at)
    && Array.isArray(value.errors) && value.errors.every((c) => typeof c === 'string')
    && Number.isSafeInteger(value.running) && value.running >= 0
    && Number.isSafeInteger(value.total) && value.total === value.agents.length
    && value.running === value.agents.filter((row) => object(row) && row.running === true).length
    && object(value.usage) && value.usage.window === '1h' && value.usage.unit === 'weighted_tokens'
    && value.agents.every(validAgent);
}

export function readObservation(run = spawnSync) {
  const [command, args] = observationCommand();
  const result = run(command, args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('observer_read_failed');
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new Error('observer_read_invalid'); }
  if (!validObservation(value)) throw new Error('observer_read_invalid');
  return value;
}

export function openObservationStream(start = spawn) {
  const [command, args] = observationCommand(true);
  return start(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}
