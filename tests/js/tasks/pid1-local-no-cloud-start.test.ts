import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { hostIsVps, readHostType } from "../../../cli/src/commands/pid1.js";

const PID1 = readFileSync(
  path.resolve(__dirname, "../../../cli/src/commands/pid1.js"),
  "utf-8",
).replace(/\r\n/g, "\n");

const count = (text: string, needle: string) => text.split(needle).length - 1;

// The app open without the team puts `.team-halted.flag` down and wakes the container; only `jht team start`
// takes it away. Nothing in the container of a computer may start the team from the cloud meanwhile.
describe("pid1 — a computer's own container never starts the team from the cloud", () => {
  it("without host.env, or with an unknown type, the container is local and not a VPS", async () => {
    const missing = Object.assign(new Error("not found"), { code: "ENOENT" });
    const local = await readHostType({
      env: {},
      accessFile: vi.fn().mockRejectedValue(missing),
      readHostFile: vi.fn(),
      log: vi.fn(),
    });
    expect(local).toBe("local");
    expect(hostIsVps(local)).toBe(false);
    for (const type of ["unknown", "", "local", "desktop"]) expect(hostIsVps(type)).toBe(false);
    for (const type of ["vps", "server", "remote"]) expect(hostIsVps(type)).toBe(true);
  });

  it("the cloud daemon starts only on a VPS, even with cloud.json paired", () => {
    expect(PID1).toContain("const isVps = hostIsVps(hostType);");
    // the first start and the hot reload of the daemon are both behind isVps
    expect(PID1).toContain("if (isVps && await isCloudConfigured()) {\n    startDaemon();");
    const reload = PID1.indexOf("let lastConfigured = await isCloudConfigured();");
    const guard = PID1.lastIndexOf("  if (isVps) {\n", reload);
    expect(guard).toBeGreaterThan(0);
    expect(PID1.slice(guard, reload)).not.toContain("\n  }\n");
    // the daemon is started in these three places only: its own respawn after a crash, the first start, the reload
    expect(count(PID1, "startDaemon();")).toBe(3);
  });

  it("the retired pollers that reconcile the desired state are never started from pid1", () => {
    // each of them appears once: in the respawn of its own handler, never as a first start
    for (const start of ["startTeamState();", "startRealtime();", "startUserMessages();"]) {
      expect(count(PID1, start), start).toBe(1);
    }
    expect(count(PID1, "'team-state-listen'")).toBe(1);
  });
});
