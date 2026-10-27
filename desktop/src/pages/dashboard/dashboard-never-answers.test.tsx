import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_READ_DEADLINE_MS } from "../../lib/read-deadline";
import DashboardPage from "./index";
import { loadDashboard } from "./load-dashboard";

// A dashboard whose data never arrives ends in a message with a button, not in a skeleton that stays
// (the cloud client of a local profile waited on a locked session for ever). Synthetic data only.
vi.mock("../../lib/supabase", () => ({ supabase: {}, supabaseConfigured: true, signOut: vi.fn() }));
vi.mock("../../shell/router", () => ({ useRefresh: vi.fn() }));
vi.mock("./DashboardScreen", () => ({ default: () => <p>dashboard-screen</p> }));
vi.mock("./load-dashboard", () => ({ loadDashboard: vi.fn() }));

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the dashboard whose data never arrives", () => {
  it("says it could not be read after the deadline, and the button reads it again", async () => {
    vi.mocked(loadDashboard)
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce({} as never);
    render(<DashboardPage params={{}} search={new URLSearchParams()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(PAGE_READ_DEADLINE_MS); });
    expect(screen.getByRole("alert")).toHaveTextContent("Non riesco a leggere la dashboard");
    await act(async () => { screen.getByRole("button", { name: "Aggiorna" }).click(); });
    await act(async () => undefined);
    expect(screen.getByText("dashboard-screen")).toBeInTheDocument();
  });
});
