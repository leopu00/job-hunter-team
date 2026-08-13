import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeQuarantineEntries,
  partitionQuarantinedRows,
  quarantineIdentity,
  quarantineRow,
  readCloudPushQuarantine,
  requestQuarantineRetry,
  resolveConfirmedRetries,
  resolveQuarantine,
  retryTables,
  sanitizedQuarantineReason,
} from "../../../cli/src/lib/cloud-push-quarantine.js";

const dirs: string[] = [];
const makeFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "jht-push-quarantine-"));
  dirs.push(dir);
  return join(dir, "quarantine.json");
};

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("cloud push quarantine metadata", () => {
  it("persists opaque metadata only and increments attempts", () => {
    const path = makeFile();
    const row = {
      position_id: 42,
      critic_notes: "synthetic-private-body-must-not-leak",
    };
    const reason = sanitizedQuarantineReason(500, {
      error: "applications_upsert_failed",
      detail: "synthetic-infrastructure-detail-must-not-leak",
    });
    const identity = quarantineRow({
      table: "applications",
      row,
      reason,
      path,
      now: Date.UTC(2026, 7, 13, 8),
    });
    quarantineRow({
      table: "applications",
      row,
      reason,
      path,
      now: Date.UTC(2026, 7, 13, 9),
    });

    expect(identity).toMatch(/^q_[a-f0-9]{24}$/);
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain("42");
    expect(raw).not.toContain("synthetic-private-body");
    expect(raw).not.toContain("synthetic-infrastructure-detail");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readCloudPushQuarantine(path).entries[0]).toMatchObject({
      identity,
      table: "applications",
      reason: "http_500:applications_upsert_failed",
      attempts: 2,
      status: "active",
      first_failed_at: "2026-08-13T08:00:00.000Z",
      last_failed_at: "2026-08-13T09:00:00.000Z",
    });
  });

  it("holds active rows, re-enters requested retries, then resolves on ACK", () => {
    const path = makeFile();
    const rejected = { id: 2, title: "Synthetic rejected" };
    const rows = [
      { id: 1, title: "Synthetic before" },
      rejected,
      { id: 3, title: "Synthetic after" },
    ];
    const identity = quarantineRow({
      table: "positions",
      row: rejected,
      reason: "http_422:record_rejected",
      path,
    });
    let state = readCloudPushQuarantine(path);
    expect(partitionQuarantinedRows("positions", rows, state)).toEqual({
      send: [rows[0], rows[2]],
      held: [rows[1]],
    });

    expect(requestQuarantineRetry(identity, { path }).changed).toBe(1);
    state = readCloudPushQuarantine(path);
    expect(retryTables(state)).toEqual(new Set(["positions"]));
    expect(partitionQuarantinedRows("positions", rows, state)).toEqual({
      send: rows,
      held: [],
    });
    expect(resolveConfirmedRetries("positions", [rejected], { path })).toBe(1);
    expect(activeQuarantineEntries(readCloudPushQuarantine(path))).toEqual([]);
  });

  it("keeps resolved history and never accepts raw server prose as a reason", () => {
    const path = makeFile();
    const row = { id: 7 };
    const identity = quarantineIdentity("companies", row);
    quarantineRow({
      table: "companies",
      row,
      reason: sanitizedQuarantineReason(500, {
        error: "unsafe error with synthetic host detail",
      }),
      path,
    });
    expect(resolveQuarantine(identity, { path }).changed).toBe(1);
    expect(readCloudPushQuarantine(path).entries[0]).toMatchObject({
      identity,
      reason: "http_500:record_rejected",
      status: "resolved",
    });
  });
});
