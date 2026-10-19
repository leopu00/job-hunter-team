import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { EXISTING_TEAM_DASHBOARD_TEXT, fill } from "./existing-team-dashboard.i18n";
import { installApiBridge, notInDesktop, shellApi, type ApiFetch } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { syntheticStats } from "../../test-support/existing-team-stats-fixture";
import { fixturePosition } from "./dashboard-fixture";

// The Shell on an existing team that is only read, on its Dashboard: the numbers
// the core counted on the team's VPS, nothing from the cloud, and what the team
// does not give in full said out loud. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
  signOut: vi.fn(),
}));
vi.mock("../map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../office", () => ({ default: () => <h1>Ufficio</h1> }));

const TEXT = EXISTING_TEAM_DASHBOARD_TEXT.it;
let apiCalls: string[] = [];
let outside: string[] = [];
let ratesReachable = true;
let restoreBridge: () => void;
let reply: (request: { op: string }) => unknown;

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  apiCalls = [];
  outside = [];
  ratesReachable = true;
  reply = () => ({ ok: true, data: syntheticStats() });
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (_command: string, args: { request: { op: string } }) => reply(args.request));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      outside.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (!ratesReachable) throw new TypeError("network down");
      return new Response(JSON.stringify({ rates: { USD: 1.1, GBP: 0.85 } }), { status: 200 });
    }),
  );
  const record = (next: ApiFetch): ApiFetch => async (input, init) => {
    apiCalls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(input)}`);
    return next(input, init);
  };
  restoreBridge = installApiBridge(record(shellApi(notInDesktop)));
  enterExistingTeamReadOnly(false);
});
afterEach(() => {
  cleanup();
  restoreBridge();
  leaveExistingTeamReadOnly();
  vi.unstubAllGlobals();
});

// The header's read of which team this is (existing_team_link_identity: a local file, no SSH) has no
// request; every other call must be the core's read.
const opsAsked = () => {
  const calls = native.invoke.mock.calls.filter(([command]) => command !== "existing_team_link_identity");
  expect(calls.every(([command]) => command === "existing_team_positions_read")).toBe(true);
  return calls.map(([, args]) => (args.request as { op: string }).op);
};

describe("Dashboard on an existing team read only", () => {
  it("draws the core's counts, the newest scored and the charts, and asks the cloud for nothing", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("12 posizioni totali · 1 escluse · 11 attive")).toBeInTheDocument();
    // the newest scored, read whole from the core, and the charts' rows
    expect((await screen.findAllByText("Synthetic team role 11")).length).toBeGreaterThan(0);
    expect(screen.getByText("Le Ultime Posizioni Valutate")).toBeInTheDocument();
    expect(screen.getByText("Candidature inviate")).toBeInTheDocument();
    // the navigation of that view
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["JHT", "Dashboard", "Map", "Posizioni", "Squadra", "Profilo", "Ufficio", "Agenti"]);
    // nothing from the cloud, no write
    expect(fake.current!.calls).toEqual([]);
    expect(fake.current!.rpc).toEqual([]);
    expect(apiCalls.filter((call) => !call.startsWith("GET "))).toEqual([]);
  });

  it("tells a team with no position in one empty state, not in boxes that each say «No data»", async () => {
    const stats = syntheticStats();
    reply = () => ({
      ok: true,
      data: {
        ...stats,
        stats: { ...stats.stats, total: 0, new: 0, checked: 0, scored: 0, applied: 0, excluded: 0, scored_open: 0 },
        distribution: { active: 0, withScore: 0, avgScore: null, buckets: stats.distribution.buckets.map((b) => ({ ...b, count: 0 })) },
        sources: [],
        types: [],
        recent: [],
        points: { rows: [], included: 0, of: 0 },
        events: { rows: [], included: 0, of: 0 },
      },
    });
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    const empty = await screen.findByTestId("dashboard-empty-team");
    expect(empty).toHaveTextContent(TEXT.emptyTitle);
    expect(empty).toHaveTextContent("«Squadra»");
    // one state, not the summary and the five charts around it
    expect(screen.queryByTestId("existing-team-summary")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nessun dato/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nessuna delle 0 posizioni attive/)).not.toBeInTheDocument();
  });

  it("keeps the summary and the charts for a team that has positions", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    await screen.findByTestId("existing-team-summary");
    expect(screen.queryByTestId("dashboard-empty-team")).not.toBeInTheDocument();
  });

  it("lists the newest scored from the core, even when the charts got only a slice of the team", async () => {
    const stats = syntheticStats();
    const newest = fixturePosition(99, { id: "9999", legacy_id: null, title: "Synthetic newest only in recent", scored_at: "2026-12-31T00:00:00Z" });
    reply = () => ({ ok: true, data: { ...stats, recent: [newest, ...stats.recent.slice(0, 7)] } });
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    expect((await screen.findAllByText("Synthetic newest only in recent")).length).toBeGreaterThan(0);
  });

  it("asks the core for its numbers once and never downloads positions to count them", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    await screen.findByText("12 posizioni totali · 1 escluse · 11 attive");
    expect(opsAsked()).toEqual(["stats"]);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "stats" } });
  });

  it("shows the core's aggregates with their denominators", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    const summary = await screen.findByTestId("existing-team-summary");
    expect(summary).toHaveTextContent(fill(TEXT.scored, { avg: 75, n: 11, active: 11 }));
    expect(summary).toHaveTextContent("76–100: 5 · 61–75: 4 · 41–60: 2 · ≤ 40: 0");
    expect(summary).toHaveTextContent("board-a: 7 · board-b: 4");
  });

  it("says what is bounded, what could not be converted and what is only on this computer", async () => {
    ratesReachable = false;
    const rows = Array.from({ length: 3 }, (_unused, index) =>
      fixturePosition(index + 1, {
        id: String(3000 + index),
        salary_min: 50_000,
        salary_max: 60_000,
        salary_currency: index === 0 ? "EUR" : "USD",
      }),
    );
    reply = () => ({
      ok: true,
      data: syntheticStats({
        points: { rows, included: 2000, of: 2400 },
        events: { rows: [{ appliedAt: "2026-09-20T10:00:00Z", response: null, responseAt: null }], included: 1, of: 5 },
      }),
    });
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    const notes = await screen.findByTestId("existing-team-summary-notes");
    expect(notes).toHaveTextContent(fill(TEXT.chartsPartial, { n: 2000, of: 2400 }));
    expect(notes).toHaveTextContent(fill(TEXT.eventsPartial, { n: 1, of: 5 }));
    expect(notes).toHaveTextContent(fill(TEXT.ratesUnavailable, { n: 2 }));
    expect(notes).toHaveTextContent(TEXT.seenLocal);
  });

  it("offers only the euro, and ignores a saved currency, when there are no exchange rates", async () => {
    ratesReachable = false;
    // the person's saved choice (the web's cookie), a currency the team's euro amounts must not be shown in
    document.cookie = "jht_display_currency=USD; path=/";
    const rows = [
      fixturePosition(1, { id: "3001", salary_min: 50_000, salary_max: 70_000, salary_currency: "EUR", status: "scored" }),
      fixturePosition(2, { id: "3002", salary_min: 60_000, salary_max: 80_000, salary_currency: "EUR", status: "scored" }),
    ];
    reply = () => ({ ok: true, data: syntheticStats({ points: { rows, included: 2, of: 2 } }) });
    navigate("/dashboard", { replace: true });
    try {
      render(<Shell />);
      const notes = await screen.findByTestId("existing-team-summary-notes");
      expect(notes).toHaveTextContent(TEXT.eurOnly);
      // the selector has the euro and nothing else
      const salary = screen.getByRole("button", { name: "EUR" }).parentElement as HTMLElement;
      expect(within(salary).getAllByRole("button").map((button) => button.textContent)).toEqual(["EUR"]);
      // and nothing is drawn with another currency's symbol
      expect(screen.queryByRole("button", { name: "USD" })).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain("$");
    } finally {
      document.cookie = "jht_display_currency=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    }
  });

  it("keeps the currencies the web offers when the rates are live", async () => {
    document.cookie = "jht_display_currency=USD; path=/";
    try {
      navigate("/dashboard", { replace: true });
      render(<Shell />);
      await screen.findByTestId("existing-team-summary-notes");
      expect(screen.getByRole("button", { name: "USD" })).toBeInTheDocument();
      expect(screen.getByTestId("existing-team-summary-notes")).not.toHaveTextContent(TEXT.eurOnly);
    } finally {
      document.cookie = "jht_display_currency=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    }
  });

  it("draws no note about a block that is complete", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    const notes = await screen.findByTestId("existing-team-summary-notes");
    expect(notes).not.toHaveTextContent("più recenti");
    expect(notes).not.toHaveTextContent("Tassi di cambio");
  });

  it("tells the core's own error, not a guess about the network, and reads again on Aggiorna", async () => {
    const user = userEvent.setup();
    reply = () => ({ ok: false, error: "positions_unavailable" });
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent?.includes("(positions_unavailable)"))).toBe(true);
    expect(alerts.some((alert) => alert.textContent?.includes(describeError("positions_unavailable", { locale: "it" }).text))).toBe(true);

    reply = () => ({ ok: true, data: syntheticStats() });
    await user.click(screen.getByRole("button", { name: "Aggiorna" }));
    expect(await screen.findByText("12 posizioni totali · 1 escluse · 11 attive")).toBeInTheDocument();
  });

  it("goes to the positions and back, both read from the team", async () => {
    const user = userEvent.setup();
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    await screen.findByText("12 posizioni totali · 1 escluse · 11 attive");
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    await user.click(within(nav).getByRole("link", { name: "Posizioni" }));
    expect(window.location.hash).toMatch(/^#\/positions/);
    await user.click(within(nav).getByRole("link", { name: "Dashboard" }));
    expect(await screen.findByText("12 posizioni totali · 1 escluse · 11 attive")).toBeInTheDocument();
  });
});
