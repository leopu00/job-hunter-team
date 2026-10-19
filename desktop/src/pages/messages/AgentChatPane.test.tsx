import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { LeaveReadOnlyContext } from "../../lib/leave-read-only";
import { AgentChatPane } from "./AgentChatPane";
import type { DirectChatClient, DirectChatPage, DirectChatStatus } from "./direct-chat-contract";

function client(initial: DirectChatStatus = { state: "ready" }) {
  let current = initial;
  const mock: DirectChatClient = {
    subscribe: vi.fn(async () => current),
    status: vi.fn(async () => current),
    reconnect: vi.fn(async (): Promise<DirectChatStatus> => {
      current = { state: "ready" };
      return current;
    }),
    read: vi.fn(async (): Promise<DirectChatPage> => ({
      messages: [
        { id: "u1", role: "user", text: "A che punto siamo?", at: 1 },
        { id: "a1", role: "agent", text: "Tre posizioni nuove.", at: 2 },
      ],
    })),
    send: vi.fn(async ({ clientMessageId }) => ({ clientMessageId, accepted: true as const, messageId: "m-1", at: 3 })),
    close: vi.fn(),
  };
  return mock;
}

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en; path=/";
});

afterEach(() => {
  leaveExistingTeamReadOnly();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("AgentChatPane", () => {
  it("shows the history and the answers of that one agent, and no list of agents", async () => {
    const chat = client();
    render(<AgentChatPane role="mentor" client={chat} />);
    expect(await screen.findByText("Tre posizioni nuove.")).toBeTruthy();
    expect(screen.getByText("A che punto siamo?")).toBeTruthy();
    expect(chat.read).toHaveBeenCalledWith({ agentId: "mentor" });
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("writes to the agent it was mounted for", async () => {
    const chat = client();
    render(<AgentChatPane role="capitano" client={chat} />);
    const box = await screen.findByRole("textbox");
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    await userEvent.type(box, "Ciao capitano");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1));
    expect(vi.mocked(chat.send).mock.calls[0][0]).toMatchObject({ agentId: "capitano", text: "Ciao capitano" });
  });

  it("leaves the connection open when the tab goes away, other tabs share it", async () => {
    const chat = client();
    const view = render(<AgentChatPane role="assistente" client={chat} />);
    await screen.findByText("Tre posizioni nuove.");
    view.unmount();
    expect(chat.close).not.toHaveBeenCalled();
  });

  it("opens a connection that was closed, with no question to the person", async () => {
    const chat = client({ state: "disconnected" });
    render(<AgentChatPane role="capitano" client={chat} />);
    await waitFor(() => expect(chat.reconnect).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Tre posizioni nuove.")).toBeTruthy();
  });

  it("in the read-only view shows the history and the answers, and no way to send", async () => {
    act(() => enterExistingTeamReadOnly(false));
    const chat = client();
    render(<AgentChatPane role="capitano" client={chat} />);
    expect(await screen.findByText("Tre posizioni nuove.")).toBeTruthy();
    expect(screen.getByTestId("direct-chat-read-only-invite").textContent).toMatch(/Confirm and connect/);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.disabled).toBe(true);
    expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("in the read-only view the invitation has a button that leaves the view towards the connection", async () => {
    act(() => enterExistingTeamReadOnly(false));
    const leave = vi.fn();
    render(
      <LeaveReadOnlyContext.Provider value={leave}>
        <AgentChatPane role="capitano" client={client()} />
      </LeaveReadOnlyContext.Provider>,
    );
    await screen.findByText("Tre posizioni nuove.");
    await userEvent.click(screen.getByRole("button", { name: "Connect the team" }));
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("outside the read-only view there is no invitation", async () => {
    render(<AgentChatPane role="capitano" client={client()} />);
    await screen.findByText("Tre posizioni nuove.");
    expect(screen.queryByTestId("direct-chat-read-only-invite")).toBeNull();
  });

  it("says in the catalog's words why a refused send did not go, and keeps the text", async () => {
    const chat = client();
    vi.mocked(chat.send).mockRejectedValue({ code: "read_only_link" });
    render(<AgentChatPane role="capitano" client={chat} />);
    const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    await userEvent.type(box, "Scrivo lo stesso");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    const status = await screen.findByTestId("direct-chat-status");
    await waitFor(() => expect(status.textContent).toMatch(/This view is read only: the message was not sent\./));
    expect(box.value).toBe("Scrivo lo stesso");
  });
});
