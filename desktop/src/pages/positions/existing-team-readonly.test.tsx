import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enterExistingTeamReadOnly,
  leaveExistingTeamReadOnly,
} from "../../lib/existing-team-readonly";
import { describeError } from "../../lib/error-catalog";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { installApiBridge, notInDesktop, shellApi, type ApiFetch } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { syntheticStats } from "../../test-support/existing-team-stats-fixture";
import {
  syntheticDetail,
  syntheticFacets,
  syntheticPosition,
} from "../../test-support/existing-team-positions-fixture";
import { positionsApi } from "./positions-api";

// The Shell on an existing team that is only read: the web's own Posizioni and
// Dettaglio pages, on rows the companion returns, with nothing asked of the
// cloud and every control that writes disabled. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
// The header of the link also asks the app one command of its own (the team's identity); only this one is the pages'.
const POSITIONS = "existing_team_positions_read";
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
  signOut: vi.fn(),
}));
// The real map and office need WebGL, which jsdom has not; they are not reachable here.
vi.mock("../map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../office", () => ({ default: () => <h1>Ufficio</h1> }));

type Row = typeof syntheticPosition;
const ROWS: Row[] = Array.from({ length: 60 }, (_unused, index) => ({
  ...syntheticPosition,
  id: String(1000 + index),
  legacy_id: 1000 + index,
  title: `Synthetic row ${String(index).padStart(2, "0")}`,
  company: `Synthetic Co ${index}`,
  score: 90 - index,
  // newest first, as the companion sorts by default
  found_at: new Date(Date.UTC(2026, 0, 31, 12) - index * 3_600_000).toISOString(),
  last_action_at: new Date(Date.UTC(2026, 0, 31, 12) - index * 3_600_000).toISOString(),
}));
ROWS[0] = { ...ROWS[0], id: "101", legacy_id: 101, title: "Synthetic role A", company: "Synthetic Co A" };

type Filters = {
  q?: string;
  limit?: number;
  offset?: number;
  scoredOnly?: boolean;
  hideExcluded?: boolean;
  sort?: string;
};
let fetched: string[] = [];
/** The team has found nothing: the core counts and serves no row. */
let emptyTeam = false;
/** Every call the pages make to the app's own /api, with its method, as the bridge saw it. */
let apiCalls: string[] = [];
const recordApi = (next: ApiFetch): ApiFetch => async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
  apiCalls.push(`${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`);
  return next(input, init);
};

function companion(request: { op: string; filters?: Filters; id?: string }) {
  if (request.op === "stats") return { ok: true, data: syntheticStats() };
  if (request.op === "facets") return { ok: true, data: { items: syntheticFacets } };
  if (request.op === "detail") {
    return { ok: true, data: request.id === "101" ? syntheticDetail : null };
  }
  // What the core does: filter, count, then give one page of light rows.
  const { q, limit, offset = 0, scoredOnly, hideExcluded } = request.filters ?? {};
  const hay = (row: Row) => `${row.title} ${row.company}`.toLowerCase();
  const matching = (emptyTeam ? [] : ROWS).filter(
    (row) =>
      (!q || hay(row).includes(q.toLowerCase())) &&
      (!scoredOnly || row.score != null) &&
      (!hideExcluded || (row.status as string) !== "excluded"),
  );
  return {
    ok: true,
    data: {
      items: matching.slice(offset, limit === undefined ? undefined : offset + limit),
      total: matching.length,
    },
  };
}

let restoreBridge: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  fake.current.rows.positions = [{ id: "cloud-row", title: "Cloud row, must never show" }];
  document.cookie = "NEXT_LOCALE=it; path=/";
  fetched = [];
  emptyTeam = false;
  apiCalls = [];
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args?: { request: never }) => (command === POSITIONS ? companion(args!.request) : null));
  // Nothing but the app's own api reaches the network here, and the exchange
  // rates the web page asks for on its own (answered empty: it falls back).
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
  restoreBridge = installApiBridge(recordApi(shellApi(positionsApi(notInDesktop))));
  enterExistingTeamReadOnly(false);
});
afterEach(() => {
  cleanup();
  restoreBridge();
  leaveExistingTeamReadOnly();
  vi.unstubAllGlobals();
});

