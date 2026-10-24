import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import { EFFORTS, MODEL_CLASSES, ROLES, WEEKDAYS } from "../../lib/team-settings-native";
import TeamSettingsPage from "./index";
import { TEAM_SETTINGS_TEXT } from "./team-settings.i18n";

// «Team: hours and models» against a stand-in native side (team_settings). Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const props = { params: {}, search: new URLSearchParams() };
const KEY = "key-1";
const reply = (fields: Record<string, unknown> = {}) => ({
  ok: true,
  target: "local",
  connectionKey: KEY,
  working_hours: null,
  role_models: { capitano: { model: "terra" } },
  lists: { roles: [...ROLES], models: [...MODEL_CLASSES], efforts: [...EFFORTS], weekdays: [...WEEKDAYS], min_window_hours: 4 },
  ...fields,
});
const calls = () => native.invoke.mock.calls.filter(([command]) => command === "team_settings").map(([, args]) => (args as { request: Record<string, unknown> }).request);

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

describe("the team's hours and models page", () => {
  it("reads the team's settings and says whose they are", async () => {
    render(<TeamSettingsPage {...props} />);
    expect(await screen.findByTestId("team-settings-intro")).toHaveTextContent("for the team on this computer");
    expect(calls()).toEqual([{ op: "read" }]);
    // the roles as the team holds them, the model as a generic label and never as the class
    const capitano = screen.getByRole("combobox", { name: /Captain: Model/i });
    expect(screen.getAllByRole("combobox", { name: /: / })).toHaveLength(ROLES.length * 2);
    const models = screen.getAllByRole("combobox", { name: /Model/i });
    expect(models[0]).toHaveValue("terra");
    expect(within(models[0]).getByRole("option", { name: "Balanced" })).toBeInTheDocument();
    expect(within(models[0]).getByRole("option", { name: "Maximum" })).toBeInTheDocument();
    expect(within(models[0]).getByRole("option", { name: "Economy" })).toBeInTheDocument();
    expect(within(models[0]).queryByRole("option", { name: "terra" })).toBeNull();
    expect(capitano).toBeInTheDocument();
    cleanup();
    native.invoke.mockImplementation(async () => reply({ target: "vps" }));
    render(<TeamSettingsPage {...props} />);
    expect(await screen.findByTestId("team-settings-intro")).toHaveTextContent("for the team on the VPS");
  });

  it("does not tell the person the preview needs an active container, which is not true here", async () => {
    // the picker says it only when the team has hours set and no preview came
    native.invoke.mockImplementation(async () =>
      reply({ working_hours: { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }] } }),
    );
    render(<TeamSettingsPage {...props} />);
    // the picker has read the hours (its weekly distribution is drawn) before the note could show
    await waitFor(() => expect(screen.getAllByText("Mon").length).toBeGreaterThan(0));
    expect(screen.queryByText(/Preview available only/)).toBeNull();
  });

  it("sends only the role that changed with the key the read gave, and shows what the team answers", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementation(async (_command: string, args: { request: Record<string, unknown> }) =>
      args.request.op === "read" ? reply() : reply({ role_models: { capitano: { model: "terra" }, scout: { model: "sol", effort: "high" } } }),
    );
    render(<TeamSettingsPage {...props} />);
    await screen.findByTestId("team-settings-models");
    const save = screen.getByTestId("team-settings-models-save");
    expect(save).toBeDisabled();
    const models = screen.getAllByRole("combobox", { name: /Model/i });
    await user.selectOptions(models[1], "sol"); // scout
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(calls()).toHaveLength(2));
    const write = calls()[1] as { op: string; connectionKey: string; settings: { role_models: Record<string, unknown> } };
    expect(write.op).toBe("write");
    expect(write.connectionKey).toBe(KEY);
    expect(Object.keys(write.settings)).toEqual(["role_models"]);
    // the role already set stays as it was; the one changed carries its new class, never a label
    expect(write.settings.role_models).toEqual({ capitano: { model: "terra" }, scout: { model: "sol" } });
    // the form shows the answer read back, not what was sent
    await waitFor(() => expect(screen.getAllByRole("combobox", { name: /Model/i })[1]).toHaveValue("sol"));
    expect(screen.getAllByRole("combobox", { name: /Effort/i })[1]).toHaveValue("high");
    expect(screen.getByTestId("team-settings-models-save")).toBeDisabled();
  });

  it("puts a role back on the default with an empty entry", async () => {
    const user = userEvent.setup();
    render(<TeamSettingsPage {...props} />);
    await screen.findByTestId("team-settings-models");
    await user.selectOptions(screen.getAllByRole("combobox", { name: /Model/i })[0], "");
    await user.click(screen.getByTestId("team-settings-models-save"));
    await waitFor(() => expect(calls()).toHaveLength(2));
    expect((calls()[1].settings as { role_models: unknown }).role_models).toEqual({ capitano: {} });
  });

  it("keeps the edits and says why when the team refuses", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementation(async (_command: string, args: { request: Record<string, unknown> }) =>
      args.request.op === "read" ? reply({ target: "vps" }) : { ok: false, error: "team_settings_read_only" },
    );
    render(<TeamSettingsPage {...props} />);
    await screen.findByTestId("team-settings-models");
    await user.selectOptions(screen.getAllByRole("combobox", { name: /Model/i })[1], "luna");
    await user.click(screen.getByTestId("team-settings-models-save"));
    expect(await screen.findByTestId("team-settings-models-problem")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: /Model/i })[1]).toHaveValue("luna");
    expect(screen.getByTestId("team-settings-models-save")).toBeEnabled();
  });

  it("asks the team for the hours of a preset, and shows the hours it answers", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementation(async (_command: string, args: { request: Record<string, unknown> }) =>
      args.request.op === "read"
        ? reply()
        : reply({ working_hours: { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }] } }),
    );
    render(<TeamSettingsPage {...props} />);
    await user.click(await screen.findByRole("button", { name: /Office \(Mon-Fri 9-18\)/ }));
    await waitFor(() => expect(calls()).toHaveLength(2));
    const write = calls()[1] as { settings: { working_hours: { windows: unknown } } };
    expect(Object.keys(write.settings)).toEqual(["working_hours"]);
    expect(write.settings.working_hours.windows).toEqual([{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }]);
  });

  it("says it cannot read the settings, and reads again on request", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementationOnce(async () => ({ ok: false, error: "existing_team_runtime_outdated" }));
    render(<TeamSettingsPage {...props} />);
    const failed = await screen.findByTestId("team-settings-failed");
    expect(failed).toHaveTextContent("Cannot read the team's settings.");
    await user.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("team-settings-models")).toBeInTheDocument();
  });

  it("has every language's words, with the three classes apart", () => {
    for (const [locale, text] of Object.entries(TEAM_SETTINGS_TEXT) as [Locale, (typeof TEAM_SETTINGS_TEXT)[Locale]][]) {
      for (const [key, value] of Object.entries(text)) expect(value.trim().length, `${locale} ${key}`).toBeGreaterThan(1);
      expect(new Set([text.classSol, text.classTerra, text.classLuna]).size, locale).toBe(3);
    }
    expect(Object.keys(TEAM_SETTINGS_TEXT).sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
    expect(TEAM_SETTINGS_TEXT.it.classSol).toBe("Massima");
  });
});
