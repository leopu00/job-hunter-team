import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import { loadChatSessions } from "./chat-sessions";
import type { ChatSession } from "./chat-agents";
import type { DirectChatClient, DirectChatPage } from "./direct-chat-contract";

// The chat knows whether the agent it speaks with is up: the line on top says what the team says of it (not «team connected»),
// the box to write is off for an agent that is off, with the reason, and a line of the person's nobody answered says so.

function client(pages: Record<string, DirectChatPage["messages"]> = {}): DirectChatClient {
  return {
    subscribe: vi.fn(async () => ({ state: "ready" as const })),
    status: vi.fn(async () => ({ state: "ready" as const })),
    reconnect: vi.fn(async () => ({ state: "ready" as const })),
    read: vi.fn(async ({ agentId }): Promise<DirectChatPage> => ({ messages: pages[agentId] ?? [], cursor: "c", questions: [] })),
    send: vi.fn(async ({ clientMessageId }) => ({ clientMessageId, accepted: true as const, messageId: "u9", at: 9 })),
    answer: vi.fn(),
    close: vi.fn(),
  };
}

const live = (state: string): ChatSession["state"] => ({ state } as ChatSession["state"]);
// the team has the Assistant working and the Captain free; the Scout is not in the list (no session)
const sessions = (): Promise<ChatSession[]> =>
  Promise.resolve([
    { session: "CAPITANO", up: true, state: live("idle") },
    { session: "ASSISTENTE", up: true, state: live("lavora") },
    { session: "MENTOR", up: false, state: live("spento") },
  ]);

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.restoreAllMocks();
});

