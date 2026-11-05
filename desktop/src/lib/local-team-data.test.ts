import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "./existing-team-readonly";
import { localTeamData, reportLocalTeamRead, setLocalTeamData, teamDataFromTheTeam, useLocalTeamSavedAt, useLocalTeamStopped } from "./local-team-data";
import { LOCAL_TEAM_DATA_TEXT } from "./local-team-data.i18n";
import { createClient as clientCreateClient } from "../web-shims/server/supabase-client";
import { createClient as serverCreateClient } from "../web-shims/server/supabase-server";
import { inertSupabase } from "../web-shims/server/inert-supabase";

vi.mock("./supabase", () => ({ supabase: {}, supabaseConfigured: true, signOut: vi.fn() }));

afterEach(() => {
  setLocalTeamData(null);
  leaveExistingTeamReadOnly();
});

describe("the pages that show the team of this computer", () => {
  it("is on for an identity and off for null, and takes the data from the team in either view", () => {
    expect(localTeamData()).toBe(false);
    expect(teamDataFromTheTeam()).toBe(false);
    setLocalTeamData("local:abc");
    expect(localTeamData()).toBe(true);
    expect(teamDataFromTheTeam()).toBe(true);
    setLocalTeamData(null);
    expect(localTeamData()).toBe(false);
    enterExistingTeamReadOnly(true, null);
    expect(localTeamData()).toBe(false);
    expect(teamDataFromTheTeam()).toBe(true);
  });

  it("asks the cloud for nothing: both Supabase stand-ins are the inert one", async () => {
    setLocalTeamData("local:abc");
    expect(clientCreateClient()).toBe(inertSupabase);
    expect(await serverCreateClient()).toBe(inertSupabase);
  });

  it("says the team is stopped only in this mode, until a read works again", () => {
    const stopped = () => renderHook(() => useLocalTeamStopped());
    // a failure reported outside the mode is not kept
    reportLocalTeamRead("local_team_not_running");
    setLocalTeamData("local:abc");
    const view = stopped();
    expect(view.result.current).toBe(false);
    // another failure is not «the team is stopped»
    act(() => reportLocalTeamRead("positions_unavailable"));
    expect(view.result.current).toBe(false);
    act(() => reportLocalTeamRead("local_team_not_running"));
    expect(view.result.current).toBe(true);
    act(() => reportLocalTeamRead(null));
    expect(view.result.current).toBe(false);
    // leaving the mode forgets it
    act(() => reportLocalTeamRead("local_team_not_running"));
    act(() => setLocalTeamData(null));
    expect(stopped().result.current).toBe(false);
  });

  it("knows the pages show what the team saved, until a read works without the mark", () => {
    setLocalTeamData("local:abc");
    const view = renderHook(() => useLocalTeamSavedAt());
    expect(view.result.current).toBeNull();
    act(() => reportLocalTeamRead(null, { at: 1793879580 }));
    expect(view.result.current).toBe(1793879580);
    // a team that never ran has data to show and no moment to say
    act(() => reportLocalTeamRead(null, { at: null }));
    expect(view.result.current).toBe(0);
    act(() => reportLocalTeamRead(null, { at: 1793879580 }));
    // a page that asks for what only the team can give fails with «not running»: the bar must not flip to the empty one
    act(() => reportLocalTeamRead("local_team_not_running"));
    expect(view.result.current).toBe(1793879580);
    // another failure leaves it too; a read that works with no mark is the team being up
    act(() => reportLocalTeamRead("positions_unavailable"));
    expect(view.result.current).toBe(1793879580);
    act(() => reportLocalTeamRead(null));
    expect(view.result.current).toBeNull();
    // and it is forgotten with the mode, and never kept outside it
    act(() => reportLocalTeamRead(null, { at: 5 }));
    act(() => setLocalTeamData(null));
    expect(renderHook(() => useLocalTeamSavedAt()).result.current).toBeNull();
    reportLocalTeamRead(null, { at: 5 });
    expect(renderHook(() => useLocalTeamSavedAt()).result.current).toBeNull();
  });

  it("is written in the seven languages", () => {
    for (const [locale, copy] of Object.entries(LOCAL_TEAM_DATA_TEXT)) {
      expect(copy.readOnly.length, locale).toBeGreaterThan(30);
      expect(copy.teamPage.length, locale).toBeGreaterThan(60);
      expect(copy.savedAt, locale).toContain("{time}");
      expect(copy.savedNoTime.length, locale).toBeGreaterThan(15);
      expect(copy.savedHint.length, locale).toBeGreaterThan(30);
    }
    expect(Object.keys(LOCAL_TEAM_DATA_TEXT).sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });
});
