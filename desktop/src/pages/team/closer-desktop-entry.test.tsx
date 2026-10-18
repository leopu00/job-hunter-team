import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
