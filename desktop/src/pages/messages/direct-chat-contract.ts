export type DirectChatStatus = {
  state: "disconnected" | "connecting" | "ready" | "error";
  code?: string;
};

export type DirectChatMessage = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: number;
};

export type DirectChatPage = {
  messages: DirectChatMessage[];
  cursor?: string;
};

export type DirectChatReceipt = {
  clientMessageId: string;
  accepted: true;
  messageId: string;
  at: number;
};

export type DirectChatEvent =
  | { kind: "status"; status: DirectChatStatus }
  | { kind: "messages"; agentId: string; page: DirectChatPage }
  | { kind: "send"; receipt: DirectChatReceipt }
  | {
      kind: "error";
      operation: "connect" | "read" | "send" | "stream";
      code: string;
    };

type MaybePromise<T> = T | Promise<T>;

/** Structural boundary implemented by desktop/src/lib/direct-chat.ts. */
export type DirectChatClient = {
  subscribe(args: { onEvent: (event: DirectChatEvent) => void }): MaybePromise<DirectChatStatus>;
  status(): MaybePromise<DirectChatStatus>;
  reconnect(): Promise<DirectChatStatus>;
  read(args: { agentId: string; cursor?: string }): Promise<DirectChatPage>;
  send(args: {
    agentId: string;
    text: string;
    clientMessageId: string;
  }): Promise<DirectChatReceipt>;
  close(): MaybePromise<void>;
};
