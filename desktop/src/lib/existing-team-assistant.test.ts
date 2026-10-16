// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { startExistingTeamAssistant } from "./existing-team-assistant";

describe("startExistingTeamAssistant", () => {
  it("sends the confirmation the person gave, once, and nothing else", async () => {
    const invoke = vi.fn().mockResolvedValue({ outcome: "started", captainRunning: true, assistantRunning: true });
    vi.resetModules();
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const { startExistingTeamAssistant: fresh } = await import("./existing-team-assistant");
    expect(await fresh()).toMatchObject({ kind: "started" });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("existing_team_assistant_start", { request: { confirmed: true } });
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("answers started and already running only for a whole reply, with the time of the check", async () => {
    expect(await startExistingTeamAssistant(async () => ({ outcome: "started", captainRunning: true, assistantRunning: true }), () => 5)).toEqual({
      kind: "started", at: 5, captainRunning: true,
    });
    expect(await startExistingTeamAssistant(async () => ({ outcome: "already_active", captainRunning: false, assistantRunning: true }), () => 6)).toEqual({
      kind: "already_active", at: 6, captainRunning: false,
    });
  });

  it("never reads a reply that is not whole as a start: no readiness comes out of it", async () => {
    for (const bad of [
      null, "started", {}, { outcome: "started" },
      { outcome: "started", captainRunning: true, assistantRunning: false },
      { outcome: "started", captainRunning: "yes", assistantRunning: true },
      { outcome: "started_maybe", captainRunning: true, assistantRunning: true },
      { outcome: "timeout", captainRunning: true, assistantRunning: true },
    ]) {
      expect(await startExistingTeamAssistant(async () => bad), JSON.stringify(bad)).toEqual({ kind: "error", code: "desktop_bad_reply" });
    }
  });

  it("tells a timeout from an error, with the real code of each", async () => {
    expect(await startExistingTeamAssistant(async () => { throw { code: "assistant_verify_timeout" }; })).toEqual({ kind: "timeout", code: "assistant_verify_timeout" });
    expect(await startExistingTeamAssistant(async () => { throw { code: "timeout" }; })).toEqual({ kind: "timeout", code: "timeout" });
    expect(await startExistingTeamAssistant(async () => { throw { code: "assistant_start_failed" }; })).toEqual({ kind: "error", code: "assistant_start_failed" });
    expect(await startExistingTeamAssistant(async () => { throw { code: "existing_team_identity_mismatch" }; })).toEqual({ kind: "error", code: "existing_team_identity_mismatch" });
    expect(await startExistingTeamAssistant(async () => { throw new Error("boom"); })).toEqual({ kind: "error", code: "desktop_transport_unavailable" });
  });
});

describe("who can call it", () => {
  it("is named by the one component behind the confirmation, and by no other source", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
      });
    const callers = files(root).filter((path) => /existing_team_assistant_start|startExistingTeamAssistant/.test(readFileSync(path, "utf8")));
    expect(callers.map((path) => path.slice(root.length).replaceAll("\\", "/"))).toEqual([
      "lib/existing-team-assistant.ts",
      "pages/existing-team/assistant-card.tsx",
    ]);
  });
});
