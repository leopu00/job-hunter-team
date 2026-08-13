import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
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

function childWriter(path: string, id: number) {
  const moduleUrl = new URL(
    "../../../cli/src/lib/cloud-push-quarantine.js",
    import.meta.url,
  ).href;
  const source = `
    const q = await import(process.env.JHT_TEST_QUARANTINE_MODULE);
    q.quarantineRow({
      table: "positions",
      row: { id: Number(process.env.JHT_TEST_QUARANTINE_ID) },
      reason: "http_422:record_rejected",
      path: process.env.JHT_TEST_QUARANTINE_PATH,
    });
  `;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        env: {
          ...process.env,
          JHT_TEST_QUARANTINE_MODULE: moduleUrl,
          JHT_TEST_QUARANTINE_PATH: path,
          JHT_TEST_QUARANTINE_ID: String(id),
        },
        stdio: "pipe",
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child writer ${id} failed (${code}): ${stderr}`));
    });
  });
}

function childMutation(path: string, action: string, value: string) {
  const moduleUrl = new URL(
    "../../../cli/src/lib/cloud-push-quarantine.js",
    import.meta.url,
  ).href;
  const source = `
    const q = await import(process.env.JHT_TEST_QUARANTINE_MODULE);
    const action = process.env.JHT_TEST_QUARANTINE_ACTION;
    const value = process.env.JHT_TEST_QUARANTINE_VALUE;
    const path = process.env.JHT_TEST_QUARANTINE_PATH;
    if (action === "retry") q.requestQuarantineRetry(value, { path });
    else if (action === "resolve") q.resolveQuarantine(value, { path });
    else q.quarantineRow({
      table: "positions",
      row: { id: Number(value) },
      reason: "http_422:record_rejected",
      path,
    });
  `;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        env: {
          ...process.env,
          JHT_TEST_QUARANTINE_MODULE: moduleUrl,
          JHT_TEST_QUARANTINE_PATH: path,
          JHT_TEST_QUARANTINE_ACTION: action,
          JHT_TEST_QUARANTINE_VALUE: value,
        },
        stdio: "pipe",
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child ${action} failed (${code}): ${stderr}`));
    });
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("cloud push quarantine metadata", () => {
  it("persists opaque metadata only and increments attempts", () => {
    const path = makeFile();
    const row = {
      legacy_id: 17,
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

  it("keeps tied tombstones/transitions and timestamp-less messages distinct", () => {
    const at = "2026-08-13T10:00:00.000Z";
    expect(
      quarantineIdentity("tombstones", {
        table_name: "positions",
        legacy_id: 1,
        deleted_at: at,
      }),
    ).not.toBe(
      quarantineIdentity("tombstones", {
        table_name: "positions",
        legacy_id: 2,
        deleted_at: at,
      }),
    );
    expect(
      quarantineIdentity("position_transitions", {
        position_legacy_id: 1,
        ts: at,
        by_agent: "SCOUT",
        to_state: "review",
      }),
    ).not.toBe(
      quarantineIdentity("position_transitions", {
        position_legacy_id: 2,
        ts: at,
        by_agent: "SCOUT",
        to_state: "review",
      }),
    );
    const messages = [{ id: 11 }, { id: 12 }];
    const path = makeFile();
    quarantineRow({
      table: "pending_user_messages",
      row: messages[0],
      reason: "http_422:record_rejected",
      path,
    });
    expect(
      partitionQuarantinedRows(
        "pending_user_messages",
        messages,
        readCloudPushQuarantine(path),
      ),
    ).toEqual({ send: [messages[1]], held: [messages[0]] });
  });

  it("rejects missing source identities before they can share quarantine state", () => {
    const path = makeFile();
    const invalidRows = [{ name: "Synthetic one" }, { name: "Synthetic two" }];

    expect(() =>
      partitionQuarantinedRows(
        "companies",
        invalidRows,
        readCloudPushQuarantine(path),
      ),
    ).toThrow(/invalid cloud push source identity/);
    expect(() =>
      quarantineRow({
        table: "companies",
        row: invalidRows[0],
        reason: "http_422:record_rejected",
        path,
      }),
    ).toThrow(/invalid cloud push source identity/);
    expect(readCloudPushQuarantine(path).entries).toEqual([]);
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

  it("marks malformed metadata as corrupt instead of pretending it is empty", () => {
    const path = makeFile();
    writeFileSync(path, "{not-json", "utf8");
    expect(readCloudPushQuarantine(path)).toEqual({
      version: 1,
      entries: [],
      corrupt: true,
    });
  });

  it("serializes overlapping writers across real processes without lost updates", async () => {
    const path = makeFile();
    const lockPath = `${path}.lock`;
    writeFileSync(lockPath, "", { mode: 0o600 });
    const blocked = childWriter(path, 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(() => readFileSync(path, "utf8")).toThrow();
    unlinkSync(lockPath);
    await blocked;

    await Promise.all(
      Array.from({ length: 8 }, (_, index) => childWriter(path, index + 2)),
    );
    const state = readCloudPushQuarantine(path);
    expect(state.corrupt).not.toBe(true);
    expect(state.entries).toHaveLength(9);
    expect(new Set(state.entries.map((entry) => entry.identity)).size).toBe(9);
  });

  it("preserves overlapping push, retry and resolve mutations", async () => {
    const path = makeFile();
    const retryIdentity = quarantineRow({
      table: "positions",
      row: { id: 21 },
      reason: "http_422:record_rejected",
      path,
    });
    const resolveIdentity = quarantineRow({
      table: "positions",
      row: { id: 22 },
      reason: "http_422:record_rejected",
      path,
    });

    await Promise.all([
      childMutation(path, "retry", retryIdentity),
      childMutation(path, "resolve", resolveIdentity),
      childMutation(path, "quarantine", "23"),
    ]);
    const entries = readCloudPushQuarantine(path).entries;
    expect(
      entries.find((entry) => entry.identity === retryIdentity)?.status,
    ).toBe("retry");
    expect(
      entries.find((entry) => entry.identity === resolveIdentity)?.status,
    ).toBe("resolved");
    expect(entries).toHaveLength(3);
  });
});
