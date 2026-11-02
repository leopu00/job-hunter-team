import type { DirectChatMessage, DirectChatPage } from "./direct-chat";

/**
 * The last message exchanged with each agent, as far as THIS run of the app has already read it. Nothing asks
 * for it: the direct chat's own reads (the Messages page, its unread peeks) leave it here, and the office's
 * agent panel shows it without a read of its own. Kept in memory only, never written anywhere: a restart
 * forgets it, and an agent whose chat was not read yet has none (the panel says so, it never guesses).
 */
export type LastChatMessage = { role: "user" | "agent"; text: string; at: number };

const last = new Map<string, LastChatMessage>();

/** The longest piece of a message that is kept: the panel shows a line, not the conversation. */
export const LAST_MESSAGE_MAX = 280;

function newest(messages: readonly DirectChatMessage[]): LastChatMessage | null {
  let found: LastChatMessage | null = null;
  for (const message of messages) {
    // the person's words and the agent's: a system line («mail not taken») is not something said to the agent
    if (message.role !== "user" && message.role !== "agent") continue;
    if (typeof message.text !== "string" || message.text.trim() === "") continue;
    if (found === null || message.at >= found.at) found = { role: message.role, text: message.text.slice(0, LAST_MESSAGE_MAX), at: message.at };
  }
  return found;
}

/** Keeps the newest message of a page of this agent's chat, if it holds one newer than what is kept. */
export function rememberChatPage(agentId: string, page: Pick<DirectChatPage, "messages">): void {
  const found = newest(page.messages);
  if (!found) return;
  const kept = last.get(agentId);
  if (!kept || found.at >= kept.at) last.set(agentId, found);
}

export function lastChatMessage(agentId: string): LastChatMessage | null {
  return last.get(agentId) ?? null;
}

/** For tests. */
export function forgetChatMessages(): void {
  last.clear();
}
