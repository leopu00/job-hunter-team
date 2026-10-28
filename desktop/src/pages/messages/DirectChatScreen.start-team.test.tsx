import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient, DirectChatEvent, DirectChatStatus } from "./direct-chat-contract";
import { resumeOnboardingTeamStart } from "../../lib/onboarding-runtime";
import { TeamOffContext } from "../../lib/team-off";
import { TEAM_OFF_TEXT } from "../../shell/team-off.i18n";

vi.mock("../../lib/onboarding-runtime", () => ({ resumeOnboardingTeamStart: vi.fn(async () => ({})) }));

function client(initial: DirectChatStatus) {
  const mock: DirectChatClient = {
    subscribe: vi.fn(async () => initial),
    status: vi.fn(async () => initial),
    reconnect: vi.fn(async (): Promise<DirectChatStatus> => ({ state: "ready" })),
    read: vi.fn(async () => ({ messages: [], cursor: null })),
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as DirectChatClient;
  return mock;
}

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.mocked(resumeOnboardingTeamStart).mockClear();
});

describe("the chat's bar when the team of this computer is stopped", () => {
  it("offers «Start the team» next to «Retry»; starting it connects the chat again", async () => {
    document.cookie = "NEXT_LOCALE=en; path=/";
    const mock = client({ state: "error", code: "local_team_not_running" });
    render(<DirectChatScreen client={mock} />);
    const bar = await screen.findByTestId("direct-chat-status");
    await waitFor(() => expect(bar).toHaveTextContent("The team on this computer is not running."));
    const start = await screen.findByTestId("start-team");
    expect(start).toHaveTextContent(TEAM_OFF_TEXT.en.start);
    fireEvent.click(start);
    await waitFor(() => expect(resumeOnboardingTeamStart).toHaveBeenCalledOnce());
    await waitFor(() => expect(mock.reconnect).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("start-team")).toBeNull());
  });

  it("is not there for a failure the start would not mend", async () => {
    render(<DirectChatScreen client={client({ state: "error", code: "ssh_rate_limited" })} />);
    await screen.findByTestId("direct-chat-status");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("start-team")).toBeNull();
  });

  it("is not doubled in the app opened without the team, which has it in the banner", async () => {
    render(
      <TeamOffContext.Provider value={{ teamOff: true, wakeRuntime: async () => undefined, startTeam: () => undefined }}>
        <DirectChatScreen client={client({ state: "error", code: "local_team_not_running" })} />
      </TeamOffContext.Provider>,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("start-team")).toBeNull();
  });

  it("keeps the history on screen when the team stops under the open chat", async () => {
    let onEvent: ((event: DirectChatEvent) => void) | undefined;
    const mock = client({ state: "ready" });
    vi.mocked(mock.read).mockResolvedValue({ messages: [{ id: "h1", role: "agent", text: "Messaggio già letto", at: 1 }], cursor: "c" });
    vi.mocked(mock.subscribe).mockImplementation(async ({ onEvent: next }) => {
      onEvent = next;
      return { state: "ready" };
    });
    render(<DirectChatScreen client={mock} />);
    expect(await screen.findByText("Messaggio già letto")).toBeInTheDocument();
    act(() => onEvent?.({ kind: "status", status: { state: "error", code: "local_team_not_running" } }));
    expect(await screen.findByTestId("start-team")).toBeInTheDocument();
    expect(screen.getByText("Messaggio già letto")).toBeInTheDocument();
    expect(screen.queryByText(/Nessun messaggio/)).toBeNull();
  });
});
