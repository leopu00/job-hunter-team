/**
 * Logger strutturato per JHT.
 *
 * Uso:
 *   import { getLogger } from "../shared/logger/index.js";
 *   const log = getLogger("telegram");
 *   log.info("Bridge avviato");
 *   log.error("Connessione fallita", { code: 500 });
 */

export { Logger, getLogger, resetLogger } from "./logger.js";
export type { LogLevel, LogEntry, LoggerOptions } from "./logger.js";
export {
  formatConsoleLine,
  formatLevel,
  formatTimestamp,
  theme,
} from "./formatter.js";
export { redactString, redactObject, redactedConsole } from "./redact.js";
