import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient, DirectChatEvent, DirectChatPage, DirectChatReceipt, DirectChatStatus } from "./direct-chat-contract";

// The Assistant may begin a message with a mood tag («[caldo] Benvenuto!»), which her portrait shows as an
// expression. The person never reads the tag: the chat gives the text without it, in the transcript and in
// the quote of a reply.

function client(messages: DirectChatPage["messages"]) {
  let onEvent: ((event: DirectChatEvent) => void) | undefined;
  const mock: DirectChatClient = {
    subscribe: vi.fn(async ({ onEvent: next }): Promise<DirectChatStatus> => {
      onEvent = next;
      return { state: "ready" };
    }),
    status: vi.fn(async () => ({ state: "ready" as const })),
    reconnect: vi.fn(async () => ({ state: "ready" as const })),
    read: vi.fn(async (): Promise<DirectChatPage> => ({ messages, cursor: "c", questions: [] })),
    send: vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({ clientMessageId, accepted: true, messageId: "u2", at: 2, taken: true })),
    answer: vi.fn(),
    close: vi.fn(),
  };
  return { mock, push: (page: DirectChatPage) => act(() => onEvent?.({ kind: "messages", agentId: "assistente", page })) };
}

afterEach(() => {
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.restoreAllMocks();
});

describe("DirectChatScreen: the Assistant's mood tag", () => {
  it("is not read by the person: the message shows without it", async () => {
    const { mock } = client([{ id: "a1", role: "agent", text: "[caldo] Benvenuto! Dimmi come ti chiami.", at: 1 }]);
    render(<DirectChatScreen client={mock} initialAgentId="assistente" />);
    expect(await screen.findByText("Benvenuto! Dimmi come ti chiami.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("[caldo]");
  });

  it("is taken out of a message that comes while the chat is open, too", async () => {
    const { mock, push } = client([{ id: "a1", role: "agent", text: "Ciao.", at: 1 }]);
    render(<DirectChatScreen client={mock} initialAgentId="assistente" />);
    await screen.findByText("Ciao.");
    push({ messages: [{ id: "a2", role: "agent", text: "[sorpreso] Davvero?", at: 2 }], cursor: "c2", questions: [] });
    expect(await screen.findByText("Davvero?")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("[sorpreso]");
  });

  it("is left alone where it is not a mood tag: a tag out of the list, in the middle, in capitals, or the person's own words", async () => {
    const { mock } = client([
      { id: "a1", role: "agent", text: "[nota] Questo resta.", at: 1 },
      { id: "a2", role: "agent", text: "Dopo [caldo] resta.", at: 2 },
      { id: "a3", role: "agent", text: "[CALDO] Anche questo.", at: 3 },
      { id: "u1", role: "user", text: "[caldo] lo scrivo io", at: 4 },
    ]);
    render(<DirectChatScreen client={mock} initialAgentId="assistente" />);
    expect(await screen.findByText("[nota] Questo resta.")).toBeInTheDocument();
    expect(screen.getByText("Dopo [caldo] resta.")).toBeInTheDocument();
    expect(screen.getByText("[CALDO] Anche questo.")).toBeInTheDocument();
    expect(screen.getByText("[caldo] lo scrivo io")).toBeInTheDocument();
  });
});
