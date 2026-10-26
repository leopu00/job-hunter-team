import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EFFORTS, MODEL_CLASSES, ROLES, WEEKDAYS } from "../../lib/team-settings-native";
import WorkHoursPage from "./index";

// The page checks the hours before it sends them. The real picker only builds valid hours, so a stand-in
// picker hands the page's save a value off the closed shape. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@/app/components/WorkHoursPicker", async () => {
  const { useState } = await import("react");
  return {
    default: ({ cloud }: { cloud: { save: (next: unknown) => Promise<string | null> } }) => {
      const [answer, setAnswer] = useState("none yet");
      const send = (hours: unknown) => async () => setAnswer(String(await cloud.save(hours)));
      return (
        <div>
          <button type="button" onClick={send({ timezone: "UTC", windows: [{ days: ["mon"], start: "25:00", end: "18:00" }] })}>
            save-bad
          </button>
          <button type="button" onClick={send({ timezone: "UTC", windows: [{ days: ["mon"], start: "09:00", end: "18:00" }] })}>
            save-good
          </button>
          <p data-testid="answer">{answer}</p>
        </div>
      );
    },
  };
});

const props = { params: {}, search: new URLSearchParams() };
const reply = (fields: Record<string, unknown> = {}) => ({
  ok: true,
  target: "local",
  connectionKey: "key-1",
  working_hours: null,
  role_models: {},
  lists: { roles: [...ROLES], models: [...MODEL_CLASSES], efforts: [...EFFORTS], weekdays: [...WEEKDAYS], min_window_hours: 4 },
  ...fields,
});
const requests = () => native.invoke.mock.calls.map(([, args]) => (args as { request: { op: string } }).request.op);

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en; path=/";
  localStorage.setItem("jht-lang", "en");
  native.invoke.mockReset();
  native.invoke.mockImplementation(async () => reply());
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("hours off the closed shape", () => {
  it("are refused with their reason before anything is sent to the team", async () => {
    const user = userEvent.setup();
    render(<WorkHoursPage {...props} />);
    await user.click(await screen.findByRole("button", { name: "save-bad" }));
    await waitFor(() => expect(screen.getByTestId("answer")).toHaveTextContent("not one of the allowed ones"));
    expect(requests()).toEqual(["read"]);
  });

  it("while valid ones go through", async () => {
    const user = userEvent.setup();
    render(<WorkHoursPage {...props} />);
    await user.click(await screen.findByRole("button", { name: "save-good" }));
    await waitFor(() => expect(requests()).toEqual(["read", "write"]));
    expect(screen.getByTestId("answer")).toHaveTextContent("null");
  });
});
