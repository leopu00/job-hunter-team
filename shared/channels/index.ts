/**
 * JHT Channels — Modulo canali comunicazione
 */

// Tipi e interfaccia base
export type {
  ChannelId,
  MessageDirection,
  ChannelMessage,
  ChannelCapabilities,
  ChannelMeta,
  MessageHandler,
  Channel,
} from './channel.js';
export { CHANNEL_IDS, createMessageId, buildInboundMessage, buildOutboundMessage } from './channel.js';

// Implementazioni canali
export { CLIChannel } from './cli-channel.js';
export { WebChannel } from './web-channel.js';
export { TelegramChannel } from './telegram-channel.js';
export type { TelegramSendFn } from './telegram-channel.js';

// Registry
export { ChannelRegistry, getDefaultRegistry, resetDefaultRegistry } from './registry.js';
