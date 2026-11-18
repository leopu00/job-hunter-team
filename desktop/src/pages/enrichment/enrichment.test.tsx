import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EFFORTS, MODEL_CLASSES, ROLES, WEEKDAYS, pickTeamSettings } from "../../lib/team-settings-native";
import EnrichmentPage, { patchOf } from "./index";
import { ENRICHMENT_TEXT } from "./enrichment.i18n";

// Settings › Team › Enrichments (JHT-T324) against a stand-in native side (team_settings). Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const props = { params: {}, search: new URLSearchParams() };
const KEY = "key-1";
const POLICY = {
  economy: false,
  logo: { enabled: true, min_score: null },
  geocode_pipeline: { enabled: true },
  geocode_missing: { enabled: true, min_score: null, non_remote_only: true },
  recheck_weekly: { enabled: true, min_score: 70, older_than_days: 14 },
};
const reply = (fields: Record<string, unknown> = {}) => ({
  ok: true,
  target: "local",
  connectionKey: KEY,
  working_hours: null,
  role_models: {},
  lists: { roles: [...ROLES], models: [...MODEL_CLASSES], efforts: [...EFFORTS], weekdays: [...WEEKDAYS], min_window_hours: 4 },
  enrichment: { policy: POLICY, mode: "search" },
  ...fields,
});
const calls = () => native.invoke.mock.calls.filter(([command]) => command === "team_settings").map(([, args]) => (args as { request: Record<string, unknown> }).request);
const t = ENRICHMENT_TEXT.en;

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

describe("the reading of the switches", () => {
  it("keeps them only whole and in their shape; a box that does not send them has none", () => {
    const read = (enrichment: unknown) => {
      const out = pickTeamSettings(reply({ enrichment }));
      return out.ok ? out.settings.enrichment : "failed";
    };
    expect(read({ policy: POLICY, mode: "care" })).toEqual({ policy: POLICY, mode: "care" });
    expect(read({ policy: { ...POLICY, logo: { enabled: "yes", min_score: null } }, mode: "search" })).toBeUndefined();
    expect(read({ policy: { ...POLICY, recheck_weekly: { enabled: true, min_score: 70, older_than_days: 0 } }, mode: "search" })).toBeUndefined();
    expect(read({ policy: POLICY, mode: "party" })).toBeUndefined();
    expect(read({ policy: POLICY, mode: "search", path: "/home/x" })).toBeUndefined();
    const old = pickTeamSettings(reply({ enrichment: undefined }));
    expect(old.ok && old.settings.enrichment).toBeUndefined();
  });

  it("a save sends only what changed, and a threshold out of range is refused before it is sent", () => {
    const draft = { economy: false, logo: false, logoMin: "70", geocodePipeline: true, geocodeMissing: true, geocodeMin: "", nonRemoteOnly: true,
      recheck: true, recheckMin: "70", recheckDays: "14" };
    expect(patchOf(POLICY, draft, t)).toEqual({ patch: { "logo.enabled": false, "logo.min_score": 70 } });
    expect(patchOf(POLICY, { ...draft, logoMin: "170" }, t)).toEqual({ error: t.invalidScore });
    expect(patchOf(POLICY, { ...draft, recheckMin: "" }, t)).toEqual({ error: t.invalidScore });
    expect(patchOf(POLICY, { ...draft, recheckDays: "0" }, t)).toEqual({ error: t.invalidDays });
    expect(patchOf(POLICY, { ...draft, geocodeMin: "x" }, t)).toEqual({ error: t.invalidScore });
  });
});

describe("the card", () => {
  it("shows every switch as the team holds it, and the mode that stops them", async () => {
    native.invoke.mockImplementation(async () => reply({ enrichment: { policy: { ...POLICY, geocode_pipeline: { enabled: false } }, mode: "saving" } }));
    render(<EnrichmentPage {...props} />);
    expect(await screen.findByTestId("enrichment-card")).toBeInTheDocument();
    expect(screen.getByTestId("enrichment-logo")).toBeChecked();
    expect(screen.getByTestId("enrichment-geocode-pipeline")).not.toBeChecked();
    expect(screen.getByTestId("enrichment-recheck-days")).toHaveValue("14");
    expect(screen.getByText(t.modeSaving)).toBeInTheDocument();
    expect(screen.getByTestId("enrichment-save")).toBeDisabled();
  });

  it("a save is one write of the changed switches, and the card then shows what the team answered", async () => {
    const user = userEvent.setup();
    render(<EnrichmentPage {...props} />);
    await screen.findByTestId("enrichment-card");
    native.invoke.mockImplementation(async (_command: string, args: { request: Record<string, unknown> }) =>
      args.request.op === "write" ? reply({ enrichment: { policy: { ...POLICY, geocode_pipeline: { enabled: false } }, mode: "search" } }) : reply());
    await user.click(screen.getByTestId("enrichment-geocode-pipeline"));
    await user.click(screen.getByTestId("enrichment-save"));
    await waitFor(() => expect(calls().filter((r) => r.op === "write")).toHaveLength(1));
    expect(calls().find((r) => r.op === "write")).toEqual({ op: "write", settings: { enrichment: { "geocode_pipeline.enabled": false } }, connectionKey: KEY });
    await waitFor(() => expect(screen.getByTestId("enrichment-save")).toBeDisabled());
    expect(screen.getByTestId("enrichment-geocode-pipeline")).not.toBeChecked();
  });

  it("a bad threshold is said and never sent", async () => {
    const user = userEvent.setup();
    render(<EnrichmentPage {...props} />);
    await screen.findByTestId("enrichment-card");
    await user.type(screen.getByTestId("enrichment-logo-min"), "150");
    await user.click(screen.getByTestId("enrichment-save"));
    expect(screen.getByTestId("enrichment-error")).toHaveTextContent(t.invalidScore);
    expect(calls().filter((r) => r.op === "write")).toHaveLength(0);
  });

  it("a refusal of the team is said with its sentence, and the form stays as it was", async () => {
    const user = userEvent.setup();
    render(<EnrichmentPage {...props} />);
    await screen.findByTestId("enrichment-card");
    native.invoke.mockImplementation(async (_command: string, args: { request: Record<string, unknown> }) =>
      args.request.op === "write" ? { ok: false, error: "team_settings_unavailable" } : reply());
    await user.click(screen.getByTestId("enrichment-economy"));
    await user.click(screen.getByTestId("enrichment-save"));
    expect(await screen.findByTestId("enrichment-error")).toBeInTheDocument();
    expect(screen.getByTestId("enrichment-economy")).toBeChecked();
  });

  it("a team whose image does not send the switches is told so, with no made-up ones", async () => {
    native.invoke.mockImplementation(async () => reply({ enrichment: undefined }));
    render(<EnrichmentPage {...props} />);
    expect(await screen.findByTestId("enrichment-outdated")).toHaveTextContent(t.outdated);
    expect(screen.queryByTestId("enrichment-card")).toBeNull();
  });
});

describe("the words", () => {
  it("are written in the seven languages, every one", () => {
    const keys = Object.keys(ENRICHMENT_TEXT.it).sort();
    for (const [locale, text] of Object.entries(ENRICHMENT_TEXT)) {
      expect(Object.keys(text).sort(), locale).toEqual(keys);
      for (const value of Object.values(text)) expect(value.trim().length, locale).toBeGreaterThan(0);
    }
  });
});
