import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { syntheticStats } from "../../test-support/existing-team-stats-fixture";
import { syntheticDetail, syntheticFacets, syntheticPosition } from "../../test-support/existing-team-positions-fixture";
import { readTable } from "../../../../web/lib/table-csv";
import { positionsApi } from "./positions-api";

// JHT-T06 on an existing team read only: the core's rows carry the scam signals, the list shows
// the «suspicious» badge with its reasons and leaves the position where it is, the section of two
// kinds of signals is a view of its own, and the detail says why. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
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
vi.mock("../map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../office", () => ({ default: () => <h1>Ufficio</h1> }));

type Filters = { scam?: string; limit?: number; offset?: number };
const row = (id: number, extra: Record<string, unknown> = {}) => ({
  ...syntheticPosition,
  id: String(id),
  legacy_id: id,
  title: `Synthetic role ${id}`,
  company: `Synthetic Co ${id}`,
  ...extra,
});
const PLAIN = row(101);
const BADGED = row(102, { scam_signals: { codes: ["advance_payment"], bucket: "badge" } });
const SECTIONED = row(103, {
  scam_signals: { codes: ["advance_payment", "private_chat_only"], bucket: "section" },
});

function companion(request: { op: string; filters?: Filters; id?: string }) {
  if (request.op === "stats") return { ok: true, data: syntheticStats() };
  if (request.op === "facets") return { ok: true, data: { items: syntheticFacets } };
  if (request.op === "detail") {
    return {
      ok: true,
      data: {
        ...syntheticDetail,
        position: { ...syntheticDetail.position, scam_signals: { codes: ["advance_payment", "private_chat_only"], bucket: "section" } },
      },
    };
  }
  const { scam, limit, offset = 0 } = request.filters ?? {};
  // What the core does: the section is its own view, the rest is the list.
  const all = [PLAIN, BADGED, SECTIONED];
  const matching = all.filter((r) => {
    const section = (r as { scam_signals?: { bucket: string } }).scam_signals?.bucket === "section";
    return scam === "only" ? section : scam === "hide" ? !section : true;
  });
  const sectionTotal = all.filter((r) => (r as { scam_signals?: { bucket: string } }).scam_signals?.bucket === "section").length;
  return {
    ok: true,
    data: { items: matching.slice(offset, limit === undefined ? undefined : offset + limit), total: matching.length, scamSection: sectionTotal },
  };
}

let restoreBridge: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args?: { request: never }) => (command === POSITIONS ? companion(args!.request) : null));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
  restoreBridge = installApiBridge(shellApi(positionsApi(notInDesktop)));
  enterExistingTeamReadOnly(false);
});
afterEach(() => {
  cleanup();
  restoreBridge();
  leaveExistingTeamReadOnly();
  vi.unstubAllGlobals();
});

const listFilters = () =>
  native.invoke.mock.calls
    .filter(([command]) => command === POSITIONS)
    .map(([, args]) => args.request as { op: string; filters?: Filters })
    .filter((request) => request.op === "list")
    .map((request) => request.filters ?? {});

describe("the scam signals on an existing team read only", () => {
  it("asks the core for the list without the section, and shows the badge with its reason, the position staying listed", async () => {
    navigate("/positions", { replace: true });
    render(<Shell />);
    expect((await screen.findAllByText("Synthetic role 102")).length).toBeGreaterThan(0);

    expect(listFilters().some((filters) => filters.scam === "hide")).toBe(true);
    // the position with ONE signal keeps its row and gets the badge; the plain one gets none
    const table = document.querySelector("table[data-export='positions']") as HTMLTableElement;
    const rows = [...table.querySelectorAll("tbody tr")];
    const badged = rows.find((r) => r.textContent?.includes("Synthetic role 102"))!;
    const badge = badged.querySelector("[data-csv-skip]") as HTMLElement;
    expect(badge.textContent).toBe("Sospetto");
    expect(badge.getAttribute("title")).toContain("pagamento anticipato");
    const plain = rows.find((r) => r.textContent?.includes("Synthetic role 101"))!;
    expect(plain.querySelector("[data-csv-skip]")).toBeNull();
    // the section's position is not in the main list
    expect(screen.queryByText("Synthetic role 103")).not.toBeInTheDocument();
  }, 20_000);

  it("says how many are in the suspicious section, and a click opens that view alone", async () => {
    navigate("/positions", { replace: true });
    render(<Shell />);
    const chip = await screen.findByRole("link", { name: "Sospette (1)" });
    expect(chip.getAttribute("href")).toMatch(/\/positions\?scam=only$/);

    cleanup();
    navigate("/positions?scam=only", { replace: true });
    render(<Shell />);
    expect((await screen.findAllByText("Synthetic role 103")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Synthetic role 101")).not.toBeInTheDocument();
    expect(listFilters().some((filters) => filters.scam === "only")).toBe(true);
    const bar = screen.getByTestId("scam-section");
    expect(within(bar).getByText("Annunci sospetti")).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: /Torna all’elenco/ }).getAttribute("href")).toMatch(/\/positions$/);
  }, 20_000);

  it("keeps the badge out of the CSV: the title cell is the title", async () => {
    navigate("/positions", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role 102");
    const table = document.querySelector("table[data-export='positions']") as HTMLTableElement;
    const { headers, rows } = readTable(table);
    const titleAt = headers.findIndex((header) => /titolo/i.test(header));
    expect(titleAt).toBeGreaterThanOrEqual(0);
    const titles = rows.map((cells) => cells[titleAt]);
    expect(titles).toContain("Synthetic role 102");
    expect(titles.join("|")).not.toMatch(/Sospetto/);
  }, 20_000);

  it("says why on the position's page, as a warning and with the status untouched", async () => {
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    const card = await screen.findByTestId("scam-signals");
    expect(within(card).getByText("Perché è sospetto")).toBeInTheDocument();
    expect(within(card).getByText(/pagamento anticipato/)).toBeInTheDocument();
    expect(within(card).getByText(/chat privata/)).toBeInTheDocument();
    expect(within(card).getByText(/È solo un avviso/)).toBeInTheDocument();
  }, 20_000);
});
