/**
 * Formatter — Output colorato per terminale.
 *
 * Colori ANSI per livelli di log e formattazione timestamp.
 * Supporta rilevamento automatico TTY per disabilitare colori in pipe.
 */

// ── ANSI COLORS ─────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const COLORS = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
} as const;

type Color = keyof typeof COLORS;

// ── TTY DETECTION ───────────────────────────────────────────

/** Verifica se stdout supporta colori ANSI */
function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout?.isTTY === true;
}

const colorEnabled = supportsColor();

/** Applica colore ANSI solo se supportato */
function colorize(text: string, color: Color, bold = false): string {
  if (!colorEnabled) return text;
  const prefix = bold ? `${BOLD}${COLORS[color]}` : COLORS[color];
  return `${prefix}${text}${RESET}`;
}

function dim(text: string): string {
  if (!colorEnabled) return text;
  return `${DIM}${text}${RESET}`;
}

// ── LEVEL FORMATTERS ────────────────────────────────────────

const LEVEL_STYLES: Record<string, { color: Color; label: string; bold: boolean }> = {
  debug: { color: "gray", label: "DBG", bold: false },
  info: { color: "blue", label: "INF", bold: false },
  warn: { color: "yellow", label: "WRN", bold: true },
  error: { color: "red", label: "ERR", bold: true },
};

/** Formatta il badge del livello con colore */
export function formatLevel(level: string): string {
  const style = LEVEL_STYLES[level] ?? LEVEL_STYLES.info;
  return colorize(style.label, style.color, style.bold);
}

// ── TIMESTAMP ───────────────────────────────────────────────

/** Formatta timestamp ISO compatto: HH:mm:ss.SSS */
export function formatTimestamp(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return dim(`${h}:${m}:${s}.${ms}`);
}

/** Formatta timestamp ISO lungo per log file: YYYY-MM-DD HH:mm:ss.SSS */
export function formatTimestampLong(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

// ── SUBSYSTEM ───────────────────────────────────────────────

/** Formatta il nome del subsystem con colore */
export function formatSubsystem(subsystem: string): string {
  return colorize(`[${subsystem}]`, "cyan");
}

// ── LINE FORMATTER ──────────────────────────────────────────

/** Compone una riga di log formattata per console */
export function formatConsoleLine(
  level: string,
  subsystem: string,
  message: string,
  date?: Date
): string {
  const ts = formatTimestamp(date ?? new Date());
  const lvl = formatLevel(level);
  const sub = subsystem ? ` ${formatSubsystem(subsystem)}` : "";
  return `${ts} ${lvl}${sub} ${message}`;
}

// ── THEME HELPERS (per import diretto) ──────────────────────

export const theme = {
  info: (text: string) => colorize(text, "blue"),
  warn: (text: string) => colorize(text, "yellow", true),
  error: (text: string) => colorize(text, "red", true),
  success: (text: string) => colorize(text, "green"),
  muted: (text: string) => dim(text),
  highlight: (text: string) => colorize(text, "magenta", true),
};
