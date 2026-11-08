import { appendDiagnostic } from './runtime-diagnostic.js';
import { t } from '../../wizard/i18n.js';
import { renderPositionCard } from './position-card.js';
import { renderPositionsDashboard, validDashboard } from './positions-dashboard.js';

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
