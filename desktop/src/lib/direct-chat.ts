import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { ExecutionHost } from "./onboarding";

export type DirectChatState = "disconnected" | "connecting" | "ready" | "error";
/** `link: "per-command"`: every read is a new ssh connection (Windows to a VPS), so the page reads less often. */
export interface DirectChatStatus { state: DirectChatState; code?: string; link?: "per-command" }
/**
 * What kind of message the agent says it sends. It decides how much the message shows: urgent and
 * blocked have a colour, the others only their label. A row without one, or with one outside the
 * list (an older image, a typo), is `info`.
 */
export type ChatKind = "urgent" | "blocked" | "question" | "completed" | "info";
/** A message's kind: `question` belongs to the questions only, so on a message it is `info`. */
export type MessageKind = Exclude<ChatKind, "question">;
export interface DirectChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: number;
  /** A closed code on a system line, e.g. `mail_not_taken`: the page says it in the person's language. */
  code?: string;
  /** On the agent's rows: the kind it declared. */
  kind?: MessageKind;
  /** On the agent's rows: replies it suggests (2 to 5, one line each); a click sends one as a message. */
  suggestions?: string[];
}
export interface DirectChatQuestionOption { id: string; label: string }
export interface DirectChatAnswer {
  /** the ids of the options taken */
  choices: string[];
  /** the person's words, when the question takes them */
  text?: string;
  at: number;
  /** `expiry`: nobody answered in time and the question's safe option was taken */
  /** `system`: the question had no object any more and the system closed it; never the person's choice */
  /** `unknown`: the team gave an origin of its own; never said as the person's. */
  origin: "user" | "expiry" | "system" | "unknown";
  /** when the agent read the answer in its turn; null until then */
  seenAt: number | null;
}
/** A question the agent asked the person (the team's structured questions), shown in its chat. */
export interface DirectChatQuestion {
  id: string;
  at: number;
  kind: ChatKind;
  subject?: string;
  text: string;
  options: DirectChatQuestionOption[];
  multiple: boolean;
  /** words are accepted, with or without an option */
  free: boolean;
  expiresAt: number | null;
  state: "open" | "answered" | "expired";
  answer?: DirectChatAnswer;
}
/**
 * `questions`: the agent's open questions and its latest closed ones; absent from an older image.
 * `queued`: the ids of the turns the team holds back while its agent works; a queued turn is delivered
 * once its id is no longer here. Absent from an older image or a chat that never queued.
 */
export interface DirectChatPage {
  messages: DirectChatMessage[]; cursor?: string; questions?: DirectChatQuestion[]; queued?: string[];
  /** How the turns that left the queue ended (last day): typed and taken, still in the composer, no proof, or never typed. */
  settled?: { id: string; how: "taken" | "pending" | "late" | "unconfirmed" | "expired" }[];
  /**
   * What the agent's terminal shows within half an hour of the person's last turn, answered or not (the
   * agent may answer first and go on working): `working` (a running turn) or `idle` (an empty prompt).
   * Absent: not known (an older image, a screen the team cannot read, an older turn): never read as idle.
   */
  activity?: "working" | "idle";
}
export interface DirectChatAnswerReceipt { questionId: string; accepted: true; at: number }
export interface DirectChatReceipt {
  clientMessageId: string;
  accepted: true;
  messageId: string;
  at: number;
  /** `queued`: the turn is in the agent's mailbox and nobody has taken it yet. Absent: it was typed. */
  state?: string;
  /**
   * Whether the agent's CLI took the text, with proof: true (seen in its composer, then gone, or
   * once more in its conversation), false (still in the composer: only Enter may be pressed again),
   * null (not known: a menu, a login, a screen that cannot be read; nothing may be pressed).
   * Absent from an older image: what `state` says.
   */
  taken?: boolean | null;
  /** With `taken: null`: why it is not known, a closed code of the team's (TAKEN_REASONS); any other is not shown. */
  reason?: string;
  /** With `state: "queued"`: `terminal` when the team holds the turn until its agent is idle (the pages say when it goes). */
  queue?: "terminal";
}
export type DirectChatEvent =
  | { kind: "status"; status: DirectChatStatus }
  | { kind: "messages"; agentId: string; page: DirectChatPage }
  | { kind: "send"; receipt: DirectChatReceipt }
  | { kind: "error"; operation: "connect" | "read" | "send" | "stream"; code: string };

