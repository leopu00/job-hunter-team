import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { ExecutionHost } from "./onboarding";

export type DirectChatState = "disconnected" | "connecting" | "ready" | "error";
export interface DirectChatStatus { state: DirectChatState; code?: string }
export interface DirectChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: number;
}
export interface DirectChatPage { messages: DirectChatMessage[]; cursor?: string }
export interface DirectChatReceipt {
  clientMessageId: string;
  accepted: true;
  messageId: string;
  at: number;
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

export async function closeDirectChat(): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("direct_chat_close");
}
