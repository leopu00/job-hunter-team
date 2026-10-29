import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MobileTeamStatus from "@/app/(protected)/team/MobileTeamStatus";
import TeamPage from "./index";

// The Team page's status card: on the desktop the team's pause and stop live
// in the agents' panel, so the card links there instead of stopping the team.
// The web's own card (no controls given) keeps its stop: see the last test.
vi.mock("@/app/(protected)/team/loading", () => ({ default: () => <p>Team loading</p> }));
vi.mock("@/app/(protected)/team/page", async () => {
  const { default: Card } = await import("@/app/(protected)/team/MobileTeamStatus");
  return { default: () => <Card /> };
});
vi.mock("../../shell/server-page", () => ({ default: ({ render }: { render: () => ReactNode }) => render() }));
vi.mock("../../closer-desktop/CloserDesktopPanel", () => ({ default: () => null }));

const STATE = {
  should_run: true,
  is_running: true,
  last_heartbeat_at: new Date().toISOString(),
  last_action: null,
  last_action_at: null,
  last_error: null,
  last_error_at: null,
  emergency_stop_requested_at: null,
  emergency_stop_completed_at: null,
};

beforeEach(() => {
  localStorage.setItem("jht-lang", "it");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ state: STATE }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("links the status card to the agents' panel, and has no stop of its own", async () => {
  render(<TeamPage params={{}} search={new URLSearchParams()} />);
  const link = await screen.findByRole("button", { name: "Pausa e stop della squadra →" });
  expect(screen.getByTestId("team-controls-link")).toHaveTextContent("Si comandano dal Pannello Agenti.");
  expect(screen.queryByRole("button", { name: /Stop d'emergenza/ })).toBeNull();
  fireEvent.click(link);
  expect(window.location.hash).toBe("#/agents");
});

it("leaves the web's card as it was when no controls are given", async () => {
  render(<MobileTeamStatus />);
  expect(await screen.findByRole("button", { name: /Stop d'emergenza/ })).toBeInTheDocument();
  expect(screen.queryByTestId("team-controls-link")).toBeNull();
});

it("while the status is being read the card says so in words, never a bare «…»", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
  render(<MobileTeamStatus />);
  expect(screen.getByText("Controllo in corso…")).toBeInTheDocument();
  expect(screen.queryByText("…")).toBeNull();
});
