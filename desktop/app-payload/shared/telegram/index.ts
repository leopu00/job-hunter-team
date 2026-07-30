/**
 * Telegram bridge bidirezionale per JHT.
 *
 * Uso:
 *   import { TelegramBridge } from "./shared/telegram/index.js";
 *
 *   const bridge = new TelegramBridge(process.env.TELEGRAM_BOT_TOKEN!);
 *   await bridge.start(async (msg) => {
 *     return { chatId: msg.chatId, text: `Ricevuto: ${msg.text}` };
 *   });
 */

export { TelegramBridge } from "./bridge.js";
export { createBot, registerMessageHandler } from "./bot.js";
export { sendTextMessage } from "./bridge.js";
export type {
  TelegramBotConfig,
  InboundMessage,
  OutboundMessage,
  InboundHandler,
  SendResult,
  BridgeStatus,
} from "./types.js";
export { DEFAULT_CONFIG, getSequentialKey } from "./types.js";
