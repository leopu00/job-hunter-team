import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_LOGS_DIR } from '../jht-paths.js';

// No-follow regular single-link log, shared by human read commands.
export function appendDiagnostic(message) {
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
