/**
 * Comandi nativi del bridge Telegram.
 *
 * Definizione e dispatch dei comandi disponibili via bot.
 * Pattern: handler registrati sul bot grammy con autorizzazione sender.
 */

import type { Context } from "grammy";

export type CommandSpec = {
  name: string;
  description: string;
  handler: (ctx: Context, args: string) => Promise<void>;
};

export type CommandDispatchResult = {
  command: string;
  args: string;
  authorized: boolean;
};

/**
 * Parsing args dal testo del comando.
 * "/status arg1 arg2" → { command: "status", args: "arg1 arg2" }
 */
export function parseCommandArgs(text: string): { command: string; args: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/(\w+)(?:\s+(.*))?$/s);
  if (!match) return { command: "", args: "" };
  return {
    command: match[1].toLowerCase(),
    args: (match[2] ?? "").trim(),
  };
}

/**
 * Verifica se il sender è autorizzato (allow-list per chat ID).
 * Se allowFrom è vuoto, tutti sono autorizzati.
 */
export function isSenderAllowed(
  senderId: number,
  allowFrom: readonly number[]
): boolean {
  if (allowFrom.length === 0) return true;
  return allowFrom.includes(senderId);
}

/**
 * Costruisce la lista comandi per il menu del bot (BotFather).
 */
export function buildMenuCommands(specs: readonly CommandSpec[]): Array<{
  command: string;
  description: string;
}> {
  return specs.map((s) => ({
    command: s.name,
    description: s.description,
  }));
}
