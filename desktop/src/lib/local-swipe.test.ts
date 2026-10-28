import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetLocalDeck, getSwipeDecksLocal, LocalSwipeError, localDeckToken } from "./local-swipe";
import { setLocalTeamData, useLocalTeamStopped } from "./local-team-data";

// The Swipe of a local profile reads its decks from the team on this computer, and keeps the token the deck
// came with for the verdict that follows. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id, status: "scored", title: `Role ${id}`, company: "Acme", url: "https://jobs.example.com/x", score: 80,
  salary_declared_min: null, salary_declared_max: null, salary_declared_currency: null,
  salary_estimated_min: 30000, salary_estimated_max: 40000, salary_estimated_currency: "USD", ...extra,
});

beforeEach(() => {
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  setLocalTeamData("local:abc");
});
afterEach(() => {
  forgetLocalDeck();
  setLocalTeamData(null);
});

describe("getSwipeDecksLocal", () => {
  it("asks the one native command, maps the rows to cards and keeps the token for the verdict", async () => {
    native.invoke.mockResolvedValue({
      ok: true, token: "deck-token-one",
      pending: [row(7), row(8, { salary_declared_min: 50000, salary_declared_max: 60000, salary_declared_currency: "EUR" })],
      reviewed: [{ row: row(9), action: "like", fbScore: 4 }, { row: row(10), action: "dislike", fbScore: null }],
    });
    const decks = await getSwipeDecksLocal();
    expect(native.invoke.mock.calls).toEqual([["local_swipe_deck_read"]]);
    expect(["7", "8", "9", "10"].map((id) => localDeckToken(id))).toEqual(Array(4).fill("deck-token-one"));
    expect(localDeckToken("99")).toBeNull();
    // the number in the team's database is the card's key for the routes
    expect(decks.pending[0]).toMatchObject({ id: "7", legacy_id: 7, score: 80, salary_min: 30000, salary_currency: "USD" });
    // a declared salary is preferred to an estimated one, as the web's deck does
    expect(decks.pending[1]).toMatchObject({ salary_min: 50000, salary_max: 60000, salary_currency: "EUR" });
    expect(decks.reviewed.map((r) => [r.position.legacy_id, r.action, r.fb_score])).toEqual([[9, "like", 4], [10, "dislike", null]]);
  });

  it("forgets the token of the last deck before it reads again, and keeps none for a read that failed", async () => {
    native.invoke.mockResolvedValueOnce({ ok: true, token: "deck-token-two", pending: [row(7)], reviewed: [] });
    await getSwipeDecksLocal();
    expect(localDeckToken("7")).toBe("deck-token-two");
    native.invoke.mockResolvedValueOnce({ ok: false, error: "local_account_owner_mismatch" });
    await expect(getSwipeDecksLocal()).rejects.toMatchObject({ code: "local_account_owner_mismatch" });
    expect(localDeckToken("7")).toBeNull();
  });

  it("throws the closed code of a refusal and a bad reply as such, and tells the bar when the team is off", async () => {
    const stopped = renderHook(() => useLocalTeamStopped());
    native.invoke.mockResolvedValueOnce({ ok: false, error: "local_team_not_running" });
    await expect(getSwipeDecksLocal()).rejects.toBeInstanceOf(LocalSwipeError);
    await vi.waitFor(() => expect(stopped.result.current).toBe(true));
    for (const bad of [null, "x", { ok: true }, { ok: true, token: 1, pending: [], reviewed: [] }, { ok: false, error: "No Way!" }]) {
      native.invoke.mockResolvedValueOnce(bad);
      await expect(getSwipeDecksLocal()).rejects.toMatchObject({ code: "desktop_bad_reply" });
    }
    native.invoke.mockRejectedValueOnce(new Error("boom"));
    await expect(getSwipeDecksLocal()).rejects.toMatchObject({ code: "desktop_transport_unavailable" });
    native.invoke.mockResolvedValueOnce({ ok: true, token: "deck-token-two", pending: [], reviewed: [] });
    await getSwipeDecksLocal();
    await vi.waitFor(() => expect(stopped.result.current).toBe(false));
  });

  it("does not ask the native side outside the desktop", async () => {
    native.isTauri.mockReturnValue(false);
    await expect(getSwipeDecksLocal()).rejects.toMatchObject({ code: "desktop_transport_unavailable" });
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
