import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { ChatSession } from "./chat-agents";
import type { DirectChatClient } from "./direct-chat-contract";

afterEach(cleanup);

function client(): DirectChatClient {
  return {
    subscribe: vi.fn(async () => ({ state: "ready" as const })),
    status: vi.fn(async () => ({ state: "ready" as const })),
    reconnect: vi.fn(async () => ({ state: "ready" as const })),
    read: vi.fn(async () => ({ messages: [], cursor: "c", questions: [] })),
    send: vi.fn(),
    answer: vi.fn(),
    close: vi.fn(),
  };
}
const sessions = async (): Promise<ChatSession[]> => [
  { session: "CAPITANO", up: true, state: { state: "idle" } as ChatSession["state"] },
  { session: "SCOUT-1", up: false, state: { state: "spento" } as ChatSession["state"] },
];

describe("DirectChatScreen with the tabs of the Team page", () => {
  it("shows Chat first, the other tabs after it, and the tab of the chosen agent in place of the chat", async () => {
    const render_ = vi.fn((agent: { session: string }, tab: string) => <p data-testid="tab-body">{`${tab}:${agent.session}`}</p>);
    const user = userEvent.setup();
    render(
      <DirectChatScreen
        client={client()}
        initialAgentId="capitano"
        loadSessions={sessions}
        agentTabs={{ tabs: [{ id: "info", label: "Info" }, { id: "terminal", label: "Terminale" }], render: render_ }}
      />,
    );
    const tabs = await screen.findByTestId("team-tabs");
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Chat", "Info", "Terminale"]);
    expect(screen.getByTestId("team-tab-chat")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("direct-chat-composer")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-body")).toBeNull();
    await user.click(screen.getByTestId("team-tab-info"));
    expect(screen.getByTestId("tab-body")).toHaveTextContent("info:CAPITANO");
    // the chat parts are not on screen under another tab
    expect(screen.queryByTestId("direct-chat-composer")).toBeNull();
    // the tab stays when the person goes to another agent, and the section follows the agent
    await user.click(within(screen.getByRole("navigation", { name: "Chat agenti" })).getByRole("button", { name: /^Scout/ }));
    await waitFor(() => expect(screen.getByTestId("tab-body")).toHaveTextContent("info:SCOUT-1"));
    await user.click(screen.getByTestId("team-tab-chat"));
    expect(screen.getByTestId("direct-chat-composer")).toBeInTheDocument();
  });

  it("opens on the tab the address asks for, and has no tabs without them", async () => {
    const { unmount } = render(
      <DirectChatScreen client={client()} initialAgentId="capitano" loadSessions={sessions} agentTabs={{ tabs: [{ id: "terminal", label: "Terminale" }], initial: "terminal", render: () => <p data-testid="tab-body">t</p> }} />,
    );
    expect(await screen.findByTestId("tab-body")).toBeInTheDocument();
    expect(screen.getByTestId("team-tab-terminal")).toHaveAttribute("aria-selected", "true");
    unmount();
    render(<DirectChatScreen client={client()} initialAgentId="capitano" loadSessions={sessions} />);
    await screen.findByTestId("direct-chat-composer");
    expect(screen.queryByTestId("team-tabs")).toBeNull();
  });
});
