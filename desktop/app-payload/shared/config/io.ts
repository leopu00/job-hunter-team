/**
 * JHT Config — IO utilities per ~/.jht/config.json
 *
 * Lettura (JSON5-compatibile), scrittura, validazione e hot reload.
 * Pattern copiato da OpenClaw (openclaw/src/config/io.ts).
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
const SENSITIVE_FIELDS = ["api_key", "bot_token", "session_token", "value"];

// --- JSON5 leggero: strip commenti e trailing commas ---

/**
 * Parsa JSON5 leggero: rimuove commenti // e /* e trailing commas.
 * Non richiede dipendenze esterne.
 */
export function parseJson5(raw: string): unknown {
  let cleaned = raw;
  // Rimuovi commenti single-line (// ...) fuori da stringhe
  cleaned = cleaned.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (_, str) => str ?? "");
  // Rimuovi commenti multi-line (/* ... */)
  cleaned = cleaned.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (_, str) => str ?? "");
  // Rimuovi trailing commas prima di } o ]
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned);
}

/**
 * Legge e valida il config. Supporta JSON e JSON5 (commenti, trailing commas).
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
    parsed = parseJson5(raw);
  } catch {
    return { success: false, error: "JSON non valido in config" };
  }

  const result = validateConfig(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    return { success: false, error: `Validazione fallita:\n${issues}` };
  }

  return { success: true, data: result.data };
}

/**
 * Scrive config dopo validazione. Crea ~/.jht/ se non esiste.
 * Scrive JSON formattato (non JSON5 — i commenti si perderebbero).
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
    // Scrittura atomica: tmp + rename
    const tmpPath = JHT_CONFIG_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(result.data, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, JHT_CONFIG_PATH);
  } catch (err) {
    return { success: false, error: `Errore scrittura file: ${(err as Error).message}` };
  }

  // Notifica listener hot reload
  for (const cb of configChangeListeners) {
    try { cb(result.data!); } catch { /* ignora errori listener */ }
  }

  return { success: true, data: result.data };
}

/** Verifica se il file config esiste. */
export function configExists(): boolean {
  return fs.existsSync(JHT_CONFIG_PATH);
}

/** Copia config con campi sensibili mascherati. */
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config), (key, value) => {
    if (SENSITIVE_FIELDS.includes(key) && typeof value === "string" && value.length > 0) {
      return value.slice(0, 4) + "****";
    }
    return value;
  });
}

// --- Hot Reload ---

type ConfigChangeCallback = (config: JHTConfigParsed) => void;
const configChangeListeners: ConfigChangeCallback[] = [];
let watcher: fs.FSWatcher | null = null;

/** Registra un callback per hot reload del config. */
export function onConfigChange(callback: ConfigChangeCallback): () => void {
  configChangeListeners.push(callback);

  // Avvia watcher al primo listener
  if (!watcher && fs.existsSync(JHT_CONFIG_PATH)) {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    watcher = fs.watch(JHT_CONFIG_PATH, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const result = readConfig();
        if (result.success && result.data) {
          for (const cb of configChangeListeners) {
            try { cb(result.data); } catch { /* ignora */ }
          }
        }
      }, 200);
    });
    if (watcher.unref) watcher.unref();
  }

  // Ritorna funzione di unsubscribe
  return () => {
    const idx = configChangeListeners.indexOf(callback);
    if (idx >= 0) configChangeListeners.splice(idx, 1);
    if (configChangeListeners.length === 0 && watcher) {
      watcher.close();
      watcher = null;
    }
  };
}
