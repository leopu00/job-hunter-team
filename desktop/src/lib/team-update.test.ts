import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

import { ERROR_CATALOG } from "./error-catalog";
import {
  ackCurrentTeamImage, ackedTeamImage, applyTeamUpdate, checkTeamUpdate, noteTeamUpdateChecked, parseTeamUpdateOutcome, TEAM_UPDATE_COMMAND,
  TEAM_UPDATE_GUIDE_CODES, teamUpdateCheckDue, wantsTeamUpdate, type TeamUpdateOutcome,
} from "./team-update";

afterEach(() => {
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
  localStorage.clear();
});

const outcome = (overrides: Partial<TeamUpdateOutcome> = {}): TeamUpdateOutcome => ({
  ok: true, changed: true, phase: "complete", reason: null, rolledBack: false, restartRequired: false,
  previousVersion: "0.4.0", currentVersion: "0.4.1", imageId: "", mode: "upgrade", ...overrides,
});

describe("wantsTeamUpdate", () => {
  it("is true for the Budget's «the team does not offer the figures yet» and for every message whose action is «Update the team»", () => {
    expect(wantsTeamUpdate("budget_unavailable")).toBe(true);
    const asking = Object.entries(ERROR_CATALOG).filter(([, copy]) => /^Update the team\b/i.test(copy.action.en));
    expect(asking.length).toBeGreaterThanOrEqual(9);
    for (const [code, copy] of asking) {
      expect(wantsTeamUpdate(code), code).toBe(true);
      // The Italian copy says the same thing: the two sources of the catalog never disagree about it.
      expect(copy.action.it, code).toMatch(/^Aggiorna (la squadra|il team)\b/);
    }
  });

  it("is false for every other message, for a code the catalog does not know and for no code", () => {
    for (const [code, copy] of Object.entries(ERROR_CATALOG)) {
      if (!/^Update the team\b/i.test(copy.action.en)) expect(wantsTeamUpdate(code), code).toBe(false);
    }
    expect(wantsTeamUpdate("budget_unreadable")).toBe(false);
    expect(wantsTeamUpdate("a_code_nobody_wrote")).toBe(false);
    expect(wantsTeamUpdate(null)).toBe(false);
    expect(wantsTeamUpdate(undefined)).toBe(false);
  });

  it("gives the command the host answers to", () => {
    expect(TEAM_UPDATE_COMMAND).toBe("jht upgrade");
  });
});

describe("the update itself", () => {
  it("asks the native side to check or to apply, and nothing else", async () => {
    native.invoke.mockResolvedValue(outcome());
    expect(await checkTeamUpdate()).toEqual(outcome());
    expect(native.invoke).toHaveBeenLastCalledWith("onboarding_team_update", { action: "check" });
    await applyTeamUpdate();
    expect(native.invoke).toHaveBeenLastCalledWith("onboarding_team_update", { action: "apply" });
  });

  it("refuses a reply it does not recognise, and outside the desktop app", async () => {
    for (const reply of [
      null, [], {}, { ...outcome(), phase: "teleport" }, { ...outcome(), reason: "because" }, { ...outcome(), mode: "other" },
      { ...outcome(), ok: "yes" }, { ...outcome(), currentVersion: "<b>x</b>" }, { ...outcome(), previousVersion: "9".repeat(65) },
      { ...outcome(), imageId: "not-hex" }, { ...outcome(), imageId: undefined },
    ]) {
      native.invoke.mockResolvedValue(reply);
      await expect(applyTeamUpdate()).rejects.toEqual({ code: "team_update_failed" });
    }
    native.isTauri.mockReturnValue(false);
    await expect(checkTeamUpdate()).rejects.toEqual({ code: "desktop_only" });
    expect(native.invoke).toHaveBeenCalledTimes(11);
  });

  it("keeps the failure of an update that was undone as an answer, not as an error", () => {
    const failed = outcome({ ok: false, changed: false, phase: "verify", reason: "download_failed", rolledBack: true });
    expect(parseTeamUpdateOutcome(failed)).toEqual(failed);
  });

  it("falls back to the guide only for a host that cannot be updated from here", () => {
    expect(TEAM_UPDATE_GUIDE_CODES).toEqual(["team_update_wrapper_outdated", "team_update_unsupported", "desktop_only"]);
    for (const code of TEAM_UPDATE_GUIDE_CODES) {
      if (code !== "desktop_only") expect(ERROR_CATALOG[code], code).toBeDefined();
    }
  });

  it("remembers the pair of images it already updated the team to, and nothing else", async () => {
    expect(ackedTeamImage()).toBeNull();
    native.invoke.mockResolvedValue(outcome({ phase: "check", imageId: "aaaaaaaaaaaa:bbbbbbbbbbbb" }));
    await ackCurrentTeamImage();
    expect(ackedTeamImage()).toBe("aaaaaaaaaaaa:bbbbbbbbbbbb");
    // a check that fails, or one with no pair (the VPS), keeps what was there
    native.invoke.mockRejectedValue({ code: "team_update_unsupported" });
    await ackCurrentTeamImage();
    native.invoke.mockResolvedValue(outcome({ phase: "check", imageId: "" }));
    await ackCurrentTeamImage();
    expect(ackedTeamImage()).toBe("aaaaaaaaaaaa:bbbbbbbbbbbb");
  });

  it("asks once a day", () => {
    const now = 1_800_000_000_000;
    expect(teamUpdateCheckDue(now)).toBe(true);
    noteTeamUpdateChecked(now);
    expect(teamUpdateCheckDue(now + 60_000)).toBe(false);
    expect(teamUpdateCheckDue(now + 25 * 60 * 60 * 1000)).toBe(true);
    // a clock set back is not «checked recently»
    expect(teamUpdateCheckDue(now - 60_000)).toBe(true);
  });
});
