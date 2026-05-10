/**
 * Logger strutturato — info/warn/error/debug con file e console.
 *
 * Log strutturati JSON su file (~/.jht/logs/), output colorato in console.
 * Supporta subsystem, log rolling giornaliero, e size cap.
 */

import fs from "node:fs";
import path from "node:path";
import { JHT_LOGS_DIR } from "../paths.js";
import { formatTimestampLong, formatConsoleLine } from "./formatter.js";
import { redactString, redactObject } from "./redact.js";

// ── TYPES ───────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogEntry {
  time: string;
  level: LogLevel;
  subsystem: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface LoggerOptions {
  /** Livello minimo per file (default: info) */
  level?: LogLevel;
  /** Livello minimo per console (default: info) */
  consoleLevel?: LogLevel;
  /** Nome subsystem (default: jht) */
  subsystem?: string;
  /** Directory log (default: ~/.jht/logs) */
  logDir?: string;
  /** Max dimensione file log in bytes (default: 100MB) */
  maxFileBytes?: number;
}

// ── CONSTANTS ───────────────────────────────────────────────

const LOG_DIR = JHT_LOGS_DIR;
const LOG_PREFIX = "jht";
const LOG_SUFFIX = ".log";
const MAX_LOG_AGE_MS = 48 * 60 * 60 * 1000; // 48h
const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// ── ROLLING LOG FILES ───────────────────────────────────────

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function rollingLogPath(logDir: string): string {
  return path.join(
    logDir,
    `${LOG_PREFIX}-${formatDate(new Date())}${LOG_SUFFIX}`,
  );
}

function pruneOldLogs(logDir: string): void {
  try {
    const entries = fs.readdirSync(logDir, { withFileTypes: true });
    const cutoff = Date.now() - MAX_LOG_AGE_MS;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(`${LOG_PREFIX}-`)) continue;
      const fullPath = path.join(logDir, entry.name);
      try {
        if (fs.statSync(fullPath).mtimeMs < cutoff)
          fs.rmSync(fullPath, { force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore missing dir */
  }
}

// ── FILE WRITER ─────────────────────────────────────────────

let currentFileBytes = 0;
let currentFilePath = "";
let sizeCapWarned = false;

function appendToFile(filePath: string, line: string, maxBytes: number): void {
  try {
    if (filePath !== currentFilePath) {
      currentFilePath = filePath;
      try {
        currentFileBytes = fs.statSync(filePath).size;
      } catch {
        currentFileBytes = 0;
      }
      sizeCapWarned = false;
    }
    const bytes = Buffer.byteLength(line, "utf8");
    if (currentFileBytes + bytes > maxBytes) {
      if (!sizeCapWarned) {
        sizeCapWarned = true;
        process.stderr.write(`[jht-logger] size cap raggiunto: ${filePath}\n`);
      }
      return;
    }
    fs.appendFileSync(filePath, line, "utf8");
    currentFileBytes += bytes;
  } catch {
    /* mai bloccare su errori di logging */
  }
}

// ── LOGGER CLASS ────────────────────────────────────────────

export class Logger {
  private level: LogLevel;
  private consoleLevel: LogLevel;
  private subsystem: string;
  private logDir: string;
  private maxFileBytes: number;
  private pruned = false;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.consoleLevel = options.consoleLevel ?? "info";
    this.subsystem = options.subsystem ?? "jht";
    this.logDir = options.logDir ?? LOG_DIR;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  /** Crea un child logger con subsystem diverso */
  child(subsystem: string): Logger {
    return new Logger({
      level: this.level,
      consoleLevel: this.consoleLevel,
      subsystem,
      logDir: this.logDir,
      maxFileBytes: this.maxFileBytes,
    });
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log("debug", message, data);
  }
  info(message: string, data?: Record<string, unknown>) {
    this.log("info", message, data);
  }
  warn(message: string, data?: Record<string, unknown>) {
    this.log("warn", message, data);
  }
  error(message: string, data?: Record<string, unknown>) {
    this.log("error", message, data);
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const now = new Date();

    // Redaction: messaggio scansionato per pattern (Bearer, JWT, hex
    // 32+, ecc.); data deep-cloned con i campi sensibili mascherati.
    // Logger e' il bottleneck unico per file+console, quindi un singolo
    // punto qui copre tutti i call site.
    const safeMessage = redactString(message);
    const safeData = data
      ? (redactObject(data) as Record<string, unknown>)
      : undefined;

    // Console output
    if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.consoleLevel]) {
      const line = formatConsoleLine(level, this.subsystem, safeMessage, now);
      if (level === "error") {
        process.stderr.write(line + "\n");
      } else {
        process.stdout.write(line + "\n");
      }
    }

    // File output (JSON strutturato)
    if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level]) {
      if (!this.pruned) {
        this.pruned = true;
        fs.mkdirSync(this.logDir, { recursive: true });
        pruneOldLogs(this.logDir);
      }

      const entry: LogEntry = {
        time: formatTimestampLong(now),
        level,
        subsystem: this.subsystem,
        message: safeMessage,
        ...(safeData ? { data: safeData } : {}),
      };
      appendToFile(
        rollingLogPath(this.logDir),
        JSON.stringify(entry) + "\n",
        this.maxFileBytes,
      );
    }
  }
}

// ── DEFAULT INSTANCE ────────────────────────────────────────

let defaultLogger: Logger | null = null;

export function getLogger(subsystem?: string): Logger {
  if (!defaultLogger) {
    const envLevel = (process.env.JHT_LOG_LEVEL ?? "info") as LogLevel;
    defaultLogger = new Logger({ level: envLevel, consoleLevel: envLevel });
  }
  return subsystem ? defaultLogger.child(subsystem) : defaultLogger;
}

/** Reset per test */
export function resetLogger(): void {
  defaultLogger = null;
}
