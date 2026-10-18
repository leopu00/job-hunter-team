import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeClick, OfficeEvent, OfficeLayout, OfficeManifest, OfficeSceneOptions } from "../../office/contract";
import { diffOfficeSnapshots } from "../../office/data/diff";
import { emptyEngine } from "../../office/parts";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { describeError } from "../../lib/error-catalog";
import { refresh } from "../../shell/router";
import { realSnapshotReply } from "../../test-support/snapshot-command-reply";
import { EXISTING_TEAM_STATUS_TEXT } from "../existing-team/existing-team-status.i18n";

// /office in the read-only view of an existing team: the same office, fed by
// the probe behind the Squadra page (here the native command, answered by a
// fake VPS), with no cloud and no Realtime. Synthetic data only.
const scene = {
  options: null as OfficeSceneOptions | null,
  destroy: vi.fn(),
  setAgentStatuses: vi.fn(),
};
vi.mock("../../office/scene/pixi-scene", () => ({
  createOfficeScene: vi.fn(async (_host: HTMLElement, options: OfficeSceneOptions) => {
    scene.options = options;
    return { resize: vi.fn(), destroy: scene.destroy, setAgentStatuses: scene.setAgentStatuses, focus: vi.fn(() => null) };
  }),
}));
// Any touch of the cloud client is a failure of this view: it records it.
const cloud = vi.hoisted(() => ({ touched: [] as string[] }));
vi.mock("../../lib/supabase", () => ({
  supabase: new Proxy({}, { get: (_, key) => (cloud.touched.push(String(key)), undefined) }),
}));
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
const statusQuery = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../office/status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../office/status")>()),
  loadAgentStatuses: vi.fn(async () => {
    statusQuery.calls++;
    return null;
  }),
}));
const parts = vi.hoisted(() => ({ value: { createEngine: null as unknown, data: null as unknown } }));
vi.mock("../../office/parts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../office/parts")>()),
  loadParts: vi.fn(async () => parts.value),
}));

import ExistingTeamOfficePage from "./readonly";

