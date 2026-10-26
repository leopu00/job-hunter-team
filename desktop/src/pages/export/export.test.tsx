import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import { TeamOffContext } from "../../lib/team-off";
import { TEAM_OFF_TEXT } from "../../shell/team-off.i18n";
import { describeError } from "../../lib/error-catalog";
import ExportPage from "./index";
import { EXPORT_TEXT } from "./export.i18n";

// The export page against stand-ins of the native save and of the cloud account. Synthetic data only.
const team = vi.hoisted(() => ({ exportTeamData: vi.fn(), saveAccountExport: vi.fn() }));
vi.mock("../../lib/team-export", async (original) => ({ ...(await original<typeof import("../../lib/team-export")>()), ...team }));
const account = vi.hoisted(() => ({ buildAccountExport: vi.fn() }));
vi.mock("../../lib/account-export", () => account);
const cloud = vi.hoisted(() => ({ supabase: {}, supabaseConfigured: true }));
vi.mock("../../lib/supabase", () => cloud);

const props = { params: {}, search: new URLSearchParams() };

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en; path=/";
  localStorage.setItem("jht-lang", "en");
  team.exportTeamData.mockReset().mockResolvedValue({ ok: true, outcome: "saved", count: 12 });
  team.saveAccountExport.mockReset().mockResolvedValue({ ok: true, outcome: "saved" });
  account.buildAccountExport.mockReset().mockResolvedValue({ ok: true, text: '{"data":{}}' });
  cloud.supabaseConfigured = true;
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the export page: before saving", () => {
  it("says, before anything is saved, that the file is not encrypted and holds personal data", () => {
    render(<ExportPage {...props} />);
    expect(screen.getByTestId("export-personal-data")).toHaveTextContent("not encrypted and contains personal data");
    // above both buttons: read before pressing either
    const note = screen.getByTestId("export-personal-data");
    expect(note.compareDocumentPosition(screen.getByTestId("export-team-button")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(screen.getByTestId("export-account-button")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("tells a missing database apart from an empty file", async () => {
    const user = userEvent.setup();
    team.exportTeamData.mockResolvedValueOnce({ ok: false, error: "export_no_database" });
    render(<ExportPage {...props} />);
    await user.click(screen.getByTestId("export-team-button"));
    const say = await screen.findByTestId("export-team-say");
    expect(say).toHaveAttribute("role", "alert");
    expect(say).toHaveTextContent(describeError("export_no_database", { locale: "en" }).text);
  });
});

describe("the export page: team data", () => {
  it("offers the six sources and two formats, and sends what was chosen, with no date by default", async () => {
    const user = userEvent.setup();
    render(<ExportPage {...props} />);
    const source = screen.getByRole("combobox", { name: "What to export" });
    expect(within(source).getAllByRole("option").map((option) => option.textContent)).toEqual(["Positions", "Scores", "Applications", "Companies", "Feedback", "Notes"]);
    expect(within(screen.getByRole("combobox", { name: "Format" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["JSON", "CSV"]);
    await user.click(screen.getByTestId("export-team-button"));
    expect(team.exportTeamData).toHaveBeenCalledWith({ source: "positions", format: "json" });
    expect(await screen.findByTestId("export-team-say")).toHaveTextContent("Saved: 12 rows.");
    await user.selectOptions(source, "notes");
    await user.selectOptions(screen.getByRole("combobox", { name: "Format" }), "csv");
    await user.click(screen.getByTestId("export-team-button"));
    expect(team.exportTeamData).toHaveBeenLastCalledWith({ source: "notes", format: "csv" });
  });

  it("says one row in the singular", async () => {
    const user = userEvent.setup();
    team.exportTeamData.mockResolvedValue({ ok: true, outcome: "saved", count: 1 });
    render(<ExportPage {...props} />);
    await user.click(screen.getByTestId("export-team-button"));
    expect(await screen.findByTestId("export-team-say")).toHaveTextContent("Saved: 1 row.");
  });

  it("sends the dates when given, and refuses a start after the end before asking anything", async () => {
    const user = userEvent.setup();
    render(<ExportPage {...props} />);
    await user.type(screen.getByLabelText("From"), "2026-10-20");
    await user.type(screen.getByLabelText("To"), "2026-10-10");
    expect(screen.getByTestId("export-range-bad")).toBeInTheDocument();
    expect(screen.getByTestId("export-team-button")).toBeDisabled();
    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "2026-10-24");
    expect(screen.queryByTestId("export-range-bad")).toBeNull();
    await user.click(screen.getByTestId("export-team-button"));
    expect(team.exportTeamData).toHaveBeenCalledWith({ source: "positions", format: "json", from: "2026-10-20", to: "2026-10-24" });
  });

  it("tells a cancelled window apart from a failure", async () => {
    const user = userEvent.setup();
    team.exportTeamData.mockResolvedValueOnce({ ok: true, outcome: "cancelled" });
    render(<ExportPage {...props} />);
    await user.click(screen.getByTestId("export-team-button"));
    const say = await screen.findByTestId("export-team-say");
    expect(say).toHaveTextContent("Cancelled: no file saved.");
    expect(say).toHaveAttribute("role", "status");
    team.exportTeamData.mockResolvedValueOnce({ ok: false, error: "export_too_large" });
    await user.click(screen.getByTestId("export-team-button"));
    await waitFor(() => expect(screen.getByTestId("export-team-say")).toHaveAttribute("role", "alert"));
  });
});

describe("the export page: account data", () => {
  it("builds the account's text in the app and hands it to the native save", async () => {
    const user = userEvent.setup();
    render(<ExportPage {...props} />);
    await user.click(screen.getByTestId("export-account-button"));
    expect(await screen.findByTestId("export-account-say")).toHaveTextContent("Saved.");
    expect(team.saveAccountExport).toHaveBeenCalledWith('{"data":{}}');
  });

  it("saves nothing when a table could not be read, and says which", async () => {
    const user = userEvent.setup();
    account.buildAccountExport.mockResolvedValue({ ok: false, error: "export_incomplete", tables: ["positions", "scores"] });
    render(<ExportPage {...props} />);
    await user.click(screen.getByTestId("export-account-button"));
    const say = await screen.findByTestId("export-account-say");
    expect(say).toHaveTextContent("positions, scores");
    expect(say).toHaveAttribute("role", "alert");
    expect(team.saveAccountExport).not.toHaveBeenCalled();
  });

  it("does not say there is no cloud account when the account could not be read", async () => {
    const user = userEvent.setup();
    account.buildAccountExport.mockResolvedValue({ ok: false, error: "read_failed" });
    render(<ExportPage {...props} />);
    await user.click(screen.getByTestId("export-account-button"));
    const say = await screen.findByTestId("export-account-say");
    expect(say).toHaveAttribute("role", "alert");
    expect(say).not.toHaveTextContent("A cloud account is needed");
    expect(say).toHaveTextContent("I cannot read your account right now: try again in a moment.");
    expect(team.saveAccountExport).not.toHaveBeenCalled();
  });

  it("says a cloud account is needed when there is none", async () => {
    const user = userEvent.setup();
    cloud.supabaseConfigured = false;
    account.buildAccountExport.mockResolvedValue({ ok: false, error: "not_cloud" });
    render(<ExportPage {...props} />);
    await user.click(screen.getByTestId("export-account-button"));
    expect(await screen.findByTestId("export-account-say")).toHaveTextContent("A cloud account is needed");
    expect(account.buildAccountExport).toHaveBeenCalledWith(null);
    expect(team.saveAccountExport).not.toHaveBeenCalled();
  });
});

describe("the export page's words", () => {
  it("has every language's, with the plural forms carrying their count", () => {
    for (const [locale, text] of Object.entries(EXPORT_TEXT) as [Locale, (typeof EXPORT_TEXT)[Locale]][]) {
      for (const [key, value] of Object.entries(text)) {
        if (typeof value === "string") expect(value.trim().length, `${locale} ${key}`).toBeGreaterThan(1);
      }
      expect(text.saved.one, locale).toContain("{count}");
      expect(text.saved.other, locale).toContain("{count}");
      expect(text.accountIncomplete, locale).toContain("{tables}");
    }
    expect(Object.keys(EXPORT_TEXT).sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });
});

describe("the export page in the app opened without the team", () => {
  it("tells to turn the runtime on, not to start the team, when the container is off", async () => {
    const user = userEvent.setup();
    team.exportTeamData.mockResolvedValueOnce({ ok: false, error: "local_team_not_running" });
    render(<TeamOffContext.Provider value={{ teamOff: true, wakeRuntime: vi.fn() }}><ExportPage {...props} /></TeamOffContext.Provider>);
    await user.click(screen.getByTestId("export-team-button"));
    const say = await screen.findByTestId("export-team-say");
    expect(say).toHaveTextContent(TEAM_OFF_TEXT.en.needsRuntime);
    expect(say).not.toHaveTextContent(/start the team/i);
  });
});
