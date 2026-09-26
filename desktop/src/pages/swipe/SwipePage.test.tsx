import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "../../test-support/fake-supabase";
import { SwipePage } from ".";
import { loadSwipe, readDisplayCurrency } from "./load-swipe";

// Dati sintetici: nessuna posizione vera.
const PENDING = {
  id: "p-1",
  legacy_id: 101,
  title: "Sviluppatrice di prova",
  company: "Azienda Esempio",
  location: "Città Esempio",
  remote_type: "hybrid",
  salary_declared_min: 40000,
  salary_declared_max: 50000,
  salary_declared_currency: "EUR",
  salary_estimated_min: null,
  salary_estimated_max: null,
  salary_estimated_currency: null,
  url: null,
  source: "example",
  found_at: "2026-09-01T10:00:00Z",
  status: "scored",
  role_family: "engineering",
  loc_country: "IT",
  loc_city: "Città Esempio",
  scores: [{ total_score: 82 }],
};
const REVIEWED = { ...PENDING, id: "p-2", legacy_id: 102, title: "Posizione già vista", scores: null };

function respond(query: FakeQuery) {
  if (query.table === "positions") return { data: [PENDING, REVIEWED], error: null };
  if (query.table === "position_feedback")
    return { data: [{ position_legacy_id: 102, action: "like", score: 5, created_at: "2026-09-02" }], error: null };
  return { data: null, error: null };
}

beforeEach(() => {
  // Niente rete nei test: i tassi di cambio ripiegano sui valori fissi del web.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSwipe", () => {
  it("splits the decks like the web and builds the cards the deck needs", async () => {
    const { client, queries } = fakeSupabase(respond);
    const deck = await loadSwipe(client, {
      decks: (await import("@/lib/swipe-decks")).getSwipeDecksCloud,
      rates: async () => ({ EUR: 1 }),
      displayCurrency: () => "EUR",
    });
    expect(deck.pendingCards.map((c) => c.id)).toEqual(["p-1"]);
    expect(deck.reviewedCards.map((c) => c.id)).toEqual(["p-2"]);
    expect(deck.initialVerdicts).toEqual({ "p-2": "top" });
    expect(deck.pendingCards[0]).toMatchObject({ score: 82, salary_min: 40000, salary_currency: "EUR" });
    const positions = queries.find((q) => q.table === "positions")!;
    expect(positions.ops).toContainEqual(["in", ["status", ["scored", "ready", "excluded"]]]);
  });

  it("reads the display currency from the web's cookie", () => {
    expect(readDisplayCurrency("a=1; jht_display_currency=usd")).toBe("USD");
    expect(readDisplayCurrency("jht_display_currency=XXX")).toBe("EUR");
    expect(readDisplayCurrency("")).toBe("EUR");
  });
});

describe("SwipePage", () => {
  it("shows the web's deck with the first card to judge", async () => {
    const { client } = fakeSupabase(respond);
    render(<SwipePage client={client} />);
    expect(screen.getByRole("status")).toHaveTextContent("Caricamento");
    expect(await screen.findByText("Sviluppatrice di prova")).toBeInTheDocument();
  });

  it("says so when the positions cannot be read", async () => {
    const { client } = fakeSupabase(() => ({ data: null, error: { message: "offline" } }));
    const failing = { ...client, from: () => { throw new Error("offline"); } } as unknown as typeof client;
    render(<SwipePage client={failing} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Non riesco a leggere");
  });
});
