import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { READ_ONLY_ROUTES, ROUTES } from "../../shell/routes";
import { forgetChatMessages, rememberChatPage } from "../../lib/chat-last-message";
import AgentPage from "./AgentPage";
import { AGENT_PAGE_TEXT } from "./AgentPage.i18n";
import { agentTitle, chatIdOfSession, SESSION_NAME } from "./agent-names";

// The page of one agent (/agents/:name), against a stand-in native side (agent_control). Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true), Channel: class { onmessage: unknown = null } }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));

const COMMAND = "agent_control";
const NOW_S = Math.floor(Date.now() / 1000);
const agent = (name: string, role: string, instance: string | null, state: string, extra: Record<string, unknown> = {}) => ({
  name, role, instance, up: true, created: NOW_S - 3600, activity: NOW_S - 600, state, reason: null, since: null, until: null, ...extra,
});
const AGENTS = [
  agent("CAPITANO", "capitano", null, "lavora"),
  agent("SCOUT-1", "scout", "1", "idle"),
  agent("SCOUT-2", "scout", "2", "lavora"),
  agent("DOTTORE", "dottore", null, "idle"),
];
const ROLES = ["capitano", "scout", "dottore"].map((role) => ({ role, multi: role === "scout" }));
const ops = () => native.invoke.mock.calls.filter(([c]) => c === COMMAND).map(([, a]) => (a as { request: Record<string, unknown> }).request);

let restoreBridge: () => void;
let historyReply: Record<string, unknown> | null = null;
beforeEach(() => {
  historyReply = null;
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
    if (command !== COMMAND) return { ok: false, error: "not_in_test" };
    const { op } = args.request;
    if (op === "list") return { ok: true, data: { agents: AGENTS, roles: ROLES, states: true, target: "T1", where: "local", label: null } };
    if (op === "team") return { ok: true, data: { halted: false, standby: { state: "off", until: null, weeklyReset: false }, held: [] } };
    if (op === "screen") return { ok: true, data: { name: args.request.session, up: true, text: "<b>not html</b>\nlavoro in corso", refreshMs: 2000 } };
    if (op === "history") return historyReply ?? { ok: false, error: "agent_control_unsupported" };
    return { ok: false, error: "not_in_test" };
  });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network"); }));
  restoreBridge = installApiBridge(shellApi(notInDesktop));
});
afterEach(() => {
  forgetChatMessages();
  cleanup();
  restoreBridge();
  vi.unstubAllGlobals();
});

const show = (name: string) => render(<AgentPage params={{ name }} search={new URLSearchParams()} />);

