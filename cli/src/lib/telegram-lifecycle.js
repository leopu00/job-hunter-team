// CLI-side adapter for the same isolated runtime planner used by host wrappers.
import { spawnSync } from 'node:child_process';

export const telegramPlanArgs = (phase, action) => [
  'run', '--rm', '--no-deps', '-T', '--entrypoint', '/usr/bin/python3',
  'jht-telegram', '-I', '/app/shared/telegram_service/lifecycle.py', phase, action,
];

export function resumeTelegram({ run = spawnSync, cwd, env = process.env } = {}) {
  const planned = run('docker', ['compose', ...telegramPlanArgs('prepare', 'resume')], {
    cwd, env: { ...env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8', stdio: 'pipe',
  });
  if (planned.status !== 0 || planned.error || typeof planned.stdout !== 'string') return false;
  const operation = planned.stdout.trim();
  if (operation !== 'start' && operation !== 'stop') return false;
  const args = operation === 'start' ? ['up', '-d', 'jht-telegram'] : ['stop', 'jht-telegram'];
  const applied = run('docker', ['compose', ...args], {
    cwd, env: { ...env, MSYS_NO_PATHCONV: '1' }, stdio: 'inherit',
  });
  return applied.status === 0 && !applied.error;
}
