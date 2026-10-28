import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  activateDesktopAccountScope,
  activateDesktopLocalScope,
  clearDesktopAccountScope,
  createDesktopLocalProfile,
  migrateDesktopLocalProfileToAccount,
  probeDesktopLocalProfileMigration,
  recoverDesktopPlaygroundLocalOrphan,
  resetDesktopPlaygroundLocalScope,
} from "./desktop-account-scope";

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(isTauri).mockReset().mockReturnValue(true);
});

describe("desktop account scope boundary", () => {
  it("lets only the authenticated backend derive the opaque scope", async () => {
    await activateDesktopAccountScope();
    expect(invoke).toHaveBeenCalledWith("runtime_account_scope_set");
    expect(vi.mocked(invoke).mock.calls[0]).toHaveLength(1);
  });

  it("creates and activates a backend-issued local profile without sending its display name", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ profileId: "opaque-local-capability" });
    await expect(createDesktopLocalProfile()).resolves.toEqual({ profileId: "opaque-local-capability" });
    await activateDesktopLocalScope("opaque-local-capability");

    expect(invoke).toHaveBeenNthCalledWith(1, "runtime_local_profile_create");
    expect(vi.mocked(invoke).mock.calls[0]).toHaveLength(1);
    expect(invoke).toHaveBeenNthCalledWith(2, "runtime_account_scope_set_local", {
      profileId: "opaque-local-capability",
    });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain("Nome Locale");
  });

  it("serializes account changes and logout teardown", async () => {
    let releaseFirst!: () => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));

    const accountA = activateDesktopAccountScope();
    const clear = clearDesktopAccountScope();
    const accountB = activateDesktopAccountScope();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([accountA, clear, accountB]);

    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "runtime_account_scope_set",
      "runtime_account_scope_reset",
      "runtime_account_scope_set",
    ]);
  });

  it("exposes the DEV playground reset as one serialized native command", async () => {
    await resetDesktopPlaygroundLocalScope("opaque-local-capability");
    expect(invoke).toHaveBeenCalledWith("runtime_playground_local_reset", {
      profileId: "opaque-local-capability",
    });
  });

  it("recovers an orphaned playground owner without renderer identity payload", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);
    await expect(recoverDesktopPlaygroundLocalOrphan()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("runtime_playground_local_orphan_recover");
    expect(vi.mocked(invoke).mock.calls[0]).toHaveLength(1);
  });

  it("probes and commits local migration without accepting an account identifier", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ receiptHash: "a".repeat(64) });

    await expect(probeDesktopLocalProfileMigration("opaque-local-capability")).resolves.toBe(true);
    await expect(migrateDesktopLocalProfileToAccount("opaque-local-capability")).resolves.toEqual({
      receiptHash: "a".repeat(64),
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "runtime_local_profile_migration_probe", {
      profileId: "opaque-local-capability",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "runtime_local_profile_migrate_to_authenticated", {
      profileId: "opaque-local-capability",
    });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain("accountId");
  });

  it("rejects an unverified migration receipt", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ receiptHash: "not-a-receipt" });
    await expect(migrateDesktopLocalProfileToAccount("opaque-local-capability")).rejects.toEqual({
      code: "local_migration_receipt_invalid",
    });
  });

  it("coalesces a repeated explicit migration gesture into one native command", async () => {
    let commit!: (value: { receiptHash: string }) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((resolve) => { commit = resolve; }));

    const first = migrateDesktopLocalProfileToAccount("opaque-local-capability");
    const second = migrateDesktopLocalProfileToAccount("opaque-local-capability");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    commit({ receiptHash: "b".repeat(64) });

    await expect(first).resolves.toEqual({ receiptHash: "b".repeat(64) });
    await expect(second).resolves.toEqual({ receiptHash: "b".repeat(64) });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("fails closed outside the desktop runtime", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(activateDesktopAccountScope()).rejects.toEqual({ code: "desktop_only" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
