import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import type { ExistingTeamBridge } from "../../lib/existing-team";
import { LeaveReadOnlyContext } from "../../lib/leave-read-only";
import { ReconfirmExistingTeamContext, type ReconfirmExistingTeam } from "../../lib/reconfirm-existing-team";
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

  describe("«Collega il team» in the read-only view", () => {
    const HOST = { kind: "vps" as const, address: "203.0.113.7", user: "jht", port: 2222, keyPath: "/synthetic/key" };
    const SUMMARY = { teamId: "team-opaque-0007", host: HOST, fingerprint: "SHA256:synthetic-pinned" };
    const RESULT = {
      runtimeInstalled: true, containerRunning: true, providerConfigured: true, providerAuthenticated: true,
      assistantRunning: true, captainRunning: true, profileReady: true, assistantWelcomed: false, directChatReady: false,
    };

    function bridge(overrides: Partial<ExistingTeamBridge> = {}): ExistingTeamBridge {
      return {
        probe: vi.fn(), confirm: vi.fn(), connectReadOnly: vi.fn(), reopen: vi.fn(), discover: vi.fn(), register: vi.fn(),
        reconfirmSummary: vi.fn().mockResolvedValue(SUMMARY),
        connect: vi.fn().mockResolvedValue(RESULT),
        ...overrides,
      };
    }

    function context(): ReconfirmExistingTeam {
      return { accountLabel: "Reader Person", onConnected: vi.fn(async () => undefined), onSetup: vi.fn() };
    }

    function mount(reconfirm: ReconfirmExistingTeam, teamBridge: ExistingTeamBridge, leave = vi.fn()) {
      act(() => enterExistingTeamReadOnly(false));
      render(
        <LeaveReadOnlyContext.Provider value={leave}>
          <ReconfirmExistingTeamContext.Provider value={reconfirm}>
            <AgentChatPane role="capitano" client={client()} reconfirmBridge={teamBridge} />
          </ReconfirmExistingTeamContext.Provider>
        </LeaveReadOnlyContext.Provider>,
      );
    }

    it("opens only on the click, in the chat, with what the setup shows and nothing read from the server", async () => {
      const reconfirm = context();
      const teamBridge = bridge();
      const leave = vi.fn();
      mount(reconfirm, teamBridge, leave);
      await screen.findByText("Tre posizioni nuove.");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(teamBridge.reconfirmSummary).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Connect the team" }));
      const dialog = await screen.findByRole("dialog");
      expect(await screen.findByText("team-opaque-0007")).toBeTruthy();
      expect(dialog.textContent).toContain("203.0.113.7:2222");
      expect(dialog.textContent).toContain("SHA256:synthetic-pinned");
      expect(dialog.textContent).toContain("Reader Person");
      expect(leave).not.toHaveBeenCalled();
      expect(teamBridge.probe).not.toHaveBeenCalled();
      expect(teamBridge.connect).not.toHaveBeenCalled();
    });

    it("«Confirm and connect» asks the native side for the full connection of the saved host and team", async () => {
      const reconfirm = context();
      const teamBridge = bridge();
      mount(reconfirm, teamBridge);
      await userEvent.click(await screen.findByRole("button", { name: "Connect the team" }));
      await userEvent.click(await screen.findByRole("button", { name: "Confirm and connect" }));
      await waitFor(() => expect(reconfirm.onConnected).toHaveBeenCalledWith(RESULT));
      expect(vi.mocked(teamBridge.connect).mock.calls[0][0]).toEqual({ teamId: "team-opaque-0007", host: HOST, reconfirm: true });
    });

    it("what no longer matches goes back to the setup, before and after the confirmation", async () => {
      const before = context();
      mount(before, bridge({ reconfirmSummary: vi.fn().mockRejectedValue({ code: "existing_team_reconfirm_setup" }) }));
      await userEvent.click(await screen.findByRole("button", { name: "Connect the team" }));
      await waitFor(() => expect(before.onSetup).toHaveBeenCalledTimes(1));
    });

    it("a confirmation that fails stays read-only and says why in the catalog's words", async () => {
      const reconfirm = context();
      mount(reconfirm, bridge({ connect: vi.fn().mockRejectedValue({ code: "host_key_changed" }) }));
      await userEvent.click(await screen.findByRole("button", { name: "Connect the team" }));
      await userEvent.click(await screen.findByRole("button", { name: "Confirm and connect" }));
      expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeTruthy();
      expect(reconfirm.onConnected).not.toHaveBeenCalled();
      expect(reconfirm.onSetup).not.toHaveBeenCalled();
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    });
  });
});
