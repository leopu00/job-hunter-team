/**
 * Bot assistente personale utente.
 *
 * Riceve messaggi dall'utente, classifica l'intent,
 * e inoltra le richieste al team JHT tramite il bridge.
 */

import { Bot, type Context } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import type { AssistantConfig, UserIntent } from "./types.js";
import { DEFAULT_ASSISTANT_CONFIG } from "./types.js";

// ── BOT CREATION ────────────────────────────────────────────

export function createAssistantBot(config: AssistantConfig): Bot {
  const bot = new Bot(config.botToken);
  bot.api.config.use(autoRetry());
  bot.catch((err) => {
    console.error(`[${config.name}] Errore:`, err.message);
  });
  return bot;
}

// ── ACCESS CONTROL ──────────────────────────────────────────

/** Solo il proprietario può usare il bot */
export function isOwner(ctx: Context, ownerChatId: string): boolean {
  return String(ctx.chat?.id) === ownerChatId;
}

// ── INTENT CLASSIFICATION ───────────────────────────────────

const JOB_SEARCH_PATTERNS = [
  /trovami\s+(un\s+)?lavoro/i,
  /cerca\s+(un\s+)?lavoro/i,
  /cerco\s+(un\s+)?lavoro/i,
  /find\s+(me\s+)?(a\s+)?job/i,
  /job\s+search/i,
  /posizioni?\s+aperte?/i,
  /offerte?\s+di\s+lavoro/i,
  /voglio\s+(un\s+)?lavoro/i,
];

const STATUS_PATTERNS = [
  /stato\s+(delle?\s+)?ricerca/i,
  /a\s+che\s+punto/i,
  /come\s+(va|procede)/i,
  /aggiornamento/i,
  /status/i,
  /update/i,
];

const LIST_PATTERNS = [
  /lista\s+(delle?\s+)?candidature/i,
  /le\s+mie\s+candidature/i,
  /application/i,
  /candidature/i,
  /dove\s+ho\s+(fatto\s+)?domanda/i,
];

const STOP_PATTERNS = [
  /ferma\s+(la\s+)?ricerca/i,
  /stop/i,
  /basta\s+cercare/i,
  /pausa/i,
];

const PROFILE_PATTERNS = [
  /aggiorna\s+(il\s+)?(mio\s+)?profilo/i,
  /modifica\s+(il\s+)?(mio\s+)?cv/i,
  /update\s+profile/i,
  /cambia\s+(le\s+)?competenze/i,
];

/** Classifica il testo dell'utente in un intent strutturato */
export function classifyIntent(text: string): UserIntent {
  const trimmed = text.trim();

  if (JOB_SEARCH_PATTERNS.some((p) => p.test(trimmed))) {
    const filters = extractJobFilters(trimmed);
    return { kind: "job_search", query: trimmed, filters };
  }
  if (STATUS_PATTERNS.some((p) => p.test(trimmed))) {
    return { kind: "status_check" };
  }
  if (LIST_PATTERNS.some((p) => p.test(trimmed))) {
    return { kind: "list_applications" };
  }
  if (STOP_PATTERNS.some((p) => p.test(trimmed))) {
    return { kind: "stop_search" };
  }
  if (PROFILE_PATTERNS.some((p) => p.test(trimmed))) {
    return { kind: "update_profile", details: trimmed };
  }
  return { kind: "unknown", rawText: trimmed };
}

// ── FILTER EXTRACTION ───────────────────────────────────────

function extractJobFilters(text: string): { role?: string; remote?: boolean; location?: string } {
  const filters: { role?: string; remote?: boolean; location?: string } = {};

  // Rileva remote
  if (/remote|remoto|da\s+casa|smart\s*working/i.test(text)) {
    filters.remote = true;
  }

  // Rileva ruolo (dopo "come" o "da")
  const roleMatch = text.match(/(?:come|da|ruolo\s+di?)\s+([a-zA-ZàèéìòùÀÈÉÌÒÙ\s-]+)/i);
  if (roleMatch) {
    filters.role = roleMatch[1].trim().slice(0, 100);
  }

  // Rileva location (dopo "a" o "in")
  const locMatch = text.match(/(?:\ba\b|\bin\b)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*)/);
  if (locMatch) {
    filters.location = locMatch[1].trim();
  }

  return filters;
}

// ── USER MESSAGES ───────────────────────────────────────────

const INTENT_MESSAGES: Record<string, string> = {
  job_search: "🔍 Ricerca avviata! Ho inoltrato la tua richiesta al team. Ti aggiorno appena ci sono novità.",
  status_check: "📊 Chiedo aggiornamenti al team...",
  list_applications: "📋 Recupero la lista delle tue candidature...",
  stop_search: "⏸️ Richiesta di pausa inviata al team.",
  update_profile: "✏️ Richiesta di aggiornamento profilo inviata.",
  unknown: "🤔 Non ho capito la richiesta. Prova con:\n• \"Trovami lavoro come developer\"\n• \"Stato della ricerca\"\n• \"Lista candidature\"",
};

/** Messaggio di conferma per l'utente */
export function getIntentAck(intent: UserIntent): string {
  return INTENT_MESSAGES[intent.kind] ?? INTENT_MESSAGES.unknown;
}

// ── HANDLER REGISTRATION ────────────────────────────────────

export type OnUserRequest = (intent: UserIntent, chatId: string, messageId: number) => Promise<void>;

/** Registra handler messaggi sul bot assistente */
export function registerAssistantHandlers(
  bot: Bot,
  config: AssistantConfig,
  onRequest: OnUserRequest
): void {
  // Comando /start
  bot.command("start", async (ctx) => {
    if (!isOwner(ctx, config.ownerChatId)) return;
    await ctx.reply(
      `${config.avatar} Ciao! Sono il tuo ${config.name}.\n\n` +
      "Dimmi cosa cerchi e il team si mette al lavoro:\n" +
      '• "Trovami lavoro come React developer"\n' +
      '• "Stato della ricerca"\n' +
      '• "Lista candidature"'
    );
  });

  // Messaggi normali
  bot.on("message:text", async (ctx) => {
    if (!isOwner(ctx, config.ownerChatId)) return;

    const intent = classifyIntent(ctx.message.text);
    const ack = getIntentAck(intent);
    await ctx.reply(ack, { reply_to_message_id: ctx.message.message_id });

    if (intent.kind !== "unknown") {
      await onRequest(intent, String(ctx.chat.id), ctx.message.message_id);
    }
  });
}
