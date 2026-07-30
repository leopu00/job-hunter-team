/**
 * JHT Config — SecretRef pattern
 *
 * API keys e credenziali mai in plaintext obbligatorio nel config.
 * Il config salva un riferimento (env var, file, exec command)
 * che viene risolto a runtime.
 *
 * Pattern copiato da OpenClaw (openclaw/src/config/).
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// --- Tipi ---

export interface SecretPlaintext {
  type: "plaintext";
  value: string;
}

export interface SecretEnvRef {
  type: "ref";
  source: "env";
  id: string;
}

export interface SecretFileRef {
  type: "ref";
  source: "file";
  path: string;
}

export interface SecretExecRef {
  type: "ref";
  source: "exec";
  command: string;
}

export type SecretRef = SecretPlaintext | SecretEnvRef | SecretFileRef | SecretExecRef;

// --- Risoluzione ---

/**
 * Risolve un SecretRef al suo valore effettivo a runtime.
 * Supporta anche stringhe legacy (plaintext diretto).
 */
export function resolveSecret(secret: SecretRef | string | undefined): string {
  if (!secret) return "";
  if (typeof secret === "string") return secret;

  if (secret.type === "plaintext") return secret.value ?? "";
  if (secret.type !== "ref") return "";

  switch (secret.source) {
    case "env":
      return process.env[secret.id] ?? "";
    case "file":
      try {
        return readFileSync(secret.path, "utf-8").trim();
      } catch {
        return "";
      }
    case "exec":
      try {
        return execSync(secret.command, { encoding: "utf-8", timeout: 5000 }).trim();
      } catch {
        return "";
      }
    default:
      return "";
  }
}

// --- Factory ---

/**
 * Crea un SecretRef dal modo scelto e dal valore.
 */
export function createSecretRef(
  mode: "plaintext" | "env" | "file" | "exec",
  value: string,
): SecretRef {
  switch (mode) {
    case "env":
      return { type: "ref", source: "env", id: value };
    case "file":
      return { type: "ref", source: "file", path: value };
    case "exec":
      return { type: "ref", source: "exec", command: value };
    default:
      return { type: "plaintext", value };
  }
}

// --- Display ---

/**
 * Descrizione leggibile di un SecretRef per log e riepilogo.
 * Non espone mai il valore completo.
 */
export function describeSecret(secret: SecretRef | string | undefined): string {
  if (!secret) return "non configurato";
  if (typeof secret === "string") return `plaintext (${secret.slice(0, 8)}****)`;

  if (secret.type === "plaintext") {
    return `plaintext (${(secret.value ?? "").slice(0, 8)}****)`;
  }
  if (secret.type === "ref") {
    if (secret.source === "env") return `env:${secret.id}`;
    if (secret.source === "file") return `file:${secret.path}`;
    if (secret.source === "exec") return `exec:${secret.command.slice(0, 30)}`;
  }
  return "sconosciuto";
}
