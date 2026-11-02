import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { TeamControlState } from "../../lib/agent-control";
import { EFFORTS, MODEL_CLASSES, ROLES, WEEKDAYS } from "../../lib/team-settings-native";
import { ROUTES } from "../../shell/routes";
import TeamCard from "./TeamCard";

// «Work flat out until a time» is findable in Settings → Team, under the budget: that is where people
// look for it (it was on the hours page and in the agents' panel only, and was not found). Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const reply = (fields: Record<string, unknown> = {}) => ({
  ok: true,
  target: "local",
  connectionKey: "key-1",
  working_hours: null,
  role_models: {},
  lists: { roles: [...ROLES], models: [...MODEL_CLASSES], efforts: [...EFFORTS], weekdays: [...WEEKDAYS], min_window_hours: 4 },
  ...fields,
});
const state = (): TeamControlState => ({
  halted: false,
  standby: { state: "off", until: null, weeklyReset: false },
  held: null,
  burnIntent: { state: "off", expiresAt: null, remainingMin: null },
});
const read = async () => ({ ok: true as const, at: 1, value: state() });
const requests = () => native.invoke.mock.calls.filter(([command]) => command === "team_settings").map(([, args]) => (args as { request: Record<string, unknown> }).request);

beforeEach(() => {
  localStorage.setItem("jht-lang", "it");
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (_command: string, args: { request: Record<string, unknown> }) =>
    args.request.op === "burst_start" ? reply({ burst: { active: true, until: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d+Z$/, "+00:00"), untilLocal: "03:00" } }) : reply({ burst: { active: false } }),
  );
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
  window.location.hash = "";
});

describe("«Lavora a tutta» in the team card of Settings", () => {
  it("sits under the budget, with its title, and starts from there", async () => {
    const budget = { path: "/budget", page: () => null };
    ROUTES.push(budget);
    onTestFinished(() => void ROUTES.splice(ROUTES.indexOf(budget), 1));
    render(<TeamCard readOnly={false} read={read} />);
    const card = screen.getByTestId("settings-team");
    const start = await screen.findByTestId("burst-start");
    expect(card).toContainElement(start);
    expect(card).toHaveTextContent("A tutta, fino a un’ora");
    // after the budget link, in the same card
    expect(screen.getByTestId("settings-budget-link").compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("burst-time"), "03:00");
    await user.click(start);
    expect(await screen.findByTestId("burst-active")).toHaveTextContent("A tutta fino alle 03:00");
    expect(requests().at(-1)).toEqual({ op: "burst_start", until: "03:00", connectionKey: "key-1" });
  });

  it("is not there on a team that is only read: it writes to the team", async () => {
    render(<TeamCard readOnly read={read} />);
    await screen.findByTestId("settings-agents-link");
    expect(screen.queryByTestId("burst")).toBeNull();
    expect(requests()).toEqual([]);
  });
});
