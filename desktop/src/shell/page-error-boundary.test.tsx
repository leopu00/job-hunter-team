import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { currentLocation, navigate } from "./router";
import Shell from "./Shell";
import PageErrorBoundary from "./PageErrorBoundary";
import { PAGE_ERROR_TEXT } from "./page-error.i18n";

// A page that breaks while it is drawn takes only itself away: the navbar and the other pages stay. The office is
// the broken one here (a reply it did not expect), the map the one that works.
const page = vi.hoisted(() => ({ broken: true }));
vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() }, supabaseConfigured: true, signOut: vi.fn() }));
vi.mock("../pages/map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../pages/office", () => ({
  default: () => {
    if (page.broken) throw new TypeError("Cannot read properties of null (reading 'map')");
    return <h1>Ufficio</h1>;
  },
}));

const T = PAGE_ERROR_TEXT.it;
let restore: () => void;
beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  page.broken = true;
  restore = installApiBridge(shellApi(notInDesktop));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  restore();
  vi.restoreAllMocks();
});

describe("a page that breaks while it is drawn", () => {
  it("is replaced by a sentence, and the navbar and the other pages stay", async () => {
    navigate("/office", { replace: true });
    render(<Shell />);
    expect(await screen.findByTestId("page-error")).toHaveTextContent(T.title);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    // the other page is one click away, and it works
    act(() => navigate("/map"));
    expect(await screen.findByRole("heading", { name: "Mappa" })).toBeInTheDocument();
    expect(screen.queryByTestId("page-error")).toBeNull();
  });

  it("«Riprova» draws the page again, and it shows when the cause has gone", async () => {
    navigate("/office", { replace: true });
    render(<Shell />);
    await screen.findByTestId("page-error");
    page.broken = false;
    await userEvent.click(screen.getByTestId("page-error-retry"));
    expect(await screen.findByRole("heading", { name: "Ufficio" })).toBeInTheDocument();
    expect(screen.queryByTestId("page-error")).toBeNull();
  });

  it("«Vai alla dashboard» goes there", async () => {
    navigate("/office", { replace: true });
    render(<Shell />);
    await userEvent.click(await screen.findByTestId("page-error-home"));
    expect(currentLocation().path).toBe("/dashboard");
  });

  it("shows nothing of what failed on the page, and logs of its own only the kind of error (React's own log is its business)", async () => {
    navigate("/office", { replace: true });
    render(<Shell />);
    const alert = await screen.findByTestId("page-error");
    expect(alert.textContent).not.toMatch(/Cannot read|null|map/);
    const ours = vi.mocked(console.error).mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[page]"));
    expect(ours).toEqual(["[page] render failed: TypeError"]);
  });
});

describe("the boundary on its own", () => {
  it("passes a page that works through untouched", () => {
    render(<PageErrorBoundary onHome={() => undefined}><p>fine</p></PageErrorBoundary>);
    expect(screen.getByText("fine")).toBeInTheDocument();
    expect(screen.queryByTestId("page-error")).toBeNull();
  });

  it("says its words in every language", () => {
    const keys = Object.keys(PAGE_ERROR_TEXT.en).sort();
    for (const locale of locales) {
      expect(Object.keys(PAGE_ERROR_TEXT[locale]).sort(), locale).toEqual(keys);
      for (const key of keys) expect(PAGE_ERROR_TEXT[locale][key as keyof typeof PAGE_ERROR_TEXT.en].trim(), `${locale}.${key}`).not.toBe("");
    }
  });
});