const REASON = EXISTING_TEAM_READONLY_TEXT.it.assistantOff;
const listRequests = () =>
  native.invoke.mock.calls
    .filter(([command]) => command === POSITIONS)
    .map(([, args]) => args.request as { op: string; filters?: Filters })
    .filter((request) => request.op === "list");

describe("Posizioni on an existing team read only", () => {
  it("lists the team's rows, with the sidebar, and asks the cloud for nothing", async () => {
    navigate("/positions", { replace: true });
    render(<Shell />);

    expect((await screen.findAllByText("Synthetic role A")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Cloud row, must never show/)).not.toBeInTheDocument();
    // The honest banner, and one navigation entry: no page that reads the cloud or the box.
    expect(screen.getByTestId("existing-team-readonly-banner")).toHaveTextContent(REASON);
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["JHT", "Dashboard", "Map", "Posizioni", "Squadra", "Profilo", "Ufficio", "Agenti"]);
    // The sidebar starts closed; opened, its dataset comes from the companion
    // through the web route, and its families are the team's own.
    await userEvent.setup().click(screen.getByRole("button", { name: /filtri/i }));
    await waitFor(
      () => expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "facets" } }),
      { timeout: 8000 },
    );
    // The families and the places of the team's facets, counted in the sidebar.
    await waitFor(
      () => expect(document.querySelector("aside")?.textContent).toMatch(/Categoria2 · 2.*Località2 · 2/),
      { timeout: 8000 },
    );
    // The sources are the team's too, counted from its facets.
    await userEvent.setup().click(within(document.querySelector("aside") as HTMLElement).getByRole("button", { name: /fonte/i }));
    expect(within(document.querySelector("aside") as HTMLElement).getByText("synthetic")).toBeInTheDocument();
    expect(within(document.querySelector("aside") as HTMLElement).getByText("board-b")).toBeInTheDocument();
    expect(fake.current!.calls).toEqual([]);
    expect(fake.current!.rpc).toEqual([]);
  }, 20_000);

  it("shows the default columns in tiers: Score and Stato always, the rest as the window allows", async () => {
    navigate("/positions", { replace: true });
    render(<Shell />);

    await screen.findAllByText("Synthetic role A");
    const hidden = (header: RegExp) =>
      screen.getAllByRole("columnheader", { name: header })[0].className;
    // Always there, whatever the window.
    expect(hidden(/score/i)).not.toMatch(/max-\[\d+px\]:hidden/);
    expect(hidden(/stato|status/i)).not.toMatch(/max-\[\d+px\]:hidden/);
    // Left out of a narrow window, so the table does not scroll sideways.
    expect(hidden(/paese|country/i)).toMatch(/max-\[1460px\]:hidden/);
    expect(hidden(/citt|city/i)).toMatch(/max-\[1460px\]:hidden/);
    expect(document.querySelector("table")?.className).toContain("min-[1460px]:[min-width:var(--min-c)]");
  }, 20_000);

  it("asks the companion for one page at a time, with the default view and the count done there", async () => {
    navigate("/positions", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");

    // The payload the page really puts on the wire (the Rust decoder test pins
    // the same one): the page size, not the 2000 the web asks of the cloud.
    expect(listRequests()).toEqual([
      { op: "list", filters: { limit: 50, offset: 0, sort: "found_at", dir: "desc", scoredOnly: true, hideExcluded: true } },
    ]);
  });

  it("asks for the next page, not for everything, when the person pages", async () => {
    navigate("/positions?page=2&pageSize=25", { replace: true });
    render(<Shell />);
    expect((await screen.findAllByText("Synthetic row 30")).length).toBeGreaterThan(0);
    expect(listRequests().map(({ filters }) => [filters?.limit, filters?.offset])).toEqual([[25, 25]]);
    expect(screen.getByText(/26–50 di 60/)).toBeInTheDocument();
  });

  it.each([
    "id", "title", "company", "role_family", "source", "location", "loc_city", "loc_country", "remote",
    "score", "salary", "monthly", "critic", "found_at", "status", "written_at", "applied_at",
  ])("sends the clicked column and its direction to the core: sort=%s&dir=asc", async (column) => {
    // the URL a click on the header makes, with a filter next to it, as on the real team
    navigate(`/positions?remote=full_remote&sort=${column}&dir=asc`, { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");
    expect(listRequests()[0].filters).toMatchObject({ sort: column, dir: "asc", remoteTypes: ["full_remote"] });
  });

  it("tells the person when the sort they asked for is not one the core can do", async () => {
    navigate("/positions?sort=last_action_at&dir=asc", { replace: true });
    render(<Shell />);
    expect(await screen.findByTestId("existing-team-readonly-notice")).toHaveTextContent(
      EXISTING_TEAM_READONLY_TEXT.it.sortLastAction,
    );
    // asked by name for the date order, never silently left unsorted
    expect(listRequests()[0].filters).toMatchObject({ sort: "found_at", dir: "asc" });
  });

  it("tells an empty team's list in one sentence, not «no results with these filters», and keeps the sort notice off it", async () => {
    emptyTeam = true;
    navigate("/positions?sort=last_action_at&dir=asc", { replace: true });
    render(<Shell />);
    expect((await screen.findAllByText(/la squadra non ne ha ancora trovate con un punteggio/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/con questi filtri/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("existing-team-readonly-notice")).not.toBeInTheDocument();
  });

  it("still says «with these filters» when the person's filters leave nothing", async () => {
    navigate("/positions?q=nothing-matches-this", { replace: true });
    render(<Shell />);
    expect((await screen.findAllByText("Nessuna posizione trovata con questi filtri.")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/non ne ha ancora trovate/)).not.toBeInTheDocument();
  });

  it("pages the list as the web does and keeps the filter in the query string", async () => {
    navigate("/positions", { replace: true });
    const { unmount } = render(<Shell />);
    await screen.findAllByText("Synthetic role A");
    // 60 rows, 50 a page: the 51st is on page 2.
    expect(screen.queryByText("Synthetic row 55")).not.toBeInTheDocument();
    unmount();

    navigate("/positions?page=2", { replace: true });
    render(<Shell />);
    expect((await screen.findAllByText("Synthetic row 55")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Synthetic row 05")).not.toBeInTheDocument();
  });

  it("sends the search to the companion", async () => {
    navigate("/positions?q=row 07", { replace: true });
    render(<Shell />);
    expect((await screen.findAllByText("Synthetic row 07")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Synthetic row 08")).not.toBeInTheDocument();
    expect(listRequests().some(({ filters }) => filters?.q === "row 07")).toBe(true);
  });

  it("says so when the team's positions cannot be read, and reads them again on Aggiorna", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementation(async () => ({ ok: false, error: "positions_unavailable" }));
    navigate("/positions", { replace: true });
    render(<Shell />);

    const alert = await screen.findByRole("alert");
    // The core's own code, not a catch-all "cannot be reached", is what the person reads.
    expect(alert).toHaveTextContent(describeError("positions_unavailable", { locale: "it" }).text);
    expect(alert).toHaveTextContent("(positions_unavailable)");
    expect(screen.queryByText("Synthetic role A")).not.toBeInTheDocument();

    native.invoke.mockImplementation(async (command: string, args?: { request: never }) => (command === POSITIONS ? companion(args!.request) : null));
    await user.click(screen.getByRole("button", { name: "Aggiorna" }));
    expect((await screen.findAllByText("Synthetic role A")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("falls back to the dashboard when the hash asks for a page that reads another source", async () => {
    navigate("/swipe", { replace: true });
    render(<Shell />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(window.location.hash).toMatch(/^#\/dashboard/);
  });
});

describe("Dettaglio posizione on an existing team read only", () => {
  it("is written in the app's language when no NEXT_LOCALE cookie says otherwise (English app, English Dettaglio)", async () => {
    document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
    localStorage.setItem("jht-lang", "en");
    try {
      navigate("/positions/101", { replace: true });
      render(<Shell />);
      expect((await screen.findAllByText("Synthetic role A")).length).toBeGreaterThan(0);
      expect(screen.getByText("Overview")).toBeInTheDocument();
      expect(screen.queryByText("Panoramica")).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem("jht-lang");
    }
  });

  it("shows the position the companion returns and disables every control that would write", async () => {
    const user = userEvent.setup();
    navigate("/positions/101", { replace: true });
    render(<Shell />);

    expect((await screen.findAllByText("Synthetic role A")).length).toBeGreaterThan(0);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", {
      request: { op: "detail", id: "101" },
    });
    expect(screen.getAllByText(/Synthetic Co A/).length).toBeGreaterThan(0);

    // The private note, and everything that asks the team for something.
    const note = screen.getByRole("textbox");
    expect(note).toBeDisabled();
    expect(note).toHaveAttribute("title", REASON);
    const sheet = screen.getByRole("button", { name: /richieste/i });
    expect(sheet).toBeEnabled(); // it only opens the list of actions
    await user.click(sheet);
    const dialog = await screen.findByRole("dialog");
    const blocked = within(dialog).getAllByTitle(REASON);
    expect(blocked.length).toBeGreaterThanOrEqual(5);
    for (const control of blocked) expect(control).toBeDisabled();
    // No enabled control in the sheet writes: only the ones that close it remain.
    const enabled = within(dialog).queryAllByRole("button").filter((button) => !(button as HTMLButtonElement).disabled);
    for (const button of enabled) {
      expect(`${button.textContent} ${button.getAttribute("aria-label") ?? ""}`).toMatch(/chiudi|close|×|✕|annulla/i);
    }

    await user.click(blocked[0]);
    await user.keyboard("{Escape}");
    // Nothing was asked of the cloud nor sent to a route.
    expect(fake.current!.calls).toEqual([]);
    expect(apiCalls.filter((call) => !["GET /api/i18n", "GET /api/positions/facets"].includes(call))).toEqual([]);
  });

  it("shows «Feedback e richieste», read only, for the payload the team really sends (no legacy_id)", async () => {
    const user = userEvent.setup();
    // The team's jobs.db has no legacy_id column: the core sends null for it.
    const real = { ...syntheticDetail, position: { ...syntheticDetail.position, legacy_id: null } };
    native.invoke.mockImplementation(async (command: string, args?: { request: { op: string; id?: string } }) =>
      command !== POSITIONS
        ? null
        : args!.request.op === "detail"
          ? { ok: true, data: args!.request.id === "101" ? real : null }
          : companion(args!.request as never),
    );
    navigate("/positions/101", { replace: true });
    render(<Shell />);

    expect((await screen.findAllByText("Synthetic role A")).length).toBeGreaterThan(0);
    // The row's id is the box id, as on the cloud row of the same position.
    expect(screen.getByText("JHT-101")).toBeInTheDocument();
    const sheet = screen.getByRole("button", { name: /feedback e richieste/i });
    await user.click(sheet);
    const dialog = await screen.findByRole("dialog");
    const blocked = within(dialog).getAllByTitle(REASON);
    expect(blocked.length).toBeGreaterThanOrEqual(5);
    for (const control of blocked) expect(control).toBeDisabled();
    const enabled = within(dialog).queryAllByRole("button").filter((button) => !(button as HTMLButtonElement).disabled);
    for (const button of enabled) {
      expect(`${button.textContent} ${button.getAttribute("aria-label") ?? ""}`).toMatch(/chiudi|close|×|✕|annulla/i);
    }
    await user.click(blocked[0]);
    await user.keyboard("{Escape}");
    expect(fake.current!.calls).toEqual([]);
    expect(apiCalls.filter((call) => !["GET /api/i18n", "GET /api/positions/facets"].includes(call))).toEqual([]);
  });

  it("does not mark the position as seen on the cloud after the dwell time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      navigate("/positions/101", { replace: true });
      render(<Shell />);
      await screen.findAllByText("Synthetic role A");
      await vi.advanceTimersByTimeAsync(3000);
      expect(apiCalls).not.toContain("POST /api/positions/seen");
      expect(apiCalls.filter((call) => !call.startsWith("GET "))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says why when the assistant is on but the connection stays read only", async () => {
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(true);
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");
    expect(screen.getByTestId("existing-team-readonly-banner")).toHaveTextContent(
      EXISTING_TEAM_READONLY_TEXT.it.connectionReadOnly,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute("title", EXISTING_TEAM_READONLY_TEXT.it.connectionReadOnly);
  });

  it("refuses at the bridge a write that gets past a disabled control", async () => {
    const response = await fetch("/api/positions/101/user-note", {
      method: "POST",
      body: JSON.stringify({ note: "x" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "read_only" });
    expect(fake.current!.calls).toEqual([]);
  });
});
