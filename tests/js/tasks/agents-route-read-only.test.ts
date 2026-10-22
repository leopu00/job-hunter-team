import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// JHT-T25: `/api/agents` is the list of the agents with their state, and only that. Its POST used to send
// C-c to the agent's tmux session (or queue a start/stop for the team on a remote deploy) with just
// `requireAuth`, from any valid session, and nothing called it. Starting and stopping an agent is
// `POST /api/agents/[id]`, which stands behind `requireLocalWrite`.
vi.mock("@/lib/shell", () => ({
  runBash: vi.fn(async () => {
    throw new Error("the list must not shell out in this test");
  }),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => null),
  isLocalRequest: vi.fn(async () => true),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

beforeEach(() => {
  vi.resetModules();
});

describe("/api/agents", () => {
  it("answers the list and nothing else: GET is the only method the module exports", async () => {
    const route = (await import("@/app/api/agents/route")) as Record<string, unknown>;
    expect(typeof route.GET).toBe("function");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(route[method]).toBeUndefined();
  });

  it("holds no way to stop or queue a command for the team", () => {
    const source = read("web/app/api/agents/route.ts");
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/);
    expect(source).not.toContain("send-keys");
    expect(source).not.toContain("enqueueIfRemote");
  });

  it("leaves the start and stop of an agent to the route that is behind requireLocalWrite", () => {
    const byId = read("web/app/api/agents/[id]/route.ts");
    expect(byId).toContain("requireLocalWrite");
    expect(byId).toMatch(/export\s+async\s+function\s+POST\b/);
  });
});
