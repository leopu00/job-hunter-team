import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigate } from "../../shell/router";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";

// The web's /positions and /positions/[id] pages, run as they are on a fake
// desktop client: the tests prove the desktop renders the web's own page
// with the user's rows. Synthetic data only.
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
}));

const POSITION_ID = "00000000-0000-4000-8000-000000000042";

function position(extra: Record<string, unknown> = {}) {
  return {
    id: POSITION_ID,
    legacy_id: 42,
    title: "Ruolo sintetico 42",
    company: "Azienda sintetica",
    location: "Città sintetica",
    remote_type: "hybrid",
    status: "scored",
    source: "board-a",
    url: "https://example.invalid/job/42",
    found_at: "2026-01-01T10:00:00Z",
    found_by: "scout-1",
    last_checked: "2026-01-02T10:00:00Z",
    deleted_at: null,
    role_family: "Dati",
    loc_country: "IT",
    loc_city: "Città sintetica",
    scores: { total_score: 81, scored_at: "2026-01-03T10:00:00Z", scored_by: "scorer-1" },
    applications: null,
    ...extra,
  };
}

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  // The sidebar and the seen marker call the web's /api routes: here nothing
  // answers them, as when a route is not in the desktop.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "not_in_desktop" }), { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the web's /positions page in the desktop", () => {
  it("lists the user's scored positions, read through the desktop client", async () => {
    fake.current!.rows.positions = [position()];
    const { default: WebPositionsPage } = await import("@/app/(protected)/positions/page");
    render(await WebPositionsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("Ruolo sintetico 42").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Azienda sintetica").length).toBeGreaterThan(0);
    const tables = fake.current!.calls.map((c) => c.table);
    expect(tables).toContain("positions");
    // The cloud branch of getPositions: deleted rows filtered on the server.
    const positions = fake.current!.calls.find((c) => c.table === "positions")!;
    expect(positions.ops).toContainEqual({ name: "is", args: ["deleted_at", null] });
  });

  it("the search lives in the query string, as on the web", async () => {
    fake.current!.rows.positions = [position()];
    // The page reads it as searchParams, the search box through the router.
    navigate("/positions?q=sintetica", { replace: true });
    const { default: WebPositionsPage } = await import("@/app/(protected)/positions/page");
    render(await WebPositionsPage({ searchParams: Promise.resolve({ q: "sintetica" }) }));
    const searchbox = screen.getAllByRole("searchbox")[0] as HTMLInputElement;
    expect(searchbox.value).toBe("sintetica");
  });
});

describe("the web's /positions/[id] page in the desktop", () => {
  it("shows the position the user opened", async () => {
    fake.current!.rows.positions = [position()];
    const { default: WebPositionPage } = await import("@/app/(protected)/positions/[id]/page");
    render(await WebPositionPage({ params: Promise.resolve({ id: POSITION_ID }) }));
    await waitFor(() => expect(screen.getAllByText("Ruolo sintetico 42").length).toBeGreaterThan(0));
    const byId = fake.current!.calls.find((c) => c.table === "positions")!;
    expect(byId.ops).toContainEqual({ name: "eq", args: ["id", POSITION_ID] });
  });

  it("answers not found for a position the user cannot read", async () => {
    fake.current!.rows.positions = [];
    const { default: WebPositionPage } = await import("@/app/(protected)/positions/[id]/page");
    await expect(WebPositionPage({ params: Promise.resolve({ id: POSITION_ID }) })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("the desktop pages hand the route to the web pages", () => {
  it("/positions passes the query string: the search reaches the query", async () => {
    fake.current!.rows.positions = [position()];
    navigate("/positions?q=sintetica", { replace: true });
    const { default: PositionsPage } = await import("./index");
    render(<PositionsPage params={{}} search={new URLSearchParams("q=sintetica")} />);
    expect((await screen.findAllByText("Ruolo sintetico 42")).length).toBeGreaterThan(0);
    const positions = fake.current!.calls.find((c) => c.table === "positions")!;
    // getPositions turns a free-text search into a PostgREST `or` filter.
    expect(positions.ops.some((o) => o.name === "or" && String(o.args[0]).includes("sintetica"))).toBe(true);
  });

  it("/positions/:id passes the id", async () => {
    fake.current!.rows.positions = [position()];
    const { default: PositionPage } = await import("../position/index");
    render(<PositionPage params={{ id: POSITION_ID }} search={new URLSearchParams()} />);
    expect((await screen.findAllByText("Ruolo sintetico 42")).length).toBeGreaterThan(0);
    const byId = fake.current!.calls.find((c) => c.table === "positions")!;
    expect(byId.ops).toContainEqual({ name: "eq", args: ["id", POSITION_ID] });
  });
});
