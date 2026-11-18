import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EFFORTS, MODEL_CLASSES, ROLES, WEEKDAYS, pickTeamSettings } from "../../lib/team-settings-native";
import EnrichmentPage, { costsOf, money, patchOf } from "./index";
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
  web_search: { analista: { enabled: false }, scout: { enabled: true }, mentor: { enabled: true } },
};
// a synthetic table of costs, in the shape of shared/skills/enrichment_costs.json
const COSTS = {
  positions_per_day: 50,
  switches: {
    economy: { costly: false, usd_per_position: 0.01 },
    "logo.enabled": { costly: true, usd_per_position: 0.004 },
    "recheck_weekly.enabled": { costly: true, usd_per_position: null },
    "web_search.analista.enabled": { costly: true, usd_per_position: 0.27 },
    "web_search.scout.enabled": { costly: true, usd_per_position: null, usd_per_search: 0.02 },
  },
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
    expect(read({ policy: { ...POLICY, web_search: { ...POLICY.web_search, writer: { enabled: true } } }, mode: "search" })).toBeUndefined();
    const old = pickTeamSettings(reply({ enrichment: undefined }));
    expect(old.ok && old.settings.enrichment).toBeUndefined();
  });

  it("a save sends only what changed, and a threshold out of range is refused before it is sent", () => {
    const draft = { economy: false, logo: false, logoMin: "70", geocodePipeline: true, geocodeMissing: true, geocodeMin: "", nonRemoteOnly: true,
      recheck: true, recheckMin: "70", recheckDays: "14", webAnalista: false, webScout: true, webMentor: true };
    expect(patchOf(POLICY, draft, t)).toEqual({ patch: { "logo.enabled": false, "logo.min_score": 70 } });
    expect(patchOf(POLICY, { ...draft, logoMin: "170" }, t)).toEqual({ error: t.invalidScore });
    expect(patchOf(POLICY, { ...draft, recheckMin: "" }, t)).toEqual({ error: t.invalidScore });
    expect(patchOf(POLICY, { ...draft, recheckDays: "0" }, t)).toEqual({ error: t.invalidDays });
    expect(patchOf(POLICY, { ...draft, geocodeMin: "x" }, t)).toEqual({ error: t.invalidScore });
    expect(patchOf(POLICY, { ...draft, logo: true, logoMin: "", webAnalista: true }, t)).toEqual({ patch: { "web_search.analista.enabled": true } });
  });

  it("keeps the costs in their closed shape, without what is off it; a doubtful table is no table", () => {
    const read = (costs: unknown) => {
      const out = pickTeamSettings(reply({ enrichment: { policy: POLICY, mode: "search", costs } }));
      return out.ok ? out.settings.enrichment : "failed";
    };
    const withBasis = { ...COSTS, version: 1, switches: { ...COSTS.switches, "logo.enabled": { costly: true, usd_per_position: 0.004, basis: "measured" },
      "logo.min_score": { costly: true, usd_per_position: 1 }, "geocode_pipeline.enabled": { costly: "yes", usd_per_position: 1 } } };
    expect(read(withBasis)).toEqual({ policy: POLICY, mode: "search", costs: COSTS });
    expect(read({ switches: {} })).toEqual({ policy: POLICY, mode: "search" });
    expect(read("cheap")).toEqual({ policy: POLICY, mode: "search" });
  });

  it("says what turning a switch to its dearer side costs, and nothing for the cheaper side or a switch the table does not name", () => {
    const say = (patch: Record<string, unknown>) => costsOf(patch as never, POLICY, COSTS, t, "en");
    expect(say({ "web_search.analista.enabled": true })).toEqual(["Web search of the Analysts: costs about 0.27 $ more per position (13.50 $ on 50 a day)."]);
    expect(say({ "logo.enabled": false })).toEqual([]);
    expect(say({ economy: true })).toEqual([]);
    expect(say({ "web_search.scout.enabled": false })).toEqual([]);
    expect(say({ "geocode_pipeline.enabled": false })).toEqual([]);
    expect(say({ "recheck_weekly.min_score": 50 })).toEqual([]);
    const saving = { ...POLICY, economy: true, logo: { enabled: false, min_score: null }, recheck_weekly: { ...POLICY.recheck_weekly, enabled: false },
      web_search: { ...POLICY.web_search, scout: { enabled: false } } };
    const itText = ENRICHMENT_TEXT.it;
    expect(costsOf({ economy: false, "logo.enabled": true, "recheck_weekly.enabled": true, "web_search.scout.enabled": true }, saving, COSTS, itText, "it")).toEqual([
      "Spegnere il risparmio: costa circa 0,01 $ in più a posizione (0,50 $ su 50 al giorno).",
      "Logo dell'azienda: costa circa 0,004 $ in più a posizione (0,20 $ su 50 al giorno).",
      "Ricontrollo delle posizioni vive (modalità cura): costa di più; quanto non è ancora misurato.",
      "Ricerca web dello Scout: costa circa 0,02 $ a ricerca.",
    ]);
    expect(costsOf({ "web_search.analista.enabled": true }, POLICY, undefined, t, "en")).toEqual([]);
    expect(money(0.008, "de")).toBe("0,008");
    expect(money(13.5, "en")).toBe("13.50");
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

  it("turning on a dearer switch says what it costs and asks first; only a yes writes, a no writes nothing", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementation(async () => reply({ enrichment: { policy: POLICY, mode: "search", costs: COSTS } }));
    render(<EnrichmentPage {...props} />);
    await screen.findByTestId("enrichment-card");
    await user.click(screen.getByTestId("enrichment-web-analista"));
    const sentence = "Web search of the Analysts: costs about 0.27 $ more per position (13.50 $ on 50 a day).";
    expect(screen.getByTestId("enrichment-cost")).toHaveTextContent(sentence);
    await user.click(screen.getByTestId("enrichment-save"));
    expect(screen.getByTestId("enrichment-confirm")).toHaveTextContent(sentence);
    expect(calls().filter((r) => r.op === "write")).toHaveLength(0);
    await user.click(screen.getByTestId("enrichment-confirm-no"));
    expect(screen.queryByTestId("enrichment-confirm")).toBeNull();
    expect(calls().filter((r) => r.op === "write")).toHaveLength(0);
    await user.click(screen.getByTestId("enrichment-save"));
    await user.click(screen.getByTestId("enrichment-confirm-yes"));
    await waitFor(() => expect(calls().filter((r) => r.op === "write")).toHaveLength(1));
    expect(calls().find((r) => r.op === "write")).toEqual({ op: "write", settings: { enrichment: { "web_search.analista.enabled": true } }, connectionKey: KEY });
  });

  it("a change made while the question is open takes the question back", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementation(async () => reply({ enrichment: { policy: POLICY, mode: "search", costs: COSTS } }));
    render(<EnrichmentPage {...props} />);
    await screen.findByTestId("enrichment-card");
    await user.click(screen.getByTestId("enrichment-web-analista"));
    await user.click(screen.getByTestId("enrichment-save"));
    expect(screen.getByTestId("enrichment-confirm")).toBeInTheDocument();
    await user.click(screen.getByTestId("enrichment-web-analista"));
    expect(screen.queryByTestId("enrichment-confirm")).toBeNull();
    expect(calls().filter((r) => r.op === "write")).toHaveLength(0);
  });

  it("a cheaper change, or a team without a table of costs, is saved without a question", async () => {
    const user = userEvent.setup();
    render(<EnrichmentPage {...props} />);
    await screen.findByTestId("enrichment-card");
    await user.click(screen.getByTestId("enrichment-web-analista"));
    expect(screen.queryByTestId("enrichment-cost")).toBeNull();
    await user.click(screen.getByTestId("enrichment-save"));
    expect(screen.queryByTestId("enrichment-confirm")).toBeNull();
    await waitFor(() => expect(calls().filter((r) => r.op === "write")).toHaveLength(1));
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

  it("name the Analisti in the language of the person, not with the Italian plural (retest Windows build13, French)", () => {
    for (const [locale, text] of Object.entries(ENRICHMENT_TEXT)) {
      if (locale === "it") continue;
      for (const value of Object.values(text)) expect(String(value), locale).not.toMatch(/Analisti/);
    }
    expect(ENRICHMENT_TEXT.fr.webAnalista).toBe("Recherche web des Analystes");
  });
});
