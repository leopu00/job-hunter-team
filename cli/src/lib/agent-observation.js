import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../../shared/skills/agent_observer.py', import.meta.url));

// Installed jht runs inside the attested container via the wrapper. From
// source, observe this host; never start a runtime or send keys to a pane.
export function observationCommand(stream = false) {
  return ['python3', [SCRIPT, ...(stream ? ['--stream'] : [])]];
}

export function validObservation(value) {
  return value && typeof value.ok === 'boolean' && Array.isArray(value.agents)
    && typeof value.at === 'number' && Number.isFinite(value.at)
    && Array.isArray(value.errors) && value.errors.every((c) => typeof c === 'string')
    && value.usage?.window === '1h' && value.usage?.unit === 'weighted_tokens'
    && value.agents.every((row) => typeof row.id === 'string' && typeof row.session === 'string'
      && [true, false, null].includes(row.running) && row.usage
      && (row.usage.tokens === null || (Number.isFinite(row.usage.tokens) && row.usage.tokens >= 0)));
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
