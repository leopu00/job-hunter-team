import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAuthStorageProbe } from "../../lib/auth-storage-lock";
import { PAGE_READ_DEADLINE_MS } from "../../lib/read-deadline";
import { SwipePage } from ".";
import { loadSwipe } from "./load-swipe";

// A deck whose data never arrives ends in a message with a button, not in a skeleton that stays; a
// profile with no sign-in is told where the data comes from. Synthetic data only.
vi.mock("@/app/(protected)/swipe/SwipeDeck", () => ({ default: () => <p>swipe-deck</p> }));
vi.mock("../../shell/router", () => ({ useRefresh: vi.fn() }));
vi.mock("./load-swipe", () => ({ loadSwipe: vi.fn() }));

const DECK = { pendingCards: [], reviewedCards: [], initialVerdicts: {}, salaryAxisMaxK: 100 };

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  registerAuthStorageProbe(() => true);
});

describe("the swipe page whose data never arrives", () => {
  it("says it could not be read after the deadline, and the button reads it again", async () => {
    vi.mocked(loadSwipe)
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce(DECK as never);
    render(<SwipePage client={{} as never} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(PAGE_READ_DEADLINE_MS); });
    expect(screen.getByRole("alert")).toHaveTextContent("Non riesco a leggere le posizioni da giudicare");
    await act(async () => { screen.getByRole("button", { name: "Aggiorna" }).click(); });
    await act(async () => undefined);
    expect(screen.getByText("swipe-deck")).toBeInTheDocument();
  });

  it("opens with the line that says the data comes from the cloud, for a profile with no sign-in", async () => {
    registerAuthStorageProbe(() => false);
    vi.mocked(loadSwipe).mockResolvedValueOnce(DECK as never);
    render(<SwipePage client={{} as never} />);
    await act(async () => undefined);
    expect(screen.getByText("swipe-deck")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Questi dati arrivano dal cloud");
  });
});
