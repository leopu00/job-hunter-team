/**
 * Event Channels — Bus pre-configurati per i domini JHT
 *
 * Canali tipizzati per agenti, sistema e messaggi.
 * Ogni canale e' un EventBus singleton con tipi specifici.
 */

import { EventBus } from "./event-bus.js";
import type { AgentEventData, SystemEventData, MessageEventData } from "./types.js";

/** Eventi agente: turn start/end, tool call/result, text, error */
export const agentEvents = new EventBus<AgentEventData>("agent");

/** Eventi sistema: startup, shutdown, config changed, hook fired */
export const systemEvents = new EventBus<SystemEventData>("system");

/** Eventi messaggi: received, sent, failed */
export const messageEvents = new EventBus<MessageEventData>("message");
