import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "./existing-team-readonly";
import { localTeamData, reportLocalTeamRead, setLocalTeamData, teamDataFromTheTeam, useLocalTeamStopped } from "./local-team-data";
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

  it("is written in the seven languages", () => {
    for (const [locale, copy] of Object.entries(LOCAL_TEAM_DATA_TEXT)) {
      expect(copy.readOnly.length, locale).toBeGreaterThan(30);
    }
    expect(Object.keys(LOCAL_TEAM_DATA_TEXT).sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });
});
