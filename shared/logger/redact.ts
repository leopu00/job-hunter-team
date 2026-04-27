/**
 * Redaction dei segreti nei log.
 *
 * Cuore: `redactString(s)` che maschera pattern noti (Bearer, JWT,
 * api_key=, password=, prefissi sk_/ant-/jht_sync_, hex >= 32). Su
 * dati strutturati usiamo `redactObject(obj)` che riconosce i nomi
 * di campo sensibili e maschera il valore senza scendere oltre `MAX_DEPTH`.
 *
 * Pattern coerente con OpenClaw `redact-bounded.ts`: bounded perche'
 * gli input dei log possono essere grandi, e la regex globale ha
 * complessita' lineare se compilata una volta sola.
 */

const REDACTED = "[REDACTED]";

/** Profondita' massima della ricorsione su oggetti annidati. */
const MAX_DEPTH = 6;

/** Lunghezza massima della stringa scansionata (oltre, redaction si ferma). */
const MAX_LEN = 64 * 1024;

/** Nomi di campo (case-insensitive) il cui valore va sempre mascherato. */
const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "passphrase",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "apikey",
  "api-key",
  "private_key",
  "client_secret",
  "jht_secret_key",
  "jht_credentials_key",
]);

/**
 * Pattern testuali sequenziali (un singolo replace globale per ognuno).
 * Ordine voluto: i prefissi specifici (sk-, ant-, jht_sync_) prima del
 * generico hex.
 */
const PATTERNS: Array<[RegExp, string]> = [
  // Bearer <token>
  [/\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, `Bearer ${REDACTED}`],
  // JWT (3 segmenti base64url separati da `.`)
  [/\beyJ[A-Za-z0-9_-]+?\.[A-Za-z0-9_-]+?\.[A-Za-z0-9_-]+\b/g, REDACTED],
  // Anthropic / OpenAI / JHT sync token prefix
  [/\b(?:sk|sk-ant|ant)[-_][A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\bjht_sync_[A-Za-z0-9_-]{16,}/g, REDACTED],
  // key=value style: api_key=..., password=..., token=...
  [
    /\b(api[_-]?key|password|passphrase|secret|token|access[_-]?token|refresh[_-]?token)\s*[:=]\s*"?[^"\s,&}]{4,}"?/gi,
    (_match: string, k: string) => `${k}=${REDACTED}`,
  ] as unknown as [RegExp, string],
  // Long hex (>= 32 hex chars) — copre molti token random come il
  // local-token (64 hex) e SHA-256.
  [/\b[a-f0-9]{32,}\b/gi, REDACTED],
];

/** Maschera segreti dentro una stringa (idempotente, safe su input non-string). */
export function redactString(input: unknown): string {
  if (input == null) return String(input);
  let s = typeof input === "string" ? input : String(input);
  if (s.length > MAX_LEN) {
    // Tronca in modo consistente, poi redact: la coda potrebbe contenere
    // un segreto ma evitiamo regex su stringhe enormi (DoS).
    s = s.slice(0, MAX_LEN) + "…[truncated]";
  }
  for (const [re, repl] of PATTERNS) {
    s =
      typeof repl === "string"
        ? s.replace(re, repl)
        : s.replace(re, repl as unknown as (...args: string[]) => string);
  }
  return s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || proto === Object.prototype;
}

/**
 * Deep-clone con redaction. I valori dei campi sensibili (per nome)
 * diventano `[REDACTED]`; i valori stringa dei campi non-sensibili
 * vengono passati per `redactString` (cattura segreti nascosti dentro
 * messaggi liberi).
 */
export function redactObject(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(input)) return input.map((v) => redactObject(v, depth + 1));
  if (isPlainObject(input)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = redactObject(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof input === "string") return redactString(input);
  return input;
}

/**
 * Wrapper di `console` con redaction automatica. Da usare in moduli
 * sensibili che oggi chiamano `console.log/error` direttamente:
 *
 *     import { redactedConsole as console } from '@/shared/logger/redact'
 *     console.log('Bearer abc123def...')   // → "Bearer [REDACTED]"
 *
 * Le funzioni preservano l'arity (Node `console.log(msg, ...args)`).
 */
export const redactedConsole = {
  log: (...args: unknown[]) => console.log(...args.map((a) => redactObject(a))),
  info: (...args: unknown[]) =>
    console.info(...args.map((a) => redactObject(a))),
  warn: (...args: unknown[]) =>
    console.warn(...args.map((a) => redactObject(a))),
  error: (...args: unknown[]) =>
    console.error(...args.map((a) => redactObject(a))),
  debug: (...args: unknown[]) =>
    console.debug(...args.map((a) => redactObject(a))),
};
