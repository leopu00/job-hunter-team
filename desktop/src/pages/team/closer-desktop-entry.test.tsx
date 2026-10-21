import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import TeamPage from "./index";

vi.mock("@/app/(protected)/team/loading", () => ({ default: () => <p>Team loading</p> }));
vi.mock("@/app/(protected)/team/page", () => ({ default: () => <p>Existing team</p> }));
vi.mock("../../shell/server-page", () => ({ default: () => <p>Existing team</p> }));
vi.mock("../../closer-desktop/CloserDesktopPanel", () => ({ default: ({ onClose }: { onClose: () => void }) =>
  <section aria-label="Native frame panel"><button onClick={onClose}>Close native panel</button></section> }));
afterEach(() => { cleanup(); localStorage.clear(); });

it("opens the assisted browser inside Team while preserving the existing team view", () => {
  localStorage.setItem("jht-lang", "en");
  render(<TeamPage params={{}} search={new URLSearchParams()} />);
  expect(screen.getByText("Existing team")).toBeInTheDocument();
  const open = screen.getByRole("button", { name: "Open assisted browser" });
  expect(open).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(open);
  expect(screen.getByRole("region", { name: "Native frame panel" })).toBeInTheDocument();
  expect(open).toHaveAttribute("aria-expanded", "true");
  expect(screen.queryByRole("link")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close native panel" }));
  expect(screen.queryByRole("region", { name: "Native frame panel" })).toBeNull();
  expect(screen.getByText("Existing team")).toBeInTheDocument();
});

it("puts the entry on the right of the page's first row, out of the flow, not above the breadcrumb", () => {
  localStorage.setItem("jht-lang", "en");
  render(<TeamPage params={{}} search={new URLSearchParams()} />);
  const open = screen.getByRole("button", { name: "Open assisted browser" });
  expect(open.parentElement).toHaveClass("closer-desktop-entry-row");
  // jsdom lays nothing out: the row's rule is read from the stylesheet (the tests run from desktop/)
  const css = readFileSync("src/closer-desktop/closer-desktop.css", "utf-8");
  const row = css.match(/\.closer-desktop-entry-row \{([^}]*)\}/)?.[1] ?? "";
  expect(row).toMatch(/height: 0/);
  expect(row).toMatch(/justify-content: flex-end/);
  expect(row).toMatch(/align-items: flex-start/);
});
