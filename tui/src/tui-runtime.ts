import { existsSync } from "node:fs";

/**
 * True quando il processo gira dentro un container JHT.
 * Convenzione condivisa con scripts/install.sh, desktop/runtime.js
 * e shared/runtime/container.js — non cambiare la logica senza
 * sincronizzarli.
 */
export function isContainer(): boolean {
  if (process.env.IS_CONTAINER === "1") return true;
  try {
    return existsSync("/.dockerenv");
  } catch {
    return false;
  }
}
