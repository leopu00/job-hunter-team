import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_AGENTS } from "@/lib/chat-agents";
import type { PendingMessage } from "@/lib/types";
import { fakeSupabase, type FakeQuery } from "../../test-support/fake-supabase";
import {
  AGENTS,
  agentLed,
  HEARTBEAT_STALE_MS,
  lastActivity,
  loadAgents,
  MESSAGES_SELECT,
  MOVES_PER_ROLE,
  threadOf,
  unreadCount,
  type AgentsData,
  type TeamStatus,
} from "./load-agents";

// Synthetic rows only.
const TEAM_ROW = {
  is_running: true,
  last_heartbeat_at: "2026-09-27T10:00:00Z",
  last_action: "sync:push_partial",
  last_action_at: "2026-09-27T09:59:00Z",
  last_error: null,
  last_error_at: null,
  agents_enabled: { scout: true, critico: false, junk: "yes" },
};

function message(over: Partial<PendingMessage>): PendingMessage {
  return {
    id: "m1",
    agent: "capitano",
    body: "ciao",
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

function answer(q: FakeQuery) {
  if (q.table === "team_state") return { data: TEAM_ROW, error: null };
  if (q.table === "position_transitions") {
    const filter = String(q.op("or")?.[0]);
    if (filter.includes("by_agent.eq.scout,"))
      return {
        data: [
          { position_legacy_id: 7, from_state: null, to_state: "new", ts: "2026-09-27T09:30:00Z", by_agent: "scout-1" },
          { position_legacy_id: 8, from_state: null, to_state: "new", ts: "2026-09-27T09:10:00Z", by_agent: "scout-2" },
        ],
        error: null,
      };
    return { data: [], error: null };
  }
  if (q.table === "positions")
    return { data: [{ id: "uuid-7", legacy_id: 7, title: "Ruolo sintetico", company: "Azienda finta" }], error: null };
  if (q.table === "pending_user_messages") return { data: [message({})], error: null };
  return { data: null, error: { message: "unexpected " + q.table } };
}

describe("loadAgents", () => {
  it("reads team_state, each role's moves and the chat, with the user's client", async () => {
    const { client, queries } = fakeSupabase(answer);
    const data = await loadAgents(client);

    expect(data.team).toMatchObject({ isRunning: true, heartbeatAt: "2026-09-27T10:00:00Z", lastError: null });
    // only real booleans are kept from agents_enabled
    expect(data.team?.enabled).toEqual({ scout: true, critico: false });

    const moves = queries.filter((q) => q.table === "position_transitions");
    expect(moves).toHaveLength(AGENTS.length);
    for (const q of moves) expect(q.op("limit")).toEqual([MOVES_PER_ROLE]);
    expect(moves.map((q) => q.op("or")?.[0])).toContain("by_agent.eq.analista,by_agent.like.analista-*");

    expect(data.moves.scout).toEqual([
      expect.objectContaining({ actor: "scout-1", to: "new", positionId: "uuid-7", title: "Ruolo sintetico" }),
      // a position that is not on the cloud keeps its number and no link
      expect.objectContaining({ actor: "scout-2", positionId: null, legacyId: 8 }),
    ]);
    expect(data.moves.critico).toEqual([]);
    const positions = queries.find((q) => q.table === "positions");
    expect(positions?.op("in")).toEqual(["legacy_id", [7, 8]]);
    expect(data.messages).toHaveLength(1);
  });

  it("a team that never wrote its state is null, not an error", async () => {
    const { client } = fakeSupabase((q) => (q.table === "team_state" ? { data: null, error: null } : answer(q)));
    expect((await loadAgents(client)).team).toBeNull();
  });

  it("a failed query fails the read (the page keeps what it had)", async () => {
    const { client } = fakeSupabase((q) =>
      q.table === "pending_user_messages" ? { data: null, error: { message: "boom" } } : answer(q),
    );
    await expect(loadAgents(client)).rejects.toThrow("boom");
  });
});

describe("the roster", () => {
  it("chats exactly with the web's chat agents", () => {
    expect(new Set(AGENTS.filter((a) => a.chat).map((a) => a.role))).toEqual(new Set(CHAT_AGENTS));
  });

  it("reads the chat with the select of the web's Messaggi page", () => {
    const web = readFileSync(resolve(__dirname, "../../../../web/lib/queries.ts"), "utf8");
    const at = web.indexOf("export async function getMessagesHistory(");
    const body = web.slice(at, web.indexOf("\n}\n", at));
    // the string literals inside .select( … ), joined as the + joins them
    const call = body.slice(body.indexOf(".select("), body.indexOf(")", body.indexOf(".select(")));
    const select = [...call.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
    expect(select).toBe(MESSAGES_SELECT);
  });
});

const NOW = Date.parse("2026-09-27T10:02:00Z");
const team = (over: Partial<TeamStatus> = {}): TeamStatus => ({
  isRunning: true,
  heartbeatAt: "2026-09-27T10:00:00Z",
  lastAction: null,
  lastActionAt: null,
  lastError: null,
  lastErrorAt: null,
  enabled: {},
  ...over,
});

describe("agentLed", () => {
  it("is on with a running team and a fresh heartbeat", () => {
    expect(agentLed(team(), "scout", NOW)).toBe("on");
  });

  it("is stale past the threshold, or with no heartbeat at all", () => {
    expect(agentLed(team(), "scout", Date.parse("2026-09-27T10:00:00Z") + HEARTBEAT_STALE_MS + 1)).toBe("stale");
    expect(agentLed(team({ heartbeatAt: null }), "scout", NOW)).toBe("stale");
  });

  it("is off with the team stopped or the role disabled, unknown without a team", () => {
    expect(agentLed(team({ isRunning: false }), "scout", NOW)).toBe("off");
    expect(agentLed(team({ enabled: { scout: false } }), "scout", NOW)).toBe("off");
    expect(agentLed(null, "scout", NOW)).toBe("unknown");
  });
});

describe("activity and chat", () => {
  const data: AgentsData = {
    team: team(),
    moves: { capitano: [{ ts: "2026-09-27T08:00:00Z", actor: "capitano", from: null, to: "new", positionId: null, legacyId: 1, title: null, company: null }] } as AgentsData["moves"],
    messages: [
      message({ id: "u", author: "user", created_at: "2026-09-27T09:30:00Z", acknowledged_at: "2026-09-27T09:30:00Z" }),
      message({ id: "a2", created_at: "2026-09-27T09:10:00Z" }),
      message({ id: "a1", created_at: "2026-09-27T09:00:00Z", acknowledged_at: "2026-09-27T09:05:00Z" }),
      message({ id: "m", agent: "mentor", created_at: "2026-09-27T09:20:00Z" }),
    ],
  };

  it("the last activity is the newest of the agent's moves and its own messages", () => {
    // the user's turn at 09:30 is not the agent's activity
    expect(lastActivity(data, "capitano")).toBe("2026-09-27T09:10:00Z");
    expect(lastActivity(data, "scout")).toBeNull();
  });

  it("a thread is one agent's messages oldest first; unread counts only the agent's", () => {
    expect(threadOf(data.messages, "capitano").map((m) => m.id)).toEqual(["a1", "a2", "u"]);
    expect(unreadCount(data.messages, "capitano")).toBe(1);
    expect(unreadCount(data.messages, "mentor")).toBe(1);
  });
});
