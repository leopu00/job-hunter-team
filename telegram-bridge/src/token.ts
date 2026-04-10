/**
 * Risoluzione token Telegram bot.
 *
 * Catena di precedenza: env var → file locale → config.
 * Il token non viene MAI hardcodato o committato.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export type TokenSource = "env" | "file" | "config" | "none";

export type TokenResolution = {
  token: string;
  source: TokenSource;
};

// Path mirror di shared/paths.ts (telegram-bridge e un modulo standalone
// con rootDir: src, non puo importare ../../shared). Honor JHT_HOME.
const JHT_HOME = process.env.JHT_HOME || resolve(homedir(), ".jht");
const CREDENTIALS_DIR = resolve(JHT_HOME, "credentials");
const TOKEN_FILE = resolve(CREDENTIALS_DIR, "telegram_bot.json");

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readTokenFile(): string | undefined {
  try {
    const raw = readFileSync(TOKEN_FILE, "utf-8");
    const data = JSON.parse(raw);
    return trimToUndefined(data?.token);
  } catch {
    return undefined;
  }
}

export function resolveToken(opts: {
  envToken?: string | null;
  configToken?: string | null;
} = {}): TokenResolution {
  // Precedenza 1: variabile d'ambiente
  const envToken = trimToUndefined(
    opts.envToken ?? process.env.TELEGRAM_BOT_TOKEN
  );
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  // Precedenza 2: file locale in ~/.jht/credentials/
  const fileToken = readTokenFile();
  if (fileToken) {
    return { token: fileToken, source: "file" };
  }

  // Precedenza 3: config passato esplicitamente
  const configToken = trimToUndefined(opts.configToken);
  if (configToken) {
    return { token: configToken, source: "config" };
  }

  return { token: "", source: "none" };
}
