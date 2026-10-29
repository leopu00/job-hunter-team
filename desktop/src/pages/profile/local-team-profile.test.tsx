import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAuthStorageProbe } from "../../lib/auth-storage-lock";
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
const PROGRESS = "profile_progress_read";
let answer: () => unknown;
let progress: () => unknown;

// What the app reads of the profile file (profile_progress_read), synthetic: `done` of the eight fields.
const reading = (done: number) => ({
  ok: true,
  required: 8,
  done,
  ready: done === 8,
  fields: ["name", "email", "target_role", "location", "experience_years", "seniority_target", "skills", "languages"].map((key, index) => ({
    key,
    ok: index < done,
    ...(index < done && key !== "email" && key !== "skills" && key !== "languages" ? { preview: `Synthetic ${key}` } : {}),
  })),
});

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  answer = () => profileReply();
  progress = () => reading(8);
  native.invoke.mockImplementation(async (command: string) => {
    if (command === COMMAND) return answer();
    if (command === PROGRESS) return progress();
    throw new Error(`unexpected native command ${command}`);
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:synthetic"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  cleanup();
  setLocalTeamData(null);
  registerAuthStorageProbe(() => true);
  vi.unstubAllGlobals();
});

describe("Profilo of a local profile", () => {
  it("draws the profile the team's container holds, read once with the closed profile request, and asks the cloud for nothing", async () => {
    setLocalTeamData("local:abc");
    render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
    const view = await screen.findByTestId("profile-view");
    expect(view).toHaveTextContent("Synthetic Persona");
    expect(native.invoke.mock.calls.filter(([command]) => command === COMMAND)).toEqual([[COMMAND, { request: { op: "profile" } }]]);
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

describe("Profilo, the bar of what the profile still needs", () => {
  it("with the team on this computer and the profile incomplete, the bar is on top and the team's profile below it", async () => {
    setLocalTeamData("local:abc");
    progress = () => reading(5);
    render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
    const bar = await screen.findByTestId("local-team-profile-progress");
    expect(within(bar).getByTestId("profile-progress-bar")).toBeInTheDocument();
    expect(within(bar).getByTestId("profile-progress-counter")).toHaveTextContent("5");
    const view = await screen.findByTestId("profile-view");
    expect(view).toHaveTextContent("Synthetic Persona");
    // the bar comes first in the page, then the profile
    expect(bar.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId("local-profile")).toBeNull();
    expect(fake.current!.calls).toEqual([]);
  });

  it("with the team on this computer and the profile complete, there is only the team's profile", async () => {
    setLocalTeamData("local:abc");
    progress = () => reading(8);
    render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByTestId("profile-view")).toBeInTheDocument();
    await waitFor(() => expect(native.invoke.mock.calls.some(([command]) => command === PROGRESS)).toBe(true));
    expect(screen.queryByTestId("local-team-profile-progress")).toBeNull();
    expect(screen.queryByTestId("profile-progress")).toBeNull();
  });

  it("the bar goes away by itself once the profile gets complete", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setLocalTeamData("local:abc");
      progress = () => reading(7);
      render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
      expect(await screen.findByTestId("local-team-profile-progress")).toBeInTheDocument();
      progress = () => reading(8);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await waitFor(() => expect(screen.queryByTestId("local-team-profile-progress")).toBeNull());
      expect(screen.getByTestId("profile-view")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("with the bar unreadable the page is the team's profile alone, and its own failure is the one told", async () => {
    setLocalTeamData("local:abc");
    progress = () => ({ ok: false, error: "profile_unavailable" });
    render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByTestId("profile-view")).toBeInTheDocument();
    expect(screen.queryByTestId("local-team-profile-progress")).toBeNull();
  });

  it("with neither a team nor a cloud account the page is the local profile's, and the team's profile is not read", async () => {
    registerAuthStorageProbe(() => false);
    progress = () => reading(5);
    render(<ProfileRoute params={{}} search={new URLSearchParams()} />);
    const local = await screen.findByTestId("local-profile");
    expect(await within(local).findByTestId("profile-progress-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-view")).toBeNull();
    expect(screen.queryByTestId("local-team-profile-progress")).toBeNull();
    expect(native.invoke.mock.calls.filter(([command]) => command === COMMAND)).toEqual([]);
    expect(fake.current!.calls).toEqual([]);
  });
});
