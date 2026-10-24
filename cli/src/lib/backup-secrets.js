// Secrets in a backup copy of a JSON file.
//
// A backup sits in the same home as the data it protects, so a provider key
// copied into it is a second place where the key lives, readable by anyone who
// can read the folder. The copy keeps the shape of the file and nulls the
// value of every key that names a secret, at any depth, in objects and lists.
// Same rule as the desktop's backup (the key name decides, never the value).

export const SECRET_KEY = /(api[_-]?key|token|secret|passw|credential|authorization|bearer|private[_-]?key)/i;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFilled = (v) => v !== null && v !== undefined && v !== '';

/** A copy of `value` with every secret-named key set to null. */
export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? null : redactSecrets(v)]),
    );
  }
  return value;
}

/** How many secret-named keys still hold a value. */
export function countPlainSecrets(value) {
  if (Array.isArray(value)) return value.reduce((n, v) => n + countPlainSecrets(v), 0);
  if (!isObject(value)) return 0;
  return Object.entries(value).reduce(
    (n, [k, v]) => n + (SECRET_KEY.test(k) ? (isFilled(v) ? 1 : 0) : countPlainSecrets(v)),
    0,
  );
}

/**
 * The backup's value, with each secret it left empty filled from the live file
 * (same path). Restoring a redacted copy must not wipe the keys in use.
 */
export function mergeLiveSecrets(backup, live) {
  if (Array.isArray(backup)) {
    return backup.map((v, i) => (Array.isArray(live) ? mergeLiveSecrets(v, live[i]) : v));
  }
  if (!isObject(backup)) return backup;
  const liveObject = isObject(live) ? live : {};
  return Object.fromEntries(
    Object.entries(backup).map(([k, v]) => {
      if (SECRET_KEY.test(k)) return [k, isFilled(v) || !isFilled(liveObject[k]) ? v : liveObject[k]];
      return [k, mergeLiveSecrets(v, liveObject[k])];
    }),
  );
}
