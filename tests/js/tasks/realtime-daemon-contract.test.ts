import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { realtimeSyncEnabled } from "../../../cli/src/lib/cloud-realtime.js";

const root = resolve(__dirname, "../../..");

describe("Realtime daemon contract", () => {
  it("si abilita sui pairing moderni e conserva l'opt-out", () => {
    const previous = process.env.JHT_REALTIME_SYNC;
    delete process.env.JHT_REALTIME_SYNC;
    try {
      expect(realtimeSyncEnabled({})).toBe(false);
      expect(realtimeSyncEnabled({
        supabase_url: "https://example.invalid",
        supabase_refresh_token: "synthetic-refresh",
      })).toBe(true);
      process.env.JHT_REALTIME_SYNC = "0";
      expect(realtimeSyncEnabled({
        supabase_url: "https://example.invalid",
        supabase_refresh_token: "synthetic-refresh",
      })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.JHT_REALTIME_SYNC;
      else process.env.JHT_REALTIME_SYNC = previous;
    }
  });

  it("non riattiva consumer legacy duplicati col vecchio escape hatch", () => {
    const source = readFileSync(resolve(root, "cli/src/commands/pid1.js"), "utf-8");
    const activation = source.slice(
      source.indexOf("const controlPollers"),
      source.indexOf("// Stato iniziale del cloud"),
    );
    expect(activation).toContain("deprecated and ignored");
    const boot = source.slice(
      source.indexOf("// Stato iniziale del cloud"),
      source.indexOf("// ── Watcher su cloud.json"),
    );
    expect(boot).not.toContain("startTeamState()");
    expect(boot).not.toContain("startUserMessages()");
    expect(boot).not.toContain("startRealtime()");
  });

  it("usa fallback crescente e bounded quando il socket non e' sano", () => {
    const source = readFileSync(resolve(root, "cli/src/commands/cloud.js"), "utf-8");
    expect(source).toContain("fallbackAttempt++");
    expect(source).toContain("maxMs: fallbackMaxMs");
    expect(source).toContain("scheduleFallback(500)");
  });
});