describe("DirectChatScreen: the state of the agent", () => {
  it("says what the team says of the agent on top, and keeps the box to write open for a live one", async () => {
    render(<DirectChatScreen client={client()} initialAgentId="assistente" loadSessions={sessions} />);
    const status = await screen.findByTestId("direct-chat-status");
    await waitFor(() => expect(status).toHaveTextContent("Assistente · ▶ lavora"));
    expect(status).not.toHaveTextContent("Squadra collegata");
    expect(screen.getByRole("textbox", { name: "Scrivi a Assistente" })).toBeEnabled();
  });

  it("is off for an agent that is off or that has no session at all: the chat is read, the box to write says why and sends nothing", async () => {
    const mock = client({ scout: [{ id: "a1", role: "agent", text: "Ultimo messaggio dello Scout.", at: Math.floor(Date.now() / 1000) - 30 }] });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} initialAgentId="scout" loadSessions={sessions} />);
    expect(await screen.findByText("Ultimo messaggio dello Scout.")).toBeInTheDocument();
    const status = screen.getByTestId("direct-chat-status");
    await waitFor(() => expect(status).toHaveTextContent("Scout · ⏻ spento"));
    expect(status).not.toHaveTextContent("Squadra collegata");
    const box = screen.getByRole("textbox", { name: "Scrivi a Scout" });
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("placeholder", "Scout è spento. Puoi leggere la chat; per scrivergli, avvialo.");
    // the same reason as a line of text, so a narrow window does not cut it in the one-line box
    expect(screen.getByTestId("direct-chat-agent-off")).toHaveTextContent("Scout è spento. Puoi leggere la chat; per scrivergli, avvialo.");
    expect(screen.getByRole("button", { name: "Invia" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Invia" }));
    expect(mock.send).not.toHaveBeenCalled();
    // an agent the team lists as off is the same
    await user.click(within(screen.getByRole("navigation", { name: "Chat agenti" })).getByRole("button", { name: /^Mentor/ }));
    await waitFor(() => expect(screen.getByTestId("direct-chat-status")).toHaveTextContent("Mentor · ⏻ spento"));
    expect(screen.getByRole("textbox", { name: "Scrivi a Mentor" })).toBeDisabled();
    // and a live one is writable again
    await user.click(within(screen.getByRole("navigation", { name: "Chat agenti" })).getByRole("button", { name: /^Capitano/ }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Scrivi a Capitano" })).toBeEnabled());
  });

  it("sends nothing to an agent that is off by any way: text typed before, a suggested reply", async () => {
    const now = Math.floor(Date.now() / 1000);
    const mock = client({ scout: [{ id: "a1", role: "agent", text: "Procedo?", at: now - 60, suggestions: ["Sì, vai", "Aspetta"] }] });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} initialAgentId="capitano" loadSessions={sessions} />);
    const box = await screen.findByRole("textbox", { name: "Scrivi a Capitano" });
    await user.type(box, "Un testo scritto prima");
    expect(screen.getByRole("button", { name: "Invia" })).toBeEnabled();
    // the person goes to the agent that is off with the text still in the box: nothing can send it
    await user.click(within(screen.getByRole("navigation", { name: "Chat agenti" })).getByRole("button", { name: /^Scout/ }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Scrivi a Scout" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Invia" })).toBeDisabled();
    // a reply the agent suggested is shown but cannot be taken
    const suggestions = await screen.findAllByTestId("direct-chat-suggestion");
    for (const suggestion of suggestions) expect(suggestion).toBeDisabled();
    await user.click(suggestions[0]);
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("does not say an agent is off while the sessions are not known: the old line and the open box", async () => {
    render(<DirectChatScreen client={client()} initialAgentId="scout" />);
    const status = await screen.findByTestId("direct-chat-status");
    await waitFor(() => expect(status).toHaveTextContent("Squadra collegata"));
    expect(screen.getByRole("textbox", { name: "Scrivi a Scout" })).toBeEnabled();
  });

  it("says «nessuna risposta» under a line of the person's that nobody answered after ten minutes, or at once for an agent that is off", async () => {
    const now = Math.floor(Date.now() / 1000);
    const pages = {
      capitano: [
        { id: "u1", role: "user" as const, text: "Vecchia domanda senza risposta", at: now - 3600 },
        { id: "u2", role: "user" as const, text: "Domanda appena fatta", at: now - 60 },
      ],
      assistente: [
        { id: "u3", role: "user" as const, text: "Domanda con risposta", at: now - 3600 },
        { id: "a3", role: "agent" as const, text: "Ecco la risposta", at: now - 3000 },
      ],
      scout: [{ id: "u4", role: "user" as const, text: "Scrivo a uno spento", at: now - 60 }],
    };
    const user = userEvent.setup();
    render(<DirectChatScreen client={client(pages)} initialAgentId="capitano" loadSessions={sessions} />);
    const old = (await screen.findByText("Vecchia domanda senza risposta")).closest("article")!;
    expect(within(old).getByTestId("direct-chat-unanswered")).toHaveTextContent("nessuna risposta");
    expect(within(screen.getByText("Domanda appena fatta").closest("article")!).queryByTestId("direct-chat-unanswered")).toBeNull();
    await user.click(within(screen.getByRole("navigation", { name: "Chat agenti" })).getByRole("button", { name: /^Assistente/ }));
    expect(await screen.findByText("Ecco la risposta")).toBeInTheDocument();
    expect(screen.queryByTestId("direct-chat-unanswered")).toBeNull();
    await user.click(within(screen.getByRole("navigation", { name: "Chat agenti" })).getByRole("button", { name: /^Scout/ }));
    const recent = (await screen.findByText("Scrivo a uno spento")).closest("article")!;
    expect(within(recent).getByTestId("direct-chat-unanswered")).toBeInTheDocument();
  });

  it("tells a failed send with the reason of the real error code and keeps it through the reads until the person writes again", async () => {
    const mock = client();
    mock.send = vi.fn(async () => {
      throw { code: "send_failed" };
    });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} initialAgentId="capitano" loadSessions={sessions} />);
    const box = await screen.findByRole("textbox", { name: "Scrivi a Capitano" });
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, "Mi mandi il riepilogo?");
    await user.click(screen.getByRole("button", { name: "Invia" }));
    const status = await screen.findByTestId("direct-chat-status");
    await waitFor(() => expect(status).toHaveTextContent("Il messaggio non è stato consegnato. Rimanda il messaggio."));
    expect(status).not.toHaveTextContent("L’agente non è acceso");
    expect(box).toHaveValue("Mi mandi il riepilogo?");
    // two periodic reads go through: the reason stays
    const reads = vi.mocked(mock.read).mock.calls.length;
    await waitFor(() => expect(vi.mocked(mock.read).mock.calls.length).toBeGreaterThanOrEqual(reads + 2), { timeout: 6000 });
    expect(status).toHaveTextContent("Il messaggio non è stato consegnato");
    // writing again takes it away
    await user.type(box, "!");
    await waitFor(() => expect(status).not.toHaveTextContent("Il messaggio non è stato consegnato"));
  }, 15000);

  it("tells «not running» for an agent whose session went down between the read and the send", async () => {
    const mock = client();
    mock.send = vi.fn(async () => {
      throw { code: "agent_not_running" };
    });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} initialAgentId="capitano" loadSessions={sessions} />);
    const box = await screen.findByRole("textbox", { name: "Scrivi a Capitano" });
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, "Ciao");
    await user.click(screen.getByRole("button", { name: "Invia" }));
    await waitFor(() => expect(screen.getByTestId("direct-chat-status")).toHaveTextContent("L’agente non è acceso. Accendi la squadra, poi rimanda il messaggio."));
  });

  it("puts the selector of the agent under a div that is hidden on a wide window (a `label` has a global display rule that wins over the utility)", async () => {
    render(<DirectChatScreen client={client()} initialAgentId="capitano" loadSessions={sessions} />);
    const picker = await screen.findByTestId("direct-chat-agent-picker");
    expect(picker.tagName).toBe("DIV");
    expect((picker.getAttribute("class") ?? "").split(/\s+/)).toContain("md:hidden");
    const label = picker.querySelector("label")!;
    expect((label.getAttribute("class") ?? "").split(/\s+/)).not.toContain("md:hidden");
  });
});

describe("loadChatSessions", () => {
  it("brings the state of each agent with its session", async () => {
    const read = vi.fn(async () => ({
      ok: true as const,
      at: 1,
      value: { agents: [{ name: "SCOUT-1", state: { state: "spento" } }, { name: "CAPITANO", state: { state: "idle" } }], roles: [], statesKnown: true, target: "t", where: "local" as const, label: null, ownVps: null },
    }));
    const got = await loadChatSessions(read as never);
    expect(got).toEqual([
      { session: "SCOUT-1", up: false, state: { state: "spento" } },
      { session: "CAPITANO", up: true, state: { state: "idle" } },
    ]);
  });
});
