/**
 * Creazione e configurazione del bot Telegram.
 *
 * Crea il bot grammy, registra handler per messaggi e comandi,
 * gestisce allow-list e logging.
 */

import { Bot } from "grammy";
import type { Context } from "grammy";
import {
  type CommandSpec,
  buildMenuCommands,
  isSenderAllowed,
  parseCommandArgs,
} from "./commands.js";

export type BotOptions = {
  token: string;
  allowFrom?: number[];
  onMessage?: (ctx: MessageContext) => Promise<void>;
  onCommand?: (ctx: MessageContext, command: string, args: string) => Promise<void>;
};

export type MessageContext = {
  chatId: number;
  senderId: number;
  senderName: string;
  text: string;
  isGroup: boolean;
  replyTo: (text: string) => Promise<void>;
};

function buildMessageContext(ctx: Context): MessageContext | null {
  const msg = ctx.message;
  if (!msg?.text) return null;

  const chatId = msg.chat.id;
  const senderId = msg.from?.id ?? 0;
  const senderName = [msg.from?.first_name, msg.from?.last_name]
    .filter(Boolean)
    .join(" ") || `user:${senderId}`;
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

  return {
    chatId,
    senderId,
    senderName,
    text: msg.text,
    isGroup,
    replyTo: async (text: string) => {
      await ctx.reply(text, { parse_mode: "HTML" });
    },
  };
}

/**
 * Comandi built-in del bridge JHT.
 */
export function getDefaultCommands(): CommandSpec[] {
  return [
    { name: "status", description: "Stato del team", handler: async () => {} },
    { name: "run", description: "Esegui task", handler: async () => {} },
    { name: "stop", description: "Ferma task in corso", handler: async () => {} },
    { name: "team", description: "Lista worker attivi", handler: async () => {} },
    { name: "help", description: "Mostra comandi disponibili", handler: async () => {} },
  ];
}

export function createBot(opts: BotOptions): Bot {
  const bot = new Bot(opts.token);
  const allowFrom = opts.allowFrom ?? [];

  // Middleware: auth check
  bot.use(async (ctx, next) => {
    const senderId = ctx.from?.id;
    if (senderId && !isSenderAllowed(senderId, allowFrom)) {
      return; // Ignora utenti non autorizzati
    }
    await next();
  });

  // Handler messaggi di testo
  bot.on("message:text", async (ctx) => {
    const msgCtx = buildMessageContext(ctx);
    if (!msgCtx) return;

    const { command, args } = parseCommandArgs(msgCtx.text);

    if (command && opts.onCommand) {
      await opts.onCommand(msgCtx, command, args);
    } else if (!command && opts.onMessage) {
      await opts.onMessage(msgCtx);
    }
  });

  return bot;
}

/**
 * Registra i comandi nel menu del bot (BotFather).
 */
export async function syncMenuCommands(
  bot: Bot,
  specs: readonly CommandSpec[]
): Promise<void> {
  const commands = buildMenuCommands(specs);
  await bot.api.setMyCommands(commands);
}
