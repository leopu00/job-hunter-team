/**
 * JHT Context Engine — Compactor: riduce contesto via riassunto
 *
 * Quando il contesto supera il budget, il compactor crea un riassunto
 * dei messaggi vecchi e li sostituisce con un singolo messaggio system.
 * Il riassunto puo' essere generato via AI o con strategia locale.
 */
import type { ContextMessage, CompactResult } from './types.js';
import { estimateMessageTokens } from './types.js';

/** Callback per generare riassunto via AI */
export type SummarizeFn = (params: {
  messages: ContextMessage[];
  instructions?: string;
  maxTokens?: number;
}) => Promise<string>;

/**
 * Strategia di compaction locale: prende i messaggi piu' vecchi
 * e li riduce a bullet point (senza AI).
 */
function localSummarize(messages: ContextMessage[]): string {
  const lines: string[] = ['Riassunto conversazione precedente:'];
  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'Utente' : msg.role === 'assistant' ? 'Assistente' : 'Sistema';
    const text = msg.content.length > 150
      ? msg.content.slice(0, 147) + '...'
      : msg.content;
    lines.push(`- [${prefix}] ${text}`);
  }
  return lines.join('\n');
}

/**
 * Decide quali messaggi compattare.
 * Mantiene i messaggi recenti, compatta i vecchi.
 * System messages (index 0) vengono sempre mantenuti.
 */
function splitForCompaction(
  messages: ContextMessage[],
  tokenBudget: number,
): { keep: ContextMessage[]; compact: ContextMessage[] } {
  if (messages.length <= 2) {
    return { keep: messages, compact: [] };
  }

  // Calcola token totali
  let totalTokens = 0;
  for (const msg of messages) {
    totalTokens += estimateMessageTokens(msg);
  }

  // Se sotto budget, niente da compattare
  if (totalTokens <= tokenBudget) {
    return { keep: messages, compact: [] };
  }

  // Mantieni system prompt (primo messaggio se system)
  const hasSystemPrefix = messages[0]?.role === 'system';
  const systemMsg = hasSystemPrefix ? [messages[0]] : [];
  const rest = hasSystemPrefix ? messages.slice(1) : messages;

  // Calcola token system
  const systemTokens = systemMsg.reduce((s, m) => s + estimateMessageTokens(m), 0);
  const remainingBudget = tokenBudget - systemTokens;

  // Mantieni messaggi recenti che entrano nel budget (riserva ~200 token per riassunto)
  const summaryReserve = 200;
  const keepBudget = remainingBudget - summaryReserve;

  let keptTokens = 0;
  const keep: ContextMessage[] = [];

  for (let i = rest.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(rest[i]);
    if (keptTokens + msgTokens > keepBudget) break;
    keptTokens += msgTokens;
    keep.unshift(rest[i]);
  }

  const compactCount = rest.length - keep.length;
  const compact = rest.slice(0, compactCount);

  return {
    keep: [...systemMsg, ...keep],
    compact,
  };
}

/**
 * Compatta messaggi di contesto per rientrare nel budget.
 *
 * Se fornita una summarizeFn (AI), la usa per il riassunto.
 * Altrimenti usa il riassunto locale (bullet point).
 */
export async function compactContext(params: {
  messages: ContextMessage[];
  tokenBudget: number;
  force?: boolean;
  instructions?: string;
  summarizeFn?: SummarizeFn;
}): Promise<CompactResult & { messages: ContextMessage[] }> {
  const { messages, tokenBudget, force, instructions, summarizeFn } = params;

  const totalTokens = messages.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0,
  );

  // Soglia: compatta se > 80% del budget (o se forzato)
  const threshold = tokenBudget * 0.8;
  if (!force && totalTokens <= threshold) {
    return {
      ok: true,
      compacted: false,
      reason: 'sotto soglia',
      tokensBefore: totalTokens,
      tokensAfter: totalTokens,
      messages,
    };
  }

  const { keep, compact } = splitForCompaction(messages, tokenBudget);

  if (compact.length === 0) {
    return {
      ok: true,
      compacted: false,
      reason: 'niente da compattare',
      tokensBefore: totalTokens,
      tokensAfter: totalTokens,
      messages,
    };
  }

  // Genera riassunto
  let summary: string;
  try {
    if (summarizeFn) {
      summary = await summarizeFn({ messages: compact, instructions, maxTokens: 150 });
    } else {
      summary = localSummarize(compact);
    }
  } catch {
    summary = localSummarize(compact);
  }

  const summaryMsg: ContextMessage = { role: 'system', content: summary };
  const resultMessages = [summaryMsg, ...keep.filter((m) => m.role !== 'system' || keep.indexOf(m) > 0)];

  // Reinserisci system prompt originale se presente
  if (keep[0]?.role === 'system') {
    resultMessages.unshift(keep[0]);
    // Rimuovi duplicato
    const idx = resultMessages.indexOf(summaryMsg);
    if (idx > 0) {
      resultMessages.splice(1, 0, resultMessages.splice(idx, 1)[0]);
    }
  }

  const tokensAfter = resultMessages.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0,
  );

  return {
    ok: true,
    compacted: true,
    summary,
    tokensBefore: totalTokens,
    tokensAfter,
    messages: resultMessages,
  };
}
