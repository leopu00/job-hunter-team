import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient, DirectChatPage, DirectChatReceipt } from "./direct-chat-contract";

// The chat speaks with an instance, not with a role: Analista 1 and Analista 2 are two conversations.

function client(pages: Record<string, DirectChatPage["messages"]> = {}, receipt: Partial<DirectChatReceipt> = {}) {
  const mock: DirectChatClient = {
    subscribe: vi.fn(async () => ({ state: "ready" as const })),
    status: vi.fn(async () => ({ state: "ready" as const })),
    reconnect: vi.fn(async () => ({ state: "ready" as const })),
    read: vi.fn(async ({ agentId }): Promise<DirectChatPage> => ({ messages: pages[agentId] ?? [], cursor: "c", questions: [] })),
    send: vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({ clientMessageId, accepted: true, messageId: "u9", at: 9, ...receipt })),
    answer: vi.fn(),
    close: vi.fn(),
  };
  return mock;
}

const sessions = (...names: string[]) => vi.fn(async () => names.map((session) => ({ session, up: true })));

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.restoreAllMocks();
});

describe("DirectChatScreen: one conversation per instance", () => {
  it("lists the instances that are up and talks to the one chosen, by its own id", async () => {
    const mock = client({ "analista-2": [{ id: "a1", role: "agent", text: "Sono la seconda.", at: 1 }] });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} initialAgentId="capitano" loadSessions={sessions("CAPITANO", "ANALISTA-1", "ANALISTA-2")} />);
    const nav = await screen.findByRole("navigation", { name: "Chat agenti" });
    await waitFor(() => expect(within(nav).getByRole("button", { name: "Analista 2" })).toBeInTheDocument());
    expect(within(nav).getByRole("button", { name: "Analista 1" })).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "Analista 2" }));
    expect(await screen.findByText("Sono la seconda.")).toBeInTheDocument();
    expect(mock.read).toHaveBeenCalledWith({ agentId: "analista-2" });
    expect(screen.getByRole("region", { name: "Conversazione con Analista 2" })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Scrivi a Analista 2" }), "Come va?{Enter}");
    await waitFor(() => expect(mock.send).toHaveBeenCalledWith({ agentId: "analista-2", text: "Come va?", clientMessageId: expect.any(String) }));
  });

  it("names the agent in the header and leads from the name to its own page", async () => {
    render(<DirectChatScreen client={client()} initialAgentId="analista-2" loadSessions={sessions("ANALISTA-1", "ANALISTA-2")} />);
    const link = await screen.findByTestId("direct-chat-agent-page");
    expect(link).toHaveTextContent("Analista 2");
    expect(link).toHaveAttribute("href", "#/agents/ANALISTA-2");
  });

  it("keeps the open conversation when its session went down, and shows the others as the team has them", async () => {
    render(<DirectChatScreen client={client()} initialAgentId="scrittore-3" loadSessions={sessions("CAPITANO")} />);
    const nav = await screen.findByRole("navigation", { name: "Chat agenti" });
    expect(within(nav).getByRole("button", { name: "Scrittore 3" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Scout" })).toBeInTheDocument();
    expect(screen.getByTestId("direct-chat-led-scrittore-3")).toBeInTheDocument();
  });

  it("is the eight roles when nothing says which sessions the team has", async () => {
    render(<DirectChatScreen client={client()} initialAgentId="capitano" />);
    const nav = await screen.findByRole("navigation", { name: "Chat agenti" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Capitano", "Assistente", "Mentor", "Scout", "Analista", "Scorer", "Scrittore", "Critico"]);
  });

  it("marks a message answered once the agent wrote after it, and read once its CLI took it", async () => {
    const mock = client({ capitano: [
      { id: "u1", role: "user", text: "Una domanda", at: 1 },
      { id: "a1", role: "agent", text: "Una risposta", at: 2 },
      { id: "u2", role: "user", text: "Un'altra", at: 3 },
    ] });
    render(<DirectChatScreen client={mock} initialAgentId="capitano" />);
    await screen.findByText("Una risposta");
    const answered = await screen.findAllByTestId("direct-chat-answered");
    expect(answered).toHaveLength(1);
    expect(within(screen.getByText("Una domanda").closest("article")!).getByTestId("direct-chat-answered")).toBeInTheDocument();
    expect(within(screen.getByText("Un'altra").closest("article")!).queryByTestId("direct-chat-answered")).toBeNull();

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Scrivi a Capitano" }), "Ultima{Enter}");
    const mine = await screen.findByText("Ultima");
    expect(await within(mine.closest("article")!).findByTestId("direct-chat-sent")).toBeInTheDocument();
  });
});
