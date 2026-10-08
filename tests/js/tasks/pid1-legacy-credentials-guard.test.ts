import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { runLegacyCredentialsGuard } from "../../../cli/src/commands/pid1.js";

// [AUDIT-G1] pid1 runs `legacy_guard.py sweep` and logs only when it acts.
function fakeSpawn(stdout: string, calls: unknown[][]) {
  return (cmd: string, args: string[], options: unknown) => {
    calls.push([cmd, args, options]);
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough };
    child.stdout = new PassThrough();
    setImmediate(() => {
      child.stdout.end(stdout);
      child.emit("close", 0);
    });
    return child;
  };
}

describe("pid1 legacy credentials guard", () => {
  it("runs the sweep isolated and logs the files it removed unread", async () => {
    const calls: unknown[][] = [];
    const logs: string[] = [];
    const result = await runLegacyCredentialsGuard({
      spawnFn: fakeSpawn('{"ok": true, "removed": ["email_monitor"]}\n', calls) as never,
      log: (line: string) => logs.push(line),
      scriptExists: () => true,
    });
    expect(calls[0][0]).toBe("/usr/bin/python3");
    expect(calls[0][1]).toEqual(["-I", "/app/shared/broker/legacy_guard.py", "sweep"]);
    expect(result).toEqual({ ok: true, removed: ["email_monitor"] });
    expect(logs).toEqual([
      "legacy credentials guard: removed unread email_monitor (reappeared after the migration)",
    ]);
  });

  it("says where it put a placeholder", async () => {
    const logs: string[] = [];
    await runLegacyCredentialsGuard({
      spawnFn: fakeSpawn(
        '{"ok": true, "removed": [], "placeholders": ["email_monitor.json", "email_monitor.json.tmp"]}\n',
        [],
      ) as never,
      log: (line: string) => logs.push(line),
      scriptExists: () => true,
    });
    expect(logs).toEqual([
      "legacy credentials guard: placeholder in place of email_monitor.json, email_monitor.json.tmp",
    ]);
  });

  it("stays silent on a quiet sweep, so a tick every 30 s fills no log", async () => {
    const logs: string[] = [];
    await runLegacyCredentialsGuard({
      spawnFn: fakeSpawn('{"ok": false, "reason": "broker_unavailable", "removed": []}\n', []) as never,
      log: (line: string) => logs.push(line),
      scriptExists: () => true,
    });
    expect(logs).toEqual([]);
  });

  it("an image without the script spawns nothing", async () => {
    const calls: unknown[][] = [];
    expect(
      await runLegacyCredentialsGuard({
        spawnFn: fakeSpawn("", calls) as never,
        scriptExists: () => false,
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });
});
