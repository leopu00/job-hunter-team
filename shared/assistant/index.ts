/**
 * Bot assistente personale → team JHT.
 *
 * Uso:
 *   import { createAssistantBot, TeamBridge, registerAssistantHandlers } from "./shared/assistant/index.js";
 *
 *   const bridge = new TeamBridge({ botToken: TOKEN, ownerChatId: CHAT_ID });
 *   const bot = createAssistantBot({ ...bridge.config });
 *   registerAssistantHandlers(bot, config, async (intent, chatId) => {
 *     await bridge.dispatch(intent, chatId);
 *   });
 *   bot.start();
 */

export { createAssistantBot, registerAssistantHandlers, classifyIntent, getIntentAck } from "./assistant-bot.js";
export { TeamBridge } from "./bridge-to-team.js";
export type {
  AssistantConfig,
  UserIntent,
  JobSearchFilters,
  TeamRequest,
  TeamResponse,
  CaptainMessage,
  AssistantEvent,
  AssistantEventHandler,
  AssistantStatus,
} from "./types.js";
export { DEFAULT_ASSISTANT_CONFIG } from "./types.js";
