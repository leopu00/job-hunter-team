import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocalTeamData, useLocalTeamStopped } from "../../lib/local-team-data";
import { profileReply } from "../../test-support/existing-team-profile-fixture";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import ProfileRoute from ".";

// «Profilo» of a local profile (no cloud account): the candidate profile is read from the container of the team
// on this computer, through the same native read as an existing team's, and the cloud is asked for nothing.
// Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
  signOut: vi.fn(),
}));

const COMMAND = "existing_team_positions_read";
let answer: () => unknown;

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  answer = () => profileReply();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === COMMAND) return answer();
    throw new Error(`unexpected native command ${command}`);
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:synthetic"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  cleanup();
  setLocalTeamData(null);
  vi.unstubAllGlobals();
});

describe("Profilo of a local profile", () => {
  it("draws the profile the team's container holds, read once with the closed profile request, and asks the cloud for nothing", async () => {
    setLocalTeamData("local:abc");
    render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
    const view = await screen.findByTestId("profile-view");
    expect(view).toHaveTextContent("Synthetic Persona");
    expect(native.invoke.mock.calls).toEqual([[COMMAND, { request: { op: "profile" } }]]);
    expect(fake.current!.calls).toEqual([]);
    // no editing control, and the cloud's «sign in» note is not what a local profile sees
    expect(screen.queryAllByRole("button", { name: /modific/i })).toHaveLength(0);
    expect(screen.queryByTestId("cloud-data-notice")).toBeNull();
  });

  it("shows the profile as text: a value that looks like a link or markup is not one", async () => {
    setLocalTeamData("local:abc");
    const hostile = '<img src=x onerror="alert(1)"> https://example.invalid/steal';
    answer = () => profileReply({ fields: { name: hostile, target_role: "Synthetic Role" } });
    const { container } = render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
    await screen.findByTestId("profile-view");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="https://example.invalid"]')).toBeNull();
  });

  it("tells the team is not running, and the bar of the stopped team hears of it, then of the team running again", async () => {
    setLocalTeamData("local:abc");
    answer = () => ({ ok: false, error: "local_team_not_running" });
    const stopped = renderHook(() => useLocalTeamStopped());
    render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByTestId("profile-error")).toHaveTextContent("local_team_not_running");
    expect(stopped.result.current).toBe(true);

    answer = () => profileReply();
    await act(async () => {
      screen.getByRole("button", { name: /riprova/i }).click();
    });
    expect(await screen.findByTestId("profile-view")).toBeInTheDocument();
    expect(stopped.result.current).toBe(false);
  });

  it("a read refused for the owner of the team shows its closed code and no profile", async () => {
    setLocalTeamData("local:abc");
    answer = () => ({ ok: false, error: "local_account_owner_mismatch" });
    render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByTestId("profile-error")).toHaveTextContent("local_account_owner_mismatch");
    expect(screen.queryByTestId("profile-view")).toBeNull();
  });
});
