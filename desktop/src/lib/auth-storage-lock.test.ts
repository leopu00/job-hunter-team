import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@tauri-apps/api/core");
});

describe("the session's storage as the pages see it", () => {
  it("is readable where no probe was registered", async () => {
    const { cloudSessionReadable } = await import("./auth-storage-lock");
    expect(cloudSessionReadable()).toBe(true);
  });

  it("is locked in the packaged app until the storage is unlocked, which a local profile never does", async () => {
    vi.resetModules();
    vi.doMock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
    const { cloudSessionReadable } = await import("./auth-storage-lock");
    await import("./supabase");
    expect(cloudSessionReadable()).toBe(false);
  });

  it("follows the deferred storage's unlocking", async () => {
    const { deferAuthStorage } = await import("./supabase");
    const deferred = deferAuthStorage({ getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined });
    expect(deferred.isUnlocked()).toBe(false);
    deferred.unlock();
    expect(deferred.isUnlocked()).toBe(true);
  });
});
