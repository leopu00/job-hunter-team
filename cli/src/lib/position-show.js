import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_LOGS_DIR } from '../jht-paths.js';
import { t } from '../../wizard/i18n.js';
import { renderPositionCard } from './position-card.js';
import { renderPositionsDashboard, validDashboard } from './positions-dashboard.js';

function appendDiagnostic(message) {
  mkdirSync(JHT_LOGS_DIR, { recursive: true, mode: 0o700 });
  const directory = lstatSync(JHT_LOGS_DIR);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('position_log_unavailable');
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT
    | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const fd = openSync(join(JHT_LOGS_DIR, 'runtime.log'), flags, 0o600);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.nlink !== 1) throw new Error('position_log_unavailable');
    fchmodSync(fd, 0o600);
    writeFileSync(fd, `${new Date().toISOString()} ${message}\n`);
  } finally {
    closeSync(fd);
  }
}

export function showHumanPosition(id, options, read) {
  return humanRead(['position', String(id), '--json'], options, read, {
    valid: (row) => row === null || (typeof row === 'object' && !Array.isArray(row) && row.id != null),
    render: renderPositionCard, error: 'position_read_invalid', message: 'position_card.read_invalid',
  });
}

export function showHumanDashboard(options, read) {
  return humanRead(['dashboard', '--json'], options, read, {
    valid: validDashboard, render: renderPositionsDashboard,
    error: 'dashboard_read_invalid', message: 'position_card.dashboard.read_invalid',
  });
}

function humanRead(args, options, read, view) {
  const result = read(args);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.code !== 0) return result.code;
  let row;
  try {
    row = JSON.parse(result.stdout);
    if (!view.valid(row)) throw new Error('invalid read response');
  } catch {
    const message = `${view.error}: ${t(view.message)}`;
    console.error(message);
    try {
      appendDiagnostic(message);
    } catch {
      console.error(`position_log_unavailable: ${t('position_card.log_unavailable')}`);
    }
    return 2;
  }
  process.stdout.write(view.render(row, options));
  return 0;
}
