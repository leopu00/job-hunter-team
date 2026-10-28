import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient, DirectChatEvent, DirectChatPage, DirectChatQuestion, DirectChatReceipt, DirectChatStatus } from "./direct-chat-contract";

// A question the agent asked in plain words (no options): a card with no buttons, answered by writing in the chat's box.

const PLAIN: DirectChatQuestion = {
  id: "pm:11",
  at: 100,
  kind: "question",
  text: "Which plan do you use? Plus, Pro or Business.",
  options: [],
  multiple: false,
  free: false,
  expiresAt: null,
  state: "open",
};

function client(page: Partial<DirectChatPage> = {}) {
  let onEvent: ((event: DirectChatEvent) => void) | undefined;
  const mock: DirectChatClient = {
    subscribe: vi.fn(async ({ onEvent: next }): Promise<DirectChatStatus> => {
      onEvent = next;
      return { state: "ready" };
    }),
    status: vi.fn(async () => ({ state: "ready" as const })),
    reconnect: vi.fn(async () => ({ state: "ready" as const })),
    read: vi.fn(async (): Promise<DirectChatPage> => ({ messages: [], cursor: "c", questions: [PLAIN], ...page })),
    send: vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({ clientMessageId, accepted: true, messageId: "u2", at: 2, taken: true })),
    answer: vi.fn(),
    close: vi.fn(),
  };
  return { mock, page: (value: DirectChatPage) => act(() => onEvent?.({ kind: "messages", agentId: "assistente", page: value })) };
}

afterEach(() => {
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.restoreAllMocks();
});

describe("DirectChatScreen: a question asked in plain words", () => {
  it("is in the chat of its agent as a card with no buttons, and says where to answer", async () => {
    render(<DirectChatScreen client={client().mock} initialAgentId="assistente" />);
    const card = await screen.findByTestId("direct-chat-question");
    expect(card).toHaveTextContent("Which plan do you use?");
    expect(card).toHaveAttribute("data-state", "open");
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).queryByRole("group")).toBeNull();
    expect(within(card).getByTestId("direct-chat-answer-below")).toHaveTextContent("Rispondi scrivendo qui sotto.");
  });

  it("is answered with an ordinary message of the chat, not through the answer of the structured questions", async () => {
    const { mock } = client();
    render(<DirectChatScreen client={mock} initialAgentId="assistente" />);
    await screen.findByTestId("direct-chat-question");
    await userEvent.type(screen.getByRole("textbox"), "Pro, 100 al mese");
    await userEvent.click(screen.getByRole("button", { name: /^Invia$/ }));
    expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ agentId: "assistente", text: "Pro, 100 al mese" }));
    expect(mock.answer).not.toHaveBeenCalled();
  });

  it("closes with the person's words when the team reports it answered, and no longer asks for one", async () => {
    const { mock, page } = client();
    render(<DirectChatScreen client={mock} initialAgentId="assistente" />);
    await screen.findByTestId("direct-chat-question");
    page({
      messages: [],
      questions: [{ ...PLAIN, state: "answered", answer: { choices: [], text: "Pro, 100 al mese", at: 120, origin: "user", seenAt: 121 } }],
    });
    const card = await screen.findByTestId("direct-chat-question");
    expect(card).toHaveAttribute("data-state", "answered");
    expect(within(card).getByTestId("direct-chat-answer-text")).toHaveTextContent("Pro, 100 al mese");
    expect(within(card).queryByTestId("direct-chat-answer-below")).toBeNull();
  });

  it("is also there in the read-only view, which cannot answer", async () => {
    render(<DirectChatScreen client={client().mock} initialAgentId="assistente" writeLocked />);
    expect(await screen.findByTestId("direct-chat-question")).toHaveTextContent("Which plan do you use?");
  });
});
