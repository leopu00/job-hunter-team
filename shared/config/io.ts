/**
 * JHT Config — IO utilities per ~/.jht/jht.config.json
 *
 * Lettura, scrittura e validazione del file di configurazione.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validateConfig } from "./schema";
import type { JHTConfigParsed } from "./schema";

/** Path della directory config */
export const JHT_CONFIG_DIR = path.join(os.homedir(), ".jht");

/** Path del file config */
export const JHT_CONFIG_PATH = path.join(JHT_CONFIG_DIR, "jht.config.json");

/** Campi sensibili da mascherare nei log */
const SENSITIVE_FIELDS = ["api_key", "bot_token", "session_token"];

/**
 * Legge e valida jht.config.json.
 * Ritorna { success, data, error }.
 */
export function readConfig(): {
  success: boolean;
  data?: JHTConfigParsed;
  error?: string;
} {
  if (!fs.existsSync(JHT_CONFIG_PATH)) {
    return { success: false, error: `File non trovato: ${JHT_CONFIG_PATH}` };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(JHT_CONFIG_PATH, "utf-8");
  } catch (err) {
    return { success: false, error: `Errore lettura file: ${(err as Error).message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { success: false, error: "JSON non valido in jht.config.json" };
  }

  const result = validateConfig(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    return { success: false, error: `Validazione fallita:\n${issues}` };
  }

  return { success: true, data: result.data };
}

/**
 * Scrive jht.config.json dopo validazione.
 * Crea la directory ~/.jht/ se non esiste.
 */
export function writeConfig(config: unknown): {
  success: boolean;
  data?: JHTConfigParsed;
  error?: string;
} {
  const result = validateConfig(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    return { success: false, error: `Validazione fallita:\n${issues}` };
  }

  try {
    fs.mkdirSync(JHT_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(JHT_CONFIG_PATH, JSON.stringify(result.data, null, 2) + "\n", "utf-8");
  } catch (err) {
    return { success: false, error: `Errore scrittura file: ${(err as Error).message}` };
  }

  return { success: true, data: result.data };
}

/**
 * Verifica se il file config esiste.
 */
export function configExists(): boolean {
  return fs.existsSync(JHT_CONFIG_PATH);
}

/**
 * Ritorna una copia del config con i campi sensibili mascherati.
 * Utile per logging e debug.
 */
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config), (key, value) => {
    if (SENSITIVE_FIELDS.includes(key) && typeof value === "string" && value.length > 0) {
      return value.slice(0, 4) + "****";
    }
    return value;
  });
}
