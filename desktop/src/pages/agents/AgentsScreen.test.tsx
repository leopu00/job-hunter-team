import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingMessage } from "@/lib/types";
import { currentLocation, navigate } from "../../shell/router";
import AgentsScreen from "./AgentsScreen";
import { AGENTS, type AgentsData } from "./load-agents";

// The live hooks open Supabase channels: here the screen gets its rows as props.
vi.mock("@/app/hooks/usePendingMessagesLive", () => ({ usePendingMessagesLive: vi.fn() }));
vi.mock("@/app/hooks/useChatLaneLive", () => ({ useChatLaneLive: () => ({ lane: null, refresh: vi.fn() }) }));
vi.mock("@/app/hooks/useBoxClient", () => ({ useBoxClient: () => null }));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function message(over: Partial<PendingMessage>): PendingMessage {
  return {
    id: "m1",
    agent: "capitano",
    body: "Messaggio sintetico del capitano",
    kind: "notification",
    author: "agent",
    related_position_id: null,
    delivered_via: "web",
    delivered_at: null,
    acknowledged_at: null,
    user_reply: null,
    user_reply_at: null,
    agent_seen_reply_at: null,
    created_at: "2026-09-27T09:00:00Z",
    ...over,
  };
}

const DATA: AgentsData = {
  team: {
    isRunning: true,
    heartbeatAt: new Date().toISOString(),
    lastAction: null,
    lastActionAt: null,
    lastError: "sync:push_failed",
    lastErrorAt: "2026-09-27T09:00:00Z",
    enabled: {},
  },
  moves: Object.fromEntries(AGENTS.map((a) => [a.role, []])) as unknown as AgentsData["moves"],
  messages: [message({})],
};
DATA.moves.scout = [
  { ts: "2026-09-27T09:30:00Z", actor: "scout-1", from: null, to: "new", positionId: "uuid-7", legacyId: 7, title: "Ruolo sintetico", company: "Azienda finta" },
];

const byRole = (role: string) => AGENTS.find((a) => a.role === role)!;

describe("AgentsScreen", () => {
  it("lists every agent of the team, with a preview and the unread badge", () => {
    render(<AgentsScreen data={DATA} selected={byRole("scout")} />);
    const list = screen.getByRole("navigation", { name: "Agenti del team" });
    for (const a of AGENTS) expect(within(list).getByTestId(`agent-${a.role}`)).toHaveTextContent(a.name);
    expect(within(list).getByTestId("agent-capitano")).toHaveTextContent("Messaggio sintetico del capitano");
    expect(within(list).getByLabelText("1 non letti")).toBeInTheDocument();
    expect(within(list).getByTestId("agent-scout")).toHaveTextContent("scout-1: — → new");
    expect(within(list).getByTestId("agent-scout")).toHaveAttribute("aria-current", "page");
  });

  it("the bar says what the cloud knows, and «—» for what it does not", () => {
    render(<AgentsScreen data={DATA} selected={byRole("scout")} />);
    const bar = screen.getByRole("banner", { name: "Barra di Scout" });
    const entry = (label: string) => within(bar).getByText(label).nextElementSibling;
    expect(entry("modello")).toHaveTextContent("—");
    expect(entry("provider")).toHaveTextContent("—");
    expect(entry("abilitato")).toHaveTextContent("—");
    expect(entry("stato")).toHaveTextContent("team acceso");
    expect(bar).toHaveTextContent("Ultimo errore del team");
    expect(within(bar).getByRole("link", { name: "Pagina del ruolo" })).toHaveAttribute("href", "#/team/scout");
  });

  it("an agent without a chat shows its latest moves, linked to the position", () => {
    render(<AgentsScreen data={DATA} selected={byRole("scout")} />);
    expect(screen.getByText("Ultime mosse")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ruolo sintetico — Azienda finta" })).toHaveAttribute("href", "#/positions/uuid-7");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("a chat agent shows the conversation and marks its unread as read", () => {
    render(<AgentsScreen data={DATA} selected={byRole("capitano")} />);
    const conversation = screen.getByRole("region", { name: "Conversazione con Capitano" });
    expect(within(conversation).getByText("Messaggio sintetico del capitano")).toBeInTheDocument();
    expect(within(conversation).getByRole("textbox")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/pending-messages/m1/ack", { method: "POST" });
    expect(screen.queryByLabelText("1 non letti")).toBeNull();
  });

  it("sends a turn through the web's chat route", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/pending-messages"
        ? new Response(JSON.stringify({ message: message({ id: "t1", author: "user", body: "ciao capitano" }), signalled: true }), { status: 200 })
        : new Response("{}", { status: 200 }),
    );
    const user = userEvent.setup();
    render(<AgentsScreen data={DATA} selected={byRole("capitano")} />);
    await user.type(screen.getByRole("textbox"), "ciao capitano{Enter}");
    const post = fetchMock.mock.calls.find(([url]) => url === "/api/pending-messages");
    expect(JSON.parse(post![1].body)).toEqual({ agent: "capitano", message: "ciao capitano" });
    expect(await screen.findByText("ciao capitano")).toBeInTheDocument();
  });

  it("a click on an agent opens it through the query string", async () => {
    navigate("/agents", { replace: true });
    const user = userEvent.setup();
    render(<AgentsScreen data={DATA} selected={byRole("capitano")} />);
    await user.click(screen.getByTestId("agent-mentor"));
    expect(currentLocation()).toEqual({ path: "/agents", search: "?agent=mentor" });
  });
});