describe("the page of one agent", () => {
  it("is a full-bleed page of the full shell and of the read-only view", () => {
    for (const routes of [ROUTES, READ_ONLY_ROUTES]) {
      const route = routes.find((r) => r.path === "/agents/:name");
      expect(route?.page).toBe(AgentPage);
      expect(route?.fullBleed).toBe(true);
    }
  });

  it("names the instance, says its state and shows its terminal as plain text", async () => {
    show("scout-2");
    expect(await screen.findByTestId("agent-page-title")).toHaveTextContent("Scout 2");
    expect(screen.getByTestId("agent-page-state")).toBeInTheDocument();
    const terminal = await screen.findByTestId("panel-terminal-SCOUT-2");
    expect(terminal).toHaveTextContent("<b>not html</b>");
    expect(terminal.querySelector("b")).toBeNull();
    expect(terminal).toHaveAttribute("role", "log");
    // watched, not written: the page says so and offers no field and no key
    expect(screen.getByTestId("agent-page-watch-only")).toHaveTextContent("non il terminale");
    expect(document.querySelector("textarea, input")).toBeNull();
  });

  it("shows the sessions of THIS agent as bars of the last day, from the start of each to its end, and no other agent's", async () => {
    historyReply = {
      ok: true,
      data: {
        since: null,
        lanes: null,
        items: [
          { name: "SCOUT-2", failed: [], sessions: [{ start: NOW_S - 3600, end: null, reason: "running" }, { start: NOW_S - 20000, end: NOW_S - 9000, reason: "restarted_by_user" }] },
          { name: "SCOUT-1", failed: [], sessions: [{ start: NOW_S - 7200, end: null, reason: "running" }] },
        ],
      },
    };
    show("SCOUT-2");
    const lanes = await screen.findByTestId("panel-lanes");
    expect(lanes).toHaveTextContent("Sessioni delle ultime 24 ore");
    expect(lanes.querySelectorAll("[data-testid^='panel-lane-']")).toHaveLength(1);
    expect(screen.getByTestId("panel-lane-SCOUT-2").querySelectorAll("[data-testid='panel-bar-SCOUT-2']").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("panel-lane-SCOUT-1")).toBeNull();
  });

  it("only reads: it asks for the list, the team, the history and the screen of this session, never an action", async () => {
    show("SCOUT-2");
    await screen.findByTestId("panel-terminal-SCOUT-2");
    const asked = ops();
    expect(new Set(asked.map((r) => r.op))).toEqual(new Set(["list", "team", "history", "screen"]));
    expect(asked.filter((r) => r.op === "screen").every((r) => r.session === "SCOUT-2")).toBe(true);
  });

  it("leads to the chat with this very session: the first instance by its role, the others by number", async () => {
    const first = show("SCOUT-1");
    expect(await screen.findByTestId("agent-page-chat")).toHaveAttribute("href", "#/messages?agent=scout");
    first.unmount();
    const second = show("SCOUT-2");
    expect(await screen.findByTestId("agent-page-chat")).toHaveAttribute("href", "#/messages?agent=scout-2");
    second.unmount();
    show("DOTTORE");
    expect(await screen.findByTestId("agent-page-no-chat")).toHaveTextContent("non c’è una chat");
    expect(screen.queryByTestId("agent-page-chat")).toBeNull();
  });

  it("shows the last message of the chat with the agent, and says so when none was read", async () => {
    show("SCOUT-2");
    expect(await screen.findByTestId("agent-page-last-message")).toHaveTextContent("Nessun messaggio letto");
    cleanup();
    rememberChatPage("scout-2", { messages: [{ id: "m1", role: "user", text: "Cerca a Malmo", at: NOW_S - 120 }, { id: "m2", role: "agent", text: "[caldo] Fatto: **tre** annunci.", at: NOW_S - 60 }] });
    show("SCOUT-2");
    const last = await screen.findByTestId("agent-page-last-message");
    expect(last).toHaveTextContent("Scout 2");
    expect(last).toHaveTextContent("Fatto: tre annunci.");
    expect(last).not.toHaveTextContent("[caldo]");
    expect(screen.getByTestId("agent-page-activity")).toHaveTextContent("Ultima attività");
  });

  it("has no line for the chat on an agent the chat does not speak with", async () => {
    show("DOTTORE");
    await screen.findByTestId("agent-page-title");
    expect(screen.queryByTestId("agent-page-last-message")).toBeNull();
  });

  it("says when the team has no such agent", async () => {
    show("ANALISTA-9");
    expect(await screen.findByTestId("agent-page-missing")).toHaveTextContent("Analista 9");
  });

  it("asks nothing for a name that is not a session", async () => {
    show("bad name!");
    expect(await screen.findByTestId("agent-page-missing")).toBeInTheDocument();
    await waitFor(() => expect(ops()).toEqual([]));
  });
});

describe("the names of the agents", () => {
  it("writes the instance as the person reads it", () => {
    const words = { scout: "Scout", analista: "Analista" };
    expect(agentTitle("ANALISTA-2", words)).toBe("Analista 2");
    expect(agentTitle("CRITICO-S3", { critico: "Critico" })).toBe("Critico S3");
    expect(agentTitle("DOTTORE", words)).toBe("Dottore");
  });

  it("gives a chat id to the sessions the chat speaks with, instances included, and to no other", () => {
    expect(chatIdOfSession("CAPITANO")).toBe("capitano");
    expect(chatIdOfSession("SCOUT-1")).toBe("scout");
    expect(chatIdOfSession("SCOUT-2")).toBe("scout-2");
    expect(chatIdOfSession("SCRITTORE-12")).toBe("scrittore-12");
    for (const none of ["SCOUT-0", "SCOUT-01", "SCOUT-10000", "CRITICO-S3", "CAPITANO-2", "scout-2"]) expect(chatIdOfSession(none), none).toBeNull();
    expect(chatIdOfSession("DOTTORE")).toBeNull();
  });

  it("accepts the sessions of the team's grammar", () => {
    for (const ok of ["CAPITANO", "SCOUT-12", "CRITICO-S3"]) expect(SESSION_NAME.test(ok), ok).toBe(true);
    for (const bad of ["", "scout-1", "1SCOUT", "SCOUT 1", "A".repeat(41), "SCOUT/1"]) expect(SESSION_NAME.test(bad), bad).toBe(false);
  });
});

describe("the words of the page", () => {
  it("are all there, in every language, with their placeholder", () => {
    const keys = Object.keys(AGENT_PAGE_TEXT.it) as (keyof (typeof AGENT_PAGE_TEXT)["it"])[];
    for (const [locale, text] of Object.entries(AGENT_PAGE_TEXT) as [Locale, (typeof AGENT_PAGE_TEXT)["it"]][]) {
      for (const key of keys) {
        expect(text[key], `${locale}.${key}`).toBeTruthy();
        const placeholders = (AGENT_PAGE_TEXT.it[key].match(/\{\w+\}/g) ?? []).sort();
        expect((text[key].match(/\{\w+\}/g) ?? []).sort(), `${locale}.${key}`).toEqual(placeholders);
      }
    }
  });
});
