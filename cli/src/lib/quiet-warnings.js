/**
 * Node and its bundled libraries print warnings of their own, which a person reads as a fault of the program:
 * "ExperimentalWarning: SQLite is an experimental feature…" before every command that touches the database, and
 * "[UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental…" on a computer with a system proxy. The experimental
 * ones and the ones of undici are dropped (JHT_DEBUG=1 keeps them); every other warning (a deprecation, a leak of
 * listeners) goes through as before.
 */
function isNoise({ type, code, text }) {
  return type === 'ExperimentalWarning'
    || (typeof code === 'string' && code.startsWith('UNDICI-'))
    || /\bis an? experimental\b|\bis experimental\b/i.test(text);
}

export function installWarningFilter(proc = process) {
  if (proc.env?.JHT_DEBUG) return;
  const emitWarning = proc.emitWarning;
  proc.emitWarning = function (warning, ...rest) {
    // emitWarning(warning, type, code, ctor) or emitWarning(warning, { type, code, ... })
    const options = rest[0] && typeof rest[0] === 'object' ? rest[0] : null;
    const type = options?.type ?? (typeof rest[0] === 'string' ? rest[0] : warning?.name);
    const code = options?.code ?? (typeof rest[1] === 'string' ? rest[1] : warning?.code);
    const text = typeof warning === 'string' ? warning : warning?.message ?? '';
    if (isNoise({ type, code, text })) return;
    return emitWarning.call(this, warning, ...rest);
  };
}
