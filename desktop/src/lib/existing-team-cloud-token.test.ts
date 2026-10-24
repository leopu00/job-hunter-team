import { describe, expect, it, vi } from "vitest";
import { checkCloudToken, isSyncToken, openCloudTokenSite, renewCloudToken } from "./existing-team-cloud-token";

// The box's website token, looked at and renewed from the app (T126). Synthetic tokens only.
const SECRET = "jht_sync_SENTINELLA-token-privato_7f3a9c";

describe("what is a sync token", () => {
  it("is jht_sync_ and the website's alphabet, nothing else", () => {
    expect(isSyncToken(SECRET)).toBe(true);
    expect(isSyncToken(`  ${SECRET}\n`)).toBe(true);
    for (const wrong of ["", "jht_sync_", "jht_sync_short", "other_AbCdEfGhIjKlMnOpQrSt", `${SECRET}; reboot`, `${SECRET} x`, `jht_sync_${"a".repeat(129)}`]) {
      expect(isSyncToken(wrong), wrong).toBe(false);
    }
  });
});

describe("how long the box's token lasts", () => {
  const ask = async (reply: unknown) => checkCloudToken(async () => reply);

  it("reads the closed states", async () => {
    expect(await ask({ ok: true, state: "expired", expires_at: null, days_left: null })).toEqual({ kind: "expired" });
    expect(await ask({ ok: true, state: "expiring", expires_at: "2026-11-01T00:00:00.000Z", days_left: 9 })).toEqual({
      kind: "expiring", expiresAt: "2026-11-01T00:00:00.000Z", daysLeft: 9,
    });
    for (const state of ["active", "none", "unknown"]) expect(await ask({ ok: true, state })).toEqual({ kind: "fine" });
  });

  it("says nothing for a reply that is not that, or a read that failed", async () => {
    for (const reply of [
      null, [], "x", { ok: false, error: "existing_team_runtime_outdated" }, { ok: true, state: "weird" }, { ok: true },
      { ok: true, state: "expiring", expires_at: 5, days_left: 9 }, { ok: true, state: "expiring", expires_at: "x", days_left: 1.5 },
      { ok: true, state: "expiring", expires_at: "x", days_left: -1 },
    ]) {
      expect(await ask(reply), JSON.stringify(reply)).toEqual({ kind: "unknown" });
    }
    expect(await checkCloudToken(async () => { throw new Error("ssh"); })).toEqual({ kind: "unknown" });
  });

  it("asks the closed op and sends nothing else", async () => {
    const call = vi.fn(async () => ({ ok: true, state: "none" }));
    await checkCloudToken(call);
    expect(call).toHaveBeenCalledWith({ op: "check" });
  });
});

describe("the renewal", () => {
  it("asks the connection key first, then hands the token over once", async () => {
    const calls: [string, unknown][] = [];
    const result = await renewCloudToken(`  ${SECRET}  `, async (command, args) => {
      calls.push([command, args]);
      return command === "existing_team_position_write_target" ? { ok: true, connectionKey: "k1" } : { ok: true };
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      ["existing_team_position_write_target", undefined],
      ["existing_team_cloud_token", { request: { op: "apply", token: SECRET, connectionKey: "k1" } }],
    ]);
  });

  it("never calls the native side with something that is not a sync token", async () => {
    const call = vi.fn();
    expect(await renewCloudToken("nope", call)).toEqual({ ok: false, failure: "token_malformed" });
    expect(call).not.toHaveBeenCalled();
  });

  it("a team not connected in full, and the closed refusals of the box, come back as their own failure", async () => {
    const withTarget = (target: unknown, applied?: unknown) => async (command: string) =>
      command === "existing_team_position_write_target" ? target : applied;
    expect(await renewCloudToken(SECRET, withTarget({ ok: false, error: "position_write_read_only" }))).toEqual({ ok: false, failure: "cloud_token_read_only" });
    expect(await renewCloudToken(SECRET, withTarget({ ok: false, error: "existing_team_runtime_required" }))).toEqual({ ok: false, failure: "other" });
    const key = { ok: true, connectionKey: "k1" };
    for (const code of ["token_rejected", "token_other_account", "cloud_unreachable", "cloud_not_configured", "cloud_write_failed", "existing_team_runtime_outdated", "existing_team_runtime_target_changed"]) {
      expect(await renewCloudToken(SECRET, withTarget(key, { ok: false, error: code }))).toEqual({ ok: false, failure: code });
    }
    expect(await renewCloudToken(SECRET, withTarget(key, { ok: false, error: SECRET }))).toEqual({ ok: false, failure: "other" });
    expect(await renewCloudToken(SECRET, async () => { throw new Error(SECRET); })).toEqual({ ok: false, failure: "other" });
  });
});

describe("opening the website", () => {
  it("is one command with no argument", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    expect(await openCloudTokenSite(call)).toEqual({ ok: true });
    expect(call).toHaveBeenCalledWith("existing_team_cloud_token_open_site");
    expect(await openCloudTokenSite(async () => ({ ok: false, error: "browser_failed" }))).toEqual({ ok: false, failure: "browser_failed" });
  });
});
