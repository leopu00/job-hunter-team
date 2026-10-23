/**
 * A sync token the website refuses (expired, revoked) makes every push of the box
 * answer 401, and the website cannot say so: the box tells the user, once per
 * token, after AUTH_NOTICE_AFTER_FAILURES refused pushes in a row
 * (cli/src/lib/cloud-sync-notice.js -> shared/skills/cloud_sync_notice.py).
 * Synthetic tokens only.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AUTH_NOTICE_AFTER_FAILURES,
  noticeRefusedToken,
  tokenPublicPrefix,
} from "../../../cli/src/lib/cloud-sync-notice.js";

const TOKEN = "jht_sync_AbCdsynthetic-not-a-real-token";
const refused = (failures: number) => ({ status: "auth_failed", consecutive_failures: failures });
const told = () => vi.fn(async () => ({ notified: true, code: "token_rejected", row_id: 7 }));

describe("the notice of a refused sync token", () => {
  it("names the token by the prefix the website lists, never by the token", () => {
    expect(tokenPublicPrefix(TOKEN)).toBe("jht_sync_AbCd");
    for (const bad of [null, undefined, "", "jht_sync_", "jht_sync_Ab", "other_AbCdEf", "jht_sync_Ab;d-more", 42]) {
      expect(tokenPublicPrefix(bad as never)).toBeNull();
    }
  });

  it("waits for the refusals in a row, then tells the user once per token", async () => {
    const run = told();
    const memo = new Set<string>();
    for (let failures = 0; failures < AUTH_NOTICE_AFTER_FAILURES; failures += 1) {
      expect(await noticeRefusedToken(refused(failures), TOKEN, { run, memo })).toMatchObject({ reason: "not_yet" });
    }
    expect(run).not.toHaveBeenCalled();

    expect(await noticeRefusedToken(refused(AUTH_NOTICE_AFTER_FAILURES), TOKEN, { run, memo }))
      .toMatchObject({ notified: true });
    expect(run).toHaveBeenCalledWith(["token_rejected", "jht_sync_AbCd"]);

    // the next checks of the same refused token run nothing
    expect(await noticeRefusedToken(refused(500), TOKEN, { run, memo })).toMatchObject({ reason: "already_told" });
    expect(run).toHaveBeenCalledTimes(1);

    // a new token refused in its turn is told again
    await noticeRefusedToken(refused(9), "jht_sync_WxYzsynthetic", { run, memo });
    expect(run).toHaveBeenLastCalledWith(["token_rejected", "jht_sync_WxYz"]);
  });

  it("says nothing for another failure, and a notice that did not go out is tried again", async () => {
    const run = told();
    const memo = new Set<string>();
    for (const status of ["failed", "timeout", "partial", "completed", undefined]) {
      expect(await noticeRefusedToken({ status, consecutive_failures: 99 }, TOKEN, { run, memo }))
        .toMatchObject({ reason: "not_refused" });
    }
    expect(await noticeRefusedToken(refused(9), "not a sync token", { run, memo }))
      .toMatchObject({ reason: "token_unreadable" });
    expect(run).not.toHaveBeenCalled();

    const log = vi.fn();
    const failing = vi.fn(async () => ({ notified: false, reason: "notify_tool_missing" }));
    await noticeRefusedToken(refused(9), TOKEN, { run: failing, memo, log });
    await noticeRefusedToken(refused(10), TOKEN, { run: failing, memo, log });
    expect(failing).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("cloud-sync notice not sent: notify_tool_missing");
    const throwing = vi.fn(async () => { throw new Error("boom"); });
    await expect(noticeRefusedToken(refused(9), TOKEN, { run: throwing, memo })).resolves.toMatchObject({ notified: false });
  });

  it("is asked by the periodic push when the website refuses the token", async () => {
    const { maybePeriodicPush } = await import("../../../cli/src/commands/cloud.js");
    const notice = vi.fn(async () => ({ notified: true }));
    const outcome = await maybePeriodicPush({
      now: Date.UTC(2026, 9, 23, 18, 0, 0),
      state: { status: "auth_failed", consecutive_failures: 4, last_attempt_at: "2026-10-01T00:00:00.000Z", last_check_at: "2026-10-01T00:00:00.000Z" },
      readSignature: async () => ({ positions: { n: 3, max: "2026-10-23 17:00:00" } }),
      readQuarantineCount: async () => 0,
      pushFn: async () => ({ ok: false, authFailed: true, skipped: 0 }),
      save: async () => true,
      publishObservation: false,
      config: { enabled: true, token: TOKEN },
      noticeRefusedToken: notice,
      silent: true,
    });
    expect(outcome.state).toMatchObject({ status: "auth_failed" });
    expect(notice).toHaveBeenCalledOnce();
    expect(notice.mock.calls[0][0]).toMatchObject({ status: "auth_failed" });
    expect(notice.mock.calls[0][1]).toBe(TOKEN);

    const quiet = vi.fn(async () => ({ notified: true }));
    await maybePeriodicPush({
      now: Date.UTC(2026, 9, 23, 18, 0, 0),
      state: { status: "idle", consecutive_failures: 0, last_check_at: "2026-10-01T00:00:00.000Z" },
      readSignature: async () => ({ positions: { n: 3, max: "2026-10-23 17:00:00" } }),
      readQuarantineCount: async () => 0,
      pushFn: async () => ({ ok: true, skipped: 0 }),
      save: async () => true,
      publishObservation: false,
      config: { enabled: true, token: TOKEN },
      noticeRefusedToken: quiet,
      silent: true,
    });
    expect(quiet).not.toHaveBeenCalled();
  });
});
