import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pickProviderWindow, readProviderWindow } from "./provider-window-native";

// The door to the team's record of the provider's work window: the closed shape, and nothing else. Synthetic values only.
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tests/fixtures/provider_window_response.json"), "utf8")) as Record<string, unknown>;
const reply = (fields: Record<string, unknown> = {}) => ({ ok: true, provider: "codex", usedPct: 93.4, resetAtUnix: 1793300000, updatedAtUnix: 1793299000, ...fields });

describe("pickProviderWindow", () => {
  it("takes what the app serves, as the Rust test of the same fixture produces it", () => {
    expect(pickProviderWindow(fixture.used_with_reset)).toEqual({ ok: true, window: { provider: "codex", usedPct: 93.4, resetAtUnix: 1793300000, updatedAtUnix: 1793299000.5 } });
    expect(pickProviderWindow(fixture.no_numbers)).toEqual({ ok: true, window: { provider: null, usedPct: null, resetAtUnix: null, updatedAtUnix: 1793299000.5 } });
    expect(pickProviderWindow(fixture.unavailable)).toEqual({ ok: false, error: "window_unavailable" });
  });

  it("refuses an answer with a field outside the list, a missing one, or a value out of its range", () => {
    const refused = [
      reply({ detail: "x" }),
      (({ usedPct: _u, ...rest }) => rest)(reply()),
      reply({ usedPct: -1 }),
      reply({ usedPct: 1001 }),
      reply({ usedPct: "93" }),
      reply({ resetAtUnix: 5 }),
      reply({ updatedAtUnix: null }),
      reply({ provider: "Codex" }),
      reply({ provider: "a b" }),
      reply({ ok: false }),
      null,
      "ok",
      [reply()],
    ];
    for (const value of refused) expect(pickProviderWindow(value), JSON.stringify(value)).toEqual({ ok: false, error: "window_unavailable" });
  });
});

describe("readProviderWindow", () => {
  it("asks the native command and closes the answer", async () => {
    const asked: string[] = [];
    const result = await readProviderWindow(async (command) => { asked.push(command); return reply(); });
    expect(asked).toEqual(["provider_window_read"]);
    expect(result.ok).toBe(true);
  });
  it("is unavailable when the command fails", async () => {
    expect(await readProviderWindow(async () => { throw new Error("disconnected"); })).toEqual({ ok: false, error: "window_unavailable" });
  });
});
