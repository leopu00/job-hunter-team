import { beforeEach, describe, expect, it, vi } from "vitest";
import { backupCancel, backupCreate, backupInspect, manifestOf, onBackupProgress } from "./team-backup";
import { ERROR_CATALOG } from "./error-catalog";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: native.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

const MANIFEST = {
  format: 1,
  createdAt: "2026-10-24T10:00:00Z",
  files: [{ path: "jobs.db", bytes: 100 }],
  excluded: [{ path: "documents/big.pdf", reason: "too_large" }],
  alwaysExcluded: ["cloud.json", ".claude"],
};

beforeEach(() => {
  native.invoke.mockReset();
  native.listen.mockReset();
  native.isTauri.mockReturnValue(true);
});

describe("team backup", () => {
  it("makes a backup and answers the bytes and the files it holds", async () => {
    native.invoke.mockResolvedValue({ outcome: "saved", bytes: 2048, files: 9 });
    expect(await backupCreate()).toEqual({ ok: true, outcome: "saved", bytes: 2048, files: 9 });
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("backup_create");
  });

  it("closing the save window is not an error", async () => {
    native.invoke.mockResolvedValue({ outcome: "cancelled" });
    expect(await backupCreate()).toEqual({ ok: true, outcome: "cancelled" });
    expect(await backupInspect()).toEqual({ ok: true, outcome: "cancelled" });
  });

  it("an error of the native side is its closed code", async () => {
    for (const code of ["backup_no_database", "backup_no_space", "backup_too_large", "backup_busy", "disconnected"]) {
      native.invoke.mockRejectedValue({ code });
      expect(await backupCreate()).toEqual({ ok: false, error: code });
    }
  });

  it.each([undefined, null, "saved", {}, { outcome: "saved" }, { outcome: "saved", bytes: -1, files: 1 }, { outcome: "saved", bytes: 1.5, files: 1 }, { outcome: "saved", bytes: 1, files: "2" }, { outcome: "done" }])(
    "a reply that is not an outcome (%j) is a failed save, never a success",
    async (reply) => {
      native.invoke.mockResolvedValue(reply);
      expect(await backupCreate()).toEqual({ ok: false, error: "backup_save_failed" });
    },
  );

  it.each([undefined, new Error("boom"), {}, { code: "" }, { code: 5 }])("an error with no code (%j) is a failed save", async (error) => {
    native.invoke.mockRejectedValue(error);
    expect(await backupCreate()).toEqual({ ok: false, error: "backup_save_failed" });
  });

  it("opens a backup and shows what it holds, with the answer of its check", async () => {
    native.invoke.mockResolvedValue({ outcome: "opened", manifest: MANIFEST, verified: true, problems: [] });
    expect(await backupInspect()).toEqual({ ok: true, outcome: "opened", manifest: MANIFEST, verified: true, problems: [] });
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("backup_inspect");
    native.invoke.mockResolvedValue({ outcome: "opened", manifest: MANIFEST, verified: false, problems: ["changed:jobs.db", 7] });
    expect(await backupInspect()).toMatchObject({ ok: true, verified: false, problems: ["changed:jobs.db"] });
  });

  it("a file that is not a backup is told so, never shown as an empty one", async () => {
    native.invoke.mockRejectedValue({ code: "backup_not_a_backup" });
    expect(await backupInspect()).toEqual({ ok: false, error: "backup_not_a_backup" });
    for (const reply of [undefined, {}, { outcome: "opened" }, { outcome: "opened", manifest: MANIFEST, verified: "yes", problems: [] }, { outcome: "opened", manifest: { ...MANIFEST, format: 2 }, verified: true, problems: [] }, { outcome: "opened", manifest: MANIFEST, verified: true }]) {
      native.invoke.mockResolvedValue(reply);
      expect(await backupInspect(), JSON.stringify(reply)).toEqual({ ok: false, error: "backup_not_a_backup" });
    }
  });

  it("trusts a manifest only when it is whole", () => {
    expect(manifestOf(MANIFEST)).toEqual(MANIFEST);
    expect(manifestOf({ ...MANIFEST, createdAt: 5, excluded: [{ path: 1, reason: null }, "x"] })).toMatchObject({ createdAt: null, excluded: [{ path: null, reason: null }] });
    for (const bad of [null, "x", [], {}, { ...MANIFEST, format: 2 }, { ...MANIFEST, files: "x" }, { ...MANIFEST, files: [{ path: 1, bytes: 1 }] }, { ...MANIFEST, files: [{ path: "a", bytes: -1 }] }, { ...MANIFEST, excluded: null }, { ...MANIFEST, alwaysExcluded: null }]) {
      expect(manifestOf(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("cancel never fails the page, whatever the native side says", async () => {
    native.invoke.mockRejectedValue({ code: "invalid_request" });
    await expect(backupCancel()).resolves.toBeUndefined();
    expect(native.invoke).toHaveBeenCalledWith("backup_cancel");
  });

  it("gives the progress of the backup that runs, and only well-formed events", async () => {
    const unlisten = vi.fn();
    let handler: (event: { payload: unknown }) => void = () => {};
    native.listen.mockImplementation(async (_name: string, fn: typeof handler) => {
      handler = fn;
      return unlisten;
    });
    const seen: unknown[] = [];
    const stop = await onBackupProgress((progress) => seen.push(progress));
    expect(native.listen.mock.calls[0][0]).toBe("backup-progress");
    for (const payload of [{ phase: "snapshot", done: 0, total: 100 }, { phase: "copy", done: 50, total: 100 }, { phase: "other", done: 1, total: 2 }, { phase: "copy", done: -1, total: 2 }, { phase: "copy", done: "1", total: 2 }, null, "x"]) handler({ payload });
    expect(seen).toEqual([{ phase: "snapshot", done: 0, total: 100 }, { phase: "copy", done: 50, total: 100 }]);
    expect(stop).toBe(unlisten);
  });

  it("outside the desktop nothing is called", async () => {
    native.isTauri.mockReturnValue(false);
    expect(await backupCreate()).toEqual({ ok: false, error: "desktop_only" });
    expect(await backupInspect()).toEqual({ ok: false, error: "desktop_only" });
    await backupCancel();
    const stop = await onBackupProgress(() => {});
    stop();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.listen).not.toHaveBeenCalled();
  });

  it("every code a backup can answer has a sentence in the error catalog", () => {
    for (const code of ["backup_snapshot_failed", "backup_too_large", "backup_verify_failed", "backup_save_failed", "backup_not_a_backup", "backup_no_database", "backup_no_space", "backup_busy", "disconnected", "tunnel_unavailable", "read_failed", "invalid_request"]) {
      expect(code in ERROR_CATALOG, code).toBe(true);
    }
  });
});
