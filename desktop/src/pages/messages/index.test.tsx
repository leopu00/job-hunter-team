import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import type { ExistingTeamBridge } from "../../lib/existing-team";
import { LeaveReadOnlyContext } from "../../lib/leave-read-only";
import { ReconfirmExistingTeamContext, type ReconfirmExistingTeam } from "../../lib/reconfirm-existing-team";

vi.mock("../../lib/direct-chat", () => ({
  closeDirectChat: vi.fn(),
  directChatStatus: vi.fn(),
  readDirectChat: vi.fn(),
  reconnectDirectChat: vi.fn(),
  sendDirectChat: vi.fn(),
  subscribeDirectChat: vi.fn(),
}));

import {
  closeDirectChat,
  directChatStatus,
  readDirectChat,
  sendDirectChat,
  subscribeDirectChat,
} from "../../lib/direct-chat";
import MessagesPage from ".";

beforeEach(() => {
  vi.mocked(directChatStatus).mockResolvedValue({ state: "ready" });
  vi.mocked(subscribeDirectChat).mockResolvedValue({ state: "ready" });
  vi.mocked(readDirectChat).mockResolvedValue({
    messages: [{ id: "remote-1", role: "agent", text: "Risposta diretta", at: 1 }],
  });
  vi.mocked(closeDirectChat).mockResolvedValue();
});

describe("MessagesPage", () => {
  it("wires the desktop route to the direct VPS transport", async () => {
    const view = render(<MessagesPage params={{}} search={new URLSearchParams()} />);

    expect(await screen.findByText("Risposta diretta")).toBeInTheDocument();
    expect(directChatStatus).toHaveBeenCalledOnce();
    expect(subscribeDirectChat).toHaveBeenCalledWith(expect.any(Function));
    expect(readDirectChat).toHaveBeenCalledWith("capitano", undefined);

    view.unmount();
    await waitFor(() => expect(closeDirectChat).toHaveBeenCalledOnce());
  });

  it("opens the explicitly requested Assistant conversation on first read", async () => {
    render(<MessagesPage params={{}} search={new URLSearchParams("agent=assistente")} />);

    await waitFor(() => expect(readDirectChat).toHaveBeenCalledWith("assistente", undefined));
    expect(screen.getByRole("region", { name: "Conversazione con Assistente" })).toBeInTheDocument();
  });
});

describe("MessagesPage in the read-only view of an existing team", () => {
  beforeEach(() => {
    document.cookie = "NEXT_LOCALE=en; path=/";
  });
  afterEach(() => {
    leaveExistingTeamReadOnly();
    document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  });
  const page = (agent = "capitano", bridge?: ExistingTeamBridge) => (
    <MessagesPage params={{}} search={new URLSearchParams(`agent=${agent}`)} reconfirmBridge={bridge} />
  );

  it("shows the history and the answers, and no way to send", async () => {
    act(() => enterExistingTeamReadOnly(false));
    render(page());
    expect(await screen.findByText("Risposta diretta")).toBeTruthy();
    expect(screen.getByTestId("direct-chat-read-only-invite").textContent).toMatch(/Confirm and connect/);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(sendDirectChat).not.toHaveBeenCalled();
  });

  it("the invitation has a button that leaves the view towards the connection", async () => {
    act(() => enterExistingTeamReadOnly(false));
    const leave = vi.fn();
    render(<LeaveReadOnlyContext.Provider value={leave}>{page()}</LeaveReadOnlyContext.Provider>);
    await screen.findByText("Risposta diretta");
    await userEvent.click(screen.getByRole("button", { name: "Connect with write access" }));
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("outside the read-only view there is no invitation and the composer is open", async () => {
    render(page());
    await screen.findByText("Risposta diretta");
    expect(screen.queryByTestId("direct-chat-read-only-invite")).toBeNull();
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false));
  });

  describe("«Collega il team»", () => {
    const HOST = { kind: "vps" as const, address: "203.0.113.7", user: "jht", port: 2222, keyPath: "/synthetic/key" };
    const SUMMARY = { teamId: "team-opaque-0007", host: HOST, fingerprint: "SHA256:synthetic-pinned" };
    const RESULT = {
      runtimeInstalled: true, containerRunning: true, providerConfigured: true, providerAuthenticated: true,
      assistantRunning: true, captainRunning: true, profileReady: true, assistantWelcomed: false, directChatReady: false,
    };
    const bridge = (overrides: Partial<ExistingTeamBridge> = {}): ExistingTeamBridge => ({
      probe: vi.fn(), confirm: vi.fn(), connectReadOnly: vi.fn(), reopen: vi.fn(), discover: vi.fn(), register: vi.fn(),
      reconfirmSummary: vi.fn().mockResolvedValue(SUMMARY),
      connect: vi.fn().mockResolvedValue(RESULT),
      ...overrides,
    });
    const context = (): ReconfirmExistingTeam => ({ accountLabel: "Reader Person", onConnected: vi.fn(async () => undefined), onSetup: vi.fn() });
    const mount = (reconfirm: ReconfirmExistingTeam, teamBridge: ExistingTeamBridge) => {
      act(() => enterExistingTeamReadOnly(false));
      render(
        <LeaveReadOnlyContext.Provider value={vi.fn()}>
          <ReconfirmExistingTeamContext.Provider value={reconfirm}>{page("capitano", teamBridge)}</ReconfirmExistingTeamContext.Provider>
        </LeaveReadOnlyContext.Provider>,
      );
    };

    it("opens only on the click, with what the setup shows and nothing read from the server", async () => {
      const teamBridge = bridge();
      mount(context(), teamBridge);
      await screen.findByText("Risposta diretta");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(teamBridge.reconfirmSummary).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Connect with write access" }));
      const dialog = await screen.findByRole("dialog");
      expect(await screen.findByText("team-opaque-0007")).toBeTruthy();
      expect(dialog.textContent).toContain("203.0.113.7:2222");
      expect(teamBridge.connect).not.toHaveBeenCalled();
    });

    it("«Confirm and connect» asks the native side for the full connection of the saved host and team", async () => {
      const reconfirm = context();
      const teamBridge = bridge();
      mount(reconfirm, teamBridge);
      await userEvent.click(await screen.findByRole("button", { name: "Connect with write access" }));
      await userEvent.click(await screen.findByRole("button", { name: "Confirm and connect" }));
      await waitFor(() => expect(reconfirm.onConnected).toHaveBeenCalledWith(RESULT));
      expect(vi.mocked(teamBridge.connect).mock.calls[0][0]).toEqual({ teamId: "team-opaque-0007", host: HOST, reconfirm: true });
    });

    it("a confirmation that fails stays read-only and says why", async () => {
      const reconfirm = context();
      mount(reconfirm, bridge({ connect: vi.fn().mockRejectedValue({ code: "host_key_changed" }) }));
      await userEvent.click(await screen.findByRole("button", { name: "Connect with write access" }));
      await userEvent.click(await screen.findByRole("button", { name: "Confirm and connect" }));
      expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeTruthy();
      expect(reconfirm.onConnected).not.toHaveBeenCalled();
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    });
  });
});
