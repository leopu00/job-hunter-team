// CLI-side adapter for the same isolated runtime planner used by host wrappers.
import { spawnSync } from 'node:child_process';

export const telegramPlanArgs = (phase, action) => [
  '--profile', 'telegram', 'run', '--rm', '--no-deps', '-T', '--entrypoint', '/usr/bin/python3',
  'jht-telegram', '-I', '/app/shared/telegram_service/lifecycle.py', phase, action,
];

// Only the Telegram service mounts the jht-telegram-state volume, so without it Telegram was never configured: there is
// nothing to reconcile, and the plan itself (a compose run) would create the volumes and three run containers. A listing
// that fails says nothing: the plan runs as before.
function neverConfigured(run, cwd, env) {
  const listed = run('docker', ['volume', 'ls', '-q', '--filter', 'name=jht-telegram-state'], {
    cwd, env: { ...env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8', stdio: 'pipe',
  });
  return listed.status === 0 && !listed.error && typeof listed.stdout === 'string' && listed.stdout.trim() === '';
}

export function resumeTelegram({ run = spawnSync, cwd, env = process.env } = {}) {
  if (neverConfigured(run, cwd, env)) return true;
  const planned = run('docker', ['compose', ...telegramPlanArgs('prepare', 'resume')], {
    cwd, env: { ...env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8', stdio: 'pipe',
  });
  if (planned.status !== 0 || planned.error || typeof planned.stdout !== 'string') return false;
  const operation = planned.stdout.trim();
  if (operation !== 'start' && operation !== 'stop') return false;
  const args = operation === 'start' ? ['up', '-d', 'jht-telegram'] : ['stop', 'jht-telegram'];
  const applied = run('docker', ['compose', '--profile', 'telegram', ...args], {
    cwd, env: { ...env, MSYS_NO_PATHCONV: '1' }, stdio: 'inherit',
  });
  if (applied.status !== 0 || applied.error) return false;
  const observed = run('docker', ['inspect', '--type', 'container', 'jht-telegram', '--format', '{{.State.Running}}'], {
    cwd, env: { ...env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8', stdio: 'pipe',
  });
  const verified = run('docker', ['compose', ...telegramPlanArgs('verify', operation)], {
    cwd, env: { ...env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8', stdio: 'pipe',
    input: `${observed.status}\n${observed.stdout || ''}${observed.stderr || ''}`,
  });
  return verified.status === 0 && !verified.error;
}
