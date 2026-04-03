/**
 * Invio messaggi Telegram — formattazione e chunking.
 *
 * Gestisce messaggi lunghi con split automatico,
 * formattazione HTML, e retry su errori di rete.
 */

import type { Bot } from "grammy";

const MAX_MESSAGE_LENGTH = 4096;
const RETRY_DELAYS = [1000, 3000, 5000];

/**
 * Splitta testo lungo in chunk rispettando il limite Telegram.
 * Prova a spezzare su newline, altrimenti su spazio, altrimenti taglio secco.
 */
export function splitMessage(text: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(" ", maxLen);
    if (splitAt <= 0) splitAt = maxLen;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Invia messaggio con retry su errori transitori.
 */
async function sendWithRetry(
  bot: Bot,
  chatId: number,
  text: string,
  parseMode: "HTML" | "MarkdownV2" = "HTML"
): Promise<void> {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      await bot.api.sendMessage(chatId, text, { parse_mode: parseMode });
      return;
    } catch (err: unknown) {
      const isRetryable =
        err instanceof Error && /network|timeout|429/i.test(err.message);
      if (!isRetryable || attempt >= RETRY_DELAYS.length) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
}

/**
 * Invia messaggio lungo, con chunking automatico e retry.
 */
export async function sendMessage(
  bot: Bot,
  chatId: number,
  text: string
): Promise<void> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await sendWithRetry(bot, chatId, chunk);
  }
}

/**
 * Invia notifica di stato formattata.
 */
export async function sendStatus(
  bot: Bot,
  chatId: number,
  title: string,
  items: readonly string[]
): Promise<void> {
  const body = items.map((item) => `• ${item}`).join("\n");
  const text = `<b>${title}</b>\n\n${body}`;
  await sendMessage(bot, chatId, text);
}
