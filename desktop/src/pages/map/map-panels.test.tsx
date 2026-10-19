import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapCharts from "@/app/components/MapCharts";
import {
  CORNER_CARD_W,
  MAP_PANELS_CSS,
  RAIL_BOTTOM,
  RAIL_CARD_W,
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  RAIL_QUERY,
  RAIL_SIDE,
  railClearance,
  railWidth,
} from "@/lib/map-panels-layout";

// The globe is a WebGL canvas: the panels are what is tested here.
vi.mock("@/app/components/JobsGlobeLazy", () => ({
  default: (props: { fitPaddingLeft?: number }) => (
    <div data-testid="globe" data-fit-padding-left={props.fitPaddingLeft ?? 0} />
  ),
}));

const POSITIONS = [
  { id: "a", title: "A", company: "X", status: "scored", role_family: "Data", score: 80, loc_country: "Italy", loc_city: "Rome", created_at: null },
  { id: "b", title: "B", company: "Y", status: "scored", role_family: "AI", score: 90, loc_country: "Spain", loc_city: "Madrid", created_at: null },
];
const TREE = [
  { country: "Italy", count: 1, cities: [{ city: "Rome", count: 1, positions: [{ id: "a", title: "A", company: "X", score: 80 }] }] },
  { country: "Spain", count: 1, cities: [{ city: "Madrid", count: 1, positions: [{ id: "b", title: "B", company: "Y", score: 90 }] }] },
];
const TYPES = [
  { family: "Data", count: 1, color: "#60a5fa", avgScore: 80, avgCritic: null, scores: [80] },
  { family: "AI", count: 1, color: "#a78bfa", avgScore: 90, avgCritic: null, scores: [90] },
];

function mockMedia(rail: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: rail && query === RAIL_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/locations") ? TREE : url.endsWith("/coords") ? POSITIONS : [],
    })),
  );
}

async function renderMap() {
  render(<MapCharts typeDist={TYPES} fallbackScores={[80, 90]} labels={{}} emptyLabel="none" scoreTitle="Score distribution" />);
  await waitFor(() => expect(screen.getAllByRole("button", { expanded: false }).length).toBe(4));
}

const header = (name: RegExp) => screen.getByRole("button", { name });
const open = () => screen.queryAllByRole("button", { expanded: true }).map((b) => b.textContent);

describe("map panels layout", () => {
  beforeEach(stubFetch);
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("collapses all four panels by default", async () => {
    mockMedia(false);
    await renderMap();
    expect(open()).toEqual([]);
  });

  it("outside the medium window the panels open independently, in their corners", async () => {
    mockMedia(false);
    await renderMap();
    fireEvent.click(header(/location/i));
    fireEvent.click(header(/score distribution/i));
    expect(open()).toHaveLength(2);
    expect(screen.getByTestId("globe")).toHaveAttribute("data-fit-padding-left", "0");
  });

  it("in a medium window one panel is open at a time, and the globe leaves the column's room", async () => {
    mockMedia(true);
    await renderMap();
    fireEvent.click(header(/location/i));
    expect(open()).toHaveLength(1);
    fireEvent.click(header(/score distribution/i));
    expect(open()).toHaveLength(1);
    expect(open()[0]).toMatch(/score distribution/i);
    // Opening the open one closes it again.
    fireEvent.click(header(/score distribution/i));
    expect(open()).toEqual([]);
    await act(async () => {});
    // jsdom has no layout (clientWidth 0): the column still reserves its margins.
    expect(Number(screen.getByTestId("globe").getAttribute("data-fit-padding-left"))).toBe(railClearance(0));
  });

  it("puts the four cards in the one .map-panels wrapper the rail CSS targets", async () => {
    mockMedia(false);
    await renderMap();
    const wrapper = document.querySelector(".map-panels") as HTMLElement;
    expect(wrapper.querySelectorAll(":scope > .map-float-card")).toHaveLength(4);
  });
});

describe("rail geometry", () => {
  it("takes at most the card width, and at most 40% of a narrow map", () => {
    expect(railWidth(1200)).toBe(RAIL_CARD_W);
    expect(railWidth(800)).toBe(320);
  });

  it("never lets the column reach the middle of the map in the medium window", () => {
    for (const w of [RAIL_MIN_WIDTH, 900, 1068, RAIL_MAX_WIDTH]) {
      expect(railClearance(w)).toBeLessThan(w / 2 + RAIL_SIDE + 16);
    }
  });

  it("covers a full-screen Mac, where the two bottom corner cards would sit on the controls", () => {
    // Two corner cards (420 px, body zoom 1.15, 24 px margin) and the control
    // bar (~440 px with the remote key) centred between them: the bar starts
    // under the card edge up to ~1440, and clears it by only a few pixels at a
    // 14" Mac's 1512 (card 511 px, bar from 536).
    const cornerEdge = (CORNER_CARD_W + RAIL_SIDE) * 1.15;
    const barHalf = 440 / 2;
    expect(1440 / 2 - barHalf).toBeLessThan(cornerEdge);
    expect(1512).toBeLessThanOrEqual(RAIL_MAX_WIDTH);
    // Above the rail the corners clear the bar with room to spare.
    expect((RAIL_MAX_WIDTH + 1) / 2 - barHalf).toBeGreaterThan(cornerEdge + 50);
  });

  it("is a rail only between the two widths, and a plain wrapper outside", () => {
    expect(RAIL_QUERY).toBe(`(min-width: ${RAIL_MIN_WIDTH}px) and (max-width: ${RAIL_MAX_WIDTH}px)`);
    expect(MAP_PANELS_CSS).toContain(".map-panels { display: contents; }");
    expect(MAP_PANELS_CSS).toContain(`@media ${RAIL_QUERY}`);
    // The column ends above the bottom controls.
    expect(MAP_PANELS_CSS).toContain(`bottom: ${RAIL_BOTTOM}px`);
  });
});

describe("phone layout (390 px)", () => {
  // Under 768 px page.tsx stacks the cards under the globe as flex items of
  // .map-shell. The wrapper added around them must not change that.
  // vitest runs with desktop/ as the working directory.
  const page = readFileSync(
    resolve(process.cwd(), "../web/app/(protected)/map/page.tsx"),
    "utf8",
  );
  const outsideMedia = MAP_PANELS_CSS.replace(/@media[^{]*\{[\s\S]*\}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  it("leaves only «display: contents» for the wrapper outside the rail query, so the cards stay flex items of the shell", () => {
    expect(outsideMedia).toBe(".map-panels { display: contents; }");
  });

  it("starts the rail exactly where the phone stack ends, with no width in both and none in neither", () => {
    expect(page).toContain(`@media (max-width: ${RAIL_MIN_WIDTH - 1}px)`);
    expect(page).toContain("${MAP_PANELS_CSS}");
  });
});
