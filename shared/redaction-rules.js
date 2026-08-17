/**
 * Regole di redazione — FONTE UNICA per i canali JS.
 *
 * Stavano dentro `web/lib/redact.ts`, cioè dentro il canale che porta i dati
 * VERSO DI NOI (feedback, diagnostica). Il canale che porta testo verso un
 * TERZO — i messaggi che il team manda su Telegram, dove ciò che esce resta —
 * non le vedeva nemmeno. Il criterio giusto è il secondo, ed è il più forte:
 * si redige quando il testo ESCE.
 *
 * Da qui le leggono il web (`web/lib/redact.ts`) e il filtro invocato dal
 * sender (`agents/_tools/jht-redact`), così una regola aggiunta per un canale
 * protegge l'altro senza che nessuno debba ricordarsene (O-175).
 *
 * Plain JS ESM come `shared/paths.js`: importabile da .ts e da .js senza
 * compilazione, che è la ragione per cui la fonte unica può stare qui.
 *
 * ⚠️ Resta FUORI il gemello del gioco, `game/scripts/support/redactor.gd`:
 * GDScript non importa questo file e i suoi regex hanno un'altra sintassi.
 * Quella copia è dichiarata tale nel suo commento e ha il proprio selftest —
 * chi tocca una famiglia di regole tocca anche quello.
 */

/**
 * @typedef {"secret" | "personal"} RedactFamily
 * @typedef {{key: string, family: RedactFamily, pattern: RegExp, replace: string}} RedactRule
 */

/** Ordine significativo: dalla regola più specifica alla più generica.
 *  @type {RedactRule[]} */
export const REDACTION_RULES = ([] = [
  // ── Segreti ──────────────────────────────────────────────────────────
  {
    key: "private_key",
    family: "secret",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: "[private-key]",
  },
  {
    // Il contesto HTTP evita falsi positivi sulla prosa "Bearer
    // authentication" senza perdere gli header Authorization reali.
    key: "bearer_token",
    family: "secret",
    pattern:
      /\b((?:Proxy-)?Authorization\s*:?\s*Bearer)\s+[A-Za-z0-9._~+/=-]{6,}/gi,
    replace: "$1 [secret]",
  },
  {
    // Anche una Basic credential di quattro caratteri e' valida (`YTo=`).
    key: "basic_auth",
    family: "secret",
    pattern:
      /\b((?:Proxy-)?Authorization\s*:?\s*Basic)\s+(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)/gi,
    replace: "$1 [secret]",
  },
  {
    key: "aws_access_key",
    family: "secret",
    pattern: /\bAKIA[A-Z0-9]{16}\b/g,
    replace: "[aws-access-key]",
  },
  {
    key: "slack_token",
    family: "secret",
    pattern: /\bxoxb-[A-Za-z0-9-]{10,}\b/g,
    replace: "[slack-token]",
  },
  {
    key: "gemini_key",
    family: "secret",
    pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/g,
    replace: "[gemini-key]",
  },
  {
    key: "assigned_secret",
    family: "secret",
    pattern:
      /\b(token|api[_-]?key|apikey|secret|password|passwd|pwd|credential|bearer)s?\b\s*[:=]\s*["']?([^\s"',;}\]]{6,})/gi,
    replace: "$1: [secret]",
  },
  {
    key: "telegram_token",
    family: "secret",
    pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
    replace: "[telegram-token]",
  },
  {
    key: "github_token",
    family: "secret",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replace: "[github-token]",
  },
  {
    key: "provider_key",
    family: "secret",
    pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    replace: "[provider-key]",
  },
  {
    key: "jwt",
    family: "secret",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: "[jwt]",
  },
  {
    key: "url_credentials",
    family: "secret",
    pattern: /:\/\/[^\s/@:]+:[^\s/@]+@/g,
    replace: "://[credentials]@",
  },
  {
    key: "url_secret_param",
    family: "secret",
    pattern:
      /([?&](?:token|key|secret|code|access_token|refresh_token)=)[^&\s"']+/gi,
    replace: "$1[secret]",
  },
  {
    key: "long_hex",
    family: "secret",
    pattern: /\b[a-fA-F0-9]{32,}\b/g,
    replace: "[hash]",
  },

  // ── Dati personali ───────────────────────────────────────────────────
  {
    key: "email",
    family: "personal",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replace: "[email]",
  },
  {
    key: "phone_intl",
    family: "personal",
    pattern: /\+\d{1,3}[\s.-]?\d[\d\s.-]{7,14}\d/g,
    replace: "[phone]",
  },
  {
    key: "phone_labeled",
    family: "personal",
    pattern:
      /\b(tel|telefono|phone|cellulare|mobile)\b\s*[:=]?\s*\d[\d\s.-]{6,}\d/gi,
    replace: "$1: [phone]",
  },
  {
    key: "iban",
    family: "personal",
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    replace: "[iban]",
  },
  {
    key: "fiscal_code",
    family: "personal",
    pattern: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g,
    replace: "[fiscal-code]",
  },
  {
    // Solo IP pubblici: loopback e range privati restano leggibili perché
    // descrivono la topologia senza identificare nessuno.
    key: "public_ip",
    family: "personal",
    pattern:
      /\b(?!10\.)(?!127\.)(?!0\.)(?!255\.)(?!169\.254\.)(?!192\.168\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    replace: "[ip]",
  },
  {
    // Windows ammette spazi nel componente utente; drive/backslash tengono
    // questa regola separata dai path POSIX e dalla prosa che li segue.
    key: "home_path_windows",
    family: "personal",
    pattern: /((?:[A-Z]:[/\\]|\\)Users[/\\])([^/\\\r\n\t"':;,)\]]+)/gi,
    replace: "$1[user]",
  },
  {
    key: "home_path_posix",
    family: "personal",
    pattern: /((?:\/Users|\/home)\/)([^/\s"':;,)\]]+)/gi,
    replace: "$1[user]",
  },
  {
    key: "document_name",
    family: "personal",
    pattern: /\b[\w %+-]{1,80}\.(pdf|docx|doc|odt|rtf)\b/gi,
    replace: "[document].$1",
  },
]);
