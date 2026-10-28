import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAuthStorageProbe } from "../../lib/auth-storage-lock";
import { forgetReadsInFlight, PAGE_READ_DEADLINE_MS, READ_IN_FLIGHT_MAX_MS } from "../../lib/read-deadline";
import { SwipePage } from ".";
import { loadSwipe } from "./load-swipe";

// A deck whose data never arrives ends in a message with a button, not in a skeleton that stays; a
// profile with no sign-in is told where the data comes from. Synthetic data only.
vi.mock("@/app/(protected)/swipe/SwipeDeck", () => ({ default: () => <p>swipe-deck</p> }));
vi.mock("../../shell/router", () => ({ useRefresh: vi.fn() }));
vi.mock("./load-swipe", () => ({ loadSwipe: vi.fn() }));

const DECK = { pendingCards: [], reviewedCards: [], initialVerdicts: {}, salaryAxisMaxK: 100 };

beforeEach(() => {
  forgetReadsInFlight();
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
    // the read that never answered is not waited for beyond the window: the button starts a new one
    await act(async () => { await vi.advanceTimersByTimeAsync(READ_IN_FLIGHT_MAX_MS - PAGE_READ_DEADLINE_MS); });
    await act(async () => { screen.getByRole("button", { name: "Riprova" }).click(); });
    await act(async () => undefined);
    expect(screen.getByText("swipe-deck")).toBeInTheDocument();
  });

  it("is the line that says the data comes from the cloud, and no deck, for a profile with no sign-in", async () => {
    registerAuthStorageProbe(() => false);
    vi.mocked(loadSwipe).mockResolvedValueOnce(DECK as never);
    render(<SwipePage client={{} as never} />);
    await act(async () => undefined);
    expect(screen.getByRole("note")).toHaveTextContent("Questi dati arrivano dal cloud");
    expect(screen.queryByText("swipe-deck")).not.toBeInTheDocument();
  });

  it("shows the deck, and no line, with a cloud session", async () => {
    vi.mocked(loadSwipe).mockResolvedValueOnce(DECK as never);
    render(<SwipePage client={{} as never} />);
    await act(async () => undefined);
    expect(screen.getByText("swipe-deck")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
