import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NAVIGATE_EVENT } from "../web-shims/next-link";
import DashboardScreen from "./DashboardScreen";
import { fixtureData } from "./dashboard-fixture";

describe("DashboardScreen", () => {
  it("draws the web dashboard blocks from the data", () => {
    render(<DashboardScreen data={fixtureData()} locale="it" />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("12 posizioni totali · 1 escluse · 11 attive")).toBeInTheDocument();
    expect(screen.getByText("Le Ultime Posizioni Valutate")).toBeInTheDocument();
    // The latest-scored table and the linked charts' table both list positions.
    expect(screen.getAllByText("Ruolo sintetico 11").length).toBeGreaterThan(0);
  });

  it("shows the applications timeline only when something was sent", () => {
    const { rerender } = render(<DashboardScreen data={fixtureData()} locale="it" />);
    expect(screen.getByText("Candidature inviate")).toBeInTheDocument();
    rerender(<DashboardScreen data={fixtureData({ applicationEvents: [] })} locale="it" />);
    expect(screen.queryByText("Candidature inviate")).not.toBeInTheDocument();
  });

  it("keeps a click on a position inside the app", () => {
    const onNavigate = vi.fn();
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    render(<DashboardScreen data={fixtureData()} locale="it" />);
    const link = screen.getAllByRole("link", { name: /Ruolo sintetico 11/ })[0];
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect((onNavigate.mock.calls[0][0] as CustomEvent).detail).toEqual({ href: "/positions/pos-11" });
    window.removeEventListener(NAVIGATE_EVENT, onNavigate);
  });
});
