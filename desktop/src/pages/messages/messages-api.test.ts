import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installApiBridge, notInDesktop } from "../../shell/api-bridge";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { messagesApi } from "./messages-api";

// The web's chat routes, run as they are behind the shell's bridge, on a fake
// desktop client: each test calls fetch("/api/...") as the web chat does and
// checks what reached Supabase. Synthetic data only.
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
}));

let restore: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  restore = installApiBridge(messagesApi(notInDesktop));
});
afterEach(() => restore());

const send = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function ops(table: string) {
  return fake.current!.calls.filter((c) => c.table === table).flatMap((c) => c.ops);
}

describe("the chat routes in the desktop", () => {
  it("POST /api/pending-messages writes the user's turn and rings the box", async () => {
    fake.current!.rows.pending_user_messages = [{ id: "m1", agent: "capitano", body: "ciao" }];
    const res = await send("/api/pending-messages", "POST", { agent: "capitano", message: "ciao" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, message: { id: "m1", author: "user" } });

    const insert = ops("pending_user_messages").find((o) => o.name === "insert");
    expect(insert?.args[0]).toMatchObject({ user_id: "user-1", agent: "capitano", body: "ciao", author: "user", delivered_via: "web" });
    const bell = ops("team_state").find((o) => o.name === "upsert");
    expect(bell?.args[0]).toMatchObject({ user_id: "user-1" });
    expect(bell?.args[0]).toHaveProperty("chat_requested_at");
  });

  it("keeps the web's checks: unknown agent, empty message, no session", async () => {
    expect((await send("/api/pending-messages", "POST", { agent: "nobody", message: "x" })).status).toBe(400);
    expect((await send("/api/pending-messages", "POST", { agent: "capitano", message: "  " })).status).toBe(400);
    fake.current!.user = null;
    expect((await send("/api/pending-messages", "POST", { agent: "capitano", message: "x" })).status).toBe(401);
    expect(ops("pending_user_messages").some((o) => o.name === "insert")).toBe(false);
  });

  it("POST /api/pending-messages/[id]/ack marks only the user's own unread message", async () => {
    fake.current!.rows.pending_user_messages = [{ id: "m7" }];
    const res = await send("/api/pending-messages/m7/ack", "POST");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true });
    const names = ops("pending_user_messages").map((o) => [o.name, o.args[0]]);
    expect(names).toContainEqual(["eq", "id"]);
    expect(names).toContainEqual(["eq", "user_id"]);
    expect(names).toContainEqual(["is", "acknowledged_at"]);
  });

  it("PATCH /api/team-state writes the chat bell but never a team command", async () => {
    // upsert(...).select().single() answers the written row.
    fake.current!.rows.team_state = [{ user_id: "user-1" }];
    const bell = await send("/api/team-state", "PATCH", { chat_requested_at: "2026-09-27T10:00:00Z" });
    expect(bell.status).toBe(200);
    expect(ops("team_state").find((o) => o.name === "upsert")?.args[0]).toHaveProperty("chat_requested_at");
    const command = await send("/api/team-state", "PATCH", { should_run: true });
    expect(command.status).toBe(403);
  });

  it("refuses a box's sync token: the desktop has no service_role path", async () => {
    const res = await send("/api/team-state", "GET", undefined, { authorization: "Bearer jht_sync_abc" });
    expect(res.status).toBe(401);
  });
});
