import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  Channel: class { onmessage?: (value: unknown) => void },
}));

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  closeDirectChat,
  connectDirectChat,
  directChatStatus,
  readDirectChat,
  reconnectDirectChat,
  sendDirectChat,
  subscribeDirectChat,
  type DirectChatStatus,
} from "./direct-chat";

const READY: DirectChatStatus = { state: "ready" };

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(READY);
  vi.mocked(isTauri).mockReset().mockReturnValue(true);
});

describe("direct chat native boundary", () => {
  it("connects with a typed host and exposes verified status/retry/cleanup commands", async () => {
    await connectDirectChat({ kind: "vps", address: "vps.example.invalid", user: "root", port: 22, keyPath: "/tmp/synthetic-key" });
    await directChatStatus();
    await reconnectDirectChat();
    await closeDirectChat();

    expect(invoke).toHaveBeenNthCalledWith(1, "direct_chat_connect", {
      host: { kind: "vps", address: "vps.example.invalid", user: "root", port: 22, keyPath: "/tmp/synthetic-key" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "direct_chat_status");
    expect(invoke).toHaveBeenNthCalledWith(3, "direct_chat_reconnect");
    expect(invoke).toHaveBeenNthCalledWith(4, "direct_chat_close");
  });

  it("maps the UI coordinator alias but never changes message text", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ messages: [], cursor: "12" });
    await readDirectChat("coordinatore", "4");
    await sendDirectChat("coordinatore", "testo sintetico", "synthetic-1");
    expect(invoke).toHaveBeenNthCalledWith(1, "direct_chat_read", { agentId: "capitano", cursor: "4" });
    expect(invoke).toHaveBeenNthCalledWith(2, "direct_chat_send", {
      agentId: "capitano", text: "testo sintetico", clientMessageId: "synthetic-1",
    });
  });

  it("subscribes through an IPC channel and refuses browser-only operation", async () => {
    await subscribeDirectChat(vi.fn());
    expect(invoke).toHaveBeenCalledWith("direct_chat_subscribe", { onEvent: expect.anything() });

    vi.mocked(isTauri).mockReturnValue(false);
    await expect(directChatStatus()).rejects.toEqual({ code: "desktop_only" });
  });
});
