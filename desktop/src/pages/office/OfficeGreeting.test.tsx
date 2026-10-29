import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OfficeGreeting from "./OfficeGreeting";

const read = vi.hoisted(() => ({ reading: vi.fn() }));
vi.mock("../../profile-progress/read", () => ({ readProfileProgress: read.reading }));

const fields = (name: { ok: boolean; preview?: string }) => ({
  ok: true,
  reading: {
    required: 8,
    done: name.ok ? 1 : 0,
    ready: false,
    fields: ["name", "email", "target_role", "location", "experience_years", "seniority_target", "skills", "languages"].map((key) =>
      key === "name" ? { key, ...name } : { key, ok: false }),
  },
});
const at = (hour: number) => () => new Date(2026, 9, 29, hour, 0, 0);

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  read.reading.mockReset();
});
afterEach(cleanup);

describe("OfficeGreeting", () => {
  it("greets by the first name the profile holds, by the hour", async () => {
    read.reading.mockResolvedValue(fields({ ok: true, preview: "Leone Puglisi" }));
    render(<OfficeGreeting now={at(9)} />);
    expect((await screen.findByTestId("office-greeting")).textContent).toBe("Buongiorno, Leone");
  });

  it("says nothing while the profile has no name yet", async () => {
    read.reading.mockResolvedValue(fields({ ok: false }));
    render(<OfficeGreeting now={at(9)} />);
    await waitFor(() => expect(read.reading).toHaveBeenCalled());
    expect(screen.queryByTestId("office-greeting")).toBeNull();
  });

  it("says nothing when the profile cannot be read", async () => {
    read.reading.mockResolvedValue({ ok: false, code: "unavailable" });
    render(<OfficeGreeting now={at(20)} />);
    await waitFor(() => expect(read.reading).toHaveBeenCalled());
    expect(screen.queryByTestId("office-greeting")).toBeNull();
  });

  it("never shows an address as a name", async () => {
    read.reading.mockResolvedValue(fields({ ok: true, preview: "ada@example.invalid" }));
    render(<OfficeGreeting now={at(9)} />);
    await waitFor(() => expect(read.reading).toHaveBeenCalled());
    expect(screen.queryByTestId("office-greeting")).toBeNull();
  });
});