const T = EXISTING_TEAM_STATUS_TEXT.it;
const COMMAND = "onboarding_resume_snapshot";
const LAYOUT = { version: 1, departments: [], furniture: [] } as unknown as OfficeLayout;
const MANIFEST: OfficeManifest = { version: 1, layout: "/office/layout.json", characters: [], atlases: [] };
const CONNECTION = { at: Date.UTC(2026, 9, 18, 21, 0, 0), captainRunning: true, assistantRunning: true };

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let answer: () => Promise<unknown>;
let applied: OfficeEvent[];
let load: ReturnType<typeof vi.fn>;
const reads = () => native.invoke.mock.calls.filter(([command]) => command === COMMAND).length;
const mount = () => render(<ExistingTeamOfficePage params={{}} search={new URLSearchParams()} />);

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  cloud.touched = [];
  statusQuery.calls = 0;
  scene.options = null;
  scene.setAgentStatuses.mockReset();
  scene.destroy.mockReset();
  applied = [];
  load = vi.fn();
  parts.value = {
    createEngine: vi.fn(() => ({ ...emptyEngine(), apply: (e: OfficeEvent) => applied.push(e) })),
    data: { load, diff: diffOfficeSnapshots },
  };
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  answer = async () => realSnapshotReply();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === COMMAND) return answer();
    throw new Error(`unexpected native command ${command}`);
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/office/manifest.json" ? json(MANIFEST) : url === "/office/layout.json" ? json(LAYOUT) : new Response("{}", { status: 404 }))),
  );
  enterExistingTeamReadOnly(true, CONNECTION);
});
afterEach(() => {
  cleanup();
  leaveExistingTeamReadOnly();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const entered = () => applied.filter((e): e is Extract<OfficeEvent, { type: "enter" }> => e.type === "enter").map((e) => e.agent.uid);

describe("the office of an existing team, over its VPS", () => {
  it("seats the captain and the assistant the VPS reports, grey and of unknown status, and reads no cloud", async () => {
    mount();
    await waitFor(() => expect(entered()).toEqual(["capitano", "assistente"]));
    expect(applied.filter((e) => e.type === "enter").every((e) => e.type === "enter" && e.atOnce)).toBe(true);
    await waitFor(() =>
      expect(scene.setAgentStatuses).toHaveBeenLastCalledWith({
        at: CONNECTION.at,
        agents: { capitano: { status: "unknown" }, assistente: { status: "unknown" } },
      }),
    );
    expect(reads()).toBe(1);
    // the cloud's data layer, the tags' query and the client itself are never touched
    expect(load).not.toHaveBeenCalled();
    expect(statusQuery.calls).toBe(0);
    expect(cloud.touched).toEqual([]);
  });

  it("a team that is off: an empty office and the Squadra page's sentence", async () => {
    answer = async () => realSnapshotReply({ containerRunning: false });
    mount();
    expect(await screen.findByRole("status")).toHaveTextContent(T.fields.containerRunning.no);
    expect(entered()).toEqual([]);
    expect(scene.setAgentStatuses).toHaveBeenLastCalledWith(null);
    expect(cloud.touched).toEqual([]);
  });

  it("a probe that fails: nobody is drawn and the alert is the catalog's sentence", async () => {
    answer = async () => {
      throw { code: "ssh_unavailable" };
    };
    mount();
    const alert = await screen.findByRole("alert");
    const failure = describeError("ssh_unavailable", { fallback: "existing_team_unavailable", locale: "it" });
    expect(alert).toHaveTextContent(failure.text);
    expect(alert).toHaveTextContent(failure.action);
    expect(entered()).toEqual([]);
    expect(scene.setAgentStatuses).toHaveBeenLastCalledWith(null);
  });

  it("«Aggiorna» is one read, as on the Squadra page, and nothing reads on a timer", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    expect(reads()).toBe(1);
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    expect(reads()).toBe(1);
    vi.useRealTimers();
    await act(async () => refresh());
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("a refresh that finds the team gone empties the office: the old reading is not the present", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    answer = async () => realSnapshotReply({ containerRunning: false });
    await act(async () => refresh());
    await waitFor(() => expect(applied.filter((e) => e.type === "leave").map((e) => e.type === "leave" && e.uid).sort()).toEqual(["assistente", "capitano"]));
    expect(await screen.findByRole("status")).toHaveTextContent(T.fields.containerRunning.no);
  });

  it("a read that finishes after a newer one is not shown: the older answer never replaces the present", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    answer = async () => {
      if (first) {
        first = false;
        await slow;
        return realSnapshotReply();
      }
      return realSnapshotReply({ containerRunning: false });
    };
    mount();
    await waitFor(() => expect(reads()).toBe(1));
    await act(async () => refresh());
    await waitFor(() => expect(reads()).toBe(2));
    expect(await screen.findByRole("status")).toHaveTextContent(T.fields.containerRunning.no);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(entered()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(T.fields.containerRunning.no);
  });

  it("the connection's sessions changing draws the office again from the same reading, with no new read", async () => {
    enterExistingTeamReadOnly(true, { ...CONNECTION, assistantRunning: false });
    mount();
    await waitFor(() => expect(entered()).toEqual(["capitano"]));
    expect(reads()).toBe(1);
    await act(async () => enterExistingTeamReadOnly(true, { ...CONNECTION, at: CONNECTION.at + 5_000, assistantRunning: true, source: "assistant_start" }));
    await waitFor(() => expect(entered()).toEqual(["capitano", "assistente"]));
    expect(reads()).toBe(1);
  });

  it("no panel opens on a click, and the cloud is not asked for one", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    const click: OfficeClick = { kind: "agent", uid: "capitano", role: "capitano" };
    act(() => scene.options!.onClick(click));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => scene.options!.onClick({ kind: "pile", dept: "scout" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cloud.touched).toEqual([]);
  });

  it("says so when the office's art is not in the app", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })));
    mount();
    expect(await screen.findByText("L'arte dell'ufficio non è ancora nell'app.")).toBeInTheDocument();
    expect(reads()).toBe(0);
  });
});
