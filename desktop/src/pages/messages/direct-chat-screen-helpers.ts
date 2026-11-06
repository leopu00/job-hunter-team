import type { DirectChatMessage, DirectChatPage } from "./direct-chat-contract";
import { cleanMessage, dayKey, transcript as conversationItems } from "./chat-kinds";
import { sameAsBefore } from "./same-as-before";

export function safeCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_-]{1,48}$/i.test(value)
    ? value
    : null;
}

export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  return safeCode((error as { code?: unknown }).code);
}

export function mergeMessages(
  current: DirectChatMessage[],
  page: DirectChatPage,
): DirectChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of page.messages) {
    const read = cleanMessage(message);
    // A line that did not change keeps the object it had: every read brings fresh objects, and a line whose
    // object is the same draws nothing again (ChatMessageRow), so one new line costs one line, not the history.
    const had = byId.get(message.id);
    byId.set(message.id, had ? sameAsBefore(had, read) : read);
  }
  return [...byId.values()].sort((left, right) => left.at - right.at);
}

/**
 * Ctrl+Enter starts a new line where the cursor is (a textarea does not do it by itself); Enter
 * alone sends, and Shift+Enter keeps the textarea's own new line.
 */
export function newLineAt(value: string, start: number, end: number): { value: string; cursor: number } {
  return { value: `${value.slice(0, start)}\n${value.slice(end)}`, cursor: start + 1 };
}

type ConversationItem = ReturnType<typeof conversationItems>[number];
export type GroupedConversationItem = ConversationItem & { repeated?: number };

/** Two bubbles are interchangeable only when they keep the same clickable replies too. */
function sameSuggestions(left: DirectChatMessage, right: DirectChatMessage): boolean {
  const leftLines = left.suggestions ?? [];
  const rightLines = right.suggestions ?? [];
  return leftLines.length === rightLines.length && leftLines.every((line, index) => line === rightLines[index]);
}

/** A run of identical automatic updates is one readable bubble with its count. */
export function groupRepeatedMessages(items: ConversationItem[]): GroupedConversationItem[] {
  const grouped: GroupedConversationItem[] = [];
  for (const item of items) {
    const previous = grouped.at(-1);
    const sameMessage =
      item.type === "message" &&
      previous?.type === "message" &&
      item.message.role !== "user" &&
      previous.message.role === item.message.role &&
      item.message.text === previous.message.text &&
      item.message.kind === previous.message.kind &&
      sameSuggestions(previous.message, item.message) &&
      dayKey(item.at) === dayKey(previous.at);
    if (sameMessage) {
      grouped[grouped.length - 1] = { ...item, repeated: (previous.repeated ?? 1) + 1 };
    } else {
      grouped.push(item);
    }
  }
  return grouped;
}

export function clientMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const REOPEN_NO_RETRY = new Set([
  "ssh_auth_failed",
  "ssh_rate_limited",
  "host_key_changed",
  "host_key_mismatch",
  "ssh_client_missing",
  "own_vps_key_changed",
  "own_vps_claim_refused",
  "account_scope_mismatch",
  "read_only_link",
  "existing_team_runtime_target_changed",
  "host_not_configured",
  "host_config_invalid",
]);
