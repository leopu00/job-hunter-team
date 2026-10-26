import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";

// An empty list used to say why in 11px of dim text and stop. It now says it and offers the way on.
// Synthetic data only.
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
}));

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=en; path=/";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not_in_desktop" }), { status: 404 })));
});
afterEach(() => vi.unstubAllGlobals());

async function renderEmpty(searchParams: Record<string, string>) {
  const { default: WebPositionsPage } = await import("@/app/(protected)/positions/page");
  return render(await WebPositionsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("the empty positions list", () => {
  it("with no filter says the team has found nothing yet, and offers the dashboard, in the table and in the list", async () => {
    fake.current!.rows.positions = [];
    await renderEmpty({});
    expect(screen.getAllByText(/the team has not found any positions with a score yet/)).toHaveLength(2);
    const actions = screen.getAllByTestId("positions-empty-action");
    expect(actions).toHaveLength(2);
    for (const action of actions) {
      expect(action).toHaveTextContent("Go to the dashboard");
      expect(action).toHaveAttribute("href", expect.stringContaining("/dashboard"));
    }
  });

  it("with a filter on says nothing matches, and offers to clear the filters", async () => {
    fake.current!.rows.positions = [];
    await renderEmpty({ q: "nothing-like-this" });
    expect(screen.getAllByText("No positions found with these filters.")).toHaveLength(2);
    for (const action of screen.getAllByTestId("positions-empty-action")) {
      expect(action).toHaveTextContent("Clear the filters");
      expect(action).toHaveAttribute("href", expect.stringMatching(/\/positions$/));
    }
  });

  it("has both actions in every language", async () => {
    const { default: texts } = await import("@/app/(protected)/positions/page.i18n").then((m) => ({ default: m.T }));
    for (const key of ["no_positions_clear", "no_positions_dashboard"] as const) {
      for (const lang of ["it", "en", "de", "fr", "es", "pt", "hu"] as const) {
        expect(texts[key][lang]?.length, `${key} ${lang}`).toBeGreaterThan(6);
      }
    }
  });
});
