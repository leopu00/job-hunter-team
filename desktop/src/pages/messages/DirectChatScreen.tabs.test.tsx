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

  const withSquad = (render_: (tab: string) => React.ReactNode = (tab) => <p data-testid="squad-body">{tab}</p>) => ({
    tabs: [{ id: "info", label: "Info" }, { id: "terminal", label: "Terminale" }],
    render: (agent: { session: string }, tab: string) => <p data-testid="tab-body">{`${tab}:${agent.session}`}</p>,
    squad: {
      label: "Squadra",
      tabs: [{ id: "commands", label: "Comandi" }, { id: "lanes", label: "Corsie" }, { id: "log", label: "Registro" }],
      render: render_,
      line: (up: number, total: number) => `${up} su ${total} accesi`,
    },
  });

  it("has the whole team as the first row, with its own tabs, and leaves the agent underneath as it was", async () => {
    const user = userEvent.setup();
    render(<DirectChatScreen client={client()} initialAgentId="capitano" loadSessions={sessions} agentTabs={withSquad()} />);
    const row = await screen.findByTestId("team-squad-row");
    const nav = screen.getByRole("navigation", { name: "Chat agenti" });
    expect(within(nav).getAllByRole("button")[0]).toBe(row);
    // counted on the rows the list shows (every agent with a chat, on or off), not on the sessions the team has
    await waitFor(() => expect(row).toHaveTextContent(`1 su ${within(nav).getAllByRole("button").length - 1} accesi`));
    await user.click(row);
    expect(row).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByTestId("team-tabs")).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Comandi", "Corsie", "Registro"]);
    expect(screen.getByTestId("squad-body")).toHaveTextContent("commands");
    expect(screen.queryByTestId("direct-chat-composer")).toBeNull();
    await user.click(screen.getByTestId("team-tab-lanes"));
    expect(screen.getByTestId("squad-body")).toHaveTextContent("lanes");
    // an agent brings back its own tabs, on the chat
    await user.click(within(nav).getByRole("button", { name: /^Capitano/ }));
    expect(row).not.toHaveAttribute("aria-current");
    expect(within(screen.getByTestId("team-tabs")).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Chat", "Info", "Terminale"]);
    expect(screen.getByTestId("direct-chat-composer")).toBeInTheDocument();
  });

  it("opens on the team's tab the address asks for", async () => {
    render(<DirectChatScreen client={client()} initialAgentId="capitano" loadSessions={sessions} agentTabs={{ ...withSquad(), squad: { ...withSquad().squad, initial: "log" } }} />);
    expect(await screen.findByTestId("squad-body")).toBeInTheDocument();
    expect(screen.getByTestId("team-tab-log")).toHaveAttribute("aria-selected", "true");
  });

  it("lists the sessions that have no chat as rows of their own, with Info and Terminal only, so no agent of the old Agents page is lost", async () => {
    const user = userEvent.setup();
    const more = async (): Promise<ChatSession[]> => [
      ...(await sessions()),
      { session: "DOTTORE", up: true, state: { state: "idle" } as ChatSession["state"] },
      { session: "CRITICO-S2", up: false, state: { state: "spento" } as ChatSession["state"] },
    ];
    render(<DirectChatScreen client={client()} initialAgentId="capitano" loadSessions={more} agentTabs={withSquad()} />);
    const row = await screen.findByTestId("team-other-DOTTORE");
    expect(screen.getByTestId("team-other-CRITICO-S2")).toBeInTheDocument();
    await user.click(row);
    expect(row).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByTestId("team-tabs")).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Info", "Terminale"]);
    expect(screen.getByTestId("tab-body")).toHaveTextContent("info:DOTTORE");
    await user.click(screen.getByTestId("team-tab-terminal"));
    expect(screen.getByTestId("tab-body")).toHaveTextContent("terminal:DOTTORE");
    expect(screen.queryByTestId("direct-chat-composer")).toBeNull();
  });

  it("counts the team on the rows of its own list: the agents with a chat, on or off, and the sessions without one", async () => {
    const more = async (): Promise<ChatSession[]> => [
      ...(await sessions()),
      { session: "DOTTORE", up: true, state: { state: "idle" } as ChatSession["state"] },
      { session: "CRITICO-S2", up: false, state: { state: "spento" } as ChatSession["state"] },
    ];
    render(<DirectChatScreen client={client()} initialAgentId="capitano" loadSessions={more} agentTabs={withSquad()} />);
    await screen.findByTestId("team-other-DOTTORE");
    const nav = screen.getByTestId("team-squad-row").parentElement!;
    const rows = within(nav).getAllByRole("button");
    const rowsOfAgents = rows.filter((row) => row !== screen.getByTestId("team-squad-row"));
    // the list shows every chat agent (on or off) and the two sessions without a chat; the line counts those, and only those
    const on = rowsOfAgents.filter((row) => row.querySelector('[data-testid^="direct-chat-led-"]')?.getAttribute("style")?.includes("var(--color-green)") || row.getAttribute("data-testid") === "team-other-DOTTORE").length;
    expect(screen.getByTestId("team-squad-row")).toHaveTextContent(`${on} su ${rowsOfAgents.length} accesi`);
  });

  it("marks the chosen row of a paused agent with an amber bar, never a green one", async () => {
    const paused = async (): Promise<ChatSession[]> => [
      { session: "CAPITANO", up: true, state: { state: "idle" } as ChatSession["state"], paused: true },
      { session: "SCOUT-1", up: true, state: { state: "lavora" } as ChatSession["state"] },
    ];
    render(<DirectChatScreen client={client()} initialAgentId="capitano" loadSessions={paused} agentTabs={withSquad()} />);
    const row = (await screen.findByTestId("direct-chat-paused-capitano")).closest("button")!;
    await waitFor(() => expect(row.getAttribute("style")).toContain("var(--color-yellow)"));
    expect(row.getAttribute("style")).not.toContain("var(--color-green)");
    expect(screen.getByTestId("direct-chat-led-scout").closest("button")!.getAttribute("style") ?? "").not.toContain("var(--color-yellow)");
  });

  it("shows an agent the person paused with an amber pause sign in the place of the dot, never green", async () => {
    const paused = async (): Promise<ChatSession[]> => [
      { session: "CAPITANO", up: true, state: { state: "idle" } as ChatSession["state"], paused: true },
      { session: "SCOUT-1", up: true, state: { state: "lavora" } as ChatSession["state"] },
    ];
    render(<DirectChatScreen client={client()} initialAgentId="scout" loadSessions={paused} />);
    expect(await screen.findByTestId("direct-chat-paused-capitano")).toHaveTextContent("⏸");
    expect(screen.queryByTestId("direct-chat-led-capitano")).toBeNull();
    // the others keep their dot
    expect(screen.getByTestId("direct-chat-led-scout")).toBeInTheDocument();
  });
});