const AGENT_ALIASES: Record<string, string> = { coordinatore: "capitano" };
function agentId(value: string): string { return AGENT_ALIASES[value] ?? value; }
function desktopOnly(): never { throw { code: "desktop_only" }; }

/** Called by onboarding/router; message components never receive host credentials. */
export async function connectDirectChat(host: ExecutionHost): Promise<DirectChatStatus> {
  if (!isTauri()) desktopOnly();
  return invoke("direct_chat_connect", { host });
}

export async function subscribeDirectChat(onEvent: (event: DirectChatEvent) => void): Promise<DirectChatStatus> {
  if (!isTauri()) desktopOnly();
  const channel = new Channel<DirectChatEvent>();
  channel.onmessage = onEvent;
  return invoke("direct_chat_subscribe", { onEvent: channel });
}

export async function directChatStatus(): Promise<DirectChatStatus> {
  if (!isTauri()) desktopOnly();
  return invoke("direct_chat_status");
}

export async function reconnectDirectChat(): Promise<DirectChatStatus> {
  if (!isTauri()) desktopOnly();
  return invoke("direct_chat_reconnect");
}

export async function readDirectChat(agent: string, cursor?: string): Promise<DirectChatPage> {
  if (!isTauri()) desktopOnly();
  return invoke("direct_chat_read", { agentId: agentId(agent), cursor: cursor ?? null });
}

export async function sendDirectChat(agent: string, text: string, clientMessageId: string): Promise<DirectChatReceipt> {
  if (!isTauri()) desktopOnly();
  return invoke("direct_chat_send", { agentId: agentId(agent), text, clientMessageId });
}

/** Whether the paperclip can be used now; off, `code` is why (attach_vps, attach_read_only, attach_platform, attach_not_connected). */
export interface DirectChatAttachState { available: boolean; code?: string }
/**
 * What choosing a file ended in: `sent` (copied, the team sees it, the Assistant was told), `saved_not_sent`
 * (copied, the Assistant was not told: `code` says why), `cancelled` (the window was closed).
 * `displayName` is the person's own file name, for their screen only.
 */
export interface DirectChatAttachment {
  outcome: "sent" | "saved_not_sent" | "cancelled";
  displayName?: string;
  code?: string;
  receipt?: DirectChatReceipt;
}

export async function directChatAttachState(): Promise<DirectChatAttachState> {
  if (!isTauri()) desktopOnly();
  return invoke("direct_chat_attach_state");
}

/** Only the Assistant takes files. The page names no path: the system's window is opened by the app. */
export async function attachDirectChat(clientMessageId: string, locale: string): Promise<DirectChatAttachment> {
  if (!isTauri()) desktopOnly();
  return invoke("direct_chat_attach", { agentId: "assistente", clientMessageId, locale });
}

/** The person's answer to one of the agent's questions: the options' ids and, where taken, words. */
export async function answerDirectChat(
  agent: string,
  questionId: string,
  choices: string[],
  text: string | null,
): Promise<DirectChatAnswerReceipt> {
  if (!isTauri()) desktopOnly();
  return invoke("direct_chat_answer", { agentId: agentId(agent), questionId, choices, text });
}

/** Enter pressed once more on a text left in the agent's composer, never the text again. */
export async function enterDirectChat(agent: string, messageId: string): Promise<DirectChatReceipt> {
  if (!isTauri()) desktopOnly();
  return invoke("direct_chat_enter", { agentId: agentId(agent), messageId });
}

export async function closeDirectChat(): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("direct_chat_close");
}
