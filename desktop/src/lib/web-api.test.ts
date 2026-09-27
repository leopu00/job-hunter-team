import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { installApiBridge, shellApi } from "../shell/api-bridge";
import { fakeSupabase, type FakeQuery, type FakeResult } from "../test-support/fake-supabase";
import { createWebApiFetch, EXCLUDE_REASONS } from "./web-api";

const USER = "00000000-0000-4000-8000-000000000001";
const ok = (data: unknown): FakeResult => ({ data, error: null });

const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("feedback", () => {
  it("inserts the verdict for the signed-in user, as the web route does", async () => {
    const { client, queries } = fakeSupabase((q) => ok({ id: "fb-1", table: q.table }));
    const api = createWebApiFetch(client);
    const res = await api(
      "/api/positions/42/feedback",
      post({ action: "dislike", score: 1, direction: "less_like_this", reason: "company", comment: "no" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feedback: { id: "fb-1", table: "position_feedback" } });
    expect(queries[0].table).toBe("position_feedback");
    expect(queries[0].op("insert")).toEqual([
      {
        user_id: USER,
        position_legacy_id: "42",
        action: "dislike",
        reason: "company",
        comment: "no",
        score: 1,
        direction: "less_like_this",
      },
    ]);
  });

  it("refuses what the web route refuses, before writing", async () => {
    const { client, queries } = fakeSupabase(() => ok({}));
    const api = createWebApiFetch(client);
    expect((await api("/api/positions/1/feedback", post({ action: "love" }))).status).toBe(400);
    expect((await api("/api/positions/1/feedback", post({ action: "like", score: 9 }))).status).toBe(400);
    expect(
      (await api("/api/positions/1/feedback", post({ action: "like", direction: "sideways" }))).status,
    ).toBe(400);
    expect((await api("/api/positions/1/feedback", { method: "POST", body: "{not json" })).status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it("needs a session", async () => {
    const { client, queries } = fakeSupabase(() => ok({}), null);
    const res = await createWebApiFetch(client)("/api/positions/1/feedback", post({ action: "like" }));
    expect(res.status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("reads the user's own events, newest first", async () => {
    const { client, queries } = fakeSupabase(() => ok([{ action: "like" }]));
    const res = await createWebApiFetch(client)("/api/positions/7/feedback");
    expect(await res.json()).toEqual({ feedback: [{ action: "like" }] });
    expect(queries[0].ops).toContainEqual(["eq", ["user_id", USER]]);
    expect(queries[0].ops).toContainEqual(["eq", ["position_legacy_id", "7"]]);
    expect(queries[0].op("order")).toEqual(["created_at", { ascending: false }]);
  });
});

describe("summary", () => {
  it("returns the summary, or the raw text cut and normalised when there is none", async () => {
    let row: unknown = { jd_summary: "Sintesi", jd_text: "x" };
    const { client, queries } = fakeSupabase(() => ok(row));
    const api = createWebApiFetch(client);
    expect(await (await api("/api/positions/3/summary")).json()).toEqual({ summary: "Sintesi" });
    expect(queries[0].ops).toContainEqual(["is", ["deleted_at", null]]);

    row = { jd_summary: null, jd_text: `  riga\r\n${"a".repeat(2000)}` };
    const long = (await (await api("/api/positions/3/summary")).json()) as { summary: string };
    expect(long.summary.startsWith("riga\na")).toBe(true);
    expect(long.summary).toHaveLength(1500);
  });
});

describe("user-exclude", () => {
  function positions(status: string, prev: string | null = null) {
    return (q: FakeQuery): FakeResult => {
      const update = q.op("update")?.[0] as Record<string, unknown> | undefined;
      if (!update) return ok({ status, user_excluded_prev_status: prev });
      return ok({
        status: update.status,
        user_excluded_reason: update.user_excluded_reason ?? null,
        user_excluded_prev_status: update.user_excluded_prev_status ?? null,
      });
    };
  }

  it("excludes with the reason and keeps the previous status for undo", async () => {
    const { client, queries } = fakeSupabase(positions("scored"));
    const res = await createWebApiFetch(client)(
      "/api/positions/9/user-exclude",
      post({ reason: "other", note: "  sede sbagliata  " }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    // SwipeDeck legge `status` in cima alla risposta, come dal web.
    expect(body).toMatchObject({ id: "9", status: "excluded", source: "cloud", cloud_synced: true });
    const update = queries[1].op("update")?.[0] as Record<string, unknown>;
    expect(update).toMatchObject({
      status: "excluded",
      user_excluded_reason: "other",
      user_excluded_note: "sede sbagliata",
      user_excluded_prev_status: "scored",
      last_actor: "user",
    });
    expect(queries[1].ops).toContainEqual(["eq", ["user_id", USER]]);
    expect(queries[1].ops).toContainEqual(["eq", ["legacy_id", 9]]);
  });

  it("restores the previous status on DELETE", async () => {
    const { client, queries } = fakeSupabase(positions("excluded", "ready"));
    const res = await createWebApiFetch(client)("/api/positions/9/user-exclude", { method: "DELETE" });
    expect(await res.json()).toMatchObject({ status: "ready" });
    expect(queries[1].op("update")?.[0]).toMatchObject({ status: "ready", user_excluded_reason: null });
  });

  it("refuses an unknown reason, and 'other' without a note", async () => {
    const { client, queries } = fakeSupabase(positions("scored"));
    const api = createWebApiFetch(client);
    expect((await api("/api/positions/9/user-exclude", post({ reason: "boring" }))).status).toBe(400);
    expect((await api("/api/positions/9/user-exclude", post({ reason: "other", note: "  " }))).status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it("has the reasons of the web route, no more and no fewer", () => {
    const route = readFileSync(
      resolve(import.meta.dirname, "../../../web/app/api/positions/[legacyId]/user-exclude/route.ts"),
      "utf8",
    );
    const block = /VALID_REASONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(route);
    expect(block, "VALID_REASONS non trovato nella route").not.toBeNull();
    const reasons = [...block![1].matchAll(/"([a-z_]+)"/g)].map(([, reason]) => reason);
    expect([...EXCLUDE_REASONS].sort()).toEqual(reasons.sort());
  });
});

describe("the rest", () => {
  it("answers 404 not_in_desktop for a route that is not ported, and for the wrong method", async () => {
    const { client, queries } = fakeSupabase(() => ok({}));
    const api = createWebApiFetch(client);
    for (const [path, init] of [
      ["/api/profile/files/cv", undefined],
      ["/api/positions/1/summary", { method: "POST" }],
      ["/api/positions/abc/summary", undefined],
    ] as const) {
      const res = await api(path, init);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_in_desktop" });
    }
    expect(queries).toHaveLength(0);
  });

  it("is what the shell's bridge answers /api with", async () => {
    const { client } = fakeSupabase(() => ok({ jd_summary: "Dal ponte", jd_text: null }));
    const target = { fetch: async () => new Response("real") } as unknown as typeof globalThis;
    const restore = installApiBridge(shellApi(createWebApiFetch(client)), target);
    const res = await target.fetch("/api/positions/5/summary");
    expect(await res.json()).toEqual({ summary: "Dal ponte" });
    expect(await (await target.fetch("https://example.invalid/other")).text()).toBe("real");
    restore();
  });
});
