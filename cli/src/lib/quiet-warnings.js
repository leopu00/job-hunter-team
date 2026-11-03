/**
 * Node prints "ExperimentalWarning: SQLite is an experimental feature…" before every command that touches the
 * database, which a person reads as a fault of the program. That one warning is dropped (JHT_DEBUG=1 keeps it);
 * every other warning goes through as before.
 */
export function installWarningFilter(proc = process) {
  if (proc.env?.JHT_DEBUG) return;
  const emitWarning = proc.emitWarning;
  proc.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type ?? warning?.name;
    const text = typeof warning === 'string' ? warning : warning?.message ?? '';
    if (type === 'ExperimentalWarning' && /SQLite/i.test(text)) return;
    return emitWarning.call(this, warning, ...rest);
  };
}
