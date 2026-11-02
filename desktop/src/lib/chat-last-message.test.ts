import { beforeEach, describe, expect, it } from "vitest";
import { forgetChatMessages, LAST_MESSAGE_MAX, lastChatMessage, rememberChatPage } from "./chat-last-message";

const msg = (id: string, role: "user" | "agent" | "system", text: string, at: number) => ({ id, role, text, at });

describe("the last message exchanged with each agent, kept from the chat's own reads", () => {
  beforeEach(() => forgetChatMessages());

  it("has nothing for an agent whose chat was not read", () => {
    expect(lastChatMessage("scout")).toBeNull();
  });

  it("keeps the newest message of the person or the agent, never a system line", () => {
    rememberChatPage("capitano", { messages: [msg("1", "agent", "uno", 10), msg("2", "user", "due", 20), msg("3", "system", "mail_not_taken", 30)] });
    expect(lastChatMessage("capitano")).toEqual({ role: "user", text: "due", at: 20 });
  });

  it("an older or empty page does not replace a newer message", () => {
    rememberChatPage("scout", { messages: [msg("1", "agent", "nuovo", 50)] });
    rememberChatPage("scout", { messages: [msg("0", "agent", "vecchio", 5)] });
    rememberChatPage("scout", { messages: [] });
    rememberChatPage("scout", { messages: [msg("9", "agent", "   ", 99)] });
    expect(lastChatMessage("scout")).toEqual({ role: "agent", text: "nuovo", at: 50 });
  });

  it("keeps only a line's worth of a long message, and each agent apart", () => {
    rememberChatPage("critico", { messages: [msg("1", "agent", "x".repeat(LAST_MESSAGE_MAX + 500), 1)] });
    rememberChatPage("mentor", { messages: [msg("2", "user", "ciao", 2)] });
    expect(lastChatMessage("critico")?.text).toHaveLength(LAST_MESSAGE_MAX);
    expect(lastChatMessage("mentor")?.text).toBe("ciao");
  });
});
